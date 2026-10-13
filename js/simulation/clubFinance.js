/**
 * Persistent club-season finance ledgers and deal booking.
 * Offer generation/evaluation must not mutate balances; acceptance books once.
 */
import { getClubFinanceProfile, FINANCE_PROFILE_VERSION } from "../data/clubFinanceProfiles.js";
import { FX_SNAPSHOT } from "../config/recruitmentConfig.js";
import { clamp } from "../utils/helpers.js";

/** @type {Map<string, object>} clubId|financialSeason → ledger */
const ledgers = new Map();

function ledgerKey(clubId, financialSeason) {
  return `${clubId}|${financialSeason}`;
}

export function resetClubFinanceLedgers() {
  ledgers.clear();
}

export function exportClubFinanceState() {
  return {
    profileVersion: FINANCE_PROFILE_VERSION,
    ledgers: Object.fromEntries(ledgers),
  };
}

export function importClubFinanceState(state) {
  ledgers.clear();
  if (!state?.ledgers) return;
  for (const [k, v] of Object.entries(state.ledgers)) {
    ledgers.set(k, structuredClone(v));
  }
}

/**
 * Initialise or return the season ledger for a club.
 * Budget survives offer refreshes; not rerolled per candidate.
 */
export function getOrInitClubSeasonFinance(clubId, financialSeason = "season-default", opts = {}) {
  const key = ledgerKey(clubId, financialSeason);
  if (ledgers.has(key)) return ledgers.get(key);

  const profile = opts.profile || getClubFinanceProfile(clubId);
  if (!profile) {
    const fallback = {
      clubId,
      financialSeason,
      profileVersion: FINANCE_PROFILE_VERSION,
      cashAvailable: 400_000,
      operationalReserve: 100_000,
      remainingTransferAuthorisation: 350_000,
      committedAnnualPayroll: 1_500_000,
      remainingWageHeadroom: 400_000,
      remainingSquadCostCapacity: 500_000,
      existingAndNewTransferCommitments: 0,
      loanFeeAndWageCommitments: 0,
      registrationSlots: { internationalLoansOut: 0, internationalLoansIn: 0 },
      pendingAcceptedDeals: [],
      completedTransactionIds: [],
      ordinarySingleDealMaximum: 250_000,
      roleWageBands: {
        prospect: [200, 800],
        cover: [500, 1800],
        rotation: [1000, 3000],
        starter: [1500, 5000],
        key: [2500, 8000],
      },
      financialRuleAdapter: "conservative-fallback",
      playerAnnualWageCommitted: 0,
      source: "missing-profile-fallback",
    };
    ledgers.set(key, fallback);
    return fallback;
  }

  const wageHeadroom = Math.max(
    0,
    profile.playerPayrollBudget - profile.baselineCommittedPayroll
  );
  // Squad-cost headroom: simplified European-style capacity (not full UEFA legal SCR).
  const squadCostHeadroom = Math.round(wageHeadroom * 1.35 + profile.boardTransferAuthorisation * 0.15);

  const ledger = {
    clubId,
    financialSeason,
    profileVersion: profile.profileVersion,
    cashAvailable: Math.round(profile.boardTransferAuthorisation * 0.85 + profile.operatingRevenue * 0.04),
    operationalReserve: profile.debtServiceReserve,
    remainingTransferAuthorisation: profile.boardTransferAuthorisation,
    committedAnnualPayroll: profile.baselineCommittedPayroll,
    remainingWageHeadroom: wageHeadroom,
    remainingSquadCostCapacity: squadCostHeadroom,
    existingAndNewTransferCommitments: profile.existingTransferCommitments || 0,
    loanFeeAndWageCommitments: 0,
    registrationSlots: {
      internationalLoansOut: 0,
      internationalLoansIn: 0,
      sameClubPairLoans: {},
    },
    pendingAcceptedDeals: [],
    completedTransactionIds: [],
    ordinarySingleDealMaximum: profile.ordinarySingleDealBand[1],
    ordinarySingleDealMinimum: profile.ordinarySingleDealBand[0],
    roleWageBands: profile.roleWageBands,
    topPlayerWageReference: profile.topPlayerWageReference,
    financialRuleAdapter: profile.financialRuleAdapter,
    playerAnnualWageCommitted: 0,
    mlsSeniorBudgetUsd: profile.mlsSeniorBudgetUsd,
    mlsMaxBudgetChargeUsd: profile.mlsMaxBudgetChargeUsd,
    fxVersion: FX_SNAPSHOT.version,
    source: "profile",
  };

  // Optional: exclude player wage already in baseline when player is at this club.
  if (opts.playerAnnualWageAtClub != null && opts.treatPlayerWageInBaseline) {
    // Player already counted in baselineCommittedPayroll — track separately for renewals.
    ledger.playerAnnualWageCommitted = opts.playerAnnualWageAtClub;
  }

  ledgers.set(key, ledger);
  return ledger;
}

