/**
 * Shared helpers for Fix 03 membership tests — commit real fixtures for a
 * forced table order, then run production finalization.
 */
import assert from "node:assert/strict";
import { LEAGUES, LEAGUE_BY_ID } from "../../js/data/leagues.js";
import {
  pairPolicyForLeague,
  resolveLeagueClubIds,
  commitForcedEditionResults,
  finalizeMembershipAfterSeason,
  leagueIdOf,
} from "../../js/simulation/leagueMembership.js";

export function orderWithClubAt(clubIds, clubId, position) {
  const others = clubIds.filter((id) => id !== clubId);
  assert.ok(others.length === clubIds.length - 1, "club must be in roster");
  assert.ok(position >= 1 && position <= clubIds.length);
  const ordered = [];
  let oi = 0;
  for (let pos = 1; pos <= clubIds.length; pos++) {
    ordered.push(pos === position ? clubId : others[oi++]);
  }
  return ordered;
}

/**
 * Force both divisions of a modeled pair to complete with committed fixtures,
 * placing `clubId` at `position` in `league`, then finalize the pair.
 */
export function controlledPairFinalize({
  player,
  league,
  position,
  world,
  seasonYear = 2026,
  clubId = null,
}) {
  const id = clubId || player?.club?.clubId || player?.playingClubId;
  assert.ok(id, "clubId required");
  const policy = pairPolicyForLeague(leagueIdOf(league));
  assert.ok(policy, "modeled pair required");
  const upper = LEAGUE_BY_ID.get(policy.upperId);
  const lower = LEAGUE_BY_ID.get(policy.lowerId);
  const focusIds = resolveLeagueClubIds(leagueIdOf(league), { world, seasonYear: null });
  const orderedFocus = orderWithClubAt(focusIds, id, position);
  const forcedFocus = commitForcedEditionResults(league, seasonYear, orderedFocus, world);
  assert.equal(forcedFocus.ok, true, String(forcedFocus.reason));

  const sister = policy.role === "upper" ? lower : upper;
  const sisterIds = resolveLeagueClubIds(leagueIdOf(sister), { world, seasonYear: null });
  const forcedSister = commitForcedEditionResults(sister, seasonYear, sisterIds, world);
  assert.equal(forcedSister.ok, true, String(forcedSister.reason));

  return finalizeMembershipAfterSeason({
    player,
    completedLeague: league,
    completedTable: null,
    completedSeasonYear: seasonYear,
    allLeagues: LEAGUES,
    world,
    completedClubId: id,
  });
}
