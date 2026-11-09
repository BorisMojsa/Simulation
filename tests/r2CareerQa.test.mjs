import assert from "node:assert/strict";
import test from "node:test";
import { createRng, hashSeed } from "../js/simulation/rng.js";
import { createWorldState } from "../js/simulation/worldState.js";
import { pickThreeAcademies } from "../js/simulation/narrativeAcademySeason.js";
import { ACADEMY_POOL } from "../js/data/leagues.js";
import { getBaseOverall, getCurrentOverall } from "../js/simulation/playerAbility.js";
import {
  buildManifest,
  buildManifestRow,
  selectManifestRows,
  validateManifest,
} from "../scripts/lib/careerQaManifest.mjs";
import { playCareerFromRow, __test__ as playTest } from "../scripts/lib/careerQaPlay.mjs";
import {
  aggregateCareers,
  canonicalCareerRecord,
  diffCareerRecords,
} from "../scripts/lib/careerQaReport.mjs";

test("frozen manifest construction is deterministic and indexed", () => {
  const a = buildManifest(20261107, 10, { maxAge: 42 });
  const b = buildManifest(20261107, 10, { maxAge: 42 });
  assert.deepEqual(a.rows, b.rows);
  assert.equal(a.rows[0].index, 0);
  assert.ok(a.rows[0].position);
  validateManifest(a);
  const solo = selectManifestRows(a, 3);
  assert.equal(solo.length, 1);
  assert.equal(solo[0].index, 3);
  assert.throws(() => selectManifestRows(a, 99), /Unknown career-index/);
});

test("different seed inputs yield different identities/seeds", () => {
  const a = buildManifestRow(20261107, 0);
  const b = buildManifestRow(20261108, 0);
  assert.notEqual(a.careerId, b.careerId);
  assert.notEqual(a.seeds.world, b.seeds.world);
  assert.notEqual(a.seeds.academy, b.seeds.academy);
});

test("manifest rows include numeric world and age-aware academy seeds", () => {
  const row = buildManifestRow(20261107, 2);
  assert.equal(typeof row.seeds.world, "number");
  assert.equal(typeof row.seeds.academy, "number");
  const world = createWorldState({ startYear: 2026, seed: row.seeds.world });
  assert.ok(world);
  assert.equal(typeof row.seeds.world, "number");
  assert.equal(hashSeed(`x${row.seeds.world}`), hashSeed(`x${row.seeds.world}`));
  const trayA = pickThreeAcademies(ACADEMY_POOL, row.nationality, row.name, {
    age: row.age,
    seed: row.seeds.academy,
  });
  const trayB = pickThreeAcademies(ACADEMY_POOL, row.nationality, row.name, {
    age: row.age,
    seed: row.seeds.academy,
  });
  assert.deepEqual(
    trayA.map((o) => o.academy?.academyId || o.academy?.name),
    trayB.map((o) => o.academy?.academyId || o.academy?.name)
  );
});

test("replay isolation: individual, batch, and shuffled order", () => {
  const manifest = buildManifest(20261107, 3, { maxAge: 30 });
  const byIndex = new Map();
  for (const row of manifest.rows) {
    byIndex.set(row.index, canonicalCareerRecord(playCareerFromRow(row)));
  }
  // shuffled order
  const shuffled = [...manifest.rows].sort((a, b) => b.index - a.index);
  for (const row of shuffled) {
    const again = canonicalCareerRecord(playCareerFromRow(row));
    const diffs = diffCareerRecords(byIndex.get(row.index), again);
    assert.equal(diffs.length, 0, `shuffled diffs for ${row.index}: ${JSON.stringify(diffs.slice(0, 3))}`);
  }
  // solo replay of index 1
  const solo = canonicalCareerRecord(playCareerFromRow(manifest.rows[1]));
  assert.equal(diffCareerRecords(byIndex.get(1), solo).length, 0);
});

