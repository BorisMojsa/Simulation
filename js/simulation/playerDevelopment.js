import { ATTRIBUTE_MODIFIERS, POSITION_PROFILES, STATS_KEYS } from "../config/playerConfig.js";
import { clamp, randFloat, randInt } from "../utils/helpers.js";
import { findSeniorClub, findSeniorClubById } from "./seniorClubs.js";
import { buildValidatedOffer, acceptPipelineOffer } from "./dealPipeline.js";
import {
  calculateOverall,
  getDisplayAttributeKeys,
  normalizePosition,
  refreshAbilityCaches,
} from "./playerAbility.js";
import {
  applyAcademyGrowth,
  generateStartingAttributes,
  initializePlayerDevelopment,
  sampleLatentBudget,
  stableCareerId,
} from "./playerDevelopmentModel.js";
import { getOrUpdateForecast } from "./playerPotential.js";
import { ensurePlayerModel } from "./playerModelMigration.js";
import { createStreamRng, reseedCareerRng, hashSeed } from "./rng.js";
import {
  applyOpeningMoment,
  ensureAcademyOpeningState,
  applySkipOpeningDevelopment,
} from "./academyOpening.js?v=76";
import {
  acceptAcademyGraduationOffer,
  findExecutableParentOffer,
  reconcileAcademyReviewTray,
} from "./academyLifecycle.js";

export { applySkipOpeningDevelopment };

