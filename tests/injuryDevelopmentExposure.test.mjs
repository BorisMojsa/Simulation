/**
 * Fix 06: injury exposure scoped to the senior development period.
 * Run: node tests/injuryDevelopmentExposure.test.mjs
 */
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { LEAGUES, LEAGUE_LOOKUP, LEAGUE_BY_ID } from "../js/data/leagues.js";
import { createRng, reseedCareerRng, createStreamRng, setSimRng } from "../js/simulation/rng.js";
import { createPlayerIdentity } from "../js/simulation/playerDevelopment.js";
import { ensurePlayerModel } from "../js/simulation/playerModelMigration.js";
import { refreshAbilityCaches } from "../js/simulation/playerAbility.js";
import { createWorldState, setWorldState, getWorldState } from "../js/simulation/worldState.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import {
  buildSeasonEvidence,
  estimateHealthyTrainingDetail,
  estimateHealthyTrainingFraction,
  resolveDevelopmentPeriod,
  availabilityReturnDayOf,
  HEALTHY_FRACTION_FLOOR,
} from "../js/simulation/seasonEvidence.js";
import {
  createEmptyHealth,
  applyInjury,
  advanceHealth,
  isAvailable,
} from "../js/simulation/playerHealth.js";
import { toDay } from "../js/simulation/playerState.js";
import {
  serializeCareerSnapshot,
  deserializeCareerSnapshot,
} from "../js/simulation/careerSnapshot.js";
import { ensurePlayingStints } from "../js/simulation/playingRegistration.js";
import { applyOfferToPlayer } from "../js/simulation/dealPipeline.js";
import { resolveMoveRegistration } from "../js/simulation/destinationSchedule.js";
import { allSeniorClubs } from "../js/simulation/seniorClubs.js";
import { applySeniorScenarioPolicy } from "../js/simulation/seniorCareerScenarios.js";

const OUT = "qa/fix06-runs";
mkdirSync(OUT, { recursive: true });
mkdirSync(`${OUT}/cases`, { recursive: true });

const results = [];

function test(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === "function") {
      return out
        .then((v) => {
          console.log(`OK  ${name}`);
          results.push({ name, ok: true, detail: v || null });
        })
        .catch((e) => {
          console.error(`FAIL ${name}`);
          console.error(e);
          process.exitCode = 1;
          results.push({ name, ok: false, error: String(e?.stack || e) });
        });
    }
    console.log(`OK  ${name}`);
    results.push({ name, ok: true, detail: out || null });
  } catch (e) {
    console.error(`FAIL ${name}`);
    console.error(e);
    process.exitCode = 1;
    results.push({ name, ok: false, error: String(e?.stack || e) });
  }
}

/** Independent day-occupancy oracle for integer-day fixtures. */
function oracleUnionDays(intervals, S, E) {
  const set = new Set();
  for (const [a, b] of intervals) {
    const lo = Math.max(a, S);
    const hi = Math.min(b, E);
    for (let d = lo; d < hi; d++) set.add(d);
  }
  return set.size;
}

function approx(a, b, eps = 1e-12) {
  assert.ok(Math.abs(a - b) <= eps, `expected ${b}, got ${a}`);
}

const WINDOW = { seasonStartDay: 1000, seasonEndDay: 1300 };
const PERIOD_DAYS = 300;

function detail(health, extra = {}) {
  return estimateHealthyTrainingDetail({ health, ...WINDOW, ...extra });
}

function inj(eventId, start, end, extras = {}) {
  return {
    eventId,
    startDay: start,
    expectedReturnDay: end,
    durationDays: end - start,
    ...extras,
  };
}

/* ------------------------------------------------------------------ */
/* A. Exact interval arithmetic                                        */
/* ------------------------------------------------------------------ */

const arithmeticCases = [
  { name: "no records", history: [], active: null, missed: 0, raw: 1 },
  {
    name: "old recovered",
    history: [inj("old", 100, 400, { recoveredDay: 400 })],
    active: null,
    missed: 0,
    raw: 1,
  },
  {
    name: "future injury",
    history: [inj("fut", 1400, 1450)],
    active: null,
    missed: 0,
    raw: 1,
  },
  {
    name: "internal injury",
    history: [inj("in", 1010, 1040)],
    active: null,
    missed: 30,
    raw: 0.9,
  },
  {
    name: "carry-in",
    history: [inj("ci", 990, 1010)],
    active: null,
    missed: 10,
    raw: 290 / 300,
  },
  {
    name: "carry-out",
    history: [inj("co", 1290, 1320)],
    active: null,
    missed: 10,
    raw: 290 / 300,
  },
  {
    name: "entire period",
    history: [inj("full", 900, 1400)],
    active: null,
    missed: 300,
    raw: 0,
    applied: HEALTHY_FRACTION_FLOOR,
  },
  {
    name: "two overlapping",
    history: [inj("a", 1010, 1030), inj("b", 1020, 1040)],
    active: null,
    missed: 30,
    raw: 0.9,
  },
  {
    name: "adjacent",
    history: [inj("a", 1010, 1020), inj("b", 1020, 1030)],
    active: null,
    missed: 20,
    raw: 280 / 300,
  },
  {
    name: "exact boundaries",
    history: [inj("before", 980, 1000), inj("after", 1300, 1320)],
    active: null,
    missed: 0,
    raw: 1,
  },
  {
    name: "duplicate active/history same event",
    history: [inj("dup", 1010, 1040)],
    active: inj("dup", 1010, 1040),
    missed: 30,
    raw: 0.9,
  },
  {
    name: "superseded distinct events union",
    history: [
      { ...inj("old", 1010, 1035), superseded: true },
      inj("new", 1020, 1040),
    ],
    active: null,
    missed: 30,
    raw: 0.9,
  },
];

