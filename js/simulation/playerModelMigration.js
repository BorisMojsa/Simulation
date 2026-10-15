/**
 * Player model migration (v1/v2 → v3).
 *
 * v3 removes active individual career ceilings. Old budgets/ceilings are archived
 * as inert data; current attributes and career state are preserved. Idempotent.
 */
import { clamp } from "../utils/helpers.js";
import { createStreamRng } from "./rng.js";
import {
  ATTRIBUTE_MAX,
  ATTRIBUTE_MIN,
  BUDGET_HARD_MAX,
  DEVELOPMENT_MODEL_VERSION,
  MIGRATION_CONFIG,
  PLAYER_MODEL_VERSION,
  PREVIOUS_DEVELOPMENT_MODEL_VERSION,
} from "../config/playerDevelopmentConfig.js";
import { getDisplayAttributeKeys, isGoalkeeperPosition, validateAttributes } from "./playerAbility.js";
import {
  generateAttributeCeilings,
  generateGkAttributes,
  initializePlayerDevelopment,
  sampleTraits,
} from "./playerDevelopmentModel.js";
import { refreshAbilityCaches } from "./playerAbility.js";

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
    const hadGkKeys = isGoalkeeperPosition(player.position) && validateAttributes(player.attributes, player.position).ok;
    let gkProxy = false;
    if (isGoalkeeperPosition(player.position) && !hadGkKeys) {
      player.attributes = generateGkAttributes(legacyRating, ATTRIBUTE_MAX, stream("gk-proxy"));
      gkProxy = true;
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
      fromVersion: legacy.version ?? 1,
      version: PLAYER_MODEL_VERSION,
      gkProxy,
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
  refreshAbilityCaches(player);
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
 */
export function ensurePlayerModel(player, opts = {}) {
  if (!player) return player;
  if (!isPlayerV3(player)) migratePlayerToV3(player, opts);
  return player;
}
