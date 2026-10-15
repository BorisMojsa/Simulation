/**
 * Senior career optional scenes: competition-edition rolls, dated queue events,
 * pause → choice → resume, and bounded temporary consequences.
 */
import { SENIOR_CAREER_SCENARIOS } from "../config/seniorCareerScenarioConfig.js";
import {
  allSeniorScenarios,
  getSeniorScenarioById,
  normalizeSeniorScenario,
  pickWeightedSeniorResult,
} from "../data/seniorCareerScenarios.js";
import { DOMESTIC_CUPS } from "../data/domesticCups.js";
import { createStreamRng } from "./rng.js";
import { stableCareerId } from "./playerDevelopmentModel.js";
import { ensurePlayerModel } from "./playerModelMigration.js";
import { getOrUpdateForecast } from "./playerPotential.js";
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
import { formatAbilityForDisplay } from "../ui/abilityFormatting.js";

function careerId(player) {
  return stableCareerId(player);
}

function rollKey(career, competitionId, editionId) {
  return `${career}|${competitionId}|${editionId}`;
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
  if (sc.version == null) sc.version = 1;
  if (!sc.rolls || typeof sc.rolls !== "object") sc.rolls = {};
  if (!Array.isArray(sc.history)) sc.history = [];
  if (!sc.appliedEventIds || typeof sc.appliedEventIds !== "object") sc.appliedEventIds = {};
  if (!sc.activeModifiers || typeof sc.activeModifiers !== "object") sc.activeModifiers = {};
  if (!sc.life || typeof sc.life !== "object") {
    sc.life = { partner: false, partnerEstablishedSeason: null };
  }
  if (sc.coachTrustClub == null) sc.coachTrustClub = 0;
  if (sc.coachTrustNational == null) sc.coachTrustNational = 0;
  if (sc.reputation == null) sc.reputation = 0;
  if (sc.rareCeilingBumpApplied == null) sc.rareCeilingBumpApplied = 0;
  if (!Array.isArray(sc.recentScenarioIds)) sc.recentScenarioIds = [];

  // Lightweight fictional relationship — no questionnaire.
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
  if (cup && (cupRoundDates?.length || true)) {
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
 * Pick a safe checkpoint date before a competition's early fixtures.
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
    const mid = datedLeague.slice(2, Math.max(3, Math.floor(datedLeague.length * 0.45)));
    candidates = mid.map((fx) => subtractDays(fx.date, 1)).filter(Boolean);
    if (!candidates.length && datedLeague[0]) {
      candidates = [subtractDays(datedLeague[0].date, 1) || datedLeague[0].date];
    }
  } else if (edition.type === "cup") {
    if (cupRoundDates[0]) candidates = [subtractDays(cupRoundDates[0], 2) || cupRoundDates[0]];
  } else if (edition.type === "continental") {
    if (europePlayerSlots[0]?.date) {
      candidates = [subtractDays(europePlayerSlots[0].date, 2) || europePlayerSlots[0].date];
    }
  } else if (edition.type === "international") {
    if (intlSlots[0]?.date) {
      candidates = [subtractDays(intlSlots[0].date, 2) || intlSlots[0].date];
    }
  }

  for (const date of candidates) {
    const ok = occupiedDates.every((d) => daysBetween(d, date) >= minGap);
    if (ok) return { date, reason: null };
  }
  if (candidates[0]) {
    // Do not silently kill the 30% roll via cooldown — schedule with soft spacing note.
    return { date: candidates[0], reason: "spacing-soft" };
  }
  return { date: null, reason: "no-eligible-date" };
}

