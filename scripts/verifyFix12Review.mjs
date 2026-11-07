#!/usr/bin/env node
/**
 * Verify a Fix 12 review ZIP (or an extracted temp copy).
 *
 *   node scripts/verifyFix12Review.mjs --zip /abs/path/file.zip
 *   node verify-package.mjs --zip ./this.zip
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
    "qa/fix12/final/gameplay-parity/parity-result.json",
    "qa/fix12/full-suite.txt",
    "qa/fix12/packaged-suite-proof.json",
    "source/js/ui/tournamentPresentation.js",
    "source/tests/tournamentPresentation.test.mjs",
    "source/qa/fix11-runs/plan.json",
    "source/qa/fix09-runs/final/full-suite.log",
  ];
  const missing = required.filter((p) => !existsSync(join(root, p)));
  if (missing.length) {
    return { ok: false, problems: missing.map((m) => `missing ${m}`) };
  }

  const sums = readJson(join(root, "SHA256SUMS.json"));
  const hashProblems = [];
  for (const [rel, expected] of Object.entries(sums)) {
    if (rel === "SHA256SUMS.json") continue;
    const abs = join(root, rel);
    if (!existsSync(abs)) {
      hashProblems.push(`sum entry missing file ${rel}`);
      continue;
    }
    if (statSync(abs).isDirectory()) continue;
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
  const fullSuiteLog = readFileSync(join(root, "qa/fix12/full-suite.txt"), "utf8");
  const gameplayParity = readJson(join(root, "qa/fix12/final/gameplay-parity/parity-result.json"));
  const sourceManifest = readJson(join(root, "source-content-manifest.json"));
  const packagedSuiteProof = readJson(join(root, "qa/fix12/packaged-suite-proof.json"));

  const assessment = assessPackageEvidence({
    root,
    manifest,
    caseIndex,
    browserReport,
    f01Fixture,
    presentationTestLog: presentationLog,
    fullSuiteLog,
    gameplayParity,
    sourceManifest,
    packagedSuiteProof,
  });

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
    ok: problems.length === 0,
    problems,
    manifest,
    testStatus: test.status,
  };
}

function rewriteSums(root, rels) {
  const sums = readJson(join(root, "SHA256SUMS.json"));
  for (const rel of rels) {
    const abs = join(root, rel);
    if (existsSync(abs) && statSync(abs).isFile()) sums[rel] = sha256File(abs);
    else delete sums[rel];
  }
  writeFileSync(join(root, "SHA256SUMS.json"), JSON.stringify(sums, null, 2));
}

function runNegativeControls(zipPath) {
  const results = [];

  const run = (name, mutate) => {
    const temp = mkdtempSync(join(tmpdir(), "fix12-neg-"));
    try {
      unzipTo(zipPath, temp);
      const touched = mutate(temp) || [];
      rewriteSums(temp, touched);
      const verdict = verifyRoot(temp);
      results.push({
        name,
        expectedFail: true,
        ok: !verdict.ok,
        problems: verdict.problems,
      });
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  };

  run("F01-W8-corruption", (root) => {
    const rel = "qa/fix12/final/fixtures/f01-campaign.json";
    const fixture = readJson(join(root, rel));
    fixture.projection.tournament.record.wins = 8;
    writeFileSync(join(root, rel), JSON.stringify(fixture, null, 2));
    return [rel];
  });

  run("missing-browser-report", (root) => {
    rmSync(join(root, "qa/fix12/browser/browser-report.json"), { force: true });
    return ["qa/fix12/browser/browser-report.json"];
  });

  run("hollow-browser-empty-detail", (root) => {
    // Independent control: keep all files and PASS flags, empty observation payloads.
    const reportRel = "qa/fix12/browser/browser-report.json";
    const report = readJson(join(root, reportRel));
    report.results = report.results.map((r) => ({
      id: r.id,
      status: "PASS",
      detail: {},
    }));
    writeFileSync(join(root, reportRel), JSON.stringify(report, null, 2));
    const touched = [reportRel];
    for (const id of ["B01", "B02", "B03", "B04", "B05", "B06", "B07", "B08"]) {
      const rel = `qa/fix12/browser/cases/${id}.json`;
      writeFileSync(join(root, rel), JSON.stringify({ id, status: "PASS", detail: {} }, null, 2));
      touched.push(rel);
    }
    return touched;
  });

  run("raw-f01-score-contradicts-totals", (root) => {
    const rel = "qa/fix12/final/fixtures/f01-campaign.json";
    const fixture = readJson(join(root, rel));
    // Leave projected totals intact; flip a raw fixture score so oracle fails.
    if (fixture.rawNationFixtures?.[0]) {
      fixture.rawNationFixtures[0].homeGoals = 9;
      fixture.rawNationFixtures[0].awayGoals = 9;
      fixture.rawNationFixtures[0].matchHomeGoals = 9;
      fixture.rawNationFixtures[0].matchAwayGoals = 9;
    }
    writeFileSync(join(root, rel), JSON.stringify(fixture, null, 2));
    return [rel];
  });

  run("same-revision-parity", (root) => {
    const rel = "qa/fix12/final/gameplay-parity/parity-result.json";
    const parity = readJson(join(root, rel));
    parity.sameRevisionOnly = true;
    parity.baseSha = parity.finalSha;
    writeFileSync(join(root, rel), JSON.stringify(parity, null, 2));
    return [rel];
  });

  run("parity-pairs-removed", (root) => {
    const touched = ["qa/fix12/packaged-suite.log"];
    rmSync(join(root, "qa/fix12/packaged-suite.log"), { force: true });
    for (const name of [
      "world-cup-12001-base.json",
      "world-cup-12001-final.json",
      "ucl-seed7-w4d2l2-base.json",
      "ucl-seed7-w4d2l2-final.json",
      "libertadores-seed7-base.json",
      "libertadores-seed7-final.json",
    ]) {
      const rel = `qa/fix12/final/gameplay-parity/${name}`;
      rmSync(join(root, rel), { force: true });
      touched.push(rel);
    }
    return touched;
  });

  run("source-style-css-tamper", (root) => {
    const rel = "source/style.css";
    const abs = join(root, rel);
    writeFileSync(abs, readFileSync(abs, "utf8") + "\n/* tamper */\n");
    // Checksums regenerated by rewriteSums — manifest identity must still fail.
    return [rel];
  });

  run("contradictory-continue-false", (root) => {
    const touched = [];
    const reportRel = "qa/fix12/browser/browser-report.json";
    const report = readJson(join(root, reportRel));
    for (const id of ["B02", "B07"]) {
      const row = report.results.find((r) => r.id === id);
      if (!row?.detail) continue;
      row.detail.continueClosed = false;
      row.detail.seasonActionInFlight = true;
      row.detail.nextCareerAction = { canSimulate: false };
      const caseRel = `qa/fix12/browser/cases/${id}.json`;
      const payload = readJson(join(root, caseRel));
      payload.detail = { ...row.detail };
      writeFileSync(join(root, caseRel), JSON.stringify(payload, null, 2));
      touched.push(caseRel);
    }
    writeFileSync(join(root, reportRel), JSON.stringify(report, null, 2));
    touched.push(reportRel);
    return touched;
  });

  run("parity-rng-pair-contradiction", (root) => {
    const pairRel = "qa/fix12/final/gameplay-parity/world-cup-12001-final.json";
    const parityRel = "qa/fix12/final/gameplay-parity/parity-result.json";
    const pair = readJson(join(root, pairRel));
    pair.rng = Number(pair.rng || 0) + 1;
    writeFileSync(join(root, pairRel), JSON.stringify(pair, null, 2));
    const parity = readJson(join(root, parityRel));
    const digest = createHash("sha256").update(readFileSync(join(root, pairRel))).digest("hex");
    parity.pairDigests = parity.pairDigests || {};
    parity.pairDigests["world-cup-12001-final.json"] = digest;
    writeFileSync(join(root, parityRel), JSON.stringify(parity, null, 2));
    return [pairRel, parityRel];
  });

  return results;
}

if (!zipArg) {
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
  const negatives = runNegativeControls(zipPath);
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
