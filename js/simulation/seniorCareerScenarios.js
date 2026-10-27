/**
 * Senior career optional scenes: competition-edition rolls, dated queue events,
 * pause → choice → resume, durable ability development, and temporary effects.
 */
import { SENIOR_CAREER_SCENARIOS } from "../config/seniorCareerScenarioConfig.js?v=88";
import {
  allSeniorScenarios,
  getSeniorScenarioById,
  normalizeSeniorScenario,
  pickWeightedSeniorResult,
} from "../data/seniorCareerScenarios.js?v=88";
import { DOMESTIC_CUPS } from "../data/domesticCups.js";
import { createStreamRng } from "./rng.js";
import {
  alreadyAppliedLearningForPeriod,
  applyScenarioAbilityChange,
  developmentPeriodId,
  ensureLearningPeriodLedger,
  stableCareerId,
} from "./playerDevelopmentModel.js?v=88";
import { ensurePlayerModel } from "./playerModelMigration.js";
import { getOrUpdateForecast } from "./playerPotential.js";
import {
  getBaseOverall,
  getCurrentOverall,
  refreshAbilityCaches,
} from "./playerAbility.js?v=88";
import {
  addDaysToDate,
  applyMoraleDelta,
  ensureState,
  setAdaptationPenalty,
  toDay,
  updateFatigue,
  updateFormFromObservation,
  updateReadiness,
} from "./playerState.js";
import { clamp } from "../utils/helpers.js";
import {
  abilityDisplayChange,
  formatAbilityDisplayChange,
  formatAbilityForDisplay,
  roundAbilityForDisplay,
} from "../ui/abilityFormatting.js";

function careerId(player) {
  return stableCareerId(player);
}

function rollKey(career, competitionId, editionId) {
  return `${career}|${competitionId}|${editionId}`;
}

/** Stable event identity — independent of choice / scenario swap. */
export function seniorScenarioEventId(player, event) {
  if (event?.eventId) return String(event.eventId);
  const periodId = event?.periodId || developmentPeriodId(player);
  const cid = careerId(player);
  return `${cid}|${periodId}|${event.competitionId}|${event.editionId}|senior-scene-slot`;
}

/**
 * Serializable senior-career scene state on the player.
 */
export function ensureSeniorCareerState(player, opts = {}) {
  ensurePlayerModel(player);
  if (!player.seniorCareer || typeof player.seniorCareer !== "object") {
    player.seniorCareer = {};
  }
  const sc = player.seniorCareer;
  if (sc.version == null || sc.version < 2) sc.version = 2;
  if (!sc.rolls || typeof sc.rolls !== "object") sc.rolls = {};
  if (!Array.isArray(sc.history)) sc.history = [];
  if (!sc.appliedEventIds || typeof sc.appliedEventIds !== "object") sc.appliedEventIds = {};
  if (!sc.eventReceipts || typeof sc.eventReceipts !== "object") sc.eventReceipts = {};
  if (!sc.activeModifiers || typeof sc.activeModifiers !== "object") sc.activeModifiers = {};
  if (!sc.life || typeof sc.life !== "object") {
    sc.life = { partner: false, partnerEstablishedSeason: null };
  }
  if (sc.coachTrustClub == null) sc.coachTrustClub = 0;
  if (sc.coachTrustNational == null) sc.coachTrustNational = 0;
  if (sc.reputation == null) sc.reputation = 0;
  if (sc.rareCeilingBumpApplied == null) sc.rareCeilingBumpApplied = 0;
  if (!Array.isArray(sc.recentScenarioIds)) sc.recentScenarioIds = [];
  if (!Array.isArray(sc.plannedScenarioIds)) sc.plannedScenarioIds = [];
  if (sc.firstNationalCampAttended == null) sc.firstNationalCampAttended = false;

  // Migrate legacy choice-dependent application keys into event markers.
  for (const key of Object.keys(sc.appliedEventIds)) {
    if (key.startsWith("senior-scenario:") && key.split(":").length >= 4) {
      // Keep as historical; resolution also checks eventReceipts by eventId.
      sc.appliedEventIds[key] = sc.appliedEventIds[key] || { legacy: true };
    }
  }

  if (!sc.life.initialized) {
    const lifeRng =
      opts.lifeRng || createStreamRng(careerId(player), SENIOR_CAREER_SCENARIOS.streams.life);
    sc.life.partner = lifeRng.chance(0.35);
    sc.life.partnerEstablishedSeason = sc.life.partner ? player.seasons?.length ?? 0 : null;
    sc.life.initialized = true;
  }
  return sc;
}

/** Build competition editions the player actually enters this season. */
export function listEnteredCompetitionEditions({
  player,
  league,
  seasonStartYear,
  europePlan = null,
  intlProbe = null,
  cupRoundDates = [],
  cupEntered = null,
}) {
  const editions = [];
  if (player?.club?.isAcademy) return editions;

  const leagueId = league?.leagueId || league?.name || "league";
  editions.push({
    type: "league",
    competitionId: `league:${leagueId}`,
    editionId: `${leagueId}:${seasonStartYear}`,
    label: league?.displayName || league?.name || "League",
  });

  const nation = league?.nation || player?.club?.nation;
  const cup = nation ? DOMESTIC_CUPS[nation] : null;
  const hasCupEntry =
    cupEntered === true ||
    (Array.isArray(cupRoundDates) && cupRoundDates.length > 0);
  if (cup && hasCupEntry) {
    const cupId = cup.name || cup.shortName || "Domestic Cup";
    editions.push({
      type: "cup",
      competitionId: `cup:${cupId}`,
      editionId: `${cupId}:${seasonStartYear}`,
      label: cupId,
    });
  }

  if (europePlan && europePlan.qualified !== false && !europePlan.showcase) {
    const comp = europePlan.competition || "Continental";
    editions.push({
      type: "continental",
      competitionId: `continental:${comp}`,
      editionId: `${comp}:${seasonStartYear}`,
      label: comp,
    });
  }

  if (intlProbe?.calledUp) {
    const tourney =
      intlProbe.primary?.name ||
      intlProbe.tournaments?.[0]?.name ||
      intlProbe.primary?.competition ||
      "International";
    const year =
      intlProbe.primary?.editionYear ||
      intlProbe.primary?.year ||
      intlProbe.tournaments?.[0]?.editionYear ||
      seasonStartYear;
    editions.push({
      type: "international",
      competitionId: `intl:${tourney}`,
      editionId: `${tourney}:${year}`,
      label: tourney,
    });
  }

  return editions;
}

