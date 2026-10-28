/**
 * Career league-membership authority for promotion / relegation.
 *
 * Live and future editions resolve clubs from world.leagueMemberships (seeded
 * once from bundled LEAGUES). Each edition freezes its participant IDs before
 * fixtures. Season-boundary transitions exchange a shared count both ways for
 * the five modeled two-division pairs and record an idempotent transition key.
 *
 * Do not mutate global LEAGUES / lookup arrays.
 */

import { LEAGUES, LEAGUE_BY_ID } from "../data/leagues.js";
import { leagueIdFromName } from "../data/competitions/qualification.js";
import { clamp } from "../utils/helpers.js";
import {
  attachClubIdentity,
  getWorldState,
} from "./worldState.js";
import { createStreamRng, hashSeed } from "./rng.js";
import { simulateMatch } from "./matchEngine.js";
import { applyMatchFormUpdate } from "./worldState.js";
import { flattenRoundRobinFixtures, dateLeagueFixtures } from "./seasonCalendar.js?v=89";
import { rebuildTableFromMatches } from "./leagueTable.js";
import { ensureLeagueEdition, commitLeagueMatchResult } from "./leagueEditionAdapter.js";

/** Explicit shared exchange counts for the five modeled pairs (game policy). */
export const DIVISION_PAIR_POLICY = Object.freeze([
  {
    pairId: "england",
    upperId: "league:england-premier-league",
    lowerId: "league:england-championship",
    exchange: 3,
    upperCapacity: 20,
    lowerCapacity: 24,
  },
  {
    pairId: "germany",
    upperId: "league:germany-bundesliga",
    lowerId: "league:germany-2-bundesliga",
    exchange: 2,
    upperCapacity: 18,
    lowerCapacity: 18,
  },
  {
    pairId: "spain",
    upperId: "league:spain-la-liga",
    lowerId: "league:spain-laliga-2",
    exchange: 3,
    upperCapacity: 20,
    lowerCapacity: 22,
  },
  {
    pairId: "italy",
    upperId: "league:italy-serie-a",
    lowerId: "league:italy-serie-b",
    exchange: 2,
    upperCapacity: 20,
    lowerCapacity: 20,
  },
  {
    pairId: "france",
    upperId: "league:france-ligue-1",
    lowerId: "league:france-ligue-2",
    exchange: 2,
    upperCapacity: 18,
    lowerCapacity: 18,
  },
]);

const POLICY_BY_LEAGUE = new Map();
for (const p of DIVISION_PAIR_POLICY) {
  POLICY_BY_LEAGUE.set(p.upperId, { ...p, role: "upper" });
  POLICY_BY_LEAGUE.set(p.lowerId, { ...p, role: "lower" });
}

export function pairPolicyForLeague(leagueId) {
  if (!leagueId) return null;
  return POLICY_BY_LEAGUE.get(leagueId) || null;
}

export function editionRosterKey(leagueId, seasonYear) {
  return `${leagueId}::${seasonYear}`;
}

export function transitionKey(pairId, completedSeasonYear) {
  return `${pairId}::${completedSeasonYear}`;
}

function ensureMembershipMaps(world) {
  if (!world) return null;
  if (!(world.leagueMemberships instanceof Map)) {
    world.leagueMemberships = new Map(world.leagueMemberships || []);
  }
  if (!(world.leagueEditionRosters instanceof Map)) {
    world.leagueEditionRosters = new Map(world.leagueEditionRosters || []);
  }
  if (!(world.membershipTransitions instanceof Map)) {
    world.membershipTransitions = new Map(world.membershipTransitions || []);
  }
  if (!(world.membershipDiagnostics instanceof Map)) {
    world.membershipDiagnostics = new Map(world.membershipDiagnostics || []);
  }
  return world;
}

export function detectCorruptMembership(world, leagueId) {
  const policy = pairPolicyForLeague(leagueId);
  if (!world || !policy) return null;
  const ids = world.leagueMemberships?.get(leagueId);
  if (!Array.isArray(ids)) return { code: "missing-membership", leagueId };
  const expected = policy.role === "upper" ? policy.upperCapacity : policy.lowerCapacity;
  if (ids.length !== expected) {
    return {
      code: "capacity-mismatch",
      leagueId,
      actual: ids.length,
      expected,
      unsupported: true,
      note: "Corrupt 21/23 or 19/25-style membership; not auto-repaired.",
    };
  }
  const uniq = new Set(ids);
  if (uniq.size !== ids.length) {
    return { code: "duplicate-ids", leagueId, unsupported: true };
  }
  return null;
}

