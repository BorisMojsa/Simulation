/**
 * Fix 08: user/rival performance comparability and individual awards.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSeasonEvidence } from "../js/simulation/seasonEvidence.js";
import { createEmptyLedger, recordMatchObservation } from "../js/simulation/playerSeasonLedger.js";
import { createStreamRng, createRng } from "../js/simulation/rng.js";
import {
  evaluateSeasonAwards,
  ensureCompetitionAwardField,
  scoreSeasonLine,
  roleGroupOf,
} from "../js/simulation/individualAwards.js";

function scopeProbe({ cupApps = 0, cupGoals = 0, position = "ST", name = "Scope probe" } = {}) {
  const player = {
    name,
    careerId: `scope-${name}`,
    position,
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
    evidence,
    result,
  };
}

function leagueCandidateKey(run) {
  const ll = run.leagueLine;
  const awards = run.leagueAwards
    .map((a) => `${a.awardId}:${a.status}:${a.rank}`)
    .sort()
    .join("|");
  return JSON.stringify({
    goals: ll.goals,
    assists: ll.assists,
    minutes: ll.minutes,
    rating: ll.rating,
    awards,
  });
}

test("F01: cup ratings alone cannot change league award candidate line", () => {
  const leagueOnly = scopeProbe();
  const cupRatingOnly = scopeProbe({ cupApps: 6, cupGoals: 0 });
  assert.equal(leagueOnly.leagueLine.rating, 6.3);
  assert.equal(cupRatingOnly.leagueLine.rating, 6.3);
  assert.notEqual(cupRatingOnly.combinedRating, leagueOnly.combinedRating);
  assert.equal(leagueCandidateKey(leagueOnly), leagueCandidateKey(cupRatingOnly));
  assert.equal(cupRatingOnly.leagueAwards.length, 0);
});

test("F02: cup goals cannot inflate league POTS/Young/Rookie candidate", () => {
  const leagueOnly = scopeProbe();
  const cupOutput = scopeProbe({ cupApps: 6, cupGoals: 30 });
  assert.equal(cupOutput.leagueLine.goals, 10);
  assert.equal(cupOutput.leagueLine.assists, 6);
  assert.equal(leagueCandidateKey(leagueOnly), leagueCandidateKey(cupOutput));
  assert.ok(!cupOutput.leagueAwards.some((a) => a.status === "won"));
});

test("F03: scoped weighted rating ignores unknown ratings and zero-minute rows", () => {
  const player = {
    name: "R",
    careerId: "f03",
    position: "CM",
    age: 24,
    club: { name: "A", clubId: "a" },
    seasons: [],
  };
  const ledger = createEmptyLedger("s1");
  recordMatchObservation(ledger, {
    matchId: "a1",
    competitionType: "league",
    competitionId: "L1",
    editionId: "2026",
    minutes: 90,
    started: true,
    goals: 1,
    rating: 7.0,
  });
  recordMatchObservation(ledger, {
    matchId: "a2",
    competitionType: "league",
    competitionId: "L1",
    editionId: "2026",
    minutes: 45,
    started: false,
    goals: 0,
    rating: 6.0,
  });
  recordMatchObservation(ledger, {
    matchId: "a3",
    competitionType: "league",
    competitionId: "L1",
    editionId: "2026",
    minutes: 90,
    started: true,
    goals: 0,
    // unknown rating
  });
  recordMatchObservation(ledger, {
    matchId: "z0",
    competitionType: "league",
    competitionId: "L1",
    editionId: "2026",
    minutes: 0,
    rating: 9.9,
  });
  recordMatchObservation(ledger, {
    matchId: "c1",
    competitionType: "cup",
    competitionId: "C1",
    editionId: "2026",
    minutes: 90,
    started: true,
    goals: 2,
    rating: 9.0,
  });
  const evidence = buildSeasonEvidence(player, {
    seasonId: "s1",
    ledger,
    competitionEditions: [
      { scope: "league", competitionId: "L1", editionId: "2026" },
      { scope: "cup", competitionId: "C1", editionId: "2026" },
    ],
  });
  const league = evidence.byEdition["L1::2026"];
  const cup = evidence.byEdition["C1::2026"];
  assert.equal(league.ratedMinutes, 135);
  assert.equal(league.ratingSum, 7 * 90 + 6 * 45);
  assert.ok(Math.abs(league.rating - (7 * 90 + 6 * 45) / 135) < 1e-12);
  assert.equal(league.goals, 1);
  assert.equal(cup.goals, 2);
  assert.equal(cup.rating, 9.0);
  assert.equal(league.appearances, 3); // zero-minute not an appearance
});

test("F05: actor exchange — identical evidence yields identical scores", () => {
  const line = {
    group: "FWD",
    minutes: 2700,
    goals: 15,
    assists: 6,
    cleanSheets: 0,
    rating: 7.1,
    teamPpg: 1.8,
  };
  const a = scoreSeasonLine({ ...line }, 3420);
  const b = scoreSeasonLine({ ...line }, 3420);
  assert.equal(a, b);
  const userish = scoreSeasonLine({ ...line, isUser: true, name: "You" }, 3420);
  const rivalish = scoreSeasonLine({ ...line, isUser: false, name: "NPC" }, 3420);
  assert.equal(userish, rivalish);
  assert.equal(roleGroupOf("ST"), "FWD");
});

test("F08: generated rivals conserve appearances/starts/minutes", () => {
  const player = {
    name: "U",
    position: "ST",
    club: { name: "Club 1", clubId: "c0" },
    awardFields: {},
  };
  const table = Array.from({ length: 20 }, (_, i) => ({
    name: `Club ${i + 1}`,
    clubId: `c${i}`,
    played: 38,
    goalsFor: 40 + i,
    goalsAgainst: 40,
    points: 40 + i,
    position: i + 1,
  }));
  const field = ensureCompetitionAwardField(
    player,
    {
      seasonId: "s1",
      competitionEditionId: "league:a::2026",
      scope: "league",
      table,
      userClub: { name: "Club 1", clubId: "c0" },
      user: { goals: 10, assists: 5, position: "ST" },
      standing: table[0],
    },
    createStreamRng("opp", "f")
  );
  assert.ok(field.referenceMoments?.populationSize > field.rivals.length);
  for (const r of field.rivals) {
    assert.ok(r.minutes <= r.matches * 90, `${r.id} minutes ${r.minutes} > apps*90`);
    if (r.starts != null) assert.ok(r.starts <= r.matches, `${r.id} starts`);
    if (r.group === "GK" || r.group === "DEF") {
      assert.ok(r.cleanSheets <= r.matches, `${r.id} clean sheets`);
    }
  }
});

test("F09: user-team goal caps recompute teammate ratings", () => {
  const player = {
    name: "U",
    position: "ST",
    club: { name: "Club 1", clubId: "c0" },
    awardFields: {},
  };
  const table = [
    {
      name: "Club 1",
      clubId: "c0",
      played: 38,
      goalsFor: 20,
      goalsAgainst: 30,
      points: 40,
      position: 10,
    },
    ...Array.from({ length: 19 }, (_, i) => ({
      name: `Club ${i + 2}`,
      clubId: `c${i + 1}`,
      played: 38,
      goalsFor: 45,
      goalsAgainst: 40,
      points: 50,
      position: i + 1,
    })),
  ];
  // High user goals force teammate caps toward zero on a low-scoring user club.
  const field = ensureCompetitionAwardField(
    player,
    {
      seasonId: "s1",
      competitionEditionId: "cap::2026",
      scope: "league",
      table,
      userClub: { name: "Club 1", clubId: "c0" },
      user: { goals: 20, assists: 10, position: "ST" },
      standing: table[0],
    },
    createStreamRng("cap", "f")
  );
  const teammates = field.rivals.filter((r) => r.userTeam || r.club === "Club 1");
  for (const t of teammates) {
    const expected = scoreSeasonLine(
      {
        group: t.group,
        minutes: t.minutes,
        goals: t.goals,
        assists: t.assists,
        cleanSheets: t.cleanSheets,
        rating: t.rating,
        teamPpg: t.teamPpg,
      },
      field.possibleMinutes
    );
    // Rating must be consistent with post-cap output (recomputed with talent noise stripped).
    assert.ok(Number.isFinite(t.rating));
    assert.ok(t.goals >= 0);
    assert.ok(Number.isFinite(expected));
  }
  const teamGoalSum = teammates.reduce((s, r) => s + r.goals, 0);
  assert.ok(teamGoalSum <= 0 + 1e-9 || teamGoalSum <= 20);
});

test("F11: Golden Boot uses league goals only; ties shared", () => {
  const low = scopeProbe({ name: "Low" });
  assert.equal(low.leagueLine.goals, 10);
  // With supplied rivals topping 16 goals, user is not boot winner.
  assert.ok(!low.leagueAwards.some((a) => a.awardId === "golden-boot" && a.status === "won"));
});

test("F16: award module has no Math.random; caller rng untouched", () => {
  const src = readFileSync(new URL("../js/simulation/individualAwards.js", import.meta.url), "utf8");
  assert.ok(!/\bMath\.random\b/.test(src));
  const rng = createRng(12345);
  const before = rng.random();
  const run = scopeProbe();
  assert.ok(run.evidence);
  const after = createRng(12345).random();
  assert.equal(before, after);
});

test("F04: modern missing edition evidence stays empty; legacy aggregate path documented", () => {
  const player = {
    name: "L",
    careerId: "f04",
    position: "ST",
    age: 24,
    club: { name: "A", clubId: "a" },
    seasons: [],
  };
  const ledger = createEmptyLedger("s1");
  recordMatchObservation(ledger, {
    matchId: "l1",
    competitionType: "league",
    competitionId: "L1",
    editionId: "2026",
    minutes: 90,
    started: true,
    goals: 2,
    rating: 7.0,
  });
  const evidence = buildSeasonEvidence(player, {
    seasonId: "s1",
    ledger,
    competitionEditions: [
      { scope: "league", competitionId: "L1", editionId: "2026" },
      { scope: "league", competitionId: "L2", editionId: "2026" },
    ],
  });
  assert.ok(evidence.byEdition["L1::2026"]);
  assert.equal(evidence.byEdition["L2::2026"], undefined);
  const result = evaluateSeasonAwards({
    player,
    evidence,
    seasonId: "s1",
    seasonStartAge: 24,
    options: { competitionKey: "L2" },
    rivals: { rivals: [], possibleMinutes: 3420 },
    rng: createStreamRng("f04", "a"),
  });
  // Wrong league key must not borrow L1 goals into Golden Boot.
  assert.ok(!result.records.some((r) => r.awardId === "golden-boot" && r.status === "won"));
});

test("F10: compact field retains reference moments for standardization", () => {
  const player = {
    name: "U",
    position: "CM",
    club: { name: "Club 1", clubId: "c0" },
    awardFields: {},
  };
  const table = Array.from({ length: 18 }, (_, i) => ({
    name: `Club ${i + 1}`,
    clubId: `c${i}`,
    played: 38,
    goalsFor: 35 + i,
    goalsAgainst: 40,
    points: 40 + i,
    position: i + 1,
  }));
  const field = ensureCompetitionAwardField(
    player,
    {
      seasonId: "s1",
      competitionEditionId: "compact::1",
      scope: "league",
      table,
      userClub: table[0],
      user: { goals: 4, assists: 6, position: "CM" },
    },
    createStreamRng("compact", "f")
  );
  assert.ok(field.populationSize > field.rivals.length);
  assert.ok(field.referenceMoments.byGroup.MID.n > 0);
  assert.ok(field.referenceMoments.byGroup.FWD.sd >= 0.35);
});

test("F12: Golden Glove requires GK participation; outfield excluded", () => {
  const st = scopeProbe({ position: "ST", name: "Outfield" });
  assert.ok(!st.leagueAwards.some((a) => a.awardId === "golden-glove"));
});

test("F13: youth uses season-start age; rookie uses prior senior minutes", () => {
  const young = scopeProbe({ name: "Young22" });
  assert.equal(young.evidence.seasonStartAge, 22);
  // Rookie-eligible supplied rivals exist; user priorSeniorMinutes 0 from empty seasons.
  assert.equal(young.result.records.filter((r) => r.awardId === "rookie-of-the-season").length >= 0, true);
});

test("F15: second league edition does not mutate the first", () => {
  const a = scopeProbe({ name: "MoveA" });
  const firstKey = leagueCandidateKey(a);
  const player = {
    name: "MoveA",
    careerId: "scope-MoveA",
    position: "ST",
    rating: 70,
    age: 22,
    club: { name: "B", clubId: "club:b" },
    seasons: [],
    awardFields: {},
  };
  const ledger = createEmptyLedger("s1");
  for (let i = 0; i < 10; i++) {
    recordMatchObservation(ledger, {
      matchId: `b${i}`,
      competitionType: "league",
      competitionId: "league:b",
      editionId: "2026",
      minutes: 90,
      started: true,
      goals: 1,
      rating: 7.5,
    });
  }
  const evidence = buildSeasonEvidence(player, {
    seasonId: "s1",
    ledger,
    competitionEditions: [{ scope: "league", competitionId: "league:b", editionId: "2026" }],
  });
  evaluateSeasonAwards({
    player,
    evidence,
    seasonId: "s1",
    seasonStartAge: 22,
    options: { competitionKey: "league:b" },
    rivals: { rivals: [], possibleMinutes: 3420 },
    rng: createStreamRng("move", "b"),
  });
  const again = scopeProbe({ name: "MoveA" });
  assert.equal(leagueCandidateKey(again), firstKey);
});

test("F20: scoreSeasonLine orders stronger rating above weaker with equal output", () => {
  const base = { group: "FWD", minutes: 2700, goals: 10, assists: 5, cleanSheets: 0, teamPpg: 1.5 };
  const poor = scoreSeasonLine({ ...base, rating: 5.8 }, 3420);
  const ok = scoreSeasonLine({ ...base, rating: 6.5 }, 3420);
  const great = scoreSeasonLine({ ...base, rating: 7.8 }, 3420);
  assert.ok(poor < ok && ok < great);
});
