/**
 * Manager squad reviews and loan recommendations (academy-style decision cards).
 */
import { SQUAD_REVIEW } from "../config/recruitmentConfig.js";
import { createStreamRng } from "./rng.js";
import { evaluateSportingFit } from "./recruitmentModel.js";
import { generateLoanOffers, endLoan } from "./loanMarket.js";
import { isAvailable } from "./playerHealth.js";
import {
  ensureContractAuthority,
  evaluateRenewalReview,
  isContractActive,
  declineWindowAndContinue,
  settleBoundaryContractReview,
} from "./contractLifecycle.js";
import {
  assessClubPlayingTime,
  clubMinutesShareFromAssessment,
  participationLedgerFromAssessment,
} from "./playingTimeAssessment.js";

function decisionId(kind, player, seasonIndex) {
  return `decision:${kind}:${player.careerId || player.name}:${seasonIndex}`;
}

/**
 * Club minutes share among fit/eligible club matches only.
 * Uses the shared opportunity assessment (ledger records + exclusions).
 */
export function clubMinutesShare(player, opts = {}) {
  const season = opts.season || player.seasons?.[player.seasons.length - 1];
  if (!season && !opts.ledgerRecords && !opts.records) {
    return { share: 0, eligibleMatches: 0, minutes: 0, usableForLowMinutes: false };
  }

  const assessment = assessClubPlayingTime(player, {
    ...opts,
    season,
    checkpoint: opts.checkpoint || "end",
  });
  if (season && opts.persistAssessment !== false) {
    season.playingTimeAssessment = assessment;
    season.participationLedger = participationLedgerFromAssessment(assessment);
  }
  return clubMinutesShareFromAssessment(assessment);
}

function hasCooldown(player, kind, seasonIndex) {
  const cd = player.decisionCooldowns?.[kind];
  if (!cd) return false;
  return seasonIndex < cd.nextReviewSeason;
}

function setCooldown(player, kind, seasonIndex) {
  if (!player.decisionCooldowns) player.decisionCooldowns = {};
  player.decisionCooldowns[kind] = {
    nextReviewSeason: seasonIndex + 1,
    decidedAtSeason: seasonIndex,
  };
}

/**
 * Evaluate manager discussion at a dated checkpoint.
 * @returns {null|object} decision payload for UI
 */
