import { simulateMatch } from "./matchEngine.js";
import { leagueMatchCount } from "./leaguePhase.js";
import { getSimRng, createStreamRng } from "./rng.js";
import { attachClubIdentity, applyMatchFormUpdate, getWorldState } from "./worldState.js";
import { effectiveTeamStrength } from "./teamStrength.js";
import { dateLeagueFixtures, flattenRoundRobinFixtures } from "./seasonCalendar.js?v=89";
import { resolvePlayerParticipation } from "./playerSelection.js";
import { advanceHealth, applyInjury, computeRiskMultiplier, sampleInjuryFromExposure } from "./playerHealth.js";
import { advanceStateBetweenDates, updateFormFromObservation, updateFatigue } from "./playerState.js";
import { refreshAbilityCaches } from "./playerAbility.js";
import { performanceObservationFromMatch } from "./playerSeasonLedger.js";
import { stableCareerId } from "./playerDevelopmentModel.js";
import { assertNotAcademyForSeniorSimulation } from "./academyLifecycle.js";

function ensurePlayerInClubs(league, player) {
  const clubs = [...(league.clubs || [])].map(attachClubIdentity);
  if (!player?.club?.name) return clubs;
  if (player.club.isAcademy) {
    throw new Error(
      "ensurePlayerInClubs: academy club cannot be appended to a senior league roster"
    );
  }
  if (clubs.some((c) => c.name === player.club.name || c.clubId === player.club.clubId)) {
    return clubs;
  }
  clubs.push(attachClubIdentity({
    name: player.club.name,
    displayName: player.club.displayName ?? player.club.name,
    badge: player.club.badge,
    clubId: player.club.clubId,
    financialTier: player.club.financialTier ?? league.financialPower ?? 2,
    tier: league.tier,
    overall: player.club.overall,
  }));
  return clubs;
}

function expectedRatingForContext(player, teamEff, oppEff) {
  const base = Number(player.baseOverallRaw ?? player.rating) || 70;
  const teamQ = Number(teamEff?.overall) || 70;
  const oppQ = Number(oppEff?.overall) || 70;
  // Offline-style fallback: role-agnostic band; not conditioned on goals/score.
  return clampRating(6.45 + (base - 70) * 0.012 + (teamQ - oppQ) * 0.008);
}

function clampRating(v) {
  return Math.max(5.2, Math.min(8.4, Number(v.toFixed(2))));
}

/**
 * Double round-robin; standings from shared match engine only.
 * Player selection/minutes/injuries applied chronologically.
 */
