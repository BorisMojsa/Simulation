/**
 * Fix 11 — full-career growth calibration acceptance tests (F01–F20).
 * Run:            node --test tests/fullCareerGrowthCalibration.test.mjs
 * Regenerate QA:  FIX11_WRITE_CASES=1 node --test tests/fullCareerGrowthCalibration.test.mjs
 *
 * Real behaviour checks only (no source-text greps). Oracles are recomputed from
 * config tables / first principles, not from the production allocators. All
 * randomness comes from createRng(); Math.random is never used (F15 traps it).
 *
 * F01–F20 map directly to the Fix 11 brief IDs.
 * Each test also records its inputs/expectations into qa/fix11-runs/cases/Fxx.json;
 * the final F00 test verifies (or, with FIX11_WRITE_CASES=1, regenerates) them.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createRng, getSimRng, setSimRng } from "../js/simulation/rng.js";
import {
  DEVELOPMENT_CAPS,
  GK_OVERALL_WEIGHTS,
  OUTFIELD_OVERALL_WEIGHTS,
  PERFORMANCE,
  POSITION_MATURATION,
  POSITION_ROLE_GROUP,
  RECOGNITION_CONFIG,
} from "../js/config/playerDevelopmentConfig.js";
import { computeMatchRating } from "../js/simulation/matchEngine.js";
import { computePerformanceObservation } from "../js/simulation/playerSeasonLedger.js";
import {
  alreadyAppliedLearningForPeriod,
  applyAcademyGrowth,
  applyScenarioAbilityChange,
  computeRecognitionContribution,
  developSeason,
  ensureLearningPeriodLedger,
  generateStartingAttributes,
  initializePlayerDevelopment,
  periodPositiveLearningUsed,
} from "../js/simulation/playerDevelopmentModel.js";
import {
  calculateOverall,
  getBaseOverall,
  getDisplayAttributeKeys,
  refreshAbilityCaches,
} from "../js/simulation/playerAbility.js";
import { applyRecoverableRestoration } from "../js/simulation/playerHealth.js";
import { forecastPotential, getOrUpdateForecast } from "../js/simulation/playerPotential.js";
import {
  applyAcademyBaselineTraining,
  applyOpeningMoment,
  applySkipOpeningDevelopment,
  ensureAcademyOpeningState,
} from "../js/simulation/academyOpening.js";
import { createPlayerIdentity, finalizeAcademyPlayer } from "../js/simulation/playerDevelopment.js";
import { attachRecognitionToEvidence, evidenceToDevelopmentContext } from "../js/simulation/seasonEvidence.js";
import { buildSeasonEvidence } from "../js/simulation/seasonEvidence.js";
import { migratePlayerToV2 } from "../js/simulation/playerModelMigration.js";
import { roundAbilityForDisplay } from "../js/ui/abilityFormatting.js";
import { ACADEMY_POOL } from "../js/data/leagues.js";
import {
  FIX11_SCHEMA_VERSION,
  assessRun,
  clonePlayerForPairing,
  validateDriverGuard,
  validateDriverSeasonResult,
} from "../scripts/lib/fix11GrowthEvidence.mjs";
import {
  loadWitnessIndex,
  validateWitnessClaim,
  validateWitnessLookup,
} from "../scripts/calibrateFullCareerGrowth.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(HERE, "..", "qa", "fix11-runs", "cases");
const WRITE_CASES = process.env.FIX11_WRITE_CASES === "1";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const near = (a, b, eps = 1e-6, msg = "") =>
  assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} !~ ${b} (eps ${eps})`);

/** Independent oracle weights straight from config tables. */
function cfgWeights(position) {
  return position === "GK" ? GK_OVERALL_WEIGHTS : OUTFIELD_OVERALL_WEIGHTS[position];
}

/** Independent weighted overall: sum_k w_k * attr_k. */
function oracleOverall(attrs, position) {
  const w = cfgWeights(position);
  return Object.keys(w).reduce((s, k) => s + w[k] * attrs[k], 0);
}

/** sum_k w_k * delta_k for a per-attribute delta map. */
function oracleWeightedSum(delta, position) {
  const w = cfgWeights(position);
  return Object.keys(w).reduce((s, k) => s + w[k] * (delta?.[k] || 0), 0);
}

function makePlayer({ position = "CM", target = 70, age = 20, seed = 42 } = {}) {
  const rng = createRng(seed);
  const attributes = generateStartingAttributes(position, target, 99, rng);
  const player = {
    name: `F11-${position}-${target}-${age}-${seed}`,
    nationality: "Testland",
    careerId: `f11-${position}-${target}-${age}-${seed}`,
    position,
    age,
    attributes,
    rating: target,
  };
  initializePlayerDevelopment(player, { rng });
  return player;
}

const clonePlayer = (p) => structuredClone(p);

const BASE_CTX = Object.freeze({
  elapsedYears: 1,
  usefulMinutes: 3000,
  healthyTrainingFraction: 1,
  reliability: 0.9,
  P_long: 0.6,
  environmentMultiplier: 1,
});

function develop(player, overrides = {}, rngSeed = 5678) {
  return developSeason(player, {
    ...BASE_CTX,
    rng: createRng(rngSeed),
    seasonId: overrides.seasonId ?? `f11-${Math.abs(rngSeed)}`,
    ...overrides,
  });
}

function makeAcademyPlayer(name = "Fix11Academy", position = "CM") {
  const p = createPlayerIdentity({ name, nationality: "England", position, age: 16 });
  finalizeAcademyPlayer(p, ACADEMY_POOL[0]);
  ensureAcademyOpeningState(p);
  return p;
}

function moment(p, id, delta, effect = "ability") {
  return applyOpeningMoment(p, {
    scenario: { id: "sc" },
    choice: { id: "ch" },
    outcome: { id: `o-${id}`, delta, effect },
    momentIndex: id,
    applicationId: `app-${id}`,
  });
}

/* ------------------------------------------------------------------ */
/* QA case recording                                                   */
/* ------------------------------------------------------------------ */

const CASES = {};
function rec(id, title, patch = {}) {
  const c = (CASES[id] ||= { id, title, inputs: {}, expected: {}, notes: [] });
  if (title && !c.title) c.title = title;
  if (patch.inputs) Object.assign(c.inputs, patch.inputs);
  if (patch.expected) Object.assign(c.expected, patch.expected);
  if (patch.notes) c.notes.push(...[].concat(patch.notes));
  return c;
}

function roundDeep(v) {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 1e9) / 1e9 : null;
  if (Array.isArray(v)) return v.map(roundDeep);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, roundDeep(x)]));
  return v;
}

function compareExpected(stored, actual, path, errors) {
  if (typeof actual === "number") {
    if (typeof stored !== "number" || Math.abs(stored - actual) > 1e-6) errors.push(`${path}: ${stored} !~ ${actual}`);
  } else if (Array.isArray(actual)) {
    if (!Array.isArray(stored) || stored.length !== actual.length) errors.push(`${path}: array mismatch`);
    else actual.forEach((a, i) => compareExpected(stored[i], a, `${path}[${i}]`, errors));
  } else if (actual && typeof actual === "object") {
    for (const k of Object.keys(actual)) compareExpected(stored?.[k], actual[k], `${path}.${k}`, errors);
  } else if (stored !== actual) {
    errors.push(`${path}: ${JSON.stringify(stored)} !== ${JSON.stringify(actual)}`);
  }
}

/* ================================================================== */
/* F01 — Academy charges once; import once; later charges kept         */
/* ================================================================== */

test("F01a academy baseline training is charged exactly once", () => {
  const p = makeAcademyPlayer("F01a");
  const before = oracleOverall(p.attributes, p.position);
  const res = applyAcademyBaselineTraining(p, { rng: createRng(7), forceFactor: 1 });
  const gain = oracleOverall(p.attributes, p.position) - before;
  assert.ok(gain > 0.3, `baseline should give a real gain, got ${gain}`);
  near(res.realized, gain, 1e-9);
  near(p.academyOpening.positiveLearningApplied, gain, 1e-9, "opening receipt");
  near(p.development.academyGrowthApplied, gain, 1e-9, "academyGrowthApplied (single charge)");
  // Importing into the period ledger charges the same gain once.
  near(periodPositiveLearningUsed(p, "season-1"), gain, 1e-9, "period import");
  near(periodPositiveLearningUsed(p, "season-1"), gain, 1e-9, "second read must not re-import");
  assert.equal(p.development.academyGrowthApplied, 0, "counter consumed by import");
  // Re-running baseline is a no-op.
  const again = applyAcademyBaselineTraining(p, { rng: createRng(8), forceFactor: 1 });
  assert.equal(again.skipped, true);
  near(periodPositiveLearningUsed(p, "season-1"), gain, 1e-9);
  rec("F01", "Academy charges once, import once, later charges kept", {
    inputs: { baseline: { forceFactor: 1, rngSeed: 7 } },
    expected: { baselineChargedEqualsActualGain: true, secondBaselineSkipped: true, baselineGainPositive: gain > 0.3 },
  });
});

