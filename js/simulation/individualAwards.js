export function simulateIndividualAwards(performanceScore, season, player, leagueLookup) {
  const awards = [];
  const ratingBonus = Math.max(0, player.rating - 78) / 10;
  const baseChance = (performanceScore - 60) / 40 + ratingBonus;
  
  // World Player of the Year - extremely rare, requires exceptional performance
  if (baseChance > 1.8 && player.rating >= 85 && Math.random() < 0.15) {
    awards.push("World Player of the Year");
  }
  
  // Golden Boot - requires realistic goal numbers based on league and position
  else if (baseChance > 1.0 && !["GK", "RB", "LB", "CB", "CDM"].includes(player.position)) {
    const goals = season.goals || 0;
    const matches = season.matches || 0;
    const goalsPerGame = matches > 0 ? goals / matches : 0;
    
    // Higher tier values represent stronger leagues in this sim.
    const leagueTier = season.league ? (leagueLookup.get(season.league)?.tier || 3) : 3;
    let minGoals, minGoalsPerGame;
    
    if (leagueTier >= 4) {
      // Top leagues - very competitive
      minGoals = 20;
      minGoalsPerGame = 0.6;
    } else if (leagueTier >= 3) {
      // Mid-tier leagues
      minGoals = 15;
      minGoalsPerGame = 0.5;
    } else {
      // Lower-tier leagues
      minGoals = 12;
      minGoalsPerGame = 0.4;
    }
    
    if (goals >= minGoals && goalsPerGame >= minGoalsPerGame && Math.random() < 0.3) {
      awards.push("Golden Boot");
    }
  }
  
  // Golden Glove - for goalkeepers with good clean sheet record
  else if (baseChance > 1.0 && player.position === "GK") {
    const cleanSheets = season.cleanSheets || 0;
    const matches = season.matches || 0;
    const cleanSheetRate = matches > 0 ? cleanSheets / matches : 0;
    
    if (cleanSheets >= 10 && cleanSheetRate >= 0.25 && Math.random() < 0.4) {
      awards.push("Golden Glove");
    }
  }
  
  // Team of the Season - more accessible but still requires good performance
  if (baseChance > 0.7 && Math.random() < 0.4) {
    awards.push("Team of the Season");
  }
  
  return awards;
}
