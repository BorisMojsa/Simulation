/**
 * Deterministic Fix 03 league-membership browser fixtures.
 * Modes set up real careers for production simulateSeason / Continue flows,
 * or apply committed-fixture pair finalization (never fabricated standings).
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
import {
  finalizeMembershipAfterSeason,
  resolveLeagueClubs,
  resolveLeagueClubIds,
  commitForcedEditionResults,
  pairPolicyForLeague,
  leagueIdOf,
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

function orderWithClubAt(clubIds, clubId, position) {
  const others = clubIds.filter((id) => id !== clubId);
  const ordered = [];
  let oi = 0;
  for (let pos = 1; pos <= clubIds.length; pos++) {
    ordered.push(pos === position ? clubId : others[oi++]);
  }
  return ordered;
}

/** Commit full DRR fixtures for both pair divisions, then production finalize. */
function controlledBoundary({ player, league, position, world, seasonYear = 2026 }) {
  const clubId = player.club?.clubId || player.playingClubId;
  const policy = pairPolicyForLeague(leagueIdOf(league));
  if (!policy) return { ok: false, reason: "no-pair" };
  const upper = LEAGUE_BY_ID.get(policy.upperId);
  const lower = LEAGUE_BY_ID.get(policy.lowerId);
  const focusIds = resolveLeagueClubIds(leagueIdOf(league), { world, seasonYear: null });
  const orderedFocus = orderWithClubAt(focusIds, clubId, position);
  const forcedFocus = commitForcedEditionResults(league, seasonYear, orderedFocus, world);
  if (!forcedFocus.ok) return forcedFocus;
  const sister = policy.role === "upper" ? lower : upper;
  const sisterIds = resolveLeagueClubIds(leagueIdOf(sister), { world, seasonYear: null });
  const forcedSister = commitForcedEditionResults(sister, seasonYear, sisterIds, world);
  if (!forcedSister.ok) return forcedSister;
  return finalizeMembershipAfterSeason({
    player,
    completedLeague: league,
    completedTable: null,
    completedSeasonYear: seasonYear,
    allLeagues: LEAGUES,
    world,
    completedClubId: clubId,
  });
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
    const strong = id === targetId;
    const v = high ? (strong ? 94 : 48) : strong ? 40 : 90;
    profile.overall = v;
    profile.attack = v;
    profile.midfield = v;
    profile.defence = v;
    profile.goalkeeper = Math.max(38, v - 2);
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
    transitionKeys: [...(world.membershipTransitions?.keys?.() || [])],
    fixtureCounts: {
      pl2026: [...(world.matches?.values?.() || [])].filter(
        (m) =>
          (m.competitionId || m.leagueContextId) === PL().leagueId &&
          (String(m.editionId) === "2026" || m.seasonYear === 2026) &&
          m.status === "played"
      ).length,
      ch2026: [...(world.matches?.values?.() || [])].filter(
        (m) =>
          (m.competitionId || m.leagueContextId) === CH().leagueId &&
          (String(m.editionId) === "2026" || m.seasonYear === 2026) &&
          m.status === "played"
      ).length,
    },
  };
}

