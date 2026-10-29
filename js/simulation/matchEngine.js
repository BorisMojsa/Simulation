import { clamp } from "../utils/helpers.js";
import { getSimRng } from "./rng.js";
import { effectiveTeamStrength } from "./teamStrength.js";

/**
 * Goal environment coefficients (documented game-design targets, not claimed
 * real-world reproduction). Dixon-Coles joint correction deferred.
 *
 * lambda = BASE_XG * exp(K_ATT*(att-defOpp)/SCALE + K_MID*midEdge/SCALE + venue)
 */
export const XG_MODEL = {
  BASE_XG: 1.25,
  SCALE: 18,
  K_ATT: 0.55,
  K_MID: 0.2,
  K_GK: 0.25,
  HOME_ADV: 0.12,
  ET_FRACTION: 30 / 90,
  MAX_LAMBDA: 3.2,
  MIN_LAMBDA: 0.15,
};

function rngOr(rng) {
  return rng || getSimRng();
}

function poissonSample(lambda, rng) {
  const L = Math.exp(-Math.max(0, lambda));
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rng.random();
  } while (p > L && k < 40);
  return k - 1;
}

function qualityEdge(attack, midfield, oppDefence, oppGk) {
  const attEdge = attack - (oppDefence * 0.72 + oppGk * 0.28);
  const midEdge = midfield - 70;
  return (
    (XG_MODEL.K_ATT * attEdge) / XG_MODEL.SCALE +
    (XG_MODEL.K_MID * midEdge) / XG_MODEL.SCALE -
    (XG_MODEL.K_GK * (oppGk - 70)) / (XG_MODEL.SCALE * 2)
  );
}

/**
 * Expected goals for each side. Neutral venues are symmetric under team swap.
 * Financial tier / league tier are never inputs.
 */
export function expectedGoals(homeEff, awayEff, { venue = "home" } = {}) {
  const homeVenue = venue === "home" ? XG_MODEL.HOME_ADV : 0;
  const awayVenue = venue === "away" ? XG_MODEL.HOME_ADV : 0; // rare; usually home is side A

  let homeLambda =
    XG_MODEL.BASE_XG *
    Math.exp(
      qualityEdge(homeEff.attack, homeEff.midfield, awayEff.defence, awayEff.goalkeeper) +
        homeVenue
    );
  let awayLambda =
    XG_MODEL.BASE_XG *
    Math.exp(
      qualityEdge(awayEff.attack, awayEff.midfield, homeEff.defence, homeEff.goalkeeper) +
        awayVenue
    );

  homeLambda = clamp(homeLambda, XG_MODEL.MIN_LAMBDA, XG_MODEL.MAX_LAMBDA);
  awayLambda = clamp(awayLambda, XG_MODEL.MIN_LAMBDA, XG_MODEL.MAX_LAMBDA);
  return {
    home: Number(homeLambda.toFixed(4)),
    away: Number(awayLambda.toFixed(4)),
  };
}

function slimClub(club, eff) {
  return {
    name: club.name,
    displayName: club.displayName ?? club.name,
    badge: club.badge ?? null,
    clubId: club.clubId || eff?.clubId || null,
    nationId: club.nationId || eff?.nationId || null,
    financialTier: club.financialTier ?? eff?.financialPower ?? 2,
    tier: club.tier ?? 3,
    isNation: Boolean(club.isNation),
    overall: eff?.overall ?? null,
    attack: eff?.attack ?? null,
    midfield: eff?.midfield ?? null,
    defence: eff?.defence ?? null,
    goalkeeper: eff?.goalkeeper ?? null,
    strengthTier: eff?.tierLabel ?? null,
  };
}

/**
 * Role goal rate per 90 (expected individual output), not a share of every team goal.
 * Bounded relative ability / chance / opposition factors.
 */
function roleGoalRatePer90(position) {
  const pos = position || "CM";
  if (pos === "GK") return 0;
  if (pos === "ST") return 0.42;
  if (["RW", "LW", "CAM", "CF"].includes(pos)) return 0.28;
  if (["CM", "RM", "LM"].includes(pos)) return 0.14;
  if (["CB", "RB", "LB", "CDM"].includes(pos)) return 0.06;
  return 0.16;
}

function roleAssistRatePer90(position) {
  const pos = position || "CM";
  if (pos === "GK") return 0.02;
  if (["CAM", "CM", "RW", "LW", "RM", "LM"].includes(pos)) return 0.28;
  if (pos === "ST") return 0.14;
  if (["RB", "LB"].includes(pos)) return 0.12;
  if (pos === "CB" || pos === "CDM") return 0.06;
  return 0.14;
}

