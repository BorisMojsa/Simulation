import { POSITION_PROFILES, STATS_KEYS } from "../config/playerConfig.js";
import { agePerformanceModifier, adjustAttributes } from "./playerDevelopment.js?v=49";
import {
  applyDivisionMovement,
  divisionMoveSlots,
  findSisterLeagues,
  qualificationForPosition,
} from "./leaguePhase.js?v=45";
import { simulateLeagueSeason } from "./leagueFixtures.js?v=45";
import {
  simulateEuropeanCampaign,
  simulateEuropeanFinalsShowcase,
} from "./europeanCompetition.js?v=49";
import { simulateDomesticCup } from "./domesticCup.js?v=49";
import { simulateIndividualAwards } from "./individualAwards.js";
import { simulateInternationalSeason } from "./nationalTeam.js?v=49";
import { clubNameForDisplay, clamp, pickRandom, randFloat } from "../utils/helpers.js";

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
  const league = leagueLookup.get(player.club.league) || pickRandom(leagues);
  const formSeed = 65 + (player.rating - 65) * 0.8 + randFloat(-6, 8);

  const leagueSim = simulateLeagueSeason(league, player, formSeed);
  const sisters = findSisterLeagues(league, leagues);
  const { promoteSlots, relegateSlots } = divisionMoveSlots(league, sisters);

  leagueSim.table.forEach((row) => {
    row.qualification = qualificationForPosition(row.position, league, sisters);
    if (sisters.higher && row.position <= promoteSlots) row.divisionMove = "promoted";
    if (sisters.lower && row.position > leagueSim.table.length - relegateSlots) row.divisionMove = "relegated";
  });

  const playerRow = leagueSim.playerRecord;
  if (playerRow) {
    playerRow.qualification = qualificationForPosition(playerRow.position, league, sisters);
    playerRow.divisionMove = leagueSim.table.find((r) => r.name === playerRow.name)?.divisionMove || null;
  }

  let matches = leagueSim.playerMatchStats.played;
  let goals = leagueSim.playerMatchStats.goals;
  let assists = leagueSim.playerMatchStats.assists;
  let cleanSheets = 0;
  if (player.position === "GK") {
    cleanSheets = leagueSim.playerMatches.filter((m) => {
      const conceded = m.playerSide === "home" ? m.awayGoals : m.homeGoals;
      return conceded === 0;
    }).length;
  } else if (["CB", "RB", "LB", "CDM"].includes(player.position)) {
    cleanSheets = leagueSim.playerMatches.filter((m) => {
      const conceded = m.playerSide === "home" ? m.awayGoals : m.homeGoals;
      return conceded === 0 && Math.random() < 0.55;
    }).length;
  }

  const standing = playerRow
    ? {
        position: playerRow.position,
        points: playerRow.points,
        qualification: playerRow.qualification,
        divisionMove: playerRow.divisionMove || null,
        record: { wins: playerRow.wins, draws: playerRow.draws, losses: playerRow.losses },
        matches: playerRow.matches,
        goalDiff: playerRow.goalDiff,
        strength: playerRow.strength,
        table: leagueSim.table,
      }
    : null;

  let yellowCards = leagueSim.playerMatchStats.yellow;
  let redCards = leagueSim.playerMatchStats.red;

  const domesticCupResult = simulateDomesticCup(league, formSeed, standing, player);
  for (const m of domesticCupResult.playerMatches || []) {
    goals += m.playerStats?.goals || 0;
    assists += m.playerStats?.assists || 0;
    yellowCards += m.playerStats?.yellow || 0;
    redCards += m.playerStats?.red || 0;
  }

  let europeanCampaign = simulateEuropeanCampaign({ standing, league, performanceScore: formSeed, player });
  if (!europeanCampaign) {
    europeanCampaign = simulateEuropeanFinalsShowcase(league);
  } else {
    for (const m of europeanCampaign.playerMatches || []) {
      goals += m.playerStats?.goals || 0;
      assists += m.playerStats?.assists || 0;
      yellowCards += m.playerStats?.yellow || 0;
      redCards += m.playerStats?.red || 0;
    }
  }

  // Provisional club form for national call-up decisions
  const clubRated = [
    ...(leagueSim.playerMatches || []),
    ...(domesticCupResult.playerMatches || []),
    ...((europeanCampaign?.qualified !== false && europeanCampaign?.playerMatches) || []),
  ].filter((m) => m.playerStats?.rating != null);
  const clubFormAvg =
    clubRated.length > 0
      ? clubRated.reduce((s, m) => s + m.playerStats.rating, 0) / clubRated.length
      : 6.8;

  const calendarYear = (player.startYear || new Date().getFullYear()) + seasonIndex;
  const internationalSeason = simulateInternationalSeason({
    player,
    calendarYear,
    avgMatchRating: clubFormAvg,
  });
  for (const m of internationalSeason.playerMatches || []) {
    goals += m.playerStats?.goals || 0;
    assists += m.playerStats?.assists || 0;
    yellowCards += m.playerStats?.yellow || 0;
    redCards += m.playerStats?.red || 0;
  }

  // True average of per-match ratings (WhoScored-style), then blend with output model
  const ratedMatches = [
    ...clubRated,
    ...(internationalSeason.playerMatches || []).filter((m) => m.playerStats?.rating != null),
  ];

  const liveAvg =
    ratedMatches.length > 0
      ? ratedMatches.reduce((s, m) => s + m.playerStats.rating, 0) / ratedMatches.length
      : null;

  const ageModifier = agePerformanceModifier(age);
  const outputAvg = computeAvgMatchRatingFromOutput({
    position: player.position,
    profile,
    matches: Math.max(1, matches),
    goals,
    assists,
    cleanSheets,
    ratingInfluence: player.rating / 100,
    ageModifier,
  });
  const avgMatchRating = parseFloat(
    (liveAvg != null ? liveAvg * 0.72 + outputAvg * 0.28 : outputAvg).toFixed(2)
  );

  const performanceScore =
    avgMatchRating * 11 +
    goals * (profile.goalRate > 0.2 ? 2.3 : 1.2) +
    assists * 1.5 +
    cleanSheets * (profile.cleanSheetRate > 0.25 ? 2 : 1);

  if (age <= 30) {
    if (player.position === "GK") {
      const csRate = matches > 0 ? cleanSheets / matches : 0;
      if (cleanSheets >= 14 && csRate >= 0.36) player.potential = clamp(player.potential + randFloat(1.0, 3.0), player.rating + 1, 99);
      else if (cleanSheets >= 10 && csRate >= 0.28) player.potential = clamp(player.potential + randFloat(0.45, 1.7), player.rating + 1, 97);
      else if (cleanSheets <= 4 && matches >= 24) player.potential = Math.max(player.rating + 1, player.potential - randFloat(0.12, 0.65));
    } else {
      const contrib = goals + assists;
      if (contrib >= 32) player.potential = clamp(player.potential + randFloat(1.2, 3.8), player.rating + 1, 99);
      else if (contrib >= 24) player.potential = clamp(player.potential + randFloat(0.65, 2.2), player.rating + 1, 98);
      else if (contrib >= 18 && performanceScore > 80) player.potential = clamp(player.potential + randFloat(0.3, 1.35), player.rating + 1, 96);
      const quietThreshold = Math.max(4, Math.round(matches * (profile.goalRate + profile.assistRate) * 0.28));
      if (contrib < quietThreshold && matches >= 22) player.potential = Math.max(player.rating + 1, player.potential - randFloat(0.12, 0.7));
    }
  }

  let ratingDelta = 0;
  if (performanceScore > 92) ratingDelta = randFloat(2.0, 4.0);
  else if (performanceScore > 85) ratingDelta = randFloat(1.0, 2.5);
  else if (performanceScore > 78) ratingDelta = randFloat(0.2, 1.8);
  else if (performanceScore > 68) ratingDelta = randFloat(-0.5, 1.2);
  else if (performanceScore > 58) ratingDelta = randFloat(-1.2, 0.5);
  else if (performanceScore > 45) ratingDelta = -randFloat(0.5, 2.0);
  else if (performanceScore > 34) ratingDelta = -randFloat(1.5, 3.0);
  else ratingDelta = -randFloat(2.5, 4.5);

  // Season average match rating (WhoScored scale) pulls OVR hard
  if (avgMatchRating >= 8.2) ratingDelta += randFloat(0.55, 1.35);
  else if (avgMatchRating >= 7.6) ratingDelta += randFloat(0.25, 0.75);
  else if (avgMatchRating >= 7.1) ratingDelta += randFloat(0.05, 0.35);
  else if (avgMatchRating < 6.2) ratingDelta -= randFloat(0.35, 1.1);
  else if (avgMatchRating < 6.6) ratingDelta -= randFloat(0.1, 0.45);

  ratingDelta += clamp((goals - matches * profile.goalRate) * 0.05, -1.8, 1.8);
  ratingDelta += clamp((assists - matches * profile.assistRate) * 0.04, -1.4, 1.4);
  if (age >= 30) ratingDelta -= (age - 29) * 0.12;
  if (age <= 27 && performanceScore > 88) ratingDelta += randFloat(0.15, 0.55);
  if (age >= 28 && performanceScore < 55) ratingDelta -= randFloat(0.2, 0.8);
  if (age >= 34) {
    if (ratingDelta > 0) ratingDelta = Math.min(ratingDelta, age <= 35 ? 0.3 : 0.15);
    const declineBase = 0.45 + (age - 34) * 0.35;
    if (ratingDelta > -declineBase) ratingDelta = -declineBase + randFloat(-0.35, 0.15);
  }
  if (seasonIndex < 3 && ratingDelta > 0 && randFloat(0, 1) < 0.45) ratingDelta += randFloat(0, 0.35);
  ratingDelta = clamp(ratingDelta, -5.5, 5.5);

  const previousRating = player.rating;
  const newRating = clamp(Math.round(previousRating + ratingDelta), 40, 99);
  const ratingChange = newRating - previousRating;
  const previousAttributes = { ...player.attributes };

  player.age = age;
  player.rating = newRating;
  adjustAttributes(player, profile.growthBias, ratingChange !== 0 ? ratingChange : ratingDelta);
  if (age >= 33) {
    const decay = age >= 37 ? randFloat(0.7, 1.6) : randFloat(0.3, 1.0);
    player.potential = Math.max(newRating + 1, player.potential - decay);
  }
  player.careerTotals.matches += matches;
  player.careerTotals.goals += goals;
  player.careerTotals.assists += assists;
  player.careerTotals.cleanSheets += cleanSheets;

  const individualAwards = simulateIndividualAwards(
    performanceScore,
    { goals, assists, cleanSheets, matches, league: player.club.league },
    player,
    leagueLookup
  );
  const trophies = [];
  if (standing && standing.position === 1) {
    player.careerHonors.leagueTitles += 1;
    trophies.push({
      kind: "league",
      label: `${league.displayName ?? league.name} Champions`,
      competition: league.displayName ?? league.name,
      simKey: league.name,
    });
  }
  if (domesticCupResult?.won) {
    player.careerHonors.domesticCups += 1;
    const cupName = domesticCupResult.name || `${league.nation} Cup`;
    trophies.push({
      kind: "cup",
      label: `${cupName} Winners`,
      competition: cupName,
      simKey: cupName,
    });
  }
  if (europeanCampaign?.won && europeanCampaign?.qualified !== false) {
    player.careerHonors.europeanTitles += 1;
    trophies.push({
      kind: "continental",
      label: `${europeanCampaign.competition} Winners`,
      competition: europeanCampaign.competition,
      simKey: europeanCampaign.competition,
    });
  }
  if (internationalSeason?.primary?.won) {
    if (!player.careerHonors.internationalTitles) player.careerHonors.internationalTitles = 0;
    player.careerHonors.internationalTitles += 1;
    const intlName = internationalSeason.primary.name;
    trophies.push({
      kind: "international",
      label: `${intlName} Winners`,
      competition: intlName,
      simKey: intlName,
    });
  }
  if (individualAwards.length) player.careerHonors.individualAwards += individualAwards.length;

  const honors = trophies.length
    ? trophies[0].label
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
    yellowCards,
    redCards,
    avgMatchRating,
    ratingChange,
    ratingAfter: newRating,
    standing,
    honors,
    europeanCampaign,
    internationalSeason,
    domesticCupResult,
    individualAwards,
    trophies,
    divisionMove: null,
    leagueMatches: leagueSim.playerMatches,
  };

  player.seasons.push(season);
  player.latestStanding = standing
    ? { league: league.name, leagueDisplay: league.displayName ?? league.name, table: leagueSim.table, playerRow }
    : null;

  const divisionMove = applyDivisionMovement(player, playerRow, league, leagues);
  if (divisionMove) {
    season.divisionMove = divisionMove;
    if (standing) standing.divisionMove = divisionMove.type;
  }

  const attributeChanges = {};
  STATS_KEYS.forEach((key) => {
    attributeChanges[key] = {
      old: previousAttributes[key],
      new: player.attributes[key],
      change: player.attributes[key] - previousAttributes[key],
    };
  });

  return {
    season,
    league,
    standings: { table: leagueSim.table, playerRecord: playerRow },
    europeanCampaign,
    internationalSeason,
    domesticCupResult,
    individualAwards,
    attributeChanges,
    previousRating,
    newRating,
    performanceScore,
  };
}
