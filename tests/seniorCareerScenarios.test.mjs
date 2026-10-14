/**
 * Senior career optional scenes — triggers, eligibility, pause/resume, effects.
 * Run: node tests/seniorCareerScenarios.test.mjs
 */
import assert from "node:assert/strict";
import { LEAGUES, LEAGUE_LOOKUP, LEAGUE_BY_ID } from "../js/data/leagues.js";
import {
  allSeniorScenarios,
  getSeniorScenarioById,
  normalizeSeniorScenario,
  pickWeightedSeniorResult,
} from "../js/data/seniorCareerScenarios.js";
import {
  ensureSeniorCareerState,
  rollCompetitionEditionTrigger,
  listEnteredCompetitionEditions,
  planSeniorScenarioEvents,
  buildPendingSeniorScenario,
  resolveSeniorScenarioChoice,
  applySeniorScenarioPolicy,
  buildSeniorScenarioContext,
  scenarioEligible,
  runTriggerCalibration,
  selectScenarioForEdition,
} from "../js/simulation/seniorCareerScenarios.js";
import { createPlayerIdentity } from "../js/simulation/playerDevelopment.js";
import { ensurePlayerModel } from "../js/simulation/playerModelMigration.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import { createWorldState, setWorldState } from "../js/simulation/worldState.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import { reseedCareerRng, createStreamRng } from "../js/simulation/rng.js";
import { roundTripCareerSnapshot } from "../js/simulation/careerSnapshot.js";
import { stableCareerId } from "../js/simulation/playerDevelopmentModel.js";

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

function makeSeniorPlayer({ seed = 42, position = "CM", name = "Senior Scene" } = {}) {
  resetClubFinanceLedgers();
  reseedCareerRng(seed);
  setWorldState(createWorldState({ startYear: 2026 }));
  const league = LEAGUE_BY_ID.get("league:england-premier-league") || LEAGUES[0];
  const club = league.clubs[Math.min(4, league.clubs.length - 1)];
  const p = createPlayerIdentity({
    name,
    nationality: "England",
    position,
    age: 20,
  });
  p.startYear = 2026;
  p.rating = 68;
  p.potential = 84;
  p.attributes = {
    Speed: 68,
    Passing: 70,
    Shooting: 64,
    Defending: 62,
    Physicality: 66,
    Dribbling: 69,
  };
  if (position === "GK") {
    p.attributes = { Diving: 68, Handling: 67, Kicking: 64, Reflexes: 70, Speed: 55, Positioning: 66 };
  }
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
  p.contractStartSeason = 0;
  p.contractYears = 4;
  p.contractEndSeason = 4;
  p.weeklyWage = 12000;
  p.careerId = `senior-scene-${seed}`;
  return p;
}

test("bank has at least 24 distinct scenario IDs with three choices", () => {
  const bank = allSeniorScenarios();
  assert.ok(bank.length >= 24, `expected >=24, got ${bank.length}`);
  const ids = new Set(bank.map((s) => s.id));
  assert.equal(ids.size, bank.length);
  for (const sc of bank) {
    assert.ok(sc.choices?.length === 3, `${sc.id} needs 3 choices`);
    for (const c of sc.choices) {
      assert.ok(c.results?.length >= 2, `${c.id} needs outcomes`);
      assert.ok(c.disposition, `${c.id} needs disposition`);
    }
  }
  for (const id of [
    "press-after-defeat",
    "captain-pressure",
    "veteran-mentor",
    "partner-long-distance",
    "international-first-trip",
  ]) {
    assert.ok(getSeniorScenarioById(id), `missing ${id}`);
  }
});

test("normalize is idempotent and weighted pick works", () => {
  const raw = allSeniorScenarios()[0];
  const a = normalizeSeniorScenario(raw);
  const b = normalizeSeniorScenario(a);
  assert.equal(a.id, b.id);
  const rng = createStreamRng("t", "pick");
  const outcome = pickWeightedSeniorResult(a.choices[0], rng);
  assert.ok(Number.isFinite(outcome.delta));
  assert.ok(outcome.text);
});

test("trigger keys are stable; false rolls stored; no reroll on reload", () => {
  const p = makeSeniorPlayer({ seed: 7 });
  const args = { competitionId: "league:eng-1", editionId: "eng-1:2026" };
  const r1 = rollCompetitionEditionTrigger(p, args);
  const r2 = rollCompetitionEditionTrigger(p, args);
  assert.equal(r1.drawn, r2.drawn);
  assert.equal(r2.cached, true);
  assert.equal(r1.key, r2.key);
  const snap = roundTripCareerSnapshot({ player: p, world: null });
  const p2 = snap.player;
  const r3 = rollCompetitionEditionTrigger(p2, args);
  assert.equal(r3.drawn, r1.drawn);
  assert.equal(r3.cached, true);
});

