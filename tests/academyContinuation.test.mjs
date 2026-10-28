/**
 * Fix 04 — Academy continuation, graduation and exit regression matrix.
 * Uses production simulateSeason / lifecycle / deal pipeline.
 */
import { ACADEMY_POOL, LEAGUES, LEAGUE_LOOKUP, LEAGUE_BY_ID } from "../js/data/leagues.js";
import {
  createPlayerIdentity,
  finalizeAcademyPlayer,
  applySkipOpeningDevelopment,
  promoteAcademyGraduateToFirstTeam,
} from "../js/simulation/playerDevelopment.js";
import { buildNarrativeAcademySeason } from "../js/simulation/narrativeAcademySeason.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import { simulateChronologicalSeason } from "../js/simulation/chronologicalSeason.js";
import { simulateLeagueSeason } from "../js/simulation/leagueFixtures.js";
import { createWorldState, setWorldState, getWorldState } from "../js/simulation/worldState.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import { reseedCareerRng } from "../js/simulation/rng.js";
import {
  ensureContractAuthority,
  selectNextCareerAction,
  assertPlayableRegistration,
  isFreeAgent,
  isContractActive,
} from "../js/simulation/contractLifecycle.js";
import {
  advanceAcademyPeriod,
  acceptAcademyGraduationOffer,
  declineAcademyReview,
  buildAndPersistAcademyReview,
  ensureAcademyLifecycle,
  migrateAcademyLifecycle,
  assertUsableAcademyResult,
  assertNotAcademyForSeniorSimulation,
  ACADEMY_EXIT_AGE,
  ACADEMY_RESULT_KIND,
  findExecutableParentOffer,
  reconcileAcademyReviewTray,
} from "../js/simulation/academyLifecycle.js";
import { renderTransferOffers } from "../js/ui/rendering.js";
import { FakeElement, installMinimalDom } from "./helpers/minimalDom.mjs";
import { buildFirstProContractDecision, signFirstProfessionalContract } from "../js/simulation/proContractOffers.js";
import { buildValidatedOffer, acceptPipelineOffer } from "../js/simulation/dealPipeline.js";
import {
  getOrInitClubSeasonFinance,
  exportClubFinanceState,
} from "../js/simulation/clubFinance.js";
import { roundTripCareerSnapshot } from "../js/simulation/careerSnapshot.js";
import { ensureTransferSave } from "../js/simulation/transferMigration.js";
import {
  emptyOfferProvider,
  buildAcademyBrowserFixture,
} from "../js/simulation/academyBrowserFixture.js";
import { skipCareerIntroBootstrap } from "../js/ui/careerStartFlow.js";
import { findSeniorClubById } from "../js/simulation/seniorClubs.js";
import { refreshAbilityCaches } from "../js/simulation/playerAbility.js";
import { generateTransferOffers } from "../js/simulation/transferMarket.js";

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg, data) {
  if (!cond) {
    failed += 1;
    failures.push({ msg, data });
    console.error(`FAIL: ${msg}`, data ?? "");
    throw new Error(msg);
  }
}

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (err) {
    if (!failures.some((f) => f.msg === err.message)) {
      failed += 1;
      failures.push({ msg: name, data: err.message });
      console.error(`FAIL: ${name}`, err.message);
    }
  }
}

function villaAcademy() {
  const a = ACADEMY_POOL.find((x) => x.parentClub?.clubId === "club:england:aston-villa");
  assert(a, "Aston Villa academy fixture missing");
  return a;
}

function secondDivAcademy() {
  const a = ACADEMY_POOL.find((x) => /championship/i.test(x.league || x.parentClub?.league || ""));
  assert(a, "English Championship academy missing");
  return a;
}

function nonEnglishAcademy() {
  const a = ACADEMY_POOL.find(
    (x) =>
      x.parentClub?.clubId &&
      x.nation &&
      x.nation !== "England" &&
      !/england/i.test(x.league || "")
  );
  assert(a, "non-English academy missing");
  return a;
}

/** Deterministic review with exactly `count` real first-pro offers. */
function persistReviewWithOfferCount(player, { isFinal = false, count = 1 } = {}) {
  const review = buildAndPersistAcademyReview(player, {
    isFinal,
    offerProvider(p) {
      const d = buildFirstProContractDecision(p);
      assert(d.offers.length > 0, "builder produced no offers for controlled count");
      // If fewer than needed, pad by reusing validated rebuilds is not allowed —
      // require enough natural offers or boost once.
      if (d.offers.length < count) {
        for (const k of Object.keys(p.attributes || {})) p.attributes[k] = Math.max(p.attributes[k], 78);
        refreshAbilityCaches(p);
        const again = buildFirstProContractDecision(p);
        assert(again.offers.length >= count, "need enough offers for fixture", {
          have: again.offers.length,
          need: count,
        });
        return { ...again, offers: again.offers.slice(0, count) };
      }
      return { ...d, offers: d.offers.slice(0, count) };
    },
  });
  assert(review.offers.length === count, "review offer count", {
    got: review.offers.length,
    count,
  });
  assert((player.pendingOffers || []).length === count, "tray offer count");
  return review;
}

