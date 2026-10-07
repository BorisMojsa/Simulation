import { clamp, randFloat } from "../utils/helpers.js";
import { simulateMatch } from "./matchEngine.js?v=45";
import { leagueMatchCount } from "./leaguePhase.js?v=45";

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function ensurePlayerInClubs(league, player) {
  const clubs = [...(league.clubs || [])];
  if (!player?.club?.name) return clubs;
  if (clubs.some((c) => c.name === player.club.name)) return clubs;
  clubs.push({
    name: player.club.name,
    displayName: player.club.displayName ?? player.club.name,
    badge: player.club.badge,
    financialTier: player.club.financialTier ?? league.financialPower ?? 2,
  });
  return clubs;
}

/**
 * Build a double round-robin fixture list and simulate every match.
 * Returns full table, player fixtures (for animation), and player season match stats.
 */
export function simulateLeagueSeason(league, player, performanceScore) {
  const clubs = ensurePlayerInClubs(league, player).map((c) => ({
    name: c.name,
    displayName: c.displayName ?? c.name,
    badge: c.badge,
    financialTier: c.financialTier ?? 2,
    tier: league.tier,
  }));

  const fixtures = [];
  for (let i = 0; i < clubs.length; i++) {
    for (let j = 0; j < clubs.length; j++) {
      if (i === j) continue;
      fixtures.push({ home: clubs[i], away: clubs[j] });
    }
  }
  const ordered = shuffle(fixtures);

  const records = new Map();
  clubs.forEach((c) => {
    records.set(c.name, {
      name: c.name,
      displayName: c.displayName,
      badge: c.badge,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      points: 0,
      strength: c.financialTier * 12 + league.tier * 4 + randFloat(-6, 6),
    });
  });

  // Nudge player club strength by form
  const playerRec = records.get(player.club.name);
  if (playerRec) {
    playerRec.strength += (player.rating - 65) * 0.3 + (performanceScore - 65) * 0.2;
  }

  const allMatches = [];
  const playerMatches = [];
  const playerMatchStats = { played: 0, goals: 0, assists: 0, yellow: 0, red: 0 };

  ordered.forEach((fx, index) => {
    const playerIn =
      fx.home.name === player.club.name || fx.away.name === player.club.name
        ? fx.home.name === player.club.name
          ? "home"
          : "away"
        : null;

    const match = simulateMatch(fx.home, fx.away, {
      playerSide: playerIn,
      player: playerIn ? player : null,
      competition: "league",
    });
    match.matchday = Math.floor(index / Math.max(1, Math.floor(clubs.length / 2))) + 1;
    match.round = `Matchday ${match.matchday}`;
    allMatches.push(match);

    const home = records.get(fx.home.name);
    const away = records.get(fx.away.name);
    home.played += 1;
    away.played += 1;
    home.goalsFor += match.homeGoals;
    home.goalsAgainst += match.awayGoals;
    away.goalsFor += match.awayGoals;
    away.goalsAgainst += match.homeGoals;

    if (match.homeGoals > match.awayGoals) {
      home.wins += 1;
      home.points += 3;
      away.losses += 1;
    } else if (match.awayGoals > match.homeGoals) {
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
      playerMatchStats.played += 1;
      playerMatchStats.goals += match.playerStats.goals;
      playerMatchStats.assists += match.playerStats.assists;
      playerMatchStats.yellow += match.playerStats.yellow;
      playerMatchStats.red += match.playerStats.red;
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

  return {
    table,
    playerRecord: table.find((r) => r.name === player.club.name) || null,
    playerMatches,
    allMatches,
    playerMatchStats,
    expectedMatches: leagueMatchCount(league),
  };
}
