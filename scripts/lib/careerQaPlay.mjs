import { ACADEMY_POOL, LEAGUES, LEAGUE_LOOKUP } from "../../js/data/leagues.js";
import {
  applySkipOpeningDevelopment,
  createPlayerIdentity,
  finalizeAcademyPlayer,
} from "../../js/simulation/playerDevelopment.js";
import { simulateFullAcademyOpening } from "../../js/simulation/academyOpening.js";
import {
  acceptAcademyGraduationOffer,
  declineAcademyReview,
  ensureAcademyLifecycle,
} from "../../js/simulation/academyLifecycle.js";
import { buildNarrativeAcademySeason, pickThreeAcademies } from "../../js/simulation/narrativeAcademySeason.js";
import {
  buildFirstProContractDecision,
  signFirstProfessionalContract,
} from "../../js/simulation/proContractOffers.js";
import { createRng, getSimRng, hashSeed } from "../../js/simulation/rng.js";
import { createWorldState, setWorldState } from "../../js/simulation/worldState.js";
import { ensurePlayerModel } from "../../js/simulation/playerModelMigration.js";
import { ensureTransferSave } from "../../js/simulation/transferMigration.js";
import { simulateSeason } from "../../js/simulation/seasonSimulator.js";
import { acceptPipelineOffer } from "../../js/simulation/dealPipeline.js";
import { generateTransferOffers } from "../../js/simulation/transferMarket.js";
import { startLoan } from "../../js/simulation/loanMarket.js";
import {
  declineWindowAndContinue,
  ensureContractAuthority,
  isFreeAgent,
  selectNextCareerAction,
  settleBoundaryContractReview,
} from "../../js/simulation/contractLifecycle.js";
import { queueSquadDecision, resolveSquadDecision } from "../../js/simulation/squadDecisions.js";
import { applySeniorScenarioPolicy, ensureSeniorCareerState } from "../../js/simulation/seniorCareerScenarios.js";
import { getBaseOverall, getCurrentOverall } from "../../js/simulation/playerAbility.js";
import { roundAbilityForDisplay } from "../../js/ui/abilityFormatting.js";
import { validateDriverGuard, validateDriverSeasonResult } from "./fix11GrowthEvidence.mjs";
import { resetCareerState, withDeterministicClock } from "./careerQaClock.mjs";
import { CAREER_QA_POLICY_VERSION } from "./careerQaManifest.mjs";

const RETIREMENT_ODDS = {
  35: 0.06,
  36: 0.1,
  37: 0.18,
  38: 0.28,
  39: 0.45,
  40: 0.65,
  41: 0.85,
};

const MAX_STEPS = 80;
const DRAIN_GUARD = 100;

function sampleOvr(player, stage, extra = {}) {
  const base = getBaseOverall(player);
  const current = getCurrentOverall(player);
  const rating = Number(player?.rating);
  // Production desk headline uses currentOverall ?? rating via abilityFormatting;
  // __getLiveCareerDebug().ovrDisplay rounds player.rating (legacy mirror).
  const deskCurrent = Number.isFinite(current)
    ? roundAbilityForDisplay(current)
    : Number.isFinite(rating)
      ? roundAbilityForDisplay(rating)
      : null;
  const deskOvrDisplay = Number.isFinite(rating) ? Math.round(rating) : deskCurrent;
  return {
    stage,
    age: player?.age ?? null,
    periodCount: player?.seasons?.length ?? 0,
    base: Number.isFinite(base) ? base : null,
    current: Number.isFinite(current) ? current : null,
    deskBase: Number.isFinite(base) ? roundAbilityForDisplay(base) : null,
    deskCurrent,
    deskOvrDisplay,
    // Back-compat alias: desk = rendered current ability on the career desk
    desk: deskCurrent,
    nonFinite: !Number.isFinite(base) || !Number.isFinite(current),
    ...extra,
  };
}

function trackPeaks(peaks, sample) {
  if (sample.base != null && Number.isFinite(sample.base) && (peaks.base == null || sample.base > peaks.base.value)) {
    peaks.base = { value: sample.base, age: sample.age, stage: sample.stage, periodCount: sample.periodCount };
  }
  if (sample.current != null && Number.isFinite(sample.current) && (peaks.current == null || sample.current > peaks.current.value)) {
    peaks.current = { value: sample.current, age: sample.age, stage: sample.stage, periodCount: sample.periodCount };
  }
}

function academyOfferId(offer) {
  const a = offer?.academy || offer;
  return a?.academyId || a?.clubId || a?.id || a?.name || null;
}

function offerExecutableCount(offers) {
  return (offers || []).filter(Boolean).length;
}

function styleChooseDecision(decision, style, rng) {
  const choices = decision?.allowedChoices || (decision?.choices || []).map((c) => c.id);
  if (!choices?.length) return null;
  const preferred =
    style === "loan-heavy"
      ? ["review-loans", "new-loan", "accept-renewal", "stay-compete", "remain", "see-out", "acknowledge"]
      : style === "loyal"
        ? ["stay-compete", "remain", "accept-renewal", "see-out", "reject", "acknowledge"]
        : style === "ambitious"
          ? ["accept-renewal", "review-loans", "stay-compete", "remain", "see-out", "acknowledge"]
          : ["accept-renewal", "review-loans", "stay-compete", "remain", "see-out", "acknowledge"];
  const hit = preferred.find((id) => choices.includes(id));
  if (hit) return hit;
  return rng.pick(choices);
}

