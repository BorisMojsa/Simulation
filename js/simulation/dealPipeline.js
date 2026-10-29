/**
 * Shared recruitment / finance / contract validation pipeline.
 * Academy first contracts, renewals, permanent transfers, free agents,
 * pre-contracts and loans must all route through here.
 */
import { LEAGUES } from "../data/leagues.js";
import { allSeniorClubs, findSeniorClub, findSeniorClubById } from "./seniorClubs.js";
import {
  findEligibleClubs,
  pickWeighted,
  evaluateSportingFit,
  RECRUITMENT_CONFIG_VERSION,
} from "./recruitmentModel.js";
import {
  sellerReservation,
  buyerWillingness,
  negotiateFee,
  proposeWage,
  calculateContractLength,
  playerCurrentWeeklyWage,
  roundFee,
} from "./playerValuation.js";
import {
  getOrInitClubSeasonFinance,
  validateDealAffordability,
  bookDealTransaction,
  creditPlayerSale,
  weeklyToAnnual,
} from "./clubFinance.js";
import { createStreamRng } from "./rng.js";
import { safePlayerOverall } from "./playerOverallSafe.js";
import { FINANCE_PROFILE_VERSION } from "../data/clubFinanceProfiles.js";
import { resolveMoveRegistration } from "./destinationSchedule.js";
import {
  ensureContractAuthority,
  evaluateRenewalReview,
  employmentClubId,
  resolveEmploymentClub,
  isOfferExecutable,
  markOfferStatus,
  applyRenewalTerms,
  consumeRelatedDecisionAfterDeal,
  bumpContractRevision,
  completedSeasons,
  isFreeAgent,
} from "./contractLifecycle.js";
import { recordPlayingTransition, ensurePlayingStints } from "./playingRegistration.js";
import { CONTRACT_RULES } from "../config/recruitmentConfig.js";

/**
 * Career/league calendar date for an accepted deal when the offer omits dates.
 * Never uses the wall-clock; prefers checkpoint / season boundary.
 */
export function resolveDealSimulationDate(player, offer = {}) {
  return (
    offer.effectiveDate ||
    offer.reviewDate ||
    offer.acceptedAt ||
    offer.loanTerms?.startDate ||
    player?.seasonCheckpoint?.lastDate ||
    player?.pendingDecision?.date ||
    player?.decisionCheckpoint?.simulationDate ||
    // Next campaign start after completed seasons (typical free-agent / post-season signing).
    `${(player?.startYear || 2026) + (player?.seasons?.length ?? 0)}-07-01`
  );
}

export const DEAL_PIPELINE_VERSION = "deal-pipeline-v2";

function financialSeasonKey(player) {
  const idx = player.seasons?.length ?? 0;
  const year = (player.startYear || 2026) + idx;
  return `${year}`;
}

function clubPayload(club) {
  return {
    club: club.name,
    clubDisplay: club.displayName ?? club.name,
    clubId: club.clubId,
    badge: club.badge,
    league: club.league,
    leagueDisplay: club.leagueDisplay ?? club.league,
    leagueId: club.leagueId,
    nation: club.nation,
    tier: club.tier,
    divisionLevel: club.divisionLevel,
    financialTier: club.financialTier,
    reputation: club.reputation,
    overall: club.overall,
    attack: club.attack,
    midfield: club.midfield,
    defence: club.defence,
    goalkeeper: club.goalkeeper,
    strengthTier: club.strengthTier,
  };
}

function buildOfferMessage(club, dealType, role, sporting) {
  const name = club.displayName ?? club.name;
  const roleText = {
    starter: "as a likely starter",
    rotation: "in a rotation role",
    cover: "as squad cover",
    prospect: "on a development pathway",
  }[role] || "in the squad";

  if (dealType === "renewal") return `${name} want to extend your contract ${roleText}.`;
  if (dealType === "first_pro") {
    return `${name} are ready to offer a senior professional contract ${roleText}.`;
  }
  if (dealType === "loan") {
    const [lo, hi] = sporting.projection.minutesRange || [40, 70];
    return `${name} propose a loan ${roleText}, projecting roughly ${lo}–${hi}% of available club minutes.`;
  }
  if (dealType === "free_agent" || dealType === "pre_contract") {
    return `${name} offer a free transfer ${roleText}.`;
  }
  return `${name} have made a permanent offer ${roleText}.`;
}

