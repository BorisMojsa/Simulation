/**
 * Authoritative contract / registration / renewal / offer / decision lifecycle.
 *
 * Time semantics (integer season model):
 * - `contractEndSeason = N` is a half-open upper bound.
 * - The contract is active while `completedSeasons(player) < N`.
 * - After a season completes that brings `seasons.length` to N, the contract is expired.
 * - Example: contractEndSeason = 1 covers only the first season (index 0).
 *
 * Legacy fields (`contractEndSeason`, `weeklyWage`, `wage`, `club`) remain projections
 * of this authority for compatibility — they must not contradict it.
 */
import { findSeniorClub, findSeniorClubById } from "./seniorClubs.js";
import { evaluateSportingFit } from "./recruitmentModel.js";
import { releaseWageCommitment, weeklyToAnnual, getOrInitClubSeasonFinance } from "./clubFinance.js";
import { safePlayerOverall } from "./playerOverallSafe.js";
import { ensurePlayingStints, recordPlayingTransition } from "./playingRegistration.js";

/** Local copy of renewal interest — avoid circular import with transferMarket. */
function calculateRenewalInterest(player, performanceScore) {
  let interest = (performanceScore - 50) / 50;
  interest += ((Number(player.rating) || 60) - 60) / 100;
  if ((Number(player.age) || 20) >= 35) interest -= (player.age - 34) * 0.1;
  return interest > 0.3 ? Math.min(1, interest) : 0;
}

export const CONTRACT_LIFECYCLE_VERSION = 1;

/** @typedef {'undecided'|'wants-renewal'|'will-not-renew'|'temporary-reject'} RenewalOutcome */
/** @typedef {'pending'|'accepted'|'declined'|'expired'|'superseded'} OfferStatus */
/** @typedef {'pending'|'resolved'|'superseded'} DecisionStatus */
/** @typedef {'active'|'expired'|'released'|'unsigned'} ContractStatus */

export function completedSeasons(player) {
  return player?.seasons?.length ?? 0;
}

export function remainingContractSeasons(player) {
  if (player?.contractEndSeason == null) return null;
  return player.contractEndSeason - completedSeasons(player);
}

/**
 * Half-open: active while completedSeasons < contractEndSeason.
 * Legacy players with a club but no term remain playable until migrated/released —
 * an unknown term is not treated as already expired.
 */
export function isContractActive(player) {
  if (!player || player.isRetired) return false;
  if (player.club?.isAcademy) return true;
  if (player.contractStatus === "released") return false;
  if (player.contractStatus === "unsigned" && !player.club) return false;
  if (player.contractEndSeason == null) {
    return Boolean(player.club && !player.club.isAcademy) || Boolean(player.employmentClubId);
  }
  if (player.contractStatus === "expired" && completedSeasons(player) >= player.contractEndSeason) {
    return false;
  }
  return completedSeasons(player) < player.contractEndSeason;
}

export function isFreeAgent(player) {
  if (!player || player.isRetired) return false;
  if (player.club?.isAcademy) return false;
  if (player.contractStatus === "released") return true;
  if (!player.club && !player.employmentClubId) return true;
  return !isContractActive(player);
}

export function employmentClubId(player) {
  return (
    player?.employmentClubId ||
    player?.parentClubSnapshot?.clubId ||
    (player?.activeLoan?.status === "active" ? player.activeLoan.parentClubId : null) ||
    (player?.club && !player.club.isLoanSpell ? player.club.clubId : null) ||
    null
  );
}

export function playingClubId(player) {
  return player?.playingClubId || player?.club?.clubId || null;
}

export function resolveEmploymentClub(player) {
  const id = employmentClubId(player);
  if (!id) return null;
  return findSeniorClubById(id) || findSeniorClub(id) || player.parentClubSnapshot || null;
}

/**
 * Initialise / migrate authoritative contract fields (idempotent).
 */
