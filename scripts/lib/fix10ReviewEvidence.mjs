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
import { gunzipSync } from "node:zlib";

export const EVIDENCE_SCHEMA = "fix10-rereview-evidence-v2";
export const FOCUSED_IDS = Array.from({ length: 18 }, (_, i) => `F${String(i + 1).padStart(2, "0")}`);
export const BROWSER_IDS = ["B01", "B02", "B03", "B04", "B05", "B06", "B07", "B08"];
export const COHORT_TARGET = 24;
/** Fixed production-season target; a smoke run (FIX10_PROD_SEASON_N < 100) can never pass readiness. */
export const PROD_SEASON_MIN = 100;
export const PROD_REQUIRED_ROLES = ["ST", "CM", "CB", "GK"];
export const PROD_FROZEN_MINUTES = 90;
export const REQUIRED_SOURCE_FILES = [
  "js/simulation/teamStrength.js",
  "tests/clubStrengthSuperstarImpact.test.mjs",
  "scripts/packageFix10Review.mjs",
  "scripts/verifyFix10Review.mjs",
  "scripts/lib/fix10ReviewEvidence.mjs",
  "scripts/qaFix10NegativeVerify.mjs",
  "scripts/qaFix10ProductionSeasons.mjs",
  "scripts/qaFix10CareerCohort.mjs",
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

function gate(ok, reason, extra = {}) {
  return { ok: ok === true, reason: ok ? "ok" : reason, ...extra };
}

/* ------------------------------------------------------- shared helpers */

/** Resolve a package-relative reference; null for absolute / traversal / non-string refs. */
function safeJoin(dir, rel) {
  if (typeof rel !== "string" || rel === "" || rel.startsWith("/") || rel.includes("\\")) return null;
  if (rel.split("/").includes("..")) return null;
  return join(dir, rel);
}

const isFiniteNum = (v) => typeof v === "number" && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Shape of a `serializeCareerSnapshot` payload (world + player + clubFinance + rngSeed). */
function careerSnapshotShapeProblems(tag, snap) {
  const out = [];
  if (!isObj(snap)) return [`${tag}:not-object`];
  if (!isFiniteNum(snap.schemaVersion)) out.push(`${tag}:schemaVersion`);
  if (!isObj(snap.world)) out.push(`${tag}:world`);
  else if (!snap.world.clubStrengthModelVersion) out.push(`${tag}:world.clubStrengthModelVersion`);
  if (!isObj(snap.player)) out.push(`${tag}:player`);
  if (!isObj(snap.clubFinance)) out.push(`${tag}:clubFinance`);
  if (!isFiniteNum(snap.rngSeed)) out.push(`${tag}:rngSeed`);
  return out;
}

/** Real finance = >=1 ledger under clubFinance.ledgers with clubId + numeric cash. */
function ledgerProblems(tag, snap) {
  const ledgers = snap?.clubFinance?.ledgers;
  if (!isObj(ledgers) || Object.keys(ledgers).length === 0) return [`${tag}:clubFinance.ledgers-empty`];
  const out = [];
  for (const [k, v] of Object.entries(ledgers)) {
    if (!isObj(v) || typeof v.clubId !== "string" || !isFiniteNum(v.cashAvailable)) {
      out.push(`${tag}:ledger-not-real:${k}`);
      break;
    }
  }
  return out;
}

/* ---------------------------------------------------------------- gates */

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

/** Flatten the last committed season's player matches (league + domestic cup + continental). */
function lastSeasonMatches(player) {
  const last = Array.isArray(player?.seasons) ? player.seasons.at(-1) : null;
  if (!last) return [];
  const league = last.leagueMatches || last.leagueAllMatches || last.playerMatches || [];
  const cup = (last.domesticCupCampaigns || []).flatMap((c) => c.playerMatches || c.matches || []);
  const cont =
    last.europeanCampaign?.playerMatches ||
    last.continentalCampaign?.playerMatches ||
    last.europeanCampaign?.matches ||
    [];
  return [...league, ...cup, ...cont];
}

function assessBrowser(qa) {
  const bdir = join(qa, "browser");
  const r = readJson(join(bdir, "browser-report.json"));
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
    if (!b.requiredIds?.includes?.(id) || !b.selectedIds?.includes?.(id)) problems.push(`${id}-not-required-and-selected`);
    // File reference: each case must have written at least one case-evidence file.
    const caseFiles = listFiles(join(bdir, "cases")).filter((f) => f.startsWith(`${id}-`));
    if (caseFiles.length === 0) problems.push(`${id}-no-case-evidence-files`);
  }

  /* ---- B04: substantive scale evidence, no injected short-appearance fixture ---- */
  const b04 = b.cases?.B04 || {};
  const b04Files = [
    ...listFiles(join(bdir, "cases")).filter((f) => f.startsWith("B04-")).map((f) => join(bdir, "cases", f)),
    ...listFiles(join(bdir, "snapshots")).filter((f) => f.startsWith("B04-")).map((f) => join(bdir, "snapshots", f)),
  ];
  if (existsSync(join(bdir, "cases", "B04-short-injected.json"))) problems.push("B04-injected-short-fixture-case-present");
  if (/:short\d+/.test(JSON.stringify(b04))) problems.push("B04-report-has-injected-short-fixture-id");
  for (const f of b04Files) {
    if (/:short\d+/.test(readFileSync(f, "utf8"))) problems.push(`B04-injected-short-fixture-id:${f.slice(qa.length + 1)}`);
  }
  const sc = b04.scale || {};
  // Below-replacement careers produce negative impact; require nonzero scale ≈ 1/3.
  if (
    !(
      isFiniteNum(sc.m0) &&
      Math.abs(sc.m0) < 1e-6 &&
      isFiniteNum(sc.m30) &&
      isFiniteNum(sc.m90) &&
      Math.abs(sc.m30) > 1e-6 &&
      Math.abs(sc.m30 * 3 - sc.m90) < 0.15
    )
  ) {
    problems.push("B04-scale-not-substantive");
  }
  const sa = b04.shortAppearance || {};
  if (!(sa.minutes >= 20 && sa.minutes <= 45 && isFiniteNum(sa.impactAttack) && typeof sa.fixtureId === "string" && sa.fixtureId)) {
    problems.push("B04-short-appearance-missing");
  }
  if (!(b04.zeroRows >= 1)) problems.push("B04-no-zero-participation-rows");
  const b04Desk = readJson(join(bdir, "snapshots", "B04-desk.full.json"));
  if (!b04Desk.ok) problems.push(`B04-desk-snapshot-${b04Desk.error}`);
  else {
    const rows = lastSeasonMatches(b04Desk.value?.player).map((m) => ({
      id: m.fixtureId || m.matchId || null,
      minutes: Number(m.playerStats?.minutes) || 0,
      impact: m.effectiveStrength?.[m.playerSide]?.playerImpact?.attack,
    }));
    const shortRows = rows.filter((x) => x.minutes >= 20 && x.minutes <= 45 && isFiniteNum(x.impact));
    // The report's short appearance must be an actual exported row (not just a claimed id).
    const short = shortRows.find((x) => x.id === sa.fixtureId) || null;
    const full = rows.find((x) => x.minutes >= 80 && isFiniteNum(x.impact));
    if (shortRows.length === 0) problems.push("B04-desk-no-natural-short-appearance-row");
    else if (!short) problems.push("B04-desk-short-row-vs-report-fixtureId");
    if (!full) problems.push("B04-desk-no-full-appearance-row");
    if (short && full && Math.abs(short.impact - full.impact * (short.minutes / full.minutes)) >= 0.12) {
      problems.push("B04-desk-short-vs-full-impact-scale");
    }
    if (!rows.some((x) => x.minutes <= 0)) problems.push("B04-desk-no-zero-minute-row");
  }
  if (!existsSync(join(bdir, "snapshots", "B04-short-initial.full.json"))) problems.push("B04-short-initial-snapshot-missing");

  /* ---- B06: pause + restore with real finance and non-empty checkpoint evidence ---- */
  const b06 = b.cases?.B06 || {};
  const paused = readJson(join(bdir, "snapshots", "B06-paused.full.json"));
  const desk = readJson(join(bdir, "snapshots", "B06-desk.full.json"));
  const init = readJson(join(bdir, "snapshots", "B06-initial.full.json"));
  if (!paused.ok) problems.push(`B06-paused-snapshot-${paused.error}`);
  if (!desk.ok) problems.push(`B06-restored-desk-snapshot-${desk.error}`);
  if (!init.ok) problems.push(`B06-initial-snapshot-${init.error}`);
  if (paused.ok) {
    problems.push(...careerSnapshotShapeProblems("B06-paused", paused.value));
    problems.push(...ledgerProblems("B06-paused", paused.value));
    const ck = paused.value?.seasonCheckpoint || paused.value?.player?.seasonCheckpoint;
    if (!isObj(ck)) problems.push("B06-paused-checkpoint-missing");
    else {
      if (!Array.isArray(ck.ordered) || ck.ordered.length === 0) problems.push("B06-paused-checkpoint-ordered-empty");
      if (!Array.isArray(ck.processedEventIds) || ck.processedEventIds.length === 0 || !ck.processedEventIds.every((x) => typeof x === "string" && x)) {
        problems.push("B06-paused-checkpoint-processedEventIds-empty");
      } else if (Array.isArray(ck.ordered) && ck.processedEventIds.length > ck.ordered.length) {
        problems.push("B06-paused-checkpoint-processed-exceeds-ordered");
      }
    }
    if (!isFiniteNum(paused.value?.world?.rngState)) problems.push("B06-paused-rngState-missing");
    if (b06.rngSeed !== paused.value?.rngSeed) problems.push("B06-report-rngSeed-vs-paused-snapshot");
    if ((paused.value?.player?.seasons || []).length !== 0) problems.push("B06-paused-snapshot-has-committed-season");
  }
  if (desk.ok) {
    problems.push(...careerSnapshotShapeProblems("B06-restored-desk", desk.value));
    problems.push(...ledgerProblems("B06-restored-desk", desk.value));
    if ((desk.value?.player?.seasons || []).length < 1) problems.push("B06-restored-desk-season-not-completed");
  }
  if (init.ok) problems.push(...careerSnapshotShapeProblems("B06-initial", init.value));
  if (!(isFiniteNum(b06.pausedST) && b06.pausedST === b06.restoredST)) problems.push("B06-report-pausedST-vs-restoredST");
  if (b06.pendingEqual !== true) problems.push("B06-report-pendingEqual-not-true");
  if (!(b06.finance?.hasLedgers === true && b06.finance?.ledgerCount > 0)) problems.push("B06-report-finance-no-real-ledgers");

  return gate(problems.length === 0, "browser-incomplete", { problems });
}

