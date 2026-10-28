/**
 * Bounded academy enrollment policy for Fix 04.
 * Separate from PROSPECT_PATHWAY recruitment settings — do not conflate.
 */
export const ACADEMY_LIFECYCLE_VERSION = 1;

/** Completing the academy year that reaches this age triggers the final senior review. */
export const ACADEMY_EXIT_AGE = 21;

/**
 * Soft overall-point request for a continuation youth period.
 * Shared with DEVELOPMENT_CAPS.annualLearningCap via applyAcademyGrowth.
 */
export const ACADEMY_CONTINUATION_TRAINING = Object.freeze({
  /** Typical requested gain before annual/ability caps. */
  requestedGain: 2.4,
  /** Age soft-factor: older academy years train a little less. */
  ageSoftStart: 18,
  ageSoftPerYear: 0.15,
});

export const ACADEMY_RESULT_KIND = Object.freeze({
  PERIOD: "academy-period",
  REVIEW_ONLY: "academy-review-only",
  RELEASED: "academy-released",
  GRADUATED: "academy-graduated",
});
