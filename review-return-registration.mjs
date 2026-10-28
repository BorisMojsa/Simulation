import assert from "node:assert/strict";
import { LEAGUES, LEAGUE_LOOKUP } from "./js/data/leagues.js";
import { buildMembershipBrowserFixture } from "./js/simulation/membershipBrowserFixture.js";
import { simulateSeason } from "./js/simulation/seasonSimulator.js";
import { resolvePlayingClubAt } from "./js/simulation/playingRegistration.js";

const fixture = buildMembershipBrowserFixture({ mode: "ui-loan-return-ready", seed: 42 });
assert.equal(fixture.ok, true, fixture.reason);
assert.equal(fixture.loan.loanStillActive, true);
assert.equal(fixture.loan.parentSnapshotLeagueId, "league:england-premier-league");
assert.equal(fixture.loan.parentWorldLeagueId, "league:england-championship");
const player = fixture.player;
const parentId = fixture.clubId;
const borrowerId = player.playingClubId;
const beforeSeasons = player.seasons.length;
const result = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
  pauseForDecisions: false,
  autoDecisionPolicy: "stay",
});
assert.ok(result.season, "the returned season must finish");
const parentFixtures = (result.leagueAllMatches || [])
  .filter((m) => [m.home?.clubId, m.away?.clubId].includes(parentId))
  .sort((a, b) => String(a.date).localeCompare(String(b.date)));
const first = parentFixtures[0];
assert.ok(first, "the returned parent must have real league fixtures");
console.log(
  JSON.stringify(
    {
      reviewedCommit: "bd11e80b0b006047152123b7a2ad61e9ee4dabaa",
      input: { mode: "ui-loan-return-ready", seed: 42 },
      parentId,
      borrowerId,
      seasonsBefore: beforeSeasons,
      seasonsAfter: player.seasons.length,
      loanStatus: player.activeLoan?.status,
      displayedClubId: player.club?.clubId,
      displayedLeagueId: player.club?.leagueId,
      returnStint: player.playingStints.find((s) => s.kind === "loan_return"),
      firstParentFixture: {
        date: first.date,
        home: first.home?.clubId,
        away: first.away?.clubId,
        expectedRegistration: parentId,
        actualRegistration: resolvePlayingClubAt(player, first.date),
      },
      parentFixtureCount: parentFixtures.length,
      parentFixturesWithWrongRegistration: parentFixtures.filter(
        (m) => resolvePlayingClubAt(player, m.date) !== parentId
      ).length,
      playerFixtureSides: [
        ...new Set(
          (result.leaguePlayerMatches || [])
            .filter((m) => m.playerSide)
            .map((m) => (m.playerSide === "home" ? m.home?.clubId : m.away?.clubId))
        ),
      ],
      positiveMinuteLeagueFixtures: (result.leaguePlayerMatches || []).filter(
        (m) => (m.playerStats?.minutes || 0) > 0
      ).length,
    },
    null,
    2
  )
);
