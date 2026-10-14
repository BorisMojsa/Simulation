import { STATS_KEYS } from "./js/config/playerConfig.js";
import { ACADEMY_POOL, LEAGUES, LEAGUE_LOOKUP } from "./js/data/leagues.js?v=61";
import { WORLD_CUP_NATIONS, flagUrl } from "./js/data/worldCupNations.js";
import { createPlayerIdentity, promoteAcademyGraduateToFirstTeam } from "./js/simulation/playerDevelopment.js?v=77";
import { getDisplayAttributeKeys, refreshAbilityCaches } from "./js/simulation/playerAbility.js?v=61";
import { generateTransferOffers } from "./js/simulation/transferMarket.js?v=62";
import { acceptPipelineOffer } from "./js/simulation/dealPipeline.js?v=62";
import { startLoan, endLoan } from "./js/simulation/loanMarket.js?v=63";
import { queueSquadDecision, resolveSquadDecision } from "./js/simulation/squadDecisions.js?v=77";
import { ensureTransferSave } from "./js/simulation/transferMigration.js?v=62";
import { simulateSeason } from "./js/simulation/seasonSimulator.js?v=77";
import { createWorldState, setWorldState } from "./js/simulation/worldState.js?v=61";
import { buildLiveLoanBrowserFixture } from "./js/simulation/liveLoanBrowserFixture.js?v=77";
import {
  appendSeasonCard,
  renderPlayerOverview,
  renderSeasonLog,
  renderStandings,
  renderCompetitions,
  renderTransferOffers,
  renderCareerMoments,
} from "./js/ui/rendering.js?v=79";
import { runCareerStartFlow } from "./js/ui/careerStartFlow.js?v=77";
import {
  showSeasonAnimation,
  openSimulationDashboardSegment,
  hideSimulationDashboard,
  getDashboardRevealState,
} from "./js/ui/seasonAnimation.js?v=80";
import { showRetirementAnimation } from "./js/ui/retirementAnimation.js?v=63";
import { showSeniorScenarioOverlay } from "./js/ui/seniorScenarioOverlay.js?v=78";
import {
  customSelectsAreValid,
  getCustomSelectValue,
  initCustomSelect,
  initCustomSelectOutsideClose,
} from "./js/ui/customSelect.js";
import { escapeHtml, formatCurrency } from "./js/utils/helpers.js";

const POSITION_OPTIONS = [
  { value: "GK", label: "Goalkeeper" },
  { value: "RB", label: "Right Back" },
  { value: "LB", label: "Left Back" },
  { value: "CB", label: "Centre Back" },
  { value: "CDM", label: "Defensive Midfielder" },
  { value: "CM", label: "Central Midfielder" },
  { value: "CAM", label: "Attacking Midfielder" },
  { value: "RM", label: "Right Midfielder" },
  { value: "LM", label: "Left Midfielder" },
  { value: "RW", label: "Right Winger" },
  { value: "LW", label: "Left Winger" },
  { value: "ST", label: "Striker" },
];

const STARTING_AGE_OPTIONS = [15, 16, 17, 18, 19].map((age) => ({
  value: String(age),
  label: `${age} years old`,
  html: `<span>${age} years old</span>`,
}));

function initSetupSelects() {
  initCustomSelectOutsideClose();

  const nationalityRoot = document.getElementById("nationality-select");
  if (nationalityRoot) {
    initCustomSelect(nationalityRoot, {
      placeholder: "Select nationality",
      required: true,
      options: WORLD_CUP_NATIONS.map((nation) => ({
        value: nation.name,
        label: nation.name,
        html: `<img class="select-flag" src="${flagUrl(nation.code)}" alt="" width="22" height="16" loading="lazy" /><span>${escapeHtml(nation.name)}</span>`,
      })),
    });
  }

  const positionRoot = document.getElementById("primary-position-select");
  if (positionRoot) {
    initCustomSelect(positionRoot, {
      placeholder: "Select a position",
      required: true,
      options: POSITION_OPTIONS.map((pos) => ({
        value: pos.value,
        label: pos.label,
        html: `<span class="select-pos-code">${escapeHtml(pos.value)}</span><span>${escapeHtml(pos.label)}</span>`,
      })),
    });
  }

  const ageRoot = document.getElementById("starting-age-select");
  if (ageRoot) {
    initCustomSelect(ageRoot, {
      placeholder: "Select starting age",
      required: true,
      options: STARTING_AGE_OPTIONS,
    });
  }
}

