/**
 * Senior career optional decision scenes (football, media, relationships, lifestyle).
 * Category probabilities come from the academy-reference transform; authored
 * outcomes supply conditional weights within each ability category.
 */
import { SENIOR_CAREER_SCENARIOS } from "../config/seniorCareerScenarioConfig.js?v=88";
import {
  categoryForDelta,
  sampleAbilityCategory,
  sampleOutcomeInCategory,
  seniorCategoryProbabilities,
  validateAbilityCategoryMatch,
} from "../simulation/seniorOutcomeProbability.js?v=88";

function slugPart(text, fallback = "x") {
  const s = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return s || fallback;
}

export function inferSeniorDisposition(label) {
  const t = String(label || "").toLowerCase();
  if (
    /\b(blame|insult|dismiss|ignore|hide|mock|double down|lose your temper|without (telling|checking|discussing)|turn it into a speech|shut yourself|exhaust|all night|promise.*fail|skip the|chase the number|argue over status|refuse to|stop engaging|reliving the blame)\b/.test(
      t
    )
  ) {
    return "reckless";
  }
  if (
    /\b(private|measured|honest|arrange|approved|follow|recovery|clarif|media officer|ask (staff|an experienced|for specific)|remote|wave|reschedule|programme|patient|calm|share responsibility|isolate one|controlled progression)\b/.test(
      t
    )
  ) {
    return "thoughtful";
  }
  if (
    /\b(ready for bigger|encourage the rumour|motivation|accept and keep|targeted session|dominate|volunteer|demanding|harder|more challenging|ambitious)\b/.test(
      t
    )
  ) {
    return "ambitious";
  }
  return "balanced";
}

const VALID_FOCUS = new Set([
  "role-learning",
  "technique",
  "routine",
  "support",
  "adaptation",
]);

function defaultFocusFor(scenario) {
  const tags = scenario?.tags || [];
  if (tags.includes("recovery") || tags.includes("travel")) return "routine";
  if (tags.includes("family") || tags.includes("partner")) return "support";
  if (tags.includes("adaptation") || tags.includes("loan")) return "adaptation";
  if (tags.includes("technique") || tags.includes("training")) return "technique";
  return "role-learning";
}

function ensureCategoryOutcomes(choiceId, results, focus) {
  const byCat = { positive: [], neutral: [], negative: [] };
  for (const r of results) {
    const cat = r.abilityCategory || categoryForDelta(r.delta);
    byCat[cat].push(r);
  }
  const fill = (cat, delta, text) => {
    if (byCat[cat].length) return;
    byCat[cat].push({
      id: `${choiceId}:${cat}`,
      abilityCategory: cat,
      delta,
      conditionalWeight: 1,
      focus,
      text,
      effects: cat === "neutral" ? ["none"] : ["morale"],
      _autoFilled: true,
    });
  };
  fill(
    "positive",
    1,
    "You handle the situation with enough focus that useful habits stick in training."
  );
  fill(
    "neutral",
    0,
    "You manage the moment without changing how you prepare or develop."
  );
  fill(
    "negative",
    -1,
    "The disruption carries into training and sets your development back slightly."
  );
  return [...byCat.positive, ...byCat.neutral, ...byCat.negative];
}

/**
 * Attach stable IDs, dispositions, ability categories, and conditional weights.
 * Idempotent: already-normalized content is not shifted again.
 */
