/**
 * Player health: exposure-based injuries, temporary effects, rare durable
 * attribute damage and recovery.
 *
 * Health shape:
 *   activeInjury        null | injury record (see sampleInjuryFromExposure) + progress
 *   injuryHistory       recovered / superseded injury records
 *   durableDamage       { attr: points }   outstanding permanent loss already subtracted from attributes
 *   recoverableDamage   { attr: points }   subset of loss that rehab / healthy training can restore
 *   lastAdvancedDay     day number of the last advanceHealth call
 *
 * Idempotency: applying an injury twice for the same `eventId` is a no-op,
 * tracked in `player.development.appliedEventIds["injury:<eventId>"]`.
 *
 * All randomness comes from an explicit `rng` (or a deterministic stream keyed
 * by eventId); there is no Math.random.
 */
import { clamp } from "../utils/helpers.js";
import { createStreamRng } from "./rng.js";
import {
  ATTRIBUTE_MAX,
  ATTRIBUTE_MIN,
  HEALTH_EFFECT_MAX_PENALTY,
  INJURY_HAZARDS,
} from "../config/playerDevelopmentConfig.js";
import { addDaysToDate, toDay } from "./playerState.js";
import { isGoalkeeperPosition, normalizePosition, refreshAbilityCaches } from "./playerAbility.js";

export function createEmptyHealth() {
  return {
    activeInjury: null,
    injuryHistory: [],
    durableDamage: {},
    recoverableDamage: {},
    lastAdvancedDay: null,
  };
}

function ensureHealth(player) {
  if (!player.health || typeof player.health !== "object") player.health = createEmptyHealth();
  const h = player.health;
  if (h.injuryHistory === undefined) h.injuryHistory = [];
  if (h.durableDamage === undefined) h.durableDamage = {};
  if (h.recoverableDamage === undefined) h.recoverableDamage = {};
  if (h.activeInjury === undefined) h.activeInjury = null;
  return h;
}

function ensureApplied(player) {
  if (!player.development || typeof player.development !== "object") player.development = {};
  if (!player.development.appliedEventIds) player.development.appliedEventIds = {};
  return player.development.appliedEventIds;
}

/** Has this event key already been applied to the player? */
export function hasEventApplied(player, key) {
  return Boolean(player?.development?.appliedEventIds?.[key]);
}

/** Mark an event key as applied; returns false if it was already applied. */
export function markEventApplied(player, key) {
  const applied = ensureApplied(player);
  if (applied[key]) return false;
  applied[key] = true;
  return true;
}

function finiteOrNull(v) {
  return v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
}

/** True when the player is not in an unexpired injury on `date`. */
export function isAvailable(health, date) {
  const inj = health?.activeInjury;
  if (!inj) return true;
  const day = toDay(date);
  if (day == null) return false;
  return day >= inj.expectedReturnDay;
}

function pickSeverity(rng) {
  const roll = rng.random();
  let acc = 0;
  for (const s of INJURY_HAZARDS.severityMixture) {
    acc += s.p;
    if (roll < acc) return s;
  }
  return INJURY_HAZARDS.severityMixture[INJURY_HAZARDS.severityMixture.length - 1];
}

/**
 * Sample whether an exposure produces an injury (Poisson hazard).
 * P(injury) = 1 - exp(-rate * riskMultiplier * positionMultiplier * hours).
 *
 * @param {{hours:number, kind:"match"|"training", riskMultiplier?:number, rng:object, eventId:string, date:any, position?:string}} input
 * @returns {object|null} injury record or null. Pure: does not touch any player.
 */
export function sampleInjuryFromExposure({ hours, kind, riskMultiplier = 1, rng, eventId, date, position } = {}) {
  if (!rng || typeof rng.random !== "function") throw new TypeError("sampleInjuryFromExposure requires an rng");
  if (!(hours > 0)) return null;
  const base = kind === "training" ? INJURY_HAZARDS.trainingPerHour : INJURY_HAZARDS.matchPerHour;
  const { position: pos } = normalizePosition(position);
  const posMult = INJURY_HAZARDS.positionMultiplier[pos] ?? INJURY_HAZARDS.positionMultiplier.DEFAULT;
  const rm = INJURY_HAZARDS.riskMultiplier;
  const risk = clamp(Number(riskMultiplier) || 1, rm.min, rm.max);
  const probability = 1 - Math.exp(-base * risk * posMult * hours);
  if (!(rng.random() < probability)) return null;

  const sev = pickSeverity(rng);
  const durationDays = rng.int(sev.minDays, sev.maxDays);
  const startDay = toDay(date);
  return {
    eventId: String(eventId),
    kind: kind === "training" ? "training" : "match",
    severity: sev.id,
    date,
    startDay,
    durationDays,
    expectedReturnDate: addDaysToDate(date, durationDays),
    expectedReturnDay: startDay == null ? null : startDay + durationDays,
    temporaryEffects: { overallPenalty: sev.overallPenalty, scale: 1, attributePenalties: {} },
    returnReadiness: sev.returnReadiness,
    probability,
  };
}

