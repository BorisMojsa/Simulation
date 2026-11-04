#!/usr/bin/env node
/**
 * Verify a Fix 10 ReReview package directory.
 *
 *   node scripts/verifyFix10Review.mjs ~/Downloads/10-Club-Strength-Profiles-Superstar-Impact-ReReview-<shortSHA>
 *   node scripts/verifyFix10Review.mjs 10-Club-Strength-Profiles-Superstar-Impact-ReReview-<shortSHA>
 *
 * When given a bare package name, looks under FIX10_REVIEW_OUT or ~/Downloads.
 *
 * Readiness is RE-DERIVED from package bytes (scripts/lib/fix10ReviewEvidence.mjs); claims in
 * manifest.json / evidence.json are only cross-checked, never trusted. A package that is not
 * fully ready (missing QA, empty source, empty blob index, ...) fails verification even when
 * checksums were recomputed after tampering.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import {
  assessPackageEvidence,
  EVIDENCE_SCHEMA,
  listFiles,
  readJson,
  sha256File,
} from "./lib/fix10ReviewEvidence.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SUM_FILES = ["SHA256SUMS.txt", "checksums.sha256"];
const REQUIRED_CHANGES = [
  "changes/base-to-final.patch",
  "changes/changed-files.txt",
  "changes/git-log.txt",
  "changes/git-status.txt",
  "changes/remote-head.txt",
];

function resolvePackageDir(arg) {
  if (!arg) {
    console.error("Usage: node scripts/verifyFix10Review.mjs <package-dir-or-name>");
    process.exit(2);
  }
  if (existsSync(arg) && statSync(arg).isDirectory()) return resolve(arg);
  if (isAbsolute(arg) && existsSync(arg)) return arg;
  const roots = [process.env.FIX10_REVIEW_OUT, join(homedir(), "Downloads"), join(homedir(), "Desktop"), ROOT].filter(
    Boolean
  );
  for (const base of roots) {
    const candidate = join(base, arg);
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
  }
  throw new Error(`Package directory not found: ${arg}`);
}

function verifyPackage(root) {
  const issues = [];
  const fail = (msg) => issues.push(msg);

  // --- checksums: both files present, identical, cover every file, every hash matches.
  const sumTexts = SUM_FILES.map((f) => (existsSync(join(root, f)) ? readFileSync(join(root, f), "utf8") : null));
  SUM_FILES.forEach((f, i) => sumTexts[i] === null && fail(`missing ${f}`));
  if (sumTexts[0] !== null && sumTexts[1] !== null && sumTexts[0] !== sumTexts[1]) {
    fail("SHA256SUMS.txt and checksums.sha256 differ");
  }
  const sumText = sumTexts[0] ?? sumTexts[1];
  if (sumText !== null) {
    const listed = new Set();
    for (const line of sumText.trim().split("\n").filter(Boolean)) {
      const m = line.match(/^([0-9a-f]{64})  (.+)$/);
      if (!m) {
        fail(`malformed checksum line: ${line.slice(0, 80)}`);
        continue;
      }
      const [, hash, path] = m;
      if (path.startsWith("/") || path.split("/").includes("..")) {
        fail(`unsafe checksum path ${path}`);
        continue;
      }
      listed.add(path);
      const full = join(root, path);
      if (!existsSync(full)) fail(`missing ${path}`);
      else if (sha256File(full) !== hash) fail(`mismatch ${path}`);
    }
    if (listed.size === 0) fail("checksum list is empty");
    for (const rel of listFiles(root)) {
      if (!SUM_FILES.includes(rel) && !listed.has(rel)) fail(`unlisted file ${rel}`);
    }
  }

  // --- manifest / identity / layout
  const mf = readJson(join(root, "manifest.json"));
  const manifest = mf.value;
  if (!mf.ok) fail(`manifest ${mf.error}`);
  else {
    if (!manifest.finalSha || !manifest.baseSha) fail("manifest missing identity fields");
    if (!/ReReview-/.test(manifest.package || "")) fail(`manifest package is not a ReReview package: ${manifest.package}`);
  }
  for (const rel of REQUIRED_CHANGES) {
    if (!existsSync(join(root, rel))) fail(`missing ${rel}`);
  }
  if (existsSync(join(root, "changes/base-to-final.patch")) && statSync(join(root, "changes/base-to-final.patch")).size === 0) {
    fail("changes/base-to-final.patch is empty");
  }
  const idx = readJson(join(root, "source-git-blob-index.json"));
  if (idx.ok && manifest?.finalSha && idx.value?.commit !== manifest.finalSha) fail("blob index commit != manifest.finalSha");

  // Every non-source JSON must parse (source/ bytes are covered by the blob index + content manifest).
  for (const rel of listFiles(root)) {
    if (!rel.endsWith(".json") || rel.startsWith("source/")) continue;
    const r = readJson(join(root, rel));
    if (!r.ok) fail(`json-parse-fail ${rel}: ${r.error}`);
  }

  // --- evidence: recompute readiness from bytes, then cross-check recorded claims.
  const assessed = assessPackageEvidence(root, { baseSha: manifest?.baseSha, finalSha: manifest?.finalSha });
  for (const [name, g] of Object.entries(assessed.gates)) {
    if (!g.ok) fail(`gate ${name}: ${g.reason}${g.problems?.length ? ` [${g.problems.slice(0, 5).join("; ")}]` : ""}`);
  }
  const ev = readJson(join(root, "evidence.json"));
  if (!ev.ok) fail(`evidence.json ${ev.error}`);
  else {
    const e = ev.value || {};
    if (e.schema !== EVIDENCE_SCHEMA) fail(`evidence.json schema != ${EVIDENCE_SCHEMA}`);
    if (e.ready !== true) fail("evidence.json ready is not true");
    if (e.finalSha !== manifest?.finalSha) fail("evidence.json finalSha != manifest.finalSha");
    if (e.sourceManifest?.sha256 !== assessed.sourceManifest.sha256) fail("evidence.json source hash != recomputed source hash");
    if (e.matched?.commonInputSha256 !== assessed.evidence.matched.commonInputSha256) {
      fail("evidence.json input hash != recomputed input hash");
    }
    for (const [name, g] of Object.entries(assessed.gates)) {
      if (e.gates?.[name]?.ok !== g.ok) fail(`evidence.json gate ${name} disagrees with recomputed result`);
    }
  }
  if (manifest?.gates?.ready === true && ev.ok && ev.value?.schema !== EVIDENCE_SCHEMA) {
    fail("manifest claims ready:true without evidence schema");
  }
  if (manifest?.gates?.ready !== true) fail("manifest.gates.ready is not true");
  if (manifest?.sourceContentSha256 !== assessed.sourceManifest.sha256) fail("manifest source hash != recomputed source hash");

  const result = {
    ok: issues.length === 0,
    bad: issues.length,
    packageDir: root,
    package: manifest?.package || null,
    finalSha: manifest?.finalSha || null,
    baseSha: manifest?.baseSha || null,
    ready: assessed.ready,
    gates: Object.fromEntries(Object.entries(assessed.gates).map(([k, g]) => [k, g.ok])),
    issues: issues.slice(0, 40),
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

const pkg = resolvePackageDir(process.argv[2]);
const out = verifyPackage(pkg);
process.exit(out.ok ? 0 : 1);
