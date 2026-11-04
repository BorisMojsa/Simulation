#!/usr/bin/env node
/**
 * Negative controls for scripts/verifyFix10Review.mjs.
 *
 *   node scripts/qaFix10NegativeVerify.mjs <package-dir>
 *
 * Runs against the package directory in place: verifies the unmutated tree, then for each
 * mutation backs up touched paths, applies the mutation, RECOMPUTES SHA256SUMS.txt /
 * checksums.sha256 so checksum drift cannot be what rejects it, runs the repo verifier, and
 * restores the backup. Exits non-zero if the unmutated package does not verify (controls would
 * be meaningless) or if ANY mutation incorrectly passes.
 *
 * In-place restore keeps peak disk near one package tree (full per-mutation copies do not fit
 * when cohort/browser snapshots are multi-gigabyte).
 *
 * Control groups (each sub-mutation is run independently, checksums recomputed afterwards, and the
 * rejection must NAME the intended gate/reason — an incidental failure does not count):
 *   1 package-omissions : empty source/, empty blob index
 *   2 missing-evidence   : browser-report.json removed; ready:true without evidence schema
 *   3 tamper             : altered matched input hash; changed source bytes
 *   4 full-suite         : extra failed playerAbility assertion marker
 *   5 full-suite-log     : full-suite.log missing (commands.json note kept); truncated `# fail 0` log;
 *                          TAP summary counts inconsistent
 *   6 production-seasons : output absent; smoke seasonN; unequal paired seeds (summary / per-season file);
 *                          missing/corrupt gzip traces; gzip missing season; gzip altered fixture seed/hash
 *   7 cohort             : missing input / initial snapshot / final snapshot / snapshot reference
 *   8 browser            : missing B06 pause snapshot; empty finance ledgers; empty checkpoint
 *                          processedEventIds / ordered; injected `:short30` row in B04 evidence
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { gunzipSync, gzipSync } from "node:zlib";
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
const QA = "qa/fix10-runs";
const PROD = `${QA}/production-seasons`;
const COHORT = `${QA}/career-cohort`;
const SNAP = `${QA}/browser/snapshots`;

/** First completed (non-excluded) primary cohort row: negatives target real referenced files. */
function firstCohortRow(d) {
  const s = readJ(join(d, COHORT, "summary.json"));
  const row = (s.rows || []).find((r) => r && r.excluded !== true);
  if (!row) throw new Error("no completed cohort row to mutate");
  return { s, row };
}
/** First production context/role whose paired file exists. */
function firstProdRole(d) {
  const s = readJ(join(d, PROD, "summary.json"));
  const ctx = s.contexts[0];
  const role = Object.keys(ctx.roles)[0];
  return { s, ctx, role, pairedPath: join(d, PROD, `${ctx.id}-${role}-paired.json`) };
}
function mutateB06Paused(d, fn) {
  const p = join(d, SNAP, "B06-paused.full.json");
  const snap = readJ(p);
  fn(snap, snap.seasonCheckpoint || snap.player?.seasonCheckpoint);
  writeFileSync(p, JSON.stringify(snap));
}

const CHECKSUM_RELS = ["SHA256SUMS.txt", "checksums.sha256"];