function sampleDurableDamage(player, injury, rng) {
  const cfg = INJURY_HAZARDS.durableDamage[injury.severity];
  if (!cfg || !(cfg.prob > 0) || !(rng.random() < cfg.prob)) return {};
  const total = rng.float(cfg.min, cfg.max);
  const targets = isGoalkeeperPosition(player.position)
    ? INJURY_HAZARDS.damageTargets.goalkeeper
    : INJURY_HAZARDS.damageTargets.outfield;
  const keys = Object.keys(targets);
  const mass = keys.reduce((s, k) => s + targets[k], 0);
  // Mostly one primary attribute takes the hit; the rest is spread by weight.
  let roll = rng.random() * mass;
  let primary = keys[keys.length - 1];
  for (const k of keys) {
    roll -= targets[k];
    if (roll <= 0) {
      primary = k;
      break;
    }
  }
  const out = {};
  for (const k of keys) {
    const share = k === primary ? 0.6 : (0.4 * targets[k]) / (mass - targets[primary] || 1);
    out[k] = total * share;
  }
  return out;
}

/**
 * Apply an injury record to a player: set `activeInjury` with temporary effects
 * and sample durable attribute damage exactly once per eventId.
 * @param {object} player
 * @param {object} injuryRecord  from sampleInjuryFromExposure
 * @param {{rng?:object, careerId?:string}} [opts] rng for damage sampling; defaults to a stream keyed by eventId
 * @returns {{applied:boolean, duplicate:boolean, injury:object|null, durableDamage:object}}
 */
export function applyInjury(player, injuryRecord, { rng = null, careerId = null } = {}) {
  if (!injuryRecord?.eventId) throw new TypeError("applyInjury requires injuryRecord.eventId");
  const key = `injury:${injuryRecord.eventId}`;
  if (!markEventApplied(player, key)) return { applied: false, duplicate: true, injury: player.health?.activeInjury ?? null, durableDamage: {} };

  const health = ensureHealth(player);
  const cid = careerId ?? player.development?.careerId ?? player.careerId ?? player.name ?? "career";
  const damageRng = rng || createStreamRng(cid, `injury-damage:${injuryRecord.eventId}`);

  const damage = sampleDurableDamage(player, injuryRecord, damageRng);
  const recoverable = INJURY_HAZARDS.recoverableFraction;
  let totalDamage = 0;
  for (const [k, pts] of Object.entries(damage)) {
    const before = Number(player.attributes?.[k]);
    if (!Number.isFinite(before) || pts <= 0) continue;
    const after = clamp(before - pts, ATTRIBUTE_MIN, ATTRIBUTE_MAX);
    const lost = before - after;
    if (lost <= 0) continue;
    player.attributes[k] = after;
    health.durableDamage[k] = (health.durableDamage[k] || 0) + lost;
    health.recoverableDamage[k] = (health.recoverableDamage[k] || 0) + lost * recoverable;
    totalDamage += lost;
  }

  const record = {
    ...injuryRecord,
    temporaryEffects: {
      overallPenalty: Math.min(HEALTH_EFFECT_MAX_PENALTY, injuryRecord.temporaryEffects?.overallPenalty ?? 0),
      scale: 1,
      attributePenalties: { ...(injuryRecord.temporaryEffects?.attributePenalties || {}) },
    },
    durableDamage: damage,
    durableDamageTotal: totalDamage,
    progress: 0,
  };

  const current = health.activeInjury;
  if (current && (current.expectedReturnDay ?? -Infinity) >= (record.expectedReturnDay ?? Infinity)) {
    // Existing injury already keeps him out at least as long: log the new one, keep the old.
    health.injuryHistory.push({ ...record, superseded: true });
  } else {
    if (current) health.injuryHistory.push({ ...current, superseded: true });
    health.activeInjury = record;
  }

  if (player.attributes) refreshAbilityCaches(player);
  return { applied: true, duplicate: false, injury: health.activeInjury, durableDamage: damage };
}

/**
 * Advance recovery to `date`: update progress, fade temporary effects, and
 * clear the injury once its time has elapsed (returning with reduced match readiness).
 * @returns {{recovered:boolean, progress:number|null, injury:object|null}}
 */