function makeAcademyPlayer({
  academy = villaAcademy(),
  age = 17,
  position = "RW",
  nationality = "England",
  name = "Academy Cont Test",
  emptyOffers = false,
  seed = 42,
} = {}) {
  resetClubFinanceLedgers();
  setWorldState(createWorldState({ startYear: 2026 }));
  reseedCareerRng(seed);
  const p = createPlayerIdentity({ name, nationality, position, age: Math.min(age, 19) });
  finalizeAcademyPlayer(p, academy);
  applySkipOpeningDevelopment(p);
  // createPlayerIdentity clamps start age to 15–19; tests may need over-age academy.
  p.age = age;
  const year = buildNarrativeAcademySeason(p, p.rating, p.rating, { seasonNumber: 1 });
  p.seasons.push(year);
  for (const k of ["matches", "goals", "assists", "cleanSheets"]) {
    p.careerTotals[k] += year[k];
  }
  p.academyCareerTotals = {
    matches: year.matches,
    goals: year.goals,
    assists: year.assists,
    cleanSheets: year.cleanSheets,
  };
  p.careerIntroComplete = true;
  p.suppressParentContractOffer = true;
  p.pendingOffers = [];
  if (emptyOffers) p.academyOfferProvider = emptyOfferProvider;
  ensureContractAuthority(p);
  ensureAcademyLifecycle(p);
  p.academyLifecycle.periodCount = 1;
  return p;
}

