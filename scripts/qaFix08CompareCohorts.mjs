#!/usr/bin/env node
/**
 * Compare Fix 08 base vs final cohort artifacts with current HEAD provenance.
 *
 *   node scripts/qaFix08CompareCohorts.mjs
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
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
if (!finalSummary) {
  console.error("missing final cohort summary");
  process.exit(2);
}

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
        wins: row.wins || [],
        selections: row.selections || [],
        nominations: row.nominations || [],
        goals: row.goals,
        minutes: row.minutes,
        completion: row.completion,
        fixtureHash: row.fixtureHash,
        initialSnapshotHash: row.initialSnapshotHash,
      };
    })
    .sort((a, b) => String(a.file).localeCompare(String(b.file)));
}

const baseRows = periodIndex(baseDir);
const finalRows = periodIndex(finalDir);
const byFile = new Map(baseRows.map((r) => [r.file, r]));
const rowDiffs = [];
for (const fr of finalRows) {
  const br = byFile.get(fr.file);
  if (!br) {
    rowDiffs.push({ file: fr.file, kind: "final-only" });
    continue;
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

const summary = {
  generatedAt: new Date().toISOString(),
  baseHead: baseSummary?.head ?? null,
  finalHead: finalSummary.head ?? head,
  workingTreeHead: head,
  remote: remote || null,
  dirtyTracked: dirtyTracked.length > 0,
  basePeriodRecords: baseSummary?.periodRecords ?? baseRows.length,
  finalPeriodRecords: finalSummary.periodRecords ?? finalRows.length,
  baseWins: baseSummary?.wins ?? null,
  finalWins: finalSummary.wins ?? null,
  baseSelections: baseSummary?.selections ?? null,
  finalSelections: finalSummary.selections ?? null,
  baseNominations: baseSummary?.nominations ?? null,
  finalNominations: finalSummary.nominations ?? null,
  baseScoringAwardWitness: baseSummary?.scoringAwardWitness ?? null,
  finalScoringAwardWitness: finalSummary.scoringAwardWitness ?? null,
  changedRows: rowDiffs.length,
  ok:
    Boolean(finalSummary.ok) &&
    (finalSummary.periodRecords || 0) >= 144 &&
    finalSummary.scoringAwardWitness === true &&
    head === (remote || head),
};

writeFileSync(join(outDir, "base-final-summary.json"), JSON.stringify(summary, null, 2));
writeFileSync(join(outDir, "base-final-rows.json"), JSON.stringify({ rowDiffs, finalRows: finalRows.length, baseRows: baseRows.length }, null, 2));

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
