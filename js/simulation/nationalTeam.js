import {
  confederationForNation,
  flagForNation,
  nationsInConfederation,
  tournamentsForYear,
} from "../data/internationalCalendar.js";
import {
  COPA_AMERICA_CORE,
  COPA_AMERICA_INVITES,
} from "../data/competitions/qualification.js";
import { clamp } from "../utils/helpers.js";
import { resolveKnockout, simulateMatch, formatMatchScoreline } from "./matchEngine.js";
import { getNationProfile } from "../data/strength/nationProfiles.js";
import { getSimRng } from "./rng.js";
import { applyMatchFormUpdate, getWorldState } from "./worldState.js";

function nationTeam(name) {
  const profile = getNationProfile(name);
  return {
    name,
    displayName: name,
    badge: flagForNation(name),
    nationId: profile?.nationId,
    isNation: true,
    overall: profile?.overall,
    attack: profile?.attack,
    midfield: profile?.midfield,
    defence: profile?.defence,
    goalkeeper: profile?.goalkeeper,
    financialTier: 3,
    tier: 4,
  };
}

/** Call-up probability from OVR + form + club sporting quality (not wealth). */
export function nationalCallUpChance(player, avgMatchRating = 6.8) {
  const r = player.rating || 60;
  const nation = getNationProfile(player.nationality);
  const nationPos = nation?.replacementOvr?.[player.position] ?? nation?.overall ?? 75;
  // Relative to nation's typical starter in that role
  const relative = r - nationPos;

  let chance;
  if (relative < -12) chance = 0.03;
  else if (relative < -6) chance = 0.1;
  else if (relative < 0) chance = 0.22;
  else if (relative < 4) chance = 0.4;
  else if (relative < 8) chance = 0.58;
  else if (relative < 12) chance = 0.74;
  else chance = 0.88;

  const form = Number(avgMatchRating) || 6.8;
  if (form >= 8.2) chance += 0.14;
  else if (form >= 7.7) chance += 0.09;
  else if (form >= 7.2) chance += 0.04;
  else if (form < 6.2) chance -= 0.12;
  else if (form < 6.6) chance -= 0.06;

  if (player.age <= 21) chance += 0.03;
  if (player.age >= 33) chance -= 0.04;

  const clubOverall = player.club?.overall ?? 68;
  if (clubOverall >= 84) chance += 0.05;
  else if (clubOverall >= 76) chance += 0.02;
  else if (clubOverall <= 62) chance -= 0.04;

  return clamp(chance, 0.01, 0.96);
}

function pickCallUpMessage({ calledUp, chance, player, tournamentName }) {
  const pct = Math.round(chance * 100);
  const rng = getSimRng();
  if (calledUp) {
    if (chance < 0.28) {
      return rng.pick([
        `Surprise call-up: the ${player.nationality} manager has taken a personal liking to your game (${pct}% chance).`,
        `A late injury in the squad opened the door — you're on the plane for the ${tournamentName}.`,
        `The federation is blooding youth. You've been handed a chance few expected at your level.`,
        `Club form tipped the balance. Scouts pushed hard and the manager listened.`,
      ]);
    }
    if (chance < 0.55) {
      return rng.pick([
        `You've been named in the ${player.nationality} squad for the ${tournamentName}.`,
        `International duty: selected for ${tournamentName} after a solid club season.`,
        `The manager trusts your minutes. You're in for the ${tournamentName}.`,
      ]);
    }
    return rng.pick([
      `As expected, you're locked into the ${player.nationality} squad for the ${tournamentName}.`,
      `Automatic pick: named among the first names for ${tournamentName}.`,
      `No surprises — you're central to ${player.nationality}'s plans at the ${tournamentName}.`,
    ]);
  }

  if (chance >= 0.7) {
    return rng.pick([
      `Shock omission: a new ${player.nationality} manager is reshaping the squad and left you out.`,
      `You were favourite to go (${pct}%), but the coach prefers a different profile in your position.`,
      `Politics at the federation. A crowded squad list squeezed you out of the ${tournamentName}.`,
      `Rotation call — the manager "rested" established names. You're watching this one from home.`,
    ]);
  }
  if (chance >= 0.4) {
    return rng.pick([
      `Close, but not this time. ${player.nationality} went with experience ahead of you for the ${tournamentName}.`,
      `You were discussed. The final cut came down to form elsewhere.`,
      `Near miss: provisional lists had your name; the confirmed squad did not.`,
    ]);
  }
  return rng.pick([
    `No call-up for the ${tournamentName}. Keep performing and the door may open.`,
    `${player.nationality}'s squad is set — you're not in it this window.`,
    `International break without you. Focus stays on club football for now.`,
  ]);
}

