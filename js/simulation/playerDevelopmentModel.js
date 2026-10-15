/**
 * Core annual player development (player-development-v3).
 *
 * Performance-driven growth without individual career ceilings. Shared rating
 * scale max remains 99. See THIRD_PARTY_NOTICES.md for Open Football lineage.
 *
 * Principles
 *  - Attributes are the truth; `rating` is a cache refreshed after every change.
 *  - No latent budget or per-attribute ceiling constrains active growth.
 *  - Confidence (reliability) is separate from signed performance (P_long).
 *  - Annual order: negatives → restoration → learning + recognition, scaled to
 *    one shared annual learning allowance.
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
  POSITION_MATURATION,
  POSITION_ROLE_GROUP,
  RECOGNITION_CONFIG,
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

/**
 * @deprecated v3 — latent budgets are inert. Kept for migration/archive callers.
 * Always returns the shared rating-scale maximum so legacy generators do not
 * invent a low individual ceiling.
 */
export function sampleLatentBudget(rng) {
  requireRng(rng, "sampleLatentBudget");
  // Consume two draws for RNG-stream stability with v2 callers, then ignore the band.
  void rng.random();
  void rng.random();
  return BUDGET_HARD_MAX;
}

/** Soft ability difficulty in (floor, 1]: harder near 99, never a hard wall. */
export function abilityDifficultyFactor(overallRaw) {
  const cfg = DEVELOPMENT_CAPS.abilityDifficulty;
  const o = Number(overallRaw) || 0;
  if (o <= cfg.softStart) return 1;
  if (o >= cfg.softEnd) return cfg.floorAtSoftEnd;
  const t = (o - cfg.softStart) / (cfg.softEnd - cfg.softStart);
  return clamp(1 - t * (1 - cfg.floorAtSoftEnd), cfg.floorAtSoftEnd, 1);
}

export function roleMaturation(position) {
  const { position: pos } = normalizePosition(position);
  const group = POSITION_ROLE_GROUP[pos] || "default";
  return POSITION_MATURATION[group] || POSITION_MATURATION.default;
}

/**
 * Bounded recognition/trophy contribution in overall points.
 * Nominations replaced by wins for the same awardId; multi-award decay applies.
 */
