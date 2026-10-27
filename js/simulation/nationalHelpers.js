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

export function nationTeam(name) {
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

export function pickCallUpMessage({ calledUp, chance, player, tournamentName }) {
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

export function eligiblePool(tournament) {
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
export function largestValidFieldSize(poolSize, configuredSize, groupSize, bestThirds = 0) {
  const g = Math.max(2, groupSize || 4);
  let size = Math.min(configuredSize, poolSize);
  size -= size % g;
  // Prefer sizes where top-2 + best-thirds yields a power-of-two knockout.
  while (size >= g) {
    const groups = size / g;
    if (!Number.isInteger(groups)) {
      size -= g;
      continue;
    }
    const thirds = Math.min(bestThirds || 0, groups);
    const ko = groups * 2 + thirds;
    if (ko >= 2 && (ko & (ko - 1)) === 0) return size;
    size -= g;
  }
  // Otherwise any multiple of group size that fits the pool.
  size = Math.min(configuredSize, poolSize);
  size -= size % g;
  return size >= g ? size : 0;
}

export function buildField(tournament, playerNation, { forceIncludeEligibleNation = false } = {}) {
  const rng = getSimRng();
  const pool = [...new Set(eligiblePool(tournament))];
  if (!pool.length) {
    throw new Error(`${tournament.name}: empty eligible pool`);
  }

  const groupSize = tournament.groupSize || 4;
  const bestThirds = tournament.bestThirds || 0;
  let usable = largestValidFieldSize(pool.length, tournament.fieldSize, groupSize, bestThirds);
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
    usable = largestValidFieldSize(field.length, field.length, groupSize, bestThirds);
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

