/**
 * player-development-v2 — centralised tuning.
 *
 * Every number that shapes player ability, development, state, injuries,
 * potential forecasting and migration lives here. Simulation modules import
 * from this file and contain no magic constants of their own.
 *
 * Conceptually adapted from Open Football (Apache-2.0, rev 8ddc808);
 * see THIRD_PARTY_NOTICES.md.
 *
 * Units
 *  - Attributes: floats in [1, 99].
 *  - "Overall points": change in the position-weighted overall (same scale as OVR).
 *  - "Attribute points": change in a single attribute.
 *  - Ages are whole/fractional years; days are calendar days.
 */

export const PLAYER_MODEL_VERSION = 2;
export const DEVELOPMENT_MODEL_VERSION = "player-development-v2";

function deepFreeze(obj) {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    Object.values(obj).forEach(deepFreeze);
  }
  return obj;
}

/* ------------------------------------------------------------------ */
/* Attribute keys                                                      */
/* ------------------------------------------------------------------ */

export const OUTFIELD_ATTRIBUTE_KEYS = Object.freeze([
  "Speed",
  "Passing",
  "Shooting",
  "Defending",
  "Physicality",
  "Dribbling",
]);

export const GK_ATTRIBUTE_KEYS = Object.freeze([
  "Reflexes",
  "Handling",
  "Positioning",
  "Diving",
  "Kicking",
  "Physicality",
]);

export const ATTRIBUTE_MIN = 1;
export const ATTRIBUTE_MAX = 99;
/** Compatibility alias used by ability/health/development modules. */
export const ATTR_BOUNDS = Object.freeze({ min: ATTRIBUTE_MIN, max: ATTRIBUTE_MAX });

/* ------------------------------------------------------------------ */
/* Overall weights                                                     */
/* ------------------------------------------------------------------ */

const outfieldRow = (speed, passing, shooting, defending, physicality, dribbling) => ({
  Speed: speed,
  Passing: passing,
  Shooting: shooting,
  Defending: defending,
  Physicality: physicality,
  Dribbling: dribbling,
});

/** Position-weighted overall: weights per attribute; every row sums to 1. */
export const OUTFIELD_OVERALL_WEIGHTS = deepFreeze({
  //            Spd  Pas  Sho  Def  Phy  Dri
  ST: outfieldRow(0.2, 0.1, 0.35, 0.05, 0.15, 0.15),
  RW: outfieldRow(0.25, 0.15, 0.2, 0.05, 0.05, 0.3),
  LW: outfieldRow(0.25, 0.15, 0.2, 0.05, 0.05, 0.3),
  RM: outfieldRow(0.2, 0.25, 0.15, 0.05, 0.1, 0.25),
  LM: outfieldRow(0.2, 0.25, 0.15, 0.05, 0.1, 0.25),
  CAM: outfieldRow(0.1, 0.3, 0.25, 0.05, 0.05, 0.25),
  CM: outfieldRow(0.1, 0.3, 0.15, 0.15, 0.1, 0.2),
  CDM: outfieldRow(0.1, 0.25, 0.05, 0.3, 0.2, 0.1),
  RB: outfieldRow(0.2, 0.2, 0.05, 0.3, 0.15, 0.1),
  LB: outfieldRow(0.2, 0.2, 0.05, 0.3, 0.15, 0.1),
  CB: outfieldRow(0.1, 0.1, 0.03, 0.42, 0.3, 0.05),
  DEFAULT: outfieldRow(0.15, 0.2, 0.2, 0.15, 0.15, 0.15),
});

export const GK_OVERALL_WEIGHTS = deepFreeze({
  Reflexes: 0.25,
  Handling: 0.2,
  Positioning: 0.2,
  Diving: 0.15,
  Kicking: 0.1,
  Physicality: 0.1,
});