function seniorPlControl() {
  const league = LEAGUE_BY_ID.get("league:england-premier-league") || LEAGUES[0];
  const clubs = [...(league.clubs || [])];
  assert(clubs.length === 20, "PL should have 20 clubs", { n: clubs.length });
  resetClubFinanceLedgers();
  setWorldState(createWorldState({ startYear: 2026 }));
  const club = clubs[0];
  // Use academy finalize then graduate-style senior attach so attributes exist.
  const p = createPlayerIdentity({
    name: "Senior PL Control",
    nationality: "England",
    position: "CM",
    age: 19,
  });
  finalizeAcademyPlayer(p, villaAcademy());
  applySkipOpeningDevelopment(p);
  p.age = 24;
  p.club = {
    ...club,
    league: league.name,
    leagueDisplay: league.displayName,
    leagueId: league.leagueId,
    nation: league.nation,
    isAcademy: false,
    parentClub: null,
  };
  p.employmentClubId = club.clubId;
  p.playingClubId = club.clubId;
  p.contractStartSeason = 0;
  p.contractYears = 5;
  p.contractEndSeason = 5;
  p.contractStatus = "active";
  p.weeklyWage = 20000;
  p.wage = 20000;
  p.seasons = [];
  if (p.academyLifecycle) p.academyLifecycle.status = "graduated";
  ensureContractAuthority(p);
  const chrono = simulateChronologicalSeason({
    player: p,
    league,
    seasonIndex: 0,
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  return { league, clubs, chrono, player: p };
}

// ---------------------------------------------------------------------------
test("Healthy Aston Villa Academy continuation — no senior fixtures", () => {
  const p = makeAcademyPlayer({ emptyOffers: true });
  const beforeAge = p.age;
  const beforeSeasons = p.seasons.length;
  const data = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  assert(data.academyPeriod === true, "academyPeriod flag");
  assert(data.resultKind === ACADEMY_RESULT_KIND.PERIOD, "result kind period");
  assert(p.age === beforeAge + 1, "one birthday");
  assert(p.seasons.length === beforeSeasons + 1, "one history record");
  assert(data.season?.isNarrativeAcademyYear === true, "narrative marker");
  assert((data.season?.matches || 0) > 0, "youth activity");
  assert((data.leagueAllMatches || []).length === 0, "no senior fixtures");
  assert((data.leaguePlayerMatches || []).length === 0, "no attached fixtures");
  assert(data.standings == null, "no standings");
  const membership = getWorldState().leagueMemberships.get(p.club.leagueId);
  assert(membership?.length === 20, "senior membership stays 20", { n: membership?.length });
  assert(p.club?.isAcademy === true, "still academy");
  assert(p.playingClubId == null || p.playingClubId === undefined, "no senior playing id");
  const check = assertUsableAcademyResult(data);
  assert(check.ok, "usable academy result", check);
});

test("Second-division parent separation (Championship)", () => {
  const academy = secondDivAcademy();
  const p = makeAcademyPlayer({
    academy,
    nationality: "England",
    emptyOffers: true,
    name: "Championship Academy",
  });
  const data = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  assert(data.academyPeriod, "academy period");
  assert((data.leagueAllMatches || []).length === 0, "no senior fixtures championship");
  assert(p.club?.isAcademy, "still academy");
  assert(!p.employmentClubId, "no employment id");
});

test("Non-English association academy separation", () => {
  const academy = nonEnglishAcademy();
  const p = makeAcademyPlayer({
    academy,
    nationality: academy.nation || "Spain",
    emptyOffers: true,
    name: "Non-English Academy",
  });
  const data = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  assert(data.academyPeriod, "non-English academy period");
  assert((data.leagueAllMatches || []).length === 0, "no senior fixtures non-English");
  assert(p.club?.isAcademy, "still academy non-English");
  assert(academy.nation !== "England", "fixture is non-English", { nation: academy.nation });
});

test("Real zero-offer review below 21 → continuation", () => {
  const p = makeAcademyPlayer({ emptyOffers: true, age: 17 });
  const data = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  assert(data.boundary?.action === "continue-academy", "continue action", data.boundary);
  assert((p.pendingOffers || []).length === 0, "no pending offers");
  assert(selectNextCareerAction(p).id === "academy-season", "next academy season");
  assert(p.age === 18, "aged to 18");
  // Second period still works.
  const data2 = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  assert(data2.academyPeriod, "second period");
  assert(p.age === 19, "aged to 19");
  assert(p.seasons.length === 3, "three history records");
});

test("Sole failed offer below 21 → enrolled continuation (finance validation)", () => {
  const p = makeAcademyPlayer({ age: 18 });
  for (const k of Object.keys(p.attributes || {})) p.attributes[k] = Math.max(p.attributes[k], 76);
  refreshAbilityCaches(p);
  const review = persistReviewWithOfferCount(p, { isFinal: false, count: 1 });
  const deal = review.offers[0];
  const beforeAge = p.age;
  const beforeSeasons = p.seasons.length;
  const ledger = getOrInitClubSeasonFinance(
    deal.offer.clubId,
    String((p.startYear || 2026) + p.seasons.length)
  );
  ledger.remainingWageHeadroom = 0;
  const financeBefore = JSON.stringify(exportClubFinanceState());
  const result = acceptAcademyGraduationOffer(p, deal);
  assert(!result.ok, "accept fails");
  assert(result.action === "continue-academy", "continue academy", result);
  assert(p.club?.isAcademy === true, "still academy");
  assert((p.pendingOffers || []).length === 0, "no pending after sole fail");
  assert(selectNextCareerAction(p).canSimulate === true, "continuation enabled");
  assert(p.age === beforeAge, "no birthday on failed accept");
  assert(p.seasons.length === beforeSeasons, "no period on failed accept");
  assert(financeBefore === JSON.stringify(exportClubFinanceState()), "finances unchanged");
});

test("Sole failed final offer → release without year", () => {
  const built = buildAcademyBrowserFixture({ mode: "age21-final-offers" });
  assert(built.ok, "fixture", built.reason);
  const p = built.player;
  const review = persistReviewWithOfferCount(p, { isFinal: true, count: 1 });
  const deal = review.offers[0];
  const beforeAge = p.age;
  const beforeSeasons = p.seasons.length;
  const ledger = getOrInitClubSeasonFinance(
    deal.offer.clubId,
    String((p.startYear || 2026) + p.seasons.length)
  );
  ledger.remainingWageHeadroom = 0;
  const financeBefore = JSON.stringify(exportClubFinanceState());
  const result = acceptAcademyGraduationOffer(p, deal);
  assert(!result.ok, "accept fails");
  assert(result.released === true, "released", result);
  assert(isFreeAgent(p), "free agent");
  assert((p.pendingOffers || []).length === 0, "tray empty");
  assert(p.age === beforeAge, "no birthday");
  assert(p.seasons.length === beforeSeasons, "no period");
  assert(financeBefore === JSON.stringify(exportClubFinanceState()), "finances unchanged");
  assert(selectNextCareerAction(p).id === "free-agent", "FA next action");
});

test("One failed offer preserves still-valid alternative", () => {
  const p = makeAcademyPlayer({ age: 18 });
  for (const k of Object.keys(p.attributes || {})) p.attributes[k] = Math.max(p.attributes[k], 78);
  refreshAbilityCaches(p);
  const review = persistReviewWithOfferCount(p, { isFinal: false, count: 2 });
  const badDeal = review.offers[0];
  const goodId = review.offers[1].offer.offerId;
  const ledger = getOrInitClubSeasonFinance(
    badDeal.offer.clubId,
    String((p.startYear || 2026) + p.seasons.length)
  );
  ledger.remainingWageHeadroom = 0;
  const result = acceptAcademyGraduationOffer(p, badDeal);
  assert(!result.ok, "first fails");
  assert(result.action === "remaining-offers", "remaining action", result);
  assert(p.club?.isAcademy === true, "still academy");
  assert((p.pendingOffers || []).length === 1, "one remaining", {
    n: p.pendingOffers?.length,
    ids: p.pendingOffers?.map((o) => o.offerId),
  });
  assert(p.pendingOffers[0].offerId === goodId, "preserved other offer id");
  assert(p.academyLifecycle.status === "pending-review", "review still pending");
});

test("Declined final review rejects cloned offer replay; fresh FA offer can sign", () => {
  const built = buildAcademyBrowserFixture({ mode: "age21-final-offers" });
  assert(built.ok, "fixture", built.reason);
  const p = built.player;
  const clone = structuredClone(p.pendingOffers[0]);
  const reviewId = p.academyLifecycle.pendingReviewId;
  const declined = declineAcademyReview(p);
  assert(declined.released === true, "released on decline");
  assert(isFreeAgent(p), "FA");
  assert(p.academyLifecycle.consumedReviewIds.includes(reviewId), "review consumed");
  const dealsBefore = (p.completedDealIds || []).length;
  const financeBefore = JSON.stringify(exportClubFinanceState());
  const replay = acceptPipelineOffer(p, clone);
  assert(!replay.ok, "replay rejected", replay);
  assert(
    replay.reason === "journal-declined" || replay.reason === "closed-academy-review",
    "closed reason",
    replay
  );
  assert(isFreeAgent(p), "still FA after replay");
  assert((p.completedDealIds || []).length === dealsBefore, "no new deals");
  assert(financeBefore === JSON.stringify(exportClubFinanceState()), "no finance change");
  // Fresh free-agent interest must still be allowed.
  for (const k of Object.keys(p.attributes || {})) p.attributes[k] = Math.max(p.attributes[k], 78);
  refreshAbilityCaches(p);
  const fresh = generateTransferOffers(70, p, LEAGUES, LEAGUE_LOOKUP, 7.0);
  // If market empty, build a validated free_agent offer directly.
  let offer = fresh?.[0];
  if (!offer) {
    const club = LEAGUES.flatMap((l) => l.clubs || []).find((c) => c.clubId && !c.isAcademy);
    const builtOffer = buildValidatedOffer({
      player: p,
      club,
      dealType: "free_agent",
      performanceScore: 80,
    });
    assert(builtOffer.ok, "fresh FA offer validates", builtOffer.reasons);
    offer = builtOffer.offer;
  }
  // Ensure no academy review tag on the fresh offer.
  delete offer.academyReviewId;
  const signed = acceptPipelineOffer(p, offer);
  assert(signed.ok, "fresh offer signs", signed);
  assert(!isFreeAgent(p), "no longer FA");
  assert(p.club && !p.club.isAcademy, "senior club");
});

test("Parent first-pro deal graduates with coherent IDs", () => {
  const p = makeAcademyPlayer({ age: 18 });
  // Villa is elite — raise ability into forceParent prospect gap.
  for (const k of Object.keys(p.attributes || {})) {
    p.attributes[k] = 82;
  }
  refreshAbilityCaches(p);
  p.suppressParentContractOffer = false;
  const parent = findSeniorClubById(p.club.parentClub.clubId);
  assert(parent, "parent club resolves by id");
  const built = buildValidatedOffer({
    player: p,
    club: parent,
    dealType: "first_pro",
    performanceScore: 90,
    forceParent: true,
  });
  assert(built.ok, "parent offer validates", built.reasons);
  const signed = signFirstProfessionalContract(p, {
    kind: "parent",
    club: parent,
    offer: built.offer,
  });
  assert(signed.ok, "signed parent", signed);
  assert(!p.club?.isAcademy, "not academy");
  assert(p.employmentClubId === parent.clubId || p.club?.clubId === parent.clubId, "employment id");
  assert(p.playingClubId === parent.clubId || p.club?.clubId === parent.clubId, "playing id");
  assert(isContractActive(p), "contract active");
  assert(p.weeklyWage > 0, "wage booked");
  const gate = assertNotAcademyForSeniorSimulation(p);
  assert(gate.ok, "senior gate allows graduate");
});

test("Suitable non-parent first-pro deal", () => {
  const p = makeAcademyPlayer({ age: 18 });
  p.rating = 72;
  const decision = buildFirstProContractDecision(p);
  const nonParent = decision.offers.find((o) => o.kind !== "parent");
  if (!nonParent) {
    // Force a non-parent club from the same league.
    const league = LEAGUE_BY_ID.get(p.club.leagueId);
    const other = (league?.clubs || []).find((c) => c.clubId !== p.club.parentClub?.clubId);
    assert(other, "other club exists");
    const built = buildValidatedOffer({
      player: p,
      club: other,
      dealType: "first_pro",
      performanceScore: 80,
    });
    assert(built.ok, "non-parent validates", built.reasons);
    const signed = acceptPipelineOffer(p, { ...built.offer, isParentOffer: false });
    assert(signed.ok, "non-parent signed", signed);
    assert(p.club?.clubId === other.clubId, "destination club");
  } else {
    const signed = signFirstProfessionalContract(p, nonParent);
    assert(signed.ok, "non-parent from decision", signed);
  }
  assert(!p.club?.isAcademy, "graduated");
  assert(p.seasons.some((s) => s.isNarrativeAcademyYear), "academy history preserved");
});

test("Missing parent — no bare senior-flag flip", () => {
  const p = makeAcademyPlayer({ age: 18 });
  delete p.club.parentClub;
  const promo = promoteAcademyGraduateToFirstTeam(p);
  assert(promo === null, "promo null");
  assert(p.club?.isAcademy === true, "still academy");
  assert(p.club?.clubId == null || p.club?.clubId === undefined, "no fake club id");
  assert(assertPlayableRegistration(p).mode === "academy", "still academy mode");
});

test("Age 20→21 no offers → immediate release", () => {
  const p = makeAcademyPlayer({ age: 20, emptyOffers: true });
  const beforeSeasons = p.seasons.length;
  const data = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  assert(p.age === 21, "age 21");
  assert(p.seasons.length === beforeSeasons + 1, "one youth year only");
  assert(data.boundary?.released || data.freeAgent || isFreeAgent(p), "released");
  assert(isFreeAgent(p), "free agent");
  assert(!p.club, "no club");
  assert(selectNextCareerAction(p).id === "free-agent", "FA next action");
});

test("Final review with offers at 21 — accept graduates; decline releases", () => {
  const p = makeAcademyPlayer({ age: 21 });
  p.rating = 72;
  const review = buildAndPersistAcademyReview(p, { isFinal: true });
  assert(!review.emptyOffers, "final offers exist", review);
  assert(p.academyLifecycle.status === "pending-final-review", "pending final");
  assert(selectNextCareerAction(p).canSimulate === false, "blocked from another year");

  // Decline-all releases.
  const p2 = makeAcademyPlayer({ age: 21 });
  p2.rating = 72;
  buildAndPersistAcademyReview(p2, { isFinal: true });
  const declined = declineAcademyReview(p2);
  assert(declined.released, "decline releases");
  assert(isFreeAgent(p2), "FA after decline");

  // Accept graduates.
  const deal = review.offers[0];
  const accepted = acceptAcademyGraduationOffer(p, deal);
  assert(accepted.ok, "accept ok", accepted);
  assert(!p.club?.isAcademy, "graduated");
  assert(p.academyLifecycle.status === "graduated", "status graduated");
});

test("Legacy academy at 21 and 35 — review/release without year", () => {
  for (const age of [21, 35]) {
    const p = makeAcademyPlayer({ age, emptyOffers: true });
    const before = p.seasons.length;
    const data = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions: false,
      autoDecisionPolicy: "stay",
    });
    assert(p.seasons.length === before, `no year at ${age}`, { before, after: p.seasons.length });
    assert(p.age === age, `no birthday at ${age}`);
    assert(data.reviewOnly === true, `reviewOnly at ${age}`);
    assert(isFreeAgent(p), `released at ${age}`);
  }
});

