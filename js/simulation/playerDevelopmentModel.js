/**
 * Core annual player development (player-development-v2).
 *
 * Conceptually adapted from Open Football (Apache-2.0, rev 8ddc808): age curves
 * per attribute family, ceilings, maturity offsets, opportunity bands and hard
 * growth caps. See THIRD_PARTY_NOTICES.md.
 *
 * Principles
 *  - Attributes are the truth; `rating` is a cache refreshed after every change.
 *  - A hidden latent budget (peak overall in the primary role) bounds growth.
 *  - Annual order: negatives first (ageing, regression, deconditioning,
 *    negative shocks) -> restoration of tracked recoverable damage -> positives
 *    (learning + positive shocks) scaled to fit both the annual learning cap
 *    and remaining budget room.
 *  - Randomness only via the supplied `rng`; no Math.random.
 */
import { clamp } from "../utils/helpers.js";
import {
  AGEING_LOSS_KNOTS,
  ATTRIBUTE_FAMILIES,
  ATTRIBUTE_MAX,
  ATTRIBUTE_MIN,
  ATTRIBUTE_SHAPE,
  BREAKTHROUGH,
  BUDGET_HARD_MAX,
  BUDGET_LIFT_BY_AGE,
  CEILING_CONFIG,
  DEVELOPMENT_CAPS,
  DEVELOPMENT_MODEL_VERSION,
  FAMILY_NAMES,
  FAMILY_PARAMS,
  LATENT_BUDGET_BANDS,
  LEARNING_CURVE_KNOTS,
  OPPORTUNITY_CONFIG,
  OPPORTUNITY_MINUTE_TARGETS,
  PLAYER_MODEL_VERSION,
  TRAIT_RANGES,
  interpolateKnots,
} from "../config/playerDevelopmentConfig.js";
import {
  calculateOverall,
  getDisplayAttributeKeys,
  getOverallWeights,
  normalizePosition,
  refreshAbilityCaches,
  validateAttributes,
} from "./playerAbility.js";
import { createNeutralState } from "./playerState.js";
import { applyRecoverableRestoration, createEmptyHealth, hasEventApplied, markEventApplied } from "./playerHealth.js";

/* ------------------------------------------------------------------ */
/* Small random helpers                                                */
/* ------------------------------------------------------------------ */

