/**
 * Seeded full-opening calibration for the academy scenario rebalance.
 *
 * Usage:
 *   node scripts/calibrateAcademyOpening.mjs
 *   node scripts/calibrateAcademyOpening.mjs --light
 *
 * Writes reports/academy-opening-calibration.json and .md
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { createRng, hashSeed } from "../js/simulation/rng.js";
import { ACADEMY_POOL } from "../js/data/leagues.js";
import {
  createPlayerIdentity,
  finalizeAcademyPlayer,
} from "../js/simulation/playerDevelopment.js";
import { simulateFullAcademyOpening } from "../js/simulation/academyOpening.js";
import { getBaseOverall } from "../js/simulation/playerAbility.js";
import { roundAbilityForDisplay } from "../js/ui/abilityFormatting.js";
import { pickThreeAcademies } from "../js/simulation/narrativeAcademySeason.js";

const light = process.argv.includes("--light");
const TOTAL = light ? 2000 : 10000;

const POSITION_GROUPS = [
  { group: "GK", position: "GK" },
  { group: "DEF", position: "CB" },
  { group: "MID", position: "CM" },
  { group: "WING", position: "LW" },
  { group: "ST", position: "ST" },
];

/** Policies defined before seeing results (not selected post-hoc). */
const POLICIES = ["balanced", "thoughtful", "reckless", "random"];

function gitRevision() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function configHash() {
  const raw = readFileSync(new URL("../js/config/academyOpeningConfig.js", import.meta.url));
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

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
  };
}

function share(n, d) {
  return d ? Number(((n / d) * 100).toFixed(1)) : 0;
}

function bandForStart(displayed) {
  if (displayed < 54) return "below-ordinary";
  if (displayed <= 70) return "ordinary-54-70";
  return "high-71+";
}

function headroomBucket(player) {
  const raw = getBaseOverall(player);
  const budget = player.development?.latentAbilityBudget ?? raw;
  const room = budget - raw;
  if (room < 1.5) return "near-ceiling";
  if (room < 4) return "tight";
  return "healthy";
}

function runOne(seed, { position, policy, forceNearCeiling = false }) {
  const opts = { forceNearCeiling };
  const rng = createRng(seed);
  const player = createPlayerIdentity({
    name: `Cal${seed}`,
    nationality: "England",
    position,
    age: 17,
  });
  const academy = pickThreeAcademies(ACADEMY_POOL, "England", player.name)[0]?.academy;
  if (!academy) throw new Error("no academy");
  finalizeAcademyPlayer(player, academy);

  // Optional forced near-ceiling cohort for reporting (not used for ordinary targets).
  if (opts.forceNearCeiling) {
    const raw = getBaseOverall(player);
    player.development.latentAbilityBudget = raw + 0.8;
    player.development.latentBudget = player.development.latentAbilityBudget;
  }

  const rawStart = getBaseOverall(player);
  const dispStart = roundAbilityForDisplay(rawStart);
  const potStart = player.potential;
  const headroom = headroomBucket(player);
  const startBand = bandForStart(dispStart);

  simulateFullAcademyOpening(player, { policy, rng });

  const rawEnd = getBaseOverall(player);
  const dispEnd = roundAbilityForDisplay(rawEnd);
  const potEnd = player.potential;
  const dispDelta = dispEnd - dispStart;
  const rawDelta = rawEnd - rawStart;
  const bucket = dispDelta > 0 ? "improved" : dispDelta < 0 ? "declined" : "unchanged";
  const capHits = (player.academyOpening?.rolls || []).filter((r) =>
    ["budget", "annual-cap", "clamp-ceiling"].includes(r.limitedBy)
  ).length;

  return {
    position,
    policy,
    startBand,
    headroom,
    dispStart,
    dispEnd,
    dispDelta,
    rawDelta,
    potDelta: (potEnd ?? 0) - (potStart ?? 0),
    bucket,
    positiveLearning: player.academyOpening?.positiveLearningApplied || 0,
    lossApplied: player.academyOpening?.lossApplied || 0,
    capHits,
    nearCeiling: headroom === "near-ceiling",
  };
}

function aggregate(rows) {
  const n = rows.length;
  const improved = rows.filter((r) => r.bucket === "improved").length;
  const unchanged = rows.filter((r) => r.bucket === "unchanged").length;
  const declined = rows.filter((r) => r.bucket === "declined").length;
  const gains = rows.filter((r) => r.dispDelta > 0).map((r) => r.dispDelta);
  const losses = rows.filter((r) => r.dispDelta < 0).map((r) => Math.abs(r.dispDelta));
  return {
    n,
    improvedPct: share(improved, n),
    unchangedPct: share(unchanged, n),
    declinedPct: share(declined, n),
    meanDisplayedDelta: summarize(rows.map((r) => r.dispDelta)).mean,
    meanRawDelta: summarize(rows.map((r) => r.rawDelta)).mean,
    meanPotDelta: summarize(rows.map((r) => r.potDelta)).mean,
    gainMagnitudes: summarize(gains),
    lossMagnitudes: summarize(losses),
    meanPositiveLearning: summarize(rows.map((r) => r.positiveLearning)).mean,
    meanLossApplied: summarize(rows.map((r) => r.lossApplied)).mean,
    capHitRate: share(
      rows.filter((r) => r.capHits > 0).length,
      n
    ),
  };
}

