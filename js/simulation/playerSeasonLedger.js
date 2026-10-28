/**
 * Per-season player ledger: exact-once match observations and season aggregates.
 *
 * - Every match is recorded at most once, keyed by `matchId`.
 * - Non-participation (0 minutes: unused sub, injured, rested) is NOT an
 *   appearance; it is tracked separately as `nonParticipation` with structured
 *   detail when known. Legacy boolean markers (`true`) remain readable.
 * - A match performance observation compares the rating with the expected
 *   rating: z = clamp((rating - expected) / scale, -3, 3); obs = tanh(z / 1.5).
 * - Explicit null/undefined ratings stay unknown (no observation). `Number(null)`
 *   must never become rating 0 / z=-3 evidence.
 *
 * Normalized positive entry preserves fixture identity, represented side,
 * participation, output (incl. cleanSheet), and evidence provenance.
 *
 * matchRecord (input):
 *   { matchId, competitionType, competitionId?, editionId?, teamId?, stintId?,
 *     teamType?, opponentId?, isInternational?, minutes, started?, selected?,
 *     available?, nonParticipationReason?, goals?, assists?, yellowCards?,
 *     redCards?, cleanSheet?, cleanSheetEligible?, rating?, expectedRating?,
 *     residualScale?, position?, date?, injuryEventIds?, metricEvidence? }
 */
import { clamp } from "../utils/helpers.js";
import { PERFORMANCE } from "../config/playerDevelopmentConfig.js";
import { normalizePosition } from "./playerAbility.js";

/** Alias used by leagueFixtures / seasonSimulator. */
export function performanceObservationFromMatch(matchRating, expectedRating, residualScale) {
  const r = computePerformanceObservation(matchRating, expectedRating, residualScale);
  return r ? r.observation : null;
}

export function createEmptyLedger(seasonId) {
  return {
    seasonId: seasonId ?? null,
    matches: [],
    recordedMatchIds: {},
    nonParticipation: {},
  };
}

/** Residual scale for a position, falling back to the default. */
export function residualScaleFor(position) {
  const pos = normalizePosition(position).position;
  const group = PERFORMANCE.roleGroups[pos];
  return PERFORMANCE.residualScale[group] ?? PERFORMANCE.residualScale.default;
}

/**
 * Performance observation in (-1, 1): tanh(z / 1.5) with z clamped to ±3.
 * @returns {{z:number, observation:number}|null} null when the rating is unavailable
 */
export function computePerformanceObservation(rating, expectedRating, scale) {
  // null/undefined/"" must stay unknown — Number(null)===0 is not a real rating.
  if (rating === null || rating === undefined || rating === "") return null;
  if (!Number.isFinite(Number(rating))) return null;
  const expected = Number.isFinite(expectedRating) ? expectedRating : PERFORMANCE.defaultExpectedRating;
  const s = scale > 0 ? scale : PERFORMANCE.residualScale.default;
  const z = clamp((Number(rating) - expected) / s, -PERFORMANCE.zClamp, PERFORMANCE.zClamp);
  return { z, observation: Math.tanh(z / PERFORMANCE.tanhDivisor) };
}

function isInternationalRecord(rec) {
  return Boolean(rec.isInternational) || PERFORMANCE.internationalTypes.includes(rec.competitionType);
}

function coerceFiniteOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function buildNonParticipationDetail(matchRecord) {
  return {
    matchId: String(matchRecord.matchId),
    date: matchRecord.date ?? null,
    competitionType: matchRecord.competitionType || null,
    competitionId: matchRecord.competitionId ?? null,
    editionId: matchRecord.editionId ?? matchRecord.competitionEditionId ?? null,
    competitionEditionId: matchRecord.competitionEditionId ?? matchRecord.editionId ?? null,
    teamType: matchRecord.teamType ?? null,
    teamId: matchRecord.teamId ?? null,
    stintId: matchRecord.stintId ?? null,
    opponentId: matchRecord.opponentId ?? null,
    selected: matchRecord.selected != null ? Boolean(matchRecord.selected) : null,
    started: false,
    available: matchRecord.available != null ? Boolean(matchRecord.available) : null,
    minutes: 0,
    reason: matchRecord.nonParticipationReason || matchRecord.reason || "unknown",
    position: matchRecord.positionPlayed || matchRecord.position || null,
    injuryEventIds: Array.isArray(matchRecord.injuryEventIds) ? [...matchRecord.injuryEventIds] : [],
  };
}

