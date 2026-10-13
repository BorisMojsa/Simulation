/**
 * Temporary player state: form, morale, match readiness, fatigue and
 * adaptation. State never changes durable attributes; it only produces a
 * temporary overall delta that `playerAbility.calculateEffectiveAttributes`
 * distributes across attributes.
 *
 * State shape:
 *   form        [-1, 1]  EWMA of match performance observations (0 = neutral)
 *   morale      [-1, 1]  slow-moving mood (0 = neutral)
 *   readiness   [0, 1]   match sharpness (1 = fully match fit)
 *   fatigue     [0, 1]   accumulated load (0 = fresh)
 *   adaptationPenalty [0, 1]  new club / role / league settling-in drag
 *
 * Dates: `Date`, ISO strings, or plain numbers (treated as *day indexes*).
 * All helpers are pure aside from mutating the state object passed in.
 */
import { clamp } from "../utils/helpers.js";
import { STATE_DELTA, STATE_DYNAMICS, ATTRIBUTE_MIN, ATTRIBUTE_MAX } from "../config/playerDevelopmentConfig.js";

const MS_PER_DAY = 86_400_000;

/** Convert a Date / ISO string / day-index number to a day number, or null. */
export function toDay(date) {
  if (date == null) return null;
  if (typeof date === "number") return Number.isFinite(date) ? date : null;
  if (date instanceof Date) {
    const t = date.getTime();
    return Number.isFinite(t) ? t / MS_PER_DAY : null;
  }
  if (typeof date === "object" && "date" in date) return toDay(date.date);
  if (typeof date === "string") {
    const t = Date.parse(date);
    return Number.isFinite(t) ? t / MS_PER_DAY : null;
  }
  return null;
}

/** Add whole days to a date of any supported type, preserving the type. */
export function addDaysToDate(date, days) {
  if (typeof date === "number") return date + days;
  if (date instanceof Date) return new Date(date.getTime() + days * MS_PER_DAY);
  if (typeof date === "string") {
    const t = Date.parse(date);
    if (Number.isFinite(t)) return new Date(t + days * MS_PER_DAY).toISOString();
  }
  return null;
}

export function createNeutralState() {
  return {
    form: 0,
    morale: 0,
    readiness: 1,
    fatigue: 0,
    adaptationPenalty: 0,
    roleFit: 1,
    lastFormDay: null,
    lastUpdatedAt: null,
  };
}

export function ensureState(playerOrState) {
  // Accept either a player ({ state }) or a bare state object.
  if (playerOrState && typeof playerOrState === "object" && "attributes" in playerOrState) {
    if (!playerOrState.state) playerOrState.state = createNeutralState();
    const state = playerOrState.state;
    for (const [k, v] of Object.entries(createNeutralState())) {
      if (state[k] === undefined) state[k] = v;
    }
    return state;
  }
  const state = playerOrState && typeof playerOrState === "object" ? playerOrState : createNeutralState();
  for (const [k, v] of Object.entries(createNeutralState())) {
    if (state[k] === undefined) state[k] = v;
  }
  return state;
}

/** Exponential half-life decay factor. */
function halfLifeFactor(days, halfLife) {
  if (!(days > 0)) return 1;
  return Math.pow(0.5, days / halfLife);
}

/** Pull form toward 0 with a half-life; returns the state. */
export function decayFormTowardNeutral(state, elapsedDays) {
  ensureState(state);
  state.form = clamp(state.form * halfLifeFactor(elapsedDays, STATE_DYNAMICS.form.halfLifeDays), -1, 1);
  return state;
}

/** Pull morale toward 0 with a half-life; returns the state. */
export function decayMoraleTowardNeutral(state, elapsedDays) {
  ensureState(state);
  state.morale = clamp(state.morale * halfLifeFactor(elapsedDays, STATE_DYNAMICS.morale.halfLifeDays), -1, 1);
  return state;
}

/**
 * Fold one match performance observation into form (EWMA weighted by minutes).
 * @param {object} state
 * @param {number} observation  in [-1, 1] (e.g. tanh(z / 1.5) from the ledger)
 * @param {number} minutes      minutes played (<= 0 is ignored: no appearance, no signal)
 * @param {Date|string|number|{date:any}|null} clock  match date; form first decays over the days since the last observation
 */
export function updateFormFromObservation(state, observation, minutes, clock = null) {
  ensureState(state);
  if (!Number.isFinite(observation) || !(minutes > 0)) return state;
  const day = toDay(clock);
  if (day != null && state.lastFormDay != null && day > state.lastFormDay) {
    decayFormTowardNeutral(state, day - state.lastFormDay);
  }
  const { alphaPer90, maxMinutesFactor } = STATE_DYNAMICS.form;
  const weight = alphaPer90 * clamp(minutes / 90, 0, maxMinutesFactor);
  state.form = clamp(state.form + weight * (clamp(observation, -1, 1) - state.form), -1, 1);
  if (day != null) state.lastFormDay = day;
  return state;
}

/**
 * Apply a morale event. Each event is bounded to ±0.05 unless `override` is set.
 */
export function applyMoraleDelta(state, delta, { override = false } = {}) {
  ensureState(state);
  if (!Number.isFinite(delta)) return state;
  const max = STATE_DYNAMICS.morale.maxEventDelta;
  const applied = override ? delta : clamp(delta, -max, max);
  state.morale = clamp(state.morale + applied, -1, 1);
  return state;
}

