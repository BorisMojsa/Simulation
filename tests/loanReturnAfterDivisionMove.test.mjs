/**
 * R2 Item 2: loan return after parent promotion/relegation, including co-terminal renewal.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { LEAGUES, LEAGUE_LOOKUP } from "../js/data/leagues.js";
import { buildMembershipBrowserFixture } from "../js/simulation/membershipBrowserFixture.js";
import {
  openBoundaryContractReview,
  isContractActive,
  declineWindowAndContinue,
  releaseToFreeAgency,
  settleBoundaryContractReview,
} from "../js/simulation/contractLifecycle.js";
import { generatePipelineOffers, acceptPipelineOffer } from "../js/simulation/dealPipeline.js";
import { endLoan, resolveLoanReturnEffectiveDate } from "../js/simulation/loanMarket.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import { resolvePlayingClubAt } from "../js/simulation/playingRegistration.js";
import { resolveClubLeagueMetadata } from "../js/simulation/leagueMembership.js";
import { getWorldState } from "../js/simulation/worldState.js";
import {
  serializeCareerSnapshot,
  deserializeCareerSnapshot,
} from "../js/simulation/careerSnapshot.js";

const PARENT = "club:england:ipswich-town";
const CH = "league:england-championship";
const PL = "league:england-premier-league";

test("R2-02-A: ordinary return uses live Championship after parent relegation", () => {
  const fixture = buildMembershipBrowserFixture({ mode: "ui-loan-return-ready", seed: 42 });
  assert.equal(fixture.ok, true, fixture.reason);
  assert.equal(fixture.loan.parentSnapshotLeagueId, PL);
  assert.equal(fixture.loan.parentWorldLeagueId, CH);
  const player = fixture.player;
  const before = player.seasons.length;
  const result = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  assert.ok(result.season, "returned season finishes");
  assert.equal(player.seasons.length, before + 1);
  assert.equal(player.club?.clubId, PARENT);
  assert.equal(player.club?.leagueId, CH);
  assert.equal(player.activeLoan?.status, "returned");
  assert.equal(player.parentClubSnapshot, null);
  const returnStint = [...(player.playingStints || [])].reverse().find((s) =>
    String(s.kind || "").includes("loan_return")
  );
  assert.equal(returnStint?.playingClubId, PARENT);
  assert.equal(returnStint?.leagueId, CH);
  assert.equal(returnStint?.from, "2027-06-30");
  const parentFixtures = (result.leagueAllMatches || []).filter((m) =>
    [m.home?.clubId, m.away?.clubId].includes(PARENT)
  );
  assert.equal(parentFixtures.length, 46);
  assert.equal(
    parentFixtures.filter((m) => resolvePlayingClubAt(player, m.date) !== PARENT).length,
    0
  );
  assert.ok(
    (result.leaguePlayerMatches || []).some((m) => (m.playerStats?.minutes || 0) > 0),
    "positive parent minutes"
  );
});

test("R2-02-B: ordinary return uses live Premier League after parent promotion", () => {
  const fixture = buildMembershipBrowserFixture({ mode: "ui-loan-return-promoted-parent", seed: 42 });
  assert.equal(fixture.ok, true, fixture.reason);
  assert.equal(fixture.loan.parentSnapshotLeagueId, CH);
  assert.equal(fixture.loan.parentWorldLeagueId, PL);
  const player = fixture.player;
  const parentId = fixture.clubId;
  const before = player.seasons.length;
  const result = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  assert.ok(result.season, "returned season finishes");
  assert.equal(player.seasons.length, before + 1);
  assert.equal(player.club?.clubId, parentId);
  assert.equal(player.club?.leagueId, PL);
  assert.equal(player.activeLoan?.status, "returned");
  const returnStint = [...(player.playingStints || [])].reverse().find((s) =>
    String(s.kind || "").includes("loan_return")
  );
  assert.equal(returnStint?.leagueId, PL);
  const parentFixtures = (result.leagueAllMatches || []).filter((m) =>
    [m.home?.clubId, m.away?.clubId].includes(parentId)
  );
  assert.equal(parentFixtures.length, 38);
});

test("R2-02-C: co-terminal pending review projects current division and blocks until accept", () => {
  const fixture = buildMembershipBrowserFixture({ mode: "ui-loan-return-ready", seed: 42 });
  assert.equal(fixture.ok, true, fixture.reason);
  const player = fixture.player;
  player.contractEndSeason = player.seasons.length;
  openBoundaryContractReview(player, { performanceScore: 100, financeOk: true });
  assert.equal(player.pendingContractReview?.status, "pending");
  assert.equal(isContractActive(player), false);
  const gen = generatePipelineOffers(player, {
    performanceScore: 100,
    reviewPhase: "boundary",
    forceReevaluate: true,
    forceGenerate: true,
  });
  const renewal = gen.offers.find((o) => o.isRenewal);
  assert.ok(renewal, "renewal offer");
  player.pendingOffers = [renewal];
  player.pendingContractReview.offers = [renewal];

  const ended = endLoan(player, "return");
  assert.equal(ended.ok, true);
  assert.equal(ended.resolution, "return-pending-review");
  assert.equal(ended.effectiveDate, "2027-06-30");
  assert.equal(player.club?.leagueId, CH);
  assert.equal(resolveClubLeagueMetadata(PARENT, getWorldState())?.leagueId, CH);
  const stint = player.playingStints.at(-1);
  assert.equal(stint?.kind, "loan_return_pending_review");
  assert.equal(stint?.from, "2027-06-30");
  assert.equal(stint?.leagueId, CH);
  assert.equal(resolvePlayingClubAt(player, "2027-08-12"), PARENT);
  assert.equal(player.pendingContractReview?.status, "pending");

  const blocked = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  assert.equal(blocked.season, null);
  assert.equal(player.seasons.length, 1);
  assert.equal(player.pendingContractReview?.status, "pending");

  const accepted = acceptPipelineOffer(player, renewal);
  assert.equal(accepted.ok, true);
  const next = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  assert.ok(next.season, "season after renewal");
  assert.equal(player.club?.leagueId, CH);
  assert.equal(player.seasons.length, 2);
});

test("R2-02-C decline: release leaves no employed parent Championship season", () => {
  const fixture = buildMembershipBrowserFixture({ mode: "ui-loan-return-ready", seed: 42 });
  const player = fixture.player;
  player.contractEndSeason = player.seasons.length;
  openBoundaryContractReview(player, { performanceScore: 40, financeOk: true });
  endLoan(player, "return");
  assert.equal(player.pendingContractReview?.status, "pending");
  assert.equal(player.club?.leagueId, CH);
  const settled = settleBoundaryContractReview(player, { choice: "decline" });
  if (!settled?.ok) {
    declineWindowAndContinue(player);
    releaseToFreeAgency(player, "boundary-declined");
    if (player.pendingContractReview) {
      player.pendingContractReview.status = "settled";
      player.pendingContractReview.settledChoice = "declined";
    }
  }
  assert.notEqual(player.pendingContractReview?.status, "pending");
  const seasonsBefore = player.seasons.length;
  simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  const employedParentSeason = (player.seasons || [])
    .slice(seasonsBefore)
    .some((s) => s?.clubId === PARENT && s?.leagueId === CH && !s?.isFreeAgent);
  assert.equal(employedParentSeason, false);
});

test("R2-02-D: restore at pending return boundary does not double-settle", () => {
  const fixture = buildMembershipBrowserFixture({ mode: "ui-loan-return-ready", seed: 42 });
  const player = fixture.player;
  const world = getWorldState();
  player.contractEndSeason = player.seasons.length;
  openBoundaryContractReview(player, { performanceScore: 100, financeOk: true });
  const gen = generatePipelineOffers(player, {
    performanceScore: 100,
    reviewPhase: "boundary",
    forceReevaluate: true,
    forceGenerate: true,
  });
  const renewal = gen.offers.find((o) => o.isRenewal);
  player.pendingOffers = [renewal];
  player.pendingContractReview.offers = [renewal];
  endLoan(player, "return");
  const mid = serializeCareerSnapshot({ player, world });
  const again = endLoan(player, "return");
  assert.equal(again.duplicate, true);
  const returnStints = (player.playingStints || []).filter((s) =>
    String(s.kind || "").includes("loan_return")
  );
  assert.equal(returnStints.length, 1);
  const restored = deserializeCareerSnapshot(JSON.parse(JSON.stringify(mid)));
  assert.equal(restored.player.club?.leagueId, CH);
  assert.equal(restored.player.pendingContractReview?.status, "pending");
  const second = endLoan(restored.player, "return");
  assert.ok(second.duplicate || second.reason === "no-active-loan");
  const stints = (restored.player.playingStints || []).filter((s) =>
    String(s.kind || "").includes("loan_return")
  );
  assert.equal(stints.length, 1);
});

test("resolveLoanReturnEffectiveDate prefers explicit then loan endDate then completed boundary", () => {
  assert.equal(
    resolveLoanReturnEffectiveDate({ startYear: 2026, seasons: [{}] }, { endDate: "2027-06-30" }, {}),
    "2027-06-30"
  );
  assert.equal(
    resolveLoanReturnEffectiveDate({ startYear: 2026, seasons: [{}] }, {}, { effectiveDate: "2027-01-15" }),
    "2027-01-15"
  );
  assert.equal(
    resolveLoanReturnEffectiveDate({ startYear: 2026, seasons: [{}] }, {}, {}),
    "2027-06-30"
  );
});
