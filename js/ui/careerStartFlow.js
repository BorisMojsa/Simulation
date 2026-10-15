import { pickRandomBackstory } from "../data/careerBackstories.js";
import { buildAcademyIntro } from "../data/academyOfferStories.js";
import { pickScenariosForPosition } from "../data/careerOpeningScenarios.js?v=76";
import {
  pickThreeAcademies,
  buildNarrativeAcademySeason,
} from "../simulation/narrativeAcademySeason.js?v=76";
import {
  finalizeAcademyPlayer,
  applySkipOpeningDevelopment,
} from "../simulation/playerDevelopment.js?v=76";
import {
  ACADEMY_OPENING,
  advanceOpeningCursor,
  applyOpeningMoment,
  ensureAcademyOpeningState,
  finalizeAcademyOpening,
  getOpeningScenarios,
  rollOpeningChoiceResult,
} from "../simulation/academyOpening.js?v=76";
import { createStreamRng } from "../simulation/rng.js?v=76";
import { stableCareerId } from "../simulation/playerDevelopmentModel.js?v=76";
import {
  buildFirstProContractDecision,
  signFirstProfessionalContract,
} from "../simulation/proContractOffers.js?v=76";
import { escapeHtml, formatCurrency } from "../utils/helpers.js";
import {
  formatAbilityDisplayChange,
  formatAbilityForDisplay,
  roundAbilityForDisplay,
} from "./abilityFormatting.js";

const ACADEMY_MOMENT_COUNT = ACADEMY_OPENING.momentCount;

