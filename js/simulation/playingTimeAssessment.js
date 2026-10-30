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

  const seasonClubId =
    season?.playingClubId || season?.clubId || season?.club?.clubId || null;
  const seasonClubMismatch =
    Boolean(representedClubId) &&
    Boolean(seasonClubId) &&
    representedClubId !== seasonClubId;

  // Explicit participationLedger — only when scoped to this period/club.
  // A prior club's season must not feed the live club's opportunity sample.
  const ledger = !seasonClubMismatch ? season?.participationLedger || null : null;
  const playerLedger = player?.seasonLedger || null;
  const candidate =
    (ledger && ledgerScoped(ledger, season, representedClubId) && ledger) ||
    (playerLedger &&
      ledgerScoped(playerLedger, season, representedClubId, { requirePeriodProof: true }) &&
      playerLedger) ||
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
  if (seasonClubMismatch) {
    base.conflicts.push({
      kind: "prior-club-season-ignored-for-live-club",
      seasonClubId,
      representedClubId,
    });
    base.source = "none";
    base.completeness = "empty";
    return base;
  }

  // Legacy league-only estimate: standing.matches as opportunity count when known.
  // Prefer proved league-only minutes with league-only opportunities. Never mix
  // club+international or league+cup numerators with league-only capacity.
  const standingMatches = coerceFiniteOrNull(season?.standing?.matches);
  const clubOnlyMinutes =
    coerceFiniteOrNull(season?.clubMinutes) ??
    coerceFiniteOrNull(season?.ledgerSummary?.club?.minutes);
  const internationalMinutes = coerceFiniteOrNull(season?.ledgerSummary?.international?.minutes);
  const combinedMinutes = coerceFiniteOrNull(season?.minutes);
  const nonLeagueClub = legacyNonLeagueClubMinutes(season);
  if (standingMatches != null && standingMatches > 0) {
    let seasonMinutes = null;
    const leagueOnlyHint =
      coerceFiniteOrNull(season?.leagueMinutes) ??
      coerceFiniteOrNull(season?.ledgerSummary?.league?.minutes) ??
      null;

    // Trustworthy explicit league numerator wins before non-league subtraction gaps.
    if (leagueOnlyHint != null && leagueOnlyHint >= 0) {
      seasonMinutes = leagueOnlyHint;
    } else if (nonLeagueClub.incomplete) {
      base.conflicts.push({
        kind: "legacy-non-league-incomplete",
        clubMinutes: clubOnlyMinutes,
        nonLeagueMinutes: nonLeagueClub.minutes,
        standingMatches,
        reasons: nonLeagueClub.reasons,
      });
      base.source = "legacy-mixed-incomplete";
      base.completeness = "incomplete";
      base.share = null;
      base.eligibleFixtureCount = 0;
      base.opportunityCapacity = 0;
      return base;
    } else if (nonLeagueClub.minutes > 0) {
      // League standing capacity cannot absorb cup/continental minutes.
      if (
        clubOnlyMinutes != null &&
        clubOnlyMinutes >= nonLeagueClub.minutes &&
        Number.isFinite(clubOnlyMinutes - nonLeagueClub.minutes)
      ) {
        seasonMinutes = clubOnlyMinutes - nonLeagueClub.minutes;
      } else {
        base.conflicts.push({
          kind: "legacy-league-cup-mixed",
          clubMinutes: clubOnlyMinutes,
          cupMinutes: nonLeagueClub.minutes,
          continentalMinutes: nonLeagueClub.continentalMinutes,
          domesticCupMinutes: nonLeagueClub.domesticCupMinutes,
          standingMatches,
        });
        base.source = "legacy-mixed-incomplete";
        base.completeness = "incomplete";
        base.share = null;
        base.eligibleFixtureCount = 0;
        base.opportunityCapacity = 0;
        return base;
      }
    } else if (clubOnlyMinutes != null && clubOnlyMinutes >= 0) {
      // Explicit club-only minutes are valid even when an international summary exists.
      seasonMinutes = clubOnlyMinutes;
    } else if (
      combinedMinutes != null &&
      internationalMinutes != null &&
      internationalMinutes > 0
    ) {
      base.conflicts.push({
        kind: "mixed-minute-populations",
        combinedMinutes,
        clubMinutes: clubOnlyMinutes,
        internationalMinutes,
        standingMatches,
      });
      base.source = "legacy-mixed-incomplete";
      base.completeness = "incomplete";
      base.share = null;
      base.eligibleFixtureCount = 0;
      base.opportunityCapacity = 0;
      return base;
    } else if (
      combinedMinutes != null &&
      combinedMinutes >= 0 &&
      (internationalMinutes == null || internationalMinutes === 0)
    ) {
      seasonMinutes = combinedMinutes;
    } else if (combinedMinutes != null && combinedMinutes >= 0) {
      seasonMinutes = combinedMinutes;
    }

    if (seasonMinutes != null) {
      base.clubMinutesPlayed = seasonMinutes;
      base.opportunityCapacity = standingMatches * 90;
      base.eligibleFixtureCount = standingMatches;
      finalizeSlice(base);
      base.source = "legacy-league-standing";
      base.completeness = "legacy-league-estimate";
      return base;
    }
  }
  const seasonMinutes = combinedMinutes ?? clubOnlyMinutes;

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

