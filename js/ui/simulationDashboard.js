/**
 * Live simulation dashboard: match-card rail + live league table.
 * Viewing speed never affects seed, results, or player selection.
 */

import {
  rebuildTableFromMatches,
  matchKey,
  groupMatchesByMatchday,
  buildScoreRevealPath,
  formatMatchContribution,
  ensureLeagueMatchId,
} from "../simulation/leagueTable.js";
import { renderLeagueTable } from "./rendering.js";
import { escapeHtml } from "../utils/helpers.js";

export const DEFAULT_MATCH_MS = 2500;
const SPEED_PRESETS = [1, 2.5, 5];

let ctl = createCtl();

function createCtl() {
  return {
    paused: false,
    skipMatch: false,
    skipRemaining: false,
    speed: 1,
    matchMs: DEFAULT_MATCH_MS,
    timers: [],
    resolveWait: null,
    resolvePause: null,
    revealedIds: new Set(),
    appliedTableIds: new Set(),
    prevPositions: null,
    activeView: "league",
    seedClubs: [],
    player: null,
    league: null,
    seasonLabel: "",
    allMatches: [],
    playerMatches: [],
    competitionContext: null,
    contextMode: "table", // table | bracket
    awaitingChoice: false,
    documentHiddenSkip: false,
  };
}

function clearTimers() {
  ctl.timers.forEach((id) => clearTimeout(id));
  ctl.timers = [];
  if (ctl.resolveWait) {
    ctl.resolveWait();
    ctl.resolveWait = null;
  }
}

function waitScaled(ms) {
  if (ctl.skipMatch || ctl.skipRemaining) return Promise.resolve();
  const scaled = Math.max(16, ms / ctl.speed);
  return new Promise((resolve) => {
    let settled = false;
    let id = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(id);
      ctl.timers = ctl.timers.filter((t) => t !== id);
      if (ctl.resolveWait === finish) ctl.resolveWait = null;
      resolve();
    };
    ctl.resolveWait = finish;
    id = setTimeout(finish, scaled);
    ctl.timers.push(id);
  });
}

async function waitWhilePaused() {
  while (ctl.paused && !ctl.skipMatch && !ctl.skipRemaining) {
    await new Promise((resolve) => {
      ctl.resolvePause = resolve;
    });
    ctl.resolvePause = null;
  }
}

function badgeHtml(club, className = "match-badge") {
  const name = club?.displayName || club?.name || "?";
  const initials = escapeHtml(name.slice(0, 2));
  if (!club?.badge) {
    return `<div class="${className} match-badge-fallback">${initials}</div>`;
  }
  return `<img src="${escapeHtml(club.badge)}" alt="${escapeHtml(name)}" class="${className}" loading="lazy" onerror="this.classList.add('is-broken');this.replaceWith(Object.assign(document.createElement('div'),{className:'${className} match-badge-fallback',textContent:'${initials}'}))" />`;
}

function $(id) {
  return document.getElementById(id);
}

function wireControls() {
  const pauseBtn = $("sim-pause-btn");
  const speedBtn = $("sim-speed-btn");
  // Dedicated dashboard IDs — never steal #match-skip-btn used by cup/continental phases.
  const skipBtn = $("sim-skip-match-btn");
  const skipRemBtn = $("sim-skip-phase-btn");

  if (pauseBtn) {
    pauseBtn.onclick = () => {
      if (ctl.awaitingChoice) return;
      ctl.paused = !ctl.paused;
      pauseBtn.textContent = ctl.paused ? "Resume" : "Pause";
      if (!ctl.paused && ctl.resolvePause) ctl.resolvePause();
      if (ctl.paused && ctl.resolveWait) ctl.resolveWait();
    };
  }

  if (speedBtn) {
    speedBtn.onclick = () => {
      const idx = SPEED_PRESETS.indexOf(ctl.speed);
      ctl.speed = SPEED_PRESETS[(idx + 1) % SPEED_PRESETS.length];
      speedBtn.textContent = `${ctl.speed}×`;
      speedBtn.dataset.speed = String(ctl.speed);
    };
  }

  if (skipBtn) {
    skipBtn.onclick = () => {
      ctl.skipMatch = true;
      if (ctl.resolveWait) ctl.resolveWait();
      if (ctl.resolvePause) ctl.resolvePause();
    };
  }

  if (skipRemBtn) {
    skipRemBtn.onclick = () => {
      ctl.skipMatch = true;
      ctl.skipRemaining = true;
      if (ctl.resolveWait) ctl.resolveWait();
      if (ctl.resolvePause) ctl.resolvePause();
    };
  }

  const menu = $("sim-comp-menu");
  if (menu && !menu.dataset.wired) {
    menu.dataset.wired = "1";
    menu.addEventListener("click", (e) => {
      const btn = e.target.closest(".sim-comp-tab");
      if (!btn || btn.disabled) return;
      setActiveView(btn.dataset.view);
    });
  }

  if (!document.body.dataset.simVisWired) {
    document.body.dataset.simVisWired = "1";
    document.addEventListener("visibilitychange", () => {
      ctl.documentHiddenSkip = document.hidden;
    });
  }
}

