#!/usr/bin/env node
/**
 * Direct ZIP packaging for Fix 12 (no persistent sibling review folder).
 *
 *   FIX12_REVIEW_ZIP=/abs/path/file.zip node scripts/packageFix12Review.mjs --zip "$FIX12_REVIEW_ZIP"
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assessPackageEvidence,
  computeSourceManifest,
  EVIDENCE_SCHEMA,
  listFiles,
  readJson,
  sha256Buffer,
  sha256File,
  TESTED_SOURCE_PATHS,
} from "./lib/fix12ReviewEvidence.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

const git = (args) =>
  spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const full = git(["rev-parse", "HEAD"]).stdout.trim();
const short = full.slice(0, 8);
const dirtyTracked = git(["status", "--short", "--untracked-files=no"])
  .stdout.split("\n")
  .map((l) => l.trimEnd())
  .filter((l) => l && !/\sqa\/fix(09|10|11)-runs\//.test(l))
  .join("\n")
  .trim();
if (dirtyTracked) {
  console.error("Refusing to package with uncommitted tracked changes:\n" + dirtyTracked);
  process.exit(1);
}

const defaultZip = join(
  homedir(),
  "Downloads",
  `12-Tournament-Presentation-Win-Totals-ReReview-${short}.zip`
);
const zipPath = resolve(argValue("--zip") || process.env.FIX12_REVIEW_ZIP || defaultZip);
if (existsSync(zipPath) && process.env.FIX12_REVIEW_REPLACE !== "1") {
  console.error(`Refusing to overwrite existing artifact: ${zipPath}`);
  process.exit(1);
}

const remote = git(["ls-remote", "origin", "refs/heads/fix/12-tournament-presentation-win-totals"]);
const remoteSha = (remote.stdout || "").split(/\s+/)[0] || null;
const baseSha = "fa1445c731335e20d21f93cc412f451d2c77889d";

const qaRoot = join(ROOT, "qa/fix12-runs");
const requiredEvidence = [
  "final/case-index.json",
  "final/fixtures/f01-campaign.json",
  "final/fixtures/f01-career-snapshot.json",
  "final/gameplay-parity/parity-result.json",
  "final/logs/tournamentPresentation.test.log",
  "browser/browser-report.json",
  "full-suite.txt",
  "focused-regression.txt",
];
for (const rel of requiredEvidence) {
  if (!existsSync(join(qaRoot, rel))) {
    console.error(`Missing required evidence: qa/fix12-runs/${rel}`);
    process.exit(1);
  }
}

// Build in-memory file map then write ZIP via Python (stdlib zipfile) — no persistent extract tree.
const files = new Map(); // path -> Buffer

function put(path, buf) {
  files.set(path.replace(/\\/g, "/"), Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
}
function putText(path, text) {
  put(path, Buffer.from(String(text), "utf8"));
}
function putJson(path, obj) {
  putText(path, JSON.stringify(obj, null, 2));
}

// Committed source via git archive stream listing
const ls = git(["ls-tree", "-r", "--name-only", "HEAD"]);
if (ls.status !== 0) {
  console.error(ls.stderr);
  process.exit(1);
}
const tracked = ls.stdout.split("\n").filter(Boolean);
const omitPrefixes = ["qa/fix09-runs/", "qa/fix10-runs/", "qa/fix11-runs/", "qa/screenshots/", "baseline/"];
/** Bounded maintained-suite inputs required under source/ (R3). Keep bulk calibration trees excluded. */
const suiteInputAllowlist = new Set([
  "qa/fix09-runs/final/full-suite.log",
  "qa/fix10-runs/calibration-targets.json",
  "qa/fix11-runs/plan.json",
  "qa/fix11-runs/witnesses/index.json",
  "qa/fix11-runs/witnesses/natural-99/career.json",
  "qa/fix11-runs/witnesses/plus6-plus7/career-plus6.json",
  "qa/fix11-runs/witnesses/plus6-plus7/career-plus7.json",
  ...Array.from({ length: 20 }, (_, i) => `qa/fix11-runs/cases/F${String(i + 1).padStart(2, "0")}.json`),
]);
const sourceEntries = [];
for (const rel of tracked) {
  const allowedQa = suiteInputAllowlist.has(rel) || rel.startsWith("qa/findings/");
  if (rel.startsWith("qa/") && !allowedQa) continue;
  if (!allowedQa && omitPrefixes.some((p) => rel.startsWith(p))) continue;
  const blob = spawnSync("git", ["cat-file", "blob", `HEAD:${rel}`], {
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (blob.status !== 0) continue;
  const buf = blob.stdout;
  put(`source/${rel}`, buf);
  const gitBlob = git(["rev-parse", `HEAD:${rel}`]).stdout.trim();
  sourceEntries.push({
    path: rel,
    sha256: sha256Buffer(buf),
    gitBlobId: gitBlob,
  });
}
for (const rel of suiteInputAllowlist) {
  if (sourceEntries.some((e) => e.path === rel)) continue;
  console.error(`Missing required suite input in commit: ${rel}`);
  process.exit(1);
}

const sourceManifest = computeSourceManifest(sourceEntries);
putJson("source-content-manifest.json", {
  ...sourceManifest,
  finalSha: full,
  omittedPrefixes: omitPrefixes,
  suiteInputAllowlist: [...suiteInputAllowlist],
  omittedReason:
    "Historical bulk QA/calibration trees excluded; bounded Fix 09/10/11 suite inputs allowlisted under source/.",
});

// Evidence under qa/fix12/
const evidenceKeep = [
  "final",
  "browser",
  "baseline",
  "full-suite.txt",
  "focused-regression.txt",
  "logs",
];
for (const name of evidenceKeep) {
  const abs = join(qaRoot, name);
  if (!existsSync(abs)) continue;
  if (statIsFile(abs)) {
    put(`qa/fix12/${name}`, readFileSync(abs));
  } else {
    for (const rel of listFiles(abs)) {
      // Skip large screenshots optionally? Include screenshots for browser evidence.
      put(`qa/fix12/${name}/${rel}`, readFileSync(join(abs, rel)));
    }
  }
}

function statIsFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

// Reports
for (const rel of ["reports/fix12-tournament-presentation-audit.md", "reports/fix12-tournament-presentation-completion.md"]) {
  const abs = join(ROOT, rel);
  if (existsSync(abs)) put(rel, readFileSync(abs));
}

// Diff
const diff = spawnSync(
  "git",
  ["diff", "--binary", `${baseSha}...HEAD`],
  { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }
);
put("diff/base-to-final.patch", diff.stdout);
putText(
  "diff/changed-paths.txt",
  spawnSync("git", ["diff", "--name-status", `${baseSha}...HEAD`], { cwd: ROOT, encoding: "utf8" }).stdout
);

const caseIndex = readJson(join(qaRoot, "final/case-index.json"));
const browserReport = readJson(join(qaRoot, "browser/browser-report.json"));
const f01Fixture = readJson(join(qaRoot, "final/fixtures/f01-campaign.json"));
const presentationLog = readFileSync(join(qaRoot, "final/logs/tournamentPresentation.test.log"), "utf8");
const fullSuiteLog = readFileSync(join(qaRoot, "full-suite.txt"), "utf8");
const gameplayParity = readJson(join(qaRoot, "final/gameplay-parity/parity-result.json"));

// Prove maintained suite from a fresh copy of packaged source bytes (R3).
const suiteTmp = mkdtempSync(join(tmpdir(), "fix12-suite-"));
let packagedSuiteProof;
try {
  for (const [path, buf] of files) {
    if (!path.startsWith("source/")) continue;
    const abs = join(suiteTmp, path.slice("source/".length));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, buf);
  }
  const suite = spawnSync("node", ["--test", "tests/*.test.mjs"], {
    cwd: suiteTmp,
    encoding: "utf8",
    shell: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  writeFileSync(join(qaRoot, "packaged-suite.log"), suite.stdout + suite.stderr);
  const pass = Number((suite.stdout.match(/# pass (\d+)/) || [])[1] || 0);
  const fail = Number((suite.stdout.match(/# fail (\d+)/) || [])[1] || 0);
  packagedSuiteProof = {
    exitStatus: suite.status,
    pass,
    fail,
    skipped: Number((suite.stdout.match(/# skipped (\d+)/) || [])[1] || 0),
    ranFrom: "fresh-temp-extraction-of-packaged-source",
  };
  putJson("qa/fix12/packaged-suite-proof.json", packagedSuiteProof);
  put("qa/fix12/packaged-suite.log", Buffer.from(suite.stdout + suite.stderr));
  if (suite.status !== 0 || pass !== 246 || fail !== 0) {
    console.error("Packaged source suite failed:", packagedSuiteProof);
    process.exit(1);
  }
} finally {
  rmSync(suiteTmp, { recursive: true, force: true });
}

const testedSourceFingerprint = Object.fromEntries(
  TESTED_SOURCE_PATHS.map((p) => {
    const row = sourceManifest.files.find((f) => f.path === p);
    return [p, row?.sha256 || null];
  })
);

const assessment = assessPackageEvidence({
  manifest: {
    finalSha: full,
    baseSha,
    acceptedBaseSha: baseSha,
    remoteSha,
    testedSourceFingerprint,
  },
  caseIndex,
  browserReport,
  f01Fixture,
  presentationTestLog: presentationLog,
  fullSuiteLog,
  gameplayParity,
  sourceManifest,
  packagedSuiteProof,
});
if (!assessment.ok) {
  console.error("Pre-package assessment failed:", assessment.problems);
  process.exit(1);
}

const nodeV = spawnSync("node", ["--version"], { encoding: "utf8" }).stdout.trim();
const manifest = {
  schema: EVIDENCE_SCHEMA,
  repository: "https://github.com/BorisMojsa/Simulation",
  branch: "fix/12-tournament-presentation-win-totals",
  acceptedBaseSha: baseSha,
  finalSha: full,
  remoteSha,
  testedSourceFingerprint,
  environment: { node: nodeV, packagedAt: new Date().toISOString() },
  requiredCaseIds: [
    ...Array.from({ length: 18 }, (_, i) => `F${String(i + 1).padStart(2, "0")}`),
    ...Array.from({ length: 8 }, (_, i) => `B${String(i + 1).padStart(2, "0")}`),
  ],
  assessment,
};
putJson("manifest.json", manifest);

putText(
  "README-REVIEW.md",
  `# Fix 12 — Tournament presentation and win totals

**Outcome:** READY FOR INDEPENDENT REVIEW (local QA + package gates)

| Item | Value |
| --- | --- |
| Branch | \`fix/12-tournament-presentation-win-totals\` |
| Base | \`${baseSha}\` |
| Final | \`${full}\` |
| Remote | \`${remoteSha || "(push before packaging)"}\` |
| Focused presentation tests | 19 pass |
| Full suite | see \`qa/fix12/full-suite.txt\` |
| Browser B01–B08 | ${browserReport.pass} pass / ${browserReport.fail} fail |
| Gameplay parity | national=${gameplayParity.nationalParity} continental=${gameplayParity.continentalParity} |

## Rerun

\`\`\`bash
node --test tests/tournamentPresentation.test.mjs
node --test tests/*.test.mjs
node scripts/qaTournamentPresentation.mjs --out qa/fix12-runs/final
node scripts/browserTournamentPresentationChecklist.mjs
node scripts/verifyFix12Review.mjs --zip /path/to/this.zip
\`\`\`

Standalone verifier inside the archive:

\`\`\`bash
node verify-package.mjs
\`\`\`

## Working directory

Packaged application source lives under \`source/\`. From an extraction:

\`\`\`bash
cd source
node --test tests/*.test.mjs
\`\`\`

Upload this ZIP to ChatGPT for independent review. No separate extracted folder is required for the handoff.
`
);

// Standalone verifier at archive root (imports ./lib/…)
put("verify-package.mjs", readFileSync(join(ROOT, "scripts/verifyFix12Review.mjs")));
put("lib/fix12ReviewEvidence.mjs", readFileSync(join(ROOT, "scripts/lib/fix12ReviewEvidence.mjs")));
put("scripts/lib/fix12ReviewEvidence.mjs", readFileSync(join(ROOT, "scripts/lib/fix12ReviewEvidence.mjs")));
put("scripts/verifyFix12Review.mjs", readFileSync(join(ROOT, "scripts/verifyFix12Review.mjs")));

// SHA256SUMS for all files except itself
const sums = {};
for (const [path, buf] of [...files.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  sums[path] = sha256Buffer(buf);
}
putJson("SHA256SUMS.json", sums);

// Write ZIP via temporary Python script (no persistent package dir)
mkdirSync(dirname(zipPath), { recursive: true });
const staging = mkdtempSync(join(tmpdir(), "fix12-zip-"));
try {
  const listPath = join(staging, "files.json");
  const payload = {};
  for (const [path, buf] of files) {
    const abs = join(staging, "payload", path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, buf);
    payload[path] = abs;
  }
  writeFileSync(listPath, JSON.stringify(payload));
  const py = `
import json, zipfile, sys
files = json.load(open(${JSON.stringify(listPath)}))
zip_path = ${JSON.stringify(zipPath)}
with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as z:
    for arc, src in sorted(files.items()):
        z.write(src, arcname=arc)
print(zip_path)
`;
  const pyFile = join(staging, "make_zip.py");
  writeFileSync(pyFile, py);
  const made = spawnSync("python3", [pyFile], { encoding: "utf8" });
  if (made.status !== 0) {
    console.error(made.stderr || made.stdout);
    process.exit(1);
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}

const zipHash = sha256File(zipPath);
const zipStat = statSync(zipPath);
console.log(
  JSON.stringify(
    {
      zip: zipPath,
      bytes: zipStat.size,
      sha256: zipHash,
      finalSha: full,
      remoteSha,
      assessment,
    },
    null,
    2
  )
);
writeFileSync(join(ROOT, "qa/fix12-runs/package-handoff.json"), JSON.stringify({
  zip: zipPath,
  bytes: zipStat.size,
  sha256: zipHash,
  finalSha: full,
  remoteSha,
  packagedAt: new Date().toISOString(),
}, null, 2));
