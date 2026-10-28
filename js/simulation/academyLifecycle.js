/**
 * Academy continuation, boundary review, graduation and exit.
 *
 * Policy (Fix 04):
 * - Opening creates one narrative record at the starting age (no extra birthday).
 * - Each subsequent completed academy period advances age by exactly one.
 * - Youth activity is narrative-only — never senior fixtures or awards.
 * - Exit age 21: completing that year triggers final senior-contract review.
 * - Graduation requires a validated first-pro deal; never invent one.
 * - Legacy over-age academy players resolve review/release without another year.
 */
import {
  ACADEMY_LIFECYCLE_VERSION,
  ACADEMY_EXIT_AGE,
  ACADEMY_CONTINUATION_TRAINING,
  ACADEMY_RESULT_KIND,
} from "../config/academyLifecycleConfig.js";
import { POSITION_PROFILES } from "../config/playerConfig.js";
import { buildNarrativeAcademySeason } from "./narrativeAcademySeason.js";
import { buildFirstProContractDecision, signFirstProfessionalContract } from "./proContractOffers.js";
import {
  ensureContractAuthority,
  releaseToFreeAgency,
  selectNextCareerAction,
  completedSeasons,
  consumeRelatedDecisionAfterDeal,
} from "./contractLifecycle.js";
import {
  applyAcademyGrowth,
  developmentPeriodId,
  ensureLearningPeriodLedger,
  periodPositiveLearningUsed,
  stableCareerId,
} from "./playerDevelopmentModel.js";
import { getOrUpdateForecast } from "./playerPotential.js";
import { refreshAbilityCaches } from "./playerAbility.js";
import { ensurePlayerModel } from "./playerModelMigration.js";
import { createStreamRng } from "./rng.js";
import { findSeniorClub, findSeniorClubById } from "./seniorClubs.js";
import { clamp } from "../utils/helpers.js";

export {
  ACADEMY_LIFECYCLE_VERSION,
  ACADEMY_EXIT_AGE,
  ACADEMY_RESULT_KIND,
} from "../config/academyLifecycleConfig.js";

function makeId(prefix, player) {
  const career = player?.careerId || player?.name || "career";
  const n = (player?.academyLifecycle?.seq || 0) + 1;
  if (player?.academyLifecycle) player.academyLifecycle.seq = n;
  return `${prefix}:${career}:${n}:${Date.now().toString(36)}`;
}

/**
 * Idempotent academy lifecycle state on the player.
 */
export function ensureAcademyLifecycle(player) {
  if (!player || typeof player !== "object") return null;
  if (!player.academyLifecycle || typeof player.academyLifecycle !== "object") {
    player.academyLifecycle = {
      version: ACADEMY_LIFECYCLE_VERSION,
      exitAge: ACADEMY_EXIT_AGE,
      status: player.club?.isAcademy ? "enrolled" : "inactive",
      periodCount: countAcademyHistory(player),
      lastPeriodId: null,
      pendingReviewId: null,
      pendingReview: null,
      consumedPeriodIds: [],
      consumedReviewIds: [],
      seq: 0,
      originClubName: player.club?.isAcademy ? player.club.name : null,
      originParentClubId: player.club?.parentClub?.clubId || null,
    };
  }
  const life = player.academyLifecycle;
  if (life.version == null) life.version = ACADEMY_LIFECYCLE_VERSION;
  if (life.exitAge == null) life.exitAge = ACADEMY_EXIT_AGE;
  if (!Array.isArray(life.consumedPeriodIds)) life.consumedPeriodIds = [];
  if (!Array.isArray(life.consumedReviewIds)) life.consumedReviewIds = [];
  if (life.seq == null) life.seq = 0;
  if (player.club?.isAcademy && (life.status === "inactive" || !life.status)) {
    life.status = "enrolled";
  }
  return life;
}

export function countAcademyHistory(player) {
  const seasons = player?.seasons || [];
  return seasons.filter(
    (s) => s?.isNarrativeAcademyYear || s?.academyPeriod || s?.resultKind === ACADEMY_RESULT_KIND.PERIOD
  ).length;
}

export function isAcademyEnrolled(player) {
  return Boolean(player?.club?.isAcademy);
}

export function academyExitAge(player) {
  return Number(player?.academyLifecycle?.exitAge) || ACADEMY_EXIT_AGE;
}

