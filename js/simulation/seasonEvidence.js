/**
 * Canonical season evidence (player-development-v3 + awards).
 *
 * `buildSeasonEvidence(player, context)` turns a *completed* season (ledger,
 * standing, health, trophies, club/league context) into one fixed-shape object
 * that development, awards, contracts and narrative can all read. It only
 * records what the engine actually observed:
 *
 *   - goals / assists / clean sheets are split by competition scope
 *     (league | cup | continental | international | other). The match ledger does
 *     not store clean sheets, so they come from `context.cleanSheetsByScope`,
 *     `context.leagueCleanSheets` / `context.cleanSheets` (attributed to the
 *     league) or per-match `cleanSheet` flags on raw `ledgerMatches`. Unknown stays `null`.
 *   - Tackles, xG and other metrics the engine does not simulate are NOT invented.
 *   - `seasonP` (signed performance vs expectation, may be null) and `reliability`
 *     (0..1, how much to trust it) are separate numbers; `sampleSizeShrinkage`
 *     documents how they combine.
 *   - `healthyTrainingFraction` comes from dated injury exposure (see
 *     `estimateHealthyTrainingFraction`), never only from the end-of-season flag.
 *
 * The object is deep-frozen except `recognition`, an array that the awards layer
 * appends award records to (`attachRecognitionToEvidence`).
 *
 * Backwards-compatible aliases used by seasonSimulator / development
 * (`byCompetitionType`, `goals`, `assists`, `cleanSheets`, `reliableSignal`,
 * `environmentProxy`, `preDevelopmentOverall`, boolean `loan`, ...) are kept.
 */
import { clamp } from "../utils/helpers.js";
import { PERFORMANCE } from "../config/playerDevelopmentConfig.js";
import { aggregateSeason } from "./playerSeasonLedger.js";
import { normalizePosition } from "./playerAbility.js";
import { toDay } from "./playerState.js";
import { simDate } from "./seasonCalendar.js";
import { developmentPeriodId } from "./playerDevelopmentModel.js";

function careerKey(player) {
  const explicit = player?.development?.careerId ?? player?.careerId;
  if (explicit !== undefined && explicit !== null && explicit !== "") return String(explicit);
  return `${player?.name ?? "player"}|${player?.nationality ?? ""}|${player?.startYear ?? ""}`;
}

export const SEASON_EVIDENCE_VERSION = 2;
export const COMPETITION_SCOPES = Object.freeze(["league", "cup", "continental", "international", "other"]);

/** Typical simulated season length in days when no calendar window is supplied. */
const DEFAULT_SEASON_DAYS = 300;
/** Lower bound for the number handed to development (fully injured seasons still train a little). */
export const HEALTHY_FRACTION_FLOOR = 0.15;
/** Minutes that count as "a lot" of evidence when describing shrinkage. */
const SHRINKAGE_PRIOR_MINUTES = 900;

/**
 * Authoritative June→June senior development period.
 *
 * Y = (player.startYear || 2026) + seasonIndex
 * [Y-06-01, (Y+1)-06-01)
 *
 * Covers summer internationals through May club football without overlapping
 * the next annual development window. Does not reschedule fixtures.
 *
 * @param {object} player
 * @param {{seasonIndex?:number, seasonStartYear?:number, periodId?:string}} [opts]
 * @returns {{
 *   seasonIndex:number, periodId:string, seasonId:string, seasonStartYear:number,
 *   periodStartDate:string, periodEndExclusiveDate:string,
 *   periodStartDay:number, periodEndDay:number, periodDays:number
 * }}
 */
export function resolveDevelopmentPeriod(player, opts = {}) {
  const seasonIndex = Number.isFinite(opts.seasonIndex)
    ? Number(opts.seasonIndex)
    : Number.isFinite(player?.seasons?.length)
      ? player.seasons.length
      : 0;
  const seasonStartYear = Number.isFinite(opts.seasonStartYear)
    ? Number(opts.seasonStartYear)
    : (Number(player?.startYear) || 2026) + seasonIndex;
  const periodId = developmentPeriodId(player, {
    seasonIndex,
    periodId: opts.periodId,
  });
  const periodStartDate = simDate(seasonStartYear, 6, 1);
  const periodEndExclusiveDate = simDate(seasonStartYear + 1, 6, 1);
  const periodStartDay = toDay(periodStartDate);
  const periodEndDay = toDay(periodEndExclusiveDate);
  if (periodStartDay == null || periodEndDay == null || !(periodEndDay > periodStartDay)) {
    throw new Error(
      `resolveDevelopmentPeriod: invalid window for year ${seasonStartYear} (${periodStartDate} → ${periodEndExclusiveDate})`
    );
  }
  return {
    seasonIndex,
    periodId,
    seasonId: periodId,
    seasonStartYear,
    periodStartDate,
    periodEndExclusiveDate,
    periodStartDay,
    periodEndDay,
    periodDays: periodEndDay - periodStartDay,
  };
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : fallback);
const numOrNull = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** Map any engine competition type / kind to one of COMPETITION_SCOPES. */
export function competitionScopeOf(typeOrKind, isInternational = false) {
  if (isInternational) return "international";
  const t = String(typeOrKind ?? "league").toLowerCase();
  if (["international", "nationalteam", "national", "nation"].includes(t)) return "international";
  if (["european", "continental", "europe", "champions-league", "uefa"].includes(t)) return "continental";
  if (["cup", "domestic-cup", "domesticcup", "domestic_cup", "playoff"].includes(t)) return "cup";
  if (t === "league") return "league";
  return "other";
}

function deepFreeze(obj) {
  if (!obj || typeof obj !== "object" || Object.isFrozen(obj)) return obj;
  Object.freeze(obj);
  for (const v of Object.values(obj)) deepFreeze(v);
  return obj;
}

function emptyScopeLine() {
  return { minutes: 0, appearances: 0, starts: 0, goals: 0, assists: 0, cleanSheets: null };
}