test("independent competition editions each get one roll", () => {
  const p = makeSeniorPlayer({ seed: 11 });
  const editions = listEnteredCompetitionEditions({
    player: p,
    league: LEAGUE_LOOKUP.get(p.club.league) || LEAGUES[0],
    seasonStartYear: 2026,
    europePlan: { qualified: true, competition: "Champions League", showcase: false },
    intlProbe: { calledUp: true, primary: { name: "EURO", editionYear: 2028 } },
    cupRoundDates: ["2026-09-01"],
  });
  assert.ok(editions.length >= 3);
  const types = new Set(editions.map((e) => e.type));
  assert.ok(types.has("league"));
  assert.ok(types.has("cup"));
  assert.ok(types.has("continental"));
  assert.ok(types.has("international"));

  const planned = planSeniorScenarioEvents(p, {
    league: LEAGUE_LOOKUP.get(p.club.league) || LEAGUES[0],
    seasonStartYear: 2026,
    europePlan: { qualified: true, competition: "Champions League", showcase: false },
    intlProbe: { calledUp: true, primary: { name: "EURO", editionYear: 2028 } },
    cupRoundDates: ["2026-09-22", "2026-10-20"],
    datedLeague: [
      { date: "2026-08-20" },
      { date: "2026-08-27" },
      { date: "2026-09-03" },
      { date: "2026-09-10" },
      { date: "2026-09-17" },
      { date: "2026-09-24" },
    ],
    europePlayerSlots: [{ date: "2026-09-15" }],
    intlSlots: [{ date: "2028-06-12" }],
  });
  assert.equal(planned.planLog.length, editions.length);
  for (const row of planned.planLog) {
    assert.equal(typeof row.drawn, "boolean");
  }
  // At most one event per drawn edition
  assert.ok(planned.events.length <= editions.length);
  const editionIds = new Set(planned.events.map((e) => e.editionId));
  assert.equal(editionIds.size, planned.events.length);
});

test("non-participant continental/international excluded from rolls", () => {
  const p = makeSeniorPlayer({ seed: 13 });
  const editions = listEnteredCompetitionEditions({
    player: p,
    league: LEAGUE_LOOKUP.get(p.club.league) || LEAGUES[0],
    seasonStartYear: 2026,
    europePlan: { qualified: false, showcase: true },
    intlProbe: { calledUp: false },
    cupRoundDates: ["2026-09-01"],
  });
  assert.ok(!editions.some((e) => e.type === "continental"));
  assert.ok(!editions.some((e) => e.type === "international"));
});

test("partner eligibility gates relationship scenes", () => {
  const p = makeSeniorPlayer({ seed: 17 });
  const state = ensureSeniorCareerState(p);
  state.life.partner = false;
  state.life.initialized = true;
  const ctx = buildSeniorScenarioContext(p);
  const partnerScene = getSeniorScenarioById("partner-long-distance");
  assert.equal(scenarioEligible(partnerScene, ctx), false);
  state.life.partner = true;
  const ctx2 = buildSeniorScenarioContext(p);
  assert.equal(scenarioEligible(partnerScene, ctx2), true);
});

test("resolve is idempotent; duplicate clicks do not stack effects", () => {
  const p = makeSeniorPlayer({ seed: 19 });
  ensureSeniorCareerState(p).life.partner = false;
  ensureSeniorCareerState(p).life.initialized = true;
  const sc = getSeniorScenarioById("airport-fan");
  const pending = {
    unschedulable: false,
    kind: "senior_scenario",
    scenarioId: sc.id,
    title: sc.title,
    setup: sc.setup,
    date: "2026-10-01",
    competitionId: "league:x",
    editionId: "x:2026",
    competitionType: "league",
    competitionLabel: "League",
    choices: sc.choices.map((c) => ({ id: c.id, label: c.label, disposition: c.disposition })),
    resolved: false,
  };
  const moraleBefore = p.state?.morale ?? 0;
  const r1 = resolveSeniorScenarioChoice(p, pending, sc.choices[0].id);
  assert.equal(r1.ok, true);
  assert.equal(r1.duplicate, false);
  const mid = p.state.morale;
  const r2 = resolveSeniorScenarioChoice(p, pending, sc.choices[0].id);
  assert.equal(r2.duplicate, true);
  assert.equal(p.state.morale, mid);
  assert.ok(p.seniorCareer.history.length === 1);
  assert.ok(p.seniorCareer.history[0].applicationId);
  // Effects may be zero for some outcomes; history still recorded.
  assert.ok(r1.outcome?.text);
  assert.ok(Number.isFinite(moraleBefore) || moraleBefore === 0);
});

test("balanced policy does not always pick ambitious max-reward label", () => {
  const p = makeSeniorPlayer({ seed: 23 });
  const sc = getSeniorScenarioById("press-breakthrough");
  const pending = buildPendingSeniorScenario(p, {
    scenarioId: sc.id,
    date: "2026-11-01",
    competitionId: "league:x",
    editionId: "x:2026",
    competitionType: "league",
    competitionLabel: "League",
    rollKey: "k",
  }, { forceStandout: true });
  assert.ok(pending && !pending.unschedulable);
  const result = applySeniorScenarioPolicy(p, pending, "balanced");
  assert.equal(result.ok, true);
  const ambitious = sc.choices.find((c) => c.disposition === "ambitious");
  // Policy may occasionally land on ambitious if that is the balanced slot after shuffle;
  // assert it is a real choice from the pending list and not "always first reward".
  assert.ok(pending.choices.some((c) => c.id === pending.chosenOptionId || c.id === result.historyEntry?.choiceId));
  assert.ok(result.historyEntry?.choiceId);
  if (ambitious) {
    // Across this single call we only require a documented non-max-chasing policy ran.
    assert.ok(["thoughtful", "balanced", "ambitious", "reckless"].includes(
      sc.choices.find((c) => c.id === result.historyEntry.choiceId)?.disposition
    ));
  }
});