/** Free-form position labels -> canonical position (or "GK"). */
export const POSITION_ALIASES = deepFreeze({
  // forwards
  CF: "ST",
  SS: "ST",
  FW: "ST",
  F: "ST",
  RS: "ST",
  LS: "ST",
  RF: "ST",
  LF: "ST",
  STR: "ST",
  // wide forwards / wingers
  RWF: "RW",
  LWF: "LW",
  WF: "RW",
  RAM: "RW",
  LAM: "LW",
  W: "RW",
  // wide mids
  RWM: "RM",
  LWM: "LM",
  WM: "RM",
  // attacking mids
  AM: "CAM",
  CAMF: "CAM",
  AMC: "CAM",
  "10": "CAM",
  // central mids
  MF: "CM",
  M: "CM",
  CMF: "CM",
  MC: "CM",
  RCM: "CM",
  LCM: "CM",
  // defensive mids
  DM: "CDM",
  DMF: "CDM",
  DMC: "CDM",
  RDM: "CDM",
  LDM: "CDM",
  HB: "CDM",
  // full backs / wing backs
  RWB: "RB",
  LWB: "LB",
  WB: "RB",
  RFB: "RB",
  LFB: "LB",
  FB: "RB",
  DR: "RB",
  DL: "LB",
  // centre backs
  D: "CB",
  DF: "CB",
  DC: "CB",
  RCB: "CB",
  LCB: "CB",
  SW: "CB",
  CBR: "CB",
  CBL: "CB",
  // goalkeepers
  G: "GK",
  GKP: "GK",
  GOALKEEPER: "GK",
});

/** Worst-case attribute-shape spread for generated players (see generateStartingAttributes). */
export const ATTRIBUTE_SHAPE = Object.freeze({
  /** attr = target + shapeScale * (weight - 1/n) + noise */
  shapeScale: 45,
  noiseSd: 3.5,
});

/* ------------------------------------------------------------------ */
/* Latent ability budget                                               */
/* ------------------------------------------------------------------ */

/**
 * Ordinary academy graduate latent base-ability budget prior (game population).
 * `mass` is a probability fraction (sums to 1); budget drawn uniformly in [min, max].
 * Spec from player-development implementation prompt.
 */
export const LATENT_BUDGET_BANDS = deepFreeze([
  { id: "ordinary", mass: 0.4, min: 70, max: 78 },
  { id: "solid", mass: 0.35, min: 78, max: 85 },
  { id: "strong", mass: 0.18, min: 85, max: 90 },
  { id: "star", mass: 0.05, min: 90, max: 94 },
  { id: "elite", mass: 0.0195, min: 94, max: 98.49 },
  { id: "generational", mass: 0.0005, min: 98.5, max: 99 },
]);

/** Absolute ceiling for any budget / potential cache. */
export const BUDGET_HARD_MAX = 99;
export const POTENTIAL_HARD_MAX = 99;

/** Extra budget over current overall, by age, when initialising a player whose overall exceeds the sampled budget. */
export const BUDGET_LIFT_BY_AGE = deepFreeze([
  { maxAge: 19, lift: 2.5 },
  { maxAge: 23, lift: 1.5 },
  { maxAge: 27, lift: 0.75 },
  { maxAge: 99, lift: 0.1 },
]);

/** Per-attribute ceilings relative to the budget. */
export const CEILING_CONFIG = Object.freeze({
  /** Individual ceilings are slightly looser than the budget; the budget caps the weighted total. */
  slack: 1.12,
  /** Random per-attribute share range before normalisation. */
  shareMin: 0.6,
  shareMax: 1.4,
  extraMax: 1.0,
});

/* ------------------------------------------------------------------ */
/* Curves                                                              */
/* ------------------------------------------------------------------ */

/**
 * Annual learning (attr points/year) by effective development age — prompt defaults.
 * Linearly interpolate between knots; use nearest endpoint outside the range.
 */
