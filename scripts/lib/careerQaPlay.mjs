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
import {
  declineWindowAndContinue,
  ensureContractAuthority,
  isFreeAgent,
  selectNextCareerAction,
  settleBoundaryContractReview,
} from "../../js/simulation/contractLifecycle.js";
import { resolveSquadDecision } from "../../js/simulation/squadDecisions.js";
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
  return {
    stage,
    age: player?.age ?? null,
    periodCount: player?.seasons?.length ?? 0,
    base: Number.isFinite(base) ? base : null,
    current: Number.isFinite(current) ? current : null,
    desk: Number.isFinite(base) ? roundAbilityForDisplay(base) : Number.isFinite(current) ? roundAbilityForDisplay(current) : null,
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

function resolveOffers(player, style, rng, decisions, market) {
  const pending = player.pendingOffers || [];
  const reviewId =
    player.pendingContractReview?.id ||
    player.academyLifecycle?.pendingReview?.id ||
    player.freeAgentSpell?.currentReviewId ||
    `review:${player.age}:${pending.length}:${hashSeed(JSON.stringify(pending.map((o) => o.offerId || o.clubId || o.club)))}`;

  const executable = offerExecutableCount(pending);
  const reviewRecord = {
    reviewId,
    age: player.age,
    executableOfferCount: executable,
    freeAgent: isFreeAgent(player),
    open: true,
  };
  market.reviews.push(reviewRecord);

  if (isFreeAgent(player)) {
    if (!market.currentSpell) {
      market.currentSpell = { startAge: player.age, emptyStreak: 0, reviews: [] };
      market.spells.push(market.currentSpell);
    }
    if (executable === 0) {
      if (market.lastCountedReviewId !== reviewId) {
        market.currentSpell.emptyStreak += 1;
        market.lastCountedReviewId = reviewId;
        market.emptyReviews += 1;
      }
    } else if (market.lastCountedReviewId !== reviewId) {
      market.currentSpell.emptyStreak = 0;
      market.lastCountedReviewId = reviewId;
      market.validOfferReviews += 1;
    }
    market.currentSpell.reviews.push(reviewId);
  }

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
        reviewRecord.open = false;
        market.currentSpell = null;
        return { ok: true, action: "academy-offer-accepted", offerId: offer.offerId };
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
    reviewRecord.open = false;
    return declined?.ok ? { ok: true, action: "academy-review-declined" } : { ok: false, reason: declined?.reason };
  }

  const ranked = rankOffers(pending, style, rng);
  const top = ranked[0];
  if (top && shouldAcceptTopOffer(style, rng, top)) {
    const result = acceptPipelineOffer(player, top);
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
      reviewRecord.open = false;
      market.currentSpell = null;
      market.moves.push({
        age: player.age,
        offerId: top.offerId,
        club: top.clubDisplay || top.club,
        dealType: top.dealType || (top.isLoan ? "loan" : top.isRenewal ? "renewal" : "permanent"),
      });
      return { ok: true, action: "offer-accepted", offerId: top.offerId };
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
  reviewRecord.open = Boolean(player.pendingOffers?.length || player.pendingContractReview);
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

function periodMeta(season, fallbackKind) {
  return {
    id: season?.seasonId || season?.periodId || season?.id || null,
    kind: season?.freeAgent ? "free-agent" : season?.academy || season?.isAcademy ? "academy" : fallbackKind,
    age: season?.age ?? null,
    clubId: season?.clubId || season?.club?.id || null,
    club: season?.clubDisplay || season?.club || null,
    appearances: season?.freeAgent ? 0 : season?.matches ?? season?.appearances ?? null,
    minutes: season?.freeAgent ? 0 : season?.minutes ?? season?.usefulMinutes ?? null,
  };
}

function countAwards(seasons) {
  const wins = Object.create(null);
  let winCount = 0;
  for (const s of seasons || []) {
    const seen = new Set();
    for (const rec of s.awardRecords || []) {
      if (!(rec?.outcome === "win" || rec?.won)) continue;
      const key = rec.awardId || rec.label;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      wins[key] = (wins[key] || 0) + 1;
      winCount += 1;
    }
    for (const name of s.individualAwards || []) {
      if (seen.has(name)) continue;
      // labels already counted via records when present
      if (Object.prototype.hasOwnProperty.call(wins, name)) continue;
      wins[name] = (wins[name] || 0) + 1;
      winCount += 1;
      seen.add(name);
    }
  }
  return { wins, winCount };
}

function bootstrapFromRow(row, { openingPath = "interactive" } = {}) {
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
  } else {
    applySkipOpeningDevelopment(player);
    openingTag = "skip";
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
    emptyReviews: 0,
    validOfferReviews: 0,
    refusals: 0,
    failedAccepts: 0,
    signings: 0,
    moves: [],
  };

  let boot;
  try {
    boot = bootstrapFromRow(row, { openingPath: options.openingPath || "interactive" });
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
  periods.push(periodMeta(player.seasons[player.seasons.length - 1], "academy"));

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
    periods.push(periodMeta(season, isFreeAgent(player) ? "free-agent" : "senior"));
    const sample = sampleOvr(player, "period-end", {
      seasonId: season?.seasonId || season?.id || null,
      freeAgent: Boolean(drain.result?.freeAgent || season?.freeAgent),
    });
    ovrTrail.push(sample);
    trackPeaks(peaks, sample);

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
  return withDeterministicClock(row.seeds.world, () => playCareerWithClock(row, options));
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
  RETIREMENT_ODDS,
  recordEmptyStreak(market, reviewId, executable, freeAgent) {
    if (!freeAgent) return market;
    if (!market.currentSpell) {
      market.currentSpell = { startAge: 0, emptyStreak: 0, reviews: [] };
      market.spells = market.spells || [];
      market.spells.push(market.currentSpell);
    }
    if (executable === 0) {
      if (market.lastCountedReviewId !== reviewId) {
        market.currentSpell.emptyStreak += 1;
        market.lastCountedReviewId = reviewId;
        market.emptyReviews = (market.emptyReviews || 0) + 1;
      }
    } else if (market.lastCountedReviewId !== reviewId) {
      market.currentSpell.emptyStreak = 0;
      market.lastCountedReviewId = reviewId;
      market.validOfferReviews = (market.validOfferReviews || 0) + 1;
    }
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
