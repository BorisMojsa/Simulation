/**
 * Player model migration (v1/v2 → v3).
 *
 * v3 removes active individual career ceilings. Old budgets/ceilings are archived
 * as inert data; current attributes and career state are preserved. Idempotent.
 *
 * Fix 13 also repairs incomplete/legacy goalkeeper attribute maps at this shared
 * boundary without inventing a new restore API or schema bump.
 */
import { clamp } from "../utils/helpers.js";
import { createStreamRng } from "./rng.js";
import {
  ATTRIBUTE_MAX,
  ATTRIBUTE_MIN,
  BUDGET_HARD_MAX,
  DEVELOPMENT_MODEL_VERSION,
  GK_ATTRIBUTE_KEYS,
  MIGRATION_CONFIG,
  PLAYER_MODEL_VERSION,
  PREVIOUS_DEVELOPMENT_MODEL_VERSION,
} from "../config/playerDevelopmentConfig.js";
import {
  calculateOverall,
  getDisplayAttributeKeys,
  getOverallWeights,
  isGoalkeeperPosition,
  validateAttributes,
} from "./playerAbility.js";
import {
  generateAttributeCeilings,
  generateGkAttributes,
  initializePlayerDevelopment,
  sampleTraits,
} from "./playerDevelopmentModel.js";
import { refreshAbilityCaches } from "./playerAbility.js";

const GK_OVR_TOLERANCE = 0.05;

function isValidAttributeValue(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= ATTRIBUTE_MIN && v <= ATTRIBUTE_MAX;
}

function resolveGkRepairTarget(player) {
  const base = Number(player.baseOverallRaw);
  if (Number.isFinite(base) && base >= ATTRIBUTE_MIN && base <= ATTRIBUTE_MAX) return base;
  const rating = Number(player.rating);
  if (Number.isFinite(rating) && rating >= ATTRIBUTE_MIN && rating <= ATTRIBUTE_MAX) return rating;
  return MIGRATION_CONFIG.defaultRating;
}

/**
 * Fill missing/invalid GK keys while preserving valid native values (and extras).
 * Synthesized keys are marked via development.migration.gkProxy. Idempotent.
 *
 * @returns {{ repaired:boolean, reason:string, player:object }}
 */
export function repairGoalkeeperAttributes(player, opts = {}) {
  if (!player || typeof player !== "object") {
    return { repaired: false, reason: "no-player", player };
  }
  if (!isGoalkeeperPosition(player.position)) {
    return { repaired: false, reason: "not-gk", player };
  }
  // Pre-academy identities deliberately leave attributes null — academy owns generation.
  if (player.attributes == null) {
    return { repaired: false, reason: "no-attributes", player };
  }
  if (typeof player.attributes !== "object") {
    return { repaired: false, reason: "attributes-not-object", player };
  }

  const validation = validateAttributes(player.attributes, player.position);
  if (validation.ok) {
    return { repaired: false, reason: "already-valid", player };
  }

  const careerId = deriveCareerId(player, opts);
  const identity = `${player.name ?? "player"}:${player.nationality ?? ""}:${player.startYear ?? ""}`;
  const stream = (name) =>
    opts.rng
      ? opts.rng.fork(`migration-gk-repair:${identity}:${name}`)
      : createStreamRng(careerId, `migration-gk-repair:${identity}:${name}`);

  const originalAttrs = { ...player.attributes };
  const weights = getOverallWeights("GK");
  const retained = {};
  const missingKeys = [];
  for (const k of GK_ATTRIBUTE_KEYS) {
    if (isValidAttributeValue(player.attributes[k])) retained[k] = player.attributes[k];
    else missingKeys.push(k);
  }

  const desiredTarget = resolveGkRepairTarget(player);
  let retainedContribution = 0;
  let retainedWeight = 0;
  for (const k of Object.keys(retained)) {
    retainedContribution += weights[k] * retained[k];
    retainedWeight += weights[k];
  }
  const missingWeight = 1 - retainedWeight;
  const reachableMin = retainedContribution + missingWeight * ATTRIBUTE_MIN;
  const reachableMax = retainedContribution + missingWeight * ATTRIBUTE_MAX;
  const reachableTarget = clamp(desiredTarget, reachableMin, reachableMax);

  const synthesized = {};
  if (missingKeys.length === GK_ATTRIBUTE_KEYS.length) {
    // Fully missing/invalid — generate a full proxy shape toward the reachable target.
    Object.assign(synthesized, generateGkAttributes(reachableTarget, ATTRIBUTE_MAX, stream("gk-proxy")));
  } else if (missingKeys.length > 0) {
    // Seed missing keys near the reachable target with light role-shaped noise, then
    // solve a shared offset so only synthesized values move.
    const noiseRng = stream("noise");
    for (const k of missingKeys) {
      const shape = 4 * (weights[k] - 1 / GK_ATTRIBUTE_KEYS.length);
      const noise = (noiseRng.random() - 0.5) * 2;
      synthesized[k] = clamp(reachableTarget + shape + noise, ATTRIBUTE_MIN, ATTRIBUTE_MAX);
    }
    for (let i = 0; i < 32; i++) {
      let synthContribution = 0;
      for (const k of missingKeys) synthContribution += weights[k] * synthesized[k];
      const current = retainedContribution + synthContribution;
      const diff = reachableTarget - current;
      if (Math.abs(diff) <= GK_OVR_TOLERANCE) break;
      for (const k of missingKeys) {
        synthesized[k] = clamp(synthesized[k] + diff, ATTRIBUTE_MIN, ATTRIBUTE_MAX);
      }
    }
  }

  const next = { ...originalAttrs, ...retained, ...synthesized };
  // Preserve extras (outfield leftovers) for compatibility; never feed them into OVR.
  player.attributes = next;

  const ovr = calculateOverall(player.attributes, "GK");
  if (Math.abs(ovr.raw - reachableTarget) > GK_OVR_TOLERANCE) {
    // Final nudge on synthesized keys only.
    const diff = reachableTarget - ovr.raw;
    for (const k of missingKeys) {
      player.attributes[k] = clamp(player.attributes[k] + diff, ATTRIBUTE_MIN, ATTRIBUTE_MAX);
    }
  }

  player.development = player.development || {};
  player.development.migration = {
    ...(player.development.migration || {}),
    gkProxy: true,
    gkRepair: {
      at: PLAYER_MODEL_VERSION,
      missingKeys: [...missingKeys],
      invalidKeys: [...(validation.invalid || [])],
      desiredTarget,
      reachableTarget,
      unattainableDesired: Math.abs(desiredTarget - reachableTarget) > 1e-9,
      preservedOriginal: originalAttrs,
    },
  };

  return {
    repaired: missingKeys.length > 0 || (validation.invalid || []).length > 0,
    reason: "repaired",
    player,
    missingKeys,
    reachableTarget,
    desiredTarget,
  };
}
export function isPlayerV3(player) {
  return Boolean(
    player &&
      player.playerModelVersion >= 3 &&
      player.development?.modelVersion === DEVELOPMENT_MODEL_VERSION &&
      player.development?.migration?.version >= 3,
  );
}