/**
 * True when another youth year is still allowed (age will stay below exit after? No —
 * policy: player below 21 can complete another year; completing the year that reaches 21
 * is the final year. So before simulating: age < exitAge means a period is allowed.
 * At age === exitAge already (legacy), no further period.
 */
export function canSimulateAcademyPeriod(player) {
  if (!isAcademyEnrolled(player)) return false;
  const life = ensureAcademyLifecycle(player);
  if (life.status === "pending-final-review") return false;
  if (life.status === "graduated" || life.status === "released") return false;
  const age = Number(player.age) || 0;
  return age < academyExitAge(player);
}

export function hasPendingAcademyReview(player) {
  const life = ensureAcademyLifecycle(player);
  return Boolean(life?.pendingReview && life.pendingReviewId);
}

/**
 * Reject academy identities before senior fixture generation.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function assertNotAcademyForSeniorSimulation(player) {
  if (player?.club?.isAcademy) {
    return {
      ok: false,
      reason: "academy-not-senior-participant",
      message:
        "Academy players cannot enter senior league fixture generation. Route through advanceAcademyPeriod.",
    };
  }
  return { ok: true };
}

/**
 * Resolve parent senior club from stable ID / name in the current world.
 * Does not manufacture a parent.
 */
export function resolveAcademyParentClub(player) {
  const parent = player?.club?.parentClub;
  if (!parent) return null;
  return (
    (parent.clubId && findSeniorClubById(parent.clubId)) ||
    (parent.name && findSeniorClub(parent.name)) ||
    null
  );
}

/**
 * Clear stale senior pending state that must not block academy continuation.
 */
function clearIncompatibleSeniorPending(player) {
  if (player.pendingSeniorScenario) player.pendingSeniorScenario = null;
  if (player.pendingDecision) player.pendingDecision = null;
  if (player.seasonCheckpoint) player.seasonCheckpoint = null;
  if (player.pendingRegistration) player.pendingRegistration = null;
}

/**
 * Build / persist a boundary review using the shared first-pro pipeline.
 * Clears suppressParentContractOffer so past empty menus do not block future reviews.
 *
 * @param {object} [opts.offerProvider] — optional `(player) => decision` seam for
 *   controlled empty/forced reviews. Production callers omit this; tests/fixtures
 *   may inject a provider. Document any controlled provider in QA evidence.
 */
export function buildAndPersistAcademyReview(player, { isFinal = false, offerProvider = null } = {}) {
  ensureAcademyLifecycle(player);
  ensureContractAuthority(player);
  // Past suppression must not disable future boundary reviews.
  player.suppressParentContractOffer = false;

  const provider =
    typeof offerProvider === "function"
      ? offerProvider
      : typeof player?.academyOfferProvider === "function"
        ? player.academyOfferProvider
        : buildFirstProContractDecision;
  const decision = provider(player);
  const reviewId = makeId(isFinal ? "academy-final-review" : "academy-review", player);
  const executableOffers = (decision.offers || [])
    .filter((d) => d?.offer)
    .map((d) => ({
      ...d,
      offer: {
        ...d.offer,
        academyReviewId: reviewId,
        isFirstPro: true,
      },
    }));

  const review = {
    reviewId,
    isFinal: Boolean(isFinal),
    createdAtSeasonCount: completedSeasons(player),
    createdAtAge: player.age,
    offerCount: executableOffers.length,
    emptyOffers: executableOffers.length === 0,
    verdict: decision.verdict,
    offers: executableOffers,
    rejectionLog: decision.rejectionLog || [],
    consumedOfferIds: [],
  };

  player.academyLifecycle.pendingReviewId = reviewId;
  player.academyLifecycle.pendingReview = review;
  player.academyLifecycle.status = isFinal ? "pending-final-review" : "pending-review";

  // Surface offers on the shared desk tray.
  player.pendingOffers = executableOffers.map((d) => d.offer);

  return review;
}

function clearAcademyReview(player, { markConsumed = false } = {}) {
  const life = ensureAcademyLifecycle(player);
  if (markConsumed && life.pendingReviewId) {
    if (!life.consumedReviewIds.includes(life.pendingReviewId)) {
      life.consumedReviewIds.push(life.pendingReviewId);
    }
  }
  life.pendingReviewId = null;
  life.pendingReview = null;
  if (life.status === "pending-review" || life.status === "pending-final-review") {
    life.status = player.club?.isAcademy ? "enrolled" : life.status;
  }
}

/**
 * Apply continuation training for one youth period (finite per-period budget).
 */
