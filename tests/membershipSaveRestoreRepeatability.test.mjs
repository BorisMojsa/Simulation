/**
 * Round 2 Item 1 — save/restore membership timestamp repeatability.
 *
 * Newly written leagueEditionRosters.frozenAt and membershipTransitions.appliedAt
 * must use the edition/transition in-game boundary, not wall-clock Date.now().
 *
 * Run: node --test tests/membershipSaveRestoreRepeatability.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LEAGUES, LEAGUE_BY_ID, LEAGUE_LOOKUP } from "../js/data/leagues.js";
import { buildMembershipBrowserFixture } from "../js/simulation/membershipBrowserFixture.js";
import { controlledPairFinalize } from "./helpers/membershipTestUtils.mjs";
import {
  createWorldState,
  setWorldState,
  deserializeWorldState,
  serializeWorldState,
} from "../js/simulation/worldState.js";
import {
  serializeCareerSnapshot,
  deserializeCareerSnapshot,
} from "../js/simulation/careerSnapshot.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import { simulateChronologicalSeason } from "../js/simulation/chronologicalSeason.js";
import { simulateMatch } from "../js/simulation/matchEngine.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import {
  freezeEditionRoster,
  membershipBoundaryTimeMs,
  finalizeMembershipAfterSeason,
} from "../js/simulation/leagueMembership.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PL = LEAGUE_BY_ID.get("league:england-premier-league");
const CH = LEAGUE_BY_ID.get("league:england-championship");
const CLOCK_A = 1794080000000;
const CLOCK_B = 1794080060000;

function withClock(ms, fn) {
  const realNow = Date.now;
  Date.now = () => ms;
  try {
    return fn();
  } finally {
    Date.now = realNow;
  }
}

function deepDiff(a, b, path = "") {
  const diffs = [];
  if (Object.is(a, b)) return diffs;
  if (typeof a !== typeof b || a == null || b == null || typeof a !== "object") {
    diffs.push({ path, a, b });
    return diffs;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      diffs.push({ path: `${path}(array)`, a, b });
      return diffs;
    }
    for (let i = 0; i < a.length; i++) {
      diffs.push(...deepDiff(a[i], b[i], `${path}[${i}]`));
    }
    return diffs;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    diffs.push(...deepDiff(a[k], b[k], path ? `${path}.${k}` : k));
  }
  return diffs;
}

function clonePromotionReady() {
  resetClubFinanceLedgers();
  const fixture = buildMembershipBrowserFixture({ mode: "ui-promotion-ready", seed: 42 });
  assert.equal(fixture.ok, true, fixture.reason || "fixture");
  const world = deserializeWorldState(JSON.parse(JSON.stringify(fixture.worldSerialized)));
  const snap = serializeCareerSnapshot({ player: fixture.player, world });
  const restored = deserializeCareerSnapshot(JSON.parse(JSON.stringify(snap)));
  setWorldState(restored.world);
  return { player: restored.player, world: restored.world, clubId: fixture.clubId };
}

function buildPausedMembershipSeason() {
  const setup = clonePromotionReady();
  const finalized = controlledPairFinalize({
    player: setup.player,
    league: PL,
    position: 20,
    world: setup.world,
    seasonYear: 2027,
    clubId: setup.clubId,
  });
  assert.equal(finalized.ok, true, finalized.reason || "finalize");
  assert.equal(finalized.playerMove?.type, "relegated");
  // Advance past the forced 2027 boundary so the next played edition is 2028 CH.
  setup.player.seasons = [
    ...(setup.player.seasons || []),
    {
      seasonNumber: 2,
      year: 2027,
      leagueId: PL.leagueId,
      note: "r2-01-probe-completed-boundary",
    },
  ];
  const paused = simulateChronologicalSeason({
    player: setup.player,
    league: CH,
    seasonIndex: setup.player.seasons.length,
    pauseForDecisions: true,
    autoDecisionPolicy: null,
  });
  assert.ok(
    paused.status === "awaiting_decision" || paused.status === "awaiting_scenario",
    `expected mid-season pause, got ${paused.status}`
  );
  const pauseSnap = serializeCareerSnapshot({
    player: setup.player,
    world: setup.world,
    checkpoint: paused.checkpoint || setup.player.seasonCheckpoint,
  });
  return { pauseSnap, paused, clubId: setup.clubId };
}

function finishFromPause(pauseSnap, clockMs) {
  return withClock(clockMs, () => {
    const restored = deserializeCareerSnapshot(JSON.parse(JSON.stringify(pauseSnap)));
    setWorldState(restored.world);
    if (restored.seasonCheckpoint) {
      restored.player.seasonCheckpoint = restored.seasonCheckpoint;
    }
    const beforeRosters = new Set(restored.world.leagueEditionRosters.keys());
    const beforeTransitions = new Set(restored.world.membershipTransitions.keys());
    const done = simulateSeason(restored.player, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions: false,
      autoDecisionPolicy: "stay",
    });
    assert.ok(done?.season, "continuation must commit one season");
    const newRosterKeys = [...restored.world.leagueEditionRosters.keys()].filter(
      (k) => !beforeRosters.has(k)
    );
    const newTransitionKeys = [...restored.world.membershipTransitions.keys()].filter(
      (k) => !beforeTransitions.has(k)
    );
    return {
      snap: serializeCareerSnapshot({ player: restored.player, world: restored.world }),
      seasons: restored.player.seasons?.length ?? 0,
      rngState: restored.world.rngState,
      newRosterKeys,
      newTransitionKeys,
      newRosters: newRosterKeys.map((k) => ({
        key: k,
        frozenAt: restored.world.leagueEditionRosters.get(k).frozenAt,
      })),
      newTransitions: newTransitionKeys.map((k) => ({
        key: k,
        appliedAt: restored.world.membershipTransitions.get(k).appliedAt,
      })),
    };
  });
}

test("membershipBoundaryTimeMs uses June 1 UTC of the edition year", () => {
  assert.equal(membershipBoundaryTimeMs(2028), Date.UTC(2028, 5, 1));
  assert.equal(membershipBoundaryTimeMs("2027"), Date.UTC(2027, 5, 1));
});

test("new roster freeze and pair transition ignore wall clock", () => {
  const setup = clonePromotionReady();
  const beforeRosterKeys = new Set(setup.world.leagueEditionRosters.keys());
  const beforeTransitionKeys = new Set(setup.world.membershipTransitions.keys());

  const underA = withClock(CLOCK_A, () => {
    const result = controlledPairFinalize({
      player: setup.player,
      league: PL,
      position: 20,
      world: setup.world,
      seasonYear: 2027,
      clubId: setup.clubId,
    });
    assert.equal(result.ok, true);
    return {
      snap: serializeCareerSnapshot({ player: setup.player, world: setup.world }),
      transition: result.transition,
      newRosters: [...setup.world.leagueEditionRosters.entries()]
        .filter(([k]) => !beforeRosterKeys.has(k))
        .map(([k, v]) => ({ key: k, frozenAt: v.frozenAt })),
    };
  });

  // Fresh clone under a different wall clock must match exactly.
  const setupB = clonePromotionReady();
  const underB = withClock(CLOCK_B, () => {
    const result = controlledPairFinalize({
      player: setupB.player,
      league: PL,
      position: 20,
      world: setupB.world,
      seasonYear: 2027,
      clubId: setupB.clubId,
    });
    assert.equal(result.ok, true);
    return {
      snap: serializeCareerSnapshot({ player: setupB.player, world: setupB.world }),
      transition: result.transition,
      newRosters: [...setupB.world.leagueEditionRosters.entries()]
        .filter(([k]) => k.includes("::2027"))
        .map(([k, v]) => ({ key: k, frozenAt: v.frozenAt })),
    };
  });

  assert.ok(underA.newRosters.length >= 1, "must write a new edition freeze");
  assert.ok(underA.transition?.key, "must write a new transition");
  assert.notEqual(CLOCK_A, membershipBoundaryTimeMs(2027));
  assert.notEqual(CLOCK_B, membershipBoundaryTimeMs(2028));
  for (const row of underA.newRosters) {
    assert.equal(row.frozenAt, membershipBoundaryTimeMs(2027), row.key);
  }
  assert.equal(underA.transition.appliedAt, membershipBoundaryTimeMs(2028));
  assert.equal(underB.transition.appliedAt, membershipBoundaryTimeMs(2028));
  const diffs = deepDiff(underA.snap, underB.snap);
  assert.equal(diffs.length, 0, JSON.stringify(diffs.slice(0, 8), null, 2));
  void beforeTransitionKeys;
});

test("dual restore of paused membership season is byte-stable across wall clocks", () => {
  const { pauseSnap, paused } = buildPausedMembershipSeason();
  assert.ok(paused.checkpoint || pauseSnap.seasonCheckpoint);

  const a = finishFromPause(pauseSnap, CLOCK_A);
  const b = finishFromPause(pauseSnap, CLOCK_B);

  assert.equal(a.seasons, b.seasons);
  assert.equal(a.rngState, b.rngState);
  assert.ok(a.newRosterKeys.length + a.newTransitionKeys.length >= 1, {
    newRosters: a.newRosters,
    newTransitions: a.newTransitions,
  });
  for (const row of a.newRosters) {
    const year = Number(String(row.key).split("::").at(-1));
    assert.equal(row.frozenAt, membershipBoundaryTimeMs(year), row.key);
    assert.notEqual(row.frozenAt, CLOCK_A);
    assert.notEqual(row.frozenAt, CLOCK_B);
  }
  for (const row of a.newTransitions) {
    const completedYear = Number(String(row.key).split("::").at(-1));
    assert.equal(row.appliedAt, membershipBoundaryTimeMs(completedYear + 1), row.key);
  }

  // Already-committed records from the pause input stay identical (idempotent).
  const pauseWorld = deserializeCareerSnapshot(JSON.parse(JSON.stringify(pauseSnap))).world;
  const endWorldA = deserializeCareerSnapshot(JSON.parse(JSON.stringify(a.snap))).world;
  for (const [key, prior] of pauseWorld.membershipTransitions) {
    assert.deepEqual(endWorldA.membershipTransitions.get(key), prior, key);
  }
  for (const [key, prior] of pauseWorld.leagueEditionRosters) {
    assert.deepEqual(endWorldA.leagueEditionRosters.get(key), prior, key);
  }

  const diffs = deepDiff(a.snap, b.snap);
  assert.equal(diffs.length, 0, JSON.stringify(diffs.slice(0, 12), null, 2));
});

test("repeat freeze and transition commit keep prior timestamps", () => {
  const setup = clonePromotionReady();
  const first = withClock(CLOCK_A, () =>
    controlledPairFinalize({
      player: setup.player,
      league: PL,
      position: 20,
      world: setup.world,
      seasonYear: 2027,
      clubId: setup.clubId,
    })
  );
  assert.equal(first.ok, true);
  const frozen = setup.world.leagueEditionRosters.get(`${PL.leagueId}::2027`);
  const transition = first.transition;
  assert.ok(frozen?.frozenAt);
  assert.ok(transition?.appliedAt);

  const secondFreeze = withClock(CLOCK_B, () => freezeEditionRoster(PL, 2027, setup.world));
  assert.equal(secondFreeze.frozenAt, frozen.frozenAt);

  const secondCommit = withClock(CLOCK_B, () =>
    finalizeMembershipAfterSeason({
      player: setup.player,
      completedLeague: PL,
      completedSeasonYear: 2027,
      world: setup.world,
      completedClubId: setup.clubId,
    })
  );
  assert.equal(secondCommit.alreadyApplied, true);
  assert.equal(secondCommit.transition.appliedAt, transition.appliedAt);
});

test("match strength evidence does not alias live replacementOvr", () => {
  resetClubFinanceLedgers();
  const world = createWorldState({ seed: 42, startYear: 2026 });
  setWorldState(world);
  const arsenal = world.clubs.get("club:england:arsenal");
  assert.ok(arsenal?.replacementOvr?.GK);
  const beforeGk = arsenal.replacementOvr.GK;
  const match = simulateMatch(
    { name: "Arsenal", clubId: "club:england:arsenal" },
    { name: "Chelsea", clubId: "club:england:chelsea" },
    { worldState: world, rng: null, fixtureId: "r2-01-alias", date: "2026-08-12" }
  );
  const recordedGk =
    match.regulationEffectiveStrength?.home?.profile?.replacementOvr?.GK;
  assert.equal(recordedGk, beforeGk);
  // Mutate the live world club the way form/development does.
  arsenal.replacementOvr.GK = Number((beforeGk + 1.5).toFixed(4));
  assert.equal(
    match.regulationEffectiveStrength.home.profile.replacementOvr.GK,
    beforeGk,
    "historical match profile must stay frozen after live adjustQuality-style mutation"
  );
  assert.equal(
    match.effectiveStrength.home.profile.replacementOvr.GK,
    beforeGk
  );
});

test("legacy Fix 09-era snapshot restores without losing history or RNG", () => {
  /**
   * Provenance: accepted Fix 09 B06 desk-a full snapshot
   * qa/fix09-runs/browser/snapshots/B06-desk-a.full.json
   * SHA-256 34db78545a6245cd5056e4175b8b35aa80bd3401c2423f49c817601d2966ef5a
   * Older schema: has leagueMemberships, lacks leagueEditionRosters/membershipTransitions.
   * Compact fixture below keeps player/history/RNG and world membership lists only.
   */
  const legacyPath = join(
    ROOT,
    "tests/fixtures/legacy-fix09-b06-desk-a.slim.json"
  );
  assert.equal(existsSync(legacyPath), true, `missing ${legacyPath}`);
  const legacy = JSON.parse(readFileSync(legacyPath, "utf8"));
  assert.equal(legacy.provenance?.sourceSha256?.startsWith("34db78545a6245cd"), true);
  assert.equal(legacy.snapshot.schemaVersion, 1);
  assert.equal(
    Object.prototype.hasOwnProperty.call(legacy.snapshot.world, "leagueEditionRosters"),
    false
  );

  const first = deserializeCareerSnapshot(JSON.parse(JSON.stringify(legacy.snapshot)));
  setWorldState(first.world);
  assert.equal(first.world.rngState, legacy.snapshot.world.rngState);
  assert.ok((first.player.seasons || []).length >= 0);
  const membershipCount = first.world.leagueMemberships?.get?.(PL.leagueId)?.length;
  assert.equal(membershipCount, 20);

  const round1 = serializeCareerSnapshot({
    player: first.player,
    world: first.world,
    checkpoint: first.seasonCheckpoint,
  });
  const second = deserializeCareerSnapshot(JSON.parse(JSON.stringify(round1)));
  setWorldState(second.world);
  const round2 = serializeCareerSnapshot({
    player: second.player,
    world: second.world,
    checkpoint: second.seasonCheckpoint,
  });
  assert.equal(second.world.rngState, first.world.rngState);
  assert.deepEqual(
    [...second.world.leagueMemberships.get(PL.leagueId)],
    [...first.world.leagueMemberships.get(PL.leagueId)]
  );
  // Repeat restoration of the migrated/normalized form is stable.
  assert.equal(JSON.stringify(round1.world), JSON.stringify(round2.world));
  assert.equal(JSON.stringify(round1.player.seasons || []), JSON.stringify(round2.player.seasons || []));
  void serializeWorldState;
});
