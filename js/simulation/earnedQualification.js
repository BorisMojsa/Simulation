/**
 * Fix 09 — earned continental qualification by club and domestic/continental edition.
 *
 * Club+edition evidence on world.qualification is authoritative. Player latestStanding
 * may supply evidence only when club, source league, source edition, completion and
 * timing can be established. OVR bands are not an entry path.
 */

import { LEAGUES } from "../data/leagues.js";
import {
  ASSOCIATION_IDS,
  AFC_ASSOCIATION_SLOTS,
  AFC_TOP_FLIGHT_LEAGUE_IDS,
  CAF_ASSOCIATION_SLOTS,
  CAF_TOP_FLIGHT_LEAGUE_IDS,
  UEFA_ASSOCIATION_SLOTS,
  UEFA_TOP_FLIGHT_LEAGUE_IDS,
  associationIdForNation,
  continentalCompetitionForStanding as competitionFromStandingRaw,
  isUefaQualifyingLeague,
  leagueIdFromName,
  uefaSlotsForLeague,
} from "../data/competitions/qualification.js";
import { findSisterLeagues, qualificationForPosition } from "./leaguePhase.js";
import { createStreamRng } from "./rng.js";
import { attachClubIdentity, getWorldState } from "./worldState.js";
import { simulateMatch } from "./matchEngine.js";
import { flattenRoundRobinFixtures } from "./seasonCalendar.js?v=89";
import { competitionIdSlug } from "./continentalSchedule.js";
import { effectiveTeamStrength } from "./teamStrength.js";

export const EARNED_QUALIFICATION_RULE_VERSION = "fix09-v1";
export const EARNED_QUALIFICATION_SCHEMA_VERSION = 1;

/** Domestic source year that feeds continental target year T. */
export function sourceYearForContinentalTarget(targetYear) {
  const y = Number(targetYear);
  if (!Number.isFinite(y)) return null;
  return y - 1;
}

export function domesticEditionKey(leagueId, sourceYear) {
  return `domestic:${leagueId}::${sourceYear}`;
}

export function clubDecisionKey(clubId, targetYear) {
  return `club:${clubId}::target:${targetYear}`;
}

/**
 * Strict finish rank: positive finite integer within optional table size.
 * Accepts numeric strings only via explicit normalize (legacy).
 */
export function normalizeFinishPosition(value, { tableSize = null, allowLegacyString = true } = {}) {
  if (value == null || value === "") return { ok: false, reason: "missing" };
  let n;
  if (typeof value === "number") {
    n = value;
  } else if (allowLegacyString && typeof value === "string" && /^\s*\d+\s*$/.test(value)) {
    n = Number(value.trim());
  } else {
    return { ok: false, reason: "non-numeric" };
  }
  if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, reason: "non-integer" };
  if (n <= 0) return { ok: false, reason: "non-positive" };
  if (tableSize != null && Number.isFinite(tableSize) && n > tableSize) {
    return { ok: false, reason: "out-of-table" };
  }
  return { ok: true, position: n };
}

export function isContinentalFeederLeague(league) {
  if (!league) return false;
  const id = league.leagueId || leagueIdFromName(league.name);
  const level = league.divisionLevel ?? 1;
  if (level !== 1) return false;
  if (UEFA_TOP_FLIGHT_LEAGUE_IDS.has(id)) return true;
  if (AFC_TOP_FLIGHT_LEAGUE_IDS.has(id)) return true;
  if (CAF_TOP_FLIGHT_LEAGUE_IDS.has(id)) return true;
  const nation = league.nation;
  if (["Brazil", "Argentina", "Colombia", "Ecuador"].includes(nation)) return true;
  if (["Mexico", "United States"].includes(nation)) return true;
  return false;
}

/** Validated competition choice from a finish — rejects invalid ranks. */
export function competitionForValidatedFinish(standing, league, { tableSize = null } = {}) {
  if (!standing || !league) return null;
  if (!isContinentalFeederLeague(league)) return null;
  const norm = normalizeFinishPosition(standing.position, {
    tableSize: tableSize ?? standing.tableSize ?? null,
  });
  if (!norm.ok) return null;
  const label = standing.qualification;
  // Stale/conflicting labels cannot override a verified out-of-band position.
  const probe = {
    position: norm.position,
    qualification:
      typeof label === "string" && label && !isConflictingLabel(label, norm.position, league)
        ? label
        : null,
  };
  return competitionFromStandingRaw(probe, league);
}

