#!/usr/bin/env node
/**
 * Package Fix 10 ReReview tree under ~/Downloads.
 * Requires a clean committed tip (no modified tracked files).
 *
 *   node scripts/packageFix10Review.mjs
 *
 * `ready` is re-derived from the packaged bytes by scripts/lib/fix10ReviewEvidence.mjs
 * (F01–F18 content, calibration, matched compare, browser B01–B08 incl. substantive B04/B06,
 * production-schedule season study (seasonN >= 100, paired seeds equal), career cohort with
 * initial+final career snapshots, REQUIRED full-suite.log with coherent TAP, tested-source
 * content manifest). Mere file existence — or a commands.json note — never passes.
 *
 * Output: ~/Downloads/10-Club-Strength-Profiles-Superstar-Impact-ReReview-<shortSHA>/
 * Env: FIX10_REVIEW_OUT — override Downloads root
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
import {
  assessPackageEvidence,
  computeSourceManifest,
  cmp,
  FOCUSED_IDS,
  EVIDENCE_SCHEMA,
} from "./lib/fix10ReviewEvidence.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHORT = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
const FULL = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
/** Fix 09 tip — accepted predecessor for Fix 10. */
const BASE = "296a14f2e921e68a946a802605e472662cb0894e";
const OUT_ROOT = process.env.FIX10_REVIEW_OUT || join(homedir(), "Downloads");
const PKG_NAME = `10-Club-Strength-Profiles-Superstar-Impact-ReReview-${SHORT}`;
const PKG = join(OUT_ROOT, PKG_NAME);
const ZIP = join(OUT_ROOT, `${PKG_NAME}.zip`);