export function computeRecognitionContribution(recognition = {}) {
  const cfg = RECOGNITION_CONFIG;
  if (recognition.contribution != null && Number.isFinite(recognition.contribution)) {
    return clamp(recognition.contribution, 0, cfg.maxContribution);
  }
  const awards = recognition.awards || [];
  const byId = new Map();
  for (const a of awards) {
    if (!a?.awardId) continue;
    const prev = byId.get(a.awardId);
    const rank =
      a.status === "won" ? 3 : a.status === "selected" ? 2 : a.status === "nominated" ? 1 : 0;
    if (!prev || rank > prev.rank) byId.set(a.awardId, { ...a, rank });
  }
  const ordered = [...byId.values()].sort((a, b) => b.rank - a.rank);
  let awardSum = 0;
  let decay = 1;
  for (const a of ordered) {
    const base =
      a.status === "won" ? cfg.win : a.status === "selected" ? cfg.selection : a.status === "nominated" ? cfg.nomination : 0;
    awardSum += base * decay;
    decay *= cfg.multiAwardDecay;
  }
  let trophySum = 0;
  for (const t of recognition.trophies || []) {
    const kind = t.kind || "league";
    const weight = clamp(t.participationWeight ?? 0.5, 0, 1);
    trophySum += (cfg.trophyParticipation[kind] ?? 0.2) * weight;
  }
  return clamp(awardSum + trophySum, 0, cfg.maxContribution);
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
 * `budget` is accepted for API compatibility but never acts as a career ceiling;
 * generation is only limited by the shared rating-scale max.
 */
function generateAttributesForTarget(position, target, budget, rng) {
  requireRng(rng, "attribute generation");
  const keys = getDisplayAttributeKeys(position);
  const weights = getOverallWeights(position);
  const n = keys.length;
  const scaleMax = ATTRIBUTE_MAX;
  const goal = clamp(Math.min(target, scaleMax), ATTRIBUTE_MIN + 1, ATTRIBUTE_MAX - 1);
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
  void budget;
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
 * @param {number} budget  unused career ceiling (API compat); generation uses scale max
 * @param {object} rng
 * @returns {object} attributes (floats in [1, 99])
 */
export function generateStartingAttributes(position, targetBand, budget, rng) {
  requireRng(rng, "generateStartingAttributes");
  return generateAttributesForTarget(position, resolveTarget(targetBand, rng), budget ?? ATTRIBUTE_MAX, rng);
}

/** Goalkeeper attributes (Reflexes, Handling, Positioning, Diving, Kicking, Physicality). */
export function generateGkAttributes(targetBand, budget, rng) {
  requireRng(rng, "generateGkAttributes");
  return generateAttributesForTarget("GK", resolveTarget(targetBand, rng), budget ?? ATTRIBUTE_MAX, rng);
}

/**
 * @deprecated v3 — returns inert scale-max ceilings for migration archives only.
 * Active development ignores these values.
 */
export function generateAttributeCeilings(position, attrs, budget, rng) {
  requireRng(rng, "generateAttributeCeilings");
  const keys = getDisplayAttributeKeys(position);
  // Consume RNG draws for stream stability with v2 saves.
  for (const k of keys) {
    void (CEILING_CONFIG.shareMin + (CEILING_CONFIG.shareMax - CEILING_CONFIG.shareMin) * rng.random());
    void (CEILING_CONFIG.extraMax * rng.random());
  }
  void budget;
  const ceilings = {};
  for (const k of keys) ceilings[k] = ATTRIBUTE_MAX;
  return ceilings;
}

/* ------------------------------------------------------------------ */
/* Initialisation                                                      */
/* ------------------------------------------------------------------ */

/**
 * Compatibility stub: role budget records are inert in v3 (budget always scale max).
 * Preserves structure so older snapshots/tests keep working.
 */
export function ensureAbilityBudgets(player) {
  const dev = player.development;
  if (!dev) return null;
  const pos = normalizePosition(player.position).position;
  dev.abilityBudgetsByPosition ||= {};
  const existing = dev.abilityBudgetsByPosition[pos];
  const base = calculateOverall(player.attributes, player.position).raw;
  if (existing == null || typeof existing === "number") {
    dev.abilityBudgetsByPosition[pos] = {
      budget: BUDGET_HARD_MAX,
      startOverallRaw: base,
      used: Math.max(0, base - (typeof existing === "object" ? existing.startOverallRaw ?? base : base)),
      primary: true,
      inert: true,
    };
  } else {
    existing.budget = BUDGET_HARD_MAX;
    existing.startOverallRaw = existing.startOverallRaw ?? base;
    existing.used = existing.used ?? 0;
    existing.primary = true;
    existing.inert = true;
  }
  return dev.abilityBudgetsByPosition[pos];
}

/**
 * Initialise (or re-initialise) v3 development data for a player.
 * Sets development, state, health, versions and derives `rating` from attributes.
 * Latent budgets / attribute ceilings are archived as inert compatibility fields.
 *
 * @param {object} player
 * @param {{rng:object, careerId?:string, budget?:number, traits?:object}} opts
 *        `budget` is archived only; `traits` override sampling (migration).
 */
export function initializePlayerDevelopment(player, { rng, careerId = null, budget = null, traits = null } = {}) {
  requireRng(rng, "initializePlayerDevelopment");
  const age = Number.isFinite(player.age) ? player.age : 16;
  void age;

  // Consume legacy budget sampling draws for stream stability, then discard.
  const archivedBudget = Number.isFinite(budget) ? budget : sampleLatentBudget(rng);
  const sampledTraits = traits || sampleTraits(rng);

  if (!validateAttributes(player.attributes, player.position).ok) {
    const target = Number.isFinite(player.rating) && player.rating > 0 ? player.rating : 55;
    player.attributes = generateAttributesForTarget(player.position, target, ATTRIBUTE_MAX, rng);
  }
  const overall0 = calculateOverall(player.attributes, player.position).raw;
  const inertCeilings = generateAttributeCeilings(player.position, player.attributes, BUDGET_HARD_MAX, rng);

  const prior = player.development || {};
  player.development = {
    modelVersion: DEVELOPMENT_MODEL_VERSION,
    careerId: careerId ?? prior.careerId ?? null,
    // Inert aliases — active growth ignores these.
    latentBudget: BUDGET_HARD_MAX,
    latentAbilityBudget: BUDGET_HARD_MAX,
    budgetLiftedToCurrent: false,
    ceilingsActive: false,
    legacyArchive: {
      ...(prior.legacyArchive || {}),
      latentAbilityBudget: archivedBudget,
      attributeCeilings: prior.ceilings || prior.attributeCeilings || null,
      archivedAtModel: DEVELOPMENT_MODEL_VERSION,
    },
    traits: sampledTraits,
    trainability: sampledTraits.trainability,
    professionalism: sampledTraits.professionalism,
    naturalFitness: sampledTraits.naturalFitness,
    resilience: sampledTraits.resilience,
    maturityOffsets: sampledTraits.maturityOffsets,
    declineProtection: sampledTraits.declineProtection,
    ceilings: inertCeilings,
    attributeCeilings: inertCeilings,
    abilityBudgetsByPosition: {},
    appliedEventIds: prior.appliedEventIds || {},
    academyBudgetUsed: prior.academyBudgetUsed || 0,
    academyGrowthApplied: prior.academyGrowthApplied || 0,
    annualLearningUsed: prior.annualLearningUsed || 0,
    annualPositiveBudgetUsed: 0,
    seasonsDeveloped: prior.seasonsDeveloped || 0,
    history: prior.history || [],
    forecast: null,
    priorPerformanceEvidence: prior.priorPerformanceEvidence || null,
    lastProcessedSeasonId: prior.lastProcessedSeasonId || null,
    periodLearningKey: prior.periodLearningKey || null,
  };
  player.state = player.state || createNeutralState();
  player.health = player.health || createEmptyHealth();
  player.playerModelVersion = PLAYER_MODEL_VERSION;
  player.developmentModelVersion = DEVELOPMENT_MODEL_VERSION;
  ensureAbilityBudgets(player);
  refreshAbilityCaches(player);
  void overall0;
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
function attributeLearningRate(key, age, traits, position = null) {
  const blend = ATTRIBUTE_FAMILIES[key] || { technical: 1 };
  const mat = position ? roleMaturation(position) : POSITION_MATURATION.default;
  let rate = 0;
  for (const [fam, share] of Object.entries(blend)) {
    const effAge = age - maturityOffset(traits, fam) + mat.learningAgeShift;
    const scale = FAMILY_PARAMS[fam]?.learningScale ?? 1;
    rate += share * scale * interpolateKnots(LEARNING_CURVE_KNOTS, effAge, fam);
  }
  return rate;
}

/** Ageing loss (attribute points / yr) for one attribute, before protection. */
function attributeLossRate(key, age, position = null) {
  const blend = ATTRIBUTE_FAMILIES[key] || { technical: 1 };
  const mat = position ? roleMaturation(position) : POSITION_MATURATION.default;
  let loss = 0;
  for (const [fam, share] of Object.entries(blend)) {
    const p = FAMILY_PARAMS[fam] || { lossScale: 1, lossAgeShift: 0 };
    const physicalExtra = fam === "physical" ? mat.physicalLossExtra : 0;
    loss +=
      share *
      (p.lossScale + physicalExtra) *
      interpolateKnots(AGEING_LOSS_KNOTS, age + p.lossAgeShift + mat.lossAgeShift, fam);
  }
  return Math.max(0, loss);
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
  return Object.entries(weights).reduce((s, [k, w]) => s + w * attributeLearningRate(k, age, traits, position), 0);
}

/** Expected role-weighted ageing loss in overall points / yr, before protection. */
export function expectedAgeingLoss(position, age) {
  const weights = getOverallWeights(position);
  return Object.entries(weights).reduce((s, [k, w]) => s + w * attributeLossRate(k, age, position), 0);
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
 * @param {number} [context.reliability]              confidence in [0,1] (preferred)
 * @param {number} [context.reliableSignal]           legacy; used only as |signal| fallback for confidence
 * @param {number} [context.P_long=0]                 long-run performance observation [-1, 1]
 * @param {number} [context.environmentMultiplier=1]  coaching/facilities/challenge proxy
 * @param {object} [context.recognition]              awards/trophies contribution input
 * @param {boolean}[context.forceBreakthrough]        test helper — evidence still required unless set
 * @param {string|number} [context.seasonId]          makes the call idempotent per season
 * @param {number} [context.alreadyAppliedLearningGain=0] overall points of learning already applied this period
 * @returns {object} component ledger (overall points) with explanations; `{skipped:true}` if already applied
 */
export function developSeason(player, context = {}) {
  const rng = requireRng(context.rng, "developSeason");
  const caps = DEVELOPMENT_CAPS;
  if (!player.development || !player.state || !player.health) {
    initializePlayerDevelopment(player, { rng: rng.fork("init"), careerId: context.careerId });
  }
  const dev = player.development;
  // Ensure v3 flags even if an older development blob is present.
  dev.ceilingsActive = false;
  dev.latentAbilityBudget = BUDGET_HARD_MAX;
  dev.latentBudget = BUDGET_HARD_MAX;

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

  const attrs = player.attributes;
  const before = { ...attrs };
  const overallBefore = calculateOverall(attrs, player.position).raw;

  const opp = computeOpportunity(
    age,
    context.usefulMinutes ?? 0.5 * OPPORTUNITY_MINUTE_TARGETS.find((r) => age <= r.maxAge).minutes,
  );
  const healthy = clamp(context.healthyTrainingFraction ?? 1, 0, 1);

  // Confidence vs signed performance — never clamp signed P into [0,1] as confidence.
  const pLong = clamp(Number.isFinite(context.P_long) ? context.P_long : 0, -1, 1);
  let reliability = context.reliability;
  if (!Number.isFinite(reliability)) {
    // Legacy callers sometimes passed reliableSignal = P * reliability (signed).
    // Treat absolute value as a lower-bound confidence estimate only when explicit reliability is absent.
    const legacy = context.reliableSignal;
    reliability = Number.isFinite(legacy) ? clamp(Math.abs(legacy), 0, 1) : 0;
  } else {
    reliability = clamp(reliability, 0, 1);
  }

  let env = clamp(context.environmentMultiplier ?? 1, caps.environmentRange.min, caps.environmentRange.max);
  // High-ability players need appropriate challenge; farming weak opposition softens env.
  if (overallBefore >= caps.abilityDifficulty.challengeSoftStart && env < 1) {
    const soft = clamp((overallBefore - caps.abilityDifficulty.challengeSoftStart) / 12, 0, 1);
    env = env * (1 - 0.35 * soft) + 0.65 * soft * Math.min(env, 0.85);
  }

  const alreadyApplied = Math.max(0, Number(context.alreadyAppliedLearningGain) || 0);
  const recognitionPoints = computeRecognitionContribution(context.recognition || {});

  /* ---- breakthrough (always draws once to keep rng consumption stable) ---- */
  const btRoll = rng.random();
  const recognitionBoost =
    recognitionPoints >= 0.7 ? BREAKTHROUGH.recognitionBonus : recognitionPoints >= 0.35 ? BREAKTHROUGH.recognitionBonus * 0.5 : 0;
  const btEligibility = {
    age: age <= BREAKTHROUGH.probabilityByAgeBand[BREAKTHROUGH.probabilityByAgeBand.length - 1].maxAge,
    minutes: opp.minutesRatio >= BREAKTHROUGH.minMinutesFraction,
    healthy: healthy >= BREAKTHROUGH.minHealthyTrainingFraction,
    reliability: reliability >= BREAKTHROUGH.minReliability,
    performance: pLong >= BREAKTHROUGH.minPLong,
    trainability: traits.trainability >= BREAKTHROUGH.minTrainability,
  };
  // Evidence-backed seasons must not be hard-blocked solely by a floor trainability trait.
  if (context.forceBreakthrough || (pLong >= 0.75 && reliability >= 0.75 && recognitionPoints >= 0.7)) {
    btEligibility.trainability = true;
  }
  const btEligible = BREAKTHROUGH.enabled && Object.values(btEligibility).every(Boolean);
  let btProbability = btEligible ? clamp(breakthroughProbability(age) + recognitionBoost, 0, 0.85) : 0;
  if (context.forceBreakthrough && btEligible) btProbability = 1;
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
    ageing[k] = attributeLossRate(k, age, player.position) * years * protection * useItKeepIt;

    const expectedShape = overallBefore + ATTRIBUTE_SHAPE.shapeScale * (weights[k] - 1 / keys.length);
    const excess = before[k] - expectedShape - caps.regression.tolerance;
    regression[k] = excess > 0 ? caps.regression.ratePerYear * excess * years : 0;

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

  /* ---- positives: learning + positive shocks + recognition ---- */
  const overallAfterNegatives = weightedOverall(attrs, keys, weights);
  const abilityDiff = abilityDifficultyFactor(overallAfterNegatives);
  const perfSignal = pLong * reliability;
  const perfMult = clamp(
    1 + caps.performanceLearningWeight * perfSignal,
    caps.performanceMultFloor,
    caps.performanceMultCeil,
  );
  // Healthy training still helps in a poor season, but must not prop growth up to
  // a "neutral" outcome — lean on performance more than a high training floor.
  const healthyLearn =
    perfSignal < 0 ? clamp(0.2 + 0.55 * healthy * (1 + perfSignal), 0.15, 0.75) : 0.4 + 0.6 * healthy;
  const profMult = 0.9 + 0.2 * traits.professionalism;
  const btMult = breakthrough ? BREAKTHROUGH.learningMultiplier : 1;

  const learning = {};
  const shockUpMap = {};
  const positive = {};
  for (const k of keys) {
    // Soft per-attribute approach to the shared scale max — floor keeps elite
    // progress possible; overall abilityDiff already slows high OVR careers.
    const attrRoom = ATTRIBUTE_MAX - attrs[k];
    const scaleHeadroom = attrRoom <= 0 ? 0 : clamp(0.35 + attrRoom / 20, 0.35, 1);
    learning[k] =
      attributeLearningRate(k, age, traits, player.position) *
      years *
      traits.trainability *
      env *
      opp.opportunity *
      perfMult *
      healthyLearn *
      profMult *
      btMult *
      abilityDiff *
      scaleHeadroom *
      noise[k];
    const shockUp = shock[k] > 0 ? shock[k] * abilityDiff : 0;
    shockUpMap[k] = shockUp;
    const wanted = learning[k] + shockUp;
    positive[k] = Math.min(wanted, Math.max(0, attrRoom));
  }

  // Distribute recognition as a small overall-weighted attribute bump (inside annual cap).
  const recognitionPerAttr = {};
  if (recognitionPoints > 0) {
    const sumW = keys.reduce((s, k) => s + weights[k], 0) || 1;
    for (const k of keys) {
      recognitionPerAttr[k] = (recognitionPoints * years * weights[k]) / sumW;
      positive[k] = Math.min(positive[k] + recognitionPerAttr[k], ATTRIBUTE_MAX - attrs[k]);
    }
  }

  const rawGain = weightedDelta(weights, positive);
  const annualCap = caps.annualLearningCap * years;
  const capRoom = Math.max(0, annualCap - alreadyApplied);
  let scale = 1;
  let limitedBy = "none";
  if (rawGain > 1e-12 && rawGain > capRoom) {
    scale = capRoom / rawGain;
    limitedBy = "annual-cap";
  }
  const appliedLearning = {};
  const appliedShockUp = {};
  const appliedRecognition = {};
  for (const k of keys) {
    const inc = positive[k] * scale;
    attrs[k] = clamp(attrs[k] + inc, ATTRIBUTE_MIN, ATTRIBUTE_MAX);
    const recWanted = recognitionPerAttr[k] || 0;
    const learnWanted = learning[k];
    const shockWanted = shockUpMap[k];
    const wanted = learnWanted + shockWanted + recWanted;
    if (wanted > 0) {
      appliedLearning[k] = inc * (learnWanted / wanted);
      appliedShockUp[k] = inc * (shockWanted / wanted);
      appliedRecognition[k] = inc * (recWanted / wanted);
    } else {
      appliedLearning[k] = 0;
      appliedShockUp[k] = 0;
      appliedRecognition[k] = 0;
    }
  }

  /* ---- poor-season drag: reliable bad performances can finish flat or down ---- */
  const appliedPoorDrag = {};
  const dragCfg = caps.poorSeasonDrag || {};
  const dragThreshold = Number.isFinite(dragCfg.signalThreshold) ? dragCfg.signalThreshold : -0.3;
  const dragMax = Math.max(0, Number(dragCfg.maxOverall) || 0);
  if (perfSignal < dragThreshold && dragMax > 0 && years > 0) {
    // t: 0 at threshold, 1 at signal = -1
    const t = clamp((-perfSignal + dragThreshold) / (-dragThreshold + 1), 0, 1);
    const dragOverall = dragMax * t * years;
    const sumW = keys.reduce((s, k) => s + weights[k], 0) || 1;
    for (const k of keys) {
      const amount = (dragOverall * weights[k]) / sumW;
      const cur = attrs[k];
      const next = Math.max(ATTRIBUTE_MIN, cur - amount);
      appliedPoorDrag[k] = cur - next;
      attrs[k] = next;
    }
  }

  /* ---- finish ---- */
  refreshAbilityCaches(player);
  const overallAfter = calculateOverall(attrs, player.position).raw;
  budgetRecord.used = Math.max(0, overallAfter - budgetRecord.startOverallRaw);
  const learningApplied = weightedDelta(weights, appliedLearning) + weightedDelta(weights, appliedRecognition);
  dev.annualLearningUsed = alreadyApplied + learningApplied;
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
    recognition: sumApplied(appliedRecognition),
    ageing: -sumApplied(appliedNegative.ageing),
    regression: -sumApplied(appliedNegative.regression),
    deconditioning: -sumApplied(appliedNegative.deconditioning),
    poorSeason: -sumApplied(appliedPoorDrag),
    shock: sumApplied(appliedShockUp) - sumApplied(appliedNegative.shock),
    restoration: weightedDelta(weights, restoration.perAttribute),
  };
  const breakdown = {
    performance: pLong,
    reliability,
    opportunity: opp.opportunity,
    environment: env,
    abilityDifficulty: abilityDiff,
    healthyTrainingFraction: healthy,
    recognitionPoints,
    age,
    position: pos,
    roleGroup: POSITION_ROLE_GROUP[pos] || "default",
    breakthrough: breakthrough,
    annualAllowanceUsed: learningApplied,
    annualAllowance: annualCap,
    rawOverallBefore: overallBefore,
    rawOverallAfter: overallAfter,
  };

  const explanations = [];
  if (pLong >= 0.45 && reliability >= 0.5) {
    explanations.push("Strong sustained performances accelerated development.");
  } else if (pLong <= -0.35 && reliability >= 0.45) {
    explanations.push(
      components.poorSeason < -0.05 || overallAfter - overallBefore <= 0.15
        ? "Poor performances stalled development this season."
        : "Poor performances limited what could be learned this season.",
    );
  } else if (opp.opportunity >= 0.75) {
    explanations.push("Regular minutes supported steady development.");
  } else {
    explanations.push(
      `Limited playing time (${Math.round(context.usefulMinutes ?? 0)} / ${opp.targetMinutes} min) slowed growth.`,
    );
  }
  if (recognitionPoints >= 0.35) explanations.push("Individual recognition and achievements added a development boost.");
  if (components.ageing < -0.05) explanations.push("Age-related physical changes offset some gains.");
  if (components.deconditioning < -0.05) {
    explanations.push(`Time lost to injury or missed training reduced development.`);
  }
  if (components.restoration > 0.05) explanations.push("Recovered form after earlier fitness setbacks.");
  if (breakthrough) explanations.push("Breakthrough season: exceptional evidence unlocked accelerated growth.");
  if (limitedBy === "annual-cap") explanations.push("Growth reached this year's development allowance.");
  if (overallBefore >= 90) explanations.push("At elite level, further gains require outstanding seasons.");

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
    breakdown,
    perAttribute: {
      before,
      after: { ...attrs },
      learning: appliedLearning,
      recognition: appliedRecognition,
      shockUp: appliedShockUp,
      shockDown: appliedNegative.shock,
      ageing: appliedNegative.ageing,
      regression: appliedNegative.regression,
      deconditioning: appliedNegative.deconditioning,
      restoration: restoration.perAttribute,
    },
    opportunity: opp,
    breakthrough: {
      occurred: breakthrough,
      eligible: btEligible,
      probability: btProbability,
      eligibility: btEligibility,
      reason: breakthrough
        ? "Evidence-backed breakthrough from performance, minutes, and recognition."
        : btEligible
          ? "Eligible but breakthrough roll missed."
          : "Not eligible for breakthrough.",
    },
    caps: {
      annualCap,
      capRoom,
      budgetRoom: Infinity,
      scale,
      limitedBy,
      rawGain,
      recognitionPoints,
    },
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
 * and charges the shared annual learning allowance.
 *
 * @param {object} player
 * @param {number} requestedDelta  desired change in base overall points (negative = small decline)
 * @param {{rng?:object, focusBias?:Object<string,number>, elapsedYearsShare?:number, alreadyAppliedLearningGain?:number}} [opts]
 * @returns {{requested:number, realized:number, limitedBy:string, perAttribute:object}}
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
  const abilityRoom = Math.max(0, ATTRIBUTE_MAX - before) * abilityDifficultyFactor(before);
  const capRoom = Math.max(
    0,
    DEVELOPMENT_CAPS.annualLearningCap * clamp(elapsedYearsShare, 0, DEVELOPMENT_CAPS.maxElapsedYears) -
      Math.max(0, alreadyAppliedLearningGain),
  );
  const target = Math.min(requested, abilityRoom, capRoom);
  const limitedBy = target >= requested - 1e-12 ? "none" : abilityRoom <= capRoom ? "ability-difficulty" : "annual-cap";

  const shares = {};
  const headroom = {};
  for (const k of keys) {
    const bias = Math.max(0, 1 + (Number(focusBias[k]) || 0));
    const jitter = rng ? 0.75 + 0.5 * rng.random() : 1;
    shares[k] = weights[k] * bias * jitter;
    headroom[k] = Math.max(0, ATTRIBUTE_MAX - attrs[k]);
  }
  const inc = allocateOverallGain(keys, weights, shares, headroom, target);
  for (const k of keys) {
    attrs[k] = clamp(attrs[k] + inc[k], ATTRIBUTE_MIN, ATTRIBUTE_MAX);
    perAttribute[k] = inc[k];
  }
  refreshAbilityCaches(player);
  const realized = calculateOverall(attrs, player.position).raw - before;
  player.development.academyBudgetUsed = (player.development.academyBudgetUsed || 0) + realized;
  player.development.academyGrowthApplied = (player.development.academyGrowthApplied || 0) + Math.max(0, realized);
  budgetRecord.used = Math.max(0, calculateOverall(attrs, player.position).raw - budgetRecord.startOverallRaw);
  return { requested, realized, limitedBy, perAttribute };
}