export function ensureContractAuthority(player) {
  if (!player || typeof player !== "object") return player;

  if (player.contractLifecycleVersion == null) {
    player.contractLifecycleVersion = CONTRACT_LIFECYCLE_VERSION;
  }

  if (!player.employmentClubId && player.club?.clubId && !player.club.isAcademy && !player.club.isLoanSpell) {
    player.employmentClubId = player.club.clubId;
  }
  if (!player.playingClubId && player.club?.clubId) {
    player.playingClubId = player.club.clubId;
  }
  ensurePlayingStints(player);

  if (!Number.isFinite(player.weeklyWage) && Number.isFinite(player.wage)) {
    player.weeklyWage = player.wage;
  }

  if (player.contractYears != null && player.contractEndSeason == null && player.contractStartSeason != null) {
    player.contractEndSeason = player.contractStartSeason + player.contractYears;
  }

  if (!player.contractRevision) {
    player.contractRevision = `ctr:${player.careerId || player.name || "p"}:${player.employmentClubId || "none"}:${player.contractEndSeason ?? "u"}:0`;
  }

  if (!player.renewalReview || typeof player.renewalReview !== "object") {
    player.renewalReview = {
      outcome: "undecided",
      reason: null,
      employerClubId: employmentClubId(player),
      contractRevision: player.contractRevision,
      reviewSeason: completedSeasons(player),
      reviewId: null,
    };
  }

  if (!Array.isArray(player.completedDealIds)) player.completedDealIds = [];
  if (!Array.isArray(player.consumedTransitionIds)) player.consumedTransitionIds = [];
  if (!player.offerJournal || typeof player.offerJournal !== "object") player.offerJournal = {};

  // Sync contractStatus from term without inventing renewals or auto-releasing.
  if (player.club?.isAcademy) {
    player.contractStatus = "unsigned";
  } else if (player.contractStatus === "released") {
    /* keep */
  } else if (player.contractEndSeason == null && !player.club && !player.employmentClubId) {
    player.contractStatus = player.contractStatus || "unsigned";
  } else if (
    player.contractEndSeason != null &&
    completedSeasons(player) >= player.contractEndSeason &&
    player.contractStatus !== "released"
  ) {
    player.contractStatus = "expired";
  } else if (player.club || player.employmentClubId) {
    player.contractStatus = "active";
  }

  // Legacy boolean must not invent non-renewal when review is undecided.
  if (player.renewalPlanned === false && player.renewalReview?.outcome === "undecided") {
    delete player.renewalPlanned;
  }

  return player;
}

/**
 * Sporting/role, age, performance, and affordability policy for renewal willingness.
 * Does not book money. Temporary finance failure ≠ firm non-renewal.
 */
export function evaluateRenewalReview(player, opts = {}) {
  ensureContractAuthority(player);
  const seasonIndex = opts.seasonIndex ?? completedSeasons(player);
  const rem =
    player.contractEndSeason == null ? 99 : player.contractEndSeason - seasonIndex;

  const employer = resolveEmploymentClub(player);
  const employerId = employer?.clubId || employmentClubId(player);

  const reviewId = `review:${player.careerId || player.name}:${employerId}:${player.contractRevision}:${seasonIndex}`;

  // Outside final year / expiry window — no firm review.
  if (rem > 1 || player.club?.isAcademy || !employerId) {
    const review = {
      outcome: "undecided",
      reason: rem > 1 ? "not-final-year" : "no-employer",
      employerClubId: employerId,
      contractRevision: player.contractRevision,
      reviewSeason: seasonIndex,
      reviewId,
    };
    player.renewalReview = review;
    return review;
  }

  // Preserve an already-firm review for this contract revision / window.
  const existing = player.renewalReview;
  if (
    existing &&
    existing.contractRevision === player.contractRevision &&
    existing.reviewSeason === seasonIndex &&
    (existing.outcome === "wants-renewal" || existing.outcome === "will-not-renew") &&
    !opts.forceReevaluate
  ) {
    return existing;
  }

  const performanceScore = opts.performanceScore ?? 70;
  const interest = calculateRenewalInterest(player, performanceScore);
  const age = Number(player.age) || 20;
  const ovr = safePlayerOverall(player);
  const fit = evaluateSportingFit(player, employer || player.club, {
    seasonIndex,
    careerId: player.careerId || player.name,
    forceParent: true,
  });
  const role = fit?.projection?.role || "cover";
  const ineligible = role === "ineligible";

  let outcome = "undecided";
  let reason = null;

  if (age >= 36 && interest < 0.35) {
    outcome = "will-not-renew";
    reason = "age-decline";
  } else if (ineligible && interest < 0.45) {
    outcome = "will-not-renew";
    reason = "surplus-role";
  } else if (interest <= 0) {
    outcome = "will-not-renew";
    reason = "performance-interest";
  } else if (opts.financeOk === false) {
    // Temporary affordability failure — not a firm club announcement.
    outcome = "temporary-reject";
    reason = opts.financeReason || "affordability";
  } else if (interest > 0.3 && !ineligible) {
    outcome = "wants-renewal";
    reason = "club-interest";
  } else if (interest > 0.3 && ineligible && ovr >= 72) {
    outcome = "wants-renewal";
    reason = "depth-cover";
  } else {
    outcome = "will-not-renew";
    reason = "insufficient-interest";
  }

  const review = {
    outcome,
    reason,
    employerClubId: employerId,
    contractRevision: player.contractRevision,
    reviewSeason: seasonIndex,
    reviewId,
    role,
    interest,
  };
  player.renewalReview = review;

  // Keep legacy field in sync only for firm outcomes.
  if (outcome === "wants-renewal") player.renewalPlanned = true;
  else if (outcome === "will-not-renew") player.renewalPlanned = false;
  else if (outcome === "temporary-reject") {
    // Do not set renewalPlanned=false — that created the Atalanta contradiction.
    delete player.renewalPlanned;
  }

  return review;
}