/** Live league playback: hide competition tab flicker; recap can re-enable later. */
export function setCompetitionMenuVisible(visible) {
  const menu = $("sim-comp-menu");
  if (!menu) return;
  menu.classList.toggle("hidden", !visible);
  if (visible) menu.removeAttribute("hidden");
  else menu.setAttribute("hidden", "");
}

function setActiveView(view) {
  ctl.activeView = view || "league";
  document.querySelectorAll(".sim-comp-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === ctl.activeView);
  });
  const rail = $("match-card-rail");
  const recap = $("sim-recap-grid");
  const standings = $("live-standings-panel");
  if (ctl.activeView === "recap") {
    rail?.classList.add("hidden");
    recap?.classList.remove("hidden");
    renderRecapGrid();
  } else {
    rail?.classList.remove("hidden");
    recap?.classList.add("hidden");
    filterRailByView();
  }
  if (standings) {
    standings.classList.toggle("hidden", ctl.activeView !== "league" && ctl.activeView !== "recap");
  }
}

function filterRailByView() {
  const rail = $("match-card-rail");
  if (!rail) return;
  rail.querySelectorAll(".match-card").forEach((card) => {
    const kind = card.dataset.compKind || "league";
    const show =
      ctl.activeView === "league"
        ? kind === "league"
        : ctl.activeView === "cup"
          ? kind === "cup"
          : ctl.activeView === "continental"
            ? kind === "continental"
            : ctl.activeView === "national"
              ? kind === "national"
              : true;
    card.style.display = show ? "" : "none";
  });
}

function renderRecapGrid() {
  const grid = $("sim-recap-grid");
  if (!grid) return;
  grid.innerHTML = "";
  const matches = ctl.playerMatches.filter((m) => ctl.revealedIds.has(matchKey(m)));
  for (const match of matches) {
    const card = buildCardElement(match, { complete: true });
    card.classList.add("is-visible", "is-complete");
    updateCardFinal(card, match);
    grid.appendChild(card);
  }
  if (!matches.length) {
    grid.innerHTML = `<p class="empty-state">No completed player matches yet.</p>`;
  }
}

function updateHeader({ date, competition, matchday, club } = {}) {
  const seasonEl = $("sim-dash-season");
  const titleEl = $("sim-dash-title");
  const dateEl = $("sim-dash-date");
  const clubEl = $("sim-dash-club");
  const compEl = $("sim-dash-competition");
  const mdEl = $("sim-dash-matchday");
  if (seasonEl) seasonEl.textContent = ctl.seasonLabel || "Season";
  if (titleEl) titleEl.textContent = ctl.league?.displayName || ctl.league?.name || "League simulation";
  if (dateEl) dateEl.textContent = date ? `Date ${date}` : "";
  if (clubEl) clubEl.textContent = club || clubName(ctl.player) || "";
  if (compEl) compEl.textContent = competition || "";
  if (mdEl) mdEl.textContent = matchday != null ? `Matchday ${matchday}` : "";
  const note = $("live-standings-note");
  if (note) {
    note.textContent = ctl.awaitingChoice
      ? "Standings through the checkpoint date"
      : "Live · updates as fixtures finish";
  }
  const title = $("live-standings-title");
  if (title) title.textContent = ctl.league?.displayName || ctl.league?.name || "League table";
}

function clubName(player) {
  return player?.club?.displayName || player?.club?.name || "";
}

