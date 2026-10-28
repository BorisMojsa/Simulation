/**
 * Versioned migration for transfer/loan/finance career fields.
 * Does not alter completed historical deals or development curves.
 */
import { FINANCE_PROFILE_VERSION } from "../data/clubFinanceProfiles.js";
import { getOrInitClubSeasonFinance, weeklyToAnnual } from "./clubFinance.js";
import { RECRUITMENT_CONFIG_VERSION } from "../config/recruitmentConfig.js";
import {
  ensureContractAuthority,
  applyContractExpiryAtBoundary,
  CONTRACT_LIFECYCLE_VERSION,
} from "./contractLifecycle.js";
import { ensurePlayingStints } from "./playingRegistration.js";
import { migrateAcademyLifecycle, ensureAcademyLifecycle } from "./academyLifecycle.js";

const DEAL_PIPELINE_VERSION = "deal-pipeline-v2";

export const TRANSFER_SAVE_VERSION = 3;

/**
 * Migrate player transfer/loan/contract fields in place (idempotent).
 */
export function migrateTransferSave(player, opts = {}) {
  if (!player || typeof player !== "object") return { migrated: false, reason: "no-player" };
  if (player.transferSaveVersion >= TRANSFER_SAVE_VERSION) {
    ensureContractAuthority(player);
    migrateAcademyLifecycle(player);
    return { migrated: false, reason: "already-current", player };
  }

  const seasonIndex = player.seasons?.length ?? 0;

  // Employment vs playing registration
  if (!player.employmentClubId && player.club?.clubId && !player.club.isAcademy) {
    player.employmentClubId = player.club.clubId;
  }
  if (!player.playingClubId && player.club?.clubId) {
    player.playingClubId = player.club.clubId;
  }

  // Derive weekly wage if missing
  if (!Number.isFinite(player.weeklyWage) && Number.isFinite(player.wage)) {
    player.weeklyWage = player.wage;
  }

  // Contract seasons: preserve existing; do not extend.
  if (player.contractYears != null && player.contractEndSeason == null && player.contractStartSeason != null) {
    player.contractEndSeason = player.contractStartSeason + player.contractYears;
  }

  // Active loan shape
  if (player.activeLoan && !player.activeLoan.status) {
    player.activeLoan.status = "active";
  }

  // Revalidate unsigned pending offers through new pipeline on next generation.
  if (Array.isArray(player.pendingOffers) && player.pendingOffers.length) {
    player.pendingOffers = player.pendingOffers.filter((o) => o && o.club);
    for (const o of player.pendingOffers) {
      o.needsPipelineRevalidation = true;
      if (!o.dealType) {
        o.dealType = o.isLoan ? "loan" : o.isRenewal ? "renewal" : o.transferFee === 0 ? "free_agent" : "permanent";
      }
    }
  }

  // Init finance baseline once for current club (player wage counted once).
  if (player.club?.clubId && !player.club.isAcademy) {
    const sk = String((player.startYear || 2026) + seasonIndex);
    getOrInitClubSeasonFinance(player.club.clubId, sk, {
      playerAnnualWageAtClub: player.weeklyWage ? weeklyToAnnual(player.weeklyWage) : 0,
      treatPlayerWageInBaseline: true,
    });
  }

  if (!player.completedDealIds) player.completedDealIds = [];
  if (!player.decisionCooldowns) player.decisionCooldowns = {};
  if (!player.scoutingEvidence) player.scoutingEvidence = {};

  ensureContractAuthority(player);
  ensurePlayingStints(player);

  // Expired legacy careers: release without granting extra years.
  if (
    player.contractEndSeason != null &&
    seasonIndex >= player.contractEndSeason &&
    player.club &&
    !player.club.isAcademy
  ) {
    applyContractExpiryAtBoundary(player);
  }

  // Fix 04: academy lifecycle fields, clear incompatible senior pending on academy.
  ensureAcademyLifecycle(player);
  migrateAcademyLifecycle(player);

  player.transferSaveVersion = TRANSFER_SAVE_VERSION;
  player.transferMigration = {
    version: TRANSFER_SAVE_VERSION,
    financeProfileVersion: FINANCE_PROFILE_VERSION,
    dealPipelineVersion: DEAL_PIPELINE_VERSION,
    recruitmentConfigVersion: RECRUITMENT_CONFIG_VERSION,
    contractLifecycleVersion: CONTRACT_LIFECYCLE_VERSION,
    academyLifecycleVersion: player.academyLifecycle?.version ?? null,
    migratedAtSeason: seasonIndex,
    ...opts.meta,
  };

  return { migrated: true, player };
}

export function ensureTransferSave(player, opts = {}) {
  if (!player) return player;
  migrateTransferSave(player, opts);
  ensureContractAuthority(player);
  if (player.club?.isAcademy) {
    ensureAcademyLifecycle(player);
    migrateAcademyLifecycle(player);
  }
  return player;
}

/**
 * Checkpoint state for resumable mid-season decisions.
 */
export function createDecisionCheckpoint(player, extra = {}) {
  return {
    version: TRANSFER_SAVE_VERSION,
    simulationDate: extra.simulationDate || null,
    seasonIndex: player.seasons?.length ?? 0,
    pendingDecision: player.pendingDecision || null,
    pendingOffers: player.pendingOffers || [],
    activeLoan: player.activeLoan || null,
    employmentClubId: player.employmentClubId || null,
    playingClubId: player.playingClubId || null,
    pendingRegistration: player.pendingRegistration || null,
    parentClubSnapshot: player.parentClubSnapshot || null,
    playingStints: player.playingStints || null,
    rngSeed: extra.rngSeed || null,
    processedEventIds: extra.processedEventIds || [],
  };
}

export function applyDecisionCheckpoint(player, checkpoint) {
  if (!checkpoint || !player) return player;
  if (checkpoint.pendingDecision) player.pendingDecision = checkpoint.pendingDecision;
  if (checkpoint.pendingOffers) player.pendingOffers = checkpoint.pendingOffers;
  if (checkpoint.activeLoan) player.activeLoan = checkpoint.activeLoan;
  if (checkpoint.employmentClubId) player.employmentClubId = checkpoint.employmentClubId;
  if (checkpoint.playingClubId) player.playingClubId = checkpoint.playingClubId;
  if (checkpoint.pendingRegistration !== undefined) {
    player.pendingRegistration = checkpoint.pendingRegistration;
  }
  if (checkpoint.parentClubSnapshot !== undefined) {
    player.parentClubSnapshot = checkpoint.parentClubSnapshot;
  }
  if (Array.isArray(checkpoint.playingStints)) {
    player.playingStints = checkpoint.playingStints;
  }
  ensurePlayingStints(player);
  player.decisionCheckpoint = checkpoint;
  return player;
}
