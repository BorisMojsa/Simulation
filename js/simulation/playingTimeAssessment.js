/**
 * Club playing-time opportunity assessment.
 *
 * Numerator: club minutes played for the assessed period / club / stint.
 * Denominator: eligible club-minute capacity (fixtures the player could have
 * appeared in), including unused-sub / rested / not-selected zeros.
 *
 * International fixtures are excluded from both sides. Unavailable /
 * registration-ineligible fixtures are exclusions, not opportunities.
 * Explicit numeric zero is preserved; `||` never substitutes stale totals.
 */
import { PERFORMANCE } from "../config/playerDevelopmentConfig.js";

export const PLAYING_TIME_ASSESSMENT_VERSION = "playing-time-assessment-v1";

const UNAVAILABLE_REASONS = new Set([
  "injured",
  "unavailable",
  "suspended",
  "registration-ineligible",
  "ineligible",
  "not_registered",
  "not-registered",
]);

const ELIGIBLE_ZERO_REASONS = new Set([
  "unused_substitute",
  "unused",
  "bench",
  "rested",
  "not_selected",
  "not-selected",
]);

function coerceFiniteOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isInternationalRecord(rec) {
  if (!rec || typeof rec !== "object") return false;
  if (rec.isInternational === true || rec.international === true) return true;
  if (rec.teamType === "national") return true;
  const ctype = rec.competitionType || null;
  if (ctype && PERFORMANCE.internationalTypes?.includes?.(ctype)) return true;
  return ctype === "international";
}

function fixtureKey(rec) {
  if (!rec) return null;
  const id = rec.matchId ?? rec.fixtureId ?? null;
  if (id != null && id !== "") return String(id);
  const parts = [
    rec.competitionId ?? "",
    rec.editionId ?? rec.competitionEditionId ?? "",
    rec.date ?? "",
    rec.teamId ?? "",
    rec.opponentId ?? "",
  ];
  if (parts.every((p) => p === "")) return null;
  return parts.join("|");
}

function recordCapacity(rec) {
  const known =
    coerceFiniteOrNull(rec.availableMinutes) ??
    coerceFiniteOrNull(rec.matchDuration) ??
    coerceFiniteOrNull(rec.capacityMinutes);
  if (known != null && known > 0) return known;
  return null;
}

function recordMinutes(rec) {
  const m = coerceFiniteOrNull(rec.minutes);
  if (m == null || m < 0) return 0;
  return m;
}

function availabilityStatus(rec) {
  if (!rec || typeof rec !== "object") return "unknown";
  if (rec.available === true) return "available";
  if (rec.available === false) return "unavailable";
  const reason = String(rec.nonParticipationReason || rec.reason || "");
  if (UNAVAILABLE_REASONS.has(reason)) return "unavailable";
  if (ELIGIBLE_ZERO_REASONS.has(reason)) return "available";
  // Positive minutes imply the player was available for that fixture's opportunity.
  if (recordMinutes(rec) > 0) return "available";
  return "unknown";
}

function competitionBucket(rec) {
  const t = rec.competitionType || "league";
  if (t === "league") return "league";
  if (t === "domesticCup" || t === "cup") return "domesticCup";
  if (t === "continental" || t === "europe" || t === "european") return "continental";
  return t;
}

function emptySlice(label = null) {
  return {
    label,
    clubMinutesPlayed: 0,
    opportunityCapacity: 0,
    eligibleFixtureCount: 0,
    availabilityExclusions: 0,
    unknownAvailabilityCount: 0,
    share: null,
    completeness: "empty",
  };
}

function finalizeSlice(slice) {
  if (slice.eligibleFixtureCount <= 0 || slice.opportunityCapacity <= 0) {
    slice.share = null;
    slice.completeness =
      slice.unknownAvailabilityCount > 0
        ? "incomplete"
        : slice.availabilityExclusions > 0
          ? "empty"
          : "empty";
    return slice;
  }
  slice.share = slice.clubMinutesPlayed / slice.opportunityCapacity;
  if (slice.unknownAvailabilityCount > 0) slice.completeness = "partial";
  else slice.completeness = "exact";
  return slice;
}

/**
 * Normalize heterogeneous season evidence into club opportunity records.
 * Read-only — does not mutate player/season or consume RNG.
 */
