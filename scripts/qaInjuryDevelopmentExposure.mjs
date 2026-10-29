/**
 * Fix 06 audit exporter: injury exposure scoped to the senior development period.
 *
 * Run from repo root: node scripts/qaInjuryDevelopmentExposure.mjs
 * Exits non-zero (process.exitCode = 1) when any required invariant fails.
 *
 * Cohorts
 *   ordinary  — 8 seeded three-period careers (24 real senior season records),
 *               ST/CM/CB/GK, >=2 leagues, ordinary + controlled historical injuries.
 *   dedicated — pause/restore, move, and summer-international cases, labelled
 *               separately and NOT counted toward the ordinary 24.
 *
 * The expected missed-day count comes from an independent day-occupancy Set
 * oracle (epoch-day integers only). It never calls estimateHealthyTrainingDetail
 * / estimateHealthyTrainingFraction; production values are read back from the
 * saved season evidence and compared against it.
 *
 * Outputs: qa/fix06-runs/audit/cases/*.json and qa/fix06-runs/audit/summary.json
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { LEAGUES, LEAGUE_LOOKUP, LEAGUE_BY_ID } from "../js/data/leagues.js";
import { reseedCareerRng, createRng, setSimRng } from "../js/simulation/rng.js";
import { createPlayerIdentity } from "../js/simulation/playerDevelopment.js";
import { ensurePlayerModel } from "../js/simulation/playerModelMigration.js";
import { refreshAbilityCaches } from "../js/simulation/playerAbility.js";
import { createWorldState, setWorldState, getWorldState } from "../js/simulation/worldState.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import {
  resolveDevelopmentPeriod,
  availabilityReturnDayOf,
  HEALTHY_FRACTION_FLOOR,
} from "../js/simulation/seasonEvidence.js";
import { createEmptyHealth } from "../js/simulation/playerHealth.js";
import { developSeason } from "../js/simulation/playerDevelopmentModel.js";
import {
  serializeCareerSnapshot,
  deserializeCareerSnapshot,
} from "../js/simulation/careerSnapshot.js";
import { ensurePlayingStints } from "../js/simulation/playingRegistration.js";
import { applyOfferToPlayer } from "../js/simulation/dealPipeline.js";
import { resolveMoveRegistration } from "../js/simulation/destinationSchedule.js";
import { allSeniorClubs } from "../js/simulation/seniorClubs.js";
import { assertPlayableRegistration } from "../js/simulation/contractLifecycle.js";

const OUT = "qa/fix06-runs/audit";
const CASES = `${OUT}/cases`;
mkdirSync(CASES, { recursive: true });

const START_YEAR = 2026;
const MS_PER_DAY = 86_400_000;
const FLOOR = 0.15; // literal brief value; also cross-checked with production constant
const EPS = 1e-12;

/* ------------------------------------------------------------------ */
/* Independent day arithmetic + oracle                                 */
/* ------------------------------------------------------------------ */

const epochDay = (y, m, d) => Date.UTC(y, m - 1, d) / MS_PER_DAY;
const isoOf = (day) => new Date(day * MS_PER_DAY).toISOString().slice(0, 10);

/** Independent June→June period for start year Y. */
function expectedPeriod(seasonStartYear) {
  const S = epochDay(seasonStartYear, 6, 1);
  const E = epochDay(seasonStartYear + 1, 6, 1);
  return {
    S,
    E,
    days: E - S,
    startDate: isoOf(S),
    endDate: isoOf(E),
  };
}

const finiteOrNull = (v) =>
  v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);

function dayFromDate(date) {
  if (date == null) return null;
  const t = date instanceof Date ? date.getTime() : Date.parse(date);
  return Number.isFinite(t) ? t / MS_PER_DAY : null;
}

function recordStart(rec) {
  return finiteOrNull(rec?.startDay ?? rec?.onsetDay) ?? dayFromDate(rec?.date);
}

/** Independent re-statement of the availability boundary (cross-check for production helper). */
function independentReturn(rec) {
  const a = finiteOrNull(rec?.availabilityReturnDay);
  if (a != null) return a;
  const e = finiteOrNull(rec?.expectedReturnDay);
  if (e != null) return e;
  const s = recordStart(rec);
  const dur = finiteOrNull(rec?.durationDays);
  if (s != null && dur != null) return s + dur;
  return finiteOrNull(rec?.recoveredDay);
}

function allInjuryRecords(health) {
  const out = [];
  for (const r of health?.injuryHistory || []) if (r && typeof r === "object") out.push({ rec: r, active: false });
  if (health?.activeInjury && typeof health.activeInjury === "object") {
    out.push({ rec: health.activeInjury, active: true });
  }
  return out;
}

/**
 * Day-occupancy oracle over [S, E). Day d is "missed" iff some distinct dated
 * injury interval [start, return) contains d. Returns the Set size plus a
 * per-record classification used for the old/future exclusion invariant.
 */
function oracleForPeriod(health, S, E) {
  const days = E - S;
  const records = allInjuryRecords(health);
  const datedIdsWithValidCopy = new Set();
  for (const { rec } of records) {
    const s = recordStart(rec);
    const e = availabilityReturnDayOf(rec);
    if (s != null && e != null && e > s && rec.eventId != null) datedIdsWithValidCopy.add(String(rec.eventId));
  }

  const occupied = new Set();
  const intervals = [];
  const exclusions = [];
  let undatedActiveDays = 0;
  const endpointMismatches = [];

  for (const { rec, active } of records) {
    const eventId = rec.eventId != null ? String(rec.eventId) : null;
    const s = recordStart(rec);
    const e = availabilityReturnDayOf(rec);
    const eInd = independentReturn(rec);
    if ((e ?? null) !== (eInd ?? null)) endpointMismatches.push({ eventId, production: e, independent: eInd });

    const hasEndpoints = s != null && e != null;
    if (hasEndpoints && !(e > s)) {
      exclusions.push({ eventId, reason: "reversed-or-empty-interval", startDay: s, returnDay: e });
      continue;
    }
    if (!hasEndpoints) {
      if (eventId && datedIdsWithValidCopy.has(eventId)) {
        exclusions.push({ eventId, reason: "incomplete-copy-superseded-by-dated-copy" });
      } else if (active) {
        const dur = finiteOrNull(rec.durationDays);
        undatedActiveDays += dur != null ? dur : 30;
        exclusions.push({
          eventId,
          reason: "undated-active-compat-charge",
          chargedDays: dur != null ? dur : 30,
        });
      } else {
        exclusions.push({ eventId, reason: "undated-historical-excluded" });
      }
      continue;
    }
    const lo = Math.max(s, S);
    const hi = Math.min(e, E);
    let placement;
    if (e <= S) placement = "old-before-period";
    else if (s >= E) placement = "future-after-period";
    else if (s < S && e > E) placement = "spans-period";
    else if (s < S) placement = "carry-in";
    else if (e > E) placement = "carry-out";
    else placement = "internal";
    const clippedDays = Math.max(0, hi - lo);
    for (let d = Math.ceil(lo); d < hi; d++) occupied.add(d);
    intervals.push({
      eventId,
      active,
      startDay: s,
      returnDay: e,
      placement,
      clippedStartDay: clippedDays > 0 ? lo : null,
      clippedEndDay: clippedDays > 0 ? hi : null,
      clippedDays,
    });
    if (clippedDays === 0) exclusions.push({ eventId, reason: placement, startDay: s, returnDay: e });
  }

  const unionDays = Math.min(days, occupied.size + undatedActiveDays);
  return {
    unionDays,
    datedUnionDays: occupied.size,
    undatedActiveDays,
    sumOfClippedDays: intervals.reduce((n, i) => n + i.clippedDays, 0),
    intervals,
    exclusions,
    occupiedSet: occupied,
    endpointMismatches,
  };
}