export const LEARNING_CURVE_KNOTS = deepFreeze([
  { age: 16, physical: 3.2, technical: 2.7, mental: 2.0, goalkeeping: 2.2 },
  { age: 19, physical: 2.5, technical: 2.6, mental: 2.0, goalkeeping: 2.3 },
  { age: 22, physical: 1.2, technical: 1.8, mental: 1.5, goalkeeping: 1.7 },
  { age: 25, physical: 0.3, technical: 0.9, mental: 1.0, goalkeeping: 1.1 },
  { age: 28, physical: 0, technical: 0.3, mental: 0.6, goalkeeping: 0.6 },
  { age: 31, physical: 0, technical: 0.1, mental: 0.3, goalkeeping: 0.3 },
  { age: 34, physical: 0, technical: 0, mental: 0.1, goalkeeping: 0.1 },
  { age: 37, physical: 0, technical: 0, mental: 0, goalkeeping: 0 },
]);

/** Annual ageing losses by effective development age — prompt defaults. */
export const AGEING_LOSS_KNOTS = deepFreeze([
  { age: 16, physical: 0, technical: 0, mental: 0, goalkeeping: 0 },
  { age: 22, physical: 0, technical: 0, mental: 0, goalkeeping: 0 },
  { age: 25, physical: 0.1, technical: 0, mental: 0, goalkeeping: 0 },
  { age: 28, physical: 0.45, technical: 0.05, mental: 0, goalkeeping: 0 },
  { age: 31, physical: 1.0, technical: 0.2, mental: 0, goalkeeping: 0.12 },
  { age: 34, physical: 1.8, technical: 0.5, mental: 0.06, goalkeeping: 0.35 },
  { age: 37, physical: 2.8, technical: 0.9, mental: 0.2, goalkeeping: 0.75 },
  { age: 40, physical: 3.8, technical: 1.4, mental: 0.45, goalkeeping: 1.3 },
]);

/**
 * Piecewise-linear interpolation.
 * Supports `[[x, y], ...]` pairs or `{ age, [family]: value }` rows.
 */
export function interpolateKnots(knots, x, family = null) {
  if (!knots?.length) return 0;
  const isPair = Array.isArray(knots[0]);
  const getX = (k) => (isPair ? k[0] : k.age);
  const getY = (k) => (isPair ? k[1] : family ? k[family] ?? 0 : 0);
  if (!Number.isFinite(x) || x <= getX(knots[0])) return getY(knots[0]);
  const last = knots[knots.length - 1];
  if (x >= getX(last)) return getY(last);
  for (let i = 1; i < knots.length; i++) {
    const x1 = getX(knots[i]);
    if (x <= x1) {
      const x0 = getX(knots[i - 1]);
      const t = (x - x0) / (x1 - x0 || 1);
      return getY(knots[i - 1]) * (1 - t) + getY(knots[i]) * t;
    }
  }
  return getY(last);
}

/* ------------------------------------------------------------------ */
/* Attribute families                                                  */
/* ------------------------------------------------------------------ */

export const FAMILY_NAMES = Object.freeze(["physical", "technical", "mental", "goalkeeping"]);

/**
 * Optional extra scales on top of family-specific knot tables.
 * With prompt knot tables, leave scales at 1 (knots already encode family differences).
 */
export const FAMILY_PARAMS = deepFreeze({
  physical: { learningScale: 1.0, lossScale: 1.0, lossAgeShift: 0 },
  technical: { learningScale: 1.0, lossScale: 1.0, lossAgeShift: 0 },
  mental: { learningScale: 1.0, lossScale: 1.0, lossAgeShift: 0 },
  goalkeeping: { learningScale: 1.0, lossScale: 1.0, lossAgeShift: 0 },
});

/** Coarse family blends for the existing small attribute set (prompt defaults). */
export const ATTRIBUTE_FAMILIES = deepFreeze({
  Speed: { physical: 1 },
  Physicality: { physical: 0.6, technical: 0.4 },
  Dribbling: { physical: 0.25, technical: 0.75 },
  Shooting: { technical: 1 },
  Passing: { technical: 1 },
  Defending: { technical: 0.6, mental: 0.4 },
  Reflexes: { physical: 0.6, goalkeeping: 0.4 },
  Diving: { physical: 0.6, goalkeeping: 0.4 },
  Handling: { goalkeeping: 1 },
  Positioning: { mental: 1 },
  Kicking: { technical: 1 },
});

