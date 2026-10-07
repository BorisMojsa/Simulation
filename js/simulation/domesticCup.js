import { resolveKnockout, simulateMatch } from "./matchEngine.js?v=45";
import { cupConfigForNation } from "../data/domesticCups.js?v=45";
import { LEAGUES } from "../data/leagues.js";
import { pickRandom, randFloat } from "../utils/helpers.js";

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

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
  return {
    name: club.name,
    displayName: club.displayName ?? club.name,
    badge: club.badge,
    financialTier: club.financialTier ?? league.financialPower ?? 2,
    tier: league.tier,
    league: league.name,
    leagueDisplay: league.displayName,
    nation: league.nation,
  };
}

function collectNationClubs(nation, includeSecondDivision) {
  const leagues = LEAGUES.filter((l) => l.nation === nation).sort((a, b) => b.tier - a.tier);
  if (!leagues.length) return [];
  const topTier = leagues[0].tier;
  const selected = includeSecondDivision
    ? leagues.filter((l) => l.tier >= topTier - 1)
    : [leagues[0]];
  const out = [];
  const seen = new Set();
  selected.forEach((league) => {
    league.clubs.forEach((club) => {
      if (seen.has(club.name)) return;
      seen.add(club.name);
      out.push(clubEntry(club, league));
    });
  });
  return out;
}

function ensurePlayerClub(clubs, player) {
  if (!player?.club?.name) return clubs;
  if (clubs.some((c) => c.name === player.club.name)) return clubs;
  return [
    ...clubs,
    {
      name: player.club.name,
      displayName: player.club.displayName ?? player.club.name,
      badge: player.club.badge,
      financialTier: player.club.financialTier ?? 2,
      tier: player.club.tier ?? 3,
      league: player.club.league,
      leagueDisplay: player.club.leagueDisplay,
      nation: player.club.nation,
    },
  ];
}

/**
 * Full domestic cup for the player's nation, with named competition
 * and multi-division field when configured.
 */
export function simulateDomesticCup(league, performanceScore, standing, player) {
  const nation = league?.nation || "Unknown";
  const config = cupConfigForNation(nation);
  let clubs = ensurePlayerClub(
    collectNationClubs(nation, config.includeSecondDivision),
    player
  );

  // Size to the next power of two of the field, capped by the cup's configured start size.
  // Dual-division nations keep the larger startSize (typically 64) so 2nd-tier clubs enter.
  const ideal = Math.min(Math.max(config.startSize, 2), 128);
  let bracketSize = nextPowerOfTwo(Math.min(Math.max(clubs.length, 2), ideal));
  if (config.includeSecondDivision) {
    bracketSize = Math.max(bracketSize, Math.min(ideal, 64));
  }
  // Never request more byes than clubs (would break power-of-two progression)
  while (bracketSize - clubs.length > clubs.length) {
    bracketSize /= 2;
  }
  bracketSize = Math.max(2, bracketSize);

  if (clubs.length > bracketSize) {
    clubs = shuffle(clubs)
      .sort((a, b) => b.financialTier - a.financialTier || b.tier - a.tier)
      .slice(0, bracketSize);
    clubs = ensurePlayerClub(clubs, player);
    if (clubs.length > bracketSize) clubs = clubs.slice(0, bracketSize);
    bracketSize = nextPowerOfTwo(Math.max(clubs.length, 2));
  }

  clubs = arrangeBracketWithByes(shuffle(clubs), bracketSize);

  const playerName = player.club.name;
  const playerMatches = [];
  const allRounds = [];
  let remaining = clubs;
  let eliminatedRound = null;

  while (remaining.length > 1) {
    const size = remaining.length;
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
            homeGoals: 1,
            awayGoals: 0,
            winnerSide: "home",
            isBye: true,
            round: label,
            cupName: config.name,
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
            homeGoals: 1,
            awayGoals: 0,
            winnerSide: "home",
            isBye: true,
            round: label,
            cupName: config.name,
          });
        }
        continue;
      }

      const playerInTie = a.name === playerName || b.name === playerName;
      const playerSide = a.name === playerName ? "home" : b.name === playerName ? "away" : null;
      let match = simulateMatch(a, b, {
        playerSide,
        player: playerInTie ? player : null,
        competition: "cup",
      });
      match = resolveKnockout(match);
      match.round = label;
      match.cupName = config.name;

      const winner = match.winnerSide === "home" ? a : b;
      next.push(winner);
      roundMatches.push(match);

      if (playerInTie) {
        playerMatches.push(match);
        if (winner.name !== playerName) {
          eliminatedRound = label;
        }
      }
    }

    // Keep power-of-two progression if byes collapsed the field oddly
    if (next.length > 1 && next.length % 2 === 1) {
      next.push({
        name: `__bye_pad_${next.length}`,
        displayName: "Bye",
        badge: null,
        financialTier: 1,
        tier: 1,
        isBye: true,
      });
    }

    allRounds.push({ round: label, matches: roundMatches });
    remaining = next.length ? next : remaining.slice(0, 1);
  }

  const winnerClub = remaining[0];
  const won = winnerClub?.name === playerName;
  const finalMatch =
    allRounds
      .find((r) => r.round === "Final")
      ?.matches?.[0] || null;

  // Player-facing rounds summary (compat + animation)
  const rounds = playerMatches.map((m) => {
    const opp = m.playerSide === "home" ? m.away : m.home;
    const qualified =
      (m.playerSide === "home" && m.winnerSide === "home") ||
      (m.playerSide === "away" && m.winnerSide === "away");
    return {
      round: m.round,
      opponent: opp.displayName,
      opponentName: opp.name,
      opponentBadge: opp.badge,
      score: m.playerSide === "home" ? m.scoreline : `${m.awayGoals}-${m.homeGoals}`,
      qualified,
      match: m,
    };
  });

  let result = rounds.length ? rounds[rounds.length - 1].round : roundLabelForSize(bracketSize);
  if (won) result = "Winners";
  else if (eliminatedRound === "Final") result = "Finalists";
  else if (eliminatedRound) result = eliminatedRound;

  return {
    name: config.name,
    shortName: config.shortName,
    result,
    won,
    rounds,
    playerMatches,
    allRounds,
    finalMatch,
    finalists: finalMatch
      ? [
          { ...finalMatch.home },
          { ...finalMatch.away },
        ]
      : null,
    winner: winnerClub?.displayName ?? null,
    winnerData: winnerClub
      ? {
          name: winnerClub.name,
          displayName: winnerClub.displayName,
          badge: winnerClub.badge,
        }
      : null,
  };
}

/** Place byes opposite real clubs so bye–bye ties never appear. */
function arrangeBracketWithByes(clubs, bracketSize) {
  const real = shuffle(clubs.filter((c) => !c.isBye));
  const byesNeeded = Math.max(0, bracketSize - real.length);

  // Teams with a bye auto-advance; remaining reals play each other in round 1.
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
