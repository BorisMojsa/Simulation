/**
 * Potential forecasting (v3).
 *
 * Potential is a revisable estimate of likely future performance under stated
 * assumptions — never an enforced maximum. Trajectories use age/role learning,
 * ability difficulty near 99, and outlook uncertainty; there is no hidden
 * individual career ceiling.
 *
 * Item 7: season-end forecasts derive assumptions from a documented rolling
 * evidence summary (minutes, performance, health, environment) so outlook
 * tracks actual career context — including loans, bench time, and recovery.
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

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Collect recent season evidence rows from enriched development history, with a
 * fallback to persisted seasonEvidence for older saves that lack history fields.
 */
function collectEvidenceRows(player) {
  const rows = [];
  const history = Array.isArray(player?.development?.history) ? player.development.history : [];
  for (const h of history) {
    if (!h || typeof h !== "object") continue;
    const hasSignals =
      Number.isFinite(h.opportunity) ||
      Number.isFinite(h.pLong) ||
      Number.isFinite(h.reliability) ||
      Number.isFinite(h.environment) ||
      Number.isFinite(h.healthyTrainingFraction);
    if (!hasSignals) continue;
    rows.push({
      opportunity: finiteOr(h.opportunity, null),
      pLong: finiteOr(h.pLong, null),
      reliability: finiteOr(h.reliability, null),
      environmentMultiplier: finiteOr(h.environment, null),
      healthyTrainingFraction: finiteOr(h.healthyTrainingFraction, null),
      source: "history",
      seasonId: h.seasonId ?? null,
    });
  }
  if (rows.length) return rows;

  const seasons = Array.isArray(player?.seasons) ? player.seasons : [];
  for (const season of seasons) {
    const ev = season?.seasonEvidence || season?.developmentBreakdown;
    if (!ev || typeof ev !== "object") continue;
    const breakdown = season?.developmentBreakdown || {};
    const opportunity = finiteOr(breakdown.opportunity, finiteOr(ev.opportunity, null));
    const pLong = finiteOr(breakdown.performance, finiteOr(ev.seasonP, null));
    const reliability = finiteOr(breakdown.reliability, finiteOr(ev.reliability, null));
    const environmentMultiplier = finiteOr(
      breakdown.environment,
      finiteOr(ev.environmentProxy, null),
    );
    const healthyTrainingFraction = finiteOr(
      breakdown.healthyTrainingFraction,
      finiteOr(ev.healthyTrainingFraction, null),
    );
    if (
      ![opportunity, pLong, reliability, environmentMultiplier, healthyTrainingFraction].some(
        Number.isFinite,
      )
    ) {
      continue;
    }
    rows.push({
      opportunity,
      pLong,
      reliability,
      environmentMultiplier,
      healthyTrainingFraction,
      source: "seasonEvidence",
      seasonId: season.seasonId ?? season.seasonNumber ?? null,
    });
  }
  return rows;
}

/**
 * Build forecast assumptions from a rolling, exponentially weighted evidence
 * summary. Empty careers fall back to FORECAST_CONFIG.defaultAssumptions.
 *
 * @param {object} player
 * @param {{ latest?: object|null }} [opts] optional overlay for the just-finished season
 *   when history has not been written yet (caller-supplied evidence).
 */
