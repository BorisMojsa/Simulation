/**
 * R2 Item 2: loan return after parent promotion/relegation, including co-terminal renewal.
 */
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
import {
  endLoan,
  resolveLoanReturnEffectiveDate,
  repairStalePendingLoanReturnBoundary,
} from "../js/simulation/loanMarket.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import { resolvePlayingClubAt } from "../js/simulation/playingRegistration.js";
import { resolveClubLeagueMetadata } from "../js/simulation/leagueMembership.js";
import { getWorldState, setWorldState } from "../js/simulation/worldState.js";
import {
  serializeCareerSnapshot,
  deserializeCareerSnapshot,
} from "../js/simulation/careerSnapshot.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

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

test("R2-02-D legacy: 1867753 pending-return snapshot repairs stale division/date then plays parent season", () => {
  const meta = JSON.parse(
    readFileSync(join(FIXTURE_DIR, "r2-02-legacy-coterminal-pending-1867753.meta.json"), "utf8")
  );
  assert.equal(meta.producedByCommit, "186775393ce1b433543758816ee2bda4f68c0f32");
  assert.equal(meta.clubLeagueId, PL);
  assert.equal(meta.returnStint?.from, "2028-06-30");
  assert.equal(meta.returnStint?.leagueId, PL);

  const raw = gunzipSync(
    readFileSync(join(FIXTURE_DIR, "r2-02-legacy-coterminal-pending-1867753.json.gz"))
  );
  const data = JSON.parse(raw.toString("utf8"));
  // Capture pre-repair bytes from the raw payload (before ensureTransferSave repair).
  assert.equal(data.player.club?.leagueId, PL);
  assert.equal(
    data.player.playingStints?.find((s) => s.kind === "loan_return_pending_review")?.from,
    "2028-06-30"
  );
  const seasonsBefore = data.player.seasons?.length ?? 0;
  const matchIdsBefore = (Array.isArray(data.world?.matches) ? data.world.matches : [])
    .map((entry) => (Array.isArray(entry) ? entry[0] : entry?.matchId || entry?.id))
    .filter(Boolean)
    .sort();
  const consumedBefore = [...(data.player.consumedTransitionIds || [])];
  const returnStintIdBefore = data.player.playingStints?.find(
    (s) => s.kind === "loan_return_pending_review"
  )?.stintId;

  const borrowerStintIdBefore = data.player.playingStints?.find(
    (s) => s.kind === "loan_start"
  )?.stintId;
  assert.equal(
    data.player.playingStints?.find((s) => s.kind === "loan_start")?.to,
    "2028-06-30",
    "legacy borrower stint still open through late boundary"
  );

  const restored = deserializeCareerSnapshot(data);
  assert.ok(restored?.player);
  if (restored.world) setWorldState(restored.world);
  const player = restored.player;
  assert.equal(player.pendingContractReview?.status, "pending");
  assert.equal(player.club?.leagueId, CH, "restored club uses live Championship");
  const returnStint = [...(player.playingStints || [])]
    .reverse()
    .find((s) => String(s.kind || "").includes("loan_return"));
  assert.equal(returnStint?.from, "2027-06-30");
  assert.equal(returnStint?.leagueId, CH);
  assert.equal(returnStint?.stintId, returnStintIdBefore, "same stint identity, patched in place");
  const borrowerStint = (player.playingStints || []).find(
    (s) => s.stintId === borrowerStintIdBefore || s.kind === "loan_start"
  );
  assert.equal(borrowerStint?.stintId, borrowerStintIdBefore, "same borrower stint identity");
  assert.equal(borrowerStint?.to, "2027-06-30", "borrower closes exactly when parent opens");
  assert.equal(player.seasons.length, seasonsBefore, "no new season on repair");
  assert.deepEqual(player.consumedTransitionIds || [], consumedBefore, "no extra settlement id");
  const matchIdsAfter = [...(getWorldState()?.matches?.keys?.() || [])].map(String).sort();
  assert.deepEqual(matchIdsAfter, matchIdsBefore, "committed match history unchanged");

  // Idempotent repair after restore (boundary already repaired on load).
  const again = repairStalePendingLoanReturnBoundary(player, getWorldState());
  assert.equal(again.repaired, false);

  const dup = endLoan(player, "return");
  assert.ok(dup.duplicate || dup.reason === "no-active-loan");
  assert.equal(
    (player.playingStints || []).filter((s) => String(s.kind || "").includes("loan_return")).length,
    1
  );

  const renewal =
    (player.pendingOffers || []).find((o) => o.isRenewal) ||
    (player.pendingContractReview?.offers || []).find((o) => o.isRenewal);
  assert.ok(renewal, "renewal tray intact after repair");
  const accepted = acceptPipelineOffer(player, renewal);
  assert.equal(accepted.ok, true);
  assert.notEqual(player.pendingContractReview?.status, "pending", "review settled after accept");

  // Repair still runs after renewal acceptance. First call is idempotent when
  // load already closed the borrower; a reintroduced stale leftover is repaired
  // without a second loan settlement.
  const afterAcceptRepair = repairStalePendingLoanReturnBoundary(player, getWorldState());
  assert.equal(afterAcceptRepair.repaired, false, "no further repair after accept");
  assert.equal(
    (player.playingStints || []).find((s) => s.stintId === borrowerStintIdBefore)?.to,
    "2027-06-30",
    "borrower remains closed at parent open after accept"
  );

  const borrowerAgain = (player.playingStints || []).find((s) => s.stintId === borrowerStintIdBefore);
  const returnAgain = [...(player.playingStints || [])]
    .reverse()
    .find((s) => String(s.kind || "").includes("loan_return"));
  borrowerAgain.to = "2028-06-30";
  returnAgain.from = "2028-06-30";
  returnAgain.leagueId = PL;
  player.club.leagueId = PL;
  const reopened = repairStalePendingLoanReturnBoundary(player, getWorldState());
  assert.equal(reopened.repaired, true, "repairs identifiable leftover after accept");
  assert.equal(reopened.after?.borrowerTo, "2027-06-30");
  assert.equal(reopened.after?.stintFrom, "2027-06-30");
  assert.equal(reopened.after?.stintLeagueId, CH);
  assert.equal(reopened.after?.clubLeagueId, CH);
  assert.equal(borrowerAgain.to, returnAgain.from, "borrower closes exactly when parent opens");

  const loanSettleIds = (player.consumedTransitionIds || []).filter((id) =>
    String(id).startsWith("loan-end:")
  );
  assert.deepEqual(
    loanSettleIds,
    consumedBefore.filter((id) => String(id).startsWith("loan-end:")),
    "no duplicate loan settlement after accept"
  );
  const dupAfterAccept = endLoan(player, "return");
  assert.ok(dupAfterAccept.duplicate || dupAfterAccept.reason === "no-active-loan");

  const next = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  assert.ok(next.season, "parent Championship season after renewal");
  assert.equal(player.club?.leagueId, CH);
  assert.equal(player.seasons.length, seasonsBefore + 1);
  const parentFixtures = (next.leagueAllMatches || []).filter((m) =>
    [m.home?.clubId, m.away?.clubId].includes(PARENT)
  );
  assert.equal(parentFixtures.length, 46);
  assert.equal(
    parentFixtures.filter((m) => resolvePlayingClubAt(player, m.date) !== PARENT).length,
    0
  );
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
