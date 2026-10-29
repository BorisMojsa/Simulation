/**
 * Deterministic Fix 05 KO browser fixture.
 * Builds production ET and penalty matches (plus a zero-minute companion) so the
 * live dashboard can play them through normal Skip/Continue controls.
 */
import { LEAGUE_BY_ID } from "../data/leagues.js";
import { createRng } from "./rng.js";
import {
  simulateMatch,
  resolveKnockout,
  finalizePlayerMatchStats,
} from "./matchEngine.js";
import { createPlayerIdentity } from "./playerDevelopment.js";
import { createWorldState, setWorldState } from "./worldState.js";
import { reseedCareerRng } from "./rng.js";
import { ensurePlayingStints } from "./playingRegistration.js";
import { initializePlayerDevelopment } from "./playerDevelopmentModel.js";

export const MATCH_PARTICIPATION_KO_FIXTURE = {
  careerId: "fix05-ko-browser-v1",
  seed: 2,
  etSeed: 2,
  pensSeed: 2,
  startYear: 2026,
};

function findKoDraw(
  home,
  away,
  playerTemplate,
  { allowExtraTime = true, requireDecidedBy, seedStart = 1, limit = 800 } = {}
) {
  for (let seed = seedStart; seed <= seedStart + limit; seed++) {
    const player = {
      ...playerTemplate,
      matchParticipation: { ...(playerTemplate.matchParticipation || {}) },
    };
    const rng = createRng(seed);
    let match = simulateMatch(home, away, {
      player,
      playerSide: "home",
      playerMinutes: player.matchParticipation.minutes,
      matchDuration: 90,
      rng,
      fixtureId: `fix05-ko-${requireDecidedBy || "ko"}-${seed}`,
      competitionId: "cup:fix05-qa",
      date: "2026-11-15",
    });
    if (match.homeGoals !== match.awayGoals) continue;
    match = resolveKnockout(match, {
      player,
      rng,
      allowExtraTime,
      allowPenalties: true,
    });
    if (requireDecidedBy && match.decidedBy !== requireDecidedBy) continue;
    match.fixtureId = match.fixtureId || `fix05-ko-${match.decidedBy}-${seed}`;
    match.competition = "cup";
    match.competitionType = "domesticCup";
    match.competitionName = "Fix05 KO Cup";
    match.date = "2026-11-15";
    return { match, seed, player };
  }
  return null;
}