function playerAbilityFactor(player) {
  const ovr =
    Number.isFinite(player?.currentOverallRaw)
      ? player.currentOverallRaw
      : Number(player?.currentOverall ?? player?.rating) || 70;
  return clamp(0.75 + (ovr - 70) / 80, 0.55, 1.35);
}

function goalShareForPlayer(player, teamGoalsWhilePlaying, minutes, competition) {
  if (!player || !(minutes > 0) || !(teamGoalsWhilePlaying > 0)) return 0;
  if (player.position === "GK") return 0;
  const expectedUserGoals =
    roleGoalRatePer90(player.position) *
    (minutes / 90) *
    playerAbilityFactor(player) *
    (competition === "cup" || competition === "domesticCup" ? 1.05 : 1) *
    1.0;
  const expectedTeam = Math.max(teamGoalsWhilePlaying, 0.35);
  return clamp(expectedUserGoals / expectedTeam, 0, 0.65);
}

function assistShareForPlayer(player, teamGoalsWhilePlaying, minutes) {
  if (!player || !(minutes > 0) || !(teamGoalsWhilePlaying > 0)) return 0;
  const expectedUserAssists =
    roleAssistRatePer90(player.position) * (minutes / 90) * playerAbilityFactor(player);
  const expectedTeam = Math.max(teamGoalsWhilePlaying, 0.35);
  return clamp(expectedUserAssists / expectedTeam, 0, 0.55);
}

function scorerLabel(club, rng) {
  const names = ["Teammate", "Forward", "Midfielder", "Full-back", "Substitute"];
  return `${club.displayName ?? club.name} ${rng.pick(names)}`;
}

/**
 * Normalize participation minutes.
 * Explicit 0 stays 0 (not treated as omitted). Omitted null/undefined/"" uses
 * omittedFallback. Non-finite or negative values become 0. Positive values are
 * capped by durationMax (regulation or regulation+ET).
 */
export function normalizeParticipationMinutes(raw, { omittedFallback = 0, durationMax = 150 } = {}) {
  const cap = Math.max(0, Number(durationMax) || 0);
  if (raw === null || raw === undefined || raw === "") {
    const fb = Number(omittedFallback);
    return Math.max(0, Math.min(cap, Number.isFinite(fb) ? fb : 0));
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, cap);
}

function participationMinutesOf(player, { omittedFallback = 0, durationMax = 150 } = {}) {
  return normalizeParticipationMinutes(player?.matchParticipation?.minutes, { omittedFallback, durationMax });
}

/**
 * Map a clock minute (0..matchDuration) onto the event-minute span used by
 * buildGoalEvents / buildCardEvents (e.g. 3..92 including stoppage labels).
 */
function eventMinuteForClock(clockMinute, matchDuration, minuteMin, minuteMax) {
  const dur = Math.max(Number(matchDuration) || 90, 1);
  const span = Math.max(minuteMax - minuteMin, 1);
  return minuteMin + (span * clamp(clockMinute, 0, dur)) / dur;
}

/**
 * Whether the user is on the pitch at `minute` for event attribution.
 * Starters cover kickoff→minutes; substitutes enter at (duration - minutes).
 * Extra-time events require completed regulation duration (continued participation).
 * Regulation stoppage labels (90+/92) stay regulation — not extra time.
 */
function playerOnPitchAt(player, playerSide, team, minute, phase, minuteMin = 3, minuteMax = 92) {
  if (!player || playerSide !== team) return false;
  const matchDuration = Number(player.matchParticipation?.matchDuration) || 90;
  const minutes = participationMinutesOf(player, {
    omittedFallback: 0,
    durationMax: Math.max(matchDuration + 30, 150),
  });
  if (!(minutes > 0)) return false;

  if (phase === "extraTime") {
    // Continued ET participation only after completing regulation duration.
    return minutes >= matchDuration && minute >= 91 && minute <= 120;
  }

  const started = player.matchParticipation?.started !== false;
  const regMinutes = Math.min(minutes, matchDuration);

  if (started) {
    // Starter: on pitch from kickoff until credited regulation minutes (stoppage
    // included when the full regulation duration was completed).
    if (regMinutes >= matchDuration) return minute >= minuteMin && minute <= minuteMax;
    const leaveAt = eventMinuteForClock(regMinutes, matchDuration, minuteMin, minuteMax);
    return minute <= leaveAt;
  }

  // Substitute: enters for the final `regMinutes` of regulation.
  if (regMinutes >= matchDuration) return minute >= minuteMin && minute <= minuteMax;
  const entryClock = Math.max(0, matchDuration - regMinutes);
  const enterAt = eventMinuteForClock(entryClock, matchDuration, minuteMin, minuteMax);
  return minute >= enterAt && minute <= minuteMax;
}