/** Static club catalog by id (bundled seed; never mutated). */
const STATIC_CLUB_BY_ID = new Map();
for (const league of LEAGUES) {
  for (const club of league.clubs || []) {
    if (club.clubId && !STATIC_CLUB_BY_ID.has(club.clubId)) {
      STATIC_CLUB_BY_ID.set(club.clubId, club);
    }
  }
}

export function staticClubById(clubId) {
  return STATIC_CLUB_BY_ID.get(clubId) || null;
}

export function leagueIdOf(league) {
  if (!league) return null;
  return league.leagueId || leagueIdFromName(league.name) || null;
}

/**
 * Resolve club IDs for a league edition in a career.
 * Prefer frozen edition roster; else live membership; else bundled seed.
 */
export function resolveLeagueClubIds(leagueOrId, { world = getWorldState(), seasonYear = null } = {}) {
  const leagueId = typeof leagueOrId === "string" ? leagueOrId : leagueIdOf(leagueOrId);
  if (!leagueId) return [];
  const w = ensureMembershipMaps(world);

  if (w && seasonYear != null) {
    const frozen = w.leagueEditionRosters.get(editionRosterKey(leagueId, seasonYear));
    if (frozen?.clubIds?.length) return [...frozen.clubIds];
  }

  if (w?.leagueMemberships?.has(leagueId)) {
    const live = w.leagueMemberships.get(leagueId);
    if (Array.isArray(live) && live.length) return [...live];
  }

  const bundled = LEAGUE_BY_ID.get(leagueId);
  return (bundled?.clubs || []).map((c) => c.clubId).filter(Boolean);
}

/**
 * Materialize club objects for an edition with destination league metadata.
 * Does not append missing player clubs for modeled senior leagues.
 */
export function resolveLeagueClubs(league, opts = {}) {
  if (!league) return [];
  const leagueId = leagueIdOf(league);
  const ids = resolveLeagueClubIds(leagueId, opts);
  const world = opts.world || getWorldState();
  const out = [];
  const seen = new Set();

  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const seed = staticClubById(id) || world?.clubs?.get(id);
    if (!seed) {
      throw new Error(`leagueMembership: unknown clubId ${id} for ${leagueId}`);
    }
    const profile = world?.clubs?.get(id);
    out.push(
      attachClubIdentity({
        ...seed,
        ...(profile
          ? {
              overall: profile.overall ?? seed.overall,
              attack: profile.attack ?? seed.attack,
              midfield: profile.midfield ?? seed.midfield,
              defence: profile.defence ?? seed.defence,
              goalkeeper: profile.goalkeeper ?? seed.goalkeeper,
              financialTier: seed.financialTier ?? profile.financialPower,
              reputation: seed.reputation ?? profile.reputation,
            }
          : {}),
        clubId: id,
        tier: league.tier,
        divisionLevel: league.divisionLevel ?? seed.divisionLevel,
        league: league.name,
        leagueDisplay: league.displayName ?? league.name,
        leagueId,
        nation: league.nation,
      })
    );
  }
  return out;
}

/** League object whose `.clubs` is the career/edition roster (non-mutating copy). */
export function leagueViewForEdition(league, opts = {}) {
  if (!league) return league;
  const clubs = resolveLeagueClubs(league, opts);
  return { ...league, clubs };
}

export function freezeEditionRoster(league, seasonYear, world = getWorldState()) {
  const w = ensureMembershipMaps(world);
  if (!w || !league || seasonYear == null) return null;
  const leagueId = leagueIdOf(league);
  const key = editionRosterKey(leagueId, seasonYear);
  const existing = w.leagueEditionRosters.get(key);
  if (existing?.clubIds?.length) return { ok: true, ...existing };

  const clubIds = resolveLeagueClubIds(leagueId, { world: w, seasonYear: null });
  const policy = pairPolicyForLeague(leagueId);
  if (policy) {
    const expected = policy.role === "upper" ? policy.upperCapacity : policy.lowerCapacity;
    if (clubIds.length !== expected) {
      const diag = {
        code: "freeze-capacity-mismatch",
        leagueId,
        seasonYear,
        actual: clubIds.length,
        expected,
        unsupported: true,
      };
      w.membershipDiagnostics.set(key, diag);
      return { ok: false, diagnostic: diag, clubIds };
    }
  }

  const record = {
    ok: true,
    leagueId,
    seasonYear,
    clubIds: [...clubIds],
    frozenAt: Date.now(),
  };
  w.leagueEditionRosters.set(key, record);
  return record;
}