/**
 * One independent 30% roll per competition edition. Stores false rolls too.
 * Idempotent for the same (careerId, competitionId, editionId).
 */
export function rollCompetitionEditionTrigger(player, { competitionId, editionId } = {}) {
  const state = ensureSeniorCareerState(player);
  const cid = careerId(player);
  const key = rollKey(cid, competitionId, editionId);
  if (Object.prototype.hasOwnProperty.call(state.rolls, key)) {
    return { ...state.rolls[key], cached: true, key };
  }
  const rng = createStreamRng(
    cid,
    `${SENIOR_CAREER_SCENARIOS.streams.trigger}:${competitionId}:${editionId}`
  );
  const drawn = rng.chance(SENIOR_CAREER_SCENARIOS.triggerProbability);
  const entry = {
    competitionId,
    editionId,
    drawn,
    probability: SENIOR_CAREER_SCENARIOS.triggerProbability,
    seasonIndex: player.seasons?.length ?? 0,
  };
  state.rolls[key] = entry;
  return { ...entry, cached: false, key };
}

function daysBetween(a, b) {
  const da = toDay(a);
  const db = toDay(b);
  if (da == null || db == null) return Infinity;
  return Math.abs(db - da);
}

function subtractDays(date, days) {
  return addDaysToDate(date, -days);
}

/**
 * Spread checkpoint dates across the edition rather than only before first fixtures.
 */
export function pickSceneDateForEdition(edition, ctx = {}) {
  const {
    datedLeague = [],
    cupRoundDates = [],
    europePlayerSlots = [],
    intlSlots = [],
    occupiedDates = [],
    minGap = SENIOR_CAREER_SCENARIOS.minDaysBetweenScenes,
  } = ctx;

  let candidates = [];
  if (edition.type === "league") {
    const dates = datedLeague.map((fx) => fx.date).filter(Boolean);
    if (dates.length) {
      const idxs = [
        Math.floor(dates.length * 0.2),
        Math.floor(dates.length * 0.45),
        Math.floor(dates.length * 0.7),
      ];
      for (const i of idxs) {
        const d = dates[clamp(i, 0, dates.length - 1)];
        candidates.push(subtractDays(d, 1) || d);
      }
    }
  } else if (edition.type === "cup") {
    for (const d of cupRoundDates.slice(0, 3)) {
      candidates.push(subtractDays(d, 1) || d);
    }
  } else if (edition.type === "continental") {
    for (const slot of europePlayerSlots.slice(0, 4)) {
      if (slot?.date) candidates.push(subtractDays(slot.date, 1) || slot.date);
    }
  } else if (edition.type === "international") {
    for (const slot of intlSlots.slice(0, 3)) {
      if (slot?.date) candidates.push(subtractDays(slot.date, 1) || slot.date);
    }
  }

  candidates = [...new Set(candidates.filter(Boolean))];
  for (const date of candidates) {
    const ok = occupiedDates.every((d) => daysBetween(d, date) >= minGap);
    if (ok) return { date, reason: null };
  }
  if (candidates[0]) {
    return { date: candidates[0], reason: "spacing-soft" };
  }
  return { date: null, reason: "no-eligible-date" };
}

