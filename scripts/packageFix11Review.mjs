#!/usr/bin/env node
/** Build a self-verifying Fix 11 review package from current tracked bytes. */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  assessPackageEvidence,
  computeSourceManifest,
  EVIDENCE_SCHEMA,
  listFiles,
  sha256File,
} from "./lib/fix11ReviewEvidence.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = (args) =>
  spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const full = git(["rev-parse", "HEAD"]).stdout.trim();
const short = full.slice(0, 8) || "uncommitted";
const dirtyFiles = git(["status", "--short"]).stdout.trim().split("\n").filter(Boolean);
const outputRoot = process.env.FIX11_REVIEW_OUT || join(homedir(), "Downloads");
const packageName =
  process.env.FIX11_REVIEW_NAME || `11-Full-Career-Growth-Calibration-Review-${short}`;
const packageRoot = join(outputRoot, packageName);
const zipPath = `${packageRoot}.zip`;

if (process.env.FIX11_REVIEW_REPLACE === "1") {
  rmSync(packageRoot, { recursive: true, force: true });
  rmSync(zipPath, { force: true });
} else if (existsSync(packageRoot) || existsSync(zipPath)) {
  throw new Error(`Refusing to overwrite existing package: ${packageRoot}(.zip)`);
}
const ensureDir = (path) => mkdirSync(path, { recursive: true });
const copyFile = (src, dst) => {
  ensureDir(dirname(dst));
  copyFileSync(src, dst);
};
ensureDir(join(packageRoot, "source"));

// Package the bytes actually tested, including uncommitted tracked edits. Git
// supplies the allow-list so build output, node_modules, and .git stay excluded.
const tracked = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
if (tracked.status !== 0) {
  rmSync(packageRoot, { recursive: true, force: true });
  throw new Error(`git ls-files failed: ${tracked.stderr || tracked.stdout}`);
}
for (const rel of tracked.stdout.split("\0").filter(Boolean)) {
  if (rel.startsWith("qa/")) continue;
  const src = join(ROOT, rel);
  if (existsSync(src) && statSync(src).isFile()) copyFile(src, join(packageRoot, "source", rel));
}

const qaSelections = [
  "plan.json",
  "baseline",
  "browser",
  "cases",
  "controlled-final/summary.json",
  "trajectories-final/summary.json",
  "paired-final/summary.json",
  "mixed-final-200/summary.json",
  "discovery-plus7-250/summary.json",
  "witnesses",
  "logs/accounting-tests.log",
  "logs/full-career-growth-tests.log",
  "logs/witness-replay-plus6.log",
  "logs/witness-replay-plus7.log",
  "logs/witness-replay-natural99.log",
];
for (const rel of qaSelections) {
  const src = join(ROOT, "qa/fix11-runs", rel);
  if (!existsSync(src)) continue;
  const dst = join(packageRoot, "qa/fix11-runs", rel);
  ensureDir(dirname(dst));
  if (statSync(src).isDirectory()) cpSync(src, dst, { recursive: true });
  else copyFile(src, dst);
}

const sourceManifest = computeSourceManifest(join(packageRoot, "source"));
writeFileSync(
  join(packageRoot, "source-content-manifest.json"),
  JSON.stringify({ commit: full, ...sourceManifest }, null, 2)
);
const assessed = assessPackageEvidence(packageRoot, { finalSha: full });
writeFileSync(
  join(packageRoot, "evidence.json"),
  JSON.stringify({ ...assessed.evidence, generatedAt: new Date().toISOString() }, null, 2)
);
writeFileSync(
  join(packageRoot, "manifest.json"),
  JSON.stringify(
    {
      package: packageName,
      finalSha: full,
      sourceState: dirtyFiles.length ? "dirty-tracked-plus-intentional-files" : "clean-head",
      dirtyFiles,
      evidenceSchema: EVIDENCE_SCHEMA,
      ready: assessed.ready,
      sourceContentSha256: sourceManifest.sha256,
      gates: Object.fromEntries(
        Object.entries(assessed.gates).map(([name, value]) => [name, value.ok])
      ),
      commands: {
        verify: "node verify-package.mjs",
        browser: "node scripts/browserFullCareerGrowthChecklist.mjs",
      },
    },
    null,
    2
  )
);

ensureDir(join(packageRoot, "verifier/lib"));
copyFile(join(ROOT, "scripts/verifyFix11Review.mjs"), join(packageRoot, "verifier/verifyFix11Review.mjs"));
copyFile(
  join(ROOT, "scripts/lib/fix11ReviewEvidence.mjs"),
  join(packageRoot, "verifier/lib/fix11ReviewEvidence.mjs")
);
writeFileSync(
  join(packageRoot, "verify-package.mjs"),
  `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(fileURLToPath(import.meta.url));
const result = spawnSync(process.execPath, [join(root, "verifier/verifyFix11Review.mjs"), root], { stdio: "inherit" });
process.exit(result.status ?? 1);
`
);
writeFileSync(
  join(packageRoot, "README.md"),
  `# Fix 11 Full Career Growth Review

Verdict: ${assessed.ready ? "READY FOR REVIEW" : "BLOCKED / incomplete hard gates"}

Run \`node verify-package.mjs\` to verify checksums and re-derive every readiness gate.
`
);

const checksumLines = listFiles(packageRoot)
  .filter((rel) => !["SHA256SUMS.txt", "checksums.sha256"].includes(rel))
  .map((rel) => `${sha256File(join(packageRoot, rel))}  ${rel}`)
  .sort();
const checksumText = checksumLines.join("\n") + "\n";
writeFileSync(join(packageRoot, "SHA256SUMS.txt"), checksumText);
writeFileSync(join(packageRoot, "checksums.sha256"), checksumText);

const zipped = spawnSync(
  "ditto",
  ["-c", "-k", "--sequesterRsrc", "--keepParent", packageRoot, zipPath],
  { encoding: "utf8" }
);
if (zipped.status !== 0) {
  throw new Error(`ZIP creation failed: ${zipped.stderr || zipped.stdout}`);
}

console.log(JSON.stringify({
  packageRoot,
  zipPath,
  zipSha256: sha256File(zipPath),
  sourceState: dirtyFiles.length ? "dirty" : "clean",
  ready: assessed.ready,
  gates: Object.fromEntries(
    Object.entries(assessed.gates).map(([name, value]) => [
      name,
      value.ok ? "PASS" : `FAIL: ${value.reason}`,
    ])
  ),
}, null, 2));
process.exit(assessed.ready ? 0 : 1);