test("F01b academy interactive moments charge each realized gain once; duplicate application ignored", () => {
  const p = makeAcademyPlayer("F01b");
  const before = oracleOverall(p.attributes, p.position);
  const m1 = moment(p, 1, 2);
  const m2 = moment(p, 2, 1);
  const dup = moment(p, 1, 2);
  assert.equal(dup.duplicate, true);
  const gain = oracleOverall(p.attributes, p.position) - before;
  assert.ok(m1.realizedRaw > 0 && m2.realizedRaw > 0);
  near(m1.realizedRaw + m2.realizedRaw, gain, 1e-9);
  near(p.academyOpening.positiveLearningApplied, gain, 1e-9);
  near(p.development.academyGrowthApplied, gain, 1e-9, "no duplicate charge from academyOpening");
  near(periodPositiveLearningUsed(p, "season-1"), gain, 1e-9);
  rec("F01", null, { inputs: { moments: [{ delta: 2 }, { delta: 1 }, { duplicateOf: 1 }] }, expected: { duplicateIgnored: true } });
});

test("F01c skip opening path charges baseline once at factor 0.85", () => {
  const p = makeAcademyPlayer("F01c");
  const before = oracleOverall(p.attributes, p.position);
  const res = applySkipOpeningDevelopment(p);
  const gain = oracleOverall(p.attributes, p.position) - before;
  assert.ok(gain > 0);
  near(res.realized, gain, 1e-9);
  near(p.development.academyGrowthApplied, gain, 1e-9);
  near(p.academyOpening.positiveLearningApplied, gain, 1e-9);
  near(periodPositiveLearningUsed(p, "season-1"), gain, 1e-9);
  rec("F01", null, { inputs: { skip: { forceFactor: 0.85 } }, expected: { skipChargedOnce: true } });
});

test("F01d academy floor lift is charged once", () => {
  const p = makeAcademyPlayer("F01d");
  for (const k of getDisplayAttributeKeys(p.position)) p.attributes[k] = 47;
  refreshAbilityCaches(p);
  const res = moment(p, 1, -1); // tiny loss → rating < 50 → floor lift
  assert.equal(res.limitedBy, "clamp-floor");
  const lifted = p.academyOpening.positiveLearningApplied;
  assert.ok(lifted > 2, `floor lift should be ~3 points, got ${lifted}`);
  near(p.development.academyGrowthApplied, lifted, 1e-9, "floor lift charged once");
  near(periodPositiveLearningUsed(p, "season-1"), lifted, 1e-9);
  // Independent check: net overall = start - tiny loss + lift
  const net = oracleOverall(p.attributes, p.position);
  near(net, 47 + res.realizedRaw, 1e-9);
  rec("F01", null, { inputs: { floor: { startAttrs: 47, moment: -1 } }, expected: { limitedBy: "clamp-floor", liftApprox: Math.round(lifted * 100) / 100 } });
});

test("F01e later valid academy charges are not discarded after an import", () => {
  const p = makeAcademyPlayer("F01e");
  applyAcademyBaselineTraining(p, { rng: createRng(7), forceFactor: 1 });
  const G = p.academyOpening.positiveLearningApplied;
  near(periodPositiveLearningUsed(p, "season-1"), G, 1e-9);
  // Later valid charge in the same open period.
  const H = applyAcademyGrowth(p, 1.0, { rng: createRng(3), alreadyAppliedLearningGain: G }).realized;
  assert.ok(H > 0.5);
  near(periodPositiveLearningUsed(p, "season-1"), G + H, 1e-9, "later charge must import");
  near(ensureLearningPeriodLedger(p, "season-1").academyImported, G + H, 1e-9);
  near(periodPositiveLearningUsed(p, "season-1"), G + H, 1e-9, "idempotent");
  // Finalized period: do not import into it and do not lose the receipt.
  ensureLearningPeriodLedger(p, "season-1").finalized = true;
  const K = applyAcademyGrowth(p, 0.5, { rng: createRng(4), alreadyAppliedLearningGain: 0 }).realized;
  near(periodPositiveLearningUsed(p, "season-1"), G + H, 1e-9, "finalized ledger unchanged");
  near(p.development.academyGrowthApplied, K, 1e-9, "receipt kept for next open period");
  near(periodPositiveLearningUsed(p, "season-2"), K, 1e-9, "carried into next open period once");
  assert.equal(p.development.academyGrowthApplied, 0);
  rec("F01", null, { inputs: { sequence: ["baseline", "import", "later +1.0", "import", "finalize", "later +0.5", "import season-2"] }, expected: { laterChargesKept: true } });
});

/* ================================================================== */
/* F02 — Shared allowance                                              */
/* ================================================================== */

test("F02 academy + scenes + season + recognition + positive shocks share one allowance; negatives never refund", () => {
  const p = makePlayer({ position: "CM", target: 60, age: 19, seed: 21 });
  const PID = "season-F02";
  const A = applyAcademyGrowth(p, 2.5, { rng: createRng(1), alreadyAppliedLearningGain: 0 }).realized;
  const S1 = applyScenarioAbilityChange(p, { eventId: "e1", periodId: PID, requestedRaw: 3, focus: "technique" }).realizedRaw;
  assert.ok(A > 2 && S1 > 2, `charges ${A} ${S1}`);
  const used = periodPositiveLearningUsed(p, PID);
  near(used, A + S1, 1e-9, "academy imported + scene");
  // Negative scene result must not refund.
  const neg = applyScenarioAbilityChange(p, { eventId: "e2", periodId: PID, requestedRaw: -1.2, focus: "routine" });
  assert.ok(neg.realizedRaw < 0);
  near(periodPositiveLearningUsed(p, PID), A + S1, 1e-9, "negative scene refunds nothing");
  // Season with recognition + positive shocks consumes only the remaining room.
  const r = develop(p, {
    periodId: PID,
    seasonId: "S-F02",
    alreadyAppliedLearningGain: alreadyAppliedLearningForPeriod(p, PID),
    P_long: 0.8,
    reliability: 1,
    recognition: { contribution: 1.4 },
  });
  const gross = r.components.learning + r.components.recognition + r.components.positiveShock;
  const cap = r.caps.annualCap;
  assert.ok(gross >= 0 && gross <= cap - (A + S1) + 1e-9, `season gross ${gross} must fit remaining room ${cap - (A + S1)}`);
  assert.equal(r.caps.limitedBy, "annual-cap");
  near(A + S1 + gross, cap, 1e-9, "allowance fully, but not over-, consumed");
  near(r.breakdown.annualAllowanceUsed, gross, 1e-9);
  const ledger = ensureLearningPeriodLedger(p, PID);
  near(ledger.positiveUsed, A + S1 + gross, 1e-9, "ledger = every gross positive, negatives not netted");
  assert.ok(r.components.ageing <= 0 && ledger.sceneNegative > 0);
  rec("F02", "Shared allowance across academy/scene/season/recognition/shock", {
    inputs: { position: "CM", target: 60, age: 19, steps: ["academy +2.5", "scene +3", "scene -1.2", "season P=.8 rec=1.4"] },
    expected: { cap, academyPlusScenePlusSeasonGrossWithinCap: true, negativeRefunds: 0, limitedBy: "annual-cap" },
  });
});

/* ================================================================== */
/* F03 — Finalized period rejection / idempotency                      */
/* ================================================================== */

test("F03 finalized period rejects scenario/season growth; duplicate event and season are idempotent", () => {
  const p = makePlayer({ position: "ST", target: 65, age: 21, seed: 31 });
  const PID = "season-F03";
  // Duplicate scenario event: applied once.
  const s1 = applyScenarioAbilityChange(p, { eventId: "dupe", periodId: PID, requestedRaw: 1.5 });
  const afterFirst = { ...p.attributes };
  const s2 = applyScenarioAbilityChange(p, { eventId: "dupe", periodId: PID, requestedRaw: 1.5 });
  assert.equal(s1.duplicate, false);
  assert.equal(s2.duplicate, true);
  assert.deepEqual(p.attributes, afterFirst, "duplicate must not move attributes");
  near(ensureLearningPeriodLedger(p, PID).positiveUsed, s1.realizedRaw, 1e-9, "single charge");
  // Duplicate season: applied once.
  const r1 = develop(p, { periodId: PID, seasonId: "S-F03" });
  const afterSeason = { ...p.attributes };
  const r2 = develop(p, { periodId: PID, seasonId: "S-F03" }, 99);
  assert.equal(r1.skipped, false);
  assert.equal(r2.skipped, true);
  assert.equal(r2.reason, "season-already-applied");
  assert.deepEqual(p.attributes, afterSeason);
  // Finalize: everything further is rejected.
  ensureLearningPeriodLedger(p, PID).finalized = true;
  const usedBefore = ensureLearningPeriodLedger(p, PID).positiveUsed;
  const scenPos = applyScenarioAbilityChange(p, { eventId: "late+", periodId: PID, requestedRaw: 2 });
  const scenNeg = applyScenarioAbilityChange(p, { eventId: "late-", periodId: PID, requestedRaw: -2 });
  const late = develop(p, { periodId: PID, seasonId: "S-F03-late" }, 7);
  for (const s of [scenPos, scenNeg]) {
    assert.equal(s.rejected, true);
    assert.equal(s.limitedBy, "period-finalized");
    assert.equal(s.realizedRaw, 0);
  }
  assert.equal(late.skipped, true);
  assert.equal(late.reason, "period-finalized");
  assert.deepEqual(p.attributes, afterSeason, "finalized period leaves attributes untouched");
  near(ensureLearningPeriodLedger(p, PID).positiveUsed, usedBefore, 1e-12);
  assert.ok(!(p.development.appliedEventIds["season:S-F03-late"]), "rejected season is not marked applied");
  rec("F03", "Finalized period rejects growth; duplicates idempotent", {
    inputs: { position: "ST", target: 65, age: 21, periodId: PID },
    expected: { duplicateScenario: "ignored", duplicateSeason: "season-already-applied", afterFinalize: "period-finalized" },
  });
});

