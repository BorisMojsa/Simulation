/**
 * Academy opening (five moments + baseline training) tuning.
 * Opening-only — does not raise senior annual learning caps.
 */

export const ACADEMY_OPENING = Object.freeze({
  momentCount: 5,
  /** How many of the five moments come from the shared academy-life pool. */
  lifeMomentCount: 2,
  clamp: Object.freeze({ min: 50, max: 88 }),

  /**
   * Shared positive learning budget for baseline + five moments (overall points).
   * Matches DEVELOPMENT_CAPS.annualLearningCap so the opening is one academy year.
   */
  /**
   * Shared positive learning budget for baseline + five moments.
   * Starts sit on whole-number OVR, so a single successful beat needs ~0.5+ raw
   * to move the displayed board rating.
   */
  openingPositiveCap: 3.6,

  /** Year-of-coaching credit applied once at the end of the opening. */
  baselineTrainingGain: 0.85,

  /**
   * Narrative outcome score → requested overall-point change before budgets/ceilings.
   * +2/+3 are sized to often cross a displayed OVR boundary from an integer start.
   */
  narrativeToRequest: Object.freeze({
    4: 1.1,
    3: 0.9,
    2: 0.72,
    1: 0.55,
    0: 0,
    "-1": -0.12,
    "-2": -0.35,
    "-3": -0.55,
    "-4": -0.7,
  }),

  /** Soft per-moment clamps after narrative mapping (before shared budget). */
  maxPositivePerMoment: 1.0,
  maxNegativePerMoment: 0.6,

  /** Rare, bounded latent-budget nudge from exceptional mentorship / habits. */
  rareBudgetBump: Object.freeze({
    maxTotal: 0.4,
    maxPerEvent: 0.25,
    minNarrative: 3,
    baseChance: 0.03,
  }),

  /** Disruption from poor attendance / injury flags reduces remaining scene headroom. */
  disruptionPerFlag: 0.12,
  maxDisruption: 0.55,

  /** Default outcome weight when an entry has no explicit weight. */
  defaultUnweightedWeight: 1,

  /** Stream names — independent of match / injury / transfer / forecast. */
  streams: Object.freeze({
    scenarios: "academy-opening:scenarios",
    outcomes: "academy-opening:outcomes",
    baseline: "academy-opening:baseline",
    rare: "academy-opening:rare",
  }),
});

/**
 * Disposition → relative weights by narrative delta.
 * Thoughtful choices lean modest improvement; reckless lean downside extremes.
 */
export const OUTCOME_WEIGHT_BY_DISPOSITION = Object.freeze({
  thoughtful: Object.freeze({
    4: 0.35,
    3: 1.2,
    2: 2.6,
    1: 3.4,
    0: 2.2,
    "-1": 0.7,
    "-2": 0.25,
    "-3": 0.08,
    "-4": 0.03,
  }),
  balanced: Object.freeze({
    4: 0.55,
    3: 1.5,
    2: 2.5,
    1: 2.4,
    0: 1.6,
    "-1": 0.9,
    "-2": 0.5,
    "-3": 0.22,
    "-4": 0.1,
  }),
  ambitious: Object.freeze({
    4: 1.55,
    3: 1.95,
    2: 1.55,
    1: 1.25,
    0: 1.5,
    "-1": 1.05,
    "-2": 1.15,
    "-3": 0.8,
    "-4": 0.35,
  }),
  reckless: Object.freeze({
    4: 1.25,
    3: 1.0,
    2: 0.85,
    1: 0.75,
    0: 1.15,
    "-1": 1.7,
    "-2": 2.2,
    "-3": 2.4,
    "-4": 1.2,
  }),
});