/* ------------------------------------------------------------------ */
/* Player factory                                                      */
/* ------------------------------------------------------------------ */

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
  const attrs = { Speed: 70, Passing: 68, Shooting: 72, Defending: 55, Physicality: 68, Dribbling: 70 };
  for (const k of Object.keys(attrs)) attrs[k] = rating - (k === "Defending" ? 8 : 0);
  return attrs;
}

function makePlayer({
  seed,
  position,
  rating = 72,
  leagueId = "league:england-premier-league",
  clubIndex = 0,
  nationality = null,
  careerId = null,
  health = null,
} = {}) {
  resetClubFinanceLedgers();
  reseedCareerRng(seed);
  setWorldState(createWorldState({ startYear: START_YEAR }));
  const league = LEAGUE_BY_ID.get(leagueId);
  if (!league) throw new Error(`unknown league ${leagueId}`);
  const club = league.clubs[Math.min(clubIndex, league.clubs.length - 1)];
  const p = createPlayerIdentity({
    name: `Fix06-${position}-${seed}`,
    nationality: nationality || league.nation || "England",
    position,
    age: 19,
  });
  p.startYear = START_YEAR;
  p.rating = rating;
  p.potential = 88;
  p.attributes = makeAttrs(position, rating);
  ensurePlayerModel(p);
  refreshAbilityCaches(p);
  p.club = {
    ...club,
    league: league.name,
    leagueDisplay: league.displayName,
    leagueId: league.leagueId,
    nation: league.nation,
    isAcademy: false,
  };
  p.employmentClubId = club.clubId;
  p.playingClubId = club.clubId;
  p.careerId = careerId || `fix06-${seed}-${position}`;
  p.contractStartSeason = 0;
  p.contractYears = 5;
  p.contractEndSeason = 5;
  p.weeklyWage = 5000;
  p.health = health || createEmptyHealth();
  ensurePlayingStints(p, { asOfDate: "2026-06-01" });
  return p;
}

const OLD_INJURY = Object.freeze({
  eventId: "old-pre-period",
  startDay: 100,
  expectedReturnDay: 400,
  recoveredDay: 400,
  durationDays: 300,
});

function histInjury(eventId, startDay, endDay, extras = {}) {
  return {
    eventId,
    kind: "qa-controlled",
    severity: "minor",
    startDay,
    expectedReturnDay: endDay,
    recoveredDay: endDay,
    durationDays: endDay - startDay,
    ...extras,
  };
}

/** Offsets are in days from the start of period `periodIndex`'s June 1. */
function periodDay(periodIndex, offset) {
  return expectedPeriod(START_YEAR + periodIndex).S + offset;
}

/* ------------------------------------------------------------------ */
/* Snapshot helpers                                                    */
/* ------------------------------------------------------------------ */

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const pickKeys = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj?.[k] ?? null]));
function diffKeys(a, b) {
  const out = {};
  for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    if (!same(a?.[k], b?.[k])) out[k] = { restored: a?.[k] ?? null, twin: b?.[k] ?? null };
  }
  return out;
}

function snapshotRoundTrip(player, checkpoint = null) {
  const snap = serializeCareerSnapshot({ player, world: getWorldState(), checkpoint });
  const restored = deserializeCareerSnapshot(JSON.parse(JSON.stringify(snap)));
  return { snap, restored };
}

function attrsFinite(attrs) {
  const bad = [];
  for (const [k, v] of Object.entries(attrs || {})) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) bad.push({ attr: k, value: v });
  }
  return bad;
}

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
/* Record builder + invariants                                         */
/* ------------------------------------------------------------------ */

const BANNED_METHODS = new Set(["history-durations", "default-no-health-data", "explicit-override"]);

/**
 * @param {object} ctx  { cohort, caseId, seed, position, seasonIdx, policy, flags, controlled, before, player, season }
 */
