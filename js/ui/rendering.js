import {
  clubNameForDisplay,
  escapeHtml,
  formatCurrency,
  formatOrdinal,
  formatSigned,
} from "../utils/helpers.js";
import { enrichTrophyWin, trophyImageHtml } from "../data/trophyAssets.js";
import { describeTeamStrength } from "../simulation/teamStrength.js";
import { getWorldState } from "../simulation/worldState.js";
import { getDisplayAttributeKeys } from "../simulation/playerAbility.js?v=61";
import {
  formatAbilityDisplayChange,
  formatAbilityForDisplay,
  roundAbilityForDisplay,
} from "./abilityFormatting.js";
import {
  describeRegistration,
  hasInternationalStatus,
  ensureContractAuthority,
  markOfferStatus,
  isContractActive,
  isFreeAgent,
} from "../simulation/contractLifecycle.js";

export function renderPlayerOverview(player, overviewEl, statsKeys) {
  if (!player) return;
  ensureContractAuthority(player);
  const displayKeys =
    player.position === "GK" ? getDisplayAttributeKeys("GK") : statsKeys || getDisplayAttributeKeys(player.position);
  const totals = player.careerTotals;
  const cleanSheetLine = totals.cleanSheets ? ` - ${totals.cleanSheets} clean sheets` : "";
  const reg = describeRegistration(player);
  const currentClubName = reg.playingLabel;
  const clubLeagueName = reg.leagueLabel;
  const clubBadge = player.club?.badge
    ? `<img class="club-badge" src="${player.club.badge}" alt="${escapeHtml(currentClubName)} badge" loading="lazy" />`
    : "";
  const clubStrength =
    player.club && !player.club.isAcademy
      ? describeTeamStrength(player.club, getWorldState())
      : null;
  const strengthLine = clubStrength
    ? `<span class="club-strength">Team strength: ${clubStrength.overall.toFixed(1)} (${escapeHtml(
        clubStrength.tierLabel
      )}) · ATK ${clubStrength.attack.toFixed(0)} / MID ${clubStrength.midfield.toFixed(
        0
      )} / DEF ${clubStrength.defence.toFixed(0)} / GK ${clubStrength.goalkeeper.toFixed(0)}${
        clubStrength.snapshotDate ? ` · Starting data: ${escapeHtml(String(clubStrength.snapshotDate))}` : ""
      }</span>`
    : "";
  const latestStanding = player.latestStanding?.playerRow;
  const finishLine = latestStanding
    ? `<span>Last finish: ${formatOrdinal(latestStanding.position)} - ${latestStanding.points} pts${
        latestStanding.qualification ? ` (${latestStanding.qualification})` : ""
      }</span>`
    : "";
  const honors = player.careerHonors;
  const continentalLabel = (() => {
    const wins = (player.seasons || [])
      .map((s) => s.europeanCampaign)
      .filter((c) => c?.won && c?.qualified !== false && c?.competition)
      .map((c) => c.competition);
    const unique = [...new Set(wins)];
    if (unique.length && unique.every((n) => /Champions League|Europa League|Conference League/i.test(n))) {
      return `${honors.europeanTitles} continental titles`;
    }
    if (unique.length === 1) return `${honors.europeanTitles} ${unique[0]}`;
    if (honors.europeanTitles) return `${honors.europeanTitles} continental titles`;
    return `${honors.europeanTitles} continental titles`;
  })();
  const honorLine = honors
    ? `<span>Honors: ${honors.leagueTitles} league titles | ${honors.domesticCups} cups | ${continentalLabel} | ${honors.internationalTitles || 0} international titles | ${honors.individualAwards} awards</span>`
    : "";
  overviewEl.innerHTML = `
    <div class="player-summary">
      <div class="club-heading">
        ${clubBadge}
        <div>
          <h2>${escapeHtml(player.name)} - OVR ${formatAbilityForDisplay(
            player.currentOverall ?? player.rating
          )}</h2>
          <span>Base ${formatAbilityForDisplay(player.baseOverallRaw ?? player.rating)}${
            (() => {
              const baseDisp = roundAbilityForDisplay(player.baseOverallRaw ?? player.rating);
              const curDisp = roundAbilityForDisplay(player.currentOverall ?? player.currentOverallRaw);
              return curDisp != null && baseDisp != null && curDisp !== baseDisp
                ? ` · current ${formatAbilityForDisplay(player.currentOverall ?? player.currentOverallRaw)}`
                : "";
            })()
          }</span>
          <span>${player.age} yrs - ${escapeHtml(player.position)}</span>
          <span>${escapeHtml(player.nationality)}${
            hasInternationalStatus(player) ? " · international" : ""
          }</span>
          <span>${escapeHtml(currentClubName)} - ${escapeHtml(clubLeagueName)}</span>
          ${
            reg.employerLabel
              ? `<span>Employer: ${escapeHtml(reg.employerLabel)} (on loan)</span>`
              : ""
          }
          <span>${escapeHtml(reg.statusLabel)} · ${escapeHtml(reg.contractLabel)}${
            reg.wage > 0 ? ` · ${formatCurrency(reg.wage)}/wk` : ""
          }</span>
          ${
            player.potentialForecast &&
            Number.isFinite(player.potentialForecast.lower) &&
            Number.isFinite(player.potentialForecast.upper)
              ? `<span>Estimated outlook: ${formatAbilityForDisplay(
                  player.potentialForecast.lower
                )}–${formatAbilityForDisplay(player.potentialForecast.upper)} · ${
                  typeof player.potentialForecast.confidence === "number"
                    ? `${Math.round(player.potentialForecast.confidence * 100)}%`
                    : escapeHtml(String(player.potentialForecast.confidence ?? ""))
                } (changes with performance)</span>`
              : `<span>Outlook: ${formatAbilityForDisplay(player.potential)}</span>`
          }
          ${
            player.state
              ? `<span>Form ${(player.state.form ?? 0).toFixed(2)} · readiness ${Math.round(
                  (player.state.readiness ?? 1) * 100
                )}%${player.health?.status && player.health.status !== "fit" ? ` · ${escapeHtml(player.health.status)}` : ""}</span>`
              : ""
          }
          ${strengthLine}
        </div>
      </div>
      <span>Career totals: ${totals.matches} apps - ${totals.goals} goals - ${totals.assists} assists${cleanSheetLine}</span>
      ${finishLine}
      ${honorLine}
    </div>
    <div class="player-metrics">
      ${displayKeys
        .map(
          (key) => `
          <div class="metric">
            <span class="label">${key}</span>
            <span class="value">${formatAbilityForDisplay(player.attributes?.[key])}</span>
          </div>
        `
        )
        .join("")}
    </div>
  `;
}

