/**
 * Fix 02 — club ownership after permanent transfers, loans, and returns.
 * Run: node tests/clubOwnershipTransfers.test.mjs
 */
import assert from "node:assert/strict";
import { LEAGUES, LEAGUE_LOOKUP, LEAGUE_BY_ID } from "../js/data/leagues.js";
import { COMPETITION_FORMATS } from "../js/data/competitions/formats.js";
import { canAttachToContinentalFixture } from "../js/data/competitions/registrationPolicy.js";
import { createPlayerIdentity } from "../js/simulation/playerDevelopment.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import {
  simulateChronologicalSeason,
  resumeChronologicalSeason,
} from "../js/simulation/chronologicalSeason.js";
import { createWorldState, setWorldState } from "../js/simulation/worldState.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import { reseedCareerRng } from "../js/simulation/rng.js";
import { applyOfferToPlayer, acceptPipelineOffer, buildValidatedOffer } from "../js/simulation/dealPipeline.js";
import { resolveMoveRegistration } from "../js/simulation/destinationSchedule.js";
import { startLoan, endLoan } from "../js/simulation/loanMarket.js";
import { buildLiveLoanBrowserFixture } from "../js/simulation/liveLoanBrowserFixture.js";
import { allSeniorClubs } from "../js/simulation/seniorClubs.js";
import { roundTripCareerSnapshot } from "../js/simulation/careerSnapshot.js";
import {
  resolvePlayingClubAt,
  resolveValidatedClubSide,
  ensurePlayingStints,
  recordPlayingTransition,
} from "../js/simulation/playingRegistration.js";
import { evaluateSportingFit } from "../js/simulation/recruitmentModel.js";
import { applyRenewalTerms } from "../js/simulation/contractLifecycle.js";

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

function makeArsenalPlayer() {
  const league = LEAGUE_BY_ID.get("league:england-premier-league");
  const arsenal = league.clubs.find((c) => c.clubId === "club:england:arsenal");
  const p = createPlayerIdentity({
    name: "Bug 2 Ownership",
    nationality: "England",
    position: "CM",
    age: 19,
  });
  p.startYear = 2026;
  p.rating = 76;
  p.potential = 88;
  p.attributes = {
    Speed: 76,
    Passing: 78,
    Shooting: 72,
    Defending: 74,
    Physicality: 76,
    Dribbling: 77,
  };
  p.playerModelVersion = 2;
  p.state = { form: 0, morale: 0, readiness: 1, fatigue: 0, adaptationPenalty: 0, roleFit: 1 };
  p.health = { activeInjury: null, injuryHistory: [], durableDamage: {}, recoverableDamage: {} };
  p.development = { latentBudget: 90, modelVersion: 1, migration: {} };
  p.club = {
    ...arsenal,
    league: league.name,
    leagueDisplay: league.displayName,
    leagueId: league.leagueId,
    nation: league.nation,
    isAcademy: false,
    parentClub: null,
  };
  p.employmentClubId = arsenal.clubId;
  p.playingClubId = arsenal.clubId;
  p.contractStartSeason = 0;
  p.contractYears = 4;
  p.contractEndSeason = 4;
  p.weeklyWage = 4000;
  p.careerId = "bug2-ownership-audit-v1";
  p.seasons = [];
  ensurePlayingStints(p, { asOfDate: "2026-07-01" });
  return { player: p, league, arsenal };
}

function pauseToDecision(player) {
  let seasonData = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: true,
    autoDecisionPolicy: null,
  });
  let guards = 0;
  while (seasonData?.awaitingScenario && guards < 12) {
    guards += 1;
    player.pendingSeniorScenario = null;
    if (seasonData.checkpoint) seasonData.checkpoint.pendingSeniorScenario = null;
    player.seasonCheckpoint = seasonData.checkpoint;
    seasonData = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions: true,
      autoDecisionPolicy: null,
    });
  }
  assert.ok(
    seasonData?.awaitingDecision || seasonData?.status === "awaiting_decision",
    "must reach mid-season decision"
  );
  return seasonData;
}