test("Released graduate: empty market then FA path", () => {
  const p = makeAcademyPlayer({ age: 21, emptyOffers: true });
  simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, { pauseForDecisions: false });
  assert(isFreeAgent(p), "released");
  const fa = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, { pauseForDecisions: false });
  assert(fa.freeAgent === true, "FA period");
  assert(p.age === 22, "FA year ages once");
  assert(fa.season?.freeAgent === true, "FA season record");
});

test("Repeated advance is exact-once for period id", () => {
  const p = makeAcademyPlayer({ emptyOffers: true });
  const first = advanceAcademyPeriod(p);
  assert(first.ok && first.academyPeriod, "first period");
  const periodId = first.periodId;
  const age = p.age;
  const seasons = p.seasons.length;
  // Re-apply same period id should fail.
  const dup = advanceAcademyPeriod(p, { periodId });
  assert(!dup.ok || dup.reason === "period-already-applied" || p.age === age + 1, "dup guarded");
  // Fresh next period still works once.
  if (p.age < ACADEMY_EXIT_AGE) {
    const second = advanceAcademyPeriod(p);
    assert(second.ok && second.academyPeriod, "second period");
    assert(p.seasons.length === seasons + 1, "one more record");
  }
});

test("Snapshot round-trip preserves academy lifecycle", () => {
  const p = makeAcademyPlayer({ emptyOffers: true });
  simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, { pauseForDecisions: false });
  p.rating = 70;
  delete p.academyOfferProvider;
  const review = buildAndPersistAcademyReview(p, { isFinal: false });
  const reviewId = review.reviewId;
  const snap = roundTripCareerSnapshot({ player: p, world: getWorldState() });
  assert(snap?.player, "snapshot player");
  const restored = snap.player;
  migrateAcademyLifecycle(restored);
  assert(restored.academyLifecycle?.pendingReviewId === reviewId, "review id survives");
  assert(restored.club?.isAcademy, "academy survives");
  assert(restored.age === p.age, "age survives");
  assert(restored.seasons.length === p.seasons.length, "history length");
});

