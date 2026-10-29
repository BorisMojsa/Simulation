/**
 * Shared dated match-day processing for the user player.
 * Used by league / cup / continental / international chronological paths.
 */
import { simulateMatch, finalizePlayerMatchStats } from "./matchEngine.js";
import { resolvePlayerParticipation } from "./playerSelection.js";
import {
  advanceHealth,
  applyInjury,
  computeRiskMultiplier,
  isAvailable,
  sampleInjuryFromExposure,
} from "./playerHealth.js";
import { advanceStateBetweenDates, updateFormFromObservation, updateFatigue } from "./playerState.js";
import { refreshAbilityCaches } from "./playerAbility.js";
import { effectiveTeamStrength } from "./teamStrength.js";
import { applyMatchFormUpdate, getWorldState } from "./worldState.js";
import { resolveValidatedClubSide, resolvePlayingStintAt } from "./playingRegistration.js";

/** Season-level clean-sheet eligible roles (60-minute threshold). */
const CLEAN_SHEET_ROLES = new Set(["GK", "CB", "RB", "LB", "CDM"]);

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
 * @param {string|null} opts.editionId competition edition identity when known
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
  editionId = null,
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

  // Hard gate: club sides must match dated playing registration.
  let validatedSide = playerSide || null;
  if (validatedSide && player && teamType === "club") {
    const resolved = resolveValidatedClubSide({ player, home, away, date, teamType });
    if (resolved !== validatedSide) {
      validatedSide = null;
    }
  }

  if (validatedSide && player) {
    if (lastDate) advanceStateBetweenDates(player, lastDate, date);
    advanceHealth(player, date);
    refreshAbilityCaches(player);

    const team = validatedSide === "home" ? home : away;
    const teamProfile = effectiveTeamStrength(team, { worldState: world }).profile;
    participation = resolvePlayerParticipation(player, {
      date,
      teamProfile,
      matchDuration,
      competitionPriority,
      rng: selRng,
    });
    minutes = participation.minutes;
    player.matchParticipation = { ...participation, date, matchDuration };

    // Pre-kickoff training injury must resolve BEFORE confirming played minutes.
    // Do not assume eventMinuteFraction exists on the injury sampler.
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

    // Reconcile availability after any same-date training injury.
    if (!isAvailable(player.health, date)) {
      minutes = 0;
      participation = {
        ...participation,
        minutes: 0,
        started: false,
        available: false,
        nonParticipationReason: player.health?.activeInjury ? "injured" : "unavailable",
        role: "unavailable",
      };
      player.matchParticipation = { ...participation, date, matchDuration };
    }
  }

  let match = simulateMatch(home, away, {
    playerSide: validatedSide,
    player: validatedSide ? player : null,
    competition,
    venue,
    worldState: world,
    rng,
    competitionId,
    fixtureId,
    playerMinutes: validatedSide ? minutes : null,
    matchDuration,
    date,
  });

  if (typeof resolveKnockout === "function") {
    match = resolveKnockout(match, { player: validatedSide ? player : null, rng });
  }

  match.date = date;
  match.competitionType = competitionType;
  match.competitionId = match.competitionId ?? competitionId;
  match.editionId = editionId ?? match.editionId ?? null;
  match.playerSide = validatedSide;
  applyMatchFormUpdate(world, match);

  let ledgerRecord = null;
  if (validatedSide && player && participation) {
    // After KO/ET/pens, sync local minutes + participation before exposure/form.
    const finalizedMinutes = Number(match.playerStats?.minutes);
    if (Number.isFinite(finalizedMinutes) && finalizedMinutes >= 0) {
      minutes = finalizedMinutes;
      participation = { ...participation, minutes };
      player.matchParticipation = {
        ...(player.matchParticipation || {}),
        ...participation,
        date,
        matchDuration: Math.max(matchDuration, minutes > 90 ? 120 : matchDuration),
        minutes,
      };
    }

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
          // Reconcile user event attribution/stats with shortened participation
          // without resimulating the team result: drop later user-involved events
          // and recount. Keep team goals/scoreline intact.
          if (Array.isArray(match.events)) {
            const until = minutes + 2;
            match.events = match.events.map((e) => {
              if (!e?.playerInvolved) return e;
              if ((e.minute || 0) > until) {
                return { ...e, playerInvolved: false, label: e.label === player.name ? "Teammate" : e.label };
              }
              return e;
            });
          }
          match.playerStats.played = minutes > 0;
          match = finalizePlayerMatchStats(match, player, rng);
          participation = { ...participation, minutes };
          player.matchParticipation = {
            ...(player.matchParticipation || {}),
            ...participation,
            date,
            minutes,
          };
        }
        applyInjury(player, inj);
        match.injuryEventIds = [inj.eventId];
      }
      if (player.state) updateFatigue(player.state, { minutes });
      if (match.playerStats?.rating != null) {
        const teamEff = validatedSide === "home" ? match.effectiveStrength.home : match.effectiveStrength.away;
        const oppEff = validatedSide === "home" ? match.effectiveStrength.away : match.effectiveStrength.home;
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
    const sideClub = validatedSide === "home" ? home : away;
    const conceded =
      validatedSide === "home"
        ? match.matchAwayGoals ?? match.awayGoals
        : match.matchHomeGoals ?? match.homeGoals;
    const playedMinutes = match.playerStats.minutes || 0;
    // Season policy: GK/CB/RB/LB/CDM with ≥60 minutes. Known false ≠ unknown.
    const cleanSheetEligible =
      CLEAN_SHEET_ROLES.has(player.position) && playedMinutes >= 60;
    const cleanSheet = cleanSheetEligible ? Number(conceded) === 0 : null;
    const nationTeamId =
      validatedSide === "home"
        ? home.nationId || home.name || player.nationality
        : away.nationId || away.name || player.nationality;
    const opponent = validatedSide === "home" ? away : home;
    const stint = teamType === "club" ? resolvePlayingStintAt(player, date) : null;
    const validatedTeamId =
      teamType === "national"
        ? nationTeamId
        : sideClub.clubId || sideClub.name || null;
    match.playerClubId = validatedTeamId;
    ledgerRecord = {
      matchId: fixtureId || match.fixtureId || `${competitionId}:${date}`,
      date,
      competitionId,
      competitionType,
      editionId: editionId ?? match.editionId ?? null,
      competitionEditionId: editionId ?? match.editionId ?? null,
      teamType,
      teamId: validatedTeamId,
      stintId: stint?.stintId || null,
      opponentId:
        teamType === "national"
          ? opponent.nationId || opponent.name
          : opponent.clubId || opponent.name || opponent.nationId,
      positionPlayed: player.position,
      position: player.position,
      selected: Boolean(participation.selected),
      started: Boolean(participation.started),
      minutes: playedMinutes,
      availableMinutes: match.playerStats.minutes > 90 ? match.playerStats.minutes : matchDuration,
      matchDuration,
      available: Boolean(participation.available),
      nonParticipationReason: participation.nonParticipationReason || null,
      goals: ps.goals || 0,
      assists: ps.assists || 0,
      cleanSheetEligible,
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

  return { match, participation, ledgerRecord, date, playerSide: validatedSide };
}