function applyContinuationTraining(player, periodId) {
  ensurePlayerModel(player);
  ensureLearningPeriodLedger(player, periodId);
  const already = periodPositiveLearningUsed(player, periodId);
  // Reset opening carry so a later year does not inherit opening credit as "already used"
  // beyond what this period's ledger tracks — periodPositiveLearningUsed imports legacy
  // academyGrowthApplied once; clear the carry flag after import by zeroing the source
  // once the period ledger has recorded it.
  const age = Number(player.age) || 17;
  const soft =
    age <= ACADEMY_CONTINUATION_TRAINING.ageSoftStart
      ? 1
      : Math.max(
          0.55,
          1 -
            (age - ACADEMY_CONTINUATION_TRAINING.ageSoftStart) *
              ACADEMY_CONTINUATION_TRAINING.ageSoftPerYear
        );
  const requested = ACADEMY_CONTINUATION_TRAINING.requestedGain * soft;
  const profile = POSITION_PROFILES[player.position] || POSITION_PROFILES.DEFAULT;
  const rng = createStreamRng(stableCareerId(player), `academy-cont:${periodId}`);
  const growth = applyAcademyGrowth(player, requested, {
    rng,
    focusBias: profile.growthBias || {},
    elapsedYearsShare: 1,
    alreadyAppliedLearningGain: already,
  });
  const ledger = ensureLearningPeriodLedger(player, periodId);
  if (growth.realized > 0) {
    ledger.positiveUsed = (ledger.positiveUsed || 0) + growth.realized;
    ledger.academyImported = (ledger.academyImported || 0) + growth.realized;
  }
  ledger.finalized = true;
  // Prevent the next period from re-importing this year's growth as opening carry.
  player.development.academyGrowthApplied = 0;
  getOrUpdateForecast(player, { sampleCount: 32 });
  refreshAbilityCaches(player);
  return growth;
}

/**
 * Complete one narrative academy period: training, age+1, history, totals.
 */
export function completeAcademyPeriod(player, opts = {}) {
  ensureAcademyLifecycle(player);
  ensureContractAuthority(player);
  ensurePlayerModel(player);
  clearIncompatibleSeniorPending(player);

  if (!isAcademyEnrolled(player)) {
    return { ok: false, reason: "not-academy" };
  }
  if (!canSimulateAcademyPeriod(player)) {
    return { ok: false, reason: "academy-exit-reached" };
  }

  const seasonIndex = player.seasons?.length ?? 0;
  const periodId = opts.periodId || developmentPeriodId(player, { seasonIndex });
  const life = player.academyLifecycle;

  if (life.consumedPeriodIds.includes(periodId) || player.development?.lastProcessedSeasonId === periodId) {
    return { ok: false, reason: "period-already-applied", periodId };
  }

  const ratingBefore = Number(player.rating) || 0;
  const growth = applyContinuationTraining(player, periodId);
  const ratingAfter = Number(player.rating) || ratingBefore;

  // Age advances exactly once at the completed period boundary.
  player.age = (Number(player.age) || 17) + 1;

  const seasonNumber = seasonIndex + 1;
  const year = (player.startYear || 2026) + seasonIndex;
  const narrative = buildNarrativeAcademySeason(player, ratingBefore, ratingAfter, {
    seasonNumber,
    year,
    periodId,
    academyPeriod: true,
  });

  if (!player.seasons) player.seasons = [];
  player.seasons.push(narrative);
  if (!player.careerTotals) {
    player.careerTotals = { matches: 0, goals: 0, assists: 0, cleanSheets: 0 };
  }
  for (const k of ["matches", "goals", "assists", "cleanSheets"]) {
    player.careerTotals[k] = (player.careerTotals[k] || 0) + (narrative[k] || 0);
  }
  // Youth activity is also tracked separately so senior aggregates stay honest.
  if (!player.academyCareerTotals) {
    player.academyCareerTotals = { matches: 0, goals: 0, assists: 0, cleanSheets: 0 };
  }
  for (const k of ["matches", "goals", "assists", "cleanSheets"]) {
    player.academyCareerTotals[k] =
      (player.academyCareerTotals[k] || 0) + (narrative[k] || 0);
  }

  player.development.lastProcessedSeasonId = periodId;
  life.consumedPeriodIds.push(periodId);
  life.lastPeriodId = periodId;
  life.periodCount = (life.periodCount || 0) + 1;
  life.status = "enrolled";

  return {
    ok: true,
    periodId,
    season: narrative,
    ratingBefore,
    ratingAfter,
    growth,
    age: player.age,
  };
}

