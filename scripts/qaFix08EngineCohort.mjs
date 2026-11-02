#!/usr/bin/env node
/**
 * Fix 08 actual-engine cohort (production simulateSeason).
 *
 * Default: 48 fixtures × 3 periods across ≥3 leagues (144 period records).
 * FIX08_COHORT_QUICK=1: 8×3 smoke subset.
 *
 *   node scripts/qaFix08EngineCohort.mjs
 *   FIX08_COHORT_OUT=qa/fix08-runs/cohort-final node scripts/qaFix08EngineCohort.mjs
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { LEAGUES, LEAGUE_LOOKUP } from "../js/data/leagues.js";
import { createPlayerIdentity } from "../js/simulation/playerDevelopment.js";
import { ensurePlayerModel } from "../js/simulation/playerModelMigration.js";
import { refreshAbilityCaches } from "../js/simulation/playerAbility.js";
import { ensureTransferSave } from "../js/simulation/transferMigration.js";
import { createWorldState, setWorldState } from "../js/simulation/worldState.js";
import { reseedCareerRng } from "../js/simulation/rng.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import { allSeniorClubs } from "../js/simulation/seniorClubs.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import { ensureContractAuthority } from "../js/simulation/contractLifecycle.js";
import { serializeCareerSnapshot } from "../js/simulation/careerSnapshot.js";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, process.env.FIX08_COHORT_OUT || "qa/fix08-runs/cohort");
mkdirSync(outDir, { recursive: true });
mkdirSync(join(outDir, "fixtures"), { recursive: true });
mkdirSync(join(outDir, "ledgers"), { recursive: true });
mkdirSync(join(outDir, "dedicated"), { recursive: true });
mkdirSync(join(outDir, "fields"), { recursive: true });
mkdirSync(join(outDir, "snapshots"), { recursive: true });
const fieldsRoot = join(root, "qa/fix08-runs/fields");
const snapsRoot = join(root, "qa/fix08-runs/snapshots");
mkdirSync(fieldsRoot, { recursive: true });
mkdirSync(snapsRoot, { recursive: true });
const QUICK = process.env.FIX08_COHORT_QUICK === "1";
const REQUIRE_TRACE = process.env.FIX08_COHORT_REQUIRE_TRACE !== "0";
// Retain full pre-compaction award populations for independent rank recomputation.
if (process.env.FIX08_RETAIN_FIELD_POPULATION == null) {
  process.env.FIX08_RETAIN_FIELD_POPULATION = "1";
}
const periods = 3;

const POSITIONS = ["ST", "LW", "RW", "CAM", "CM", "CDM", "RB", "CB", "LB", "GK", "CF", "LM"];
const CLUBS = [
  { club: "Hull City", leagueHint: "Championship" },
  { club: "Atalanta", leagueHint: "Serie A" },
  { club: "Ajax", leagueHint: "Eredivisie" },
  { club: "Athletic Bilbao", leagueHint: "La Liga" },
];

function buildFixtures() {
  const list = [];
  let seed = 8101;
  // 48 ordinary fixtures: 12 positions × 4 clubs (3+ leagues).
  for (let i = 0; i < 48; i++) {
    const pos = POSITIONS[i % POSITIONS.length];
    const clubMeta = CLUBS[i % CLUBS.length];
    const band = Math.floor(i / 12); // 0 ordinary, 1 mid, 2 strong, 3 thin/poor
    const ovr = [70, 76, 88, 62][band] + (i % 3);
    list.push({
      id: `${pos}-${clubMeta.club.replace(/\s+/g, "")}-${ovr}-${i}`,
      position: pos,
      club: clubMeta.club,
      leagueHint: clubMeta.leagueHint,
      ovr,
      age: 20 + (i % 8),
      seed: seed++,
      band: ["ordinary", "mid", "strong", "thin"][band],
    });
  }
  return list;
}

const FIXTURES_QUICK = [
  { id: "ST-Hull-70", position: "ST", club: "Hull City", leagueHint: "Championship", ovr: 70, age: 24, seed: 8101, band: "ordinary" },
  { id: "ST-Atalanta-90", position: "ST", club: "Atalanta", leagueHint: "Serie A", ovr: 90, age: 24, seed: 8102, band: "strong" },
  { id: "RW-Hull-72", position: "RW", club: "Hull City", leagueHint: "Championship", ovr: 72, age: 22, seed: 8103, band: "ordinary" },
  { id: "CM-Atalanta-78", position: "CM", club: "Atalanta", leagueHint: "Serie A", ovr: 78, age: 23, seed: 8104, band: "mid" },
  { id: "CDM-Hull-74", position: "CDM", club: "Hull City", leagueHint: "Championship", ovr: 74, age: 25, seed: 8105, band: "ordinary" },
  { id: "RB-Ajax-71", position: "RB", club: "Ajax", leagueHint: "Eredivisie", ovr: 71, age: 21, seed: 8106, band: "ordinary" },
  { id: "CB-Atalanta-80", position: "CB", club: "Atalanta", leagueHint: "Serie A", ovr: 80, age: 26, seed: 8107, band: "mid" },
  { id: "GK-Hull-76", position: "GK", club: "Hull City", leagueHint: "Championship", ovr: 76, age: 24, seed: 8108, band: "mid" },
];

const fixtures = QUICK ? FIXTURES_QUICK : buildFixtures();

function attrs(ovr) {
  return Object.fromEntries(
    ["Speed", "Passing", "Shooting", "Defending", "Physicality", "Dribbling"].map((k) => [k, ovr])
  );
}

function basePlayer({ ovr, age = 24, id, position }) {
  reseedCareerRng(1);
  resetClubFinanceLedgers();
  setWorldState(createWorldState({ startYear: 2026 }));
  const p = createPlayerIdentity({ name: id, nationality: "England", position, age });
  Object.assign(p, {
    careerId: id,
    startYear: 2026,
    age,
    club: null,
    seasons: [],
    contractStatus: "released",
    contractEndSeason: 0,
    employmentClubId: null,
    playingClubId: null,
    weeklyWage: 0,
    wage: 0,
    rating: ovr,
    attributes: attrs(ovr),
    potentialForecast: { upper: ovr + 8 },
    state: { form: 0, morale: 0, readiness: 1, fatigue: 0, adaptationPenalty: 0, roleFit: 1 },
  });
  ensurePlayerModel(p);
  refreshAbilityCaches(p);
  ensureContractAuthority(p);
  ensureTransferSave(p);
  return p;
}

function attachClub(p, clubName) {
  const club = allSeniorClubs().find((c) => c.name === clubName);
  if (!club) throw new Error(`missing club ${clubName}`);
  Object.assign(p, {
    club: { ...club },
    employmentClubId: club.clubId,
    playingClubId: club.clubId,
    contractStatus: "active",
    contractStartSeason: 0,
    contractYears: 4,
    contractEndSeason: 4,
    weeklyWage: 2000,
    wage: 2000,
  });
}

function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function summarizeSeason(p, data) {
  const season = p.seasons?.at(-1) || data?.season || null;
  const records = Array.isArray(season?.awardRecords) ? season.awardRecords : [];
  const decisionTrace = season?.awardDecisionTrace || data?.awards?.decisionTrace || null;
  return {
    seasonId: season?.seasonId ?? season?.seasonNumber ?? null,
    seasonNumber: season?.seasonNumber ?? null,
    minutes: season?.minutes ?? null,
    goals: season?.goals ?? null,
    assists: season?.assists ?? null,
    cleanSheets: season?.cleanSheets ?? null,
    avgMatchRating: season?.avgMatchRating ?? null,
    awardNames: season?.individualAwards || season?.awardNames || [],
    wins: records.filter((r) => r.status === "won").map((r) => r.awardId),
    selections: records.filter((r) => r.status === "selected").map((r) => r.awardId),
    nominations: records.filter((r) => r.status === "nominated").map((r) => r.awardId),
    decisionTrace,
    honors: p.careerHonors || null,
    age: p.age ?? null,
    historyLength: Array.isArray(p.seasons) ? p.seasons.length : 0,
  };
}

function rivalExport(r) {
  return {
    id: r.id,
    name: r.name,
    position: r.position,
    group: r.group,
    club: r.club,
    clubId: r.clubId,
    minutes: r.minutes,
    matches: r.matches,
    starts: r.starts,
    goals: r.goals,
    assists: r.assists,
    cleanSheets: r.cleanSheets,
    rating: r.rating,
    age: r.age,
    priorSeniorMinutes: r.priorSeniorMinutes,
    talent: r.talent,
    userTeam: r.userTeam,
    teamPpg: r.teamPpg,
  };
}

/** Raw match/fixture observations + candidate field for independent recomputation. */
function rawSeasonEvidence(p, data, meta) {
  const season = p.seasons?.at(-1) || data?.season || null;
  const fields = p.awardFields || {};
  const fieldEntries = Object.entries(fields).map(([editionId, f]) => {
    const base = {
      editionId,
      version: f?.version ?? null,
      stage: f?.stage ?? null,
      scope: f?.scope ?? null,
      seasonId: f?.seasonId ?? null,
      possibleMinutes: f?.possibleMinutes ?? null,
      populationSize: f?.populationSize ?? null,
      inputFingerprint: f?.inputFingerprint ?? null,
      userContext: f?.userContext ?? null,
      approximated: f?.approximated ?? null,
      tableApproximated: f?.tableApproximated ?? null,
      playerStatsApproximated: f?.playerStatsApproximated ?? null,
      cleanSheetBasis: f?.cleanSheetBasis ?? null,
      note: f?.note ?? null,
      scoreUnits: f?.scoreUnits ?? null,
      talentToAbility: f?.talentToAbility ?? null,
    };
    if (f?.scope === "world") {
      return {
        ...base,
        candidates: Array.isArray(f.candidates) ? f.candidates : [],
        // World fields do not use league rival rosters; keep empty for schema clarity.
        rivals: [],
      };
    }
    const compact = Array.isArray(f?.rivals) ? f.rivals.map(rivalExport) : [];
    const full = Array.isArray(f?.diagnosticPopulation)
      ? f.diagnosticPopulation.map(rivalExport)
      : null;
    return {
      ...base,
      referenceMoments: f?.referenceMoments ?? null,
      rivals: compact,
      diagnosticPopulation: full,
      compactRivalCount: compact.length,
      fullPopulationCount: full ? full.length : f?.populationSize ?? null,
    };
  });
  return {
    ...meta,
    seasonId: season?.seasonId ?? season?.seasonNumber ?? null,
    ledgerRecords: Array.isArray(season?.ledgerRecords) ? season.ledgerRecords : [],
    participationLedger: season?.participationLedger || null,
    playingTimeAssessment: season?.playingTimeAssessment || null,
    awardRecords: Array.isArray(season?.awardRecords) ? season.awardRecords : [],
    awardNames: season?.individualAwards || season?.awardNames || [],
    decisionTrace: season?.awardDecisionTrace || data?.awards?.decisionTrace || null,
    // Production simulateSeason exposes the awards table on standings.table.
    table: data?.standings?.table || season?.leagueTable || data?.leagueTable || null,
    awardFields: fieldEntries,
  };
}