for (const c of arithmeticCases) {
  test(`A: ${c.name}`, () => {
    const health = {
      activeInjury: c.active,
      injuryHistory: c.history,
    };
    const r = detail(health);
    const oracle = oracleUnionDays(
      [...(c.history || []), c.active].filter(Boolean).map((x) => [x.startDay, x.expectedReturnDay]),
      1000,
      1300
    );
    // Dedup same eventId for oracle when duplicate case
    let expectedMissed = c.missed;
    if (c.name.startsWith("duplicate")) {
      expectedMissed = oracleUnionDays([[1010, 1040]], 1000, 1300);
    }
    assert.equal(r.injuredDays, expectedMissed);
    approx(r.fraction, c.raw);
    assert.equal(r.injuredDays, expectedMissed === c.missed ? c.missed : expectedMissed);
    if (c.applied != null) {
      assert.equal(estimateHealthyTrainingFraction({ health, ...WINDOW }), c.applied);
    }
    assert.equal(r.hasDatedWindow, true);
    writeFileSync(
      `${OUT}/cases/A-${c.name.replace(/[^\w]+/g, "-").replace(/-+$/g, "")}.json`,
      JSON.stringify({ input: c, result: r, oracle }, null, 2)
    );
  });
}

test("A: dated active injury is not automatically uncertain", () => {
  const health = {
    activeInjury: inj("live", 1010, 1040),
    injuryHistory: [],
  };
  const r = detail(health);
  assert.equal(r.injuredDays, 30);
  assert.equal(r.partial, false);
  assert.equal(r.method, "dated-overlap");
});

test("A: incomplete history copy yields to valid active copy", () => {
  const health = {
    injuryHistory: [{ eventId: "x", durationDays: 300 }],
    activeInjury: inj("x", 1010, 1040),
  };
  const r = detail(health);
  assert.equal(r.injuredDays, 30);
  assert.equal(r.excludedUnknownCount, 0);
  assert.deepEqual(r.contributingEventIds, ["x"]);
});

test("A: ISO dates, Date, day 0", () => {
  const start = "2026-06-01T00:00:00.000Z";
  const end = "2027-06-01T00:00:00.000Z";
  const onset = "2026-07-01T00:00:00.000Z";
  const ret = "2026-07-11T00:00:00.000Z";
  const r = estimateHealthyTrainingDetail({
    health: {
      activeInjury: null,
      injuryHistory: [
        {
          eventId: "iso",
          date: onset,
          startDay: toDay(onset),
          expectedReturnDay: toDay(ret),
          durationDays: 10,
        },
      ],
    },
    seasonStartDate: start,
    seasonEndDate: end,
  });
  assert.equal(r.injuredDays, 10);

  const day0 = estimateHealthyTrainingDetail({
    health: {
      injuryHistory: [inj("z", 0, 5)],
      activeInjury: null,
    },
    seasonStartDay: 0,
    seasonEndDay: 10,
  });
  assert.equal(day0.injuredDays, 5);
  assert.equal(day0.hasDatedWindow, true);

  const viaDate = estimateHealthyTrainingDetail({
    health: {
      injuryHistory: [
        {
          eventId: "d",
          date: new Date(Date.UTC(2026, 6, 1)),
          startDay: toDay(new Date(Date.UTC(2026, 6, 1))),
          expectedReturnDay: toDay(new Date(Date.UTC(2026, 6, 11))),
          durationDays: 10,
        },
      ],
      activeInjury: null,
    },
    seasonStartDate: new Date(Date.UTC(2026, 5, 1)),
    seasonEndDate: new Date(Date.UTC(2027, 5, 1)),
  });
  assert.equal(viaDate.injuredDays, 10);
});

test("A: leap-year annual length and adjacent boundaries", () => {
  const p0 = resolveDevelopmentPeriod({ startYear: 2023, seasons: [] }, { seasonIndex: 0 });
  const p1 = resolveDevelopmentPeriod({ startYear: 2023, seasons: [{}] }, { seasonIndex: 1 });
  assert.equal(p0.periodStartDate, "2023-06-01");
  assert.equal(p0.periodEndExclusiveDate, "2024-06-01");
  assert.equal(p0.periodDays, 366);
  assert.equal(p1.periodStartDate, "2024-06-01");
  assert.equal(p1.periodEndExclusiveDate, "2025-06-01");
  assert.equal(p0.periodEndDay, p1.periodStartDay);
  assert.ok(p0.periodEndDay > p0.periodStartDay);
});

