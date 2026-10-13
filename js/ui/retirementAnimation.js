import { enrichTrophyWin, trophyImageHtml } from "../data/trophyAssets.js";
import { formatAbilityForDisplay } from "./abilityFormatting.js";

export function showRetirementAnimation(player, onContinue) {
  const overlay = document.getElementById("retirement-animation-overlay");
  const subtitle = document.getElementById("retirement-subtitle");

  subtitle.textContent = `${player.name} - ${player.age} years old`;
  overlay.classList.remove("hidden");

  const statsGrid = document.getElementById("career-stats-grid");
  const highlightsGrid = document.getElementById("highlights-grid");
  const ratingDisplay = document.getElementById("final-rating-display");
  const timelineContainer = document.getElementById("timeline-container");

  statsGrid.innerHTML = "";
  highlightsGrid.innerHTML = "";
  ratingDisplay.innerHTML = "";
  timelineContainer.innerHTML = "";

  document.querySelector(".career-stats-section")?.classList.remove("active");
  document.querySelector(".career-highlights-section")?.classList.remove("active");
  document.querySelector(".final-rating-section")?.classList.remove("active");
  document.querySelector(".career-timeline-section")?.classList.remove("active");
  document.querySelector(".thank-you-section")?.classList.remove("active");

  setTimeout(() => {
    showCareerStats(player);
  }, 1000);

  setTimeout(() => {
    showCareerHighlights(player);
  }, 3000);

  setTimeout(() => {
    showFinalRating(player);
  }, 5000);

  setTimeout(() => {
    showCareerTimeline(player);
  }, 7000);

  setTimeout(() => {
    showThankYouMessage();
  }, 10000);

  const retirementContinueBtn = document.getElementById("retirement-continue-btn");
  retirementContinueBtn.onclick = () => {
    overlay.classList.add("hidden");
    if (typeof onContinue === "function") {
      onContinue();
    }
  };
}

function showCareerStats(player) {
  const statsGrid = document.getElementById("career-stats-grid");
  const section = document.querySelector(".career-stats-section");

  statsGrid.innerHTML = "";

  const stats = [
    { label: "Matches", value: player.careerTotals.matches },
    { label: "Goals", value: player.careerTotals.goals },
    { label: "Assists", value: player.careerTotals.assists },
    { label: "Clean Sheets", value: player.careerTotals.cleanSheets },
    { label: "Seasons", value: player.seasons.length },
    { label: "Age", value: player.age },
  ];

  stats.forEach((stat, index) => {
    const statEl = document.createElement("div");
    statEl.className = "stat-card";
    statEl.innerHTML = `
      <div class="stat-value">${stat.value}</div>
      <div class="stat-label">${stat.label}</div>
    `;
    statsGrid.appendChild(statEl);

    setTimeout(() => {
      statEl.classList.add("animate-in");
    }, index * 200 + 500);
  });

  section?.classList.add("active");
}

function showCareerHighlights(player) {
  const highlightsGrid = document.getElementById("highlights-grid");
  const section = document.querySelector(".career-highlights-section");

  highlightsGrid.innerHTML = "";

  const highlights = [];
  const honors = player.careerHonors || {};
  const continental = getContinentalWins(player);

  if (honors.leagueTitles > 0) {
    highlights.push({
      icon: "League",
      title: "League Titles",
      description: `${honors.leagueTitles} championship${honors.leagueTitles > 1 ? "s" : ""} won`,
    });
  }

  if (continental.count > 0) {
    highlights.push({
      icon: continental.icon,
      title: continental.title,
      description: continental.description,
    });
  }

  if (honors.internationalTitles > 0) {
    const intlNames = getInternationalWinNames(player);
    highlights.push({
      icon: "Intl",
      title: intlNames.length === 1 ? intlNames[0] : "International Titles",
      description:
        intlNames.length === 1
          ? `${honors.internationalTitles} title${honors.internationalTitles > 1 ? "s" : ""} won`
          : `${honors.internationalTitles} major international trophy${
              honors.internationalTitles > 1 ? "ies" : ""
            } won`,
    });
  }

  if (honors.domesticCups > 0) {
    highlights.push({
      icon: "Cups",
      title: "Domestic Cups",
      description: `${honors.domesticCups} cup${honors.domesticCups > 1 ? "s" : ""} won`,
    });
  }

  if (honors.individualAwards > 0) {
    highlights.push({
      icon: "Awards",
      title: "Individual Awards",
      description: `${honors.individualAwards} personal award${honors.individualAwards > 1 ? "s" : ""} received`,
    });
  }

  if (player.careerTotals.goals >= 100) {
    highlights.push({
      icon: "Goals",
      title: "Century Club",
      description: `${player.careerTotals.goals} career goals scored`,
    });
  }

  if (player.careerTotals.matches >= 500) {
    highlights.push({
      icon: "Apps",
      title: "Veteran",
      description: `${player.careerTotals.matches} career appearances`,
    });
  }

  if (highlights.length === 0) {
    highlights.push({
      icon: "Career",
      title: "Dedicated Career",
      description: "A solid career with consistent performances",
    });
  }

  // Collect unique trophy assets from career wins for a visual cabinet
  const trophyCabinet = [];
  const seenSrc = new Set();
  for (const season of player.seasons || []) {
    for (const raw of season.trophies || []) {
      const win = enrichTrophyWin(typeof raw === "string" ? { label: raw, competition: raw } : raw);
      if (!win?.src || seenSrc.has(win.src)) continue;
      seenSrc.add(win.src);
      trophyCabinet.push(win);
    }
  }

  highlights.forEach((highlight, index) => {
    const highlightEl = document.createElement("div");
    highlightEl.className = "highlight-card";
    highlightEl.innerHTML = `
      <div class="icon">${highlight.icon}</div>
      <div class="highlight-title">${highlight.title}</div>
      <div class="highlight-description">${highlight.description}</div>
    `;
    highlightsGrid.appendChild(highlightEl);

    setTimeout(() => {
      highlightEl.classList.add("animate-in");
    }, index * 300 + 500);
  });

  if (trophyCabinet.length) {
    const cabinet = document.createElement("div");
    cabinet.className = "retirement-trophy-cabinet";
    cabinet.innerHTML = `
      <div class="highlight-title" style="margin-bottom:0.75rem">Trophy cabinet</div>
      <div class="retirement-trophy-grid">
        ${trophyCabinet
          .map(
            (t) => `
          <div class="retirement-trophy-item" title="${t.label || t.competition}">
            ${trophyImageHtml(t, { className: "retirement-trophy-img", alt: t.trophyName || t.label })}
            <span>${t.label || t.competition}</span>
          </div>`
          )
          .join("")}
      </div>
    `;
    highlightsGrid.appendChild(cabinet);
    setTimeout(() => cabinet.classList.add("animate-in"), highlights.length * 300 + 500);
  }

  section?.classList.add("active");
}

