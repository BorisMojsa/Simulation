import { POSITION_PROFILES, STATS_KEYS } from "../config/playerConfig.js";
import { agePerformanceModifier, adjustAttributes } from "./playerDevelopment.js";
import { generateLeagueTable } from "./leaguePhase.js";
import { simulateEuropeanCampaign } from "./europeanCompetition.js";
import { simulateDomesticCup } from "./domesticCup.js";
import { simulateIndividualAwards } from "./individualAwards.js";
import { clubNameForDisplay, clamp, pickRandom, randFloat, randInt } from "../utils/helpers.js";

export function simulateSeason(player, leagues, leagueLookup) {
  const profile = POSITION_PROFILES[player.position] || POSITION_PROFILES.DEFAULT;
  const seasonIndex = player.seasons.length;
  const age = player.age + 1;
  const matches = randInt(20, 44);
  const ageModifier = agePerformanceModifier(age);
  const formModifier = randFloat(0.85, 1.18);
  const ratingInfluence = player.rating / 100;

  const goalRate = profile.goalRate * ratingInfluence * ageModifier * formModifier;
  const assistRate = profile.assistRate * ratingInfluence * ageModifier * randFloat(0.9, 1.1);
  const cleanSheetRate = profile.cleanSheetRate * ratingInfluence * Math.min(1.1, ageModifier + 0.1);

  const goals = Math.round(matches * goalRate * randFloat(0.7, 1.25));
  const assists = Math.round(matches * assistRate * randFloat(0.7, 1.25));
  const cleanSheets = Math.round(matches * cleanSheetRate * randFloat(0.8, 1.2));

  const avgMatchRating = clamp(
    parseFloat((6.1 + ratingInfluence * 3 + ageModifier * 0.8 + randFloat(-0.45, 0.65)).toFixed(2)),
    5.4,
    9.8
  );

  const performanceScore =
    avgMatchRating * 10 +
    goals * (profile.goalRate > 0.2 ? 2.3 : 1.2) +
    assists * 1.5 +
    cleanSheets * (profile.cleanSheetRate > 0.25 ? 2 : 1);

  // More realistic and random rating changes based on performance
  let ratingDelta = 0;
  
  // Excellent performance - significant boost
  if (performanceScore > 92) {
    ratingDelta = randFloat(2.0, 4.0);
  } 
  // Very good performance - good boost
  else if (performanceScore > 85) {
    ratingDelta = randFloat(1.0, 2.5);
  } 
  // Good performance - moderate boost
  else if (performanceScore > 78) {
    ratingDelta = randFloat(0.2, 1.8);
  } 
  // Average performance - can go either way, slight bias toward staying same
  else if (performanceScore > 68) {
    ratingDelta = randFloat(-0.5, 1.2); // Can decrease with average performance
  } 
  // Below average - often decreases
  else if (performanceScore > 58) {
    ratingDelta = randFloat(-1.2, 0.5); // More likely to decrease
  } 
  // Poor performance - decreases
  else if (performanceScore > 45) {
    ratingDelta = -randFloat(0.5, 2.0);
  } 
  // Very poor performance - significant decrease
  else if (performanceScore > 34) {
    ratingDelta = -randFloat(1.5, 3.0);
  } 
  // Terrible performance - large decrease
  else {
    ratingDelta = -randFloat(2.5, 4.5);
  }

  // Performance-based adjustments from stats
  const expectedGoals = matches * profile.goalRate;
  const expectedAssists = matches * profile.assistRate;
  const expectedCleanSheets = matches * profile.cleanSheetRate;

  // Stats impact - can be positive or negative
  const goalsImpact = clamp((goals - expectedGoals) * 0.05, -1.8, 1.8);
  const assistsImpact = clamp((assists - expectedAssists) * 0.04, -1.4, 1.4);
  ratingDelta += goalsImpact;
  ratingDelta += assistsImpact;

  if (["GK", "RB", "LB", "CB", "CDM"].includes(player.position)) {
    const cleanSheetsImpact = clamp((cleanSheets - expectedCleanSheets) * 0.035, -1.3, 1.3);
    ratingDelta += cleanSheetsImpact;
  }

  // Add more randomness - simulation variability
  ratingDelta += randFloat(-0.6, 0.6); // Increased randomness

  if (age >= 30) {
    ratingDelta -= randFloat(0.3, 1.5);
  }

  // Young-player breakout potential boosts; stop awarding after ~27.
  const breakoutBoost = age <= 27
    ? (
        performanceScore > 118
          ? randFloat(1.4, 2.6)
          : performanceScore > 98
          ? randFloat(0.6, 1.6)
          : performanceScore > 80
          ? randFloat(0.2, 0.8)
          : 0
      )
    : 0;

  if (breakoutBoost > 0) {
    const ceilingCap = 98;
    const minCeiling = Math.min(player.rating + Math.max(ratingDelta, 0) + 1, ceilingCap);
    player.potential = clamp(player.potential + breakoutBoost, minCeiling, ceilingCap);
  }

  if (age >= 28 && performanceScore < 55) {
    const drop = randFloat(0.2, 0.9);
    player.potential = Math.max(player.rating + 1, player.potential - drop);
  }

  // Natural ageing decline after 34: enforce negative drift and limit positives.
  if (age >= 34) {
    // Cap positive growth when mid-30s+; allow only very small upticks.
    if (ratingDelta > 0) {
      ratingDelta = Math.min(ratingDelta, age <= 35 ? 0.3 : 0.15);
    }
    const over = age - 34; // 34 -> 0
    const declineBase = 0.45 + over * 0.35; // grows with age
    ratingDelta -= clamp(randFloat(declineBase * 0.8, declineBase * 1.2), 0.2, 4.5);
  }

  if (player.rating + ratingDelta > player.potential) {
    ratingDelta = Math.max(0, player.potential - player.rating);
  }

  if (seasonIndex < 3 && ratingDelta > 0) {
    ratingDelta += randFloat(0.1, 0.6);
  }

  ratingDelta = clamp(ratingDelta, -5.5, 5.5);

  const previousRating = player.rating;
  const newRating = clamp(Math.round(previousRating + ratingDelta), 40, 99);
  const ratingChange = newRating - previousRating;

  // Store previous attributes for comparison
  const previousAttributes = { ...player.attributes };

  player.age = age;
  player.rating = newRating;
  adjustAttributes(player, profile.growthBias, ratingChange !== 0 ? ratingChange : ratingDelta);
  // Reduce potential gradually after early 30s regardless of performance.
  if (age >= 33) {
    const decay = age >= 37 ? randFloat(0.7, 1.6) : randFloat(0.3, 1.0);
    player.potential = Math.max(newRating + 1, player.potential - decay);
  }
  player.careerTotals.matches += matches;
  player.careerTotals.goals += goals;
  player.careerTotals.assists += assists;
  player.careerTotals.cleanSheets += cleanSheets;

  const league = leagueLookup.get(player.club.league) || pickRandom(leagues);
  const standings = generateLeagueTable(league, player.club.name, performanceScore, player);
  const standing = standings.playerRecord
    ? {
        position: standings.playerRecord.position,
        points: standings.playerRecord.points,
        qualification: standings.playerRecord.qualification,
        record: {
          wins: standings.playerRecord.wins,
          draws: standings.playerRecord.draws,
          losses: standings.playerRecord.losses,
        },
        matches: standings.playerRecord.matches,
        goalDiff: standings.playerRecord.goalDiff,
        strength: standings.playerRecord.strength,
        table: standings.table,
      }
    : null;

  const europeanCampaign = simulateEuropeanCampaign({ standing, league, performanceScore, player });
  const domesticCupResult = simulateDomesticCup(league, performanceScore, standing, player);
  
  // Create season data for awards calculation
  const seasonData = {
    goals,
    assists,
    cleanSheets,
    matches,
    league: player.club.league
  };
  
  const individualAwards = simulateIndividualAwards(performanceScore, seasonData, player, leagueLookup);
  const trophies = [];

  if (standing && standing.position === 1) {
    player.careerHonors.leagueTitles += 1;
    trophies.push(`${league.displayName ?? league.name} Champions`);
  }
  if (domesticCupResult?.won) {
    player.careerHonors.domesticCups += 1;
    trophies.push(`${league.nation} Cup Winners`);
  }
  if (europeanCampaign?.won) {
    player.careerHonors.europeanTitles += 1;
    trophies.push(`${europeanCampaign.competition} Winners`);
  }
  if (individualAwards.length) {
    player.careerHonors.individualAwards += individualAwards.length;
  }

  const honors = trophies.length
    ? trophies[0]
    : standing
    ? standing.qualification || null
    : null;

  const season = {
    seasonNumber: seasonIndex + 1,
    age,
    club: player.club.name,
    clubDisplay: clubNameForDisplay(player.club),
    league: player.club.league,
    leagueDisplay: player.club.leagueDisplay ?? player.club.league,
    badge: player.club.badge,
    matches,
    goals,
    assists,
    cleanSheets,
    avgMatchRating,
    ratingChange,
    ratingAfter: newRating,
    standing,
    honors,
    europeanCampaign,
    domesticCupResult,
    individualAwards,
    trophies,
  };

  player.seasons.push(season);
  player.latestStanding = standing
    ? {
        league: league.name,
        leagueDisplay: league.displayName ?? league.name,
        table: standings.table,
        playerRow: standings.playerRecord,
      }
    : null;

  // Calculate attribute changes
  const attributeChanges = {};
  STATS_KEYS.forEach(key => {
    attributeChanges[key] = {
      old: previousAttributes[key],
      new: player.attributes[key],
      change: player.attributes[key] - previousAttributes[key]
    };
  });

  return { 
    season, 
    league, 
    standings, 
    europeanCampaign, 
    domesticCupResult, 
    individualAwards, 
    attributeChanges,
    previousRating,
    newRating,
    performanceScore,
  };
}
