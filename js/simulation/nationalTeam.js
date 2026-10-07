import {
  allTournamentNations,
  confederationForNation,
  flagForNation,
  nationsInConfederation,
  tournamentsForYear,
} from "../data/internationalCalendar.js?v=47";
import { clamp, pickRandom, randFloat } from "../utils/helpers.js";
import { resolveKnockout, simulateMatch } from "./matchEngine.js?v=45";

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function nationTeam(name) {
  return {
    name,
    displayName: name,
    badge: flagForNation(name),
    financialTier: 3,
    tier: 4,
    isNation: true,
  };
}

function strengthForNation(name, playerNation, playerRating) {
  // Rough tiering: big nations stronger
  const elite = new Set([
    "Brazil",
    "France",
    "Argentina",
    "Spain",
    "Germany",
    "England",
    "Portugal",
    "Netherlands",
    "Italy",
    "Belgium",
  ]);
  const strong = new Set([
    "Uruguay",
    "Croatia",
    "Denmark",
    "Switzerland",
    "Colombia",
    "Mexico",
    "Japan",
    "Senegal",
    "Morocco",
    "USA",
    "United States",
    "Serbia",
    "Poland",
    "Turkey",
    "South Korea",
    "Nigeria",
  ]);
  let base = elite.has(name) ? 86 : strong.has(name) ? 76 : 64;
  if (name === playerNation) base = Math.max(base, 58 + (playerRating - 60) * 0.35);
  return clamp(base + randFloat(-5, 5), 45, 95);
}

/** Call-up probability from OVR + season form (avg match rating). */
export function nationalCallUpChance(player, avgMatchRating = 6.8) {
  const r = player.rating || 60;
  let chance;
  if (r < 64) chance = 0.03;
  else if (r < 68) chance = 0.08;
  else if (r < 72) chance = 0.16;
  else if (r < 76) chance = 0.28;
  else if (r < 80) chance = 0.45;
  else if (r < 84) chance = 0.62;
  else if (r < 88) chance = 0.78;
  else chance = 0.9;

  const form = Number(avgMatchRating) || 6.8;
  if (form >= 8.2) chance += 0.14;
  else if (form >= 7.7) chance += 0.09;
  else if (form >= 7.2) chance += 0.04;
  else if (form < 6.2) chance -= 0.12;
  else if (form < 6.6) chance -= 0.06;

  // Youngsters get a small look-in; veterans slightly preferred once established
  if (player.age <= 21) chance += 0.03;
  if (player.age >= 33) chance -= 0.04;

  // Club level hint
  const ft = player.club?.financialTier ?? 2;
  if (ft >= 4) chance += 0.04;
  if (ft <= 2) chance -= 0.03;

  return clamp(chance, 0.01, 0.96);
}

function pickCallUpMessage({ calledUp, chance, player, tournamentName }) {
  const pct = Math.round(chance * 100);
  if (calledUp) {
    if (chance < 0.28) {
      return pickRandom([
        `Surprise call-up: the ${player.nationality} manager has taken a personal liking to your game (${pct}% chance).`,
        `A late injury in the squad opened the door — you're on the plane for the ${tournamentName}.`,
        `The federation is blooding youth. You've been handed a chance few expected at your level.`,
        `Club form tipped the balance. Scouts pushed hard and the manager listened.`,
      ]);
    }
    if (chance < 0.55) {
      return pickRandom([
        `You've been named in the ${player.nationality} squad for the ${tournamentName}.`,
        `International duty: selected for ${tournamentName} after a solid club season.`,
        `The manager trusts your minutes. You're in for the ${tournamentName}.`,
      ]);
    }
    return pickRandom([
      `As expected, you're locked into the ${player.nationality} squad for the ${tournamentName}.`,
      `Automatic pick: named among the first names for ${tournamentName}.`,
      `No surprises — you're central to ${player.nationality}'s plans at the ${tournamentName}.`,
    ]);
  }

  // Not called up
  if (chance >= 0.7) {
    return pickRandom([
      `Shock omission: a new ${player.nationality} manager is reshaping the squad and left you out.`,
      `You were favourite to go (${pct}%), but the coach prefers a different profile in your position.`,
      `Politics at the federation. A crowded squad list squeezed you out of the ${tournamentName}.`,
      `Rotation call — the manager "rested" established names. You're watching this one from home.`,
    ]);
  }
  if (chance >= 0.4) {
    return pickRandom([
      `Close, but not this time. ${player.nationality} went with experience ahead of you for the ${tournamentName}.`,
      `You were discussed. The final cut came down to form elsewhere.`,
      `Near miss: provisional lists had your name; the confirmed squad did not.`,
    ]);
  }
  return pickRandom([
    `No call-up for the ${tournamentName}. Keep performing and the door may open.`,
    `${player.nationality}'s squad is set — you're not in it this window.`,
    `International break without you. Focus stays on club football for now.`,
  ]);
}