/**
 * Shared move count for a league within its modeled pair.
 * Unpaired leagues keep the legacy size-based band for zone labels only.
 */
export function sharedMoveSlots(league, sisters = null) {
  const leagueId = leagueIdOf(league);
  const policy = pairPolicyForLeague(leagueId);
  if (policy) {
    const links = sisters || { higher: null, lower: null };
    return {
      promoteSlots: (links.higher || policy.role === "lower") ? policy.exchange : 0,
      relegateSlots: (links.lower || policy.role === "upper") ? policy.exchange : 0,
      exchange: policy.exchange,
      policy,
    };
  }
  const size = league?.clubs?.length ?? 20;
  const band = size >= 22 ? 3 : 2;
  return {
    promoteSlots: sisters?.higher ? band : 0,
    relegateSlots: sisters?.lower ? band : 0,
    exchange: band,
    policy: null,
  };
}

function tableClubIds(table) {
  return (table || []).map((r) => r.clubId).filter(Boolean);
}

function validateTableAgainstRoster(table, clubIds, label) {
  if (!Array.isArray(table) || !table.length) {
    return { ok: false, reason: `missing-table:${label}` };
  }
  const ids = tableClubIds(table);
  if (ids.length !== table.length) {
    return { ok: false, reason: `table-missing-clubIds:${label}` };
  }
  const uniq = new Set(ids);
  if (uniq.size !== ids.length) {
    return { ok: false, reason: `table-duplicate-ids:${label}` };
  }
  if (clubIds) {
    const expected = new Set(clubIds);
    if (ids.length !== expected.size) {
      return { ok: false, reason: `table-size-mismatch:${label}`, actual: ids.length, expected: expected.size };
    }
    for (const id of ids) {
      if (!expected.has(id)) {
        return { ok: false, reason: `table-foreign-club:${label}`, clubId: id };
      }
    }
  }
  // Positions must be 1..n contiguous
  const positions = table.map((r) => r.position).filter((p) => Number.isFinite(p));
  if (positions.length === table.length) {
    const sorted = [...positions].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i] !== i + 1) {
        return { ok: false, reason: `table-bad-positions:${label}` };
      }
    }
  }
  return { ok: true };
}

function sortTableRows(table) {
  return [...(table || [])]
    .map((r, i) => ({ ...r, position: r.position || i + 1 }))
    .sort((a, b) => (a.position || 0) - (b.position || 0));
}

/**
 * Build a final table from committed world matches for an edition, if complete.
 */
export function tableFromCommittedEdition(league, seasonYear, world = getWorldState()) {
  const w = ensureMembershipMaps(world);
  if (!w || !league || seasonYear == null) return null;
  const leagueId = leagueIdOf(league);
  const clubs = resolveLeagueClubs(league, { world: w, seasonYear });
  if (!clubs.length) return null;

  const matches = [];
  for (const m of w.matches?.values?.() || []) {
    if ((m.competitionId || m.leagueContextId) !== leagueId) continue;
    if (String(m.editionId) !== String(seasonYear) && m.seasonYear !== seasonYear) continue;
    if (m.status && m.status !== "played") continue;
    if (m.homeGoals == null && m.matchHomeGoals == null) continue;
    matches.push(m);
  }

  const expectedFixtures = clubs.length * (clubs.length - 1);
  if (matches.length < expectedFixtures) {
    // Also accept standings snapshot only when fixture coverage matches via ledger.
    return null;
  }

  const { table } = rebuildTableFromMatches(clubs, matches);
  return sortTableRows(table);
}

/**
 * World-only completion of a missing counterpart league season.
 * Does not touch player state, wages, age, or career season counters.
 */
