import { clamp, pickRandom, randFloat } from "../utils/helpers.js";

export function simulateEuropeanCampaign({ standing, league, performanceScore, player }) {
  if (!standing) return null;
  const qualifier = standing.qualification;
  let competition = null;
  if (qualifier === "League Champions" || qualifier === "Champions League") {
    competition = "Champions League";
  } else if (qualifier === "Europa League") {
    competition = "Europa League";
  } else if (qualifier === "Conference League") {
    competition = "Conference League";
  } else {
    return null;
  }

  // Get league tier and club financial tier
  const leagueTier = league.tier || 3;
  const teamStrength = standing.strength || 50;
  
  // Get financial tier from player's club (most reliable source)
  const clubFinancialTier = player.club?.financialTier || 
                           league.clubs?.find(club => club.name === player.club.name)?.financialTier || 
                           2;
  
  // Player contribution should be limited for Champions League
  // A 71-rated player shouldn't carry a small team to CL victory
  const playerContribution = competition === "Champions League" 
    ? Math.min(player.rating * 0.15, 15) + Math.min(performanceScore * 0.1, 10)
    : player.rating * 0.25 + performanceScore * 0.15;
  
  // Base strength calculation
  let baseStrength = teamStrength + playerContribution;
  
  // Apply MUCH stricter league tier and financial tier penalties for Champions League
  if (competition === "Champions League") {
    // Champions League is extremely difficult for lower-tier leagues
    if (leagueTier === 1) {
      // Only top 5 leagues (England, Spain, Germany, Italy, France)
      if (clubFinancialTier >= 4) {
        baseStrength += 20; // Elite clubs from top leagues
      } else if (clubFinancialTier >= 3) {
        baseStrength += 12; // Good clubs from top leagues
      } else {
        baseStrength += 5; // Smaller clubs from top leagues
      }
    } else if (leagueTier === 2) {
      // Tier 2 leagues (Portugal, Netherlands, Czech, etc.)
      if (clubFinancialTier >= 4) {
        baseStrength += 5; // Even big clubs from tier 2 struggle
      } else if (clubFinancialTier >= 3) {
        baseStrength -= 5; // Medium clubs have significant penalty
      } else {
        baseStrength -= 20; // Small clubs from tier 2 have huge penalty
      }
    } else if (leagueTier === 3) {
      // Tier 3 leagues
      baseStrength -= 30;
    } else {
      // Tier 4+ leagues
      baseStrength -= 45; // Nearly impossible
    }
  } else if (competition === "Europa League") {
    // Europa League is more accessible but still challenging
    if (leagueTier === 1) {
      baseStrength += clubFinancialTier >= 3 ? 10 : 5;
    } else if (leagueTier === 2) {
      baseStrength += clubFinancialTier >= 3 ? 2 : -5;
    } else if (leagueTier === 3) {
      baseStrength -= 15;
    } else {
      baseStrength -= 25;
    }
  } else if (competition === "Conference League") {
    // Conference League is the most accessible
    baseStrength += Math.max(-5, 8 - leagueTier * 2);
  }

  // Add limited randomness
  const finalStrength = clamp(baseStrength + randFloat(-5, 5), 20, 100);
  
  // Realistic progression thresholds with hard caps
  let thresholds, maxStage;
  if (competition === "Champions League") {
    // Adjusted thresholds - make progression possible for top teams
    if (leagueTier === 1 && clubFinancialTier >= 4) {
      thresholds = [0.15, 0.35, 0.55, 0.75, 0.88]; // Easier for elite clubs
      maxStage = 5; // Can reach final and win
    } else if (leagueTier === 1 && clubFinancialTier >= 3) {
      thresholds = [0.18, 0.4, 0.6, 0.78, 0.9]; // Moderate for good clubs
      maxStage = 4; // Can reach semi-finals
    } else if (leagueTier === 1) {
      thresholds = [0.2, 0.45, 0.65, 0.8, 0.92]; // Harder for small clubs
      maxStage = 3; // Max quarter-finals
    } else if (leagueTier === 2 && clubFinancialTier >= 4) {
      thresholds = [0.25, 0.5, 0.7, 0.85, 0.95]; // Very hard
      maxStage = 2; // Max round of 16
    } else if (leagueTier === 2 && clubFinancialTier >= 3) {
      thresholds = [0.3, 0.55, 0.75, 0.88, 0.97]; // Extremely hard
      maxStage = 1; // Max round of 16
    } else if (leagueTier === 2) {
      thresholds = [0.35, 0.6, 0.8, 0.9, 0.98]; // Nearly impossible
      maxStage = 0; // Max group stage
    } else {
      thresholds = [0.4, 0.65, 0.85, 0.95, 0.99]; // Almost impossible
      maxStage = 0; // Max group stage
    }
  } else if (competition === "Europa League") {
    thresholds = [0.15, 0.4, 0.65, 0.8, 0.9];
    if (leagueTier <= 2) {
      maxStage = 5; // Can reach final
    } else if (leagueTier === 3) {
      maxStage = 2; // Max quarter-finals
    } else {
      maxStage = 1; // Max round of 16
    }
  } else {
    thresholds = [0.1, 0.3, 0.55, 0.75, 0.85];
    maxStage = 5; // Conference League is more accessible
  }

  const stages = [
    "Group Stage",
    "Round of 16",
    "Quarter-finals", 
    "Semi-finals",
    "Runner-up",
    "Winners",
  ];

  const normalized = finalStrength / 100;
  let index = 0;
  while (index < thresholds.length && normalized > thresholds[index]) {
    index += 1;
  }
  
  // Apply hard cap based on league tier and club size
  const maxIndex = Math.min(maxStage, index);
  const result = stages[Math.min(maxIndex, stages.length - 1)];
  const resultIndex = stages.indexOf(result);
  
  // Generate round-by-round progression with opponents and scores
  const rounds = [];
  const playerTeam = player.club.displayName || player.club.name;
  
  // Generate realistic opponents for each stage with badges
  const eliteTeams = [
    { name: "Real Madrid", badge: "badges/Spain - LaLiga/Real Madrid.png" },
    { name: "FC Barcelona", badge: "badges/Spain - LaLiga/FC Barcelona.png" },
    { name: "Manchester City", badge: "badges/England - Premier League/Manchester City.png" },
    { name: "Liverpool FC", badge: "badges/England - Premier League/Liverpool FC.png" },
    { name: "Bayern Munich", badge: "badges/Germany - Bundesliga/Bayern Munich.png" },
    { name: "Paris Saint-Germain", badge: "badges/France - Ligue 1/Paris Saint-Germain.png" },
    { name: "Chelsea FC", badge: "badges/England - Premier League/Chelsea FC.png" },
    { name: "Arsenal FC", badge: "badges/England - Premier League/Arsenal FC.png" },
    { name: "AC Milan", badge: "badges/Italy - Serie A/AC Milan.png" },
    { name: "Inter Milan", badge: "badges/Italy - Serie A/Inter Milan.png" },
    { name: "Juventus", badge: "badges/Italy - Serie A/Juventus FC.png" },
    { name: "Atletico Madrid", badge: "badges/Spain - LaLiga/Atlético de Madrid.png" },
    { name: "Borussia Dortmund", badge: "badges/Germany - Bundesliga/Borussia Dortmund.png" },
    { name: "Tottenham Hotspur", badge: "badges/England - Premier League/Tottenham Hotspur.png" },
    { name: "Manchester United", badge: "badges/England - Premier League/Manchester United.png" },
    { name: "Napoli", badge: "badges/Italy - Serie A/SSC Napoli.png" }
  ];
  
  const goodTeams = [
    { name: "Ajax Amsterdam", badge: "badges/Netherlands - Eredivisie/Ajax Amsterdam.png" },
    { name: "Benfica", badge: "badges/Portugal - Liga Portugal/SL Benfica.png" },
    { name: "Porto", badge: "badges/Portugal - Liga Portugal/FC Porto.png" },
    { name: "Celtic", badge: "badges/Scotland - Scottish Premiership/Celtic FC.png" },
    { name: "RB Leipzig", badge: "badges/Germany - Bundesliga/RB Leipzig.png" },
    { name: "Sevilla FC", badge: "badges/Spain - LaLiga/Sevilla FC.png" },
    { name: "Roma", badge: "badges/Italy - Serie A/AS Roma.png" },
    { name: "Lazio", badge: "badges/Italy - Serie A/SS Lazio.png" },
    { name: "Valencia CF", badge: "badges/Spain - LaLiga/Valencia CF.png" },
    { name: "Villarreal CF", badge: "badges/Spain - LaLiga/Villarreal CF.png" },
    { name: "Real Sociedad", badge: "badges/Spain - LaLiga/Real Sociedad.png" },
    { name: "Bayer Leverkusen", badge: "badges/Germany - Bundesliga/Bayer 04 Leverkusen.png" },
    { name: "Olympique Lyon", badge: "badges/France - Ligue 1/Olympique Lyon.png" }
  ];
  
  // Track teams still in competition (can't face same team twice)
  let availableOpponents = [];
  let eliminatedOpponents = new Set();
  
  // Generate progression through each round
  for (let i = 0; i <= resultIndex; i++) {
    const roundName = stages[i];
    let opponent = null;
    let opponentData = null;
    let score = null;
    let qualified = true;
    
    if (i === 0) {
      // Group Stage - show best result
      qualified = true;
      opponent = "Group Stage";
      const wins = Math.floor(randFloat(3, 6));
      const draws = Math.floor(randFloat(1, 3));
      const losses = 6 - wins - draws;
      score = `${wins}W ${draws}D ${losses}L`;
      
      rounds.push({
        round: roundName,
        opponent,
        score,
        qualified
      });
    } else {
      // Knockout rounds - pick from available opponents
      if (availableOpponents.length === 0) {
        // Initialize available opponents based on round
        if (i <= 2) {
          // Round of 16, Quarter-finals - mix of elite and good teams
          availableOpponents = [...eliteTeams, ...goodTeams];
        } else if (i === 3) {
          // Semi-finals - mostly elite teams
          availableOpponents = [...eliteTeams];
        } else {
          // Final - elite team
          availableOpponents = [...eliteTeams];
        }
        // Remove already faced opponents
        availableOpponents = availableOpponents.filter(team => !eliminatedOpponents.has(team.name));
      }
      
      if (availableOpponents.length > 0) {
        opponentData = pickRandom(availableOpponents);
        opponent = opponentData.name;
        
        // Calculate match result
        const playerStrength = baseStrength / 100;
        const opponentStrength = i <= 2 ? 0.7 : i === 3 ? 0.85 : 0.9; // Stronger in later rounds
        const playerWinChance = playerStrength / (playerStrength + opponentStrength);
        
        if (Math.random() < playerWinChance) {
          qualified = true;
          // Generate aggregate score - player wins
          const homeScore = Math.floor(randFloat(1, 3));
          const awayScore = Math.floor(randFloat(0, 2));
          const homeScore2 = Math.floor(randFloat(1, 3));
          const awayScore2 = Math.floor(randFloat(0, 2));
          const totalScore = homeScore + awayScore2;
          const totalOpponent = awayScore + homeScore2;
          score = `${totalScore}-${totalOpponent} (agg.)`;
          
          // Remove opponent from available pool
          eliminatedOpponents.add(opponentData.name);
          availableOpponents = availableOpponents.filter(t => t.name !== opponentData.name);
        } else {
          qualified = false;
          // Generate aggregate score - player loses
          const homeScore = Math.floor(randFloat(0, 2));
          const awayScore = Math.floor(randFloat(1, 3));
          const homeScore2 = Math.floor(randFloat(0, 2));
          const awayScore2 = Math.floor(randFloat(1, 3));
          const totalScore = homeScore + awayScore2;
          const totalOpponent = awayScore + homeScore2;
          score = `${totalScore}-${totalOpponent} (agg.)`;
          
          // Player eliminated - opponent continues
        }
        
        rounds.push({
          round: roundName,
          opponent: opponentData.name,
          opponentBadge: opponentData.badge,
          score,
          qualified
        });
      }
    }
  }
  
  // If eliminated, generate finalists and winner
  let finalists = null;
  let winner = null;
  let winnerData = null;
  
  if (resultIndex < stages.length - 1) {
    // Player was eliminated - simulate rest of tournament
    // Pick two teams that haven't been eliminated by player
    const availableForFinal = eliteTeams.filter(t => !eliminatedOpponents.has(t.name));
    
    if (availableForFinal.length >= 2) {
      const finalist1 = pickRandom(availableForFinal);
      let remaining = availableForFinal.filter(t => t.name !== finalist1.name);
      const finalist2 = pickRandom(remaining);
      
      finalists = [
        {
          name: finalist1.name,
          displayName: finalist1.name,
          badge: finalist1.badge
        },
        {
          name: finalist2.name,
          displayName: finalist2.name,
          badge: finalist2.badge
        }
      ];
      
      // Simulate final
      if (Math.random() < 0.5) {
        winnerData = finalist1;
      } else {
        winnerData = finalist2;
      }
      winner = winnerData.name;
    } else {
      // Fallback
      const finalist1 = pickRandom(eliteTeams);
      let finalist2 = pickRandom(eliteTeams);
      while (finalist2.name === finalist1.name) {
        finalist2 = pickRandom(eliteTeams);
      }
      finalists = [
        { name: finalist1.name, displayName: finalist1.name, badge: finalist1.badge },
        { name: finalist2.name, displayName: finalist2.name, badge: finalist2.badge }
      ];
      winnerData = Math.random() < 0.5 ? finalist1 : finalist2;
      winner = winnerData.name;
    }
  } else if (result === "Winners") {
    // Player won - they're the winner
    winner = playerTeam;
    winnerData = {
      name: player.club.name,
      displayName: playerTeam,
      badge: player.club.badge
    };
    
    // Get final opponent from last round
    const finalRound = rounds.find(r => r.round === "Runner-up" || r.round === "Winners");
    if (finalRound && finalRound.opponentBadge) {
      // Final opponent already recorded
    }
  } else if (result === "Runner-up") {
    // Player was runner-up
    const finalRound = rounds.find(r => r.round === "Runner-up");
    if (finalRound) {
      const opponentFinal = eliteTeams.find(t => t.name === finalRound.opponent) || pickRandom(eliteTeams);
      finalists = [
        {
          name: player.club.name,
          displayName: playerTeam,
          badge: player.club.badge
        },
        {
          name: opponentFinal.name,
          displayName: opponentFinal.name,
          badge: opponentFinal.badge
        }
      ];
      winnerData = opponentFinal;
      winner = opponentFinal.name;
    }
  }
  
  return { 
    competition, 
    result, 
    won: result === "Winners",
    rounds,
    finalists,
    winner,
    winnerData
  };
}
