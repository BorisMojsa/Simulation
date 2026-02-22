import { ATTRIBUTE_MODIFIERS, POSITION_STYLES, STATS_KEYS } from "../config/playerConfig.js";
import { clamp, randFloat, randInt } from "../utils/helpers.js";

export function createPlayer({ name, nationality, position, preferredRole }, academyPool) {
  const startingRating = randInt(52, 72);
  const academy = academyPool[randInt(0, academyPool.length - 1)];
  const academyClub = {
    ...academy,
    parentClub: academy.parentClub ? { ...academy.parentClub } : null,
  };
  const attributes = generateAttributes(position, startingRating);
  const fallbackRole = preferredRole || (POSITION_STYLES[position] ?? POSITION_STYLES.ST)[0];

  return {
    name,
    nationality: nationality || "Unknown",
    position,
    preferredRole: fallbackRole,
    age: 16,
    rating: startingRating,
    potential: clamp(startingRating + randInt(14, 32), startingRating + 5, 96),
    club: academyClub,
    attributes,
    seasons: [],
    careerTotals: { matches: 0, goals: 0, assists: 0, cleanSheets: 0 },
    careerHonors: { leagueTitles: 0, europeanTitles: 0, domesticCups: 0, individualAwards: 0 },
    pendingOffers: [],
    startYear: new Date().getFullYear(),
    isRetired: false,
    retiredInSeason: null,
    latestStanding: null,
    contractStartSeason: null,
    contractEndSeason: null,
    contractYears: null,
  };
}

export function agePerformanceModifier(age) {
  if (age <= 22) return 1.1;
  if (age <= 27) return 1.05;
  if (age <= 30) return 1;
  if (age <= 32) return 0.95;
  if (age <= 34) return 0.9;
  if (age <= 36) return 0.82;
  if (age <= 38) return 0.78;
  return 0.72;
}

export function adjustAttributes(player, growthBias, ratingDelta) {
  const delta = ratingDelta === 0 ? randFloat(-0.4, 0.4) : ratingDelta;
  STATS_KEYS.forEach((key) => {
    const focus = growthBias?.[key] || 1;
    const focusWeight = focus + 0.4;
    const baseChange = delta * focusWeight * randFloat(0.25, 0.55);
    const supportSwing = delta * randFloat(0.06, 0.2);
    const change = baseChange + supportSwing;
    let ageingPenalty = 0;
    if (player.age > 29) {
      const heavyKeys = ["Speed", "Dribbling"];
      const base = player.age >= 35 ? randFloat(0.3, 0.8) : randFloat(0.2, 0.6);
      ageingPenalty = heavyKeys.includes(key) ? base * 1.2 : base * 0.6;
    }
    player.attributes[key] = clamp(Math.round(player.attributes[key] + change - ageingPenalty), 25, 99);
  });
}

export function generateAttributes(position, rating) {
  const base = ATTRIBUTE_MODIFIERS[position] || ATTRIBUTE_MODIFIERS.DEFAULT;
  const attrs = {};
  STATS_KEYS.forEach((key) => {
    const modifier = base[key] ?? 0;
    attrs[key] = clamp(Math.round(rating + modifier + randFloat(-4, 4)), 25, 90);
  });
  return attrs;
}
