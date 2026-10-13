/**
 * Selection and minutes policy for the user player.
 * Uses role ability vs a simulation-policy starter benchmark (not real roster data).
 */
import { clamp } from "../utils/helpers.js";
import { getCurrentOverall } from "./playerAbility.js";
import { isAvailable } from "./playerHealth.js";

/** Softplus-style sigmoid. */
function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Simulation-policy starter benchmark for the player's role at a club.
 * Derived from team quality — not claimed real roster data.
 */
export function roleStarterBenchmark(teamProfile, position) {
  const overall = Number(teamProfile?.overall) || 70;
  const replacement = teamProfile?.replacementOvr?.[position];
  if (Number.isFinite(replacement)) {
    return replacement + 3.5;
  }
  // Starters sit a few points above squad overall at strong clubs.
  return overall + clamp((overall - 72) * 0.08, -1, 3);
}

/**
 * Decide selected / started / minutes for one fixture.
 * @returns {{ selected, started, minutes, availableMinutes, available, nonParticipationReason, role }}
 */
export function resolvePlayerParticipation(player, {
  date = null,
  teamProfile = null,
  matchDuration = 90,
  competitionPriority = 1,
  promisedRoleAdj = 0,
  rng,
} = {}) {
  const available = isAvailable(player?.health, date);
  if (!available) {
    return {
      selected: false,
      started: false,
      minutes: 0,
      availableMinutes: matchDuration,
      available: false,
      nonParticipationReason: player?.health?.activeInjury ? "injured" : "unavailable",
      role: "unavailable",
    };
  }

  const readiness = Number(player?.state?.readiness ?? 1);
  const fatigue = Number(player?.state?.fatigue ?? 0);
  const roleFit = Number(player?.state?.roleFit ?? 1);
  const current = getCurrentOverall(player);
  const benchmark = roleStarterBenchmark(teamProfile, player.position);
  const gap = current - benchmark + clamp(promisedRoleAdj, -4, 4);
  let startProbability = sigmoid(gap / 6);

  startProbability *= clamp(0.55 + 0.45 * readiness, 0.35, 1);
  startProbability *= clamp(1 - fatigue * 0.35, 0.55, 1);
  startProbability *= clamp(0.7 + 0.3 * roleFit, 0.55, 1);
  startProbability *= clamp(0.85 + 0.15 * competitionPriority, 0.75, 1.05);
  startProbability = clamp(startProbability, 0.04, 0.97);

  const roll = rng.random();
  let started = false;
  let selected = false;
  let role = "not_selected";

  if (roll < startProbability) {
    started = true;
    selected = true;
    role = "starter";
  } else if (roll < startProbability + (1 - startProbability) * 0.55) {
    selected = true;
    role = "bench";
  } else {
    return {
      selected: false,
      started: false,
      minutes: 0,
      availableMinutes: matchDuration,
      available: true,
      nonParticipationReason: "not_selected",
      role,
    };
  }

  let minutes = 0;
  if (started) {
    // Starters: mostly full or near-full matches; rotation can cut short.
    const fullish = rng.chance(0.72);
    minutes = fullish ? rng.int(Math.min(78, matchDuration), matchDuration) : rng.int(65, Math.min(84, matchDuration));
    if (fatigue > 0.65 && rng.chance(0.35)) {
      minutes = Math.min(minutes, rng.int(55, 75));
    }
  } else {
    // Bench: meaningful sub chance
    if (rng.chance(0.62)) {
      minutes = rng.int(10, Math.min(35, matchDuration));
      role = "substitute";
    } else {
      return {
        selected: true,
        started: false,
        minutes: 0,
        availableMinutes: matchDuration,
        available: true,
        nonParticipationReason: "unused_substitute",
        role: "unused_substitute",
      };
    }
  }

  minutes = clamp(Math.round(minutes), 0, matchDuration);
  return {
    selected,
    started,
    minutes,
    availableMinutes: matchDuration,
    available: true,
    nonParticipationReason: null,
    role,
  };
}