function rankOffers(offers, style, rng) {
  const list = [...(offers || [])].filter(Boolean);
  const score = (offer) => {
    const minutes = Number(offer.projectedMinutesShare) || Number(offer.projectedMinutesRange?.[0]) / 4000 || 0;
    const role = { starter: 4, rotation: 3, prospect: 2, cover: 1 }[offer.expectedRole] || 0;
    const wages = Math.log1p(Math.max(0, Number(offer.wage) || 0)) / 20;
    const loanBoost = offer.isLoan ? 1 : 0;
    const renewalBoost = offer.isRenewal ? 1 : 0;
    if (style === "loyal") return renewalBoost * 5 + minutes + role + wages * 0.2;
    if (style === "ambitious") return (!offer.isLoan && !offer.isRenewal ? 4 : 0) + minutes * 3 + role + wages;
    if (style === "loan-heavy") return loanBoost * 20 + minutes * 4 + role + wages * 0.5;
    if (style === "journeyman") return (!offer.isRenewal ? 3 : 0) + minutes * 2 + role + wages + rng.float(0, 0.01);
    return minutes * 2 + role + wages + rng.float(0, 1);
  };
  return list
    .map((offer) => ({ offer, score: score(offer) }))
    .sort((a, b) => b.score - a.score || String(a.offer.offerId || "").localeCompare(String(b.offer.offerId || "")))
    .map((row) => row.offer);
}

function shouldAcceptTopOffer(style, rng, top) {
  if (!top) return false;
  if (style === "loyal") return Boolean(top.isRenewal) || rng.chance(0.12);
  if (style === "ambitious") return true;
  if (style === "loan-heavy") return Boolean(top.isLoan) || rng.chance(0.45);
  if (style === "journeyman") return true;
  return rng.chance(0.45);
}

function acknowledgeResolvedScenario(player, pending) {
  if (!pending?.resolved || !pending.abilityReceipt || !pending.chosenOptionId) {
    return { ok: false, reason: "scenario-not-fully-resolved" };
  }
  if (player.pendingSeniorScenario !== pending) {
    return { ok: false, reason: "scenario-identity-mismatch" };
  }
  player.pendingSeniorScenario = null;
  return { ok: true, action: "scenario-acknowledged" };
}

function acceptOfferLikeLiveDesk(player, offer) {
  if (offer?.isLoan) return startLoan(player, offer);
  if (
    player.club?.isAcademy &&
    (offer.academyReviewId || offer.isFirstPro || offer.dealType === "first_pro" || player.academyLifecycle?.pendingReview)
  ) {
    return acceptAcademyGraduationOffer(player, {
      offer,
      kind: offer.isParentOffer ? "parent" : "counter",
      club: null,
    });
  }
  return acceptPipelineOffer(player, offer);
}

function recordMarketReview(market, player, offers, { source = "desk-generate" } = {}) {
  const reviewId =
    player.lastMarketReviewId ||
    player.freeAgentSpell?.lastReviewId ||
    player.pendingContractReview?.id ||
    player.academyLifecycle?.pendingReview?.id ||
    `review:${player.age}:${(offers || []).length}:${hashSeed(
      JSON.stringify((offers || []).map((o) => o.offerId || o.clubId || o.club))
    )}`;
  const executable = offerExecutableCount(offers);
  if (market.seenReviewIds?.has(reviewId)) {
    return { reviewId, executable, duplicate: true };
  }
  market.seenReviewIds = market.seenReviewIds || new Set();
  market.seenReviewIds.add(reviewId);
  const reviewRecord = {
    reviewId,
    age: player.age,
    executableOfferCount: executable,
    freeAgent: isFreeAgent(player),
    source,
    open: executable > 0 || Boolean(player.pendingContractReview?.status === "pending"),
  };
  market.reviews.push(reviewRecord);
  if (isFreeAgent(player)) {
    if (!market.currentSpell) {
      market.currentSpell = { startAge: player.age, emptyStreak: 0, reviews: [] };
      market.spells.push(market.currentSpell);
    }
    if (executable === 0) {
      market.currentSpell.emptyStreak += 1;
      market.lastCountedReviewId = reviewId;
      market.emptyReviews += 1;
    } else {
      market.currentSpell.emptyStreak = 0;
      market.lastCountedReviewId = reviewId;
      market.validOfferReviews += 1;
    }
    market.currentSpell.reviews.push(reviewId);
  }
  return { reviewId, executable, duplicate: false, reviewRecord };
}

/** Mirror main.js finalizeCompletedSeasonUi market generation (once per completed period). */
function applyDeskMarketGeneration(player, seasonData) {
  if (!seasonData?.season) return player.pendingOffers || [];
  if (
    (seasonData.pendingContractReview || player.pendingContractReview?.status === "pending") &&
    !seasonData.season
  ) {
    return player.pendingOffers || [];
  }
  const isAcademyResult =
    seasonData.academyPeriod ||
    seasonData.reviewOnly ||
    Boolean(seasonData.season?.isNarrativeAcademyYear) ||
    Boolean(seasonData.season?.academyPeriod) ||
    Boolean(seasonData.resultKind?.startsWith?.("academy"));
  if (isAcademyResult) {
    if (player.club?.isAcademy) ensureAcademyLifecycle(player);
    return player.pendingOffers || [];
  }
  if (player.pendingContractReview?.status === "pending") {
    if (!player.pendingDecision && (player.pendingOffers?.length || 0) > 0) {
      return player.pendingOffers;
    }
    if (!player.pendingDecision) {
      player.pendingOffers = generateTransferOffers(
        seasonData.performanceScore,
        player,
        LEAGUES,
        LEAGUE_LOOKUP,
        seasonData.season?.avgMatchRating ?? null
      );
    }
    return player.pendingOffers || [];
  }
  player.pendingOffers = generateTransferOffers(
    seasonData.performanceScore,
    player,
    LEAGUES,
    LEAGUE_LOOKUP,
    seasonData.season?.avgMatchRating ?? null
  );
  if (!player.pendingDecision && !player.club?.isAcademy) {
    queueSquadDecision(player, "pre-season", {
      seasonIndex: player.seasons.length,
      performanceScore: seasonData.performanceScore,
    });
  }
  return player.pendingOffers || [];
}

