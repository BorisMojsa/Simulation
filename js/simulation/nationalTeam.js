/**
 * National team call-up helpers and batch simulation convenience wrapper.
 * Authoritative gameplay uses nationalTournament / nationalChronology lifecycles.
 */

import { confederationForNation, tournamentsForYear } from "../data/internationalCalendar.js";
import {
  nationTeam,
  nationalCallUpChance,
  eligiblePool,
  buildField,
  pickCallUpMessage,
} from "./nationalHelpers.js";
import {
  prepareInternationalSeason,
  drainNationalEdition,
  buildInternationalSeasonView,
  buildNationalCampaignView,
} from "./nationalTournament.js";
import { getSimRng } from "./rng.js";
import { getWorldState } from "./worldState.js";

export {
  nationTeam,
  nationalCallUpChance,
  eligiblePool,
  buildField,
};

/**
 * Full international season via the same prepare→drain lifecycle chronology uses.
 * Prefer prepareInternationalSeason + dated processing for career simulation.
 */
export function simulateInternationalSeason({ player, calendarYear, avgMatchRating = 6.8 }) {
  const rng = getSimRng();
  const world = getWorldState();
  const prepared = prepareInternationalSeason({
    player,
    calendarYear,
    avgMatchRating,
    world,
    rng,
  });

  for (const edition of prepared.editions || []) {
    drainNationalEdition(edition, { player, rng, world });
  }

  return buildInternationalSeasonView(prepared, { player, world });
}

/** @deprecated Use prepareInternationalSeason + lifecycle; kept for older probes. */
export function simulateInternationalSeasonLegacyProbe(opts) {
  return simulateInternationalSeason(opts);
}

export function announceCallUp(player, tournamentName, chance, calledUp) {
  return pickCallUpMessage({ calledUp, chance, player, tournamentName });
}

export function listYearTournaments(year) {
  return tournamentsForYear(year).map((t) => ({
    ...t,
    confederation: t.confederation,
    nationConf: confederationForNation,
  }));
}

export { buildNationalCampaignView, prepareInternationalSeason };