function harnessDigest() {
  const files = [
    "scripts/qaFix08EngineCohort.mjs",
    "js/simulation/individualAwards.js",
    "js/simulation/matchEngine.js",
    "js/simulation/seasonSimulator.js",
  ];
  const h = createHash("sha256");
  for (const f of files) {
    const p = join(root, f);
    if (existsSync(p)) h.update(f).update("\0").update(readFileSync(p));
  }
  return h.digest("hex");
}

const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).stdout.trim();
const startedAt = new Date().toISOString();
const records = [];
const fixtureHashes = {};
const leaguesSeen = new Set();

for (const fx of fixtures) {
  const p = basePlayer({ ovr: fx.ovr, id: fx.id, position: fx.position, age: fx.age });
  attachClub(p, fx.club);
  leaguesSeen.add(p.club?.league || fx.leagueHint || "?");
  reseedCareerRng(fx.seed);
  const initialSnap = serializeCareerSnapshot({ player: p, leagues: LEAGUES });
  const fixtureHash = hashJson({
    id: fx.id,
    position: fx.position,
    club: fx.club,
    ovr: fx.ovr,
    age: fx.age,
    seed: fx.seed,
    careerId: p.careerId,
    clubId: p.club?.clubId,
  });
  fixtureHashes[fx.id] = fixtureHash;
  const initialSnapshotPath = join(outDir, "snapshots", `${fx.id}-initial.json`);
  writeFileSync(initialSnapshotPath, JSON.stringify(initialSnap));
  writeFileSync(join(snapsRoot, `${fx.id}-initial.json`), JSON.stringify(initialSnap));
  const initialSnapshotHash = hashJson(initialSnap);
  writeFileSync(
    join(outDir, "fixtures", `${fx.id}.json`),
    JSON.stringify(
      {
        fixture: fx,
        fixtureHash,
        initialPlayer: {
          careerId: p.careerId,
          age: p.age,
          position: p.position,
          rating: p.rating,
          club: p.club?.name,
          league: p.club?.league,
          seasons: 0,
        },
        initialSnapshotPath: `snapshots/${fx.id}-initial.json`,
        initialSnapshotHash,
      },
      null,
      2
    )
  );

  const age0 = p.age;
  for (let period = 0; period < periods; period++) {
    const seasonsBefore = p.seasons?.length || 0;
    const data = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions: false,
      autoDecisionPolicy: "stay",
    });
    const summary = summarizeSeason(p, data);
    const hasTrace =
      summary.decisionTrace != null && Object.keys(summary.decisionTrace).length >= 7;
    const completed =
      data?.ok !== false &&
      summary.historyLength === seasonsBefore + 1 &&
      (summary.seasonId != null || summary.seasonNumber != null) &&
      Number.isFinite(summary.minutes) &&
      (!REQUIRE_TRACE || hasTrace);
    const meta = {
      fixtureId: fx.id,
      period,
      seed: fx.seed,
      position: fx.position,
      club: fx.club,
      league: p.club?.league || fx.leagueHint,
      ovr: fx.ovr,
      band: fx.band,
      fixtureHash,
      completion: completed,
      ageBefore: age0 + period,
      ageAfter: p.age,
    };
    const row = { ...meta, ...summary };
    const raw = rawSeasonEvidence(p, data, meta);
    records.push(row);
    writeFileSync(join(outDir, "ledgers", `${fx.id}-p${period}.json`), JSON.stringify(raw, null, 2));
    writeFileSync(join(outDir, `${fx.id}-p${period}.json`), JSON.stringify(row, null, 2));
    for (const field of raw.awardFields || []) {
      const safe = String(field.editionId || "edition").replace(/[^a-zA-Z0-9:_-]+/g, "_");
      const fieldPath = `${fx.id}-p${period}-${safe}.json`;
      writeFileSync(join(outDir, "fields", fieldPath), JSON.stringify(field, null, 2));
      writeFileSync(join(fieldsRoot, fieldPath), JSON.stringify(field, null, 2));
    }
  }
}

