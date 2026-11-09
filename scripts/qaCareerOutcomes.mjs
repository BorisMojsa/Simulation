#!/usr/bin/env node
/**
 * Reproducible full-career QA entry point (Round 2 Item 3).
 *
 * Usage:
 *   node scripts/qaCareerOutcomes.mjs --n 10 --seed 20261107 --maxAge 42 --out /tmp/run
 *   node scripts/qaCareerOutcomes.mjs --manifest /tmp/run/manifest.json --out /tmp/replay
 *   node scripts/qaCareerOutcomes.mjs --manifest /tmp/run/manifest.json --career-index 0 --out /tmp/solo
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest, selectManifestRows, validateManifest } from "./lib/careerQaManifest.mjs";
import { playCareerFromRow } from "./lib/careerQaPlay.mjs";
import { aggregateCareers, canonicalCareerRecord, toHumanSummary } from "./lib/careerQaReport.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function gitRevision() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function printUsage(stream = console.error) {
  stream.write(`Reproducible career QA

Usage:
  node scripts/qaCareerOutcomes.mjs --n <count> --seed <int> --maxAge <age> --out <dir>
  node scripts/qaCareerOutcomes.mjs --manifest <file> [--career-index <i>] --out <dir>

Options:
  --n <count>            Number of careers to sample (with --seed)
  --seed <int>           Root seed for manifest construction
  --maxAge <age>         Policy age cutoff (default 42)
  --out <dir>            Fresh output directory (required)
  --manifest <file>      Replay exact frozen inputs
  --career-index <i>     Replay a single manifest row by index
  --opening <path>       interactive (default) or skip
  --help                 Show help
`);
}

function parseArgs(argv) {
  const out = {
    n: null,
    seed: null,
    maxAge: 42,
    outDir: null,
    manifest: null,
    careerIndex: null,
    opening: "interactive",
    help: false,
  };
  const known = new Set(["--n", "--seed", "--maxAge", "--out", "--manifest", "--career-index", "--opening", "--help", "-h"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!known.has(a)) {
      throw new Error(`Unknown argument: ${a}`);
    }
    if (a === "--help" || a === "-h") {
      out.help = true;
      continue;
    }
    const value = argv[++i];
    if (value == null || String(value).startsWith("--")) {
      throw new Error(`Missing value for ${a}`);
    }
    if (a === "--n") out.n = Number(value);
    else if (a === "--seed") out.seed = Number(value);
    else if (a === "--maxAge") out.maxAge = Number(value);
    else if (a === "--out") out.outDir = value;
    else if (a === "--manifest") out.manifest = value;
    else if (a === "--career-index") out.careerIndex = Number(value);
    else if (a === "--opening") out.opening = value;
  }
  return out;
}

function assertFreshOutDir(outDir) {
  if (!outDir) throw new Error("--out <directory> is required");
  const resolved = path.resolve(outDir);
  if (fs.existsSync(resolved)) {
    const entries = fs.readdirSync(resolved);
    if (entries.length) {
      throw new Error(`--out directory must be empty/fresh: ${resolved} (contains ${entries.length} entries)`);
    }
  } else {
    fs.mkdirSync(resolved, { recursive: true });
  }
  return resolved;
}

function loadManifestFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid manifest JSON: ${error.message}`);
  }
  return validateManifest(parsed);
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(String(error.message || error));
    printUsage();
    process.exit(2);
  }
  if (opts.help) {
    printUsage(process.stdout);
    process.exit(0);
  }

  let outDir;
  try {
    outDir = assertFreshOutDir(opts.outDir);
  } catch (error) {
    console.error(String(error.message || error));
    process.exit(2);
  }

  if (opts.opening !== "interactive" && opts.opening !== "skip") {
    console.error(`Invalid --opening ${opts.opening} (expected interactive|skip)`);
    process.exit(2);
  }

  let manifest;
  let mode;
  try {
    if (opts.manifest) {
      if (opts.n != null || opts.seed != null) {
        throw new Error("Do not combine --manifest with --n/--seed");
      }
      manifest = loadManifestFile(opts.manifest);
      if (opts.maxAge != null && manifest.maxAge == null) manifest.maxAge = opts.maxAge;
      mode = "manifest-replay";
    } else {
      if (opts.n == null || opts.seed == null) {
        throw new Error("Provide --n and --seed, or --manifest");
      }
      if (!Number.isInteger(opts.n) || opts.n < 1) throw new Error(`Invalid --n ${opts.n}`);
      if (!Number.isInteger(opts.seed)) throw new Error(`Invalid --seed ${opts.seed}`);
      if (!Number.isInteger(opts.maxAge) || opts.maxAge < 20) throw new Error(`Invalid --maxAge ${opts.maxAge}`);
      manifest = buildManifest(opts.seed, opts.n, { maxAge: opts.maxAge });
      mode = "sample";
    }
  } catch (error) {
    console.error(String(error.message || error));
    process.exit(2);
  }

  let rows;
  try {
    rows = selectManifestRows(manifest, opts.careerIndex);
  } catch (error) {
    console.error(String(error.message || error));
    process.exit(2);
  }

  const testedSha = gitRevision();
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const rerunCommand = opts.manifest
    ? `TZ=UTC node scripts/qaCareerOutcomes.mjs --manifest ${path.resolve(opts.manifest)}${
        opts.careerIndex != null ? ` --career-index ${opts.careerIndex}` : ""
      } --out <fresh-dir>`
    : `TZ=UTC node scripts/qaCareerOutcomes.mjs --n ${manifest.n} --seed ${manifest.seed} --maxAge ${manifest.maxAge} --out <fresh-dir>`;

  const runMeta = {
    schemaVersion: manifest.schemaVersion,
    mode,
    testedSha,
    node: process.version,
    tz: process.env.TZ || null,
    seed: manifest.seed,
    n: manifest.n,
    maxAge: manifest.maxAge,
    selectedRows: rows.map((r) => r.index),
    opening: opts.opening,
    startedAt,
    rerunCommand,
  };

  writeJson(path.join(outDir, "manifest.json"), manifest);

  const careers = [];
  console.log(`Career QA ${mode}: ${rows.length} row(s), out=${outDir}`);
  for (const row of rows) {
    const record = playCareerFromRow(row, { openingPath: opts.opening });
    const canonical = canonicalCareerRecord(record);
    careers.push(canonical);
    if ((careers.length % 5 === 0) || careers.length === 1 || careers.length === rows.length) {
      console.log(
        `progress ${careers.length}/${rows.length} index=${row.index} end=${record.end?.endReason} peak=${record.peakRating}`
      );
    }
  }

  const finishedAt = new Date().toISOString();
  const elapsedMs = Date.now() - startedMs;
  runMeta.finishedAt = finishedAt;
  runMeta.elapsedMs = elapsedMs;

  const careersPath = path.join(outDir, "careers.jsonl");
  fs.writeFileSync(careersPath, careers.map((c) => JSON.stringify(c)).join("\n") + (careers.length ? "\n" : ""));

  const summary = aggregateCareers(careers, {
    testedSha,
    seed: manifest.seed,
    n: rows.length,
    maxAge: manifest.maxAge,
    rerunCommand,
  });
  writeJson(path.join(outDir, "summary.json"), { run: runMeta, summary });
  fs.writeFileSync(path.join(outDir, "summary.md"), `${toHumanSummary(summary, { ...runMeta, rerunCommand })}\n`);

  console.log(
    JSON.stringify(
      {
        out: outDir,
        testedSha,
        elapsedMs,
        endReasons: summary.endReasons,
        peaks: summary.peaks.current,
        firstPro: summary.firstPro.current,
      },
      null,
      2
    )
  );
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error);
  process.exit(1);
}
