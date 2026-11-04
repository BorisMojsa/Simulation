#!/usr/bin/env node
/**
 * Negative controls for scripts/verifyFix10Review.mjs.
 *
 *   node scripts/qaFix10NegativeVerify.mjs <package-dir>
 *
 * Copies the package to a temp dir per mutation, applies the mutation, RECOMPUTES
 * SHA256SUMS.txt / checksums.sha256 so checksum drift cannot be what rejects it, and runs the
 * repo verifier. Exits non-zero if the unmutated package does not verify (controls would be
 * meaningless) or if ANY mutation incorrectly passes.
 *
 * Four control groups (each sub-mutation is run independently):
 *   1 package-omissions : empty source/, empty blob index
 *   2 missing-evidence   : browser-report.json removed; ready:true without evidence schema
 *   3 tamper             : altered matched input hash; changed source bytes
 *   4 full-suite         : extra failed playerAbility assertion marker
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { cmp, listFiles, sha256File } from "./lib/fix10ReviewEvidence.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const VERIFIER = join(HERE, "verifyFix10Review.mjs");
const src = process.argv[2] ? resolve(process.argv[2]) : null;
if (!src || !existsSync(src)) {
  console.error("Usage: node scripts/qaFix10NegativeVerify.mjs <package-dir>");
  process.exit(2);
}

function recomputeChecksums(dir) {
  const lines = listFiles(dir)
    .filter((rel) => rel !== "SHA256SUMS.txt" && rel !== "checksums.sha256")
    .map((rel) => `${sha256File(join(dir, rel))}  ${rel}`)
    .sort((a, b) => cmp(a.slice(66), b.slice(66)));
  const text = lines.join("\n") + "\n";
  writeFileSync(join(dir, "SHA256SUMS.txt"), text);
  writeFileSync(join(dir, "checksums.sha256"), text);
}
const readJ = (p) => JSON.parse(readFileSync(p, "utf8"));
const writeJ = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2));

const MUTATIONS = [
  {
    group: "1-package-omissions",
    name: "empty-source",
    expect: /source-empty|required-source-missing/,
    apply(d) {
      for (const n of readdirSync(join(d, "source"))) rmSync(join(d, "source", n), { recursive: true, force: true });
    },
  },
  {
    group: "1-package-omissions",
    name: "empty-blob-index",
    expect: /blob-index-empty/,
    apply(d) {
      const p = join(d, "source-git-blob-index.json");
      writeJ(p, { ...readJ(p), files: [] });
    },
  },
  {
    group: "2-missing-evidence",
    name: "missing-browser-report",
    expect: /gate browser: browser-report-missing/,
    apply(d) {
      rmSync(join(d, "qa/fix10-runs/browser/browser-report.json"), { force: true });
    },
  },
  {
    group: "2-missing-evidence",
    name: "ready-true-without-evidence-schema",
    expect: /evidence\.json schema !=/,
    apply(d) {
      const m = join(d, "manifest.json");
      const mj = readJ(m);
      mj.gates = { ...mj.gates, ready: true };
      writeJ(m, mj);
      const e = join(d, "evidence.json");
      const ej = readJ(e);
      delete ej.schema;
      writeJ(e, ej);
    },
  },
  {
    group: "3-tamper",
    name: "altered-input-hash",
    expect: /gate matched.*common-input/,
    apply(d) {
      const p = join(d, "qa/fix10-runs/matched/inputs/common-input.sha256");
      const cur = readFileSync(p, "utf8");
      writeFileSync(p, (cur[0] === "0" ? "1" : "0") + cur.slice(1));
    },
  },
  {
    group: "3-tamper",
    name: "changed-source-bytes",
    expect: /content-manifest-hash-mismatch|blob-mismatch/,
    apply(d) {
      const p = join(d, "source/js/simulation/teamStrength.js");
      writeFileSync(p, readFileSync(p, "utf8") + "\n// tampered\n");
    },
  },
  {
    group: "4-full-suite",
    name: "extra-playerAbility-failed-assertion",
    expect: /gate fullSuite: full-suite-log-unexpected-failed-assertions/,
    apply(d) {
      const p = join(d, "qa/fix10-runs/logs/full-suite.log");
      writeFileSync(
        p,
        readFileSync(p, "utf8") +
          "\n# FAIL playerAbility: injected extra assertion\n# AssertionError [ERR_ASSERTION]: injected\n#     at tests/playerAbility.test.mjs:999\n"
      );
    },
  },
];

function runVerifier(dir) {
  return spawnSync("node", [VERIFIER, dir], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

const tmpRoot = mkdtempSync(join(tmpdir(), "fix10-negverify-"));
const results = [];
let exitCode = 0;
try {
  // Positive control: unmutated copy (checksums recomputed) must pass, or negatives prove nothing.
  const base = join(tmpRoot, "positive");
  cpSync(src, base, { recursive: true });
  recomputeChecksums(base);
  const pos = runVerifier(base);
  results.push({ control: "positive-baseline", expect: "pass", verifyExit: pos.status, ok: pos.status === 0 });
  if (pos.status !== 0) {
    console.error("Unmutated package does not verify; negative controls are meaningless.\n" + pos.stdout);
    exitCode = 1;
  } else {
    for (const m of MUTATIONS) {
      const d = join(tmpRoot, m.name);
      cpSync(src, d, { recursive: true });
      let applied = true;
      try {
        m.apply(d);
        recomputeChecksums(d);
      } catch (err) {
        applied = false;
        results.push({ control: `${m.group}/${m.name}`, ok: false, error: `mutation failed to apply: ${err.message}` });
      }
      if (!applied) continue;
      const r = runVerifier(d);
      const rejected = r.status !== 0;
      // Must be rejected for the intended reason, not an incidental one.
      let issues = [];
      try {
        issues = JSON.parse(r.stdout).issues || [];
      } catch {}
      const reasonOk = issues.some((i) => m.expect.test(i));
      results.push({
        control: `${m.group}/${m.name}`,
        expect: "reject",
        verifyExit: r.status,
        intendedReasonSeen: reasonOk,
        ok: rejected && reasonOk,
      });
      rmSync(d, { recursive: true, force: true });
    }
    if (results.some((r) => !r.ok)) exitCode = 1;
  }
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
console.log(JSON.stringify({ package: src, ok: exitCode === 0, results }, null, 2));
process.exit(exitCode);
