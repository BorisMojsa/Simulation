/**
 * Deterministic free-agent desk fixtures for browser acceptance.
 * Builds a released senior via production contract helpers so Boris can
 * exercise Train/search without playing many seasons or editing console state.
 *
 * Modes:
 * - empty (default): released, no pending offers at load — search available
 * - empty-result: same desk, but careerId chosen so post-period market review
 *   stays empty under current production recruitment (assert, don't force)
 * - offers: released with validated free-agent offers ready to review
 * - retire-41: age 41 free agent — next search reaches the age-42 retirement path
 * - signed: already accepted a permanent offer — next season is ordinary club play
 * - expiry-club: under a 1-year deal so the next completed club season releases the player
 */

/** Deterministic identity that yields zero offers after FA search at default OVR. */
export const FREE_AGENT_EMPTY_RESULT_CAREER_ID = "free-agent-ui-empty-2";
import { LEAGUES, LEAGUE_LOOKUP, LEAGUE_BY_ID } from "../data/leagues.js";
import { createPlayerIdentity } from "./playerDevelopment.js";
import { createWorldState, setWorldState } from "./worldState.js";
import { resetClubFinanceLedgers } from "./clubFinance.js";
import { reseedCareerRng } from "./rng.js";
import { ensureTransferSave } from "./transferMigration.js";
import {
  ensureContractAuthority,
  releaseToFreeAgency,
  selectNextCareerAction,
  isFreeAgent,
} from "./contractLifecycle.js";
import { generateTransferOffers } from "./transferMarket.js";
import { acceptPipelineOffer } from "./dealPipeline.js";
import { refreshAbilityCaches } from "./playerAbility.js";

export const FREE_AGENT_FIXTURE = {
  careerId: "free-agent-ui-fixture-v1",
  seed: 91,
  leagueId: "league:italy-serie-a",
  clubIndex: 3,
  name: "Free Agent Fixture",
  nationality: "Italy",
  position: "CM",
  age: 27,
  rating: 72,
  potential: 76,
  weeklyWage: 12000,
  startYear: 2026,
};

function basePlayer(cfg) {
  resetClubFinanceLedgers();
  reseedCareerRng(cfg.seed);
  setWorldState(createWorldState({ startYear: cfg.startYear }));

  const league = LEAGUE_BY_ID.get(cfg.leagueId);
  if (!league) return { ok: false, reason: "league-missing", player: null };
  const club = league.clubs[cfg.clubIndex ?? 0];
  if (!club) return { ok: false, reason: "club-missing", player: null };

  const player = createPlayerIdentity({
    name: cfg.name,
    nationality: cfg.nationality,
    position: cfg.position,
    age: cfg.age,
  });
  player.startYear = cfg.startYear;
  player.age = cfg.age;
  player.rating = cfg.rating;
  player.potential = cfg.potential;
  player.attributes = {
    Speed: cfg.rating,
    Passing: cfg.rating + 1,
    Shooting: cfg.rating - 2,
    Defending: cfg.rating - 1,
    Physicality: cfg.rating,
    Dribbling: cfg.rating + 1,
  };
  player.playerModelVersion = 2;
  player.state = { form: 0.1, morale: 0, readiness: 1, fatigue: 0, adaptationPenalty: 0, roleFit: 1 };
  player.health = { activeInjury: null, injuryHistory: [], durableDamage: {}, recoverableDamage: {} };
  player.development = { latentBudget: cfg.potential, modelVersion: 1, migration: {} };
  player.club = {
    ...club,
    league: league.name,
    leagueDisplay: league.displayName,
    leagueId: league.leagueId,
    nation: league.nation,
    isAcademy: false,
    parentClub: null,
  };
  player.employmentClubId = club.clubId;
  player.playingClubId = club.clubId;
  player.contractStartSeason = 0;
  player.contractYears = 1;
  player.contractEndSeason = 1;
  player.weeklyWage = cfg.weeklyWage;
  player.careerId = cfg.careerId;
  player.seasons = [];
  player.pendingOffers = [];
  player.pendingDecision = null;
  player.seasonCheckpoint = null;
  player.decisionCooldowns = {};
  player.careerTotals = { matches: 0, goals: 0, assists: 0, cleanSheets: 0 };
  player.careerIntroComplete = true;
  refreshAbilityCaches(player);
  ensureContractAuthority(player);
  ensureTransferSave(player);
  return { ok: true, player, league, club };
}