initSetupSelects();

let player = null;
let dealBookingGuard = false;

const setupForm = document.getElementById("setup-form");
const setupSection = document.getElementById("setup-section");
const careerSection = document.getElementById("career-section");
const overviewEl = document.getElementById("player-overview");
const seasonLogEl = document.getElementById("season-log");
const careerMomentsEl = document.getElementById("career-moments-log");
const transferContainer = document.getElementById("transfer-offers");
const simulateBtn = document.getElementById("simulate-btn");
const retireBtn = document.getElementById("retire-btn");
const standingsBoard = document.getElementById("standings-board");
const competitionsBoard = document.getElementById("competitions-board");

function startCareerFromSetup() {
  const bootErr = document.getElementById("app-boot-error");
  if (bootErr) {
    bootErr.classList.add("hidden");
    bootErr.textContent = "";
  }

  if (!setupForm) {
    if (bootErr) {
      bootErr.textContent = "Setup form not found. page may be incomplete. Reload the page.";
      bootErr.classList.remove("hidden");
    }
    return;
  }

  const formData = new FormData(setupForm);
  const name = String(formData.get("player-name") ?? "").trim();
  const nationality = getCustomSelectValue("nationality");
  const position = getCustomSelectValue("primary-position");
  const startingAgeRaw = getCustomSelectValue("starting-age");
  const startingAge = Number(startingAgeRaw);

  if (!name) {
    setupForm.querySelector("#player-name")?.reportValidity?.();
    setupForm.querySelector("#player-name")?.focus();
    return;
  }

  if (!customSelectsAreValid(["nationality", "primary-position", "starting-age"])) {
    if (bootErr) {
      bootErr.textContent = "Choose a nationality, primary position, and starting age to open the file.";
      bootErr.classList.remove("hidden");
    }
    if (!nationality) document.querySelector("#nationality-select .custom-select-trigger")?.focus();
    else if (!position) document.querySelector("#primary-position-select .custom-select-trigger")?.focus();
    else document.querySelector("#starting-age-select .custom-select-trigger")?.focus();
    return;
  }

  try {
    setWorldState(createWorldState({ startYear: new Date().getFullYear() }));
    player = createPlayerIdentity({ name, nationality, position, age: startingAge });
    runCareerStartFlow({
      player,
      academyPool: ACADEMY_POOL,
      setupSectionEl: setupSection,
      onComplete: () => {
        ensureTransferSave(player);
        careerSection.classList.remove("hidden");
        refreshAll();
        simulateBtn.disabled =
          (player.pendingOffers?.length > 0 || player.pendingDecision) || player.isRetired;
      },
    });
  } catch (err) {
    console.error(err);
    setupSection.classList.remove("hidden");
    if (bootErr) {
      bootErr.textContent =
        "Could not start career. Serve this folder over HTTP (e.g. run: python3 -m http.server) and open http://localhost:8000. opening index.html as a file often breaks the game.";
      bootErr.classList.remove("hidden");
    } else {
      window.alert(
        "Could not start career. Run from a local web server (python3 -m http.server), not file://. see console for details."
      );
    }
  }
}

/** Exposed for inline index.html click handler (runs even if other init lines fail). */
window.__footballCareerStart = startCareerFromSetup;

/**
 * Deterministic mid-season loan fixture for live browser verification.
 * Uses the production season pipeline + validated loan offers.
 */
