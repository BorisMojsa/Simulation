/**
 * Potential forecasting.
 *
 * Potential is an *estimate* (a cache), not a stored truth: lightweight Monte
 * Carlo trajectories of the player's base overall under neutral assumptions,
 * summarised as lower / median / upper peak. The hidden latent budget enters
 * only through scouting-style uncertainty that narrows with age.
 *
 *   potential cache = round(upper), bounded to [round(baseOverallRaw), 99]   (no "+1" floor)
 *
 * The forecast RNG is forked / derived separately and never consumes the
 * career RNG, so forecasting cannot change career outcomes.
 */
import { clamp } from "../utils/helpers.js";
import { createStreamRng, hashSeed } from "./rng.js";
import {
  BUDGET_HARD_MAX,
  DEVELOPMENT_CAPS,
  DEVELOPMENT_MODEL_VERSION,
  FORECAST_CONFIG,
  OPPORTUNITY_CONFIG,
  POTENTIAL_HARD_MAX,
  TRAIT_RANGES,
} from "../config/playerDevelopmentConfig.js?v=60";
import { calculateOverall, normalizePosition } from "./playerAbility.js?v=60";
import { expectedAgeingLoss, expectedLearningRate, sampleGaussian } from "./playerDevelopmentModel.js?v=60";

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = clamp(q, 0, 1) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function budgetSd(age) {
  const u = FORECAST_CONFIG.budgetUncertainty;
  return clamp(u.base - u.perYear * (age - 16), u.min, u.base);
}

/**
 * Forecast the peak overall the player can reach.
 * @param {object} player  initialised v2 player
 * @param {{sampleCount?:number, rng?:object, assumptions?:object, careerId?:string}} [opts]
 * @returns {{lower:number, median:number, upper:number, confidence:number, potentialCache:number,
 *   peakAgeMedian:number, sampleCount:number, assumptions:object, baseOverallRaw:number, modelVersion:string}}
 */
export function forecastPotential(player, { sampleCount = FORECAST_CONFIG.defaultSampleCount, rng = null, assumptions = {}, careerId = null } = {}) {
  if (!player?.development) throw new Error("forecastPotential requires an initialised player (see initializePlayerDevelopment)");
  const dev = player.development;
  const a = { ...FORECAST_CONFIG.defaultAssumptions, ...assumptions };
  const age0 = Number.isFinite(player.age) ? player.age : 24;
  const base = calculateOverall(player.attributes, player.position).raw;
  const { position } = normalizePosition(player.position);
  const traits = dev.traits;

  // Never consume career RNG: fork (non-advancing) or derive a dedicated stream.
  const label = `potential-forecast:${age0}:${Math.round(base * 20)}`;
  const frng = rng ? rng.fork(label) : createStreamRng(careerId ?? dev.careerId ?? player.name ?? "career", label);

  const n = Math.max(8, Math.floor(sampleCount));
  const sd = budgetSd(age0);
  const profMult = 0.9 + 0.2 * traits.professionalism;
  const opp = clamp(a.opportunity, 0, 1);
  const opportunityMult = OPPORTUNITY_CONFIG.floor + (1 - OPPORTUNITY_CONFIG.floor) * opp;
  const protection = 1 - clamp(traits.declineProtection ?? 0, 0, TRAIT_RANGES.declineProtectionMax);
  const healthMult = clamp(a.healthyTrainingFraction, 0, 1);
  const perfMult = 1 + DEVELOPMENT_CAPS.performanceLearningWeight * clamp(a.pLong, -1, 1) * 0.5;

  const peaks = [];
  const peakAges = [];
  for (let i = 0; i < n; i++) {
    const budget = clamp(dev.latentBudget + sd * sampleGaussian(frng), base, BUDGET_HARD_MAX);
    const trainability = clamp(traits.trainability * (1 + 0.08 * sampleGaussian(frng)), TRAIT_RANGES.trainability.min, TRAIT_RANGES.trainability.max);
    let o = base;
    let peak = base;
    let peakAge = age0;
    for (let age = age0; age <= FORECAST_CONFIG.horizonAge; age++) {
      const noise = clamp(1 + FORECAST_CONFIG.trajectoryNoiseSd * sampleGaussian(frng), 0.2, 2);
      const taper = clamp((budget - o) / DEVELOPMENT_CAPS.budgetTaperPoints, 0, 1);
      let learn =
        expectedLearningRate(position, age, traits) *
        trainability *
        a.environmentMultiplier *
        opportunityMult *
        profMult *
        perfMult *
        healthMult *
        taper *
        noise;
      learn = Math.min(learn, DEVELOPMENT_CAPS.annualLearningCap, Math.max(0, budget - o));
      const loss = expectedAgeingLoss(position, age) * protection * clamp(1 + 0.25 * sampleGaussian(frng), 0.4, 1.8);
      o = o + learn - loss + FORECAST_CONFIG.shockSd * sampleGaussian(frng) * 0.5;
      o = clamp(o, 1, POTENTIAL_HARD_MAX);
      if (o > peak) {
        peak = o;
        peakAge = age + 1;
      }
    }
    peaks.push(peak);
    peakAges.push(peakAge);
  }
  peaks.sort((x, y) => x - y);
  peakAges.sort((x, y) => x - y);
  const lower = quantile(peaks, FORECAST_CONFIG.lowerQuantile);
  const median = quantile(peaks, FORECAST_CONFIG.medianQuantile);
  const upper = quantile(peaks, FORECAST_CONFIG.upperQuantile);
  const spread = upper - lower;
  const confidence = clamp(1 - spread / FORECAST_CONFIG.confidenceSpread, 0.05, 0.99);
  const potentialCache = Math.min(POTENTIAL_HARD_MAX, Math.max(Math.round(upper), Math.round(base)));

  return {
    lower,
    median,
    upper,
    confidence,
    potentialCache,
    peakAgeMedian: quantile(peakAges, 0.5),
    sampleCount: n,
    assumptions: a,
    baseOverallRaw: base,
    modelVersion: DEVELOPMENT_MODEL_VERSION,
  };
}