export function completeWorldLeagueEdition({
  league,
  seasonYear,
  world = getWorldState(),
  careerSeed = null,
} = {}) {
  const w = ensureMembershipMaps(world);
  if (!w || !league || seasonYear == null) {
    return { ok: false, reason: "missing-args" };
  }

  const frozen = freezeEditionRoster(league, seasonYear, w);
  if (frozen && frozen.ok === false) {
    return { ok: false, reason: "corrupt-membership", diagnostic: frozen.diagnostic };
  }
  const clubs = resolveLeagueClubs(league, { world: w, seasonYear });
  const leagueId = leagueIdOf(league);
  const expectedFixtures = clubs.length * (clubs.length - 1);

  const existing = [];
  const existingIds = new Set();
  for (const m of w.matches?.values?.() || []) {
    if ((m.competitionId || m.leagueContextId) !== leagueId) continue;
    if (String(m.editionId) !== String(seasonYear) && m.seasonYear !== seasonYear) continue;
    if (m.homeGoals == null && m.matchHomeGoals == null) continue;
    existing.push(m);
    if (m.matchId || m.fixtureId) existingIds.add(m.matchId || m.fixtureId);
  }

  if (existing.length >= expectedFixtures) {
    const { table } = rebuildTableFromMatches(clubs, existing);
    w.standings.set(leagueId, sortTableRows(table));
    return { ok: true, reused: true, table: sortTableRows(table), simulated: 0 };
  }

  const seedLabel = `world-league:${careerSeed ?? w.rngSeed ?? "w"}:${leagueId}:${seasonYear}`;
  const rng = createStreamRng(seedLabel, "world-only-results");
  // Persist stream cursor so repeat completion is stable.
  if (!w.worldLeagueRng) w.worldLeagueRng = {};
  if (w.worldLeagueRng[seedLabel] != null) rng.setSeed(w.worldLeagueRng[seedLabel]);

  const fixtures = flattenRoundRobinFixtures(clubs, {
    idPrefix: `lg:${leagueId}:${seasonYear}`,
  });
  const dated = dateLeagueFixtures(fixtures, seasonYear);
  ensureLeagueEdition({ ...league, clubs }, seasonYear, w);

  let simulated = 0;
  const allMatches = [...existing];
  for (const fx of dated) {
    const fixtureId =
      fx.fixtureId ||
      `lg:${leagueId}:${seasonYear}:md${fx.matchday}:${fx.home.clubId}:${fx.away.clubId}`;
    if (existingIds.has(fixtureId)) continue;

    const match = simulateMatch(fx.home, fx.away, {
      competition: "league",
      worldState: w,
      rng,
      competitionId: leagueId,
      fixtureId,
      date: fx.date,
    });
    match.matchday = fx.matchday;
    match.round = `Matchday ${fx.matchday}`;
    match.editionId = String(seasonYear);
    match.seasonYear = seasonYear;
    match.leagueContextId = leagueId;
    match.status = "played";
    match.worldOnly = true;
    applyMatchFormUpdate(w, match);
    try {
      commitLeagueMatchResult(match, { ...league, clubs }, seasonYear, w);
    } catch {
      // Store optional; table still built from local array.
    }
    allMatches.push(match);
    existingIds.add(fixtureId);
    simulated += 1;
  }

  w.worldLeagueRng[seedLabel] = rng.seed();
  const { table } = rebuildTableFromMatches(clubs, allMatches);
  const sorted = sortTableRows(table);
  w.standings.set(leagueId, sorted);
  return { ok: true, reused: false, table: sorted, simulated };
}

/**
 * Obtain a validated final table for a league edition, completing world-only if needed.
 */
export function ensureFinalTableForEdition({
  league,
  seasonYear,
  preferredTable = null,
  world = getWorldState(),
  careerSeed = null,
} = {}) {
  const w = ensureMembershipMaps(world);
  const leagueId = leagueIdOf(league);
  const frozen = freezeEditionRoster(league, seasonYear, w);
  if (frozen && frozen.ok === false) {
    return { ok: false, reason: "corrupt-membership", diagnostic: frozen.diagnostic };
  }
  const clubIds = resolveLeagueClubIds(leagueId, { world: w, seasonYear });

  if (preferredTable) {
    const sorted = sortTableRows(preferredTable);
    const v = validateTableAgainstRoster(sorted, clubIds, leagueId);
    if (v.ok) return { ok: true, table: sorted, source: "preferred" };
  }

  const fromStore = tableFromCommittedEdition(league, seasonYear, w);
  if (fromStore) {
    const v = validateTableAgainstRoster(fromStore, clubIds, leagueId);
    if (v.ok) return { ok: true, table: fromStore, source: "committed" };
  }

  const standings = w.standings?.get(leagueId);
  if (standings?.length) {
    const sorted = sortTableRows(standings);
    const v = validateTableAgainstRoster(sorted, clubIds, leagueId);
    if (v.ok && sorted.every((r) => (r.played || 0) >= clubIds.length - 1)) {
      return { ok: true, table: sorted, source: "standings" };
    }
  }

  const completed = completeWorldLeagueEdition({ league, seasonYear, world: w, careerSeed });
  if (!completed.ok) return completed;
  const v = validateTableAgainstRoster(completed.table, clubIds, leagueId);
  if (!v.ok) return { ok: false, reason: v.reason, detail: v };
  return { ok: true, table: completed.table, source: "world-completed", simulated: completed.simulated };
}

