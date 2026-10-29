import { STATS_KEYS } from "./js/config/playerConfig.js";
import { ACADEMY_POOL, LEAGUES, LEAGUE_LOOKUP } from "./js/data/leagues.js?v=61";
import { createPlayerIdentity, promoteAcademyGraduateToFirstTeam } from "./js/simulation/playerDevelopment.js?v=77";
import { getDisplayAttributeKeys, refreshAbilityCaches } from "./js/simulation/playerAbility.js?v=61";
import { generateTransferOffers } from "./js/simulation/transferMarket.js?v=81";
import { acceptPipelineOffer } from "./js/simulation/dealPipeline.js?v=81";
import { startLoan, endLoan } from "./js/simulation/loanMarket.js?v=81";
import { queueSquadDecision, resolveSquadDecision } from "./js/simulation/squadDecisions.js?v=81";
import { ensureTransferSave } from "./js/simulation/transferMigration.js?v=81";
import { simulateSeason } from "./js/simulation/seasonSimulator.js?v=89";
import { createWorldState, setWorldState, getWorldState } from "./js/simulation/worldState.js";
import {
  serializeCareerSnapshot,
  deserializeCareerSnapshot,
} from "./js/simulation/careerSnapshot.js";
import { getOrInitClubSeasonFinance } from "./js/simulation/clubFinance.js";
import {
  ensureContractAuthority,
  selectNextCareerAction,
  isFreeAgent,
  declineWindowAndContinue,
  settleBoundaryContractReview,
} from "./js/simulation/contractLifecycle.js?v=81";
import {
  declineAcademyReview,
  acceptAcademyGraduationOffer,
  ensureAcademyLifecycle,
  migrateAcademyLifecycle,
} from "./js/simulation/academyLifecycle.js";
import { buildLiveLoanBrowserFixture } from "./js/simulation/liveLoanBrowserFixture.js?v=81";
import { buildFreeAgentBrowserFixture } from "./js/simulation/freeAgentBrowserFixture.js?v=90";
import { buildOwnershipTransferBrowserFixture } from "./js/simulation/ownershipTransferBrowserFixture.js?v=91";
import { buildAcademyBrowserFixture } from "./js/simulation/academyBrowserFixture.js";
import { buildMatchParticipationKoBrowserFixture } from "./js/simulation/matchParticipationKoBrowserFixture.js";
import { buildMatchParticipationGkBrowserFixture } from "./js/simulation/matchParticipationGkBrowserFixture.js";
import {
  appendSeasonCard,
  renderPlayerOverview,
  renderSeasonLog,
  renderStandings,
  renderCompetitions,
  renderTransferOffers,
  renderCareerMoments,
} from "./js/ui/rendering.js?v=90";
import { runCareerStartFlow } from "./js/ui/careerStartFlow.js?v=81";
import {
  showSeasonAnimation,
  openSimulationDashboardSegment,
  hideSimulationDashboard,
  getDashboardRevealState,
} from "./js/ui/seasonAnimation.js?v=90";
import { showRetirementAnimation } from "./js/ui/retirementAnimation.js?v=81";
import { showSeniorScenarioOverlay } from "./js/ui/seniorScenarioOverlay.js?v=88";
import {
  applyCareerSetupErrors,
  clearCareerSetupErrors,
  initCareerSetup,
  readCareerSetupValues,
} from "./js/ui/careerSetup.js";
import { formatCurrency } from "./js/utils/helpers.js";

let player = null;
/** Scoped to one in-flight offer/window submission — not career-wide. */
let dealBookingGuard = null;
let careerStartInFlight = false;
/** Covers simulate → recap/overlay through leaving Continue (or recovery). */
let seasonActionInFlight = false;
/** Prevents duplicate history append when completion is invoked twice. */
let lastFinishedSeasonKey = null;

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
const startCareerBtn = document.getElementById("start-career-btn");

if (setupForm) initCareerSetup(setupForm);