/* ---------------------------------------------------- production seasons */

/**
 * Load the producer's canonical compressed JSONL traces (`fixtures/<context>.jsonl.gz`).
 * Uncompressed `.jsonl` or legacy `*-fixtures-s0.json` samples must never satisfy readiness.
 */
function loadProdFixturesGzip(dir, cid, cache) {
  if (cache.has(cid)) return cache.get(cid);
  const gzPath = join(dir, "fixtures", `${cid}.jsonl.gz`);
  if (!existsSync(gzPath)) {
    const r = { ok: false, error: "fixtures-jsonl-gz-missing", map: null, lineCount: 0, bad: 0, duplicates: 0 };
    cache.set(cid, r);
    return r;
  }
  let raw;
  try {
    raw = gunzipSync(readFileSync(gzPath));
  } catch {
    const r = { ok: false, error: "fixtures-jsonl-gz-corrupt-or-truncated", map: null, lineCount: 0, bad: 0, duplicates: 0 };
    cache.set(cid, r);
    return r;
  }
  const text = raw.toString("utf8");
  if (!text.trim()) {
    const r = { ok: false, error: "fixtures-jsonl-gz-empty", map: null, lineCount: 0, bad: 0, duplicates: 0 };
    cache.set(cid, r);
    return r;
  }
  const map = new Map();
  let bad = 0;
  let duplicates = 0;
  let lineCount = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    lineCount += 1;
    try {
      const o = JSON.parse(line);
      if (!o || typeof o !== "object") {
        bad += 1;
        continue;
      }
      const key = `${o.role}|${o.condition}|${o.seasonIndex}`;
      if (map.has(key)) duplicates += 1;
      map.set(key, o);
    } catch {
      bad += 1;
    }
  }
  let error = null;
  if (bad > 0) error = `fixtures-jsonl-gz-unparseable-lines:${bad}`;
  else if (duplicates > 0) error = `fixtures-jsonl-gz-duplicate-keys:${duplicates}`;
  const r = { ok: error == null, error, map, lineCount, bad, duplicates };
  cache.set(cid, r);
  return r;
}