function buildRecord(ctx) {
  const { player, season, seasonIdx } = ctx;
  const Y = START_YEAR + seasonIdx;
  const exp = expectedPeriod(Y);
  const ev = season?.seasonEvidence || null;
  const dp = season?.developmentPeriod || null;
  const health = clone(player.health);
  const oracle = oracleForPeriod(health, exp.S, exp.E);
  const prodHealth = ev?.health || {};
  const clipped = prodHealth.clippedIntervals || [];

  const rawOracle = Math.min(1, Math.max(0, 1 - oracle.unionDays / exp.days));
  const appliedOracle = Math.min(1, Math.max(FLOOR, rawOracle));

  const breakdown = season?.developmentBreakdown || null;
  const prodPeriod = resolveDevelopmentPeriod(
    { startYear: START_YEAR, seasons: new Array(seasonIdx).fill({}) },
    { seasonIndex: seasonIdx }
  );

  const record = {
    cohort: ctx.cohort,
    caseId: ctx.caseId,
    seed: ctx.seed,
    careerId: player.careerId,
    playerName: player.name,
    position: player.position,
    clubId: season?.clubId ?? null,
    leagueId: season?.leagueId ?? null,
    seasonIndex: seasonIdx,
    seasonNumber: season?.seasonNumber ?? null,
    periodId: dp?.periodId ?? null,
    decisionPolicy: ctx.policy,
    flags: {
      paused: false,
      restored: false,
      moved: false,
      crossLeagueMove: false,
      summerInternational: false,
      controlledInjury: Boolean(ctx.controlled?.length),
      ...ctx.flags,
    },
    period: {
      expectedIndependent: exp,
      resolved: prodPeriod,
      saved: dp,
    },
    rawInjuryInputs: {
      activeInjury: health?.activeInjury ?? null,
      injuryHistory: health?.injuryHistory ?? [],
      controlledInjected: ctx.controlled || [],
    },
    normalized: {
      oracleIntervals: oracle.intervals,
      oracleExclusions: oracle.exclusions,
      productionClippedIntervals: clipped,
      productionContributingEventIds: prodHealth.contributingEventIds ?? [],
      productionExcludedUnknownEventIds: prodHealth.excludedUnknownEventIds ?? [],
    },
    missedDays: {
      oracleUnion: oracle.unionDays,
      oracleDatedUnion: oracle.datedUnionDays,
      oracleUndatedActive: oracle.undatedActiveDays,
      oracleSumOfClipped: oracle.sumOfClippedDays,
      production: prodHealth.injuredDays ?? null,
      periodDays: exp.days,
    },
    fractions: {
      oracleRaw: rawOracle,
      oracleApplied: appliedOracle,
      productionRaw: ev?.rawHealthyTrainingFraction ?? null,
      productionApplied: ev?.healthyTrainingFraction ?? null,
      healthRaw: prodHealth.rawHealthyTrainingFraction ?? null,
      healthApplied: prodHealth.appliedHealthyTrainingFraction ?? null,
      breakdownDevelopmentInput: breakdown?.healthyTrainingFraction ?? null,
      floor: FLOOR,
    },
    method: prodHealth.method ?? null,
    partial: prodHealth.partial ?? null,
    savedSeasonEvidence: clone(ev),
    developmentBreakdown: clone(breakdown),
    attributes: {
      before: ctx.before.attributes,
      after: { ...player.attributes },
    },
    overall: {
      before: ctx.before.overall,
      after: {
        rating: player.rating,
        baseOverallRaw: player.baseOverallRaw,
        currentOverall: player.currentOverall,
        seasonRatingChange: season?.ratingChange ?? null,
        seasonBaseOverallBefore: season?.baseOverallBefore ?? null,
        seasonBaseOverallAfter: season?.baseOverallAfter ?? null,
      },
    },
    checks: {},
    violations: [],
  };

  const v = record.violations;
  const fail = (invariant, msg, detail) => v.push({ invariant, msg, ...(detail !== undefined ? { detail } : {}) });
  const approx = (a, b) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= EPS;

  /* 1. Period validity / no no-window fallback */
  if (!ev || !dp) {
    fail(1, "season evidence or developmentPeriod missing");
  } else {
    if (!(exp.days >= 365 && exp.days <= 366)) fail(1, "independent period length out of range", exp.days);
    if (dp.days !== exp.days) fail(1, "saved period days != independent", { saved: dp.days, exp: exp.days });
    if (dp.startDay !== exp.S || dp.endDay !== exp.E)
      fail(1, "saved period endpoints != independent", { saved: [dp.startDay, dp.endDay], exp: [exp.S, exp.E] });
    if (dp.startDate !== exp.startDate || dp.endExclusiveDate !== exp.endDate)
      fail(1, "saved period dates != independent", { saved: [dp.startDate, dp.endExclusiveDate], exp });
    if (dp.endDay - dp.startDay !== dp.days) fail(1, "saved period days != endDay-startDay");
    if (dp.periodId !== `season-${seasonIdx + 1}`) fail(1, "periodId unexpected", dp.periodId);
    if (dp.seasonStartYear !== Y) fail(1, "seasonStartYear unexpected", dp.seasonStartYear);
    if (prodPeriod.periodStartDay !== exp.S || prodPeriod.periodEndDay !== exp.E)
      fail(1, "resolveDevelopmentPeriod != independent endpoints");
    if (season.seasonNumber !== seasonIdx + 1) fail(1, "seasonNumber != index+1", season.seasonNumber);
    if (!same(ev.developmentPeriod, dp)) fail(1, "evidence.developmentPeriod != season.developmentPeriod");
    if (prodHealth.hasDatedWindow !== true) fail(1, "health.hasDatedWindow !== true (no-window fallback)");
    if (prodHealth.windowStartDay !== exp.S || prodHealth.windowEndDay !== exp.E)
      fail(1, "health window != period", { start: prodHealth.windowStartDay, end: prodHealth.windowEndDay });
    if (prodHealth.seasonDays !== exp.days) fail(1, "health.seasonDays != period days", prodHealth.seasonDays);
    if (BANNED_METHODS.has(prodHealth.method)) fail(1, `banned health method '${prodHealth.method}'`);
    if (HEALTHY_FRACTION_FLOOR !== FLOOR) fail(4, "production floor constant != 0.15", HEALTHY_FRACTION_FLOOR);
  }

  /* 2. Old / future injuries contribute zero */
  const zeroExpected = oracle.intervals.filter((i) => i.clippedDays === 0 && i.eventId);
  const prodContributing = new Set((prodHealth.contributingEventIds || []).map(String));
  const prodClippedIds = new Set(clipped.map((c) => String(c.eventId)));
  const overlappingOracleIds = new Set(oracle.intervals.filter((i) => i.clippedDays > 0).map((i) => i.eventId));
  for (const z of zeroExpected) {
    if (overlappingOracleIds.has(z.eventId)) continue; // another copy of the same event does overlap
    if (prodContributing.has(z.eventId) || prodClippedIds.has(z.eventId)) {
      fail(2, `${z.placement} injury contributed to production exposure`, z);
    }
  }
  for (const c of clipped) {
    if (!overlappingOracleIds.has(String(c.eventId)) && c.eventId != null) {
      fail(2, "production clipped an event the oracle sees as non-overlapping", c);
    }
  }
  for (const id of ctx.expectZeroEventIds || []) {
    if (prodContributing.has(id) || prodClippedIds.has(id)) fail(2, `controlled zero-event '${id}' contributed`, id);
    const hit = oracle.intervals.find((i) => i.eventId === id);
    if (hit && hit.clippedDays !== 0) fail(2, `oracle shows controlled zero-event '${id}' overlapping`, hit);
  }

  /* 3. Missed days == independent union; no double charge */
  if (oracle.endpointMismatches.length) fail(3, "availabilityReturnDayOf disagrees with independent endpoint", oracle.endpointMismatches);
  if (prodHealth.injuredDays !== oracle.unionDays)
    fail(3, "production injuredDays != oracle union", { production: prodHealth.injuredDays, oracle: oracle.unionDays });
  if (typeof prodHealth.injuredDays === "number" && prodHealth.injuredDays > exp.days)
    fail(3, "injuredDays exceeds period length");
  const prodSumClipped = clipped.reduce((n, c) => n + (c.clippedDays || 0), 0);
  if (prodHealth.injuredDays > prodSumClipped + oracle.undatedActiveDays)
    fail(3, "injuredDays exceeds sum of clipped intervals", { injuredDays: prodHealth.injuredDays, prodSumClipped });
  for (const c of clipped) {
    if (!(c.clippedStartDay >= exp.S && c.clippedEndDay <= exp.E && c.clippedEndDay > c.clippedStartDay))
      fail(3, "production clipped interval outside period", c);
    for (let d = Math.ceil(c.clippedStartDay); d < c.clippedEndDay; d++) {
      if (!oracle.occupiedSet.has(d)) {
        fail(3, "production clipped day not occupied in oracle", { eventId: c.eventId, day: d });
        break;
      }
    }
  }
  // Duplicate-event / overlap double-charge: union <= sum with equality only when disjoint.
  record.checks.overlapDoubleChargeAvoided =
    oracle.sumOfClippedDays >= oracle.datedUnionDays && prodHealth.injuredDays === oracle.unionDays;
  for (const c of ctx.controlled || []) {
    // Controlled floor: oracle union must at least contain each injected interval's in-period days.
    const lo = Math.max(c.startDay, exp.S);
    const hi = Math.min(c.expectedReturnDay, exp.E);
    for (let d = Math.ceil(lo); d < hi; d++) {
      if (!oracle.occupiedSet.has(d)) {
        fail(3, `oracle misses controlled injected day for '${c.eventId}'`, { day: d });
        break;
      }
    }
  }
  if (typeof ctx.expectedControlledOnlyDays === "number") {
    // Only meaningful when the caller knows no new engine injuries overlapped this period.
    const newEngine = oracle.intervals.filter(
      (i) => i.clippedDays > 0 && !(ctx.controlled || []).some((c) => c.eventId === i.eventId)
    );
    record.checks.engineGeneratedOverlappingEvents = newEngine.map((i) => i.eventId);
    if (!newEngine.length && oracle.unionDays !== ctx.expectedControlledOnlyDays)
      fail(3, "controlled-only union != hand-computed expectation", {
        oracle: oracle.unionDays,
        expected: ctx.expectedControlledOnlyDays,
      });
  }

  /* 4. Raw / applied fractions */
  if (!approx(ev?.rawHealthyTrainingFraction, rawOracle))
    fail(4, "raw fraction != 1 - oracleDays/periodDays", { prod: ev?.rawHealthyTrainingFraction, oracle: rawOracle });
  if (!approx(ev?.healthyTrainingFraction, appliedOracle))
    fail(4, "applied fraction != clamp(raw, 0.15, 1)", { prod: ev?.healthyTrainingFraction, oracle: appliedOracle });
  if (ev && ev.healthyTrainingFraction < FLOOR - EPS) fail(4, "applied fraction below floor");
  if (ev && rawOracle < FLOOR && !approx(ev.healthyTrainingFraction, FLOOR))
    fail(4, "floor not applied when raw < 0.15");

  /* 5. Evidence == development input == persisted breakdown */
  const savedRow = player.seasons?.[seasonIdx] ?? null;
  const persisted = savedRow ? JSON.parse(JSON.stringify(savedRow)) : null;
  record.checks.persistedRoundTripEvidenceEqual = Boolean(persisted && same(persisted.seasonEvidence, savedRow.seasonEvidence));
  if (!savedRow) fail(5, "season row missing from player.seasons");
  else {
    if (savedRow !== season && !same(clone(savedRow.seasonEvidence), clone(season.seasonEvidence)))
      fail(5, "returned season evidence != player.seasons evidence");
    if (!breakdown) fail(5, "developmentBreakdown missing");
    else {
      if (!approx(breakdown.healthyTrainingFraction, ev?.healthyTrainingFraction))
        fail(5, "breakdown.healthyTrainingFraction != evidence.healthyTrainingFraction", {
          breakdown: breakdown.healthyTrainingFraction,
          evidence: ev?.healthyTrainingFraction,
        });
      if (!approx(breakdown.healthyTrainingFraction, appliedOracle))
        fail(5, "breakdown.healthyTrainingFraction != oracle applied", breakdown.healthyTrainingFraction);
      if (!same(persisted?.developmentBreakdown, breakdown)) fail(5, "persisted breakdown round-trip differs");
    }
    if (!approx(prodHealth.appliedHealthyTrainingFraction, ev?.healthyTrainingFraction))
      fail(5, "health.applied != evidence.applied");
    if (!approx(prodHealth.rawHealthyTrainingFraction, ev?.rawHealthyTrainingFraction))
      fail(5, "health.raw != evidence.raw");
    if (!same(persisted?.seasonEvidence?.health, ev?.health)) fail(5, "persisted health evidence round-trip differs");
  }

  /* 7. Finite attributes / registration */
  const badAfter = attrsFinite(player.attributes);
  const badBefore = attrsFinite(ctx.before.attributes);
  if (badAfter.length) fail(7, "non-finite/out-of-range attribute after season", badAfter);
  if (badBefore.length) fail(7, "non-finite/out-of-range attribute before season", badBefore);
  for (const k of ["rating", "baseOverallRaw", "currentOverall"]) {
    if (!Number.isFinite(player[k])) fail(7, `player.${k} non-finite`, player[k]);
  }
  const badNums = [
    ...numbersFinite(breakdown, "developmentBreakdown"),
    ...numbersFinite(player.health?.durableDamage, "health.durableDamage"),
    ...numbersFinite(player.health?.recoverableDamage, "health.recoverableDamage"),
    ...numbersFinite({ f: ev?.healthyTrainingFraction, r: ev?.rawHealthyTrainingFraction }, "evidence"),
  ];
  if (badNums.length) fail(7, "non-finite numbers", badNums);
  const reg = assertPlayableRegistration(player);
  record.checks.registration = reg;
  if (!reg.ok) fail(7, "invalid registration after season", reg);
  if (!player.club?.leagueId || !(player.playingClubId || player.club?.clubId))
    fail(7, "missing club/league identity after season");

  record.pass = v.length === 0;
  return record;
}