function showDashboardShell() {
  const overlay = $("season-animation-overlay");
  const dash = $("simulation-dashboard");
  overlay?.classList.remove("hidden");
  dash?.classList.remove("hidden");
  dash?.classList.add("active");
  $("match-viewer-section")?.classList.add("hidden");
  $("league-animation")?.classList.add("hidden");
  $("match-skip-bar")?.classList.add("hidden");
  setAwaitingChoice(false);
  // Live league: no cup/continental tab flicker — those phases play afterward.
  setCompetitionMenuVisible(false);
  updateHeader();
  setActiveView("league");
}

function rebuildRevealedCards() {
  const rail = $("match-card-rail");
  if (!rail) return;
  rail.innerHTML = "";
  const revealed = (ctl.playerMatches || [])
    .filter((m) => ctl.revealedIds.has(matchKey(m)))
    .slice()
    .sort((a, b) => {
      const md = (Number(b.matchday) || 0) - (Number(a.matchday) || 0);
      if (md) return md;
      return String(b.date || "").localeCompare(String(a.date || ""));
    });
  for (const match of revealed) {
    const card = buildCardElement(match, { complete: true });
    card.classList.add("is-visible", "is-complete");
    updateCardFinal(card, match);
    rail.appendChild(card);
  }
}

export function setAwaitingChoice(on, text = "") {
  ctl.awaitingChoice = Boolean(on);
  const banner = $("sim-awaiting-banner");
  const textEl = $("sim-awaiting-text");
  const controls = $("sim-dash-controls");
  if (banner) banner.classList.toggle("hidden", !on);
  if (textEl && text) textEl.textContent = text;
  if (controls) controls.classList.toggle("is-disabled", on);
  const pauseBtn = $("sim-pause-btn");
  if (pauseBtn && on) {
    ctl.paused = true;
    pauseBtn.textContent = "Paused";
  }
}

function buildCardElement(match, { complete = false } = {}) {
  const card = document.createElement("article");
  const kind =
    match.competition === "cup" || match.competitionType === "domesticCup"
      ? "cup"
      : match.competitionType === "continental" || match.competition === "europe"
        ? "continental"
        : match.competitionType === "international" || match.teamType === "nation"
          ? "national"
          : "league";
  card.className = "match-card";
  card.dataset.fixtureId = matchKey(match) || "";
  card.dataset.compKind = kind;
  const stage = [match.cupName, match.round, match.historySegment === "origin" ? "Before move" : null]
    .filter(Boolean)
    .join(" · ");
  card.innerHTML = `
    <div class="match-card-main">
      <div class="match-card-stage">${escapeHtml(stage || "League")}</div>
      <div class="match-card-teams">
        <div class="match-card-club">
          ${badgeHtml(match.home)}
          <div class="match-card-club-name">${escapeHtml(match.home?.displayName || match.home?.name || "Home")}</div>
        </div>
        <div class="match-card-score" data-role="score">0 – 0</div>
        <div class="match-card-club">
          ${badgeHtml(match.away)}
          <div class="match-card-club-name">${escapeHtml(match.away?.displayName || match.away?.name || "Away")}</div>
        </div>
      </div>
      <div class="match-card-progress" aria-hidden="true"><i data-role="progress"></i></div>
    </div>
    <div class="match-card-side">
      <div class="match-card-contrib" data-role="contrib">${complete ? "" : "…"}</div>
      <div class="match-card-rating is-empty" data-role="rating">—</div>
    </div>
  `;
  return card;
}

function updateCardFinal(card, match) {
  const scoreEl = card.querySelector('[data-role="score"]');
  const contribEl = card.querySelector('[data-role="contrib"]');
  const ratingEl = card.querySelector('[data-role="rating"]');
  const progress = card.querySelector('[data-role="progress"]');
  const h = Number(match.homeGoals ?? match.matchHomeGoals) || 0;
  const a = Number(match.awayGoals ?? match.matchAwayGoals) || 0;
  if (scoreEl) scoreEl.textContent = `${h} – ${a}`;
  if (progress) progress.style.width = "100%";
  const contrib = formatMatchContribution(match, ctl.player || {});
  if (contribEl) {
    const mins = Number(match?.playerStats?.minutes) || 0;
    const fallback =
      match.playerSide && mins <= 0
        ? contrib.text || "Did not play"
        : match.playerSide
          ? "Played"
          : "";
    contribEl.textContent = contrib.text || fallback;
  }
  if (ratingEl) {
    ratingEl.textContent = contrib.ratingText;
    ratingEl.classList.toggle("is-empty", contrib.rating == null);
  }
}