/** Validate one role against the canonical gzip JSONL for its context. */
function prodFixtureProblems(dir, cid, role, ro, tag, N, deltas, deltaSeeds, jsonlCache) {
  const out = [];
  const expectedPerContext = PROD_REQUIRED_ROLES.length * 2 * N;
  const loaded = loadProdFixturesGzip(dir, cid, jsonlCache);
  if (!loaded.ok || !loaded.map) {
    out.push(`${tag}:${loaded.error || "fixtures-jsonl-gz-missing"}`);
    return out;
  }
  if (loaded.lineCount !== expectedPerContext) {
    out.push(`${tag}:fixtures-jsonl-gz-record-count:${loaded.lineCount}-expected-${expectedPerContext}`);
  }
  const { map } = loaded;
  let missing = 0;
  let badRows = 0;
  let seedMismatch = 0;
  let hashMismatch = 0;
  let scheduleMismatch = 0;
  let recordsChecked = 0;
  for (let i = 0; i < N; i++) {
    const rep = map.get(`${role}|replacement|${i}`);
    const star = map.get(`${role}|star99|${i}`);
    if (!rep || !star) {
      missing += 1;
      continue;
    }
    for (const [o, cond] of [
      [rep, "replacement"],
      [star, "star99"],
    ]) {
      recordsChecked += 1;
      if (
        !Array.isArray(o.fixtures) ||
        o.fixtures.length < 30 ||
        !o.fixtures.every((x) => x && x.minutes === PROD_FROZEN_MINUTES)
      ) {
        badRows += 1;
      }
      if (o.seasonSeed !== deltaSeeds[i] || o.ovr !== ro[cond]?.ovr) seedMismatch += 1;
      if (
        o.fixturesSha256 &&
        Array.isArray(o.fixtures) &&
        o.fixturesSha256 !== sha256Buf(Buffer.from(JSON.stringify(o.fixtures)))
      ) {
        hashMismatch += 1;
      }
      if (!o.fixturesSha256) hashMismatch += 1;
    }
    if (rep.fixtures?.length === star.fixtures?.length) {
      for (let k = 0; k < rep.fixtures.length; k++) {
        const x = rep.fixtures[k];
        const y = star.fixtures[k];
        if (
          !x ||
          !y ||
          x.index !== y.index ||
          x.opponent !== y.opponent ||
          x.venue !== y.venue ||
          x.fixtureSeed !== y.fixtureSeed ||
          x.fixtureId !== y.fixtureId
        ) {
          scheduleMismatch += 1;
          break;
        }
      }
    } else scheduleMismatch += 1;
    const d = deltas[i];
    if (d?.repFixturesSha256 && d.repFixturesSha256 !== rep.fixturesSha256) hashMismatch += 1;
    if (d?.starFixturesSha256 && d.starFixturesSha256 !== star.fixturesSha256) hashMismatch += 1;
  }
  if (missing) out.push(`${tag}:fixtures-jsonl-gz-missing-seasons:${missing}`);
  if (badRows) out.push(`${tag}:fixtures-jsonl-gz-short-or-unfrozen:${badRows}`);
  if (seedMismatch) out.push(`${tag}:fixtures-jsonl-gz-seed-or-ovr-mismatch:${seedMismatch}`);
  if (hashMismatch) out.push(`${tag}:fixtures-jsonl-gz-hash-mismatch:${hashMismatch}`);
  if (scheduleMismatch) out.push(`${tag}:fixtures-jsonl-gz-paired-schedule-mismatch:${scheduleMismatch}`);
  // Stash per-role checked count on the cache entry for the assessor summary.
  loaded.recordsChecked = (loaded.recordsChecked || 0) + recordsChecked;
  return out;
}