function resolveOffers(player, style, rng, decisions, market) {
  const pending = player.pendingOffers || [];
  const recorded = recordMarketReview(market, player, pending, { source: "resolve-offers" });
  const reviewId = recorded.reviewId;
  const executable = recorded.executable;
  const reviewRecord = recorded.reviewRecord || market.reviews[market.reviews.length - 1];

  if (player.club?.isAcademy && player.academyLifecycle?.pendingReview) {
    const ranked = rankOffers(pending, style, rng);
    for (const offer of ranked) {
      const deal =
        player.academyLifecycle.pendingReview.offers?.find((c) => (c.offer || c).offerId === offer.offerId) || offer;
      const result = acceptAcademyGraduationOffer(player, deal);
      decisions.push({
        kind: "academy-offer",
        reviewId,
        alternatives: ranked.map((o) => o.offerId || academyOfferId(o)),
        choice: offer.offerId,
        result: result?.ok ? "accepted" : result?.reason || "failed",
      });
      if (result.ok) {
        market.signings += 1;
        if (reviewRecord) reviewRecord.open = false;
        market.currentSpell = null;
        return { ok: true, action: "academy-offer-accepted", offerId: offer.offerId, signed: true };
      }
      market.failedAccepts += 1;
    }
    const declined = declineAcademyReview(player, { reason: "career-qa-policy-declined" });
    decisions.push({
      kind: "academy-review-decline",
      reviewId,
      choice: "decline",
      result: declined?.ok ? "declined" : declined?.reason || "failed",
    });
    market.refusals += 1;
    if (reviewRecord) reviewRecord.open = false;
    return declined?.ok ? { ok: true, action: "academy-review-declined" } : { ok: false, reason: declined?.reason };
  }

  const ranked = rankOffers(pending, style, rng);
  const top = ranked[0];
  if (top && shouldAcceptTopOffer(style, rng, top)) {
    const result = acceptOfferLikeLiveDesk(player, top);
    decisions.push({
      kind: "offer",
      reviewId,
      alternatives: ranked.map((o) => o.offerId),
      choice: top.offerId,
      result: result?.ok ? "accepted" : result?.reason || "failed",
      dealType: top.dealType || (top.isLoan ? "loan" : top.isRenewal ? "renewal" : "permanent"),
    });
    if (result?.ok) {
      market.signings += 1;
      if (reviewRecord) reviewRecord.open = false;
      market.currentSpell = null;
      market.moves.push({
        age: player.age,
        offerId: top.offerId,
        club: top.clubDisplay || top.club,
        clubId: top.clubId || null,
        dealType: top.dealType || (top.isLoan ? "loan" : top.isRenewal ? "renewal" : "permanent"),
        employmentClubId: player.employmentClubId || null,
        playingClubId: player.playingClubId || player.club?.clubId || null,
        loanActive: player.activeLoan?.status === "active",
      });
      player.pendingOffers = [];
      return { ok: true, action: "offer-accepted", offerId: top.offerId, signed: true };
    }
    market.failedAccepts += 1;
  }

  const declined = declineWindowAndContinue(player, { choiceId: "see-out" });
  decisions.push({
    kind: "offer-decline",
    reviewId,
    alternatives: ranked.map((o) => o.offerId),
    choice: "see-out",
    result: declined?.ok ? "declined" : declined?.reason || "failed",
  });
  if (executable > 0) market.refusals += 1;
  if (reviewRecord) reviewRecord.open = Boolean(player.pendingOffers?.length || player.pendingContractReview?.status === "pending");
  return declined?.ok ? { ok: true, action: "offers-declined" } : { ok: false, reason: declined?.reason };
}