function refreshContextPanel() {
  const host = $("league-table-host");
  const heading = $("live-standings-title");
  if (!host) return;
  const ctx = ctl.competitionContext;
  const visibleIds = ctl.appliedTableIds;

  if (ctx && ctl.contextMode === "bracket" && typeof ctx.getBracketView === "function") {
    const bracket = ctx.getBracketView(visibleIds);
    if (heading) heading.textContent = "Bracket";
    host.innerHTML = renderBracketPanel(bracket, ctx.playerParticipantId);
    return;
  }

  if (ctx && typeof ctx.getTableView === "function") {
    const view = ctx.getTableView({ groupId: ctx.activeGroupId }, visibleIds);
    if (heading) {
      heading.textContent =
        view.kind === "national-table"
          ? view.group?.name || "Group table"
          : view.kind === "continental-table"
            ? "League phase"
            : "Table";
    }
    if (view.kind === "national-table" || view.kind === "continental-table") {
      const seed = (view.table || []).map((r) => ({
        name: r.name,
        displayName: r.displayName || r.name,
        badge: r.badge,
        clubId: r.nationId || r.clubId || r.name,
        overall: r.overall || 0,
      }));
      // Re-account from visible matches already done in getTableView — use returned rows.
      const result = renderLeagueTable(host, {
        table: (view.table || []).map((r) => ({
          ...r,
          goalsFor: r.goalsFor ?? r.gf,
          goalsAgainst: r.goalsAgainst ?? r.ga,
          qualification: r.qualificationStatus || r.qualification || null,
        })),
        playerClubId: ctx.playerParticipantId,
        playerClubName: ctx.playerParticipantId,
        animateFrom: ctl.prevPositions,
        live: !ctl.awaitingChoice,
        showLegend: true,
        variant: "live",
      });
      ctl.prevPositions = result?.positions || ctl.prevPositions;
      renderContextControls(ctx, view);
      return;
    }
  }

  // Default domestic league table
  if (heading) heading.textContent = "League table";
  const revealedMatches = (ctl.allMatches || []).filter((m) => {
    const id = matchKey(m);
    return id && ctl.appliedTableIds.has(id);
  });
  const { table } = rebuildTableFromMatches(ctl.seedClubs, revealedMatches);
  const result = renderLeagueTable(host, {
    table,
    playerClubId: ctl.player?.playingClubId || ctl.player?.club?.clubId || null,
    playerClubName: ctl.player?.club?.name || null,
    animateFrom: ctl.prevPositions,
    live: !ctl.awaitingChoice,
    showLegend: true,
    variant: "live",
  });
  ctl.prevPositions = result?.positions || ctl.prevPositions;
}

function refreshLiveTable() {
  refreshContextPanel();
}

function renderContextControls(ctx, view) {
  let bar = $("sim-context-controls");
  const panel = $("live-standings-panel");
  if (!panel) return;
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "sim-context-controls";
    bar.className = "sim-context-controls";
    panel.insertBefore(bar, panel.firstChild?.nextSibling || null);
  }
  const parts = [];
  if (ctx.participantType === "nation" && ctx.groups?.length) {
    parts.push(`<button type="button" class="sim-ctx-btn" data-ctx="groups">Other groups</button>`);
    if ((ctx.tournament?.bestThirds || 0) > 0) {
      parts.push(`<button type="button" class="sim-ctx-btn" data-ctx="thirds">Best thirds</button>`);
    }
  }
  if (ctx.stageMode === "bracket" || ctx.getBracketView) {
    parts.push(
      `<button type="button" class="sim-ctx-btn" data-ctx="toggle">${
        ctl.contextMode === "bracket" ? "Show table" : "Show bracket"
      }</button>`
    );
  }
  bar.innerHTML = parts.join("");
  bar.querySelectorAll("[data-ctx]").forEach((btn) => {
    btn.onclick = () => {
      const action = btn.getAttribute("data-ctx");
      if (action === "toggle") {
        ctl.contextMode = ctl.contextMode === "bracket" ? "table" : "bracket";
        refreshContextPanel();
      } else if (action === "groups") {
        showOtherGroupsModal(ctx);
      } else if (action === "thirds") {
        showBestThirdsModal(ctx);
      }
    };
  });
}