/**
 * Career moments history: date, choice, result, realized effect badges.
 * Failed 30% rolls never appear here.
 */
export function renderCareerMoments(player, containerEl) {
  if (!containerEl) return;
  const history = player?.seniorCareer?.history || [];
  if (!history.length) {
    containerEl.innerHTML = `<p class="empty-state">No senior career moments yet. Optional scenes can appear during competitions you enter.</p>`;
    return;
  }
  const newestFirst = [...history].reverse();
  containerEl.innerHTML = newestFirst
    .map((h) => {
      const date = h.date ? String(h.date).slice(0, 10) : "—";
      const comp = h.competitionLabel || h.competitionId || "Competition";
      const badges = (h.badges || [])
        .map((b) => `<span class="senior-effect-badge">${escapeHtml(b)}</span>`)
        .join("");
      return `
        <article class="career-moment-card">
          <div class="career-moment-meta">${escapeHtml(date)} · ${escapeHtml(comp)} · ${escapeHtml(
            h.title || h.scenarioId || "Moment"
          )}</div>
          <p class="career-moment-choice">${escapeHtml(h.choiceLabel || h.choiceId || "")}</p>
          <p class="career-moment-result">${escapeHtml(h.outcomeText || "")}</p>
          ${badges ? `<div class="senior-effect-badges">${badges}</div>` : ""}
        </article>
      `;
    })
    .join("");
}

function isFreeAgentSeasonRecord(season) {
  return Boolean(
    season?.freeAgent ||
      season?.clubName === "Free agent" ||
      (season?.club == null && season?.league == null && season?.matches === 0 && season?.seasonId?.startsWith?.("free-agent"))
  );
}

function freeAgentYearLabel(season, player) {
  if (Number.isFinite(season?.year)) {
    const y = Number(season.year);
    return `${y}/${String(y + 1).slice(-2)}`;
  }
  if (Number.isFinite(season?.seasonNumber) && Number.isFinite(player?.startYear)) {
    const start = player.startYear + season.seasonNumber - 1;
    return `${start}/${String(start + 1).slice(-2)}`;
  }
  return "Free-agent period";
}

function appendFreeAgentSeasonCard(season, seasonLogEl, player) {
  const template = document.getElementById("season-template");
  const node = template.content.cloneNode(true);
  const header = node.querySelector("header");
  const summary = node.querySelector(".summary");
  const stats = node.querySelector(".stats");

  const periodLabel = Number.isFinite(season.seasonNumber)
    ? `Period ${season.seasonNumber}`
    : Number.isFinite(season.year)
      ? `Year ${season.year}`
      : "Free-agent period";
  // Never fall back to the live player age — that rewrites older cards on redraw.
  const ageLabel = Number.isFinite(season.age) ? `Age ${season.age}` : "Age unavailable";
  const clubLabel = season.clubDisplay || season.clubName || "Free agent";
  const yearLabel = freeAgentYearLabel(season, player);
  const matches = Number(season.matches) || 0;
  const minutes = Number(season.minutes) || 0;
  const starts = Number(season.starts) || 0;
  const goals = Number(season.goals) || 0;
  const assists = Number(season.assists) || 0;
  const cleanSheets = Number(season.cleanSheets) || 0;

  header.innerHTML = `
    <div class="season-title">
      <div>
        <h4>${escapeHtml(periodLabel)} - ${escapeHtml(ageLabel)}</h4>
        <span class="season-club">${escapeHtml(clubLabel)}</span>
      </div>
    </div>
    <span>${escapeHtml(yearLabel)}</span>
  `;

  summary.innerHTML = `
    <dt>Status</dt>
    <dd>Free agent</dd>
    <dt>Club</dt>
    <dd>${escapeHtml(clubLabel)}</dd>
    <dt>League</dt>
    <dd>No league fixtures during this period</dd>
    <dt>Finish</dt>
    <dd>N/A</dd>
    <dt>Minutes / starts</dt>
    <dd>${minutes} min · ${starts} starts</dd>
    <dt>Average rating</dt>
    <dd>—</dd>
    <dt>Europe</dt>
    <dd>No competition</dd>
    <dt>International</dt>
    <dd>No major tournaments</dd>
    <dt>Domestic cup</dt>
    <dd>N/A</dd>
  `;

  stats.innerHTML = [
    `${matches} appearances`,
    `${goals} goals`,
    `${assists} assists`,
    `${cleanSheets} clean sheets`,
    "Trained / searched without a club",
  ]
    .map((item) => `<span>${item}</span>`)
    .join("");

  seasonLogEl.prepend(node);
}

