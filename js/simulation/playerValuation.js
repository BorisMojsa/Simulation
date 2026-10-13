/**
 * Independent seller reservation, buyer willingness, and player wage demands.
 * Capacity is validated separately in clubFinance — do not clamp fee to budget
 * to invent a fake overlapping deal.
 */
import { clamp } from "../utils/helpers.js";
import { CONTRACT_RULES, PROSPECT_PATHWAY } from "../config/recruitmentConfig.js";
import { safePlayerOverall } from "./playerOverallSafe.js";
import { weeklyToAnnual } from "./clubFinance.js";

/**
 * Contract length using real age — under-18 max 3 years (FIFA-style adapter).
 */
export function calculateContractLength(age, rating, potential, performanceScore, rng = null) {
  const roll = (lo, hi) => (rng ? rng.int(lo, hi) : lo + Math.floor(Math.random() * (hi - lo + 1)));
  const a = Number(age) || 20;
  if (a < CONTRACT_RULES.under18Age) {
    return Math.min(CONTRACT_RULES.under18MaxYears, roll(1, 3));
  }

  let years;
  if (a <= 20 && (potential ?? 0) >= 85) years = roll(3, 5);
  else if (a <= 24 && (potential ?? 0) >= 80) years = roll(3, 5);
  else if (a <= 28) years = rating >= 85 || (potential ?? 0) >= 85 ? roll(3, 5) : roll(2, 4);
  else if (a <= 32) years = rating >= 85 && performanceScore > 80 ? roll(2, 4) : roll(2, 3);
  else if (a <= 35) years = rating >= 80 && performanceScore > 75 ? roll(1, 3) : roll(1, 2);
  else if (a <= 38) years = rating >= 80 && performanceScore > 80 ? roll(1, 2) : 1;
  else years = 1;

  return Math.min(CONTRACT_RULES.adultMaxYears, years);
}

/**
 * Magnitude-dependent fee rounding (no universal £500k floor).
 */
export function roundFee(fee) {
  const f = Math.max(0, Number(fee) || 0);
  if (f === 0) return 0;
  if (f < 100_000) return Math.round(f / 5_000) * 5_000;
  if (f < 500_000) return Math.round(f / 25_000) * 25_000;
  if (f < 2_000_000) return Math.round(f / 50_000) * 50_000;
  if (f < 10_000_000) return Math.round(f / 100_000) * 100_000;
  if (f < 50_000_000) return Math.round(f / 250_000) * 250_000;
  return Math.round(f / 500_000) * 500_000;
}

export function roundWeeklyWage(wage) {
  const w = Math.max(0, Number(wage) || 0);
  if (w < 1000) return Math.round(w / 25) * 25;
  if (w < 5000) return Math.round(w / 50) * 50;
  if (w < 20000) return Math.round(w / 100) * 100;
  return Math.round(w / 500) * 500;
}

function remainingContractYears(player) {
  if (player.contractEndSeason == null) return 2;
  const current = player.seasons?.length ?? 0;
  return Math.max(0, player.contractEndSeason - current);
}

/**
 * Seller reservation / asking range (GBP).
 */
export function sellerReservation(player, opts = {}) {
  const ovr = Number(opts.assessedReadiness ?? safePlayerOverall(player));
  const age = Number(player.age) || 24;
  const rem = remainingContractYears(player);
  if (rem <= 0 || opts.isFreeAgent) {
    return { min: 0, ask: 0, freeAgent: true };
  }

  const norm = clamp((ovr - 55) / 35, 0, 1);
  let base = 80_000 + Math.pow(norm, 2.1) * 55_000_000;
  // Bounded youth effect — not unlimited.
  if (age <= 21) base *= 1 + clamp((78 - age) / 80, 0, 0.55) * clamp((ovr - 58) / 20, 0, 1);
  else if (age <= 24) base *= 1.08;
  else if (age >= 30) base *= clamp(1 - (age - 29) * 0.07, 0.45, 1);

  if (rem === 1) base *= 0.55;
  else if (rem === 2) base *= 0.78;
  else if (rem >= 4) base *= 1.12;

  const upside = Number(opts.assessedUpside ?? player.potential ?? ovr);
  if (upside > ovr + 8) base *= 1 + clamp((upside - ovr) / 40, 0, 0.35);

  const ask = roundFee(base);
  const min = roundFee(ask * 0.82);
  return { min, ask, freeAgent: false };
}