/**
 * Match sharpness: decays without games, rises with minutes.
 * @param {{minutes?:number, elapsedDays?:number}} input
 */
export function updateReadiness(state, { minutes = 0, elapsedDays = 0 } = {}) {
  ensureState(state);
  const cfg = STATE_DYNAMICS.readiness;
  if (elapsedDays > 0) {
    state.readiness = Math.max(cfg.floor, state.readiness - cfg.decayPerDay * elapsedDays);
  }
  if (minutes > 0) {
    const gain = clamp((minutes / 90) * cfg.gainPer90, 0, 1);
    state.readiness = clamp(state.readiness + (1 - state.readiness) * gain, 0, 1);
  }
  return state;
}

/** Fatigue: recover over rest days, then add load from minutes. */
export function updateFatigue(state, { minutes = 0, elapsedDays = 0 } = {}) {
  ensureState(state);
  const cfg = STATE_DYNAMICS.fatigue;
  if (elapsedDays > 0) state.fatigue = Math.max(0, state.fatigue - cfg.recoveryPerDay * elapsedDays);
  if (minutes > 0) state.fatigue = clamp(state.fatigue + (minutes / 90) * cfg.perFull90, 0, 1);
  return state;
}

/** Set (never lowers an existing larger penalty unless `replace`) the settling-in penalty. */
export function setAdaptationPenalty(state, penalty, { replace = true } = {}) {
  ensureState(state);
  const p = clamp(Number(penalty) || 0, 0, 1);
  state.adaptationPenalty = replace ? p : Math.max(state.adaptationPenalty, p);
  return state;
}

/** Adaptation penalty halves every 60 days. */
export function decayAdaptation(state, elapsedDays) {
  ensureState(state);
  state.adaptationPenalty = clamp(
    state.adaptationPenalty * halfLifeFactor(elapsedDays, STATE_DYNAMICS.adaptation.halfLifeDays),
    0,
    1,
  );
  if (state.adaptationPenalty < 1e-4) state.adaptationPenalty = 0;
  return state;
}

/**
 * Overall-points delta implied by the current state, clamped to [-6, +3].
 * Neutral state returns exactly 0.
 */
export function computeTargetStateDelta(state) {
  if (!state) return 0;
  const s = ensureState({ ...state });
  const c = STATE_DELTA;
  const raw =
    c.form * s.form +
    c.morale * s.morale +
    c.readiness * (1 - clamp(s.readiness, 0, 1)) +
    c.fatigue * clamp(s.fatigue, 0, 1) +
    c.adaptation * clamp(s.adaptationPenalty, 0, 1);
  return clamp(raw, c.min, c.max);
}

/**
 * Spread an overall-points delta over attributes by role weights so that the
 * weighted overall of the result moves by exactly `delta` (before [1, 99]
 * clamping): shift_k = delta * w_k / sum(w_j^2). Returns a new attribute object.
 */
export function distributeDeltaByWeights(attributes, weights, delta) {
  const keys = Object.keys(weights);
  const sumSq = keys.reduce((s, k) => s + weights[k] * weights[k], 0) || 1;
  const out = {};
  for (const k of keys) {
    const shift = (delta * weights[k]) / sumSq;
    out[k] = clamp(Number(attributes[k]) + shift, ATTRIBUTE_MIN, ATTRIBUTE_MAX);
  }
  return out;
}

/**
 * Integration helper: effective attributes of `player` from durable
 * attributes + `player.state` (+ optional injury effects).
 * `weights` are the role's overall weights (see playerAbility.getOverallWeights),
 * passed in to keep this module free of a dependency cycle.
 */
export function applyStateToEffectiveAttributes(player, weights, healthEffects = null) {
  const delta = computeTargetStateDelta(player.state);
  const penalty = healthEffects ? Math.max(0, Number(healthEffects.overallPenalty) || 0) * (healthEffects.scale ?? 1) : 0;
  const shifted = distributeDeltaByWeights(player.attributes, weights, delta - penalty);
  const perAttr = healthEffects?.attributePenalties;
  if (perAttr) {
    for (const [k, v] of Object.entries(perAttr)) {
      if (k in shifted) shifted[k] = clamp(shifted[k] - (Number(v) || 0), ATTRIBUTE_MIN, ATTRIBUTE_MAX);
    }
  }
  return shifted;
}

/**
 * Advance temporary state between dated simulation events.
 */
export function advanceStateBetweenDates(player, fromDate, toDate, { poorIntegration = false } = {}) {
  const state = ensureState(player);
  if (!fromDate || !toDate || fromDate === toDate) return state;
  const a = toDay(fromDate);
  const b = toDay(toDate);
  const days = a != null && b != null ? b - a : 0;
  if (days > 0) {
    decayFormTowardNeutral(state, days);
    decayAdaptation(state, days * (poorIntegration ? 1.6 : 1));
    updateFatigue(state, { elapsedDays: days });
    if (!player.health?.activeInjury) {
      updateReadiness(state, { elapsedDays: days * 0.35 });
    } else {
      updateReadiness(state, { elapsedDays: days });
    }
  }
  state.lastUpdatedAt = toDate;
  return state;
}