export function normalizeSeniorScenario(scenario, index = 0) {
  if (!scenario || typeof scenario !== "object") {
    throw new Error("normalizeSeniorScenario: scenario required");
  }
  if (scenario._seniorNormalized === SENIOR_CAREER_SCENARIOS.probabilityModelVersion) {
    return scenario;
  }

  const id = scenario.id || `senior-${index}-${slugPart(scenario.setup)}`;
  const focusDefault = scenario.focus || defaultFocusFor(scenario);
  const choices = (scenario.choices || []).map((choice, ci) => {
    const disposition = choice.disposition || inferSeniorDisposition(choice.label);
    if (!["thoughtful", "balanced", "ambitious", "reckless"].includes(disposition)) {
      throw new Error(`normalizeSeniorScenario: bad disposition on ${id} choice ${ci}`);
    }
    const choiceId = choice.id || `${id}:c${ci}-${slugPart(choice.label, `c${ci}`)}`;
    let results = choice.results || [];
    if (!results.length) {
      throw new Error(`normalizeSeniorScenario: empty results for ${choiceId}`);
    }

    // Upgrade sparse legacy lists so every category exists before validation.
    results = ensureCategoryOutcomes(choiceId, results, choice.focus || focusDefault);

    const normalizedResults = results.map((r, ri) => {
      const delta = Number(r.delta);
      if (!Number.isFinite(delta) || !Number.isInteger(delta) || delta < -4 || delta > 4) {
        throw new Error(`normalizeSeniorScenario: invalid delta on ${choiceId}#${ri}`);
      }
      const abilityCategory = r.abilityCategory || categoryForDelta(delta);
      validateAbilityCategoryMatch(abilityCategory, delta);
      let conditionalWeight = r.conditionalWeight ?? r.weight;
      if (conditionalWeight == null) conditionalWeight = SENIOR_CAREER_SCENARIOS.defaultUnweightedWeight;
      conditionalWeight = Number(conditionalWeight);
      if (!Number.isFinite(conditionalWeight) || conditionalWeight <= 0) {
        throw new Error(`normalizeSeniorScenario: invalid conditionalWeight on ${choiceId}#${ri}`);
      }
      const focus = VALID_FOCUS.has(r.focus) ? r.focus : focusDefault;
      const effects = Array.isArray(r.effects)
        ? r.effects
        : r.effect
          ? [r.effect]
          : inferEffects(delta, r.text);
      return {
        ...r,
        id: r.id || `${choiceId}:o${ri}-${abilityCategory}-d${delta}`,
        delta,
        abilityCategory,
        conditionalWeight,
        // Legacy `weight` kept equal to conditionalWeight for diagnostics only.
        weight: conditionalWeight,
        focus,
        effects,
      };
    });

    for (const cat of ["positive", "neutral", "negative"]) {
      if (!normalizedResults.some((r) => r.abilityCategory === cat)) {
        throw new Error(`normalizeSeniorScenario: ${choiceId} missing ${cat} outcomes`);
      }
    }

    const probs = seniorCategoryProbabilities(disposition);
    return {
      ...choice,
      id: choiceId,
      disposition,
      academyReferenceProfile: choice.academyReferenceProfile || disposition,
      seniorCategoryProbabilities: probs.senior,
      academyReferenceProbabilities: {
        positive: probs.academyReference.positive,
        neutral: probs.academyReference.neutral,
        negative: probs.academyReference.negative,
      },
      results: normalizedResults,
    };
  });

  if (choices.length !== 3) {
    throw new Error(`normalizeSeniorScenario: ${id} must have exactly 3 choices`);
  }

  return {
    ...scenario,
    id,
    title: scenario.title || id,
    contentVersion: scenario.contentVersion || SENIOR_CAREER_SCENARIOS.contentVersion,
    eligibility: scenario.eligibility?.length ? scenario.eligibility : ["senior"],
    tags: scenario.tags || [],
    choices,
    _seniorNormalized: SENIOR_CAREER_SCENARIOS.probabilityModelVersion,
  };
}

function inferEffects(delta, text) {
  const t = String(text || "").toLowerCase();
  if (delta === 0) return ["none"];
  const out = [];
  if (/\b(rest|fatigue|readiness|recover|exhausted|sharp)\b/.test(t)) out.push("readiness");
  if (/\b(trust|coach|squad)\b/.test(t)) out.push("coachTrust");
  if (/\b(reputation|media|headline|public|fan)\b/.test(t)) out.push("reputation");
  if (/\b(learn|mentor|training|focus|clip)\b/.test(t)) out.push("training");
  if (/\b(partner|family|support|homesick|relationship)\b/.test(t)) out.push("support");
  if (/\b(morale|confidence|composure|pressure|focus)\b/.test(t) || !out.length) out.push("morale");
  return out;
}