function isConflictingLabel(label, position, league) {
  const fromPos = qualificationForPosition(position, league, findSisterLeagues(league, LEAGUES));
  if (!fromPos) {
    // Mid-table: continental labels are always conflicting.
    return (
      label === "League Champions" ||
      label === "Champions League" ||
      label === "Europa League" ||
      label === "Conference League" ||
      label === "Copa Libertadores" ||
      label === "Copa Sudamericana" ||
      label === "CONCACAF Champions Cup" ||
      label === "AFC Champions League Elite" ||
      label === "CAF Champions League"
    );
  }
  if (label === fromPos) return false;
  // League Champions and Champions League both mean CL for position 1.
  if (
    position === 1 &&
    ((label === "League Champions" && fromPos === "League Champions") ||
      (label === "Champions League" && fromPos === "League Champions") ||
      (label === "League Champions" && fromPos === "Champions League"))
  ) {
    return false;
  }
  // If position-derived continental competition matches label competition, allow.
  const byLabel = competitionFromStandingRaw({ position, qualification: label }, league);
  const byPos = competitionFromStandingRaw({ position, qualification: null }, league);
  return Boolean(byLabel && byPos && byLabel !== byPos);
}

function ensureQualificationMaps(world) {
  if (!world) return null;
  if (!(world.qualification instanceof Map)) {
    world.qualification = new Map(world.qualification || []);
  }
  return world.qualification;
}

export function getDomesticEditionRecord(world, leagueId, sourceYear) {
  const map = ensureQualificationMaps(world);
  if (!map || !leagueId || sourceYear == null) return null;
  return map.get(domesticEditionKey(leagueId, sourceYear)) || null;
}

export function getClubTargetDecision(world, clubId, targetYear) {
  const map = ensureQualificationMaps(world);
  if (!map || !clubId || targetYear == null) return null;
  const pointer = map.get(clubDecisionKey(clubId, targetYear));
  if (!pointer?.domesticKey) return null;
  const edition = map.get(pointer.domesticKey);
  if (!edition?.completed || !edition?.entries?.[clubId]) return null;
  return {
    edition,
    entry: edition.entries[clubId],
    pointer,
  };
}

function slimRow(row) {
  return {
    clubId: row.clubId || null,
    name: row.name || null,
    displayName: row.displayName ?? row.name ?? null,
    position: row.position,
    points: row.points ?? 0,
    wins: row.wins ?? 0,
    draws: row.draws ?? 0,
    losses: row.losses ?? 0,
    goalsFor: row.goalsFor ?? 0,
    goalsAgainst: row.goalsAgainst ?? 0,
    goalDiff: row.goalDiff ?? (row.goalsFor || 0) - (row.goalsAgainst || 0),
    matches: row.matches ?? row.played ?? 0,
    qualification: row.qualification ?? "",
    strength: row.strength ?? row.overall ?? null,
  };
}

function buildEntriesFromTable(table, league, {
  provenance,
  sourceEditionYear,
  targetContinentalYear,
}) {
  const sisters = findSisterLeagues(league, LEAGUES);
  const entries = {};
  const size = table.length;
  for (const raw of table) {
    const row = slimRow(raw);
    if (!row.clubId) continue;
    const norm = normalizeFinishPosition(row.position, { tableSize: size });
    if (!norm.ok) continue;
    row.position = norm.position;
    if (!row.qualification) {
      row.qualification = qualificationForPosition(norm.position, league, sisters) || "";
    }
    const competition = competitionForValidatedFinish(row, league, { tableSize: size });
    entries[row.clubId] = {
      clubId: row.clubId,
      name: row.name,
      position: norm.position,
      qualificationLabel: row.qualification || "",
      competition: competition || null,
      status: competition ? "qualified" : "not-qualified",
      targetCompetitionId: competition ? competitionIdSlug(competition) : null,
      targetContinentalYear,
      sourceEditionYear,
      provenance,
      ruleVersion: EARNED_QUALIFICATION_RULE_VERSION,
    };
  }
  return entries;
}

/**
 * Persist a completed (or bootstrap) domestic table once under stable edition keys.
 * Repeated commits with the same key are no-ops unless forceReplace is set.
 */
