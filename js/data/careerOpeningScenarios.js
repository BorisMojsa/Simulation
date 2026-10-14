/**
 * Academy opening moments. Each choice lists concrete results where
 * narrative text is paired with a narrative score (delta). Realized
 * development is applied through the academy opening model — not as a
 * raw OVR += delta. Outcomes are weighted; unweighted entries get defaults.
 */
import {
  ACADEMY_OPENING,
  OUTCOME_WEIGHT_BY_DISPOSITION,
} from "../config/academyOpeningConfig.js?v=76";

export function scenarioGroupForPosition(position) {
  if (position === "GK") return "GK";
  if (["RB", "LB", "CB", "CDM"].includes(position)) return "DEF";
  if (["RW", "LW"].includes(position)) return "WING";
  if (position === "ST") return "ST";
  return "MID";
}

function slugPart(text, fallback = "x") {
  const s = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return s || fallback;
}

export function inferChoiceDisposition(label) {
  const t = String(label || "").toLowerCase();
  if (
    /\b(showboat|ignore|aggressively|every lost|hunt a second|dive in|gamble|force it|refuse|skip recovery|train through|smash volume|brush it off|isolate|sulk|blame the)\b/.test(
      t
    )
  ) {
    return "reckless";
  }
  if (
    /\b(hold the line|safety|manage the game|organise|organize|call a defender|clear into|recycle|patient|ask (the )?coach|ask for specific feedback|request feedback|recover|rest|listen|help (a )?teammate|stay with the group|plan a split|respond in training)\b/.test(
      t
    )
  ) {
    return "thoughtful";
  }
  if (
    /\b(fly and punch|go for goal|press high|ask for the ball|take the shot|step out|drive at|try the)\b/.test(
      t
    )
  ) {
    return "ambitious";
  }
  return "balanced";
}

function defaultWeightFor(delta, disposition) {
  const table = OUTCOME_WEIGHT_BY_DISPOSITION[disposition] || OUTCOME_WEIGHT_BY_DISPOSITION.balanced;
  const w = table[String(delta)];
  if (Number.isFinite(w) && w > 0) return w;
  return ACADEMY_OPENING.defaultUnweightedWeight;
}

function inferEffect(delta, text) {
  const t = String(text || "").toLowerCase();
  if (delta === 0) return "none";
  // Mild narrative setbacks are usually confidence/learning — not durable −OVR.
  if (delta === -1) return "confidence";
  if (
    delta === -2 &&
    /\b(confidence|morale|dressing room|trust|quiet for the wrong|doubt lingers|mood)\b/.test(t)
  ) {
    return "confidence";
  }
  return "ability";
}

/**
 * Attach stable IDs, dispositions, and positive weights. Idempotent.
 */
export function normalizeOpeningScenario(scenario, group = "MID", index = 0) {
  if (!scenario || typeof scenario !== "object") {
    throw new Error("normalizeOpeningScenario: scenario required");
  }
  const id = scenario.id || `${group.toLowerCase()}-${index}-${slugPart(scenario.setup)}`;
  const choices = (scenario.choices || []).map((choice, ci) => {
    const disposition = choice.disposition || inferChoiceDisposition(choice.label);
    const choiceId = choice.id || `${id}:c${ci}-${slugPart(choice.label, `c${ci}`)}`;
    const results = choice.results || [];
    if (!results.length) {
      throw new Error(`normalizeOpeningScenario: empty results for ${choiceId}`);
    }
    const normalizedResults = results.map((r, ri) => {
      const delta = Number(r.delta);
      if (!Number.isFinite(delta)) {
        throw new Error(`normalizeOpeningScenario: invalid delta on ${choiceId}#${ri}`);
      }
      let weight = r.weight;
      if (weight == null) weight = defaultWeightFor(delta, disposition);
      weight = Number(weight);
      if (!Number.isFinite(weight) || weight <= 0) {
        throw new Error(`normalizeOpeningScenario: invalid weight on ${choiceId}#${ri}`);
      }
      return {
        ...r,
        id: r.id || `${choiceId}:o${ri}-d${delta}`,
        delta,
        weight,
        effect: r.effect || inferEffect(delta, r.text),
        disruption: Boolean(r.disruption),
      };
    });
    return {
      ...choice,
      id: choiceId,
      disposition,
      results: normalizedResults,
    };
  });
  return { ...scenario, id, group, choices };
}

let _normalizedBank = null;
let _byId = null;

function buildNormalizedBank() {
  const bank = { ...OPENING_SCENARIOS, LIFE: LIFE_SCENARIOS };
  const byId = new Map();
  const out = {};
  for (const [group, list] of Object.entries(bank)) {
    out[group] = (list || []).map((sc, i) => {
      const n = normalizeOpeningScenario(sc, group, i);
      byId.set(n.id, n);
      return n;
    });
  }
  _normalizedBank = out;
  _byId = byId;
  return out;
}

export function getOpeningScenarioBank() {
  return _normalizedBank || buildNormalizedBank();
}

export function getScenarioById(id) {
  if (!_byId) buildNormalizedBank();
  return _byId.get(id) || null;
}

export function allOpeningScenarios() {
  const bank = getOpeningScenarioBank();
  return Object.values(bank).flat();
}

/**
 * Pick distinct scenarios for an opening: mostly positional, plus academy-life beats.
 * @param {string} position
 * @param {number} count
 * @param {{shuffle?:Function, pick?:Function, random?:Function}|null} rng
 */
