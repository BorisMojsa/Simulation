#!/usr/bin/env node
/** Verify checksums and re-derive all Fix 11 package hard gates. */
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assessPackageEvidence,
  EVIDENCE_SCHEMA,
  listFiles,
  readJson,
  sha256File,
} from "./lib/fix11ReviewEvidence.mjs";

const SUM_FILES = ["SHA256SUMS.txt", "checksums.sha256"];

function packageDir(arg) {
  if (!arg) {
    console.error("Usage: node scripts/verifyFix11Review.mjs <package-dir-or-name>");
    process.exit(2);
  }
  const candidates = isAbsolute(arg)
    ? [arg]
    : [arg, join(process.env.FIX11_REVIEW_OUT || join(homedir(), "Downloads"), arg)];
  const hit = candidates.find((path) => existsSync(path) && statSync(path).isDirectory());
  if (!hit) throw new Error(`Package directory not found: ${arg}`);
  return resolve(hit);
}

if (process.argv[2] === "--negative-control") {
  const source = packageDir(process.argv[3]);
  const temp = mkdtempSync(join(tmpdir(), "fix11-review-negative-"));
  const copy = join(temp, basename(source));
  try {
    cpSync(source, copy, { recursive: true });
    appendFileSync(
      join(copy, "source/scripts/browserFullCareerGrowthChecklist.mjs"),
      "\n// intentional negative-control corruption\n"
    );
    const checked = spawnSync(process.execPath, [fileURLToPath(import.meta.url), copy], {
      encoding: "utf8",
    });
    const detected = checked.status !== 0 && /checksum mismatch|source-content-sha256-mismatch/.test(
      `${checked.stdout}\n${checked.stderr}`
    );
    console.log(JSON.stringify({
      ok: detected,
      negativeControl: "tampered checksummed source byte",
      verifierExit: checked.status,
      corruptionDetected: detected,
    }, null, 2));
    process.exit(detected ? 0 : 1);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

const root = packageDir(process.argv[2]);
const issues = [];
const fail = (message) => issues.push(message);

const sumTexts = SUM_FILES.map((name) =>
  existsSync(join(root, name)) ? readFileSync(join(root, name), "utf8") : null
);
SUM_FILES.forEach((name, index) => sumTexts[index] === null && fail(`missing ${name}`));
if (sumTexts[0] !== null && sumTexts[1] !== null && sumTexts[0] !== sumTexts[1]) {
  fail("checksum files differ");
}
const sumText = sumTexts[0] ?? sumTexts[1];
if (sumText !== null) {
  const listed = new Set();
  for (const line of sumText.trim().split("\n").filter(Boolean)) {
    const match = line.match(/^([0-9a-f]{64})  (.+)$/);
    if (!match) {
      fail(`malformed checksum line: ${line.slice(0, 80)}`);
      continue;
    }
    const [, expected, rel] = match;
    if (rel.startsWith("/") || rel.includes("\\") || rel.split("/").includes("..")) {
      fail(`unsafe checksum path: ${rel}`);
      continue;
    }
    if (listed.has(rel)) fail(`duplicate checksum path: ${rel}`);
    listed.add(rel);
    const full = join(root, rel);
    if (!existsSync(full)) fail(`checksum target missing: ${rel}`);
    else if (sha256File(full) !== expected) fail(`checksum mismatch: ${rel}`);
  }
  if (listed.size === 0) fail("checksum list empty");
  for (const rel of listFiles(root)) {
    if (!SUM_FILES.includes(rel) && !listed.has(rel)) fail(`unlisted file: ${rel}`);
  }
}

for (const rel of listFiles(root)) {
  if (!rel.endsWith(".json") || rel.startsWith("source/")) continue;
  const parsed = readJson(join(root, rel));
  if (!parsed.ok) fail(`invalid JSON ${rel}: ${parsed.error}`);
}

const manifestRead = readJson(join(root, "manifest.json"));
const manifest = manifestRead.value || {};
if (!manifestRead.ok) fail(`manifest.json ${manifestRead.error}`);
const assessed = assessPackageEvidence(root, { finalSha: manifest.finalSha || null });
for (const [name, gate] of Object.entries(assessed.gates)) {
  if (!gate.ok) fail(`gate ${name}: ${gate.reason}`);
}
const evidenceRead = readJson(join(root, "evidence.json"));
const evidence = evidenceRead.value || {};
if (!evidenceRead.ok) fail(`evidence.json ${evidenceRead.error}`);
else {
  if (evidence.schema !== EVIDENCE_SCHEMA) fail(`evidence schema != ${EVIDENCE_SCHEMA}`);
  if (evidence.ready !== assessed.ready) fail("evidence readiness disagrees with recomputed readiness");
  if (evidence.finalSha !== manifest.finalSha) fail("evidence finalSha != manifest finalSha");
  if (evidence.sourceManifest?.sha256 !== assessed.sourceManifest.sha256) {
    fail("evidence source hash != recomputed source hash");
  }
}
if (manifest.ready !== assessed.ready) fail("manifest readiness disagrees with recomputed readiness");
if (manifest.sourceContentSha256 !== assessed.sourceManifest.sha256) {
  fail("manifest source hash != recomputed source hash");
}

const result = {
  ok: assessed.ready && issues.length === 0,
  packageDir: root,
  ready: assessed.ready,
  gates: Object.fromEntries(
    Object.entries(assessed.gates).map(([name, value]) => [
      name,
      value.ok ? "PASS" : `FAIL: ${value.reason}`,
    ])
  ),
  issues: issues.slice(0, 40),
};
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