function releaseReady(player) {
  releaseToFreeAgency(player, "contract-expired");
  player.pendingOffers = [];
  player.pendingDecision = null;
  player.seasonCheckpoint = null;
  player.pendingSeniorScenario = null;
  ensureContractAuthority(player);
  ensureTransferSave(player);
}

/**
 * @param {object} [opts]
 * @param {"empty"|"empty-result"|"offers"|"retire-41"|"signed"|"expiry-club"} [opts.mode]
 */
export function buildFreeAgentBrowserFixture(opts = {}) {
  const mode = opts.mode || "empty";
  const cfg = {
    ...FREE_AGENT_FIXTURE,
    ...opts,
    careerId:
      opts.careerId ??
      (mode === "empty-result" ? FREE_AGENT_EMPTY_RESULT_CAREER_ID : FREE_AGENT_FIXTURE.careerId),
    age: opts.age ?? (mode === "retire-41" ? 41 : FREE_AGENT_FIXTURE.age),
    rating: opts.rating ?? (mode === "offers" || mode === "signed" ? 84 : FREE_AGENT_FIXTURE.rating),
    potential: opts.potential ?? (mode === "offers" || mode === "signed" ? 88 : FREE_AGENT_FIXTURE.potential),
    seed: opts.seed ?? (mode === "offers" || mode === "signed" ? 17 : FREE_AGENT_FIXTURE.seed),
  };

  const built = basePlayer(cfg);
  if (!built.ok) return { ...built, mode, offers: [] };
  const { player } = built;

  if (mode === "expiry-club") {
    // One year left — next completed club season will release after ordinary playback.
    player.contractYears = 1;
    player.contractEndSeason = 1;
    player.contractStartSeason = 0;
    ensureContractAuthority(player);
    ensureTransferSave(player);
    return {
      ok: true,
      mode,
      player,
      offers: [],
      nextAction: selectNextCareerAction(player),
    };
  }

  releaseReady(player);

  if (mode === "retire-41") {
    player.age = 41;
    ensureTransferSave(player);
    return {
      ok: true,
      mode,
      player,
      offers: [],
      nextAction: selectNextCareerAction(player),
    };
  }

  if (mode === "offers" || mode === "signed") {
    const offers = generateTransferOffers(88, player, LEAGUES, LEAGUE_LOOKUP, null);
    player.pendingOffers = offers;
    if (!offers.length) {
      return {
        ok: false,
        reason: "no-validated-free-agent-offers",
        mode,
        player,
        offers: [],
        nextAction: selectNextCareerAction(player),
      };
    }
    if (mode === "signed") {
      const pick = offers.find((o) => !o.isLoan && !o.isRenewal) || offers[0];
      const accepted = acceptPipelineOffer(player, pick);
      if (!accepted.ok) {
        return {
          ok: false,
          reason: `sign-failed:${accepted.reason || (accepted.reasons || []).join(",")}`,
          mode,
          player,
          offers,
          nextAction: selectNextCareerAction(player),
        };
      }
      player.pendingOffers = [];
      player.pendingDecision = null;
      ensureTransferSave(player);
      return {
        ok: true,
        mode,
        player,
        offers: [],
        signedClub: player.club?.displayName || player.club?.name,
        nextAction: selectNextCareerAction(player),
      };
    }
    ensureTransferSave(player);
    return {
      ok: true,
      mode,
      player,
      offers,
      nextAction: selectNextCareerAction(player),
    };
  }

  // empty / empty-result desk (no pending offers at load)
  player.pendingOffers = [];
  ensureTransferSave(player);
  return {
    ok: true,
    mode: mode === "empty-result" ? "empty-result" : "empty",
    player,
    offers: [],
    freeAgent: isFreeAgent(player),
    careerId: player.careerId,
    nextAction: selectNextCareerAction(player),
  };
}