function buildField(tournament, playerNation, ensurePlayerNation) {
  let pool;
  if (tournament.confederation === "FIFA") {
    pool = allTournamentNations();
  } else {
    pool = nationsInConfederation(tournament.confederation);
  }
  if (!pool.length) pool = allTournamentNations();

  // Seed stronger nations more often into major tournaments
  const ranked = [...pool]
    .map((name) => ({ name, seed: strengthForNation(name, playerNation, 75) + randFloat(-6, 6) }))
    .sort((a, b) => b.seed - a.seed)
    .map((x) => x.name);
  const cut = Math.ceil(tournament.fieldSize * 0.7);
  const top = ranked.slice(0, cut);
  const rest = ranked.slice(cut);
  let field = shuffle([
    ...shuffle(top).slice(0, Math.min(top.length, Math.max(2, tournament.fieldSize - 2))),
    ...shuffle(rest).slice(0, Math.max(2, tournament.fieldSize - top.length)),
  ]).slice(0, tournament.fieldSize);

  if (ensurePlayerNation && playerNation && !field.includes(playerNation)) {
    field[field.length - 1] = playerNation;
    field = shuffle(field);
  }
  while (field.length < Math.min(4, tournament.fieldSize)) {
    const extra = pickRandom(allTournamentNations());
    if (!field.includes(extra)) field.push(extra);
  }
  const usable = tournament.fieldSize - (tournament.fieldSize % tournament.groupSize);
  return field.slice(0, usable);
}

function simulateGroup(teams, { playerNation, player, playerInSquad }) {
  const records = teams.map((name) => ({
    name,
    displayName: name,
    badge: flagForNation(name),
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    gf: 0,
    ga: 0,
    points: 0,
  }));
  const byName = Object.fromEntries(records.map((r) => [r.name, r]));
  const matches = [];
  const playerMatches = [];

  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const aName = teams[i];
      const bName = teams[j];
      const a = nationTeam(aName);
      const b = nationTeam(bName);
      a.financialTier = Math.max(1, Math.round(strengthForNation(aName, playerNation, player.rating) / 18));
      b.financialTier = Math.max(1, Math.round(strengthForNation(bName, playerNation, player.rating) / 18));
      a.tier = Math.max(1, Math.round(strengthForNation(aName, playerNation, player.rating) / 20));
      b.tier = Math.max(1, Math.round(strengthForNation(bName, playerNation, player.rating) / 20));

      const playerIn =
        playerInSquad && (aName === playerNation || bName === playerNation)
          ? aName === playerNation
            ? "home"
            : "away"
          : null;

      let match = simulateMatch(a, b, {
        playerSide: playerIn,
        player: playerIn ? player : null,
        competition: "international",
      });
      match.round = "Group stage";
      match.cupName = "International";
      matches.push(match);
      if (playerIn) playerMatches.push(match);

      const home = byName[aName];
      const away = byName[bName];
      home.played += 1;
      away.played += 1;
      home.gf += match.homeGoals;
      home.ga += match.awayGoals;
      away.gf += match.awayGoals;
      away.ga += match.homeGoals;
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
    }
  }

  const table = records
    .map((r) => ({ ...r, gd: r.gf - r.ga }))
    .sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf);

  return { table, matches, playerMatches, qualifiers: table.slice(0, 2).map((t) => t.name) };
}

