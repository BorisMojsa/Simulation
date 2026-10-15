/**
 * player-development-v3 acceptance fixtures.
 * Run: node tests/playerProgressionV3.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRng, createStreamRng, hashSeed } from "../js/simulation/rng.js";
import {
  developSeason,
  initializePlayerDevelopment,
  generateStartingAttributes,
} from "../js/simulation/playerDevelopmentModel.js";
import { calculateOverall, refreshAbilityCaches } from "../js/simulation/playerAbility.js";
import {
  DEVELOPMENT_MODEL_VERSION,
  PLAYER_MODEL_VERSION,
  DEVELOPMENT_CAPS,
} from "../js/config/playerDevelopmentConfig.js";
import { ensurePlayerModel } from "../js/simulation/playerModelMigration.js";
import { evaluateSeasonAwards, awardRecordsToLegacyNames } from "../js/simulation/individualAwards.js";
import { buildSeasonEvidence, estimateHealthyTrainingFraction } from "../js/simulation/seasonEvidence.js";
import { createEmptyLedger, recordMatchObservation, aggregateSeason } from "../js/simulation/playerSeasonLedger.js";

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

function mkPlayer({
  careerId = "v3",
  position = "ST",
  age = 18,
  target = 70,
  seed = "v3-init",
  attributes = null,
} = {}) {
  const rng = createStreamRng(seed, "init");
  const attrs = attributes || generateStartingAttributes(position, target, 99, rng);
  const player = {
    name: `P-${careerId}`,
    nationality: "Testland",
    position,
    age,
    careerId,
    attributes: attrs,
    rating: target,
    seasons: [],
    careerTotals: { matches: 0, goals: 0, assists: 0, cleanSheets: 0 },
  };
  initializePlayerDevelopment(player, { rng, careerId });
  return player;
}

function developOnce(player, ctx) {
  const before = player.baseOverallRaw;
  const result = developSeason(player, {
    elapsedYears: 1,
    usefulMinutes: 2700,
    healthyTrainingFraction: 1,
    reliability: 0.8,
    P_long: 0,
    environmentMultiplier: 1.2,
    rng: createRng(hashSeed(`${player.careerId}:${ctx.seasonId || "s"}`)),
    seasonId: ctx.seasonId || `s-${player.careerId}`,
    alreadyAppliedLearningGain: 0,
    ...ctx,
  });
  return { before, after: player.baseOverallRaw, delta: player.baseOverallRaw - before, result };
}

test("model version is player-development-v3", () => {
  assert.equal(PLAYER_MODEL_VERSION, 3);
  assert.equal(DEVELOPMENT_MODEL_VERSION, "player-development-v3");
  assert.ok(DEVELOPMENT_CAPS.annualLearningCap >= 7);
});

test("signed performance and confidence: poor < neutral < good", () => {
  const deltas = { poor: [], neutral: [], good: [] };
  for (let i = 0; i < 24; i++) {
    for (const [label, pLong] of [
      ["poor", -0.8],
      ["neutral", 0],
      ["good", 0.8],
    ]) {
      const p = mkPlayer({ careerId: `perf-${label}-${i}`, seed: `perf-${label}-${i}`, age: 19, target: 72 });
      const { delta } = developOnce(p, {
        seasonId: `perf-${label}-${i}`,
        P_long: pLong,
        reliability: 0.85,
        reliableSignal: pLong * 0.85, // legacy field must not invert the ordering
      });
      deltas[label].push(delta);
    }
  }
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const poor = mean(deltas.poor);
  const neutral = mean(deltas.neutral);
  const good = mean(deltas.good);
  assert.ok(poor < neutral, `poor ${poor} should be < neutral ${neutral}`);
  assert.ok(neutral < good, `neutral ${neutral} should be < good ${good}`);
  assert.ok(good - poor > 0.6, `good-poor gap ${good - poor} too small`);
  // A clearly poor full season must not look like ordinary development.
  assert.ok(poor <= 0.35, `poor mean ${poor} should be ~0 or negative, not a free +1.5`);
});

test("negative performance is not clamped to neutral via reliableSignal", () => {
  const poor = mkPlayer({ careerId: "neg-poor", seed: "neg-poor", age: 22, target: 70 });
  const neutral = mkPlayer({ careerId: "neg-neu", seed: "neg-neu", age: 22, target: 70 });
  // Copy attributes so starting ability matches.
  neutral.attributes = { ...poor.attributes };
  refreshAbilityCaches(neutral);
  refreshAbilityCaches(poor);
  const dPoor = developOnce(poor, {
    seasonId: "neg-poor",
    P_long: -0.7,
    reliability: 0.8,
    reliableSignal: -0.56,
    rng: createRng(5678),
  }).delta;
  const dNeu = developOnce(neutral, {
    seasonId: "neg-neu",
    P_long: 0,
    reliability: 0.8,
    reliableSignal: 0,
    rng: createRng(5678),
  }).delta;
  assert.ok(dPoor < dNeu - 0.15, `poor ${dPoor} should be materially below neutral ${dNeu}`);
});

test("no inherited ceiling: archived budgets do not constrain growth", () => {
  const low = mkPlayer({ careerId: "ceil-low", seed: "ceil-same", age: 18, target: 70 });
  const high = mkPlayer({ careerId: "ceil-high", seed: "ceil-same", age: 18, target: 70 });
  // Force identical attributes.
  high.attributes = { ...low.attributes };
  refreshAbilityCaches(low);
  refreshAbilityCaches(high);
  // Archive different inert budgets / ceilings — must not affect outcomes.
  low.development.legacyArchive = {
    latentAbilityBudget: 72,
    attributeCeilings: Object.fromEntries(Object.keys(low.attributes).map((k) => [k, low.attributes[k] + 0.5])),
  };
  low.development.latentAbilityBudget = 72;
  low.development.latentBudget = 72;
  low.development.ceilings = low.development.legacyArchive.attributeCeilings;
  low.development.attributeCeilings = low.development.legacyArchive.attributeCeilings;
  high.development.latentAbilityBudget = 99;
  high.development.latentBudget = 99;

  const dLow = developOnce(low, {
    seasonId: "ceil-low",
    P_long: 0.7,
    reliability: 0.9,
    rng: createRng(42),
  }).delta;
  const dHigh = developOnce(high, {
    seasonId: "ceil-high",
    P_long: 0.7,
    reliability: 0.9,
    rng: createRng(42),
  }).delta;
  assert.ok(Math.abs(dLow - dHigh) < 0.05, `deltas diverge under archived ceilings: ${dLow} vs ${dHigh}`);
  assert.ok(low.baseOverallRaw > 72, `migrated low-ceiling player stuck at ${low.baseOverallRaw}`);
});

test("earned exceptional season can reach +6 raw under shared annual allowance", () => {
  const p = mkPlayer({ careerId: "bt-exc", seed: "bt-exc", age: 19, target: 68 });
  const { delta, result } = developOnce(p, {
    seasonId: "bt-exc",
    P_long: 0.95,
    reliability: 0.95,
    usefulMinutes: 3200,
    healthyTrainingFraction: 1,
    environmentMultiplier: 1.35,
    recognition: {
      contribution: 1.2,
      awards: [{ awardId: "player-of-the-season", status: "won" }],
      trophies: [{ kind: "league", participationWeight: 0.9 }],
    },
    forceBreakthrough: true,
    rng: createRng(99),
  });
  assert.ok(delta >= 5.5, `exceptional delta ${delta} below +6 band`);
  assert.ok(delta <= DEVELOPMENT_CAPS.annualLearningCap + 0.01, `delta ${delta} exceeds annual allowance`);
  assert.ok(result.breakthrough?.occurred || delta >= 6, "breakthrough or +6 required");
});

test("healthy training fraction uses season exposure, not only final injury flag", () => {
  const fraction = estimateHealthyTrainingFraction({
    health: {
      activeInjury: {
        startDay: 300,
        expectedReturnDay: 320,
        durationDays: 20,
      },
      injuryHistory: [
        { startDay: 40, expectedReturnDay: 70, recoveredDay: 70, durationDays: 30 },
      ],
    },
    seasonStartDay: 1,
    seasonEndDay: 300,
    seasonDays: 300,
  });
  // ~30 injured days in a 300-day season → healthy ≈ 0.9, not 0.35 from active flag alone
  assert.ok(fraction > 0.75 && fraction < 0.95, `fraction ${fraction}`);
});

test("Golden Boot goes to actual top scorer regardless of OVR", () => {
  const player = mkPlayer({ careerId: "gb-low", seed: "gb-low", age: 22, target: 62, position: "ST" });
  player.rating = 62;
  const evidence = {
    seasonId: "gb-1",
    byCompetitionType: {
      league: { goals: 28, appearances: 36, minutes: 3100, assists: 4, cleanSheets: 0 },
    },
    goals: 28,
    assists: 4,
    cleanSheets: 0,
    appearances: 36,
    minutes: 3100,
    starts: 36,
    ratedMinutes: 3100,
    seasonP: 0.7,
    reliability: 0.9,
    minutesWeightedRating: 7.8,
    position: "ST",
    seasonStartAge: 21,
  };
  const rivals = {
    leagueScorers: [
      { playerId: "npc-1", name: "Rival A", goals: 22, appearances: 34 },
      { playerId: "npc-2", name: "Rival B", goals: 19, appearances: 33 },
    ],
    leagueKeepers: [],
    leagueCandidates: [],
  };
  const result = evaluateSeasonAwards({
    player,
    evidence,
    rivals,
    league: { name: "Test League", displayName: "Test League", tier: 4 },
    rng: createRng(1),
    seasonId: "gb-1",
  });
  const boot = result.records.find((r) => r.awardId === "golden-boot" && r.status === "won");
  assert.ok(boot, "low-OVR top scorer should win Golden Boot");
  const names = awardRecordsToLegacyNames(result.records);
  assert.ok(names.includes("Golden Boot"));
});

test("high-OVR non-leader does not win Golden Boot", () => {
  const player = mkPlayer({ careerId: "gb-high", seed: "gb-high", age: 26, target: 88, position: "ST" });
  player.rating = 88;
  const evidence = {
    seasonId: "gb-2",
    byCompetitionType: {
      league: { goals: 12, appearances: 30, minutes: 2500, assists: 8, cleanSheets: 0 },
      cup: { goals: 20, appearances: 8, minutes: 700, assists: 1, cleanSheets: 0 },
    },
    goals: 32,
    assists: 9,
    appearances: 38,
    minutes: 3200,
    starts: 36,
    ratedMinutes: 3200,
    seasonP: 0.6,
    reliability: 0.9,
    minutesWeightedRating: 7.5,
    position: "ST",
    seasonStartAge: 25,
  };
  const rivals = {
    leagueScorers: [{ playerId: "npc-top", name: "True Leader", goals: 24, appearances: 36 }],
    leagueKeepers: [],
    leagueCandidates: [],
  };
  const result = evaluateSeasonAwards({
    player,
    evidence,
    rivals,
    league: { name: "Test League", displayName: "Test League", tier: 4 },
    rng: createRng(2),
    seasonId: "gb-2",
  });
  const boot = result.records.find((r) => r.awardId === "golden-boot" && r.status === "won");
  assert.equal(boot, undefined, "cup goals must not win league Golden Boot for a non-leader");
});

test("individualAwards.js contains no Math.random", () => {
  const src = readFileSync(new URL("../js/simulation/individualAwards.js", import.meta.url), "utf8");
  assert.equal(/\bMath\.random\b/.test(src), false);
});

test("migration preserves ability and deactivates ceilings", () => {
  const p = mkPlayer({ careerId: "mig-1", seed: "mig-1", age: 20, target: 74 });
  const before = p.baseOverallRaw;
  const attrsBefore = { ...p.attributes };
  // Simulate a v2-shaped archive still present.
  p.playerModelVersion = 2;
  p.development.modelVersion = "player-development-v2";
  p.development.migration = { version: 2, fromVersion: 1 };
  p.development.latentAbilityBudget = 76;
  p.development.ceilings = Object.fromEntries(Object.keys(p.attributes).map((k) => [k, 77]));
  ensurePlayerModel(p);
  assert.equal(p.playerModelVersion, 3);
  assert.equal(p.development.modelVersion, DEVELOPMENT_MODEL_VERSION);
  assert.ok(Math.abs(p.baseOverallRaw - before) < 1e-6);
  for (const k of Object.keys(attrsBefore)) {
    assert.equal(p.attributes[k], attrsBefore[k]);
  }
  // Active growth must be able to exceed old ceiling.
  developOnce(p, { seasonId: "mig-grow", P_long: 0.8, reliability: 0.9, rng: createRng(3) });
  assert.ok(p.baseOverallRaw > 77, `still capped near old ceiling at ${p.baseOverallRaw}`);
});

test("buildSeasonEvidence separates confidence from signed performance", () => {
  const ledger = createEmptyLedger("ev-1");
  for (let i = 0; i < 20; i++) {
    recordMatchObservation(ledger, {
      matchId: `m${i}`,
      competitionType: "league",
      minutes: 90,
      started: true,
      goals: i < 5 ? 1 : 0,
      assists: 0,
      rating: 5.5,
      expectedRating: 6.6,
      position: "ST",
    });
  }
  const agg = aggregateSeason(ledger);
  const player = mkPlayer({ careerId: "ev-p", seed: "ev-p" });
  const evidence = buildSeasonEvidence(player, {
    aggregate: agg,
    ledger,
    league: { name: "L", tier: 3, overall: 72 },
    seasonId: "ev-1",
    seasonStartAge: 18,
  });
  assert.ok(evidence.seasonP != null && evidence.seasonP < 0, `seasonP ${evidence.seasonP}`);
  assert.ok(evidence.reliability > 0.5 && evidence.reliability <= 1);
  assert.ok(evidence.reliability !== evidence.seasonP);
});

console.log("\nDone.");
