/**
 * Shared Fix 10 review-package evidence assessment.
 *
 * Used by BOTH scripts/packageFix10Review.mjs (to decide `ready`) and
 * scripts/verifyFix10Review.mjs (to re-derive readiness from the package bytes
 * rather than trusting manifest.json / evidence.json claims).
 *
 * Everything is evaluated against a package root: <pkg>/qa/fix10-runs/** and <pkg>/source/**.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const EVIDENCE_SCHEMA = "fix10-rereview-evidence-v1";
export const FOCUSED_IDS = Array.from({ length: 18 }, (_, i) => `F${String(i + 1).padStart(2, "0")}`);
export const BROWSER_IDS = ["B01", "B02", "B03", "B04", "B05", "B06", "B07", "B08"];
export const COHORT_TARGET = 24;
export const REQUIRED_SOURCE_FILES = [
  "js/simulation/teamStrength.js",
  "tests/clubStrengthSuperstarImpact.test.mjs",
  "scripts/packageFix10Review.mjs",
  "scripts/verifyFix10Review.mjs",
];

/** Per-case keys that must be present so an `{ ok: true }` stub cannot satisfy F01–F18. */
const FOCUSED_REQUIRED_KEYS = {
  F01: ["runtimeClubs", "nationProfiles", "xgModel"],
  F02: ["base", "raised", "resisted"],
  F03: ["rows"],
  F04: ["m0", "m30", "m90"],
  F05: ["base", "wrongSide", "zeroMin", "absent"],
  F06: ["results"],
  F07: ["abilityUsedPath", "impact"],
  F08: ["gridSize", "left", "right"],
  F09: ["beforeST", "afterST", "expected"],
  F10: ["withHomeAttack", "former", "receiver"],
  F11: ["nonContinuingEtAtk", "continuingEtAtk"],
  F12: ["decidedBy", "aggregate"],
  F13: ["st", "model", "schema"],
  F14: ["desc"],
  F15: [],
  F16: ["fails"],
  F17: ["withNullRaw", "omitRaw"],
  F18: ["pensOdds", "twoLeg"],
};

/** Exact full-suite allowance carried from Fix 09: only these two playerAbility failures. */
export const ALLOWED_FULL_SUITE = {
  failedFiles: ["tests/playerAbility.test.mjs"],
  failures: [
    {
      testName: "development: annual cap, deconditioning is recoverable",
      assertionMarker: "learning 8.693485869706887",
    },
    {
      testName: "academy growth mutates attributes and charges shared annual allowance",
      assertionMarker: "big.realized <= 7 - r.realized + 1e-6",
    },
  ],
};

export function sha256Buf(buf) {
  return createHash("sha256").update(buf).digest("hex");
}
export function sha256File(p) {
  return sha256Buf(readFileSync(p));
}
export function gitBlobSha1(buf) {
  return createHash("sha1")
    .update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf]))
    .digest("hex");
}
export const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Sorted POSIX-relative file list; [] when dir is missing. */
export function listFiles(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) listFiles(p, base, out);
    else out.push(p.slice(base.length + 1).split("\\").join("/"));
  }
  return out.sort(cmp);
}

export function readJson(path) {
  if (!existsSync(path)) return { ok: false, error: "missing", value: null };
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, "utf8")), error: null };
  } catch (err) {
    return { ok: false, error: `parse: ${err.message}`, value: null };
  }
}

/** Content manifest of the tested source tree: per-file sha256 + aggregate hash. */
export function computeSourceManifest(sourceDir) {
  const rels = listFiles(sourceDir);
  const files = rels.map((path) => {
    const buf = readFileSync(join(sourceDir, path));
    return { path, size: buf.length, sha256: sha256Buf(buf) };
  });
  const aggregate = sha256Buf(Buffer.from(files.map((f) => `${f.sha256}  ${f.size}  ${f.path}\n`).join("")));
  return { algorithm: "sha256-lines(sha256  size  path)", fileCount: files.length, sha256: aggregate, files };
}

