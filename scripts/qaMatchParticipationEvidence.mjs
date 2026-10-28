/**
 * Fix 05 audit exporter: zero-minute, knockout, and chronological ledger/evidence cohorts.
 * Run from repo root: node scripts/qaMatchParticipationEvidence.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { LEAGUE_BY_ID } from "../js/data/leagues.js";
import { createRng, reseedCareerRng } from "../js/simulation/rng.js";
import {
  simulateMatch,
  resolveKnockout,
  countUserOpenPlayEvents,
} from "../js/simulation/matchEngine.js";
import {
  createEmptyLedger,
  recordMatchObservation,
  aggregateSeason,
} from "../js/simulation/playerSeasonLedger.js";
import { buildSeasonEvidence } from "../js/simulation/seasonEvidence.js";
import { simulateChronologicalSeason } from "../js/simulation/chronologicalSeason.js";
import {
  generateStartingAttributes,
  initializePlayerDevelopment,
} from "../js/simulation/playerDevelopmentModel.js";
import { ensurePlayingStints } from "../js/simulation/playingRegistration.js";
import { createWorldState, setWorldState } from "../js/simulation/worldState.js";
import { refreshAbilityCaches } from "../js/simulation/playerAbility.js";

const outDir = "qa/fix05-runs";
mkdirSync(outDir, { recursive: true });
mkdirSync(`${outDir}/cases`, { recursive: true });

const league = LEAGUE_BY_ID.get("league:england-premier-league");
const home = league.clubs.find((c) => c.clubId === "club:england:arsenal");
const away = league.clubs.find((c) => c.clubId === "club:england:brentford");

function makeLite(minutes, position = "ST", rating = 85) {
  return {
    name: "Bug5 QA",
    position,
    rating,
    currentOverall: rating,
    currentOverallRaw: rating,
    matchParticipation: { minutes, started: minutes > 35, selected: true, matchDuration: 90 },
  };
}

function userEvents(m) {
  return (m.events || []).filter((e) => e.playerInvolved);
}

function zeroMinuteCohort() {
  const roles = ["ST", "CM", "CB", "GK"];
  const sides = ["home", "away"];
  const report = { trialsPerCell: 100, cells: [], totalViolations: 0 };
  for (const position of roles) {
    for (const side of sides) {
      let goalAssist = 0;
      let cards = 0;
      let rated = 0;
      for (let seed = 1; seed <= 100; seed++) {
        const h = side === "home" ? home : away;
        const a = side === "home" ? away : home;
        const match = simulateMatch(h, a, {
          player: makeLite(0, position),
          playerSide: side,
          playerMinutes: 0,
          rng: createRng(seed),
        });
        const ev = userEvents(match);
        if (ev.some((e) => e.type === "goal" || e.type === "assist")) goalAssist += 1;
        if (ev.some((e) => e.type === "yellow" || e.type === "red")) cards += 1;
        if (match.playerStats.rating != null) rated += 1;
      }
      const violations = goalAssist + cards + rated;
      report.totalViolations += violations;
      report.cells.push({ position, side, goalAssist, cards, rated, violations });
    }
  }
  return report;
}

function knockoutCohort() {
  let draws = 0;
  let et = 0;
  let pens = 0;
  let positiveUser = 0;
  let violations = 0;
  const witnesses = {};
  for (let seed = 1; seed <= 1000; seed++) {
    const player = makeLite(90);
    const rng = createRng(seed);
    let match = simulateMatch(home, away, {
      player,
      playerSide: "home",
      playerMinutes: 90,
      rng,
    });
    if (match.homeGoals !== match.awayGoals) continue;
    draws += 1;
    match = resolveKnockout(match, { player, rng });
    if (match.decidedBy === "extraTime") et += 1;
    if (match.decidedBy === "penalties") pens += 1;
    const counted = countUserOpenPlayEvents(match);
    if (counted.goals || counted.assists) positiveUser += 1;
    if (
      counted.goals !== match.playerStats.goals ||
      counted.assists !== match.playerStats.assists ||
      counted.yellow !== match.playerStats.yellow ||
      counted.red !== match.playerStats.red
    ) {
      violations += 1;
    }
    if ([6, 169, 462].includes(seed)) {
      witnesses[seed] = {
        decidedBy: match.decidedBy,
        scoreline: match.scoreline,
        counted,
        stats: {
          goals: match.playerStats.goals,
          assists: match.playerStats.assists,
          minutes: match.playerStats.minutes,
          rating: match.playerStats.rating,
        },
      };
    }
  }
  return { trials: 1000, draws, et, pens, positiveUser, violations, witnesses };
}

function makeCareerPlayer({
  careerId,
  position = "ST",
  age = 19,
  rating = 76,
  potential = 88,
  club = home,
  attrs = null,
}) {
  const rng = createRng(42);
  const attributes =
    attrs ||
    generateStartingAttributes(position, rating, 99, rng);
  const player = {
    name: `Bug5 ${careerId}`,
    nationality: "England",
    position,
    age,
    careerId,
    attributes,
    rating,
    potential,
    startYear: 2026,
    club: {
      name: club.name,
      displayName: club.displayName || club.name,
      clubId: club.clubId,
      league: league.name,
      leagueId: league.leagueId,
      leagueDisplay: league.displayName,
      nation: "England",
      overall: club.overall ?? 80,
      badge: club.badge ?? null,
      financialTier: club.financialTier ?? 4,
      tier: club.tier ?? 4,
    },
  };
  initializePlayerDevelopment(player, {
    rng,
    careerId,
    budget: 99,
    potential,
  });
  player.currentOverall = rating;
  player.currentOverallRaw = rating;
  player.baseOverallRaw = rating;
  refreshAbilityCaches(player);
  ensurePlayingStints(player, { asOfDate: "2026-07-01" });
  player.contract = {
    clubId: club.clubId,
    clubName: club.name,
    yearsRemaining: 4,
    wage: 50000,
    startDate: "2026-07-01",
    endDate: "2030-06-30",
  };
  player.autoDecisionPolicy = "stay";
  setWorldState(createWorldState(player));
  return player;
}

function reconcileSeason(careerId, position, seed) {
  const player = makeCareerPlayer({ careerId, position, rating: position === "GK" ? 76 : 78 });
  reseedCareerRng(seed);
  setWorldState(createWorldState(player));
  const chrono = simulateChronologicalSeason({
    player,
    league,
    seasonIndex: 0,
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  const ledger = createEmptyLedger("2026");
  for (const rec of chrono.ledgerRecords || []) {
    recordMatchObservation(ledger, { ...rec, seasonId: "2026" });
  }
  const agg = aggregateSeason(ledger);
  const evidence = buildSeasonEvidence(player, {
    aggregate: agg,
    ledger,
    ledgerMatches: ledger.matches,
    league,
    seasonId: "2026",
    competitionEditions: [
      {
        editionId: "2026",
        scope: "league",
        competitionKey: league.leagueId,
        name: league.displayName,
      },
    ],
  });

  const positive = (chrono.ledgerRecords || []).filter((r) => (r.minutes || 0) > 0);
  const zero = (chrono.ledgerRecords || []).filter((r) => !(r.minutes > 0));
  const withEdition = (chrono.ledgerRecords || []).filter((r) => r.editionId || r.competitionEditionId);
  const rawCs = positive.filter((r) => r.cleanSheet === true).length;
  const ledgerCs = ledger.matches.filter((m) => m.cleanSheet === true).length;

  const matchIds = new Set();
  let dup = 0;
  for (const r of chrono.ledgerRecords || []) {
    if (matchIds.has(r.matchId)) dup += 1;
    matchIds.add(r.matchId);
  }

  const goalsFromPositive = positive.reduce((s, r) => s + (r.goals || 0), 0);
  const goalsFromLedger = agg.goals;

  return {
    careerId,
    position,
    seed,
    rawRecords: (chrono.ledgerRecords || []).length,
    positiveMinutes: positive.length,
    zeroMinutes: zero.length,
    withEdition: withEdition.length,
    editionCoverage: (chrono.ledgerRecords || []).length
      ? withEdition.length / (chrono.ledgerRecords || []).length
      : 1,
    rawCleanSheets: rawCs,
    ledgerCleanSheets: ledgerCs,
    evidenceLeagueCleanSheets: evidence.byScope?.league?.cleanSheets ?? null,
    evidenceTotalCleanSheets: evidence.total?.cleanSheets ?? null,
    duplicateMatchIds: dup,
    goalsAgree: goalsFromPositive === goalsFromLedger,
    goalsFromPositive,
    goalsFromLedger,
    apps: agg.appearances,
    samplePositive: positive.slice(0, 2).map((r) => ({
      matchId: r.matchId,
      editionId: r.editionId,
      minutes: r.minutes,
      goals: r.goals,
      cleanSheet: r.cleanSheet,
      rating: r.rating,
    })),
    sampleZero: zero.slice(0, 2).map((r) => ({
      matchId: r.matchId,
      reason: r.nonParticipationReason,
      editionId: r.editionId,
      teamId: r.teamId,
    })),
  };
}

const zeroMinute = zeroMinuteCohort();
const knockout = knockoutCohort();

const seasonReports = [];
const configs = [
  { careerId: "bug5-st-1", position: "ST", seed: 11 },
  { careerId: "bug5-gk-1", position: "GK", seed: 42 },
  { careerId: "bug5-cb-1", position: "CB", seed: 7 },
  { careerId: "bug5-cm-1", position: "CM", seed: 19 },
  { careerId: "bug5-st-2", position: "ST", seed: 55 },
  { careerId: "bug5-gk-2", position: "GK", seed: 88 },
  { careerId: "bug5-lw-1", position: "LW", seed: 3 },
  { careerId: "bug5-cdm-1", position: "CDM", seed: 21 },
  { careerId: "bug5-rb-1", position: "RB", seed: 33 },
  { careerId: "bug5-st-3", position: "ST", seed: 101 },
  { careerId: "bug5-gk-3", position: "GK", seed: 202 },
  { careerId: "bug5-cm-2", position: "CM", seed: 303 },
  { careerId: "bug5-cb-2", position: "CB", seed: 404 },
  { careerId: "bug5-st-4", position: "ST", seed: 505 },
  { careerId: "bug5-gk-4", position: "GK", seed: 606 },
  { careerId: "bug5-cm-3", position: "CM", seed: 707 },
  { careerId: "bug5-lw-2", position: "LW", seed: 808 },
  { careerId: "bug5-st-5", position: "ST", seed: 909 },
  { careerId: "bug5-cb-3", position: "CB", seed: 111 },
  { careerId: "bug5-gk-5", position: "GK", seed: 222 },
];

for (const cfg of configs) {
  try {
    const r = reconcileSeason(cfg.careerId, cfg.position, cfg.seed);
    seasonReports.push(r);
    writeFileSync(`${outDir}/cases/${cfg.careerId}.json`, JSON.stringify(r, null, 2));
  } catch (e) {
    seasonReports.push({ ...cfg, error: String(e?.stack || e) });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  zeroMinute,
  knockout,
  seasons: {
    count: seasonReports.length,
    errors: seasonReports.filter((s) => s.error).length,
    editionCoverageMin: Math.min(
      ...seasonReports.filter((s) => !s.error).map((s) => s.editionCoverage)
    ),
    goalDisagreements: seasonReports.filter((s) => !s.error && !s.goalsAgree).length,
    duplicateFixtures: seasonReports.filter((s) => !s.error && s.duplicateMatchIds > 0).length,
    keeperEvidenceOk: seasonReports
      .filter((s) => !s.error && s.position === "GK")
      .every((s) => s.ledgerCleanSheets === s.rawCleanSheets),
    rows: seasonReports,
  },
  pass:
    zeroMinute.totalViolations === 0 &&
    knockout.violations === 0 &&
    knockout.et > 0 &&
    knockout.pens > 0 &&
    seasonReports.every((s) => !s.error && s.goalsAgree && s.duplicateMatchIds === 0),
};

writeFileSync(`${outDir}/after.json`, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      pass: report.pass,
      zeroMinuteViolations: zeroMinute.totalViolations,
      knockoutViolations: knockout.violations,
      et: knockout.et,
      pens: knockout.pens,
      seasons: seasonReports.length,
      seasonErrors: report.seasons.errors,
      goalDisagreements: report.seasons.goalDisagreements,
    },
    null,
    2
  )
);
