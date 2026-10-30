#!/usr/bin/env node
/**
 * Fix 08 audit/export runner — appendix scope probe + focused summary.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildSeasonEvidence } from "../js/simulation/seasonEvidence.js";
import { createEmptyLedger, recordMatchObservation } from "../js/simulation/playerSeasonLedger.js";
import { createStreamRng } from "../js/simulation/rng.js";
import { evaluateSeasonAwards } from "../js/simulation/individualAwards.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = process.env.FIX08_OUT || join(root, "qa/fix08-runs/final");
mkdirSync(outDir, { recursive: true });

function runScope({ cupApps = 0, cupGoals = 0 } = {}) {
  const player = {
    name: "Scope probe",
    careerId: "scope-probe",
    position: "ST",
    rating: 70,
    age: 22,
    club: { name: "A", clubId: "club:a" },
    seasons: [],
  };
  const ledger = createEmptyLedger("s1");
  for (let i = 0; i < 30; i++) {
    recordMatchObservation(ledger, {
      matchId: `l${i}`,
      competitionType: "league",
      competitionId: "league:a",
      editionId: "2026",
      minutes: 90,
      started: true,
      goals: i < 10 ? 1 : 0,
      assists: i < 6 ? 1 : 0,
      rating: 6.3,
      expectedRating: 6.5,
    });
  }
  for (let i = 0; i < cupApps; i++) {
    recordMatchObservation(ledger, {
      matchId: `c${i}`,
      competitionType: "cup",
      competitionId: "cup:a",
      editionId: "2026",
      minutes: 90,
      started: true,
      goals: Math.floor(cupGoals / cupApps) + (i < cupGoals % cupApps ? 1 : 0),
      rating: 9.8,
      expectedRating: 6.5,
    });
  }
  const standing = { position: 3, played: 38, points: 70, goalsFor: 70, goalsAgainst: 40 };
  const evidence = buildSeasonEvidence(player, {
    seasonId: "s1",
    ledger,
    standing,
    seasonStartAge: 22,
    competitionEditions: [
      { scope: "league", competitionId: "league:a", editionId: "2026" },
      { scope: "cup", competitionId: "cup:a", editionId: "2026" },
    ],
  });
  const rivals = Array.from({ length: 40 }, (_, i) => {
    const group = ["GK", "DEF", "MID", "FWD"][i % 4];
    return {
      id: `r${i}`,
      name: `Rival${i}`,
      group,
      position: { GK: "GK", DEF: "CB", MID: "CM", FWD: "ST" }[group],
      minutes: 3000,
      matches: 34,
      age: 22,
      goals: group === "FWD" ? 10 + (i % 7) : group === "MID" ? 4 + (i % 3) : 0,
      assists: 4 + (i % 4),
      cleanSheets: group === "GK" || group === "DEF" ? 10 + (i % 4) : 0,
      rating: 6.5 + (i % 5) * 0.06,
      teamPpg: 70 / 38,
      priorSeniorMinutes: 0,
    };
  });
  const result = evaluateSeasonAwards({
    player,
    evidence,
    standing,
    seasonId: "s1",
    seasonStartAge: 22,
    options: { competitionKey: "league:a" },
    rivals: { rivals, possibleMinutes: 3420 },
    rng: createStreamRng("scope", "awards"),
  });
  return {
    leagueLine: evidence.byEdition["league:a::2026"],
    combinedRating: evidence.minutesWeightedRating,
    leagueAwards: result.records.filter((r) => r.competitionScope === "league"),
  };
}

const appendix = {
  generatedAt: new Date().toISOString(),
  head: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(),
  leagueOnly: runScope(),
  cupRatingOnly: runScope({ cupApps: 6, cupGoals: 0 }),
  cupOutput: runScope({ cupApps: 6, cupGoals: 30 }),
};

const key = (r) =>
  JSON.stringify({
    goals: r.leagueLine.goals,
    assists: r.leagueLine.assists,
    minutes: r.leagueLine.minutes,
    rating: r.leagueLine.rating,
    awards: r.leagueAwards.map((a) => `${a.awardId}:${a.status}:${a.rank}`).sort(),
  });
appendix.leagueCandidateEqual =
  key(appendix.leagueOnly) === key(appendix.cupRatingOnly) &&
  key(appendix.leagueOnly) === key(appendix.cupOutput);

writeFileSync(join(outDir, "appendix-a-scope.json"), JSON.stringify(appendix, null, 2));

const focused = spawnSync(process.execPath, ["--test", "tests/userRivalPerformanceAwards.test.mjs"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});
writeFileSync(join(outDir, "focused-tests.txt"), `${focused.stdout}\n${focused.stderr}`);
const summary = {
  generatedAt: appendix.generatedAt,
  head: appendix.head,
  appendixEqual: appendix.leagueCandidateEqual,
  focusedExit: focused.status,
  outDir,
};
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exitCode = focused.status === 0 && appendix.leagueCandidateEqual ? 0 : 1;
