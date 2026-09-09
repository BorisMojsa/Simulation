import { POSITION_PROFILES } from "../config/playerConfig.js";
import { clubNameForDisplay, clamp, randFloat, randInt } from "../utils/helpers.js";
import { agePerformanceModifier } from "./playerDevelopment.js";

export function pickThreeAcademies(pool) {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const out = [];
  const seenParents = new Set();
  for (const a of shuffled) {
    const p = a.parentClub?.name ?? a.name;
    if (seenParents.has(p)) continue;
    seenParents.add(p);
    out.push(a);
    if (out.length === 3) break;
  }
  let i = 0;
  while (out.length < 3 && shuffled.length) {
    out.push(shuffled[i % shuffled.length]);
    i += 1;
    if (i > shuffled.length * 3) break;
  }
  return out.slice(0, 3);
}

/**
 * Lightweight academy year record — no league/cup/Europe simulation.
 */
export function buildNarrativeAcademySeason(player, ratingBeforeDecisions, ratingAfterDecisions) {
  const profile = POSITION_PROFILES[player.position] || POSITION_PROFILES.DEFAULT;
  const matches = randInt(18, 28);
  const ri = clamp(ratingAfterDecisions / 100, 0.5, 0.95);
  const am = agePerformanceModifier(player.age);
  const form = randFloat(0.82, 1.12);

  const goals = Math.round(matches * profile.goalRate * ri * am * form * randFloat(0.75, 1.2));
  const assists = Math.round(matches * profile.assistRate * ri * am * form * randFloat(0.75, 1.2));
  const cleanSheets = Math.round(matches * profile.cleanSheetRate * ri * form * randFloat(0.75, 1.15));

  const avgMatchRating = clamp(
    parseFloat(
      (
        6.1 +
        (ratingAfterDecisions - 58) * 0.038 +
        (goals + assists) / Math.max(1, matches) * 0.45 +
        randFloat(-0.35, 0.35)
      ).toFixed(2)
    ),
    5.4,
    8.2
  );

  const ratingChange = ratingAfterDecisions - ratingBeforeDecisions;

  return {
    seasonNumber: 1,
    age: player.age,
    club: player.club.name,
    clubDisplay: clubNameForDisplay(player.club),
    league: player.club.league,
    leagueDisplay: player.club.leagueDisplay ?? player.club.league,
    badge: player.club.badge,
    matches,
    goals,
    assists,
    cleanSheets,
    avgMatchRating,
    ratingChange,
    ratingAfter: ratingAfterDecisions,
    standing: null,
    honors: "Academy programme",
    europeanCampaign: null,
    domesticCupResult: null,
    individualAwards: [],
    trophies: [],
    isNarrativeAcademyYear: true,
  };
}