test("Opening bootstrap produces valid continuation or graduate", () => {
  resetClubFinanceLedgers();
  setWorldState(createWorldState({ startYear: 2026 }));
  const p = createPlayerIdentity({
    name: "Bootstrap Academy",
    nationality: "England",
    position: "CM",
    age: 17,
  });
  skipCareerIntroBootstrap(p, ACADEMY_POOL);
  assert(p.seasons.length === 1, "one opening record");
  assert(p.seasons[0].isNarrativeAcademyYear, "opening narrative");
  if (p.club?.isAcademy) {
    ensureAcademyLifecycle(p);
    assert(p.academyLifecycle.status === "enrolled", "enrolled after empty");
    const data = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions: false,
      autoDecisionPolicy: "stay",
      // allow natural offers; still must not enter senior fixtures
    });
    assert(data.academyPeriod || data.reviewOnly || data.freeAgent || !p.club?.isAcademy, "valid post-bootstrap");
    if (data.academyPeriod) {
      assert((data.leagueAllMatches || []).length === 0, "bootstrap continuation no senior fixtures");
    }
  } else {
    assert(p.employmentClubId || p.club?.clubId, "graduated with club");
  }
});

test("GK youth record supported", () => {
  const p = makeAcademyPlayer({ position: "GK", emptyOffers: true, name: "GK Youth" });
  const data = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  assert(data.academyPeriod, "gk period");
  assert((data.season?.matches || 0) > 0, "gk youth matches");
  assert(data.season?.seniorAppearances === 0, "no senior apps");
});

