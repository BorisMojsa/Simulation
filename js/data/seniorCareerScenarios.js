/**
 * Senior career optional decision scenes (football, media, relationships, lifestyle).
 * Narrative deltas map through the senior scenario model — not raw OVR.
 */
import {
  SENIOR_CAREER_SCENARIOS,
  SENIOR_OUTCOME_WEIGHT_BY_DISPOSITION,
} from "../config/seniorCareerScenarioConfig.js";

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
    /\b(blame|insult|dismiss|ignore|hide|mock|double down|lose your temper|without (telling|checking|discussing)|turn it into a speech|shut yourself|exhaust|all night|promise.*fail)\b/.test(
      t
    )
  ) {
    return "reckless";
  }
  if (
    /\b(private|measured|honest|arrange|approved|follow|recovery|clarif|media officer|ask (staff|an experienced|for specific)|remote|wave|reschedule|programme|patient|calm|share responsibility)\b/.test(
      t
    )
  ) {
    return "thoughtful";
  }
  if (/\b(ready for bigger|encourage the rumour|motivation|accept and keep|targeted session|dominate)\b/.test(t)) {
    return "ambitious";
  }
  return "balanced";
}

function defaultWeightFor(delta, disposition) {
  const table =
    SENIOR_OUTCOME_WEIGHT_BY_DISPOSITION[disposition] ||
    SENIOR_OUTCOME_WEIGHT_BY_DISPOSITION.balanced;
  const w = table[String(delta)];
  if (Number.isFinite(w) && w > 0) return w;
  return SENIOR_CAREER_SCENARIOS.defaultUnweightedWeight;
}

/**
 * Attach stable IDs, dispositions, and positive weights. Idempotent.
 */
