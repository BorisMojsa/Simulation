import { clamp, randFloat, randInt } from "../utils/helpers.js";

/**
 * Simulate one match with minute timeline events.
 * When playerSide is 'home' | 'away', attribute some actions to the user.
 */
export function simulateMatch(home, away, {
  playerSide = null,
  player = null,
  competition = "league",
} = {}) {
  const homeStr = teamStrength(home);
  const awayStr = teamStrength(away);
  const homeBias = 1.08;
  const total = homeStr * homeBias + awayStr;
  const homeShare = (homeStr * homeBias) / total;

  let homeGoals = 0;
  let awayGoals = 0;
  const events = [];

  const expectedGoals = competition === "cup" ? randFloat(1.6, 3.4) : randFloat(1.8, 3.6);
  const goalAttempts = Math.max(0, Math.round(expectedGoals + randFloat(-0.8, 1.2)));

  for (let i = 0; i < goalAttempts; i++) {
    const minute = randInt(3, 92);
    const homeScores = Math.random() < homeShare;
    if (homeScores) homeGoals += 1;
    else awayGoals += 1;

    const scoringSide = homeScores ? "home" : "away";
    const playerScores =
      playerSide === scoringSide && player && Math.random() < playerGoalChance(player, competition);
    const playerAssists =
      !playerScores &&
      playerSide === scoringSide &&
      player &&
      Math.random() < playerAssistChance(player, competition);

    events.push({
      minute,
      type: "goal",
      team: scoringSide,
      playerInvolved: Boolean(playerScores),
      label: playerScores ? player.name : scorerLabel(scoringSide === "home" ? home : away),
    });

    if (playerAssists) {
      events.push({
        minute,
        type: "assist",
        team: scoringSide,
        playerInvolved: true,
        label: player.name,
      });
    } else if (Math.random() < 0.55) {
      events.push({
        minute,
        type: "assist",
        team: scoringSide,
        playerInvolved: false,
        label: scorerLabel(scoringSide === "home" ? home : away),
      });
    }
  }

  // Cards
  const cardCount = randInt(1, 5);
  for (let i = 0; i < cardCount; i++) {
    const minute = randInt(10, 90);
    const team = Math.random() < 0.5 ? "home" : "away";
    const isRed = Math.random() < 0.08;
    const playerCard =
      playerSide === team && player && Math.random() < (isRed ? 0.04 : 0.12);
    events.push({
      minute,
      type: isRed ? "red" : "yellow",
      team,
      playerInvolved: Boolean(playerCard),
      label: playerCard ? player.name : scorerLabel(team === "home" ? home : away),
    });
  }

  events.sort((a, b) => a.minute - b.minute || a.type.localeCompare(b.type));

  const playerStats = {
    played: Boolean(playerSide),
    goals: events.filter((e) => e.type === "goal" && e.playerInvolved).length,
    assists: events.filter((e) => e.type === "assist" && e.playerInvolved).length,
    yellow: events.filter((e) => e.type === "yellow" && e.playerInvolved).length,
    red: events.filter((e) => e.type === "red" && e.playerInvolved).length,
    rating: null,
  };

  const result = {
    home: slimClub(home),
    away: slimClub(away),
    homeGoals,
    awayGoals,
    scoreline: `${homeGoals}-${awayGoals}`,
    events,
    playerSide,
    playerStats,
    competition,
  };

  if (playerSide && player) {
    playerStats.rating = computeMatchRating(result, player);
  }

  return result;
}

/**
 * WhoScored-style 0–10 rating: baseline 6.0, events push up/down.
 * Goals/assists weighted by position; cards and result matter.
 */
export function computeMatchRating(match, player) {
  if (!match?.playerSide || !player) return null;

  let rating = 6.0;
  const ps = match.playerStats || {};
  const pos = player.position || "CM";
  const won =
    (match.playerSide === "home" && match.homeGoals > match.awayGoals) ||
    (match.playerSide === "away" && match.awayGoals > match.homeGoals);
  const drew = match.homeGoals === match.awayGoals;
  const conceded = match.playerSide === "home" ? match.awayGoals : match.homeGoals;
  const scored = match.playerSide === "home" ? match.homeGoals : match.awayGoals;

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
    // Quiet clean sheet vs chaos
    if (conceded === 0) rating += 0.15;
    else rating -= Math.min(0.9, conceded * 0.22);
  } else if (["CB", "RB", "LB", "CDM"].includes(pos) && conceded >= 3) {
    rating -= 0.35;
  }

  // Quiet attacking game as a forward
  if (["ST", "RW", "LW", "CAM"].includes(pos) && !(ps.goals || ps.assists) && scored === 0) {
    rating -= 0.2;
  }

  rating += randFloat(-0.18, 0.18);
  return clamp(parseFloat(rating.toFixed(1)), 4.5, 9.9);
}

