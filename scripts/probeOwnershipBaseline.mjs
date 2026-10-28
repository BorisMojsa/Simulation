/**
 * Fix 02 baseline probe — Arsenal→Brentford permanent + Atalanta→Rudeš loan.
 * Run: node scripts/probeOwnershipBaseline.mjs
 */
import { LEAGUE_BY_ID, LEAGUES, LEAGUE_LOOKUP } from "../js/data/leagues.js";
import { createPlayerIdentity } from "../js/simulation/playerDevelopment.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import {
  simulateChronologicalSeason,
  resumeChronologicalSeason,
} from "../js/simulation/chronologicalSeason.js";
import { createWorldState, setWorldState } from "../js/simulation/worldState.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import { reseedCareerRng } from "../js/simulation/rng.js";
import { applyOfferToPlayer } from "../js/simulation/dealPipeline.js";
import { resolveMoveRegistration } from "../js/simulation/destinationSchedule.js";
import { startLoan } from "../js/simulation/loanMarket.js";
import { buildLiveLoanBrowserFixture } from "../js/simulation/liveLoanBrowserFixture.js";
import { allSeniorClubs } from "../js/simulation/seniorClubs.js";

function findClub(id) {
  return allSeniorClubs().find((c) => c.clubId === id);
}

function summarizeContinental(campaign, player) {
  const matches = campaign?.playerMatches || [];
  const postMove = matches.filter((m) => String(m.date || "") >= "2027-01-10");
  return {
    competition: campaign?.competition || campaign?.name || null,
    playerClub: campaign?.playerClub || campaign?.club || null,
    won: campaign?.won ?? null,
    playerMatchCount: matches.length,
    postMoveCount: postMove.length,
    postMoveSample: postMove.slice(0, 5).map((m) => ({
      date: m.date,
      home: m.home?.clubId || m.home?.name,
      away: m.away?.clubId || m.away?.name,
      minutes: m.playerStats?.minutes ?? m.minutes ?? null,
      teamId: m.playerClubId || m.teamId || null,
    })),
    playingClubId: player.playingClubId,
    employmentClubId: player.employmentClubId,
  };
}

function summarizeCup(cup, player) {
  return {
    name: cup?.name,
    won: cup?.won ?? null,
    playerName: cup?.playerName || null,
    playerMatches: (cup?.playerMatches || []).map((m) => ({
      date: m.date,
      home: m.home?.clubId || m.home?.name,
      away: m.away?.clubId || m.away?.name,
      minutes: m.playerStats?.minutes ?? m.minutes ?? null,
      playerSide: m.playerSide ?? null,
    })),
    playingClubId: player.playingClubId,
  };
}

function summarizeLedger(raw, afterDate, formerClubId) {
  const rows = (raw || []).filter((r) => String(r.date || "") >= afterDate);
  const former = rows.filter(
    (r) =>
      r.competitionType === "continental" ||
      r.competitionType === "europe" ||
      r.competitionType === "cup" ||
      String(r.competitionId || "").toLowerCase().includes("cup") ||
      String(r.competitionId || "").toLowerCase().includes("champions")
  );
  return {
    postMoveRows: rows.length,
    clubCompSample: former.slice(0, 8).map((r) => ({
      date: r.date,
      competitionType: r.competitionType,
      competitionId: r.competitionId,
      teamId: r.teamId,
      minutes: r.minutes,
      formerClubLeak: r.teamId && formerClubId && r.teamId !== formerClubId ? "teamId≠former" : null,
    })),
  };
}

