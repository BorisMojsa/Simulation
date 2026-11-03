#!/usr/bin/env node
/**
 * Verify a Fix 10 review package directory (or its embedded verify-package.mjs).
 *
 *   node scripts/verifyFix10Review.mjs ~/Downloads/10-Club-Strength-Profiles-Superstar-Impact-Review-<shortSHA>
 *   node scripts/verifyFix10Review.mjs 10-Club-Strength-Profiles-Superstar-Impact-Review-<shortSHA>
 *
 * When given a bare package name, looks under FIX10_REVIEW_OUT or ~/Downloads.
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

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
  let bad = 0;
  const issues = [];

  const sumsPath = join(root, "SHA256SUMS.txt");
  if (!existsSync(sumsPath)) {
    issues.push("missing SHA256SUMS.txt");
    bad += 1;
  } else {
    const sums = readFileSync(sumsPath, "utf8").trim().split("\n").filter(Boolean);
    for (const line of sums) {
      const hash = line.slice(0, 64);
      const path = line.slice(66);
      if (path === "SHA256SUMS.txt") continue;
      const full = join(root, path);
      if (!existsSync(full)) {
        issues.push(`missing ${path}`);
        bad += 1;
        continue;
      }
      const h = createHash("sha256").update(readFileSync(full)).digest("hex");
      if (h !== hash) {
        issues.push(`mismatch ${path}`);
        bad += 1;
      }
    }
  }

  const indexPath = join(root, "source-git-blob-index.json");
  const manifestPath = join(root, "manifest.json");
  if (!existsSync(indexPath)) {
    issues.push("missing source-git-blob-index.json");
    bad += 1;
  }
  if (!existsSync(manifestPath)) {
    issues.push("missing manifest.json");
    bad += 1;
  }

  let manifest = null;
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (err) {
      issues.push(`manifest parse: ${err.message}`);
      bad += 1;
    }
  }
  if (manifest && (!manifest.finalSha || !manifest.baseSha)) {
    issues.push("manifest missing identity fields");
    bad += 1;
  }

  if (existsSync(indexPath)) {
    const index = JSON.parse(readFileSync(indexPath, "utf8"));
    const sourceRoot = join(root, "source");
    const sourceFiles = walk(sourceRoot).map((p) => relative(sourceRoot, p).split("\\").join("/"));
    const indexed = new Set((index.files || []).map((f) => f.path));
    for (const p of sourceFiles) {
      if (!indexed.has(p)) {
        issues.push(`extra source ${p}`);
        bad += 1;
      }
    }
    for (const p of indexed) {
      if (!sourceFiles.includes(p)) {
        issues.push(`missing source ${p}`);
        bad += 1;
      }
    }
    for (const f of index.files || []) {
      const full = join(sourceRoot, f.path);
      if (!existsSync(full)) {
        issues.push(`missing blob path ${f.path}`);
        bad += 1;
        continue;
      }
      const blob = createHash("sha1")
        .update(Buffer.concat([Buffer.from(`blob ${statSync(full).size}\0`), readFileSync(full)]))
        .digest("hex");
      if (f.blob && f.blob !== blob) {
        issues.push(`blob-mismatch ${f.path}`);
        bad += 1;
      }
    }
  }

  for (const p of walk(root)) {
    if (!p.endsWith(".json")) continue;
    try {
      JSON.parse(readFileSync(p, "utf8"));
    } catch (err) {
      issues.push(`json-parse-fail ${relative(root, p)}: ${err.message}`);
      bad += 1;
    }
  }

  // Prefer embedded verifier when present (byte-identical to packageFix09 style).
  const embedded = join(root, "verify-package.mjs");
  let embeddedExit = null;
  if (existsSync(embedded)) {
    const r = spawnSync("node", [embedded], { encoding: "utf8" });
    embeddedExit = r.status;
    if (r.status !== 0) {
      issues.push(`embedded verify-package.mjs exited ${r.status}`);
      bad += 1;
    }
  }

  const result = {
    ok: bad === 0,
    bad,
    packageDir: root,
    package: manifest?.package || null,
    finalSha: manifest?.finalSha || null,
    baseSha: manifest?.baseSha || null,
    gates: manifest?.gates || null,
    embeddedExit,
    issues: issues.slice(0, 40),
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

const pkg = resolvePackageDir(process.argv[2]);
const out = verifyPackage(pkg);
process.exit(out.ok ? 0 : 1);