function buildGoalEvents({
  home,
  away,
  homeGoals,
  awayGoals,
  playerSide,
  player,
  competition,
  phase,
  minuteMin,
  minuteMax,
  rng,
}) {
  const events = [];
  const schedule = [];
  for (let i = 0; i < homeGoals; i++) schedule.push("home");
  for (let i = 0; i < awayGoals; i++) schedule.push("away");
  // Explicit zero must stay zero; only truly omitted minutes use the legacy 90 default.
  const minutes = participationMinutesOf(player, {
    omittedFallback: player ? Number(player.matchParticipation?.matchDuration) || 90 : 0,
    durationMax: 150,
  });
  // Zero-minute fixtures still burn goal/assist RNG like the historical "treat 0 as 90"
  // path so season-level streams stay aligned; attribution stays gated on real minutes.
  const shareMinutes = minutes > 0 ? minutes : player ? 90 : 0;
  const playerTeamGoals = playerSide === "home" ? homeGoals : playerSide === "away" ? awayGoals : 0;
  // Approximate goals while player is on pitch by minute share (no on-pitch timestamps).
  const goalsWhilePlaying = Math.max(
    0,
    Math.round(playerTeamGoals * clamp(shareMinutes / Math.max(minuteMax, 90), 0, 1))
  );
  const gShare = goalShareForPlayer(
    player,
    Math.max(goalsWhilePlaying, playerTeamGoals * 0.5),
    shareMinutes,
    competition
  );
  const aShare = assistShareForPlayer(
    player,
    Math.max(goalsWhilePlaying, playerTeamGoals * 0.5),
    shareMinutes
  );

  rng.shuffle(schedule).forEach((scoringSide) => {
    const minute = rng.int(minuteMin, minuteMax);
    const onPitch = playerOnPitchAt(player, playerSide, scoringSide, minute, phase, minuteMin, minuteMax);
    // For zero-minute rows, mirror the historical minute-window RNG (which treated 0 as
    // 90 for shares/windows) so career streams stay aligned, but never attribute.
    let playerScores = false;
    let playerAssists = false;
    if (player && playerSide === scoringSide) {
      const rngOnPitch =
        minutes > 0
          ? onPitch
          : playerOnPitchAt(
              { ...player, matchParticipation: { ...(player.matchParticipation || {}), minutes: 90 } },
              playerSide,
              scoringSide,
              minute,
              phase,
              minuteMin,
              minuteMax
            );
      const gRoll = Boolean(rngOnPitch && player.position !== "GK" && rng.chance(gShare));
      const aRoll = Boolean(rngOnPitch && !gRoll && rng.chance(aShare));
      playerScores = Boolean(minutes > 0 && onPitch && gRoll);
      playerAssists = Boolean(minutes > 0 && onPitch && aRoll);
    }

    events.push({
      minute,
      type: "goal",
      team: scoringSide,
      phase,
      playerInvolved: Boolean(playerScores),
      label: playerScores ? player.name : scorerLabel(scoringSide === "home" ? home : away, rng),
    });

    if (playerAssists) {
      events.push({
        minute,
        type: "assist",
        team: scoringSide,
        phase,
        playerInvolved: true,
        label: player.name,
      });
    } else if (rng.chance(0.55)) {
      events.push({
        minute,
        type: "assist",
        team: scoringSide,
        phase,
        playerInvolved: false,
        label: scorerLabel(scoringSide === "home" ? home : away, rng),
      });
    }
  });
  return events;
}

function buildCardEvents({ home, away, playerSide, player, rng, minuteMin = 10, minuteMax = 90 }) {
  const events = [];
  const cardCount = rng.int(1, 5);
  for (let i = 0; i < cardCount; i++) {
    const minute = rng.int(minuteMin, minuteMax);
    const team = rng.chance(0.5) ? "home" : "away";
    const isRed = rng.chance(0.08);
    const minutes = participationMinutesOf(player, { omittedFallback: 0, durationMax: 150 });
    const onPitch = playerOnPitchAt(player, playerSide, team, minute, "regulation");
    // Mirror historical card-roll gating (which ignored minutes) for RNG, then
    // require real on-pitch participation before attributing a user card.
    const rolled =
      playerSide === team && player && rng.chance(isRed ? 0.04 : 0.12);
    const playerCard = Boolean(rolled && minutes > 0 && onPitch);
    events.push({
      minute,
      type: isRed ? "red" : "yellow",
      team,
      phase: "regulation",
      playerInvolved: Boolean(playerCard),
      label: playerCard ? player.name : scorerLabel(team === "home" ? home : away, rng),
    });
  }
  return events;
}

