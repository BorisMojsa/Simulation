/**
 * Seeded calibration for player-development-v2.
 *
 * Usage:
 *   node scripts/calibratePlayerDevelopment.mjs
 *   node scripts/calibratePlayerDevelopment.mjs --light   # smaller cohorts
 *
 * Writes reports/player-development-calibration.json and .md
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { createRng, hashSeed } from "../js/simulation/rng.js";
import {
  developSeason,
  initializePlayerDevelopment,
  sampleLatentBudget,
  generateStartingAttributes,
} from "../js/simulation/playerDevelopmentModel.js";
import { calculateOverall, refreshAbilityCaches } from "../js/simulation/playerAbility.js";
import { DEVELOPMENT_MODEL_VERSION, PLAYER_MODEL_VERSION } from "../js/config/playerDevelopmentConfig.js";
import { createPlayerIdentity, finalizeAcademyPlayer } from "../js/simulation/playerDevelopment.js";
import { ACADEMY_POOL, LEAGUES, LEAGUE_LOOKUP } from "../js/data/leagues.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import { createWorldState, setWorldState } from "../js/simulation/worldState.js";
import { reseedCareerRng } from "../js/simulation/rng.js";
import { getOrUpdateForecast } from "../js/simulation/playerPotential.js";

function gitRevision() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function configHash() {
  const raw = readFileSync(new URL("../js/config/playerDevelopmentConfig.js", import.meta.url));
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

const light = process.argv.includes("--light");
const LIGHT_TRAJ = light ? 800 : 10000;
const LIGHT_CAREERS = light ? 80 : 2000;
const HOLD_TRAJ = light ? 400 : 5000;
const CONTROLLED_N = 200;

const POSITIONS = ["GK", "CB", "CM", "RW", "ST", "CAM", "CDM", "LB"];

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (1 - (idx - lo)) + sorted[hi] * (idx - lo);
}

function summarize(values) {
  const s = [...values].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1);
  return {
    n: s.length,
    mean: Number(mean.toFixed(3)),
    median: Number(percentile(s, 0.5)?.toFixed(3)),
    p10: Number(percentile(s, 0.1)?.toFixed(3)),
    p90: Number(percentile(s, 0.9)?.toFixed(3)),
    p95: Number(percentile(s, 0.95)?.toFixed(3)),
    p99: Number(percentile(s, 0.99)?.toFixed(3)),
  };
}

function runTrajectory(seed, opts = {}) {
  const rng = createRng(seed);
  const pos = opts.position || POSITIONS[rng.int(0, POSITIONS.length - 1)];
  const age0 = opts.age0 ?? rng.int(16, 22);
  let budget = opts.budget ?? sampleLatentBudget(rng);
  const target = opts.target ?? rng.float(58, Math.min(72, budget - 2));
  const attrs = generateStartingAttributes(pos, target, budget, rng);
  const player = {
    name: `T${seed}`,
    nationality: "Calibration",
    position: pos,
    age: age0,
    careerId: `traj-${seed}`,
    attributes: attrs,
    rating: target,
  };
  initializePlayerDevelopment(player, { rng, careerId: player.careerId });
  if (opts.forceBudget != null) {
    player.development.latentAbilityBudget = opts.forceBudget;
    player.development.abilityBudgetsByPosition = { [pos]: opts.forceBudget };
  }

  const history = [];
  let peak = player.baseOverallRaw;
  let first85 = null;
  let first90 = null;
  let first95 = null;
  let first99 = null;

  let peakAge = age0;
  let stagnantYears = 0;
  let maxStagnant = 0;
  let earlyDecline = false;
  let comeback = false;
  let postPeakLow = null;

  for (let y = 0; y < opts.years || 20; y++) {
    if (player.age >= 40) break;
    const before = player.baseOverallRaw;
    const minutes = opts.minutes ?? rng.float(800, 3000);
    const signal = opts.signal ?? rng.float(-0.5, 0.6);
    developSeason(player, {
      elapsedYears: 1,
      usefulMinutes: minutes,
      healthyTrainingFraction: opts.training ?? rng.float(0.5, 1),
      reliableSignal: signal,
      P_long: minutes >= 900 ? signal : null,
      reliability: minutes / (minutes + 900),
      environmentMultiplier: opts.env ?? rng.float(0.7, 1.25),
      rng: rng.fork(`y${y}`),
      seasonId: `t-${seed}-${y}`,
      alreadyAppliedLearningGain: 0,
      longFormReliable: minutes >= 900,
    });
    player.age += 1;
    const after = player.baseOverallRaw;
    const delta = after - before;
    if (after > peak + 1e-9) {
      peak = after;
      peakAge = player.age;
      if (postPeakLow != null && after > postPeakLow + 1.5) comeback = true;
      postPeakLow = null;
    } else if (after < peak - 0.5) {
      postPeakLow = postPeakLow == null ? after : Math.min(postPeakLow, after);
      if (player.age <= 25 && (peak - after >= 1.25 || delta <= -1.25)) earlyDecline = true;
    }
    if (postPeakLow != null && after >= postPeakLow + 1.0 && after < peak - 0.25) {
      comeback = true;
    }
    if (Math.abs(delta) < 0.35) {
      stagnantYears += 1;
      maxStagnant = Math.max(maxStagnant, stagnantYears);
    } else {
      stagnantYears = 0;
    }
    if (after >= 85 && first85 == null) first85 = player.age;
    if (after >= 90 && first90 == null) first90 = player.age;
    if (after >= 95 && first95 == null) first95 = player.age;
    if (after >= 99 && first99 == null) first99 = player.age;
    history.push({
      age: player.age,
      base: after,
      delta,
      breakthrough: false,
    });
  }
  let forecastCoverage = null;
  try {
    const fc = getOrUpdateForecast(player, { sampleCount: 24 });
    forecastCoverage = {
      potential: fc.potentialCache ?? fc.potential ?? null,
      bandLow: fc.bandLow ?? fc.p10 ?? null,
      bandHigh: fc.bandHigh ?? fc.p90 ?? null,
      hasForecast: Boolean(fc),
    };
  } catch {
    forecastCoverage = { hasForecast: false };
  }
  return {
    position: pos,
    age0,
    peak,
    peakAge,
    final: player.baseOverallRaw,
    first85,
    first90,
    first95,
    first99,
    history,
    ever99: peak >= 98.5,
    budget: player.development.latentAbilityBudget,
    earlyDecline,
    maxStagnantStreak: maxStagnant,
    comeback,
    forecastCoverage,
  };
}

/** Supported exceptional path: elite budget can still hit 90 by age 20. */
function runExceptionalFixture(seedBase) {
  const rng = createRng(hashSeed(`${seedBase}:exceptional-fixture`));
  const budget = 99;
  const attrs = generateStartingAttributes("ST", 80, budget, rng);
  const player = {
    name: "ExceptionalFixture",
    nationality: "Brazil",
    position: "ST",
    age: 16,
    careerId: "calib-exceptional-20",
    attributes: attrs,
    rating: 80,
  };
  initializePlayerDevelopment(player, { rng, careerId: player.careerId, budget });
  player.development.latentAbilityBudget = 99;
  player.development.abilityBudgetsByPosition = {
    ST: { budget: 99, startOverallRaw: player.baseOverallRaw, used: 0, primary: true },
  };
  player.development.traits.trainability = 1.3;
  for (let y = 0; y < 4; y++) {
    developSeason(player, {
      elapsedYears: 1,
      usefulMinutes: 3000,
      healthyTrainingFraction: 1,
      reliableSignal: 0.95,
      P_long: 0.95,
      reliability: 0.9,
      environmentMultiplier: 1.4,
      rng: rng.fork(`ex-${y}`),
      seasonId: `ex-calib-${y}`,
      alreadyAppliedLearningGain: 0,
      longFormReliable: true,
    });
    player.age += 1;
  }
  refreshAbilityCaches(player);
  const fc = getOrUpdateForecast(player, { sampleCount: 32 });
  return {
    age: player.age,
    baseOverallRaw: player.baseOverallRaw,
    rating: player.rating,
    worldClassAt20: player.age === 20 && player.baseOverallRaw >= 90,
    forecastPotential: fc.potentialCache ?? null,
  };
}