/**
 * Build one validated offer object, or null with reasons.
 */
export function buildValidatedOffer({
  player,
  club,
  fit = null,
  dealType = "permanent",
  performanceScore = 70,
  rng = null,
  forceParent = false,
  loanTerms = null,
}) {
  const sporting =
    fit ||
    evaluateSportingFit(player, club, {
      seasonIndex: player.seasons?.length ?? 0,
      forceParent,
      careerId: player.careerId || player.name,
      relaxedDevelopment: dealType === "first_pro" || dealType === "loan",
    });

  if (!sporting.eligible && dealType !== "renewal") {
    return { ok: false, reasons: ["sporting-ineligible"], offer: null };
  }

  const seasonKey = financialSeasonKey(player);
  const ledger = getOrInitClubSeasonFinance(club.clubId, seasonKey);
  const remYears =
    player.contractEndSeason == null
      ? 0
      : Math.max(0, player.contractEndSeason - (player.seasons?.length ?? 0));
  const isFreeAgent =
    dealType === "free_agent" ||
    dealType === "first_pro" ||
    dealType === "pre_contract" ||
    remYears <= 0 ||
    Boolean(player.club?.isAcademy);

  const seller = sellerReservation(player, {
    assessedReadiness: sporting.scout.assessedReadiness,
    assessedUpside: sporting.scout.assessedUpside,
    isFreeAgent: isFreeAgent || dealType === "renewal" || dealType === "loan",
  });
  const buyer = buyerWillingness(player, sporting, { isFreeAgent: seller.freeAgent });
  let fee = 0;
  if (dealType === "permanent" && !seller.freeAgent) {
    const neg = negotiateFee(seller, buyer);
    if (!neg.overlap) {
      return {
        ok: false,
        reasons: ["no-fee-overlap", `sellerMin=${neg.sellerMin}`, `buyerMax=${neg.buyerMax}`],
        offer: null,
      };
    }
    fee = neg.fee;
    if (fee > ledger.ordinarySingleDealMaximum) {
      return { ok: false, reasons: ["fee-above-ordinary-deal-band"], offer: null };
    }
  }

  const role = sporting.projection.role === "ineligible" ? "prospect" : sporting.projection.role;
  const wageProposal = proposeWage({
    player,
    ledger,
    role: role === "key" ? "starter" : role,
    pathway: sporting.pathway,
    currentWeeklyWage: playerCurrentWeeklyWage(player),
    rng,
  });
  if (!wageProposal.ok) {
    return { ok: false, reasons: [wageProposal.reason || "wage-failed"], offer: null };
  }

  let contractYears = calculateContractLength(
    player.age,
    safePlayerOverall(player),
    sporting.scout.assessedUpside,
    performanceScore,
    rng
  );
  let extensionYears = null;
  let isExtension = false;
  if (dealType === "renewal") {
    // Offered years are additional coverage from the existing end boundary.
    // Cap by remaining room under under-18 / adult maximum total coverage.
    const age = Number(player.age) || 20;
    const maxTotal =
      age < CONTRACT_RULES.under18Age
        ? CONTRACT_RULES.under18MaxYears
        : CONTRACT_RULES.adultMaxYears;
    const maxExtension = Math.max(1, maxTotal - remYears);
    extensionYears = Math.min(Math.max(1, contractYears), maxExtension);
    contractYears = extensionYears;
    isExtension = true;
  }

  const deal = {
    transferFee: dealType === "loan" ? 0 : fee,
    loanFee: loanTerms?.loanFee ?? 0,
    wage: wageProposal.wage,
    contractYears: dealType === "loan" ? 1 : contractYears,
    extensionYears: dealType === "renewal" ? extensionYears : null,
    expectedRole: role,
    isLoan: dealType === "loan",
    isFreeAgent: isFreeAgent && dealType !== "loan",
    isRenewal: dealType === "renewal",
    isExtension,
    isParentOffer: dealType === "first_pro" && forceParent,
    previousAnnualWage:
      dealType === "renewal" && playerCurrentWeeklyWage(player) != null
        ? weeklyToAnnual(playerCurrentWeeklyWage(player))
        : null,
    borrowerWageShare: loanTerms?.borrowerWageShare,
    signingBonus: 0,
    agentFee: isFreeAgent || dealType === "first_pro" || dealType === "renewal" || dealType === "loan"
      ? 0
      : roundFee(fee * 0.03),
  };

  if (isFreeAgent || dealType === "first_pro" || dealType === "renewal") {
    deal.transferFee = 0;
    deal.agentFee = 0;
  }

  const validation = validateDealAffordability(ledger, deal);
  if (!validation.ok) {
    return { ok: false, reasons: validation.reasons, offer: null, costs: validation.costs };
  }

  const offer = {
    ...clubPayload(club),
    dealType,
    wage: wageProposal.wage,
    annualWage: wageProposal.annual,
    transferFee: deal.transferFee,
    loanFee: deal.loanFee,
    contractYears: dealType === "loan" ? null : deal.contractYears,
    extensionYears: deal.extensionYears,
    isExtension: Boolean(deal.isExtension),
    expectedRole: role,
    pathway: sporting.pathway,
    projectedMinutesRange: sporting.projection.minutesRange,
    projectedMinutesShare: sporting.projection.minutesShare,
    message:
      dealType === "renewal" && extensionYears
        ? `${club.displayName ?? club.name} want to extend your contract by ${extensionYears} year${extensionYears === 1 ? "" : "s"} ${role === "starter" ? "as a likely starter" : role === "rotation" ? "in a rotation role" : role === "cover" ? "as squad cover" : role === "prospect" ? "on a development pathway" : "in the squad"}.`
        : buildOfferMessage(club, dealType, role, sporting),
    isRenewal: dealType === "renewal",
    isParentOffer: Boolean(deal.isParentOffer),
    isFreeAgent: Boolean(deal.isFreeAgent),
    isLoan: dealType === "loan",
    scouting: {
      assessedReadiness: sporting.scout.assessedReadiness,
      assessedUpside: sporting.scout.assessedUpside,
    },
    pipelineVersion: DEAL_PIPELINE_VERSION,
    financeProfileVersion: FINANCE_PROFILE_VERSION,
    recruitmentConfigVersion: RECRUITMENT_CONFIG_VERSION,
    validationCosts: validation.costs,
    loanTerms: loanTerms || null,
    offerId: `${club.clubId}:${dealType}:${seasonKey}:${role}:${wageProposal.wage}:${deal.transferFee}`,
  };

  return { ok: true, reasons: [], offer, ledger, deal };
}

