/**
 * Academy opening: five interactive moments + one baseline training credit.
 * Narrative scores map to bounded attribute development; displayed OVR is derived.
 */
import { ACADEMY_OPENING } from "../config/academyOpeningConfig.js?v=76";
import { POSITION_PROFILES } from "../config/playerConfig.js?v=76";
import {
  formatAbilityDisplayChange,
  formatAbilityForDisplay,
  roundAbilityForDisplay,
} from "../ui/abilityFormatting.js?v=76";
import { createStreamRng } from "./rng.js?v=76";
import { refreshAbilityCaches, getDisplayAttributeKeys, getBaseOverall } from "./playerAbility.js?v=76";
import {
  applyAcademyGrowth,
  ensureAbilityBudgets,
  stableCareerId,
} from "./playerDevelopmentModel.js?v=76";
import { ensurePlayerModel } from "./playerModelMigration.js?v=76";
import { getOrUpdateForecast } from "./playerPotential.js?v=76";
import { applyMoraleDelta, ensureState, updateFormFromObservation } from "./playerState.js?v=76";
import { clamp } from "../utils/helpers.js?v=76";
import {
  normalizeOpeningScenario,
  pickScenariosForPosition,
  pickWeightedChoiceResult,
  getScenarioById,
} from "../data/careerOpeningScenarios.js?v=76";

function careerId(player) {
  return stableCareerId(player);
}

function narrativeRequest(delta) {
  const key = String(delta);
  const table = ACADEMY_OPENING.narrativeToRequest;
  if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
  const n = Number(delta) || 0;
  if (n === 0) return 0;
  const step = n > 0 ? table["1"] : table["-1"];
  return step * n;
}

function ensureAppliedMap(player) {
  if (!player.development) return {};
  if (!player.development.appliedEventIds || Array.isArray(player.development.appliedEventIds)) {
    player.development.appliedEventIds = {};
  }
  return player.development.appliedEventIds;
}

/**
 * Create or resume the serializable opening state on the player.
 * @param {object} player
 * @param {{scenarios?:object[], rng?:object}} [opts]
 */
export function ensureAcademyOpeningState(player, opts = {}) {
  ensurePlayerModel(player);
  if (player.academyOpening?.initialized) {
    return player.academyOpening;
  }

  const rng =
    opts.rng ||
    createStreamRng(careerId(player), ACADEMY_OPENING.streams.scenarios);
  const rawList = Array.isArray(opts.scenarios)
    ? opts.scenarios
    : pickScenariosForPosition(player.position, ACADEMY_OPENING.momentCount, rng);
  const scenarios = rawList.map((s, i) =>
    normalizeOpeningScenario(s, scenarioGroupKey(player.position), i)
  );

  player.academyOpening = {
    version: 1,
    initialized: true,
    scenarioIds: scenarios.map((s) => s.id),
    scenarios: scenarios.map(serializeScenario),
    cursor: 0,
    rolls: [],
    appliedMomentIds: {},
    baselineApplied: false,
    positiveLearningApplied: 0,
    lossApplied: 0,
    restorationApplied: 0,
    disruption: 0,
    rareBudgetBumpApplied: 0,
    complete: false,
  };
  return player.academyOpening;
}

function scenarioGroupKey(position) {
  if (position === "GK") return "GK";
  if (["RB", "LB", "CB", "CDM"].includes(position)) return "DEF";
  if (["RW", "LW"].includes(position)) return "WING";
  if (position === "ST") return "ST";
  return "MID";
}

function serializeScenario(sc) {
  return {
    id: sc.id,
    setup: sc.setup,
    group: sc.group,
    choices: (sc.choices || []).map((c) => ({
      id: c.id,
      label: c.label,
      disposition: c.disposition,
      results: (c.results || []).map((r) => ({
        id: r.id,
        delta: r.delta,
        weight: r.weight,
        text: r.text,
        effect: r.effect,
        disruption: r.disruption,
        focusHint: r.focusHint,
      })),
    })),
  };
}

