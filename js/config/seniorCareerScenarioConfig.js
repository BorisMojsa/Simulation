/**
 * Senior career optional decision scenes — tuning only.
 * Independent of match / transfer / academy-opening RNG streams.
 *
 * Outcome category probabilities are derived from academy OUTCOME_WEIGHT_BY_DISPOSITION
 * via the absolute percentage-point shift in SENIOR_PROBABILITY_SHIFT — not from a
 * separate senior weight table.
 */

import { ACADEMY_OPENING } from "./academyOpeningConfig.js";

export const SENIOR_CAREER_SCENARIOS = Object.freeze({
  contentVersion: 2,
  probabilityModelVersion: 2,

  /** One independent roll per entered competition edition. */
  triggerProbability: 0.3,

  /** Avoid repeating the same scenario id within this many seasons when alternatives exist. */
  repeatCooldownSeasons: 2,

  /** Prefer several calendar days between scheduled senior scenes in one season. */
  minDaysBetweenScenes: 5,

  streams: Object.freeze({
    trigger: "senior-scenario:trigger",
    selection: "senior-scenario:selection",
    outcome: "senior-scenario:outcome",
    category: "senior-scenario:category",
    conditional: "senior-scenario:conditional",
    allocation: "senior-scenario:allocation",
    order: "senior-scenario:order",
    life: "senior-scenario:life",
  }),

  /**
   * Narrative score → requested base-OVR equivalent (academy mapping).
   * Probability difficulty is separate; do not also shrink these magnitudes.
   */
  narrativeToRequest: Object.freeze({ ...ACADEMY_OPENING.narrativeToRequest }),

  /** Soft per-scene clamps after narrative mapping (before annual allowance). */
  maxPositivePerScene: ACADEMY_OPENING.maxPositivePerMoment,
  maxNegativePerScene: ACADEMY_OPENING.maxNegativePerMoment,

  defaultUnweightedWeight: 1,

  /** Headless policies that do not always pick the largest reward. */
  defaultAutoPolicy: "balanced",
});

/**
 * Absolute percentage-point adjustment from the academy full-table reference.
 * senior.positive = academy.positive − 0.10 (or available mass if lower)
 * senior.neutral/negative each receive half of the moved mass.
 */
export const SENIOR_PROBABILITY_SHIFT = Object.freeze({
  positiveReduction: 0.1,
  /** Half of the moved mass is added to neutral and half to negative. */
  splitToNeutralAndNegative: 0.05,
});

/**
 * @deprecated Legacy disposition weight table — no longer controls category totals.
 * Retained only for documentation / migration diagnostics. Conditional weights
 * within a category may still mirror severity ideas, but category probability
 * comes from the academy-reference transform.
 */
export const SENIOR_OUTCOME_WEIGHT_BY_DISPOSITION = Object.freeze({
  thoughtful: Object.freeze({
    4: 0.3,
    3: 1.1,
    2: 2.8,
    1: 3.5,
    0: 2.0,
    "-1": 0.65,
    "-2": 0.22,
    "-3": 0.07,
    "-4": 0.03,
  }),
  balanced: Object.freeze({
    4: 0.5,
    3: 1.4,
    2: 2.6,
    1: 2.5,
    0: 1.7,
    "-1": 0.95,
    "-2": 0.55,
    "-3": 0.25,
    "-4": 0.12,
  }),
  ambitious: Object.freeze({
    4: 1.4,
    3: 1.9,
    2: 1.6,
    1: 1.3,
    0: 1.4,
    "-1": 1.1,
    "-2": 1.15,
    "-3": 0.85,
    "-4": 0.4,
  }),
  reckless: Object.freeze({
    4: 1.1,
    3: 0.95,
    2: 0.8,
    1: 0.7,
    0: 1.2,
    "-1": 1.75,
    "-2": 2.3,
    "-3": 2.4,
    "-4": 1.25,
  }),
});
