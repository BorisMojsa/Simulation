/**
 * Fix 07 audit exporter: club playing-time opportunity, contract continuity and
 * free-agent recovery.
 *
 * Run from repo root:
 *   node scripts/qaPlayingTimeContractRecovery.mjs
 *   FIX07_QUICK=1 node scripts/qaPlayingTimeContractRecovery.mjs   # smoke subset
 * Exits non-zero (process.exitCode = 1) when any required invariant fails.
 *
 * Cohorts
 *   ordinary  — 12 seeded careers x 4 periods = 48 records. ST/CM/CB/GK, three
 *               readiness setups, several clubs / leagues / nationalities, and the
 *               four decision policies (renewal-first, beneficial-loan-first,
 *               accept-suitable-free-agent-offer, stay).
 *   dedicated — labelled separately and NOT counted toward the ordinary 48:
 *                 stay-opportunity (Hull 58 + Atalanta 72, seed 707),
 *                 one-year renewal, FA recovery after an empty review,
 *                 exhausted empty control, pause/restore, cross-league loan.
 *
 * The expected opportunity numbers come from an independent oracle that walks
 * `season.ledgerRecords` itself (dedupe by fixture, drop international and
 * other-club rows, exclude unavailable fixtures, sum minutes / capacity). It
 * NEVER calls assessClubPlayingTime / collectClubOpportunityRecords; production
 * values are read back from `season.playingTimeAssessment`,
 * `season.participationLedger` and `clubMinutesShare` and compared with it.
 *
 * FIX07_QUICK=1: 2 careers x 2 periods + every dedicated case.
 *
 * Outputs: qa/fix07-runs/audit/cases[-quick]/*.json and
 *          qa/fix07-runs/audit/summary[-quick].json
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { LEAGUES, LEAGUE_LOOKUP, LEAGUE_BY_ID } from "../js/data/leagues.js";
import { SQUAD_REVIEW } from "../js/config/recruitmentConfig.js";
import { reseedCareerRng, createRng, setSimRng } from "../js/simulation/rng.js";
import { createPlayerIdentity } from "../js/simulation/playerDevelopment.js";
import { ensurePlayerModel } from "../js/simulation/playerModelMigration.js";
import { refreshAbilityCaches } from "../js/simulation/playerAbility.js";
import { ensureTransferSave } from "../js/simulation/transferMigration.js";
import { createWorldState, setWorldState, getWorldState } from "../js/simulation/worldState.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import { allSeniorClubs } from "../js/simulation/seniorClubs.js";
import { clubMinutesShare, resolveSquadDecision } from "../js/simulation/squadDecisions.js";
import {
  generatePipelineOffers,
  acceptPipelineOffer,
  closeFreeAgentMarketReview,
} from "../js/simulation/dealPipeline.js";
import { generateTransferOffers } from "../js/simulation/transferMarket.js";
import { startLoan } from "../js/simulation/loanMarket.js";
import { resolveMoveRegistration } from "../js/simulation/destinationSchedule.js";
import {
  ensureContractAuthority,
  assertPlayableRegistration,
  isFreeAgent,
  isContractActive,
  declineWindowAndContinue,
} from "../js/simulation/contractLifecycle.js";
import { applySeniorScenarioPolicy } from "../js/simulation/seniorCareerScenarios.js";
import {
  serializeCareerSnapshot,
  deserializeCareerSnapshot,
} from "../js/simulation/careerSnapshot.js";

const QUICK = process.env.FIX07_QUICK === "1";
const OUT = "qa/fix07-runs/audit";
const CASES = `${OUT}/cases${QUICK ? "-quick" : ""}`;
const SUMMARY = `${OUT}/summary${QUICK ? "-quick" : ""}.json`;
mkdirSync(CASES, { recursive: true });

const START_YEAR = 2026;
const EPS = 1e-12;
const LOW_MINUTES_SHARE = 0.22; // literal brief value; cross-checked below
const PINNED_HULL = Object.freeze({ minutes: 511, eligible: 42, capacity: 3780 });

/* ------------------------------------------------------------------ */
/* Generic helpers                                                     */
/* ------------------------------------------------------------------ */

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const approx = (a, b, eps = EPS) =>
  typeof a === "number" && typeof b === "number" && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps;
const approxOrBothNull = (a, b) => (a == null && b == null) || approx(a, b);

function numbersFinite(obj, path = "", bad = []) {
  if (obj == null) return bad;
  if (typeof obj === "number") {
    if (!Number.isFinite(obj)) bad.push(path);
    return bad;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => numbersFinite(v, `${path}[${i}]`, bad));
    return bad;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) numbersFinite(v, path ? `${path}.${k}` : k, bad);
  }
  return bad;
}

/* ------------------------------------------------------------------ */
/* Independent oracle: enumerate ledgerRecords ourselves               */
/* ------------------------------------------------------------------ */

const INTERNATIONAL_TYPES = new Set(["international", "nationalTeam", "national"]);
const UNAVAILABLE = new Set([
  "injured",
  "unavailable",
  "suspended",
  "registration-ineligible",
  "ineligible",
  "not_registered",
  "not-registered",
]);
const ELIGIBLE_ZERO = new Set(["unused_substitute", "unused", "bench", "rested", "not_selected", "not-selected"]);

const finiteOrNull = (v) =>
  v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);

const oracleIsInternational = (r) =>
  r.isInternational === true ||
  r.international === true ||
  r.teamType === "national" ||
  INTERNATIONAL_TYPES.has(r.competitionType);

function oracleBucket(r) {
  const t = r.competitionType || "league";
  if (t === "league") return "league";
  if (t === "domesticCup" || t === "cup") return "domesticCup";
  if (t === "continental" || t === "europe" || t === "european") return "continental";
  return t;
}

function oracleFixtureKey(r) {
  const id = r.matchId ?? r.fixtureId ?? null;
  if (id != null && id !== "") return `id:${id}`;
  const parts = [
    r.competitionId ?? "",
    r.editionId ?? r.competitionEditionId ?? "",
    r.date ?? "",
    r.teamId ?? "",
    r.opponentId ?? "",
  ];
  return parts.every((p) => p === "") ? null : `k:${parts.join("|")}`;
}

function oracleStatus(r) {
  if (r.available === true) return "available";
  if (r.available === false) return "unavailable";
  const reason = String(r.nonParticipationReason || r.reason || "");
  if (UNAVAILABLE.has(reason)) return "unavailable";
  if (ELIGIBLE_ZERO.has(reason)) return "available";
  const m = finiteOrNull(r.minutes);
  if (m != null && m > 0) return "available";
  return "unknown";
}

function oracleCapacity(r) {
  for (const f of ["availableMinutes", "matchDuration", "capacityMinutes"]) {
    const v = finiteOrNull(r[f]);
    if (v != null) return v > 0 ? { value: v, assumed: false } : { value: 90, assumed: true };
  }
  return { value: 90, assumed: true };
}

/**
 * Walk raw ledger rows for a represented club. `checkpointDate` mirrors the
 * mid-season rule (rows dated after the checkpoint are not yet played).
 */
function oracleOpportunity(rows, representedClubId, { checkpointDate = null } = {}) {
  const seen = new Set();
  const by = { league: blank(), domesticCup: blank(), continental: blank() };
  const total = blank();
  const stats = {
    rowsInput: rows.length,
    international: 0,
    otherClub: 0,
    duplicate: 0,
    afterCheckpoint: 0,
    unavailable: 0,
    unknown: 0,
    eligible: 0,
    durationAssumed: 0,
    includedKeys: [],
  };
  const clubs = {}; // every non-international club's own totals (context + conservation check)
  function blank() {
    return { minutes: 0, capacity: 0, eligible: 0, exclusions: 0 };
  }

  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    if (oracleIsInternational(r)) {
      stats.international += 1;
      continue;
    }
    const tid = r.teamId || r.clubId || null;
    const club = (clubs[tid || "unattributed"] ||= { rows: 0, minutes: 0 });
    club.rows += 1;
    club.minutes += Math.max(0, finiteOrNull(r.minutes) ?? 0);
    if (representedClubId && tid && tid !== representedClubId) {
      stats.otherClub += 1;
      continue;
    }
    if (checkpointDate && r.date && String(r.date) > String(checkpointDate)) {
      stats.afterCheckpoint += 1;
      continue;
    }
    const key = oracleFixtureKey(r);
    if (key) {
      if (seen.has(key)) {
        stats.duplicate += 1;
        continue;
      }
      seen.add(key);
    }
    const bucket = oracleBucket(r);
    const slice = (by[bucket] ||= blank());
    const status = oracleStatus(r);
    if (status === "unavailable") {
      stats.unavailable += 1;
      total.exclusions += 1;
      slice.exclusions += 1;
      continue;
    }
    if (status === "unknown") {
      stats.unknown += 1;
      continue;
    }
    const cap = oracleCapacity(r);
    const capacity = cap?.value && cap.value > 0 ? cap.value : 90;
    if (cap?.assumed) stats.durationAssumed += 1;
    const minutes = Math.max(0, finiteOrNull(r.minutes) ?? 0);
    for (const s of [total, slice]) {
      s.minutes += minutes;
      s.capacity += capacity;
      s.eligible += 1;
    }
    stats.eligible += 1;
    if (key) stats.includedKeys.push(key);
  }
  const share = (s) => (s.capacity > 0 && s.eligible > 0 ? s.minutes / s.capacity : null);
  return {
    ...total,
    share: share(total),
    byCompetition: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { ...v, share: share(v) }])),
    stats,
    clubs,
    expectedCompleteness:
      total.eligible <= 0
        ? stats.unknown > 0
          ? "incomplete"
          : "empty"
        : stats.unknown > 0 || stats.durationAssumed > 0
          ? "partial"
          : "exact",
  };
}