function assessProductionSeasons(qa) {
  const dir = join(qa, "production-seasons");
  const r = readJson(join(dir, "summary.json"));
  if (!r.ok) return gate(false, `production-summary-${r.error}`);
  const s = r.value || {};
  const problems = [];
  const N = s.seasonN;
  if (s.kind !== "production-schedule") problems.push("kind-not-production-schedule");
  if (s.ok !== true) problems.push("summary-ok-not-true");
  if (!(Number.isInteger(N) && N >= PROD_SEASON_MIN)) problems.push(`seasonN-below-${PROD_SEASON_MIN}:${N}`);
  if (s.frozenParticipationMinutes !== PROD_FROZEN_MINUTES) problems.push("frozen-minutes-not-90");
  const contexts = Array.isArray(s.contexts) ? s.contexts : [];
  if (contexts.length === 0) problems.push("contexts-empty");
  const fullLabels = new Set();
  let pairedChecked = 0;
  let pairedSeedsChecked = 0;
  const jsonlCache = new Map();

  for (const ctx of contexts) {
    const cid = ctx?.id;
    if (typeof cid !== "string" || !/^[A-Za-z0-9-]+$/.test(cid)) {
      problems.push("context-id-invalid");
      continue;
    }
    if (ctx.seasons !== N) problems.push(`${cid}:seasons-vs-seasonN`);
    if (ctx.frozenMinutes !== PROD_FROZEN_MINUTES) problems.push(`${cid}:frozenMinutes`);
    if (ctx.schedule !== "production-double-round-robin") problems.push(`${cid}:schedule`);
    const roles = isObj(ctx.roles) ? ctx.roles : {};
    if (PROD_REQUIRED_ROLES.every((x) => roles[x])) fullLabels.add(ctx.label);
    for (const [role, ro] of Object.entries(roles)) {
      const tag = `${cid}/${role}`;
      if (ro.seasonCount !== N) problems.push(`${tag}:seasonCount`);
      for (const k of ["replacement", "star99"]) {
        for (const m of ["points", "gf", "ga"]) {
          if (ro[k]?.[m]?.n !== N) problems.push(`${tag}:${k}.${m}.n`);
        }
      }
      if (ro.star99?.ovr !== 99 || !(ro.replacement?.ovr < 99) || ro.replacement?.ovr !== ro.refOvr) {
        problems.push(`${tag}:ovr-conditions`);
      }

      // Paired seeds: the SAME seasonSeed drives replacement and 99 (seed must not depend on ovr).
      // Role-level per-condition seed lists (when emitted) must be identical element-wise.
      const repSeeds = ro.replacement?.seasonSeeds;
      const starSeeds = ro.star99?.seasonSeeds;
      const haveSeedLists = Array.isArray(repSeeds) && Array.isArray(starSeeds);
      if ((repSeeds !== undefined || starSeeds !== undefined) && !haveSeedLists) problems.push(`${tag}:seasonSeeds-list-incomplete`);
      if (haveSeedLists) {
        if (repSeeds.length !== N || starSeeds.length !== N) problems.push(`${tag}:seasonSeeds-list-length`);
        else if (repSeeds.some((x, i) => !Number.isInteger(x) || x !== starSeeds[i])) {
          problems.push(`${tag}:unequal-paired-seeds-in-summary`);
        }
      }
      const seedsOf = (row) => {
        const rep = row?.seasonSeedRep ?? row?.seasonSeed;
        const star = row?.seasonSeedStar ?? row?.seasonSeed;
        const explicit = row?.seasonSeedRep !== undefined || row?.seasonSeedStar !== undefined;
        const conflict = row?.seasonSeed !== undefined && explicit && (rep !== row.seasonSeed || star !== row.seasonSeed);
        return { rep, star, explicit, conflict };
      };
      const sample = Array.isArray(ro.pairedDelta?.sample) ? ro.pairedDelta.sample : [];
      if (sample.length === 0) problems.push(`${tag}:paired-sample-missing`);
      for (const row of sample) {
        const sd = seedsOf(row);
        if (!(Number.isInteger(sd.rep) && sd.rep === sd.star) || sd.conflict) {
          problems.push(`${tag}:unequal-paired-seeds-in-summary`);
          break;
        }
        if (!sd.explicit && !haveSeedLists) {
          problems.push(`${tag}:paired-seed-identity-unproven`);
          break;
        }
      }
      const pf = readJson(join(dir, `${cid}-${role}-paired.json`));
      if (!pf.ok) {
        problems.push(`${tag}:paired-file-${pf.error}`);
        continue;
      }
      pairedChecked += 1;
      const deltas = Array.isArray(pf.value?.pairedDeltas) ? pf.value.pairedDeltas : [];
      if (deltas.length !== N) problems.push(`${tag}:pairedDeltas-count:${deltas.length}`);
      const seeds = new Set();
      let unequal = 0;
      let malformed = 0;
      let unproven = 0;
      const deltaSeeds = [];
      for (const d of deltas) {
        const sd = seedsOf(d);
        if (!(Number.isInteger(sd.rep) && Number.isInteger(sd.star))) malformed += 1;
        else if (sd.rep !== sd.star || sd.conflict) unequal += 1;
        else {
          seeds.add(sd.rep);
          if (!sd.explicit && !haveSeedLists) unproven += 1;
        }
        deltaSeeds.push(sd.rep);
        if (!(isFiniteNum(d?.dPts) && isFiniteNum(d?.dGf) && isFiniteNum(d?.dGa))) malformed += 1;
      }
      pairedSeedsChecked += deltas.length;
      if (unequal > 0) problems.push(`${tag}:unequal-paired-seeds:${unequal}`);
      if (unproven > 0) problems.push(`${tag}:paired-seed-identity-unproven`);
      if (malformed > 0) problems.push(`${tag}:paired-rows-malformed:${malformed}`);
      if (seeds.size !== deltas.length) problems.push(`${tag}:seasonSeeds-not-distinct`);
      if (haveSeedLists && repSeeds.length === deltaSeeds.length && repSeeds.some((x, i) => x !== deltaSeeds[i])) {
        problems.push(`${tag}:summary-seed-list-vs-paired-rows`);
      }
      if (pf.value?.refOvr !== ro.refOvr) problems.push(`${tag}:paired-file-refOvr`);
      // Summary must be derived from the per-season rows, not stand alone.
      const meanPts = deltas.length ? deltas.reduce((a, d) => a + d.dPts, 0) / deltas.length : NaN;
      if (!(Math.abs(meanPts - ro.pairedDelta?.points?.mean) < 1e-6)) problems.push(`${tag}:summary-mean-vs-paired-rows`);
      for (let i = 0; i < Math.min(sample.length, deltas.length); i++) {
        if (JSON.stringify(sample[i]) !== JSON.stringify(deltas[i])) {
          problems.push(`${tag}:summary-sample-vs-paired-rows`);
          break;
        }
      }
      problems.push(...prodFixtureProblems(dir, cid, role, ro, tag, N, deltas, deltaSeeds, jsonlCache));
    }
  }
  if (!fullLabels.has("weak")) problems.push("no-weak-context-with-ST-CM-CB-GK");
  if (!fullLabels.has("mid")) problems.push("no-mid-context-with-ST-CM-CB-GK");
  let gzipRecordsChecked = 0;
  for (const v of jsonlCache.values()) {
    if (v && Number.isFinite(v.recordsChecked)) gzipRecordsChecked += v.recordsChecked;
  }
  const expectedGzipRecords = contexts.length * PROD_REQUIRED_ROLES.length * 2 * (Number.isInteger(N) ? N : 0);
  if (problems.length === 0 && expectedGzipRecords > 0 && gzipRecordsChecked !== expectedGzipRecords) {
    problems.push(`fixtures-jsonl-gz-total-records:${gzipRecordsChecked}-expected-${expectedGzipRecords}`);
  }
  return gate(problems.length === 0, "production-seasons-invalid", {
    seasonN: N ?? null,
    contexts: contexts.length,
    pairedFiles: pairedChecked,
    pairedSeedsChecked,
    gzipRecordsChecked,
    problems: problems.slice(0, 20),
  });
}