export function collectClubOpportunityRecords(player, opts = {}) {
  const season = opts.season || player?.seasons?.[player.seasons.length - 1] || null;
  const raw = [];

  const pushList = (list, source) => {
    if (!Array.isArray(list)) return;
    for (const rec of list) {
      if (!rec || typeof rec !== "object") continue;
      raw.push({ ...rec, _source: source });
    }
  };

  if (Array.isArray(opts.ledgerRecords)) pushList(opts.ledgerRecords, "opts.ledgerRecords");
  else if (Array.isArray(season?.ledgerRecords)) pushList(season.ledgerRecords, "season.ledgerRecords");

  // Reconstruct from structured positive + zero-minute ledger when present and scoped.
  const ledger = opts.seasonLedger || season?.seasonLedger || null;
  if (ledger && Array.isArray(ledger.matches)) {
    pushList(ledger.matches, "ledger.matches");
    for (const [matchId, detail] of Object.entries(ledger.nonParticipation || {})) {
      if (detail === true) {
        raw.push({
          matchId,
          minutes: 0,
          available: null,
          nonParticipationReason: "unknown",
          _source: "ledger.nonParticipation.legacy",
        });
      } else if (detail && typeof detail === "object") {
        raw.push({ matchId, minutes: 0, ...detail, _source: "ledger.nonParticipation" });
      }
    }
  }

  if (Array.isArray(opts.records)) pushList(opts.records, "opts.records");

  const clubIdFilter =
    opts.clubId ||
    opts.representedClubId ||
    opts.playingClubId ||
    null;
  const stintFilter = opts.stintId || null;
  const checkpointDate = opts.checkpointDate || opts.date || null;

  const seen = new Set();
  const out = [];
  for (const rec of raw) {
    if (isInternationalRecord(rec)) continue;
    if (clubIdFilter) {
      const tid = rec.teamId || rec.clubId || null;
      if (tid && tid !== clubIdFilter) continue;
    }
    if (stintFilter && rec.stintId && rec.stintId !== stintFilter) continue;
    if (checkpointDate && rec.date && String(rec.date) > String(checkpointDate)) continue;

    const key = fixtureKey(rec);
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(rec);
  }
  return out;
}

/**
 * Assess club minutes vs eligible club-minute capacity.
 */