/**
 * After a completed period (or for legacy over-age), run the boundary review policy.
 */
export function applyAcademyBoundaryPolicy(player, { periodCompleted = true, offerProvider = null } = {}) {
  ensureAcademyLifecycle(player);
  const exitAge = academyExitAge(player);
  const age = Number(player.age) || 0;
  const isFinal = age >= exitAge;

  const review = buildAndPersistAcademyReview(player, { isFinal, offerProvider });

  if (review.emptyOffers) {
    clearAcademyReview(player, { markConsumed: true });
    player.pendingOffers = [];
    if (isFinal) {
      return releaseAcademyToFreeAgency(player, "academy-exit-no-offer");
    }
    // Below exit: remain enrolled, usable next youth period.
    player.academyLifecycle.status = "enrolled";
    return {
      ok: true,
      action: "continue-academy",
      isFinal: false,
      review: { ...review, pending: false },
      released: false,
      graduated: false,
    };
  }

  // Offers exist — pending review (final or intermediate).
  return {
    ok: true,
    action: isFinal ? "pending-final-review" : "pending-review",
    isFinal,
    review,
    released: false,
    graduated: false,
  };
}

/**
 * Release from academy to free agency without inventing a senior campaign year.
 */
export function releaseAcademyToFreeAgency(player, reason = "academy-exit") {
  ensureAcademyLifecycle(player);
  ensureContractAuthority(player);
  clearAcademyReview(player, { markConsumed: true });
  player.pendingOffers = [];
  player.suppressParentContractOffer = false;

  // Preserve academy origin as history metadata.
  if (!player.academyOrigin) {
    player.academyOrigin = {
      clubName: player.club?.name || player.academyLifecycle.originClubName || null,
      parentClubId:
        player.club?.parentClub?.clubId || player.academyLifecycle.originParentClubId || null,
      releasedAtAge: player.age,
      releasedAtSeasons: completedSeasons(player),
      reason,
    };
  }

  const result = releaseToFreeAgency(player, reason);
  player.academyLifecycle.status = "released";
  // Ensure academy flag cannot linger on a null club path.
  if (player.club) player.club = null;

  return {
    ok: true,
    action: "released",
    isFinal: true,
    released: true,
    graduated: false,
    reason,
    release: result,
  };
}

/**
 * Accept a first-pro offer from an academy review / desk.
 */
export function acceptAcademyGraduationOffer(player, dealOrOffer) {
  ensureAcademyLifecycle(player);
  ensureContractAuthority(player);

  if (!isAcademyEnrolled(player)) {
    return { ok: false, reason: "not-academy" };
  }

  const life = player.academyLifecycle;
  const review = life.pendingReview;
  const offer = dealOrOffer?.offer || dealOrOffer;
  if (!offer) return { ok: false, reason: "missing-offer" };

  // If a review is pending, the offer must belong to it (or be revalidated fresh).
  if (review && offer.academyReviewId && offer.academyReviewId !== review.reviewId) {
    return { ok: false, reason: "stale-review-offer" };
  }

  const deal =
    dealOrOffer?.offer != null
      ? dealOrOffer
      : { offer, kind: offer.isParentOffer ? "parent" : "counter", club: null };

  const signed = signFirstProfessionalContract(player, deal);
  if (!signed.ok) {
    // Preserve other executable offers.
    return {
      ok: false,
      reason: signed.reason || "sign-failed",
      reasons: signed.reasons,
      remainingOffers: (player.pendingOffers || []).filter(
        (o) => o !== offer && o.offerId !== offer.offerId
      ),
    };
  }

  // Mark review offer consumed; clear academy review state.
  if (review) {
    if (offer.offerId && !review.consumedOfferIds.includes(offer.offerId)) {
      review.consumedOfferIds.push(offer.offerId);
    }
    if (!life.consumedReviewIds.includes(review.reviewId)) {
      life.consumedReviewIds.push(review.reviewId);
    }
  }
  clearAcademyReview(player);
  life.status = "graduated";
  player.suppressParentContractOffer = false;
  consumeRelatedDecisionAfterDeal(player, offer);
  player.pendingOffers = [];

  if (player.state) {
    player.state.adaptationPenalty = clamp((player.state.adaptationPenalty || 0) + 0.35, 0, 1.5);
    player.state.roleFit = clamp((player.state.roleFit ?? 1) - 0.05, 0.6, 1);
  }
  refreshAbilityCaches(player);

  return {
    ok: true,
    action: "graduated",
    graduated: true,
    released: false,
    clubName: signed.clubName,
    transactionId: signed.transactionId,
  };
}