window.__loadLiveLoanBrowserFixture = function loadLiveLoanBrowserFixture(opts = {}) {
  const result = buildLiveLoanBrowserFixture(opts);
  if (!result.ok) {
    console.error("Live loan fixture failed:", result.reason, result);
    return result;
  }
  player = result.player;
  dealBookingGuard = false;
  document.getElementById("career-start-overlay")?.classList.add("hidden");
  setupSection?.classList.add("hidden");
  careerSection?.classList.remove("hidden");
  refreshAll();
  const note = document.createElement("p");
  note.className = "empty-state";
  note.textContent =
    "Mid-season checkpoint. Resolve the squad discussion or offers, then the season continues from January — not from a finished year.";
  transferContainer?.prepend(note);
  simulateBtn.disabled = true;
  return {
    ok: true,
    kind: result.decision?.kind,
    loanOffers: result.offers?.length ?? 0,
    parentClub: player.club?.displayName || player.club?.name,
    employmentClubId: player.employmentClubId,
    weeklyWage: player.weeklyWage,
    ovr: Math.round(player.rating),
    checkpointDate: player.seasonCheckpoint?.simulationDate || player.seasonCheckpoint?.date,
  };
};

window.__getLiveCareerDebug = function getLiveCareerDebug() {
  if (!player) return null;
  return {
    name: player.name,
    club: player.club?.displayName || player.club?.name,
    clubId: player.club?.clubId,
    employmentClubId: player.employmentClubId,
    playingClubId: player.playingClubId,
    weeklyWage: player.weeklyWage,
    contractEndSeason: player.contractEndSeason,
    rating: player.rating,
    ovrDisplay: Math.round(Number(player.rating) || 0),
    activeLoan: player.activeLoan
      ? {
          status: player.activeLoan.status,
          parentClubId: player.activeLoan.parentClubId,
          borrowingClubId: player.activeLoan.borrowingClubId,
          startDate: player.activeLoan.startDate,
          endDate: player.activeLoan.endDate,
          transactionIds: player.activeLoan.transactionIds || [],
        }
      : null,
    pendingDecision: player.pendingDecision?.kind || null,
    pendingOffers: (player.pendingOffers || []).map((o) => ({
      club: o.clubDisplay || o.club,
      isLoan: !!o.isLoan,
      wage: o.wage,
    })),
    seasonCheckpoint: player.seasonCheckpoint?.status || null,
    seasons: player.seasons?.length ?? 0,
    dealBookingGuard,
  };
};

setupForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  startCareerFromSetup();
});

simulateBtn?.addEventListener("click", () => {
  if (!player || player.isRetired) return;
  simulateSeasonWithAnimation();
});

retireBtn?.addEventListener("click", () => {
  if (!player || player.isRetired) return;
  retirePlayer();
});


function refreshOverview() {
  const keys = player ? getDisplayAttributeKeys(player.position) : STATS_KEYS;
  renderPlayerOverview(player, overviewEl, keys);
  renderCareerMoments(player, careerMomentsEl);
}

function refreshSeasonLog() {
  renderSeasonLog(player, seasonLogEl);
}

async function presentSeniorScenarioThenResume(pending) {
  if (!pending || pending.unschedulable) {
    resumeSeasonAfterDecision({ pauseForDecisions: true });
    return;
  }
  simulateBtn.disabled = true;
  await showSeniorScenarioOverlay(player, pending);
  ensureTransferSave(player);
  refreshOverview();
  resumeSeasonAfterDecision({ pauseForDecisions: true });
}

function persistRevealCursor() {
  const state = getDashboardRevealState();
  player.simRevealCursor = state.revealedIds || [];
  ensureTransferSave(player);
}

async function presentDashboardSegment(seasonData, { continueDashboard = false } = {}) {
  const allMatches = seasonData.leagueAllMatches || seasonData.partialLeagueAllMatches || [];
  const playerMatches =
    seasonData.leaguePlayerMatches || seasonData.partialLeaguePlayerMatches || [];
  const league = seasonData.league;
  const seasonNumber =
    seasonData.season?.seasonNumber ||
    (seasonData.seasonIndex != null ? seasonData.seasonIndex + 1 : player.seasons.length + 1);
  const result = await openSimulationDashboardSegment({
    player,
    league,
    seasonNumber,
    allMatches,
    playerMatches,
    seedClubs: seasonData.checkpoint?.clubs || league?.clubs || [],
    revealedFixtureIds: player.simRevealCursor || null,
    awaitingDecision: Boolean(seasonData.awaitingDecision),
    awaitingScenario: Boolean(seasonData.awaitingScenario),
    decisionText: seasonData.awaitingScenario
      ? "A senior career moment needs your response before the season continues."
      : "Mid-season checkpoint. Resolve the squad discussion or offers, then continue from this date.",
    reset: !continueDashboard && !player.simRevealCursor?.length,
    continueDashboard,
  });
  player.simRevealCursor = result.revealedIds;
  ensureTransferSave(player);
  return result;
}