function renderBracketPanel(bracket, playerId) {
  if (!bracket?.rounds?.length) {
    return `<p class="sim-context-empty">Bracket unlocks after the opening phase.</p>`;
  }
  return bracket.rounds
    .map((round) => {
      const rows = (round.matches || [])
        .map((m) => {
          const home = m.home?.displayName || m.home?.name || m.homeParticipantId || "TBD";
          const away = m.away?.displayName || m.away?.name || m.awayParticipantId || "TBD";
          const score = m.spoilerHidden
            ? "vs"
            : `${m.homeGoals ?? "—"}–${m.awayGoals ?? "—"}`;
          const hl =
            playerId &&
            (m.home?.name === playerId ||
              m.away?.name === playerId ||
              m.homeParticipantId === playerId ||
              m.awayParticipantId === playerId);
          return `<div class="sim-bracket-row${hl ? " is-player" : ""}"><span>${escapeHtml(
            home
          )}</span><strong>${escapeHtml(score)}</strong><span>${escapeHtml(away)}</span></div>`;
        })
        .join("");
      return `<section class="sim-bracket-round"><h4>${escapeHtml(round.round || "")}</h4>${rows}</section>`;
    })
    .join("");
}

function showOtherGroupsModal(ctx) {
  const host = $("league-table-host");
  if (!host || !ctx?.groups) return;
  const chunks = ctx.groups
    .filter((g) => g.groupId !== ctx.activeGroupId)
    .map((g) => {
      const view = ctx.getTableView({ groupId: g.groupId }, ctl.appliedTableIds);
      const rows = (view.table || [])
        .map(
          (r, i) =>
            `<tr><td>${i + 1}</td><td>${escapeHtml(r.displayName || r.name)}</td><td>${r.played}</td><td>${r.points}</td><td>${r.gd}</td></tr>`
        )
        .join("");
      return `<h4>${escapeHtml(g.name)}</h4><table class="sim-mini-table"><thead><tr><th>#</th><th>Team</th><th>P</th><th>Pts</th><th>GD</th></tr></thead><tbody>${rows}</tbody></table>`;
    })
    .join("");
  host.innerHTML = `<div class="sim-other-groups">${chunks}<button type="button" class="sim-ctx-btn" id="sim-back-player-group">Back to your group</button></div>`;
  $("sim-back-player-group")?.addEventListener("click", () => refreshContextPanel());
}

function showBestThirdsModal(ctx) {
  const host = $("league-table-host");
  if (!host || typeof ctx.getBestThirdsView !== "function") return;
  const view = ctx.getBestThirdsView(ctl.appliedTableIds);
  const rows = (view.table || [])
    .map(
      (r, i) =>
        `<tr><td>${i + 1}</td><td>${escapeHtml(r.groupId || "")}</td><td>${escapeHtml(
          r.displayName || r.name
        )}</td><td>${r.points}</td><td>${r.gd}</td><td>${r.qualified === false ? "Out" : i < (ctx.tournament?.bestThirds || 0) ? "In" : ""}</td></tr>`
    )
    .join("");
  host.innerHTML = `<div class="sim-best-thirds"><h4>Best third-placed teams</h4><table class="sim-mini-table"><thead><tr><th>#</th><th>Grp</th><th>Team</th><th>Pts</th><th>GD</th><th></th></tr></thead><tbody>${rows}</tbody></table><button type="button" class="sim-ctx-btn" id="sim-back-player-group">Back</button></div>`;
  $("sim-back-player-group")?.addEventListener("click", () => refreshContextPanel());
}

function applyMatchesToTable(matches) {
  for (const m of matches || []) {
    ensureLeagueMatchId(m);
    const id = matchKey(m);
    if (id) ctl.appliedTableIds.add(id);
  }
  refreshLiveTable();
}

/**
 * Reveal one player match card (2.5s default). Same-matchday background fixtures
 * are applied when the card locks so played counts stay consistent.
 */
