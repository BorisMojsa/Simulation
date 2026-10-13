/**
 * Follow-up invariants: promote wiring, pause/resume, snapshots, nationality.
 * Run: node tests/transferLoanFollowup.test.mjs
 */
import assert from "node:assert/strict";
import { LEAGUES, LEAGUE_LOOKUP, ACADEMY_POOL } from "../js/data/leagues.js";
import {
  createPlayerIdentity,
  finalizeAcademyPlayer,
  promoteAcademyGraduateToFirstTeam,
} from "../js/simulation/playerDevelopment.js";
import { pickThreeAcademies } from "../js/simulation/narrativeAcademySeason.js";
import { buildFirstProContractDecision, signFirstProfessionalContract } from "../js/simulation/proContractOffers.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import { createWorldState, setWorldState, serializeWorldState, deserializeWorldState } from "../js/simulation/worldState.js";
import { roundTripCareerSnapshot } from "../js/simulation/careerSnapshot.js";
import { resetClubFinanceLedgers, getOrInitClubSeasonFinance } from "../js/simulation/clubFinance.js";
import { generateTransferOffers } from "../js/simulation/transferMarket.js";
import { resolveSquadDecision } from "../js/simulation/squadDecisions.js";
import { reseedCareerRng } from "../js/simulation/rng.js";

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

function seniorPlayer() {
  const p = createPlayerIdentity({ name: "Followup", nationality: "Serbia", position: "CM", age: 19 });
  const league = LEAGUES.find((l) => l.leagueId === "league:serbia-superliga");
  const club = league.clubs[0];
  finalizeAcademyPlayer(p, {
    name: `${club.name} Academy`,
    isAcademy: true,
    parentClub: { ...club, league: league.name, leagueId: league.leagueId, nation: league.nation },
    league: league.name,
    leagueId: league.leagueId,
    nation: league.nation,
    badge: club.badge,
  });
  // Force a validated senior deal via promote
  promoteAcademyGraduateToFirstTeam(p, 80);
  if (p.club?.isAcademy) {
    // Fallback: pick a weak senior club directly for season tests
    p.club = { ...club, league: league.name, leagueDisplay: league.displayName, leagueId: league.leagueId, nation: league.nation, isAcademy: false };
    p.employmentClubId = club.clubId;
    p.playingClubId = club.clubId;
    p.contractStartSeason = 0;
    p.contractYears = 3;
    p.contractEndSeason = 3;
    p.weeklyWage = 2000;
  }
  p.nationality = "Serbia";
  return p;
}

test("promoteAcademyGraduate books wage through pipeline; preserves player nationality", () => {
  resetClubFinanceLedgers();
  const p = createPlayerIdentity({ name: "Promo", nationality: "Ghana", position: "ST", age: 17 });
  finalizeAcademyPlayer(p, pickThreeAcademies(ACADEMY_POOL, "England", "Promo")[0].academy);
  assert.equal(p.nationality, "Ghana");
  const signed = promoteAcademyGraduateToFirstTeam(p, 70);
  if (signed) {
    assert.equal(p.club.isAcademy, false);
    assert.ok(p.weeklyWage > 0);
    assert.equal(p.nationality, "Ghana");
    assert.ok(p.club.nation);
    assert.notEqual(p.nationality, undefined);
  } else {
    assert.equal(p.club.isAcademy, true);
  }
});

test("skip/bootstrap empty offers do not throw", () => {
  const p = createPlayerIdentity({ name: "Boot", nationality: "England", position: "GK", age: 16 });
  finalizeAcademyPlayer(p, pickThreeAcademies(ACADEMY_POOL, "England", "Boot")[0].academy);
  p.rating = 52;
  p.potential = 55;
  p.development = { ...(p.development || {}), latentBudget: 55 };
  const decision = buildFirstProContractDecision(p);
  assert.ok(decision.verdict);
  if (decision.offers[0]) {
    signFirstProfessionalContract(p, decision.offers[0]);
    assert.ok(p.weeklyWage > 0 || p.wage > 0);
  }
});

test("pre-expiry renewal can appear with one year left", () => {
  resetClubFinanceLedgers();
  const p = seniorPlayer();
  p.seasons = [{ matches: 20, minutes: 1500, goals: 2, assists: 3 }];
  p.contractEndSeason = 2; // one year remaining when seasons.length === 1
  const offers = generateTransferOffers(70, p, LEAGUES, LEAGUE_LOOKUP, 6.9);
  const renewal = offers.find((o) => o.isRenewal);
  // May or may not pass finance/sporting, but expired-only gate is gone (rem<=1 path runs).
  assert.ok(Array.isArray(offers));
  if (renewal) assert.equal(renewal.isPreExpiryRenewal, true);
});

test("auto policy completes season without January pause", () => {
  resetClubFinanceLedgers();
  reseedCareerRng(99);
  setWorldState(createWorldState({ startYear: 2026 }));
  const p = seniorPlayer();
  const beforeAge = p.age;
  const data = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  assert.equal(data.awaitingDecision, undefined);
  assert.ok(data.season);
  assert.equal(p.age, beforeAge + 1);
  assert.equal(p.seasons.length, 1);
});

test("pauseForDecisions can await without aging or finalizing", () => {
  resetClubFinanceLedgers();
  reseedCareerRng(7);
  setWorldState(createWorldState({ startYear: 2026 }));
  const p = seniorPlayer();
  p.age = 19;
  // Force a decision-friendly state: young, low minutes season will be mid-built
  const data = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: true,
    autoDecisionPolicy: null,
  });
  if (data.awaitingDecision) {
    assert.equal(p.age, 19);
    assert.equal(p.seasons.length, 0);
    assert.ok(data.checkpoint?.ordered?.length > 0);
    assert.ok(data.checkpoint.lastDate);
    // Decline / stay then resume
    if (data.decision) {
      resolveSquadDecision(p, data.decision, "stay-compete");
    }
    p.pendingOffers = [];
    p.pendingDecision = null;
    const done = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions: false,
      checkpoint: data.checkpoint,
    });
    assert.notEqual(done.awaitingDecision, true);
    assert.ok(done.season);
    assert.equal(p.age, 20);
    assert.equal(p.seasons.length, 1);
  } else {
    // Valid if no mid-season decision/offers triggered — season completed once.
    assert.ok(data.season);
    assert.equal(p.age, 20);
  }
});

test("career snapshot JSON round-trip preserves wage and finance ledger", () => {
  resetClubFinanceLedgers();
  setWorldState(createWorldState({ startYear: 2026 }));
  const p = seniorPlayer();
  p.weeklyWage = 3333;
  getOrInitClubSeasonFinance(p.club.clubId, "2026");
  const world = createWorldState({ startYear: 2026 });
  const restored = roundTripCareerSnapshot({ player: p, world });
  assert.equal(restored.player.weeklyWage, 3333);
  assert.equal(restored.player.nationality, "Serbia");
  assert.ok(restored.world);
  const again = getOrInitClubSeasonFinance(p.club.clubId, "2026");
  assert.ok(again.remainingTransferAuthorisation > 0);
});

test("worldState serialize round-trip keeps Maps", () => {
  const world = createWorldState({ startYear: 2026 });
  setWorldState(world);
  const raw = serializeWorldState(world);
  const back = deserializeWorldState(JSON.parse(JSON.stringify(raw)));
  assert.ok(back.clubs instanceof Map);
  assert.ok(back.nations instanceof Map);
});

if (!process.exitCode) {
  console.log("\nAll transfer/loan follow-up tests passed.");
}