/** Stable fallback edition id when the caller supplies no competition editions. */
export function defaultCompetitionEditionId(seasonId, scope, competitionKey = "") {
  return `${seasonId ?? "season"}:${scope}${competitionKey ? `:${competitionKey}` : ""}`;
}

/**
 * Canonical evidence bucket key: competition ID + edition ID.
 * Bare years alone must not merge distinct competitions.
 */
export function evidenceEditionKey(competitionId, editionId) {
  const c = competitionId != null && String(competitionId) !== "" ? String(competitionId) : null;
  const e = editionId != null && String(editionId) !== "" ? String(editionId) : null;
  if (c && e) return `${c}::${e}`;
  if (e) return e;
  if (c) return c;
  return null;
}

/**
 * Resolve the competition edition lookup key for a scope from evidence/editions.
 * Prefers evidenceKey (competitionId::editionId) so award consumers hit the
 * correct byEdition bucket.
 */
export function resolveCompetitionEditionId(evidenceOrEditions, scope = "league", { seasonId, competitionKey } = {}) {
  const editions = Array.isArray(evidenceOrEditions) ? evidenceOrEditions : evidenceOrEditions?.editions || [];
  const hit = editions.find((e) => e.scope === scope && (!competitionKey || e.competitionKey === competitionKey));
  if (hit) return hit.evidenceKey || hit.editionId;
  const sid = seasonId ?? evidenceOrEditions?.seasonId;
  const fallbackId = defaultCompetitionEditionId(sid, scope, competitionKey);
  return evidenceEditionKey(competitionKey, fallbackId) || fallbackId;
}