/**
 * Record a match once. Duplicates (same matchId) are ignored — including when
 * the first record was a zero-minute non-participation (and across snapshot RT).
 * @returns {{recorded:boolean, duplicate:boolean, reason?:string, entry?:object}}
 */
export function recordMatchObservation(ledger, matchRecord) {
  if (!ledger || !matchRecord) throw new TypeError("recordMatchObservation requires a ledger and a match record");
  const id = matchRecord.matchId;
  if (id === undefined || id === null || id === "") throw new TypeError("matchRecord.matchId is required");
  const key = String(id);
  if (ledger.recordedMatchIds[key] || ledger.nonParticipation[key]) {
    return { recorded: false, duplicate: true, reason: "duplicate" };
  }
  const minutes = Number(matchRecord.minutes);
  if (!(minutes > 0)) {
    // Structured zero-minute record; legacy consumers still see a truthy marker.
    ledger.nonParticipation[key] = buildNonParticipationDetail(matchRecord);
    return { recorded: false, duplicate: false, reason: "no-participation", entry: ledger.nonParticipation[key] };
  }

  const scale = matchRecord.residualScale > 0 ? matchRecord.residualScale : residualScaleFor(matchRecord.position);
  const rawRating = matchRecord.rating ?? matchRecord.matchRating;
  const perf = computePerformanceObservation(rawRating, matchRecord.expectedRating, scale);
  const cleanSheet =
    typeof matchRecord.cleanSheet === "boolean" ? matchRecord.cleanSheet : null;
  const entry = {
    matchId: key,
    competitionType: matchRecord.competitionType || "league",
    competitionId: matchRecord.competitionId ?? null,
    teamType: matchRecord.teamType ?? null,
    teamId: matchRecord.teamId ?? null,
    stintId: matchRecord.stintId ?? null,
    opponentId: matchRecord.opponentId ?? null,
    editionId: matchRecord.editionId ?? matchRecord.competitionEditionId ?? null,
    competitionEditionId: matchRecord.competitionEditionId ?? matchRecord.editionId ?? null,
    international: isInternationalRecord(matchRecord),
    minutes: Math.min(minutes, 150),
    availableMinutes: coerceFiniteOrNull(matchRecord.availableMinutes ?? matchRecord.matchDuration),
    selected: Boolean(matchRecord.selected ?? true),
    started: Boolean(matchRecord.started),
    available: matchRecord.available != null ? Boolean(matchRecord.available) : true,
    nonParticipationReason: null,
    goals: Math.max(0, Number(matchRecord.goals) || 0),
    assists: Math.max(0, Number(matchRecord.assists) || 0),
    yellowCards: Math.max(0, Number(matchRecord.yellowCards ?? matchRecord.yellow) || 0),
    redCards: Math.max(0, Number(matchRecord.redCards ?? matchRecord.red) || 0),
    cleanSheetEligible:
      typeof matchRecord.cleanSheetEligible === "boolean" ? matchRecord.cleanSheetEligible : null,
    cleanSheet,
    rating: perf ? Number(rawRating) : null,
    expectedRating: coerceFiniteOrNull(matchRecord.expectedRating),
    residualScale: scale,
    z: perf ? perf.z : null,
    observation: perf ? perf.observation : null,
    position: matchRecord.positionPlayed || matchRecord.position || null,
    positionPlayed: matchRecord.positionPlayed || matchRecord.position || null,
    date: matchRecord.date ?? null,
    injuryEventIds: Array.isArray(matchRecord.injuryEventIds) ? [...matchRecord.injuryEventIds] : [],
    metricEvidence: matchRecord.metricEvidence ?? null,
  };
  ledger.matches.push(entry);
  ledger.recordedMatchIds[key] = true;
  return { recorded: true, duplicate: false, entry };
}

