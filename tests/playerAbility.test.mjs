/**
 * player-development-v2 tests.
 * Run: node tests/playerAbility.test.mjs
 */
import assert from "node:assert/strict";
import {
  GK_OVERALL_WEIGHTS,
  OUTFIELD_OVERALL_WEIGHTS,
  PLAYER_MODEL_VERSION,
  DEVELOPMENT_MODEL_VERSION,
  validateWeights,
  LATENT_BUDGET_BANDS,
} from "../js/config/playerDevelopmentConfig.js";
import {
  calculateEffectiveAttributes,
  calculateOverall,
  getOverallWeights,
  normalizePosition,
  refreshAbilityCaches,
  rwFixtureAttributes,
  validateAttributes,
} from "../js/simulation/playerAbility.js";
import { applyMoraleDelta, computeTargetStateDelta, createNeutralState, decayAdaptation, setAdaptationPenalty } from "../js/simulation/playerState.js";
import { advanceHealth, applyInjury, applyRecoverableRestoration, computeRiskMultiplier, createEmptyHealth, isAvailable, sampleInjuryFromExposure } from "../js/simulation/playerHealth.js";
import { aggregateSeason, createEmptyLedger, recordMatchObservation } from "../js/simulation/playerSeasonLedger.js";
import {
  applyAcademyGrowth,
  developSeason,
  generateGkAttributes,
  generateStartingAttributes,
  initializePlayerDevelopment,
  sampleLatentBudget,
  sampleTraits,
} from "../js/simulation/playerDevelopmentModel.js";
import { forecastPotential, getOrUpdateForecast } from "../js/simulation/playerPotential.js";
import { ensurePlayerModel, migratePlayerToV2 } from "../js/simulation/playerModelMigration.js";
import { createRng, createStreamRng } from "../js/simulation/rng.js";

