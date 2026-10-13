/**
 * Smoke tests for career intro data paths (run: node tests/careerFlowSmoke.test.mjs)
 */
import assert from "node:assert/strict";
import { pickRandomBackstory } from "../js/data/careerBackstories.js";
import {
  allOpeningScenarios,
  pickChoiceResult,
  pickScenariosForPosition,
} from "../js/data/careerOpeningScenarios.js";
import { ACADEMY_POOL, LEAGUES } from "../js/data/leagues.js";
import { pickThreeAcademies, buildNarrativeAcademySeason } from "../js/simulation/narrativeAcademySeason.js";
import {
  createPlayerIdentity,
  finalizeAcademyPlayer,
  applyOpeningChoiceResult,
  rollAcademyStartingRating,
} from "../js/simulation/playerDevelopment.js";
import {
  buildFirstProContractDecision,
  signFirstProfessionalContract,
} from "../js/simulation/proContractOffers.js";
import { rivalsForClub } from "../js/data/clubRivals.js";
import {
  applyDivisionMovement,
  findSisterLeagues,
  qualificationForPosition,
} from "../js/simulation/leaguePhase.js";

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

test("pickThreeAcademies returns up to 3 enriched offers", () => {
  const p = pickThreeAcademies(ACADEMY_POOL, "England", "Alex");
  assert.ok(p.length >= 1 && p.length <= 3);
  for (const offer of p) {
    assert.ok(offer.academy?.name);
    assert.equal(typeof offer.isHome, "boolean");
    assert.ok(offer.arrivalStory?.length > 20);
    assert.ok(offer.pitch?.length > 20);
  }
});

test("England academies are home-heavy across many rolls", () => {
  let homeSlots = 0;
  let totalSlots = 0;
  const rolls = 300;
  for (let i = 0; i < rolls; i++) {
    const offers = pickThreeAcademies(ACADEMY_POOL, "England", "Alex");
    for (const o of offers) {
      totalSlots += 1;
      if (o.isHome) homeSlots += 1;
    }
  }
  assert.ok(homeSlots / totalSlots >= 0.8, `home slot rate ${homeSlots}/${totalSlots}`);
});

test("Nations without a league still get abroad stories", () => {
  const offers = pickThreeAcademies(ACADEMY_POOL, "Ghana", "Kojo");
  assert.equal(offers.length, 3);
  assert.ok(offers.every((o) => !o.isHome));
  assert.ok(offers.every((o) => o.arrivalStory.length > 20));
});

test("Serbia offers are mostly Serbian; distant continents are rare", () => {
  let homeSlots = 0;
  let southAmerica = 0;
  let balkansAbroad = 0;
  let totalAbroad = 0;
  const rolls = 400;
  for (let i = 0; i < rolls; i++) {
    const offers = pickThreeAcademies(ACADEMY_POOL, "Serbia", "Marko");
    for (const o of offers) {
      const nation = o.academy.nation;
      if (o.isHome) homeSlots += 1;
      else {
        totalAbroad += 1;
        if (["Brazil", "Argentina", "Colombia", "Ecuador"].includes(nation)) southAmerica += 1;
        if (["Croatia", "Turkey"].includes(nation)) balkansAbroad += 1;
      }
    }
  }
  const totalSlots = rolls * 3;
  assert.ok(homeSlots / totalSlots >= 0.8, `serbia home ${homeSlots}/${totalSlots}`);
  if (totalAbroad > 20) {
    assert.ok(
      southAmerica / totalAbroad < 0.2,
      `SA abroad share ${southAmerica}/${totalAbroad} should be low`
    );
    assert.ok(
      balkansAbroad >= southAmerica,
      `nearby abroad ${balkansAbroad} should beat SA ${southAmerica}`
    );
  }
});

