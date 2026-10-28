/**
 * Per-season player ledger: exact-once match observations and season aggregates.
 *
 * - Every match is recorded at most once, keyed by `matchId`.
 * - Non-participation (0 minutes: unused sub, injured, rested) is NOT an
 *   appearance; it is tracked separately as `nonParticipation`.
 * - A match performance observation compares the rating with the expected
 *   rating: z = clamp((rating - expected) / scale, -3, 3); obs = tanh(z / 1.5).
 *
 * matchRecord:
 *   { matchId, competitionType: "league"|"cup"|"european"|"international"|...,
 *     isInternational?, minutes, started?, goals?, assists?, rating?,
 *     expectedRating?, residualScale?, position?, date? }
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
  if (!Number.isFinite(rating)) return null;
  const expected = Number.isFinite(expectedRating) ? expectedRating : PERFORMANCE.defaultExpectedRating;
  const s = scale > 0 ? scale : PERFORMANCE.residualScale.default;
  const z = clamp((rating - expected) / s, -PERFORMANCE.zClamp, PERFORMANCE.zClamp);
  return { z, observation: Math.tanh(z / PERFORMANCE.tanhDivisor) };
}

function isInternationalRecord(rec) {
  return Boolean(rec.isInternational) || PERFORMANCE.internationalTypes.includes(rec.competitionType);
}

/**
 * Record a match once. Duplicates (same matchId) are ignored.
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
    ledger.nonParticipation[key] = true;
    return { recorded: false, duplicate: false, reason: "no-participation" };
  }

  const scale = matchRecord.residualScale > 0 ? matchRecord.residualScale : residualScaleFor(matchRecord.position);
  const perf = computePerformanceObservation(Number(matchRecord.rating), matchRecord.expectedRating, scale);
  const entry = {
    matchId: key,
    competitionType: matchRecord.competitionType || "league",
    competitionId: matchRecord.competitionId ?? null,
    teamId: matchRecord.teamId ?? null,
    stintId: matchRecord.stintId ?? null,
    editionId: matchRecord.editionId ?? null,
    international: isInternationalRecord(matchRecord),
    minutes: Math.min(minutes, 150),
    started: Boolean(matchRecord.started),
    goals: Math.max(0, Number(matchRecord.goals) || 0),
    assists: Math.max(0, Number(matchRecord.assists) || 0),
    rating: perf ? Number(matchRecord.rating) : null,
    z: perf ? perf.z : null,
    observation: perf ? perf.observation : null,
    date: matchRecord.date ?? null,
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
    nonParticipationCount: Object.keys(ledger.nonParticipation).length,
    nonParticipation: { unused: Object.keys(ledger.nonParticipation).length },
  };
}
