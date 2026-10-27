/**
 * Senior career durable development, probability shift, and event idempotency.
 * Run: node tests/seniorCareerDevelopment.test.mjs
 */
import assert from "node:assert/strict";
import {
  academyReferenceProfile,
  allSeniorCategoryProbabilityTables,
  transformAcademyReferenceToSenior,
} from "../js/simulation/seniorOutcomeProbability.js";
import { OUTCOME_WEIGHT_BY_DISPOSITION } from "../js/config/academyOpeningConfig.js";
import {
  allSeniorScenarios,
  getSeniorScenarioById,
  normalizeSeniorScenario,
  pickWeightedSeniorResult,
} from "../js/data/seniorCareerScenarios.js";
import {
  buildPendingSeniorScenario,
  ensureSeniorCareerState,
  resolveSeniorScenarioChoice,
  seniorScenarioEventId,
} from "../js/simulation/seniorCareerScenarios.js";
import {
  applyScenarioAbilityChange,
  developmentPeriodId,
  ensureLearningPeriodLedger,
  periodPositiveLearningUsed,
} from "../js/simulation/playerDevelopmentModel.js";
import { calculateOverall, refreshAbilityCaches } from "../js/simulation/playerAbility.js";
import { createPlayerIdentity } from "../js/simulation/playerDevelopment.js";
import { ensurePlayerModel } from "../js/simulation/playerModelMigration.js";
import { createStreamRng, reseedCareerRng } from "../js/simulation/rng.js";
import { abilityDisplayChange } from "../js/ui/abilityFormatting.js";
import { createWorldState, setWorldState } from "../js/simulation/worldState.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import { LEAGUES, LEAGUE_BY_ID } from "../js/data/leagues.js";
import { DEVELOPMENT_CAPS } from "../js/config/playerDevelopmentConfig.js";

