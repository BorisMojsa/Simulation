/**
 * Deterministic Fix 12 browser fixture: completed World Cup season presentation
 * for production showSeasonAnimation → #continue-btn → finishSeasonAnimation.
 */
import { LEAGUES } from "../data/leagues.js";
import { createRng } from "./rng.js";
import { createWorldState, setWorldState } from "./worldState.js";
import {
  generateStartingAttributes,
  initializePlayerDevelopment,
} from "./playerDevelopmentModel.js";
import { resetClubFinanceLedgers } from "./clubFinance.js";
import {
  prepareNationalEdition,
  drainNationalEdition,
  buildNationalCampaignView,
} from "./nationalTournament.js?v=91";
import { ensurePlayingStints } from "./playingRegistration.js";

export const FIX12_TOURNAMENT_PRESENTATION_FIXTURE = {
  careerId: "fix12-tournament-presentation-v1",
  seed: 12001,
  startYear: 2026,
  nation: "Serbia",
};

function f01Processor() {
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

function withPlayerSide(matches, nation) {
  return (matches || []).map((m) => {
    const h = m.home?.name || m.homeParticipantId;
    const a = m.away?.name || m.awayParticipantId;
    return {
      ...m,
      playerSide: h === nation ? "home" : a === nation ? "away" : null,
      competitionType: "international",
      teamType: "nation",
    };
  });
}

export function buildFix12TournamentPresentationBrowserFixture(opts = {}) {
  const cfg = { ...FIX12_TOURNAMENT_PRESENTATION_FIXTURE, ...opts };
  resetClubFinanceLedgers();
  const world = createWorldState({ seed: cfg.seed, startYear: cfg.startYear });
  setWorldState(world);
  const league = LEAGUES.find((l) => l.nation === cfg.nation);
  const club = league?.clubs?.find((c) => /Red Star/.test(c.name));
  if (!league || !club) return { ok: false, reason: "serbia-club-missing" };

  const rng = createRng(12);
  const player = {
    name: "Fix12 Presentation",
    nationality: cfg.nation,
    position: "ST",
    age: 25,
    careerId: cfg.careerId,
    startYear: cfg.startYear,
    rating: 85,
    potential: 90,
    attributes: generateStartingAttributes("ST", 85, 99, rng),
    club: { ...club, league: league.name, leagueId: league.leagueId, nation: league.nation },
    employmentClubId: club.clubId,
    playingClubId: club.clubId,
    contractStartSeason: 0,
    contractYears: 4,
    contractEndSeason: 4,
    weeklyWage: 20000,
    seasons: [],
    careerTotals: { matches: 0, goals: 0, assists: 0, cleanSheets: 0 },
    careerHonors: {
      leagueTitles: 0,
      europeanTitles: 0,
      domesticCups: 0,
      individualAwards: 0,
      internationalTitles: 1,
    },
    latestStanding: {
      leagueId: league.leagueId,
      playerRow: { position: 1, qualification: "Champions League", points: 80 },
    },
  };
  initializePlayerDevelopment(player, { rng, careerId: player.careerId, budget: 99 });
  ensurePlayingStints(player, { asOfDate: `${cfg.startYear}-07-01` });

  const ed = prepareNationalEdition({
    tournament: {
      id: "world-cup",
      name: "FIFA World Cup",
      shortName: "World Cup",
      confederation: "FIFA",
      fieldSize: 48,
      groupSize: 4,
      bestThirds: 8,
      editionYear: cfg.startYear,
      year: cfg.startYear,
    },
    player,
    calledUp: true,
    forceIncludeIfEligible: true,
    calendarYear: cfg.startYear,
    world,
  });
  drainNationalEdition(ed, { player, world, matchProcessor: f01Processor() });
  const view = buildNationalCampaignView(ed, { player, world });
  const playerIntlMatches = withPlayerSide(view.playerMatches || [], cfg.nation);
  const groupFixtures = (view.groups || []).flatMap((g) => g.matches || []);
  const allIntl = withPlayerSide(
    [...groupFixtures, ...(view.allRounds || []).flatMap((r) => r.matches || [])],
    cfg.nation
  );

  const seasonId = `fix12-wc-season-${cfg.startYear}`;
  const season = {
    seasonId,
    seasonNumber: 1,
    year: cfg.startYear,
    age: player.age,
    clubId: club.clubId,
    clubName: club.name,
    clubDisplay: club.displayName || club.name,
    league: league.name,
    leagueId: league.leagueId,
    matches: 0,
    appearances: 0,
    minutes: 0,
    goals: 0,
    assists: 0,
    cleanSheets: 0,
    yellowCards: 0,
    redCards: 0,
    avgMatchRating: 0,
    leagueMatches: [],
    leagueAllMatches: [],
    domesticCupCampaigns: [],
    international: {
      year: cfg.startYear,
      hasTournaments: true,
      calledUp: true,
      tournaments: [view],
      primary: view,
      playerMatches: playerIntlMatches,
    },
    trophies: [
      {
        kind: "international",
        label: "FIFA World Cup Winners",
        competition: "FIFA World Cup",
      },
    ],
  };
  player.seasons = [season];
  player.age = Number(player.age) + 1;

  const standings = {
    table: (league.clubs || []).map((c, i) => ({
      clubId: c.clubId,
      name: c.name,
      displayName: c.displayName || c.name,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      gf: 0,
      ga: 0,
      gd: 0,
      pts: 0,
      position: i + 1,
    })),
    playerRecord: null,
  };

  const internationalSeason = {
    year: cfg.startYear,
    hasTournaments: true,
    calledUp: true,
    announcement: `${cfg.startYear} · called up for FIFA World Cup`,
    tournaments: [view],
    primary: view,
    playerMatches: playerIntlMatches,
  };

  const seasonData = {
    season,
    league,
    standings,
    leagueAllMatches: [],
    leaguePlayerMatches: [],
    domesticCupCampaigns: [],
    internationalSeason,
    individualAwards: [],
    attributeChanges: {},
    previousRating: player.rating,
    newRating: player.rating,
    performanceScore: 0.7,
    continueDashboard: false,
    revealedFixtureIds: [],
  };

  player.__qaFix12Fixture = {
    seed: cfg.seed,
    nation: cfg.nation,
    competition: "FIFA World Cup",
    expectedGroup: { played: 3, wins: 2, draws: 1, losses: 0 },
    expectedTotal: { played: 8, wins: 7, draws: 1, losses: 0 },
    expectedResult: "Winners",
    expectedNextActionId: "simulate",
    playerMatchCount: playerIntlMatches.length,
    allMatchCount: allIntl.length,
    seasonId,
  };

  return {
    ok: true,
    player,
    league,
    view,
    season,
    seasonData,
    internationalSeason,
    playerIntlMatches,
    allIntl,
  };
}