/** Build a ledger from the synthetic Serie B test fixture. */
export function ledgerFromSyntheticSerieB(fixture) {
  return {
    clubId: fixture.clubId,
    financialSeason: "synthetic",
    profileVersion: FINANCE_PROFILE_VERSION,
    cashAvailable: fixture.remainingTransferAuthorisation,
    operationalReserve: 500_000,
    remainingTransferAuthorisation: fixture.remainingTransferAuthorisation,
    committedAnnualPayroll: 6_000_000,
    remainingWageHeadroom: fixture.remainingAnnualPlayerWageHeadroom,
    remainingSquadCostCapacity: fixture.remainingAnnualSquadCostHeadroom,
    existingAndNewTransferCommitments: 0,
    loanFeeAndWageCommitments: 0,
    registrationSlots: { internationalLoansOut: 0, internationalLoansIn: 0, sameClubPairLoans: {} },
    pendingAcceptedDeals: [],
    completedTransactionIds: [],
    ordinarySingleDealMaximum: fixture.ordinarySingleDealMaximum,
    ordinarySingleDealMinimum: 100_000,
    roleWageBands: {
      prospect: [600, 2000],
      cover: fixture.roleWeeklyBaseSalaryBand,
      rotation: fixture.roleWeeklyBaseSalaryBand,
      starter: fixture.roleWeeklyBaseSalaryBand,
      key: [fixture.roleWeeklyBaseSalaryBand[1], fixture.roleWeeklyBaseSalaryBand[1] + 2000],
    },
    topPlayerWageReference: 12000,
    financialRuleAdapter: "figc-serie-b",
    playerAnnualWageCommitted: 0,
    source: "synthetic-fixture",
  };
}

/**
 * Annual fee amortisation under a documented simplified European squad-cost policy.
 * Not full UEFA legal compliance.
 */
export function annualFeeAmortisation(fee, contractYears) {
  const years = clamp(Math.round(contractYears) || 1, 1, 5);
  return Math.round(fee / years);
}

export function weeklyToAnnual(weekly) {
  return Math.round(Number(weekly) * 52);
}

export function annualToWeekly(annual) {
  return Math.round(Number(annual) / 52);
}

/**
 * Validate a proposed deal against a ledger without mutating it.
 * @returns {{ ok: boolean, reasons: string[], costs?: object }}
 */
export function validateDealAffordability(ledger, deal) {
  const reasons = [];
  if (!ledger) return { ok: false, reasons: ["missing-ledger"] };

  const fee = Math.max(0, Number(deal.transferFee) || 0);
  const weeklyWage = Math.max(0, Number(deal.wage) || 0);
  const annualWage = weeklyToAnnual(weeklyWage);
  const contractYears = clamp(Math.round(deal.contractYears) || 1, 1, 5);
  const signingBonus = Math.max(0, Number(deal.signingBonus) || 0);
  const agentFee = Math.max(0, Number(deal.agentFee) || 0);
  const employerCostRate = Number(deal.employerCostRate) || 0.15;
  const employerCosts = Math.round(annualWage * employerCostRate);
  const loanFee = Math.max(0, Number(deal.loanFee) || 0);
  const isLoan = Boolean(deal.isLoan);
  const isFreeAgent = Boolean(deal.isFreeAgent) || fee === 0 && !deal.isRenewal && !deal.isParentOffer && !isLoan;

  const acquisitionPackage = isLoan ? loanFee + signingBonus + agentFee : fee + signingBonus + agentFee;
  const amort = isLoan ? 0 : annualFeeAmortisation(fee, contractYears);
  const annualSquadCostHit = annualWage + employerCosts + amort + (isLoan ? loanFee : 0);

  if (!deal.isRenewal && !deal.isParentOffer && !isFreeAgent && !isLoan) {
    if (fee > ledger.ordinarySingleDealMaximum && !deal.exceptionalAuthorisation) {
      reasons.push("exceeds-ordinary-single-deal");
    }
    if (acquisitionPackage > ledger.remainingTransferAuthorisation) {
      reasons.push("exceeds-transfer-authorisation");
    }
    if (ledger.cashAvailable - acquisitionPackage < ledger.operationalReserve * 0.25) {
      reasons.push("insufficient-cash-reserve");
    }
  } else if (isLoan) {
    if (loanFee > ledger.remainingTransferAuthorisation) reasons.push("exceeds-transfer-authorisation");
  }

  // Wage headroom: renewals replace existing player wage when provided.
  let wageDelta = annualWage;
  if (deal.isRenewal && deal.previousAnnualWage != null) {
    wageDelta = annualWage - Number(deal.previousAnnualWage);
  }
  if (wageDelta > ledger.remainingWageHeadroom) {
    reasons.push("exceeds-wage-headroom");
  }

  if (annualSquadCostHit > ledger.remainingSquadCostCapacity && !deal.isRenewal) {
    reasons.push("exceeds-squad-cost-capacity");
  }

  // Role band check
  const role = deal.expectedRole || "rotation";
  const band = ledger.roleWageBands?.[role] || ledger.roleWageBands?.cover;
  if (band && weeklyWage > 0) {
    if (weeklyWage < band[0] * 0.5) {
      // Below band is OK (club underpaying) — no reject
    } else if (weeklyWage > band[1] * 1.05 && !deal.exceptionalWage) {
      reasons.push("wage-above-role-band");
    }
  }

  // MLS ordinary path: budget charge vs max charge (USD), if adapter applies.
  if (ledger.financialRuleAdapter === "mls-2026" && ledger.mlsMaxBudgetChargeUsd != null) {
    const rate = FX_SNAPSHOT.toGbp.USD || 0.78;
    const weeklyUsd = weeklyWage / rate;
    const annualChargeUsd = weeklyUsd * 52;
    if (annualChargeUsd > ledger.mlsMaxBudgetChargeUsd && !deal.mlsDesignatedPlayer) {
      reasons.push("mls-exceeds-max-budget-charge");
    }
  }

  const costs = {
    fee,
    loanFee,
    signingBonus,
    agentFee,
    weeklyWage,
    annualWage,
    employerCosts,
    amortisation: amort,
    acquisitionPackage,
    annualSquadCostHit,
    wageDelta,
  };

  return { ok: reasons.length === 0, reasons, costs };
}

