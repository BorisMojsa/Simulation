import { STATS_KEYS } from "./js/config/playerConfig.js";
import { ACADEMY_POOL, LEAGUES, LEAGUE_LOOKUP } from "./js/data/leagues.js";
import { createPlayerIdentity, promoteAcademyGraduateToFirstTeam } from "./js/simulation/playerDevelopment.js";
import { calculateContractLength, generateTransferOffers } from "./js/simulation/transferMarket.js";
import { simulateSeason } from "./js/simulation/seasonSimulator.js";
import {
  appendSeasonCard,
  renderPlayerOverview,
  renderSeasonLog,
  renderStandings,
  renderTransferOffers,
} from "./js/ui/rendering.js";
import { runCareerStartFlow } from "./js/ui/careerStartFlow.js";
import { showSeasonAnimation } from "./js/ui/seasonAnimation.js";
import { showRetirementAnimation } from "./js/ui/retirementAnimation.js";
import { formatCurrency } from "./js/utils/helpers.js";

let player = null;

const setupForm = document.getElementById("setup-form");
const setupSection = document.getElementById("setup-section");
const careerSection = document.getElementById("career-section");
const overviewEl = document.getElementById("player-overview");
const seasonLogEl = document.getElementById("season-log");
const transferContainer = document.getElementById("transfer-offers");
const simulateBtn = document.getElementById("simulate-btn");
const retireBtn = document.getElementById("retire-btn");
const standingsBoard = document.getElementById("standings-board");

function startCareerFromSetup() {
  const bootErr = document.getElementById("app-boot-error");
  if (bootErr) {
    bootErr.classList.add("hidden");
    bootErr.textContent = "";
  }

  if (!setupForm) {
    if (bootErr) {
      bootErr.textContent = "Setup form not found — page may be incomplete. Reload the page.";
      bootErr.classList.remove("hidden");
    }
    return;
  }

  if (!setupForm.checkValidity()) {
    setupForm.reportValidity();
    return;
  }

  const formData = new FormData(setupForm);
  const name = String(formData.get("player-name") ?? "").trim();
  const nationality = String(formData.get("nationality") ?? "").trim();
  const position = String(formData.get("primary-position") ?? "").trim();

  try {
    player = createPlayerIdentity({ name, nationality, position });
    runCareerStartFlow({
      player,
      academyPool: ACADEMY_POOL,
      setupSectionEl: setupSection,
      onComplete: () => {
        careerSection.classList.remove("hidden");
        refreshAll();
        simulateBtn.disabled = player.pendingOffers.length > 0 || player.isRetired;
      },
    });
  } catch (err) {
    console.error(err);
    setupSection.classList.remove("hidden");
    if (bootErr) {
      bootErr.textContent =
        "Could not start career. Serve this folder over HTTP (e.g. run: python3 -m http.server) and open http://localhost:8000 — opening index.html as a file often breaks the game.";
      bootErr.classList.remove("hidden");
    } else {
      window.alert(
        "Could not start career. Run from a local web server (python3 -m http.server), not file:// — see console for details."
      );
    }
  }
}

/** Exposed for inline index.html click handler (runs even if other init lines fail). */
window.__footballCareerStart = startCareerFromSetup;

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
  renderPlayerOverview(player, overviewEl, STATS_KEYS);
}

function refreshSeasonLog() {
  renderSeasonLog(player, seasonLogEl);
}

function refreshStandings() {
  renderStandings(player, standingsBoard);
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
  });
}

function refreshAll() {
  refreshOverview();
  refreshSeasonLog();
  refreshStandings();
  refreshTransferOffers();
}

function simulateSeasonWithAnimation() {
  simulateBtn.disabled = true;

  const seasonData = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP);

  if (!seasonData) {
    simulateBtn.disabled = !!player?.isRetired;
    return;
  }

  if (maybeAutoRetire()) {
    refreshOverview();
    appendSeasonCard(seasonData.season, seasonLogEl, player);
    refreshStandings();
    refreshTransferOffers();
    return;
  }

  const offers = generateTransferOffers(seasonData.performanceScore, player, LEAGUES, LEAGUE_LOOKUP);
  player.pendingOffers = offers;

  showSeasonAnimation(seasonData, player, STATS_KEYS, finishSeasonAnimation);
}

function finishSeasonAnimation() {
  const overlay = document.getElementById("season-animation-overlay");
  overlay.classList.add("hidden");

  refreshOverview();
  appendSeasonCard(player.seasons[player.seasons.length - 1], seasonLogEl, player);
  refreshStandings();
  refreshTransferOffers();

  simulateBtn.disabled = player.pendingOffers.length > 0 || player.isRetired;
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
  return seniorName;
}

function applyTransfer(offer) {
  player.suppressParentContractOffer = false;
  player.club = {
    name: offer.club,
    displayName: offer.clubDisplay ?? offer.club,
    league: offer.league,
    leagueDisplay: offer.leagueDisplay ?? offer.league,
    tier: offer.tier,
    badge: offer.badge,
    financialTier: offer.financialTier,
    isAcademy: false,
    parentClub: null,
  };

  const currentSeason = player.seasons.length;
  player.contractStartSeason = currentSeason;
  player.contractYears = offer.contractYears || calculateContractLength(player.age, player.rating, player.potential, 70);
  player.contractEndSeason = currentSeason + player.contractYears;

  finishOfferWindow(true, offer);
}

function finishOfferWindow(accepted, offer) {
  player.pendingOffers = [];
  transferContainer.innerHTML = "";

  const note = document.createElement("p");
  note.className = "empty-state";

  let message;
  if (accepted && offer) {
    const offerClubName = offer.clubDisplay ?? offer.club;
    if (offer.isRenewal) {
      message = `${player.name} signs a contract extension with ${offerClubName}.`;
    } else if (offer.isParentOffer) {
      message = `${player.name} signs a professional contract with ${offerClubName}.`;
    } else {
      message = `Transfer confirmed: ${player.name} joins ${offerClubName} in ${offer.leagueDisplay ?? offer.league} for ${formatCurrency(
        offer.transferFee ?? 0
      )}.`;
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
  simulateBtn.disabled = player.isRetired;
}
