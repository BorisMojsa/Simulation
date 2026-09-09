import { pickRandomBackstory } from "../data/careerBackstories.js";
import { pickScenariosForPosition } from "../data/careerOpeningScenarios.js";
import { pickThreeAcademies, buildNarrativeAcademySeason } from "../simulation/narrativeAcademySeason.js";
import {
  applyOpeningChoiceDelta,
  finalizeAcademyPlayer,
  promoteAcademyGraduateToFirstTeam,
} from "../simulation/playerDevelopment.js";
import { pickRandom } from "../utils/helpers.js";

const FALLBACK_SCENARIO = {
  setup:
    "A tight training match is tied. You have the ball on the edge of the box with little time. What's the play?",
  choices: [
    { label: "Lay it off for a teammate", minDelta: -1, maxDelta: 2 },
    { label: "Go for goal yourself", minDelta: -2, maxDelta: 4 },
    { label: "Recycle possession and reset", minDelta: -1, maxDelta: 1 },
  ],
  outcomes: [
    ["Simple football — coach likes it.", "The pass is under-hit but you recover."],
    ["The net ripples — big noise from the sideline.", "The keeper stands tall — no goal."],
    ["Tempo settles — next chance will come.", "Some groans, but no harm done."],
  ],
};

function hideAllCareerSteps(overlayEl) {
  overlayEl.querySelectorAll(".career-step").forEach((el) => {
    el.classList.add("hidden");
    el.classList.remove("active");
  });
}

function showStep(overlayEl, id) {
  hideAllCareerSteps(overlayEl);
  const step = document.getElementById(id);
  if (step) {
    step.classList.remove("hidden");
    step.classList.add("active");
  }
}

function ensureScenarioList(position, count) {
  let list = pickScenariosForPosition(position, count);
  while (list.length < count) {
    list = [...list, { ...FALLBACK_SCENARIO }];
  }
  return list.slice(0, count);
}

function careerIntroDomReady() {
  const ids = [
    "career-start-overlay",
    "career-step-backstory",
    "career-backstory-text",
    "career-backstory-next",
    "career-step-academy",
    "career-academy-grid",
    "career-academy-lead",
    "career-step-rating",
    "career-rating-value",
    "career-rating-next",
    "career-step-scenario",
    "career-scenario-index",
    "career-scenario-setup",
    "career-scenario-choices",
    "career-scenario-outcome",
    "career-scenario-next",
    "career-step-year-end",
    "career-year-end-title",
    "career-year-end-body",
    "career-year-end-continue",
  ];
  return ids.every((id) => document.getElementById(id) != null);
}

/**
 * If the intro overlay cannot run (missing DOM / file:// module issues handled elsewhere),
 * still produce a playable first year so the game never dead-ends.
 */
export function skipCareerIntroBootstrap(player, academyPool) {
  const picks = pickThreeAcademies(academyPool);
  if (!picks.length) {
    throw new Error("Academy pool is empty — check league data.");
  }
  finalizeAcademyPlayer(player, picks[0]);
  const ratingStart = player.rating;
  player.age = 17;
  const season = buildNarrativeAcademySeason(player, ratingStart, player.rating);
  player.seasons.push(season);
  player.careerTotals.matches += season.matches;
  player.careerTotals.goals += season.goals;
  player.careerTotals.assists += season.assists;
  player.careerTotals.cleanSheets += season.cleanSheets;
  player.latestStanding = null;
  player.careerIntroComplete = true;
  promoteAcademyGraduateToFirstTeam(player, 72);
}