const basePlayerFields = () => ({
  seasons: [],
  careerTotals: { matches: 0, goals: 0, assists: 0, cleanSheets: 0 },
  careerHonors: { leagueTitles: 0, europeanTitles: 0, domesticCups: 0, individualAwards: 0, internationalTitles: 0 },
  pendingOffers: [],
  startYear: 2026,
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
  const norm = normalizePosition(position);
  const careerId = `cid_${hashSeed(`${name}|${nationality || "?"}|${norm.position}|${startAge}`).toString(16)}`;
  reseedCareerRng(hashSeed(careerId));
  return {
    name,
    nationality: nationality || "Unknown",
    position: norm.position === "DEFAULT" ? String(position || "CM").toUpperCase() : norm.position,
    positionUncertainty: norm.uncertainty,
    age: startAge,
    careerId,
    rating: 0,
    potential: 0,
    club: null,
    attributes: null,
    careerIntroComplete: false,
    playerModelVersion: 2,
    ...basePlayerFields(),
  };
}

/**
 * Roll starting academy OVR band target in 54–78 (generation target, not final truth).
 */
export function rollAcademyStartingRating(rng = null) {
  const r = rng?.random?.() ?? Math.random();
  const int = (a, b) => (rng ? rng.int(a, b) : randInt(a, b));
  if (r < 0.015) return int(76, 78);
  if (r < 0.045) return int(75, 75);
  if (r < 0.1) return int(72, 74);
  if (r < 0.28) return int(68, 71);
  if (r < 0.58) return int(62, 67);
  return int(54, 61);
}

/**
 * Roll hidden budget, attributes, derive overall, initialize development + forecast.
 */
export function finalizeAcademyPlayer(player, academyEntry) {
  const rng = createStreamRng(stableCareerId(player), "generation");
  const startingTarget = rollAcademyStartingRating(rng);
  let budget = sampleLatentBudget(rng);
  budget = Math.max(budget, startingTarget + 1);

  const academyClub = {
    ...academyEntry,
    parentClub: academyEntry.parentClub ? { ...academyEntry.parentClub } : null,
  };

  player.attributes = generateStartingAttributes(player.position, startingTarget, budget, rng);
  player.club = academyClub;
  // Placeholders overwritten by initialize
  player.rating = startingTarget;
  initializePlayerDevelopment(player, { rng, careerId: player.careerId });
  // v3: no individual latent ceiling — keep inert aliases at scale max.
  if (player.development) {
    player.development.latentAbilityBudget = Math.max(
      player.development.latentAbilityBudget || 0,
      player.baseOverallRaw || 0,
      99,
    );
    player.development.latentBudget = player.development.latentAbilityBudget;
  }
  getOrUpdateForecast(player, { sampleCount: 48 });
}

/**
 * After the opening academy story, move to the senior (parent) club on a pro deal.
 * With a pending academy review, only accepts a validated parent offer from that
 * review via lifecycle settlement — never invents a fresh parent deal or wipes
 * unrelated alternatives. Without a review, routes through the shared pipeline.
 */
export function promoteAcademyGraduateToFirstTeam(player, performanceHint = 72) {
  ensurePlayerModel(player);
  if (!player.club?.isAcademy) {
    return null;
  }

  const life = player.academyLifecycle;
  const hasPendingReview =
    Boolean(life?.pendingReview) ||
    life?.status === "pending-review" ||
    life?.status === "pending-final-review";

  if (hasPendingReview) {
    reconcileAcademyReviewTray(player);
    const parentOffer = findExecutableParentOffer(player);
    if (!parentOffer) {
      // No validated parent offer in this review — do not clear alternatives.
      player.suppressParentContractOffer = true;
      return null;
    }
    const result = acceptAcademyGraduationOffer(player, {
      offer: { ...parentOffer, isParentOffer: true },
      kind: "parent",
      club: null,
    });
    if (!result.ok) {
      player.suppressParentContractOffer = true;
      return null;
    }
    return result.clubName || player.club?.displayName || player.club?.name || null;
  }

  const parent = player.club.parentClub;
  if (!parent) {
    // Unresolvable parent is not a signed club — do not flip isAcademy.
    player.suppressParentContractOffer = true;
    return null;
  }

  const club =
    findSeniorClubById(parent.clubId) || findSeniorClub(parent.name) || null;
  if (!club) {
    player.suppressParentContractOffer = true;
    return null;
  }
  const built = buildValidatedOffer({
    player,
    club,
    dealType: "first_pro",
    performanceScore: performanceHint,
    forceParent: true,
  });
  if (!built.ok) {
    // Remain academy; never wipe unrelated pending offers.
    player.suppressParentContractOffer = true;
    return null;
  }
  const accepted = acceptPipelineOffer(player, {
    ...built.offer,
    isParentOffer: true,
  });
  if (!accepted.ok) {
    player.suppressParentContractOffer = true;
    return null;
  }
  if (player.state) {
    player.state.adaptationPenalty = clamp((player.state.adaptationPenalty || 0) + 0.35, 0, 1.5);
    player.state.roleFit = clamp((player.state.roleFit ?? 1) - 0.05, 0.6, 1);
  }
  refreshAbilityCaches(player);
  player.suppressParentContractOffer = false;
  if (player.academyLifecycle) {
    player.academyLifecycle.status = "graduated";
    player.academyLifecycle.pendingReview = null;
    player.academyLifecycle.pendingReviewId = null;
  }
  return player.club?.displayName ?? player.club?.name ?? null;
}

/** Apply an exact academy-moment delta; returns the applied change after clamping. */
export function applyOpeningChoiceDelta(player, minDelta, maxDelta, clampRange = { min: 50, max: 88 }) {
  const d = randInt(minDelta, maxDelta);
  return applyOpeningChoiceResult(player, d, clampRange);
}

/**
 * Apply a narrative opening outcome score via the shared academy-opening budget.
 * `delta` is a narrative score (±1…±4), not a raw OVR award.
 * Returns displayed (raw cache) change after attribute application.
 */
export function applyOpeningChoiceResult(player, delta, clampRange = { min: 50, max: 88 }) {
  ensurePlayerModel(player);
  const ratingBefore = player.rating;
  ensureAcademyOpeningState(player);
  const choiceIndex = player.academyOpening?.rolls?.length || 0;
  applyOpeningMoment(player, {
    scenario: { id: `legacy-choice-${choiceIndex}` },
    choice: { id: `legacy-c-${choiceIndex}`, label: "Opening moment" },
    outcome: {
      id: `legacy-o-${choiceIndex}-d${delta}`,
      delta,
      text: "The moment lands.",
      effect: "ability",
    },
    momentIndex: choiceIndex,
  });
  // Respect caller clamp band for legacy tests without forcing a +1 floor.
  if (player.rating < clampRange.min) {
    const profile = POSITION_PROFILES[player.position] || POSITION_PROFILES.DEFAULT;
    const rng = createStreamRng(stableCareerId(player), `academy-clamp:${choiceIndex}`);
    applyAcademyGrowth(player, clampRange.min - player.rating, {
      rng,
      focusBias: profile.growthBias,
      elapsedYearsShare: 1,
      alreadyAppliedLearningGain: player.academyOpening?.positiveLearningApplied || 0,
    });
    getOrUpdateForecast(player, { sampleCount: 32 });
  }
  return player.rating - ratingBefore;
}

export function createPlayer({ name, nationality, position }, academyPool) {
  const player = createPlayerIdentity({ name, nationality, position });
  const academy = academyPool[randInt(0, academyPool.length - 1)];
  finalizeAcademyPlayer(player, academy);
  player.careerIntroComplete = true;
  return player;
}

/**
 * @deprecated Duplicate age decline — physical/technical development already ages players.
 * Retained as no-op identity for any legacy callers; prefer removing call sites.
 */
export function agePerformanceModifier(_age) {
  return 1;
}

/**
 * Legacy attribute nudge helper — prefer developSeason / applyAcademyGrowth.
 * Kept for non-migrated paths; mutates attributes then refreshes rating cache.
 */
export function adjustAttributes(player, growthBias, ratingDelta) {
  ensurePlayerModel(player);
  applyAcademyGrowth(player, ratingDelta, {
    focusBias: growthBias,
    elapsedYearsShare: 0.2,
  });
}

export function generateAttributes(position, rating) {
  const rng = createStreamRng(`gen:${position}:${rating}`, "legacy");
  return generateStartingAttributes(position, rating, rating + 8, rng);
}

export { STATS_KEYS, ATTRIBUTE_MODIFIERS, getDisplayAttributeKeys, calculateOverall, refreshAbilityCaches, ensurePlayerModel };