export function markOfferStatus(player, offer, status, extra = {}) {
  if (!offer) return;
  ensureContractAuthority(player);
  const id = offer.offerId || offer.acceptedTransactionId || `anon:${offer.clubId}:${offer.dealType}`;
  offer.status = status;
  offer.statusUpdatedAt = completedSeasons(player);
  player.offerJournal[id] = {
    status,
    offerId: id,
    clubId: offer.clubId,
    dealType: offer.dealType || (offer.isLoan ? "loan" : offer.isRenewal ? "renewal" : "permanent"),
    contractRevision: offer.contractRevision || player.contractRevision,
    careerId: player.careerId || player.name,
    employerClubIdAtIssue: offer.employerClubIdAtIssue || employmentClubId(player),
    ...extra,
  };
}

export function isOfferExecutable(player, offer) {
  ensureContractAuthority(player);
  if (!offer?.clubId) return { ok: false, reason: "missing-offer" };
  if (offer.status === "accepted" || offer.status === "declined" || offer.status === "expired" || offer.status === "superseded") {
    return { ok: false, reason: `offer-${offer.status}` };
  }
  const id = offer.offerId;
  if (id && player.offerJournal?.[id]?.status && player.offerJournal[id].status !== "pending") {
    return { ok: false, reason: `journal-${player.offerJournal[id].status}` };
  }
  if (offer.acceptedTransactionId && player.completedDealIds?.includes(offer.acceptedTransactionId)) {
    return { ok: false, reason: "duplicate-accept" };
  }
  if (id && player.consumedTransitionIds?.includes(`offer:${id}`)) {
    return { ok: false, reason: "consumed-offer" };
  }
  // Stale employer renewal after a move.
  if (offer.isRenewal) {
    const emp = employmentClubId(player);
    if (emp && offer.clubId !== emp) {
      return { ok: false, reason: "stale-employer-renewal" };
    }
    if (offer.contractRevision && offer.contractRevision !== player.contractRevision) {
      return { ok: false, reason: "stale-contract-revision" };
    }
  }
  // Career scope
  if (offer.careerId && player.careerId && offer.careerId !== player.careerId) {
    return { ok: false, reason: "wrong-career" };
  }
  return { ok: true };
}

/**
 * Release employment/playing registration and old wages exactly once.
 */
