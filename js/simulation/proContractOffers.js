import { LEAGUES } from "../data/leagues.js";
import { rivalsForClub } from "../data/clubRivals.js";
import { calculateContractLength } from "./transferMarket.js";
import { pickRandom, randInt } from "../utils/helpers.js";

/** Flatten senior clubs with league metadata. */
export function allSeniorClubs() {
  return LEAGUES.flatMap((league) =>
    league.clubs.map((club) => ({
      name: club.name,
      displayName: club.displayName ?? club.name,
      badge: club.badge,
      financialTier: club.financialTier,
      tier: league.tier,
      league: league.name,
      leagueDisplay: league.displayName,
      nation: league.nation,
    }))
  );
}

export function findSeniorClub(clubName) {
  if (!clubName) return null;
  return allSeniorClubs().find((c) => c.name === clubName || c.displayName === clubName) ?? null;
}

function parentOfferChance(rating) {
  if (rating >= 74) return 0.97;
  if (rating >= 68) return 0.9;
  if (rating >= 62) return 0.78;
  if (rating >= 58) return 0.62;
  return 0.42;
}

function counterOfferCount(rating) {
  if (rating >= 72) return Math.random() < 0.55 ? 2 : 1;
  if (rating >= 64) return Math.random() < 0.65 ? 1 : Math.random() < 0.35 ? 2 : 0;
  if (rating >= 58) return Math.random() < 0.45 ? 1 : 0;
  return Math.random() < 0.25 ? 1 : 0;
}

function buildDeal(club, { kind, blurb, performanceHint }) {
  const years = calculateContractLength(16, 60, 75, performanceHint);
  return {
    kind,
    club,
    blurb,
    contractYears: years,
    performanceHint,
  };
}

/**
 * After academy moments: decide if the parent offers a pro deal,
 * plus rare rival interest and other counter offers.
 */
export function buildFirstProContractDecision(player) {
  const parent = player.club?.parentClub ? findSeniorClub(player.club.parentClub.name) : null;
  const rating = player.rating;
  const performanceHint = Math.round(58 + (rating - 54) * 1.1);
  const clubs = allSeniorClubs();
  const offers = [];

  const parentOffers = parent && Math.random() < parentOfferChance(rating);
  if (parentOffers && parent) {
    offers.push(
      buildDeal(parent, {
        kind: "parent",
        blurb: `${parent.displayName} want you on a senior professional contract. The pathway you trained for is open.`,
        performanceHint,
      })
    );
  }

  // Rival interest: uncommon, more likely when rating is solid
  const rivalChance = rating >= 70 ? 0.16 : rating >= 64 ? 0.1 : 0.05;
  if (parent && Math.random() < rivalChance) {
    const rivalNames = rivalsForClub(parent.name).filter((n) => n !== parent.name);
    const rivalClub = pickRandom(rivalNames.map(findSeniorClub).filter(Boolean));
    if (rivalClub && !offers.some((o) => o.club.name === rivalClub.name)) {
      offers.push(
        buildDeal(rivalClub, {
          kind: "rival",
          blurb: `${rivalClub.displayName} have been watching the other side of town. A senior contract is on the table. Crossing that line will not go unnoticed.`,
          performanceHint: performanceHint + 2,
        })
      );
    }
  }

  const needed = Math.max(counterOfferCount(rating), parentOffers ? 0 : 1);
  const exclude = new Set(offers.map((o) => o.club.name));
  if (parent) exclude.add(parent.name);

  const sameNation = clubs.filter((c) => c.nation === parent?.nation && !exclude.has(c.name));
  const sameLeague = clubs.filter((c) => c.league === parent?.league && !exclude.has(c.name));
  const pool = [...sameLeague, ...sameNation, ...clubs.filter((c) => !exclude.has(c.name))];

  let added = 0;
  const used = new Set(exclude);
  while (added < needed && pool.length) {
    // Prefer closer clubs early in the list
    const idx = Math.min(pool.length - 1, Math.floor(Math.random() * Math.min(12, pool.length)));
    const club = pool.splice(idx, 1)[0];
    if (!club || used.has(club.name)) continue;
    used.add(club.name);
    offers.push(
      buildDeal(club, {
        kind: "counter",
        blurb: `${club.displayName} see a first-team project in you. They are ready to beat your academy side to the signature.`,
        performanceHint,
      })
    );
    added += 1;
  }

  // Absolute fallback so the player is never stuck
  if (!offers.length) {
    const fallback = pickRandom(clubs) || parent;
    if (fallback) {
      offers.push(
        buildDeal(fallback, {
          kind: "counter",
          blurb: `${fallback.displayName} offer a professional contract when others hesitate.`,
          performanceHint: Math.max(55, performanceHint - 4),
        })
      );
    }
  }

  const verdict = parentOffers
    ? {
        headline: "The call from upstairs",
        lead: `${parent.displayName} are prepared to put a senior professional contract in front of you.`,
      }
    : {
        headline: "No first-team deal yet",
        lead: parent
          ? `${parent.displayName} thank you for the academy year, but they will not open a senior deal today. Other doors may still open.`
          : "The academy chapter ends without a home senior deal. Other clubs are circling.",
      };

  return { parentOffers, parent, offers, verdict, rating };
}

/** Move the player onto a senior club with a first pro contract. */
export function signFirstProfessionalContract(player, deal) {
  const club = deal?.club;
  if (!club) return null;

  player.club = {
    name: club.name,
    displayName: club.displayName ?? club.name,
    league: club.league,
    leagueDisplay: club.leagueDisplay ?? club.league,
    tier: club.tier,
    badge: club.badge,
    financialTier: club.financialTier,
    isAcademy: false,
    parentClub: null,
  };

  const hint = deal.performanceHint ?? 72;
  const currentSeason = player.seasons.length;
  player.contractStartSeason = currentSeason;
  player.contractYears =
    deal.contractYears || calculateContractLength(player.age, player.rating, player.potential, hint);
  player.contractEndSeason = currentSeason + player.contractYears;
  player.pendingOffers = [];
  player.suppressParentContractOffer = true;
  return player.club.displayName ?? player.club.name;
}
