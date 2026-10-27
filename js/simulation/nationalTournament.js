/**
 * National tournament lifecycle: prepare (draw/schedule only) → play once →
 * commit → advance → project view. Chronological careers must use this path;
 * never batch-simulate then re-simulate player fixtures.
 */

import { NATIONAL_FORMATS } from "../data/competitions/formats.js";
import {
  EURO_R16_SKELETON,
  EURO_QF_FEEDERS,
  EURO_SF_FEEDERS,
  EURO_FINAL,
  WC_R32_SKELETON,
  WC_R16_FEEDERS,
  WC_QF_FEEDERS,
  WC_SF_FEEDERS,
  WC_FINAL,
  WC_THIRD_PLACE,
  allocateEuroThirds,
  allocateWorldCupThirds,
} from "../data/competitions/nationalBrackets.js";
import {
  confederationForNation,
  tournamentsForYear,
} from "../data/internationalCalendar.js";
import { getNationProfile } from "../data/strength/nationProfiles.js";
import {
  createEdition,
  commitEdition,
  commitMatch,
  getEdition,
  getMatch,
} from "./competitionStore.js";
import { resolveKnockout, simulateMatch, formatMatchScoreline } from "./matchEngine.js";
import {
  accountNationalTable,
  rankNationalGroup,
  rankBestThirds,
} from "./nationalTable.js";
import {
  buildField,
  eligiblePool,
  nationTeam,
  nationalCallUpChance,
} from "./nationalHelpers.js";
import { getSimRng } from "./rng.js";
import { addDays, simDate } from "./seasonCalendar.js?v=89";
import { applyMatchFormUpdate, getWorldState } from "./worldState.js";

const GROUP_LETTERS = "ABCDEFGHIJKL";

function resolveFormat(tournament) {
  const base = NATIONAL_FORMATS[tournament.id] || {};
  return {
    ...base,
    competitionId: tournament.id || base.competitionId,
    name: tournament.name || base.name,
    fieldSize: tournament.fieldSize ?? base.fieldSize,
    groupSize: tournament.groupSize ?? base.groupSize ?? 4,
    advancePerGroup: base.advancePerGroup ?? 2,
    bestThirds: tournament.bestThirds ?? base.bestThirds ?? 0,
    knockoutStart: base.knockoutStart || "R16",
    thirdPlaceMatch: tournament.thirdPlaceMatch ?? base.thirdPlaceMatch ?? false,
    ruleVersion: base.ruleVersion || "game-policy",
    confederation: tournament.confederation || base.confederation || null,
  };
}

function groupLetter(index) {
  return GROUP_LETTERS[index] || String(index);
}

function roundRobinMatchdays(teams) {
  // Circle method for even n; for odd, bye handled by skipping null.
  const n = teams.length;
  if (n < 2) return [];
  const rotating = [...teams];
  const hasBye = n % 2 === 1;
  if (hasBye) rotating.push(null);
  const total = rotating.length;
  const rounds = total - 1;
  const half = total / 2;
  const matchdays = [];
  for (let r = 0; r < rounds; r++) {
    const pairs = [];
    for (let i = 0; i < half; i++) {
      const a = rotating[i];
      const b = rotating[total - 1 - i];
      if (a && b) pairs.push([a, b]);
    }
    matchdays.push(pairs);
    // Rotate all but first
    const fixed = rotating[0];
    const rest = rotating.slice(1);
    rest.unshift(rest.pop());
    rotating.splice(0, rotating.length, fixed, ...rest);
  }
  return matchdays;
}

function nationRowMeta(name, groupId) {
  const profile = getNationProfile(name);
  const team = nationTeam(name);
  return {
    ...team,
    groupId,
    fifaRank: profile?.fifaRank ?? profile?.rank ?? null,
    disciplinaryScore: 0,
  };
}

function fixtureSort(a, b) {
  return (
    String(a.date || "").localeCompare(String(b.date || "")) ||
    String(a.matchId || "").localeCompare(String(b.matchId || ""))
  );
}

function resolveContext(state, opts = {}) {
  return {
    player: opts.player || null,
    playerName: opts.playerName || opts.player?.nationality || state.playerNation,
    rng: opts.rng || getSimRng(),
    world: opts.world || getWorldState(),
    matchProcessor: opts.matchProcessor || null,
  };
}

function persistEdition(state, ctx) {
  if (!ctx.world) return state;
  const edition = createEdition({
    competitionId: state.competitionId,
    editionId: state.editionId,
    name: state.name,
    ruleVersion: state.ruleVersion,
    kind: "national",
    confederation: state.confederation,
    participants: state.field.map((name) => ({
      participantId: name,
      name,
      type: "nation",
    })),
    stages: state.stageList || [],
    seasonYear: state.editionYear,
  });
  edition.status = state.status;
  edition.champion = state.champion || null;
  edition.nationalState = {
    field: state.field,
    groups: state.groups.map((g) => ({
      groupId: g.groupId,
      name: g.name,
      participants: g.participants,
      table: g.table,
      qualifiers: g.qualifiers,
      third: g.third,
      finalized: g.finalized,
    })),
    calledUp: state.calledUp,
    playerNation: state.playerNation,
    stageId: state.stageId,
    status: state.status,
    openingMatchdays: state.openingMatchdays,
    thirdPlaceMatch: state.thirdPlaceMatch,
    bestThirds: state.bestThirds,
    advancePerGroup: state.advancePerGroup,
    knockoutStart: state.knockoutStart,
    fixtures: state.fixtures,
    fixtureIds: Object.keys(state.fixtures),
    playedFixtureIds: [...state.playedFixtureIds],
    scheduledFixtureIds: [...state.scheduledFixtureIds],
    bracket: state.bracket,
    qualification: state.qualification,
    bestThirdTable: state.bestThirdTable,
    _koPlan: state._koPlan || null,
    _poolKoRemaining: state._poolKoRemaining || false,
    shortName: state.shortName,
  };
  commitEdition(edition, ctx.world);
  return state;
}