/** Context flags used for eligibility at schedule and fire time. */
export function buildSeniorScenarioContext(player, opts = {}) {
  const state = ensureSeniorCareerState(player);
  const stats = opts.playerMatchStats || {};
  const lastResults = opts.recentResults || [];
  const afterLoss =
    lastResults.some((r) => r === "L") || Boolean(opts.forceAfterLoss);
  const standout =
    Boolean(opts.forceStandout) ||
    Boolean(opts.strongRolePerformance) ||
    ((stats.goals || 0) + (stats.assists || 0) >= 3 && (stats.avgMatchRating || 0) >= 7.2);
  const benched =
    Boolean(opts.forceBenched) || ((stats.starts || 0) === 0 && (stats.played || 0) > 0);
  const substituteAppearances =
    Boolean(opts.substituteAppearances) ||
    ((stats.appsFromBench || stats.subApps || 0) > 0) ||
    (benched && (stats.played || 0) > 0);
  const unusedSubstitute = Boolean(opts.unusedSubstitute);
  const rivalMatchup = Boolean(opts.rivalMatchup);
  const travelCongestion = Boolean(opts.travelCongestion);
  const fixtureCongestion = Boolean(opts.fixtureCongestion);
  const onLeave = Boolean(opts.onLeave);
  const healthStatus = player.health?.status;
  const returningFromInjury =
    Boolean(opts.returningFromInjury) ||
    healthStatus === "returning" ||
    healthStatus === "rehab";
  const clearedFullTraining =
    Boolean(opts.clearedFullTraining) || healthStatus === "cleared" || healthStatus === "available";
  const recentAbroadMove =
    Boolean(opts.recentAbroadMove) ||
    Boolean(player.state?.adaptationPenalty > 0.15) ||
    Boolean(player.destinationScheduleMeta);
  const recentClubMove =
    Boolean(opts.recentClubMove) || recentAbroadMove || Boolean(player.destinationScheduleMeta);
  const pendingRelocation =
    Boolean(opts.pendingRelocation) ||
    Boolean(
      player.pendingOffers?.some(
        (o) => !o.isLoan && o.leagueId && o.leagueId !== player.club?.leagueId
      )
    );
  const nationalCallUp = Boolean(opts.nationalCallUp) || Boolean(opts.intlCalledUp);
  const firstNationalCamp =
    Boolean(opts.firstNationalCamp) ||
    (nationalCallUp && !state.firstNationalCampAttended);
  const leadershipContext =
    Boolean(opts.leadershipContext) || ((player.age || 0) >= 22 && (stats.starts || 0) >= 5);
  const experiencedSenior = Boolean(opts.experiencedSenior) || (player.age || 0) >= 28;
  const activeLoan = Boolean(
    opts.activeLoan ||
      player.loan ||
      (player.employmentClubId &&
        player.playingClubId &&
        player.employmentClubId !== player.playingClubId)
  );
  const activeLoanStart = Boolean(opts.activeLoanStart) || (activeLoan && opts.loanWeek != null && opts.loanWeek <= 1);
  const activeLoanProgress =
    Boolean(opts.activeLoanProgress) || (activeLoan && (stats.minutes || 0) >= 90);
  const loanReturn = Boolean(opts.loanReturn);
  const permanentTransferInduction = Boolean(opts.permanentTransferInduction);
  const contractUncertainty =
    Boolean(opts.contractUncertainty) ||
    (Number.isFinite(player.contractEndSeason) &&
      Number.isFinite(player.seasons?.length) &&
      player.contractEndSeason - player.seasons.length <= 1 &&
      player.contractEndSeason - player.seasons.length >= 0);
  const nextFixture = Boolean(opts.nextFixture);
  const matchErrorEvidence = Boolean(opts.matchErrorEvidence);
  const missedChanceEvidence = Boolean(opts.missedChanceEvidence);
  const gkReboundEvidence =
    Boolean(opts.gkReboundEvidence) &&
    String(player.position || "").toUpperCase() === "GK";
  const cupEliminated = Boolean(opts.cupEliminated);
  const strongOpponentUpcoming = Boolean(opts.strongOpponentUpcoming);
  const recentAchievement = Boolean(opts.recentAchievement);
  const highStakesRunIn = Boolean(opts.highStakesRunIn);
  const awayTravelReturn = Boolean(opts.awayTravelReturn);
  const highWorkload = Boolean(opts.highWorkload) || fixtureCongestion || travelCongestion;
  const returnFromNationalTrip = Boolean(opts.returnFromNationalTrip);
  const poorFormEvidence =
    Boolean(opts.poorFormEvidence) ||
    (Number.isFinite(stats.avgMatchRating) && stats.avgMatchRating > 0 && stats.avgMatchRating < 6.4);
  const languageAdaptationNeed =
    Boolean(opts.languageAdaptationNeed) ||
    (recentAbroadMove && Boolean(player.state?.adaptationPenalty > 0.1));
  const rotatedAfterStrong = Boolean(opts.rotatedAfterStrong);
  const nationalBenchDuty = Boolean(opts.nationalBenchDuty);

  return {
    afterLoss,
    standoutPerformance: standout,
    benched,
    substituteAppearances,
    unusedSubstitute,
    rivalMatchup,
    travelCongestion,
    fixtureCongestion,
    onLeave,
    returningFromInjury,
    clearedFullTraining,
    recentAbroadMove,
    recentClubMove,
    pendingRelocation,
    hasPartner: Boolean(state.life?.partner),
    nationalCallUp,
    firstNationalCamp,
    leadershipContext,
    experiencedSenior,
    activeLoan,
    activeLoanStart,
    activeLoanProgress,
    loanReturn,
    permanentTransferInduction,
    contractUncertainty,
    nextFixture,
    matchErrorEvidence,
    missedChanceEvidence,
    gkReboundEvidence,
    cupEliminated,
    strongOpponentUpcoming,
    recentAchievement,
    highStakesRunIn,
    awayTravelReturn,
    highWorkload,
    returnFromNationalTrip,
    poorFormEvidence,
    languageAdaptationNeed,
    rotatedAfterStrong,
    nationalBenchDuty,
    senior: !player.club?.isAcademy,
    any: true,
    seasonIndex: player.seasons?.length ?? 0,
  };
}

export function scenarioEligible(scenario, context, { strict = true } = {}) {
  const tags = scenario?.eligibility || ["senior"];
  return tags.every((tag) => {
    if (tag === "any" || tag === "senior") return context?.senior !== false && context?.any !== false;
    return Boolean(context?.[tag]);
  });
}

function preferForEdition(list, edition) {
  if (edition.type === "international") {
    const intl = list.filter(
      (s) =>
        s.tags?.includes("international") ||
        s.eligibility?.includes("nationalCallUp") ||
        s.eligibility?.includes("firstNationalCamp") ||
        s.id === "international-first-trip"
    );
    return intl.length ? intl : [];
  }
  if (edition.type === "cup" || edition.type === "continental") {
    const flavoured = list.filter(
      (s) =>
        s.tags?.includes("match") ||
        s.tags?.includes("travel") ||
        s.tags?.includes("tactics") ||
        ["press-breakthrough", "derby-provocation", "travel-fatigue", "airport-fan", "extra-session-or-rest"].includes(
          s.id
        )
    );
    return flavoured.length ? flavoured : [];
  }
  return [];
}

/**
 * Select a scenario. Schedule-time may use soft context; fire-time must be strict.
 */
