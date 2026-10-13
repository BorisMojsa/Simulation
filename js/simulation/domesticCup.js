import { resolveKnockout, simulateMatch, formatMatchScoreline } from "./matchEngine.js";
import { cupConfigForNation } from "../data/domesticCups.js";
import { LEAGUES } from "../data/leagues.js";
import { getSimRng } from "./rng.js";
import { attachClubIdentity, applyMatchFormUpdate, getWorldState } from "./worldState.js";

function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p *= 2;
  return Math.max(2, p);
}

function roundLabelForSize(size) {
  if (size === 2) return "Final";
  if (size === 4) return "Semi-finals";
  if (size === 8) return "Quarter-finals";
  if (size === 16) return "Round of 16";
  if (size === 32) return "Round of 32";
  if (size === 64) return "Round of 64";
  if (size === 128) return "Round of 128";
  return `Round of ${size}`;
}

function clubEntry(club, league) {
  return attachClubIdentity({
    name: club.name,
    displayName: club.displayName ?? club.name,
    badge: club.badge,
    clubId: club.clubId,
    financialTier: club.financialTier ?? league.financialPower ?? 2,
    tier: league.tier,
    overall: club.overall,
    attack: club.attack,
    midfield: club.midfield,
    defence: club.defence,
    goalkeeper: club.goalkeeper,
    league: league.name,
    leagueDisplay: league.displayName,
    leagueId: league.leagueId,
    nation: league.nation,
  });
}

function collectNationClubs(nation, includeSecondDivision) {
  const leagues = LEAGUES.filter((l) => l.nation === nation).sort((a, b) => {
    const da = a.divisionLevel ?? 99;
    const db = b.divisionLevel ?? 99;
    if (da !== db) return da - db;
    return (b.tier ?? 0) - (a.tier ?? 0);
  });
  if (!leagues.length) return [];
  const topDiv = Math.min(...leagues.map((l) => l.divisionLevel ?? 1));
  const selected = includeSecondDivision
    ? leagues.filter((l) => (l.divisionLevel ?? 1) <= topDiv + 1)
    : leagues.filter((l) => (l.divisionLevel ?? 1) === topDiv);
  const use = selected.length ? selected : [leagues[0]];
  const out = [];
  const seen = new Set();
  use.forEach((league) => {
    league.clubs.forEach((club) => {
      const id = club.clubId || club.name;
      if (seen.has(id)) return;
      seen.add(id);
      out.push(clubEntry(club, league));
    });
  });
  return out;
}

function ensurePlayerClub(clubs, player) {
  if (!player?.club?.name) return clubs;
  if (clubs.some((c) => c.name === player.club.name || c.clubId === player.club.clubId)) {
    return clubs;
  }
  return [
    ...clubs,
    attachClubIdentity({
      name: player.club.name,
      displayName: player.club.displayName ?? player.club.name,
      badge: player.club.badge,
      clubId: player.club.clubId,
      financialTier: player.club.financialTier ?? 2,
      tier: player.club.tier ?? 3,
      overall: player.club.overall,
      league: player.club.league,
      leagueDisplay: player.club.leagueDisplay,
      nation: player.club.nation,
    }),
  ];
}

/**
 * Build the initial domestic-cup bracket without simulating matches.
 */
export function prepareDomesticCupBracket(league, player) {
  const rng = getSimRng();
  const nation = league?.nation || "Unknown";
  const config = cupConfigForNation(nation);
  let clubs = ensurePlayerClub(
    collectNationClubs(nation, config.includeSecondDivision),
    player
  );

  const ideal = Math.min(Math.max(config.startSize, 2), 128);
  let bracketSize = nextPowerOfTwo(Math.min(Math.max(clubs.length, 2), ideal));
  if (config.includeSecondDivision) {
    bracketSize = Math.max(bracketSize, Math.min(ideal, 64));
  }
  while (bracketSize - clubs.length > clubs.length) {
    bracketSize /= 2;
  }
  bracketSize = Math.max(2, bracketSize);

  if (clubs.length > bracketSize) {
    clubs = rng
      .shuffle(clubs)
      .sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0) || (b.tier ?? 0) - (a.tier ?? 0))
      .slice(0, bracketSize);
    clubs = ensurePlayerClub(clubs, player);
    if (clubs.length > bracketSize) {
      const playerClub = clubs.find((c) => c.name === player.club.name);
      clubs = clubs
        .filter((c) => c.name !== player.club.name)
        .sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))
        .slice(0, bracketSize - 1);
      if (playerClub) clubs.push(playerClub);
    }
    bracketSize = nextPowerOfTwo(Math.max(clubs.length, 2));
  }

  clubs = arrangeBracketWithByes(rng.shuffle(clubs), bracketSize, rng);
  return {
    config,
    remaining: clubs,
    playerName: player.club.name,
    playerMatches: [],
    allRounds: [],
    rounds: [],
    eliminatedRound: null,
    finished: false,
  };
}

/**
 * Simulate one domestic-cup round. When `matchProcessor` is provided it is used
 * for the player's tie (chronological health/selection); otherwise simulateMatch.
 */