const MUTATIONS = [
  {
    group: "1-package-omissions",
    name: "empty-source",
    expect: /source-empty|required-source-missing/,
    targets: () => ["source"],
    apply(d) {
      for (const n of readdirSync(join(d, "source"))) rmSync(join(d, "source", n), { recursive: true, force: true });
    },
  },
  {
    group: "1-package-omissions",
    name: "empty-blob-index",
    expect: /blob-index-empty/,
    targets: () => ["source-git-blob-index.json"],
    apply(d) {
      const p = join(d, "source-git-blob-index.json");
      writeJ(p, { ...readJ(p), files: [] });
    },
  },
  {
    group: "2-missing-evidence",
    name: "missing-browser-report",
    expect: /gate browser: browser-report-missing/,
    targets: () => ["qa/fix10-runs/browser/browser-report.json"],
    apply(d) {
      rmSync(join(d, "qa/fix10-runs/browser/browser-report.json"), { force: true });
    },
  },
  {
    group: "2-missing-evidence",
    name: "ready-true-without-evidence-schema",
    expect: /evidence\.json schema !=/,
    targets: () => ["manifest.json", "evidence.json"],
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
    targets: () => ["qa/fix10-runs/matched/inputs/common-input.sha256"],
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
    targets: () => ["source/js/simulation/teamStrength.js"],
    apply(d) {
      const p = join(d, "source/js/simulation/teamStrength.js");
      writeFileSync(p, readFileSync(p, "utf8") + "\n// tampered\n");
    },
  },
  {
    group: "4-full-suite",
    name: "extra-playerAbility-failed-assertion",
    expect: /gate fullSuite: full-suite-log-unexpected-failed-assertions/,
    targets: () => [`${QA}/logs/full-suite.log`],
    apply(d) {
      const p = join(d, "qa/fix10-runs/logs/full-suite.log");
      writeFileSync(
        p,
        readFileSync(p, "utf8") +
          "\n# FAIL playerAbility: injected extra assertion\n# AssertionError [ERR_ASSERTION]: injected\n#     at tests/playerAbility.test.mjs:999\n"
      );
    },
  },
  {
    group: "5-full-suite-log",
    name: "missing-full-suite-log-with-commands-note",
    expect: /gate fullSuite: full-suite-log-missing/,
    targets: () => [`${QA}/commands.json`, `${QA}/logs/full-suite.log`],
    apply(d) {
      // A commands.json note must never substitute for the log, so make sure the note is present.
      const c = join(d, QA, "commands.json");
      const cj = existsSync(c) ? readJ(c) : {};
      cj.fullSuite = cj.fullSuite || "node --test tests/*.test.mjs";
      cj.note = "Full suite passed with the established ability exception only.";
      writeJ(c, cj);
      rmSync(join(d, QA, "logs/full-suite.log"), { force: true });
    },
  },
  {
    group: "5-full-suite-log",
    name: "truncated-clean-log-fail-0-only",
    expect: /gate fullSuite: full-suite-log-truncated-tap/,
    targets: () => [`${QA}/logs/full-suite.log`],
    apply(d) {
      writeFileSync(join(d, QA, "logs/full-suite.log"), "# fail 0\n");
    },
  },
  {
    group: "5-full-suite-log",
    name: "tap-summary-counts-inconsistent",
    expect: /gate fullSuite: full-suite-log-tap-summary-counts-inconsistent/,
    targets: () => [`${QA}/logs/full-suite.log`],
    apply(d) {
      const p = join(d, QA, "logs/full-suite.log");
      const t = readFileSync(p, "utf8");
      if (!/^# pass \d+/m.test(t)) throw new Error("log has no `# pass N` line to corrupt");
      writeFileSync(p, t.replace(/^# pass \d+/m, "# pass 1"));
    },
  },
  {
    group: "6-production-seasons",
    name: "absent-production-season-output",
    expect: /gate productionSeasons: production-summary-missing/,
    targets: () => [PROD],
    apply(d) {
      rmSync(join(d, PROD), { recursive: true, force: true });
    },
  },
  {
    group: "6-production-seasons",
    name: "smoke-seasonN-below-100",
    expect: /gate productionSeasons:.*seasonN-below-100/,
    targets: () => [`${PROD}/summary.json`],
    apply(d) {
      const p = join(d, PROD, "summary.json");
      const s = readJ(p);
      s.seasonN = 40;
      writeJ(p, s);
    },
  },
  {
    group: "6-production-seasons",
    name: "unequal-paired-seeds-in-summary",
    expect: /gate productionSeasons:.*unequal-paired-seeds-in-summary/,
    targets: () => [`${PROD}/summary.json`],
    apply(d) {
      const p = join(d, PROD, "summary.json");
      const { s, ctx, role } = firstProdRole(d);
      const ro = s.contexts[0].roles[role];
      let touched = false;
      if (Array.isArray(ro.star99?.seasonSeeds)) {
        ro.star99.seasonSeeds[0] += 1; // seed now depends on the condition
        touched = true;
      }
      const first = (ro.pairedDelta?.sample || [])[0];
      if (first && first.seasonSeedStar !== undefined) {
        first.seasonSeedStar += 1; // explicit rep/star seed fields (older schema)
        touched = true;
      }
      if (!touched) throw new Error(`no seed field to mutate in ${ctx.id}/${role}`);
      writeJ(p, s);
    },
  },
  {
    group: "6-production-seasons",
    name: "unequal-paired-seeds-in-paired-file",
    expect: /gate productionSeasons:.*unequal-paired-seeds:/,
    targets: (d) => {
      const { pairedPath } = firstProdRole(d);
      return [relative(d, pairedPath)];
    },
    apply(d) {
      const { pairedPath } = firstProdRole(d);
      const pf = readJ(pairedPath);
      const row = pf.pairedDeltas[0];
      const seed = row.seasonSeedRep ?? row.seasonSeed;
      row.seasonSeedRep = seed;
      row.seasonSeedStar = seed + 3; // e.g. an ovr-derived offset
      writeJ(pairedPath, pf);
    },
  },
  {
    group: "6-production-seasons",
    name: "missing-one-complete-gzip-trace",
    expect: /gate productionSeasons:.*fixtures-jsonl-gz-missing/,
    targets: () => [`${PROD}/fixtures/weak-hull.jsonl.gz`],
    apply(d) {
      rmSync(join(d, PROD, "fixtures", "weak-hull.jsonl.gz"), { force: true });
    },
  },
  {
    group: "6-production-seasons",
    name: "missing-both-complete-gzip-traces",
    expect: /gate productionSeasons:.*fixtures-jsonl-gz-missing/,
    targets: () => [`${PROD}/fixtures/weak-hull.jsonl.gz`, `${PROD}/fixtures/mid-brentford.jsonl.gz`],
    apply(d) {
      rmSync(join(d, PROD, "fixtures", "weak-hull.jsonl.gz"), { force: true });
      rmSync(join(d, PROD, "fixtures", "mid-brentford.jsonl.gz"), { force: true });
    },
  },
  {
    group: "6-production-seasons",
    name: "corrupt-or-truncated-gzip-trace",
    expect: /gate productionSeasons:.*fixtures-jsonl-gz-corrupt-or-truncated/,
    targets: () => [`${PROD}/fixtures/weak-hull.jsonl.gz`],
    apply(d) {
      const p = join(d, PROD, "fixtures", "weak-hull.jsonl.gz");
      const buf = readFileSync(p);
      writeFileSync(p, buf.subarray(0, Math.max(16, Math.floor(buf.length / 4))));
    },
  },
  {
    group: "6-production-seasons",
    name: "gzip-missing-season-record",
    expect: /gate productionSeasons:.*fixtures-jsonl-gz-(missing-seasons|record-count)/,
    targets: () => [`${PROD}/fixtures/weak-hull.jsonl.gz`],
    apply(d) {
      const p = join(d, PROD, "fixtures", "weak-hull.jsonl.gz");
      const text = gunzipSync(readFileSync(p)).toString("utf8");
      const kept = text
        .split("\n")
        .filter((line) => {
          if (!line.trim()) return false;
          const o = JSON.parse(line);
          // Drop one canonical season so the gate sees a missing record.
          return !(o.role === "ST" && o.condition === "replacement" && o.seasonIndex === 0);
        })
        .join("\n");
      writeFileSync(p, gzipSync(Buffer.from(kept.endsWith("\n") ? kept : kept + "\n")));
    },
  },
  {
    group: "6-production-seasons",
    name: "gzip-altered-fixture-seed-or-hash",
    expect: /gate productionSeasons:.*fixtures-jsonl-gz-(hash-mismatch|paired-schedule-mismatch|seed-or-ovr-mismatch)/,
    targets: () => [`${PROD}/fixtures/weak-hull.jsonl.gz`],
    apply(d) {
      const p = join(d, PROD, "fixtures", "weak-hull.jsonl.gz");
      const lines = gunzipSync(readFileSync(p))
        .toString("utf8")
        .split("\n")
        .filter((line) => line.trim());
      const out = lines.map((line) => {
        const o = JSON.parse(line);
        if (o.role === "ST" && o.condition === "replacement" && o.seasonIndex === 0) {
          // Keep fixturesSha256 stale so recomputed content hash diverges.
          if (Array.isArray(o.fixtures) && o.fixtures[0]) o.fixtures[0].fixtureSeed = (o.fixtures[0].fixtureSeed || 0) + 1;
        }
        return JSON.stringify(o);
      });
      writeFileSync(p, gzipSync(Buffer.from(out.join("\n") + "\n")));
    },
  },
  {
    group: "7-cohort",
    name: "missing-cohort-input",
    expect: /gate cohort:.*input-missing/,
    targets: (d) => {
      const { row } = firstCohortRow(d);
      return [`${COHORT}/${row.inputPath}`];
    },
    apply(d) {
      const { row } = firstCohortRow(d);
      rmSync(join(d, COHORT, row.inputPath), { force: true });
    },
  },
  {
    group: "7-cohort",
    name: "missing-cohort-initial-snapshot",
    expect: /gate cohort:.*initial-snapshot-missing/,
    targets: (d) => {
      const { row } = firstCohortRow(d);
      return [`${COHORT}/${row.initialSnapshotPath}`];
    },
    apply(d) {
      const { row } = firstCohortRow(d);
      rmSync(join(d, COHORT, row.initialSnapshotPath), { force: true });
    },
  },
  {
    group: "7-cohort",
    name: "missing-cohort-final-snapshot",
    expect: /gate cohort:.*final-snapshot-missing/,
    targets: (d) => {
      const { row } = firstCohortRow(d);
      return [`${COHORT}/${row.finalSnapshotPath}`];
    },
    apply(d) {
      const { row } = firstCohortRow(d);
      rmSync(join(d, COHORT, row.finalSnapshotPath), { force: true });
    },
  },
  {
    group: "7-cohort",
    name: "cohort-slim-recipe-input-only",
    expect: /gate cohort:.*initial-snapshot-ref-missing/,
    targets: () => [`${COHORT}/summary.json`],
    apply(d) {
      const p = join(d, COHORT, "summary.json");
      const { s, row } = firstCohortRow(d);
      delete row.initialSnapshotPath;
      delete row.finalSnapshotPath;
      writeJ(p, s);
    },
  },
  {
    group: "8-browser",
    name: "missing-B06-pause-snapshot",
    expect: /gate browser:.*B06-paused-snapshot-missing/,
    targets: () => [`${SNAP}/B06-paused.full.json`],
    apply(d) {
      rmSync(join(d, SNAP, "B06-paused.full.json"), { force: true });
    },
  },
  {
    group: "8-browser",
    name: "B06-pause-without-finance-ledgers",
    expect: /gate browser:.*B06-paused:clubFinance\.ledgers-empty/,
    targets: () => [`${SNAP}/B06-paused.full.json`],
    apply(d) {
      mutateB06Paused(d, (snap) => {
        snap.clubFinance = { ...(snap.clubFinance || {}), ledgers: {} };
      });
    },
  },
  {
    group: "8-browser",
    name: "B06-checkpoint-processedEventIds-empty",
    expect: /gate browser:.*B06-paused-checkpoint-processedEventIds-empty/,
    targets: () => [`${SNAP}/B06-paused.full.json`],
    apply(d) {
      mutateB06Paused(d, (_snap, ck) => {
        ck.processedEventIds = [];
      });
    },
  },
  {
    group: "8-browser",
    name: "B06-checkpoint-ordered-empty",
    expect: /gate browser:.*B06-paused-checkpoint-ordered-empty/,
    targets: () => [`${SNAP}/B06-paused.full.json`],
    apply(d) {
      mutateB06Paused(d, (_snap, ck) => {
        ck.ordered = [];
      });
    },
  },
  {
    group: "8-browser",
    name: "missing-B06-restored-desk-snapshot",
    expect: /gate browser:.*B06-restored-desk-snapshot-missing/,
    targets: () => [`${SNAP}/B06-desk.full.json`],
    apply(d) {
      rmSync(join(d, SNAP, "B06-desk.full.json"), { force: true });
    },
  },
  {
    group: "8-browser",
    name: "inserted-short30-row-in-B04-evidence",
    expect: /gate browser:.*B04-injected-short-fixture-id/,
    targets: () => [`${SNAP}/B04-desk.full.json`],
    apply(d) {
      const p = join(d, SNAP, "B04-desk.full.json");
      const snap = readJ(p);
      const season = snap.player.seasons.at(-1);
      const rows = season.leagueMatches || season.leagueAllMatches || season.playerMatches;
      const donor = rows.find((m) => m.playerSide && (m.playerStats?.minutes || 0) >= 1) || rows[0];
      const injected = structuredClone(donor);
      injected.fixtureId = `${donor.fixtureId || "fix10"}:short30`;
      injected.playerStats = { ...(injected.playerStats || {}), minutes: 30, started: false, selected: true };
      rows.push(injected);
      writeFileSync(p, JSON.stringify(snap));
    },
  },
  {
    group: "8-browser",
    name: "B04-injected-short-case-file-present",
    expect: /gate browser:.*B04-injected-short-fixture-case-present/,
    targets: () => [],
    created: () => [`${QA}/browser/cases/B04-short-injected.json`],
    apply(d) {
      writeJ(join(d, QA, "browser/cases/B04-short-injected.json"), { minutes: 30, impactAttack: 2.016, full90: 6.048 });
    },
  },
];

function runVerifier(dir) {
  return spawnSync("node", [VERIFIER, dir], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

/** Copy listed package-relative paths aside so an in-place mutation can be restored. */
function stashPaths(root, rels, stashDir) {
  const entries = [];
  for (const rel of rels) {
    const from = join(root, rel);
    const to = join(stashDir, rel);
    if (!existsSync(from)) {
      entries.push({ rel, existed: false });
      continue;
    }
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true });
    entries.push({ rel, existed: true });
  }
  return entries;
}

function restorePaths(root, entries, stashDir, createdRels = []) {
  for (const e of entries) {
    const dest = join(root, e.rel);
    rmSync(dest, { recursive: true, force: true });
    if (!e.existed) continue;
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(stashDir, e.rel), dest, { recursive: true });
  }
  for (const rel of createdRels) rmSync(join(root, rel), { recursive: true, force: true });
}

const tmpRoot = mkdtempSync(join(tmpdir(), "fix10-negverify-"));
const results = [];
let exitCode = 0;
const work = src;
try {
  // Positive control: package bytes as shipped (checksums already match). No full-tree copy.
  const pos = runVerifier(work);
  results.push({ control: "positive-baseline", expect: "pass", verifyExit: pos.status, ok: pos.status === 0 });
  if (pos.status !== 0) {
    console.error("Unmutated package does not verify; negative controls are meaningless.\n" + pos.stdout);
    exitCode = 1;
  } else {
    for (const m of MUTATIONS) {
      const stashDir = join(tmpRoot, m.name);
      mkdirSync(stashDir, { recursive: true });
      let applied = true;
      let entries = [];
      const createdRels = typeof m.created === "function" ? m.created(work) : [];
      try {
        const targetRels = [...CHECKSUM_RELS, ...(typeof m.targets === "function" ? m.targets(work) : [])];
        entries = stashPaths(work, targetRels, stashDir);
        m.apply(work);
        recomputeChecksums(work);
      } catch (err) {
        applied = false;
        results.push({ control: `${m.group}/${m.name}`, ok: false, error: `mutation failed to apply: ${err.message}` });
        try {
          restorePaths(work, entries, stashDir, createdRels);
        } catch {}
      }
      if (!applied) continue;
      const r = runVerifier(work);
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
      restorePaths(work, entries, stashDir, createdRels);
      rmSync(stashDir, { recursive: true, force: true });
    }
    if (results.some((r) => !r.ok)) exitCode = 1;
    // Confirm restore left the package green.
    const after = runVerifier(work);
    results.push({ control: "positive-after-restore", expect: "pass", verifyExit: after.status, ok: after.status === 0 });
    if (after.status !== 0) exitCode = 1;
  }
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
console.log(JSON.stringify({ package: src, ok: exitCode === 0, results }, null, 2));
process.exit(exitCode);