function setCareerStartBusy(busy) {
  careerStartInFlight = busy;
  if (startCareerBtn) {
    startCareerBtn.disabled = busy;
    startCareerBtn.setAttribute("aria-busy", busy ? "true" : "false");
  }
}

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

  if (careerStartInFlight) return;

  const result = readCareerSetupValues(setupForm);
  if (!result.ok) {
    applyCareerSetupErrors(setupForm, result.errors, result.focus);
    return;
  }

  const { name, nationality, position, age: startingAge } = result.data;
  clearCareerSetupErrors(setupForm);
  setCareerStartBusy(true);
  window.__lastAcceptedCareerSetup = { name, nationality, position, age: startingAge };

  try {
    setWorldState(createWorldState({ startYear: new Date().getFullYear() }));
    player = createPlayerIdentity({ name, nationality, position, age: startingAge });
    runCareerStartFlow({
      player,
      academyPool: ACADEMY_POOL,
      setupSectionEl: setupSection,
      onComplete: () => {
        ensureTransferSave(player);
        ensureContractAuthority(player);
        careerSection.classList.remove("hidden");
        refreshAll();
        syncSimulateButton();
      },
    });
  } catch (err) {
    console.error(err);
    setCareerStartBusy(false);
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

/** Exposed for diagnostics; same guarded start path as form submit. */
window.__footballCareerStart = startCareerFromSetup;

/** Narrow hook for browser verification of the setup payload boundary. */
window.__readCareerSetupValues = () => (setupForm ? readCareerSetupValues(setupForm) : { ok: false, errors: { form: "missing" }, focus: null });

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
  dealBookingGuard = null;
  ensureContractAuthority(player);
  document.getElementById("career-start-overlay")?.classList.add("hidden");
  setupSection?.classList.add("hidden");
  careerSection?.classList.remove("hidden");
  refreshAll();
  const note = document.createElement("p");
  note.className = "empty-state";
  note.textContent =
    "Mid-season checkpoint. Resolve the squad discussion or offers, then the season continues from January — not from a finished year.";
  transferContainer?.prepend(note);
  syncSimulateButton();
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

/**
 * Deterministic released-player fixture for free-agent soft-lock / desk checks.
 * Modes: "empty" (default), "offers", "retire-41", "signed".
 * Open: http://127.0.0.1:8000/?fixture=free-agent
 * Or call: window.__loadFreeAgentBrowserFixture({ mode: "empty" })
 */
window.__loadFreeAgentBrowserFixture = function loadFreeAgentBrowserFixture(opts = {}) {
  const result = buildFreeAgentBrowserFixture(opts);
  if (!result.ok) {
    console.error("Free-agent fixture failed:", result.reason, result);
    return result;
  }
  player = result.player;
  dealBookingGuard = null;
  seasonActionInFlight = false;
  lastFinishedSeasonKey = null;
  ensureContractAuthority(player);
  document.getElementById("career-start-overlay")?.classList.add("hidden");
  setupSection?.classList.add("hidden");
  careerSection?.classList.remove("hidden");
  refreshAll();
  syncSimulateButton();
  return {
    ok: true,
    mode: result.mode,
    age: player.age,
    seasons: player.seasons?.length ?? 0,
    weeklyWage: player.weeklyWage || 0,
    pendingOffers: player.pendingOffers?.length ?? 0,
    pendingDecision: player.pendingDecision?.kind || null,
    nextAction: selectNextCareerAction(player),
    club: player.club?.displayName || player.club?.name || null,
    simulateLabel: simulateBtn?.textContent || null,
    simulateDisabled: Boolean(simulateBtn?.disabled),
  };
};

window.__loadAcademyBrowserFixture = function loadAcademyBrowserFixture(opts = {}) {
  const result = buildAcademyBrowserFixture(opts);
  if (!result.ok) {
    console.error("Academy fixture failed:", result.reason, result);
    return result;
  }
  player = result.player;
  dealBookingGuard = null;
  seasonActionInFlight = false;
  lastFinishedSeasonKey = null;
  ensureContractAuthority(player);
  ensureAcademyLifecycle(player);
  document.getElementById("career-start-overlay")?.classList.add("hidden");
  setupSection?.classList.add("hidden");
  careerSection?.classList.remove("hidden");
  refreshAll();
  syncSimulateButton();
  return {
    ok: true,
    mode: result.mode,
    age: player.age,
    seasons: player.seasons?.length ?? 0,
    isAcademy: Boolean(player.club?.isAcademy),
    club: player.club?.displayName || player.club?.name || null,
    pendingOffers: player.pendingOffers?.length ?? 0,
    nextAction: selectNextCareerAction(player),
    academyLifecycle: player.academyLifecycle
      ? {
          status: player.academyLifecycle.status,
          periodCount: player.academyLifecycle.periodCount,
          pendingReviewId: player.academyLifecycle.pendingReviewId,
        }
      : null,
    simulateLabel: simulateBtn?.textContent || null,
    simulateDisabled: Boolean(simulateBtn?.disabled),
  };
};

window.__loadMatchParticipationKoBrowserFixture = async function loadMatchParticipationKoBrowserFixture(opts = {}) {
  const result = buildMatchParticipationKoBrowserFixture(opts);
  if (!result.ok) {
    console.error("Fix05 KO fixture failed:", result.reason, result);
    return result;
  }
  player = result.player;
  dealBookingGuard = null;
  seasonActionInFlight = false;
  lastFinishedSeasonKey = null;
  ensureContractAuthority(player);
  document.getElementById("career-start-overlay")?.classList.add("hidden");
  setupSection?.classList.add("hidden");
  careerSection?.classList.remove("hidden");
  refreshAll();
  syncSimulateButton();
  // Segment-only playback: live dashboard slate without the completed-season Continue path.
  const seasonData = {
    league: result.league,
    seasonIndex: 0,
    leagueAllMatches: result.allMatches,
    leaguePlayerMatches: result.playerMatches,
    awaitingDecision: false,
  };
  await presentDashboardSegment(seasonData, { continueDashboard: false });
  return {
    ok: true,
    mode: "segment",
    ...player.__qaKoFixture,
    playingClubId: player.playingClubId,
  };
};

/**
 * Completed-season presentation for Fix 05 KO: production showSeasonAnimation
 * through final #continue-btn → finishSeasonAnimation desk return.
 */
window.__loadMatchParticipationKoCompleteBrowserFixture = async function loadMatchParticipationKoCompleteBrowserFixture(
  opts = {}
) {
  const result = buildMatchParticipationKoBrowserFixture(opts);
  if (!result.ok) {
    console.error("Fix05 KO complete fixture failed:", result.reason, result);
    return result;
  }
  player = result.player;
  dealBookingGuard = null;
  seasonActionInFlight = true;
  lastFinishedSeasonKey = null;
  ensureContractAuthority(player);
  document.getElementById("career-start-overlay")?.classList.add("hidden");
  setupSection?.classList.add("hidden");
  careerSection?.classList.remove("hidden");
  refreshAll();
  try {
    await showSeasonAnimation(
      result.seasonData,
      player,
      getDisplayAttributeKeys(player.position),
      () => {
        finishSeasonAnimation();
        seasonActionInFlight = false;
      }
    );
  } catch (err) {
    seasonActionInFlight = false;
    recoverSeasonPresentationFailure(err, { alert: false, committed: true });
    throw err;
  }
  seasonActionInFlight = false;
  syncSimulateButton();
  return {
    ok: true,
    mode: "complete",
    ...player.__qaKoFixture,
    playingClubId: player.playingClubId,
    seasonsCount: player.seasons?.length ?? 0,
  };
};

window.__loadMatchParticipationGkBrowserFixture = function loadMatchParticipationGkBrowserFixture(opts = {}) {
  const result = buildMatchParticipationGkBrowserFixture(opts);
  if (!result.ok) {
    console.error("Fix05 GK fixture failed:", result.reason, result);
    return result;
  }
  player = result.player;
  dealBookingGuard = null;
  ensureContractAuthority(player);
  document.getElementById("career-start-overlay")?.classList.add("hidden");
  setupSection?.classList.add("hidden");
  careerSection?.classList.remove("hidden");
  refreshAll();
  syncSimulateButton();
  return {
    ok: true,
    ...(player.__qaGkFixture || {}),
    playingClubId: player.playingClubId,
  };
};

window.__loadOwnershipTransferBrowserFixture = function loadOwnershipTransferBrowserFixture(opts = {}) {
  const result = buildOwnershipTransferBrowserFixture(opts);
  if (!result.ok) {
    console.error("Ownership transfer fixture failed:", result.reason, result);
    return result;
  }
  player = result.player;
  dealBookingGuard = null;
  ensureContractAuthority(player);
  document.getElementById("career-start-overlay")?.classList.add("hidden");
  setupSection?.classList.add("hidden");
  careerSection?.classList.remove("hidden");
  refreshAll();
  const note = document.createElement("p");
  note.className = "empty-state";
  note.textContent =
    "Ownership QA: Arsenal mid-season review with a Brentford permanent offer. Accept to verify cup/continental detachment.";
  transferContainer?.prepend(note);
  syncSimulateButton();
  simulateBtn.disabled = true;
  return {
    ok: true,
    fromClubId: result.fromClubId,
    toClubId: result.toClubId,
    offerCount: result.offers?.length ?? 0,
    playingClubId: player.playingClubId,
    employmentClubId: player.employmentClubId,
    checkpointDate: player.seasonCheckpoint?.lastDate,
  };
};

/** QA: export a restorable in-memory session snapshot (JSON-safe). */
window.__exportCareerSnapshot = function exportCareerSnapshot() {
  if (!player) return null;
  return serializeCareerSnapshot({ player, world: getWorldState() });
};

/**
 * QA: attempt acceptance through the same production pipeline as the UI.
 * Used to prove stale/duplicate Accept rejection without inventing a second path.
 */
window.__acceptPipelineOffer = function acceptPipelineOfferForQa(offer) {
  if (!player) return { ok: false, reason: "no-player" };
  if (!offer) return { ok: false, reason: "missing-offer" };
  const beforeEnd = player.contractEndSeason;
  const beforeWage = player.weeklyWage;
  const result = acceptPipelineOffer(player, offer);
  refreshAll();
  syncSimulateButton();
  return {
    ...result,
    attempted: true,
    beforeEnd,
    beforeWage,
    afterEnd: player.contractEndSeason,
    afterWage: player.weeklyWage,
  };
};
window.__acceptTransferOffer = window.__acceptPipelineOffer;

/** QA: restore a previously exported session snapshot onto the desk. */
window.__restoreCareerSnapshot = function restoreCareerSnapshot(data) {
  const restored = deserializeCareerSnapshot(data);
  if (!restored?.player) return { ok: false, reason: "invalid-snapshot" };
  if (restored.world) setWorldState(restored.world);
  player = restored.player;
  dealBookingGuard = null;
  seasonActionInFlight = false;
  lastFinishedSeasonKey = null;
  ensureContractAuthority(player);
  if (player.club?.isAcademy) {
    ensureAcademyLifecycle(player);
    migrateAcademyLifecycle(player);
  }
  document.getElementById("career-start-overlay")?.classList.add("hidden");
  setupSection?.classList.add("hidden");
  careerSection?.classList.remove("hidden");
  refreshAll();
  syncSimulateButton();
  return {
    ok: true,
    age: player.age,
    pendingOffers: player.pendingOffers?.length ?? 0,
    reviewId: player.academyLifecycle?.pendingReviewId || null,
    nextAction: selectNextCareerAction(player),
  };
};

/**
 * QA: zero current wage headroom for a pending offer's club so Accept fails
 * production revalidation. Does not invent offer terms.
 */
window.__zeroPendingOfferWageHeadroom = function zeroPendingOfferWageHeadroom(offerId = null) {
  if (!player?.pendingOffers?.length) return { ok: false, reason: "no-pending-offers" };
  const offer =
    (offerId && player.pendingOffers.find((o) => o.offerId === offerId)) || player.pendingOffers[0];
  if (!offer?.clubId) return { ok: false, reason: "missing-club" };
  const seasonKey = String((player.startYear || 2026) + (player.seasons?.length ?? 0));
  const ledger = getOrInitClubSeasonFinance(offer.clubId, seasonKey);
  ledger.remainingWageHeadroom = 0;
  return {
    ok: true,
    clubId: offer.clubId,
    offerId: offer.offerId,
    seasonKey,
    remainingWageHeadroom: ledger.remainingWageHeadroom,
  };
};

window.__getLiveCareerDebug = function getLiveCareerDebug() {
  if (!player) return null;
  const last = player.seasons?.[player.seasons.length - 1] || null;
  return {
    name: player.name,
    age: player.age,
    club: player.club?.displayName || player.club?.name,
    clubId: player.club?.clubId,
    employmentClubId: player.employmentClubId,
    playingClubId: player.playingClubId,
    playingStints: player.playingStints || [],
    seasonsCount: player.seasons?.length ?? 0,
    careerHonors: player.careerHonors ? { ...player.careerHonors } : null,
    lastSeasonHonors: last?.honors || null,
    lastSeasonTrophies: last?.trophies || null,
    lastSeasonClubApps: last?.ledgerSummary?.club?.appearances ?? last?.appearances ?? null,
    openPlayingStintClubId:
      (player.playingStints || []).find((s) => s && s.to == null)?.playingClubId || null,
    weeklyWage: player.weeklyWage,
    contractEndSeason: player.contractEndSeason,
    rating: player.rating,
    ovrDisplay: Math.round(Number(player.rating) || 0),
    isRetired: Boolean(player.isRetired),
    freeAgent: isFreeAgent(player) || !player.club,
    careerTotals: player.careerTotals
      ? { ...player.careerTotals }
      : { matches: 0, goals: 0, assists: 0, cleanSheets: 0 },
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
    lastSeason: player.seasons?.[player.seasons.length - 1]
      ? {
          seasonId: player.seasons[player.seasons.length - 1].seasonId,
          freeAgent: Boolean(player.seasons[player.seasons.length - 1].freeAgent),
          year: player.seasons[player.seasons.length - 1].year,
          age: player.seasons[player.seasons.length - 1].age,
          clubName: player.seasons[player.seasons.length - 1].clubName,
          matches: player.seasons[player.seasons.length - 1].matches,
          minutes: player.seasons[player.seasons.length - 1].minutes,
          goals: player.seasons[player.seasons.length - 1].goals,
          assists: player.seasons[player.seasons.length - 1].assists,
          cleanSheets: player.seasons[player.seasons.length - 1].cleanSheets,
          evidenceCleanSheets:
            player.seasons[player.seasons.length - 1].seasonEvidence?.total?.cleanSheets ??
            player.seasons[player.seasons.length - 1].seasonEvidence?.cleanSheets ??
            null,
          evidenceByScope: player.seasons[player.seasons.length - 1].seasonEvidence?.byScope || null,
          nonParticipation:
            player.seasons[player.seasons.length - 1].ledgerSummary?.nonParticipation || null,
          healthyTrainingFraction:
            player.seasons[player.seasons.length - 1].seasonEvidence?.healthyTrainingFraction ?? null,
          rawHealthyTrainingFraction:
            player.seasons[player.seasons.length - 1].seasonEvidence?.rawHealthyTrainingFraction ?? null,
          developmentPeriod:
            player.seasons[player.seasons.length - 1].developmentPeriod ||
            player.seasons[player.seasons.length - 1].seasonEvidence?.developmentPeriod ||
            null,
          healthEvidence: player.seasons[player.seasons.length - 1].seasonEvidence?.health || null,
          developmentBreakdownHealthy:
            player.seasons[player.seasons.length - 1].developmentBreakdown?.healthyTrainingFraction ??
            null,
        }
      : null,
    position: player.position || null,
    qaKo: player.__qaKoFixture || null,
    qaGk: player.__qaGkFixture || null,
    awardFieldKeys: Object.keys(player.awardFields || {}),
    nextAction: selectNextCareerAction(player),
    seasonActionInFlight,
    dealBookingGuard,
    isAcademy: Boolean(player.club?.isAcademy),
    academyLifecycle: player.academyLifecycle
      ? {
          status: player.academyLifecycle.status,
          periodCount: player.academyLifecycle.periodCount,
          pendingReviewId: player.academyLifecycle.pendingReviewId,
          exitAge: player.academyLifecycle.exitAge,
        }
      : null,
    academyCareerTotals: player.academyCareerTotals
      ? { ...player.academyCareerTotals }
      : null,
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
  await showSeniorScenarioOverlay(player, pending, {
    onPlayerUpdated: () => refreshOverview(),
  });
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

function syncSimulateButton() {
  if (!simulateBtn || !player) return;
  const next = selectNextCareerAction(player);
  simulateBtn.disabled = !next.canSimulate || player.isRetired;
  if (next.id === "free-agent") {
    simulateBtn.textContent = "Train / search as free agent";
  } else if (next.id === "resume-season") {
    simulateBtn.textContent = "Continue season";
  } else if (next.id === "academy-season") {
    simulateBtn.textContent = "Continue academy training";
  } else if (next.id === "academy-exit") {
    simulateBtn.textContent = "Resolve academy exit";
  } else if (next.id === "academy-review" || next.id === "academy-final-review") {
    simulateBtn.textContent = next.label;
  } else {
    simulateBtn.textContent = "Simulate Next Season";
  }
}

function handleSquadDecision(decision, choiceId) {
  const result = resolveSquadDecision(player, decision, choiceId);
  if (!result.ok) {
    window.alert(`That choice is not available: ${result.reason || "invalid"}.`);
    return result;
  }
  if (result.action === "reintegrate" && player.activeLoan?.status === "active") {
    endLoan(player, isFreeAgent(player) ? "expiry" : "return");
  }
  if (result.action === "stay" || result.action === "transfer-listed") {
    dealBookingGuard = null;
  }
  refreshTransferOffers();
  refreshOverview();
  const waiting =
    player.pendingOffers?.length > 0 || Boolean(player.pendingDecision);
  if (!waiting && player.seasonCheckpoint?.status === "awaiting_decision") {
    resumeSeasonAfterDecision();
    return result;
  }
  syncSimulateButton();
  return result;
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
  if (seasonActionInFlight || !player || player.isRetired) return;
  seasonActionInFlight = true;
  simulateBtn.disabled = true;

  let seasonData;
  try {
    // Interactive careers pause for senior scenes and the winter squad window.
    seasonData = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, { pauseForDecisions: true });

    if (!seasonData) {
      syncSimulateButton();
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
    await finalizeCompletedSeasonUi(seasonData);
  } catch (err) {
    console.error("Season simulation failed:", err);
    recoverSeasonPresentationFailure(err, { alert: true, committed: Boolean(seasonData?.season) });
  } finally {
    seasonActionInFlight = false;
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
    await finalizeCompletedSeasonUi(seasonData);
  } catch (err) {
    console.error("Season resume failed:", err);
    recoverSeasonPresentationFailure(err, { alert: true, committed: true });
  }
}

async function finalizeCompletedSeasonUi(seasonData) {
  if (!seasonData) {
    syncSimulateButton();
    return;
  }

  if (maybeAutoRetire()) {
    refreshOverview();
    if (seasonData.season) {
      const key = seasonHistoryKey(seasonData.season);
      if (key !== lastFinishedSeasonKey) {
        lastFinishedSeasonKey = key;
        appendSeasonCard(seasonData.season, seasonLogEl, player);
      }
    }
    refreshStandings();
    refreshCompetitions();
    refreshTransferOffers();
    simulateBtn.disabled = true;
    return;
  }

  if (player.activeLoan?.status === "active") {
    const seasonIndex = player.seasons.length;
    if (player.activeLoan.endSeason != null && seasonIndex >= player.activeLoan.endSeason) {
      if (player.pendingContractReview?.status === "pending") {
        // Soft-settle the ended borrower spell; unresolved parent boundary review
        // keeps tray ownership. Do not queue loan-return / promise free agency.
        endLoan(player, "return");
      } else {
        queueSquadDecision(player, "loan-return", {
          seasonIndex,
          performanceScore: seasonData.performanceScore,
        });
      }
    }
  }

  const isAcademyResult =
    seasonData.academyPeriod ||
    seasonData.reviewOnly ||
    Boolean(seasonData.season?.isNarrativeAcademyYear) ||
    Boolean(seasonData.season?.academyPeriod) ||
    Boolean(seasonData.resultKind?.startsWith?.("academy"));

  if (isAcademyResult) {
    // Academy lifecycle already produced the boundary review (or release).
    // Do not generate a second generic transfer window or reroll offers.
    if (player.club?.isAcademy) {
      ensureAcademyLifecycle(player);
      migrateAcademyLifecycle(player);
    }
  } else if (player.pendingContractReview?.status === "pending") {
    // Completed-evidence boundary review already owns the tray. Do not open an
    // unrelated default market phase that overwrites firm renewal authority.
    if (!player.pendingDecision && (player.pendingOffers?.length || 0) > 0) {
      // Keep existing boundary renewal decision/offers from simulateSeason.
    } else if (!player.pendingDecision) {
      const offers = generateTransferOffers(
        seasonData.performanceScore,
        player,
        LEAGUES,
        LEAGUE_LOOKUP,
        seasonData.season?.avgMatchRating ?? null
      );
      player.pendingOffers = offers;
    }
  } else {
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
  }

  ensureTransferSave(player);

  seasonData.revealedFixtureIds = player.simRevealCursor || seasonData.revealedFixtureIds || [];
  seasonData.continueDashboard = Boolean(seasonData.continueDashboard || player.simRevealCursor?.length);
  try {
    await showSeasonAnimation(
      seasonData,
      player,
      getDisplayAttributeKeys(player.position),
      finishSeasonAnimation
    );
  } catch (err) {
    // Engine state is already committed — restore the desk without re-simulating.
    recoverSeasonPresentationFailure(err, { alert: true, committed: true });
  }
}

function seasonHistoryKey(season) {
  if (!season) return null;
  return (
    season.seasonId ||
    `fa:${season.year}:${season.age}:${season.clubName || season.clubDisplay || ""}` ||
    null
  );
}

function finishSeasonAnimation() {
  const overlay = document.getElementById("season-animation-overlay");
  overlay?.classList.add("hidden");
  hideSimulationDashboard();
  if (player) player.simRevealCursor = null;

  const season = player?.seasons?.[player.seasons.length - 1];
  const key = seasonHistoryKey(season);

  refreshOverview();
  // Authoritative redraw — safe if Continue is activated more than once.
  if (key && key === lastFinishedSeasonKey) {
    // Already recorded this completion; still sync controls below.
  } else {
    lastFinishedSeasonKey = key;
    refreshSeasonLog();
  }
  refreshStandings();
  refreshCompetitions();
  refreshTransferOffers();

  syncSimulateButton();
}

/**
 * Presentation failed after (or without) a committed period. Never advances
 * another season or regenerates offers — only clears trapping UI.
 */
function recoverSeasonPresentationFailure(err, opts = {}) {
  console.error("Season presentation recovery:", err?.message || err, {
    committed: Boolean(opts.committed),
  });
  const overlay = document.getElementById("season-animation-overlay");
  overlay?.classList.add("hidden");
  hideSimulationDashboard();
  if (player) player.simRevealCursor = null;
  refreshAll();
  syncSimulateButton();
  if (opts.alert) {
    window.alert(
      `Season presentation failed: ${err?.message || err}. Your career desk has been restored.`
    );
  }
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
  // Always redraw the tray after a failed/successful parent attempt so alternatives
  // and decline/release controls stay aligned with the pending review.
  refreshTransferOffers();
  syncSimulateButton();
  return seniorName;
}

/** Browser QA seam for the standalone parent-signing helper (R4). */
window.__promoteToParentClub = promoteToParentClub;

function applyTransfer(offer) {
  if (!player || !offer) return;
  const guardKey = offer.offerId || offer.loanTerms?.loanId || `${offer.clubId}:${offer.dealType}`;
  if (dealBookingGuard && dealBookingGuard === guardKey) {
    console.warn("Blocked duplicate deal acceptance click.");
    return { ok: false, reason: "duplicate-click" };
  }
  dealBookingGuard = guardKey;
  player.suppressParentContractOffer = false;

  const playerNationality = player.nationality;
  if (offer.isLoan) {
    const loanResult = startLoan(player, offer);
    if (!loanResult.ok) {
      dealBookingGuard = null;
      window.alert(`Loan could not be completed: ${loanResult.reason || "validation failed"}.`);
      return loanResult;
    }
    player.nationality = playerNationality;
    if (player.attributes) refreshAbilityCaches(player);
    finishOfferWindow(true, offer);
    maybeResumeAfterWindowChoice();
    dealBookingGuard = null;
    return loanResult;
  }

  // Academy first-pro / review offers settle through the academy lifecycle so
  // exhausted final reviews release and remaining valid offers persist.
  const isAcademyReviewOffer =
    Boolean(player.club?.isAcademy) &&
    (offer.academyReviewId ||
      offer.isFirstPro ||
      offer.dealType === "first_pro" ||
      player.academyLifecycle?.pendingReview);

  if (isAcademyReviewOffer) {
    const result = acceptAcademyGraduationOffer(player, {
      offer,
      kind: offer.isParentOffer ? "parent" : "counter",
      club: null,
    });
    if (!result.ok) {
      dealBookingGuard = null;
      const reasonText = (result.reasons || [result.reason]).filter(Boolean).join(", ");
      let message = `Deal could not be completed: ${reasonText}.`;
      if (result.released) {
        message += " No executable academy offers remain — you are now a free agent.";
      } else if (result.action === "continue-academy") {
        message += " You remain at the academy and can continue training.";
      } else if ((result.remainingOffers || []).length > 0) {
        message += ` ${result.remainingOffers.length} other offer(s) remain available.`;
      }
      window.alert(message);
      refreshOverview();
      refreshTransferOffers();
      syncSimulateButton();
      return result;
    }
    player.nationality = playerNationality;
    if (player.attributes) refreshAbilityCaches(player);
    finishOfferWindow(true, offer);
    maybeResumeAfterWindowChoice();
    dealBookingGuard = null;
    return result;
  }

  const result = acceptPipelineOffer(player, offer);
  if (!result.ok) {
    dealBookingGuard = null;
    window.alert(
      `Deal could not be completed: ${(result.reasons || [result.reason]).join(", ")}.`
    );
    refreshTransferOffers();
    syncSimulateButton();
    return result;
  }

  player.nationality = playerNationality;
  if (player.attributes) refreshAbilityCaches(player);
  finishOfferWindow(true, offer);
  maybeResumeAfterWindowChoice();
  dealBookingGuard = null;
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
  if (!accepted) {
    if (player?.club?.isAcademy && player.academyLifecycle?.pendingReview) {
      declineAcademyReview(player, { reason: "academy-review-declined" });
    } else {
      declineWindowAndContinue(player, { choiceId: "decline-window" });
      // Boundary renewal tray declined → settle expiry once through shared lifecycle.
      if (player?.pendingContractReview?.status === "pending") {
        settleBoundaryContractReview(player, {
          choice: "decline",
          reason: "declined-boundary-offers",
        });
      }
    }
  } else {
    player.pendingOffers = [];
    // Successful accept already consumes related decision via pipeline.
    if (player.pendingDecision && (offer?.isRenewal || offer?.isLoan || offer?.clubId)) {
      player.pendingDecision = null;
    }
    if (player.academyLifecycle?.pendingReview) {
      player.academyLifecycle.pendingReview = null;
      player.academyLifecycle.pendingReviewId = null;
      player.academyLifecycle.status = player.club?.isAcademy ? "enrolled" : "graduated";
    }
  }
  transferContainer.innerHTML = "";
  if (!accepted) dealBookingGuard = null;

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
  } else if (isFreeAgent(player) || !player.club) {
    message = `${player.name} is a free agent. Search the market or train while waiting for interest.`;
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
  syncSimulateButton();
}

// Auto-mount deterministic QA fixtures from the query string for local acceptance.
(function bootQueryFixture() {
  try {
    const params = new URLSearchParams(window.location.search);
    const fixture = params.get("fixture");
    if (!fixture) return;
    if (fixture === "free-agent" || fixture === "free-agent-empty") {
      const mode = params.get("mode") || "empty";
      queueMicrotask(() => window.__loadFreeAgentBrowserFixture?.({ mode }));
    } else if (fixture === "free-agent-empty-result") {
      queueMicrotask(() => window.__loadFreeAgentBrowserFixture?.({ mode: "empty-result" }));
    } else if (fixture === "free-agent-offers") {
      queueMicrotask(() => window.__loadFreeAgentBrowserFixture?.({ mode: "offers" }));
    } else if (fixture === "free-agent-signed") {
      queueMicrotask(() => window.__loadFreeAgentBrowserFixture?.({ mode: "signed" }));
    } else if (fixture === "free-agent-retire") {
      queueMicrotask(() => window.__loadFreeAgentBrowserFixture?.({ mode: "retire-41" }));
    } else if (fixture === "free-agent-expiry") {
      queueMicrotask(() => window.__loadFreeAgentBrowserFixture?.({ mode: "expiry-club" }));
    } else if (fixture === "live-loan") {
      queueMicrotask(() => window.__loadLiveLoanBrowserFixture?.());
    } else if (fixture === "ownership-transfer") {
      queueMicrotask(() => window.__loadOwnershipTransferBrowserFixture?.());
    } else if (fixture === "fix05-ko" || fixture === "match-participation-ko") {
      queueMicrotask(() => window.__loadMatchParticipationKoBrowserFixture?.());
    } else if (fixture === "fix05-gk" || fixture === "match-participation-gk") {
      queueMicrotask(() => window.__loadMatchParticipationGkBrowserFixture?.());
    } else if (fixture === "academy" || fixture.startsWith("academy-")) {
      const mode = params.get("mode") || fixture.replace(/^academy-?/, "") || "continue-empty";
      queueMicrotask(() => window.__loadAcademyBrowserFixture?.({ mode: mode || "continue-empty" }));
    }
  } catch (err) {
    console.warn("Fixture boot skipped:", err);
  }
})();