test("A: invalid / reversed window and intervals", () => {
  const bad = estimateHealthyTrainingDetail({
    health: { injuryHistory: [inj("a", 1010, 1040)], activeInjury: null },
    seasonStartDay: 1300,
    seasonEndDay: 1000,
  });
  assert.equal(bad.hasDatedWindow, false);
  assert.equal(bad.partial, true);

  const rev = detail({
    injuryHistory: [{ eventId: "r", startDay: 1040, expectedReturnDay: 1010, durationDays: -30 }],
    activeInjury: null,
  });
  assert.equal(rev.injuredDays, 0);

  // NaN start with declared seasonDays reconstructs a one-sided window from the end.
  const nanWin = estimateHealthyTrainingDetail({
    health: { injuryHistory: [], activeInjury: null },
    seasonStartDay: Number.NaN,
    seasonEndDay: 1300,
    seasonDays: 300,
  });
  assert.equal(nanWin.hasDatedWindow, true);
  assert.equal(nanWin.windowStartDay, 1000);
  assert.equal(nanWin.windowEndDay, 1300);

  const missingBounds = estimateHealthyTrainingDetail({
    health: { injuryHistory: [inj("a", 1010, 1040)], activeInjury: null },
    seasonStartDay: Number.NaN,
    seasonEndDay: Number.NaN,
  });
  assert.equal(missingBounds.hasDatedWindow, false);
  assert.equal(missingBounds.partial, true);
});

test("A: estimator is read-only (no mutation / RNG)", () => {
  const health = {
    activeInjury: inj("live", 1010, 1040),
    injuryHistory: [inj("old", 100, 400, { recoveredDay: 400 })],
    durableDamage: { Speed: 1.5 },
    recoverableDamage: { Speed: 0.5 },
  };
  const before = JSON.stringify(health);
  const rngState = { n: 0 };
  const r1 = detail(health);
  const r2 = detail(health);
  assert.deepEqual(r1.injuredDays, r2.injuredDays);
  assert.equal(JSON.stringify(health), before);
  assert.equal(rngState.n, 0);
});

test("A: mixed known/unknown historical", () => {
  const r = detail({
    activeInjury: null,
    injuryHistory: [
      inj("known", 1010, 1020),
      { eventId: "unk", durationDays: 300 },
    ],
  });
  assert.equal(r.injuredDays, 10);
  assert.equal(r.excludedUnknownCount, 1);
  assert.equal(r.partial, true);
  assert.ok(r.method.includes("unknown") || r.method.includes("dated-overlap"));
});

test("A: undated archived duration excluded; undated active fallback", () => {
  const archived = detail({
    activeInjury: null,
    injuryHistory: [{ eventId: "archive", durationDays: 300 }],
  });
  assert.equal(archived.injuredDays, 0);
  assert.equal(archived.fraction, 1);
  assert.equal(archived.partial, true);
  assert.equal(archived.excludedUnknownCount, 1);

  const activeUndated = detail({
    activeInjury: { eventId: "u", durationDays: 40 },
    injuryHistory: [],
  });
  assert.equal(activeUndated.injuredDays, 40);
  assert.equal(activeUndated.partial, true);
  assert.ok(activeUndated.method.includes("undated") || activeUndated.method.includes("partial"));
});

test("A: R1 invalid active duration cannot cancel known days", () => {
  const r = detail({
    injuryHistory: [inj("known", 1010, 1020)],
    activeInjury: { eventId: "bad-active", durationDays: -30 },
  });
  assert.ok(r.injuredDays >= 10, `known interval cancelled: ${r.injuredDays}`);
  assert.equal(r.injuredDays, 10);
  assert.ok(r.clippedIntervals.some((c) => c.eventId === "known" && c.clippedDays === 10));
  writeFileSync(
    `${OUT}/cases/R1-invalid-active-duration.json`,
    JSON.stringify({ expectedMissed: 10, result: r }, null, 2)
  );
});

test("A: R2 complete dated history survives incomplete active duplicate", () => {
  const r = detail({
    injuryHistory: [inj("same", 1010, 1040)],
    activeInjury: { eventId: "same", durationDays: 3 },
  });
  assert.equal(r.injuredDays, 30);
  assert.ok(r.clippedIntervals.some((c) => c.eventId === "same" && c.clippedDays === 30));
  writeFileSync(
    `${OUT}/cases/R2-dated-history-beats-incomplete-active.json`,
    JSON.stringify({ expectedMissed: 30, result: r }, null, 2)
  );
});

test("A: R2 incomplete history yields to complete dated active", () => {
  const r = detail({
    injuryHistory: [{ eventId: "same", durationDays: 3 }],
    activeInjury: inj("same", 1010, 1040),
  });
  assert.equal(r.injuredDays, 30);
});

test("A: R2 invalid numeric fields on active do not erase dated history", () => {
  const r = detail({
    injuryHistory: [inj("same", 1010, 1040)],
    activeInjury: {
      eventId: "same",
      startDay: Number.NaN,
      expectedReturnDay: Number.POSITIVE_INFINITY,
      durationDays: -5,
    },
  });
  assert.equal(r.injuredDays, 30);
});

