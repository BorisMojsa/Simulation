/**
 * Fix 05: match participation, knockout finalization, ledger metadata, evidence.
 * Run: node tests/matchParticipationEvidence.test.mjs
 */
import assert from "node:assert/strict";
import { LEAGUE_BY_ID } from "../js/data/leagues.js";
import { createRng, createStreamRng } from "../js/simulation/rng.js";
import {
  simulateMatch,
  resolveKnockout,
  resolveTwoLeggedTie,
  normalizeParticipationMinutes,
  countUserOpenPlayEvents,
  finalizePlayerMatchStats,
} from "../js/simulation/matchEngine.js";
import { processPlayerMatchDay } from "../js/simulation/playerMatchDay.js";
import {
  createEmptyLedger,
  recordMatchObservation,
  aggregateSeason,
} from "../js/simulation/playerSeasonLedger.js";
import { buildSeasonEvidence } from "../js/simulation/seasonEvidence.js";
import { applyInjury, isAvailable } from "../js/simulation/playerHealth.js";
import { toDay } from "../js/simulation/playerState.js";
import {
  generateStartingAttributes,
  initializePlayerDevelopment,
} from "../js/simulation/playerDevelopmentModel.js";
import { ensurePlayingStints } from "../js/simulation/playingRegistration.js";
import { createWorldState, setWorldState } from "../js/simulation/worldState.js";