/** Independent re-statement of the consecutive-empty counter from spell history. */
function oracleEmptyStreak(history) {
  let streak = 0;
  for (const h of history || []) {
    const c = h.classification;
    if (c === "refusal" || c === "offers-present") streak = 0;
    else if (["empty", "empty-before-wait", "interest-gate", "exhausted"].includes(c)) streak += 1;
  }
  return streak;
}

/* ------------------------------------------------------------------ */
/* Player factory                                                      */
/* ------------------------------------------------------------------ */

const ATTR_KEYS = ["Speed", "Passing", "Shooting", "Defending", "Physicality", "Dribbling"];
function makeAttrs(position, rating) {
  if (position === "GK") {
    return {
      Diving: rating,
      Handling: rating,
      Kicking: rating - 2,
      Reflexes: rating,
      Speed: Math.max(40, rating - 15),
      Positioning: rating,
    };
  }
  const attrs = Object.fromEntries(ATTR_KEYS.map((k) => [k, rating]));
  attrs.Defending = rating - 8;
  return attrs;
}

const READINESS = {
  fit: { readiness: 1, fatigue: 0, form: 0 },
  reduced: { readiness: 0.85, fatigue: 0.2, form: -0.1 },
  low: { readiness: 0.6, fatigue: 0.4, form: -0.2 },
};

function seniorClubFor({ clubName, leagueId, clubIndex = 0 }) {
  const all = allSeniorClubs();
  const club = clubName
    ? all.find((c) => c.name === clubName)
    : all.filter((c) => c.leagueId === leagueId)[clubIndex] || all.find((c) => c.leagueId === leagueId);
  if (!club) throw new Error(`no senior club for ${clubName || leagueId}#${clubIndex}`);
  return club;
}

function makePlayer({
  seed,
  position = "ST",
  rating = 72,
  age = 21,
  nationality = "Serbia",
  careerId,
  clubName = null,
  leagueId = null,
  clubIndex = 0,
  contractEndSeason = 4,
  weeklyWage = 2500,
  setup = "fit",
  free = false,
} = {}) {
  resetClubFinanceLedgers();
  reseedCareerRng(seed);
  setWorldState(createWorldState({ startYear: START_YEAR }));
  const p = createPlayerIdentity({ name: `Fix07-${position}-${seed}`, nationality, position, age });
  Object.assign(p, {
    careerId: careerId || `fix07-${seed}-${position}`,
    startYear: START_YEAR,
    age,
    club: null,
    seasons: [],
    contractStatus: "released",
    contractEndSeason: 0,
    employmentClubId: null,
    playingClubId: null,
    weeklyWage: 0,
    wage: 0,
    rating,
    attributes: makeAttrs(position, rating),
    potentialForecast: { upper: rating + 8 },
    state: { adaptationPenalty: 0, roleFit: 1, ...READINESS[setup] },
  });
  ensurePlayerModel(p);
  refreshAbilityCaches(p);
  ensureContractAuthority(p);
  ensureTransferSave(p);
  if (!free) {
    const club = seniorClubFor({ clubName, leagueId, clubIndex });
    Object.assign(p, {
      club: { ...club },
      employmentClubId: club.clubId,
      playingClubId: club.clubId,
      contractStatus: "active",
      contractStartSeason: 0,
      contractYears: contractEndSeason,
      contractEndSeason,
      contractRevision: null,
      renewalReview: null,
      weeklyWage,
      wage: weeklyWage,
    });
    ensureContractAuthority(p);
  }
  return p;
}

const contractSnapshot = (p) => ({
  status: p.contractStatus ?? null,
  endSeason: p.contractEndSeason ?? null,
  revision: p.contractRevision ?? null,
  employmentClubId: p.employmentClubId ?? null,
  playingClubId: p.playingClubId ?? null,
  clubId: p.club?.clubId ?? null,
  weeklyWage: p.weeklyWage ?? null,
  freeAgent: isFreeAgent(p),
  seasons: p.seasons?.length ?? 0,
  loan: p.activeLoan?.status ?? null,
});

/* ------------------------------------------------------------------ */
/* Record builder + invariants                                         */
/* ------------------------------------------------------------------ */

function snapshotRoundTrip(player, checkpoint = null) {
  const snap = serializeCareerSnapshot({ player, world: getWorldState(), checkpoint });
  const restored = deserializeCareerSnapshot(JSON.parse(JSON.stringify(snap)));
  return { snap, restored };
}

/**
 * ctx: { cohort, caseId, seed, player, season, seasonIdx, policy, flags,
 *        before (contractSnapshot), kind, expectRenewalExtension, expectPinned }
 */