/** Cache key for the inputs that influence a forecast. */
export function forecastInputSignature(player, { sampleCount = FORECAST_CONFIG.defaultSampleCount, assumptions = {} } = {}) {
  const dev = player.development;
  const t = dev?.traits || {};
  const base = calculateOverall(player.attributes, player.position).raw;
  const payload = [
    DEVELOPMENT_MODEL_VERSION,
    normalizePosition(player.position).position,
    player.age,
    Math.round(base * 20),
    Math.round((dev?.latentBudget ?? 0) * 2),
    Math.round((t.trainability ?? 1) * 20),
    Math.round((t.professionalism ?? 0.5) * 10),
    Math.round((t.declineProtection ?? 0) * 100),
    Object.values(t.maturityOffsets || {}).map((v) => Math.round(v * 4)),
    sampleCount,
    { ...FORECAST_CONFIG.defaultAssumptions, ...assumptions },
  ];
  return String(hashSeed(JSON.stringify(payload)));
}

/**
 * Return the cached forecast when inputs are unchanged, otherwise recompute and
 * store it (`player.development.forecast`, `player.potential`).
 * Uses a dedicated RNG stream keyed by the input signature, so identical inputs
 * always give identical forecasts and the career RNG is untouched.
 */
export function getOrUpdateForecast(player, { sampleCount = FORECAST_CONFIG.defaultSampleCount, assumptions = {}, rng = null, careerId = null, force = false } = {}) {
  const signature = forecastInputSignature(player, { sampleCount, assumptions });
  const cached = player.development?.forecast;
  if (!force && cached?.inputSignature === signature) {
    player.potential = cached.potentialCache;
    return cached;
  }
  const cid = careerId ?? player.development?.careerId ?? player.name ?? "career";
  // `rng` (if given) is only forked, never advanced; otherwise a stream keyed by the signature is used.
  const streamRng = rng ? rng.fork(`potential:${signature}`) : createStreamRng(cid, `potential:${signature}`);
  const forecast = { ...forecastPotential(player, { sampleCount, assumptions, rng: streamRng }), inputSignature: signature };
  player.development.forecast = forecast;
  player.potential = forecast.potentialCache;
  return forecast;
}