/** @deprecated use isPlayerV3 — kept for older callers. */
export function isPlayerV2(player) {
  return isPlayerV3(player) || Boolean(
    player &&
      player.playerModelVersion >= 2 &&
      (player.development?.modelVersion === PREVIOUS_DEVELOPMENT_MODEL_VERSION ||
        player.development?.modelVersion === DEVELOPMENT_MODEL_VERSION) &&
      player.development?.migration,
  );
}

function deriveCareerId(player, opts) {
  return opts.careerId ?? player.careerId ?? player.development?.careerId ?? player.name ?? "legacy-career";
}

function coerceAttributes(player, rating) {
  const keys = getDisplayAttributeKeys(player.position);
  const out = {};
  for (const k of keys) {
    const v = Number(player.attributes?.[k]);
    out[k] = Number.isFinite(v) ? clamp(v, ATTRIBUTE_MIN, ATTRIBUTE_MAX) : clamp(rating, ATTRIBUTE_MIN, ATTRIBUTE_MAX);
  }
  return out;
}

/**
 * Deactivate v2 ceilings/budgets on an already-initialised player without
 * rerolling attributes or granting free OVR.
 */
export function migratePlayerToV3(player, opts = {}) {
  if (!player || typeof player !== "object") throw new TypeError("migratePlayerToV3 requires a player");
  if (isPlayerV3(player)) return { migrated: false, reason: "already-v3", player };
  if (!player.attributes || typeof player.attributes !== "object") {
    return { migrated: false, reason: "no-attributes", player };
  }

  const careerId = deriveCareerId(player, opts);
  const identity = `${player.name ?? "player"}:${player.nationality ?? ""}:${player.startYear ?? ""}`;
  const stream = (name) =>
    opts.rng ? opts.rng.fork(`migration-v3:${identity}:${name}`) : createStreamRng(careerId, `migration-v3:${identity}:${name}`);

  const hadDev = Boolean(player.development);
  const legacyBudget = Number(player.development?.latentAbilityBudget ?? player.development?.latentBudget);
  const legacyCeilings = player.development?.ceilings || player.development?.attributeCeilings || null;
  const legacy = player.development?.legacy || {
    version: player.development?.migration?.fromVersion ?? (hadDev ? 2 : 1),
    rating: player.rating ?? null,
    potential: player.potential ?? null,
    attributes: { ...player.attributes },
    position: player.position ?? null,
    age: player.age ?? null,
  };

  if (!Number.isFinite(player.age)) player.age = MIGRATION_CONFIG.defaultAge;

  // Fresh players without development: full init.
  if (!hadDev || !player.development?.traits) {
    const legacyRating =
      Number.isFinite(player.rating) && player.rating > 0 ? player.rating : MIGRATION_CONFIG.defaultRating;
    let gkProxy = false;
    let gkRepairMeta = null;
    if (isGoalkeeperPosition(player.position)) {
      const repair = repairGoalkeeperAttributes(player, { ...opts, rng: stream("gk-repair") });
      gkProxy = Boolean(repair.repaired);
      gkRepairMeta = player.development?.migration?.gkRepair || null;
      if (!validateAttributes(player.attributes, player.position).ok) {
        // Absolute fallback if repair could not produce a valid map.
        player.attributes = generateGkAttributes(legacyRating, ATTRIBUTE_MAX, stream("gk-proxy"));
        gkProxy = true;
      }
    } else {
      player.attributes = coerceAttributes(player, legacyRating);
    }
    initializePlayerDevelopment(player, {
      rng: stream("init"),
      careerId,
      budget: Number.isFinite(legacyBudget) ? legacyBudget : BUDGET_HARD_MAX,
      traits: sampleTraits(stream("traits")),
    });
    player.development.legacy = legacy;
    player.development.migration = {
      ...(player.development.migration || {}),
      fromVersion: legacy.version ?? 1,
      version: PLAYER_MODEL_VERSION,
      gkProxy,
      ...(gkRepairMeta ? { gkRepair: gkRepairMeta } : {}),
      budgetSource: "archived-inert",
      ceilingsDeactivated: true,
    };
    player.potential = clamp(Math.max(Number(player.potential) || 0, player.rating), player.rating, 99);
    return { migrated: true, player };
  }

  // Existing v2 player: archive ceilings, flip version, keep attributes/traits/health.
  const archive = {
    latentAbilityBudget: Number.isFinite(legacyBudget) ? legacyBudget : null,
    attributeCeilings: legacyCeilings ? { ...legacyCeilings } : null,
    abilityBudgetsByPosition: player.development.abilityBudgetsByPosition
      ? JSON.parse(JSON.stringify(player.development.abilityBudgetsByPosition))
      : null,
    archivedAtModel: DEVELOPMENT_MODEL_VERSION,
  };
  player.development.legacyArchive = { ...(player.development.legacyArchive || {}), ...archive };
  player.development.legacy = player.development.legacy || legacy;
  player.development.modelVersion = DEVELOPMENT_MODEL_VERSION;
  player.development.latentBudget = BUDGET_HARD_MAX;
  player.development.latentAbilityBudget = BUDGET_HARD_MAX;
  player.development.ceilingsActive = false;
  const inert = generateAttributeCeilings(player.position, player.attributes, BUDGET_HARD_MAX, stream("ceilings"));
  player.development.ceilings = inert;
  player.development.attributeCeilings = inert;
  if (player.development.abilityBudgetsByPosition) {
    for (const rec of Object.values(player.development.abilityBudgetsByPosition)) {
      if (rec && typeof rec === "object") {
        rec.budget = BUDGET_HARD_MAX;
        rec.inert = true;
      }
    }
  }
  player.development.migration = {
    ...(player.development.migration || {}),
    fromVersion: player.development.migration?.version ?? 2,
    version: PLAYER_MODEL_VERSION,
    ceilingsDeactivated: true,
    budgetSource: "archived-inert",
  };
  player.playerModelVersion = PLAYER_MODEL_VERSION;
  player.developmentModelVersion = DEVELOPMENT_MODEL_VERSION;
  if (isGoalkeeperPosition(player.position)) {
    repairGoalkeeperAttributes(player, opts);
  }
  if (player.attributes && validateAttributes(player.attributes, player.position).ok) {
    refreshAbilityCaches(player);
  }
  return { migrated: true, player };
}

/**
 * Legacy entry point — always lands on v3.
 */
export function migratePlayerToV2(player, opts = {}) {
  return migratePlayerToV3(player, opts);
}

/**
 * Make sure the player is on the v3 model, migrating when needed.
 * Goalkeeper attribute shape is repaired even on the already-v3 fast path so
 * incomplete stamped keepers never reach ability-cache refresh invalid.
 */
export function ensurePlayerModel(player, opts = {}) {
  if (!player) return player;
  if (!isPlayerV3(player)) migratePlayerToV3(player, opts);
  else if (isGoalkeeperPosition(player.position)) {
    const repair = repairGoalkeeperAttributes(player, opts);
    if (repair.repaired && player.attributes && validateAttributes(player.attributes, player.position).ok) {
      refreshAbilityCaches(player);
    }
  }
  return player;
}