function runControlledArsenalRw(n, seedBase) {
  const results = [];
  for (let i = 0; i < n; i++) {
    const rng = createRng(hashSeed(`${seedBase}:ctrl:${i}`));
    const attrs = generateStartingAttributes("RW", 70, 82, rng);
    // Nudge to ~70 base
    let o = calculateOverall(attrs, "RW").raw;
    const keys = Object.keys(attrs);
    for (let k = 0; k < 6 && Math.abs(o - 70) > 0.4; k++) {
      const corr = 70 - o;
      for (const key of keys) attrs[key] = Math.max(1, Math.min(99, attrs[key] + corr));
      o = calculateOverall(attrs, "RW").raw;
    }
    const player = {
      name: "Ctrl RW",
      nationality: "United States",
      position: "RW",
      age: 17,
      careerId: `ctrl-rw-${i}`,
      attributes: attrs,
      rating: 70,
    };
    initializePlayerDevelopment(player, { rng, careerId: player.careerId });
    player.development.latentAbilityBudget = Math.min(82, player.development.latentAbilityBudget);
    player.development.abilityBudgetsByPosition = { RW: player.development.latentAbilityBudget };
    const at = { 22: null, 25: null };
    for (let y = 0; y < 12; y++) {
      developSeason(player, {
        elapsedYears: 1,
        usefulMinutes: 2200,
        healthyTrainingFraction: 0.95,
        reliableSignal: 0.35,
        P_long: 0.35,
        reliability: 0.7,
        environmentMultiplier: 1.15,
        rng: rng.fork(`y${y}`),
        seasonId: `ctrl-${i}-${y}`,
        alreadyAppliedLearningGain: 0,
        longFormReliable: true,
      });
      player.age += 1;
      if (player.age === 22) at[22] = player.baseOverallRaw;
      if (player.age === 25) at[25] = player.baseOverallRaw;
    }
    results.push({
      at22: at[22],
      at25: at[25],
      peak: Math.max(at[22] || 0, at[25] || 0, player.baseOverallRaw),
      final: player.baseOverallRaw,
      hit90by22: (at[22] || 0) >= 90,
      hit99by25: (at[25] || 0) >= 99,
    });
  }
  return results;
}