export function releaseToFreeAgency(player, reason = "contract-expired") {
  ensureContractAuthority(player);
  const transitionId = `release:${player.careerId || player.name}:${player.contractRevision}:${reason}`;
  if (player.consumedTransitionIds.includes(transitionId)) {
    return { ok: true, duplicate: true, reason: "already-released" };
  }

  const seasonKey = String((player.startYear || 2026) + completedSeasons(player));
  const empId = employmentClubId(player);
  const wage = Number.isFinite(player.weeklyWage) ? player.weeklyWage : 0;

  if (empId && wage > 0) {
    try {
      const ledger = getOrInitClubSeasonFinance(empId, seasonKey);
      releaseWageCommitment(ledger, weeklyToAnnual(wage), 1);
    } catch {
      /* finance optional during tests without profiles */
    }
  }

  // Preserve history — do not wipe seasons.
  const releaseDate = `${(player.startYear || 2026) + completedSeasons(player)}-06-30`;
  ensurePlayingStints(player, { asOfDate: releaseDate });
  recordPlayingTransition(player, {
    effectiveDate: releaseDate,
    playingClubId: null,
    employmentClubId: null,
    kind: "release",
    onLoan: false,
  });
  player.club = null;
  player.employmentClubId = null;
  player.playingClubId = null;
  player.parentClubSnapshot = null;
  if (player.activeLoan?.status === "active") {
    player.activeLoan = { ...player.activeLoan, status: "expired" };
  }
  player.weeklyWage = 0;
  player.wage = 0;
  player.contractStatus = "released";
  player.freeAgentReason = reason;
  player.freeAgentSinceSeason = completedSeasons(player);
  player.renewalReview = {
    outcome: "undecided",
    reason: "free-agent",
    employerClubId: null,
    contractRevision: player.contractRevision,
    reviewSeason: completedSeasons(player),
    reviewId: null,
  };
  delete player.renewalPlanned;
  player.consumedTransitionIds.push(transitionId);

  return { ok: true, reason, transitionId };
}

/**
 * Call after a season completes (history already written under the old clubs).
 * Releases if the term has ended and no new deal was signed.
 */
export function applyContractExpiryAtBoundary(player) {
  ensureContractAuthority(player);
  if (player.club?.isAcademy) return { ok: true, action: "academy" };
  if (player.contractStatus === "released") return { ok: true, action: "already-free" };
  if (player.contractEndSeason == null) return { ok: true, action: "unsigned" };

  if (completedSeasons(player) >= player.contractEndSeason) {
    // If still on loan when parent term ends, settle via free agency.
    return { ...releaseToFreeAgency(player, "contract-expired"), action: "released" };
  }
  return { ok: true, action: "still-active" };
}

/**
 * Gate before starting/resuming a season or attaching club fixtures.
 */
export function assertPlayableRegistration(player) {
  ensureContractAuthority(player);
  if (player.isRetired) return { ok: false, reason: "retired" };
  if (player.club?.isAcademy) return { ok: true, mode: "academy" };
  if (isFreeAgent(player) || !player.club) {
    return { ok: false, reason: "free-agent", mode: "free-agent" };
  }
  if (!isContractActive(player)) {
    return { ok: false, reason: "contract-expired", mode: "free-agent" };
  }
  return { ok: true, mode: "contracted", clubId: playingClubId(player) };
}

/**
 * Consume related pending decision/offers after a successful acceptance.
 */
export function consumeRelatedDecisionAfterDeal(player, offer) {
  ensureContractAuthority(player);
  if (offer?.offerId) {
    markOfferStatus(player, offer, "accepted");
    const tid = `offer:${offer.offerId}`;
    if (!player.consumedTransitionIds.includes(tid)) player.consumedTransitionIds.push(tid);
  }

  const decision = player.pendingDecision;
  if (decision) {
    const related =
      decision.kind === "non-renewal" ||
      decision.kind === "development-loan" ||
      decision.kind === "surplus" ||
      decision.kind === "loan-return" ||
      (offer?.isRenewal && decision.kind === "non-renewal");
    if (related || offer?.isRenewal || offer?.isLoan) {
      player.pendingDecision = null;
    }
  }

  // Clear other pending offers in this window (accepted path closes the tray).
  for (const o of player.pendingOffers || []) {
    if (o !== offer && o.status !== "accepted") markOfferStatus(player, o, "superseded");
  }
  player.pendingOffers = [];
}

/**
 * Decline remaining offers and continue (see-out / stay while contract active).
 */