function test(name, fn) {
  try {
    fn();
    console.log(`OK  ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

function makePlayer({ seed = 42, position = "CM", rating = 68 } = {}) {
  resetClubFinanceLedgers();
  reseedCareerRng(seed);
  setWorldState(createWorldState({ startYear: 2026 }));
  const league = LEAGUE_BY_ID.get("league:england-premier-league") || LEAGUES[0];
  const club = league.clubs[Math.min(4, league.clubs.length - 1)];
  const p = createPlayerIdentity({
    name: "Dev Scene",
    nationality: "England",
    position,
    age: 21,
  });
  p.startYear = 2026;
  p.rating = rating;
  p.potential = 86;
  if (position === "GK") {
    p.attributes = {
      Diving: rating,
      Handling: rating,
      Kicking: rating,
      Reflexes: rating,
      Speed: Math.max(40, rating - 12),
      Positioning: rating,
    };
  } else {
    p.attributes = {
      Speed: rating,
      Passing: rating,
      Shooting: rating,
      Defending: rating,
      Physicality: rating,
      Dribbling: rating,
    };
  }
  ensurePlayerModel(p);
  refreshAbilityCaches(p);
  p.club = {
    ...club,
    league: league.name,
    leagueDisplay: league.displayName,
    leagueId: league.leagueId,
    nation: league.nation,
    isAcademy: false,
  };
  p.employmentClubId = club.clubId;
  p.playingClubId = club.clubId;
  p.careerId = `senior-dev-${seed}-${position}`;
  ensureSeniorCareerState(p);
  return p;
}

function richOpts(player, extras = {}) {
  return {
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
    missedChanceEvidence: player.position !== "GK",
    gkReboundEvidence: player.position === "GK",
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
    ...extras,
  };
}

function pendingFor(player, scenarioId, extras = {}) {
  const periodId = developmentPeriodId(player);
  const event = {
    kind: "senior_scenario",
    date: "2026-10-15",
    competitionId: "league:test",
    editionId: `test:${scenarioId}:2026`,
    competitionType: "league",
    competitionLabel: "Test League",
    scenarioId,
    periodId,
    rollKey: "roll",
  };
  event.eventId = seniorScenarioEventId(player, event);
  player.seniorCareer.life.partner = true;
  const pending = buildPendingSeniorScenario(player, event, richOpts(player, extras));
  assert.equal(pending.unschedulable, false, `${scenarioId} should be schedulable`);
  return pending;
}

test("reference 65/20/15 shifts to 55/25/20 exactly", () => {
  const senior = transformAcademyReferenceToSenior({
    positive: 0.65,
    neutral: 0.2,
    negative: 0.15,
  });
  assert.ok(Math.abs(senior.positive - 0.55) < 1e-12);
  assert.ok(Math.abs(senior.neutral - 0.25) < 1e-12);
  assert.ok(Math.abs(senior.negative - 0.2) < 1e-12);
});

test("four disposition senior targets match academy-derived table", () => {
  const expected = {
    thoughtful: [0.598427, 0.253515, 0.148057],
    balanced: [0.576728, 0.205794, 0.217478],
    ambitious: [0.465022, 0.184529, 0.350448],
    reckless: [0.208, 0.142, 0.65],
  };
  const tables = allSeniorCategoryProbabilityTables();
  for (const [d, [ep, en, eg]] of Object.entries(expected)) {
    const academy = academyReferenceProfile(d, OUTCOME_WEIGHT_BY_DISPOSITION);
    const senior = transformAcademyReferenceToSenior(academy);
    assert.ok(Math.abs(senior.positive - tables[d].senior.positive) < 1e-12);
    assert.ok(Math.abs(senior.positive - ep) < 5e-4, `${d} pos`);
    assert.ok(Math.abs(senior.neutral - en) < 5e-4, `${d} neu`);
    assert.ok(Math.abs(senior.negative - eg) < 5e-4, `${d} neg`);
  }
});

test("bank has 80 scenes, 3 choices, all three outcome classes", () => {
  const bank = allSeniorScenarios();
  assert.ok(bank.length >= 80, `got ${bank.length}`);
  const ids = new Set(bank.map((s) => s.id));
  assert.equal(ids.size, bank.length);
  for (const id of [
    "press-after-defeat",
    "captain-pressure",
    "video-pattern-review",
    "experienced-player-role-evolution",
  ]) {
    assert.ok(getSeniorScenarioById(id), id);
  }
  for (const sc of bank) {
    assert.equal(sc.choices.length, 3, sc.id);
    for (const c of sc.choices) {
      for (const cat of ["positive", "neutral", "negative"]) {
        assert.ok(
          c.results.some((r) => r.abilityCategory === cat),
          `${c.id} missing ${cat}`
        );
      }
      assert.ok(c.disposition);
    }
  }
});

test("normalize is idempotent (no second 10-point shift)", () => {
  const raw = allSeniorScenarios()[0];
  const a = normalizeSeniorScenario(raw);
  const b = normalizeSeniorScenario(a);
  assert.equal(a.id, b.id);
  assert.deepEqual(a.choices[0].seniorCategoryProbabilities, b.choices[0].seniorCategoryProbabilities);
  assert.equal(a.choices[0].results[0].id, b.choices[0].results[0].id);
});

test("category probability unchanged when adding another positive outcome", () => {
  const sc = structuredClone(getSeniorScenarioById("video-pattern-review"));
  const choice = sc.choices[0];
  const before = normalizeSeniorScenario(sc).choices[0].seniorCategoryProbabilities;
  choice.results.push({
    id: "extra-pos",
    abilityCategory: "positive",
    delta: 1,
    conditionalWeight: 5,
    focus: "role-learning",
    text: "Extra positive branch.",
    effects: ["morale"],
  });
  const after = normalizeSeniorScenario(sc).choices[0].seniorCategoryProbabilities;
  assert.deepEqual(before, after);
});

test("positive/neutral/negative alter durable base OVR correctly", () => {
  for (const cat of ["positive", "neutral", "negative"]) {
    const p = makePlayer({ seed: 100 + cat.length, position: "CM" });
    const beforeAttrs = { ...p.attributes };
    const beforeRaw = calculateOverall(p.attributes, p.position).raw;
    const pending = pendingFor(p, "press-after-defeat");
    const choiceId = pending.choices[0].id;
    const result = resolveSeniorScenarioChoice(p, pending, choiceId, { forceCategory: cat });
    assert.equal(result.ok, true, cat);
    refreshAbilityCaches(p);
    const afterRaw = calculateOverall(p.attributes, p.position).raw;
    if (cat === "positive") {
      assert.ok(afterRaw > beforeRaw + 1e-9, `pos ${beforeRaw} -> ${afterRaw}`);
      assert.ok(Object.keys(p.attributes).some((k) => p.attributes[k] !== beforeAttrs[k]));
    } else if (cat === "negative") {
      assert.ok(afterRaw < beforeRaw - 1e-9, `neg ${beforeRaw} -> ${afterRaw}`);
    } else {
      assert.ok(Math.abs(afterRaw - beforeRaw) < 1e-9);
      for (const k of Object.keys(beforeAttrs)) {
        assert.equal(p.attributes[k], beforeAttrs[k]);
      }
    }
    assert.equal(p.rating, Math.round(afterRaw));
  }
});

test("event idempotency across different choice clones", () => {
  const p = makePlayer({ seed: 77 });
  const pendingA = pendingFor(p, "veteran-mentor");
  const pendingB = structuredClone(pendingA);
  const c1 = pendingA.choices[0].id;
  const c2 = pendingA.choices[1].id;
  const r1 = resolveSeniorScenarioChoice(p, pendingA, c1, { forceCategory: "positive" });
  assert.equal(r1.ok, true);
  assert.equal(r1.duplicate, false);
  const rawAfterFirst = p.baseOverallRaw;
  const r2 = resolveSeniorScenarioChoice(p, pendingB, c2, { forceCategory: "negative" });
  assert.equal(r2.ok, true);
  assert.equal(r2.duplicate, true);
  assert.equal(r2.outcome.id, r1.outcome.id);
  assert.ok(Math.abs(p.baseOverallRaw - rawAfterFirst) < 1e-9);
  assert.equal(p.seniorCareer.history.length, 1);
});

test("annual cap limits scene positive charge", () => {
  const p = makePlayer({ seed: 12, rating: 70 });
  const periodId = developmentPeriodId(p);
  const ledger = ensureLearningPeriodLedger(p, periodId);
  const room = 0.2;
  const preUsed = DEVELOPMENT_CAPS.annualLearningCap - room;
  ledger.positiveUsed = preUsed;
  const before = p.baseOverallRaw;
  const result = applyScenarioAbilityChange(p, {
    eventId: "cap-test",
    periodId,
    requestedRaw: 0.72,
    focus: "role-learning",
    rng: createStreamRng("cap", "alloc"),
  });
  assert.ok(result.realizedRaw <= room + 1e-6);
  assert.equal(result.limitedBy, "annual-cap");
  assert.ok(p.baseOverallRaw <= before + room + 1e-6);
  assert.ok(Math.abs(periodPositiveLearningUsed(p, periodId) - (preUsed + result.positiveBudgetCharged)) < 1e-6);
});

test("negative after positive does not refund allowance", () => {
  const p = makePlayer({ seed: 13, rating: 70 });
  const periodId = developmentPeriodId(p);
  applyScenarioAbilityChange(p, {
    eventId: "pos1",
    periodId,
    requestedRaw: 0.72,
    rng: createStreamRng("a", "1"),
  });
  const used = periodPositiveLearningUsed(p, periodId);
  applyScenarioAbilityChange(p, {
    eventId: "neg1",
    periodId,
    requestedRaw: -0.35,
    rng: createStreamRng("a", "2"),
  });
  assert.ok(Math.abs(periodPositiveLearningUsed(p, periodId) - used) < 1e-9);
});

test("display endpoints use rounded difference", () => {
  assert.equal(abilityDisplayChange(68.4, 68.95), 1);
  assert.equal(abilityDisplayChange(68.05, 68.4), 0);
});

test("GK scene uses GK attributes only", () => {
  const p = makePlayer({ seed: 9, position: "GK", rating: 68 });
  const beforeKeys = Object.keys(p.attributes);
  const pending = pendingFor(p, "goalkeeper-rebound-review");
  const result = resolveSeniorScenarioChoice(p, pending, pending.choices[0].id, {
    forceCategory: "positive",
  });
  assert.equal(result.ok, true);
  for (const k of ["Shooting", "Defending", "Dribbling"]) {
    assert.equal(p.attributes[k], undefined);
  }
  assert.ok(beforeKeys.every((k) => k in p.attributes));
  assert.ok(p.baseOverallRaw > 68 - 1e-6 || result.abilityReceipt.realizedRaw >= 0);
});

test("every catalogue scene can resolve in a constructed context", () => {
  const bank = allSeniorScenarios();
  for (const sc of bank) {
    const pos =
      sc.id === "goalkeeper-rebound-review"
        ? "GK"
        : sc.id === "missed-chance-response"
          ? "ST"
          : "CM";
    for (const choice of sc.choices) {
      const p = makePlayer({ seed: hashSeed(sc.id + choice.id), position: pos });
      p.seniorCareer.life.partner = true;
      const pend = pendingFor(p, sc.id);
      const r = resolveSeniorScenarioChoice(p, pend, choice.id, { forceCategory: "neutral" });
      assert.equal(r.ok, true, `${sc.id} ${choice.id}`);
    }
  }
});

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return (h % 100000) + 1;
}

test("Monte Carlo category rates within tolerance", () => {
  const choice = getSeniorScenarioById("press-after-defeat").choices[0];
  const target = choice.seniorCategoryProbabilities;
  const counts = { positive: 0, neutral: 0, negative: 0 };
  const n = 100000;
  for (let i = 0; i < n; i++) {
    const rng = createStreamRng(`mc:${i}`, "cat");
    const o = pickWeightedSeniorResult(choice, null, {
      categoryRng: rng,
      conditionalRng: createStreamRng(`mc:${i}`, "cond"),
    });
    counts[o.abilityCategory] += 1;
  }
  for (const cat of ["positive", "neutral", "negative"]) {
    const rate = counts[cat] / n;
    assert.ok(
      Math.abs(rate - target[cat]) < 0.0075,
      `${choice.disposition} ${cat}: ${rate} vs ${target[cat]}`
    );
  }
});

console.log("\nDone.");