/* ------------------------------------------------------------------ */
/* Temporary state                                                     */
/* ------------------------------------------------------------------ */

/**
 * State -> overall delta (overall points, distributed over attributes).
 * Neutral state (form 0, morale 0, readiness 1, fatigue 0, adaptation 0) = 0.
 *   delta = form*2.25 + morale*0.75 + (1-readiness)*(-3) + fatigue*(-1.5) + adaptation*(-2)
 */
export const STATE_DELTA = Object.freeze({
  form: 2.25,
  morale: 0.75,
  readiness: -3,
  fatigue: -1.5,
  adaptation: -2,
  min: -6,
  max: 3,
  // Compatibility names used by playerAbility / playerState
  formWeight: 2.25,
  moraleWeight: 0.75,
  readinessWeight: 3.0,
  fatigueWeight: 1.5,
  clampMin: -6,
  clampMax: 3,
  formAlpha: 0.18,
  formHalfLifeDays: 45,
  adaptationHalfLifeDays: 60,
  moraleEventBound: 0.05,
  internationalMoraleBound: 0.03,
});

export const STATE_DYNAMICS = deepFreeze({
  form: { alphaPer90: 0.22, maxMinutesFactor: 1.25, halfLifeDays: 35 },
  morale: { maxEventDelta: 0.05, halfLifeDays: 60 },
  readiness: { gainPer90: 0.6, decayPerDay: 0.006, floor: 0.5 },
  fatigue: { perFull90: 0.25, recoveryPerDay: 0.12 },
  adaptation: { halfLifeDays: 60 },
});

/** Cap on temporary injury penalty (overall points) while injured / returning. */
export const HEALTH_EFFECT_MAX_PENALTY = 12;

/* ------------------------------------------------------------------ */
/* Injuries                                                            */
/* ------------------------------------------------------------------ */

export const INJURY_HAZARDS = deepFreeze({
  /** Expected injuries per exposure hour at risk multiplier 1. */
  matchPerHour: 0.02,
  trainingPerHour: 0.003,
  positionMultiplier: { GK: 0.6, CB: 1.0, CDM: 1.0, CM: 1.0, ST: 1.1, RW: 1.1, LW: 1.1, DEFAULT: 1.0 },
  /** Severity mixture; p sums to 1. Penalties in overall points while injured. */
  severityMixture: [
    { id: "minor", p: 0.55, minDays: 3, maxDays: 14, overallPenalty: 2, returnReadiness: 0.85 },
    { id: "moderate", p: 0.3, minDays: 15, maxDays: 42, overallPenalty: 3, returnReadiness: 0.75 },
    { id: "major", p: 0.12, minDays: 43, maxDays: 120, overallPenalty: 4.5, returnReadiness: 0.65 },
    { id: "severe", p: 0.03, minDays: 121, maxDays: 300, overallPenalty: 6, returnReadiness: 0.55 },
  ],
  /** Probability that an injury of the given severity causes durable attribute damage, and its total size (attribute points). */
  durableDamage: {
    minor: { prob: 0, min: 0, max: 0 },
    moderate: { prob: 0.03, min: 0.3, max: 1.0 },
    major: { prob: 0.22, min: 1.0, max: 2.5 },
    severe: { prob: 0.55, min: 2.0, max: 5.0 },
  },
  /** Share of durable damage tracked as recoverable (rehab / training can restore it). */
  recoverableFraction: 0.5,
  /** Where damage lands: relative weights per attribute. */
  damageTargets: {
    outfield: { Speed: 0.45, Physicality: 0.3, Dribbling: 0.25 },
    goalkeeper: { Reflexes: 0.35, Diving: 0.25, Physicality: 0.4 },
  },
  /** Hazard growth per year beyond `ageStart`. */
  ageHazard: { ageStart: 29, perYear: 0.015 },
  riskMultiplier: { min: 0.5, max: 2 },
});