test("A: R3 date-only expectedReturnDate beats late recoveredDay", () => {
  const rec = {
    eventId: "date-only-return",
    date: "2026-07-01",
    expectedReturnDate: "2026-07-11",
    recoveredDay: toDay("2026-07-31"),
  };
  assert.equal(availabilityReturnDayOf(rec), toDay("2026-07-11"));
  // Deliberately omit expectedReturnDay so only the date-string branch applies.
  assert.equal(rec.expectedReturnDay, undefined);
  const r = estimateHealthyTrainingDetail({
    seasonStartDate: "2026-06-01",
    seasonEndDate: "2027-06-01",
    health: { activeInjury: null, injuryHistory: [rec] },
  });
  assert.equal(r.injuredDays, 10);
  writeFileSync(
    `${OUT}/cases/R3-date-only-return.json`,
    JSON.stringify({ expectedMissed: 10, returnDay: availabilityReturnDayOf(rec), result: r }, null, 2)
  );
});

test("A: malformed expectedReturnDate falls through truthfully", () => {
  const r = estimateHealthyTrainingDetail({
    seasonStartDate: "2026-06-01",
    seasonEndDate: "2027-06-01",
    health: {
      activeInjury: null,
      injuryHistory: [
        {
          eventId: "bad-date",
          date: "2026-07-01",
          expectedReturnDate: "not-a-date",
          recoveredDay: toDay("2026-07-31"),
        },
      ],
    },
  });
  // No usable return boundary besides recoveredDay observation → 30 days.
  assert.equal(r.injuredDays, 30);
});

/* ------------------------------------------------------------------ */
/* B. Real health recovery semantics                                   */
/* ------------------------------------------------------------------ */

function makeAttrs(position = "ST") {
  if (position === "GK") {
    return { Diving: 70, Handling: 70, Kicking: 68, Reflexes: 70, Speed: 50, Positioning: 70 };
  }
  return { Speed: 70, Passing: 68, Shooting: 72, Defending: 55, Physicality: 68, Dribbling: 70 };
}

function barePlayer(position = "ST") {
  return {
    name: "Fix06Health",
    position,
    attributes: makeAttrs(position),
    health: createEmptyHealth(),
    development: { appliedEventIds: {} },
    state: { readiness: 1 },
  };
}

test("B: late recovery observation charges availability days only", () => {
  const p = barePlayer();
  applyInjury(
    p,
    {
      eventId: "late-obs",
      kind: "match",
      severity: "minor",
      startDay: 1010,
      durationDays: 10,
      expectedReturnDay: 1020,
      temporaryEffects: { overallPenalty: 1, scale: 1, attributePenalties: {} },
      returnReadiness: 0.9,
    },
    { rng: createRng(11) }
  );
  assert.equal(isAvailable(p.health, 1020), true);
  advanceHealth(p, 1050);
  assert.equal(p.health.injuryHistory[0].recoveredDay, 1050);
  assert.equal(p.health.injuryHistory[0].availabilityReturnDay, 1020);
  const r = detail(p.health);
  assert.equal(r.injuredDays, 10);
  const r2 = detail(p.health);
  assert.equal(r2.injuredDays, 10);
  advanceHealth(p, 1100);
  assert.equal(detail(p.health).injuredDays, 10);
});

test("B: return before period + observation after → zero in new period", () => {
  const p = barePlayer();
  applyInjury(
    p,
    {
      eventId: "pre-boundary",
      kind: "match",
      severity: "minor",
      startDay: 980,
      durationDays: 15,
      expectedReturnDay: 995,
      temporaryEffects: { overallPenalty: 1, scale: 1, attributePenalties: {} },
      returnReadiness: 0.9,
    },
    { rng: createRng(12) }
  );
  assert.equal(isAvailable(p.health, 995), true);
  advanceHealth(p, 1005);
  assert.equal(p.health.injuryHistory[0].recoveredDay, 1005);
  assert.equal(detail(p.health).injuredDays, 0);
});

test("B: injury extending into next period contributes only overlap", () => {
  const period = resolveDevelopmentPeriod({ startYear: 2026, seasons: [] }, { seasonIndex: 0 });
  const next = resolveDevelopmentPeriod({ startYear: 2026, seasons: [{}] }, { seasonIndex: 1 });
  const start = period.periodEndDay - 10;
  const end = period.periodEndDay + 20;
  const health = {
    activeInjury: null,
    injuryHistory: [inj("cross", start, end, { recoveredDay: end + 5 })],
  };
  const y1 = estimateHealthyTrainingDetail({
    health,
    seasonStartDay: period.periodStartDay,
    seasonEndDay: period.periodEndDay,
  });
  const y2 = estimateHealthyTrainingDetail({
    health,
    seasonStartDay: next.periodStartDay,
    seasonEndDay: next.periodEndDay,
  });
  assert.equal(y1.injuredDays, 10);
  assert.equal(y2.injuredDays, 20);
});

test("B: legacy late recoveredDay with valid expectedReturn", () => {
  const health = {
    activeInjury: null,
    injuryHistory: [
      {
        eventId: "legacy",
        startDay: 1010,
        durationDays: 10,
        expectedReturnDay: 1020,
        recoveredDay: 1050,
      },
    ],
  };
  assert.equal(availabilityReturnDayOf(health.injuryHistory[0]), 1020);
  assert.equal(detail(health).injuredDays, 10);
});

