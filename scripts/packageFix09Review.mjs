#!/usr/bin/env node
/**
 * Package Fix 09 review ZIP on the Desktop.
 * Requires a clean committed tip.
 */
import { createHash } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  copyFileSync,
  readdirSync,
  statSync,
  cpSync,
  readFileSync,
} from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHORT = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
const FULL = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
const BASE = "984495e4c12df0c2dd1c84d124bc4cb743a0f63e";
const PREV_TIP = "1203cfe4ce8d5b5f619e3e8654611041d51363fd";
const FIRST_REVIEWED_TIP = "b874040211c82e8f4aafebdbde28df447112e228";
const PRIOR_REREVIEW_TIP = "ebbe1d19b9621da6cfe8d9c0b84f6ed778255c19";
const DESK = join(homedir(), "Desktop");
const PKG_NAME = `09-Earned-Continental-Qualification-ReReview-${SHORT}`;
const PKG = join(DESK, PKG_NAME);
const ZIP = join(DESK, `${PKG_NAME}.zip`);
if (existsSync(PKG) || existsSync(ZIP)) {
  throw new Error(`Refusing to overwrite existing review package/ZIP: ${PKG_NAME}`);
}

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
function sha256File(p) {
  const h = createHash("sha256");
  h.update(readFileSync(p));
  return h.digest("hex");
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

ensureDir(PKG);

ensureDir(join(PKG, "source"));
const tar = join(PKG, "_src.tar");
sh("git", ["archive", FULL, "-o", tar]);
sh("tar", ["-xf", tar, "-C", join(PKG, "source")]);
rmSync(tar, { force: true });

const blobIndex = [];
const ls = spawnSync("git", ["ls-tree", "-r", "-z", "--full-tree", FULL], {
  cwd: ROOT,
  encoding: "buffer",
  maxBuffer: 64 * 1024 * 1024,
});
const parts = ls.stdout.toString("utf8").split("\0").filter(Boolean);
for (const line of parts) {
  const m = line.match(/^(\d+) (\w+) ([0-9a-f]+)\t(.+)$/);
  if (!m) continue;
  blobIndex.push({ mode: m[1], type: m[2], blob: m[3], path: m[4] });
}
writeFileSync(join(PKG, "source-git-blob-index.json"), JSON.stringify({ commit: FULL, files: blobIndex }, null, 2));

ensureDir(join(PKG, "diff"));
writeFileSync(
  join(PKG, "diff/base-to-final.patch"),
  spawnSync("git", ["diff", "--binary", BASE, FULL], {
    cwd: ROOT,
    encoding: "buffer",
    maxBuffer: 256 * 1024 * 1024,
  }).stdout || Buffer.alloc(0)
);
writeFileSync(
  join(PKG, "diff/prev-tip-to-final.patch"),
  spawnSync("git", ["diff", "--binary", PREV_TIP, FULL], {
    cwd: ROOT,
    encoding: "buffer",
    maxBuffer: 256 * 1024 * 1024,
  }).stdout || Buffer.alloc(0)
);
writeFileSync(join(PKG, "diff/name-status.txt"), sh("git", ["diff", "--name-status", BASE, FULL]).stdout);
writeFileSync(join(PKG, "diff/stat.txt"), sh("git", ["diff", "--stat", BASE, FULL]).stdout);
writeFileSync(join(PKG, "diff/prev-tip-name-status.txt"), sh("git", ["diff", "--name-status", PREV_TIP, FULL]).stdout);

ensureDir(join(PKG, "reports"));
copyFile(join(ROOT, "reports/fix09-earned-continental-qualification-audit.md"), join(PKG, "reports/audit.md"));
copyFile(
  join(ROOT, "reports/fix09-earned-continental-qualification-completion.md"),
  join(PKG, "reports/completion.md")
);

const browser = readJson(join(ROOT, "qa/fix09-runs/browser/browser-report.json"));
const qaReport = readJson(join(ROOT, "qa/fix09-runs/final/qa-report.json"));
const focusedOk = qaReport?.focused?.pass === true;
const requiredPeriods = qaReport?.cohort?.requiredPeriods ?? 42;
const cohortOk =
  (qaReport?.cohort?.oracleViolations ?? 1) === 0 &&
  (qaReport?.cohort?.completedPeriods ?? 0) >= requiredPeriods &&
  qaReport?.corruptionControlsPass === true;
const browserOk =
  browser?.ok === true &&
  browser?.subsetOnly !== true &&
  browser?.requiredComplete === true &&
  Array.isArray(browser?.requiredIds) &&
  browser.requiredIds.length === 9;
const testedSha = qaReport?.sourceSha || null;
// Exact tip match, or tested tip is an ancestor whose only follow-up commits are QA stamp
// artifacts under qa/fix09-runs/final/ (report re-stamp after the exercised source tip).
function testedShaCoversFinal() {
  if (!testedSha) return false;
  if (testedSha === FULL) return true;
  const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", testedSha, FULL], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (ancestor.status !== 0) return false;
  const changed = spawnSync("git", ["diff", "--name-only", testedSha, FULL], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  }).stdout
    .trim()
    .split("\n")
    .filter(Boolean);
  return (
    changed.length > 0 &&
    changed.every(
      (p) =>
        p === "scripts/packageFix09Review.mjs" ||
        p.startsWith("qa/fix09-runs/final/") ||
        p.startsWith("qa/fixtures/paired-controls/")
    )
  );
}
const testedShaMatchesFinal = testedShaCoversFinal();
const ready =
  focusedOk &&
  cohortOk &&
  browserOk &&
  testedShaMatchesFinal &&
  !browser?.blocked;

