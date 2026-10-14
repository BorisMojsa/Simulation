/**
 * Continental qualification paths by association / league ID.
 * Simplified but coherent allocations — documented below.
 *
 * UEFA (simplified for this game):
 *   - Big-5 associations: CL 1–4, EL 5, UECL 6
 *   - Mid associations (PT, NL, BE, TR): CL 1–2, EL 3, UECL 4
 *   - Smaller UEFA associations in DB: CL 1, EL 2, UECL 3
 *
 * Bootstrap: first season uses prior-season standings when present in world state;
 * otherwise current simulated table (documented bootstrap policy).
 */

import { normalizeName } from "../identity/normalize.js";

/** Light normalize for stable IDs (keeps FC/SC tokens). */
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

export const ASSOCIATION_IDS = {
  England: "assoc:england",
  Spain: "assoc:spain",
  Germany: "assoc:germany",
  Italy: "assoc:italy",
  France: "assoc:france",
  Portugal: "assoc:portugal",
  Netherlands: "assoc:netherlands",
  Belgium: "assoc:belgium",
  Denmark: "assoc:denmark",
  Turkey: "assoc:turkey",
  Norway: "assoc:norway",
  Poland: "assoc:poland",
  "Czech Republic": "assoc:czech-republic",
  Czechia: "assoc:czech-republic",
  Croatia: "assoc:croatia",
  Serbia: "assoc:serbia",
  Brazil: "assoc:brazil",
  Argentina: "assoc:argentina",
  Colombia: "assoc:colombia",
  Ecuador: "assoc:ecuador",
  Mexico: "assoc:mexico",
  "United States": "assoc:united-states",
  "Saudi Arabia": "assoc:saudi-arabia",
  Japan: "assoc:japan",
  "South Korea": "assoc:south-korea",
  Egypt: "assoc:egypt",
  Morocco: "assoc:morocco",
};

/** league.name → stable leagueId (must match clubProfiles). */
export function leagueIdFromName(name) {
  const key = normalizeLight(name).replace(/\s+/g, "-");
  return `league:${key}`;
}

/**
 * UEFA association → slots. Keys are association IDs.
 * Verified: Serbia, Croatia, Czech Republic included.
 */
export const UEFA_ASSOCIATION_SLOTS = {
  "assoc:england": { cl: 4, el: 1, uecl: 1 },
  "assoc:spain": { cl: 4, el: 1, uecl: 1 },
  "assoc:germany": { cl: 4, el: 1, uecl: 1 },
  "assoc:italy": { cl: 4, el: 1, uecl: 1 },
  "assoc:france": { cl: 3, el: 1, uecl: 1 },
  "assoc:portugal": { cl: 2, el: 1, uecl: 1 },
  "assoc:netherlands": { cl: 2, el: 1, uecl: 1 },
  "assoc:belgium": { cl: 2, el: 1, uecl: 1 },
  "assoc:turkey": { cl: 2, el: 1, uecl: 1 },
  "assoc:denmark": { cl: 1, el: 1, uecl: 1 },
  "assoc:norway": { cl: 1, el: 1, uecl: 1 },
  "assoc:poland": { cl: 1, el: 1, uecl: 1 },
  "assoc:czech-republic": { cl: 1, el: 1, uecl: 1 },
  "assoc:croatia": { cl: 1, el: 1, uecl: 1 },
  "assoc:serbia": { cl: 1, el: 1, uecl: 1 },
};

/** Top-flight league names / IDs that feed UEFA club competitions. */
export const UEFA_TOP_FLIGHT_LEAGUE_IDS = new Set([
  "league:england-premier-league",
  "league:spain-la-liga",
  "league:germany-bundesliga",
  "league:italy-serie-a",
  "league:france-ligue-1",
  "league:portugal-primeira-liga",
  "league:netherlands-eredivisie",
  "league:belgium-belgian-pro-league",
  "league:denmark-superliga",
  "league:turkiye-super-lig",
  "league:norway-eliteserien",
  "league:poland-ekstraklasa",
  "league:czechia-czech-first-league",
  "league:croatia-hnl",
  "league:serbia-superliga",
]);

export const AFC_TOP_FLIGHT_LEAGUE_IDS = new Set([
  "league:saudi-arabia-saudi-pro-league",
  "league:japan-j1-league",
  "league:south-korea-k-league-1",
]);

