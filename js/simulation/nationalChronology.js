/**
 * Bridge between chronologicalSeason's dated event queue and national editions.
 * Fixtures play once on their scheduled dates; views project from committed results.
 */

import { processPlayerMatchDay } from "./playerMatchDay.js";
import { resolveKnockout } from "./matchEngine.js";
import { mergePendingEvents } from "./seasonCalendar.js?v=89";
import {
  prepareInternationalSeason,
  processNationalMatchday,
  processNationalFixture,
  advanceNationalStage,
  listNationalFixtures,
  buildNationalCampaignView,
  buildInternationalSeasonView,
  drainNationalEdition,
  loadNationalEdition,
} from "./nationalTournament.js";

function nationalOpts({
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
    playerName: edition.playerNation,
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
        competition: "international",
        competitionType: "international",
        competitionId: req.competitionId || edition.competitionId,
        editionId: req.editionId || edition.editionId,
        fixtureId: req.matchId || req.fixtureId,
        teamType: "national",
        competitionPriority: 1.1,
        venue: req.venue || "neutral",
        rng,
        selRng,
        injuryRng,
        worldState: world,
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

export function prepareSeasonInternational({ player, calendarYear, avgMatchRating, world, rng }) {
  return prepareInternationalSeason({
    player,
    calendarYear,
    avgMatchRating,
    world,
    rng,
  });
}

export function buildNationalChronoEvents(edition) {
  if (!edition) return [];
  const events = [];
  for (const md of edition.openingMatchdays || []) {
    const mdFixtures = listNationalFixtures(edition).filter(
      (f) => f.stageType === "group" && f.matchday === md
    );
    if (!mdFixtures.length) continue;
    // Prefer a date when the player's group plays; else first fixture that day.
    const playerFx = mdFixtures.find((f) => f.isPlayerFixture);
    const date = (playerFx || mdFixtures[0]).date;
    events.push({
      kind: "national_md",
      eventId: `national_md:${edition.editionId}:${md}`,
      date,
      sortKey: `${date}:I:md${String(md).padStart(2, "0")}`,
      matchday: md,
      competitionId: edition.competitionId,
      editionId: edition.editionId,
    });
  }

  const koPlayer = listNationalFixtures(edition, { status: "scheduled", playerOnly: true }).filter(
    (f) => f.stageType === "knockout" || f.stageType === "placement"
  );
  for (const f of koPlayer) {
    events.push({
      kind: "national_fixture",
      eventId: `national_fixture:${f.matchId}`,
      date: f.date,
      sortKey: `${f.date}:I:fx:${f.matchId}`,
      matchId: f.matchId,
      competitionId: edition.competitionId,
      editionId: edition.editionId,
    });
  }
  return events;
}

export function eventsForNewNationalFixtures(edition, previousScheduledIds) {
  const prev = new Set(previousScheduledIds || []);
  const fresh = listNationalFixtures(edition, { status: "scheduled", playerOnly: true }).filter(
    (f) => !prev.has(f.matchId)
  );
  return fresh.map((f, i) => ({
    kind: "national_fixture",
    eventId: `national_fixture:${f.matchId}`,
    date: f.date,
    sortKey: `${f.date}:I:fx:${f.matchId}`,
    matchId: f.matchId,
    competitionId: edition.competitionId,
    editionId: edition.editionId,
    _seq: i,
  }));
}

function injectEvents(ordered, eventIndex, newEvents) {
  return mergePendingEvents(ordered, eventIndex, newEvents);
}

function playDueBackgroundFixtures(edition, opts, { onOrBeforeDate = null, stageId = null } = {}) {
  const due = listNationalFixtures(edition, { status: "scheduled" }).filter((f) => {
    if (f.isPlayerFixture) return false;
    if (stageId && f.stageId === stageId) return true;
    if (!onOrBeforeDate) return true;
    return String(f.date || "") <= String(onOrBeforeDate);
  });
  for (const f of due.sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    processNationalFixture(edition, f.matchId, { ...opts, matchProcessor: null });
  }
}

function advanceAndCollect(edition, opts, ordered, eventIndex, { onOrBeforeDate = null, stageId = null } = {}) {
  let list = ordered;
  const seenScheduled = new Set(
    listNationalFixtures(edition, { status: "scheduled" }).map((f) => f.matchId)
  );
  for (let guard = 0; guard < 24; guard++) {
    // Knockout rounds are simultaneous batches: finish the whole stage so feeders can open
    // before the career calendar moves past the tournament window.
    playDueBackgroundFixtures(edition, opts, { onOrBeforeDate, stageId });
    const before = [...seenScheduled];
    const step = advanceNationalStage(edition, opts);
    if (!step?.advanced) break;
    const created = eventsForNewNationalFixtures(edition, before);
    for (const ev of created) seenScheduled.add(ev.matchId);
    for (const id of step.createdFixtureIds || []) seenScheduled.add(id);
    // Also enqueue a stage batch tick so background-only rounds still run on date
    // even if the player is already eliminated.
    if (step.createdFixtureIds?.length) {
      const sample = listNationalFixtures(edition).find((f) =>
        step.createdFixtureIds.includes(f.matchId)
      );
      if (sample && !created.some((e) => e.kind === "national_fixture" && e.matchId === sample.matchId)) {
        const batch = {
          kind: "national_fixture",
          eventId: `national_stage:${edition.editionId}:${sample.stageId}`,
          date: sample.date,
          sortKey: `${sample.date}:I:stage:${sample.stageId}`,
          matchId: sample.matchId,
          stageId: sample.stageId,
          competitionId: edition.competitionId,
          editionId: edition.editionId,
        };
        created.push(batch);
      }
    }
    list = injectEvents(list, eventIndex, created);
  }
  return { ordered: list, edition };
}

export function processNationalChronoEvent({
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
  if (!edition) return { edition, ordered, internationalSeason: null };
  const opts = nationalOpts({
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
  if (ev.kind === "national_md") {
    processNationalMatchday(edition, ev.matchday, opts);
  } else if (ev.kind === "national_fixture") {
    const fx = edition.fixtures?.[ev.matchId];
    stageId = fx?.stageId || ev.stageId || null;
    if (stageId) {
      // Play the whole knockout/placement round as one batch (player + background).
      const roundFx = listNationalFixtures(edition, { status: "scheduled" }).filter(
        (f) => f.stageId === stageId
      );
      for (const f of roundFx.sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
        if (f.isPlayerFixture) processNationalFixture(edition, f.matchId, opts);
        else processNationalFixture(edition, f.matchId, { ...opts, matchProcessor: null });
      }
    } else {
      processNationalFixture(edition, ev.matchId, opts);
    }
  }

  const advanced = advanceAndCollect(edition, opts, ordered, eventIndex, {
    onOrBeforeDate: ev.date,
    stageId,
  });
  const view = buildNationalCampaignView(advanced.edition, opts);
  return {
    edition: advanced.edition,
    ordered: advanced.ordered,
    campaignView: view,
  };
}

export function finalizeSeasonNational({
  edition,
  season,
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
  if (!edition && !season?.editions?.length) return season || null;
  const editions = season?.editions || (edition ? [edition] : []);
  for (const ed of editions) {
    if (ed.status === "complete") continue;
    // Finalize must not append out-of-order player ledger rows. Drain remaining
    // fixtures without the player match processor; player appearances should already
    // have been processed on their calendar dates.
    const opts = nationalOpts({
      edition: ed,
      player,
      rng,
      selRng,
      injuryRng,
      world,
      lastDateRef,
      ledgerRecords: null,
      playerMatchStats: null,
      accumulatePlayerStats: null,
    });
    opts.matchProcessor = null;
    drainNationalEdition(ed, opts);
  }
  if (season) {
    return buildInternationalSeasonView(season, { player, world });
  }
  return buildNationalCampaignView(editions[0], { player, world });
}

export function reloadNationalEditionFromWorld(edition, world) {
  if (!edition?.competitionId || !edition?.editionId) return edition;
  return (
    loadNationalEdition({
      competitionId: edition.competitionId,
      editionId: edition.editionId,
      world,
    }) || edition
  );
}

export {
  buildNationalCampaignView,
  buildInternationalSeasonView,
  listNationalFixtures,
  loadNationalEdition,
  prepareInternationalSeason,
};