function resolveActionBeforeSeason(player, style, rng, decisions, market) {
  const action = selectNextCareerAction(player);
  if (action.canSimulate) return { ok: true, action: "simulate", nextAction: action.id };
  if (action.id === "retired") return { ok: true, action: "retired", nextAction: action.id };
  if (action.id === "resolve-scenario") {
    const pending = player.pendingSeniorScenario || player.seasonCheckpoint?.pendingSeniorScenario;
    if (!pending) return { ok: false, reason: "scenario-action-without-scenario" };
    if (!pending.resolved) {
      const result = applySeniorScenarioPolicy(player, pending, "balanced");
      if (!result?.ok) return { ok: false, reason: `scenario-resolution:${result?.reason || "failed"}` };
    }
    const ack = acknowledgeResolvedScenario(player, pending);
    decisions.push({ kind: "scenario", choice: pending.chosenOptionId || "balanced", result: ack.ok ? "acknowledged" : ack.reason });
    return ack.ok ? { ok: true, action: ack.action, nextAction: action.id } : { ok: false, reason: ack.reason };
  }
  if (action.id === "resolve-decision") {
    const choice = styleChooseDecision(player.pendingDecision, style, rng);
    if (!choice) return { ok: false, reason: "decision-without-valid-choice" };
    const result = resolveSquadDecision(player, player.pendingDecision, choice);
    decisions.push({
      kind: "decision",
      alternatives: player.pendingDecision?.allowedChoices || (player.pendingDecision?.choices || []).map((c) => c.id),
      choice,
      result: result?.ok ? result.action || "ok" : result?.reason || "failed",
    });
    return result?.ok ? { ok: true, action: result.action, nextAction: action.id } : { ok: false, reason: `decision:${result?.reason}` };
  }
  if (action.id === "resolve-offers" || action.id === "academy-review" || action.id === "academy-final-review") {
    const result = resolveOffers(player, style, rng, decisions, market);
    return result?.ok ? { ok: true, action: result.action, nextAction: action.id } : { ok: false, reason: `offers:${result?.reason}` };
  }
  if (action.id === "resolve-contract-review") {
    const result = settleBoundaryContractReview(player, { choice: "no-offer", reason: "career-qa-no-executable-offer" });
    decisions.push({
      kind: "contract-review",
      reviewId: player.pendingContractReview?.id || null,
      choice: "no-offer",
      result: result?.ok ? result.action || "ok" : result?.reason || "failed",
    });
    return result?.ok ? { ok: true, action: result.action, nextAction: action.id } : { ok: false, reason: `contract-review:${result?.reason}` };
  }
  return { ok: false, reason: `unsupported-next-action:${action.id}`, nextAction: action.id };
}

function classifyPresentation(result) {
  if (!result) return { kind: "null", validClub: false };
  if (result.awaitingScenario || result.awaitingDecision || result.pendingContractReview) {
    return { kind: "paused", commits: false, validClub: false };
  }
  if (result.academyPeriod || result.kind === "academy-period" || result.season?.academy) {
    return { kind: "academy", commits: Boolean(result.season), validClub: false };
  }
  if (result.freeAgent) {
    return {
      kind: "free-agent",
      commits: Boolean(result.season),
      validNoTable: !result.league && !result.standings,
      validClub: false,
    };
  }
  const hasTables = Boolean(result.league && result.standings && result.season);
  return {
    kind: "club",
    commits: hasTables,
    validClub: hasTables,
    invalidClubPayload: Boolean(result.season) && !hasTables,
  };
}

function isZeroCommitGateResult(result) {
  if (!result) return false;
  if (result.reviewOnly) return true;
  if ((result.pendingContractReview || result.pendingContractReview === true) && !result.season) return true;
  if (result.pendingContractReview && !result.season) return true;
  return false;
}

function drainOneSeason(player, style, rng, decisions, market, presentationNotes) {
  let checkpoint = player.seasonCheckpoint || null;
  let guard = 0;
  const startSeasonCount = player.seasons?.length || 0;

  while (guard++ < DRAIN_GUARD) {
    if (!checkpoint) {
      const pre = resolveActionBeforeSeason(player, style, rng, decisions, market);
      if (!pre.ok) return { ok: false, reason: pre.reason, guard, nextAction: pre.nextAction || selectNextCareerAction(player)?.id };
      if (pre.action === "retired") return { ok: true, retired: true, completed: false, guard };
      if (pre.action !== "simulate") {
        // Academy / parent-contract / offer gates: zero period commits.
        checkpoint = player.seasonCheckpoint || null;
        continue;
      }
    }

    let result;
    try {
      result = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
        pauseForDecisions: true,
        autoDecisionPolicy: null,
        checkpoint,
      });
    } catch (error) {
      return {
        ok: false,
        reason: "production-season-throw",
        error: String(error?.message || error),
        guard,
      };
    }

    const presentation = classifyPresentation(result);
    presentationNotes.push(presentation);

    // Parent-contract / academy review-only: resolve gate, do not count a period.
    if (isZeroCommitGateResult(result)) {
      decisions.push({
        kind: "zero-commit-gate",
        result: result.pendingContractReview ? "pending-contract-review" : "review-only",
      });
      if (player.pendingContractReview?.status === "pending" || result.pendingContractReview) {
        const settled = settleBoundaryContractReview(player, {
          choice: "no-offer",
          reason: "career-qa-zero-commit-gate",
        });
        if (!settled?.ok) {
          return { ok: false, reason: `zero-commit-contract:${settled?.reason || "failed"}`, guard };
        }
      } else if (selectNextCareerAction(player)?.id?.includes("academy")) {
        const gate = resolveOffers(player, style, rng, decisions, market);
        if (!gate?.ok) return { ok: false, reason: `zero-commit-academy:${gate?.reason}`, guard };
      }
      checkpoint = null;
      player.seasonCheckpoint = null;
      continue;
    }

    if (result?.awaitingScenario) {
      const pending = player.pendingSeniorScenario || result.pendingSeniorScenario;
      if (!pending) return { ok: false, reason: "awaiting-scenario-without-payload", guard };
      const resolution = pending.resolved ? { ok: true } : applySeniorScenarioPolicy(player, pending, "balanced");
      if (!resolution?.ok) return { ok: false, reason: `scenario:${resolution?.reason || "failed"}`, guard };
      const acknowledged = acknowledgeResolvedScenario(player, pending);
      if (!acknowledged.ok) return { ok: false, reason: `scenario-acknowledge:${acknowledged.reason}`, guard };
      decisions.push({ kind: "scenario-mid", choice: pending.chosenOptionId || "balanced", result: "acknowledged" });
      checkpoint = result.checkpoint;
      continue;
    }
    if (result?.awaitingDecision) {
      if (result.offers?.length && (!player.pendingOffers || player.pendingOffers.length === 0)) {
        player.pendingOffers = result.offers;
      }
      if (player.pendingOffers?.length) {
        const offerResult = resolveOffers(player, style, rng, decisions, market);
        if (!offerResult?.ok) return { ok: false, reason: `paused-offers:${offerResult?.reason}`, guard };
      } else {
        const decision = player.pendingDecision || result.decision;
        const choice = styleChooseDecision(decision, style, rng);
        if (!decision || !choice) return { ok: false, reason: "awaiting-decision-without-choice", guard };
        const resolved = resolveSquadDecision(player, decision, choice);
        decisions.push({ kind: "decision-mid", choice, result: resolved?.ok ? "ok" : resolved?.reason });
        if (!resolved?.ok) return { ok: false, reason: `paused-decision:${resolved?.reason}`, guard };
      }
      checkpoint = result.checkpoint;
      continue;
    }

    const endSeasonCount = player.seasons?.length || 0;
    const validation = validateDriverSeasonResult(result, startSeasonCount, endSeasonCount);
    if (!validation.ok) return { ...validation, guard, presentation };
    return {
      ok: true,
      completed: true,
      guard,
      result,
      presentation,
      startSeasonCount,
      endSeasonCount,
    };
  }
  return { ...validateDriverGuard(guard, DRAIN_GUARD), guard };
}

