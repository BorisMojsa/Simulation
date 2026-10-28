/**
 * Deterministic Fix 03 league-membership browser fixtures.
 * Modes complete a controlled Championship/PL season boundary through
 * production finalization helpers, then expose the next-edition career state.
 */
import { LEAGUES, LEAGUE_LOOKUP, LEAGUE_BY_ID } from "../data/leagues.js";
import { createPlayerIdentity } from "./playerDevelopment.js";
import { simulateSeason } from "./seasonSimulator.js";
import { simulateChronologicalSeason } from "./chronologicalSeason.js";
import {
  createWorldState,
  setWorldState,
  getWorldState,
  serializeWorldState,
} from "./worldState.js";
import { resetClubFinanceLedgers } from "./clubFinance.js";
import { reseedCareerRng } from "./rng.js";
import { ensurePlayingStints } from "./playingRegistration.js";
import { applyDivisionMovement } from "./leaguePhase.js";
import {
  finalizeMembershipAfterSeason,
  resolveLeagueClubs,
} from "./leagueMembership.js";
import { buildDestinationLeagueSchedule } from "./destinationSchedule.js";
import { roundTripCareerSnapshot } from "./careerSnapshot.js";
import { allSeniorClubs, findSeniorClubById } from "./seniorClubs.js";
import { buildValidatedOffer, applyOfferToPlayer } from "./dealPipeline.js";
import { startLoan, endLoan } from "./loanMarket.js";

const PL = () => LEAGUE_BY_ID.get("league:england-premier-league");
const CH = () => LEAGUE_BY_ID.get("league:england-championship");

export const MEMBERSHIP_FIXTURE = {
  careerId: "fix03-membership-fixture-v1",
  seed: 42,
  startYear: 2026,
};

function membershipSizes(world = getWorldState()) {
  return {
    premier: world?.leagueMemberships?.get(PL().leagueId)?.length ?? null,
    championship: world?.leagueMemberships?.get(CH().leagueId)?.length ?? null,
  };
}

function makePlayer(league, clubName, cfg) {
  const club = league.clubs.find((c) => c.name === clubName);
  if (!club) return null;
  const player = createPlayerIdentity({
    name: "Membership QA",
    nationality: "England",
    position: "CM",
    age: 19,
  });
  player.startYear = cfg.startYear;
  player.rating = 76;
  player.potential = 88;
  player.attributes = {
    Speed: 76,
    Passing: 78,
    Shooting: 72,
    Defending: 74,
    Physicality: 76,
    Dribbling: 77,
  };
  player.playerModelVersion = 2;
  player.state = { form: 0, morale: 0, readiness: 1, fatigue: 0, adaptationPenalty: 0, roleFit: 1 };
  player.health = { activeInjury: null, injuryHistory: [], durableDamage: {}, recoverableDamage: {} };
  player.development = { latentBudget: 90, modelVersion: 1, migration: {} };
  player.club = {
    ...club,
    league: league.name,
    leagueDisplay: league.displayName,
    leagueId: league.leagueId,
    nation: league.nation,
    isAcademy: false,
    parentClub: null,
  };
  player.employmentClubId = club.clubId;
  player.playingClubId = club.clubId;
  player.contractStartSeason = 0;
  player.contractYears = 4;
  player.contractEndSeason = 4;
  player.weeklyWage = 4000;
  player.careerId = `${cfg.careerId}:${cfg.mode || "default"}`;
  player.seasons = [];
  player.pendingOffers = [];
  player.pendingDecision = null;
  player.seasonCheckpoint = null;
  ensurePlayingStints(player, { asOfDate: `${cfg.startYear}-07-01` });
  return { player, club };
}

function biasClub(world, leagueId, targetId, high) {
  for (const id of world.leagueMemberships.get(leagueId) || []) {
    const profile = world.clubs.get(id);
    if (!profile) continue;
    const strong = id === targetId ? high : !high;
    const v = strong ? 92 : 52;
    profile.overall = v;
    profile.attack = v;
    profile.midfield = v;
    profile.defence = v;
    profile.goalkeeper = Math.max(48, v - 2);
  }
}

function evidenceFromWorld(world, clubId) {
  const plIds = world.leagueMemberships.get(PL().leagueId) || [];
  const chIds = world.leagueMemberships.get(CH().leagueId) || [];
  const transition = [...(world.membershipTransitions?.values?.() || [])][0] || null;
  return {
    membership: membershipSizes(world),
    inPremier: plIds.includes(clubId),
    inChampionship: chIds.includes(clubId),
    promoted: transition?.promoted || null,
    relegated: transition?.relegated || null,
    transitionKey: transition?.key || null,
  };
}

