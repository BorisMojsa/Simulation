/**
 * Seeded calibration for player-development-v3.
 *
 * Usage:
 *   node scripts/calibratePlayerDevelopment.mjs
 *   node scripts/calibratePlayerDevelopment.mjs --light   # smaller cohorts
 *
 * Writes reports/player-development-v3-calibration.json and .md
 * (also mirrors to player-development-calibration.* for continuity).
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

  const years = opts.years ?? 20;
  let lastBreakthrough = false;
  for (let y = 0; y < years; y++) {
    if (player.age >= 40) break;
    const before = player.baseOverallRaw;
    const minutes = opts.minutes ?? rng.float(800, 3000);
    const signal = opts.signal ?? rng.float(-0.5, 0.6);
    const reliability = clamp01(minutes / (minutes + 900));
    const result = developSeason(player, {
      elapsedYears: 1,
      usefulMinutes: minutes,
      healthyTrainingFraction: opts.training ?? rng.float(0.5, 1),
      reliableSignal: signal * reliability,
      P_long: minutes >= 900 ? signal : 0,
      reliability,
      environmentMultiplier: opts.env ?? rng.float(0.7, 1.25),
      recognition: opts.recognition,
      rng: rng.fork(`y${y}`),
      seasonId: `t-${seed}-${y}`,
      alreadyAppliedLearningGain: 0,
    });
    lastBreakthrough = Boolean(result?.breakthrough?.occurred);
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
      breakthrough: lastBreakthrough,
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
    breakthroughCount: history.filter((h) => h.breakthrough).length,
  };
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

/** Matched poor / neutral / good seasons for young mid-ability players. */
function runPerformanceCohorts(n, seedBase) {
  const bands = { poor: [], neutral: [], good: [], exceptional: [] };
  for (let i = 0; i < n; i++) {
    for (const [label, pLong, recognition] of [
      ["poor", -0.75, null],
      ["neutral", 0, null],
      ["good", 0.7, null],
      [
        "exceptional",
        0.92,
        {
          awards: [
            { awardId: "player-of-the-season", status: "won" },
            { awardId: "team-of-the-season", status: "won" },
          ],
          trophies: [{ kind: "league", participationWeight: 0.85 }],
        },
      ],
    ]) {
      const seed = hashSeed(`${seedBase}:perf:${label}:${i}`);
      const rng = createRng(seed);
      const attrs = generateStartingAttributes("ST", 72, 99, rng);
      const player = {
        name: `Perf${label}${i}`,
        nationality: "Calib",
        position: "ST",
        age: 19,
        careerId: `perf-${label}-${i}`,
        attributes: attrs,
        rating: 72,
      };
      initializePlayerDevelopment(player, { rng, careerId: player.careerId });
      const before = player.baseOverallRaw;
      const result = developSeason(player, {
        elapsedYears: 1,
        usefulMinutes: 2800,
        healthyTrainingFraction: 1,
        reliability: 0.85,
        P_long: pLong,
        environmentMultiplier: 1.25,
        recognition,
        forceBreakthrough: label === "exceptional",
        rng: rng.fork("season"),
        seasonId: `perf-${label}-${i}`,
        alreadyAppliedLearningGain: 0,
      });
      bands[label].push({
        delta: player.baseOverallRaw - before,
        breakthrough: Boolean(result?.breakthrough?.occurred),
      });
    }
  }
  const pack = (arr) => ({
    delta: summarize(arr.map((x) => x.delta)),
    breakthroughRate: arr.filter((x) => x.breakthrough).length / arr.length,
    plus6Rate: arr.filter((x) => x.delta >= 6).length / arr.length,
    plus7Rate: arr.filter((x) => x.delta >= 6.85).length / arr.length,
  });
  return {
    poor: pack(bands.poor),
    neutral: pack(bands.neutral),
    good: pack(bands.good),
    exceptional: pack(bands.exceptional),
  };
}