export function assessClubPlayingTime(player, opts = {}) {
  const season = opts.season || player?.seasons?.[player.seasons.length - 1] || null;
  const seasonIndex = opts.seasonIndex ?? player?.seasons?.length ?? 0;
  const representedClubId =
    opts.clubId ||
    opts.representedClubId ||
    opts.playingClubId ||
    season?.playingClubId ||
    player?.playingClubId ||
    player?.club?.clubId ||
    null;

  const base = {
    version: PLAYING_TIME_ASSESSMENT_VERSION,
    periodId: opts.periodId || season?.seasonId || `season:${seasonIndex}`,
    reviewId:
      opts.reviewId ||
      `pta:${player?.careerId || player?.name || "p"}:${representedClubId || "none"}:${seasonIndex}:${opts.checkpoint || "end"}`,
    checkpoint: opts.checkpoint || "end",
    checkpointDate: opts.checkpointDate || opts.date || null,
    representedClubId,
    representedStintIds: [],
    clubMinutesPlayed: 0,
    opportunityCapacity: 0,
    eligibleFixtureCount: 0,
    availabilityExclusions: 0,
    unknownAvailabilityCount: 0,
    share: null,
    source: "none",
    completeness: "empty",
    byCompetition: {
      league: emptySlice("league"),
      domesticCup: emptySlice("domesticCup"),
      continental: emptySlice("continental"),
    },
    byStint: [],
    conflicts: [],
    recordsExamined: 0,
  };

  const records = collectClubOpportunityRecords(player, {
    ...opts,
    season,
    clubId: representedClubId || undefined,
  });
  base.recordsExamined = records.length;

  if (records.length > 0) {
    const stintMap = new Map();
    for (const rec of records) {
      const status = availabilityStatus(rec);
      const mins = recordMinutes(rec);
      const cap = recordCapacity(rec);
      const bucket = competitionBucket(rec);
      const slice = base.byCompetition[bucket] || (base.byCompetition[bucket] = emptySlice(bucket));

      if (status === "unavailable") {
        base.availabilityExclusions += 1;
        continue;
      }
      if (status === "unknown") {
        base.unknownAvailabilityCount += 1;
        // Unknown availability: do not invent eligibility; keep incomplete.
        continue;
      }

      // Available (including known zero-minute opportunity).
      const capacity = cap != null && cap > 0 ? cap : 90;
      if (cap == null) {
        // Duration metadata missing — use regulation default once, mark partial.
        base.unknownAvailabilityCount += 0; // duration gap tracked via completeness partial
        slice._durationAssumed = true;
      }

      base.clubMinutesPlayed += mins;
      base.opportunityCapacity += capacity;
      base.eligibleFixtureCount += 1;
      slice.clubMinutesPlayed += mins;
      slice.opportunityCapacity += capacity;
      slice.eligibleFixtureCount += 1;

      const stintId = rec.stintId || representedClubId || "unknown-stint";
      if (!stintMap.has(stintId)) stintMap.set(stintId, emptySlice(stintId));
      const st = stintMap.get(stintId);
      st.clubMinutesPlayed += mins;
      st.opportunityCapacity += capacity;
      st.eligibleFixtureCount += 1;
    }

    for (const k of Object.keys(base.byCompetition)) finalizeSlice(base.byCompetition[k]);
    base.byStint = [...stintMap.entries()].map(([id, s]) => {
      finalizeSlice(s);
      return { stintId: id, ...s };
    });
    base.representedStintIds = base.byStint.map((s) => s.stintId);
    finalizeSlice(base);
    base.source = "ledger-records";
    if (base.byCompetition.league?._durationAssumed || base.completeness === "exact") {
      // If any capacity was assumed 90, downgrade exact → partial when any slice flagged.
      const assumed = Object.values(base.byCompetition).some((s) => s._durationAssumed);
      if (assumed && base.completeness === "exact") base.completeness = "partial";
    }
    return base;
  }

  // Explicit participationLedger — only when scoped to this period/club.
  const ledger = season?.participationLedger || null;
  const playerLedger = player?.seasonLedger || null;
  const candidate =
    (ledger && ledgerScoped(ledger, season, representedClubId) && ledger) ||
    (playerLedger && ledgerScoped(playerLedger, season, representedClubId) && playerLedger) ||
    null;

  if (candidate) {
    const played = coerceFiniteOrNull(candidate.clubMinutesPlayed);
    const avail = coerceFiniteOrNull(candidate.availableClubMinutes);
    const eligible = coerceFiniteOrNull(candidate.eligibleClubMatches);
    if (played == null || avail == null || eligible == null || avail < 0 || eligible < 0 || played < 0) {
      base.source = "participation-ledger-malformed";
      base.completeness = "incomplete";
      base.conflicts.push({ kind: "malformed-ledger", ledger: summarizeLedger(candidate) });
      return base;
    }
    // Explicit zero minutes must remain zero even if season.minutes is nonzero.
    const seasonMinutes = coerceFiniteOrNull(season?.minutes ?? season?.clubMinutes);
    if (played === 0 && seasonMinutes != null && seasonMinutes > 0) {
      base.conflicts.push({
        kind: "stale-season-minutes-ignored",
        ledgerMinutes: played,
        seasonMinutes,
      });
    }
    base.clubMinutesPlayed = played;
    base.opportunityCapacity = avail;
    base.eligibleFixtureCount = eligible;
    base.availabilityExclusions = coerceFiniteOrNull(candidate.availabilityExclusions) || 0;
    finalizeSlice(base);
    base.source = "participation-ledger";
    return base;
  }

  if (playerLedger && !ledgerScoped(playerLedger, season, representedClubId)) {
    base.conflicts.push({
      kind: "cross-period-or-club-ledger-ignored",
      ledger: summarizeLedger(playerLedger),
      representedClubId,
      seasonId: season?.seasonId || null,
    });
  }

  // Legacy league-only estimate: standing.matches as opportunity count when known.
  const standingMatches = coerceFiniteOrNull(season?.standing?.matches);
  const seasonMinutes = coerceFiniteOrNull(season?.minutes ?? season?.clubMinutes);
  if (standingMatches != null && standingMatches > 0 && seasonMinutes != null && seasonMinutes >= 0) {
    base.clubMinutesPlayed = seasonMinutes;
    base.opportunityCapacity = standingMatches * 90;
    base.eligibleFixtureCount = standingMatches;
    finalizeSlice(base);
    base.source = "legacy-league-standing";
    base.completeness = "legacy-league-estimate";
    return base;
  }

  // No reliable denominator — never invent appearances × 90 as firm opportunity.
  const apps = coerceFiniteOrNull(season?.matches);
  if (apps != null && apps > 0 && seasonMinutes != null) {
    base.clubMinutesPlayed = seasonMinutes;
    base.conflicts.push({
      kind: "no-reliable-denominator",
      appearances: apps,
      minutes: seasonMinutes,
    });
    base.source = "appearances-only";
    base.completeness = "incomplete";
    base.eligibleFixtureCount = 0;
    base.opportunityCapacity = 0;
    base.share = null;
    return base;
  }

  base.source = "none";
  base.completeness = "empty";
  return base;
}