function maybeRetire(player, rng) {
  if (player.isRetired) return true;
  const age = player.age;
  if (age >= 42) {
    player.isRetired = true;
    player.retiredInSeason = player.seasons?.length ?? 0;
    return true;
  }
  if (age < 35) return false;
  if (rng.chance(RETIREMENT_ODDS[age] || 0)) {
    player.isRetired = true;
    player.retiredInSeason = player.seasons?.length ?? 0;
    return true;
  }
  return false;
}

function periodKindFromCommitted(season, result) {
  if (result?.freeAgent === true || season?.freeAgent === true) return "free-agent";
  if (
    result?.academyPeriod ||
    season?.academyPeriod ||
    season?.isNarrativeAcademyYear ||
    season?.academy ||
    season?.isAcademy ||
    String(result?.resultKind || "").startsWith("academy")
  ) {
    return "academy";
  }
  // Club periods with playing evidence are never free-agent, even if the player
  // later becomes unsigned.
  const minutes = season?.minutes ?? season?.usefulMinutes ?? null;
  const apps = season?.matches ?? season?.appearances ?? null;
  if ((Number(minutes) > 0 || Number(apps) > 0) && season?.club && season.club !== "Free agent") {
    return "senior";
  }
  if (season?.club && season.club !== "Free agent" && season?.league) return "senior";
  return "senior";
}

function periodMeta(season, result = null) {
  const kind = periodKindFromCommitted(season, result);
  const isFa = kind === "free-agent";
  return {
    id: season?.seasonId || season?.periodId || season?.id || null,
    kind,
    age: season?.age ?? null,
    clubId: season?.clubId || season?.club?.clubId || season?.club?.id || null,
    club: season?.clubDisplay || season?.clubName || season?.club || null,
    appearances: isFa ? 0 : season?.matches ?? season?.appearances ?? null,
    minutes: isFa ? 0 : season?.minutes ?? season?.usefulMinutes ?? null,
  };
}

function countAwards(seasons) {
  const wins = Object.create(null);
  const events = [];
  let winCount = 0;
  for (const s of seasons || []) {
    const seasonId = s?.seasonId || s?.periodId || null;
    const records = Array.isArray(s.awardRecords) ? s.awardRecords : [];
    const seenEvent = new Set();
    for (const rec of records) {
      const outcome = rec?.outcome || (rec?.won ? "win" : rec?.nominated ? "nomination" : null);
      const awardId = rec?.awardId || rec?.label || null;
      if (!awardId) continue;
      const eventKey = `${seasonId || "?"}:${awardId}:${outcome || "unknown"}:${rec?.scope || ""}`;
      if (seenEvent.has(eventKey)) continue;
      seenEvent.add(eventKey);
      events.push({
        seasonId,
        awardId,
        label: rec.label || awardId,
        outcome,
        scope: rec.scope || null,
      });
      if (outcome === "win" || rec?.won) {
        wins[awardId] = (wins[awardId] || 0) + 1;
        winCount += 1;
      }
    }
    // Labels without records: count only when no awardRecords exist for the season.
    if (!records.length) {
      for (const name of s.individualAwards || []) {
        const eventKey = `${seasonId || "?"}:${name}:win:label`;
        if (seenEvent.has(eventKey)) continue;
        seenEvent.add(eventKey);
        events.push({ seasonId, awardId: name, label: name, outcome: "win", scope: "label-fallback" });
        wins[name] = (wins[name] || 0) + 1;
        winCount += 1;
      }
    }
  }
  return { wins, winCount, events };
}

