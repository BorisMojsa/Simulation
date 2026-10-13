/**
 * Deterministic mid-season decision policies for tests and automated careers.
 */
import { resolveSquadDecision } from "./squadDecisions.js";
import { startLoan } from "./loanMarket.js";
import { acceptPipelineOffer } from "./dealPipeline.js";
import { resolveMoveRegistration } from "./destinationSchedule.js";

/**
 * Apply a named policy. Returns { applied, dealType, offer, loan }.
 */
export function applyDecisionPolicy(player, { decision, offers }, policy, opts = {}) {
  const mode = typeof policy === "string" ? policy : policy?.mode || "stay";
  const list = offers || player.pendingOffers || [];

  if (mode === "stay" || mode === "decline-loans") {
    if (decision) resolveSquadDecision(player, decision, "stay-compete");
    player.pendingOffers = [];
    player.pendingDecision = null;
    return { applied: "stay", contractIntact: true };
  }

  if (mode === "refuse-loan") {
    if (decision) resolveSquadDecision(player, decision, "stay-compete");
    player.pendingOffers = [];
    player.pendingDecision = null;
    return { applied: "refuse-loan", contractIntact: true };
  }

  if (mode === "accept-first-loan") {
    const loanOffer = list.find((o) => o.isLoan) || decision?.loanOffers?.[0];
    if (!loanOffer) {
      if (decision) resolveSquadDecision(player, decision, "stay-compete");
      player.pendingOffers = [];
      return { applied: "stay-fallback", reason: "no-loan-offer" };
    }
    stampRegistration(player, loanOffer, opts);
    const result = startLoan(player, loanOffer);
    player.pendingOffers = [];
    player.pendingDecision = null;
    return { applied: result.ok ? "loan" : "loan-failed", result, offer: loanOffer, loan: player.activeLoan };
  }

  if (mode === "accept-first-transfer" || mode === "accept-cross-league-transfer") {
    const transfer = list.find((o) => !o.isLoan && !o.isRenewal) || list[0];
    if (!transfer) {
      player.pendingOffers = [];
      return { applied: "stay-fallback", reason: "no-transfer-offer" };
    }
    if (mode === "accept-cross-league-transfer") {
      const cross = list.find(
        (o) => !o.isLoan && o.leagueId && o.leagueId !== player.club?.leagueId
      );
      if (!cross) {
        player.pendingOffers = [];
        return { applied: "stay-fallback", reason: "no-cross-league-offer" };
      }
      stampRegistration(player, cross, opts);
      const result = acceptPipelineOffer(player, cross);
      player.pendingOffers = [];
      player.pendingDecision = null;
      return { applied: result.ok ? "transfer" : "transfer-failed", result, offer: cross };
    }
    stampRegistration(player, transfer, opts);
    const result = acceptPipelineOffer(player, transfer);
    player.pendingOffers = [];
    player.pendingDecision = null;
    return { applied: result.ok ? "transfer" : "transfer-failed", result, offer: transfer };
  }

  if (mode === "accept-purchase-option") {
    return { applied: "purchase-pending", note: "caller should invoke endLoan(player,'purchase')" };
  }

  player.pendingOffers = [];
  player.pendingDecision = null;
  return { applied: "clear" };
}

function stampRegistration(player, offer, opts) {
  const departureDate = opts.departureDate || opts.date || "2027-01-10";
  const originSeasonStartYear = opts.originSeasonStartYear ?? player.startYear ?? 2026;
  const reg = resolveMoveRegistration({
    destinationLeagueId: offer.leagueId,
    departureDate,
    originSeasonStartYear,
  });
  offer.registration = reg;
  if (reg.ok && !reg.immediate) {
    offer.futureStart = true;
    offer.effectiveDate = reg.effectiveDate;
  } else if (reg.ok) {
    offer.effectiveDate = reg.effectiveDate || departureDate;
  }
}