function ledgerScoped(ledger, season, clubId, opts = {}) {
  if (!ledger || typeof ledger !== "object") return false;
  // Period membership must be proved. Missing or mismatched identity is uncertainty.
  if (ledger.seasonId) {
    if (!season?.seasonId) return false;
    if (ledger.seasonId !== season.seasonId) return false;
  } else if (season?.seasonId) {
    return false;
  } else if (opts.requirePeriodProof) {
    // Unscoped player-level cache with no period ids on either side is not proof.
    return false;
  }
  const ledgerClub = ledger.clubId || ledger.playingClubId || null;
  if (ledgerClub) {
    if (clubId && ledgerClub !== clubId) return false;
  } else if (clubId) {
    // Requested club but ledger declares none — unproven membership.
    return false;
  }
  return true;
}

/**
 * Inspect a legacy playerMatches list. Returns contribution metadata; never invents IDs.
 * Incomplete/unprovable participation or minutes set incomplete on the accumulator.
 */
function inspectLegacyMatchRows(rows, bucket, acc, { missingRowsIsGap = false } = {}) {
  const out = {
    labeledMinutes: new Map(), // id -> minutes
    unidentifiedMinutes: 0,
    hasPositive: false,
    hasUnidentifiedPositive: false,
  };
  if (rows == null) {
    if (missingRowsIsGap) {
      acc.incomplete = true;
      acc.reasons.push(`missing-rows-${bucket}`);
    }
    return out;
  }
  if (!Array.isArray(rows)) {
    acc.incomplete = true;
    acc.reasons.push(`non-array-${bucket}`);
    return out;
  }
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      acc.incomplete = true;
      acc.reasons.push(`invalid-row-${bucket}`);
      continue;
    }
    const mins = coerceFiniteOrNull(row?.playerStats?.minutes ?? row?.minutes);
    if (mins == null) {
      const played = row.played ?? row.playerStats?.played;
      if (played === false) continue;
      acc.incomplete = true;
      acc.reasons.push(
        played === true ? `unknown-minutes-${bucket}` : `unknown-participation-${bucket}`
      );
      continue;
    }
    if (mins <= 0) continue;
    out.hasPositive = true;
    const id = row.fixtureId || row.matchId || null;
    if (id) {
      // Same view repeating an id — keep first contribution only.
      if (!out.labeledMinutes.has(id)) out.labeledMinutes.set(id, mins);
    } else {
      out.hasUnidentifiedPositive = true;
      out.unidentifiedMinutes += mins;
    }
  }
  return out;
}

/**
 * Sum proved non-league club minutes from legacy season campaign views.
 * Domestic primary/campaign views may alias; only fixture/match identity proves
 * distinct fixtures. Partial or missing identity across multiple views is unknown.
 */
function legacyNonLeagueClubMinutes(season) {
  const reasons = [];
  const acc = { incomplete: false, reasons };
  let continentalMinutes = 0;

  /** @type {{ label: string, rows: any }[]} */
  const domesticViews = [];
  if (season?.domesticCupResult?.playerMatches != null) {
    domesticViews.push({ label: "primary-cup", rows: season.domesticCupResult.playerMatches });
  }
  const campaigns = season?.domesticCupCampaigns;
  if (campaigns != null) {
    if (!Array.isArray(campaigns)) {
      acc.incomplete = true;
      reasons.push("non-array-domesticCupCampaigns");
    } else {
      campaigns.forEach((camp, i) => {
        if (camp?.playerMatches != null) {
          domesticViews.push({ label: `domestic-campaign:${i}`, rows: camp.playerMatches });
        }
      });
    }
  }

  const viewStats = domesticViews.map((v) => ({
    label: v.label,
    ...inspectLegacyMatchRows(v.rows, v.label, acc),
  }));
  const positiveViews = viewStats.filter((v) => v.hasPositive);

  let domesticCupMinutes = 0;
  if (positiveViews.length > 1 && positiveViews.some((v) => v.hasUnidentifiedPositive)) {
    // Multiple domestic views with at least one unidentified contribution — overlap unproved.
    acc.incomplete = true;
    reasons.push("unidentified-overlap");
  } else if (positiveViews.length === 0) {
    domesticCupMinutes = 0;
  } else if (positiveViews.length === 1) {
    // Single view: unidentified minutes are fine (no cross-view alias risk).
    const v = positiveViews[0];
    for (const mins of v.labeledMinutes.values()) domesticCupMinutes += mins;
    domesticCupMinutes += v.unidentifiedMinutes;
  } else {
    // All positive views are fully identified — dedupe across views by fixture/match id.
    const seen = new Map();
    for (const v of positiveViews) {
      for (const [id, mins] of v.labeledMinutes) {
        if (!seen.has(id)) seen.set(id, mins);
      }
    }
    for (const mins of seen.values()) domesticCupMinutes += mins;
  }

  if (season?.europeanCampaign?.qualified) {
    const cont = inspectLegacyMatchRows(season?.europeanCampaign?.playerMatches, "continental", acc, {
      missingRowsIsGap: true,
    });
    for (const mins of cont.labeledMinutes.values()) continentalMinutes += mins;
    continentalMinutes += cont.unidentifiedMinutes;
  } else if (season?.europeanCampaign?.playerMatches != null) {
    const cont = inspectLegacyMatchRows(season?.europeanCampaign?.playerMatches, "continental", acc);
    for (const mins of cont.labeledMinutes.values()) continentalMinutes += mins;
    continentalMinutes += cont.unidentifiedMinutes;
  }

  return {
    minutes: domesticCupMinutes + continentalMinutes,
    domesticCupMinutes,
    continentalMinutes,
    incomplete: acc.incomplete,
    reasons,
  };
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