function bootstrapFromRow(row) {
  const openingPath = row.openingPath || "interactive";
  resetCareerState(row.seeds.world, row.startYear || 2026);
  const player = createPlayerIdentity({
    name: row.name,
    nationality: row.nationality,
    position: row.position,
    age: row.age,
  });
  ensurePlayerModel(player);
  const rngStateAfterIdentity = getSimRng().seed();
  const academies = pickThreeAcademies(ACADEMY_POOL, row.nationality, row.name, {
    age: row.age,
    seed: row.seeds.academy,
  });
  if (!academies?.length) {
    throw new Error("no-academy-options");
  }
  const policyRng = createRng(row.seeds.policy);
  const chosen = policyRng.pick(academies);
  finalizeAcademyPlayer(player, chosen.academy);
  const academyEntry = sampleOvr(player, "academy-entry", { academyId: academyOfferId(chosen) });

  // Rebuild world with explicit numeric seed after academy finalize.
  setWorldState(createWorldState({ seed: row.seeds.world, startYear: player.startYear || row.startYear || 2026 }));

  const openingBefore = player.baseOverallRaw;
  let openingTag = openingPath;
  if (openingPath === "interactive") {
    simulateFullAcademyOpening(player, {
      policy: "balanced",
      rng: createRng(row.seeds.opening),
    });
  } else if (openingPath === "skip") {
    applySkipOpeningDevelopment(player);
    openingTag = "skip";
  } else {
    throw new Error(`Unsupported openingPath: ${openingPath}`);
  }
  const openingAfter = player.baseOverallRaw;
  const academySeason = buildNarrativeAcademySeason(player, openingBefore, openingAfter);
  player.seasons.push(academySeason);
  for (const key of ["matches", "goals", "assists", "cleanSheets"]) {
    player.careerTotals[key] += academySeason[key] || 0;
  }
  ensureAcademyLifecycle(player);
  ensureTransferSave(player);
  ensureContractAuthority(player);
  ensureSeniorCareerState(player);

  return {
    player,
    policyRng,
    academies,
    chosenAcademyId: academyOfferId(chosen),
    academyOffers: academies.map((o) => ({
      id: academyOfferId(o),
      isHome: Boolean(o.isHome),
      name: o.academy?.displayName || o.academy?.name || null,
    })),
    academyEntry,
    rngStateAfterIdentity,
    openingTag,
  };
}

function attemptFirstPro(player, style, rng, decisions) {
  const firstPro = buildFirstProContractDecision(player);
  const offers = (firstPro?.offers || []).map((d) => d.offer || d).filter(Boolean);
  const ranked = rankOffers(offers, style, rng);
  const top = ranked[0];
  if (!top) {
    decisions.push({ kind: "first-pro", choice: null, result: "no-offers", alternatives: [] });
    return { signed: false, sample: null, source: null };
  }
  const deal = firstPro.offers.find((c) => (c.offer || c).offerId === top.offerId) || firstPro.offers[0];
  const signed = signFirstProfessionalContract(player, deal);
  decisions.push({
    kind: "first-pro",
    alternatives: ranked.map((o) => o.offerId),
    choice: top.offerId,
    result: signed?.ok ? "signed" : signed?.reason || "failed",
  });
  if (!signed?.ok) return { signed: false, sample: null, source: null };
  const sample = sampleOvr(player, "first-pro-signing", {
    club: player.club?.displayName || player.club?.name || null,
    clubId: player.club?.id || player.club?.clubId || null,
    offerId: top.offerId,
  });
  return {
    signed: true,
    sample,
    source: {
      offerId: top.offerId,
      club: sample.club,
      clubId: sample.clubId,
      age: player.age,
    },
  };
}