/**
 * Atomically book an accepted deal. Idempotent via transactionId.
 */
export function bookDealTransaction(ledger, deal, transactionId) {
  if (!ledger || !transactionId) {
    return { ok: false, reason: "missing-ledger-or-tx" };
  }
  if (ledger.completedTransactionIds.includes(transactionId)) {
    return { ok: true, reason: "already-booked", duplicate: true };
  }

  const validation = validateDealAffordability(ledger, deal);
  if (!validation.ok) {
    return { ok: false, reason: "revalidation-failed", reasons: validation.reasons };
  }

  const { costs } = validation;
  const isLoan = Boolean(deal.isLoan);

  if (!deal.isRenewal) {
    ledger.remainingTransferAuthorisation = Math.max(
      0,
      ledger.remainingTransferAuthorisation - costs.acquisitionPackage
    );
    ledger.cashAvailable = Math.max(0, ledger.cashAvailable - costs.acquisitionPackage);
    ledger.existingAndNewTransferCommitments += costs.acquisitionPackage;
    if (isLoan) {
      ledger.loanFeeAndWageCommitments += costs.loanFee + Math.round(costs.annualWage * (deal.borrowerWageShare ?? 1));
    }
  }

  ledger.remainingWageHeadroom = Math.max(0, ledger.remainingWageHeadroom - costs.wageDelta);
  ledger.committedAnnualPayroll += costs.wageDelta;
  ledger.remainingSquadCostCapacity = Math.max(
    0,
    ledger.remainingSquadCostCapacity - (deal.isRenewal ? costs.wageDelta : costs.annualSquadCostHit)
  );
  ledger.playerAnnualWageCommitted = costs.annualWage;
  ledger.completedTransactionIds.push(transactionId);

  return { ok: true, costs, transactionId };
}

/**
 * Credit seller after a completed sale (partial reinvestment — not 100% automatic).
 */
export function creditPlayerSale(ledger, fee, reinvestmentRate = 0.55) {
  if (!ledger || !(fee > 0)) return;
  const reinvest = Math.round(fee * clamp(reinvestmentRate, 0, 1));
  ledger.cashAvailable += fee;
  ledger.remainingTransferAuthorisation += reinvest;
}

/**
 * Release future wage commitment (loan end / sale / termination).
 */
export function releaseWageCommitment(ledger, annualWage, remainingFraction = 1) {
  if (!ledger || !(annualWage > 0)) return;
  const release = Math.round(annualWage * clamp(remainingFraction, 0, 1));
  ledger.remainingWageHeadroom += release;
  ledger.committedAnnualPayroll = Math.max(0, ledger.committedAnnualPayroll - release);
  ledger.remainingSquadCostCapacity += release;
}
