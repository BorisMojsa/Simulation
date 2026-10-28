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
} from "./contractLifecycle.js";
import { recordPlayingTransition, ensurePlayingStints } from "./playingRegistration.js";

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

  const contractYears = calculateContractLength(
    player.age,
    safePlayerOverall(player),
    sporting.scout.assessedUpside,
    performanceScore,
    rng
  );

  const deal = {
    transferFee: dealType === "loan" ? 0 : fee,
    loanFee: loanTerms?.loanFee ?? 0,
    wage: wageProposal.wage,
    contractYears: dealType === "loan" ? 1 : contractYears,
    expectedRole: role,
    isLoan: dealType === "loan",
    isFreeAgent: isFreeAgent && dealType !== "loan",
    isRenewal: dealType === "renewal",
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
    expectedRole: role,
    pathway: sporting.pathway,
    projectedMinutesRange: sporting.projection.minutesRange,
    projectedMinutesShare: sporting.projection.minutesShare,
    message: buildOfferMessage(club, dealType, role, sporting),
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

/**
 * Generate transfer / renewal / free-agent offers through the shared pipeline.
 */
export function generatePipelineOffers(player, opts = {}) {
  const performanceScore = opts.performanceScore ?? 70;
  const careerId = player.careerId || player.name || "career";
  const seasonIndex = player.seasons?.length ?? 0;
  const rng = opts.rng || createStreamRng(careerId, `offers:${seasonIndex}:${performanceScore}`);
  const clubs = opts.clubs || allSeniorClubs();
  const offers = [];
  const rejectionLog = [];

  // Renewal discussion — employer club only (not loan borrower). Shared review authority.
  ensureContractAuthority(player);
  const rem =
    player.contractEndSeason == null ? 99 : player.contractEndSeason - seasonIndex;
  const employer = resolveEmploymentClub(player);
  if (!player.club?.isAcademy && employer?.clubId && rem <= 1) {
    // Probe affordability without treating failure as firm non-renewal.
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
    });

    if (review.outcome === "wants-renewal" && renewalProbe.ok) {
      const offer = {
        ...renewalProbe.offer,
        isPreExpiryRenewal: rem === 1,
        status: "pending",
        careerId: careerId,
        contractRevision: player.contractRevision,
        employerClubIdAtIssue: employer.clubId,
        renewalReviewId: review.reviewId,
        message:
          rem === 1
            ? `${employer.displayName ?? employer.name} want to talk about a new contract before yours expires.`
            : renewalProbe.offer.message,
      };
      markOfferStatus(player, offer, "pending");
      offers.push(offer);
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

  const ovr = safePlayerOverall(player);
  const interest = 0.18 + performanceScore / 220 + ovr / 280;
  if (!rng.chance(Math.min(0.9, interest)) && !opts.forceGenerate) {
    return { offers, rejectionLog, eligibleCount: 0 };
  }

  const remYears =
    player.contractEndSeason == null ? 0 : Math.max(0, player.contractEndSeason - seasonIndex);
  const dealType = remYears <= 0 || player.club?.isAcademy ? "free_agent" : "permanent";

  const eligible = findEligibleClubs(player, clubs, {
    seasonIndex,
    careerId,
    preferLowerDivisions: ovr < 68,
  });

  const targetSlots = Math.min(4, Math.max(1, Math.round(1 + (ovr - 55) / 18)));
  const picked = pickWeighted(eligible, rng, targetSlots + 2);

  for (const candidate of picked) {
    if (offers.length >= targetSlots) break;
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
    else rejectionLog.push({ clubId: candidate.club.clubId, reasons: built.reasons, kind: dealType });
  }

  return { offers, rejectionLog, eligibleCount: eligible.length, leagues: LEAGUES };
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

  applyOfferToPlayer(player, offer, txId);
  consumeRelatedDecisionAfterDeal(player, offer);

  const departureDate = offer.effectiveDate || offer.reviewDate;
  if (departureDate && offer.leagueId && !offer.isRenewal) {
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

    const departureDate = offer.effectiveDate || offer.reviewDate;
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
      reg?.ok && !reg.immediate && reg.effectiveDate
        ? reg.effectiveDate
        : departureDate || offer.reviewDate;
    if (stintFrom) {
      recordPlayingTransition(player, {
        effectiveDate: stintFrom,
        closePriorAt: departureDate || stintFrom,
        playingClubId: offer.clubId,
        employmentClubId: offer.clubId,
        leagueId: offer.leagueId,
        clubName: offer.club,
        kind: "permanent",
        onLoan: false,
      });
    }
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
