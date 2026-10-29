/**
 * Ordinary loans and purchase options — employment vs playing registration.
 */
import { createStreamRng } from "./rng.js";
import { allSeniorClubs, findSeniorClubById } from "./seniorClubs.js";
import { findEligibleClubs, pickWeighted } from "./recruitmentModel.js";
import { buildValidatedOffer, acceptPipelineOffer } from "./dealPipeline.js";
import {
  getOrInitClubSeasonFinance,
  validateDealAffordability,
  bookDealTransaction,
  releaseWageCommitment,
  weeklyToAnnual,
} from "./clubFinance.js";
import { roundFee } from "./playerValuation.js";
import { CONTRACT_RULES, SQUAD_REVIEW } from "../config/recruitmentConfig.js";

const LOAN_DEST_MIN_SHARE = SQUAD_REVIEW.loanDestinationMinMinutesShare;
const LOAN_MIN_IMPROVEMENT = SQUAD_REVIEW.loanMinutesImprovement;
import { resolveMoveRegistration } from "./destinationSchedule.js";
import {
  ensureContractAuthority,
  releaseToFreeAgency,
  isContractActive,
  completedSeasons,
} from "./contractLifecycle.js";
import { recordPlayingTransition, ensurePlayingStints } from "./playingRegistration.js";

function settleLoanSlotsAndWages(player, loan, sk, mode = "return") {
  if (!loan || loan.settledFinance) return { ok: true, duplicate: true };
  const borrowerLedger = getOrInitClubSeasonFinance(loan.borrowingClubId, sk);
  const parentLedger = getOrInitClubSeasonFinance(loan.parentClubId, sk);
  const agreed = Number.isFinite(loan.agreedGrossWeekly) ? loan.agreedGrossWeekly : 0;
  const borrowerShare = loan.borrowerWageShare ?? 0.5;
  const borrowerAnnual = weeklyToAnnual(Math.round(agreed * borrowerShare));

  // Release borrower remaining wage commitment for this loan.
  if (borrowerAnnual > 0) {
    releaseWageCommitment(borrowerLedger, borrowerAnnual, 1);
    borrowerLedger.loanFeeAndWageCommitments = Math.max(
      0,
      (borrowerLedger.loanFeeAndWageCommitments || 0) - borrowerAnnual
    );
  }

  // On return/recall: parent re-commits the share released at loan start.
  // On purchase/expiry: parent does not re-commit (player leaves or becomes free).
  if (mode === "return" && agreed > 0 && borrowerShare > 0) {
    const restore = Math.round(weeklyToAnnual(agreed) * borrowerShare);
    parentLedger.remainingWageHeadroom = Math.max(
      0,
      (parentLedger.remainingWageHeadroom || 0) - restore
    );
    parentLedger.committedAnnualPayroll = (parentLedger.committedAnnualPayroll || 0) + restore;
  }

  if (loan.international) {
    parentLedger.registrationSlots.internationalLoansOut = Math.max(
      0,
      (parentLedger.registrationSlots.internationalLoansOut || 0) - 1
    );
    borrowerLedger.registrationSlots.internationalLoansIn = Math.max(
      0,
      (borrowerLedger.registrationSlots.internationalLoansIn || 0) - 1
    );
  }

  const pairKey = `${loan.parentClubId}::${loan.borrowingClubId}`;
  if (parentLedger.registrationSlots.sameClubPairLoans?.[pairKey] != null) {
    parentLedger.registrationSlots.sameClubPairLoans[pairKey] = Math.max(
      0,
      parentLedger.registrationSlots.sameClubPairLoans[pairKey] - 1
    );
  }

  loan.settledFinance = true;
  return { ok: true };
}

function seasonKey(player) {
  return String((player.startYear || 2026) + (player.seasons?.length ?? 0));
}

function makeLoanId(player, borrowerId) {
  return `loan:${player.careerId || player.name}:${borrowerId}:${seasonKey(player)}`;
}

/**
 * Normalise wage shares to sum to 1.
 */
