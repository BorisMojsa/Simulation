/**
 * Central recruitment / review / wage thresholds.
 * Gameplay tuning — not claimed real-world laws.
 */
export const RECRUITMENT_CONFIG_VERSION = "recruitment-v1-2026-10-09";

/** Role readiness gaps vs club starter benchmark (same scale as selection). */
export const ROLE_GAPS = {
  starter: 0,
  rotation: -4,
  cover: -7,
  prospectMax: -12,
};

/** Club sporting strength bands for eligibility messaging / calibration. */
export const CLUB_STRENGTH_BANDS = {
  eliteSeniorMinOverall: 82,
  strongSeniorMinOverall: 76,
  midMinOverall: 68,
};

export const SCOUTING = {
  /** Noise (OVR points) on true ability for assessed readiness. */
  readinessNoiseSd: 2.2,
  /** Noise on latent potential for assessed upside (never perfect knowledge). */
  upsideNoiseSd: 4.5,
  tinySampleShrink: 0.35,
  minMatchesForFullEvidence: 12,
};

export const PROSPECT_PATHWAY = {
  maxAge: 21,
  minAssessedUpside: 78,
  maxReadinessGap: 12,
  /** Probability after hard gates pass. */
  offerProbability: 0.08,
  maxWeeklyWageGbp: 8000,
};

export const SQUAD_REVIEW = {
  developmentLoanAges: [17, 23],
  lowMinutesShare: 0.22,
  midSeasonMinEligibleMatches: 10,
  loanDestinationMinMinutesShare: 0.5,
  loanMinutesImprovement: 0.2,
  decisionCooldownDays: 90,
};

export const CONTRACT_RULES = {
  under18MaxYears: 3,
  adultMaxYears: 5,
  under18Age: 18,
};

/** Declared FX snapshot (source currencies → GBP). Versioned estimates. */
export const FX_SNAPSHOT = {
  version: "fx-2026-10-09",
  asOf: "2026-10-09",
  toGbp: {
    GBP: 1,
    EUR: 0.86,
    USD: 0.78,
    BRL: 0.14,
    ARS: 0.00078,
    COP: 0.00019,
    TRY: 0.023,
    MXN: 0.046,
    CZK: 0.034,
    NOK: 0.074,
    DKK: 0.115,
    PLN: 0.2,
    RSD: 0.0073,
  },
};
