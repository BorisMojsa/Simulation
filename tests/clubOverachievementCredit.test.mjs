import assert from "node:assert/strict";
import test from "node:test";
import {
  freezeClubExpectedFinish,
  computeOverachievementContribution,
  resolveExpectedFinish,
  rankClubsBySportingStrength,
} from "../js/simulation/clubExpectations.js";
import { evidenceToDevelopmentContext } from "../js/simulation/seasonEvidence.js";
import { computeRecognitionContribution, developSeason } from "../js/simulation/playerDevelopmentModel.js";
import { createStreamRng } from "../js/simulation/rng.js";
import { refreshAbilityCaches } from "../js/simulation/playerAbility.js";

function club(id, name, overall) {
  return {
    clubId: id,
    name,
    displayName: name,
    overall,
    attack: overall,
    midfield: overall,
    defence: overall,
    goalkeeper: overall - 2,
  };
}

test("freeze ranks by sporting strength and ignores later points-table order", () => {
  const clubs = [
    club("a", "Weak", 60),
    club("b", "Strong", 80),
    club("c", "Mid", 70),
  ];
  const frozen = freezeClubExpectedFinish({
    clubs,
    club: clubs[0],
    leagueId: "league:test",
    editionId: "ed-1",
  });
  assert.equal(frozen.status, "frozen");
  assert.equal(frozen.expectedPosition, 3); // weakest
  assert.equal(frozen.source, "preseason-sporting-strength");

  // Final points table order differs from strength — freeze must win.
  const finalTable = [
    { clubId: "a", name: "Weak", strength: 60, points: 70, position: 1 },
    { clubId: "c", name: "Mid", strength: 70, points: 50, position: 2 },
    { clubId: "b", name: "Strong", strength: 80, points: 40, position: 3 },
  ];
  const resolved = resolveExpectedFinish({
    frozen,
    table: finalTable,
    club: clubs[0],
  });
  assert.equal(resolved.expectedPosition, 3);
  assert.equal(resolved.used, "frozen");
});

test("15th→6th regular earns more than expected-6th finish or bench minutes", () => {
  const over = computeOverachievementContribution({
    expectedPosition: 15,
    actualPosition: 6,
    usefulMinutes: 2800,
    reliability: 0.9,
    seasonP: 0.7,
    teamCount: 20,
  });
  const met = computeOverachievementContribution({
    expectedPosition: 6,
    actualPosition: 6,
    usefulMinutes: 2800,
    reliability: 0.9,
    seasonP: 0.7,
    teamCount: 20,
  });
  const bench = computeOverachievementContribution({
    expectedPosition: 15,
    actualPosition: 6,
    usefulMinutes: 400,
    reliability: 0.5,
    seasonP: 0.4,
    teamCount: 20,
  });
  assert.ok(over.contribution > 0.2, `regular overachievement ${over.contribution}`);
  assert.equal(met.contribution, 0);
  assert.ok(bench.contribution < over.contribution * 0.55, `bench ${bench.contribution} vs ${over.contribution}`);
});

test("evidenceToDevelopmentContext forwards overachievement into recognition cap", () => {
  const ctx = evidenceToDevelopmentContext({
    minutes: 2700,
    healthyTrainingFraction: 0.95,
    reliability: 0.85,
    seasonP: 0.65,
    ratedMinutes: 2700,
    reliableSignal: true,
    environmentProxy: 1,
    challengeRelativeToAbility: 1,
    clubFinish: { expectedPosition: 15, position: 6, teams: 20 },
    expectedFinish: 15,
    overachievement: 9,
    trophies: [],
    recognition: [],
  });
  assert.ok(ctx.recognition.overachievementContribution > 0);
  assert.equal(ctx.recognition.overachievement.status, "credited");
  const withAwards = computeRecognitionContribution({
    awards: [{ awardId: "poty", status: "won" }],
    trophies: [{ kind: "league", participationWeight: 0.8 }],
    overachievementContribution: ctx.recognition.overachievementContribution,
  });
  const awardsOnly = computeRecognitionContribution({
    awards: [{ awardId: "poty", status: "won" }],
    trophies: [{ kind: "league", participationWeight: 0.8 }],
  });
  assert.ok(withAwards >= awardsOnly);
  assert.ok(withAwards <= 1.4);
});

test("developSeason applies overachievement receipt once within allowance", () => {
  const player = {
    name: "OA Test",
    careerId: "oa-test-1",
    age: 22,
    position: "CM",
    rating: 72,
    baseOverallRaw: 72,
    attributes: {
      Speed: 70,
      Passing: 74,
      Shooting: 68,
      Defending: 70,
      Physicality: 71,
      Dribbling: 72,
    },
    playerModelVersion: 2,
    development: { modelVersion: 3, latentBudget: 99 },
    seasons: [],
  };
  refreshAbilityCaches(player);
  const before = player.baseOverallRaw;
  const recognition = {
    awards: [],
    trophies: [],
    overachievementContribution: 0.4,
    overachievement: {
      status: "credited",
      expectedPosition: 15,
      actualPosition: 6,
      places: 9,
      contribution: 0.4,
    },
  };
  const a = developSeason(player, {
    elapsedYears: 1,
    usefulMinutes: 2700,
    healthyTrainingFraction: 0.95,
    reliability: 0.9,
    P_long: 0.6,
    environmentMultiplier: 1,
    recognition,
    rng: createStreamRng("oa-test-1", "dev-a"),
    seasonId: "s1",
    periodId: "p1",
  });
  assert.ok(!a.skipped);
  assert.ok(a.overallDelta > 0 || player.baseOverallRaw >= before);
  assert.ok(
    (a.explanations || []).some((e) => /overachievement/i.test(e)),
    JSON.stringify(a.explanations)
  );
  // Exact-once: second call with alreadyApplied / same period ledger skips or adds no double credit path
  const b = developSeason(player, {
    elapsedYears: 1,
    usefulMinutes: 2700,
    healthyTrainingFraction: 0.95,
    reliability: 0.9,
    P_long: 0.6,
    environmentMultiplier: 1,
    recognition,
    rng: createStreamRng("oa-test-1", "dev-b"),
    seasonId: "s1",
    periodId: "p1",
    alreadyAppliedLearningGain: 99,
  });
  assert.ok(b.skipped || b.overallDelta === 0 || b.limitedBy);
});

test("rankClubsBySportingStrength is stable for equal strengths via clubId", () => {
  const clubs = [club("z", "Zulu", 70), club("a", "Alpha", 70), club("m", "Mid", 70)];
  const ranked = rankClubsBySportingStrength(clubs);
  assert.equal(ranked.length, 3);
  assert.deepEqual(
    ranked.map((r) => r.clubId),
    ["a", "m", "z"]
  );
});