export function normalizeSeniorScenario(scenario, index = 0) {
  if (!scenario || typeof scenario !== "object") {
    throw new Error("normalizeSeniorScenario: scenario required");
  }
  const id = scenario.id || `senior-${index}-${slugPart(scenario.setup)}`;
  const choices = (scenario.choices || []).map((choice, ci) => {
    const disposition = choice.disposition || inferSeniorDisposition(choice.label);
    const choiceId = choice.id || `${id}:c${ci}-${slugPart(choice.label, `c${ci}`)}`;
    const results = choice.results || [];
    if (!results.length) {
      throw new Error(`normalizeSeniorScenario: empty results for ${choiceId}`);
    }
    const normalizedResults = results.map((r, ri) => {
      const delta = Number(r.delta);
      if (!Number.isFinite(delta)) {
        throw new Error(`normalizeSeniorScenario: invalid delta on ${choiceId}#${ri}`);
      }
      let weight = r.weight;
      if (weight == null) weight = defaultWeightFor(delta, disposition);
      weight = Number(weight);
      if (!Number.isFinite(weight) || weight <= 0) {
        throw new Error(`normalizeSeniorScenario: invalid weight on ${choiceId}#${ri}`);
      }
      return {
        ...r,
        id: r.id || `${choiceId}:o${ri}-d${delta}`,
        delta,
        weight,
        effects: Array.isArray(r.effects) ? r.effects : r.effect ? [r.effect] : inferEffects(delta, r.text),
      };
    });
    return { ...choice, id: choiceId, disposition, results: normalizedResults };
  });
  return {
    ...scenario,
    id,
    title: scenario.title || id,
    eligibility: scenario.eligibility || ["any"],
    choices,
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

export function pickWeightedSeniorResult(choice, rng = null) {
  const raw = choice?.results;
  if (!raw?.length) {
    return { id: "empty", delta: 0, weight: 1, text: "The moment passes.", effects: ["none"] };
  }
  const disposition = choice.disposition || inferSeniorDisposition(choice.label);
  const results = raw.map((r, ri) => {
    let weight = r.weight;
    if (weight == null) weight = defaultWeightFor(Number(r.delta) || 0, disposition);
    weight = Number(weight);
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new Error(`pickWeightedSeniorResult: invalid weight at ${choice.id || choice.label}#${ri}`);
    }
    return {
      ...r,
      weight,
      delta: Number(r.delta) || 0,
      effects: Array.isArray(r.effects) ? r.effects : r.effect ? [r.effect] : ["morale"],
    };
  });
  const total = results.reduce((s, r) => s + r.weight, 0);
  let roll = (rng?.random?.() ?? Math.random()) * total;
  for (const r of results) {
    roll -= r.weight;
    if (roll <= 0) return r;
  }
  return results[results.length - 1];
}

/** Compact outcome helper for bank authoring. */
function R(delta, text, effects, extra = {}) {
  return { delta, text, effects, ...extra };
}

const SENIOR_SCENARIO_DEFS = [
  {
    id: "press-after-defeat",
    title: "After the loss",
    eligibility: ["afterLoss"],
    setup:
      "A difficult defeat still hangs in the tunnel. A reporter asks who let the team down tonight.",
    choices: [
      {
        label: "Own your performance",
        results: [
          R(2, "You take responsibility. Teammates notice the composure.", ["morale", "coachTrust"]),
          R(1, "Honest without drama. The dressing room stays intact.", ["morale"]),
          R(0, "Your answer is fine but the headlines stay on the scoreline.", ["none"]),
          R(-1, "You sound tense. A few doubts linger overnight.", ["morale"]),
        ],
      },
      {
        label: "Defend the group and discuss the next match",
        results: [
          R(2, "You protect the group and reset the week. Coach trust ticks up.", ["coachTrust", "morale"]),
          R(1, "Measured support for teammates. Focus returns to the next fixture.", ["morale", "support"]),
          R(0, "Safe answers. Nothing changes the mood much.", ["none"]),
          R(-1, "It reads as avoidance to some supporters.", ["reputation"]),
        ],
      },
      {
        label: "Blame teammates publicly",
        results: [
          R(-3, "The clip spreads. Trust in the squad takes a hit.", ["coachTrust", "morale", "support"]),
          R(-2, "Staff pull you aside. Public blame rarely ages well.", ["coachTrust", "reputation"]),
          R(-1, "A few fans agree, but the dressing room cools.", ["support", "morale"]),
          R(1, "Shockingly, the honesty lands — still a risky habit.", ["reputation"]),
        ],
      },
    ],
  },
  {
    id: "press-breakthrough",
    title: "Breakthrough night",
    eligibility: ["standoutPerformance"],
    setup:
      "Your first standout senior performance draws a crowd of mics. Everyone wants a quote.",
    choices: [
      {
        label: "Credit the coaches and teammates",
        results: [
          R(2, "Humble and sharp. Confidence rises without extra pressure.", ["morale", "coachTrust"]),
          R(1, "The group feels seen. You stay grounded.", ["support", "morale"]),
          R(0, "Polite answers. The moment passes cleanly.", ["none"]),
        ],
      },
      {
        label: "Say you're ready for bigger responsibility",
        results: [
          R(3, "Ambition lands well. Expectation rises with your confidence.", ["morale", "reputation"]),
          R(1, "Staff like the hunger, with a quiet note to stay patient.", ["coachTrust", "morale"]),
          R(-1, "The quote adds pressure before you're ready for every week.", ["morale"]),
          R(-2, "It sounds like a demand. The coach bristled.", ["coachTrust"]),
        ],
      },
      {
        label: "Promise you'll dominate every week",
        results: [
          R(2, "The bold line travels — for now the belief is real.", ["morale", "reputation"]),
          R(0, "Big talk, short shelf life. Focus returns to training.", ["none"]),
          R(-2, "The next quiet game looks louder against that promise.", ["morale", "reputation"]),
          R(-3, "You set a trap for yourself. Composure dips under the glare.", ["morale"]),
        ],
      },
    ],
  },
  {
    id: "transfer-rumour",
    title: "Transfer rumour week",
    eligibility: ["any"],
    setup:
      "A headline links you to a larger club while your team faces an important week. Nothing is signed.",
    choices: [
      {
        label: "Speak privately with your agent",
        results: [
          R(2, "Quiet clarity. You stay focused without feeding the noise.", ["morale", "reputation"]),
          R(1, "Agent handles the chatter. Training stays sharp.", ["morale"]),
          R(0, "No new information. The week continues as planned.", ["none"]),
        ],
      },
      {
        label: "Reaffirm focus for now",
        results: [
          R(2, "Coach appreciates the public commitment.", ["coachTrust", "morale"]),
          R(1, "Supporters hear loyalty. Distraction fades.", ["reputation", "morale"]),
          R(0, "Standard line. Useful, not dramatic.", ["none"]),
        ],
      },
      {
        label: "Encourage the rumour publicly",
        results: [
          R(1, "Your stock rises in the media — current trust cools a little.", ["reputation", "coachTrust"]),
          R(-1, "The dressing room wonders where your head is.", ["support", "morale"]),
          R(-2, "Coach calls it a distraction. No offer appears automatically.", ["coachTrust", "morale"]),
          R(-3, "You look eager to leave mid-campaign. Focus slips.", ["morale", "reputation"]),
        ],
      },
    ],
  },
  {
    id: "derby-provocation",
    title: "Derby provocation",
    eligibility: ["rivalMatchup"],
    setup: "A rival's interview singles you out before the derby. Clips are already circulating.",
    choices: [
      {
        label: "Keep your answer measured",
        results: [
          R(2, "Calm under bait. Composure holds into match week.", ["morale", "coachTrust"]),
          R(1, "You refuse the circus. Staff approve.", ["coachTrust"]),
          R(0, "Neutral quotes. The derby still feels big.", ["none"]),
        ],
      },
      {
        label: "Use it as private motivation",
        results: [
          R(3, "Quiet fire. Readiness sharpens without public risk.", ["morale", "readiness"]),
          R(1, "You channel it into extras that stay within the plan.", ["morale"]),
          R(-1, "You overtrain the edge and feel a touch heavy.", ["readiness"]),
        ],
      },
      {
        label: "Respond with a public insult",
        results: [
          R(-3, "The banter turns ugly. Extra eyes — and pressure — follow you.", ["reputation", "morale"]),
          R(-2, "Staff warn you about discipline. Composure dips.", ["coachTrust", "morale"]),
          R(1, "The crowd loves the needle. Risk remains high.", ["reputation"]),
          R(-1, "It's a headline, not a plan.", ["morale"]),
        ],
      },
    ],
  },
  {
    id: "partner-long-distance",
    title: "Long-distance strain",
    eligibility: ["hasPartner"],
    setup: "Someone you're dating says long-distance life is becoming difficult around the fixture list.",
    choices: [
      {
        label: "Arrange a realistic visit on approved days off",
        results: [
          R(2, "A short, planned visit steadies both of you.", ["support", "morale"]),
          R(1, "Club signs off. You return settled.", ["support", "morale"]),
          R(0, "Logistics are tight but workable.", ["support"]),
          R(-1, "Travel eats recovery a little, but the relationship holds.", ["readiness", "support"]),
        ],
      },
      {
        label: "Have an honest conversation and make a plan",
        results: [
          R(2, "Clarity without drama. Focus returns for the week.", ["support", "morale"]),
          R(1, "You both leave with dates that fit the calendar.", ["support"]),
          R(0, "Hard talk, no easy fix — still better than silence.", ["support"]),
        ],
      },
      {
        label: "Dismiss the concern until the season ends",
        results: [
          R(-2, "The distance grows. Distraction follows you into training.", ["support", "morale"]),
          R(-1, "You postpone the issue; it doesn't disappear.", ["support"]),
          R(-3, "A cold week at home shows in your sharpness.", ["morale", "readiness"]),
          R(0, "They wait — for now. Tension remains.", ["support"]),
        ],
      },
    ],
  },
  {
    id: "partner-important-date",
    title: "A date that matters",
    eligibility: ["hasPartner"],
    setup: "A meaningful personal occasion falls near a busy fixture week. Nobody is asking you to miss a match.",
    choices: [
      {
        label: "Plan a short celebration after training",
        results: [
          R(2, "Small, real, and within the schedule. Mood lifts.", ["support", "morale"]),
          R(1, "You show up briefly and sleep on time.", ["support", "readiness"]),
          R(0, "Quiet evening. Fine balance.", ["support"]),
        ],
      },
      {
        label: "Explain the schedule and choose another date together",
        results: [
          R(2, "Honesty lands. You both feel respected.", ["support", "morale"]),
          R(1, "A later plan keeps training clean.", ["support"]),
          R(0, "Slight disappointment, solid understanding.", ["support"]),
        ],
      },
      {
        label: "Ignore the occasion without discussing it",
        results: [
          R(-2, "Silence hurts more than a hard conversation.", ["support", "morale"]),
          R(-1, "You dodge it; focus still frays a little.", ["morale"]),
          R(-3, "The fallout follows you into the next session.", ["support", "morale"]),
        ],
      },
    ],
  },
  {
    id: "relocation-together",
    title: "Relocation talk",
    eligibility: ["pendingRelocation", "hasPartner"],
    setup: "A possible move would change both your football life and your partner's plans.",
    choices: [
      {
        label: "Discuss practical options together",
        results: [
          R(2, "Shared planning softens the upheaval.", ["support", "morale"]),
          R(1, "You map housing, travel, and timing honestly.", ["support"]),
          R(0, "No perfect answer, but you're aligned.", ["support"]),
        ],
      },
      {
        label: "Ask for more time before deciding",
        results: [
          R(1, "Breathing room helps — if you use it.", ["support", "morale"]),
          R(0, "The pause is fair. Uncertainty remains.", ["support"]),
          R(-1, "Delay without a plan adds quiet stress.", ["morale"]),
        ],
      },
      {
        label: "Make the plan alone",
        results: [
          R(-2, "Unilateral decisions strain the relationship.", ["support", "morale"]),
          R(-1, "Football clarity, personal friction.", ["support"]),
          R(-3, "They feel sidelined as the move nears.", ["support", "morale"]),
        ],
      },
    ],
  },
  {
    id: "family-birthday",
    title: "Family birthday",
    eligibility: ["any"],
    setup: "Your family asks whether you can make an important birthday during a crowded month.",
    choices: [
      {
        label: "Arrange an approved brief visit",
        results: [
          R(2, "Club clears a short window. You return lighter.", ["support", "morale"]),
          R(1, "A tight trip works. Recovery stays intact.", ["support", "readiness"]),
          R(-1, "Travel is tiring but worth it for home.", ["readiness", "support"]),
        ],
      },
      {
        label: "Join remotely and plan time together later",
        results: [
          R(1, "Feasible and kind. Family understands the calendar.", ["support", "morale"]),
          R(2, "A good call keeps you match-ready without guilt.", ["support", "readiness"]),
          R(0, "Screens aren't perfect, but the connection holds.", ["support"]),
        ],
      },
      {
        label: "Travel without checking club commitments",
        results: [
          R(-3, "You miss a session. Trust takes a hit.", ["coachTrust", "readiness"]),
          R(-2, "Staff are unhappy. The birthday was warm; the fallout is not.", ["coachTrust", "support"]),
          R(-1, "You squeeze it in and arrive drained.", ["readiness"]),
        ],
      },
    ],
  },
  {
    id: "family-needs-support",
    title: "Family needs a hand",
    eligibility: ["any"],
    setup: "A relative is under pressure and asks for your time — not a crisis headline, just real life.",
    choices: [
      {
        label: "Talk to the club and arrange support",
        results: [
          R(2, "Staff help you ringfence an evening. You show up for family.", ["support", "morale", "coachTrust"]),
          R(1, "Clear communication keeps football and home aligned.", ["support"]),
          R(0, "A small plan is enough for now.", ["support"]),
        ],
      },
      {
        label: "Spend the free evening helping remotely",
        results: [
          R(2, "A long call and practical help steady everyone.", ["support", "morale"]),
          R(1, "You do what you can from where you are.", ["support"]),
          R(0, "Helpful, if imperfect.", ["support"]),
        ],
      },
      {
        label: "Avoid the conversation",
        results: [
          R(-2, "Guilt follows you into the week.", ["morale", "support"]),
          R(-1, "Silence solves nothing.", ["support"]),
          R(-3, "The distance hurts; focus frays.", ["morale"]),
        ],
      },
    ],
  },
  {
    id: "homesick-abroad",
    title: "Homesick abroad",
    eligibility: ["recentAbroadMove"],
    setup: "The football is fine, but you feel isolated in a new country between sessions.",
    choices: [
      {
        label: "Join a teammate for a local activity",
        results: [
          R(2, "A small outing unlocks the city. Adaptation improves.", ["support", "morale"]),
          R(1, "Company helps. Training feels lighter.", ["morale"]),
          R(0, "Pleasant enough. Still settling in.", ["support"]),
        ],
      },
      {
        label: "Schedule regular family calls",
        results: [
          R(2, "Routine contact anchors you without draining recovery.", ["support", "morale"]),
          R(1, "Hearing home steadies the week.", ["support"]),
          R(0, "Helpful habit forming.", ["support"]),
        ],
      },
      {
        label: "Shut yourself away between sessions",
        results: [
          R(-2, "Isolation deepens. Adaptation slows.", ["morale", "support"]),
          R(-1, "Quiet evenings turn heavy.", ["morale"]),
          R(-3, "Loneliness shows in sharpness and mood.", ["morale", "readiness"]),
        ],
      },
    ],
  },
  {
    id: "approved-vacation",
    title: "Approved days off",
    eligibility: ["onLeave"],
    setup: "The club has granted several days off. How you use them is yours — within reason.",
    choices: [
      {
        label: "Take a quiet trip and return rested",
        results: [
          R(2, "You come back fresher and clear-headed.", ["readiness", "morale"]),
          R(1, "Quiet recovery done right.", ["readiness"]),
          R(0, "Pleasant break, neutral return.", ["none"]),
        ],
      },
      {
        label: "Spend the break with family",
        results: [
          R(2, "Home time lifts morale without wrecking sleep.", ["support", "morale", "readiness"]),
          R(1, "Rest and connection in one.", ["support", "morale"]),
          R(0, "Good company, ordinary recovery.", ["support"]),
        ],
      },
      {
        label: "Stay out late every night and return exhausted",
        results: [
          R(-3, "You report back heavy-legged and foggy.", ["readiness", "coachTrust"]),
          R(-2, "Fun short-term; readiness pays the bill.", ["readiness", "morale"]),
          R(-1, "Staff notice the fatigue.", ["readiness"]),
        ],
      },
    ],
  },
  {
    id: "vacation-return-delay",
    title: "Flight delay",
    eligibility: ["onLeave"],
    setup: "Your holiday return flight is disrupted before training resumes.",
    choices: [
      {
        label: "Inform the club and arrange the earliest safe return",
        results: [
          R(2, "Transparency protects trust. You arrive as soon as safe.", ["coachTrust", "morale"]),
          R(1, "Staff rearrange lightly. No drama.", ["coachTrust"]),
          R(0, "Delay noted; session adjusted.", ["none"]),
        ],
      },
      {
        label: "Ask for approved extra leave",
        results: [
          R(1, "Club grants a short extension when the case is clear.", ["coachTrust", "readiness"]),
          R(0, "They allow it once. Don't make a habit.", ["coachTrust"]),
          R(-1, "The ask is granted grudgingly.", ["coachTrust"]),
        ],
      },
      {
        label: "Hide the delay and hope nobody notices",
        results: [
          R(-3, "They notice. Trust drops sharply.", ["coachTrust", "reputation"]),
          R(-2, "Cover stories rarely survive squad WhatsApp.", ["coachTrust"]),
          R(-1, "You scrape in late; questions follow.", ["coachTrust", "readiness"]),
        ],
      },
    ],
  },
  {
    id: "travel-fatigue",
    title: "Long away trip",
    eligibility: ["travelCongestion"],
    setup: "A long away trip leaves little time before the next game.",
    choices: [
      {
        label: "Follow the recovery schedule",
        results: [
          R(2, "Sleep, fuel, light mobility — readiness holds.", ["readiness"]),
          R(1, "You stay within the plan. Legs feel workable.", ["readiness"]),
          R(0, "Standard recovery. No heroics needed.", ["none"]),
        ],
      },
      {
        label: "Use the evening for light preparation",
        results: [
          R(1, "Short review, early lights-out. Sensible.", ["morale", "readiness"]),
          R(2, "A focused twenty minutes, then rest.", ["readiness", "training"]),
          R(-1, "You stay up a bit late over clips.", ["readiness"]),
        ],
      },
      {
        label: "Ignore rest to explore all night",
        results: [
          R(-3, "Tourist mode wrecks the next session.", ["readiness", "coachTrust"]),
          R(-2, "Fun city; heavy legs.", ["readiness"]),
          R(-1, "You pay a mild freshness tax.", ["readiness"]),
        ],
      },
    ],
  },
  {
    id: "airport-fan",
    title: "Airport fan",
    eligibility: ["any"],
    setup: "A young fan asks for a photo just as the squad is leaving.",
    choices: [
      {
        label: "Ask staff if there's time for a quick photo",
        results: [
          R(2, "Staff nod. One photo, warm goodbye, on the bus.", ["reputation", "morale"]),
          R(1, "Quick and kind. Mood lifts.", ["reputation", "morale"]),
          R(0, "No time after all — but you asked well.", ["reputation"]),
        ],
      },
      {
        label: "Politely explain and offer a wave",
        results: [
          R(1, "Respectful boundary. Fan still smiles.", ["reputation", "morale"]),
          R(2, "Grace under hurry. Good optics without delay.", ["reputation"]),
          R(0, "Clean exit. Fine.", ["none"]),
        ],
      },
      {
        label: "Lose your temper at the interruption",
        results: [
          R(-3, "The clip is unkind. Reputation dips.", ["reputation", "morale"]),
          R(-2, "Staff look embarrassed. You regret the tone.", ["reputation", "coachTrust"]),
          R(-1, "Stress shows. Not your best minute.", ["morale"]),
        ],
      },
    ],
  },
  {
    id: "sponsor-shoot",
    title: "Sponsor shoot",
    eligibility: ["any"],
    setup: "A sponsor wants a shoot during a demanding training week.",
    choices: [
      {
        label: "Reschedule with your agent",
        results: [
          R(2, "Timing moves; training stays sacred.", ["coachTrust", "morale"]),
          R(1, "Agent handles it cleanly.", ["reputation"]),
          R(0, "Shoot slips a week. No harm.", ["none"]),
        ],
      },
      {
        label: "Accept if the club approves the timing",
        results: [
          R(1, "Approved window — short, professional, done.", ["reputation", "coachTrust"]),
          R(2, "Club and brand aligned. Focus holds.", ["reputation", "morale"]),
          R(-1, "Even approved, it nibbles at recovery.", ["readiness"]),
        ],
      },
      {
        label: "Skip training to attend without telling anyone",
        results: [
          R(-3, "Absence noted. Trust and reputation take damage.", ["coachTrust", "reputation"]),
          R(-2, "Short-term brand win, medium-term squad cost.", ["coachTrust"]),
          R(-4, "You get pulled in. Nobody is impressed.", ["coachTrust", "reputation", "morale"]),
        ],
      },
    ],
  },
  {
    id: "charity-invitation",
    title: "Youth club visit",
    eligibility: ["any"],
    setup: "A local youth club invites you to a short visit. Your calendar is real — so is theirs.",
    choices: [
      {
        label: "Attend on a rest day",
        results: [
          R(2, "An hour well spent. Mood and reputation rise.", ["reputation", "morale", "support"]),
          R(1, "Kids light up; you still recover.", ["reputation", "readiness"]),
          R(0, "Good visit, ordinary week.", ["reputation"]),
        ],
      },
      {
        label: "Send a thoughtful video message",
        results: [
          R(2, "Feasible and genuine. They appreciate the effort.", ["reputation", "morale"]),
          R(1, "Remote presence done right.", ["reputation"]),
          R(0, "Nice gesture without travel cost.", ["reputation"]),
        ],
      },
      {
        label: "Promise to come, then fail to follow through",
        results: [
          R(-2, "Broken promise travels faster than a visit.", ["reputation", "morale"]),
          R(-3, "Local disappointment becomes a small story.", ["reputation"]),
          R(-1, "You feel the miss even if headlines don't.", ["morale"]),
        ],
      },
    ],
  },
  {
    id: "social-media-mistake",
    title: "Rushed post",
    eligibility: ["any"],
    setup: "A rushed post is interpreted as criticism of your coach. The replies are already loud.",
    choices: [
      {
        label: "Clarify privately and correct it",
        results: [
          R(2, "Direct talk cools the fire. Trust recovers.", ["coachTrust", "morale"]),
          R(1, "You delete, clarify, move on.", ["coachTrust", "reputation"]),
          R(0, "Contained. Lesson learned.", ["none"]),
        ],
      },
      {
        label: "Ask the media officer for help",
        results: [
          R(2, "Professionals frame a clean correction.", ["reputation", "coachTrust"]),
          R(1, "Process saves you from a second mistake.", ["reputation"]),
          R(0, "Statement issued. Noise fades.", ["reputation"]),
        ],
      },
      {
        label: "Double down publicly",
        results: [
          R(-3, "The feud grows. Pressure and trust both suffer.", ["coachTrust", "reputation", "morale"]),
          R(-2, "Another post makes it worse.", ["reputation", "coachTrust"]),
          R(-4, "Staff shut it down hard. Focus shatters for days.", ["coachTrust", "morale"]),
        ],
      },
    ],
  },
  {
    id: "veteran-mentor",
    title: "Veteran advice",
    eligibility: ["any"],
    setup: "An experienced teammate offers to review your positioning after training.",
    choices: [
      {
        label: "Review clips and practice one change",
        results: [
          R(3, "One clear habit sticks. Learning opportunity ticks up.", ["training", "morale"], {
            rareCeilingEligible: true,
          }),
          R(2, "Useful detail without overload.", ["training"]),
          R(1, "Small gain in clarity.", ["training"]),
          R(0, "Interesting session; nothing dramatic yet.", ["none"]),
        ],
      },
      {
        label: "Ask for advice after the next session",
        results: [
          R(1, "You stay open without forcing it tonight.", ["training", "morale"]),
          R(2, "Follow-up happens and helps.", ["training"]),
          R(0, "Good intention; timing slips once.", ["none"]),
        ],
      },
      {
        label: "Dismiss it because you know your game",
        results: [
          R(-2, "Closed ears. A learning door stays shut.", ["training", "support"]),
          R(-1, "Veteran shrugs. Relationship cools slightly.", ["support"]),
          R(0, "You stay as you are — for better or worse.", ["none"]),
        ],
      },
    ],
  },
  {
    id: "help-young-teammate",
    title: "New teammate",
    eligibility: ["any"],
    setup: "A new teammate struggles with the squad's routines and looks lost after training.",
    choices: [
      {
        label: "Help them settle in",
        results: [
          R(2, "Leadership without a captain's armband. Group mood lifts.", ["support", "morale"]),
          R(1, "A small kindness steadies the room.", ["support"]),
          R(3, "They thrive early; staff notice your example.", ["support", "coachTrust"]),
        ],
      },
      {
        label: "Ask staff to pair them with support",
        results: [
          R(2, "You escalate help the right way.", ["support", "coachTrust"]),
          R(1, "Staff appreciate the flag.", ["coachTrust"]),
          R(0, "Process handles it.", ["support"]),
        ],
      },
      {
        label: "Mock the mistake in front of the group",
        results: [
          R(-3, "Cheap laugh, real damage to trust.", ["support", "morale", "coachTrust"]),
          R(-2, "The joke lands badly.", ["support", "reputation"]),
          R(-1, "A few chuckle; most don't.", ["support"]),
        ],
      },
    ],
  },
  {
    id: "selection-disappointment",
    title: "Left out",
    eligibility: ["benched"],
    setup: "You're left out after expecting to start. The team sheet is already public.",
    choices: [
      {
        label: "Ask for specific feedback",
        results: [
          R(2, "Clear ask, calm tone. Trust and focus improve.", ["coachTrust", "morale"]),
          R(1, "You get one actionable point.", ["training", "coachTrust"]),
          R(0, "Feedback is brief but usable.", ["none"]),
        ],
      },
      {
        label: "Train well and respond patiently",
        results: [
          R(2, "Professional response. Door stays open.", ["coachTrust", "morale"]),
          R(1, "Standards hold under disappointment.", ["morale"]),
          R(0, "Quiet week. No drama.", ["none"]),
        ],
      },
      {
        label: "Confront the coach angrily in public",
        results: [
          R(-3, "Public confrontation burns trust fast.", ["coachTrust", "reputation"]),
          R(-2, "Staff mark the reaction, not the minutes.", ["coachTrust", "morale"]),
          R(-4, "You make selection harder for yourself.", ["coachTrust", "morale"]),
        ],
      },
    ],
  },
  {
    id: "extra-session-or-rest",
    title: "Extra session temptation",
    eligibility: ["fixtureCongestion"],
    setup: "A tempting extra session falls between closely spaced games.",
    choices: [
      {
        label: "Follow the planned recovery",
        results: [
          R(2, "Discipline pays. Readiness holds for selection.", ["readiness", "coachTrust"]),
          R(1, "You trust the plan.", ["readiness"]),
          R(0, "Ordinary recovery day.", ["none"]),
        ],
      },
      {
        label: "Ask staff for a short targeted session",
        results: [
          R(2, "Approved ten minutes on one detail — smart load.", ["training", "readiness"]),
          R(1, "Staff trim it to something useful.", ["training"]),
          R(-1, "Even short work adds a little fatigue.", ["readiness"]),
        ],
      },
      {
        label: "Train hard despite fatigue",
        results: [
          R(-2, "Hero session, heavy legs.", ["readiness"]),
          R(-3, "You look keen and arrive flat.", ["readiness", "coachTrust"]),
          R(1, "Somehow you feel sharper — still a gamble.", ["training", "readiness"]),
        ],
      },
    ],
  },
  {
    id: "return-from-injury",
    title: "Return programme",
    eligibility: ["returningFromInjury"],
    setup: "You're improving, but the agreed return programme is unfinished.",
    choices: [
      {
        label: "Follow the programme",
        results: [
          R(2, "Patience protects the return. Readiness builds cleanly.", ["readiness", "coachTrust"]),
          R(1, "Physio stays onside. Progress holds.", ["readiness"]),
          R(0, "Another solid rehab day.", ["none"]),
        ],
      },
      {
        label: "Discuss your readiness with the physio and coach",
        results: [
          R(2, "Honest check-in. Plan adjusts slightly if earned.", ["readiness", "coachTrust"]),
          R(1, "They hear you and keep guardrails.", ["coachTrust"]),
          R(0, "Conversation clarifies expectations.", ["none"]),
        ],
      },
      {
        label: "Hide symptoms to try to start immediately",
        results: [
          R(-3, "Risk without guarantee. Trust and body both strained.", ["readiness", "coachTrust"]),
          R(-2, "Symptoms show anyway. Programme resets.", ["readiness"]),
          R(-4, "A setback forces caution. No invented new injury required — just lost readiness.", [
            "readiness",
            "coachTrust",
            "morale",
          ]),
        ],
      },
    ],
  },
  {
    id: "international-first-trip",
    title: "First national camp",
    eligibility: ["nationalCallUp"],
    setup: "Your first national-team camp brings nerves and unfamiliar teammates.",
    choices: [
      {
        label: "Ask an experienced teammate for guidance",
        results: [
          R(2, "A senior guide settles the nerves. Composure rises.", ["morale", "support"]),
          R(3, "You adapt faster to camp rhythms.", ["morale", "training"]),
          R(1, "Small tips, big calm.", ["morale"]),
        ],
      },
      {
        label: "Focus on the routines and enjoy the occasion",
        results: [
          R(2, "Presence without panic. Good first impression.", ["morale", "coachTrust"]),
          R(1, "You soak it in and stay professional.", ["morale"]),
          R(0, "Quiet debut week energy.", ["none"]),
        ],
      },
      {
        label: "Stay isolated and overthink the selection",
        results: [
          R(-2, "Overthinking costs sharpness in training games.", ["morale", "readiness"]),
          R(-1, "Nerves show. Staff give you time.", ["morale"]),
          R(-3, "Isolation makes the shirt feel heavier.", ["morale", "support"]),
        ],
      },
    ],
  },
  {
    id: "captain-pressure",
    title: "Lead this week",
    eligibility: ["leadershipContext"],
    setup: "With senior leaders unavailable, the coach asks whether you can lead this week — not forever.",
    choices: [
      {
        label: "Accept and keep communication calm",
        results: [
          R(2, "Quiet leadership. Group stays organised.", ["coachTrust", "morale", "support"]),
          R(3, "You set a steady tone without theatrics.", ["coachTrust", "morale"]),
          R(1, "Solid caretaker week.", ["coachTrust"]),
        ],
      },
      {
        label: "Ask an experienced teammate to share responsibility",
        results: [
          R(2, "Shared load, clear voices. Smart humility.", ["support", "coachTrust"]),
          R(1, "Coach likes the self-awareness.", ["coachTrust"]),
          R(0, "Co-leadership works fine.", ["support"]),
        ],
      },
      {
        label: "Turn it into a speech about yourself",
        results: [
          R(-2, "The room cools. Leadership isn't a monologue.", ["support", "morale"]),
          R(-3, "Ego first. Trust dips.", ["coachTrust", "support"]),
          R(-1, "Awkward. You dial it back later.", ["morale"]),
        ],
      },
    ],
  },
];

let _bank = null;
let _byId = null;

function buildBank() {
  const byId = new Map();
  const list = SENIOR_SCENARIO_DEFS.map((sc, i) => {
    const n = normalizeSeniorScenario(sc, i);
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
