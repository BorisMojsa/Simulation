/**
 * Preseason club finish expectations for overachievement credit.
 *
 * Freeze sporting-strength rank before the league season (or stint) begins.
 * Later form, transfers of the user, and the final points table must not rewrite
 * an already-frozen baseline for the same edition.
 */
import { effectiveTeamStrength } from "./teamStrength.js?v=91";

function clubKey(club) {
  if (!club) return null;
  return club.clubId || club.name || null;
}

/**
 * Rank clubs by sporting strength (higher overall → better expected finish).
 * @returns {{ clubId: string|null, name: string|null, strength: number, expectedPosition: number }[]}
 */
export function rankClubsBySportingStrength(clubs, worldState = null) {
  const rows = (clubs || [])
    .filter((c) => c && (c.clubId || c.name))
    .map((c) => {
      const eff = effectiveTeamStrength(c, { worldState });
      // Prefer the edition's scalar overall when runtime strength is an unprofiled
      // neutral fallback — matches how callers seed chrono table strength for known clubs.
      const scalar = Number(c.overall);
      const estimated =
        Boolean(eff?.unitsEstimated) ||
        eff?.profile?.sourceType === "runtime_fallback" ||
        eff?.componentDerivationStatus === "derived_neutral";
      const strength =
        Number.isFinite(scalar) && estimated ? scalar : Number(eff?.overall ?? scalar);
      return {
        clubId: c.clubId || null,
        name: c.name || null,
        displayName: c.displayName || c.name || null,
        strength,
      };
    })
    .filter((r) => Number.isFinite(r.strength));
  rows.sort(
    (a, b) =>
      b.strength - a.strength ||
      String(a.clubId || a.name).localeCompare(String(b.clubId || b.name))
  );
  return rows.map((r, i) => ({ ...r, expectedPosition: i + 1 }));
}

/**
 * Freeze expected finish for a club in an edition.
 * @returns {object} expectation receipt
 */
export function freezeClubExpectedFinish({
  clubs,
  club,
  worldState = null,
  leagueId = null,
  editionId = null,
  source = "preseason-sporting-strength",
} = {}) {
  const ranked = rankClubsBySportingStrength(clubs, worldState);
  const key = clubKey(club);
  const row = ranked.find(
    (r) => (club?.clubId && r.clubId === club.clubId) || (club?.name && r.name === club.name) || (key && (r.clubId === key || r.name === key))
  );
  if (!row || ranked.length < 2) {
    return {
      expectedPosition: null,
      teamCount: ranked.length,
      leagueId: leagueId || null,
      editionId: editionId != null ? String(editionId) : null,
      source,
      status: "missing-evidence",
      strength: null,
      frozenAt: "preseason",
      rankedClubIds: ranked.map((r) => r.clubId || r.name),
    };
  }
  return {
    expectedPosition: row.expectedPosition,
    teamCount: ranked.length,
    leagueId: leagueId || null,
    editionId: editionId != null ? String(editionId) : null,
    source,
    status: "frozen",
    strength: row.strength,
    clubId: row.clubId,
    clubName: row.name,
    frozenAt: "preseason",
    rankedClubIds: ranked.map((r) => r.clubId || r.name),
  };
}

/**
 * Resolve which frozen expectation to use for development credit.
 * Prefers an explicit freeze; falls back to strength ranking of the final table
 * only with status "legacy-table-strength" (final points must not be used).
 */
export function resolveExpectedFinish({
  frozen = null,
  table = null,
  club = null,
} = {}) {
  if (frozen?.status === "frozen" && Number.isFinite(frozen.expectedPosition)) {
    return { ...frozen, used: "frozen" };
  }
  if (frozen?.status === "missing-evidence") {
    return { ...frozen, used: "missing-evidence" };
  }
  // Legacy fallback: rank by table.strength (preseason scalar on records), never by points.
  if (Array.isArray(table) && table.length >= 2 && club) {
    const ranked = [...table]
      .filter((r) => Number.isFinite(Number(r.strength)))
      .sort(
        (a, b) =>
          Number(b.strength) - Number(a.strength) ||
          String(a.clubId || a.name).localeCompare(String(b.clubId || b.name))
      );
    const idx = ranked.findIndex(
      (r) => (club.clubId && r.clubId === club.clubId) || (club.name && r.name === club.name)
    );
    if (idx >= 0) {
      return {
        expectedPosition: idx + 1,
        teamCount: ranked.length,
        source: "legacy-table-strength",
        status: "legacy-fallback",
        used: "legacy-fallback",
        clubId: club.clubId || null,
        clubName: club.name || null,
      };
    }
  }
  return {
    expectedPosition: null,
    teamCount: null,
    source: null,
    status: "missing-evidence",
    used: "missing-evidence",
  };
}

/**
 * Participation-weighted overachievement credit in overall points (before shared cap).
 * Places gained × scale × minutes/reliability/performance factors.
 */
export function computeOverachievementContribution({
  expectedPosition = null,
  actualPosition = null,
  usefulMinutes = 0,
  reliability = 0,
  seasonP = null,
  teamCount = null,
  minuteTarget = 2400,
  maxContribution = 0.55,
  placeScale = 0.08,
} = {}) {
  if (!Number.isFinite(expectedPosition) || !Number.isFinite(actualPosition)) {
    return {
      places: 0,
      raw: 0,
      contribution: 0,
      participationWeight: 0,
      performanceFactor: 0,
      receipt: { status: "no-finish-pair" },
    };
  }
  const places = Math.max(0, expectedPosition - actualPosition);
  if (places <= 0) {
    return {
      places: 0,
      raw: 0,
      contribution: 0,
      participationWeight: 0,
      performanceFactor: 0,
      receipt: {
        status: "met-or-under",
        expectedPosition,
        actualPosition,
      },
    };
  }
  const mins = Math.max(0, Number(usefulMinutes) || 0);
  const target = Math.max(600, Number(minuteTarget) || 2400);
  // Regular ~1.0 at target minutes; bench/late arrival well below.
  const minutesFactor = Math.min(1, Math.pow(mins / target, 0.85));
  const rel = Math.max(0, Math.min(1, Number(reliability) || 0));
  const p = Number.isFinite(seasonP) ? Math.max(0, Math.min(1, seasonP)) : 0.45;
  // Strong individual play amplifies; poor play still allows reduced team credit.
  const performanceFactor = 0.35 + 0.65 * p;
  const participationWeight = minutesFactor * (0.4 + 0.6 * rel);
  const sizeNorm =
    Number.isFinite(teamCount) && teamCount > 1 ? Math.min(1.15, 20 / teamCount) : 1;
  const raw = places * placeScale * sizeNorm * participationWeight * performanceFactor;
  const contribution = Math.max(0, Math.min(maxContribution, raw));
  return {
    places,
    raw,
    contribution,
    participationWeight,
    performanceFactor,
    minutesFactor,
    receipt: {
      status: "credited",
      expectedPosition,
      actualPosition,
      places,
      usefulMinutes: mins,
      reliability: rel,
      seasonP: Number.isFinite(seasonP) ? seasonP : null,
      teamCount,
      contribution,
    },
  };
}
