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
  resolveSeniorScenarioChoice,
  buildPendingSeniorScenario,
  seniorScenarioEventId,
} from "../js/simulation/seniorCareerScenarios.js";
import { allSeniorCategoryProbabilityTables } from "../js/simulation/seniorOutcomeProbability.js";
import { developmentPeriodId } from "../js/simulation/playerDevelopmentModel.js";
import { createStreamRng } from "../js/simulation/rng.js";
import { pickWeightedSeniorResult } from "../js/data/seniorCareerScenarios.js";
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
const probabilityTables = allSeniorCategoryProbabilityTables();
const OUTCOME_SAMPLES = light ? 20000 : 100000;
const sampledRates = {};
for (const [disposition, table] of Object.entries(probabilityTables)) {
  const choice = bank
    .flatMap((s) => s.choices)
    .find((c) => c.disposition === disposition);
  const counts = { positive: 0, neutral: 0, negative: 0 };
  for (let i = 0; i < OUTCOME_SAMPLES; i++) {
    const o = pickWeightedSeniorResult(choice, null, {
      categoryRng: createStreamRng(`cal-out:${disposition}`, `c:${i}`),
      conditionalRng: createStreamRng(`cal-out:${disposition}`, `o:${i}`),
    });
    counts[o.abilityCategory] += 1;
  }
  sampledRates[disposition] = {
    samples: OUTCOME_SAMPLES,
    target: table.senior,
    academyReference: {
      positive: table.academyReference.positive,
      neutral: table.academyReference.neutral,
      negative: table.academyReference.negative,
    },
    observed: {
      positive: counts.positive / OUTCOME_SAMPLES,
      neutral: counts.neutral / OUTCOME_SAMPLES,
      negative: counts.negative / OUTCOME_SAMPLES,
    },
  };
}

const development = {
  trials: 0,
  positive: { n: 0, sumRaw: 0, displayCount: 0 },
  neutral: { n: 0, zeroRaw: 0 },
  negative: { n: 0, sumRaw: 0, tickCount: 0 },
  limitedAnnual: 0,
  duplicates: 0,
};
const DEV_TRIALS = light ? 40 : 120;
for (let i = 0; i < DEV_TRIALS; i++) {
  for (const cat of ["positive", "neutral", "negative"]) {
    const p = makePlayer(5000 + i * 3 + cat.length, i % 6 === 0 ? "GK" : "CM");
    ensureSeniorCareerState(p);
    const sc = bank[i % bank.length];
    const periodId = developmentPeriodId(p);
    const event = {
      scenarioId: sc.id,
      date: "2026-10-01",
      competitionId: "league:cal",
      editionId: `cal:${i}:${cat}`,
      competitionType: "league",
      competitionLabel: "Cal",
      periodId,
    };
    event.eventId = seniorScenarioEventId(p, event);
    p.seniorCareer.life.partner = true;
    const pending = buildPendingSeniorScenario(p, event, {
      forceAfterLoss: true,
      forceStandout: true,
      forceBenched: true,
      rivalMatchup: true,
      travelCongestion: true,
      fixtureCongestion: true,
      onLeave: true,
      returningFromInjury: true,
      nationalCallUp: true,
      firstNationalCamp: true,
      leadershipContext: true,
      pendingRelocation: true,
      recentAbroadMove: true,
      nextFixture: true,
      matchErrorEvidence: true,
      missedChanceEvidence: p.position !== "GK",
      gkReboundEvidence: p.position === "GK",
      substituteAppearances: true,
      unusedSubstitute: true,
      cupEliminated: true,
      strongOpponentUpcoming: true,
      recentAchievement: true,
      highStakesRunIn: true,
      awayTravelReturn: true,
      highWorkload: true,
      returnFromNationalTrip: true,
      poorFormEvidence: true,
      languageAdaptationNeed: true,
      recentClubMove: true,
      activeLoanStart: true,
      activeLoanProgress: true,
      permanentTransferInduction: true,
      loanReturn: true,
      nationalBenchDuty: true,
      contractUncertainty: true,
      experiencedSenior: true,
      rotatedAfterStrong: true,
      clearedFullTraining: true,
    });
    if (pending?.unschedulable) continue;
    const r1 = resolveSeniorScenarioChoice(p, pending, pending.choices[0].id, {
      forceCategory: cat,
    });
    const r2 = resolveSeniorScenarioChoice(p, pending, pending.choices[1]?.id || pending.choices[0].id, {
      forceCategory: cat === "positive" ? "negative" : "positive",
    });
    if (r2.duplicate) development.duplicates += 1;
    if (!r1.ok) continue;
    development.trials += 1;
    const receipt = r1.abilityReceipt;
    const bucket = development[cat];
    bucket.n += 1;
    if (cat === "positive") {
      bucket.sumRaw += receipt.realizedRaw || 0;
      if ((receipt.displayedChange || 0) > 0) bucket.tickCount += 1;
      if (receipt.limitedBy === "annual-cap") development.limitedAnnual += 1;
    } else if (cat === "negative") {
      bucket.sumRaw += receipt.realizedRaw || 0;
      if ((receipt.displayedChange || 0) < 0) bucket.tickCount += 1;
    } else if (Math.abs(receipt.realizedRaw || 0) < 1e-9) {
      bucket.zeroRaw += 1;
    }
  }
}

