/**
 * Continental club tournaments driven by a persistable edition lifecycle:
 *
 *   prepareContinentalEdition → processContinentalMatchday / processContinentalFixture
 *   → advanceContinentalStage → buildContinentalCampaignView
 *
 * Every fixture is simulated at most once under a canonical fixture ID. Tables, brackets
 * and the player's path are projected from results committed to competitionStore, and a
 * knockout round is only created once the previous round is decided — nothing is
 * pre-played speculatively.
 *
 * Formats: UEFA league phase (+ one-round knockout playoffs), AFC regional league phases,
 * CONMEBOL / CAF groups, Concacaf knockout with byes.
 */

import { LEAGUES } from "../data/leagues.js";
import {
  continentalCompetitionForStanding,
  isUefaQualifyingLeague,
} from "../data/competitions/qualification.js";
import { formatForCompetitionName } from "../data/competitions/formats.js";
import { canAttachToContinentalFixture } from "../data/competitions/registrationPolicy.js";
import { resolveValidatedClubSide, resolvePlayingClubAt } from "./playingRegistration.js";
import { CLUB_PROFILES } from "../data/identity/resolver.js";
import {
  formatMatchScoreline,
  resolveKnockout,
  resolveTwoLeggedTie,
  simulateMatch,
} from "./matchEngine.js";
import { getSimRng } from "./rng.js";
import { updateFatigue, updateFormFromObservation } from "./playerState.js";
import { applyInjury, computeRiskMultiplier, sampleInjuryFromExposure } from "./playerHealth.js";
import { attachClubIdentity, applyMatchFormUpdate, getWorldState } from "./worldState.js";
import { effectiveTeamStrength } from "./teamStrength.js";
import { fixtureOpportunityCapacity } from "./playerMatchDay.js";
import {
  commitEdition,
  commitMatch,
  commitTie,
  createEdition,
  getEdition,
  getMatch,
} from "./competitionStore.js";
import {
  buildEditionId,
  buildLeaguePhaseSchedule,
  clubKey,
  competitionIdSlug,
  knockoutStageDate,
  leaguePhaseMatchdayDate,
  makeFixtureId,
  makeTieId,
  roundRobinFactorization,
} from "./continentalSchedule.js";
import {
  assertPhaseAccounting,
  finalizeLeaguePhaseTable,
  sortContinentalRows,
} from "./continentalTable.js";

const LIFECYCLE_VERSION = 1;
const CAMPAIGN_KIND = "continental-club";

const CONFED_NATIONS = {
  UEFA: new Set([
    "England", "Spain", "Germany", "Italy", "France", "Portugal", "Netherlands",
    "Belgium", "Denmark", "Turkey", "Norway", "Poland", "Czech Republic", "Croatia", "Serbia",
  ]),
  CONMEBOL: new Set(["Brazil", "Argentina", "Colombia", "Ecuador"]),
  CONCACAF: new Set(["Mexico", "United States"]),
  AFC: new Set(["Saudi Arabia", "Japan", "South Korea"]),
  CAF: new Set(["Egypt", "Morocco"]),
};

/** AFC regions are inventory-limited: West currently only holds Saudi clubs. */
const AFC_REGION_NATIONS = {
  west: new Set(["Saudi Arabia"]),
  east: new Set(["Japan", "South Korea"]),
};

const STAGE_LABELS = {
  league: "League phase",
  groups: "Group stage",
  R1: "Round One",
  playoff: "Knockout playoffs",
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarter-finals",
  SF: "Semi-finals",
  Final: "Final",
};

// ---------------------------------------------------------------------------
// Field construction
// ---------------------------------------------------------------------------

function slimClub(club, leagueMeta = {}) {
  return attachClubIdentity({
    name: club.name,
    displayName: club.displayName ?? club.name,
    badge: club.badge ?? null,
    clubId: club.clubId,
    financialTier: club.financialTier ?? leagueMeta.financialPower ?? 2,
    tier: leagueMeta.tier ?? club.tier ?? 3,
    overall: club.overall,
    attack: club.attack,
    midfield: club.midfield,
    defence: club.defence,
    goalkeeper: club.goalkeeper,
    nation: club.nation ?? leagueMeta.nation,
    league: club.league ?? leagueMeta.name,
    leagueId: club.leagueId ?? leagueMeta.leagueId,
    confederation: club.confederation ?? null,
  });
}

function clubsFromConfederation(confederation, { excludeName = "", excludeId = null, limit = 64, minOverall = 0 } = {}) {
  const nations = CONFED_NATIONS[confederation];
  const fromLeagues = [];
  const seen = new Set();

  LEAGUES.forEach((league) => {
    if (nations && !nations.has(league.nation)) return;
    if (!nations && confederation === "UEFA" && !isUefaQualifyingLeague(league) && (league.divisionLevel ?? 1) !== 1) {
      return;
    }
    [...league.clubs]
      .sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))
      .forEach((club) => {
        const id = club.clubId || club.name;
        if (seen.has(id)) return;
        if (club.name === excludeName || (excludeId && club.clubId === excludeId)) return;
        if ((club.overall ?? 0) < minOverall) return;
        seen.add(id);
        fromLeagues.push(slimClub(club, league));
      });
  });

  // Supplement profiles not yet mirrored into LEAGUES (safety net)
  CLUB_PROFILES.forEach((p) => {
    if (p.confederation !== confederation) return;
    const id = p.clubId || p.name;
    if (seen.has(id)) return;
    if (p.name === excludeName || (excludeId && p.clubId === excludeId)) return;
    if ((p.overall ?? 0) < minOverall) return;
    seen.add(id);
    fromLeagues.push(slimClub(p, { name: p.leagueName, nation: p.nation, leagueId: p.leagueId, tier: 3 }));
  });

  return fromLeagues
    .sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))
    .slice(0, limit);
}

function playerClubEntry(player, league) {
  return slimClub(
    {
      ...player.club,
      nation: league?.nation ?? player.club.nation,
      league: league?.name ?? player.club.league,
      leagueId: league?.leagueId ?? player.club.leagueId,
    },
    league || {}
  );
}

/** Strong core plus a random spread from the rest of the pool; the player's club is always kept. */
function sampleField(pool, playerClub, size, rng) {
  const ranked = [...pool].sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));
  const cut = Math.ceil(Math.max(size, size * 1.4));
  const top = ranked.slice(0, cut);
  const rest = ranked.slice(cut);
  const want = Math.max(0, playerClub ? size - 1 : size);
  const others = rng
    .shuffle([...rng.shuffle(top).slice(0, size + 6), ...rng.shuffle(rest).slice(0, size)])
    .slice(0, want);
  const field = rng.shuffle(playerClub ? [playerClub, ...others] : others);
  const have = new Set(field.map(clubKey));
  // Fill from the remaining pool when short — never invent clubs.
  for (const club of ranked) {
    if (field.length >= size) break;
    if (have.has(clubKey(club))) continue;
    have.add(clubKey(club));
    field.push(club);
  }
  return field;
}

function buildField(competition, playerClub, size, confederation, minOverall, rng) {
  const opts = {
    excludeName: playerClub.name,
    excludeId: playerClub.clubId,
    limit: Math.max(size * 2, 48),
  };
  let pool = clubsFromConfederation(confederation, { ...opts, minOverall });
  // Thin inventories relax the quality floor before the format has to shrink.
  for (let floor = minOverall - 4; pool.length < size - 1 && floor > 0; floor -= 4) {
    pool = clubsFromConfederation(confederation, { ...opts, minOverall: floor });
  }
  return sampleField(pool, playerClub, size, rng);
}

/** Drop the weakest non-player clubs until the field divides evenly. */
function trimField(field, keepKey, multiple = 2) {
  const out = [...field];
  while (multiple > 1 && out.length % multiple !== 0) {
    let weakest = -1;
    out.forEach((club, i) => {
      if (clubKey(club) === keepKey) return;
      if (weakest < 0 || (club.overall ?? 0) < (out[weakest].overall ?? 0)) weakest = i;
    });
    if (weakest < 0) break;
    out.splice(weakest, 1);
  }
  return out;
}

function buildRegionalField(playerClub, format, minOverall, rng) {
  const regionIds = (format.regions || ["West", "East"]).map((r) => String(r).toLowerCase());
  const perRegion = Math.floor((format.fieldSize || 32) / regionIds.length);
  const regionOf = (club) => regionIds.find((rid) => AFC_REGION_NATIONS[rid]?.has(club.nation)) || null;
  const playerRegion = regionOf(playerClub) || regionIds[0];
  const buckets = Object.fromEntries(regionIds.map((rid) => [rid, []]));
  clubsFromConfederation("AFC", {
    excludeName: playerClub.name,
    excludeId: playerClub.clubId,
    limit: 1000,
  }).forEach((club) => {
    const rid =
      regionOf(club) ||
      regionIds.reduce((best, r) => (buckets[r].length < buckets[best].length ? r : best), regionIds[0]);
    buckets[rid].push(club);
  });

  const regions = {};
  regionIds.forEach((rid) => {
    const withPlayer = rid === playerRegion;
    const preferred = buckets[rid].filter((c) => (c.overall ?? 0) >= minOverall);
    const pool = preferred.length >= perRegion - (withPlayer ? 1 : 0) ? preferred : buckets[rid];
    regions[rid] = trimField(
      sampleField(pool, withPlayer ? playerClub : null, perRegion, rng),
      clubKey(playerClub)
    );
  });
  return { regionIds, regions, playerRegion };
}

function confederationForCompetition(name) {
  if (name.includes("Libertadores") || name.includes("Sudamericana")) return "CONMEBOL";
  if (name.includes("CONCACAF")) return "CONCACAF";
  if (name.includes("AFC")) return "AFC";
  if (name.includes("CAF")) return "CAF";
  return "UEFA";
}

function minOverallFor(name) {
  if (name === "Champions League") return 70;
  if (name === "Europa League") return 64;
  if (name === "Conference League") return 58;
  if (name === "Copa Libertadores") return 66;
  if (name === "Copa Sudamericana") return 58;
  if (name === "AFC Champions League Elite") return 62;
  if (name === "CAF Champions League") return 58;
  return 55;
}

function fallbackFormat(competition) {
  return {
    competitionId: competitionIdSlug(competition),
    name: competition,
    confederation: confederationForCompetition(competition),
    kind: "club",
    ruleVersion: "game",
    openingPhase: "knockout",
    fieldSize: 16,
    knockout: { path: [], twoLeggedUntil: [], finalLegs: 1, extraTime: true, penalties: true },
  };
}

// ---------------------------------------------------------------------------
// Bracket helpers
// ---------------------------------------------------------------------------

function isPow2(n) {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

/** Standard seeded bracket order, e.g. 8 → [1, 8, 4, 5, 2, 7, 3, 6]. */
function seedBracketOrder(n) {
  if (!isPow2(n)) return Array.from({ length: n }, (_, i) => i + 1);
  let order = [1];
  while (order.length < n) {
    const size = order.length * 2;
    order = order.flatMap((seed) => [seed, size + 1 - seed]);
  }
  return order;
}

function stageIdForSize(size) {
  if (size === 2) return "Final";
  if (size === 4) return "SF";
  if (size === 8) return "QF";
  return `R${size}`;
}

function stageLabel(stageId) {
  if (STAGE_LABELS[stageId]) return STAGE_LABELS[stageId];
  if (/^R\d+$/.test(stageId)) return `Round of ${stageId.slice(1)}`;
  return String(stageId);
}

function stageDateKey(stageId) {
  return stageId === "R1" || stageId === "R32" ? "playoff" : stageId;
}

function isTwoLeggedStage(format, stageId) {
  if (stageId === "Final") return (format?.knockout?.finalLegs || 1) > 1;
  return (format?.knockout?.twoLeggedUntil || []).includes(stageId);
}

/** Pair each seed with an unseeded club, honouring `avoid(seed, other)` when a draw allows it. */
function drawSeededPairs(seeds, unseeded, rng, avoid = null) {
  if (avoid) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const pool = rng.shuffle(unseeded);
      const pairs = [];
      for (const seed of seeds) {
        const idx = pool.findIndex((other) => !avoid(seed, other));
        if (idx < 0) break;
        pairs.push([seed, pool.splice(idx, 1)[0]]);
      }
      if (pairs.length === seeds.length) return pairs;
    }
  }
  const pool = rng.shuffle(unseeded);
  return seeds.map((seed, i) => [seed, pool[i]]);
}

