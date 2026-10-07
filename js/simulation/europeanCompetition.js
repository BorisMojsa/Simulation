import { LEAGUES } from "../data/leagues.js";
import { clamp, pickRandom, randFloat } from "../utils/helpers.js";
import { isEuropeanQualificationLeague } from "./leaguePhase.js?v=45";
import { resolveKnockout, simulateMatch } from "./matchEngine.js?v=45";

const EUROPE_NATIONS = new Set([
  "England",
  "Spain",
  "Germany",
  "Italy",
  "France",
  "Portugal",
  "Netherlands",
  "Belgium",
  "Denmark",
  "Turkey",
  "Norway",
  "Poland",
  "Czech Republic",
  "Croatia",
  "Serbia",
]);

const CONMEBOL_NATIONS = new Set(["Brazil", "Argentina", "Colombia", "Ecuador"]);
const CONCACAF_NATIONS = new Set(["Mexico", "United States"]);

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function slimFromLeagueClub(club, league) {
  return {
    name: club.name,
    displayName: club.displayName ?? club.name,
    badge: club.badge ?? null,
    financialTier: club.financialTier ?? league.financialPower ?? 2,
    tier: league.tier ?? 3,
    nation: league.nation,
    league: league.name,
  };
}

/** Strong clubs from each nation's top flight only. */
function clubsFromNations(nations, { excludeName = "", limit = 48, minFinancial = 1 } = {}) {
  const topByNation = new Map();
  LEAGUES.filter((l) => nations.has(l.nation)).forEach((league) => {
    const cur = topByNation.get(league.nation);
    if (!cur || (league.tier ?? 0) > (cur.tier ?? 0)) {
      topByNation.set(league.nation, league);
    }
  });

  const out = [];
  const seen = new Set();
  [...topByNation.values()]
    .sort((a, b) => (b.tier ?? 0) - (a.tier ?? 0) || (b.financialPower ?? 0) - (a.financialPower ?? 0))
    .forEach((league) => {
      [...league.clubs]
        .sort((a, b) => (b.financialTier ?? 0) - (a.financialTier ?? 0))
        .forEach((club) => {
          if (club.name === excludeName || seen.has(club.name)) return;
          if ((club.financialTier ?? 2) < minFinancial) return;
          seen.add(club.name);
          out.push(slimFromLeagueClub(club, league));
        });
    });
  return out
    .sort((a, b) => b.financialTier - a.financialTier || b.tier - a.tier)
    .slice(0, limit);
}

function playerClubEntry(player, league) {
  return {
    name: player.club.name,
    displayName: player.club.displayName ?? player.club.name,
    badge: player.club.badge,
    financialTier:
      player.club.financialTier ||
      league?.clubs?.find((c) => c.name === player.club.name)?.financialTier ||
      2,
    tier: league?.tier ?? player.club.tier ?? 3,
    nation: league?.nation ?? player.club.nation,
    league: league?.name ?? player.club.league,
  };
}

function playKnockout(a, b, { player, playerName, competition, round }) {
  const playerIn = a.name === playerName || b.name === playerName;
  const playerSide = a.name === playerName ? "home" : b.name === playerName ? "away" : null;
  let match = simulateMatch(a, b, {
    playerSide,
    player: playerIn ? player : null,
    competition: "europe",
  });
  match = resolveKnockout(match);
  match.round = round;
  match.cupName = competition;
  const winner = match.winnerSide === "home" ? a : b;
  const loser = match.winnerSide === "home" ? b : a;
  return { match, winner, loser, playerIn };
}

/**
 * Full knockout from a power-of-two field. Tracks every winner so the final
 * always features clubs that actually advanced (including the side that beat the player).
 */