function leaveDashboardForDecisions() {
  persistRevealCursor();
  hideSimulationDashboard();
  const overlay = document.getElementById("season-animation-overlay");
  overlay?.classList.add("hidden");
}

function refreshStandings() {
  renderStandings(player, standingsBoard);
}

function refreshCompetitions() {
  renderCompetitions(player, competitionsBoard);
}

function handleSquadDecision(decision, choiceId) {
  const result = resolveSquadDecision(player, decision, choiceId);
  if (result.action === "reintegrate" && player.activeLoan?.status === "active") {
    endLoan(player, "return");
  }
  if (result.action === "stay" || result.action === "transfer-listed") {
    dealBookingGuard = false;
  }
  refreshTransferOffers();
  refreshOverview();
  const waiting =
    player.pendingOffers?.length > 0 || Boolean(player.pendingDecision);
  if (!waiting && player.seasonCheckpoint?.status === "awaiting_decision") {
    resumeSeasonAfterDecision();
    return;
  }
  simulateBtn.disabled = player.isRetired || waiting;
}

function refreshTransferOffers() {
  if (!player) return;
  renderTransferOffers({
    player,
    transferContainer,
    simulateBtn,
    applyTransfer,
    finishOfferWindow,
    promoteToParentClub,
    onDecision: handleSquadDecision,
  });
}

function refreshAll() {
  refreshOverview();
  refreshSeasonLog();
  refreshStandings();
  refreshCompetitions();
  refreshTransferOffers();
}

async function simulateSeasonWithAnimation() {
  simulateBtn.disabled = true;

  let seasonData;
  try {
    // Interactive careers pause for senior scenes and the winter squad window.
    seasonData = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, { pauseForDecisions: true });

    if (!seasonData) {
      simulateBtn.disabled = !!player?.isRetired;
      return;
    }

    if (seasonData.awaitingScenario) {
      player.seasonCheckpoint = seasonData.checkpoint;
      player.pendingSeniorScenario = seasonData.pendingSeniorScenario || null;
      ensureTransferSave(player);
      await presentDashboardSegment(seasonData, { continueDashboard: Boolean(player.simRevealCursor?.length) });
      leaveDashboardForDecisions();
      presentSeniorScenarioThenResume(player.pendingSeniorScenario);
      return;
    }

    if (seasonData.awaitingDecision) {
      player.seasonCheckpoint = seasonData.checkpoint;
      player.pendingDecision = seasonData.decision || null;
      player.pendingOffers = seasonData.offers || [];
      ensureTransferSave(player);
      await presentDashboardSegment(seasonData, { continueDashboard: Boolean(player.simRevealCursor?.length) });
      leaveDashboardForDecisions();
      refreshOverview();
      refreshTransferOffers();
      const note = document.createElement("p");
      note.className = "empty-state";
      note.textContent =
        "Mid-season checkpoint — standings and results are saved through this date. Resolve the squad discussion or offers, then the season continues from January — not from a finished year.";
      transferContainer.prepend(note);
      simulateBtn.disabled = true;
      return;
    }

    // Fresh season start cursor when beginning a completed run without prior segment
    if (!player.simRevealCursor) player.simRevealCursor = [];
    finalizeCompletedSeasonUi(seasonData);
  } catch (err) {
    console.error("Season simulation failed:", err);
    simulateBtn.disabled = !!player?.isRetired;
    window.alert(
      `Season simulation failed: ${err?.message || err}. Check the console for details.`
    );
  }
}