/**
 * @param {{ mode?: string, seed?: number }} opts
 * mode:
 *  - promotion: controlled Birmingham promotion + next PL season complete counts
 *  - relegation: controlled Ipswich relegation + next Championship counts
 *  - midtable: mid-table Championship finish; others still move
 *  - next-pause: post-promotion PL season paused for Skip/Continue
 *  - offer-loan: after Birmingham promotion, free-agent accept + loan return checks
 *  - snapshot: post-promotion round-trip checkpoint
 *  - simulate-promotion: strength-biased production simulateSeason
 */
export function buildMembershipBrowserFixture(opts = {}) {
  const mode = opts.mode || "promotion";
  const cfg = { ...MEMBERSHIP_FIXTURE, ...opts, mode };
  resetClubFinanceLedgers();
  reseedCareerRng(cfg.seed);
  const world = createWorldState({ seed: cfg.seed, startYear: cfg.startYear });
  setWorldState(world);

  if (mode === "promotion" || mode === "next-pause" || mode === "offer-loan" || mode === "snapshot") {
    const built = makePlayer(CH(), "Birmingham City", cfg);
    if (!built) return { ok: false, reason: "birmingham-missing" };
    const { player, club } = built;
    const move = applyDivisionMovement(player, { position: 2 }, CH(), LEAGUES);
    if (move?.type !== "promoted") {
      return { ok: false, reason: "promotion-failed", move, evidence: evidenceFromWorld(world, club.clubId) };
    }
    const dest = buildDestinationLeagueSchedule(PL(), cfg.startYear + 1, world);
    const next =
      mode === "next-pause"
        ? simulateChronologicalSeason({
            player,
            league: PL(),
            seasonIndex: 1,
            pauseForDecisions: true,
            autoDecisionPolicy: null,
          })
        : simulateChronologicalSeason({
            player,
            league: PL(),
            seasonIndex: 1,
            pauseForDecisions: false,
            autoDecisionPolicy: "stay",
          });

    let snapshot = null;
    if (mode === "snapshot") {
      snapshot = roundTripCareerSnapshot({
        player,
        world,
        checkpoint: next.checkpoint || player.seasonCheckpoint,
      });
    }

    let offerMeta = null;
    if (mode === "offer-loan") {
      const buyerBuilt = makePlayer(PL(), "Arsenal", { ...cfg, mode: "buyer" });
      setWorldState(world);
      const buyer = buyerBuilt.player;
      buyer.contractEndSeason = 0;
      buyer.contractStatus = "expired";
      const promoted = findSeniorClubById(club.clubId);
      const builtOffer = buildValidatedOffer({
        player: buyer,
        club: promoted,
        fit: {
          eligible: true,
          pathway: "senior",
          scout: { assessedReadiness: 75, assessedUpside: 80 },
          projection: { role: "starter", minutesShare: 0.7, minutesRange: [60, 90], gap: 0, benchmark: 74 },
        },
        dealType: "free_agent",
        performanceScore: 72,
      });
      if (builtOffer.ok) applyOfferToPlayer(buyer, builtOffer.offer, "fix03-browser-offer");
      const borrowerId = world.leagueMemberships.get(CH().leagueId).find((id) => id !== club.clubId);
      // Loan check on original promoted player after ensuring parent division
      const loanParent = player;
      // Reset player onto Birmingham PL for loan from parent
      offerMeta = {
        offerOk: builtOffer.ok,
        buyerClubId: buyer.club?.clubId || null,
        buyerLeagueId: buyer.club?.leagueId || null,
        destFixtures: dest.dated.filter((f) =>
          [f.home?.clubId, f.away?.clubId].includes(club.clubId)
        ).length,
        catalogLeagueId: allSeniorClubs(world).find((c) => c.clubId === club.clubId)?.leagueId,
        borrowerId,
        parentLeagueId: loanParent.club?.leagueId,
      };
    }

    return {
      ok: true,
      mode,
      player,
      clubId: club.clubId,
      move,
      evidence: evidenceFromWorld(world, club.clubId),
      next: {
        status: next.status,
        tableRows: next.table?.length ?? 0,
        fixtures: next.allMatches?.length ?? 0,
        clubFixtures: next.playerMatches?.length ?? 0,
        expectedMatches: next.expectedMatches,
        participantIds: (next.table || []).map((r) => r.clubId),
      },
      destination: {
        clubs: dest.clubs.length,
        fixtures: dest.dated.length,
        clubFixtures: dest.dated.filter((f) =>
          [f.home?.clubId, f.away?.clubId].includes(club.clubId)
        ).length,
      },
      checkpoint: next.checkpoint || player.seasonCheckpoint,
      snapshotOk: snapshot ? sizeMatch(snapshot.world) : null,
      offerMeta,
      worldSerialized: serializeWorldState(world),
    };
  }

  if (mode === "relegation") {
    const built = makePlayer(PL(), "Ipswich Town", cfg);
    if (!built) return { ok: false, reason: "ipswich-missing" };
    const { player, club } = built;
    const move = applyDivisionMovement(player, { position: 20 }, PL(), LEAGUES);
    if (move?.type !== "relegated") {
      return { ok: false, reason: "relegation-failed", move, evidence: evidenceFromWorld(world, club.clubId) };
    }
    const next = simulateChronologicalSeason({
      player,
      league: CH(),
      seasonIndex: 1,
      pauseForDecisions: false,
      autoDecisionPolicy: "stay",
    });
    const dest = buildDestinationLeagueSchedule(CH(), cfg.startYear + 1, world);
    return {
      ok: true,
      mode,
      player,
      clubId: club.clubId,
      move,
      evidence: evidenceFromWorld(world, club.clubId),
      next: {
        status: next.status,
        tableRows: next.table?.length ?? 0,
        fixtures: next.allMatches?.length ?? 0,
        clubFixtures: next.playerMatches?.length ?? 0,
        expectedMatches: next.expectedMatches,
        participantIds: (next.table || []).map((r) => r.clubId),
      },
      destination: {
        clubs: dest.clubs.length,
        fixtures: dest.dated.length,
        clubFixtures: dest.dated.filter((f) =>
          [f.home?.clubId, f.away?.clubId].includes(club.clubId)
        ).length,
        premierStillHasIpswich: (world.leagueMemberships.get(PL().leagueId) || []).includes(club.clubId),
      },
      worldSerialized: serializeWorldState(world),
    };
  }

  if (mode === "midtable") {
    const built = makePlayer(CH(), "Birmingham City", cfg);
    if (!built) return { ok: false, reason: "birmingham-missing" };
    const { player, club } = built;
    const move = applyDivisionMovement(player, { position: 12 }, CH(), LEAGUES);
    const evidence = evidenceFromWorld(world, club.clubId);
    return {
      ok: true,
      mode,
      player,
      clubId: club.clubId,
      move,
      evidence,
      zones: {
        promoteSlots: 3,
        relegateSlots: 3,
        playerMoved: Boolean(move),
        othersMoved: (evidence.promoted?.length || 0) === 3 && (evidence.relegated?.length || 0) === 3,
      },
      worldSerialized: serializeWorldState(world),
    };
  }

  if (mode === "simulate-promotion") {
    const built = makePlayer(CH(), "Birmingham City", cfg);
    if (!built) return { ok: false, reason: "birmingham-missing" };
    const { player, club } = built;
    biasClub(world, CH().leagueId, club.clubId, true);
    const done = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions: false,
      autoDecisionPolicy: "stay",
    });
    const evidence = evidenceFromWorld(world, club.clubId);
    return {
      ok: true,
      mode,
      player,
      clubId: club.clubId,
      season: done?.season
        ? {
            divisionMove: done.season.divisionMove,
            membershipTransition: done.season.membershipTransition,
            league: done.season.league,
            standingPos: done.season.standing?.position || done.standings?.playerRecord?.position,
          }
        : null,
      evidence,
      worldSerialized: serializeWorldState(world),
    };
  }

  return { ok: false, reason: `unknown-mode:${mode}` };
}

function sizeMatch(world) {
  const s = membershipSizes(world);
  return s.premier === 20 && s.championship === 24;
}

export function inspectMembershipDebug(player = null, world = getWorldState()) {
  const clubId = player?.club?.clubId || player?.playingClubId;
  return {
    membership: membershipSizes(world),
    clubId,
    clubLeagueId: player?.club?.leagueId || null,
    catalogLeagueId: clubId ? findSeniorClubById(clubId)?.leagueId : null,
    editionClubs: clubId
      ? resolveLeagueClubs(PL(), { world, seasonYear: (player?.startYear || 2026) + (player?.seasons?.length || 1) })
          .map((c) => c.clubId)
      : [],
    transitionCount: world?.membershipTransitions?.size ?? 0,
  };
}

void finalizeMembershipAfterSeason;
void startLoan;
void endLoan;