export function normalizeWageShares(borrowerShare, parentShare) {
  let b = Number(borrowerShare);
  let p = Number(parentShare);
  if (!Number.isFinite(b) && !Number.isFinite(p)) {
    b = 0.5;
    p = 0.5;
  } else if (!Number.isFinite(b)) b = 1 - p;
  else if (!Number.isFinite(p)) p = 1 - b;
  const sum = b + p;
  if (!(sum > 0) || !Number.isFinite(sum)) return null;
  return { borrowerWageShare: b / sum, parentWageShare: p / sum };
}

/**
 * International loan slot rules (FIFA-style, researched period).
 * Domestic loans use separate, looser tracking.
 */
export function canRegisterInternationalLoan(parentLedger, borrowerLedger, player, opts = {}) {
  const reasons = [];
  const age = Number(player.age) || 20;
  const clubTrained = Boolean(opts.clubTrained);
  const turns21SeasonEnd = age < 21 || (age === 21 && opts.beforeSeasonEndTurning21);
  const youthExempt = clubTrained && turns21SeasonEnd;

  if (!youthExempt) {
    if ((parentLedger.registrationSlots.internationalLoansOut || 0) >= 6) {
      reasons.push("parent-international-loan-cap");
    }
    if ((borrowerLedger.registrationSlots.internationalLoansIn || 0) >= 6) {
      reasons.push("borrower-international-loan-cap");
    }
  }

  const pairKey = `${parentLedger.clubId}::${borrowerLedger.clubId}`;
  const pairCount = parentLedger.registrationSlots.sameClubPairLoans?.[pairKey] || 0;
  if (pairCount >= 3) reasons.push("same-club-pair-loan-cap");

  return { ok: reasons.length === 0, reasons, youthExempt };
}

/**
 * Build loan candidate offers for the player.
 */