function writeCase(record) {
  const safe = record.caseId.replace(/[^A-Za-z0-9._-]+/g, "_");
  writeFileSync(`${CASES}/${safe}.json`, JSON.stringify(record, null, 2));
}

function captureBefore(player) {
  return {
    attributes: { ...player.attributes },
    overall: {
      rating: player.rating,
      baseOverallRaw: player.baseOverallRaw,
      currentOverall: player.currentOverall,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Ordinary cohort: 8 careers x 3 periods                              */
/* ------------------------------------------------------------------ */

/**
 * `controlled` entries: { periodIndex, offsetStart, offsetEnd, eventId, active? } injected
 * (as history, or as the active injury) into the health model before period 1.
 * `oldInjury`: install the brief's OLD_INJURY.
 */
const CAREERS = [
  { id: "C01", seed: 2, position: "ST", rating: 72, oldInjury: true, note: "brief clean seed: old injury, zero new overlap" },
  { id: "C02", seed: 3, position: "GK", rating: 72, oldInjury: true, note: "brief clean seed: old injury, zero new overlap" },
  { id: "C03", seed: 11, position: "CM", rating: 74, leagueId: "league:italy-serie-a", clubIndex: 3, nationality: "Italy" },
  { id: "C04", seed: 12, position: "CB", rating: 70, leagueId: "league:spain-la-liga", clubIndex: 5, nationality: "Spain" },
  {
    id: "C05",
    seed: 21,
    position: "ST",
    rating: 68,
    leagueId: "league:italy-serie-a",
    clubIndex: 7,
    nationality: "Italy",
    note: "controlled: overlapping + adjacent + duplicate-id injuries in p1; future-only injury in p3",
    controlled: [
      { periodIndex: 0, offsetStart: 60, offsetEnd: 90, eventId: "qa-a" },
      { periodIndex: 0, offsetStart: 80, offsetEnd: 110, eventId: "qa-b-overlap" },
      { periodIndex: 0, offsetStart: 110, offsetEnd: 120, eventId: "qa-c-adjacent" },
      { periodIndex: 2, offsetStart: 100, offsetEnd: 140, eventId: "qa-future-p3" },
    ],
  },
  {
    id: "C06",
    seed: 22,
    position: "CM",
    rating: 76,
    clubIndex: 8,
    oldInjury: true,
    note: "controlled: carry-in active injury at start of p1 (clipped), old injury",
    controlled: [{ periodIndex: 0, offsetStart: -10, offsetEnd: 14, eventId: "qa-carry-in", active: true }],
  },
  {
    id: "C07",
    seed: 23,
    position: "CB",
    rating: 70,
    leagueId: "league:spain-la-liga",
    clubIndex: 9,
    nationality: "Spain",
    oldInjury: true,
    note: "controlled: p1-only internal injury must be zero in p2/p3; carry-out across p1/p2 boundary",
    controlled: [
      { periodIndex: 0, offsetStart: 40, offsetEnd: 55, eventId: "qa-p1-only" },
      { periodIndex: 0, offsetStart: 355, offsetEnd: 385, eventId: "qa-carry-out-p1-p2" },
    ],
  },
  { id: "C08", seed: 24, position: "GK", rating: 66, leagueId: "league:italy-serie-a", clubIndex: 11, nationality: "Italy" },
];

function installControlled(player, cfg) {
  const defs = [];
  if (cfg.oldInjury) {
    player.health.injuryHistory.push({ ...OLD_INJURY });
    defs.push({ ...OLD_INJURY, periodIndex: null, controlledKind: "old-pre-period" });
  }
  for (const c of cfg.controlled || []) {
    const startDay = periodDay(c.periodIndex, c.offsetStart);
    const endDay = periodDay(c.periodIndex, c.offsetEnd);
    const rec = histInjury(c.eventId, startDay, endDay);
    if (c.active) {
      // Production would already have applied durable damage for this event.
      delete rec.recoveredDay;
      player.health.activeInjury = { ...rec, progress: 0 };
      player.development = player.development || {};
      player.development.appliedEventIds = {
        ...(player.development.appliedEventIds || {}),
        [`injury:${c.eventId}`]: true,
      };
    } else {
      player.health.injuryHistory.push(rec);
    }
    defs.push({ ...rec, periodIndex: c.periodIndex, active: Boolean(c.active), controlledKind: "dated" });
  }
  return defs;
}

/** Subset of controlled definitions whose intervals intersect `periodIndex`. */
function controlledForPeriod(defs, periodIndex) {
  const { S, E } = expectedPeriod(START_YEAR + periodIndex);
  return defs.filter((d) => d.expectedReturnDay > S && d.startDay < E);
}

function controlledZeroIds(defs, periodIndex) {
  const { S, E } = expectedPeriod(START_YEAR + periodIndex);
  return defs.filter((d) => !(d.expectedReturnDay > S && d.startDay < E)).map((d) => d.eventId);
}

function snapshotChecksAfterPeriod(player, seasonIdx, record, extraFails) {
  const fail = (msg, detail) => extraFails.push({ invariant: 6, msg, ...(detail !== undefined ? { detail } : {}) });
  const periodId = `season-${seasonIdx + 1}`;
  const { snap, restored } = snapshotRoundTrip(player);
  const rp = restored.player;
  const sRow = player.seasons[seasonIdx];
  const rRow = rp.seasons?.[seasonIdx];
  const result = {
    seasonsLength: { live: player.seasons.length, restored: rp.seasons?.length },
    lastProcessed: { live: player.development.lastProcessedSeasonId, restored: rp.development?.lastProcessedSeasonId },
  };
  if (!rRow) fail("restored player missing season row");
  else {
    if (!same(rRow.developmentPeriod, sRow.developmentPeriod)) fail("restored developmentPeriod differs");
    if (!same(rRow.seasonEvidence?.health, sRow.seasonEvidence?.health)) fail("restored evidence.health differs");
    if (rRow.seasonEvidence?.healthyTrainingFraction !== sRow.seasonEvidence?.healthyTrainingFraction)
      fail("restored applied fraction differs");
    if (rRow.seasonEvidence?.rawHealthyTrainingFraction !== sRow.seasonEvidence?.rawHealthyTrainingFraction)
      fail("restored raw fraction differs");
    if (!same(rRow.developmentBreakdown, sRow.developmentBreakdown)) fail("restored developmentBreakdown differs");
  }
  if (rp.seasons?.length !== player.seasons.length) fail("restored seasons length differs");
  if (rp.development?.lastProcessedSeasonId !== player.development.lastProcessedSeasonId)
    fail("restored lastProcessedSeasonId differs");
  if (!same(rp.attributes, player.attributes)) fail("restored attributes differ");
  if (!same(rp.health, player.health)) fail("restored health differs");
  if (!same(rp.development?.developmentPeriodById?.[periodId], player.development?.developmentPeriodById?.[periodId]))
    fail("restored developmentPeriodById entry differs");
  if (!rp.development?.appliedEventIds?.[`season:${periodId}`]) fail("restored player lacks applied key for period");

  // Exact-once at the development layer: replaying same period must be a no-op.
  const beforeAttrs = clone(rp.attributes);
  const beforeRating = rp.rating;
  const replay = developSeason(rp, { seasonId: periodId, elapsedYears: 1, healthyTrainingFraction: 0.5, rng: createRng(1) });
  result.developSeasonReplay = { skipped: Boolean(replay?.skipped), reason: replay?.reason ?? null };
  if (!replay?.skipped) fail("developSeason replay for same period was not skipped", replay);
  if (!same(rp.attributes, beforeAttrs) || rp.rating !== beforeRating) fail("replay mutated attributes/rating");
  result.snapshotRngSeed = snap.rngSeed;
  record.checks.snapshotResume = result;
  return restored;
}

function runCareer(cfg) {
  const player = makePlayer(cfg);
  const defs = installControlled(player, cfg);
  const records = [];
  const policy = "stay";
  for (let k = 0; k < 3; k++) {
    const before = captureBefore(player);
    let season = null;
    let thrown = null;
    try {
      const result = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, { autoDecisionPolicy: policy });
      season = result?.season ?? player.seasons[player.seasons.length - 1];
      if (result?.freeAgent || result?.awaitingDecision) thrown = "season did not complete as a senior period";
    } catch (e) {
      thrown = String(e?.stack || e);
    }
    const periodControlled = controlledForPeriod(defs, k);
    const record = buildRecord({
      cohort: "ordinary",
      caseId: `${cfg.id}-${cfg.position}-seed${cfg.seed}-p${k + 1}`,
      seed: cfg.seed,
      player,
      season,
      seasonIdx: k,
      policy,
      before,
      controlled: periodControlled,
      expectZeroEventIds: controlledZeroIds(defs, k),
      flags: { carryInControlled: periodControlled.some((d) => d.active) },
    });
    if (thrown) record.violations.push({ invariant: 1, msg: "simulateSeason failed", detail: thrown });
    record.meta = { careerConfigId: cfg.id, note: cfg.note || null, league: player.club?.leagueId };

    if (!thrown) {
      const extra = [];
      snapshotChecksAfterPeriod(player, k, record, extra);
      record.violations.push(...extra);
    }
    record.pass = record.violations.length === 0;
    records.push(record);
    if (thrown) break;
  }

  // Cross-period: adjacency, non-overlap, exact-once for the whole career.
  const cross = [];
  for (let k = 1; k < records.length; k++) {
    const a = records[k - 1].period.saved;
    const b = records[k].period.saved;
    if (!a || !b) continue;
    if (a.endDay !== b.startDay) cross.push({ invariant: 1, msg: `period ${k} end != period ${k + 1} start`, detail: { a, b } });
    if (!(b.startDay >= a.endDay)) cross.push({ invariant: 1, msg: "periods overlap", detail: { a, b } });
    if (a.periodId === b.periodId) cross.push({ invariant: 6, msg: "duplicate periodId across seasons", detail: a.periodId });
  }
  if (records.length === 3 && player.seasons.length !== 3)
    cross.push({ invariant: 6, msg: "career did not end with exactly 3 season rows", detail: player.seasons.length });

  // Final re-finalise attempt on a restored clone with the last season removed: must refuse.
  if (records.length === 3) {
    const { restored } = snapshotRoundTrip(player);
    const rp = restored.player;
    setWorldState(restored.world);
    rp.seasons.pop();
    const ageBefore = rp.age;
    const attrsBefore = clone(rp.attributes);
    let threw = null;
    try {
      simulateSeason(rp, LEAGUES, LEAGUE_LOOKUP, { autoDecisionPolicy: "stay" });
    } catch (e) {
      threw = String(e?.message || e);
    }
    const ok = Boolean(threw && /already applied/.test(threw)) && rp.age === ageBefore && same(rp.attributes, attrsBefore);
    records[2].checks.exactOnceRefinalize = { threw, ok };
    if (!ok) cross.push({ invariant: 6, msg: "re-finalizing completed period was not refused / mutated state", detail: threw });
  }
  if (cross.length && records.length) {
    records[records.length - 1].violations.push(...cross);
    records[records.length - 1].pass = false;
  }
  for (const r of records) writeCase(r);
  return records;
}

/* ------------------------------------------------------------------ */
/* Dedicated cases                                                     */
/* ------------------------------------------------------------------ */

function pauseToDecision(player) {
  let seasonData = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: true,
    autoDecisionPolicy: null,
  });
  let guards = 0;
  while (seasonData?.awaitingScenario && guards < 12) {
    guards += 1;
    player.pendingSeniorScenario = null;
    if (seasonData.checkpoint) seasonData.checkpoint.pendingSeniorScenario = null;
    player.seasonCheckpoint = seasonData.checkpoint;
    seasonData = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions: true,
      autoDecisionPolicy: null,
    });
  }
  if (!(seasonData?.awaitingDecision || seasonData?.checkpoint)) throw new Error("season did not pause at a decision");
  return seasonData;
}