function runIntegratedCareers(n, seedBase) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const seed = hashSeed(`${seedBase}:career:${i}`);
    reseedCareerRng(seed);
    const pos = POSITIONS[i % POSITIONS.length];
    const player = createPlayerIdentity({
      name: `Career${i}`,
      nationality: i % 3 === 0 ? "England" : i % 3 === 1 ? "Spain" : "Germany",
      position: pos === "GK" ? "GK" : pos,
      age: 16 + (i % 3),
    });
    player.careerId = `int-${seed}`;
    const academy = ACADEMY_POOL[i % ACADEMY_POOL.length];
    finalizeAcademyPlayer(player, academy);
    // Promote if academy
    if (player.club?.parentClub) {
      const parent = player.club.parentClub;
      player.club = { ...parent, isAcademy: false, parentClub: null };
    } else {
      player.club.isAcademy = false;
    }
    setWorldState(createWorldState(player));
    const ageSeries = [];
    try {
      for (let s = 0; s < 8 && player.age < 38; s++) {
        simulateSeason(player, LEAGUES, LEAGUE_LOOKUP);
        ageSeries.push({
          age: player.age,
          base: player.baseOverallRaw,
          current: player.currentOverall,
          minutes: player.seasons[player.seasons.length - 1]?.minutes ?? 0,
          apps: player.seasons[player.seasons.length - 1]?.matches ?? 0,
        });
      }
    } catch (e) {
      out.push({ error: String(e.message || e), seed });
      continue;
    }
    out.push({
      position: pos,
      peak: Math.max(...ageSeries.map((x) => x.base)),
      series: ageSeries,
      ever99: ageSeries.some((x) => x.base >= 98.5),
      injuries: player.health?.injuryHistory?.length || 0,
    });
  }
  return out;
}