export function buildMatchParticipationKoBrowserFixture(opts = {}) {
  const cfg = { ...MATCH_PARTICIPATION_KO_FIXTURE, ...opts };
  reseedCareerRng(cfg.seed);
  setWorldState(createWorldState({ startYear: cfg.startYear }));

  const league = LEAGUE_BY_ID.get("league:england-premier-league");
  const home = league.clubs.find((c) => c.clubId === "club:england:arsenal");
  const away = league.clubs.find((c) => c.clubId === "club:england:brentford");
  if (!home || !away) return { ok: false, reason: "clubs-missing" };

  const player = createPlayerIdentity({
    name: "Fix05 KO",
    nationality: "England",
    position: "ST",
    age: 20,
  });
  player.startYear = cfg.startYear;
  player.careerId = cfg.careerId;
  player.rating = 85;
  player.potential = 90;
  player.attributes = {
    Speed: 85,
    Passing: 80,
    Shooting: 88,
    Defending: 40,
    Physicality: 82,
    Dribbling: 84,
  };
  player.playerModelVersion = 2;
  player.state = { form: 0, morale: 0, readiness: 1, fatigue: 0, adaptationPenalty: 0, roleFit: 1 };
  player.health = { activeInjury: null, injuryHistory: [], durableDamage: {}, recoverableDamage: {} };
  player.development = { latentBudget: 92, modelVersion: 1, migration: {} };
  player.club = {
    ...home,
    league: league.name,
    leagueDisplay: league.displayName,
    leagueId: league.leagueId,
    nation: league.nation,
    isAcademy: false,
  };
  player.employmentClubId = home.clubId;
  player.playingClubId = home.clubId;
  player.contractStartSeason = 0;
  player.contractYears = 4;
  player.contractEndSeason = 4;
  player.weeklyWage = 25000;
  player.seasons = [];
  initializePlayerDevelopment(player, { rng: createRng(cfg.seed), careerId: player.careerId, budget: 99 });
  ensurePlayingStints(player, { asOfDate: `${cfg.startYear}-07-01` });
  setWorldState(createWorldState(player));

  const template = {
    name: player.name,
    position: "ST",
    rating: 85,
    currentOverall: 85,
    currentOverallRaw: 85,
    matchParticipation: { minutes: 90, started: true, selected: true, matchDuration: 90 },
  };

  const et = findKoDraw(home, away, template, {
    allowExtraTime: true,
    seedStart: cfg.etSeed,
    requireDecidedBy: "extraTime",
  });
  // Penalties after ET (120′) — production knockout path, not regulation-only pens.
  const pens = findKoDraw(home, away, template, {
    allowExtraTime: true,
    seedStart: cfg.pensSeed,
    requireDecidedBy: "penalties",
  });
  if (!et || !pens) return { ok: false, reason: "ko-seeds-missing", et: Boolean(et), pens: Boolean(pens) };

  // Zero-minute companion on the same slate for unused-sub UI checks.
  const zeroPlayer = {
    ...template,
    matchParticipation: { minutes: 0, started: false, selected: true, matchDuration: 90 },
  };
  let zeroMatch = simulateMatch(home, away, {
    player: zeroPlayer,
    playerSide: "home",
    playerMinutes: 0,
    matchDuration: 90,
    rng: createRng(11),
    fixtureId: "fix05-ko-zero-11",
    competitionId: "cup:fix05-qa",
    date: "2026-11-08",
  });
  zeroMatch = finalizePlayerMatchStats(zeroMatch, zeroPlayer, createRng(11));
  zeroMatch.fixtureId = "fix05-ko-zero-11";
  zeroMatch.competition = "cup";
  zeroMatch.competitionType = "domesticCup";
  zeroMatch.competitionName = "Fix05 KO Cup";
  zeroMatch.date = "2026-11-08";
  zeroMatch.playerStats = {
    ...zeroMatch.playerStats,
    started: false,
    selected: true,
    available: true,
    nonParticipationReason: "unused_substitute",
    minutes: 0,
    played: false,
    rating: null,
  };

  const playerMatches = [zeroMatch, et.match, pens.match];
  const etMinutes = Number(et.match.playerStats.minutes) || 0;
  const pensMinutes = Number(pens.match.playerStats.minutes) || 0;
  const etGoals = Number(et.match.playerStats.goals) || 0;
  const pensGoals = Number(pens.match.playerStats.goals) || 0;
  const etAssists = Number(et.match.playerStats.assists) || 0;
  const pensAssists = Number(pens.match.playerStats.assists) || 0;
  const rated = [et.match.playerStats.rating, pens.match.playerStats.rating].filter(
    (r) => r != null && Number.isFinite(Number(r))
  );
  const avgMatchRating = rated.length
    ? rated.reduce((a, b) => a + Number(b), 0) / rated.length
    : 0;
  const seasonId = `fix05-ko-season-${cfg.startYear}`;
  const season = {
    seasonId,
    seasonNumber: 1,
    year: cfg.startYear,
    age: player.age,
    clubId: home.clubId,
    clubName: home.name,
    clubDisplay: home.displayName || home.name,
    league: league.name,
    leagueId: league.leagueId,
    matches: 2,
    appearances: 2,
    minutes: etMinutes + pensMinutes,
    goals: etGoals + pensGoals,
    assists: etAssists + pensAssists,
    cleanSheets: 0,
    yellowCards: 0,
    redCards: 0,
    avgMatchRating,
    // Present ET/pens once via the league dashboard slate in the completed-season
    // animation (avoid also replaying the same slate in domesticCupCampaigns).
    leagueMatches: playerMatches,
    leagueAllMatches: playerMatches,
    domesticCupCampaigns: [],
    seasonEvidence: {
      total: {
        minutes: etMinutes + pensMinutes,
        appearances: 2,
        goals: etGoals + pensGoals,
        assists: etAssists + pensAssists,
        cleanSheets: 0,
      },
      byScope: {
        cup: {
          minutes: etMinutes + pensMinutes,
          appearances: 2,
          goals: etGoals + pensGoals,
          assists: etAssists + pensAssists,
          cleanSheets: 0,
        },
        league: {
          minutes: 0,
          appearances: 0,
          goals: 0,
          assists: 0,
          cleanSheets: 0,
        },
      },
    },
  };
  player.seasons = [season];
  player.age = Number(player.age) + 1;

  const standings = {
    table: (league.clubs || []).map((c, i) => ({
      clubId: c.clubId,
      name: c.name,
      displayName: c.displayName || c.name,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      gf: 0,
      ga: 0,
      gd: 0,
      pts: 0,
      position: i + 1,
    })),
    playerRecord: null,
  };

  const seasonData = {
    season,
    league,
    standings,
    leagueAllMatches: playerMatches,
    leaguePlayerMatches: playerMatches,
    domesticCupCampaigns: [],
    individualAwards: [],
    attributeChanges: {},
    previousRating: player.rating,
    newRating: player.rating,
    performanceScore: 0.55,
    continueDashboard: false,
    revealedFixtureIds: [],
  };

  player.__qaKoFixture = {
    etFixtureId: et.match.fixtureId,
    pensFixtureId: pens.match.fixtureId,
    zeroFixtureId: zeroMatch.fixtureId,
    etDecidedBy: et.match.decidedBy,
    pensDecidedBy: pens.match.decidedBy,
    etMinutes,
    pensMinutes,
    zeroMinutes: 0,
    etRating: et.match.playerStats.rating,
    pensRating: pens.match.playerStats.rating,
    etGoals,
    pensGoals,
    etAssists,
    pensAssists,
    etSeed: et.seed,
    pensSeed: pens.seed,
    seasonId,
    savedMatches: playerMatches.map((m) => ({
      fixtureId: m.fixtureId,
      decidedBy: m.decidedBy || null,
      minutes: m.playerStats?.minutes ?? null,
      rating: m.playerStats?.rating ?? null,
      goals: m.playerStats?.goals ?? 0,
      assists: m.playerStats?.assists ?? 0,
      homeGoals: m.homeGoals,
      awayGoals: m.awayGoals,
      winnerSide: m.winnerSide || null,
    })),
  };

  return {
    ok: true,
    player,
    league,
    playerMatches,
    allMatches: playerMatches,
    season,
    seasonData,
    et: et.match,
    pens: pens.match,
    zero: zeroMatch,
  };
}
