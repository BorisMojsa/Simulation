import { resetClubFinanceLedgers } from "../../js/simulation/clubFinance.js";
import { createWorldState, setWorldState } from "../../js/simulation/worldState.js";
import { createRng, hashSeed, reseedCareerRng } from "../../js/simulation/rng.js";

/** Isolate mutable world / finance / sim RNG for one career. */
export function resetCareerState(seed, startYear = 2026) {
  resetClubFinanceLedgers();
  reseedCareerRng(seed);
  setWorldState(createWorldState({ startYear, seed }));
}

/**
 * QA-scoped monotonic clock + seeded Math.random (Fix 11 clock pattern).
 * Keeps review IDs and helpers that still call Math.random (e.g. narrative
 * academy season stats) stable without changing production unseeded UI entropy.
 */
export function withDeterministicClock(seed, operation) {
  const realNow = Date.now;
  const realRandom = Math.random;
  let now = 1_800_000_000_000 + (Number(seed) >>> 0) * 1000;
  const mathRng = createRng(hashSeed(`qa-math-random:${Number(seed) >>> 0}`));
  Date.now = () => now++;
  Math.random = () => mathRng.random();
  try {
    const result = operation();
    if (result && typeof result === "object") {
      result.deterministicClockEnd = now;
      result.deterministicClockSeed = Number(seed) >>> 0;
    }
    return result;
  } finally {
    Date.now = realNow;
    Math.random = realRandom;
  }
}