function brentfordOffer(player, lastDate) {
  const brentford = allSeniorClubs().find((c) => c.clubId === "club:england:brentford");
  return {
    club: brentford.name,
    clubDisplay: brentford.displayName,
    clubId: brentford.clubId,
    league: brentford.league,
    leagueDisplay: brentford.leagueDisplay,
    leagueId: brentford.leagueId,
    nation: brentford.nation,
    tier: brentford.tier,
    divisionLevel: brentford.divisionLevel,
    badge: brentford.badge,
    financialTier: brentford.financialTier,
    reputation: brentford.reputation,
    overall: brentford.overall,
    attack: brentford.attack,
    midfield: brentford.midfield,
    defence: brentford.defence,
    goalkeeper: brentford.goalkeeper,
    strengthTier: brentford.strengthTier,
    isLoan: false,
    isRenewal: false,
    wage: 6000,
    contractYears: 3,
    expectedRole: "starter",
    reviewDate: lastDate,
    effectiveDate: lastDate,
    registration: resolveMoveRegistration({
      destinationLeagueId: brentford.leagueId,
      departureDate: lastDate,
      originSeasonStartYear: 2026,
    }),
  };
}

function postMoveArsenalContinental(europe) {
  return (europe?.playerMatches || []).filter((m) => {
    if (String(m.date || "") <= "2027-01-10") return false;
    const home = m.home?.clubId || m.home?.name;
    const away = m.away?.clubId || m.away?.name;
    return home === "club:england:arsenal" || away === "club:england:arsenal";
  });
}

test("Arsenal to Brentford: no post-move Arsenal player continental/cup sides", () => {
  resetClubFinanceLedgers();
  reseedCareerRng(42);
  setWorldState(createWorldState({ startYear: 2026 }));
  const { player } = makeArsenalPlayer();
  const paused = pauseToDecision(player);
  const ck = paused.checkpoint || player.seasonCheckpoint;
  applyOfferToPlayer(player, brentfordOffer(player, ck.lastDate), "audit-controlled-transfer-1");
  player.pendingOffers = [];
  player.pendingDecision = null;
  assert.equal(player.playingClubId, "club:england:brentford");
  assert.equal(resolvePlayingClubAt(player, "2027-01-10"), "club:england:brentford");
  assert.equal(resolvePlayingClubAt(player, "2027-01-09"), "club:england:arsenal");

  const done = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: null,
  });
  const season = player.seasons[player.seasons.length - 1];
  const europe = done.europeanCampaign || season?.europeanCampaign;
  assert.equal(postMoveArsenalContinental(europe).length, 0, "no post-move Arsenal continental playerMatches");

  const arsenalCupAfter = (done.domesticCupResult?.playerMatches || season?.domesticCupResult?.playerMatches || []).filter(
    (m) =>
      String(m.date || "") > "2027-01-10" &&
      (m.home?.clubId === "club:england:arsenal" ||
        m.away?.clubId === "club:england:arsenal" ||
        m.playerSide)
  );
  for (const m of arsenalCupAfter) {
    const sideClub =
      m.playerSide === "home" ? m.home?.clubId : m.playerSide === "away" ? m.away?.clubId : null;
    assert.notEqual(sideClub, "club:england:arsenal", "cup player side must not be Arsenal after move");
  }

  // Former-club cup/continental win must not auto-credit without entitlement metadata.
  if (done.domesticCupResult?.winningClubId === "club:england:arsenal") {
    assert.ok(
      !player.careerHonors.domesticCups ||
        (season.trophies || []).every((t) => t.winningClubId !== "club:england:arsenal" || t.kind !== "cup"),
      "Arsenal FA Cup win after departure must not be unlabeled current-club honor"
    );
  }
  assert.ok(Array.isArray(player.playingStints) && player.playingStints.length >= 2);
});

