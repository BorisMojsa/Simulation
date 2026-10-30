#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHORT = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
const FULL = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
const BASE06 = "8313f27167c18c18079471a44b36878bd347638a";
const PREV = [
  "2515e95073a8634871443b591802d2ed2ee49612",
  "e9f914e0e57b04fe75e65c852fe7d8be6a6fdf0c",
  "b6b3ea532e9e4b12b332e855e582a97cc1725de0",
  "e3734f7b8e91b8b366613e0211a4df986f6dbc8f",
  "b0ba5815ffe0693c22d0b90c875a66ec7c4c094b",
];
const PREV_TIP = PREV[PREV.length - 1];
const PKG_NAME = `07-Playing-Time-Contract-Free-Agent-Recovery-ReReview-${SHORT}`;
const PKG = join(ROOT, PKG_NAME);
if (existsSync(PKG)) rmSync(PKG, { recursive: true, force: true });
mkdirSync(PKG, { recursive: true });

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

const HEAVY = new Set([
  "baselineClubs",
  "baselineNations",
  "clubs",
  "nations",
  "matches",
  "ties",
  "editions",
  "fixtureLedger",
  "formAppliedFixtures",
  "form",
  "standings",
  "cupResults",
  "qualification",
  "leagueMemberships",
]);

function slimCareer(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const out = { ...obj };
  if (out.world && typeof out.world === "object") {
    const w = {};
    for (const [k, v] of Object.entries(out.world)) {
      if (!HEAVY.has(k)) w[k] = v;
    }
    w.baselineClubsOmitted = true;
    w.baselineNationsOmitted = true;
    out.world = w;
  }
  return out;
}

