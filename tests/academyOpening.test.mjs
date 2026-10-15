/**
 * Academy opening rebalance tests.
 * Run: node tests/academyOpening.test.mjs
 */
import assert from "node:assert/strict";
import {
  allOpeningScenarios,
  inferChoiceDisposition,
  normalizeOpeningScenario,
  pickScenariosForPosition,
  pickWeightedChoiceResult,
} from "../js/data/careerOpeningScenarios.js";
import { ACADEMY_OPENING } from "../js/config/academyOpeningConfig.js";
import {
  advanceOpeningCursor,
  applyAcademyBaselineTraining,
  applyOpeningMoment,
  ensureAcademyOpeningState,
  finalizeAcademyOpening,
  simulateFullAcademyOpening,
} from "../js/simulation/academyOpening.js";
import {
  createPlayerIdentity,
  finalizeAcademyPlayer,
  applyOpeningChoiceResult,
  applySkipOpeningDevelopment,
} from "../js/simulation/playerDevelopment.js";
import { ACADEMY_POOL } from "../js/data/leagues.js";
import { pickThreeAcademies } from "../js/simulation/narrativeAcademySeason.js";
import { createRng } from "../js/simulation/rng.js";
import { getBaseOverall } from "../js/simulation/playerAbility.js";
import { applyAcademyGrowth } from "../js/simulation/playerDevelopmentModel.js";
import { roundAbilityForDisplay, formatAbilityDisplayChange } from "../js/ui/abilityFormatting.js";
import {
  serializeCareerSnapshot,
  deserializeCareerSnapshot,
} from "../js/simulation/careerSnapshot.js";
import { createWorldState } from "../js/simulation/worldState.js";

