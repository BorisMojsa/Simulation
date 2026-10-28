import assert from 'node:assert/strict';
import { buildAcademyBrowserFixture } from './js/simulation/academyBrowserFixture.js';
import {
  buildAndPersistAcademyReview,
  acceptAcademyGraduationOffer,
  declineAcademyReview,
} from './js/simulation/academyLifecycle.js';
import { buildFirstProContractDecision } from './js/simulation/proContractOffers.js';
import {
  getOrInitClubSeasonFinance,
  exportClubFinanceState,
} from './js/simulation/clubFinance.js';
import {
  selectNextCareerAction,
  isFreeAgent,
} from './js/simulation/contractLifecycle.js';
import { acceptPipelineOffer } from './js/simulation/dealPipeline.js';

function make() {
  const b = buildAcademyBrowserFixture({ mode: 'age21-final-offers' });
  assert.equal(b.ok, true, b.reason);
  return b.player;
}
const observations = {};
{
  const p = make();
  const review = buildAndPersistAcademyReview(p, {
    isFinal: true,
    offerProvider(player) {
      const d = buildFirstProContractDecision(player);
      assert(d.offers.length > 0);
      return { ...d, offers: d.offers.slice(0, 1) };
    },
  });
  const deal = review.offers[0];
  const ledger = getOrInitClubSeasonFinance(
    deal.offer.clubId,
    String(p.startYear + p.seasons.length),
  );
  ledger.remainingWageHeadroom = 0;
  const financeBefore = JSON.stringify(exportClubFinanceState());
  const result = acceptAcademyGraduationOffer(p, deal);
  assert.equal(result.ok, false);
  observations.exhaustedFinalOffer = {
    result,
    age: p.age,
    isAcademy: p.club?.isAcademy,
    freeAgent: isFreeAgent(p),
    pendingOffers: p.pendingOffers.length,
    status: p.academyLifecycle.status,
    nextAction: selectNextCareerAction(p),
    financesUnchanged: financeBefore === JSON.stringify(exportClubFinanceState()),
  };
}
{
  const p = make();
  const offer = structuredClone(p.pendingOffers[0]);
  const reviewId = p.academyLifecycle.pendingReviewId;
  const declined = declineAcademyReview(p);
  assert.equal(declined.released, true);
  const beforeReplay = {
    freeAgent: isFreeAgent(p),
    offerJournalEntry: p.offerJournal?.[offer.offerId] ?? null,
    reviewConsumed: p.academyLifecycle.consumedReviewIds.includes(reviewId),
  };
  const replay = acceptPipelineOffer(p, offer);
  observations.replayDeclinedFinalOffer = {
    beforeReplay,
    originalReviewId: offer.academyReviewId,
    accepted: replay.ok,
    reason: replay.reason ?? null,
    nowClub: p.club?.name,
    contractStatus: p.contractStatus,
    dealCount: p.completedDealIds?.length,
  };
}
console.log(JSON.stringify(observations, null, 2));