test("B: durable damage retained while missed days are zero", () => {
  // Seed 6 deterministically samples nonzero durable damage for severity "severe".
  const p = barePlayer();
  const beforeAttrs = { ...p.attributes };
  applyInjury(
    p,
    {
      eventId: "dmg",
      kind: "match",
      severity: "severe",
      startDay: 100,
      durationDays: 50,
      expectedReturnDay: 150,
      temporaryEffects: { overallPenalty: 6, scale: 1, attributePenalties: {} },
      returnReadiness: 0.55,
    },
    { rng: createRng(6) }
  );
  advanceHealth(p, 200);
  const damagedKeys = Object.entries(p.health.durableDamage || {}).filter(([, v]) => v > 0);
  assert.ok(damagedKeys.length > 0, "expected nonzero tracked durable damage");
  const damageBefore = JSON.stringify(p.health.durableDamage);
  const attrsBeforeEvidence = JSON.stringify(p.attributes);
  const recoverableBefore = JSON.stringify(p.health.recoverableDamage);
  const r = detail(p.health);
  assert.equal(r.injuredDays, 0);
  assert.equal(JSON.stringify(p.health.durableDamage), damageBefore);
  assert.equal(JSON.stringify(p.attributes), attrsBeforeEvidence);
  assert.equal(JSON.stringify(p.health.recoverableDamage), recoverableBefore);
  assert.ok(healthHistoryHas(p, "dmg"));
  for (const [k, lost] of damagedKeys) {
    assert.ok(p.attributes[k] < beforeAttrs[k], `${k} should remain below pre-injury`);
    assert.ok(lost > 0);
  }
  writeFileSync(
    `${OUT}/cases/B-durable-damage-preserved.json`,
    JSON.stringify(
      {
        seed: 6,
        durableDamage: p.health.durableDamage,
        injuredDays: r.injuredDays,
        attrsAfter: p.attributes,
      },
      null,
      2
    )
  );
});

function healthHistoryHas(player, eventId) {
  return (player.health.injuryHistory || []).some((h) => h.eventId === eventId);
}

/* ------------------------------------------------------------------ */
/* C. Full completed-season integration                                */
/* ------------------------------------------------------------------ */

function makeSeasonPlayer({ seed, position = "ST", rating = 72, oldInjury = null, activeInjury = null, clubIndex = 0, leagueId = "league:england-premier-league" } = {}) {
  resetClubFinanceLedgers();
  reseedCareerRng(seed);
  setWorldState(createWorldState({ startYear: 2026 }));
  const league = LEAGUE_BY_ID.get(leagueId) || LEAGUES[0];
  const club = league.clubs[Math.min(clubIndex, league.clubs.length - 1)];
  const p = createPlayerIdentity({
    name: `Fix06-${position}-${seed}`,
    nationality: "England",
    position,
    age: 19,
  });
  p.startYear = 2026;
  p.rating = rating;
  p.potential = 88;
  p.attributes = makeAttrs(position);
  for (const k of Object.keys(p.attributes)) p.attributes[k] = rating - (k === "Defending" ? 8 : 0);
  if (position === "GK") {
    p.attributes = {
      Diving: rating,
      Handling: rating,
      Kicking: rating - 2,
      Reflexes: rating,
      Speed: Math.max(40, rating - 15),
      Positioning: rating,
    };
  }
  ensurePlayerModel(p);
  refreshAbilityCaches(p);
  p.club = {
    ...club,
    league: league.name,
    leagueDisplay: league.displayName,
    leagueId: league.leagueId,
    nation: league.nation,
    isAcademy: false,
  };
  p.employmentClubId = club.clubId;
  p.playingClubId = club.clubId;
  p.careerId = `fix06-${seed}-${position}`;
  p.contractStartSeason = 0;
  p.contractYears = 5;
  p.contractEndSeason = 5;
  p.weeklyWage = 5000;
  p.health = createEmptyHealth();
  if (oldInjury) p.health.injuryHistory.push(oldInjury);
  if (activeInjury) p.health.activeInjury = { ...activeInjury };
  ensurePlayingStints(p, { asOfDate: "2026-06-01" });
  return p;
}

const OLD_INJURY = {
  eventId: "old-pre-period",
  startDay: 100,
  expectedReturnDay: 400,
  recoveredDay: 400,
  durationDays: 300,
  severity: "minor",
};

/** Deterministic seed with no new overlapping injuries (search recorded 2026-10-29). */
const CLEAN_OLD_INJURY_SEED = 2;

test("C: simulateSeason old injury → zero missed, credit 1 (seed 2)", () => {
  const p = makeSeasonPlayer({ seed: CLEAN_OLD_INJURY_SEED, oldInjury: OLD_INJURY });
  const period = resolveDevelopmentPeriod(p, { seasonIndex: 0 });
  const result = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, { autoDecisionPolicy: "stay" });
  const season = result.season;
  assert.ok(season?.seasonEvidence, "season evidence present");
  assert.ok(season.developmentPeriod, "development period persisted");
  assert.equal(season.developmentPeriod.startDate, period.periodStartDate);
  assert.equal(season.developmentPeriod.endExclusiveDate, period.periodEndExclusiveDate);
  assert.equal(season.developmentPeriod.days, period.periodDays);
  assert.notEqual(season.seasonEvidence.health?.windowStartDay, null);
  assert.equal(season.seasonEvidence.health.injuredDays, 0);
  assert.equal(season.seasonEvidence.healthyTrainingFraction, 1);
  assert.equal(season.developmentBreakdown?.healthyTrainingFraction, 1);
  assert.equal(season.seasonEvidence.health.hasDatedWindow, true);
  assert.notEqual(season.seasonEvidence.health.method, "history-durations");
  // Old injury still in history but contributes zero overlap.
  assert.ok(p.health.injuryHistory.some((h) => h.eventId === OLD_INJURY.eventId));
  writeFileSync(
    `${OUT}/cases/C-old-injury-seed-2.json`,
    JSON.stringify(
      {
        seed: CLEAN_OLD_INJURY_SEED,
        seedSearchNote: "searched 1..5000 for injuredDays===0 with makeSeasonPlayer+OLD_INJURY",
        period: season.developmentPeriod,
        evidence: season.seasonEvidence,
        breakdown: season.developmentBreakdown,
      },
      null,
      2
    )
  );
});

