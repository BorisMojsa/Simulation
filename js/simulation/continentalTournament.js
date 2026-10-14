/**
 * Research-grounded continental club tournaments with committed results.
 * Supports UEFA league phase, CONMEBOL groups, Concacaf KO path, AFC Elite, CAF CL.
 */

import { LEAGUES } from "../data/leagues.js";
import {
  continentalCompetitionForStanding,
  isUefaQualifyingLeague,
} from "../data/competitions/qualification.js";
import { formatForCompetitionName } from "../data/competitions/formats.js";
import { CLUB_PROFILES } from "../data/identity/resolver.js";
import {
  resolveKnockout,
  resolveTwoLeggedTie,
  simulateMatch,
  formatMatchScoreline,
} from "./matchEngine.js";
import { getSimRng } from "./rng.js";
import { attachClubIdentity, applyMatchFormUpdate, getWorldState } from "./worldState.js";
import { effectiveTeamStrength } from "./teamStrength.js";
import {
  commitEdition,
  commitMatch,
  commitTie,
  createEdition,
} from "./competitionStore.js";

const CONFED_NATIONS = {
  UEFA: new Set([
    "England", "Spain", "Germany", "Italy", "France", "Portugal", "Netherlands",
    "Belgium", "Denmark", "Turkey", "Norway", "Poland", "Czech Republic", "Croatia", "Serbia",
  ]),
  CONMEBOL: new Set(["Brazil", "Argentina", "Colombia", "Ecuador"]),
  CONCACAF: new Set(["Mexico", "United States"]),
  AFC: new Set(["Saudi Arabia", "Japan", "South Korea"]),
  CAF: new Set(["Egypt", "Morocco"]),
};

function slimClub(club, leagueMeta = {}) {
  return attachClubIdentity({
    name: club.name,
    displayName: club.displayName ?? club.name,
    badge: club.badge ?? null,
    clubId: club.clubId,
    financialTier: club.financialTier ?? leagueMeta.financialPower ?? 2,
    tier: leagueMeta.tier ?? club.tier ?? 3,
    overall: club.overall,
    attack: club.attack,
    midfield: club.midfield,
    defence: club.defence,
    goalkeeper: club.goalkeeper,
    nation: club.nation ?? leagueMeta.nation,
    league: club.league ?? leagueMeta.name,
    leagueId: club.leagueId ?? leagueMeta.leagueId,
    confederation: club.confederation ?? null,
  });
}

function clubsFromConfederation(confederation, { excludeName = "", excludeId = null, limit = 64, minOverall = 0 } = {}) {
  const nations = CONFED_NATIONS[confederation];
  const fromLeagues = [];
  const seen = new Set();

  LEAGUES.forEach((league) => {
    if (nations && !nations.has(league.nation)) return;
    if (!nations && confederation === "UEFA" && !isUefaQualifyingLeague(league) && (league.divisionLevel ?? 1) !== 1) {
      return;
    }
    [...league.clubs]
      .sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))
      .forEach((club) => {
        const id = club.clubId || club.name;
        if (seen.has(id)) return;
        if (club.name === excludeName || (excludeId && club.clubId === excludeId)) return;
        if ((club.overall ?? 0) < minOverall) return;
        seen.add(id);
        fromLeagues.push(slimClub(club, league));
      });
  });

  // Supplement profiles not yet mirrored into LEAGUES (safety net)
  CLUB_PROFILES.forEach((p) => {
    if (p.confederation !== confederation) return;
    const id = p.clubId || p.name;
    if (seen.has(id)) return;
    if (p.name === excludeName || (excludeId && p.clubId === excludeId)) return;
    if ((p.overall ?? 0) < minOverall) return;
    seen.add(id);
    fromLeagues.push(slimClub(p, { name: p.leagueName, nation: p.nation, leagueId: p.leagueId, tier: 3 }));
  });

  return fromLeagues
    .sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))
    .slice(0, limit);
}

function playerClubEntry(player, league) {
  return slimClub(
    {
      ...player.club,
      nation: league?.nation ?? player.club.nation,
      league: league?.name ?? player.club.league,
      leagueId: league?.leagueId ?? player.club.leagueId,
    },
    league || {}
  );
}

function clubKey(c) {
  return c?.clubId || c?.name;
}

