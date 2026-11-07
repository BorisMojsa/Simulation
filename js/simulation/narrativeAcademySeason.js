import { POSITION_PROFILES } from "../config/playerConfig.js";
import { clubNameForDisplay, clamp, randFloat, randInt } from "../utils/helpers.js";
import { academyNationOf, buildAcademyOfferStories } from "../data/academyOfferStories.js";
import { academyOfferWeight } from "../data/academyGeography.js";
import { agePerformanceModifier } from "./playerDevelopment.js?v=60";
import { createRng } from "./rng.js";

/** Slot-3 abroad chance when ≥3 domestic parents and an abroad pool exist. */
export const ABROAD_SLOT_CHANCE_MINOR = 0.271;
export const ABROAD_SLOT_CHANCE_ADULT = 0.65;

/** Map player/destination labels onto canonical nation values used for matching and geography. */
const NATION_CANONICAL = {
  usa: "United States",
  "united states of america": "United States",
  "united states": "United States",
  türkiye: "Turkey",
  turkey: "Turkey",
  czechia: "Czech Republic",
  "czech republic": "Czech Republic",
  holland: "Netherlands",
  netherlands: "Netherlands",
  "korea republic": "South Korea",
  "south korea": "South Korea",
};

function normalizeNationKey(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Canonical nation label for matching and geography. Does not rewrite player identity. */
export function canonicalizeNation(raw) {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const mapped = NATION_CANONICAL[normalizeNationKey(trimmed)];
  if (mapped) return mapped;
  // Preserve original casing for already-canonical labels; match case-insensitively via key only.
  return trimmed;
}

function nationsMatch(a, b) {
  const ca = canonicalizeNation(a);
  const cb = canonicalizeNation(b);
  if (!ca || !cb) return false;
  return normalizeNationKey(ca) === normalizeNationKey(cb);
}

function normalizeParentName(name) {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function legacyParentKey(entry) {
  const name = entry?.parentClub?.name ?? entry?.name;
  const nation = canonicalizeNation(academyNationOf(entry));
  if (!normalizeParentName(name) || !nation) return null;
  return `${normalizeParentName(name)}|${normalizeNationKey(nation)}`;
}

function hasUsableParentIdentity(entry) {
  const id = entry?.parentClub?.clubId;
  if (id != null && String(id).trim() !== "") return true;
  const name = entry?.parentClub?.name ?? entry?.name;
  return Boolean(String(name ?? "").trim());
}

function isEligibleAcademy(entry) {
  if (!entry || entry.isAcademy !== true) return false;
  if (!hasUsableParentIdentity(entry)) return false;
  const nation = academyNationOf(entry);
  return Boolean(String(nation ?? "").trim());
}

function parentClubId(entry) {
  const id = entry?.parentClub?.clubId;
  if (id == null || String(id).trim() === "") return null;
  return String(id);
}

/**
 * Deduplicate eligible academy rows by senior parent clubId, with a name+nation
 * fallback for legacy rows. Never collapses two different IDs. Does not mutate inputs.
 */
export function dedupeEligibleAcademies(pool) {
  const eligible = [];
  for (const row of pool || []) {
    if (isEligibleAcademy(row)) eligible.push(row);
  }

  const byId = new Map(); // id -> first richer row
  const idOrder = [];
  const legacyOnly = []; // rows without clubId, in order
  const idsByLegacy = new Map(); // legacyKey -> Set<id>

  for (const row of eligible) {
    const id = parentClubId(row);
    const legacy = legacyParentKey(row);
    if (id) {
      if (!byId.has(id)) {
        byId.set(id, row);
        idOrder.push(id);
      }
      if (legacy) {
        if (!idsByLegacy.has(legacy)) idsByLegacy.set(legacy, new Set());
        idsByLegacy.get(legacy).add(id);
      }
    } else {
      legacyOnly.push(row);
    }
  }

  const out = idOrder.map((id) => byId.get(id));
  const seenLegacy = new Set();

  for (const row of legacyOnly) {
    const legacy = legacyParentKey(row);
    if (!legacy) continue;
    if (seenLegacy.has(legacy)) continue;
    const matchingIds = idsByLegacy.get(legacy);
    if (matchingIds && matchingIds.size === 1) {
      // Collapse into the single ID-bearing parent; richer row already kept.
      seenLegacy.add(legacy);
      continue;
    }
    if (matchingIds && matchingIds.size > 1) {
      // Ambiguous name match across distinct IDs — do not collapse or invent a fourth.
      seenLegacy.add(legacy);
      continue;
    }
    seenLegacy.add(legacy);
    out.push(row);
  }

  return out;
}

function resolveOfferAge(age) {
  const n = Number(age);
  if (!Number.isFinite(n)) return 16;
  const floored = Math.floor(n);
  if (floored < 15 || floored > 19) return 16;
  return floored;
}

function abroadSlotChanceForAge(age) {
  return age >= 18 ? ABROAD_SLOT_CHANCE_ADULT : ABROAD_SLOT_CHANCE_MINOR;
}

function freshEntropySeed() {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return (buf[0] >>> 0) || 1;
}

function resolveOfferSeed(seed) {
  if (seed == null || seed === "") return freshEntropySeed();
  const n = Number(seed);
  if (!Number.isFinite(n)) return freshEntropySeed();
  return (n >>> 0) || 1;
}

function pickUniform(list, rng) {
  if (!list.length) return null;
  return list[Math.floor(rng.random() * list.length)];
}

function pickWeightedNations(nations, weightFn, rng) {
  if (!nations.length) return null;
  let total = 0;
  const weights = nations.map((n) => {
    const w = Math.max(0, weightFn(n));
    total += w;
    return w;
  });
  if (total <= 0) return pickUniform(nations, rng);
  let r = rng.random() * total;
  for (let i = 0; i < nations.length; i++) {
    r -= weights[i];
    if (r <= 0) return nations[i];
  }
  return nations[nations.length - 1];
}

function knownDivision(entry) {
  const d = entry?.parentClub?.divisionLevel;
  return Number.isFinite(d) ? d : null;
}

function takeDomesticSecond(first, remainingDomestic, rng) {
  if (!remainingDomestic.length) return null;
  const firstDiv = knownDivision(first);
  if (firstDiv != null) {
    const alt = remainingDomestic.filter((a) => {
      const d = knownDivision(a);
      return d != null && d !== firstDiv;
    });
    if (alt.length) return pickUniform(alt, rng);
  }
  return pickUniform(remainingDomestic, rng);
}

function pickAbroadClub(remainingAbroad, playerCanon, usedNations, rng) {
  if (!remainingAbroad.length) return null;
  const byNation = new Map();
  for (const a of remainingAbroad) {
    const n = canonicalizeNation(academyNationOf(a));
    if (!n) continue;
    const key = normalizeNationKey(n);
    if (!byNation.has(key)) byNation.set(key, { label: n, clubs: [] });
    byNation.get(key).clubs.push(a);
  }
  let keys = [...byNation.keys()];
  if (!keys.length) return null;
  const unused = keys.filter((k) => !usedNations.has(k));
  if (unused.length) keys = unused;

  const chosenKey = pickWeightedNations(
    keys,
    (k) => academyOfferWeight(playerCanon, byNation.get(k).label, { isHome: false }),
    rng
  );
  if (!chosenKey) return null;
  const group = byNation.get(chosenKey);
  return pickUniform(group.clubs, rng);
}

/**
 * Select up to three opening academy offers.
 * Keeps the three-argument call working. Optional fourth arg: `{ age, seed }`.
 * Returns enriched offer objects: `{ academy, isHome, arrivalStory, pitch }`.
 */
export function pickThreeAcademies(pool, nationality = null, playerName = "", opts = {}) {
  const options = opts && typeof opts === "object" ? opts : {};
  const age = resolveOfferAge(options.age);
  const seed = resolveOfferSeed(options.seed);
  const rng = createRng(seed);

  const all = dedupeEligibleAcademies(pool);
  if (!all.length) return [];

  const playerCanon = canonicalizeNation(nationality);
  const home = all.filter((a) => nationsMatch(academyNationOf(a), nationality));
  const abroad = all.filter((a) => !nationsMatch(academyNationOf(a), nationality));

  const remaining = new Set(all);
  const picked = [];
  const usedAbroadNations = new Set();

  const remainingOf = (subset) => subset.filter((a) => remaining.has(a));

  const take = (academy) => {
    if (!academy || !remaining.has(academy)) return;
    remaining.delete(academy);
    picked.push(academy);
    if (!nationsMatch(academyNationOf(academy), nationality)) {
      const n = canonicalizeNation(academyNationOf(academy));
      if (n) usedAbroadNations.add(normalizeNationKey(n));
    }
  };

  const domesticCount = home.length;
  const targetCount = Math.min(3, all.length);

  if (domesticCount >= 3) {
    const first = pickUniform(remainingOf(home), rng);
    take(first);
    const second = takeDomesticSecond(first, remainingOf(home), rng);
    take(second);
    const abroadLeft = remainingOf(abroad);
    const homeLeft = remainingOf(home);
    if (abroadLeft.length && rng.random() < abroadSlotChanceForAge(age)) {
      take(pickAbroadClub(abroadLeft, playerCanon, usedAbroadNations, rng));
    } else if (homeLeft.length) {
      take(pickUniform(homeLeft, rng));
    } else if (abroadLeft.length) {
      take(pickAbroadClub(abroadLeft, playerCanon, usedAbroadNations, rng));
    }
  } else if (domesticCount === 2) {
    const first = pickUniform(remainingOf(home), rng);
    take(first);
    const second = takeDomesticSecond(first, remainingOf(home), rng);
    take(second);
    const abroadLeft = remainingOf(abroad);
    if (abroadLeft.length) {
      take(pickAbroadClub(abroadLeft, playerCanon, usedAbroadNations, rng));
    }
  } else if (domesticCount === 1) {
    take(home[0]);
    while (picked.length < targetCount) {
      const abroadLeft = remainingOf(abroad);
      if (!abroadLeft.length) break;
      take(pickAbroadClub(abroadLeft, playerCanon, usedAbroadNations, rng));
    }
  } else {
    while (picked.length < targetCount) {
      const abroadLeft = remainingOf(abroad.length ? abroad : all);
      if (!abroadLeft.length) break;
      take(pickAbroadClub(abroadLeft, playerCanon, usedAbroadNations, rng));
    }
  }

  // Sparse pools: fill any shortfall from remaining distinct parents without replacement.
  while (picked.length < targetCount) {
    const left = [...remaining];
    if (!left.length) break;
    const homeLeft = left.filter((a) => nationsMatch(academyNationOf(a), nationality));
    const abroadLeft = left.filter((a) => !nationsMatch(academyNationOf(a), nationality));
    if (abroadLeft.length) {
      take(pickAbroadClub(abroadLeft, playerCanon, usedAbroadNations, rng));
    } else if (homeLeft.length) {
      take(pickUniform(homeLeft, rng));
    } else {
      take(pickUniform(left, rng));
    }
  }

  return picked.slice(0, targetCount).map((academy) => {
    const isHome = nationsMatch(academyNationOf(academy), nationality);
    const stories = buildAcademyOfferStories(
      academy,
      {
        name: playerName || "You",
        nationality: nationality || "home",
        isHome,
      },
      rng
    );
    return {
      academy,
      isHome,
      arrivalStory: stories.arrivalStory,
      pitch: stories.pitch,
    };
  });
}

/**
 * Lightweight academy year record — no league/cup/Europe simulation.
 * @param {object} [opts]
 * @param {number} [opts.seasonNumber] — sequence in career history (default 1 for opening)
 * @param {number} [opts.year] — calendar year label
 * @param {string} [opts.periodId]
 * @param {boolean} [opts.academyPeriod] — continuation marker (opening also sets narrative flag)
 */
export function buildNarrativeAcademySeason(player, ratingBeforeDecisions, ratingAfterDecisions, opts = {}) {
  const profile = POSITION_PROFILES[player.position] || POSITION_PROFILES.DEFAULT;
  const matches = randInt(18, 28);
  const ri = clamp(ratingAfterDecisions / 100, 0.5, 0.95);
  const am = agePerformanceModifier(player.age);
  const form = randFloat(0.82, 1.12);

  const goals = Math.round(matches * profile.goalRate * ri * am * form * randFloat(0.75, 1.2));
  const assists = Math.round(matches * profile.assistRate * ri * am * form * randFloat(0.75, 1.2));
  const cleanSheets = Math.round(matches * profile.cleanSheetRate * ri * form * randFloat(0.75, 1.15));

  const avgMatchRating = clamp(
    parseFloat(
      (
        6.1 +
        (ratingAfterDecisions - 58) * 0.038 +
        ((goals + assists) / Math.max(1, matches)) * 0.45 +
        randFloat(-0.35, 0.35)
      ).toFixed(2)
    ),
    5.4,
    8.2
  );

  const ratingChange = ratingAfterDecisions - ratingBeforeDecisions;
  const seasonNumber =
    Number.isFinite(opts.seasonNumber) && opts.seasonNumber > 0
      ? opts.seasonNumber
      : 1;

  return {
    seasonNumber,
    seasonId: opts.periodId || `academy-narrative-${seasonNumber}`,
    year: Number.isFinite(opts.year) ? opts.year : undefined,
    age: player.age,
    club: player.club.name,
    clubDisplay: clubNameForDisplay(player.club),
    league: player.club.league,
    leagueDisplay: player.club.leagueDisplay ?? player.club.league,
    badge: player.club.badge,
    matches,
    goals,
    assists,
    cleanSheets,
    avgMatchRating,
    ratingChange,
    ratingAfter: ratingAfterDecisions,
    ratingBefore: ratingBeforeDecisions,
    standing: null,
    honors: "Academy programme",
    europeanCampaign: null,
    domesticCupResult: null,
    individualAwards: [],
    trophies: [],
    isNarrativeAcademyYear: true,
    academyPeriod: Boolean(opts.academyPeriod) || seasonNumber > 1,
    activityKind: "academy-narrative",
    // Explicit: these are not Premier League / senior match-ledger observations.
    seniorAppearances: 0,
    seniorMinutes: 0,
  };
}
