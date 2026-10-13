import { rivalsForClub } from "../data/clubRivals.js";
import { allSeniorClubs, findSeniorClub } from "./seniorClubs.js";
import { buildValidatedOffer, applyOfferToPlayer, acceptPipelineOffer } from "./dealPipeline.js";
import { evaluateSportingFit } from "./recruitmentModel.js";
import { createStreamRng } from "./rng.js";
import { safePlayerOverall } from "./playerOverallSafe.js";
import { calculateContractLength } from "./playerValuation.js";

export { allSeniorClubs, findSeniorClub } from "./seniorClubs.js";

function parentOfferChance(rating) {
  if (rating >= 74) return 0.97;
  if (rating >= 68) return 0.9;
  if (rating >= 62) return 0.78;
  if (rating >= 58) return 0.62;
  return 0.42;
}

function counterOfferCount(rating, rng) {
  if (rating >= 72) return rng.chance(0.55) ? 2 : 1;
  if (rating >= 64) return rng.chance(0.65) ? 1 : rng.chance(0.35) ? 2 : 0;
  if (rating >= 58) return rng.chance(0.45) ? 1 : 0;
  return rng.chance(0.25) ? 1 : 0;
}

/**
 * After academy moments: parent / rival / counter offers via shared pipeline.
 * No random famous-club fallback that bypasses constraints.
 */
export function buildFirstProContractDecision(player) {
  const parent = player.club?.parentClub ? findSeniorClub(player.club.parentClub.name) : null;
  const rating = safePlayerOverall(player);
  const performanceHint = Math.round(58 + (rating - 54) * 1.1);
  const careerId = player.careerId || player.name || "career";
  const rng = createStreamRng(careerId, `first-pro:${rating}`);
  const clubs = allSeniorClubs();
  const offers = [];
  const rejectionLog = [];

  const parentOffers = parent && rng.chance(parentOfferChance(rating));
  if (parentOffers && parent) {
    const built = buildValidatedOffer({
      player,
      club: parent,
      dealType: "first_pro",
      performanceScore: performanceHint,
      rng,
      forceParent: true,
    });
    if (built.ok) {
      offers.push({
        kind: "parent",
        club: parent,
        blurb: built.offer.message,
        contractYears: built.offer.contractYears,
        performanceHint,
        offer: built.offer,
        wage: built.offer.wage,
        expectedRole: built.offer.expectedRole,
      });
    } else {
      rejectionLog.push({ clubId: parent.clubId, reasons: built.reasons });
    }
  }

  const rivalChance = rating >= 70 ? 0.16 : rating >= 64 ? 0.1 : 0.05;
  if (parent && rng.chance(rivalChance)) {
    const rivalNames = rivalsForClub(parent.name).filter((n) => n !== parent.name);
    const rivalClub = rng.pick(rivalNames.map(findSeniorClub).filter(Boolean));
    if (rivalClub && !offers.some((o) => o.club.name === rivalClub.name)) {
      const built = buildValidatedOffer({
        player,
        club: rivalClub,
        dealType: "first_pro",
        performanceScore: performanceHint + 2,
        rng,
      });
      if (built.ok) {
        offers.push({
          kind: "rival",
          club: rivalClub,
          blurb: `${rivalClub.displayName} have been watching. A senior contract is on the table. Crossing that line will not go unnoticed.`,
          contractYears: built.offer.contractYears,
          performanceHint: performanceHint + 2,
          offer: built.offer,
          wage: built.offer.wage,
          expectedRole: built.offer.expectedRole,
        });
      } else {
        rejectionLog.push({ clubId: rivalClub.clubId, reasons: built.reasons });
      }
    }
  }

  const needed = Math.max(counterOfferCount(rating, rng), offers.length ? 0 : 1);
  const exclude = new Set(offers.map((o) => o.club.name));
  if (parent) exclude.add(parent.name);

  // Sporting-eligible counters only — prefer same league/nation.
  const sameLeague = clubs.filter((c) => c.league === parent?.league && !exclude.has(c.name));
  const sameNation = clubs.filter((c) => c.nation === parent?.nation && !exclude.has(c.name));
  const pool = [...sameLeague, ...sameNation, ...clubs.filter((c) => !exclude.has(c.name))];

  let added = 0;
  for (const club of pool) {
    if (added >= needed) break;
    if (exclude.has(club.name)) continue;
    const fit = evaluateSportingFit(player, club, {
      seasonIndex: player.seasons?.length ?? 0,
      careerId,
      relaxedDevelopment: true,
    });
    if (!fit.eligible) {
      rejectionLog.push({ clubId: club.clubId, reasons: ["sporting-ineligible"] });
      continue;
    }
    const built = buildValidatedOffer({
      player,
      club,
      fit,
      dealType: "first_pro",
      performanceScore: performanceHint,
      rng,
    });
    if (!built.ok) {
      rejectionLog.push({ clubId: club.clubId, reasons: built.reasons });
      continue;
    }
    exclude.add(club.name);
    offers.push({
      kind: "counter",
      club,
      blurb: built.offer.message,
      contractYears: built.offer.contractYears,
      performanceHint,
      offer: built.offer,
      wage: built.offer.wage,
      expectedRole: built.offer.expectedRole,
    });
    added += 1;
  }

  // Usable continuation without manufacturing an elite offer.
  const verdict = offers.some((o) => o.kind === "parent")
    ? {
        headline: "The call from upstairs",
        lead: `${parent.displayName} are prepared to put a senior professional contract in front of you.`,
      }
    : offers.length
      ? {
          headline: "No first-team deal from the academy side",
          lead: parent
            ? `${parent.displayName} will not open a senior deal today. Other doors that fit your level may still open.`
            : "The academy chapter ends without a home senior deal. Suitable clubs are circling.",
        }
      : {
          headline: "No professional offer yet",
          lead: parent
            ? `${parent.displayName} are not ready to offer terms that fit. You can continue training, seek another pathway, or wait for a suitable club.`
            : "No suitable professional contract is available today. Your career can continue via training and later free-agent interest.",
        };

  return {
    parentOffers: offers.some((o) => o.kind === "parent"),
    parent,
    offers,
    verdict,
    rating,
    rejectionLog,
    emptyOffers: offers.length === 0,
  };
}