function simulateKnockoutTournament({
  field,
  player,
  competition,
  playerExitAfterRound = null,
}) {
  const playerName = player.club.name;
  let remaining = shuffle(field);
  // Ensure even bracket
  while (remaining.length > 1 && remaining.length % 2 === 1) {
    remaining.pop();
  }

  const playerMatches = [];
  const rounds = [];
  const allRounds = [];
  let eliminatedRound = null;
  let stillIn = remaining.some((c) => c.name === playerName);

  const roundLabel = (n) => {
    if (n === 2) return "Final";
    if (n === 4) return "Semi-finals";
    if (n === 8) return "Quarter-finals";
    if (n === 16) return "Round of 16";
    if (n === 32) return "Round of 32";
    return `Round of ${n}`;
  };

  while (remaining.length > 1) {
    const label = roundLabel(remaining.length);
    const next = [];
    const roundMatches = [];

    for (let i = 0; i < remaining.length; i += 2) {
      const a = remaining[i];
      const b = remaining[i + 1];
      if (!a || !b) {
        if (a) next.push(a);
        if (b) next.push(b);
        continue;
      }

      // Optional: force player exit at predetermined round (strength model)
      let forcePlayerLoss = false;
      if (
        playerExitAfterRound &&
        label === playerExitAfterRound &&
        (a.name === playerName || b.name === playerName)
      ) {
        forcePlayerLoss = true;
      }

      let { match, winner, loser, playerIn } = playKnockout(a, b, {
        player,
        playerName,
        competition,
        round: label,
      });

      if (forcePlayerLoss && playerIn && winner.name === playerName) {
        // Flip so player is eliminated by this opponent
        match.winnerSide = match.playerSide === "home" ? "away" : "home";
        if (match.winnerSide === "home") {
          match.homeGoals = Math.max(match.homeGoals, match.awayGoals + 1);
        } else {
          match.awayGoals = Math.max(match.awayGoals, match.homeGoals + 1);
        }
        match.scoreline = `${match.homeGoals}-${match.awayGoals}`;
        winner = match.winnerSide === "home" ? a : b;
        loser = match.winnerSide === "home" ? b : a;
      }

      // If player should still be advancing past this round, nudge a win
      if (playerIn && stillIn && winner.name !== playerName) {
        const stagesOrder = [
          "Round of 32",
          "Round of 16",
          "Quarter-finals",
          "Semi-finals",
          "Final",
        ];
        const hereIdx = stagesOrder.indexOf(label);
        const exitIdx = playerExitAfterRound ? stagesOrder.indexOf(playerExitAfterRound) : 99;
        const shouldStillWin = !playerExitAfterRound || hereIdx < exitIdx;
        if (shouldStillWin && label !== playerExitAfterRound) {
          match.winnerSide = match.playerSide;
          if (match.playerSide === "home") {
            match.homeGoals = Math.max(match.homeGoals, match.awayGoals + 1);
          } else {
            match.awayGoals = Math.max(match.awayGoals, match.homeGoals + 1);
          }
          match.scoreline = `${match.homeGoals}-${match.awayGoals}`;
          winner = match.playerSide === "home" ? a : b;
          loser = match.playerSide === "home" ? b : a;
        }
      }

      next.push(winner);
      roundMatches.push(match);

      if (playerIn) {
        playerMatches.push(match);
        if (winner.name !== playerName) {
          stillIn = false;
          eliminatedRound = label;
        }
      }
    }

    allRounds.push({ round: label, matches: roundMatches });
    if (playerMatches.length && playerMatches[playerMatches.length - 1].round === label) {
      const last = playerMatches[playerMatches.length - 1];
      const opp = last.playerSide === "home" ? last.away : last.home;
      const qualified =
        (last.playerSide === "home" && last.winnerSide === "home") ||
        (last.playerSide === "away" && last.winnerSide === "away");
      rounds.push({
        round: label,
        opponent: opp.displayName,
        opponentBadge: opp.badge,
        score: last.playerSide === "home" ? last.scoreline : `${last.awayGoals}-${last.homeGoals}`,
        qualified,
        match: last,
      });
    }

    remaining = next;
  }

  const winnerClub = remaining[0] || null;
  const finalMatch = allRounds.find((r) => r.round === "Final")?.matches?.[0] || null;
  const won = winnerClub?.name === playerName;

  let result = eliminatedRound || (rounds.length ? rounds[rounds.length - 1].round : "Round of 16");
  if (won) result = "Winners";
  else if (eliminatedRound === "Final") result = "Runner-up";

  return {
    competition,
    result,
    won,
    qualified: true,
    rounds,
    playerMatches,
    allRounds,
    finalMatch,
    finalists: finalMatch ? [{ ...finalMatch.home }, { ...finalMatch.away }] : null,
    winner: winnerClub?.displayName ?? null,
    winnerData: winnerClub
      ? {
          name: winnerClub.name,
          displayName: winnerClub.displayName,
          badge: winnerClub.badge,
        }
      : null,
    showcase: false,
  };
}