function test(name, fn) {
  try {
    fn();
    console.log(`OK  ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

function makePlayer(position = "CM", name = "OpenTest") {
  const pl = createPlayerIdentity({
    name,
    nationality: "England",
    position,
    age: 17,
  });
  const academy = pickThreeAcademies(ACADEMY_POOL, "England", name)[0].academy;
  finalizeAcademyPlayer(pl, academy);
  return pl;
}

test("weighted sampling respects explicit weights", () => {
  const choice = normalizeOpeningScenario(
    {
      setup: "Weight probe",
      choices: [
        {
          label: "Probe",
          disposition: "balanced",
          results: [
            { delta: 1, weight: 99, text: "almost always" },
            { delta: -3, weight: 1, text: "rare" },
          ],
        },
      ],
    },
    "MID",
    0
  ).choices[0];
  const rng = createRng(42);
  let pos = 0;
  for (let i = 0; i < 200; i++) {
    if (pickWeightedChoiceResult(choice, rng).delta > 0) pos += 1;
  }
  assert.ok(pos >= 170, `expected heavy positive bias, got ${pos}/200`);
});

test("invalid weights and empty results throw", () => {
  assert.throws(() =>
    normalizeOpeningScenario(
      { setup: "x", choices: [{ label: "a", results: [{ delta: 1, weight: -1, text: "bad" }] }] },
      "MID",
      0
    )
  );
  assert.throws(() =>
    normalizeOpeningScenario({ setup: "x", choices: [{ label: "a", results: [] }] }, "MID", 0)
  );
});

test("asymmetric-loss regression: narrative −3 is not several times larger than +3", () => {
  const gains = [];
  const losses = [];
  for (let i = 0; i < 40; i++) {
    const up = makePlayer("ST", `Up${i}`);
    ensureAcademyOpeningState(up, { scenarios: [] });
    applyAcademyBaselineTraining(up);
    const beforeUp = getBaseOverall(up);
    applyOpeningMoment(up, {
      scenario: { id: `asym-up-${i}` },
      choice: { id: "c", label: "Go" },
      outcome: { id: "o", delta: 3, text: "Good", effect: "ability" },
      momentIndex: 0,
    });
    gains.push(getBaseOverall(up) - beforeUp);

    const down = makePlayer("ST", `Down${i}`);
    ensureAcademyOpeningState(down, { scenarios: [] });
    applyAcademyBaselineTraining(down);
    const beforeDown = getBaseOverall(down);
    applyOpeningMoment(down, {
      scenario: { id: `asym-down-${i}` },
      choice: { id: "c", label: "Go" },
      outcome: { id: "o", delta: -3, text: "Bad", effect: "ability" },
      momentIndex: 0,
    });
    losses.push(beforeDown - getBaseOverall(down));
  }
  const meanGain = gains.reduce((a, b) => a + b, 0) / gains.length;
  const meanLoss = losses.reduce((a, b) => a + b, 0) / losses.length;
  assert.ok(meanGain > 0.05, `mean gain ${meanGain}`);
  assert.ok(meanLoss > 0.05, `mean loss ${meanLoss}`);
  // Old bug: loss ≈ 3 while gain ≈ 0.42 (ratio > 5). Require same order of magnitude.
  assert.ok(meanLoss / meanGain < 2.5, `loss/gain ratio ${meanLoss / meanGain}`);
  assert.ok(meanGain / meanLoss < 2.5, `gain/loss ratio ${meanGain / meanLoss}`);
});

test("cumulative budget: five +3 moments cannot each take a fresh annual share", () => {
  const pl = makePlayer("CM", "Budget");
  ensureAcademyOpeningState(pl, { scenarios: [] });
  for (let i = 0; i < 5; i++) {
    applyOpeningMoment(pl, {
      scenario: { id: `bud-${i}` },
      choice: { id: "c", label: "Push" },
      outcome: { id: `o${i}`, delta: 3, text: "Push", effect: "ability" },
      momentIndex: i,
    });
  }
  finalizeAcademyOpening(pl);
  assert.ok(
    pl.academyOpening.positiveLearningApplied <= ACADEMY_OPENING.openingPositiveCap + 0.05,
    `positive learning ${pl.academyOpening.positiveLearningApplied}`
  );
  assert.ok(pl.academyOpening.baselineApplied);
});

test("whole-number feedback uses rounded endpoints", () => {
  // Same displayed OVR despite raw movement inside the rounding bin.
  assert.equal(formatAbilityDisplayChange(63.2, 63.4, "unchanged"), "unchanged");
  assert.equal(roundAbilityForDisplay(63.2), 63);
  assert.equal(roundAbilityForDisplay(63.4), 63);
  // Crossing the midpoint changes the displayed badge.
  assert.equal(formatAbilityDisplayChange(63.4, 63.6, "unchanged"), "+1");
});

test("all five position groups get five distinct scenario ids", () => {
  const rng = createRng(7);
  for (const pos of ["GK", "CB", "CM", "LW", "ST"]) {
    const list = pickScenariosForPosition(pos, 5, rng);
    assert.equal(list.length, 5, pos);
    const ids = list.map((s) => s.id);
    assert.equal(new Set(ids).size, 5, `${pos} duplicate ids`);
  }
});

test("duplicate choice clicks do not apply twice", () => {
  const pl = makePlayer("RW", "Dup");
  ensureAcademyOpeningState(pl, { scenarios: [] });
  applyAcademyBaselineTraining(pl);
  const args = {
    scenario: { id: "dup-sc" },
    choice: { id: "dup-c", label: "Try" },
    outcome: { id: "dup-o", delta: 2, text: "Ok", effect: "ability" },
    momentIndex: 0,
    applicationId: "dup-app-1",
  };
  const first = applyOpeningMoment(pl, args);
  const rawAfterFirst = getBaseOverall(pl);
  const second = applyOpeningMoment(pl, args);
  assert.equal(second.duplicate, true);
  assert.ok(Math.abs(getBaseOverall(pl) - rawAfterFirst) < 1e-9);
  assert.equal(first.duplicate, false);
});

test("opening moments respect shared annual allowance without forced +1 display jumps", () => {
  const pl = makePlayer("ST", "Ceil");
  ensureAcademyOpeningState(pl, { scenarios: [] });
  applyAcademyBaselineTraining(pl);
  // Consume most of the shared annual allowance first.
  applyAcademyGrowth(pl, 6.5, { rng: createRng(1) });
  const before = roundAbilityForDisplay(getBaseOverall(pl));
  applyOpeningMoment(pl, {
    scenario: { id: "ceil-sc" },
    choice: { id: "c", label: "Push" },
    outcome: { id: "o", delta: 3, text: "Push", effect: "ability" },
    momentIndex: 0,
  });
  const after = roundAbilityForDisplay(getBaseOverall(pl));
  assert.ok(after - before <= 2, "no forced large bump beyond remaining allowance");
});

test("snapshot resume keeps cursor and does not reroll applied moments", () => {
  const pl = makePlayer("CM", "Snap");
  const rng = createRng(99);
  ensureAcademyOpeningState(pl, {
    scenarios: pickScenariosForPosition("CM", 5, rng),
    rng,
  });
  applyAcademyBaselineTraining(pl);
  const sc = pl.academyOpening.scenarios[0];
  const choice = sc.choices[0];
  const outcome = choice.results[0];
  applyOpeningMoment(pl, { scenario: sc, choice, outcome, momentIndex: 0 });
  advanceOpeningCursor(pl);
  const rawMid = getBaseOverall(pl);
  const world = createWorldState({ seasonIndex: 0 });
  const snap = serializeCareerSnapshot({ player: pl, world });
  const { player: restored } = deserializeCareerSnapshot(JSON.parse(JSON.stringify(snap)));
  assert.equal(restored.academyOpening.cursor, 1);
  assert.equal(restored.academyOpening.rolls.length, 1);
  const again = applyOpeningMoment(restored, {
    scenario: sc,
    choice,
    outcome,
    momentIndex: 0,
    applicationId: restored.academyOpening.rolls[0].applicationId,
  });
  assert.equal(again.duplicate, true);
  assert.ok(Math.abs(getBaseOverall(restored) - rawMid) < 1e-6);
});

test("thoughtful policy improves more often than reckless on a small seeded batch", () => {
  let thoughtUp = 0;
  let recklessUp = 0;
  const n = 80;
  for (let i = 0; i < n; i++) {
    const t = makePlayer("CM", `T${i}`);
    const startT = roundAbilityForDisplay(getBaseOverall(t));
    simulateFullAcademyOpening(t, { policy: "thoughtful", rng: createRng(1000 + i) });
    if (roundAbilityForDisplay(getBaseOverall(t)) > startT) thoughtUp += 1;

    const r = makePlayer("CM", `R${i}`);
    const startR = roundAbilityForDisplay(getBaseOverall(r));
    simulateFullAcademyOpening(r, { policy: "reckless", rng: createRng(2000 + i) });
    if (roundAbilityForDisplay(getBaseOverall(r)) > startR) recklessUp += 1;
  }
  assert.ok(thoughtUp > recklessUp, `thoughtful ${thoughtUp} vs reckless ${recklessUp}`);
});

test("skip path applies baseline once and is not richer than a full opening mean path", () => {
  const skip = makePlayer("CM", "Skip");
  const before = getBaseOverall(skip);
  applySkipOpeningDevelopment(skip);
  const skipGain = getBaseOverall(skip) - before;
  assert.ok(skip.academyOpening.baselineApplied);
  assert.ok(skipGain <= ACADEMY_OPENING.baselineTrainingGain + 0.2);

  // Second call must not stack baseline.
  applySkipOpeningDevelopment(skip);
  assert.ok(Math.abs(getBaseOverall(skip) - (before + skipGain)) < 0.05 || skip.academyOpening.baselineApplied);
});

test("legacy applyOpeningChoiceResult still returns a finite rating delta", () => {
  const pl = makePlayer("ST", "Legacy");
  const before = pl.rating;
  const applied = applyOpeningChoiceResult(pl, 3, { min: 50, max: 88 });
  assert.equal(typeof applied, "number");
  assert.equal(pl.rating, before + applied);
});

test("bank normalizes ids and dispositions; life scenarios exist", () => {
  const all = allOpeningScenarios();
  assert.ok(all.length >= 83);
  assert.ok(all.some((s) => String(s.id).startsWith("life-")));
  for (const s of all.slice(0, 20)) {
    assert.ok(s.id);
    for (const c of s.choices) {
      assert.ok(c.id && c.disposition);
      for (const r of c.results) {
        assert.ok(r.id && r.weight > 0);
      }
    }
  }
  assert.equal(inferChoiceDisposition("Ask for specific feedback"), "thoughtful");
  assert.equal(inferChoiceDisposition("Stay late and smash volume while exhausted"), "reckless");
});

console.log("\nDone.");
