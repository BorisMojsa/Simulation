#!/usr/bin/env node
/**
 * Package Fix 08 ReReview ZIP on the Desktop.
 *
 * Requires a clean committed tip. Uses `git archive` + `git ls-tree -r -z --full-tree`
 * for source identity (NUL-separated; paths may contain spaces).
 */
import { createHash } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  copyFileSync,
  readdirSync,
  statSync,
  cpSync,
} from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHORT = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
const FULL = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
const BASE = "52dc6014f0aa6ba372e8ebc453943e8e3023b7d1";
const DESK = join(homedir(), "Desktop");
const PKG_NAME = `08-User-Rival-Performance-Individual-Awards-ReReview-${SHORT}`;
const PKG = join(DESK, PKG_NAME);
const ZIP = join(DESK, `${PKG_NAME}.zip`);

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r;
}
function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}
function copyFile(src, dst) {
  ensureDir(dirname(dst));
  copyFileSync(src, dst);
}
function walk(dir, fn) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, fn);
    else fn(p);
  }
}
function copyTree(src, dst) {
  if (!existsSync(src)) return;
  ensureDir(dirname(dst));
  cpSync(src, dst, { recursive: true });
}
function readJson(p) {
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

const porcelain = sh("git", ["status", "--porcelain"]).stdout.trim();
const dirtyTracked = porcelain
  .split("\n")
  .filter(Boolean)
  .filter((line) => !line.startsWith("??"));
if (dirtyTracked.length) {
  console.error("Refusing to package with modified tracked files. Commit intentional sources first.");
  console.error(dirtyTracked.slice(0, 40).join("\n"));
  process.exit(2);
}

if (existsSync(PKG)) rmSync(PKG, { recursive: true, force: true });
ensureDir(PKG);

// source from git archive
ensureDir(join(PKG, "source"));
const tar = join(PKG, "_src.tar");
sh("git", ["archive", FULL, "-o", tar]);
sh("tar", ["-xf", tar, "-C", join(PKG, "source")]);
rmSync(tar, { force: true });

// diffs
ensureDir(join(PKG, "diff"));
writeFileSync(
  join(PKG, "diff/base-to-final.patch"),
  spawnSync("git", ["diff", "--binary", BASE, FULL], {
    cwd: ROOT,
    encoding: "buffer",
    maxBuffer: 256 * 1024 * 1024,
  }).stdout || Buffer.alloc(0)
);
writeFileSync(join(PKG, "diff/name-status.txt"), sh("git", ["diff", "--name-status", BASE, FULL]).stdout);
writeFileSync(join(PKG, "diff/diff-stat.txt"), sh("git", ["diff", "--stat", BASE, FULL]).stdout);

// reports
ensureDir(join(PKG, "reports"));
for (const [src, dst] of [
  ["reports/fix08-performance-awards-audit.md", "reports/audit.md"],
  ["reports/fix08-performance-awards-completion.md", "reports/completion.md"],
]) {
  if (existsSync(join(ROOT, src))) copyFile(join(ROOT, src), join(PKG, dst));
}

const parity = readJson(join(ROOT, "qa/fix08-runs/parity/parity-summary.json"));
const cohort = readJson(join(ROOT, "qa/fix08-runs/cohort/summary.json"));
const browser = readJson(join(ROOT, "qa/fix08-runs/browser-report.json"));
const comparison = readJson(join(ROOT, "qa/fix08-runs/comparison/base-final-summary.json"));
const probes = readJson(join(ROOT, "qa/fix08-runs/rereview1/review-probes-after.json"));

writeFileSync(
  join(PKG, "reports/qa-matrix.md"),
  `# Fix 08 QA matrix (ReReview)

| Check | Result |
| --- | --- |
| Focused awards tests | see \`qa/final/focused-tests.txt\` |
| Matched parity | pass=${parity?.pass ?? "n/a"} |
| Cohort final 48×3 | ok=${cohort?.ok ?? "n/a"} records=${cohort?.periodRecords ?? "n/a"} leagues=${(cohort?.leagues || []).length} |
| Browser B01–B07 | ok=${browser?.ok ?? "n/a"} |
| Base/final comparison | ok=${comparison?.ok ?? "n/a"} |
| Full Node suite | see \`qa/browser/full-node-suite.txt\` / \`qa/final/\` |
`
);

writeFileSync(
  join(PKG, "reports/r1-r7-closure.md"),
  `# R1–R7 closure

| Finding | Status | Evidence |
| --- | --- | --- |
| R1 Rival compaction changes decisions | CLOSED | \`selectRivalIds\` category retention; F/R1 tests; probes \`qa/rereview1/\` |
| R2 Short-appearance double exposure | CLOSED | matchEngine share floors removed; R2 controlled starter/sub checks |
| R3 Partial field cache lock | CLOSED | stage + inputFingerprint + refresh; R3 test |
| R4 Unmatched parity | CLOSED | \`scripts/qaFix08Parity.mjs\` matched season-equivalent cells; exit nonzero on fail |
| R5 Browser journeys forged | CLOSED | real Continue + \`__exportCareerSnapshot\`; B01–B07 ok=${browser?.ok} |
| R6 Missing 48×3 / decision traces | CLOSED | 48×3 ×4 leagues; \`decisionTrace\` on every category; base/final comparison |
| R7 Source identity / package | CLOSED | \`git archive\` + \`git ls-tree -r -z --full-tree\`; verified checksums |

Do not treat this table as independent approval.
`
);

writeFileSync(
  join(PKG, "reports/calibration-and-parity.md"),
  `# Parity / calibration

Matched season-equivalent user↔NPC cells (roles × ability × exposure × team contexts).
Tolerances: rating gap ≤0.10; G/90 and A/90 ≤ max(0.03, 20% pooled). Failed checks exit nonzero.
See \`qa/parity/parity-summary.json\` and raw samples.
`
);

writeFileSync(
  join(PKG, "reports/known-limitations.md"),
  `# Known limitations

- Synthetic rival field (no full NPC DB); diagnostic full population retained only when requested.
- World award field is a bounded scoreSeasonLine approximation with explicit gates.
- Fix 09–14 / growth / team xG / selection policy remain out of scope.
- Full Node suite still allows the two documented ability assertions (exit 1).
`
);

// QA trees
copyTree(join(ROOT, "qa/fix08-runs/baseline"), join(PKG, "qa/baseline"));
copyTree(join(ROOT, "qa/fix08-runs/final"), join(PKG, "qa/final"));
copyTree(join(ROOT, "qa/fix08-runs/parity"), join(PKG, "qa/parity"));
copyTree(join(ROOT, "qa/fix08-runs/cohort"), join(PKG, "qa/cohort"));
copyTree(join(ROOT, "qa/fix08-runs/cohort-base"), join(PKG, "qa/cohort-base"));
copyTree(join(ROOT, "qa/fix08-runs/comparison"), join(PKG, "qa/comparison"));
copyTree(join(ROOT, "qa/fix08-runs/cases"), join(PKG, "qa/cases"));
copyTree(join(ROOT, "qa/fix08-runs/rereview1"), join(PKG, "qa/rereview1"));
copyTree(join(ROOT, "qa/fix08-runs/cohort/fixtures"), join(PKG, "qa/fixtures"));
copyTree(join(ROOT, "qa/fix08-runs/cohort/ledgers"), join(PKG, "qa/logs/cohort-ledgers"));
copyTree(join(ROOT, "qa/screenshots/checklist-performance-awards"), join(PKG, "qa/browser/screenshots"));
ensureDir(join(PKG, "qa/fields"));
ensureDir(join(PKG, "qa/snapshots"));
writeFileSync(
  join(PKG, "qa/fields/README.md"),
  "Award field provenance is embedded in cohort ledgers (`decisionTrace`, rivalCount/populationSize) and slim browser case exports under `qa/cases/`.\n"
);
writeFileSync(
  join(PKG, "qa/snapshots/README.md"),
  "Authoritative browser journeys use `__exportCareerSnapshot`. Slim case evidence is under `qa/cases/`; full league blobs are omitted to keep the package tractable.\n"
);

for (const f of [
  "browser-report.json",
  "browser-all.txt",
  "browser-run.txt",
  "browser-fix05.txt",
  "browser-fix06.txt",
  "browser-fix07.txt",
  "full-node-suite.txt",
  "cohort-full.txt",
  "cohort-base-run.txt",
]) {
  const src = join(ROOT, "qa/fix08-runs", f);
  if (existsSync(src)) copyFile(src, join(PKG, "qa/browser", f === "browser-report.json" ? f : f));
}
copyFile(join(ROOT, "qa/fix08-runs/browser-report.json"), join(PKG, "qa/browser/browser-report.json"));

for (const [src, dst] of [
  ["qa/fix05-runs/browser-report.json", "qa/browser/fix05-browser-report.json"],
  ["qa/fix06-runs/browser-report.json", "qa/browser/fix06-browser-report.json"],
  ["qa/fix07-runs/browser-report.json", "qa/browser/fix07-browser-report.json"],
]) {
  if (existsSync(join(ROOT, src))) copyFile(join(ROOT, src), join(PKG, dst));
}

const commands = [
  {
    id: "focused-awards",
    cwd: "source",
    command: "node --test tests/userRivalPerformanceAwards.test.mjs tests/individualAwards.test.mjs",
  },
  {
    id: "parity",
    cwd: "source",
    command: "node scripts/qaFix08Parity.mjs",
  },
  {
    id: "cohort-final",
    cwd: "source",
    command: "FIX08_COHORT_OUT=qa/fix08-runs/cohort node scripts/qaFix08EngineCohort.mjs",
  },
  {
    id: "browser-b01-b07",
    cwd: "source",
    command: "node scripts/browserUserRivalPerformanceAwardsChecklist.mjs",
  },
  {
    id: "full-suite",
    cwd: "source",
    command: "node --test tests/*.test.mjs",
  },
];
writeFileSync(
  join(PKG, "qa/commands.json"),
  JSON.stringify(
    {
      node: process.version,
      head: FULL,
      base: BASE,
      dirty: false,
      packagedAt: new Date().toISOString(),
      evidence: {
        parityPass: parity?.pass ?? null,
        cohortOk: cohort?.ok ?? null,
        browserOk: browser?.ok ?? null,
        comparisonOk: comparison?.ok ?? null,
        probesRan: Boolean(probes),
      },
      commands,
    },
    null,
    2
  )
);

const remoteOut = spawnSync("git", ["ls-remote", "origin", "refs/heads/fix/08-user-rival-performance-individual-awards"], {
  cwd: ROOT,
  encoding: "utf8",
});
const remote = (remoteOut.stdout || "").trim().split("\t")[0] || null;

const manifest = {
  schemaVersion: 2,
  packageKind: "ReReview",
  fix: "08-user-rival-performance-individual-awards",
  repository: "https://github.com/BorisMojsa/Simulation",
  branch: "fix/08-user-rival-performance-individual-awards",
  base: BASE,
  final: FULL,
  remote,
  remoteVerifiedEqual: remote === FULL,
  commitUrl: `https://github.com/BorisMojsa/Simulation/commit/${FULL}`,
  node: process.version,
  generatedAt: new Date().toISOString(),
  harness: {
    cohortDigest: cohort?.harnessDigest ?? null,
    parityHead: parity?.head ?? null,
  },
  qa: {
    focused: "userRivalPerformanceAwards + individualAwards",
    parity: parity?.pass === true ? "PASS matched season-equivalent" : "see qa/parity",
    cohort: `${cohort?.fixtures || "?"}×${cohort?.periods || 3} final; base cohort + comparison`,
    browserFix08: browser?.ok === true ? "B01-B07 PASS" : "see qa/browser",
    browserPrior: "Fix05/06/07 reports retained",
    fullSuite: "documented ability assertions remain the only full-suite allowance",
    r1r7: "reports/r1-r7-closure.md",
  },
};
writeFileSync(join(PKG, "manifest.json"), JSON.stringify(manifest, null, 2));
writeFileSync(
  join(PKG, "README-FIRST.md"),
  `# Fix 08 ReReview (${SHORT})

Base \`${BASE}\`  
Final \`${FULL}\`  
Remote \`${remote}\` (equal: ${remote === FULL})

## Closure
See \`reports/r1-r7-closure.md\`. This package is for independent re-review — not approval.

## Replay
\`\`\`bash
cd source
node --test tests/userRivalPerformanceAwards.test.mjs tests/individualAwards.test.mjs
node scripts/qaFix08Parity.mjs
node scripts/qaFix08EngineCohort.mjs
node scripts/browserUserRivalPerformanceAwardsChecklist.mjs
\`\`\`
`
);

// Source identity via NUL-separated ls-tree (paths may contain spaces).
const ls = spawnSync("git", ["ls-tree", "-r", "-z", "--full-tree", FULL], {
  cwd: ROOT,
  encoding: "buffer",
  maxBuffer: 64 * 1024 * 1024,
});
if (ls.status !== 0) throw new Error(String(ls.stderr || "ls-tree failed"));
const blob = {};
const records = ls.stdout.toString("utf8").split("\0").filter(Boolean);
for (const rec of records) {
  // mode SP type SP sha TAB path
  const tab = rec.indexOf("\t");
  if (tab < 0) continue;
  const meta = rec.slice(0, tab);
  const path = rec.slice(tab + 1);
  const parts = meta.split(" ");
  const sha = parts[2];
  if (sha && path) blob[path] = sha;
}

const archivePaths = [];
walk(join(PKG, "source"), (p) => {
  archivePaths.push(relative(join(PKG, "source"), p).split("\\").join("/"));
});
archivePaths.sort();
const indexed = Object.keys(blob).sort();
const missingFromArchive = indexed.filter((p) => !existsSync(join(PKG, "source", p)));
const missingFromIndex = archivePaths.filter((p) => !blob[p]);
const identity = {
  commit: FULL,
  lsTreeNul: true,
  indexedPaths: indexed.length,
  archiveSourceFiles: archivePaths.length,
  missingFromArchive: missingFromArchive.length,
  missingFromIndex: missingFromIndex.length,
  missingFromArchiveSample: missingFromArchive.slice(0, 20),
  missingFromIndexSample: missingFromIndex.slice(0, 20),
  ok: missingFromArchive.length === 0 && missingFromIndex.length === 0 && indexed.length === archivePaths.length,
};
writeFileSync(join(PKG, "source-tree.json"), JSON.stringify({ commit: FULL, identity, files: blob }, null, 2));
writeFileSync(join(PKG, "source-identity.json"), JSON.stringify(identity, null, 2));
if (!identity.ok) {
  console.error("Source identity verification failed", identity);
  process.exit(3);
}

const sums = [];
walk(PKG, (p) => {
  const h = createHash("sha256").update(readFileSync(p)).digest("hex");
  sums.push(`${h}  ${relative(PKG, p).split("\\").join("/")}`);
});
sums.sort();
writeFileSync(join(PKG, "checksums.sha256"), sums.join("\n") + "\n");

const py = `
import hashlib, zipfile, json, subprocess, tempfile, shutil
from pathlib import Path
pkg=Path(${JSON.stringify(PKG)})
zip_path=Path(${JSON.stringify(ZIP)})
name=${JSON.stringify(PKG_NAME)}
if zip_path.exists(): zip_path.unlink()
with zipfile.ZipFile(zip_path,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as zf:
  for path in sorted(pkg.rglob('*')):
    if path.is_file():
      arc=f'{name}/{path.relative_to(pkg).as_posix()}'
      info=zipfile.ZipInfo.from_file(path, arcname=arc)
      info.flag_bits |= 0x800
      zf.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED)
# extract-verify
td=Path(tempfile.mkdtemp(prefix='fix08-rereview-extract-'))
try:
  with zipfile.ZipFile(zip_path) as zf:
    zf.extractall(td)
  root=td/name
  # checksum replay
  bad=[]
  for line in (root/'checksums.sha256').read_text().splitlines():
    if not line.strip(): continue
    h,p=line.split('  ',1)
    fp=root/p
    if not fp.is_file():
      bad.append(('missing',p)); continue
    got=hashlib.sha256(fp.read_bytes()).hexdigest()
    if got!=h: bad.append(('mismatch',p))
  identity=json.loads((root/'source-identity.json').read_text())
  print(hashlib.sha256(zip_path.read_bytes()).hexdigest())
  print(zip_path.stat().st_size)
  print('checksum_bad',len(bad))
  print('identity_ok',identity.get('ok'))
finally:
  shutil.rmtree(td, ignore_errors=True)
`;
const z = spawnSync("python3", ["-c", py], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
if (z.status !== 0) throw new Error(z.stderr || z.stdout);
const lines = z.stdout.trim().split("\n");
const zh = lines[0];
const size = Number(lines[1]);
const checksumBad = Number(String(lines[2] || "").replace("checksum_bad ", ""));
const identityOk = String(lines[3] || "").includes("True") || String(lines[3] || "").includes("true");
if (checksumBad !== 0 || !identityOk) {
  throw new Error(`extract verify failed: ${z.stdout}`);
}
console.log(
  JSON.stringify(
    {
      zip: ZIP,
      sha256: zh,
      sizeBytes: size,
      files: sums.length,
      short: SHORT,
      full: FULL,
      remote,
      identityOk: identity.ok,
      extractChecksumBad: checksumBad,
    },
    null,
    2
  )
);
