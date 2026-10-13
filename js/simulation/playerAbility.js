/**
 * Player ability: position-weighted overall from durable attributes.
 *
 * Contract
 *  - Attributes are floats in [1, 99]; they are the source of truth.
 *  - `rating` is a *derived cache* (rounded base overall); never edit it directly.
 *  - Overall is a convex combination of the role's attributes, so it always
 *    lies within [min, max] of the attributes used. There is NO floor of 40.
 *  - Temporary state (form, fatigue, injury effects ...) never touches durable
 *    attributes; it yields "effective" attributes / a "current" overall.
 */
import { clamp } from "../utils/helpers.js";
import {
  ATTRIBUTE_MIN,
  ATTRIBUTE_MAX,
  GK_ATTRIBUTE_KEYS,
  GK_OVERALL_WEIGHTS,
  OUTFIELD_ATTRIBUTE_KEYS,
  OUTFIELD_OVERALL_WEIGHTS,
  POSITION_ALIASES,
} from "../config/playerDevelopmentConfig.js";
import { computeTargetStateDelta, distributeDeltaByWeights } from "./playerState.js";

/**
 * Canonicalise a free-form position label.
 * @returns {{position:string, isDefaultFallback:boolean, aliasUsed:string|null, input:string}}
 */
export function normalizePosition(pos) {
  const input = String(pos ?? "").trim();
  const key = input.toUpperCase().replace(/[\s_/-]+/g, "");
  if (key === "GK") return { position: "GK", isDefaultFallback: false, aliasUsed: null, input };
  if (key && key !== "DEFAULT" && Object.prototype.hasOwnProperty.call(OUTFIELD_OVERALL_WEIGHTS, key)) {
    return { position: key, isDefaultFallback: false, aliasUsed: null, input };
  }
  const alias = key ? POSITION_ALIASES[key] : undefined;
  if (alias) return { position: alias, isDefaultFallback: false, aliasUsed: key, input };
  return { position: "DEFAULT", isDefaultFallback: true, aliasUsed: null, input };
}

export function isGoalkeeperPosition(position) {
  return normalizePosition(position).position === "GK";
}

/** Attribute keys displayed / used for the position (GK keys for GK). */
export function getDisplayAttributeKeys(position) {
  return isGoalkeeperPosition(position) ? [...GK_ATTRIBUTE_KEYS] : [...OUTFIELD_ATTRIBUTE_KEYS];
}

/**
 * Normalised, non-negative weights (sum = 1) for the position. Returns a fresh object.
 */
export function getOverallWeights(position) {
  const { position: pos } = normalizePosition(position);
  const table = pos === "GK" ? GK_OVERALL_WEIGHTS : OUTFIELD_OVERALL_WEIGHTS[pos] || OUTFIELD_OVERALL_WEIGHTS.DEFAULT;
  const keys = pos === "GK" ? GK_ATTRIBUTE_KEYS : OUTFIELD_ATTRIBUTE_KEYS;
  const raw = {};
  let sum = 0;
  for (const k of keys) {
    const w = Math.max(0, Number(table[k]) || 0);
    raw[k] = w;
    sum += w;
  }
  const out = {};
  for (const k of keys) out[k] = sum > 0 ? raw[k] / sum : 1 / keys.length;
  return out;
}

/**
 * Check that attributes are finite, within [1, 99], and include every key the position needs.
 * @returns {{ok:boolean, missing:string[], invalid:string[], errors:string[]}}
 */
export function validateAttributes(attrs, position) {
  const keys = getDisplayAttributeKeys(position);
  const missing = [];
  const invalid = [];
  if (!attrs || typeof attrs !== "object") {
    return { ok: false, missing: [...keys], invalid, errors: ["attributes is not an object"] };
  }
  for (const k of keys) {
    const v = attrs[k];
    if (v === undefined || v === null) missing.push(k);
    else if (typeof v !== "number" || !Number.isFinite(v) || v < ATTRIBUTE_MIN || v > ATTRIBUTE_MAX) invalid.push(k);
  }
  const errors = [
    ...missing.map((k) => `missing attribute ${k}`),
    ...invalid.map((k) => `attribute ${k} must be a finite number in [${ATTRIBUTE_MIN}, ${ATTRIBUTE_MAX}]`),
  ];
  return { ok: errors.length === 0, missing, invalid, errors };
}