/** Possibility check: supported multi-season path from low start toward 99. */
function runLowStartPath(startOvr, seedBase) {
  const rng = createRng(hashSeed(`${seedBase}:lowstart:${startOvr}`));
  const attrs = generateStartingAttributes("CM", startOvr, 99, rng);
  const player = {
    name: `Low${startOvr}`,
    nationality: "Calib",
    position: "CM",
    age: 17,
    careerId: `low-${startOvr}`,
    attributes: attrs,
    rating: startOvr,
  };
  initializePlayerDevelopment(player, { rng, careerId: player.careerId });
  const history = [];
  for (let y = 0; y < 22 && player.age < 38; y++) {
    const before = player.baseOverallRaw;
    developSeason(player, {
      elapsedYears: 1,
      usefulMinutes: 3200,
      healthyTrainingFraction: 1,
      reliability: 0.95,
      P_long: 0.95,
      environmentMultiplier: 1.35,
      recognition: {
        awards: [
          { awardId: "team-of-the-season", status: "won" },
          { awardId: "player-of-the-season", status: "won" },
          ...(y % 2 === 0 ? [{ awardId: "golden-boot", status: "won" }] : []),
        ],
        trophies: [
          { kind: "league", participationWeight: 0.95 },
          { kind: "continental", participationWeight: 0.7 },
        ],
      },
      forceBreakthrough: player.baseOverallRaw < 96,
      rng: rng.fork(`y${y}`),
      seasonId: `low-${startOvr}-${y}`,
      alreadyAppliedLearningGain: 0,
    });
    player.age += 1;
    history.push({ age: player.age, base: player.baseOverallRaw, delta: player.baseOverallRaw - before });
    if (player.baseOverallRaw >= 98.5) break;
  }
  const peak = Math.max(...history.map((h) => h.base));
  return {
    startOvr,
    peak,
    displayed99: peak >= 98.5,
    ageAt99: history.find((h) => h.base >= 98.5)?.age ?? null,
    final: player.baseOverallRaw,
    seasons: history.length,
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
    const at = { 22: null, 25: null };
    for (let y = 0; y < 12; y++) {
      developSeason(player, {
        elapsedYears: 1,
        usefulMinutes: 2200,
        healthyTrainingFraction: 0.95,
        reliableSignal: 0.35 * 0.7,
        P_long: 0.35,
        reliability: 0.7,
        environmentMultiplier: 1.15,
        rng: rng.fork(`y${y}`),
        seasonId: `ctrl-${i}-${y}`,
        alreadyAppliedLearningGain: 0,
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
  const calibSeed = hashSeed("player-development-v3-calibration-A");
  const holdSeed = hashSeed("player-development-v3-holdout-B");

  const traj = [];
  for (let i = 0; i < LIGHT_TRAJ; i++) {
    traj.push(runTrajectory(hashSeed(`${calibSeed}:traj:${i}`), { years: 22 }));
  }
  const hold = [];
  for (let i = 0; i < HOLD_TRAJ; i++) {
    hold.push(runTrajectory(hashSeed(`${holdSeed}:traj:${i}`), { years: 22 }));
  }

  const controlled = runControlledArsenalRw(CONTROLLED_N, calibSeed);
  const careers = runIntegratedCareers(LIGHT_CAREERS, calibSeed);
  const exceptional = runExceptionalFixture(calibSeed);
  const perfCohorts = runPerformanceCohorts(light ? 80 : 400, calibSeed);
  const lowStartPaths = [50, 60, 70].map((ovr) => runLowStartPath(ovr, calibSeed));

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
        "Age 17, ~70 base RW, ordinary sustained signal — mixed policy reference (no latent budget cap)",
      hit90by22: ctrlHit90,
      hit99by25: ctrlHit99,
      n: CONTROLLED_N,
      meanAt22: summarize(controlled.map((c) => c.at22).filter(Boolean)),
      meanAt25: summarize(controlled.map((c) => c.at25).filter(Boolean)),
    },
    performanceCohorts: perfCohorts,
    lowStartPaths,
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
  const jsonPath = "reports/player-development-v3-calibration.json";
  const mdPath = "reports/player-development-v3-calibration.md";
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync("reports/player-development-calibration.json", JSON.stringify(report, null, 2));

  const md = `# Player development v3 calibration

Model: **${report.modelVersion}** · revision \`${revision}\` · configHash \`${cfgHash}\` · light=${light} · runtime ${report.runtimeMs}ms

## Ordinary trajectories (n=${LIGHT_TRAJ})

| Metric | Value |
| --- | --- |
| Peak mean / median | ${report.ordinaryTrajectories.peak.mean} / ${report.ordinaryTrajectories.peak.median} |
| Peak age mean / median | ${report.ordinaryTrajectories.peakAge.mean} / ${report.ordinaryTrajectories.peakAge.median} |
| Young Δ mean / p90 | ${report.ordinaryTrajectories.youngDeltas.mean} / ${report.ordinaryTrajectories.youngDeltas.p90} |
| Attain 90 / 95 | ${(attain90 * 100).toFixed(2)}% / ${(attain95 * 100).toFixed(2)}% |
| Ever 99 rate | ${(ever99Rate * 100).toFixed(3)}% |
| 99 by 22 rate | ${(at99by22 * 100).toFixed(3)}% |
| Early decline / stagnation≥3 / comeback | ${(earlyDeclineRate * 100).toFixed(2)}% / ${(stagnant3Rate * 100).toFixed(2)}% / ${(comebackRate * 100).toFixed(2)}% |
| Forecast coverage | ${(forecastOk * 100).toFixed(1)}% |

## Performance cohorts (matched age/ability)

| Cohort | Median Δ | Mean Δ | +6 rate | Breakthrough rate |
| --- | ---: | ---: | ---: | ---: |
| Poor | ${perfCohorts.poor.delta.median} | ${perfCohorts.poor.delta.mean} | ${(perfCohorts.poor.plus6Rate * 100).toFixed(1)}% | ${(perfCohorts.poor.breakthroughRate * 100).toFixed(1)}% |
| Neutral | ${perfCohorts.neutral.delta.median} | ${perfCohorts.neutral.delta.mean} | ${(perfCohorts.neutral.plus6Rate * 100).toFixed(1)}% | ${(perfCohorts.neutral.breakthroughRate * 100).toFixed(1)}% |
| Good | ${perfCohorts.good.delta.median} | ${perfCohorts.good.delta.mean} | ${(perfCohorts.good.plus6Rate * 100).toFixed(1)}% | ${(perfCohorts.good.breakthroughRate * 100).toFixed(1)}% |
| Exceptional | ${perfCohorts.exceptional.delta.median} | ${perfCohorts.exceptional.delta.mean} | ${(perfCohorts.exceptional.plus6Rate * 100).toFixed(1)}% | ${(perfCohorts.exceptional.breakthroughRate * 100).toFixed(1)}% |

## Low-start supported paths

${lowStartPaths.map((p) => `- Start ${p.startOvr} → peak ${p.peak.toFixed(2)} · displayed99=${p.displayed99} · ageAt99=${p.ageAt99}`).join("\n")}

## Controlled RW (n=${CONTROLLED_N})

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

  writeFileSync(mdPath, md);
  writeFileSync("reports/player-development-calibration.md", md);
  console.log(md);
  console.log(`Wrote ${jsonPath} and ${mdPath}`);
}

main();
