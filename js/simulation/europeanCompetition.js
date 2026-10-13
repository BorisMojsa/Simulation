import { LEAGUES } from "../data/leagues.js";
import {
  continentalCompetitionForStanding,
  isUefaQualifyingLeague,
} from "../data/competitions/qualification.js";
import { resolveKnockout, simulateMatch, formatMatchScoreline } from "./matchEngine.js";
import { getSimRng } from "./rng.js";
import { attachClubIdentity, applyMatchFormUpdate, getWorldState } from "./worldState.js";
import { effectiveTeamStrength } from "./teamStrength.js";

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

function slimFromLeagueClub(club, league) {
  return attachClubIdentity({
    name: club.name,
    displayName: club.displayName ?? club.name,
    badge: club.badge ?? null,
    clubId: club.clubId,
    financialTier: club.financialTier ?? league.financialPower ?? 2,
    tier: league.tier ?? 3,
    overall: club.overall,
    attack: club.attack,
    midfield: club.midfield,
    defence: club.defence,
    goalkeeper: club.goalkeeper,
    nation: league.nation,
    league: league.name,
    leagueId: league.leagueId,
  });
}

/** Sporting quality pool from each nation's top flight. */
function clubsFromNations(nations, { excludeName = "", excludeId = null, limit = 48, minOverall = 0 } = {}) {
  const topByNation = new Map();
  LEAGUES.filter((l) => nations.has(l.nation)).forEach((league) => {
    const isTop = (league.divisionLevel ?? 1) === 1;
    if (!isTop && !isUefaQualifyingLeague(league) && league.nation !== "Brazil") {
      // Prefer explicit top flights; still allow highest-tier league per nation
    }
    const cur = topByNation.get(league.nation);
    if (!cur || (league.tier ?? 0) > (cur.tier ?? 0)) {
      topByNation.set(league.nation, league);
    }
  });

  const out = [];
  const seen = new Set();
  [...topByNation.values()]
    .sort((a, b) => (b.tier ?? 0) - (a.tier ?? 0))
    .forEach((league) => {
      [...league.clubs]
        .sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))
        .forEach((club) => {
          if (club.name === excludeName || (excludeId && club.clubId === excludeId)) return;
          if (seen.has(club.clubId || club.name)) return;
          if ((club.overall ?? 0) < minOverall) return;
          seen.add(club.clubId || club.name);
          out.push(slimFromLeagueClub(club, league));
        });
    });
  return out
    .sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))
    .slice(0, limit);
}

function playerClubEntry(player, league) {
  return attachClubIdentity({
    name: player.club.name,
    displayName: player.club.displayName ?? player.club.name,
    badge: player.club.badge,
    clubId: player.club.clubId,
    financialTier:
      player.club.financialTier ||
      league?.clubs?.find((c) => c.name === player.club.name)?.financialTier ||
      2,
    tier: league?.tier ?? player.club.tier ?? 3,
    overall: player.club.overall,
    attack: player.club.attack,
    midfield: player.club.midfield,
    defence: player.club.defence,
    goalkeeper: player.club.goalkeeper,
    nation: league?.nation ?? player.club.nation,
    league: league?.name ?? player.club.league,
    leagueId: league?.leagueId ?? player.club.leagueId,
  });
}

function playKnockout(a, b, { player, playerName, competition, round, rng, world }) {
  const playerIn = a.name === playerName || b.name === playerName;
  const playerSide = a.name === playerName ? "home" : b.name === playerName ? "away" : null;
  let match = simulateMatch(a, b, {
    playerSide,
    player: playerIn ? player : null,
    competition: "europe",
    venue: "home",
    worldState: world,
    rng,
    competitionId: competition,
  });
  match = resolveKnockout(match, { player: playerIn ? player : null, rng });
  match.round = round;
  match.cupName = competition;
  applyMatchFormUpdate(world, match);
  const winner = match.winnerSide === "home" ? a : b;
  const loser = match.winnerSide === "home" ? b : a;
  return { match, winner, loser, playerIn };
}

/**
 * Full knockout from a power-of-two field. Champion emerges from real results only.
 */
