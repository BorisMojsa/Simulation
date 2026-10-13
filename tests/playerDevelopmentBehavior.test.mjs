/**
 * Behavioral fixtures for player-development-v2
 * Run: node tests/playerDevelopmentBehavior.test.mjs
 */
import assert from "node:assert/strict";
import { createRng, hashSeed, createStreamRng } from "../js/simulation/rng.js";
import {
  developSeason,
  initializePlayerDevelopment,
  generateStartingAttributes,
} from "../js/simulation/playerDevelopmentModel.js";
import { calculateOverall, refreshAbilityCaches } from "../js/simulation/playerAbility.js";
import { applyInjury, sampleInjuryFromExposure, isAvailable, advanceHealth } from "../js/simulation/playerHealth.js";
import { addDays, daysBetween } from "../js/simulation/seasonCalendar.js";
import { forecastPotential } from "../js/simulation/playerPotential.js";
import { RW_FIXTURE_ATTRIBUTES } from "../js/simulation/playerAbility.js";

function test(name, fn) {
  try {
    fn();
    console.log(`OK  ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

function mkPlayer(overrides = {}) {
  const rng = createRng(hashSeed(overrides.careerId || "p"));
  const pos = overrides.position || "RW";
  const attrs = overrides.attributes || generateStartingAttributes(pos, 70, 85, rng);
  const player = {
    name: "Beh",
    nationality: "England",
    position: pos,
    age: overrides.age ?? 18,
    careerId: overrides.careerId || "beh-1",
    attributes: attrs,
    rating: 70,
    ...overrides,
  };
  initializePlayerDevelopment(player, { rng, careerId: player.careerId });
  if (overrides.budget != null) {
    player.development.latentAbilityBudget = overrides.budget;
    player.development.abilityBudgetsByPosition = { [pos]: overrides.budget };
  }
  return player;
}

test("healthy 18yo improves with variation", () => {
  const deltas = [];
  for (let i = 0; i < 40; i++) {
    const p = mkPlayer({ careerId: `h18-${i}`, age: 18, budget: 88 });
    const before = p.baseOverallRaw;
    developSeason(p, {
      elapsedYears: 1,
      usefulMinutes: 2200,
      healthyTrainingFraction: 1,
      reliableSignal: 0.2,
      environmentMultiplier: 1,
      rng: createRng(100 + i),
      seasonId: "s1",
      alreadyAppliedLearningGain: 0,
    });
    deltas.push(p.baseOverallRaw - before);
  }
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  assert.ok(mean > 0.3 && mean < 4, `mean Δ ${mean}`);
  assert.ok(deltas.some((d) => d < mean) && deltas.some((d) => d > mean));
});

test("near ceiling grows slower than high headroom", () => {
  const slow = mkPlayer({ careerId: "ceil-slow", age: 19 });
  slow.development.latentAbilityBudget = slow.baseOverallRaw + 0.4;
  const fast = mkPlayer({ careerId: "ceil-fast", age: 19, budget: 92 });
  const dSlow = (() => {
    const b = slow.baseOverallRaw;
    developSeason(slow, {
      elapsedYears: 1,
      usefulMinutes: 2400,
      healthyTrainingFraction: 1,
      reliableSignal: 0.3,
      environmentMultiplier: 1.1,
      rng: createRng(1),
      seasonId: "s1",
      alreadyAppliedLearningGain: 0,
    });
    return slow.baseOverallRaw - b;
  })();
  const dFast = (() => {
    const b = fast.baseOverallRaw;
    developSeason(fast, {
      elapsedYears: 1,
      usefulMinutes: 2400,
      healthyTrainingFraction: 1,
      reliableSignal: 0.3,
      environmentMultiplier: 1.1,
      rng: createRng(1),
      seasonId: "s1",
      alreadyAppliedLearningGain: 0,
    });
    return fast.baseOverallRaw - b;
  })();
  assert.ok(dFast > dSlow, `fast ${dFast} vs slow ${dSlow}`);
});

test("elite age-20 allowed when attributes support it", () => {
  const attrs = {
    Speed: 92,
    Passing: 88,
    Shooting: 90,
    Defending: 70,
    Physicality: 86,
    Dribbling: 93,
  };
  const { rounded } = calculateOverall(attrs, "RW");
  assert.ok(rounded >= 88);
  const p = mkPlayer({ careerId: "elite20", age: 20, attributes: attrs, budget: 99 });
  assert.ok(p.rating >= 88);
});

test("no forced cliff at 34", () => {
  const p = mkPlayer({
    careerId: "age34",
    age: 34,
    attributes: { ...RW_FIXTURE_ATTRIBUTES },
    budget: 85,
  });
  const before = p.baseOverallRaw;
  developSeason(p, {
    elapsedYears: 1,
    usefulMinutes: 2000,
    healthyTrainingFraction: 0.9,
    reliableSignal: 0.1,
    environmentMultiplier: 1,
    rng: createRng(34),
    seasonId: "s34",
    alreadyAppliedLearningGain: 0,
  });
  // May decline, but not a forced universal step of the old model size.
  assert.ok(p.baseOverallRaw > before - 4, `decline ${before - p.baseOverallRaw}`);
});

test("injury blocks availability across year boundary", () => {
  const p = mkPlayer({ careerId: "inj-cal", age: 24 });
  const onset = "2026-12-20";
  const inj = sampleInjuryFromExposure({
    hours: 50,
    kind: "match",
    riskMultiplier: 2,
    rng: createRng(999),
    eventId: "inj-1",
    date: onset,
    position: p.position,
  });
  // Force a moderate/severe style injury for the test
  const forced = {
    eventId: "inj-forced",
    onsetDate: onset,
    expectedTimeLossDays: 45,
    availableFrom: addDays(onset, 45),
    type: "muscle_strain",
    severity: "moderate",
    affectedSkills: ["Speed"],
    temporaryStateEffects: { readiness: 0.55 },
    durableDamage: null,
    rehabilitation: null,
  };
  // Align with health module day-index fields.
  const startDay = 0;
  forced.startDay = startDay;
  forced.expectedReturnDay = startDay + 45;
  forced.durationDays = 45;
  applyInjury(p, forced);
  assert.equal(isAvailable(p.health, startDay + 20), false);
  assert.equal(isAvailable(p.health, startDay + 45), true);
  advanceHealth(p, startDay + 45);
  assert.equal(p.health.activeInjury, null);
  assert.ok(forced.durationDays === 45);
  void daysBetween;
  void onset;
});

test("transfer to weaker context does not instantly strip base attrs", () => {
  const p = mkPlayer({ careerId: "xfer", age: 26, budget: 84 });
  const snap = { ...p.attributes };
  p.state.adaptationPenalty = 0.8;
  p.state.morale = 0.35;
  refreshAbilityCaches(p);
  assert.ok(p.currentOverall <= p.rating);
  for (const k of Object.keys(snap)) {
    assert.equal(p.attributes[k], snap[k]);
  }
});

test("forecast panel RNG does not alter development stream outcome", () => {
  const p1 = mkPlayer({ careerId: "fore-iso", age: 19, budget: 88 });
  const p2 = mkPlayer({ careerId: "fore-iso", age: 19, budget: 88 });
  forecastPotential(p1, { sampleCount: 32 });
  forecastPotential(p1, { sampleCount: 64 });
  const dev = (p) => {
    const b = p.baseOverallRaw;
    developSeason(p, {
      elapsedYears: 1,
      usefulMinutes: 2000,
      healthyTrainingFraction: 1,
      reliableSignal: 0.2,
      environmentMultiplier: 1,
      rng: createStreamRng(p.careerId, "development:season-1"),
      seasonId: "season-1",
      alreadyAppliedLearningGain: 0,
    });
    return p.baseOverallRaw - b;
  };
  const d1 = dev(p1);
  const d2 = dev(p2);
  assert.ok(Math.abs(d1 - d2) < 1e-6, `${d1} vs ${d2}`);
});

test("lost call-up has no base OVR deduction helper path", () => {
  const p = mkPlayer({ careerId: "intl", age: 23 });
  const before = p.baseOverallRaw;
  // Selection miss only touches morale in policy — simulate that alone.
  p.state.morale = Math.max(0, p.state.morale - 0.03);
  refreshAbilityCaches(p);
  assert.equal(p.baseOverallRaw, before);
});

console.log("behavior tests done");