test("C: healthy control matches old-history development input", () => {
  const withOld = makeSeasonPlayer({ seed: CLEAN_OLD_INJURY_SEED, oldInjury: OLD_INJURY });
  const healthy = makeSeasonPlayer({ seed: CLEAN_OLD_INJURY_SEED });
  // Clone attributes/state before season so development starts identical.
  healthy.attributes = { ...withOld.attributes };
  healthy.health = createEmptyHealth();
  refreshAbilityCaches(withOld);
  refreshAbilityCaches(healthy);
  const period = resolveDevelopmentPeriod(withOld, { seasonIndex: 0 });
  const evOld = buildSeasonEvidence(withOld, {
    seasonId: "probe",
    developmentPeriod: period,
    seasonStartDay: period.periodStartDay,
    seasonEndDay: period.periodEndDay,
    requireDatedHealthWindow: true,
  });
  const evHealthy = buildSeasonEvidence(healthy, {
    seasonId: "probe",
    developmentPeriod: period,
    seasonStartDay: period.periodStartDay,
    seasonEndDay: period.periodEndDay,
    requireDatedHealthWindow: true,
  });
  assert.equal(evOld.healthyTrainingFraction, evHealthy.healthyTrainingFraction);
  assert.equal(evOld.health.injuredDays, 0);
  assert.equal(evHealthy.health.injuredDays, 0);
});

test("C: carry-in injury clipped to period", () => {
  const period = resolveDevelopmentPeriod({ startYear: 2026, seasons: [] }, { seasonIndex: 0 });
  const carry = {
    eventId: "carry-in",
    startDay: period.periodStartDay - 10,
    expectedReturnDay: period.periodStartDay + 10,
    durationDays: 20,
    temporaryEffects: { overallPenalty: 1, scale: 1, attributePenalties: {} },
    returnReadiness: 0.9,
    severity: "minor",
    kind: "match",
  };
  const p = makeSeasonPlayer({ seed: 611, activeInjury: carry });
  // Mark event applied so season path won't double-apply.
  p.development = p.development || {};
  p.development.appliedEventIds = { [`injury:${carry.eventId}`]: true };
  const result = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, { autoDecisionPolicy: "stay" });
  const season = result.season;
  const S = season.developmentPeriod.startDay;
  const E = season.developmentPeriod.endDay;
  const hist = [...(p.health.injuryHistory || [])];
  if (p.health.activeInjury) hist.push(p.health.activeInjury);
  const intervals = [];
  for (const rec of hist) {
    const a = rec.startDay ?? rec.onsetDay;
    const b = availabilityReturnDayOf(rec);
    if (a != null && b != null && b > a) intervals.push([a, b]);
  }
  const oracle = oracleUnionDays(intervals, S, E);
  assert.equal(season.seasonEvidence.health.injuredDays, oracle);
  approx(
    season.seasonEvidence.rawHealthyTrainingFraction,
    clamp01(1 - oracle / season.developmentPeriod.days)
  );
  assert.equal(
    season.seasonEvidence.healthyTrainingFraction,
    Math.max(HEALTHY_FRACTION_FLOOR, season.seasonEvidence.rawHealthyTrainingFraction)
  );
  writeFileSync(
    `${OUT}/cases/C-carry-in-611.json`,
    JSON.stringify({ oracle, evidence: season.seasonEvidence, period: season.developmentPeriod }, null, 2)
  );
});

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

test("C: two consecutive periods — year-1 injury zero in year-2", () => {
  const p = makeSeasonPlayer({ seed: 620, oldInjury: null });
  const period0 = resolveDevelopmentPeriod(p, { seasonIndex: 0 });
  // Force a year-1 injury fully inside period 0.
  p.health.injuryHistory.push({
    eventId: "y1-only",
    startDay: period0.periodStartDay + 30,
    expectedReturnDay: period0.periodStartDay + 60,
    recoveredDay: period0.periodStartDay + 60,
    durationDays: 30,
  });
  simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, { autoDecisionPolicy: "stay" });
  const s1 = p.seasons[0];
  assert.ok(s1.seasonEvidence.health.injuredDays >= 30);
  // Second season
  const result2 = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, { autoDecisionPolicy: "stay" });
  const s2 = result2.season;
  // y1-only must not contribute; new injuries may exist — subtract only y1-only from oracle check
  const S = s2.developmentPeriod.startDay;
  const E = s2.developmentPeriod.endDay;
  const y1 = p.health.injuryHistory.find((h) => h.eventId === "y1-only");
  assert.ok(y1, "history retained");
  const y1Overlap = oracleUnionDays([[y1.startDay, availabilityReturnDayOf(y1)]], S, E);
  assert.equal(y1Overlap, 0);
});