export function getOpeningScenarios(player) {
  const state = player.academyOpening;
  if (!state?.scenarios?.length) return [];
  return state.scenarios;
}

export function openingPositiveRoom(state) {
  const used = Math.max(0, Number(state?.positiveLearningApplied) || 0);
  const disruption = clamp(Number(state?.disruption) || 0, 0, ACADEMY_OPENING.maxDisruption);
  const cap = ACADEMY_OPENING.openingPositiveCap * (1 - disruption);
  return Math.max(0, cap - used);
}

/**
 * Conduct factor in [0.15, 1]: poor moments / disruption shrink year-of-coaching credit.
 */
export function baselineConductFactor(state) {
  const disruption = clamp(Number(state?.disruption) || 0, 0, ACADEMY_OPENING.maxDisruption);
  const rolls = state?.rolls || [];
  const negAbility = rolls.filter((r) => r.effectKind === "ability" && (r.narrativeDelta || 0) < 0).length;
  const hardNeg = rolls.filter((r) => (r.narrativeDelta || 0) <= -2).length;
  // Soft conduct tax: poor moments trim coaching credit, but do not wipe the year.
  const penalty = disruption * 0.85 + 0.06 * negAbility + 0.1 * hardNeg;
  return clamp(1 - penalty, 0.25, 1);
}

/**
 * Apply the once-per-opening baseline coaching/training credit.
 * Prefer calling after the five moments so poor conduct can reduce it.
 */
export function applyAcademyBaselineTraining(player, { rng = null, forceFactor = null } = {}) {
  ensurePlayerModel(player);
  const state = ensureAcademyOpeningState(player);
  if (state.baselineApplied) {
    return { applied: 0, skipped: true, factor: 0 };
  }
  const eventId = "academy-opening:baseline";
  const appliedMap = ensureAppliedMap(player);
  if (appliedMap[eventId]) {
    state.baselineApplied = true;
    return { applied: 0, skipped: true, factor: 0 };
  }

  const factor =
    forceFactor != null ? clamp(forceFactor, 0, 1) : baselineConductFactor(state);
  const stream = rng || createStreamRng(careerId(player), ACADEMY_OPENING.streams.baseline);
  const profile = POSITION_PROFILES[player.position] || POSITION_PROFILES.DEFAULT;
  const room = openingPositiveRoom(state);
  const request = Math.min(ACADEMY_OPENING.baselineTrainingGain * factor, room);
  const before = getBaseOverall(player);
  let realized = 0;
  if (request > 0) {
    const result = applyAcademyGrowth(player, request, {
      rng: stream,
      focusBias: profile.growthBias,
      elapsedYearsShare: 1,
      alreadyAppliedLearningGain: state.positiveLearningApplied,
    });
    realized = Math.max(0, result.realized);
    state.positiveLearningApplied += realized;
    player.development.academyGrowthApplied =
      (player.development.academyGrowthApplied || 0) + realized;
  }
  appliedMap[eventId] = true;
  state.baselineApplied = true;
  state.baselineFactor = factor;
  getOrUpdateForecast(player, { sampleCount: 32 });
  return {
    applied: getBaseOverall(player) - before,
    realized,
    skipped: false,
    factor,
  };
}

/** Finalize interactive opening: baseline credit once, mark complete. */
export function finalizeAcademyOpening(player) {
  const state = ensureAcademyOpeningState(player);
  const baseline = applyAcademyBaselineTraining(player);
  state.complete = true;
  return baseline;
}

/**
 * Skip/bootstrap path: baseline only at full healthy factor —
 * not more favorable than a typical interactive opening.
 */