export function commitCompletedDomesticEdition({
  world = getWorldState(),
  league,
  table,
  sourceYear,
  provenance = "simulated-complete",
  status = "complete",
  matchEvidenceIds = null,
  forceReplace = false,
} = {}) {
  if (!world || !league || !Array.isArray(table) || !table.length) {
    return { ok: false, reason: "missing-inputs" };
  }
  if (status === "complete" && provenance === "simulated-complete") {
    // Partial / mid-season tables must not be labeled complete elsewhere.
  }
  const leagueId = league.leagueId || leagueIdFromName(league.name);
  const sourceEditionYear = Number(sourceYear);
  if (!Number.isFinite(sourceEditionYear)) return { ok: false, reason: "bad-source-year" };
  const map = ensureQualificationMaps(world);
  const key = domesticEditionKey(leagueId, sourceEditionYear);
  if (map.has(key) && !forceReplace) {
    return { ok: true, reused: true, key, record: map.get(key) };
  }

  const targetContinentalYear = sourceEditionYear + 1;
  const slimTable = table.map(slimRow);
  const entries = buildEntriesFromTable(slimTable, league, {
    provenance,
    sourceEditionYear,
    targetContinentalYear,
  });

  const record = {
    schemaVersion: EARNED_QUALIFICATION_SCHEMA_VERSION,
    ruleVersion: EARNED_QUALIFICATION_RULE_VERSION,
    key,
    leagueId,
    leagueName: league.name,
    leagueDisplay: league.displayName ?? league.name,
    nation: league.nation,
    associationId: associationIdForNation(league.nation),
    sourceCompetitionId: leagueId,
    sourceEditionId: `${leagueId}::${sourceEditionYear}`,
    sourceEditionYear,
    targetContinentalYear,
    status,
    provenance,
    completed: status === "complete" || status === "bootstrap",
    table: slimTable,
    entries,
    matchEvidenceIds: Array.isArray(matchEvidenceIds) ? [...matchEvidenceIds] : [],
    feeder: isContinentalFeederLeague(league),
  };

  map.set(key, record);
  // Club target pointers only for completed/bootstrap editions — partials must not qualify.
  if (record.completed) {
    for (const clubId of Object.keys(entries)) {
      map.set(clubDecisionKey(clubId, targetContinentalYear), {
        domesticKey: key,
        clubId,
        targetContinentalYear,
        sourceEditionYear,
      });
    }
  }
  return { ok: true, reused: false, key, record };
}

function sortTableRows(rows) {
  return [...rows]
    .map((r) => ({
      ...r,
      goalDiff: (r.goalsFor || 0) - (r.goalsAgainst || 0),
      matches: r.played ?? r.matches ?? 0,
    }))
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.goalDiff - a.goalDiff ||
        b.goalsFor - a.goalsFor ||
        (b.strength || 0) - (a.strength || 0) ||
        String(a.clubId || a.name).localeCompare(String(b.clubId || b.name))
    )
    .map((row, idx) => ({ ...row, position: idx + 1 }));
}

/**
 * Bounded player-free double round-robin for missing prior-season evidence.
 * Uses an isolated stream so career match RNG is not consumed by lookups.
 */
export function simulateBootstrapDomesticTable(league, { world = getWorldState(), sourceYear, streamSeed } = {}) {
  const clubs = (league.clubs || []).map((c) =>
    attachClubIdentity({
      ...c,
      tier: league.tier,
      league: league.name,
      leagueId: league.leagueId,
      nation: league.nation,
    })
  );
  if (clubs.length < 2) return null;
  const leagueId = league.leagueId || leagueIdFromName(league.name);
  const rng = createStreamRng(
    String(streamSeed ?? world?.rngSeed ?? "bootstrap"),
    `fix09-bootstrap:${leagueId}:${sourceYear}`
  );
  const fixtures = flattenRoundRobinFixtures(clubs, {
    idPrefix: `bootstrap:${leagueId}:${sourceYear}`,
  });
  const records = new Map();
  for (const c of clubs) {
    const eff = effectiveTeamStrength(c, { worldState: world });
    records.set(c.clubId || c.name, {
      name: c.name,
      displayName: c.displayName ?? c.name,
      clubId: c.clubId,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      points: 0,
      strength: eff.overall,
      overall: eff.overall,
    });
  }
  const matchIds = [];
  for (const fx of fixtures) {
    const home = fx.home;
    const away = fx.away;
    const match = simulateMatch(home, away, { rng, worldState: world });
    const hg = match.homeGoals ?? 0;
    const ag = match.awayGoals ?? 0;
    const hr = records.get(home.clubId || home.name);
    const ar = records.get(away.clubId || away.name);
    hr.played += 1;
    ar.played += 1;
    hr.goalsFor += hg;
    hr.goalsAgainst += ag;
    ar.goalsFor += ag;
    ar.goalsAgainst += hg;
    if (hg > ag) {
      hr.wins += 1;
      hr.points += 3;
      ar.losses += 1;
    } else if (ag > hg) {
      ar.wins += 1;
      ar.points += 3;
      hr.losses += 1;
    } else {
      hr.draws += 1;
      ar.draws += 1;
      hr.points += 1;
      ar.points += 1;
    }
    if (match.matchId || fx.id) matchIds.push(match.matchId || fx.id);
  }
  const table = sortTableRows([...records.values()]);
  const sisters = findSisterLeagues(league, LEAGUES);
  for (const row of table) {
    row.qualification = qualificationForPosition(row.position, league, sisters) || "";
    row.matches = row.played;
  }
  return { table, matchEvidenceIds: matchIds };
}

