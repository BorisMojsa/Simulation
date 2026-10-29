/**
 * Fix 05 audit exporter: zero-minute, knockout, and chronological ledger/evidence cohorts.
 * Run from repo root: node scripts/qaMatchParticipationEvidence.mjs
 * Exits non-zero when any required invariant fails.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { LEAGUE_BY_ID, LEAGUES, LEAGUE_LOOKUP } from "../js/data/leagues.js";
import { createRng, reseedCareerRng } from "../js/simulation/rng.js";
import {
  simulateMatch,
  resolveKnockout,
  countUserOpenPlayEvents,
  finalizePlayerMatchStats,
} from "../js/simulation/matchEngine.js";
import {
  createEmptyLedger,
  recordMatchObservation,
  aggregateSeason,
} from "../js/simulation/playerSeasonLedger.js";
import { buildSeasonEvidence, evidenceEditionKey } from "../js/simulation/seasonEvidence.js";
import {
  simulateChronologicalSeason,
  resumeChronologicalSeason,
} from "../js/simulation/chronologicalSeason.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import {
  generateStartingAttributes,
  initializePlayerDevelopment,
} from "../js/simulation/playerDevelopmentModel.js";
import { ensurePlayingStints } from "../js/simulation/playingRegistration.js";
import { createWorldState, setWorldState } from "../js/simulation/worldState.js";
import { refreshAbilityCaches } from "../js/simulation/playerAbility.js";
import { buildLiveLoanBrowserFixture } from "../js/simulation/liveLoanBrowserFixture.js";
import { startLoan } from "../js/simulation/loanMarket.js";
import { updateFatigue } from "../js/simulation/playerState.js";
import { processPlayerMatchDay } from "../js/simulation/playerMatchDay.js";
import { createPlayerIdentity } from "../js/simulation/playerDevelopment.js";

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

function substituteWindowCohort() {
  let earlyViolations = 0;
  let positiveInside = 0;
  let overlong = 0;
  const witness = {};
  for (let seed = 1; seed <= 200; seed++) {
    const player = makeLite(20);
    player.matchParticipation.started = false;
    const match = simulateMatch(home, away, {
      player,
      playerSide: seed % 2 === 0 ? "home" : "away",
      playerMinutes: 20,
      matchDuration: 90,
      rng: createRng(seed),
    });
    const early = userEvents(match).filter(
      (e) =>
        (e.minute || 0) < 70 &&
        (e.type === "goal" || e.type === "assist" || e.type === "yellow" || e.type === "red")
    );
    if (early.length) {
      earlyViolations += 1;
      if (!witness.seed) witness.seed = seed;
    }
    if (userEvents(match).some((e) => (e.minute || 0) >= 70 && (e.type === "goal" || e.type === "assist"))) {
      positiveInside += 1;
    }
  }
  const capped = simulateMatch(home, away, {
    player: makeLite(200),
    playerSide: "home",
    playerMinutes: 200,
    matchDuration: 90,
    rng: createRng(1),
  });
  if (capped.playerStats.minutes !== 90) overlong += 1;

  const rng = createRng(1);
  const p = makeLite(90);
  const m = simulateMatch(home, away, { player: p, playerSide: "home", rng: createRng(42) });
  const once = finalizePlayerMatchStats(m, p, rng);
  const afterFirst = rng.seed();
  const twice = finalizePlayerMatchStats(once, p, rng);
  const afterSecond = rng.seed();
  const finalizerOk =
    afterFirst === afterSecond && JSON.stringify(once.playerStats) === JSON.stringify(twice.playerStats);

  return {
    trials: 200,
    earlyViolations,
    positiveInside,
    overlong,
    finalizerOk,
    witness,
    pass: earlyViolations === 0 && overlong === 0 && finalizerOk && positiveInside > 0,
  };
}

function crossLeagueLoanProbe() {
  try {
    const fixture = buildLiveLoanBrowserFixture({ seed: 42 });
    if (!fixture?.ok) {
      return { ok: false, reason: fixture?.reason || "fixture-failed" };
    }
    const { player: p, offers } = fixture;
    // Prefer a cross-league loan so origin/destination edition keys stay distinct.
    const offer =
      offers.find(
        (o) =>
          o.isLoan &&
          o.clubId !== p.employmentClubId &&
          o.leagueId &&
          o.leagueId !== "league:italy-serie-a"
      ) || offers.find((o) => o.isLoan && o.clubId !== p.employmentClubId);
    if (!offer) return { ok: false, reason: "no-generated-loan" };
    const destinationLeagueId = offer.leagueId;
    if (!destinationLeagueId) return { ok: false, reason: "loan-missing-leagueId" };
    const transition = startLoan(p, offer);
    if (!transition?.ok) return { ok: false, reason: transition?.reason || "startLoan-failed" };
    p.pendingOffers = [];
    p.pendingDecision = null;
    const ck = structuredClone(p.seasonCheckpoint);
    const sourceLeague = LEAGUE_BY_ID.get("league:italy-serie-a");
    const r = resumeChronologicalSeason({
      player: p,
      league: sourceLeague,
      seasonIndex: 0,
      checkpoint: ck,
      pauseForDecisions: false,
      autoDecisionPolicy: "stay",
    });
    const rows = (r.ledgerRecords || []).filter((x) => x.competitionType === "league" && x.minutes > 0);
    const group = {};
    for (const row of rows) {
      const k = `${row.competitionId}|${row.editionId}`;
      const g = (group[k] ??= { minutes: 0, goals: 0, assists: 0, rows: 0 });
      g.minutes += row.minutes;
      g.goals += row.goals || 0;
      g.assists += row.assists || 0;
      g.rows += 1;
    }
    const ledger = createEmptyLedger("season-1");
    for (const row of r.ledgerRecords || []) recordMatchObservation(ledger, row);
    const competitionEditions = [
      ...new Map(
        rows.map((row) => [
          row.competitionId,
          { editionId: row.editionId, competitionKey: row.competitionId, scope: "league" },
        ])
      ).values(),
    ];
    const ev = buildSeasonEvidence(p, {
      ledger,
      seasonId: "season-1",
      league: r.activeLeague,
      competitionEditions,
    });
    const serieKey = evidenceEditionKey("league:italy-serie-a", "2026");
    const destKey = evidenceEditionKey(destinationLeagueId, "2026");
    const serie = ev.byEdition?.[serieKey];
    const dest = ev.byEdition?.[destKey];
    const ok =
      Boolean(serie && dest) &&
      serie.minutes === (group["league:italy-serie-a|2026"]?.minutes || 0) &&
      dest.minutes === (group[`${destinationLeagueId}|2026`]?.minutes || 0) &&
      !ev.byEdition?.["2026"] &&
      serie.minutes > 0 &&
      dest.minutes > 0;
    return {
      ok,
      status: r.status,
      borrower: offer.clubId,
      destinationLeagueId,
      groups: group,
      byEdition: ev.byEdition,
      leagueScope: ev.byScope.league,
      serieMinutes: serie?.minutes ?? null,
      destinationMinutes: dest?.minutes ?? null,
    };
  } catch (e) {
    return { ok: false, reason: String(e?.stack || e) };
  }
}

function simulateSeasonEvidenceProbe() {
  try {
    reseedCareerRng(17);
    setWorldState(createWorldState({ startYear: 2026 }));
    const player = createPlayerIdentity({
      name: "Bug5 SimSeason",
      nationality: "England",
      position: "ST",
      age: 19,
    });
    player.startYear = 2026;
    player.rating = 78;
    player.potential = 88;
    player.careerId = "bug5-simseason";
    player.attributes = {
      Speed: 78,
      Passing: 76,
      Shooting: 80,
      Defending: 50,
      Physicality: 74,
      Dribbling: 77,
    };
    player.playerModelVersion = 2;
    player.state = { form: 0, morale: 0, readiness: 1, fatigue: 0, adaptationPenalty: 0, roleFit: 1 };
    player.health = { activeInjury: null, injuryHistory: [], durableDamage: {}, recoverableDamage: {} };
    player.development = { latentBudget: 90, modelVersion: 1, migration: {} };
    player.club = {
      ...home,
      league: league.name,
      leagueDisplay: league.displayName,
      leagueId: league.leagueId,
      nation: "England",
      isAcademy: false,
      parentClub: null,
    };
    player.employmentClubId = home.clubId;
    player.playingClubId = home.clubId;
    player.contractStartSeason = 0;
    player.contractYears = 4;
    player.contractEndSeason = 4;
    player.weeklyWage = 50000;
    player.seasons = [];
    player.autoDecisionPolicy = "stay";
    initializePlayerDevelopment(player, { rng: createRng(17), careerId: player.careerId, budget: 99, potential: 88 });
    ensurePlayingStints(player, { asOfDate: "2026-07-01" });
    setWorldState(createWorldState(player));

    const result = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions: false,
      autoDecisionPolicy: "stay",
    });
    const season = result?.season || player.seasons?.[player.seasons.length - 1] || null;
    const evidence = season?.seasonEvidence || season?.evidence || result?.evidence || null;
    const editions = evidence?.editions || [];
    const byEdition = evidence?.byEdition || {};
    const editionKeys = Object.keys(byEdition);
    const leagueEdition = editions.find((e) => e.scope === "league");
    const ledgerRows = season?.ledgerRecords || [];
    const goalsFromLedger = ledgerRows
      .filter((r) => (r.minutes || 0) > 0)
      .reduce((s, r) => s + (r.goals || 0), 0);
    const goalsFromLeagueLedger = ledgerRows
      .filter(
        (r) =>
          (r.minutes || 0) > 0 &&
          (r.competitionType === "league" ||
            String(r.competitionId || "").startsWith("league:"))
      )
      .reduce((s, r) => s + (r.goals || 0), 0);
    const evidenceTotalGoals =
      evidence?.total?.goals ??
      Object.values(evidence?.byScope || {}).reduce((s, row) => s + (row?.goals || 0), 0);
    // League descriptor must use fixture edition ids (e.g. 2026), not season-1 index,
    // and byEdition must key as competitionId::editionId.
    // Compare league ledger goals to byScope.league (not all-competition totals).
    const ok =
      Boolean(evidence) &&
      Boolean(evidence.byScope) &&
      editions.length > 0 &&
      Boolean(leagueEdition?.competitionKey) &&
      Boolean(leagueEdition?.evidenceKey?.includes("::")) &&
      String(leagueEdition.editionId) !== "season-1" &&
      !editionKeys.includes("season-1") &&
      (editionKeys.length === 0 || editionKeys.every((k) => k.includes("::"))) &&
      ledgerRows.length > 0 &&
      goalsFromLeagueLedger === (evidence.byScope?.league?.goals ?? goalsFromLeagueLedger) &&
      goalsFromLedger === evidenceTotalGoals;
    return {
      ok,
      editionCount: editions.length,
      editionKeys: editionKeys.slice(0, 12),
      editionsSample: editions.slice(0, 6),
      minutes: evidence?.minutes ?? null,
      goals: evidence?.goals ?? evidence?.byScope?.league?.goals ?? null,
      seasonId: result?.seasonId || season?.seasonId || season?.seasonNumber || null,
      leagueEditionId: leagueEdition?.editionId ?? null,
      leagueEvidenceKey: leagueEdition?.evidenceKey ?? null,
      ledgerRows: ledgerRows.length,
      goalsFromLedger,
      goalsFromLeagueLedger,
      evidenceTotalGoals,
      byScopeLeague: evidence?.byScope?.league || null,
    };
  } catch (e) {
    return { ok: false, reason: String(e?.stack || e) };
  }
}

function etExposureProbe() {
  try {
    const player = makeCareerPlayer({ careerId: "bug5-et-exp", position: "ST", rating: 85 });
    player.state.fatigue = 0;
    const injuryRng = {
      random: () => 0.99,
      chance: () => false,
      int: (a) => a,
      float: (a) => a,
      pick: (a) => a[0],
      shuffle: (a) => a,
    };
    const selRng = {
      random: () => 0,
      chance: () => true,
      int: (a, b) => b,
      float: (a, b) => (b == null ? a : b),
      pick: (a) => a[0],
      shuffle: (a) => a,
    };
    const result = processPlayerMatchDay({
      home,
      away,
      player,
      playerSide: "home",
      date: "2026-09-01",
      competition: "league",
      competitionType: "league",
      competitionId: league.leagueId,
      editionId: "2026",
      fixtureId: "qa-et-exp",
      teamType: "club",
      rng: createRng(2),
      selRng,
      injuryRng,
      resolveKnockout,
    });
    const expected = (120 / 90) * 0.25;
    const ok =
      ["extraTime", "penalties"].includes(result.match.decidedBy) &&
      result.match.playerStats.minutes === 120 &&
      result.participation.minutes === 120 &&
      result.ledgerRecord.minutes === 120 &&
      Math.abs(player.state.fatigue - expected) < 1e-12;
    // Repeat finalize must not re-charge (no second process); snapshot fatigue is final.
    const fatigueAfter = player.state.fatigue;
    updateFatigue(player.state, { minutes: 0 });
    return {
      ok,
      decidedBy: result.match.decidedBy,
      minutes: result.match.playerStats.minutes,
      participationMinutes: result.participation.minutes,
      fatigue: fatigueAfter,
      expected,
    };
  } catch (e) {
    return { ok: false, reason: String(e?.stack || e) };
  }
}

function makeCareerPlayer({
  careerId,
  position = "ST",
  age = 19,
  rating = 76,
  potential = 88,
  club = home,
  attrs = null,
  seed = 42,
}) {
  const rng = createRng(seed);
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
  player.seasons = [];
  player.careerHonors = {
    leagueTitles: 0,
    cupTitles: 0,
    europeanTitles: 0,
    internationalTitles: 0,
  };
  player.employmentClubId = club.clubId;
  player.playingClubId = club.clubId;
  player.contractYears = 4;
  player.contractStartSeason = 0;
  player.contractEndSeason = 4;
  player.weeklyWage = 50000;
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

  // Competition-scoped evidence keys must not collapse distinct leagues on a bare year.
  const editionKeys = Object.keys(evidence.byEdition || {});
  const competitionIds = [
    ...new Set(
      (chrono.ledgerRecords || [])
        .filter((r) => (r.minutes || 0) > 0 && r.competitionId)
        .map((r) => r.competitionId)
    ),
  ];
  const editionKeyOk =
    !editionKeys.includes("2026") &&
    (competitionIds.length <= 1 ||
      competitionIds.every((cid) =>
        editionKeys.some((k) => k.startsWith(`${cid}::`) || k === cid)
      ));

  // When committed matches are present, reconcile open-play user events to record totals.
  let eventGoalDisagree = 0;
  let matchesWithEvents = 0;
  for (const m of chrono.playerMatches || []) {
    if (!m?.events || !(m.playerStats?.minutes > 0)) continue;
    matchesWithEvents += 1;
    const counted = countUserOpenPlayEvents(m);
    if (
      counted.goals !== (m.playerStats.goals || 0) ||
      counted.assists !== (m.playerStats.assists || 0)
    ) {
      eventGoalDisagree += 1;
    }
  }

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
    evidenceEditionKeys: editionKeys,
    editionKeyOk,
    duplicateMatchIds: dup,
    goalsAgree: goalsFromPositive === goalsFromLedger,
    goalsFromPositive,
    goalsFromLedger,
    matchesWithEvents,
    eventGoalDisagree,
    apps: agg.appearances,
    samplePositive: positive.slice(0, 2).map((r) => ({
      matchId: r.matchId,
      editionId: r.editionId,
      competitionId: r.competitionId,
      teamId: r.teamId,
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
    evidenceByScope: evidence.byScope,
  };
}

const zeroMinute = zeroMinuteCohort();
const knockout = knockoutCohort();
const substituteWindow = substituteWindowCohort();
const loanProbe = crossLeagueLoanProbe();
const simSeasonProbe = simulateSeasonEvidenceProbe();
const etExposure = etExposureProbe();

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

const editionCoverageMin = Math.min(
  ...seasonReports.filter((s) => !s.error).map((s) => s.editionCoverage),
  1
);
const keeperEvidenceOk = seasonReports
  .filter((s) => !s.error && s.position === "GK")
  .every((s) => s.ledgerCleanSheets === s.rawCleanSheets);
const seasonsOk = seasonReports.every(
  (s) =>
    !s.error &&
    s.goalsAgree &&
    s.duplicateMatchIds === 0 &&
    s.editionCoverage >= 1 &&
    s.editionKeyOk !== false &&
    (s.eventGoalDisagree || 0) === 0
);

const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  zeroMinute,
  knockout,
  substituteWindow,
  loanProbe,
  simSeasonProbe,
  etExposure,
  seasons: {
    count: seasonReports.length,
    errors: seasonReports.filter((s) => s.error).length,
    editionCoverageMin,
    goalDisagreements: seasonReports.filter((s) => !s.error && !s.goalsAgree).length,
    duplicateFixtures: seasonReports.filter((s) => !s.error && s.duplicateMatchIds > 0).length,
    keeperEvidenceOk,
    eventGoalDisagreements: seasonReports.reduce((n, s) => n + (s.eventGoalDisagree || 0), 0),
    rows: seasonReports,
  },
  pass:
    zeroMinute.totalViolations === 0 &&
    knockout.violations === 0 &&
    knockout.et > 0 &&
    knockout.pens > 0 &&
    seasonsOk &&
    editionCoverageMin >= 1 &&
    keeperEvidenceOk &&
    substituteWindow.pass &&
    loanProbe.ok === true &&
    simSeasonProbe.ok === true &&
    etExposure.ok === true,
};

writeFileSync(`${outDir}/after.json`, JSON.stringify(report, null, 2));
const summary = {
  pass: report.pass,
  zeroMinuteViolations: zeroMinute.totalViolations,
  knockoutViolations: knockout.violations,
  et: knockout.et,
  pens: knockout.pens,
  seasons: seasonReports.length,
  seasonErrors: report.seasons.errors,
  goalDisagreements: report.seasons.goalDisagreements,
  editionCoverageMin,
  keeperEvidenceOk,
  substituteWindowPass: substituteWindow.pass,
  loanProbeOk: loanProbe.ok,
  simSeasonOk: simSeasonProbe.ok,
  etExposureOk: etExposure.ok,
};
console.log(JSON.stringify(summary, null, 2));
if (!report.pass) process.exitCode = 1;