export function applySkipOpeningDevelopment(player) {
  ensureAcademyOpeningState(player, {
    scenarios: [],
  });
  const state = player.academyOpening;
  state.scenarioIds = [];
  state.scenarios = [];
  state.complete = true;
  // Slightly below a strong interactive opening (no scene upside).
  return applyAcademyBaselineTraining(player, { forceFactor: 0.85 });
}

function topAttributeDelta(perAttribute) {
  if (!perAttribute || typeof perAttribute !== "object") return null;
  let best = null;
  let bestAbs = 0;
  for (const [k, v] of Object.entries(perAttribute)) {
    const abs = Math.abs(Number(v) || 0);
    if (abs > bestAbs) {
      bestAbs = abs;
      best = k;
    }
  }
  return bestAbs > 1e-6 ? best : null;
}

function resolveEffectKind(outcome, narrativeDelta) {
  if (outcome?.effect === "confidence" || outcome?.effect === "ability" || outcome?.effect === "mixed") {
    return outcome.effect;
  }
  if (narrativeDelta === 0) return "none";
  return "ability";
}

/**
 * Apply one opening choice outcome. Idempotent per moment application id.
 */
export function applyOpeningMoment(player, { scenario, choice, outcome, momentIndex, applicationId } = {}) {
  ensurePlayerModel(player);
  const state = ensureAcademyOpeningState(player);
  const appId =
    applicationId ||
    `academy-moment:${scenario?.id || "x"}:${choice?.id || "c"}:${outcome?.id || "o"}:${momentIndex ?? state.cursor}`;
  const appliedMap = ensureAppliedMap(player);
  if (appliedMap[appId] || state.appliedMomentIds[appId]) {
    return {
      duplicate: true,
      applicationId: appId,
      rawBefore: player.rating,
      rawAfter: player.rating,
      displayedBefore: roundAbilityForDisplay(player.rating),
      displayedAfter: roundAbilityForDisplay(player.rating),
      realizedRaw: 0,
      effectKind: "none",
      feedback: buildOpeningFeedback({
        choiceLabel: choice?.label,
        outcomeText: outcome?.text || "Already applied.",
        rawBefore: player.rating,
        rawAfter: player.rating,
        effectKind: "none",
        limitedBy: "duplicate",
      }),
    };
  }

  const narrativeDelta = Number(outcome?.delta) || 0;
  const effectKind = resolveEffectKind(outcome, narrativeDelta);
  const rawBefore = getBaseOverall(player);
  const displayedBefore = roundAbilityForDisplay(rawBefore);
  const profile = POSITION_PROFILES[player.position] || POSITION_PROFILES.DEFAULT;
  const rng = createStreamRng(careerId(player), `${ACADEMY_OPENING.streams.outcomes}:${appId}`);

  let perAttribute = {};
  let limitedBy = "none";
  let realizedRaw = 0;
  let request = 0;

  if (outcome?.disruption) {
    state.disruption = clamp(
      (state.disruption || 0) + ACADEMY_OPENING.disruptionPerFlag,
      0,
      ACADEMY_OPENING.maxDisruption
    );
  }

  if (effectKind === "confidence" || effectKind === "none") {
    ensureState(player);
    if (narrativeDelta < 0) {
      applyMoraleDelta(player.state, -0.04, { override: true });
      updateFormFromObservation(player.state, -0.35, 45, state.cursor);
    } else if (narrativeDelta > 0) {
      applyMoraleDelta(player.state, 0.03, { override: true });
      updateFormFromObservation(player.state, 0.3, 45, state.cursor);
    }
    refreshAbilityCaches(player);
  } else {
    request = narrativeRequest(narrativeDelta);
    if (request > 0) {
      request = Math.min(request, ACADEMY_OPENING.maxPositivePerMoment, openingPositiveRoom(state));
      // Successful beats should be allowed to tick board OVR when budget remains.
      // Starts often sit on whole numbers, and after a tick raw can sit just over .5, so
      // another +0.5 of growth can leave displayed OVR stuck — which felt broken.
      if (narrativeDelta >= 1 && Number.isFinite(displayedBefore)) {
        const tickThreshold = displayedBefore + 0.5;
        const needForTick = tickThreshold - rawBefore + 0.02;
        const maxAssist = narrativeDelta >= 2 ? ACADEMY_OPENING.maxPositivePerMoment : 0.62;
        if (needForTick > 0 && needForTick <= maxAssist) {
          request = Math.min(
            ACADEMY_OPENING.maxPositivePerMoment,
            openingPositiveRoom(state),
            Math.max(request, needForTick)
          );
        }
      }
    } else if (request < 0) {
      request = Math.max(request, -ACADEMY_OPENING.maxNegativePerMoment);
    }

    if (request !== 0) {
      const focusBias = { ...(profile.growthBias || {}) };
      if (outcome?.focusHint && getDisplayAttributeKeys(player.position).includes(outcome.focusHint)) {
        focusBias[outcome.focusHint] = (focusBias[outcome.focusHint] || 0) + 0.8;
      }
      const growth = applyAcademyGrowth(player, request, {
        rng,
        focusBias,
        elapsedYearsShare: 1,
        alreadyAppliedLearningGain: request > 0 ? state.positiveLearningApplied : 0,
      });
      perAttribute = growth.perAttribute || {};
      limitedBy = growth.limitedBy || "none";
      realizedRaw = growth.realized;
      if (realizedRaw > 0) {
        state.positiveLearningApplied += realizedRaw;
        player.development.academyGrowthApplied =
          (player.development.academyGrowthApplied || 0) + realizedRaw;
      } else if (realizedRaw < 0) {
        state.lossApplied += Math.abs(realizedRaw);
      }
    }

    // Soft academy narrative band — nudge up only if below floor; never force +1 floor.
    if (player.rating < ACADEMY_OPENING.clamp.min) {
      const lift = applyAcademyGrowth(player, ACADEMY_OPENING.clamp.min - player.rating, {
        rng,
        focusBias: profile.growthBias,
        elapsedYearsShare: 1,
        alreadyAppliedLearningGain: state.positiveLearningApplied,
      });
      if (lift.realized > 0) {
        state.positiveLearningApplied += lift.realized;
        player.development.academyGrowthApplied =
          (player.development.academyGrowthApplied || 0) + lift.realized;
        limitedBy = "clamp-floor";
      }
    }

    maybeRareBudgetBump(player, state, narrativeDelta, rng);
  }

  // Clamp displayed narrative ceiling by refusing further positives only (attrs already applied).
  if (player.rating > ACADEMY_OPENING.clamp.max + 0.49) {
    limitedBy = limitedBy === "none" ? "clamp-ceiling" : limitedBy;
  }

  getOrUpdateForecast(player, { sampleCount: 32 });
  const rawAfter = getBaseOverall(player);
  const displayedAfter = roundAbilityForDisplay(rawAfter);

  appliedMap[appId] = true;
  state.appliedMomentIds[appId] = true;
  state.rolls.push({
    scenarioId: scenario?.id,
    choiceId: choice?.id,
    outcomeId: outcome?.id,
    applicationId: appId,
    narrativeDelta,
    realizedRaw: rawAfter - rawBefore,
    effectKind,
    limitedBy,
  });

  const attr = topAttributeDelta(perAttribute);
  const yearDevelopment =
    (Number(state.positiveLearningApplied) || 0) - (Number(state.lossApplied) || 0);
  const feedback = buildOpeningFeedback({
    choiceLabel: choice?.label,
    outcomeText: rewriteOutcomeText(outcome?.text, rawAfter - rawBefore, narrativeDelta, limitedBy, attr),
    rawBefore,
    rawAfter,
    effectKind,
    limitedBy,
    attributeHint: attr,
    request,
    yearDevelopment,
  });

  return {
    duplicate: false,
    applicationId: appId,
    rawBefore,
    rawAfter,
    displayedBefore,
    displayedAfter,
    realizedRaw: rawAfter - rawBefore,
    effectKind,
    limitedBy,
    feedback,
    outcome,
    choice,
  };
}