/**
 * Count open-play user events (regulation + extra time). Penalty shootout kicks
 * are excluded from goals/assists/cards.
 */
export function countUserOpenPlayEvents(match) {
  const events = (match?.events || []).filter(
    (e) => e && e.playerInvolved && e.phase !== "penalties"
  );
  return {
    goals: events.filter((e) => e.type === "goal").length,
    assists: events.filter((e) => e.type === "assist").length,
    yellow: events.filter((e) => e.type === "yellow").length,
    red: events.filter((e) => e.type === "red").length,
  };
}

/**
 * Idempotent finalizer: playerStats goals/assists/cards equal counted open-play
 * user events; rating only when minutes > 0. Repeated calls on an unchanged
 * result are a true no-op (stats, rating, and RNG). Re-rates only when minutes
 * or open-play event totals genuinely change (e.g. regulation → ET).
 */
export function finalizePlayerMatchStats(match, player = null, rng = null) {
  if (!match) return match;
  const prev = match.playerStats || {};
  const minutes = normalizeParticipationMinutes(prev.minutes, {
    omittedFallback: 0,
    durationMax: 150,
  });
  const played = Boolean(match.playerSide && player && minutes > 0);
  const counts = played ? countUserOpenPlayEvents(match) : { goals: 0, assists: 0, yellow: 0, red: 0 };
  const nextMinutes = played ? minutes : 0;

  if (
    match.playerStatsFinalized &&
    prev.played === played &&
    prev.minutes === nextMinutes &&
    prev.goals === counts.goals &&
    prev.assists === counts.assists &&
    prev.yellow === counts.yellow &&
    prev.red === counts.red &&
    (played ? prev.rating != null : true)
  ) {
    return match;
  }

  const playerStats = {
    ...prev,
    played,
    minutes: nextMinutes,
    started: played ? Boolean(prev.started ?? player?.matchParticipation?.started) : Boolean(prev.started),
    goals: counts.goals,
    assists: counts.assists,
    yellow: counts.yellow,
    red: counts.red,
    rating: null,
  };
  const next = { ...match, playerStats, playerStatsFinalized: true };
  if (played) {
    playerStats.rating = computeMatchRating(next, player, rng);
  }
  return next;
}

/**
 * WhoScored-style 0–10 rating: baseline 6.0, events push up/down.
 * Requires positive played minutes — zero-minute / bench / injured stay unrated.
 */
export function computeMatchRating(match, player, rng = null) {
  if (!match?.playerSide || !player) return null;
  const mins = Number(match.playerStats?.minutes);
  if (!(mins > 0) || match.playerStats?.played === false) return null;
  const r = rngOr(rng);

  let rating = 6.0;
  const ps = match.playerStats || {};
  const pos = player.position || "CM";
  const matchGoalsHome = match.regulationHomeGoals ?? match.homeGoals;
  const matchGoalsAway = match.regulationAwayGoals ?? match.awayGoals;
  // Use open-play goals (exclude pens) for clean sheets / result feel
  const openHome = match.matchHomeGoals ?? matchGoalsHome;
  const openAway = match.matchAwayGoals ?? matchGoalsAway;

  const won =
    match.winnerSide === match.playerSide ||
    (!match.winnerSide &&
      ((match.playerSide === "home" && openHome > openAway) ||
        (match.playerSide === "away" && openAway > openHome)));
  const drew = openHome === openAway && !match.winnerSide;
  const conceded = match.playerSide === "home" ? openAway : openHome;
  const scored = match.playerSide === "home" ? openHome : openAway;

  const goalW =
    pos === "ST" ? 1.05 : ["RW", "LW", "CAM", "CF"].includes(pos) ? 1.15 : ["CM", "RM", "LM"].includes(pos) ? 1.2 : 1.35;
  const assistW =
    ["CAM", "CM", "RW", "LW", "RM", "LM"].includes(pos) ? 0.85 : pos === "ST" ? 0.65 : 0.75;

  rating += (ps.goals || 0) * goalW;
  rating += (ps.assists || 0) * assistW;
  rating -= (ps.yellow || 0) * 0.35;
  rating -= (ps.red || 0) * 1.6;

  if (won) rating += 0.35;
  else if (drew) rating += 0.1;
  else rating -= 0.25;

  if (["GK", "CB", "RB", "LB", "CDM"].includes(pos) && conceded === 0) rating += 0.45;
  if (pos === "GK") {
    if (conceded === 0) rating += 0.15;
    else rating -= Math.min(0.9, conceded * 0.22);
  } else if (["CB", "RB", "LB", "CDM"].includes(pos) && conceded >= 3) {
    rating -= 0.35;
  }

  if (["ST", "RW", "LW", "CAM"].includes(pos) && !(ps.goals || ps.assists) && scored === 0) {
    rating -= 0.2;
  }

  rating += r.float(-0.18, 0.18);
  return clamp(parseFloat(rating.toFixed(1)), 4.5, 9.9);
}