function syncFromStore(state, ctx) {
  if (!ctx.world?.matches) return;
  for (const id of Object.keys(state.fixtures)) {
    const stored = getMatch(id, ctx.world);
    if (stored?.status === "played") {
      state.fixtures[id] = { ...state.fixtures[id], ...stored, status: "played" };
      if (!state.playedFixtureIds.includes(id)) state.playedFixtureIds.push(id);
      state.scheduledFixtureIds = state.scheduledFixtureIds.filter((x) => x !== id);
    }
  }
}

function scheduleGroupFixtures(state) {
  const year = state.editionYear;
  const base = simDate(year, 6, 12);
  for (const group of state.groups) {
    const mds = roundRobinMatchdays(group.participants);
    group.matchdays = mds.length;
    mds.forEach((pairs, mdIndex) => {
      const md = mdIndex + 1;
      const date = addDays(base, (md - 1) * 5 + state.groups.indexOf(group) % 2);
      pairs.forEach(([homeName, awayName], slot) => {
        const matchId = `${state.competitionId}:${state.editionYear}:group:${group.groupId}:md${md}:slot${slot}`;
        const fixture = {
          matchId,
          fixtureId: matchId,
          competitionId: state.competitionId,
          editionId: state.editionId,
          ruleVersion: state.ruleVersion,
          stageId: "group",
          stageType: "group",
          groupId: group.groupId,
          matchday: md,
          homeParticipantId: homeName,
          awayParticipantId: awayName,
          home: nationTeam(homeName),
          away: nationTeam(awayName),
          date,
          kickoffBatchId: `${state.editionId}:group:${group.groupId}:md${md}`,
          venue: "neutral",
          status: "scheduled",
          seq: md * 10 + slot,
        };
        state.fixtures[matchId] = fixture;
        state.scheduledFixtureIds.push(matchId);
      });
      if (!state.openingMatchdays.includes(md)) state.openingMatchdays.push(md);
    });
  }
  state.openingMatchdays.sort((a, b) => a - b);
}

/**
 * Prepare a national edition: field draw, call-up flag, group schedule only.
 * Does not simulate matches or apply form/player effects.
 */
export function prepareNationalEdition({
  tournament,
  player,
  calledUp = false,
  forceIncludeIfEligible = false,
  calendarYear = null,
  world = null,
  rng = null,
} = {}) {
  const format = resolveFormat(tournament);
  const editionYear = Number(tournament.editionYear || tournament.year || calendarYear);
  const competitionId = format.competitionId;
  const editionId = `${editionYear}-${competitionId}`;
  const liveWorld = world || getWorldState();
  if (liveWorld) {
    const existing = loadNationalEdition({ competitionId, editionId, world: liveWorld });
    if (existing) return existing;
  }

  const playerNation = player?.nationality || null;
  const pool = eligiblePool({ ...tournament, ...format });
  const nationEligible = playerNation && pool.includes(playerNation);
  const field = buildField({ ...tournament, ...format }, playerNation, {
    forceIncludeEligibleNation: Boolean(forceIncludeIfEligible && nationEligible),
  });

  const groupSize = format.groupSize;
  const groupCount = field.length / groupSize;
  if (!Number.isInteger(groupCount)) {
    throw new Error(`${format.name}: field ${field.length} not divisible by ${groupSize}`);
  }

  const groups = [];
  for (let g = 0; g < groupCount; g++) {
    const letter = groupLetter(g);
    const participants = field.slice(g * groupSize, (g + 1) * groupSize);
    groups.push({
      groupId: letter,
      name: `Group ${letter}`,
      participants,
      table: participants.map((n) => nationRowMeta(n, letter)),
      matches: [],
      playerMatches: [],
      qualifiers: [],
      third: null,
    });
  }

  const playerActuallyIn =
    Boolean(calledUp) && nationEligible && field.includes(playerNation);

  const state = {
    competitionId,
    editionId,
    name: format.name,
    shortName: tournament.shortName || format.name,
    confederation: format.confederation,
    ruleVersion: format.ruleVersion,
    editionYear,
    year: editionYear,
    field,
    groups,
    fixtures: {},
    playedFixtureIds: [],
    scheduledFixtureIds: [],
    openingMatchdays: [],
    stageId: "group",
    stageList: [{ stageId: "group", type: "group" }],
    status: "group",
    calledUp: playerActuallyIn,
    playerNation,
    bestThirds: format.bestThirds || 0,
    advancePerGroup: format.advancePerGroup || 2,
    thirdPlaceMatch: Boolean(format.thirdPlaceMatch),
    knockoutStart: format.knockoutStart,
    bracket: { ties: {}, results: {} },
    qualification: null,
    champion: null,
    bestThirdTable: [],
    id: competitionId,
  };

  scheduleGroupFixtures(state);
  persistEdition(state, { world: liveWorld, rng });
  return state;
}

