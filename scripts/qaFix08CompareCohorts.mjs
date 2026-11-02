#!/usr/bin/env node
/**
 * Compare Fix 08 base vs final cohort artifacts with matched-input gates.
 *
 *   node scripts/qaFix08CompareCohorts.mjs
 *
 * Acceptance requires both cohorts, 144 rows each, one-to-one fixture/period
 * identity, valid initial snapshot hashes/files, and compatible fixture hashes.
 * Outcome equality is not required.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_BASE_HEAD = "52dc6014f0aa6ba372e8ebc453943e8e3023b7d1";
const baseDir = join(root, process.env.FIX08_COHORT_BASE || "qa/fix08-runs/cohort-base");
const finalDir = join(root, process.env.FIX08_COHORT_FINAL || "qa/fix08-runs/cohort");
const outDir = join(root, "qa/fix08-runs/comparison");
const finalOut = join(root, "qa/fix08-runs/final");
mkdirSync(outDir, { recursive: true });
mkdirSync(finalOut, { recursive: true });

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

function hashFile(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
const remote = (
  spawnSync("git", ["ls-remote", "origin", "refs/heads/fix/08-user-rival-performance-individual-awards"], {
    cwd: root,
    encoding: "utf8",
  }).stdout || ""
)
  .trim()
  .split("\t")[0];
const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).stdout.trim();
const dirtyTracked = dirty
  .split("\n")
  .filter(Boolean)
  .filter((l) => !l.startsWith("??"));

const baseSummary = existsSync(join(baseDir, "summary.json")) ? readJson(join(baseDir, "summary.json")) : null;
const finalSummary = existsSync(join(finalDir, "summary.json")) ? readJson(join(finalDir, "summary.json")) : null;

function periodIndex(dir) {
  const ledgers = join(dir, "ledgers");
  if (!existsSync(ledgers)) return [];
  return readdirSync(ledgers)
    .filter((f) => f.endsWith(".json") && !f.startsWith("dedicated-"))
    .map((f) => {
      const row = readJson(join(ledgers, f));
      return {
        file: f,
        fixtureId: row.fixtureId,
        period: row.period,
        wins:
          row.wins ||
          (row.awardRecords || []).filter((r) => r?.status === "won").map((r) => r.awardId || r) ||
          [],
        selections:
          row.selections ||
          (row.awardRecords || []).filter((r) => r?.status === "selected").map((r) => r.awardId || r) ||
          [],
        nominations:
          row.nominations ||
          (row.awardRecords || []).filter((r) => r?.status === "nominated").map((r) => r.awardId || r) ||
          [],
        goals: row.goals,
        minutes: row.minutes,
        completion: row.completion,
        fixtureHash: row.fixtureHash,
        initialSnapshotHash: row.initialSnapshotHash,
        initialSnapshotPath: row.initialSnapshotPath || null,
      };
    })
    .sort((a, b) => String(a.file).localeCompare(String(b.file)));
}

function snapshotFiles(dir) {
  const snaps = join(dir, "snapshots");
  if (!existsSync(snaps)) return [];
  return readdirSync(snaps).filter((f) => f.endsWith("-initial.json"));
}

const failures = [];
if (!baseSummary) failures.push("missing-base-summary");
if (!finalSummary) failures.push("missing-final-summary");

const baseRows = periodIndex(baseDir);
const finalRows = periodIndex(finalDir);
const baseSnaps = snapshotFiles(baseDir);
const finalSnaps = snapshotFiles(finalDir);

if ((baseSummary?.periodRecords ?? baseRows.length) < 144) failures.push("base-period-records");
if ((finalSummary?.periodRecords ?? finalRows.length) < 144) failures.push("final-period-records");
if (baseRows.length < 144) failures.push("base-ledger-rows");
if (finalRows.length < 144) failures.push("final-ledger-rows");
if (baseSnaps.length < 48) failures.push("base-initial-snapshots");
if (finalSnaps.length < 48) failures.push("final-initial-snapshots");
if (baseSummary && baseSummary.head !== EXPECTED_BASE_HEAD) failures.push("base-head-mismatch");
if (finalSummary && finalSummary.head !== head) failures.push("final-head-mismatch");
if (head !== (remote || head)) failures.push("remote-head-mismatch");
if (dirtyTracked.length) failures.push("dirty-tracked");
if (finalSummary && finalSummary.scoringAwardWitness !== true) failures.push("final-scoring-witness");
if (finalSummary && finalSummary.ok !== true) failures.push("final-summary-not-ok");
if (baseSummary && baseSummary.ok !== true) failures.push("base-summary-not-ok");

const byBaseFile = new Map(baseRows.map((r) => [r.file, r]));
const byFinalFile = new Map(finalRows.map((r) => [r.file, r]));
const rowDiffs = [];
let matchedPairs = 0;
let fixtureHashMatches = 0;
let snapshotHashMatches = 0;
let missingBaseRows = 0;
let missingFinalRows = 0;
let snapshotFileMisses = 0;

for (const fr of finalRows) {
  const br = byBaseFile.get(fr.file);
  if (!br) {
    missingBaseRows += 1;
    rowDiffs.push({ file: fr.file, kind: "final-only" });
    continue;
  }
  matchedPairs += 1;
  if (br.fixtureId !== fr.fixtureId || br.period !== fr.period) {
    failures.push(`identity-mismatch:${fr.file}`);
  }
  if (br.fixtureHash && fr.fixtureHash && br.fixtureHash === fr.fixtureHash) fixtureHashMatches += 1;
  else failures.push(`fixture-hash-mismatch:${fr.file}`);

  if (br.initialSnapshotHash && fr.initialSnapshotHash && br.initialSnapshotHash === fr.initialSnapshotHash) {
    snapshotHashMatches += 1;
  } else {
    failures.push(`initial-snapshot-hash-mismatch:${fr.file}`);
  }

  const baseSnapRel = br.initialSnapshotPath || `snapshots/${br.fixtureId}-initial.json`;
  const finalSnapRel = fr.initialSnapshotPath || `snapshots/${fr.fixtureId}-initial.json`;
  const baseSnapPath = join(baseDir, baseSnapRel);
  const finalSnapPath = join(finalDir, finalSnapRel);
  if (!existsSync(baseSnapPath) || !existsSync(finalSnapPath)) {
    snapshotFileMisses += 1;
    failures.push(`snapshot-file-missing:${fr.file}`);
  } else if (br.initialSnapshotHash && hashFile(baseSnapPath) !== br.initialSnapshotHash) {
    failures.push(`base-snapshot-bytes-mismatch:${fr.file}`);
  } else if (fr.initialSnapshotHash && hashFile(finalSnapPath) !== fr.initialSnapshotHash) {
    failures.push(`final-snapshot-bytes-mismatch:${fr.file}`);
  } else if (hashFile(baseSnapPath) !== hashFile(finalSnapPath)) {
    failures.push(`shared-initial-bytes-mismatch:${fr.file}`);
  }

  const changed =
    JSON.stringify(br.wins) !== JSON.stringify(fr.wins) ||
    JSON.stringify(br.selections) !== JSON.stringify(fr.selections) ||
    JSON.stringify(br.nominations) !== JSON.stringify(fr.nominations) ||
    br.goals !== fr.goals ||
    br.minutes !== fr.minutes;
  if (changed) {
    rowDiffs.push({
      file: fr.file,
      kind: "changed",
      base: { wins: br.wins, sel: br.selections, nom: br.nominations, goals: br.goals, minutes: br.minutes },
      final: { wins: fr.wins, sel: fr.selections, nom: fr.nominations, goals: fr.goals, minutes: fr.minutes },
    });
  }
}

for (const br of baseRows) {
  if (!byFinalFile.has(br.file)) {
    missingFinalRows += 1;
    rowDiffs.push({ file: br.file, kind: "base-only" });
  }
}

if (missingBaseRows) failures.push(`missing-base-rows:${missingBaseRows}`);
if (missingFinalRows) failures.push(`missing-final-rows:${missingFinalRows}`);
if (matchedPairs < 144) failures.push(`matched-pairs:${matchedPairs}`);
if (fixtureHashMatches < 144) failures.push(`fixture-hash-matches:${fixtureHashMatches}`);
if (snapshotHashMatches < 144) failures.push(`snapshot-hash-matches:${snapshotHashMatches}`);
if (snapshotFileMisses) failures.push(`snapshot-file-misses:${snapshotFileMisses}`);

// Totals recomputed from raw ledger rows (not trusted summary alone).
function recount(rows) {
  let wins = 0;
  let selections = 0;
  let nominations = 0;
  for (const r of rows) {
    wins += (r.wins || []).length;
    selections += (r.selections || []).length;
    nominations += (r.nominations || []).length;
  }
  return { wins, selections, nominations };
}
const baseRecount = recount(baseRows);
const finalRecount = recount(finalRows);

const summary = {
  generatedAt: new Date().toISOString(),
  expectedBaseHead: EXPECTED_BASE_HEAD,
  baseHead: baseSummary?.head ?? null,
  finalHead: finalSummary?.head ?? null,
  workingTreeHead: head,
  remote: remote || null,
  dirtyTracked: dirtyTracked.length > 0,
  baseHarnessDigest: baseSummary?.harnessDigest ?? null,
  finalHarnessDigest: finalSummary?.harnessDigest ?? null,
  basePeriodRecords: baseSummary?.periodRecords ?? baseRows.length,
  finalPeriodRecords: finalSummary?.periodRecords ?? finalRows.length,
  baseLedgerRows: baseRows.length,
  finalLedgerRows: finalRows.length,
  baseInitialSnapshots: baseSnaps.length,
  finalInitialSnapshots: finalSnaps.length,
  matchedPairs,
  fixtureHashMatches,
  snapshotHashMatches,
  baseWins: baseRecount.wins,
  finalWins: finalRecount.wins,
  baseSelections: baseRecount.selections,
  finalSelections: finalRecount.selections,
  baseNominations: baseRecount.nominations,
  finalNominations: finalRecount.nominations,
  baseScoringAwardWitness: baseSummary?.scoringAwardWitness ?? null,
  finalScoringAwardWitness: finalSummary?.scoringAwardWitness ?? null,
  changedRows: rowDiffs.filter((r) => r.kind === "changed").length,
  failures: [...new Set(failures)],
  ok: failures.length === 0,
};

writeFileSync(join(outDir, "base-final-summary.json"), JSON.stringify(summary, null, 2));
writeFileSync(
  join(outDir, "base-final-rows.json"),
  JSON.stringify({ rowDiffs, finalRows: finalRows.length, baseRows: baseRows.length }, null, 2)
);

const finalMirror = {
  ...finalSummary,
  head,
  remote,
  comparison: summary,
  summarySha256: existsSync(join(finalDir, "summary.json")) ? hashFile(join(finalDir, "summary.json")) : null,
};
writeFileSync(join(finalOut, "summary.json"), JSON.stringify(finalMirror, null, 2));

console.log(JSON.stringify({ outDir, ...summary }, null, 2));
process.exitCode = summary.ok ? 0 : 1;
