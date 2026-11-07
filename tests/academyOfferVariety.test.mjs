/**
 * Fix 14 focused engine checks (F01–F05) for opening academy offer selection.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACADEMY_POOL } from "../js/data/leagues.js";
import { academyNationOf, buildAcademyIntro, buildAcademyOfferStories } from "../js/data/academyOfferStories.js";
import { academyOfferWeight, regionDistance } from "../js/data/academyGeography.js";
import {
  pickThreeAcademies,
  dedupeEligibleAcademies,
  canonicalizeNation,
  ABROAD_SLOT_CHANCE_MINOR,
  ABROAD_SLOT_CHANCE_ADULT,
} from "../js/simulation/narrativeAcademySeason.js";
import {
  createPlayerIdentity,
  finalizeAcademyPlayer,
} from "../js/simulation/playerDevelopment.js";
import { createRng, hashSeed, getSimRng, reseedCareerRng } from "../js/simulation/rng.js";
import {
  serializeCareerSnapshot,
  deserializeCareerSnapshot,
} from "../js/simulation/careerSnapshot.js";
import { skipCareerIntroBootstrap } from "../js/ui/careerStartFlow.js";
import {
  buildFirstProContractDecision,
  signFirstProfessionalContract,
} from "../js/simulation/proContractOffers.js";
import {
  buildAndPersistAcademyReview,
  ensureAcademyLifecycle,
} from "../js/simulation/academyLifecycle.js";

function academy({
  name,
  nation,
  clubId = null,
  divisionLevel = 1,
  parentName = null,
  isAcademy = true,
}) {
  const parent = parentName || name.replace(/ Academy$/, "");
  return {
    name: name.includes("Academy") ? name : `${name} Academy`,
    displayName: name.includes("Academy") ? name : `${name} Academy`,
    nation,
    league: `${nation} - Test`,
    leagueDisplay: `${nation} - Test`,
    isAcademy,
    parentClub: {
      name: parent,
      displayName: parent,
      clubId,
      nation,
      divisionLevel,
    },
  };
}

function parentIds(offers) {
  return offers.map((o) => o.academy.parentClub?.clubId || o.academy.parentClub?.name);
}

function assertValidOffers(offers, { nationality, expectLen }) {
  assert.equal(offers.length, expectLen);
  const ids = parentIds(offers);
  assert.equal(new Set(ids).size, ids.length, `duplicate parents: ${ids}`);
  for (const o of offers) {
    assert.equal(typeof o.isHome, "boolean");
    assert.ok(o.arrivalStory?.length > 20);
    assert.ok(o.pitch?.length > 20);
    assert.equal(o.isHome, canonicalizeNation(academyNationOf(o.academy)) === canonicalizeNation(nationality)
      || (nationality === "USA" && canonicalizeNation(academyNationOf(o.academy)) === "United States")
      || nationsAliasHome(o, nationality));
  }
}

function nationsAliasHome(o, nationality) {
  const a = canonicalizeNation(academyNationOf(o.academy));
  const b = canonicalizeNation(nationality);
  return a && b && a === b;
}

describe("F01 catalog and synthetic pool shapes", () => {
  it("real catalog returns up to 3 distinct parents with narratives", () => {
    const offers = pickThreeAcademies(ACADEMY_POOL, "England", "Alex", { age: 16, seed: 11 });
    assertValidOffers(offers, { nationality: "England", expectLen: 3 });
    assert.ok(offers.filter((o) => o.isHome).length >= 2);
  });

  it("0 / 1 / 2 / 3+ eligible parents and sparse / missing-domestic cases", () => {
    assert.deepEqual(pickThreeAcademies([], "England", "A", { seed: 1 }), []);

    const one = [academy({ name: "Solo", nation: "England", clubId: "eng-solo", divisionLevel: 1 })];
    const oneOffers = pickThreeAcademies(one, "England", "A", { seed: 2 });
    assert.equal(oneOffers.length, 1);
    assert.equal(oneOffers[0].isHome, true);

    const twoHome = [
      academy({ name: "H1", nation: "England", clubId: "eng-1", divisionLevel: 1 }),
      academy({ name: "H2", nation: "England", clubId: "eng-2", divisionLevel: 2 }),
    ];
    const twoOnly = pickThreeAcademies(twoHome, "England", "A", { seed: 3 });
    assert.equal(twoOnly.length, 2);
    assert.ok(twoOnly.every((o) => o.isHome));

    const twoPlusAbroad = [
      ...twoHome,
      academy({ name: "Away", nation: "France", clubId: "fra-1", divisionLevel: 1 }),
    ];
    const mixed = pickThreeAcademies(twoPlusAbroad, "England", "A", { seed: 4 });
    assert.equal(mixed.length, 3);
    assert.equal(mixed.filter((o) => o.isHome).length, 2);
    assert.equal(mixed.filter((o) => !o.isHome).length, 1);

    const threePlus = [
      academy({ name: "H1", nation: "England", clubId: "e1", divisionLevel: 1 }),
      academy({ name: "H2", nation: "England", clubId: "e2", divisionLevel: 2 }),
      academy({ name: "H3", nation: "England", clubId: "e3", divisionLevel: 1 }),
      academy({ name: "Away", nation: "Spain", clubId: "s1", divisionLevel: 1 }),
    ];
    const tray = pickThreeAcademies(threePlus, "England", "A", { age: 16, seed: 5 });
    assert.equal(tray.length, 3);
    assert.ok(tray.filter((o) => o.isHome).length >= 2);

    // Missing domestic (Ghana-like): abroad only
    const abroadOnly = [
      academy({ name: "A1", nation: "England", clubId: "a1" }),
      academy({ name: "A2", nation: "France", clubId: "a2" }),
      academy({ name: "A3", nation: "Spain", clubId: "a3" }),
    ];
    const ghanaish = pickThreeAcademies(abroadOnly, "Ghana", "Kojo", { seed: 6 });
    assert.equal(ghanaish.length, 3);
    assert.ok(ghanaish.every((o) => !o.isHome));

    // No abroad: all domestic
    const domesticOnly = [
      academy({ name: "D1", nation: "England", clubId: "d1", divisionLevel: 1 }),
      academy({ name: "D2", nation: "England", clubId: "d2", divisionLevel: 2 }),
      academy({ name: "D3", nation: "England", clubId: "d3", divisionLevel: 1 }),
    ];
    const allHome = pickThreeAcademies(domesticOnly, "England", "A", { age: 18, seed: 7 });
    assert.equal(allHome.length, 3);
    assert.ok(allHome.every((o) => o.isHome));

    // One foreign nation with multiple clubs — Ghana fills without repeating parents
    const oneNation = [
      academy({ name: "F1", nation: "France", clubId: "f1" }),
      academy({ name: "F2", nation: "France", clubId: "f2" }),
      academy({ name: "F3", nation: "France", clubId: "f3" }),
    ];
    const mono = pickThreeAcademies(oneNation, "Ghana", "Kojo", { seed: 8 });
    assert.equal(mono.length, 3);
    assert.equal(new Set(parentIds(mono)).size, 3);
  });

  it("filters null/bad rows; ID+legacy fallback; identical names keep distinct IDs", () => {
    const pool = [
      null,
      { name: "Nope", isAcademy: false, nation: "England", parentClub: { name: "Nope", clubId: "x" } },
      { name: "NoNation Academy", isAcademy: true, parentClub: { name: "NoNation", clubId: "nn" } },
      academy({ name: "Rich", nation: "England", clubId: "eng-rich", divisionLevel: 1 }),
      // legacy name-only duplicate of Rich
      {
        name: "Rich Academy",
        isAcademy: true,
        nation: "England",
        parentClub: { name: "Rich", nation: "England", divisionLevel: 1 },
      },
      academy({ name: "Twin", nation: "England", clubId: "eng-twin-a", divisionLevel: 1, parentName: "Twin FC" }),
      academy({ name: "Twin B", nation: "England", clubId: "eng-twin-b", divisionLevel: 2, parentName: "Twin FC" }),
      academy({ name: "LegacyOnly", nation: "France", clubId: null, parentName: "Legacy Only" }),
    ];
    const deduped = dedupeEligibleAcademies(pool);
    const ids = deduped.map((a) => a.parentClub?.clubId || `legacy:${a.parentClub?.name}`);
    assert.ok(ids.includes("eng-rich"));
    assert.ok(ids.includes("eng-twin-a"));
    assert.ok(ids.includes("eng-twin-b"));
    assert.ok(ids.some((id) => String(id).includes("Legacy")));
    assert.equal(ids.filter((id) => id === "eng-rich").length, 1);

    const offers = pickThreeAcademies(pool, "England", "A", { seed: 9 });
    assert.ok(offers.length >= 1 && offers.length <= 3);
    // Input rows untouched
    assert.equal(pool[3].parentClub.clubId, "eng-rich");
    assert.equal(pool[4].parentClub.clubId, undefined);
  });
});

describe("F02 age odds, domestic order, division preference", () => {
  it("ages 15–17 use 27.1% and 18–19 use 65% for slot-3 abroad", () => {
    assert.equal(ABROAD_SLOT_CHANCE_MINOR, 0.271);
    assert.equal(ABROAD_SLOT_CHANCE_ADULT, 0.65);

    const pool = [
      academy({ name: "H1", nation: "England", clubId: "h1", divisionLevel: 1 }),
      academy({ name: "H2", nation: "England", clubId: "h2", divisionLevel: 2 }),
      academy({ name: "H3", nation: "England", clubId: "h3", divisionLevel: 1 }),
      academy({ name: "Away", nation: "France", clubId: "away", divisionLevel: 1 }),
    ];

    function mixedShare(age, n = 4000) {
      let mixed = 0;
      for (let i = 0; i < n; i++) {
        const offers = pickThreeAcademies(pool, "England", "A", {
          age,
          seed: hashSeed(`thr|${age}|${i}`),
        });
        if (offers.some((o) => !o.isHome)) mixed += 1;
        assert.ok(offers[0].isHome && offers[1].isHome, "domestic-first order");
        assert.ok(offers.filter((o) => !o.isHome).length <= 1);
      }
      return mixed / n;
    }

    const m16 = mixedShare(16);
    const m17 = mixedShare(17);
    const m18 = mixedShare(18);
    const m19 = mixedShare(19);
    const mInvalid = mixedShare(99); // defaults to 16
    assert.ok(Math.abs(m16 - 0.271) < 0.03, `age16 ${m16}`);
    assert.ok(Math.abs(m17 - 0.271) < 0.03, `age17 ${m17}`);
    assert.ok(Math.abs(m18 - 0.65) < 0.03, `age18 ${m18}`);
    assert.ok(Math.abs(m19 - 0.65) < 0.03, `age19 ${m19}`);
    assert.ok(Math.abs(mInvalid - 0.271) < 0.03, `invalid age ${mInvalid}`);
    assert.ok(m18 > m16 + 0.25);
  });

  it("second domestic prefers a different known divisionLevel", () => {
    const pool = [
      academy({ name: "TopA", nation: "England", clubId: "t1", divisionLevel: 1 }),
      academy({ name: "TopB", nation: "England", clubId: "t2", divisionLevel: 1 }),
      academy({ name: "SecA", nation: "England", clubId: "s1", divisionLevel: 2 }),
      academy({ name: "Away", nation: "France", clubId: "f1", divisionLevel: 1 }),
    ];
    let mixedDiv = 0;
    for (let i = 0; i < 200; i++) {
      const offers = pickThreeAcademies(pool, "England", "A", { age: 16, seed: hashSeed(`div|${i}`) });
      const homes = offers.filter((o) => o.isHome).slice(0, 2);
      const divs = new Set(homes.map((o) => o.academy.parentClub.divisionLevel));
      if (divs.size === 2) mixedDiv += 1;
    }
    assert.equal(mixedDiv, 200);

    // Same-division fallback when no alternative known
    const sameOnly = [
      academy({ name: "A", nation: "England", clubId: "a", divisionLevel: 1 }),
      academy({ name: "B", nation: "England", clubId: "b", divisionLevel: 1 }),
      academy({ name: "C", nation: "England", clubId: "c", divisionLevel: 1 }),
    ];
    const tray = pickThreeAcademies(sameOnly, "England", "A", { seed: 12 });
    assert.equal(tray.length, 3);
    assert.ok(tray.every((o) => o.academy.parentClub.divisionLevel === 1));
  });
});

describe("F03 aliases, nation weighting, destination diversity", () => {
  it("aliases match both sides without rewriting player nationality", () => {
    const pool = [
      academy({ name: "US Club", nation: "United States", clubId: "us1" }),
      academy({ name: "US Club 2", nation: "United States", clubId: "us2" }),
      academy({ name: "US Club 3", nation: "United States", clubId: "us3" }),
      academy({ name: "KR", nation: "South Korea", clubId: "kr1" }),
    ];
    const pl = createPlayerIdentity({
      name: "Sam",
      nationality: "USA",
      position: "ST",
      age: 16,
    });
    const offers = pickThreeAcademies(pool, pl.nationality, pl.name, { seed: 20 });
    assert.ok(offers.some((o) => o.isHome));
    assert.equal(pl.nationality, "USA");

    // Destination alias must not count twice as different countries
    const aliased = [
      academy({ name: "A", nation: "Korea Republic", clubId: "k1" }),
      academy({ name: "B", nation: "South Korea", clubId: "k2" }),
      academy({ name: "C", nation: "Japan", clubId: "j1" }),
      academy({ name: "D", nation: "France", clubId: "f1" }),
    ];
    const ghana = pickThreeAcademies(aliased, "Ghana", "Kojo", { seed: 21 });
    const nations = ghana.map((o) => canonicalizeNation(academyNationOf(o.academy)));
    // First abroad picks distinct nations; Korea Republic and South Korea share canonical label
    assert.equal(new Set(nations).size, nations.length);
    assert.ok(!nations.includes("Korea Republic") || !nations.includes("South Korea") ||
      canonicalizeNation("Korea Republic") === canonicalizeNation("South Korea"));
    assert.equal(canonicalizeNation("Korea Republic"), "South Korea");
    assert.equal(canonicalizeNation("Türkiye"), "Turkey");
    assert.equal(canonicalizeNation("Czechia"), "Czech Republic");
    assert.equal(canonicalizeNation("Holland"), "Netherlands");
  });

  it("equal-weight nations ignore 1:40 club ratio (~50:50 first abroad)", () => {
    const pool = [
      academy({ name: "Nigeria A", nation: "Nigeria", clubId: "nga-a" }),
    ];
    for (let i = 0; i < 40; i++) {
      pool.push(academy({ name: `Senegal ${i}`, nation: "Senegal", clubId: `sen-${i}` }));
    }
    assert.equal(academyOfferWeight("Ghana", "Nigeria", { isHome: false }), academyOfferWeight("Ghana", "Senegal", { isHome: false }));
    let nga = 0;
    let sen = 0;
    for (let i = 0; i < 1024; i++) {
      const offers = pickThreeAcademies(pool, "Ghana", "Kojo", { seed: hashSeed(`eq|${i}`) });
      const first = offers[0];
      const n = canonicalizeNation(academyNationOf(first.academy));
      if (n === "Nigeria") nga += 1;
      else if (n === "Senegal") sen += 1;
    }
    const ngaShare = nga / 1024;
    const senShare = sen / 1024;
    assert.ok(ngaShare >= 0.43 && ngaShare <= 0.57, `nga ${ngaShare}`);
    assert.ok(senShare >= 0.43 && senShare <= 0.57, `sen ${senShare}`);
  });

  it("prefers distinct foreign destinations then nearest-over-distant", () => {
    const pool = [
      academy({ name: "Near1", nation: "Croatia", clubId: "c1" }),
      academy({ name: "Near2", nation: "Turkey", clubId: "t1" }),
      academy({ name: "Far", nation: "Brazil", clubId: "b1" }),
      academy({ name: "Far2", nation: "Brazil", clubId: "b2" }),
    ];
    const tray = pickThreeAcademies(pool, "Serbia", "Marko", { seed: 30 });
    // Serbia has no domestic in this pool → three abroad, distinct nations before reuse
    const nations = tray.map((o) => canonicalizeNation(academyNationOf(o.academy)));
    assert.equal(new Set(nations).size, 3);

    let nearFirst = 0;
    for (let i = 0; i < 400; i++) {
      const offers = pickThreeAcademies(pool, "Serbia", "Marko", { seed: hashSeed(`geo|${i}`) });
      const first = canonicalizeNation(academyNationOf(offers[0].academy));
      const d = regionDistance("Serbia", first);
      if (d <= 1) nearFirst += 1;
    }
    assert.ok(nearFirst / 400 >= 0.7, `near-first ${nearFirst}/400`);
  });
});

describe("F04 seed replay, age wiring, RNG isolation, identity parity", () => {
  it("same seed+inputs replay offer IDs, labels and stories; different seeds differ", () => {
    const a = pickThreeAcademies(ACADEMY_POOL, "England", "Alex", { age: 16, seed: 4242 });
    const b = pickThreeAcademies(ACADEMY_POOL, "England", "Alex", { age: 16, seed: 4242 });
    assert.deepEqual(parentIds(a), parentIds(b));
    assert.deepEqual(
      a.map((o) => o.academy.displayName),
      b.map((o) => o.academy.displayName)
    );
    assert.deepEqual(
      a.map((o) => o.arrivalStory),
      b.map((o) => o.arrivalStory)
    );
    const trays = new Set();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      trays.add(parentIds(pickThreeAcademies(ACADEMY_POOL, "England", "Alex", { age: 16, seed })).join("|"));
    }
    assert.ok(trays.size >= 4);
  });

  it("intro and bootstrap forward selected age; shared sim RNG unchanged", () => {
    const pl = createPlayerIdentity({
      name: "AgeWire",
      nationality: "England",
      position: "CM",
      age: 18,
    });
    reseedCareerRng(777);
    const before = getSimRng().seed();
    const offers = pickThreeAcademies(ACADEMY_POOL, pl.nationality, pl.name, { age: pl.age, seed: 55 });
    assert.equal(offers.length, 3);
    assert.equal(getSimRng().seed(), before, "offer generation must not consume shared sim RNG");

    const boot = createPlayerIdentity({
      name: "Boot",
      nationality: "England",
      position: "ST",
      age: 18,
    });
    const expectedFirst = pickThreeAcademies(ACADEMY_POOL, boot.nationality, boot.name, {
      age: boot.age,
      seed: 55,
    })[0];
    skipCareerIntroBootstrap(boot, ACADEMY_POOL, { age: boot.age, seed: 55 });
    assert.equal(boot.nationality, "England");
    assert.equal(boot.age, 18);
    assert.ok(boot.seasons?.length >= 1);
    assert.ok(boot.seasons[0].isNarrativeAcademyYear);
    // Bootstrap selects the first offer from the age-aware draw (may then graduate).
    const openingClub = boot.seasons[0].club;
    const expectedParent =
      expectedFirst.academy.parentClub?.displayName ||
      expectedFirst.academy.parentClub?.name ||
      expectedFirst.academy.name;
    assert.ok(
      openingClub.includes(expectedParent) ||
        openingClub === expectedFirst.academy.name ||
        openingClub === expectedFirst.academy.displayName,
      `bootstrap opening club ${openingClub} vs ${expectedParent}`
    );
  });

  it("generation / durable attributes / OVR match for same identity and academy", () => {
    const academy = pickThreeAcademies(ACADEMY_POOL, "England", "Parity", { age: 16, seed: 101 })[0].academy;
    function build() {
      reseedCareerRng(9090);
      const pl = createPlayerIdentity({
        name: "Parity",
        nationality: "England",
        position: "ST",
        age: 16,
      });
      finalizeAcademyPlayer(pl, academy);
      return {
        rating: pl.rating,
        potential: pl.potential,
        attributes: structuredClone(pl.attributes),
        ovr: pl.rating,
      };
    }
    const a = build();
    const b = build();
    assert.equal(a.rating, b.rating);
    assert.equal(a.potential, b.potential);
    assert.deepEqual(a.attributes, b.attributes);
  });
});

describe("F05 snapshot persistence and academy continuation boundaries", () => {
  it("snapshot round-trip keeps academy/parent; no re-selection; no senior appearances yet", () => {
    const pl = createPlayerIdentity({
      name: "Snap",
      nationality: "England",
      position: "CB",
      age: 16,
    });
    const offer = pickThreeAcademies(ACADEMY_POOL, "England", "Snap", { age: 16, seed: 202 })[0];
    finalizeAcademyPlayer(pl, offer.academy);
    assert.equal(pl.club.isAcademy, true);
    assert.equal(pl.club.parentClub?.clubId, offer.academy.parentClub?.clubId);

    const snap = serializeCareerSnapshot({ player: pl });
    const restored = deserializeCareerSnapshot(structuredClone(snap));
    assert.equal(restored.player.club.parentClub?.clubId, offer.academy.parentClub?.clubId);
    assert.equal(restored.player.club.isAcademy, true);
    assert.equal(restored.player.nationality, "England");

    // Opening offers must not enroll senior appearances before contract path
    assert.equal(restored.player.seasons?.length || 0, 0);
    assert.ok(!restored.player.club || restored.player.club.isAcademy);

    skipCareerIntroBootstrap(pl, ACADEMY_POOL, { age: 16, seed: 202 });
    const openingSeason = pl.seasons?.[0];
    assert.ok(openingSeason?.isNarrativeAcademyYear);
    assert.equal(openingSeason.seniorAppearances ?? 0, 0);
  });

  it("first-pro and boundary review generators still run after selection", () => {
    const pl = createPlayerIdentity({
      name: "Boundary",
      nationality: "England",
      position: "ST",
      age: 17,
    });
    const academy = pickThreeAcademies(ACADEMY_POOL, "England", "Boundary", { age: 17, seed: 303 })[0].academy;
    finalizeAcademyPlayer(pl, academy);
    pl.seasons.push({
      seasonNumber: 1,
      age: 17,
      club: pl.club.name,
      matches: 20,
      goals: 2,
      assists: 1,
      cleanSheets: 0,
      isNarrativeAcademyYear: true,
      seniorAppearances: 0,
    });
    const decision = buildFirstProContractDecision(pl);
    assert.ok(decision.verdict);
    if (decision.offers[0]) {
      const signed = signFirstProfessionalContract(pl, decision.offers[0]);
      assert.equal(signed.ok, true);
    } else {
      assert.equal(pl.club.isAcademy, true);
    }

    const cont = createPlayerIdentity({
      name: "Cont",
      nationality: "England",
      position: "CM",
      age: 19,
    });
    finalizeAcademyPlayer(cont, academy);
    ensureAcademyLifecycle(cont);
    cont.academyLifecycle.status = "enrolled";
    cont.academyLifecycle.periodCount = 2;
    cont.seasons = [
      { seasonNumber: 1, age: 17, club: cont.club.name, matches: 20, isNarrativeAcademyYear: true },
      { seasonNumber: 2, age: 18, club: cont.club.name, matches: 22, isNarrativeAcademyYear: true },
    ];
    const review = buildAndPersistAcademyReview(cont, { isFinal: false });
    assert.ok(review === null || typeof review === "object");
  });
});

describe("story / intro count copy", () => {
  it("count-dependent intros and story RNG default", () => {
    assert.match(buildAcademyIntro({ name: "A", nationality: "England", offerCount: 1 }), /one/i);
    assert.match(buildAcademyIntro({ name: "A", nationality: "England", offerCount: 2 }), /two/i);
    assert.match(buildAcademyIntro({ name: "A", nationality: "England", offerCount: 3 }), /three/i);
    const ac = academy({ name: "X", nation: "England", clubId: "x" });
    const stories = buildAcademyOfferStories(ac, { name: "A", nationality: "England", isHome: true });
    assert.ok(stories.arrivalStory.length > 10);
    const rng = createRng(5);
    const s1 = buildAcademyOfferStories(ac, { name: "A", nationality: "England", isHome: true }, rng);
    const rng2 = createRng(5);
    const s2 = buildAcademyOfferStories(ac, { name: "A", nationality: "England", isHome: true }, rng2);
    assert.equal(s1.arrivalStory, s2.arrivalStory);
  });
});