test("United States rarely pulls Balkan academies", () => {
  let balkans = 0;
  let northOrNearby = 0;
  let abroad = 0;
  for (let i = 0; i < 400; i++) {
    for (const o of pickThreeAcademies(ACADEMY_POOL, "United States", "Sam")) {
      if (o.isHome) continue;
      abroad += 1;
      const n = o.academy.nation;
      if (["Serbia", "Croatia", "Turkey"].includes(n)) balkans += 1;
      if (["Mexico", "England", "France", "Spain", "Brazil", "Argentina", "Colombia"].includes(n)) {
        northOrNearby += 1;
      }
    }
  }
  if (abroad > 20) {
    assert.ok(balkans / abroad < 0.25, `balkan share for US ${balkans}/${abroad}`);
    assert.ok(northOrNearby > balkans, "closer regions should dominate US abroad offers");
  }
});

test("opening scenario bank has at least 77 stories", () => {
  const all = allOpeningScenarios();
  assert.ok(all.length >= 77, `got ${all.length}`);
  for (const s of all) {
    assert.ok(s.setup && s.choices?.length >= 2);
    for (const c of s.choices) {
      assert.ok(c.label && c.results?.length);
      for (const r of c.results) {
        assert.equal(typeof r.delta, "number");
        assert.ok(typeof r.text === "string" && r.text.length > 0);
      }
    }
  }
});

test("pickScenariosForPosition returns 5 for each position code", () => {
  const codes = ["GK", "CB", "CM", "RW", "ST", "CAM"];
  for (const c of codes) {
    const s = pickScenariosForPosition(c, 5);
    assert.equal(s.length, 5, c);
    assert.ok(s[0].setup && s[0].choices?.length);
  }
});

test("pickChoiceResult links text to delta", () => {
  const choice = {
    label: "Top corner screamer",
    results: [
      { delta: 4, text: "It bends in." },
      { delta: -1, text: "Snatched." },
    ],
  };
  for (let i = 0; i < 40; i++) {
    const r = pickChoiceResult(choice);
    assert.ok(choice.results.some((x) => x.delta === r.delta && x.text === r.text));
  }
});

test("Top corner screamer and all choices can go either way", () => {
  const screamer = allOpeningScenarios()
    .flatMap((s) => s.choices)
    .find((c) => /top corner screamer/i.test(c.label));
  assert.ok(screamer);
  assert.ok(screamer.results.some((r) => r.delta > 0));
  assert.ok(screamer.results.some((r) => r.delta < 0));
  let sawPos = false;
  let sawNeg = false;
  for (let i = 0; i < 80; i++) {
    const d = pickChoiceResult(screamer).delta;
    if (d > 0) sawPos = true;
    if (d < 0) sawNeg = true;
  }
  assert.ok(sawPos && sawNeg);
  for (const s of allOpeningScenarios()) {
    for (const c of s.choices) {
      const deltas = c.results.map((r) => r.delta);
      assert.ok(deltas.some((d) => d > 0), `missing plus: ${c.label}`);
      assert.ok(deltas.some((d) => d < 0), `missing minus: ${c.label}`);
      assert.equal(c.gainOnly, undefined);
    }
  }
});

test("rollAcademyStartingRating stays in 54–78 and 75+ is rare", () => {
  let high = 0;
  for (let i = 0; i < 2000; i++) {
    const r = rollAcademyStartingRating();
    assert.ok(r >= 54 && r <= 78, String(r));
    if (r >= 75) high += 1;
  }
  assert.ok(high < 200, `high base count ${high}/2000 should be rare`);
  assert.ok(high > 0, "75+ should still be possible");
});

test("pickRandomBackstory returns string", () => {
  const t = pickRandomBackstory({ name: "A", nationality: "Serbia" });
  assert.equal(typeof t, "string");
  assert.ok(t.length > 20);
});

