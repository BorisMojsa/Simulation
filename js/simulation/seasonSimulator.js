import { POSITION_PROFILES, STATS_KEYS } from "../config/playerConfig.js";
import { agePerformanceModifier, adjustAttributes } from "./playerDevelopment.js";
import { generateLeagueTable } from "./leaguePhase.js";
import { simulateEuropeanCampaign } from "./europeanCompetition.js";
import { simulateDomesticCup } from "./domesticCup.js";
import { simulateIndividualAwards } from "./individualAwards.js";
import { clubNameForDisplay, clamp, pickRandom, randFloat, randInt } from "../utils/helpers.js";

/** How much an assist counts vs a goal for “match impact” by position. */
function assistWeightForPosition(position) {
  const map = {
    ST: 0.58,
    LW: 0.7,
    RW: 0.7,
    LM: 0.74,
    RM: 0.74,
    CAM: 0.9,
    CM: 0.92,
    CDM: 0.95,
    GK: 0.35,
  };
  return map[position] ?? 0.82;
}

/** Upper bound for average match rating: low perf → cannot fake a world-class season; elite perf → can exceed 9.3. */
function maxAvgRatingForPerfRatio(perfRatio) {
  if (perfRatio < 0.82) return 7.75;
  if (perfRatio < 0.92) return 8.05;
  if (perfRatio < 1.02) return 8.35;
  if (perfRatio < 1.14) return 8.65;
  if (perfRatio < 1.28) return 8.95;
  if (perfRatio < 1.42) return 9.2;
  if (perfRatio < 1.58) return 9.45;
  if (perfRatio < 1.78) return 9.65;
  if (perfRatio < 2.05) return 9.82;
  return 9.92;
}

/**
 * Average match rating from seasonal output (quiet seasons stay in the 6s–low 8s).
 * Exceptional G+A (or GK clean sheets) can push into the 9.3+ range — not capped at 9.35 globally.
 */
function computeAvgMatchRatingFromOutput({
  position,
  profile,
  matches,
  goals,
  assists,
  cleanSheets,
  ratingInfluence,
  ageModifier,
}) {
  const ri = ratingInfluence;
  const am = ageModifier;
  const csAge = Math.min(1.1, am + 0.1);

  if (position === "GK") {
    const expCS = Math.max(0.35, matches * profile.cleanSheetRate * ri * csAge);
    const perfRatio = clamp(cleanSheets / expCS, 0.3, 3.2);
    const raw =
      6.55 +
      (perfRatio - 1) * 2.45 +
      ri * 0.1 +
      randFloat(-0.38, 0.38);
    let out = raw;
    if (perfRatio >= 1.35 && randFloat(0, 1) < 0.2) out += randFloat(0.08, 0.35);
    const cap = maxAvgRatingForPerfRatio(perfRatio);
    return clamp(parseFloat(out.toFixed(2)), 5.3, cap);
  }

  const aW = assistWeightForPosition(position);
  const actualAttackPM = (goals + assists * aW) / matches;
  const expAttackPM = Math.max(
    0.035,
    (profile.goalRate + profile.assistRate * aW) * ri * am
  );
  // Allow rare “career years” to score well above expectation (e.g. 35G/12A as ST)
  const ratioAttack = clamp(actualAttackPM / expAttackPM, 0.12, 4.2);

  const expCSPM = Math.max(0.02, profile.cleanSheetRate * ri * csAge);
  const actualCSPM = cleanSheets / matches;
  const ratioDef =
    expCSPM > 0.01 ? clamp(actualCSPM / expCSPM, 0.12, 3.5) : 1;

  const atkW = clamp(profile.goalRate + profile.assistRate, 0.06, 0.62);
  const defW = profile.cleanSheetRate;
  const blendW = atkW + defW;
  const attackShare = blendW > 0 ? atkW / blendW : 1;
  const defShare = 1 - attackShare;

  const perfRatio = ratioAttack * attackShare + ratioDef * defShare;

  const fromOutput = 6.62 + (perfRatio - 1) * 2.65;
  const composure = ri * 0.11;
  const noise = randFloat(-0.36, 0.36);
  let raw = fromOutput + composure + noise;

  if (perfRatio >= 1.38 && randFloat(0, 1) < 0.18) {
    raw += randFloat(0.06, 0.28);
  }
  if (perfRatio >= 1.65 && randFloat(0, 1) < 0.22) {
    raw += randFloat(0.05, 0.22);
  }
  if (perfRatio < 0.52 && randFloat(0, 1) < 0.16) {
    raw -= randFloat(0.12, 0.38);
  }

  const cap = maxAvgRatingForPerfRatio(perfRatio);
  return clamp(parseFloat(raw.toFixed(2)), 5.28, cap);
}

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

  const avgMatchRating = computeAvgMatchRatingFromOutput({
    position: player.position,
    profile,
    matches,
    goals,
    assists,
    cleanSheets,
    ratingInfluence,
    ageModifier,
  });

  const performanceScore =
    avgMatchRating * 10 +
    goals * (profile.goalRate > 0.2 ? 2.3 : 1.2) +
    assists * 1.5 +
    cleanSheets * (profile.cleanSheetRate > 0.25 ? 2 : 1);

  // Dynamic potential (hidden ceiling): big seasons raise it; anonymous youth seasons chip it down slightly
  if (age <= 30) {
    if (player.position === "GK") {
      const csRate = matches > 0 ? cleanSheets / matches : 0;
      if (cleanSheets >= 14 && csRate >= 0.36) {
        player.potential = clamp(player.potential + randFloat(1.0, 3.0), player.rating + 1, 99);
      } else if (cleanSheets >= 10 && csRate >= 0.28) {
        player.potential = clamp(player.potential + randFloat(0.45, 1.7), player.rating + 1, 97);
      } else if (cleanSheets <= 4 && matches >= 24) {
        player.potential = Math.max(player.rating + 1, player.potential - randFloat(0.12, 0.65));
      }
    } else {
      const contrib = goals + assists;
      if (contrib >= 32) {
        player.potential = clamp(player.potential + randFloat(1.2, 3.8), player.rating + 1, 99);
      } else if (contrib >= 24) {
        player.potential = clamp(player.potential + randFloat(0.65, 2.2), player.rating + 1, 98);
      } else if (contrib >= 18 && performanceScore > 80) {
        player.potential = clamp(player.potential + randFloat(0.3, 1.35), player.rating + 1, 96);
      }
      const quietThreshold = Math.max(4, Math.round(matches * (profile.goalRate + profile.assistRate) * 0.28));
      if (contrib < quietThreshold && matches >= 22) {
        player.potential = Math.max(player.rating + 1, player.potential - randFloat(0.12, 0.7));
      }
    }
  }

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

  // Slight youth variance only — removed guaranteed early-career boost so progression isn’t always up
  if (seasonIndex < 3 && ratingDelta > 0 && randFloat(0, 1) < 0.45) {
    ratingDelta += randFloat(0, 0.35);
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
