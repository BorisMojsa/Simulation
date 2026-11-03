#!/usr/bin/env node
/**
 * Package Fix 10 review tree under ~/Downloads.
 * Requires a clean committed tip (no modified tracked files).
 *
 *   node scripts/packageFix10Review.mjs
 *
 * Output: ~/Downloads/10-Club-Strength-Profiles-Superstar-Impact-Review-<shortSHA>/
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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHORT = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
const FULL = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
/** Fix 09 tip — accepted predecessor for Fix 10. */
const BASE = "296a14f2e921e68a946a802605e472662cb0894e";
const OUT_ROOT = process.env.FIX10_REVIEW_OUT || join(homedir(), "Downloads");
const PKG_NAME = `10-Club-Strength-Profiles-Superstar-Impact-Review-${SHORT}`;
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
writeFileSync(
  join(PKG, "diff/base-to-final.patch"),
  spawnSync("git", ["diff", "--binary", BASE, FULL], {
    cwd: ROOT,
    encoding: "buffer",
    maxBuffer: 256 * 1024 * 1024,
  }).stdout || Buffer.alloc(0)
);
writeFileSync(join(PKG, "diff/name-status.txt"), sh("git", ["diff", "--name-status", BASE, FULL]).stdout);
writeFileSync(join(PKG, "diff/stat.txt"), sh("git", ["diff", "--stat", BASE, FULL]).stdout);

ensureDir(join(PKG, "reports"));
if (existsSync(join(ROOT, "reports/fix10-club-strength-audit.md"))) {
  copyFile(join(ROOT, "reports/fix10-club-strength-audit.md"), join(PKG, "reports/audit.md"));
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

const browser = readJson(join(ROOT, "qa/fix10-runs/browser/browser-report.json"));
const calibration = readJson(join(ROOT, "qa/fix10-runs/calibration-summary.json"));
const calibrationGate = readJson(join(ROOT, "qa/fix10-runs/cases/calibration-gate.json"));
const matched = readJson(join(ROOT, "qa/fix10-runs/matched/baseline-vs-final-summary.json")) ||
  readJson(join(ROOT, "qa/fix10-runs/baseline-vs-final-summary.json"));

const focusedOk =
  existsSync(join(ROOT, "qa/fix10-runs/logs/focused-strength.log")) ||
  existsSync(join(ROOT, "qa/fix10-runs/cases/F01.json"));
const calibrationOk = calibration?.ok === true || calibrationGate?.ok === true;
const browserOk =
  browser?.ok === true &&
  browser?.subsetOnly !== true &&
  browser?.requiredComplete === true &&
  Array.isArray(browser?.requiredIds) &&
  browser.requiredIds.length === 8;
const matchedOk = matched?.ok === true || matched?.pass === true;

const ready = focusedOk && calibrationOk && browserOk && !browser?.blocked;

writeFileSync(
  join(PKG, "reports/qa-matrix.md"),
  `# Fix 10 QA matrix

| Gate | Status | Evidence |
| --- | --- | --- |
| Focused F01–F16 | ${focusedOk ? "PASS/present" : "MISSING"} | \`qa/fix10-runs/cases/F*.json\`, \`tests/clubStrengthSuperstarImpact.test.mjs\` |
| Calibration | ${calibrationOk ? "PASS" : "FAIL/missing"} | \`qa/fix10-runs/calibration-summary.json\` |
| Browser B01–B08 | ${browserOk ? "PASS" : "FAIL/missing"} | \`qa/fix10-runs/browser/browser-report.json\` |
| Matched compare | ${matchedOk ? "PASS" : "see matched/"} | \`qa/fix10-runs/matched/\` |
`
);

copyTree(join(ROOT, "qa/fix10-runs"), join(PKG, "qa/fix10-runs"));
copyTree(join(ROOT, "qa/fix10-runs/browser"), join(PKG, "qa/browser"));
if (existsSync(join(ROOT, "qa/fix10-runs/browser/screenshots"))) {
  copyTree(join(ROOT, "qa/fix10-runs/browser/screenshots"), join(PKG, "qa/browser/screenshots"));
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
const remote = spawnSync(
  "git",
  ["ls-remote", "origin", "refs/heads/fix/10-club-strength-profiles-superstar-impact"],
  { cwd: ROOT, encoding: "utf8" }
).stdout.trim();
writeFileSync(join(PKG, "git/remote-sha.txt"), remote + "\n");

const manifest = {
  package: PKG_NAME,
  repository: "BorisMojsa/Simulation",
  branch: "fix/10-club-strength-profiles-superstar-impact",
  baseSha: BASE,
  finalSha: FULL,
  remoteSha: remote.split(/\s+/)[0] || null,
  createdAt: new Date().toISOString(),
  provenanceVersion: 1,
  gates: {
    focused: focusedOk,
    calibration: calibrationOk,
    browser: browserOk,
    matched: matchedOk,
    ready,
  },
  commands: {
    focused: "node --test tests/clubStrengthSuperstarImpact.test.mjs tests/teamStrength.test.mjs",
    calibration: "node scripts/qaClubStrengthSuperstarImpact.mjs",
    matched: "node scripts/qaFix10MatchedCompare.mjs",
    browser: "node scripts/browserClubStrengthSuperstarImpactChecklist.mjs",
    verify: "node scripts/verifyFix10Review.mjs <package-dir>",
  },
};
writeFileSync(join(PKG, "manifest.json"), JSON.stringify(manifest, null, 2));

writeFileSync(
  join(PKG, "README.md"),
  `# Fix 10 — Club strength profiles + superstar impact

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

- Focused F01–F16: ${focusedOk ? "PASS/present" : "MISSING"}
- Calibration: ${calibrationOk ? "PASS" : "FAIL/missing"}
- Browser B01–B08: ${browserOk ? "PASS" : "FAIL/missing"}
- Matched compare: ${matchedOk ? "PASS" : "see matched/"}
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
if (!manifest.finalSha || !manifest.baseSha) {
  console.error("manifest missing identity fields");
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
console.log(JSON.stringify({ ok: bad === 0, bad, package: manifest.package, finalSha: manifest.finalSha }, null, 2));
process.exit(bad ? 1 : 0);
`;
writeFileSync(join(PKG, "verify-package.mjs"), verifyScript);

// Also copy standalone verifier for convenience.
if (existsSync(join(ROOT, "scripts/verifyFix10Review.mjs"))) {
  copyFile(join(ROOT, "scripts/verifyFix10Review.mjs"), join(PKG, "scripts-verifyFix10Review.mjs"));
}

const sumLines = [];
walk(PKG, (p) => {
  const rel = relative(PKG, p);
  if (rel === "SHA256SUMS.txt") return;
  sumLines.push(`${sha256File(p)}  ${rel}`);
});
sumLines.sort((a, b) => a.slice(66).localeCompare(b.slice(66)));
writeFileSync(join(PKG, "SHA256SUMS.txt"), sumLines.join("\n") + "\n");

sh("zip", ["-qr", ZIP, PKG_NAME], { cwd: OUT_ROOT });
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
