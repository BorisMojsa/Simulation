/**
 * Shared Fix 11 package-evidence assessor.
 *
 * Package and verifier both call the same assessor so missing or fabricated
 * evidence cannot be promoted by manifest claims or checksum-only lists.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const EPSILON = 1e-6;
export const DISPLAYED_99_THRESHOLD = 98.5;
export const ACCEPTED_BASE_SHA = "8d74769ec31b0e240f55414121d0a895d414304e";
export const HOLDOUT_SEED_START = 500000;
export const HOLDOUT_SEED_END_EXCLUSIVE = 505000;
export const HOLDOUT_EXPECTED_COUNT = HOLDOUT_SEED_END_EXCLUSIVE - HOLDOUT_SEED_START;

const WEIGHTS_CACHE = new Map();

async function loadOverallWeights(packageRoot = null) {
  const key = packageRoot || "__default__";
  if (WEIGHTS_CACHE.has(key)) return WEIGHTS_CACHE.get(key);
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    packageRoot ? join(packageRoot, "source/js/config/playerDevelopmentConfig.js") : null,
    packageRoot ? join(packageRoot, "js/config/playerDevelopmentConfig.js") : null,
    packageRoot ? join(packageRoot, "verifier/js/config/playerDevelopmentConfig.js") : null,
    join(here, "../js/config/playerDevelopmentConfig.js"),
    join(here, "../../js/config/playerDevelopmentConfig.js"),
  ].filter(Boolean);
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const mod = await import(pathToFileURL(path).href);
      WEIGHTS_CACHE.set(key, mod);
      return mod;
    } catch {
      /* try next */
    }
  }
  WEIGHTS_CACHE.set(key, null);
  return null;
}

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

function attributeKeysForPosition(position, mod) {
  if (!mod) return null;
  if (String(position || "").toUpperCase() === "GK") {
    return Array.isArray(mod.GK_ATTRIBUTE_KEYS) ? [...mod.GK_ATTRIBUTE_KEYS] : null;
  }
  return Array.isArray(mod.OUTFIELD_ATTRIBUTE_KEYS) ? [...mod.OUTFIELD_ATTRIBUTE_KEYS] : null;
}

function weightsForPosition(position, mod) {
  if (!mod) return null;
  if (String(position || "").toUpperCase() === "GK") {
    return mod.GK_OVERALL_WEIGHTS || null;
  }
  const table = mod.OUTFIELD_OVERALL_WEIGHTS || null;
  if (!table || typeof table !== "object") return null;
  const key = String(position || "").toUpperCase();
  if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
  return null;
}

/**
 * Strict position-weighted overall. Never substitutes a mean or partial set.
 * Returns null when position/config/attributes cannot be resolved.
 */
export function weightedOverall(attributes, position, mod = null) {
  const keys = attributeKeysForPosition(position, mod);
  const weights = weightsForPosition(position, mod);
  if (!keys || !weights || typeof weights !== "object") return null;
  if (!attributes || typeof attributes !== "object") return null;
  const attrMin = Number(mod?.ATTRIBUTE_MIN ?? 1);
  const attrMax = Number(mod?.ATTRIBUTE_MAX ?? 99);
  let sum = 0;
  let weight = 0;
  for (const key of keys) {
    const value = Number(attributes[key]);
    const w = Number(weights[key]);
    if (!(w > 0)) return null;
    if (!Number.isFinite(value) || value < attrMin || value > attrMax) return null;
    sum += value * w;
    weight += w;
  }
  if (!(Math.abs(weight - 1) <= 1e-9 || weight > 0)) return null;
  return weight > 0 ? sum / weight : null;
}

function displayedOverall(raw) {
  return Number.isFinite(raw) ? Math.round(raw) : null;
}

function displayedGainFromRaw(before, after) {
  const a = displayedOverall(before);
  const b = displayedOverall(after);
  return a == null || b == null ? null : b - a;
}

function near(a, b, tol = EPSILON) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;
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

function preferQaPath(packageRoot, relativePath) {
  const qa = join(packageRoot, relativePath);
  const source = join(packageRoot, "source", relativePath);
  if (existsSync(qa)) return qa;
  if (existsSync(source)) return source;
  return null;
}