function test(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === "function") {
      return out
        .then(() => console.log(`OK  ${name}`))
        .catch((e) => {
          console.error(`FAIL ${name}`);
          console.error(e);
          process.exitCode = 1;
        });
    }
    console.log(`OK  ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

const league = LEAGUE_BY_ID.get("league:england-premier-league");
const home = league.clubs.find((c) => c.clubId === "club:england:arsenal");
const away = league.clubs.find((c) => c.clubId === "club:england:brentford");
assert.ok(home && away, "canonical PL clubs required");

function makePlayer(minutes, extras = {}) {
  return {
    name: extras.name || "Bug 5 Probe",
    position: extras.position || "ST",
    rating: extras.rating ?? 85,
    currentOverall: extras.rating ?? 85,
    currentOverallRaw: extras.rating ?? 85,
    baseOverallRaw: extras.rating ?? 85,
    matchParticipation: {
      minutes,
      started: minutes > 35,
      selected: true,
      matchDuration: 90,
      ...(extras.participation || {}),
    },
    health: { activeInjury: null, eventsApplied: {} },
    state: { fatigue: 0, form: 0, readiness: 1, roleFit: 1 },
    ...extras,
  };
}

function userEvents(match) {
  return (match.events || []).filter((e) => e.playerInvolved);
}

test("normalizeParticipationMinutes: explicit zero, omitted, invalid", () => {
  assert.equal(normalizeParticipationMinutes(0, { omittedFallback: 90 }), 0);
  assert.equal(normalizeParticipationMinutes(null, { omittedFallback: 90 }), 90);
  assert.equal(normalizeParticipationMinutes(undefined, { omittedFallback: 90 }), 90);
  assert.equal(normalizeParticipationMinutes("", { omittedFallback: 90 }), 90);
  assert.equal(normalizeParticipationMinutes(NaN, { omittedFallback: 90 }), 0);
  assert.equal(normalizeParticipationMinutes(-5, { omittedFallback: 90 }), 0);
  assert.equal(normalizeParticipationMinutes(200, { durationMax: 120 }), 120);
});

test("explicit zero minutes: no user goal/assist/card events or rating (100 seeds)", () => {
  let goalAssist = 0;
  let cards = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const match = simulateMatch(home, away, {
      player: makePlayer(0),
      playerSide: "home",
      playerMinutes: 0,
      rng: createRng(seed),
    });
    const ev = userEvents(match);
    if (ev.some((e) => e.type === "goal" || e.type === "assist")) goalAssist += 1;
    if (ev.some((e) => e.type === "yellow" || e.type === "red")) cards += 1;
    assert.equal(match.playerStats.played, false);
    assert.equal(match.playerStats.minutes, 0);
    assert.equal(match.playerStats.rating, null);
    assert.equal(match.playerStats.goals, 0);
  }
  assert.equal(goalAssist, 0, `goal/assist contradictions: ${goalAssist}`);
  assert.equal(cards, 0, `card contradictions: ${cards}`);
});

test("omitted minutes still default to match duration for player fixtures", () => {
  const player = makePlayer(90);
  delete player.matchParticipation.minutes;
  const match = simulateMatch(home, away, {
    player,
    playerSide: "home",
    // playerMinutes omitted
    rng: createRng(1),
  });
  assert.equal(match.playerStats.minutes, 90);
  assert.equal(match.playerStats.played, true);
});

test("zero-minute knockout remains unrated with no user events", () => {
  const player = makePlayer(0);
  const rng = createRng(2);
  const initial = simulateMatch(home, away, {
    player,
    playerSide: "home",
    playerMinutes: 0,
    rng,
  });
  const knockout = resolveKnockout(initial, { player, rng });
  assert.equal(knockout.playerStats.played, false);
  assert.equal(knockout.playerStats.minutes, 0);
  assert.equal(knockout.playerStats.rating, null);
  assert.equal(userEvents(knockout).length, 0);
});

test("positive starter still produces user contributions under existing rates", () => {
  let hits = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const match = simulateMatch(home, away, {
      player: makePlayer(90),
      playerSide: "home",
      playerMinutes: 90,
      rng: createRng(seed),
    });
    if (userEvents(match).some((e) => e.type === "goal" || e.type === "assist")) hits += 1;
  }
  assert.ok(hits > 10, `expected nonzero contributions, got ${hits}`);
});

test("GK never receives outfield goal attribution", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const match = simulateMatch(home, away, {
      player: makePlayer(90, { position: "GK", rating: 82 }),
      playerSide: "home",
      playerMinutes: 90,
      rng: createRng(seed),
    });
    assert.equal(
      userEvents(match).filter((e) => e.type === "goal").length,
      0
    );
  }
});

test("knockout final events equal playerStats (1000 seeds, ET/pens exercised)", () => {
  let draws = 0;
  let et = 0;
  let pens = 0;
  let positiveUser = 0;
  let violations = 0;
  for (let seed = 1; seed <= 1000; seed++) {
    const player = makePlayer(90);
    const rng = createRng(seed);
    let match = simulateMatch(home, away, {
      player,
      playerSide: "home",
      playerMinutes: 90,
      rng,
    });
    if (match.homeGoals !== match.awayGoals) continue;
    draws += 1;
    match = resolveKnockout(match, { player, rng });
    if (match.decidedBy === "extraTime") et += 1;
    if (match.decidedBy === "penalties") pens += 1;
    const counted = countUserOpenPlayEvents(match);
    if (counted.goals || counted.assists) positiveUser += 1;
    if (
      counted.goals !== match.playerStats.goals ||
      counted.assists !== match.playerStats.assists ||
      counted.yellow !== match.playerStats.yellow ||
      counted.red !== match.playerStats.red
    ) {
      violations += 1;
    }
    assert.ok(match.playerStats.minutes >= 90);
    if (match.decidedBy === "extraTime" || match.decidedBy === "penalties") {
      assert.equal(match.playerStats.minutes, 120);
    }
    // Shootout kicks excluded from goals
    const penGoals = (match.events || []).filter(
      (e) => e.phase === "penalties" && e.type === "penalty_scored" && e.playerInvolved
    ).length;
    assert.equal(penGoals, 0);
  }
  assert.ok(draws > 50, `expected regulation draws, got ${draws}`);
  assert.ok(et > 0, "ET branch not reached");
  assert.ok(pens > 0, "pens branch not reached");
  assert.ok(positiveUser > 0, "no positive user goals/assists in KO cohort");
  assert.equal(violations, 0, `event/stat violations: ${violations}`);
});

test("witness seeds 6/169/462: events agree with stats after KO", () => {
  for (const seed of [6, 169, 462]) {
    const player = makePlayer(90);
    const rng = createRng(seed);
    let match = simulateMatch(home, away, {
      player,
      playerSide: "home",
      playerMinutes: 90,
      rng,
    });
    assert.equal(match.homeGoals, match.awayGoals, `seed ${seed} should draw in regulation`);
    match = resolveKnockout(match, { player, rng });
    const counted = countUserOpenPlayEvents(match);
    assert.equal(counted.goals, match.playerStats.goals, `seed ${seed} goals`);
    assert.equal(counted.assists, match.playerStats.assists, `seed ${seed} assists`);
  }
});

test("two-leg tie: second leg carries finalized KO stats; first leg regulation-only", () => {
  const player = makePlayer(90);
  const rng = createRng(6);
  const first = simulateMatch(home, away, {
    player: makePlayer(90),
    playerSide: "home",
    playerMinutes: 90,
    rng: createRng(3),
  });
  // Force aggregate level by cloning first into a synthetic second with flipped orientation scores.
  let second = simulateMatch(away, home, {
    player,
    playerSide: "away",
    playerMinutes: 90,
    rng,
  });
  // Force level aggregate via explicit aggregate fields on firstLeg convention.
  first.aggregateA = 1;
  first.aggregateB = 1;
  second.homeGoals = second.regulationHomeGoals = 1;
  second.awayGoals = second.regulationAwayGoals = 1;
  second.matchHomeGoals = 1;
  second.matchAwayGoals = 1;
  second.playerStats = { ...second.playerStats, played: true, minutes: 90 };
  const tie = resolveTwoLeggedTie(first, second, { player, rng: createRng(6) });
  assert.ok(["extraTime", "penalties", "aggregate"].includes(tie.decidedBy) || tie.winnerSide);
  // First leg must not grow ET events.
  assert.ok(!(first.events || []).some((e) => e.phase === "extraTime"));
  if (tie.decidedBy === "extraTime" || tie.decidedBy === "penalties") {
    const counted = countUserOpenPlayEvents(tie.secondLeg);
    assert.equal(counted.goals, tie.secondLeg.playerStats.goals);
    assert.equal(counted.assists, tie.secondLeg.playerStats.assists);
  }
});

test("finalizePlayerMatchStats is idempotent", () => {
  const player = makePlayer(90);
  const match = simulateMatch(home, away, {
    player,
    playerSide: "home",
    playerMinutes: 90,
    rng: createRng(42),
  });
  const once = finalizePlayerMatchStats(match, player, createRng(1));
  const twice = finalizePlayerMatchStats(once, player, createRng(1));
  assert.deepEqual(once.playerStats, twice.playerStats);
});

test("ledger: null rating stays unrated; cleanSheet preserved; structured zero-minute", () => {
  const ledger = createEmptyLedger("2026");
  const pos = recordMatchObservation(ledger, {
    matchId: "m1",
    competitionType: "league",
    competitionId: "league:england-premier-league",
    editionId: "2026",
    teamId: "club:england:arsenal",
    stintId: "stint:1",
    opponentId: "club:england:brentford",
    minutes: 90,
    started: true,
    selected: true,
    available: true,
    position: "GK",
    goals: 0,
    assists: 0,
    cleanSheet: true,
    cleanSheetEligible: true,
    rating: null,
    expectedRating: 6.5,
    date: "2026-08-15",
  });
  assert.equal(pos.recorded, true);
  assert.equal(pos.entry.rating, null);
  assert.equal(pos.entry.observation, null);
  assert.equal(pos.entry.cleanSheet, true);
  assert.equal(pos.entry.editionId, "2026");

  const zero = recordMatchObservation(ledger, {
    matchId: "m2",
    competitionType: "league",
    competitionId: "league:england-premier-league",
    editionId: "2026",
    teamId: "club:england:arsenal",
    minutes: 0,
    selected: true,
    available: true,
    nonParticipationReason: "unused_substitute",
    date: "2026-08-22",
  });
  assert.equal(zero.reason, "no-participation");
  assert.equal(typeof ledger.nonParticipation.m2, "object");
  assert.equal(ledger.nonParticipation.m2.reason, "unused_substitute");
  assert.equal(ledger.nonParticipation.m2.date, "2026-08-22");

  // Duplicate of zero-minute is no-op
  const dup = recordMatchObservation(ledger, {
    matchId: "m2",
    minutes: 90,
    competitionType: "league",
  });
  assert.equal(dup.duplicate, true);
  assert.equal(ledger.matches.length, 1);

  // Legacy boolean non-participation still counts
  ledger.nonParticipation.legacy = true;
  const agg = aggregateSeason(ledger);
  assert.equal(agg.nonParticipationCount, 2);
  assert.equal(agg.nonParticipation.byReason.unused_substitute, 1);
  assert.equal(agg.nonParticipation.byReason.unknown, 1);

  const evidence = buildSeasonEvidence(
    { position: "GK", name: "Keeper" },
    {
      ledger,
      seasonId: "2026",
      competitionEditions: [
        {
          editionId: "2026",
          scope: "league",
          competitionKey: "league:england-premier-league",
        },
      ],
    }
  );
  assert.equal(evidence.byScope.league.cleanSheets, 1);
  assert.ok(evidence.byEdition["2026"]);
  assert.equal(evidence.byEdition["2026"].cleanSheets, 1);
});

test("ledger known-false clean sheet distinct from unknown", () => {
  const ledger = createEmptyLedger("2026");
  recordMatchObservation(ledger, {
    matchId: "cs-false",
    competitionType: "league",
    minutes: 90,
    position: "GK",
    cleanSheet: false,
    cleanSheetEligible: true,
    rating: 6.2,
  });
  const evidence = buildSeasonEvidence(
    { position: "GK" },
    { ledger, seasonId: "2026" }
  );
  assert.equal(evidence.byScope.league.cleanSheets, 0);
});

function makeRegisteredPlayer(position = "ST", target = 78) {
  const rng = createRng(42);
  const attrs = generateStartingAttributes(position, target, 99, rng);
  const player = {
    name: "Bug5 Injury",
    nationality: "England",
    position,
    age: 22,
    careerId: `bug5-inj-${position}`,
    attributes: attrs,
    rating: target,
    startYear: 2026,
    club: {
      name: home.name,
      displayName: home.displayName,
      clubId: home.clubId,
      league: league.name,
      leagueId: league.leagueId,
      leagueDisplay: league.displayName,
      nation: "England",
      overall: home.overall ?? 84,
      badge: null,
      financialTier: 5,
      tier: 5,
    },
  };
  initializePlayerDevelopment(player, { rng, careerId: player.careerId, budget: 99 });
  ensurePlayingStints(player, { asOfDate: "2026-07-01" });
  setWorldState(createWorldState(player));
  return player;
}

test("pre-kickoff training injury zeros selected minutes", () => {
  const player = makeRegisteredPlayer("ST", 80);
  // Selection always starts; injury RNG random()=0 always hits the hazard check.
  const selRng = {
    random: () => 0.01,
    chance: (p) => 0.01 < p,
    int: (a, b) => Math.min(90, b),
    float: (a) => a,
    pick: (arr) => arr[0],
    shuffle: (arr) => arr,
  };
  const injuryRng = {
    random: () => 0,
    chance: () => true,
    int: (a, b) => a,
    float: (a) => a,
    pick: (arr) => arr[0],
    shuffle: (arr) => arr,
  };
  const result = processPlayerMatchDay({
    home,
    away,
    player,
    playerSide: "home",
    date: "2026-09-01",
    competition: "league",
    competitionType: "league",
    competitionId: league.leagueId,
    editionId: "2026",
    fixtureId: "inj-test-1",
    teamType: "club",
    rng: createRng(1),
    selRng,
    injuryRng,
  });
  assert.ok(player.health?.activeInjury, "training injury must apply when rng.random()===0");
  assert.equal(result.match.playerStats.minutes, 0);
  assert.equal(result.match.playerStats.played, false);
  assert.equal(result.match.playerStats.rating, null);
  assert.equal(result.ledgerRecord.minutes, 0);
  assert.equal(result.ledgerRecord.nonParticipationReason, "injured");
  assert.equal(userEvents(result.match).length, 0);
});

test("controlled pre-kickoff injury via applyInjury before simulate path", () => {
  const player = makeRegisteredPlayer("CM", 76);
  const startDay = toDay("2026-09-01");
  applyInjury(player, {
    eventId: "forced-train",
    kind: "training",
    severity: "moderate",
    date: "2026-09-01",
    startDay,
    durationDays: 21,
    expectedReturnDate: "2026-09-22",
    expectedReturnDay: startDay + 21,
    temporaryEffects: { overallPenalty: 4, scale: 1, attributePenalties: {} },
    returnReadiness: 0.55,
  });
  assert.equal(isAvailable(player.health, "2026-09-01"), false);
  const result = processPlayerMatchDay({
    home,
    away,
    player,
    playerSide: "home",
    date: "2026-09-01",
    competition: "league",
    competitionType: "league",
    competitionId: league.leagueId,
    editionId: "2026",
    fixtureId: "inj-forced-1",
    teamType: "club",
    rng: createRng(5),
    selRng: createStreamRng(player.careerId, "sel"),
    injuryRng: createStreamRng(player.careerId, "inj"),
  });
  assert.equal(result.participation.available, false);
  assert.equal(result.match.playerStats.minutes, 0);
  assert.equal(result.match.playerStats.played, false);
  assert.equal(result.match.playerStats.rating, null);
  assert.equal(userEvents(result.match).length, 0);
  assert.equal(result.ledgerRecord.nonParticipationReason, "injured");
});

console.log("matchParticipationEvidence tests complete");
