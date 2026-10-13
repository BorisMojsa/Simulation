import { normalizeName } from "./normalize.js";
import {
  CLUB_PROFILES,
  CLUB_ALIAS_INDEX,
  CLUB_STRENGTH_SNAPSHOT_DATE,
} from "../strength/clubProfiles.generated.js?v=59";
import { getNationProfile } from "../strength/nationProfiles.js?v=59";

const byId = new Map(CLUB_PROFILES.map((p) => [p.clubId, p]));

function normalizeLight(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getClubProfileById(clubId) {
  return byId.get(clubId) || null;
}

function lookupAlias(key, nationHint) {
  if (!key) return null;
  if (nationHint) {
    const scoped = CLUB_ALIAS_INDEX[`${normalizeLight(nationHint)}::${key}`];
    if (scoped && !String(scoped).startsWith("__ambiguous__")) return scoped;
  }
  const hit = CLUB_ALIAS_INDEX[key];
  if (!hit) return null;
  if (String(hit).startsWith("__ambiguous__")) {
    return { ambiguous: true, ids: hit.replace("__ambiguous__:", "").split("|") };
  }
  return hit;
}

/**
 * Resolve a club by id, name, or alias.
 * Ambiguous matches return a diagnostic instead of silently picking one.
 */
export function resolveClub(ref, { nationHint = null } = {}) {
  if (!ref) {
    return { ok: false, reason: "empty_ref", profile: null };
  }
  if (typeof ref === "object") {
    if (ref.clubId && byId.has(ref.clubId)) {
      return { ok: true, profile: byId.get(ref.clubId), via: "clubId" };
    }
    if (ref.isNation || ref.isBye) {
      return { ok: false, reason: "not_a_club", profile: null, ref };
    }
    const name = ref.name || ref.displayName;
    const hint = nationHint || ref.nation || null;
    if (name) return resolveClub(name, { nationHint: hint });
    return { ok: false, reason: "object_without_name", profile: null };
  }

  const raw = String(ref);
  if (byId.has(raw)) return { ok: true, profile: byId.get(raw), via: "clubId" };

  const soft = normalizeName(raw);
  const light = normalizeLight(raw);
  for (const key of [soft, light]) {
    const hit = lookupAlias(key, nationHint);
    if (hit && hit.ambiguous) {
      return {
        ok: false,
        reason: "ambiguous_club",
        profile: null,
        diagnostic: `Ambiguous club name "${raw}" maps to ${hit.ids.join(" and ")}. Pass nationHint or clubId.`,
      };
    }
    if (hit && byId.has(hit)) return { ok: true, profile: byId.get(hit), via: "alias" };
  }

  return {
    ok: false,
    reason: "unresolved_club",
    profile: null,
    diagnostic: `No club profile for "${raw}".`,
  };
}

export function resolveNation(ref) {
  if (!ref) return { ok: false, reason: "empty_ref", profile: null };
  const name = typeof ref === "object" ? ref.name || ref.displayName : ref;
  const profile = getNationProfile(name);
  if (!profile) {
    return {
      ok: false,
      reason: "unresolved_nation",
      profile: null,
      diagnostic: `No nation profile for "${name}".`,
    };
  }
  return { ok: true, profile, via: "name" };
}

export function assertAllLeaguesCovered(leagues) {
  const missing = [];
  for (const league of leagues || []) {
    for (const club of league.clubs || []) {
      const r = resolveClub(club.name, { nationHint: league.nation });
      if (!r.ok) missing.push({ league: league.name, club: club.name, diagnostic: r.diagnostic });
    }
  }
  return missing;
}

export function clubStrengthMeta() {
  return {
    clubs: CLUB_PROFILES.length,
    snapshotDate: CLUB_STRENGTH_SNAPSHOT_DATE,
  };
}

export { CLUB_PROFILES, CLUB_ALIAS_INDEX, CLUB_STRENGTH_SNAPSHOT_DATE };