function findWitnessFiles(packageRoot) {
  // Prefer the external qa/ tree (canonical review evidence) over source/ mirrors.
  const roots = [
    join(packageRoot, "qa/fix11-runs/witnesses"),
    join(packageRoot, "source/qa/fix11-runs/witnesses"),
  ];
  const files = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const path of listFiles(root)) files.push(join(root, path));
  }
  return files;
}

function assessWitnessIndex(packageRoot) {
  const path = preferQaPath(packageRoot, "qa/fix11-runs/witnesses/index.json");
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

async function assessNatural99(packageRoot) {
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
  const indexPath = preferQaPath(packageRoot, "qa/fix11-runs/witnesses/index.json");
  const index = indexPath ? readJson(indexPath) : { ok: false };
  const indexed = (index.value?.witnesses || []).find((row) => row.id === "cid_85a7b61e");
  if (!indexed) problems.push("index-claim-missing");
  else {
    if (indexed.expected?.careerId !== "cid_85a7b61e") problems.push("index-career-id-mismatch");
    if (Number(indexed.expected?.seasonNumber) !== 17) problems.push("index-season-mismatch");
  }

  if (c.id !== "cid_85a7b61e") problems.push("career-id-mismatch");
  if (!c.everDisplayed99) problems.push("everDisplayed99-false");
  if (!Array.isArray(c.seasons) || c.seasons.length < 10) problems.push("career-history-too-short");
  const crossing = (c.seasons || []).find((row) => row.displayed99 || row.seasonNumber === 17);
  if (!crossing) problems.push("crossing-season-missing");
  else {
    if (!(Number(crossing.rawAfter) >= DISPLAYED_99_THRESHOLD)) problems.push("crossing-raw-below-threshold");
    if (!(Number(crossing.rawBefore) < DISPLAYED_99_THRESHOLD)) problems.push("crossing-rawBefore-not-pre-threshold");
    if (displayedGainFromRaw(crossing.rawBefore, crossing.rawAfter) == null) {
      problems.push("crossing-displayed-underivable");
    }
    if (indexed?.expected) {
      if (!near(Number(crossing.rawBefore), Number(indexed.expected.rawBefore))) {
        problems.push("crossing-rawBefore-claim-mismatch");
      }
      if (!near(Number(crossing.rawAfter), Number(indexed.expected.rawAfter))) {
        problems.push("crossing-rawAfter-claim-mismatch");
      }
    }
  }

  const before = snapJson.value?.beforeSnapshot;
  const after = snapJson.value?.afterSnapshot;
  const beforeCached = Number(before?.player?.baseOverallRaw ?? before?.player?.currentOverallRaw);
  const afterCached = Number(after?.player?.baseOverallRaw ?? after?.player?.currentOverallRaw);
  if (!before?.player?.attributes || !after?.player?.attributes) problems.push("snapshot-attributes-missing");
  if (!(before?.player?.seasons?.length > 0)) problems.push("snapshot-season-history-missing");
  if (!before?.world || Object.keys(before.world).length < 5) problems.push("snapshot-world-too-thin");
  if (!Array.isArray(after?.player?.seasons) || after.player.seasons.length < (before?.player?.seasons?.length || 0)) {
    problems.push("snapshot-after-history-incomplete");
  }

  const position = after?.player?.position || before?.player?.position;
  const weights = await loadOverallWeights(packageRoot);
  if (!weights) problems.push("overall-weights-unresolved");
  const keys = attributeKeysForPosition(position, weights);
  if (!keys) problems.push("position-unresolved");
  else {
    for (const side of [
      ["before", before?.player?.attributes],
      ["after", after?.player?.attributes],
    ]) {
      const [label, attrs] = side;
      for (const key of keys) {
        const value = Number(attrs?.[key]);
        const attrMin = Number(weights?.ATTRIBUTE_MIN ?? 1);
        const attrMax = Number(weights?.ATTRIBUTE_MAX ?? 99);
        if (!Number.isFinite(value)) problems.push(`${label}-attr-missing:${key}`);
        else if (value < attrMin || value > attrMax) problems.push(`${label}-attr-oob:${key}`);
      }
    }
  }

  const recomputedBefore = weightedOverall(before?.player?.attributes, position, weights);
  const recomputedAfter = weightedOverall(after?.player?.attributes, position, weights);
  if (recomputedBefore == null) problems.push("recomputed-before-null");
  if (recomputedAfter == null) problems.push("recomputed-after-null");
  if (recomputedBefore != null && !near(recomputedBefore, beforeCached)) {
    problems.push("before-cache-mismatch");
  }
  if (recomputedAfter != null && !near(recomputedAfter, afterCached)) {
    problems.push("after-cache-mismatch");
  }
  if (!(recomputedBefore < DISPLAYED_99_THRESHOLD)) problems.push("recomputed-before-not-pre-threshold");
  if (!(recomputedAfter >= DISPLAYED_99_THRESHOLD)) problems.push("recomputed-after-below-threshold");
  if (!(recomputedAfter < 99)) problems.push("recomputed-after-not-displayed-99-band");
  // Cached endpoints must also sit on the crossing (defence in depth).
  if (!(beforeCached < DISPLAYED_99_THRESHOLD && afterCached >= DISPLAYED_99_THRESHOLD && afterCached < 99)) {
    problems.push("snapshot-threshold-invalid");
  }
  if (crossing && recomputedAfter != null && !near(recomputedAfter, Number(crossing.rawAfter))) {
    problems.push("snapshot-career-rawAfter-mismatch");
  }

  return gate(problems.length === 0, "natural-99-witness-invalid", {
    career: career.slice(packageRoot.length + 1),
    snapshot: snapshot.slice(packageRoot.length + 1),
    problems,
    beforeCached,
    afterCached,
    recomputedBefore,
    recomputedAfter,
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
    const season = (parsed.value?.seasons || []).find((row) => {
      const derived = displayedGainFromRaw(row.rawBefore, row.rawAfter);
      return derived === delta;
    });
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
  const isHistoricalClassifier = /fix09-runs\/final\/full-suite\.log$/.test(log);
  if (isHistoricalClassifier) return gate(false, "historical-classifier-log-not-current-evidence");
  return gate(coherent, "accounting-tests-not-clean", {
    log: log.slice(packageRoot.length + 1),
  });
}

function assessBrowser(packageRoot) {
  const path = preferQaPath(packageRoot, "qa/fix11-runs/browser/browser-report.json");
  const parsed = path ? readJson(path) : { ok: false, error: "missing" };
  if (!parsed.ok) return gate(false, `browser-report-${parsed.error}`);
  const report = parsed.value || {};
  const problems = [];
  for (const id of BROWSER_IDS) {
    if (report.cases?.[id]?.status !== "PASS") problems.push(`${id}:${report.cases?.[id]?.status || "missing"}`);
  }
  if (report.requiredComplete !== true) problems.push("requiredComplete-not-true");
  if (report.subsetOnly === true) problems.push("subsetOnly");
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

function findRunDir(packageRoot, preferredNames = []) {
  const roots = [
    join(packageRoot, "qa/fix11-runs"),
    join(packageRoot, "source/qa/fix11-runs"),
  ];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const name of preferredNames) {
      const path = join(root, name);
      if (existsSync(path)) return path;
    }
  }
  return null;
}

function assessHoldoutRaw(holdoutDir, plan) {
  const problems = [];
  const trajDir = join(holdoutDir, "trajectories");
  if (!existsSync(trajDir)) return { ok: false, problems: ["holdout-trajectories-dir-missing"], count: 0 };
  const files = readdirSync(trajDir).filter((name) => name.endsWith(".json")).sort();
  const expectedIds = [];
  for (let seed = HOLDOUT_SEED_START; seed < HOLDOUT_SEED_END_EXCLUSIVE; seed++) {
    expectedIds.push(`trajectory-${seed}`);
  }
  const seen = new Set();
  const seeds = new Set();
  let reconciliationFailures = 0;
  let ordinaryCapFailures = 0;
  let breakthroughCapFailures = 0;
  let malformed = 0;
  for (const name of files) {
    const parsed = readJson(join(trajDir, name));
    if (!parsed.ok) {
      malformed++;
      problems.push(`holdout-malformed:${name}`);
      continue;
    }
    const row = parsed.value;
    const id = row.id || name.replace(/\.json$/, "");
    if (seen.has(id)) problems.push(`holdout-duplicate:${id}`);
    seen.add(id);
    const seed = Number(row.seed);
    if (!Number.isInteger(seed)) problems.push(`holdout-seed-missing:${id}`);
    else {
      if (seeds.has(seed)) problems.push(`holdout-seed-duplicate:${seed}`);
      seeds.add(seed);
      if (seed < HOLDOUT_SEED_START || seed >= HOLDOUT_SEED_END_EXCLUSIVE) {
        problems.push(`holdout-seed-out-of-range:${seed}`);
      }
    }
    if (row.cohort !== "holdout") problems.push(`holdout-cohort-mismatch:${id}`);
    if (row.kind !== "synthetic-trajectory") problems.push(`holdout-kind-mismatch:${id}`);
    reconciliationFailures += Number(row.checks?.reconciliationFailures || 0);
    ordinaryCapFailures += Number(row.checks?.ordinaryCapFailures || 0);
    breakthroughCapFailures += Number(row.checks?.breakthroughCapFailures || 0);
  }
  for (const id of expectedIds) {
    if (!seen.has(id)) problems.push(`holdout-missing:${id}`);
  }
  if (files.length !== HOLDOUT_EXPECTED_COUNT) {
    problems.push(`holdout-count-mismatch:${files.length}`);
  }
  const summary = readJson(join(holdoutDir, "summary.json"));
  if (!summary.ok) problems.push("holdout-summary-missing");
  else {
    const advertised = Number(summary.value?.counts?.trajectories);
    if (advertised !== HOLDOUT_EXPECTED_COUNT) problems.push(`holdout-summary-count:${advertised}`);
    if (summary.value?.mode !== "holdout") problems.push("holdout-summary-mode");
    if (Number(summary.value?.checks?.reconciliationFailures) !== reconciliationFailures) {
      problems.push("holdout-summary-reconciliation-mismatch");
    }
    if (Number(summary.value?.checks?.ordinaryCapFailures) !== ordinaryCapFailures) {
      problems.push("holdout-summary-ordinary-cap-mismatch");
    }
    if (Number(summary.value?.checks?.breakthroughCapFailures) !== breakthroughCapFailures) {
      problems.push("holdout-summary-breakthrough-cap-mismatch");
    }
    if (summary.value?.assessment?.ok === false) problems.push("holdout-assessment-failed");
    const range = plan?.seedDeclarations?.holdout?.precommittedRange;
    if (
      !range ||
      range.startInclusive !== HOLDOUT_SEED_START ||
      range.endExclusive !== HOLDOUT_SEED_END_EXCLUSIVE
    ) {
      problems.push("holdout-plan-range-mismatch");
    }
    // Disjointness: holdout seeds must not appear in the calibration root declaration.
    if (plan?.seedDeclarations?.holdout?.mayUseDuringTuning === true) {
      problems.push("holdout-may-use-during-tuning");
    }
  }
  return {
    ok: problems.length === 0,
    problems,
    count: seen.size,
    reconciliationFailures,
    ordinaryCapFailures,
    breakthroughCapFailures,
  };
}

function summarizeCareerSide(career) {
  if (!career) return null;
  const seasons = Array.isArray(career.seasons) ? career.seasons : [];
  return {
    id: career.id ?? null,
    peakRaw: career.peakRaw ?? null,
    everDisplayed99: Boolean(career.everDisplayed99),
    completed: Boolean(career.completed),
    seasons: seasons.length,
    minutes: seasons.reduce((sum, row) => sum + (Number(row.minutes) || 0), 0),
    unemploymentPeriods: seasons.filter((row) => row.freeAgent || row.unemployed).length,
    periodGrowth: seasons.map((row) => Number(row.rawDelta)).filter(Number.isFinite),
  };
}

function assessBaseFinalPaired(pairedDir) {
  const problems = [];
  if (!pairedDir || !existsSync(pairedDir)) {
    return { ok: false, problems: ["paired-base-final-dir-missing"], count: 0 };
  }
  const summary = readJson(join(pairedDir, "summary.json"));
  const pairedRoot = existsSync(join(pairedDir, "paired")) ? join(pairedDir, "paired") : pairedDir;
  const files = existsSync(pairedRoot)
    ? readdirSync(pairedRoot).filter((name) => /^career-pair-\d+\.json$/.test(name)).sort()
    : [];
  if (files.length < 24) problems.push(`paired-base-final-count:${files.length}`);
  let identityOnly = 0;
  let matched = 0;
  for (const name of files) {
    const parsed = readJson(join(pairedRoot, name));
    if (!parsed.ok) {
      problems.push(`paired-malformed:${name}`);
      continue;
    }
    const row = parsed.value;
    if (row.kind === "paired-natural-career-identity") {
      identityOnly++;
      problems.push(`paired-same-engine-identity:${row.id || name}`);
      continue;
    }
    if (row.kind !== "paired-natural-career-base-final") {
      problems.push(`paired-kind-invalid:${row.id || name}`);
      continue;
    }
    const baseSha = String(row.base?.engineIdentity || row.baseRevision || "");
    const finalSha = String(row.final?.engineIdentity || row.finalRevision || "");
    if (baseSha !== ACCEPTED_BASE_SHA) problems.push(`paired-base-identity:${row.id}`);
    if (!finalSha || finalSha === baseSha) problems.push(`paired-final-identity:${row.id}`);
    if (!row.base?.career || !row.final?.career) problems.push(`paired-missing-side:${row.id}`);
    else {
      matched++;
      if (row.base.career.seed !== row.final.career.seed && row.seed == null) {
        problems.push(`paired-seed-unshared:${row.id}`);
      }
      if (row.policy && row.base.career.policy && row.base.career.policy !== row.policy) {
        problems.push(`paired-base-policy:${row.id}`);
      }
      if (row.policy && row.final.career.policy && row.final.career.policy !== row.policy) {
        problems.push(`paired-final-policy:${row.id}`);
      }
    }
  }
  if (summary.ok) {
    if (summary.value?.pairedStudies?.naturalCareerIdentityTotal >= 24 && matched < 24) {
      // Identity-only summaries cannot satisfy the gate.
      problems.push("paired-summary-identity-only");
    }
    const advertised = Number(
      summary.value?.counts?.pairedBaseFinal ||
        summary.value?.pairedStudies?.baseFinalTotal ||
        summary.value?.counts?.pairedNaturalCareers ||
        0
    );
    if (advertised < 24 && matched < 24) problems.push("paired-summary-count");
  } else {
    problems.push("paired-summary-missing");
  }
  if (identityOnly > 0 && matched < 24) problems.push("paired-same-engine-only");
  return { ok: problems.length === 0 && matched >= 24, problems, count: matched, identityOnly };
}

function assessNaturalComponents(packageRoot) {
  const problems = [];
  const careerPath = preferQaPath(packageRoot, "qa/fix11-runs/witnesses/natural-99/career.json");
  if (!careerPath) return { ok: false, problems: ["natural-components-career-missing"] };
  const parsed = readJson(careerPath);
  if (!parsed.ok) return { ok: false, problems: ["natural-components-career-unreadable"] };
  let seasonsWithComponents = 0;
  for (const season of parsed.value.seasons || []) {
    const minutes = Number(season.minutes) || 0;
    const rawDelta = Number(season.rawDelta);
    const expectsDevelopment =
      minutes > 0 ||
      (Number.isFinite(rawDelta) && Math.abs(rawDelta) > EPSILON) ||
      Boolean(season.components) ||
      Boolean(season.learning);
    const components = season.components || season.learning;
    if (!expectsDevelopment) continue;
    if (!components || typeof components !== "object") {
      problems.push(`natural-components-missing:season-${season.seasonNumber}`);
      continue;
    }
    seasonsWithComponents++;
    for (const key of ["learning", "recognition", "positiveShock", "ageing", "shock", "restoration"]) {
      if (!(key in components)) problems.push(`natural-components-field-missing:${key}@${season.seasonNumber}`);
      else if (components[key] == null) problems.push(`natural-components-null:${key}@${season.seasonNumber}`);
    }
  }
  if (seasonsWithComponents < 10) problems.push("natural-components-coverage-low");
  return { ok: problems.length === 0, problems, seasonsWithComponents };
}

function assessControlledPerformanceOnly(packageRoot) {
  const dir = findRunDir(packageRoot, ["controlled-final"]);
  if (!dir) return { ok: false, problems: ["controlled-final-missing"] };
  const problems = [];
  const controlled = readJson(join(dir, "controlled.json"));
  if (!controlled.ok) return { ok: false, problems: ["controlled-json-missing"] };
  for (const band of ["poor", "ordinary", "good", "exceptional"]) {
    const block = controlled.value?.[band];
    if (!block) {
      problems.push(`controlled-band-missing:${band}`);
      continue;
    }
    if (block.treatment !== "signed-performance-P_long-only") {
      problems.push(`controlled-treatment:${band}`);
    }
    const rows = block.rows || [];
    if (rows.length < 24) problems.push(`controlled-rows:${band}:${rows.length}`);
    for (const row of rows.slice(0, 3)) {
      if (row.treatment !== "signed-performance-P_long-only") problems.push(`controlled-row-treatment:${band}`);
      if (!row.sharedContext || typeof row.sharedContext !== "object") {
        problems.push(`controlled-shared-context:${band}`);
      }
      if (!Number.isFinite(Number(row.P_long))) problems.push(`controlled-p-long:${band}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

function assessHoldoutAndPaired(packageRoot) {
  const problems = [];
  const planPath = preferQaPath(packageRoot, "qa/fix11-runs/plan.json");
  const plan = planPath ? readJson(planPath).value : null;
  if (!plan) problems.push("plan-missing");

  const holdoutDir = findRunDir(packageRoot, ["holdout-final"]);
  const holdout = holdoutDir
    ? assessHoldoutRaw(holdoutDir, plan)
    : { ok: false, problems: ["holdout-5000-missing"], count: 0 };
  problems.push(...holdout.problems);

  const pairedDir = findRunDir(packageRoot, ["paired-base-final", "paired-rereview"]);
  const paired = assessBaseFinalPaired(pairedDir);
  // paired-rereview identity-only must not satisfy; require paired-base-final specifically when present.
  const preferredPaired = findRunDir(packageRoot, ["paired-base-final"]);
  const pairedFinal = preferredPaired
    ? assessBaseFinalPaired(preferredPaired)
    : { ok: false, problems: ["paired-base-final-missing"], count: 0 };
  problems.push(...pairedFinal.problems);

  const components = assessNaturalComponents(packageRoot);
  if (!components.ok) problems.push(...components.problems);

  const controlled = assessControlledPerformanceOnly(packageRoot);
  if (!controlled.ok) problems.push(...controlled.problems);

  // Environment year treatment may exist but is labelled separately and is not this gate.
  const envNoteOk = true;

  return gate(problems.length === 0, "calibration-provenance-incomplete", {
    problems,
    holdoutOk: holdout.ok,
    pairedOk: pairedFinal.ok,
    componentsOk: components.ok,
    controlledOk: controlled.ok,
    identityOnlyRejected: (paired.identityOnly || 0) > 0 && !pairedFinal.ok ? true : undefined,
    environmentYearLabelledSeparately: envNoteOk,
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
export async function assessPackageEvidence(packageRoot, { finalSha = null } = {}) {
  const source = assessSource(packageRoot);
  const gates = {
    sourceManifest: source.gate,
    witnessIndex: assessWitnessIndex(packageRoot),
    natural99Witness: await assessNatural99(packageRoot),
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
  EPSILON,
  DISPLAYED_99_THRESHOLD,
  assessNatural99,
  assessHoldoutAndPaired,
  assessBaseFinalPaired,
  summarizeCareerSide,
  displayedGainFromRaw,
};
