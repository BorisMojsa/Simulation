/**
 * Deterministic Fix 05 keeper browser fixture.
 * Completes a production season as GK so clean-sheet evidence and award inputs
 * are inspectable through the live career debug surface.
 */
import { LEAGUES, LEAGUE_LOOKUP, LEAGUE_BY_ID } from "../data/leagues.js";
import { createPlayerIdentity } from "./playerDevelopment.js";
import { simulateSeason } from "./seasonSimulator.js";
import { createWorldState, setWorldState } from "./worldState.js";
import { resetClubFinanceLedgers } from "./clubFinance.js";
import { reseedCareerRng, createRng } from "./rng.js";
import { ensurePlayingStints } from "./playingRegistration.js";
import { initializePlayerDevelopment } from "./playerDevelopmentModel.js";

export const MATCH_PARTICIPATION_GK_FIXTURE = {
  careerId: "fix05-gk-browser-v1",
  seed: 42,
  startYear: 2026,
};

export function buildMatchParticipationGkBrowserFixture(opts = {}) {
  const cfg = { ...MATCH_PARTICIPATION_GK_FIXTURE, ...opts };
  resetClubFinanceLedgers();
  reseedCareerRng(cfg.seed);
  setWorldState(createWorldState({ startYear: cfg.startYear }));

  const league = LEAGUE_BY_ID.get("league:england-premier-league");
  const club = league.clubs.find((c) => c.clubId === "club:england:arsenal");
  if (!club) return { ok: false, reason: "club-missing" };

  const player = createPlayerIdentity({
    name: "Fix05 Keeper",
    nationality: "England",
    position: "GK",
    age: 20,
  });
  player.startYear = cfg.startYear;
  player.careerId = cfg.careerId;
  player.rating = 76;
  player.potential = 86;
  player.attributes = {
    Speed: 60,
    Passing: 68,
    Shooting: 40,
    Defending: 78,
    Physicality: 74,
    Dribbling: 50,
    Handling: 78,
    Reflexes: 80,
    Positioning: 76,
  };
  player.playerModelVersion = 2;
  player.state = { form: 0, morale: 0, readiness: 1, fatigue: 0, adaptationPenalty: 0, roleFit: 1 };
  player.health = { activeInjury: null, injuryHistory: [], durableDamage: {}, recoverableDamage: {} };
  player.development = { latentBudget: 88, modelVersion: 1, migration: {} };
  player.club = {
    ...club,
    league: league.name,
    leagueDisplay: league.displayName,
    leagueId: league.leagueId,
    nation: league.nation,
    isAcademy: false,
  };
  player.employmentClubId = club.clubId;
  player.playingClubId = club.clubId;
  player.contractStartSeason = 0;
  player.contractYears = 4;
  player.contractEndSeason = 4;
  player.weeklyWage = 18000;
  player.seasons = [];
  player.autoDecisionPolicy = "stay";
  initializePlayerDevelopment(player, {
    rng: createRng(cfg.seed),
    careerId: player.careerId,
    budget: 99,
    potential: player.potential,
  });
  ensurePlayingStints(player, { asOfDate: `${cfg.startYear}-07-01` });
  setWorldState(createWorldState(player));

  const result = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  const season = result?.season || player.seasons?.[player.seasons.length - 1] || null;
  if (!season) return { ok: false, reason: "season-missing", player, result };
  const evidence = season.seasonEvidence || null;
  const leagueCs = evidence?.byScope?.league?.cleanSheets;
  const minutes = Number(season.minutes) || 0;
  if (!(minutes > 0)) return { ok: false, reason: "no-keeper-minutes", player, season };

  player.__qaGkFixture = {
    position: player.position,
    minutes,
    cleanSheets: season.cleanSheets ?? null,
    evidenceLeagueCleanSheets: leagueCs ?? null,
    evidenceByScope: evidence?.byScope || null,
    awardFieldKeys: Object.keys(player.awardFields || {}),
    goldenGlove: (season.awardRecords || []).find((r) => r.awardId === "golden-glove") || null,
  };

  return {
    ok: true,
    player,
    season,
    evidence,
    result,
  };
}