function groupFixtures(state, groupId, matchday = null) {
  return Object.values(state.fixtures).filter(
    (f) =>
      f.stageType === "group" &&
      (!groupId || f.groupId === groupId) &&
      (matchday == null || f.matchday === matchday)
  );
}

function refreshGroupTables(state) {
  for (const group of state.groups) {
    const played = groupFixtures(state, group.groupId).filter((f) => f.status === "played");
    const participants = group.participants.map((n) => nationRowMeta(n, group.groupId));
    const { rows } = accountNationalTable(participants, played, { groupId: group.groupId });
    const ranked = rankNationalGroup(state.competitionId, rows, played);
    group.table = ranked.map((r, i) => ({ ...r, position: i + 1 }));
    group.matches = played.sort(fixtureSort);
    group.playerMatches = played.filter(
      (m) =>
        state.calledUp &&
        (m.homeParticipantId === state.playerNation || m.awayParticipantId === state.playerNation)
    );
    if (played.length === groupFixtures(state, group.groupId).length) {
      group.qualifiers = ranked.slice(0, state.advancePerGroup).map((r) => r.name);
      group.third = ranked[2] || null;
      group.finalized = true;
    }
  }
}

function involvesPlayer(state, fixture) {
  if (!state.calledUp || !state.playerNation) return false;
  const home = fixture.homeParticipantId || fixture.home?.name;
  const away = fixture.awayParticipantId || fixture.away?.name;
  return home === state.playerNation || away === state.playerNation;
}

function resolveSlot(state, source) {
  if (!source) return null;
  if (source.type === "nation") return source.nationId || source.name;
  if (source.type === "winner") {
    const g = state.groups.find((x) => x.groupId === source.group);
    return g?.qualifiers?.[0] || null;
  }
  if (source.type === "runner") {
    const g = state.groups.find((x) => x.groupId === source.group);
    return g?.qualifiers?.[1] || null;
  }
  if (source.type === "third") {
    const alloc = state.qualification?.thirdAllocation;
    if (!alloc) return null;
    if (source.slot) return alloc.bySlot?.[source.slot] || null;
    if (source.winnerCol) return alloc.byWinner?.[source.winnerCol] || null;
    return null;
  }
  if (source.type === "winnerOf") {
    const res = state.bracket.results[source.matchKey];
    return res?.winnerId || null;
  }
  if (source.type === "loserOf") {
    const res = state.bracket.results[source.matchKey];
    return res?.loserId || null;
  }
  return null;
}

function addKnockoutFixture(state, def, { stageId, stageType, date, label }) {
  const homeId = resolveSlot(state, def.home);
  const awayId = resolveSlot(state, def.away);
  if (!homeId || !awayId) {
    throw new Error(
      `${state.name}: cannot schedule ${def.matchKey} — missing participants (${homeId} vs ${awayId})`
    );
  }
  if (homeId === awayId) {
    throw new Error(`${state.name}: ${def.matchKey} same participant ${homeId}`);
  }
  const matchId = `${state.competitionId}:${state.editionYear}:ko:${def.matchKey}`;
  const fixture = {
    matchId,
    fixtureId: matchId,
    competitionId: state.competitionId,
    editionId: state.editionId,
    ruleVersion: state.ruleVersion,
    stageId,
    stageType,
    matchKey: def.matchKey,
    round: label,
    homeParticipantId: homeId,
    awayParticipantId: awayId,
    home: nationTeam(homeId),
    away: nationTeam(awayId),
    homeSource: def.home,
    awaySource: def.away,
    date,
    venue: "neutral",
    status: "scheduled",
    knockout: true,
    seq: 1000,
  };
  state.fixtures[matchId] = fixture;
  state.scheduledFixtureIds.push(matchId);
  state.bracket.ties[def.matchKey] = { matchKey: def.matchKey, matchId, stageId };
  return matchId;
}

function finalizeQualification(state) {
  refreshGroupTables(state);
  const thirds = state.groups.map((g) => g.third).filter(Boolean);
  let qualifiedThirds = [];
  if (state.bestThirds > 0) {
    const ranked = rankBestThirds(state.competitionId, thirds);
    qualifiedThirds = ranked.slice(0, state.bestThirds);
    state.bestThirdTable = ranked.map((r, i) => ({
      ...r,
      qualified: i < state.bestThirds,
      reason: i < state.bestThirds ? "best-third" : "eliminated-third",
    }));
  }

  const thirdLetters = qualifiedThirds.map((t) => t.groupId);
  let thirdAllocation = null;
  if (state.competitionId === "euro" && state.bestThirds === 4) {
    const alloc = allocateEuroThirds(thirdLetters);
    const bySlot = {
      WB: state.groups.find((g) => g.groupId === alloc.WB)?.third?.name,
      WC: state.groups.find((g) => g.groupId === alloc.WC)?.third?.name,
      WE: state.groups.find((g) => g.groupId === alloc.WE)?.third?.name,
      WF: state.groups.find((g) => g.groupId === alloc.WF)?.third?.name,
    };
    thirdAllocation = { kind: "euro-article-21", key: alloc.key, bySlot, thirds: thirdLetters };
  } else if (state.competitionId === "world-cup" && state.bestThirds === 8) {
    const alloc = allocateWorldCupThirds(thirdLetters);
    const byWinner = {};
    for (const [w, letter] of Object.entries(alloc.assignment)) {
      byWinner[w] = state.groups.find((g) => g.groupId === letter)?.third?.name;
    }
    thirdAllocation = {
      kind: "fifa-annex-c",
      key: alloc.key,
      byWinner,
      thirds: thirdLetters,
    };
  } else {
    thirdAllocation = {
      kind: "pool-limited",
      thirds: thirdLetters,
      names: qualifiedThirds.map((t) => t.name),
    };
  }

  state.qualification = {
    finalized: true,
    groupQualifiers: state.groups.map((g) => ({
      groupId: g.groupId,
      first: g.qualifiers[0],
      second: g.qualifiers[1],
      third: g.third?.name || null,
    })),
    qualifiedThirds: qualifiedThirds.map((t) => t.name),
    thirdAllocation,
  };

  for (const g of state.groups) {
    for (const row of g.table) {
      const pos = row.position;
      if (pos <= state.advancePerGroup) {
        row.qualificationStatus = "qualified";
        row.qualificationReason = pos === 1 ? "group-winner" : "group-runner-up";
      } else if (
        pos === 3 &&
        qualifiedThirds.some((t) => t.name === row.name)
      ) {
        row.qualificationStatus = "qualified";
        row.qualificationReason = "best-third";
      } else {
        row.qualificationStatus = "eliminated";
        row.qualificationReason = "group-stage";
      }
    }
  }
}