function maybeRareBudgetBump(player, state, narrativeDelta, rng) {
  const cfg = ACADEMY_OPENING.rareBudgetBump;
  if (narrativeDelta < cfg.minNarrative) return;
  if ((state.rareBudgetBumpApplied || 0) >= cfg.maxTotal) return;
  if (!rng.chance(cfg.baseChance)) return;
  const bump = Math.min(cfg.maxPerEvent, cfg.maxTotal - (state.rareBudgetBumpApplied || 0));
  if (bump <= 0) return;
  const budgets = ensureAbilityBudgets(player);
  player.development.latentAbilityBudget =
    (player.development.latentAbilityBudget || 0) + bump;
  player.development.latentBudget = player.development.latentAbilityBudget;
  if (budgets) budgets.budget = (budgets.budget || 0) + bump;
  state.rareBudgetBumpApplied = (state.rareBudgetBumpApplied || 0) + bump;
}

const GENERIC_FAIL = /gamble fails loudly|harsh reminder that timing matters|backfires completely/i;

function rewriteOutcomeText(text, realizedRaw, narrativeDelta, limitedBy, attr) {
  let out = text || "The moment passes.";
  if (GENERIC_FAIL.test(out) && narrativeDelta < 0) {
    if (Math.abs(realizedRaw) < 0.08) {
      out = "It does not come off cleanly, but the mistake stays in the notebook rather than the legs.";
    } else if (narrativeDelta <= -3) {
      out = "The wrong call sticks with staff — a clear step back from the week you wanted.";
    } else {
      out = "The decision costs you the duel; you reset and take the lesson.";
    }
  }
  if (limitedBy === "budget" || limitedBy === "annual-cap") {
    out += " You are close to what this academy year can still teach.";
  } else if (limitedBy === "clamp-ceiling") {
    out += " There is little room left under the academy rating band.";
  } else if ((limitedBy === "budget" || realizedRaw < 0.05) && narrativeDelta >= 2 && attr) {
    out += ` ${attr} nudges forward even if the board rating barely moves.`;
  }
  return out;
}