export function runCareerStartFlow({ player, academyPool, setupSectionEl, onComplete }) {
  const overlay = document.getElementById("career-start-overlay");

  if (!overlay || !careerIntroDomReady()) {
    console.warn("[Career] Intro overlay or required nodes missing — using bootstrap path.");
    try {
      skipCareerIntroBootstrap(player, academyPool);
      setupSectionEl?.classList.add("hidden");
      onComplete();
    } catch (e) {
      console.error(e);
      throw e;
    }
    return;
  }

  const backstory = pickRandomBackstory({
    name: player.name,
    nationality: player.nationality,
  });
  const academies = pickThreeAcademies(academyPool);
  if (!academies.length) {
    skipCareerIntroBootstrap(player, academyPool);
    setupSectionEl?.classList.add("hidden");
    onComplete();
    return;
  }

  const scenarios = ensureScenarioList(player.position, 3);

  let ratingAfterAcademyPick = 0;
  let scenarioIndex = 0;

  const outcomeEl = document.getElementById("career-scenario-outcome");
  const nextScenarioBtn = document.getElementById("career-scenario-next");
  const choicesEl = document.getElementById("career-scenario-choices");

  function bindScenarioStep() {
    if (!outcomeEl || !nextScenarioBtn || !choicesEl) return;
    outcomeEl.classList.add("hidden");
    outcomeEl.textContent = "";
    nextScenarioBtn.classList.add("hidden");
    choicesEl.innerHTML = "";

    const sc = scenarios[scenarioIndex];
    if (!sc) {
      finishNarrativeYear();
      return;
    }

    document.querySelector(".career-scenario-preface")?.classList.toggle("hidden", scenarioIndex > 0);

    const idxEl = document.getElementById("career-scenario-index");
    const setupEl = document.getElementById("career-scenario-setup");
    if (idxEl) idxEl.textContent = `Moment ${scenarioIndex + 1} of 3`;
    if (setupEl) setupEl.textContent = sc.setup;

    sc.choices.forEach((choice, idx) => {
      const btn = document.createElement("button");
      btn.className = "primary career-choice-btn";
      btn.type = "button";
      btn.textContent = choice.label;
      btn.addEventListener("click", () => {
        const delta = applyOpeningChoiceDelta(player, choice.minDelta, choice.maxDelta, {
          min: 50,
          max: 76,
        });
        const lines = sc.outcomes[idx] || ["The moment passes."];
        outcomeEl.textContent = pickRandom(lines);
        outcomeEl.classList.remove("hidden");
        choicesEl.innerHTML = "";
        const deltaNote = document.createElement("p");
        deltaNote.className = "career-delta-note";
        deltaNote.textContent =
          delta >= 0
            ? `Overall ${delta > 0 ? `+${delta}` : "unchanged"} — coaches adjust their read on you.`
            : `Overall ${delta} — a harsh lesson, but part of the game.`;
        choicesEl.appendChild(deltaNote);
        nextScenarioBtn.classList.remove("hidden");
      });
      choicesEl.appendChild(btn);
    });
  }

  function showRatingRevealThenFinishSetup() {
    const rv = document.getElementById("career-rating-value");
    if (rv) rv.textContent = String(player.rating);
    showStep(overlay, "career-step-rating");
  }

  nextScenarioBtn.onclick = () => {
    scenarioIndex += 1;
    if (scenarioIndex < scenarios.length) {
      bindScenarioStep();
    } else {
      showRatingRevealThenFinishSetup();
    }
  };

  function finishNarrativeYear() {
    player.age = 17;
    const season = buildNarrativeAcademySeason(player, ratingAfterAcademyPick, player.rating);
    player.seasons.push(season);
    player.careerTotals.matches += season.matches;
    player.careerTotals.goals += season.goals;
    player.careerTotals.assists += season.assists;
    player.careerTotals.cleanSheets += season.cleanSheets;
    player.latestStanding = null;

    const seniorName = promoteAcademyGraduateToFirstTeam(player, 72);
    const titleEl = document.getElementById("career-year-end-title");
    const bodyEl = document.getElementById("career-year-end-body");
    if (titleEl) titleEl.textContent = "Professional contract";
    if (bodyEl) {
      const clubLabel = seniorName ?? player.club?.displayName ?? player.club?.name ?? "the first team";
      bodyEl.textContent =
        `${clubLabel} offer you a senior professional contract. Your time in the academy was the opening chapter — ` +
        `from here you play for the first team. Head to the career hub to continue your story.`;
    }

    showStep(overlay, "career-step-year-end");
  }

  const continueBtn = document.getElementById("career-year-end-continue");
  if (continueBtn) {
    continueBtn.onclick = () => {
      overlay.classList.add("hidden");
      player.careerIntroComplete = true;
      onComplete();
    };
  }

  const backstoryText = document.getElementById("career-backstory-text");
  const backstoryNext = document.getElementById("career-backstory-next");
  if (backstoryText) backstoryText.textContent = backstory;
  if (backstoryNext) {
    backstoryNext.onclick = () => {
      showStep(overlay, "career-step-academy");
      const grid = document.getElementById("career-academy-grid");
      const lead = document.getElementById("career-academy-lead");
      if (!grid) return;
      grid.innerHTML = "";
      if (lead) {
        lead.textContent =
          "Three academies want a closer look. Pick where your first chapter is written.";
      }

      academies.forEach((ac) => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "career-academy-card";
        const parent = ac.parentClub;
        const badge = ac.badge
          ? `<img src="${ac.badge}" alt="" class="career-academy-badge" loading="lazy" />`
          : "";
        card.innerHTML = `
        ${badge}
        <span class="career-academy-name">${ac.displayName ?? ac.name}</span>
        <span class="career-academy-league">${ac.leagueDisplay ?? ac.league}</span>
        <span class="career-academy-parent">Senior side: ${parent?.displayName ?? parent?.name ?? "?"}</span>
      `;
        card.addEventListener("click", () => {
          finalizeAcademyPlayer(player, ac);
          ratingAfterAcademyPick = player.rating;
          scenarioIndex = 0;
          showStep(overlay, "career-step-scenario");
          bindScenarioStep();
        });
        grid.appendChild(card);
      });
    };
  }

  const ratingNext = document.getElementById("career-rating-next");
  if (ratingNext) {
    ratingNext.onclick = () => {
      finishNarrativeYear();
    };
  }

  setupSectionEl?.classList.add("hidden");
  overlay.classList.remove("hidden");
  showStep(overlay, "career-step-backstory");
}