const FALLBACK_SCENARIO = {
  setup:
    "A tight training match is tied. You have the ball on the edge of the box with little time. What's the play?",
  choices: [
    {
      label: "Lay it off for a teammate",
      results: [
        { delta: 2, text: "Simple football. Coach likes the decision." },
        { delta: 1, text: "Clean link. Attack continues." },
        { delta: 0, text: "Under-hit, but you recover." },
        { delta: -1, text: "Interception. Lesson in weight of pass." },
      ],
    },
    {
      label: "Go for goal yourself",
      results: [
        { delta: 3, text: "The net ripples. Big noise from the sideline." },
        { delta: 2, text: "Forces a strong save. Technique noted." },
        { delta: 1, text: "Close. Confidence registered." },
        { delta: 0, text: "Row Z. Bold intent still counted." },
        { delta: -1, text: "Snatched. Reminder to stay composed." },
      ],
    },
    {
      label: "Recycle possession and reset",
      results: [
        { delta: 1, text: "Tempo settles. Next chance will come." },
        { delta: 0, text: "Patient. Chance fades without damage." },
        { delta: -1, text: "Too safe. Pressure builds the other way." },
      ],
    },
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

function ensureScenarioList(position, count, rng = null) {
  let list = pickScenariosForPosition(position, count, rng);
  while (list.length < count) {
    list = [...list, structuredClone(FALLBACK_SCENARIO)];
  }
  return list.slice(0, count);
}

function updateLiveOverall(player, { flashDelta = null } = {}) {
  const el = document.getElementById("career-scenario-ovr");
  if (!el) return;
  el.textContent = formatAbilityForDisplay(player.rating);
  el.classList.remove("is-up", "is-down", "is-flash");
  if (flashDelta > 0) el.classList.add("is-up", "is-flash");
  else if (flashDelta < 0) el.classList.add("is-down", "is-flash");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runStaggeredReveal(root, selectors) {
  if (!root) return;
  const pieces = selectors
    .map((sel) => root.querySelector(sel))
    .filter(Boolean);
  pieces.forEach((el) => {
    el.classList.remove("is-shown");
    el.classList.add("career-reveal-piece");
  });
  // force style flush
  void root.offsetWidth;
  for (const el of pieces) {
    el.classList.add("is-shown");
    await wait(520);
  }
}

function animateCountUp(el, target, durationMs = 1600) {
  return new Promise((resolve) => {
    if (!el) {
      resolve();
      return;
    }
    const end = roundAbilityForDisplay(target) ?? 0;
    const start = performance.now();
    const from = Math.max(40, end - 12);
    function frame(now) {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = String(Math.round(from + (end - from) * eased));
      if (t < 1) requestAnimationFrame(frame);
      else {
        el.textContent = formatAbilityForDisplay(end);
        el.classList.add("career-rating-landed");
        resolve();
      }
    }
    el.classList.remove("career-rating-landed");
    requestAnimationFrame(frame);
  });
}

function careerIntroDomReady() {
  const ids = [
    "career-start-overlay",
    "career-step-backstory",
    "career-backstory-text",
    "career-backstory-next",
    "career-step-academy",
    "career-academy-intro",
    "career-academy-intro-text",
    "career-academy-intro-next",
    "career-academy-reveal",
    "career-academy-offer-index",
    "career-academy-arrival",
    "career-academy-feature",
    "career-academy-pitch",
    "career-academy-next-offer",
    "career-academy-choice",
    "career-academy-grid",
    "career-academy-lead",
    "career-step-rating",
    "career-rating-value",
    "career-rating-lead",
    "career-rating-after",
    "career-rating-next",
    "career-step-pro-deals",
    "career-pro-deals-title",
    "career-pro-deals-lead",
    "career-pro-deals-grid",
    "career-step-scenario",
    "career-scenario-index",
    "career-scenario-setup",
    "career-scenario-choices",
    "career-scenario-outcome",
    "career-scenario-next",
    "career-scenario-ovr",
    "career-step-year-end",
    "career-year-end-title",
    "career-year-end-body",
    "career-year-end-continue",
  ];
  return ids.every((id) => document.getElementById(id) != null);
}

function renderOfferCard(offer, { selectable = false } = {}) {
  const ac = offer.academy;
  const parent = ac.parentClub;
  const badge = ac.badge
    ? `<img src="${escapeHtml(ac.badge)}" alt="" class="career-academy-badge" loading="lazy" />`
    : "";
  const abroadTag = offer.isHome
    ? `<span class="career-academy-tag">Home pathway</span>`
    : `<span class="career-academy-tag is-abroad">Abroad pathway</span>`;
  const el = document.createElement(selectable ? "button" : "div");
  if (selectable) {
    el.type = "button";
    el.className = "career-academy-card";
  } else {
    el.className = "career-academy-card career-academy-card-feature";
  }
  el.innerHTML = `
    <div class="career-academy-badge-wrap">${badge}</div>
    ${abroadTag}
    <span class="career-academy-name">${escapeHtml(ac.displayName ?? ac.name)}</span>
    <span class="career-academy-league">${escapeHtml(ac.leagueDisplay ?? ac.league)}</span>
    <span class="career-academy-parent">Senior side: ${escapeHtml(parent?.displayName ?? parent?.name ?? "?")}</span>
  `;
  return el;
}

function kindLabel(kind) {
  if (kind === "parent") return "Academy pathway";
  if (kind === "rival") return "Rival interest";
  return "Counter offer";
}

/**
 * If the intro overlay cannot run, still produce a playable first year.
 */
export function skipCareerIntroBootstrap(player, academyPool) {
  const picks = pickThreeAcademies(academyPool, player.nationality, player.name);
  if (!picks.length) {
    throw new Error("Academy pool is empty. check league data.");
  }
  finalizeAcademyPlayer(player, picks[0].academy);
  const ratingStart = player.rating;
  applySkipOpeningDevelopment(player);
  const season = buildNarrativeAcademySeason(player, ratingStart, player.rating);
  player.seasons.push(season);
  player.careerTotals.matches += season.matches;
  player.careerTotals.goals += season.goals;
  player.careerTotals.assists += season.assists;
  player.careerTotals.cleanSheets += season.cleanSheets;
  player.latestStanding = null;
  player.careerIntroComplete = true;
  const decision = buildFirstProContractDecision(player);
  if (decision.offers[0]) {
    signFirstProfessionalContract(player, decision.offers[0]);
  } else {
    // Deterministic continuation: remain on academy pathway without inventing eligibility.
    player.suppressParentContractOffer = true;
    player.pendingOffers = [];
  }
}

export function runCareerStartFlow({ player, academyPool, setupSectionEl, onComplete }) {
  const overlay = document.getElementById("career-start-overlay");

  if (!overlay || !careerIntroDomReady()) {
    console.warn("[Career] Intro overlay or required nodes missing. using bootstrap path.");
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
  const offers = pickThreeAcademies(academyPool, player.nationality, player.name);
  if (!offers.length) {
    skipCareerIntroBootstrap(player, academyPool);
    setupSectionEl?.classList.add("hidden");
    onComplete();
    return;
  }

  let ratingAfterAcademyPick = 0;
  let scenarioIndex = 0;
  let offerIndex = 0;
  let revealToken = 0;
  let momentLocked = false;

  const outcomeEl = document.getElementById("career-scenario-outcome");
  const nextScenarioBtn = document.getElementById("career-scenario-next");
  const choicesEl = document.getElementById("career-scenario-choices");

  function chooseAcademy(offer) {
    finalizeAcademyPlayer(player, offer.academy);
    ratingAfterAcademyPick = player.rating;
    const scenarioRng = createStreamRng(stableCareerId(player), ACADEMY_OPENING.streams.scenarios);
    const picked = ensureScenarioList(player.position, ACADEMY_MOMENT_COUNT, scenarioRng);
    ensureAcademyOpeningState(player, { scenarios: picked, rng: scenarioRng });
    scenarioIndex = player.academyOpening?.cursor || 0;
    momentLocked = false;
    updateLiveOverall(player);
    showStep(overlay, "career-step-scenario");
    bindScenarioStep();
  }

  function showOfferChoice() {
    const intro = document.getElementById("career-academy-intro");
    const reveal = document.getElementById("career-academy-reveal");
    const choice = document.getElementById("career-academy-choice");
    const grid = document.getElementById("career-academy-grid");
    const lead = document.getElementById("career-academy-lead");
    intro?.classList.add("hidden");
    reveal?.classList.add("hidden");
    choice?.classList.remove("hidden");
    if (lead) {
      lead.textContent = "Three doors are open. Pick where the first chapter is written.";
    }
    if (!grid) return;
    grid.innerHTML = "";
    offers.forEach((offer, i) => {
      const card = renderOfferCard(offer, { selectable: true });
      card.style.setProperty("--reveal-delay", `${i * 180}ms`);
      card.classList.add("career-academy-card-stagger");
      card.addEventListener("click", () => chooseAcademy(offer));
      grid.appendChild(card);
      requestAnimationFrame(() => card.classList.add("is-shown"));
    });
  }

  async function showOfferReveal(index) {
    const token = ++revealToken;
    const intro = document.getElementById("career-academy-intro");
    const reveal = document.getElementById("career-academy-reveal");
    const choice = document.getElementById("career-academy-choice");
    const offer = offers[index];
    if (!offer) {
      showOfferChoice();
      return;
    }

    intro?.classList.add("hidden");
    choice?.classList.add("hidden");
    reveal?.classList.remove("hidden");

    const idxEl = document.getElementById("career-academy-offer-index");
    const arrivalEl = document.getElementById("career-academy-arrival");
    const featureEl = document.getElementById("career-academy-feature");
    const pitchEl = document.getElementById("career-academy-pitch");
    const nextBtn = document.getElementById("career-academy-next-offer");

    if (idxEl) idxEl.textContent = `Offer ${index + 1} of ${offers.length}`;
    if (arrivalEl) arrivalEl.textContent = offer.arrivalStory;
    if (pitchEl) pitchEl.textContent = offer.pitch;
    if (featureEl) {
      featureEl.innerHTML = "";
      const card = renderOfferCard(offer, { selectable: false });
      featureEl.appendChild(card);
    }
    if (nextBtn) {
      nextBtn.classList.add("hidden");
      nextBtn.disabled = true;
      nextBtn.textContent = index < offers.length - 1 ? "Next offer" : "Compare all three";
      nextBtn.onclick = () => {
        offerIndex = index + 1;
        if (offerIndex < offers.length) showOfferReveal(offerIndex);
        else showOfferChoice();
      };
    }

    await runStaggeredReveal(reveal, [
      "#career-academy-offer-index",
      "#career-academy-arrival",
      "#career-academy-feature",
      "#career-academy-pitch",
    ]);
    if (token !== revealToken) return;
    const card = featureEl?.querySelector(".career-academy-card-feature");
    card?.classList.add("career-academy-enter");
    await wait(380);
    if (token !== revealToken) return;
    if (nextBtn) {
      nextBtn.classList.remove("hidden");
      nextBtn.classList.add("is-shown");
      nextBtn.disabled = false;
    }
  }

  function startAcademyOfferFlow() {
    showStep(overlay, "career-step-academy");
    const intro = document.getElementById("career-academy-intro");
    const reveal = document.getElementById("career-academy-reveal");
    const choice = document.getElementById("career-academy-choice");
    const introText = document.getElementById("career-academy-intro-text");
    intro?.classList.remove("hidden");
    reveal?.classList.add("hidden");
    choice?.classList.add("hidden");
    if (introText) {
      introText.textContent = buildAcademyIntro({
        name: player.name,
        nationality: player.nationality,
      });
      introText.classList.remove("is-shown");
      requestAnimationFrame(() => introText.classList.add("career-reveal-piece", "is-shown"));
    }
    offerIndex = 0;
  }

  function bindScenarioStep() {
    if (!outcomeEl || !nextScenarioBtn || !choicesEl) return;
    momentLocked = false;
    outcomeEl.classList.add("hidden");
    outcomeEl.textContent = "";
    nextScenarioBtn.classList.add("hidden");
    choicesEl.innerHTML = "";
    updateLiveOverall(player);

    const scenarios = getOpeningScenarios(player);
    scenarioIndex = player.academyOpening?.cursor ?? scenarioIndex;
    const sc = scenarios[scenarioIndex];
    if (!sc) {
      showRatingRevealThenFinishSetup();
      return;
    }

    document.querySelector(".career-scenario-preface")?.classList.toggle("hidden", scenarioIndex > 0);

    const idxEl = document.getElementById("career-scenario-index");
    const setupEl = document.getElementById("career-scenario-setup");
    if (idxEl) idxEl.textContent = `Moment ${scenarioIndex + 1} of ${ACADEMY_MOMENT_COUNT}`;
    if (setupEl) setupEl.textContent = sc.setup;

    const orderRng = createStreamRng(
      stableCareerId(player),
      `${ACADEMY_OPENING.streams.scenarios}:order:${sc.id}`
    );
    const orderedChoices = orderRng.shuffle([...(sc.choices || [])]);

    orderedChoices.forEach((choice) => {
      const btn = document.createElement("button");
      btn.className = "primary career-choice-btn";
      btn.type = "button";
      btn.textContent = choice.label;
      btn.addEventListener("click", () => {
        if (momentLocked) return;
        momentLocked = true;
        choicesEl.querySelectorAll("button").forEach((b) => {
          b.disabled = true;
        });

        const result = rollOpeningChoiceResult(player, choice, { momentIndex: scenarioIndex });
        const applied = applyOpeningMoment(player, {
          scenario: sc,
          choice,
          outcome: result,
          momentIndex: scenarioIndex,
        });
        const boardDelta = (applied.displayedAfter ?? 0) - (applied.displayedBefore ?? 0);
        updateLiveOverall(player, { flashDelta: boardDelta });

        const chosen = document.createElement("p");
        chosen.className = "career-choice-selected";
        chosen.textContent = `You chose: ${choice.label}`;
        outcomeEl.textContent = applied.feedback?.prose || result.text;
        outcomeEl.classList.remove("hidden");
        choicesEl.innerHTML = "";
        choicesEl.appendChild(chosen);

        const deltaNote = document.createElement("p");
        deltaNote.className = "career-delta-note";
        if (boardDelta > 0) deltaNote.classList.add("is-up");
        else if (boardDelta < 0) deltaNote.classList.add("is-down");
        else if ((applied.realizedRaw || 0) > 0.03) deltaNote.classList.add("is-progress");
        deltaNote.textContent =
          applied.feedback?.changeNote ||
          `Overall ${formatAbilityDisplayChange(applied.rawBefore, applied.rawAfter, "unchanged")}. Now ${formatAbilityForDisplay(player.rating)}.`;
        choicesEl.appendChild(deltaNote);
        nextScenarioBtn.classList.remove("hidden");
      });
      choicesEl.appendChild(btn);
    });
  }

  async function showRatingRevealThenFinishSetup() {
    finalizeAcademyOpening(player);
    updateLiveOverall(player);
    const rv = document.getElementById("career-rating-value");
    const lead = document.getElementById("career-rating-lead");
    const after = document.getElementById("career-rating-after");
    const next = document.getElementById("career-rating-next");
    if (lead) lead.textContent = "The board reads your academy year in silence.";
    if (rv) rv.textContent = "—";
    after?.classList.add("hidden");
    next?.classList.add("hidden");
    showStep(overlay, "career-step-rating");
    await wait(700);
    await animateCountUp(rv, player.rating, 1700);
    await wait(450);
    if (after) {
      after.textContent =
        player.rating >= 70
          ? "The room shifts. Someone is already on the phone."
          : player.rating >= 62
            ? "Notes are exchanged. A decision is forming upstairs."
            : "Faces stay careful. Not every academy year ends with a senior deal.";
      after.classList.remove("hidden");
      after.classList.add("career-reveal-piece", "is-shown");
    }
    await wait(500);
    next?.classList.remove("hidden");
  }

  nextScenarioBtn.onclick = () => {
    advanceOpeningCursor(player);
    scenarioIndex = player.academyOpening?.cursor ?? scenarioIndex + 1;
    const scenarios = getOpeningScenarios(player);
    if (scenarioIndex < scenarios.length) {
      bindScenarioStep();
    } else {
      showRatingRevealThenFinishSetup();
    }
  };

  function pushAcademySeason() {
    const season = buildNarrativeAcademySeason(player, ratingAfterAcademyPick, player.rating);
    player.seasons.push(season);
    player.careerTotals.matches += season.matches;
    player.careerTotals.goals += season.goals;
    player.careerTotals.assists += season.assists;
    player.careerTotals.cleanSheets += season.cleanSheets;
    player.latestStanding = null;
  }

  function showProDealStep() {
    pushAcademySeason();
    const decision = buildFirstProContractDecision(player);
    const titleEl = document.getElementById("career-pro-deals-title");
    const leadEl = document.getElementById("career-pro-deals-lead");
    const grid = document.getElementById("career-pro-deals-grid");
    if (titleEl) titleEl.textContent = decision.verdict.headline;
    if (leadEl) {
      leadEl.textContent = decision.emptyOffers
        ? `${decision.verdict.lead} Overall ${formatAbilityForDisplay(decision.rating)}.`
        : `${decision.verdict.lead} Overall ${formatAbilityForDisplay(
            decision.rating
          )}. Choose where you sign.`;
    }
    if (grid) {
      grid.innerHTML = "";
      if (decision.emptyOffers || !decision.offers.length) {
        const cont = document.createElement("button");
        cont.type = "button";
        cont.className = "career-pro-deal-card is-counter";
        cont.innerHTML = `
          <span class="career-academy-tag">Continue</span>
          <span class="career-academy-name">Stay in the system</span>
          <span class="career-pro-deal-blurb">${escapeHtml(
            "No suitable senior contract passed sporting and financial checks. You can continue developing and wait for a fitting offer — the game will not invent an elite deal."
          )}</span>
        `;
        cont.addEventListener("click", () => {
          // Keep academy registration; usable continuation.
          player.suppressParentContractOffer = true;
          player.pendingOffers = [];
          const titleEl = document.getElementById("career-year-end-title");
          const bodyEl = document.getElementById("career-year-end-body");
          if (titleEl) titleEl.textContent = "Patience in the academy";
          if (bodyEl) {
            bodyEl.textContent =
              "No professional contract was signed today. You remain with the academy pathway and can chase a suitable deal later.";
          }
          showStep(overlay, "career-step-year-end");
        });
        grid.appendChild(cont);
        requestAnimationFrame(() => cont.classList.add("is-shown"));
      } else {
        decision.offers.forEach((deal, i) => {
          const card = document.createElement("button");
          card.type = "button";
          card.className = `career-pro-deal-card is-${deal.kind}`;
          card.style.setProperty("--reveal-delay", `${120 + i * 160}ms`);
          const club = deal.club;
          const badge = club.badge
            ? `<img src="${escapeHtml(club.badge)}" alt="" class="career-academy-badge" loading="lazy" />`
            : "";
          const wageLine =
            deal.wage != null
              ? ` · ${formatCurrency(deal.wage)}/wk gross`
              : "";
          const roleLine = deal.expectedRole ? ` · ${deal.expectedRole}` : "";
          card.innerHTML = `
            <span class="career-academy-tag">${escapeHtml(kindLabel(deal.kind))}</span>
            <div class="career-academy-badge-wrap">${badge}</div>
            <span class="career-academy-name">${escapeHtml(club.displayName ?? club.name)}</span>
            <span class="career-academy-league">${escapeHtml(club.leagueDisplay ?? club.league)}</span>
            <span class="career-pro-deal-blurb">${escapeHtml(deal.blurb)}</span>
            <span class="career-pro-deal-meta">${deal.contractYears}-year professional contract${wageLine}${roleLine}</span>
          `;
          card.addEventListener("click", () => acceptProDeal(deal));
          grid.appendChild(card);
          requestAnimationFrame(() => card.classList.add("is-shown"));
        });
      }
    }
    showStep(overlay, "career-step-pro-deals");
  }

  function acceptProDeal(deal) {
    const result = signFirstProfessionalContract(player, deal);
    const titleEl = document.getElementById("career-year-end-title");
    const bodyEl = document.getElementById("career-year-end-body");
    if (!result?.ok) {
      if (titleEl) titleEl.textContent = "Contract not available";
      if (bodyEl) {
        bodyEl.textContent =
          "That professional contract could not be completed under the club's wage and recruitment limits. " +
          "You remain at the academy and can continue training or wait for another offer.";
      }
      showStep(overlay, "career-step-year-end");
      return;
    }
    const signedName = result.clubName;
    if (titleEl) {
      titleEl.textContent =
        deal.kind === "rival" ? "A crossing of lines" : "Professional contract signed";
    }
    if (bodyEl) {
      const clubLabel = signedName ?? "the first team";
      if (deal.kind === "rival") {
        bodyEl.textContent =
          `You sign with ${clubLabel}. The academy you left will not forget the move. ` +
          `From here you play senior football. Head to the career hub to continue.`;
      } else if (deal.kind === "parent") {
        bodyEl.textContent =
          `${clubLabel} put pen to paper with you. The academy chapter closes on home turf. ` +
          `From here you play for the first team.`;
      } else {
        bodyEl.textContent =
          `You take the counter offer from ${clubLabel}. A new dressing room, a new start. ` +
          `From here you play senior football.`;
      }
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
    backstoryNext.onclick = () => startAcademyOfferFlow();
  }

  const introNext = document.getElementById("career-academy-intro-next");
  if (introNext) {
    introNext.onclick = () => showOfferReveal(0);
  }

  const ratingNext = document.getElementById("career-rating-next");
  if (ratingNext) {
    ratingNext.onclick = () => showProDealStep();
  }

  setupSectionEl?.classList.add("hidden");
  overlay.classList.remove("hidden");
  showStep(overlay, "career-step-backstory");
}
