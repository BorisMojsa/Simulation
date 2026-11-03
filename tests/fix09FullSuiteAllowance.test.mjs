/**
 * Fix 09 packaging gate: full-suite allowance must reject unknown failures
 * even when they occur inside the allowed playerAbility file.
 *
 * Run: node --test tests/fix09FullSuiteAllowance.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packagerPath = join(root, "scripts/packageFix09Review.mjs");
const logPath = join(root, "qa/fix09-runs/final/full-suite.log");

/** Portable witness style: inject ALLOWED with markers only (as the review script does). */
function loadClassifier(allowed) {
  const source = readFileSync(packagerPath, "utf8");
  const start = source.indexOf("function assessFullSuiteAllowance()");
  const end = source.indexOf("\nconst fullSuiteGate =", start);
  assert.ok(start >= 0 && end > start, "assessFullSuiteAllowance gate not found");
  const assess = Function(
    "existsSync",
    "readFileSync",
    "join",
    "ROOT",
    "ALLOWED_FULL_SUITE",
    `${source.slice(start, end)}\nreturn assessFullSuiteAllowance();`
  );
  return (log) =>
    assess(
      () => true,
      () => log,
      join,
      root,
      allowed
    );
}

const ALLOWED = {
  failedFiles: ["tests/playerAbility.test.mjs"],
  assertionMarkers: [
    "learning 8.693485869706887",
    "big.realized <= 7 - r.realized + 1e-6",
  ],
};

test("full-suite classifier accepts the supplied valid allowance log", () => {
  assert.equal(existsSync(logPath), true, "full-suite.log must exist");
  const log = readFileSync(logPath, "utf8");
  const actual = loadClassifier(ALLOWED)(log);
  assert.equal(actual.ok, true, JSON.stringify(actual));
  assert.deepEqual(actual.failedFiles, ["tests/playerAbility.test.mjs"]);
  assert.deepEqual(actual.failedTests.sort(), [
    "academy growth mutates attributes and charges shared annual allowance",
    "development: annual cap, deconditioning is recoverable",
  ]);
});

test("full-suite classifier rejects an additional failed cross-league file", () => {
  const log = readFileSync(logPath, "utf8");
  const actual = loadClassifier(ALLOWED)(
    `${log}\nnot ok 999 - tests/crossLeagueCareer.test.mjs\n# FAIL loan accept/refuse/return and wage share conservation\n`
  );
  assert.equal(actual.ok, false, JSON.stringify(actual));
});

test("full-suite classifier rejects an extra FAIL inside playerAbility.test.mjs", () => {
  const log = readFileSync(logPath, "utf8");
  const forecast = /^# OK\s+forecast: cached by signature, does not touch career rng$/m;
  assert.equal(forecast.test(log), true, "forecast OK marker must exist in supplied log");
  const extraAbilityFailure = log.replace(
    forecast,
    "# FAIL forecast: cached by signature, does not touch career rng\n# AssertionError [ERR_ASSERTION]: synthetic additional failure for gate verification"
  );
  const actual = loadClassifier(ALLOWED)(extraAbilityFailure);
  assert.equal(actual.ok, false, JSON.stringify(actual));
  assert.equal(actual.reason, "unexpected-failed-assertions");
  assert.ok(
    (actual.unexpectedFails || []).includes(
      "forecast: cached by signature, does not touch career rng"
    )
  );
});