function sortTableRows(rows) {
  return [...rows].sort(
    (a, b) =>
      b.points - a.points ||
      b.goalDiff - a.goalDiff ||
      b.goalsFor - a.goalsFor ||
      (b.strength ?? 0) - (a.strength ?? 0)
  );
}

function emptyRow(team) {
  return {
    team,
    name: team.name,
    displayName: team.displayName,
    badge: team.badge,
    clubId: team.clubId,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDiff: 0,
    points: 0,
    strength: team.overall ?? 70,
    position: 0,
  };
}

function applyResultToRow(row, gf, ga) {
  row.played += 1;
  row.goalsFor += gf;
  row.goalsAgainst += ga;
  row.goalDiff = row.goalsFor - row.goalsAgainst;
  if (gf > ga) {
    row.wins += 1;
    row.points += 3;
  } else if (gf === ga) {
    row.draws += 1;
    row.points += 1;
  } else {
    row.losses += 1;
  }
}

function roundLabel(n) {
  if (n === 2) return "Final";
  if (n === 4) return "Semi-finals";
  if (n === 8) return "Quarter-finals";
  if (n === 16) return "Round of 16";
  if (n === 32) return "Round of 32";
  return `Round of ${n}`;
}

/**
 * Build distinct opponent schedule for a league phase (Swiss-style).
 * Guarantees each club plays `opponents` distinct sides with home/away balance.
 */
function buildLeaguePhaseSchedule(field, opponents, homeCount, rng) {
  const n = field.length;
  const ids = field.map(clubKey);
  const byId = new Map(field.map((c) => [clubKey(c), c]));
  const played = new Map(ids.map((id) => [id, new Set()]));
  const homeLeft = new Map(ids.map((id) => [id, homeCount]));
  const fixtures = [];
  const fixtureKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const usedPairs = new Set();

  // Greedy: for each MD slot, pair unmatched clubs preferring unmet opponents
  const slots = opponents;
  for (let slot = 0; slot < slots; slot++) {
    const order = rng.shuffle([...ids]);
    const busy = new Set();
    for (const a of order) {
      if (busy.has(a)) continue;
      if (played.get(a).size >= opponents) continue;
      let best = null;
      let bestScore = -Infinity;
      for (const b of order) {
        if (a === b || busy.has(b)) continue;
        if (played.get(b).size >= opponents) continue;
        if (played.get(a).has(b)) continue;
        if (usedPairs.has(fixtureKey(a, b))) continue;
        const needHomeA = homeLeft.get(a) > 0;
        const needHomeB = homeLeft.get(b) > 0;
        let score = (field.find((c) => clubKey(c) === b)?.overall ?? 70) * 0.01;
        if (needHomeA !== needHomeB) score += 5;
        if (Math.abs(played.get(a).size - played.get(b).size) <= 1) score += 2;
        if (score > bestScore) {
          bestScore = score;
          best = b;
        }
      }
      if (!best) continue;
      const aNeedsHome = homeLeft.get(a) > 0;
      const bNeedsHome = homeLeft.get(best) > 0;
      let homeId = a;
      let awayId = best;
      if (aNeedsHome && !bNeedsHome) {
        homeId = a;
        awayId = best;
      } else if (!aNeedsHome && bNeedsHome) {
        homeId = best;
        awayId = a;
      } else if (rng.random() < 0.5) {
        homeId = best;
        awayId = a;
      }
      homeLeft.set(homeId, homeLeft.get(homeId) - 1);
      played.get(a).add(best);
      played.get(best).add(a);
      usedPairs.add(fixtureKey(a, best));
      busy.add(a);
      busy.add(best);
      fixtures.push({
        home: byId.get(homeId),
        away: byId.get(awayId),
        matchday: slot + 1,
      });
    }
  }

  // Repair: clubs short of opponents get extra pairings against anyone remaining
  ids.forEach((a) => {
    while (played.get(a).size < opponents) {
      const candidates = ids.filter(
        (b) => b !== a && !played.get(a).has(b) && played.get(b).size < opponents + 2
      );
      if (!candidates.length) break;
      const b = rng.pick(candidates);
      const homeId = homeLeft.get(a) > 0 ? a : b;
      const awayId = homeId === a ? b : a;
      if (homeLeft.get(homeId) > 0) homeLeft.set(homeId, homeLeft.get(homeId) - 1);
      played.get(a).add(b);
      played.get(b).add(a);
      fixtures.push({
        home: byId.get(homeId),
        away: byId.get(awayId),
        matchday: opponents + 1,
      });
    }
  });

  return fixtures;
}