/** Context flags used for eligibility at schedule and fire time. */
export function buildSeniorScenarioContext(player, opts = {}) {
  const state = ensureSeniorCareerState(player);
  const stats = opts.playerMatchStats || {};
  const lastResults = opts.recentResults || [];
  const afterLoss = lastResults.some((r) => r === "L") || Boolean(opts.forceAfterLoss);
  const standout =
    Boolean(opts.forceStandout) ||
    (stats.goals || 0) + (stats.assists || 0) >= 3 ||
    (stats.minutes || 0) >= 450;
  const benched = Boolean(opts.forceBenched) || ((stats.starts || 0) === 0 && (stats.played || 0) > 0);
  const rivalMatchup = Boolean(opts.rivalMatchup);
  const travelCongestion = Boolean(opts.travelCongestion);
  const fixtureCongestion = Boolean(opts.fixtureCongestion);
  const onLeave = Boolean(opts.onLeave);
  const returningFromInjury =
    Boolean(opts.returningFromInjury) ||
    Boolean(player.health?.activeInjury) ||
    player.health?.status === "returning" ||
    player.health?.status === "rehab";
  const recentAbroadMove =
    Boolean(opts.recentAbroadMove) ||
    Boolean(player.state?.adaptationPenalty > 0.15) ||
    Boolean(player.destinationScheduleMeta);
  const pendingRelocation =
    Boolean(opts.pendingRelocation) ||
    Boolean(player.pendingOffers?.some((o) => !o.isLoan && o.leagueId && o.leagueId !== player.club?.leagueId));
  const nationalCallUp = Boolean(opts.nationalCallUp) || Boolean(opts.intlCalledUp);
  const leadershipContext =
    Boolean(opts.leadershipContext) || ((player.age || 0) >= 22 && (stats.starts || 0) >= 5);

  return {
    afterLoss,
    standoutPerformance: standout,
    benched,
    rivalMatchup,
    travelCongestion,
    fixtureCongestion,
    onLeave,
    returningFromInjury,
    recentAbroadMove,
    pendingRelocation,
    hasPartner: Boolean(state.life?.partner),
    nationalCallUp,
    leadershipContext,
    any: true,
    seasonIndex: player.seasons?.length ?? 0,
  };
}

export function scenarioEligible(scenario, context) {
  const tags = scenario?.eligibility || ["any"];
  return tags.every((tag) => {
    if (tag === "any") return true;
    return Boolean(context?.[tag]);
  });
}

/**
 * Select a scenario for a drawn edition. Avoids recent repeats when alternatives exist.
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

  const bank = allSeniorScenarios();
  // Soften context for schedule-time: allow scenarios that need mid-season flags
  // when the edition type can produce them; re-check at fire.
  const softCtx = { ...context };
  if (edition.type === "league" || edition.type === "cup" || edition.type === "continental") {
    softCtx.afterLoss = true;
    softCtx.standoutPerformance = true;
    softCtx.benched = true;
    softCtx.rivalMatchup = true;
    softCtx.travelCongestion = true;
    softCtx.fixtureCongestion = true;
  }
  if (edition.type === "international") {
    softCtx.nationalCallUp = true;
    softCtx.afterLoss = true;
  }
  if (edition.type === "league") {
    softCtx.onLeave = seasonIndex > 0; // mid-season / winter-ish leave stories
    softCtx.leadershipContext = (player.age || 0) >= 21;
  }

  let eligible = bank.filter((sc) => scenarioEligible(sc, softCtx));
  if (!eligible.length) {
    return { scenario: null, reason: "no-eligible-scenario" };
  }

  const fresh = eligible.filter((sc) => !recent.has(sc.id));
  if (fresh.length) eligible = fresh;

  // Soft preference: ~35% chance to draw from an edition-flavoured subset when available.
  let pool = eligible;
  if (rng.chance(0.35)) {
    const preferred = preferForEdition(eligible, edition);
    if (preferred.length) pool = preferred;
  }
  const pick = pool[Math.floor(rng.random() * pool.length)];
  return { scenario: pick, reason: null };
}

function preferForEdition(list, edition) {
  if (edition.type === "international") {
    const intl = list.filter(
      (s) => s.id === "international-first-trip" || s.eligibility?.includes("nationalCallUp")
    );
    return intl.length ? intl : [];
  }
  if (edition.type === "cup" || edition.type === "continental") {
    return list.filter((s) =>
      ["press-breakthrough", "derby-provocation", "travel-fatigue", "airport-fan", "extra-session-or-rest"].includes(
        s.id
      )
    );
  }
  return [];
}

/**
 * Plan dated senior_scenario events for entered competitions. One scene max per drawn edition.
 */