// Dedicated earned / negative controls (not counted toward ordinary 48).
// careerId is jointly load-bearing with seed for the award RNG stream.
const dedicatedSpecs = [
  // Scoring-award positive: Golden Boot + TOTS (engine-proven careerId+seed).
  { label: "earned-outfield-boot-12225", position: "ST", club: "Ajax", ovr: 96, age: 23, seed: 12225, careerId: "s12225" },
  { label: "earned-outfield-tots-13011", position: "ST", club: "Ajax", ovr: 96, age: 23, seed: 13011, careerId: "fix08-b02" },
  { label: "earned-gk-glove-14076", position: "GK", club: "Atalanta", ovr: 90, age: 22, seed: 14076, careerId: "fix08-b03-gk" },
  { label: "ordinary-negative-8101", position: "ST", club: "Hull City", ovr: 70, age: 24, seed: 8101, careerId: "w8101" },
  { label: "thin-negative-Ajax-62", position: "CM", club: "Ajax", ovr: 62, age: 28, seed: 9301, careerId: "w9301" },
];
const dedicated = [];
for (const spec of dedicatedSpecs) {
  const p = basePlayer({
    ovr: spec.ovr,
    id: spec.careerId || `w${spec.seed}`,
    position: spec.position,
    age: spec.age,
  });
  attachClub(p, spec.club);
  reseedCareerRng(spec.seed);
  const data = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  const summary = summarizeSeason(p, data);
  const raw = rawSeasonEvidence(p, data, {
    label: spec.label,
    seed: spec.seed,
    position: spec.position,
    club: spec.club,
    ovr: spec.ovr,
    age: spec.age,
  });
  const row = { ...spec, careerId: p.careerId, league: p.club?.league, ...summary };
  dedicated.push(row);
  writeFileSync(join(outDir, "dedicated", `${spec.label}.json`), JSON.stringify({ ...row, raw }, null, 2));
  writeFileSync(join(outDir, "ledgers", `dedicated-${spec.label}.json`), JSON.stringify(raw, null, 2));
  for (const field of raw.awardFields || []) {
    const safe = String(field.editionId || "edition").replace(/[^a-zA-Z0-9:_-]+/g, "_");
    const fieldPath = `dedicated-${spec.label}-${safe}.json`;
    writeFileSync(join(outDir, "fields", fieldPath), JSON.stringify(field, null, 2));
    writeFileSync(join(fieldsRoot, fieldPath), JSON.stringify(field, null, 2));
  }
}
writeFileSync(
  join(outDir, "dedicated", "index.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      note: "careerId=w{seed} matches search provenance",
      results: dedicated.map((r) => ({
        label: r.label,
        wins: r.wins,
        sel: r.selections,
        nom: r.nominations,
        names: r.awardNames,
        goals: r.goals,
        decisionTrace: r.decisionTrace
          ? Object.fromEntries(
              Object.entries(r.decisionTrace).map(([k, v]) => [k, { status: v.status, reason: v.reason, rank: v.rank }])
            )
          : null,
      })),
    },
    null,
    2
  )
);