function playCareerWithClock(row, options = {}) {
  const style = row.pathStyle || row.policyId || "mixed";
  const decisions = [];
  const ovrTrail = [];
  const presentationNotes = [];
  const periods = [];
  const peaks = { base: null, current: null };
  const market = {
    reviews: [],
    spells: [],
    currentSpell: null,
    lastCountedReviewId: null,
    seenReviewIds: new Set(),
    emptyReviews: 0,
    validOfferReviews: 0,
    refusals: 0,
    failedAccepts: 0,
    signings: 0,
    moves: [],
  };

  let boot;
  try {
    boot = bootstrapFromRow(row);
  } catch (error) {
    return {
      ok: false,
      incomplete: true,
      input: row,
      endReason: "error",
      error: String(error?.message || error),
      isRetired: false,
      committedPeriodCount: 0,
      decisions,
    };
  }

  const { player, policyRng, academies, chosenAcademyId, academyOffers, academyEntry, rngStateAfterIdentity, openingTag } =
    boot;
  ovrTrail.push(academyEntry);
  trackPeaks(peaks, academyEntry);
  periods.push(periodMeta(player.seasons[player.seasons.length - 1], { academyPeriod: true }));

  let firstPro = { signed: false, sample: null, source: null };
  if (player.club?.isAcademy || !player.club || isFreeAgent(player)) {
    firstPro = attemptFirstPro(player, style, policyRng, decisions);
  } else {
    firstPro = {
      signed: true,
      sample: sampleOvr(player, "first-pro-signing", {
        club: player.club?.displayName || player.club?.name || null,
        clubId: player.club?.id || player.club?.clubId || null,
      }),
      source: {
        offerId: null,
        club: player.club?.displayName || player.club?.name || null,
        clubId: player.club?.id || player.club?.clubId || null,
        age: player.age,
      },
    };
  }
  if (firstPro.sample) {
    ovrTrail.push(firstPro.sample);
    trackPeaks(peaks, firstPro.sample);
  }

  const retireRng = createRng(row.seeds.retirement);
  let endReason = null;
  let blocked = null;
  let steps = 0;
  let noProgressStreak = 0;
  let lastFingerprint = null;

  while (!player.isRetired && player.age < (row.maxAge ?? 42) && steps++ < MAX_STEPS) {
    const beforeSeasons = player.seasons?.length || 0;
    const beforeAge = player.age;
    const beforeAction = selectNextCareerAction(player)?.id;
    const drain = drainOneSeason(player, style, policyRng, decisions, market, presentationNotes);
    if (!drain.ok) {
      if (String(drain.reason || "").startsWith("unsupported-next-action:")) {
        endReason = "unsupported-action";
      } else if (String(drain.reason || "").includes("throw") || drain.error) {
        endReason = "error";
      } else {
        endReason = "no-progress";
      }
      blocked = {
        reason: drain.reason,
        error: drain.error || null,
        age: player.age,
        nextAction: drain.nextAction || selectNextCareerAction(player)?.id,
      };
      break;
    }
    if (drain.retired) {
      endReason = "engine-retirement";
      break;
    }
    if (!drain.completed) {
      noProgressStreak += 1;
      if (noProgressStreak >= 3) {
        endReason = "no-progress";
        blocked = { reason: "non-completed-result", age: player.age };
        break;
      }
      continue;
    }

    const season = drain.result?.season || player.seasons?.[player.seasons.length - 1];
    periods.push(periodMeta(season, drain.result));
    const sample = sampleOvr(player, "period-end", {
      seasonId: season?.seasonId || season?.id || null,
      freeAgent: periodKindFromCommitted(season, drain.result) === "free-agent",
    });
    ovrTrail.push(sample);
    trackPeaks(peaks, sample);

    // Live-desk market generation once per completed period.
    const offers = applyDeskMarketGeneration(player, drain.result);
    const generated = recordMarketReview(market, player, offers, { source: "post-season-desk" });
    if (generated.executable === 0 && isFreeAgent(player)) {
      // Close empty review so the next FA wait can advance (production settlement).
      declineWindowAndContinue(player, { choiceId: "continue-as-free-agent" });
      if (generated.reviewRecord) generated.reviewRecord.open = false;
      decisions.push({
        kind: "empty-market-close",
        reviewId: generated.reviewId,
        result: "continue-as-free-agent",
      });
    }

    // Preserve first successful signing even if it arrives after academy exit / FA.
    if (!firstPro.signed) {
      const signedMove = market.moves.find((m) => m.dealType !== "loan" || m.employmentClubId);
      const action = selectNextCareerAction(player);
      if (!isFreeAgent(player) && player.club && !player.club.isAcademy) {
        firstPro = {
          signed: true,
          sample: sampleOvr(player, "first-pro-signing", {
            club: player.club?.displayName || player.club?.name || null,
            clubId: player.club?.clubId || player.club?.id || null,
            offerId: signedMove?.offerId || null,
            late: true,
          }),
          source: {
            offerId: signedMove?.offerId || null,
            club: player.club?.displayName || player.club?.name || null,
            clubId: player.club?.clubId || player.club?.id || null,
            age: player.age,
            late: true,
          },
        };
        ovrTrail.push(firstPro.sample);
        trackPeaks(peaks, firstPro.sample);
      } else if (action?.id === "resolve-offers" && (player.pendingOffers || []).length) {
        const offerResult = resolveOffers(player, style, policyRng, decisions, market);
        if (offerResult?.signed && !isFreeAgent(player) && player.club && !player.club.isAcademy) {
          firstPro = {
            signed: true,
            sample: sampleOvr(player, "first-pro-signing", {
              club: player.club?.displayName || player.club?.name || null,
              clubId: player.club?.clubId || player.club?.id || null,
              offerId: offerResult.offerId || null,
              late: true,
            }),
            source: {
              offerId: offerResult.offerId || null,
              club: player.club?.displayName || player.club?.name || null,
              clubId: player.club?.clubId || player.club?.id || null,
              age: player.age,
              late: true,
            },
          };
          ovrTrail.push(firstPro.sample);
          trackPeaks(peaks, firstPro.sample);
        }
      }
    }

    const fingerprint = `${player.age}:${player.seasons?.length}:${selectNextCareerAction(player)?.id}:${player.club?.id || "fa"}`;
    if (fingerprint === lastFingerprint && beforeSeasons === (player.seasons?.length || 0) && beforeAge === player.age) {
      noProgressStreak += 1;
    } else {
      noProgressStreak = 0;
      lastFingerprint = fingerprint;
    }
    if (noProgressStreak >= 3) {
      endReason = "no-progress";
      blocked = { reason: "repeated-no-progress", age: player.age, nextAction: beforeAction };
      break;
    }

    if (maybeRetire(player, retireRng)) {
      endReason = "engine-retirement";
      break;
    }
  }

  if (!endReason) {
    if (player.isRetired) endReason = "engine-retirement";
    else if (player.age >= (row.maxAge ?? 42)) endReason = "policy-age-cutoff";
    else if (steps >= MAX_STEPS) endReason = "step-cap";
    else endReason = "no-progress";
  }

  // Cutoff / cap / error / no-progress must never be reported as successful retirement.
  const retiredForReport = endReason === "engine-retirement";

  const finalSample = sampleOvr(player, "final");
  ovrTrail.push(finalSample);
  const awards = countAwards(player.seasons);
  const openReviews = market.reviews.filter((r) => r.open);

  const committedPeriodCount = periods.length;
  const incomplete = !["engine-retirement", "policy-age-cutoff"].includes(endReason);

  return {
    ok: endReason === "engine-retirement" || endReason === "policy-age-cutoff",
    incomplete: incomplete && endReason !== "policy-age-cutoff",
    input: {
      rowKey: row.rowKey,
      index: row.index,
      name: row.name,
      nationality: row.nationality,
      age: row.age,
      position: row.position,
      careerId: row.careerId,
      pathStyle: style,
      policyId: row.policyId,
      policyVersion: row.policyVersion || CAREER_QA_POLICY_VERSION,
      openingPath: row.openingPath || openingTag,
      seeds: row.seeds,
      maxAge: row.maxAge,
      startYear: row.startYear,
    },
    actualCareerId: player.careerId,
    rngStateAfterIdentity,
    opening: {
      path: openingTag,
      chosenAcademyId,
      academyOffers,
    },
    ratings: {
      academyEntry,
      firstPro: firstPro.sample,
      firstProStatus: firstPro.signed ? "signed" : "unsigned",
      firstProSource: firstPro.source,
      peakBase: peaks.base,
      peakCurrent: peaks.current,
      // Old current-peak convention (identifiable)
      peakRatingCurrentConvention: peaks.current?.value ?? null,
      finalBase: finalSample.base,
      finalCurrent: finalSample.current,
      finalDesk: finalSample.desk,
      finalDeskOvrDisplay: finalSample.deskOvrDisplay,
      trail: ovrTrail,
    },
    periods,
    committedPeriodCount,
    market: {
      reviews: market.reviews,
      freeAgentSpells: market.spells.map((s) => ({
        startAge: s.startAge,
        emptyStreak: s.emptyStreak,
        reviews: s.reviews,
      })),
      emptyReviews: market.emptyReviews,
      validOfferReviews: market.validOfferReviews,
      refusals: market.refusals,
      failedAccepts: market.failedAccepts,
      signings: market.signings,
      moves: market.moves,
      openReviewCount: openReviews.length,
    },
    awards,
    careerTotals: { ...(player.careerTotals || {}) },
    careerHonors: { ...(player.careerHonors || {}) },
    decisions,
    presentationNotes: presentationNotes.slice(0, 50),
    end: {
      endReason,
      age: player.age,
      committedPeriodCount,
      actionStepCount: steps,
      isRetired: retiredForReport,
      lastNextAction: selectNextCareerAction(player)?.id || null,
      hasCheckpoint: Boolean(player.seasonCheckpoint),
      pendingReviewCount: player.pendingContractReview ? 1 : 0,
      pendingOfferCount: player.pendingOffers?.length || 0,
      blocked,
    },
    // convenience mirrors used by summary / legacy readers
    name: row.name,
    nationality: row.nationality,
    position: row.position,
    startAge: row.age,
    pathStyle: style,
    peakRating: peaks.current?.value ?? null,
    peakBase: peaks.base?.value ?? null,
    finalRating: finalSample.current,
    finalBase: finalSample.base,
    retiredAge: player.age,
    isRetired: retiredForReport,
  };
}

