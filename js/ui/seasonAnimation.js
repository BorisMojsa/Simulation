export function showSeasonAnimation(seasonData, player, statsKeys, onContinue) {
  const overlay = document.getElementById('season-animation-overlay');
  
  // Clear all previous animation content
  clearAnimationContent();
  
  overlay.classList.remove('hidden');
  
  // Start the animation sequence
  animateSeasonSequence(seasonData, player, statsKeys, onContinue);
}

function clearAnimationContent() {
  // Hide all animation sections
  const sections = [
    'league-animation',
    'cup-animation', 
    'european-animation',
    'awards-animation',
    'summary-animation',
    'overall-reveal',
    'animation-continue'
  ];
  
  sections.forEach(sectionId => {
    const section = document.getElementById(sectionId);
    if (section) {
      section.classList.add('hidden');
      section.classList.remove('active');
    }
  });
  
  // Clear content from dynamic sections
  const contentSections = [
    'league-table-rows',
    'cup-rounds',
    'european-rounds', 
    'awards-items',
    'player-stats-grid',
    'rating-changes-grid'
  ];
  
  contentSections.forEach(sectionId => {
    const section = document.getElementById(sectionId);
    if (section) {
      section.innerHTML = '';
    }
  });
  
  // Reset rating values
  const oldRating = document.getElementById('old-rating-value');
  const newRating = document.getElementById('new-rating-value');
  const ratingArrow = document.querySelector('.rating-arrow');
  const ratingChangeText = document.getElementById('rating-change-text');
  
  if (oldRating) {
    oldRating.textContent = '';
    oldRating.classList.remove('animate-in', 'positive', 'negative');
  }
  if (newRating) {
    newRating.textContent = '';
    newRating.classList.remove('animate-in', 'positive', 'negative');
  }
  if (ratingArrow) {
    ratingArrow.classList.remove('animate-in');
  }
  if (ratingChangeText) {
    ratingChangeText.textContent = '';
    ratingChangeText.classList.remove('animate-in', 'positive', 'negative');
  }
}

function animateSeasonSequence(seasonData, player, statsKeys, onContinue) {
  // Check if seasonData exists
  if (!seasonData) {
    console.error('No season data provided to animation');
    return;
  }
  
  const { season, league, standings, europeanCampaign, domesticCupResult, individualAwards, attributeChanges, previousRating, newRating } = seasonData;
  
  // Check if required data exists
  if (!season || !league || !standings) {
    console.error('Missing required season data:', { season, league, standings });
    return;
  }
  
  // Step 1: League Table Animation
  setTimeout(() => {
    showLeagueAnimation(season, league, standings, player);
  }, 500);
  
  // Step 2: Cup Results Animation
  setTimeout(() => {
    showCupAnimation(season, domesticCupResult);
  }, 8000);
  
  // Step 3: European Competition Animation
  setTimeout(() => {
    showEuropeanAnimation(season, europeanCampaign);
  }, 14000);
  
  // Step 4: Personal Awards Animation
  setTimeout(() => {
    showAwardsAnimation(season, individualAwards);
  }, 20000);
  
  // Step 5: Season Summary Animation
  setTimeout(() => {
    showSummaryAnimation(season, attributeChanges, statsKeys);
  }, 26000);
  
  // Step 6: Overall Rating Reveal
  setTimeout(() => {
    showOverallRatingReveal(season, previousRating, newRating);
  }, 32000);
  
  // Step 7: Show Continue Button
  setTimeout(() => {
    showContinueButton(onContinue);
  }, 38000);
}