function clearDecision(rp) {
  rp.pendingDecision = null;
  rp.pendingOffers = [];
  if (rp.seasonCheckpoint) {
    rp.seasonCheckpoint.decision = null;
    rp.seasonCheckpoint.offers = [];
  }
}

function pauseRestoreCase({ id, seed, position, rating, oldInjury, injected, leagueId, clubIndex, nationality }) {
  const cfg = { seed, position, rating, leagueId, clubIndex, nationality };
  const defsFor = (p) => {
    const defs = [];
    if (oldInjury) {
      p.health.injuryHistory.push({ ...OLD_INJURY });
      defs.push({ ...OLD_INJURY });
    }
    for (const c of injected || []) {
      const rec = histInjury(c.eventId, periodDay(0, c.offsetStart), periodDay(0, c.offsetEnd));
      p.health.injuryHistory.push(rec);
      defs.push(rec);
    }
    return defs;
  };

  // Uninterrupted twin (same seed, same setup).
  const twin = makePlayer(cfg);
  defsFor(twin);
  simulateSeason(twin, LEAGUES, LEAGUE_LOOKUP, { autoDecisionPolicy: "stay" });

  // Paused / restored run.
  const p = makePlayer(cfg);
  const defs = defsFor(p);
  const before = captureBefore(p);
  const paused = pauseToDecision(p);
  const ck = paused.checkpoint || p.seasonCheckpoint;
  const pauseState = {
    checkpointPeriod: clone(ck?.developmentPeriod ?? null),
    ageAtPause: p.age,
    seasonsAtPause: p.seasons.length,
    activeInjuryAtPause: clone(p.health.activeInjury),
    historyIdsAtPause: p.health.injuryHistory.map((h) => h.eventId),
  };
  const { snap, restored } = snapshotRoundTrip(p, ck);
  setWorldState(restored.world);
  setSimRng(createRng(snap.rngSeed));
  const rp = restored.player;
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
    caseId: `D-${id}-pause-restore-${position}-seed${seed}`,
    seed,
    player: rp,
    season,
    seasonIdx: 0,
    policy: "pause→snapshot→restore→stay",
    before,
    controlled: defs.filter((d) => d.eventId !== OLD_INJURY.eventId || true),
    expectZeroEventIds: oldInjury ? [OLD_INJURY.eventId] : [],
    flags: { paused: true, restored: true },
  });
  if (thrown) record.violations.push({ invariant: 6, msg: "resume failed", detail: thrown });
  record.pauseState = pauseState;

  const fail = (msg, detail) => record.violations.push({ invariant: 6, msg, ...(detail !== undefined ? { detail } : {}) });
  if (!pauseState.checkpointPeriod) fail("checkpoint did not carry developmentPeriod");
  if (pauseState.ageAtPause !== 19) fail("age advanced at pause", pauseState.ageAtPause);
  if (pauseState.seasonsAtPause !== 0) fail("season finalised at pause", pauseState.seasonsAtPause);
  const exp = expectedPeriod(START_YEAR);
  if (pauseState.checkpointPeriod && (pauseState.checkpointPeriod.startDay !== exp.S || pauseState.checkpointPeriod.endDay !== exp.E))
    fail("checkpoint period != independent period", pauseState.checkpointPeriod);
  if (season) {
    const t = twin.seasons[0];
    record.checks.twinComparison = {
      periodEqual: same(season.developmentPeriod, t.developmentPeriod),
      healthEqual: same(season.seasonEvidence.health, t.seasonEvidence.health),
      breakdownEqual: same(season.developmentBreakdown, t.developmentBreakdown),
      attributesEqual: same(rp.attributes, twin.attributes),
      healthRecordsEqual: same(rp.health, twin.health),
      matchInputsEqual: same(
        pickKeys(season.seasonEvidence, ["minutes", "appearances", "seasonP", "reliability", "goals", "assists"]),
        pickKeys(t.seasonEvidence, ["minutes", "appearances", "seasonP", "reliability", "goals", "assists"])
      ),
      breakdownFieldDiffs: diffKeys(season.developmentBreakdown, t.developmentBreakdown),
    };
    if (!record.checks.twinComparison.periodEqual) fail("restored period differs from uninterrupted twin");
    // Same injuries => health accounting must agree exactly. Development output is compared only when
    // the match-derived inputs (minutes/seasonP/reliability) also agree: post-pause fixtures replay from
    // restored RNG state and fixture-level divergence there is not an injury-accounting defect.
    // The divergent breakdown fields are exported in breakdownFieldDiffs.
    const sameInjuries = same(
      oracleForPeriod(rp.health, exp.S, exp.E).intervals,
      oracleForPeriod(twin.health, exp.S, exp.E).intervals
    );
    const tc = record.checks.twinComparison;
    tc.sameInjuryIntervals = sameInjuries;
    if (sameInjuries) {
      if (!tc.healthEqual) fail("same injuries but restored evidence.health != twin");
      if (tc.breakdownFieldDiffs.healthyTrainingFraction)
        fail("same injuries but breakdown healthyTrainingFraction != twin", tc.breakdownFieldDiffs.healthyTrainingFraction);
      if (tc.matchInputsEqual) {
        if (!tc.breakdownEqual) fail("same injuries + match inputs but restored breakdown != twin", tc.breakdownFieldDiffs);
        if (!tc.attributesEqual) fail("same injuries + match inputs but restored attributes != twin");
      }
    }
    // Exact-once after resume.
    if (rp.seasons.length !== 1) fail("resumed player has wrong season count", rp.seasons.length);
    if (rp.development.lastProcessedSeasonId !== "season-1") fail("lastProcessedSeasonId != season-1");
    const extra = [];
    snapshotChecksAfterPeriod(rp, 0, record, extra);
    record.violations.push(...extra);
    const ageBefore = rp.age;
    const attrsBefore = clone(rp.attributes);
    rp.seasons.pop();
    let threw = null;
    try {
      simulateSeason(rp, LEAGUES, LEAGUE_LOOKUP, { autoDecisionPolicy: "stay" });
    } catch (e) {
      threw = String(e?.message || e);
    }
    const ok = Boolean(threw && /already applied/.test(threw)) && rp.age === ageBefore && same(rp.attributes, attrsBefore);
    record.checks.exactOnceRefinalize = { threw, ok };
    if (!ok) fail("re-finalize after resume not refused", threw);
  }
  record.pass = record.violations.length === 0;
  writeCase(record);
  return record;
}