function simulateKnockoutTournament({ field, player, competition }) {
  const rng = getSimRng();
  const world = getWorldState();
  const playerName = player.club.name;
  let remaining = rng.shuffle(field);

  if (remaining.length < 2) {
    throw new Error(`${competition}: field too small (${remaining.length})`);
  }
  // Trim to largest power of two without inventing teams
  let size = 1;
  while (size * 2 <= remaining.length) size *= 2;
  if (size !== remaining.length) {
    // Keep strongest + ensure player club retained
    remaining = [...remaining].sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));
    const playerClub = remaining.find((c) => c.name === playerName);
    remaining = remaining.slice(0, size);
    if (playerClub && !remaining.some((c) => c.name === playerName)) {
      remaining[remaining.length - 1] = playerClub;
    }
    remaining = rng.shuffle(remaining);
  }

  const playerMatches = [];
  const rounds = [];
  const allRounds = [];
  let eliminatedRound = null;

  const roundLabel = (n) => {
    if (n === 2) return "Final";
    if (n === 4) return "Semi-finals";
    if (n === 8) return "Quarter-finals";
    if (n === 16) return "Round of 16";
    if (n === 32) return "Round of 32";
    return `Round of ${n}`;
  };

  while (remaining.length > 1) {
    if (remaining.length % 2 === 1) {
      throw new Error(`${competition}: invalid odd bracket size ${remaining.length}`);
    }
    const label = roundLabel(remaining.length);
    const next = [];
    const roundMatches = [];

    for (let i = 0; i < remaining.length; i += 2) {
      const a = remaining[i];
      const b = remaining[i + 1];
      const { match, winner, playerIn } = playKnockout(a, b, {
        player,
        playerName,
        competition,
        round: label,
        rng,
        world,
      });

      next.push(winner);
      roundMatches.push(match);

      if (playerIn) {
        playerMatches.push(match);
        if (winner.name !== playerName) {
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
        score: formatMatchScoreline(last, { fromPlayerSide: last.playerSide }),
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
          clubId: winnerClub.clubId,
        }
      : null,
    showcase: false,
  };
}

function buildField(competition, playerClub, size = 16) {
  let pool;
  let minOverall = 0;
  if (competition === "Copa Libertadores" || competition === "Copa Sudamericana") {
    minOverall = competition === "Copa Libertadores" ? 68 : 60;
    pool = clubsFromNations(CONMEBOL_NATIONS, {
      excludeName: playerClub.name,
      excludeId: playerClub.clubId,
      limit: 40,
      minOverall,
    });
  } else if (competition === "CONCACAF Champions Cup") {
    pool = clubsFromNations(CONCACAF_NATIONS, {
      excludeName: playerClub.name,
      excludeId: playerClub.clubId,
      limit: 24,
      minOverall: 58,
    });
  } else {
    minOverall =
      competition === "Champions League" ? 72 : competition === "Europa League" ? 66 : 60;
    pool = clubsFromNations(EUROPE_NATIONS, {
      excludeName: playerClub.name,
      excludeId: playerClub.clubId,
      limit: 64,
      minOverall,
    });
  }

  const rng = getSimRng();
  // Seeded mix: prefer stronger clubs but keep variety
  const ranked = [...pool].sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));
  const cut = Math.ceil(Math.max(4, size * 1.5));
  const top = ranked.slice(0, cut);
  const rest = ranked.slice(cut);
  const others = rng
    .shuffle([...rng.shuffle(top).slice(0, size + 4), ...rng.shuffle(rest).slice(0, size)])
    .slice(0, Math.max(0, size - 1));
  return rng.shuffle([playerClub, ...others]);
}

function continentForLeague(league) {
  const nation = league?.nation;
  if (!nation) return null;
  if (EUROPE_NATIONS.has(nation) || isUefaQualifyingLeague(league)) return "uefa";
  if (CONMEBOL_NATIONS.has(nation)) return "conmebol";
  if (CONCACAF_NATIONS.has(nation)) return "concacaf";
  return null;
}

export function simulateEuropeanCampaign({ standing, league, performanceScore, player }) {
  const competition = continentalCompetitionForStanding(standing, league);
  if (!competition) return null;

  const playerClub = playerClubEntry(player, league);
  // Attach live effective overall including player for seeding only (eligibility already decided)
  const world = getWorldState();
  const eff = effectiveTeamStrength(playerClub, {
    player,
    playerSide: "home",
    side: "home",
    worldState: world,
  });
  playerClub.overall = eff.profile?.overall ?? playerClub.overall;

  const fieldSize =
    competition === "CONCACAF Champions Cup" ? 8 : competition === "Conference League" ? 16 : 16;
  const field = buildField(competition, playerClub, fieldSize);

  return simulateKnockoutTournament({
    field,
    player,
    competition,
  });
}

/** Finals-only showcase for the player's continental confederation. */
export function simulateEuropeanFinalsShowcase(league = null) {
  const rng = getSimRng();
  const world = getWorldState();
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

  const pool = clubsFromNations(nations, {
    limit: 48,
    minOverall: conf === "uefa" ? 66 : 58,
  });
  const competitions = comps.map((name) => {
    const size = name === "CONCACAF Champions Cup" ? 8 : 16;
    let field = rng.shuffle(pool).slice(0, size);
    while (field.length < 4 && pool.length) field.push(rng.pick(pool));
    let bracketSize = 1;
    while (bracketSize * 2 <= field.length) bracketSize *= 2;
    const use = field.slice(0, bracketSize);
    let remaining = rng.shuffle(use);
    let finalMatch = null;
    const allRounds = [];
    while (remaining.length > 1) {
      if (remaining.length % 2 === 1) {
        throw new Error(`Showcase ${name}: odd bracket ${remaining.length}`);
      }
      const next = [];
      const roundMatches = [];
      const label = remaining.length === 2 ? "Final" : `Round of ${remaining.length}`;
      for (let i = 0; i < remaining.length; i += 2) {
        const a = remaining[i];
        const b = remaining[i + 1];
        let match = resolveKnockout(
          simulateMatch(a, b, {
            competition: "europe",
            worldState: world,
            rng,
            competitionId: name,
          }),
          { rng }
        );
        match.round = label;
        match.cupName = name;
        applyMatchFormUpdate(world, match);
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
