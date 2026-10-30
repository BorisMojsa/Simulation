/**
 * Performance-driven awards + season evidence.
 * Run: node tests/individualAwards.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createEmptyLedger, recordMatchObservation } from "../js/simulation/playerSeasonLedger.js";
import { createStreamRng } from "../js/simulation/rng.js";
import {
  buildSeasonEvidence,
  estimateHealthyTrainingDetail,
  estimateHealthyTrainingFraction,
} from "../js/simulation/seasonEvidence.js";
import {
  evaluateSeasonAwards,
  ensureCompetitionAwardField,
  awardRecordsToLegacyNames,
  simulateIndividualAwards,
} from "../js/simulation/individualAwards.js";

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

const SEASON = "s1";
const EDITION = `${SEASON}:league`; // default league edition id when no league object is supplied

/** Ledger with `leagueApps` league matches (goals spread evenly) and optional cup matches. */
function buildLedger({ leagueApps = 30, leagueGoals = 0, cupApps = 0, cupGoals = 0, rating = 7, assists = 0 } = {}) {
  const ledger = createEmptyLedger(SEASON);
  for (let i = 0; i < leagueApps; i++) {
    recordMatchObservation(ledger, {
      matchId: `L${i}`,
      competitionType: "league",
      minutes: 90,
      started: true,
      goals: Math.floor(leagueGoals / leagueApps) + (i < leagueGoals % leagueApps ? 1 : 0),
      assists: Math.floor(assists / leagueApps) + (i < assists % leagueApps ? 1 : 0),
      rating,
      expectedRating: 6.5,
    });
  }
  for (let i = 0; i < cupApps; i++) {
    recordMatchObservation(ledger, {
      matchId: `C${i}`,
      competitionType: "cup",
      minutes: 90,
      started: true,
      goals: Math.floor(cupGoals / cupApps) + (i < cupGoals % cupApps ? 1 : 0),
      rating,
      expectedRating: 6.5,
    });
  }
  return ledger;
}

function makePlayer({ name = "Hero", position = "ST", rating = 70, seasons = [], club = "Test FC" } = {}) {
  return {
    name,
    position,
    rating,
    age: 25,
    careerId: `career:${name}`,
    club: { name: club, clubId: `club:${club}` },
    seasons,
    health: { activeInjury: null, injuryHistory: [] },
  };
}

function rival(i, over = {}) {
  const group = over.group || ["GK", "DEF", "MID", "FWD"][i % 4];
  return {
    id: `rival:${i}`,
    name: `Rival ${i}`,
    club: `Club ${i}`,
    position: group === "FWD" ? "ST" : group === "MID" ? "CM" : group === "DEF" ? "CB" : "GK",
    group,
    age: 28,
    minutes: 3000,
    matches: 33,
    goals: group === "FWD" ? 4 + (i % 7) : group === "MID" ? 2 + (i % 4) : 0,
    assists: 2 + (i % 5),
    cleanSheets: group === "GK" || group === "DEF" ? 8 + (i % 4) : 0,
    rating: 6.4 + (i % 5) * 0.1,
    teamPpg: 1.4,
    priorSeniorMinutes: 9000,
    ...over,
  };
}

function installField(player, rivals) {
  player.awardFields = {
    [EDITION]: {
      version: 1,
      editionId: EDITION,
      scope: "league",
      seasonId: SEASON,
      possibleMinutes: 3420,
      rivals,
    },
  };
}

function baseRivals(extra = []) {
  return [...Array.from({ length: 24 }, (_, i) => rival(i)), ...extra];
}

const STANDING = { position: 3, played: 38, points: 70, goalsFor: 70, goalsAgainst: 40 };