function eligiblePool(tournament) {
  if (tournament.id === "copa-america") {
    const core = COPA_AMERICA_CORE.filter((n) => getNationProfile(n));
    const invites = COPA_AMERICA_INVITES.filter((n) => getNationProfile(n));
    return [...new Set([...core, ...invites])];
  }
  if (tournament.confederation === "FIFA") {
    return nationsInConfederation("UEFA")
      .concat(nationsInConfederation("CONMEBOL"))
      .concat(nationsInConfederation("CAF"))
      .concat(nationsInConfederation("CONCACAF"))
      .concat(nationsInConfederation("AFC"))
      .concat(nationsInConfederation("OFC"));
  }
  return nationsInConfederation(tournament.confederation);
}

/**
 * Build a valid field. Call-up does NOT force qualification.
 * ensurePlayerNation only applies when the nation is already eligible for the pool.
 */
function largestValidFieldSize(poolSize, configuredSize, groupSize) {
  const g = Math.max(2, groupSize || 4);
  let size = Math.min(configuredSize, poolSize);
  size -= size % g;
  // Prefer sizes where top-2-per-group yields a power-of-two knockout.
  while (size >= g) {
    const groups = size / g;
    const ko = groups * 2;
    if (Number.isInteger(groups) && ko >= 2 && (ko & (ko - 1)) === 0) return size;
    size -= g;
  }
  // Otherwise any multiple of group size that fits the pool.
  size = Math.min(configuredSize, poolSize);
  size -= size % g;
  return size >= g ? size : 0;
}

function buildField(tournament, playerNation, { forceIncludeEligibleNation = false } = {}) {
  const rng = getSimRng();
  const pool = [...new Set(eligiblePool(tournament))];
  if (!pool.length) {
    throw new Error(`${tournament.name}: empty eligible pool`);
  }

  const groupSize = tournament.groupSize || 4;
  let usable = largestValidFieldSize(pool.length, tournament.fieldSize, groupSize);
  if (usable < groupSize) {
    throw new Error(
      `${tournament.name}: invalid field/group config (pool=${pool.length}, field=${tournament.fieldSize}, group=${groupSize})`
    );
  }
  // Stash effective size for group loop consumers
  tournament._resolvedFieldSize = usable;

  const ranked = [...pool]
    .map((name) => ({ name, seed: getNationProfile(name)?.overall ?? 60 }))
    .sort((a, b) => b.seed - a.seed);

  const cut = Math.ceil(usable * 0.7);
  const top = ranked.slice(0, cut).map((x) => x.name);
  const rest = ranked.slice(cut).map((x) => x.name);
  let field = rng
    .shuffle([
      ...rng.shuffle(top).slice(0, Math.min(top.length, Math.max(2, usable - 2))),
      ...rng.shuffle(rest).slice(0, Math.max(0, usable)),
    ])
    .slice(0, usable);

  // Deduplicate
  field = [...new Set(field)].slice(0, usable);

  // Fill from remaining eligible only — never foreign confederations for continental cups
  const leftover = ranked.map((x) => x.name).filter((n) => !field.includes(n));
  while (field.length < usable && leftover.length) {
    field.push(leftover.shift());
  }

  if (field.length < usable) {
    // Last resort: shrink to what we can fill (still eligible-only)
    usable = largestValidFieldSize(field.length, field.length, groupSize);
    field = field.slice(0, usable);
    tournament._resolvedFieldSize = usable;
  }
  if (field.length < groupSize || field.length % groupSize !== 0) {
    throw new Error(
      `${tournament.name}: could not build valid field (have ${field.length}, need multiple of ${groupSize}) from ${pool.length} eligible nations`
    );
  }

  if (
    forceIncludeEligibleNation &&
    playerNation &&
    pool.includes(playerNation) &&
    !field.includes(playerNation)
  ) {
    // Replace weakest seeded slot — still within eligible pool
    let weakestIdx = 0;
    let weakest = Infinity;
    field.forEach((n, i) => {
      const o = getNationProfile(n)?.overall ?? 99;
      if (o < weakest) {
        weakest = o;
        weakestIdx = i;
      }
    });
    field[weakestIdx] = playerNation;
  }

  return field.slice(0, usable);
}