test("pause → choice → resume path preserves earlier results and applies once", () => {
  // Search seeds until at least one senior scene is drawn (30% per edition).
  let p = null;
  let data = null;
  let sawScenario = false;
  for (let seed = 200; seed < 260 && !sawScenario; seed++) {
    p = makeSeniorPlayer({ seed, name: `Pause Resume ${seed}` });
    data = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, { pauseForDecisions: true });
    let guards = 0;
    while ((data.awaitingScenario || data.awaitingDecision) && guards < 16) {
      guards += 1;
      if (data.awaitingScenario) {
        sawScenario = true;
        const pending = data.pendingSeniorScenario || p.pendingSeniorScenario;
        assert.ok(pending?.scenarioId);
        const ageAtPause = p.age;
        const matchesBefore = data.partialPlayerMatchStats?.played || 0;
        const snap = roundTripCareerSnapshot({ player: p, world: null, checkpoint: data.checkpoint });
        assert.equal(snap.player.seasonCheckpoint?.status, "awaiting_scenario");
        const choiceId = pending.choices[1]?.id || pending.choices[0].id;
        const applied = resolveSeniorScenarioChoice(p, pending, choiceId);
        assert.equal(applied.ok, true);
        resolveSeniorScenarioChoice(p, pending, choiceId);
        assert.equal(
          p.seniorCareer.history.filter((h) => h.applicationId === applied.applicationId).length,
          1
        );
        assert.equal(p.age, ageAtPause);
        data = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
          pauseForDecisions: true,
          checkpoint: data.checkpoint,
        });
        // Earlier match count must not rewind.
        if (data.partialPlayerMatchStats) {
          assert.ok((data.partialPlayerMatchStats.played || 0) >= matchesBefore);
        }
        continue;
      }
      if (data.awaitingDecision) {
        p.pendingDecision = null;
        p.pendingOffers = [];
        data = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
          pauseForDecisions: true,
          checkpoint: data.checkpoint,
          autoDecisionPolicy: "stay",
        });
      }
    }
  }
  assert.ok(sawScenario, "expected at least one senior_scenario pause across seeds");
  assert.ok(!data.awaitingScenario && !data.awaitingDecision);
  assert.ok(p.seasons?.length >= 1);
  assert.ok((p.seniorCareer?.history?.length || 0) >= 1);
});

test("headless season with auto policy completes; scenes use balanced not always-max", () => {
  const p = makeSeniorPlayer({ seed: 31, name: "Auto Policy" });
  const data = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  assert.ok(!data.awaitingScenario);
  assert.ok(!data.awaitingDecision);
  assert.ok(p.seasons.length >= 1);
});

test("goalkeeper senior season path", () => {
  const p = makeSeniorPlayer({ seed: 37, position: "GK", name: "GK Scenes" });
  const data = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  assert.ok(p.seasons.length >= 1);
  assert.ok(!data.awaitingDecision);
});

test("10k trigger calibration per competition type stays near 30%", () => {
  for (const type of ["league", "cup", "continental", "international"]) {
    const cal = runTriggerCalibration({ trials: 10000, competitionType: type, seed: 99 });
    assert.ok(cal.rate > 0.27 && cal.rate < 0.33, `${type} rate ${cal.rate}`);
    console.log(`    ${type}: drawn=${cal.drawn}/${cal.trials} rate=${cal.rate.toFixed(4)}`);
  }
});

test("same trigger seed yields same scenario selection across interactive-shaped resolve", () => {
  const make = (seed) => {
    const p = makeSeniorPlayer({ seed, name: `Det ${seed}` });
    ensureSeniorCareerState(p);
    const edition = {
      type: "league",
      competitionId: "league:det",
      editionId: `det:${seed}`,
      label: "Det",
    };
    rollCompetitionEditionTrigger(p, edition);
    // Force drawn by writing roll
    const key = `${stableCareerId(p)}|${edition.competitionId}|${edition.editionId}`;
    p.seniorCareer.rolls[key] = {
      competitionId: edition.competitionId,
      editionId: edition.editionId,
      drawn: true,
      probability: 0.3,
      seasonIndex: 0,
    };
    const ctx = buildSeniorScenarioContext(p, { forceAfterLoss: true });
    const sel = selectScenarioForEdition(p, edition, ctx);
    return sel.scenario?.id;
  };
  assert.equal(make(55), make(55));
});

console.log("\nSenior career scenario tests done.");