function createFirstKnockoutRound(state) {
  const year = state.editionYear;
  const koBase = simDate(year, 6, 28);
  const created = [];

  if (state.competitionId === "euro") {
    for (const def of EURO_R16_SKELETON) {
      created.push(
        addKnockoutFixture(state, def, {
          stageId: "R16",
          stageType: "knockout",
          date: addDays(koBase, 0),
          label: "Round of 16",
        })
      );
    }
    state.stageId = "R16";
    state.status = "knockout";
    state._koPlan = [
      { stageId: "QF", label: "Quarter-finals", defs: EURO_QF_FEEDERS, day: 5 },
      { stageId: "SF", label: "Semi-finals", defs: EURO_SF_FEEDERS, day: 9 },
      { stageId: "Final", label: "Final", defs: [EURO_FINAL], day: 13 },
    ];
    return created;
  }

  if (state.competitionId === "world-cup") {
    WC_R32_SKELETON.forEach((def, i) => {
      created.push(
        addKnockoutFixture(state, def, {
          stageId: "R32",
          stageType: "knockout",
          date: addDays(koBase, Math.floor(i / 4)),
          label: "Round of 32",
        })
      );
    });
    state.stageId = "R32";
    state.status = "knockout";
    state._koPlan = [
      { stageId: "R16", label: "Round of 16", defs: WC_R16_FEEDERS, day: 5 },
      { stageId: "QF", label: "Quarter-finals", defs: WC_QF_FEEDERS, day: 9 },
      { stageId: "SF", label: "Semi-finals", defs: WC_SF_FEEDERS, day: 13 },
      {
        stageId: "placement",
        label: "Third-place match",
        defs: [WC_THIRD_PLACE],
        day: 16,
        stageType: "placement",
      },
      { stageId: "Final", label: "Final", defs: [WC_FINAL], day: 17 },
    ];
    return created;
  }

  // Pool-limited: cross-group pairing (1A vs 2B, 1B vs 2A, …) — never 1A vs 2A.
  const winners = state.groups.map((g) => g.qualifiers[0]);
  const runners = state.groups.map((g) => g.qualifiers[1]);
  let teams = [];
  if (state.bestThirds > 0 && state.qualification?.qualifiedThirds?.length) {
    teams = [
      ...state.groups.flatMap((g) => g.qualifiers),
      ...state.qualification.qualifiedThirds,
    ];
  } else {
    const n = Math.min(winners.length, runners.length);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      teams.push([winners[i], runners[j]]);
    }
  }

  const pairs =
    Array.isArray(teams[0])
      ? teams
      : (() => {
          const list = teams;
          let size = 1;
          while (size * 2 <= list.length) size *= 2;
          const trimmed = list.slice(0, size);
          const out = [];
          for (let i = 0; i < trimmed.length; i += 2) out.push([trimmed[i], trimmed[i + 1]]);
          return out;
        })();

  const label =
    pairs.length === 8
      ? "Round of 16"
      : pairs.length === 4
        ? "Quarter-finals"
        : pairs.length === 2
          ? "Semi-finals"
          : `Round of ${pairs.length * 2}`;
  pairs.forEach((pair, i) => {
    const [homeId, awayId] = pair;
    const matchKey = `ko-${label}-${i}`;
    created.push(
      addKnockoutFixture(
        state,
        {
          matchKey,
          home: { type: "nation", nationId: homeId },
          away: { type: "nation", nationId: awayId },
        },
        {
          stageId: label,
          stageType: "knockout",
          date: addDays(koBase, 0),
          label,
        }
      )
    );
  });
  state.stageId = label;
  state.status = "knockout";
  state._koPlan = []; // subsequent rounds built adjacently from winners
  state._poolKoRemaining = true;
  return created;
}

function stageFixturesComplete(state, stageId) {
  const fx = Object.values(state.fixtures).filter((f) => f.stageId === stageId);
  return fx.length > 0 && fx.every((f) => f.status === "played");
}