function ensureFreeAgentSpell(player) {
  // Pending boundary expiry review is not free-agency market behaviour.
  if (player?.pendingContractReview?.status === "pending") return null;
  if (!isFreeAgent(player)) return null;
  if (!player.freeAgentSpell || player.freeAgentSpell.status === "closed") {
    const seasonIndex = completedSeasons(player);
    player.freeAgentSpell = {
      spellId: `fa-spell:${player.careerId || player.name}:${seasonIndex}`,
      startedAtSeason: seasonIndex,
      consecutiveEmptyReviews: 0,
      closedReviewIds: [],
      frozenReviews: {},
      status: "active",
      history: [],
    };
  }
  return player.freeAgentSpell;
}

/**
 * Close a scheduled free-agent market review exactly once.
 * Zero executable offers advance the empty-review counter; a declined valid
 * offer breaks the consecutive-empty streak without counting as empty.
 */
export function closeFreeAgentMarketReview(player, result = {}) {
  ensureContractAuthority(player);
  const spell = ensureFreeAgentSpell(player);
  if (!spell) return { ok: false, reason: "not-free-agent" };
  const reviewId = result.reviewId || spell.lastReviewId;
  if (!reviewId) return { ok: false, reason: "no-review" };
  if (spell.closedReviewIds.includes(reviewId)) {
    return { ok: true, duplicate: true, spell };
  }
  spell.closedReviewIds.push(reviewId);
  const executable = Number(result.validatedOfferCount ?? result.offers?.length ?? 0);
  const declinedValid = Boolean(result.declinedValidOffer);
  let classification = "empty";
  if (declinedValid || executable > 0 && result.playerDeclined) {
    classification = "refusal";
    spell.consecutiveEmptyReviews = 0;
  } else if (executable > 0) {
    classification = "offers-present";
    spell.consecutiveEmptyReviews = 0;
  } else if (result.interestGateDeclined) {
    classification = "interest-gate";
    spell.consecutiveEmptyReviews += 1;
  } else if (result.exhausted) {
    classification = "exhausted";
    spell.consecutiveEmptyReviews += 1;
  } else {
    classification = "empty";
    spell.consecutiveEmptyReviews += 1;
  }
  spell.history.push({
    reviewId,
    classification,
    consecutiveEmptyReviews: spell.consecutiveEmptyReviews,
    eligibleCount: result.eligibleCount ?? null,
    validatedOfferCount: executable,
    recoveryStage: result.recoveryStage || "ordinary",
  });
  spell.lastClosedClassification = classification;
  return { ok: true, classification, spell };
}