test("Direct senior-generator guard + PL control 20/380/38", () => {
  const p = makeAcademyPlayer({ emptyOffers: true });
  const gate = assertNotAcademyForSeniorSimulation(p);
  assert(!gate.ok, "gate rejects academy");
  let threw = false;
  try {
    simulateChronologicalSeason({
      player: p,
      league: LEAGUE_LOOKUP.get(p.club.league),
      seasonIndex: 1,
      pauseForDecisions: false,
      autoDecisionPolicy: "stay",
    });
  } catch {
    threw = true;
  }
  assert(threw, "chrono throws for academy");
  threw = false;
  try {
    simulateLeagueSeason(LEAGUE_LOOKUP.get(p.club.league), p, 70);
  } catch {
    threw = true;
  }
  assert(threw, "legacy league sim throws for academy");

  const { chrono, clubs, player: senior } = seniorPlControl();
  assert(clubs.length === 20, "20 clubs");
  const all = chrono.allMatches;
  assert(Array.isArray(all), "allMatches present", { keys: Object.keys(chrono || {}) });
  assert(all.length === 380, "380 fixtures", { n: all.length });
  const perClub = all.filter(
    (m) => m.home?.name === clubs[0].name || m.away?.name === clubs[0].name
  ).length;
  assert(perClub === 38, "38 per club", { perClub });
  // Positive player minutes on a healthy selected senior season.
  const playerMatches = chrono.playerMatches || chrono.leaguePlayerMatches || [];
  const minutes = playerMatches.reduce((s, m) => s + (Number(m.minutes) || 0), 0);
  assert(minutes > 0 || (chrono.playerMatchStats && Object.keys(chrono.playerMatchStats).length > 0), "senior participation recorded", {
    playerMatchCount: playerMatches.length,
    minutes,
    club: senior.club?.name,
  });
});

test("Migration clears suppress stuck state for over-age", () => {
  const p = makeAcademyPlayer({ age: 35, emptyOffers: true });
  p.suppressParentContractOffer = true;
  p.transferSaveVersion = 1;
  ensureTransferSave(p);
  assert(p.academyLifecycle, "lifecycle present");
  assert(p.transferSaveVersion >= 3, "save version bumped");
});

