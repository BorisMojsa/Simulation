import { POSITION_PROFILES, STATS_KEYS } from "../config/playerConfig.js";
import { getDisplayAttributeKeys } from "./playerAbility.js";
import { ensurePlayerModel } from "./playerModelMigration.js";
import { developSeason, stableCareerId } from "./playerDevelopmentModel.js";
import { getOrUpdateForecast } from "./playerPotential.js";
import { createEmptyLedger, recordMatchObservation, aggregateSeason } from "./playerSeasonLedger.js";
import { createStreamRng } from "./rng.js";
import { refreshAbilityCaches } from "./playerAbility.js";
import {
  applyDivisionMovement,
  divisionMoveSlots,
  findSisterLeagues,
  qualificationForPosition,
} from "./leaguePhase.js";
import { simulateChronologicalSeason, resumeChronologicalSeason } from "./chronologicalSeason.js";
import { simulateIndividualAwards } from "./individualAwards.js";
import { clubNameForDisplay, clamp, pickRandom, randFloat } from "../utils/helpers.js";
import { applySeasonDevelopment, attachClubIdentity, ensureWorldState, getWorldState } from "./worldState.js";

/** Legacy 0–100 adapter for awards/transfers — not used for durable development. */
export function legacyPerformanceScoreAdapter({ reliableSignal, avgMatchRating, appearances }) {
  const signal = Number(reliableSignal) || 0;
  const ratingPart = avgMatchRating != null ? (avgMatchRating - 6.5) * 18 : 0;
  const appsPart = clamp((appearances || 0) / 30, 0, 1) * 8;
  return clamp(62 + signal * 28 + ratingPart + appsPart, 20, 98);
}

/** Preserve the club represented in each part of a transfer/loan season. */
export function buildLeagueMatchSegments(matches, leagueLookup) {
  const byId = new Map([...leagueLookup.values()].map((l) => [l.leagueId, l]));
  const segments = [];
  for (const match of matches || []) {
    const club = match.playerSide === "away" ? match.away : match.home;
    const league = byId.get(match.competitionId);
    const clubId = club?.clubId || club?.name;
    const leagueId = match.competitionId;
    let segment = segments[segments.length - 1];
    if (!segment || segment.clubId !== clubId || segment.leagueId !== leagueId) {
      segment = {
        clubId, club: club?.displayName || club?.name || "Club",
        leagueId, league: league?.displayName || league?.name || leagueId,
        matches: [],
      };
      segments.push(segment);
    }
    segment.matches.push(match);
  }
  return segments;
}

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

/**
 * @param {object} [opts]
 * @param {boolean} [opts.pauseForDecisions] — winter-window interactive pause
 * @param {string|object|null} [opts.autoDecisionPolicy] — "stay" for tests/calibration
 * @param {object|null} [opts.checkpoint] — resume a paused season
 */