function nextEditionStats(player, league, seasonIndex) {
  const next = simulateChronologicalSeason({
    player,
    league,
    seasonIndex,
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  return {
    status: next.status,
    tableRows: next.table?.length ?? 0,
    fixtures: next.allMatches?.length ?? 0,
    clubFixtures: next.playerMatches?.length ?? 0,
    expectedMatches: next.expectedMatches,
    participantIds: (next.table || []).map((r) => r.clubId),
    checkpoint: next.checkpoint || player.seasonCheckpoint,
  };
}

/**
 * @param {{ mode?: string, seed?: number }} opts
 */
export function buildMembershipBrowserFixture(opts = {}) {
  const mode = opts.mode || "promotion";
  const cfg = { ...MEMBERSHIP_FIXTURE, ...opts, mode };
  resetClubFinanceLedgers();
  reseedCareerRng(cfg.seed);
  const world = createWorldState({ seed: cfg.seed, startYear: cfg.startYear });
  setWorldState(world);

  // Finished first season via production simulateSeason; checklist clicks Simulate for next edition.
  if (mode === "ui-promotion-ready") {
    const built = makePlayer(CH(), "Birmingham City", cfg);
    if (!built) return { ok: false, reason: "birmingham-missing" };
    const { player, club } = built;
    biasClub(world, CH().leagueId, club.clubId, true);
    const done = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions: false,
      autoDecisionPolicy: "stay",
    });
    if (!done?.season) return { ok: false, reason: "ch-season-incomplete" };
    if (!world.leagueMemberships.get(PL().leagueId).includes(club.clubId)) {
      const boundary = controlledBoundary({
        player,
        league: CH(),
        position: 2,
        world,
        seasonYear: cfg.startYear,
      });
      if (!boundary.ok && !boundary.alreadyApplied) {
        return { ok: false, reason: boundary.reason || "promotion-failed", evidence: evidenceFromWorld(world, club.clubId) };
      }
    }
    player.pendingOffers = [];
    player.pendingDecision = null;
    player.pendingSeniorScenario = null;
    player.seasonCheckpoint = null;
    player.simRevealCursor = null;
    return {
      ok: true,
      mode,
      player,
      clubId: club.clubId,
      evidence: evidenceFromWorld(world, club.clubId),
      expect: { promotedClubId: club.clubId, nextLeagueId: PL().leagueId },
      worldSerialized: serializeWorldState(world),
    };
  }

  if (mode === "ui-relegation-ready") {
    const built = makePlayer(PL(), "Ipswich Town", cfg);
    if (!built) return { ok: false, reason: "ipswich-missing" };
    const { player, club } = built;
    biasClub(world, PL().leagueId, club.clubId, false);
    const done = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions: false,
      autoDecisionPolicy: "stay",
    });
    if (!done?.season) return { ok: false, reason: "pl-season-incomplete" };
    if (!world.leagueMemberships.get(CH().leagueId).includes(club.clubId)) {
      const boundary = controlledBoundary({
        player,
        league: PL(),
        position: 20,
        world,
        seasonYear: cfg.startYear,
      });
      if (!boundary.ok && !boundary.alreadyApplied) {
        return { ok: false, reason: boundary.reason || "relegation-failed", evidence: evidenceFromWorld(world, club.clubId) };
      }
    }
    player.pendingOffers = [];
    player.pendingDecision = null;
    player.pendingSeniorScenario = null;
    player.seasonCheckpoint = null;
    player.simRevealCursor = null;
    return {
      ok: true,
      mode,
      player,
      clubId: club.clubId,
      evidence: evidenceFromWorld(world, club.clubId),
      expect: { relegatedClubId: club.clubId, nextLeagueId: CH().leagueId },
      worldSerialized: serializeWorldState(world),
    };
  }

  if (mode === "ui-loan-return-ready") {
    // Loan starts before parent moves. Finish borrower season via production simulateSeason,
    // force parent relegation if bias misses, then leave career ready for UI next-season return.
    const built = makePlayer(PL(), "Ipswich Town", cfg);
    if (!built) return { ok: false, reason: "ipswich-missing" };
    const { player, club } = built;
    const borrower = findSeniorClubById(CH().clubs[0].clubId);
    const accepted = startLoan(player, {
      isLoan: true,
      wage: 4000,
      expectedRole: "starter",
      clubId: borrower.clubId,
      club: borrower,
      loanTerms: {
        loanId: "fix03-browser-moving-parent",
        borrowingClubId: borrower.clubId,
        parentClubId: club.clubId,
        borrowerWageShare: 0.5,
        parentWageShare: 0.5,
        loanFee: 0,
        endSeason: 1,
        startDate: `${cfg.startYear}-07-15`,
      },
    });
    if (!accepted.ok) return { ok: false, reason: accepted.reason || "loan-failed" };
    biasClub(world, CH().leagueId, borrower.clubId, true);
    biasClub(world, PL().leagueId, club.clubId, false);
    const done = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions: false,
      autoDecisionPolicy: "stay",
    });
    if (!done?.season) return { ok: false, reason: "borrower-season-incomplete" };
    if (!world.leagueMemberships.get(CH().leagueId).includes(club.clubId)) {
      const plIds = world.leagueEditionRosters.get(`${PL().leagueId}::${cfg.startYear}`)?.clubIds;
      const chIds = world.leagueEditionRosters.get(`${CH().leagueId}::${cfg.startYear}`)?.clubIds;
      if (!plIds || !chIds) return { ok: false, reason: "missing-edition-freeze" };
      const orderedPl = [...plIds.filter((id) => id !== club.clubId), club.clubId];
      commitForcedEditionResults(PL(), cfg.startYear, orderedPl, world);
      commitForcedEditionResults(CH(), cfg.startYear, chIds, world);
      const fin = finalizeMembershipAfterSeason({
        completedLeague: PL(),
        completedSeasonYear: cfg.startYear,
        world,
        completedClubId: club.clubId,
      });
      if (!fin.ok && !fin.alreadyApplied) {
        return { ok: false, reason: fin.reason || "parent-relegation-failed" };
      }
    }
    player.pendingOffers = [];
    player.pendingDecision = null;
    player.pendingSeniorScenario = null;
    player.seasonCheckpoint = null;
    player.simRevealCursor = null;
    return {
      ok: true,
      mode,
      player,
      clubId: club.clubId,
      borrowerId: borrower.clubId,
      evidence: evidenceFromWorld(world, club.clubId),
      loan: {
        ok: accepted.ok,
        parentSnapshotLeagueId: player.parentClubSnapshot?.leagueId,
        playingClubId: player.playingClubId,
        employmentClubId: player.employmentClubId,
        parentWorldLeagueId:
          world.clubs.get(club.clubId)?.leagueId ||
          ((world.leagueMemberships.get(CH().leagueId) || []).includes(club.clubId)
            ? CH().leagueId
            : PL().leagueId),
        seasonsCompleted: player.seasons?.length || 0,
        loanStillActive: player.activeLoan?.status === "active",
        canSimulateNext: true,
      },
      expect: {
        afterReturnLeagueId: CH().leagueId,
        parentMustRelegate: true,
      },
      worldSerialized: serializeWorldState(world),
    };
  }

  if (mode === "promotion" || mode === "next-pause" || mode === "offer-loan" || mode === "snapshot") {
    const built = makePlayer(CH(), "Birmingham City", cfg);
    if (!built) return { ok: false, reason: "birmingham-missing" };
    const { player, club } = built;
    const boundary = controlledBoundary({
      player,
      league: CH(),
      position: 2,
      world,
      seasonYear: cfg.startYear,
    });
    if (!boundary.ok) {
      return { ok: false, reason: boundary.reason || "promotion-failed", boundary, evidence: evidenceFromWorld(world, club.clubId) };
    }
    // Record a completed season so Continue / next edition is valid.
    player.seasons = [
      {
        seasonNumber: 1,
        year: cfg.startYear,
        club: club.name,
        clubId: club.clubId,
        league: CH().displayName,
        leagueId: CH().leagueId,
        divisionMove: boundary.playerMove,
        honors: boundary.playerMove ? ["Promoted"] : [],
      },
    ];
    if (boundary.playerMove?.league) {
      player.club = {
        ...player.club,
        ...boundary.playerMove.league,
        leagueId: boundary.playerMove.league.leagueId || PL().leagueId,
        league: boundary.playerMove.league.name || PL().name,
        leagueDisplay: boundary.playerMove.league.displayName || PL().displayName,
      };
    }

    const dest = buildDestinationLeagueSchedule(PL(), cfg.startYear + 1, world);
    let next = null;
    let checkpoint = null;
    if (mode === "next-pause") {
      next = simulateChronologicalSeason({
        player,
        league: PL(),
        seasonIndex: 1,
        pauseForDecisions: true,
        autoDecisionPolicy: null,
      });
      checkpoint = next.checkpoint || player.seasonCheckpoint;
      player.seasonCheckpoint = checkpoint;
    } else if (mode !== "offer-loan") {
      next = nextEditionStats(player, PL(), 1);
    }

    let snapshot = null;
    let snapshotCompare = null;
    if (mode === "snapshot") {
      const snapPayload = roundTripCareerSnapshot({
        player,
        world,
        checkpoint: player.seasonCheckpoint,
      });
      snapshot = snapPayload;
      const restoredSizes = membershipSizes(snapPayload.world);
      snapshotCompare = {
        transitionKeys: [...(snapPayload.world.membershipTransitions?.keys?.() || [])],
        membership: restoredSizes,
        seasonsCount: snapPayload.player?.seasons?.length ?? 0,
        clubId: snapPayload.player?.club?.clubId,
        leagueId: snapPayload.player?.club?.leagueId,
        participantIds: resolveLeagueClubs(PL(), {
          world: snapPayload.world,
          seasonYear: cfg.startYear + 1,
        }).map((c) => c.clubId),
      };
    }

    let offerMeta = null;
    if (mode === "offer-loan") {
      // Permanent free-agent move onto the promoted club, then a short loan out/return.
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
      let applied = null;
      if (builtOffer.ok) applied = applyOfferToPlayer(buyer, builtOffer.offer, "fix03-browser-offer");
      const borrowerId = (world.leagueMemberships.get(CH().leagueId) || []).find((id) => id !== club.clubId);
      const borrower = findSeniorClubById(borrowerId);
      let loanOk = false;
      let returnOk = false;
      let returnLeagueId = null;
      if (applied?.ok !== false && buyer.club?.clubId === club.clubId && borrower) {
        const loaned = startLoan(buyer, {
          isLoan: true,
          wage: 3500,
          expectedRole: "starter",
          clubId: borrower.clubId,
          club: borrower,
          loanTerms: {
            loanId: "fix03-browser-loan",
            borrowingClubId: borrower.clubId,
            parentClubId: club.clubId,
            borrowerWageShare: 0.5,
            parentWageShare: 0.5,
            loanFee: 0,
            endSeason: 1,
            startDate: `${cfg.startYear + 1}-07-15`,
          },
        });
        loanOk = Boolean(loaned.ok);
        if (loanOk) {
          const ended = endLoan(buyer, { effectiveDate: `${cfg.startYear + 2}-06-30` });
          returnOk = Boolean(ended.ok);
          returnLeagueId = buyer.club?.leagueId || null;
        }
      }
      offerMeta = {
        offerOk: Boolean(builtOffer.ok),
        appliedOk: applied?.ok !== false,
        buyerClubId: buyer.club?.clubId || null,
        buyerLeagueId: buyer.club?.leagueId || null,
        destFixtures: dest.dated.filter((f) =>
          [f.home?.clubId, f.away?.clubId].includes(club.clubId)
        ).length,
        catalogLeagueId: allSeniorClubs(world).find((c) => c.clubId === club.clubId)?.leagueId,
        loanOk,
        returnOk,
        returnLeagueId,
        parentLeagueId: PL().leagueId,
      };
      // Keep original promoted player as the active career for the dashboard.
      next = nextEditionStats(player, PL(), 1);
    }

    return {
      ok: true,
      mode,
      player,
      clubId: club.clubId,
      move: boundary.playerMove || null,
      evidence: evidenceFromWorld(world, club.clubId),
      next,
      destination: {
        clubs: dest.clubs.length,
        fixtures: dest.dated.length,
        clubFixtures: dest.dated.filter((f) =>
          [f.home?.clubId, f.away?.clubId].includes(club.clubId)
        ).length,
      },
      checkpoint,
      snapshotOk: snapshotCompare
        ? snapshotCompare.membership.premier === 20 && snapshotCompare.membership.championship === 24
        : null,
      snapshotCompare,
      offerMeta,
      worldSerialized: serializeWorldState(world),
    };
  }

  if (mode === "relegation") {
    const built = makePlayer(PL(), "Ipswich Town", cfg);
    if (!built) return { ok: false, reason: "ipswich-missing" };
    const { player, club } = built;
    const boundary = controlledBoundary({
      player,
      league: PL(),
      position: 20,
      world,
      seasonYear: cfg.startYear,
    });
    if (!boundary.ok) {
      return { ok: false, reason: boundary.reason || "relegation-failed", evidence: evidenceFromWorld(world, club.clubId) };
    }
    player.seasons = [
      {
        seasonNumber: 1,
        year: cfg.startYear,
        club: club.name,
        clubId: club.clubId,
        league: PL().displayName,
        leagueId: PL().leagueId,
        divisionMove: boundary.playerMove,
        honors: boundary.playerMove ? ["Relegated"] : [],
      },
    ];
    if (boundary.playerMove?.league) {
      player.club = {
        ...player.club,
        leagueId: boundary.playerMove.league.leagueId || CH().leagueId,
        league: boundary.playerMove.league.name || CH().name,
        leagueDisplay: boundary.playerMove.league.displayName || CH().displayName,
      };
    }
    const next = nextEditionStats(player, CH(), 1);
    const dest = buildDestinationLeagueSchedule(CH(), cfg.startYear + 1, world);
    return {
      ok: true,
      mode,
      player,
      clubId: club.clubId,
      move: boundary.playerMove || null,
      evidence: evidenceFromWorld(world, club.clubId),
      next,
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
    const boundary = controlledBoundary({
      player,
      league: CH(),
      position: 12,
      world,
      seasonYear: cfg.startYear,
    });
    const evidence = evidenceFromWorld(world, club.clubId);
    return {
      ok: true,
      mode,
      player,
      clubId: club.clubId,
      move: boundary.playerMove || null,
      evidence,
      zones: {
        promoteSlots: 3,
        relegateSlots: 3,
        playerMoved: Boolean(boundary.playerMove),
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

  if (mode === "fix01-continue") {
    // Free agent at season boundary after an empty offer window — continue career path.
    const built = makePlayer(CH(), "Birmingham City", cfg);
    if (!built) return { ok: false, reason: "birmingham-missing" };
    const { player } = built;
    player.club = null;
    player.employmentClubId = null;
    player.playingClubId = null;
    player.contractStatus = "expired";
    player.contractEndSeason = 0;
    player.pendingOffers = [];
    player.pendingDecision = null;
    ensurePlayingStints(player, { asOfDate: `${cfg.startYear}-07-01` });
    return {
      ok: true,
      mode,
      player,
      clubId: null,
      evidence: evidenceFromWorld(world, null),
      worldSerialized: serializeWorldState(world),
    };
  }

  return { ok: false, reason: `unknown-mode:${mode}` };
}

export function inspectMembershipDebug(player = null, world = getWorldState()) {
  const clubId = player?.club?.clubId || player?.playingClubId;
  const sizes = membershipSizes(world);
  const seasonYear = (player?.startYear || 2026) + Math.max(0, player?.seasons?.length || 0);
  return {
    membership: sizes,
    clubId,
    clubLeagueId: player?.club?.leagueId || null,
    catalogLeagueId: clubId ? findSeniorClubById(clubId)?.leagueId : null,
    editionClubs: clubId
      ? resolveLeagueClubs(PL(), { world, seasonYear }).map((c) => c.clubId)
      : [],
    transitionCount: world?.membershipTransitions?.size ?? 0,
    transitionKeys: [...(world?.membershipTransitions?.keys?.() || [])],
    seasonsCount: player?.seasons?.length ?? 0,
  };
}