export function buildOpeningFeedback({
  choiceLabel,
  outcomeText,
  rawBefore,
  rawAfter,
  effectKind,
  limitedBy,
  attributeHint,
  request = 0,
  yearDevelopment = null,
}) {
  const displayedBefore = roundAbilityForDisplay(rawBefore);
  const displayedAfter = roundAbilityForDisplay(rawAfter);
  const dispDelta =
    displayedBefore == null || displayedAfter == null ? 0 : displayedAfter - displayedBefore;
  const rawDelta = (Number(rawAfter) || 0) - (Number(rawBefore) || 0);
  const now = formatAbilityForDisplay(rawAfter);
  const skill = attributeHint ? String(attributeHint) : "technique";
  let changeNote;

  if (effectKind === "confidence") {
    changeNote =
      rawDelta < -0.01
        ? `Confidence takes a hit. Board overall stays ${now}.`
        : rawDelta > 0.01
          ? `Confidence rises. Board overall stays ${now}.`
          : `Confidence shifts. Board overall stays ${now}.`;
  } else if (dispDelta !== 0) {
    const badge = formatAbilityDisplayChange(rawBefore, rawAfter, "unchanged");
    changeNote = `Board overall ${badge} → ${now}.`;
  } else if (rawDelta > 0.03) {
    changeNote = `${skill} up. Development registered — board overall still ${now} (needs a clearer step to tick).`;
  } else if (rawDelta < -0.03) {
    changeNote = `${skill} dips a little. Board overall still ${now}.`;
  } else {
    changeNote = `No lasting ability change. Board overall still ${now}.`;
  }

  if (limitedBy === "budget" && request > 0 && dispDelta === 0) {
    changeNote += " Near your academy learning limit for this year.";
  }

  if (Number.isFinite(yearDevelopment) && Math.abs(yearDevelopment) >= 0.05) {
    const yd = yearDevelopment > 0 ? `+${yearDevelopment.toFixed(1)}` : yearDevelopment.toFixed(1);
    changeNote += ` Academy-year development ${yd}.`;
  }

  return {
    choiceLabel: choiceLabel || "",
    prose: outcomeText || "The moment passes.",
    changeNote,
    displayedBefore,
    displayedAfter,
    displayedDelta: dispDelta,
    rawDelta,
    effectKind,
    limitedBy: limitedBy || "none",
  };
}