/**
 * Decline all offers in the current academy review.
 * Below exit age → continue enrolled. At final → release.
 */
export function declineAcademyReview(player, opts = {}) {
  ensureAcademyLifecycle(player);
  const life = player.academyLifecycle;
  const review = life.pendingReview;
  const isFinal = Boolean(review?.isFinal || life.status === "pending-final-review");

  for (const o of player.pendingOffers || []) {
    o.status = "declined";
  }
  player.pendingOffers = [];
  clearAcademyReview(player, { markConsumed: true });

  if (isFinal || (Number(player.age) || 0) >= academyExitAge(player)) {
    return releaseAcademyToFreeAgency(player, opts.reason || "academy-exit-declined");
  }

  life.status = "enrolled";
  return {
    ok: true,
    action: "continue-academy",
    isFinal: false,
    released: false,
    graduated: false,
  };
}

/**
 * Primary entry: advance academy enrollment by one period or resolve over-age exit.
 * Called from simulateSeason before any senior chronology.
 */
export function advanceAcademyPeriod(player, opts = {}) {
  ensureAcademyLifecycle(player);
  ensureContractAuthority(player);
  ensurePlayerModel(player);

  if (!isAcademyEnrolled(player)) {
    return { ok: false, reason: "not-academy" };
  }

  const life = player.academyLifecycle;
  const exitAge = academyExitAge(player);
  const age = Number(player.age) || 0;

  // Pending final review: do not simulate another youth year.
  if (life.status === "pending-final-review" && life.pendingReview) {
    return {
      ok: true,
      resultKind: ACADEMY_RESULT_KIND.REVIEW_ONLY,
      academyPeriod: false,
      reviewOnly: true,
      isFinal: true,
      season: null,
      review: life.pendingReview,
      performanceScore: 55,
      nextAction: selectNextCareerAction(player),
      freeAgent: false,
    };
  }

  const offerProvider = opts.offerProvider || null;

  // Legacy / over-age: already at or past exit without a pending period — review/release only.
  if (age >= exitAge) {
    const boundary = applyAcademyBoundaryPolicy(player, {
      periodCompleted: false,
      offerProvider,
    });
    return {
      ok: true,
      resultKind: boundary.released
        ? ACADEMY_RESULT_KIND.RELEASED
        : ACADEMY_RESULT_KIND.REVIEW_ONLY,
      academyPeriod: false,
      reviewOnly: true,
      isFinal: true,
      season: null,
      boundary,
      review: boundary.review || life.pendingReview,
      performanceScore: 55,
      nextAction: selectNextCareerAction(player),
      freeAgent: Boolean(boundary.released),
      wait: boundary.released
        ? { ok: true, action: "academy-release", age: player.age }
        : undefined,
    };
  }

  // Complete one youth period.
  const completed = completeAcademyPeriod(player, opts);
  if (!completed.ok) {
    return completed;
  }

  const boundary = applyAcademyBoundaryPolicy(player, {
    periodCompleted: true,
    offerProvider,
  });

  let resultKind = ACADEMY_RESULT_KIND.PERIOD;
  if (boundary.released) resultKind = ACADEMY_RESULT_KIND.RELEASED;
  else if (boundary.graduated) resultKind = ACADEMY_RESULT_KIND.GRADUATED;

  // Annotate the season record with boundary outcome for UI.
  if (completed.season) {
    completed.season.academyBoundaryAction = boundary.action;
    completed.season.academyIsFinal = Boolean(boundary.isFinal);
    completed.season.academyReleased = Boolean(boundary.released);
    completed.season.resultKind = resultKind;
  }

  return {
    ok: true,
    resultKind,
    academyPeriod: true,
    reviewOnly: false,
    isFinal: Boolean(boundary.isFinal),
    season: completed.season,
    periodId: completed.periodId,
    ratingBefore: completed.ratingBefore,
    ratingAfter: completed.ratingAfter,
    growth: completed.growth,
    boundary,
    review: boundary.review || null,
    performanceScore: Math.round(
      55 + Math.max(-8, Math.min(18, (completed.ratingAfter - completed.ratingBefore) * 4))
    ),
    nextAction: selectNextCareerAction(player),
    freeAgent: Boolean(boundary.released),
    wait: boundary.released
      ? { ok: true, action: "academy-release", age: player.age }
      : undefined,
  };
}

