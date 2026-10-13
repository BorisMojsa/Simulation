/**
 * Ordinary loans and purchase options — employment vs playing registration.
 */
import { createStreamRng } from "./rng.js";
import { allSeniorClubs, findSeniorClubById } from "./seniorClubs.js";
import { findEligibleClubs, pickWeighted } from "./recruitmentModel.js";
import { buildValidatedOffer, applyOfferToPlayer } from "./dealPipeline.js";
import {
  getOrInitClubSeasonFinance,
  validateDealAffordability,
  bookDealTransaction,
  releaseWageCommitment,
  weeklyToAnnual,
} from "./clubFinance.js";
import { roundFee } from "./playerValuation.js";
import { CONTRACT_RULES } from "../config/recruitmentConfig.js";
import { resolveMoveRegistration } from "./destinationSchedule.js";

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
  const scored = eligible
    .map((c) => ({
      ...c,
      weight: c.weight * (0.5 + (c.fit.projection.minutesShare || 0)),
    }))
    .filter((c) => (c.fit.projection.minutesShare || 0) >= 0.35);

  const picked = pickWeighted(scored, rng, opts.maxOffers ?? 3);
  const offers = [];
  const rejectionLog = [];

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
 */
export function startLoan(player, offer) {
  if (!offer?.isLoan || !offer.loanTerms) return { ok: false, reason: "not-a-loan" };
  const terms = offer.loanTerms;
  const shares = normalizeWageShares(terms.borrowerWageShare, terms.parentWageShare);
  if (!shares) return { ok: false, reason: "invalid-wage-shares" };
  if (shares.borrowerWageShare + shares.parentWageShare !== 1) {
    // floating tolerance
    if (Math.abs(shares.borrowerWageShare + shares.parentWageShare - 1) > 1e-6) {
      return { ok: false, reason: "wage-shares-not-100" };
    }
  }

  if (player.contractEndSeason != null && terms.endSeason > player.contractEndSeason) {
    return { ok: false, reason: "loan-beyond-parent-contract" };
  }

  const sk = seasonKey(player);
  const borrowerLedger = getOrInitClubSeasonFinance(terms.borrowingClubId, sk);
  const parentLedger = getOrInitClubSeasonFinance(terms.parentClubId, sk);

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

  const txBorrower = `tx:loan-b:${terms.loanId}`;
  const txParent = `tx:loan-p:${terms.loanId}`;
  const bookedB = bookDealTransaction(borrowerLedger, borrowerDeal, txBorrower);
  if (!bookedB.ok) return { ok: false, reason: bookedB.reason, reasons: bookedB.reasons };

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

  const parentClub = { ...player.club };
  const borrower = findSeniorClubById(terms.borrowingClubId);
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
  };
  // Playing club for match selection
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

  const departureDate = offer.effectiveDate || offer.reviewDate || offer.loanTerms?.startDate;
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
    }
  }

  return { ok: true, loan: player.activeLoan };
}

/**
 * End loan: exactly one transition — return, expiry, or purchase.
 */
export function endLoan(player, resolution = "return", opts = {}) {
  const loan = player.activeLoan;
  if (!loan || loan.status !== "active") return { ok: false, reason: "no-active-loan" };

  const parent = player.parentClubSnapshot;
  if (!parent) return { ok: false, reason: "missing-parent-snapshot" };

  if (resolution === "purchase" && loan.purchaseOption) {
    const buyer = findSeniorClubById(loan.borrowingClubId);
    const offer = {
      ...buyer,
      club: buyer.name,
      clubDisplay: buyer.displayName,
      dealType: "permanent",
      transferFee: loan.purchaseOption.fee,
      wage: loan.purchaseOption.wage || loan.agreedGrossWeekly,
      contractYears: Math.min(
        CONTRACT_RULES.adultMaxYears,
        Math.max(1, (player.contractEndSeason ?? 1) - (player.seasons?.length ?? 0) + 2)
      ),
      expectedRole: loan.expectedRole || "rotation",
      isLoan: false,
      isFreeAgent: false,
      loanTerms: null,
      offerId: `purchase:${loan.loanId}`,
    };
    // Close loan registration first
    player.activeLoan = { ...loan, status: "purchased" };
    player.parentClubSnapshot = null;
    const { acceptPipelineOffer } = opts;
    // Inline permanent apply
    applyOfferToPlayer(player, offer, `tx:purchase:${loan.loanId}`);
    player.employmentClubId = loan.borrowingClubId;
    player.playingClubId = loan.borrowingClubId;
    return { ok: true, resolution: "purchase", offer };
  }

  const contractExpired =
    player.contractEndSeason != null && (player.seasons?.length ?? 0) >= player.contractEndSeason;

  if (contractExpired || resolution === "expiry") {
    player.activeLoan = { ...loan, status: "expired" };
    player.club = null;
    player.employmentClubId = null;
    player.playingClubId = null;
    player.parentClubSnapshot = null;
    player.weeklyWage = 0;
    return { ok: true, resolution: "expiry" };
  }

  // Return to parent
  player.club = { ...parent, isLoanSpell: false };
  player.employmentClubId = loan.parentClubId;
  player.playingClubId = loan.parentClubId;
  if (Number.isFinite(loan.previousWeeklyWage)) {
    player.weeklyWage = loan.previousWeeklyWage;
  }
  player.activeLoan = { ...loan, status: "returned" };
  player.parentClubSnapshot = null;
  return { ok: true, resolution: "return" };
}

export function recallLoan(player, dateKey = null) {
  const loan = player.activeLoan;
  if (!loan?.recallClause) return { ok: false, reason: "no-recall-clause" };
  if (loan.allowedRecallDates?.length && dateKey && !loan.allowedRecallDates.includes(dateKey)) {
    return { ok: false, reason: "recall-date-not-allowed" };
  }
  return endLoan(player, "return");
}
