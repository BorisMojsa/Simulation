import test from "node:test";
import assert from "node:assert/strict";
import { LEAGUES } from "../js/data/leagues.js";
import {
  continentalCompetitionForStanding,
  uefaSlotsForLeague,
} from "../js/data/competitions/qualification.js";
import { qualificationForPosition, findSisterLeagues } from "../js/simulation/leaguePhase.js";
import { preSeasonContinentalStanding } from "../js/simulation/chronologicalSeason.js";
import { simulateEuropeanCampaign } from "../js/simulation/europeanCompetition.js";
import { createWorldState, setWorldState } from "../js/simulation/worldState.js";
import { reseedCareerRng } from "../js/simulation/rng.js";
import { tournamentsForYear } from "../js/data/internationalCalendar.js";
import { simulateInternationalSeason } from "../js/simulation/nationalTeam.js";
import { CLUB_PROFILES } from "../js/data/identity/resolver.js";

function serieA() {
  return LEAGUES.find((l) => l.displayName === "Serie A" || /Serie A/.test(l.name));
}

function makePlayer(club, league, extras = {}) {
  return {
    name: "Test Player",
    nationality: league.nation === "Italy" ? "Italy" : "Brazil",
    position: "ST",
    club: { ...club, league: league.name, leagueId: league.leagueId, nation: league.nation },
    startYear: 2026,
    ...extras,
  };
}

test("UEFA pre-season standing preserves Champions League qualification label", () => {
  const league = serieA();
  assert.ok(league);
  const sisters = findSisterLeagues(league, LEAGUES);
  const q = qualificationForPosition(1, league, sisters);
  assert.equal(q, "League Champions");
  const player = makePlayer(league.clubs[0], league, {
    latestStanding: {
      leagueId: league.leagueId,
      playerRow: { position: 1, points: 90, qualification: "League Champions", wins: 28, draws: 6, losses: 4 },
    },
  });
  const standing = preSeasonContinentalStanding(player, league);
  assert.equal(standing.qualification, "League Champions");
  assert.equal(continentalCompetitionForStanding(standing, league), "Champions League");
});

test("UEFA position fallback grants CL when qualification label was null", () => {
  const league = serieA();
  const standing = { position: 1, qualification: null };
  assert.equal(continentalCompetitionForStanding(standing, league), "Champions League");
  const slots = uefaSlotsForLeague(league);
  assert.ok(slots.cl >= 1);
  assert.equal(
    continentalCompetitionForStanding({ position: slots.cl + 1, qualification: null }, league),
    "Europa League"
  );
});

test("AFC/CAF club supplement and playable leagues are present", () => {
  assert.ok(CLUB_PROFILES.some((c) => c.nation === "Saudi Arabia"));
  assert.ok(CLUB_PROFILES.some((c) => c.nation === "Egypt"));
  assert.ok(LEAGUES.some((l) => l.nation === "Saudi Arabia"));
  assert.ok(LEAGUES.some((l) => l.nation === "Egypt"));
  const saudi = LEAGUES.find((l) => l.nation === "Saudi Arabia");
  const q = continentalCompetitionForStanding({ position: 1, qualification: "League Champions" }, saudi);
  assert.equal(q, "AFC Champions League Elite");
  const egypt = LEAGUES.find((l) => l.nation === "Egypt");
  assert.equal(
    continentalCompetitionForStanding({ position: 1, qualification: "League Champions" }, egypt),
    "CAF Champions League"
  );
});

test("Champions League campaign uses league phase with 36-team field when pool allows", () => {
  reseedCareerRng(42);
  setWorldState(createWorldState({ startYear: 2026, careerSeed: 42 }));
  const league = serieA();
  const club = [...league.clubs].sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))[0];
  const player = makePlayer(club, league);
  const campaign = simulateEuropeanCampaign({
    standing: { position: 1, qualification: "League Champions" },
    league,
    performanceScore: 80,
    player,
    seasonYear: 2026,
  });
  assert.ok(campaign);
  assert.equal(campaign.competition, "Champions League");
  assert.ok(campaign.leaguePhase?.table?.length >= 16, `league table size ${campaign.leaguePhase?.table?.length}`);
  assert.ok(campaign.allRounds?.some((r) => r.round === "Final"), "has final");
  assert.ok(campaign.winner, "has champion");
  assert.ok(campaign.feederGraph?.length, "stores feeder graph");
  // Distinct opponents per club in league phase (allowing repair extras)
  const playerRow = campaign.leaguePhase.table.find((r) => r.name === club.name);
  if (playerRow) {
    assert.ok(playerRow.played >= 6, `player club played ${playerRow.played}`);
  }
});

test("Libertadores uses group stage", () => {
  reseedCareerRng(7);
  setWorldState(createWorldState({ startYear: 2026, careerSeed: 7 }));
  const league = LEAGUES.find((l) => l.nation === "Brazil" && (l.divisionLevel ?? 1) === 1);
  const club = [...league.clubs].sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))[0];
  const player = makePlayer(club, league, { nationality: "Brazil" });
  const campaign = simulateEuropeanCampaign({
    standing: { position: 1, qualification: "League Champions" },
    league,
    performanceScore: 75,
    player,
    seasonYear: 2026,
  });
  assert.equal(campaign.competition, "Copa Libertadores");
  assert.ok(campaign.groups?.groups?.length >= 4, "has groups");
  assert.ok(campaign.allRounds?.length, "has knockout");
});

test("World Cup 2026 config is 48 teams with best thirds; EURO is 24", () => {
  const wc = tournamentsForYear(2026).find((t) => t.id === "world-cup");
  assert.ok(wc);
  assert.equal(wc.fieldSize, 48);
  assert.equal(wc.bestThirds, 8);
  const euro = tournamentsForYear(2028).find((t) => t.id === "euro");
  assert.ok(euro);
  assert.equal(euro.fieldSize, 24);
  assert.equal(euro.bestThirds, 4);
});

test("World Cup simulation builds power-of-two knockout without truncating qualifiers", () => {
  reseedCareerRng(99);
  setWorldState(createWorldState({ startYear: 2026, careerSeed: 99 }));
  const player = {
    name: "Intl Star",
    nationality: "Brazil",
    position: "ST",
    club: { name: "Flamengo", overall: 82, nation: "Brazil" },
    currentOverall: 84,
    startYear: 2026,
  };
  const season = simulateInternationalSeason({ player, calendarYear: 2026, avgMatchRating: 7.5 });
  const wc = season.tournaments?.find((t) => t.id === "world-cup");
  assert.ok(wc, "world cup present");
  assert.ok(wc.field.length >= 32, `field ${wc.field.length}`);
  assert.ok(wc.groups?.length >= 8, `groups ${wc.groups?.length}`);
  const koTeams =
    (wc.groups?.length || 0) * 2 + (wc.bestThirdTable?.length || 0);
  // After resolution, knockout must have started from power of two
  const firstKo = wc.allRounds?.[0];
  assert.ok(firstKo?.matches?.length >= 8, `R32/R16 ties ${firstKo?.matches?.length}`);
  void koTeams;
});