function main() {
  const perCell = Math.max(1, Math.floor(TOTAL / (POSITION_GROUPS.length * POLICIES.length)));
  const rows = [];
  let seed = hashSeed("academy-opening-calibration-v1");
  for (const { position } of POSITION_GROUPS) {
    for (const policy of POLICIES) {
      for (let i = 0; i < perCell; i++) {
        seed = (seed + 0x9e3779b9) >>> 0;
        rows.push(runOne(seed, { position, policy }));
      }
    }
  }

  const byPolicy = {};
  for (const policy of POLICIES) {
    byPolicy[policy] = aggregate(rows.filter((r) => r.policy === policy));
  }
  const byGroup = {};
  for (const { group, position } of POSITION_GROUPS) {
    byGroup[group] = aggregate(rows.filter((r) => r.position === position && r.policy === "balanced"));
  }
  const ordinaryBalanced = aggregate(
    rows.filter(
      (r) =>
        r.policy === "balanced" &&
        r.startBand === "ordinary-54-70" &&
        r.headroom === "healthy"
    )
  );
  // Dedicated near-ceiling sample (academy starts rarely sit on the latent cap).
  const nearCeilingRows = [];
  let ceilSeed = hashSeed("academy-opening-near-ceiling");
  for (const { position } of POSITION_GROUPS) {
    for (let i = 0; i < (light ? 40 : 200); i++) {
      ceilSeed = (ceilSeed + 0x9e3779b9) >>> 0;
      nearCeilingRows.push(
        runOne(ceilSeed, { position, policy: "balanced", forceNearCeiling: true })
      );
    }
  }
  const nearCeiling = aggregate(nearCeilingRows);
  const highBand = aggregate(
    rows.filter((r) => r.policy === "balanced" && r.startBand === "high-71+")
  );

  const report = {
    generatedAt: new Date().toISOString(),
    gitRevision: gitRevision(),
    configHash: configHash(),
    totalOpenings: rows.length,
    perCell,
    policiesDefinedUpFront: POLICIES,
    targets: {
      ordinaryBalancedDisplayed: "≈60–70% improve / 20–30% unchanged / 5–15% decline (central 65/25/10)",
      thoughtfulImprove: "≈75–85%",
      reckless: "materially more stagnation/decline than thoughtful",
      typicalSuccessDisplayed: "+1 to +3 across opening",
      typicalPoorDisplayed: "−1 to −2",
    },
    overall: aggregate(rows),
    byPolicy,
    byGroupBalanced: byGroup,
    cohorts: {
      ordinaryHealthyBalanced: ordinaryBalanced,
      nearCeilingBalanced: nearCeiling,
      highStartBalanced: highBand,
    },
    notes: [
      "Displayed deltas use rounded base OVR endpoints; raw uses baseOverallRaw.",
      "Near-ceiling cohort may legitimately show more unchanged outcomes.",
      "Skip/bootstrap path applies baseline only and is not included here.",
    ],
  };

  mkdirSync(new URL("../reports", import.meta.url), { recursive: true });
  const jsonPath = new URL("../reports/academy-opening-calibration.json", import.meta.url);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const md = [
    "# Academy opening calibration",
    "",
    `Openings: **${report.totalOpenings}** · config \`${report.configHash}\``,
    "",
    "## Ordinary healthy balanced cohort",
    "",
    `| Metric | Value |`,
    `| --- | ---: |`,
    `| Improved % | ${ordinaryBalanced.improvedPct} |`,
    `| Unchanged % | ${ordinaryBalanced.unchangedPct} |`,
    `| Declined % | ${ordinaryBalanced.declinedPct} |`,
    `| Mean displayed Δ | ${ordinaryBalanced.meanDisplayedDelta} |`,
    `| Mean raw Δ | ${ordinaryBalanced.meanRawDelta} |`,
    "",
    "## By policy",
    "",
    `| Policy | Improve % | Unchanged % | Decline % | Mean disp Δ |`,
    `| --- | ---: | ---: | ---: | ---: |`,
    ...POLICIES.map(
      (p) =>
        `| ${p} | ${byPolicy[p].improvedPct} | ${byPolicy[p].unchangedPct} | ${byPolicy[p].declinedPct} | ${byPolicy[p].meanDisplayedDelta} |`
    ),
    "",
    "## Balanced by position group",
    "",
    `| Group | Improve % | Unchanged % | Decline % | Mean disp Δ |`,
    `| --- | ---: | ---: | ---: | ---: |`,
    ...POSITION_GROUPS.map(
      ({ group }) =>
        `| ${group} | ${byGroup[group].improvedPct} | ${byGroup[group].unchangedPct} | ${byGroup[group].declinedPct} | ${byGroup[group].meanDisplayedDelta} |`
    ),
    "",
    "## Cohorts outside ordinary target (expected)",
    "",
    `- Near-ceiling balanced: improve ${nearCeiling.improvedPct}% / unchanged ${nearCeiling.unchangedPct}% / decline ${nearCeiling.declinedPct}% (n=${nearCeiling.n})`,
    `- High start (71+) balanced: improve ${highBand.improvedPct}% / unchanged ${highBand.unchangedPct}% / decline ${highBand.declinedPct}% (n=${highBand.n})`,
    "",
  ].join("\n");
  writeFileSync(new URL("../reports/academy-opening-calibration.md", import.meta.url), md);

  console.log(md);
  console.log(`Wrote ${jsonPath.pathname}`);
}

main();