function buildRecord(ctx) {
  const { player, season, seasonIdx } = ctx;
  const kind = ctx.kind || "club-season";
  const ledgerRows = season?.ledgerRecords || [];
  const representedClubId = season?.playingClubId ?? null;
  const oracle = kind === "club-season" ? oracleOpportunity(ledgerRows, representedClubId) : null;
  const pta = season?.playingTimeAssessment || null;
  const plg = season?.participationLedger || null;
  const after = contractSnapshot(player);

  const record = {
    cohort: ctx.cohort,
    caseId: ctx.caseId,
    seed: ctx.seed,
    careerId: player.careerId,
    position: player.position,
    nationality: player.nationality ?? null,
    kind,
    seasonIndex: seasonIdx,
    decisionPolicy: ctx.policy,
    setup: ctx.setup ?? null,
    leagueId: season?.leagueId ?? player.club?.leagueId ?? null,
    clubId: season?.clubId ?? null,
    representedClubId,
    flags: ctx.flags || {},
    contract: { before: ctx.before || null, after },
    oracle: oracle && {
      minutes: oracle.minutes,
      capacity: oracle.capacity,
      eligible: oracle.eligible,
      exclusions: oracle.exclusions,
      share: oracle.share,
      byCompetition: oracle.byCompetition,
      stats: { ...oracle.stats, includedKeys: undefined, includedCount: oracle.stats.includedKeys.length },
      clubs: oracle.clubs,
      expectedCompleteness: oracle.expectedCompleteness,
    },
    production: {
      playingTimeAssessment: clone(pta),
      participationLedger: clone(plg),
      seasonMinutes: season?.minutes ?? null,
      seasonMatches: season?.matches ?? null,
    },
    checks: {},
    violations: [],
    pass: true,
  };

  const v = record.violations;
  const fail = (invariant, msg, detail) => v.push({ invariant, msg, ...(detail !== undefined ? { detail } : {}) });

  if (!season) {
    fail(1, "no season row produced");
    record.pass = false;
    return record;
  }

  if (kind === "club-season") {
    /* 1. Opportunity arithmetic == independent oracle */
    if (!pta) fail(1, "season.playingTimeAssessment missing");
    else {
      if (pta.source !== "ledger-records") fail(1, "assessment did not read ledgerRecords", pta.source);
      const eq = (label, a, b) => {
        if (!approxOrBothNull(a, b)) fail(1, `${label}: production ${a} != oracle ${b}`, { production: a, oracle: b });
      };
      eq("clubMinutesPlayed", pta.clubMinutesPlayed, oracle.minutes);
      eq("opportunityCapacity", pta.opportunityCapacity, oracle.capacity);
      eq("eligibleFixtureCount", pta.eligibleFixtureCount, oracle.eligible);
      eq("availabilityExclusions", pta.availabilityExclusions, oracle.exclusions);
      eq("share", pta.share, oracle.share);
      for (const k of ["league", "domesticCup", "continental"]) {
        const a = pta.byCompetition?.[k];
        const b = oracle.byCompetition[k];
        if (!a) {
          fail(1, `byCompetition.${k} missing`);
          continue;
        }
        eq(`byCompetition.${k}.minutes`, a.clubMinutesPlayed, b.minutes);
        eq(`byCompetition.${k}.capacity`, a.opportunityCapacity, b.capacity);
        eq(`byCompetition.${k}.eligible`, a.eligibleFixtureCount, b.eligible);
        eq(`byCompetition.${k}.share`, a.share, b.share);
      }
      if (oracle.eligible > 0 && pta.completeness !== oracle.expectedCompleteness)
        fail(1, "completeness != oracle", { production: pta.completeness, oracle: oracle.expectedCompleteness });
      if (pta.representedClubId !== representedClubId)
        fail(1, "assessment representedClubId != season.playingClubId", {
          production: pta.representedClubId,
          season: representedClubId,
        });
      // Stints partition the eligible fixtures.
      const stintEligible = (pta.byStint || []).reduce((n, s) => n + (s.eligibleFixtureCount || 0), 0);
      const stintMinutes = (pta.byStint || []).reduce((n, s) => n + (s.clubMinutesPlayed || 0), 0);
      if (stintEligible !== oracle.eligible || stintMinutes !== oracle.minutes)
        fail(1, "byStint does not partition eligible fixtures", { stintEligible, stintMinutes });
      if (pta.recordsExamined !== oracle.stats.eligible + oracle.stats.unavailable + oracle.stats.unknown)
        fail(1, "recordsExamined != oracle represented-club rows", {
          production: pta.recordsExamined,
          oracle: oracle.stats,
        });
    }
    // Meta invariants the oracle itself must satisfy.
    if (oracle.eligible > 0) {
      if (!(oracle.capacity > 0)) fail(1, "oracle capacity not positive with eligible fixtures");
      if (oracle.minutes > oracle.capacity + EPS) fail(1, "club minutes exceed eligible capacity", oracle);
      if (!(oracle.share >= 0 && oracle.share <= 1 + EPS)) fail(1, "oracle share out of [0,1]", oracle.share);
    } else if (oracle.share != null) fail(1, "oracle share must be null without eligible fixtures");
    // International rows never reach club numbers (conservation check on raw rows).
    const intl = ledgerRows.filter(oracleIsInternational);
    const clubRowMinutes = Object.values(oracle.clubs).reduce((n, c) => n + c.minutes, 0);
    const allRowMinutes = ledgerRows.reduce((n, r) => n + Math.max(0, finiteOrNull(r.minutes) ?? 0), 0);
    const intlMinutes = intl.reduce((n, r) => n + Math.max(0, finiteOrNull(r.minutes) ?? 0), 0);
    record.checks.internationalExcluded = {
      rows: intl.length,
      minutes: intlMinutes,
      clubRowMinutes,
      allRowMinutes,
    };
    if (clubRowMinutes + intlMinutes !== allRowMinutes) fail(3, "club+international minutes != all ledger minutes");
    if (pta && pta.clubMinutesPlayed > clubRowMinutes)
      fail(3, "assessment minutes exceed non-international club minutes", {
        assessment: pta.clubMinutesPlayed,
        clubRowMinutes,
      });
    if (oracle.stats.duplicate > 0) record.checks.duplicateRowsSeen = oracle.stats.duplicate;

    /* 2. Consumers agree: clubMinutesShare + participationLedger */
    const consumer = clubMinutesShare(player, { season, persistAssessment: false });
    const usable = oracle.eligible > 0 && oracle.expectedCompleteness !== "incomplete";
    const expectedShare = usable ? Math.max(0, Math.min(1, oracle.share)) : 1;
    record.checks.clubMinutesShare = {
      share: consumer.share,
      eligibleMatches: consumer.eligibleMatches,
      minutes: consumer.minutes,
      usableForLowMinutes: consumer.usableForLowMinutes,
    };
    if (!approx(consumer.share, expectedShare))
      fail(2, "clubMinutesShare.share != oracle", { production: consumer.share, oracle: expectedShare });
    if (consumer.eligibleMatches !== oracle.eligible)
      fail(2, "clubMinutesShare.eligibleMatches != oracle", { production: consumer.eligibleMatches, oracle: oracle.eligible });
    if (consumer.minutes !== oracle.minutes)
      fail(2, "clubMinutesShare.minutes != oracle", { production: consumer.minutes, oracle: oracle.minutes });
    if (Boolean(consumer.usableForLowMinutes) !== (oracle.eligible > 0 && usable))
      fail(2, "usableForLowMinutes != oracle", { production: consumer.usableForLowMinutes });
    if (LOW_MINUTES_SHARE !== SQUAD_REVIEW.lowMinutesShare)
      fail(2, "SQUAD_REVIEW.lowMinutesShare != 0.22", SQUAD_REVIEW.lowMinutesShare);
    if (plg) {
      if (plg.clubMinutesPlayed !== oracle.minutes) fail(2, "participationLedger.minutes != oracle", plg.clubMinutesPlayed);
      if (plg.availableClubMinutes !== oracle.capacity)
        fail(2, "participationLedger.availableClubMinutes != oracle", plg.availableClubMinutes);
      if (plg.eligibleClubMatches !== oracle.eligible) fail(2, "participationLedger.eligibleClubMatches != oracle");
      if (plg.clubId !== representedClubId) fail(2, "participationLedger.clubId != represented club", plg.clubId);
    } else fail(2, "season.participationLedger missing");
    // Persisted row must be the same assessment (no stale re-derivation).
    const persistedRow = player.seasons?.[seasonIdx] || null;
    if (!persistedRow) fail(2, "season row missing from player.seasons");
    else if (!same(clone(persistedRow.playingTimeAssessment), clone(pta)))
      fail(2, "persisted playingTimeAssessment differs from returned season");

    if (ctx.expectPinned) {
      const pin = ctx.expectPinned;
      if (pin.minutes != null && oracle.minutes !== pin.minutes) fail(1, "pinned minutes differ", { oracle: oracle.minutes, pin });
      if (pin.eligible != null && oracle.eligible !== pin.eligible) fail(1, "pinned eligible differs", { oracle: oracle.eligible, pin });
      if (pin.capacity != null && oracle.capacity !== pin.capacity) fail(1, "pinned capacity differs", { oracle: oracle.capacity, pin });
      if (pin.shareBelow != null && !(oracle.share < pin.shareBelow)) fail(1, "oracle share not below pinned bound", { share: oracle.share, pin });
    }
  } else {
    /* Free-agent / wait period: no club football, no fabricated opportunity. */
    if (season.freeAgent !== true) fail(1, "free-agent period season row not marked freeAgent");
    if ((season.minutes || 0) !== 0 || (season.matches || 0) !== 0) fail(1, "free-agent period has club minutes", { minutes: season.minutes });
    if ((season.ledgerRecords || []).length) fail(1, "free-agent period carries ledger records");
    if (pta && (pta.eligibleFixtureCount > 0 || pta.clubMinutesPlayed > 0))
      fail(1, "free-agent period fabricated club opportunity", pta);
  }

  /* 4. Contract continuity */
  const b = ctx.before;
  if (b && kind === "club-season") {
    const completed = after.seasons;
    const endedNumerically = b.endSeason != null && b.endSeason <= completed;
    const expiry = season.contractExpiry || null;
    const rv = season.boundaryContractReview?.review || null;
    record.checks.contract = {
      endedNumerically,
      expiryAction: expiry?.action ?? null,
      boundary: season.boundaryContractReview?.action ?? null,
      boundaryReview: rv && { outcome: rv.outcome, reason: rv.reason ?? null, role: rv.role ?? null, interest: rv.interest ?? null },
    };
    if (b.freeAgent) fail(4, "club season started with a free agent");
    if (endedNumerically) {
      if (after.freeAgent) {
        if (after.weeklyWage !== 0 && after.weeklyWage != null) fail(4, "released player keeps a wage", after.weeklyWage);
        if (after.employmentClubId) fail(4, "released player keeps an employer", after.employmentClubId);
        if (player.pendingContractReview?.status === "pending")
          fail(4, "release left a pending contract review behind");
      } else if (expiry?.action === "renewed") {
        if (!(after.endSeason > completed)) fail(4, "renewal did not extend coverage past completed seasons", { after, completed });
        if (!(after.endSeason >= b.endSeason + 1)) fail(4, "renewal did not add at least one year to the old end", { before: b.endSeason, after: after.endSeason });
        if (after.status !== "active") fail(4, "renewed contract not active", after.status);
        if (after.employmentClubId !== b.employmentClubId) fail(4, "renewal changed the employer", after.employmentClubId);
        if (!(after.weeklyWage > 0)) fail(4, "renewed contract has no wage", after.weeklyWage);
        if (after.revision === b.revision) fail(4, "renewal did not bump contract revision");
      } else if (player.pendingContractReview?.status === "pending" || expiry?.action === "deferred-pending-review") {
        record.checks.contract.pendingReviewOpen = true;
      } else {
        fail(4, "term ended but player neither released, renewed nor pending review", { expiry, after });
      }
    } else {
      // Contract still covers the next period: nothing may silently end or change it.
      if (after.freeAgent) fail(4, "contract released before its end season", { before: b, after });
      if (after.endSeason !== b.endSeason) fail(4, "contract end changed without a deal", { before: b.endSeason, after: after.endSeason });
      if (after.employmentClubId !== b.employmentClubId) fail(4, "employer changed without a deal", after.employmentClubId);
    }
    // A loan changes the playing club, never the employer / term.
    if (after.loan === "active") {
      if (after.playingClubId === after.employmentClubId) fail(4, "loan active but playing club == employer");
      if (after.endSeason !== b.endSeason) fail(4, "loan altered the parent contract end");
      if (representedClubId !== after.playingClubId) fail(4, "season represented club != borrower while on loan");
    }
  }

  /* 5. Free-agent spell counters */
  const spell = player.freeAgentSpell || null;
  const closedSpell = player.freeAgentSpellHistory?.[player.freeAgentSpellHistory.length - 1] || null;
  for (const [label, s] of [["active", spell], ["closed", closedSpell]]) {
    if (!s) continue;
    const streak = oracleEmptyStreak(s.history);
    if (s.consecutiveEmptyReviews !== streak)
      fail(5, `${label} spell consecutiveEmptyReviews != independent history streak`, {
        production: s.consecutiveEmptyReviews,
        oracle: streak,
      });
    if (new Set(s.closedReviewIds).size !== (s.closedReviewIds || []).length) fail(5, `${label} spell closes a review twice`);
    const ids = (s.history || []).map((h) => h.reviewId);
    if (new Set(ids).size !== ids.length) fail(5, `${label} spell history double-counts a review`, ids);
    if (!(s.consecutiveEmptyReviews >= 0)) fail(5, `${label} spell counter negative`);
  }
  record.checks.freeAgentSpell = spell && {
    spellId: spell.spellId,
    consecutiveEmptyReviews: spell.consecutiveEmptyReviews,
    history: spell.history,
  };

  /* 6. Snapshot round-trip */
  try {
    const { restored } = snapshotRoundTrip(player);
    const rp = restored.player;
    const rRow = rp.seasons?.[seasonIdx];
    const sRow = player.seasons?.[seasonIdx];
    const sn = { seasons: { live: player.seasons.length, restored: rp.seasons?.length } };
    if (!rRow) fail(6, "restored player missing season row");
    else {
      if (!same(rRow.playingTimeAssessment, sRow.playingTimeAssessment)) fail(6, "restored playingTimeAssessment differs");
      if (!same(rRow.participationLedger, sRow.participationLedger)) fail(6, "restored participationLedger differs");
      if (kind === "club-season") {
        const restoredShare = clubMinutesShare(rp, { season: rRow, persistAssessment: false });
        sn.restoredShare = restoredShare.share;
        if (!approx(restoredShare.share, clubMinutesShare(player, { season: sRow, persistAssessment: false }).share))
          fail(6, "restored clubMinutesShare differs");
      }
    }
    if (!same(contractSnapshot(rp), contractSnapshot(player))) fail(6, "restored contract state differs", { live: contractSnapshot(player), restored: contractSnapshot(rp) });
    if (!same(rp.freeAgentSpell ?? null, player.freeAgentSpell ?? null)) fail(6, "restored freeAgentSpell differs");
    if (!same(rp.pendingContractReview ?? null, player.pendingContractReview ?? null)) fail(6, "restored pendingContractReview differs");
    record.checks.snapshotRoundTrip = sn;
  } catch (e) {
    fail(6, "snapshot round-trip threw", String(e?.stack || e));
  }

  /* 7. Finite numbers / registration */
  const bad = [
    ...numbersFinite(pta, "playingTimeAssessment"),
    ...numbersFinite(plg, "participationLedger"),
    ...numbersFinite(player.rating, "rating"),
    ...numbersFinite(player.weeklyWage, "weeklyWage"),
  ];
  if (bad.length) fail(7, "non-finite numbers", bad);
  const reg = assertPlayableRegistration(player);
  record.checks.registration = reg;
  if (!reg.ok && !(reg.mode === "free-agent" && isFreeAgent(player)) && !reg.mode?.includes("pending"))
    fail(7, "invalid registration after period", reg);
  if (kind === "club-season" && !after.freeAgent && !(player.playingClubId || player.club?.clubId))
    fail(7, "missing club identity after club period");

  record.pass = v.length === 0;
  return record;
}

