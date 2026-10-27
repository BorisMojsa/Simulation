/**
 * National result integrity: one committed score across chronology, store, tables,
 * brackets; calendar order; official third-place allocations.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LEAGUES } from "../js/data/leagues.js";
import { createRng } from "../js/simulation/rng.js";
import { createWorldState, setWorldState } from "../js/simulation/worldState.js";
import {
  generateStartingAttributes,
  initializePlayerDevelopment,
} from "../js/simulation/playerDevelopmentModel.js";
import { simulateChronologicalSeason } from "../js/simulation/chronologicalSeason.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import { getMatch } from "../js/simulation/competitionStore.js";
import {
  prepareNationalEdition,
  processNationalFixture,
  advanceNationalStage,
  drainNationalEdition,
  buildNationalCampaignView,
  listNationalFixtures,
} from "../js/simulation/nationalTournament.js";
import {
  accountNationalTable,
  assertTableInvariants,
  rankEuroGroup,
} from "../js/simulation/nationalTable.js";
import { mergePendingEvents } from "../js/simulation/seasonCalendar.js";
import {
  allocateEuroThirds,
  allocateWorldCupThirds,
  allEuroThirdCombinations,
  allWorldCupThirdCombinations,
  EURO_R16_SKELETON,
  WC_R32_SKELETON,
} from "../js/data/competitions/nationalBrackets.js";

function redStarSetup(seed, year) {
  resetClubFinanceLedgers();
  const world = createWorldState({ seed, startYear: year });
  setWorldState(world);
  const league = LEAGUES.find((l) => l.nation === "Serbia");
  const club = league.clubs.find((c) => /Red Star/.test(c.name));
  const rng = createRng(42);
  const player = {
    name: "International audit",
    nationality: "Serbia",
    position: "ST",
    age: 25,
    careerId: `intl-audit-${seed}`,
    startYear: year,
    rating: 85,
    attributes: generateStartingAttributes("ST", 85, 99, rng),
    club: { ...club, league: league.name, leagueId: league.leagueId, nation: league.nation },
    latestStanding: {
      leagueId: league.leagueId,
      playerRow: { position: 2, qualification: "Europa League", points: 60 },
    },
  };
  initializePlayerDevelopment(player, { rng, careerId: player.careerId });
  return { world, league, club, player };
}

describe("pending calendar merge", () => {
  it("preserves processed prefix and merges new events by date", () => {
    const ordered = [
      { eventId: "a", date: "2027-01-01", sortKey: "2027-01-01:L:0" },
      { eventId: "b", date: "2027-02-01", sortKey: "2027-02-01:L:0" },
      { eventId: "c", date: "2027-04-01", sortKey: "2027-04-01:L:0" },
    ];
    const merged = mergePendingEvents(ordered, 0, [
      { eventId: "ko", date: "2027-03-05", sortKey: "2027-03-05:E:fx:1" },
    ]);
    assert.equal(merged[0].eventId, "a");
    assert.deepEqual(
      merged.slice(1).map((e) => e.eventId),
      ["b", "ko", "c"]
    );
  });
});

describe("official third-place allocations", () => {
  it("covers all 15 EURO Article 21 combinations without same-group WB pairing", () => {
    const keys = allEuroThirdCombinations();
    assert.equal(keys.length, 15);
    assert.equal(new Set(keys).size, 15);
    for (const key of keys) {
      const alloc = allocateEuroThirds([...key]);
      const assigned = [alloc.WB, alloc.WC, alloc.WE, alloc.WF];
      assert.equal(new Set(assigned).size, 4);
      // WB faces third from alloc.WB — must not be group B
      assert.notEqual(alloc.WB, "B");
      assert.notEqual(alloc.WC, "C");
      assert.notEqual(alloc.WE, "E");
      assert.notEqual(alloc.WF, "F");
    }
  });

  it("covers all 495 FIFA Annex C combinations", () => {
    const keys = allWorldCupThirdCombinations();
    assert.equal(keys.length, 495);
    assert.equal(new Set(keys).size, 495);
    const sample = allocateWorldCupThirds([..."BDEFIJKL"]);
    assert.ok(sample.assignment.A);
    assert.equal(Object.keys(sample.assignment).length, 8);
  });

  it("EURO/WC first knockout skeletons do not pair group winner with own runner-up", () => {
    for (const def of EURO_R16_SKELETON) {
      if (def.home.type === "winner" && def.away.type === "runner") {
        assert.notEqual(def.home.group, def.away.group);
      }
    }
    for (const def of WC_R32_SKELETON) {
      if (def.home.type === "winner" && def.away.type === "runner") {
        assert.notEqual(def.home.group, def.away.group);
      }
    }
  });
});

describe("N01 controlled Italy 1-2 Serbia group", () => {
  it("committed scores, table, and qualification agree", () => {
    const { world, player } = redStarSetup(7, 2028);
    const ed = prepareNationalEdition({
      tournament: {
        id: "euro",
        name: "UEFA European Championship",
        shortName: "EURO",
        confederation: "UEFA",
        fieldSize: 24,
        groupSize: 4,
        bestThirds: 4,
        editionYear: 2028,
        year: 2028,
      },
      player,
      calledUp: true,
      forceIncludeIfEligible: true,
      calendarYear: 2028,
      world,
    });

    // Rewrite group A to the screenshot nations.
    const group = ed.groups[0];
    const teams = ["Switzerland", "Iceland", "Italy", "Serbia"];
    group.participants = teams;
    // Remove old group fixtures for this group and rebuild six controlled matches.
    for (const id of Object.keys(ed.fixtures)) {
      if (ed.fixtures[id].groupId === group.groupId) {
        delete ed.fixtures[id];
        ed.scheduledFixtureIds = ed.scheduledFixtureIds.filter((x) => x !== id);
      }
    }
    const script = [
      ["Switzerland", "Iceland", 1, 0],
      ["Switzerland", "Italy", 2, 1],
      ["Switzerland", "Serbia", 1, 1],
      ["Iceland", "Italy", 0, 2],
      ["Iceland", "Serbia", 0, 3],
      ["Italy", "Serbia", 1, 2],
    ];
    script.forEach(([home, away, hg, ag], i) => {
      const matchId = `euro:2028:group:${group.groupId}:md${Math.floor(i / 2) + 1}:ctrl${i}`;
      const fixture = {
        matchId,
        fixtureId: matchId,
        competitionId: "euro",
        editionId: ed.editionId,
        stageId: "group",
        stageType: "group",
        groupId: group.groupId,
        matchday: Math.floor(i / 2) + 1,
        homeParticipantId: home,
        awayParticipantId: away,
        home: { name: home, displayName: home, isNation: true },
        away: { name: away, displayName: away, isNation: true },
        date: `2028-06-${12 + i}`,
        venue: "neutral",
        status: "scheduled",
      };
      ed.fixtures[matchId] = fixture;
      ed.scheduledFixtureIds.push(matchId);
      // Injected outcomes for every fixture (player and background) — not a second simulation.
      processNationalFixture(ed, matchId, {
        world,
        player,
        forcedResult: {
          ...fixture,
          homeGoals: hg,
          awayGoals: ag,
          matchHomeGoals: hg,
          matchAwayGoals: ag,
          status: "played",
          playerSide: home === "Serbia" ? "home" : away === "Serbia" ? "away" : null,
        },
      });
    });

    const played = listNationalFixtures(ed, { status: "played" }).filter(
      (f) => f.groupId === group.groupId
    );
    const { rows } = accountNationalTable(
      teams.map((n) => ({ name: n })),
      played,
      { groupId: group.groupId }
    );
    assertTableInvariants(rows, played);
    const ranked = rankEuroGroup(rows, played);
    assert.equal(ranked[0].name, "Serbia");
    assert.equal(ranked[0].points, 7);
    assert.equal(ranked[0].gd, 4);
    assert.equal(ranked[1].name, "Switzerland");
    assert.equal(ranked[1].points, 7);
    assert.equal(ranked[2].name, "Italy");
    assert.equal(ranked[2].points, 3);

    const italySerbia = played.find(
      (m) =>
        (m.homeParticipantId === "Italy" && m.awayParticipantId === "Serbia") ||
        (m.homeParticipantId === "Serbia" && m.awayParticipantId === "Italy")
    );
    const stored = getMatch(italySerbia.matchId, world);
    assert.equal(stored.homeGoals, italySerbia.homeGoals);
    assert.equal(stored.awayGoals, italySerbia.awayGoals);
  });
});

describe("chronological national integrity cohort", () => {
  for (const year of [2026, 2028]) {
    it(`${year}: zero score mismatches and monotonic ledger (100 seeds)`, () => {
      let called = 0;
      let compared = 0;
      let mismatch = 0;
      let backwards = 0;
      let noWinner = 0;
      let afterLoss = 0;
      for (let seed = 1; seed <= 100; seed++) {
        const { world, league, player } = redStarSetup(seed, year);
        const result = simulateChronologicalSeason({ player, league, seasonIndex: 0 });
        const rows = result.ledgerRecords || [];
        if (rows.some((r, i) => i > 0 && r.date < rows[i - 1].date)) backwards += 1;
        const intl = result.internationalSeason;
        if (!intl?.calledUp) continue;
        called += 1;
        const byId = new Map((intl.primary?.playerMatches || []).map((m) => [m.matchId, m]));
        for (const shown of intl.playerMatches || []) {
          compared += 1;
          const old = byId.get(shown.matchId);
          if (!old || old.homeGoals !== shown.homeGoals || old.awayGoals !== shown.awayGoals) {
            mismatch += 1;
          }
          const stored = getMatch(shown.matchId, world);
          if (
            stored &&
            (stored.homeGoals !== shown.homeGoals || stored.awayGoals !== shown.awayGoals)
          ) {
            mismatch += 1;
          }
        }
        const ko = (intl.playerMatches || []).filter((m) => m.stageType === "knockout");
        for (const m of ko) if (!m.winnerSide) noWinner += 1;
        for (let i = 0; i < ko.length - 1; i++) {
          const m = ko[i];
          const lost =
            (m.playerSide === "home" && m.winnerSide === "away") ||
            (m.playerSide === "away" && m.winnerSide === "home");
          if (lost && ko[i + 1].matchKey !== "third-place") afterLoss += 1;
        }
      }
      assert.ok(called > 80, `called=${called}`);
      assert.equal(mismatch, 0, `mismatches=${mismatch} compared=${compared}`);
      assert.equal(backwards, 0);
      assert.equal(noWinner, 0);
      assert.equal(afterLoss, 0);
    });
  }
});

describe("preparation has no match side effects", () => {
  it("prepareNationalEdition does not commit played matches or apply form", () => {
    const { world, player } = redStarSetup(3, 2028);
    const beforeForm = world.formAppliedFixtures?.size || 0;
    const beforeMatches = world.matches?.size || 0;
    const ed = prepareNationalEdition({
      tournament: {
        id: "euro",
        name: "EURO",
        confederation: "UEFA",
        fieldSize: 24,
        groupSize: 4,
        bestThirds: 4,
        editionYear: 2028,
        year: 2028,
      },
      player,
      calledUp: true,
      forceIncludeIfEligible: true,
      world,
    });
    assert.ok(ed);
    assert.ok(Object.keys(ed.fixtures).length >= 36);
    assert.equal(ed.status, "group");
    assert.equal(world.formAppliedFixtures?.size || 0, beforeForm);
    const played = [...(world.matches?.values() || [])].filter((m) => m.status === "played");
    assert.equal(played.length, 0);
    assert.ok((world.matches?.size || 0) >= beforeMatches);
  });
});
