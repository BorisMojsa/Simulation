/**
 * Seeded simulation RNG. UI / cosmetic randomness must use Math.random separately.
 */

export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  const s = String(str ?? "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed = 1) {
  let state = (Number(seed) >>> 0) || 1;

  function next() {
    // Mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    seed: () => state,
    setSeed(nextSeed) {
      state = (Number(nextSeed) >>> 0) || 1;
    },
    random: next,
    float(min = 0, max = 1) {
      return min + (max - min) * next();
    },
    int(min, max) {
      return Math.floor(min + next() * (max - min + 1));
    },
    pick(list) {
      if (!list?.length) return undefined;
      return list[Math.floor(next() * list.length)];
    },
    shuffle(list) {
      const copy = [...list];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
    chance(p) {
      return next() < p;
    },
    fork(label = "") {
      return createRng(hashSeed(`${state}:${label}`));
    },
  };
}

/**
 * Independent, named RNG stream for a career. Streams never share state, so
 * consuming one (e.g. "potential-forecast") cannot perturb another.
 */
export function createStreamRng(careerId, streamName) {
  return createRng(hashSeed(`${careerId}:${streamName}`));
}

/** Career-scoped default RNG; re-seeded when a career starts. */
let careerRng = createRng(1);

export function getSimRng() {
  return careerRng;
}

export function setSimRng(rng) {
  careerRng = rng || createRng(1);
  return careerRng;
}

export function reseedCareerRng(seed) {
  careerRng = createRng(seed);
  return careerRng;
}