function simulateGroup(teams, { playerNation, player, playerInSquad }) {
  const rng = getSimRng();
  const world = getWorldState();
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

      const playerIn =
        playerInSquad && (aName === playerNation || bName === playerNation)
          ? aName === playerNation
            ? "home"
            : "away"
          : null;

      const match = simulateMatch(a, b, {
        playerSide: playerIn,
        player: playerIn ? player : null,
        competition: "international",
        venue: "neutral",
        worldState: world,
        rng,
        competitionId: "international-group",
      });
      match.round = "Group stage";
      match.cupName = "International";
      applyMatchFormUpdate(world, match);
      matches.push(match);
      if (playerIn) playerMatches.push(match);

      const home = byName[aName];
      const away = byName[bName];
      const hg = match.matchHomeGoals ?? match.homeGoals;
      const ag = match.matchAwayGoals ?? match.awayGoals;
      home.played += 1;
      away.played += 1;
      home.gf += hg;
      home.ga += ag;
      away.gf += ag;
      away.ga += hg;
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
    }
  }

  const table = records
    .map((r) => ({ ...r, gd: r.gf - r.ga }))
    .sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf);

  const qualifiersNeeded = 2;
  return {
    table,
    matches,
    playerMatches,
    qualifiers: table.slice(0, qualifiersNeeded).map((t) => t.name),
  };
}

function simulateKnockout(teams, { playerNation, player, playerInSquad, competitionName }) {
  const rng = getSimRng();
  const world = getWorldState();
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

  // Trim to power of two from actual qualifiers only — never invent nations
  let size = 1;
  while (size * 2 <= remaining.length) size *= 2;
  if (size < 2) {
    throw new Error(`${competitionName}: knockout needs at least 2 teams, got ${remaining.length}`);
  }
  if (remaining.length !== size) {
    // Keep highest group finish order as passed; drop from end
    remaining = remaining.slice(0, size);
  }

  while (remaining.length > 1) {
    if (remaining.length % 2 === 1) {
      throw new Error(`${competitionName}: odd knockout field ${remaining.length}`);
    }
    const label = labelFor(remaining.length);
    const next = [];
    const roundMatches = [];

    for (let i = 0; i < remaining.length; i += 2) {
      const a = remaining[i];
      const b = remaining[i + 1];

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
        venue: "neutral",
        worldState: world,
        rng,
        competitionId: competitionName,
      });
      match = resolveKnockout(match, { player: playerIn ? player : null, rng });
      match.round = label;
      match.cupName = competitionName;
      applyMatchFormUpdate(world, match);
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
          score: formatMatchScoreline(last, { fromPlayerSide: last.playerSide }),
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
      ? { name: winner.name, displayName: winner.displayName, badge: winner.badge, nationId: winner.nationId }
      : null,
    won,
    result,
  };
}