if (existsSync(PKG) || existsSync(ZIP)) {
  throw new Error(`Refusing to overwrite existing review package/ZIP: ${PKG_NAME}`);
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
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
ensureDir(join(PKG, "changes"));
const basePatch =
  spawnSync("git", ["diff", "--binary", BASE, FULL], {
    cwd: ROOT,
    encoding: "buffer",
    maxBuffer: 256 * 1024 * 1024,
  }).stdout || Buffer.alloc(0);
writeFileSync(join(PKG, "diff/base-to-final.patch"), basePatch);
writeFileSync(join(PKG, "changes/base-to-final.patch"), basePatch);
writeFileSync(join(PKG, "diff/name-status.txt"), sh("git", ["diff", "--name-status", BASE, FULL]).stdout);
writeFileSync(join(PKG, "diff/stat.txt"), sh("git", ["diff", "--stat", BASE, FULL]).stdout);
writeFileSync(join(PKG, "changes/changed-files.txt"), sh("git", ["diff", "--name-only", BASE, FULL]).stdout);
writeFileSync(join(PKG, "changes/git-log.txt"), sh("git", ["log", "--oneline", `${BASE}..${FULL}`]).stdout);
writeFileSync(join(PKG, "changes/git-status.txt"), sh("git", ["status", "--porcelain=v1"]).stdout || "(clean)\n");

ensureDir(join(PKG, "reports"));
if (existsSync(join(ROOT, "reports/fix10-club-strength-audit.md"))) {
  copyFile(join(ROOT, "reports/fix10-club-strength-audit.md"), join(PKG, "reports/audit.md"));
  copyFile(join(ROOT, "reports/fix10-club-strength-audit.md"), join(PKG, "reports/fix10-club-strength-audit.md"));
}
for (const name of [
  "fix10-club-strength-profiles-superstar-impact-completion.md",
  "calibration-targets.json",
  "baseline-vs-final-summary.json",
]) {
  const src = join(ROOT, "reports", name);
  if (existsSync(src)) copyFile(src, join(PKG, "reports", name));
}
for (const name of [
  "strength-calibration-report.json",
  "strength-coverage-report.json",
  "strength-audit-initial.json",
  "club-calibration-audit-report.json",
  "nation-strength-coverage-report.json",
  "strength-matching-report.json",
]) {
  const src = join(ROOT, "reports", name);
  if (existsSync(src)) copyFile(src, join(PKG, "reports", name));
}

copyTree(join(ROOT, "qa/fix10-runs"), join(PKG, "qa/fix10-runs"));
copyTree(join(ROOT, "qa/fix10-runs/browser"), join(PKG, "qa/browser"));
if (existsSync(join(ROOT, "qa/fix10-runs/browser/screenshots"))) {
  copyTree(join(ROOT, "qa/fix10-runs/browser/screenshots"), join(PKG, "qa/browser/screenshots"));
}

// Tested-source content manifest (per-file sha256 + aggregate), then re-derive every gate from PACKAGED bytes.
const sourceManifest = computeSourceManifest(join(PKG, "source"));
writeFileSync(join(PKG, "source-content-manifest.json"), JSON.stringify({ commit: FULL, ...sourceManifest }, null, 2));
const assessed = assessPackageEvidence(PKG, { baseSha: BASE, finalSha: FULL });
const { ready, gates } = assessed;
const gp = (k) => (gates[k].ok ? "PASS" : `FAIL (${gates[k].reason})`);
writeFileSync(
  join(PKG, "evidence.json"),
  JSON.stringify({ ...assessed.evidence, generatedAt: new Date().toISOString() }, null, 2)
);
writeFileSync(
  join(PKG, "reports/qa-matrix.md"),
  `# Fix 10 ReReview QA matrix

| Gate | Status | Evidence |
| --- | --- | --- |
| Focused ${FOCUSED_IDS[0]}–${FOCUSED_IDS.at(-1)} (parsed, ok:true, required keys) | ${gp("focused")} | \`qa/fix10-runs/cases/F*.json\` |
| Calibration | ${gp("calibration")} | \`qa/fix10-runs/calibration-summary.json\` |
| Matched baseline-vs-final | ${gp("matched")} | \`qa/fix10-runs/matched/\` |
| Browser B01–B08 (requiredComplete; B04 natural short row, B06 pause/restore finance + checkpoint) | ${gp("browser")} | \`qa/fix10-runs/browser/browser-report.json\`, \`browser/snapshots/\` |
| Production-season study (seasonN >= 100, paired seeds equal) | ${gp("productionSeasons")} | \`qa/fix10-runs/production-seasons/summary.json\` |
| Career cohort >= 24 (input + initial + final career snapshots) | ${gp("cohort")} | \`qa/fix10-runs/career-cohort/summary.json\` |
| Full-suite evidence (log required, coherent TAP) | ${gp("fullSuite")} | \`qa/fix10-runs/logs/full-suite.log\` |
| Tested-source manifest | ${gp("sourceManifest")} | \`source-content-manifest.json\` |
`
);

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
const remote = spawnSync(
  "git",
  ["ls-remote", "origin", "refs/heads/fix/10-club-strength-profiles-superstar-impact"],
  { cwd: ROOT, encoding: "utf8" }
).stdout.trim();
writeFileSync(join(PKG, "git/remote-sha.txt"), remote + "\n");
writeFileSync(join(PKG, "changes/remote-head.txt"), remote + "\n");
writeFileSync(
  join(PKG, "source-omissions.json"),
  JSON.stringify(
    {
      omitted: [
        {
          path: "qa/fix*-runs bulk historical artifacts",
          reason: "Unrelated predecessor bulk evidence kept out of Fix 10 package size budget",
        },
        {
          path: "node_modules / .git",
          reason: "Excluded by policy",
        },
      ],
      note: "Required Fix 10 fixtures and browser evidence are included under qa/",
    },
    null,
    2
  )
);

const manifest = {
  package: PKG_NAME,
  repository: "BorisMojsa/Simulation",
  branch: "fix/10-club-strength-profiles-superstar-impact",
  baseSha: BASE,
  finalSha: FULL,
  remoteSha: remote.split(/\s+/)[0] || null,
  createdAt: new Date().toISOString(),
  provenanceVersion: 1,
  evidenceSchema: EVIDENCE_SCHEMA,
  sourceContentSha256: sourceManifest.sha256,
  gates: { ...Object.fromEntries(Object.entries(gates).map(([k, g]) => [k, g.ok])), ready },
  commands: {
    focused: "node --test tests/clubStrengthSuperstarImpact.test.mjs tests/teamStrength.test.mjs tests/strengthProvenance.test.mjs",
    calibration: "node scripts/qaClubStrengthSuperstarImpact.mjs",
    matched: "node scripts/qaFix10MatchedCompare.mjs",
    browser: "node scripts/browserClubStrengthSuperstarImpactChecklist.mjs",
    productionSeasons: "FIX10_PROD_SEASON_N=100 node scripts/qaFix10ProductionSeasons.mjs",
    careerCohort: "node scripts/qaFix10CareerCohort.mjs",
    fullSuite: "node --test tests/*.test.mjs > qa/fix10-runs/logs/full-suite.log 2>&1",
    negativeVerify: "node scripts/qaFix10NegativeVerify.mjs <package-dir>",
    verify: "node scripts/verifyFix10Review.mjs <package-dir>",
  },
};
writeFileSync(join(PKG, "manifest.json"), JSON.stringify(manifest, null, 2));

writeFileSync(
  join(PKG, "README.md"),
  `# Fix 10 ReReview — Club strength profiles + superstar impact

**Verdict: ${ready ? "READY FOR REVIEW" : "BLOCKED / incomplete gates"}**

- Branch: \`fix/10-club-strength-profiles-superstar-impact\`
- Base (Fix 09): \`${BASE}\`
- Final: \`${FULL}\`
- Remote: \`${manifest.remoteSha || "(push required)"}\`

## Replay

\`\`\`bash
cd source
node --test tests/clubStrengthSuperstarImpact.test.mjs
node scripts/qaClubStrengthSuperstarImpact.mjs
node scripts/browserClubStrengthSuperstarImpactChecklist.mjs
\`\`\`

## Verify this package

\`\`\`bash
node scripts/verifyFix10Review.mjs "${PKG_NAME}"
# or from inside the package:
node verify-package.mjs
\`\`\`

## Gates

${Object.keys(gates)
  .map((k) => `- ${k}: ${gp(k)}`)
  .join("\n")}
`
);

// Package-local verifier: the real checks live in verifier/ (copied from scripts/); this is a thin entry point.
ensureDir(join(PKG, "verifier/lib"));
copyFile(join(ROOT, "scripts/verifyFix10Review.mjs"), join(PKG, "verifier/verifyFix10Review.mjs"));
copyFile(join(ROOT, "scripts/lib/fix10ReviewEvidence.mjs"), join(PKG, "verifier/lib/fix10ReviewEvidence.mjs"));
writeFileSync(
  join(PKG, "verify-package.mjs"),
  `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(fileURLToPath(import.meta.url));
const r = spawnSync("node", [join(root, "verifier/verifyFix10Review.mjs"), root], { stdio: "inherit" });
process.exit(r.status ?? 1);
`
);

const sumLines = [];
walk(PKG, (p) => {
  const rel = relative(PKG, p).split("\\").join("/");
  if (rel === "SHA256SUMS.txt" || rel === "checksums.sha256") return;
  sumLines.push(`${sha256File(p)}  ${rel}`);
});
sumLines.sort((a, b) => cmp(a.slice(66), b.slice(66)));
writeFileSync(join(PKG, "SHA256SUMS.txt"), sumLines.join("\n") + "\n");
writeFileSync(join(PKG, "checksums.sha256"), sumLines.join("\n") + "\n");

sh("zip", ["-qr", ZIP, PKG_NAME], { cwd: OUT_ROOT });
const zipHash = sha256File(ZIP);

// Authoritative verification uses the repo verifier, which re-derives readiness from package bytes.
const v = spawnSync("node", [join(ROOT, "scripts/verifyFix10Review.mjs"), PKG], { encoding: "utf8" });
if (v.status !== 0) console.error(v.stdout);
console.log(
  JSON.stringify(
    {
      pkg: PKG,
      zip: ZIP,
      zipSha256: zipHash,
      verifyExit: v.status,
      ready,
      gates: Object.fromEntries(Object.entries(gates).map(([k, g]) => [k, g.ok ? "ok" : g.reason])),
      finalSha: FULL,
    },
    null,
    2
  )
);
process.exit(v.status === 0 && ready ? 0 : 1);
