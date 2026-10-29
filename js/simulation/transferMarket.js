/**
 * Transfer market facade — all offers route through the shared deal pipeline.
 */
import { calculateContractLength } from "./playerValuation.js";
import {
  generatePipelineOffers,
  acceptPipelineOffer,
  buildValidatedOffer,
} from "./dealPipeline.js";
import { getOrInitClubSeasonFinance } from "./clubFinance.js";
import { LEAGUE_LOOKUP } from "../data/leagues.js";
import { findSeniorClub } from "./seniorClubs.js";
import { createStreamRng } from "./rng.js";

export { calculateContractLength } from "./playerValuation.js";

/** @deprecated Prefer sporting fit via recruitmentModel; kept for tests/compat. */
export function financialTierRequirement(rating) {
  if (rating >= 90) return 5;
  if (rating >= 84) return 4;
  if (rating >= 76) return 3;
  if (rating >= 68) return 2;
  return 1;
}

export function calculateRenewalInterest(player, performanceScore) {
  let interest = (performanceScore - 50) / 50;
  interest += (player.rating - 60) / 100;
  if (player.age >= 35) interest -= (player.age - 34) * 0.1;
  return interest > 0.3 ? Math.min(1, interest) : 0;
}

export function generateRenewalOffer(player, performanceScore, leagueLookup = LEAGUE_LOOKUP) {
  if (!player.club || player.club.isAcademy) return null;
  // Route through the shared pipeline so renewal review + employer club are authoritative.
  const result = generatePipelineOffers(player, {
    performanceScore,
    forceGenerate: true,
    rng: createStreamRng(player.careerId || player.name, `renewal:${player.seasons?.length ?? 0}`),
  });
  return (result.offers || []).find((o) => o.isRenewal) || null;
}

/**
 * Generate transfer offers (shared pipeline). Zero offers is valid.
 */
export function generateTransferOffers(
  performanceScore,
  player,
  leagues,
  leagueLookup,
  avgMatchRating = null
) {
  let perf = performanceScore;
  if (avgMatchRating != null) {
    if (avgMatchRating >= 8.0) perf += 12;
    else if (avgMatchRating >= 7.5) perf += 6;
    else if (avgMatchRating < 6.3) perf -= 10;
  }

  const result = generatePipelineOffers(player, {
    performanceScore: perf,
    leagues,
    forceGenerate: false,
  });

  // Ensure ledgers exist for involved clubs (lazy init; no spend on generation).
  for (const offer of result.offers) {
    if (offer.clubId) {
      getOrInitClubSeasonFinance(
        offer.clubId,
        String((player.startYear || 2026) + (player.seasons?.length ?? 0))
      );
    }
  }

  player.lastOfferRejectionLog = result.rejectionLog;
  player.lastEligibleOfferCount = result.eligibleCount;
  player.lastMarketDiagnostics = result.diagnostics || null;
  player.lastMarketReviewId = result.reviewId || null;
  // Do not close the free-agent review on generation/rerender — settlement
  // (decline window, Continue, or train/wait) closes it exactly once.
  return result.offers;
}

export function acceptTransferOffer(player, offer) {
  return acceptPipelineOffer(player, offer);
}
