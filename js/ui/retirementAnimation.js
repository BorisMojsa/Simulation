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

  if (player.careerHonors.leagueTitles > 0) {
    highlights.push({
      icon: "🏆",
      title: "League Titles",
      description: `${player.careerHonors.leagueTitles} championship${player.careerHonors.leagueTitles > 1 ? "s" : ""} won`,
    });
  }

  if (player.careerHonors.europeanTitles > 0) {
    highlights.push({
      icon: "🌍",
      title: "European Titles",
      description: `${player.careerHonors.europeanTitles} European trophy${player.careerHonors.europeanTitles > 1 ? "ies" : ""} won`,
    });
  }

  if (player.careerHonors.domesticCups > 0) {
    highlights.push({
      icon: "🥇",
      title: "Domestic Cups",
      description: `${player.careerHonors.domesticCups} cup${player.careerHonors.domesticCups > 1 ? "s" : ""} won`,
    });
  }

  if (player.careerHonors.individualAwards > 0) {
    highlights.push({
      icon: "⭐",
      title: "Individual Awards",
      description: `${player.careerHonors.individualAwards} personal award${player.careerHonors.individualAwards > 1 ? "s" : ""} received`,
    });
  }

  if (player.careerTotals.goals >= 100) {
    highlights.push({
      icon: "⚽",
      title: "Century Club",
      description: `${player.careerTotals.goals} career goals scored`,
    });
  }

  if (player.careerTotals.matches >= 500) {
    highlights.push({
      icon: "👟",
      title: "Veteran",
      description: `${player.careerTotals.matches} career appearances`,
    });
  }

  if (highlights.length === 0) {
    highlights.push({
      icon: "💪",
      title: "Dedicated Career",
      description: "A solid career with consistent performances",
    });
  }

  highlights.forEach((highlight, index) => {
    const highlightEl = document.createElement("div");
    highlightEl.className = "highlight-card";
    highlightEl.innerHTML = `
      <div class="highlight-icon">${highlight.icon}</div>
      <div class="highlight-title">${highlight.title}</div>
      <div class="highlight-description">${highlight.description}</div>
    `;
    highlightsGrid.appendChild(highlightEl);

    setTimeout(() => {
      highlightEl.classList.add("animate-in");
    }, index * 300 + 500);
  });

  section?.classList.add("active");
}

function showFinalRating(player) {
  const ratingDisplay = document.getElementById("final-rating-display");
  const section = document.querySelector(".final-rating-section");

  ratingDisplay.innerHTML = `
    <div class="final-rating-value">${player.rating}</div>
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

    timelineEl.innerHTML = `
      <div class="timeline-badge">
        <img src="${season.badge}" alt="${season.club}" />
      </div>
      <div class="timeline-content">
        <div class="timeline-season">Season ${season.seasonNumber} (Age ${season.age})</div>
        <div class="timeline-club">${season.clubDisplay}</div>
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