async function probePermanent() {
  console.log("\n=== PROBE A: Arsenal → Brentford permanent ===");
  resetClubFinanceLedgers();
  reseedCareerRng(42);
  setWorldState(createWorldState({ startYear: 2026 }));

  const league = LEAGUE_BY_ID.get("league:england-premier-league");
  const arsenal = league.clubs.find((c) => c.clubId === "club:england:arsenal");
  const brentford = findClub("club:england:brentford");

  const player = createPlayerIdentity({
    name: "Bug 2 Ownership",
    nationality: "England",
    position: "CM",
    age: 19,
  });
  player.startYear = 2026;
  player.rating = 76;
  player.potential = 88;
  player.attributes = {
    Speed: 76,
    Passing: 78,
    Shooting: 72,
    Defending: 74,
    Physicality: 76,
    Dribbling: 77,
  };
  player.playerModelVersion = 2;
  player.state = { form: 0, morale: 0, readiness: 1, fatigue: 0, adaptationPenalty: 0, roleFit: 1 };
  player.health = { activeInjury: null, injuryHistory: [], durableDamage: {}, recoverableDamage: {} };
  player.development = { latentBudget: 90, modelVersion: 1, migration: {} };
  player.club = {
    ...arsenal,
    league: league.name,
    leagueDisplay: league.displayName,
    leagueId: league.leagueId,
    nation: league.nation,
    isAcademy: false,
    parentClub: null,
  };
  player.employmentClubId = arsenal.clubId;
  player.playingClubId = arsenal.clubId;
  player.contractStartSeason = 0;
  player.contractYears = 4;
  player.contractEndSeason = 4;
  player.weeklyWage = 4000;
  player.careerId = "bug2-ownership-audit-v1";
  player.seasons = [];

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
  console.log("checkpoint status:", seasonData?.status || seasonData?.awaitingDecision ? "awaiting_decision" : "?", {
    awaitingDecision: !!seasonData?.awaitingDecision,
    awaitingScenario: !!seasonData?.awaitingScenario,
    lastDate: seasonData?.checkpoint?.lastDate,
  });

  if (!seasonData?.awaitingDecision && seasonData?.status !== "awaiting_decision") {
    console.log("FAIL: did not reach awaitingDecision");
    return;
  }

  const ck = seasonData.checkpoint || player.seasonCheckpoint;
  const offer = {
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
    reviewDate: ck.lastDate,
    effectiveDate: ck.lastDate,
    registration: resolveMoveRegistration({
      destinationLeagueId: brentford.leagueId,
      departureDate: ck.lastDate,
      originSeasonStartYear: 2026,
    }),
  };
  applyOfferToPlayer(player, offer, "audit-controlled-transfer-1");
  player.pendingOffers = [];
  player.pendingDecision = null;
  console.log("after move:", {
    playingClubId: player.playingClubId,
    employmentClubId: player.employmentClubId,
    cupPlayerHint: ck.cupState?.playerName,
    europePlayerClub: ck.europeEdition?.playerClubId || ck.europeEdition?.playerClub?.clubId,
  });

  const done = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: null,
  });

  const season = player.seasons?.[player.seasons.length - 1];
  console.log("continental:", summarizeContinental(done?.europeanCampaign || season?.europeanCampaign || done?.europe, player));
  console.log("cup:", summarizeCup(done?.domesticCup || season?.domesticCup, player));
  console.log("honors:", season?.honors, player.careerHonors);
  console.log(
    "post-move Arsenal playerMatches continental:",
    (done?.europeanCampaign?.playerMatches || season?.europeanCampaign?.playerMatches || [])
      .filter((m) => String(m.date || "") > "2027-01-10")
      .map((m) => ({
        date: m.date,
        home: m.home?.clubId || m.home?.name,
        away: m.away?.clubId || m.away?.name,
        mins: m.playerStats?.minutes ?? m.minutes,
      }))
  );
}

async function probeLoan() {
  console.log("\n=== PROBE B: Atalanta → Rudeš loan ===");
  const fixture = buildLiveLoanBrowserFixture({ seed: 42 });
  if (!fixture.ok) {
    console.log("fixture fail:", fixture.reason);
    return;
  }
  const { player, offers, checkpoint } = fixture;
  const offer = offers[0];
  console.log("first offer:", {
    club: offer.club,
    clubId: offer.clubId,
    isLoan: offer.isLoan,
  });
  const started = startLoan(player, offer);
  console.log("startLoan:", started.ok, {
    playingClubId: player.playingClubId,
    employmentClubId: player.employmentClubId,
  });
  player.pendingOffers = [];
  player.pendingDecision = null;

  const done = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: null,
  });
  const season = player.seasons?.[player.seasons.length - 1];
  const europe = done?.europeanCampaign || season?.europeanCampaign;
  console.log("continental after loan:", summarizeContinental(europe, player));
  console.log(
    "post-move Atalanta continental playerMatches:",
    (europe?.playerMatches || [])
      .filter((m) => String(m.date || "") > "2027-01-10")
      .map((m) => ({
        date: m.date,
        home: m.home?.clubId || m.home?.name,
        away: m.away?.clubId || m.away?.name,
        mins: m.playerStats?.minutes ?? m.minutes,
      }))
  );
}

await probePermanent();
await probeLoan();