function showLeagueAnimation(season, league, standings, player) {
  const leagueSection = document.getElementById('league-animation');
  const seasonInfo = document.getElementById('league-season-info');
  const tableRows = document.getElementById('league-table-rows');
  
  // Check if standings has table property
  if (!standings || !standings.table) {
    console.error('Invalid standings data:', standings);
    return;
  }
  
  seasonInfo.textContent = `${league.displayName ?? league.name} - Season ${season.seasonNumber}`;
  
  // Clear existing rows
  tableRows.innerHTML = '';
  
  // Create table rows (reverse order - from last to first)
  standings.table.slice().reverse().forEach((team, index) => {
    const row = document.createElement('div');
    row.className = 'table-row';
    
    if (team.name === player.club.name) {
      row.classList.add('player-team');
    } else if (team.position === 1) {
      row.classList.add('champions');
    } else if (team.qualification && ['Champions League', 'Europa League', 'Conference League'].includes(team.qualification)) {
      row.classList.add('european');
    }
    
    row.innerHTML = `
      <div class="position">${team.position}</div>
      <div class="team-info">
        <img src="${team.badge}" alt="${team.name}" class="team-badge" />
        <div>
          <div class="team-name">${team.name}</div>
          ${team.qualification ? `<div class="qualifier">${team.qualification}</div>` : ''}
        </div>
      </div>
      <div class="stats-cell">${team.points}</div>
      <div class="stats-cell">${team.wins}</div>
      <div class="stats-cell">${team.draws}</div>
      <div class="stats-cell">${team.losses}</div>
      <div class="stats-cell">${formatSigned(team.goalDiff)}</div>
    `;
    
    tableRows.appendChild(row);
    
    // Animate each row with a delay
    setTimeout(() => {
      row.classList.add('animate-in');
    }, index * 200 + 1000);
  });
  
  leagueSection.classList.remove('hidden');
  leagueSection.classList.add('active');
}

