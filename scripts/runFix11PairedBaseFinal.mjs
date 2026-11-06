#!/usr/bin/env node
/**
 * Fix 11 R4: accepted-base (8d74769) vs current-final natural-career pairs.
 *
 * Spawns the same calibration harness against two engine roots. Base keeps
 * 8d74769 development/season modules; only schedule/fixture adapters from
 * final are overlaid so careers can complete. Growth/employment math still
 * comes from the base engine modules.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ACCEPTED_BASE_SHA } from "./lib/fix11ReviewEvidence.mjs";
import { summarize } from "./lib/fix11GrowthEvidence.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT = join(ROOT, "qa/fix11-runs/paired-base-final");
const PAIR_COUNT = Number(process.env.FIX11_PAIR_COUNT || 24);
const BASE_WORKTREE =
  process.env.FIX11_BASE_WORKTREE || join(ROOT, "../fix11-base-8d74769");
const ADAPTER_FILES = [
  "js/simulation/leagueFixtures.js",
  "js/simulation/continentalSchedule.js",
  "js/simulation/continentalTournament.js",
];

function git(args, cwd = ROOT) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function finalSha() {
  return git(["rev-parse", "HEAD"]);
}

function ensureBaseWorktree() {
  if (!existsSync(BASE_WORKTREE)) {
    mkdirSync(dirname(BASE_WORKTREE), { recursive: true });
    git(["worktree", "add", "--detach", BASE_WORKTREE, ACCEPTED_BASE_SHA]);
  } else {
    const reset = spawnSync("git", ["reset", "--hard", ACCEPTED_BASE_SHA], {
      cwd: BASE_WORKTREE,
      encoding: "utf8",
    });
    if (reset.status !== 0) {
      throw new Error(`base worktree reset failed: ${reset.stderr || reset.stdout}`);
    }
    spawnSync("git", ["clean", "-fd"], { cwd: BASE_WORKTREE, encoding: "utf8" });
  }
  mkdirSync(join(BASE_WORKTREE, "scripts/lib"), { recursive: true });
  mkdirSync(join(BASE_WORKTREE, "qa/fix11-runs"), { recursive: true });
  mkdirSync(join(BASE_WORKTREE, "reports"), { recursive: true });
  cpSync(join(ROOT, "scripts/calibrateFullCareerGrowth.mjs"), join(BASE_WORKTREE, "scripts/calibrateFullCareerGrowth.mjs"));
  cpSync(join(ROOT, "scripts/lib/fix11GrowthEvidence.mjs"), join(BASE_WORKTREE, "scripts/lib/fix11GrowthEvidence.mjs"));
  cpSync(join(ROOT, "qa/fix11-runs/plan.json"), join(BASE_WORKTREE, "qa/fix11-runs/plan.json"));
  if (existsSync(join(ROOT, "reports/fix11-calibration-targets.json"))) {
    cpSync(
      join(ROOT, "reports/fix11-calibration-targets.json"),
      join(BASE_WORKTREE, "reports/fix11-calibration-targets.json")
    );
  }
  for (const rel of ADAPTER_FILES) {
    cpSync(join(ROOT, rel), join(BASE_WORKTREE, rel));
  }
  return {
    root: BASE_WORKTREE,
    engineIdentity: ACCEPTED_BASE_SHA,
    adapters: ADAPTER_FILES,
    note:
      "Schedule/fixture adapters copied from final so league-phase construction can complete; playerDevelopmentModel, playerDevelopmentConfig, seasonSimulator, and seasonEvidence remain at accepted base.",
  };
}

function runEngineSide({ root, label, engineIdentity }) {
  const result = spawnSync(
    process.execPath,
    [
      join(root, "scripts/calibrateFullCareerGrowth.mjs"),
      "--mode",
      "paired-engine-side",
      "--n",
      String(PAIR_COUNT),
      "--label",
      label,
    ],
    { cwd: root, encoding: "utf8", env: { ...process.env, FIX11_ENGINE_IDENTITY: engineIdentity } }
  );
  if (result.status !== 0) {
    throw new Error(
      `engine-side ${label} failed (exit ${result.status}):\n${result.stdout}\n${result.stderr}`
    );
  }
  const runDir = join(root, "qa/fix11-runs", label);
  const summary = JSON.parse(readFileSync(join(runDir, "summary.json"), "utf8"));
  const careersDir = join(runDir, "careers");
  const careers = readdirSync(careersDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(careersDir, name), "utf8")))
    .sort((a, b) => Number(a.manifest?.pairIndex ?? a.manifest?.index) - Number(b.manifest?.pairIndex ?? b.manifest?.index));
  return { runDir, summary, careers, stdout: result.stdout };
}

function careerMetrics(career) {
  const seasons = Array.isArray(career.seasons) ? career.seasons : [];
  return {
    id: career.id,
    seed: career.manifest?.seed ?? null,
    policy: career.policy,
    index: career.manifest?.index ?? career.manifest?.pairIndex ?? null,
    peakRaw: career.peakRaw,
    everDisplayed99: career.everDisplayed99,
    completed: career.completed,
    seasons: seasons.length,
    minutes: seasons.reduce((sum, row) => sum + (Number(row.minutes) || 0), 0),
    unemploymentPeriods: seasons.filter((row) => row.freeAgent).length,
    periodGrowth: seasons.map((row) => ({
      seasonNumber: row.seasonNumber,
      rawDelta: row.rawDelta,
      minutes: row.minutes ?? 0,
      freeAgent: Boolean(row.freeAgent),
    })),
  };
}

function main() {
  const startedAt = new Date().toISOString();
  const tip = finalSha();
  if (tip === ACCEPTED_BASE_SHA) {
    throw new Error("final tip equals accepted base; refuse same-engine comparison");
  }
  const baseMeta = ensureBaseWorktree();
  mkdirSync(join(OUT, "paired"), { recursive: true });
  mkdirSync(join(OUT, "base"), { recursive: true });
  mkdirSync(join(OUT, "final"), { recursive: true });

  const finalSide = runEngineSide({
    root: ROOT,
    label: "paired-engine-final-side",
    engineIdentity: tip,
  });
  const baseSide = runEngineSide({
    root: baseMeta.root,
    label: "paired-engine-base-side",
    engineIdentity: ACCEPTED_BASE_SHA,
  });

  if (finalSide.careers.length !== PAIR_COUNT || baseSide.careers.length !== PAIR_COUNT) {
    throw new Error(
      `expected ${PAIR_COUNT} careers per side; got base=${baseSide.careers.length} final=${finalSide.careers.length}`
    );
  }

  const pairs = [];
  for (let i = 0; i < PAIR_COUNT; i++) {
    const baseCareer = baseSide.careers[i];
    const finalCareer = finalSide.careers[i];
    const base = careerMetrics(baseCareer);
    const fin = careerMetrics(finalCareer);
    if (base.seed !== fin.seed || base.policy !== fin.policy || base.index !== fin.index) {
      throw new Error(`pair ${i} setup mismatch: ${JSON.stringify({ base, final: fin })}`);
    }
    const row = {
      id: `career-pair-${i}`,
      kind: "paired-natural-career-base-final",
      scope: "full-career",
      policy: base.policy,
      positionHint: baseCareer.manifest?.positionHint || null,
      seed: base.seed,
      index: base.index,
      baseRevision: ACCEPTED_BASE_SHA,
      finalRevision: tip,
      base: {
        engineIdentity: ACCEPTED_BASE_SHA,
        adapters: baseMeta.adapters,
        career: base,
      },
      final: {
        engineIdentity: tip,
        career: fin,
      },
      differences: {
        peakRaw: fin.peakRaw - base.peakRaw,
        minutes: fin.minutes - base.minutes,
        unemploymentPeriods: fin.unemploymentPeriods - base.unemploymentPeriods,
        seasons: fin.seasons - base.seasons,
        everDisplayed99: Boolean(fin.everDisplayed99) !== Boolean(base.everDisplayed99),
      },
      limitations: [
        "Later-period paths may diverge after real gameplay changes even with a shared seed.",
        baseMeta.note,
      ],
    };
    pairs.push(row);
    writeFileSync(join(OUT, "paired", `${row.id}.json`), `${JSON.stringify(row, null, 2)}\n`);
    writeFileSync(join(OUT, "base", `${row.id}.json`), `${JSON.stringify(baseCareer, null, 2)}\n`);
    writeFileSync(join(OUT, "final", `${row.id}.json`), `${JSON.stringify(finalCareer, null, 2)}\n`);
  }

  const summary = {
    schemaVersion: "fix11-growth-v1",
    generatedAt: new Date().toISOString(),
    startedAt,
    runtimeMs: Date.now() - Date.parse(startedAt),
    mode: "paired-base-final",
    baseRevision: ACCEPTED_BASE_SHA,
    finalRevision: tip,
    counts: {
      pairedBaseFinal: pairs.length,
      pairedNaturalCareers: pairs.length,
    },
    pairedStudies: {
      note:
        "Full-career pairs compare accepted-base engine modules at 8d74769 against the current final tip. Same-engine identity controls do not satisfy this study.",
      baseFinalTotal: pairs.length,
      naturalCareerIdentityTotal: 0,
      peakRawDiff: summarize(pairs.map((row) => row.differences.peakRaw)),
      minutesDiff: summarize(pairs.map((row) => row.differences.minutes)),
      unemploymentDiff: summarize(pairs.map((row) => row.differences.unemploymentPeriods)),
    },
    adapters: baseMeta,
    assessment: { ok: pairs.length === PAIR_COUNT },
  };
  writeFileSync(join(OUT, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(
    join(OUT, "paired", "manifest.json"),
    `${JSON.stringify(
      {
        kind: "paired-natural-career-base-final",
        baseRevision: ACCEPTED_BASE_SHA,
        finalRevision: tip,
        count: pairs.length,
        adapters: baseMeta.adapters,
      },
      null,
      2
    )}\n`
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        out: OUT,
        baseRevision: ACCEPTED_BASE_SHA,
        finalRevision: tip,
        pairs: pairs.length,
        peakRawDiff: summary.pairedStudies.peakRawDiff,
      },
      null,
      2
    )
  );
}

try {
  main();
} catch (error) {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
}