/* ------------------------------------------------------------------ gates */

function gate(ok, reason, extra = {}) {
  return { ok: ok === true, reason: ok ? "ok" : reason, ...extra };
}

function assessFocused(qa) {
  const bad = [];
  for (const id of FOCUSED_IDS) {
    const r = readJson(join(qa, "cases", `${id}.json`));
    if (!r.ok) {
      bad.push(`${id}:${r.error}`);
      continue;
    }
    const v = r.value;
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      bad.push(`${id}:not-object`);
      continue;
    }
    if (v.ok !== true) bad.push(`${id}:ok-not-true`);
    for (const k of FOCUSED_REQUIRED_KEYS[id] || []) {
      if (v[k] === undefined || v[k] === null) bad.push(`${id}:missing-key:${k}`);
    }
  }
  return gate(bad.length === 0, "focused-cases-incomplete", { cases: FOCUSED_IDS.length, problems: bad.slice(0, 20) });
}

function assessCalibration(qa) {
  const s = readJson(join(qa, "calibration-summary.json"));
  if (!s.ok) return gate(false, `calibration-summary-${s.error}`);
  if (s.value?.ok !== true) return gate(false, "calibration-summary-not-ok");
  const g = readJson(join(qa, "cases", "calibration-gate.json"));
  if (g.ok && (g.value?.ok !== true || (g.value?.failures || []).length > 0)) {
    return gate(false, "calibration-gate-failed");
  }
  return gate(true, "ok");
}

function assessMatched(qa, baseSha) {
  const dir = join(qa, "matched");
  const s = readJson(join(dir, "baseline-vs-final-summary.json"));
  if (!s.ok) return { gate: gate(false, `matched-summary-${s.error}`), commonInputSha256: null };
  const m = s.value || {};
  const problems = [];
  if (m.selfReplayExact !== true) problems.push("selfReplayExact-not-true");
  if (baseSha && (m.baseShaExpected !== baseSha || m.baseShaActual !== baseSha)) problems.push("base-sha-mismatch");
  if (!(m.fixtureCount > 0) || !Array.isArray(m.comparisons) || m.comparisons.length !== m.fixtureCount) {
    problems.push("fixtureCount-vs-comparisons");
  }
  const recorded = String(m.commonInputSha256 || "");
  if (!/^[0-9a-f]{64}$/.test(recorded)) problems.push("commonInputSha256-malformed");
  const inputJson = join(dir, "inputs", "common-input.json");
  const inputSha = join(dir, "inputs", "common-input.sha256");
  if (!existsSync(inputJson) || !existsSync(inputSha)) problems.push("matched-inputs-missing");
  else {
    const fileSha = readFileSync(inputSha, "utf8").trim().split(/\s+/)[0];
    const actual = sha256File(inputJson);
    if (fileSha !== recorded) problems.push("common-input.sha256-vs-summary");
    if (actual !== recorded) problems.push("common-input.json-bytes-vs-summary");
  }
  for (const rel of ["base/replay.json", "final/replay.json", "final/self-replay.json"]) {
    if (!readJson(join(dir, rel)).ok) problems.push(`missing-or-bad:${rel}`);
  }
  if (m.adapterSha256) {
    for (const rel of ["inputs/replay-adapter-base.mjs", "inputs/replay-adapter-final.mjs"]) {
      const p = join(dir, rel);
      if (!existsSync(p) || sha256File(p) !== m.adapterSha256) problems.push(`adapter-sha:${rel}`);
    }
  }
  return {
    gate: gate(problems.length === 0, "matched-compare-invalid", { problems }),
    commonInputSha256: recorded || null,
  };
}

