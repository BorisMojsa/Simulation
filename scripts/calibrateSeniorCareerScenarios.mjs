/**
 * Seeded calibration for senior career scenario triggers and scheduling.
 *
 * Usage:
 *   node scripts/calibrateSeniorCareerScenarios.mjs
 *   node scripts/calibrateSeniorCareerScenarios.mjs --light
 *
 * Writes reports/senior-career-scenarios-calibration.json and .md
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { SENIOR_CAREER_SCENARIOS } from "../js/config/seniorCareerScenarioConfig.js";
import { allSeniorScenarios } from "../js/data/seniorCareerScenarios.js";
import {
  runTriggerCalibration,
  planSeniorScenarioEvents,
  ensureSeniorCareerState,
  listEnteredCompetitionEditions,
} from "../js/simulation/seniorCareerScenarios.js";
import { LEAGUES, LEAGUE_LOOKUP, LEAGUE_BY_ID } from "../js/data/leagues.js";
import { createPlayerIdentity } from "../js/simulation/playerDevelopment.js";
import { ensurePlayerModel } from "../js/simulation/playerModelMigration.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import { createWorldState, setWorldState } from "../js/simulation/worldState.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import { reseedCareerRng } from "../js/simulation/rng.js";

const light = process.argv.includes("--light");
const TRIGGER_TRIALS = light ? 2000 : 10000;
const SEASON_TRIALS = light ? 200 : 800;

function gitRevision() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function makePlayer(seed, position = "CM") {
  resetClubFinanceLedgers();
  reseedCareerRng(seed);
  setWorldState(createWorldState({ startYear: 2026 }));
  const league = LEAGUE_BY_ID.get("league:england-premier-league") || LEAGUES[0];
  const club = league.clubs[seed % league.clubs.length];
  const p = createPlayerIdentity({
    name: `Cal ${seed}`,
    nationality: "England",
    position,
    age: 20,
  });
  p.startYear = 2026;
  p.rating = 68;
  p.potential = 84;
  p.attributes =
    position === "GK"
      ? { Diving: 68, Handling: 67, Kicking: 64, Reflexes: 70, Speed: 55, Positioning: 66 }
      : {
          Speed: 68,
          Passing: 70,
          Shooting: 64,
          Defending: 62,
          Physicality: 66,
          Dribbling: 69,
        };
  ensurePlayerModel(p);
  p.club = {
    ...club,
    league: league.name,
    leagueDisplay: league.displayName,
    leagueId: league.leagueId,
    nation: league.nation,
    isAcademy: false,
    parentClub: null,
  };
  p.employmentClubId = club.clubId;
  p.playingClubId = club.clubId;
  p.contractYears = 4;
  p.contractEndSeason = 4;
  p.weeklyWage = 10000;
  p.careerId = `cal-senior-${seed}`;
  return p;
}

const triggerByType = {};
for (const type of ["league", "cup", "continental", "international"]) {
  triggerByType[type] = runTriggerCalibration({
    trials: TRIGGER_TRIALS,
    competitionType: type,
    seed: 20261013,
  });
}

const schedule = {
  seasons: SEASON_TRIALS,
  drawnEditions: 0,
  eligibleEditions: 0,
  shownScenes: 0,
  unschedulable: 0,
  rollMiss: 0,
  scenarioCounts: {},
  byCompetitionType: {},
};

for (let i = 0; i < SEASON_TRIALS; i++) {
  const p = makePlayer(1000 + i, i % 5 === 0 ? "GK" : "CM");
  ensureSeniorCareerState(p);
  const league = LEAGUE_LOOKUP.get(p.club.league) || LEAGUES[0];
  // Lightweight plan probe (does not need full season for counts)
  const europePlan =
    i % 3 === 0
      ? { qualified: true, competition: "Champions League", showcase: false }
      : { qualified: false, showcase: true };
  const intlProbe =
    i % 4 === 0
      ? { calledUp: true, primary: { name: "EURO", editionYear: 2028 } }
      : { calledUp: false };
  const planned = planSeniorScenarioEvents(p, {
    league,
    seasonStartYear: 2026,
    europePlan,
    intlProbe,
    cupRoundDates: ["2026-09-22", "2026-10-20", "2026-11-17"],
    datedLeague: Array.from({ length: 20 }, (_, k) => ({
      date: `2026-08-${String(15 + (k % 14)).padStart(2, "0")}`,
    })),
    europePlayerSlots: europePlan.qualified ? [{ date: "2026-09-16" }] : [],
    intlSlots: intlProbe.calledUp ? [{ date: "2028-06-14" }] : [],
  });
  schedule.eligibleEditions += planned.editions.length;
  for (const row of planned.planLog) {
    const bucket = (schedule.byCompetitionType[row.type] ||= {
      editions: 0,
      drawn: 0,
      shown: 0,
      unschedulable: 0,
      miss: 0,
    });
    bucket.editions += 1;
    if (row.drawn) {
      schedule.drawnEditions += 1;
      bucket.drawn += 1;
      if (row.scheduled) {
        schedule.shownScenes += 1;
        bucket.shown += 1;
        schedule.scenarioCounts[row.scenarioId] = (schedule.scenarioCounts[row.scenarioId] || 0) + 1;
      } else {
        schedule.unschedulable += 1;
        bucket.unschedulable += 1;
      }
    } else {
      schedule.rollMiss += 1;
      bucket.miss += 1;
    }
  }

  // Full season smoke every 50th trial
  if (i % 50 === 0) {
    simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions: false,
      autoDecisionPolicy: "stay",
    });
  }
}

const bank = allSeniorScenarios();
const report = {
  generatedAt: new Date().toISOString(),
  git: gitRevision(),
  config: {
    triggerProbability: SENIOR_CAREER_SCENARIOS.triggerProbability,
    repeatCooldownSeasons: SENIOR_CAREER_SCENARIOS.repeatCooldownSeasons,
    bankSize: bank.length,
  },
  triggerTrials: triggerByType,
  schedule,
};

mkdirSync(new URL("../reports", import.meta.url), { recursive: true });
const jsonPath = new URL("../reports/senior-career-scenarios-calibration.json", import.meta.url);
writeFileSync(jsonPath, JSON.stringify(report, null, 2));

const md = [];
md.push("# Senior career scenarios — calibration");
md.push("");
md.push(`Generated: ${report.generatedAt}`);
md.push(`Git: ${report.git || "n/a"}`);
md.push(`Bank size: ${bank.length}`);
md.push(`Configured trigger probability: ${SENIOR_CAREER_SCENARIOS.triggerProbability}`);
md.push("");
md.push("## Trigger trials (independent streams)");
md.push("");
md.push("| Competition type | Trials | Drawn | Rate |");
md.push("| --- | ---: | ---: | ---: |");
for (const [type, row] of Object.entries(triggerByType)) {
  md.push(`| ${type} | ${row.trials} | ${row.drawn} | ${(row.rate * 100).toFixed(2)}% |`);
}
md.push("");
md.push("## Season plan probes");
md.push("");
md.push(`Seasons: ${schedule.seasons}`);
md.push(`Eligible editions: ${schedule.eligibleEditions}`);
md.push(`Drawn: ${schedule.drawnEditions}`);
md.push(`Shown (scheduled): ${schedule.shownScenes}`);
md.push(`Unschedulable after draw: ${schedule.unschedulable}`);
md.push(`Roll misses: ${schedule.rollMiss}`);
md.push("");
md.push("### By competition type");
md.push("");
md.push("| Type | Editions | Drawn | Shown | Unschedulable | Miss |");
md.push("| --- | ---: | ---: | ---: | ---: | ---: |");
for (const [type, row] of Object.entries(schedule.byCompetitionType)) {
  md.push(
    `| ${type} | ${row.editions} | ${row.drawn} | ${row.shown} | ${row.unschedulable} | ${row.miss} |`
  );
}
md.push("");
md.push("### Scenario frequency (scheduled)");
md.push("");
const ranked = Object.entries(schedule.scenarioCounts).sort((a, b) => b[1] - a[1]);
md.push("| Scenario | Count |");
md.push("| --- | ---: |");
for (const [id, n] of ranked) {
  md.push(`| ${id} | ${n} |`);
}
md.push("");
md.push("## Notes");
md.push("");
md.push("- Trigger streams are independent of match/transfer RNG.");
md.push("- Headless seasons use the balanced senior policy (not max-reward).");
md.push("- Failed 30% rolls do not create history entries or UI modals.");

const mdPath = new URL("../reports/senior-career-scenarios-calibration.md", import.meta.url);
writeFileSync(mdPath, md.join("\n"));
console.log(`Wrote ${jsonPath.pathname}`);
console.log(`Wrote ${mdPath.pathname}`);
console.log(
  `Triggers: ${Object.entries(triggerByType)
    .map(([t, r]) => `${t}=${(r.rate * 100).toFixed(1)}%`)
    .join(" ")}`
);
console.log(
  `Schedule: drawn=${schedule.drawnEditions} shown=${schedule.shownScenes} unschedulable=${schedule.unschedulable}`
);
