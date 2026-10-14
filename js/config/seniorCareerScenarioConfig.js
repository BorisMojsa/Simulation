/**
 * Senior career optional decision scenes — tuning only.
 * Independent of match / transfer / academy-opening RNG streams.
 */

export const SENIOR_CAREER_SCENARIOS = Object.freeze({
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
    order: "senior-scenario:order",
    life: "senior-scenario:life",
  }),

  /** Narrative score → temporary-state / soft learning request (not raw OVR). */
  narrativeToRequest: Object.freeze({
    4: 0.35,
    3: 0.28,
    2: 0.2,
    1: 0.12,
    0: 0,
    "-1": -0.08,
    "-2": -0.14,
    "-3": -0.2,
    "-4": -0.28,
  }),

  /** Soft per-scene clamps on temporary overall-equivalent influence. */
  maxPositivePerScene: 0.4,
  maxNegativePerScene: 0.3,

  /** Lifetime cap on rare latent-ceiling nudges from mentoring. */
  rareCeilingBump: Object.freeze({
    maxLifetime: 0.25,
    maxPerEvent: 0.12,
    minNarrative: 3,
    maxAge: 23,
  }),

  defaultUnweightedWeight: 1,

  /** Headless policies that do not always pick the largest reward. */
  defaultAutoPolicy: "balanced",
});

/**
 * Disposition → relative weights by narrative delta (shared idea with academy opening).
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