export function appendSeasonCard(season, seasonLogEl, player) {
  if (isFreeAgentSeasonRecord(season)) {
    appendFreeAgentSeasonCard(season, seasonLogEl, player);
    return;
  }

  const template = document.getElementById("season-template");
  const node = template.content.cloneNode(true);
  const header = node.querySelector("header");
  const summary = node.querySelector(".summary");
  const stats = node.querySelector(".stats");

  const yearLabel = `${player.startYear + season.seasonNumber - 1}/${(player.startYear + season.seasonNumber).toString().slice(-2)}`;
  const ovrBefore =
    Number.isFinite(season.baseOverallBefore)
      ? season.baseOverallBefore
      : Number.isFinite(season.ratingAfter) && Number.isFinite(season.ratingChange)
        ? season.ratingAfter - season.ratingChange
        : null;
  const ovrAfter = Number.isFinite(season.baseOverallAfter)
    ? season.baseOverallAfter
    : season.ratingAfter;
  const ovrChangeText = formatAbilityDisplayChange(ovrBefore, ovrAfter, "0");
  const seasonClubName = season.clubDisplay ?? season.club;
  const badgeMarkup = season.badge
    ? `<img class="club-badge badge-small" src="${season.badge}" alt="${escapeHtml(seasonClubName)} badge" loading="lazy" />`
    : "";
  const finishLabel = season.standing
    ? `${formatOrdinal(season.standing.position)} | ${season.standing.points} pts`
    : "N/A";
  const honorsLabel = season.honors ? ` - ${season.honors}` : "";
  const moveLabel = season.divisionMove
    ? season.divisionMove.type === "promoted"
      ? ` - Promoted to ${season.divisionMove.to}`
      : ` - Relegated to ${season.divisionMove.to}`
    : "";

  header.innerHTML = `
    <div class="season-title">
      ${badgeMarkup}
      <div>
        <h4>Season ${season.seasonNumber} - Age ${season.age}</h4>
        <span class="season-club">${escapeHtml(seasonClubName)}</span>
      </div>
    </div>
    <span>${yearLabel}</span>
  `;

  summary.innerHTML = `
    <dt>Club</dt>
    <dd>${escapeHtml(seasonClubName)}</dd>
    <dt>League</dt>
    <dd>${escapeHtml(season.leagueDisplay ?? season.league)}</dd>
    <dt>Finish</dt>
    <dd>${finishLabel}${honorsLabel}${moveLabel}</dd>
    <dt>Base OVR change</dt>
    <dd>${ovrChangeText}${
      season.developmentExplanations?.length
        ? ` <span class="muted">(${escapeHtml(season.developmentExplanations[0])})</span>`
        : ""
    }</dd>
    <dt>Minutes / starts</dt>
    <dd>${season.minutes ?? "—"} min · ${season.starts ?? "—"} starts</dd>
    <dt>Average rating</dt>
    <dd>${Number(season.avgMatchRating || 0).toFixed(2)}</dd>
    <dt>Europe</dt>
    <dd>${
      season.europeanCampaign?.showcase
        ? "Not qualified"
        : season.europeanCampaign
          ? `${season.europeanCampaign.competition} - ${season.europeanCampaign.result}`
          : "No competition"
    }</dd>
    <dt>International</dt>
    <dd>${
      season.internationalSeason?.calledUp
        ? `${escapeHtml(season.internationalSeason.callUpTournament)} — ${escapeHtml(
            season.internationalSeason.primary?.result || "Selected"
          )}`
        : season.internationalSeason?.callUpTournament
          ? "Not selected"
          : season.internationalSeason?.hasTournaments
            ? "No national tournament"
            : "No major tournaments"
    }</dd>
    <dt>Domestic cup</dt>
    <dd>${
      season.domesticCupResult
        ? `${escapeHtml(season.domesticCupResult.name || "Cup")} — ${escapeHtml(season.domesticCupResult.result)}`
        : "N/A"
    }</dd>
  `;

  const statItems = [
    `${season.matches} appearances`,
    `${season.goals} goals`,
    `${season.assists} assists`,
    `${season.cleanSheets} clean sheets`,
  ];

  if (season.standing) {
    const { wins, draws, losses } = season.standing.record;
    statItems.push(`Record ${wins}-${draws}-${losses}`);
    statItems.push(`Goal diff ${formatSigned(season.standing.goalDiff)}`);
  }

  statItems.push(`OVR ${formatAbilityForDisplay(ovrAfter)}`);

  if (season.europeanCampaign && !season.europeanCampaign.showcase) {
    statItems.push(`${season.europeanCampaign.competition}: ${season.europeanCampaign.result}`);
  } else if (season.europeanCampaign?.showcase) {
    statItems.push("Europe: Not qualified");
  }

  if (season.internationalSeason?.calledUp) {
    statItems.push(
      `International: ${season.internationalSeason.callUpTournament} (${season.internationalSeason.primary?.result || "selected"})`
    );
  } else if (season.internationalSeason?.callUpTournament) {
    statItems.push("International: not selected");
  } else if (season.internationalSeason?.hasTournaments) {
    statItems.push("International: no national tournament");
  }

  if (season.domesticCupResult) {
    const cupLabel = season.domesticCupResult.name || "Domestic cup";
    statItems.push(`${cupLabel}: ${season.domesticCupResult.result}`);
  }
  if (season.yellowCards || season.redCards) {
    statItems.push(`${season.yellowCards || 0} yellow / ${season.redCards || 0} red`);
  }

  if (season.individualAwards?.length) {
    statItems.push(`Awards: ${season.individualAwards.join(", ")}`);
  }

  if (season.trophies?.length) {
    const labels = season.trophies.map((t) => (typeof t === "string" ? t : t.label || t.competition));
    statItems.push(`Trophies: ${labels.join(", ")}`);
  }

  if (season.isNarrativeAcademyYear) {
    statItems.push("Academy narrative year. no senior league / cups yet");
  }

  const trophyRow = (season.trophies || [])
    .map((t) => enrichTrophyWin(typeof t === "string" ? { label: t, competition: t } : t))
    .filter((t) => t?.src)
    .map(
      (t) =>
        `<div class="season-trophy-thumb" title="${escapeHtml(t.label || t.competition)}">${trophyImageHtml(
          t,
          { className: "season-trophy-img", alt: t.trophyName || t.label }
        )}</div>`
    )
    .join("");

  stats.innerHTML = [
    ...statItems.map((item) => `<span>${item}</span>`),
    trophyRow ? `<div class="season-trophy-row">${trophyRow}</div>` : "",
  ].join("");
  seasonLogEl.prepend(node);
}

export function renderSeasonLog(player, seasonLogEl) {
  seasonLogEl.innerHTML = "";
  if (!player || !player.seasons.length) {
    const hint = document.createElement("p");
    hint.className = "empty-state";
    hint.textContent =
      player?.careerIntroComplete === false
        ? "Complete the career introduction to begin."
        : "No seasons yet. Use Simulate Next Season when ready.";
    seasonLogEl.appendChild(hint);
    return;
  }
  player.seasons.forEach((season) => appendSeasonCard(season, seasonLogEl, player));
}