/* ---------------------------------------------------------------- cohort */

function cohortRowProblems(dir, row, tag, periodsEach, seen) {
  const out = [];
  if (!isObj(row) || !Number.isInteger(row.seed)) return [`${tag}:row-or-seed-invalid`];
  const t = `${tag}:${row.seed}`;
  if (seen.has(row.seed)) out.push(`${t}:duplicate-seed`);
  seen.add(row.seed);
  if (Number.isFinite(periodsEach) && !(Array.isArray(row.periods) && row.periods.length >= periodsEach)) {
    out.push(`${t}:periods-short`);
  }
  // Slim recipe input: must exist and be this career's, but is NOT sufficient on its own.
  const inputPath = safeJoin(dir, row.inputPath);
  const input = inputPath ? readJson(inputPath) : { ok: false, error: "bad-ref" };
  if (!input.ok) out.push(`${t}:input-${input.error}`);
  else if (input.value?.seed !== row.seed) out.push(`${t}:input-seed-mismatch`);

  const snaps = {};
  for (const [key, label] of [
    ["initialSnapshotPath", "initial-snapshot"],
    ["finalSnapshotPath", "final-snapshot"],
  ]) {
    const p = safeJoin(dir, row[key]);
    if (!p || row[key] === row.inputPath) {
      out.push(`${t}:${label}-ref-missing`);
      continue;
    }
    const j = readJson(p);
    if (!j.ok) {
      out.push(`${t}:${label}-${j.error}`);
      continue;
    }
    const shape = careerSnapshotShapeProblems(`${t}:${label}`, j.value);
    out.push(...shape);
    snaps[label] = j.value;
  }
  const a = snaps["initial-snapshot"];
  const z = snaps["final-snapshot"];
  if (a && z) {
    if (row.initialSnapshotPath === row.finalSnapshotPath) out.push(`${t}:initial-equals-final-ref`);
    const sa = (a.player?.seasons || []).length;
    const sz = (z.player?.seasons || []).length;
    if (!(sz > sa)) out.push(`${t}:final-snapshot-not-advanced`);
    if (Number.isFinite(periodsEach) && sz < periodsEach) out.push(`${t}:final-snapshot-seasons-short`);
  }
  return out;
}

