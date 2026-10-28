/**
 * Club continental player-registration policy stubs.
 * Domestic association windows live in registrationWindows.js; this governs
 * whether a newly registered player may attach to an existing edition's fixtures.
 *
 * Do not hardcode calendar-year absolute deadlines into all seasons — use
 * day-of-year / stage gates keyed by format.ruleVersion.
 */

/** UEFA 2026/27-style subsequent registration: KO additions after league phase. */
const UEFA_LEAGUE_PHASE_SUBSEQUENT = {
  subsequentAllowedFromStage: "playoff",
  /** Feb 4 ≈ day 35 of calendar year following mid-season (CET). */
  deadlineDayOfYear: 35,
  newPlayerQuota: 3,
  leaguePhaseImmediate: false,
};

/**
 * Resolve registration policy for a competition format object.
 * Non-UEFA confederations: in-field + domestic registration only (no UEFA deadlines).
 */
export function registrationPolicyForFormat(format) {
  if (!format) return { subsequentAllowedFromStage: null, deadlineDayOfYear: null, newPlayerQuota: null, leaguePhaseImmediate: false };
  if (format.playerRegistration) return { ...format.playerRegistration };
  if (format.confederation === "UEFA" && String(format.ruleVersion || "").includes("league-phase")) {
    return { ...UEFA_LEAGUE_PHASE_SUBSEQUENT };
  }
  return {
    subsequentAllowedFromStage: null,
    deadlineDayOfYear: null,
    newPlayerQuota: null,
    leaguePhaseImmediate: true,
  };
}

/**
 * Whether the player may attach to a fixture for `playingClubId` in this edition.
 * Assumes domestic registration is already valid for the date.
 *
 * @returns {{ ok: boolean, reason?: string }}
 */
export function canAttachToContinentalFixture({
  edition,
  playingClubId,
  fixture,
  registrationEffectiveDate = null,
} = {}) {
  if (!edition || !playingClubId || !fixture) {
    return { ok: false, reason: "missing-args" };
  }
  const inField =
    Array.isArray(edition.field) &&
    edition.field.some((c) => (c.clubId || c) === playingClubId);
  if (!inField) return { ok: false, reason: "not-in-field" };

  const involved =
    fixture.homeClubId === playingClubId || fixture.awayClubId === playingClubId;
  if (!involved) return { ok: false, reason: "not-fixture-participant" };

  const policy = registrationPolicyForFormat(edition.format);
  const focusId = edition.playerClubId;
  // Still representing the edition focus club: always allowed when registered.
  if (playingClubId === focusId) return { ok: true };

  // Destination attachment into an ongoing edition.
  if (policy.leaguePhaseImmediate === false && fixture.stageType === "league") {
    return { ok: false, reason: "league-phase-not-immediate" };
  }
  if (policy.subsequentAllowedFromStage) {
    const path = edition.format?.knockout?.path || [];
    const minIdx = path.indexOf(policy.subsequentAllowedFromStage);
    const stageIdx = path.indexOf(fixture.stageId || fixture.round);
    if (minIdx >= 0 && (stageIdx < 0 || stageIdx < minIdx) && fixture.stageType !== "knockout") {
      return { ok: false, reason: "before-subsequent-stage" };
    }
    if (fixture.stageType === "league" || fixture.stageType === "groups") {
      return { ok: false, reason: "subsequent-knockout-only" };
    }
  }
  if (policy.deadlineDayOfYear != null && registrationEffectiveDate) {
    const d = new Date(`${registrationEffectiveDate}T12:00:00Z`);
    if (!Number.isNaN(d.getTime())) {
      const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 0));
      const day = Math.floor((d - start) / 86400000);
      // Mid-season winter window uses the calendar year of the deadline (often Jan–Feb).
      if (d.getUTCMonth() <= 5 && day > policy.deadlineDayOfYear) {
        return { ok: false, reason: "past-subsequent-deadline" };
      }
    }
  }
  return { ok: true };
}
