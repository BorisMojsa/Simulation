#!/usr/bin/env node
/**
 * Explicit Fix 11 package semantic controls (not part of the ordinary unit suite).
 *
 * Usage:
 *   node scripts/qaFix11PackageControls.mjs --package <package-dir> --control incomplete-holdout
 *
 * Mutates an expendable package extraction, updates both checksum lists for the
 * changed payload, requires calibrationProvenance FAIL, then restores bytes.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
void HERE;

function parseArgs(argv) {
  const args = { package: null, control: "incomplete-holdout" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--package") args.package = argv[++i];
    else if (argv[i] === "--control") args.control = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!args.package) throw new Error("--package <dir> is required");
  return args;
}

function resolvePackage(arg) {
  const candidates = isAbsolute(arg)
    ? [arg]
    : [arg, join(process.env.FIX11_REVIEW_OUT || join(homedir(), "Downloads"), arg)];
  const hit = candidates.find((path) => existsSync(path));
  if (!hit) throw new Error(`Package not found: ${arg}`);
  return resolve(hit);
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function updateChecksum(packageRoot, rel, digest) {
  for (const name of ["SHA256SUMS.txt", "checksums.sha256"]) {
    const path = join(packageRoot, name);
    const lines = readFileSync(path, "utf8")
      .split("\n")
      .map((line) => (line.endsWith(`  ${rel}`) ? `${digest}  ${rel}` : line));
    writeFileSync(path, `${lines.filter((line, index, arr) => line || index < arr.length - 1).join("\n")}\n`);
  }
}

function verify(packageRoot) {
  return spawnSync(process.execPath, [join(packageRoot, "verify-package.mjs")], {
    cwd: packageRoot,
    encoding: "utf8",
  });
}

function incompleteHoldoutControl(packageRoot) {
  const rel = "qa/fix11-runs/holdout-final/trajectories/trajectory-500000.json";
  const path = join(packageRoot, rel);
  if (!existsSync(path)) throw new Error(`Missing ${rel}`);
  const original = readFileSync(path);
  const sumOriginal = {
    sha: readFileSync(join(packageRoot, "SHA256SUMS.txt")),
    checksums: readFileSync(join(packageRoot, "checksums.sha256")),
  };
  try {
    const row = JSON.parse(original.toString("utf8"));
    delete row.history;
    delete row.checks;
    const mutated = Buffer.from(`${JSON.stringify(row)}\n`);
    writeFileSync(path, mutated);
    updateChecksum(packageRoot, rel, sha256(mutated));
    const checked = verify(packageRoot);
    const body = `${checked.stdout}\n${checked.stderr}`;
    let parsed = null;
    try {
      parsed = JSON.parse(checked.stdout);
    } catch {
      parsed = null;
    }
    const failed =
      checked.status !== 0 &&
      parsed?.ready === false &&
      String(parsed?.gates?.calibrationProvenance || "").startsWith("FAIL");
    console.log(
      JSON.stringify(
        {
          ok: failed,
          control: "incomplete-holdout-history-and-checks",
          verifierExit: checked.status,
          ready: parsed?.ready ?? null,
          calibrationProvenance: parsed?.gates?.calibrationProvenance ?? null,
          issues: parsed?.issues?.slice(0, 8) ?? [],
          stdoutTail: body.slice(-500),
        },
        null,
        2
      )
    );
    process.exitCode = failed ? 0 : 1;
  } finally {
    writeFileSync(path, original);
    writeFileSync(join(packageRoot, "SHA256SUMS.txt"), sumOriginal.sha);
    writeFileSync(join(packageRoot, "checksums.sha256"), sumOriginal.checksums);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const packageRoot = resolvePackage(args.package);
  if (args.control === "incomplete-holdout") incompleteHoldoutControl(packageRoot);
  else throw new Error(`Unknown control: ${args.control}`);
}

try {
  main();
} catch (error) {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
}