function run(player, ledgerOpts, { rivals, evidenceCtx = {}, seasonStartAge = 25, options, standing = STANDING, seed = "seed" } = {}) {
  // Pass rivals explicitly — fingerprint lifecycle no longer reuses incomplete
  // install-only caches when evaluate would otherwise regenerate the field.
  if (rivals) installField(player, rivals);
  const evidence = buildSeasonEvidence(player, {
    seasonId: SEASON,
    ledger: buildLedger(ledgerOpts),
    standing,
    seasonStartAge,
    ...evidenceCtx,
  });
  return evaluateSeasonAwards({
    player,
    evidence,
    standing,
    trophies: [],
    rng: createStreamRng("test", seed),
    seasonId: SEASON,
    seasonStartAge,
    options,
    rivals: rivals ? { version: 2, possibleMinutes: 3420, rivals } : undefined,
  });
}

const find = (res, awardId) => res.records.find((r) => r.awardId === awardId);

/* ------------------------------------------------------------------ */

test("low-OVR top scorer wins Golden Boot", () => {
  const p = makePlayer({ rating: 52 });
  const res = run(p, { leagueGoals: 22 }, { rivals: baseRivals([rival(100, { group: "FWD", goals: 20 })]) });
  const gb = find(res, "golden-boot");
  assert.equal(gb.status, "won");
  assert.equal(gb.evidence.goals, 22);
  assert.equal(gb.shared, false);
  assert.ok(res.awardNames.includes("Golden Boot"));
});

test("high-OVR non-leader does not win Golden Boot", () => {
  const p = makePlayer({ rating: 91 });
  const res = run(p, { leagueGoals: 15 }, { rivals: baseRivals([rival(100, { group: "FWD", goals: 20 })]) });
  const gb = find(res, "golden-boot");
  assert.ok(!gb || gb.status !== "won");
  assert.ok(!res.awardNames.includes("Golden Boot"));
});

test("Golden Boot ties are shared", () => {
  const p = makePlayer({ rating: 60 });
  const res = run(p, { leagueGoals: 20 }, { rivals: baseRivals([rival(100, { group: "FWD", goals: 20 }), rival(101, { group: "MID", goals: 11 })]) });
  const gb = find(res, "golden-boot");
  assert.equal(gb.status, "won");
  assert.equal(gb.shared, true);
  assert.equal(gb.rank, 1);
  assert.deepEqual(gb.evidence.tiedWith, ["Rival 100"]);
});

test("cup goals do not count for the league Golden Boot", () => {
  const p = makePlayer();
  const res = run(p, { leagueApps: 30, leagueGoals: 10, cupApps: 6, cupGoals: 16 }, { rivals: baseRivals([rival(100, { group: "FWD", goals: 14 })]) });
  const gb = find(res, "golden-boot");
  assert.ok(!gb || gb.status !== "won");
  const ev = buildSeasonEvidence(p, { seasonId: SEASON, ledger: buildLedger({ leagueGoals: 10, cupApps: 6, cupGoals: 16 }) });
  assert.equal(ev.goalsByCompetition.league, 10);
  assert.equal(ev.goalsByCompetition.cup, 16);
  // ...but a cup Golden Boot over the cup edition would be a separate scope
  assert.equal(ev.total.goals, 26);
});

test("one player can win Golden Boot + Player of the Season + Team of the Season", () => {
  const p = makePlayer({ rating: 70 });
  const league = {
    name: "Test League",
    leagueId: "test-league",
    tier: 4,
    clubs: Array.from({ length: 20 }, (_, i) => ({ name: i === 0 ? "Test FC" : `Club ${i}`, clubId: i === 0 ? "club:Test FC" : `club:${i}`, overall: 70 + (i % 5) })),
  };
  const standing = { name: "Test FC", clubId: "club:Test FC", position: 1, played: 38, points: 92, goalsFor: 88, goalsAgainst: 28 };
  const evidence = buildSeasonEvidence(p, {
    seasonId: SEASON,
    ledger: buildLedger({ leagueApps: 36, leagueGoals: 40, assists: 12, rating: 8.1 }),
    standing,
    league,
    seasonStartAge: 27,
  });
  const res = evaluateSeasonAwards({ player: p, evidence, standing, league, rng: createStreamRng("t", "x"), seasonId: SEASON, seasonStartAge: 27 });
  assert.equal(res.byAward["golden-boot"].status, "won");
  assert.equal(res.byAward["player-of-the-season"].status, "won");
  assert.equal(res.byAward["team-of-the-season"].status, "selected");
  assert.ok(["Golden Boot", "Player of the Season", "Team of the Season"].every((n) => res.awardNames.includes(n)));
  assert.equal(new Set(res.records.map((r) => r.eventId)).size, res.records.length);
});