/** Standard normal via Box-Muller (consumes two rng draws). */
export function sampleGaussian(rng) {
  const u1 = Math.max(rng.random(), 1e-12);
  const u2 = rng.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Mean of two uniforms in [0, 1] (triangular, centred at 0.5). */
function sampleUnitTriangular(rng) {
  return (rng.random() + rng.random()) / 2;
}

function requireRng(rng, label) {
  if (!rng || typeof rng.random !== "function") throw new TypeError(`${label} requires an rng`);
  return rng;
}

/**
 * Stable RNG-stream key for a player/career: explicit careerId when known,
 * otherwise derived from immutable identity fields.
 */
export function stableCareerId(player) {
  if (!player) return "career";
  const explicit = player.development?.careerId ?? player.careerId;
  if (explicit !== undefined && explicit !== null && explicit !== "") return String(explicit);
  return `${player.name ?? "player"}|${player.nationality ?? ""}|${player.startYear ?? ""}`;
}

/* ------------------------------------------------------------------ */
/* Budget and traits                                                   */
/* ------------------------------------------------------------------ */

/** Draw a latent budget (peak overall) from the banded prior. */
export function sampleLatentBudget(rng) {
  requireRng(rng, "sampleLatentBudget");
  const total = LATENT_BUDGET_BANDS.reduce((s, b) => s + b.mass, 0);
  let roll = rng.random() * total;
  let band = LATENT_BUDGET_BANDS[LATENT_BUDGET_BANDS.length - 1];
  for (const b of LATENT_BUDGET_BANDS) {
    roll -= b.mass;
    if (roll < 0) {
      band = b;
      break;
    }
  }
  return Math.min(BUDGET_HARD_MAX, band.min + rng.random() * (band.max - band.min));
}

/**
 * Hidden development traits.
 *  trainability ∈ [0.7, 1.3]; professionalism / naturalFitness / resilience ∈ [0, 1];
 *  maturityOffsets: years (+ = late bloomer) per family; declineProtection ∈ [0, 0.25].
 */
export function sampleTraits(rng) {
  requireRng(rng, "sampleTraits");
  const t = TRAIT_RANGES;
  const trainability = clamp(t.trainability.mean + t.trainability.sd * sampleGaussian(rng), t.trainability.min, t.trainability.max);
  const professionalism = clamp(sampleUnitTriangular(rng), 0, 1);
  const naturalFitness = clamp(sampleUnitTriangular(rng), 0, 1);
  const resilience = clamp(sampleUnitTriangular(rng), 0, 1);
  const maturityOffsets = {};
  for (const fam of FAMILY_NAMES) {
    maturityOffsets[fam] = clamp(t.maturityOffsetSd * sampleGaussian(rng), -t.maturityOffsetMax, t.maturityOffsetMax);
  }
  const declineProtection = clamp(
    t.declineProtectionMax * (0.5 * naturalFitness + 0.5 * professionalism) * (0.8 + 0.4 * rng.random()),
    0,
    t.declineProtectionMax,
  );
  return { trainability, professionalism, naturalFitness, resilience, maturityOffsets, declineProtection };
}

/* ------------------------------------------------------------------ */
/* Attribute generation                                                */
/* ------------------------------------------------------------------ */

function weightedOverall(attrs, keys, weights) {
  let s = 0;
  for (const k of keys) s += weights[k] * attrs[k];
  return s;
}

/**
 * Generate attributes whose weighted overall equals `target` (±0.01): role-shaped
 * (high-weight attributes sit above the mean) with noise, then a shared offset is
 * solved so the weighted overall hits the target despite [1, 99] clamping.
 */
function generateAttributesForTarget(position, target, budget, rng) {
  requireRng(rng, "attribute generation");
  const keys = getDisplayAttributeKeys(position);
  const weights = getOverallWeights(position);
  const n = keys.length;
  const goal = clamp(Math.min(target, Number.isFinite(budget) ? budget : Infinity), ATTRIBUTE_MIN + 1, ATTRIBUTE_MAX - 1);
  const attrs = {};
  for (const k of keys) {
    const shape = ATTRIBUTE_SHAPE.shapeScale * (weights[k] - 1 / n);
    attrs[k] = clamp(goal + shape + ATTRIBUTE_SHAPE.noiseSd * sampleGaussian(rng), ATTRIBUTE_MIN, ATTRIBUTE_MAX);
  }
  for (let i = 0; i < 24; i++) {
    const diff = goal - weightedOverall(attrs, keys, weights);
    if (Math.abs(diff) < 0.005) break;
    for (const k of keys) attrs[k] = clamp(attrs[k] + diff, ATTRIBUTE_MIN, ATTRIBUTE_MAX);
  }
  // Never exceed the budget, even by solver tolerance.
  const over = weightedOverall(attrs, keys, weights) - budget;
  if (over > 0) for (const k of keys) attrs[k] = clamp(attrs[k] - over, ATTRIBUTE_MIN, ATTRIBUTE_MAX);
  return attrs;
}

function resolveTarget(targetBand, rng) {
  if (Number.isFinite(targetBand)) return targetBand;
  if (Array.isArray(targetBand)) return rng.float(targetBand[0], targetBand[1]);
  if (targetBand && Number.isFinite(targetBand.min)) return rng.float(targetBand.min, targetBand.max ?? targetBand.min);
  throw new TypeError("targetBand must be a number, [min, max] or {min, max}");
}

/**
 * Outfield (or role-appropriate) starting attributes.
 * @param {string} position
 * @param {number|[number,number]|{min:number,max:number}} targetBand  target weighted overall
 * @param {number} budget  latent budget; the result's overall never exceeds it
 * @param {object} rng
 * @returns {object} attributes (floats in [1, 99])
 */
export function generateStartingAttributes(position, targetBand, budget, rng) {
  requireRng(rng, "generateStartingAttributes");
  return generateAttributesForTarget(position, resolveTarget(targetBand, rng), budget, rng);
}

/** Goalkeeper attributes (Reflexes, Handling, Positioning, Diving, Kicking, Physicality). */
export function generateGkAttributes(targetBand, budget, rng) {
  requireRng(rng, "generateGkAttributes");
  return generateAttributesForTarget("GK", resolveTarget(targetBand, rng), budget, rng);
}

/**
 * Per-attribute ceilings: current + (budget - overall) distributed with random shares
 * (weighted total hits the budget before `slack`), never below the current value, <= 99.
 */
export function generateAttributeCeilings(position, attrs, budget, rng) {
  requireRng(rng, "generateAttributeCeilings");
  const keys = getDisplayAttributeKeys(position);
  const weights = getOverallWeights(position);
  const overall = weightedOverall(attrs, keys, weights);
  const gap = Math.max(0, budget - overall);
  const raw = {};
  let norm = 0;
  for (const k of keys) {
    raw[k] = CEILING_CONFIG.shareMin + (CEILING_CONFIG.shareMax - CEILING_CONFIG.shareMin) * rng.random();
    norm += weights[k] * raw[k];
  }
  const ceilings = {};
  for (const k of keys) {
    const share = raw[k] / (norm || 1);
    const extra = CEILING_CONFIG.extraMax * rng.random();
    ceilings[k] = clamp(attrs[k] + gap * share * CEILING_CONFIG.slack + extra, attrs[k], ATTRIBUTE_MAX);
  }
  return ceilings;
}

/* ------------------------------------------------------------------ */
/* Initialisation                                                      */
/* ------------------------------------------------------------------ */

function budgetLift(age) {
  for (const row of BUDGET_LIFT_BY_AGE) if (age <= row.maxAge) return row.lift;
  return 0;
}

/** Make sure the primary role has a budget record. */
export function ensureAbilityBudgets(player) {
  const dev = player.development;
  if (!dev) return null;
  const pos = normalizePosition(player.position).position;
  dev.abilityBudgetsByPosition ||= {};
  const existing = dev.abilityBudgetsByPosition[pos];
  const base = calculateOverall(player.attributes, player.position).raw;
  const fallbackBudget = Number(dev.latentAbilityBudget ?? dev.latentBudget) || base;
  // Normalize legacy bare-number role budgets into records.
  if (existing == null || typeof existing === "number") {
    dev.abilityBudgetsByPosition[pos] = {
      budget: Number.isFinite(existing) ? existing : fallbackBudget,
      startOverallRaw: base,
      used: 0,
      primary: true,
    };
  } else if (!Number.isFinite(existing.budget)) {
    existing.budget = fallbackBudget;
    existing.startOverallRaw = existing.startOverallRaw ?? base;
    existing.used = existing.used ?? 0;
    existing.primary = true;
  }
  return dev.abilityBudgetsByPosition[pos];
}

/**
 * Initialise (or re-initialise) v2 development data for a player.
 * Sets development, state, health, versions and derives `rating` from attributes.
 * If the player has no valid attributes they are generated from `player.rating`.
 *
 * @param {object} player
 * @param {{rng:object, careerId?:string, budget?:number, traits?:object}} opts
 *        `budget` / `traits` override sampling (used by migration to stay deterministic).
 */
export function initializePlayerDevelopment(player, { rng, careerId = null, budget = null, traits = null } = {}) {
  requireRng(rng, "initializePlayerDevelopment");
  const pos = normalizePosition(player.position);
  const age = Number.isFinite(player.age) ? player.age : 16;

  let sampledBudget = Number.isFinite(budget) ? budget : sampleLatentBudget(rng);
  const sampledTraits = traits || sampleTraits(rng);

  if (!validateAttributes(player.attributes, player.position).ok) {
    const target = Number.isFinite(player.rating) && player.rating > 0 ? player.rating : 55;
    player.attributes = generateAttributesForTarget(player.position, target, Math.max(sampledBudget, target), rng);
  }
  const overall0 = calculateOverall(player.attributes, player.position).raw;
  const lifted = Math.min(BUDGET_HARD_MAX, overall0 + budgetLift(age));
  const budgetLifted = sampledBudget < lifted;
  if (budgetLifted) sampledBudget = Math.max(sampledBudget, lifted);
  sampledBudget = Math.min(BUDGET_HARD_MAX, Math.max(sampledBudget, overall0));

  const ceilings = generateAttributeCeilings(player.position, player.attributes, sampledBudget, rng);
  player.development = {
    modelVersion: DEVELOPMENT_MODEL_VERSION,
    careerId: careerId ?? player.development?.careerId ?? null,
    latentBudget: sampledBudget,
    // Compatibility aliases used by seasonSimulator / migration / older helpers
    latentAbilityBudget: sampledBudget,
    budgetLiftedToCurrent: budgetLifted,
    traits: sampledTraits,
    trainability: sampledTraits.trainability,
    professionalism: sampledTraits.professionalism,
    naturalFitness: sampledTraits.naturalFitness,
    resilience: sampledTraits.resilience,
    maturityOffsets: sampledTraits.maturityOffsets,
    declineProtection: sampledTraits.declineProtection,
    ceilings,
    attributeCeilings: ceilings,
    abilityBudgetsByPosition: {},
    appliedEventIds: player.development?.appliedEventIds || {},
    academyBudgetUsed: 0,
    academyGrowthApplied: 0,
    annualPositiveBudgetUsed: 0,
    seasonsDeveloped: 0,
    history: [],
    forecast: null,
    priorPerformanceEvidence: null,
    lastProcessedSeasonId: null,
  };
  player.state = createNeutralState();
  player.health = createEmptyHealth();
  player.playerModelVersion = PLAYER_MODEL_VERSION;
  player.developmentModelVersion = DEVELOPMENT_MODEL_VERSION;
  ensureAbilityBudgets(player);
  refreshAbilityCaches(player);
  return player;
}

/* ------------------------------------------------------------------ */
/* Curves                                                              */
/* ------------------------------------------------------------------ */

/** Opportunity multiplier in [floor, 1] from useful minutes vs the age target. */
export function computeOpportunity(age, usefulMinutes) {
  const row = OPPORTUNITY_MINUTE_TARGETS.find((r) => age <= r.maxAge) || OPPORTUNITY_MINUTE_TARGETS[OPPORTUNITY_MINUTE_TARGETS.length - 1];
  const floor = age <= OPPORTUNITY_CONFIG.youthMaxAge ? OPPORTUNITY_CONFIG.youthFloor : OPPORTUNITY_CONFIG.floor;
  const ratio = clamp((Number(usefulMinutes) || 0) / row.minutes, 0, 1);
  return {
    opportunity: floor + (1 - floor) * Math.pow(ratio, OPPORTUNITY_CONFIG.exponent),
    targetMinutes: row.minutes,
    minutesRatio: ratio,
  };
}

function maturityOffset(traits, family) {
  return traits?.maturityOffsets?.[family] ?? 0;
}

/** Learning rate (attribute points / yr at opportunity 1, trainability 1) for one attribute. */
function attributeLearningRate(key, age, traits) {
  const blend = ATTRIBUTE_FAMILIES[key] || { technical: 1 };
  let rate = 0;
  for (const [fam, share] of Object.entries(blend)) {
    const effAge = age - maturityOffset(traits, fam);
    const scale = FAMILY_PARAMS[fam]?.learningScale ?? 1;
    rate += share * scale * interpolateKnots(LEARNING_CURVE_KNOTS, effAge, fam);
  }
  return rate;
}

/** Ageing loss (attribute points / yr) for one attribute, before protection. */
function attributeLossRate(key, age) {
  const blend = ATTRIBUTE_FAMILIES[key] || { technical: 1 };
  let loss = 0;
  for (const [fam, share] of Object.entries(blend)) {
    const p = FAMILY_PARAMS[fam] || { lossScale: 1, lossAgeShift: 0 };
    loss += share * p.lossScale * interpolateKnots(AGEING_LOSS_KNOTS, age + p.lossAgeShift, fam);
  }
  return loss;
}

/** Compatibility exports used by older calibration / tests. */
export function familyLearningRate(effectiveAge, family) {
  return interpolateKnots(LEARNING_CURVE_KNOTS, effectiveAge, family);
}

export function familyAgeingLoss(effectiveAge, family) {
  return interpolateKnots(AGEING_LOSS_KNOTS, effectiveAge, family);
}

/** Expected role-weighted learning rate in overall points / yr (opportunity 1, trainability 1). Used by forecasting. */
export function expectedLearningRate(position, age, traits) {
  const weights = getOverallWeights(position);
  return Object.entries(weights).reduce((s, [k, w]) => s + w * attributeLearningRate(k, age, traits), 0);
}

/** Expected role-weighted ageing loss in overall points / yr, before protection. */
export function expectedAgeingLoss(position, age) {
  const weights = getOverallWeights(position);
  return Object.entries(weights).reduce((s, [k, w]) => s + w * attributeLossRate(k, age), 0);
}

function breakthroughProbability(age) {
  for (const band of BREAKTHROUGH.probabilityByAgeBand) if (age <= band.maxAge) return band.probability;
  return 0;
}

/* ------------------------------------------------------------------ */
/* Annual development                                                  */
/* ------------------------------------------------------------------ */

function weightedDelta(weights, perAttr) {
  let s = 0;
  for (const [k, v] of Object.entries(perAttr)) s += (weights[k] || 0) * v;
  return s;
}

/**
 * Develop a player over one season (or `elapsedYears`).
 *
 * @param {object} player
 * @param {object} context
 * @param {object}  context.rng                       required
 * @param {number} [context.elapsedYears=1]
 * @param {number} [context.usefulMinutes]            minutes in meaningful matches
 * @param {number} [context.healthyTrainingFraction=1] share of the period spent healthy and training [0, 1]
 * @param {number} [context.reliableSignal=0]         reliability of the performance signal [0, 1]
 * @param {number} [context.P_long=0]                 long-run performance observation [-1, 1]
 * @param {number} [context.environmentMultiplier=1]  coaching/facilities, clamped [0.5, 1.5]
 * @param {string|number} [context.seasonId]          makes the call idempotent per season
 * @param {number} [context.alreadyAppliedLearningGain=0] overall points of learning already applied this period (e.g. academy growth)
 * @returns {object} component ledger (overall points) with explanations; `{skipped:true}` if already applied
 */
export function developSeason(player, context = {}) {
  const rng = requireRng(context.rng, "developSeason");
  const caps = DEVELOPMENT_CAPS;
  if (!player.development || !player.state || !player.health) {
    initializePlayerDevelopment(player, { rng: rng.fork("init"), careerId: context.careerId });
  }
  const dev = player.development;
  const seasonKey = context.seasonId !== undefined && context.seasonId !== null ? `season:${context.seasonId}` : null;
  if (seasonKey && hasEventApplied(player, seasonKey)) {
    return { skipped: true, reason: "season-already-applied", seasonId: context.seasonId };
  }
  const years = clamp(Number.isFinite(context.elapsedYears) ? context.elapsedYears : 1, 0, caps.maxElapsedYears);
  if (years <= 0) return { skipped: true, reason: "no-elapsed-time", seasonId: context.seasonId };

  const { position: pos } = normalizePosition(player.position);
  const keys = getDisplayAttributeKeys(player.position);
  const weights = getOverallWeights(player.position);
  const traits = dev.traits || {
    trainability: dev.trainability ?? 1,
    professionalism: dev.professionalism ?? 0.5,
    naturalFitness: dev.naturalFitness ?? 0.5,
    resilience: dev.resilience ?? 0.5,
    maturityOffsets: dev.maturityOffsets || {},
    declineProtection: dev.declineProtection ?? 0,
  };
  const age = Number.isFinite(player.age) ? player.age : 24;
  const budgetRecord = ensureAbilityBudgets(player);
  const budget = budgetRecord.budget ?? dev.latentAbilityBudget ?? dev.latentBudget;
  const ceilings = dev.ceilings || dev.attributeCeilings || {};
  // Keep alias fields in sync for consumers/UI.
  dev.latentAbilityBudget = budget;
  dev.latentBudget = budget;
  if (!dev.attributeCeilings) dev.attributeCeilings = ceilings;
  if (!dev.ceilings) dev.ceilings = ceilings;

  const attrs = player.attributes;
  const before = { ...attrs };
  const overallBefore = calculateOverall(attrs, player.position).raw;

  const opp = computeOpportunity(age, context.usefulMinutes ?? 0.5 * OPPORTUNITY_MINUTE_TARGETS.find((r) => age <= r.maxAge).minutes);
  const healthy = clamp(context.healthyTrainingFraction ?? 1, 0, 1);
  const reliable = clamp(context.reliableSignal ?? 0, 0, 1);
  const pLong = clamp(context.P_long ?? 0, -1, 1);
  const env = clamp(context.environmentMultiplier ?? 1, caps.environmentRange.min, caps.environmentRange.max);
  const alreadyApplied = Math.max(0, Number(context.alreadyAppliedLearningGain) || 0);

  /* ---- breakthrough (always draws once to keep rng consumption stable) ---- */
  const btRoll = rng.random();
  const headroomToBudget = budget - overallBefore;
  const btEligibility = {
    age: age <= BREAKTHROUGH.probabilityByAgeBand[BREAKTHROUGH.probabilityByAgeBand.length - 1].maxAge,
    minutes: opp.minutesRatio >= BREAKTHROUGH.minMinutesFraction,
    healthy: healthy >= BREAKTHROUGH.minHealthyTrainingFraction,
    signal: reliable >= BREAKTHROUGH.minReliableSignal,
    performance: pLong >= BREAKTHROUGH.minPLong,
    headroom: headroomToBudget >= BREAKTHROUGH.minBudgetHeadroom,
    trainability: traits.trainability >= BREAKTHROUGH.minTrainability,
  };
  const btEligible = BREAKTHROUGH.enabled && Object.values(btEligibility).every(Boolean);
  const btProbability = btEligible ? breakthroughProbability(age) : 0;
  const breakthrough = btEligible && btRoll < btProbability;

  /* ---- per-attribute random draws (fixed order) ---- */
  const noise = {};
  for (const k of keys) {
    noise[k] = clamp(1 + caps.learningNoiseSd * sampleGaussian(rng), caps.learningNoiseMin, caps.learningNoiseMax);
  }
  const shock = {};
  for (const k of keys) {
    shock[k] = clamp(caps.shockSd * Math.sqrt(years) * sampleGaussian(rng), -caps.shockMaxAbs, caps.shockMaxAbs);
  }

  /* ---- negative components ---- */
  const ageing = {};
  const regression = {};
  const deconditioning = {};
  const negativeShock = {};
  const useItKeepIt = 1 - caps.useItKeepItMax * opp.minutesRatio;
  const protection = 1 - clamp(traits.declineProtection ?? 0, 0, TRAIT_RANGES.declineProtectionMax);
  const decond = caps.deconditioning;
  const decondDeficit = clamp((decond.healthyFloor - healthy) / decond.healthyFloor, 0, 1);

  for (const k of keys) {
    ageing[k] = attributeLossRate(k, age) * years * protection * useItKeepIt;

    const expectedShape = overallBefore + ATTRIBUTE_SHAPE.shapeScale * (weights[k] - 1 / keys.length);
    const excess = before[k] - expectedShape - caps.regression.tolerance;
    let reg = excess > 0 ? caps.regression.ratePerYear * excess * years : 0;
    if (ceilings?.[k] !== undefined && before[k] > ceilings[k]) reg += caps.regression.overCeilingRate * (before[k] - ceilings[k]);
    regression[k] = reg;

    const physicalShare = ATTRIBUTE_FAMILIES[k].physical || 0;
    deconditioning[k] = decondDeficit > 0 ? decond.maxPerYear * decondDeficit * physicalShare * years : 0;

    negativeShock[k] = shock[k] < 0 ? -shock[k] : 0;
  }

  const appliedNegative = { ageing: {}, regression: {}, deconditioning: {}, shock: {} };
  const applyLoss = (bucket, k, amount) => {
    if (amount <= 0) return 0;
    const cur = attrs[k];
    const next = Math.max(ATTRIBUTE_MIN, cur - amount);
    attrs[k] = next;
    appliedNegative[bucket][k] = cur - next;
    return cur - next;
  };
  for (const k of keys) {
    applyLoss("ageing", k, ageing[k]);
    applyLoss("regression", k, regression[k]);
    const lostDecond = applyLoss("deconditioning", k, deconditioning[k]);
    if (lostDecond > 0) {
      // Out-of-training loss is recoverable once healthy training resumes.
      player.health.recoverableDamage[k] = (player.health.recoverableDamage[k] || 0) + lostDecond;
    }
    applyLoss("shock", k, negativeShock[k]);
  }

  /* ---- restoration of tracked recoverable damage ---- */
  let restoration = { restored: 0, perAttribute: {} };
  if (healthy >= caps.restoration.minHealthyFraction) {
    const pool = Object.values(player.health.recoverableDamage).reduce((s, v) => s + v, 0);
    const amount = pool * clamp(caps.restoration.fractionPerYear * years * healthy, 0, 1);
    if (amount > 0) restoration = applyRecoverableRestoration(player, amount);
  }

  /* ---- positives: learning + positive shocks ---- */
  // Overall after negatives and restoration; budget room is measured from here.
  const overallAfterNegatives = weightedOverall(attrs, keys, weights);
  const budgetFactor = clamp((budget - overallAfterNegatives) / caps.budgetTaperPoints, 0, 1);
  const perfMult = 1 + caps.performanceLearningWeight * pLong * reliable;
  const profMult = 0.9 + 0.2 * traits.professionalism;
  const btMult = breakthrough ? BREAKTHROUGH.learningMultiplier : 1;

  const learning = {};
  const shockUpMap = {};
  const positive = {};
  for (const k of keys) {
    const headroom = ceilings?.[k] !== undefined ? Math.max(0, ceilings[k] - attrs[k]) : ATTRIBUTE_MAX - attrs[k];
    const headroomFactor = clamp(headroom / caps.headroomTaperPoints, 0, 1);
    learning[k] =
      attributeLearningRate(k, age, traits) *
      years *
      traits.trainability *
      env *
      opp.opportunity *
      perfMult *
      profMult *
      btMult *
      headroomFactor *
      budgetFactor *
      noise[k];
    const shockUp = shock[k] > 0 ? shock[k] : 0;
    shockUpMap[k] = shockUp;
    const wanted = learning[k] + shockUp;
    positive[k] = Math.min(wanted, Math.max(0, (ceilings?.[k] ?? ATTRIBUTE_MAX) - attrs[k]), ATTRIBUTE_MAX - attrs[k]);
  }

  const rawGain = weightedDelta(weights, positive);
  const annualCap = (breakthrough ? caps.annualLearningCapBreakthrough : caps.annualLearningCap) * years;
  const capRoom = Math.max(0, annualCap - alreadyApplied);
  const budgetRoom = Math.max(0, budget - overallAfterNegatives);
  let scale = 1;
  let limitedBy = "none";
  if (rawGain > 1e-12) {
    if (capRoom < rawGain && capRoom <= budgetRoom) {
      scale = capRoom / rawGain;
      limitedBy = "annual-cap";
    } else if (budgetRoom < rawGain) {
      scale = budgetRoom / rawGain;
      limitedBy = "budget";
    }
  }
  const appliedLearning = {};
  const appliedShockUp = {};
  for (const k of keys) {
    const inc = positive[k] * scale;
    attrs[k] = clamp(attrs[k] + inc, ATTRIBUTE_MIN, ATTRIBUTE_MAX);
    // Split the applied gain between learning and positive shock pro rata to what was wanted.
    const wanted = learning[k] + shockUpMap[k];
    const learnShare = wanted > 0 ? learning[k] / wanted : 0;
    appliedLearning[k] = inc * learnShare;
    appliedShockUp[k] = inc - appliedLearning[k];
  }

  /* ---- finish ---- */
  refreshAbilityCaches(player);
  const overallAfter = calculateOverall(attrs, player.position).raw;
  budgetRecord.used = Math.max(0, overallAfter - budgetRecord.startOverallRaw);
  dev.seasonsDeveloped = (dev.seasonsDeveloped || 0) + 1;
  dev.history.push({
    seasonId: context.seasonId ?? null,
    age,
    overallBefore,
    overallAfter,
    breakthrough,
  });
  if (dev.history.length > caps.historyLength) dev.history.splice(0, dev.history.length - caps.historyLength);
  if (seasonKey) markEventApplied(player, seasonKey);

  const sumApplied = (m) => weightedDelta(weights, m);
  const components = {
    learning: sumApplied(appliedLearning),
    ageing: -sumApplied(appliedNegative.ageing),
    regression: -sumApplied(appliedNegative.regression),
    deconditioning: -sumApplied(appliedNegative.deconditioning),
    shock: sumApplied(appliedShockUp) - sumApplied(appliedNegative.shock),
    restoration: weightedDelta(weights, restoration.perAttribute),
  };
  const explanations = [];
  explanations.push(
    `Opportunity ${opp.opportunity.toFixed(2)} (${Math.round(context.usefulMinutes ?? 0)} / ${opp.targetMinutes} min at age ${age}).`,
  );
  if (components.ageing < -0.005) explanations.push(`Ageing cost ${components.ageing.toFixed(2)} overall.`);
  if (components.deconditioning < -0.005) {
    explanations.push(`Too little healthy training (${Math.round(healthy * 100)}%): ${components.deconditioning.toFixed(2)} overall, recoverable.`);
  }
  if (components.restoration > 0.005) explanations.push(`Restored ${components.restoration.toFixed(2)} overall of recoverable loss.`);
  if (breakthrough) explanations.push("Breakthrough season: learning boosted and annual cap raised.");
  if (limitedBy === "annual-cap") explanations.push(`Learning capped at ${annualCap.toFixed(1)} overall per period.`);
  if (limitedBy === "budget") explanations.push("Growth limited by latent ability budget.");

  return {
    skipped: false,
    seasonId: context.seasonId ?? null,
    position: pos,
    age,
    elapsedYears: years,
    overallBefore,
    overallAfter,
    overallDelta: overallAfter - overallBefore,
    components,
    perAttribute: {
      before,
      after: { ...attrs },
      learning: appliedLearning,
      shockUp: appliedShockUp,
      shockDown: appliedNegative.shock,
      ageing: appliedNegative.ageing,
      regression: appliedNegative.regression,
      deconditioning: appliedNegative.deconditioning,
      restoration: restoration.perAttribute,
    },
    opportunity: opp,
    breakthrough: { occurred: breakthrough, eligible: btEligible, probability: btProbability, eligibility: btEligibility },
    caps: { annualCap, capRoom, budgetRoom, scale, limitedBy, rawGain },
    explanations,
  };
}

/* ------------------------------------------------------------------ */
/* Academy growth                                                      */
/* ------------------------------------------------------------------ */

/** Water-filling allocation: distribute `targetGain` (overall points) by shares, respecting per-attribute headroom. */
function allocateOverallGain(keys, weights, shares, headroom, targetGain) {
  const inc = Object.fromEntries(keys.map((k) => [k, 0]));
  let remaining = targetGain;
  let active = keys.filter((k) => headroom[k] > 1e-9 && shares[k] > 0 && weights[k] > 0);
  for (let iter = 0; iter < 10 && remaining > 1e-9 && active.length; iter++) {
    const denom = active.reduce((s, k) => s + weights[k] * shares[k], 0);
    if (denom <= 0) break;
    const scale = remaining / denom;
    for (const k of active) {
      const room = headroom[k] - inc[k];
      const add = Math.min(scale * shares[k], room);
      inc[k] += add;
      remaining -= weights[k] * add;
    }
    active = active.filter((k) => headroom[k] - inc[k] > 1e-9);
  }
  return inc;
}

/**
 * Academy / training-camp growth: mutates *attributes* (never `rating` directly)
 * and charges the academy budget.
 *
 * @param {object} player
 * @param {number} requestedDelta  desired change in base overall points (negative = small decline)
 * @param {{rng?:object, focusBias?:Object<string,number>, elapsedYearsShare?:number, alreadyAppliedLearningGain?:number}} [opts]
 *        focusBias: attribute -> extra emphasis (e.g. 0.5 = +50% share); elapsedYearsShare scales the annual cap.
 * @returns {{requested:number, realized:number, limitedBy:string, perAttribute:object}}  realized = base overall change
 */
export function applyAcademyGrowth(player, requestedDelta, { rng = null, focusBias = {}, elapsedYearsShare = 1, alreadyAppliedLearningGain = 0 } = {}) {
  if (!player.development) throw new Error("applyAcademyGrowth requires an initialised player (see initializePlayerDevelopment)");
  const keys = getDisplayAttributeKeys(player.position);
  const weights = getOverallWeights(player.position);
  const attrs = player.attributes;
  const before = calculateOverall(attrs, player.position).raw;
  const requested = Number(requestedDelta) || 0;
  const perAttribute = {};

  if (requested < 0) {
    const sumSq = keys.reduce((s, k) => s + weights[k] * weights[k], 0) || 1;
    for (const k of keys) {
      const next = clamp(attrs[k] + (requested * weights[k]) / sumSq, ATTRIBUTE_MIN, ATTRIBUTE_MAX);
      perAttribute[k] = next - attrs[k];
      attrs[k] = next;
    }
    refreshAbilityCaches(player);
    const realized = calculateOverall(attrs, player.position).raw - before;
    return { requested, realized, limitedBy: "none", perAttribute };
  }

  const budgetRecord = ensureAbilityBudgets(player);
  const budgetRoom = Math.max(0, budgetRecord.budget - before);
  const capRoom = Math.max(0, DEVELOPMENT_CAPS.annualLearningCap * clamp(elapsedYearsShare, 0, DEVELOPMENT_CAPS.maxElapsedYears) - Math.max(0, alreadyAppliedLearningGain));
  const target = Math.min(requested, budgetRoom, capRoom);
  const limitedBy = target >= requested - 1e-12 ? "none" : budgetRoom <= capRoom ? "budget" : "annual-cap";

  const ceilings = player.development.ceilings || {};
  const shares = {};
  const headroom = {};
  for (const k of keys) {
    const bias = Math.max(0, 1 + (Number(focusBias[k]) || 0));
    const jitter = rng ? 0.75 + 0.5 * rng.random() : 1;
    shares[k] = weights[k] * bias * jitter;
    headroom[k] = Math.max(0, Math.min(ceilings[k] ?? ATTRIBUTE_MAX, ATTRIBUTE_MAX) - attrs[k]);
  }
  const inc = allocateOverallGain(keys, weights, shares, headroom, target);
  for (const k of keys) {
    attrs[k] = clamp(attrs[k] + inc[k], ATTRIBUTE_MIN, ATTRIBUTE_MAX);
    perAttribute[k] = inc[k];
  }
  refreshAbilityCaches(player);
  const realized = calculateOverall(attrs, player.position).raw - before;
  player.development.academyBudgetUsed = (player.development.academyBudgetUsed || 0) + realized;
  budgetRecord.used = Math.max(0, calculateOverall(attrs, player.position).raw - budgetRecord.startOverallRaw);
  return { requested, realized, limitedBy, perAttribute };
}