function writeCase(record) {
  const safe = record.caseId.replace(/[^A-Za-z0-9._-]+/g, "_");
  writeFileSync(`${CASES}/${safe}.json`, JSON.stringify(record, null, 2));
}

/* ------------------------------------------------------------------ */
/* Ordinary cohort: 12 careers x 4 periods                             */
/* ------------------------------------------------------------------ */

const POLICY_MODE = {
  "renewal-first": "renewal-first",
  "beneficial-loan-first": "accept-first-loan",
  "accept-suitable-free-agent-offer": "stay",
  stay: "stay",
};

const CAREERS = [
  { id: "C01", seed: 707, position: "ST", rating: 58, age: 21, nationality: "Serbia", clubName: "Hull City", policy: "stay", setup: "fit", contractEndSeason: 5 },
  { id: "C02", seed: 708, position: "CM", rating: 66, age: 22, nationality: "Italy", clubName: "Atalanta", policy: "stay", setup: "reduced", contractEndSeason: 5 },
  { id: "C03", seed: 709, position: "CB", rating: 62, age: 20, nationality: "Spain", leagueId: "league:spain-la-liga", clubIndex: 5, policy: "beneficial-loan-first", setup: "fit", contractEndSeason: 5 },
  { id: "C04", seed: 710, position: "GK", rating: 60, age: 19, nationality: "England", leagueId: "league:england-premier-league", clubIndex: 10, policy: "beneficial-loan-first", setup: "low", contractEndSeason: 5 },
  { id: "C05", seed: 711, position: "ST", rating: 84, age: 27, nationality: "Brazil", leagueId: "league:italy-serie-a", clubIndex: 15, policy: "renewal-first", setup: "reduced", contractEndSeason: 1 },
  { id: "C06", seed: 712, position: "CM", rating: 84, age: 33, nationality: "England", clubName: "Hull City", policy: "renewal-first", setup: "fit", contractEndSeason: 1 },
  { id: "C07", seed: 713, position: "CB", rating: 64, age: 30, nationality: "Serbia", leagueId: "league:spain-la-liga", clubIndex: 9, policy: "accept-suitable-free-agent-offer", setup: "low", contractEndSeason: 1 },
  { id: "C08", seed: 714, position: "GK", rating: 68, age: 31, nationality: "Italy", leagueId: "league:italy-serie-a", clubIndex: 11, policy: "accept-suitable-free-agent-offer", setup: "reduced", contractEndSeason: 1 },
  { id: "C09", seed: 715, position: "ST", rating: 65, age: 24, nationality: "Spain", leagueId: "league:spain-la-liga", clubIndex: 3, policy: "stay", setup: "low", contractEndSeason: 5 },
  { id: "C10", seed: 716, position: "CM", rating: 61, age: 21, nationality: "Brazil", leagueId: "league:england-premier-league", clubIndex: 14, policy: "beneficial-loan-first", setup: "reduced", contractEndSeason: 5 },
  { id: "C11", seed: 717, position: "CB", rating: 84, age: 26, nationality: "England", leagueId: "league:italy-serie-a", clubIndex: 17, policy: "renewal-first", setup: "fit", contractEndSeason: 1 },
  { id: "C12", seed: 718, position: "GK", rating: 56, age: 23, nationality: "Serbia", leagueId: "league:england-premier-league", clubIndex: 16, policy: "accept-suitable-free-agent-offer", setup: "low", contractEndSeason: 1 },
];

/** First market offer that gives a realistic pathway: not ineligible, not a loan, not a renewal. */
function suitableFreeAgentOffer(offers) {
  return (
    (offers || []).find(
      (o) =>
        !o.isLoan &&
        !o.isRenewal &&
        o.expectedRole !== "ineligible" &&
        (o.projectedMinutesShare == null || o.projectedMinutesShare >= 0.35)
    ) || null
  );
}

/**
 * One period of a career. Returns { kind, season, faAction, thrown }.
 * Free agents search the market through the production desk facade first;
 * the policy decides whether to sign, refuse or wait.
 */
function stepPeriod(player, cfg) {
  const out = { kind: "club-season", faAction: null, faDiagnostics: null, thrown: null, season: null };
  try {
    if (isFreeAgent(player)) {
      const offers = generateTransferOffers(70, player, LEAGUES, LEAGUE_LOOKUP, null);
      out.faDiagnostics = clone(player.lastMarketDiagnostics);
      out.faOfferCount = offers.length;
      let signed = false;
      if (cfg.policy === "accept-suitable-free-agent-offer") {
        const offer = suitableFreeAgentOffer(offers);
        if (offer) {
          const acc = acceptPipelineOffer(player, offer);
          if (!acc.ok) throw new Error(`free-agent offer accept failed: ${acc.reason}`);
          signed = true;
          out.faAction = "signed";
          player.pendingOffers = [];
          out.signedContract = contractSnapshot(player);
        }
      }
      if (!signed) {
        if (offers.length) {
          player.pendingOffers = offers;
          declineWindowAndContinue(player, { choiceId: "decline-window" });
          out.faAction = "refused";
        } else out.faAction = "empty-wait";
        const res = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, { pauseForDecisions: false });
        out.kind = "free-agent-period";
        out.season = res?.season ?? player.seasons[player.seasons.length - 1];
        if (!res?.freeAgent) throw new Error("free-agent wait did not report freeAgent");
        return out;
      }
    }
    const res = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
      autoDecisionPolicy: POLICY_MODE[cfg.policy],
      pauseForDecisions: false,
    });
    out.season = res?.season ?? player.seasons[player.seasons.length - 1];
    if (res?.freeAgent || res?.awaitingDecision) throw new Error("club period did not complete");
  } catch (e) {
    out.thrown = String(e?.stack || e);
  }
  return out;
}

function runCareer(cfg, periods) {
  const player = makePlayer(cfg);
  const records = [];
  for (let k = 0; k < periods; k++) {
    const beforePeriod = contractSnapshot(player);
    const step = stepPeriod(player, cfg);
    // A free agent who signed starts the club season under the freshly signed terms.
    const before = step.signedContract ? { ...step.signedContract, signedThisPeriod: true } : beforePeriod;
    const record = buildRecord({
      cohort: "ordinary",
      caseId: `${cfg.id}-${cfg.position}-seed${cfg.seed}-p${k + 1}`,
      seed: cfg.seed,
      player,
      season: step.season,
      seasonIdx: k,
      policy: cfg.policy,
      setup: cfg.setup,
      kind: step.kind,
      before,
      flags: {
        freeAgentAction: step.faAction,
        signedFromFreeAgency: step.faAction === "signed",
        loanTaken: Boolean(player.activeLoan?.status === "active"),
        renewed: step.season?.contractExpiry?.action === "renewed",
        released: step.season?.contractExpiry?.action === "released",
      },
    });
    if (step.thrown) {
      record.violations.push({ invariant: 0, msg: "period threw", detail: step.thrown });
      record.pass = false;
    }
    record.meta = { careerConfigId: cfg.id, faDiagnostics: step.faDiagnostics ?? null };
    records.push(record);
    if (step.thrown) break;
  }
  if (records.length === periods && player.seasons.length !== periods) {
    records[records.length - 1].violations.push({
      invariant: 6,
      msg: "career did not end with exactly one season row per period",
      detail: player.seasons.length,
    });
    records[records.length - 1].pass = false;
  }
  for (const r of records) writeCase(r);
  return records;
}