function emptyBucket() {
  return { minutes: 0, apps: 0, starts: 0, goals: 0, assists: 0 };
}

function addToBucket(b, e) {
  b.minutes += e.minutes;
  b.apps += 1;
  b.starts += e.started ? 1 : 0;
  b.goals += e.goals;
  b.assists += e.assists;
}

function summarizeNonParticipation(nonParticipation) {
  const reasons = {
    unused_substitute: 0,
    unused: 0,
    not_selected: 0,
    injured: 0,
    unavailable: 0,
    suspended: 0,
    rested: 0,
    unknown: 0,
    other: 0,
  };
  let total = 0;
  for (const v of Object.values(nonParticipation || {})) {
    total += 1;
    if (v === true) {
      reasons.unknown += 1;
      continue;
    }
    const reason = String(v?.reason || "unknown");
    if (reason === "unused_substitute" || reason === "unused" || reason === "bench") {
      reasons.unused_substitute += 1;
      reasons.unused += 1;
    } else if (Object.prototype.hasOwnProperty.call(reasons, reason)) {
      reasons[reason] += 1;
    } else {
      reasons.other += 1;
    }
  }
  return {
    total,
    // Compat: previous shape exposed only `unused` (= total count). Keep total under
    // unused for old consumers, and expose accurate reason breakdown alongside.
    unused: total,
    byReason: reasons,
  };
}

/**
 * Aggregate a season ledger.
 * @returns {{seasonId, minutes, apps, starts, goals, assists, byCompetitionType, club, international,
 *   ratedMinutes, avgRating, performanceObservation, reliability, nonParticipationCount}}
 */
export function aggregateSeason(ledger) {
  const total = emptyBucket();
  const club = emptyBucket();
  const international = emptyBucket();
  const byCompetitionType = {};
  let ratedMinutes = 0;
  let ratingMinutes = 0;
  let obsMinutes = 0;
  let obsSum = 0;

  for (const e of ledger.matches) {
    addToBucket(total, e);
    addToBucket(e.international ? international : club, e);
    addToBucket((byCompetitionType[e.competitionType] ||= emptyBucket()), e);
    if (e.rating != null) {
      ratedMinutes += e.minutes;
      ratingMinutes += e.rating * e.minutes;
    }
    if (e.observation != null) {
      obsMinutes += e.minutes;
      obsSum += e.observation * e.minutes;
    }
  }

  const seasonP = obsMinutes > 0 ? obsSum / obsMinutes : null;
  const reliability =
    ratedMinutes > 0
      ? ratedMinutes / (ratedMinutes + (PERFORMANCE.reliabilityMinutes || PERFORMANCE.reliabilityMinutesScale || 900))
      : 1 - Math.exp(-ratedMinutes / (PERFORMANCE.reliabilityMinutesScale || 1200));
  const withCompat = (b) => ({
    ...b,
    appearances: b.apps,
    avgMatchRating: null,
  });
  const clubC = withCompat(club);
  const intlC = withCompat(international);
  const combined = {
    appearances: total.apps,
    starts: total.starts,
    minutes: total.minutes,
    goals: total.goals,
    assists: total.assists,
    avgMatchRating: ratedMinutes > 0 ? ratingMinutes / ratedMinutes : null,
  };

  const np = summarizeNonParticipation(ledger.nonParticipation);

  return {
    seasonId: ledger.seasonId,
    ...total,
    appearances: total.apps,
    byCompetitionType,
    club: clubC,
    international: intlC,
    combined,
    ratedMinutes,
    avgRating: combined.avgMatchRating,
    performanceObservation: seasonP ?? 0,
    seasonP,
    reliability,
    reliableSignal: (seasonP ?? 0) * reliability,
    nonParticipationCount: np.total,
    nonParticipation: np,
  };
}