export function generateLoanOffers(player, opts = {}) {
  if (!player.club || player.club.isAcademy) {
    return { offers: [], rejectionLog: [] };
  }
  const rem =
    player.contractEndSeason == null
      ? 99
      : player.contractEndSeason - (player.seasons?.length ?? 0);
  if (rem <= 0) return { offers: [], rejectionLog: [{ reasons: ["no-parent-contract"] }] };

  const careerId = player.careerId || player.name;
  const rng = opts.rng || createStreamRng(careerId, `loans:${seasonKey(player)}`);
  const clubs = opts.clubs || allSeniorClubs();
  const eligible = findEligibleClubs(player, clubs, {
    seasonIndex: player.seasons?.length ?? 0,
    careerId,
    preferLowerDivisions: true,
    relaxedDevelopment: true,
    dealType: "loan",
  }).filter((c) => c.club.clubId !== player.club.clubId);

  // Prefer destinations projecting more minutes than current club.
  // Development recommendations use configured destination/improvement gates.
  // Ordinary elective loan searches keep a broader pool (0.35) and are not
  // advertised as qualifying development recommendations.
  const offers = [];
  const rejectionLog = [];
  const developmentRecommendation = Boolean(opts.developmentRecommendation);
  const minShare = developmentRecommendation ? LOAN_DEST_MIN_SHARE : 0.35;
  const minImprovement = developmentRecommendation ? LOAN_MIN_IMPROVEMENT : null;
  const currentProjected =
    opts.currentProjectedShare != null && Number.isFinite(Number(opts.currentProjectedShare))
      ? Number(opts.currentProjectedShare)
      : null;

  const scored = eligible
    .map((c) => ({
      ...c,
      weight: c.weight * (0.5 + (c.fit.projection.minutesShare || 0)),
    }))
    .filter((c) => {
      const destShare = c.fit.projection.minutesShare || 0;
      if (destShare < minShare) {
        rejectionLog.push({
          clubId: c.club.clubId,
          reasons: ["destination-minutes-below-gate"],
          destinationShare: destShare,
          minShare,
          developmentRecommendation,
        });
        return false;
      }
      if (
        developmentRecommendation &&
        minImprovement != null &&
        currentProjected != null &&
        destShare - currentProjected < minImprovement
      ) {
        rejectionLog.push({
          clubId: c.club.clubId,
          reasons: ["destination-improvement-below-gate"],
          destinationShare: destShare,
          currentProjectedShare: currentProjected,
          minImprovement,
          developmentRecommendation: true,
        });
        return false;
      }
      return true;
    });

  // Keep weighted sampling among destinations that already pass the gates so
  // ordinary and development paths remain deterministic under the same RNG.
  const picked = pickWeighted(scored, rng, opts.maxOffers ?? 3);

  for (const candidate of picked) {
    const shares = normalizeWageShares(rng.float(0.4, 0.85), null);
    if (!shares) continue;
    const loanFee = roundFee(rng.float(0, 250_000) * (candidate.fit.pathway === "prospect" ? 0.3 : 1));
    const parent = player.club;
    const parentLedger = getOrInitClubSeasonFinance(parent.clubId, seasonKey(player));
    const borrowerLedger = getOrInitClubSeasonFinance(candidate.club.clubId, seasonKey(player));

    const international = parent.nation && candidate.club.nation && parent.nation !== candidate.club.nation;
    if (international) {
      const slots = canRegisterInternationalLoan(parentLedger, borrowerLedger, player, {
        clubTrained: Boolean(player.clubTrainedAtParent),
      });
      if (!slots.ok) {
        rejectionLog.push({ clubId: candidate.club.clubId, reasons: slots.reasons });
        continue;
      }
    }

    const built = buildValidatedOffer({
      player,
      club: candidate.club,
      fit: candidate.fit,
      dealType: "loan",
      performanceScore: opts.performanceScore ?? 70,
      rng,
      loanTerms: {
        ...shares,
        loanFee,
        parentClubId: parent.clubId,
        recallClause: rng.chance(0.35),
        purchaseOption: rng.chance(0.25)
          ? {
              fee: roundFee((candidate.fit.scout.assessedReadiness || 60) * 40_000),
              wage: null,
            }
          : null,
      },
    });

    if (!built.ok) {
      rejectionLog.push({ clubId: candidate.club.clubId, reasons: built.reasons });
      continue;
    }

    // Parent retained wage share must fit parent ledger.
    const parentRetainedWeekly = Math.round(built.offer.wage * shares.parentWageShare);
    if (parentRetainedWeekly > (player.weeklyWage || built.offer.wage) + 1) {
      rejectionLog.push({ clubId: candidate.club.clubId, reasons: ["parent-wage-increase"] });
      continue;
    }

    const endSeason = Math.min(
      player.contractEndSeason,
      (player.seasons?.length ?? 0) + 1
    );
    const parentClub = findSeniorClubById(parent.clubId) || parent;

    offers.push({
      ...built.offer,
      dealType: "loan",
      isLoan: true,
      loanTerms: {
        ...built.offer.loanTerms,
        loanId: makeLoanId(player, candidate.club.clubId),
        parentClubId: parent.clubId,
        parentClubName: parentClub.displayName || parentClub.name || parent.name,
        borrowingClubId: candidate.club.clubId,
        startSeason: player.seasons?.length ?? 0,
        endSeason,
        startDate: opts.startDate || null,
        endDate: opts.endDate || null,
        status: "proposed",
        agreedGrossWeekly: built.offer.wage,
        international: Boolean(international),
      },
      parentClubName: parentClub.displayName || parentClub.name || parent.name,
      transferFee: 0,
      message: built.offer.message,
    });
  }

  return { offers, rejectionLog };
}

/**
 * Start a loan: update playing registration; keep parent employment.
 * Idempotent: duplicate acceptance is a full no-op before any mutation.
 */