/**
 * Validate an academy season result payload before presentation.
 */
export function assertUsableAcademyResult(seasonData) {
  if (!seasonData) return { ok: false, reason: "missing-payload" };
  const kind = seasonData.resultKind || seasonData.season?.resultKind;
  const isAcademy =
    seasonData.academyPeriod ||
    seasonData.reviewOnly ||
    kind === ACADEMY_RESULT_KIND.PERIOD ||
    kind === ACADEMY_RESULT_KIND.REVIEW_ONLY ||
    kind === ACADEMY_RESULT_KIND.RELEASED ||
    seasonData.season?.isNarrativeAcademyYear ||
    seasonData.season?.academyPeriod;
  if (!isAcademy) return { ok: false, reason: "not-academy-result" };

  if (seasonData.reviewOnly && !seasonData.season) {
    return { ok: true, kind: "review-only" };
  }

  const season = seasonData.season;
  if (!season) return { ok: false, reason: "missing-season" };
  if (!season.isNarrativeAcademyYear && !season.academyPeriod) {
    return { ok: false, reason: "unmarked-academy-season" };
  }
  // Must not look like a senior campaign.
  if (season.standing != null && season.standing !== "Academy" && typeof season.standing === "number") {
    return { ok: false, reason: "senior-standing-on-academy" };
  }
  return { ok: true, season, kind: kind || ACADEMY_RESULT_KIND.PERIOD };
}

/**
 * Migrate legacy academy player state onto the lifecycle.
 */
export function migrateAcademyLifecycle(player) {
  if (!player || typeof player !== "object") return { migrated: false };
  ensureAcademyLifecycle(player);
  const life = player.academyLifecycle;
  let changed = false;

  if (player.club?.isAcademy) {
    if (!life.originClubName) {
      life.originClubName = player.club.name;
      changed = true;
    }
    if (!life.originParentClubId && player.club.parentClub?.clubId) {
      life.originParentClubId = player.club.parentClub.clubId;
      changed = true;
    }
    // Derive period count from history if unset.
    const hist = countAcademyHistory(player);
    if (!life.periodCount || life.periodCount < hist) {
      life.periodCount = hist;
      changed = true;
    }

    // Clear senior-blocking pending state for genuine academy enrollment.
    if (player.pendingSeniorScenario || player.seasonCheckpoint) {
      clearIncompatibleSeniorPending(player);
      changed = true;
    }

    // Over-age: force pending final path without inventing a year.
    const age = Number(player.age) || 0;
    if (age >= academyExitAge(player) && life.status === "enrolled" && !life.pendingReview) {
      // Leave enrolled; next simulateSeason will review-only / release.
      changed = true;
    }

    // suppressParentContractOffer alone must not leave the player stuck without a review path.
    // Reviews clear it when built.
  } else if (life.status === "enrolled" || life.status === "pending-review") {
    // No longer academy — mark inactive/graduated based on contract.
    if (player.club && !player.club.isAcademy) {
      life.status = "graduated";
      clearAcademyReview(player, { markConsumed: true });
      changed = true;
    } else if (!player.club) {
      life.status = "released";
      clearAcademyReview(player, { markConsumed: true });
      changed = true;
    }
  }

  life.version = ACADEMY_LIFECYCLE_VERSION;
  return { migrated: changed, player };
}

/**
 * Build a simulateSeason-compatible return payload from advanceAcademyPeriod.
 */
export function toAcademySeasonResult(advance) {
  if (!advance?.ok) return advance;
  return {
    season: advance.season,
    academyPeriod: Boolean(advance.academyPeriod),
    reviewOnly: Boolean(advance.reviewOnly),
    resultKind: advance.resultKind,
    isFinal: Boolean(advance.isFinal),
    freeAgent: Boolean(advance.freeAgent),
    performanceScore: advance.performanceScore ?? 55,
    nextAction: advance.nextAction,
    boundary: advance.boundary,
    review: advance.review,
    wait: advance.wait,
    // Explicitly empty senior competition fields so UI never invents a table.
    standings: null,
    league: null,
    leagueAllMatches: [],
    leaguePlayerMatches: [],
    chronology: null,
  };
}