function advancePoolLimited(state) {
  if (!state._poolKoRemaining) return [];
  const current = Object.values(state.fixtures).filter(
    (f) => f.stageType === "knockout" && f.stageId === state.stageId
  );
  if (!current.length || !current.every((f) => f.status === "played")) return [];
  const winners = current
    .sort(fixtureSort)
    .map((f) => state.bracket.results[f.matchKey]?.winnerId)
    .filter(Boolean);
  if (winners.length === 1) {
    state.status = "complete";
    state.champion = winners[0];
    state._poolKoRemaining = false;
    return [];
  }
  if (winners.length % 2 !== 0) {
    throw new Error(`${state.name}: odd knockout winners ${winners.length}`);
  }
  const label =
    winners.length === 2 ? "Final" : winners.length === 4 ? "Semi-finals" : `Round of ${winners.length}`;
  const year = state.editionYear;
  const date = addDays(simDate(year, 7, 5), 0);
  const created = [];
  for (let i = 0; i < winners.length; i += 2) {
    const matchKey = `ko-${label}-${i / 2}`;
    created.push(
      addKnockoutFixture(
        state,
        {
          matchKey,
          home: { type: "nation", nationId: winners[i] },
          away: { type: "nation", nationId: winners[i + 1] },
        },
        { stageId: label, stageType: "knockout", date, label }
      )
    );
  }
  state.stageId = label;
  return created;
}

function advancePlannedKnockout(state) {
  const plan = state._koPlan || [];
  if (!plan.length) return advancePoolLimited(state);
  if (!stageFixturesComplete(state, state.stageId)) return [];

  // After SF, create placement before or with final depending on plan order.
  const next = plan.shift();
  state._koPlan = plan;
  if (!next) {
    state.status = "complete";
    const finalFx = Object.values(state.fixtures).find((f) => f.matchKey === "final");
    if (finalFx) {
      state.champion = state.bracket.results.final?.winnerId || null;
    }
    return [];
  }
  const year = state.editionYear;
  const date = addDays(simDate(year, 6, 28), next.day || 0);
  const created = [];
  for (const def of next.defs) {
    created.push(
      addKnockoutFixture(state, def, {
        stageId: next.stageId,
        stageType: next.stageType || "knockout",
        date,
        label: next.label,
      })
    );
  }
  state.stageId = next.stageId;
  if (next.stageId === "Final" || next.matchKey === "final") {
    // wait until played
  }
  return created;
}

/**
 * Play one national fixture exactly once. Already-played fixtures return the
 * committed result without RNG/form/ledger mutation.
 */
export function processNationalFixture(editionState, matchId, opts = {}) {
  if (!editionState?.fixtures?.[matchId]) return null;
  const state = editionState;
  const ctx = resolveContext(state, opts);
  syncFromStore(state, ctx);

  const existing = getMatch(matchId, ctx.world);
  if (existing?.status === "played") {
    state.fixtures[matchId] = { ...state.fixtures[matchId], ...existing, status: "played" };
    return { editionState: state, match: existing, playerIn: involvesPlayer(state, existing), reused: true };
  }
  if (state.fixtures[matchId].status === "played" && state.fixtures[matchId].homeGoals != null) {
    return {
      editionState: state,
      match: state.fixtures[matchId],
      playerIn: involvesPlayer(state, state.fixtures[matchId]),
      reused: true,
    };
  }

  const fixture = state.fixtures[matchId];
  let homeId = fixture.homeParticipantId;
  let awayId = fixture.awayParticipantId;
  if ((!homeId || !awayId) && (fixture.homeSource || fixture.awaySource)) {
    homeId = resolveSlot(state, fixture.homeSource);
    awayId = resolveSlot(state, fixture.awaySource);
  }
  if (!homeId || !awayId) {
    throw new Error(`${state.name}: fixture ${matchId} missing participants`);
  }
  const home = nationTeam(homeId);
  const away = nationTeam(awayId);
  const playerIn =
    state.calledUp &&
    ctx.player &&
    (homeId === state.playerNation || awayId === state.playerNation);
  const playerSide = playerIn
    ? homeId === state.playerNation
      ? "home"
      : "away"
    : null;
  const isKnockout = fixture.stageType === "knockout" || fixture.stageType === "placement";

  let match;
  let processorResult = null;
  if (opts.forcedResult) {
    match = { ...opts.forcedResult };
  } else if (playerIn && ctx.matchProcessor) {
    processorResult = ctx.matchProcessor({
      home,
      away,
      playerSide,
      date: fixture.date,
      matchId,
      fixtureId: matchId,
      competitionId: state.competitionId,
      editionId: state.editionId,
      stageId: fixture.stageId,
      stageType: fixture.stageType,
      groupId: fixture.groupId,
      venue: "neutral",
      knockout: isKnockout,
    });
    match = processorResult.match;
  } else {
    match = simulateMatch(home, away, {
      playerSide,
      player: playerIn ? ctx.player : null,
      competition: "international",
      venue: "neutral",
      worldState: ctx.world,
      rng: ctx.rng,
      competitionId: state.competitionId,
    });
    if (isKnockout) {
      match = resolveKnockout(match, {
        player: playerIn ? ctx.player : null,
        rng: ctx.rng,
      });
    }
  }

  if (isKnockout && !match.winnerSide) {
    match = resolveKnockout(match, {
      player: playerIn ? ctx.player : null,
      rng: ctx.rng,
    });
  }

  Object.assign(match, {
    matchId,
    fixtureId: matchId,
    competitionId: state.competitionId,
    editionId: state.editionId,
    ruleVersion: state.ruleVersion,
    stageId: fixture.stageId,
    stageType: fixture.stageType,
    groupId: fixture.groupId,
    matchday: fixture.matchday,
    matchKey: fixture.matchKey,
    round: fixture.round || (fixture.stageType === "group" ? "Group stage" : fixture.stageId),
    cupName: state.name,
    date: fixture.date,
    venue: "neutral",
    status: "played",
    homeParticipantId: homeId,
    awayParticipantId: awayId,
    playerSide,
  });

  commitMatch(match, ctx.world);
  applyMatchFormUpdate(ctx.world, match);

  state.fixtures[matchId] = { ...fixture, ...match, status: "played" };
  if (!state.playedFixtureIds.includes(matchId)) state.playedFixtureIds.push(matchId);
  state.scheduledFixtureIds = state.scheduledFixtureIds.filter((id) => id !== matchId);

  if (fixture.matchKey && isKnockout) {
    const winnerId = match.winnerSide === "home" ? homeId : awayId;
    const loserId = match.winnerSide === "home" ? awayId : homeId;
    state.bracket.results[fixture.matchKey] = {
      matchKey: fixture.matchKey,
      matchId,
      winnerId,
      loserId,
      scoreline: formatMatchScoreline(match),
    };
    if (fixture.matchKey === "final") {
      state.champion = winnerId;
      state.status = "complete";
    }
  }

  if (fixture.stageType === "group") refreshGroupTables(state);
  persistEdition(state, ctx);
  return {
    editionState: state,
    match,
    playerIn: Boolean(playerIn),
    processorResult,
    reused: false,
  };
}