function playOneMatch(home, away, { player, playerName, competition, round, rng, world, date, matchId, venue = "home" }) {
  const playerIn = home.name === playerName || away.name === playerName;
  const playerSide = home.name === playerName ? "home" : away.name === playerName ? "away" : null;
  let match = simulateMatch(home, away, {
    playerSide,
    player: playerIn ? player : null,
    competition: "europe",
    venue,
    worldState: world,
    rng,
    competitionId: competition,
    fixtureId: matchId,
    date,
  });
  match.round = round;
  match.cupName = competition;
  match.matchId = matchId;
  match.date = date;
  applyMatchFormUpdate(world, match);
  commitMatch(match, world);
  return { match, playerIn, playerSide };
}

function playKnockoutTie(a, b, {
  player,
  playerName,
  competition,
  round,
  rng,
  world,
  twoLegged,
  tieId,
  feedsInto = null,
  date = null,
  matchProcessor = null,
}) {
  if (twoLegged) {
    const firstId = `${tieId}:leg1`;
    const secondId = `${tieId}:leg2`;
    let first;
    let second;
    const playerInFirst = a.name === playerName || b.name === playerName;
    if (playerInFirst && matchProcessor) {
      const r1 = matchProcessor({ home: a, away: b, playerSide: a.name === playerName ? "home" : "away", date, label: `${round} 1st leg`, matchId: firstId });
      first = r1.match;
      first.round = `${round} 1st leg`;
    } else {
      first = playOneMatch(a, b, {
        player, playerName, competition, round: `${round} 1st leg`, rng, world, date, matchId: firstId,
      }).match;
    }
    if (playerInFirst && matchProcessor) {
      const r2 = matchProcessor({ home: b, away: a, playerSide: b.name === playerName ? "home" : "away", date, label: `${round} 2nd leg`, matchId: secondId });
      second = r2.match;
      second.round = `${round} 2nd leg`;
    } else {
      second = playOneMatch(b, a, {
        player, playerName, competition, round: `${round} 2nd leg`, rng, world, date, matchId: secondId,
      }).match;
    }
    const resolved = resolveTwoLeggedTie(first, second, {
      player: playerInFirst ? player : null,
      awayGoalsRule: false,
      rng,
    });
    const winnerSide = resolved.winnerSide;
    const winner = winnerSide === "home" ? a : b;
    const aggregateMatch = {
      home: a,
      away: b,
      homeGoals: (first.homeGoals || 0) + (second.awayGoals || 0),
      awayGoals: (first.awayGoals || 0) + (second.homeGoals || 0),
      matchHomeGoals: (first.homeGoals || 0) + (second.awayGoals || 0),
      matchAwayGoals: (first.awayGoals || 0) + (second.homeGoals || 0),
      winnerSide,
      decidedBy: resolved.decidedBy || "aggregate",
      penaltyHome: resolved.penaltyHome,
      penaltyAway: resolved.penaltyAway,
      scoreline: `${(first.homeGoals || 0) + (second.awayGoals || 0)}-${(first.awayGoals || 0) + (second.homeGoals || 0)}`,
      round,
      cupName: competition,
      tieId,
      legs: [first, second],
      isAggregate: true,
      feedsInto,
      playerSide: a.name === playerName ? "home" : b.name === playerName ? "away" : null,
    };
    if (resolved.decidedBy === "penalties" && resolved.penaltyHome != null) {
      aggregateMatch.scoreline += ` (${resolved.penaltyHome}-${resolved.penaltyAway} pens)`;
    }
    commitTie(
      {
        tieId,
        home: a,
        away: b,
        legIds: [firstId, secondId],
        winner: winner.name,
        winnerSide,
        decidedBy: aggregateMatch.decidedBy,
        feedsInto,
        round,
      },
      world
    );
    return { match: aggregateMatch, winner, legs: [first, second], playerIn: playerInFirst };
  }

  const matchId = `${tieId}:leg1`;
  let match;
  const playerIn = a.name === playerName || b.name === playerName;
  if (playerIn && matchProcessor) {
    const r = matchProcessor({
      home: a,
      away: b,
      playerSide: a.name === playerName ? "home" : "away",
      date,
      label: round,
      matchId,
    });
    match = resolveKnockout(r.match, { player, rng });
  } else {
    ({ match } = playOneMatch(a, b, {
      player, playerName, competition, round, rng, world, date, matchId, venue: "neutral",
    }));
    match = resolveKnockout(match, { player: playerIn ? player : null, rng });
  }
  match.tieId = tieId;
  match.feedsInto = feedsInto;
  const winner = match.winnerSide === "home" ? a : b;
  commitTie(
    {
      tieId,
      home: a,
      away: b,
      legIds: [matchId],
      winner: winner.name,
      winnerSide: match.winnerSide,
      decidedBy: match.decidedBy || "regulation",
      feedsInto,
      round,
    },
    world
  );
  return { match, winner, legs: [match], playerIn };
}