function main() {
  const started = Date.now();
  const revision = gitRevision();
  const cfgHash = configHash();
  const calibSeed = hashSeed("player-development-v2-calibration-A");
  const holdSeed = hashSeed("player-development-v2-holdout-B");

  const traj = [];
  for (let i = 0; i < LIGHT_TRAJ; i++) {
    traj.push(runTrajectory(hashSeed(`${calibSeed}:traj:${i}`)));
  }
  const hold = [];
  for (let i = 0; i < HOLD_TRAJ; i++) {
    hold.push(runTrajectory(hashSeed(`${holdSeed}:traj:${i}`)));
  }

  const controlled = runControlledArsenalRw(CONTROLLED_N, calibSeed);
  const careers = runIntegratedCareers(LIGHT_CAREERS, calibSeed);
  const exceptional = runExceptionalFixture(calibSeed);

  const peaks = traj.map((t) => t.peak);
  const deltasYoung = traj.flatMap((t) =>
    t.history.filter((h) => h.age <= 20).map((h) => h.delta)
  );
  const at22 = traj.map((t) => t.history.find((h) => h.age === 22)?.base).filter((x) => x != null);
  const ever99Rate = traj.filter((t) => t.ever99).length / traj.length;
  const at99by22 = traj.filter((t) => t.first99 != null && t.first99 <= 22).length / traj.length;
  const attain90 = traj.filter((t) => t.first90 != null).length / traj.length;
  const attain95 = traj.filter((t) => t.first95 != null).length / traj.length;
  const earlyDeclineRate = traj.filter((t) => t.earlyDecline).length / traj.length;
  const comebackRate = traj.filter((t) => t.comeback).length / traj.length;
  const stagnant3Rate = traj.filter((t) => t.maxStagnantStreak >= 3).length / traj.length;
  const forecastOk = traj.filter((t) => t.forecastCoverage?.hasForecast).length / traj.length;

  const ctrlHit90 = controlled.filter((c) => c.hit90by22).length;
  const ctrlHit99 = controlled.filter((c) => c.hit99by25).length;
  const careerOk = careers.filter((c) => !c.error);
  const careerErr = careers.filter((c) => c.error);

  const report = {
    modelVersion: DEVELOPMENT_MODEL_VERSION,
    playerModelVersion: PLAYER_MODEL_VERSION,
    revision,
    configHash: cfgHash,
    generatedAt: new Date().toISOString(),
    light,
    runtimeMs: Date.now() - started,
    cohorts: {
      trajectories: LIGHT_TRAJ,
      holdoutTrajectories: HOLD_TRAJ,
      integratedCareers: LIGHT_CAREERS,
      controlledArsenalRw: CONTROLLED_N,
    },
    ordinaryTrajectories: {
      peak: summarize(peaks),
      peakAge: summarize(traj.map((t) => t.peakAge)),
      youngDeltas: summarize(deltasYoung),
      abilityAt22: summarize(at22),
      ever99Rate,
      at99by22Rate: at99by22,
      attain90Rate: attain90,
      attain95Rate: attain95,
      first90Ages: summarize(traj.map((t) => t.first90).filter((x) => x != null)),
      first95Ages: summarize(traj.map((t) => t.first95).filter((x) => x != null)),
      earlyDeclineRate,
      stagnation3yrRate: stagnant3Rate,
      comebackRate,
      forecastCoverageRate: forecastOk,
    },
    holdout: {
      peak: summarize(hold.map((t) => t.peak)),
      peakAge: summarize(hold.map((t) => t.peakAge)),
      ever99Rate: hold.filter((t) => t.ever99).length / hold.length,
      attain90Rate: hold.filter((t) => t.first90 != null).length / hold.length,
      earlyDeclineRate: hold.filter((t) => t.earlyDecline).length / hold.length,
      comebackRate: hold.filter((t) => t.comeback).length / hold.length,
    },
    controlledScenario: {
      description:
        "Age 17, ~70 base, budget≤82, RW, US — must not routinely reach 90 by 22 / 99 by 25",
      hit90by22: ctrlHit90,
      hit99by25: ctrlHit99,
      n: CONTROLLED_N,
      meanAt22: summarize(controlled.map((c) => c.at22).filter(Boolean)),
      meanAt25: summarize(controlled.map((c) => c.at25).filter(Boolean)),
    },
    exceptionalFixture: exceptional,
    integratedCareers: {
      completed: careerOk.length,
      errors: careerErr.length,
      sampleErrors: careerErr.slice(0, 5),
      ever99Rate: careerOk.length ? careerOk.filter((c) => c.ever99).length / careerOk.length : null,
      peak: summarize(careerOk.map((c) => c.peak)),
      meanInjuries: careerOk.length
        ? careerOk.reduce((s, c) => s + c.injuries, 0) / careerOk.length
        : null,
    },
    targetsNote:
      "Design targets from the implementation prompt; these results are measured, not forced by clipping. Chronological season orchestrator is active for integrated careers.",
  };

  mkdirSync("reports", { recursive: true });
  writeFileSync("reports/player-development-calibration.json", JSON.stringify(report, null, 2));

  const md = `# Player development calibration

Model: **${report.modelVersion}** · revision \`${revision}\` · configHash \`${cfgHash}\` · light=${light} · runtime ${report.runtimeMs}ms

## Ordinary trajectories (n=${LIGHT_TRAJ})

| Metric | Value |
| --- | --- |
| Peak mean / median | ${report.ordinaryTrajectories.peak.mean} / ${report.ordinaryTrajectories.peak.median} |
| Peak age mean / median | ${report.ordinaryTrajectories.peakAge.mean} / ${report.ordinaryTrajectories.peakAge.median} |
| Young Δ mean | ${report.ordinaryTrajectories.youngDeltas.mean} |
| Attain 90 / 95 | ${(attain90 * 100).toFixed(2)}% / ${(attain95 * 100).toFixed(2)}% |
| Ever 99 rate | ${(ever99Rate * 100).toFixed(3)}% |
| 99 by 22 rate | ${(at99by22 * 100).toFixed(3)}% |
| Early decline / stagnation≥3 / comeback | ${(earlyDeclineRate * 100).toFixed(2)}% / ${(stagnant3Rate * 100).toFixed(2)}% / ${(comebackRate * 100).toFixed(2)}% |
| Forecast coverage | ${(forecastOk * 100).toFixed(1)}% |

## Controlled Arsenal RW (n=${CONTROLLED_N})

| Metric | Count |
| --- | --- |
| Hit 90 by 22 | ${ctrlHit90} |
| Hit 99 by 25 | ${ctrlHit99} |
| Mean OVR@22 | ${report.controlledScenario.meanAt22.mean} |
| Mean OVR@25 | ${report.controlledScenario.meanAt25.mean} |

## Exceptional fixture (supported)

Age ${exceptional.age} · base ${exceptional.baseOverallRaw?.toFixed?.(2) ?? exceptional.baseOverallRaw} · worldClassAt20=${exceptional.worldClassAt20} · forecast=${exceptional.forecastPotential}

## Integrated careers (n=${LIGHT_CAREERS})

Completed: ${careerOk.length} · Errors: ${careerErr.length} · Ever99: ${report.integratedCareers.ever99Rate}

## Holdout (n=${HOLD_TRAJ})

Ever99: ${report.holdout.ever99Rate} · Attain90: ${report.holdout.attain90Rate} · Early decline: ${report.holdout.earlyDeclineRate} · Comeback: ${report.holdout.comebackRate}
`;

  writeFileSync("reports/player-development-calibration.md", md);
  console.log(md);
  console.log("Wrote reports/player-development-calibration.json");
}

main();