function showCupAnimation(season, domesticCupResult) {
  const cupSection = document.getElementById('cup-animation');
  const cupInfo = document.getElementById('cup-info');
  const cupRounds = document.getElementById('cup-rounds');
  
  cupInfo.textContent = `${season.clubDisplay} - ${season.age} years old`;
  
  // Clear existing rounds
  cupRounds.innerHTML = '';
  
  if (!domesticCupResult || !domesticCupResult.rounds) {
    cupRounds.innerHTML = '<div class="empty-state">No cup competition this season</div>';
    cupSection.classList.remove('hidden');
    cupSection.classList.add('active');
    return;
  }
  
  const rounds = ['Round of 64', 'Round of 32', 'Round of 16', 'Quarter-finals', 'Semi-finals', 'Finalists', 'Winners'];
  const playerRounds = domesticCupResult.rounds || [];
  const result = domesticCupResult.result || 'Round of 64';
  const resultIndex = rounds.indexOf(result);
  
  // Display player's progression
  rounds.forEach((round, index) => {
    const roundEl = document.createElement('div');
    roundEl.className = 'cup-round';
    
    const playerRound = playerRounds.find(r => r.round === round);
    const reached = index <= resultIndex;
    
    if (reached) {
      roundEl.classList.add('qualified');
    }
    
    let resultHTML = '';
    if (index < resultIndex) {
      // Passed this round
      if (playerRound) {
        const badgeHTML = playerRound.opponentBadge ? 
          `<img src="${playerRound.opponentBadge}" alt="${playerRound.opponent}" class="opponent-badge" style="width: 24px; height: 24px; border-radius: 50%; margin-right: 0.5rem; vertical-align: middle;" />` : '';
        resultHTML = `<span>✅ vs ${badgeHTML}<strong>${playerRound.opponent}</strong> - ${playerRound.score}</span>`;
      } else {
        resultHTML = '<span>✅ Qualified</span>';
      }
    } else if (index === resultIndex) {
      // Current round
      if (domesticCupResult.won) {
        if (playerRound) {
          const badgeHTML = playerRound.opponentBadge ? 
            `<img src="${playerRound.opponentBadge}" alt="${playerRound.opponent}" class="opponent-badge" style="width: 24px; height: 24px; border-radius: 50%; margin-right: 0.5rem; vertical-align: middle;" />` : '';
          resultHTML = `<span>🏆 Winners! vs ${badgeHTML}<strong>${playerRound.opponent}</strong> - ${playerRound.score}</span>`;
        } else {
          resultHTML = '<span>🏆 Winners!</span>';
        }
      } else {
        if (playerRound) {
          const badgeHTML = playerRound.opponentBadge ? 
            `<img src="${playerRound.opponentBadge}" alt="${playerRound.opponent}" class="opponent-badge" style="width: 24px; height: 24px; border-radius: 50%; margin-right: 0.5rem; vertical-align: middle;" />` : '';
          resultHTML = `<span>❌ Eliminated vs ${badgeHTML}<strong>${playerRound.opponent}</strong> - ${playerRound.score}</span>`;
        } else {
          resultHTML = '<span>❌ Eliminated</span>';
        }
      }
    } else {
      resultHTML = '<span>⏳ Not reached</span>';
    }
    
    roundEl.innerHTML = `
      <div class="round-name">${round}</div>
      <div class="round-result">${resultHTML}</div>
    `;
    
    cupRounds.appendChild(roundEl);
    
    // Animate each round with a delay
    setTimeout(() => {
      roundEl.classList.add('animate-in');
    }, index * 300 + 500);
  });
  
  // Show finalists and winner if eliminated
  if (domesticCupResult.finalists && domesticCupResult.winner && !domesticCupResult.won) {
    const finalInfo = document.createElement('div');
    finalInfo.className = 'final-info';
    finalInfo.style.cssText = 'margin-top: 2rem; padding: 1.5rem; background: var(--bg-secondary); border-radius: 15px; border: 1px solid var(--border);';
    
    const finalist1 = domesticCupResult.finalists[0];
    const finalist2 = domesticCupResult.finalists[1];
    const winnerBadge = finalist1.displayName === domesticCupResult.winner ? finalist1.badge : finalist2.badge;
    
    const finalist1Badge = finalist1.badge ? 
      `<img src="${finalist1.badge}" alt="${finalist1.displayName}" style="width: 32px; height: 32px; border-radius: 50%; margin-right: 0.5rem; vertical-align: middle;" />` : '';
    const finalist2Badge = finalist2.badge ? 
      `<img src="${finalist2.badge}" alt="${finalist2.displayName}" style="width: 32px; height: 32px; border-radius: 50%; margin-right: 0.5rem; vertical-align: middle;" />` : '';
    const winnerBadgeHTML = winnerBadge ? 
      `<img src="${winnerBadge}" alt="${domesticCupResult.winner}" style="width: 32px; height: 32px; border-radius: 50%; margin-right: 0.5rem; vertical-align: middle;" />` : '';
    
    finalInfo.innerHTML = `
      <div style="color: var(--accent); font-weight: 600; margin-bottom: 1rem; font-size: 1.1rem;">Final</div>
      <div style="color: var(--text); margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">
        ${finalist1Badge}<span>${finalist1.displayName}</span> vs ${finalist2Badge}<span>${finalist2.displayName}</span>
      </div>
      <div style="color: var(--accent); font-weight: 600; display: flex; align-items: center; gap: 0.5rem;">
        🏆 ${winnerBadgeHTML}<span>Winner: ${domesticCupResult.winner}</span>
      </div>
    `;
    cupRounds.appendChild(finalInfo);
    
    setTimeout(() => {
      finalInfo.classList.add('animate-in');
    }, (rounds.length + 1) * 300 + 500);
  }
  
  cupSection.classList.remove('hidden');
  cupSection.classList.add('active');
}