test("Snapshot restore of pending review keeps offer identity", () => {
  const p = makeAcademyPlayer({ age: 18 });
  for (const k of Object.keys(p.attributes || {})) p.attributes[k] = Math.max(p.attributes[k], 76);
  refreshAbilityCaches(p);
  const review = persistReviewWithOfferCount(p, { isFinal: false, count: 1 });
  const reviewId = review.reviewId;
  const offerId = review.offers[0].offer.offerId;
  delete p.academyOfferProvider;
  const snap = roundTripCareerSnapshot({ player: p, world: getWorldState() });
  const restored = snap.player;
  migrateAcademyLifecycle(restored);
  assert(restored.academyLifecycle?.pendingReviewId === reviewId, "review id restored");
  assert(
    (restored.pendingOffers || []).some((o) => o.offerId === offerId),
    "offer id restored"
  );
  const declined = declineAcademyReview(restored);
  assert(declined.action === "continue-academy", "decline continues below 21", declined);
  assert(restored.academyLifecycle.status === "enrolled", "enrolled after restore decline");
});

test("R4: rejected parent shortcut preserves non-parent final alternatives", () => {
  const fixture = buildAcademyBrowserFixture({ mode: "age21-final-offers" });
  assert(fixture.ok, "fixture", fixture);
  const p = fixture.player;
  const beforeIds = (p.pendingOffers || []).map((o) => o.offerId);
  assert(beforeIds.length >= 2, "two alternatives", beforeIds);
  assert(!findExecutableParentOffer(p), "no validated parent offer in tray");
  const financeBefore = JSON.stringify(exportClubFinanceState());
  const ageBefore = p.age;
  const histBefore = p.seasons.length;
  const promo = promoteAcademyGraduateToFirstTeam(p, 75);
  assert(promo === null, "parent promo rejected");
  assert((p.pendingOffers || []).map((o) => o.offerId).join() === beforeIds.join(), "offer IDs intact");
  assert(p.academyLifecycle.status === "pending-final-review", "still final review");
  assert(p.age === ageBefore && p.seasons.length === histBefore, "no year/growth");
  assert(financeBefore === JSON.stringify(exportClubFinanceState()), "finances unchanged");

  const restored = roundTripCareerSnapshot({ player: p, world: getWorldState() }).player;
  reconcileAcademyReviewTray(restored);
  assert((restored.pendingOffers || []).length === beforeIds.length, "tray after restore");
  const { ensure } = installMinimalDom(["offer-template", "transfer-offers", "simulate-btn"]);
  const offerTemplate = ensure("offer-template", "template");
  offerTemplate.content = {
    cloneNode() {
      const root = new FakeElement("", "div");
      const details = new FakeElement("", "div");
      details.className = "details";
      const actions = new FakeElement("", "div");
      actions.className = "offer-actions";
      root.appendChild(details);
      root.appendChild(actions);
      root.querySelector = (sel) => (sel === ".details" ? details : sel === ".offer-actions" ? actions : null);
      return root;
    },
  };
  const tray = ensure("transfer-offers");
  tray.children = [];
  const boom = () => {
    throw new Error("unexpected");
  };
  renderTransferOffers({
    player: restored,
    transferContainer: tray,
    simulateBtn: ensure("simulate-btn"),
    applyTransfer: boom,
    finishOfferWindow: boom,
    promoteToParentClub: boom,
  });
  const labels = tray.children.map((c) => c.textContent || "");
  assert(!labels.some((t) => /Sign with /i.test(t)), "no unsupported parent shortcut");
  assert(labels.some((t) => /Decline all and leave academy/i.test(t)), "decline-all present");
  const declined = declineAcademyReview(restored);
  assert(declined.released, "decline releases after restore", declined);
  assert(isFreeAgent(restored), "free agent after decline");
});

