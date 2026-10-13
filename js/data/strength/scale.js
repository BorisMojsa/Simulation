/**
 * Rating scale conversions (frozen parameters — transformVersion team-quality-v3).
 *
 * ClubElo display Elo: globally comparable club strength (typically ~1100–2100 here).
 * FootballDatabase points: secondary club scale; converted to ClubElo before this mapping.
 * FIFA men's ranking points: national teams (~900–2050).
 * Player OVR: individual ability on ~40–99 (game-internal).
 *
 * These are different scales. Do not equate ClubElo, national Elo, FIFA points, or player OVR.
 * Coefficients mirror js/data/strength/config/transform.json.
 */

import { clamp } from "../../utils/helpers.js";

export const TRANSFORM_VERSION = "team-quality-v3";

const CLUB_ELO_INTERCEPT = -25.072478739035574;
const CLUB_ELO_SLOPE = 0.05800792555323033;

/** ClubElo (primary club scale) → internal team quality used by the match model. */
export function clubEloToTeamQuality(elo) {
  return clamp(Number((CLUB_ELO_INTERCEPT + CLUB_ELO_SLOPE * Number(elo)).toFixed(2)), 30, 94);
}

/** @deprecated Legacy Opta mapping for archived snapshots only. */
export function optaLikeToTeamQuality(opta) {
  return clamp(Number((Number(opta) * 0.88 + 2).toFixed(2)), 30, 94);
}

/** FIFA ranking points → internal national team quality. */
export function fifaPointsToTeamQuality(points) {
  const p = Number(points);
  if (!Number.isFinite(p)) {
    throw new Error(`fifaPointsToTeamQuality requires finite points, got ${points}`);
  }
  return clamp(Number((28 + (p - 800) * 0.055).toFixed(2)), 40, 93);
}

export function tierLabelFromQuality(overall) {
  if (overall >= 88) return "Elite";
  if (overall >= 80) return "Strong";
  if (overall >= 70) return "Competitive";
  if (overall >= 60) return "Average";
  return "Developing";
}

export const SCALE_NOTES = {
  clubElo: "Published ClubElo display Elo observations. Raw integers stored unchanged for primary clubs.",
  footballDatabase:
    "Secondary published points; converted to ClubElo via fdb-to-clubelo-regularized-country-v1 before clubEloToTeamQuality.",
  opta: "Archived Opta Power Rankings observations (0–100). Not used for new-career club baselines after team-quality-v3.",
  fifa: "FIFA men's ranking points converted via fifaPointsToTeamQuality.",
  playerOvr: "Individual player overall; compared to replacementOvr for lineup impact only.",
  teamQuality: "Internal club/nation sporting quality driving expected goals.",
  history:
    "Verified starting ratings already embed historical match results via provider Elo-style methods. The game does not add a separate trophy/history match bonus.",
};