function assessBrowser(qa) {
  const r = readJson(join(qa, "browser", "browser-report.json"));
  if (!r.ok) return gate(false, `browser-report-${r.error}`);
  const b = r.value || {};
  const problems = [];
  if (b.requiredComplete !== true) problems.push("requiredComplete-not-true");
  if (b.ok !== true) problems.push("ok-not-true");
  if (b.subsetOnly === true) problems.push("subsetOnly");
  if (b.blocked === true) problems.push("blocked");
  for (const id of BROWSER_IDS) {
    const c = b.cases?.[id];
    if (!(c === true || c?.ok === true)) problems.push(`${id}-not-ok`);
  }
  return gate(problems.length === 0, "browser-incomplete", { problems });
}

function assessCohort(qa) {
  const dir = join(qa, "career-cohort");
  const r = readJson(join(dir, "summary.json"));
  if (!r.ok) return gate(false, `career-cohort-summary-${r.error}`);
  const s = r.value || {};
  const completed = Number(s.completed);
  if (!Number.isFinite(completed)) return gate(false, "cohort-completed-missing");
  if (completed >= COHORT_TARGET) return gate(true, "ok", { completed, supplemental: 0 });
  const exclusions = Array.isArray(s.exclusions) ? s.exclusions : [];
  const documented = exclusions.filter((e) => e && e.seed != null && (e.error || e.reason));
  let supp = s.supplemental;
  if (!supp) {
    const f = readJson(join(dir, "supplemental-summary.json"));
    if (f.ok) supp = f.value;
  }
  const suppCompleted = Number(supp?.completed) || 0;
  const needed = COHORT_TARGET - completed;
  const problems = [];
  if (documented.length < needed) problems.push("exclusions-not-documented");
  if (completed + suppCompleted < COHORT_TARGET) problems.push("supplemental-short-of-target");
  if (suppCompleted > 0 && !(Array.isArray(supp?.seeds) && supp.seeds.length >= suppCompleted)) {
    problems.push("supplemental-seeds-missing");
  }
  return gate(problems.length === 0, "cohort-below-target", { completed, supplemental: suppCompleted, problems });
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function classifyFullSuiteLog(log) {
  const failedFiles = [...new Set([...log.matchAll(/^not ok \d+ - (tests\/\S+\.test\.mjs)\s*$/gm)].map((m) => m[1]))];
  const anyNotOk = [...log.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1].trim());
  const failedTests = [...log.matchAll(/^# FAIL (.+)$/gm)].map((m) => m[1].trim());
  if (!/^# (pass|fail) \d+/m.test(log)) return { ok: false, reason: "log-has-no-tap-summary", failedFiles, failedTests };
  if (failedFiles.length === 0 && anyNotOk.length === 0 && failedTests.length === 0 && /^# fail 0\s*$/m.test(log)) {
    return { ok: true, reason: "ok", failedFiles, failedTests, mode: "clean" };
  }
  const allowed = ALLOWED_FULL_SUITE.failures;
  const names = allowed.map((f) => f.testName);
  const filesOk =
    failedFiles.length === ALLOWED_FULL_SUITE.failedFiles.length &&
    failedFiles.every((f) => ALLOWED_FULL_SUITE.failedFiles.includes(f)) &&
    anyNotOk.length === failedFiles.length;
  const counts = new Map();
  for (const n of failedTests) counts.set(n, (counts.get(n) || 0) + 1);
  const unexpected = failedTests.filter((n) => !names.includes(n));
  const exactSet =
    unexpected.length === 0 &&
    failedTests.length === names.length &&
    names.every((n) => counts.get(n) === 1);
  const paired = allowed.every((f) =>
    new RegExp(`^# FAIL ${escapeRe(f.testName)}\\n[\\s\\S]{0,500}?${escapeRe(f.assertionMarker)}`, "m").test(log)
  );
  let reason = "ok";
  if (!filesOk) reason = "unexpected-failed-files";
  else if (!exactSet) reason = unexpected.length ? "unexpected-failed-assertions" : "failed-assertion-set-mismatch";
  else if (!paired) reason = "allowed-failure-marker-pairing-mismatch";
  return { ok: filesOk && exactSet && paired, reason, failedFiles, failedTests, unexpected, mode: "established-ability-exception" };
}

function assessFullSuite(qa) {
  const logPath = join(qa, "logs", "full-suite.log");
  if (existsSync(logPath)) {
    // A log, when present, is authoritative: a commands.json note can never override it.
    const c = classifyFullSuiteLog(readFileSync(logPath, "utf8"));
    return gate(c.ok, `full-suite-log-${c.reason}`, { source: "log", mode: c.mode || null, failedFiles: c.failedFiles });
  }
  const cmds = readJson(join(qa, "commands.json"));
  const note = String(cmds.value?.note || "");
  const ok = cmds.ok && typeof cmds.value?.fullSuite === "string" && /established ability exception/i.test(note);
  return gate(ok, "full-suite-log-missing-and-no-documented-exception", { source: "commands.json" });
}

function assessSource(pkgRoot) {
  const sourceDir = join(pkgRoot, "source");
  const actual = computeSourceManifest(sourceDir);
  const problems = [];
  if (actual.fileCount === 0) problems.push("source-empty");
  for (const f of REQUIRED_SOURCE_FILES) if (!actual.files.some((x) => x.path === f)) problems.push(`required-source-missing:${f}`);

  const stored = readJson(join(pkgRoot, "source-content-manifest.json"));
  if (!stored.ok) problems.push(`content-manifest-${stored.error}`);
  else if (stored.value?.sha256 !== actual.sha256 || stored.value?.fileCount !== actual.fileCount) {
    problems.push("content-manifest-hash-mismatch");
  }

  const idx = readJson(join(pkgRoot, "source-git-blob-index.json"));
  if (!idx.ok) problems.push(`blob-index-${idx.error}`);
  else {
    const files = Array.isArray(idx.value?.files) ? idx.value.files : [];
    if (files.length === 0) problems.push("blob-index-empty");
    const byPath = new Map(files.map((f) => [f.path, f]));
    for (const f of actual.files) {
      const e = byPath.get(f.path);
      if (!e) problems.push(`extra-source:${f.path}`);
      else if (!e.blob || e.blob !== gitBlobSha1(readFileSync(join(sourceDir, f.path)))) problems.push(`blob-mismatch:${f.path}`);
    }
    const have = new Set(actual.files.map((f) => f.path));
    for (const p of byPath.keys()) if (!have.has(p)) problems.push(`missing-source:${p}`);
  }
  return {
    gate: gate(problems.length === 0, "source-manifest-invalid", { fileCount: actual.fileCount, problems: problems.slice(0, 20) }),
    manifest: actual,
  };
}

/**
 * Re-derive every readiness gate from package bytes.
 * @returns {{ready:boolean, gates:object, evidence:object, sourceManifest:object}}
 */
export function assessPackageEvidence(pkgRoot, { baseSha, finalSha = null } = {}) {
  const qa = join(pkgRoot, "qa", "fix10-runs");
  const matched = assessMatched(qa, baseSha);
  const source = assessSource(pkgRoot);
  const gates = {
    focused: assessFocused(qa),
    calibration: assessCalibration(qa),
    matched: matched.gate,
    browser: assessBrowser(qa),
    cohort: assessCohort(qa),
    fullSuite: assessFullSuite(qa),
    sourceManifest: source.gate,
  };
  const ready = Object.values(gates).every((g) => g.ok);
  const evidence = {
    schema: EVIDENCE_SCHEMA,
    ready,
    baseSha: baseSha || null,
    finalSha,
    gates,
    sourceManifest: { sha256: source.manifest.sha256, fileCount: source.manifest.fileCount },
    matched: { commonInputSha256: matched.commonInputSha256 },
  };
  return { ready, gates, evidence, sourceManifest: source.manifest };
}