/**
 * Ensure a deterministic bootstrap domestic edition exists for target continental year.
 * Idempotent: same world/seed/edition → same decisions.
 */
export function ensureBootstrapDomesticEdition({
  world = getWorldState(),
  league,
  targetYear,
  streamSeed = null,
} = {}) {
  if (!world || !league || !isContinentalFeederLeague(league)) {
    return { ok: false, reason: "not-feeder" };
  }
  const sourceYear = sourceYearForContinentalTarget(targetYear);
  const leagueId = league.leagueId || leagueIdFromName(league.name);
  const existing = getDomesticEditionRecord(world, leagueId, sourceYear);
  if (existing?.completed) {
    return { ok: true, reused: true, record: existing };
  }
  const sim = simulateBootstrapDomesticTable(league, {
    world,
    sourceYear,
    streamSeed: streamSeed ?? world.rngSeed,
  });
  if (!sim?.table?.length) return { ok: false, reason: "bootstrap-failed" };
  return commitCompletedDomesticEdition({
    world,
    league,
    table: sim.table,
    sourceYear,
    provenance: "bootstrap-synthetic",
    status: "bootstrap",
    matchEvidenceIds: sim.matchEvidenceIds,
  });
}

/**
 * Migrate an unambiguous latestStanding / constructed table into the registry.
 * Rejects incomplete or wrong-club claims rather than attaching them to today's club.
 */
export function ingestStandingEvidence({
  world = getWorldState(),
  league,
  table,
  sourceYear,
  provenance = "legacy-migrated",
  requireComplete = true,
} = {}) {
  if (!world || !league || !Array.isArray(table) || !table.length) {
    return { ok: false, reason: "missing" };
  }
  const expectedClubs = new Set((league.clubs || []).map((c) => c.clubId).filter(Boolean));
  const rowIds = table.map((r) => r.clubId).filter(Boolean);
  if (requireComplete && expectedClubs.size && rowIds.length < Math.min(expectedClubs.size, table.length)) {
    // Allow constructed full tables that are self-consistent even if smaller than live roster
    // when every row has clubId and unique positions.
  }
  const positions = table.map((r) => r.position);
  const norms = positions.map((p) => normalizeFinishPosition(p, { tableSize: table.length }));
  if (norms.some((n) => !n.ok)) return { ok: false, reason: "invalid-positions" };
  const uniqueClubs = new Set(rowIds);
  if (uniqueClubs.size !== rowIds.length) return { ok: false, reason: "duplicate-club" };
  return commitCompletedDomesticEdition({
    world,
    league,
    table,
    sourceYear,
    provenance,
    status: "complete",
  });
}

function playingClubIdOf(player) {
  return (
    player?.playingClubId ||
    player?.club?.clubId ||
    null
  );
}

function inferSourceYearFromLatestStanding(latest, targetYear) {
  if (!latest) return sourceYearForContinentalTarget(targetYear);
  if (Number.isFinite(Number(latest.sourceEditionYear))) return Number(latest.sourceEditionYear);
  if (typeof latest.seasonId === "string") {
    const m = latest.seasonId.match(/::(\d{4})\b/);
    if (m) return Number(m[1]);
  }
  // seasonNumber N with career start S ≈ calendar S+N-1 for completed period.
  if (Number.isFinite(Number(latest.seasonNumber)) && Number.isFinite(Number(latest.careerStartYear))) {
    return Number(latest.careerStartYear) + Number(latest.seasonNumber) - 1;
  }
  return sourceYearForContinentalTarget(targetYear);
}