function simulateOneTournament(tournament, player, { calledUp, forceIncludeIfEligible }) {
  const playerNation = player.nationality;
  const pool = eligiblePool(tournament);
  const nationEligible = pool.includes(playerNation);

  // Call-up cannot invent qualification for an ineligible nation
  const field = buildField(tournament, playerNation, {
    forceIncludeEligibleNation: Boolean(forceIncludeIfEligible && nationEligible),
  });

  if (field.includes("Jordan") && tournament.id === "copa-america") {
    throw new Error("Copa América field leaked ineligible nation Jordan");
  }

  const groupSize = tournament.groupSize || 4;
  if (field.length % groupSize !== 0) {
    throw new Error(`${tournament.name}: field ${field.length} not divisible by group ${groupSize}`);
  }
  // Knockout: top 2 per group must form a power-of-two when possible
  const qualifiersPerGroup = 2;
  const expectedKo = (field.length / groupSize) * qualifiersPerGroup;
  if (expectedKo < 2) {
    throw new Error(`${tournament.name}: knockout would have fewer than 2 teams`);
  }

  const groups = [];
  const allPlayerMatches = [];
  const playerActuallyIn =
    Boolean(calledUp) && nationEligible && field.includes(playerNation);

  for (let g = 0; g < field.length / groupSize; g++) {
    const teams = field.slice(g * groupSize, (g + 1) * groupSize);
    const group = simulateGroup(teams, {
      playerNation,
      player,
      playerInSquad: playerActuallyIn,
    });
    groups.push({
      name: `Group ${String.fromCharCode(65 + g)}`,
      ...group,
    });
    allPlayerMatches.push(...group.playerMatches);
  }

  let knockoutTeams = groups.flatMap((g) => g.qualifiers);
  // Must be power of 2 from real qualifiers only
  let koSize = 1;
  while (koSize * 2 <= knockoutTeams.length) koSize *= 2;
  if (koSize < 2) {
    throw new Error(`${tournament.name}: not enough group qualifiers for knockout`);
  }
  knockoutTeams = knockoutTeams.slice(0, koSize);

  const ko = simulateKnockout(knockoutTeams, {
    playerNation,
    player,
    playerInSquad: playerActuallyIn,
    competitionName: tournament.name,
  });
  allPlayerMatches.push(...ko.playerMatches);

  return {
    id: tournament.id,
    name: tournament.name,
    shortName: tournament.shortName,
    confederation: tournament.confederation,
    year: tournament.year,
    calledUp: playerActuallyIn,
    groups,
    ...ko,
    playerMatches: allPlayerMatches,
    playerNationInTournament: field.includes(playerNation),
    field,
  };
}

export function simulateInternationalSeason({ player, calendarYear, avgMatchRating = 6.8 }) {
  const rng = getSimRng();
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

  const relevant = tournaments.filter(
    (t) => t.confederation === "FIFA" || t.confederation === conf
  );

  if (!relevant.length) {
    const simulated = tournaments.map((t) =>
      simulateOneTournament(t, player, { calledUp: false, forceIncludeIfEligible: false })
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
  const pool = eligiblePool(callUpTarget);
  const nationEligible = pool.includes(player.nationality);

  // Qualification/participation decided first; call-up only if nation is in the field path
  const chance = nationEligible ? nationalCallUpChance(player, avgMatchRating) : 0;
  const calledUp = nationEligible && rng.random() < chance;

  const announcement = nationEligible
    ? pickCallUpMessage({
        calledUp,
        chance,
        player,
        tournamentName: callUpTarget.name,
      })
    : `${player.nationality} are not in the ${callUpTarget.name} field this cycle.`;

  let announcementTone = "neutral";
  if (!nationEligible) announcementTone = "neutral";
  else if (calledUp && chance < 0.28) announcementTone = "surprise-in";
  else if (calledUp) announcementTone = "called-up";
  else if (!calledUp && chance >= 0.7) announcementTone = "shock-out";
  else announcementTone = "out";

  const simulated = tournaments.map((t) => {
    const playIn = calledUp && t.id === callUpTarget.id;
    // Prefer including eligible nation in their continental/WC tournament for storytelling,
    // but never for Copa if not eligible, and never invent nations.
    const forceInclude = t.id === callUpTarget.id && nationEligible;
    const result = simulateOneTournament(t, player, {
      calledUp: playIn,
      forceIncludeIfEligible: forceInclude,
    });
    result.calledUp = playIn && result.playerNationInTournament;
    return result;
  });

  const primary = simulated.find((t) => t.calledUp) || null;
  const playerMatches = primary?.playerMatches || [];

  return {
    year,
    confederation: conf,
    hasTournaments: true,
    calledUp: Boolean(primary),
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