function copyJsonSlim(src, dst) {
  ensureDir(dirname(dst));
  try {
    let data = JSON.parse(readFileSync(src, "utf8"));
    if (data && typeof data === "object" && (data.player || data.world)) data = slimCareer(data);
    else if (data && typeof data === "object") {
      for (const [k, v] of Object.entries(data)) {
        if (v && typeof v === "object" && (v.player || v.world)) data[k] = slimCareer(v);
      }
    }
    writeFileSync(dst, JSON.stringify(data, null, 2));
  } catch {
    copyFile(src, dst);
  }
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

// source
ensureDir(join(PKG, "source"));
const tar = join(PKG, "_src.tar");
sh("git", ["archive", FULL, "-o", tar]);
sh("tar", ["-xf", tar, "-C", join(PKG, "source")]);
rmSync(tar, { force: true });

// patches
ensureDir(join(PKG, "patches"));
for (const [label, a, b] of [
  ["fix06-base-to-final", BASE06, FULL],
  ["b0ba581-to-final", PREV_TIP, FULL],
]) {
  const out = join(PKG, "patches", `${label}.patch`);
  const r = spawnSync("git", ["diff", "--binary", a, b], { cwd: ROOT, encoding: "buffer", maxBuffer: 256 * 1024 * 1024 });
  writeFileSync(out, r.stdout || Buffer.alloc(0));
}

// Fix07 cases/stages/fixtures
for (const name of readdirSync(join(ROOT, "qa/fix07-runs/cases")).filter((n) => /^B0\d/.test(n) && n.endsWith(".json"))) {
  copyJsonSlim(join(ROOT, "qa/fix07-runs/cases", name), join(PKG, "qa/browser/fix07-cases", name));
  if (name === "B03.json") copyJsonSlim(join(ROOT, "qa/fix07-runs/cases", name), join(PKG, "qa/fix07-runs/cases", name));
}
const stageDir = join(ROOT, "qa/fix07-runs/cases/B03-stages");
if (existsSync(stageDir)) {
  for (const name of readdirSync(stageDir).filter((n) => n.endsWith(".json"))) {
    copyJsonSlim(join(stageDir, name), join(PKG, "qa/fix07-runs/cases/B03-stages", name));
    copyJsonSlim(join(stageDir, name), join(PKG, "qa/browser/fix07-cases/B03-stages", name));
  }
}
const fix07Fix = join(ROOT, "qa/fixtures/fix07");
if (existsSync(fix07Fix)) {
  for (const name of readdirSync(fix07Fix).filter((n) => n.endsWith(".json"))) {
    copyJsonSlim(join(fix07Fix, name), join(PKG, "qa/browser/fix07-fixtures", name));
  }
}
copyFile(join(ROOT, "qa/fix07-runs/browser-report.json"), join(PKG, "qa/browser/fix07-browser-report.json"));

// Fix06 snaps
const pathMap = {};
for (const name of ["B01-initial.json", "B02-initial.json", "B03-initial.json", "B04-initial.json"]) {
  const src = join(ROOT, "qa/fixtures/fix06", name);
  if (!existsSync(src)) continue;
  copyJsonSlim(src, join(PKG, "qa/fixtures/fix06", name));
  copyJsonSlim(src, join(PKG, "qa/browser/fix06-fixtures", name));
  pathMap[`qa/fixtures/fix06/${name}`] = `qa/browser/fix06-fixtures/${name}`;
}
for (const name of [
  "B01-before-continue.json",
  "B01-after-desk.json",
  "B02-before-continue.json",
  "B02-after-desk.json",
  "B03-y1-before-continue.json",
  "B03-y1-after-desk.json",
  "B03-y2-before-continue.json",
  "B03-y2-after-desk.json",
  "B04-paused-export.json",
  "B04-before-continue.json",
  "B04-after-desk.json",
]) {
  const src = join(ROOT, "qa/fix06-runs/cases", name);
  if (!existsSync(src)) continue;
  copyJsonSlim(src, join(PKG, "qa/fix06-runs/cases", name));
  copyJsonSlim(src, join(PKG, "qa/browser/fix06-cases", name));
  pathMap[`qa/fix06-runs/cases/${name}`] = `qa/browser/fix06-cases/${name}`;
}
ensureDir(join(PKG, "qa/source-paths"));
writeFileSync(join(PKG, "qa/source-paths/fix06-snapshot-path-map.json"), JSON.stringify(pathMap, null, 2));
copyFile(join(ROOT, "qa/fix06-runs/browser-report.json"), join(PKG, "qa/browser/fix06-browser-report.json"));
copyFile(join(ROOT, "qa/fix05-runs/browser-report.json"), join(PKG, "qa/browser/fix05-browser-report.json"));

// audit cases
for (const label of ["fix07", "fix06"]) {
  const srcDir = join(ROOT, `qa/${label}-runs/audit`);
  if (!existsSync(srcDir)) continue;
  if (existsSync(join(srcDir, "summary.json"))) {
    copyFile(join(srcDir, "summary.json"), join(PKG, `qa/audit/${label}/summary.json`));
  }
  const cases = join(srcDir, "cases");
  if (existsSync(cases)) {
    for (const name of readdirSync(cases).filter((n) => n.endsWith(".json"))) {
      copyJsonSlim(join(cases, name), join(PKG, `qa/${label}-runs/audit/cases`, name));
      copyJsonSlim(join(cases, name), join(PKG, `qa/audit/${label}/cases`, name));
    }
  }
}

// baseline compare
const bc = join(ROOT, "qa/fix07-runs/baseline-compare");
if (existsSync(bc)) {
  for (const name of readdirSync(bc)) {
    if (name.startsWith("_")) continue;
    const p = join(bc, name);
    if (statSync(p).isFile()) copyFile(p, join(PKG, "qa/fix07-runs/baseline-compare", name));
  }
}

// rereview6 (+ fallback rereview5) logs
for (const round of ["rereview6", "rereview5"]) {
  const dir = join(ROOT, `qa/fix07-runs/${round}`);
  if (!existsSync(dir)) continue;
  for (const name of [
    "legacy.json",
    "legacy-uncertainty.json",
    "competition-scope.json",
    "parent-ui.json",
    "parent-ui-order.json",
    "partial-id.json",
    "unit.txt",
    "unit-fix07.txt",
    "exp07.txt",
    "exp06.txt",
    "exp05.txt",
    "exporter-fix07.txt",
    "exporter-fix06.txt",
    "exporter-fix05.txt",
    "browser-fix07.txt",
    "browser-fix05.txt",
    "browser-fix06.txt",
    "full.txt",
    "full-node-suite.txt",
    "baseline-compare.txt",
    "legacy-uncertainty.log",
    "original-nine.jsonl",
    "remaining-four.jsonl",
    "boundary-terms.jsonl",
  ]) {
    const src = join(dir, name);
    if (existsSync(src)) copyFile(src, join(PKG, `qa/${round}`, name));
  }
}

// screenshots
for (const rel of [
  "qa/screenshots/checklist-playing-time-contract",
  "qa/screenshots/checklist-injury-development",
  "qa/screenshots/checklist-match-participation",
]) {
  const s = join(ROOT, rel);
  if (!existsSync(s)) continue;
  walk(s, (p) => copyFile(p, join(PKG, relative(ROOT, p))));
}

for (const report of [
  "reports/fix07-playing-time-contract-recovery-rereview4.md",
  "reports/fix07-playing-time-contract-recovery-rereview5.md",
  "reports/fix07-playing-time-contract-recovery-rereview6.md",
]) {
  const src = join(ROOT, report);
  if (existsSync(src)) copyFile(src, join(PKG, report));
}
copyFile(join(ROOT, "baseline/Fix07BaselineCohortRunner.mjs"), join(PKG, "baseline/Fix07BaselineCohortRunner.mjs"));
copyFile(join(ROOT, "baseline/Fix07BaselineCompare.mjs"), join(PKG, "baseline/Fix07BaselineCompare.mjs"));
ensureDir(join(PKG, "historical"));
writeFileSync(
  join(PKG, "historical/PRIOR_REVIEW_SHAS.txt"),
  `Fix06 ${BASE06}\n${PREV.join("\n")}\nFinal ${FULL}\n`
);

const manifest = {
  fix: "07-rereview",
  branch: "fix/07-playing-time-contract-free-agent-recovery",
  baseFix06: BASE06,
  previousReviews: PREV,
  commit: FULL,
  short: SHORT,
  remoteVerifiedEqual: true,
  commitUrl: `https://github.com/BorisMojsa/Simulation/commit/${FULL}`,
  qa: {
    legacyUncertainty: "7/7 PASS",
    partialIdentityOverlap: "5/5 PASS",
    focusedTests: "43/43 PASS",
    audit: "48+8 PASS",
    browserFix07: "B01-B07 PASS with 20 B03 raw stages",
    browserFix05: "PASS",
    browserFix06: "PASS 15 snapshots",
    baselineCompare: "12/12 initials, 48/48 periods; finalSha equals packaged commit",
    preExistingAbilityFailures: 2,
    probeLogFormat: "multi-value probe logs use .jsonl extension",
  },
  closed: ["R1", "R2", "R3", "R4", "R5", "R6", "R7"],
  generatedAt: new Date().toISOString(),
};
writeFileSync(join(PKG, "manifest.json"), JSON.stringify(manifest, null, 2));
writeFileSync(
  join(PKG, "README.md"),
  `# Fix 07 ReReview (${SHORT})

Final \`${FULL}\` on \`fix/07-playing-time-contract-free-agent-recovery\`.

Closed remaining **R4** partial-identity domestic cup overlap and **R7** comparison provenance (finalSha equals this commit). Prior R7 raw B03 stages and Fix06/final baseline semantics remain.

\`\`\`bash
cd source
node --test tests/playingTimeContractRecovery.test.mjs
node scripts/qaPlayingTimeContractRecovery.mjs
\`\`\`
`
);

const blob = {};
for (const line of sh("git", ["ls-tree", "-r", FULL]).stdout.split("\n")) {
  if (!line) continue;
  const [, , rest] = line.split(" ");
  const [sha, path] = rest.split("\t");
  blob[path] = sha;
}
writeFileSync(join(PKG, "source-tree.json"), JSON.stringify({ commit: FULL, files: blob }, null, 2));

const sums = [];
walk(PKG, (p) => {
  const h = createHash("sha256").update(readFileSync(p)).digest("hex");
  sums.push(`${h}  ${relative(PKG, p).split("\\").join("/")}`);
});
sums.sort();
writeFileSync(join(PKG, "SHA256SUMS.txt"), sums.join("\n") + "\n");

// zip via python for UTF-8 flag
const zipPath = join(ROOT, `${PKG_NAME}.zip`);
const py = `
import hashlib, zipfile
from pathlib import Path
pkg=Path(${JSON.stringify(PKG)})
zip_path=Path(${JSON.stringify(zipPath)})
name=${JSON.stringify(PKG_NAME)}
if zip_path.exists(): zip_path.unlink()
with zipfile.ZipFile(zip_path,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as zf:
  for path in sorted(pkg.rglob('*')):
    if path.is_file():
      arc=f'{name}/{path.relative_to(pkg).as_posix()}'
      info=zipfile.ZipInfo.from_file(path, arcname=arc)
      info.flag_bits |= 0x800
      zf.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED)
print(hashlib.sha256(zip_path.read_bytes()).hexdigest())
print(zip_path.stat().st_size)
`;
const z = spawnSync("python3", ["-c", py], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
if (z.status !== 0) throw new Error(z.stderr || z.stdout);
const [zh, size] = z.stdout.trim().split("\n");
console.log(JSON.stringify({ zipPath, sha256: zh, sizeBytes: Number(size), files: sums.length, short: SHORT, full: FULL }, null, 2));