export function pickScenariosForPosition(position, count = 5, rng = null) {
  const bank = getOpeningScenarioBank();
  const key = scenarioGroupForPosition(position);
  const positional = [...(bank[key] ?? bank.MID)];
  const life = [...(bank.LIFE || [])];
  const lifeN = Math.min(
    ACADEMY_OPENING.lifeMomentCount,
    Math.max(0, count - 1),
    life.length
  );
  const posN = Math.min(count - lifeN, positional.length);

  const shuffle = (arr) => {
    const copy = [...arr];
    if (rng?.shuffle) return rng.shuffle(copy);
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor((rng?.random?.() ?? Math.random()) * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  const picked = [...shuffle(positional).slice(0, posN), ...shuffle(life).slice(0, lifeN)];
  const ids = new Set();
  const unique = [];
  for (const sc of shuffle(picked)) {
    if (ids.has(sc.id)) continue;
    ids.add(sc.id);
    unique.push(sc);
    if (unique.length >= count) break;
  }
  // Fill from positional if life/position overlap left gaps
  for (const sc of shuffle(positional)) {
    if (unique.length >= count) break;
    if (ids.has(sc.id)) continue;
    ids.add(sc.id);
    unique.push(sc);
  }
  return unique.slice(0, count);
}

/**
 * Weighted outcome sample. Compatibility: missing weights use disposition defaults
 * via normalizeOpeningScenario / defaultWeightFor.
 */
export function pickWeightedChoiceResult(choice, rng = null) {
  const raw = choice?.results;
  if (!raw?.length) {
    return { id: "empty", delta: 0, weight: 1, text: "The moment passes.", effect: "none" };
  }
  const disposition = choice.disposition || inferChoiceDisposition(choice.label);
  const results = raw.map((r, ri) => {
    let weight = r.weight;
    if (weight == null) weight = defaultWeightFor(Number(r.delta) || 0, disposition);
    weight = Number(weight);
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new Error(`pickWeightedChoiceResult: invalid weight at ${choice.id || choice.label}#${ri}`);
    }
    return { ...r, weight, delta: Number(r.delta) || 0 };
  });
  const total = results.reduce((s, r) => s + r.weight, 0);
  if (!(total > 0)) {
    throw new Error("pickWeightedChoiceResult: empty weight sum");
  }
  let roll = (rng?.random?.() ?? Math.random()) * total;
  for (const r of results) {
    roll -= r.weight;
    if (roll <= 0) return r;
  }
  return results[results.length - 1];
}

/** @deprecated Prefer pickWeightedChoiceResult with a career-scoped RNG. */
export function pickChoiceResult(choice, rng = null) {
  return pickWeightedChoiceResult(choice, rng);
}

export const OPENING_SCENARIOS = {
  GK: [
    {
      setup: "Cup semi-final, late. A lofted ball drops toward the far top corner. Commit now or hold?",
      choices: [
        {
          label: "Fly and punch aggressively",
          results: [
            {
              delta: 3,
              text: "Clean punch. Chaos clears and the counter starts."
            },
            {
              delta: 2,
              text: "You get a fist on it. Scramble, but no goal."
            },
            {
              delta: 1,
              text: "Partial contact. A defender boots it clear."
            },
            {
              delta: 0,
              text: "You miss the punch but the shot sails over."
            },
            {
              delta: -1,
              text: "You come and miss. They nod wide. Lucky escape."
            },
            {
              delta: -2,
              text: "Collision, no contact on the ball. Soft header in."
            },
            {
              delta: -3,
              text: "Wrong call. You leave a gaping net behind you."
            }
          ]
        },
        {
          label: "Hold the line and narrow the angle",
          results: [
            {
              delta: 3,
              text: "Perfect positioning. The shot hits you and sticks."
            },
            {
              delta: 2,
              text: "You stand tall. The ball skims the post."
            },
            {
              delta: 1,
              text: "Good shape. Weak shot gathered."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Call a defender to head clear",
          results: [
            {
              delta: 2,
              text: "Your shout organises it. Header away."
            },
            {
              delta: 1,
              text: "They clear under pressure."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "A short back-pass. Striker closes fast. Clear, dribble, or first-time pass?",
      choices: [
        {
          label: "Clear into the stands if needed",
          results: [
            {
              delta: 2,
              text: "Safety first. Reset with no drama."
            },
            {
              delta: 1,
              text: "Into touch. Groans, but clean."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Take a touch and beat the press",
          results: [
            {
              delta: 3,
              text: "You glide past. Bench loves the composure."
            },
            {
              delta: 2,
              text: "You escape by a toe. Heart in mouth."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "First-time pass to full-back",
          results: [
            {
              delta: 3,
              text: "Crisp ball out. Attack builds."
            },
            {
              delta: 1,
              text: "Playable pass under pressure."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        }
      ]
    },
    {
      setup: "Penalty in a derby youth match. Dive early, wait, or stay big?",
      choices: [
        {
          label: "Guess left early",
          results: [
            {
              delta: 3,
              text: "You nail the side. Penalty saved."
            },
            {
              delta: 2,
              text: "Strong hand. Ball loops over."
            },
            {
              delta: 1,
              text: "You force a weak finish into your gloves."
            },
            {
              delta: 0,
              text: "Wrong way, but it hits the post."
            },
            {
              delta: -1,
              text: "Wrong way. Soft into the corner."
            },
            {
              delta: -2,
              text: "Early dive. They roll the other side."
            },
            {
              delta: -3,
              text: "Fully committed left. Ball goes right. Loud silence."
            }
          ]
        },
        {
          label: "Wait and react late",
          results: [
            {
              delta: 3,
              text: "Strong hand. Rebound cleared."
            },
            {
              delta: 2,
              text: "You read the hips. Saved."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Stay big and central",
          results: [
            {
              delta: 2,
              text: "They panic and lift it over."
            },
            {
              delta: 1,
              text: "You fill the goal. Weak penalty gathered."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Defence high. Ball over the top. Sweep or hold the box?",
      choices: [
        {
          label: "Sprint out as sweeper-keeper",
          results: [
            {
              delta: 4,
              text: "Textbook toe away."
            },
            {
              delta: 2,
              text: "You get there first. Clear."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Hold and trust recovery runs",
          results: [
            {
              delta: 2,
              text: "Last-ditch tackle saves you."
            },
            {
              delta: 1,
              text: "Cover arrives. Shot blocked."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Show for a square ball and organise",
          results: [
            {
              delta: 2,
              text: "They hesitate. Defence arrives."
            },
            {
              delta: 1,
              text: "Pass never comes. Shot from distance gathered."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Set piece. Wall argues. Organise or trust your read?",
      choices: [
        {
          label: "Add a body on the post",
          results: [
            {
              delta: 3,
              text: "Post clatter saves a certain goal."
            },
            {
              delta: 1,
              text: "Extra body blocks the angle."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Rebuild the wall wider",
          results: [
            {
              delta: 2,
              text: "Wider wall blocks the shot."
            },
            {
              delta: 1,
              text: "They go under. You gather."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Trust the wall and read the flight",
          results: [
            {
              delta: 3,
              text: "Fingertip over the bar."
            },
            {
              delta: 2,
              text: "You fly and tip it wide."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Coach wants quick distribution. Long, short, or clipped?",
      choices: [
        {
          label: "Long diagonal to the winger",
          results: [
            {
              delta: 3,
              text: "Perfect weight. Break is on."
            },
            {
              delta: 1,
              text: "Playable ball. Attack starts."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Short to the six",
          results: [
            {
              delta: 3,
              text: "Tempo control. Staff nod."
            },
            {
              delta: 1,
              text: "Clean recycle under press."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Clip toward the striker",
          results: [
            {
              delta: 2,
              text: "Striker brings it down. Half chance."
            },
            {
              delta: 1,
              text: "Useful second ball."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Reflex drill from six yards. Crowd noise tape on. Embrace or focus?",
      choices: [
        {
          label: "Crank the noise and embrace chaos",
          results: [
            {
              delta: 3,
              text: "You thrive. Coach notes composure."
            },
            {
              delta: 2,
              text: "Spill then settle. Strong finish."
            },
            {
              delta: 1,
              text: "Solid set despite the tape."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Ask for silence on the first set",
          results: [
            {
              delta: 2,
              text: "Clean fundamentals locked."
            },
            {
              delta: 1,
              text: "Quiet reps help. You look sharp."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Alternate sets with a teammate",
          results: [
            {
              delta: 2,
              text: "Competition lifts both of you."
            },
            {
              delta: 1,
              text: "Good work rate. Notes written."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Fans behind the goal are loud. Next goal kick: hurry, slow, or acknowledge?",
      choices: [
        {
          label: "Quick goal kick, front foot",
          results: [
            {
              delta: 2,
              text: "You catch them sleeping. Counter."
            },
            {
              delta: 1,
              text: "Quick restart works."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Slow it down and reset shape",
          results: [
            {
              delta: 2,
              text: "Rhythm returns. Defence organises."
            },
            {
              delta: 1,
              text: "Calm restart. Good leadership."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Small wave, ice in the veins",
          results: [
            {
              delta: 3,
              text: "They boo louder. You smile and play."
            },
            {
              delta: 1,
              text: "Mentally strong. Staff like it."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Injured defender leaves. You organise the wall for a free kick.",
      choices: [
        {
          label: "Point and shout assignments",
          results: [
            {
              delta: 3,
              text: "Clear jobs. Header away."
            },
            {
              delta: 2,
              text: "Organised. Shot blocked."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Mark the runner yourself",
          results: [
            {
              delta: 2,
              text: "You meet it first. Punch clear."
            },
            {
              delta: 1,
              text: "You win the duel."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Trust zonal lanes",
          results: [
            {
              delta: 2,
              text: "Zonal works. Calm clearance."
            },
            {
              delta: 1,
              text: "Lanes hold. Shot wide."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Rival striker stands over a free kick. Mind games or silence?",
      choices: [
        {
          label: "Low words, professional tone",
          results: [
            {
              delta: 2,
              text: "They drag it wide."
            },
            {
              delta: 1,
              text: "You stay big. Weak effort."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Stay silent and set your feet",
          results: [
            {
              delta: 3,
              text: "Clean save. Rebound cleared."
            },
            {
              delta: 2,
              text: "Good stance. Shot hits the wall."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Step on the line early to pressure",
          results: [
            {
              delta: 1,
              text: "They hesitate. Saved."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Cross comes in. Claim, punch, or stay?",
      choices: [
        {
          label: "Claim at the highest point",
          results: [
            {
              delta: 4,
              text: "Strong claim. Crowd noise dies."
            },
            {
              delta: 2,
              text: "Clean catch under traffic."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Punch clear with two fists",
          results: [
            {
              delta: 3,
              text: "Huge punch. Break is on."
            },
            {
              delta: 1,
              text: "Distance gained. Reset."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Stay on your line and read",
          results: [
            {
              delta: 2,
              text: "Perfect read. Shot gathered."
            },
            {
              delta: 1,
              text: "You hold. Header wide."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "1v1 after a defensive mistake. Rush or wait?",
      choices: [
        {
          label: "Close the angle fast",
          results: [
            {
              delta: 4,
              text: "Smothered. Huge save."
            },
            {
              delta: 2,
              text: "You force a weak finish."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Stay big and delay",
          results: [
            {
              delta: 3,
              text: "Striker snatches. Wide."
            },
            {
              delta: 1,
              text: "You stand tall. Block."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Show the weak foot side",
          results: [
            {
              delta: 2,
              text: "Forced wide. Shot blocked."
            },
            {
              delta: 1,
              text: "Good channeling. Corner."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Training: distribution under a press of mannequins plus one live runner.",
      choices: [
        {
          label: "Split the press with a line-breaking pass",
          results: [
            {
              delta: 3,
              text: "Silky. Midfield turns."
            },
            {
              delta: 2,
              text: "Weight perfect. Break on."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Go long early",
          results: [
            {
              delta: 2,
              text: "Safe. Second ball won."
            },
            {
              delta: 1,
              text: "Useful outlet."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Touch and go around the runner",
          results: [
            {
              delta: 3,
              text: "Touch and go. Attack lives."
            },
            {
              delta: 1,
              text: "Brave and clean."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        }
      ]
    },
    {
      setup: "Youth final. Rain. Ball skids. Catch or parry?",
      choices: [
        {
          label: "Attack the bounce and catch",
          results: [
            {
              delta: 3,
              text: "Clean take. Calm spreads."
            },
            {
              delta: 2,
              text: "Wet ball sticks."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Parry wide of traffic",
          results: [
            {
              delta: 2,
              text: "Smart parry. Away from danger."
            },
            {
              delta: 1,
              text: "Safe. Throw-in."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Stay and hope it sits up",
          results: [
            {
              delta: 1,
              text: "It sits. You claim."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Coach asks you to start as a sweeper-keeper in a rondo-heavy shape.",
      choices: [
        {
          label: "Step high and join the build",
          results: [
            {
              delta: 3,
              text: "You look modern. Staff impressed."
            },
            {
              delta: 2,
              text: "Good touches. Tempo rises."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Stay conservative on the edge of the box",
          results: [
            {
              delta: 2,
              text: "Balanced. No disasters."
            },
            {
              delta: 1,
              text: "Solid. Coach accepts it."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Communicate constantly and manage the line",
          results: [
            {
              delta: 3,
              text: "Leadership notes everywhere."
            },
            {
              delta: 2,
              text: "Line holds. Clean sheet vibe."
            },
            {
              delta: 1,
              text: "Useful organising."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Last kick of a shootout. Opponent's best taker. Ritual or reset?",
      choices: [
        {
          label: "Stick to your ritual",
          results: [
            {
              delta: 3,
              text: "Saved. Absolute scenes."
            },
            {
              delta: 2,
              text: "Strong dive. Rebound wide."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Change side at the last second",
          results: [
            {
              delta: 2,
              text: "They freeze. Saved."
            },
            {
              delta: 1,
              text: "Lucky guess works."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Talk yourself calm and react",
          results: [
            {
              delta: 3,
              text: "Ice cold. Big save."
            },
            {
              delta: 1,
              text: "Good process. Near miss."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    }
  ],
  DEF: [
    {
      setup: "Winger isolates you near the touchline. Body up, step in, or funnel inside?",
      choices: [
        {
          label: "Show outside and funnel wide",
          results: [
            {
              delta: 3,
              text: "Cross sails over. Whistle."
            },
            {
              delta: 2,
              text: "You shepherd him out."
            },
            {
              delta: 1,
              text: "He chops back. You stay with him."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Step in and win it now",
          results: [
            {
              delta: 4,
              text: "Clean tackle. Crowd noise."
            },
            {
              delta: 2,
              text: "Strong win. Reset."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Delay with body angle and wait for cover",
          results: [
            {
              delta: 2,
              text: "Help arrives. Tackle together."
            },
            {
              delta: 1,
              text: "Forced backward pass."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Corner. Mark the tower or zone near post?",
      choices: [
        {
          label: "Mark the biggest threat man-to-man",
          results: [
            {
              delta: 3,
              text: "You win the header. Clearance."
            },
            {
              delta: 2,
              text: "Tight marking. Shot blocked."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Zone the near post",
          results: [
            {
              delta: 2,
              text: "Flick cleared. Job done."
            },
            {
              delta: 1,
              text: "Near-post covered. Wide."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Screen and attack the flight",
          results: [
            {
              delta: 2,
              text: "Screen works. Punch lands."
            },
            {
              delta: 1,
              text: "First contact yours."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Through ball. Delay, step across, or sprint recovery?",
      choices: [
        {
          label: "Delay with body angle",
          results: [
            {
              delta: 3,
              text: "Pass goes sideways. Reset."
            },
            {
              delta: 2,
              text: "Forced backward."
            },
            {
              delta: 1,
              text: "Split but keeper sweeps."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Step across the lane",
          results: [
            {
              delta: 2,
              text: "Interception. Simple."
            },
            {
              delta: 1,
              text: "Lane closed. Throw-in."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Sprint recovery and track inside",
          results: [
            {
              delta: 2,
              text: "Shoulder to shoulder. Fair."
            },
            {
              delta: 1,
              text: "You recover. Block."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "You're on a yellow. Opponent runs past. Foul, chase, or funnel?",
      choices: [
        {
          label: "Professional foul, take the card",
          results: [
            {
              delta: 1,
              text: "Free kick wide. Acceptable."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Sprint recovery, no foul",
          results: [
            {
              delta: 3,
              text: "Track and block the shot."
            },
            {
              delta: 2,
              text: "Clean recovery. Corner."
            },
            {
              delta: 1,
              text: "You stay with him."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Track inside and funnel",
          results: [
            {
              delta: 2,
              text: "Shot blocked. Corner."
            },
            {
              delta: 1,
              text: "Channel works."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Build-up. Progressive pass, safe recycle, or dribble the first press?",
      choices: [
        {
          label: "Line-breaking progressive pass",
          results: [
            {
              delta: 3,
              text: "Break on. Coach claps."
            },
            {
              delta: 2,
              text: "Weight good. Attack."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Safe recycle to the centre-back",
          results: [
            {
              delta: 2,
              text: "Tempo retained."
            },
            {
              delta: 1,
              text: "Simple. Staff like calm."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Beat the first press yourself",
          results: [
            {
              delta: 3,
              text: "Carry breaks the line."
            },
            {
              delta: 1,
              text: "Brave and clean."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        }
      ]
    },
    {
      setup: "Training: 1v1 defending to goal. Opponent is quicker.",
      choices: [
        {
          label: "Force him onto the weak foot",
          results: [
            {
              delta: 3,
              text: "Forced wide. Shot blocked."
            },
            {
              delta: 2,
              text: "Channel perfect."
            },
            {
              delta: 1,
              text: "He cuts in late. You recover."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Show inside to your cover",
          results: [
            {
              delta: 2,
              text: "Cover makes the tackle."
            },
            {
              delta: 1,
              text: "Good teamwork."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Dive in early to stop the run",
          results: [
            {
              delta: 4,
              text: "Brave and correct. The drill tilts your way."
            },
            {
              delta: 1,
              text: "Clean if timed."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        }
      ]
    },
    {
      setup: "Rival fans chant your name. Not kindly. Next duel?",
      choices: [
        {
          label: "Win the next header aggressively",
          results: [
            {
              delta: 3,
              text: "You win it. Quiet returns."
            },
            {
              delta: 2,
              text: "Strong contact. Clear."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Stay silent and play simple",
          results: [
            {
              delta: 2,
              text: "Professional. Staff nod."
            },
            {
              delta: 1,
              text: "No drama. Clean."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Ask the ref to manage the noise",
          results: [
            {
              delta: 1,
              text: "Ref helps a little."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Teammates argue after a goal. Reset mood how?",
      choices: [
        {
          label: "Light joke to reset",
          results: [
            {
              delta: 2,
              text: "Laugh breaks tension."
            },
            {
              delta: 1,
              text: "Mood lifts."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Speak directly, professional tone",
          results: [
            {
              delta: 3,
              text: "They sharpen up."
            },
            {
              delta: 2,
              text: "Clear standards."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Let the coach handle it",
          results: [
            {
              delta: 1,
              text: "Coach sorts it."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "High press. Win ball high, hold shape, or drop?",
      choices: [
        {
          label: "Jump the press and win it high",
          results: [
            {
              delta: 3,
              text: "Win high. Goal follows."
            },
            {
              delta: 2,
              text: "Turnover. Chance."
            },
            {
              delta: 1,
              text: "Bypassed once. You learn."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Hold the block and stay compact",
          results: [
            {
              delta: 2,
              text: "Interception. Simple."
            },
            {
              delta: 1,
              text: "Shape holds."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Drop five yards and reset",
          results: [
            {
              delta: 1,
              text: "Safer. Attack resets."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Aerial duel vs a taller striker. Jump early, time it, or front him?",
      choices: [
        {
          label: "Jump early and meet at the highest point",
          results: [
            {
              delta: 4,
              text: "Brave and correct. The drill tilts your way."
            },
            {
              delta: 2,
              text: "You nick it. Brave."
            },
            {
              delta: 1,
              text: "Contact won."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Time the jump late",
          results: [
            {
              delta: 3,
              text: "Perfect timing. Header clear."
            },
            {
              delta: 2,
              text: "Clean win."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Front him and don't jump",
          results: [
            {
              delta: 2,
              text: "He can't climb. Wide shot."
            },
            {
              delta: 1,
              text: "Effective nuisance."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Full-back overlap. Tuck in, stay wide, or step into midfield?",
      choices: [
        {
          label: "Tuck into the box",
          results: [
            {
              delta: 2,
              text: "Solid cover. Cross cleared."
            },
            {
              delta: 1,
              text: "Good discipline."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Stay wide and trust the midfielder",
          results: [
            {
              delta: 2,
              text: "You stop the overlap."
            },
            {
              delta: 1,
              text: "Duel won."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Step into midfield and cut the switch",
          results: [
            {
              delta: 3,
              text: "You cut the switch. Break."
            },
            {
              delta: 1,
              text: "Useful interception."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Small-sided game. Coach wants aggressive recoveries.",
      choices: [
        {
          label: "Sprint every recovery",
          results: [
            {
              delta: 3,
              text: "Engine notes. Staff love it."
            },
            {
              delta: 2,
              text: "You win two balls late."
            },
            {
              delta: 1,
              text: "Good work rate."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Pick smart recoveries only",
          results: [
            {
              delta: 2,
              text: "Efficient. Clean."
            },
            {
              delta: 1,
              text: "Good decisions."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Save energy for the next drill",
          results: [
            {
              delta: 1,
              text: "Somehow it lands without chaos. Still a thin line."
            },
            {
              delta: 0,
              text: "No card, no praise. The moment just dies."
            },
            {
              delta: -1,
              text: "The dressing room goes quiet for the wrong reason."
            },
            {
              delta: -2,
              text: "You lose more than the duel — you lose trust."
            },
            {
              delta: -3,
              text: "Staff pull you aside. That reaction is not the culture here."
            }
          ]
        }
      ]
    },
    {
      setup: "You lose a duel. Next action?",
      choices: [
        {
          label: "Immediate recovery sprint",
          results: [
            {
              delta: 3,
              text: "You win it back. Character."
            },
            {
              delta: 2,
              text: "Recovery tackle."
            },
            {
              delta: 1,
              text: "You force a throw."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Organise behind the ball",
          results: [
            {
              delta: 2,
              text: "Shape resets."
            },
            {
              delta: 1,
              text: "Useful talking."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Blame the midfielder",
          results: [
            {
              delta: 1,
              text: "Somehow it lands without chaos. Still a thin line."
            },
            {
              delta: 0,
              text: "No card, no praise. The moment just dies."
            },
            {
              delta: -1,
              text: "The dressing room goes quiet for the wrong reason."
            },
            {
              delta: -2,
              text: "You lose more than the duel — you lose trust."
            },
            {
              delta: -3,
              text: "Staff pull you aside. That reaction is not the culture here."
            }
          ]
        }
      ]
    },
    {
      setup: "Long throw into your box. Attack it or hold the line?",
      choices: [
        {
          label: "Attack the flight early",
          results: [
            {
              delta: 3,
              text: "You clear first. Calm."
            },
            {
              delta: 2,
              text: "Strong contact."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Hold the line and clear second balls",
          results: [
            {
              delta: 2,
              text: "Second ball won."
            },
            {
              delta: 1,
              text: "Clean enough."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Mark space and call the keeper",
          results: [
            {
              delta: 2,
              text: "Keeper claims. Good."
            },
            {
              delta: 1,
              text: "Organised."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Opponent time-wastes. Stay professional or force the tempo?",
      choices: [
        {
          label: "Stay professional and play quick yourself",
          results: [
            {
              delta: 2,
              text: "Standards noted."
            },
            {
              delta: 1,
              text: "Clean response."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Ask the ref firmly",
          results: [
            {
              delta: 1,
              text: "Ref manages it."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Give a shove off the ball",
          results: [
            {
              delta: 1,
              text: "Somehow it lands without chaos. Still a thin line."
            },
            {
              delta: 0,
              text: "No card, no praise. The moment just dies."
            },
            {
              delta: -1,
              text: "The dressing room goes quiet for the wrong reason."
            },
            {
              delta: -2,
              text: "You lose more than the duel — you lose trust."
            },
            {
              delta: -3,
              text: "Staff pull you aside. That reaction is not the culture here."
            }
          ]
        }
      ]
    },
    {
      setup: "Youth league. Opponent leaves a foot in. React how?",
      choices: [
        {
          label: "Win the next duel clean and hard",
          results: [
            {
              delta: 3,
              text: "Message sent. Fair."
            },
            {
              delta: 2,
              text: "Strong but legal."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Ignore it and play",
          results: [
            {
              delta: 2,
              text: "Mature. Staff like it."
            },
            {
              delta: 1,
              text: "No drama."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Square up and talk",
          results: [
            {
              delta: 1,
              text: "Somehow it settles without a card. Thin ice."
            },
            {
              delta: 0,
              text: "The ref steps in before it becomes anything."
            },
            {
              delta: -1,
              text: "Booking. Staff hate the loss of control."
            },
            {
              delta: -2,
              text: "You get dragged into nonsense. Drill ruined."
            },
            {
              delta: -3,
              text: "Red heat. Coach ends your session early."
            }
          ]
        }
      ]
    },
    {
      setup: "Back three rotation. Ball to your weaker foot under press.",
      choices: [
        {
          label: "Open body and play forward",
          results: [
            {
              delta: 3,
              text: "Brave progressive pass."
            },
            {
              delta: 2,
              text: "Clean under pressure."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Switch across the back line",
          results: [
            {
              delta: 2,
              text: "Safe switch."
            },
            {
              delta: 1,
              text: "Calm."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Clear long",
          results: [
            {
              delta: 1,
              text: "Safe."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Night match. Floodlights. Blind-side runner.",
      choices: [
        {
          label: "Scan twice before engaging",
          results: [
            {
              delta: 3,
              text: "You spot him. Cutout."
            },
            {
              delta: 2,
              text: "Good awareness."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Stay ball-watching",
          results: [
            {
              delta: 1,
              text: "Somehow it lands without chaos. Still a thin line."
            },
            {
              delta: 0,
              text: "No card, no praise. The moment just dies."
            },
            {
              delta: -1,
              text: "The dressing room goes quiet for the wrong reason."
            },
            {
              delta: -2,
              text: "You lose more than the duel — you lose trust."
            },
            {
              delta: -3,
              text: "Staff pull you aside. That reaction is not the culture here."
            }
          ]
        },
        {
          label: "Ask full-back to tuck",
          results: [
            {
              delta: 2,
              text: "Shape holds."
            },
            {
              delta: 1,
              text: "Cover works."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    }
  ],
  MID: [
    {
      setup: "Back to goal, centre-back tight. Spin, lay off, or win a foul?",
      choices: [
        {
          label: "Spin into space",
          results: [
            {
              delta: 3,
              text: "You turn and drive. Chance."
            },
            {
              delta: 2,
              text: "Clean spin. Attack."
            },
            {
              delta: 1,
              text: "Half turn. Useful."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Lay off first touch",
          results: [
            {
              delta: 2,
              text: "Simple football. Coach likes it."
            },
            {
              delta: 1,
              text: "Clean link."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Invite contact and win a foul",
          results: [
            {
              delta: 4,
              text: "Brave and correct. The drill tilts your way."
            },
            {
              delta: 2,
              text: "Smart foul won."
            },
            {
              delta: 1,
              text: "Free kick."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        }
      ]
    },
    {
      setup: "Edge of the box. Top corner screamer, cut back, or recycle?",
      choices: [
        {
          label: "Top corner screamer",
          results: [
            {
              delta: 4,
              text: "It bends in. Cage rattles."
            },
            {
              delta: 3,
              text: "Keeper tips over. Technique turns heads."
            },
            {
              delta: 2,
              text: "Forces a strong save from nowhere."
            },
            {
              delta: 1,
              text: "Close. Staff note the confidence."
            },
            {
              delta: 0,
              text: "Row Z. Bold intent still registered."
            },
            {
              delta: -1,
              text: "Snatched. The shot never leaves the ground cleanly."
            },
            {
              delta: -2,
              text: "Keeper reads it early and holds. Ambition without accuracy."
            },
            {
              delta: -3,
              text: "Air mail. Coach stops the drill and resets the attack."
            }
          ]
        },
        {
          label: "Cut back to the late runner",
          results: [
            {
              delta: 3,
              text: "Perfect cut-back. Tap-in."
            },
            {
              delta: 2,
              text: "Dangerous ball in."
            },
            {
              delta: 1,
              text: "Deflected. Corner."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Recycle and reset the shape",
          results: [
            {
              delta: 2,
              text: "Patient. Good control."
            },
            {
              delta: 1,
              text: "Tempo settles."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Pressing trigger. Jump now, delay, or drop?",
      choices: [
        {
          label: "Jump the trigger now",
          results: [
            {
              delta: 3,
              text: "Win high. Chance."
            },
            {
              delta: 2,
              text: "Turnover."
            },
            {
              delta: 1,
              text: "Bypassed. Recover."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Delay and shepherd outside",
          results: [
            {
              delta: 2,
              text: "Forced wide."
            },
            {
              delta: 1,
              text: "Good cover."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Drop into the pocket",
          results: [
            {
              delta: 1,
              text: "Safer."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Switch of play under fatigue. Hit it, short, or carry?",
      choices: [
        {
          label: "Hit the full switch",
          results: [
            {
              delta: 3,
              text: "Pinpoint switch. Break."
            },
            {
              delta: 2,
              text: "Useful width."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Short and keep it",
          results: [
            {
              delta: 2,
              text: "Clean retention."
            },
            {
              delta: 1,
              text: "Simple."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Carry ten yards first",
          results: [
            {
              delta: 2,
              text: "Carry creates the angle."
            },
            {
              delta: 1,
              text: "Brave."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Free kick twenty-five yards. Shoot, clip, or short?",
      choices: [
        {
          label: "Shoot for the far top corner",
          results: [
            {
              delta: 4,
              text: "Goal. Scenes."
            },
            {
              delta: 2,
              text: "Whipped. Tip over."
            },
            {
              delta: 1,
              text: "Wall blocks. Rebound."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Clip to the far stick",
          results: [
            {
              delta: 3,
              text: "Perfect delivery. Header."
            },
            {
              delta: 1,
              text: "Dangerous."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Short and recycle",
          results: [
            {
              delta: 1,
              text: "Patient."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Number six role. Receive under pressure from two.",
      choices: [
        {
          label: "Body shape open, bounce pass",
          results: [
            {
              delta: 3,
              text: "Clean escape."
            },
            {
              delta: 2,
              text: "Tempo up."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Shield and wait for the angle",
          results: [
            {
              delta: 2,
              text: "Composed."
            },
            {
              delta: 1,
              text: "Simple out."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Turn and drive between them",
          results: [
            {
              delta: 3,
              text: "Line break."
            },
            {
              delta: 1,
              text: "Brave."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        }
      ]
    },
    {
      setup: "Box-to-box shift. Late box arrival or hold for recycle?",
      choices: [
        {
          label: "Arrive late in the box",
          results: [
            {
              delta: 3,
              text: "Late run. Goal."
            },
            {
              delta: 2,
              text: "Dangerous arrival."
            },
            {
              delta: 1,
              text: "Nearly."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Hold and offer recycle",
          results: [
            {
              delta: 2,
              text: "Useful link."
            },
            {
              delta: 1,
              text: "Team keeps ball."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Crash the near post",
          results: [
            {
              delta: 3,
              text: "Near-post flick."
            },
            {
              delta: 1,
              text: "Chaos. Chance."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        }
      ]
    },
    {
      setup: "Training rondo. Risk the killer pass or keep circulation?",
      choices: [
        {
          label: "Killer ball between lines",
          results: [
            {
              delta: 3,
              text: "Splits them. Coach stops session to praise."
            },
            {
              delta: 2,
              text: "Great weight."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Keep circulation crisp",
          results: [
            {
              delta: 2,
              text: "Tempo. Fundamentals."
            },
            {
              delta: 1,
              text: "Clean."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Dribble out of the press",
          results: [
            {
              delta: 4,
              text: "Brave and correct. The drill tilts your way."
            },
            {
              delta: 2,
              text: "Brave carry."
            },
            {
              delta: 1,
              text: "Escape."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        }
      ]
    },
    {
      setup: "Teammate demands the ball constantly. Manage it?",
      choices: [
        {
          label: "Play when the angle is on",
          results: [
            {
              delta: 3,
              text: "Good decision-making."
            },
            {
              delta: 2,
              text: "Timing right."
            },
            {
              delta: 1,
              text: "Mostly clean."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Feed him early to settle him",
          results: [
            {
              delta: 1,
              text: "Mood settles."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Tell him to move better",
          results: [
            {
              delta: 1,
              text: "Somehow it lands without chaos. Still a thin line."
            },
            {
              delta: 0,
              text: "No card, no praise. The moment just dies."
            },
            {
              delta: -1,
              text: "The dressing room goes quiet for the wrong reason."
            },
            {
              delta: -2,
              text: "You lose more than the duel — you lose trust."
            },
            {
              delta: -3,
              text: "Staff pull you aside. That reaction is not the culture here."
            }
          ]
        }
      ]
    },
    {
      setup: "Counter. First pass forward or secure?",
      choices: [
        {
          label: "First pass forward immediately",
          results: [
            {
              delta: 3,
              text: "Breaks the line. Chance."
            },
            {
              delta: 2,
              text: "Good tempo."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Secure then progress",
          results: [
            {
              delta: 2,
              text: "Controlled break."
            },
            {
              delta: 1,
              text: "Smart."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Carry into midfield yourself",
          results: [
            {
              delta: 2,
              text: "Drive creates numbers."
            },
            {
              delta: 1,
              text: "Useful."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Derby. Midfield scrap. Stay clean or match intensity?",
      choices: [
        {
          label: "Match intensity, stay legal",
          results: [
            {
              delta: 3,
              text: "Win the scrap. Respect."
            },
            {
              delta: 2,
              text: "Strong duels."
            },
            {
              delta: 1,
              text: "Even battle."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Stay technical and avoid chaos",
          results: [
            {
              delta: 2,
              text: "Composure."
            },
            {
              delta: 1,
              text: "Clean touches."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Go looking for a foul early",
          results: [
            {
              delta: 1,
              text: "Somehow it lands without chaos. Still a thin line."
            },
            {
              delta: 0,
              text: "No card, no praise. The moment just dies."
            },
            {
              delta: -1,
              text: "The dressing room goes quiet for the wrong reason."
            },
            {
              delta: -2,
              text: "You lose more than the duel — you lose trust."
            },
            {
              delta: -3,
              text: "Staff pull you aside. That reaction is not the culture here."
            }
          ]
        }
      ]
    },
    {
      setup: "Half-time. Coach asks for more verticality.",
      choices: [
        {
          label: "Commit to earlier forward passes",
          results: [
            {
              delta: 3,
              text: "Second half opens up."
            },
            {
              delta: 2,
              text: "Better progression."
            },
            {
              delta: 1,
              text: "Mixed."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Keep balance, pick moments",
          results: [
            {
              delta: 2,
              text: "Intelligent."
            },
            {
              delta: 1,
              text: "Steady."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Ignore and play your game",
          results: [
            {
              delta: 1,
              text: "Somehow it lands without chaos. Still a thin line."
            },
            {
              delta: 0,
              text: "No card, no praise. The moment just dies."
            },
            {
              delta: -1,
              text: "The dressing room goes quiet for the wrong reason."
            },
            {
              delta: -2,
              text: "You lose more than the duel — you lose trust."
            },
            {
              delta: -3,
              text: "Staff pull you aside. That reaction is not the culture here."
            }
          ]
        }
      ]
    },
    {
      setup: "Set piece routine. Near-post dart or delay at the edge?",
      choices: [
        {
          label: "Near-post dart",
          results: [
            {
              delta: 3,
              text: "Flick goal."
            },
            {
              delta: 2,
              text: "Chaos. Chance."
            },
            {
              delta: 1,
              text: "Nearly."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Delay at the edge for the second ball",
          results: [
            {
              delta: 2,
              text: "Second ball shot."
            },
            {
              delta: 1,
              text: "Useful."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Block the marker for a teammate",
          results: [
            {
              delta: 2,
              text: "Selfless. Header chance."
            },
            {
              delta: 1,
              text: "Good work."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "You receive facing your own goal near halfway.",
      choices: [
        {
          label: "First-time bounce to the eight",
          results: [
            {
              delta: 3,
              text: "Clean."
            },
            {
              delta: 2,
              text: "Tempo."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Turn inside under contact",
          results: [
            {
              delta: 2,
              text: "Brave turn."
            },
            {
              delta: 1,
              text: "Escape."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Go back to the centre-back",
          results: [
            {
              delta: 1,
              text: "Safe."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Injury to the captain. Armband comes to you mid-match.",
      choices: [
        {
          label: "Talk early and set two simple rules",
          results: [
            {
              delta: 3,
              text: "Leadership lands."
            },
            {
              delta: 2,
              text: "Useful voice."
            },
            {
              delta: 1,
              text: "Quiet but steady."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Lead by duels only",
          results: [
            {
              delta: 2,
              text: "You win battles."
            },
            {
              delta: 1,
              text: "Effort clear."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Defer everything to the coach",
          results: [
            {
              delta: 1,
              text: "Somehow it lands without chaos. Still a thin line."
            },
            {
              delta: 0,
              text: "No card, no praise. The moment just dies."
            },
            {
              delta: -1,
              text: "The dressing room goes quiet for the wrong reason."
            },
            {
              delta: -2,
              text: "You lose more than the duel — you lose trust."
            },
            {
              delta: -3,
              text: "Staff pull you aside. That reaction is not the culture here."
            }
          ]
        }
      ]
    },
    {
      setup: "Extra-time legs. Conserve or empty the tank?",
      choices: [
        {
          label: "Empty the tank for twenty minutes",
          results: [
            {
              delta: 3,
              text: "Engine defines you."
            },
            {
              delta: 2,
              text: "Win late duels."
            },
            {
              delta: 1,
              text: "Useful."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Conserve and pick moments",
          results: [
            {
              delta: 2,
              text: "Smart energy."
            },
            {
              delta: 1,
              text: "Still useful."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Ask to come off",
          results: [
            {
              delta: 1,
              text: "Somehow it lands without chaos. Still a thin line."
            },
            {
              delta: 0,
              text: "No card, no praise. The moment just dies."
            },
            {
              delta: -1,
              text: "The dressing room goes quiet for the wrong reason."
            },
            {
              delta: -2,
              text: "You lose more than the duel — you lose trust."
            },
            {
              delta: -3,
              text: "Staff pull you aside. That reaction is not the culture here."
            }
          ]
        }
      ]
    },
    {
      setup: "An opponent starts chirping after a soft foul. The ref is watching. How do you answer?",
      choices: [
        {
          label: "Walk away and win the next duel",
          results: [
            {
              delta: 3,
              text: "You win the next ball clean. Best reply possible."
            },
            {
              delta: 2,
              text: "Cold focus. Staff like the maturity."
            },
            {
              delta: 1,
              text: "You ignore him and stay in the game."
            },
            {
              delta: 0,
              text: "Nothing happens. Temperature stays normal."
            },
            {
              delta: -1,
              text: "You stay quiet but lose the next challenge."
            },
            {
              delta: -2,
              text: "You overthink it and gift possession."
            }
          ]
        },
        {
          label: "Smile and ask for the ball again",
          results: [
            {
              delta: 2,
              text: "You demand it, receive it, and play simple."
            },
            {
              delta: 1,
              text: "Confidence without chaos. Good look."
            },
            {
              delta: 0,
              text: "Teammates smile. Play continues."
            },
            {
              delta: -1,
              text: "You force a rushed touch and lose it."
            },
            {
              delta: -2,
              text: "The bravado invites a harder tackle. You bounce."
            }
          ]
        },
        {
          label: "Square up and answer back",
          results: [
            {
              delta: 1,
              text: "Somehow it settles without a card. Thin ice."
            },
            {
              delta: 0,
              text: "The ref steps in before it becomes anything."
            },
            {
              delta: -1,
              text: "Booking. Staff hate the loss of control."
            },
            {
              delta: -2,
              text: "You get dragged into nonsense. Drill ruined."
            },
            {
              delta: -3,
              text: "Red heat. Coach ends your session early."
            }
          ]
        }
      ]
    }
  ],
  WING: [
    {
      setup: "1v1 on the touchline. Outside, scissors, or cut inside?",
      choices: [
        {
          label: "Beat him on the outside",
          results: [
            {
              delta: 3,
              text: "You fly by. Cross in."
            },
            {
              delta: 2,
              text: "Clean beat."
            },
            {
              delta: 1,
              text: "Half beat. Useful."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Scissors into the half-space",
          results: [
            {
              delta: 4,
              text: "Scissors. Cutback chance."
            },
            {
              delta: 2,
              text: "Dangerous."
            },
            {
              delta: 1,
              text: "Nearly."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Early cross before the duel",
          results: [
            {
              delta: 4,
              text: "Brave and correct. The drill tilts your way."
            },
            {
              delta: 2,
              text: "Early ball. Chaos."
            },
            {
              delta: 1,
              text: "Useful delivery."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        }
      ]
    },
    {
      setup: "Cutback zone. Drive the byline, shoot, or cut back?",
      choices: [
        {
          label: "Drive the byline and cut back",
          results: [
            {
              delta: 4,
              text: "Perfect cut-back. Goal."
            },
            {
              delta: 3,
              text: "Dangerous delivery."
            },
            {
              delta: 1,
              text: "Deflected. Corner."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Shoot near post low",
          results: [
            {
              delta: 3,
              text: "Near-post finish."
            },
            {
              delta: 2,
              text: "Forces a save."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Recycle to the late eight",
          results: [
            {
              delta: 2,
              text: "Patient chance."
            },
            {
              delta: 1,
              text: "Good recycle."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Track back. Foul, channel, or recover sprint?",
      choices: [
        {
          label: "Channel him inside to cover",
          results: [
            {
              delta: 2,
              text: "Cover tackles."
            },
            {
              delta: 1,
              text: "Good work."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Full recovery sprint",
          results: [
            {
              delta: 3,
              text: "You catch him. Block."
            },
            {
              delta: 2,
              text: "Huge recovery."
            },
            {
              delta: 1,
              text: "Force a corner."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Tactical foul high",
          results: [
            {
              delta: 1,
              text: "Somehow it lands without chaos. Still a thin line."
            },
            {
              delta: 0,
              text: "No card, no praise. The moment just dies."
            },
            {
              delta: -1,
              text: "The dressing room goes quiet for the wrong reason."
            },
            {
              delta: -2,
              text: "You lose more than the duel — you lose trust."
            },
            {
              delta: -3,
              text: "Staff pull you aside. That reaction is not the culture here."
            }
          ]
        }
      ]
    },
    {
      setup: "Far-post arrival. Attack the header or stay for cutback?",
      choices: [
        {
          label: "Attack the header",
          results: [
            {
              delta: 3,
              text: "Far-post finish."
            },
            {
              delta: 2,
              text: "Strong header."
            },
            {
              delta: 1,
              text: "Wide."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Stay for the cutback lane",
          results: [
            {
              delta: 4,
              text: "Brave and correct. The drill tilts your way."
            },
            {
              delta: 2,
              text: "Tap-in lane."
            },
            {
              delta: 1,
              text: "Useful."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Block the full-back",
          results: [
            {
              delta: 2,
              text: "Selfless. Chance for teammate."
            },
            {
              delta: 1,
              text: "Good."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Press the full-back. Jump, curve the press, or fake?",
      choices: [
        {
          label: "Curve the press to the touchline",
          results: [
            {
              delta: 3,
              text: "Trap works. Turnover."
            },
            {
              delta: 2,
              text: "Forced long."
            },
            {
              delta: 1,
              text: "Useful."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Jump straight into the duel",
          results: [
            {
              delta: 4,
              text: "Brave and correct. The drill tilts your way."
            },
            {
              delta: 2,
              text: "Win it."
            },
            {
              delta: 1,
              text: "Foul won."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Fake jump then drop",
          results: [
            {
              delta: 4,
              text: "Brave and correct. The drill tilts your way."
            },
            {
              delta: 2,
              text: "Smart. Interception behind."
            },
            {
              delta: 1,
              text: "Good."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        }
      ]
    },
    {
      setup: "Final third. Early cross or wait for the overlap?",
      choices: [
        {
          label: "Early cross now",
          results: [
            {
              delta: 4,
              text: "Brave and correct. The drill tilts your way."
            },
            {
              delta: 2,
              text: "Early chaos."
            },
            {
              delta: 1,
              text: "Useful."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Wait for the overlap",
          results: [
            {
              delta: 3,
              text: "Overlap cutback. Chance."
            },
            {
              delta: 2,
              text: "Numbers up."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Cut inside onto your stronger foot",
          results: [
            {
              delta: 3,
              text: "Shoot. Goal or big save."
            },
            {
              delta: 2,
              text: "Dangerous."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Weak-foot day in training. Embrace or hide?",
      choices: [
        {
          label: "Take every rep on the weak foot",
          results: [
            {
              delta: 3,
              text: "Coach loves the bravery."
            },
            {
              delta: 2,
              text: "Visible improvement."
            },
            {
              delta: 1,
              text: "Ugly but useful."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Mix both feet",
          results: [
            {
              delta: 2,
              text: "Balanced."
            },
            {
              delta: 1,
              text: "Fine."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Hide on the strong foot",
          results: [
            {
              delta: 1,
              text: "Somehow it lands without chaos. Still a thin line."
            },
            {
              delta: 0,
              text: "No card, no praise. The moment just dies."
            },
            {
              delta: -1,
              text: "The dressing room goes quiet for the wrong reason."
            },
            {
              delta: -2,
              text: "You lose more than the duel — you lose trust."
            },
            {
              delta: -3,
              text: "Staff pull you aside. That reaction is not the culture here."
            }
          ]
        }
      ]
    },
    {
      setup: "Night cup tie. Tired legs. Still ask for the ball?",
      choices: [
        {
          label: "Keep demanding it",
          results: [
            {
              delta: 3,
              text: "Personality. Impact late."
            },
            {
              delta: 2,
              text: "Still dangerous."
            },
            {
              delta: 1,
              text: "Mixed."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Offer short only",
          results: [
            {
              delta: 1,
              text: "Safe."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Save yourself for the last ten",
          results: [
            {
              delta: 2,
              text: "Late spark."
            },
            {
              delta: 1,
              text: "Too quiet too long. Intent still credited."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "You beat your man. Cutback, shot, or recycle?",
      choices: [
        {
          label: "Cutback across the face",
          results: [
            {
              delta: 4,
              text: "Assist on a plate."
            },
            {
              delta: 2,
              text: "Dangerous."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Shot across the keeper",
          results: [
            {
              delta: 3,
              text: "Goal."
            },
            {
              delta: 2,
              text: "Big save."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Recycle to the edge",
          results: [
            {
              delta: 2,
              text: "Second chance."
            },
            {
              delta: 1,
              text: "Patient."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Opponent double-teams you. Spin out or release early?",
      choices: [
        {
          label: "Release early to the free man",
          results: [
            {
              delta: 3,
              text: "Smart. Break."
            },
            {
              delta: 2,
              text: "Good awareness."
            },
            {
              delta: 1,
              text: "Clean."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Spin out of the double",
          results: [
            {
              delta: 4,
              text: "Brave and correct. The drill tilts your way."
            },
            {
              delta: 2,
              text: "Brave escape."
            },
            {
              delta: 1,
              text: "Half out."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Draw the foul",
          results: [
            {
              delta: 4,
              text: "Brave and correct. The drill tilts your way."
            },
            {
              delta: 2,
              text: "Foul won."
            },
            {
              delta: 1,
              text: "Free kick."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        }
      ]
    },
    {
      setup: "Tracking a full-back who is flying forward.",
      choices: [
        {
          label: "Sprint with him the whole way",
          results: [
            {
              delta: 3,
              text: "You stop the cross."
            },
            {
              delta: 2,
              text: "Huge work rate."
            },
            {
              delta: 1,
              text: "Force throw-in."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Pass him to the centre-back and tuck",
          results: [
            {
              delta: 2,
              text: "Organised."
            },
            {
              delta: 1,
              text: "Fine."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Stop tracking halfway",
          results: [
            {
              delta: 1,
              text: "Somehow it lands without chaos. Still a thin line."
            },
            {
              delta: 0,
              text: "No card, no praise. The moment just dies."
            },
            {
              delta: -1,
              text: "The dressing room goes quiet for the wrong reason."
            },
            {
              delta: -2,
              text: "You lose more than the duel — you lose trust."
            },
            {
              delta: -3,
              text: "Staff pull you aside. That reaction is not the culture here."
            }
          ]
        }
      ]
    },
    {
      setup: "Corner routine. Near-post flick or delay?",
      choices: [
        {
          label: "Near-post flick",
          results: [
            {
              delta: 3,
              text: "Flick goal."
            },
            {
              delta: 2,
              text: "Chaos."
            },
            {
              delta: 1,
              text: "Nearly."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Delay for the second phase",
          results: [
            {
              delta: 2,
              text: "Second-phase shot."
            },
            {
              delta: 1,
              text: "Useful."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Pull wide to stretch",
          results: [
            {
              delta: 1,
              text: "Space created."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Media drill after training. Speak about the team or yourself?",
      choices: [
        {
          label: "Credit the collective",
          results: [
            {
              delta: 1,
              text: "Somehow it lands without chaos. Still a thin line."
            },
            {
              delta: 0,
              text: "No card, no praise. The moment just dies."
            },
            {
              delta: -1,
              text: "The dressing room goes quiet for the wrong reason."
            },
            {
              delta: -2,
              text: "You lose more than the duel — you lose trust."
            },
            {
              delta: -3,
              text: "Staff pull you aside. That reaction is not the culture here."
            }
          ]
        },
        {
          label: "Talk about your own numbers",
          results: [
            {
              delta: 1,
              text: "Somehow it lands without chaos. Still a thin line."
            },
            {
              delta: 0,
              text: "No card, no praise. The moment just dies."
            },
            {
              delta: -1,
              text: "The dressing room goes quiet for the wrong reason."
            },
            {
              delta: -2,
              text: "You lose more than the duel — you lose trust."
            },
            {
              delta: -3,
              text: "Staff pull you aside. That reaction is not the culture here."
            }
          ]
        },
        {
          label: "Keep it short and move on",
          results: [
            {
              delta: 1,
              text: "Somehow it lands without chaos. Still a thin line."
            },
            {
              delta: 0,
              text: "No card, no praise. The moment just dies."
            },
            {
              delta: -1,
              text: "The dressing room goes quiet for the wrong reason."
            },
            {
              delta: -2,
              text: "You lose more than the duel — you lose trust."
            },
            {
              delta: -3,
              text: "Staff pull you aside. That reaction is not the culture here."
            }
          ]
        }
      ]
    },
    {
      setup: "Small-sided. Coach wants end product.",
      choices: [
        {
          label: "Take the shot whenever half-on",
          results: [
            {
              delta: 3,
              text: "Two efforts. One goal."
            },
            {
              delta: 2,
              text: "End product clear."
            },
            {
              delta: 1,
              text: "Mixed."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Prioritise assists",
          results: [
            {
              delta: 3,
              text: "Two cutbacks."
            },
            {
              delta: 2,
              text: "Creator mode."
            },
            {
              delta: 1,
              text: "Useful."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Just keep the ball",
          results: [
            {
              delta: 1,
              text: "Somehow it lands without chaos. Still a thin line."
            },
            {
              delta: 0,
              text: "No card, no praise. The moment just dies."
            },
            {
              delta: -1,
              text: "The dressing room goes quiet for the wrong reason."
            },
            {
              delta: -2,
              text: "You lose more than the duel — you lose trust."
            },
            {
              delta: -3,
              text: "Staff pull you aside. That reaction is not the culture here."
            }
          ]
        }
      ]
    },
    {
      setup: "You get twisted by a trick. Next action?",
      choices: [
        {
          label: "Immediate recovery and win it back",
          results: [
            {
              delta: 3,
              text: "Character. Win it back."
            },
            {
              delta: 2,
              text: "Recovery tackle."
            },
            {
              delta: 1,
              text: "Force throw."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Drop into shape",
          results: [
            {
              delta: 1,
              text: "Organised."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Kick out in frustration",
          results: [
            {
              delta: 1,
              text: "Somehow it lands without chaos. Still a thin line."
            },
            {
              delta: 0,
              text: "No card, no praise. The moment just dies."
            },
            {
              delta: -1,
              text: "The dressing room goes quiet for the wrong reason."
            },
            {
              delta: -2,
              text: "You lose more than the duel — you lose trust."
            },
            {
              delta: -3,
              text: "Staff pull you aside. That reaction is not the culture here."
            }
          ]
        }
      ]
    },
    {
      setup: "Rain. Heavy ball. Early cross or wait for a better platform?",
      choices: [
        {
          label: "Wait for a cleaner platform",
          results: [
            {
              delta: 2,
              text: "Better delivery."
            },
            {
              delta: 1,
              text: "Smart."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Hit it early anyway",
          results: [
            {
              delta: 2,
              text: "Early chaos works."
            },
            {
              delta: 1,
              text: "Skied. Intent still credited."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Cut inside onto dry grass",
          results: [
            {
              delta: 3,
              text: "Better surface. Shot."
            },
            {
              delta: 1,
              text: "Useful."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        }
      ]
    }
  ],
  ST: [
    {
      setup: "Through on goal. Early shot, round the keeper, or cut back?",
      choices: [
        {
          label: "Early shot across the keeper",
          results: [
            {
              delta: 4,
              text: "Finish. Clinical."
            },
            {
              delta: 3,
              text: "Goal."
            },
            {
              delta: 2,
              text: "Big save forced."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Round the keeper",
          results: [
            {
              delta: 3,
              text: "Cool finish."
            },
            {
              delta: 2,
              text: "Almost. Cover clears."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Cut back to the late runner",
          results: [
            {
              delta: 3,
              text: "Assist."
            },
            {
              delta: 2,
              text: "Dangerous."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Back to goal. Hold up, flick, or spin?",
      choices: [
        {
          label: "Hold up and bring others in",
          results: [
            {
              delta: 3,
              text: "Perfect hold-up. Attack."
            },
            {
              delta: 2,
              text: "Strong link."
            },
            {
              delta: 1,
              text: "Foul won."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Flick around the corner",
          results: [
            {
              delta: 3,
              text: "Flick creates a chance."
            },
            {
              delta: 2,
              text: "Clever."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Spin the centre-back",
          results: [
            {
              delta: 4,
              text: "Spin and finish."
            },
            {
              delta: 2,
              text: "Dangerous turn."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        }
      ]
    },
    {
      setup: "Cross incoming. Near post, far post, or penalty spot?",
      choices: [
        {
          label: "Attack near post",
          results: [
            {
              delta: 3,
              text: "Near-post finish."
            },
            {
              delta: 2,
              text: "Force a save."
            },
            {
              delta: 1,
              text: "Contact."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Arrive at the far post",
          results: [
            {
              delta: 3,
              text: "Far-post header."
            },
            {
              delta: 2,
              text: "Strong."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Occupy the penalty spot",
          results: [
            {
              delta: 4,
              text: "Brave and correct. The drill tilts your way."
            },
            {
              delta: 2,
              text: "Knockdown. Chance."
            },
            {
              delta: 1,
              text: "Useful."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        }
      ]
    },
    {
      setup: "1v1 with the last defender. Soft touch or physical?",
      choices: [
        {
          label: "Soft touch into space",
          results: [
            {
              delta: 3,
              text: "Glide through. Chance."
            },
            {
              delta: 2,
              text: "Clean."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Physical contact then roll",
          results: [
            {
              delta: 4,
              text: "Brave and correct. The drill tilts your way."
            },
            {
              delta: 2,
              text: "Win the duel."
            },
            {
              delta: 1,
              text: "Foul won."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Check and lay off",
          results: [
            {
              delta: 4,
              text: "Brave and correct. The drill tilts your way."
            },
            {
              delta: 2,
              text: "Smart link."
            },
            {
              delta: 1,
              text: "Team move."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        }
      ]
    },
    {
      setup: "Penalty. Stutter, hit hard, or place?",
      choices: [
        {
          label: "Place into the side netting",
          results: [
            {
              delta: 3,
              text: "Side netting bulges. Pure placement."
            },
            {
              delta: 2,
              text: "Keeper gets a fingertip. Still in."
            },
            {
              delta: 1,
              text: "Skims the post and goes. Ugly but counted."
            },
            {
              delta: 0,
              text: "Hits the side netting from the wrong side."
            },
            {
              delta: -1,
              text: "Dragged wide. Technique lecture incoming."
            },
            {
              delta: -2,
              text: "Telegraphed. Keeper waits and holds."
            },
            {
              delta: -3,
              text: "Completely miscued. Chance wasted and noted."
            }
          ]
        },
        {
          label: "Hit it hard down the middle",
          results: [
            {
              delta: 3,
              text: "Power through the gloves. Net moves."
            },
            {
              delta: 2,
              text: "Keeper parries but you follow in."
            },
            {
              delta: 1,
              text: "Straight and true. No dive needed for the goal."
            },
            {
              delta: 0,
              text: "Straight at him. Strong hands."
            },
            {
              delta: -1,
              text: "He stays put and holds. Predictable."
            },
            {
              delta: -2,
              text: "Central and slow. Soft save, hard feedback."
            },
            {
              delta: -3,
              text: "Blazed over. Power without brain."
            }
          ]
        },
        {
          label: "Stutter and wait",
          results: [
            {
              delta: 3,
              text: "Keeper commits early. You roll it the other way."
            },
            {
              delta: 2,
              text: "The pause sells it. Cool finish."
            },
            {
              delta: 1,
              text: "Keeper stays big, but you squeeze it under."
            },
            {
              delta: 0,
              text: "Neither of you moves first. Soft save."
            },
            {
              delta: -1,
              text: "You wait too long. Blocked on the line."
            },
            {
              delta: -2,
              text: "The stutter tips your hand. Easy gather."
            },
            {
              delta: -3,
              text: "You freeze. Keeper smiles and catches it standing up."
            }
          ]
        }
      ]
    },
    {
      setup: "Offside trap. Stay disciplined or gamble the run?",
      choices: [
        {
          label: "Hold the line then go",
          results: [
            {
              delta: 3,
              text: "Timed run. Chance."
            },
            {
              delta: 2,
              text: "Good timing."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Gamble early",
          results: [
            {
              delta: 4,
              text: "Brave and correct. The drill tilts your way."
            },
            {
              delta: 2,
              text: "Beat the trap. Chance."
            },
            {
              delta: 1,
              text: "Flag. Intent still credited."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Drop short and link",
          results: [
            {
              delta: 2,
              text: "Useful link."
            },
            {
              delta: 1,
              text: "Involved."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Service is poor. Still make the run?",
      choices: [
        {
          label: "Keep making the runs",
          results: [
            {
              delta: 3,
              text: "One finally arrives. Finish."
            },
            {
              delta: 2,
              text: "Work rate noted."
            },
            {
              delta: 1,
              text: "Tire them."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Drop into pockets instead",
          results: [
            {
              delta: 2,
              text: "Find touches."
            },
            {
              delta: 1,
              text: "Involved."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Complain about service",
          results: [
            {
              delta: 1,
              text: "Somehow it lands without chaos. Still a thin line."
            },
            {
              delta: 0,
              text: "No card, no praise. The moment just dies."
            },
            {
              delta: -1,
              text: "The dressing room goes quiet for the wrong reason."
            },
            {
              delta: -2,
              text: "You lose more than the duel — you lose trust."
            },
            {
              delta: -3,
              text: "Staff pull you aside. That reaction is not the culture here."
            }
          ]
        }
      ]
    },
    {
      setup: "Poacher instinct vs build play. What do you prioritise today?",
      choices: [
        {
          label: "Live on the last shoulder",
          results: [
            {
              delta: 3,
              text: "Two big chances."
            },
            {
              delta: 2,
              text: "Threat constant."
            },
            {
              delta: 1,
              text: "One chance."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Drop and combine more",
          results: [
            {
              delta: 2,
              text: "Link improves."
            },
            {
              delta: 1,
              text: "Involved."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Mix both every five minutes",
          results: [
            {
              delta: 3,
              text: "Complete centre-forward look."
            },
            {
              delta: 2,
              text: "Balanced."
            },
            {
              delta: 1,
              text: "Fine."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "You miss a big chance. Next five minutes?",
      choices: [
        {
          label: "Demand the next ball",
          results: [
            {
              delta: 3,
              text: "You score the next one."
            },
            {
              delta: 2,
              text: "Response clear."
            },
            {
              delta: 1,
              text: "Still involved."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Work the channels harder",
          results: [
            {
              delta: 2,
              text: "Work rate resets mood."
            },
            {
              delta: 1,
              text: "Useful."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Drop deep and disappear",
          results: [
            {
              delta: 1,
              text: "Somehow it lands without chaos. Still a thin line."
            },
            {
              delta: 0,
              text: "No card, no praise. The moment just dies."
            },
            {
              delta: -1,
              text: "The dressing room goes quiet for the wrong reason."
            },
            {
              delta: -2,
              text: "You lose more than the duel — you lose trust."
            },
            {
              delta: -3,
              text: "Staff pull you aside. That reaction is not the culture here."
            }
          ]
        }
      ]
    },
    {
      setup: "Aerial service. Attack everything or pick one?",
      choices: [
        {
          label: "Attack every ball aggressively",
          results: [
            {
              delta: 3,
              text: "Win two. One goal."
            },
            {
              delta: 2,
              text: "Dominant."
            },
            {
              delta: 1,
              text: "Mixed."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Pick the right one",
          results: [
            {
              delta: 2,
              text: "Smart. Strong contact."
            },
            {
              delta: 1,
              text: "Clean."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Block and create space for a teammate",
          results: [
            {
              delta: 2,
              text: "Selfless. Teammate chance."
            },
            {
              delta: 1,
              text: "Good."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Counter. Make the central run or widen?",
      choices: [
        {
          label: "Central run at the heart",
          results: [
            {
              delta: 4,
              text: "Through ball finds you. Finish."
            },
            {
              delta: 2,
              text: "Dangerous."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Widen to stretch",
          results: [
            {
              delta: 2,
              text: "Space created."
            },
            {
              delta: 1,
              text: "Useful."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Check short then spin",
          results: [
            {
              delta: 3,
              text: "Spin creates the lane."
            },
            {
              delta: 2,
              text: "Clever."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Training finishing under fatigue.",
      choices: [
        {
          label: "Stay clinical on every rep",
          results: [
            {
              delta: 3,
              text: "Conversion rate high."
            },
            {
              delta: 2,
              text: "Sharp."
            },
            {
              delta: 1,
              text: "Mixed."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Focus on technique even when ugly",
          results: [
            {
              delta: 2,
              text: "Process strong."
            },
            {
              delta: 1,
              text: "Good habits."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Rush to get them done",
          results: [
            {
              delta: 1,
              text: "Somehow it lands without chaos. Still a thin line."
            },
            {
              delta: 0,
              text: "No card, no praise. The moment just dies."
            },
            {
              delta: -1,
              text: "The dressing room goes quiet for the wrong reason."
            },
            {
              delta: -2,
              text: "You lose more than the duel — you lose trust."
            },
            {
              delta: -3,
              text: "Staff pull you aside. That reaction is not the culture here."
            }
          ]
        }
      ]
    },
    {
      setup: "You are marked by two. Move to create or stay as a reference?",
      choices: [
        {
          label: "Drag both and open the lane",
          results: [
            {
              delta: 3,
              text: "Selfless. Chance for teammate."
            },
            {
              delta: 2,
              text: "Space created."
            },
            {
              delta: 1,
              text: "Useful."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Stay as the reference point",
          results: [
            {
              delta: 2,
              text: "Hold-up works."
            },
            {
              delta: 1,
              text: "Link."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Drop between midfield lines",
          results: [
            {
              delta: 2,
              text: "Receive and turn."
            },
            {
              delta: 1,
              text: "Involved."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        }
      ]
    },
    {
      setup: "Last minute. Need a goal. Chaos or structure?",
      choices: [
        {
          label: "Live in the six-yard box",
          results: [
            {
              delta: 3,
              text: "Scramble goal."
            },
            {
              delta: 2,
              text: "Chaos. Chance."
            },
            {
              delta: 1,
              text: "Nearly."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Offer at the edge for a shot",
          results: [
            {
              delta: 4,
              text: "Brave and correct. The drill tilts your way."
            },
            {
              delta: 2,
              text: "Edge shot. Dangerous."
            },
            {
              delta: 1,
              text: "Useful."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Chase every lost cause",
          results: [
            {
              delta: 4,
              text: "Brave and correct. The drill tilts your way."
            },
            {
              delta: 2,
              text: "Force a corner."
            },
            {
              delta: 1,
              text: "Energy clear."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        }
      ]
    },
    {
      setup: "Youth final. You score early. Hunt a second or manage the game?",
      choices: [
        {
          label: "Hunt a second immediately",
          results: [
            {
              delta: 3,
              text: "Brace. Statement."
            },
            {
              delta: 2,
              text: "Constant threat."
            },
            {
              delta: 1,
              text: "One more chance."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Manage the game and link",
          results: [
            {
              delta: 2,
              text: "Mature."
            },
            {
              delta: 1,
              text: "Team control."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Showboat",
          results: [
            {
              delta: 1,
              text: "Somehow it lands without chaos. Still a thin line."
            },
            {
              delta: 0,
              text: "No card, no praise. The moment just dies."
            },
            {
              delta: -1,
              text: "The dressing room goes quiet for the wrong reason."
            },
            {
              delta: -2,
              text: "You lose more than the duel — you lose trust."
            },
            {
              delta: -3,
              text: "Staff pull you aside. That reaction is not the culture here."
            }
          ]
        }
      ]
    },
    {
      setup: "Service from the left is excellent today. Adjust your runs?",
      choices: [
        {
          label: "Bias runs to that side",
          results: [
            {
              delta: 3,
              text: "Two big chances."
            },
            {
              delta: 2,
              text: "Smart adjustment."
            },
            {
              delta: 1,
              text: "Useful."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            },
            {
              delta: -3,
              text: "It backfires completely. The moment turns against you."
            }
          ]
        },
        {
          label: "Stay central as the target",
          results: [
            {
              delta: 2,
              text: "Reference works."
            },
            {
              delta: 1,
              text: "Fine."
            },
            {
              delta: 0,
              text: "Neither glory nor damage. The play resets."
            },
            {
              delta: -1,
              text: "It does not come off. A harsh reminder that timing matters."
            },
            {
              delta: -2,
              text: "The gamble fails loudly. Confidence takes a hit."
            }
          ]
        },
        {
          label: "Tell the left side to switch more",
          results: [
            {
              delta: 1,
              text: "Somehow it lands without chaos. Still a thin line."
            },
            {
              delta: 0,
              text: "No card, no praise. The moment just dies."
            },
            {
              delta: -1,
              text: "The dressing room goes quiet for the wrong reason."
            },
            {
              delta: -2,
              text: "You lose more than the duel — you lose trust."
            },
            {
              delta: -3,
              text: "Staff pull you aside. That reaction is not the culture here."
            }
          ]
        }
      ]
    }
  ]
};

/**
 * Shared academy-life moments mixed into every position's opening.
 * Choices are intentionally asymmetric: asking for feedback ≠ ignoring advice.
 */
export const LIFE_SCENARIOS = [
  {
    id: "life-coach-feedback",
    setup:
      "After a messy midweek session the coach stays behind. You can ask for blunt feedback, wait for them to come to you, or brush it off and head to the bus.",
    choices: [
      {
        id: "life-coach-feedback:ask",
        label: "Ask for specific feedback",
        disposition: "thoughtful",
        results: [
          {
            delta: 2,
            weight: 3.2,
            effect: "ability",
            text: "They walk you through two habits you can fix this week. The detail sticks.",
          },
          {
            delta: 1,
            weight: 2.8,
            effect: "ability",
            text: "A short checklist lands. Nothing glamorous — useful.",
          },
          {
            delta: 0,
            weight: 1.4,
            effect: "none",
            text: "They are tired and keep it brief. You still showed you care.",
          },
          {
            delta: -1,
            weight: 0.6,
            effect: "confidence",
            text: "The honesty stings more than you expected. Confidence dips overnight.",
          },
        ],
      },
      {
        id: "life-coach-feedback:wait",
        label: "Wait for them to come to you",
        disposition: "balanced",
        results: [
          {
            delta: 1,
            weight: 2.0,
            effect: "ability",
            text: "They catch you at the door with one clean pointer.",
          },
          {
            delta: 0,
            weight: 2.5,
            effect: "none",
            text: "The moment passes. No damage, no breakthrough.",
          },
          {
            delta: -1,
            weight: 1.5,
            effect: "confidence",
            text: "Silence reads as indifference. You leave unsure where you stand.",
          },
        ],
      },
      {
        id: "life-coach-feedback:brush",
        label: "Brush it off and leave",
        disposition: "reckless",
        results: [
          {
            delta: 0,
            weight: 1.0,
            effect: "none",
            text: "You avoid an awkward chat. Nothing changes on the grass.",
          },
          {
            delta: -1,
            weight: 2.2,
            effect: "confidence",
            text: "Staff notice you ducking the conversation.",
          },
          {
            delta: -2,
            weight: 2.0,
            effect: "ability",
            disruption: true,
            text: "The same mistake repeats on Saturday. Ignoring advice costs you.",
          },
          {
            delta: -3,
            weight: 1.0,
            effect: "ability",
            disruption: true,
            text: "They stop offering detail. Training quality slips for a stretch.",
          },
        ],
      },
    ],
  },
  {
    id: "life-extra-training",
    setup:
      "Double session day. Your legs are heavy. Extra finishing after hours could help — or dig a hole before the weekend.",
    choices: [
      {
        id: "life-extra-training:recover",
        label: "Recover properly and prep for the weekend",
        disposition: "thoughtful",
        results: [
          {
            delta: 2,
            weight: 2.4,
            effect: "ability",
            text: "Fresh legs. You train sharper tomorrow and the coach clocks it.",
          },
          {
            delta: 1,
            weight: 3.0,
            effect: "ability",
            text: "Sleep and food do their quiet work. You feel available again.",
          },
          {
            delta: 0,
            weight: 1.6,
            effect: "none",
            text: "No heroics. You simply arrive ready.",
          },
          {
            delta: -1,
            weight: 0.5,
            effect: "confidence",
            text: "A teammate stays late and gets praised. You wonder if you underdid it.",
          },
        ],
      },
      {
        id: "life-extra-training:light",
        label: "Do a short, focused extras block",
        disposition: "balanced",
        results: [
          {
            delta: 2,
            weight: 2.0,
            effect: "ability",
            text: "Twenty clean reps. Quality over volume.",
          },
          {
            delta: 1,
            weight: 2.6,
            effect: "ability",
            text: "A small technical win without frying your legs.",
          },
          {
            delta: 0,
            weight: 1.8,
            effect: "none",
            text: "Neutral session. You leave neither better nor broken.",
          },
          {
            delta: -1,
            weight: 1.0,
            effect: "confidence",
            text: "Concentration fades early. You cut it short.",
          },
        ],
      },
      {
        id: "life-extra-training:smash",
        label: "Stay late and smash volume while exhausted",
        disposition: "reckless",
        results: [
          {
            delta: 2,
            weight: 0.8,
            effect: "ability",
            text: "Somehow the extra work clicks and you look sharp Friday.",
          },
          {
            delta: 0,
            weight: 1.2,
            effect: "none",
            text: "You grind without learning much.",
          },
          {
            delta: -2,
            weight: 2.4,
            effect: "ability",
            disruption: true,
            text: "Heavy legs on matchday. The weekend session is a write-off.",
          },
          {
            delta: -3,
            weight: 1.8,
            effect: "ability",
            disruption: true,
            text: "A soft-tissue scare ends the week early. Overtraining bites.",
          },
        ],
      },
    ],
  },
  {
    id: "life-homesickness",
    setup:
      "Sunday night, phone home. Homesickness hits hard before a big evaluation week.",
    choices: [
      {
        id: "life-homesickness:group",
        label: "Stay with the group and talk it through",
        disposition: "thoughtful",
        results: [
          {
            delta: 2,
            weight: 2.2,
            effect: "ability",
            text: "Teammates keep you present. Monday's session is clean.",
          },
          {
            delta: 1,
            weight: 3.0,
            effect: "confidence",
            text: "You feel less alone. Confidence steadies.",
          },
          {
            delta: 0,
            weight: 1.6,
            effect: "none",
            text: "The ache remains, but you sleep enough to train.",
          },
        ],
      },
      {
        id: "life-homesickness:call",
        label: "Call home, then set a short routine",
        disposition: "balanced",
        results: [
          {
            delta: 1,
            weight: 2.8,
            effect: "ability",
            text: "A plan for the week settles your head.",
          },
          {
            delta: 0,
            weight: 2.0,
            effect: "none",
            text: "Bittersweet call. You cope.",
          },
          {
            delta: -1,
            weight: 1.2,
            effect: "confidence",
            text: "The call leaves you distracted in the first drill.",
          },
        ],
      },
      {
        id: "life-homesickness:isolate",
        label: "Isolate and skip the evening recovery",
        disposition: "reckless",
        results: [
          {
            delta: 0,
            weight: 1.0,
            effect: "none",
            text: "You get through the night. Barely.",
          },
          {
            delta: -1,
            weight: 2.0,
            effect: "confidence",
            text: "Mood tanks. You train closed-off.",
          },
          {
            delta: -2,
            weight: 2.2,
            effect: "ability",
            disruption: true,
            text: "Missed recovery shows up as sloppy timing all week.",
          },
        ],
      },
    ],
  },
  {
    id: "life-school-balance",
    setup:
      "Exams collide with a youth cup midweek. School wants hours; the academy wants freshness.",
    choices: [
      {
        id: "life-school-balance:plan",
        label: "Plan a split schedule with staff",
        disposition: "thoughtful",
        results: [
          {
            delta: 2,
            weight: 2.5,
            effect: "ability",
            text: "Staff protect your load. You arrive organized for both.",
          },
          {
            delta: 1,
            weight: 2.8,
            effect: "ability",
            text: "A sensible compromise. Energy holds.",
          },
          {
            delta: 0,
            weight: 1.4,
            effect: "none",
            text: "Neither side is thrilled, but you cope.",
          },
        ],
      },
      {
        id: "life-school-balance:cram",
        label: "Cram school late and hope training survives",
        disposition: "ambitious",
        results: [
          {
            delta: 1,
            weight: 1.4,
            effect: "ability",
            text: "You scrape both — tired, but present.",
          },
          {
            delta: 0,
            weight: 1.8,
            effect: "none",
            text: "Average week. No praise, no crisis.",
          },
          {
            delta: -1,
            weight: 2.0,
            effect: "confidence",
            text: "Brain fog in possession. You feel behind.",
          },
          {
            delta: -2,
            weight: 1.4,
            effect: "ability",
            disruption: true,
            text: "A late night shows in your decision speed.",
          },
        ],
      },
      {
        id: "life-school-balance:skip",
        label: "Skip class prep and live at the facility",
        disposition: "reckless",
        results: [
          {
            delta: 1,
            weight: 1.0,
            effect: "ability",
            text: "Extra pitch time helps — until the academy hears about school.",
          },
          {
            delta: -1,
            weight: 2.0,
            effect: "confidence",
            text: "Welfare staff pull you in. Stress rises.",
          },
          {
            delta: -2,
            weight: 2.2,
            effect: "ability",
            disruption: true,
            text: "Restricted training while you catch up on work.",
          },
        ],
      },
    ],
  },
  {
    id: "life-selection-disappointment",
    setup:
      "Team sheet is up. You are on the bench for a fixture you expected to start.",
    choices: [
      {
        id: "life-selection-disappointment:respond",
        label: "Respond in training and ask what to improve",
        disposition: "thoughtful",
        results: [
          {
            delta: 2,
            weight: 2.6,
            effect: "ability",
            text: "Your reaction earns minutes later in the week.",
          },
          {
            delta: 1,
            weight: 3.0,
            effect: "ability",
            text: "Staff mark the professionalism. You stay in the plan.",
          },
          {
            delta: 0,
            weight: 1.2,
            effect: "none",
            text: "Quiet reset. The shirt will come again.",
          },
        ],
      },
      {
        id: "life-selection-disappointment:support",
        label: "Support the starter and stay ready",
        disposition: "balanced",
        results: [
          {
            delta: 1,
            weight: 2.4,
            effect: "ability",
            text: "You change the game from the bench with a clean cameo.",
          },
          {
            delta: 0,
            weight: 2.2,
            effect: "none",
            text: "No cameo. No drama. You keep trust.",
          },
          {
            delta: -1,
            weight: 1.0,
            effect: "confidence",
            text: "Frustration simmers, but you hide it well enough.",
          },
        ],
      },
      {
        id: "life-selection-disappointment:sulk",
        label: "Show the frustration in the next drill",
        disposition: "reckless",
        results: [
          {
            delta: 0,
            weight: 1.0,
            effect: "none",
            text: "You cool off before it becomes a story.",
          },
          {
            delta: -1,
            weight: 2.0,
            effect: "confidence",
            text: "Body language drops. Teammates give you space.",
          },
          {
            delta: -2,
            weight: 2.2,
            effect: "ability",
            text: "A sloppy challenge earns a private word — and fewer reps.",
          },
          {
            delta: -3,
            weight: 1.2,
            effect: "ability",
            disruption: true,
            text: "Staff sit you for the next evaluation. Attitude tax.",
          },
        ],
      },
    ],
  },
  {
    id: "life-learn-from-mistake",
    setup:
      "You gave the ball away cheaply in a practice match. Video review is optional tonight.",
    choices: [
      {
        id: "life-learn-from-mistake:review",
        label: "Stay for video and rebuild the habit",
        disposition: "thoughtful",
        results: [
          {
            delta: 2,
            weight: 2.8,
            effect: "ability",
            text: "You spot the trigger. The next session looks different.",
          },
          {
            delta: 1,
            weight: 2.6,
            effect: "ability",
            text: "One clip, one fix. Quiet progress.",
          },
          {
            delta: 0,
            weight: 1.2,
            effect: "none",
            text: "Nothing dramatic — you just refuse to repeat it blindly.",
          },
        ],
      },
      {
        id: "life-learn-from-mistake:shake",
        label: "Shake it off and move on",
        disposition: "balanced",
        results: [
          {
            delta: 1,
            weight: 1.6,
            effect: "confidence",
            text: "Short memory helps your next action.",
          },
          {
            delta: 0,
            weight: 2.4,
            effect: "none",
            text: "The error fades without a lasting scar.",
          },
          {
            delta: -1,
            weight: 1.6,
            effect: "confidence",
            text: "Without review, doubt lingers longer than the mistake.",
          },
        ],
      },
      {
        id: "life-learn-from-mistake:blame",
        label: "Blame the surface and avoid the clip",
        disposition: "reckless",
        results: [
          {
            delta: 0,
            weight: 1.2,
            effect: "none",
            text: "You dodge accountability for a night.",
          },
          {
            delta: -1,
            weight: 2.2,
            effect: "confidence",
            text: "Teammates heard the excuse. Trust thins.",
          },
          {
            delta: -2,
            weight: 2.0,
            effect: "ability",
            text: "Same giveaway returns midweek. The pattern is yours.",
          },
        ],
      },
    ],
  },
  {
    id: "life-help-teammate",
    setup:
      "A younger academy player is drowning in a drill you already mastered. Helping costs your own reps.",
    choices: [
      {
        id: "life-help-teammate:help",
        label: "Help them through the pattern",
        disposition: "thoughtful",
        results: [
          {
            delta: 2,
            weight: 2.0,
            effect: "ability",
            text: "Teaching sharpens your own cues. Coach notices leadership.",
          },
          {
            delta: 1,
            weight: 3.0,
            effect: "ability",
            text: "You lose a few reps, gain dressing-room capital.",
          },
          {
            delta: 0,
            weight: 1.4,
            effect: "none",
            text: "Kindness without fireworks. The room is steadier.",
          },
        ],
      },
      {
        id: "life-help-teammate:focus",
        label: "Focus on your own reps first",
        disposition: "balanced",
        results: [
          {
            delta: 1,
            weight: 2.4,
            effect: "ability",
            text: "Selfish in the useful way. Your quality rises.",
          },
          {
            delta: 0,
            weight: 2.0,
            effect: "none",
            text: "Neutral. Everyone survives the drill.",
          },
          {
            delta: -1,
            weight: 1.0,
            effect: "confidence",
            text: "A staff member wanted more generosity from seniors.",
          },
        ],
      },
      {
        id: "life-help-teammate:mock",
        label: "Joke about their mistake to the group",
        disposition: "reckless",
        results: [
          {
            delta: 0,
            weight: 0.8,
            effect: "none",
            text: "The laugh dies quickly.",
          },
          {
            delta: -1,
            weight: 2.2,
            effect: "confidence",
            text: "The room cools. You look smaller for it.",
          },
          {
            delta: -2,
            weight: 2.0,
            effect: "ability",
            text: "Standards talk follows. Your next mistake gets less patience.",
          },
        ],
      },
    ],
  },
];
