/**
 * Round 2 Item 7 — senior growth and dynamic potential.
 *
 * Covers rolling evidence → forecast assumptions, policy differentiation
 * (minutes / loan / form / injury), cache stability, and young-player growth
 * under useful minutes.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRng } from "../js/simulation/rng.js";
import {
  developSeason,
  generateStartingAttributes,
  initializePlayerDevelopment,
} from "../js/simulation/playerDevelopmentModel.js";
import {
  buildRollingEvidenceAssumptions,
  forecastInputSignature,
  getOrUpdateForecast,
} from "../js/simulation/playerPotential.js";
import { calculateOverall, refreshAbilityCaches } from "../js/simulation/playerAbility.js";
import { FORECAST_CONFIG } from "../js/config/playerDevelopmentConfig.js";

function makePlayer({ position = "CM", target = 68, age = 19, seed = 7 } = {}) {
  const rng = createRng(seed);
  const attributes = generateStartingAttributes(position, target, 99, rng);
  const player = {
    name: `Item7-${position}-${seed}`,
    position,
    age,
    attributes,
    seasons: [],
  };
  initializePlayerDevelopment(player, { rng: createRng(seed + 1), careerId: player.name });
  refreshAbilityCaches(player);
  return player;
}

function develop(player, ctx, seed) {
  return developSeason(player, {
    elapsedYears: 1,
    usefulMinutes: 2400,
    healthyTrainingFraction: 0.95,
    reliability: 0.85,
    P_long: 0.35,
    environmentMultiplier: 1.05,
    ...ctx,
    rng: createRng(seed),
    seasonId: ctx.seasonId ?? `s-${seed}`,
  });
}

test("rolling evidence: empty career uses defaults; signature stable across reload", () => {
  const p = makePlayer({ seed: 11 });
  const a1 = buildRollingEvidenceAssumptions(p);
  assert.equal(a1.evidenceSource, "defaults");
  assert.equal(a1.evidenceSeasons, 0);
  assert.equal(a1.opportunity, FORECAST_CONFIG.defaultAssumptions.opportunity);
  const f1 = getOrUpdateForecast(p, { sampleCount: 32 });
  const snap = structuredClone(p);
  const f2 = getOrUpdateForecast(snap, { sampleCount: 32 });
  assert.equal(f1.inputSignature, f2.inputSignature);
  assert.equal(f1.median, f2.median);
  assert.equal(f1.potentialCache, snap.potential);
});

test("rolling evidence: regular minutes raise outlook vs elite-club bench", () => {
  const regular = makePlayer({ seed: 21, age: 20, target: 70 });
  const bench = makePlayer({ seed: 21, age: 20, target: 70 });
  for (let i = 0; i < 3; i++) {
    develop(regular, {
      seasonId: `reg-${i}`,
      usefulMinutes: 2600,
      P_long: 0.4,
      reliability: 0.9,
      environmentMultiplier: 1.0,
    }, 100 + i);
    develop(bench, {
      seasonId: `bench-${i}`,
      usefulMinutes: 450,
      P_long: 0.05,
      reliability: 0.55,
      environmentMultiplier: 1.25,
    }, 100 + i);
  }
  const aReg = buildRollingEvidenceAssumptions(regular);
  const aBench = buildRollingEvidenceAssumptions(bench);
  assert.ok(aReg.opportunity > aBench.opportunity + 0.15, `opp ${aReg.opportunity} vs ${aBench.opportunity}`);
  assert.ok(aReg.pLong > aBench.pLong + 0.1, `pLong ${aReg.pLong} vs ${aBench.pLong}`);
  const fReg = getOrUpdateForecast(regular, { sampleCount: 40, assumptions: aReg });
  const fBench = getOrUpdateForecast(bench, { sampleCount: 40, assumptions: aBench });
  assert.ok(
    fReg.median > fBench.median + 0.75,
    `regular median ${fReg.median} should beat bench ${fBench.median}`,
  );
});

test("rolling evidence: productive loan context raises outlook vs limited home minutes", () => {
  const loan = makePlayer({ seed: 31, age: 19, target: 66 });
  const stuck = makePlayer({ seed: 31, age: 19, target: 66 });
  develop(loan, {
    seasonId: "loan-1",
    usefulMinutes: 2300,
    P_long: 0.45,
    reliability: 0.88,
    environmentMultiplier: 1.05,
  }, 200);
  develop(stuck, {
    seasonId: "stuck-1",
    usefulMinutes: 600,
    P_long: -0.05,
    reliability: 0.5,
    environmentMultiplier: 1.15,
  }, 200);
  const fLoan = getOrUpdateForecast(loan, { sampleCount: 40 });
  const fStuck = getOrUpdateForecast(stuck, { sampleCount: 40 });
  assert.ok(fLoan.assumptions.opportunity > fStuck.assumptions.opportunity);
  assert.ok(fLoan.median > fStuck.median + 0.5, `${fLoan.median} vs ${fStuck.median}`);
});

test("rolling evidence: sustained strong vs poor play, and recovery after a poor season", () => {
  const strong = makePlayer({ seed: 41, age: 21, target: 72 });
  const poor = makePlayer({ seed: 41, age: 21, target: 72 });
  const recover = makePlayer({ seed: 41, age: 21, target: 72 });
  for (let i = 0; i < 3; i++) {
    develop(strong, { seasonId: `st-${i}`, P_long: 0.55, usefulMinutes: 2500, reliability: 0.92 }, 300 + i);
    develop(poor, { seasonId: `po-${i}`, P_long: -0.55, usefulMinutes: 2200, reliability: 0.9 }, 300 + i);
  }
  develop(recover, { seasonId: "rec-0", P_long: -0.55, usefulMinutes: 2200, reliability: 0.9 }, 300);
  develop(recover, { seasonId: "rec-1", P_long: 0.5, usefulMinutes: 2500, reliability: 0.9 }, 301);
  develop(recover, { seasonId: "rec-2", P_long: 0.55, usefulMinutes: 2500, reliability: 0.92 }, 302);

  const fStrong = getOrUpdateForecast(strong, { sampleCount: 40 });
  const fPoor = getOrUpdateForecast(poor, { sampleCount: 40 });
  const fRecover = getOrUpdateForecast(recover, { sampleCount: 40 });
  assert.ok(fStrong.median > fPoor.median + 1.5);
  assert.ok(fRecover.assumptions.pLong > fPoor.assumptions.pLong + 0.35);
  assert.ok(fRecover.median > fPoor.median + 0.75);
});

test("rolling evidence: injured exposure lowers outlook vs healthy twin", () => {
  const healthy = makePlayer({ seed: 51, age: 20, target: 69 });
  const injured = makePlayer({ seed: 51, age: 20, target: 69 });
  develop(healthy, {
    seasonId: "h1",
    usefulMinutes: 2400,
    healthyTrainingFraction: 0.95,
    P_long: 0.3,
    reliability: 0.85,
  }, 400);
  develop(injured, {
    seasonId: "i1",
    usefulMinutes: 900,
    healthyTrainingFraction: 0.35,
    P_long: 0.05,
    reliability: 0.45,
  }, 400);
  const fH = getOrUpdateForecast(healthy, { sampleCount: 40 });
  const fI = getOrUpdateForecast(injured, { sampleCount: 40 });
  assert.ok(fH.assumptions.healthyTrainingFraction > fI.assumptions.healthyTrainingFraction + 0.2);
  assert.ok(fH.median > fI.median + 0.4);
});

test("forecast cache: identical state hits cache; meaningful new evidence refreshes", () => {
  const p = makePlayer({ seed: 61 });
  develop(p, { seasonId: "c0", P_long: 0.2, usefulMinutes: 2000 }, 500);
  const f1 = getOrUpdateForecast(p, { sampleCount: 32 });
  const f2 = getOrUpdateForecast(p, { sampleCount: 32 });
  assert.equal(f1, f2);
  develop(p, { seasonId: "c1", P_long: 0.7, usefulMinutes: 2700, reliability: 0.95 }, 501);
  const f3 = getOrUpdateForecast(p, { sampleCount: 32 });
  assert.notEqual(f3.inputSignature, f1.inputSignature);
  assert.ok(f3.assumptions.pLong > f1.assumptions.pLong);
});

test("force:true bypasses cache after mid-season event", () => {
  const p = makePlayer({ seed: 71 });
  const a = { opportunity: 0.8, pLong: 0.2, reliability: 0.7, environmentMultiplier: 1, healthyTrainingFraction: 0.95 };
  const f1 = getOrUpdateForecast(p, { sampleCount: 24, assumptions: a });
  // Mutate traits without changing signature inputs that we control — force must recompute object.
  const fForced = getOrUpdateForecast(p, { sampleCount: 24, assumptions: a, force: true });
  assert.notEqual(fForced, f1);
  assert.equal(fForced.inputSignature, f1.inputSignature);
  assert.equal(fForced.median, f1.median);
});

test("young player with useful minutes and good play progresses meaningfully", () => {
  const p = makePlayer({ seed: 81, age: 18, target: 68, position: "ST" });
  const before = calculateOverall(p.attributes, p.position).raw;
  const deltas = [];
  for (let i = 0; i < 3; i++) {
    const r = develop(p, {
      seasonId: `yg-${i}`,
      usefulMinutes: 2400,
      P_long: 0.4,
      reliability: 0.88,
      healthyTrainingFraction: 0.95,
      environmentMultiplier: 1.05,
    }, 600 + i);
    p.age += 1;
    deltas.push(r.overallDelta);
  }
  const after = calculateOverall(p.attributes, p.position).raw;
  const total = after - before;
  assert.ok(total >= 7.5, `expected robust 3-year growth, got ${total}`);
  assert.ok(deltas.every((d) => d > 1.2), `each good season should clear +1.2, got ${deltas}`);
  // Poor twin stays well below.
  const poor = makePlayer({ seed: 81, age: 18, target: 68, position: "ST" });
  for (let i = 0; i < 3; i++) {
    develop(poor, {
      seasonId: `yp-${i}`,
      usefulMinutes: 2400,
      P_long: -0.5,
      reliability: 0.9,
      healthyTrainingFraction: 0.95,
    }, 600 + i);
    poor.age += 1;
  }
  const poorAfter = calculateOverall(poor.attributes, poor.position).raw;
  assert.ok(after > poorAfter + 4, `good ${after} vs poor ${poorAfter}`);
});

test("signature includes rolling revision and rounded assumption channels", () => {
  const p = makePlayer({ seed: 91 });
  const a = buildRollingEvidenceAssumptions(p);
  const s1 = forecastInputSignature(p, { sampleCount: 32, assumptions: a });
  const s2 = forecastInputSignature(p, { sampleCount: 32, assumptions: { ...a, pLong: (a.pLong || 0) + 0.2 } });
  assert.notEqual(s1, s2);
});