export function evaluateSquadDecision(player, opts = {}) {
  ensureContractAuthority(player);
  if (!player?.club || player.club.isAcademy || player.isRetired) return null;
  if (player.activeLoan?.status === "active") {
    return buildLoanEndingDecision(player, opts);
  }

  const seasonIndex = opts.seasonIndex ?? player.seasons?.length ?? 0;
  const age = Number(player.age) || 20;
  // Live squad decisions evaluate the current playing club — never a prior club's sample.
  const currentClubId = player.playingClubId || player.club?.clubId || null;
  const minutes = clubMinutesShare(player, {
    ...opts,
    persistAssessment: true,
    clubId: opts.clubId || currentClubId,
    representedClubId: opts.representedClubId || opts.clubId || currentClubId,
    playingClubId: opts.playingClubId || opts.clubId || currentClubId,
  });
  const injuredNow = player.health?.activeInjury && !isAvailable(player.health, opts.date);

  // Injury recovery — do not treat as failure to compete.
  if (injuredNow || (minutes.eligibleMatches < 3 && player.health?.activeInjury)) {
    if (hasCooldown(player, "injury-recovery", seasonIndex)) return null;
    return {
      decisionId: decisionId("injury-recovery", player, seasonIndex),
      kind: "injury-recovery",
      status: "pending",
      allowedChoices: ["acknowledge"],
      employerClubId: player.employmentClubId || player.club?.clubId,
      contractRevision: player.contractRevision,
      headline: "Recovery comes first",
      lead:
        "The medical staff and manager agree your low minutes are about availability, not commitment. Focus on recovery; your place will be reviewed when you are fit.",
      choices: [{ id: "acknowledge", label: "Focus on recovery" }],
      cooldownKind: "injury-recovery",
    };
  }

  // Non-renewal notice — only from explicit will-not-renew review (never from missing field).
  const rem =
    player.contractEndSeason == null ? 99 : player.contractEndSeason - seasonIndex;
  const review =
    opts.renewalReview ||
    player.renewalReview ||
    (rem === 1
      ? evaluateRenewalReview(player, {
          seasonIndex,
          performanceScore: opts.performanceScore ?? 70,
          financeOk: opts.financeOk,
        })
      : null);
  const firmNonRenewal = review?.outcome === "will-not-renew";
  const hasPendingRenewal = (player.pendingOffers || []).some(
    (o) => o.isRenewal && o.status !== "declined" && o.status !== "superseded"
  );
  if (
    rem === 1 &&
    firmNonRenewal &&
    !hasPendingRenewal &&
    !hasCooldown(player, "non-renewal", seasonIndex)
  ) {
    return {
      decisionId: decisionId("non-renewal", player, seasonIndex),
      kind: "non-renewal",
      status: "pending",
      allowedChoices: ["seek-move", "see-out"],
      employerClubId: player.employmentClubId || player.club?.clubId,
      contractRevision: player.contractRevision,
      renewalReviewId: review?.reviewId,
      headline: "Contract situation",
      lead:
        review?.reason === "age-decline"
          ? "The club will not renew as you enter the later stage of your career. You remain contracted until expiry and may seek a future club in the meantime."
          : "The club does not plan to offer a renewal at this stage. You remain contracted until expiry and may seek a future club in the meantime.",
      choices: [
        { id: "seek-move", label: "Seek a new club" },
        { id: "see-out", label: "See out the contract" },
      ],
      cooldownKind: "non-renewal",
    };
  }

  const [ageLo, ageHi] = SQUAD_REVIEW.developmentLoanAges;
  const fit = evaluateSportingFit(player, player.club, {
    seasonIndex,
    careerId: player.careerId || player.name,
    forceParent: true,
  });

  const lowMinutes =
    Boolean(minutes.usableForLowMinutes) && minutes.share < SQUAD_REVIEW.lowMinutesShare;
  const enoughEvidence =
    minutes.eligibleMatches >= SQUAD_REVIEW.midSeasonMinEligibleMatches ||
    opts.checkpoint === "pre-season";

  if (
    age >= ageLo &&
    age <= ageHi &&
    lowMinutes &&
    enoughEvidence &&
    (fit.projection.role === "prospect" || fit.projection.role === "cover" || fit.projection.role === "ineligible") &&
    !hasCooldown(player, "development-loan", seasonIndex)
  ) {
    const loans = generateLoanOffers(player, {
      maxOffers: 3,
      performanceScore: opts.performanceScore ?? 65,
      developmentRecommendation: true,
      currentProjectedShare: fit.projection.minutesShare,
    });
    return {
      decisionId: decisionId("development-loan", player, seasonIndex),
      kind: "development-loan",
      status: "pending",
      allowedChoices: ["review-loans", "stay-compete", "request-permanent"],
      employerClubId: player.employmentClubId || player.club?.clubId,
      contractRevision: player.contractRevision,
      headline: "Development discussion",
      lead:
        "The manager wants to discuss your development. We expect you to get limited first-team minutes this season. A loan could give you regular senior football. You can review the available clubs, stay and compete for your place, or ask us to consider a permanent move.",
      choices: [
        { id: "review-loans", label: "Review loan options", offers: loans.offers },
        { id: "stay-compete", label: "Stay and compete" },
        { id: "request-permanent", label: "Request a permanent move" },
      ],
      loanOffers: loans.offers,
      loanRejectionLog: loans.rejectionLog || [],
      cooldownKind: "development-loan",
      projectedHomeMinutes: fit.projection.minutesShare,
      playingTimeAssessment: minutes.assessment || null,
      minutesShare: minutes.share,
      eligibleMatches: minutes.eligibleMatches,
    };
  }

  if (
    lowMinutes &&
    enoughEvidence &&
    fit.projection.role === "ineligible" &&
    !hasCooldown(player, "surplus", seasonIndex)
  ) {
    const loans = generateLoanOffers(player, {
      maxOffers: 2,
      developmentRecommendation: true,
      currentProjectedShare: fit.projection.minutesShare,
    });
    return {
      decisionId: decisionId("surplus", player, seasonIndex),
      kind: "surplus",
      status: "pending",
      allowedChoices: ["seek-move", "review-loans", "remain"],
      employerClubId: player.employmentClubId || player.club?.clubId,
      contractRevision: player.contractRevision,
      headline: "Squad plans",
      lead:
        "You are outside current first-team plans while under contract. You can seek a permanent move, consider a suitable loan, or remain with a limited role.",
      choices: [
        { id: "seek-move", label: "Seek a transfer" },
        { id: "review-loans", label: "Consider a loan", offers: loans.offers },
        { id: "remain", label: "Remain at the club" },
      ],
      loanOffers: loans.offers,
      loanRejectionLog: loans.rejectionLog || [],
      cooldownKind: "surplus",
      playingTimeAssessment: minutes.assessment || null,
      minutesShare: minutes.share,
      eligibleMatches: minutes.eligibleMatches,
    };
  }

  if (
    fit.projection.role === "cover" ||
    fit.projection.role === "rotation"
  ) {
    if (hasCooldown(player, "stay-compete", seasonIndex)) return null;
    if (opts.checkpoint === "mid-season" && !lowMinutes) {
      return {
        decisionId: decisionId("stay-compete", player, seasonIndex),
        kind: "stay-compete",
        status: "pending",
        allowedChoices: ["acknowledge"],
        employerClubId: player.employmentClubId || player.club?.clubId,
        contractRevision: player.contractRevision,
        headline: "Role confirmed",
        lead: `The manager sees you as ${fit.projection.role} cover. Keep competing; the next formal review is scheduled later this season.`,
        choices: [{ id: "acknowledge", label: "Keep working" }],
        cooldownKind: "stay-compete",
        expectedRole: fit.projection.role,
      };
    }
  }

  return null;
}

