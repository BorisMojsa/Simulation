import assert from "node:assert/strict";
import { buildLiveLoanBrowserFixture } from "../js/simulation/liveLoanBrowserFixture.js";
import { startLoan, endLoan } from "../js/simulation/loanMarket.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import { LEAGUES, LEAGUE_LOOKUP, LEAGUE_BY_ID } from "../js/data/leagues.js";
import { roundTripCareerSnapshot } from "../js/simulation/careerSnapshot.js";
import { getWorldState, setWorldState } from "../js/simulation/worldState.js";

function acceptAndResume(offerIndex = 0, { snapshot = false, sameLeague = false } = {}) {
  const fixture = buildLiveLoanBrowserFixture();
  assert.equal(fixture.ok, true);
  let player = fixture.player;
  const parentId = player.employmentClubId;
  const parentLeagueId = player.club.leagueId;
  let offer = fixture.offers[offerIndex];
  if (sameLeague) {
    // Isolate table ownership using affordable accepted terms; recruitment has
    // separate coverage and this low-rated fixture would not earn Serie A offers.
    const borrower = LEAGUE_BY_ID.get(parentLeagueId).clubs.at(-1);
    offer = { ...offer, club: borrower.name, clubId: borrower.clubId, leagueId: parentLeagueId,
      loanTerms: { ...offer.loanTerms, borrowingClubId: borrower.clubId,
        international: false, loanId: "same-league-standings-fixture" } };
  }
  assert.ok(offer, "fixture must provide a valid loan");
  const start = startLoan(player, offer);
  assert.equal(start.ok, true);
  player.pendingDecision = null;
  player.pendingOffers = [];
  const loanBefore = structuredClone(player.activeLoan);
  if (snapshot) {
    const restored = roundTripCareerSnapshot({ player, world: getWorldState() });
    player = restored.player;
    setWorldState(restored.world);
  }
  const result = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
    checkpoint: player.seasonCheckpoint, pauseForDecisions: true, autoDecisionPolicy: "stay",
  });
  assert.equal(result.awaitingDecision, undefined);
  assert.equal(player.employmentClubId, parentId);
  assert.deepEqual(player.activeLoan, loanBefore, "standings must not mutate the loan contract");
  assert.equal(result.standings.playerRecord?.clubId, offer.clubId);
  assert.equal(result.league.leagueId, offer.leagueId);
  const league = LEAGUE_BY_ID.get(offer.leagueId);
  assert.deepEqual(new Set(result.standings.table.map(r => r.clubId)), new Set(league.clubs.map(c => c.clubId)));
  assert.equal(result.season.standing.table.length, league.clubs.length);
  assert.equal(player.latestStanding.playerRow.clubId, offer.clubId);
  assert.deepEqual(player.latestStanding.table, getWorldState().standings.get(offer.leagueId));
  const afterMove = result.season.leagueMatches.filter(m => m.date >= player.destinationScheduleMeta.effectiveDate);
  assert.ok(afterMove.length > 0);
  assert.ok(afterMove.every(m => m.competitionId === offer.leagueId));
  assert.ok(afterMove.every(m => (m.playerSide === "home" ? m.home : m.away).clubId === offer.clubId));
  assert.ok(afterMove.every(m => m.matchday <= 2 * (league.clubs.length - 1)), "no 100000-based matchday labels");
  assert.equal(result.season.leagueMatchSegments.at(-1).clubId, offer.clubId);
  assert.equal(result.season.leagueMatchSegments[0].clubId, parentId, "retain historical pre-loan matches");
  assert.equal(player.seasons.length, 1);
  assert.equal(player.age, 20);
  return { player, result, offer, parentId };
}

const cases = [
  ["cross-country loan returns the borrower's complete league table", () => {
    const { result, offer, parentId } = acceptAndResume();
    assert.equal(offer.club, "PEC Zwolle");
    assert.ok(!result.standings.table.some(r => r.clubId === parentId));
    assert.ok(result.standings.table.every(r => r.played === 34));
    assert.equal(result.standings.table.reduce((s, r) => s + r.goalsFor, 0), result.standings.table.reduce((s, r) => s + r.goalsAgainst, 0));
  }],
  ["cross-division loan keeps parent employment and uses the new division", () => {
    const { offer } = acceptAndResume(1);
    assert.equal(offer.leagueId, "league:italy-serie-b");
  }],
  ["snapshot restore retains destination standings and historical segments", () => acceptAndResume(0, { snapshot: true })],
  ["same-league loan retains existing table and changes highlighted playing club", () => acceptAndResume(0, { sameLeague: true })],
  ["automatic loan acceptance switches both simulation league and season metadata", () => {
    const fixture = buildLiveLoanBrowserFixture();
    const player = fixture.player;
    // Start a fresh automated run using the same validated prospect.
    player.seasonCheckpoint = null; player.pendingDecision = null; player.pendingOffers = [];
    const result = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, { autoDecisionPolicy: "accept-first-loan" });
    assert.equal(player.activeLoan?.status, "active");
    assert.equal(result.league.leagueId, player.club.leagueId);
    assert.equal(result.season.league, player.club.league);
    assert.equal(result.standings.playerRecord.clubId, player.playingClubId);
    assert.equal(result.season.leagueMatchSegments.at(-1).clubId, player.playingClubId);
  }],
  ["loan return restores the parent league for the next season", () => {
    const { player, parentId } = acceptAndResume();
    const returned = endLoan(player, "return");
    assert.equal(returned.ok, true);
    assert.equal(player.playingClubId, parentId);
    const next = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, { autoDecisionPolicy: "stay" });
    assert.equal(next.league.leagueId, "league:italy-serie-a");
    assert.equal(next.standings.playerRecord.clubId, parentId);
    assert.equal(player.seasons.length, 2);
  }],
];
for (const [name, run] of cases) {
  try { run(); console.log(`OK ${name}`); }
  catch (error) { console.error(`FAIL ${name}`); console.error(error); process.exitCode = 1; }
}