function assessCohort(qa) {
  const dir = join(qa, "career-cohort");
  const r = readJson(join(dir, "summary.json"));
  if (!r.ok) return gate(false, `career-cohort-summary-${r.error}`);
  const s = r.value || {};
  const completed = Number(s.completed);
  if (!Number.isFinite(completed)) return gate(false, "cohort-completed-missing");
  const exclusions = Array.isArray(s.exclusions) ? s.exclusions : [];
  const documented = exclusions.filter((e) => e && e.seed != null && (e.error || e.reason));
  // summary.supplemental may be a pointer (path/seeds/completed) without rows;
  // load supplemental-summary.json whenever rows are absent.
  let supp = s.supplemental && typeof s.supplemental === "object" ? s.supplemental : null;
  if (!supp || !Array.isArray(supp.rows)) {
    const rel = typeof supp?.path === "string" && supp.path ? supp.path : "supplemental-summary.json";
    const f = readJson(join(dir, rel));
    if (f.ok && f.value && typeof f.value === "object") supp = f.value;
  }
  const suppCompleted = Number(supp?.completed) || 0;
  const needed = Math.max(0, COHORT_TARGET - completed);
  const problems = [];
  if (completed < COHORT_TARGET) {
    if (documented.length < needed) problems.push("exclusions-not-documented");
    if (completed + suppCompleted < COHORT_TARGET) problems.push("supplemental-short-of-target");
    if (suppCompleted > 0 && !(Array.isArray(supp?.seeds) && supp.seeds.length >= suppCompleted)) {
      problems.push("supplemental-seeds-missing");
    }
  }

  // Every completed career (primary + supplemental) needs input + initial + final career snapshots.
  const periodsEach = Number(s.periodsEach);
  const seen = new Set();
  const primaryRows = (Array.isArray(s.rows) ? s.rows : []).filter((x) => x && x.excluded !== true);
  if (primaryRows.length !== completed) problems.push(`primary-rows-vs-completed:${primaryRows.length}/${completed}`);
  const suppRows = Array.isArray(supp?.rows) ? supp.rows.filter((x) => x && x.excluded !== true) : [];
  if (suppRows.length !== suppCompleted) problems.push(`supplemental-rows-vs-completed:${suppRows.length}/${suppCompleted}`);
  for (const row of primaryRows) problems.push(...cohortRowProblems(dir, row, "career", periodsEach, seen));
  for (const row of suppRows) problems.push(...cohortRowProblems(dir, row, "supplemental", periodsEach, seen));
  if (seen.size < COHORT_TARGET) problems.push(`distinct-career-seeds-below-target:${seen.size}`);
  for (const e of documented) if (seen.has(e.seed)) problems.push(`excluded-seed-also-completed:${e.seed}`);

  return gate(problems.length === 0, "cohort-incomplete", {
    completed,
    supplemental: suppCompleted,
    careersWithSnapshots: seen.size,
    problems: problems.slice(0, 20),
  });
}