function formFromWorld(team, worldState) {
  if (!worldState?.form) return 0;
  const id = team.clubId || team.nationId || team.name;
  const entry = worldState.form.get?.(id) || worldState.form[id];
  if (!entry) return 0;
  return clamp(Number(entry.form) || 0, -2.5, 2.5);
}

/**
 * Simulate one match with Poisson goal model + timeline events.
 */
export function simulateMatch(home, away, {
  playerSide = null,
  player = null,
  competition = "league",
  venue = "home",
  worldState = null,
  rng = null,
  competitionId = null,
  fixtureId = null,
  playerMinutes = null,
  matchDuration = 90,
  date = null,
} = {}) {
  const r = rngOr(rng);
  const omittedFallback = playerSide && player ? matchDuration : 0;
  // Regulation boundary caps at matchDuration. ET minutes are added only by
  // resolveKnockout / simulateExtraTime continuation paths.
  const minutes = normalizeParticipationMinutes(
    playerMinutes != null
      ? playerMinutes
      : player?.matchParticipation?.minutes != null
        ? player.matchParticipation.minutes
        : null,
    { omittedFallback, durationMax: Number(matchDuration) || 90 }
  );

  if (player && playerSide) {
    player.matchParticipation = {
      ...(player.matchParticipation || {}),
      minutes,
      matchDuration,
      date,
    };
  }

  const homeEff = effectiveTeamStrength(home, {
    player,
    playerSide,
    side: "home",
    worldState,
    formAdj: formFromWorld(home, worldState),
    playerMinutes: minutes,
    matchDuration,
  });
  const awayEff = effectiveTeamStrength(away, {
    player,
    playerSide,
    side: "away",
    worldState,
    formAdj: formFromWorld(away, worldState),
    playerMinutes: minutes,
    matchDuration,
  });

  // Neutral: neither side gets home advantage; order must not matter.
  const venueMode = venue === "neutral" ? "neutral" : venue === "away" ? "away" : "home";
  const xg =
    venueMode === "neutral"
      ? expectedGoals(homeEff, awayEff, { venue: "neutral" })
      : expectedGoals(homeEff, awayEff, { venue: venueMode === "away" ? "away" : "home" });

  // Fix neutral: expectedGoals only applies HOME_ADV for venue==="home". Good.
  const homeGoals = poissonSample(xg.home, r);
  const awayGoals = poissonSample(xg.away, r);

  let events = [
    ...buildGoalEvents({
      home,
      away,
      homeGoals,
      awayGoals,
      playerSide,
      player,
      competition,
      phase: "regulation",
      minuteMin: 3,
      minuteMax: 92,
      rng: r,
    }),
    ...buildCardEvents({ home, away, playerSide, player, rng: r }),
  ];
  events.sort((a, b) => a.minute - b.minute || a.type.localeCompare(b.type));

  const played = Boolean(playerSide && player && minutes > 0);
  const playerStats = {
    played,
    minutes: played ? minutes : 0,
    started: Boolean(player?.matchParticipation?.started),
    goals: 0,
    assists: 0,
    yellow: 0,
    red: 0,
    rating: null,
  };

  const result = {
    home: slimClub(home, homeEff),
    away: slimClub(away, awayEff),
    homeGoals,
    awayGoals,
    regulationHomeGoals: homeGoals,
    regulationAwayGoals: awayGoals,
    etHomeGoals: 0,
    etAwayGoals: 0,
    matchHomeGoals: homeGoals,
    matchAwayGoals: awayGoals,
    penaltyHome: null,
    penaltyAway: null,
    scoreline: `${homeGoals}-${awayGoals}`,
    events,
    playerSide,
    playerStats,
    competition,
    competitionId,
    fixtureId,
    date,
    venue: venueMode,
    decidedBy: homeGoals === awayGoals ? null : "regulation",
    winnerSide: homeGoals > awayGoals ? "home" : awayGoals > homeGoals ? "away" : null,
    expectedGoals: xg,
    effectiveStrength: { home: homeEff, away: awayEff },
  };

  return finalizePlayerMatchStats(result, player, r);
}