/* ------------------------------------------------------------------ */
/* Development caps and annual components                              */
/* ------------------------------------------------------------------ */

export const DEVELOPMENT_CAPS = deepFreeze({
  /** Max annual learning gain in overall points (per elapsed year). */
  annualLearningCap: 3,
  annualLearningCapBreakthrough: 6,
  breakthroughLearningCap: 6,
  breakthroughAttrPoints: 3,
  annualShockLimit: 0.6,
  deconditioningDaysBeforeLoss: 60,
  deconditioningPhysicalPerYear: 1.0,
  maxDeclineProtection: 0.25,
  regressionStrength: 2.5,
  /** Annual random shock (attribute points, sd) and its absolute clamp. */
  shockSd: 0.6,
  shockMaxAbs: 1.8,
  /** Multiplicative noise on learning (sd of normal, clamped). */
  learningNoiseSd: 0.3,
  learningNoiseMin: 0.3,
  learningNoiseMax: 1.9,
  /** Growth tapers to 0 over this many points of headroom to the attribute ceiling / the budget. */
  headroomTaperPoints: 6,
  budgetTaperPoints: 6,
  /** Regression of outliers: attribute above role-expected shape + tolerance. */
  regression: { tolerance: 12, ratePerYear: 0.08, overCeilingRate: 0.5 },
  /** Loss from too little healthy training. */
  deconditioning: { healthyFloor: 0.6, maxPerYear: 1.5, physicalOnly: true, daysBeforeLoss: 60 },
  /** Recoverable damage is restored when healthy training resumes. */
  restoration: { minHealthyFraction: 0.7, fractionPerYear: 0.5 },
  /** Use-it-keep-it: up to this share of ageing loss is avoided at full opportunity. */
  useItKeepItMax: 0.15,
  /** Performance (P_long x reliability) shifts learning by up to +-this share. */
  performanceLearningWeight: 0.25,
  environmentRange: { min: 0.5, max: 1.5 },
  maxElapsedYears: 2,
  historyLength: 40,
});

/** Season minutes that earn full development opportunity, by age. */
export const OPPORTUNITY_MINUTE_TARGETS = deepFreeze([
  { maxAge: 16, minutes: 900 },
  { maxAge: 17, minutes: 1300 },
  { maxAge: 18, minutes: 1700 },
  { maxAge: 19, minutes: 2100 },
  { maxAge: 22, minutes: 2400 },
  { maxAge: 99, minutes: 2700 },
]);

export const OPPORTUNITY_CONFIG = Object.freeze({
  /** Share of learning available from training alone (0 minutes). */
  floor: 0.35,
  youthFloor: 0.45,
  youthMaxAge: 18,
  exponent: 0.8,
});

/** Breakthrough seasons: rare, gated, and allowed a higher annual cap. */
export const BREAKTHROUGH = deepFreeze({
  enabled: true,
  probabilityByAgeBand: [
    { maxAge: 21, probability: 0.05 },
    { maxAge: 25, probability: 0.015 },
  ],
  minMinutesFraction: 0.6,
  minHealthyTrainingFraction: 0.6,
  minReliableSignal: 0.4,
  minPLong: 0.2,
  minBudgetHeadroom: 3,
  minTrainability: 0.9,
  learningMultiplier: 1.6,
});

/* ------------------------------------------------------------------ */
/* Traits                                                              */
/* ------------------------------------------------------------------ */

export const TRAIT_RANGES = Object.freeze({
  trainability: { min: 0.7, max: 1.3, mean: 1, sd: 0.15 },
  unit: { min: 0, max: 1 },
  maturityOffsetSd: 0.8,
  maturityOffsetMax: 2,
  declineProtectionMax: 0.25,
});

/* ------------------------------------------------------------------ */
/* Performance ledger                                                  */
/* ------------------------------------------------------------------ */