function showEuropeanAnimation(season, europeanCampaign) {
  const europeanSection = document.getElementById('european-animation');
  const europeanInfo = document.getElementById('european-info');
  const europeanRounds = document.getElementById('european-rounds');
  
  if (!europeanCampaign) {
    europeanInfo.textContent = 'No European Competition';
    europeanRounds.innerHTML = '<div class="empty-state">No European qualification this season</div>';
    europeanSection.classList.remove('hidden');
    europeanSection.classList.add('active');
    return;
  }
  
  europeanInfo.textContent = `${europeanCampaign.competition} - ${season.clubDisplay}`;
  
  // Clear existing rounds
  europeanRounds.innerHTML = '';
  
  const stages = ['Group Stage', 'Round of 16', 'Quarter-finals', 'Semi-finals', 'Runner-up', 'Winners'];
  const resultIndex = stages.indexOf(europeanCampaign.result);
  const playerRounds = europeanCampaign.rounds || [];
  
  stages.forEach((stage, index) => {
    const roundEl = document.createElement('div');
    roundEl.className = 'european-round';
    
    const playerRound = playerRounds.find(r => r.round === stage);
    const reached = index <= resultIndex;
    
    if (reached) {
      roundEl.classList.add('qualified');
    }
    
    let resultHTML = '';
    if (index < resultIndex) {
      // Passed this round
      if (playerRound) {
        const badgeHTML = playerRound.opponentBadge ? 
          `<img src="${playerRound.opponentBadge}" alt="${playerRound.opponent}" class="opponent-badge" style="width: 24px; height: 24px; border-radius: 50%; margin-right: 0.5rem; vertical-align: middle;" />` : '';
        resultHTML = `<span>✅ vs ${badgeHTML}<strong>${playerRound.opponent}</strong> - ${playerRound.score}</span>`;
      } else {
        resultHTML = '<span>✅ Qualified</span>';
      }
    } else if (index === resultIndex) {
      // Current round
      if (europeanCampaign.won) {
        if (playerRound) {
          const badgeHTML = playerRound.opponentBadge ? 
            `<img src="${playerRound.opponentBadge}" alt="${playerRound.opponent}" class="opponent-badge" style="width: 24px; height: 24px; border-radius: 50%; margin-right: 0.5rem; vertical-align: middle;" />` : '';
          resultHTML = `<span>🏆 Winners! vs ${badgeHTML}<strong>${playerRound.opponent}</strong> - ${playerRound.score}</span>`;
        } else {
          resultHTML = '<span>🏆 Winners!</span>';
        }
      } else {
        if (playerRound) {
          const badgeHTML = playerRound.opponentBadge ? 
            `<img src="${playerRound.opponentBadge}" alt="${playerRound.opponent}" class="opponent-badge" style="width: 24px; height: 24px; border-radius: 50%; margin-right: 0.5rem; vertical-align: middle;" />` : '';
          resultHTML = `<span>❌ Eliminated vs ${badgeHTML}<strong>${playerRound.opponent}</strong> - ${playerRound.score}</span>`;
        } else {
          resultHTML = '<span>❌ Eliminated</span>';
        }
      }
    } else {
      resultHTML = '<span>⏳ Not reached</span>';
    }
    
    roundEl.innerHTML = `
      <div class="round-name">${stage}</div>
      <div class="round-result">${resultHTML}</div>
    `;
    
    europeanRounds.appendChild(roundEl);
    
    // Animate each round with a delay
    setTimeout(() => {
      roundEl.classList.add('animate-in');
    }, index * 300 + 500);
  });
  
  // Show finalists and winner if eliminated
  if (europeanCampaign.finalists && europeanCampaign.winner && !europeanCampaign.won) {
    const finalInfo = document.createElement('div');
    finalInfo.className = 'final-info';
    finalInfo.style.cssText = 'margin-top: 2rem; padding: 1.5rem; background: var(--bg-secondary); border-radius: 15px; border: 1px solid var(--border);';
    
    const finalist1 = europeanCampaign.finalists[0];
    const finalist2 = europeanCampaign.finalists[1];
    const winnerBadge = finalist1.displayName === europeanCampaign.winner ? finalist1.badge : finalist2.badge;
    
    const finalist1Badge = finalist1.badge ? 
      `<img src="${finalist1.badge}" alt="${finalist1.displayName}" style="width: 32px; height: 32px; border-radius: 50%; margin-right: 0.5rem; vertical-align: middle;" />` : '';
    const finalist2Badge = finalist2.badge ? 
      `<img src="${finalist2.badge}" alt="${finalist2.displayName}" style="width: 32px; height: 32px; border-radius: 50%; margin-right: 0.5rem; vertical-align: middle;" />` : '';
    const winnerBadgeHTML = winnerBadge ? 
      `<img src="${winnerBadge}" alt="${europeanCampaign.winner}" style="width: 32px; height: 32px; border-radius: 50%; margin-right: 0.5rem; vertical-align: middle;" />` : '';
    
    finalInfo.innerHTML = `
      <div style="color: var(--accent); font-weight: 600; margin-bottom: 1rem; font-size: 1.1rem;">Final</div>
      <div style="color: var(--text); margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">
        ${finalist1Badge}<span>${finalist1.displayName}</span> vs ${finalist2Badge}<span>${finalist2.displayName}</span>
      </div>
      <div style="color: var(--accent); font-weight: 600; display: flex; align-items: center; gap: 0.5rem;">
        🏆 ${winnerBadgeHTML}<span>Winner: ${europeanCampaign.winner}</span>
      </div>
    `;
    europeanRounds.appendChild(finalInfo);
    
    setTimeout(() => {
      finalInfo.classList.add('animate-in');
    }, (stages.length + 1) * 300 + 500);
  } else if (europeanCampaign.won) {
    // Player won - show final opponent
    const finalRound = playerRounds.find(r => r.round === 'Runner-up' || r.round === 'Winners');
    if (finalRound) {
      const finalInfo = document.createElement('div');
      finalInfo.className = 'final-info';
      finalInfo.style.cssText = 'margin-top: 2rem; padding: 1.5rem; background: var(--bg-secondary); border-radius: 15px; border: 1px solid var(--border);';
      
      const opponentBadge = finalRound.opponentBadge ? 
        `<img src="${finalRound.opponentBadge}" alt="${finalRound.opponent}" style="width: 32px; height: 32px; border-radius: 50%; margin-right: 0.5rem; vertical-align: middle;" />` : '';
      
      finalInfo.innerHTML = `
        <div style="color: var(--accent); font-weight: 600; margin-bottom: 1rem; font-size: 1.1rem;">Final</div>
        <div style="color: var(--text); margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">
          vs ${opponentBadge}<span><strong>${finalRound.opponent}</strong></span> - ${finalRound.score}
        </div>
        <div style="color: var(--accent); font-weight: 600;">🏆 Champions!</div>
      `;
      europeanRounds.appendChild(finalInfo);
      
      setTimeout(() => {
        finalInfo.classList.add('animate-in');
      }, (stages.length + 1) * 300 + 500);
    }
  }
  
  europeanSection.classList.remove('hidden');
  europeanSection.classList.add('active');
}

