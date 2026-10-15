/**
 * Deterministic live-browser loan fixture.
 * Builds a senior prospect through the production season pipeline so the
 * mid-season manager review yields a genuine development-loan decision with
 * validated loan offers (sporting + finance + registration).
 */
import { LEAGUES, LEAGUE_LOOKUP, LEAGUE_BY_ID } from "../data/leagues.js";
import { createPlayerIdentity } from "./playerDevelopment.js";
import { simulateSeason } from "./seasonSimulator.js?v=85";
import { createWorldState, setWorldState } from "./worldState.js";
import { resetClubFinanceLedgers } from "./clubFinance.js";
import { reseedCareerRng } from "./rng.js";
import { ensureTransferSave } from "./transferMigration.js";

export const LIVE_LOAN_FIXTURE = {
  careerId: "live-loan-fixture-v1",
  seed: 42,
  leagueId: "league:italy-serie-a",
  clubIndex: 0,
  name: "Loan Fixture",
  nationality: "Italy",
  position: "CM",
  age: 19,
  rating: 62,
  potential: 84,
  weeklyWage: 4000,
  contractYears: 4,
  startYear: 2026,
};

/**
 * @returns {{ ok: boolean, player: object, decision: object|null, offers: object[], checkpoint: object|null, reason?: string }}
 */
export function buildLiveLoanBrowserFixture(opts = {}) {
  const cfg = { ...LIVE_LOAN_FIXTURE, ...opts };
  resetClubFinanceLedgers();
  reseedCareerRng(cfg.seed);
  setWorldState(createWorldState({ startYear: cfg.startYear }));

  const league = LEAGUE_BY_ID.get(cfg.leagueId);
  if (!league) return { ok: false, reason: "league-missing", player: null, decision: null, offers: [], checkpoint: null };
  const club = league.clubs[cfg.clubIndex ?? 0];
  const player = createPlayerIdentity({
    name: cfg.name,
    nationality: cfg.nationality,
    position: cfg.position,
    age: cfg.age,
  });
  player.startYear = cfg.startYear;
  player.rating = cfg.rating;
  player.potential = cfg.potential;
  player.attributes = {
    Speed: cfg.rating,
    Passing: cfg.rating + 2,
    Shooting: cfg.rating - 4,
    Defending: cfg.rating - 2,
    Physicality: cfg.rating,
    Dribbling: cfg.rating + 1,
  };
  player.playerModelVersion = 2;
  player.state = { form: 0, morale: 0, readiness: 1, fatigue: 0, adaptationPenalty: 0, roleFit: 1 };
  player.health = { activeInjury: null, injuryHistory: [], durableDamage: {}, recoverableDamage: {} };
  player.development = { latentBudget: cfg.potential + 2, modelVersion: 1, migration: {} };
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
  player.contractYears = cfg.contractYears;
  player.contractEndSeason = cfg.contractYears;
  player.weeklyWage = cfg.weeklyWage;
  player.careerId = cfg.careerId;
  player.seasons = [];
  player.pendingOffers = [];
  player.pendingDecision = null;
  player.seasonCheckpoint = null;
  player.decisionCooldowns = {};

  let seasonData = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: true,
    autoDecisionPolicy: null,
  });

  // Skip senior-scene pauses so the fixture reliably reaches the winter squad window.
  let sceneGuards = 0;
  while (seasonData?.awaitingScenario && sceneGuards < 12) {
    sceneGuards += 1;
    player.pendingSeniorScenario = null;
    if (seasonData.checkpoint) seasonData.checkpoint.pendingSeniorScenario = null;
    player.seasonCheckpoint = seasonData.checkpoint;
    seasonData = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions: true,
      autoDecisionPolicy: null,
      checkpoint: seasonData.checkpoint,
    });
  }

  if (!seasonData?.awaitingDecision) {
    return {
      ok: false,
      reason: seasonData?.awaitingScenario ? "stuck-on-scenario" : "no-mid-season-pause",
      player,
      decision: null,
      offers: [],
      checkpoint: seasonData?.checkpoint || null,
    };
  }

  player.seasonCheckpoint = seasonData.checkpoint;
  player.pendingDecision = seasonData.decision || null;
  player.pendingOffers = seasonData.offers || [];
  ensureTransferSave(player);

  const decision = player.pendingDecision;
  const loanCount = decision?.loanOffers?.length || 0;
  if (decision?.kind !== "development-loan" && decision?.kind !== "surplus") {
    return {
      ok: false,
      reason: `unexpected-decision:${decision?.kind || "none"}`,
      player,
      decision,
      offers: player.pendingOffers,
      checkpoint: player.seasonCheckpoint,
    };
  }
  if (loanCount < 1) {
    return {
      ok: false,
      reason: "no-validated-loan-offers",
      player,
      decision,
      offers: player.pendingOffers,
      checkpoint: player.seasonCheckpoint,
    };
  }

  return {
    ok: true,
    player,
    decision,
    offers: decision.loanOffers || [],
    checkpoint: player.seasonCheckpoint,
    partialPlayerMatchStats: seasonData.partialPlayerMatchStats || null,
  };
}