test("World Player of the Year does not suppress other awards", () => {
  const p = makePlayer();
  // Great enough that WPOY may or may not trigger: either way GB/POTS/TOTS must still be present.
  const league = { name: "Elite League", leagueId: "elite", tier: 5, clubs: Array.from({ length: 20 }, (_, i) => ({ name: i === 0 ? "Test FC" : `E${i}`, clubId: i === 0 ? "club:Test FC" : `e${i}`, overall: 86 })) };
  const standing = { name: "Test FC", clubId: "club:Test FC", position: 1, played: 38, points: 98, goalsFor: 95, goalsAgainst: 24 };
  const evidence = buildSeasonEvidence(p, {
    seasonId: SEASON,
    ledger: buildLedger({ leagueApps: 38, leagueGoals: 45, assists: 18, rating: 8.6 }),
    standing,
    league,
    clubOverall: 90,
    trophies: [{ kind: "continental", label: "UCL Winners", competition: "UCL" }],
    ledgerMatches: undefined,
    seasonStartAge: 26,
  });
  const res = evaluateSeasonAwards({ player: p, evidence, standing, league, rng: createStreamRng("w", "1"), seasonId: SEASON, seasonStartAge: 26 });
  for (const id of ["golden-boot", "player-of-the-season", "team-of-the-season"]) assert.ok(res.byAward[id], id);
  const wp = res.byAward["world-player-of-the-year"];
  if (wp) assert.equal(wp.competitionScope, "world");
});

test("keepers can win Golden Glove and the Team of the Season GK slot", () => {
  const p = makePlayer({ name: "Keeper", position: "GK", rating: 66 });
  const res = run(p, { leagueApps: 37, rating: 7.4 }, {
    rivals: baseRivals([rival(100, { group: "GK", cleanSheets: 14, rating: 7.0 }), rival(101, { group: "GK", cleanSheets: 13, rating: 6.9 })]),
    evidenceCtx: { cleanSheetsByScope: { league: 18 } },
  });
  const gg = find(res, "golden-glove");
  assert.equal(gg.status, "won");
  assert.equal(gg.evidence.cleanSheets, 18);
  const tots = find(res, "team-of-the-season");
  assert.equal(tots.status, "selected");
  assert.equal(tots.evidence.roleGroup, "GK");
  assert.equal(tots.rank, 1);
});

test("Golden Glove needs participation and does not go to outfield players", () => {
  const sub = makePlayer({ name: "Backup", position: "GK" });
  const res = run(sub, { leagueApps: 8, rating: 7.5 }, {
    rivals: baseRivals([rival(100, { group: "GK", cleanSheets: 10 })]),
    evidenceCtx: { cleanSheetsByScope: { league: 7 } },
  });
  assert.ok(!find(res, "golden-glove"));
  const fw = makePlayer();
  const res2 = run(fw, { leagueGoals: 20 }, { rivals: baseRivals(), evidenceCtx: { cleanSheetsByScope: { league: 30 } } });
  assert.ok(!find(res2, "golden-glove"));
});

test("Young Player eligibility uses age at season start", () => {
  const rivals = baseRivals([rival(100, { age: 20 }), rival(101, { age: 21, group: "FWD", goals: 6 })]);
  const young = run(makePlayer({ name: "Kid" }), { leagueGoals: 18, rating: 7.9, assists: 8 }, { rivals, seasonStartAge: 23 });
  assert.equal(find(young, "young-player-of-the-season")?.status, "won");
  const older = run(makePlayer({ name: "Kid2" }), { leagueGoals: 18, rating: 7.9, assists: 8 }, { rivals, seasonStartAge: 24 });
  assert.ok(!find(older, "young-player-of-the-season"));
  const custom = run(makePlayer({ name: "Kid3" }), { leagueGoals: 18, rating: 7.9, assists: 8 }, { rivals, seasonStartAge: 24, options: { youthMaxAge: 24 } });
  assert.equal(find(custom, "young-player-of-the-season")?.status, "won");
});