export function endFreeAgentSpell(player, reason = "signed") {
  if (!player?.freeAgentSpell) return;
  const prior = { ...player.freeAgentSpell, status: "closed", closedReason: reason };
  if (!player.freeAgentSpellHistory) player.freeAgentSpellHistory = [];
  player.freeAgentSpellHistory.push(prior);
  player.freeAgentSpell = null;
}

/**
 * Generate transfer / renewal / free-agent offers through the shared pipeline.
 */
export function generatePipelineOffers(player, opts = {}) {
  const performanceScore = opts.performanceScore ?? 70;
  const careerId = player.careerId || player.name || "career";
  const seasonIndex = player.seasons?.length ?? 0;
  const reviewPhase = opts.reviewPhase || "in-season";
  const rngStream =
    opts.rngStream ||
    (reviewPhase === "boundary"
      ? `offers:${seasonIndex}:${performanceScore}:boundary`
      : `offers:${seasonIndex}:${performanceScore}`);
  const rng = opts.rng || createStreamRng(careerId, rngStream);
  const clubs = opts.clubs || allSeniorClubs();
  const offers = [];
  const rejectionLog = [];
  const diagnostics = {
    reviewId: null,
    spellId: null,
    generationAttempted: true,
    interestGateResult: null,
    recoveryStage: "ordinary",
    candidatesExamined: 0,
    sportingEligibleCount: null,
    validatedOfferCount: 0,
    reasonCounts: {},
  };

  // Renewal discussion — employer club only (not loan borrower). Shared review authority.
  ensureContractAuthority(player);
  const rem =
    player.contractEndSeason == null ? 99 : player.contractEndSeason - seasonIndex;
  const employer = resolveEmploymentClub(player);
  const renewalWindow =
    !player.club?.isAcademy &&
    employer?.clubId &&
    (rem <= 1 || reviewPhase === "boundary");
  if (renewalWindow) {
    const renewalProbe = buildValidatedOffer({
      player,
      club: employer,
      dealType: "renewal",
      performanceScore,
      rng,
      forceParent: true,
    });
    const review = evaluateRenewalReview(player, {
      seasonIndex,
      performanceScore,
      financeOk: renewalProbe.ok,
      financeReason: renewalProbe.reasons?.[0] || null,
      reviewPhase,
      forceReevaluate: Boolean(opts.forceReevaluate),
    });

    if (review.outcome === "wants-renewal" && renewalProbe.ok) {
      const offer = {
        ...renewalProbe.offer,
        isPreExpiryRenewal: rem === 1 || reviewPhase === "boundary",
        status: "pending",
        careerId: careerId,
        contractRevision: player.contractRevision,
        employerClubIdAtIssue: employer.clubId,
        renewalReviewId: review.reviewId,
        message:
          rem === 1 || reviewPhase === "boundary"
            ? `${employer.displayName ?? employer.name} want to talk about a new contract before yours expires.`
            : renewalProbe.offer.message,
      };
      const priorStatus = player.offerJournal?.[offer.offerId]?.status;
      if (
        priorStatus === "declined" ||
        priorStatus === "expired" ||
        priorStatus === "superseded" ||
        priorStatus === "accepted"
      ) {
        // Same-window terminal outcomes stay closed; a later review needs a new offer id.
        rejectionLog.push({
          clubId: employer.clubId,
          reasons: [`renewal-${priorStatus}`],
          kind: "renewal-closed",
        });
      } else {
        markOfferStatus(player, offer, "pending");
        offers.push(offer);
      }
    } else if (review.outcome === "temporary-reject") {
      rejectionLog.push({
        clubId: employer.clubId,
        reasons: renewalProbe.reasons || [review.reason],
        kind: "renewal-temporary",
      });
    } else if (review.outcome === "will-not-renew") {
      rejectionLog.push({
        clubId: employer.clubId,
        reasons: [review.reason || "will-not-renew"],
        kind: "renewal",
      });
    } else if (!renewalProbe.ok) {
      rejectionLog.push({ clubId: employer.clubId, reasons: renewalProbe.reasons, kind: "renewal" });
    }
  }

  if (player.club?.isAcademy && player.club.parentClub && !player.suppressParentContractOffer) {
    const parent =
      findSeniorClub(player.club.parentClub.name) ||
      findSeniorClubById(player.club.parentClub.clubId) ||
      player.club.parentClub;
    const parentOffer = buildValidatedOffer({
      player,
      club: parent,
      dealType: "first_pro",
      performanceScore: 75,
      rng,
      forceParent: true,
    });
    if (parentOffer.ok) offers.push(parentOffer.offer);
    else rejectionLog.push({ clubId: parent.clubId, reasons: parentOffer.reasons, kind: "parent" });
  }

  const remYears =
    player.contractEndSeason == null ? 0 : Math.max(0, player.contractEndSeason - seasonIndex);
  const dealType = remYears <= 0 || player.club?.isAcademy ? "free_agent" : "permanent";
  const freeAgentSearch =
    dealType === "free_agent" &&
    isFreeAgent(player) &&
    player.pendingContractReview?.status !== "pending";
  const spell = freeAgentSearch ? ensureFreeAgentSpell(player) : null;
  // Window identity is independent of recovery outcome; recovery applies only when
  // opening a later scheduled search (new season index after wait/train).
  const reviewId = freeAgentSearch
    ? `fa-review:${spell.spellId}:${seasonIndex}`
    : `market:${careerId}:${seasonIndex}:${reviewPhase}`;
  diagnostics.reviewId = reviewId;
  diagnostics.spellId = spell?.spellId || null;

  if (spell && !opts.forceGenerate) {
    const frozen = spell.frozenReviews?.[reviewId];
    const closed = spell.closedReviewIds?.includes(reviewId);
    if (frozen) {
      return {
        offers: frozen.offers,
        rejectionLog: frozen.rejectionLog,
        eligibleCount: frozen.eligibleCount,
        leagues: LEAGUES,
        diagnostics: frozen.diagnostics,
        reviewId,
        frozen: true,
        closed: Boolean(closed),
      };
    }
    if (closed) {
      return {
        offers: [],
        rejectionLog: [],
        eligibleCount: null,
        leagues: LEAGUES,
        diagnostics: {
          ...diagnostics,
          recoveryStage: "closed-window",
          interestGateResult: "closed",
        },
        reviewId,
        frozen: true,
        closed: true,
      };
    }
  }

  const recoveryMode =
    freeAgentSearch &&
    !opts.forceGenerate &&
    (opts.recoveryMode === true || (spell && spell.consecutiveEmptyReviews >= 1));
  diagnostics.recoveryStage = recoveryMode ? "recovery" : "ordinary";

  const ovr = safePlayerOverall(player);
  const interest = 0.18 + performanceScore / 220 + ovr / 280;
  const interestPass = opts.forceGenerate || rng.chance(Math.min(0.9, interest)) || recoveryMode;
  diagnostics.interestGateResult = interestPass
    ? recoveryMode
      ? "recovery-bypass"
      : opts.forceGenerate
        ? "forced"
        : "passed"
    : "declined";

  if (!interestPass) {
    const result = {
      offers,
      rejectionLog,
      eligibleCount: null,
      eligibilityEvaluated: false,
      leagues: LEAGUES,
      diagnostics: {
        ...diagnostics,
        sportingEligibleCount: null,
        reasonCounts: { "interest-gate": 1 },
      },
      reviewId,
    };
    if (spell) {
      spell.frozenReviews[reviewId] = {
        offers: result.offers,
        rejectionLog: result.rejectionLog,
        eligibleCount: null,
        diagnostics: result.diagnostics,
      };
      spell.lastReviewId = reviewId;
      player.lastMarketDiagnostics = result.diagnostics;
    }
    return result;
  }

  const eligible = findEligibleClubs(player, clubs, {
    seasonIndex,
    careerId,
    preferLowerDivisions: ovr < 68,
  });
  diagnostics.sportingEligibleCount = eligible.length;

  const targetSlots = Math.min(4, Math.max(1, Math.round(1 + (ovr - 55) / 18)));
  const reasonCounts = {};
  const bumpReason = (reasons) => {
    for (const r of reasons || ["unknown"]) {
      reasonCounts[r] = (reasonCounts[r] || 0) + 1;
    }
  };

  let candidates;
  if (recoveryMode) {
    candidates = eligible.slice().sort((a, b) => (b.weight || 0) - (a.weight || 0));
  } else {
    candidates = pickWeighted(eligible, rng, targetSlots + 2);
  }

  for (const candidate of candidates) {
    diagnostics.candidatesExamined += 1;
    if (offers.filter((o) => !o.isRenewal).length >= targetSlots) break;
    if (offers.some((o) => o.clubId === candidate.club.clubId)) continue;
    const built = buildValidatedOffer({
      player,
      club: candidate.club,
      fit: candidate.fit,
      dealType,
      performanceScore,
      rng,
    });
    if (built.ok) offers.push(built.offer);
    else {
      bumpReason(built.reasons);
      rejectionLog.push({
        clubId: candidate.club.clubId,
        reasons: built.reasons,
        kind: dealType,
      });
    }
  }

  const marketOffers = offers.filter((o) => !o.isRenewal);
  diagnostics.validatedOfferCount = marketOffers.length;
  diagnostics.reasonCounts = reasonCounts;
  if (recoveryMode && marketOffers.length === 0) {
    diagnostics.recoveryStage = "recovery-exhausted";
  } else if (recoveryMode) {
    diagnostics.recoveryStage = "recovery-success";
  } else if (
    !recoveryMode &&
    marketOffers.length === 0 &&
    eligible.length > 0 &&
    diagnostics.candidatesExamined < eligible.length
  ) {
    diagnostics.recoveryStage = "sample-failed-before-full-pool";
  }

  const result = {
    offers,
    rejectionLog,
    eligibleCount: eligible.length,
    eligibilityEvaluated: true,
    leagues: LEAGUES,
    diagnostics,
    reviewId,
  };
  if (spell) {
    spell.frozenReviews[reviewId] = {
      offers: result.offers,
      rejectionLog: result.rejectionLog,
      eligibleCount: eligible.length,
      diagnostics,
    };
    spell.lastReviewId = reviewId;
    player.lastMarketDiagnostics = diagnostics;
  }
  return result;
}