function buildField(competition, playerClub, size, confederation, minOverall, rng) {
  const pool = clubsFromConfederation(confederation, {
    excludeName: playerClub.name,
    excludeId: playerClub.clubId,
    limit: Math.max(size * 2, 48),
    minOverall,
  });
  const ranked = [...pool].sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));
  const cut = Math.ceil(Math.max(size, size * 1.4));
  const top = ranked.slice(0, cut);
  const rest = ranked.slice(cut);
  const others = rng
    .shuffle([...rng.shuffle(top).slice(0, size + 6), ...rng.shuffle(rest).slice(0, size)])
    .slice(0, Math.max(0, size - 1));
  let field = rng.shuffle([playerClub, ...others]);
  // Fill if pool short
  while (field.length < size && rest.length) {
    const next = rest.shift();
    if (!field.some((c) => clubKey(c) === clubKey(next))) field.push(next);
  }
  if (field.length < size) {
    // Documented shrink — never invent clubs
    field = field.slice(0, field.length - (field.length % 2 === 0 ? 0 : 1));
  }
  return field.slice(0, size);
}

function confederationForCompetition(name) {
  if (name.includes("Libertadores") || name.includes("Sudamericana")) return "CONMEBOL";
  if (name.includes("CONCACAF")) return "CONCACAF";
  if (name.includes("AFC")) return "AFC";
  if (name.includes("CAF")) return "CAF";
  return "UEFA";
}

function minOverallFor(name) {
  if (name === "Champions League") return 70;
  if (name === "Europa League") return 64;
  if (name === "Conference League") return 58;
  if (name === "Copa Libertadores") return 66;
  if (name === "Copa Sudamericana") return 58;
  if (name === "AFC Champions League Elite") return 62;
  if (name === "CAF Champions League") return 58;
  return 55;
}

function simulateLeaguePhase(field, format, { player, playerName, competition, rng, world }) {
  const lp = format.leaguePhase;
  const fixtures = buildLeaguePhaseSchedule(
    field,
    lp.opponentsPerClub,
    lp.homeAway.home,
    rng
  );
  const rows = new Map(field.map((t) => [clubKey(t), emptyRow(t)]));
  const matches = [];
  const playerMatches = [];

  fixtures.forEach((fx, i) => {
    const matchId = `${competition}:lp:${i}`;
    const { match, playerIn } = playOneMatch(fx.home, fx.away, {
      player,
      playerName,
      competition,
      round: `League phase MD${fx.matchday}`,
      rng,
      world,
      matchId,
    });
    match.matchday = fx.matchday;
    matches.push(match);
    applyResultToRow(rows.get(clubKey(fx.home)), match.homeGoals, match.awayGoals);
    applyResultToRow(rows.get(clubKey(fx.away)), match.awayGoals, match.homeGoals);
    if (playerIn) playerMatches.push(match);
  });

  const table = sortTableRows([...rows.values()]).map((r, i) => {
    r.position = i + 1;
    if (r.position <= lp.advanceDirect) r.band = "R16";
    else if (lp.advancePlayoff && r.position >= lp.advancePlayoff[0] && r.position <= lp.advancePlayoff[1]) {
      r.band = "playoff";
    } else r.band = "eliminated";
    return r;
  });

  return { table, matches, playerMatches, fixtures };
}