function simulateKnockout(teams, { playerNation, player, playerInSquad, competitionName }) {
  let remaining = teams.map(nationTeam);
  const playerMatches = [];
  const rounds = [];
  const allRounds = [];
  let eliminatedRound = null;

  const labelFor = (n) => {
    if (n === 2) return "Final";
    if (n === 4) return "Semi-finals";
    if (n === 8) return "Quarter-finals";
    if (n === 16) return "Round of 16";
    return `Round of ${n}`;
  };

  while (remaining.length > 1) {
    if (remaining.length % 2 === 1) remaining.push(nationTeam(pickRandom(allTournamentNations())));
    const label = labelFor(remaining.length);
    const next = [];
    const roundMatches = [];

    for (let i = 0; i < remaining.length; i += 2) {
      const a = remaining[i];
      const b = remaining[i + 1];
      a.financialTier = Math.max(1, Math.round(strengthForNation(a.name, playerNation, player.rating) / 18));
      b.financialTier = Math.max(1, Math.round(strengthForNation(b.name, playerNation, player.rating) / 18));
      a.tier = Math.max(1, Math.round(strengthForNation(a.name, playerNation, player.rating) / 20));
      b.tier = Math.max(1, Math.round(strengthForNation(b.name, playerNation, player.rating) / 20));

      const playerIn =
        playerInSquad && (a.name === playerNation || b.name === playerNation)
          ? a.name === playerNation
            ? "home"
            : "away"
          : null;

      let match = simulateMatch(a, b, {
        playerSide: playerIn,
        player: playerIn ? player : null,
        competition: "international",
      });
      match = resolveKnockout(match);
      match.round = label;
      match.cupName = competitionName;
      const winner = match.winnerSide === "home" ? a : b;
      next.push(winner);
      roundMatches.push(match);

      if (playerIn) {
        playerMatches.push(match);
        if (winner.name !== playerNation) eliminatedRound = label;
      }
    }

    allRounds.push({ round: label, matches: roundMatches });
    if (playerMatches.length) {
      const last = playerMatches[playerMatches.length - 1];
      if (last.round === label) {
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
    }
    remaining = next;
  }

  const winner = remaining[0];
  const finalMatch = allRounds.find((r) => r.round === "Final")?.matches?.[0] || null;
  const won = winner?.name === playerNation && playerInSquad;

  let result = eliminatedRound || "Group stage";
  if (won) result = "Winners";
  else if (eliminatedRound === "Final") result = "Runner-up";
  else if (!playerInSquad) result = "Not in squad";

  return {
    rounds,
    playerMatches,
    allRounds,
    finalMatch,
    finalists: finalMatch ? [finalMatch.home, finalMatch.away] : null,
    winner: winner?.displayName ?? null,
    winnerData: winner
      ? { name: winner.name, displayName: winner.displayName, badge: winner.badge }
      : null,
    won,
    result,
  };
}

function simulateOneTournament(tournament, player, { calledUp, avgMatchRating, ensurePlayerNation }) {
  const playerNation = player.nationality;
  const field = buildField(
    tournament,
    playerNation,
    Boolean(calledUp || ensurePlayerNation)
  );
  const groupSize = tournament.groupSize || 4;
  const groups = [];
  const allPlayerMatches = [];

  for (let g = 0; g < field.length / groupSize; g++) {
    const teams = field.slice(g * groupSize, (g + 1) * groupSize);
    const group = simulateGroup(teams, {
      playerNation,
      player,
      playerInSquad: calledUp,
    });
    groups.push({
      name: `Group ${String.fromCharCode(65 + g)}`,
      ...group,
    });
    allPlayerMatches.push(...group.playerMatches);
  }

  // Knockout: top 2 from each group
  let knockoutTeams = groups.flatMap((g) => g.qualifiers);
  // Ensure power of 2
  while (knockoutTeams.length > 2 && knockoutTeams.length % 2 === 1) {
    knockoutTeams.pop();
  }
  if (knockoutTeams.length < 2) {
    knockoutTeams = shuffle(field).slice(0, 4);
  }

  const ko = simulateKnockout(knockoutTeams, {
    playerNation,
    player,
    playerInSquad: calledUp,
    competitionName: tournament.name,
  });
  allPlayerMatches.push(...ko.playerMatches);

  return {
    id: tournament.id,
    name: tournament.name,
    shortName: tournament.shortName,
    confederation: tournament.confederation,
    year: tournament.year,
    calledUp,
    groups,
    ...ko,
    playerMatches: allPlayerMatches,
    playerNationInTournament: field.includes(playerNation),
  };
}

/**
 * Full international window for a season.
 * @param {object} opts
 * @param {object} opts.player
 * @param {number} opts.calendarYear
 * @param {number} opts.avgMatchRating
 */
export function simulateInternationalSeason({ player, calendarYear, avgMatchRating = 6.8 }) {
  const year = calendarYear || new Date().getFullYear();
  const tournaments = tournamentsForYear(year).map((t) => ({ ...t, year }));
  const conf = confederationForNation(player.nationality);

  if (!tournaments.length) {
    return {
      year,
      confederation: conf,
      hasTournaments: false,
      calledUp: false,
      callUpChance: 0,
      announcement: `No major international tournaments in ${year}. A quiet summer on the international calendar.`,
      announcementTone: "neutral",
      tournaments: [],
      playerMatches: [],
      primary: null,
    };
  }

  // Prefer continental tournament for call-up; World Cup if available
  const relevant = tournaments.filter(
    (t) => t.confederation === "FIFA" || t.confederation === conf
  );

  if (!relevant.length) {
    const simulated = tournaments.map((t) =>
      simulateOneTournament(t, player, { calledUp: false, avgMatchRating })
    );
    return {
      year,
      confederation: conf,
      hasTournaments: true,
      calledUp: false,
      callUpChance: 0,
      callUpChancePct: 0,
      announcement: `No ${conf || "national"} major tournament this summer — watching the ${year} calendar from home.`,
      announcementTone: "neutral",
      callUpTournament: null,
      tournaments: simulated,
      playerMatches: [],
      primary: null,
    };
  }

  const callUpTarget = relevant[0];
  const chance = nationalCallUpChance(player, avgMatchRating);
  const calledUp = Math.random() < chance;

  const announcement = pickCallUpMessage({
    calledUp,
    chance,
    player,
    tournamentName: callUpTarget.name,
  });
  let announcementTone = "neutral";
  if (calledUp && chance < 0.28) announcementTone = "surprise-in";
  else if (calledUp) announcementTone = "called-up";
  else if (!calledUp && chance >= 0.7) announcementTone = "shock-out";
  else announcementTone = "out";

  const simulated = tournaments.map((t) => {
    const playIn = calledUp && t.id === callUpTarget.id;
    const ensureNation = t.id === callUpTarget.id;
    const result = simulateOneTournament(t, player, {
      calledUp: playIn,
      avgMatchRating,
      ensurePlayerNation: ensureNation,
    });
    result.calledUp = playIn;
    return result;
  });

  const primary = simulated.find((t) => t.calledUp) || null;
  const playerMatches = primary?.playerMatches || [];

  return {
    year,
    confederation: conf,
    hasTournaments: true,
    calledUp,
    callUpChance: parseFloat(chance.toFixed(3)),
    callUpChancePct: Math.round(chance * 100),
    announcement,
    announcementTone,
    callUpTournament: callUpTarget.name,
    tournaments: simulated,
    playerMatches,
    primary,
  };
}
