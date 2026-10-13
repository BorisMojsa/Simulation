/**
 * National-team sporting profiles (wrapper over generated snapshot).
 * Rebuild: node scripts/buildNationStrengthDb.mjs
 */
import { normalizeName, slugId } from "../identity/normalize.js";
import {
  NATION_PROFILES,
  NATION_STRENGTH_SNAPSHOT_DATE,
  NATION_STRENGTH_BASELINE_SNAPSHOT_ID,
  NATION_STRENGTH_TRANSFORM_VERSION,
  NATION_STRENGTH_CONTENT_HASH,
  NATION_STRENGTH_NORMALIZATION_VERSION,
} from "./nationProfiles.generated.js?v=59";

export {
  NATION_PROFILES,
  NATION_STRENGTH_SNAPSHOT_DATE,
  NATION_STRENGTH_BASELINE_SNAPSHOT_ID,
  NATION_STRENGTH_TRANSFORM_VERSION,
  NATION_STRENGTH_CONTENT_HASH,
  NATION_STRENGTH_NORMALIZATION_VERSION,
};

export const NATION_PROFILE_BY_ID = new Map(NATION_PROFILES.map((p) => [p.nationId, p]));
export const NATION_PROFILE_BY_NAME = new Map();
for (const p of NATION_PROFILES) {
  NATION_PROFILE_BY_NAME.set(normalizeName(p.name), p);
  for (const a of p.aliases || []) NATION_PROFILE_BY_NAME.set(normalizeName(a), p);
}

export function getNationProfile(nameOrId) {
  if (!nameOrId) return null;
  if (NATION_PROFILE_BY_ID.has(nameOrId)) return NATION_PROFILE_BY_ID.get(nameOrId);
  return NATION_PROFILE_BY_NAME.get(normalizeName(nameOrId)) || null;
}

// Keep slug helper available for callers that imported older shapes
void slugId;
