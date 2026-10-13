/**
 * Safe overall for recruitment/valuation when attributes may be absent (tests / mid-migration).
 */
import { getCurrentOverall } from "./playerAbility.js";

export function safePlayerOverall(player) {
  if (!player) return 60;
  if (player.attributes && typeof player.attributes === "object") {
    try {
      const v = getCurrentOverall(player);
      if (Number.isFinite(v)) return v;
    } catch {
      /* fall through */
    }
  }
  if (Number.isFinite(player.currentOverallRaw)) return player.currentOverallRaw;
  if (Number.isFinite(player.rating)) return player.rating;
  return 60;
}