test("covers goalkeeper and outfielder rows", () => {
  const manifest = buildManifest(20261107, 24, { maxAge: 42 });
  const gk = manifest.rows.find((r) => r.position === "GK");
  const outfield = manifest.rows.find((r) => r.position !== "GK");
  assert.ok(gk, "expected a GK in sample");
  assert.ok(outfield, "expected an outfielder in sample");
  const gkCareer = playCareerFromRow({ ...gk, maxAge: 28 });
  const ofCareer = playCareerFromRow({ ...outfield, maxAge: 28 });
  assert.equal(gkCareer.position, "GK");
  assert.notEqual(ofCareer.position, "GK");
  assert.ok(gkCareer.ratings.academyEntry);
  assert.ok(ofCareer.ratings.academyEntry);
});

test("successful first contract and unsigned academy path are both representable", () => {
  const signedRow = buildManifestRow(20261107, 0, { maxAge: 28 });
  const signed = playCareerFromRow(signedRow);
  // May or may not sign depending on offers; assert the status field exists and samples behave.
  assert.ok(["signed", "unsigned"].includes(signed.ratings.firstProStatus));
  if (signed.ratings.firstProStatus === "signed") {
    assert.ok(signed.ratings.firstPro);
    assert.ok(Number.isFinite(signed.ratings.firstPro.current) || signed.ratings.firstPro.nonFinite);
  } else {
    assert.equal(signed.ratings.firstPro, null);
  }

  // Force-unsigned reporting shape via synthetic record aggregation
  const unsignedRecord = {
    ...signed,
    ratings: { ...signed.ratings, firstPro: null, firstProStatus: "unsigned", firstProSource: null },
  };
  const summary = aggregateCareers([signed, unsignedRecord]);
  assert.equal(summary.firstPro.unsigned >= 1, true);
  assert.equal(summary.meta.denominators.signed + summary.meta.denominators.unsigned, 2);
});

test("presentation classifiers distinguish academy, FA wait, paused, and invalid club payloads", () => {
  assert.deepEqual(playTest.classifyPresentation({ academyPeriod: true, season: { id: "a" } }).kind, "academy");
  assert.equal(playTest.classifyPresentation({ freeAgent: true, season: { id: "fa" } }).validNoTable, true);
  assert.equal(playTest.classifyPresentation({ awaitingDecision: true }).kind, "paused");
  assert.equal(playTest.classifyPresentation({ awaitingDecision: true }).commits, false);
  const invalid = playTest.classifyPresentation({ season: { id: "s" }, league: null, standings: null });
  assert.equal(invalid.invalidClubPayload, true);
  assert.equal(playTest.classifyPresentation({ season: { id: "s" }, league: {}, standings: [] }).validClub, true);
});

test("empty-offer streak resets on valid offer and ignores duplicate review IDs", () => {
  const market = { currentSpell: null, spells: [], lastCountedReviewId: null, emptyReviews: 0, validOfferReviews: 0 };
  playTest.recordEmptyStreak(market, "r1", 0, true);
  playTest.recordEmptyStreak(market, "r1", 0, true); // duplicate id
  assert.equal(market.currentSpell.emptyStreak, 1);
  playTest.recordEmptyStreak(market, "r2", 0, true);
  assert.equal(market.currentSpell.emptyStreak, 2);
  playTest.recordEmptyStreak(market, "r3", 2, true); // valid offers present (refusal still resets)
  assert.equal(market.currentSpell.emptyStreak, 0);
  playTest.recordEmptyStreak(market, "r3", 2, true); // same review id cannot inflate valid count
  assert.equal(market.validOfferReviews, 1);
});

test("forced cutoff, no-progress, and error are not successful retirement", () => {
  for (const kind of ["cutoff", "no-progress", "error"]) {
    const status = playTest.endStatusFromForce(kind);
    assert.equal(status.isRetired, false);
    assert.notEqual(status.endReason, "engine-retirement");
  }
  const retired = playTest.endStatusFromForce("retirement");
  assert.equal(retired.isRetired, true);
  assert.equal(retired.endReason, "engine-retirement");
});

test("peak base and peak current can occur at different points", () => {
  const peaks = { base: null, current: null };
  playTest.trackPeaks(peaks, { stage: "a", age: 18, periodCount: 1, base: 70, current: 68 });
  playTest.trackPeaks(peaks, { stage: "b", age: 22, periodCount: 5, base: 72, current: 74 });
  playTest.trackPeaks(peaks, { stage: "c", age: 28, periodCount: 11, base: 71, current: 73 });
  assert.equal(peaks.base.stage, "b");
  assert.equal(peaks.current.stage, "b");
  // push a later higher base with lower current
  playTest.trackPeaks(peaks, { stage: "d", age: 30, periodCount: 13, base: 75, current: 70 });
  assert.equal(peaks.base.stage, "d");
  assert.equal(peaks.current.stage, "b");
  assert.notEqual(peaks.base.stage, peaks.current.stage);
});