// ---------------------------------------------------------------------------
// Lifecycle context & lookups
// ---------------------------------------------------------------------------

const EPHEMERAL_STORES = new WeakMap();
const FIELD_INDEX = new WeakMap();

function isLiveWorld(world) {
  return Boolean(
    world &&
      world.form instanceof Map &&
      world.clubs instanceof Map &&
      world.nations instanceof Map &&
      Array.isArray(world.fixtureLedger)
  );
}

function resolveContext(state, opts = {}) {
  const world = opts.world || getWorldState() || null;
  let store = world;
  if (!store) {
    // No career world: keep results in a per-edition store so idempotency still holds.
    store = EPHEMERAL_STORES.get(state);
    if (!store) {
      store = { editions: new Map(), matches: new Map(), ties: new Map() };
      EPHEMERAL_STORES.set(state, store);
    }
  }
  return {
    world,
    formWorld: isLiveWorld(world) ? world : null,
    store,
    rng: opts.rng || getSimRng(),
    player: opts.player ?? null,
    playerName: opts.playerName || state?.playerClub?.name || null,
    matchProcessor: typeof opts.matchProcessor === "function" ? opts.matchProcessor : null,
    // Deferred ledger commit after ET/pens finalization (continentalChronology).
    onPlayerMatchFinalized:
      typeof opts.onPlayerMatchFinalized === "function" ? opts.onPlayerMatchFinalized : null,
    injuryRng: opts.injuryRng || null,
  };
}

function clubFor(state, clubId) {
  if (!clubId) return null;
  let entry = FIELD_INDEX.get(state);
  if (!entry || entry.field !== state.field || entry.size !== state.field.length) {
    entry = {
      field: state.field,
      size: state.field.length,
      map: new Map(state.field.map((club) => [clubKey(club), club])),
    };
    FIELD_INDEX.set(state, entry);
  }
  return entry.map.get(clubId) || null;
}

function clubSummary(club) {
  if (!club) return null;
  return {
    name: club.name,
    displayName: club.displayName ?? club.name,
    badge: club.badge ?? null,
    clubId: club.clubId ?? null,
  };
}

function playedMatch(matchId, ctx) {
  const match = getMatch(matchId, ctx.store);
  return match?.status === "played" ? match : null;
}

function pushUnique(list, value) {
  if (list && !list.includes(value)) list.push(value);
}

function seedRankOf(state, clubId) {
  return state.seedRank?.[clubId] ?? Number.MAX_SAFE_INTEGER;
}

function tieIdFor(state, stageId, index, regionId = null) {
  return makeTieId({
    competitionId: state.competitionId,
    editionId: state.editionId,
    stageId,
    index,
    regionId,
  });
}

function fixtureOrder(a, b) {
  return (
    String(a.date || "").localeCompare(String(b.date || "")) ||
    (a.legNumber || 0) - (b.legNumber || 0) ||
    a.seq - b.seq
  );
}

/** Edition focus club participates in this fixture (world campaign identity). */
function involvesFocusClub(state, fixtureOrTie) {
  return fixtureOrTie.homeClubId === state.playerClubId || fixtureOrTie.awayClubId === state.playerClubId;
}

/**
 * User attachment: dated playing registration must match a fixture participant,
 * and destination continental policy must permit the attachment when leaving the focus club.
 */
function involvesAttachedPlayer(state, fixtureOrTie, player, date = null) {
  if (!player) return involvesFocusClub(state, fixtureOrTie);
  const d = date || fixtureOrTie.date;
  const side = resolveValidatedClubSide({
    player,
    home: { clubId: fixtureOrTie.homeClubId },
    away: { clubId: fixtureOrTie.awayClubId },
    date: d,
    teamType: "club",
  });
  if (!side) return false;
  const playingId = side === "home" ? fixtureOrTie.homeClubId : fixtureOrTie.awayClubId;
  if (playingId === state.playerClubId) return true;
  const pendingFrom = player.pendingRegistration?.effectiveDate || null;
  const stintFrom = resolvePlayingClubAt(player, d) === playingId ? d : pendingFrom;
  const gate = canAttachToContinentalFixture({
    edition: state,
    playingClubId: playingId,
    fixture: fixtureOrTie,
    registrationEffectiveDate: player.playingStints?.slice(-1)?.[0]?.from || stintFrom,
  });
  return gate.ok;
}

/** @deprecated use involvesAttachedPlayer / involvesFocusClub — kept as attachment-aware default when player on ctx */
function involvesPlayer(state, fixtureOrTie, player = null) {
  return involvesAttachedPlayer(state, fixtureOrTie, player);
}

// ---------------------------------------------------------------------------
// Edition state & opening-phase scheduling
// ---------------------------------------------------------------------------

function createEditionState({ competition, competitionId, format, confederation, editionId, seasonYear, playerClub }) {
  return {
    lifecycleVersion: LIFECYCLE_VERSION,
    competition,
    competitionId,
    format,
    confederation,
    edition: {
      competitionId,
      editionId,
      name: competition,
      ruleVersion: format.ruleVersion || "game",
      confederation,
      seasonYear,
    },
    editionId,
    seasonYear,
    field: [],
    playerClub,
    playerClubId: clubKey(playerClub),
    openingPhase: format.openingPhase || "knockout",
    stageId: null,
    status: null,
    openingMatchdays: [],
    fixtures: {},
    fixtureSeq: 0,
    scheduledFixtureIds: [],
    playedFixtureIds: [],
    playerMatchIds: [],
    seedRank: {},
    leaguePhase: null,
    groups: null,
    knockout: {
      stages: [],
      ties: {},
      plan: null,
      entrantIds: null,
      allRounds: [],
      feederGraph: [],
      playerMatchIds: [],
      rounds: [],
      eliminatedRound: null,
      winner: null,
      winnerClubId: null,
    },
  };
}

function addFixture(state, spec) {
  const matchId = makeFixtureId({
    competitionId: state.competitionId,
    editionId: state.editionId,
    stageId: spec.stageId,
    matchday: spec.matchday ?? null,
    homeClubId: spec.homeClubId,
    awayClubId: spec.awayClubId,
    regionId: spec.regionId ?? null,
    groupId: spec.groupId ?? null,
  });
  if (state.fixtures[matchId]) {
    throw new Error(`Duplicate continental fixture id ${matchId}`);
  }
  state.fixtures[matchId] = {
    matchId,
    seq: state.fixtureSeq++,
    stageType: spec.stageType,
    stageId: spec.stageId,
    round: spec.round,
    matchday: spec.matchday ?? null,
    regionId: spec.regionId ?? null,
    groupId: spec.groupId ?? null,
    tieId: spec.tieId ?? null,
    legNumber: spec.legNumber ?? null,
    twoLegged: Boolean(spec.twoLegged),
    feedsInto: null,
    homeClubId: spec.homeClubId,
    awayClubId: spec.awayClubId,
    venue: spec.venue || "home",
    date: spec.date || null,
  };
  state.scheduledFixtureIds.push(matchId);
  return matchId;
}

function finishOpening(state, stageId, matchdays) {
  state.status = "league";
  state.stageId = stageId;
  state.openingMatchdays = Array.from({ length: matchdays }, (_, i) => i + 1);
}

function newLeaguePhase(lpFormat, opponents, field, regionId = null) {
  return {
    format: lpFormat,
    opponents,
    clubIds: field.map(clubKey),
    fixtureIds: [],
    regionId,
    regionOrder: null,
    regions: null,
    table: [],
    matches: [],
    playerMatchIds: [],
    frozen: false,
    provisional: true,
    openingLabel: STAGE_LABELS.league,
  };
}

function scheduleLeaguePhaseUnit(state, ctx, unit) {
  const participants = unit.clubIds.map((id) => clubFor(state, id));
  const fixtures = buildLeaguePhaseSchedule(participants, unit.opponents, unit.opponents / 2, ctx.rng);
  const label = unit.regionId ? `League phase ${unit.name}` : "League phase";
  return fixtures
    .sort((a, b) => a.matchday - b.matchday)
    .map((fx) =>
      addFixture(state, {
        stageType: "league",
        stageId: "league",
        round: `${label} MD${fx.matchday}`,
        matchday: fx.matchday,
        regionId: unit.regionId ?? null,
        homeClubId: fx.homeClubId,
        awayClubId: fx.awayClubId,
        venue: "home",
        date: leaguePhaseMatchdayDate(state.seasonYear, fx.matchday, unit.opponents),
      })
    );
}

function prepareLeaguePhase(state, ctx) {
  const format = state.format;
  const lpFormat = format.leaguePhase || {};
  const minOverall = minOverallFor(state.competition);
  const wanted = lpFormat.opponentsPerClub || 8;
  const opponentsFor = (n) => {
    const o = Math.min(wanted, n - 1);
    return o % 2 === 0 ? o : o - 1;
  };

  if (lpFormat.regionalSplit) {
    const regional = buildRegionalField(state.playerClub, format, minOverall, ctx.rng);
    const feasible = regional.regionIds.every((rid) => {
      const n = regional.regions[rid].length;
      return n % 2 === 0 && opponentsFor(n) === wanted && n >= (lpFormat.advancePerRegion ?? 8);
    });
    if (feasible) {
      state.field = regional.regionIds.flatMap((rid) => regional.regions[rid]);
      const lp = newLeaguePhase({ ...lpFormat }, wanted, state.field, regional.playerRegion);
      lp.regionOrder = regional.regionIds;
      lp.regions = {};
      state.leaguePhase = lp;
      regional.regionIds.forEach((rid) => {
        const unit = {
          regionId: rid,
          name: rid.charAt(0).toUpperCase() + rid.slice(1),
          clubIds: regional.regions[rid].map(clubKey),
          fixtureIds: [],
          opponents: opponentsFor(regional.regions[rid].length),
          table: [],
          frozen: false,
        };
        lp.regions[rid] = unit;
        unit.fixtureIds = scheduleLeaguePhaseUnit(state, ctx, unit);
        lp.fixtureIds.push(...unit.fixtureIds);
      });
      finishOpening(state, "league", wanted);
      return;
    }
  }

  const field = trimField(
    buildField(state.competition, state.playerClub, format.fieldSize || 36, state.confederation, minOverall, ctx.rng),
    state.playerClubId,
    2
  );
  state.field = field;
  const effective = lpFormat.regionalSplit
    ? { ...lpFormat, regionalSplit: false, advanceDirect: Math.min(16, field.length), advancePlayoff: null }
    : { ...lpFormat };
  const lp = newLeaguePhase(effective, opponentsFor(field.length), field);
  state.leaguePhase = lp;
  lp.fixtureIds = scheduleLeaguePhaseUnit(state, ctx, lp);
  finishOpening(state, "league", lp.opponents);
}

/** Strength pots, one club per pot per group, with association protection where possible. */
function drawGroups(field, groupCount, groupSize, rng) {
  const ranked = [...field].sort(
    (a, b) => (b.overall ?? 0) - (a.overall ?? 0) || String(clubKey(a)).localeCompare(String(clubKey(b)))
  );
  const groups = Array.from({ length: groupCount }, () => []);
  for (let p = 0; p < groupSize; p++) {
    const pot = rng.shuffle(ranked.slice(p * groupCount, (p + 1) * groupCount));
    const open = Array.from({ length: groupCount }, (_, i) => i);
    for (const club of pot) {
      const clash = (gi) => groups[gi].some((c) => c.nation && c.nation === club.nation);
      const slot = open.findIndex((gi) => !clash(gi));
      const gi = open.splice(slot >= 0 ? slot : 0, 1)[0];
      groups[gi].push(club);
    }
  }
  return groups;
}