export function simulateDomesticCupRound(state, { player, date = null, matchProcessor = null } = {}) {
  const rng = getSimRng();
  const world = getWorldState();
  if (!state || state.finished || state.remaining.length <= 1) {
    if (state) state.finished = true;
    return state;
  }

  let remaining = state.remaining;
  const playerName = state.playerName;
  const size = remaining.length;
  if (size % 2 === 1) throw new Error(`Domestic cup invalid odd field ${size}`);
  const label = roundLabelForSize(size);
  const next = [];
  const roundMatches = [];

  for (let i = 0; i < remaining.length; i += 2) {
    const a = remaining[i];
    const b = remaining[i + 1];

    if (!a && !b) continue;
    if (!b || b.isBye) {
      if (a && !a.isBye) {
        next.push(a);
        roundMatches.push({
          home: a,
          away: { name: "__bye__", displayName: "Bye", badge: null, isBye: true },
          scoreline: "bye",
          homeGoals: 0,
          awayGoals: 0,
          matchHomeGoals: 0,
          matchAwayGoals: 0,
          winnerSide: "home",
          decidedBy: "bye",
          isBye: true,
          round: label,
          cupName: state.config.name,
          date,
        });
      }
      continue;
    }
    if (!a || a.isBye) {
      if (b && !b.isBye) {
        next.push(b);
        roundMatches.push({
          home: b,
          away: { name: "__bye__", displayName: "Bye", badge: null, isBye: true },
          scoreline: "bye",
          homeGoals: 0,
          awayGoals: 0,
          matchHomeGoals: 0,
          matchAwayGoals: 0,
          winnerSide: "home",
          decidedBy: "bye",
          isBye: true,
          round: label,
          cupName: state.config.name,
          date,
        });
      }
      continue;
    }

    const playerInTie = a.name === playerName || b.name === playerName;
    const playerSide = a.name === playerName ? "home" : b.name === playerName ? "away" : null;
    let match;
    let processorResult = null;
    if (playerInTie && typeof matchProcessor === "function") {
      processorResult = matchProcessor({
        home: a,
        away: b,
        playerSide,
        date,
        label,
      });
      match = processorResult.match;
    } else {
      match = simulateMatch(a, b, {
        playerSide,
        player: playerInTie ? player : null,
        competition: "cup",
        worldState: world,
        rng,
        competitionId: state.config.name,
        date,
      });
      match = resolveKnockout(match, { player: playerInTie ? player : null, rng });
      applyMatchFormUpdate(world, match);
    }
    match.round = label;
    match.cupName = state.config.name;
    match.date = date;

    const winner = match.winnerSide === "home" ? a : b;
    next.push(winner);
    roundMatches.push(match);

    if (playerInTie) {
      state.playerMatches.push(match);
      const qualified =
        (playerSide === "home" && match.winnerSide === "home") ||
        (playerSide === "away" && match.winnerSide === "away");
      const opp = playerSide === "home" ? b : a;
      state.rounds.push({
        round: label,
        opponent: opp.displayName,
        opponentName: opp.name,
        opponentBadge: opp.badge,
        score: formatMatchScoreline(match, { fromPlayerSide: playerSide }),
        qualified,
        match,
      });
      if (winner.name !== playerName) state.eliminatedRound = label;
      if (processorResult) state.lastProcessorResult = processorResult;
    }
  }

  state.allRounds.push({ round: label, matches: roundMatches });
  state.remaining = next.length ? next : remaining.slice(0, 1);
  if (state.remaining.length <= 1) state.finished = true;
  return state;
}

function finalizeCupState(state) {
  const winnerClub = state.remaining[0];
  const won = winnerClub?.name === state.playerName;
  const finalMatch = state.allRounds.find((r) => r.round === "Final")?.matches?.[0] || null;
  let result = state.rounds.length
    ? state.rounds[state.rounds.length - 1].round
    : roundLabelForSize(Math.max(2, state.allRounds[0]?.matches?.length * 2 || 2));
  if (won) result = "Winners";
  else if (state.eliminatedRound === "Final") result = "Finalists";
  else if (state.eliminatedRound) result = state.eliminatedRound;

  return {
    name: state.config.name,
    shortName: state.config.shortName,
    result,
    won,
    rounds: state.rounds,
    playerMatches: state.playerMatches,
    allRounds: state.allRounds,
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
  };
}

/**
 * Full domestic cup for the player's nation.
 */
export function simulateDomesticCup(league, performanceScore, standing, player) {
  const state = prepareDomesticCupBracket(league, player);
  while (!state.finished && state.remaining.length > 1) {
    simulateDomesticCupRound(state, { player });
  }
  return finalizeCupState(state);
}

/** Finalize a progressive cup state into the public result shape. */
export function finalizeDomesticCup(state) {
  while (state && !state.finished && state.remaining.length > 1) {
    simulateDomesticCupRound(state, { player: null });
  }
  return finalizeCupState(state);
}

function arrangeBracketWithByes(clubs, bracketSize, rng) {
  const real = rng.shuffle(clubs.filter((c) => !c.isBye));
  const byesNeeded = Math.max(0, bracketSize - real.length);

  const withBye = real.slice(0, Math.min(byesNeeded, real.length));
  const playing = real.slice(withBye.length);

  const out = [];
  for (let i = 0; i < playing.length; i += 2) {
    out.push(playing[i]);
    out.push(playing[i + 1] || makeBye(`pad_${i}`));
  }
  withBye.forEach((club, i) => {
    out.push(club);
    out.push(makeBye(i));
  });

  while (out.length < bracketSize) {
    out.push(makeBye(`extra_${out.length}`));
  }
  // Avoid bye-bye pairings in first slots
  return out.slice(0, bracketSize);
}

function makeBye(id) {
  return {
    name: `__bye_${id}`,
    displayName: "Bye",
    badge: null,
    financialTier: 1,
    tier: 1,
    isBye: true,
  };
}