test("accepted-offer permanent move asserts destination fixture ownership", () => {
  resetClubFinanceLedgers();
  reseedCareerRng(42);
  setWorldState(createWorldState({ startYear: 2026 }));
  const { player, league } = makeArsenalPlayer();
  player.careerId = "bug2-accepted-offer-v1";
  const paused = pauseToDecision(player);
  const ck = paused.checkpoint || player.seasonCheckpoint;
  const brentford = allSeniorClubs().find((c) => c.clubId === "club:england:brentford");
  const fit = evaluateSportingFit(player, brentford, { careerId: player.careerId, relaxedDevelopment: true });
  const built = buildValidatedOffer({
    player,
    club: brentford,
    fit: {
      ...fit,
      eligible: true,
      pathway: "senior",
      projection: { role: "starter", minutesShare: 0.7, minutesRange: [60, 90], gap: 0, benchmark: 74 },
    },
    dealType: "permanent",
    performanceScore: 72,
  });
  assert.equal(built.ok, true, String(built.reasons));
  const offer = built.offer;
  offer.reviewDate = ck.lastDate;
  offer.effectiveDate = ck.lastDate;
  offer.registration = resolveMoveRegistration({
    destinationLeagueId: brentford.leagueId,
    departureDate: ck.lastDate,
    originSeasonStartYear: 2026,
  });
  ck.playingClubIdAtPause = player.playingClubId;
  const accepted = acceptPipelineOffer(player, offer, { trustStoredTerms: true });
  assert.equal(accepted.ok, true, String(accepted.reasons));
  player.pendingOffers = [];
  player.pendingDecision = null;

  const done = resumeChronologicalSeason({
    player,
    league,
    seasonIndex: 0,
    checkpoint: ck,
  });
  assert.equal(done.status, "complete");
  assert.equal(player.playingClubId, brentford.clubId);
  const moveDate = ck.lastDate;
  const destOwned = (done.playerMatches || []).filter((m) => {
    if (String(m.date || "") < String(moveDate)) return false;
    const sideId =
      m.playerSide === "home" ? m.home?.clubId : m.playerSide === "away" ? m.away?.clubId : m.playerClubId;
    return sideId === brentford.clubId || m.playerClubId === brentford.clubId;
  });
  assert.ok(destOwned.length > 0, "destination fixtures must appear after accepted move");
  for (const m of destOwned) {
    if (!m.playerSide) continue;
    const sideId = m.playerSide === "home" ? m.home?.clubId : m.away?.clubId;
    assert.equal(sideId, brentford.clubId);
  }
  const europe = done.europeanCampaign;
  assert.equal(postMoveArsenalContinental(europe).length, 0);
});

test("cross-country accepted loan detaches parent continental player fixtures", () => {
  const fixture = buildLiveLoanBrowserFixture({ seed: 42 });
  assert.equal(fixture.ok, true, fixture.reason);
  const { player, offers } = fixture;
  const offer = offers[0];
  assert.equal(offer.clubId, "club:croatia:rudes");
  assert.equal(startLoan(player, offer).ok, true);
  assert.equal(player.playingClubId, "club:croatia:rudes");
  assert.equal(player.employmentClubId, "club:italy:atalanta");
  player.pendingOffers = [];
  player.pendingDecision = null;

  const done = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: null,
  });
  const season = player.seasons[player.seasons.length - 1];
  const europe = done.europeanCampaign || season?.europeanCampaign;
  const post = (europe?.playerMatches || []).filter((m) => {
    if (String(m.date || "") <= "2027-01-10") return false;
    return (
      m.home?.clubId === "club:italy:atalanta" || m.away?.clubId === "club:italy:atalanta"
    );
  });
  assert.equal(post.length, 0, "no post-loan Atalanta continental playerMatches");
  assert.equal(player.employmentClubId, "club:italy:atalanta");
});

