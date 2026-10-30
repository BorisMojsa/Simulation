#!/usr/bin/env node
/**
 * Fix 08 actual-engine cohort (production simulateSeason).
 *
 * Minimal viable cohort: 8 roles/contexts × 3 periods. Expand toward 48 fixtures
 * with FIX08_COHORT_FULL=1.
 *
 *   node scripts/qaFix08EngineCohort.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
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

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "qa/fix08-runs/cohort");
mkdirSync(outDir, { recursive: true });
const FULL = process.env.FIX08_COHORT_FULL === "1";

const FIXTURES_MIN = [
  { id: "ST-Hull-70", position: "ST", club: "Hull City", ovr: 70, seed: 8101 },
  { id: "ST-Atalanta-90", position: "ST", club: "Atalanta", ovr: 90, seed: 8102 },
  { id: "RW-Hull-72", position: "RW", club: "Hull City", ovr: 72, seed: 8103 },
  { id: "CM-Atalanta-78", position: "CM", club: "Atalanta", ovr: 78, seed: 8104 },
  { id: "CDM-Hull-74", position: "CDM", club: "Hull City", ovr: 74, seed: 8105 },
  { id: "RB-Hull-71", position: "RB", club: "Hull City", ovr: 71, seed: 8106 },
  { id: "CB-Atalanta-80", position: "CB", club: "Atalanta", ovr: 80, seed: 8107 },
  { id: "GK-Hull-76", position: "GK", club: "Hull City", ovr: 76, seed: 8108 },
];

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

function summarizeSeason(p, data) {
  const season = p.seasons?.at(-1) || data?.season || null;
  const awards = season?.awardRecords || season?.individualAwards || [];
  const records = Array.isArray(season?.awardRecords) ? season.awardRecords : [];
  return {
    seasonId: season?.seasonId ?? null,
    minutes: season?.minutes ?? null,
    goals: season?.goals ?? null,
    assists: season?.assists ?? null,
    avgMatchRating: season?.avgMatchRating ?? null,
    awardNames: season?.individualAwards || [],
    wins: records.filter((r) => r.status === "won").map((r) => r.awardId),
    selections: records.filter((r) => r.status === "selected").map((r) => r.awardId),
    nominations: records.filter((r) => r.status === "nominated").map((r) => r.awardId),
    honors: p.careerHonors || null,
  };
}

const fixtures = FULL
  ? [
      ...FIXTURES_MIN,
      ...Array.from({ length: 40 }, (_, i) => ({
        id: `extra-${i}`,
        position: ["ST", "LW", "CM", "CDM", "RB", "CB", "GK", "CAM"][i % 8],
        club: i % 2 ? "Atalanta" : "Hull City",
        ovr: 68 + (i % 20),
        seed: 8200 + i,
      })),
    ]
  : FIXTURES_MIN;

const periods = 3;
const records = [];
for (const fx of fixtures) {
  const p = basePlayer({ ovr: fx.ovr, id: fx.id, position: fx.position });
  attachClub(p, fx.club);
  reseedCareerRng(fx.seed);
  for (let period = 0; period < periods; period++) {
    const data = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions: false,
      autoDecisionPolicy: "stay",
    });
    const row = {
      fixtureId: fx.id,
      period,
      seed: fx.seed,
      position: fx.position,
      club: fx.club,
      ovr: fx.ovr,
      completion: data?.ok !== false,
      ...summarizeSeason(p, data),
    };
    records.push(row);
    writeFileSync(join(outDir, `${fx.id}-p${period}.json`), JSON.stringify(row, null, 2));
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  head: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(),
  mode: FULL ? "full-ish" : "minimal",
  fixtures: fixtures.length,
  periods,
  periodRecords: records.length,
  wins: records.reduce((s, r) => s + (r.wins?.length || 0), 0),
  selections: records.reduce((s, r) => s + (r.selections?.length || 0), 0),
  nominations: records.reduce((s, r) => s + (r.nominations?.length || 0), 0),
  records,
};
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(
  JSON.stringify(
    {
      outDir,
      fixtures: summary.fixtures,
      periodRecords: summary.periodRecords,
      wins: summary.wins,
      selections: summary.selections,
      nominations: summary.nominations,
    },
    null,
    2
  )
);
