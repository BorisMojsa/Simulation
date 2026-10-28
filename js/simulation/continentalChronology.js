/**
 * Bridge between chronologicalSeason's dated event queue and the continental edition lifecycle.
 * Fixtures are played once on their scheduled dates; the campaign view is always projected
 * from committed store results.
 */

import { processPlayerMatchDay } from "./playerMatchDay.js";
import { resolveKnockout } from "./matchEngine.js";
import { mergePendingEvents } from "./seasonCalendar.js?v=89";
import {
  prepareContinentalEdition,
  processContinentalMatchday,
  processContinentalFixture,
  advanceContinentalStage,
  listContinentalFixtures,
  buildContinentalCampaignView,
  drainContinentalEdition,
  loadContinentalEdition,
} from "./continentalTournament.js";

function continentalOpts({
  edition,
  player,
  rng,
  selRng,
  injuryRng,
  world,
  lastDateRef,
  ledgerRecords,
  playerMatchStats,
  accumulatePlayerStats,
}) {
  return {
    player,
    playerName: edition.playerClub?.name,
    rng,
    world,
    matchProcessor: (req) => {
      const { match, participation, ledgerRecord } = processPlayerMatchDay({
        home: req.home,
        away: req.away,
        player,
        playerSide: req.playerSide,
        date: req.date,
        lastDate: lastDateRef.current,
        competition: "europe",
        competitionType: "continental",
        competitionId: req.competitionId || edition.competitionId,
        fixtureId: req.matchId || req.fixtureId,
        teamType: "club",
        competitionPriority: 1.05,
        venue: req.venue || "home",
        rng,
        selRng,
        injuryRng,
        worldState: world,
        // Only single-leg knockout finals (etc.) may resolve ET/pens here.
        // League phase, first legs, and two-leg second legs are handled by the edition engine.
        resolveKnockout: req.knockout ? resolveKnockout : undefined,
      });
      if (ledgerRecord && ledgerRecords) {
        ledgerRecords.push(ledgerRecord);
        if (accumulatePlayerStats) accumulatePlayerStats(playerMatchStats, match, participation);
      }
      lastDateRef.current = req.date;
      return { match, participation, ledgerRecord };
    },
  };
}

/** Prepare a continental edition for the season, or null if not qualified. */
export function prepareSeasonContinental({ standing, league, player, seasonYear, world }) {
  if (!standing) return null;
  return prepareContinentalEdition({
    standing,
    league,
    player,
    seasonYear,
    world,
  });
}

/**
 * Build dated chronology events for currently scheduled continental fixtures involving
 * the player, plus one matchday tick per opening MD so non-player fixtures play on time.
 */
export function buildContinentalChronoEvents(edition) {
  if (!edition) return [];
  const events = [];
  const openingMds = edition.openingMatchdays || [];
  for (const md of openingMds) {
    const mdFixtures = listContinentalFixtures(edition).filter(
      (f) => f.stageType !== "knockout" && f.matchday === md
    );
    if (!mdFixtures.length) continue;
    const date = mdFixtures[0].date;
    events.push({
      kind: "continental_md",
      eventId: `continental_md:${edition.editionId}:${md}`,
      date,
      sortKey: `${date}:E:md${String(md).padStart(2, "0")}`,
      matchday: md,
      competitionId: edition.competitionId,
      editionId: edition.editionId,
    });
  }

  // Already-scheduled knockout legs involving the attached player (e.g. Concacaf R1).
  const koPlayer = listContinentalFixtures(edition, {
    status: "scheduled",
    playerOnly: true,
  }).filter((f) => f.stageType === "knockout");
  for (const f of koPlayer) {
    events.push({
      kind: "continental_fixture",
      eventId: `continental_fixture:${f.matchId}`,
      date: f.date,
      sortKey: `${f.date}:E:fx:${f.matchId}`,
      matchId: f.matchId,
      competitionId: edition.competitionId,
      editionId: edition.editionId,
    });
  }
  return events;
}

/**
 * After advance creates new fixtures, return chronology events for newly scheduled
 * player knockout legs (and any new opening MDs — normally none).
 */
export function eventsForNewFixtures(edition, previousScheduledIds, afterIndex = 0, player = null) {
  const prev = new Set(previousScheduledIds || []);
  const fresh = listContinentalFixtures(edition, {
    status: "scheduled",
    playerOnly: true,
    player,
  }).filter((f) => !prev.has(f.matchId));
  return fresh.map((f, i) => ({
    kind: "continental_fixture",
    eventId: `continental_fixture:${f.matchId}`,
    date: f.date,
    sortKey: `${f.date}:E:fx:${f.matchId}`,
    matchId: f.matchId,
    competitionId: edition.competitionId,
    editionId: edition.editionId,
    _seq: i,
  }));
}

/**
 * After a mid-season move, schedule any already-open fixtures that now attach to the
 * destination registration (without redrawing the edition).
 */
export function eventsForAttachedPendingFixtures(edition, player, { onOrAfterDate = null } = {}) {
  if (!edition || !player) return [];
  return listContinentalFixtures(edition, {
    status: "scheduled",
    playerOnly: true,
    player,
  })
    .filter((f) => !onOrAfterDate || String(f.date || "") >= String(onOrAfterDate))
    .map((f, i) => ({
      kind: "continental_fixture",
      eventId: `continental_fixture:${f.matchId}`,
      date: f.date,
      sortKey: `${f.date}:E:fx:${f.matchId}`,
      matchId: f.matchId,
      competitionId: edition.competitionId,
      editionId: edition.editionId,
      _seq: i,
    }));
}

