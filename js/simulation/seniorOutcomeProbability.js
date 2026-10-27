/**
 * Academy-reference → senior category probabilities and two-step outcome sampling.
 * Independent of DOM / player state. Does not mutate academy weights.
 */
import { OUTCOME_WEIGHT_BY_DISPOSITION } from "../config/academyOpeningConfig.js?v=88";
import {
  SENIOR_CAREER_SCENARIOS,
  SENIOR_PROBABILITY_SHIFT,
} from "../config/seniorCareerScenarioConfig.js?v=88";

export const SENIOR_DISPOSITIONS = Object.freeze([
  "thoughtful",
  "balanced",
  "ambitious",
  "reckless",
]);

export const SENIOR_ABILITY_CATEGORIES = Object.freeze(["positive", "neutral", "negative"]);

const SCORE_KEYS = Object.freeze([-4, -3, -2, -1, 0, 1, 2, 3, 4].map(String));

/**
 * Full-table academy reference profile for a disposition (−4..+4 mass).
 * @returns {{ positive:number, neutral:number, negative:number, total:number }}
 */
export function academyReferenceProfile(disposition, weightTable = OUTCOME_WEIGHT_BY_DISPOSITION) {
  const d = String(disposition || "balanced");
  const table = weightTable[d] || weightTable.balanced;
  if (!table) {
    throw new Error(`academyReferenceProfile: unknown disposition ${d}`);
  }
  let positiveMass = 0;
  let neutralMass = 0;
  let negativeMass = 0;
  for (const key of SCORE_KEYS) {
    const w = Number(table[key]);
    if (!Number.isFinite(w) || w < 0) {
      throw new Error(`academyReferenceProfile: invalid weight ${d}[${key}]=${w}`);
    }
    const score = Number(key);
    if (score > 0) positiveMass += w;
    else if (score < 0) negativeMass += w;
    else neutralMass += w;
  }
  const total = positiveMass + neutralMass + negativeMass;
  if (!(total > 0)) {
    throw new Error(`academyReferenceProfile: zero total for ${d}`);
  }
  return {
    positive: positiveMass / total,
    neutral: neutralMass / total,
    negative: negativeMass / total,
    total,
  };
}

/**
 * Apply the absolute percentage-point shift once:
 *   senior.positive = academy.positive − min(0.10, academy.positive)
 *   senior.neutral  = academy.neutral  + shifted/2
 *   senior.negative = academy.negative + shifted/2
 */
export function transformAcademyReferenceToSenior(
  academyReference,
  shiftPositive = SENIOR_PROBABILITY_SHIFT.positiveReduction
) {
  const pos = Number(academyReference?.positive);
  const neu = Number(academyReference?.neutral);
  const neg = Number(academyReference?.negative);
  if (![pos, neu, neg].every((v) => Number.isFinite(v) && v >= 0)) {
    throw new Error("transformAcademyReferenceToSenior: nonnegative finite masses required");
  }
  const sum = pos + neu + neg;
  if (!(sum > 0)) {
    throw new Error("transformAcademyReferenceToSenior: invalid reference sum");
  }
  // Accept either already-normalized or raw masses that sum > 0.
  const ap = Math.abs(sum - 1) < 1e-9 ? pos : pos / sum;
  const an = Math.abs(sum - 1) < 1e-9 ? neu : neu / sum;
  const ag = Math.abs(sum - 1) < 1e-9 ? neg : neg / sum;

  const shifted = Math.min(shiftPositive, ap);
  const senior = {
    positive: ap - shifted,
    neutral: an + shifted / 2,
    negative: ag + shifted / 2,
  };
  assertCategoryProbabilities(senior);
  return senior;
}

export function assertCategoryProbabilities(profile, tol = 1e-12) {
  const { positive, neutral, negative } = profile;
  for (const [k, v] of Object.entries({ positive, neutral, negative })) {
    if (!Number.isFinite(v) || v < -tol) {
      throw new Error(`assertCategoryProbabilities: invalid ${k}=${v}`);
    }
  }
  const sum = positive + neutral + negative;
  if (Math.abs(sum - 1) > 1e-9) {
    throw new Error(`assertCategoryProbabilities: sum=${sum}`);
  }
  return true;
}

/** Cached senior targets keyed by disposition. */
const _seniorCache = new Map();

export function seniorCategoryProbabilities(disposition) {
  const d = String(disposition || "balanced");
  if (_seniorCache.has(d)) return _seniorCache.get(d);
  const academy = academyReferenceProfile(d);
  const senior = transformAcademyReferenceToSenior(academy);
  const packed = Object.freeze({
    disposition: d,
    academyReference: Object.freeze({ ...academy }),
    senior: Object.freeze({ ...senior }),
    probabilityModelVersion: SENIOR_CAREER_SCENARIOS.probabilityModelVersion,
  });
  _seniorCache.set(d, packed);
  return packed;
}

export function allSeniorCategoryProbabilityTables() {
  const out = {};
  for (const d of SENIOR_DISPOSITIONS) {
    out[d] = seniorCategoryProbabilities(d);
  }
  return out;
}

/**
 * Sample positive / neutral / negative using the transformed profile.
 */
export function sampleAbilityCategory(disposition, rng) {
  const { senior } = seniorCategoryProbabilities(disposition);
  const roll = rng?.random?.() ?? Math.random();
  if (roll < senior.positive) return "positive";
  if (roll < senior.positive + senior.neutral) return "neutral";
  return "negative";
}

/**
 * Within a category, sample one authored outcome by conditionalWeight.
 */
export function sampleOutcomeInCategory(outcomes, rng) {
  const list = Array.isArray(outcomes) ? outcomes.filter(Boolean) : [];
  if (!list.length) {
    throw new Error("sampleOutcomeInCategory: empty category");
  }
  let total = 0;
  const weights = list.map((o) => {
    const w = Number(o.conditionalWeight ?? o.weight);
    if (!Number.isFinite(w) || w <= 0) {
      throw new Error(`sampleOutcomeInCategory: invalid conditionalWeight on ${o.id}`);
    }
    total += w;
    return w;
  });
  let roll = (rng?.random?.() ?? Math.random()) * total;
  for (let i = 0; i < list.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return list[i];
  }
  return list[list.length - 1];
}

export function categoryForDelta(delta) {
  const d = Number(delta);
  if (!Number.isFinite(d)) throw new Error("categoryForDelta: non-finite delta");
  if (d > 0) return "positive";
  if (d < 0) return "negative";
  return "neutral";
}

export function validateAbilityCategoryMatch(abilityCategory, delta) {
  const expected = categoryForDelta(delta);
  if (abilityCategory !== expected) {
    throw new Error(
      `abilityCategory "${abilityCategory}" does not match delta ${delta} (expected ${expected})`
    );
  }
}