export function selectScenarioForEdition(player, edition, context, opts = {}) {
  const state = ensureSeniorCareerState(player);
  const cid = careerId(player);
  const rng =
    opts.rng ||
    createStreamRng(
      cid,
      `${SENIOR_CAREER_SCENARIOS.streams.selection}:${edition.competitionId}:${edition.editionId}`
    );

  const cooldown = SENIOR_CAREER_SCENARIOS.repeatCooldownSeasons;
  const seasonIndex = context.seasonIndex ?? player.seasons?.length ?? 0;
  const recent = new Set(
    (state.history || [])
      .filter((h) => seasonIndex - (h.seasonIndex ?? 0) < cooldown)
      .map((h) => h.scenarioId)
  );
  for (const id of state.plannedScenarioIds || []) recent.add(id);

  const bank = allSeniorScenarios();
  const soft = Boolean(opts.soft);
  let ctx = { ...context };
  if (soft) {
    // Permissive schedule-time: mid-season flags may become true later.
    if (edition.type === "league" || edition.type === "cup" || edition.type === "continental") {
      ctx = {
        ...ctx,
        afterLoss: true,
        standoutPerformance: true,
        benched: true,
        substituteAppearances: true,
        rivalMatchup: true,
        travelCongestion: true,
        fixtureCongestion: true,
        nextFixture: true,
        highWorkload: true,
        awayTravelReturn: true,
        poorFormEvidence: true,
        matchErrorEvidence: true,
        missedChanceEvidence: player.position !== "GK",
        gkReboundEvidence: player.position === "GK",
        strongOpponentUpcoming: true,
        highStakesRunIn: true,
        rotatedAfterStrong: true,
        unusedSubstitute: true,
        cupEliminated: edition.type === "cup",
      };
    }
    if (edition.type === "international") {
      ctx = {
        ...ctx,
        nationalCallUp: true,
        firstNationalCamp: !state.firstNationalCampAttended,
        afterLoss: true,
        returnFromNationalTrip: true,
        nationalBenchDuty: true,
        nationalRoleAdjustment: true,
      };
    }
    if (edition.type === "league") {
      ctx.onLeave = seasonIndex > 0;
      ctx.leadershipContext = (player.age || 0) >= 21;
      ctx.experiencedSenior = (player.age || 0) >= 27;
      ctx.contractUncertainty = true;
      ctx.recentClubMove = Boolean(player.destinationScheduleMeta);
      ctx.recentAbroadMove = Boolean(player.state?.adaptationPenalty > 0.1);
      ctx.languageAdaptationNeed = ctx.recentAbroadMove;
      ctx.activeLoanStart = Boolean(
        player.employmentClubId &&
          player.playingClubId &&
          player.employmentClubId !== player.playingClubId
      );
      ctx.activeLoanProgress = ctx.activeLoanStart;
      ctx.clearedFullTraining = true;
      ctx.returningFromInjury = true;
      ctx.recentAchievement = true;
      ctx.permanentTransferInduction = Boolean(player.destinationScheduleMeta);
      ctx.loanReturn = true;
    }
  }

  let eligible = bank.filter((sc) => scenarioEligible(sc, ctx, { strict: !soft }));
  if (!eligible.length) {
    // Ambient fallback: general senior scenes only.
    eligible = bank.filter((sc) => {
      const tags = sc.eligibility || [];
      return tags.every((t) => t === "any" || t === "senior");
    });
  }
  if (!eligible.length) {
    return { scenario: null, reason: "no-eligible-scenario" };
  }

  const fresh = eligible.filter((sc) => !recent.has(sc.id));
  if (fresh.length) eligible = fresh;

  let pool = eligible;
  if (rng.chance(0.35)) {
    const preferred = preferForEdition(eligible, edition);
    if (preferred.length) pool = preferred;
  }
  const pick = pool[Math.floor(rng.random() * pool.length)];
  return { scenario: pick, reason: null };
}

/**
 * Plan dated senior_scenario events for entered competitions. One scene max per drawn edition.
 */
export function planSeniorScenarioEvents(player, planCtx = {}) {
  const state = ensureSeniorCareerState(player);
  const periodId = developmentPeriodId(player, { seasonIndex: planCtx.seasonIndex });
  const editions = listEnteredCompetitionEditions({
    player,
    league: planCtx.league,
    seasonStartYear: planCtx.seasonStartYear,
    europePlan: planCtx.europePlan,
    intlProbe: planCtx.intlProbe,
    cupRoundDates: planCtx.cupRoundDates,
    cupEntered: planCtx.cupEntered,
  });

  const baseContext = buildSeniorScenarioContext(player, {
    playerMatchStats: planCtx.playerMatchStats,
    intlCalledUp: Boolean(planCtx.intlProbe?.calledUp),
    recentAbroadMove: Boolean(player.destinationScheduleMeta || player.state?.adaptationPenalty > 0.15),
  });

  const events = [];
  const occupied = [];
  const planLog = [];
  const plannedIds = [];

  for (const edition of editions) {
    const roll = rollCompetitionEditionTrigger(player, edition);
    if (!roll.drawn) {
      planLog.push({ ...edition, drawn: false, scheduled: false, reason: "roll-miss" });
      continue;
    }

    const datePick = pickSceneDateForEdition(edition, {
      datedLeague: planCtx.datedLeague,
      cupRoundDates: planCtx.cupRoundDates,
      europePlayerSlots: planCtx.europePlayerSlots,
      intlSlots: planCtx.intlSlots,
      occupiedDates: occupied,
    });
    if (!datePick.date) {
      planLog.push({
        ...edition,
        drawn: true,
        scheduled: false,
        reason: datePick.reason || "unschedulable-date",
      });
      continue;
    }

    const selected = selectScenarioForEdition(player, edition, baseContext, { soft: true });
    if (!selected.scenario) {
      planLog.push({
        ...edition,
        drawn: true,
        scheduled: false,
        reason: selected.reason || "unschedulable-scenario",
      });
      continue;
    }

    occupied.push(datePick.date);
    plannedIds.push(selected.scenario.id);
    const ev = {
      kind: "senior_scenario",
      date: datePick.date,
      sortKey: `${datePick.date}:S:${edition.type}:${edition.editionId}`,
      competitionId: edition.competitionId,
      editionId: edition.editionId,
      competitionType: edition.type,
      competitionLabel: edition.label,
      scenarioId: selected.scenario.id,
      rollKey: roll.key,
      periodId,
      contentVersion: SENIOR_CAREER_SCENARIOS.contentVersion,
      probabilityModelVersion: SENIOR_CAREER_SCENARIOS.probabilityModelVersion,
    };
    ev.eventId = seniorScenarioEventId(player, ev);
    events.push(ev);
    planLog.push({
      ...edition,
      drawn: true,
      scheduled: true,
      scenarioId: selected.scenario.id,
      eventId: ev.eventId,
      date: datePick.date,
      reason: datePick.reason,
    });
  }

  state.plannedScenarioIds = plannedIds;
  state.lastPlanLog = planLog;
  return { events, planLog, editions };
}