export function processNationalMatchday(editionState, matchday, opts = {}) {
  if (!editionState?.fixtures) return null;
  const state = editionState;
  const ctx = resolveContext(state, opts);
  syncFromStore(state, ctx);
  const md = Number(matchday);
  const ids = Object.values(state.fixtures)
    .filter((f) => f.stageType === "group" && f.matchday === md)
    .sort(fixtureSort)
    .map((f) => f.matchId);
  const matches = [];
  const playerMatches = [];
  for (const id of ids) {
    const outcome = processNationalFixture(state, id, opts);
    if (!outcome?.match) continue;
    matches.push(outcome.match);
    if (outcome.playerIn) playerMatches.push(outcome.match);
  }
  refreshGroupTables(state);
  persistEdition(state, ctx);
  return { editionState: state, matchday: md, matches, playerMatches };
}

export function advanceNationalStage(editionState, opts = {}) {
  if (!editionState?.fixtures) return null;
  const state = editionState;
  const ctx = resolveContext(state, opts);
  syncFromStore(state, ctx);
  const createdFixtureIds = [];

  if (state.status === "group") {
    const groupFx = Object.values(state.fixtures).filter((f) => f.stageType === "group");
    if (!groupFx.every((f) => f.status === "played")) {
      return { editionState: state, advanced: false, reason: "group-pending", createdFixtureIds };
    }
    finalizeQualification(state);
    createdFixtureIds.push(...createFirstKnockoutRound(state));
    persistEdition(state, ctx);
    return {
      editionState: state,
      advanced: true,
      reason: "groups-to-knockout",
      stageId: state.stageId,
      status: state.status,
      createdFixtureIds,
    };
  }

  if (state.status === "knockout" || state.status === "placement") {
    const before = [...state.scheduledFixtureIds];
    const created = advancePlannedKnockout(state);
    createdFixtureIds.push(...created);
    // Detect completion when final played
    const finalRes = state.bracket.results.final;
    if (finalRes?.winnerId) {
      state.champion = finalRes.winnerId;
      state.status = "complete";
    }
    persistEdition(state, ctx);
    return {
      editionState: state,
      advanced: created.length > 0 || state.status === "complete",
      reason: created.length ? "next-knockout" : state.status === "complete" ? "complete" : "ko-pending",
      stageId: state.stageId,
      status: state.status,
      createdFixtureIds: createdFixtureIds.filter((id) => !before.includes(id)),
    };
  }

  return { editionState: state, advanced: false, reason: "idle", createdFixtureIds };
}

export function listNationalFixtures(
  editionState,
  { status = "all", playerOnly = false, stageId = null } = {}
) {
  if (!editionState?.fixtures) return [];
  const played = new Set(editionState.playedFixtureIds);
  return Object.values(editionState.fixtures)
    .filter((f) => status === "all" || (status === "played" ? played.has(f.matchId) : !played.has(f.matchId)))
    .filter((f) => !playerOnly || involvesPlayer(editionState, f))
    .filter((f) => !stageId || f.stageId === stageId)
    .sort(fixtureSort)
    .map((f) => ({ ...f, played: played.has(f.matchId), isPlayerFixture: involvesPlayer(editionState, f) }));
}

export function drainNationalEdition(editionState, opts = {}) {
  if (!editionState?.fixtures) return null;
  const state = editionState;
  for (let guard = 0; state.status !== "complete"; guard++) {
    if (guard > 256) throw new Error(`National edition ${state.editionId} did not complete`);
    const pending = listNationalFixtures(state, { status: "scheduled" });
    if (pending.length) {
      for (const f of pending.sort(fixtureSort)) {
        processNationalFixture(state, f.matchId, opts);
      }
      continue;
    }
    const step = advanceNationalStage(state, opts);
    if (!step?.advanced && state.status !== "complete") {
      throw new Error(`National edition ${state.editionId} stalled: ${step?.reason}`);
    }
  }
  return state;
}