/**
 * Merge newly unlocked fixtures into the pending calendar only.
 * Preserves the processed prefix so earlier league/cup dates cannot run after a
 * later knockout that was just injected.
 */
function injectEvents(ordered, eventIndex, newEvents) {
  return mergePendingEvents(ordered, eventIndex, newEvents);
}

/** Play background (non-player) fixtures that are due so stage gates can open. */
function playDueBackgroundFixtures(edition, opts, { onOrBeforeDate = null, stageId = null } = {}) {
  // Classify attachment with the live player so eligible destination fixtures are not
  // drained as world-only before their continental_fixture / matchday tick.
  const due = listContinentalFixtures(edition, {
    status: "scheduled",
    player: opts.player || null,
  }).filter((f) => {
    if (f.isPlayerFixture) return false;
    if (stageId && f.stageId === stageId) return true;
    if (!onOrBeforeDate) return true;
    return String(f.date || "") <= String(onOrBeforeDate);
  });
  for (const f of due) {
    processContinentalFixture(edition, f.matchId, {
      ...opts,
      matchProcessor: null,
      player: null,
    });
  }
}

function advanceAndCollect(edition, opts, ordered, eventIndex, { onOrBeforeDate = null, stageId = null } = {}) {
  let list = ordered;
  const seenScheduled = new Set(
    listContinentalFixtures(edition, { status: "scheduled" }).map((f) => f.matchId)
  );
  for (let guard = 0; guard < 16; guard++) {
    playDueBackgroundFixtures(edition, opts, { onOrBeforeDate, stageId });
    const before = [...seenScheduled];
    const step = advanceContinentalStage(edition, opts);
    if (!step?.advanced) break;
    const created = eventsForNewFixtures(edition, before, eventIndex, opts.player || null);
    for (const ev of created) seenScheduled.add(ev.matchId);
    for (const id of step.createdFixtureIds || []) seenScheduled.add(id);
    list = injectEvents(list, eventIndex, created);
  }
  return { ordered: list, edition };
}

/**
 * Process a continental_md or continental_fixture chronology event.
 * Returns updated { edition, ordered, europePlan }.
 */
export function processContinentalChronoEvent({
  ev,
  edition,
  ordered,
  eventIndex,
  player,
  rng,
  selRng,
  injuryRng,
  world,
  lastDateRef,
  ledgerRecords,
  playerMatchStats,
  accumulatePlayerStats,
}) {
  if (!edition) return { edition, ordered, europePlan: null };
  const opts = continentalOpts({
    edition,
    player,
    rng,
    selRng,
    injuryRng,
    world,
    lastDateRef,
    ledgerRecords,
    playerMatchStats,
    accumulatePlayerStats,
  });

  let stageId = null;
  if (ev.kind === "continental_md") {
    processContinentalMatchday(edition, ev.matchday, opts);
  } else if (ev.kind === "continental_fixture") {
    processContinentalFixture(edition, ev.matchId, opts);
    stageId = edition.fixtures?.[ev.matchId]?.stageId || null;
  }

  const advanced = advanceAndCollect(edition, opts, ordered, eventIndex, {
    onOrBeforeDate: ev.date,
    stageId,
  });
  const europePlan = buildContinentalCampaignView(advanced.edition, opts);
  return {
    edition: advanced.edition,
    ordered: advanced.ordered,
    europePlan,
  };
}

/** Finish any remaining continental fixtures after the player's calendar path ends. */
export function finalizeSeasonContinental({
  edition,
  player,
  rng,
  selRng,
  injuryRng,
  world,
  lastDateRef,
  ledgerRecords,
  playerMatchStats,
  accumulatePlayerStats,
}) {
  if (!edition) return null;
  if (edition.status === "complete") {
    return buildContinentalCampaignView(edition, {
      player,
      playerName: edition.playerClub?.name,
      world,
    });
  }
  // Process any still-scheduled fixtures that attach to the live player through the
  // normal match-day path once, then drain the rest as true world-only.
  const playerOpts = continentalOpts({
    edition,
    player,
    rng,
    selRng,
    injuryRng,
    world,
    lastDateRef,
    ledgerRecords,
    playerMatchStats,
    accumulatePlayerStats,
  });
  const attachedPending = listContinentalFixtures(edition, {
    status: "scheduled",
    playerOnly: true,
    player,
  });
  for (const f of attachedPending) {
    processContinentalFixture(edition, f.matchId, playerOpts);
  }
  const drainOpts = continentalOpts({
    edition,
    player: null,
    rng,
    selRng,
    injuryRng,
    world,
    lastDateRef,
    ledgerRecords: null,
    playerMatchStats: null,
    accumulatePlayerStats: null,
  });
  drainOpts.matchProcessor = null;
  drainContinentalEdition(edition, drainOpts);
  return buildContinentalCampaignView(edition, { player, playerName: edition.playerClub?.name, world });
}

export function reloadEditionFromWorld(edition, world) {
  if (!edition?.competitionId || !edition?.editionId) return edition;
  return (
    loadContinentalEdition({
      competitionId: edition.competitionId,
      editionId: edition.editionId,
      world,
    }) || edition
  );
}

export {
  buildContinentalCampaignView,
  listContinentalFixtures,
  loadContinentalEdition,
};
