/**
 * Run the corrected Fix07BaselineCohortRunner against accepted Fix 06 and final,
 * then emit a keyed 48-period comparison.
 *
 *   node baseline/Fix07BaselineCompare.mjs
 *
 * Env: FIX06_SHA (default 8313f27…), OUT_DIR (default qa/fix07-runs/baseline-compare),
 *      FIX07_FINAL_SHA (optional explicit tested commit; required when working tree is dirty)
 */
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const FIX06_SHA = process.env.FIX06_SHA || "8313f27167c18c18079471a44b36878bd347638a";
const headSha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
const dirty = spawnSync("git", ["status", "--porcelain", "--", "js/", "baseline/", "league-data.js"], {
  cwd: root,
  encoding: "utf8",
}).stdout.trim();
const finalSha = process.env.FIX07_FINAL_SHA || (dirty ? null : headSha);
if (!finalSha) {
  throw new Error(
    "Production/harness tree is dirty; set FIX07_FINAL_SHA to the tested commit or clean first"
  );
}
const outDir = process.env.OUT_DIR || join(root, "qa/fix07-runs/baseline-compare");
mkdirSync(outDir, { recursive: true });

const baseExtract = join(outDir, "_fix06-tree");
if (existsSync(baseExtract)) rmSync(baseExtract, { recursive: true, force: true });
mkdirSync(baseExtract, { recursive: true });
const tar = join(outDir, "_fix06.tar");
const arch = spawnSync("git", ["archive", FIX06_SHA, "-o", tar], { cwd: root, encoding: "utf8" });
if (arch.status !== 0) throw new Error(`git archive failed: ${arch.stderr}`);
const untar = spawnSync("tar", ["-xf", tar, "-C", baseExtract], { encoding: "utf8" });
if (untar.status !== 0) throw new Error(`tar failed: ${untar.stderr}`);

function runCohort(label, moduleRoot, outFile) {
  const r = spawnSync(process.execPath, [join(root, "baseline/Fix07BaselineCohortRunner.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      ROOT: moduleRoot,
      FIX07_BASELINE_OUT: outFile,
    },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  writeFileSync(join(outDir, `${label}.log`), `${r.stdout}\n${r.stderr}`);
  if (r.status !== 0) throw new Error(`${label} cohort failed: ${r.stderr || r.stdout}`);
  return JSON.parse(readFileSync(outFile, "utf8"));
}

const baseOut = join(outDir, "baseline-fix06.json");
const finalOut = join(outDir, "baseline-final.json");
const base = runCohort("fix06", baseExtract, baseOut);
const final = runCohort("final", root, finalOut);

if (base.initialFixtures?.length !== 12 || final.initialFixtures?.length !== 12) {
  throw new Error("expected 12 initial fixtures on both sides");
}
for (let i = 0; i < 12; i++) {
  const a = base.initialFixtures[i];
  const b = final.initialFixtures[i];
  if (a.employmentClubId !== b.employmentClubId || a.id !== b.id) {
    throw new Error(`initial fixture mismatch at ${i}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  }
}

const byId = (recs) => Object.fromEntries((recs || []).map((r) => [r.caseId, r]));
const baseMap = byId(base.records);
const finalMap = byId(final.records);
const ids = [...new Set([...Object.keys(baseMap), ...Object.keys(finalMap)])].sort();
const periods = ids.map((id) => {
  const b = baseMap[id] || null;
  const f = finalMap[id] || null;
  return {
    caseId: id,
    base: b
      ? {
          kind: b.kind,
          minutes: b.minutes,
          matches: b.matches,
          share: b.share,
          shareSource: b.shareSource,
          legacyReportedShare: b.legacyReportedShare,
          opportunityShare: b.opportunityShare,
          measuredShare: b.measuredShare,
          freeAgent: b.freeAgent,
          loanActive: b.loanActive,
        }
      : null,
    final: f
      ? {
          kind: f.kind,
          minutes: f.minutes,
          matches: f.matches,
          share: f.share,
          shareSource: f.shareSource,
          legacyReportedShare: f.legacyReportedShare,
          opportunityShare: f.opportunityShare,
          measuredShare: f.measuredShare,
          freeAgent: f.freeAgent,
          loanActive: f.loanActive,
        }
      : null,
    note:
      b &&
      f &&
      b.shareSource === "legacy-reported" &&
      f.shareSource &&
      f.shareSource !== "legacy-reported"
        ? "denominator/semantics differ: Fix06 legacy-reported vs Fix07 opportunity share"
        : null,
  };
});

const comparison = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  fix06Sha: FIX06_SHA,
  finalSha,
  headAtRun: headSha,
  productionTreeClean: !dirty,
  testedSourceNote:
    finalSha === headSha && !dirty
      ? "finalSha equals clean HEAD; cohort ran against this checkout"
      : "finalSha is the explicit tested commit (FIX07_FINAL_SHA); verify checkout matches before trusting",
  commands: [
    `ROOT=<fix06-tree> FIX07_BASELINE_OUT=baseline-fix06.json node baseline/Fix07BaselineCohortRunner.mjs`,
    `ROOT=<final> FIX07_BASELINE_OUT=baseline-final.json node baseline/Fix07BaselineCohortRunner.mjs`,
  ],
  baseSummary: base.summary,
  finalSummary: final.summary,
  initialFixtures: final.initialFixtures,
  periodCount: periods.length,
  periods,
};
writeFileSync(join(outDir, "comparison.json"), JSON.stringify(comparison, null, 2));
writeFileSync(
  join(outDir, "README.md"),
  `# Fix 07 baseline-compatible comparison

- Fix 06 modules: \`${FIX06_SHA}\` (extracted tree, corrected harness only)
- Final: \`${finalSha}\`
- HEAD at run: \`${headSha}\`
- Production/harness tree clean: ${!dirty}
- Initial employed careers: 12 / 12 (matched)
- Periods: ${periods.length}

\`legacyReportedShare\` is the Fix 06 API finite share without assessment.source.
\`opportunityShare\` is Fix 07 opportunity-capacity assessment.
Do not treat a null Fix 06 mean versus a Fix 07 mean as a measured exposure improvement without an external like-for-like oracle.
`
);

rmSync(tar, { force: true });
rmSync(baseExtract, { recursive: true, force: true });
console.log(JSON.stringify({ outDir, base: base.summary, final: final.summary, periods: periods.length }, null, 2));
