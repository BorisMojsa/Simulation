import { enrichTrophyWin, resolveTrophyAsset, trophyImageHtml } from "../data/trophyAssets.js";
import {
  abilityDisplayChange,
  abilityDisplayChangeTone,
  formatAbilityDisplayChange,
  formatAbilityForDisplay,
  rawAbilityEndpoints,
} from "./abilityFormatting.js";
import {
  runSimulationDashboard,
  hideSimulationDashboard,
  configureCompetitionTabs,
  getDashboardRevealState,
  setAwaitingChoice,
  setCompetitionMenuVisible,
} from "./simulationDashboard.js";
import { renderLeagueTable } from "./rendering.js";
import { playerEntitledToClubHonor } from "../simulation/playingRegistration.js";
import {
  assertUsableAcademyResult,
  ACADEMY_RESULT_KIND,
} from "../simulation/academyLifecycle.js";

let animationCtl = {
  skipMatch: false,
  skipPhase: false,
  skipAll: false,
  awaitingNextMatch: false,
  timers: [],
  resolveWait: null,
  resolveContinue: null,
  resolveNextMatch: null,
};

function formatSigned(n) {
  const v = Number(n) || 0;
  return v > 0 ? `+${v}` : `${v}`;
}

function clearTimers() {
  animationCtl.timers.forEach((id) => clearTimeout(id));
  animationCtl.timers = [];
  if (animationCtl.resolveWait) {
    animationCtl.resolveWait();
    animationCtl.resolveWait = null;
  }
}

function resetSkipFlags() {
  animationCtl.skipMatch = false;
  animationCtl.skipPhase = false;
  animationCtl.skipAll = false;
  animationCtl.awaitingNextMatch = false;
  animationCtl.resolveNextMatch = null;
  setSkipMatchButtonMode("skip");
}

function setSkipMatchButtonMode(mode) {
  const btn = document.getElementById("match-skip-btn");
  if (!btn) return;
  if (mode === "next") {
    btn.textContent = "Next match";
    btn.classList.add("primary");
    btn.classList.remove("secondary");
  } else {
    btn.textContent = "Skip match";
    btn.classList.add("secondary");
    btn.classList.remove("primary");
  }
}

function waitForNextMatchClick() {
  return new Promise((resolve) => {
    animationCtl.awaitingNextMatch = true;
    setSkipMatchButtonMode("next");
    animationCtl.resolveNextMatch = () => {
      animationCtl.resolveNextMatch = null;
      animationCtl.awaitingNextMatch = false;
      setSkipMatchButtonMode("skip");
      resolve();
    };
  });
}

function waitOrSkip(ms) {
  if (animationCtl.skipMatch || animationCtl.skipPhase || animationCtl.skipAll) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    let id = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(id);
      animationCtl.timers = animationCtl.timers.filter((t) => t !== id);
      if (animationCtl.resolveWait === finish) animationCtl.resolveWait = null;
      resolve();
    };
    animationCtl.resolveWait = finish;
    id = setTimeout(finish, ms);
    animationCtl.timers.push(id);
  });
}

/** Wait until user presses the phase Continue button. */
function waitForContinue() {
  return new Promise((resolve) => {
    animationCtl.resolveContinue = () => {
      animationCtl.resolveContinue = null;
      resolve();
    };
    showPhaseContinue(true);
  });
}

function showPhaseContinue(visible) {
  const section = document.getElementById("animation-continue");
  const btn = document.getElementById("continue-btn");
  if (!section || !btn) return;
  if (visible) {
    section.classList.remove("hidden");
    section.classList.add("active");
    btn.textContent = "Continue";
    btn.onclick = () => {
      if (animationCtl.resolveContinue) animationCtl.resolveContinue();
    };
  } else {
    section.classList.add("hidden");
    section.classList.remove("active");
    btn.onclick = null;
  }
}

function badgeHtml(club, className = "match-badge") {
  const isNation =
    club?.isNation ||
    (typeof club?.badge === "string" && club.badge.includes("flagcdn.com"));
  const classes = isNation ? `${className} nation-flag` : className;
  if (!club?.badge) {
    return `<div class="${classes} match-badge-fallback">${(club?.displayName || club?.name || "?").slice(0, 2)}</div>`;
  }
  return `<img src="${club.badge}" alt="${club.displayName || club.name}" class="${classes}" />`;
}

/**
 * Present a completed period result. Resolves after the player leaves the
 * result overlay (Continue), or rejects on invalid/unrecoverable presentation.
 * Callers must handle the returned promise — fire-and-forget leaves soft-locks.
 */
export function showSeasonAnimation(seasonData, player, statsKeys, onContinue) {
  const overlay = document.getElementById("season-animation-overlay");
  clearAnimationContent();
  resetSkipFlags();
  clearTimers();
  overlay?.classList.remove("hidden");
  wireSkipControls();

  return presentSeasonResult(seasonData, player, statsKeys, onContinue).catch((err) => {
    console.error("Season presentation failed:", err);
    closeSeasonOverlayForRecovery();
    throw err;
  });
}

function isMarkedFreeAgentResult(seasonData) {
  return Boolean(seasonData?.freeAgent || seasonData?.season?.freeAgent);
}

/**
 * Validate an explicitly marked free-agent engine result before showing a recap.
 * Classify by the result payload — not by the player's current contract state.
 */
export function assertUsableFreeAgentResult(seasonData) {
  if (!seasonData) return { ok: false, reason: "missing-season-data" };
  if (!isMarkedFreeAgentResult(seasonData)) {
    return { ok: false, reason: "not-marked-free-agent" };
  }
  if (seasonData.wait && seasonData.wait.ok === false) {
    return { ok: false, reason: seasonData.wait.reason || "free-agent-wait-failed" };
  }
  const season = seasonData.season;
  if (!season || typeof season !== "object") {
    return { ok: false, reason: "missing-free-agent-period" };
  }
  // A club campaign with real fixtures is never a free-agent recap, even if
  // the player is now released after that season.
  if ((Number(season.matches) || 0) > 0 && season.league && !season.freeAgent) {
    return { ok: false, reason: "club-season-misclassified" };
  }
  if (!season.freeAgent && !seasonData.freeAgent) {
    return { ok: false, reason: "unmarked-period-record" };
  }
  return { ok: true, season };
}

function closeSeasonOverlayForRecovery() {
  clearTimers();
  resetSkipFlags();
  showPhaseContinue(false);
  const btn = document.getElementById("continue-btn");
  if (btn) btn.onclick = null;
  hideSimulationDashboard();
  setSkipBarVisible(false);
  const overlay = document.getElementById("season-animation-overlay");
  overlay?.classList.add("hidden");
}

function isMarkedAcademyResult(seasonData) {
  if (!seasonData) return false;
  if (seasonData.academyPeriod || seasonData.reviewOnly) return true;
  const kind = seasonData.resultKind || seasonData.season?.resultKind;
  if (
    kind === ACADEMY_RESULT_KIND.PERIOD ||
    kind === ACADEMY_RESULT_KIND.REVIEW_ONLY ||
    kind === ACADEMY_RESULT_KIND.RELEASED ||
    kind === ACADEMY_RESULT_KIND.GRADUATED
  ) {
    return true;
  }
  return Boolean(
    seasonData.season?.isNarrativeAcademyYear || seasonData.season?.academyPeriod
  );
}

async function presentSeasonResult(seasonData, player, statsKeys, onContinue) {
  if (!seasonData) {
    throw new Error("No season data provided to animation");
  }

  // Academy before free-agent: a final youth year may also set freeAgent after release.
  if (isMarkedAcademyResult(seasonData)) {
    const check = assertUsableAcademyResult(seasonData);
    if (!check.ok) {
      throw new Error(`Invalid academy result: ${check.reason}`);
    }
    await presentAcademyRecap(seasonData, player, onContinue);
    return { kind: "academy" };
  }

  if (isMarkedFreeAgentResult(seasonData)) {
    const check = assertUsableFreeAgentResult(seasonData);
    if (!check.ok) {
      throw new Error(`Invalid free-agent result: ${check.reason}`);
    }
    await presentFreeAgentRecap(seasonData, player, onContinue);
    return { kind: "free-agent" };
  }

  await animateSeasonSequence(seasonData, player, statsKeys, onContinue);
  return { kind: "club-season" };
}