function narrativeRequest(delta) {
  const key = String(delta);
  const table = SENIOR_CAREER_SCENARIOS.narrativeToRequest;
  if (!Object.prototype.hasOwnProperty.call(table, key)) {
    throw new Error(`narrativeRequest: unmapped score ${delta}`);
  }
  return table[key];
}

function nudgeTrust(state, field, amount) {
  state[field] = clamp((Number(state[field]) || 0) + amount, -1, 1);
}

function applyTemporaryEffects(player, outcome, { date, scope = "club", request } = {}) {
  const state = ensureSeniorCareerState(player);
  ensureState(player);
  const effects = outcome?.effects || ["none"];
  const realized = [];
  const badges = [];

  for (const effect of effects) {
    if (effect === "none") continue;
    if (effect === "morale" || effect === "confidence" || effect === "composure") {
      const m = clamp(request * 0.25, -0.08, 0.08);
      applyMoraleDelta(player.state, m, { override: true });
      if (request > 0) updateFormFromObservation(player.state, 0.25, 45, date);
      if (request < 0) updateFormFromObservation(player.state, -0.2, 30, date);
      realized.push({ kind: "morale", amount: m, temporary: true });
      badges.push(m >= 0 ? "Temporary confidence up" : "Temporary confidence down");
    } else if (effect === "readiness") {
      if (request >= 0) {
        updateFatigue(player.state, { elapsedDays: 2 });
        updateReadiness(player.state, { minutes: 20, elapsedDays: 0 });
        badges.push("Rested");
        realized.push({ kind: "readiness", amount: 0.05, temporary: true });
      } else {
        updateFatigue(player.state, { minutes: 70, elapsedDays: 0 });
        updateReadiness(player.state, { elapsedDays: 1.5 });
        badges.push("Fatigue up");
        realized.push({ kind: "fatigue", amount: 0.08, temporary: true });
      }
    } else if (effect === "coachTrust") {
      const field = scope === "national" ? "coachTrustNational" : "coachTrustClub";
      const amt = clamp(request * 0.35, -0.12, 0.12);
      nudgeTrust(state, field, amt);
      player.state.roleFit = clamp((player.state.roleFit ?? 1) + amt * 0.15, 0.55, 1.05);
      realized.push({ kind: field, amount: amt, temporary: true });
      badges.push(amt >= 0 ? "Coach trust up" : "Coach trust down");
    } else if (effect === "reputation") {
      const amt = clamp(request * 0.3, -0.15, 0.15);
      state.reputation = clamp((state.reputation || 0) + amt, -1, 1);
      state.activeModifiers.reputation = {
        amount: amt,
        expiresSeason: (player.seasons?.length ?? 0) + 1,
      };
      realized.push({ kind: "reputation", amount: amt, temporary: true });
      badges.push(amt >= 0 ? "Public signal up" : "Public signal down");
    } else if (effect === "training") {
      // Routed into durable development separately; keep a short temporary focus badge only.
      realized.push({ kind: "trainingFocusNarrative", amount: request, temporary: true });
    } else if (effect === "support") {
      const m = clamp(request * 0.25, -0.07, 0.07);
      applyMoraleDelta(player.state, m, { override: true });
      if (request < 0) {
        setAdaptationPenalty(player.state, Math.min(0.25, (player.state.adaptationPenalty || 0) + 0.04), {
          replace: false,
        });
      }
      if (request > 0 && player.state.adaptationPenalty > 0) {
        player.state.adaptationPenalty = Math.max(0, player.state.adaptationPenalty - 0.05);
      }
      realized.push({ kind: "support", amount: m, temporary: true });
      badges.push(m >= 0 ? "Support up" : "Support strained");
    }
  }
  return { realized, badges };
}

function buildAbilityFeedback(outcome, ability) {
  // Player-facing number is current overall (same headline as the player card).
  const before = ability.displayedCurrentBefore ?? ability.displayedBaseBefore;
  const after = ability.displayedCurrentAfter ?? ability.displayedBaseAfter;
  const change =
    ability.displayedCurrentChange != null
      ? ability.displayedCurrentChange
      : ability.displayedChange;
  const limited = ability.limitedBy && ability.limitedBy !== "none";
  const cat =
    outcome?.abilityCategory ||
    (outcome?.delta > 0 ? "positive" : outcome?.delta < 0 ? "negative" : "neutral");

  let line;
  if (cat === "positive" && ability.realizedRaw > 1e-9) {
    if (change > 0) {
      line = `${outcome.text} Overall: ${before} → ${after}  (+${change})`;
    } else {
      line = `${outcome.text} You made useful progress, though your overall remains ${after} for now. Overall: ${before} → ${after}`;
    }
  } else if (cat === "positive" && limited) {
    line = `You handled the situation well, but there is no additional lasting ability gain right now. Overall: ${before} → ${after}`;
  } else if (cat === "negative" && ability.realizedRaw < -1e-9) {
    if (change < 0) {
      line = `${outcome.text} Overall: ${before} → ${after}  (${change})`;
    } else {
      line = `${outcome.text} The setback is real, though your overall remains ${after} for now. Overall: ${before} → ${after}`;
    }
  } else if (cat === "neutral" || Math.abs(ability.realizedRaw) < 1e-9) {
    line = `${outcome?.text || "You handled the situation without changing your development."} Overall: ${before} → ${after}`;
  } else {
    line = `${outcome?.text || ""} Overall: ${before} → ${after}`;
  }
  return line.trim();
}

