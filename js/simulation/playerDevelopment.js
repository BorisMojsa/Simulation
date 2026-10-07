import { ATTRIBUTE_MODIFIERS, POSITION_PROFILES, STATS_KEYS } from "../config/playerConfig.js";
import { calculateContractLength } from "./transferMarket.js";
import { clamp, randFloat, randInt } from "../utils/helpers.js";

const basePlayerFields = () => ({
  seasons: [],
  careerTotals: { matches: 0, goals: 0, assists: 0, cleanSheets: 0 },
  careerHonors: { leagueTitles: 0, europeanTitles: 0, domesticCups: 0, individualAwards: 0, internationalTitles: 0 },
  pendingOffers: [],
  startYear: new Date().getFullYear(),
  isRetired: false,
  retiredInSeason: null,
  latestStanding: null,
  contractStartSeason: null,
  contractEndSeason: null,
  contractYears: null,
  suppressParentContractOffer: false,
});

/** After form submit — no club or ratings yet (career intro picks academy). */
export function createPlayerIdentity({ name, nationality, position, age = 16 }) {
  const startAge = clamp(Math.round(Number(age) || 16), 15, 19);
  return {
    name,
    nationality: nationality || "Unknown",
    position,
    age: startAge,
    rating: 0,
    potential: 0,
    club: null,
    attributes: null,
    careerIntroComplete: false,
    ...basePlayerFields(),
  };
}

/**
 * Roll starting academy OVR in 54–78.
 * Mid-60s are common; 75+ is rare but possible.
 */
export function rollAcademyStartingRating() {
  const r = Math.random();
  if (r < 0.015) return randInt(76, 78); // extremely rare
  if (r < 0.045) return randInt(75, 75); // very rare
  if (r < 0.1) return randInt(72, 74); // rare
  if (r < 0.28) return randInt(68, 71);
  if (r < 0.58) return randInt(62, 67);
  return randInt(54, 61);
}

/**
 * Roll hidden OVR, attributes, and a starting potential ceiling.
 * OVR is shown during academy moments and updates with each pick.
 */
export function finalizeAcademyPlayer(player, academyEntry) {
  const startingRating = rollAcademyStartingRating();
  const academyClub = {
    ...academyEntry,
    parentClub: academyEntry.parentClub ? { ...academyEntry.parentClub } : null,
  };
  player.rating = startingRating;
  player.potential = randInt(Math.min(startingRating + 4, 88), Math.max(startingRating + 8, 90));
  player.attributes = generateAttributes(player.position, startingRating);
  player.club = academyClub;
}

/**
 * After the opening academy story, move to the senior (parent) club on a pro deal.
 * Academy is intro-only; ongoing career is with the first team.
 */
export function promoteAcademyGraduateToFirstTeam(player, performanceHint = 72) {
  if (!player.club?.isAcademy) {
    return null;
  }
  const parent = player.club.parentClub;
  if (!parent) {
    player.club = { ...player.club, isAcademy: false, parentClub: null };
    return null;
  }

  player.club = {
    name: parent.name,
    displayName: parent.displayName ?? parent.name,
    league: parent.league,
    leagueDisplay: parent.leagueDisplay ?? parent.league,
    tier: parent.tier,
    badge: parent.badge,
    financialTier: parent.financialTier,
    isAcademy: false,
    parentClub: null,
  };

  const currentSeason = player.seasons.length;
  player.contractStartSeason = currentSeason;
  player.contractYears = calculateContractLength(player.age, player.rating, player.potential, performanceHint);
  player.contractEndSeason = currentSeason + player.contractYears;
  player.pendingOffers = [];
  player.suppressParentContractOffer = false;

  return parent.displayName ?? parent.name;
}

/** Apply an exact academy-moment delta; returns the applied change after clamping. */
export function applyOpeningChoiceDelta(player, minDelta, maxDelta, clampRange = { min: 50, max: 88 }) {
  const d = randInt(minDelta, maxDelta);
  return applyOpeningChoiceResult(player, d, clampRange);
}

/** Apply a concrete result delta from a linked narrative outcome. */
export function applyOpeningChoiceResult(player, delta, clampRange = { min: 50, max: 88 }) {
  const profile = POSITION_PROFILES[player.position] || POSITION_PROFILES.DEFAULT;
  const prev = player.rating;
  player.rating = clamp(prev + delta, clampRange.min, clampRange.max);
  const applied = player.rating - prev;
  adjustAttributes(player, profile.growthBias, applied);
  return applied;
}

export function createPlayer({ name, nationality, position }, academyPool) {
  const player = createPlayerIdentity({ name, nationality, position });
  const academy = academyPool[randInt(0, academyPool.length - 1)];
  finalizeAcademyPlayer(player, academy);
  player.careerIntroComplete = true;
  return player;
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
  const age = player.age;
  const volatility = age <= 20 ? 1.35 : age <= 24 ? 1.15 : age <= 28 ? 1 : age <= 32 ? 0.88 : 0.75;
  const trend =
    ratingDelta === 0 ? randFloat(-0.55, 0.55) : clamp(ratingDelta, -4, 4) * 0.38;

  STATS_KEYS.forEach((key) => {
    const focus = growthBias?.[key] || 1;
    const focusNorm = (focus + 0.35) / 3.6;

    // Weak link to overall form — one area can improve while another regresses
    const correlated = trend * focusNorm * randFloat(0.25, 1.05);

    // Independent swing: form, coaching focus, confidence, minor injuries
    const independent = randFloat(-1.55, 1.55) * volatility;

    // Occasional “wrong” direction vs season narrative (real careers aren’t monotonic)
    let counter = 0;
    if (Math.random() < 0.14) {
      const flip = trend >= 0 ? -1 : 1;
      counter = flip * randFloat(0.45, 1.85) * focusNorm;
    }

    let change = correlated + independent + counter;
    change = clamp(change, -3, 3);

    // Regression toward balance when one stat drifts far from the pack
    const vsOverall = player.attributes[key] - player.rating;
    if (vsOverall > 11) change -= randFloat(0.25, 1.15);
    else if (vsOverall < -11) change += randFloat(0.25, 1.15);

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