/**
 * Pick a weighted outcome for a choice using the opening outcome stream.
 */
export function rollOpeningChoiceResult(player, choice, { momentIndex = 0 } = {}) {
  const rng = createStreamRng(
    careerId(player),
    `${ACADEMY_OPENING.streams.outcomes}:roll:${momentIndex}:${choice?.id || "choice"}`
  );
  return pickWeightedChoiceResult(choice, rng);
}

/**
 * Advance cursor after a moment is acknowledged.
 */
export function advanceOpeningCursor(player) {
  const state = player.academyOpening;
  if (!state) return 0;
  state.cursor = Math.min((state.cursor || 0) + 1, (state.scenarios || []).length);
  if (state.cursor >= (state.scenarios || []).length) state.complete = true;
  return state.cursor;
}

/**
 * Full programmatic opening for calibration / tests.
 * @param {object} player
 * @param {{policy:string, rng?:object}} opts
 *   policy: "balanced" | "thoughtful" | "reckless" | "random"
 */
export function simulateFullAcademyOpening(player, { policy = "balanced", rng = null } = {}) {
  const scenarioRng =
    rng?.fork?.("scenarios") ||
    createStreamRng(careerId(player), ACADEMY_OPENING.streams.scenarios);
  ensureAcademyOpeningState(player, { rng: scenarioRng });

  const scenarios = getOpeningScenarios(player);
  const results = [];
  for (let i = 0; i < scenarios.length; i++) {
    const sc = scenarios[i];
    const choice = selectChoiceByPolicy(sc, policy, scenarioRng.fork(`choice:${i}`));
    const outcome = pickWeightedChoiceResult(choice, scenarioRng.fork(`outcome:${i}`));
    const applied = applyOpeningMoment(player, {
      scenario: sc,
      choice,
      outcome,
      momentIndex: i,
    });
    results.push(applied);
    advanceOpeningCursor(player);
  }
  const baseline = finalizeAcademyOpening(player);
  return {
    results,
    baseline,
    opening: player.academyOpening,
    rating: player.rating,
  };
}

function selectChoiceByPolicy(scenario, policy, rng) {
  const choices = scenario.choices || [];
  if (!choices.length) return { label: "—", results: [{ delta: 0, text: "—" }] };
  if (policy === "random") return rng.pick(choices);

  const rank = (d) => {
    if (d === "thoughtful") return 3;
    if (d === "balanced") return 2;
    if (d === "ambitious") return 1;
    return 0;
  };

  if (policy === "thoughtful") {
    return [...choices].sort((a, b) => rank(b.disposition) - rank(a.disposition))[0];
  }
  if (policy === "reckless") {
    return [...choices].sort((a, b) => rank(a.disposition) - rank(b.disposition))[0];
  }
  // Ordinary / balanced: uniform among all options (not post-selected for success).
  return rng.pick(choices);
}

/** Resume helpers for snapshot tests */
export function reopenScenarioFromState(player, index) {
  const state = player.academyOpening;
  if (!state?.scenarios?.[index]) {
    const id = state?.scenarioIds?.[index];
    return id ? getScenarioById(id) : null;
  }
  return state.scenarios[index];
}

export { ACADEMY_OPENING };