async function presentAcademyRecap(seasonData, player, onContinue) {
  setSkipBarVisible(false);
  hideSimulationDashboard();

  const season = seasonData.season;
  const section = document.getElementById("academy-recap");
  const info = document.getElementById("academy-recap-info");
  const body = document.getElementById("academy-recap-body");

  const periodNumber = season
    ? Number.isFinite(season.seasonNumber)
      ? season.seasonNumber
      : player?.seasons?.length || null
    : null;
  const age = season && Number.isFinite(season.age) ? season.age : player?.age;
  const yearBit = season && Number.isFinite(season.year) ? ` · ${season.year}` : "";
  const ageBit = Number.isFinite(age) ? ` · Age ${age}` : "";
  const periodLabel = seasonData.reviewOnly
    ? "Academy exit review"
    : periodNumber != null
      ? `Academy period ${periodNumber}`
      : "Academy period";

  if (info) {
    info.textContent = `${periodLabel}${yearBit}${ageBit}`;
  }

  const matches = Number(season?.matches) || 0;
  const goals = Number(season?.goals) || 0;
  const assists = Number(season?.assists) || 0;
  const ratingChange = Number(season?.ratingChange);
  const ratingLine = Number.isFinite(ratingChange)
    ? `${ratingChange >= 0 ? "+" : ""}${ratingChange.toFixed(1)} OVR`
    : "—";

  const boundary = seasonData.boundary || {};
  const pendingCount = Array.isArray(player?.pendingOffers) ? player.pendingOffers.length : 0;
  let outcomeCopy;
  if (boundary.released || seasonData.freeAgent || season?.academyReleased) {
    outcomeCopy =
      "You left the academy without a senior contract and are now a free agent. Search the market from the career desk.";
  } else if (pendingCount > 0) {
    outcomeCopy =
      pendingCount === 1
        ? "A senior contract offer is ready to review on the career desk."
        : `${pendingCount} senior contract offers are ready to review on the career desk.`;
  } else if (seasonData.reviewOnly) {
    outcomeCopy = "Academy exit review — no further youth year was simulated.";
  } else {
    outcomeCopy =
      "You remain enrolled at the academy. Youth matches are narrative training activity, not senior league appearances.";
  }

  if (body) {
    body.innerHTML = `
      <p class="academy-recap-status">Status: <strong>${
        boundary.released || seasonData.freeAgent
          ? "Free agent"
          : pendingCount > 0
            ? "Academy — contract review"
            : "Academy"
      }</strong></p>
      <p class="academy-recap-copy">${outcomeCopy}</p>
      ${
        season
          ? `<dl class="academy-recap-stats">
        <div><dt>Youth matches</dt><dd>${matches}</dd></div>
        <div><dt>Goals / assists</dt><dd>${goals} / ${assists}</dd></div>
        <div><dt>Development</dt><dd>${ratingLine}</dd></div>
      </dl>
      <p class="academy-recap-note">Senior league appearances this period: <strong>0</strong></p>`
          : `<p class="academy-recap-note">No academy year was added for this exit review.</p>`
      }
    `;
  }

  if (section) {
    section.classList.remove("hidden");
    section.classList.add("active");
  }

  await waitForFinalContinue(onContinue);
  hideSection("academy-recap");
}

async function presentFreeAgentRecap(seasonData, player, onContinue) {
  setSkipBarVisible(false);
  hideSimulationDashboard();

  const season = seasonData.season;
  const section = document.getElementById("free-agent-recap");
  const info = document.getElementById("free-agent-recap-info");
  const body = document.getElementById("free-agent-recap-body");

  const periodNumber = Number.isFinite(season.seasonNumber)
    ? season.seasonNumber
    : Number.isFinite(season.year)
      ? null
      : player?.seasons?.length || null;
  const periodLabel = periodNumber != null
    ? `Period ${periodNumber}`
    : Number.isFinite(season.year)
      ? `Year ${season.year}`
      : "Free-agent period";
  const age = Number.isFinite(season.age) ? season.age : player?.age;
  const yearBit = Number.isFinite(season.year) ? ` · ${season.year}` : "";
  const ageBit = Number.isFinite(age) ? ` · Age ${age}` : "";

  if (info) {
    info.textContent = `${periodLabel}${yearBit}${ageBit}`;
  }

  const pendingCount = Array.isArray(player?.pendingOffers) ? player.pendingOffers.length : 0;
  const offerMessage =
    pendingCount > 0
      ? `${pendingCount} club offer${pendingCount === 1 ? "" : "s"} ready to review on the career desk.`
      : "No suitable offers arrived this period.";

  if (body) {
    body.innerHTML = `
      <p class="free-agent-recap-status">Status: <strong>Free agent</strong></p>
      <p class="free-agent-recap-copy">
        You remained without a club while training and searching the market.
        No club appearances or minutes were recorded for this period.
      </p>
      <dl class="free-agent-recap-stats">
        <div><dt>Appearances</dt><dd>0</dd></div>
        <div><dt>Minutes</dt><dd>0</dd></div>
        <div><dt>Goals / assists</dt><dd>0 / 0</dd></div>
      </dl>
      <p class="free-agent-recap-offers" data-offer-count="${pendingCount}">${offerMessage}</p>
    `;
  }

  if (section) {
    section.classList.remove("hidden");
    section.classList.add("active");
  }

  await waitForFinalContinue(onContinue);
  hideSection("free-agent-recap");
}