/** Play one frozen manifest row under a deterministic clock. */
export function playCareerFromRow(row, options = {}) {
  if (options.openingPath != null && row.openingPath != null && options.openingPath !== row.openingPath) {
    throw new Error(`Conflicting openingPath override ${options.openingPath} vs row ${row.openingPath}`);
  }
  const frozen = options.openingPath && !row.openingPath ? { ...row, openingPath: options.openingPath } : row;
  return withDeterministicClock(frozen.seeds.world, () => playCareerWithClock(frozen, options));
}

/** Pure helpers exported for unit tests. */
export const __test__ = {
  sampleOvr,
  trackPeaks,
  rankOffers,
  shouldAcceptTopOffer,
  styleChooseDecision,
  classifyPresentation,
  acknowledgeResolvedScenario,
  resolveOffers,
  maybeRetire,
  countAwards,
  offerExecutableCount,
  periodKindFromCommitted,
  periodMeta,
  applyDeskMarketGeneration,
  recordMarketReview,
  acceptOfferLikeLiveDesk,
  RETIREMENT_ODDS,
  recordEmptyStreak(market, reviewId, executable, freeAgent) {
    if (!freeAgent) return market;
    market.seenReviewIds = market.seenReviewIds || new Set();
    if (market.seenReviewIds.has(reviewId)) return market;
    market.seenReviewIds.add(reviewId);
    if (!market.currentSpell) {
      market.currentSpell = { startAge: 0, emptyStreak: 0, reviews: [] };
      market.spells = market.spells || [];
      market.spells.push(market.currentSpell);
    }
    if (executable === 0) {
      market.currentSpell.emptyStreak += 1;
      market.lastCountedReviewId = reviewId;
      market.emptyReviews = (market.emptyReviews || 0) + 1;
    } else {
      market.currentSpell.emptyStreak = 0;
      market.lastCountedReviewId = reviewId;
      market.validOfferReviews = (market.validOfferReviews || 0) + 1;
    }
    market.currentSpell.reviews.push(reviewId);
    return market;
  },
  endStatusFromForce(kind) {
    if (kind === "cutoff") return { endReason: "policy-age-cutoff", isRetired: false };
    if (kind === "no-progress") return { endReason: "no-progress", isRetired: false };
    if (kind === "error") return { endReason: "error", isRetired: false };
    if (kind === "retirement") return { endReason: "engine-retirement", isRetired: true };
    return { endReason: "unsupported-action", isRetired: false };
  },
};