function projectClubIntoLeague(clubLike, targetLeague) {
  if (!clubLike || !targetLeague) return clubLike;
  const club = attachClubIdentity(clubLike);
  const toId = leagueIdOf(targetLeague);
  return {
    ...club,
    league: targetLeague.name,
    leagueDisplay: targetLeague.displayName ?? targetLeague.name,
    leagueId: toId,
    tier: targetLeague.tier,
    divisionLevel: targetLeague.divisionLevel ?? club.divisionLevel,
    financialTier: clamp(
      Math.round(
        ((club.financialTier ?? targetLeague.financialPower ?? 2) +
          (targetLeague.financialPower ?? 2)) /
          2
      ),
      1,
      5
    ),
  };
}

function updateWorldClubLeague(world, clubId, league) {
  const club = world?.clubs?.get(clubId);
  if (!club || !league) return;
  club.leagueId = leagueIdOf(league);
  club.league = league.name;
  club.leagueDisplay = league.displayName ?? league.name;
  club.tier = league.tier;
  club.divisionLevel = league.divisionLevel;
}

/**
 * Commit a balanced pair transition. Validates before any mutation.
 */
export function commitDivisionPairTransition({
  world = getWorldState(),
  upperLeague,
  lowerLeague,
  upperTable,
  lowerTable,
  completedSeasonYear,
  player = null,
  force = false,
} = {}) {
  const w = ensureMembershipMaps(world);
  if (!w || !upperLeague || !lowerLeague || completedSeasonYear == null) {
    return { ok: false, reason: "missing-args" };
  }

  const upperId = leagueIdOf(upperLeague);
  const lowerId = leagueIdOf(lowerLeague);
  const policy = pairPolicyForLeague(upperId);
  if (!policy || policy.lowerId !== lowerId) {
    return { ok: false, reason: "unsupported-pair", upperId, lowerId };
  }

  const key = transitionKey(policy.pairId, completedSeasonYear);
  const prior = w.membershipTransitions.get(key);
  if (prior && !force) {
    return {
      ok: true,
      alreadyApplied: true,
      transition: prior,
      playerMove: playerMoveFromTransition(player, prior, upperLeague, lowerLeague),
    };
  }

  const upperRoster = resolveLeagueClubIds(upperId, { world: w, seasonYear: completedSeasonYear });
  const lowerRoster = resolveLeagueClubIds(lowerId, { world: w, seasonYear: completedSeasonYear });

  // Detect corrupt live membership without claiming repair.
  for (const id of [upperId, lowerId]) {
    const corrupt = detectCorruptMembership(w, id);
    // Capacity check against *edition* freeze, not post-move live; skip if freeze exists.
    if (corrupt && !w.leagueEditionRosters.get(editionRosterKey(id, completedSeasonYear))) {
      if (corrupt.code === "capacity-mismatch") {
        w.membershipDiagnostics.set(key, corrupt);
        return { ok: false, reason: "corrupt-membership", diagnostic: corrupt };
      }
    }
  }

  if (upperRoster.length !== policy.upperCapacity || lowerRoster.length !== policy.lowerCapacity) {
    return {
      ok: false,
      reason: "edition-capacity-mismatch",
      upper: upperRoster.length,
      lower: lowerRoster.length,
      expected: { upper: policy.upperCapacity, lower: policy.lowerCapacity },
    };
  }

  const uTable = sortTableRows(upperTable);
  const lTable = sortTableRows(lowerTable);
  const vu = validateTableAgainstRoster(uTable, upperRoster, upperId);
  const vl = validateTableAgainstRoster(lTable, lowerRoster, lowerId);
  if (!vu.ok) return { ok: false, reason: vu.reason, detail: vu };
  if (!vl.ok) return { ok: false, reason: vl.reason, detail: vl };

  const k = policy.exchange;
  const relegated = uTable.slice(-k).map((r) => r.clubId);
  const promoted = lTable.slice(0, k).map((r) => r.clubId);

  for (const id of relegated) {
    if (!upperRoster.includes(id)) return { ok: false, reason: "relegated-not-in-upper", clubId: id };
  }
  for (const id of promoted) {
    if (!lowerRoster.includes(id)) return { ok: false, reason: "promoted-not-in-lower", clubId: id };
  }

  const R = new Set(relegated);
  const P = new Set(promoted);
  if (R.size !== k || P.size !== k) {
    return { ok: false, reason: "selection-not-unique" };
  }
  for (const id of P) {
    if (R.has(id)) return { ok: false, reason: "overlap-promoted-relegated", clubId: id };
  }

  const nextUpper = [...upperRoster.filter((id) => !R.has(id)), ...promoted];
  const nextLower = [...lowerRoster.filter((id) => !P.has(id)), ...relegated];

  if (nextUpper.length !== policy.upperCapacity || nextLower.length !== policy.lowerCapacity) {
    return { ok: false, reason: "next-capacity-mismatch" };
  }
  const combinedBefore = new Set([...upperRoster, ...lowerRoster]);
  const combinedAfter = new Set([...nextUpper, ...nextLower]);
  if (combinedBefore.size !== combinedAfter.size) {
    return { ok: false, reason: "combined-set-size-changed" };
  }
  for (const id of combinedBefore) {
    if (!combinedAfter.has(id)) return { ok: false, reason: "club-lost", clubId: id };
  }
  if (new Set(nextUpper).size !== nextUpper.length || new Set(nextLower).size !== nextLower.length) {
    return { ok: false, reason: "next-duplicate-ids" };
  }

  // Commit atomically.
  w.leagueMemberships.set(upperId, [...nextUpper]);
  w.leagueMemberships.set(lowerId, [...nextLower]);
  for (const id of nextUpper) updateWorldClubLeague(w, id, upperLeague);
  for (const id of nextLower) updateWorldClubLeague(w, id, lowerLeague);

  const transition = {
    key,
    pairId: policy.pairId,
    completedSeasonYear,
    upperId,
    lowerId,
    exchange: k,
    promoted: [...promoted],
    relegated: [...relegated],
    priorUpper: [...upperRoster],
    priorLower: [...lowerRoster],
    nextUpper: [...nextUpper],
    nextLower: [...nextLower],
    appliedAt: Date.now(),
  };
  w.membershipTransitions.set(key, transition);

  const playerMove = projectPlayerAfterTransition(player, transition, upperLeague, lowerLeague);

  return { ok: true, alreadyApplied: false, transition, playerMove };
}