/**
 * Build pending payload for UI / checkpoint (serializable).
 */
export function buildPendingSeniorScenario(player, event, opts = {}) {
  const state = ensureSeniorCareerState(player);
  const eventId = seniorScenarioEventId(player, event);
  if (state.eventReceipts[eventId]?.resolved) {
    const receipt = state.eventReceipts[eventId];
    return {
      unschedulable: false,
      kind: "senior_scenario",
      eventId,
      periodId: receipt.periodId,
      scenarioId: receipt.scenarioId,
      title: receipt.title || getSeniorScenarioById(receipt.scenarioId)?.title,
      setup: receipt.prompt || "",
      date: receipt.date || event.date,
      competitionId: event.competitionId,
      editionId: event.editionId,
      competitionType: event.competitionType,
      competitionLabel: event.competitionLabel,
      playingClubId: receipt.playingClubIdAtOccurrence,
      employmentClubId: receipt.employmentClubIdAtOccurrence,
      nationalSide: receipt.nationalSide,
      choices: receipt.choicePresentation || [],
      choiceOrder: receipt.choiceOrder || [],
      rollKey: event.rollKey,
      resolved: true,
      chosenOptionId: receipt.choiceId,
      sampledOutcome: receipt.sampledOutcome,
      realizedEffects: receipt.temporaryEffects,
      badges: receipt.badges,
      abilityReceipt: receipt,
      feedbackLine: receipt.outcomeText,
      contentVersion: receipt.contentVersion,
      probabilityModelVersion: receipt.probabilityModelVersion,
    };
  }

  const scenario = getSeniorScenarioById(event.scenarioId);
  if (!scenario) return null;
  const context = buildSeniorScenarioContext(player, {
    ...opts,
    nationalCallUp: event.competitionType === "international" || opts.nationalCallUp,
    intlCalledUp: event.competitionType === "international" || opts.intlCalledUp,
  });

  let active = scenario;
  if (!scenarioEligible(scenario, context, { strict: true })) {
    const alt = selectScenarioForEdition(
      player,
      {
        type: event.competitionType,
        competitionId: event.competitionId,
        editionId: event.editionId,
      },
      context,
      { soft: false }
    );
    if (!alt.scenario || !scenarioEligible(alt.scenario, context, { strict: true })) {
      return {
        unschedulable: true,
        reason: "context-ineligible",
        eventId,
        competitionId: event.competitionId,
        editionId: event.editionId,
        date: event.date,
        scenarioId: event.scenarioId,
      };
    }
    active = alt.scenario;
  }

  const orderRng = createStreamRng(
    careerId(player),
    `${SENIOR_CAREER_SCENARIOS.streams.order}:${eventId}`
  );
  const choiceOrder = orderRng.shuffle
    ? orderRng.shuffle(active.choices.map((_, i) => i))
    : shuffleIndices(active.choices.length, orderRng);

  const periodId = event.periodId || developmentPeriodId(player);

  return {
    unschedulable: false,
    kind: "senior_scenario",
    eventId,
    periodId,
    scenarioId: active.id,
    title: active.title,
    setup: active.setup,
    date: event.date,
    competitionId: event.competitionId,
    editionId: event.editionId,
    competitionType: event.competitionType,
    competitionLabel: event.competitionLabel,
    playingClubId: player.playingClubId || player.club?.clubId || null,
    employmentClubId: player.employmentClubId || player.club?.clubId || null,
    nationalSide: event.competitionType === "international" ? player.nationality : null,
    choices: choiceOrder.map((i) => {
      const c = active.choices[i];
      return { id: c.id, label: c.label };
    }),
    choiceOrder,
    rollKey: event.rollKey,
    contentVersion: SENIOR_CAREER_SCENARIOS.contentVersion,
    probabilityModelVersion: SENIOR_CAREER_SCENARIOS.probabilityModelVersion,
    resolved: false,
  };
}