export const PERFORMANCE = deepFreeze({
  /** Match rating residual scale (rating points per 1 z). */
  residualScale: { default: 0.8, GK: 0.7, defender: 0.7, midfielder: 0.8, forward: 0.9 },
  residualScaleDefault: 0.6,
  defaultExpectedRating: 6.6,
  zClamp: 3,
  tanhDivisor: 1.5,
  tanhScale: 1.5,
  /** reliability = 1 - exp(-ratedMinutes / reliabilityMinutesScale) */
  reliabilityMinutesScale: 1200,
  reliabilityMinutes: 900,
  roleGroups: {
    GK: "GK",
    CB: "defender",
    RB: "defender",
    LB: "defender",
    CDM: "midfielder",
    CM: "midfielder",
    CAM: "midfielder",
    RM: "midfielder",
    LM: "midfielder",
    RW: "forward",
    LW: "forward",
    ST: "forward",
  },
  internationalTypes: ["international", "nationalTeam", "national"],
});

/* ------------------------------------------------------------------ */
/* Forecasting / migration                                             */
/* ------------------------------------------------------------------ */

export const FORECAST_CONFIG = deepFreeze({
  defaultSampleCount: 64,
  horizonAge: 36,
  lowerQuantile: 0.1,
  medianQuantile: 0.5,
  upperQuantile: 0.9,
  /** Scouting uncertainty about the hidden budget: sd = clamp(base - perYear*(age-16), min, base). */
  budgetUncertainty: { base: 6, perYear: 0.45, min: 0.75 },
  defaultAssumptions: {
    opportunity: 0.75,
    environmentMultiplier: 1,
    healthyTrainingFraction: 0.95,
    pLong: 0,
  },
  trajectoryNoiseSd: 0.35,
  shockSd: 0.35,
  /** confidence = clamp(1 - spread / confidenceSpread, 0.05, 0.99) */
  confidenceSpread: 16,
});

export const MIGRATION_CONFIG = Object.freeze({
  defaultAge: 24,
  defaultRating: 60,
  /** Legacy potential is honoured as budget only up to this value. */
  maxLegacyPotentialBudget: 97,
});

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Assert every overall-weight row is non-negative and sums to 1 (±1e-9),
 * every latent-band mass table sums to 100, and attribute-family blends sum to 1.
 * Throws on failure; returns true otherwise.
 */
export function validateWeights() {
  const tol = 1e-9;
  const check = (label, row) => {
    const values = Object.values(row);
    if (values.some((v) => !Number.isFinite(v) || v < 0)) {
      throw new Error(`playerDevelopmentConfig: ${label} has a negative/non-finite weight`);
    }
    const sum = values.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > tol) {
      throw new Error(`playerDevelopmentConfig: ${label} weights sum to ${sum}, expected 1`);
    }
  };
  for (const [pos, row] of Object.entries(OUTFIELD_OVERALL_WEIGHTS)) {
    if (OUTFIELD_ATTRIBUTE_KEYS.some((k) => !(k in row))) {
      throw new Error(`playerDevelopmentConfig: outfield row ${pos} is missing keys`);
    }
    check(`outfield ${pos}`, row);
  }
  if (GK_ATTRIBUTE_KEYS.some((k) => !(k in GK_OVERALL_WEIGHTS))) {
    throw new Error("playerDevelopmentConfig: GK weights missing keys");
  }
  check("GK", GK_OVERALL_WEIGHTS);
  for (const [attr, blend] of Object.entries(ATTRIBUTE_FAMILIES)) check(`family blend ${attr}`, blend);
  const massSum = LATENT_BUDGET_BANDS.reduce((s, b) => s + b.mass, 0);
  const massTarget = massSum > 2 ? 100 : 1;
  if (Math.abs(massSum - massTarget) > 1e-6) {
    throw new Error(`playerDevelopmentConfig: latent band masses sum to ${massSum}, expected ${massTarget}`);
  }
  const sevSum = INJURY_HAZARDS.severityMixture.reduce((s, b) => s + b.p, 0);
  if (Math.abs(sevSum - 1) > tol) {
    throw new Error(`playerDevelopmentConfig: injury severity mixture sums to ${sevSum}, expected 1`);
  }
  return true;
}

validateWeights();
