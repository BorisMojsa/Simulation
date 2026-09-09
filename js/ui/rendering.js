import {
  clubNameForDisplay,
  escapeHtml,
  formatCurrency,
  formatOrdinal,
  formatSigned,
} from "../utils/helpers.js";

export function renderPlayerOverview(player, overviewEl, statsKeys) {
  if (!player) return;
  const totals = player.careerTotals;
  const cleanSheetLine = totals.cleanSheets ? ` - ${totals.cleanSheets} clean sheets` : "";
  const currentClubName = clubNameForDisplay(player.club);
  const clubLeagueName = player.club?.leagueDisplay ?? player.club?.league ?? "Unknown League";
  const clubBadge = player.club?.badge
    ? `<img class="club-badge" src="${player.club.badge}" alt="${escapeHtml(currentClubName)} badge" loading="lazy" />`
    : "";
  const latestStanding = player.latestStanding?.playerRow;
  const finishLine = latestStanding
    ? `<span>Last finish: ${formatOrdinal(latestStanding.position)} - ${latestStanding.points} pts${
        latestStanding.qualification ? ` (${latestStanding.qualification})` : ""
      }</span>`
    : "";
  const honors = player.careerHonors;
  const honorLine = honors
    ? `<span>Honors: ${honors.leagueTitles} league titles | ${honors.domesticCups} cups | ${honors.europeanTitles} European titles | ${honors.individualAwards} awards</span>`
    : "";
  overviewEl.innerHTML = `
    <div class="player-summary">
      <div class="club-heading">
        ${clubBadge}
        <div>
          <h2>${escapeHtml(player.name)} - OVR ${player.rating}</h2>
          <span>${player.age} yrs - ${escapeHtml(player.position)}</span>
          <span>${escapeHtml(player.nationality)} international</span>
          <span>${escapeHtml(currentClubName)} - ${escapeHtml(clubLeagueName)}</span>
        </div>
      </div>
      <span>Career totals: ${totals.matches} apps - ${totals.goals} goals - ${totals.assists} assists${cleanSheetLine}</span>
      ${finishLine}
      ${honorLine}
    </div>
    <div class="player-metrics">
      ${statsKeys
        .map(
          (key) => `
          <div class="metric">
            <span class="label">${key}</span>
            <span class="value">${player.attributes[key]}</span>
          </div>
        `
        )
        .join("")}
    </div>
  `;
}