export function declineWindowAndContinue(player, opts = {}) {
  ensureContractAuthority(player);
  for (const o of player.pendingOffers || []) {
    markOfferStatus(player, o, "declined");
  }
  player.pendingOffers = [];
  if (player.pendingDecision) {
    player.pendingDecision = {
      ...player.pendingDecision,
      status: "resolved",
      resolvedChoice: opts.choiceId || "see-out",
    };
    player.pendingDecision = null;
  }
  return { ok: true, action: "continue", contractActive: isContractActive(player) };
}

/**
 * Bump contract revision after a successful term change.
 */
export function bumpContractRevision(player) {
  const n = Number(String(player.contractRevision || "").split(":").pop()) || 0;
  player.contractRevision = `ctr:${player.careerId || player.name || "p"}:${employmentClubId(player) || "none"}:${player.contractEndSeason ?? "u"}:${n + 1}`;
  return player.contractRevision;
}

/**
 * Apply a renewal: extend employer term without changing playing club on loan.
 */
export function applyRenewalTerms(player, offer) {
  ensureContractAuthority(player);
  const currentSeason = completedSeasons(player);
  const years = offer.contractYears || 1;
  player.weeklyWage = offer.wage;
  player.wage = offer.wage;
  player.expectedRole = offer.expectedRole || player.expectedRole;
  player.contractStartSeason = currentSeason;
  player.contractYears = years;
  player.contractEndSeason = currentSeason + years;
  player.contractStatus = "active";
  player.employmentClubId = offer.clubId || employmentClubId(player);
  bumpContractRevision(player);
  player.renewalReview = {
    outcome: "undecided",
    reason: "renewed",
    employerClubId: player.employmentClubId,
    contractRevision: player.contractRevision,
    reviewSeason: currentSeason,
    reviewId: null,
  };
  player.renewalPlanned = true;
  // On loan: keep borrower as playing club.
  if (player.activeLoan?.status === "active") {
    // playingClubId / player.club stay as borrower
  } else {
    // Not on loan — employment and playing club stay the employer.
    player.playingClubId = player.employmentClubId;
  }
  return { ok: true };
}

/**
 * Free-agent wait/train: advance simulated clock without old-club football.
 */
export function advanceFreeAgentPeriod(player, opts = {}) {
  ensureContractAuthority(player);
  if (!isFreeAgent(player) && player.club) {
    return { ok: false, reason: "not-free-agent" };
  }

  const seasons = Math.max(1, opts.seasons || 1);
  const year = (player.startYear || 2026) + completedSeasons(player);

  for (let i = 0; i < seasons; i++) {
    player.age = (Number(player.age) || 18) + 1;
    // Light training / maintenance — no club appearances.
    if (player.state) {
      player.state.fatigue = Math.max(0, (player.state.fatigue || 0) * 0.5);
      player.state.form = Math.max(-0.5, Math.min(0.5, (player.state.form || 0) * 0.7));
    }
    const seasonNumber = completedSeasons(player) + 1;
    const seasonRecord = {
      seasonId: `free-agent-${seasonNumber}`,
      seasonNumber,
      year: year + i,
      age: player.age,
      club: null,
      clubName: "Free agent",
      clubDisplay: "Free agent",
      league: null,
      leagueDisplay: "No league fixtures",
      matches: 0,
      starts: 0,
      minutes: 0,
      goals: 0,
      assists: 0,
      cleanSheets: 0,
      freeAgent: true,
      freeAgentReason: player.freeAgentReason || "contract-expired",
      avgMatchRating: null,
    };
    if (!player.seasons) player.seasons = [];
    player.seasons.push(seasonRecord);
    if (!player.careerTotals) {
      player.careerTotals = { matches: 0, goals: 0, assists: 0, cleanSheets: 0 };
    }
  }

  // Reset review opportunity for next market window.
  player.renewalReview = {
    outcome: "undecided",
    reason: "free-agent-wait",
    employerClubId: null,
    contractRevision: player.contractRevision,
    reviewSeason: completedSeasons(player),
    reviewId: null,
  };

  return {
    ok: true,
    action: "free-agent-wait",
    seasonsAdvanced: seasons,
    age: player.age,
    nextAction: "search-market",
  };
}