async function revealPlayerCard(match, batchBackground = []) {
  await waitWhilePaused();
  const id = matchKey(ensureLeagueMatchId(match));
  if (id && ctl.revealedIds.has(id)) {
    applyMatchesToTable([match, ...batchBackground]);
    return;
  }

  const rail = $("match-card-rail");
  if (!rail) return;

  updateHeader({
    date: match.date,
    competition: match.leagueContextName || match.competition || "League",
    matchday: match.matchday,
    club: match.playerClubName || clubName(ctl.player),
  });

  const card = buildCardElement(match);
  // Newest match on top — push previous games down.
  rail.prepend(card);
  requestAnimationFrame(() => {
    card.classList.add("is-visible", "is-active");
    rail.scrollTop = 0;
  });

  const scoreEl = card.querySelector('[data-role="score"]');
  const progress = card.querySelector('[data-role="progress"]');
  const { path } = buildScoreRevealPath(match);
  const total = ctl.matchMs;
  const introEnd = 250;
  const progressEnd = 1750;

  // Intro
  if (!ctl.skipMatch && !ctl.skipRemaining) {
    await waitScaled(introEnd);
    await waitWhilePaused();
  }

  if (ctl.skipMatch || ctl.skipRemaining) {
    updateCardFinal(card, match);
    card.classList.add("is-complete");
    card.classList.remove("is-active");
    if (id) ctl.revealedIds.add(id);
    applyMatchesToTable([match, ...batchBackground]);
    ctl.skipMatch = false;
    return;
  }

  // Progress + score reveals
  const progressWindow = progressEnd - introEnd;
  const start = performance.now();
  let pathIdx = 0;
  while (true) {
    if (ctl.skipMatch || ctl.skipRemaining) break;
    await waitWhilePaused();
    if (ctl.skipMatch || ctl.skipRemaining) break;

    const elapsed = (performance.now() - start) * ctl.speed;
    const t = Math.min(1, elapsed / progressWindow);
    if (progress) progress.style.width = `${Math.round(t * 100)}%`;

    while (pathIdx + 1 < path.length && path[pathIdx + 1].t <= t) {
      pathIdx += 1;
      const node = path[pathIdx];
      if (scoreEl) scoreEl.textContent = `${node.home} – ${node.away}`;
    }

    if (t >= 1) break;
    await waitScaled(40);
  }

  // Lock
  updateCardFinal(card, match);
  card.classList.add("is-complete");
  card.classList.remove("is-active");
  if (id) ctl.revealedIds.add(id);
  applyMatchesToTable([match, ...batchBackground]);

  const hold = Math.max(0, total - progressEnd);
  if (!ctl.skipMatch && !ctl.skipRemaining && hold > 0) {
    await waitScaled(hold);
  }
  ctl.skipMatch = false;
}

/**
 * Open/reset the dashboard and reveal unrevealed player matches from a segment.
 *
 * @returns {Promise<{ revealedIds: string[], awaitingChoice: boolean }>}
 */