function test(name, fn) {
  try {
    fn();
    console.log(`OK  ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

function makePlayer(position = "RW", rating = 62, age = 17, seed = "t1") {
  const p = { name: `P-${seed}`, position, age, rating, potential: 0 };
  initializePlayerDevelopment(p, { rng: createStreamRng(seed, "init"), careerId: seed });
  return p;
}

/* ------------------------------------------------------------------ */

test("weight tables sum to 1 and validateWeights passes", () => {
  assert.equal(validateWeights(), true);
  for (const [pos, row] of Object.entries(OUTFIELD_OVERALL_WEIGHTS)) {
    near(Object.values(row).reduce((a, b) => a + b, 0), 1);
    assert.deepEqual(Object.keys(row), ["Speed", "Passing", "Shooting", "Defending", "Physicality", "Dribbling"], pos);
  }
  near(Object.values(GK_OVERALL_WEIGHTS).reduce((a, b) => a + b, 0), 1);
  assert.equal(PLAYER_MODEL_VERSION, 2);
  assert.equal(DEVELOPMENT_MODEL_VERSION, "player-development-v2");
  near(LATENT_BUDGET_BANDS.reduce((s, b) => s + b.mass, 0), 1);
  for (const pos of [...Object.keys(OUTFIELD_OVERALL_WEIGHTS), "GK"]) {
    const w = getOverallWeights(pos);
    near(Object.values(w).reduce((a, b) => a + b, 0), 1);
    assert.ok(Object.values(w).every((v) => v >= 0));
  }
});

test("position aliases normalise", () => {
  assert.deepEqual(
    ["CF", "RWB", "LWB", "DM", "AM", "st", "GK", "??"].map((p) => normalizePosition(p).position),
    ["ST", "RB", "LB", "CDM", "CAM", "ST", "GK", "DEFAULT"],
  );
  assert.equal(normalizePosition("CF").aliasUsed, "CF");
  assert.equal(normalizePosition("??").isDefaultFallback, true);
  assert.equal(normalizePosition("RW").isDefaultFallback, false);
});

test("RW fixture overall is 80.10", () => {
  const attrs = rwFixtureAttributes();
  assert.deepEqual(attrs, { Speed: 80, Passing: 71, Shooting: 79, Defending: 72, Physicality: 73, Dribbling: 88 });
  const o = calculateOverall(attrs, "RW");
  near(o.raw, 80.1, 1e-9);
  assert.equal(o.rounded, 80);
  assert.equal(o.minAttr, 71);
  assert.equal(o.maxAttr, 88);
  assert.equal(o.keysUsed.length, 6);
});

test("overall is within attribute min/max and has no floor of 40", () => {
  const low = { Speed: 5, Passing: 6, Shooting: 7, Defending: 8, Physicality: 9, Dribbling: 10 };
  const o = calculateOverall(low, "ST");
  assert.ok(o.raw >= 5 && o.raw <= 10);
  assert.ok(o.raw < 40);
  const flat = { Speed: 55, Passing: 55, Shooting: 55, Defending: 55, Physicality: 55, Dribbling: 55 };
  near(calculateOverall(flat, "CB").raw, 55);
  assert.throws(() => calculateOverall({ Speed: 50 }, "ST"), RangeError);
});

test("GK shooting is irrelevant to GK overall", () => {
  const gk = { Reflexes: 80, Handling: 75, Positioning: 78, Diving: 79, Kicking: 60, Physicality: 70 };
  const a = calculateOverall(gk, "GK");
  const b = calculateOverall({ ...gk, Shooting: 1 }, "GK");
  const c = calculateOverall({ ...gk, Shooting: 99 }, "GK");
  assert.equal(a.raw, b.raw);
  assert.equal(a.raw, c.raw);
  assert.ok(!a.keysUsed.includes("Shooting"));
  near(a.raw, 0.25 * 80 + 0.2 * 75 + 0.2 * 78 + 0.15 * 79 + 0.1 * 60 + 0.1 * 70);
  assert.equal(validateAttributes(rwFixtureAttributes(), "GK").ok, false);
  assert.equal(validateAttributes(gk, "GK").ok, true);
  assert.equal(validateAttributes({ ...rwFixtureAttributes(), Speed: 120 }, "RW").ok, false);
});

test("potential is never 100 and has no +1 floor", () => {
  // A maxed-out player: forecast cannot reach 100.
  const p = makePlayer("ST", 60, 22, "elite");
  p.attributes = { Speed: 99, Passing: 99, Shooting: 99, Defending: 99, Physicality: 99, Dribbling: 99 };
  p.development.latentBudget = 97;
  refreshAbilityCaches(p);
  const f = forecastPotential(p, { careerId: "elite" });
  assert.ok(f.potentialCache <= 99, `potential ${f.potentialCache}`);
  assert.notEqual(f.potentialCache, 100);
  // A peaked veteran: potential equals current rating (no +1).
  const v = makePlayer("CM", 70, 34, "vet");
  const fv = forecastPotential(v, { careerId: "vet" });
  assert.ok(fv.potentialCache >= v.rating);
  assert.ok(fv.potentialCache - v.rating <= 1, "veteran potential should not exceed rating by much");
  assert.ok(fv.lower <= fv.median && fv.median <= fv.upper);
  assert.ok(fv.confidence >= 0.05 && fv.confidence <= 0.99);
  // Budgets never exceed the hard max (prompt allows up to 99).
  const rng = createRng(5);
  for (let i = 0; i < 2000; i++) assert.ok(sampleLatentBudget(rng) <= 99);
});

test("rating cache refresh follows attributes", () => {
  const p = { position: "RW", attributes: rwFixtureAttributes(), state: createNeutralState(), health: createEmptyHealth() };
  refreshAbilityCaches(p);
  near(p.baseOverallRaw, 80.1);
  assert.equal(p.rating, 80);
  assert.equal(p.currentOverall, 80);
  p.attributes.Dribbling = 70; // -18 * .30 = -5.4
  refreshAbilityCaches(p);
  near(p.baseOverallRaw, 74.7);
  assert.equal(p.rating, 75);
  // Temporary state moves current, not base.
  p.state.fatigue = 1;
  refreshAbilityCaches(p);
  near(p.baseOverallRaw, 74.7);
  assert.ok(p.currentOverallRaw < p.baseOverallRaw);
  near(p.currentOverallRaw, p.baseOverallRaw - 1.5, 1e-6);
  // GK recalculated with GK keys.
  const g = { position: "GK", attributes: { Reflexes: 70, Handling: 70, Positioning: 70, Diving: 70, Kicking: 70, Physicality: 70 } };
  refreshAbilityCaches(g);
  assert.equal(g.rating, 70);
});

test("state delta: neutral = 0, clamped, morale bounded, adaptation decays", () => {
  assert.equal(computeTargetStateDelta(createNeutralState()), 0);
  near(computeTargetStateDelta({ ...createNeutralState(), form: 1 }), 2.25);
  assert.equal(computeTargetStateDelta({ ...createNeutralState(), form: 1, morale: 1 }), 3); // clamp +3
  assert.equal(computeTargetStateDelta({ form: -1, morale: -1, readiness: 0, fatigue: 1, adaptationPenalty: 1 }), -6);
  const s = createNeutralState();
  applyMoraleDelta(s, 0.5);
  near(s.morale, 0.05);
  applyMoraleDelta(s, -0.5, { override: true });
  near(s.morale, -0.45);
  setAdaptationPenalty(s, 0.8);
  decayAdaptation(s, 60);
  near(s.adaptationPenalty, 0.4, 1e-9);
  // Effective attrs: distribution moves the overall by the delta.
  const eff = calculateEffectiveAttributes(rwFixtureAttributes(), { ...createNeutralState(), form: 1 }, "RW");
  near(calculateOverall(eff, "RW").raw, 80.1 + 2.25, 1e-9);
  for (const v of Object.values(eff)) assert.ok(v >= 1 && v <= 99);
});

test("injury: exposure sampling, idempotent apply, recovery, restoration", () => {
  const p = makePlayer("CB", 70, 25, "inj");
  const date = "2027-01-10T00:00:00.000Z";
  // Force an injury with a huge exposure.
  const rec = sampleInjuryFromExposure({ hours: 1000, kind: "match", riskMultiplier: 2, rng: createRng(3), eventId: "m1", date, position: "CB" });
  assert.ok(rec && rec.eventId === "m1" && rec.durationDays >= 3);
  assert.equal(sampleInjuryFromExposure({ hours: 0, kind: "match", rng: createRng(1), eventId: "x", date }), null);
  rec.severity = "severe"; // make durable-damage sampling worthwhile
  rec.temporaryEffects.overallPenalty = 6;
  let damaged = null;
  for (let i = 0; i < 40 && !damaged; i++) {
    const q = makePlayer("CB", 70, 25, `inj${i}`);
    const r = applyInjury(q, { ...rec, eventId: `e${i}` }, { rng: createRng(i + 1) });
    if (r.durableDamage && Object.keys(r.durableDamage).length) damaged = { q, r, id: `e${i}` };
  }
  assert.ok(damaged, "severe injuries should sometimes damage attributes");
  const { q } = damaged;
  const snapshot = JSON.stringify(q.attributes);
  const again = applyInjury(q, { ...rec, eventId: damaged.id }, { rng: createRng(99) });
  assert.equal(again.duplicate, true);
  assert.equal(JSON.stringify(q.attributes), snapshot, "duplicate event must not re-damage");
  assert.ok(q.health.activeInjury);
  assert.equal(isAvailable(q.health, date), false);
  assert.ok(q.currentOverallRaw < q.baseOverallRaw);
  // Restoration only touches tracked recoverable damage.
  const lost = Object.values(q.health.durableDamage).reduce((a, b) => a + b, 0);
  const recoverable = Object.values(q.health.recoverableDamage).reduce((a, b) => a + b, 0);
  assert.ok(recoverable > 0 && recoverable <= lost);
  const res = applyRecoverableRestoration(q, 100);
  near(res.restored, recoverable, 1e-9);
  assert.equal(Object.keys(q.health.recoverableDamage).length, 0);
  // Recovery.
  const after = new Date(Date.parse(date) + 400 * 86400000).toISOString();
  const adv = advanceHealth(q, after);
  assert.equal(adv.recovered, true);
  assert.equal(q.health.activeInjury, null);
  assert.equal(isAvailable(q.health, after), true);
  const m = computeRiskMultiplier(q);
  assert.ok(m >= 0.5 && m <= 2);
});

test("ledger: exact-once, non-participation, aggregation, observation", () => {
  const L = createEmptyLedger("2027");
  const base = { competitionType: "league", minutes: 90, started: true, goals: 1, assists: 0, rating: 7.4, expectedRating: 6.6, position: "ST" };
  assert.equal(recordMatchObservation(L, { ...base, matchId: "a" }).recorded, true);
  assert.equal(recordMatchObservation(L, { ...base, matchId: "a" }).duplicate, true);
  assert.equal(recordMatchObservation(L, { ...base, matchId: "b", minutes: 0 }).reason, "no-participation");
  recordMatchObservation(L, { ...base, matchId: "c", competitionType: "international", minutes: 45, started: false, goals: 0, assists: 1, rating: 6.0 });
  recordMatchObservation(L, { ...base, matchId: "d", competitionType: "cup", rating: undefined });
  const a = aggregateSeason(L);
  assert.equal(a.apps, 3);
  assert.equal(a.starts, 2);
  assert.equal(a.minutes, 225);
  assert.equal(a.goals, 2);
  assert.equal(a.assists, 1);
  assert.equal(a.international.apps, 1);
  assert.equal(a.club.apps, 2);
  assert.equal(a.byCompetitionType.cup.apps, 1);
  assert.equal(a.nonParticipationCount, 1);
  assert.equal(a.ratedMinutes, 135);
  near(a.avgRating, (7.4 * 90 + 6.0 * 45) / 135, 1e-9);
  const z1 = Math.tanh(Math.min(3, (7.4 - 6.6) / 0.9) / 1.5);
  assert.ok(Math.abs(L.matches[0].observation - z1) < 1e-9);
  assert.ok(a.reliability > 0 && a.reliability < 1);
});

test("development: determinism, bounds, idempotent season, budget respected", () => {
  const run = () => {
    const p = makePlayer("ST", 60, 17, "dev");
    const rng = createStreamRng("dev", "career");
    const out = [];
    for (let age = 17; age <= 36; age++) {
      p.age = age;
      const r = developSeason(p, {
        rng, seasonId: `S${age}`, elapsedYears: 1, usefulMinutes: 2000, healthyTrainingFraction: 0.95,
        reliableSignal: 0.7, P_long: 0.2, environmentMultiplier: 1,
      });
      out.push(Math.round(p.baseOverallRaw * 1000) / 1000);
      assert.ok(Object.values(p.attributes).every((v) => v >= 1 && v <= 99 && Number.isFinite(v)));
      assert.ok(p.baseOverallRaw <= p.development.latentBudget + 1e-6, "overall must not exceed budget");
      assert.equal(p.rating, Math.round(p.baseOverallRaw));
      assert.ok(r.components && Array.isArray(r.explanations));
    }
    return { p, out };
  };
  const a = run();
  const b = run();
  assert.deepEqual(a.out, b.out, "same seeds => same trajectory");
  const peak = Math.max(...a.out);
  assert.ok(peak > a.out[0], "player should improve in youth");
  assert.ok(a.out.at(-1) < peak, "player should decline by 36");
  // Idempotent per season.
  const p = makePlayer("CM", 60, 18, "idem");
  const rng = createRng(11);
  const r1 = developSeason(p, { rng, seasonId: "X", usefulMinutes: 1500 });
  const snap = JSON.stringify(p.attributes);
  const r2 = developSeason(p, { rng, seasonId: "X", usefulMinutes: 1500 });
  assert.equal(r1.skipped, false);
  assert.equal(r2.skipped, true);
  assert.equal(JSON.stringify(p.attributes), snap);
});

test("development: annual cap, deconditioning is recoverable", () => {
  const p = makePlayer("RW", 55, 16, "cap");
  p.development.latentBudget = 97;
  p.development.abilityBudgetsByPosition.RW.budget = 97;
  p.development.traits.trainability = 1.3;
  const r = developSeason(p, { rng: createRng(2), seasonId: 1, usefulMinutes: 2000, healthyTrainingFraction: 1, environmentMultiplier: 1.5, reliableSignal: 1, P_long: 1 });
  assert.ok(r.components.learning <= 6 + 1e-9, `learning ${r.components.learning}`);
  // Deconditioning then restoration.
  const q = makePlayer("CM", 70, 26, "decon");
  const before = q.baseOverallRaw;
  const r1 = developSeason(q, { rng: createRng(4), seasonId: 1, usefulMinutes: 0, healthyTrainingFraction: 0.1 });
  assert.ok(r1.components.deconditioning < 0);
  const lostPool = Object.values(q.health.recoverableDamage).reduce((a, b) => a + b, 0);
  assert.ok(lostPool > 0);
  developSeason(q, { rng: createRng(5), seasonId: 2, usefulMinutes: 2500, healthyTrainingFraction: 1 });
  const poolAfter = Object.values(q.health.recoverableDamage).reduce((a, b) => a + b, 0);
  assert.ok(poolAfter < lostPool, "recoverable damage should shrink once healthy");
  assert.ok(before > 0);
});

test("starting attributes hit target within budget; GK uses GK keys", () => {
  const rng = createRng(9);
  for (const pos of ["ST", "CB", "CM", "RW", "LB"]) {
    const a = generateStartingAttributes(pos, { min: 55, max: 70 }, 72, rng);
    const o = calculateOverall(a, pos).raw;
    assert.ok(o >= 54.9 && o <= 72, `${pos} ${o}`);
    assert.ok(validateAttributes(a, pos).ok);
  }
  const tight = generateStartingAttributes("ST", 80, 70, rng);
  assert.ok(calculateOverall(tight, "ST").raw <= 70 + 1e-9);
  const gk = generateGkAttributes(65, 80, rng);
  assert.ok(validateAttributes(gk, "GK").ok);
  near(calculateOverall(gk, "GK").raw, 65, 0.01);
  assert.ok(!("Shooting" in gk));
  const t = sampleTraits(rng);
  assert.ok(t.trainability >= 0.7 && t.trainability <= 1.3 && t.declineProtection <= 0.25);
});

test("academy growth mutates attributes and charges budget", () => {
  const p = makePlayer("CM", 60, 16, "acad");
  p.development.latentBudget = 80;
  p.development.abilityBudgetsByPosition.CM.budget = 80;
  const before = p.baseOverallRaw;
  const r = applyAcademyGrowth(p, 2, { rng: createRng(1), focusBias: { Passing: 1 } });
  near(r.realized, p.baseOverallRaw - before, 1e-9);
  assert.ok(r.realized > 1.9 && r.realized <= 2 + 1e-9);
  assert.equal(p.rating, Math.round(p.baseOverallRaw));
  assert.ok(p.development.academyBudgetUsed > 1.9);
  const big = applyAcademyGrowth(p, 50, { rng: createRng(2) });
  assert.ok(big.realized <= 3 + 1e-9);
  assert.equal(big.limitedBy, "annual-cap");
});

test("forecast: cached by signature, does not touch career rng", () => {
  const p = makePlayer("ST", 62, 17, "fc");
  const career = createRng(77);
  const before = career.seed();
  const f1 = getOrUpdateForecast(p, { rng: career });
  assert.equal(career.seed(), before, "career rng must not advance");
  const f2 = getOrUpdateForecast(p, { rng: career });
  assert.equal(f1, f2, "cache hit returns the same object");
  assert.equal(p.potential, f1.potentialCache);
  assert.ok(p.potential >= p.rating && p.potential <= 99);
  p.age = 18;
  const f3 = getOrUpdateForecast(p, { rng: career });
  assert.notEqual(f3.inputSignature, f1.inputSignature);
});

test("migration: idempotent, backs up legacy, GK proxy, no invented injuries", () => {
  const legacy = {
    name: "Old Timer", position: "RW", age: 21, rating: 70, potential: 82, nationality: "X",
    attributes: { Speed: 75, Passing: 68, Shooting: 70, Defending: 50, Physicality: 60, Dribbling: 77 },
    contractEndSeason: 2030, careerHonors: { leagueTitles: 2 },
  };
  const trophies = JSON.stringify(legacy.careerHonors);
  const res = migratePlayerToV2(legacy, { careerId: "save-1" });
  assert.equal(res.migrated, true);
  assert.equal(legacy.playerModelVersion, 2);
  assert.equal(legacy.development.legacy.rating, 70);
  assert.equal(legacy.development.legacy.potential, 82);
  assert.equal(legacy.health.activeInjury, null);
  assert.equal(legacy.health.injuryHistory.length, 0);
  assert.equal(legacy.contractEndSeason, 2030);
  assert.equal(JSON.stringify(legacy.careerHonors), trophies);
  assert.equal(legacy.rating, Math.round(calculateOverall(legacy.attributes, "RW").raw));
  const snap = JSON.stringify(legacy);
  assert.equal(migratePlayerToV2(legacy, { careerId: "save-1" }).migrated, false);
  assert.equal(ensurePlayerModel(legacy), legacy);
  assert.equal(JSON.stringify(legacy), snap);
  // Deterministic from careerId.
  const clone = {
    name: "Old Timer", position: "RW", age: 21, rating: 70, potential: 82, nationality: "X",
    attributes: { Speed: 75, Passing: 68, Shooting: 70, Defending: 50, Physicality: 60, Dribbling: 77 },
  };
  migratePlayerToV2(clone, { careerId: "save-1" });
  assert.deepEqual(clone.development.traits, legacy.development.traits);
  assert.equal(clone.development.latentBudget, legacy.development.latentBudget);
  // Legacy GK with outfield attrs gets a GK proxy near the legacy rating.
  const gk = {
    name: "Keeper", position: "GK", age: 24, rating: 72, potential: 80,
    attributes: { Speed: 60, Passing: 68, Shooting: 54, Defending: 78, Physicality: 76, Dribbling: 64 },
  };
  migratePlayerToV2(gk, { careerId: "save-1" });
  assert.ok(validateAttributes(gk.attributes, "GK").ok);
  assert.equal(gk.development.migration.gkProxy, true);
  assert.ok(Math.abs(gk.baseOverallRaw - 72) < 0.5);
  // Players without attributes are left alone.
  const blank = { name: "Intro", position: "ST", rating: 0, potential: 0, attributes: null };
  assert.equal(ensurePlayerModel(blank), blank);
  assert.equal(blank.development, undefined);
});

test("module sources do not use Math.random", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const url = await import("node:url");
  const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
  const files = [
    "js/config/playerDevelopmentConfig.js",
    "js/simulation/playerAbility.js",
    "js/simulation/playerState.js",
    "js/simulation/playerHealth.js",
    "js/simulation/playerSeasonLedger.js",
    "js/simulation/playerDevelopmentModel.js",
    "js/simulation/playerPotential.js",
    "js/simulation/playerModelMigration.js",
  ];
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    assert.ok(!/Math\.random\s*\(/.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), `${f} uses Math.random`);
  }
});
