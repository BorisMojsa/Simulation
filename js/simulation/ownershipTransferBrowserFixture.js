/**
 * Deterministic Arsenal → mid-season permanent-move review for ownership QA.
 * Pauses at the January squad window with a validated Brentford permanent offer.
 */
import { LEAGUES, LEAGUE_LOOKUP, LEAGUE_BY_ID } from "../data/leagues.js";
import { createPlayerIdentity } from "./playerDevelopment.js";
import { simulateSeason } from "./seasonSimulator.js";
import { createWorldState, setWorldState, getWorldState } from "./worldState.js";
import { resetClubFinanceLedgers } from "./clubFinance.js";
import { reseedCareerRng } from "./rng.js";
import { resolveMoveRegistration } from "./destinationSchedule.js";
import { allSeniorClubs } from "./seniorClubs.js";
import { ensurePlayingStints } from "./playingRegistration.js";
import { commitCompletedDomesticEdition } from "./earnedQualification.js";
import { qualificationForPosition, findSisterLeagues } from "./leaguePhase.js";
import { prepareContinentalEdition } from "./continentalTournament.js";

export const OWNERSHIP_TRANSFER_FIXTURE = {
  careerId: "ownership-transfer-fixture-v1",
  seed: 42,
  startYear: 2026,
};