/**
 * Two-step sampler: category from academy-reference transform, then conditional
 * outcome within that category. Does not flatten category weights into one pot.
 */
export function pickWeightedSeniorResult(choice, rng = null, opts = {}) {
  const raw = choice?.results;
  if (!raw?.length) {
    return {
      id: "empty",
      delta: 0,
      abilityCategory: "neutral",
      conditionalWeight: 1,
      weight: 1,
      text: "The moment passes.",
      effects: ["none"],
      focus: "routine",
    };
  }
  const disposition = choice.disposition || inferSeniorDisposition(choice.label);
  const byCat = { positive: [], neutral: [], negative: [] };
  for (const r of raw) {
    const delta = Number(r.delta);
    if (!Number.isFinite(delta)) {
      throw new Error(`pickWeightedSeniorResult: invalid delta on ${choice.id}`);
    }
    const abilityCategory = r.abilityCategory || categoryForDelta(delta);
    validateAbilityCategoryMatch(abilityCategory, delta);
    const conditionalWeight = Number(r.conditionalWeight ?? r.weight ?? 1);
    if (!Number.isFinite(conditionalWeight) || conditionalWeight <= 0) {
      throw new Error(`pickWeightedSeniorResult: invalid conditionalWeight on ${r.id}`);
    }
    byCat[abilityCategory].push({
      ...r,
      delta,
      abilityCategory,
      conditionalWeight,
      weight: conditionalWeight,
      effects: Array.isArray(r.effects) ? r.effects : r.effect ? [r.effect] : ["morale"],
    });
  }
  for (const cat of ["positive", "neutral", "negative"]) {
    if (!byCat[cat].length) {
      throw new Error(`pickWeightedSeniorResult: ${choice.id} missing ${cat} outcomes`);
    }
  }

  const categoryRng = opts.categoryRng || rng;
  const conditionalRng = opts.conditionalRng || rng;
  const intendedCategory =
    opts.forceCategory || sampleAbilityCategory(disposition, categoryRng);
  const picked = sampleOutcomeInCategory(byCat[intendedCategory], conditionalRng);
  return { ...picked, intendedCategory };
}

/** Compact outcome helper for bank authoring. */
function R(delta, text, effects, extra = {}) {
  const abilityCategory = categoryForDelta(delta);
  return {
    delta,
    text,
    effects,
    abilityCategory,
    conditionalWeight: extra.conditionalWeight ?? 1,
    focus: extra.focus,
    ...extra,
  };
}

/* -------------------------------------------------------------------------- */
/* Scenario banks — legacy 24 + new 56 (imported when present)                */
/* -------------------------------------------------------------------------- */

import { LEGACY_SENIOR_SCENARIO_DEFS } from "./seniorCareerScenarioBankLegacy.js?v=88";
import { NEW_SENIOR_SCENARIO_DEFS } from "./seniorCareerScenarioBankNew.js?v=88";

const SENIOR_SCENARIO_DEFS = [...LEGACY_SENIOR_SCENARIO_DEFS, ...NEW_SENIOR_SCENARIO_DEFS];

let _bank = null;
let _byId = null;

function buildBank() {
  const byId = new Map();
  const list = SENIOR_SCENARIO_DEFS.map((sc, i) => {
    const n = normalizeSeniorScenario(sc, i);
    if (byId.has(n.id)) {
      throw new Error(`duplicate senior scenario id: ${n.id}`);
    }
    byId.set(n.id, n);
    return n;
  });
  _bank = list;
  _byId = byId;
  return list;
}

export function getSeniorScenarioBank() {
  return _bank || buildBank();
}

export function getSeniorScenarioById(id) {
  if (!_byId) buildBank();
  return _byId.get(id) || null;
}

export function allSeniorScenarios() {
  return getSeniorScenarioBank();
}

export function resetSeniorScenarioBankCache() {
  _bank = null;
  _byId = null;
}

export { R, SENIOR_SCENARIO_DEFS };