/* ------------------------------------------------------------------ */
/* Dedicated cases                                                     */
/* ------------------------------------------------------------------ */

const fail0 = (record, invariant, msg, detail) =>
  record.violations.push({ invariant, msg, ...(detail !== undefined ? { detail } : {}) });

function finish(record) {
  record.pass = record.violations.length === 0;
  writeCase(record);
  return record;
}

function runStaySeason(cfg, extra = {}) {
  const p = makePlayer(cfg);
  reseedCareerRng(707);
  const before = contractSnapshot(p);
  let season = null;
  let thrown = null;
  try {
    season = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, { autoDecisionPolicy: "stay" }).season;
  } catch (e) {
    thrown = String(e?.stack || e);
  }
  const record = buildRecord({
    cohort: "dedicated:stay-opportunity",
    caseId: `D-${cfg.id}-stay-opportunity-${cfg.clubName}-ovr${cfg.rating}-seed707`,
    seed: 707,
    player: p,
    season,
    seasonIdx: 0,
    policy: "stay",
    setup: "fit",
    before,
    ...extra,
  });
  if (thrown) fail0(record, 0, "simulateSeason failed", thrown);
  return { p, season, record };
}

function pauseToDecision(player, { scenarioPolicy = "balanced" } = {}) {
  let data = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, { pauseForDecisions: true, autoDecisionPolicy: null });
  let guards = 0;
  while (data?.awaitingScenario && guards < 12) {
    guards += 1;
    const pending = player.pendingSeniorScenario || data.pendingSeniorScenario || data.checkpoint?.pendingSeniorScenario || null;
    if (!pending) throw new Error("awaitingScenario without pendingSeniorScenario");
    const applied = applySeniorScenarioPolicy(player, pending, scenarioPolicy);
    if (!applied || applied.ok === false) throw new Error(`scenario policy failed: ${applied?.reason || "unknown"}`);
    player.pendingSeniorScenario = null;
    if (data.checkpoint) data.checkpoint.pendingSeniorScenario = null;
    player.seasonCheckpoint = data.checkpoint;
    data = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, { pauseForDecisions: true, autoDecisionPolicy: null });
  }
  if (!(data?.awaitingDecision || data?.checkpoint)) throw new Error("season did not pause at a decision");
  return data;
}

/** Mid-season: decision numbers must match an oracle over the checkpoint's played rows. */
function midSeasonCheck(record, checkpoint, label) {
  const rows = checkpoint?.ledgerRecords || [];
  const club = checkpoint?.playingClubIdAtPause || null;
  const o = oracleOpportunity(rows, club, { checkpointDate: checkpoint?.lastDate || null });
  const decision = checkpoint?.decision || null;
  const result = {
    label,
    checkpointDate: checkpoint?.lastDate ?? null,
    rows: rows.length,
    oracle: { minutes: o.minutes, capacity: o.capacity, eligible: o.eligible, share: o.share },
    decisionKind: decision?.kind ?? null,
    decisionMinutesShare: decision?.minutesShare ?? null,
    decisionEligibleMatches: decision?.eligibleMatches ?? null,
  };
  const proxy = clubMinutesShare({}, { season: { ledgerRecords: rows, playingClubId: club }, clubId: club, checkpointDate: checkpoint?.lastDate, persistAssessment: false });
  result.consumerShare = proxy.share;
  if (o.eligible > 0 && !approx(proxy.share, o.share)) fail0(record, 2, `${label}: mid-season clubMinutesShare != oracle`, result);
  if (decision?.minutesShare != null) {
    if (!approx(decision.minutesShare, o.share ?? 1)) fail0(record, 2, `${label}: decision.minutesShare != oracle`, result);
    if (decision.eligibleMatches !== o.eligible) fail0(record, 2, `${label}: decision.eligibleMatches != oracle`, result);
    if (decision.kind === "development-loan" && !(decision.minutesShare < LOW_MINUTES_SHARE))
      fail0(record, 2, `${label}: development-loan raised although share >= ${LOW_MINUTES_SHARE}`, result);
  }
  record.checks[`midSeason:${label}`] = result;
  return result;
}

function stayOpportunityCase(cfg, pinned) {
  const { p, record } = runStaySeason(cfg, { expectPinned: pinned });
  if (!record.violations.length || true) {
    // Stay keeps the contract: end 2, one season complete -> still active.
    if (!isContractActive(p)) fail0(record, 4, "stay path lost the contract", contractSnapshot(p));
    if (p.contractEndSeason !== cfg.contractEndSeason) fail0(record, 4, "stay path changed contract end", p.contractEndSeason);
    if (record.production.playingTimeAssessment?.share != null && record.oracle?.share != null) {
      record.checks.opportunity = {
        oracleShare: record.oracle.share,
        pinnedShare: pinned.capacity ? pinned.minutes / pinned.capacity : null,
        belowLowMinutes: record.oracle.share < LOW_MINUTES_SHARE,
      };
    }
  }
  // Paused twin: mid-season decision numbers vs oracle, then stay through to the end.
  try {
    const twin = makePlayer(cfg);
    reseedCareerRng(707);
    const paused = pauseToDecision(twin);
    midSeasonCheck(record, paused.checkpoint || twin.seasonCheckpoint, "stay-pause");
  } catch (e) {
    fail0(record, 6, "mid-season pause check threw", String(e?.stack || e));
  }
  record.flags = { stayOpportunity: true };
  return finish(record);
}

function oneYearRenewalCase() {
  const cfg = {
    seed: 707,
    position: "ST",
    rating: 72,
    age: 36,
    careerId: "bug07-short-renewal",
    clubName: "Hull City",
    contractEndSeason: 1,
    weeklyWage: 1500,
  };
  const p = makePlayer(cfg);
  const before = contractSnapshot(p);
  const gen = generatePipelineOffers(p, { performanceScore: 85, forceGenerate: true, rng: createRng(707) });
  const renewal = gen.offers.find((o) => o.isRenewal);
  let record = {
    cohort: "dedicated:one-year-renewal",
    caseId: "D-renewal-one-year-age36-seed707",
    seed: 707,
    careerId: p.careerId,
    position: p.position,
    flags: { oneYearRenewal: true },
    checks: {},
    violations: [],
    contract: { before },
  };
  if (!renewal) {
    fail0(record, 4, "no renewal offer for a 36-year-old final-year player at score 85", gen.rejectionLog);
    return finish(record);
  }
  const accepted = acceptPipelineOffer(p, renewal);
  const after = contractSnapshot(p);
  record.checks.renewal = { extensionYears: renewal.extensionYears, contractYears: renewal.contractYears, before: before.endSeason, after: after.endSeason, ok: accepted.ok };
  record.contract.after = after;
  if (!accepted.ok) fail0(record, 4, "renewal accept failed", accepted.reason);
  if (renewal.extensionYears !== 1) fail0(record, 4, "expected a one-year extension", renewal.extensionYears);
  if (after.endSeason !== before.endSeason + (renewal.extensionYears || 1))
    fail0(record, 4, "one-year renewal did not add exactly one season of coverage", { before: before.endSeason, after: after.endSeason });
  if (!isContractActive(p)) fail0(record, 4, "renewed player not active");
  if (after.employmentClubId !== before.employmentClubId) fail0(record, 4, "renewal changed employer");

  // The extended year must be playable: one real season with a real oracle.
  const season = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, { autoDecisionPolicy: "stay" }).season;
  const played = buildRecord({
    cohort: "dedicated:one-year-renewal",
    caseId: "D-renewal-one-year-age36-seed707",
    seed: 707,
    player: p,
    season,
    seasonIdx: 0,
    policy: "renewal-first",
    kind: "club-season",
    before: after,
    flags: { oneYearRenewal: true },
  });
  // Season 1 completes at end=2 -> contract has one more period; stay must not release.
  played.checks.renewal = record.checks.renewal;
  played.violations.push(...record.violations);
  played.contract.before = before;
  played.contract.afterRenewal = after;
  return finish(played);
}