export function buildOwnershipTransferBrowserFixture(opts = {}) {
  const cfg = { ...OWNERSHIP_TRANSFER_FIXTURE, ...opts };
  resetClubFinanceLedgers();
  reseedCareerRng(cfg.seed);
  setWorldState(createWorldState({ startYear: cfg.startYear }));

  const league = LEAGUE_BY_ID.get(cfg.leagueId || "league:england-premier-league");
  const fromClubId = cfg.fromClubId || "club:england:arsenal";
  const toClubId = cfg.toClubId || "club:england:brentford";
  const fromClub =
    league?.clubs?.find((c) => c.clubId === fromClubId) ||
    allSeniorClubs().find((c) => c.clubId === fromClubId);
  const toClub = allSeniorClubs().find((c) => c.clubId === toClubId);
  if (!league || !fromClub || !toClub) {
    return { ok: false, reason: "clubs-missing", player: null, offers: [], checkpoint: null };
  }
  const arsenal = fromClub;
  const brentford = toClub;

  const player = createPlayerIdentity({
    name: "Ownership Transfer",
    nationality: fromClub.nation || "England",
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
    ...arsenal,
    league: league.name,
    leagueDisplay: league.displayName,
    leagueId: league.leagueId,
    nation: league.nation,
    isAcademy: false,
    parentClub: null,
  };
  player.employmentClubId = arsenal.clubId;
  player.playingClubId = arsenal.clubId;
  player.contractStartSeason = 0;
  player.contractYears = 4;
  player.contractEndSeason = 4;
  player.weeklyWage = 4000;
  player.careerId = cfg.careerId;
  player.seasons = [];
  player.pendingOffers = [];
  player.pendingDecision = null;
  player.seasonCheckpoint = null;
  player.decisionCooldowns = {};
  ensurePlayingStints(player, { asOfDate: `${cfg.startYear}-07-01` });

  // Seed earned places BEFORE any season simulation / continental draw.
  // Default: origin club first (CL). Callers may pass `placements` and/or
  // `extraDomesticTables` so reverse/cross loans start with the correct registry.
  {
    const sisters = findSisterLeagues(league, LEAGUES);
    const placements = cfg.placements || { 1: arsenal.clubId };
    const placed = new Map(Object.entries(placements).map(([pos, id]) => [Number(pos), id]));
    const preferred = [
      ...[...placed.entries()].sort((a, b) => a[0] - b[0]).map(([, id]) => id),
      "club:england:crystal-palace",
      "club:england:everton",
      "club:england:leeds-united",
      "club:england:liverpool",
    ].filter((id, i, arr) => id && arr.indexOf(id) === i);
    const rest = league.clubs.filter((c) => !preferred.includes(c.clubId));
    const ordered = Array.from({ length: league.clubs.length }, () => null);
    for (const [pos, clubId] of placed) {
      const club = league.clubs.find((c) => c.clubId === clubId);
      if (club && pos >= 1 && pos <= ordered.length) ordered[pos - 1] = club;
    }
    let r = 0;
    const fill = [
      ...preferred.map((id) => league.clubs.find((c) => c.clubId === id)).filter(Boolean),
      ...rest,
    ].filter((c) => !ordered.some((o) => o?.clubId === c.clubId));
    for (let i = 0; i < ordered.length; i++) if (!ordered[i]) ordered[i] = fill[r++];
    const table = ordered.map((c, i) => ({
      ...c,
      position: i + 1,
      points: Math.max(0, 100 - i * 3),
      matches: 38,
      wins: 20,
      draws: 8,
      losses: 10,
      qualification: qualificationForPosition(i + 1, league, sisters) || "",
    }));
    commitCompletedDomesticEdition({
      world: getWorldState(),
      league,
      table,
      sourceYear: cfg.startYear - 1,
      forceReplace: true,
    });
    for (const extra of cfg.extraDomesticTables || []) {
      if (!extra?.league?.clubs?.length) continue;
      const exSisters = findSisterLeagues(extra.league, LEAGUES);
      const exPlaced = new Map(
        Object.entries(extra.placements || {}).map(([pos, id]) => [Number(pos), id])
      );
      const exOrdered = Array.from({ length: extra.league.clubs.length }, () => null);
      for (const [pos, clubId] of exPlaced) {
        const club = extra.league.clubs.find((c) => c.clubId === clubId);
        if (club && pos >= 1 && pos <= exOrdered.length) exOrdered[pos - 1] = club;
      }
      let er = 0;
      const exFill = extra.league.clubs.filter((c) => !exOrdered.some((o) => o?.clubId === c.clubId));
      for (let i = 0; i < exOrdered.length; i++) if (!exOrdered[i]) exOrdered[i] = exFill[er++];
      const exTable = exOrdered.map((c, i) => ({
        ...c,
        position: i + 1,
        points: Math.max(0, 100 - i * 3),
        matches: 38,
        wins: 20,
        draws: 8,
        losses: 10,
        qualification: qualificationForPosition(i + 1, extra.league, exSisters) || "",
      }));
      commitCompletedDomesticEdition({
        world: getWorldState(),
        league: extra.league,
        table: exTable,
        sourceYear: extra.sourceYear ?? cfg.startYear - 1,
        forceReplace: true,
      });
    }
  }

  // Optionally freeze the destination borrower's earned continental edition into the
  // world before the origin club's season runs (DNQ origins never prepare Europe).
  if (cfg.seedDestinationEdition) {
    const destLeague =
      LEAGUE_BY_ID.get(brentford.leagueId) ||
      LEAGUES.find((l) => (l.clubs || []).some((c) => c.clubId === brentford.clubId)) ||
      league;
    const ghost = {
      ...player,
      club: {
        ...brentford,
        league: destLeague.name,
        leagueId: destLeague.leagueId,
        nation: destLeague.nation,
      },
      playingClubId: brentford.clubId,
      employmentClubId: brentford.clubId,
    };
    prepareContinentalEdition({
      standing: { position: 1, qualification: "League Champions" },
      league: destLeague,
      player: ghost,
      seasonYear: cfg.startYear,
      world: getWorldState(),
    });
  }

  let seasonData = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: true,
    autoDecisionPolicy: null,
  });
  let sceneGuards = 0;
  while (seasonData?.awaitingScenario && sceneGuards < 12) {
    sceneGuards += 1;
    player.pendingSeniorScenario = null;
    if (seasonData.checkpoint) seasonData.checkpoint.pendingSeniorScenario = null;
    player.seasonCheckpoint = seasonData.checkpoint;
    seasonData = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions: true,
      autoDecisionPolicy: null,
    });
  }
  if (!seasonData?.awaitingDecision && seasonData?.status !== "awaiting_decision") {
    return { ok: false, reason: "no-decision-pause", player, offers: [], checkpoint: null };
  }

  const ck = seasonData.checkpoint || player.seasonCheckpoint;
  // Controlled Brentford offer for ownership QA. Fee is set inside Brentford's
  // affordability band so production acceptPipelineOffer can book it without
  // requiring a negotiated seller/buyer overlap (Arsenal reservation can exceed it).
  const registration = resolveMoveRegistration({
    destinationLeagueId: brentford.leagueId,
    departureDate: ck.lastDate,
    originSeasonStartYear: cfg.startYear,
  });
  const asLoan = cfg.dealType === "loan" || cfg.isLoan === true;
  const offer = {
    offerId: `ownership-transfer:${asLoan ? "loan" : "permanent"}:${brentford.clubId}:${ck.lastDate}`,
    club: brentford.name,
    clubDisplay: brentford.displayName,
    clubId: brentford.clubId,
    league: brentford.league,
    leagueDisplay: brentford.leagueDisplay,
    leagueId: brentford.leagueId,
    nation: brentford.nation,
    tier: brentford.tier,
    divisionLevel: brentford.divisionLevel,
    badge: brentford.badge,
    financialTier: brentford.financialTier,
    reputation: brentford.reputation,
    overall: brentford.overall,
    attack: brentford.attack,
    midfield: brentford.midfield,
    defence: brentford.defence,
    goalkeeper: brentford.goalkeeper,
    strengthTier: brentford.strengthTier,
    dealType: asLoan ? "loan" : "permanent",
    isLoan: asLoan,
    isRenewal: false,
    isFreeAgent: false,
    transferFee: asLoan ? 0 : 12_000_000,
    wage: asLoan ? 3500 : 6000,
    contractYears: asLoan ? 1 : 3,
    expectedRole: asLoan ? "rotation" : "starter",
    reviewDate: ck.lastDate,
    effectiveDate: ck.lastDate,
    registration,
    status: "pending",
    careerId: player.careerId,
  };
  if (asLoan) {
    const endSeason = Math.min(
      player.contractEndSeason ?? 1,
      (player.seasons?.length ?? 0) + 1
    );
    offer.loanTerms = {
      loanId: `loan:fix09:${arsenal.clubId}:${brentford.clubId}:${ck.lastDate}`,
      parentClubId: arsenal.clubId,
      parentClubName: arsenal.name,
      borrowingClubId: brentford.clubId,
      startSeason: player.seasons?.length ?? 0,
      endSeason,
      startDate: ck.lastDate,
      endDate: `${Number(cfg.startYear) + 1}-05-31`,
      borrowerWageShare: 0.5,
      parentWageShare: 0.5,
      loanFee: 0,
      status: "proposed",
      agreedGrossWeekly: offer.wage,
      international: false,
      recallClause: false,
      purchaseOption: null,
    };
  }

  player.pendingOffers = [offer];
  player.pendingDecision = null;
  player.seasonCheckpoint = ck;
  ck.status = "awaiting_decision";
  ck.playingClubIdAtPause = arsenal.clubId;
  ck.offers = [offer];
  ck.decision = null;

  return {
    ok: true,
    player,
    decision: null,
    offers: [offer],
    checkpoint: ck,
    fromClubId: arsenal.clubId,
    toClubId: brentford.clubId,
    dealType: offer.dealType,
  };
}