export function planSeniorScenarioEvents(player, planCtx = {}) {
  const state = ensureSeniorCareerState(player);
  const editions = listEnteredCompetitionEditions({
    player,
    league: planCtx.league,
    seasonStartYear: planCtx.seasonStartYear,
    europePlan: planCtx.europePlan,
    intlProbe: planCtx.intlProbe,
    cupRoundDates: planCtx.cupRoundDates,
  });

  const baseContext = buildSeniorScenarioContext(player, {
    playerMatchStats: planCtx.playerMatchStats,
    intlCalledUp: Boolean(planCtx.intlProbe?.calledUp),
    recentAbroadMove: Boolean(player.destinationScheduleMeta || player.state?.adaptationPenalty > 0.15),
  });

  const events = [];
  const occupied = [];
  const planLog = [];

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

    const selected = selectScenarioForEdition(player, edition, baseContext);
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
    };
    events.push(ev);
    planLog.push({
      ...edition,
      drawn: true,
      scheduled: true,
      scenarioId: selected.scenario.id,
      date: datePick.date,
      reason: datePick.reason,
    });
  }

  state.lastPlanLog = planLog;
  return { events, planLog, editions };
}

function narrativeRequest(delta) {
  const key = String(delta);
  const table = SENIOR_CAREER_SCENARIOS.narrativeToRequest;
  if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
  return 0;
}

function nudgeTrust(state, field, amount) {
  state[field] = clamp((Number(state[field]) || 0) + amount, -1, 1);
}

function applyEffects(player, outcome, { date, scope = "club" } = {}) {
  const state = ensureSeniorCareerState(player);
  ensureState(player);
  const delta = Number(outcome?.delta) || 0;
  const request = clamp(
    narrativeRequest(delta),
    -SENIOR_CAREER_SCENARIOS.maxNegativePerScene,
    SENIOR_CAREER_SCENARIOS.maxPositivePerScene
  );
  const effects = outcome?.effects || ["none"];
  const realized = [];
  const badges = [];

  for (const effect of effects) {
    if (effect === "none") continue;
    if (effect === "morale" || effect === "confidence" || effect === "composure") {
      const m = clamp(request * 0.35, -0.08, 0.08);
      applyMoraleDelta(player.state, m, { override: true });
      if (request > 0) updateFormFromObservation(player.state, 0.25, 45, date);
      if (request < 0) updateFormFromObservation(player.state, -0.2, 30, date);
      realized.push({ kind: "morale", amount: m });
      badges.push(m >= 0 ? "Confidence up" : "Confidence down");
    } else if (effect === "readiness") {
      if (request >= 0) {
        updateFatigue(player.state, { elapsedDays: 2 });
        updateReadiness(player.state, { minutes: 20, elapsedDays: 0 });
        badges.push("Rested");
        realized.push({ kind: "readiness", amount: 0.05 });
      } else {
        updateFatigue(player.state, { minutes: 70, elapsedDays: 0 });
        updateReadiness(player.state, { elapsedDays: 1.5 });
        badges.push("Fatigue up");
        realized.push({ kind: "fatigue", amount: 0.08 });
      }
    } else if (effect === "coachTrust") {
      const field = scope === "national" ? "coachTrustNational" : "coachTrustClub";
      const amt = clamp(request * 0.5, -0.12, 0.12);
      nudgeTrust(state, field, amt);
      player.state.roleFit = clamp((player.state.roleFit ?? 1) + amt * 0.15, 0.55, 1.05);
      realized.push({ kind: field, amount: amt });
      badges.push(amt >= 0 ? "Coach trust up" : "Coach trust down");
    } else if (effect === "reputation") {
      const amt = clamp(request * 0.4, -0.15, 0.15);
      state.reputation = clamp((state.reputation || 0) + amt, -1, 1);
      state.activeModifiers.reputation = {
        amount: amt,
        expiresSeason: (player.seasons?.length ?? 0) + 1,
      };
      realized.push({ kind: "reputation", amount: amt });
      badges.push(amt >= 0 ? "Public signal up" : "Public signal down");
    } else if (effect === "training") {
      state.activeModifiers.trainingFocus = {
        amount: clamp(Math.abs(request), 0, 0.2) * Math.sign(request || 1),
        expiresAppearances: 6,
      };
      realized.push({ kind: "training", amount: request });
      badges.push(request >= 0 ? "Learning focus" : "Learning stalled");
    } else if (effect === "support") {
      const m = clamp(request * 0.3, -0.07, 0.07);
      applyMoraleDelta(player.state, m, { override: true });
      if (request < 0) setAdaptationPenalty(player.state, Math.min(0.25, (player.state.adaptationPenalty || 0) + 0.04), {
        replace: false,
      });
      if (request > 0 && player.state.adaptationPenalty > 0) {
        player.state.adaptationPenalty = Math.max(0, player.state.adaptationPenalty - 0.05);
      }
      realized.push({ kind: "support", amount: m });
      badges.push(m >= 0 ? "Support up" : "Support strained");
    }
  }

  // v3: rare mentoring spark is narrative-only (no latent ceiling bump).
  if (
    outcome?.rareCeilingEligible &&
    delta >= SENIOR_CAREER_SCENARIOS.rareCeilingBump.minNarrative &&
    (player.age || 99) <= SENIOR_CAREER_SCENARIOS.rareCeilingBump.maxAge
  ) {
    const room =
      SENIOR_CAREER_SCENARIOS.rareCeilingBump.maxLifetime - (state.rareCeilingBumpApplied || 0);
    const bump = Math.min(SENIOR_CAREER_SCENARIOS.rareCeilingBump.maxPerEvent, room);
    if (bump > 0 && player.development) {
      state.rareCeilingBumpApplied = (state.rareCeilingBumpApplied || 0) + bump;
      realized.push({ kind: "mentoringSpark", amount: bump });
      badges.push("Mentoring spark");
    }
  }

  // Forecast evidence only (not hidden max) for strong narrative swings.
  if (Math.abs(delta) >= 3) {
    try {
      getOrUpdateForecast(player, { sampleCount: 24, force: true });
      realized.push({ kind: "forecastRefresh", amount: 0 });
    } catch {
      /* forecast optional */
    }
  }

  return { realized, badges, request };
}