function simulateGroups(field, format, { player, playerName, competition, rng, world }) {
  const g = format.groups;
  const groups = [];
  const allMatches = [];
  const playerMatches = [];
  const thirds = [];

  for (let gi = 0; gi < g.groupCount; gi++) {
    const teams = field.slice(gi * g.groupSize, (gi + 1) * g.groupSize);
    if (teams.length < g.groupSize) break;
    const rows = new Map(teams.map((t) => [clubKey(t), emptyRow(t)]));
    const groupMatches = [];
    // Round robin: home-and-away when configured, else single RR
    for (let i = 0; i < teams.length; i++) {
      for (let j = 0; j < teams.length; j++) {
        if (i === j) continue;
        if (!g.homeAndAway && i > j) continue;
        const home = teams[i];
        const away = teams[j];
        const matchId = `${competition}:g${gi}:${clubKey(home)}:${clubKey(away)}`;
        const { match, playerIn } = playOneMatch(home, away, {
          player,
          playerName,
          competition,
          round: `Group ${String.fromCharCode(65 + gi)}`,
          rng,
          world,
          matchId,
        });
        groupMatches.push(match);
        allMatches.push(match);
        applyResultToRow(rows.get(clubKey(home)), match.homeGoals, match.awayGoals);
        applyResultToRow(rows.get(clubKey(away)), match.awayGoals, match.homeGoals);
        if (playerIn) playerMatches.push(match);
      }
    }
    const table = sortTableRows([...rows.values()]).map((r, i) => ({ ...r, position: i + 1 }));
    const advance = g.advancePerGroup || (g.advanceWinners ? 1 : 2);
    const qualifiers = table.slice(0, advance).map((r) => r.team);
    if (table[2]) thirds.push({ ...table[2], groupIndex: gi });
    groups.push({
      name: `Group ${String.fromCharCode(65 + gi)}`,
      table,
      matches: groupMatches,
      qualifiers,
      third: table[2]?.team || null,
    });
  }

  return { groups, matches: allMatches, playerMatches, thirds };
}