const incomplete = records.filter((r) => !r.completion);
const summary = {
  generatedAt: new Date().toISOString(),
  startedAt,
  finishedAt: new Date().toISOString(),
  head,
  dirty: dirty.length > 0,
  dirtyPorcelain: dirty || null,
  harnessDigest: harnessDigest(),
  mode: QUICK ? "quick-8x3" : "full-48x3",
  fixtures: fixtures.length,
  periods,
  periodRecords: records.length,
  requiredPeriodRecords: fixtures.length * periods,
  leagues: [...leaguesSeen],
  leagueCount: leaguesSeen.size,
  fixtureHashes,
  wins: records.reduce((s, r) => s + (r.wins?.length || 0), 0),
  selections: records.reduce((s, r) => s + (r.selections?.length || 0), 0),
  nominations: records.reduce((s, r) => s + (r.nominations?.length || 0), 0),
  incompleteCount: incomplete.length,
  completionPass: incomplete.length === 0 && records.length === fixtures.length * periods,
  leaguesPass: leaguesSeen.size >= 3,
  sizePass: QUICK ? records.length === 24 : records.length >= 144,
  decisionTraceCoverage: records.filter((r) => r.decisionTrace && Object.keys(r.decisionTrace).length >= 7).length,
  dedicated: dedicated.map((r) => ({
    label: r.label,
    wins: r.wins,
    selections: r.selections,
    nominations: r.nominations,
    goals: r.goals,
  })),
  scoringAwardWitness: dedicated.some(
    (r) => (r.wins || []).includes("golden-boot") || (r.wins || []).includes("golden-glove")
  ),
  ok: null,
};
summary.requireTrace = REQUIRE_TRACE;
summary.ok =
  summary.completionPass &&
  summary.leaguesPass &&
  summary.sizePass &&
  summary.scoringAwardWitness === true &&
  (!REQUIRE_TRACE || summary.decisionTraceCoverage === records.length);