const missingCategory = bank.reduce((n, sc) => {
  for (const c of sc.choices) {
    for (const cat of ["positive", "neutral", "negative"]) {
      if (!c.results.some((r) => r.abilityCategory === cat)) n += 1;
    }
  }
  return n;
}, 0);

const report = {
  generatedAt: new Date().toISOString(),
  git: gitRevision(),
  config: {
    triggerProbability: SENIOR_CAREER_SCENARIOS.triggerProbability,
    repeatCooldownSeasons: SENIOR_CAREER_SCENARIOS.repeatCooldownSeasons,
    contentVersion: SENIOR_CAREER_SCENARIOS.contentVersion,
    probabilityModelVersion: SENIOR_CAREER_SCENARIOS.probabilityModelVersion,
    bankSize: bank.length,
    choiceCount: bank.reduce((s, sc) => s + sc.choices.length, 0),
    outcomeCount: bank.reduce(
      (s, sc) => s + sc.choices.reduce((a, c) => a + c.results.length, 0),
      0
    ),
    missingCategorySlots: missingCategory,
  },
  probabilityTables,
  sampledRates,
  development,
  triggerTrials: triggerByType,
  schedule,
  integrity: {
    duplicateApplicationsBlocked: development.duplicates,
    missingCategorySlots: missingCategory,
  },
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
md.push("## Outcome category probabilities (academy reference → senior)");
md.push("");
md.push("| Disposition | Academy +/0/− | Senior target +/0/− | Sampled +/0/− |");
md.push("| --- | --- | --- | --- |");
for (const [d, row] of Object.entries(sampledRates)) {
  const a = row.academyReference;
  const t = row.target;
  const o = row.observed;
  md.push(
    `| ${d} | ${(a.positive * 100).toFixed(2)} / ${(a.neutral * 100).toFixed(2)} / ${(a.negative * 100).toFixed(2)} | ${(t.positive * 100).toFixed(2)} / ${(t.neutral * 100).toFixed(2)} / ${(t.negative * 100).toFixed(2)} | ${(o.positive * 100).toFixed(2)} / ${(o.neutral * 100).toFixed(2)} / ${(o.negative * 100).toFixed(2)} |`
  );
}
md.push("");
md.push("## Durable development samples");
md.push("");
md.push(`Forced-category trials: ${development.trials}`);
md.push(
  `Positive mean raw: ${development.positive.n ? (development.positive.sumRaw / development.positive.n).toFixed(4) : "n/a"} (display ticks: ${development.positive.tickCount})`
);
md.push(
  `Negative mean raw: ${development.negative.n ? (development.negative.sumRaw / development.negative.n).toFixed(4) : "n/a"} (display ticks: ${development.negative.tickCount})`
);
md.push(
  `Neutral zero-raw count: ${development.neutral.zeroRaw}/${development.neutral.n}`
);
md.push(`Duplicate second-choice blocks: ${development.duplicates}`);
md.push("");
md.push("## Notes");
md.push("");
md.push("- Trigger streams are independent of match/transfer RNG.");
md.push("- Outcome category rates use the academy-reference 10/5/5 transformation.");
md.push("- Headless seasons use the balanced senior policy (not max-reward).");
md.push("- Failed 30% rolls do not create history entries or UI modals.");
md.push("- Durable attribute changes share the annual learning allowance with season development.");

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