async function resumeSeasonAfterDecision(opts = {}) {
  if (!player?.seasonCheckpoint) return;
  simulateBtn.disabled = true;
  const pauseForDecisions = opts.pauseForDecisions !== undefined ? opts.pauseForDecisions : true;
  try {
    const seasonData = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions,
      checkpoint: player.seasonCheckpoint,
      autoDecisionPolicy: null,
    });
    if (seasonData?.awaitingScenario) {
      player.seasonCheckpoint = seasonData.checkpoint;
      player.pendingSeniorScenario = seasonData.pendingSeniorScenario || null;
      await presentDashboardSegment(seasonData, { continueDashboard: true });
      leaveDashboardForDecisions();
      presentSeniorScenarioThenResume(player.pendingSeniorScenario);
      return;
    }
    if (seasonData?.awaitingDecision) {
      player.seasonCheckpoint = seasonData.checkpoint;
      player.pendingDecision = seasonData.decision || null;
      player.pendingOffers = seasonData.offers || [];
      await presentDashboardSegment(seasonData, { continueDashboard: true });
      leaveDashboardForDecisions();
      refreshTransferOffers();
      refreshOverview();
      return;
    }
    player.seasonCheckpoint = null;
    player.pendingSeniorScenario = null;
    seasonData.continueDashboard = true;
    seasonData.revealedFixtureIds = player.simRevealCursor || [];
    finalizeCompletedSeasonUi(seasonData);
  } catch (err) {
    console.error("Season resume failed:", err);
    simulateBtn.disabled = !!player?.isRetired;
    window.alert(`Season resume failed: ${err?.message || err}`);
  }
}

function finalizeCompletedSeasonUi(seasonData) {
  if (!seasonData) {
    simulateBtn.disabled = !!player?.isRetired;
    return;
  }

  if (maybeAutoRetire()) {
    refreshOverview();
    appendSeasonCard(seasonData.season, seasonLogEl, player);
    refreshStandings();
    refreshCompetitions();
    refreshTransferOffers();
    simulateBtn.disabled = true;
    return;
  }

  if (player.activeLoan?.status === "active") {
    const seasonIndex = player.seasons.length;
    if (player.activeLoan.endSeason != null && seasonIndex >= player.activeLoan.endSeason) {
      queueSquadDecision(player, "loan-return", {
        seasonIndex,
        performanceScore: seasonData.performanceScore,
      });
    }
  }

  const offers = generateTransferOffers(
    seasonData.performanceScore,
    player,
    LEAGUES,
    LEAGUE_LOOKUP,
    seasonData.season?.avgMatchRating ?? null
  );
  player.pendingOffers = offers;

  if (!player.pendingDecision && !player.club?.isAcademy) {
    queueSquadDecision(player, "pre-season", {
      seasonIndex: player.seasons.length,
      performanceScore: seasonData.performanceScore,
    });
  }

  ensureTransferSave(player);

  seasonData.revealedFixtureIds = player.simRevealCursor || seasonData.revealedFixtureIds || [];
  seasonData.continueDashboard = Boolean(seasonData.continueDashboard || player.simRevealCursor?.length);
  showSeasonAnimation(
    seasonData,
    player,
    getDisplayAttributeKeys(player.position),
    finishSeasonAnimation
  );
}

function finishSeasonAnimation() {
  const overlay = document.getElementById("season-animation-overlay");
  overlay.classList.add("hidden");
  hideSimulationDashboard();
  player.simRevealCursor = null;

  refreshOverview();
  appendSeasonCard(player.seasons[player.seasons.length - 1], seasonLogEl, player);
  refreshStandings();
  refreshCompetitions();
  refreshTransferOffers();

  simulateBtn.disabled =
    player.pendingOffers?.length > 0 || Boolean(player.pendingDecision) || player.isRetired;
}

function retirePlayer() {
  player.isRetired = true;
  player.retiredInSeason = player.seasons.length;
  simulateBtn.disabled = true;
  retireBtn.disabled = true;

  showRetirementAnimation(player, finishRetirementAnimation);
}

function finishRetirementAnimation() {
  const farewell = document.createElement("p");
  farewell.className = "empty-state";
  farewell.textContent = `${player.name} hangs up the boots after ${player.careerTotals.matches} appearances.`;
  transferContainer.innerHTML = "";
  transferContainer.appendChild(farewell);
  refreshOverview();
}