export function matchWinnerSide(match) {
  if (match.winnerSide) return match.winnerSide;
  if (match.homeGoals > match.awayGoals) return "home";
  if (match.awayGoals > match.homeGoals) return "away";
  return null;
}

function simulateExtraTime(match, { player, rng }) {
  const r = rngOr(rng);
  const homeEff = match.effectiveStrength.home;
  const awayEff = match.effectiveStrength.away;
  const xg = expectedGoals(homeEff, awayEff, {
    venue: match.venue === "neutral" ? "neutral" : "home",
  });
  const etHome = poissonSample(xg.home * XG_MODEL.ET_FRACTION, r);
  const etAway = poissonSample(xg.away * XG_MODEL.ET_FRACTION, r);

  const matchDuration = Number(player?.matchParticipation?.matchDuration) || 90;
  const regMinutes = Number(match.playerStats?.minutes) || 0;
  // Only players who completed regulation continue into ET exposure/attribution.
  const continuesIntoEt = Boolean(match.playerSide && player && regMinutes >= matchDuration);
  if (player?.matchParticipation && continuesIntoEt) {
    player.matchParticipation = {
      ...player.matchParticipation,
      minutes: matchDuration + 30,
      matchDuration,
    };
  }

  const etEvents = buildGoalEvents({
    home: match.home,
    away: match.away,
    homeGoals: etHome,
    awayGoals: etAway,
    playerSide: match.playerSide,
    player: continuesIntoEt ? player : null,
    competition: match.competition,
    phase: "extraTime",
    minuteMin: 93,
    minuteMax: 120,
    rng: r,
  });

  const matchHome = match.regulationHomeGoals + etHome;
  const matchAway = match.regulationAwayGoals + etAway;
  const nextStats = continuesIntoEt
    ? { ...(match.playerStats || {}), minutes: matchDuration + 30, played: true }
    : match.playerStats;

  return {
    ...match,
    etHomeGoals: etHome,
    etAwayGoals: etAway,
    homeGoals: matchHome,
    awayGoals: matchAway,
    matchHomeGoals: matchHome,
    matchAwayGoals: matchAway,
    playerStats: nextStats,
    events: [...match.events, ...etEvents].sort((a, b) => a.minute - b.minute || a.type.localeCompare(b.type)),
    expectedGoals: {
      ...match.expectedGoals,
      etHome: Number((xg.home * XG_MODEL.ET_FRACTION).toFixed(4)),
      etAway: Number((xg.away * XG_MODEL.ET_FRACTION).toFixed(4)),
    },
  };
}

/**
 * Penalty shootout — weakly linked to GK quality; not dominated by overall strength.
 * Kick tallies are NOT added to homeGoals/awayGoals / GD / player goals.
 */
export function simulatePenaltyShootout(match, { player = null, rng = null } = {}) {
  const r = rngOr(rng);
  const homeGk = match.effectiveStrength?.home?.goalkeeper ?? 70;
  const awayGk = match.effectiveStrength?.away?.goalkeeper ?? 70;
  // Taker quality ≈ attack; weak effect
  const homeTake = match.effectiveStrength?.home?.attack ?? 70;
  const awayTake = match.effectiveStrength?.away?.attack ?? 70;

  function kickSuccess(taker, oppGk) {
    const p = clamp(0.72 + (taker - oppGk) / 120, 0.55, 0.85);
    return r.chance(p);
  }

  let homePens = 0;
  let awayPens = 0;
  const events = [...match.events];
  let kick = 0;

  // Best of 5, then sudden death
  for (let i = 0; i < 5; i++) {
    kick += 1;
    if (kickSuccess(homeTake, awayGk)) {
      homePens += 1;
      events.push({ minute: 121, type: "penalty_scored", team: "home", phase: "penalties", label: "Penalty" });
    } else {
      events.push({ minute: 121, type: "penalty_missed", team: "home", phase: "penalties", label: "Penalty miss" });
    }
    // Early abort if impossible
    const homeRem = 4 - i;
    const awayRem = 5 - i;
    if (homePens + homeRem < awayPens || awayPens + awayRem < homePens) {
      // still let away take if they haven't and can matter — simplify: always take both of round
    }
    if (kickSuccess(awayTake, homeGk)) {
      awayPens += 1;
      events.push({ minute: 121, type: "penalty_scored", team: "away", phase: "penalties", label: "Penalty" });
    } else {
      events.push({ minute: 121, type: "penalty_missed", team: "away", phase: "penalties", label: "Penalty miss" });
    }
    if (i >= 2) {
      const homeLeft = 4 - i;
      const awayLeft = 4 - i;
      if (homePens > awayPens + awayLeft || awayPens > homePens + homeLeft) break;
    }
  }

  while (homePens === awayPens) {
    if (kickSuccess(homeTake, awayGk)) homePens += 1;
    else {
      /* miss */
    }
    if (kickSuccess(awayTake, homeGk)) awayPens += 1;
    if (homePens !== awayPens) break;
    if (homePens + awayPens > 40) {
      // pathological safeguard
      if (r.chance(0.5)) homePens += 1;
      else awayPens += 1;
      break;
    }
  }

  const winnerSide = homePens > awayPens ? "home" : "away";
  const scoreline = `${match.matchHomeGoals}-${match.matchAwayGoals} (${homePens}-${awayPens} pens)`;

  const resolved = {
    ...match,
    // Keep open-play goals as homeGoals for table / GD consumers
    homeGoals: match.matchHomeGoals,
    awayGoals: match.matchAwayGoals,
    penaltyHome: homePens,
    penaltyAway: awayPens,
    winnerSide,
    decidedBy: "penalties",
    scoreline,
    events,
  };

  // Finalize from open-play events only; shootout kicks never become goals/assists.
  // Zero-minute players remain unrated even after pens.
  return finalizePlayerMatchStats(resolved, player, r);
}

