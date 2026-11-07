#!/usr/bin/env node
/**
 * Verify a Fix 12 review ZIP (or an extracted temp copy).
 *
 *   node scripts/verifyFix12Review.mjs --zip /abs/path/file.zip
 *   node verify-package.mjs --zip ./this.zip
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

  run("hollow-browser-pass-strings", (root) => {
    const reportRel = "qa/fix12/browser/browser-report.json";
    const report = readJson(join(root, reportRel));
    report.results = report.results.map((r) => ({ id: r.id, status: "PASS" }));
    writeFileSync(join(root, reportRel), JSON.stringify(report, null, 2));
    for (const id of ["B01", "B02", "B03", "B04", "B05", "B06", "B07", "B08"]) {
      writeFileSync(
        join(root, "qa/fix12/browser/cases", `${id}.json`),
        JSON.stringify({ id, status: "PASS" }, null, 2)
      );
    }
    const idxRel = "qa/fix12/final/case-index.json";
    writeFileSync(
      join(root, idxRel),
      JSON.stringify({ ok: true, cases: report.results.map((r) => ({ id: r.id, status: "PASS" })) }, null, 2)
    );
    const f01Rel = "qa/fix12/final/fixtures/f01-campaign.json";
    const f01 = readJson(join(root, f01Rel));
    writeFileSync(
      join(root, f01Rel),
      JSON.stringify(
        {
          projection: f01.projection,
          oracle: f01.oracle,
        },
        null,
        2
      )
    );
    rmSync(join(root, "qa/fix12/full-suite.txt"), { force: true });
    rmSync(join(root, "qa/fix12/final/gameplay-parity/parity-result.json"), { force: true });
    rmSync(join(root, "qa/fix12/packaged-suite-proof.json"), { force: true });
    return [
      reportRel,
      idxRel,
      f01Rel,
      ...["B01", "B02", "B03", "B04", "B05", "B06", "B07", "B08"].map(
        (id) => `qa/fix12/browser/cases/${id}.json`
      ),
      "qa/fix12/full-suite.txt",
      "qa/fix12/final/gameplay-parity/parity-result.json",
      "qa/fix12/packaged-suite-proof.json",
    ];
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