function slimClub(club) {
  return {
    name: club.name,
    displayName: club.displayName ?? club.name,
    badge: club.badge ?? null,
    financialTier: club.financialTier ?? 2,
    tier: club.tier ?? 3,
  };
}

function teamStrength(club) {
  const ft = club.financialTier ?? 2;
  const tier = club.tier ?? 3;
  return clamp(ft * 11 + tier * 4 + randFloat(-7, 7), 20, 99);
}

function playerGoalChance(player, competition) {
  const pos = player.position;
  let base = 0.08;
  if (pos === "ST") base = 0.28;
  else if (["RW", "LW", "CAM", "CF"].includes(pos)) base = 0.18;
  else if (["CM", "RM", "LM"].includes(pos)) base = 0.1;
  else if (["CB", "RB", "LB", "CDM"].includes(pos)) base = 0.05;
  else if (pos === "GK") base = 0.01;
  const ratingFactor = clamp((player.rating - 55) / 80, 0, 0.25);
  return clamp(base + ratingFactor + (competition === "cup" ? 0.02 : 0), 0.02, 0.45);
}

function playerAssistChance(player, competition) {
  const pos = player.position;
  let base = 0.08;
  if (["CAM", "CM", "RW", "LW", "RM", "LM"].includes(pos)) base = 0.22;
  else if (pos === "ST") base = 0.12;
  else if (["RB", "LB"].includes(pos)) base = 0.1;
  else if (pos === "GK") base = 0.02;
  const ratingFactor = clamp((player.rating - 55) / 90, 0, 0.2);
  return clamp(base + ratingFactor, 0.02, 0.4);
}

function scorerLabel(club) {
  const names = ["Teammate", "Forward", "Midfielder", "Full-back", "Substitute"];
  return `${club.displayName ?? club.name} ${names[randInt(0, names.length - 1)]}`;
}

export function matchWinnerSide(match) {
  if (match.homeGoals > match.awayGoals) return "home";
  if (match.awayGoals > match.homeGoals) return "away";
  return null;
}

/** Extra-time / pens for cups when drawn. */
export function resolveKnockout(match) {
  let resolved;
  if (match.homeGoals !== match.awayGoals) {
    resolved = {
      ...match,
      winnerSide: matchWinnerSide(match),
      decidedBy: "regulation",
    };
  } else {
    const homeWins = Math.random() < 0.5;
    const events = [...match.events];
    const minute = randInt(93, 120);
    events.push({
      minute,
      type: "goal",
      team: homeWins ? "home" : "away",
      playerInvolved: false,
      label: "Extra time / pens",
    });
    events.sort((a, b) => a.minute - b.minute);
    resolved = {
      ...match,
      homeGoals: homeWins ? match.homeGoals + 1 : match.homeGoals,
      awayGoals: homeWins ? match.awayGoals : match.awayGoals + 1,
      scoreline: homeWins
        ? `${match.homeGoals + 1}-${match.awayGoals} (AET/pens)`
        : `${match.homeGoals}-${match.awayGoals + 1} (AET/pens)`,
      events,
      winnerSide: homeWins ? "home" : "away",
      decidedBy: "extra",
    };
  }

  // Recalculate rating after knockout outcome is known
  if (resolved.playerSide && resolved.playerStats?.played) {
    // player object isn't on match — keep existing rating, nudge by result only
    const won =
      (resolved.playerSide === "home" && resolved.winnerSide === "home") ||
      (resolved.playerSide === "away" && resolved.winnerSide === "away");
    const base = resolved.playerStats.rating ?? 6.5;
    resolved.playerStats = {
      ...resolved.playerStats,
      rating: clamp(parseFloat((won ? base + 0.15 : base - 0.1).toFixed(1)), 4.5, 9.9),
    };
  }
  return resolved;
}