test("Breakthrough: first substantial senior season; club moves do not reset it", () => {
  const stats = { leagueApps: 32, leagueGoals: 16, assists: 9, rating: 7.8 };
  const fresh = makePlayer({ name: "Newbie", seasons: [{ seasonId: "s0", minutes: 300, club: "Old FC" }] });
  const res = run(fresh, stats, { rivals: baseRivals(), seasonStartAge: 21 });
  assert.equal(find(res, "rookie-of-the-season")?.status, "won");

  const veteranMover = makePlayer({
    name: "Mover",
    club: "New FC",
    seasons: [{ seasonId: "s0", minutes: 2700, club: "Old FC" }, { seasonId: "s-1", minutes: 1500, club: "Older FC" }],
  });
  const res2 = run(veteranMover, stats, { rivals: baseRivals(), seasonStartAge: 21 });
  assert.ok(!find(res2, "rookie-of-the-season"));

  const academyOnly = makePlayer({ name: "Acad", seasons: [{ seasonId: "s0", minutes: 2500, academy: true }] });
  const res3 = run(academyOnly, stats, { rivals: baseRivals(), seasonStartAge: 18 });
  assert.equal(find(res3, "rookie-of-the-season")?.status, "won");
});

test("nominations are separate from selections and wins, and stay out of legacy names", () => {
  const p = makePlayer();
  const res = run(p, { leagueGoals: 19 }, { rivals: baseRivals([rival(100, { group: "FWD", goals: 22 })]) });
  const gb = find(res, "golden-boot");
  assert.equal(gb.status, "nominated");
  assert.ok(!res.awardNames.includes("Golden Boot"));
  assert.ok(awardRecordsToLegacyNames(res.records, { includeNominations: true }).includes("Golden Boot (nominee)"));
  assert.ok(res.nominations.some((r) => r.awardId === "golden-boot"));
});

test("record shape and stable event ids", () => {
  const p1 = makePlayer();
  const r1 = run(p1, { leagueGoals: 22 }, { rivals: baseRivals() });
  const rec = find(r1, "golden-boot");
  for (const k of ["awardId", "label", "competitionEditionId", "competitionScope", "playerId", "status", "rank", "shared", "evidence", "eventId"]) {
    assert.ok(k in rec, k);
  }
  assert.equal(rec.competitionEditionId, EDITION);
  assert.equal(rec.eventId, `award:${SEASON}:golden-boot:${EDITION}:${rec.playerId}`);
  const p2 = makePlayer();
  const r2 = run(p2, { leagueGoals: 22 }, { rivals: baseRivals() });
  assert.equal(find(r2, "golden-boot").eventId, rec.eventId);
});

test("deterministic with the same seed (including generated competitor field)", () => {
  const league = { name: "L", leagueId: "l", tier: 3, clubs: Array.from({ length: 18 }, (_, i) => ({ name: i === 0 ? "Test FC" : `C${i}`, clubId: i === 0 ? "club:Test FC" : `c${i}`, overall: 70 })) };
  const go = (seed) => {
    const p = makePlayer({ name: "Det" });
    const standing = { name: "Test FC", clubId: "club:Test FC", position: 4, played: 34, points: 60, goalsFor: 55, goalsAgainst: 40 };
    const evidence = buildSeasonEvidence(p, { seasonId: SEASON, ledger: buildLedger({ leagueApps: 30, leagueGoals: 12 }), standing, league, seasonStartAge: 25 });
    const res = evaluateSeasonAwards({ player: p, evidence, standing, league, rng: createStreamRng("det", seed), seasonId: SEASON, seasonStartAge: 25 });
    return { res: JSON.stringify(res.records), field: JSON.stringify(p.awardFields) };
  };
  const a = go("A");
  const b = go("A");
  assert.equal(a.res, b.res);
  assert.equal(a.field, b.field);
  assert.notEqual(go("B").field, a.field);
});

