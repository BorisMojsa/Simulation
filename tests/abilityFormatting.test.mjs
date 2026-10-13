/**
 * Ability display formatting — presentation only.
 * Run: node tests/abilityFormatting.test.mjs
 */
import assert from "node:assert/strict";
import {
  abilityDisplayChange,
  formatAbilityDisplayChange,
  formatAbilityForDisplay,
  rawAbilityEndpoints,
  roundAbilityForDisplay,
} from "../js/ui/abilityFormatting.js";

function test(name, fn) {
  try {
    fn();
    console.log(`OK  ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

test("roundAbilityForDisplay nearest whole number", () => {
  assert.equal(roundAbilityForDisplay(54.4291272201), 54);
  assert.equal(roundAbilityForDisplay(49.96708003), 50);
  assert.equal(roundAbilityForDisplay(59.6416953963777), 60);
  assert.equal(roundAbilityForDisplay(null), null);
  assert.equal(formatAbilityForDisplay(Number.NaN), "—");
});

test("display change reconciles rounded endpoints", () => {
  assert.equal(abilityDisplayChange(53.165466, 54.429127), 1);
  assert.equal(abilityDisplayChange(48.831662, 50.454628), 1);
  assert.equal(abilityDisplayChange(59.14538, 59.641695), 1);
  assert.equal(abilityDisplayChange(70.49, 70.51), 1);
  assert.equal(abilityDisplayChange(70.1, 70.45), 0);
  assert.equal(abilityDisplayChange(70.51, 70.49), -1);
  assert.equal(formatAbilityDisplayChange(70.1, 70.45, "0"), "0");
  assert.equal(formatAbilityDisplayChange(70.51, 70.49), "-1");
  assert.equal(formatAbilityDisplayChange(53.165466, 54.429127), "+1");
});

test("screenshot attribute cards", () => {
  const cards = [
    { name: "Speed", before: 54.4291272201 - 1.263660830150634, after: 54.4291272201, expectNew: 54, expectCh: 1 },
    { name: "Passing", before: 49.967080803 - 0.903016904201727, after: 49.967080803, expectNew: 50, expectCh: 1 },
    { name: "Shooting", before: 50.454627868 - 1.623296587012021, after: 50.454627868, expectNew: 50, expectCh: 1 },
    { name: "Defending", before: 47.11536175962 - 1.676047824687494, after: 47.11536175962, expectNew: 47, expectCh: 2 },
    { name: "Physicality", before: 41.0740413584 - 1.330031824377904, after: 41.0740413584, expectNew: 41, expectCh: 1 },
    { name: "Dribbling", before: 59.64161953963777 - 0.4963149135872911, after: 59.64161953963777, expectNew: 60, expectCh: 1 },
  ];
  for (const c of cards) {
    assert.equal(roundAbilityForDisplay(c.after), c.expectNew, c.name);
    assert.equal(abilityDisplayChange(c.before, c.after), c.expectCh, `${c.name} change`);
  }
});

test("rawAbilityEndpoints reconstructs before from change", () => {
  const { rawBefore, rawAfter } = rawAbilityEndpoints({
    new: 50.454627868,
    change: 1.623296587012021,
  });
  assert.ok(Math.abs(rawAfter - 50.454627868) < 1e-9);
  assert.ok(Math.abs(rawBefore - (50.454627868 - 1.623296587012021)) < 1e-9);
  assert.equal(abilityDisplayChange(rawBefore, rawAfter), 1);
});

console.log("abilityFormatting tests done");