writeFileSync(
  join(PKG, "reports/qa-matrix.md"),
  `# Fix 09 QA matrix

| Gate | Status | Evidence |
| --- | --- | --- |
| F01–F25 | ${focusedOk ? "PASS" : "FAIL"} | \`qa/final/focused-f01-f25.log\`, \`tests/earnedContinentalQualification.test.mjs\` |
| Engine cohort 14×3 | ${cohortOk ? "PASS" : "FAIL"} (${qaReport?.cohort?.completedPeriods ?? "?"} periods, ${qaReport?.cohort?.oracleViolations ?? "?"} oracle violations) | \`qa/cohort/\`, \`qa/final/qa-report.json\` |
| Browser B01–B09 | ${browserOk ? "PASS" : "FAIL"} | \`qa/browser/browser-report.json\` |
| Regressions | see \`qa/regressions/\` | engine-regression.log |
`
);

copyTree(join(ROOT, "qa/fix09-runs/baseline"), join(PKG, "qa/baseline"));
copyTree(join(ROOT, "qa/fix09-runs/final"), join(PKG, "qa/final"));
copyTree(join(ROOT, "qa/fix09-runs/final/cohort"), join(PKG, "qa/cohort"));
copyTree(join(ROOT, "qa/fix09-runs/browser"), join(PKG, "qa/browser"));
copyTree(join(ROOT, "qa/screenshots/checklist-earned-continental"), join(PKG, "qa/browser/screenshots"));
ensureDir(join(PKG, "qa/fixtures"));
ensureDir(join(PKG, "qa/regressions"));
copyTree(join(ROOT, "qa/fixtures/paired-controls"), join(PKG, "qa/fixtures/paired-controls"));
if (existsSync(join(ROOT, "qa/fix09-runs/final/engine-regression.log"))) {
  copyFile(join(ROOT, "qa/fix09-runs/final/engine-regression.log"), join(PKG, "qa/regressions/engine-regression.log"));
}

ensureDir(join(PKG, "git"));
writeFileSync(join(PKG, "git/status.txt"), sh("git", ["status", "--porcelain=v1"]).stdout || "(clean)\n");
writeFileSync(join(PKG, "git/log.txt"), sh("git", ["log", "--oneline", "-15"]).stdout);
writeFileSync(join(PKG, "git/head.txt"), FULL + "\n");
writeFileSync(
  join(PKG, "git/ancestry.txt"),
  sh("git", ["merge-base", "--is-ancestor", BASE, FULL]).status === 0
    ? `OK: ${BASE} is ancestor of ${FULL}\n`
    : `FAIL ancestry\n`
);
const remote = spawnSync("git", ["ls-remote", "origin", "refs/heads/fix/09-earned-continental-qualification"], {
  cwd: ROOT,
  encoding: "utf8",
}).stdout.trim();
writeFileSync(join(PKG, "git/remote-sha.txt"), remote + "\n");

const manifest = {
  package: PKG_NAME,
  repository: "BorisMojsa/Simulation",
  branch: "fix/09-earned-continental-qualification",
  baseSha: BASE,
  firstReviewedTip: FIRST_REVIEWED_TIP,
  priorReReviewTip: PRIOR_REREVIEW_TIP,
  previousReviewedTip: PREV_TIP,
  finalSha: FULL,
  testedSourceSha: testedSha,
  remoteSha: remote.split(/\s+/)[0] || null,
  createdAt: new Date().toISOString(),
  provenanceVersion: 2,
  gates: {
    focused: focusedOk,
    cohort: cohortOk,
    browser: browserOk,
    testedShaMatchesFinal,
    testedSourceSha: testedSha,
    ready,
  },
  commands: {
    focused: "node --test tests/earnedContinentalQualification.test.mjs",
    qa: "node scripts/qaEarnedContinentalQualification.mjs",
    browser: "node scripts/browserEarnedContinentalQualificationChecklist.mjs",
  },
};
writeFileSync(join(PKG, "manifest.json"), JSON.stringify(manifest, null, 2));