export function appendSeasonCard(season, seasonLogEl, player) {
  const template = document.getElementById("season-template");
  const node = template.content.cloneNode(true);
  const header = node.querySelector("header");
  const summary = node.querySelector(".summary");
  const stats = node.querySelector(".stats");

  const yearLabel = `${player.startYear + season.seasonNumber - 1}/${(player.startYear + season.seasonNumber).toString().slice(-2)}`;
  const ratingSign = season.ratingChange > 0 ? "+" : "";
  const seasonClubName = season.clubDisplay ?? season.club;
  const badgeMarkup = season.badge
    ? `<img class="club-badge badge-small" src="${season.badge}" alt="${escapeHtml(seasonClubName)} badge" loading="lazy" />`
    : "";
  const finishLabel = season.standing
    ? `${formatOrdinal(season.standing.position)} | ${season.standing.points} pts`
    : "N/A";
  const honorsLabel = season.honors ? ` - ${season.honors}` : "";

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
    <dd>${finishLabel}${honorsLabel}</dd>
    <dt>Overall change</dt>
    <dd>${ratingSign}${season.ratingChange}</dd>
    <dt>Average rating</dt>
    <dd>${season.avgMatchRating.toFixed(2)}</dd>
    <dt>Europe</dt>
    <dd>${season.europeanCampaign ? `${season.europeanCampaign.competition} - ${season.europeanCampaign.result}` : "No competition"}</dd>
    <dt>Domestic cup</dt>
    <dd>${season.domesticCupResult?.result || "N/A"}</dd>
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

  statItems.push(`OVR ${season.ratingAfter}`);

  if (season.europeanCampaign) {
    statItems.push(`${season.europeanCampaign.competition}: ${season.europeanCampaign.result}`);
  }

  if (season.domesticCupResult) {
    statItems.push(`Domestic cup: ${season.domesticCupResult.result}`);
  }

  if (season.individualAwards?.length) {
    statItems.push(`Awards: ${season.individualAwards.join(", ")}`);
  }

  if (season.trophies?.length) {
    statItems.push(`Trophies: ${season.trophies.join(", ")}`);
  }

  if (season.isNarrativeAcademyYear) {
    statItems.push("Academy narrative year — no senior league / cups yet");
  }

  stats.innerHTML = statItems.map((item) => `<span>${item}</span>`).join("");
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

export function renderStandings(player, standingsBoard) {
  standingsBoard.innerHTML = "";
  if (!player || !player.seasons.length || !player.latestStanding) {
    const note = document.createElement("p");
    note.className = "empty-state";
    note.textContent = "Standings appear after you simulate a season with league fixtures.";
    standingsBoard.appendChild(note);
    return;
  }

  const { league, leagueDisplay, table, playerRow } = player.latestStanding;
  const caption = document.createElement("div");
  caption.className = "standings-summary";
  caption.textContent = `${leagueDisplay ?? league} - Season ${player.seasons.length}`;
  standingsBoard.appendChild(caption);

  const tableEl = document.createElement("table");
  tableEl.innerHTML = `
    <thead>
      <tr>
        <th>#</th>
        <th>Team</th>
        <th>Pts</th>
        <th>W</th>
        <th>D</th>
        <th>L</th>
        <th>GD</th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement("tbody");
  (table || []).forEach((row) => {
    const tr = document.createElement("tr");
    if (playerRow && row.name === playerRow.name) {
      tr.classList.add("player-row");
    }

    const teamCell = document.createElement("td");
    teamCell.textContent = row.position;
    tr.appendChild(teamCell);

    const nameCell = document.createElement("td");
    const teamWrapper = document.createElement("div");
    teamWrapper.className = "standings-team";

    if (row.badge) {
      const img = document.createElement("img");
      img.src = row.badge;
      img.alt = `${row.displayName ?? row.name} badge`;
      img.loading = "lazy";
      img.className = "standings-badge";
      teamWrapper.appendChild(img);
    }

    const textHolder = document.createElement("div");
    const nameSpan = document.createElement("span");
    nameSpan.textContent = row.displayName ?? row.name;
    textHolder.appendChild(nameSpan);
    if (row.qualification) {
      const qualifier = document.createElement("span");
      qualifier.className = "standing-qualifier";
      qualifier.textContent = row.qualification;
      textHolder.appendChild(qualifier);
    }
    teamWrapper.appendChild(textHolder);
    nameCell.appendChild(teamWrapper);
    tr.appendChild(nameCell);

    const pointsCell = document.createElement("td");
    pointsCell.textContent = row.points;
    tr.appendChild(pointsCell);

    const winsCell = document.createElement("td");
    winsCell.textContent = row.wins;
    tr.appendChild(winsCell);

    const drawsCell = document.createElement("td");
    drawsCell.textContent = row.draws;
    tr.appendChild(drawsCell);

    const lossesCell = document.createElement("td");
    lossesCell.textContent = row.losses;
    tr.appendChild(lossesCell);

    const gdCell = document.createElement("td");
    gdCell.textContent = formatSigned(row.goalDiff);
    tr.appendChild(gdCell);

    tbody.appendChild(tr);
  });

  tableEl.appendChild(tbody);
  standingsBoard.appendChild(tableEl);
}

export function renderTransferOffers({
  player,
  transferContainer,
  simulateBtn,
  applyTransfer,
  finishOfferWindow,
  promoteToParentClub,
}) {
  transferContainer.innerHTML = "";
  if (!player.pendingOffers.length) {
    if (player.club?.isAcademy) {
      const notice = document.createElement("p");
      notice.className = "empty-state";
      notice.textContent =
        player.seasons.length > 0
          ? "Awaiting a decision on offers in the transfer panel."
          : "Complete career setup to begin.";
      transferContainer.appendChild(notice);
    } else {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No active transfer offers. Keep performing to attract interest.";
      transferContainer.appendChild(empty);
    }
    simulateBtn.disabled = !!player.isRetired;
    return;
  }

  player.pendingOffers.forEach((offer, index) => {
    const template = document.getElementById("offer-template");
    const node = template.content.cloneNode(true);
    const details = node.querySelector(".details");
    const actions = node.querySelector(".offer-actions");
    const offerClubName = offer.clubDisplay ?? offer.club;

    const badgeMarkup = offer.badge
      ? `<img class="club-badge badge-small" src="${offer.badge}" alt="${escapeHtml(offerClubName)} badge" loading="lazy" />`
      : "";

    details.innerHTML = `
      <div class="offer-heading">
        ${badgeMarkup}
        <div>
          <strong>${escapeHtml(offerClubName)}</strong>
          <span>${escapeHtml(offer.leagueDisplay ?? offer.league)}</span>
        </div>
      </div>
      <span>${escapeHtml(offer.message)}</span>
      <span>Wage offer: ${formatCurrency(Math.max(900, offer.wage))} per week</span>
      <span>Transfer fee: ${formatCurrency(offer.transferFee)}</span>
      <span>Contract length: ${offer.contractYears} years</span>
    `;

    const acceptBtn = document.createElement("button");
    acceptBtn.className = "accept";
    acceptBtn.textContent = "Accept Offer";
    acceptBtn.addEventListener("click", () => {
      applyTransfer(offer);
    });

    actions.appendChild(acceptBtn);

    if (!offer.isReleasedYouthOffer) {
      const declineBtn = document.createElement("button");
      declineBtn.className = "decline";
      declineBtn.textContent = "Decline";
      declineBtn.addEventListener("click", () => {
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
          });
        }
      });
      actions.appendChild(declineBtn);
    }
    transferContainer.appendChild(node);
  });

  if (player.club) {
    const currentSeason = player.seasons.length;
    const contractValid = player.contractEndSeason === null || currentSeason < player.contractEndSeason;
    const hasRenewalOffer = player.pendingOffers.some((offer) => offer.isRenewal && offer.club === player.club.name);

    if (player.club.isAcademy && player.club.parentClub && !player.suppressParentContractOffer) {
      const stayBtn = document.createElement("button");
      stayBtn.className = "secondary";
      const parentDisplay = clubNameForDisplay(player.club.parentClub);
      stayBtn.textContent = `Sign with ${parentDisplay}`;
      stayBtn.addEventListener("click", () => {
        promoteToParentClub("manual");
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
          player.contractEndSeason !== null ? player.contractEndSeason - currentSeason : "unknown";
        stayBtn.textContent = `Stay at ${clubNameForDisplay(player.club)}${
          seasonsRemaining !== "unknown"
            ? ` (${seasonsRemaining} season${seasonsRemaining !== 1 ? "s" : ""} remaining)`
            : ""
        }`;
        stayBtn.addEventListener("click", () => finishOfferWindow(false));
      } else if (hasRenewalOffer) {
        const renewalOffer = player.pendingOffers.find((offer) => offer.isRenewal && offer.club === player.club.name);
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
    }
  }
}
