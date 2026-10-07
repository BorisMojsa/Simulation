import { POSITION_PROFILES } from "../config/playerConfig.js";
import { clubNameForDisplay, clamp, randFloat, randInt } from "../utils/helpers.js";
import { academyNationOf, buildAcademyOfferStories } from "../data/academyOfferStories.js";
import { academyOfferWeight } from "../data/academyGeography.js";
import { agePerformanceModifier } from "./playerDevelopment.js?v=40";

/** Each offer slot prefers a home club this often when home clubs exist. */
const HOME_SLOT_CHANCE = 0.9;

/** Map player nationality labels onto league `nation` values when they differ. */
const NATION_ALIASES = {
  USA: ["United States"],
  "United States of America": ["United States"],
  Türkiye: ["Turkey"],
  Czechia: ["Czech Republic"],
  Holland: ["Netherlands"],
};

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function nationalityMatches(academyNation, playerNationality) {
  if (!academyNation || !playerNationality) return false;
  if (academyNation === playerNationality) return true;
  const aliases = NATION_ALIASES[playerNationality] || [];
  if (aliases.includes(academyNation)) return true;
  for (const [key, vals] of Object.entries(NATION_ALIASES)) {
    if (vals.includes(playerNationality) && (key === academyNation || vals.includes(academyNation))) {
      return true;
    }
  }
  return false;
}

function uniqueByParent(list) {
  const out = [];
  const seen = new Set();
  for (const a of list) {
    const p = a.parentClub?.name ?? a.name;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(a);
  }
  return out;
}

function pickWeighted(list, weightFn) {
  if (!list.length) return null;
  let total = 0;
  const weights = list.map((item) => {
    const w = Math.max(0, weightFn(item));
    total += w;
    return w;
  });
  if (total <= 0) return list[Math.floor(Math.random() * list.length)];
  let r = Math.random() * total;
  for (let i = 0; i < list.length; i++) {
    r -= weights[i];
    if (r <= 0) return list[i];
  }
  return list[list.length - 1];
}

/**
 * Prefer home-nation academies ~90% per slot when available.
 * Non-home fills use geographic weighting (nearby >> distant).
 * Returns enriched offer objects: { academy, isHome, arrivalStory, pitch }.
 */
export function pickThreeAcademies(pool, nationality = null, playerName = "") {
  const all = uniqueByParent(pool || []);
  if (!all.length) return [];

  const home = all.filter((a) => nationalityMatches(academyNationOf(a), nationality));
  const abroad = all.filter((a) => !nationalityMatches(academyNationOf(a), nationality));
  const remaining = new Set(all);
  const picked = [];

  const take = (academy) => {
    if (!academy) return;
    const key = academy.parentClub?.name ?? academy.name;
    for (const item of remaining) {
      if ((item.parentClub?.name ?? item.name) === key) remaining.delete(item);
    }
    picked.push(academy);
  };

  const remainingOf = (subset) => subset.filter((a) => remaining.has(a));

  for (let slot = 0; slot < 3; slot++) {
    const homeLeft = remainingOf(home);
    const abroadLeft = remainingOf(abroad);
    let choice = null;

    if (homeLeft.length && Math.random() < HOME_SLOT_CHANCE) {
      choice = pickWeighted(homeLeft, () => 1);
    } else if (abroadLeft.length) {
      choice = pickWeighted(abroadLeft, (a) =>
        academyOfferWeight(nationality, academyNationOf(a), { isHome: false })
      );
    } else if (homeLeft.length) {
      choice = pickWeighted(homeLeft, () => 1);
    } else {
      choice = pickWeighted([...remaining], (a) =>
        academyOfferWeight(nationality, academyNationOf(a), {
          isHome: nationalityMatches(academyNationOf(a), nationality),
        })
      );
    }

    if (!choice) break;
    take(choice);
  }

  const filler = shuffle([...remaining]);
  for (const next of filler) {
    if (picked.length >= 3) break;
    take(next);
  }

  return picked.slice(0, 3).map((academy) => {
    const isHome = nationalityMatches(academyNationOf(academy), nationality);
    const stories = buildAcademyOfferStories(academy, {
      name: playerName || "You",
      nationality: nationality || "home",
      isHome,
    });
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
 */
export function buildNarrativeAcademySeason(player, ratingBeforeDecisions, ratingAfterDecisions) {
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

  return {
    seasonNumber: 1,
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
    standing: null,
    honors: "Academy programme",
    europeanCampaign: null,
    domesticCupResult: null,
    individualAwards: [],
    trophies: [],
    isNarrativeAcademyYear: true,
  };
}