function shuffleIndices(n, rng) {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor((rng?.random?.() ?? Math.random()) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Resolve a choice once per event identity. Idempotent across different choice attempts.
 */
export function resolveSeniorScenarioChoice(player, pending, choiceId, opts = {}) {
  const state = ensureSeniorCareerState(player);
  if (!pending || pending.unschedulable) {
    return { ok: false, reason: "no-pending" };
  }
  const eventId =
    pending.eventId ||
    opts.eventId ||
    seniorScenarioEventId(player, {
      periodId: pending.periodId,
      competitionId: pending.competitionId,
      editionId: pending.editionId,
    });
  if (!pending.eventId) pending.eventId = eventId;
  if (!pending.periodId) pending.periodId = developmentPeriodId(player);

  const existing = state.eventReceipts[eventId];
  if (existing?.resolved || pending.resolved) {
    const receipt = existing || pending.abilityReceipt;
    return {
      ok: true,
      duplicate: true,
      eventId,
      applicationId: eventId,
      outcome: pending.sampledOutcome || receipt?.sampledOutcome || null,
      realized: pending.realizedEffects || receipt?.temporaryEffects || [],
      badges: pending.badges || receipt?.badges || [],
      abilityReceipt: receipt,
      feedbackLine: receipt?.outcomeText || pending.feedbackLine,
    };
  }

  const scenario = getSeniorScenarioById(pending.scenarioId);
  if (!scenario) return { ok: false, reason: "missing-scenario" };
  const choice = scenario.choices.find((c) => c.id === choiceId);
  if (!choice) return { ok: false, reason: "missing-choice" };

  let outcome;
  let requestedRaw = 0;
  try {
    const categoryRng = createStreamRng(
      careerId(player),
      `${SENIOR_CAREER_SCENARIOS.streams.category}:${eventId}`
    );
    const conditionalRng = createStreamRng(
      careerId(player),
      `${SENIOR_CAREER_SCENARIOS.streams.conditional}:${eventId}`
    );
    outcome = pickWeightedSeniorResult(choice, null, {
      categoryRng,
      conditionalRng,
      forceCategory: opts.forceCategory,
    });
    const mapped = narrativeRequest(outcome.delta);
    requestedRaw = clamp(
      mapped,
      -SENIOR_CAREER_SCENARIOS.maxNegativePerScene,
      SENIOR_CAREER_SCENARIOS.maxPositivePerScene
    );
    if (outcome.abilityCategory === "neutral") requestedRaw = 0;
    if (outcome.abilityCategory === "positive" && !(requestedRaw > 0)) {
      throw new Error("positive outcome must request positive change");
    }
    if (outcome.abilityCategory === "negative" && !(requestedRaw < 0)) {
      throw new Error("negative outcome must request negative change");
    }
  } catch (err) {
    return { ok: false, reason: "validation-failed", error: String(err?.message || err) };
  }

  const periodId = pending.periodId || developmentPeriodId(player);
  ensureLearningPeriodLedger(player, periodId);
  refreshAbilityCaches(player);
  const baseRawBefore = getBaseOverall(player);
  const currentRawBefore = getCurrentOverall(player);
  const displayedBaseBefore = roundAbilityForDisplay(baseRawBefore);

  const allocRng = createStreamRng(
    careerId(player),
    `${SENIOR_CAREER_SCENARIOS.streams.allocation}:${eventId}`
  );
  const ability = applyScenarioAbilityChange(player, {
    eventId,
    periodId,
    requestedRaw,
    focus: outcome.focus || "role-learning",
    rng: allocRng,
  });

  const scope = pending.competitionType === "international" ? "national" : "club";
  const { realized, badges } = applyTemporaryEffects(player, outcome, {
    date: pending.date,
    scope,
    request: requestedRaw,
  });
  refreshAbilityCaches(player);

  const baseRawAfter = getBaseOverall(player);
  const currentRawAfter = getCurrentOverall(player);
  const displayedBaseAfter = roundAbilityForDisplay(baseRawAfter);
  const displayedBaseBeforeFinal = displayedBaseBefore;
  const displayedChange = abilityDisplayChange(baseRawBefore, baseRawAfter);
  const displayedCurrentBefore = roundAbilityForDisplay(currentRawBefore);
  const displayedCurrentAfter = roundAbilityForDisplay(currentRawAfter);
  const displayedCurrentChange = abilityDisplayChange(currentRawBefore, currentRawAfter);

  const abilityView = {
    ...ability,
    baseRawBefore,
    baseRawAfter,
    displayedBaseBefore: displayedBaseBeforeFinal,
    displayedBaseAfter,
    displayedChange,
    currentRawBefore,
    currentRawAfter,
    displayedCurrentBefore,
    displayedCurrentAfter,
    displayedCurrentChange,
    realizedRaw: baseRawAfter - baseRawBefore,
  };

  const feedbackLine = buildAbilityFeedback(outcome, abilityView);
  if (displayedCurrentChange > 0) {
    badges.unshift(`Overall ${formatAbilityDisplayChange(currentRawBefore, currentRawAfter)}`);
  } else if (displayedCurrentChange < 0) {
    badges.unshift(`Overall ${formatAbilityDisplayChange(currentRawBefore, currentRawAfter)}`);
  } else if (abilityView.realizedRaw > 1e-9) {
    badges.unshift("Overall progress (sub-point)");
  } else if (abilityView.realizedRaw < -1e-9) {
    badges.unshift("Overall setback (sub-point)");
  }

  const probs = choice.seniorCategoryProbabilities || null;
  const academyProbs = choice.academyReferenceProbabilities || null;

  const receipt = {
    eventId,
    periodId,
    scenarioId: pending.scenarioId,
    title: pending.title,
    choiceId,
    outcomeId: outcome.id,
    contentVersion: pending.contentVersion || SENIOR_CAREER_SCENARIOS.contentVersion,
    probabilityModelVersion:
      pending.probabilityModelVersion || SENIOR_CAREER_SCENARIOS.probabilityModelVersion,
    date: pending.date,
    competitionId: pending.competitionId,
    editionId: pending.editionId,
    playingClubIdAtOccurrence: pending.playingClubId,
    employmentClubIdAtOccurrence: pending.employmentClubId,
    nationalSide: pending.nationalSide,
    intendedCategory: outcome.intendedCategory || outcome.abilityCategory,
    academyReferenceProbabilities: academyProbs,
    seniorProbabilities: probs,
    requestedRaw,
    realizedRaw: abilityView.realizedRaw,
    baseRawBefore,
    baseRawAfter,
    displayedBaseBefore,
    displayedBaseAfter,
    displayedChange,
    currentRawBefore,
    currentRawAfter,
    displayedCurrentBefore,
    displayedCurrentAfter,
    displayedCurrentChange,
    perAttribute: ability.perAttribute,
    positiveBudgetCharged: ability.positiveBudgetCharged || 0,
    limitedBy: ability.limitedBy,
    temporaryEffects: realized,
    badges,
    outcomeText: feedbackLine,
    prompt: pending.setup,
    choicePresentation: pending.choices,
    choiceOrder: pending.choiceOrder,
    sampledOutcome: {
      id: outcome.id,
      text: outcome.text,
      delta: outcome.delta,
      abilityCategory: outcome.abilityCategory,
      focus: outcome.focus,
      effects: outcome.effects,
    },
    resolved: true,
    seasonIndex: player.seasons?.length ?? 0,
  };

  state.eventReceipts[eventId] = receipt;
  state.appliedEventIds[eventId] = true;
  state.history.push({
    applicationId: eventId,
    eventId,
    scenarioId: pending.scenarioId,
    title: pending.title,
    date: pending.date,
    seasonIndex: receipt.seasonIndex,
    competitionId: pending.competitionId,
    editionId: pending.editionId,
    competitionLabel: pending.competitionLabel,
    playingClubId: pending.playingClubId,
    nationalSide: pending.nationalSide,
    prompt: pending.setup,
    choiceId,
    choiceLabel: choice.label,
    outcomeId: outcome.id,
    outcomeText: feedbackLine,
    narrativeDelta: outcome.delta,
    abilityCategory: outcome.abilityCategory,
    requested: requestedRaw,
    realizedRaw: abilityView.realizedRaw,
    displayedBaseBefore,
    displayedBaseAfter,
    limitedBy: ability.limitedBy,
    realized,
    badges,
  });
  state.recentScenarioIds = [...(state.recentScenarioIds || []).slice(-12), pending.scenarioId];

  if (pending.scenarioId === "international-first-trip" || pending.scenarioId === "national-role-adjustment") {
    state.firstNationalCampAttended = true;
  }

  // Keep pending for result-screen restore; mark resolved but do not discard.
  pending.resolved = true;
  pending.chosenOptionId = choiceId;
  pending.sampledOutcome = receipt.sampledOutcome;
  pending.realizedEffects = realized;
  pending.badges = badges;
  pending.abilityReceipt = receipt;
  pending.feedbackLine = feedbackLine;
  pending.applicationId = eventId;
  player.pendingSeniorScenario = pending;

  try {
    if (Math.abs(outcome.delta) >= 3) {
      getOrUpdateForecast(player, { sampleCount: 24, force: true });
    }
  } catch {
    /* forecast optional */
  }

  return {
    ok: true,
    duplicate: false,
    eventId,
    applicationId: eventId,
    outcome: receipt.sampledOutcome,
    realized,
    badges,
    abilityReceipt: receipt,
    feedbackLine,
    historyEntry: state.history[state.history.length - 1],
  };
}

/**
 * Documented headless policy — does not always pick the largest reward.
 */
export function applySeniorScenarioPolicy(player, pending, policy = SENIOR_CAREER_SCENARIOS.defaultAutoPolicy) {
  if (!pending || pending.unschedulable || !pending.choices?.length) {
    return { ok: false, reason: "no-pending" };
  }
  const mode = typeof policy === "string" ? policy : policy?.mode || "balanced";
  const scenario = getSeniorScenarioById(pending.scenarioId);
  const fullChoices = scenario?.choices || [];
  const byId = new Map(fullChoices.map((c) => [c.id, c]));

  let choiceId = pending.choices[0]?.id;
  if (mode === "first") {
    choiceId = pending.choices[0].id;
  } else if (mode === "random") {
    const rng = createStreamRng(
      careerId(player),
      `${SENIOR_CAREER_SCENARIOS.streams.selection}:policy:${pending.eventId || pending.editionId}`
    );
    choiceId = pending.choices[Math.floor(rng.random() * pending.choices.length)].id;
  } else if (mode === "thoughtful" || mode === "ambitious" || mode === "reckless") {
    const match = pending.choices.find((c) => byId.get(c.id)?.disposition === mode);
    choiceId = match?.id || pending.choices[Math.floor(pending.choices.length / 2)]?.id;
  } else {
    const bal = pending.choices.find((c) => byId.get(c.id)?.disposition === "balanced");
    choiceId =
      bal?.id || pending.choices[Math.floor(pending.choices.length / 2)]?.id || pending.choices[0].id;
  }

  return resolveSeniorScenarioChoice(player, pending, choiceId);
}

export function buildSeniorScenarioFeedback(outcome, badges = [], abilityReceipt = null) {
  if (abilityReceipt?.outcomeText) return abilityReceipt.outcomeText;
  const lines = [];
  if (outcome?.text) lines.push(outcome.text);
  if (abilityReceipt && Number.isFinite(abilityReceipt.displayedBaseBefore)) {
    const before = abilityReceipt.displayedBaseBefore;
    const after = abilityReceipt.displayedBaseAfter;
    const change = abilityReceipt.displayedChange;
    const changeStr =
      change > 0 ? `  (+${change})` : change < 0 ? `  (${change})` : "";
    lines.push(`Overall: ${before} → ${after}${changeStr}`);
  }
  if (badges?.length) lines.push(badges.join(" · "));
  return lines.join(" ");
}

export function formatSeniorScenarioContextLine(pending) {
  const bits = [];
  if (pending?.competitionLabel) bits.push(pending.competitionLabel);
  if (pending?.date) bits.push(String(pending.date).slice(0, 10));
  return bits.join(" · ");
}

/** Calibration helper: many independent trigger trials. */
export function runTriggerCalibration({ trials = 10000, competitionType = "league", seed = 1 } = {}) {
  let drawn = 0;
  for (let i = 0; i < trials; i++) {
    const rng = createStreamRng(
      `cal:${seed}`,
      `${SENIOR_CAREER_SCENARIOS.streams.trigger}:${competitionType}:${i}`
    );
    if (rng.chance(SENIOR_CAREER_SCENARIOS.triggerProbability)) drawn += 1;
  }
  return {
    trials,
    competitionType,
    probability: SENIOR_CAREER_SCENARIOS.triggerProbability,
    drawn,
    rate: drawn / trials,
  };
}

export function periodSceneContribution(player, periodId) {
  const ledger = player?.development?.learningByPeriod?.[periodId];
  if (!ledger) {
    return { scenePositive: 0, sceneNegative: 0, net: 0, eventCount: 0 };
  }
  return {
    scenePositive: ledger.scenePositive || 0,
    sceneNegative: ledger.sceneNegative || 0,
    net: (ledger.scenePositive || 0) - (ledger.sceneNegative || 0),
    eventCount: Object.keys(ledger.events || {}).length,
    positiveUsed: ledger.positiveUsed || 0,
  };
}

export {
  normalizeSeniorScenario,
  getSeniorScenarioById,
  allSeniorScenarios,
  formatAbilityForDisplay,
  alreadyAppliedLearningForPeriod,
  developmentPeriodId,
};