/**
 * Build pending payload for UI / checkpoint (serializable).
 */
export function buildPendingSeniorScenario(player, event, opts = {}) {
  const scenario = getSeniorScenarioById(event.scenarioId);
  if (!scenario) return null;
  const context = buildSeniorScenarioContext(player, {
    ...opts,
    nationalCallUp: event.competitionType === "international",
    intlCalledUp: event.competitionType === "international",
  });

  // Re-validate hard eligibility; swap if needed.
  let active = scenario;
  if (!scenarioEligible(scenario, context)) {
    const alt = selectScenarioForEdition(
      player,
      {
        type: event.competitionType,
        competitionId: event.competitionId,
        editionId: event.editionId,
      },
      context
    );
    if (!alt.scenario || !scenarioEligible(alt.scenario, context)) {
      return {
        unschedulable: true,
        reason: "context-ineligible",
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
    `${SENIOR_CAREER_SCENARIOS.streams.order}:${event.editionId}:${active.id}`
  );
  const choiceOrder = orderRng.shuffle
    ? orderRng.shuffle(active.choices.map((_, i) => i))
    : shuffleIndices(active.choices.length, orderRng);

  return {
    unschedulable: false,
    kind: "senior_scenario",
    scenarioId: active.id,
    title: active.title,
    setup: active.setup,
    date: event.date,
    competitionId: event.competitionId,
    editionId: event.editionId,
    competitionType: event.competitionType,
    competitionLabel: event.competitionLabel,
    playingClubId: player.playingClubId || player.club?.clubId || null,
    nationalSide: event.competitionType === "international" ? player.nationality : null,
    choices: choiceOrder.map((i) => {
      const c = active.choices[i];
      return { id: c.id, label: c.label, disposition: c.disposition };
    }),
    choiceOrder,
    rollKey: event.rollKey,
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
 * Resolve a choice once. Idempotent via applicationId.
 */
export function resolveSeniorScenarioChoice(player, pending, choiceId, opts = {}) {
  const state = ensureSeniorCareerState(player);
  if (!pending || pending.unschedulable) {
    return { ok: false, reason: "no-pending" };
  }
  const applicationId =
    opts.applicationId ||
    `senior-scenario:${pending.editionId}:${pending.scenarioId}:${choiceId}`;
  if (state.appliedEventIds[applicationId] || pending.resolved) {
    return {
      ok: true,
      duplicate: true,
      applicationId,
      outcome: pending.sampledOutcome || null,
      realized: pending.realizedEffects || [],
      badges: pending.badges || [],
    };
  }

  const scenario = getSeniorScenarioById(pending.scenarioId);
  if (!scenario) return { ok: false, reason: "missing-scenario" };
  const choice = scenario.choices.find((c) => c.id === choiceId);
  if (!choice) return { ok: false, reason: "missing-choice" };

  const rng =
    opts.rng ||
    createStreamRng(
      careerId(player),
      `${SENIOR_CAREER_SCENARIOS.streams.outcome}:${pending.editionId}:${pending.scenarioId}:${choiceId}`
    );
  const outcome = pickWeightedSeniorResult(choice, rng);
  const scope = pending.competitionType === "international" ? "national" : "club";
  const { realized, badges, request } = applyEffects(player, outcome, {
    date: pending.date,
    scope,
  });

  const historyEntry = {
    applicationId,
    scenarioId: pending.scenarioId,
    title: pending.title,
    date: pending.date,
    seasonIndex: player.seasons?.length ?? 0,
    competitionId: pending.competitionId,
    editionId: pending.editionId,
    competitionLabel: pending.competitionLabel,
    playingClubId: pending.playingClubId,
    nationalSide: pending.nationalSide,
    prompt: pending.setup,
    choiceId,
    choiceLabel: choice.label,
    outcomeId: outcome.id,
    outcomeText: outcome.text,
    narrativeDelta: outcome.delta,
    requested: request,
    realized,
    badges,
    expiry: {
      reputationSeason: state.activeModifiers?.reputation?.expiresSeason ?? null,
      trainingAppearances: state.activeModifiers?.trainingFocus?.expiresAppearances ?? null,
    },
  };

  state.appliedEventIds[applicationId] = true;
  state.history.push(historyEntry);
  state.recentScenarioIds = [...(state.recentScenarioIds || []).slice(-12), pending.scenarioId];

  pending.resolved = true;
  pending.chosenOptionId = choiceId;
  pending.sampledOutcome = {
    id: outcome.id,
    text: outcome.text,
    delta: outcome.delta,
    effects: outcome.effects,
  };
  pending.realizedEffects = realized;
  pending.badges = badges;
  pending.applicationId = applicationId;

  player.pendingSeniorScenario = null;

  return {
    ok: true,
    duplicate: false,
    applicationId,
    outcome: pending.sampledOutcome,
    realized,
    badges,
    historyEntry,
  };
}

/**
 * Documented headless policy — does not always pick the largest reward.
 * - thoughtful: prefer thoughtful disposition
 * - balanced: middle option by disposition preference (default)
 * - ambitious: prefer ambitious
 * - first: first button (after shuffle) — for UI parity tests only
 * - random: seeded pick
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
      `${SENIOR_CAREER_SCENARIOS.streams.selection}:policy:${pending.editionId}`
    );
    choiceId = pending.choices[Math.floor(rng.random() * pending.choices.length)].id;
  } else if (mode === "thoughtful" || mode === "ambitious" || mode === "reckless") {
    const match = pending.choices.find((c) => byId.get(c.id)?.disposition === mode);
    choiceId = match?.id || pending.choices[Math.floor(pending.choices.length / 2)]?.id;
  } else {
    // balanced / neutral: prefer balanced disposition, else middle button
    const bal = pending.choices.find((c) => byId.get(c.id)?.disposition === "balanced");
    choiceId =
      bal?.id || pending.choices[Math.floor(pending.choices.length / 2)]?.id || pending.choices[0].id;
  }

  return resolveSeniorScenarioChoice(player, pending, choiceId);
}

export function buildSeniorScenarioFeedback(outcome, badges = []) {
  const lines = [];
  if (outcome?.text) lines.push(outcome.text);
  if (badges?.length) lines.push(badges.join(" · "));
  return lines.join(" ");
}

export function formatSeniorScenarioContextLine(pending) {
  const bits = [];
  if (pending?.competitionLabel) bits.push(pending.competitionLabel);
  if (pending?.date) bits.push(String(pending.date).slice(0, 10));
  return bits.join(" · ");
}

/** Calibration helper: many independent trigger trials (does not mutate player rolls if useTemp). */
export function runTriggerCalibration({ trials = 10000, competitionType = "league", seed = 1 } = {}) {
  let drawn = 0;
  for (let i = 0; i < trials; i++) {
    const rng = createStreamRng(`cal:${seed}`, `${SENIOR_CAREER_SCENARIOS.streams.trigger}:${competitionType}:${i}`);
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

export { normalizeSeniorScenario, getSeniorScenarioById, allSeniorScenarios, formatAbilityForDisplay };