export async function runSimulationDashboard(opts) {
  const {
    player,
    league,
    seasonNumber,
    allMatches = [],
    playerMatches = [],
    seedClubs = null,
    competitionContext = null,
    revealedFixtureIds = null,
    awaitingDecision = false,
    awaitingScenario = false,
    decisionText = "",
    reset = false,
  } = opts;

  if (reset || !ctl.player) {
    const keptRevealed = revealedFixtureIds ? new Set(revealedFixtureIds) : new Set();
    const keptApplied = revealedFixtureIds ? new Set(revealedFixtureIds) : new Set();
    ctl = createCtl();
    ctl.revealedIds = keptRevealed;
    ctl.appliedTableIds = keptApplied;
  } else if (Array.isArray(revealedFixtureIds)) {
    for (const id of revealedFixtureIds) {
      ctl.revealedIds.add(id);
      ctl.appliedTableIds.add(id);
    }
  }

  ctl.player = player;
  ctl.league = league;
  ctl.seasonLabel = seasonNumber ? `Season ${seasonNumber}` : "Season";
  ctl.competitionContext = competitionContext || null;
  ctl.contextMode = competitionContext?.stageMode === "bracket" ? "bracket" : "table";
  ctl.allMatches = allMatches || [];
  ctl.playerMatches = playerMatches?.length
    ? playerMatches
    : (allMatches || []).filter((m) => m.playerSide);
  ctl.seedClubs =
    seedClubs ||
    competitionContext?.seedClubs ||
    (league?.clubs || []).map((c) => ({
      name: c.name,
      displayName: c.displayName,
      badge: c.badge,
      clubId: c.clubId,
      strength: c.overall,
      overall: c.overall,
    }));
  // Also seed from any match clubs not in league list
  for (const m of ctl.allMatches) {
    if (m.home && !ctl.seedClubs.some((c) => c.name === m.home.name)) ctl.seedClubs.push(m.home);
    if (m.away && !ctl.seedClubs.some((c) => c.name === m.away.name)) ctl.seedClubs.push(m.away);
  }

  showDashboardShell();
  if (competitionContext) {
    setActiveView(competitionContext.participantType === "nation" ? "national" : "continental");
  }
  wireControls();
  ctl.paused = false;
  ctl.skipMatch = false;
  ctl.skipRemaining = false;
  const pauseBtn = $("sim-pause-btn");
  if (pauseBtn) pauseBtn.textContent = "Pause";

  // Apply already-revealed fixtures to the table immediately
  const already = ctl.allMatches.filter((m) => ctl.revealedIds.has(matchKey(m)));
  applyMatchesToTable(already);
  rebuildRevealedCards();

  // Pre-seed empty table if nothing revealed yet
  if (!ctl.appliedTableIds.size) {
    refreshLiveTable();
  }

  const batches = groupMatchesByMatchday(ctl.allMatches);
  for (const batch of batches) {
    if (ctl.skipRemaining) {
      // Commit remaining finals without animation; still stack player cards newest-first
      for (const m of batch.matches) {
        const id = matchKey(ensureLeagueMatchId(m));
        if (id) ctl.revealedIds.add(id);
      }
      applyMatchesToTable(batch.matches);
      const rail = $("match-card-rail");
      for (const pm of [...batch.playerMatches].reverse()) {
        if (!rail) break;
        const existing = rail.querySelector(`[data-fixture-id="${CSS.escape(matchKey(pm) || "")}"]`);
        if (existing) continue;
        const card = buildCardElement(pm, { complete: true });
        card.classList.add("is-visible", "is-complete");
        updateCardFinal(card, pm);
        rail.prepend(card);
      }
      continue;
    }

    const playerInBatch = batch.playerMatches.filter((m) => !ctl.revealedIds.has(matchKey(m)));
    const background = batch.matches.filter((m) => !m.playerSide);

    if (!playerInBatch.length) {
      // Background-only matchday: apply instantly
      const freshBg = background.filter((m) => !ctl.appliedTableIds.has(matchKey(m)));
      if (freshBg.length) applyMatchesToTable(freshBg);
      continue;
    }

    for (const pm of playerInBatch) {
      const others = batch.matches.filter((m) => matchKey(m) !== matchKey(pm));
      // Apply other finished matches in batch with this card lock (same-day consistency)
      await revealPlayerCard(pm, others.filter((m) => !ctl.revealedIds.has(matchKey(m)) || !m.playerSide));
    }
  }

  // Ensure all matches committed to table
  applyMatchesToTable(ctl.allMatches);
  for (const m of ctl.playerMatches) {
    const id = matchKey(m);
    if (id) ctl.revealedIds.add(id);
  }

  if (awaitingDecision || awaitingScenario) {
    setAwaitingChoice(
      true,
      decisionText ||
        (awaitingScenario
          ? "A senior career moment needs your response before the season continues."
          : "Mid-season checkpoint. Resolve the squad discussion or offers, then continue.")
    );
  }

  return {
    revealedIds: [...ctl.revealedIds],
    awaitingChoice: ctl.awaitingChoice,
  };
}

export function getDashboardRevealState() {
  return {
    revealedIds: [...ctl.revealedIds],
    appliedTableIds: [...ctl.appliedTableIds],
  };
}

export function hideSimulationDashboard() {
  clearTimers();
  $("simulation-dashboard")?.classList.add("hidden");
  $("simulation-dashboard")?.classList.remove("active");
  setAwaitingChoice(false);
}

/**
 * Competition tabs are not used during live league playback (cup/continental
 * run as separate phases with their own skip bar). Optional history menu can
 * be shown after the league segment finishes.
 */
export function configureCompetitionTabs(_opts = {}) {
  setCompetitionMenuVisible(false);
}
