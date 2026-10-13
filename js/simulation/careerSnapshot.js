/**
 * Session career snapshot — world + player + finance + chrono checkpoint.
 * There is currently no disk/localStorage career save in the product; this
 * supports in-memory round-trips and tests.
 */
import { serializeWorldState, deserializeWorldState } from "./worldState.js";
import { exportClubFinanceState, importClubFinanceState } from "./clubFinance.js";
import { ensureTransferSave, TRANSFER_SAVE_VERSION } from "./transferMigration.js";
import { getSimRng } from "./rng.js";

export const CAREER_SNAPSHOT_VERSION = 1;

/**
 * Serialize a full career session (world, player market state, finances, checkpoint).
 */
export function serializeCareerSnapshot({ player, world, checkpoint = null } = {}) {
  ensureTransferSave(player);
  return {
    schemaVersion: CAREER_SNAPSHOT_VERSION,
    transferSaveVersion: TRANSFER_SAVE_VERSION,
    rngSeed: getSimRng().seed(),
    world: serializeWorldState(world),
    clubFinance: exportClubFinanceState(),
    player: structuredClone(player),
    seasonCheckpoint: checkpoint || player?.seasonCheckpoint || null,
  };
}

/**
 * Restore a career snapshot into memory. Returns { player, world }.
 */
export function deserializeCareerSnapshot(data) {
  if (!data || typeof data !== "object") return null;
  const world = data.world ? deserializeWorldState(data.world) : null;
  if (data.clubFinance) importClubFinanceState(data.clubFinance);
  const player = data.player ? structuredClone(data.player) : null;
  if (player) {
    ensureTransferSave(player);
    if (data.seasonCheckpoint) player.seasonCheckpoint = data.seasonCheckpoint;
  }
  return { player, world, seasonCheckpoint: data.seasonCheckpoint || null };
}

/** Lightweight JSON round-trip helper for tests. */
export function roundTripCareerSnapshot(args) {
  const json = JSON.stringify(serializeCareerSnapshot(args));
  return deserializeCareerSnapshot(JSON.parse(json));
}