/* ================================================================== */
/* F04 — Recognition units (independent weighted-sum oracle)           */
/* ================================================================== */

for (const position of ["ST", "CM", "CB", "GK"]) {
  test(`F04 recognition contribution 1.0 yields components.recognition ≈ 1.0 uncapped (${position})`, () => {
    const w = cfgWeights(position);
    const p = makePlayer({ position, target: 70, age: 20, seed: 42 });
    const r = develop(p, { P_long: 0.6, reliability: 0.9, recognition: { contribution: 1.0 }, seasonId: `f04-${position}` });
    assert.equal(r.caps.limitedBy, "none");
    near(r.caps.scale, 1, 1e-12, "uncapped precondition");
    // Oracle 1: independent weighted sum of the production per-attribute recognition deltas.
    const d = r.perAttribute.recognition;
    near(oracleWeightedSum(d, position), 1.0, 1e-6, "sum_k w_k * delta_k");
    // Oracle 2: closed form. Shares ∝ w_k and sum(w)=1 ⇒ delta_k = w_k / sum(w²).
    near(Object.values(w).reduce((s, v) => s + v, 0), 1, 1e-12, "weights sum to 1");
    const sumSq = Object.values(w).reduce((s, v) => s + v * v, 0);
    for (const k of Object.keys(w)) near(d[k], w[k] / sumSq, 1e-9, `delta_${k}`);
    // Component equals the requested contribution.
    near(r.components.recognition, 1.0, 1e-6, "components.recognition");
  });
}

test("F04 end-to-end differential: with-minus-without recognition overall delta ≈ contribution", () => {
  const out = {};
  for (const position of ["ST", "CM", "CB", "GK"]) {
    for (const contribution of [0.35, 1.0, 1.4]) {
      const a = makePlayer({ position, target: 70, age: 20, seed: 42 });
      const b = clonePlayer(a);
      // P_long below minPLong keeps breakthrough ineligible so rng consumption/learning are identical.
      const ctx = { P_long: 0.3, reliability: 0.9, seasonId: "f04-diff" };
      const base = develop(a, ctx);
      const withRec = develop(b, { ...ctx, recognition: { contribution } });
      assert.equal(base.caps.scale, 1);
      assert.equal(withRec.caps.scale, 1);
      near(withRec.overallDelta - base.overallDelta, contribution, 1e-6, `${position} c=${contribution}`);
      out[`${position}:${contribution}`] = withRec.overallDelta - base.overallDelta;
    }
  }
  rec("F04", "Recognition 1.0 → components.recognition ≈ 1.0 (ST/CM/CB/GK)", {
    inputs: { positions: ["ST", "CM", "CB", "GK"], contribution: 1.0, target: 70, age: 20, P_long: 0.6, reliability: 0.9, rngSeed: 5678 },
    expected: { recognitionComponent: 1.0, weightedSumOfDeltas: 1.0, scale: 1, differentialOverallDelta: out },
  });
});

test("F04 recognition respects attribute headroom (no overshoot past 99)", () => {
  const p = makePlayer({ position: "GK", target: 90, age: 24, seed: 8 });
  const keys = getDisplayAttributeKeys("GK");
  for (const k of keys) p.attributes[k] = 98.9;
  refreshAbilityCaches(p);
  const r = develop(p, { recognition: { contribution: 1.4 }, P_long: 0.2, reliability: 0.5 });
  const pa = r.perAttribute;
  let headroomOverall = 0;
  for (const k of keys) {
    assert.ok(p.attributes[k] <= 99 + 1e-12, `${k}=${p.attributes[k]}`);
    // Attribute level after the negative phase + restoration; positives must fit under 99.
    const afterNegatives =
      pa.before[k] - (pa.ageing[k] || 0) - (pa.regression[k] || 0) - (pa.deconditioning[k] || 0) - (pa.shockDown[k] || 0) + (pa.restoration[k] || 0);
    const room = 99 - afterNegatives;
    assert.ok(pa.recognition[k] + pa.learning[k] + pa.shockUp[k] <= room + 1e-9, `${k} positives exceed headroom`);
    headroomOverall += cfgWeights("GK")[k] * room;
  }
  assert.ok(r.components.recognition <= headroomOverall + 1e-9);
  assert.ok(r.components.recognition <= 1.4 + 1e-9);
});

/* ================================================================== */
/* F05 — Poor-season drag units                                        */
/* ================================================================== */

/** Drag curve: 0 at threshold, 1 at signal = -1. */
function implementedDragFraction(signal) {
  const thr = DEVELOPMENT_CAPS.poorSeasonDrag.signalThreshold;
  if (signal >= thr) return 0;
  return Math.min(1, Math.max(0, (thr - signal) / (thr + 1)));
}

test("F05 poor-season drag removes exactly the configured overall points (units)", () => {
  const cfg = DEVELOPMENT_CAPS.poorSeasonDrag;
  const rows = {};
  for (const position of ["ST", "CM", "CB", "GK"]) {
    for (const signal of [-1, -0.8, -0.5]) {
      const p = makePlayer({ position, target: 70, age: 24, seed: 9 });
      const r = develop(p, { P_long: signal, reliability: 1, usefulMinutes: 3000 }, 9);
      const expected = cfg.maxOverall * implementedDragFraction(signal) * 1;
      assert.ok(expected > 0);
      near(-r.components.poorSeason, expected, 1e-9, `${position} s=${signal}`);
      // Guard against the old unit bug (loss scaled by sum(w²) ≈ 0.2).
      const sumSq = Object.values(cfgWeights(position)).reduce((s, v) => s + v * v, 0);
      assert.ok(-r.components.poorSeason > expected * sumSq * 2, "must not be attenuated by sum(w²)");
      if (position === "CM") rows[String(signal)] = -r.components.poorSeason;
    }
  }
  rec("F05", "Poor-season drag overall loss equals configured units", {
    inputs: { position: "CM", target: 70, age: 24, reliability: 1, signals: [-1, -0.8, -0.5], signalThreshold: cfg.signalThreshold, maxOverall: cfg.maxOverall },
    expected: { dragOverallBySignal: rows },
    notes: "Curve fraction t = (thr - signal) / (thr + 1); t(-1)=1.",
  });
});

test("F05 drag is zero at/above threshold, monotone in signal, and bounded by maxOverall * years", () => {
  const cfg = DEVELOPMENT_CAPS.poorSeasonDrag;
  let prev = -1;
  for (const s of [-0.2, -0.3, -0.4, -0.55, -0.7, -0.85, -1]) {
    const p = makePlayer({ position: "CM", target: 70, age: 24, seed: 9 });
    const r = develop(p, { P_long: s, reliability: 1 }, 9);
    const loss = -r.components.poorSeason;
    if (s >= cfg.signalThreshold) assert.equal(loss, 0);
    assert.ok(loss >= prev - 1e-12, `monotone at ${s}`);
    assert.ok(loss <= cfg.maxOverall + 1e-12);
    prev = loss;
  }
});

test("F05 poor-season drag scales with elapsed years", () => {
  const a = makePlayer({ position: "CM", target: 70, age: 24, seed: 9 });
  const b = clonePlayer(a);
  const one = develop(a, { P_long: -1, reliability: 1, elapsedYears: 1 }, 9);
  const two = develop(b, { P_long: -1, reliability: 1, elapsedYears: 2 }, 9);
  near(-two.components.poorSeason, -2 * one.components.poorSeason, 1e-9);
});

test("F05 drag reaches configured maxOverall at signal = -1", () => {
  const cfg = DEVELOPMENT_CAPS.poorSeasonDrag;
  const p = makePlayer({ position: "CM", target: 70, age: 24, seed: 9 });
  const r = develop(p, { P_long: -1, reliability: 1 }, 9);
  near(-r.components.poorSeason, cfg.maxOverall, 1e-6, "documented endpoint t(-1)=1");
});

/* ================================================================== */
/* F06 — Challenge/environment response is monotone                    */
/* ================================================================== */

