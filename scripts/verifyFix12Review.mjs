#!/usr/bin/env node
/**
 * Verify a Fix 12 review ZIP (or an extracted temp copy).
 *
 *   node scripts/verifyFix12Review.mjs --zip /abs/path/file.zip
 *   node verify-package.mjs --zip ./this.zip   # when run from extracted archive
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assessPackageEvidence,
  readJson,
  sha256File,
} from "./lib/fix12ReviewEvidence.mjs";

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

const here = dirname(fileURLToPath(import.meta.url));
const zipArg = argValue("--zip") || process.argv.find((a) => a.endsWith(".zip"));
const negative = process.argv.includes("--negative-control");

function unzipTo(zipPath, dest) {
  const r = spawnSync("unzip", ["-q", zipPath, "-d", dest], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`unzip failed: ${r.stderr || r.stdout}`);
}

function verifyRoot(root) {
  const required = [
    "README-REVIEW.md",
    "manifest.json",
    "source-content-manifest.json",
    "SHA256SUMS.json",
    "diff/base-to-final.patch",
    "qa/fix12/browser/browser-report.json",
    "qa/fix12/final/fixtures/f01-campaign.json",
    "qa/fix12/final/case-index.json",
    "source/js/ui/tournamentPresentation.js",
    "source/tests/tournamentPresentation.test.mjs",
  ];
  const missing = required.filter((p) => !existsSync(join(root, p)));
  if (missing.length) return { ok: false, problems: missing.map((m) => `missing ${m}`) };

  const sums = readJson(join(root, "SHA256SUMS.json"));
  const hashProblems = [];
  for (const [rel, expected] of Object.entries(sums)) {
    if (rel === "SHA256SUMS.json") continue;
    const abs = join(root, rel);
    if (!existsSync(abs)) {
      hashProblems.push(`sum entry missing file ${rel}`);
      continue;
    }
    const actual = sha256File(abs);
    if (actual !== expected) hashProblems.push(`hash mismatch ${rel}`);
  }

  const manifest = readJson(join(root, "manifest.json"));
  const browserReport = readJson(join(root, "qa/fix12/browser/browser-report.json"));
  const caseIndex = readJson(join(root, "qa/fix12/final/case-index.json"));
  const f01Fixture = readJson(join(root, "qa/fix12/final/fixtures/f01-campaign.json"));
  const presentationLog = existsSync(join(root, "qa/fix12/final/logs/tournamentPresentation.test.log"))
    ? readFileSync(join(root, "qa/fix12/final/logs/tournamentPresentation.test.log"), "utf8")
    : "";
  const fullSuiteLog = existsSync(join(root, "qa/fix12/full-suite.txt"))
    ? readFileSync(join(root, "qa/fix12/full-suite.txt"), "utf8")
    : "";
  const gameplayParity = existsSync(join(root, "qa/fix12/final/gameplay-parity/parity-result.json"))
    ? readJson(join(root, "qa/fix12/final/gameplay-parity/parity-result.json"))
    : null;

  const assessment = assessPackageEvidence({
    manifest,
    caseIndex,
    browserReport,
    f01Fixture,
    presentationTestLog: presentationLog,
    fullSuiteLog,
    gameplayParity,
  });

  // Source identity: presentation module hash matches manifest tested fingerprint when present
  const sourceManifest = readJson(join(root, "source-content-manifest.json"));
  const presentation = sourceManifest.files?.find((f) => f.path === "js/ui/tournamentPresentation.js");
  if (presentation && manifest.testedSourceFingerprint && presentation.sha256 !== manifest.testedSourceFingerprint) {
    assessment.problems.push("testedSourceFingerprint mismatch vs source-content-manifest");
    assessment.ok = false;
  }

  // Run packaged presentation tests
  const test = spawnSync("node", ["--test", "tests/tournamentPresentation.test.mjs"], {
    cwd: join(root, "source"),
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (test.status !== 0) {
    assessment.problems.push("packaged source presentation tests failed");
    assessment.ok = false;
  }

  const problems = [...missing.map((m) => `missing ${m}`), ...hashProblems, ...assessment.problems];
  return {
    ok: problems.length === 0 && assessment.ok,
    problems,
    manifest,
    testStatus: test.status,
  };
}

function runNegativeControls(zipPath) {
  const results = [];
  // Control 1: corrupt F01 total wins in extracted copy
  {
    const temp = mkdtempSync(join(tmpdir(), "fix12-neg-"));
    try {
      unzipTo(zipPath, temp);
      const root = temp;
      // zip may extract to temp/ or temp/<single-dir> — files are at root of archive
      const fixturePath = join(root, "qa/fix12/final/fixtures/f01-campaign.json");
      const fixture = readJson(fixturePath);
      fixture.projection.tournament.record.wins = 8;
      writeFileSync(fixturePath, JSON.stringify(fixture, null, 2));
      // regenerate checksum for that file so only substance fails
      const sums = readJson(join(root, "SHA256SUMS.json"));
      sums["qa/fix12/final/fixtures/f01-campaign.json"] = sha256File(fixturePath);
      writeFileSync(join(root, "SHA256SUMS.json"), JSON.stringify(sums, null, 2));
      const verdict = verifyRoot(root);
      results.push({
        name: "F01-W8-corruption",
        expectedFail: true,
        ok: !verdict.ok,
        problems: verdict.problems,
      });
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }
  // Control 2: remove browser report
  {
    const temp = mkdtempSync(join(tmpdir(), "fix12-neg-"));
    try {
      unzipTo(zipPath, temp);
      rmSync(join(temp, "qa/fix12/browser/browser-report.json"), { force: true });
      const verdict = verifyRoot(temp);
      results.push({
        name: "missing-browser-report",
        expectedFail: true,
        ok: !verdict.ok,
        problems: verdict.problems,
      });
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }
  return results;
}

if (!zipArg) {
  // Allow running against already-extracted cwd (archive root)
  if (existsSync(join(here, "manifest.json")) && existsSync(join(here, "source"))) {
    const verdict = verifyRoot(here);
    console.log(JSON.stringify(verdict, null, 2));
    process.exit(verdict.ok ? 0 : 1);
  }
  console.error("Usage: node scripts/verifyFix12Review.mjs --zip /path/to/review.zip");
  process.exit(2);
}

const zipPath = isAbsolute(zipArg) ? zipArg : resolve(process.cwd(), zipArg);
if (!existsSync(zipPath) || !statSync(zipPath).isFile()) {
  console.error(`ZIP not found: ${zipPath}`);
  process.exit(1);
}

const extract = mkdtempSync(join(tmpdir(), "fix12-verify-"));
try {
  unzipTo(zipPath, extract);
  const verdict = verifyRoot(extract);
  let negatives = [];
  if (negative || process.env.FIX12_RUN_NEGATIVES === "1") {
    negatives = runNegativeControls(zipPath);
  } else {
    negatives = runNegativeControls(zipPath);
  }
  const negOk = negatives.every((n) => n.ok);
  const out = {
    zip: zipPath,
    zipSha256: sha256File(zipPath),
    verdict,
    negatives,
    ok: verdict.ok && negOk,
  };
  console.log(JSON.stringify(out, null, 2));
  if (!out.ok) process.exit(1);
} finally {
  rmSync(extract, { recursive: true, force: true });
}
