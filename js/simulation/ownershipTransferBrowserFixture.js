/**
 * Deterministic Arsenal → mid-season permanent-move review for ownership QA.
 * Pauses at the January squad window with a validated Brentford permanent offer.
 */
import { LEAGUES, LEAGUE_LOOKUP, LEAGUE_BY_ID } from "../data/leagues.js";
import { createPlayerIdentity } from "./playerDevelopment.js";
import { simulateSeason } from "./seasonSimulator.js";
import { createWorldState, setWorldState } from "./worldState.js";
import { resetClubFinanceLedgers } from "./clubFinance.js";
import { reseedCareerRng } from "./rng.js";
import { resolveMoveRegistration } from "./destinationSchedule.js";
import { allSeniorClubs } from "./seniorClubs.js";
import { ensurePlayingStints } from "./playingRegistration.js";

export const OWNERSHIP_TRANSFER_FIXTURE = {
  careerId: "ownership-transfer-fixture-v1",
  seed: 42,
  startYear: 2026,
};

export function buildOwnershipTransferBrowserFixture(opts = {}) {
  const cfg = { ...OWNERSHIP_TRANSFER_FIXTURE, ...opts };
  resetClubFinanceLedgers();
  reseedCareerRng(cfg.seed);
  setWorldState(createWorldState({ startYear: cfg.startYear }));

  const league = LEAGUE_BY_ID.get("league:england-premier-league");
  const arsenal = league.clubs.find((c) => c.clubId === "club:england:arsenal");
  const brentford = allSeniorClubs().find((c) => c.clubId === "club:england:brentford");
  if (!arsenal || !brentford) {
    return { ok: false, reason: "clubs-missing", player: null, offers: [], checkpoint: null };
  }

  const player = createPlayerIdentity({
    name: "Ownership Transfer",
    nationality: "England",
    position: "CM",
    age: 19,
  });
  player.startYear = cfg.startYear;
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
  player.careerId = cfg.careerId;
  player.seasons = [];
  player.pendingOffers = [];
  player.pendingDecision = null;
  player.seasonCheckpoint = null;
  player.decisionCooldowns = {};
  ensurePlayingStints(player, { asOfDate: `${cfg.startYear}-07-01` });

  let seasonData = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: true,
    autoDecisionPolicy: null,
  });
  let sceneGuards = 0;
  while (seasonData?.awaitingScenario && sceneGuards < 12) {
    sceneGuards += 1;
    player.pendingSeniorScenario = null;
    if (seasonData.checkpoint) seasonData.checkpoint.pendingSeniorScenario = null;
    player.seasonCheckpoint = seasonData.checkpoint;
    seasonData = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions: true,
      autoDecisionPolicy: null,
    });
  }
  if (!seasonData?.awaitingDecision && seasonData?.status !== "awaiting_decision") {
    return { ok: false, reason: "no-decision-pause", player, offers: [], checkpoint: null };
  }

  const ck = seasonData.checkpoint || player.seasonCheckpoint;
  // Controlled permanent offer for ownership QA. Fee is set inside Brentford's
  // affordability band so production acceptPipelineOffer can book it without
  // requiring a negotiated seller/buyer overlap (Arsenal reservation can exceed it).
  const registration = resolveMoveRegistration({
    destinationLeagueId: brentford.leagueId,
    departureDate: ck.lastDate,
    originSeasonStartYear: cfg.startYear,
  });
  const offer = {
    offerId: `ownership-transfer:${brentford.clubId}:${ck.lastDate}`,
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
    dealType: "permanent",
    isLoan: false,
    isRenewal: false,
    isFreeAgent: false,
    transferFee: 12_000_000,
    wage: 6000,
    contractYears: 3,
    expectedRole: "starter",
    reviewDate: ck.lastDate,
    effectiveDate: ck.lastDate,
    registration,
    status: "pending",
    careerId: player.careerId,
  };

  player.pendingOffers = [offer];
  player.pendingDecision = null;
  player.seasonCheckpoint = ck;
  ck.status = "awaiting_decision";
  ck.playingClubIdAtPause = arsenal.clubId;
  ck.offers = [offer];
  ck.decision = null;

  return {
    ok: true,
    player,
    decision: null,
    offers: [offer],
    checkpoint: ck,
    fromClubId: arsenal.clubId,
    toClubId: brentford.clubId,
  };
}