test("F06 environment 0.80/0.95/1.0 at ~98 OVR is monotone; no inversion", () => {
  const seeds = [42, 7, 1234];
  const row = {};
  for (const seed of seeds) {
    const result = {};
    for (const env of [0.8, 0.95, 1.0]) {
      const p = makePlayer({ position: "CM", target: 98, age: 24, seed });
      result[env] = develop(p, { environmentMultiplier: env, seasonId: `f06-${env}` });
    }
    const e = (x) => result[x].breakdown.environment;
    assert.ok(e(0.8) <= e(0.95) + 1e-12 && e(0.95) <= e(1.0) + 1e-12, `effective env ${e(0.8)} ${e(0.95)} ${e(1)}`);
    assert.ok(e(0.95) <= 1.0, "0.95 effective must not exceed 1.0");
    assert.ok(e(0.8) <= 0.8 + 1e-12 && e(0.95) <= 0.95 + 1e-12, "weak env never raised above input");
    const d = (x) => result[x].overallDelta;
    assert.ok(d(0.8) <= d(0.95) + 1e-9 && d(0.95) <= d(1.0) + 1e-9, `delta ${d(0.8)} ${d(0.95)} ${d(1)}`);
    if (seed === 42) Object.assign(row, { effective: { 0.8: e(0.8), 0.95: e(0.95), 1: e(1) }, overallDelta: { 0.8: d(0.8), 0.95: d(0.95), 1: d(1) } });
  }
  rec("F06", "Challenge response monotone at ~98 OVR", {
    inputs: { position: "CM", target: 98, age: 24, envs: [0.8, 0.95, 1.0], seed: 42, rngSeed: 5678 },
    expected: row,
  });
});

test("F06 effective environment is continuous and monotone over the full input grid at several OVR levels", () => {
  for (const target of [88, 92, 94, 96, 98]) {
    let prevEff = -Infinity;
    let prevDelta = -Infinity;
    for (let env = 0.55; env <= 1.4001; env += 0.025) {
      const p = makePlayer({ position: "CM", target, age: 24, seed: 42 });
      const r = develop(p, { environmentMultiplier: env, seasonId: `f06-grid-${env.toFixed(3)}` });
      const eff = r.breakdown.environment;
      assert.ok(eff >= prevEff - 1e-12, `OVR ${target} env ${env.toFixed(3)}: ${eff} < ${prevEff}`);
      assert.ok(r.overallDelta >= prevDelta - 1e-9, `OVR ${target} env ${env.toFixed(3)} delta`);
      if (env < 1) assert.ok(eff <= env + 1e-12);
      prevEff = eff;
      prevDelta = r.overallDelta;
    }
  }
});

/* ================================================================== */
/* F07 — Paired poor/ordinary/good (clone player + rng)                */
/* ================================================================== */

test("F07 paired poor/ordinary/good evidence: good > ordinary > poor learning", () => {
  const rows = [];
  for (const [position, age, target, seed] of [["CM", 19, 62, 11], ["ST", 22, 70, 12], ["CB", 17, 58, 13], ["GK", 25, 74, 14]]) {
    const base = makePlayer({ position, target, age, seed });
    const run = (P_long) => {
      const p = clonePlayer(base);
      return develop(p, { P_long, reliability: 0.9, seasonId: "f07" }, 2024);
    };
    const poor = run(-0.7);
    const ord = run(0.0);
    const good = run(0.7);
    assert.ok(good.components.learning > ord.components.learning, `${position} good>ord`);
    assert.ok(ord.components.learning > poor.components.learning, `${position} ord>poor`);
    assert.ok(good.overallDelta > ord.overallDelta && ord.overallDelta > poor.overallDelta, `${position} overall order`);
    rows.push({ position, age, poor: poor.components.learning, ordinary: ord.components.learning, good: good.components.learning });
  }
  rec("F07", "Paired poor/ordinary/good evidence ordering", {
    inputs: { evidence: { poor: -0.7, ordinary: 0, good: 0.7 }, reliability: 0.9, rngSeed: 2024, note: "clone player + fresh createRng(2024) per run" },
    expected: { learningByPosition: rows, ordering: "good > ordinary > poor" },
  });
});

/* ================================================================== */
/* F08 — Near 90/95/98 matched evidence                                */
/* ================================================================== */

test("F08 matched evidence near 90/95/98 gives slower growth at higher OVR; progress stays finite-positive", () => {
  const rows = [];
  for (const seed of [42, 7, 99, 1234, 31]) {
    const res = {};
    const first = makePlayer({ position: "CM", target: 90, age: 24, seed });
    for (const ovr of [90, 95, 98]) {
      const p = makePlayer({ position: "CM", target: ovr, age: 24, seed });
      p.development.traits = structuredClone(first.development.traits); // matched traits
      res[ovr] = develop(p, { P_long: 0.6, reliability: 0.9, seasonId: "f08" }, 5678);
    }
    assert.ok(res[90].components.learning > res[95].components.learning, `seed ${seed} 90>95 learning`);
    assert.ok(res[95].components.learning > res[98].components.learning, `seed ${seed} 95>98 learning`);
    assert.ok(res[90].overallDelta > res[95].overallDelta && res[95].overallDelta > res[98].overallDelta, `seed ${seed} delta order`);
    assert.ok(res[98].components.learning > 0.05, `seed ${seed}: 98 learning must remain possible (${res[98].components.learning})`);
    assert.ok(res[98].overallAfter <= 99);
    if (seed === 42) rows.push({ 90: res[90].overallDelta, 95: res[95].overallDelta, 98: res[98].overallDelta });
  }
  // Finite progress over several seasons for a 96 player with strong evidence: grows, never exceeds 99.
  const p = makePlayer({ position: "CM", target: 96, age: 24, seed: 5 });
  const start = oracleOverall(p.attributes, "CM");
  for (let s = 0; s < 6; s++) develop(p, { P_long: 0.9, reliability: 1, seasonId: `f08-${s}`, periodId: `f08p-${s}` }, 100 + s);
  const end = oracleOverall(p.attributes, "CM");
  assert.ok(end > start + 0.3 && end <= 99, `96 → ${end}`);
  rec("F08", "Matched evidence near 90/95/98", {
    inputs: { position: "CM", ovrs: [90, 95, 98], age: 24, P_long: 0.6, reliability: 0.9, seed: 42, rngSeed: 5678 },
    expected: { overallDelta: rows[0], ordering: "90 > 95 > 98 > 0", sixSeasonFrom96Gains: end - start },
  });
});

/* ================================================================== */
/* F09 — Inert legacy ceilings/forecasts                               */
/* ================================================================== */

test("F09 different inert legacy ceilings/forecasts/budgets → identical development", () => {
  const a = makePlayer({ position: "ST", target: 75, age: 22, seed: 77 });
  const b = clonePlayer(a);
  const dev = b.development;
  dev.latentBudget = dev.latentAbilityBudget = 61;
  dev.ceilings = Object.fromEntries(Object.keys(b.attributes).map((k) => [k, 50]));
  dev.attributeCeilings = { ...dev.ceilings };
  dev.ceilingsActive = true;
  dev.legacyArchive = { latentAbilityBudget: 55, attributeCeilings: dev.ceilings };
  dev.abilityBudgetsByPosition = { ST: { budget: 40, startOverallRaw: 75, used: 0, primary: true } };
  dev.forecast = { potentialCache: 52, lower: 50, median: 51, upper: 52, inputSignature: "stale" };
  b.potential = 52;
  for (let s = 0; s < 3; s++) {
    const ctx = { P_long: 0.5, reliability: 0.8, seasonId: `f09-${s}`, periodId: `f09p-${s}` };
    const ra = develop(a, ctx, 300 + s);
    const rb = develop(b, ctx, 300 + s);
    assert.deepEqual(rb.components, ra.components);
    assert.deepEqual(b.attributes, a.attributes);
    near(rb.overallDelta, ra.overallDelta, 0);
    a.age += 1;
    b.age += 1;
  }
  assert.ok(oracleOverall(a.attributes, "ST") > 75, "growth is not clamped by the bogus ceiling");
  rec("F09", "Inert legacy ceilings/forecasts do not change development", {
    inputs: { variantB: { latentBudget: 61, ceilings: 50, forecastPotential: 52 }, seasons: 3 },
    expected: { identicalComponents: true, identicalAttributes: true },
  });
});

/* ================================================================== */
/* F10 — supported trajectories and authentic witnesses                */
/* ================================================================== */

test("F10 constructed 50/60/70 sustained-elite paths reach displayed 99 without forced breakthroughs", () => {
  const seasonsTo99 = {};
  for (const target of [50, 60, 70]) {
    const p = makePlayer({ position: "CM", target, age: 17, seed: target });
    const values = [p.baseOverallRaw];
    for (let year = 0; year < 20 && Math.round(p.baseOverallRaw) < 99; year++) {
      p.age = 17 + year;
      const context = {
        P_long: 0.95,
        reliability: 1,
        usefulMinutes: 3400,
        healthyTrainingFraction: 1,
        environmentMultiplier: 1.3,
        recognition: { contribution: 1.4 },
        periodId: `f10-constructed-${target}-${year}`,
        seasonId: `f10-constructed-${target}-${year}`,
      };
      assert.equal(context.forceBreakthrough, undefined);
      develop(p, context, 1000 + target + year);
      values.push(p.baseOverallRaw);
    }
    assert.ok(values.every(Number.isFinite));
    assert.equal(Math.round(values.at(-1)), 99, `constructed ${target} path should reach displayed 99`);
    assert.ok(values.length - 1 <= 20);
    seasonsTo99[target] = values.length - 1;
  }
  assert.deepEqual(seasonsTo99, { 50: 7, 60: 6, 70: 4 });
  rec("F10", "Constructed sustained-elite paths and indexed witness contracts", {
    inputs: {
      starts: [50, 60, 70],
      maximumSeasons: 20,
      forceBreakthrough: false,
      evidence: "constructed",
    },
    expected: {
      supportedTrajectories: true,
      displayedEndpoint: 99,
      evidenceLabel: "constructed",
      constructedSeasons: { 50: 7, 60: 6, 70: 4 },
    },
    notes: ["50/60/70 paths are constructed sustained-elite inputs, not natural careers."],
  });
});

