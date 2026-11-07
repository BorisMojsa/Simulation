/**
 * Fix 12 — tournament presentation / win-total projection (F01–F18).
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
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import {
  prepareNationalEdition,
  drainNationalEdition,
  buildNationalCampaignView,
} from "../js/simulation/nationalTournament.js";
import {
  prepareContinentalEdition,
  processContinentalMatchday,
  buildContinentalCampaignView,
} from "../js/simulation/continentalTournament.js";
import { buildNationalPlaybackContext, buildContinentalPlaybackContext } from "../js/simulation/competitionPlayback.js";
import { COMPETITION_FORMATS } from "../js/data/competitions/formats.js";
import {
  collectRawPlayedFixtures,
  formatStageLabel,
  groupCompetitionFixturesForPlayback,
  oracleTallyFromFixtures,
  projectTournamentRecords,
  renderTournamentSummaryHtml,
  resolveOpeningPhaseLabel,
  resolvePlaybackStageMode,
  snapshotForImmutabilityCheck,
  tallyParticipantRecord,
} from "../js/ui/tournamentPresentation.js";

function serbiaPlayer(seed, year = 2026) {
  resetClubFinanceLedgers();
  const world = createWorldState({ seed, startYear: year });
  setWorldState(world);
  const league = LEAGUES.find((l) => l.nation === "Serbia");
  const club = league.clubs.find((c) => /Red Star/.test(c.name));
  const rng = createRng(12);
  const player = {
    name: "Fix12 Presentation",
    nationality: "Serbia",
    position: "ST",
    age: 25,
    careerId: `fix12-pres-${seed}`,
    startYear: year,
    rating: 85,
    attributes: generateStartingAttributes("ST", 85, 99, rng),
    club: { ...club, league: league.name, leagueId: league.leagueId, nation: league.nation },
    latestStanding: {
      leagueId: league.leagueId,
      playerRow: { position: 2, qualification: "Champions League", points: 70 },
    },
  };
  initializePlayerDevelopment(player, { rng, careerId: player.careerId });
  return { world, league, club, player };
}

function f01ChampionProcessor() {
  let groupGames = 0;
  return (req) => {
    const draw = req.stageType === "group" && ++groupGames === 3;
    const homeGoals = draw ? 1 : req.playerSide === "home" ? 2 : 0;
    const awayGoals = draw ? 1 : req.playerSide === "away" ? 2 : 0;
    return {
      match: {
        ...req,
        homeGoals,
        awayGoals,
        matchHomeGoals: homeGoals,
        matchAwayGoals: awayGoals,
        regulationHomeGoals: homeGoals,
        regulationAwayGoals: awayGoals,
        scoreline: `${homeGoals}-${awayGoals}`,
        winnerSide: draw ? null : req.playerSide,
        decidedBy: "regulation",
        events: [],
      },
    };
  };
}

function buildF01Campaign() {
  const { world, player } = serbiaPlayer(12001, 2026);
  const ed = prepareNationalEdition({
    tournament: {
      id: "world-cup",
      name: "FIFA World Cup",
      shortName: "World Cup",
      confederation: "FIFA",
      fieldSize: 48,
      groupSize: 4,
      bestThirds: 8,
      editionYear: 2026,
      year: 2026,
    },
    player,
    calledUp: true,
    forceIncludeIfEligible: true,
    calendarYear: 2026,
    world,
  });
  drainNationalEdition(ed, { player, world, matchProcessor: f01ChampionProcessor() });
  const view = buildNationalCampaignView(ed, { player, world });
  return { world, player, view, ed };
}

function rawMatch(partial) {
  return {
    status: "played",
    decidedBy: "regulation",
    events: [],
    ...partial,
    matchHomeGoals: partial.matchHomeGoals ?? partial.homeGoals,
    matchAwayGoals: partial.matchAwayGoals ?? partial.awayGoals,
  };
}

describe("F01 controlled 48-team World Cup champion", () => {
  it("group 3/2/1/0 and total 8/7/1/0 with retained fixture IDs", () => {
    const { view } = buildF01Campaign();
    assert.equal(view.result, "Winners");
    const proj = projectTournamentRecords({
      campaign: view,
      scope: { participantKind: "nation", participantId: "Serbia" },
    });
    assert.deepEqual(
      {
        p: proj.openingPhase.record.played,
        w: proj.openingPhase.record.wins,
        d: proj.openingPhase.record.draws,
        l: proj.openingPhase.record.losses,
      },
      { p: 3, w: 2, d: 1, l: 0 }
    );
    assert.deepEqual(
      {
        p: proj.tournament.record.played,
        w: proj.tournament.record.wins,
        d: proj.tournament.record.draws,
        l: proj.tournament.record.losses,
      },
      { p: 8, w: 7, d: 1, l: 0 }
    );
    assert.equal(proj.openingPhase.label, "Group stage");
    assert.equal(proj.tournamentFixtureIds.length, 8);
    const stages = (view.allRounds || []).map((r) => r.round);
    assert.ok(stages.includes("Round of 32"));
    assert.ok(stages.includes("Final"));
    const html = renderTournamentSummaryHtml(proj);
    assert.match(html, /Group-stage record: P3 · W2 · D1 · L0/);
    assert.match(html, /Total tournament record: P8 · W7 · D1 · L0/);
    assert.match(html, /Result: Winners/);
  });
});

describe("F02 scope separation", () => {
  it("group row stays P3 after KO; placement round is not a Serbia game", () => {
    const { view } = buildF01Campaign();
    const row = view.groups
      .flatMap((g) => g.table || [])
      .find((r) => r.name === "Serbia");
    assert.equal(row.played, 3);
    assert.equal(row.wins, 2);
    assert.equal(row.draws, 1);
    assert.equal(row.losses, 0);
    assert.equal(row.points, 7);
    const proj = projectTournamentRecords({
      campaign: view,
      scope: { participantKind: "nation", participantId: "Serbia" },
    });
    assert.equal(proj.tournament.record.played, 8);
    assert.equal(proj.bracketRoundCount, 6);
    assert.ok(!(proj.tournamentFixtureIds || []).some((id) => /third-place|placement/i.test(id)));
  });
});

describe("F03 UEFA phase plus two-leg tie", () => {
  it("phase stays P8 W4 D2 L2 Pts14; combined P10 W5 D2 L3; aggregate adds no game", () => {
    const { world, league, club, player } = serbiaPlayer(7, 2026);
    player.latestStanding.playerRow.qualification = "Champions League";
    const state = prepareContinentalEdition({
      standing: player.latestStanding.playerRow,
      league,
      player,
      seasonYear: 2026,
    });
    assert.ok(state);
    assert.equal(state.openingMatchdays.length, 8);
    const script = {
      1: { gf: 3, ga: 2 },
      2: { gf: 1, ga: 0 },
      3: { gf: 1, ga: 0 },
      4: { gf: 1, ga: 0 },
      5: { gf: 0, ga: 0 },
      6: { gf: 2, ga: 2 },
      7: { gf: 0, ga: 2 },
      8: { gf: 1, ga: 3 },
    };
    for (const md of state.openingMatchdays) {
      processContinentalMatchday(state, md, {
        player,
        matchProcessor: (req) => {
          const sc = script[md];
          const homeIsPlayer = req.playerSide === "home";
          const homeGoals = homeIsPlayer ? sc.gf : sc.ga;
          const awayGoals = homeIsPlayer ? sc.ga : sc.gf;
          return {
            match: {
              home: req.home,
              away: req.away,
              homeGoals,
              awayGoals,
              matchHomeGoals: homeGoals,
              matchAwayGoals: awayGoals,
              regulationHomeGoals: homeGoals,
              regulationAwayGoals: awayGoals,
              playerSide: req.playerSide,
              scoreline: `${homeGoals}-${awayGoals}`,
              events: [],
            },
          };
        },
      });
    }
    const view = buildContinentalCampaignView(state, { playerName: club.name, world });
    const row = view.leaguePhase.table.find((r) => r.clubId === club.clubId);
    assert.equal(row.played, 8);
    assert.equal(row.wins, 4);
    assert.equal(row.draws, 2);
    assert.equal(row.losses, 2);
    assert.equal(row.points, 14);

    const opp = { name: "Opp FC", displayName: "Opp FC", clubId: "opp-fc" };
    const focus = { name: club.name, displayName: club.displayName || club.name, clubId: club.clubId };
    const leg1 = rawMatch({
      matchId: "cl:2026:ko:leg1",
      competitionId: view.competitionId,
      editionId: view.editionId,
      home: focus,
      away: opp,
      homeParticipantId: club.clubId,
      awayParticipantId: "opp-fc",
      homeGoals: 2,
      awayGoals: 0,
      stageId: "R16",
      stageType: "knockout",
    });
    const leg2 = rawMatch({
      matchId: "cl:2026:ko:leg2",
      competitionId: view.competitionId,
      editionId: view.editionId,
      home: opp,
      away: focus,
      homeParticipantId: "opp-fc",
      awayParticipantId: club.clubId,
      homeGoals: 1,
      awayGoals: 0,
      stageId: "R16",
      stageType: "knockout",
    });
    const aggregate = {
      matchId: "cl:2026:ko:agg",
      isAggregate: true,
      status: "played",
      home: focus,
      away: opp,
      homeGoals: 2,
      awayGoals: 1,
      matchHomeGoals: 2,
      matchAwayGoals: 1,
      legs: [leg1, leg2],
      legIds: [leg1.matchId, leg2.matchId],
      stageId: "R16",
    };
    const campaign = {
      ...view,
      focusClubId: club.clubId,
      allRounds: [{ round: "Round of 16", stageId: "R16", matches: [aggregate] }],
      playerMatches: [...(view.playerMatches || []), leg1, leg2, aggregate],
    };
    const proj = projectTournamentRecords({
      campaign,
      scope: { participantKind: "club", participantId: club.clubId, participantLabel: club.name },
    });
    assert.deepEqual(
      {
        p: proj.openingPhase.record.played,
        w: proj.openingPhase.record.wins,
        d: proj.openingPhase.record.draws,
        l: proj.openingPhase.record.losses,
      },
      { p: 8, w: 4, d: 2, l: 2 }
    );
    assert.deepEqual(
      {
        p: proj.tournament.record.played,
        w: proj.tournament.record.wins,
        d: proj.tournament.record.draws,
        l: proj.tournament.record.losses,
      },
      { p: 10, w: 5, d: 2, l: 3 }
    );
    assert.equal(proj.openingPhase.label, "League phase");
  });
});

describe("F04 six-game and group formats", () => {
  it("Conference League format defines six opening opponents; group shape uses groups.groups", () => {
    const conf = COMPETITION_FORMATS["uefa-conference-league"];
    assert.equal(conf.leaguePhase.opponentsPerClub, 6);
    const constructed = {
      competition: "Copa Libertadores",
      competitionId: "copa-libertadores",
      editionId: "copa-libertadores:2026",
      focusClubId: "club-a",
      groups: {
        openingLabel: "Group stage",
        groups: [
          {
            name: "Group A",
            groupId: "A",
            matches: [
              rawMatch({
                matchId: "lib:g1",
                competitionId: "copa-libertadores",
                editionId: "copa-libertadores:2026",
                home: { clubId: "club-a", name: "A" },
                away: { clubId: "club-b", name: "B" },
                homeGoals: 1,
                awayGoals: 0,
                stageType: "group",
              }),
              rawMatch({
                matchId: "lib:g2",
                competitionId: "copa-libertadores",
                editionId: "copa-libertadores:2026",
                home: { clubId: "club-b", name: "B" },
                away: { clubId: "club-a", name: "A" },
                homeGoals: 2,
                awayGoals: 2,
                stageType: "group",
              }),
            ],
            table: [],
          },
        ],
        matches: [],
      },
      allRounds: [],
      result: "Group stage",
    };
    const proj = projectTournamentRecords({
      campaign: constructed,
      scope: { participantKind: "club", participantId: "club-a" },
    });
    assert.equal(proj.openingPhase.label, "Group stage");
    assert.equal(proj.openingPhase.record.played, 2);
    assert.equal(proj.openingPhase.record.wins, 1);
    assert.equal(proj.openingPhase.record.draws, 1);
  });
});

describe("F05 shootout winner and loser", () => {
  it("1-1 5-4 pens is a draw with separate shootout won/lost", () => {
    const match = rawMatch({
      matchId: "pens-1",
      home: { name: "Serbia" },
      away: { name: "Italy" },
      homeParticipantId: "Serbia",
      awayParticipantId: "Italy",
      homeGoals: 1,
      awayGoals: 1,
      penaltyHome: 5,
      penaltyAway: 4,
      winnerSide: "home",
      decidedBy: "penalties",
    });
    const home = tallyParticipantRecord([match], ["Serbia"]);
    const away = tallyParticipantRecord([match], ["Italy"]);
    assert.deepEqual(
      { p: home.record.played, w: home.record.wins, d: home.record.draws, l: home.record.losses, gf: home.record.gf, ga: home.record.ga, sw: home.record.shootoutsWon, sl: home.record.shootoutsLost },
      { p: 1, w: 0, d: 1, l: 0, gf: 1, ga: 1, sw: 1, sl: 0 }
    );
    assert.deepEqual(
      { p: away.record.played, w: away.record.wins, d: away.record.draws, l: away.record.losses, gf: away.record.gf, ga: away.record.ga, sw: away.record.shootoutsWon, sl: away.record.shootoutsLost },
      { p: 1, w: 0, d: 1, l: 0, gf: 1, ga: 1, sw: 0, sl: 1 }
    );
    const legacy = rawMatch({
      matchId: "pens-legacy",
      home: { name: "Serbia" },
      away: { name: "Italy" },
      homeGoals: 0,
      awayGoals: 0,
      homePenalties: 3,
      awayPenalties: 4,
      winnerSide: "away",
      decidedBy: "penalties",
    });
    const legacyAway = tallyParticipantRecord([legacy], ["Italy"]);
    assert.equal(legacyAway.record.shootoutsWon, 1);
  });
});

describe("F06 extra time", () => {
  it("regulation 1-1 final 2-1 counts once as W1 GF2 GA1", () => {
    const match = rawMatch({
      matchId: "et-1",
      home: { name: "Serbia" },
      away: { name: "Spain" },
      homeGoals: 2,
      awayGoals: 1,
      matchHomeGoals: 2,
      matchAwayGoals: 1,
      regulationHomeGoals: 1,
      regulationAwayGoals: 1,
      decidedBy: "extraTime",
      winnerSide: "home",
    });
    const t = tallyParticipantRecord([match], ["Serbia"]);
    assert.deepEqual(
      { p: t.record.played, w: t.record.wins, gf: t.record.gf, ga: t.record.ga },
      { p: 1, w: 1, gf: 2, ga: 1 }
    );
  });
});

describe("F07 idempotent raw collection", () => {
  it("dedupes duplicates, expands aggregate legs, excludes bye/scheduled/aggregate parent", () => {
    const leg = rawMatch({
      matchId: "dup-1",
      home: { name: "Serbia" },
      away: { name: "Brazil" },
      homeGoals: 2,
      awayGoals: 0,
    });
    const agg = {
      matchId: "agg-1",
      isAggregate: true,
      status: "played",
      home: { name: "Serbia" },
      away: { name: "Brazil" },
      homeGoals: 3,
      awayGoals: 1,
      legs: [
        leg,
        rawMatch({
          matchId: "dup-2",
          home: { name: "Brazil" },
          away: { name: "Serbia" },
          homeGoals: 1,
          awayGoals: 1,
        }),
      ],
    };
    const bye = { matchId: "bye-1", isBye: true, status: "played", home: { name: "Serbia" }, away: { isBye: true }, homeGoals: 0, awayGoals: 0 };
    const scheduled = { matchId: "sched-1", status: "scheduled", home: { name: "Serbia" }, away: { name: "France" }, homeGoals: null, awayGoals: null };
    const collected = collectRawPlayedFixtures([leg, leg, agg, bye, scheduled, { ...leg }]);
    assert.equal(collected.fixtures.length, 2);
    const t = tallyParticipantRecord(collected.fixtures, ["Serbia"]);
    assert.equal(t.record.played, 2);
    assert.equal(t.record.played, t.record.wins + t.record.draws + t.record.losses);
  });
});

describe("F08 placement and elimination", () => {
  it("counts SF loss and third-place win; no phantom final championship", () => {
    const campaign = {
      name: "FIFA World Cup",
      year: 2026,
      competitionId: "world-cup",
      editionId: "world-cup:2026",
      playerNation: "Serbia",
      calledUp: true,
      result: "Semi-finals",
      won: false,
      groups: [
        {
          name: "Group A",
          participants: ["Serbia"],
          matches: [
            rawMatch({
              matchId: "g1",
              competitionId: "world-cup",
              editionId: "world-cup:2026",
              home: { name: "Serbia" },
              away: { name: "Qatar" },
              homeGoals: 1,
              awayGoals: 0,
              stageType: "group",
            }),
          ],
          table: [{ name: "Serbia", played: 1, wins: 1, draws: 0, losses: 0, points: 3 }],
        },
      ],
      allRounds: [
        {
          round: "Semi-finals",
          matches: [
            rawMatch({
              matchId: "sf",
              competitionId: "world-cup",
              editionId: "world-cup:2026",
              home: { name: "Serbia" },
              away: { name: "France" },
              homeGoals: 0,
              awayGoals: 1,
              stageId: "SF",
              stageType: "knockout",
            }),
          ],
        },
        {
          round: "Third-place match",
          matches: [
            rawMatch({
              matchId: "tp",
              competitionId: "world-cup",
              editionId: "world-cup:2026",
              home: { name: "Serbia" },
              away: { name: "England" },
              homeGoals: 2,
              awayGoals: 1,
              stageId: "placement",
              stageType: "placement",
            }),
          ],
        },
        {
          round: "Final",
          matches: [
            rawMatch({
              matchId: "final",
              competitionId: "world-cup",
              editionId: "world-cup:2026",
              home: { name: "Brazil" },
              away: { name: "France" },
              homeGoals: 1,
              awayGoals: 0,
              stageId: "Final",
              stageType: "knockout",
            }),
          ],
        },
      ],
    };
    const proj = projectTournamentRecords({
      campaign,
      scope: { participantKind: "nation", participantId: "Serbia" },
    });
    assert.equal(proj.tournament.record.played, 3);
    assert.equal(proj.tournament.record.wins, 2);
    assert.equal(proj.tournament.record.losses, 1);
    assert.equal(proj.resultLabel, "Semi-finals");
    assert.equal(formatStageLabel("placement"), "Third-place match");
    assert.notEqual(proj.resultLabel, "Winners");
  });
});

describe("F09 historical ownership", () => {
  it("keeps focusClubId counts after player club changes", () => {
    const campaign = {
      competition: "Champions League",
      competitionId: "uefa-champions-league",
      editionId: "ucl:2026",
      focusClubId: "historical-club",
      leaguePhase: {
        openingLabel: "League phase",
        matches: [
          rawMatch({
            matchId: "lp1",
            competitionId: "uefa-champions-league",
            editionId: "ucl:2026",
            home: { clubId: "historical-club", name: "Old Club" },
            away: { clubId: "x", name: "X" },
            homeGoals: 2,
            awayGoals: 0,
          }),
        ],
        table: [],
        frozen: true,
      },
      allRounds: [],
      field: [{ clubId: "historical-club", name: "Old Club", displayName: "Old Club" }],
      result: "League phase",
    };
    const proj = projectTournamentRecords({
      campaign,
      scope: {
        participantKind: "club",
        participantId: campaign.focusClubId,
        // Deliberately different from today's club
      },
    });
    assert.equal(proj.participantId, "historical-club");
    assert.equal(proj.tournament.record.played, 1);
    assert.equal(proj.tournament.record.wins, 1);
  });
});

describe("F10 participation and selection", () => {
  it("nation record available when not selected; team games count with zero minutes", () => {
    const campaign = {
      name: "FIFA World Cup",
      year: 2026,
      competitionId: "world-cup",
      editionId: "world-cup:2026",
      playerNation: "Serbia",
      calledUp: false,
      playerNationInTournament: true,
      result: "Not in squad",
      groups: [
        {
          name: "Group A",
          participants: ["Serbia"],
          matches: [
            rawMatch({
              matchId: "ns1",
              competitionId: "world-cup",
              editionId: "world-cup:2026",
              home: { name: "Serbia" },
              away: { name: "USA" },
              homeGoals: 1,
              awayGoals: 0,
              stageType: "group",
              playerMinutes: 0,
            }),
          ],
          table: [],
        },
      ],
      allRounds: [],
    };
    const proj = projectTournamentRecords({
      campaign,
      scope: { participantKind: "nation", participantId: "Serbia" },
    });
    assert.equal(proj.resultLabel, "Not in squad");
    assert.match(proj.selectionLabel || "", /not selected/i);
    assert.equal(proj.tournament.record.played, 1);
  });
});

describe("F11 edition isolation and identity", () => {
  it("same participant across editions stays separate; distinct club IDs do not merge", () => {
    const m2026 = rawMatch({
      matchId: "e2026",
      competitionId: "world-cup",
      editionId: "world-cup:2026",
      home: { name: "Serbia" },
      away: { name: "Brazil" },
      homeGoals: 1,
      awayGoals: 0,
    });
    const m2030 = rawMatch({
      matchId: "e2030",
      competitionId: "world-cup",
      editionId: "world-cup:2030",
      home: { name: "Serbia" },
      away: { name: "Brazil" },
      homeGoals: 0,
      awayGoals: 2,
    });
    const a = collectRawPlayedFixtures([m2026, m2030], { editionId: "world-cup:2026" });
    assert.equal(a.fixtures.length, 1);
    const sameName = {
      competition: "UCL",
      competitionId: "ucl",
      editionId: "ucl:1",
      focusClubId: "club-1",
      leaguePhase: {
        openingLabel: "League phase",
        frozen: true,
        matches: [
          rawMatch({
            matchId: "c1",
            competitionId: "ucl",
            editionId: "ucl:1",
            home: { clubId: "club-1", name: "United" },
            away: { clubId: "x", name: "X" },
            homeGoals: 1,
            awayGoals: 0,
          }),
          rawMatch({
            matchId: "c2",
            competitionId: "ucl",
            editionId: "ucl:1",
            home: { clubId: "club-2", name: "United" },
            away: { clubId: "y", name: "Y" },
            homeGoals: 3,
            awayGoals: 0,
          }),
        ],
      },
      allRounds: [],
      field: [
        { clubId: "club-1", name: "United", displayName: "United" },
        { clubId: "club-2", name: "United", displayName: "United" },
      ],
    };
    const proj = projectTournamentRecords({
      campaign: sameName,
      scope: { participantKind: "club", participantId: "club-1", participantLabel: "United" },
    });
    assert.equal(proj.tournament.record.played, 1);
    assert.equal(proj.tournament.record.wins, 1);
    assert.equal(proj.tournament.record.gf, 1);
    const html = renderTournamentSummaryHtml(proj);
    assert.match(html, /P1 · W1/);
  });
});

describe("F12 empty versus unavailable", () => {
  it("distinguishes zero, no entry, unavailable, and partial", () => {
    const zero = projectTournamentRecords({
      campaign: {
        name: "EURO",
        competitionId: "euro",
        editionId: "euro:2028",
        playerNation: "Serbia",
        calledUp: true,
        groups: [{ name: "Group A", participants: ["Serbia"], matches: [], table: [] }],
        allRounds: [],
        result: "In progress",
      },
      scope: { participantKind: "nation", participantId: "Serbia" },
      live: true,
    });
    assert.equal(zero.tournament.completeness, "empty");
    assert.equal(zero.tournament.record.played, 0);

    const none = projectTournamentRecords({
      campaign: { competition: "UCL", showcase: true, qualified: false, result: "Not entered" },
      scope: { participantKind: "club", participantId: "x" },
    });
    assert.equal(none.tournament.completeness, "none");

    const missing = projectTournamentRecords({
      campaign: null,
      scope: { participantKind: "nation", participantId: "Serbia" },
    });
    assert.equal(missing.tournament.completeness, "unavailable");

    const partial = projectTournamentRecords({
      campaign: {
        competition: "UCL",
        competitionId: "ucl",
        editionId: "ucl:1",
        focusClubId: "c1",
        leaguePhase: { matches: [], openingLabel: "League phase", frozen: true },
        allRounds: [
          {
            round: "R16",
            matches: [
              {
                matchId: "agg",
                isAggregate: true,
                status: "played",
                home: { clubId: "c1", name: "C1" },
                away: { clubId: "c2", name: "C2" },
                homeGoals: 3,
                awayGoals: 2,
                legIds: ["leg-a", "leg-b"],
                legs: [
                  rawMatch({
                    matchId: "leg-a",
                    competitionId: "ucl",
                    editionId: "ucl:1",
                    home: { clubId: "c1", name: "C1" },
                    away: { clubId: "c2", name: "C2" },
                    homeGoals: 2,
                    awayGoals: 0,
                  }),
                ],
              },
            ],
          },
        ],
      },
      scope: { participantKind: "club", participantId: "c1" },
    });
    assert.equal(partial.tournament.completeness, "partial");

    const tableOnly = projectTournamentRecords({
      campaign: {
        competition: "UCL",
        competitionId: "ucl",
        editionId: "ucl:legacy",
        focusClubId: "c1",
        leaguePhase: {
          openingLabel: "League phase",
          frozen: true,
          matches: [],
          table: [
            {
              clubId: "c1",
              name: "C1",
              played: 8,
              wins: 4,
              draws: 2,
              losses: 2,
              points: 14,
              goalsFor: 9,
              goalsAgainst: 9,
            },
          ],
        },
        allRounds: [],
      },
      scope: { participantKind: "club", participantId: "c1" },
    });
    assert.equal(tableOnly.openingPhase.record.played, 8);
    assert.equal(tableOnly.openingPhase.record.wins, 4);
    assert.equal(tableOnly.tournament.record, null);
    assert.equal(tableOnly.tournament.completeness, "partial");

    const anonLive = projectTournamentRecords({
      campaign: {
        name: "EURO",
        competitionId: "euro",
        editionId: "euro:1",
        playerNation: "Serbia",
        calledUp: true,
        groups: [
          {
            name: "G",
            participants: ["Serbia"],
            matches: [
              rawMatch({
                // no matchId — anonymous
                home: { name: "Serbia" },
                away: { name: "Italy" },
                homeGoals: 1,
                awayGoals: 0,
                stageType: "group",
              }),
            ],
            table: [],
          },
        ],
        allRounds: [],
      },
      scope: { participantKind: "nation", participantId: "Serbia" },
      visibleFixtureIds: [],
      live: true,
    });
    assert.equal(anonLive.tournament.record.played, 0);

    const outside = projectTournamentRecords({
      campaign: {
        name: "FIFA World Cup",
        competitionId: "world-cup",
        editionId: "world-cup:2026",
        playerNation: "Canada",
        playerNationInTournament: false,
        field: ["Serbia", "Brazil"],
        calledUp: false,
        groups: [],
        allRounds: [],
      },
      scope: { participantKind: "nation", participantId: "Canada" },
    });
    assert.equal(outside.tournament.completeness, "none");
  });
});

describe("F13 JSON round-trip", () => {
  it("serialize/restore national and continental views keep records", () => {
    const { view } = buildF01Campaign();
    const restored = JSON.parse(JSON.stringify(view));
    const a = projectTournamentRecords({
      campaign: view,
      scope: { participantKind: "nation", participantId: "Serbia" },
    });
    const b = projectTournamentRecords({
      campaign: restored,
      scope: { participantKind: "nation", participantId: "Serbia" },
    });
    assert.deepEqual(a.tournament.record, b.tournament.record);
    assert.equal(a.openingPhase.label, b.openingPhase.label);

    const continental = {
      competition: "UCL",
      competitionId: "ucl",
      editionId: "ucl:1",
      focusClubId: "c1",
      leaguePhase: {
        openingLabel: "League phase",
        frozen: true,
        // intentionally no complete flag
        matches: [
          rawMatch({
            matchId: "lp",
            competitionId: "ucl",
            editionId: "ucl:1",
            home: { clubId: "c1", name: "C1" },
            away: { clubId: "c2", name: "C2" },
            homeGoals: 1,
            awayGoals: 0,
          }),
        ],
      },
      allRounds: [],
    };
    const frozen = JSON.parse(JSON.stringify(continental));
    const ctx = buildContinentalPlaybackContext({ campaign: frozen, visibleFixtureIds: [] });
    assert.equal(ctx.stageMode, "table");
    assert.equal(resolveOpeningPhaseLabel(frozen), "League phase");
  });
});

describe("F14 shared labels", () => {
  it("maps stage IDs consistently and preserves Round One / knockout-only", () => {
    assert.equal(formatStageLabel("league"), "League phase");
    assert.equal(formatStageLabel("groups"), "Group stage");
    assert.equal(formatStageLabel("R32"), "Round of 32");
    assert.equal(formatStageLabel("R16"), "Round of 16");
    assert.equal(formatStageLabel("QF"), "Quarter-finals");
    assert.equal(formatStageLabel("SF"), "Semi-finals");
    assert.equal(formatStageLabel("Final"), "Final");
    assert.equal(formatStageLabel("placement"), "Third-place match");
    assert.equal(formatStageLabel("R1"), "Round One");
    assert.equal(formatStageLabel("playoff"), "Knockout playoffs");
    const { view } = buildF01Campaign();
    assert.equal(resolveOpeningPhaseLabel(view), "Group stage");
    assert.equal(
      resolveOpeningPhaseLabel({ openingPhase: "knockout", allRounds: [{ round: "Final", matches: [] }] }),
      "Knockout"
    );
  });
});

describe("F15 reveal boundaries", () => {
  it("records follow visible IDs; national panel starts as table then transitions", () => {
    const { view, player } = buildF01Campaign();
    const groupIds = (view.groups || [])
      .flatMap((g) => g.matches || [])
      .filter((m) => (m.home?.name || m.homeParticipantId) === "Serbia" || (m.away?.name || m.awayParticipantId) === "Serbia")
      .map((m) => m.matchId);
    const koIds = (view.allRounds || [])
      .flatMap((r) => r.matches || [])
      .filter((m) => (m.home?.name || m.homeParticipantId) === "Serbia" || (m.away?.name || m.awayParticipantId) === "Serbia")
      .map((m) => m.matchId);

    const empty = projectTournamentRecords({
      campaign: view,
      scope: { participantKind: "nation", participantId: "Serbia" },
      visibleFixtureIds: [],
      live: true,
    });
    assert.equal(empty.tournament.record.played, 0);

    const mid = projectTournamentRecords({
      campaign: view,
      scope: { participantKind: "nation", participantId: "Serbia" },
      visibleFixtureIds: groupIds.slice(0, 2),
      live: true,
    });
    assert.equal(mid.tournament.record.played, 2);

    const ctx0 = buildNationalPlaybackContext({ tournament: view, player, visibleFixtureIds: [] });
    assert.equal(ctx0.stageMode, "table");
    const ctxKo = buildNationalPlaybackContext({
      tournament: view,
      player,
      visibleFixtureIds: [...groupIds, koIds[0]],
    });
    assert.equal(ctxKo.stageMode, "bracket");
    assert.equal(resolvePlaybackStageMode({ campaign: view, visibleFixtureIds: groupIds, participantType: "nation" }), "table");
  });
});

describe("F16 read-only rendering", () => {
  it("selectors do not mutate campaign arrays or RNG/world fingerprints", () => {
    const { view, world } = buildF01Campaign();
    const before = snapshotForImmutabilityCheck(view);
    const rngBefore = world.rngState || world.seed;
    const matchCount = world.matches?.size ?? 0;
    for (let i = 0; i < 3; i++) {
      projectTournamentRecords({
        campaign: view,
        scope: { participantKind: "nation", participantId: "Serbia" },
      });
      resolveOpeningPhaseLabel(view);
      buildNationalPlaybackContext({ tournament: view, player: { nationality: "Serbia" }, visibleFixtureIds: [] });
    }
    assert.deepEqual(snapshotForImmutabilityCheck(view), before);
    assert.equal(world.rngState || world.seed, rngBefore);
    assert.equal(world.matches?.size ?? 0, matchCount);
  });
});

describe("F17 contradictory duplicate", () => {
  it("surfaces integrity diagnostic and refuses exact total", () => {
    const a = rawMatch({
      matchId: "same",
      home: { name: "Serbia" },
      away: { name: "Italy" },
      homeGoals: 2,
      awayGoals: 0,
    });
    const b = rawMatch({
      matchId: "same",
      home: { name: "Serbia" },
      away: { name: "Italy" },
      homeGoals: 0,
      awayGoals: 1,
    });
    const collected = collectRawPlayedFixtures([a, b]);
    assert.ok(collected.diagnostics.some((d) => d.code === "contradictory_duplicate"));
    const proj = projectTournamentRecords({
      campaign: {
        name: "EURO",
        competitionId: "euro",
        editionId: "euro:1",
        playerNation: "Serbia",
        groups: [{ name: "G", matches: [a, b], participants: ["Serbia"], table: [] }],
        allRounds: [],
      },
      scope: { participantKind: "nation", participantId: "Serbia" },
    });
    assert.equal(proj.tournament.completeness, "contradiction");
    assert.equal(proj.tournament.record, null);
  });
});

describe("F18 independent oracle / negative control", () => {
  it("oracle matches helper; wrong totals and aggregate counting are detected", () => {
    const { view } = buildF01Campaign();
    const nationFx = Object.values(view.fixtures || {}).filter((m) => {
      if (m.status !== "played") return false;
      const h = m.home?.name || m.homeParticipantId;
      const a = m.away?.name || m.awayParticipantId;
      return h === "Serbia" || a === "Serbia";
    });
    const oracle = oracleTallyFromFixtures(nationFx, ["Serbia"]);
    const proj = projectTournamentRecords({
      campaign: view,
      scope: { participantKind: "nation", participantId: "Serbia" },
    });
    assert.deepEqual(oracle.record, proj.tournament.record);

    const wrong = { ...proj.tournament.record, wins: 8 };
    assert.notEqual(wrong.wins, oracle.record.wins);

    const agg = {
      matchId: "agg-neg",
      isAggregate: true,
      status: "played",
      home: { name: "Serbia" },
      away: { name: "Spain" },
      homeGoals: 3,
      awayGoals: 1,
      legs: nationFx.slice(0, 2),
    };
    const poisoned = oracleTallyFromFixtures([...nationFx, agg], ["Serbia"]);
    assert.equal(poisoned.record.played, oracle.record.played);
  });
});

describe("R1 chronological national batches", () => {
  it("group fixtures precede KO; first player batch is group; final stays hidden until revealed", () => {
    const { view } = buildF01Campaign();
    const fixtures = [
      ...(view.groups || []).flatMap((g) => g.matches || []),
      ...(view.allRounds || []).flatMap((r) => r.matches || []),
    ].map((m) => {
      const h = m.home?.name || m.homeParticipantId;
      const a = m.away?.name || m.awayParticipantId;
      return {
        ...m,
        playerSide: h === "Serbia" ? "home" : a === "Serbia" ? "away" : null,
      };
    });
    const batches = groupCompetitionFixturesForPlayback(fixtures);
    assert.ok(batches[0].stageRank === 0, "opening batch first");
    const firstPlayer = batches.find((b) => b.playerMatches.length);
    assert.equal(firstPlayer.playerMatches[0].stageType, "group");
    assert.ok(!firstPlayer.playerMatches.some((m) => m.stageType === "knockout"));

    const visible = new Set(firstPlayer.matches.map((m) => m.matchId));
    const ctx = buildNationalPlaybackContext({
      tournament: view,
      player: { nationality: "Serbia" },
      visibleFixtureIds: [...visible],
    });
    assert.equal(ctx.stageMode, "table");
    const p = projectTournamentRecords({
      campaign: view,
      scope: { participantKind: "nation", participantId: "Serbia" },
      visibleFixtureIds: visible,
      live: true,
    });
    assert.equal(p.openingPhase.record.played, 1);
    assert.equal(p.tournament.record.wins, 1);
    const bracket = ctx.getBracketView(visible);
    const final = bracket.rounds.find((r) => /Final/i.test(r.round))?.matches?.[0];
    assert.equal(final.spoilerHidden, true);
    assert.equal(final.homeGoals, null);
  });
});