function normalizeEditions(raw, seasonId, league) {
  const out = [];
  for (const e of Array.isArray(raw) ? raw : []) {
    if (!e) continue;
    const scope = competitionScopeOf(e.scope ?? e.kind ?? e.competitionType);
    const key = e.competitionKey ?? e.competitionId ?? e.simKey ?? e.name ?? "";
    const editionId = String(e.editionId ?? e.id ?? defaultCompetitionEditionId(seasonId, scope, key));
    out.push({
      editionId,
      evidenceKey: e.evidenceKey || evidenceEditionKey(key, editionId) || editionId,
      scope,
      competitionKey: key ? String(key) : null,
      name: e.name ?? e.label ?? null,
      teamMatches: numOrNull(e.teamMatches ?? e.matchesPlayed ?? e.played),
    });
  }
  if (!out.some((e) => e.scope === "league")) {
    const key = league?.leagueId ?? league?.name ?? "";
    const editionId = defaultCompetitionEditionId(seasonId, "league", key);
    out.push({
      editionId,
      evidenceKey: evidenceEditionKey(key, editionId) || editionId,
      scope: "league",
      competitionKey: key ? String(key) : null,
      name: league?.displayName ?? league?.name ?? null,
      teamMatches: null,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Healthy training fraction                                           */
/* ------------------------------------------------------------------ */

function mergeIntervals(intervals) {
  const sorted = intervals
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
    .sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Prefer active / richer copies when the same eventId appears twice. */
function recordCompleteness(rec, active) {
  let score = active ? 1000 : 0;
  if (rec == null || typeof rec !== "object") return score;
  if (rec.startDay != null || rec.onsetDay != null || rec.date != null) score += 40;
  if (rec.expectedReturnDay != null || rec.availabilityReturnDay != null) score += 40;
  if (rec.durationDays != null) score += 20;
  if (rec.recoveredDay != null) score += 5;
  if (!rec.superseded) score += 2;
  return score;
}

function injuryRecords(health) {
  const byId = new Map();
  const anonymous = [];
  const consider = (rec, active) => {
    if (!rec || typeof rec !== "object") return;
    const idKey = rec.eventId != null ? String(rec.eventId) : null;
    const entry = { rec, active: Boolean(active) };
    if (!idKey) {
      anonymous.push(entry);
      return;
    }
    const prev = byId.get(idKey);
    if (!prev || recordCompleteness(rec, active) >= recordCompleteness(prev.rec, prev.active)) {
      byId.set(idKey, entry);
    }
  };
  // History first, then active so equal-score active wins via >=.
  for (const r of health?.injuryHistory || []) consider(r, false);
  if (health?.activeInjury) consider(health.activeInjury, true);
  return [...byId.values(), ...anonymous];
}

/**
 * Availability return boundary — same semantics as `isAvailable`.
 * Prefer explicit availability / expected return / onset+duration.
 * A late `recoveredDay` observation must not extend unavailable time.
 */
export function availabilityReturnDayOf(rec) {
  if (!rec || typeof rec !== "object") return null;
  const explicit = numOrNull(rec.availabilityReturnDay);
  if (explicit != null) return explicit;
  const expected = numOrNull(rec.expectedReturnDay);
  if (expected != null) return expected;
  const start = numOrNull(rec.startDay ?? rec.onsetDay) ?? toDay(rec.date);
  const duration = numOrNull(rec.durationDays);
  if (start != null && duration != null) return start + duration;
  // Last-resort legacy: observation day only when no return boundary exists.
  return numOrNull(rec.recoveredDay);
}

function injuryOnsetDay(rec) {
  if (!rec || typeof rec !== "object") return null;
  return numOrNull(rec.startDay ?? rec.onsetDay) ?? toDay(rec.date);
}

function emptyHealthDetail(days, method, partial, extras = {}) {
  return {
    fraction: extras.fraction ?? 1,
    rawHealthyTrainingFraction: extras.fraction ?? 1,
    appliedHealthyTrainingFraction: clamp(extras.fraction ?? 1, HEALTHY_FRACTION_FLOOR, 1),
    injuredDays: extras.injuredDays ?? 0,
    seasonDays: days,
    method,
    partial,
    injuryCount: extras.injuryCount ?? 0,
    overlappingInjuryCount: extras.overlappingInjuryCount ?? 0,
    contributingEventIds: extras.contributingEventIds ?? [],
    excludedUnknownCount: extras.excludedUnknownCount ?? 0,
    excludedUnknownEventIds: extras.excludedUnknownEventIds ?? [],
    clippedIntervals: extras.clippedIntervals ?? [],
    windowStartDay: extras.windowStartDay ?? null,
    windowEndDay: extras.windowEndDay ?? null,
    hasDatedWindow: Boolean(extras.hasDatedWindow),
  };
}

/**
 * Detailed healthy-training estimate (0..1 raw fraction, no floor).
 *
 * With a dated window [S,E):
 *   - union clipped unavailable intervals using availability return boundaries
 *   - unscoped historical duration-only rows are excluded (partial/unknown)
 *   - undated active injuries keep a bounded duration-or-30 compatibility charge
 *
 * Without a window: legacy duration sum / seasonDays (always partial).
 *
 * @returns {object} diagnostics including raw/applied fractions and attribution
 */
export function estimateHealthyTrainingDetail({
  health,
  seasonStartDate,
  seasonEndDate,
  seasonStartDay,
  seasonEndDay,
  seasonDays,
} = {}) {
  const startDay = toDay(seasonStartDate ?? seasonStartDay);
  const endDay = toDay(seasonEndDate ?? seasonEndDay);
  let windowStart = startDay;
  let windowEnd = endDay;
  const declaredDays = numOrNull(seasonDays);
  if (windowStart != null && windowEnd == null && declaredDays > 0) windowEnd = windowStart + declaredDays;
  if (windowEnd != null && windowStart == null && declaredDays > 0) windowStart = windowEnd - declaredDays;
  const hasWindow = windowStart != null && windowEnd != null && Number.isFinite(windowStart) && Number.isFinite(windowEnd) && windowEnd > windowStart;
  const days = hasWindow ? windowEnd - windowStart : declaredDays > 0 ? declaredDays : DEFAULT_SEASON_DAYS;

  if (!health || typeof health !== "object") {
    return emptyHealthDetail(days, "default-no-health-data", true, {
      fraction: 0.9,
      hasDatedWindow: hasWindow,
      windowStartDay: hasWindow ? windowStart : null,
      windowEndDay: hasWindow ? windowEnd : null,
    });
  }

  const records = injuryRecords(health);
  if (!records.length) {
    return emptyHealthDetail(days, "no-injury-records", false, {
      hasDatedWindow: hasWindow,
      windowStartDay: hasWindow ? windowStart : null,
      windowEndDay: hasWindow ? windowEnd : null,
    });
  }

  const dated = [];
  const clippedIntervals = [];
  const contributingEventIds = [];
  const excludedUnknownEventIds = [];
  let undatedActiveDays = 0;
  let partial = false;
  let anyDated = false;
  let excludedUnknownCount = 0;
  let usedActiveUndatedFallback = false;
  const onlyActiveFlag = records.every((r) => r.active);

  for (const { rec, active } of records) {
    const duration = numOrNull(rec.durationDays);
    const start = injuryOnsetDay(rec);
    const end = availabilityReturnDayOf(rec);
    const eventId = rec.eventId != null ? String(rec.eventId) : null;
    const hasEndpoints =
      start != null && end != null && Number.isFinite(start) && Number.isFinite(end);
    const usableDated = hasEndpoints && end > start;

    // Invalid/reversed dated endpoints: contribute nothing, do not invent unknown charges.
    if (hasEndpoints && !usableDated) {
      continue;
    }

    if (hasWindow && usableDated) {
      anyDated = true;
      const clipStart = Math.max(start, windowStart);
      const clipEnd = Math.min(end, windowEnd);
      if (clipEnd > clipStart) {
        dated.push([clipStart, clipEnd]);
        clippedIntervals.push({
          eventId,
          active,
          startDay: start,
          returnDay: end,
          clippedStartDay: clipStart,
          clippedEndDay: clipEnd,
          clippedDays: clipEnd - clipStart,
        });
        if (eventId) contributingEventIds.push(eventId);
      }
      continue;
    }

    if (!hasWindow && usableDated) {
      anyDated = true;
      undatedActiveDays += Math.max(0, end - start);
      partial = true;
      continue;
    }

    // Incomplete / undated record.
    if (hasWindow) {
      if (active) {
        // Bounded compatibility for undated active injury — not exact dated overlap.
        undatedActiveDays += duration != null ? duration : 30;
        usedActiveUndatedFallback = true;
        partial = true;
      } else {
        // Unscoped historical duration must not charge every subsequent year.
        excludedUnknownCount += 1;
        if (eventId) excludedUnknownEventIds.push(eventId);
        partial = true;
      }
      continue;
    }

    undatedActiveDays += duration != null ? duration : active ? 30 : 0;
    if (active && duration == null && !(start != null && end != null)) usedActiveUndatedFallback = true;
    partial = true;
  }

  const merged = mergeIntervals(dated);
  const overlapDays = merged.reduce((s, [a, b]) => s + (b - a), 0);
  const injuredDays = clamp(overlapDays + undatedActiveDays, 0, days);
  const fraction = clamp(1 - injuredDays / days, 0, 1);
  const method =
    hasWindow && anyDated && undatedActiveDays === 0 && excludedUnknownCount === 0
      ? "dated-overlap"
      : hasWindow && anyDated && undatedActiveDays > 0
        ? "dated-overlap+active-undated"
        : hasWindow && anyDated && excludedUnknownCount > 0
          ? "dated-overlap+unknown-excluded"
          : hasWindow && !anyDated && undatedActiveDays > 0
            ? "active-undated-partial"
            : hasWindow && !anyDated && excludedUnknownCount > 0
              ? "unknown-historical-excluded"
              : onlyActiveFlag && usedActiveUndatedFallback
                ? "active-flag-partial"
                : onlyActiveFlag && !hasWindow
                  ? "active-flag-partial"
                  : "history-durations";

  // Dated active injuries with valid endpoints are complete; only undated/unknown paths stay partial.
  const isPartial = partial || excludedUnknownCount > 0 || (onlyActiveFlag && !hasWindow && !anyDated);
  return emptyHealthDetail(days, method, isPartial, {
    fraction,
    injuredDays,
    injuryCount: records.length,
    overlappingInjuryCount: clippedIntervals.length,
    contributingEventIds: [...new Set(contributingEventIds)],
    excludedUnknownCount,
    excludedUnknownEventIds: [...new Set(excludedUnknownEventIds)],
    clippedIntervals,
    hasDatedWindow: hasWindow,
    windowStartDay: hasWindow ? windowStart : null,
    windowEndDay: hasWindow ? windowEnd : null,
  });
}

/**
 * Healthy training fraction as a number for development (floored at 0.15).
 * See `estimateHealthyTrainingDetail` for the method and diagnostics.
 */
export function estimateHealthyTrainingFraction(args = {}) {
  return clamp(estimateHealthyTrainingDetail(args).fraction, HEALTHY_FRACTION_FLOOR, 1);
}

/* ------------------------------------------------------------------ */
/* Competition strength                                                */
/* ------------------------------------------------------------------ */

/** Rough league quality (0..100 scale) when no overall is available. */
function leagueOverallFromTier(tier) {
  const t = numOrNull(tier);
  return t == null ? null : clamp(52 + 7 * t, 45, 92);
}

export function leagueOverallOf(league) {
  const direct = numOrNull(league?.overall ?? league?.strength);
  if (direct != null) return direct;
  const clubs = (league?.clubs || []).map((c) => numOrNull(c.overall)).filter((v) => v != null);
  if (clubs.length >= 3) return clubs.reduce((s, v) => s + v, 0) / clubs.length;
  return leagueOverallFromTier(league?.tier);
}

function competitionStrengthBlock(player, ctx) {
  const league = ctx.league || null;
  const leagueOverall = numOrNull(ctx.leagueOverall) ?? leagueOverallOf(league);
  const clubOverall = numOrNull(ctx.clubOverall ?? player?.club?.overall);
  const playerOverall = numOrNull(
    ctx.playerOverall ?? player?.baseOverallRaw ?? player?.rating ?? player?.currentOverall
  );
  // Club quality is the most direct environment signal; league quality is the backdrop.
  const parts = [];
  if (clubOverall != null) parts.push([clubOverall, 0.6]);
  if (leagueOverall != null) parts.push([leagueOverall, 0.4]);
  let level = null;
  if (parts.length) {
    const w = parts.reduce((s, [, k]) => s + k, 0);
    level = parts.reduce((s, [v, k]) => s + v * k, 0) / w;
  }
  // 0..1 proxy of how strong the competition is: 50 -> 0, 90 -> 1.
  const competitionStrength = level == null ? null : clamp((level - 50) / 40, 0, 1);
  // Multiplier centred on 1: >1 when the environment is tougher than the player, <1 when he outclasses it.
  // Bounded [0.55, 1.4]; this is the scale seasonSimulator / development expect.
  const opp = leagueOverall ?? clubOverall ?? 70;
  const challengeRelativeToAbility = clamp(1 + (opp - (playerOverall ?? 70)) / 40, 0.55, 1.4);
  return {
    leagueId: league?.leagueId ?? ctx.leagueId ?? null,
    leagueTier: numOrNull(league?.tier ?? ctx.leagueTier),
    leagueOverall,
    clubOverall,
    playerOverall,
    environmentLevel: level,
    competitionStrength,
    challengeRelativeToAbility,
  };
}

/* ------------------------------------------------------------------ */
/* Club finish                                                         */
/* ------------------------------------------------------------------ */

function expectedPositionFromTable(table, club) {
  if (!Array.isArray(table) || table.length < 2) return null;
  const ranked = [...table].filter((r) => numOrNull(r.strength) != null).sort((a, b) => b.strength - a.strength);
  if (ranked.length < 2) return null;
  const idx = ranked.findIndex((r) => (club?.clubId && r.clubId === club.clubId) || (club?.name && r.name === club.name));
  return idx >= 0 ? idx + 1 : null;
}

function clubFinishBlock(player, ctx) {
  const standing = ctx.standing || null;
  const table = ctx.table || ctx.leagueTable || standing?.table || null;
  const teams = numOrNull(ctx.teamCount) ?? (Array.isArray(table) ? table.length : null) ?? numOrNull(standing?.teams);
  const position = numOrNull(standing?.position);
  const expectedPosition =
    numOrNull(ctx.expectedFinish ?? ctx.expectations?.expectedPosition) ??
    expectedPositionFromTable(table, ctx.club || player?.club);
  const delta = position != null && expectedPosition != null ? expectedPosition - position : null; // >0 overperformed
  return {
    position,
    teams,
    played: numOrNull(standing?.played ?? standing?.matches),
    points: numOrNull(standing?.points),
    goalsFor: numOrNull(standing?.goalsFor),
    goalsAgainst: numOrNull(standing?.goalsAgainst),
    expectedPosition,
    finishVsExpectation: delta,
    percentile: position != null && teams > 1 ? 1 - (position - 1) / (teams - 1) : null,
    champion: position === 1,
    qualification: standing?.qualification ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Trophies                                                            */
/* ------------------------------------------------------------------ */

function lineFromMatchesForTrophy(matches, { scope, winningClubId, competitionId, editionId, evidenceKey }) {
  const line = emptyScopeLine();
  let used = false;
  for (const m of matches) {
    const minutes = num(m.minutes);
    if (!(minutes > 0)) continue;
    if (winningClubId && m.teamId !== winningClubId) continue;
    if (competitionId && m.competitionId && m.competitionId !== competitionId) continue;
    const mScope = competitionScopeOf(m.competitionType ?? m.scope, Boolean(m.international ?? m.isInternational));
    if (mScope !== scope) continue;
    if (editionId || evidenceKey) {
      const mid = m.competitionEditionId ?? m.editionId ?? null;
      const mKey = evidenceEditionKey(m.competitionId, mid);
      if (
        mid !== editionId &&
        mKey !== editionId &&
        mKey !== evidenceKey &&
        !(evidenceKey && mKey === evidenceKey)
      ) {
        continue;
      }
    }
    used = true;
    line.minutes += Math.min(minutes, 150);
    line.appearances += 1;
    line.starts += m.started ? 1 : 0;
    line.goals += Math.max(0, num(m.goals));
    line.assists += Math.max(0, num(m.assists));
    if (typeof m.cleanSheet === "boolean") {
      line.cleanSheets = (line.cleanSheets ?? 0) + (m.cleanSheet ? 1 : 0);
    }
  }
  return { line, used };
}

function isSeasonHistoryIndex(id) {
  return id != null && /^season-\d+/i.test(String(id));
}

function trophyBlock(trophies, editions, byScope, byEdition, matches = []) {
  return (Array.isArray(trophies) ? trophies : []).map((t) => {
    const scope = competitionScopeOf(t.scope ?? t.kind);
    const winningClubId = t.winningClubId ?? null;
    const competitionId = t.competitionId ?? t.competitionKey ?? null;
    const rawEditionId = t.editionId ?? null;
    const editionIsIndex = isSeasonHistoryIndex(rawEditionId);

    // Resolve competition + edition + team. Never match a bare shared year alone,
    // and never treat a season-history index as a competition edition identity.
    let edition =
      editions.find(
        (e) =>
          competitionId &&
          e.competitionKey === competitionId &&
          e.scope === scope &&
          (!rawEditionId ||
            editionIsIndex ||
            e.editionId === rawEditionId ||
            e.evidenceKey === rawEditionId ||
            e.evidenceKey === evidenceEditionKey(competitionId, rawEditionId))
      ) ||
      editions.find(
        (e) =>
          e.scope === scope &&
          e.name &&
          (e.name === t.competition || e.name === t.simKey || e.name === t.label)
      ) ||
      editions.find((e) => e.scope === scope && competitionId && e.competitionKey === competitionId) ||
      null;

    // Exact modern evidenceKey / non-index edition match (same competition only).
    if (!edition && rawEditionId && !editionIsIndex) {
      edition =
        editions.find(
          (e) =>
            e.scope === scope &&
            (e.evidenceKey === rawEditionId || e.editionId === rawEditionId) &&
            (!competitionId || e.competitionKey === competitionId)
        ) || null;
    }

    // Infer competition from the winning club's positive-minute records when the
    // producer omitted competitionId (common league-trophy payload).
    if (!edition && winningClubId) {
      const comps = new Set();
      for (const m of matches) {
        if (!(num(m.minutes) > 0)) continue;
        if (m.teamId !== winningClubId) continue;
        const mScope = competitionScopeOf(m.competitionType ?? m.scope, Boolean(m.international ?? m.isInternational));
        if (mScope !== scope) continue;
        if (m.competitionId) comps.add(String(m.competitionId));
      }
      if (comps.size === 1) {
        const inferredId = [...comps][0];
        edition =
          editions.find((e) => e.scope === scope && e.competitionKey === inferredId) ||
          null;
        if (!edition) {
          const sample = matches.find(
            (m) => m.teamId === winningClubId && m.competitionId === inferredId && (m.editionId || m.competitionEditionId)
          );
          edition = {
            editionId: sample?.editionId ?? sample?.competitionEditionId ?? null,
            evidenceKey: evidenceEditionKey(inferredId, sample?.editionId ?? sample?.competitionEditionId),
            competitionKey: inferredId,
            scope,
            name: t.competition || null,
          };
        }
      }
    }

    // Old sparse trophies without competition identity stay explicitly unresolved
    // rather than selecting the first descriptor in scope.
    const resolvedCompetitionId = competitionId || edition?.competitionKey || null;
    const resolvedEditionId = edition?.editionId ?? (editionIsIndex ? null : rawEditionId) ?? null;

    let line = emptyScopeLine();
    const fromMatches = lineFromMatchesForTrophy(matches, {
      scope,
      winningClubId,
      competitionId: resolvedCompetitionId,
      editionId: resolvedEditionId,
      evidenceKey: edition?.evidenceKey || evidenceEditionKey(resolvedCompetitionId, resolvedEditionId),
    });
    if (fromMatches.used) {
      line = fromMatches.line;
    } else if (winningClubId) {
      // Known winning club with no matching team minutes: do not borrow later-club
      // or broad-scope participation.
      line = emptyScopeLine();
    } else if (edition) {
      line =
        byEdition[edition.evidenceKey] ||
        byEdition[edition.editionId] ||
        // Legacy sparse evidence may only have scope totals for this edition.
        (Object.keys(byEdition || {}).some((k) => String(k).includes("::"))
          ? emptyScopeLine()
          : byScope[scope] || emptyScopeLine());
    } else {
      // Genuinely old aggregate-only trophy: scoped line only when no modern buckets exist.
      const modern = Object.keys(byEdition || {}).some((k) => String(k).includes("::"));
      line = modern ? emptyScopeLine() : byScope[scope] || emptyScopeLine();
    }

    const minutes = line.minutes;
    let weight;
    let basis;
    if (edition?.teamMatches > 0) {
      weight = clamp(minutes / (edition.teamMatches * 90), 0, 1);
      basis = "team-matches";
    } else {
      // Team match count unknown: saturating proxy (270 min ~ 0.5, 900 min ~ 0.77).
      weight = minutes / (minutes + 270);
      basis = "saturating-proxy";
    }
    return {
      ...t,
      kind: t.kind ?? scope,
      scope,
      competitionId: resolvedCompetitionId,
      editionId: resolvedEditionId,
      evidenceKey: edition?.evidenceKey ?? evidenceEditionKey(resolvedCompetitionId, resolvedEditionId),
      minutes,
      appearances: line.appearances,
      participationWeight: Number(weight.toFixed(4)),
      participationBasis: basis,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Stints / loan                                                       */
/* ------------------------------------------------------------------ */

function stintBlock(player, ctx) {
  const raw = Array.isArray(ctx.stints) ? ctx.stints : Array.isArray(ctx.playingStints) ? ctx.playingStints : [];
  const stints = raw.map((s) => ({
    clubId: s.clubId ?? s.playingClubId ?? null,
    clubName: s.clubName ?? s.club ?? null,
    leagueId: s.leagueId ?? null,
    minutes: numOrNull(s.minutes),
    appearances: numOrNull(s.appearances ?? s.matches),
    onLoan: Boolean(s.onLoan ?? s.loan),
    from: s.from ?? s.startDate ?? null,
    to: s.to ?? s.endDate ?? null,
  }));
  const loanInfo = ctx.loan && typeof ctx.loan === "object" ? ctx.loan : player?.activeLoan ?? null;
  const onLoan =
    Boolean(ctx.onLoan) ||
    loanInfo?.status === "active" ||
    Boolean(loanInfo?.active ?? loanInfo?.onLoan) ||
    ctx.loan === true ||
    stints.some((s) => s.onLoan);
  return {
    stints,
    onLoan,
    loanInfo: {
      onLoan,
      parentClubId: loanInfo?.parentClubId ?? loanInfo?.parentClub?.clubId ?? player?.parentClub?.clubId ?? null,
      borrowerClubId:
        loanInfo?.borrowerClubId ?? loanInfo?.borrowingClub?.clubId ?? player?.playingClubId ?? player?.club?.clubId ?? null,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Scope lines                                                         */
/* ------------------------------------------------------------------ */

function scopeLinesFromMatches(matches) {
  const byScope = Object.fromEntries(COMPETITION_SCOPES.map((s) => [s, emptyScopeLine()]));
  const byEdition = {};
  let flaggedCleanSheets = false;
  for (const m of matches) {
    const minutes = num(m.minutes);
    if (!(minutes > 0)) continue;
    const scope = competitionScopeOf(m.competitionType ?? m.scope, Boolean(m.international ?? m.isInternational));
    const lines = [byScope[scope]];
    const editionId = m.competitionEditionId ?? m.editionId ?? null;
    const key = evidenceEditionKey(m.competitionId, editionId);
    if (key) lines.push((byEdition[key] ||= emptyScopeLine()));
    for (const line of lines) {
      line.minutes += Math.min(minutes, 150);
      line.appearances += 1;
      line.starts += m.started ? 1 : 0;
      line.goals += Math.max(0, num(m.goals));
      line.assists += Math.max(0, num(m.assists));
      if (typeof m.cleanSheet === "boolean") {
        line.cleanSheets = (line.cleanSheets ?? 0) + (m.cleanSheet ? 1 : 0);
        flaggedCleanSheets = true;
      }
    }
  }
  return { byScope, byEdition, flaggedCleanSheets };
}

/** When only an aggregate (no per-match records) is available. */
function scopeLinesFromAggregate(aggregate) {
  const byScope = Object.fromEntries(COMPETITION_SCOPES.map((s) => [s, emptyScopeLine()]));
  for (const [type, b] of Object.entries(aggregate?.byCompetitionType || {})) {
    const scope = competitionScopeOf(type);
    const line = byScope[scope];
    line.minutes += num(b.minutes);
    line.appearances += num(b.apps ?? b.appearances);
    line.starts += num(b.starts);
    line.goals += num(b.goals);
    line.assists += num(b.assists);
  }
  return { byScope, byEdition: {}, flaggedCleanSheets: false };
}

/* ------------------------------------------------------------------ */
/* Main builder                                                        */
/* ------------------------------------------------------------------ */

/**
 * @param {object} player
 * @param {object} [context]
 * @param {object}  [context.ledger]          season ledger ({matches, ...})
 * @param {object}  [context.aggregate]       result of aggregateSeason(ledger)
 * @param {object[]}[context.ledgerMatches]   ledger/raw match records (may carry cleanSheet / competitionEditionId)
 * @param {object}  [context.standing]        player's league table row
 * @param {object[]}[context.table]           full league table (for expectations)
 * @param {object[]}[context.trophies]        may be empty / omitted
 * @param {object[]}[context.competitionEditions] [{editionId, scope, name, teamMatches}]
 * @param {object}  [context.health]          defaults to player.health
 * @param {string|Date|number} [context.seasonStartDate], [context.seasonEndDate]  (or seasonStartDay / seasonEndDay), [context.seasonDays]
 * @param {object}  [context.developmentPeriod] from resolveDevelopmentPeriod
 * @param {boolean} [context.requireDatedHealthWindow] senior completion must supply a real window
 * @param {number}  [context.healthyTrainingFraction] explicit override (e.g. tests)
 * @param {object[]}[context.stints]          playing stints (club/loan)
 * @param {object}  [context.loan]
 * @param {number}  [context.clubOverall], [context.league], [context.leagueOverall]
 * @param {number}  [context.leagueCleanSheets], [context.cleanSheets], [context.cleanSheetsByScope]
 * @param {number}  [context.leagueGoals]     used when the ledger shows no league goals
 * @param {number}  [context.seasonStartAge]  defaults to player.age - 1 (age has usually advanced already)
 */
export function buildSeasonEvidence(player, context = {}) {
  const ctx = context || {};
  const developmentPeriod = ctx.developmentPeriod || null;
  const seasonId =
    ctx.seasonId ??
    developmentPeriod?.seasonId ??
    ctx.ledger?.seasonId ??
    ctx.aggregate?.seasonId ??
    null;
  const matches = Array.isArray(ctx.ledgerMatches) ? ctx.ledgerMatches : ctx.ledger?.matches || [];
  const aggregate =
    ctx.aggregate ||
    aggregateSeason({ seasonId, matches, recordedMatchIds: {}, nonParticipation: ctx.ledger?.nonParticipation || {} });

  const league = ctx.league || null;
  const editions = normalizeEditions(ctx.competitionEditions, seasonId, league);

  // Per-scope / per-edition lines from the individual match records (or the aggregate if there are none).
  const { byScope, byEdition, flaggedCleanSheets } = matches.length
    ? scopeLinesFromMatches(matches)
    : scopeLinesFromAggregate(aggregate);
  if (!(byScope.league.goals > 0) && numOrNull(ctx.leagueGoals) != null) byScope.league.goals = Number(ctx.leagueGoals);

  if (!flaggedCleanSheets) {
    if (ctx.cleanSheetsByScope && typeof ctx.cleanSheetsByScope === "object") {
      for (const [scopeKey, v] of Object.entries(ctx.cleanSheetsByScope)) {
        const scope = competitionScopeOf(scopeKey);
        if (numOrNull(v) != null) byScope[scope].cleanSheets = Math.max(0, Number(v));
      }
    } else if (numOrNull(ctx.leagueCleanSheets ?? ctx.cleanSheets) != null) {
      byScope.league.cleanSheets = Math.max(0, Number(ctx.leagueCleanSheets ?? ctx.cleanSheets));
    }
  }

  const sumKnown = (key) => COMPETITION_SCOPES.reduce((s, sc) => s + (byScope[sc][key] ?? 0), 0);
  const anyCleanSheetData = COMPETITION_SCOPES.some((sc) => byScope[sc].cleanSheets != null);
  const total = {
    goals: sumKnown("goals"),
    assists: sumKnown("assists"),
    cleanSheets: anyCleanSheetData ? sumKnown("cleanSheets") : null,
  };

  // Raw-type buckets kept for existing consumers ("european" rather than "continental").
  const byCompetitionType = {};
  for (const [type, b] of Object.entries(aggregate.byCompetitionType || {})) {
    byCompetitionType[type] = {
      minutes: num(b.minutes),
      appearances: num(b.apps ?? b.appearances),
      starts: num(b.starts),
      goals: num(b.goals),
      assists: num(b.assists),
      cleanSheets: 0,
    };
  }
  byCompetitionType.league ||= { minutes: 0, appearances: 0, starts: 0, goals: 0, assists: 0, cleanSheets: 0 };
  if (!(byCompetitionType.league.goals > 0)) byCompetitionType.league.goals = byScope.league.goals;
  byCompetitionType.league.cleanSheets = byScope.league.cleanSheets ?? 0;

  const ratedMinutes = num(aggregate.ratedMinutes);
  const ratingSum = matches.reduce(
    (s, m) => (m.rating != null && Number.isFinite(Number(m.rating)) ? s + Number(m.rating) * num(m.minutes) : s),
    0
  );
  const minutesWeightedRating =
    numOrNull(aggregate.combined?.avgMatchRating ?? aggregate.avgRating) ??
    (ratedMinutes > 0 && matches.length ? ratingSum / ratedMinutes : null);
  const seasonP = numOrNull(aggregate.seasonP);
  const reliability = clamp(num(aggregate.reliability, 0), 0, 1);

  const health = ctx.health ?? player?.health ?? null;
  const healthWindow = {
    health,
    seasonStartDate:
      ctx.seasonStartDate ??
      developmentPeriod?.periodStartDate ??
      ctx.seasonWindow?.start ??
      ctx.calendar?.startDate ??
      null,
    seasonEndDate:
      ctx.seasonEndDate ??
      developmentPeriod?.periodEndExclusiveDate ??
      ctx.seasonWindow?.end ??
      ctx.calendar?.endDate ??
      null,
    seasonStartDay: ctx.seasonStartDay ?? developmentPeriod?.periodStartDay ?? null,
    seasonEndDay: ctx.seasonEndDay ?? developmentPeriod?.periodEndDay ?? null,
    seasonDays: ctx.seasonDays ?? developmentPeriod?.periodDays ?? ctx.calendar?.seasonDays,
  };
  const healthy = estimateHealthyTrainingDetail(healthWindow);
  if (ctx.requireDatedHealthWindow && !healthy.hasDatedWindow) {
    throw new Error(
      "buildSeasonEvidence: complete senior development requires a dated health window (seasonStart/End day or date)"
    );
  }
  const rawHealthyTrainingFraction = healthy.fraction;
  const healthyTrainingFraction =
    ctx.healthyTrainingFraction != null
      ? clamp(Number(ctx.healthyTrainingFraction), 0, 1)
      : clamp(rawHealthyTrainingFraction, HEALTHY_FRACTION_FLOOR, 1);

  const strength = competitionStrengthBlock(player, ctx);
  const clubFinish = clubFinishBlock(player, ctx);
  const trophies = trophyBlock(ctx.trophies, editions, byScope, byEdition, matches);
  const { stints, onLoan, loanInfo } = stintBlock(player, ctx);
  const positionInfo = normalizePosition(ctx.position ?? player?.position);
  const seasonStartAge = numOrNull(ctx.seasonStartAge ?? ctx.ageAtSeasonStart) ?? (Number.isFinite(player?.age) ? player.age - 1 : null);

  // Senior minutes from earlier seasons (the current season is not yet in player.seasons when called pre-push).
  const priorSeniorMinutes = (player?.seasons || []).reduce((s, se) => {
    if (!se || se.isAcademy || se.academy || se.youth || se.isYouth) return s;
    if (seasonId != null && se.seasonId != null && String(se.seasonId) === String(seasonId)) return s;
    return s + (Number(se.minutes) || 0);
  }, 0);

  const environmentProxy = clamp(0.85 + (num(player?.club?.overall ?? ctx.clubOverall, 70) - 70) / 80, 0.55, 1.35);

  const evidence = {
    version: SEASON_EVIDENCE_VERSION,
    seasonId,
    playerId: player?.careerId || player?.development?.careerId || player?.id || (player ? careerKey(player) : null),
    position: positionInfo.position,
    seasonStartAge,

    // Volume
    minutes: num(aggregate.combined?.minutes ?? aggregate.minutes),
    appearances: num(aggregate.combined?.appearances ?? aggregate.appearances ?? aggregate.apps),
    starts: num(aggregate.combined?.starts ?? aggregate.starts),
    ratedMinutes,
    minutesWeightedRating,

    // Performance signal (separate: signed effect vs. how much to trust it)
    seasonP,
    reliability,
    reliableSignal: seasonP != null ? seasonP * reliability : 0,
    sampleSizeShrinkage: {
      note:
        "reliability = ratedMinutes / (ratedMinutes + priorMinutes); consumers should weight seasonP by reliability, " +
        "so thin samples shrink toward zero instead of being treated as noise-free.",
      priorMinutes: SHRINKAGE_PRIOR_MINUTES,
      ratedMinutes,
      weight: reliability,
      shrunkSeasonP: seasonP == null ? null : seasonP * reliability,
      lowSample: ratedMinutes < SHRINKAGE_PRIOR_MINUTES,
    },

    // Output by competition. No tackles / xG: the engine does not simulate them.
    byScope,
    byEdition,
    byCompetitionType,
    goalsByCompetition: Object.fromEntries(COMPETITION_SCOPES.map((s) => [s, byScope[s].goals])),
    assistsByCompetition: Object.fromEntries(COMPETITION_SCOPES.map((s) => [s, byScope[s].assists])),
    cleanSheetsByCompetition: Object.fromEntries(COMPETITION_SCOPES.map((s) => [s, byScope[s].cleanSheets])),
    total,
    goals: Math.max(total.goals, num(aggregate.combined?.goals ?? aggregate.goals)),
    assists: Math.max(total.assists, num(aggregate.combined?.assists ?? aggregate.assists)),
    cleanSheets: total.cleanSheets ?? num(ctx.cleanSheets),
    club: aggregate.club ? { ...aggregate.club } : null, // copies: freezing must not touch the caller's aggregate
    international: aggregate.international ? { ...aggregate.international } : null,

    // Environment
    competitionStrength: strength.competitionStrength,
    challengeRelativeToAbility: strength.challengeRelativeToAbility,
    environmentProxy,
    competition: strength,
    editions,

    // Availability
    healthyTrainingFraction,
    rawHealthyTrainingFraction:
      ctx.healthyTrainingFraction != null ? healthyTrainingFraction : rawHealthyTrainingFraction,
    health: {
      method: ctx.healthyTrainingFraction != null ? "explicit-override" : healthy.method,
      partial: healthy.partial,
      injuredDays: healthy.injuredDays,
      seasonDays: healthy.seasonDays,
      injuryCount: healthy.injuryCount,
      overlappingInjuryCount: healthy.overlappingInjuryCount ?? 0,
      contributingEventIds: healthy.contributingEventIds || [],
      excludedUnknownCount: healthy.excludedUnknownCount ?? 0,
      excludedUnknownEventIds: healthy.excludedUnknownEventIds || [],
      clippedIntervals: healthy.clippedIntervals || [],
      rawHealthyTrainingFraction:
        ctx.healthyTrainingFraction != null ? healthyTrainingFraction : rawHealthyTrainingFraction,
      appliedHealthyTrainingFraction: healthyTrainingFraction,
      hasDatedWindow: Boolean(healthy.hasDatedWindow),
      windowStartDay: healthy.windowStartDay ?? null,
      windowEndDay: healthy.windowEndDay ?? null,
      activeInjuryAtSeasonEnd: Boolean(health?.activeInjury),
    },
    developmentPeriod: developmentPeriod
      ? {
          periodId: developmentPeriod.periodId,
          seasonId: developmentPeriod.seasonId,
          seasonIndex: developmentPeriod.seasonIndex,
          seasonStartYear: developmentPeriod.seasonStartYear,
          startDate: developmentPeriod.periodStartDate,
          endExclusiveDate: developmentPeriod.periodEndExclusiveDate,
          startDay: developmentPeriod.periodStartDay,
          endDay: developmentPeriod.periodEndDay,
          days: developmentPeriod.periodDays,
        }
      : null,
    season: {
      startDate: healthWindow.seasonStartDate ?? developmentPeriod?.periodStartDate ?? null,
      endDate: healthWindow.seasonEndDate ?? developmentPeriod?.periodEndExclusiveDate ?? null,
      startDay: healthy.windowStartDay ?? null,
      endDay: healthy.windowEndDay ?? null,
      days: healthy.seasonDays,
    },

    // Team context
    clubFinish,
    expectedFinish: clubFinish.expectedPosition,
    overachievement:
      clubFinish.position != null && clubFinish.expectedPosition != null
        ? Math.max(0, clubFinish.expectedPosition - clubFinish.position)
        : null,
    trophies,
    stints,
    loanInfo,
    loan: onLoan,
    playingClubId: player?.playingClubId || player?.club?.clubId || null,
    employmentClubId: player?.employmentClubId || null,
    priorSeniorMinutes,
    preDevelopmentOverall: strength.playerOverall,
    nonParticipationCount: num(aggregate.nonParticipationCount),

    // Filled in later by the awards layer (array of award records; appendable).
    recognition: Array.isArray(ctx.recognition) ? [...ctx.recognition] : [],
  };

  // Freeze everything except `recognition`.
  const { recognition, ...rest } = evidence;
  for (const v of Object.values(rest)) deepFreeze(v);
  rest.recognition = recognition;
  return Object.freeze(rest);
}

/**
 * Append award records to `evidence.recognition` (idempotent by eventId).
 * Records keep their own status: "nominated" | "selected" | "won".
 */
export function attachRecognitionToEvidence(evidence, records = []) {
  if (!evidence || !Array.isArray(evidence.recognition) || Object.isFrozen(evidence.recognition)) return evidence;
  for (const rec of records) {
    if (!rec) continue;
    if (evidence.recognition.some((x) => x.eventId === rec.eventId)) continue;
    evidence.recognition.push(rec);
  }
  return evidence;
}

/** Map evidence onto `developSeason` inputs. */
export function evidenceToDevelopmentContext(evidence, extras = {}) {
  const records = Array.isArray(evidence.recognition) ? evidence.recognition : evidence.recognition?.records || [];
  return {
    usefulMinutes: evidence.minutes,
    healthyTrainingFraction: evidence.healthyTrainingFraction,
    reliability: evidence.reliability,
    P_long: evidence.ratedMinutes >= (PERFORMANCE.reliabilityMinutes || 900) * 0.5 ? evidence.seasonP : evidence.seasonP,
    reliableSignal: evidence.reliableSignal,
    environmentMultiplier:
      extras.environmentMultiplier ?? evidence.environmentProxy * (0.85 + 0.15 * evidence.challengeRelativeToAbility),
    recognition: {
      awards: records,
      trophies: evidence.trophies || [],
    },
  };
}