/**
 * Shared next-action selector for UI and automated policies.
 */
export function selectNextCareerAction(player) {
  ensureContractAuthority(player);
  if (player.isRetired) {
    return { id: "retired", label: "Career complete", canSimulate: false };
  }
  if (player.pendingSeniorScenario) {
    return { id: "resolve-scenario", label: "Resolve scene", canSimulate: false };
  }
  if (player.seasonCheckpoint?.status === "awaiting_scenario") {
    return { id: "resolve-scenario", label: "Resolve scene", canSimulate: false };
  }
  if (player.pendingDecision) {
    return { id: "resolve-decision", label: "Resolve squad discussion", canSimulate: false };
  }
  if (player.pendingOffers?.length > 0) {
    return { id: "resolve-offers", label: "Review offers", canSimulate: false };
  }
  if (player.seasonCheckpoint?.status === "awaiting_decision") {
    return { id: "resume-season", label: "Continue season", canSimulate: true };
  }
  if (isFreeAgent(player) || !player.club) {
    return {
      id: "free-agent",
      label: "Search / train as free agent",
      canSimulate: true,
      mode: "free-agent",
    };
  }
  if (player.club?.isAcademy) {
    const life = player.academyLifecycle;
    const exitAge = Number(life?.exitAge) || 21;
    if (life?.status === "pending-final-review" || (life?.pendingReview?.isFinal && life?.pendingReviewId)) {
      return {
        id: "academy-final-review",
        label: "Review final academy offers",
        canSimulate: false,
        mode: "academy",
      };
    }
    if (life?.status === "pending-review" && (player.pendingOffers?.length || 0) > 0) {
      return {
        id: "academy-review",
        label: "Review academy contract offers",
        canSimulate: false,
        mode: "academy",
      };
    }
    if ((Number(player.age) || 0) >= exitAge) {
      return {
        id: "academy-exit",
        label: "Resolve academy exit",
        canSimulate: true,
        mode: "academy",
      };
    }
    return {
      id: "academy-season",
      label: "Continue academy training",
      canSimulate: true,
      mode: "academy",
    };
  }
  return { id: "start-season", label: "Simulate next season", canSimulate: true };
}

/**
 * Human-readable club line for overview.
 */
export function describeRegistration(player) {
  ensureContractAuthority(player);
  if (player.club?.isAcademy) {
    return {
      playingLabel: player.club.displayName || player.club.name || "Academy",
      leagueLabel: player.club.leagueDisplay || player.club.league || "Academy",
      employerLabel: null,
      wage: 0,
      statusLabel: "Academy",
      contractLabel: "Youth registration",
    };
  }
  if (isFreeAgent(player) || !player.club) {
    return {
      playingLabel: "Free agent",
      leagueLabel: "No club",
      employerLabel: null,
      wage: 0,
      statusLabel: "Free agent",
      contractLabel: player.freeAgentReason || "No contract",
    };
  }
  const onLoan = player.activeLoan?.status === "active";
  const employer = resolveEmploymentClub(player);
  const employerLabel = onLoan
    ? employer?.displayName || employer?.name || player.parentClubSnapshot?.displayName || player.parentClubSnapshot?.name || null
    : null;
  const rem = remainingContractSeasons(player);
  return {
    playingLabel: player.club.displayName || player.club.name,
    leagueLabel: player.club.leagueDisplay || player.club.league || "Unknown League",
    employerLabel,
    wage: Number.isFinite(player.weeklyWage) ? player.weeklyWage : 0,
    statusLabel: onLoan ? "On loan" : "Contracted",
    contractLabel:
      rem == null
        ? "Contract term unknown"
        : rem <= 0
          ? "Contract expired"
          : `${rem} season${rem === 1 ? "" : "s"} remaining`,
  };
}

/**
 * Whether nationality should show as "international" (capped / called up).
 */
export function hasInternationalStatus(player) {
  if (player?.internationalCaps > 0) return true;
  if (player?.nationalTeam?.caps > 0) return true;
  if (player?.careerHonors?.internationalTitles > 0) return true;
  const seasons = player?.seasons || [];
  return seasons.some((s) => s.internationalSeason?.calledUp || s.international?.calledUp);
}