/** Move the player onto a senior club with a first pro contract. */
export function signFirstProfessionalContract(player, deal) {
  const offer = deal?.offer;
  if (offer) {
    const result = acceptPipelineOffer(player, { ...offer, isParentOffer: deal.kind === "parent" });
    if (result.ok) return player.club.displayName ?? player.club.name;
  }

  const club = deal?.club;
  if (!club) return null;

  // Fallback path still uses validated terms when possible.
  const built = buildValidatedOffer({
    player,
    club,
    dealType: "first_pro",
    performanceScore: deal.performanceHint ?? 72,
    forceParent: deal.kind === "parent",
  });
  if (built.ok) {
    acceptPipelineOffer(player, { ...built.offer, isParentOffer: deal.kind === "parent" });
    return player.club.displayName ?? player.club.name;
  }

  // Last resort: sign with wage inside club bands without inventing a fee.
  applyOfferToPlayer(
    player,
    {
      ...club,
      club: club.name,
      clubDisplay: club.displayName ?? club.name,
      wage: deal.wage || 1500,
      transferFee: 0,
      contractYears:
        deal.contractYears ||
        calculateContractLength(player.age, player.rating, player.potential, deal.performanceHint ?? 72),
      expectedRole: deal.expectedRole || "prospect",
      isFreeAgent: true,
      dealType: "first_pro",
    },
    `tx:first-pro-fallback:${club.clubId}`
  );
  return player.club.displayName ?? player.club.name;
}
