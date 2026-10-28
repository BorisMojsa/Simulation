import { POSITION_PROFILES, STATS_KEYS } from "../config/playerConfig.js";
import { getDisplayAttributeKeys } from "./playerAbility.js";
import { ensurePlayerModel } from "./playerModelMigration.js";
import {
  alreadyAppliedLearningForPeriod,
  developSeason,
  developmentPeriodId,
  ensureLearningPeriodLedger,
  stableCareerId,
} from "./playerDevelopmentModel.js?v=88";
import { getOrUpdateForecast } from "./playerPotential.js";
import { createEmptyLedger, recordMatchObservation, aggregateSeason } from "./playerSeasonLedger.js";
import { createStreamRng } from "./rng.js";
import { refreshAbilityCaches } from "./playerAbility.js?v=88";
import { periodSceneContribution } from "./seniorCareerScenarios.js?v=88";
import {
  applyDivisionMovement,
  divisionMoveSlots,
  findSisterLeagues,
  qualificationForPosition,
} from "./leaguePhase.js";
import { simulateChronologicalSeason, resumeChronologicalSeason } from "./chronologicalSeason.js?v=89";
import { findLeagueById } from "./destinationSchedule.js?v=81";
import { evaluateSeasonAwards } from "./individualAwards.js?v=85";
import {
  buildSeasonEvidence,
  evidenceToDevelopmentContext,
  attachRecognitionToEvidence,
} from "./seasonEvidence.js?v=85";
import { clubNameForDisplay, clamp, pickRandom, randFloat } from "../utils/helpers.js";
import { applySeasonDevelopment, attachClubIdentity, ensureWorldState, getWorldState } from "./worldState.js";
import {
  ensureContractAuthority,
  assertPlayableRegistration,
  applyContractExpiryAtBoundary,
  advanceFreeAgentPeriod,
  isFreeAgent,
  selectNextCareerAction,
} from "./contractLifecycle.js";
import { endLoan } from "./loanMarket.js";
import {
  playerEntitledToClubHonor,
  playingStintsForEvidence,
  ensurePlayingStints,
} from "./playingRegistration.js";