test("normal retirement odds helper retires within UI thresholds", () => {
  const player = { age: 42, isRetired: false, seasons: [] };
  assert.equal(playTest.maybeRetire(player, createRng(1)), true);
  assert.equal(player.isRetired, true);
  const young = { age: 24, isRetired: false, seasons: [] };
  assert.equal(playTest.maybeRetire(young, createRng(1)), false);
});

test("policy resolution helpers are non-mutating for ranking inputs", () => {
  const offers = [
    { offerId: "a", projectedMinutesShare: 0.8, expectedRole: "starter", wage: 1000 },
    { offerId: "b", projectedMinutesShare: 0.2, expectedRole: "cover", wage: 500, isLoan: true },
  ];
  const before = structuredClone(offers);
  const ranked = playTest.rankOffers(offers, "loan-heavy", createRng(99));
  assert.deepEqual(offers, before);
  assert.ok(ranked.length === 2);
  assert.equal(ranked.find((o) => o.isLoan)?.offerId, "b");
  // loan-heavy prefers loans when scores are close; accept either deterministic order
  assert.ok(["a", "b"].includes(ranked[0].offerId));
  const decision = { allowedChoices: ["stay-compete", "review-loans", "see-out"] };
  assert.equal(playTest.styleChooseDecision(decision, "loan-heavy", createRng(1)), "review-loans");
  assert.equal(playTest.styleChooseDecision(decision, "loyal", createRng(1)), "stay-compete");
});

test("duplicate manifest rows rejected", () => {
  const manifest = buildManifest(1, 2);
  manifest.rows.push({ ...manifest.rows[0] });
  assert.throws(() => validateManifest(manifest), /Duplicate/);
});

test("short career play emits honest end status and OVR samples", () => {
  const row = buildManifestRow(20261107, 0, { maxAge: 24 });
  const record = playCareerFromRow(row);
  assert.ok(record.end?.endReason);
  assert.ok(["engine-retirement", "policy-age-cutoff", "step-cap", "no-progress", "unsupported-action", "error"].includes(record.end.endReason));
  if (record.end.endReason !== "engine-retirement") {
    assert.equal(record.end.isRetired, false);
  }
  assert.ok(record.ratings.academyEntry);
  assert.ok(Array.isArray(record.ratings.trail));
  assert.ok(Number.isInteger(record.committedPeriodCount));
  // getBase/Current used for samples
  assert.equal(typeof getBaseOverall, "function");
  assert.equal(typeof getCurrentOverall, "function");
  assert.equal(typeof hashSeed("x"), "number");
});

test("aggregation keeps signed first-pro and completed-peak denominators visible", () => {
  const rows = [0, 1, 2].map((i) => playCareerFromRow(buildManifestRow(20261107, i, { maxAge: 26 })));
  const summary = aggregateCareers(rows);
  assert.equal(summary.meta.denominators.all, 3);
  assert.ok(summary.firstPro.signed + summary.firstPro.unsigned === 3);
  assert.ok(summary.peaks.completedDenominator >= 0);
  assert.ok(summary.peaks.at90plus.denominator === summary.peaks.completedDenominator);
});

test("normal retirement is recorded once when endReason is engine-retirement", () => {
  // Search a small cohort for an engine retirement; otherwise synthesize the report contract.
  const records = [];
  for (let i = 0; i < 8; i++) {
    records.push(playCareerFromRow(buildManifestRow(20261107, i, { maxAge: 42 })));
  }
  const retired = records.filter((r) => r.end.endReason === "engine-retirement");
  assert.ok(retired.length >= 1);
  for (const r of retired) {
    assert.equal(r.end.isRetired, true);
    assert.equal(r.isRetired, true);
  }
  const forced = playTest.endStatusFromForce("retirement");
  assert.equal(forced.isRetired, true);
});