export function startLoan(player, offer) {
  ensureContractAuthority(player);
  if (!offer?.isLoan || !offer.loanTerms) return { ok: false, reason: "not-a-loan" };
  const terms = offer.loanTerms;

  // Reject a second active loan unless the first has been settled.
  if (player.activeLoan?.status === "active") {
    if (player.activeLoan.loanId === terms.loanId) {
      return { ok: false, reason: "duplicate-loan", duplicate: true, loan: player.activeLoan };
    }
    return { ok: false, reason: "already-on-loan" };
  }

  const txBorrower = `tx:loan-b:${terms.loanId}`;
  const txParent = `tx:loan-p:${terms.loanId}`;
  if (
    player.completedDealIds?.includes(txBorrower) ||
    player.consumedTransitionIds?.includes(`loan-start:${terms.loanId}`)
  ) {
    return { ok: false, reason: "duplicate-loan", duplicate: true };
  }

  const shares = normalizeWageShares(terms.borrowerWageShare, terms.parentWageShare);
  if (!shares) return { ok: false, reason: "invalid-wage-shares" };
  if (Math.abs(shares.borrowerWageShare + shares.parentWageShare - 1) > 1e-6) {
    return { ok: false, reason: "wage-shares-not-100" };
  }

  if (player.contractEndSeason != null && terms.endSeason > player.contractEndSeason) {
    return { ok: false, reason: "loan-beyond-parent-contract" };
  }

  const sk = seasonKey(player);
  const borrowerLedger = getOrInitClubSeasonFinance(terms.borrowingClubId, sk);
  const parentLedger = getOrInitClubSeasonFinance(terms.parentClubId, sk);

  // Snapshot parent BEFORE any mutation so retries cannot replace it with borrower.
  const parentClub = player.parentClubSnapshot
    ? { ...player.parentClubSnapshot }
    : { ...player.club };

  const borrowerDeal = {
    transferFee: 0,
    loanFee: terms.loanFee || 0,
    wage: Math.round(offer.wage * shares.borrowerWageShare),
    isLoan: true,
    contractYears: 1,
    expectedRole: offer.expectedRole,
    borrowerWageShare: shares.borrowerWageShare,
  };
  const v = validateDealAffordability(borrowerLedger, borrowerDeal);
  if (!v.ok) return { ok: false, reason: "borrower-unaffordable", reasons: v.reasons };

  // Book first; if finance says duplicate, treat as full no-op (no slot/wage side effects).
  const bookedB = bookDealTransaction(borrowerLedger, borrowerDeal, txBorrower);
  if (!bookedB.ok) return { ok: false, reason: bookedB.reason, reasons: bookedB.reasons };
  if (bookedB.duplicate) {
    return { ok: false, reason: "duplicate-loan", duplicate: true };
  }

  // Parent: release portion transferred to borrower.
  const fullAnnual = weeklyToAnnual(offer.wage);
  releaseWageCommitment(parentLedger, fullAnnual * shares.borrowerWageShare, 1);

  if (terms.international) {
    parentLedger.registrationSlots.internationalLoansOut =
      (parentLedger.registrationSlots.internationalLoansOut || 0) + 1;
    borrowerLedger.registrationSlots.internationalLoansIn =
      (borrowerLedger.registrationSlots.internationalLoansIn || 0) + 1;
  }
  const pairKey = `${terms.parentClubId}::${terms.borrowingClubId}`;
  if (!parentLedger.registrationSlots.sameClubPairLoans) {
    parentLedger.registrationSlots.sameClubPairLoans = {};
  }
  parentLedger.registrationSlots.sameClubPairLoans[pairKey] =
    (parentLedger.registrationSlots.sameClubPairLoans[pairKey] || 0) + 1;

  const borrower = findSeniorClubById(terms.borrowingClubId);
  if (!borrower) return { ok: false, reason: "borrower-not-found" };

  const previousWeeklyWage = Number.isFinite(player.weeklyWage) ? player.weeklyWage : offer.wage;
  player.employmentClubId = terms.parentClubId;
  player.parentClubSnapshot = parentClub;
  player.playingClubId = terms.borrowingClubId;
  player.activeLoan = {
    ...terms,
    ...shares,
    status: "active",
    agreedGrossWeekly: offer.wage,
    previousWeeklyWage,
    expectedRole: offer.expectedRole,
    transactionIds: [txBorrower, txParent],
    settledFinance: false,
  };
  player.club = {
    name: borrower.name,
    displayName: borrower.displayName,
    clubId: borrower.clubId,
    league: borrower.league,
    leagueDisplay: borrower.leagueDisplay,
    leagueId: borrower.leagueId,
    nation: borrower.nation,
    tier: borrower.tier,
    divisionLevel: borrower.divisionLevel,
    badge: borrower.badge,
    financialTier: borrower.financialTier,
    reputation: borrower.reputation,
    overall: borrower.overall,
    attack: borrower.attack,
    midfield: borrower.midfield,
    defence: borrower.defence,
    goalkeeper: borrower.goalkeeper,
    strengthTier: borrower.strengthTier,
    isAcademy: false,
    parentClub: null,
    isLoanSpell: true,
  };
  player.weeklyWage = offer.wage;
  player.pendingOffers = [];
  player.pendingDecision = null;
  if (!player.completedDealIds) player.completedDealIds = [];
  if (!player.completedDealIds.includes(txBorrower)) player.completedDealIds.push(txBorrower);
  if (!player.consumedTransitionIds) player.consumedTransitionIds = [];
  player.consumedTransitionIds.push(`loan-start:${terms.loanId}`);

  const departureDate = offer.effectiveDate || offer.reviewDate || offer.loanTerms?.startDate;
  let stintFrom = departureDate;
  if (departureDate && borrower?.leagueId) {
    const reg =
      offer.registration ||
      resolveMoveRegistration({
        destinationLeagueId: borrower.leagueId,
        departureDate,
        originSeasonStartYear: player.startYear || 2026,
      });
    if (reg.ok && !reg.immediate) {
      player.pendingRegistration = {
        clubId: terms.borrowingClubId,
        leagueId: borrower.leagueId,
        effectiveDate: reg.effectiveDate,
        ruleVersion: reg.ruleVersion,
      };
      stintFrom = reg.effectiveDate;
    }
  }
  if (stintFrom) {
    ensurePlayingStints(player, { asOfDate: departureDate || stintFrom });
    recordPlayingTransition(player, {
      effectiveDate: stintFrom,
      closePriorAt: departureDate || stintFrom,
      playingClubId: terms.borrowingClubId,
      employmentClubId: terms.parentClubId,
      leagueId: borrower?.leagueId || null,
      clubName: borrower?.name || null,
      kind: "loan_start",
      onLoan: true,
    });
  }

  return { ok: true, loan: player.activeLoan };
}