function maybeAutoRetire() {
  if (!player || player.isRetired) return false;
  const age = player.age;
  if (age >= 42) {
    retirePlayer();
    return true;
  }
  if (age < 35) return false;

  const oddsByAge = {
    35: 0.06,
    36: 0.1,
    37: 0.18,
    38: 0.28,
    39: 0.45,
    40: 0.65,
    41: 0.85,
  };

  const chance = oddsByAge[age] || 0;
  if (Math.random() < chance) {
    retirePlayer();
    return true;
  }
  return false;
}

function promoteToParentClub() {
  if (!player) return null;
  const seniorName = promoteAcademyGraduateToFirstTeam(player, 75);
  refreshOverview();
  refreshStandings();
  refreshCompetitions();
  return seniorName;
}

function applyTransfer(offer) {
  if (!player || !offer) return;
  if (dealBookingGuard) {
    console.warn("Blocked duplicate deal acceptance click.");
    return { ok: false, reason: "duplicate-click" };
  }
  dealBookingGuard = true;
  player.suppressParentContractOffer = false;

  const playerNationality = player.nationality;
  if (offer.isLoan) {
    const loanResult = startLoan(player, offer);
    if (!loanResult.ok) {
      dealBookingGuard = false;
      window.alert(`Loan could not be completed: ${loanResult.reason || "validation failed"}.`);
      return loanResult;
    }
    player.nationality = playerNationality;
    if (player.attributes) refreshAbilityCaches(player);
    finishOfferWindow(true, offer);
    maybeResumeAfterWindowChoice();
    return loanResult;
  }

  const result = acceptPipelineOffer(player, offer);
  if (!result.ok) {
    dealBookingGuard = false;
    window.alert(
      `Deal could not be completed: ${(result.reasons || [result.reason]).join(", ")}.`
    );
    return result;
  }

  player.nationality = playerNationality;
  if (player.attributes) refreshAbilityCaches(player);
  finishOfferWindow(true, offer);
  maybeResumeAfterWindowChoice();
  return result;
}

function maybeResumeAfterWindowChoice() {
  if (player.seasonCheckpoint?.status === "awaiting_decision") {
    if (!(player.pendingOffers?.length > 0) && !player.pendingDecision) {
      resumeSeasonAfterDecision();
    }
  }
}

function finishOfferWindow(accepted, offer) {
  player.pendingOffers = [];
  // Closing the window without accepting is an explicit stay/decline — never leave a
  // mid-season decision hanging or Simulate Next Season stays dead.
  if (!accepted && player.pendingDecision) {
    player.pendingDecision = null;
  }
  transferContainer.innerHTML = "";
  if (!accepted) dealBookingGuard = false;

  const note = document.createElement("p");
  note.className = "empty-state";

  let message;
  if (accepted && offer) {
    const offerClubName = offer.clubDisplay ?? offer.club;
    if (offer.isLoan) {
      message = `${player.name} joins ${offerClubName} on loan. Parent registration is retained.`;
    } else if (offer.isRenewal) {
      message = `${player.name} signs a contract extension with ${offerClubName} at ${formatCurrency(
        offer.wage || 0
      )}/wk.`;
    } else if (offer.isParentOffer || offer.dealType === "first_pro") {
      message = `${player.name} signs a professional contract with ${offerClubName} at ${formatCurrency(
        offer.wage || 0
      )}/wk.`;
    } else {
      message = `Transfer confirmed: ${player.name} joins ${offerClubName} in ${
        offer.leagueDisplay ?? offer.league
      } for ${formatCurrency(offer.transferFee ?? 0)} · ${formatCurrency(offer.wage || 0)}/wk.`;
    }
  } else {
    message = player.club?.isAcademy
      ? `${player.name} remains in the academy for now.`
      : "Transfer window closed. Focusing on the current club.";
  }

  note.textContent = message;
  transferContainer.appendChild(note);

  refreshOverview();
  refreshStandings();
  refreshCompetitions();
  if (
    player.seasonCheckpoint?.status === "awaiting_decision" &&
    !(player.pendingOffers?.length > 0) &&
    !player.pendingDecision
  ) {
    maybeResumeAfterWindowChoice();
    return;
  }
  simulateBtn.disabled =
    player.isRetired || player.pendingOffers?.length > 0 || Boolean(player.pendingDecision);
}
