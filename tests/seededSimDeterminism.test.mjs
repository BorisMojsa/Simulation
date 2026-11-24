import { test } from "node:test";
import assert from "node:assert/strict";
import { reseedCareerRng, getSimRng, setSimRng, createRng } from "../js/simulation/rng.js";
import { createWorldState, setWorldState } from "../js/simulation/worldState.js";
import { randFloat, randInt, pickRandom } from "../js/utils/helpers.js";

function drawSim(seed, n = 40) {
  reseedCareerRng(seed);
  const out = [];
  for (let i = 0; i < n; i++) out.push(randFloat(0, 1), randInt(0, 99), pickRandom([1, 2, 3, 4, 5]));
  return out;
}

test("sim helpers draw from the career-seeded RNG, not Math.random", () => {
  const a = drawSim(94035);
  const b = drawSim(94035);
  assert.deepEqual(a, b, "same seed must give the same helper stream");
  assert.notDeepEqual(a, drawSim(94036), "different seeds must differ");
});

test("seedless world creation after an explicit seed is reproducible", () => {
  reseedCareerRng(777);
  const w1 = createWorldState({ startYear: 2026 });
  const stream1 = [randFloat(0, 1), randFloat(0, 1)];
  reseedCareerRng(777);
  const w2 = createWorldState({ startYear: 2026 });
  const stream2 = [randFloat(0, 1), randFloat(0, 1)];
  assert.equal(w1.rngSeed, w2.rngSeed, "derived world seed must repeat");
  assert.deepEqual(stream1, stream2, "post-creation sim stream must repeat");
  setWorldState(w1);
  setSimRng(createRng(999));
  assert.notEqual(getSimRng().seed(), w1.rngSeed);
});