function pickExitRound({ competition, leagueTier, clubFinancialTier, finalStrength }) {
  let thresholds;
  let maxStage;
  const stages = ["Round of 16", "Quarter-finals", "Semi-finals", "Final", "Winners"];

  if (competition === "Champions League" || competition === "Copa Libertadores") {
    thresholds = [56, 68, 78, 86, 92];
    maxStage =
      leagueTier >= 5 && clubFinancialTier >= 4
        ? 4
        : leagueTier >= 5
          ? 3
          : leagueTier === 4
            ? clubFinancialTier >= 4
              ? 3
              : 2
            : leagueTier === 3
              ? 1
              : 0;
  } else if (competition === "Europa League" || competition === "Copa Sudamericana") {
    thresholds = [45, 58, 70, 80, 88];
    maxStage = leagueTier >= 4 ? 4 : leagueTier === 3 ? 3 : 2;
  } else {
    thresholds = [38, 50, 62, 74, 84];
    maxStage = leagueTier >= 3 ? 4 : 3;
  }

  let index = 0;
  while (index < thresholds.length && finalStrength > thresholds[index]) index += 1;
  const capped = Math.min(maxStage, index);
  const stage = stages[Math.min(capped, stages.length - 1)];
  if (stage === "Winners") return null; // win the lot
  if (stage === "Final") return "Final"; // lose final → runner-up
  return stage;
}

function buildField(competition, playerClub, size = 16) {
  let pool;
  if (competition === "Copa Libertadores" || competition === "Copa Sudamericana") {
    pool = clubsFromNations(CONMEBOL_NATIONS, {
      excludeName: playerClub.name,
      limit: 40,
      minFinancial: competition === "Copa Libertadores" ? 2 : 1,
    });
  } else if (competition === "CONCACAF Champions Cup") {
    pool = clubsFromNations(CONCACAF_NATIONS, {
      excludeName: playerClub.name,
      limit: 24,
      minFinancial: 1,
    });
  } else {
    const minFinancial =
      competition === "Champions League" ? 3 : competition === "Europa League" ? 2 : 1;
    pool = clubsFromNations(EUROPE_NATIONS, {
      excludeName: playerClub.name,
      limit: 64,
      minFinancial,
    });
  }

  const others = shuffle(pool).slice(0, Math.max(0, size - 1));
  return shuffle([playerClub, ...others]);
}

function continentForLeague(league) {
  const nation = league?.nation;
  if (!nation) return null;
  if (EUROPE_NATIONS.has(nation) || isEuropeanQualificationLeague(league)) return "uefa";
  if (CONMEBOL_NATIONS.has(nation)) return "conmebol";
  if (CONCACAF_NATIONS.has(nation)) return "concacaf";
  return null;
}

function competitionForStanding(standing, league) {
  const conf = continentForLeague(league);
  const q = standing?.qualification;
  if (!conf || !standing) return null;

  if (conf === "uefa") {
    if (!isEuropeanQualificationLeague(league)) return null;
    if (q === "League Champions" || q === "Champions League") return "Champions League";
    if (q === "Europa League") return "Europa League";
    if (q === "Conference League") return "Conference League";
    return null;
  }
  if (conf === "conmebol") {
    if (q === "League Champions" || standing.position <= 4) return "Copa Libertadores";
    if (standing.position <= 8) return "Copa Sudamericana";
    return null;
  }
  if (conf === "concacaf") {
    if (q === "League Champions" || standing.position <= 4) return "CONCACAF Champions Cup";
    return null;
  }
  return null;
}

