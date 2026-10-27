/**
 * Legacy senior career scenes upgraded to contentVersion 2 (category sampling).
 * Source: SENIOR_SCENARIO_DEFS in seniorCareerScenarios.js — preserved IDs and choice meanings.
 */

function O(choiceId, abilityCategory, delta, focus, text, effects) {
  return {
    id: `${choiceId}:${abilityCategory}`,
    abilityCategory,
    delta,
    conditionalWeight: 1,
    focus,
    text,
    effects: abilityCategory === "neutral" ? ["none"] : effects,
  };
}

function C(sceneId, slug, label, disposition, focusDefault, triples) {
  const choiceId = `${sceneId}:${slug}`;
  return {
    id: choiceId,
    label,
    disposition,
    results: [
      O(choiceId, "positive", triples.positive[0], triples.positive[1] || focusDefault, triples.positive[2], triples.positive[3]),
      O(choiceId, "neutral", 0, triples.neutral[0] || focusDefault, triples.neutral[1], ["none"]),
      O(choiceId, "negative", triples.negative[0], triples.negative[1] || focusDefault, triples.negative[2], triples.negative[3]),
    ],
  };
}

export const LEGACY_SENIOR_SCENARIO_DEFS = [
  {
    id: "press-after-defeat",
    title: "After the loss",
    contentVersion: 2,
    tags: ["media", "accountability", "post-match"],
    eligibility: ["afterLoss"],
    setup:
      "The tunnel still smells of defeat and the microphones follow you toward the mixed zone. " +
      "A reporter asks who let the team down tonight, and the clip will travel whether you answer well or not. " +
      "You have one chance to frame how you review this performance before the next session.",
    choices: [
      C("press-after-defeat", "own-performance", "Own your performance", "thoughtful", "role-learning", {
        positive: [2, "role-learning", "You name one mistake in your role and how you will rehearse the fix on the training pitch. Staff mark the honesty as professional learning.", ["training", "coachTrust"]],
        neutral: ["role-learning", "Your answer is honest but generic; the week resets without extra clarity on what to work on."],
        negative: [-1, "role-learning", "You sound tight rather than reflective, and tomorrow's video review feels harder to engage with.", ["morale"]],
      }),
      C("press-after-defeat", "defend-group", "Defend the group and discuss the next match", "balanced", "routine", {
        positive: [2, "routine", "You protect the squad and spell out the next-match routine. The group keeps a clear weekly structure.", ["coachTrust", "morale"]],
        neutral: ["routine", "Safe lines; neither your habits nor the headlines shift much."],
        negative: [-1, "support", "Some read it as dodging detail, and your partner on the pitch gets less of your time in review.", ["reputation"]],
      }),
      C("press-after-defeat", "blame-teammates", "Blame teammates publicly", "reckless", "support", {
        positive: [1, "role-learning", "Shockingly, one sharp line lands as honesty — still a dangerous habit for how you study games together.", ["reputation"]],
        neutral: ["support", "You throw a vague accusation; the clip fades but nobody learns from the night."],
        negative: [-3, "support", "Trust fractures and shared clip sessions stop. You lose the room that helps you improve.", ["coachTrust", "morale", "support"]],
      }),
    ],
  },
  {
    id: "press-breakthrough",
    title: "Breakthrough night",
    contentVersion: 2,
    tags: ["media", "performance", "spotlight"],
    eligibility: ["standoutPerformance"],
    setup:
      "Your first standout senior performance pulls a wall of microphones toward you. " +
      "Every question invites you to define what this night means for your role. " +
      "What you say will either keep the focus on repeatable habits or turn one good game into extra noise.",
    choices: [
      C("press-breakthrough", "credit-team", "Credit the coaches and teammates", "thoughtful", "role-learning", {
        positive: [2, "role-learning", "You tie the night to patterns you have been drilling — pressing triggers, rest defence — so the learning sticks.", ["training", "coachTrust"]],
        neutral: ["role-learning", "Polite gratitude; the moment passes without sharpening your study plan."],
        negative: [-1, "technique", "You underplay the details you actually executed, and the extra confidence does not convert into deliberate reps.", ["morale"]],
      }),
      C("press-breakthrough", "ready-for-more", "Say you're ready for bigger responsibility", "ambitious", "role-learning", {
        positive: [3, "role-learning", "Staff hear ambition tied to wanting more tactical homework in your position. Expectation rises with a clear development ask.", ["training", "morale"]],
        neutral: ["routine", "The quote is fine; your weekly load stays unchanged for now."],
        negative: [-2, "role-learning", "It reads like a demand before you have mapped the extra responsibilities on video.", ["coachTrust"]],
      }),
      C("press-breakthrough", "dominate-weekly", "Promise you'll dominate every week", "reckless", "technique", {
        positive: [2, "technique", "The bold line buys you one intense week of extras — useful if you keep them structured.", ["training", "reputation"]],
        neutral: ["routine", "Big talk, ordinary training week. Nothing new enters the plan."],
        negative: [-3, "technique", "The next quiet match makes your habits look thin on tape; composure dips under the comparison.", ["morale", "reputation"]],
      }),
    ],
  },
  {
    id: "transfer-rumour",
    title: "Transfer rumour week",
    contentVersion: 2,
    tags: ["media", "focus", "transfer"],
    eligibility: ["any"],
    setup:
      "A headline links you to a larger club while your team faces an important week. " +
      "Nothing is signed, but the noise can steal reps from your preparation if you feed it. " +
      "You decide how much mental bandwidth the rumour gets before training.",
    choices: [
      C("transfer-rumour", "agent-privately", "Speak privately with your agent", "thoughtful", "routine", {
        positive: [2, "routine", "Quiet clarity lets you keep the same session plan and sharpness on the details staff set.", ["morale", "training"]],
        neutral: ["routine", "No new information; the week continues on the existing programme."],
        negative: [-1, "routine", "You dwell on hypotheticals anyway and miss a beat in the tactical walk-through.", ["morale"]],
      }),
      C("transfer-rumour", "reaffirm-focus", "Reaffirm focus for now", "balanced", "role-learning", {
        positive: [2, "role-learning", "You publicly commit to this week's role tasks; coaches add you to an extra clip on your current responsibilities.", ["coachTrust", "training"]],
        neutral: ["role-learning", "Standard loyalty line — useful, not transformative for your habits."],
        negative: [-1, "support", "Teammates still wonder where your head is; paired drills feel slightly off.", ["support", "morale"]],
      }),
      C("transfer-rumour", "encourage-rumour", "Encourage the rumour publicly", "ambitious", "reputation", {
        positive: [1, "role-learning", "Your name rises in gossip, but you still squeeze one focused block on your current role before kickoff.", ["reputation"]],
        neutral: ["routine", "Headlines buzz; your training diary looks like any other week."],
        negative: [-3, "routine", "Coach calls it a distraction and trims your extras. Preparation thins mid-campaign.", ["coachTrust", "morale"]],
      }),
    ],
  },
  {
    id: "derby-provocation",
    title: "Derby provocation",
    contentVersion: 2,
    tags: ["media", "rivalry", "focus"],
    eligibility: ["rivalMatchup"],
    setup:
      "A rival's interview singles you out before the derby, and the clips are already circulating in the group chat. " +
      "You can absorb the bait, channel it, or escalate it. " +
      "Match week is short — what you choose shapes both composure and how you prepare.",
    choices: [
      C("derby-provocation", "measured-answer", "Keep your answer measured", "thoughtful", "routine", {
        positive: [2, "routine", "Calm quotes keep sleep and recovery on schedule; you arrive at tactical prep clear-headed.", ["morale", "coachTrust"]],
        neutral: ["routine", "Neutral soundbites; the derby still feels big without changing your plan."],
        negative: [-1, "technique", "You play it so safe that you skip visualising one key duel in your role.", ["morale"]],
      }),
      C("derby-provocation", "private-motivation", "Use it as private motivation", "ambitious", "technique", {
        positive: [3, "technique", "Quiet fire drives an extra half-hour on one technical detail — first touch under pressure — without public risk.", ["training", "readiness"]],
        neutral: ["technique", "You feel stirred but keep the standard load; no new habit yet."],
        negative: [-1, "routine", "You over-chase the edge in an unapproved extra and feel a touch heavy in the next session.", ["readiness"]],
      }),
      C("derby-provocation", "public-insult", "Respond with a public insult", "reckless", "support", {
        positive: [1, "technique", "The crowd loves the needle; adrenaline spikes one sharp training day — still not a plan.", ["reputation"]],
        neutral: ["support", "It is a headline, not a syllabus. Your role prep stays unchanged."],
        negative: [-3, "routine", "Extra eyes and stress disrupt sleep; staff warn you and your readiness dips.", ["reputation", "morale"]],
      }),
    ],
  },
  {
    id: "partner-long-distance",
    title: "Long-distance strain",
    contentVersion: 2,
    tags: ["relationship", "life"],
    eligibility: ["hasPartner"],
    setup:
      "Someone you are dating says long-distance life is becoming difficult around your fixture list. " +
      "They are not asking you to miss football — they want a plan that fits reality. " +
      "How you handle it affects whether you arrive at training settled or distracted.",
    choices: [
      C("partner-long-distance", "planned-visit", "Arrange a realistic visit on approved days off", "thoughtful", "support", {
        positive: [2, "support", "A short, club-cleared visit steadies home life so you can lock in on recovery and review.", ["support", "readiness"]],
        neutral: ["support", "Logistics are tight but workable; neither side gains a new routine."],
        negative: [-1, "routine", "Travel nibbles recovery, yet the relationship holds — you adjust the next day's load.", ["readiness", "support"]],
      }),
      C("partner-long-distance", "honest-plan", "Have an honest conversation and make a plan", "balanced", "support", {
        positive: [2, "support", "Clear dates on the calendar free your head for positional homework between sessions.", ["support", "morale"]],
        neutral: ["support", "Hard talk without an easy fix — still better than carrying silence into the week."],
        negative: [-1, "adaptation", "The plan is vague; you drift through drills still half on your phone.", ["morale"]],
      }),
      C("partner-long-distance", "dismiss-concern", "Dismiss the concern until the season ends", "reckless", "support", {
        positive: [1, "support", "They wait for now; tension remains but you squeeze one normal training week.", ["support"]],
        neutral: ["support", "Postponed feelings; your preparation rhythm stays average."],
        negative: [-3, "routine", "Cold distance at home shows up as tired legs and missed detail in recovery.", ["morale", "readiness"]],
      }),
    ],
  },
  {
    id: "partner-important-date",
    title: "A date that matters",
    contentVersion: 2,
    tags: ["relationship", "life"],
    eligibility: ["hasPartner"],
    setup:
      "A meaningful personal occasion falls near a busy fixture week. " +
      "Nobody is asking you to miss a match — but ignoring the date can still cost you focus. " +
      "You choose how to honour it without wrecking your preparation rhythm.",
    choices: [
      C("partner-important-date", "short-celebration", "Plan a short celebration after training", "thoughtful", "routine", {
        positive: [2, "routine", "A brief, timed celebration keeps sleep on track and mood high for the next session.", ["support", "readiness"]],
        neutral: ["support", "Quiet evening; balance is fine, not memorable."],
        negative: [-1, "routine", "You stretch the evening and pay a small freshness tax at morning activation.", ["readiness"]],
      }),
      C("partner-important-date", "reschedule-together", "Explain the schedule and choose another date together", "balanced", "support", {
        positive: [2, "support", "Mutual respect clears mental clutter; you engage fully in tactical video that night.", ["support", "training"]],
        neutral: ["support", "Slight disappointment, solid understanding — training stays standard."],
        negative: [-1, "support", "They agree but sound hurt; concentration in rondo dips a fraction.", ["morale"]],
      }),
      C("partner-important-date", "ignore-occasion", "Ignore the occasion without discussing it", "reckless", "support", {
        positive: [1, "routine", "You get through the week on autopilot — functionally fine, emotionally thin.", ["readiness"]],
        neutral: ["support", "The date passes unmarked; your diary looks normal, your home does not."],
        negative: [-3, "technique", "Fallout follows you into the next session; touches and decisions look rushed.", ["support", "morale"]],
      }),
    ],
  },
  {
    id: "relocation-together",
    title: "Relocation talk",
    contentVersion: 2,
    tags: ["relationship", "life", "adaptation"],
    eligibility: ["pendingRelocation", "hasPartner"],
    setup:
      "A possible move would change your football life and your partner's plans at the same time. " +
      "You have not signed anything yet, but the conversation is live. " +
      "Shared planning now affects how quickly you adapt if the transfer happens.",
    choices: [
      C("relocation-together", "discuss-options", "Discuss practical options together", "thoughtful", "adaptation", {
        positive: [2, "adaptation", "You map housing, travel, and language prep together — off-pitch stability speeds on-pitch learning.", ["support", "training"]],
        neutral: ["adaptation", "No perfect answer, but you are aligned on what to research next."],
        negative: [-1, "adaptation", "Talks stall on one detail; you train well but study less about the new city.", ["support"]],
      }),
      C("relocation-together", "ask-time", "Ask for more time before deciding", "balanced", "support", {
        positive: [1, "adaptation", "Breathing room lets you finish current role homework before absorbing new information.", ["support", "morale"]],
        neutral: ["support", "Fair pause; uncertainty remains in the background."],
        negative: [-1, "adaptation", "Delay without milestones adds quiet stress that blurs clip review.", ["morale"]],
      }),
      C("relocation-together", "decide-alone", "Make the plan alone", "reckless", "support", {
        positive: [1, "role-learning", "Football logistics are clear in your head — personal friction is the cost.", ["support"]],
        neutral: ["support", "They learn the plan after the fact; your training week is unchanged."],
        negative: [-3, "adaptation", "They feel sidelined; home friction slows the adaptation work you need for a new league.", ["support", "morale"]],
      }),
    ],
  },
  {
    id: "family-birthday",
    title: "Family birthday",
    contentVersion: 2,
    tags: ["family", "life"],
    eligibility: ["any"],
    setup:
      "Your family asks whether you can make an important birthday during a crowded month. " +
      "The club calendar is tight and every travel day counts toward readiness. " +
      "You decide how to show up for home without quietly stealing from your programme.",
    choices: [
      C("family-birthday", "approved-visit", "Arrange an approved brief visit", "thoughtful", "routine", {
        positive: [2, "routine", "Staff clear a short window; you return lighter and keep the rehab or prep blocks intact.", ["support", "readiness"]],
        neutral: ["support", "A tight trip works; recovery is ordinary, not optimal."],
        negative: [-1, "routine", "Travel is tiring but worth it — you tweak the next session's load with physio.", ["readiness", "support"]],
      }),
      C("family-birthday", "join-remotely", "Join remotely and plan time together later", "balanced", "support", {
        positive: [2, "routine", "Screens and a later plan keep you match-ready while family feels remembered.", ["support", "readiness"]],
        neutral: ["support", "Connection holds; training is unchanged."],
        negative: [-1, "support", "They wanted you in the room; focus in passing drills wavers slightly.", ["morale"]],
      }),
      C("family-birthday", "travel-without-clearance", "Travel without checking club commitments", "reckless", "routine", {
        positive: [1, "support", "The birthday is warm; you scramble back and barely salvage a light session.", ["support"]],
        neutral: ["routine", "You squeeze it in drained; staff note nothing until later."],
        negative: [-3, "routine", "You miss a scheduled block. Trust and readiness both take a hit.", ["coachTrust", "readiness"]],
      }),
    ],
  },
  {
    id: "family-needs-support",
    title: "Family needs a hand",
    contentVersion: 2,
    tags: ["family", "support"],
    eligibility: ["any"],
    setup:
      "A relative is under pressure and asks for your time — not a crisis headline, just real life. " +
      "You still have training and recovery on the clock. " +
      "Handling it well can free mental space for learning; avoiding it can clutter your week.",
    choices: [
      C("family-needs-support", "club-arranged-help", "Talk to the club and arrange support", "thoughtful", "support", {
        positive: [2, "support", "Staff ringfence an evening; you show up for family and return to video work refreshed.", ["support", "coachTrust", "training"]],
        neutral: ["support", "A small plan is enough for now; your session plan stays the same."],
        negative: [-1, "support", "Admin takes longer than hoped; you shorten but do not skip core prep.", ["morale"]],
      }),
      C("family-needs-support", "help-remotely", "Spend the free evening helping remotely", "balanced", "support", {
        positive: [2, "support", "Practical help from afar steadies them without costing a training day.", ["support", "morale"]],
        neutral: ["support", "Helpful, if imperfect — ordinary week on the pitch."],
        negative: [-1, "routine", "The call runs late; sleep is shorter before activation.", ["readiness"]],
      }),
      C("family-needs-support", "avoid-conversation", "Avoid the conversation", "reckless", "support", {
        positive: [1, "routine", "You bury yourself in training — productive surface, uneasy background.", ["training"]],
        neutral: ["support", "Silence continues; neither guilt nor relief shifts your habits."],
        negative: [-3, "technique", "Guilt frays focus; your next technical block looks distracted on tape.", ["morale", "support"]],
      }),
    ],
  },
  {
    id: "homesick-abroad",
    title: "Homesick abroad",
    contentVersion: 2,
    tags: ["life", "adaptation"],
    eligibility: ["recentAbroadMove"],
    setup:
      "The football is fine, but you feel isolated in a new country between sessions. " +
      "Adaptation off the pitch feeds how quickly you learn the team's routines on it. " +
      "You choose whether to build connections or retreat.",
    choices: [
      C("homesick-abroad", "teammate-outing", "Join a teammate for a local activity", "thoughtful", "adaptation", {
        positive: [2, "adaptation", "A small outing unlocks daily life skills; training feels lighter and you pick up calls faster.", ["support", "morale"]],
        neutral: ["adaptation", "Pleasant enough; still settling at an ordinary pace."],
        negative: [-1, "routine", "Social energy costs an early night; you adjust tomorrow's recovery.", ["readiness"]],
      }),
      C("homesick-abroad", "family-calls", "Schedule regular family calls", "balanced", "support", {
        positive: [2, "support", "Scheduled contact anchors you without draining recovery windows.", ["support", "morale"]],
        neutral: ["support", "Helpful habit forming; on-pitch learning pace unchanged."],
        negative: [-1, "adaptation", "You lean on home instead of local routines; integration slows slightly.", ["support"]],
      }),
      C("homesick-abroad", "shut-away", "Shut yourself away between sessions", "reckless", "adaptation", {
        positive: [1, "routine", "Extra solo time lets you watch clips — useful if you do not spiral.", ["training"]],
        neutral: ["adaptation", "Quiet days; neither worse nor better on the adaptation curve."],
        negative: [-3, "adaptation", "Isolation deepens; language and tactical slang lag, and sharpness dips.", ["morale", "readiness"]],
      }),
    ],
  },
  {
    id: "approved-vacation",
    title: "Approved days off",
    contentVersion: 2,
    tags: ["life", "recovery"],
    eligibility: ["onLeave"],
    setup:
      "The club has granted several days off. How you use them is yours — within reason. " +
      "Rest is part of preparation, not a break from it. " +
      "You decide whether you return fresher or behind the programme.",
    choices: [
      C("approved-vacation", "quiet-rest", "Take a quiet trip and return rested", "thoughtful", "routine", {
        positive: [2, "routine", "Sleep and light movement reset you; first session back feels sharp and coachable.", ["readiness", "morale"]],
        neutral: ["routine", "Pleasant break, neutral return — standard re-entry."],
        negative: [-1, "routine", "You relax too much and need an extra day to find rhythm in drills.", ["readiness"]],
      }),
      C("approved-vacation", "family-time", "Spend the break with family", "balanced", "support", {
        positive: [2, "routine", "Home time lifts mood without wrecking sleep; you rejoin with energy for role work.", ["support", "morale", "readiness"]],
        neutral: ["support", "Good company, ordinary recovery curve."],
        negative: [-1, "routine", "Late chats cut sleep; staff extend your ramp-up one day.", ["readiness"]],
      }),
      C("approved-vacation", "late-nights", "Stay out late every night and return exhausted", "reckless", "routine", {
        positive: [1, "routine", "You somehow feel loose on day one — still a poor trade for readiness.", ["readiness"]],
        neutral: ["routine", "Fun break; programme unchanged on paper."],
        negative: [-3, "routine", "You report back heavy-legged; coaches pull extras until you recover.", ["readiness", "coachTrust"]],
      }),
    ],
  },
  {
    id: "vacation-return-delay",
    title: "Flight delay",
    contentVersion: 2,
    tags: ["life", "travel", "accountability"],
    eligibility: ["onLeave"],
    setup:
      "Your holiday return flight is disrupted before training resumes. " +
      "The staff need truth to protect the plan — and your place in it. " +
      "You choose transparency, negotiation, or concealment.",
    choices: [
      C("vacation-return-delay", "inform-club", "Inform the club and arrange the earliest safe return", "thoughtful", "routine", {
        positive: [2, "routine", "Transparency lets staff reshape your re-entry blocks; you miss nothing critical.", ["coachTrust", "readiness"]],
        neutral: ["routine", "Delay noted; session adjusted without drama."],
        negative: [-1, "routine", "You arrive tired from travel; load is trimmed but learning slows one day.", ["readiness"]],
      }),
      C("vacation-return-delay", "extra-leave", "Ask for approved extra leave", "balanced", "support", {
        positive: [1, "routine", "Club grants a short extension when the case is clear; you return with full recovery.", ["coachTrust", "readiness"]],
        neutral: ["routine", "Allowed once; do not make a habit of shifting the programme."],
        negative: [-1, "routine", "The ask is granted grudgingly; your extras shrink for a week.", ["coachTrust"]],
      }),
      C("vacation-return-delay", "hide-delay", "Hide the delay and hope nobody notices", "reckless", "routine", {
        positive: [1, "routine", "You scrape in unnoticed once — luck, not a process.", ["readiness"]],
        neutral: ["routine", "Questions linger; your plan for the week is unclear."],
        negative: [-3, "routine", "They notice. Trust drops and your structured return is replaced with fitness only.", ["coachTrust", "reputation"]],
      }),
    ],
  },
  {
    id: "travel-fatigue",
    title: "Long away trip",
    contentVersion: 2,
    tags: ["travel", "recovery"],
    eligibility: ["travelCongestion"],
    setup:
      "A long away trip leaves little time before the next game. " +
      "Your legs and your study time are both scarce. " +
      "You decide whether recovery, light prep, or nightlife wins the evening.",
    choices: [
      C("travel-fatigue", "recovery-schedule", "Follow the recovery schedule", "thoughtful", "routine", {
        positive: [2, "routine", "Sleep, fuel, and mobility keep readiness on track for the next tactical session.", ["readiness"]],
        neutral: ["routine", "Standard recovery; no heroics needed."],
        negative: [-1, "technique", "You follow the plan but skip five minutes of clip notes — minor gap.", ["readiness"]],
      }),
      C("travel-fatigue", "light-prep", "Use the evening for light preparation", "balanced", "technique", {
        positive: [2, "technique", "Twenty focused minutes on one pattern, then lights out — smart load.", ["readiness", "training"]],
        neutral: ["technique", "Short review, acceptable fatigue."],
        negative: [-1, "routine", "You stay up over clips and pay a mild freshness tax.", ["readiness"]],
      }),
      C("travel-fatigue", "explore-all-night", "Ignore rest to explore all night", "reckless", "routine", {
        positive: [1, "technique", "You see one opponent ground in person — trivia, not a substitute for sleep.", ["training"]],
        neutral: ["routine", "Tourist mode; programme on paper unchanged."],
        negative: [-3, "routine", "Heavy legs in the next session; staff question your professionalism.", ["readiness", "coachTrust"]],
      }),
    ],
  },
  {
    id: "airport-fan",
    title: "Airport fan",
    contentVersion: 2,
    tags: ["public", "reputation"],
    eligibility: ["any"],
    setup:
      "A young fan asks for a photo just as the squad is leaving. " +
      "Staff are watching the clock and your tone sets the example. " +
      "You balance kindness with the travel routine the team needs.",
    choices: [
      C("airport-fan", "ask-staff-time", "Ask staff if there's time for a quick photo", "thoughtful", "support", {
        positive: [2, "support", "Staff nod; one photo, warm goodbye, and you still hit the bus routine on time.", ["reputation", "morale"]],
        neutral: ["support", "No time after all — but you asked well and kept process."],
        negative: [-1, "routine", "The pause costs a minute of your mobility block at the hotel.", ["readiness"]],
      }),
      C("airport-fan", "polite-wave", "Politely explain and offer a wave", "balanced", "support", {
        positive: [2, "support", "Grace under hurry — good optics without breaking the travel schedule.", ["reputation"]],
        neutral: ["support", "Clean exit; ordinary day."],
        negative: [-1, "support", "The fan looks disappointed; you carry a small weight into activation.", ["morale"]],
      }),
      C("airport-fan", "lose-temper", "Lose your temper at the interruption", "reckless", "support", {
        positive: [1, "reputation", "A few online defenders — still not how you want to represent the group.", ["reputation"]],
        neutral: ["support", "Stress shows; training content unchanged."],
        negative: [-3, "support", "The clip is unkind; staff pull you aside and focus scatters for days.", ["reputation", "coachTrust", "morale"]],
      }),
    ],
  },
  {
    id: "sponsor-shoot",
    title: "Sponsor shoot",
    contentVersion: 2,
    tags: ["commercial", "schedule"],
    eligibility: ["any"],
    setup:
      "A sponsor wants a shoot during a demanding training week. " +
      "Commercial duty can coexist with preparation — or steal from it. " +
      "You decide timing and honesty with the club.",
    choices: [
      C("sponsor-shoot", "reschedule-agent", "Reschedule with your agent", "thoughtful", "routine", {
        positive: [2, "routine", "Timing moves; sacred pitch sessions stay intact and your role plan holds.", ["coachTrust", "training"]],
        neutral: ["routine", "Shoot slips a week; no harm to this week's habits."],
        negative: [-1, "reputation", "Brand mildly annoyed; you keep training priority anyway.", ["reputation"]],
      }),
      C("sponsor-shoot", "club-approved", "Accept if the club approves the timing", "balanced", "routine", {
        positive: [2, "routine", "Approved window — short, professional — and you still hit recovery targets.", ["reputation", "coachTrust"]],
        neutral: ["routine", "Done efficiently; ordinary training week."],
        negative: [-1, "routine", "Even approved, the shoot nibbles a recovery slot.", ["readiness"]],
      }),
      C("sponsor-shoot", "skip-training", "Skip training to attend without telling anyone", "reckless", "routine", {
        positive: [1, "reputation", "Brand content looks great — squad trust does not.", ["reputation"]],
        neutral: ["routine", "Absence noted late; programme patched without you."],
        negative: [-4, "routine", "You get pulled in. Trust, reputation, and your learning week all suffer.", ["coachTrust", "reputation", "morale"]],
      }),
    ],
  },
  {
    id: "charity-invitation",
    title: "Youth club visit",
    contentVersion: 2,
    tags: ["community", "reputation"],
    eligibility: ["any"],
    setup:
      "A local youth club invites you to a short visit. Your calendar is real — so is theirs. " +
      "Showing up well can reinforce who you are away from the spotlight; flaking costs more than an hour. " +
      "You pick how to honour the invite.",
    choices: [
      C("charity-invitation", "rest-day-visit", "Attend on a rest day", "thoughtful", "support", {
        positive: [2, "support", "An hour with kids refreshes perspective; you return to role work with clearer intent.", ["reputation", "morale", "training"]],
        neutral: ["reputation", "Good visit, ordinary week of preparation."],
        negative: [-1, "routine", "Travel eats a sliver of recovery; physio adjusts the next day.", ["readiness"]],
      }),
      C("charity-invitation", "video-message", "Send a thoughtful video message", "balanced", "support", {
        positive: [2, "support", "Feasible and genuine — they feel seen without costing a pitch session.", ["reputation", "morale"]],
        neutral: ["reputation", "Nice gesture without travel cost."],
        negative: [-1, "support", "Feels thin compared to a visit; you skip adding it to your community rhythm.", ["reputation"]],
      }),
      C("charity-invitation", "broken-promise", "Promise to come, then fail to follow through", "reckless", "support", {
        positive: [1, "support", "You send a late apology video — damage contained, not erased.", ["reputation"]],
        neutral: ["reputation", "Headlines quiet; local memory is not."],
        negative: [-3, "support", "Broken promise travels; guilt trims focus in your next technical block.", ["reputation", "morale"]],
      }),
    ],
  },
  {
    id: "social-media-mistake",
    title: "Rushed post",
    contentVersion: 2,
    tags: ["media", "accountability"],
    eligibility: ["any"],
    setup:
      "A rushed post is interpreted as criticism of your coach. The replies are already loud. " +
      "Fixing it is part of professional preparation — distraction steals learning time. " +
      "You choose how to respond.",
    choices: [
      C("social-media-mistake", "clarify-privately", "Clarify privately and correct it", "thoughtful", "role-learning", {
        positive: [2, "role-learning", "Direct talk clears the air; you return to positional homework with coach trust intact.", ["coachTrust", "training"]],
        neutral: ["role-learning", "Contained mistake; lesson logged, week ordinary."],
        negative: [-1, "role-learning", "Awkward tone lingers; you hesitate to ask for clip feedback.", ["coachTrust"]],
      }),
      C("social-media-mistake", "media-officer", "Ask the media officer for help", "balanced", "routine", {
        positive: [2, "routine", "Professionals frame a clean correction; you stay on the training schedule.", ["reputation", "coachTrust"]],
        neutral: ["reputation", "Statement issued; noise fades."],
        negative: [-1, "reputation", "Process slows; you miss a optional tactical Q&A.", ["training"]],
      }),
      C("social-media-mistake", "double-down", "Double down publicly", "reckless", "support", {
        positive: [1, "reputation", "Some fans amplify you — staff do not.", ["reputation"]],
        neutral: ["support", "Another post; preparation windows shrink to zero."],
        negative: [-4, "role-learning", "Staff shut it down hard; focus shatters and your development week is lost.", ["coachTrust", "morale"]],
      }),
    ],
  },
  {
    id: "veteran-mentor",
    title: "Veteran advice",
    contentVersion: 2,
    tags: ["training", "development"],
    eligibility: ["any"],
    setup:
      "An experienced teammate offers to review your positioning after training. " +
      "It is optional time, but their detail could become a habit you keep all season. " +
      "You decide whether to learn, defer, or shrug it off.",
    choices: [
      C("veteran-mentor", "review-clips", "Review clips and practice one change", "thoughtful", "technique", {
        positive: [3, "technique", "One clear positioning habit sticks after reps on the half-pitch; your role understanding jumps.", ["training"]],
        neutral: ["technique", "Interesting session; nothing dramatic yet on tape."],
        negative: [-1, "technique", "You try too much at once and the detail blurs in the next match.", ["training"]],
      }),
      C("veteran-mentor", "ask-later", "Ask for advice after the next session", "balanced", "role-learning", {
        positive: [2, "role-learning", "Follow-up happens with fresher legs; the tip lands in a live drill.", ["training"]],
        neutral: ["role-learning", "Good intention; timing slips once."],
        negative: [-1, "role-learning", "The moment passes and you fall back to old spacing habits.", ["training"]],
      }),
      C("veteran-mentor", "dismiss-advice", "Dismiss it because you know your game", "reckless", "role-learning", {
        positive: [1, "role-learning", "You stay unchanged — confident, not improved.", ["morale"]],
        neutral: ["role-learning", "You stay as you are; the learning door stays shut."],
        negative: [-2, "role-learning", "Closed ears cost you a cheap correction; veteran shrugs and shared study stops.", ["training", "support"]],
      }),
    ],
  },
  {
    id: "help-young-teammate",
    title: "New teammate",
    contentVersion: 2,
    tags: ["leadership", "support"],
    eligibility: ["any"],
    setup:
      "A new teammate struggles with the squad's routines and looks lost after training. " +
      "How the group learns together affects everyone's habits — including yours. " +
      "You choose whether to lift, escalate, or mock.",
    choices: [
      C("help-young-teammate", "help-settle", "Help them settle in", "thoughtful", "support", {
        positive: [3, "support", "You walk them through the daily rhythm; explaining it sharpens your own role discipline.", ["support", "coachTrust", "training"]],
        neutral: ["support", "A small kindness; ordinary week for your development."],
        negative: [-1, "routine", "You stay late helping and shorten your recovery block.", ["readiness"]],
      }),
      C("help-young-teammate", "ask-staff-support", "Ask staff to pair them with support", "balanced", "support", {
        positive: [2, "support", "You escalate help the right way; staff add structure that frees you for focused reps.", ["support", "coachTrust"]],
        neutral: ["support", "Process handles it; your plan unchanged."],
        negative: [-1, "support", "They wait days for pairing; you feel mildly responsible in meetings.", ["morale"]],
      }),
      C("help-young-teammate", "mock-mistake", "Mock the mistake in front of the group", "reckless", "support", {
        positive: [1, "support", "A few laugh — most remember who not to trust with questions.", ["reputation"]],
        neutral: ["support", "Awkward silence; learning environment unchanged for you."],
        negative: [-3, "support", "Cheap laugh, real damage; shared learning culture fractures.", ["support", "morale", "coachTrust"]],
      }),
    ],
  },
  {
    id: "selection-disappointment",
    title: "Left out",
    contentVersion: 2,
    tags: ["selection", "development"],
    eligibility: ["benched"],
    setup:
      "You are left out after expecting to start. The team sheet is already public. " +
      "Your response can open a learning conversation or burn trust. " +
      "The next days are still development time if you use them well.",
    choices: [
      C("selection-disappointment", "ask-feedback", "Ask for specific feedback", "thoughtful", "role-learning", {
        positive: [2, "role-learning", "Calm ask yields one actionable clip focus; you drill it in the next available session.", ["coachTrust", "training"]],
        neutral: ["role-learning", "Brief feedback — usable, not transformative."],
        negative: [-1, "role-learning", "Tone skews defensive; staff give generic answers.", ["coachTrust"]],
      }),
      C("selection-disappointment", "train-patiently", "Train well and respond patiently", "balanced", "routine", {
        positive: [2, "routine", "Professional standards in training keep the door open; habits stay match-ready.", ["coachTrust", "morale"]],
        neutral: ["routine", "Quiet week; no drama, no extra teaching."],
        negative: [-1, "technique", "You go through motions without targeting the reason you were out.", ["morale"]],
      }),
      C("selection-disappointment", "confront-coach", "Confront the coach angrily in public", "reckless", "support", {
        positive: [1, "morale", "Venting feels good for an hour — staff remember longer.", ["morale"]],
        neutral: ["support", "Scene dies down; your minutes picture stays the same."],
        negative: [-4, "role-learning", "Public confrontation closes feedback channels; you train without clear development targets.", ["coachTrust", "morale"]],
      }),
    ],
  },
  {
    id: "extra-session-or-rest",
    title: "Extra session temptation",
    contentVersion: 2,
    tags: ["training", "recovery"],
    eligibility: ["fixtureCongestion"],
    setup:
      "A tempting extra session falls between closely spaced games. " +
      "More work is not always more learning — load management is part of elite routine. " +
      "You decide whether to recover, ask for a sliver of work, or push through fatigue.",
    choices: [
      C("extra-session-or-rest", "planned-recovery", "Follow the planned recovery", "thoughtful", "routine", {
        positive: [2, "routine", "Discipline on rest keeps readiness for selection and lets quality reps stay quality.", ["readiness", "coachTrust"]],
        neutral: ["routine", "Ordinary recovery day."],
        negative: [-1, "technique", "You rest but skip mental prep; match details feel fuzzy.", ["readiness"]],
      }),
      C("extra-session-or-rest", "targeted-session", "Ask staff for a short targeted session", "ambitious", "technique", {
        positive: [2, "technique", "Approved ten minutes on one detail — smart load, clear gain.", ["training", "readiness"]],
        neutral: ["technique", "Staff trim it to something small; marginal learning."],
        negative: [-1, "routine", "Even short work adds fatigue before the next game.", ["readiness"]],
      }),
      C("extra-session-or-rest", "train-through-fatigue", "Train hard despite fatigue", "reckless", "routine", {
        positive: [1, "training", "Hero session adrenaline masks tired legs — gamble, not pattern.", ["training", "readiness"]],
        neutral: ["routine", "Hard work logged; programme risk unchanged on paper."],
        negative: [-3, "routine", "You look keen and arrive flat; coach pulls you from the next heavy day.", ["readiness", "coachTrust"]],
      }),
    ],
  },
  {
    id: "return-from-injury",
    title: "Return programme",
    contentVersion: 2,
    tags: ["rehab", "routine"],
    eligibility: ["returningFromInjury"],
    setup:
      "You are improving, but the agreed return programme is unfinished. " +
      "Skipping steps trades short-term excitement for long-term learning time lost. " +
      "You choose patience, dialogue, or concealment.",
    choices: [
      C("return-from-injury", "follow-programme", "Follow the programme", "thoughtful", "routine", {
        positive: [2, "routine", "Patience protects the return; each stage adds match-relevant load safely.", ["readiness", "coachTrust"]],
        neutral: ["routine", "Another solid rehab day on plan."],
        negative: [-1, "routine", "Frustration bubbles; you comply but focus wavers in the last sets.", ["morale"]],
      }),
      C("return-from-injury", "discuss-readiness", "Discuss your readiness with the physio and coach", "balanced", "role-learning", {
        positive: [2, "role-learning", "Honest check-in adjusts the plan slightly when earned — you learn where you truly are.", ["readiness", "coachTrust"]],
        neutral: ["role-learning", "Conversation clarifies expectations; no change today."],
        negative: [-1, "routine", "They hold the line; you accept but itch for more ball work.", ["morale"]],
      }),
      C("return-from-injury", "hide-symptoms", "Hide symptoms to try to start immediately", "reckless", "routine", {
        positive: [1, "technique", "You flash one good rep in a partial session — risk still outweighs reward.", ["training"]],
        neutral: ["routine", "Symptoms muted for a day; programme unchanged on paper."],
        negative: [-4, "routine", "Setback forces reset; weeks of structured learning vanish.", ["readiness", "coachTrust", "morale"]],
      }),
    ],
  },
  {
    id: "international-first-trip",
    title: "First national camp",
    contentVersion: 2,
    tags: ["national-team", "adaptation"],
    eligibility: ["nationalCallUp"],
    setup:
      "Your first national-team camp brings nerves and unfamiliar teammates. " +
      "Camp rhythms are different from club football, and adaptation speed matters. " +
      "You decide how to seek guidance, stay steady, or isolate.",
    choices: [
      C("international-first-trip", "ask-guidance", "Ask an experienced teammate for guidance", "thoughtful", "adaptation", {
        positive: [3, "adaptation", "A senior guide explains camp routines; you pick up the tactical language faster.", ["training", "morale"]],
        neutral: ["adaptation", "Small tips, modest calm."],
        negative: [-1, "adaptation", "You ask at the wrong moment and get brushed off — slower integration.", ["morale"]],
      }),
      C("international-first-trip", "focus-routines", "Focus on the routines and enjoy the occasion", "balanced", "routine", {
        positive: [2, "routine", "Presence without panic; you mirror sleep and meal habits and train cleanly.", ["morale", "coachTrust"]],
        neutral: ["routine", "Quiet debut-week energy."],
        negative: [-1, "technique", "You enjoy the occasion but skip extra positional study.", ["morale"]],
      }),
      C("international-first-trip", "isolate-overthink", "Stay isolated and overthink the selection", "reckless", "adaptation", {
        positive: [1, "technique", "Solo clip time helps a little — if you do not spiral.", ["training"]],
        neutral: ["adaptation", "Isolation; neither help nor harm on day one."],
        negative: [-3, "adaptation", "Overthinking costs sharpness in training games; staff give you time, not minutes.", ["morale", "readiness"]],
      }),
    ],
  },
  {
    id: "captain-pressure",
    title: "Lead this week",
    contentVersion: 2,
    tags: ["leadership", "communication"],
    eligibility: ["leadershipContext"],
    setup:
      "With senior leaders unavailable, the coach asks whether you can lead this week — not forever. " +
      "Leadership here means organising learning and calm, not speeches. " +
      "You accept, share, or centre yourself.",
    choices: [
      C("captain-pressure", "accept-calm", "Accept and keep communication calm", "thoughtful", "support", {
        positive: [3, "support", "Quiet leadership keeps meetings short and drills focused; the group learns efficiently.", ["coachTrust", "morale", "training"]],
        neutral: ["support", "Solid caretaker week."],
        negative: [-1, "support", "You accept but over-manage small details; energy dips in your own reps.", ["readiness"]],
      }),
      C("captain-pressure", "share-responsibility", "Ask an experienced teammate to share responsibility", "balanced", "support", {
        positive: [2, "support", "Shared load, clear voices — smart humility that keeps everyone's development on track.", ["support", "coachTrust"]],
        neutral: ["support", "Co-leadership works fine."],
        negative: [-1, "role-learning", "Roles blur once; your personal clip homework slips a night.", ["training"]],
      }),
      C("captain-pressure", "self-speech", "Turn it into a speech about yourself", "reckless", "support", {
        positive: [1, "reputation", "Some remember the speech — not the standards you set after.", ["reputation"]],
        neutral: ["support", "Awkward room; training content unchanged."],
        negative: [-3, "support", "Ego first; trust dips and the group stops asking you for clarity.", ["coachTrust", "support", "morale"]],
      }),
    ],
  },
];