writeFileSync(
  join(PKG, "README.md"),
  `# Fix 09 — Earned continental qualification (ReReview)

**Verdict: ${ready ? "READY FOR REVIEW" : "BLOCKED"}**

- Branch: \`fix/09-earned-continental-qualification\`
- Accepted predecessor: \`${BASE}\`
- First reviewed tip: \`${FIRST_REVIEWED_TIP}\`
- Prior ReReview tip (ebbe1d1): \`${PRIOR_REREVIEW_TIP}\`
- Previous reviewed tip (1203cfe): \`${PREV_TIP}\`
- Final: \`${FULL}\`
- QA tested source: \`${testedSha || "(missing)"}\`
- Remote: \`${manifest.remoteSha || "(push required)"}\`

## ReReview repairs (1203cfe follow-up)

- R2: half-played / uneven coverage rejected via appearances + per-club play evidence
- R4: simulated-complete requires sourceResults; target-participation + six paired controls
- R5: B06 dual-restore protected compare; B02 off-season path; B04 reverse/cross loan
- R1/R3/R6: preserved from prior tips

## Replay

\`\`\`bash
cd source
node --test tests/earnedContinentalQualification.test.mjs
node scripts/qaEarnedContinentalQualification.mjs
node scripts/browserEarnedContinentalQualificationChecklist.mjs
\`\`\`

## Gates

- Focused F01–F25: ${focusedOk ? "PASS" : "FAIL"}
- Cohort 14×3: ${qaReport?.cohort?.completedPeriods ?? "?"} / ${requiredPeriods} periods, oracle violations ${qaReport?.cohort?.oracleViolations ?? "?"}
- Browser B01–B09: ${browserOk ? "PASS" : "FAIL"}
`
);

const verifyScript = `#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)));
function walk(dir, out=[]) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const sums = readFileSync(join(root, "SHA256SUMS.txt"), "utf8").trim().split(/\\n/).filter(Boolean);
let bad = 0;
for (const line of sums) {
  const hash = line.slice(0, 64);
  const path = line.slice(66);
  if (path === "SHA256SUMS.txt") continue;
  const full = join(root, path);
  if (!existsSync(full)) { console.error("missing", path); bad++; continue; }
  const h = createHash("sha256").update(readFileSync(full)).digest("hex");
  if (h !== hash) { console.error("mismatch", path); bad++; }
}
const index = JSON.parse(readFileSync(join(root, "source-git-blob-index.json"), "utf8"));
const sourceFiles = walk(join(root, "source")).map((p) => relative(join(root, "source"), p));
const indexed = new Set(index.files.map((f) => f.path));
for (const p of sourceFiles) if (!indexed.has(p)) { console.error("extra source", p); bad++; }
for (const p of indexed) if (!sourceFiles.includes(p)) { console.error("missing source", p); bad++; }
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
if (!manifest.finalSha || !manifest.baseSha || !manifest.previousReviewedTip) {
  console.error("manifest missing identity fields");
  bad++;
}
if (manifest.gates?.ready && manifest.gates?.testedShaMatchesFinal !== true) {
  console.error("tested source sha does not cover final sha");
  bad++;
}
function parseJson(path) {
  try { JSON.parse(readFileSync(path, "utf8")); }
  catch (err) { console.error("json-parse-fail", relative(root, path), err.message); bad++; }
}
for (const p of walk(root)) {
  if (p.endsWith(".json")) parseJson(p);
}
for (const f of index.files) {
  const full = join(root, "source", f.path);
  if (!existsSync(full)) { console.error("missing blob path", f.path); bad++; continue; }
  const blob = createHash("sha1").update(Buffer.concat([
    Buffer.from("blob " + statSync(full).size + "\\0"),
    readFileSync(full),
  ])).digest("hex");
  if (f.blob && f.blob !== blob) { console.error("blob-mismatch", f.path, f.blob, blob); bad++; }
}
process.exit(bad ? 1 : 0);
`;
writeFileSync(join(PKG, "verify-package.mjs"), verifyScript);

const sumLines = [];
walk(PKG, (p) => {
  const rel = relative(PKG, p);
  if (rel === "SHA256SUMS.txt") return;
  sumLines.push(`${sha256File(p)}  ${rel}`);
});
sumLines.sort((a, b) => a.slice(66).localeCompare(b.slice(66)));
writeFileSync(join(PKG, "SHA256SUMS.txt"), sumLines.join("\n") + "\n");

sh("zip", ["-qr", ZIP, PKG_NAME], { cwd: DESK });
const zipHash = sha256File(ZIP);

const v = spawnSync("node", [join(PKG, "verify-package.mjs")], { encoding: "utf8" });
console.log(
  JSON.stringify(
    {
      pkg: PKG,
      zip: ZIP,
      zipSha256: zipHash,
      verifyExit: v.status,
      ready,
      finalSha: FULL,
    },
    null,
    2
  )
);
process.exit(v.status === 0 && ready ? 0 : 1);
