/**
 * Potential forecasting (v3).
 *
 * Potential is a revisable estimate of likely future performance under stated
 * assumptions — never an enforced maximum. Trajectories use age/role learning,
 * ability difficulty near 99, and outlook uncertainty; there is no hidden
 * individual career ceiling.
 */
import { clamp } from "../utils/helpers.js";
import { createStreamRng, hashSeed } from "./rng.js";
import {
  DEVELOPMENT_CAPS,
  DEVELOPMENT_MODEL_VERSION,
  FORECAST_CONFIG,
  OPPORTUNITY_CONFIG,
  POTENTIAL_HARD_MAX,
  TRAIT_RANGES,
} from "../config/playerDevelopmentConfig.js";
import { calculateOverall, normalizePosition } from "./playerAbility.js";
import {
  abilityDifficultyFactor,
  expectedAgeingLoss,
  expectedLearningRate,
  sampleGaussian,
} from "./playerDevelopmentModel.js";

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = clamp(q, 0, 1) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function outlookSd(age) {
  const u = FORECAST_CONFIG.outlookUncertainty || FORECAST_CONFIG.budgetUncertainty;
  return clamp(u.base - u.perYear * (age - 16), u.min, u.base);
}

/**
 * Forecast the peak overall the player may reach under assumptions.
 */
export function forecastPotential(player, { sampleCount = FORECAST_CONFIG.defaultSampleCount, rng = null, assumptions = {}, careerId = null } = {}) {
  if (!player?.development) throw new Error("forecastPotential requires an initialised player (see initializePlayerDevelopment)");
  const dev = player.development;
  const a = { ...FORECAST_CONFIG.defaultAssumptions, ...assumptions };
  const age0 = Number.isFinite(player.age) ? player.age : 24;
  const base = calculateOverall(player.attributes, player.position).raw;
  const { position } = normalizePosition(player.position);
  const traits = dev.traits;

  const label = `potential-forecast:${age0}:${Math.round(base * 20)}`;
  const frng = rng ? rng.fork(label) : createStreamRng(careerId ?? dev.careerId ?? player.name ?? "career", label);

  const n = Math.max(8, Math.floor(sampleCount));
  const sd = outlookSd(age0);
  const profMult = 0.9 + 0.2 * traits.professionalism;
  const opp = clamp(a.opportunity, 0, 1);
  const opportunityMult = OPPORTUNITY_CONFIG.floor + (1 - OPPORTUNITY_CONFIG.floor) * opp;
  const protection = 1 - clamp(traits.declineProtection ?? 0, 0, TRAIT_RANGES.declineProtectionMax);
  const healthMult = 0.55 + 0.45 * clamp(a.healthyTrainingFraction, 0, 1);
  const reliability = clamp(a.reliability ?? 0.7, 0, 1);
  const perfMult = clamp(
    1 + DEVELOPMENT_CAPS.performanceLearningWeight * clamp(a.pLong, -1, 1) * reliability,
    DEVELOPMENT_CAPS.performanceMultFloor,
    DEVELOPMENT_CAPS.performanceMultCeil,
  );

  const peaks = [];
  const peakAges = [];
  for (let i = 0; i < n; i++) {
    // Outlook optimism/pessimism — not a sampled career ceiling.
    const outlookBias = clamp(1 + (sd / 40) * sampleGaussian(frng), 0.75, 1.35);
    const trainability = clamp(
      traits.trainability * (1 + 0.08 * sampleGaussian(frng)),
      TRAIT_RANGES.trainability.min,
      TRAIT_RANGES.trainability.max,
    );
    let o = base;
    let peak = base;
    let peakAge = age0;
    for (let age = age0; age <= FORECAST_CONFIG.horizonAge; age++) {
      const noise = clamp(1 + FORECAST_CONFIG.trajectoryNoiseSd * sampleGaussian(frng), 0.25, 1.9);
      const difficulty = abilityDifficultyFactor(o);
      let learn =
        expectedLearningRate(position, age, traits) *
        trainability *
        a.environmentMultiplier *
        opportunityMult *
        profMult *
        perfMult *
        healthMult *
        difficulty *
        outlookBias *
        noise;
      learn = Math.min(learn, DEVELOPMENT_CAPS.annualLearningCap * 0.85);
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
  // Cache is a rounded upper outlook, never forced to 99.
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
    disclaimer: FORECAST_CONFIG.disclaimer,
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
 * store it (`player.development.forecast`, `player.potential`, `player.potentialForecast`).
 */
export function getOrUpdateForecast(player, opts = {}) {
  if (!player?.development) return null;
  const sig = forecastInputSignature(player, opts);
  const cached = player.development.forecast;
  if (cached && cached.inputSignature === sig) {
    player.potential = cached.potentialCache;
    player.potentialForecast = cached;
    return cached;
  }
  const careerId = opts.careerId ?? player.development.careerId ?? player.careerId ?? player.name;
  const forecast = forecastPotential(player, {
    ...opts,
    careerId,
    rng: opts.rng || createStreamRng(careerId, `forecast:${sig}`),
  });
  forecast.inputSignature = sig;
  player.development.forecast = forecast;
  player.potential = forecast.potentialCache;
  player.potentialForecast = forecast;
  return forecast;
}