/* ------------------------------------------------------------ full suite */

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function classifyFullSuiteLog(logText) {
  const log = typeof logText === "string" ? logText : "";
  const failedFiles = [...new Set([...log.matchAll(/^not ok \d+ - (tests\/\S+\.test\.mjs)\s*$/gm)].map((m) => m[1]))];
  const anyNotOk = [...log.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1].trim());
  const failedTests = [...log.matchAll(/^# FAIL (.+)$/gm)].map((m) => m[1].trim());
  const base = { failedFiles, failedTests };

  // --- TAP coherence: a bare `# fail 0` (or any cut-off log) must never read as clean.
  const count = (k) => {
    const m = log.match(new RegExp(`^# ${k} (\\d+)\\s*$`, "m"));
    return m ? Number(m[1]) : null;
  };
  const tests = count("tests");
  const pass = count("pass");
  const fail = count("fail");
  const plan = log.match(/^1\.\.(\d+)\s*$/m);
  if (!plan && tests === null) return { ok: false, reason: "truncated-tap-no-plan-or-summary", ...base };
  if (!plan) return { ok: false, reason: "truncated-tap-no-plan", ...base };
  if (tests === null || pass === null || fail === null) return { ok: false, reason: "truncated-tap-incomplete-summary", ...base };
  const cancelled = count("cancelled") ?? 0;
  const skipped = count("skipped") ?? 0;
  const todo = count("todo") ?? 0;
  const topLevel = [...log.matchAll(/^(?:not )?ok \d+ /gm)].length;
  const planN = Number(plan[1]);
  if (!(planN > 0) || topLevel !== planN) return { ok: false, reason: "tap-plan-vs-results-mismatch", ...base, planN, topLevel };
  if (log.indexOf(plan[0]) > log.search(/^# tests \d+/m)) return { ok: false, reason: "tap-plan-after-summary", ...base };
  if (!(tests > 0 && pass > 0 && tests >= planN)) return { ok: false, reason: "tap-summary-empty-or-below-plan", ...base };
  if (pass + fail + cancelled + skipped + todo !== tests) return { ok: false, reason: "tap-summary-counts-inconsistent", ...base };
  if (cancelled > 0) return { ok: false, reason: "tap-cancelled-tests", ...base };
  const hasFailureLines = anyNotOk.length > 0 || failedTests.length > 0;
  if ((fail === 0) === hasFailureLines) return { ok: false, reason: "tap-fail-count-vs-failure-lines", ...base };

  if (fail === 0) return { ok: true, reason: "ok", mode: "clean", ...base, tests, pass, fail };

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
    unexpected.length === 0 && failedTests.length === names.length && names.every((n) => counts.get(n) === 1);
  const paired = allowed.every((f) =>
    new RegExp(`^# FAIL ${escapeRe(f.testName)}\\n[\\s\\S]{0,500}?${escapeRe(f.assertionMarker)}`, "m").test(log)
  );
  let reason = "ok";
  if (!filesOk) reason = "unexpected-failed-files";
  else if (!exactSet) reason = unexpected.length ? "unexpected-failed-assertions" : "failed-assertion-set-mismatch";
  else if (!paired) reason = "allowed-failure-marker-pairing-mismatch";
  return {
    ok: filesOk && exactSet && paired,
    reason,
    ...base,
    unexpected,
    mode: "established-ability-exception",
    tests,
    pass,
    fail,
  };
}

function assessFullSuite(qa) {
  const logPath = join(qa, "logs", "full-suite.log");
  // The log is REQUIRED. A commands.json note (or any other prose) can never stand in for it.
  if (!existsSync(logPath) || statSync(logPath).size === 0) return gate(false, "full-suite-log-missing");
  const c = classifyFullSuiteLog(readFileSync(logPath, "utf8"));
  return gate(c.ok, `full-suite-log-${c.reason}`, {
    source: "log",
    mode: c.mode || null,
    failedFiles: c.failedFiles,
    tests: c.tests ?? null,
    pass: c.pass ?? null,
    fail: c.fail ?? null,
  });
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
    productionSeasons: assessProductionSeasons(qa),
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
    // Substantive counts re-derived from bytes; verifier cross-checks these against its own recompute.
    summary: {
      productionSeasons: {
        seasonN: gates.productionSeasons.seasonN ?? null,
        contexts: gates.productionSeasons.contexts ?? null,
        pairedFiles: gates.productionSeasons.pairedFiles ?? null,
        pairedSeedsChecked: gates.productionSeasons.pairedSeedsChecked ?? null,
        gzipRecordsChecked: gates.productionSeasons.gzipRecordsChecked ?? null,
      },
      cohort: {
        completed: gates.cohort.completed ?? null,
        supplemental: gates.cohort.supplemental ?? null,
        careersWithSnapshots: gates.cohort.careersWithSnapshots ?? null,
      },
      fullSuite: {
        mode: gates.fullSuite.mode ?? null,
        tests: gates.fullSuite.tests ?? null,
        pass: gates.fullSuite.pass ?? null,
        fail: gates.fullSuite.fail ?? null,
      },
    },
  };
  return { ready, gates, evidence, sourceManifest: source.manifest };
}