function scheduleGroup(state, group, homeAndAway) {
  const ids = group.clubIds;
  const rounds = roundRobinFactorization(ids.length % 2 ? ids.length + 1 : ids.length);
  const legs = homeAndAway ? 2 : 1;
  const matchdays = rounds.length * legs;
  const homes = new Map(ids.map((id) => [id, 0]));
  const lastWasHome = new Map();
  const firstHalf = rounds.map((pairs) =>
    pairs
      .filter(([i, j]) => i < ids.length && j < ids.length)
      .map(([i, j]) => {
        const a = ids[i];
        const b = ids[j];
        let home = a;
        if (homes.get(b) < homes.get(a)) home = b;
        else if (homes.get(a) === homes.get(b) && lastWasHome.get(a) && !lastWasHome.get(b)) home = b;
        const away = home === a ? b : a;
        homes.set(home, homes.get(home) + 1);
        lastWasHome.set(home, true);
        lastWasHome.set(away, false);
        return [home, away];
      })
  );

  const fixtureIds = [];
  for (let leg = 0; leg < legs; leg++) {
    firstHalf.forEach((pairs, r) => {
      const matchday = leg * rounds.length + r + 1;
      pairs.forEach(([h, a]) => {
        const [homeClubId, awayClubId] = leg === 0 ? [h, a] : [a, h];
        fixtureIds.push(
          addFixture(state, {
            stageType: "groups",
            stageId: "groups",
            groupId: group.groupId,
            matchday,
            round: `${group.name} MD${matchday}`,
            homeClubId,
            awayClubId,
            venue: "home",
            date: leaguePhaseMatchdayDate(state.seasonYear, matchday, matchdays),
          })
        );
      });
    });
  }
  return { fixtureIds, matchdays };
}

function prepareGroupStage(state, ctx) {
  const gf = state.format.groups || {};
  const groupSize = gf.groupSize || 4;
  const wantedGroups = gf.groupCount || 8;
  let field = buildField(
    state.competition,
    state.playerClub,
    wantedGroups * groupSize,
    state.confederation,
    minOverallFor(state.competition),
    ctx.rng
  );
  field = trimField(field, state.playerClubId, groupSize);
  const groupCount = Math.max(1, Math.min(wantedGroups, Math.floor(field.length / groupSize)));
  state.field = field;
  const homeAndAway = gf.homeAndAway !== false;
  state.groups = {
    groupCount,
    groupSize,
    homeAndAway,
    advancePerGroup: gf.advancePerGroup || (gf.advanceWinners ? 1 : 2),
    groups: [],
    fixtureIds: [],
    matches: [],
    playerMatchIds: [],
    frozen: false,
    openingLabel: STAGE_LABELS.groups,
  };
  let matchdays = 0;
  drawGroups(field, groupCount, groupSize, ctx.rng).forEach((clubs, gi) => {
    const groupId = String.fromCharCode(65 + gi);
    const group = {
      groupId,
      name: `Group ${groupId}`,
      clubIds: clubs.map(clubKey),
      fixtureIds: [],
      table: [],
      matches: [],
      qualifierIds: [],
      thirdId: null,
      frozen: false,
    };
    const scheduled = scheduleGroup(state, group, homeAndAway);
    group.fixtureIds = scheduled.fixtureIds;
    matchdays = Math.max(matchdays, scheduled.matchdays);
    state.groups.groups.push(group);
    state.groups.fixtureIds.push(...scheduled.fixtureIds);
  });
  finishOpening(state, "groups", matchdays);
}

function prepareKnockoutOnly(state, ctx) {
  state.field = buildField(
    state.competition,
    state.playerClub,
    state.format.fieldSize || 16,
    state.confederation,
    minOverallFor(state.competition),
    ctx.rng
  );
  [...state.field]
    .sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0) || String(clubKey(a)).localeCompare(String(clubKey(b))))
    .forEach((club, i) => {
      state.seedRank[clubKey(club)] = i + 1;
    });
  state.knockout.entrantIds = state.field.map(clubKey);
  state.status = "knockout";
  createKnockoutFromRanked(state, ctx, state.knockout.entrantIds);
}

// ---------------------------------------------------------------------------
// Opening-phase tables (projected from committed fixtures, frozen at phase end)
// ---------------------------------------------------------------------------

function playedFixturesFor(state, fixtureIds, ctx) {
  const out = [];
  for (const id of fixtureIds) {
    const match = playedMatch(id, ctx);
    if (!match) continue;
    // Table rows are keyed by field identity, so rebind sides to the field entries.
    out.push({
      ...match,
      home: clubFor(state, match.homeClubId) || match.home,
      away: clubFor(state, match.awayClubId) || match.away,
    });
  }
  return out;
}

function unitTable(state, ctx, clubIds, fixtureIds, lpFormat, uefaStyle) {
  const participants = clubIds.map((id) => clubFor(state, id)).filter(Boolean);
  return finalizeLeaguePhaseTable(participants, playedFixturesFor(state, fixtureIds, ctx), lpFormat, { uefaStyle });
}

function regionalTableFormat(lp) {
  return { advancePerRegion: lp.format.advancePerRegion ?? 8 };
}

function groupBand(state, position) {
  const gf = state.format.groups || {};
  if (position <= state.groups.advancePerGroup) return "qualified";
  if (gf.runnersUpPlayoffWith && position === 2) return "playoff";
  if (gf.transferThirdTo && position === 3) return "transfer";
  return "eliminated";
}

function assertAccounting(state, label, table, fixtures, expectedParticipants, expectedPlayedPerClub) {
  const check = assertPhaseAccounting(table, fixtures, { expectedParticipants, expectedPlayedPerClub });
  if (!check.ok) {
    throw new Error(`${state.competition} ${state.editionId} ${label} accounting failed: ${check.errors.join(", ")}`);
  }
}

function freezeLeaguePhase(state, ctx) {
  const lp = state.leaguePhase;
  const uefaStyle = state.confederation === "UEFA";
  const units = lp.regions ? lp.regionOrder.map((rid) => lp.regions[rid]) : [lp];
  units.forEach((unit) => {
    const lpFormat = lp.regions ? regionalTableFormat(lp) : lp.format;
    const table = unitTable(state, ctx, unit.clubIds, unit.fixtureIds, lpFormat, uefaStyle);
    assertAccounting(
      state,
      unit.regionId ? `league phase (${unit.regionId})` : "league phase",
      table,
      playedFixturesFor(state, unit.fixtureIds, ctx),
      unit.clubIds.length,
      unit.opponents
    );
    if (unit.regionId) table.forEach((row) => { row.region = unit.regionId; });
    unit.table = table;
    unit.frozen = true;
  });
  if (lp.regions) {
    lp.table = units.flatMap((unit) => unit.table);
    units.forEach((unit, ri) =>
      unit.table.forEach((row) => {
        state.seedRank[clubKey(row.team)] = (row.position - 1) * units.length + ri + 1;
      })
    );
  } else {
    lp.table.forEach((row) => {
      state.seedRank[clubKey(row.team)] = row.position;
    });
  }
  lp.frozen = true;
  lp.provisional = false;
}

function freezeGroups(state, ctx) {
  const g = state.groups;
  const perClub = (n) => (n - 1) * (g.homeAndAway ? 2 : 1);
  g.groups.forEach((group) => {
    const table = unitTable(state, ctx, group.clubIds, group.fixtureIds, {}, false);
    assertAccounting(
      state,
      group.name,
      table,
      playedFixturesFor(state, group.fixtureIds, ctx),
      group.clubIds.length,
      perClub(group.clubIds.length)
    );
    table.forEach((row) => { row.band = groupBand(state, row.position); });
    group.table = table;
    group.qualifierIds = table.slice(0, g.advancePerGroup).map((row) => clubKey(row.team));
    group.thirdId = table[2] ? clubKey(table[2].team) : null;
    group.frozen = true;
  });
  // Cross-group seeding: every group winner ahead of every runner-up, and so on.
  const depth = Math.max(...g.groups.map((group) => group.table.length));
  let rank = 1;
  for (let pos = 0; pos < depth; pos++) {
    sortContinentalRows(g.groups.map((group) => group.table[pos]).filter(Boolean)).forEach((row) => {
      state.seedRank[clubKey(row.team)] = rank++;
    });
  }
  g.frozen = true;
}

function openingFixtureIds(state) {
  return [...(state.leaguePhase?.fixtureIds || []), ...(state.groups?.fixtureIds || [])];
}

function openingFrozen(state) {
  return Boolean(state.leaguePhase?.frozen || state.groups?.frozen);
}

function completeOpeningIfDone(state, ctx) {
  if (!state.leaguePhase && !state.groups) return true;
  if (openingFrozen(state)) return true;
  if (!openingFixtureIds(state).every((id) => playedMatch(id, ctx))) return false;
  if (state.leaguePhase) freezeLeaguePhase(state, ctx);
  if (state.groups) freezeGroups(state, ctx);
  return true;
}