function freeAgentRecoveryCase() {
  const cfg = { seed: 707, position: "ST", rating: 66, age: 23, careerId: "bug07-search-0", free: true };
  const p = makePlayer(cfg);
  const record = {
    cohort: "dedicated:fa-recovery",
    caseId: "D-fa-recovery-after-empty-bug07-search-0",
    seed: 707,
    careerId: p.careerId,
    position: p.position,
    flags: { freeAgentRecovery: true },
    checks: {},
    violations: [],
  };
  const f = (inv, msg, d) => fail0(record, inv, msg, d);

  // 1. Ordinary review fails the interest gate: eligibility not evaluated.
  const first = generatePipelineOffers(p, { performanceScore: 55 });
  record.checks.first = { offers: first.offers.length, eligibleCount: first.eligibleCount, diag: first.diagnostics };
  if (first.offers.length !== 0) f(5, "expected the ordinary first review to be empty for this career id", first.offers.length);
  if (first.eligibilityEvaluated !== false || first.eligibleCount !== null)
    f(5, "interest-gate empty must not claim an eligible-club count", { eligible: first.eligibleCount });
  if (first.diagnostics.interestGateResult !== "declined") f(5, "first review did not fail the interest gate", first.diagnostics);

  // Closing the same review twice through the helper is exactly-once.
  const closed = closeFreeAgentMarketReview(p, { reviewId: first.reviewId, validatedOfferCount: 0, interestGateDeclined: true });
  const dup = closeFreeAgentMarketReview(p, { reviewId: first.reviewId, validatedOfferCount: 0, interestGateDeclined: true });
  record.checks.close = { classification: closed.classification, duplicate: dup.duplicate === true, streak: p.freeAgentSpell.consecutiveEmptyReviews };
  if (closed.classification !== "interest-gate") f(5, "empty interest-gate review misclassified", closed.classification);
  if (!dup.duplicate) f(5, "second close of the same review was not a duplicate");
  if (p.freeAgentSpell.consecutiveEmptyReviews !== 1) f(5, "empty review counted != once", p.freeAgentSpell.consecutiveEmptyReviews);

  // 2. Continue (wait) through the real simulateSeason path; the review is already closed.
  const wait = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, { pauseForDecisions: false });
  if (!wait?.freeAgent) f(5, "free-agent wait did not report freeAgent");
  if (p.freeAgentSpell.consecutiveEmptyReviews !== 1) f(5, "wait double-counted the already closed review", p.freeAgentSpell.consecutiveEmptyReviews);
  const waitRow = wait?.season;

  // 3. Recovery review: bypass the gate, evaluate everyone, surface an executable offer.
  const offers2 = generateTransferOffers(55, p, LEAGUES, LEAGUE_LOOKUP, null);
  const diag2 = clone(p.lastMarketDiagnostics);
  record.checks.recovery = { offers: offers2.length, diag: diag2 };
  if (diag2?.interestGateResult !== "recovery-bypass") f(5, "recovery review did not bypass the interest gate", diag2);
  if (!(diag2?.sportingEligibleCount > 0)) f(5, "recovery review evaluated no eligible clubs", diag2);
  if (!offers2.length) f(5, "recovery review produced no executable offer");
  if (diag2?.recoveryStage !== "recovery-success") f(5, "recovery stage != recovery-success", diag2?.recoveryStage);
  const again = generateTransferOffers(55, p, LEAGUES, LEAGUE_LOOKUP, null);
  if (!same(again.map((o) => o.offerId), offers2.map((o) => o.offerId))) f(5, "frozen recovery review rerolled its offers");

  // 4. Sign the first suitable offer; the spell ends exactly once.
  const offer = suitableFreeAgentOffer(offers2) || offers2.find((o) => !o.isRenewal) || null;
  let before = contractSnapshot(p);
  let season = null;
  if (offer) {
    const acc = acceptPipelineOffer(p, offer);
    record.checks.signing = { ok: acc.ok, reason: acc.reason ?? null, club: offer.clubId, years: offer.contractYears };
    if (!acc.ok) f(4, "recovery offer could not be accepted", acc.reason);
    else {
      before = contractSnapshot(p); // contract terms in force when the club period starts
      if (isFreeAgent(p)) f(4, "player still a free agent after signing");
      if (p.freeAgentSpell) f(5, "free-agent spell still active after signing");
      const closedSpell = p.freeAgentSpellHistory?.[p.freeAgentSpellHistory.length - 1];
      if (!closedSpell || closedSpell.closedReason !== "signed") f(5, "signed spell not archived", closedSpell?.closedReason);
      if (closedSpell && closedSpell.consecutiveEmptyReviews !== 1) f(5, "archived spell lost its empty counter", closedSpell.consecutiveEmptyReviews);
      season = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, { autoDecisionPolicy: "stay" }).season;
    }
  }
  const played = buildRecord({
    cohort: "dedicated:fa-recovery",
    caseId: record.caseId,
    seed: 707,
    player: p,
    season,
    seasonIdx: p.seasons.length - 1,
    policy: "accept-suitable-free-agent-offer",
    kind: "club-season",
    before: { ...before, signedThisPeriod: true },
    flags: { freeAgentRecovery: true, waitRow: waitRow?.seasonId ?? null },
  });
  played.checks = { ...played.checks, ...record.checks };
  played.violations.push(...record.violations);
  return finish(played);
}

function exhaustedControlCase() {
  const cfg = { seed: 707, position: "ST", rating: 66, age: 23, careerId: "bug07-search-0", free: true };
  const p = makePlayer(cfg);
  const record = {
    cohort: "dedicated:fa-exhausted-control",
    caseId: "D-fa-exhausted-control",
    seed: 707,
    careerId: p.careerId,
    position: p.position,
    flags: { exhaustedControl: true },
    checks: {},
    violations: [],
  };
  const f = (inv, msg, d) => fail0(record, inv, msg, d);

  generatePipelineOffers(p, { performanceScore: 55 }); // empty (interest gate)
  simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, { pauseForDecisions: false }); // wait closes it: streak 1
  if (p.freeAgentSpell.consecutiveEmptyReviews !== 1) f(5, "setup: expected one closed empty review", p.freeAgentSpell.consecutiveEmptyReviews);

  // Recovery mode, but the whole pool is genuinely closed to this player: nothing to fabricate.
  const ex = generatePipelineOffers(p, { performanceScore: 55, clubs: [] });
  record.checks.exhausted = { offers: ex.offers.length, eligibleCount: ex.eligibleCount, diag: ex.diagnostics };
  if (ex.offers.length !== 0) f(5, "exhausted control fabricated offers", ex.offers.length);
  if (ex.diagnostics.recoveryStage !== "recovery-exhausted") f(5, "empty recovery not labelled recovery-exhausted", ex.diagnostics.recoveryStage);
  if (ex.eligibleCount !== 0) f(5, "exhausted control should evaluate a zero-club pool", ex.eligibleCount);
  if (ex.diagnostics.interestGateResult !== "recovery-bypass") f(5, "exhausted recovery should still bypass the gate", ex.diagnostics.interestGateResult);

  const closed = closeFreeAgentMarketReview(p, {
    reviewId: ex.reviewId,
    validatedOfferCount: 0,
    eligibleCount: ex.eligibleCount,
    exhausted: true,
    recoveryStage: ex.diagnostics.recoveryStage,
  });
  record.checks.closed = { classification: closed.classification, streak: p.freeAgentSpell.consecutiveEmptyReviews };
  if (closed.classification !== "exhausted") f(5, "exhausted review misclassified", closed.classification);
  if (p.freeAgentSpell.consecutiveEmptyReviews !== 2) f(5, "exhausted review did not advance the streak once", p.freeAgentSpell.consecutiveEmptyReviews);

  // Waiting after the closed exhausted review must not count it again; the desk must not soft-lock.
  const wait = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, { pauseForDecisions: false });
  if (!wait?.freeAgent) f(5, "wait after exhausted review failed");
  if (p.freeAgentSpell.consecutiveEmptyReviews !== 2) f(5, "wait double-counted the exhausted review", p.freeAgentSpell.consecutiveEmptyReviews);
  if (selectNextAction(p) !== "free-agent") f(5, "exhausted free agent is not offered another search/wait", selectNextAction(p));

  // Control: a fresh real market after the closed exhausted review still recovers.
  const next = generatePipelineOffers(p, { performanceScore: 55 });
  record.checks.afterExhausted = { offers: next.offers.length, stage: next.diagnostics.recoveryStage };
  if (!next.offers.length) f(5, "exhaustion became terminal: next real review had no offers", next.diagnostics);

  const played = buildRecord({
    cohort: "dedicated:fa-exhausted-control",
    caseId: record.caseId,
    seed: 707,
    player: p,
    season: wait?.season,
    seasonIdx: p.seasons.length - 1,
    policy: "wait",
    kind: "free-agent-period",
    before: null,
    flags: record.flags,
  });
  played.checks = { ...played.checks, ...record.checks };
  played.violations.push(...record.violations);
  return finish(played);
}

function selectNextAction(player) {
  const reg = assertPlayableRegistration(player);
  return reg.mode === "free-agent" ? "free-agent" : reg.ok ? "start-season" : reg.mode;
}

function clearDecision(rp) {
  rp.pendingDecision = null;
  rp.pendingOffers = [];
  if (rp.seasonCheckpoint) {
    rp.seasonCheckpoint.decision = null;
    rp.seasonCheckpoint.offers = [];
  }
}

const LOAN_CFG = {
  seed: 707,
  position: "ST",
  rating: 58,
  age: 20,
  nationality: "Serbia",
  clubName: "Hull City",
  contractEndSeason: 3,
  weeklyWage: 1500,
  careerId: "fix07-pause-loan",
};

