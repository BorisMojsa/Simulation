import { LEAGUES } from "../data/leagues.js";
import { clamp, pickRandom, randFloat } from "../utils/helpers.js";
import { isEuropeanQualificationLeague } from "./leaguePhase.js";

function normalizeClubKey(value) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

const EUROPEAN_OPPONENT_GROUPS = {
  elite: [
    ["Real Madrid"],
    ["FC Barcelona"],
    ["Manchester City"],
    ["Liverpool FC"],
    ["Bayern Munich"],
    ["Paris Saint-Germain"],
    ["Chelsea FC"],
    ["Arsenal FC"],
    ["AC Milan"],
    ["Inter Milan"],
    ["Juventus FC", "Juventus"],
    ["Atlético de Madrid", "Atletico Madrid"],
    ["Borussia Dortmund"],
    ["Tottenham Hotspur"],
    ["Manchester United"],
    ["SSC Napoli", "Napoli"],
  ],
  good: [
    ["Ajax Amsterdam"],
    ["SL Benfica", "Benfica"],
    ["FC Porto", "Porto"],
    ["Celtic FC", "Celtic"],
    ["RB Leipzig"],
    ["Sevilla FC"],
    ["AS Roma", "Roma"],
    ["SS Lazio", "Lazio"],
    ["Valencia CF"],
    ["Villarreal CF"],
    ["Real Sociedad"],
    ["Bayer 04 Leverkusen", "Bayer Leverkusen"],
    ["Olympique Lyon"],
  ],
};

const EUROPEAN_CLUB_LOOKUP = (() => {
  const lookup = new Map();

  LEAGUES.forEach((league) => {
    league.clubs.forEach((club) => {
      const profile = {
        name: club.displayName ?? club.name,
        displayName: club.displayName ?? club.name,
        badge: club.badge,
        clubName: club.name,
      };

      [club.name, club.displayName ?? club.name].forEach((key) => {
        lookup.set(normalizeClubKey(key), profile);
      });
    });
  });

  return lookup;
})();

function findEuropeanClub(queryGroup) {
  for (const query of queryGroup) {
    const club = EUROPEAN_CLUB_LOOKUP.get(normalizeClubKey(query));
    if (club) {
      return club;
    }
  }

  const fallbackName = queryGroup[0];
  return {
    name: fallbackName,
    displayName: fallbackName,
    badge: "",
    clubName: fallbackName,
  };
}

function buildOpponentPool(groupName, playerClubName) {
  const seen = new Set();
  const playerKey = normalizeClubKey(playerClubName);

  return EUROPEAN_OPPONENT_GROUPS[groupName]
    .map((queryGroup) => findEuropeanClub(queryGroup))
    .filter((club) => {
      const key = normalizeClubKey(club.clubName || club.name);
      if (!key || key === playerKey || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

export function simulateEuropeanCampaign({ standing, league, performanceScore, player }) {
  if (!standing) return null;
  const qualifier = standing.qualification;
  let competition = null;
  if (!isEuropeanQualificationLeague(league)) {
    return null;
  }
  if (qualifier === "League Champions" || qualifier === "Champions League") {
    competition = "Champions League";
  } else if (qualifier === "Europa League") {
    competition = "Europa League";
  } else if (qualifier === "Conference League") {
    competition = "Conference League";
  } else {
    return null;
  }

  const leagueTier = clamp(league.tier || 3, 1, 5);
  const teamStrength = standing.strength || 50;
  
  // Get financial tier from player's club (most reliable source)
  const clubFinancialTier = player.club?.financialTier || 
                           league.clubs?.find(club => club.name === player.club.name)?.financialTier || 
                           2;
  
  const leagueBonus =
    competition === "Champions League"
      ? [-12, -5, 3, 10, 18][leagueTier - 1]
      : competition === "Europa League"
      ? [-6, 0, 5, 10, 14][leagueTier - 1]
      : [-2, 2, 6, 10, 12][leagueTier - 1];
  const financialBonus = [-8, -2, 4, 10, 16][clamp(clubFinancialTier, 1, 5) - 1];
  const playerBonus = clamp((player.rating - 70) * 0.4 + (performanceScore - 70) * 0.18, -10, 14);
  const baseStrength = teamStrength * 0.55 + leagueBonus + financialBonus + playerBonus;
  const finalStrength = clamp(baseStrength + randFloat(-8, 8), 20, 100);

  let thresholds;
  let maxStage;
  if (competition === "Champions League") {
    thresholds = [56, 68, 78, 86, 92];
    if (leagueTier >= 5 && clubFinancialTier >= 4) {
      maxStage = 5;
    } else if (leagueTier >= 5) {
      maxStage = 4;
    } else if (leagueTier === 4 && clubFinancialTier >= 4) {
      maxStage = 4;
    } else if (leagueTier === 4) {
      maxStage = 3;
    } else if (leagueTier === 3 && clubFinancialTier >= 4) {
      maxStage = 2;
    } else if (leagueTier === 3) {
      maxStage = 1;
    } else {
      maxStage = 0;
    }
  } else if (competition === "Europa League") {
    thresholds = [45, 58, 70, 80, 88];
    if (leagueTier >= 4) {
      maxStage = 5;
    } else if (leagueTier === 3) {
      maxStage = 4;
    } else if (leagueTier === 2) {
      maxStage = 3;
    } else {
      maxStage = 2;
    }
  } else {
    thresholds = [38, 50, 62, 74, 84];
    if (leagueTier >= 3) {
      maxStage = 5;
    } else if (leagueTier === 2) {
      maxStage = 4;
    } else {
      maxStage = 3;
    }
  }

  const stages = [
    "Group Stage",
    "Round of 16",
    "Quarter-finals", 
    "Semi-finals",
    "Runner-up",
    "Winners",
  ];

  let index = 0;
  while (index < thresholds.length && finalStrength > thresholds[index]) {
    index += 1;
  }
  
  // Apply hard cap based on league tier and club size
  const maxIndex = Math.min(maxStage, index);
  const result = stages[Math.min(maxIndex, stages.length - 1)];
  const resultIndex = stages.indexOf(result);
  
  // Generate round-by-round progression with opponents and scores
  const rounds = [];
  const playerTeam = player.club.displayName || player.club.name;
  const eliteTeams = buildOpponentPool("elite", player.club.name);
  const goodTeams = buildOpponentPool("good", player.club.name);
  
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
  
  if (result === "Winners") {
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
  } else {
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