test("loan return and parent renewal preserve borrower then restore parent", () => {
  resetClubFinanceLedgers();
  reseedCareerRng(7);
  setWorldState(createWorldState({ startYear: 2026 }));
  const league = LEAGUE_BY_ID.get("league:italy-serie-a");
  const parent = league.clubs[0];
  const borrower = league.clubs[1];
  const p = createPlayerIdentity({ name: "ReturnTest", nationality: "Italy", position: "CM", age: 20 });
  p.startYear = 2026;
  p.rating = 64;
  p.potential = 82;
  p.attributes = { Speed: 64, Passing: 66, Shooting: 60, Defending: 62, Physicality: 64, Dribbling: 65 };
  p.playerModelVersion = 2;
  p.state = { form: 0, morale: 0, readiness: 1, fatigue: 0, adaptationPenalty: 0, roleFit: 1 };
  p.health = { activeInjury: null, injuryHistory: [], durableDamage: {}, recoverableDamage: {} };
  p.development = { latentBudget: 84, modelVersion: 1, migration: {} };
  p.club = { ...parent, league: league.name, leagueId: league.leagueId, nation: league.nation, isAcademy: false };
  p.employmentClubId = parent.clubId;
  p.playingClubId = parent.clubId;
  p.contractStartSeason = 0;
  p.contractYears = 4;
  p.contractEndSeason = 4;
  p.weeklyWage = 4000;
  p.careerId = "ownership-return-1";
  p.seasons = [];
  ensurePlayingStints(p, { asOfDate: "2026-07-01" });

  const loanOffer = {
    clubId: borrower.clubId,
    club: borrower.name,
    clubDisplay: borrower.displayName,
    dealType: "loan",
    isLoan: true,
    wage: 3500,
    loanFee: 50_000,
    loanTerms: {
      loanId: `loan:test:return:${borrower.clubId}`,
      loanFee: 50_000,
      borrowerWageShare: 0.5,
      parentWageShare: 0.5,
      parentClubId: parent.clubId,
      borrowingClubId: borrower.clubId,
      startSeason: 0,
      endSeason: 1,
      startDate: "2027-01-10",
      endDate: "2027-06-30",
      status: "proposed",
      international: false,
    },
    effectiveDate: "2027-01-10",
    reviewDate: "2027-01-10",
    registration: resolveMoveRegistration({
      destinationLeagueId: league.leagueId,
      departureDate: "2027-01-10",
      originSeasonStartYear: 2026,
    }),
  };
  assert.equal(startLoan(p, loanOffer).ok, true);
  assert.equal(p.playingClubId, borrower.clubId);
  assert.equal(p.employmentClubId, parent.clubId);

  applyRenewalTerms(p, {
    clubId: parent.clubId,
    wage: 4200,
    contractYears: 3,
    isRenewal: true,
  });
  assert.equal(p.playingClubId, borrower.clubId, "renewal must keep borrower registration");
  assert.equal(p.employmentClubId, parent.clubId);

  assert.equal(endLoan(p, "return", { effectiveDate: "2027-06-30" }).ok, true);
  assert.equal(p.playingClubId, parent.clubId);
  assert.equal(resolvePlayingClubAt(p, "2027-06-29"), borrower.clubId);
  assert.equal(resolvePlayingClubAt(p, "2027-06-30"), parent.clubId);
});