function playerResultLabel(state) {
  if (!state.calledUp) return "Not in squad";
  if (state.champion === state.playerNation) return "Winners";
  const finalRes = state.bracket.results.final;
  if (finalRes && (finalRes.winnerId === state.playerNation || finalRes.loserId === state.playerNation)) {
    return finalRes.winnerId === state.playerNation ? "Winners" : "Runner-up";
  }
  // Find last knockout loss
  const koPlayed = listNationalFixtures(state, { status: "played" }).filter(
    (f) => f.stageType === "knockout" && involvesPlayer(state, f)
  );
  for (let i = koPlayed.length - 1; i >= 0; i--) {
    const m = koPlayed[i];
    const res = state.bracket.results[m.matchKey];
    if (res && res.loserId === state.playerNation) return m.round || m.stageId;
  }
  const g = state.groups.find((x) => x.participants.includes(state.playerNation));
  const row = g?.table?.find((r) => r.name === state.playerNation);
  if (row?.qualificationStatus === "eliminated") return "Group stage";
  if (row?.qualificationStatus === "qualified") return state.stageId || "Knockout";
  return "Group stage";
}

export function buildNationalCampaignView(editionState, opts = {}) {
  if (!editionState?.fixtures) return null;
  const state = editionState;
  const ctx = resolveContext(state, opts);
  syncFromStore(state, ctx);
  refreshGroupTables(state);

  const allPlayed = listNationalFixtures(state, { status: "played" });
  const playerMatches = allPlayed.filter((m) => involvesPlayer(state, m));
  const koRounds = {};
  for (const m of allPlayed.filter((f) => f.stageType === "knockout" || f.stageType === "placement")) {
    const label = m.round || m.stageId;
    if (!koRounds[label]) koRounds[label] = [];
    koRounds[label].push(m);
  }
  const allRounds = Object.entries(koRounds).map(([round, matches]) => ({ round, matches }));
  const finalMatch = state.fixtures[
    Object.values(state.bracket.ties).find((t) => t.matchKey === "final")?.matchId
  ];
  const thirdPlaceMatch = state.fixtures[
    Object.values(state.bracket.ties).find((t) => t.matchKey === "third-place")?.matchId
  ];
  const winnerName = state.champion || null;
  const won = Boolean(state.calledUp && winnerName === state.playerNation);

  return {
    id: state.competitionId,
    name: state.name,
    shortName: state.shortName,
    confederation: state.confederation,
    year: state.editionYear,
    editionYear: state.editionYear,
    editionId: state.editionId,
    competitionId: state.competitionId,
    ruleVersion: state.ruleVersion,
    calledUp: state.calledUp,
    groups: state.groups.map((g) => ({ ...g })),
    bestThirdTable: state.bestThirdTable || [],
    qualification: state.qualification,
    thirdPlaceMatch: thirdPlaceMatch?.status === "played" ? thirdPlaceMatch : thirdPlaceMatch || null,
    allRounds,
    rounds: playerMatches
      .filter((m) => m.stageType === "knockout")
      .map((m) => {
        const opp = m.playerSide === "home" ? m.away : m.home;
        const res = state.bracket.results[m.matchKey];
        const qualified = res?.winnerId === state.playerNation;
        return {
          round: m.round,
          opponent: opp?.displayName || opp?.name,
          opponentBadge: opp?.badge,
          score: formatMatchScoreline(m, { fromPlayerSide: m.playerSide }),
          qualified,
          match: m,
        };
      }),
    playerMatches,
    finalMatch: finalMatch?.status === "played" ? finalMatch : null,
    finalists: finalMatch?.status === "played" ? [finalMatch.home, finalMatch.away] : null,
    winner: winnerName,
    winnerData: winnerName
      ? {
          name: winnerName,
          displayName: winnerName,
          badge: nationTeam(winnerName).badge,
          nationId: nationTeam(winnerName).nationId,
        }
      : null,
    won,
    result: playerResultLabel(state),
    playerNationInTournament: state.field.includes(state.playerNation),
    field: [...state.field],
    status: state.status,
    stageId: state.stageId,
    fixtures: state.fixtures,
    bracket: state.bracket,
  };
}

export function loadNationalEdition({ competitionId, editionId, world = null } = {}) {
  const w = world || getWorldState();
  if (!w) return null;
  const edition = getEdition(competitionId, editionId, w);
  if (!edition?.nationalState) return null;
  const ns = edition.nationalState;
  const fixtures = { ...(ns.fixtures || {}) };
  for (const id of Object.keys(fixtures)) {
    const stored = getMatch(id, w);
    if (stored?.status === "played") {
      fixtures[id] = { ...fixtures[id], ...stored, status: "played" };
    }
  }
  const state = {
    competitionId,
    editionId,
    name: edition.name,
    shortName: ns.shortName || edition.name,
    confederation: edition.confederation,
    ruleVersion: edition.ruleVersion,
    editionYear: edition.seasonYear,
    year: edition.seasonYear,
    field: ns.field,
    groups: (ns.groups || []).map((g) => ({
      groupId: g.groupId,
      name: g.name,
      participants: g.participants,
      table: g.table || (g.participants || []).map((n) => nationRowMeta(n, g.groupId)),
      matches: g.matches || [],
      playerMatches: g.playerMatches || [],
      qualifiers: g.qualifiers || [],
      third: g.third || null,
      finalized: g.finalized || false,
    })),
    fixtures,
    playedFixtureIds: [...(ns.playedFixtureIds || [])],
    scheduledFixtureIds: [...(ns.scheduledFixtureIds || [])],
    openingMatchdays: [...(ns.openingMatchdays || [])],
    stageId: ns.stageId,
    stageList: edition.stages || [],
    status: ns.status || edition.status,
    calledUp: ns.calledUp,
    playerNation: ns.playerNation,
    bestThirds: ns.bestThirds || 0,
    advancePerGroup: ns.advancePerGroup || 2,
    thirdPlaceMatch: ns.thirdPlaceMatch,
    knockoutStart: ns.knockoutStart,
    bracket: ns.bracket || { ties: {}, results: {} },
    qualification: ns.qualification,
    champion: edition.champion,
    bestThirdTable: ns.bestThirdTable || [],
    _koPlan: ns._koPlan || null,
    _poolKoRemaining: ns._poolKoRemaining || false,
    id: competitionId,
  };
  if (!Object.keys(state.fixtures).length) return null;
  syncFromStore(state, { world: w });
  refreshGroupTables(state);
  return state;
}