test("competitor field is persisted, consistent with team goals, and fingerprint-stable", () => {
  const p = makePlayer();
  const league = { name: "L", leagueId: "l", tier: 3, clubs: Array.from({ length: 12 }, (_, i) => ({ name: i === 0 ? "Test FC" : `C${i}`, clubId: i === 0 ? "club:Test FC" : `c${i}`, overall: 70 })) };
  const table = league.clubs.map((c, i) => ({ name: c.name, clubId: c.clubId, played: 22, goalsFor: 30 + i * 3, goalsAgainst: 25, points: 30 + i, position: i + 1 }));
  const ctx = { seasonId: SEASON, competitionEditionId: "ed1", table, league, userClub: { name: "Test FC", clubId: "club:Test FC" }, user: { goals: 10, assists: 4, position: "ST" } };
  const rng = createStreamRng("f", "1");
  const field = ensureCompetitionAwardField(p, ctx, rng);
  assert.equal(p.awardFields.ed1, field);
  assert.equal(field.stage, "final");
  assert.ok(field.inputFingerprint);
  // Identical fingerprint: idempotent reuse.
  assert.equal(ensureCompetitionAwardField(p, ctx, createStreamRng("other", "seed")), field);
  // Changed user contributions: must refresh (R3) — not lock unfinished/wrong inputs.
  const refreshed = ensureCompetitionAwardField(p, { ...ctx, user: { goals: 99, assists: 99, position: "GK" } }, createStreamRng("other", "seed"));
  assert.notEqual(refreshed, field);
  assert.equal(refreshed.userContext.goals, 99);
  const byClub = new Map();
  for (const r of field.rivals) byClub.set(r.club, (byClub.get(r.club) || 0) + r.goals);
  for (const row of table) assert.ok((byClub.get(row.name) || 0) <= row.goalsFor, `${row.name} rival goals within team total`);
  const own = field.rivals.filter((r) => r.club === "Test FC").reduce((s, r) => s + r.goals, 0);
  assert.ok(own + 10 <= table[0].goalsFor);
  assert.deepEqual(JSON.parse(JSON.stringify(p.awardFields)), p.awardFields); // plain JSON, save-safe
});

test("field generation does not depend on the user's season outcome", () => {
  const league = { name: "L", leagueId: "l", tier: 3, clubs: Array.from({ length: 12 }, (_, i) => ({ name: `C${i}`, clubId: `c${i}`, overall: 70 })) };
  const table = league.clubs.map((c, i) => ({ name: c.name, clubId: c.clubId, played: 22, goalsFor: 30 + i, goalsAgainst: 25, points: 30 + i, position: i + 1 }));
  const mk = (goals) => {
    const p = makePlayer();
    p.club = { name: "C5", clubId: "c5" };
    const f = ensureCompetitionAwardField(p, { seasonId: SEASON, competitionEditionId: "e", table, league, user: { goals, assists: 0, position: "ST" } }, createStreamRng("same", "seed"));
    return f.rivals.filter((r) => r.club !== "C5");
  };
  // Retention sets may differ after post-adjust category selection, but every shared
  // opponent id must keep identical generated lines (other clubs are user-independent).
  const a = mk(0);
  const b = mk(25);
  const A = new Map(a.map((r) => [r.id, r]));
  const B = new Map(b.map((r) => [r.id, r]));
  const shared = [...A.keys()].filter((id) => B.has(id));
  assert.ok(shared.length >= 8, `expected shared opponents, got ${shared.length}`);
  for (const id of shared) assert.deepEqual(A.get(id), B.get(id));
});

test("evaluation does not consume the caller's rng stream", () => {
  const rng = createStreamRng("keep", "me");
  const before = rng.seed();
  run(makePlayer(), { leagueGoals: 10 }, { rivals: baseRivals() });
  const rng2 = createStreamRng("keep", "me");
  const p = makePlayer();
  installField(p, baseRivals());
  evaluateSeasonAwards({ player: p, evidence: buildSeasonEvidence(p, { seasonId: SEASON, ledger: buildLedger({ leagueGoals: 10 }) }), rng: rng2, seasonId: SEASON });
  assert.equal(rng2.seed(), before);
});