/**
 * Resolve continental entry for a club into target continental year.
 * Precedence: frozen registry decision > ingestable complete evidence > bootstrap (feeder only)
 * > unresolved (null entry, never OVR).
 */
export function resolveClubContinentalEntry({
  world = getWorldState(),
  clubId,
  league,
  targetYear,
  player = null,
  allowBootstrap = true,
  standingEvidence = null,
} = {}) {
  const target = Number(targetYear);
  if (!clubId || !league || !Number.isFinite(target)) {
    return {
      status: "unresolved",
      reason: "missing-identity",
      clubId: clubId || null,
      competition: null,
      standing: null,
    };
  }

  if (!isContinentalFeederLeague(league)) {
    return {
      status: "not-feeder",
      reason: "league-not-feeder",
      clubId,
      competition: null,
      standing: null,
    };
  }

  const sourceYear = sourceYearForContinentalTarget(target);
  const leagueId = league.leagueId || leagueIdFromName(league.name);

  // 1) Authoritative registry decision for this club/target.
  let decided = getClubTargetDecision(world, clubId, target);
  if (decided?.entry) {
    // Guard: decision must belong to this association/league source when available.
    if (
      !decided.edition?.leagueId ||
      decided.edition.leagueId === leagueId ||
      decided.edition.associationId === associationIdForNation(league.nation)
    ) {
      return decisionToResult(decided, clubId, league, target);
    }
  }

  // 2) Domestic edition for this league/source exists — club missing ⇒ not-qualified / unresolved.
  let edition = getDomesticEditionRecord(world, leagueId, sourceYear);
  if (edition?.completed) {
    const entry = edition.entries?.[clubId];
    if (entry) {
      ensureQualificationMaps(world).set(clubDecisionKey(clubId, target), {
        domesticKey: edition.key,
        clubId,
        targetContinentalYear: target,
        sourceEditionYear: sourceYear,
      });
      return decisionToResult({ edition, entry }, clubId, league, target);
    }
    return {
      status: "unresolved",
      reason: "club-absent-from-complete-table",
      clubId,
      competition: null,
      standing: null,
      edition,
      provenance: edition.provenance,
    };
  }

  // 3) Ingest explicit standing evidence (tests / legacy full tables).
  const evidence = standingEvidence || maybeEvidenceFromPlayer(player, league, clubId, sourceYear, target);
  if (evidence?.table?.length) {
    const ingested = ingestStandingEvidence({
      world,
      league: evidence.league || league,
      table: evidence.table,
      sourceYear: evidence.sourceYear ?? sourceYear,
      provenance: evidence.provenance || "legacy-migrated",
    });
    if (ingested.ok) {
      decided = getClubTargetDecision(world, clubId, target);
      if (decided?.entry) return decisionToResult(decided, clubId, league, target);
      return {
        status: "unresolved",
        reason: "club-absent-from-ingested-table",
        clubId,
        competition: null,
        standing: null,
      };
    }
  }

  // 4) Bootstrap once for first-career / missing prior edition.
  if (allowBootstrap) {
    const boot = ensureBootstrapDomesticEdition({ world, league, targetYear: target });
    if (boot.ok) {
      decided = getClubTargetDecision(world, clubId, target);
      if (decided?.entry) return decisionToResult(decided, clubId, league, target);
      return {
        status: "unresolved",
        reason: "club-absent-from-bootstrap",
        clubId,
        competition: null,
        standing: null,
        provenance: "bootstrap-synthetic",
      };
    }
  }

  return {
    status: "unresolved",
    reason: "missing-evidence",
    clubId,
    competition: null,
    standing: null,
  };
}