function simulateKnockoutPath(seeds, format, { player, playerName, competition, rng, world, startLabel = null }) {
  const twoLeggedSet = new Set(format.knockout?.twoLeggedUntil || []);
  let remaining = [...seeds];
  const allRounds = [];
  const playerMatches = [];
  const rounds = [];
  let eliminatedRound = null;
  const feederGraph = [];

  // Concacaf special: R1 with byes
  if (format.competitionId === "concacaf-champions-cup" && remaining.length === 27) {
    const byes = remaining.slice(0, 5);
    const r1Field = remaining.slice(5);
    const r1Matches = [];
    const r1Winners = [];
    for (let i = 0; i < r1Field.length; i += 2) {
      const tieId = `${competition}:R1:${i / 2}`;
      const { match, winner, playerIn, legs } = playKnockoutTie(r1Field[i], r1Field[i + 1], {
        player, playerName, competition, round: "Round One", rng, world,
        twoLegged: true, tieId, feedsInto: "R16",
      });
      r1Matches.push(match);
      r1Winners.push(winner);
      feederGraph.push({ tieId, feedsInto: null, round: "Round One" });
      if (playerIn) {
        playerMatches.push(...(legs || [match]));
        if (winner.name !== playerName) eliminatedRound = "Round One";
        const last = legs?.[legs.length - 1] || match;
        rounds.push({
          round: "Round One",
          opponent: (last.playerSide === "home" ? last.away : last.home)?.displayName,
          opponentBadge: (last.playerSide === "home" ? last.away : last.home)?.badge,
          score: formatMatchScoreline(match, { fromPlayerSide: match.playerSide }),
          qualified: winner.name === playerName,
          match,
        });
      }
    }
    allRounds.push({ round: "Round One", matches: r1Matches });
    remaining = rng.shuffle([...byes, ...r1Winners]);
  }

  while (remaining.length > 1) {
    if (remaining.length % 2 === 1) {
      // Explicit bye for strongest
      remaining = [...remaining].sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));
      const bye = remaining.shift();
      const label = roundLabel(remaining.length + 1);
      allRounds.push({
        round: label,
        matches: [{
          home: bye,
          away: { name: "__bye__", displayName: "Bye", isBye: true },
          isBye: true,
          scoreline: "bye",
          winnerSide: "home",
          homeGoals: 0,
          awayGoals: 0,
          tieId: `${competition}:${label}:bye`,
          feedsInto: remaining.length === 1 ? "Final" : null,
        }],
      });
      remaining = [bye, ...remaining];
      if (remaining.length % 2 === 1) remaining = remaining.slice(0, remaining.length - 1);
    }
    const label = roundLabel(remaining.length);
    const twoLegged = twoLeggedSet.has(
      label === "Round of 16" ? "R16"
        : label === "Quarter-finals" ? "QF"
          : label === "Semi-finals" ? "SF"
            : label === "Final" ? "Final"
              : label === "Round of 32" ? "R32"
                : "playoff"
    ) && label !== "Final";
    // UEFA playoff round when 16 teams from positions 9-24
    const isPlayoff = startLabel === "playoff" && label === "Round of 16" && allRounds.length === 0;
    const roundName = isPlayoff ? "Knockout playoffs" : label;
    const useTwoLeg = isPlayoff ? true : twoLegged;
    const next = [];
    const roundMatches = [];

    for (let i = 0; i < remaining.length; i += 2) {
      const tieId = `${competition}:${roundName}:${i / 2}`;
      const feedsInto =
        remaining.length === 2 ? null : `${competition}:${roundLabel(remaining.length / 2)}:${Math.floor(i / 4)}`;
      const { match, winner, playerIn, legs } = playKnockoutTie(remaining[i], remaining[i + 1], {
        player,
        playerName,
        competition,
        round: roundName,
        rng,
        world,
        twoLegged: useTwoLeg && remaining.length > 2,
        tieId,
        feedsInto,
      });
      // Final always single leg (neutral) even if listed
      next.push(winner);
      roundMatches.push(match);
      feederGraph.push({
        tieId,
        home: remaining[i].name,
        away: remaining[i + 1].name,
        winner: winner.name,
        feedsInto,
        round: roundName,
      });
      if (playerIn) {
        playerMatches.push(...(legs || [match]));
        if (winner.name !== playerName) eliminatedRound = roundName;
        rounds.push({
          round: roundName,
          opponent: (match.playerSide === "home" ? match.away : match.home)?.displayName,
          opponentBadge: (match.playerSide === "home" ? match.away : match.home)?.badge,
          score: formatMatchScoreline(match, { fromPlayerSide: match.playerSide }),
          qualified: winner.name === playerName,
          match,
        });
      }
    }
    allRounds.push({ round: roundName, matches: roundMatches });
    remaining = next;
    startLabel = null;
  }

  return {
    allRounds,
    playerMatches,
    rounds,
    eliminatedRound,
    winner: remaining[0] || null,
    feederGraph,
  };
}

function assembleCampaignResult({
  competition,
  format,
  field,
  leaguePhase,
  groups,
  ko,
  playerName,
  edition,
  qualified = true,
  showcase = false,
}) {
  const won = ko.winner?.name === playerName;
  let result = ko.eliminatedRound || (leaguePhase ? "League phase" : groups ? "Group stage" : "Round of 16");
  if (won) result = "Winners";
  else if (ko.eliminatedRound === "Final") result = "Runner-up";

  const finalRound = ko.allRounds.find((r) => r.round === "Final");
  const finalMatch = finalRound?.matches?.[0] || null;

  return {
    competition,
    competitionId: format?.competitionId || null,
    ruleVersion: format?.ruleVersion || null,
    result,
    won,
    qualified,
    showcase,
    rounds: ko.rounds,
    playerMatches: ko.playerMatches,
    allRounds: ko.allRounds,
    feederGraph: ko.feederGraph,
    leaguePhase: leaguePhase
      ? { table: leaguePhase.table, matches: leaguePhase.matches, openingLabel: "League phase" }
      : null,
    groups: groups
      ? { groups: groups.groups, matches: groups.matches, openingLabel: "Group stage", thirds: groups.thirds }
      : null,
    finalMatch,
    finalists: finalMatch ? [{ ...finalMatch.home }, { ...finalMatch.away }] : null,
    winner: ko.winner?.displayName ?? null,
    winnerData: ko.winner
      ? {
          name: ko.winner.name,
          displayName: ko.winner.displayName,
          badge: ko.winner.badge,
          clubId: ko.winner.clubId,
        }
      : null,
    field: field.map((c) => ({ name: c.name, displayName: c.displayName, clubId: c.clubId, badge: c.badge })),
    editionId: edition?.editionId || null,
  };
}

/**
 * Full continental campaign for the player's qualified club.
 */