function showAwardsAnimation(season, individualAwards) {
  const awardsSection = document.getElementById('awards-animation');
  const awardsInfo = document.getElementById('awards-info');
  const awardsItems = document.getElementById('awards-items');
  
  awardsInfo.textContent = `${season.clubDisplay} - ${season.age} years old`;
  
  // Clear existing awards
  awardsItems.innerHTML = '';
  
  if (individualAwards.length === 0) {
    awardsItems.innerHTML = '<div class="empty-state">No individual awards this season</div>';
  } else {
    individualAwards.forEach((award, index) => {
      const awardEl = document.createElement('div');
      awardEl.className = 'award-item';
      
      if (award === 'World Player of the Year') {
        awardEl.classList.add('special');
      }
      
      const icon = award === 'World Player of the Year' ? '🏆' :
                   award === 'Golden Boot' ? '⚽' :
                   award === 'Golden Glove' ? '🥅' :
                   award === 'Team of the Season' ? '⭐' : '🏅';
      
      awardEl.innerHTML = `
        <div class="award-icon">${icon}</div>
        <div class="award-details">
          <h3>${award}</h3>
          <p>Outstanding performance this season</p>
        </div>
      `;
      
      awardsItems.appendChild(awardEl);
      
      // Animate each award with a delay
      setTimeout(() => {
        awardEl.classList.add('animate-in');
      }, index * 400 + 500);
    });
  }
  
  awardsSection.classList.remove('hidden');
  awardsSection.classList.add('active');
}

function showContinueButton(onContinue) {
  const continueSection = document.getElementById('animation-continue');
  continueSection.classList.remove('hidden');
  continueSection.classList.add('active');
  
  // Use a single handler to avoid duplicate callbacks after multiple seasons.
  const continueBtn = document.getElementById('continue-btn');
  continueBtn.onclick = onContinue;
}