export const CAF_TOP_FLIGHT_LEAGUE_IDS = new Set([
  "league:egypt-egyptian-premier-league",
  "league:morocco-botola-pro",
]);

export const AFC_ASSOCIATION_SLOTS = {
  "assoc:saudi-arabia": { elite: 3 },
  "assoc:japan": { elite: 3 },
  "assoc:south-korea": { elite: 3 },
};

export const CAF_ASSOCIATION_SLOTS = {
  "assoc:egypt": { cl: 2 },
  "assoc:morocco": { cl: 2 },
};

export function associationIdForNation(nation) {
  return ASSOCIATION_IDS[nation] || `assoc:${normalizeName(nation).replace(/\s+/g, "-")}`;
}

export function isUefaQualifyingLeague(league) {
  if (!league) return false;
  const id = league.leagueId || leagueIdFromName(league.name);
  return UEFA_TOP_FLIGHT_LEAGUE_IDS.has(id);
}

export function uefaSlotsForLeague(league) {
  if (!isUefaQualifyingLeague(league)) return null;
  const assoc = associationIdForNation(league.nation);
  return UEFA_ASSOCIATION_SLOTS[assoc] || { cl: 1, el: 1, uecl: 1 };
}

/**
 * Resolve continental entry from prior-season standing.
 * UEFA: prefer explicit qualification label; fall back to association slot by position
 * so pre-season proxies that omit the label still grant entry.
 * Entry is always scoped to the current playing league/association — never a prior club's table.
 */
export function continentalCompetitionForStanding(standing, league) {
  if (!standing || !league) return null;
  const nation = league.nation;
  const pos = Number(standing.position) || 0;
  const q = standing.qualification;
  const leagueId = league.leagueId || leagueIdFromName(league.name);

  if (isUefaQualifyingLeague(league)) {
    if (q === "League Champions" || q === "Champions League") return "Champions League";
    if (q === "Europa League") return "Europa League";
    if (q === "Conference League") return "Conference League";
    // Position fallback (same bands as qualificationForPosition)
    const slots = uefaSlotsForLeague(league) || { cl: 1, el: 1, uecl: 1 };
    if (pos >= 1 && pos <= slots.cl) return "Champions League";
    if (pos > slots.cl && pos <= slots.cl + slots.el) return "Europa League";
    if (pos > slots.cl + slots.el && pos <= slots.cl + slots.el + slots.uecl) {
      return "Conference League";
    }
    return null;
  }

  if (["Brazil", "Argentina", "Colombia", "Ecuador"].includes(nation)) {
    if (q === "League Champions" || pos <= 4) return "Copa Libertadores";
    if (pos <= 8) return "Copa Sudamericana";
    return null;
  }

  if (["Mexico", "United States"].includes(nation)) {
    if (q === "League Champions" || pos <= 4) return "CONCACAF Champions Cup";
    return null;
  }

  if (AFC_TOP_FLIGHT_LEAGUE_IDS.has(leagueId) || ["Saudi Arabia", "Japan", "South Korea"].includes(nation)) {
    const assoc = associationIdForNation(nation);
    const slots = AFC_ASSOCIATION_SLOTS[assoc] || { elite: 2 };
    if (q === "League Champions" || (pos >= 1 && pos <= slots.elite)) {
      return "AFC Champions League Elite";
    }
    return null;
  }

  if (CAF_TOP_FLIGHT_LEAGUE_IDS.has(leagueId) || ["Egypt", "Morocco"].includes(nation)) {
    const assoc = associationIdForNation(nation);
    const slots = CAF_ASSOCIATION_SLOTS[assoc] || { cl: 2 };
    if (q === "League Champions" || (pos >= 1 && pos <= slots.cl)) {
      return "CAF Champions League";
    }
    return null;
  }

  return null;
}

/**
 * Copa América eligible pool — CONMEBOL + optional invited CONCACAF guests.
 * Never pulls from AFC / random world pool.
 */
export const COPA_AMERICA_CORE = [
  "Argentina",
  "Brazil",
  "Uruguay",
  "Colombia",
  "Chile",
  "Peru",
  "Ecuador",
  "Paraguay",
  "Bolivia",
  "Venezuela",
];

export const COPA_AMERICA_INVITES = ["Mexico", "United States", "Canada", "Jamaica", "Panama", "Costa Rica"];