test("C: low minutes does not shrink training calendar", () => {
  const p = makeSeasonPlayer({ seed: CLEAN_OLD_INJURY_SEED, rating: 55, clubIndex: 15 });
  const result = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, { autoDecisionPolicy: "stay" });
  const season = result.season;
  assert.equal(season.developmentPeriod.days, 365);
  assert.equal(season.seasonEvidence.health.seasonDays, 365);
});

test("C: GK uses same availability accounting", () => {
  const p = makeSeasonPlayer({ seed: 3, position: "GK", oldInjury: OLD_INJURY });
  const result = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, { autoDecisionPolicy: "stay" });
  assert.equal(result.season.seasonEvidence.health.injuredDays, 0);
  assert.equal(result.season.seasonEvidence.healthyTrainingFraction, 1);
});

test("C: requireDatedHealthWindow rejects bare seasonDays", () => {
  const p = makeSeasonPlayer({ seed: 1 });
  assert.throws(
    () =>
      buildSeasonEvidence(p, {
        seasonId: "x",
        seasonDays: 300,
        requireDatedHealthWindow: true,
      }),
    /dated health window/
  );
});

/* ------------------------------------------------------------------ */
/* D. Pause, move, snapshot                                            */
/* ------------------------------------------------------------------ */

function pauseToDecision(player, { scenarioPolicy = "balanced" } = {}) {
  let seasonData = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: true,
    autoDecisionPolicy: null,
  });
  let guards = 0;
  while (seasonData?.awaitingScenario && guards < 12) {
    guards += 1;
    const pending =
      player.pendingSeniorScenario ||
      seasonData.pendingSeniorScenario ||
      seasonData.checkpoint?.pendingSeniorScenario ||
      null;
    assert.ok(pending, "awaitingScenario requires pendingSeniorScenario");
    const applied = applySeniorScenarioPolicy(player, pending, scenarioPolicy);
    assert.ok(applied && applied.ok !== false, `scenario policy failed: ${applied?.reason}`);
    player.pendingSeniorScenario = null;
    if (seasonData.checkpoint) seasonData.checkpoint.pendingSeniorScenario = null;
    player.seasonCheckpoint = seasonData.checkpoint;
    seasonData = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions: true,
      autoDecisionPolicy: null,
    });
  }
  assert.ok(seasonData?.awaitingDecision || seasonData?.checkpoint, "must pause");
  return seasonData;
}

test("D: pause/resume preserves period and exact-once development", () => {
  // Run the uninterrupted twin to completion first, then build the paused
  // player on a freshly reseated world (same order as the audit harness).
  const uninterrupted = makeSeasonPlayer({ seed: 640, oldInjury: OLD_INJURY });
  simulateSeason(uninterrupted, LEAGUES, LEAGUE_LOOKUP, { autoDecisionPolicy: "stay" });
  const u = uninterrupted.seasons[0];

  const pausedPlayer = makeSeasonPlayer({ seed: 640, oldInjury: OLD_INJURY });
  const paused = pauseToDecision(pausedPlayer);
  assert.ok(paused.checkpoint?.developmentPeriod, "checkpoint carries period");
  assert.equal(pausedPlayer.age, 19, "age not advanced at pause");
  assert.equal(pausedPlayer.seasons.length, 0, "no finalized season at pause");

  const snap = serializeCareerSnapshot({
    player: pausedPlayer,
    world: getWorldState(),
    checkpoint: paused.checkpoint,
  });
  const restored = deserializeCareerSnapshot(JSON.parse(JSON.stringify(snap)));
  setWorldState(restored.world);
  if (snap.rngSeed != null) setSimRng(createRng(snap.rngSeed));
  const rp = restored.player;
  // Resolve stay (matched policy with uninterrupted twin).
  rp.pendingDecision = null;
  rp.pendingOffers = [];
  if (rp.seasonCheckpoint) {
    rp.seasonCheckpoint.decision = null;
    rp.seasonCheckpoint.offers = [];
  }
  const done = simulateSeason(rp, LEAGUES, LEAGUE_LOOKUP, {
    autoDecisionPolicy: "stay",
    pauseForDecisions: false,
  });
  const s = done.season;
  assert.equal(s.developmentPeriod.startDate, u.developmentPeriod.startDate);
  assert.equal(s.developmentPeriod.endExclusiveDate, u.developmentPeriod.endExclusiveDate);
  assert.equal(s.developmentPeriod.days, u.developmentPeriod.days);
  assert.equal(s.seasonEvidence.healthyTrainingFraction, u.seasonEvidence.healthyTrainingFraction);
  assert.equal(s.seasonEvidence.health.injuredDays, u.seasonEvidence.health.injuredDays);
  assert.deepEqual(rp.attributes, uninterrupted.attributes);
  assert.equal(rp.seasons.length, 1);
  assert.equal(rp.development.lastProcessedSeasonId, "season-1");
  const evidenceBefore = JSON.stringify(rp.seasons[0].seasonEvidence);
  const ageBefore = rp.age;
  // Re-finalize same period id must refuse (exact-once).
  rp.seasons.pop();
  assert.throws(
    () => simulateSeason(rp, LEAGUES, LEAGUE_LOOKUP, { autoDecisionPolicy: "stay" }),
    /already applied/
  );
  assert.equal(rp.age, ageBefore);
  assert.equal(rp.seasons.length, 0);
  // Restore season row for later assertions / cleanup.
  rp.seasons.push(JSON.parse(JSON.stringify(s)));
  assert.equal(JSON.stringify(rp.seasons[0].seasonEvidence), evidenceBefore);
});