function findClub(clubId) {
  return (
    allSeniorClubs().find((c) => c.clubId === clubId) ||
    LEAGUES.flatMap((l) => l.clubs).find((c) => c.clubId === clubId)
  );
}

function moveCase({ id, seed, position, rating, destClubId, injected, restoreFirst }) {
  const p = makePlayer({ seed, position, rating });
  const injectedDefs = [];
  p.health.injuryHistory.push({ ...OLD_INJURY });
  for (const c of injected || []) {
    const rec = histInjury(c.eventId, periodDay(0, c.offsetStart), periodDay(0, c.offsetEnd));
    p.health.injuryHistory.push(rec);
    injectedDefs.push(rec);
  }
  const before = captureBefore(p);
  const fromClubId = p.club.clubId;
  const fromLeagueId = p.club.leagueId;
  const paused = pauseToDecision(p);
  const ck = paused.checkpoint || p.seasonCheckpoint;
  const periodBefore = clone(ck?.developmentPeriod ?? null);

  let player = p;
  if (restoreFirst) {
    const { snap, restored } = snapshotRoundTrip(p, ck);
    setWorldState(restored.world);
    setSimRng(createRng(snap.rngSeed));
    player = restored.player;
    clearDecision(player);
  }
  const ckNow = player.seasonCheckpoint || ck;
  const dest = findClub(destClubId);
  if (!dest) throw new Error(`destination club not found: ${destClubId}`);
  const offer = {
    club: dest.name,
    clubDisplay: dest.displayName,
    clubId: dest.clubId,
    league: dest.league || LEAGUE_BY_ID.get(dest.leagueId)?.name,
    leagueDisplay: dest.leagueDisplay,
    leagueId: dest.leagueId,
    nation: dest.nation,
    tier: dest.tier,
    badge: dest.badge,
    overall: dest.overall,
    isLoan: false,
    wage: 6000,
    contractYears: 3,
    expectedRole: "starter",
    reviewDate: ckNow.lastDate,
    effectiveDate: ckNow.lastDate,
    registration: resolveMoveRegistration({
      destinationLeagueId: dest.leagueId,
      departureDate: ckNow.lastDate,
      originSeasonStartYear: START_YEAR,
    }),
  };
  applyOfferToPlayer(player, offer, `fix06-audit-move-${id}`);
  player.pendingOffers = [];
  player.pendingDecision = null;

  let season = null;
  let thrown = null;
  try {
    season = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, { pauseForDecisions: false, autoDecisionPolicy: null }).season;
  } catch (e) {
    thrown = String(e?.stack || e);
  }
  const crossLeague = Boolean(dest.leagueId && dest.leagueId !== fromLeagueId);
  const record = buildRecord({
    cohort: "dedicated:move",
    caseId: `D-${id}-move-${position}-seed${seed}`,
    seed,
    player,
    season,
    seasonIdx: 0,
    policy: restoreFirst ? "pause→restore→accept-offer" : "pause→accept-offer",
    before,
    controlled: [{ ...OLD_INJURY }, ...injectedDefs],
    expectZeroEventIds: [OLD_INJURY.eventId],
    flags: {
      paused: true,
      restored: Boolean(restoreFirst),
      moved: true,
      crossLeagueMove: crossLeague,
    },
  });
  if (thrown) record.violations.push({ invariant: 1, msg: "season after move failed", detail: thrown });
  record.move = { fromClubId, toClubId: dest.clubId, fromLeagueId, toLeagueId: dest.leagueId, crossLeague, periodBefore };
  const fail = (invariant, msg, detail) => record.violations.push({ invariant, msg, ...(detail !== undefined ? { detail } : {}) });
  if (season) {
    if (!same(season.developmentPeriod, periodBefore) && periodBefore) {
      const a = season.developmentPeriod;
      const b = periodBefore;
      if (a.startDate !== b.startDate || a.endExclusiveDate !== b.endExclusiveDate || a.days !== b.days)
        fail(1, "move changed the development period window", { before: b, after: a });
    }
    if (player.playingClubId !== dest.clubId) fail(7, "player not registered at destination", player.playingClubId);
    if (player.seasons.length !== 1) fail(6, "season count after move != 1", player.seasons.length);
    if (player.development.lastProcessedSeasonId !== "season-1") fail(6, "lastProcessedSeasonId != season-1");
    const extra = [];
    snapshotChecksAfterPeriod(player, 0, record, extra);
    record.violations.push(...extra);
  }
  record.pass = record.violations.length === 0;
  writeCase(record);
  return record;
}