function pauseRestoreCase() {
  const cfg = { ...LOAN_CFG, careerId: "fix07-pause-restore" };
  const comparable = (s) => ({
    minutes: s?.playingTimeAssessment?.clubMinutesPlayed,
    capacity: s?.playingTimeAssessment?.opportunityCapacity,
    eligible: s?.playingTimeAssessment?.eligibleFixtureCount,
    share: s?.playingTimeAssessment?.share,
    rows: s?.ledgerRecords?.length,
    clubId: s?.playingClubId,
  });
  // Uninterrupted twin.
  const twin = makePlayer(cfg);
  reseedCareerRng(707);
  const twinSeason = simulateSeason(twin, LEAGUES, LEAGUE_LOOKUP, { autoDecisionPolicy: "stay" }).season;

  const p = makePlayer(cfg);
  reseedCareerRng(707);
  const before = contractSnapshot(p);
  const paused = pauseToDecision(p);
  const ck = paused.checkpoint || p.seasonCheckpoint;
  const pauseState = {
    decisionKind: ck?.decision?.kind ?? null,
    seasonsAtPause: p.seasons.length,
    contract: contractSnapshot(p),
    checkpointRows: (ck?.ledgerRecords || []).length,
  };
  const { snap, restored } = snapshotRoundTrip(p, ck);
  setWorldState(restored.world);
  setSimRng(createRng(snap.rngSeed));
  const rp = restored.player;
  const decision = rp.pendingDecision || rp.seasonCheckpoint?.decision || ck?.decision || null;
  if (decision && decision.status !== "resolved") resolveSquadDecision(rp, decision, "stay-compete");
  clearDecision(rp);
  let season = null;
  let thrown = null;
  try {
    season = simulateSeason(rp, LEAGUES, LEAGUE_LOOKUP, { autoDecisionPolicy: "stay", pauseForDecisions: false }).season;
  } catch (e) {
    thrown = String(e?.stack || e);
  }
  const record = buildRecord({
    cohort: "dedicated:pause-restore",
    caseId: "D-pause-restore-hull58-seed707",
    seed: 707,
    player: rp,
    season,
    seasonIdx: 0,
    policy: "pause→snapshot→restore→stay",
    setup: "fit",
    before,
    flags: { paused: true, restored: true },
  });
  if (thrown) fail0(record, 6, "resume failed", thrown);
  record.pauseState = pauseState;
  midSeasonCheck(record, ck, "pause");
  if (pauseState.seasonsAtPause !== 0) fail0(record, 6, "season finalised at pause", pauseState.seasonsAtPause);
  if (season) {
    const a = comparable(season);
    const b = comparable(twinSeason);
    record.checks.twinComparison = { restored: a, twin: b, equal: same(a, b) };
    if (!same(a, b)) fail0(record, 6, "restored season opportunity != uninterrupted twin", record.checks.twinComparison);
    if (!same(contractSnapshot(rp).endSeason, contractSnapshot(twin).endSeason)) fail0(record, 4, "restored contract end != twin");
    if (rp.seasons.length !== 1) fail0(record, 6, "resumed player has wrong season count", rp.seasons.length);
    // Resume must not mint a second assessment for the same period.
    if (record.production.playingTimeAssessment?.checkpoint !== "end") fail0(record, 6, "season assessment is not the end-of-period one", record.production.playingTimeAssessment?.checkpoint);
  }
  return finish(record);
}

function crossLeagueLoanCase() {
  const cfg = { ...LOAN_CFG, careerId: "fix07-cross-league-loan" };
  const p = makePlayer(cfg);
  reseedCareerRng(707);
  const before = contractSnapshot(p);
  const parentId = p.club.clubId;
  const parentLeague = p.club.leagueId;
  const paused = pauseToDecision(p);
  const ck = paused.checkpoint || p.seasonCheckpoint;
  const decision = ck?.decision || p.pendingDecision || null;
  const offers = [...(decision?.loanOffers || []), ...(ck?.offers || [])].filter((o) => o?.isLoan);
  const offer = offers.find((o) => o.leagueId && o.leagueId !== parentLeague);
  const record = {
    cohort: "dedicated:cross-league-loan",
    caseId: "D-cross-league-loan-hull58-seed707",
    seed: 707,
    careerId: p.careerId,
    position: p.position,
    flags: { crossLeagueLoan: true },
    checks: { offersConsidered: offers.map((o) => [o.clubId, o.leagueId]) },
    violations: [],
  };
  if (!offer) {
    fail0(record, 4, "no cross-league loan offer available at the winter review", { decision: decision?.kind, offers: record.checks.offersConsidered });
    return finish(record);
  }
  const reg = resolveMoveRegistration({
    destinationLeagueId: offer.leagueId,
    departureDate: ck.lastDate,
    originSeasonStartYear: START_YEAR,
  });
  offer.registration = reg;
  offer.effectiveDate = reg.effectiveDate || ck.lastDate;
  const started = startLoan(p, offer);
  record.checks.loanStart = { ok: started.ok, reason: started.reason ?? null, registration: reg.ok, immediate: reg.immediate };
  if (!started.ok) {
    fail0(record, 4, "cross-league loan could not start", started.reason);
    return finish(record);
  }
  p.pendingOffers = [];
  p.pendingDecision = null;
  clearDecision(p);

  let season1 = null;
  let thrown = null;
  try {
    season1 = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, { pauseForDecisions: false, autoDecisionPolicy: "stay" }).season;
  } catch (e) {
    thrown = String(e?.stack || e);
  }
  const borrowerId = offer.clubId;
  const rec1 = buildRecord({
    cohort: "dedicated:cross-league-loan",
    caseId: record.caseId,
    seed: 707,
    player: p,
    season: season1,
    seasonIdx: 0,
    policy: "accept-first-loan",
    before,
    flags: { crossLeagueLoan: true, borrower: borrowerId, parent: parentId, parentLeague, borrowerLeague: offer.leagueId },
  });
  if (thrown) fail0(rec1, 0, "season on loan threw", thrown);
  rec1.checks = { ...rec1.checks, ...record.checks };
  if (season1) {
    if (p.activeLoan?.status !== "active") fail0(rec1, 4, "loan not active at season end", p.activeLoan?.status);
    if (p.employmentClubId !== parentId) fail0(rec1, 4, "loan changed the employer", p.employmentClubId);
    if (p.playingClubId !== borrowerId) fail0(rec1, 4, "player not registered at borrower", p.playingClubId);
    if (p.contractEndSeason !== cfg.contractEndSeason) fail0(rec1, 4, "loan changed the parent contract end", p.contractEndSeason);
    const o = oracleOpportunity(season1.ledgerRecords || [], borrowerId);
    const oParent = oracleOpportunity(season1.ledgerRecords || [], parentId);
    rec1.checks.stintSplit = {
      borrower: { minutes: o.minutes, eligible: o.eligible, capacity: o.capacity },
      parent: { minutes: oParent.minutes, eligible: oParent.eligible, capacity: oParent.capacity },
      clubs: o.clubs,
    };
    if (!(o.clubs[parentId]?.rows > 0) || !(o.clubs[borrowerId]?.rows > 0))
      fail0(rec1, 3, "season ledger lacks rows for both parent and borrower", Object.keys(o.clubs));
    const pta = season1.playingTimeAssessment;
    if (pta && (pta.clubMinutesPlayed !== o.minutes || pta.eligibleFixtureCount !== o.eligible))
      fail0(rec1, 3, "assessment mixed parent and borrower fixtures", { pta: pta.clubMinutesPlayed, borrower: o.minutes });
    if (pta && pta.byStint.some((s) => s.stintId && String(s.stintId).includes(parentId) && s.eligibleFixtureCount > 0))
      fail0(rec1, 3, "borrower assessment counted a parent stint", pta.byStint);
  }
  writeCase({ ...rec1, pass: rec1.violations.length === 0 });

  // Next period: the loan ends, the parent becomes the represented club again.
  let season2 = null;
  const before2 = contractSnapshot(p);
  let thrown2 = null;
  try {
    season2 = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, { pauseForDecisions: false, autoDecisionPolicy: "stay" }).season;
  } catch (e) {
    thrown2 = String(e?.stack || e);
  }
  const rec2 = buildRecord({
    cohort: "dedicated:cross-league-loan",
    caseId: `${record.caseId}-after-return`,
    seed: 707,
    player: p,
    season: season2,
    seasonIdx: 1,
    policy: "stay",
    before: before2,
    flags: { crossLeagueLoan: true, afterLoanReturn: true, parent: parentId },
  });
  if (thrown2) fail0(rec2, 0, "season after loan return threw", thrown2);
  if (season2 && season2.playingClubId !== parentId) fail0(rec2, 4, "after the loan the represented club is not the parent", season2.playingClubId);
  if (p.activeLoan?.status === "active") fail0(rec2, 4, "loan still active after the parent season");
  finish(rec2);
  return [rec1, rec2];
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

function guard(label, fn) {
  try {
    return fn();
  } catch (e) {
    const rec = {
      cohort: "error",
      caseId: `ERROR-${label}`,
      pass: false,
      violations: [{ invariant: 0, msg: `case threw: ${label}`, detail: String(e?.stack || e) }],
    };
    writeCase(rec);
    return rec;
  }
}

const careers = QUICK ? [CAREERS[0], CAREERS[4]] : CAREERS; // quick: Hull stay + renewal-first
const periods = QUICK ? 2 : 4;

const ordinary = [];
for (const cfg of careers) {
  const r = guard(cfg.id, () => runCareer(cfg, periods));
  if (Array.isArray(r)) ordinary.push(...r);
  else ordinary.push(r);
}