function buildLoanEndingDecision(player, opts = {}) {
  const seasonIndex = opts.seasonIndex ?? player.seasons?.length ?? 0;
  if (hasCooldown(player, "loan-return", seasonIndex)) return null;
  // Unresolved parent boundary review owns the tray — never displace it with
  // loan-return / premature free-agency wording.
  if (player.pendingContractReview?.status === "pending") return null;
  if (opts.checkpoint !== "loan-return" && player.activeLoan?.endSeason !== seasonIndex) {
    return null;
  }
  const parentActive = isContractActive(player);
  return {
    decisionId: decisionId("loan-return", player, seasonIndex),
    kind: "loan-return",
    status: "pending",
    allowedChoices: parentActive
      ? ["reintegrate", "new-loan", "seek-sale"]
      : ["reintegrate"],
    employerClubId: player.employmentClubId || player.activeLoan?.parentClubId,
    contractRevision: player.contractRevision,
    headline: "Loan ending",
    lead: parentActive
      ? "Your loan spell is ending. The parent club will reassess: reintegration, a new loan, a sale, or preparing for free agency if your contract is nearly up."
      : "Your loan and parent contract are ending. You will become a free agent after settlement.",
    choices: parentActive
      ? [
          { id: "reintegrate", label: "Return to parent club" },
          { id: "new-loan", label: "Seek another loan" },
          { id: "seek-sale", label: "Ask to be sold" },
        ]
      : [{ id: "reintegrate", label: "Become a free agent" }],
    cooldownKind: "loan-return",
    loan: player.activeLoan,
  };
}