/**
 * Summer international window: dated injury placed in June/July of the period via the active
 * injury slot (so the engine archives it itself) with kind 'international'. The engine's own
 * international fixtures are reported in `checks.internationalSummer` for context.
 */
function summerInternationalCase({ id, seed, position, rating, nationality, leagueId, clubIndex }) {
  const p = makePlayer({ seed, position, rating, nationality, leagueId, clubIndex });
  const startDay = epochDay(START_YEAR, 6, 20);
  const endDay = epochDay(START_YEAR, 7, 14);
  const rec = {
    eventId: "qa-intl-summer",
    kind: "international",
    severity: "minor",
    startDay,
    date: isoOf(startDay),
    expectedReturnDay: endDay,
    durationDays: endDay - startDay,
    progress: 0,
    temporaryEffects: { overallPenalty: 1, scale: 1, attributePenalties: {} },
    returnReadiness: 0.9,
  };
  p.health.activeInjury = { ...rec };
  p.development = p.development || {};
  p.development.appliedEventIds = { ...(p.development.appliedEventIds || {}), [`injury:${rec.eventId}`]: true };
  const before = captureBefore(p);
  let season = null;
  let thrown = null;
  try {
    season = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, { autoDecisionPolicy: "stay" }).season;
  } catch (e) {
    thrown = String(e?.stack || e);
  }
  const record = buildRecord({
    cohort: "dedicated:summer-international",
    caseId: `D-${id}-summer-international-${position}-seed${seed}`,
    seed,
    player: p,
    season,
    seasonIdx: 0,
    policy: "stay",
    before,
    controlled: [{ ...rec, startDay, expectedReturnDay: endDay }],
    expectedControlledOnlyDays: endDay - startDay,
    flags: { summerInternational: true },
  });
  if (thrown) record.violations.push({ invariant: 1, msg: "simulateSeason failed", detail: thrown });
  const exp = expectedPeriod(START_YEAR);
  const intlRows = (season?.ledgerRecords || []).filter(
    (r) => r.competitionType === "international" || r.isInternational === true
  );
  record.checks.internationalSummer = {
    injuryWindow: { start: isoOf(startDay), returnDate: isoOf(endDay) },
    injuryWithinJuneJulyOfPeriod: startDay >= exp.S && endDay <= epochDay(START_YEAR, 8, 1),
    engineInternationalLedgerRows: intlRows.length,
    engineInternationalMinutes: intlRows.reduce((n, r) => n + (r.minutes || 0), 0),
    note: "Injury is injected (dated) in the June/July international window; engine-generated international injuries are not forced.",
  };
  if (!record.checks.internationalSummer.injuryWithinJuneJulyOfPeriod)
    record.violations.push({ invariant: 1, msg: "summer injury not inside June/July of the period" });
  // Hand-computed expectation: 24 days in-period, unless engine-generated injuries also overlap.
  record.pass = record.violations.length === 0;
  writeCase(record);
  return record;
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