/** Legacy 0–100 adapter for awards/transfers — not used for durable development. */
export function legacyPerformanceScoreAdapter({ reliableSignal, avgMatchRating, appearances }) {
  const signal = Number(reliableSignal) || 0;
  const ratingPart = avgMatchRating != null ? (avgMatchRating - 6.5) * 18 : 0;
  const appsPart = clamp((appearances || 0) / 30, 0, 1) * 8;
  return clamp(62 + signal * 28 + ratingPart + appsPart, 20, 98);
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
  ensureContractAuthority(player);

  // Settle expired loans at the season boundary before attaching fixtures.
  if (
    player.activeLoan?.status === "active" &&
    player.activeLoan.endSeason != null &&
    (player.seasons?.length ?? 0) >= player.activeLoan.endSeason
  ) {
    endLoan(player, isFreeAgent(player) || !assertPlayableRegistration(player).ok ? "expiry" : "return");
  }

  // Free agent / expired: no club football — train/wait and open a market review.
  const playable = assertPlayableRegistration(player);
  if (!playable.ok && playable.mode === "free-agent" && !opts.checkpoint) {
    const wait = advanceFreeAgentPeriod(player, { seasons: 1 });
    return {
      season: player.seasons[player.seasons.length - 1],
      freeAgent: true,
      performanceScore: 55,
      nextAction: selectNextCareerAction(player),
      wait,
    };
  }

  if (player.club && !player.club.isAcademy) {
    player.club = attachClubIdentity(player.club);
  }
  const profile = POSITION_PROFILES[player.position] || POSITION_PROFILES.DEFAULT;
  const seasonIndex = player.seasons.length;
  const seasonId = `season-${seasonIndex + 1}`;
  const storedStatus = opts.checkpoint?.status || player.seasonCheckpoint?.status;
  const resuming = Boolean(
    opts.checkpoint || storedStatus === "awaiting_decision" || storedStatus === "awaiting_scenario"
  );
  if (!resuming && player.development?.lastProcessedSeasonId === seasonId) {
    throw new Error(`simulateSeason: season ${seasonId} already applied`);
  }
  const periodId = developmentPeriodId(player, { seasonIndex });
  // Preserve the original season-start baseline across pause/resume.
  if (!resuming || !player.development?.seasonStartBaseline?.[periodId]) {
    if (!player.development.seasonStartBaseline || typeof player.development.seasonStartBaseline !== "object") {
      player.development.seasonStartBaseline = {};
    }
    refreshAbilityCaches(player);
    player.development.seasonStartBaseline[periodId] = {
      rating: player.rating,
      baseOverallRaw: player.baseOverallRaw,
      attributes: { ...player.attributes },
      potentialForecast: player.potentialForecast ? { ...player.potentialForecast } : null,
    };
  }
  const baseline = player.development.seasonStartBaseline[periodId];
  const previousRating = baseline.rating;
  const previousBaseRaw = baseline.baseOverallRaw;
  const previousAttributes = { ...baseline.attributes };
  const previousForecast = baseline.potentialForecast ? { ...baseline.potentialForecast } : null;
  ensureLearningPeriodLedger(player, periodId);

  // Age advances only when the season completes (not at a January pause).
  const age = player.age + 1;
  if (!player.club?.league) {
    // Should have been caught by free-agent path; refuse random-league fallback.
    const wait = advanceFreeAgentPeriod(player, { seasons: 1 });
    return {
      season: player.seasons[player.seasons.length - 1],
      freeAgent: true,
      performanceScore: 55,
      nextAction: selectNextCareerAction(player),
      wait,
    };
  }
  const league = leagueLookup.get(player.club.league) || pickRandom(leagues);

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
    storedCheckpoint?.status === "awaiting_decision" ||
    storedCheckpoint?.status === "awaiting_scenario"
      ? resumeChronologicalSeason({ ...chronoOpts, checkpoint: storedCheckpoint })
      : simulateChronologicalSeason(chronoOpts);

  if (chrono.status === "awaiting_decision" || chrono.status === "awaiting_scenario") {
    // Do not finalize development, history, or age. Caller must resume after the user chooses.
    const ck = chrono.checkpoint || {};
    return {
      awaitingDecision: chrono.status === "awaiting_decision",
      awaitingScenario: chrono.status === "awaiting_scenario",
      checkpoint: chrono.checkpoint,
      decision: chrono.decision || null,
      offers: chrono.offers || [],
      pendingSeniorScenario: chrono.pendingSeniorScenario || chrono.checkpoint?.pendingSeniorScenario || null,
      partialPlayerMatchStats: chrono.partialPlayerMatchStats,
      // Partial fixtures for the live simulation dashboard (segmented delivery).
      partialLeagueAllMatches: ck.leagueAllMatches || [],
      partialLeaguePlayerMatches: ck.leaguePlayerMatches || [],
      partialTableRecords: ck.records || null,
      chronology: chrono.chronology || null,
      seasonIndex,
      seasonId,
      league,
    };
  }

  for (const rec of chrono.ledgerRecords || []) {
    recordMatchObservation(ledger, { ...rec, seasonId });
  }

  // Active playing league (borrower after a cross-league loan/transfer), not employment.
  const playingLeague =
    chrono.activeLeague ||
    findLeagueById(player.club?.leagueId) ||
    leagueLookup.get(player.club.league) ||
    league;
  const sisters = findSisterLeagues(playingLeague, leagues);
  const { promoteSlots, relegateSlots } = divisionMoveSlots(playingLeague, sisters);

  chrono.table.forEach((row) => {
    row.qualification = qualificationForPosition(row.position, playingLeague, sisters);
    if (sisters.higher && row.position <= promoteSlots) row.divisionMove = "promoted";
    if (sisters.lower && row.position > chrono.table.length - relegateSlots) row.divisionMove = "relegated";
  });

  const playerRow = chrono.playerRecord;
  if (playerRow) {
    playerRow.qualification = qualificationForPosition(playerRow.position, playingLeague, sisters);
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
  const domesticCupCampaigns =
    Array.isArray(chrono.domesticCupCampaigns) && chrono.domesticCupCampaigns.length
      ? chrono.domesticCupCampaigns
      : domesticCupResult
        ? [domesticCupResult]
        : [];
  const europeanCampaign = chrono.europeanCampaign;
  const internationalSeason = chrono.internationalSeason;

  const cupPlayerMatches = domesticCupCampaigns.flatMap((c) => c?.playerMatches || []);
  const clubRated = [
    ...(chrono.playerMatches || []),
    ...cupPlayerMatches,
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

  // Freeze pre-development ability/context, then trophies → awards → development once.
  const seasonStartAge = age - 1;
  const preDevOverall = player.baseOverallRaw;

  ensurePlayingStints(player);
  const creditedHonorKeys = player.creditedHonorKeys || (player.creditedHonorKeys = []);
  const trophies = [];
  const playingClubForLeague = player.playingClubId || player.club?.clubId || null;
  if (standing && standing.position === 1) {
    const leagueHonorKey = `league:${seasonId}:${playingLeague.leagueId || playingLeague.name}:${playingClubForLeague || "club"}`;
    if (!creditedHonorKeys.includes(leagueHonorKey)) {
      player.careerHonors.leagueTitles += 1;
      creditedHonorKeys.push(leagueHonorKey);
      trophies.push({
        kind: "league",
        label: `${playingLeague.displayName ?? playingLeague.name} Champions`,
        competition: playingLeague.displayName ?? playingLeague.name,
        simKey: playingLeague.name,
        winningClubId: playingClubForLeague,
        editionId: seasonId,
      });
    }
  }
  for (const cupCampaign of domesticCupCampaigns) {
    const cupWinnerId = cupCampaign?.winningClubId || null;
    if (
      !cupCampaign ||
      !cupWinnerId ||
      !playerEntitledToClubHonor(player, {
        winningClubId: cupWinnerId,
        competitionId: cupCampaign.name,
        ledgerRecords: chrono.ledgerRecords,
        playerMatches: cupCampaign.playerMatches,
        requireContribution: true,
      })
    ) {
      continue;
    }
    const cupName = cupCampaign.name || `${playingLeague.nation} Cup`;
    const cupHonorKey = `cup:${seasonId}:${cupName}:${cupWinnerId}`;
    if (!creditedHonorKeys.includes(cupHonorKey)) {
      player.careerHonors.domesticCups += 1;
      creditedHonorKeys.push(cupHonorKey);
      trophies.push({
        kind: "cup",
        label: `${cupName} Winners`,
        competition: cupName,
        simKey: cupName,
        winningClubId: cupWinnerId,
        editionId: seasonId,
      });
    }
  }
  const europeWinnerId = europeanCampaign?.winningClubId || null;
  const europeEntitled =
    Boolean(europeanCampaign?.qualified !== false && europeWinnerId) &&
    playerEntitledToClubHonor(player, {
      winningClubId: europeWinnerId,
      competitionId: europeanCampaign.competitionId || europeanCampaign.competition,
      ledgerRecords: chrono.ledgerRecords,
      playerMatches: europeanCampaign.playerMatches,
      requireContribution: true,
    });
  if (europeanCampaign && typeof europeanCampaign === "object") {
    europeanCampaign.playerEntitled = europeEntitled;
  }
  if (europeEntitled) {
    const contHonorKey = `continental:${europeanCampaign.editionId || seasonId}:${europeWinnerId}`;
    if (!creditedHonorKeys.includes(contHonorKey)) {
      player.careerHonors.europeanTitles += 1;
      creditedHonorKeys.push(contHonorKey);
      trophies.push({
        kind: "continental",
        label: `${europeanCampaign.competition} Winners`,
        competition: europeanCampaign.competition,
        simKey: europeanCampaign.competition,
        winningClubId: europeWinnerId,
        editionId: europeanCampaign.editionId || null,
      });
    }
  }
  if (internationalSeason?.primary?.won) {
    if (!player.careerHonors.internationalTitles) player.careerHonors.internationalTitles = 0;
    const intlName = internationalSeason.primary.name;
    const intlHonorKey = `intl:${seasonId}:${intlName}`;
    if (!creditedHonorKeys.includes(intlHonorKey)) {
      player.careerHonors.internationalTitles += 1;
      creditedHonorKeys.push(intlHonorKey);
      trophies.push({
        kind: "international",
        label: `${intlName} Winners`,
        competition: intlName,
        simKey: intlName,
      });
    }
  }

  const evidence = buildSeasonEvidence(player, {
    aggregate: agg,
    ledger,
    league: playingLeague,
    standing,
    table: chrono.table,
    trophies,
    seasonId,
    seasonStartAge,
    goals,
    assists,
    cleanSheets,
    leagueGoals: agg.byCompetitionType?.league?.goals ?? goals,
    leagueCleanSheets: cleanSheets,
    seasonDays: 300,
    playingStints: playingStintsForEvidence(player),
  });

  const awardRng = createStreamRng(stableCareerId(player), `awards:${seasonId}`);
  const awardResult = evaluateSeasonAwards({
    player,
    evidence,
    standing,
    league: playingLeague,
    leagueLookup,
    table: chrono.table,
    trophies,
    rng: awardRng,
    seasonId,
    seasonStartAge,
  });
  const individualAwards = awardResult.awardNames || [];
  const awardRecords = awardResult.records || [];
  attachRecognitionToEvidence(evidence, awardRecords);

  // Age advances once per simulated year after the campaign, before development curves.
  player.age = age;

  const envProxy = clamp(
    (evidence.environmentProxy || 1) * (0.9 + 0.1 * (evidence.challengeRelativeToAbility || 1)),
    0.55,
    1.4,
  );
  const devCtx = evidenceToDevelopmentContext(evidence, { environmentMultiplier: envProxy });
  const devRng = createStreamRng(stableCareerId(player), `development:${seasonId}`);
  const already = alreadyAppliedLearningForPeriod(player, periodId);
  const developmentResult = developSeason(player, {
    elapsedYears: 1,
    ...devCtx,
    rng: devRng,
    seasonId,
    alreadyAppliedLearningGain: already,
  });

  // Mark period finalized; clear transient academy counter if any remain.
  const periodLedger = ensureLearningPeriodLedger(player, periodId);
  periodLedger.finalized = true;
  if (player.development) player.development.academyGrowthApplied = 0;
  const sceneContribution = periodSceneContribution(player, periodId);

  getOrUpdateForecast(player, { sampleCount: 48 });
  refreshAbilityCaches(player);

  const newRating = player.rating;
  const ratingChange = newRating - previousRating;

  player.careerTotals.matches += agg.combined.appearances;
  player.careerTotals.goals += goals;
  player.careerTotals.assists += assists;
  player.careerTotals.cleanSheets += cleanSheets;

  if (individualAwards.length) player.careerHonors.individualAwards += individualAwards.length;
  void preDevOverall;

  const honors = trophies.length
    ? trophies[0].label
    : standing
      ? standing.qualification || null
      : null;

  const leagueMatchSegments =
    chrono.leagueMatchSegments ||
    (() => {
      const segs = [];
      for (const m of chrono.playerMatches || []) {
        const key = m.leagueContextId || m.competitionId || playingLeague.leagueId;
        let seg = segs.find((s) => s.key === key && s.segment === (m.historySegment || "destination"));
        if (!seg) {
          const isOrigin = m.historySegment === "origin";
          const labelBase = m.leagueContextName || playingLeague.displayName || playingLeague.name;
          seg = {
            key,
            segment: m.historySegment || "destination",
            leagueId: key,
            leagueDisplay: labelBase,
            label: isOrigin ? `${labelBase} · before move` : labelBase,
            matches: [],
          };
          segs.push(seg);
        }
        seg.matches.push(m);
      }
      return segs;
    })();

  const season = {
    seasonNumber: seasonIndex + 1,
    age,
    club: player.club.name,
    clubDisplay: clubNameForDisplay(player.club),
    clubId: player.club.clubId,
    employmentClubId: player.employmentClubId || null,
    playingClubId: player.playingClubId || player.club?.clubId || null,
    league: playingLeague.name,
    leagueDisplay: playingLeague.displayName ?? playingLeague.name,
    leagueId: playingLeague.leagueId,
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
    developmentBreakdown: developmentResult?.breakdown || null,
    breakthrough: Boolean(developmentResult?.breakthrough?.occurred),
    sceneDevelopment: {
      periodId,
      grossPositive: sceneContribution.scenePositive,
      grossNegative: sceneContribution.sceneNegative,
      net: sceneContribution.net,
      eventCount: sceneContribution.eventCount,
      positiveLearningUsedBeforeSeasonDev: already,
    },
    seasonEvidence: {
      seasonP: evidence.seasonP,
      reliability: evidence.reliability,
      minutes: evidence.minutes,
      healthyTrainingFraction: evidence.healthyTrainingFraction,
      competitionStrength: evidence.competitionStrength,
    },
    ledgerSummary: {
      club: agg.club,
      international: agg.international,
      reliableSignal: agg.reliableSignal,
      reliability: agg.reliability,
      seasonP: agg.seasonP,
      nonParticipation: agg.nonParticipation,
    },
    playerModelVersion: player.playerModelVersion,
    developmentModelVersion: player.developmentModelVersion,
    standing,
    honors,
    europeanCampaign,
    internationalSeason,
    domesticCupResult,
    domesticCupCampaigns,
    individualAwards,
    awardRecords,
    trophies,
    divisionMove: null,
    leagueMatches: chrono.playerMatches,
    leagueAllMatches: chrono.allMatches || [],
    leagueMatchSegments,
    chronology: chrono.chronology || null,
  };

  player.seasons.push(season);
  player.latestStanding = standing
    ? {
        league: playingLeague.name,
        leagueDisplay: playingLeague.displayName ?? playingLeague.name,
        leagueId: playingLeague.leagueId,
        table: chrono.table,
        playerRow,
        seasonNumber: season.seasonNumber,
        seasonId: season.seasonId || seasonId,
      }
    : null;

  // History written under the clubs actually represented; then enforce expiry once.
  player.seasonCheckpoint = null;
  const expiry = applyContractExpiryAtBoundary(player);
  season.contractExpiry = expiry;

  const divisionMove = player.club
    ? applyDivisionMovement(player, playerRow, playingLeague, leagues)
    : null;
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
    league: playingLeague,
    standings: { table: chrono.table, playerRecord: playerRow },
    leagueAllMatches: chrono.allMatches || [],
    leaguePlayerMatches: chrono.playerMatches || [],
    europeanCampaign,
    internationalSeason,
    domesticCupResult,
    domesticCupCampaigns,
    individualAwards,
    attributeChanges,
    previousRating,
    newRating,
    performanceScore,
    developmentResult,
  };
}
