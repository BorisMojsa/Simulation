#!/usr/bin/env node
/**
 * Fix 09 QA exporter — focused matrix + 14×3 actual-engine cohort + independent oracle.
 *
 *   node scripts/qaEarnedContinentalQualification.mjs
 *   FIX09_OUT=qa/fix09-runs/final node scripts/qaEarnedContinentalQualification.mjs
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { LEAGUES, LEAGUE_LOOKUP } from "../js/data/leagues.js";
import { createWorldState, setWorldState, serializeWorldState } from "../js/simulation/worldState.js";
import { reseedCareerRng, getSimRng, createRng } from "../js/simulation/rng.js";
import { createPlayerIdentity } from "../js/simulation/playerDevelopment.js";
import { ensurePlayerModel } from "../js/simulation/playerModelMigration.js";
import { refreshAbilityCaches } from "../js/simulation/playerAbility.js";
import { ensureContractAuthority } from "../js/simulation/contractLifecycle.js";
import { ensureTransferSave } from "../js/simulation/transferMigration.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import {
  commitCompletedDomesticEdition,
  getClubTargetDecision,
  getDomesticEditionRecord,
  sourceYearForContinentalTarget,
} from "../js/simulation/earnedQualification.js";
import { createHash } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = process.env.FIX09_OUT || join(root, "qa/fix09-runs/final");
mkdirSync(outDir, { recursive: true });
mkdirSync(join(outDir, "cohort"), { recursive: true });

const started = new Date().toISOString();
const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();

function oracleCompetition(nation, leagueId, position) {
  if (!Number.isInteger(position) || position < 1) return null;
  const uefa = {
    "league:england-premier-league": { cl: 4, el: 1, uecl: 1 },
    "league:france-ligue-1": { cl: 3, el: 1, uecl: 1 },
    "league:serbia-superliga": { cl: 1, el: 1, uecl: 1 },
  };
  if (uefa[leagueId]) {
    const s = uefa[leagueId];
    if (position <= s.cl) return "Champions League";
    if (position <= s.cl + s.el) return "Europa League";
    if (position <= s.cl + s.el + s.uecl) return "Conference League";
    return null;
  }
  if (["Brazil", "Argentina", "Colombia", "Ecuador"].includes(nation)) {
    if (position <= 4) return "Copa Libertadores";
    if (position <= 8) return "Copa Sudamericana";
    return null;
  }
  if (["Mexico", "United States"].includes(nation)) {
    return position <= 4 ? "CONCACAF Champions Cup" : null;
  }
  if (["Saudi Arabia", "Japan", "South Korea"].includes(nation)) {
    return position <= 3 ? "AFC Champions League Elite" : null;
  }
  if (["Egypt", "Morocco"].includes(nation)) {
    return position <= 2 ? "CAF Champions League" : null;
  }
  return null;
}

function runFocused() {
  const r = spawnSync("node", ["--test", "tests/earnedContinentalQualification.test.mjs"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  writeFileSync(join(outDir, "focused-f01-f25.log"), `${r.stdout}\n${r.stderr}`);
  return { exitCode: r.status ?? 1, stdout: r.stdout };
}

const COHORT = [
  { seed: 9101, nation: "England", position: "CM" },
  { seed: 9102, nation: "England", position: "GK" },
  { seed: 9103, nation: "France", position: "CM" },
  { seed: 9104, nation: "France", position: "GK" },
  { seed: 9105, nation: "Serbia", position: "CM" },
  { seed: 9106, nation: "Serbia", position: "GK" },
  { seed: 9107, nation: "Brazil", position: "CM" },
  { seed: 9108, nation: "Brazil", position: "GK" },
  { seed: 9109, nation: "Mexico", position: "CM" },
  { seed: 9110, nation: "Mexico", position: "GK" },
  { seed: 9111, nation: "Saudi Arabia", position: "CM" },
  { seed: 9112, nation: "Saudi Arabia", position: "GK" },
  { seed: 9113, nation: "Egypt", position: "CM" },
  { seed: 9114, nation: "Egypt", position: "GK" },
];

function makeCareer(seed, nation, position) {
  reseedCareerRng(seed);
  resetClubFinanceLedgers();
  const world = createWorldState({ seed, careerSeed: seed, startYear: 2026 });
  setWorldState(world);
  const league = LEAGUES.find((l) => l.nation === nation && (l.divisionLevel ?? 1) === 1);
  if (!league) return null;
  const club = [...league.clubs].sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))[0];
  const player = createPlayerIdentity({
    name: `Fix09 Cohort ${seed}`,
    nationality: nation === "United States" ? "United States" : nation,
    position,
    age: 22,
  });
  const ovr = Math.round(club.overall || 72);
  const attrs = Object.fromEntries(
    ["Speed", "Passing", "Shooting", "Defending", "Physicality", "Dribbling"].map((k) => [k, ovr])
  );
  Object.assign(player, {
    careerId: `fix09-cohort-${seed}`,
    startYear: 2026,
    rating: ovr,
    attributes: attrs,
    potentialForecast: { upper: ovr + 8 },
    state: { form: 0, morale: 0, readiness: 1, fatigue: 0, adaptationPenalty: 0, roleFit: 1 },
    club: {
      ...club,
      league: league.name,
      leagueDisplay: league.displayName,
      leagueId: league.leagueId,
      nation: league.nation,
    },
    employmentClubId: club.clubId,
    playingClubId: club.clubId,
    contractStatus: "active",
    contractStartSeason: 0,
    contractYears: 5,
    contractEndSeason: 5,
    weeklyWage: 3000,
    seasons: [],
  });
  ensurePlayerModel(player);
  refreshAbilityCaches(player);
  ensureContractAuthority(player);
  ensureTransferSave(player);
  return { player, league, world, club };
}

function runCohort() {
  const rows = [];
  let oracleViolations = 0;
  let completedPeriods = 0;
  for (const spec of COHORT) {
    const built = makeCareer(spec.seed, spec.nation, spec.position);
    if (!built) {
      rows.push({ ...spec, ok: false, reason: "league-missing" });
      continue;
    }
    const { player, league, world, club } = built;
    const initialSnap = {
      rngSeed: world.rngSeed,
      rngState: getSimRng().seed(),
      playerClubId: club.clubId,
      leagueId: league.leagueId,
    };
    const periods = [];
    for (let i = 0; i < 3; i++) {
      const beforeSeed = getSimRng().seed();
      let data = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
        pauseForDecisions: false,
        autoDecisionPolicy: "stay",
      });
      let guards = 0;
      while (data?.awaitingScenario && guards < 8) {
        guards += 1;
        player.pendingSeniorScenario = null;
        if (data.checkpoint) data.checkpoint.pendingSeniorScenario = null;
        data = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
          pauseForDecisions: false,
          autoDecisionPolicy: "stay",
        });
      }
      const season = player.seasons[player.seasons.length - 1];
      const sourceYear = (player.startYear || 2026) + Math.max(0, player.seasons.length - 1);
      const targetYear = sourceYear + 1;
      const edition = getDomesticEditionRecord(world, league.leagueId, sourceYear);
      const decision = getClubTargetDecision(world, player.playingClubId || club.clubId, targetYear);
      let oracleOk = true;
      let oracleExpected = null;
      if (decision?.entry) {
        oracleExpected = oracleCompetition(league.nation, league.leagueId, decision.entry.position);
        if (oracleExpected !== decision.entry.competition) {
          oracleOk = false;
          oracleViolations += 1;
        }
      }
      periods.push({
        periodIndex: i,
        sourceYear,
        targetYear,
        playingClubId: player.playingClubId,
        leagueId: season?.leagueId || league.leagueId,
        tableSize: edition?.table?.length || season?.standing?.table?.length || null,
        position: decision?.entry?.position ?? season?.standing?.position ?? null,
        competition: decision?.entry?.competition ?? null,
        provenance: decision?.entry?.provenance || edition?.provenance || null,
        europeCompetition: season?.europeanCampaign?.competition || null,
        europeQualified: season?.europeanCampaign?.qualified !== false && !season?.europeanCampaign?.showcase,
        matchEvidenceIds: edition?.matchEvidenceIds?.length || 0,
        oracleExpected,
        oracleOk,
        rngBefore: beforeSeed,
        rngAfter: getSimRng().seed(),
      });
      completedPeriods += 1;
    }
    const record = {
      ...spec,
      ok: true,
      initialSnap,
      finalRng: getSimRng().seed(),
      periods,
      worldQualificationKeys: [...(world.qualification?.keys?.() || [])].filter((k) =>
        String(k).startsWith("domestic:")
      ).length,
    };
    rows.push(record);
    writeFileSync(
      join(outDir, "cohort", `fixture-${spec.seed}.json`),
      JSON.stringify(record, null, 2)
    );
  }
  return { rows, oracleViolations, completedPeriods };
}

const focused = runFocused();
const cohort = runCohort();

const report = {
  fix: "09-earned-continental-qualification",
  started,
  ended: new Date().toISOString(),
  sourceSha: sha,
  node: process.version,
  focused: {
    exitCode: focused.exitCode,
    pass: focused.exitCode === 0,
  },
  cohort: {
    fixtures: COHORT.length,
    periodsPerFixture: 3,
    completedPeriods: cohort.completedPeriods,
    oracleViolations: cohort.oracleViolations,
    rows: cohort.rows.map((r) => ({
      seed: r.seed,
      nation: r.nation,
      position: r.position,
      ok: r.ok,
      periodCompetitions: (r.periods || []).map((p) => p.competition),
      oracleOk: (r.periods || []).every((p) => p.oracleOk !== false),
    })),
  },
  sourceYearForTarget2026: sourceYearForContinentalTarget(2026),
};
writeFileSync(join(outDir, "qa-report.json"), JSON.stringify(report, null, 2));
writeFileSync(join(outDir, "qa-report.md"), `# Fix 09 QA report

- Focused F01–F25 exit: ${focused.exitCode}
- Cohort fixtures: ${COHORT.length} × 3 periods = ${cohort.completedPeriods} completed
- Oracle violations: ${cohort.oracleViolations}
- Source: ${sha}
`);

console.log(JSON.stringify({ focusedExit: focused.exitCode, cohortPeriods: cohort.completedPeriods, oracleViolations: cohort.oracleViolations }, null, 2));
process.exit(focused.exitCode !== 0 || cohort.oracleViolations > 0 ? 1 : 0);