const ordinary = [];
for (const cfg of CAREERS) {
  const r = guard(cfg.id, () => runCareer(cfg));
  if (Array.isArray(r)) ordinary.push(...r);
  else ordinary.push(r);
}

const dedicated = [
  guard("PR1", () =>
    pauseRestoreCase({ id: "PR1", seed: 640, position: "ST", rating: 72, oldInjury: true })
  ),
  guard("PR2", () =>
    pauseRestoreCase({
      id: "PR2",
      seed: 641,
      position: "CM",
      rating: 74,
      oldInjury: false,
      injected: [
        { eventId: "qa-pr-a", offsetStart: 30, offsetEnd: 60 },
        { eventId: "qa-pr-b", offsetStart: 50, offsetEnd: 80 },
      ],
      leagueId: "league:italy-serie-a",
      clubIndex: 4,
      nationality: "Italy",
    })
  ),
  guard("MV1", () =>
    moveCase({
      id: "MV1",
      seed: 660,
      position: "ST",
      rating: 72,
      destClubId: "club:england:brentford",
      injected: [{ eventId: "qa-mv-a", offsetStart: 40, offsetEnd: 70 }],
    })
  ),
  guard("MV2", () =>
    moveCase({
      id: "MV2",
      seed: 661,
      position: "CB",
      rating: 72,
      destClubId: LEAGUE_BY_ID.get("league:italy-serie-a").clubs[6].clubId,
      injected: [{ eventId: "qa-mv-b", offsetStart: 20, offsetEnd: 35 }],
      restoreFirst: true,
    })
  ),
  guard("SI1", () =>
    summerInternationalCase({ id: "SI1", seed: 670, position: "ST", rating: 82, clubIndex: 1 })
  ),
];

const all = [...ordinary, ...dedicated];
const violations = [];
for (const r of all) for (const v of r.violations || []) violations.push({ caseId: r.caseId, ...v });

const byInvariant = {};
for (const v of violations) byInvariant[v.invariant] = (byInvariant[v.invariant] || 0) + 1;

const ordinaryRecords = ordinary.filter((r) => r.cohort === "ordinary");
const positions = [...new Set(ordinaryRecords.map((r) => r.position))].sort();
const leagues = [...new Set(ordinaryRecords.map((r) => r.leagueId))].sort();
const careers = [...new Set(ordinaryRecords.map((r) => r.careerId))];

const coverageProblems = [];
if (ordinaryRecords.length < 24) coverageProblems.push(`only ${ordinaryRecords.length} ordinary season records (need >= 24)`);
if (careers.length < 8) coverageProblems.push(`only ${careers.length} ordinary careers (need >= 8)`);
for (const need of ["ST", "CM", "CB", "GK"]) if (!positions.includes(need)) coverageProblems.push(`missing position ${need}`);
if (leagues.length < 2) coverageProblems.push("fewer than 2 league contexts");
if (!ordinaryRecords.some((r) => r.flags.controlledInjury)) coverageProblems.push("no controlled-injury records");
if (!ordinaryRecords.some((r) => !r.flags.controlledInjury)) coverageProblems.push("no ordinary (uncontrolled) records");
const dedicatedOnly = dedicated.filter((r) => r.cohort !== "error");
for (const need of ["dedicated:pause-restore", "dedicated:move", "dedicated:summer-international"]) {
  if (!dedicatedOnly.some((r) => r.cohort === need)) coverageProblems.push(`missing dedicated cohort ${need}`);
}
for (const msg of coverageProblems) violations.push({ caseId: "coverage", invariant: 0, msg });

const pass = violations.length === 0;
const summary = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  pass,
  ordinaryCohort: {
    careers: careers.length,
    seasonRecords: ordinaryRecords.length,
    positions,
    leagues,
    withControlledInjury: ordinaryRecords.filter((r) => r.flags.controlledInjury).length,
    withNonzeroMissedDays: ordinaryRecords.filter((r) => (r.missedDays.production || 0) > 0).length,
    withFloorApplied: ordinaryRecords.filter((r) => r.fractions.productionRaw < FLOOR).length,
    pass: ordinaryRecords.every((r) => r.pass),
  },
  dedicatedCohort: {
    records: dedicated.length,
    byCohort: dedicated.reduce((m, r) => ((m[r.cohort] = (m[r.cohort] || 0) + 1), m), {}),
    pass: dedicated.every((r) => r.pass),
  },
  invariants: {
    "1 period validity / adjacency / no no-window fallback": byInvariant[1] || 0,
    "2 old/future injuries contribute zero": byInvariant[2] || 0,
    "3 missed days == independent interval union": byInvariant[3] || 0,
    "4 raw/applied fractions + 0.15 floor": byInvariant[4] || 0,
    "5 evidence == development input == persisted breakdown": byInvariant[5] || 0,
    "6 snapshot/resume + exact-once development": byInvariant[6] || 0,
    "7 finite attributes / valid registration": byInvariant[7] || 0,
    "0 harness/coverage": byInvariant[0] || 0,
  },
  violationCount: violations.length,
  violations: violations.slice(0, 200),
  rows: all.map((r) => ({
    caseId: r.caseId,
    cohort: r.cohort,
    position: r.position ?? null,
    leagueId: r.leagueId ?? null,
    periodId: r.periodId ?? null,
    flags: r.flags ?? null,
    oracleMissedDays: r.missedDays?.oracleUnion ?? null,
    productionMissedDays: r.missedDays?.production ?? null,
    rawFraction: r.fractions?.productionRaw ?? null,
    appliedFraction: r.fractions?.productionApplied ?? null,
    method: r.method ?? null,
    partial: r.partial ?? null,
    pass: r.pass,
    violations: (r.violations || []).length,
  })),
};
writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));

console.log("Fix 06 injury/development exposure audit");
console.log(
  `  ordinary: ${summary.ordinaryCohort.seasonRecords} season records / ${summary.ordinaryCohort.careers} careers ` +
    `(positions ${positions.join("/")}, leagues ${leagues.length}) -> ${summary.ordinaryCohort.pass ? "PASS" : "FAIL"}`
);
console.log(
  `  dedicated: ${summary.dedicatedCohort.records} cases ${JSON.stringify(summary.dedicatedCohort.byCohort)} -> ${
    summary.dedicatedCohort.pass ? "PASS" : "FAIL"
  }`
);
console.log(
  `  nonzero-missed ordinary records: ${summary.ordinaryCohort.withNonzeroMissedDays}, floor applied: ${summary.ordinaryCohort.withFloorApplied}`
);
for (const [k, n] of Object.entries(summary.invariants)) console.log(`  invariant ${k}: ${n === 0 ? "ok" : `${n} violation(s)`}`);
for (const row of summary.rows) {
  console.log(
    `  ${row.pass ? "ok  " : "FAIL"} ${row.caseId}  oracle=${row.oracleMissedDays} prod=${row.productionMissedDays} ` +
      `raw=${row.rawFraction == null ? "-" : row.rawFraction.toFixed(4)} applied=${
        row.appliedFraction == null ? "-" : row.appliedFraction.toFixed(4)
      } method=${row.method}`
  );
}
if (!pass) {
  console.error(`\nFAIL: ${violations.length} violation(s). First few:`);
  for (const v of violations.slice(0, 12)) console.error(`  [${v.caseId}] inv${v.invariant}: ${v.msg}`);
  process.exitCode = 1;
} else {
  console.log(`\nPASS: all invariants hold. Wrote ${OUT}/summary.json and ${all.length} case files.`);
}
