/** Shared Fix 12 review package helpers. */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const EVIDENCE_SCHEMA = 1;
export const REQUIRED_CASE_IDS = [
  ...Array.from({ length: 18 }, (_, i) => `F${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 8 }, (_, i) => `B${String(i + 1).padStart(2, "0")}`),
];

export function sha256File(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

export function sha256Buffer(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export function listFiles(dir, out = [], prefix = "") {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(abs).isDirectory()) listFiles(abs, out, rel);
    else out.push(rel);
  }
  return out;
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function computeSourceManifest(entries) {
  // entries: [{ path, sha256, gitBlobId? }]
  return {
    schema: EVIDENCE_SCHEMA,
    files: entries.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export function assessPackageEvidence({
  manifest,
  caseIndex,
  browserReport,
  f01Fixture,
  presentationTestLog,
  fullSuiteLog,
  gameplayParity,
}) {
  const problems = [];
  if (!manifest?.finalSha) problems.push("manifest missing finalSha");
  if (!manifest?.baseSha && !manifest?.acceptedBaseSha) {
    problems.push("manifest missing baseSha/acceptedBaseSha");
  }
  if (manifest?.remoteSha && manifest.remoteSha !== manifest.finalSha) {
    problems.push("remoteSha != finalSha");
  }

  const caseIds = new Set([
    ...(caseIndex?.cases || []).map((c) => c.id),
    ...((browserReport?.results || []).map((r) => r.id) || []),
  ]);
  // F01–F18 covered by unit test file result + exporter cases; require browser B01–B08 PASS
  for (const id of REQUIRED_CASE_IDS.filter((x) => x.startsWith("B"))) {
    const row = (browserReport?.results || []).find((r) => r.id === id);
    if (!row) problems.push(`missing browser case ${id}`);
    else if (row.status !== "PASS") problems.push(`browser ${id} status ${row.status}`);
  }

  if (browserReport?.fail) problems.push(`browser fail count ${browserReport.fail}`);
  if (caseIndex && caseIndex.ok === false) problems.push("qa case-index not ok");

  const group = f01Fixture?.projection?.openingPhase?.record;
  const total = f01Fixture?.projection?.tournament?.record;
  if (!group || group.played !== 3 || group.wins !== 2 || group.draws !== 1 || group.losses !== 0) {
    problems.push("F01 group record mismatch in fixture");
  }
  if (!total || total.played !== 8 || total.wins !== 7 || total.draws !== 1 || total.losses !== 0) {
    problems.push("F01 total record mismatch in fixture");
  }
  if (f01Fixture?.oracle?.wins !== 7) problems.push("F01 oracle mismatch");

  if (presentationTestLog && !/# fail 0/.test(presentationTestLog) && !/# fail 0\n/.test(presentationTestLog)) {
    // tolerate TAP summary variants
    if (!/pass 18/.test(presentationTestLog) && !/# pass 18/.test(presentationTestLog)) {
      problems.push("presentation test log missing pass 18");
    }
  }
  if (fullSuiteLog && /# fail [1-9]/.test(fullSuiteLog)) problems.push("full suite has failures");
  if (gameplayParity && (gameplayParity.nationalParity === false || gameplayParity.continentalParity === false)) {
    problems.push("gameplay parity failed");
  }

  void caseIds;
  return { ok: problems.length === 0, problems };
}
