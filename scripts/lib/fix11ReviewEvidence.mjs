/**
 * Shared Fix 11 package-evidence assessor.
 *
 * Package and verifier both call the same assessor so missing or fabricated
 * evidence cannot be promoted by manifest claims or checksum-only lists.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  GK_OVERALL_WEIGHTS,
  OUTFIELD_OVERALL_WEIGHTS,
} from "../../js/config/playerDevelopmentConfig.js";
import { EPSILON, reconcileGrossPositive } from "./fix11GrowthEvidence.mjs";

export const EVIDENCE_SCHEMA = "fix11-review-evidence-v2";
export const BROWSER_IDS = Array.from({ length: 8 }, (_, i) => `B${String(i + 1).padStart(2, "0")}`);
export const REQUIRED_SOURCE_FILES = [
  "scripts/browserFullCareerGrowthChecklist.mjs",
  "scripts/calibrateFullCareerGrowth.mjs",
  "scripts/packageFix11Review.mjs",
  "scripts/verifyFix11Review.mjs",
  "scripts/lib/fix11ReviewEvidence.mjs",
  "scripts/lib/fix11GrowthEvidence.mjs",
  "tests/fullCareerGrowthCalibration.test.mjs",
  "js/simulation/playerDevelopmentModel.js",
  "js/simulation/seasonEvidence.js",
  "js/simulation/seasonSimulator.js",
  "qa/fix11-runs/witnesses/index.json",
  "qa/fix11-runs/plan.json",
  "reports/fix11-growth-audit.md",
  "reports/fix11-full-career-growth-calibration.md",
  "reports/fix11-full-career-growth-completion.md",
];
export const REQUIRED_RUNTIME_FIXTURES = [
  "qa/fix10-runs/calibration-targets.json",
  "qa/fix09-runs/final/full-suite.log",
];

export function listFiles(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) listFiles(path, base, out);
    else out.push(path.slice(base.length + 1).split("\\").join("/"));
  }
  return out.sort();
}

export function readJson(path) {
  if (!existsSync(path)) return { ok: false, error: "missing", value: null };
  try {
    return { ok: true, error: null, value: JSON.parse(readFileSync(path, "utf8")) };
  } catch (error) {
    return { ok: false, error: `parse: ${error.message}`, value: null };
  }
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function computeSourceManifest(sourceDir) {
  const files = listFiles(sourceDir).map((path) => {
    const full = join(sourceDir, path);
    return { path, size: statSync(full).size, sha256: sha256File(full) };
  });
  const sha256 = createHash("sha256")
    .update(files.map((file) => `${file.sha256}  ${file.size}  ${file.path}\n`).join(""))
    .digest("hex");
  return { algorithm: "sha256-lines(sha256  size  path)", fileCount: files.length, sha256, files };
}

function gate(ok, reason, extra = {}) {
  return { ok: ok === true, reason: ok ? "ok" : reason, ...extra };
}

function weightedOverall(attributes, position) {
  const weights =
    position === "GK"
      ? GK_OVERALL_WEIGHTS
      : OUTFIELD_OVERALL_WEIGHTS[position] || OUTFIELD_OVERALL_WEIGHTS.CM || {};
  let sum = 0;
  let weight = 0;
  for (const [attr, value] of Object.entries(attributes || {})) {
    const w = Number(weights[attr]) || 0;
    if (!(w > 0) || !Number.isFinite(Number(value))) continue;
    sum += Number(value) * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : null;
}

function assessSource(packageRoot) {
  const source = join(packageRoot, "source");
  const missing = REQUIRED_SOURCE_FILES.filter((path) => !existsSync(join(source, path)));
  const actual = computeSourceManifest(source);
  const stored = readJson(join(packageRoot, "source-content-manifest.json"));
  const problems = missing.map((path) => `required-source-missing:${path}`);
  if (actual.fileCount === 0) problems.push("source-empty");
  if (!stored.ok) problems.push(`source-content-manifest-${stored.error}`);
  else {
    if (stored.value?.sha256 !== actual.sha256) problems.push("source-content-sha256-mismatch");
    if (stored.value?.fileCount !== actual.fileCount) problems.push("source-content-file-count-mismatch");
  }
  for (const fixture of REQUIRED_RUNTIME_FIXTURES) {
    if (!existsSync(join(source, fixture)) && !existsSync(join(packageRoot, fixture))) {
      problems.push(`runtime-fixture-missing:${fixture}`);
    }
  }
  return {
    gate: gate(problems.length === 0, "source-manifest-invalid", {
      fileCount: actual.fileCount,
      sha256: actual.sha256,
      problems,
    }),
    manifest: actual,
  };
}

function findWitnessFiles(packageRoot) {
  const roots = [
    join(packageRoot, "source/qa/fix11-runs/witnesses"),
    join(packageRoot, "qa/fix11-runs/witnesses"),
  ];
  const files = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const path of listFiles(root)) files.push(join(root, path));
  }
  return files;
}

function assessWitnessIndex(packageRoot) {
  const candidates = [
    join(packageRoot, "source/qa/fix11-runs/witnesses/index.json"),
    join(packageRoot, "qa/fix11-runs/witnesses/index.json"),
  ];
  const path = candidates.find((p) => existsSync(p));
  if (!path) return gate(false, "witness-index-missing");
  const parsed = readJson(path);
  if (!parsed.ok) return gate(false, `witness-index-${parsed.error}`);
  const ids = (parsed.value.witnesses || []).map((w) => w.id);
  const required = ["cid_2369bc62", "cid_2e1ba005", "cid_85a7b61e"];
  const missing = required.filter((id) => !ids.includes(id));
  if (missing.length) return gate(false, "witness-index-incomplete", { missing });
  if (new Set(ids).size !== ids.length) return gate(false, "witness-index-ambiguous");
  return gate(true, "ok", { path: path.slice(packageRoot.length + 1), ids });
}

function assessNatural99(packageRoot) {
  const files = findWitnessFiles(packageRoot);
  const career = files.find((path) => /natural-99\/career\.json$/i.test(path));
  const snapshot = files.find((path) => /natural-99\/snapshot-natural-99\.json$/i.test(path));
  if (!career) return gate(false, "natural-99-career-missing");
  if (!snapshot) return gate(false, "natural-99-snapshot-missing");
  const careerJson = readJson(career);
  const snapJson = readJson(snapshot);
  if (!careerJson.ok) return gate(false, `natural-99-career-${careerJson.error}`);
  if (!snapJson.ok) return gate(false, `natural-99-snapshot-${snapJson.error}`);

  const problems = [];
  const c = careerJson.value;
  if (c.id !== "cid_85a7b61e") problems.push("career-id-mismatch");
  if (!c.everDisplayed99) problems.push("everDisplayed99-false");
  if (!Array.isArray(c.seasons) || c.seasons.length < 10) problems.push("career-history-too-short");
  const crossing = (c.seasons || []).find((row) => row.displayed99 || row.seasonNumber === 17);
  if (!crossing) problems.push("crossing-season-missing");
  else {
    if (!(Number(crossing.rawAfter) >= 98.5)) problems.push("crossing-raw-below-threshold");
    if (!(Number(crossing.rawBefore) < 98.5)) problems.push("crossing-rawBefore-not-pre-threshold");
  }

  const before = snapJson.value?.beforeSnapshot;
  const after = snapJson.value?.afterSnapshot;
  const beforeRaw = Number(before?.player?.baseOverallRaw ?? before?.player?.currentOverallRaw);
  const afterRaw = Number(after?.player?.baseOverallRaw ?? after?.player?.currentOverallRaw);
  if (!before?.player?.attributes || !after?.player?.attributes) problems.push("snapshot-attributes-missing");
  if (!(before?.player?.seasons?.length > 0)) problems.push("snapshot-season-history-missing");
  if (!(beforeRaw < 98.5 && afterRaw >= 98.5 && afterRaw < 99)) problems.push("snapshot-threshold-invalid");
  // Reject fabricated cache-only replacements: require durable attrs and recomputed weighted overall.
  const position = after?.player?.position || before?.player?.position;
  const recomputed = weightedOverall(after?.player?.attributes, position);
  if (recomputed == null || Math.abs(recomputed - afterRaw) > 0.75) {
    problems.push("snapshot-weighted-overall-mismatch");
  }
  if (!Array.isArray(after?.player?.seasons) || after.player.seasons.length < (before?.player?.seasons?.length || 0)) {
    problems.push("snapshot-after-history-incomplete");
  }
  // Fabricated stubs used empty worlds and no season history.
  if (!before?.world || Object.keys(before.world).length < 5) problems.push("snapshot-world-too-thin");

  return gate(problems.length === 0, "natural-99-witness-invalid", {
    career: career.slice(packageRoot.length + 1),
    snapshot: snapshot.slice(packageRoot.length + 1),
    problems,
    beforeRaw,
    afterRaw,
    recomputed,
  });
}

function assessPlusWitnesses(packageRoot) {
  const files = findWitnessFiles(packageRoot);
  const problems = [];
  for (const [id, fileHint, delta] of [
    ["cid_2369bc62", "career-plus6.json", 6],
    ["cid_2e1ba005", "career-plus7.json", 7],
  ]) {
    const careerPath = files.find((path) => path.endsWith(fileHint));
    if (!careerPath) {
      problems.push(`missing:${id}`);
      continue;
    }
    const parsed = readJson(careerPath);
    if (!parsed.ok || parsed.value?.id !== id) problems.push(`identity:${id}`);
    const season = (parsed.value?.seasons || []).find((row) => Math.abs(Number(row.displayedDelta)) === delta);
    if (!season) problems.push(`delta-missing:${id}`);
  }
  return gate(problems.length === 0, "plus-witnesses-invalid", { problems });
}

function assessAccountingTests(packageRoot) {
  const logCandidates = [
    "qa/fix11-runs/logs/accounting-tests.log",
    "qa/fix11-runs/logs/full-career-growth-tests.log",
    "qa/fix11-runs/logs/full-suite.log",
    "source/qa/fix11-runs/logs/full-suite.log",
    "source/qa/fix11-runs/logs/full-career-growth-tests.log",
  ].map((path) => join(packageRoot, path));
  const log = logCandidates.find((path) => existsSync(path) && statSync(path).size > 0);
  if (!log) return gate(false, "accounting-test-log-missing");
  const text = readFileSync(log, "utf8");
  const coherent = /^# tests \d+/m.test(text) && /^# fail 0\s*$/m.test(text);
  // Historical Fix 09 classifier fixture must not be treated as current success.
  const isHistoricalClassifier = /fix09-runs\/final\/full-suite\.log$/.test(log);
  if (isHistoricalClassifier) return gate(false, "historical-classifier-log-not-current-evidence");
  return gate(coherent, "accounting-tests-not-clean", {
    log: log.slice(packageRoot.length + 1),
  });
}

function assessBrowser(packageRoot) {
  const candidates = [
    join(packageRoot, "qa/fix11-runs/browser/browser-report.json"),
    join(packageRoot, "source/qa/fix11-runs/browser/browser-report.json"),
  ];
  const path = candidates.find((p) => existsSync(p));
  const parsed = path ? readJson(path) : { ok: false, error: "missing" };
  if (!parsed.ok) return gate(false, `browser-report-${parsed.error}`);
  const report = parsed.value || {};
  const problems = [];
  for (const id of BROWSER_IDS) {
    if (report.cases?.[id]?.status !== "PASS") problems.push(`${id}:${report.cases?.[id]?.status || "missing"}`);
  }
  if (report.requiredComplete !== true) problems.push("requiredComplete-not-true");
  if (report.subsetOnly === true) problems.push("subsetOnly");
  // B03/B04 must prove real season play, not endpoint imports.
  for (const id of ["B03", "B04"]) {
    const row = report.cases?.[id];
    if (!row) continue;
    if (row.endpointImportUsed === true) problems.push(`${id}:endpoint-import`);
    if (/imported authoritative replay-derived before\/after/i.test(String(row.verification || ""))) {
      problems.push(`${id}:endpoint-import-verification`);
    }
    if (row.endpointImportUsed === false && Number(row.continueClicks || 0) < 1) {
      problems.push(`${id}:missing-continue`);
    }
  }
  return gate(problems.length === 0, "browser-report-incomplete", { problems });
}

function assessHoldoutAndPaired(packageRoot) {
  const candidates = [
    join(packageRoot, "qa/fix11-runs"),
    join(packageRoot, "source/qa/fix11-runs"),
  ];
  const problems = [];
  let holdoutOk = false;
  let pairedOk = false;
  let componentsOk = false;
  for (const root of candidates) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const summaryPath = join(root, name, "summary.json");
      if (!existsSync(summaryPath)) continue;
      const summary = readJson(summaryPath);
      if (!summary.ok) continue;
      const s = summary.value;
      if (s.mode === "holdout" && (s.counts?.trajectories || 0) >= 5000) {
        holdoutOk = true;
        if (s.assessment?.ok === false) problems.push("holdout-assessment-failed");
      }
      if (
        (s.counts?.pairedNaturalCareers || 0) >= 24 ||
        (s.pairedStudies?.naturalCareerIdentityTotal || 0) >= 24 ||
        existsSync(join(root, name, "paired", "career-pair-0.json"))
      ) {
        pairedOk = true;
      }
      if ((s.checks?.naturalComponentAccountingFailures || 0) === 0 && (s.counts?.careersCompleted || 0) > 0) {
        componentsOk = true;
      }
    }
  }
  if (!holdoutOk) problems.push("holdout-5000-missing");
  if (!pairedOk) problems.push("paired-natural-careers-missing");
  return gate(problems.length === 0, "calibration-provenance-incomplete", {
    problems,
    holdoutOk,
    pairedOk,
    componentsOk,
  });
}

function assessClosure(packageRoot) {
  const candidates = [
    join(packageRoot, "CLOSURE.md"),
    join(packageRoot, "qa/fix11-runs/CLOSURE.md"),
    join(packageRoot, "reports/fix11-rereview-closure.md"),
  ];
  const path = candidates.find((p) => existsSync(p));
  if (!path) return gate(false, "closure-missing");
  const text = readFileSync(path, "utf8");
  const required = ["R1", "R2", "R3", "R4", "R5", "R6"];
  const missing = required.filter((id) => !text.includes(id));
  return gate(missing.length === 0, "closure-incomplete", {
    path: path.slice(packageRoot.length + 1),
    missing,
  });
}

/**
 * Re-derive Fix 11 readiness from package bytes.
 */
export function assessPackageEvidence(packageRoot, { finalSha = null } = {}) {
  const source = assessSource(packageRoot);
  const gates = {
    sourceManifest: source.gate,
    witnessIndex: assessWitnessIndex(packageRoot),
    natural99Witness: assessNatural99(packageRoot),
    plusWitnesses: assessPlusWitnesses(packageRoot),
    accountingTests: assessAccountingTests(packageRoot),
    browser: assessBrowser(packageRoot),
    calibrationProvenance: assessHoldoutAndPaired(packageRoot),
    closure: assessClosure(packageRoot),
  };
  const ready = Object.values(gates).every((value) => value.ok);
  return {
    ready,
    gates,
    evidence: {
      schema: EVIDENCE_SCHEMA,
      ready,
      finalSha,
      gates,
      sourceManifest: {
        sha256: source.manifest.sha256,
        fileCount: source.manifest.fileCount,
      },
    },
    sourceManifest: source.manifest,
  };
}

/** Exported for unit tests / negative controls. */
export const __test = {
  weightedOverall,
  reconcileGrossPositive,
  EPSILON,
};