/**
 * End loan: exactly one transition — return, expiry, or purchase.
 */
export function endLoan(player, resolution = "return", opts = {}) {
  ensureContractAuthority(player);
  const loan = player.activeLoan;
  if (!loan || loan.status !== "active") {
    if (loan && loan.status !== "active") {
      return { ok: true, duplicate: true, reason: "already-settled", resolution: loan.status };
    }
    return { ok: false, reason: "no-active-loan" };
  }

  const parent = player.parentClubSnapshot;
  if (!parent && resolution !== "purchase") {
    return { ok: false, reason: "missing-parent-snapshot" };
  }

  const sk = seasonKey(player);
  const settleId = `loan-end:${loan.loanId}:${resolution}`;
  if (player.consumedTransitionIds?.includes(settleId)) {
    return { ok: true, duplicate: true, reason: "already-settled" };
  }

  if (resolution === "purchase" && loan.purchaseOption) {
    const buyer = findSeniorClubById(loan.borrowingClubId);
    if (!buyer) return { ok: false, reason: "buyer-not-found" };
    const offer = {
      ...buyer,
      club: buyer.name,
      clubDisplay: buyer.displayName,
      clubId: buyer.clubId,
      dealType: "permanent",
      transferFee: loan.purchaseOption.fee,
      wage: loan.purchaseOption.wage || loan.agreedGrossWeekly,
      contractYears: Math.min(
        CONTRACT_RULES.adultMaxYears,
        Math.max(1, (player.contractEndSeason ?? 1) - completedSeasons(player) + 2)
      ),
      expectedRole: loan.expectedRole || "rotation",
      isLoan: false,
      isFreeAgent: false,
      loanTerms: null,
      offerId: `purchase:${loan.loanId}`,
      status: "pending",
      careerId: player.careerId || player.name,
    };

    // Pre-validate affordability with no mutations — failed purchase leaves loan intact.
    const buyerLedger = getOrInitClubSeasonFinance(loan.borrowingClubId, sk);
    const precheck = validateDealAffordability(buyerLedger, {
      transferFee: offer.transferFee,
      wage: offer.wage,
      contractYears: offer.contractYears,
      isLoan: false,
      isRenewal: false,
      expectedRole: offer.expectedRole,
    });
    if (!precheck.ok) {
      return { ok: false, reason: "purchase-unaffordable", reasons: precheck.reasons };
    }

    const accept =
      typeof opts.acceptPipelineOffer === "function" ? opts.acceptPipelineOffer : acceptPipelineOffer;

    settleLoanSlotsAndWages(player, loan, sk, "purchase");
    player.activeLoan = { ...loan, status: "purchased", settledFinance: true };
    player.parentClubSnapshot = null;

    const result = accept(player, offer);
    if (!result.ok) {
      // Extremely rare after precheck; restore registration without inventing finance undo.
      player.activeLoan = { ...loan, status: "active", settledFinance: false };
      player.parentClubSnapshot = parent ? { ...parent } : null;
      return { ok: false, reason: result.reason || "purchase-failed", reasons: result.reasons };
    }

    if (!player.consumedTransitionIds) player.consumedTransitionIds = [];
    player.consumedTransitionIds.push(settleId);
    return { ok: true, resolution: "purchase", offer, transactionId: result.transactionId };
  }

  const contractExpired = !isContractActive(player) || resolution === "expiry";

  if (contractExpired) {
    settleLoanSlotsAndWages(player, loan, sk, "expiry");
    player.activeLoan = { ...loan, status: "expired", settledFinance: true };
    player.parentClubSnapshot = null;
    releaseToFreeAgency(player, "loan-and-contract-expired");
    if (!player.consumedTransitionIds) player.consumedTransitionIds = [];
    player.consumedTransitionIds.push(settleId);
    return { ok: true, resolution: "expiry" };
  }

  settleLoanSlotsAndWages(player, loan, sk, "return");

  // Return to parent
  player.club = { ...parent, isLoanSpell: false };
  player.employmentClubId = loan.parentClubId;
  player.playingClubId = loan.parentClubId;
  if (Number.isFinite(loan.previousWeeklyWage)) {
    player.weeklyWage = loan.previousWeeklyWage;
    player.wage = loan.previousWeeklyWage;
  }
  player.activeLoan = { ...loan, status: "returned", settledFinance: true };
  player.parentClubSnapshot = null;
  if (!player.consumedTransitionIds) player.consumedTransitionIds = [];
  player.consumedTransitionIds.push(settleId);
  const returnDate =
    opts.effectiveDate || opts.date || loan.endDate || `${(player.startYear || 2026) + completedSeasons(player) + 1}-06-30`;
  ensurePlayingStints(player, { asOfDate: returnDate });
  recordPlayingTransition(player, {
    effectiveDate: returnDate,
    playingClubId: loan.parentClubId,
    employmentClubId: loan.parentClubId,
    leagueId: parent?.leagueId || null,
    clubName: parent?.name || null,
    kind: opts.recall ? "loan_recall" : "loan_return",
    onLoan: false,
  });
  return { ok: true, resolution: "return" };
}

export function recallLoan(player, dateKey = null) {
  const loan = player.activeLoan;
  if (!loan?.recallClause) return { ok: false, reason: "no-recall-clause" };
  if (loan.allowedRecallDates?.length && dateKey && !loan.allowedRecallDates.includes(dateKey)) {
    return { ok: false, reason: "recall-date-not-allowed" };
  }
  return endLoan(player, "return", { recall: true, effectiveDate: dateKey || undefined });
}