function showSummaryAnimation(season, attributeChanges, statsKeys) {
  const summarySection = document.getElementById('summary-animation');
  const summaryInfo = document.getElementById('summary-info');
  const statsGrid = document.getElementById('player-stats-grid');
  const ratingGrid = document.getElementById('rating-changes-grid');
  
  summaryInfo.textContent = `${season.clubDisplay} - ${season.age} years old`;
  
  // Clear existing content
  statsGrid.innerHTML = '';
  ratingGrid.innerHTML = '';
  
  // Create player stats
  const stats = [
    { label: 'Matches', value: season.matches },
    { label: 'Goals', value: season.goals },
    { label: 'Assists', value: season.assists },
    { label: 'Clean Sheets', value: season.cleanSheets },
    { label: 'Avg Rating', value: season.avgMatchRating }
  ];
  
  stats.forEach((stat, index) => {
    const statEl = document.createElement('div');
    statEl.className = 'stat-item';
    statEl.innerHTML = `
      <div class="stat-value">${stat.value}</div>
      <div class="stat-label">${stat.label}</div>
    `;
    statsGrid.appendChild(statEl);
    
    setTimeout(() => {
      statEl.classList.add('animate-in');
    }, index * 200 + 500);
  });
  
  // Create rating changes
  statsKeys.forEach((key, index) => {
    const change = attributeChanges[key];
    const ratingEl = document.createElement('div');
    ratingEl.className = 'rating-item';
    
    if (change.change > 0) {
      ratingEl.classList.add('positive');
    } else if (change.change < 0) {
      ratingEl.classList.add('negative');
    }
    
    const changeText = change.change > 0 ? `+${change.change}` : 
                      change.change < 0 ? `${change.change}` : '0';
    const changeClass = change.change > 0 ? 'positive' : 
                       change.change < 0 ? 'negative' : 'neutral';
    
    ratingEl.innerHTML = `
      <div class="rating-name">${key}</div>
      <div class="rating-change ${changeClass}">${changeText}</div>
      <div class="rating-new">${change.new}</div>
    `;
    ratingGrid.appendChild(ratingEl);
    
    setTimeout(() => {
      ratingEl.classList.add('animate-in');
    }, index * 150 + 2000);
  });
  
  summarySection.classList.remove('hidden');
  summarySection.classList.add('active');
}

function showOverallRatingReveal(season, previousRating, newRating) {
  const overallSection = document.getElementById('overall-reveal');
  const overallInfo = document.getElementById('overall-info');
  const oldRatingValue = document.getElementById('old-rating-value');
  const newRatingValue = document.getElementById('new-rating-value');
  const ratingArrow = document.querySelector('.rating-arrow');
  const ratingChangeText = document.getElementById('rating-change-text');
  
  overallInfo.textContent = `${season.clubDisplay} - ${season.age} years old`;
  
  const ratingChange = newRating - previousRating;
  const changeText = ratingChange > 0 ? `+${ratingChange}` : 
                     ratingChange < 0 ? `${ratingChange}` : 'No change';
  const changeClass = ratingChange > 0 ? 'positive' : 
                     ratingChange < 0 ? 'negative' : '';
  
  oldRatingValue.textContent = previousRating;
  newRatingValue.textContent = newRating;
  ratingChangeText.textContent = changeText;
  
  if (ratingChange > 0) {
    newRatingValue.classList.add('positive');
    ratingChangeText.classList.add('positive');
  } else if (ratingChange < 0) {
    newRatingValue.classList.add('negative');
    ratingChangeText.classList.add('negative');
  }
  
  overallSection.classList.remove('hidden');
  overallSection.classList.add('active');
  
  // Animate the rating reveal
  setTimeout(() => {
    oldRatingValue.classList.add('animate-in');
  }, 500);
  
  setTimeout(() => {
    ratingArrow.classList.add('animate-in');
  }, 1000);
  
  setTimeout(() => {
    newRatingValue.classList.add('animate-in');
  }, 1500);
  
  setTimeout(() => {
    ratingChangeText.classList.add('animate-in');
  }, 2000);
}