export function buildRollingEvidenceAssumptions(player, opts = {}) {
  const cfg = FORECAST_CONFIG.rollingEvidence || {};
  const defaults = { ...FORECAST_CONFIG.defaultAssumptions };
  const window = Math.max(1, Math.floor(cfg.windowSeasons || 4));
  const halfLife = Math.max(0.25, Number(cfg.halfLifeSeasons) || 1.25);
  const minWeight = clamp(cfg.minWeight ?? 0.05, 0.01, 0.5);

  const rows = collectEvidenceRows(player).slice(-window);
  if (opts.latest && typeof opts.latest === "object") {
    rows.push({
      opportunity: finiteOr(opts.latest.opportunity, null),
      pLong: finiteOr(opts.latest.pLong ?? opts.latest.P_long, null),
      reliability: finiteOr(opts.latest.reliability, null),
      environmentMultiplier: finiteOr(
        opts.latest.environmentMultiplier ?? opts.latest.environment,
        null,
      ),
      healthyTrainingFraction: finiteOr(opts.latest.healthyTrainingFraction, null),
      source: "latest",
      seasonId: opts.latest.seasonId ?? null,
    });
  }

  if (!rows.length) {
    return {
      ...defaults,
      evidenceSource: "defaults",
      evidenceSeasons: 0,
      rollingRevision: cfg.revision ?? 1,
    };
  }

  // Newest last; weight index 0 (oldest in window) lightest.
  const n = rows.length;
  const lambda = Math.log(2) / halfLife;
  let wOpp = 0;
  let wP = 0;
  let wRel = 0;
  let wEnv = 0;
  let wHealth = 0;
  let sOpp = 0;
  let sP = 0;
  let sRel = 0;
  let sEnv = 0;
  let sHealth = 0;

  for (let i = 0; i < n; i++) {
    const ageBack = n - 1 - i;
    const w = Math.max(minWeight, Math.exp(-lambda * ageBack));
    const row = rows[i];
    const rel = clamp(finiteOr(row.reliability, defaults.reliability), 0, 1);
    if (Number.isFinite(row.opportunity)) {
      sOpp += w * clamp(row.opportunity, 0, 1);
      wOpp += w;
    }
    if (Number.isFinite(row.pLong)) {
      // Reliability shrinks noisy performance toward neutral (0).
      const signed = clamp(row.pLong, -1, 1) * rel;
      sP += w * signed;
      wP += w;
    }
    if (Number.isFinite(row.reliability)) {
      sRel += w * rel;
      wRel += w;
    }
    if (Number.isFinite(row.environmentMultiplier)) {
      sEnv += w * clamp(row.environmentMultiplier, DEVELOPMENT_CAPS.environmentRange.min, DEVELOPMENT_CAPS.environmentRange.max);
      wEnv += w;
    }
    if (Number.isFinite(row.healthyTrainingFraction)) {
      sHealth += w * clamp(row.healthyTrainingFraction, 0, 1);
      wHealth += w;
    }
  }

  return {
    opportunity: wOpp > 0 ? clamp(sOpp / wOpp, 0, 1) : defaults.opportunity,
    environmentMultiplier: wEnv > 0 ? clamp(sEnv / wEnv, DEVELOPMENT_CAPS.environmentRange.min, DEVELOPMENT_CAPS.environmentRange.max) : defaults.environmentMultiplier,
    healthyTrainingFraction: wHealth > 0 ? clamp(sHealth / wHealth, 0, 1) : defaults.healthyTrainingFraction,
    // Recover a signed pLong estimate; divide by mean reliability so a reliable
    // +0.5 season does not look like +0.35 after the shrink above.
    pLong: wP > 0 ? clamp(sP / wP / Math.max(0.35, wRel > 0 ? sRel / wRel : defaults.reliability), -1, 1) : defaults.pLong,
    reliability: wRel > 0 ? clamp(sRel / wRel, 0, 1) : defaults.reliability,
    evidenceSource: rows.some((r) => r.source === "history")
      ? "history"
      : rows.some((r) => r.source === "latest")
        ? "latest"
        : "seasonEvidence",
    evidenceSeasons: rows.length,
    rollingRevision: cfg.revision ?? 1,
  };
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
  const a = { ...FORECAST_CONFIG.defaultAssumptions, ...assumptions };
  const payload = [
    DEVELOPMENT_MODEL_VERSION,
    FORECAST_CONFIG.rollingEvidence?.revision ?? 0,
    normalizePosition(player.position).position,
    player.age,
    Math.round(base * 20),
    Math.round((t.trainability ?? 1) * 20),
    Math.round((t.professionalism ?? 0.5) * 10),
    Math.round((t.declineProtection ?? 0) * 100),
    Object.values(t.maturityOffsets || {}).map((v) => Math.round(v * 4)),
    sampleCount,
    {
      opportunity: Math.round(clamp(a.opportunity, 0, 1) * 100),
      environmentMultiplier: Math.round(clamp(a.environmentMultiplier, 0.5, 1.5) * 100),
      healthyTrainingFraction: Math.round(clamp(a.healthyTrainingFraction, 0, 1) * 100),
      pLong: Math.round(clamp(a.pLong, -1, 1) * 100),
      reliability: Math.round(clamp(a.reliability, 0, 1) * 100),
    },
  ];
  return String(hashSeed(JSON.stringify(payload)));
}

/**
 * Return the cached forecast when inputs are unchanged, otherwise recompute and
 * store it (`player.development.forecast`, `player.potential`, `player.potentialForecast`).
 *
 * When `assumptions` are omitted, derives them from the rolling evidence summary.
 * Pass `force: true` to bypass the cache after meaningful mid-season events.
 */
export function getOrUpdateForecast(player, opts = {}) {
  if (!player?.development) return null;
  const assumptions =
    opts.assumptions !== undefined
      ? opts.assumptions
      : buildRollingEvidenceAssumptions(player, { latest: opts.latestEvidence || null });
  const resolved = { ...opts, assumptions };
  const sig = forecastInputSignature(player, resolved);
  const cached = player.development.forecast;
  if (!opts.force && cached && cached.inputSignature === sig) {
    player.potential = cached.potentialCache;
    player.potentialForecast = cached;
    return cached;
  }
  const careerId = opts.careerId ?? player.development.careerId ?? player.careerId ?? player.name;
  const forecast = forecastPotential(player, {
    ...resolved,
    careerId,
    rng: opts.rng || createStreamRng(careerId, `forecast:${sig}`),
  });
  forecast.inputSignature = sig;
  player.development.forecast = forecast;
  player.potential = forecast.potentialCache;
  player.potentialForecast = forecast;
  return forecast;
}