export function simulateEuropeanCampaign({ standing, league, performanceScore, player }) {
  const competition = competitionForStanding(standing, league);
  if (!competition) return null;

  const leagueTier = clamp(league.tier || 3, 1, 5);
  const clubFinancialTier =
    player.club?.financialTier ||
    league.clubs?.find((c) => c.name === player.club.name)?.financialTier ||
    2;
  const teamStrength = standing.strength || 50;
  const playerBonus = clamp((player.rating - 70) * 0.4 + (performanceScore - 70) * 0.18, -10, 14);
  const financialBonus = [-8, -2, 4, 10, 16][clamp(clubFinancialTier, 1, 5) - 1];
  const leagueBonus =
    competition.includes("Champions") || competition === "Copa Libertadores"
      ? [-12, -5, 3, 10, 18][leagueTier - 1]
      : competition.includes("Europa") || competition === "Copa Sudamericana"
        ? [-6, 0, 5, 10, 14][leagueTier - 1]
        : [-2, 2, 6, 10, 12][leagueTier - 1];
  const finalStrength = clamp(
    teamStrength * 0.55 + leagueBonus + financialBonus + playerBonus + randFloat(-8, 8),
    20,
    100
  );

  const playerClub = playerClubEntry(player, league);
  const fieldSize =
    competition === "CONCACAF Champions Cup" ? 8 : competition === "Conference League" ? 16 : 16;
  const field = buildField(competition, playerClub, fieldSize);
  const exitRound = pickExitRound({
    competition,
    leagueTier,
    clubFinancialTier,
    finalStrength,
  });

  return simulateKnockoutTournament({
    field,
    player,
    competition,
    playerExitAfterRound: exitRound,
  });
}

/** Finals-only showcase for the player's continental confederation. */
export function simulateEuropeanFinalsShowcase(league = null) {
  const conf = continentForLeague(league) || "uefa";
  let comps;
  let nations;
  if (conf === "conmebol") {
    comps = ["Copa Libertadores", "Copa Sudamericana"];
    nations = CONMEBOL_NATIONS;
  } else if (conf === "concacaf") {
    comps = ["CONCACAF Champions Cup"];
    nations = CONCACAF_NATIONS;
  } else {
    comps = ["Champions League", "Europa League", "Conference League"];
    nations = EUROPE_NATIONS;
  }

  const pool = clubsFromNations(nations, { limit: 48, minFinancial: conf === "uefa" ? 2 : 1 });
  const competitions = comps.map((name) => {
    const size = name === "CONCACAF Champions Cup" ? 8 : 16;
    const field = shuffle(pool).slice(0, size);
    // Pad if thin
    while (field.length < 4 && pool.length) field.push(pickRandom(pool));
    const bracketSize = field.length >= 8 ? 8 : 4;
    const use = field.slice(0, bracketSize);
    // Full knockout so finals come from real results
    let remaining = shuffle(use);
    let finalMatch = null;
    const allRounds = [];
    while (remaining.length > 1) {
      const next = [];
      const roundMatches = [];
      const label = remaining.length === 2 ? "Final" : `Round of ${remaining.length}`;
      for (let i = 0; i < remaining.length; i += 2) {
        const a = remaining[i];
        const b = remaining[i + 1] || pickRandom(pool);
        let match = resolveKnockout(simulateMatch(a, b, { competition: "europe" }));
        match.round = label;
        match.cupName = name;
        if (remaining.length === 2) finalMatch = match;
        roundMatches.push(match);
        next.push(match.winnerSide === "home" ? a : b);
      }
      allRounds.push({ round: label, matches: roundMatches });
      remaining = next;
    }
    const winnerClub = remaining[0];
    return {
      competition: name,
      allRounds,
      finalMatch,
      finalists: finalMatch ? [finalMatch.home, finalMatch.away] : null,
      winner: winnerClub?.displayName ?? null,
      winnerData: winnerClub || null,
    };
  });

  return {
    competition: comps[0] || "Continental finals",
    result: "Not qualified",
    won: false,
    qualified: false,
    rounds: [],
    playerMatches: [],
    finalMatch: competitions[0]?.finalMatch || null,
    finalists: competitions[0]?.finalists || null,
    winner: competitions[0]?.winner || null,
    winnerData: competitions[0]?.winnerData || null,
    showcase: true,
    competitions,
    confederation: conf,
  };
}