test("F10 constructed forced-breakthrough control", () => {
  const p = makePlayer({ position: "CM", target: 70, age: 17, seed: 70 });
  const before = p.baseOverallRaw;
  const result = develop(p, {
    P_long: 0.95,
    reliability: 1,
    usefulMinutes: 3400,
    healthyTrainingFraction: 1,
    environmentMultiplier: 1.3,
    recognition: { contribution: 1.4 },
    forceBreakthrough: true,
    periodId: "f10-constructed-forced-breakthrough",
    seasonId: "f10-constructed-forced-breakthrough",
  }, 4242);
  assert.equal(result.breakthrough.occurred, true);
  assert.ok(p.baseOverallRaw > before);
  rec("F10", "Constructed sustained-elite paths and indexed witness contracts", {
    inputs: {
      forcedBreakthroughControl: {
        evidence: "constructed-forced-breakthrough",
        forceBreakthrough: true,
      },
    },
    expected: { forcedBreakthroughControl: true },
    notes: ["Separate constructed control. Not a natural career witness."],
  });
});

test("F10 witness index resolves uniquely and unknown ids fail before replay", () => {
  const index = loadWitnessIndex();
  const ids = index.witnesses.map((entry) => entry.id);
  assert.equal(new Set(ids).size, 3);
  assert.deepEqual([...ids].sort(), ["cid_2369bc62", "cid_2e1ba005", "cid_85a7b61e"]);
  assert.throws(() => validateWitnessLookup("cid_does_not_exist"), /Witness not found/);
  const root = mkdtempSync(join(tmpdir(), "fix11-witness-index-"));
  try {
    const ambiguous = join(root, "index.json");
    writeFileSync(ambiguous, JSON.stringify({
      witnesses: [
        { id: "cid_aaaaaaaa", file: "a.json", expected: { careerId: "cid_aaaaaaaa" } },
        { id: "cid_aaaaaaaa", file: "b.json", expected: { careerId: "cid_aaaaaaaa" } },
      ],
    }));
    assert.throws(() => validateWitnessLookup("cid_aaaaaaaa", { indexPath: ambiguous }), /Ambiguous witness id/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const plus6 = validateWitnessLookup("cid_2369bc62");
  assert.equal(plus6.career.id, "cid_2369bc62");
  assert.ok(plus6.path.endsWith(join("plus6-plus7", "career-plus6.json")));
  const bySeason = validateWitnessLookup("cid_2369bc62:season:6");
  assert.equal(bySeason.career.id, "cid_2369bc62");
  assert.equal(bySeason.seasonNumber, 6);
  assert.notEqual(bySeason.career.id, "cid_85a7b61e");
  assert.throws(() => validateWitnessLookup("cid_2369bc62:season:17"), /season claim/);
  const byPath = validateWitnessLookup(plus6.path);
  assert.equal(byPath.career.id, "cid_2369bc62");

  const altered = structuredClone(plus6.career);
  altered.seasons.find((row) => row.seasonNumber === 6).rawAfter += 1;
  const validation = validateWitnessClaim(plus6.claim, plus6.career, altered);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /rawAfter/);
  rec("F10", "Constructed sustained-elite paths and indexed witness contracts", {
    inputs: { witnessIds: ["cid_2369bc62", "cid_2e1ba005", "cid_85a7b61e"] },
    expected: { uniqueWitnessIds: 3, unknownWitnessRejected: true },
  });
});

test("F10 saved career claims match the witness index without replay", () => {
  for (const id of ["cid_2369bc62", "cid_2e1ba005", "cid_85a7b61e"]) {
    const resolved = validateWitnessLookup(id);
    assert.equal(resolved.career.id, id);
    assert.equal(resolved.claim.expected.careerId, id);
    const validation = validateWitnessClaim(resolved.claim, resolved.career);
    assert.equal(validation.ok, true, validation.errors.join("; "));
  }
  const natural = validateWitnessLookup("cid_85a7b61e");
  assert.ok(natural.path.endsWith(join("natural-99", "career.json")));
  assert.equal(natural.seasonNumber, 17);
  assert.equal(natural.career.everDisplayed99, true);
  assert.equal(natural.claim.expected.displayed99, true);
  const plus7 = validateWitnessLookup("cid_2e1ba005");
  assert.ok(plus7.path.endsWith(join("plus6-plus7", "career-plus7.json")));
  assert.equal(plus7.claim.expected.displayedDelta, 7);
  rec("F10", "Constructed sustained-elite paths and indexed witness contracts", {
    expected: { savedClaimsMatch: true, natural99CareerId: "cid_85a7b61e" },
  });
});

/* ================================================================== */
/* F11 — Recognition: nomination→win, duplicates, diminishing returns  */
/* ================================================================== */

test("F11 award nomination replaced by win; duplicate events don't stack; multi-award diminishing returns", () => {
  const { win, selection, nomination, multiAwardDecay: dec, maxContribution } = RECOGNITION_CONFIG;
  const A = (awardId, status) => ({ awardId, status, eventId: `ev:${awardId}:${status}` });
  const C = computeRecognitionContribution;
  const cases = {};

  cases.nominationReplacedByWin = C({ awards: [A("a", "nominated"), A("a", "won")] });
  near(cases.nominationReplacedByWin, win, 1e-12);
  near(C({ awards: [A("a", "won"), A("a", "nominated")] }), win, 1e-12, "order-independent");
  cases.twoWins = C({ awards: [A("a", "won"), A("b", "won")] });
  near(cases.twoWins, win + win * dec, 1e-12);
  cases.mixed = C({ awards: [A("c", "selected"), A("b", "nominated"), A("a", "won")] });
  near(cases.mixed, win + selection * dec + nomination * dec * dec, 1e-12);
  cases.duplicateWins = C({ awards: [A("a", "won"), A("a", "won"), A("a", "won")] });
  near(cases.duplicateWins, win, 1e-12);
  near(C({ awards: [A("a", "nominated"), A("a", "nominated")] }), nomination, 1e-12);
  // Strict diminishing returns across n distinct wins, capped.
  let prevMarginal = Infinity;
  let prevTotal = 0;
  let expectedSum = 0;
  for (let n = 1; n <= 8; n++) {
    expectedSum += win * Math.pow(dec, n - 1);
    const total = C({ awards: Array.from({ length: n }, (_, i) => A(`w${i}`, "won")) });
    near(total, Math.min(expectedSum, maxContribution), 1e-12, `n=${n}`);
    const marginal = total - prevTotal;
    assert.ok(marginal <= prevMarginal + 1e-12, "marginal credit must not increase");
    prevMarginal = marginal;
    prevTotal = total;
  }
  assert.ok(prevTotal <= maxContribution + 1e-12);

  // Duplicate event IDs attached to evidence do not stack.
  const ev = { recognition: [] };
  const rec1 = A("a", "won");
  attachRecognitionToEvidence(ev, [rec1, { ...rec1 }]);
  attachRecognitionToEvidence(ev, [{ ...rec1 }, A("b", "nominated")]);
  assert.equal(ev.recognition.length, 2);
  const ctx = evidenceToDevelopmentContext({ ...fullEvidenceStub(), recognition: ev.recognition });
  near(C(ctx.recognition), win + nomination * dec, 1e-12);

  // End-to-end through developSeason: duplicates/nominations on the same award add nothing extra.
  const base = makePlayer({ position: "CM", target: 70, age: 22, seed: 5 });
  const run = (awards) => develop(clonePlayer(base), { P_long: 0.3, reliability: 0.9, recognition: { awards } }, 11);
  const one = run([A("a", "won")]);
  const noisy = run([A("a", "nominated"), A("a", "won"), A("a", "won")]);
  near(noisy.components.recognition, one.components.recognition, 1e-12);
  near(one.components.recognition, win, 1e-6);
  rec("F11", "Nomination replaced by win; no duplicate stacking; diminishing returns", {
    inputs: { config: { win, selection, nomination, multiAwardDecay: dec, maxContribution } },
    expected: { contributions: cases, developSeasonRecognitionForSingleWin: one.components.recognition },
  });
});

function fullEvidenceStub() {
  return {
    minutes: 2500,
    healthyTrainingFraction: 1,
    reliability: 0.8,
    ratedMinutes: 2000,
    seasonP: 0.2,
    reliableSignal: 0.16,
    environmentProxy: 1,
    challengeRelativeToAbility: 1,
    trophies: [],
  };
}

/* ================================================================== */
/* F12 — dated playing context controls environment                    */
/* ================================================================== */

/** Independent two-stint environment oracle (duration-weighted club overall). */
function oracleEnvironmentProxyFromStints(stints) {
  const usable = stints.filter((s) => Number(s.clubOverall) > 0);
  const totalDays = usable.reduce((sum, s) => {
    const from = Date.parse(s.from);
    const to = Date.parse(s.to);
    return sum + Math.max(0, (to - from) / 86_400_000);
  }, 0);
  assert.ok(totalDays > 0, "oracle stints need positive duration");
  const clubOverall =
    usable.reduce((sum, s) => {
      const days = Math.max(0, (Date.parse(s.to) - Date.parse(s.from)) / 86_400_000);
      return sum + Number(s.clubOverall) * days;
    }, 0) / totalDays;
  return Math.min(1.35, Math.max(0.55, 0.85 + (clubOverall - 70) / 80));
}

test("F12 borrower and multiple-stint environment follows dated playing context; parent prestige does not leak", () => {
  const player = makePlayer({ position: "CM", target: 66, age: 21, seed: 412 });
  player.club = { clubId: "parent", overall: 95 };
  player.playingClubId = "borrower";
  player.activeLoan = { status: "active", parentClubId: "parent", borrowerClubId: "borrower" };
  const aggregate = {
    combined: { minutes: 2000, appearances: 24, starts: 20, goals: 4, assists: 5, avgMatchRating: 7 },
    byCompetitionType: {},
    ratedMinutes: 2000,
    seasonP: 0.3,
    reliability: 0.8,
  };
  const lowStints = [
    {
      playingClubId: "parent",
      clubId: "parent",
      leagueId: "elite",
      from: "2026-07-01",
      to: "2026-08-31",
      onLoan: false,
      clubOverall: 95,
      leagueOverall: 88,
    },
    {
      playingClubId: "borrower",
      clubId: "borrower",
      leagueId: "lower",
      from: "2026-09-01",
      to: "2027-06-30",
      onLoan: true,
      clubOverall: 60,
      leagueOverall: 55,
    },
  ];
  const highStints = lowStints.map((s, i) => (i === 1 ? { ...s, clubOverall: 84, leagueOverall: 70 } : s));
  const low = buildSeasonEvidence(player, {
    aggregate,
    clubOverall: 60,
    playingStints: lowStints,
    seasonStartDate: "2026-07-01",
    seasonEndDate: "2027-07-01",
  });
  const sameBorrowerDifferentParent = buildSeasonEvidence(
    { ...player, club: { clubId: "parent", overall: 99 } },
    {
      aggregate,
      clubOverall: 60,
      playingStints: lowStints.map((s) => (s.clubId === "parent" ? { ...s, clubOverall: 99 } : s)),
      seasonStartDate: "2026-07-01",
      seasonEndDate: "2027-07-01",
    }
  );
  const highBorrower = buildSeasonEvidence(player, {
    aggregate,
    clubOverall: 84,
    playingStints: highStints,
    seasonStartDate: "2026-07-01",
    seasonEndDate: "2027-07-01",
  });
  const finishingParentOnly = buildSeasonEvidence(player, {
    aggregate,
    clubOverall: 95,
    playingStints: [{ ...lowStints[0], from: "2026-07-01", to: "2027-06-30", clubOverall: 95 }],
    seasonStartDate: "2026-07-01",
    seasonEndDate: "2027-07-01",
  });
  near(low.environmentProxy, oracleEnvironmentProxyFromStints(lowStints), 1e-6, "duration-weighted oracle");
  near(highBorrower.environmentProxy, oracleEnvironmentProxyFromStints(highStints), 1e-6, "high borrower oracle");
  // Parent prestige for a brief early stint must not dominate; a finishing-parent-only
  // season would score higher than the real loan-weighted season.
  assert.ok(finishingParentOnly.environmentProxy > low.environmentProxy + 0.05);
  // Changing only the brief parent stint overall must barely move the weighted proxy.
  near(low.environmentProxy, sameBorrowerDifferentParent.environmentProxy, 0.02, "parent prestige must not dominate");
  assert.ok(highBorrower.environmentProxy > low.environmentProxy);
  assert.equal(low.competition?.aggregationBasis, "dated-duration");
  assert.equal(low.loan, true);
  assert.equal(low.loanInfo.borrowerClubId, "borrower");
  rec("F12", "Dated playing context controls environment", {
    inputs: { parentOverall: [95, 99], borrowerOverall: [60, 84], stintCount: 2, oracle: "duration-weighted-club" },
    expected: {
      parentPrestigeDoesNotDominate: true,
      strongerBorrowerRaisesEnvironment: true,
      matchesIndependentOracle: true,
      aggregationBasis: "dated-duration",
    },
  });
});

/* ================================================================== */
/* F13 — Restoration bounded by recoverable pool                       */
/* ================================================================== */

test("F13 restoration is bounded by the recoverable pool and is outside the allowance", () => {
  const fractionPerYear = DEVELOPMENT_CAPS.restoration.fractionPerYear;
  const damage = { Speed: 2.4, Physicality: 1.2 };
  const pool = 3.6;
  const mk = () => {
    const p = makePlayer({ position: "CM", target: 70, age: 26, seed: 61 });
    for (const [k, v] of Object.entries(damage)) {
      p.attributes[k] -= v;
      p.health.recoverableDamage[k] = v;
      p.health.durableDamage[k] = v;
    }
    refreshAbilityCaches(p);
    return p;
  };
  // Season restoration: amount = pool * fractionPerYear (years 1, healthy 1), split ∝ damage.
  const p = mk();
  const r = develop(p, { P_long: 0.3, reliability: 0.8 });
  const amount = pool * fractionPerYear;
  for (const [k, v] of Object.entries(damage)) near(r.perAttribute.restoration[k], amount * (v / pool), 1e-9, `restored ${k}`);
  near(r.components.restoration, oracleWeightedSum(Object.fromEntries(Object.entries(damage).map(([k, v]) => [k, amount * (v / pool)])), "CM"), 1e-9);
  const restoredSum = Object.values(r.perAttribute.restoration).reduce((s, v) => s + v, 0);
  assert.ok(restoredSum <= pool + 1e-12);
  const remaining = Object.values(p.health.recoverableDamage).reduce((s, v) => s + v, 0);
  near(remaining, pool - restoredSum, 1e-9, "remaining pool");
  // Restoration is not gross learning.
  const gross = r.components.learning + r.components.recognition + r.components.positiveShock;
  near(r.breakdown.annualAllowanceUsed, gross, 1e-9);
  // Two-year gap: fraction clamps to 1 → at most the whole pool, never more.
  const p2 = mk();
  const r2 = develop(p2, { P_long: 0.3, reliability: 0.8, elapsedYears: 2 });
  const restored2 = Object.values(r2.perAttribute.restoration).reduce((s, v) => s + v, 0);
  near(restored2, pool, 1e-9);
  assert.equal(Object.keys(p2.health.recoverableDamage).length, 0);
  // No pool → nothing restored. Unhealthy season → nothing restored.
  const none = makePlayer({ position: "CM", target: 70, age: 26, seed: 61 });
  assert.equal(develop(none, { P_long: 0.3 }).components.restoration, 0);
  const unhealthy = mk();
  const ru = develop(unhealthy, { P_long: 0.3, healthyTrainingFraction: 0.5 });
  assert.equal(ru.components.restoration, 0);
  // Direct API: over-asking restores exactly the pool, then nothing.
  const d = mk();
  const before = { ...d.attributes };
  const big = applyRecoverableRestoration(d, 100);
  near(big.restored, pool, 1e-9);
  for (const [k, v] of Object.entries(damage)) near(d.attributes[k] - before[k], v, 1e-9);
  assert.equal(applyRecoverableRestoration(d, 100).restored, 0);
  rec("F13", "Restoration bounded by recoverable pool", {
    inputs: { damage, pool, fractionPerYear, years: [1, 2] },
    expected: { oneYearRestored: restoredSum, twoYearRestored: restored2, overAskRestored: big.restored, noPoolRestored: 0 },
  });
});

/* ================================================================== */
/* F14 — role/family age behaviour                                     */
/* ================================================================== */

test("F14 role/family age behaviour makes goalkeepers mature later on average", () => {
  assert.equal(POSITION_ROLE_GROUP.GK, "goalkeeper");
  assert.ok(POSITION_MATURATION.goalkeeper.learningAgeShift < POSITION_MATURATION.winger.learningAgeShift);
  assert.ok(POSITION_MATURATION.goalkeeper.lossAgeShift < POSITION_MATURATION.striker.lossAgeShift);
  const peakAge = (position, seed) => {
    const p = makePlayer({ position, target: 65, age: 18, seed });
    let peak = { age: 18, value: p.baseOverallRaw };
    for (let age = 18; age <= 39; age++) {
      p.age = age;
      develop(p, {
        P_long: 0.15,
        reliability: 0.8,
        usefulMinutes: 2600,
        periodId: `f14-${position}-${seed}-${age}`,
        seasonId: `f14-${position}-${seed}-${age}`,
      }, seed * 100 + age);
      if (p.baseOverallRaw > peak.value) peak = { age, value: p.baseOverallRaw };
    }
    return peak.age;
  };
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const gkPeak = mean(Array.from({ length: 12 }, (_, i) => peakAge("GK", i + 1)));
  const wingerPeak = mean(Array.from({ length: 12 }, (_, i) => peakAge("RW", i + 1)));
  assert.ok(gkPeak > wingerPeak, `GK peak ${gkPeak} should be later than winger ${wingerPeak}`);
  rec("F14", "Role/family age behaviour; GK later", {
    inputs: { roles: ["GK", "RW"], seeds: 12, ages: "18..39" },
    expected: { goalkeeperPeakLater: true },
  });
});

/* ================================================================== */
/* F15 — snapshot migration idempotency                                */
/* ================================================================== */

test("F15 snapshot migration is idempotent", () => {
  const legacy = {
    name: "F15 Legacy",
    nationality: "Testland",
    position: "RW",
    age: 21,
    rating: 70,
    potential: 84,
    attributes: { Speed: 76, Passing: 68, Shooting: 69, Defending: 48, Physicality: 62, Dribbling: 77 },
    contractEndSeason: 2030,
  };
  assert.equal(migratePlayerToV2(legacy, { careerId: "f15-snapshot" }).migrated, true);
  const once = JSON.stringify(legacy);
  assert.equal(migratePlayerToV2(legacy, { careerId: "f15-snapshot" }).migrated, false);
  assert.equal(JSON.stringify(legacy), once);
  rec("F15", "Snapshot migration idempotent", {
    inputs: { sourceVersion: "legacy", migrations: 2 },
    expected: { firstMigrates: true, secondNoop: true, byteStableAfterFirst: true },
  });
});

/* ================================================================== */
/* F16 — Forecasts do not advance career rng                           */
/* ================================================================== */

test("F16 forecast calls do not advance the career rng", () => {
  const p = makePlayer({ position: "CM", target: 66, age: 19, seed: 15 });
  const career = createRng(123);
  const stateBefore = career.seed();
  forecastPotential(p, { rng: career, sampleCount: 32 });
  getOrUpdateForecast(p, { rng: career, sampleCount: 32, assumptions: { pLong: 0.5 } });
  assert.equal(career.seed(), stateBefore, "explicit career rng untouched");
  // Global career rng untouched by forecast helpers.
  const prev = getSimRng();
  const sim = setSimRng(createRng(321));
  const simState = sim.seed();
  try {
    getOrUpdateForecast(p, { sampleCount: 32, assumptions: { pLong: -0.5 } });
    forecastPotential(p, { sampleCount: 16 });
    assert.equal(getSimRng().seed(), simState, "global sim rng untouched");
  } finally {
    setSimRng(prev);
  }
  // Forecasting before/between seasons cannot change the development outcome or later draws.
  const a = clonePlayer(p);
  const b = clonePlayer(p);
  const r1 = develop(a, { seasonId: "f16" }, 17);
  getOrUpdateForecast(b, { sampleCount: 32, assumptions: { pLong: 0.9 } });
  const r2 = develop(b, { seasonId: "f16" }, 17);
  assert.deepEqual(r2.components, r1.components);
  // Forecast itself is deterministic from the player's state.
  const f1 = forecastPotential(clonePlayer(p), { sampleCount: 32, careerId: "k" });
  const f2 = forecastPotential(clonePlayer(p), { sampleCount: 32, careerId: "k" });
  assert.equal(f1.median, f2.median);
  rec("F16", "Forecast calls do not advance career rng", { inputs: { careerRngSeed: 123, calls: ["forecastPotential", "getOrUpdateForecast"] }, expected: { careerRngStateUnchanged: true, simRngStateUnchanged: true, developmentUnchanged: true } });
});

/* ================================================================== */
/* F17 — Weighted attrs, cached OVR, components, endpoints agree       */
/* ================================================================== */

test("F17 weighted attributes, cached OVR, components and displayed endpoints agree", () => {
  const rows = [];
  const scenarios = [
    { position: "ST", ctx: { P_long: 0.6, recognition: { contribution: 0.8 } } },
    { position: "CM", ctx: { P_long: -0.9, reliability: 1 } }, // poor drag
    { position: "CB", ctx: { P_long: 0.2, healthyTrainingFraction: 0.4 } }, // deconditioning
    { position: "GK", ctx: { P_long: 0.5, elapsedYears: 2 } },
    { position: "CM", ctx: { P_long: 0.4 }, age: 33 },
  ];
  scenarios.forEach(({ position, ctx, age }, i) => {
    const p = makePlayer({ position, target: 72, age: age ?? 23, seed: 70 + i });
    const attrsBefore = { ...p.attributes };
    const r = develop(p, { ...ctx, seasonId: `f17-${i}` });
    // Cached overall = independent weighted sum of attributes.
    const oBefore = oracleOverall(attrsBefore, position);
    const oAfter = oracleOverall(p.attributes, position);
    near(r.overallBefore, oBefore, 1e-9, "overallBefore");
    near(r.overallAfter, oAfter, 1e-9, "overallAfter");
    near(p.baseOverallRaw, oAfter, 1e-9, "baseOverallRaw cache");
    near(calculateOverall(p.attributes, position).raw, oAfter, 1e-9);
    near(getBaseOverall(p), oAfter, 1e-9);
    assert.equal(p.rating, Math.round(oAfter), "rating cache");
    // Components sum to the realised overall delta.
    const c = r.components;
    const sum = c.learning + c.recognition + c.shock + c.ageing + c.regression + c.deconditioning + c.poorSeason + c.restoration;
    near(r.overallDelta, sum, 1e-9, `components sum (${position})`);
    near(r.overallDelta, oAfter - oBefore, 1e-9);
    // Displayed endpoints: derived from raw, history agrees.
    const h = p.development.history.at(-1);
    near(h.overallBefore, oBefore, 1e-9);
    near(h.overallAfter, oAfter, 1e-9);
    assert.equal(roundAbilityForDisplay(r.overallAfter), p.rating);
    assert.equal(roundAbilityForDisplay(r.overallBefore), Math.round(oBefore));
    // Per-attribute ledger reproduces the attribute change (poor drag is not itemised per attribute).
    if (!(c.poorSeason < 0)) {
      const w = cfgWeights(position);
      for (const k of Object.keys(w)) {
        const pa = r.perAttribute;
        const expected =
          pa.learning[k] + pa.shockUp[k] + pa.recognition[k] + (pa.restoration[k] || 0) -
          (pa.shockDown[k] || 0) - (pa.ageing[k] || 0) - (pa.regression[k] || 0) - (pa.deconditioning[k] || 0);
        near(pa.after[k] - pa.before[k], expected, 1e-9, `${position}.${k}`);
        near(p.attributes[k], pa.after[k], 1e-12);
      }
    }
    rows.push({ position, overallDelta: r.overallDelta, componentSum: sum });
  });
  rec("F17", "Weighted attrs / cached OVR / components / endpoints agree", { inputs: { scenarios: scenarios.map((s) => ({ position: s.position, ...s.ctx, age: s.age ?? 23 })) }, expected: { rows, tolerance: 1e-9 } });
});

/* ================================================================== */
/* F18 — driver rejects false completion paths                         */
/* ================================================================== */

test("F18 driver rejects nonthrowing pending/null seasons, guard exhaustion, and injected false outcomes", () => {
  const injected = [
    [{ awaitingDecision: true }, 3, 3, "pending-season-not-completed"],
    [{ awaitingScenario: true }, 3, 3, "pending-season-not-completed"],
    [{ pendingContractReview: true, season: null }, 3, 3, "pending-season-not-completed"],
    [null, 3, 3, "null-season-not-completed"],
    [{ season: { seasonNumber: 4 } }, 3, 3, "season-payload-without-history-advance"],
  ];
  for (const [result, before, after, reason] of injected) {
    assert.deepEqual(validateDriverSeasonResult(result, before, after), { ok: false, reason });
  }
  assert.deepEqual(validateDriverSeasonResult({ season: { seasonNumber: 4 } }, 3, 4), { ok: true });
  assert.deepEqual(validateDriverGuard(100, 100), { ok: false, reason: "season-drain-guard-exhausted" });
  assert.deepEqual(validateDriverGuard(99, 100), { ok: true });
  rec("F18", "Driver rejects false completion paths", {
    inputs: { injectedOutcomes: ["decision", "scenario", "contract-review", "null", "no-history-advance"], guard: 100 },
    expected: { allRejected: true, guardExhaustionRejected: true, completedSeasonAccepted: true },
  });
});

/* ================================================================== */
/* F19 — frozen manifests, pairing, holdout separation                 */
/* ================================================================== */

test("F19 frozen manifests, paired base/final state, and holdout separation", () => {
  const plan = JSON.parse(readFileSync(join(HERE, "..", "qa", "fix11-runs", "plan.json"), "utf8"));
  assert.equal(plan.status, "frozen-before-tuning");
  assert.ok(plan.frozenAt);
  assert.equal(plan.seedDeclarations.holdout.mayUseDuringTuning, false);
  const range = plan.seedDeclarations.holdout.precommittedRange;
  assert.equal(range.endExclusive - range.startInclusive, plan.cohorts.holdoutTrajectories);

  const base = makePlayer({ position: "CM", target: 70, age: 19, seed: 19 });
  const before = structuredClone(base);
  const left = clonePlayerForPairing(base, 12345);
  const right = clonePlayerForPairing(base, 12345);
  assert.deepEqual(left.player, right.player);
  assert.deepEqual(base, before, "pair construction must not mutate the frozen base");
  develop(left.player, { environmentMultiplier: 0.9, seasonId: "f19", periodId: "f19" }, 12345);
  develop(right.player, { environmentMultiplier: 1.2, seasonId: "f19", periodId: "f19" }, 12345);
  assert.ok(right.player.baseOverallRaw > left.player.baseOverallRaw);
  rec("F19", "Frozen manifests, paired base/final, holdout separation", {
    inputs: { planStatus: plan.status, holdoutRange: [range.startInclusive, range.endExclusive], pairedRngState: 12345 },
    expected: { manifestFrozen: true, baseUnchanged: true, pairedFinalsComparable: true, holdoutExcludedFromTuning: true },
  });
});

/* ================================================================== */
/* F20 — review assessor rejects bad packages                          */
/* ================================================================== */

test("F20 review assessor rejects incomplete and corrupted packages", () => {
  const root = mkdtempSync(join(tmpdir(), "fix11-assessor-"));
  try {
    const incomplete = join(root, "incomplete");
    const corrupt = join(root, "corrupt");
    mkdirSync(incomplete);
    mkdirSync(corrupt);
    writeFileSync(join(incomplete, "summary.json"), JSON.stringify({ schemaVersion: FIX11_SCHEMA_VERSION }));
    writeFileSync(join(corrupt, "summary.json"), "{not-json");
    const missingAssessment = assessRun(join(root, "missing"));
    const incompleteAssessment = assessRun(incomplete);
    const corruptAssessment = assessRun(corrupt);
    assert.equal(missingAssessment.ok, false);
    assert.equal(incompleteAssessment.ok, false);
    assert.ok(incompleteAssessment.gates.some((gate) => gate.id === "package-complete" && !gate.ok));
    assert.equal(corruptAssessment.ok, false);
    assert.equal(corruptAssessment.gates[0].id, "summary-valid-json");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  rec("F20", "Assessor rejects incomplete/corrupted packages", {
    inputs: { packages: ["missing-summary", "incomplete-summary", "corrupt-json"] },
    expected: { allRejected: true },
  });
});

/* ================================================================== */
/* F00 — QA case files stay in sync with the executable oracles        */
/* ================================================================== */

test("F00 qa/fix11-runs/cases F01..F20 are present and match the executable oracles", () => {
  const ids = Array.from({ length: 20 }, (_, i) => `F${String(i + 1).padStart(2, "0")}`);
  for (const id of ids) assert.ok(CASES[id], `${id} recorded no case data`);
  if (WRITE_CASES) {
    mkdirSync(CASES_DIR, { recursive: true });
    for (const id of ids) {
      const c = CASES[id];
      const body = roundDeep({ id, title: c.title, inputs: c.inputs, expected: c.expected, notes: c.notes });
      writeFileSync(join(CASES_DIR, `${id}.json`), `${JSON.stringify(body, null, 2)}\n`);
    }
    return;
  }
  const errors = [];
  for (const id of ids) {
    const file = join(CASES_DIR, `${id}.json`);
    assert.ok(existsSync(file), `missing ${file} (run with FIX11_WRITE_CASES=1)`);
    const stored = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(stored.id, id);
    compareExpected(stored.expected, roundDeep(CASES[id].expected), `${id}.expected`, errors);
    compareExpected(stored.inputs, roundDeep(CASES[id].inputs), `${id}.inputs`, errors);
  }
  assert.deepEqual(errors, []);
});

test("F07b ordinary uneventful match rating is near-neutral vs the shared expected baseline", () => {
  assert.equal(PERFORMANCE.defaultExpectedRating, 6.0);
  const player = { position: "CM", name: "Baseline", rating: 70, baseOverallRaw: 70 };
  const match = {
    playerSide: "home",
    playerStats: { minutes: 90, played: true, goals: 0, assists: 0, yellow: 0, red: 0 },
    homeGoals: 1,
    awayGoals: 1,
    matchHomeGoals: 1,
    matchAwayGoals: 1,
    regulationHomeGoals: 1,
    regulationAwayGoals: 1,
    _ratingNoise: 0,
  };
  const rating = computeMatchRating(match, player, createRng(1));
  assert.ok(rating != null);
  // Draw with no contributions: baseline 6.0 + draw 0.1 = 6.1 vs expected 6.0 → mild positive, not a poor season.
  const obs = computePerformanceObservation(rating, PERFORMANCE.defaultExpectedRating, PERFORMANCE.residualScale.default);
  assert.ok(obs.observation > -0.05, `ordinary draw observation ${obs.observation} must not look systematically poor`);
});

/* ================================================================== */
/* Package assessor negatives (R5) — not part of F00 case files         */
/* ================================================================== */

test("package assessor rejects -0.3 after-attribute mutation, missing attr, and threshold discrepancy", async () => {
  const {
    __test: reviewTest,
    assessPackageEvidence,
  } = await import("../scripts/lib/fix11ReviewEvidence.mjs");
  const snapPath = join(HERE, "..", "qa", "fix11-runs", "witnesses", "natural-99", "snapshot-natural-99.json");
  assert.ok(existsSync(snapPath), "natural-99 snapshot fixture required");
  const original = readFileSync(snapPath, "utf8");
  try {
    const snap = JSON.parse(original);
    const attrs = snap.afterSnapshot.player.attributes;
    for (const key of Object.keys(attrs)) attrs[key] = Number(attrs[key]) - 0.3;
    // Keep cached OVR unchanged — substantive gate must still fail.
    writeFileSync(snapPath, `${JSON.stringify(snap)}\n`);
    const mutated = await reviewTest.assessNatural99(join(HERE, ".."));
    assert.equal(mutated.ok, false);
    assert.ok(
      mutated.problems.some((p) =>
        ["recomputed-after-below-threshold", "after-cache-mismatch"].includes(p)
      ),
      mutated.problems.join(",")
    );

    // Missing canonical attribute
    const missingAttr = JSON.parse(original);
    const keys = Object.keys(missingAttr.afterSnapshot.player.attributes);
    delete missingAttr.afterSnapshot.player.attributes[keys[0]];
    writeFileSync(snapPath, `${JSON.stringify(missingAttr)}\n`);
    const missing = await reviewTest.assessNatural99(join(HERE, ".."));
    assert.equal(missing.ok, false);
    assert.ok(missing.problems.some((p) => p.startsWith("after-attr-missing:") || p === "recomputed-after-null"));

    // Small threshold-crossing discrepancy: nudge cached after below 98.5 while attrs stay valid.
    const threshold = JSON.parse(original);
    threshold.afterSnapshot.player.baseOverallRaw = 98.4;
    threshold.afterSnapshot.player.currentOverallRaw = 98.4;
    writeFileSync(snapPath, `${JSON.stringify(threshold)}\n`);
    const discrepancy = await reviewTest.assessNatural99(join(HERE, ".."));
    assert.equal(discrepancy.ok, false);
    assert.ok(
      discrepancy.problems.some((p) =>
        ["after-cache-mismatch", "snapshot-threshold-invalid"].includes(p)
      )
    );
  } finally {
    writeFileSync(snapPath, original);
  }
  // Restored fixture must still assess cleanly in isolation.
  const restored = await reviewTest.assessNatural99(join(HERE, ".."));
  assert.equal(restored.ok, true, restored.problems?.join(","));
  void assessPackageEvidence;
});

test("package assessor rejects same-engine identity pairs and a missing holdout trajectory", async () => {
  const { __test: reviewTest } = await import("../scripts/lib/fix11ReviewEvidence.mjs");
  const identityOnly = reviewTest.assessBaseFinalPaired(join(HERE, "..", "qa", "fix11-runs", "paired-rereview"));
  assert.equal(identityOnly.ok, false);
  assert.ok(identityOnly.problems.some((p) => p.includes("paired-same-engine") || p.includes("paired-kind")));

  const holdoutDir = join(HERE, "..", "qa", "fix11-runs", "holdout-final");
  const traj = join(holdoutDir, "trajectories", "trajectory-500000.json");
  const original = readFileSync(traj);
  try {
    rmSync(traj);
    const plan = JSON.parse(readFileSync(join(HERE, "..", "qa", "fix11-runs", "plan.json"), "utf8"));
    // Inline minimal assess via calibrationProvenance on a temp package-shaped root is heavy;
    // call the holdout helper through assessHoldoutAndPaired after removing the file.
    const assessed = reviewTest.assessHoldoutAndPaired(join(HERE, ".."));
    assert.equal(assessed.ok, false);
    assert.ok(
      assessed.problems.some((p) => p.includes("holdout-missing:trajectory-500000") || p.includes("holdout-count")),
      assessed.problems.join(",")
    );
    void plan;
  } finally {
    writeFileSync(traj, original);
  }
});