test("createPlayerIdentity + finalize + narrative season + first pro deal choice", () => {
  const pl = createPlayerIdentity({
    name: "Test",
    nationality: "England",
    position: "ST",
    age: 17,
  });
  assert.equal(pl.age, 17);
  finalizeAcademyPlayer(pl, pickThreeAcademies(ACADEMY_POOL, "England", "Test")[0].academy);
  assert.ok(pl.rating >= 54 && pl.rating <= 78);
  // Forecast upper may equal base; potential is not forced to rating+1.
  assert.ok(pl.potential >= pl.rating && pl.potential <= 99);
  const before = pl.rating;
  const applied = applyOpeningChoiceResult(pl, 3, { min: 50, max: 88 });
  // Academy growth mutates attributes; realized displayed Δ may differ from the legacy request.
  assert.equal(typeof applied, "number");
  assert.ok(applied >= 0 && applied <= 4, `realized academy Δ ${applied}`);
  assert.equal(pl.rating, before + applied);
  const season = buildNarrativeAcademySeason(pl, before, pl.rating);
  assert.ok(season.matches > 0);
  assert.ok(season.isNarrativeAcademyYear);
  assert.equal(season.age, 17);
  pl.seasons.push(season);
  const decision = buildFirstProContractDecision(pl);
  assert.ok(decision.verdict.headline);
  // Suitable clubs only — empty is allowed, but ordinary England academy grads usually get ≥1.
  if (decision.offers.length >= 1) {
    const seniorName = signFirstProfessionalContract(pl, decision.offers[0]);
    assert.equal(pl.club.isAcademy, false);
    assert.ok(seniorName || pl.club?.name);
    assert.ok(pl.contractYears >= 1);
    assert.ok(pl.contractEndSeason >= pl.seasons.length);
    assert.ok(Number.isFinite(pl.weeklyWage) || Number.isFinite(pl.wage));
  } else {
    assert.equal(decision.emptyOffers, true);
    assert.equal(pl.club.isAcademy, true);
  }
});

test("club rivals map covers Eternal Derby and El Clasico sides", () => {
  assert.ok(rivalsForClub("Red Star Belgrade").includes("Partizan"));
  assert.ok(rivalsForClub("Partizan").includes("Red Star Belgrade"));
  assert.ok(rivalsForClub("Real Madrid").includes("FC Barcelona"));
});

test("2. Bundesliga 2nd place promotes; bottom does not relegate", () => {
  const second = LEAGUES.find((l) => l.name === "Germany - 2. Bundesliga");
  const top = LEAGUES.find((l) => l.name === "Germany - Bundesliga");
  assert.ok(second && top);
  const sisters = findSisterLeagues(second, LEAGUES);
  assert.equal(sisters.higher?.name, top.name);
  assert.equal(sisters.lower, null);
  assert.equal(qualificationForPosition(2, second, sisters), "Promoted");
  assert.equal(qualificationForPosition(18, second, sisters), "");

  const player = {
    club: {
      name: "Hannover 96",
      displayName: "Hannover 96",
      league: second.name,
      leagueDisplay: second.displayName,
      tier: second.tier,
      financialTier: 3,
    },
  };
  const move = applyDivisionMovement(player, { position: 2 }, second, LEAGUES);
  assert.equal(move?.type, "promoted");
  assert.equal(player.club.league, top.name);
  assert.equal(applyDivisionMovement(player, { position: 18 }, second, LEAGUES), null);
});

test("Bundesliga bottom places relegate to 2. Bundesliga", () => {
  const top = LEAGUES.find((l) => l.name === "Germany - Bundesliga");
  const second = LEAGUES.find((l) => l.name === "Germany - 2. Bundesliga");
  const sisters = findSisterLeagues(top, LEAGUES);
  assert.equal(qualificationForPosition(17, top, sisters), "Relegated");
  const player = {
    club: {
      name: "Mainz 05",
      league: top.name,
      leagueDisplay: top.displayName,
      tier: top.tier,
      financialTier: 3,
    },
  };
  const move = applyDivisionMovement(player, { position: 17 }, top, LEAGUES);
  assert.equal(move?.type, "relegated");
  assert.equal(player.club.league, second.name);
});

console.log(process.exitCode ? "Some tests failed." : "All smoke tests passed.");