export function simulateLeagueSeason(league, player, performanceScore) {
  const academyGate = assertNotAcademyForSeniorSimulation(player);
  if (!academyGate.ok) {
    throw new Error(academyGate.message || academyGate.reason);
  }
  const rng = getSimRng();
  const selRng = createStreamRng(stableCareerId(player), `selection:league:${player.seasons?.length || 0}`);
  const injuryRng = createStreamRng(stableCareerId(player), `injury:league:${player.seasons?.length || 0}`);
  const world = getWorldState();
  const clubs = ensurePlayerInClubs(league, player).map((c) =>
    attachClubIdentity({
      ...c,
      tier: league.tier,
      league: league.name,
      leagueId: league.leagueId,
      nation: league.nation,
    })
  );

  const seasonStartYear = (player.startYear || 2026) + (player.seasons?.length || 0);
  const fixtures = flattenRoundRobinFixtures(clubs, {
    idPrefix: `lg:${league.leagueId || league.name}:${seasonStartYear}`,
  });
  // Keep matchday order; do not shuffle across dates (avoids club/date double-booking).
  void rng;
  const dated = dateLeagueFixtures(fixtures, seasonStartYear);

  const records = new Map();
  clubs.forEach((c) => {
    const eff = effectiveTeamStrength(c, { worldState: world });
    records.set(c.name, {
      name: c.name,
      displayName: c.displayName,
      badge: c.badge,
      clubId: c.clubId,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      points: 0,
      strength: eff.overall,
      overall: eff.overall,
      attack: eff.attack,
      midfield: eff.midfield,
      defence: eff.defence,
      goalkeeper: eff.goalkeeper,
      strengthTier: eff.tierLabel,
    });
  });

  const allMatches = [];
  const playerMatches = [];
  const ledgerRecords = [];
  const playerMatchStats = { played: 0, goals: 0, assists: 0, yellow: 0, red: 0, minutes: 0, starts: 0 };
  let lastDate = null;

  dated.forEach((fx, index) => {
    const playerIn =
      fx.home.name === player.club.name || fx.away.name === player.club.name
        ? fx.home.name === player.club.name
          ? "home"
          : "away"
        : null;

    let participation = null;
    let minutes = 0;

    if (playerIn) {
      if (lastDate) advanceStateBetweenDates(player, lastDate, fx.date);
      advanceHealth(player, fx.date);
      refreshAbilityCaches(player);

      const teamProfile = effectiveTeamStrength(playerIn === "home" ? fx.home : fx.away, {
        worldState: world,
      }).profile;

      participation = resolvePlayerParticipation(player, {
        date: fx.date,
        teamProfile,
        matchDuration: 90,
        competitionPriority: 1,
        rng: selRng,
      });
      minutes = participation.minutes;
      player.matchParticipation = { ...participation, date: fx.date };

      // Training exposure between matches (approx 6h / week)
      if (participation.available && !player.health?.activeInjury) {
        const trainInj = sampleInjuryFromExposure({
          hours: 4,
          kind: "training",
          riskMultiplier: computeRiskMultiplier(player),
          rng: injuryRng,
          eventId: `${league.leagueId}:train:${index}`,
          date: fx.date,
          position: player.position,
        });
        if (trainInj) applyInjury(player, trainInj);
      }
    }

    const match = simulateMatch(fx.home, fx.away, {
      playerSide: playerIn,
      player: playerIn ? player : null,
      competition: "league",
      venue: "home",
      worldState: world,
      rng,
      competitionId: league.leagueId,
      fixtureId: `${league.leagueId}:md:${index}`,
      playerMinutes: playerIn ? minutes : null,
      date: fx.date,
    });
    match.matchday = Math.floor(index / Math.max(1, Math.floor(clubs.length / 2))) + 1;
    match.round = `Matchday ${match.matchday}`;
    applyMatchFormUpdate(world, match);
    allMatches.push(match);

    // Match injury for participant
    if (playerIn && minutes > 0 && participation?.available) {
      const inj = sampleInjuryFromExposure({
        hours: minutes / 60,
        kind: "match",
        riskMultiplier: computeRiskMultiplier(player),
        rng: injuryRng,
        eventId: `${match.fixtureId}:inj`,
        date: fx.date,
        position: player.position,
      });
      if (inj) {
        // Cut minutes at event if mid-match
        if (inj.eventMinuteFraction != null) {
          const cut = Math.max(1, Math.floor(minutes * inj.eventMinuteFraction));
          match.playerStats.minutes = Math.min(match.playerStats.minutes || minutes, cut);
          minutes = match.playerStats.minutes;
        }
        applyInjury(player, inj);
        match.injuryEventIds = [inj.eventId];
      }
      updateFatigue(player.state || {}, { exposureHours: minutes / 60 });
      if (match.playerStats?.rating != null) {
        const teamEff = playerIn === "home" ? match.effectiveStrength.home : match.effectiveStrength.away;
        const oppEff = playerIn === "home" ? match.effectiveStrength.away : match.effectiveStrength.home;
        const expected = expectedRatingForContext(player, teamEff, oppEff);
        match.expectedRating = expected;
        const obs = performanceObservationFromMatch(match.playerStats.rating, expected);
        updateFormFromObservation(player.state || {}, obs, minutes);
      }
    }

    const home = records.get(fx.home.name);
    const away = records.get(fx.away.name);
    const hg = match.matchHomeGoals ?? match.homeGoals;
    const ag = match.matchAwayGoals ?? match.awayGoals;
    home.played += 1;
    away.played += 1;
    home.goalsFor += hg;
    home.goalsAgainst += ag;
    away.goalsFor += ag;
    away.goalsAgainst += hg;

    if (hg > ag) {
      home.wins += 1;
      home.points += 3;
      away.losses += 1;
    } else if (ag > hg) {
      away.wins += 1;
      away.points += 3;
      home.losses += 1;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.points += 1;
      away.points += 1;
    }

    if (playerIn) {
      playerMatches.push(match);
      const ps = match.playerStats || {};
      if (ps.played && (ps.minutes || 0) > 0) {
        playerMatchStats.played += 1;
        playerMatchStats.minutes += ps.minutes || 0;
        if (participation?.started) playerMatchStats.starts += 1;
        playerMatchStats.goals += ps.goals || 0;
        playerMatchStats.assists += ps.assists || 0;
        playerMatchStats.yellow += ps.yellow || 0;
        playerMatchStats.red += ps.red || 0;
      }

      const conceded = playerIn === "home" ? ag : hg;
      const cleanSheet =
        (ps.minutes || 0) >= 60 && conceded === 0 && player.position === "GK";

      ledgerRecords.push({
        matchId: match.fixtureId,
        seasonId: `s${(player.seasons?.length || 0) + 1}`,
        date: fx.date,
        competitionId: league.leagueId,
        competitionType: "league",
        teamType: "club",
        teamId: player.club.clubId || player.club.name,
        opponentId: (playerIn === "home" ? fx.away : fx.home).clubId || (playerIn === "home" ? fx.away.name : fx.home.name),
        positionPlayed: player.position,
        selected: Boolean(participation?.selected),
        started: Boolean(participation?.started),
        minutes: ps.minutes || 0,
        availableMinutes: 90,
        available: Boolean(participation?.available),
        nonParticipationReason: participation?.nonParticipationReason || null,
        goals: ps.goals || 0,
        assists: ps.assists || 0,
        cleanSheetEligible: (ps.minutes || 0) >= 60,
        cleanSheet,
        yellowCards: ps.yellow || 0,
        redCards: ps.red || 0,
        rating: ps.rating,
        matchRating: ps.rating,
        expectedRating: match.expectedRating ?? null,
        residualScale: 0.6,
        ratingResidualScale: 0.6,
        position: player.position,
        teamQuality: match.effectiveStrength?.[playerIn]?.overall ?? null,
        opponentQuality:
          match.effectiveStrength?.[playerIn === "home" ? "away" : "home"]?.overall ?? null,
        baseOverallBefore: player.baseOverallRaw,
        currentOverallBefore: player.currentOverallRaw,
        injuryEventIds: match.injuryEventIds || [],
        metricEvidence: "simulated-role-rating",
      });
      lastDate = fx.date;
    }
  });

  const table = [...records.values()]
    .map((r) => ({
      ...r,
      goalDiff: r.goalsFor - r.goalsAgainst,
      matches: r.played,
    }))
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.goalDiff - a.goalDiff ||
        b.goalsFor - a.goalsFor ||
        b.strength - a.strength
    )
    .map((row, idx) => ({ ...row, position: idx + 1 }));

  if (world) {
    world.standings.set(league.leagueId || league.name, table);
  }

  return {
    table,
    playerRecord: table.find((r) => r.name === player.club.name) || null,
    playerMatches,
    allMatches,
    playerMatchStats,
    ledgerRecords,
    expectedMatches: leagueMatchCount(league),
    performanceScore,
  };
}
