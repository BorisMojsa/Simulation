#!/usr/bin/env node
/**
 * Fix 08 matched distribution validation (predeclared seeds + holdout).
 *
 * Compares simulateMatch output for equal-team contexts across role × ability × minutes.
 * Also compares user rating centers to generated rival field rating centers.
 *
 *   node scripts/qaFix08Parity.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { simulateMatch } from "../js/simulation/matchEngine.js";
import { createStreamRng } from "../js/simulation/rng.js";
import { ensureCompetitionAwardField } from "../js/simulation/individualAwards.js";
import { refreshAbilityCaches } from "../js/simulation/playerAbility.js";
import { ensurePlayerModel } from "../js/simulation/playerModelMigration.js";
import { createPlayerIdentity } from "../js/simulation/playerDevelopment.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "qa/fix08-runs/parity");
mkdirSync(outDir, { recursive: true });

const TRAIN_SEEDS = Object.freeze(Array.from({ length: 200 }, (_, i) => 91000 + i));
const HOLDOUT_SEEDS = Object.freeze(Array.from({ length: 200 }, (_, i) => 92000 + i));
const ROLES = ["ST", "CM", "CB", "GK"];
const ABILITIES = [70, 90];
const MINUTES = [20, 90];

function attrs(ovr) {
  return Object.fromEntries(
    ["Speed", "Passing", "Shooting", "Defending", "Physicality", "Dribbling"].map((k) => [k, ovr])
  );
}

function makePlayer(position, ovr, minutes) {
  const p = createPlayerIdentity({
    name: `parity-${position}-${ovr}`,
    nationality: "England",
    position,
    age: 24,
  });
  Object.assign(p, {
    rating: ovr,
    attributes: attrs(ovr),
    matchParticipation: { minutes, started: minutes >= 60, matchDuration: 90 },
  });
  ensurePlayerModel(p);
  refreshAbilityCaches(p);
  return p;
}

function team(overall) {
  return { name: "Parity FC", overall, attack: overall, midfield: overall, defence: overall, gk: overall };
}

function runCell(role, ovr, minutes, seeds, label) {
  let goals = 0;
  let assists = 0;
  let ratedSum = 0;
  let ratedMinutes = 0;
  let ratingSum = 0;
  let n = 0;
  for (const seed of seeds) {
    const player = makePlayer(role, ovr, minutes);
    const rng = createStreamRng(`parity:${label}:${role}:${ovr}:${minutes}`, String(seed));
    const match = simulateMatch(team(75), team(75), {
      player,
      playerSide: "home",
      competition: "league",
      rng,
    });
    const ps = match.playerStats || {};
    const mins = Number(ps.minutes) || 0;
    goals += Number(ps.goals) || 0;
    assists += Number(ps.assists) || 0;
    if (ps.rating != null && mins > 0) {
      ratedSum += Number(ps.rating) * mins;
      ratedMinutes += mins;
      ratingSum += Number(ps.rating);
      n += 1;
    }
  }
  const totalMinutes = seeds.length * minutes;
  return {
    role,
    ovr,
    minutes,
    samples: seeds.length,
    goals,
    assists,
    totalMinutes,
    goalsPer90: totalMinutes > 0 ? (goals * 90) / totalMinutes : 0,
    assistsPer90: totalMinutes > 0 ? (assists * 90) / totalMinutes : 0,
    meanRating: n ? ratingSum / n : null,
    minutesWeightedRating: ratedMinutes > 0 ? ratedSum / ratedMinutes : null,
  };
}

function gapOk(a, b, absTol, relTolOfPooled) {
  const gap = Math.abs(a - b);
  const pooled = (a + b) / 2;
  const tol = Math.max(absTol, relTolOfPooled * Math.abs(pooled));
  return { gap, tol, pass: gap <= tol };
}

const train = [];
const holdout = [];
for (const role of ROLES) {
  for (const ovr of ABILITIES) {
    for (const minutes of MINUTES) {
      train.push(runCell(role, ovr, minutes, TRAIN_SEEDS, "train"));
      holdout.push(runCell(role, ovr, minutes, HOLDOUT_SEEDS, "holdout"));
    }
  }
}

const comparisons = [];
for (const role of ROLES) {
  for (const ovr of ABILITIES) {
    const full = train.find((c) => c.role === role && c.ovr === ovr && c.minutes === 90);
    const sub = train.find((c) => c.role === role && c.ovr === ovr && c.minutes === 20);
    comparisons.push({
      kind: "sub-vs-full-train",
      role,
      ovr,
      full,
      sub,
      note: "Per-90 rates may differ by role/context; double-penalty would crush sub rates far below full.",
      goalsPer90Ratio: full.goalsPer90 > 0 ? sub.goalsPer90 / full.goalsPer90 : null,
      assistsPer90Ratio: full.assistsPer90 > 0 ? sub.assistsPer90 / full.assistsPer90 : null,
    });
  }
}

// Rival rating center vs user quiet-match rating center (equal team, 90').
const rivalPlayer = { name: "U", position: "ST", club: { name: "C0", clubId: "c0" }, awardFields: {} };
const table = Array.from({ length: 20 }, (_, i) => ({
  name: `C${i}`,
  clubId: `c${i}`,
  played: 38,
  goalsFor: 45,
  goalsAgainst: 40,
  points: 55,
  position: i + 1,
}));
const field = ensureCompetitionAwardField(
  rivalPlayer,
  {
    seasonId: "parity",
    competitionEditionId: "parity::1",
    scope: "league",
    table,
    userClub: table[0],
    user: { goals: 8, assists: 4, position: "ST" },
  },
  createStreamRng("parity", "field")
);
const rivalRatings = field.rivals.map((r) => r.rating).filter((x) => Number.isFinite(x));
const rivalMean = rivalRatings.reduce((s, v) => s + v, 0) / rivalRatings.length;
const userFullSt = train.find((c) => c.role === "ST" && c.ovr === 70 && c.minutes === 90);
const ratingParity = gapOk(userFullSt.meanRating ?? 0, rivalMean, 0.1, 0);

const summary = {
  generatedAt: new Date().toISOString(),
  head: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(),
  dirty: spawnSync("git", ["status", "--porcelain", "--", "js/"], { cwd: root, encoding: "utf8" }).stdout.trim(),
  trainSeeds: { start: TRAIN_SEEDS[0], end: TRAIN_SEEDS.at(-1), n: TRAIN_SEEDS.length },
  holdoutSeeds: { start: HOLDOUT_SEEDS[0], end: HOLDOUT_SEEDS.at(-1), n: HOLDOUT_SEEDS.length },
  tolerances: { meanRatingAbs: 0.1, rateAbs: 0.03, rateRel: 0.2 },
  train,
  holdout,
  comparisons,
  rivalField: { n: rivalRatings.length, meanRating: rivalMean, populationSize: field.populationSize },
  userVsRivalRating: {
    userMean: userFullSt.meanRating,
    rivalMean,
    ...ratingParity,
    note: "Engineering parity check for centers under equal-team ST 70 / 90' vs generated league field.",
  },
};

writeFileSync(join(outDir, "parity-summary.json"), JSON.stringify(summary, null, 2));
console.log(
  JSON.stringify(
    {
      outDir,
      cells: train.length,
      samplesPerCell: TRAIN_SEEDS.length,
      userVsRivalRatingPass: ratingParity.pass,
      userMean: userFullSt.meanRating,
      rivalMean,
    },
    null,
    2
  )
);