/**
 * Buyer willingness to pay for a projected role (independent of cash capacity).
 */
export function buyerWillingness(player, fit, opts = {}) {
  const ovr = fit.scout?.assessedReadiness ?? safePlayerOverall(player);
  const role = fit.projection?.role || "cover";
  const roleMult = { starter: 1.15, rotation: 0.9, cover: 0.55, prospect: 0.4, key: 1.3 }[role] || 0.7;
  const teamOvr = fit.teamOverall || 70;
  // Willingness shrinks when player is far below club level.
  const levelFit = clamp(1.1 - Math.max(0, teamOvr - ovr) / 18, 0.2, 1.15);

  const seller = sellerReservation(player, {
    assessedReadiness: ovr,
    assessedUpside: fit.scout?.assessedUpside,
    isFreeAgent: opts.isFreeAgent,
  });
  if (seller.freeAgent) return { max: 0, target: 0, freeAgent: true };

  const target = roundFee(seller.ask * roleMult * levelFit);
  const max = roundFee(target * 1.12);
  return { max, target, freeAgent: false };
}

/**
 * Propose a fee where seller min and buyer max overlap; else null (no permanent deal).
 */
export function negotiateFee(seller, buyer) {
  if (seller.freeAgent || buyer.freeAgent) {
    return { fee: 0, freeAgent: true, overlap: true };
  }
  if (buyer.max < seller.min) {
    return { fee: null, freeAgent: false, overlap: false, sellerMin: seller.min, buyerMax: buyer.max };
  }
  const fee = roundFee(clamp((seller.min + Math.min(seller.ask, buyer.max)) / 2, seller.min, buyer.max));
  return { fee, freeAgent: false, overlap: true };
}

/**
 * Player acceptable weekly wage range and club proposal within role bands.
 */
export function proposeWage({ player, ledger, role, pathway, currentWeeklyWage = null, rng = null }) {
  const band = ledger?.roleWageBands?.[role] || ledger?.roleWageBands?.cover || [1000, 5000];
  const ovr = safePlayerOverall(player);
  const demandCentre = band[0] + (band[1] - band[0]) * clamp((ovr - 55) / 30, 0.15, 0.9);
  let demandMin = roundWeeklyWage(demandCentre * 0.75);
  let demandMax = roundWeeklyWage(demandCentre * 1.2);

  if (currentWeeklyWage != null && currentWeeklyWage > 0) {
    // Transfers need not be a pay rise; allow slight cut for sporting step-up.
    demandMin = Math.min(demandMin, roundWeeklyWage(currentWeeklyWage * 0.85));
  }

  if (pathway === "prospect") {
    demandMax = Math.min(demandMax, PROSPECT_PATHWAY.maxWeeklyWageGbp);
    demandMin = Math.min(demandMin, demandMax);
  }

  const lo = Math.max(band[0], demandMin * 0.9);
  const hi = Math.min(band[1], Math.max(lo, demandMax));
  const jitter = rng ? rng.float(0.92, 1.05) : 1;
  let wage = roundWeeklyWage(clamp(demandCentre * jitter, lo, hi));

  // Must sit in band and within player demand for a valid offer.
  if (wage > band[1]) wage = band[1];
  if (wage < band[0]) wage = band[0];
  if (wage > demandMax * 1.15) {
    return { ok: false, reason: "player-demand-above-band", wage: null, band, demandMin, demandMax };
  }
  return { ok: true, wage, annual: weeklyToAnnual(wage), band, demandMin, demandMax };
}

export function playerCurrentWeeklyWage(player) {
  if (Number.isFinite(player.weeklyWage)) return player.weeklyWage;
  if (Number.isFinite(player.wage)) return player.wage;
  return null;
}
