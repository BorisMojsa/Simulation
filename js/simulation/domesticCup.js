import { pickRandom, randFloat, clamp } from "../utils/helpers.js";
import { leagueMatchCount } from "./leaguePhase.js";

export function simulateDomesticCup(league, performanceScore, standing, player) {
  // Domestic cups are competitive - even good teams can get knocked out early
  const base = standing ? standing.points / Math.max(1, leagueMatchCount(league)) : 0.8;
  
  // Factor in league position - lower positions have harder time in cup
  const positionFactor = standing ? (standing.position <= 4 ? 1.0 : standing.position <= 8 ? 0.8 : 0.6) : 0.7;
  
  // Much more challenging thresholds - cups are unpredictable
  const strength = clamp(
    (base * 0.6 * positionFactor) + 
    (performanceScore / 110) + 
    (player.rating / 130) + 
    randFloat(-0.8, 0.8), // More randomness
    0, 
    2.4
  );
  
  // Cup rounds in order
  const cupRounds = [
    "Round of 64",
    "Round of 32",
    "Round of 16",
    "Quarter-finals",
    "Semi-finals",
    "Finalists",
    "Winners"
  ];
  
  // Determine how far player progressed
  let resultIndex = 0;
  if (strength >= 2.3) resultIndex = 6; // Winners
  else if (strength >= 2.0) resultIndex = 5; // Finalists
  else if (strength >= 1.6) resultIndex = 4; // Semi-finals
  else if (strength >= 1.3) resultIndex = 3; // Quarter-finals
  else if (strength >= 0.9) resultIndex = 2; // Round of 16
  else if (strength >= 0.5) resultIndex = 1; // Round of 32
  else resultIndex = 0; // Round of 64
  
  const result = cupRounds[resultIndex];
  const playerTeam = player.club.displayName || player.club.name;
  const playerTeamName = player.club.name;
  
  // Get all teams from the league with their info
  const leagueTeams = league.clubs?.map(c => ({
    name: c.name,
    displayName: c.displayName || c.name,
    badge: c.badge,
    strength: c.financialTier * 10 + league.tier * 3 + randFloat(-5, 5)
  })) || [];
  
  // Create a tournament bracket system
  // Start with all teams in competition
  let teamsInCompetition = [...leagueTeams];
  
  // Remove player's team from the pool (we'll track it separately)
  const playerTeamData = teamsInCompetition.find(t => t.name === playerTeamName);
  teamsInCompetition = teamsInCompetition.filter(t => t.name !== playerTeamName);
  
  // Shuffle remaining teams
  teamsInCompetition = teamsInCompetition.sort(() => Math.random() - 0.5);
  
  // Generate round-by-round progression with opponents and scores
  const rounds = [];
  let currentRoundTeams = [...teamsInCompetition];
  let playerStillIn = true;
  
  // Simulate each round
  for (let i = 0; i <= resultIndex && playerStillIn; i++) {
    const roundName = cupRounds[i];
    let opponent = null;
    let opponentData = null;
    let score = null;
    let qualified = false;
    
    if (i === 0) {
      // Round of 64 - player plays their first match
      if (currentRoundTeams.length > 0) {
        opponentData = pickRandom(currentRoundTeams);
        opponent = opponentData.displayName;
        
        // Calculate match result
        const playerStrength = base * positionFactor + performanceScore / 100 + player.rating / 100;
        const opponentStrength = opponentData.strength / 50;
        const playerWinChance = playerStrength / (playerStrength + opponentStrength);
        
        if (Math.random() < playerWinChance) {
          qualified = true;
          // Generate score - player wins
          const playerGoals = Math.floor(randFloat(1, 4));
          const opponentGoals = Math.floor(randFloat(0, Math.min(playerGoals - 1, 2)));
          score = `${playerGoals}-${opponentGoals}`;
          // Remove opponent from competition
          currentRoundTeams = currentRoundTeams.filter(t => t.name !== opponentData.name);
        } else {
          qualified = false;
          playerStillIn = false;
          // Generate score - player loses
          const opponentGoals = Math.floor(randFloat(1, 3));
          const playerGoals = Math.floor(randFloat(0, Math.min(opponentGoals - 1, 2)));
          score = `${playerGoals}-${opponentGoals}`;
        }
      }
    } else {
      // Knockout rounds - player faces a team that's still in
      if (currentRoundTeams.length > 0 && playerStillIn) {
        opponentData = pickRandom(currentRoundTeams);
        opponent = opponentData.displayName;
        
        // Calculate match result
        const playerStrength = base * positionFactor + performanceScore / 100 + player.rating / 100;
        const opponentStrength = opponentData.strength / 50;
        const playerWinChance = playerStrength / (playerStrength + opponentStrength);
        
        if (Math.random() < playerWinChance) {
          qualified = true;
          // Generate score - player wins
          const playerGoals = i < 3 ? Math.floor(randFloat(1, 4)) : Math.floor(randFloat(1, 3));
          const opponentGoals = Math.floor(randFloat(0, Math.min(playerGoals - 1, 2)));
          score = `${playerGoals}-${opponentGoals}`;
          // Remove opponent from competition
          currentRoundTeams = currentRoundTeams.filter(t => t.name !== opponentData.name);
        } else {
          qualified = false;
          playerStillIn = false;
          // Generate score - player loses
          const opponentGoals = i < 3 ? Math.floor(randFloat(1, 3)) : Math.floor(randFloat(1, 2));
          const playerGoals = Math.floor(randFloat(0, Math.min(opponentGoals - 1, 1)));
          score = `${playerGoals}-${opponentGoals}`;
        }
      }
    }
    
    // Simulate other matches in this round to determine who advances
    if (i < resultIndex || (i === resultIndex && qualified)) {
      // Other teams play each other
      const remainingTeams = [...currentRoundTeams];
      const nextRoundTeams = [];
      
      // Pair up teams and simulate matches
      while (remainingTeams.length >= 2) {
        const team1 = pickRandom(remainingTeams);
        remainingTeams.splice(remainingTeams.indexOf(team1), 1);
        const team2 = pickRandom(remainingTeams);
        remainingTeams.splice(remainingTeams.indexOf(team2), 1);
        
        // Simulate match
        const team1WinChance = team1.strength / (team1.strength + team2.strength);
        if (Math.random() < team1WinChance) {
          nextRoundTeams.push(team1);
        } else {
          nextRoundTeams.push(team2);
        }
      }
      
      currentRoundTeams = nextRoundTeams;
    }
    
    if (opponentData) {
      rounds.push({
        round: roundName,
        opponent: opponentData.displayName,
        opponentName: opponentData.name,
        opponentBadge: opponentData.badge,
        score,
        qualified
      });
    }
  }
  
  // Determine final result
  let finalists = null;
  let winner = null;
  let winnerData = null;
  
  if (resultIndex < 5 || !playerStillIn) {
    // Eliminated before final - simulate rest of tournament
    let remainingTeams = [...currentRoundTeams];
    
    // Continue simulating until we have finalists
    while (remainingTeams.length > 2) {
      const nextRound = [];
      while (remainingTeams.length >= 2) {
        const team1 = pickRandom(remainingTeams);
        remainingTeams.splice(remainingTeams.indexOf(team1), 1);
        const team2 = pickRandom(remainingTeams);
        remainingTeams.splice(remainingTeams.indexOf(team2), 1);
        
        const team1WinChance = team1.strength / (team1.strength + team2.strength);
        if (Math.random() < team1WinChance) {
          nextRound.push(team1);
        } else {
          nextRound.push(team2);
        }
      }
      remainingTeams = nextRound;
    }
    
    // Final two teams
    if (remainingTeams.length === 2) {
      finalists = [
        {
          name: remainingTeams[0].name,
          displayName: remainingTeams[0].displayName,
          badge: remainingTeams[0].badge
        },
        {
          name: remainingTeams[1].name,
          displayName: remainingTeams[1].displayName,
          badge: remainingTeams[1].badge
        }
      ];
      
      // Simulate final
      const team1WinChance = remainingTeams[0].strength / (remainingTeams[0].strength + remainingTeams[1].strength);
      if (Math.random() < team1WinChance) {
        winnerData = remainingTeams[0];
      } else {
        winnerData = remainingTeams[1];
      }
      winner = winnerData.displayName;
    }
  } else if (result === "Winners") {
    // Player won
    winner = playerTeam;
    winnerData = {
      name: playerTeamName,
      displayName: playerTeam,
      badge: player.club.badge
    };
    
    // Need to determine who they beat in final
    if (currentRoundTeams.length > 0) {
      const finalOpponent = pickRandom(currentRoundTeams);
      // Add final round to rounds if not already there
      if (!rounds.find(r => r.round === "Winners" || r.round === "Finalists")) {
        rounds.push({
          round: "Winners",
          opponent: finalOpponent.displayName,
          opponentName: finalOpponent.name,
          opponentBadge: finalOpponent.badge,
          score: `${Math.floor(randFloat(1, 3))}-${Math.floor(randFloat(0, 1))}`,
          qualified: true
        });
      }
    }
  } else if (result === "Finalists") {
    // Player was runner-up - need opponent from remaining teams
    if (currentRoundTeams.length > 0) {
      const finalOpponent = pickRandom(currentRoundTeams);
      finalists = [
        {
          name: playerTeamName,
          displayName: playerTeam,
          badge: player.club.badge
        },
        {
          name: finalOpponent.name,
          displayName: finalOpponent.displayName,
          badge: finalOpponent.badge
        }
      ];
      winnerData = finalOpponent;
      winner = finalOpponent.displayName;
      
      // Add final round
      if (!rounds.find(r => r.round === "Finalists")) {
        rounds.push({
          round: "Finalists",
          opponent: finalOpponent.displayName,
          opponentName: finalOpponent.name,
          opponentBadge: finalOpponent.badge,
          score: `${Math.floor(randFloat(0, 1))}-${Math.floor(randFloat(1, 2))}`,
          qualified: false
        });
      }
    }
  }
  
  return {
    result,
    won: result === "Winners",
    rounds,
    finalists,
    winner,
    winnerData
  };
}