/**
 * Persistent competitions / results area from career desk + season history.
 */
export function renderCompetitions(player, boardEl) {
  if (!boardEl) return;
  boardEl.innerHTML = "";
  if (!player?.seasons?.length) {
    const note = document.createElement("p");
    note.className = "empty-state";
    note.textContent = "Competition results appear after you simulate a season.";
    boardEl.appendChild(note);
    return;
  }

  const seasonOptions = player.seasons
    .map((s, i) => `<option value="${i}">Season ${i + 1} (${s.year || s.seasonLabel || ""})</option>`)
    .join("");

  const shell = document.createElement("div");
  shell.className = "competitions-shell";
  shell.innerHTML = `
    <div class="competitions-controls">
      <label>Season
        <select id="comp-season-select">${seasonOptions}</select>
      </label>
      <label>Competition
        <select id="comp-name-select"></select>
      </label>
    </div>
    <nav class="competitions-tabs" aria-label="Competition views">
      <button type="button" class="comp-tab is-active" data-view="overview">Overview</button>
      <button type="button" class="comp-tab" data-view="phase">Groups / League phase</button>
      <button type="button" class="comp-tab" data-view="knockout">Knockout draw</button>
      <button type="button" class="comp-tab" data-view="fixtures">Fixtures</button>
    </nav>
    <div id="comp-view" class="competitions-view"></div>
  `;
  boardEl.appendChild(shell);

  const seasonSelect = shell.querySelector("#comp-season-select");
  const nameSelect = shell.querySelector("#comp-name-select");
  const viewEl = shell.querySelector("#comp-view");
  let activeView = "overview";

  function competitionsForSeason(season) {
    const list = [];
    if (season.europeanCampaign) {
      const c = season.europeanCampaign;
      list.push({
        key: "continental",
        label: c.qualified === false || c.showcase
          ? `${c.competition} (not entered / showcase)`
          : c.competition,
        data: c,
        status:
          c.qualified === false || c.showcase
            ? "not-entered"
            : c.won
              ? "champion"
              : c.result || "completed",
      });
    }
    if (season.domesticCup) {
      list.push({
        key: "cup",
        label: season.domesticCup.name || "Domestic cup",
        data: season.domesticCup,
        status: season.domesticCup.won ? "champion" : season.domesticCup.result || "completed",
      });
    }
    if (season.international?.tournaments?.length) {
      season.international.tournaments.forEach((t, ti) => {
        list.push({
          key: `intl-${ti}`,
          label: t.name,
          data: t,
          status: !t.calledUp
            ? t.playerNationInTournament
              ? "not-selected"
              : "nation-not-entered"
            : t.won
              ? "champion"
              : t.result || "completed",
        });
      });
    }
    return list;
  }

  function refreshNames() {
    const season = player.seasons[Number(seasonSelect.value)] || player.seasons[0];
    const comps = competitionsForSeason(season);
    nameSelect.innerHTML = comps.length
      ? comps.map((c, i) => `<option value="${i}">${escapeHtml(c.label)}</option>`).join("")
      : `<option value="">No competitions</option>`;
    return comps;
  }

  function renderView() {
    const season = player.seasons[Number(seasonSelect.value)] || player.seasons[0];
    const comps = competitionsForSeason(season);
    const comp = comps[Number(nameSelect.value)] || comps[0];
    if (!comp) {
      viewEl.innerHTML = `<p class="empty-state">${
        isFreeAgentSeasonRecord(season)
          ? "No league fixtures during this period."
          : "No competition data for this season."
      }</p>`;
      return;
    }
    const d = comp.data;
    const statusNote = `<p class="comp-status" data-status="${comp.status}">Status: ${escapeHtml(
      String(comp.status)
    )}${d.winner ? ` · Champion: ${escapeHtml(d.winner)}` : ""}</p>`;

    if (activeView === "overview") {
      viewEl.innerHTML = `
        ${statusNote}
        <p><strong>${escapeHtml(comp.label)}</strong> — ${escapeHtml(d.result || "Completed")}</p>
        <p>Opening phase: ${escapeHtml(
          d.leaguePhase?.openingLabel || d.groups?.openingLabel || "Knockout"
        )}</p>
        <p>Player path rounds: ${(d.rounds || []).length}. Bracket rounds: ${(d.allRounds || []).length}.</p>
      `;
      return;
    }

    if (activeView === "phase") {
      if (d.leaguePhase?.table?.length) {
        const rows = d.leaguePhase.table
          .map(
            (r) =>
              `<tr class="${r.name === player.club?.name ? "is-player" : ""}"><td>${r.position}</td><td>${escapeHtml(
                r.displayName || r.name
              )}</td><td>${r.played}</td><td>${r.wins}</td><td>${r.draws}</td><td>${r.losses}</td><td>${
                r.goalsFor
              }-${r.goalsAgainst}</td><td>${r.goalDiff}</td><td>${r.points}</td><td>${escapeHtml(
                r.band || ""
              )}</td></tr>`
          )
          .join("");
        viewEl.innerHTML = `${statusNote}<div class="comp-table-wrap"><table class="comp-table"><thead><tr>
          <th>#</th><th>Club</th><th>P</th><th>W</th><th>D</th><th>L</th><th>F-A</th><th>GD</th><th>Pts</th><th>Band</th>
        </tr></thead><tbody>${rows}</tbody></table></div>`;
        return;
      }
      if (d.groups?.groups?.length || d.groups?.length) {
        const groups = d.groups.groups || d.groups;
        viewEl.innerHTML =
          statusNote +
          groups
            .map((g) => {
              const rows = (g.table || [])
                .map(
                  (r, idx) =>
                    `<tr class="${
                      r.name === player.club?.name || r.name === player.nationality ? "is-player" : ""
                    }"><td>${r.position || idx + 1}</td><td>${escapeHtml(
                      r.displayName || r.name
                    )}</td><td>${r.points}</td><td>${r.gd ?? r.goalDiff ?? ""}</td></tr>`
                )
                .join("");
              return `<div class="comp-group"><h4>${escapeHtml(
                g.name
              )}</h4><table class="comp-table"><thead><tr><th>#</th><th>Team</th><th>Pts</th><th>GD</th></tr></thead><tbody>${rows}</tbody></table></div>`;
            })
            .join("");
        return;
      }
      viewEl.innerHTML = `${statusNote}<p class="empty-state">No group / league phase for this competition.</p>`;
      return;
    }

    if (activeView === "knockout") {
      const rounds = d.allRounds || [];
      if (!rounds.length) {
        viewEl.innerHTML = `${statusNote}<p class="empty-state">No knockout bracket stored.</p>`;
        return;
      }
      viewEl.innerHTML =
        statusNote +
        rounds
          .map((r) => {
            const lines = (r.matches || [])
              .map((m) => {
                if (m.isBye) {
                  return `<div class="bracket-match-line">${escapeHtml(
                    (m.home?.isBye ? m.away : m.home)?.displayName || "—"
                  )} <span class="bracket-score">bye</span></div>`;
                }
                return `<div class="bracket-match-line"><span>${escapeHtml(
                  m.home?.displayName || m.home?.name || "—"
                )}</span><span class="bracket-score">${escapeHtml(
                  m.scoreline || `${m.homeGoals ?? "—"}-${m.awayGoals ?? "—"}`
                )}</span><span>${escapeHtml(m.away?.displayName || m.away?.name || "—")}</span></div>`;
              })
              .join("");
            return `<div class="bracket-round-block"><div class="round-name">${escapeHtml(
              r.round
            )}</div>${lines}</div>`;
          })
          .join("");
      return;
    }

    // fixtures
    const fixtures = [
      ...(d.leaguePhase?.matches || []),
      ...((d.groups?.groups || d.groups || []).flatMap((g) => g.matches || []) || []),
      ...(d.groups?.matches || []),
      ...(d.allRounds || []).flatMap((r) => r.matches || []),
      ...(d.playerMatches || []),
    ];
    const seen = new Set();
    const unique = fixtures.filter((m) => {
      const id = m.matchId || m.fixtureId || `${m.round}:${m.home?.name}:${m.away?.name}:${m.scoreline}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    if (!unique.length) {
      viewEl.innerHTML = `${statusNote}<p class="empty-state">No fixtures stored.</p>`;
      return;
    }
    viewEl.innerHTML =
      statusNote +
      `<div class="comp-fixtures">${unique
        .map(
          (m) =>
            `<div class="comp-fixture"><span>${escapeHtml(m.round || "")}</span><span>${escapeHtml(
              m.home?.displayName || m.home?.name || "—"
            )} ${escapeHtml(m.scoreline || `${m.homeGoals ?? ""}-${m.awayGoals ?? ""}`)} ${escapeHtml(
              m.away?.displayName || m.away?.name || "—"
            )}</span></div>`
        )
        .join("")}</div>`;
  }

  refreshNames();
  seasonSelect.addEventListener("change", () => {
    refreshNames();
    renderView();
  });
  nameSelect.addEventListener("change", renderView);
  shell.querySelectorAll(".comp-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      shell.querySelectorAll(".comp-tab").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      activeView = btn.dataset.view;
      renderView();
    });
  });
  renderView();
}

/**
 * Shared full league table for career desk and live simulation dashboard.
 * Columns: Pos · Team · P · W · D · L · GF · GA · GD · Pts
 *
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {object[]} opts.table
 * @param {string|null} [opts.playerClubId]
 * @param {string|null} [opts.playerClubName]
 * @param {Map|object|null} [opts.animateFrom] — previous position by clubId/name
 * @param {boolean} [opts.live] — label provisional/live zone copy
 * @param {boolean} [opts.showLegend]
 * @param {string} [opts.variant] — "board" | "live"
 */
export function renderLeagueTable(container, opts = {}) {
  if (!container) return null;
  const {
    table = [],
    playerClubId = null,
    playerClubName = null,
    animateFrom = null,
    live = false,
    showLegend = false,
    variant = "board",
  } = opts;

  const scrollTop = container.scrollTop;
  const prevFocusKey = document.activeElement?.getAttribute?.("data-club-key") || null;

  let wrap = container.querySelector(".league-table-wrap");
  if (!wrap) {
    container.innerHTML = "";
    wrap = document.createElement("div");
    wrap.className = `league-table-wrap league-table-${variant}`;
    container.appendChild(wrap);
  }

  const preferReduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  const headerHtml = `
    <div class="league-table-header" role="row">
      <span>Pos</span>
      <span>Team</span>
      <span>P</span>
      <span>W</span>
      <span>D</span>
      <span>L</span>
      <span>GF</span>
      <span>GA</span>
      <span>GD</span>
      <span>Pts</span>
    </div>
  `;

  let rowsEl = wrap.querySelector(".league-table-rows");
  if (!rowsEl) {
    wrap.innerHTML = `${headerHtml}<div class="league-table-rows"></div>`;
    if (showLegend) {
      const legend = document.createElement("div");
      legend.className = "league-table-legend";
      legend.innerHTML = live
        ? `<span class="zone-chip zone-title">Title</span>
           <span class="zone-chip zone-euro">Continental</span>
           <span class="zone-chip zone-promo">Promotion</span>
           <span class="zone-chip zone-rel">Relegation</span>
           <span class="zone-note">Zones provisional until the edition finishes.</span>`
        : `<span class="zone-chip zone-title">Title</span>
           <span class="zone-chip zone-euro">Continental</span>
           <span class="zone-chip zone-promo">Promotion</span>
           <span class="zone-chip zone-rel">Relegation</span>`;
      wrap.appendChild(legend);
    }
    rowsEl = wrap.querySelector(".league-table-rows");
  }

  const existing = new Map();
  rowsEl.querySelectorAll(".league-table-row[data-club-key]").forEach((el) => {
    existing.set(el.getAttribute("data-club-key"), el);
  });

  const prevPositions =
    animateFrom instanceof Map
      ? animateFrom
      : animateFrom && typeof animateFrom === "object"
        ? new Map(Object.entries(animateFrom))
        : null;

  const orderedKeys = [];
  (table || []).forEach((team) => {
    const key = String(team.clubId || team.name);
    orderedKeys.push(key);
    let row = existing.get(key);
    const isNew = !row;
    if (!row) {
      row = document.createElement("div");
      row.className = "league-table-row";
      row.setAttribute("data-club-key", key);
      row.setAttribute("tabindex", "-1");
      rowsEl.appendChild(row);
    }

    const isPlayer =
      (playerClubId && team.clubId === playerClubId) ||
      (playerClubName && team.name === playerClubName);
    row.classList.toggle("player-team", Boolean(isPlayer));
    row.classList.toggle("player-row", Boolean(isPlayer));

    const zone = zoneClassForRow(team);
    row.classList.remove("zone-title", "zone-euro", "zone-promo", "zone-rel", "champions", "european");
    if (zone) row.classList.add(zone);
    if (team.position === 1) row.classList.add("champions");

    const prevPos = prevPositions?.get(key);
    let move = "";
    if (prevPos != null && prevPos !== team.position) {
      move =
        prevPos > team.position
          ? `<span class="pos-move pos-up" aria-label="Moved up">▲</span>`
          : `<span class="pos-move pos-down" aria-label="Moved down">▼</span>`;
    }

    const badge = standingsBadgeHtml(team);
    const gd = team.goalDiff != null ? team.goalDiff : (team.goalsFor || 0) - (team.goalsAgainst || 0);
    row.innerHTML = `
      <div class="position">${team.position}${move}</div>
      <div class="team-info">
        ${badge}
        <div>
          <div class="team-name">${escapeHtml(team.displayName || team.name)}</div>
          ${
            team.qualification
              ? `<div class="qualifier">${escapeHtml(team.qualification)}${
                  live ? " · provisional" : ""
                }</div>`
              : ""
          }
          ${
            team.divisionMove
              ? `<div class="qualifier">${escapeHtml(String(team.divisionMove))}</div>`
              : ""
          }
        </div>
      </div>
      <div class="stats-cell">${team.played ?? team.matches ?? 0}</div>
      <div class="stats-cell">${team.wins ?? 0}</div>
      <div class="stats-cell">${team.draws ?? 0}</div>
      <div class="stats-cell">${team.losses ?? 0}</div>
      <div class="stats-cell">${team.goalsFor ?? 0}</div>
      <div class="stats-cell">${team.goalsAgainst ?? 0}</div>
      <div class="stats-cell">${formatSigned(gd)}</div>
      <div class="stats-cell stats-pts">${team.points ?? 0}</div>
    `;

    if (isNew && !preferReduced) {
      row.classList.add("animate-in");
    }
  });

  // Reorder DOM to match standings; animate vertical moves when possible.
  const height = rowsEl.firstElementChild?.offsetHeight || 36;
  const gap = 4;
  const oldIndex = new Map();
  [...rowsEl.children].forEach((el, i) => oldIndex.set(el.getAttribute("data-club-key"), i));

  orderedKeys.forEach((key) => {
    const el = existing.get(key) || rowsEl.querySelector(`[data-club-key="${CSS.escape(key)}"]`);
    if (el) rowsEl.appendChild(el);
  });

  // Remove stale rows
  [...rowsEl.children].forEach((el) => {
    const key = el.getAttribute("data-club-key");
    if (!orderedKeys.includes(key)) el.remove();
  });

  if (!preferReduced && prevPositions) {
    [...rowsEl.children].forEach((el, newIdx) => {
      const key = el.getAttribute("data-club-key");
      const oldIdx = oldIndex.get(key);
      if (oldIdx == null || oldIdx === newIdx) return;
      const delta = (oldIdx - newIdx) * (height + gap);
      el.style.transition = "none";
      el.style.transform = `translateY(${delta}px)`;
      requestAnimationFrame(() => {
        el.style.transition = "transform 400ms ease";
        el.style.transform = "translateY(0)";
        const clear = () => {
          el.style.transition = "";
          el.style.transform = "";
          el.removeEventListener("transitionend", clear);
        };
        el.addEventListener("transitionend", clear);
      });
    });
  }

  container.scrollTop = scrollTop;
  if (prevFocusKey) {
    const focusEl = rowsEl.querySelector(`[data-club-key="${CSS.escape(prevFocusKey)}"]`);
    focusEl?.focus({ preventScroll: true });
  }

  return {
    positions: new Map((table || []).map((t) => [String(t.clubId || t.name), t.position])),
  };
}

function zoneClassForRow(team) {
  const q = String(team.qualification || "").toLowerCase();
  const move = String(team.divisionMove || "").toLowerCase();
  if (team.position === 1 || /league champions|title/.test(q)) return "zone-title";
  if (/champions league|europa|conference|libertadores|sudamericana|afc|caf|concacaf/.test(q)) {
    return "zone-euro";
  }
  if (move === "promoted" || /promot/.test(q)) return "zone-promo";
  if (move === "relegated" || /relegat/.test(q)) return "zone-rel";
  return null;
}

function standingsBadgeHtml(team) {
  const name = escapeHtml(team.displayName || team.name || "?");
  const initials = escapeHtml((team.displayName || team.name || "?").slice(0, 2));
  if (!team.badge) {
    return `<div class="team-badge standings-badge match-badge-fallback" aria-hidden="true">${initials}</div>`;
  }
  return `<img src="${escapeHtml(team.badge)}" alt="${name} badge" class="team-badge standings-badge" loading="lazy" onerror="this.onerror=null;this.replaceWith(Object.assign(document.createElement('div'),{className:'team-badge standings-badge match-badge-fallback',textContent:'${initials}'}))" />`;
}

export function renderStandings(player, standingsBoard) {
  standingsBoard.innerHTML = "";
  if (!player || !player.seasons.length) {
    const note = document.createElement("p");
    note.className = "empty-state";
    note.textContent = "Standings appear after you simulate a season with league fixtures.";
    standingsBoard.appendChild(note);
    return;
  }

  const latestSeason = player.seasons[player.seasons.length - 1];
  // Free-agent periods keep latestStanding for history, but must not relabel that
  // prior club table as a new league campaign for the current period.
  if (isFreeAgentSeasonRecord(latestSeason)) {
    const note = document.createElement("p");
    note.className = "empty-state";
    note.dataset.standingsState = "no-league-fixtures";
    note.textContent = "No league fixtures during this period.";
    standingsBoard.appendChild(note);
    return;
  }

  if (!player.latestStanding) {
    const note = document.createElement("p");
    note.className = "empty-state";
    note.textContent = "Standings appear after you simulate a season with league fixtures.";
    standingsBoard.appendChild(note);
    return;
  }

  const { league, leagueDisplay, table, playerRow } = player.latestStanding;
  const sourceSeasonNumber = Number.isFinite(latestSeason?.seasonNumber)
    ? latestSeason.seasonNumber
    : Number.isFinite(player.latestStanding.seasonNumber)
      ? player.latestStanding.seasonNumber
      : player.seasons.filter((s) => !isFreeAgentSeasonRecord(s)).length || player.seasons.length;
  const caption = document.createElement("div");
  caption.className = "standings-summary";
  caption.textContent = `${leagueDisplay ?? league} - Season ${sourceSeasonNumber}`;
  standingsBoard.appendChild(caption);

  const host = document.createElement("div");
  host.className = "standings-table-host";
  standingsBoard.appendChild(host);

  renderLeagueTable(host, {
    table: table || [],
    playerClubId: player.playingClubId || player.club?.clubId || playerRow?.clubId || null,
    playerClubName: playerRow?.name || player.club?.name || null,
    showLegend: true,
    variant: "board",
  });
}

/** Map the generic "Stay at club" control onto a concrete squad-decision choice. */
export function stayChoiceIdForDecision(decision) {
  const ids = new Set((decision?.choices || []).map((c) => c.id));
  if (ids.has("see-out")) return "see-out";
  if (ids.has("stay-compete")) return "stay-compete";
  if (ids.has("remain")) return "remain";
  if (ids.has("acknowledge")) return "acknowledge";
  return null;
}

export function renderTransferOffers({
  player,
  transferContainer,
  simulateBtn,
  applyTransfer,
  finishOfferWindow,
  promoteToParentClub,
  onDecision = null,
}) {
  transferContainer.innerHTML = "";

  const hasDecision = Boolean(player.pendingDecision);
  const hasOffers = Boolean(player.pendingOffers?.length);

  if (!hasOffers && !hasDecision) {
    if (player.club?.isAcademy) {
      const notice = document.createElement("p");
      notice.className = "empty-state";
      notice.textContent =
        player.seasons.length > 0
          ? "No suitable professional offer is available right now. You can continue at the academy or wait for a fitting club."
          : "Complete career setup to begin.";
      transferContainer.appendChild(notice);
    } else if (isFreeAgent(player) || !player.club) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent =
        "You are a free agent. No clubs have made an offer yet — train, wait, or search again next window. You will not play club matches until you sign.";
      transferContainer.appendChild(empty);
    } else {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent =
        "No active transfer offers. Keep performing — zero interest is a valid outcome.";
      transferContainer.appendChild(empty);
    }
    simulateBtn.disabled = !!player.isRetired;
    return;
  }

  // Manager / loan decision card (academy-style)
  if (hasDecision && !(player.pendingOffers || []).some((o) => o.isLoan)) {
    const d = player.pendingDecision;
    const card = document.createElement("div");
    card.className = "offer-card career-decision-card";
    card.innerHTML = `
      <div class="details">
        <strong>${escapeHtml(d.headline || "Squad discussion")}</strong>
        <span>${escapeHtml(d.lead || "")}</span>
      </div>
      <div class="offer-actions" data-decision-actions></div>
    `;
    const actions = card.querySelector("[data-decision-actions]");
    for (const choice of d.choices || []) {
      const btn = document.createElement("button");
      btn.className = choice.id.includes("loan") ? "accept" : "secondary";
      btn.textContent = choice.label;
      btn.addEventListener("click", () => {
        if (typeof onDecision === "function") {
          onDecision(d, choice.id);
        } else if (choice.offers?.length) {
          player.pendingOffers = choice.offers;
          player.pendingDecision = null;
          renderTransferOffers({
            player,
            transferContainer,
            simulateBtn,
            applyTransfer,
            finishOfferWindow,
            promoteToParentClub,
            onDecision,
          });
        } else {
          player.pendingDecision = null;
          finishOfferWindow(false);
        }
      });
      actions.appendChild(btn);
    }
    transferContainer.appendChild(card);
  }

  (player.pendingOffers || []).forEach((offer, index) => {
    const template = document.getElementById("offer-template");
    const node = template.content.cloneNode(true);
    const details = node.querySelector(".details");
    const actions = node.querySelector(".offer-actions");
    const offerClubName = offer.clubDisplay ?? offer.club;
    const dealLabel = offer.isLoan
      ? "Loan"
      : offer.isRenewal
        ? "Renewal"
        : offer.isFreeAgent || offer.dealType === "first_pro"
          ? "Free / first contract"
          : "Permanent";
    const roleLabel = offer.expectedRole || "squad";
    const minutes =
      offer.projectedMinutesRange != null
        ? `${offer.projectedMinutesRange[0]}–${offer.projectedMinutesRange[1]}% projected club minutes`
        : null;

    const badgeMarkup = offer.badge
      ? `<img class="club-badge badge-small" src="${offer.badge}" alt="${escapeHtml(offerClubName)} badge" loading="lazy" />`
      : "";

    const feeLine = offer.isLoan
      ? `<span>Loan fee: ${formatCurrency(offer.loanFee || 0)}</span>`
      : `<span>Transfer fee: ${formatCurrency(offer.transferFee || 0)}</span>`;
    const wage = Number.isFinite(offer.wage) ? offer.wage : 0;
    const parentName =
      offer.parentClubName ||
      offer.loanTerms?.parentClubName ||
      player.parentClubSnapshot?.displayName ||
      player.parentClubSnapshot?.name ||
      null;
    const loanStart = offer.loanTerms?.startDate || offer.effectiveDate || offer.reviewDate;
    const loanEnd = offer.loanTerms?.endDate;
    const lengthLine = offer.isLoan
      ? `<span>Loan dates: ${escapeHtml(loanStart || "TBC")} → ${escapeHtml(
          loanEnd || "end of season"
        )}${
          offer.loanTerms?.purchaseOption
            ? ` · purchase option ${formatCurrency(offer.loanTerms.purchaseOption.fee)}`
            : ""
        }</span>`
      : `<span>Contract length: ${offer.contractYears} years</span>`;

    details.innerHTML = `
      <div class="offer-heading">
        ${badgeMarkup}
        <div>
          <strong>${escapeHtml(offerClubName)}</strong>
          <span>${escapeHtml(offer.leagueDisplay ?? offer.league)} · ${escapeHtml(dealLabel)}</span>
        </div>
      </div>
      <span>${escapeHtml(offer.message)}</span>
      ${
        offer.isLoan
          ? `<span>Parent club: ${escapeHtml(String(parentName || "—"))}</span>`
          : ""
      }
      <span>Gross weekly wage: ${formatCurrency(wage)}</span>
      ${feeLine}
      ${lengthLine}
      <span>Expected role: ${escapeHtml(roleLabel)}${minutes ? ` · ${escapeHtml(minutes)}` : ""}</span>
      ${
        offer.isLoan && offer.loanTerms
          ? `<span>Parent club retains registration; wage split borrower ${(
              (offer.loanTerms.borrowerWageShare || 0) * 100
            ).toFixed(0)}% / parent ${((offer.loanTerms.parentWageShare || 0) * 100).toFixed(0)}%</span>`
          : ""
      }
    `;

    const acceptBtn = document.createElement("button");
    acceptBtn.className = "accept";
    acceptBtn.textContent = offer.isLoan ? "Accept Loan" : "Accept Offer";
    acceptBtn.addEventListener("click", () => {
      acceptBtn.disabled = true;
      applyTransfer(offer);
    });

    actions.appendChild(acceptBtn);

    const declineBtn = document.createElement("button");
    declineBtn.className = "decline";
    declineBtn.textContent = "Decline";
    declineBtn.addEventListener("click", () => {
      markOfferStatus(player, offer, "declined");
      player.pendingOffers.splice(index, 1);
      if (!player.pendingOffers.length) {
        finishOfferWindow(false);
      } else {
        renderTransferOffers({
          player,
          transferContainer,
          simulateBtn,
          applyTransfer,
          finishOfferWindow,
          promoteToParentClub,
          onDecision,
        });
      }
    });
    actions.appendChild(declineBtn);
    transferContainer.appendChild(node);
  });

  if (player.club || isFreeAgent(player)) {
    const contractValid = isContractActive(player);
    const hasRenewalOffer = (player.pendingOffers || []).some(
      (offer) =>
        offer.isRenewal &&
        (offer.clubId === player.employmentClubId || offer.club === player.club?.name)
    );

    if (player.club?.isAcademy && player.club.parentClub && !player.suppressParentContractOffer) {
      const stayBtn = document.createElement("button");
      stayBtn.className = "secondary";
      const parentDisplay = clubNameForDisplay(player.club.parentClub);
      stayBtn.textContent = `Sign with ${parentDisplay}`;
      stayBtn.addEventListener("click", () => {
        const signed = promoteToParentClub("manual");
        if (!signed) {
          window.alert(
            "Professional contract could not be completed under the club's current limits. You remain at the academy."
          );
          return;
        }
        finishOfferWindow(true, {
          isParentOffer: true,
          club: player.club.name,
          clubDisplay: clubNameForDisplay(player.club),
          league: player.club.league,
          leagueDisplay: player.club.leagueDisplay ?? player.club.league,
          transferFee: 0,
        });
      });
      transferContainer.appendChild(stayBtn);
    } else if (contractValid || hasRenewalOffer) {
      const stayBtn = document.createElement("button");
      stayBtn.className = "secondary";

      if (contractValid) {
        const seasonsRemaining =
          player.contractEndSeason != null
            ? player.contractEndSeason - (player.seasons?.length ?? 0)
            : "unknown";
        stayBtn.textContent = `Decline offers and continue at ${clubNameForDisplay(player.club)}${
          seasonsRemaining !== "unknown"
            ? ` (${seasonsRemaining} season${seasonsRemaining !== 1 ? "s" : ""} remaining)`
            : ""
        }`;
        stayBtn.addEventListener("click", () => {
          // Decline relevant window offers and resume when contract is still active.
          const decision = player.pendingDecision;
          const stayId = stayChoiceIdForDecision(decision);
          if (decision && stayId && typeof onDecision === "function") {
            onDecision(decision, stayId);
            return;
          }
          finishOfferWindow(false);
        });
      } else if (hasRenewalOffer) {
        const renewalOffer = player.pendingOffers.find(
          (offer) =>
            offer.isRenewal &&
            (offer.clubId === player.employmentClubId || offer.club === player.club?.name)
        );
        stayBtn.textContent = `Accept Renewal from ${clubNameForDisplay(player.club)}`;
        stayBtn.addEventListener("click", () => {
          if (renewalOffer) {
            applyTransfer(renewalOffer);
          } else {
            finishOfferWindow(false);
          }
        });
      }

      transferContainer.appendChild(stayBtn);
    } else if (isFreeAgent(player) || !contractValid) {
      const waitBtn = document.createElement("button");
      waitBtn.className = "secondary";
      waitBtn.textContent = "Continue as free agent (train / wait)";
      waitBtn.addEventListener("click", () => {
        finishOfferWindow(false);
      });
      transferContainer.appendChild(waitBtn);
    }
  }
}