function playerMoveFromTransition(player, transition, upperLeague, lowerLeague) {
  if (!player || !transition) return null;
  return projectPlayerAfterTransition(player, transition, upperLeague, lowerLeague);
}

function projectPlayerAfterTransition(player, transition, upperLeague, lowerLeague) {
  if (!player || !transition) return null;
  const clubId =
    player.playingClubId ||
    player.employmentClubId ||
    player.club?.clubId ||
    null;
  if (!clubId) return null;

  if (transition.promoted.includes(clubId)) {
    if (player.club?.clubId === clubId) {
      player.club = projectClubIntoLeague(player.club, upperLeague);
    }
    return {
      type: "promoted",
      from: lowerLeague.displayName ?? lowerLeague.name,
      to: upperLeague.displayName ?? upperLeague.name,
      league: upperLeague,
      clubId,
    };
  }
  if (transition.relegated.includes(clubId)) {
    if (player.club?.clubId === clubId) {
      player.club = projectClubIntoLeague(player.club, lowerLeague);
    }
    return {
      type: "relegated",
      from: upperLeague.displayName ?? upperLeague.name,
      to: lowerLeague.displayName ?? lowerLeague.name,
      league: lowerLeague,
      clubId,
    };
  }
  // Same club, possibly already labeled; refresh live league metadata by membership.
  if (player.club?.clubId === clubId) {
    if (transition.nextUpper.includes(clubId)) {
      player.club = projectClubIntoLeague(player.club, upperLeague);
    } else if (transition.nextLower.includes(clubId)) {
      player.club = projectClubIntoLeague(player.club, lowerLeague);
    }
  }
  return null;
}

/**
 * Season-boundary entry: finalize membership for the pair containing the
 * completed playing league. Runs even if the player became a free agent.
 */
