/**
 * Shared Fix 11 package-evidence skeleton.
 *
 * This intentionally implements only the first hard gates needed while Fix 11
 * evidence is still being assembled. Package and verifier both call the same
 * assessor so missing evidence cannot be promoted by manifest claims.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const EVIDENCE_SCHEMA = "fix11-review-evidence-v1";
export const BROWSER_IDS = Array.from({ length: 8 }, (_, i) => `B${String(i + 1).padStart(2, "0")}`);
export const REQUIRED_SOURCE_FILES = [
  "scripts/browserFullCareerGrowthChecklist.mjs",
  "scripts/packageFix11Review.mjs",
  "scripts/verifyFix11Review.mjs",
  "scripts/lib/fix11ReviewEvidence.mjs",
  "tests/fullCareerGrowthCalibration.test.mjs",
  "reports/fix11-growth-audit.md",
  "reports/fix11-full-career-growth-calibration.md",
  "reports/fix11-full-career-growth-completion.md",
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
  return {
    gate: gate(problems.length === 0, "source-manifest-invalid", {
      fileCount: actual.fileCount,
      sha256: actual.sha256,
      problems,
    }),
    manifest: actual,
  };
}

function assessNatural99(packageRoot) {
  const roots = [
    join(packageRoot, "qa/fix11-runs"),
    join(packageRoot, "qa/fix11-runs/browser/snapshots"),
  ];
  const candidates = roots.flatMap((root) =>
    listFiles(root)
      .filter((path) => /witnesses\//i.test(path) && /natural.?99|pre.?threshold|threshold.?99/i.test(path))
      .map((path) => join(root, path))
  );
  const valid = candidates.find((path) => {
    const parsed = readJson(path);
    const before =
      parsed.value?.beforeSnapshot ||
      parsed.value?.snapshot ||
      parsed.value?.preSnapshot ||
      parsed.value;
    const after = parsed.value?.afterSnapshot || null;
    const beforeRaw = Number(before?.player?.baseOverallRaw ?? before?.player?.currentOverallRaw);
    const afterRaw = Number(after?.player?.baseOverallRaw ?? after?.player?.currentOverallRaw);
    return (
      parsed.ok &&
      before?.player &&
      before?.world &&
      after?.player &&
      after?.world &&
      beforeRaw < 98.5 &&
      afterRaw >= 98.5
    );
  });
  return gate(Boolean(valid), "natural-99-witness-missing", {
    witness: valid ? valid.slice(packageRoot.length + 1) : null,
    candidates: candidates.length,
  });
}

function assessAccountingTests(packageRoot) {
  const logCandidates = [
    "qa/fix11-runs/logs/accounting-tests.log",
    "qa/fix11-runs/logs/full-career-growth-tests.log",
    "qa/fix11-runs/logs/full-suite.log",
  ].map((path) => join(packageRoot, path));
  const log = logCandidates.find((path) => existsSync(path) && statSync(path).size > 0);
  if (!log) return gate(false, "accounting-test-log-missing");
  const text = readFileSync(log, "utf8");
  const coherent = /^# tests \d+/m.test(text) && /^# fail 0\s*$/m.test(text);
  return gate(coherent, "accounting-tests-not-clean", {
    log: log.slice(packageRoot.length + 1),
  });
}

function assessBrowser(packageRoot) {
  const path = join(packageRoot, "qa/fix11-runs/browser/browser-report.json");
  const parsed = readJson(path);
  if (!parsed.ok) return gate(false, `browser-report-${parsed.error}`);
  const report = parsed.value || {};
  const problems = [];
  for (const id of BROWSER_IDS) {
    if (report.cases?.[id]?.status !== "PASS") problems.push(`${id}:${report.cases?.[id]?.status || "missing"}`);
  }
  if (report.requiredComplete !== true) problems.push("requiredComplete-not-true");
  if (report.subsetOnly === true) problems.push("subsetOnly");
  return gate(problems.length === 0, "browser-report-incomplete", { problems });
}

/**
 * Re-derive Fix 11 readiness from package bytes.
 * Further statistical/calibration gates can be added without changing callers.
 */
export function assessPackageEvidence(packageRoot, { finalSha = null } = {}) {
  const source = assessSource(packageRoot);
  const gates = {
    sourceManifest: source.gate,
    natural99Witness: assessNatural99(packageRoot),
    accountingTests: assessAccountingTests(packageRoot),
    browser: assessBrowser(packageRoot),
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