export function simulateContinentalCampaign({ standing, league, player, seasonYear = null }) {
  const competition = continentalCompetitionForStanding(standing, league);
  if (!competition) return null;

  const format = formatForCompetitionName(competition);
  const rng = getSimRng();
  const world = getWorldState();
  const playerClub = playerClubEntry(player, league);
  const eff = effectiveTeamStrength(playerClub, {
    player,
    playerSide: "home",
    side: "home",
    worldState: world,
  });
  playerClub.overall = eff.profile?.overall ?? playerClub.overall;

  const confederation = confederationForCompetition(competition);
  const targetSize = format?.fieldSize || 16;
  let field = buildField(
    competition,
    playerClub,
    targetSize,
    confederation,
    minOverallFor(competition),
    rng
  );

  // Concacaf needs exactly 27 when possible
  if (competition === "CONCACAF Champions Cup") {
    field = buildField(competition, playerClub, 27, "CONCACAF", 55, rng);
    if (field.length < 16) {
      field = buildField(competition, playerClub, 16, "CONCACAF", 50, rng);
    }
  }

  // AFC regional split: 16 West / 16 East when possible
  if (competition === "AFC Champions League Elite" && field.length >= 24) {
    const westNations = new Set(["Saudi Arabia"]);
    const eastNations = new Set(["Japan", "South Korea"]);
    const west = field.filter((c) => westNations.has(c.nation));
    const east = field.filter((c) => eastNations.has(c.nation));
    const rest = field.filter((c) => !westNations.has(c.nation) && !eastNations.has(c.nation));
    while (west.length < 16 && rest.length) west.push(rest.shift());
    while (east.length < 16 && rest.length) east.push(rest.shift());
    field = [...west.slice(0, 16), ...east.slice(0, 16)];
  }

  const editionId = `${seasonYear || world?.seasonYear || 2026}-${format?.competitionId || competition}`;
  const edition = createEdition({
    competitionId: format?.competitionId || competition,
    editionId,
    name: competition,
    ruleVersion: format?.ruleVersion || "game",
    kind: "club",
    confederation,
    participants: field,
    stages: [],
    seasonYear: seasonYear || world?.seasonYear,
  });

  let leaguePhase = null;
  let groups = null;
  let koSeeds = field;
  let startLabel = null;

  if (format?.openingPhase === "league") {
    // Regional AFC: two league phases of 16
    if (format.leaguePhase?.regionalSplit && field.length === 32) {
      const west = field.slice(0, 16);
      const east = field.slice(16);
      const westLp = simulateLeaguePhase(west, { ...format, leaguePhase: { ...format.leaguePhase, advanceDirect: 8, advancePlayoff: null } }, {
        player, playerName: playerClub.name, competition, rng, world,
      });
      const eastLp = simulateLeaguePhase(east, { ...format, leaguePhase: { ...format.leaguePhase, advanceDirect: 8, advancePlayoff: null } }, {
        player, playerName: playerClub.name, competition, rng, world,
      });
      leaguePhase = {
        table: [...westLp.table, ...eastLp.table],
        matches: [...westLp.matches, ...eastLp.matches],
        playerMatches: [...westLp.playerMatches, ...eastLp.playerMatches],
        regional: { west: westLp.table, east: eastLp.table },
      };
      koSeeds = [
        ...westLp.table.filter((r) => r.band === "R16").map((r) => r.team),
        ...eastLp.table.filter((r) => r.band === "R16").map((r) => r.team),
      ];
    } else {
      leaguePhase = simulateLeaguePhase(field, format, {
        player,
        playerName: playerClub.name,
        competition,
        rng,
        world,
      });
      const direct = leaguePhase.table.filter((r) => r.band === "R16").map((r) => r.team);
      const playoff = leaguePhase.table.filter((r) => r.band === "playoff").map((r) => r.team);
      if (playoff.length >= 2) {
        const playoffKo = simulateKnockoutPath(playoff, format, {
          player,
          playerName: playerClub.name,
          competition,
          rng,
          world,
          startLabel: "playoff",
        });
        // playoff produces 8 winners to join direct 8
        const playoffWinners = playoffKo.allRounds.length
          ? playoff.slice(0, 8).map((_, i) => {
              // winners of playoff round (8 ties → 8 winners)
              const round = playoffKo.allRounds[0];
              return round.matches[i] ? (round.matches[i].winnerSide === "home" ? round.matches[i].home : round.matches[i].away) : playoff[i * 2];
            })
          : playoff.slice(0, 8);
        // Merge playoff first round into allRounds later
        const playoffWinnersResolved = (playoffKo.allRounds[0]?.matches || []).map((m) =>
          m.winnerSide === "home" ? m.home : m.away
        );
        koSeeds = rng.shuffle([...direct, ...playoffWinnersResolved]);
        // Prepend playoff round
        const ko = simulateKnockoutPath(koSeeds, format, {
          player,
          playerName: playerClub.name,
          competition,
          rng,
          world,
        });
        ko.allRounds = [...playoffKo.allRounds.slice(0, 1), ...ko.allRounds];
        ko.playerMatches = [...playoffKo.playerMatches, ...ko.playerMatches];
        ko.rounds = [...playoffKo.rounds, ...ko.rounds];
        ko.feederGraph = [...playoffKo.feederGraph, ...ko.feederGraph];
        if (playoffKo.eliminatedRound && !ko.eliminatedRound) ko.eliminatedRound = playoffKo.eliminatedRound;
        ko.playerMatches = [...leaguePhase.playerMatches, ...ko.playerMatches];
        edition.champion = ko.winner
          ? { name: ko.winner.name, displayName: ko.winner.displayName, clubId: ko.winner.clubId }
          : null;
        edition.status = "complete";
        commitEdition(edition, world);
        return assembleCampaignResult({
          competition,
          format,
          field,
          leaguePhase,
          groups: null,
          ko,
          playerName: playerClub.name,
          edition,
        });
      }
      koSeeds = direct.length >= 2 ? direct : field.slice(0, 16);
    }
  } else if (format?.openingPhase === "groups") {
    // Adjust field to group capacity
    const need = (format.groups.groupCount || 8) * (format.groups.groupSize || 4);
    if (field.length > need) field = field.slice(0, need);
    if (field.length < need) {
      // shrink groups
      const gs = format.groups.groupSize;
      const gc = Math.floor(field.length / gs);
      field = field.slice(0, gc * gs);
    }
    groups = simulateGroups(field, format, {
      player,
      playerName: playerClub.name,
      competition,
      rng,
      world,
    });
    koSeeds = groups.groups.flatMap((g) => g.qualifiers);
  }

  const ko = simulateKnockoutPath(koSeeds, format || { knockout: { twoLeggedUntil: [] } }, {
    player,
    playerName: playerClub.name,
    competition,
    rng,
    world,
    startLabel,
  });
  if (leaguePhase) {
    ko.playerMatches = [...leaguePhase.playerMatches, ...ko.playerMatches];
  }
  if (groups) {
    ko.playerMatches = [...groups.playerMatches, ...ko.playerMatches];
  }

  edition.champion = ko.winner
    ? { name: ko.winner.name, displayName: ko.winner.displayName, clubId: ko.winner.clubId }
    : null;
  edition.status = "complete";
  commitEdition(edition, world);

  return assembleCampaignResult({
    competition,
    format,
    field,
    leaguePhase,
    groups,
    ko,
    playerName: playerClub.name,
    edition,
  });
}

/**
 * Patch campaign after chronological player re-sim: replace matching ties in allRounds
 * and re-simulate subsequent knockout rounds from the divergence point.
 * Prefer progressive simulation; this is a safety net for legacy call sites.
 */
export function reconcileCampaignWithPlayerMatches(campaign, playerMatches) {
  if (!campaign || !playerMatches?.length) return campaign;
  const byRound = new Map();
  playerMatches.forEach((m) => {
    const key = m.round || "";
    byRound.set(key, m);
  });
  const allRounds = (campaign.allRounds || []).map((round) => ({
    ...round,
    matches: (round.matches || []).map((m) => {
      const replacement = playerMatches.find(
        (pm) =>
          (pm.tieId && pm.tieId === m.tieId) ||
          (pm.round === m.round &&
            ((pm.home?.name === m.home?.name && pm.away?.name === m.away?.name) ||
              (pm.home?.name === m.away?.name && pm.away?.name === m.home?.name)))
      );
      return replacement || m;
    }),
  }));
  return {
    ...campaign,
    allRounds,
    playerMatches,
  };
}