export function finalizeMembershipAfterSeason({
  player = null,
  completedLeague,
  completedTable,
  completedSeasonYear,
  allLeagues = LEAGUES,
  world = getWorldState(),
  completedClubId = null,
} = {}) {
  const w = ensureMembershipMaps(world);
  if (!w || !completedLeague || completedSeasonYear == null) {
    return { ok: false, reason: "missing-args" };
  }

  const leagueId = leagueIdOf(completedLeague);
  const policy = pairPolicyForLeague(leagueId);
  if (!policy) {
    // No modeled sister — nothing to move (edge of pyramid / unpaired).
    return { ok: true, skipped: true, reason: "no-modeled-pair" };
  }

  const upperLeague =
    policy.role === "upper" ? completedLeague : LEAGUE_BY_ID.get(policy.upperId);
  const lowerLeague =
    policy.role === "lower" ? completedLeague : LEAGUE_BY_ID.get(policy.lowerId);
  if (!upperLeague || !lowerLeague) {
    return { ok: false, reason: "missing-sister-definition" };
  }

  const key = transitionKey(policy.pairId, completedSeasonYear);
  const prior = w.membershipTransitions.get(key);
  if (prior) {
    return {
      ok: true,
      alreadyApplied: true,
      transition: prior,
      playerMove: projectPlayerAfterTransition(player, prior, upperLeague, lowerLeague),
    };
  }

  // Freeze completed edition from current membership before any move.
  const freezeMain = freezeEditionRoster(completedLeague, completedSeasonYear, w);
  if (freezeMain && freezeMain.ok === false) {
    return { ok: false, reason: "corrupt-membership", diagnostic: freezeMain.diagnostic };
  }
  const sister = policy.role === "upper" ? lowerLeague : upperLeague;
  const freezeSister = freezeEditionRoster(sister, completedSeasonYear, w);
  if (freezeSister && freezeSister.ok === false) {
    return { ok: false, reason: "corrupt-membership", diagnostic: freezeSister.diagnostic };
  }

  const completed = ensureFinalTableForEdition({
    league: completedLeague,
    seasonYear: completedSeasonYear,
    preferredTable: completedTable,
    world: w,
    careerSeed: w.rngSeed,
  });
  if (!completed.ok) return completed;

  const counterpart = ensureFinalTableForEdition({
    league: sister,
    seasonYear: completedSeasonYear,
    preferredTable: null,
    world: w,
    careerSeed: w.rngSeed,
  });
  if (!counterpart.ok) return counterpart;

  const upperTable = policy.role === "upper" ? completed.table : counterpart.table;
  const lowerTable = policy.role === "lower" ? completed.table : counterpart.table;

  // Snapshot player for world-only counterpart side-effect check is caller's job.
  const result = commitDivisionPairTransition({
    world: w,
    upperLeague,
    lowerLeague,
    upperTable,
    lowerTable,
    completedSeasonYear,
    player,
  });

  // If player no longer has a club but completed a club that moved, still report move.
  if (result.ok && !result.playerMove && completedClubId) {
    const t = result.transition;
    if (t.promoted.includes(completedClubId)) {
      result.playerMove = {
        type: "promoted",
        from: lowerLeague.displayName ?? lowerLeague.name,
        to: upperLeague.displayName ?? upperLeague.name,
        league: upperLeague,
        clubId: completedClubId,
      };
    } else if (t.relegated.includes(completedClubId)) {
      result.playerMove = {
        type: "relegated",
        from: upperLeague.displayName ?? upperLeague.name,
        to: lowerLeague.displayName ?? lowerLeague.name,
        league: lowerLeague,
        clubId: completedClubId,
      };
    }
  }

  void allLeagues;
  void hashSeed;
  return result;
}

/**
 * Compatibility wrapper used by older smoke tests.
 * Requires an active world. Without validated tables it refuses to mutate.
 */