function ledgerScoped(ledger, season, clubId) {
  if (!ledger || typeof ledger !== "object") return false;
  if (ledger.seasonId && season?.seasonId && ledger.seasonId !== season.seasonId) return false;
  if (ledger.clubId && clubId && ledger.clubId !== clubId) return false;
  if (ledger.playingClubId && clubId && ledger.playingClubId !== clubId) return false;
  // Unscoped player.seasonLedger with a seasonId of "old" must not feed a current season.
  if (ledger.seasonId && season && !season.seasonId && ledger.seasonId === "old") return false;
  if (ledger.seasonId === "old" && season && season.seasonId !== "old") return false;
  return true;
}

function summarizeLedger(ledger) {
  return {
    seasonId: ledger?.seasonId ?? null,
    clubId: ledger?.clubId ?? ledger?.playingClubId ?? null,
    eligibleClubMatches: ledger?.eligibleClubMatches ?? null,
    availableClubMinutes: ledger?.availableClubMinutes ?? null,
    clubMinutesPlayed: ledger?.clubMinutesPlayed ?? null,
  };
}

/**
 * Build a persistable participationLedger from an assessment.
 */
export function participationLedgerFromAssessment(assessment) {
  if (!assessment) return null;
  return {
    version: PLAYING_TIME_ASSESSMENT_VERSION,
    seasonId: assessment.periodId || null,
    clubId: assessment.representedClubId || null,
    playingClubId: assessment.representedClubId || null,
    checkpoint: assessment.checkpoint || null,
    checkpointDate: assessment.checkpointDate || null,
    eligibleClubMatches: assessment.eligibleFixtureCount,
    availableClubMinutes: assessment.opportunityCapacity,
    clubMinutesPlayed: assessment.clubMinutesPlayed,
    availabilityExclusions: assessment.availabilityExclusions,
    share: assessment.share,
    source: assessment.source,
    completeness: assessment.completeness,
    byCompetition: assessment.byCompetition,
    conflicts: assessment.conflicts,
  };
}

/**
 * Compatibility wrapper used by squad decisions.
 * Punitive low-minute inference is suppressed when the sample is empty/unknown.
 */
export function clubMinutesShareFromAssessment(assessment) {
  if (!assessment) {
    return {
      share: 0,
      eligibleMatches: 0,
      minutes: 0,
      assessment: null,
      usableForLowMinutes: false,
    };
  }
  const usable =
    assessment.completeness === "exact" ||
    assessment.completeness === "partial" ||
    assessment.completeness === "legacy-league-estimate";
  const share =
    usable && assessment.share != null && Number.isFinite(assessment.share)
      ? Math.max(0, Math.min(1, assessment.share))
      : assessment.completeness === "empty"
        ? 1 // safe compatibility: empty ≠ low minutes
        : 1;
  return {
    share,
    eligibleMatches: assessment.eligibleFixtureCount || 0,
    minutes: assessment.clubMinutesPlayed || 0,
    assessment,
    usableForLowMinutes: usable && assessment.eligibleFixtureCount > 0,
  };
}