/**
 * Accept an offer: revalidate, book once, apply player contract fields.
 */
export function acceptPipelineOffer(player, offer, opts = {}) {
  ensureContractAuthority(player);
  if (!offer?.clubId) return { ok: false, reason: "missing-offer" };

  const executable = isOfferExecutable(player, offer);
  if (!executable.ok) return { ok: false, reason: executable.reason };

  const club =
    findSeniorClub(offer.club) ||
    findSeniorClubById(offer.clubId) ||
    offer;

  const seasonKey = financialSeasonKey(player);
  const ledger = getOrInitClubSeasonFinance(offer.clubId, seasonKey);
  const deal = {
    transferFee: offer.transferFee,
    loanFee: offer.loanFee || 0,
    wage: offer.wage,
    contractYears: offer.contractYears || 1,
    expectedRole: offer.expectedRole,
    isLoan: offer.isLoan,
    isFreeAgent: offer.isFreeAgent,
    isRenewal: offer.isRenewal,
    isParentOffer: offer.isParentOffer,
    previousAnnualWage:
      offer.isRenewal && playerCurrentWeeklyWage(player) != null
        ? weeklyToAnnual(playerCurrentWeeklyWage(player))
        : null,
    borrowerWageShare: offer.loanTerms?.borrowerWageShare,
    signingBonus: 0,
    agentFee: offer.validationCosts?.agentFee || 0,
  };

  const recheck = validateDealAffordability(ledger, deal);
  if (!recheck.ok && !opts.trustStoredTerms) {
    return { ok: false, reason: "revalidation-failed", reasons: recheck.reasons };
  }

  const txId =
    offer.acceptedTransactionId ||
    `tx:${offer.offerId || offer.clubId}:${player.seasons?.length ?? 0}:${offer.wage}:${offer.transferFee}`;

  if (player.completedDealIds?.includes(txId)) {
    return { ok: false, reason: "duplicate-accept" };
  }

  const booked = bookDealTransaction(ledger, deal, txId);
  if (!booked.ok) {
    return { ok: false, reason: booked.reason, reasons: booked.reasons };
  }

  // Seller is the employer (parent while on loan), never the borrower.
  if (
    !offer.isRenewal &&
    !offer.isFreeAgent &&
    !offer.isLoan &&
    offer.transferFee > 0
  ) {
    const sellerId = employmentClubId(player);
    if (sellerId && sellerId !== offer.clubId) {
      const sellerLedger = getOrInitClubSeasonFinance(sellerId, seasonKey);
      creditPlayerSale(sellerLedger, offer.transferFee);
    }
  }

  // Stamp acceptance date onto the offer so applyOfferToPlayer always records a stint.
  if (!offer.effectiveDate && !offer.reviewDate) {
    offer.effectiveDate = resolveDealSimulationDate(player, offer);
  }
  applyOfferToPlayer(player, offer, txId);
  consumeRelatedDecisionAfterDeal(player, offer);

  const departureDate = offer.effectiveDate || offer.reviewDate || resolveDealSimulationDate(player, offer);
  if (departureDate && offer.leagueId && !offer.isRenewal && !offer.isLoan) {
    const reg =
      offer.registration ||
      resolveMoveRegistration({
        destinationLeagueId: offer.leagueId,
        departureDate,
        originSeasonStartYear: player.startYear || 2026,
      });
    if (reg.ok && !reg.immediate) {
      player.pendingRegistration = {
        clubId: offer.clubId,
        leagueId: offer.leagueId,
        effectiveDate: reg.effectiveDate,
        ruleVersion: reg.ruleVersion,
      };
    }
  }

  return { ok: true, transactionId: txId, ledger, club };
}

