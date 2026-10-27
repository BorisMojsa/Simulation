/**
 * Shared dated match-day processing for the user player.
 * Used by league / cup / continental / international chronological paths.
 */
import { simulateMatch } from "./matchEngine.js";
import { resolvePlayerParticipation } from "./playerSelection.js";
import {
  advanceHealth,
  applyInjury,
  computeRiskMultiplier,
  sampleInjuryFromExposure,
} from "./playerHealth.js";
import { advanceStateBetweenDates, updateFormFromObservation, updateFatigue } from "./playerState.js";
import { refreshAbilityCaches } from "./playerAbility.js";
import { effectiveTeamStrength } from "./teamStrength.js";
import { applyMatchFormUpdate, getWorldState } from "./worldState.js";

function expectedRatingForContext(player, teamEff, oppEff) {
  const base = Number(player.baseOverallRaw ?? player.rating) || 70;
  const teamQ = Number(teamEff?.overall) || 70;
  const oppQ = Number(oppEff?.overall) || 70;
  return Math.max(5.2, Math.min(8.4, Number((6.45 + (base - 70) * 0.012 + (teamQ - oppQ) * 0.008).toFixed(2))));
}

/**
 * Advance recovery/state to `date`, resolve selection/minutes, simulate match,
 * sample injury, update form/fatigue. Returns match + ledger record (or null ledger if no player side).
 *
 * @param {object} opts
 * @param {string|null} opts.lastDate previous event date for state decay
 */
export function processPlayerMatchDay({
  home,
  away,
  player,
  playerSide,
  date,
  lastDate = null,
  competition = "league",
  competitionType = "league",
  competitionId = null,
  fixtureId = null,
  teamType = "club",
  matchDuration = 90,
  competitionPriority = 1,
  venue = "home",
  rng,
  selRng,
  injuryRng,
  worldState = null,
  resolveKnockout = null,
} = {}) {
  const world = worldState || getWorldState();
  let participation = null;
  let minutes = 0;

  if (playerSide && player) {
    if (lastDate) advanceStateBetweenDates(player, lastDate, date);
    advanceHealth(player, date);
    refreshAbilityCaches(player);

    const team = playerSide === "home" ? home : away;
    const teamProfile = effectiveTeamStrength(team, { worldState: world }).profile;
    participation = resolvePlayerParticipation(player, {
      date,
      teamProfile,
      matchDuration,
      competitionPriority,
      rng: selRng,
    });
    minutes = participation.minutes;
    player.matchParticipation = { ...participation, date };

    if (participation.available && !player.health?.activeInjury) {
      const trainInj = sampleInjuryFromExposure({
        hours: competitionType === "international" ? 2 : 4,
        kind: "training",
        riskMultiplier: computeRiskMultiplier(player),
        rng: injuryRng,
        eventId: `${fixtureId || competitionId}:train:${date}`,
        date,
        position: player.position,
      });
      if (trainInj) applyInjury(player, trainInj);
    }
  }

  let match = simulateMatch(home, away, {
    playerSide,
    player: playerSide ? player : null,
    competition,
    venue,
    worldState: world,
    rng,
    competitionId,
    fixtureId,
    playerMinutes: playerSide ? minutes : null,
    matchDuration,
    date,
  });

  if (typeof resolveKnockout === "function") {
    match = resolveKnockout(match, { player: playerSide ? player : null, rng });
  }

  match.date = date;
  match.competitionType = competitionType;
  applyMatchFormUpdate(world, match);

  let ledgerRecord = null;
  if (playerSide && player && participation) {
    if (minutes > 0 && participation.available) {
      const inj = sampleInjuryFromExposure({
        hours: minutes / 60,
        kind: "match",
        riskMultiplier: computeRiskMultiplier(player),
        rng: injuryRng,
        eventId: `${fixtureId || match.fixtureId}:inj`,
        date,
        position: player.position,
      });
      if (inj) {
        if (inj.eventMinuteFraction != null) {
          const cut = Math.max(1, Math.floor(minutes * inj.eventMinuteFraction));
          match.playerStats.minutes = Math.min(match.playerStats.minutes || minutes, cut);
          minutes = match.playerStats.minutes;
        }
        applyInjury(player, inj);
        match.injuryEventIds = [inj.eventId];
      }
      if (player.state) updateFatigue(player.state, { minutes });
      if (match.playerStats?.rating != null) {
        const teamEff = playerSide === "home" ? match.effectiveStrength.home : match.effectiveStrength.away;
        const oppEff = playerSide === "home" ? match.effectiveStrength.away : match.effectiveStrength.home;
        const expected = expectedRatingForContext(player, teamEff, oppEff);
        match.expectedRating = expected;
        const obsScale = 0.6;
        const z = Math.max(-3, Math.min(3, (match.playerStats.rating - expected) / obsScale));
        updateFormFromObservation(player.state, Math.tanh(z / 1.5), minutes, date);
      }
    }

    const ps = match.playerStats || {};
    // Surface participation metadata on the match for the live dashboard cards.
    match.playerStats = {
      ...ps,
      started: Boolean(participation.started),
      selected: Boolean(participation.selected),
      available: Boolean(participation.available),
      nonParticipationReason: participation.nonParticipationReason || null,
      position: player.position,
    };
    const conceded = playerSide === "home" ? match.awayGoals : match.homeGoals;
    const cleanSheet =
      (match.playerStats.minutes || 0) >= 60 && conceded === 0 && player.position === "GK";
    const nationTeamId =
      playerSide === "home"
        ? home.nationId || home.name || player.nationality
        : away.nationId || away.name || player.nationality;
    const opponent =
      playerSide === "home" ? away : home;
    ledgerRecord = {
      matchId: fixtureId || match.fixtureId || `${competitionId}:${date}`,
      date,
      competitionId,
      competitionType,
      teamType,
      teamId:
        teamType === "national"
          ? nationTeamId
          : player.club?.clubId || player.club?.name || player.nationality,
      opponentId:
        teamType === "national"
          ? opponent.nationId || opponent.name
          : opponent.clubId || opponent.name || opponent.nationId,
      positionPlayed: player.position,
      position: player.position,
      selected: Boolean(participation.selected),
      started: Boolean(participation.started),
      minutes: match.playerStats.minutes || 0,
      availableMinutes: matchDuration,
      available: Boolean(participation.available),
      nonParticipationReason: participation.nonParticipationReason || null,
      goals: ps.goals || 0,
      assists: ps.assists || 0,
      cleanSheetEligible: (match.playerStats.minutes || 0) >= 60,
      cleanSheet,
      yellowCards: match.playerStats.yellow || 0,
      redCards: match.playerStats.red || 0,
      rating: match.playerStats.rating,
      matchRating: match.playerStats.rating,
      expectedRating: match.expectedRating ?? null,
      residualScale: 0.6,
      baseOverallBefore: player.baseOverallRaw,
      currentOverallBefore: player.currentOverallRaw,
      injuryEventIds: match.injuryEventIds || [],
      metricEvidence: "simulated-role-rating",
      isInternational: teamType === "national",
    };
  }

  return { match, participation, ledgerRecord, date };
}
