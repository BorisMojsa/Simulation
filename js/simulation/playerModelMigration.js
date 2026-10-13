/**
 * Legacy (v1) -> player-model v2 migration.
 *
 * - Idempotent: a migrated player is returned untouched.
 * - Backs up legacy rating / potential / attributes under `development.legacy`.
 * - Recalculates the base overall from attributes (rating becomes the derived cache).
 * - Legacy goalkeepers carried outfield attributes: GK attributes are generated
 *   as a deterministic proxy around the legacy rating.
 * - Traits, ceilings and the latent budget are derived deterministically from the
 *   careerId + player identity (named RNG streams), so reloading a save is stable.
 * - Does NOT invent injury history and does NOT touch contracts, trophies,
 *   seasons, club or world baselines.
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
} from "../config/playerDevelopmentConfig.js?v=61";
import { getDisplayAttributeKeys, isGoalkeeperPosition, validateAttributes } from "./playerAbility.js?v=61";
import { generateGkAttributes, initializePlayerDevelopment, sampleLatentBudget, sampleTraits } from "./playerDevelopmentModel.js?v=61";

export function isPlayerV2(player) {
  return Boolean(
    player &&
      player.playerModelVersion >= PLAYER_MODEL_VERSION &&
      player.development?.modelVersion === DEVELOPMENT_MODEL_VERSION &&
      player.development?.migration,
  );
}

function deriveCareerId(player, opts) {
  return opts.careerId ?? player.careerId ?? player.development?.careerId ?? player.name ?? "legacy-career";
}

/** Float copy of the attributes needed for the role; missing outfield keys fall back to the legacy rating. */
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
 * Migrate one player to v2 in place.
 * @param {object} player
 * @param {{rng?:object, careerId?:string}} [opts]  `rng` is only used when supplied; otherwise named streams keyed by careerId
 * @returns {{migrated:boolean, reason?:string, player:object}}
 */
export function migratePlayerToV2(player, opts = {}) {
  if (!player || typeof player !== "object") throw new TypeError("migratePlayerToV2 requires a player");
  if (isPlayerV2(player)) return { migrated: false, reason: "already-v2", player };
  if (!player.attributes || typeof player.attributes !== "object") {
    // Career intro not finished: nothing to migrate yet.
    return { migrated: false, reason: "no-attributes", player };
  }

  const careerId = deriveCareerId(player, opts);
  const identity = `${player.name ?? "player"}:${player.nationality ?? ""}:${player.startYear ?? ""}`;
  const stream = (name) => (opts.rng ? opts.rng.fork(`migration:${identity}:${name}`) : createStreamRng(careerId, `migration:${identity}:${name}`));

  const legacyRating = Number.isFinite(player.rating) && player.rating > 0 ? player.rating : MIGRATION_CONFIG.defaultRating;
  const legacyPotential = Number.isFinite(player.potential) && player.potential > 0 ? player.potential : null;
  const legacy = player.development?.legacy || {
    version: 1,
    rating: player.rating ?? null,
    potential: player.potential ?? null,
    attributes: { ...player.attributes },
    position: player.position ?? null,
    age: player.age ?? null,
  };

  if (!Number.isFinite(player.age)) player.age = MIGRATION_CONFIG.defaultAge;

  // Goalkeepers: proxy GK attributes if the legacy outfield set is all that exists.
  const hadGkKeys = isGoalkeeperPosition(player.position) && validateAttributes(player.attributes, player.position).ok;
  let gkProxy = false;
  if (isGoalkeeperPosition(player.position) && !hadGkKeys) {
    player.attributes = generateGkAttributes(legacyRating, Math.max(legacyRating, BUDGET_HARD_MAX), stream("gk-proxy"));
    gkProxy = true;
  } else {
    player.attributes = coerceAttributes(player, legacyRating);
  }

  // Budget: honour a legacy potential as a (capped) budget hint; otherwise sample deterministically.
  const budgetRng = stream("budget");
  const sampled = sampleLatentBudget(budgetRng);
  const budget = legacyPotential != null ? Math.min(MIGRATION_CONFIG.maxLegacyPotentialBudget, Math.max(legacyPotential, 0)) : sampled;

  initializePlayerDevelopment(player, {
    rng: stream("ceilings"),
    careerId,
    budget,
    traits: sampleTraits(stream("traits")),
  });
  player.development.legacy = legacy;
  player.development.migration = {
    fromVersion: legacy.version ?? 1,
    version: PLAYER_MODEL_VERSION,
    gkProxy,
    budgetSource: legacyPotential != null ? "legacy-potential" : "sampled",
  };
  // Potential is a forecast cache from now on; until the first forecast it holds the legacy value
  // (never below the new rating, never above the hard max).
  player.potential = clamp(Math.max(legacyPotential ?? 0, player.rating), player.rating, 99);
  return { migrated: true, player };
}

/**
 * Make sure the player is on the v2 model, migrating when needed.
 * Players without attributes (career intro unfinished) are returned unchanged.
 */
export function ensurePlayerModel(player, opts = {}) {
  if (!player) return player;
  if (!isPlayerV2(player)) migratePlayerToV2(player, opts);
  return player;
}