function maybeEvidenceFromPlayer(player, league, clubId, sourceYear, targetYear) {
  const latest = player?.latestStanding;
  if (!latest?.table?.length) return null;
  const latestLeagueId =
    latest.leagueId || latest.league?.leagueId || latest.playerRow?.leagueId || null;
  const currentLeagueId = league?.leagueId || leagueIdFromName(league?.name);
  if (latestLeagueId && currentLeagueId && latestLeagueId !== currentLeagueId) return null;
  // Only ingest when the destination club has a row — never promote playerRow from another club.
  const destRow = latest.table.find((r) => r.clubId === clubId);
  if (!destRow) return null;
  const inferredYear = inferSourceYearFromLatestStanding(
    { ...latest, careerStartYear: player?.startYear },
    targetYear
  );
  if (inferredYear !== sourceYear) return null;
  // Require a full-looking table (unique clubIds, valid positions).
  const ids = latest.table.map((r) => r.clubId).filter(Boolean);
  if (ids.length < 2) return null;
  return {
    table: latest.table,
    sourceYear: inferredYear,
    league,
    provenance: "legacy-migrated",
  };
}

function decisionToResult(decided, clubId, league, targetYear) {
  const { entry, edition } = decided;
  const competition = entry.competition || null;
  const standing = {
    position: entry.position,
    points: edition.table?.find((r) => r.clubId === clubId)?.points || 0,
    qualification:
      entry.qualificationLabel ||
      (competition === "Champions League" && entry.position === 1
        ? "League Champions"
        : competition || ""),
    divisionMove: null,
    record: (() => {
      const row = edition.table?.find((r) => r.clubId === clubId);
      return {
        wins: row?.wins || 0,
        draws: row?.draws || 0,
        losses: row?.losses || 0,
      };
    })(),
    matches: edition.table?.find((r) => r.clubId === clubId)?.matches || 0,
    goalDiff: edition.table?.find((r) => r.clubId === clubId)?.goalDiff || 0,
    strength: edition.table?.find((r) => r.clubId === clubId)?.strength || 70,
    table: edition.table,
    clubId,
    sourceEditionYear: edition.sourceEditionYear,
    sourceEditionId: edition.sourceEditionId,
    targetContinentalYear: targetYear,
    provenance: entry.provenance || edition.provenance,
    earnedStatus: entry.status,
    competition,
  };
  return {
    status: entry.status,
    reason: entry.status === "qualified" ? "earned" : "earned-non-qualifier",
    clubId,
    competition,
    standing: entry.status === "qualified" ? standing : { ...standing, competition: null },
    edition,
    entry,
    provenance: entry.provenance || edition.provenance,
  };
}

/**
 * Standing object for prepareContinentalEdition — qualified clubs only.
 * Never invents OVR positions.
 */
export function resolvePreSeasonContinentalStanding(player, league, {
  world = getWorldState(),
  seasonYear = null,
  allowBootstrap = true,
} = {}) {
  const targetYear =
    Number(seasonYear) ||
    Number(world?.seasonYear) ||
    (Number(player?.startYear) || 2026) + (player?.seasons?.length || 0);
  const clubId = playingClubIdOf(player);
  if (!clubId || !league) return null;

  const resolved = resolveClubContinentalEntry({
    world,
    clubId,
    league,
    targetYear,
    player,
    allowBootstrap,
  });

  if (resolved.status === "qualified" && resolved.standing) {
    return resolved.standing;
  }
  return null;
}

/** Clubs with earned places into a named competition for target year (from registry). */
export function earnedClubsForCompetition(world, competitionName, targetYear, { confederation = null } = {}) {
  const map = ensureQualificationMaps(world);
  if (!map) return [];
  const out = [];
  for (const [key, record] of map.entries()) {
    if (!key.startsWith("domestic:")) continue;
    if (!record?.completed || !record.entries) continue;
    if (Number(record.targetContinentalYear) !== Number(targetYear)) continue;
    for (const entry of Object.values(record.entries)) {
      if (entry.status !== "qualified") continue;
      if (entry.competition !== competitionName) continue;
      out.push({
        ...entry,
        leagueId: record.leagueId,
        nation: record.nation,
        provenance: entry.provenance || record.provenance,
        entryRoute: "earned",
      });
    }
  }
  return out;
}

export function markSyntheticFieldClub(club, reason = "inventory-fill") {
  return {
    ...club,
    entryRoute: "synthetic-fill",
    entryProvenance: reason,
  };
}

export {
  ASSOCIATION_IDS,
  UEFA_ASSOCIATION_SLOTS,
  uefaSlotsForLeague,
  isUefaQualifyingLeague,
  competitionFromStandingRaw,
  playingClubIdOf,
};
