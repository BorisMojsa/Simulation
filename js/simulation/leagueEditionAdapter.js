/**
 * Bounded adapter: persist domestic league results into the competition store
 * without owning full competition rules/calendars (those belong to the
 * competition prompt / competitionStore edition model).
 *
 * Interface expected from the competition service when available:
 * - editionKey(competitionId, editionId)
 * - createEdition / commitEdition for kind: "league"
 * - commitMatch({ matchId, competitionId, editionId, ...result })
 *
 * Until domestic editions are fully registered, the live dashboard treats
 * season.leagueAllMatches + rebuildTableFromMatches as the UI source of truth.
 */

import { commitMatch, createEdition, commitEdition, getEdition } from "./competitionStore.js";
import { ensureLeagueMatchId } from "./leagueTable.js";
import { getWorldState } from "./worldState.js";
import { resolveLeagueClubs } from "./leagueMembership.js";

export function ensureLeagueEdition(league, seasonYear, world = getWorldState()) {
  if (!league?.leagueId && !league?.name) return null;
  const competitionId = league.leagueId || league.name;
  const editionId = String(seasonYear ?? "unknown");
  let edition = getEdition(competitionId, editionId, world);
  if (edition) return edition;
  const clubs =
    league.clubs?.length && league._editionResolved
      ? league.clubs
      : resolveLeagueClubs(league, { world, seasonYear });
  edition = createEdition({
    competitionId,
    editionId,
    name: league.displayName || league.name || competitionId,
    ruleVersion: "league-table-v1",
    kind: "league",
    participants: (clubs || []).map((c) => ({
      clubId: c.clubId,
      name: c.name,
      displayName: c.displayName,
    })),
    stages: [{ stageId: "regular", name: "Regular season", type: "league" }],
    seasonYear: seasonYear ?? null,
  });
  commitEdition(edition, world);
  return edition;
}

/** Commit a played league match into the store (idempotent by matchId). */
export function commitLeagueMatchResult(match, league, seasonYear, world = getWorldState()) {
  if (!match) return null;
  ensureLeagueMatchId(match);
  const edition = ensureLeagueEdition(league, seasonYear, world);
  if (edition) {
    match.competitionId = match.competitionId || edition.competitionId;
    match.editionId = match.editionId || edition.editionId;
  }
  match.status = "played";
  return commitMatch(match, world);
}

export function commitLeagueMatchBatch(matches, league, seasonYear, world = getWorldState()) {
  const out = [];
  for (const m of matches || []) {
    out.push(commitLeagueMatchResult(m, league, seasonYear, world));
  }
  return out;
}