/**
 * Resolve a decision choice. Declining a loan keeps the live contract.
 */
export function resolveSquadDecision(player, decision, choiceId, opts = {}) {
  ensureContractAuthority(player);
  if (!decision) return { ok: false, reason: "no-decision" };

  const allowed =
    decision.allowedChoices ||
    (decision.choices || []).map((c) => c.id);
  if (allowed?.length && !allowed.includes(choiceId)) {
    return { ok: false, reason: "invalid-choice", allowed };
  }
  if (decision.status === "resolved" || decision.status === "superseded") {
    return { ok: false, reason: "decision-already-resolved" };
  }
  if (
    decision.decisionId &&
    player.pendingDecision?.decisionId &&
    player.pendingDecision.decisionId !== decision.decisionId &&
    !opts.allowStale
  ) {
    return { ok: false, reason: "stale-decision" };
  }

  const seasonIndex = opts.seasonIndex ?? player.seasons?.length ?? 0;
  setCooldown(player, decision.cooldownKind || decision.kind, seasonIndex);

  if (choiceId === "review-loans" || choiceId === "new-loan") {
    // Settle existing loan before offering a new one.
    if (player.activeLoan?.status === "active" && choiceId === "new-loan") {
      endLoan(player, "return");
    }
    const offers = decision.loanOffers || generateLoanOffers(player).offers;
    player.pendingOffers = offers;
    player.pendingDecision = null;
    return { ok: true, action: "show-loans", offers };
  }

  if (choiceId === "decline-renewal") {
    declineWindowAndContinue(player, { choiceId });
    const settled = settleBoundaryContractReview(player, {
      choice: "decline",
      reason: "declined-renewal",
    });
    return { ok: true, action: "released", settled };
  }

  if (choiceId === "accept-renewal") {
    // Leave renewal offers in the tray for the normal accept path.
    player.pendingDecision = null;
    return { ok: true, action: "show-renewal", offers: player.pendingOffers || [] };
  }

  if (choiceId === "stay-compete" || choiceId === "remain" || choiceId === "acknowledge" || choiceId === "see-out") {
    // See-out / stay while contract valid: decline related window offers and continue.
    if (choiceId === "see-out" || choiceId === "stay-compete" || choiceId === "remain") {
      declineWindowAndContinue(player, { choiceId });
    } else {
      player.pendingDecision = null;
    }
    return {
      ok: true,
      action: "stay",
      contractIntact: isContractActive(player),
      clearedOffers: true,
    };
  }

  if (choiceId === "request-permanent" || choiceId === "seek-move" || choiceId === "seek-sale") {
    if (player.activeLoan?.status === "active" && choiceId === "seek-sale") {
      // Settle loan before permanent sale pathway; employment stays with parent.
      endLoan(player, "return");
    }
    player.transferListed = true;
    player.pendingDecision = null;
    return { ok: true, action: "transfer-listed" };
  }

  if (choiceId === "reintegrate") {
    player.pendingDecision = null;
    return { ok: true, action: "reintegrate" };
  }

  return { ok: false, reason: "unknown-choice" };
}

/**
 * Attach a pending decision for resumable chronological simulation.
 */
export function queueSquadDecision(player, checkpoint = "pre-season", opts = {}) {
  const decision = evaluateSquadDecision(player, { ...opts, checkpoint });
  if (!decision) {
    // Loan-return that yields to a pending parent boundary review must not wipe
    // the owned renewal tray.
    if (
      checkpoint === "loan-return" &&
      player.pendingContractReview?.status === "pending" &&
      player.pendingDecision?.kind === "boundary-renewal"
    ) {
      return null;
    }
    player.pendingDecision = null;
    return null;
  }
  player.pendingDecision = {
    ...decision,
    checkpoint,
    queuedAtSeason: opts.seasonIndex ?? player.seasons?.length ?? 0,
  };
  return player.pendingDecision;
}