export function simulateSeason(player, leagues, leagueLookup, opts = {}) {
  ensureWorldState(player);
  ensurePlayerModel(player);
  if (player.club && !player.club.isAcademy) {
    player.club = attachClubIdentity(player.club);
  }
  const profile = POSITION_PROFILES[player.position] || POSITION_PROFILES.DEFAULT;
  const seasonIndex = player.seasons.length;
  const seasonId = `season-${seasonIndex + 1}`;
  const resuming = Boolean(opts.checkpoint || player.seasonCheckpoint?.status === "awaiting_decision");
  if (!resuming && player.development?.lastProcessedSeasonId === seasonId) {
    throw new Error(`simulateSeason: season ${seasonId} already applied`);
  }
  const previousRating = player.rating;
  const previousBaseRaw = player.baseOverallRaw;
  const previousAttributes = { ...player.attributes };
  const previousForecast = player.potentialForecast ? { ...player.potentialForecast } : null;

  // Age advances only when the season completes (not at a January pause).
  const age = player.age + 1;
  let league = leagueLookup.get(player.club.league) || pickRandom(leagues);

  const ledger = createEmptyLedger(seasonId);
  const storedCheckpoint = opts.checkpoint || player.seasonCheckpoint || null;
  const chronoOpts = {
    player,
    league,
    seasonIndex,
    pauseForDecisions: Boolean(opts.pauseForDecisions),
    // Tests/calibration default to auto-stay so one-shot seasons still complete.
    autoDecisionPolicy:
      opts.autoDecisionPolicy !== undefined
        ? opts.autoDecisionPolicy
        : opts.pauseForDecisions
          ? null
          : "stay",
    checkpoint: storedCheckpoint,
  };
  const chrono =
    storedCheckpoint?.status === "awaiting_decision"
      ? resumeChronologicalSeason({ ...chronoOpts, checkpoint: storedCheckpoint })
      : simulateChronologicalSeason(chronoOpts);

  if (chrono.status === "awaiting_decision") {
    // Do not finalize development, history, or age. Caller must resume after the user chooses.
    return {
      awaitingDecision: true,
      checkpoint: chrono.checkpoint,
      decision: chrono.decision,
      offers: chrono.offers,
      partialPlayerMatchStats: chrono.partialPlayerMatchStats,
      seasonIndex,
      seasonId,
      league,
    };
  }

  league = chrono.league || league;

  for (const rec of chrono.ledgerRecords || []) {
    recordMatchObservation(ledger, { ...rec, seasonId });
  }
  const sisters = findSisterLeagues(league, leagues);
  const { promoteSlots, relegateSlots } = divisionMoveSlots(league, sisters);

  chrono.table.forEach((row) => {
    row.qualification = qualificationForPosition(row.position, league, sisters);
    if (sisters.higher && row.position <= promoteSlots) row.divisionMove = "promoted";
    if (sisters.lower && row.position > chrono.table.length - relegateSlots) row.divisionMove = "relegated";
  });

  const playerRow = chrono.playerRecord;
  if (playerRow) {
    playerRow.qualification = qualificationForPosition(playerRow.position, league, sisters);
    playerRow.divisionMove = chrono.table.find((r) => r.name === playerRow.name)?.divisionMove || null;
  }

  let matches = chrono.playerMatchStats.played;
  let goals = chrono.playerMatchStats.goals;
  let assists = chrono.playerMatchStats.assists;
  let cleanSheets = 0;
  if (player.position === "GK") {
    cleanSheets = chrono.playerMatches.filter((m) => {
      const mins = m.playerStats?.minutes || 0;
      const conceded = m.playerSide === "home" ? m.awayGoals : m.homeGoals;
      return mins >= 60 && conceded === 0;
    }).length;
  } else if (["CB", "RB", "LB", "CDM"].includes(player.position)) {
    cleanSheets = chrono.playerMatches.filter((m) => {
      const mins = m.playerStats?.minutes || 0;
      const conceded = m.playerSide === "home" ? m.awayGoals : m.homeGoals;
      return mins >= 60 && conceded === 0;
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
        table: chrono.table,
      }
    : null;

  let yellowCards = chrono.playerMatchStats.yellow;
  let redCards = chrono.playerMatchStats.red;

  const domesticCupResult = chrono.domesticCupResult;
  const europeanCampaign = chrono.europeanCampaign;
  const internationalSeason = chrono.internationalSeason;

  const clubRated = [
    ...(chrono.playerMatches || []),
    ...(domesticCupResult?.playerMatches || []),
    ...((europeanCampaign?.qualified !== false && europeanCampaign?.playerMatches) || []),
  ].filter((m) => m.playerStats?.rating != null);

  const ratedMatches = [
    ...clubRated,
    ...(internationalSeason?.playerMatches || []).filter(
      (m) => m.playerStats?.rating != null && (m.playerStats?.minutes || 0) > 0
    ),
  ];
  const liveAvg =
    ratedMatches.length > 0
      ? ratedMatches.reduce((s, m) => s + m.playerStats.rating * (m.playerStats.minutes || 90), 0) /
        ratedMatches.reduce((s, m) => s + (m.playerStats.minutes || 90), 0)
      : null;

  // Optional light blend with output model for display continuity (not for development).
  const outputAvg = computeAvgMatchRatingFromOutput({
    position: player.position,
    profile,
    matches: Math.max(1, matches),
    goals,
    assists,
    cleanSheets,
    ratingInfluence: (player.baseOverallRaw || player.rating) / 100,
    ageModifier: 1,
  });
  const avgMatchRating = parseFloat(
    (liveAvg != null ? liveAvg * 0.85 + outputAvg * 0.15 : outputAvg).toFixed(2)
  );

  const agg = aggregateSeason(ledger);
  const usefulMinutes = agg.combined.minutes;
  matches = agg.club.appearances;

  const performanceScore = legacyPerformanceScoreAdapter({
    reliableSignal: agg.reliableSignal,
    avgMatchRating: agg.combined.avgMatchRating ?? avgMatchRating,
    appearances: agg.combined.appearances,
  });

  // Age advances once per simulated year after the campaign.
  player.age = age;

  const envProxy = clamp(0.85 + ((player.club?.overall || 70) - 70) / 80, 0.55, 1.35);
  const devRng = createStreamRng(stableCareerId(player), `development:${seasonId}`);
  const already = player.development?.academyGrowthApplied || 0;
  const developmentResult = developSeason(player, {
    elapsedYears: 1,
    usefulMinutes,
    healthyTrainingFraction: player.health?.activeInjury ? 0.35 : 0.9,
    reliableSignal: agg.reliableSignal,
    P_long: usefulMinutes >= 900 ? agg.seasonP : null,
    reliability: agg.reliability,
    environmentMultiplier: envProxy,
    rng: devRng,
    seasonId,
    alreadyAppliedLearningGain: already,
    longFormReliable: usefulMinutes >= 900,
  });

  getOrUpdateForecast(player, { sampleCount: 48 });
  refreshAbilityCaches(player);

  const newRating = player.rating;
  const ratingChange = newRating - previousRating;

  player.careerTotals.matches += agg.combined.appearances;
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
    matches: agg.combined.appearances,
    starts: agg.combined.starts,
    minutes: agg.combined.minutes,
    goals,
    assists,
    cleanSheets,
    yellowCards,
    redCards,
    avgMatchRating: agg.combined.avgMatchRating ?? avgMatchRating,
    ratingChange,
    ratingAfter: newRating,
    baseOverallBefore: previousBaseRaw,
    baseOverallAfter: player.baseOverallRaw,
    currentOverallAfter: player.currentOverall,
    potentialForecastBefore: previousForecast,
    potentialForecastAfter: player.potentialForecast ? { ...player.potentialForecast } : null,
    developmentExplanations: developmentResult?.explanations || [],
    breakthrough: Boolean(developmentResult?.breakthroughTriggered),
    ledgerSummary: {
      club: agg.club,
      international: agg.international,
      reliableSignal: agg.reliableSignal,
      nonParticipation: agg.nonParticipation,
    },
    playerModelVersion: player.playerModelVersion,
    developmentModelVersion: player.developmentModelVersion,
    standing,
    honors,
    europeanCampaign,
    internationalSeason,
    domesticCupResult,
    individualAwards,
    trophies,
    divisionMove: null,
    leagueMatches: chrono.playerMatches,
    leagueMatchSegments: buildLeagueMatchSegments(chrono.playerMatches, leagueLookup),
    chronology: chrono.chronology || null,
  };

  player.seasons.push(season);
  player.latestStanding = standing
    ? { league: league.name, leagueDisplay: league.displayName ?? league.name, table: chrono.table, playerRow }
    : null;

  const divisionMove = applyDivisionMovement(player, playerRow, league, leagues);
  if (divisionMove) {
    season.divisionMove = divisionMove;
    if (standing) standing.divisionMove = divisionMove.type;
  }

  applySeasonDevelopment(getWorldState());

  const attributeChanges = {};
  const keys = getDisplayAttributeKeys(player.position);
  keys.forEach((key) => {
    const oldV = previousAttributes[key];
    const newV = player.attributes[key];
    attributeChanges[key] = {
      old: oldV,
      new: newV,
      change: Number.isFinite(newV) && Number.isFinite(oldV) ? newV - oldV : 0,
    };
  });
  // Also expose outfield keys for UI continuity when GK
  STATS_KEYS.forEach((key) => {
    if (attributeChanges[key]) return;
    if (player.attributes?.[key] != null) {
      attributeChanges[key] = {
        old: previousAttributes[key],
        new: player.attributes[key],
        change: (player.attributes[key] || 0) - (previousAttributes[key] || 0),
      };
    }
  });

  return {
    season,
    league,
    standings: { table: chrono.table, playerRecord: playerRow },
    europeanCampaign,
    internationalSeason,
    domesticCupResult,
    individualAwards,
    attributeChanges,
    previousRating,
    newRating,
    performanceScore,
    developmentResult,
  };
}