function pickCallUpAnnouncement({ calledUp, chance, player, tournamentName, rng }) {
  const pct = Math.round(chance * 100);
  if (calledUp) {
    return {
      announcement: `You've been named in the ${player.nationality} squad for the ${tournamentName}.`,
      announcementTone: chance < 0.28 ? "surprise-in" : "called-up",
      callUpChancePct: pct,
    };
  }
  return {
    announcement:
      chance >= 0.7
        ? `Shock omission: left out of the ${tournamentName} squad.`
        : `No call-up for the ${tournamentName}.`,
    announcementTone: chance >= 0.7 ? "shock-out" : "out",
    callUpChancePct: pct,
  };
}

/**
 * Prepare all national editions for a calendar year without playing matches.
 */
export function prepareInternationalSeason({
  player,
  calendarYear,
  avgMatchRating = 6.8,
  world = null,
  rng = null,
} = {}) {
  const simRng = rng || getSimRng();
  const year = calendarYear || new Date().getFullYear();
  const tournaments = tournamentsForYear(year).map((t) => ({ ...t, year }));
  const conf = confederationForNation(player.nationality);
  const liveWorld = world || getWorldState();

  if (!tournaments.length) {
    return {
      year,
      confederation: conf,
      hasTournaments: false,
      calledUp: false,
      callUpChance: 0,
      announcement: `No major international tournaments in ${year}.`,
      announcementTone: "neutral",
      tournaments: [],
      editions: [],
      playerMatches: [],
      primary: null,
    };
  }

  const relevant = tournaments.filter(
    (t) => t.confederation === "FIFA" || t.confederation === conf
  );

  let calledUp = false;
  let chance = 0;
  let callUpTarget = relevant[0] || null;
  let announcement = `No ${conf || "national"} major tournament this summer.`;
  let announcementTone = "neutral";

  if (callUpTarget) {
    const pool = eligiblePool(callUpTarget);
    const nationEligible = pool.includes(player.nationality);
    chance = nationEligible ? nationalCallUpChance(player, avgMatchRating) : 0;
    calledUp = nationEligible && simRng.random() < chance;
    const msg = pickCallUpAnnouncement({
      calledUp,
      chance,
      player,
      tournamentName: callUpTarget.name,
      rng: simRng,
    });
    announcement = nationEligible
      ? msg.announcement
      : `${player.nationality} are not in the ${callUpTarget.name} field this cycle.`;
    announcementTone = nationEligible ? msg.announcementTone : "neutral";
  }

  const editions = tournaments.map((t) => {
    const playIn = calledUp && callUpTarget && t.id === callUpTarget.id;
    const forceInclude = callUpTarget && t.id === callUpTarget.id;
    return prepareNationalEdition({
      tournament: t,
      player,
      calledUp: playIn,
      forceIncludeIfEligible: forceInclude && eligiblePool(t).includes(player.nationality),
      calendarYear: year,
      world: liveWorld,
      rng: simRng,
    });
  });

  const primaryEdition = editions.find((e) => e.calledUp) || null;

  return {
    year,
    confederation: conf,
    hasTournaments: true,
    calledUp: Boolean(primaryEdition),
    callUpChance: parseFloat(chance.toFixed(3)),
    callUpChancePct: Math.round(chance * 100),
    announcement,
    announcementTone,
    callUpTournament: callUpTarget?.name || null,
    tournaments: editions.map((e) => buildNationalCampaignView(e, { player, world: liveWorld })),
    editions,
    playerMatches: [],
    primary: primaryEdition
      ? buildNationalCampaignView(primaryEdition, { player, world: liveWorld })
      : null,
    primaryEdition,
  };
}

export function buildInternationalSeasonView(season, { player, world } = {}) {
  if (!season) return null;
  const editions = season.editions || [];
  const views = editions.map((e) => buildNationalCampaignView(e, { player, world }));
  const primary = views.find((v) => v.calledUp) || null;
  return {
    ...season,
    tournaments: views,
    primary,
    playerMatches: primary?.playerMatches || [],
    calledUp: Boolean(primary),
  };
}

/** Batch convenience: prepare + drain through the same lifecycle. */
export function simulateNationalEdition(opts) {
  const state = prepareNationalEdition(opts);
  drainNationalEdition(state, opts);
  return buildNationalCampaignView(state, opts);
}