function openingQualifierIds(state) {
  if (state.leaguePhase?.frozen) {
    return state.leaguePhase.table
      .filter((row) => row.band === "R16" || row.band === "playoff")
      .map((row) => clubKey(row.team));
  }
  if (state.groups?.frozen) {
    return state.groups.groups.flatMap((group) =>
      group.table
        .filter((row) => row.band === "qualified" || row.band === "playoff")
        .map((row) => clubKey(row.team))
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Knockout stages (created one round at a time)
// ---------------------------------------------------------------------------

function createKnockoutStage(state, stageId, specs) {
  const twoLegged = isTwoLeggedStage(state.format, stageId);
  const label = stageLabel(stageId);
  const dateKey = stageDateKey(stageId);
  const stage = { stageId, label, twoLegged, tieIds: [], status: "scheduled" };

  specs.forEach((spec, k) => {
    const regionId = spec.regionId ?? null;
    const index = spec.index ?? k;
    const tieId = tieIdFor(state, stageId, index, regionId);
    let [homeClubId, awayClubId] = spec.slots;
    if (!clubFor(state, homeClubId) || !clubFor(state, awayClubId)) {
      throw new Error(`Knockout tie ${tieId} has an unresolved participant`);
    }
    // The better-ranked club hosts the second leg.
    if (twoLegged && seedRankOf(state, homeClubId) < seedRankOf(state, awayClubId)) {
      [homeClubId, awayClubId] = [awayClubId, homeClubId];
    }
    const tie = {
      tieId,
      stageId,
      round: label,
      index,
      regionId,
      twoLegged,
      homeClubId,
      awayClubId,
      legIds: [],
      feedsInto: null,
      feedSlot: null,
      status: "scheduled",
      winnerClubId: null,
      loserClubId: null,
      decidedBy: null,
      aggregateA: null,
      aggregateB: null,
      penaltiesA: null,
      penaltiesB: null,
    };
    const common = { stageType: "knockout", stageId, tieId, regionId, twoLegged };
    if (twoLegged) {
      tie.legIds.push(
        addFixture(state, {
          ...common,
          round: `${label} 1st leg`,
          legNumber: 1,
          homeClubId,
          awayClubId,
          venue: "home",
          date: knockoutStageDate(state.seasonYear, dateKey, 1),
        }),
        addFixture(state, {
          ...common,
          round: `${label} 2nd leg`,
          legNumber: 2,
          homeClubId: awayClubId,
          awayClubId: homeClubId,
          venue: "home",
          date: knockoutStageDate(state.seasonYear, dateKey, 2),
        })
      );
    } else {
      tie.legIds.push(
        addFixture(state, {
          ...common,
          round: label,
          legNumber: 1,
          homeClubId,
          awayClubId,
          venue: "neutral",
          date: knockoutStageDate(state.seasonYear, dateKey, 1),
        })
      );
    }
    state.knockout.ties[tieId] = tie;
    stage.tieIds.push(tieId);
  });

  state.knockout.stages.push(stage);
  state.status = "knockout";
  state.stageId = stageId;
  return stage;
}

/** Record the next round's bracket slots and point each feeder tie at its destination. */
function setNextPlan(state, plan) {
  state.knockout.plan = plan;
  if (!plan) return;
  plan.ties.forEach((planned) =>
    planned.slots.forEach((slot, si) => {
      if (!slot.winnerOf) return;
      const feeder = state.knockout.ties[slot.winnerOf];
      if (!feeder) return;
      feeder.feedsInto = planned.tieId;
      feeder.feedSlot = si === 0 ? "home" : "away";
      feeder.legIds.forEach((id) => {
        if (state.fixtures[id]) state.fixtures[id].feedsInto = planned.tieId;
      });
    })
  );
}

function adjacencyPlan(state, stage) {
  const count = stage.tieIds.length;
  if (count < 2) return null;
  if (count % 2 !== 0) throw new Error(`Knockout stage ${stage.stageId} has an odd tie count (${count})`);
  const stageId = stageIdForSize(count);
  return {
    stageId,
    ties: Array.from({ length: count / 2 }, (_, k) => ({
      index: k,
      regionId: null,
      tieId: tieIdFor(state, stageId, k),
      slots: [{ winnerOf: stage.tieIds[2 * k] }, { winnerOf: stage.tieIds[2 * k + 1] }],
    })),
  };
}

function createStageFromPlan(state) {
  const plan = state.knockout.plan;
  const specs = plan.ties.map((planned) => ({
    index: planned.index,
    regionId: planned.regionId ?? null,
    slots: planned.slots.map((slot) => slot.clubId ?? state.knockout.ties[slot.winnerOf]?.winnerClubId ?? null),
  }));
  const stage = createKnockoutStage(state, plan.stageId, specs);
  setNextPlan(state, adjacencyPlan(state, stage));
  return stage;
}

function completeEdition(state, winnerClubId) {
  const winner = winnerClubId ? clubFor(state, winnerClubId) : null;
  state.knockout.winnerClubId = winnerClubId || null;
  state.knockout.winner = clubSummary(winner);
  state.knockout.plan = null;
  state.status = "complete";
  state.stageId = "complete";
}

/**
 * Seeded knockout from any number of entrants. Non-power-of-two fields play a
 * preliminary round (Concacaf: 22 clubs in Round One, top 5 seeds bye to the R16).
 */
function createKnockoutFromRanked(state, ctx, entrantIds, { avoid = null } = {}) {
  const ranked = [...new Set(entrantIds)].sort((a, b) => seedRankOf(state, a) - seedRankOf(state, b));
  const n = ranked.length;
  if (n < 2) {
    completeEdition(state, ranked[0] || null);
    return null;
  }
  let p = 1;
  while (p * 2 <= n) p *= 2;

  if (n === p) {
    const half = p / 2;
    const pairs = drawSeededPairs(ranked.slice(0, half), ranked.slice(half), ctx.rng, avoid);
    const specs = seedBracketOrder(half).map((seed, k) => ({ index: k, slots: pairs[seed - 1] }));
    const stage = createKnockoutStage(state, stageIdForSize(p), specs);
    setNextPlan(state, adjacencyPlan(state, stage));
    return stage;
  }

  const prelimTies = n - p;
  const byes = ranked.slice(0, n - 2 * prelimTies);
  const prelim = ranked.slice(n - 2 * prelimTies);
  const prelimPairs = drawSeededPairs(prelim.slice(0, prelimTies), prelim.slice(prelimTies), ctx.rng, avoid);
  const prelimStageId = state.format.knockout?.path?.[0] === "R1" ? "R1" : "playoff";
  const prelimStage = createKnockoutStage(
    state,
    prelimStageId,
    prelimPairs.map((slots, k) => ({ index: k, slots }))
  );

  const half = p / 2;
  const byeEntries = byes.map((clubId) => ({ clubId }));
  const prelimEntries = ctx.rng.shuffle(prelimStage.tieIds).map((tieId) => ({ winnerOf: tieId }));
  const seeded = [];
  for (let i = 0; i < half; i++) seeded.push(byeEntries[i] ?? prelimEntries.shift());
  const unseeded = ctx.rng.shuffle([...byeEntries.slice(half), ...prelimEntries]);
  const mainStageId = stageIdForSize(p);
  setNextPlan(state, {
    stageId: mainStageId,
    ties: seedBracketOrder(half).map((seed, k) => ({
      index: k,
      regionId: null,
      tieId: tieIdFor(state, mainStageId, k),
      slots: [seeded[seed - 1], unseeded[k]],
    })),
  });
  return prelimStage;
}

/**
 * UEFA knockout playoffs: ONE two-legged round (9–24 → 8 winners). The R16 slots
 * (1/2 v 15–18 tie winners, 3/4 v 13/14·19/20, 5/6 v 11/12·21/22, 7/8 v 9/10·23/24)
 * are recorded as a plan; R16 fixtures exist only after the playoff ties are decided.
 */
function createUefaPlayoffRound(state, ctx, direct, playoff) {
  const tiers = [
    { seeded: [0, 1], unseeded: [14, 15], r16Seeds: [7, 8] },
    { seeded: [2, 3], unseeded: [12, 13], r16Seeds: [5, 6] },
    { seeded: [4, 5], unseeded: [10, 11], r16Seeds: [3, 4] },
    { seeded: [6, 7], unseeded: [8, 9], r16Seeds: [1, 2] },
  ];
  const pairForSeed = new Map();
  tiers.forEach((tier) => {
    const seeded = ctx.rng.shuffle(tier.seeded.map((i) => playoff[i]));
    const unseeded = ctx.rng.shuffle(tier.unseeded.map((i) => playoff[i]));
    const pairs = ctx.rng.shuffle([
      [seeded[0], unseeded[0]],
      [seeded[1], unseeded[1]],
    ]);
    pairForSeed.set(tier.r16Seeds[0], pairs[0]);
    pairForSeed.set(tier.r16Seeds[1], pairs[1]);
  });
  const order = seedBracketOrder(direct.length);
  const playoffStage = createKnockoutStage(
    state,
    "playoff",
    order.map((seed, k) => ({ index: k, slots: pairForSeed.get(seed) }))
  );
  setNextPlan(state, {
    stageId: "R16",
    ties: order.map((seed, k) => ({
      index: k,
      regionId: null,
      tieId: tieIdFor(state, "R16", k),
      slots: [{ clubId: direct[seed - 1] }, { winnerOf: playoffStage.tieIds[k] }],
    })),
  });
  return playoffStage;
}

/** AFC: R16 inside each region (1v8 … 4v5); quarter-finals cross West v East. */
function createRegionalKnockout(state, ctx) {
  const lp = state.leaguePhase;
  const perRegion = lp.format.advancePerRegion ?? 8;
  const regionIds = lp.regionOrder;
  const qualifiers = Object.fromEntries(
    regionIds.map((rid) => [rid, lp.regions[rid].table.slice(0, perRegion).map((row) => clubKey(row.team))])
  );
  state.knockout.entrantIds = regionIds.flatMap((rid) => qualifiers[rid]);
  if (
    regionIds.length !== 2 ||
    !isPow2(perRegion) ||
    perRegion < 2 ||
    regionIds.some((rid) => qualifiers[rid].length !== perRegion)
  ) {
    return createKnockoutFromRanked(state, ctx, state.knockout.entrantIds);
  }
  const regionTies = regionIds.map((rid) =>
    seedBracketOrder(perRegion / 2).map((seed, k) => ({
      index: k,
      regionId: rid,
      slots: [qualifiers[rid][seed - 1], qualifiers[rid][perRegion - seed]],
    }))
  );
  const crossDraw = ctx.rng.shuffle(regionTies[1]);
  const specs = regionTies[0].flatMap((tie, k) => [tie, crossDraw[k]]);
  const stage = createKnockoutStage(state, stageIdForSize(state.knockout.entrantIds.length), specs);
  setNextPlan(state, adjacencyPlan(state, stage));
  return stage;
}

/** Real CONMEBOL clubs outside the field stand in for the Libertadores third-placed sides. */
function libertadoresThirdProxies(state, ctx, count) {
  const inField = new Set(state.field.map(clubKey));
  const pool = clubsFromConfederation(state.confederation, { limit: 1000 })
    .filter((club) => !inField.has(clubKey(club)))
    .slice(0, count * 2);
  return ctx.rng
    .shuffle(pool)
    .slice(0, count)
    .map((club) => ({ ...club, entryRoute: "copa-libertadores-third" }));
}

/** Sudamericana: runners-up v Libertadores thirds (one round), winners join group winners in the R16. */
function createCrossoverPlayoff(state, ctx, winners, runners, proxies) {
  const proxyIds = proxies.map(clubKey);
  proxies.forEach((club) => state.field.push(club));
  [...winners, ...proxyIds, ...runners].forEach((id, i) => {
    state.seedRank[id] = i + 1;
  });
  state.knockout.entrantIds = [...winners, ...proxyIds, ...runners];
  const pairs = drawSeededPairs(proxyIds, runners, ctx.rng);
  const playoffStage = createKnockoutStage(
    state,
    "playoff",
    pairs.map((slots, k) => ({ index: k, slots }))
  );
  const mainStageId = stageIdForSize(winners.length * 2);
  setNextPlan(state, {
    stageId: mainStageId,
    ties: seedBracketOrder(winners.length).map((seed, k) => ({
      index: k,
      regionId: null,
      tieId: tieIdFor(state, mainStageId, k),
      slots: [{ clubId: winners[seed - 1] }, { winnerOf: playoffStage.tieIds[k] }],
    })),
  });
  return playoffStage;
}

function createKnockoutAfterGroups(state, ctx) {
  const g = state.groups;
  const groupOf = {};
  g.groups.forEach((group) => group.clubIds.forEach((id) => { groupOf[id] = group.groupId; }));
  const sameGroup = (a, b) => groupOf[a] === groupOf[b];
  const byRank = (ids) => [...ids].sort((a, b) => seedRankOf(state, a) - seedRankOf(state, b));
  const atPosition = (pos) =>
    byRank(g.groups.map((group) => group.table[pos] && clubKey(group.table[pos].team)).filter(Boolean));
  const winners = atPosition(0);
  const runners = atPosition(1);

  if (g.advancePerGroup >= 2) {
    state.knockout.entrantIds = [...winners, ...runners];
    if (winners.length === runners.length && isPow2(winners.length)) {
      const pairs = drawSeededPairs(winners, runners, ctx.rng, sameGroup);
      const specs = seedBracketOrder(winners.length).map((seed, k) => ({ index: k, slots: pairs[seed - 1] }));
      const stage = createKnockoutStage(state, stageIdForSize(winners.length * 2), specs);
      setNextPlan(state, adjacencyPlan(state, stage));
      return stage;
    }
    return createKnockoutFromRanked(state, ctx, [...winners, ...runners], { avoid: sameGroup });
  }

  if (state.format.groups?.runnersUpPlayoffWith && isPow2(winners.length) && runners.length === winners.length) {
    const proxies = libertadoresThirdProxies(state, ctx, runners.length);
    if (proxies.length === runners.length) {
      return createCrossoverPlayoff(state, ctx, winners, runners, proxies);
    }
  }
  state.knockout.entrantIds = [...winners];
  return createKnockoutFromRanked(state, ctx, winners);
}

function createFirstKnockoutStage(state, ctx) {
  if (state.leaguePhase) {
    const lp = state.leaguePhase;
    if (lp.regions) return createRegionalKnockout(state, ctx);
    const inBand = (band) => lp.table.filter((row) => row.band === band).map((row) => clubKey(row.team));
    const direct = inBand("R16");
    const playoff = inBand("playoff");
    state.knockout.entrantIds = [...direct, ...playoff];
    if (direct.length === 8 && playoff.length === 16) {
      return createUefaPlayoffRound(state, ctx, direct, playoff);
    }
    return createKnockoutFromRanked(state, ctx, [...direct, ...playoff]);
  }
  if (state.groups) return createKnockoutAfterGroups(state, ctx);
  state.knockout.entrantIds = state.field.map(clubKey);
  return createKnockoutFromRanked(state, ctx, state.knockout.entrantIds);
}

// ---------------------------------------------------------------------------
// Playing fixtures (idempotent)
// ---------------------------------------------------------------------------

/** Strip any extra time / shootout a processor may have applied where only 90 minutes count. */
function regulationOnly(match) {
  const regHome = match.regulationHomeGoals ?? match.homeGoals;
  const regAway = match.regulationAwayGoals ?? match.awayGoals;
  const resolved =
    match.decidedBy === "extraTime" ||
    match.decidedBy === "penalties" ||
    match.penaltyHome != null ||
    (match.etHomeGoals || 0) + (match.etAwayGoals || 0) > 0;
  if (!resolved && match.homeGoals === regHome && match.awayGoals === regAway) return match;

  const events = (match.events || []).filter((e) => !e.phase || e.phase === "regulation");
  const out = {
    ...match,
    homeGoals: regHome,
    awayGoals: regAway,
    regulationHomeGoals: regHome,
    regulationAwayGoals: regAway,
    matchHomeGoals: regHome,
    matchAwayGoals: regAway,
    etHomeGoals: 0,
    etAwayGoals: 0,
    penaltyHome: null,
    penaltyAway: null,
    decidedBy: regHome === regAway ? null : "regulation",
    winnerSide: regHome > regAway ? "home" : regAway > regHome ? "away" : null,
    scoreline: `${regHome}-${regAway}`,
    events,
  };
  if (out.playerStats?.played) {
    out.playerStats = {
      ...out.playerStats,
      goals: events.filter((e) => e.type === "goal" && e.playerInvolved).length,
      assists: events.filter((e) => e.type === "assist" && e.playerInvolved).length,
    };
  }
  return out;
}

/**
 * Idempotent recount of open-play user stats from events.
 * Prefer resolveKnockout/finalizePlayerMatchStats; this only guards against
 * stale regulation-only counters after a second-leg ET/pens finalize.
 * Does NOT add on top of already-finalized totals (avoids double-count).
 */
function withExtraTimePlayerStats(leg) {
  const stats = leg.playerStats;
  if (!stats?.played) return leg;
  const openPlay = (leg.events || []).filter(
    (e) => e && e.playerInvolved && e.phase !== "penalties"
  );
  const goals = openPlay.filter((e) => e.type === "goal").length;
  const assists = openPlay.filter((e) => e.type === "assist").length;
  const yellow = openPlay.filter((e) => e.type === "yellow").length;
  const red = openPlay.filter((e) => e.type === "red").length;
  if (
    goals === (stats.goals || 0) &&
    assists === (stats.assists || 0) &&
    yellow === (stats.yellow || 0) &&
    red === (stats.red || 0)
  ) {
    return leg;
  }
  return {
    ...leg,
    playerStats: { ...stats, goals, assists, yellow, red },
  };
}

function stampMatch(match, state, fixture, playerSide) {
  return {
    ...match,
    matchId: fixture.matchId,
    fixtureId: fixture.matchId,
    competition: "europe",
    competitionType: "continental",
    competitionId: state.competitionId,
    competitionName: state.competition,
    cupName: state.competition,
    editionId: state.editionId,
    seasonYear: state.seasonYear,
    stageType: fixture.stageType,
    stageId: fixture.stageId,
    round: fixture.round,
    matchday: fixture.matchday,
    regionId: fixture.regionId,
    groupId: fixture.groupId,
    tieId: fixture.tieId,
    legNumber: fixture.legNumber,
    feedsInto: fixture.feedsInto,
    homeClubId: fixture.homeClubId,
    awayClubId: fixture.awayClubId,
    date: match.date || fixture.date,
    venue: match.venue || fixture.venue,
    playerSide: playerSide ?? null,
    isPlayerMatch: Boolean(playerSide),
    status: "played",
  };
}

function playOneMatch(state, fixture, ctx, { finalize = null } = {}) {
  const stored = playedMatch(fixture.matchId, ctx);
  if (stored) {
    return {
      match: stored,
      alreadyPlayed: true,
      playerIn: Boolean(stored.isPlayerMatch),
      playerSide: stored.playerSide ?? null,
      processorResult: null,
    };
  }

  const home = clubFor(state, fixture.homeClubId);
  const away = clubFor(state, fixture.awayClubId);
  if (!home || !away) throw new Error(`Continental fixture ${fixture.matchId} references an unknown club`);
  // Attachment requires a live player AND the dated match-day processor. Background /
  // drain paths (matchProcessor null) must simulate world-only — never invent playerMatches
  // without ledger/selection/fatigue processing.
  let playerSide = null;
  const canProcessPlayer = Boolean(ctx.player && ctx.matchProcessor);
  if (canProcessPlayer && involvesAttachedPlayer(state, fixture, ctx.player, fixture.date)) {
    playerSide = resolveValidatedClubSide({
      player: ctx.player,
      home,
      away,
      date: fixture.date,
      teamType: "club",
    });
  }
  const mustProduceWinner = fixture.stageType === "knockout" && !fixture.twoLegged;

  let processorResult = null;
  let match = null;
  if (playerSide && ctx.matchProcessor) {
    processorResult =
      ctx.matchProcessor({
        matchId: fixture.matchId,
        fixtureId: fixture.matchId,
        home,
        away,
        playerSide,
        date: fixture.date,
        label: fixture.round,
        round: fixture.round,
        competition: "europe",
        competitionType: "continental",
        competitionId: state.competitionId,
        competitionName: state.competition,
        editionId: state.editionId,
        stageType: fixture.stageType,
        stageId: fixture.stageId,
        matchday: fixture.matchday,
        regionId: fixture.regionId,
        groupId: fixture.groupId,
        tieId: fixture.tieId,
        legNumber: fixture.legNumber,
        venue: fixture.venue,
        knockout: mustProduceWinner,
      }) || null;
    match = processorResult?.match || null;
    // Match-day hard gate may have cleared the side — treat as world-only.
    if (processorResult?.playerSide === null || (match && match.playerSide === null && processorResult)) {
      playerSide = match?.playerSide ?? null;
    }
  }
  if (!match) {
    match = simulateMatch(home, away, {
      playerSide: null,
      player: null,
      competition: "europe",
      venue: fixture.venue,
      worldState: ctx.world,
      rng: ctx.rng,
      competitionId: state.competitionId,
      fixtureId: fixture.matchId,
      date: fixture.date,
    });
    playerSide = null;
  }
  if (!mustProduceWinner) match = regulationOnly(match);
  if (finalize) match = finalize(match);

  // Sync deferred ledger/counters with the finalized match (ET/pens may land after
  // processPlayerMatchDay). Must run before commit so store + ledger agree.
  if (processorResult?.ledgerRecord && match) {
    const priorExposure = Number(
      processorResult._exposureMinutesCharged ??
        processorResult.participation?.minutes ??
        processorResult.ledgerRecord.minutes ??
        0
    );
    // Prefer an explicit injury stream from the match-day processor; fall back to ctx.
    if (!processorResult._injuryRng && ctx.injuryRng) processorResult._injuryRng = ctx.injuryRng;
    syncLedgerRecordFromMatch(processorResult.ledgerRecord, match);
    applyDeferredFinalExposure(ctx.player, match, processorResult, priorExposure, fixture.date);
    // Re-sync duration/injury metadata after deferred exposure may attach injuries.
    syncLedgerRecordFromMatch(processorResult.ledgerRecord, match);
    if (typeof ctx.onPlayerMatchFinalized === "function") {
      ctx.onPlayerMatchFinalized(match, processorResult);
    }
  }

  const committed = commitMatch(stampMatch(match, state, fixture, playerSide), ctx.store);
  if (ctx.formWorld) applyMatchFormUpdate(ctx.formWorld, committed);
  return { match: committed, alreadyPlayed: false, playerIn: Boolean(playerSide), playerSide, processorResult };
}

/** Patch a match-day ledger record from a finalized match's playerStats. */
function syncLedgerRecordFromMatch(ledgerRecord, match) {
  if (!ledgerRecord || !match) return ledgerRecord;
  const ps = match.playerStats || {};
  const minutes = Number(ps.minutes) || 0;
  ledgerRecord.minutes = minutes;
  ledgerRecord.goals = ps.goals || 0;
  ledgerRecord.assists = ps.assists || 0;
  ledgerRecord.yellowCards = ps.yellow || 0;
  ledgerRecord.redCards = ps.red || 0;
  ledgerRecord.rating = ps.rating ?? null;
  ledgerRecord.matchRating = ps.rating ?? null;
  ledgerRecord.started = Boolean(ps.started);
  ledgerRecord.selected = Boolean(ps.selected ?? ledgerRecord.selected);
  ledgerRecord.available = Boolean(ps.available ?? ledgerRecord.available);
  ledgerRecord.nonParticipationReason = ps.nonParticipationReason ?? ledgerRecord.nonParticipationReason ?? null;
  // Fixture opportunity capacity follows whether ET was actually played — never
  // the user's own minutes. Keep played minutes separate from capacity.
  const regulation = Number(ledgerRecord.matchDuration) || 90;
  const capacity = fixtureOpportunityCapacity(match, regulation);
  ledgerRecord.availableMinutes = capacity;
  ledgerRecord.matchDuration = capacity;
  if (match.editionId != null && ledgerRecord.editionId == null) {
    ledgerRecord.editionId = match.editionId;
  }
  if (match.competitionId != null && ledgerRecord.competitionId == null) {
    ledgerRecord.competitionId = match.competitionId;
  }
  if (Array.isArray(match.injuryEventIds) && match.injuryEventIds.length) {
    ledgerRecord.injuryEventIds = [...match.injuryEventIds];
  }
  const conceded =
    match.playerSide === "home"
      ? match.matchAwayGoals ?? match.awayGoals
      : match.matchHomeGoals ?? match.homeGoals;
  const pos = ledgerRecord.positionPlayed || ledgerRecord.position;
  const csEligible = ["GK", "CB", "RB", "LB", "CDM"].includes(pos) && minutes >= 60;
  ledgerRecord.cleanSheetEligible = csEligible;
  if (csEligible && Number.isFinite(Number(conceded))) {
    ledgerRecord.cleanSheet = Number(conceded) === 0;
  }
  return ledgerRecord;
}

/**
 * When ET/pens finalize after match-day processing, charge only the minute delta
 * for fatigue/form/injury exposure and sync participation — never resample the
 * full fixture or double-charge.
 */
function applyDeferredFinalExposure(player, match, processorResult, priorExposureMinutes, date) {
  if (!player || !match || !processorResult || processorResult._exposureSynced) return;
  const finalMinutes = Math.max(0, Number(match.playerStats?.minutes) || 0);
  const prior = Math.max(0, Number(priorExposureMinutes) || 0);
  const delta = finalMinutes - prior;
  processorResult._exposureSynced = true;
  processorResult._exposureMinutesCharged = finalMinutes;
  const capacity = fixtureOpportunityCapacity(
    match,
    Number(processorResult.participation?.matchDuration) ||
      Number(player.matchParticipation?.matchDuration) ||
      90
  );
  if (processorResult.participation) {
    processorResult.participation = {
      ...processorResult.participation,
      minutes: finalMinutes,
      availableMinutes: capacity,
      matchDuration: capacity,
    };
  }
  if (player.matchParticipation) {
    player.matchParticipation = {
      ...player.matchParticipation,
      minutes: finalMinutes,
      matchDuration: capacity,
      availableMinutes: capacity,
    };
  }
  if (!(delta > 0)) return;
  if (player.state) {
    updateFatigue(player.state, { minutes: delta });
    if (match.playerStats?.rating != null) {
      const expected = Number(processorResult.ledgerRecord?.expectedRating);
      if (Number.isFinite(expected)) {
        const obsScale = 0.6;
        const z = Math.max(-3, Math.min(3, (match.playerStats.rating - expected) / obsScale));
        updateFormFromObservation(player.state, Math.tanh(z / 1.5), delta, date);
      }
    }
  }
  // Additional match-health exposure for newly credited minutes (exact-once).
  const injuryRng = processorResult._injuryRng;
  if (injuryRng && typeof injuryRng.random === "function") {
    const inj = sampleInjuryFromExposure({
      hours: delta / 60,
      kind: "match",
      riskMultiplier: computeRiskMultiplier(player),
      rng: injuryRng,
      eventId: `${match.fixtureId || match.matchId || "continental"}:et-inj`,
      date,
      position: player.position,
    });
    if (inj) {
      applyInjury(player, inj);
      match.injuryEventIds = [...(match.injuryEventIds || []), inj.eventId];
      if (processorResult.ledgerRecord) {
        processorResult.ledgerRecord.injuryEventIds = [...(match.injuryEventIds || [])];
      }
    }
  }
}

function resolveSingleLeg(state, fixture, match, ctx) {
  const ko = state.format.knockout || {};
  let resolved = match.winnerSide
    ? match
    : resolveKnockout(match, {
        player: match.playerSide ? ctx.player : null,
        allowExtraTime: ko.extraTime !== false,
        allowPenalties: ko.penalties !== false,
        rng: ctx.rng,
      });
  if (!resolved.winnerSide) {
    resolved = { ...resolved, winnerSide: ctx.rng.chance(0.5) ? "home" : "away", decidedBy: "lots" };
  }
  return {
    ...resolved,
    tieWinnerClubId: resolved.winnerSide === "home" ? fixture.homeClubId : fixture.awayClubId,
    tieDecidedBy: resolved.decidedBy || "regulation",
  };
}

function resolveSecondLeg(state, tie, firstLeg, secondLeg, ctx) {
  const ko = state.format.knockout || {};
  const resolved = resolveTwoLeggedTie(firstLeg, secondLeg, {
    player: secondLeg.playerSide ? ctx.player : null,
    allowExtraTime: ko.extraTime !== false,
    allowPenalties: ko.penalties !== false,
    awayGoalsRule: Boolean(ko.awayGoals),
    rng: ctx.rng,
  });
  // resolved.winnerSide is relative to the first-leg home club (tie.homeClubId).
  let winnerSide = resolved.winnerSide;
  let decidedBy = resolved.decidedBy;
  if (!winnerSide) {
    winnerSide = ctx.rng.chance(0.5) ? "home" : "away";
    decidedBy = "lots";
  }
  let leg = { ...resolved.secondLeg };
  if (decidedBy === "extraTime" || decidedBy === "penalties") {
    leg.winnerSide = winnerSide === "home" ? "away" : "home";
    leg = withExtraTimePlayerStats(leg);
    leg.scoreline = formatMatchScoreline(leg);
  }
  leg.tieWinnerClubId = winnerSide === "home" ? tie.homeClubId : tie.awayClubId;
  leg.tieDecidedBy = decidedBy;
  return leg;
}

function playKnockoutFixture(state, fixture, ctx) {
  const tie = state.knockout.ties[fixture.tieId];
  if (!tie) throw new Error(`Unknown knockout tie ${fixture.tieId}`);
  if (!tie.twoLegged) {
    return playOneMatch(state, fixture, ctx, { finalize: (m) => resolveSingleLeg(state, fixture, m, ctx) });
  }
  if (fixture.legNumber !== 2) return playOneMatch(state, fixture, ctx);

  const firstLegId = tie.legIds[0];
  let firstLeg = playedMatch(firstLegId, ctx);
  if (!firstLeg) {
    playFixture(state, firstLegId, ctx);
    firstLeg = playedMatch(firstLegId, ctx);
  }
  return playOneMatch(state, fixture, ctx, {
    finalize: (m) => resolveSecondLeg(state, tie, firstLeg, m, ctx),
  });
}

function playFixture(state, matchId, ctx) {
  const fixture = state.fixtures[matchId];
  if (!fixture) {
    return { match: null, alreadyPlayed: false, playerIn: false, playerSide: null, processorResult: null, reason: "unknown-fixture" };
  }
  const outcome =
    fixture.stageType === "knockout" ? playKnockoutFixture(state, fixture, ctx) : playOneMatch(state, fixture, ctx);
  markPlayed(state, fixture, ctx);
  return outcome;
}

function deriveTieOutcome(tie, legs) {
  const a = tie.homeClubId;
  const b = tie.awayClubId;
  const last = legs[legs.length - 1];
  const goals = (value) => Number(value) || 0;
  const aggregateA = tie.twoLegged ? goals(legs[0].homeGoals) + goals(legs[1].awayGoals) : goals(last.homeGoals);
  const aggregateB = tie.twoLegged ? goals(legs[0].awayGoals) + goals(legs[1].homeGoals) : goals(last.awayGoals);
  let penaltiesA = null;
  let penaltiesB = null;
  if (last.penaltyHome != null && last.penaltyAway != null) {
    // The deciding leg of a two-legged tie is hosted by club B.
    penaltiesA = tie.twoLegged ? last.penaltyAway : last.penaltyHome;
    penaltiesB = tie.twoLegged ? last.penaltyHome : last.penaltyAway;
  }
  let winnerClubId = null;
  if (last.tieWinnerClubId === a || last.tieWinnerClubId === b) winnerClubId = last.tieWinnerClubId;
  else if (aggregateA !== aggregateB) winnerClubId = aggregateA > aggregateB ? a : b;
  else if (penaltiesA != null && penaltiesA !== penaltiesB) winnerClubId = penaltiesA > penaltiesB ? a : b;
  else if (!tie.twoLegged && last.winnerSide) winnerClubId = last.winnerSide === "home" ? a : b;
  if (!winnerClubId) return null;
  const decidedBy =
    last.tieDecidedBy ||
    (penaltiesA != null
      ? "penalties"
      : last.decidedBy === "extraTime"
        ? "extraTime"
        : tie.twoLegged
          ? "aggregate"
          : last.decidedBy || "regulation");
  return {
    winnerClubId,
    loserClubId: winnerClubId === a ? b : a,
    decidedBy,
    aggregateA,
    aggregateB,
    penaltiesA,
    penaltiesB,
  };
}

function onTieDecided(state, tie) {
  const stage = state.knockout.stages.find((s) => s.tieIds.includes(tie.tieId));
  if (!stage) return;
  if (!stage.tieIds.every((tid) => state.knockout.ties[tid].winnerClubId)) return;
  stage.status = "complete";
  if (stage.tieIds.length === 1 && !state.knockout.plan) completeEdition(state, tie.winnerClubId);
}

function updateTieFromLegs(state, tie, ctx) {
  if (tie.winnerClubId) return;
  const legs = tie.legIds.map((id) => playedMatch(id, ctx));
  if (legs.some((leg) => !leg)) {
    tie.status = legs.some(Boolean) ? "in_progress" : "scheduled";
    return;
  }
  const outcome = deriveTieOutcome(tie, legs);
  if (!outcome) throw new Error(`Knockout tie ${tie.tieId} finished without a winner`);
  Object.assign(tie, outcome, { status: "decided" });
  const home = clubFor(state, tie.homeClubId);
  const away = clubFor(state, tie.awayClubId);
  commitTie(
    {
      tieId: tie.tieId,
      competitionId: state.competitionId,
      editionId: state.editionId,
      stageId: tie.stageId,
      round: tie.round,
      regionId: tie.regionId,
      home: clubSummary(home),
      away: clubSummary(away),
      homeClubId: tie.homeClubId,
      awayClubId: tie.awayClubId,
      legIds: [...tie.legIds],
      winner: clubFor(state, tie.winnerClubId)?.name ?? null,
      winnerClubId: tie.winnerClubId,
      winnerSide: tie.winnerClubId === tie.homeClubId ? "home" : "away",
      decidedBy: tie.decidedBy,
      aggregate: `${tie.aggregateA}-${tie.aggregateB}`,
      penalties: tie.penaltiesA != null ? `${tie.penaltiesA}-${tie.penaltiesB}` : null,
      feedsInto: tie.feedsInto,
    },
    ctx.store
  );
  onTieDecided(state, tie);
}

/** Bookkeeping for a committed fixture; safe to repeat. */
function markPlayed(state, fixture, ctx) {
  const stored = playedMatch(fixture.matchId, ctx);
  if (!stored) return;
  const idx = state.scheduledFixtureIds.indexOf(fixture.matchId);
  if (idx >= 0) state.scheduledFixtureIds.splice(idx, 1);
  pushUnique(state.playedFixtureIds, fixture.matchId);
  // Only user-attached appearances enter playerMatchIds (not every focus-club world fixture).
  if (stored.isPlayerMatch || stored.playerSide) {
    pushUnique(state.playerMatchIds, fixture.matchId);
    const phaseList =
      fixture.stageType === "league"
        ? state.leaguePhase?.playerMatchIds
        : fixture.stageType === "groups"
          ? state.groups?.playerMatchIds
          : state.knockout.playerMatchIds;
    pushUnique(phaseList, fixture.matchId);
  }
  if (fixture.stageType === "knockout") {
    const tie = state.knockout.ties[fixture.tieId];
    if (tie) updateTieFromLegs(state, tie, ctx);
  }
}

/** Adopt results already committed to the store (e.g. state restored from an older snapshot). */
function syncFromStore(state, ctx) {
  for (const id of [...state.scheduledFixtureIds]) {
    if (playedMatch(id, ctx)) markPlayed(state, state.fixtures[id], ctx);
  }
}

function advanceInternal(state, ctx) {
  const before = new Set(state.scheduledFixtureIds);
  const result = (advanced, reason = null) => ({
    advanced,
    reason,
    stageId: state.stageId,
    status: state.status,
    createdFixtureIds: state.scheduledFixtureIds.filter((id) => !before.has(id)),
  });
  if (state.status === "complete") return result(false, "complete");
  if (state.status === "league") {
    if (!completeOpeningIfDone(state, ctx)) return result(false, "opening-incomplete");
    createFirstKnockoutStage(state, ctx);
    return result(true);
  }
  const current = state.knockout.stages[state.knockout.stages.length - 1];
  if (!current) {
    createFirstKnockoutStage(state, ctx);
    return result(true);
  }
  if (current.status !== "complete") return result(false, "stage-incomplete");
  if (!state.knockout.plan) {
    completeEdition(state, state.knockout.ties[current.tieIds[0]]?.winnerClubId || null);
    return result(false, "complete");
  }
  createStageFromPlan(state);
  return result(true);
}

// ---------------------------------------------------------------------------
// Projections (tables, bracket cards, player path) from committed results
// ---------------------------------------------------------------------------

function tieCard(state, tie, ctx) {
  const legs = tie.legIds.map((id) => playedMatch(id, ctx));
  const home = clubFor(state, tie.homeClubId);
  const away = clubFor(state, tie.awayClubId);
  const playerSide =
    tie.homeClubId === state.playerClubId ? "home" : tie.awayClubId === state.playerClubId ? "away" : null;
  const firstFixture = state.fixtures[tie.legIds[0]];
  const pending = {
    home,
    away,
    round: tie.round,
    stageId: tie.stageId,
    cupName: state.competition,
    competitionId: state.competitionId,
    editionId: state.editionId,
    tieId: tie.tieId,
    regionId: tie.regionId,
    feedsInto: tie.feedsInto,
    playerSide,
    date: firstFixture?.date ?? null,
    homeGoals: null,
    awayGoals: null,
    matchHomeGoals: null,
    matchAwayGoals: null,
    winnerSide: null,
    decidedBy: null,
    scoreline: "vs",
    status: "scheduled",
  };

  if (!tie.twoLegged) {
    return legs[0] || { ...pending, matchId: tie.legIds[0] };
  }

  const [first, second] = legs;
  const aggregate = { ...pending, legIds: [...tie.legIds], legs: legs.filter(Boolean), isAggregate: true };
  if (!first) return aggregate;
  const aggA = (first.homeGoals || 0) + (second ? second.awayGoals || 0 : 0);
  const aggB = (first.awayGoals || 0) + (second ? second.homeGoals || 0 : 0);
  if (!second) {
    return {
      ...aggregate,
      homeGoals: aggA,
      awayGoals: aggB,
      matchHomeGoals: aggA,
      matchAwayGoals: aggB,
      scoreline: `${aggA}-${aggB} (1st leg)`,
      status: "in_progress",
    };
  }
  const decidedBy = tie.decidedBy || "aggregate";
  const penaltyHome = decidedBy === "penalties" ? tie.penaltiesA : null;
  const penaltyAway = decidedBy === "penalties" ? tie.penaltiesB : null;
  let scoreline = `${aggA}-${aggB}`;
  if (decidedBy === "extraTime") scoreline += " (aet)";
  if (penaltyHome != null) scoreline += ` (${penaltyHome}-${penaltyAway} pens)`;
  return {
    ...aggregate,
    homeGoals: aggA,
    awayGoals: aggB,
    matchHomeGoals: aggA,
    matchAwayGoals: aggB,
    aggregateA: aggA,
    aggregateB: aggB,
    winnerSide: tie.winnerClubId ? (tie.winnerClubId === tie.homeClubId ? "home" : "away") : null,
    decidedBy,
    penaltyHome,
    penaltyAway,
    scoreline,
    status: tie.winnerClubId ? "played" : "in_progress",
  };
}

function refreshProjections(state, ctx) {
  const uefaStyle = state.confederation === "UEFA";
  const lp = state.leaguePhase;
  if (lp) {
    lp.matches = lp.fixtureIds.map((id) => playedMatch(id, ctx)).filter(Boolean);
    if (!lp.frozen) {
      if (lp.regions) {
        lp.regionOrder.forEach((rid) => {
          const unit = lp.regions[rid];
          unit.table = unitTable(state, ctx, unit.clubIds, unit.fixtureIds, regionalTableFormat(lp), uefaStyle);
          unit.table.forEach((row) => { row.region = rid; });
        });
        lp.table = lp.regionOrder.flatMap((rid) => lp.regions[rid].table);
      } else {
        lp.table = unitTable(state, ctx, lp.clubIds, lp.fixtureIds, lp.format, uefaStyle);
      }
    }
  }

  const g = state.groups;
  if (g) {
    g.groups.forEach((group) => {
      group.matches = group.fixtureIds.map((id) => playedMatch(id, ctx)).filter(Boolean);
      if (!group.frozen) {
        group.table = unitTable(state, ctx, group.clubIds, group.fixtureIds, {}, false);
        group.table.forEach((row) => { row.band = groupBand(state, row.position); });
      }
    });
    g.matches = g.groups.flatMap((group) => group.matches);
  }

  const ko = state.knockout;
  ko.allRounds = ko.stages.map((stage) => ({
    round: stage.label,
    stageId: stage.stageId,
    matches: stage.tieIds.map((tid) => tieCard(state, ko.ties[tid], ctx)),
  }));
  ko.feederGraph = ko.stages.flatMap((stage) =>
    stage.tieIds.map((tid) => {
      const tie = ko.ties[tid];
      return {
        tieId: tid,
        round: stage.label,
        stageId: stage.stageId,
        home: clubFor(state, tie.homeClubId)?.name ?? null,
        away: clubFor(state, tie.awayClubId)?.name ?? null,
        homeClubId: tie.homeClubId,
        awayClubId: tie.awayClubId,
        winner: tie.winnerClubId ? clubFor(state, tie.winnerClubId)?.name ?? null : null,
        winnerClubId: tie.winnerClubId || null,
        feedsInto: tie.feedsInto || null,
        feedSlot: tie.feedSlot || null,
      };
    })
  );

  const rounds = [];
  let eliminatedRound = null;
  ko.stages.forEach((stage, si) => {
    stage.tieIds.forEach((tid, ti) => {
      const tie = ko.ties[tid];
      // Focus-club path for campaign bracket narrative (not live user attachment).
      if (!involvesFocusClub(state, tie)) return;
      const card = ko.allRounds[si].matches[ti];
      const fromPlayerSide = tie.homeClubId === state.playerClubId ? "home" : "away";
      const opponent = clubFor(state, fromPlayerSide === "home" ? tie.awayClubId : tie.homeClubId);
      const decided = Boolean(tie.winnerClubId);
      const qualified = decided ? tie.winnerClubId === state.playerClubId : null;
      if (decided && !qualified) eliminatedRound = stage.label;
      rounds.push({
        round: stage.label,
        stageId: stage.stageId,
        tieId: tid,
        opponent: opponent?.displayName ?? opponent?.name ?? null,
        opponentBadge: opponent?.badge ?? null,
        score: card.status === "scheduled" ? "vs" : formatMatchScoreline(card, { fromPlayerSide }),
        qualified,
        decided,
        match: card,
      });
    });
  });
  ko.rounds = rounds;
  ko.eliminatedRound = eliminatedRound;
}

function openingEliminated(state) {
  const qualifiers = openingQualifierIds(state);
  return Boolean(qualifiers) && !qualifiers.includes(state.playerClubId);
}

function playerMatchesInOrder(state, ctx) {
  return state.playerMatchIds
    .map((id) => state.fixtures[id])
    .filter(Boolean)
    .sort(fixtureOrder)
    .map((fixture) => playedMatch(fixture.matchId, ctx))
    .filter(Boolean);
}

function assembleCampaignResult(state, ctx) {
  const ko = state.knockout;
  const lp = state.leaguePhase;
  const g = state.groups;
  const winner = ko.winnerClubId ? clubFor(state, ko.winnerClubId) : null;
  // `won` = edition focus club won the competition (world result). Career honors must
  // separately check player entitlement against winningClubId.
  const focusWon = Boolean(winner) && ko.winnerClubId === state.playerClubId;
  const openingLabel = lp ? STAGE_LABELS.league : g ? STAGE_LABELS.groups : null;
  const eliminatedRound = ko.eliminatedRound || (openingEliminated(state) ? openingLabel : null);

  let result;
  if (focusWon) result = "Winners";
  else if (eliminatedRound === "Final") result = "Runner-up";
  else if (eliminatedRound) result = eliminatedRound;
  else if (state.status === "complete") result = openingLabel || STAGE_LABELS.R16;
  else result = "In progress";

  const finalRound = ko.allRounds.find((round) => round.stageId === "Final");
  const finalCard = finalRound?.matches?.[0] || null;
  const finalMatch = finalCard?.status === "played" ? finalCard : null;

  return {
    kind: CAMPAIGN_KIND,
    lifecycleVersion: LIFECYCLE_VERSION,
    competition: state.competition,
    competitionId: state.competitionId,
    ruleVersion: state.format?.ruleVersion || null,
    seasonYear: state.seasonYear,
    status: state.status,
    stageId: state.stageId,
    result,
    won: focusWon,
    winningClubId: ko.winnerClubId || null,
    focusClubId: state.playerClubId || null,
    qualified: true,
    showcase: false,
    eliminatedRound,
    rounds: ko.rounds,
    playerMatches: playerMatchesInOrder(state, ctx),
    allRounds: ko.allRounds,
    feederGraph: ko.feederGraph,
    leaguePhase: lp
      ? {
          table: lp.table,
          matches: lp.matches,
          openingLabel: STAGE_LABELS.league,
          frozen: lp.frozen,
          provisional: !lp.frozen,
          regionId: lp.regionId,
          ...(lp.regions
            ? { regional: Object.fromEntries(lp.regionOrder.map((rid) => [rid, lp.regions[rid].table])) }
            : {}),
        }
      : null,
    groups: g
      ? {
          groups: g.groups.map((group) => ({
            name: group.name,
            groupId: group.groupId,
            table: group.table,
            matches: group.matches,
            qualifiers: group.qualifierIds.map((id) => clubFor(state, id)).filter(Boolean),
            third: group.thirdId ? clubFor(state, group.thirdId) : null,
          })),
          matches: g.matches,
          openingLabel: STAGE_LABELS.groups,
          thirds: g.groups
            .map((group, groupIndex) => (group.table[2] ? { ...group.table[2], groupIndex } : null))
            .filter(Boolean),
          frozen: g.frozen,
        }
      : null,
    finalMatch,
    finalists: finalMatch ? [{ ...finalMatch.home }, { ...finalMatch.away }] : null,
    winner: winner ? winner.displayName ?? winner.name : null,
    winnerData: clubSummary(winner),
    field: state.field.map((club) => ({
      name: club.name,
      displayName: club.displayName,
      clubId: club.clubId,
      badge: club.badge,
    })),
    editionId: state.editionId,
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** JSON-safe copy without the projection caches (they are rebuilt from the store). */
function snapshotEditionState(state) {
  return JSON.parse(
    JSON.stringify({
      ...state,
      leaguePhase: state.leaguePhase ? { ...state.leaguePhase, matches: [] } : null,
      groups: state.groups
        ? {
            ...state.groups,
            matches: [],
            groups: state.groups.groups.map((group) => ({ ...group, matches: [] })),
          }
        : null,
      knockout: { ...state.knockout, allRounds: [], rounds: [], feederGraph: [] },
    })
  );
}

function editionStages(state) {
  const stages = [];
  if (state.leaguePhase) {
    stages.push({ stageId: "league", name: STAGE_LABELS.league, type: "league", status: state.leaguePhase.frozen ? "complete" : "in_progress" });
  }
  if (state.groups) {
    stages.push({ stageId: "groups", name: STAGE_LABELS.groups, type: "groups", status: state.groups.frozen ? "complete" : "in_progress" });
  }
  state.knockout.stages.forEach((stage) => {
    stages.push({ stageId: stage.stageId, name: stage.label, type: "knockout", status: stage.status });
  });
  return stages;
}

function persistEdition(state, ctx) {
  const record =
    getEdition(state.competitionId, state.editionId, ctx.store) ||
    createEdition({
      competitionId: state.competitionId,
      editionId: state.editionId,
      name: state.competition,
      ruleVersion: state.format?.ruleVersion || "game",
      kind: "club",
      confederation: state.confederation,
      participants: state.field,
      stages: [],
      seasonYear: state.seasonYear,
    });
  const winner = state.knockout.winnerClubId ? clubFor(state, state.knockout.winnerClubId) : null;
  record.participants = state.field.map((club) => ({ ...club }));
  record.stages = editionStages(state);
  record.currentStageId = state.stageId;
  record.status = state.status === "complete" ? "complete" : "in_progress";
  record.champion = winner ? { name: winner.name, displayName: winner.displayName, clubId: winner.clubId } : null;
  record.playerClubId = state.playerClubId;
  record.lifecycle = snapshotEditionState(state);
  commitEdition(record, ctx.store);
}

// ---------------------------------------------------------------------------
// Public lifecycle API
// ---------------------------------------------------------------------------

/**
 * Restore a persisted edition state from the competition store (null if absent).
 */
export function loadContinentalEdition({ competitionId, editionId, world = null } = {}) {
  const store = world || getWorldState();
  if (!store || !competitionId || !editionId) return null;
  const record = getEdition(competitionId, editionId, store);
  if (!record?.lifecycle) return null;
  const state = JSON.parse(JSON.stringify(record.lifecycle));
  refreshProjections(state, resolveContext(state, { world: store }));
  return state;
}

/**
 * Qualify, build the field and draw/schedule the opening phase — no results.
 * League/group competitions return `status: "league"` with every opening fixture scheduled;
 * knockout-only competitions (Concacaf) return `status: "knockout"` with the first round scheduled.
 * An edition already persisted for this competition, season and club is returned as-is.
 *
 * @returns persistable edition state, or null when the standing does not qualify
 */
export function prepareContinentalEdition({ standing, league, player, seasonYear = null, rng = null, world = null } = {}) {
  const competition = continentalCompetitionForStanding(standing, league);
  if (!competition) return null;

  const format = JSON.parse(JSON.stringify(formatForCompetitionName(competition) || fallbackFormat(competition)));
  const liveWorld = world || getWorldState() || null;
  const seasonStartYear = Number(seasonYear || liveWorld?.seasonYear || 2026);
  const competitionId = competitionIdSlug(competition, format);
  const editionId = buildEditionId(seasonStartYear, competitionId);
  const confederation = format.confederation || confederationForCompetition(competition);

  const playerClub = playerClubEntry(player, league);
  const eff = effectiveTeamStrength(playerClub, {
    player,
    playerSide: "home",
    side: "home",
    worldState: liveWorld,
  });
  playerClub.overall = eff.profile?.overall ?? playerClub.overall;

  if (liveWorld) {
    const existing = loadContinentalEdition({ competitionId, editionId, world: liveWorld });
    if (existing && existing.playerClubId === clubKey(playerClub)) return existing;
  }

  const state = createEditionState({
    competition,
    competitionId,
    format,
    confederation,
    editionId,
    seasonYear: seasonStartYear,
    playerClub,
  });
  const ctx = resolveContext(state, { world: liveWorld, rng, player });
  if (format.openingPhase === "league") prepareLeaguePhase(state, ctx);
  else if (format.openingPhase === "groups") prepareGroupStage(state, ctx);
  else prepareKnockoutOnly(state, ctx);
  refreshProjections(state, ctx);
  persistEdition(state, ctx);
  return state;
}

/**
 * Play every opening-phase (league phase or group stage) fixture of one matchday, once.
 * Draws stay draws: no knockout resolution is ever applied here.
 *
 * `matchProcessor(request) → { match, participation?, ledgerRecord? }` simulates fixtures
 * involving the player's club (e.g. via processPlayerMatchDay). `request` carries matchId,
 * home, away, playerSide, date, label, venue, stage metadata and `knockout` — true only for
 * single-leg knockout matches, the one case where the processor may resolve ET/penalties.
 * Anything else it resolves is reverted to the 90-minute result.
 */
export function processContinentalMatchday(editionState, matchday, opts = {}) {
  if (!editionState?.fixtures) return null;
  const state = editionState;
  const ctx = resolveContext(state, opts);
  syncFromStore(state, ctx);
  const md = Number(matchday);
  const ids = Object.values(state.fixtures)
    .filter((f) => f.stageType !== "knockout" && f.matchday === md)
    .sort((a, b) => a.seq - b.seq)
    .map((f) => f.matchId);

  const matches = [];
  const playerMatches = [];
  const processorResults = [];
  for (const id of ids) {
    const outcome = playFixture(state, id, ctx);
    if (!outcome.match) continue;
    matches.push(outcome.match);
    if (outcome.playerIn) playerMatches.push(outcome.match);
    if (outcome.processorResult) processorResults.push(outcome.processorResult);
  }
  const openingComplete = completeOpeningIfDone(state, ctx);
  refreshProjections(state, ctx);
  persistEdition(state, ctx);
  return { editionState: state, matchday: md, matches, playerMatches, processorResults, openingComplete };
}

/**
 * Play one scheduled fixture. A fixture already committed to the store is returned without
 * touching the RNG, form or ledger. A second leg auto-plays its missing first leg, then
 * resolves the tie (aggregate → ET → penalties) before the leg is committed.
 */
export function processContinentalFixture(editionState, matchId, opts = {}) {
  if (!editionState?.fixtures) return null;
  const state = editionState;
  const ctx = resolveContext(state, opts);
  syncFromStore(state, ctx);
  const outcome = playFixture(state, matchId, ctx);
  const fixture = state.fixtures[matchId];
  const tie = fixture?.tieId ? state.knockout.ties[fixture.tieId] : null;
  const openingComplete = completeOpeningIfDone(state, ctx);
  refreshProjections(state, ctx);
  persistEdition(state, ctx);
  return {
    editionState: state,
    ...outcome,
    tie: tie ? { ...tie, legIds: [...tie.legIds] } : null,
    openingComplete,
    stageId: state.stageId,
    status: state.status,
  };
}

/**
 * Move the edition forward one step once the current phase is fully played:
 * freeze the opening tables and create the first knockout round (UEFA: the playoff round
 * only), or create the next round from the decided ties. No-op while fixtures are pending.
 *
 * @returns {{ editionState, advanced, reason, stageId, status, createdFixtureIds }}
 */
export function advanceContinentalStage(editionState, opts = {}) {
  if (!editionState?.fixtures) return null;
  const state = editionState;
  const ctx = resolveContext(state, opts);
  syncFromStore(state, ctx);
  const outcome = advanceInternal(state, ctx);
  refreshProjections(state, ctx);
  persistEdition(state, ctx);
  return { editionState: state, ...outcome };
}

/**
 * Play exactly the knockout playoff round (UEFA: 8 two-legged ties → 8 winners), creating it
 * first if the league phase has just finished. Never plays beyond the playoff round.
 */
export function simulatePlayoffRound(editionState, opts = {}) {
  if (!editionState?.fixtures) return null;
  const state = editionState;
  const ctx = resolveContext(state, opts);
  syncFromStore(state, ctx);
  if (state.status === "league") {
    if (!completeOpeningIfDone(state, ctx)) return null;
    advanceInternal(state, ctx);
  }
  const stage = state.knockout.stages.find((s) => s.stageId === "playoff");
  if (!stage) return null;
  stage.tieIds
    .flatMap((tid) => state.knockout.ties[tid].legIds)
    .map((id) => state.fixtures[id])
    .sort(fixtureOrder)
    .forEach((fixture) => playFixture(state, fixture.matchId, ctx));
  refreshProjections(state, ctx);
  persistEdition(state, ctx);
  const ties = stage.tieIds.map((tid) => ({ ...state.knockout.ties[tid] }));
  return {
    editionState: state,
    stageId: stage.stageId,
    ties,
    winners: ties.map((tie) => clubFor(state, tie.winnerClubId)).filter(Boolean),
  };
}

/** Scheduled / played fixture descriptors in calendar order (for chronology event planning). */
export function listContinentalFixtures(
  editionState,
  { status = "all", playerOnly = false, stageId = null, player = null } = {}
) {
  if (!editionState?.fixtures) return [];
  const played = new Set(editionState.playedFixtureIds);
  const attach = (f) => involvesAttachedPlayer(editionState, f, player, f.date);
  return Object.values(editionState.fixtures)
    .filter((f) => status === "all" || (status === "played" ? played.has(f.matchId) : !played.has(f.matchId)))
    .filter((f) => !playerOnly || attach(f))
    .filter((f) => !stageId || f.stageId === stageId)
    .sort(fixtureOrder)
    .map((f) => ({ ...f, played: played.has(f.matchId), isPlayerFixture: attach(f) }));
}

/**
 * Play everything that remains (e.g. after the player's club is eliminated) through the
 * same fixture/advance steps, without per-fixture calendar waits.
 */
export function drainContinentalEdition(editionState, opts = {}) {
  if (!editionState?.fixtures) return null;
  const state = editionState;
  const ctx = resolveContext(state, opts);
  syncFromStore(state, ctx);
  for (let guard = 0; state.status !== "complete"; guard++) {
    if (guard > 128) throw new Error(`Continental edition ${state.editionId} did not complete`);
    const pending = state.scheduledFixtureIds.map((id) => state.fixtures[id]).sort(fixtureOrder);
    if (pending.length) {
      pending.forEach((fixture) => playFixture(state, fixture.matchId, ctx));
      continue;
    }
    const step = advanceInternal(state, ctx);
    if (!step.advanced && state.status !== "complete") {
      throw new Error(`Continental edition ${state.editionId} stalled at ${state.stageId}: ${step.reason}`);
    }
  }
  refreshProjections(state, ctx);
  persistEdition(state, ctx);
  return state;
}

/**
 * UI campaign projected from committed results (compatible with the legacy campaign shape:
 * competition, result, won, rounds, playerMatches, allRounds, feederGraph, leaguePhase,
 * groups, finalMatch, finalists, winner, winnerData, field, editionId).
 */
export function buildContinentalCampaignView(editionState, { playerName = null, world = null } = {}) {
  if (!editionState?.fixtures) return null;
  const ctx = resolveContext(editionState, { world, playerName });
  syncFromStore(editionState, ctx);
  refreshProjections(editionState, ctx);
  return assembleCampaignResult(editionState, ctx);
}

/**
 * Full continental campaign for the player's qualified club, drained through the same
 * lifecycle chronology uses: prepare → every opening matchday → advance/play each
 * knockout round → view.
 */
export function simulateContinentalCampaign({ standing, league, player, seasonYear = null }) {
  const state = prepareContinentalEdition({ standing, league, player, seasonYear });
  if (!state) return null;
  const opts = { player, playerName: state.playerClub?.name };

  for (const matchday of state.openingMatchdays) {
    processContinentalMatchday(state, matchday, opts);
  }
  for (let guard = 0; state.status !== "complete"; guard++) {
    if (guard > 64) throw new Error(`Continental edition ${state.editionId} did not complete`);
    const step = advanceContinentalStage(state, opts);
    const pending = listContinentalFixtures(state, { status: "scheduled" });
    if (!step.advanced && !pending.length && state.status !== "complete") {
      throw new Error(`Continental edition ${state.editionId} stalled at ${state.stageId}: ${step.reason}`);
    }
    for (const fixture of pending) {
      processContinentalFixture(state, fixture.matchId, opts);
    }
  }
  return buildContinentalCampaignView(state, opts);
}

function isContinentalCampaign(campaign) {
  return (
    campaign?.kind === CAMPAIGN_KIND ||
    Boolean(campaign?.editionId && campaign?.competitionId && "leaguePhase" in campaign)
  );
}

/**
 * Legacy reconciliation for INTERNATIONAL tournaments: replace pre-simulated player ties in
 * `allRounds` with chronologically re-simulated matches.
 *
 * Continental gameplay no longer uses this — chronology drives the edition lifecycle and every
 * fixture is committed once. For a continental campaign the canonical view is rebuilt from the
 * competition store when the edition is persisted there and the given matches are committed
 * fixtures; otherwise the campaign is returned with `playerMatches` replaced and the bracket
 * untouched (no speculative bracket patching).
 */
export function reconcileCampaignWithPlayerMatches(campaign, playerMatches, { world = null } = {}) {
  if (!campaign) return campaign;
  if (isContinentalCampaign(campaign)) {
    const store = world || getWorldState();
    const list = playerMatches || [];
    const state = store
      ? loadContinentalEdition({ competitionId: campaign.competitionId, editionId: campaign.editionId, world: store })
      : null;
    const committed = list.every((m) => m?.matchId && getMatch(m.matchId, store)?.status === "played");
    if (state && committed) return buildContinentalCampaignView(state, { world: store });
    return list.length ? { ...campaign, playerMatches: list } : campaign;
  }

  if (!playerMatches?.length) return campaign;
  const allRounds = (campaign.allRounds || []).map((round) => ({
    ...round,
    matches: (round.matches || []).map((m) => {
      const replacement = playerMatches.find(
        (pm) =>
          (pm.tieId && pm.tieId === m.tieId) ||
          (pm.round === m.round &&
            ((pm.home?.name === m.home?.name && pm.away?.name === m.away?.name) ||
              (pm.home?.name === m.away?.name && pm.away?.name === m.home?.name)))
      );
      return replacement || m;
    }),
  }));
  return {
    ...campaign,
    allRounds,
    playerMatches,
  };
}