/**
 * Knockout resolution: regulation → optional ET → optional pens.
 * Never invents a goal for "AET/pens".
 */
export function resolveKnockout(match, {
  player = null,
  allowExtraTime = true,
  allowPenalties = true,
  rng = null,
} = {}) {
  if (match.homeGoals !== match.awayGoals) {
    return {
      ...match,
      winnerSide: matchWinnerSide(match),
      decidedBy: "regulation",
      matchHomeGoals: match.regulationHomeGoals ?? match.homeGoals,
      matchAwayGoals: match.regulationAwayGoals ?? match.awayGoals,
    };
  }

  let current = {
    ...match,
    matchHomeGoals: match.regulationHomeGoals ?? match.homeGoals,
    matchAwayGoals: match.regulationAwayGoals ?? match.awayGoals,
  };

  if (allowExtraTime) {
    current = simulateExtraTime(current, { player, rng });
    if (current.homeGoals !== current.awayGoals) {
      current.winnerSide = current.homeGoals > current.awayGoals ? "home" : "away";
      current.decidedBy = "extraTime";
      current.scoreline = `${current.homeGoals}-${current.awayGoals} (aet)`;
      // Goals and assists finalized together from regulation + ET events.
      return finalizePlayerMatchStats(current, player, rng);
    }
  }

  if (allowPenalties) {
    return simulatePenaltyShootout(current, { player, rng });
  }

  return finalizePlayerMatchStats(
    {
      ...current,
      winnerSide: null,
      decidedBy: null,
    },
    player,
    rng
  );
}

/**
 * Two-legged tie. First leg must not trigger ET/pens.
 * Aggregate uses match goals only (no away-goals rule by default).
 */