test("delayed registration blocks destination side before effective date", () => {
  const player = {
    careerId: "delay-reg",
    playingClubId: "club:england:brentford",
    employmentClubId: "club:england:brentford",
    club: { clubId: "club:england:brentford", name: "Brentford", isAcademy: false },
    playingStints: [
      {
        stintId: "a",
        from: "2026-07-01",
        to: "2027-01-10",
        playingClubId: "club:england:arsenal",
        kind: "seed",
        onLoan: false,
      },
      {
        stintId: "b",
        from: "2027-02-01",
        to: null,
        playingClubId: "club:england:brentford",
        kind: "permanent",
        onLoan: false,
      },
    ],
    pendingRegistration: {
      clubId: "club:england:brentford",
      leagueId: "league:england-premier-league",
      effectiveDate: "2027-02-01",
    },
  };
  assert.equal(resolvePlayingClubAt(player, "2027-01-15"), null);
  assert.equal(
    resolveValidatedClubSide({
      player,
      home: { clubId: "club:england:brentford" },
      away: { clubId: "club:england:chelsea" },
      date: "2027-01-20",
      teamType: "club",
    }),
    null
  );
  assert.equal(
    resolveValidatedClubSide({
      player,
      home: { clubId: "club:england:brentford" },
      away: { clubId: "club:england:chelsea" },
      date: "2027-02-01",
      teamType: "club",
    }),
    "home"
  );
});

test("snapshot round-trip preserves playing stints", () => {
  resetClubFinanceLedgers();
  reseedCareerRng(3);
  setWorldState(createWorldState({ startYear: 2026 }));
  const { player } = makeArsenalPlayer();
  recordPlayingTransition(player, {
    effectiveDate: "2027-01-10",
    playingClubId: "club:england:brentford",
    employmentClubId: "club:england:brentford",
    leagueId: "league:england-premier-league",
    clubName: "Brentford",
    kind: "permanent",
  });
  player.playingClubId = "club:england:brentford";
  const rt = roundTripCareerSnapshot({ player, world: createWorldState({ startYear: 2026 }) });
  assert.ok(rt.player.playingStints?.length >= 2);
  assert.equal(resolvePlayingClubAt(rt.player, "2027-01-11"), "club:england:brentford");
});

test("continental format ownership policy covers all eight club formats", () => {
  const formats = Object.values(COMPETITION_FORMATS).filter((f) => f.kind === "club");
  assert.equal(formats.length, 8);
  for (const format of formats) {
    const edition = {
      format,
      playerClubId: "club:focus:a",
      field: [{ clubId: "club:focus:a" }, { clubId: "club:dest:b" }],
    };
    const focusFx = {
      homeClubId: "club:focus:a",
      awayClubId: "club:other:c",
      stageType: "league",
      stageId: "league",
      date: "2027-01-21",
    };
    assert.equal(
      canAttachToContinentalFixture({
        edition,
        playingClubId: "club:focus:a",
        fixture: focusFx,
      }).ok,
      true,
      format.competitionId
    );
    const destLp = {
      homeClubId: "club:dest:b",
      awayClubId: "club:other:c",
      stageType: "league",
      stageId: "league",
      date: "2027-01-21",
    };
    const destGate = canAttachToContinentalFixture({
      edition,
      playingClubId: "club:dest:b",
      fixture: destLp,
      registrationEffectiveDate: "2027-01-10",
    });
    if (format.confederation === "UEFA") {
      assert.equal(destGate.ok, false, `${format.competitionId} should block league-phase destination attach`);
    }
    const notInField = canAttachToContinentalFixture({
      edition: { ...edition, field: [{ clubId: "club:focus:a" }] },
      playingClubId: "club:dest:b",
      fixture: destLp,
    });
    assert.equal(notInField.ok, false);
    assert.equal(notInField.reason, "not-in-field");
  }
});

test("national team identity is unaffected by club side helper", () => {
  const player = {
    playingClubId: "club:england:brentford",
    club: { clubId: "club:england:brentford", name: "Brentford" },
    nationality: "England",
    playingStints: [
      { from: "2026-07-01", to: null, playingClubId: "club:england:brentford", kind: "seed" },
    ],
  };
  assert.equal(
    resolveValidatedClubSide({
      player,
      home: { nationId: "England" },
      away: { nationId: "France" },
      date: "2027-03-01",
      teamType: "national",
    }),
    null
  );
});