export function applyDivisionMovement(player, playerRecord, currentLeague, allLeagues = LEAGUES) {
  const world = getWorldState();
  if (!player || !playerRecord || !currentLeague) return null;
  if (!world) {
    // No world: refuse silent relabel.
    return null;
  }
  if (!player.club?.clubId && !player.playingClubId) return null;

  const priorClub = player.club ? { ...player.club } : null;
  const seasonYear =
    (player.startYear || 2026) + Math.max(0, (player.seasons?.length || 1) - 1);
  // Build a synthetic preferred table only when caller supplies a controlled
  // full table via playerRecord.table; otherwise require production finalization.
  let preferredTable = playerRecord.table || null;
  if (!preferredTable && Number.isFinite(playerRecord.position)) {
    // Controlled helper path: fabricate ordered table from frozen/live roster
    // with the player's club forced to the requested finish — for tests/probes.
    try {
      preferredTable = fabricateControlledTable(
        currentLeague,
        world,
        seasonYear,
        player,
        playerRecord.position
      );
    } catch {
      return null;
    }
  }

  let result;
  try {
    result = finalizeMembershipAfterSeason({
      player,
      completedLeague: currentLeague,
      completedTable: preferredTable,
      completedSeasonYear: seasonYear,
      allLeagues,
      world,
      completedClubId: player.club?.clubId || player.playingClubId,
    });
  } catch {
    if (priorClub) player.club = priorClub;
    return null;
  }

  if (!result?.ok) {
    if (priorClub) player.club = priorClub;
    return null;
  }
  // Idempotent restore: do not claim a fresh promotion/relegation again.
  if (result.alreadyApplied) return null;
  return result.playerMove || null;
}

function fabricateControlledTable(league, world, seasonYear, player, position) {
  const clubs = resolveLeagueClubs(league, { world, seasonYear: null });
  const clubId = player.club?.clubId || player.playingClubId;
  const others = clubs.filter((c) => c.clubId !== clubId);
  const target = clubs.find((c) => c.clubId === clubId);
  if (!target || !Number.isFinite(position) || position < 1 || position > clubs.length) {
    return null;
  }
  const ordered = [];
  let oi = 0;
  for (let pos = 1; pos <= clubs.length; pos++) {
    if (pos === position) ordered.push(target);
    else ordered.push(others[oi++]);
  }
  return ordered.map((c, i) => ({
    name: c.name,
    displayName: c.displayName,
    badge: c.badge,
    clubId: c.clubId,
    position: i + 1,
    played: clubs.length - 1,
    wins: clubs.length - 1 - i,
    draws: 0,
    losses: i,
    goalsFor: Math.max(0, 60 - i),
    goalsAgainst: i,
    points: Math.max(0, (clubs.length - 1 - i) * 3),
  }));
}

/**
 * Current career division metadata for a club id (catalog / transfer / loan).
 */
export function resolveClubLeagueMetadata(clubId, world = getWorldState()) {
  if (!clubId) return null;
  const w = ensureMembershipMaps(world);
  const seed = staticClubById(clubId);
  if (w?.leagueMemberships) {
    for (const [leagueId, ids] of w.leagueMemberships.entries()) {
      if (ids.includes(clubId)) {
        const league = LEAGUE_BY_ID.get(leagueId);
        if (!league) continue;
        return {
          ...(seed || {}),
          clubId,
          league: league.name,
          leagueDisplay: league.displayName ?? league.name,
          leagueId,
          tier: league.tier,
          divisionLevel: league.divisionLevel,
          nation: league.nation,
        };
      }
    }
  }
  if (seed) {
    return {
      ...seed,
      league: seed.league,
      leagueDisplay: seed.leagueDisplay,
      leagueId: seed.leagueId,
    };
  }
  return null;
}

export function membershipSnapshotFields(world) {
  const w = ensureMembershipMaps(world);
  if (!w) return {};
  return {
    leagueEditionRosters: [...(w.leagueEditionRosters || [])],
    membershipTransitions: [...(w.membershipTransitions || [])],
    membershipDiagnostics: [...(w.membershipDiagnostics || [])],
    worldLeagueRng: w.worldLeagueRng || null,
  };
}

export function restoreMembershipSnapshotFields(world, data) {
  if (!world || !data) return world;
  if (data.leagueEditionRosters) {
    world.leagueEditionRosters = new Map(data.leagueEditionRosters);
  } else if (!world.leagueEditionRosters) {
    world.leagueEditionRosters = new Map();
  }
  if (data.membershipTransitions) {
    world.membershipTransitions = new Map(data.membershipTransitions);
  } else if (!world.membershipTransitions) {
    world.membershipTransitions = new Map();
  }
  if (data.membershipDiagnostics) {
    world.membershipDiagnostics = new Map(data.membershipDiagnostics);
  } else if (!world.membershipDiagnostics) {
    world.membershipDiagnostics = new Map();
  }
  if (data.worldLeagueRng) world.worldLeagueRng = data.worldLeagueRng;
  return world;
}