test("individualAwards.js has no Math.random", () => {
  for (const f of ["../js/simulation/individualAwards.js", "../js/simulation/seasonEvidence.js"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.ok(!/Math\.random/.test(src), `${f} must not use Math.random`);
  }
});

test("simulateIndividualAwards wrapper returns UI names (options and legacy forms)", () => {
  const p = makePlayer();
  const rivals = baseRivals([rival(100, { group: "FWD", goals: 12 })]);
  const evidence = buildSeasonEvidence(p, { seasonId: SEASON, ledger: buildLedger({ leagueGoals: 20 }), seasonStartAge: 25 });
  const names = simulateIndividualAwards({
    player: p,
    evidence,
    rng: createStreamRng("w", "a"),
    seasonId: SEASON,
    rivals: { version: 2, possibleMinutes: 3420, rivals },
  });
  assert.ok(Array.isArray(names));
  assert.ok(names.includes("Golden Boot"));
  assert.ok(names.records.length >= 1);

  const legacyPlayer = makePlayer({ name: "Legacy" });
  const legacy = simulateIndividualAwards(60, { goals: 3, assists: 1, cleanSheets: 0, matches: 20, league: "Nowhere" }, legacyPlayer, new Map(), { seasonId: "leg" });
  assert.ok(Array.isArray(legacy));
  const legacy2 = simulateIndividualAwards(60, { goals: 3, assists: 1, cleanSheets: 0, matches: 20, league: "Nowhere" }, makePlayer({ name: "Legacy" }), new Map(), { seasonId: "leg" });
  assert.deepEqual([...legacy], [...legacy2]);
});

/* ---------------- season evidence ---------------- */

test("evidence: volume, seasonP vs reliability, shrinkage and recognition placeholders", () => {
  const p = makePlayer();
  const ev = buildSeasonEvidence(p, { seasonId: SEASON, ledger: buildLedger({ leagueApps: 20, leagueGoals: 8, cupApps: 2, cupGoals: 1, rating: 7.4 }), standing: { position: 2, played: 38, points: 80 }, seasonStartAge: 24 });
  assert.equal(ev.appearances, 22);
  assert.equal(ev.starts, 22);
  assert.equal(ev.minutes, 1980);
  assert.equal(ev.ratedMinutes, 1980);
  assert.ok(Math.abs(ev.minutesWeightedRating - 7.4) < 1e-9);
  assert.ok(ev.seasonP > 0);
  assert.ok(ev.reliability > 0 && ev.reliability < 1);
  assert.ok(Math.abs(ev.sampleSizeShrinkage.shrunkSeasonP - ev.seasonP * ev.reliability) < 1e-12);
  assert.equal(ev.goalsByCompetition.league, 8);
  assert.equal(ev.cleanSheetsByCompetition.league, null); // unknown is not invented
  assert.deepEqual(ev.recognition, []);
  assert.ok(Object.isFrozen(ev));
  assert.ok(Object.isFrozen(ev.byScope));
  assert.ok(!("tackles" in ev) && !("xG" in ev));
  const empty = buildSeasonEvidence(p, { seasonId: SEASON, ledger: createEmptyLedger(SEASON) });
  assert.equal(empty.seasonP, null);
  assert.equal(empty.minutes, 0);
});

test("evidence: trophies carry participationWeight from minutes", () => {
  const p = makePlayer();
  const ev = buildSeasonEvidence(p, {
    seasonId: SEASON,
    ledger: buildLedger({ leagueApps: 10, cupApps: 4 }),
    trophies: [{ kind: "cup", label: "Cup Winners", competition: "Cup" }, { kind: "league", label: "Champions" }],
    competitionEditions: [{ editionId: "cup-ed", scope: "cup", name: "Cup", teamMatches: 6 }],
  });
  const cup = ev.trophies.find((t) => t.scope === "cup");
  assert.equal(cup.editionId, "cup-ed");
  assert.ok(Math.abs(cup.participationWeight - 360 / 540) < 1e-3);
  assert.equal(cup.participationBasis, "team-matches");
  const league = ev.trophies.find((t) => t.scope === "league");
  assert.equal(league.participationBasis, "saturating-proxy");
});

test("healthy training fraction: dated overlap, fallbacks, active flag is only partial", () => {
  const start = "2025-08-01T00:00:00Z";
  const end = "2026-05-31T00:00:00Z"; // 303 days
  const day = (iso) => Date.parse(iso) / 86400000;
  const health = {
    activeInjury: null,
    injuryHistory: [
      { eventId: "a", date: "2025-09-01T00:00:00Z", startDay: day("2025-09-01T00:00:00Z"), durationDays: 30, recoveredDay: day("2025-10-01T00:00:00Z") },
      { eventId: "b", date: "2025-09-15T00:00:00Z", startDay: day("2025-09-15T00:00:00Z"), durationDays: 30, expectedReturnDay: day("2025-10-15T00:00:00Z") }, // overlaps a
      { eventId: "c", date: "2025-07-10T00:00:00Z", startDay: day("2025-07-10T00:00:00Z"), durationDays: 40, expectedReturnDay: day("2025-08-19T00:00:00Z") }, // 18 days inside
    ],
  };
  const r = estimateHealthyTrainingDetail({ health, seasonStartDate: start, seasonEndDate: end });
  assert.equal(r.method, "dated-overlap");
  assert.ok(Math.abs(r.injuredDays - (44 + 18)) < 1e-6, `injured days ${r.injuredDays}`);
  assert.ok(Math.abs(r.fraction - (1 - 62 / 303)) < 1e-6);

  const noWindow = estimateHealthyTrainingDetail({ health: { injuryHistory: [{ eventId: "x", durationDays: 73 }], activeInjury: null }, seasonDays: 365 });
  assert.equal(noWindow.partial, true);
  assert.ok(Math.abs(noWindow.fraction - 0.8) < 1e-9);

  const flagOnly = estimateHealthyTrainingDetail({ health: { activeInjury: { eventId: "z" }, injuryHistory: [] } });
  assert.equal(flagOnly.method, "active-flag-partial");
  assert.equal(flagOnly.partial, true);
  assert.ok(flagOnly.fraction < 1 && flagOnly.fraction > 0.8);

  // An active injury is clipped to the season window.
  const active = estimateHealthyTrainingDetail({
    health: { activeInjury: { eventId: "y", startDay: day("2026-05-01T00:00:00Z"), durationDays: 90, expectedReturnDay: day("2026-07-30T00:00:00Z") }, injuryHistory: [] },
    seasonStartDate: start,
    seasonEndDate: end,
  });
  assert.ok(Math.abs(active.injuredDays - 30) < 1e-6);

  assert.equal(estimateHealthyTrainingDetail({ health: { activeInjury: null, injuryHistory: [] }, seasonStartDate: start, seasonEndDate: end }).fraction, 1);

  // Numeric API used by development: same estimate, floored so a lost season still trains a little.
  assert.equal(estimateHealthyTrainingFraction({ health: { activeInjury: null, injuryHistory: [] } }), 1);
  const heavy = estimateHealthyTrainingFraction({
    health: { injuryHistory: [{ eventId: "h", startDay: 1, expectedReturnDay: 299, durationDays: 298 }], activeInjury: null },
    seasonStartDay: 1,
    seasonEndDay: 300,
    seasonDays: 300,
  });
  assert.equal(heavy, 0.15);
});

test("evidence: competition strength and challenge are bounded", () => {
  const p = makePlayer({ rating: 60 });
  const tough = buildSeasonEvidence(p, { seasonId: SEASON, ledger: buildLedger(), clubOverall: 95, league: { overall: 92 } });
  assert.ok(tough.competitionStrength <= 1 && tough.competitionStrength > 0.9);
  assert.equal(tough.challengeRelativeToAbility, 1.4);
  const weak = buildSeasonEvidence(makePlayer({ rating: 90 }), { seasonId: SEASON, ledger: buildLedger(), clubOverall: 50, league: { overall: 48 } });
  assert.equal(weak.challengeRelativeToAbility, 0.55);
  assert.ok(weak.competitionStrength >= 0);
});