export function advanceHealth(player, date) {
  const health = ensureHealth(player);
  const day = toDay(date);
  if (day != null) health.lastAdvancedDay = day;
  const inj = health.activeInjury;
  if (!inj || day == null || inj.startDay == null) {
    return { recovered: false, progress: inj ? (inj.progress ?? 0) : null, injury: inj };
  }
  const progress = clamp((day - inj.startDay) / Math.max(1, inj.durationDays), 0, 1);
  inj.progress = Math.max(inj.progress || 0, progress);
  if (inj.progress >= 1) {
    const availabilityReturnDay =
      finiteOrNull(inj.availabilityReturnDay) ??
      finiteOrNull(inj.expectedReturnDay) ??
      (inj.startDay != null && finiteOrNull(inj.durationDays) != null
        ? inj.startDay + Number(inj.durationDays)
        : null);
    health.injuryHistory.push({
      ...inj,
      // Observation timestamp (may be later than availability).
      recoveredDay: day,
      // Availability boundary used by development exposure accounting.
      availabilityReturnDay:
        availabilityReturnDay != null ? availabilityReturnDay : inj.expectedReturnDay ?? null,
    });
    health.activeInjury = null;
    if (player.state) {
      player.state.readiness = Math.min(player.state.readiness ?? 1, inj.returnReadiness ?? 0.8);
    }
    if (player.attributes) refreshAbilityCaches(player);
    return { recovered: true, progress: 1, injury: null };
  }
  inj.temporaryEffects.scale = 1 - inj.progress;
  if (player.attributes) refreshAbilityCaches(player);
  return { recovered: false, progress: inj.progress, injury: inj };
}

/**
 * Restore up to `amount` attribute points of *tracked recoverable* damage
 * (proportionally across damaged attributes). Never restores untracked loss
 * and never raises an attribute above its pre-damage value.
 * @returns {{restored:number, perAttribute:object}}
 */
export function applyRecoverableRestoration(player, amount, date = null) {
  const health = ensureHealth(player);
  const entries = Object.entries(health.recoverableDamage).filter(([, v]) => v > 1e-9);
  const pool = entries.reduce((s, [, v]) => s + v, 0);
  const take = clamp(Number(amount) || 0, 0, pool);
  const perAttribute = {};
  if (take <= 0 || pool <= 0) return { restored: 0, perAttribute };
  let restored = 0;
  for (const [k, v] of entries) {
    const part = Math.min(v, (take * v) / pool);
    const before = Number(player.attributes?.[k]);
    if (!Number.isFinite(before)) continue;
    const after = clamp(before + part, ATTRIBUTE_MIN, ATTRIBUTE_MAX);
    const gained = after - before;
    player.attributes[k] = after;
    health.recoverableDamage[k] = Math.max(0, v - gained);
    if (health.durableDamage[k] !== undefined) health.durableDamage[k] = Math.max(0, health.durableDamage[k] - gained);
    perAttribute[k] = gained;
    restored += gained;
    if (health.recoverableDamage[k] < 1e-9) delete health.recoverableDamage[k];
    if (health.durableDamage[k] !== undefined && health.durableDamage[k] < 1e-9) delete health.durableDamage[k];
  }
  const day = toDay(date);
  if (day != null) health.lastRestorationDay = day;
  if (player.attributes) refreshAbilityCaches(player);
  return { restored, perAttribute };
}

/**
 * Injury risk multiplier in [0.5, 2]: resilience / natural fitness lower it;
 * age, fatigue, low readiness and recent injuries raise it.
 */
export function computeRiskMultiplier(player) {
  const d = player.development || {};
  const traits = d.traits || d;
  const resilience = Number.isFinite(traits.resilience) ? traits.resilience : 0.5;
  const fitness = Number.isFinite(traits.naturalFitness) ? traits.naturalFitness : 0.5;
  const ageCfg = INJURY_HAZARDS.ageHazard;
  const age = Number(player.age) || 0;
  let m = 1 + 0.4 * (0.5 - resilience) + 0.2 * (0.5 - fitness);
  if (age > ageCfg.ageStart) m += ageCfg.perYear * (age - ageCfg.ageStart);
  m += 0.4 * clamp(player.state?.fatigue ?? 0, 0, 1);
  m += 0.2 * (1 - clamp(player.state?.readiness ?? 1, 0, 1));
  const h = player.health;
  if (h?.injuryHistory?.length) {
    const ref = h.lastAdvancedDay;
    const recent = h.injuryHistory.filter((i) => {
      if (i.superseded) return false;
      return ref == null || i.startDay == null || ref - i.startDay <= 365;
    }).length;
    m += Math.min(0.32, 0.08 * recent);
  }
  const { min, max } = INJURY_HAZARDS.riskMultiplier;
  return clamp(m, min, max);
}