const dedicatedRaw = [
  guard("STAY-HULL", () =>
    stayOpportunityCase(
      { id: "S1", seed: 707, position: "ST", rating: 58, age: 21, nationality: "Serbia", clubName: "Hull City", contractEndSeason: 2, careerId: "bug07-full-58" },
      PINNED_HULL
    )
  ),
  guard("STAY-ATALANTA", () =>
    stayOpportunityCase(
      { id: "S2", seed: 707, position: "ST", rating: 72, age: 21, nationality: "Serbia", clubName: "Atalanta", contractEndSeason: 2, careerId: "bug07-full-72" },
      { shareBelow: LOW_MINUTES_SHARE }
    )
  ),
  guard("RENEWAL-1Y", oneYearRenewalCase),
  guard("FA-RECOVERY", freeAgentRecoveryCase),
  guard("FA-EXHAUSTED", exhaustedControlCase),
  guard("PAUSE-RESTORE", pauseRestoreCase),
  guard("CROSS-LOAN", crossLeagueLoanCase),
];
const dedicated = dedicatedRaw.flat();

const all = [...ordinary, ...dedicated];
const violations = [];
for (const r of all) for (const v of r.violations || []) violations.push({ caseId: r.caseId, ...v });
const byInvariant = {};
for (const v of violations) byInvariant[v.invariant] = (byInvariant[v.invariant] || 0) + 1;

const ordinaryRecords = ordinary.filter((r) => r.cohort === "ordinary");
const uniq = (arr) => [...new Set(arr.filter((x) => x != null))].sort();
const positions = uniq(ordinaryRecords.map((r) => r.position));
const leagues = uniq(ordinaryRecords.map((r) => r.leagueId));
const nationalities = uniq(ordinaryRecords.map((r) => r.nationality));
const setups = uniq(ordinaryRecords.map((r) => r.setup));
const policies = uniq(ordinaryRecords.map((r) => r.decisionPolicy));
const clubs = uniq(ordinaryRecords.map((r) => r.representedClubId));
const careerIds = uniq(ordinaryRecords.map((r) => r.careerId));
const clubSeasons = ordinaryRecords.filter((r) => r.kind === "club-season");
const faPeriods = ordinaryRecords.filter((r) => r.kind === "free-agent-period");

const expectedCareers = careers.length;
const expectedRecords = careers.length * periods;
const coverage = [];
if (ordinaryRecords.length !== expectedRecords) coverage.push(`ordinary records ${ordinaryRecords.length} != ${expectedRecords}`);
if (careerIds.length !== expectedCareers) coverage.push(`ordinary careers ${careerIds.length} != ${expectedCareers}`);
if (!QUICK) {
  for (const need of ["ST", "CM", "CB", "GK"]) if (!positions.includes(need)) coverage.push(`missing position ${need}`);
  if (setups.length < 3) coverage.push(`only ${setups.length} readiness setups (need >= 3)`);
  if (leagues.length < 2) coverage.push("fewer than 2 league contexts");
  if (clubs.length < 4) coverage.push("fewer than 4 distinct represented clubs");
  if (nationalities.length < 2) coverage.push("fewer than 2 nationalities");
  for (const need of ["renewal-first", "beneficial-loan-first", "accept-suitable-free-agent-offer", "stay"])
    if (!policies.includes(need)) coverage.push(`missing policy ${need}`);
  if (!ordinaryRecords.some((r) => r.flags?.renewed)) coverage.push("no ordinary career exercised a boundary renewal");
  if (!faPeriods.length) coverage.push("no ordinary career spent a period as a free agent");
  if (!ordinaryRecords.some((r) => r.flags?.signedFromFreeAgency)) coverage.push("no ordinary career signed from free agency");
  if (!ordinaryRecords.some((r) => r.flags?.loanTaken)) coverage.push("no ordinary career took a loan");
}
if (!clubSeasons.length) coverage.push("no ordinary club-season records");
const dedicatedOk = dedicated.filter((r) => r.cohort !== "error");
for (const need of [
  "dedicated:stay-opportunity",
  "dedicated:one-year-renewal",
  "dedicated:fa-recovery",
  "dedicated:fa-exhausted-control",
  "dedicated:pause-restore",
  "dedicated:cross-league-loan",
]) {
  if (!dedicatedOk.some((r) => r.cohort === need)) coverage.push(`missing dedicated cohort ${need}`);
}
if (dedicatedOk.filter((r) => r.cohort === "dedicated:stay-opportunity").length !== 2) coverage.push("stay-opportunity needs both Hull 58 and Atalanta 72");
for (const msg of coverage) violations.push({ caseId: "coverage", invariant: 0, msg });

const pass = violations.length === 0;
const summary = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  quick: QUICK,
  pass,
  ordinaryCohort: {
    careers: careerIds.length,
    seasonRecords: ordinaryRecords.length,
    clubSeasonRecords: clubSeasons.length,
    freeAgentPeriodRecords: faPeriods.length,
    positions,
    leagues,
    nationalities,
    readinessSetups: setups,
    policies,
    distinctRepresentedClubs: clubs.length,
    renewals: ordinaryRecords.filter((r) => r.flags?.renewed).length,
    releases: ordinaryRecords.filter((r) => r.flags?.released).length,
    signedFromFreeAgency: ordinaryRecords.filter((r) => r.flags?.signedFromFreeAgency).length,
    loansTaken: ordinaryRecords.filter((r) => r.flags?.loanTaken).length,
    withLowShare: clubSeasons.filter((r) => r.oracle?.share != null && r.oracle.share < LOW_MINUTES_SHARE).length,
    pass: ordinaryRecords.every((r) => r.pass),
  },
  dedicatedCohort: {
    records: dedicated.length,
    byCohort: dedicated.reduce((m, r) => ((m[r.cohort] = (m[r.cohort] || 0) + 1), m), {}),
    pass: dedicated.every((r) => r.pass),
  },
  invariants: {
    "1 opportunity arithmetic == independent ledger oracle": byInvariant[1] || 0,
    "2 clubMinutesShare / participationLedger / decisions agree": byInvariant[2] || 0,
    "3 international / other-club / unavailable / duplicate exclusions": byInvariant[3] || 0,
    "4 contract continuity (renewal, expiry, loan, stay)": byInvariant[4] || 0,
    "5 free-agent spell counters and recovery": byInvariant[5] || 0,
    "6 snapshot / pause-restore": byInvariant[6] || 0,
    "7 finite numbers / registration": byInvariant[7] || 0,
    "0 harness / coverage": byInvariant[0] || 0,
  },
  violationCount: violations.length,
  violations: violations.slice(0, 200),
  rows: all.map((r) => ({
    caseId: r.caseId,
    cohort: r.cohort,
    kind: r.kind ?? null,
    policy: r.decisionPolicy ?? null,
    position: r.position ?? null,
    leagueId: r.leagueId ?? null,
    represented: r.representedClubId ?? null,
    oracleShare: r.oracle?.share ?? null,
    productionShare: r.production?.playingTimeAssessment?.share ?? null,
    oracleEligible: r.oracle?.eligible ?? null,
    flags: r.flags ?? null,
    pass: r.pass,
    violations: (r.violations || []).length,
  })),
};
writeFileSync(SUMMARY, JSON.stringify(summary, null, 2));

const fmt = (x) => (x == null ? "-" : x.toFixed(4));
console.log(`Fix 07 playing-time / contract / free-agent recovery audit${QUICK ? " (QUICK)" : ""}`);
console.log(
  `  ordinary: ${summary.ordinaryCohort.seasonRecords} records / ${summary.ordinaryCohort.careers} careers ` +
    `(club ${summary.ordinaryCohort.clubSeasonRecords}, FA ${summary.ordinaryCohort.freeAgentPeriodRecords}; ` +
    `positions ${positions.join("/")}, leagues ${leagues.length}, nationalities ${nationalities.length}, ` +
    `setups ${setups.join("/")}) -> ${summary.ordinaryCohort.pass ? "PASS" : "FAIL"}`
);
console.log(
  `  policies: ${policies.join(", ")}; renewals ${summary.ordinaryCohort.renewals}, releases ${summary.ordinaryCohort.releases}, ` +
    `FA signings ${summary.ordinaryCohort.signedFromFreeAgency}, loans ${summary.ordinaryCohort.loansTaken}`
);
console.log(
  `  dedicated: ${summary.dedicatedCohort.records} cases ${JSON.stringify(summary.dedicatedCohort.byCohort)} -> ${
    summary.dedicatedCohort.pass ? "PASS" : "FAIL"
  }`
);
for (const [k, n] of Object.entries(summary.invariants)) console.log(`  invariant ${k}: ${n === 0 ? "ok" : `${n} violation(s)`}`);
for (const row of summary.rows) {
  console.log(
    `  ${row.pass ? "ok  " : "FAIL"} ${row.caseId}  [${row.kind ?? "-"}/${row.policy ?? "-"}] oracle=${fmt(row.oracleShare)} prod=${fmt(row.productionShare)} elig=${row.oracleEligible ?? "-"}`
  );
}
if (!pass) {
  console.error(`\nFAIL: ${violations.length} violation(s). First few:`);
  for (const v of violations.slice(0, 15)) console.error(`  [${v.caseId}] inv${v.invariant}: ${v.msg}${v.detail !== undefined ? " " + JSON.stringify(v.detail).slice(0, 240) : ""}`);
  process.exitCode = 1;
} else {
  console.log(`\nPASS: all invariants hold. Wrote ${SUMMARY} and ${all.length} case files under ${CASES}.`);
}