export function applyOfferToPlayer(player, offer, transactionId) {
  ensureContractAuthority(player);
  ensurePlayingStints(player);
  if (!player.completedDealIds) player.completedDealIds = [];
  if (transactionId && !player.completedDealIds.includes(transactionId)) {
    player.completedDealIds.push(transactionId);
  }

  if (offer.isRenewal) {
    // Renew employment terms only — preserve borrower registration while on loan.
    applyRenewalTerms(player, offer);
    markOfferStatus(player, offer, "accepted", { transactionId });
    player.pendingOffers = [];
    player.suppressParentContractOffer = true;
    return;
  }

  if (isFreeAgent(player) || player.freeAgentSpell) {
    endFreeAgentSpell(player, "signed");
  }

  if (!offer.isLoan) {
    // Permanent move while on loan: caller should settle the loan first.
    if (player.activeLoan?.status === "active") {
      player.activeLoan = { ...player.activeLoan, status: "sold" };
      player.parentClubSnapshot = null;
    }
    player.club = {
      name: offer.club,
      displayName: offer.clubDisplay ?? offer.club,
      clubId: offer.clubId,
      league: offer.league,
      leagueDisplay: offer.leagueDisplay ?? offer.league,
      leagueId: offer.leagueId,
      nation: offer.nation,
      tier: offer.tier,
      divisionLevel: offer.divisionLevel,
      badge: offer.badge,
      financialTier: offer.financialTier,
      reputation: offer.reputation,
      overall: offer.overall,
      attack: offer.attack,
      midfield: offer.midfield,
      defence: offer.defence,
      goalkeeper: offer.goalkeeper,
      strengthTier: offer.strengthTier,
      isAcademy: false,
      parentClub: null,
    };
    player.employmentClubId = offer.clubId;
    player.playingClubId = offer.clubId;
    player.weeklyWage = offer.wage;
    player.wage = offer.wage;
    player.expectedRole = offer.expectedRole;
    const currentSeason = completedSeasons(player);
    player.contractStartSeason = currentSeason;
    player.contractYears = offer.contractYears;
    player.contractEndSeason = currentSeason + (offer.contractYears || 1);
    player.contractStatus = "active";
    player.freeAgentReason = null;
    bumpContractRevision(player);
    // Any successful new employment supersedes a previous employer's pending review.
    if (player.pendingContractReview?.status === "pending") {
      player.pendingContractReview = {
        ...player.pendingContractReview,
        status: "settled",
        settledChoice: "signed-elsewhere",
        settledAtSeason: currentSeason,
        settledClubId: offer.clubId,
      };
    }

    const departureDate = resolveDealSimulationDate(player, offer);
    const reg =
      offer.registration ||
      (offer.leagueId && departureDate
        ? resolveMoveRegistration({
            destinationLeagueId: offer.leagueId,
            departureDate,
            originSeasonStartYear: player.startYear || 2026,
          })
        : null);
    const stintFrom =
      reg?.ok && !reg.immediate && reg.effectiveDate ? reg.effectiveDate : departureDate;
    recordPlayingTransition(player, {
      effectiveDate: stintFrom,
      closePriorAt: departureDate,
      playingClubId: offer.clubId,
      employmentClubId: offer.clubId,
      leagueId: offer.leagueId,
      clubName: offer.club,
      kind: "permanent",
      onLoan: false,
    });
  }

  markOfferStatus(player, offer, "accepted", { transactionId });
  player.pendingOffers = [];
  player.suppressParentContractOffer = true;
  if (!player.state) {
    player.state = { form: 0, morale: 0, readiness: 1, fatigue: 0, adaptationPenalty: 0, roleFit: 1 };
  }
  if (!offer.isRenewal && !offer.isLoan) {
    player.state.adaptationPenalty = Math.min(1.5, (player.state.adaptationPenalty || 0) + 0.55);
  }
}
