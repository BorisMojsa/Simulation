/**
 * Smoke tests for career intro data paths (run: node tests/careerFlowSmoke.test.mjs)
 */
import assert from "node:assert/strict";
import { pickRandomBackstory } from "../js/data/careerBackstories.js";
import { pickScenariosForPosition } from "../js/data/careerOpeningScenarios.js";
import { ACADEMY_POOL } from "../js/data/leagues.js";
import { pickThreeAcademies, buildNarrativeAcademySeason } from "../js/simulation/narrativeAcademySeason.js";
import {
  createPlayerIdentity,
  finalizeAcademyPlayer,
  applyOpeningChoiceDelta,
  promoteAcademyGraduateToFirstTeam,
} from "../js/simulation/playerDevelopment.js";

function test(name, fn) {
  try {
    fn();
    console.log(`OK  ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

test("ACADEMY_POOL has entries", () => {
  assert.ok(ACADEMY_POOL.length > 50);
});

test("pickThreeAcademies returns up to 3", () => {
  const p = pickThreeAcademies(ACADEMY_POOL);
  assert.ok(p.length >= 1 && p.length <= 3);
});

test("pickScenariosForPosition returns 3 for each position code", () => {
  const codes = ["GK", "CB", "CM", "RW", "ST", "CAM"];
  for (const c of codes) {
    const s = pickScenariosForPosition(c, 3);
    assert.equal(s.length, 3, c);
    assert.ok(s[0].setup && s[0].choices?.length);
  }
});

test("pickRandomBackstory returns string", () => {
  const t = pickRandomBackstory({ name: "A", nationality: "Serbia" });
  assert.equal(typeof t, "string");
  assert.ok(t.length > 20);
});

test("createPlayerIdentity + finalize + narrative season + first-team promotion", () => {
  const pl = createPlayerIdentity({
    name: "Test",
    nationality: "England",
    position: "ST",
  });
  finalizeAcademyPlayer(pl, pickThreeAcademies(ACADEMY_POOL)[0]);
  assert.ok(pl.rating >= 52 && pl.rating <= 70);
  assert.ok(pl.potential >= pl.rating + 1 && pl.potential <= 75);
  applyOpeningChoiceDelta(pl, -1, 1);
  pl.age = 17;
  const season = buildNarrativeAcademySeason(pl, 60, pl.rating);
  assert.ok(season.matches > 0);
  assert.ok(season.isNarrativeAcademyYear);
  pl.seasons.push(season);
  const seniorName = promoteAcademyGraduateToFirstTeam(pl, 72);
  assert.equal(pl.club.isAcademy, false);
  assert.ok(seniorName || pl.club?.name);
  assert.ok(pl.contractYears >= 1);
  assert.ok(pl.contractEndSeason >= pl.seasons.length);
});

console.log(process.exitCode ? "Some tests failed." : "All smoke tests passed.");
