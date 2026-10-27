/**
 * Canonical competition edition / match / tie store on world state.
 * UI and season summaries must read committed results — never re-simulate.
 */

import { getWorldState } from "./worldState.js";

function ensureEditions(world) {
  if (!world) return null;
  if (!(world.editions instanceof Map)) {
    world.editions = new Map(world.editions || []);
  }
  if (!(world.matches instanceof Map)) {
    world.matches = new Map(world.matches || []);
  }
  if (!(world.ties instanceof Map)) {
    world.ties = new Map(world.ties || []);
  }
  return world;
}

export function editionKey(competitionId, editionId) {
  return `${competitionId}::${editionId}`;
}

export function createEdition({
  competitionId,
  editionId,
  name,
  ruleVersion,
  kind,
  confederation = null,
  participants = [],
  stages = [],
  seasonYear = null,
}) {
  return {
    competitionId,
    editionId,
    name,
    ruleVersion,
    kind,
    confederation,
    participants: participants.map((p) => ({ ...p })),
    stages,
    currentStageId: stages[0]?.stageId || null,
    champion: null,
    seasonYear,
    status: "scheduled",
  };
}

export function commitEdition(edition, world = getWorldState()) {
  const w = ensureEditions(world);
  if (!w || !edition) return null;
  const key = editionKey(edition.competitionId, edition.editionId);
  w.editions.set(key, edition);
  if (w.cupResults) {
    w.cupResults.set(key, {
      competitionId: edition.competitionId,
      editionId: edition.editionId,
      name: edition.name,
      champion: edition.champion,
      status: edition.status,
    });
  }
  return edition;
}

export function getEdition(competitionId, editionId, world = getWorldState()) {
  const w = ensureEditions(world);
  if (!w) return null;
  return w.editions.get(editionKey(competitionId, editionId)) || null;
}

export function listEditions(world = getWorldState()) {
  const w = ensureEditions(world);
  if (!w) return [];
  return [...w.editions.values()];
}

function meaningfulResultFields(match) {
  return {
    homeGoals: match.matchHomeGoals ?? match.homeGoals,
    awayGoals: match.matchAwayGoals ?? match.awayGoals,
    homePenalties: match.homePenalties ?? null,
    awayPenalties: match.awayPenalties ?? null,
    winnerSide: match.winnerSide ?? null,
    homeParticipantId: match.homeParticipantId || match.home?.clubId || match.home?.name,
    awayParticipantId: match.awayParticipantId || match.away?.clubId || match.away?.name,
  };
}

/**
 * Commit a match result. Missing matchId returns null with a diagnostic.
 * An already-played fixture returns the original result (idempotent).
 * A conflicting score/identity write throws with structured detail.
 */
export function commitMatch(match, world = getWorldState()) {
  const w = ensureEditions(world);
  if (!w) return null;
  if (!match?.matchId) {
    const err = new Error("commitMatch: missing matchId");
    err.code = "MISSING_MATCH_ID";
    throw err;
  }
  const existing = w.matches.get(match.matchId);
  if (existing?.status === "played") {
    const a = meaningfulResultFields(existing);
    const b = meaningfulResultFields(match);
    const conflict =
      match.status === "played" &&
      (a.homeGoals !== b.homeGoals ||
        a.awayGoals !== b.awayGoals ||
        a.winnerSide !== b.winnerSide ||
        (b.homeGoals != null &&
          a.homeParticipantId &&
          b.homeParticipantId &&
          a.homeParticipantId !== b.homeParticipantId));
    if (conflict) {
      const err = new Error(`commitMatch conflict for ${match.matchId}`);
      err.code = "RESULT_CONFLICT";
      err.existing = a;
      err.incoming = b;
      throw err;
    }
    return existing;
  }
  const stored = {
    ...match,
    status: match.status || (match.homeGoals != null ? "played" : "scheduled"),
  };
  w.matches.set(match.matchId, stored);
  return stored;
}

export function getMatch(matchId, world = getWorldState()) {
  const w = ensureEditions(world);
  return w?.matches?.get(matchId) || null;
}

export function commitTie(tie, world = getWorldState()) {
  const w = ensureEditions(world);
  if (!w || !tie?.tieId) return null;
  w.ties.set(tie.tieId, { ...tie });
  return tie;
}

export function getTie(tieId, world = getWorldState()) {
  const w = ensureEditions(world);
  return w?.ties?.get(tieId) || null;
}

/** Serialize helpers for career snapshots. */
export function serializeCompetitionStore(world) {
  const w = ensureEditions(world);
  if (!w) return null;
  return {
    editions: [...w.editions.entries()],
    matches: [...w.matches.entries()],
    ties: [...w.ties.entries()],
  };
}

export function restoreCompetitionStore(world, data) {
  if (!world || !data) return world;
  world.editions = new Map(data.editions || []);
  world.matches = new Map(data.matches || []);
  world.ties = new Map(data.ties || []);
  return world;
}