/**
 * Position-weighted overall.
 * @returns {{raw:number, rounded:number, weights:object, keysUsed:string[], minAttr:number, maxAttr:number}}
 * @throws {RangeError} when a required attribute is missing or non-finite (no silent defaults/floors)
 */
export function calculateOverall(attributes, position) {
  const keysUsed = getDisplayAttributeKeys(position);
  const weights = getOverallWeights(position);
  let raw = 0;
  let minAttr = Infinity;
  let maxAttr = -Infinity;
  for (const k of keysUsed) {
    const v = attributes?.[k];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new RangeError(`calculateOverall: attribute ${k} is missing or not finite for position ${position}`);
    }
    raw += weights[k] * v;
    if (v < minAttr) minAttr = v;
    if (v > maxAttr) maxAttr = v;
  }
  // Guard against 1-ulp float drift outside the convex hull.
  raw = clamp(raw, minAttr, maxAttr);
  return { raw, rounded: Math.round(raw), weights, keysUsed, minAttr, maxAttr };
}

/**
 * Durable attributes -> effective attributes after temporary state and health effects.
 * The state delta (overall points, clamped [-6, +3]) and any injury penalty are spread
 * across attributes by role weight, then every attribute is clamped to [1, 99].
 * @param {object} durableAttrs
 * @param {object} state  playerState shape (may be null => neutral)
 * @param {string} position
 * @param {{overallPenalty?:number, scale?:number, attributePenalties?:Object<string,number>}|null} healthEffects
 */
export function calculateEffectiveAttributes(durableAttrs, state, position, healthEffects = null) {
  const keys = getDisplayAttributeKeys(position);
  const weights = getOverallWeights(position);
  const delta = computeTargetStateDelta(state);
  const penalty = healthEffects ? Math.max(0, Number(healthEffects.overallPenalty) || 0) * (healthEffects.scale ?? 1) : 0;
  const shifted = distributeDeltaByWeights(durableAttrs, weights, delta - penalty);
  const out = {};
  for (const k of keys) {
    const pen = Number(healthEffects?.attributePenalties?.[k]) || 0;
    out[k] = clamp(shifted[k] - pen, ATTRIBUTE_MIN, ATTRIBUTE_MAX);
  }
  return out;
}

/** Temporary effects of the active injury (or null). */
export function getHealthEffects(player) {
  const inj = player?.health?.activeInjury;
  return inj?.temporaryEffects || null;
}

/** Fresh base overall raw from durable attributes (does not trust caches). */
export function getBaseOverall(player) {
  if (Number.isFinite(player?.baseOverallRaw)) return player.baseOverallRaw;
  return calculateOverall(player.attributes, player.position).raw;
}

/** Effective attributes (durable + state + injury effects) for the player. */
export function getEffectiveAttributes(player) {
  return calculateEffectiveAttributes(player.attributes, player.state, player.position, getHealthEffects(player));
}

/** Fresh current overall raw from effective attributes. */
export function getCurrentOverall(player) {
  if (Number.isFinite(player?.currentOverallRaw)) return player.currentOverallRaw;
  return calculateOverall(getEffectiveAttributes(player), player.position).raw;
}

/**
 * Recompute and store the derived caches:
 *  baseOverallRaw, rating (= rounded base), currentOverallRaw, currentOverall.
 * Returns the player.
 */
export function refreshAbilityCaches(player) {
  const base = calculateOverall(player.attributes, player.position);
  player.baseOverallRaw = base.raw;
  player.rating = base.rounded;
  const effective = getEffectiveAttributes(player);
  player.effectiveAttributes = effective;
  const current = calculateOverall(effective, player.position);
  player.currentOverallRaw = current.raw;
  player.currentOverall = current.rounded;
  return player;
}

/**
 * Convenience fixture: a right winger whose weighted overall is exactly 80.10.
 * Speed 80, Passing 71, Shooting 79, Defending 72, Physicality 73, Dribbling 88.
 */
export function rwFixtureAttributes() {
  return { Speed: 80, Passing: 71, Shooting: 79, Defending: 72, Physicality: 73, Dribbling: 88 };
}

export const RW_FIXTURE_ATTRIBUTES = {
  Speed: 80,
  Passing: 71,
  Shooting: 79,
  Defending: 72,
  Physicality: 73,
  Dribbling: 88,
};