writeFileSync(join(outDir, "summary.json"), JSON.stringify({ ...summary, records }, null, 2));
writeFileSync(
  join(outDir, "provenance.json"),
  JSON.stringify(
    {
      head: summary.head,
      dirty: summary.dirty,
      harnessDigest: summary.harnessDigest,
      startedAt: summary.startedAt,
      finishedAt: summary.finishedAt,
      command: `FIX08_COHORT_OUT=${process.env.FIX08_COHORT_OUT || "qa/fix08-runs/cohort"}${QUICK ? " FIX08_COHORT_QUICK=1" : ""} node scripts/qaFix08EngineCohort.mjs`,
      exitCodeExpected: summary.ok ? 0 : 1,
      node: process.version,
      package: (() => {
        try {
          return require("../package.json").name;
        } catch {
          return null;
        }
      })(),
    },
    null,
    2
  )
);

console.log(
  JSON.stringify(
    {
      outDir,
      mode: summary.mode,
      fixtures: summary.fixtures,
      periodRecords: summary.periodRecords,
      leagues: summary.leagues,
      wins: summary.wins,
      selections: summary.selections,
      nominations: summary.nominations,
      incompleteCount: summary.incompleteCount,
      decisionTraceCoverage: summary.decisionTraceCoverage,
      ok: summary.ok,
    },
    null,
    2
  )
);
process.exitCode = summary.ok ? 0 : 1;