export function resolveTwoLeggedTie(firstLeg, secondLeg, {
  player = null,
  allowExtraTime = true,
  allowPenalties = true,
  awayGoalsRule = false,
  rng = null,
} = {}) {
  const homeAgg =
    (firstLeg.matchHomeGoals ?? firstLeg.homeGoals) +
    (secondLeg.matchAwayGoals ?? secondLeg.awayGoals);
  // Careful: legs may have swapped home/away. Convention: firstLeg.home is team A at home;
  // secondLeg.home is team B. Callers should pass consistent team pairing.
  // Here we use explicit aggregate from caller-normalized scores when provided.
  const aggA =
    firstLeg.aggregateA != null
      ? firstLeg.aggregateA
      : (firstLeg.homeGoals || 0) + (secondLeg.awayGoals || 0);
  const aggB =
    firstLeg.aggregateB != null
      ? firstLeg.aggregateB
      : (firstLeg.awayGoals || 0) + (secondLeg.homeGoals || 0);

  if (aggA !== aggB) {
    return {
      firstLeg,
      secondLeg,
      aggregate: `${aggA}-${aggB}`,
      winnerSide: aggA > aggB ? "home" : "away", // relative to first-leg home
      decidedBy: "aggregate",
    };
  }

  if (awayGoalsRule) {
    const aAway = secondLeg.awayGoals;
    const bAway = firstLeg.awayGoals;
    if (aAway !== bAway) {
      return {
        firstLeg,
        secondLeg,
        aggregate: `${aggA}-${aggB}`,
        winnerSide: aAway > bAway ? "home" : "away",
        decidedBy: "awayGoals",
      };
    }
  }

  // Aggregate is level: ET (then pens) on the second leg only.
  // winnerSide is always relative to first-leg home (team A), never second-leg orientation.
  const synthetic = {
    ...secondLeg,
    homeGoals: 0,
    awayGoals: 0,
    regulationHomeGoals: 0,
    regulationAwayGoals: 0,
    matchHomeGoals: 0,
    matchAwayGoals: 0,
    events: [...(secondLeg.events || [])],
    effectiveStrength: secondLeg.effectiveStrength,
    venue: secondLeg.venue || "home",
    competition: secondLeg.competition,
    playerSide: secondLeg.playerSide,
    playerStats: secondLeg.playerStats,
  };

  const afterKo = resolveKnockout(synthetic, {
    player,
    allowExtraTime,
    allowPenalties,
    rng,
  });

  const regHome = secondLeg.regulationHomeGoals ?? secondLeg.homeGoals ?? 0;
  const regAway = secondLeg.regulationAwayGoals ?? secondLeg.awayGoals ?? 0;
  const etHome = afterKo.etHomeGoals ?? 0;
  const etAway = afterKo.etAwayGoals ?? 0;
  const resolvedSecond = {
    ...secondLeg,
    regulationHomeGoals: regHome,
    regulationAwayGoals: regAway,
    etHomeGoals: afterKo.etHomeGoals,
    etAwayGoals: afterKo.etAwayGoals,
    homeGoals: regHome + (afterKo.decidedBy === "extraTime" || afterKo.decidedBy === "penalties" ? etHome : 0),
    awayGoals: regAway + (afterKo.decidedBy === "extraTime" || afterKo.decidedBy === "penalties" ? etAway : 0),
    matchHomeGoals: regHome + (afterKo.etHomeGoals || 0),
    matchAwayGoals: regAway + (afterKo.etAwayGoals || 0),
    penaltyHome: afterKo.penaltyHome,
    penaltyAway: afterKo.penaltyAway,
    decidedBy: afterKo.decidedBy,
    events: afterKo.events,
    scoreline: afterKo.scoreline || secondLeg.scoreline,
    // Carry finalized KO playerStats (goals+assists+cards+minutes+rating) onto the second leg.
    playerStats: afterKo.playerStats ?? secondLeg.playerStats,
    winnerSide: afterKo.winnerSide ?? null,
  };

  // Map second-leg winner orientation → first-leg-home relative side.
  // Second-leg home is team B (first-leg away); second-leg away is team A.
  let winnerSide = null;
  if (afterKo.winnerSide === "home") {
    winnerSide = "away"; // second-leg home = team B = first-leg away
  } else if (afterKo.winnerSide === "away") {
    winnerSide = "home"; // second-leg away = team A = first-leg home
  }

  // ET goals on the second leg: second-leg home adds to team B, away to team A.
  const etAdjA = afterKo.decidedBy === "extraTime" || afterKo.decidedBy === "penalties" ? etAway : 0;
  const etAdjB = afterKo.decidedBy === "extraTime" || afterKo.decidedBy === "penalties" ? etHome : 0;

  return {
    firstLeg,
    secondLeg: resolvedSecond,
    aggregate: `${aggA + etAdjA}-${aggB + etAdjB}`,
    aggregateA: aggA + etAdjA,
    aggregateB: aggB + etAdjB,
    winnerSide,
    decidedBy: afterKo.decidedBy === "regulation" ? "aggregate" : afterKo.decidedBy,
    etHomeGoals: afterKo.etHomeGoals,
    etAwayGoals: afterKo.etAwayGoals,
    penaltyHome: afterKo.penaltyHome,
    penaltyAway: afterKo.penaltyAway,
  };
}

/** Display helper for UI: "1-1 (4-3 pens)" etc. */
export function formatMatchScoreline(match, { fromPlayerSide = null } = {}) {
  if (!match) return "";
  if (match.isBye || match.scoreline === "bye") return "bye";
  let home = match.matchHomeGoals ?? match.homeGoals;
  let away = match.matchAwayGoals ?? match.awayGoals;
  if (fromPlayerSide === "away") [home, away] = [away, home];
  let s = `${home}-${away}`;
  if (match.decidedBy === "extraTime") s += " (aet)";
  if (match.decidedBy === "penalties" && match.penaltyHome != null) {
    let ph = match.penaltyHome;
    let pa = match.penaltyAway;
    if (fromPlayerSide === "away") [ph, pa] = [pa, ph];
    s += ` (${ph}-${pa} pens)`;
  }
  return s;
}
