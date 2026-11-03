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
import {
  createWorldState,
  setWorldState,
  serializeWorldState,
} from "../js/simulation/worldState.js";
import { reseedCareerRng, getSimRng } from "../js/simulation/rng.js";
import { createPlayerIdentity } from "../js/simulation/playerDevelopment.js";
import { ensurePlayerModel } from "../js/simulation/playerModelMigration.js";
import { refreshAbilityCaches } from "../js/simulation/playerAbility.js";
import { ensureContractAuthority } from "../js/simulation/contractLifecycle.js";
import { ensureTransferSave } from "../js/simulation/transferMigration.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import {
  getClubTargetDecision,
  getDomesticEditionRecord,
  sourceYearForContinentalTarget,
  validateStandingTable,
} from "../js/simulation/earnedQualification.js";
import { continentalCompetitionForStanding } from "../js/data/competitions/qualification.js";

const __filename = fileURLToPath(import.meta.url);
const root = join(dirname(__filename), "..");
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

export function oracleCompetition(nation, leagueId, position) {
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

/**
 * Independent earned-entry oracle. Missing decision/table/participant evidence fails.
 * Observed production rank/competition is compared to rebuilt source evidence — never trusted as expected.
 */
export function validateEarnedPeriodOracle({
  league,
  clubId,
  sourceYear,
  targetYear,
  decision = null,
  edition = null,
  participants = null,
  standingTable = null,
  europeCompetition = null,
} = {}) {
  if (!league || !clubId || !Number.isFinite(Number(sourceYear)) || !Number.isFinite(Number(targetYear))) {
    return { ok: false, reason: "missing-identity" };
  }
  if (Number(targetYear) !== Number(sourceYear) + 1) {
    return { ok: false, reason: "wrong-source-target-pair" };
  }
  const table = standingTable || edition?.table || null;
  if (!table?.length) return { ok: false, reason: "missing-source-table" };
  if (!edition?.completed && edition?.status !== "bootstrap") {
    return { ok: false, reason: "source-edition-incomplete" };
  }
  const validation = validateStandingTable(table, league, {
    requireComplete: true,
    status: edition?.status || "complete",
    completed: true,
    sourceYear,
  });
  if (!validation.ok) return { ok: false, reason: `invalid-table:${validation.reason}` };

  const row = table.find((r) => r.clubId === clubId);
  if (!row) return { ok: false, reason: "club-absent-from-source-table" };
  const rebuiltCompetition =
    continentalCompetitionForStanding({ position: row.position, qualification: row.qualification }, league) ||
    oracleCompetition(league.nation, league.leagueId, row.position);

  if (!decision) return { ok: false, reason: "missing-decision" };
  if (Number(decision.position) !== Number(row.position)) {
    return { ok: false, reason: "decision-rank-mismatch", expected: row.position, observed: decision.position };
  }
  if ((decision.competition || null) !== (rebuiltCompetition || null)) {
    return {
      ok: false,
      reason: "decision-competition-mismatch",
      expected: rebuiltCompetition,
      observed: decision.competition,
    };
  }
  const slotExpected = oracleCompetition(league.nation, league.leagueId, row.position);
  if (slotExpected !== (decision.competition || null)) {
    return {
      ok: false,
      reason: "slot-oracle-mismatch",
      expected: slotExpected,
      observed: decision.competition,
    };
  }
  if (decision.status === "qualified" || decision.competition) {
    const participantList = Array.isArray(participants) ? participants : null;
    const inParticipants =
      participantList &&
      participantList.length > 0 &&
      participantList.some(
        (p) =>
          (p.clubId || p) === clubId &&
          (!p.competition || p.competition === decision.competition)
      );
    const campaignMatches = europeCompetition && europeCompetition === decision.competition;
    if (!inParticipants && !campaignMatches) {
      return { ok: false, reason: "missing-campaign-or-participant-evidence" };
    }
  } else if (Array.isArray(participants) && participants.length) {
    const wronglyPresent = participants.some(
      (p) => (p.clubId || p) === clubId && p.competition && p.competition !== decision.competition
    );
    if (wronglyPresent) return { ok: false, reason: "participant-contradiction-dnq" };
  }
  return {
    ok: true,
    rebuiltCompetition,
    sourcePosition: row.position,
    sourceYear,
    targetYear,
  };
}

function runFocused(outDir) {
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

function runCohort(outDir) {
  const rows = [];
  let oracleViolations = 0;
  let completedPeriods = 0;
  mkdirSync(join(outDir, "cohort"), { recursive: true });
  mkdirSync(join(outDir, "cohort-snapshots"), { recursive: true });

  for (const spec of COHORT) {
    const built = makeCareer(spec.seed, spec.nation, spec.position);
    if (!built) {
      rows.push({ ...spec, ok: false, reason: "league-missing" });
      oracleViolations += 1;
      continue;
    }
    const { player, league, world, club } = built;
    const initialSnap = {
      rngSeed: world.rngSeed,
      rngState: getSimRng().seed(),
      playerClubId: club.clubId,
      leagueId: league.leagueId,
      world: serializeWorldState(world),
    };
    writeFileSync(
      join(outDir, "cohort-snapshots", `fixture-${spec.seed}-initial.json`),
      JSON.stringify(initialSnap)
    );
    const periods = [];
    let fixtureOk = true;
    for (let i = 0; i < 3; i++) {
      const beforeSeed = getSimRng().seed();
      const seasonsBefore = player.seasons.length;
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
      if (player.seasons.length !== seasonsBefore + 1) {
        oracleViolations += 1;
        fixtureOk = false;
        periods.push({
          periodIndex: i,
          ok: false,
          reason: "period-not-completed",
          seasonsBefore,
          seasonsAfter: player.seasons.length,
        });
        continue;
      }
      const season = player.seasons[player.seasons.length - 1];
      const sourceYear = (player.startYear || 2026) + Math.max(0, player.seasons.length - 1);
      const targetYear = sourceYear + 1;
      const clubId = player.playingClubId || club.clubId;
      const edition = getDomesticEditionRecord(world, season?.leagueId || league.leagueId, sourceYear);
      const decisionWrap = getClubTargetDecision(world, clubId, targetYear);
      const decision = decisionWrap?.entry || null;
      const europe = season?.europeanCampaign || null;
      const participants = europe?.field || europe?.participants || europe?.lifecycle?.field || [];
      const oracle = validateEarnedPeriodOracle({
        league: LEAGUES.find((l) => l.leagueId === (season?.leagueId || league.leagueId)) || league,
        clubId,
        sourceYear,
        targetYear,
        decision,
        edition,
        participants: Array.isArray(participants) ? participants : null,
        standingTable: edition?.table || season?.standing?.table || null,
        europeCompetition: europe?.competition || null,
      });
      if (!oracle.ok) {
        oracleViolations += 1;
        fixtureOk = false;
      } else {
        completedPeriods += 1;
      }
      periods.push({
        periodIndex: i,
        sourceYear,
        targetYear,
        playingClubId: clubId,
        leagueId: season?.leagueId || league.leagueId,
        tableSize: edition?.table?.length || season?.standing?.table?.length || null,
        sourceRow: edition?.table?.find((r) => r.clubId === clubId) || null,
        position: decision?.position ?? null,
        competition: decision?.competition ?? null,
        provenance: decision?.provenance || edition?.provenance || null,
        europeCompetition: europe?.competition || null,
        europeQualified: europe?.qualified !== false && !europe?.showcase,
        participants: (Array.isArray(participants) ? participants : []).map((p) => p.clubId || p),
        matchEvidenceIds: edition?.matchEvidenceIds?.length || 0,
        oracle,
        oracleOk: oracle.ok,
        rngBefore: beforeSeed,
        rngAfter: getSimRng().seed(),
      });
    }
    const finalSnap = {
      rngSeed: world.rngSeed,
      rngState: getSimRng().seed(),
      playerClubId: player.playingClubId,
      seasons: player.seasons.length,
      world: serializeWorldState(world),
    };
    writeFileSync(
      join(outDir, "cohort-snapshots", `fixture-${spec.seed}-final.json`),
      JSON.stringify(finalSnap)
    );
    const record = {
      ...spec,
      ok: fixtureOk,
      initialSnap: {
        rngSeed: initialSnap.rngSeed,
        rngState: initialSnap.rngState,
        playerClubId: initialSnap.playerClubId,
        leagueId: initialSnap.leagueId,
      },
      finalRng: getSimRng().seed(),
      periods,
      worldQualificationKeys: [...(world.qualification?.keys?.() || [])].filter((k) =>
        String(k).startsWith("domestic:")
      ).length,
    };
    rows.push(record);
    writeFileSync(join(outDir, "cohort", `fixture-${spec.seed}.json`), JSON.stringify(record, null, 2));
  }
  return { rows, oracleViolations, completedPeriods };
}

function runCorruptionControls() {
  const league = LEAGUES.find((l) => l.leagueId === "league:england-premier-league");
  const cases = [
    validateEarnedPeriodOracle({
      league,
      clubId: "club:england:arsenal",
      sourceYear: 2025,
      targetYear: 2026,
      decision: null,
      edition: null,
      participants: [],
    }),
    validateEarnedPeriodOracle({
      league,
      clubId: "club:england:arsenal",
      sourceYear: 2025,
      targetYear: 2026,
      decision: { position: 1, competition: "Champions League", status: "qualified" },
      edition: { completed: true, status: "complete", table: [] },
      participants: [],
    }),
  ];
  return cases.every((c) => c.ok === false);
}

async function main() {
  const outDir = process.env.FIX09_OUT || join(root, "qa/fix09-runs/final");
  mkdirSync(outDir, { recursive: true });
  const started = new Date().toISOString();
  const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
  const focused = runFocused(outDir);
  const cohort = runCohort(outDir);
  const corruptionOk = runCorruptionControls();
  const requiredPeriods = COHORT.length * 3;
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
      requiredPeriods,
      completedPeriods: cohort.completedPeriods,
      oracleViolations: cohort.oracleViolations,
      rows: cohort.rows.map((r) => ({
        seed: r.seed,
        nation: r.nation,
        position: r.position,
        ok: r.ok,
        periodCompetitions: (r.periods || []).map((p) => p.competition),
        oracleOk: (r.periods || []).every((p) => p.oracleOk === true),
      })),
    },
    corruptionControlsPass: corruptionOk,
    sourceYearForTarget2026: sourceYearForContinentalTarget(2026),
  };
  writeFileSync(join(outDir, "qa-report.json"), JSON.stringify(report, null, 2));
  writeFileSync(
    join(outDir, "qa-report.md"),
    `# Fix 09 QA report

- Focused F01–F25 exit: ${focused.exitCode}
- Cohort completed periods: ${cohort.completedPeriods} / ${requiredPeriods}
- Oracle violations: ${cohort.oracleViolations}
- Corruption controls: ${corruptionOk ? "PASS" : "FAIL"}
- Source: ${sha}
`
  );

  console.log(
    JSON.stringify(
      {
        focusedExit: focused.exitCode,
        cohortPeriods: cohort.completedPeriods,
        requiredPeriods,
        oracleViolations: cohort.oracleViolations,
        corruptionControlsPass: corruptionOk,
      },
      null,
      2
    )
  );
  const fail =
    focused.exitCode !== 0 ||
    cohort.oracleViolations > 0 ||
    cohort.completedPeriods < requiredPeriods ||
    !corruptionOk;
  process.exit(fail ? 1 : 0);
}

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