function waitForFinalContinue(onContinue) {
  return new Promise((resolve, reject) => {
    let settled = false;
    showContinueButton(() => {
      if (settled) return;
      settled = true;
      try {
        showPhaseContinue(false);
        if (typeof onContinue === "function") onContinue();
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * Segmented live delivery: open the dashboard with committed fixtures so far.
 * Used for mid-season pauses and completed seasons.
 */
export async function openSimulationDashboardSegment(opts) {
  const overlay = document.getElementById("season-animation-overlay");
  overlay?.classList.remove("hidden");
  wireSkipControls();
  return runSimulationDashboard(opts);
}

export { hideSimulationDashboard, getDashboardRevealState, setAwaitingChoice };

function wireSkipControls() {
  const skipMatchBtn = document.getElementById("match-skip-btn");
  const skipPhaseBtn = document.getElementById("match-skip-phase-btn");
  if (skipMatchBtn) {
    skipMatchBtn.onclick = () => {
      if (animationCtl.awaitingNextMatch) {
        if (animationCtl.resolveNextMatch) animationCtl.resolveNextMatch();
        return;
      }
      animationCtl.skipMatch = true;
      if (animationCtl.resolveWait) animationCtl.resolveWait();
    };
  }
  if (skipPhaseBtn) {
    skipPhaseBtn.onclick = () => {
      animationCtl.skipMatch = true;
      animationCtl.skipPhase = true;
      if (animationCtl.awaitingNextMatch && animationCtl.resolveNextMatch) {
        animationCtl.resolveNextMatch();
        return;
      }
      if (animationCtl.resolveWait) animationCtl.resolveWait();
    };
  }
}

function clearAnimationContent() {
  hideSimulationDashboard();
  const rail = document.getElementById("match-card-rail");
  if (rail) rail.innerHTML = "";
  const host = document.getElementById("league-table-host");
  if (host) host.innerHTML = "";
  const sections = [
    "simulation-dashboard",
    "match-viewer-section",
    "league-animation",
    "cup-animation",
    "european-animation",
    "international-callup-animation",
    "international-animation",
    "awards-animation",
    "trophies-animation",
    "summary-animation",
    "overall-reveal",
    "free-agent-recap",
    "academy-recap",
    "animation-continue",
  ];

  sections.forEach((sectionId) => {
    const section = document.getElementById(sectionId);
    if (section) {
      section.classList.add("hidden");
      section.classList.remove("active");
    }
  });

  [
    "league-table-rows",
    "cup-rounds",
    "european-rounds",
    "international-tournaments",
    "international-announcement",
    "awards-items",
    "trophies-items",
    "player-stats-grid",
    "rating-changes-grid",
    "match-events-feed",
    "league-trophy-banner",
  ].forEach((sectionId) => {
    const section = document.getElementById(sectionId);
    if (section) section.innerHTML = "";
  });

  const oldRating = document.getElementById("old-rating-value");
  const newRating = document.getElementById("new-rating-value");
  const ratingArrow = document.querySelector(".rating-arrow");
  const ratingChangeText = document.getElementById("rating-change-text");

  if (oldRating) {
    oldRating.textContent = "";
    oldRating.classList.remove("animate-in", "positive", "negative");
  }
  if (newRating) {
    newRating.textContent = "";
    newRating.classList.remove("animate-in", "positive", "negative");
  }
  if (ratingArrow) ratingArrow.classList.remove("animate-in");
  if (ratingChangeText) {
    ratingChangeText.textContent = "";
    ratingChangeText.classList.remove("animate-in", "positive", "negative");
  }
}

async function animateSeasonSequence(seasonData, player, statsKeys, onContinue) {
  if (!seasonData) {
    throw new Error("No season data provided to animation");
  }

  const {
    season,
    league,
    standings,
    europeanCampaign,
    domesticCupResult,
    internationalSeason,
    individualAwards,
    attributeChanges,
    previousRating,
    newRating,
  } = seasonData;
  const domesticCupCampaigns =
    (Array.isArray(seasonData.domesticCupCampaigns) && seasonData.domesticCupCampaigns.length
      ? seasonData.domesticCupCampaigns
      : null) ||
    (Array.isArray(season.domesticCupCampaigns) && season.domesticCupCampaigns.length
      ? season.domesticCupCampaigns
      : null) ||
    (domesticCupResult ? [domesticCupResult] : []);

  if (!season || !league || !standings) {
    console.error("Missing required season data:", { season, league, standings });
    throw new Error("Missing required season data");
  }

  // 1) Live league dashboard — full fixture store + player cards + live table
  configureCompetitionTabs({
    hasCup: Boolean(
      domesticCupCampaigns.some((c) => c?.playerMatches?.length || c?.name) ||
        domesticCupResult?.playerMatches?.length ||
        domesticCupResult?.name
    ),
    hasContinental: Boolean(europeanCampaign && europeanCampaign.qualified !== false),
    hasNational: Boolean(internationalSeason || season.internationalSeason),
  });
  const allMatches = seasonData.leagueAllMatches || season.leagueAllMatches || [];
  const playerLeagueMatches =
    seasonData.leaguePlayerMatches ||
    season.leagueMatches ||
    (Array.isArray(season.leagueMatchSegments)
      ? season.leagueMatchSegments.flatMap((s) => s.matches || [])
      : []);
  await runSimulationDashboard({
    player,
    league,
    seasonNumber: season.seasonNumber,
    allMatches,
    playerMatches: playerLeagueMatches,
    seedClubs: league.clubs,
    revealedFixtureIds: seasonData.revealedFixtureIds || player.simRevealCursor || null,
    reset: !seasonData.continueDashboard,
  });
  setCompetitionMenuVisible(false);
  // Keep dashboard visible with final table; brief continue before other comps
  showPhaseContinue(true);
  await waitForContinue();
  showPhaseContinue(false);
  hideSimulationDashboard();
  resetSkipFlags();
  clearTimers();

  // 2) Domestic cup(s) — preserve cross-association campaigns separately
  setSkipBarVisible(true);
  animationCtl.skipPhase = false;
  animationCtl.skipAll = false;
  const cupMatchesChrono = domesticCupCampaigns
    .flatMap((c) => (c?.playerMatches || []).map((m) => ({ ...m, _cupName: c.name })))
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  const cupPhaseLabel =
    domesticCupCampaigns.length > 1
      ? domesticCupCampaigns.map((c) => c.name).filter(Boolean).join(" · ")
      : domesticCupResult?.name || domesticCupCampaigns[0]?.name || "Domestic Cup";
  await playMatchList(cupMatchesChrono, {
    competitionLabel: cupPhaseLabel,
    phaseLabel: cupPhaseLabel,
    showMatchCount: false,
  });
  setSkipBarVisible(false);
  hideSection("match-viewer-section");

  for (const campaign of domesticCupCampaigns) {
    showCupBracket(campaign, player);
    await waitForContinue();
    hideSection("cup-animation");
    showPhaseContinue(false);
  }
  if (!domesticCupCampaigns.length && domesticCupResult) {
    showCupBracket(domesticCupResult, player);
    await waitForContinue();
    hideSection("cup-animation");
    showPhaseContinue(false);
  }

  // 3) Continental / Europe
  setSkipBarVisible(true);
  animationCtl.skipPhase = false;
  animationCtl.skipAll = false;
  if (europeanCampaign?.showcase) {
    setSkipBarVisible(false);
    showEuropeShowcase(europeanCampaign);
    await waitForContinue();
    hideSection("european-animation");
    showPhaseContinue(false);
  } else if (europeanCampaign) {
    await playMatchList(europeanCampaign.playerMatches || [], {
      competitionLabel: europeanCampaign.competition,
      phaseLabel: europeanCampaign.competition,
      showMatchCount: false,
    });
    setSkipBarVisible(false);
    hideSection("match-viewer-section");
    showEuropePath(europeanCampaign, player);
    await waitForContinue();
    hideSection("european-animation");
    showPhaseContinue(false);
  }

  // 4) National team call-up announcement (own screen)
  const intl = internationalSeason || season.internationalSeason;
  if (intl) {
    showInternationalCallUp(intl, player);
    await waitForContinue();
    hideSection("international-callup-animation");
    showPhaseContinue(false);

    // Then internationals / tournaments — same dashboard (match left, live group/bracket right)
    if (intl.calledUp && intl.playerMatches?.length) {
      const primary = intl.primary || intl.tournaments?.find((t) => t.calledUp);
      const { buildNationalPlaybackContext } = await import("../simulation/competitionPlayback.js");
      const ctx = buildNationalPlaybackContext({ tournament: primary, player });
      const groupFixtures = (primary?.groups || []).flatMap((g) => g.matches || []);
      const allIntl = [
        ...groupFixtures,
        ...(primary?.allRounds || []).flatMap((r) => r.matches || []),
      ];
      // Prefer store-identical player matches; include same-batch group mates for table updates.
      await runSimulationDashboard({
        player,
        league,
        seasonNumber: season.seasonNumber,
        allMatches: allIntl.length ? allIntl : intl.playerMatches,
        playerMatches: intl.playerMatches,
        competitionContext: ctx,
        reset: true,
      });
      hideSimulationDashboard();
    }

    if (intl.hasTournaments || intl.tournaments?.length) {
      showInternationalCompetitions(intl, player);
      await waitForContinue();
      hideSection("international-animation");
      showPhaseContinue(false);
    }
  }

  // 5) Trophies won this season
  const trophyWins = collectSeasonTrophyWins(season, league, domesticCupResult, europeanCampaign, intl);
  if (trophyWins.length) {
    showTrophiesAnimation(trophyWins, season);
    await waitForContinue();
    hideSection("trophies-animation");
    showPhaseContinue(false);
  }

  // 6) Awards
  showAwardsAnimation(season, individualAwards || []);
  await waitForContinue();
  hideSection("awards-animation");
  showPhaseContinue(false);

  // 7) Summary
  showSummaryAnimation(season, attributeChanges, statsKeys);
  await waitForContinue();
  hideSection("summary-animation");
  showPhaseContinue(false);

  // 8) Overall
  showOverallRatingReveal(season, previousRating, newRating);
  await waitForContinue();
  hideSection("overall-reveal");
  showPhaseContinue(false);

  // Final continue closes overlay via caller — keep the promise pending until then.
  await waitForFinalContinue(onContinue);
}

function setSkipBarVisible(visible) {
  const bar = document.getElementById("match-skip-bar");
  if (!bar) return;
  bar.classList.toggle("hidden", !visible);
  if (visible) {
    // Always re-bind — dashboard uses different button IDs; cup/continental need these.
    wireSkipControls();
    animationCtl.awaitingNextMatch = false;
    animationCtl.resolveNextMatch = null;
    animationCtl.skipMatch = false;
    setSkipMatchButtonMode("skip");
    const phaseBtn = document.getElementById("match-skip-phase-btn");
    if (phaseBtn) phaseBtn.textContent = "Skip phase";
  }
}

function hideSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add("hidden");
  el.classList.remove("active");
}

function showSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("hidden");
  el.classList.add("active");
}

async function playMatchList(matches, { competitionLabel, phaseLabel, showMatchCount = true }) {
  if (!matches?.length) return;

  showSection("match-viewer-section");
  const phaseEl = document.getElementById("match-phase-label");
  if (phaseEl) phaseEl.textContent = phaseLabel || competitionLabel;

  for (let i = 0; i < matches.length; i++) {
    if (animationCtl.skipPhase || animationCtl.skipAll) break;
    animationCtl.skipMatch = false;
    const match = matches[i];
    const progress = document.getElementById("match-progress-label");
    if (progress) {
      if (showMatchCount) {
        progress.textContent = `Match ${i + 1} of ${matches.length}`;
      } else {
        progress.textContent = match.round || "";
      }
    }
    await playSingleMatch(match, competitionLabel);
  }

  animationCtl.skipPhase = false;
  animationCtl.skipMatch = false;
}

function liveContributionText(live) {
  const bits = [];
  if (live.goals) bits.push(`${live.goals}G`);
  if (live.assists) bits.push(`${live.assists}A`);
  if (live.yellow) bits.push(`${live.yellow}Y`);
  if (live.red) bits.push(`${live.red}R`);
  return bits.length ? `Your contribution: ${bits.join(" · ")}` : "";
}

async function playSingleMatch(match, competitionLabel) {
  const homeName = document.getElementById("match-home-name");
  const awayName = document.getElementById("match-away-name");
  const homeBadge = document.getElementById("match-home-badge");
  const awayBadge = document.getElementById("match-away-badge");
  const homeScore = document.getElementById("match-home-score");
  const awayScore = document.getElementById("match-away-score");
  const clock = document.getElementById("match-clock");
  const roundEl = document.getElementById("match-round-label");
  const feed = document.getElementById("match-events-feed");
  const playerNote = document.getElementById("match-player-note");

  if (homeName) homeName.textContent = match.home?.displayName || match.home?.name || "Home";
  if (awayName) awayName.textContent = match.away?.displayName || match.away?.name || "Away";
  if (homeBadge) homeBadge.innerHTML = badgeHtml(match.home);
  if (awayBadge) awayBadge.innerHTML = badgeHtml(match.away);
  if (homeScore) homeScore.textContent = "0";
  if (awayScore) awayScore.textContent = "0";
  if (clock) clock.textContent = "0'";
  if (roundEl) {
    const cup = match.cupName || competitionLabel || "";
    roundEl.textContent = [cup, match.round].filter(Boolean).join(" · ");
  }
  if (feed) feed.innerHTML = "";

  // Start empty — reveal contribution live with events
  if (playerNote) {
    if (match.playerSide) {
      playerNote.textContent = "You are playing";
      playerNote.classList.remove("hidden");
    } else {
      playerNote.textContent = "";
      playerNote.classList.add("hidden");
    }
  }

  const events = [...(match.events || [])].sort((a, b) => a.minute - b.minute);
  let h = 0;
  let a = 0;
  let eventIdx = 0;
  const live = { goals: 0, assists: 0, yellow: 0, red: 0 };

  // ~7.5s match so the clock is followable
  const durationMs = 7500;
  const steps = 30;
  const stepMs = durationMs / steps;

  for (let step = 0; step <= steps; step++) {
    if (animationCtl.skipMatch || animationCtl.skipPhase || animationCtl.skipAll) break;
    const minute = Math.min(90, Math.round((step / steps) * 90));
    if (clock) clock.textContent = `${minute}'`;

    while (eventIdx < events.length && events[eventIdx].minute <= minute) {
      const ev = events[eventIdx++];
      if (ev.type === "goal") {
        if (ev.team === "home") h += 1;
        else a += 1;
        if (homeScore) homeScore.textContent = String(h);
        if (awayScore) awayScore.textContent = String(a);
        if (ev.playerInvolved) live.goals += 1;
      } else if (ev.type === "assist" && ev.playerInvolved) {
        live.assists += 1;
      } else if (ev.type === "yellow" && ev.playerInvolved) {
        live.yellow += 1;
      } else if (ev.type === "red" && ev.playerInvolved) {
        live.red += 1;
      }
      appendEvent(feed, ev);
      if (playerNote && match.playerSide) {
        const text = liveContributionText(live);
        playerNote.textContent = text || "You are playing";
      }
    }

    await waitOrSkip(stepMs);
  }

  if (homeScore) homeScore.textContent = String(match.homeGoals ?? h);
  if (awayScore) awayScore.textContent = String(match.awayGoals ?? a);
  if (clock) clock.textContent = "FT";
  while (eventIdx < events.length) {
    const ev = events[eventIdx++];
    if (ev.type === "goal") {
      if (ev.playerInvolved) live.goals += 1;
    } else if (ev.type === "assist" && ev.playerInvolved) live.assists += 1;
    else if (ev.type === "yellow" && ev.playerInvolved) live.yellow += 1;
    else if (ev.type === "red" && ev.playerInvolved) live.red += 1;
    appendEvent(feed, ev);
  }

  if (playerNote && match.playerSide) {
    const rating = match.playerStats?.rating;
    const contrib = liveContributionText(live);
    const ratingBit = rating != null ? `Match rating ${rating.toFixed(1)}` : "";
    playerNote.textContent = [contrib || "Featured", ratingBit].filter(Boolean).join(" · ");
    playerNote.classList.remove("hidden");
  }

  // Skip match: hold on FT scoreline until user clicks Next match (or Skip phase)
  if (animationCtl.skipMatch && !animationCtl.skipPhase && !animationCtl.skipAll) {
    await waitForNextMatchClick();
    animationCtl.skipMatch = false;
    return;
  }

  if (!(animationCtl.skipPhase || animationCtl.skipAll)) {
    await waitOrSkip(900);
  }
}

function appendEvent(feed, ev) {
  if (!feed || !ev) return;
  const row = document.createElement("div");
  row.className = `match-event match-event-${ev.type}${ev.playerInvolved ? " match-event-you" : ""}`;
  const typeLabel =
    ev.type === "goal"
      ? "GOAL"
      : ev.type === "assist"
        ? "ASSIST"
        : ev.type === "yellow"
          ? "YELLOW"
          : ev.type === "red"
            ? "RED"
            : ev.type.toUpperCase();
  row.innerHTML = `<span class="match-event-min">${ev.minute}'</span><span class="match-event-type">${typeLabel}</span><span class="match-event-label">${ev.label || ""}</span>`;
  feed.prepend(row);
}

function showCupBracket(domesticCupResult, player) {
  showSection("cup-animation");
  const cupInfo = document.getElementById("cup-info");
  const cupRounds = document.getElementById("cup-rounds");
  if (!domesticCupResult) {
    if (cupInfo) cupInfo.textContent = "No cup this season";
    if (cupRounds) cupRounds.innerHTML = '<div class="empty-state">No domestic cup</div>';
    return;
  }

  if (cupInfo) {
    cupInfo.textContent = `${domesticCupResult.name} — ${domesticCupResult.result}${
      domesticCupResult.won ? " · Champions" : ""
    }`;
  }
  if (!cupRounds) return;
  cupRounds.innerHTML = "";

  if (domesticCupResult.won) {
    const asset = resolveTrophyAsset({
      kind: "cup",
      simKey: domesticCupResult.name,
      competition: domesticCupResult.name,
    });
    const winEl = document.createElement("div");
    winEl.className = "cup-round animate-in trophy-inline-win";
    winEl.innerHTML = `
      <div class="league-trophy-win">
        ${
          asset
            ? trophyImageHtml(asset, { className: "league-trophy-img", alt: asset.trophyName })
            : `<div class="trophy-win-fallback" aria-hidden="true"></div>`
        }
        <div>
          <p class="trophy-win-kicker">Cup winners</p>
          <h3>${domesticCupResult.name}</h3>
          <p>${asset?.trophyName || "Domestic cup trophy"}</p>
        </div>
      </div>
    `;
    cupRounds.appendChild(winEl);
  }

  (domesticCupResult.rounds || []).forEach((r) => {
    const el = document.createElement("div");
    el.className = `cup-round animate-in${r.qualified ? " qualified" : ""}`;
    el.innerHTML = `
      <div class="round-name">${r.round}</div>
      <div class="round-result">${badgeHtml(
        { badge: r.opponentBadge, displayName: r.opponent, name: r.opponentName },
        "opponent-badge"
      )}<strong>${r.opponent}</strong> · ${r.score}${r.qualified ? " · advanced" : " · out"}</div>
    `;
    cupRounds.appendChild(el);
  });

  if (domesticCupResult.finalMatch) {
    const fm = domesticCupResult.finalMatch;
    const el = document.createElement("div");
    el.className = "cup-round animate-in final-bracket-card";
    el.innerHTML = `
      <div class="round-name">${domesticCupResult.name} Final</div>
      <div class="round-result europe-final-result">
        <span class="europe-final-side">${badgeHtml(fm.home, "opponent-badge")}${fm.home.displayName}</span>
        <span class="europe-final-score">${fm.scoreline}</span>
        <span class="europe-final-side">${badgeHtml(fm.away, "opponent-badge")}${fm.away.displayName}</span>
      </div>
      <div class="round-result" style="margin-top:0.45rem">Winner: <strong>${
        domesticCupResult.winner || "—"
      }</strong></div>
    `;
    cupRounds.appendChild(el);
  }

  appendFullBracketCard(cupRounds, {
    title: `${domesticCupResult.name} — full bracket`,
    allRounds: domesticCupResult.allRounds,
    highlightName: player.club?.name,
    competitionName: domesticCupResult.name,
  });
}

export function playerEntitledToEuropeTrophy(europeanCampaign, player) {
  if (!europeanCampaign?.won || !europeanCampaign?.winningClubId) return false;
  if (europeanCampaign.playerEntitled === true) return true;
  if (europeanCampaign.playerEntitled === false) return false;
  if (!player) return false;
  return playerEntitledToClubHonor(player, {
    winningClubId: europeanCampaign.winningClubId,
    competitionId: europeanCampaign.competitionId || europeanCampaign.competition,
    playerMatches: europeanCampaign.playerMatches,
    requireContribution: true,
  });
}

function showEuropePath(europeanCampaign, player) {
  showSection("european-animation");
  const info = document.getElementById("european-info");
  const rounds = document.getElementById("european-rounds");
  if (info) {
    info.textContent = `${europeanCampaign.competition} — ${europeanCampaign.result}`;
  }
  if (!rounds) return;
  rounds.innerHTML = "";

  const personalWin = playerEntitledToEuropeTrophy(europeanCampaign, player);
  if (personalWin) {
    const asset = resolveTrophyAsset({
      kind: "continental",
      simKey: europeanCampaign.competition,
      competition: europeanCampaign.competition,
    });
    const winEl = document.createElement("div");
    winEl.className = "european-round animate-in trophy-inline-win";
    winEl.innerHTML = `
      <div class="league-trophy-win">
        ${
          asset
            ? trophyImageHtml(asset, { className: "league-trophy-img", alt: asset.trophyName })
            : `<div class="trophy-win-fallback" aria-hidden="true"></div>`
        }
        <div>
          <p class="trophy-win-kicker">Continental champions</p>
          <h3>${europeanCampaign.competition}</h3>
          <p>${asset?.trophyName || "Continental trophy"}</p>
        </div>
      </div>
    `;
    rounds.appendChild(winEl);
  } else if (europeanCampaign.won && europeanCampaign.winningClubId) {
    // World focus-club win without player entitlement — show attributed result, not a personal trophy.
    const clubLabel =
      europeanCampaign.winner?.displayName ||
      europeanCampaign.winner?.name ||
      europeanCampaign.winningClubId;
    const winEl = document.createElement("div");
    winEl.className = "european-round animate-in";
    winEl.innerHTML = `
      <div class="round-name">Champions</div>
      <div class="round-result"><strong>${clubLabel}</strong> won the ${europeanCampaign.competition}</div>
    `;
    rounds.appendChild(winEl);
  }

  (europeanCampaign.rounds || []).forEach((r) => {
    const el = document.createElement("div");
    el.className = `european-round animate-in${r.qualified ? " qualified" : ""}`;
    el.innerHTML = `
      <div class="round-name">${r.round}</div>
      <div class="round-result">${badgeHtml(
        { badge: r.opponentBadge, displayName: r.opponent },
        "opponent-badge"
      )}<strong>${r.opponent}</strong> · ${r.score}${r.qualified ? " · advanced" : " · out"}</div>
    `;
    rounds.appendChild(el);
  });

  if (europeanCampaign.finalMatch) {
    const fm = europeanCampaign.finalMatch;
    const el = document.createElement("div");
    el.className = "european-round animate-in final-bracket-card";
    el.innerHTML = `
      <div class="round-name">${europeanCampaign.competition} Final</div>
      <div class="round-result europe-final-result">
        <span class="europe-final-side">${badgeHtml(fm.home, "opponent-badge")}${fm.home.displayName}</span>
        <span class="europe-final-score">${fm.scoreline}</span>
        <span class="europe-final-side">${badgeHtml(fm.away, "opponent-badge")}${fm.away.displayName}</span>
      </div>
      <div class="round-result" style="margin-top:0.45rem">Winner: <strong>${
        europeanCampaign.winner || "—"
      }</strong></div>
    `;
    rounds.appendChild(el);
  }

  if (europeanCampaign.leaguePhase?.table?.length) {
    const lp = europeanCampaign.leaguePhase;
    const el = document.createElement("div");
    el.className = "european-round animate-in";
    const rows = lp.table
      .map(
        (r) => `<tr class="${r.name === player.club?.name ? "is-player" : ""}"><td>${r.position}</td><td>${
          r.displayName || r.name
        }</td><td>${r.played}</td><td>${r.wins}</td><td>${r.draws}</td><td>${r.losses}</td><td>${
          r.goalDiff
        }</td><td>${r.points}</td><td>${r.band || ""}</td></tr>`
      )
      .join("");
    el.innerHTML = `
      <div class="round-name">${lp.openingLabel || "League phase"}</div>
      <div class="comp-table-wrap"><table class="comp-table"><thead><tr>
        <th>#</th><th>Club</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th><th>Band</th>
      </tr></thead><tbody>${rows}</tbody></table></div>`;
    rounds.appendChild(el);
  }

  if (europeanCampaign.groups?.groups?.length) {
    const el = document.createElement("div");
    el.className = "european-round animate-in";
    el.innerHTML = `<div class="round-name">${
      europeanCampaign.groups.openingLabel || "Group stage"
    }</div>${europeanCampaign.groups.groups
      .map((g) => {
        const rows = (g.table || [])
          .map(
            (r) =>
              `<tr class="${r.name === player.club?.name ? "is-player" : ""}"><td>${r.position}</td><td>${
                r.displayName || r.name
              }</td><td>${r.points}</td><td>${r.goalDiff}</td></tr>`
          )
          .join("");
        return `<div class="comp-group"><h4>${g.name}</h4><table class="comp-table"><thead><tr><th>#</th><th>Club</th><th>Pts</th><th>GD</th></tr></thead><tbody>${rows}</tbody></table></div>`;
      })
      .join("")}`;
    rounds.appendChild(el);
  }

  appendFullBracketCard(rounds, {
    title: `${europeanCampaign.competition} — knockout draw`,
    allRounds: europeanCampaign.allRounds,
    highlightName: player.club?.name,
    competitionName: europeanCampaign.competition,
    feederGraph: europeanCampaign.feederGraph,
  });
}

function showEuropeShowcase(europeanCampaign) {
  showSection("european-animation");
  const info = document.getElementById("european-info");
  const rounds = document.getElementById("european-rounds");
  const confLabel =
    europeanCampaign.confederation === "conmebol"
      ? "South American finals"
      : europeanCampaign.confederation === "concacaf"
        ? "CONCACAF finals"
        : "European finals";
  if (info) info.textContent = `Not qualified — ${confLabel}`;
  if (!rounds) return;
  rounds.innerHTML = "";

  (europeanCampaign.competitions || []).forEach((comp, index) => {
    const el = document.createElement("div");
    el.className = "european-round animate-in";
    const a = comp.finalists?.[0];
    const b = comp.finalists?.[1];
    const score = comp.finalMatch?.scoreline || "";
    const detailId = `europe-showcase-detail-${index}`;
    el.innerHTML = `
      <div class="round-name">${comp.competition}</div>
      <div class="round-result europe-final-result">
        <span class="europe-final-side">${badgeHtml(a, "opponent-badge")}${a?.displayName || "—"}</span>
        <span class="europe-final-score">${score}</span>
        <span class="europe-final-side">${badgeHtml(b, "opponent-badge")}${b?.displayName || "—"}</span>
      </div>
      <div class="round-result" style="margin-top:0.4rem">Winner: <strong>${comp.winner || "—"}</strong></div>
      <div class="bracket-toggle-row">
        <button type="button" class="secondary bracket-toggle" data-target="${detailId}">View full bracket</button>
      </div>
      <div id="${detailId}" class="bracket-detail hidden">${buildKnockoutBracketHtml(
        comp.allRounds,
        null,
        comp.competition,
        comp.feederGraph
      )}</div>
    `;
    rounds.appendChild(el);
    wireBracketToggle(el);
    hydrateBracketInteractions(el);
    setTimeout(() => el.classList.add("animate-in"), index * 120);
  });
}

function showInternationalCallUp(intl, player) {
  showSection("international-callup-animation");
  const info = document.getElementById("international-callup-info");
  const ann = document.getElementById("international-announcement");

  if (info) {
    if (intl.callUpTournament) {
      info.textContent = `${intl.year} · ${intl.callUpTournament} squad announcement`;
    } else if (intl.hasTournaments) {
      info.textContent = `${intl.year} · no national tournament for ${player.nationality || "you"}`;
    } else {
      info.textContent = `${intl.year} · international window`;
    }
  }

  if (!ann) return;
  ann.classList.remove(
    "hidden",
    "tone-called-up",
    "tone-surprise-in",
    "tone-shock-out",
    "tone-out",
    "tone-neutral"
  );
  ann.classList.add(`tone-${intl.announcementTone || "neutral"}`);
  const chanceBit =
    intl.hasTournaments && intl.callUpChancePct != null && intl.callUpTournament
      ? `<div class="intl-chance">Call-up odds ≈ ${intl.callUpChancePct}%</div>`
      : "";
  const statusLabel = intl.calledUp
    ? "Selected"
    : intl.callUpTournament
      ? "Not selected"
      : "No call-up window";
  ann.innerHTML = `
    <div class="intl-callup-status">${statusLabel}</div>
    <div class="intl-announcement-text">${intl.announcement || ""}</div>
    ${chanceBit}
  `;
  ann.classList.remove("hidden");
}

function showInternationalCompetitions(intl, player) {
  showSection("international-animation");
  const info = document.getElementById("international-info");
  const list = document.getElementById("international-tournaments");

  if (info) {
    info.textContent = intl.hasTournaments
      ? `${intl.year} international calendar`
      : `${intl.year} — no major tournaments`;
  }

  if (!list) return;
  list.innerHTML = "";

  if (!intl.hasTournaments || !intl.tournaments?.length) {
    list.innerHTML = `<div class="empty-state">${intl.announcement || "No internationals this year."}</div>`;
    return;
  }

  intl.tournaments.forEach((t, index) => {
    const card = document.createElement("div");
    card.className = "intl-tournament-card animate-in";
    if (t.calledUp) card.classList.add("intl-called-up");

    const fm = t.finalMatch;
    const detailId = `intl-detail-${t.id || index}`;
    const playerWon = Boolean(t.won && t.calledUp);
    const trophyAsset = playerWon
      ? resolveTrophyAsset({ kind: "international", competition: t.name, simKey: t.name })
      : null;
    const trophyBlock = playerWon
      ? `<div class="league-trophy-win" style="margin-bottom:0.85rem">
          ${
            trophyAsset
              ? trophyImageHtml(trophyAsset, { className: "league-trophy-img", alt: trophyAsset.trophyName })
              : `<div class="trophy-win-fallback" aria-hidden="true"></div>`
          }
          <div>
            <p class="trophy-win-kicker">International champions</p>
            <h3>${t.name}</h3>
            <p>${trophyAsset?.trophyName || "Tournament trophy"}</p>
          </div>
        </div>`
      : "";

    card.innerHTML = `
      ${trophyBlock}
      <div class="intl-tournament-header">
        <div>
          <div class="round-name">${t.name} ${t.year || ""}</div>
          <div class="round-result">${
            t.calledUp
              ? `You featured · ${t.result || ""}`
              : t.playerNationInTournament
                ? `${player.nationality} in the field · you were not selected`
                : "Tournament concluded"
          }</div>
        </div>
        <button type="button" class="secondary bracket-toggle" data-target="${detailId}">View groups &amp; bracket</button>
      </div>
      <div class="round-result europe-final-result" style="margin-top:0.75rem">
        <span class="europe-final-side">${badgeHtml(fm?.home, "opponent-badge")}${
      fm?.home?.displayName || "—"
    }</span>
        <span class="europe-final-score">${fm?.scoreline || "Final"}</span>
        <span class="europe-final-side">${badgeHtml(fm?.away, "opponent-badge")}${
      fm?.away?.displayName || "—"
    }</span>
      </div>
      <div class="round-result" style="margin-top:0.4rem">Winner: <strong>${t.winner || "—"}</strong></div>
      <div id="${detailId}" class="bracket-detail intl-detail hidden">${buildIntlDetailHtml(t, player)}</div>
    `;

    list.appendChild(card);
    wireBracketToggle(card, {
      openLabel: "View groups & bracket",
      closeLabel: "Hide groups & bracket",
    });
    hydrateBracketInteractions(card);
  });
}

function appendFullBracketCard(container, { title, allRounds, highlightName, competitionName, feederGraph }) {
  if (!container || !allRounds?.length) return;
  const el = document.createElement("div");
  el.className = "cup-round animate-in";
  const detailId = `bracket-detail-${Math.random().toString(36).slice(2, 9)}`;
  const compName = competitionName || String(title || "").replace(/\s*[—-].*$/, "").trim();
  el.innerHTML = `
    <div class="intl-tournament-header">
      <div class="round-name">${title}</div>
      <button type="button" class="secondary bracket-toggle" data-target="${detailId}">View full bracket</button>
    </div>
    <div id="${detailId}" class="bracket-detail hidden">${buildKnockoutBracketHtml(
      allRounds,
      highlightName,
      compName,
      feederGraph
    )}</div>
  `;
  container.appendChild(el);
  wireBracketToggle(el);
  hydrateBracketInteractions(el);
}

function wireBracketToggle(root, labels = {}) {
  const openLabel = labels.openLabel || "View full bracket";
  const closeLabel = labels.closeLabel || "Hide bracket";
  const btn = root.querySelector(".bracket-toggle");
  if (!btn) return;
  const targetId = btn.getAttribute("data-target");
  const detail = targetId ? root.querySelector(`[id="${targetId}"]`) : null;
  if (!detail) return;

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const willHide = !detail.classList.contains("hidden");
    detail.classList.toggle("hidden", willHide);
    btn.textContent = willHide ? openLabel : closeLabel;
    if (!willHide) {
      detail.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  });
}

function shortRoundLabel(round) {
  const r = String(round || "");
  if (/128/.test(r)) return "R128";
  if (/64/.test(r)) return "R64";
  if (/32/.test(r)) return "R32";
  if (/16/.test(r)) return "R16";
  if (/Quarter/i.test(r)) return "QF";
  if (/Semi/i.test(r)) return "SF";
  if (/^Final$/i.test(r) || r === "Final") return "F";
  return r.slice(0, 4).toUpperCase();
}

function vbTeamSide(team, highlightName, { goals = null, won = false } = {}) {
  if (!team || team.isBye) {
    return `<div class="vb-side vb-bye"><span class="vb-name">Bye</span></div>`;
  }
  const hi = highlightName && team.name === highlightName ? " is-player" : "";
  const win = won ? " is-winner" : "";
  const badge = badgeHtml(team, "vb-badge");
  // Always show name + score when available (inward rounds must not be badge-only).
  const scoreBit =
    goals != null && goals !== ""
      ? `<span class="vb-goals">${goals}</span>`
      : goals === 0
        ? `<span class="vb-goals">0</span>`
        : "";
  return `<div class="vb-side${hi}${win}">${badge}<span class="vb-name">${
    team.displayName || team.name
  }</span>${scoreBit}</div>`;
}

function vbMatchCard(match, highlightName, { roundLabel = "" } = {}) {
  if (!match) return `<div class="vb-match empty"></div>`;
  if (match.isBye || match.scoreline === "bye") {
    const club = match.home?.isBye ? match.away : match.home;
    return `<div class="vb-match vb-match-bye">
      ${vbTeamSide(club, highlightName, { won: true })}
      <div class="vb-connector"><span class="vb-round-tag">${roundLabel || "BYE"}</span></div>
    </div>`;
  }
  const homeGoals = match.homeGoals ?? match.matchHomeGoals;
  const awayGoals = match.awayGoals ?? match.matchAwayGoals;
  const homeWon = match.winnerSide === "home";
  const awayWon = match.winnerSide === "away";
  const involves =
    highlightName && (match.home?.name === highlightName || match.away?.name === highlightName);
  const agg =
    match.isAggregate || match.legs
      ? `<div class="vb-aggregate">${match.scoreline || `${homeGoals}-${awayGoals}`}</div>`
      : "";
  const pens =
    match.decidedBy === "penalties" && match.penaltyHome != null
      ? `<div class="vb-pens">${match.penaltyHome}-${match.penaltyAway} pens</div>`
      : "";
  return `<div class="vb-match${involves ? " involves-player" : ""}" data-tie-id="${
    match.tieId || ""
  }" data-feeds-into="${match.feedsInto || ""}">
    ${vbTeamSide(match.home, highlightName, {
      goals: homeGoals,
      won: homeWon,
    })}
    ${vbTeamSide(match.away, highlightName, {
      goals: awayGoals,
      won: awayWon,
    })}
    <div class="vb-connector"><span class="vb-round-tag">${roundLabel}</span>${agg}${pens}</div>
  </div>`;
}

function buildEarlierRoundsListHtml(rounds, highlightName) {
  if (!rounds?.length) return "";
  const id = `vb-earlier-${Math.random().toString(36).slice(2, 8)}`;
  const blocks = rounds
    .map((r) => {
      const lines = (r.matches || [])
        .map((m) => {
          if (m.isBye || m.scoreline === "bye") {
            const club = m.home?.isBye ? m.away : m.home;
            return `<div class="bracket-match-line">${badgeHtml(club, "opponent-badge")}<span>${
              club?.displayName || "—"
            }</span><span class="bracket-score">bye</span></div>`;
          }
          const involves =
            highlightName && (m.home?.name === highlightName || m.away?.name === highlightName);
          return `<div class="bracket-match-line${involves ? " player-team" : ""}">${badgeHtml(
            m.home,
            "opponent-badge"
          )}<span>${m.home.displayName}</span><span class="bracket-score">${m.scoreline}</span>${badgeHtml(
            m.away,
            "opponent-badge"
          )}<span>${m.away.displayName}</span></div>`;
        })
        .join("");
      return `<div class="bracket-round-block"><div class="round-name">${r.round}</div>${lines}</div>`;
    })
    .join("");
  return `
    <div class="vb-earlier">
      <button type="button" class="secondary bracket-toggle vb-earlier-toggle" data-target="${id}">
        Show earlier rounds (${rounds.map((r) => shortRoundLabel(r.round)).join(" · ")})
      </button>
      <div id="${id}" class="vb-earlier-body hidden">${blocks}</div>
    </div>
  `;
}

function buildKnockoutBracketHtml(allRounds, highlightName, competitionName = "", feederGraph = null) {
  if (!allRounds?.length) return '<div class="empty-state">No bracket data</div>';

  const rounds = allRounds.filter((r) => r.matches?.length && r.round !== "Third-place match");
  const thirdPlace = allRounds.find((r) => r.round === "Third-place match");
  if (!rounds.length) return '<div class="empty-state">No bracket data</div>';

  // Prefer stored feeder graph halves; fall back to array split.
  const useFeeder = Array.isArray(feederGraph) && feederGraph.length > 0;

  // Visual tree works best from ≤16 teams (8 matches). Earlier rounds listed above.
  let treeRounds = rounds;
  let earlierHtml = "";
  if (rounds[0].matches.length > 8) {
    const idx = rounds.findIndex((r) => r.matches.length <= 8);
    if (idx > 0) {
      earlierHtml = buildEarlierRoundsListHtml(rounds.slice(0, idx), highlightName);
      treeRounds = rounds.slice(idx);
    } else {
      earlierHtml = buildEarlierRoundsListHtml(rounds.slice(0, -4), highlightName);
      treeRounds = rounds.slice(-4);
    }
  }

  const finalRound = treeRounds[treeRounds.length - 1];
  const finalMatch = finalRound?.matches?.[0] || null;
  const feederRounds = treeRounds.slice(0, -1);

  const leftCols = [];
  const rightCols = [];

  feederRounds.forEach((round) => {
    const matches = round.matches || [];
    let left;
    let right;
    if (useFeeder && matches.every((m) => m.tieId)) {
      // Stable split by tie index parity from stored path order
      left = matches.filter((_, i) => i % 2 === 0);
      right = matches.filter((_, i) => i % 2 === 1);
      // Prefer contiguous halves when even count (standard bracket geometry)
      if (matches.length % 2 === 0) {
        const mid = matches.length / 2;
        left = matches.slice(0, mid);
        right = matches.slice(mid);
      }
    } else {
      const mid = Math.ceil(matches.length / 2);
      left = matches.slice(0, mid);
      right = matches.slice(mid);
    }
    const label = shortRoundLabel(round.round);
    leftCols.push(`
      <div class="vb-col" data-round="${label}">
        <div class="vb-col-label">${label}</div>
        <div class="vb-col-matches">
          ${left.map((m) => vbMatchCard(m, highlightName, { roundLabel: label })).join("")}
        </div>
      </div>
    `);
    rightCols.push(`
      <div class="vb-col" data-round="${label}">
        <div class="vb-col-label">${label}</div>
        <div class="vb-col-matches">
          ${right.map((m) => vbMatchCard(m, highlightName, { roundLabel: label })).join("")}
        </div>
      </div>
    `);
  });

  const finalHome = finalMatch?.home;
  const finalAway = finalMatch?.away;
  const winnerName =
    finalMatch?.winnerSide === "home"
      ? finalHome?.displayName
      : finalMatch?.winnerSide === "away"
        ? finalAway?.displayName
        : "";
  const finalHomeGoals = finalMatch?.homeGoals ?? finalMatch?.matchHomeGoals;
  const finalAwayGoals = finalMatch?.awayGoals ?? finalMatch?.matchAwayGoals;
  const finalScore =
    finalMatch?.scoreline ??
    (finalHomeGoals != null && finalAwayGoals != null ? `${finalHomeGoals}-${finalAwayGoals}` : "—");

  const center = `
    <div class="vb-final">
      <div class="vb-final-label">Final</div>
      <div class="vb-finalist">${vbTeamSide(finalHome, highlightName, {
        goals: finalHomeGoals,
        won: finalMatch?.winnerSide === "home",
      })}</div>
      <div class="vb-trophy" aria-hidden="true">
        ${(() => {
          const asset = competitionName
            ? resolveTrophyAsset({ competition: competitionName, simKey: competitionName })
            : null;
          return asset
            ? trophyImageHtml(asset, { className: "vb-trophy-img", alt: asset.trophyName })
            : `<div class="vb-trophy-cup"></div>`;
        })()}
        <div class="vb-final-score">${finalScore}</div>
      </div>
      <div class="vb-finalist">${vbTeamSide(finalAway, highlightName, {
        goals: finalAwayGoals,
        won: finalMatch?.winnerSide === "away",
      })}</div>
      ${winnerName ? `<div class="vb-champion">Winner: <strong>${winnerName}</strong></div>` : ""}
    </div>
  `;

  const thirdHtml = thirdPlace?.matches?.[0]
    ? `<div class="vb-third-place"><div class="vb-col-label">Third place</div>${vbMatchCard(
        thirdPlace.matches[0],
        highlightName,
        { roundLabel: "3rd" }
      )}</div>`
    : "";

  return `
    ${earlierHtml}
    <div class="vb-scroll">
      <div class="vb-tree">
        <div class="vb-half vb-left">${leftCols.join("")}</div>
        ${center}
        <div class="vb-half vb-right">${rightCols.join("")}</div>
      </div>
      ${thirdHtml}
    </div>
  `;
}

function hydrateBracketInteractions(root) {
  if (!root) return;
  root.querySelectorAll(".vb-earlier").forEach((wrap) => {
    wireBracketToggle(wrap, {
      openLabel: "Show earlier rounds",
      closeLabel: "Hide earlier rounds",
    });
  });
}

function buildIntlDetailHtml(tournament, player) {
  const parts = [];

  (tournament.groups || []).forEach((g) => {
    const rows = (g.table || [])
      .map(
        (row, i) => `
      <div class="intl-table-row${row.name === player.nationality ? " player-team" : ""}">
        <span>${i + 1}</span>
        <span class="intl-team">${badgeHtml(row, "opponent-badge")}${row.displayName || row.name}</span>
        <span>${row.points}</span>
        <span>${row.gd > 0 ? "+" : ""}${row.gd}</span>
      </div>`
      )
      .join("");

    const matchLines = (g.matches || [])
      .map((m) => {
        const involves =
          m.home?.name === player.nationality || m.away?.name === player.nationality;
        return `<div class="bracket-match-line${involves ? " player-team" : ""}">${badgeHtml(
          m.home,
          "opponent-badge"
        )}<span>${m.home.displayName}</span><span class="bracket-score">${m.scoreline}</span>${badgeHtml(
          m.away,
          "opponent-badge"
        )}<span>${m.away.displayName}</span></div>`;
      })
      .join("");

    parts.push(`
      <div class="bracket-round-block">
        <div class="round-name">${g.name}</div>
        <div class="intl-mini-table">
          <div class="intl-table-row intl-table-head"><span>#</span><span>Team</span><span>Pts</span><span>GD</span></div>
          ${rows}
        </div>
        <div class="intl-group-matches">${matchLines}</div>
      </div>
    `);
  });

  if (tournament.allRounds?.length) {
    parts.push(`<div class="vb-ko-title">Knockout bracket</div>`);
    parts.push(
      buildKnockoutBracketHtml(
        tournament.allRounds,
        player.nationality,
        tournament.name,
        tournament.feederGraph
      )
    );
  }

  return parts.join("") || '<div class="empty-state">No bracket data</div>';
}

export function collectSeasonTrophyWins(season, league, domesticCupResult, europeanCampaign, intl) {
  // Authoritative season.trophies (including empty) must not fall through to world `won` flags.
  if (Array.isArray(season?.trophies)) {
    return season.trophies
      .map((t) => (typeof t === "string" ? { label: t, competition: t, kind: null } : t))
      .map((t) => enrichTrophyWin(t))
      .filter(Boolean);
  }

  const wins = [];
  if (season?.standing?.position === 1) {
    wins.push(
      enrichTrophyWin({
        kind: "league",
        label: `${league.displayName ?? league.name} Champions`,
        competition: league.displayName ?? league.name,
        simKey: league.name,
      })
    );
  }
  if (domesticCupResult?.won) {
    const cupName = domesticCupResult.name || "Domestic Cup";
    wins.push(
      enrichTrophyWin({
        kind: "cup",
        label: `${cupName} Winners`,
        competition: cupName,
        simKey: cupName,
      })
    );
  }
  if (
    europeanCampaign?.won &&
    europeanCampaign?.qualified !== false &&
    playerEntitledToEuropeTrophy(europeanCampaign, null)
  ) {
    // Legacy seasons without trophies[]: only celebrate when playerEntitled is explicit.
    wins.push(
      enrichTrophyWin({
        kind: "continental",
        label: `${europeanCampaign.competition} Winners`,
        competition: europeanCampaign.competition,
        simKey: europeanCampaign.competition,
        winningClubId: europeanCampaign.winningClubId || null,
      })
    );
  }
  if (intl?.primary?.won) {
    wins.push(
      enrichTrophyWin({
        kind: "international",
        label: `${intl.primary.name} Winners`,
        competition: intl.primary.name,
        simKey: intl.primary.name,
      })
    );
  }
  return wins.filter(Boolean);
}

function showTrophiesAnimation(trophyWins, season) {
  showSection("trophies-animation");
  const info = document.getElementById("trophies-info");
  const items = document.getElementById("trophies-items");
  if (info) {
    info.textContent = `${season.clubDisplay || season.club} — Season ${season.seasonNumber}`;
  }
  if (!items) return;
  items.innerHTML = "";

  trophyWins.forEach((win, index) => {
    const el = document.createElement("div");
    el.className = "trophy-win-card";
    const img = win.src
      ? trophyImageHtml(win, { className: "trophy-win-img", alt: win.trophyName || win.label })
      : `<div class="trophy-win-fallback" aria-hidden="true"></div>`;
    el.innerHTML = `
      <div class="trophy-win-media">${img}</div>
      <div class="trophy-win-copy">
        <p class="trophy-win-kicker">${win.kind || "Title"}</p>
        <h3>${win.label || win.competition}</h3>
        <p>${win.trophyName || win.competition || "Championship trophy"}</p>
      </div>
    `;
    items.appendChild(el);
    setTimeout(() => el.classList.add("animate-in"), index * 180 + 120);
  });
}

function showLeagueTable(season, league, standings, player) {
  const leagueSection = document.getElementById("league-animation");
  const seasonInfo = document.getElementById("league-season-info");
  const tableRows = document.getElementById("league-table-rows");
  const trophyBanner = document.getElementById("league-trophy-banner");

  if (!standings?.table) {
    console.error("Invalid standings data:", standings);
    return;
  }

  if (seasonInfo) {
    const leagueLabel = season.leagueDisplay || league.displayName || league.name;
    seasonInfo.textContent = `${leagueLabel} — final table · Season ${season.seasonNumber}`;
  }

  const highlightId = season.playingClubId || player.playingClubId || player.club?.clubId;
  const highlightName =
    standings.playerRecord?.name || season.club || player.club?.name;

  if (trophyBanner) {
    const playerChamp =
      season?.standing?.position === 1 ||
      standings.table?.[0]?.clubId === highlightId ||
      standings.table?.[0]?.name === highlightName;
    if (playerChamp) {
      const asset = resolveTrophyAsset({
        kind: "league",
        simKey: league.name,
        competition: league.displayName ?? league.name,
      });
      trophyBanner.innerHTML = `
        <div class="league-trophy-win">
          ${
            asset
              ? trophyImageHtml(asset, { className: "league-trophy-img", alt: asset.trophyName })
              : `<div class="trophy-win-fallback" aria-hidden="true"></div>`
          }
          <div>
            <p class="trophy-win-kicker">Champions</p>
            <h3>${league.displayName ?? league.name}</h3>
            <p>You lifted the ${asset?.trophyName || "league trophy"}</p>
          </div>
        </div>
      `;
      trophyBanner.classList.remove("hidden");
    } else {
      trophyBanner.innerHTML = "";
      trophyBanner.classList.add("hidden");
    }
  }

  // Prefer shared full-column renderer when host is available
  const host = tableRows || document.getElementById("league-table-host");
  if (host) {
    host.innerHTML = "";
    renderLeagueTable(host, {
      table: standings.table,
      playerClubId: highlightId,
      playerClubName: highlightName,
      showLegend: true,
      variant: "board",
    });
  }

  leagueSection.classList.remove("hidden");
  leagueSection.classList.add("active");
}

function showAwardsAnimation(season, individualAwards) {
  const awardsSection = document.getElementById("awards-animation");
  const awardsInfo = document.getElementById("awards-info");
  const awardsItems = document.getElementById("awards-items");

  if (awardsInfo) awardsInfo.textContent = `${season.clubDisplay} — ${season.age} years old`;
  if (awardsItems) awardsItems.innerHTML = "";

  if (!individualAwards.length) {
    if (awardsItems) awardsItems.innerHTML = '<div class="empty-state">No individual awards this season</div>';
  } else {
    individualAwards.forEach((award, index) => {
      const awardEl = document.createElement("div");
      awardEl.className = "award-item";
      if (award === "World Player of the Year") awardEl.classList.add("special");

      const label = typeof award === "string" ? award : award?.label || award?.awardId || "Award";
      const icon =
        label === "World Player of the Year"
          ? "Ballon"
          : label === "Golden Boot"
            ? "Boot"
            : label === "Golden Glove"
              ? "Glove"
              : label === "Team of the Season"
                ? "XI"
                : label === "Player of the Season"
                  ? "POTS"
                  : label === "Young Player of the Season"
                    ? "Youth"
                    : label === "Rookie of the Season"
                      ? "Rookie"
                      : "Award";

      awardEl.innerHTML = `
        <div class="award-icon">${icon}</div>
        <div class="award-details">
          <h3>${label}</h3>
          <p>Outstanding performance this season</p>
        </div>
      `;
      awardsItems.appendChild(awardEl);
      setTimeout(() => awardEl.classList.add("animate-in"), index * 250 + 200);
    });
  }

  awardsSection.classList.remove("hidden");
  awardsSection.classList.add("active");
}

function showContinueButton(onContinue) {
  const continueSection = document.getElementById("animation-continue");
  continueSection.classList.remove("hidden");
  continueSection.classList.add("active");
  const btn = document.getElementById("continue-btn");
  btn.textContent = "Continue";
  btn.onclick = onContinue;
}

function showSummaryAnimation(season, attributeChanges, statsKeys) {
  const summarySection = document.getElementById("summary-animation");
  const summaryInfo = document.getElementById("summary-info");
  const statsGrid = document.getElementById("player-stats-grid");
  const ratingGrid = document.getElementById("rating-changes-grid");

  if (summaryInfo) summaryInfo.textContent = `${season.clubDisplay} — ${season.age} years old`;
  if (statsGrid) statsGrid.innerHTML = "";
  if (ratingGrid) ratingGrid.innerHTML = "";

  const stats = [
    { label: "Matches", value: season.matches },
    { label: "Goals", value: season.goals },
    { label: "Assists", value: season.assists },
    { label: "Clean Sheets", value: season.cleanSheets },
    { label: "Yellow", value: season.yellowCards || 0 },
    { label: "Red", value: season.redCards || 0 },
    { label: "Avg Rating", value: Number(season.avgMatchRating).toFixed(2) },
  ];

  stats.forEach((stat, index) => {
    const statEl = document.createElement("div");
    statEl.className = "stat-item";
    statEl.innerHTML = `
      <div class="stat-value">${stat.value}</div>
      <div class="stat-label">${stat.label}</div>
    `;
    statsGrid.appendChild(statEl);
    setTimeout(() => statEl.classList.add("animate-in"), index * 120 + 200);
  });

  const keys =
    Array.isArray(statsKeys) && statsKeys.length
      ? statsKeys
      : Object.keys(attributeChanges || {});
  keys.forEach((key, index) => {
    const change = attributeChanges?.[key];
    if (!change || typeof change !== "object") return;
    const { rawBefore, rawAfter } = rawAbilityEndpoints(change);
    const displayChange = abilityDisplayChange(rawBefore, rawAfter);
    const changeClass = abilityDisplayChangeTone(rawBefore, rawAfter);
    const changeText = formatAbilityDisplayChange(rawBefore, rawAfter, "0");

    const ratingEl = document.createElement("div");
    ratingEl.className = "rating-item";
    if (displayChange > 0) ratingEl.classList.add("positive");
    else if (displayChange < 0) ratingEl.classList.add("negative");

    ratingEl.innerHTML = `
      <div class="rating-name">${key}</div>
      <div class="rating-change ${changeClass}">${changeText}</div>
      <div class="rating-new">${formatAbilityForDisplay(rawAfter)}</div>
    `;
    ratingGrid.appendChild(ratingEl);
    setTimeout(() => ratingEl.classList.add("animate-in"), index * 100 + 800);
  });

  summarySection.classList.remove("hidden");
  summarySection.classList.add("active");
}

function showOverallRatingReveal(season, previousRating, newRating) {
  const overallSection = document.getElementById("overall-reveal");
  const overallInfo = document.getElementById("overall-info");
  const oldRatingValue = document.getElementById("old-rating-value");
  const newRatingValue = document.getElementById("new-rating-value");
  const ratingArrow = document.querySelector(".rating-arrow");
  const ratingChangeText = document.getElementById("rating-change-text");

  if (overallInfo) overallInfo.textContent = `${season.clubDisplay} — ${season.age} years old`;

  const rawBefore =
    Number.isFinite(season?.baseOverallBefore) ? season.baseOverallBefore : previousRating;
  const rawAfter =
    Number.isFinite(season?.baseOverallAfter) ? season.baseOverallAfter : newRating;
  const displayChange = abilityDisplayChange(rawBefore, rawAfter);
  const changeText = formatAbilityDisplayChange(rawBefore, rawAfter, "No change");

  oldRatingValue.textContent = formatAbilityForDisplay(rawBefore);
  newRatingValue.textContent = formatAbilityForDisplay(rawAfter);
  ratingChangeText.textContent = changeText;
  oldRatingValue.classList.remove("positive", "negative");
  newRatingValue.classList.remove("positive", "negative");
  ratingChangeText.classList.remove("positive", "negative");
  if (ratingArrow) {
    ratingArrow.classList.toggle("hidden", displayChange === 0 || displayChange == null);
  }

  if (displayChange > 0) {
    newRatingValue.classList.add("positive");
    ratingChangeText.classList.add("positive");
  } else if (displayChange < 0) {
    newRatingValue.classList.add("negative");
    ratingChangeText.classList.add("negative");
  }

  overallSection.classList.remove("hidden");
  overallSection.classList.add("active");

  setTimeout(() => oldRatingValue.classList.add("animate-in"), 300);
  setTimeout(() => ratingArrow?.classList.add("animate-in"), 700);
  setTimeout(() => newRatingValue.classList.add("animate-in"), 1100);
  setTimeout(() => ratingChangeText.classList.add("animate-in"), 1500);
}