test("D: legacy checkpoint without window fields completes via simulateSeason", () => {
  const p = makeSeasonPlayer({ seed: 650, oldInjury: OLD_INJURY });
  const paused = pauseToDecision(p);
  const ck = structuredClone(paused.checkpoint || p.seasonCheckpoint);
  assert.ok(ck, "need a real paused checkpoint");
  const expected = resolveDevelopmentPeriod(p, {
    seasonIndex: ck.seasonIndex,
    seasonStartYear: ck.seasonStartYear,
  });
  delete ck.developmentPeriod;
  assert.equal(ck.developmentPeriod, undefined);

  p.seasonCheckpoint = ck;
  p.pendingDecision = null;
  p.pendingOffers = [];
  if (p.seasonCheckpoint) {
    p.seasonCheckpoint.decision = null;
    p.seasonCheckpoint.offers = [];
  }
  const snap = serializeCareerSnapshot({
    player: p,
    world: getWorldState(),
    checkpoint: ck,
  });
  const restored = deserializeCareerSnapshot(JSON.parse(JSON.stringify(snap)));
  setWorldState(restored.world);
  if (snap.rngSeed != null) setSimRng(createRng(snap.rngSeed));
  const rp = restored.player;
  rp.pendingDecision = null;
  rp.pendingOffers = [];
  if (rp.seasonCheckpoint) {
    delete rp.seasonCheckpoint.developmentPeriod;
    rp.seasonCheckpoint.decision = null;
    rp.seasonCheckpoint.offers = [];
  }
  const done = simulateSeason(rp, LEAGUES, LEAGUE_LOOKUP, {
    autoDecisionPolicy: "stay",
    pauseForDecisions: false,
  });
  const season = done.season;
  assert.equal(season.developmentPeriod.startDate, expected.periodStartDate);
  assert.equal(season.developmentPeriod.endExclusiveDate, expected.periodEndExclusiveDate);
  assert.equal(season.developmentPeriod.days, expected.periodDays);
  assert.equal(season.seasonEvidence.health.hasDatedWindow, true);
  writeFileSync(
    `${OUT}/cases/D-legacy-checkpoint-reconstruct.json`,
    JSON.stringify(
      {
        seed: 650,
        removedField: "developmentPeriod",
        reconstructed: season.developmentPeriod,
        injuredDays: season.seasonEvidence.health.injuredDays,
      },
      null,
      2
    )
  );
});

test("D: midseason transfer preserves original period window", () => {
  const p = makeSeasonPlayer({ seed: 660, oldInjury: OLD_INJURY });
  const paused = pauseToDecision(p);
  const ck = paused.checkpoint || p.seasonCheckpoint;
  const periodBefore = ck.developmentPeriod;
  const brentford =
    allSeniorClubs().find((c) => c.clubId === "club:england:brentford") ||
    LEAGUE_BY_ID.get("league:england-premier-league").clubs.find((c) => c.clubId === "club:england:brentford");
  const offer = {
    club: brentford.name,
    clubDisplay: brentford.displayName,
    clubId: brentford.clubId,
    league: brentford.league || "England - Premier League",
    leagueDisplay: brentford.leagueDisplay || "Premier League",
    leagueId: brentford.leagueId || "league:england-premier-league",
    nation: brentford.nation || "England",
    tier: brentford.tier,
    badge: brentford.badge,
    overall: brentford.overall,
    isLoan: false,
    wage: 6000,
    contractYears: 3,
    expectedRole: "starter",
    reviewDate: ck.lastDate,
    effectiveDate: ck.lastDate,
    registration: resolveMoveRegistration({
      destinationLeagueId: brentford.leagueId || "league:england-premier-league",
      departureDate: ck.lastDate,
      originSeasonStartYear: 2026,
    }),
  };
  applyOfferToPlayer(p, offer, "fix06-transfer-1");
  p.pendingOffers = [];
  p.pendingDecision = null;
  const done = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: null,
  });
  const season = done.season;
  assert.equal(season.developmentPeriod.startDate, periodBefore.startDate);
  assert.equal(season.developmentPeriod.endExclusiveDate, periodBefore.endExclusiveDate);
  assert.equal(season.developmentPeriod.days, periodBefore.days);
  assert.equal(p.playingClubId, brentford.clubId);
});

// Finalize report
setTimeout(() => {
  const summary = {
    ok: !process.exitCode,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
  writeFileSync(`${OUT}/focused-test-summary.json`, JSON.stringify(summary, null, 2));
  console.log(`\nFocused Fix 06 tests: ${summary.passed} passed, ${summary.failed} failed`);
}, 0);