function getContinentalWins(player) {
  const campaigns = (player.seasons || [])
    .map((s) => s.europeanCampaign)
    .filter((c) => c && c.won && c.qualified !== false && c.competition);

  // Prefer season history; fall back to honor counter only if seasons lack campaign detail
  const count = campaigns.length || player.careerHonors?.europeanTitles || 0;
  if (!count) return { count: 0 };

  const comps = [...new Set(campaigns.map((c) => c.competition))];
  const isUefa = (name) =>
    /Champions League|Europa League|Conference League/i.test(name || "");
  const isConmebol = (name) => /Libertadores|Sudamericana/i.test(name || "");
  const isConcacaf = (name) => /CONCACAF/i.test(name || "");

  if (comps.length && comps.every(isUefa)) {
    return {
      count,
      icon: "Europe",
      title: "European Titles",
      description: `${count} European trophy${count > 1 ? "ies" : ""} won`,
    };
  }
  if (comps.length === 1) {
    return {
      count,
      icon: isConcacaf(comps[0]) ? "CONCACAF" : isConmebol(comps[0]) ? "CONMEBOL" : "Cup",
      title: comps[0],
      description: `${count} title${count > 1 ? "s" : ""} won`,
    };
  }
  if (comps.length > 1) {
    return {
      count,
      icon: "Continent",
      title: "Continental Titles",
      description: `${count} continental trophy${count > 1 ? "ies" : ""} won`,
    };
  }

  // Honor counter without campaign names — never assume Europe
  return {
    count,
    icon: "Continent",
    title: "Continental Titles",
    description: `${count} continental trophy${count > 1 ? "ies" : ""} won`,
  };
}

function getInternationalWinNames(player) {
  return [
    ...new Set(
      (player.seasons || [])
        .filter((s) => s.internationalSeason?.primary?.won)
        .map((s) => s.internationalSeason.primary.name || s.internationalSeason.callUpTournament)
        .filter(Boolean)
    ),
  ];
}

function showFinalRating(player) {
  const ratingDisplay = document.getElementById("final-rating-display");
  const section = document.querySelector(".final-rating-section");

  ratingDisplay.innerHTML = `
    <div class="final-rating-value">${formatAbilityForDisplay(player.rating)}</div>
    <div class="final-rating-label">Final Overall Rating</div>
  `;

  section?.classList.add("active");
}

function showCareerTimeline(player) {
  const timelineContainer = document.getElementById("timeline-container");
  const section = document.querySelector(".career-timeline-section");

  timelineContainer.innerHTML = "";

  const seasonsToShow = player.seasons.slice(-5);

  seasonsToShow.forEach((season, index) => {
    const timelineEl = document.createElement("div");
    timelineEl.className = "timeline-item";

    const statsText =
      player.position === "GK"
        ? `${season.goals}G ${season.assists}A ${season.cleanSheets}CS`
        : `${season.goals}G ${season.assists}A`;

    const badgeSrc = season.badge || "";
    const badgeHtml = badgeSrc
      ? `<img src="${badgeSrc}" alt="" width="40" height="40" loading="lazy" />`
      : `<span class="timeline-badge-fallback">${(season.clubDisplay || season.club || "?")
          .slice(0, 2)
          .toUpperCase()}</span>`;

    timelineEl.innerHTML = `
      <div class="timeline-badge">${badgeHtml}</div>
      <div class="timeline-content">
        <div class="timeline-season">Season ${season.seasonNumber} (Age ${season.age})</div>
        <div class="timeline-club">${season.clubDisplay || season.club || "—"}</div>
        <div class="timeline-stats">${statsText} • ${season.matches} matches</div>
      </div>
    `;

    timelineContainer.appendChild(timelineEl);

    setTimeout(() => {
      timelineEl.classList.add("animate-in");
    }, index * 400 + 500);
  });

  section?.classList.add("active");
}

function showThankYouMessage() {
  const section = document.querySelector(".thank-you-section");
  section?.classList.add("active");
}