test("R4: failed sole parent offer settles final release / below-21 continue", () => {
  // Final: sole parent offer fails revalidation → release once.
  {
    const p = makeAcademyPlayer({ age: 21 });
    for (const k of Object.keys(p.attributes || {})) p.attributes[k] = Math.max(p.attributes[k], 78);
    refreshAbilityCaches(p);
    const parent = findSeniorClubById(p.club.parentClub.clubId);
    assert(parent, "parent resolves");
    const built = buildValidatedOffer({
      player: p,
      club: parent,
      dealType: "first_pro",
      performanceScore: 80,
      forceParent: true,
    });
    assert(built.ok, "parent builds for settlement fixture", built.reasons);
    const review = buildAndPersistAcademyReview(p, {
      isFinal: true,
      offerProvider() {
        return {
          offers: [{ offer: { ...built.offer, isParentOffer: true }, kind: "parent", club: parent }],
          verdict: { headline: "Parent", lead: "test" },
          emptyOffers: false,
          rejectionLog: [],
        };
      },
    });
    assert(review.offerCount === 1, "sole parent");
    assert(findExecutableParentOffer(p), "parent executable before fail");
    const ledger = getOrInitClubSeasonFinance(built.offer.clubId, String(p.startYear + p.seasons.length));
    ledger.remainingWageHeadroom = 0;
    const ageBefore = p.age;
    const histBefore = p.seasons.length;
    const financeBefore = JSON.stringify(exportClubFinanceState());
    const result = acceptAcademyGraduationOffer(p, {
      offer: p.pendingOffers[0],
      kind: "parent",
      club: parent,
    });
    assert(!result.ok && result.released, "final sole parent fail releases", result);
    assert(isFreeAgent(p), "FA");
    assert(p.age === ageBefore && p.seasons.length === histBefore, "no birthday/history");
    assert(financeBefore === JSON.stringify(exportClubFinanceState()), "no finance txn");
  }
  // Below 21: sole parent fail → continue academy.
  {
    const p = makeAcademyPlayer({ age: 18 });
    for (const k of Object.keys(p.attributes || {})) p.attributes[k] = Math.max(p.attributes[k], 78);
    refreshAbilityCaches(p);
    const parent = findSeniorClubById(p.club.parentClub.clubId);
    const built = buildValidatedOffer({
      player: p,
      club: parent,
      dealType: "first_pro",
      performanceScore: 80,
      forceParent: true,
    });
    assert(built.ok, "parent builds younger", built.reasons);
    buildAndPersistAcademyReview(p, {
      isFinal: false,
      offerProvider() {
        return {
          offers: [{ offer: { ...built.offer, isParentOffer: true }, kind: "parent", club: parent }],
          verdict: { headline: "Parent", lead: "test" },
          emptyOffers: false,
          rejectionLog: [],
        };
      },
    });
    const ledger = getOrInitClubSeasonFinance(built.offer.clubId, String(p.startYear + p.seasons.length));
    ledger.remainingWageHeadroom = 0;
    const result = acceptAcademyGraduationOffer(p, {
      offer: p.pendingOffers[0],
      kind: "parent",
      club: parent,
    });
    assert(!result.ok && result.action === "continue-academy", "younger continues", result);
    assert(p.club?.isAcademy, "still academy");
    assert(selectNextCareerAction(p).canSimulate === true, "can continue training");
  }
});

test("R4: successful parent offer from review graduates once", () => {
  const p = makeAcademyPlayer({ age: 21 });
  for (const k of Object.keys(p.attributes || {})) p.attributes[k] = Math.max(p.attributes[k], 82);
  refreshAbilityCaches(p);
  const parent = findSeniorClubById(p.club.parentClub.clubId);
  const built = buildValidatedOffer({
    player: p,
    club: parent,
    dealType: "first_pro",
    performanceScore: 85,
    forceParent: true,
  });
  assert(built.ok, "parent validates", built.reasons);
  const altClub = (LEAGUE_BY_ID.get(parent.leagueId)?.clubs || []).find((c) => c.clubId !== parent.clubId);
  const alt = altClub
    ? buildValidatedOffer({ player: p, club: altClub, dealType: "first_pro", performanceScore: 80 })
    : { ok: false };
  buildAndPersistAcademyReview(p, {
    isFinal: true,
    offerProvider() {
      const offers = [{ offer: { ...built.offer, isParentOffer: true }, kind: "parent", club: parent }];
      if (alt.ok) offers.push({ offer: alt.offer, kind: "counter", club: altClub });
      return { offers, verdict: { headline: "Deals", lead: "test" }, emptyOffers: false, rejectionLog: [] };
    },
  });
  assert(findExecutableParentOffer(p), "parent present");
  const siblingId = (p.pendingOffers || []).find((o) => o.clubId !== parent.clubId)?.offerId;
  const accepted = acceptAcademyGraduationOffer(p, {
    offer: findExecutableParentOffer(p),
    kind: "parent",
    club: parent,
  });
  assert(accepted.ok && accepted.graduated, "graduated", accepted);
  assert(p.club?.clubId === parent.clubId, "parent club");
  assert(!p.club?.isAcademy, "senior");
  assert(p.academyLifecycle.status === "graduated", "status");
  assert(isContractActive(p), "contract active");
  if (siblingId) {
    const replay = acceptPipelineOffer(p, {
      offerId: siblingId,
      clubId: altClub.clubId,
      dealType: "first_pro",
      academyReviewId: "stale",
    });
    assert(!replay.ok, "stale sibling rejected", replay);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.error(failures);
  process.exit(1);
}
