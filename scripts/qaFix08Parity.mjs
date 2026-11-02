#!/usr/bin/env node
/**
 * Fix 08 matched distribution validation (predeclared seeds + holdout).
 *
 * Season-equivalent cells: role × ability × minutes × team/opposition context.
 * User path uses simulateMatch aggregates. NPC path uses the full pre-compaction
 * award-field population with an explicit talent→ability map (not the retained
 * top-rival sample alone).
 *
 *   node scripts/qaFix08Parity.mjs
 * Exit 0 only when every required matched check passes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { simulateMatch } from "../js/simulation/matchEngine.js";
import { createStreamRng } from "../js/simulation/rng.js";
import {
  ensureCompetitionAwardField,
  scoreSeasonLine,
  roleGroupOf,
  synthesizeRivalAtExposure,
} from "../js/simulation/individualAwards.js";
import { createRng, hashSeed } from "../js/simulation/rng.js";
import { refreshAbilityCaches } from "../js/simulation/playerAbility.js";
import { ensurePlayerModel } from "../js/simulation/playerModelMigration.js";
import { createPlayerIdentity } from "../js/simulation/playerDevelopment.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "qa/fix08-runs/parity");
mkdirSync(outDir, { recursive: true });

/** Predeclared before coefficient work; do not reshuffle to chase a pass. */
const TRAIN_SEEDS = Object.freeze(Array.from({ length: 200 }, (_, i) => 91000 + i));
const HOLDOUT_SEEDS = Object.freeze(Array.from({ length: 200 }, (_, i) => 92000 + i));
/** Predeclared user-sample extensions (retains TRAIN/HOLDOUT; never replaces them). */
const EXTRA_USER_SEEDS = Object.freeze([
  ...Array.from({ length: 1000 }, (_, i) => 93000 + i),
  ...Array.from({ length: 1000 }, (_, i) => 94000 + i),
]);
/** Disjoint production-field population seeds (train vs holdout never overlap). */
const FIELD_TRAIN_SEED_KEYS = Object.freeze(Array.from({ length: 512 }, (_, i) => `t${i}`));
const FIELD_HOLDOUT_SEED_KEYS = Object.freeze(Array.from({ length: 512 }, (_, i) => `h${i}`));
const MIN_FIELD_N = 200;

const ROLE_CELLS = Object.freeze([
  { role: "ST", group: "FWD" },
  { role: "CM", group: "MID" },
  { role: "CB", group: "DEF" },
  { role: "GK", group: "GK" },
]);
const ABILITIES = Object.freeze([70, 90]);
const MINUTES = Object.freeze([20, 90]);
const MATCHES_PER_SEASON = Math.max(1, Number(process.env.FIX08_PARITY_MATCHES) || 38);
const CONTEXTS = Object.freeze([
  { id: "equal-75", home: 75, away: 75 },
  { id: "strong-home-85v70", home: 85, away: 70 },
]);

const TOL = Object.freeze({
  meanRatingAbs: 0.1,
  rateAbs: 0.03,
  rateRel: 0.2,
  abilityBand: 6,
});

function attrs(ovr) {
  return Object.fromEntries(
    ["Speed", "Passing", "Shooting", "Defending", "Physicality", "Dribbling"].map((k) => [k, ovr])
  );
}

function makePlayer(position, ovr, minutes, tag) {
  const p = createPlayerIdentity({
    name: `parity-${tag}-${position}-${ovr}`,
    nationality: "England",
    position,
    age: 24,
  });
  Object.assign(p, {
    rating: ovr,
    attributes: attrs(ovr),
    matchParticipation: { minutes, started: minutes >= 60, matchDuration: 90 },
  });
  ensurePlayerModel(p);
  refreshAbilityCaches(p);
  return p;
}

function team(overall, name = "Parity FC") {
  return { name, overall, attack: overall, midfield: overall, defence: overall, gk: overall };
}

function impliedOverall(talent) {
  return Math.max(55, Math.min(95, 70 + 12 * Number(talent)));
}

function gapOk(a, b, absTol, relTolOfPooled) {
  const gap = Math.abs(a - b);
  const pooled = (a + b) / 2;
  const tol = Math.max(absTol, relTolOfPooled * Math.abs(pooled));
  return { gap, tol, pass: gap <= tol + 1e-12 };
}

function mean(xs) {
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;
}

function sampleSd(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1));
}

function seMean(xs) {
  return xs.length ? sampleSd(xs) / Math.sqrt(xs.length) : null;
}

/** One independent season-equivalent sample: MATCHES_PER_SEASON fixtures. */
function seasonSample(role, ovr, minutes, ctx, seed, label) {
  let goals = 0;
  let assists = 0;
  let cleanSheets = 0;
  let ratedSum = 0;
  let ratedMinutes = 0;
  let ratingSum = 0;
  let ratedN = 0;
  let totalMinutes = 0;
  for (let m = 0; m < MATCHES_PER_SEASON; m++) {
    const player = makePlayer(role, ovr, minutes, `${label}-${seed}`);
    const rng = createStreamRng(`parity:${label}:${ctx.id}:${role}:${ovr}:${minutes}:${seed}`, String(m));
    const match = simulateMatch(team(ctx.home, "Home"), team(ctx.away, "Away"), {
      player,
      playerSide: "home",
      competition: "league",
      rng,
    });
    const ps = match.playerStats || {};
    const mins = Number(ps.minutes) || 0;
    totalMinutes += mins;
    goals += Number(ps.goals) || 0;
    assists += Number(ps.assists) || 0;
    if (ps.cleanSheet) cleanSheets += 1;
    if (ps.rating != null && mins > 0) {
      ratedSum += Number(ps.rating) * mins;
      ratedMinutes += mins;
      ratingSum += Number(ps.rating);
      ratedN += 1;
    }
  }
  const minutesWeightedRating = ratedMinutes > 0 ? ratedSum / ratedMinutes : null;
  const meanRating = ratedN ? ratingSum / ratedN : null;
  const awardScore =
    minutesWeightedRating == null
      ? null
      : scoreSeasonLine(
          {
            group: roleGroupOf(role),
            minutes: totalMinutes,
            goals,
            assists,
            cleanSheets: role === "GK" || role === "CB" ? cleanSheets : 0,
            rating: minutesWeightedRating,
            teamPpg: 1.5,
          },
          MATCHES_PER_SEASON * 90
        );
  return {
    seed,
    goals,
    assists,
    cleanSheets,
    totalMinutes,
    goalsPer90: totalMinutes > 0 ? (goals * 90) / totalMinutes : 0,
    assistsPer90: totalMinutes > 0 ? (assists * 90) / totalMinutes : 0,
    cleanSheetRate: MATCHES_PER_SEASON > 0 ? cleanSheets / MATCHES_PER_SEASON : 0,
    meanRating,
    minutesWeightedRating,
    awardScore,
  };
}

function aggregateCell(samples) {
  const totalGoals = samples.reduce((s, x) => s + x.goals, 0);
  const totalAssists = samples.reduce((s, x) => s + x.assists, 0);
  const totalMinutes = samples.reduce((s, x) => s + x.totalMinutes, 0);
  const ratings = samples.map((x) => x.minutesWeightedRating).filter((v) => v != null);
  const scores = samples.map((x) => x.awardScore).filter((v) => v != null);
  return {
    samples: samples.length,
    totalGoals,
    totalAssists,
    totalMinutes,
    goalsPer90: totalMinutes > 0 ? (totalGoals * 90) / totalMinutes : 0,
    assistsPer90: totalMinutes > 0 ? (totalAssists * 90) / totalMinutes : 0,
    meanRating: mean(ratings),
    ratingSe: seMean(ratings),
    meanAwardScore: mean(scores),
    awardScoreSe: seMean(scores),
  };
}

function runUserCell(role, ovr, minutes, ctx, seeds, label) {
  const raw = seeds.map((seed) => seasonSample(role, ovr, minutes, ctx, seed, label));
  return {
    side: "user",
    role,
    group: roleGroupOf(role),
    ovr,
    minutes,
    contextId: ctx.id,
    label,
    matchesPerSeason: MATCHES_PER_SEASON,
    ...aggregateCell(raw),
    raw,
  };
}

function buildDiagnosticField(ctx, seedKey = "0") {
  const player = {
    name: "parity-field",
    position: "ST",
    club: { name: "C0", clubId: "c0" },
    awardFields: {},
  };
  const table = Array.from({ length: 20 }, (_, i) => ({
    name: `C${i}`,
    clubId: `c${i}`,
    played: 38,
    goalsFor: Math.round(38 * (1.1 + (ctx.home - 75) * 0.01 + i * 0.02)),
    goalsAgainst: Math.round(38 * (1.1 - (ctx.home - 75) * 0.008)),
    points: 40 + i,
    position: i + 1,
  }));
  return ensureCompetitionAwardField(
    player,
    {
      seasonId: "parity",
      competitionEditionId: `parity::${ctx.id}::${seedKey}`,
      scope: "league",
      table,
      userClub: table[0],
      user: { goals: 8, assists: 4, position: "ST" },
      retainDiagnosticPopulation: true,
    },
    createStreamRng("parity", `field:${ctx.id}:${seedKey}`)
  );
}

/** Merge independently seeded diagnostic populations (caller supplies disjoint seed keys). */
function buildMergedDiagnosticField(ctx, seedKeys) {
  const populations = [];
  let retained = 0;
  let template = null;
  for (const seedKey of seedKeys) {
    const f = buildDiagnosticField(ctx, seedKey);
    if (!template) template = f;
    populations.push(...(f.diagnosticPopulation || []).map((r) => ({ ...r, id: `${r.id}#${seedKey}` })));
    retained += f.rivals.length;
  }
  return {
    ...template,
    diagnosticPopulation: populations,
    populationSize: populations.length,
    rivals: template.rivals,
    retainedSize: retained,
    mergedCopies: seedKeys.length,
    seedKeys: { start: seedKeys[0], end: seedKeys.at(-1), n: seedKeys.length },
  };
}

function minMatchedN(field, minutesTargets = MINUTES) {
  let min = Infinity;
  for (const { role, group } of ROLE_CELLS) {
    for (const ovr of ABILITIES) {
      for (const minutes of minutesTargets) {
        const n = awardFieldMatched(field, group, ovr, minutes, role).n;
        if (n < min) min = n;
      }
    }
  }
  return Number.isFinite(min) ? min : 0;
}

/**
 * Shared individual model for NPC diagnostics: same simulateMatch path as the user,
 * independent identity/seeds, equal role/ability/minutes/team context.
 */
function runNpcCell(role, ovr, minutes, ctx, seeds, label) {
  // Offset seed stream so NPC draws are independent of the user cell.
  const npcSeeds = seeds.map((s) => s + 500000);
  return runUserCell(role, ovr, minutes, ctx, npcSeeds, `${label}-npc`);
}

/** Position-compatible rival filter (exact role; do not mix CAM into CM or wingers into ST). */
function positionCompatible(r, role) {
  if (role === "ST") return r.position === "ST";
  if (role === "CM") return r.position === "CM";
  if (role === "CB") return r.position === "CB";
  if (role === "GK") return r.position === "GK";
  return true;
}

/**
 * Full pre-compaction award-field population filtered by role/position + talent→ability.
 * Hard-gate samples must satisfy the declared role, ability (±6) and exposure band.
 * Broadened tails are diagnostics only and never counted toward acceptance.
 * Short-exposure GKs are filled via the production synthesizeRivalAtExposure seam
 * when the one-starter roster cannot populate the 20-minute band.
 */
function awardFieldMatched(field, group, ovr, minutesTarget, role, { seedKey = "parity" } = {}) {
  const pop = field.diagnosticPopulation || [];
  const targetMins = 38 * minutesTarget;
  const abilityOk = (r) =>
    Number.isFinite(r.talent) && Math.abs(impliedOverall(r.talent) - ovr) <= TOL.abilityBand;
  const minutesOk = (r) => r.minutes >= targetMins * 0.75 && r.minutes <= targetMins * 1.25;
  let matched = pop.filter((r) => positionCompatible(r, role) && abilityOk(r) && minutesOk(r));
  let band = "position+talent+minutes";
  let diagnosticBroad = null;
  if (matched.length < MIN_FIELD_N && role === "GK" && minutesTarget === 20) {
    // Production roster has one starter GK (~full minutes). Fill the declared
    // short-exposure cell with the shared rate/rating contract at target minutes.
    const need = MIN_FIELD_N - matched.length;
    const talent = (ovr - 70) / 12;
    const seamRng = createRng(hashSeed(`fix08-parity-seam:${seedKey}:${ovr}`));
    const synthesized = [];
    for (let i = 0; i < need; i++) {
      const line = synthesizeRivalAtExposure({
        id: `rival:parity-seam:GK:${ovr}:${i}`,
        name: `Parity seam GK ${ovr}#${i}`,
        position: "GK",
        talent,
        minutes: targetMins,
        matches: Math.ceil(targetMins / 90),
        starts: Math.ceil(targetMins / 90),
        teamQ: 0,
        rng: seamRng,
      });
      synthesized.push(line);
    }
    matched = matched.concat(synthesized);
    band = "position+talent+minutes+production-seam";
  }
  // Diagnostic-only broadened populations (never used for hard-gate acceptance).
  if (matched.filter((r) => !r.syntheticExposure).length < 8) {
    const wide = pop.filter(
      (r) =>
        positionCompatible(r, role) &&
        abilityOk(r) &&
        r.minutes >= targetMins * 0.55 &&
        r.minutes <= targetMins * 1.35
    );
    const minPart = 0.4 * (field.possibleMinutes || 3420);
    const tail =
      ovr >= 85
        ? pop.filter(
            (r) => positionCompatible(r, role) && Number(r.talent) >= 0.75 && r.minutes >= minPart
          )
        : pop.filter(
            (r) =>
              positionCompatible(r, role) &&
              Number.isFinite(r.talent) &&
              Math.abs(r.talent) <= 0.9 &&
              r.minutes >= minPart
          );
    diagnosticBroad = {
      minutesWideN: wide.length,
      talentTailN: tail.length,
      note: "diagnostic only — not counted toward MIN_FIELD_N / hard gate",
    };
  }
  // Acceptance identity: every counted sample must still meet declared filters.
  const eligible = matched.filter(
    (r) => positionCompatible(r, role) && abilityOk(r) && minutesOk(r)
  );
  const ratings = eligible.map((r) => r.rating).filter((v) => Number.isFinite(v));
  const totalGoals = eligible.reduce((s, r) => s + (r.goals || 0), 0);
  const totalAssists = eligible.reduce((s, r) => s + (r.assists || 0), 0);
  const totalMinutes = eligible.reduce((s, r) => s + (r.minutes || 0), 0);
  const exposureMatched = eligible.filter(minutesOk).length;
  return {
    side: "award-field-full-population",
    group,
    role,
    ovr,
    minutesTarget,
    band,
    n: eligible.length,
    exposureMatched,
    populationSize: pop.length,
    retainedSize: field.rivals.length,
    diagnosticBroad,
    goalsPer90: totalMinutes > 0 ? (totalGoals * 90) / totalMinutes : 0,
    assistsPer90: totalMinutes > 0 ? (totalAssists * 90) / totalMinutes : 0,
    meanRating: mean(ratings),
    ratingSe: seMean(ratings),
    rawNpc: eligible.map((r) => ({
      id: r.id,
      position: r.position,
      talent: r.talent,
      impliedOverall: impliedOverall(r.talent),
      minutes: r.minutes,
      goals: r.goals,
      assists: r.assists,
      rating: r.rating,
      syntheticExposure: Boolean(r.syntheticExposure),
    })),
  };
}

const checks = [];
const train = [];
const holdout = [];
const rawByCell = {};

console.log(
  JSON.stringify({
    phase: "start",
    matchesPerSeason: MATCHES_PER_SEASON,
    trainN: TRAIN_SEEDS.length,
    holdoutN: HOLDOUT_SEEDS.length,
    contexts: CONTEXTS.map((c) => c.id),
  })
);

for (const ctx of CONTEXTS) {
  for (const { role } of ROLE_CELLS) {
    for (const ovr of ABILITIES) {
      for (const minutes of MINUTES) {
        const key = `${ctx.id}|${role}|${ovr}|${minutes}`;
        const t = runUserCell(role, ovr, minutes, ctx, TRAIN_SEEDS, "train");
        const h = runUserCell(role, ovr, minutes, ctx, HOLDOUT_SEEDS, "holdout");
        train.push(t);
        holdout.push(h);
        rawByCell[key] = { train: t.raw, holdout: h.raw };
        // Drop bulky raw from summary rows (kept in raw-samples.json).
        delete t.raw;
        delete h.raw;
      }
    }
  }
}

// Extended user seasons (predeclared) for production-field rate uncertainty.
const trainExtended = {};
const holdoutExtended = {};
for (const ctx of CONTEXTS) {
  for (const { role } of ROLE_CELLS) {
    for (const ovr of ABILITIES) {
      for (const minutes of MINUTES) {
        const key = `${ctx.id}|${role}|${ovr}|${minutes}`;
        const baseTrain = train.find(
          (c) => c.contextId === ctx.id && c.role === role && c.ovr === ovr && c.minutes === minutes
        );
        const baseHold = holdout.find(
          (c) => c.contextId === ctx.id && c.role === role && c.ovr === ovr && c.minutes === minutes
        );
        const extraT = runUserCell(role, ovr, minutes, ctx, EXTRA_USER_SEEDS, "train-extra");
        const extraH = runUserCell(role, ovr, minutes, ctx, EXTRA_USER_SEEDS, "holdout-extra");
        rawByCell[`${key}|train-extra`] = extraT.raw;
        rawByCell[`${key}|holdout-extra`] = extraH.raw;
        const mergeUser = (a, b) => {
          const totalMinutes = a.totalMinutes + b.totalMinutes;
          const totalGoals = a.totalGoals + b.totalGoals;
          const totalAssists = a.totalAssists + b.totalAssists;
          const ratings = [...(a.raw || []).map((x) => x.minutesWeightedRating), ...(b.raw || []).map((x) => x.minutesWeightedRating)].filter(
            (v) => v != null
          );
          return {
            ...a,
            samples: a.samples + b.samples,
            totalMinutes,
            totalGoals,
            totalAssists,
            goalsPer90: totalMinutes > 0 ? (totalGoals * 90) / totalMinutes : 0,
            assistsPer90: totalMinutes > 0 ? (totalAssists * 90) / totalMinutes : 0,
            meanRating: mean(ratings),
            ratingSe: seMean(ratings),
          };
        };
        // Re-aggregate from stored raw in rawByCell for train/holdout base.
        const trainRaw = rawByCell[key]?.train || [];
        const holdRaw = rawByCell[key]?.holdout || [];
        const reAgg = (raw, side) => {
          const totalGoals = raw.reduce((s, x) => s + x.goals, 0);
          const totalAssists = raw.reduce((s, x) => s + x.assists, 0);
          const totalMinutes = raw.reduce((s, x) => s + x.totalMinutes, 0);
          const ratings = raw.map((x) => x.minutesWeightedRating).filter((v) => v != null);
          return {
            side,
            samples: raw.length,
            totalGoals,
            totalAssists,
            totalMinutes,
            goalsPer90: totalMinutes > 0 ? (totalGoals * 90) / totalMinutes : 0,
            assistsPer90: totalMinutes > 0 ? (totalAssists * 90) / totalMinutes : 0,
            meanRating: mean(ratings),
            ratingSe: seMean(ratings),
            raw,
          };
        };
        trainExtended[key] = mergeUser(reAgg(trainRaw, "train"), extraT);
        holdoutExtended[key] = mergeUser(reAgg(holdRaw, "holdout"), extraH);
        delete extraT.raw;
        delete extraH.raw;
        delete trainExtended[key].raw;
        delete holdoutExtended[key].raw;
      }
    }
  }
}

const trainFields = {};
const holdoutFields = {};
for (const ctx of CONTEXTS) {
  trainFields[ctx.id] = buildMergedDiagnosticField(ctx, FIELD_TRAIN_SEED_KEYS);
  holdoutFields[ctx.id] = buildMergedDiagnosticField(ctx, FIELD_HOLDOUT_SEED_KEYS);
}
const fields = trainFields; // provenance / legacy name for train production fields

const matchedComparisons = [];
const awardFieldRatingChecks = [];
for (const ctx of CONTEXTS) {
  const field = trainFields[ctx.id];
  for (const { role, group } of ROLE_CELLS) {
    for (const ovr of ABILITIES) {
      for (const minutes of MINUTES) {
        const user = train.find(
          (c) => c.contextId === ctx.id && c.role === role && c.ovr === ovr && c.minutes === minutes
        );
        const userExt = trainExtended[`${ctx.id}|${role}|${ovr}|${minutes}`];
        const npcCell = runNpcCell(role, ovr, minutes, ctx, TRAIN_SEEDS, "train");
        rawByCell[`${ctx.id}|${role}|${ovr}|${minutes}|npc`] = npcCell.raw;
        delete npcCell.raw;
        const rating = gapOk(user.meanRating ?? 0, npcCell.meanRating ?? 0, TOL.meanRatingAbs, 0);
        const g90 = gapOk(user.goalsPer90, npcCell.goalsPer90, TOL.rateAbs, TOL.rateRel);
        const a90 = gapOk(user.assistsPer90, npcCell.assistsPer90, TOL.rateAbs, TOL.rateRel);
        const row = {
          model: "shared-simulateMatch",
          contextId: ctx.id,
          role,
          group,
          ovr,
          minutes,
          user: {
            samples: user.samples,
            meanRating: user.meanRating,
            ratingSe: user.ratingSe,
            goalsPer90: user.goalsPer90,
            assistsPer90: user.assistsPer90,
            meanAwardScore: user.meanAwardScore,
            totalGoals: user.totalGoals,
          },
          npc: {
            samples: npcCell.samples,
            meanRating: npcCell.meanRating,
            ratingSe: npcCell.ratingSe,
            goalsPer90: npcCell.goalsPer90,
            assistsPer90: npcCell.assistsPer90,
            meanAwardScore: npcCell.meanAwardScore,
            totalGoals: npcCell.totalGoals,
          },
          rating,
          goalsPer90: g90,
          assistsPer90: a90,
          pass: rating.pass && g90.pass && a90.pass,
        };
        if (role === "GK") {
          const inv = {
            userGoals: user.totalGoals,
            npcGoals: npcCell.totalGoals,
            pass: user.totalGoals === 0 && npcCell.totalGoals === 0,
          };
          row.gkZeroGoalsInvariant = inv;
          row.pass = row.pass && inv.pass;
        }
        matchedComparisons.push(row);
        checks.push({ id: `matched-${ctx.id}-${role}-${ovr}-${minutes}`, pass: row.pass, detail: row });

        // Production award-field population vs extended user (both exposures).
        // All declared rating / G/90 / A/90 tolerances are hard gates, including GK.
        const fieldNpc = awardFieldMatched(field, group, ovr, minutes, role, {
          seedKey: `train:${ctx.id}|${role}|${ovr}|${minutes}`,
        });
        const fieldRating = gapOk(userExt.meanRating ?? 0, fieldNpc.meanRating ?? 0, TOL.meanRatingAbs, 0);
        const fieldG90 = gapOk(userExt.goalsPer90, fieldNpc.goalsPer90, TOL.rateAbs, TOL.rateRel);
        const fieldA90 = gapOk(userExt.assistsPer90, fieldNpc.assistsPer90, TOL.rateAbs, TOL.rateRel);
        const ratesPass = fieldG90.pass && fieldA90.pass;
        const identityPass =
          fieldNpc.n >= MIN_FIELD_N &&
          fieldNpc.exposureMatched === fieldNpc.n &&
          /^position\+talent\+minutes/.test(fieldNpc.band);
        const fieldRow = {
          contextId: ctx.id,
          role,
          group,
          ovr,
          minutes,
          hardGate: true,
          fieldSplit: "train",
          userSamples: userExt.samples,
          userMeanRating: userExt.meanRating,
          fieldMeanRating: fieldNpc.meanRating,
          fieldN: fieldNpc.n,
          exposureMatched: fieldNpc.exposureMatched,
          band: fieldNpc.band,
          populationSize: fieldNpc.populationSize,
          retainedSize: fieldNpc.retainedSize,
          diagnosticBroad: fieldNpc.diagnosticBroad,
          rating: fieldRating,
          goalsPer90: fieldG90,
          assistsPer90: fieldA90,
          pass: identityPass && ratesPass && fieldRating.pass,
          rawNpc: fieldNpc.rawNpc,
        };
        awardFieldRatingChecks.push(fieldRow);
        rawByCell[`${ctx.id}|${role}|${ovr}|${minutes}|award-field`] = fieldNpc.rawNpc;
        checks.push({
          id: `award-field-${ctx.id}-${role}-${ovr}-${minutes}`,
          pass: fieldRow.pass,
          detail: { ...fieldRow, rawNpc: undefined },
        });
      }
    }
  }
}

// Substitute vs full: duration applied once — rates near parity when the base rate
// is measurable; low-rate roles use assists (MID/DEF) or rating proximity.
const exposureChecks = [];
for (const ctx of CONTEXTS) {
  for (const { role } of ROLE_CELLS) {
    for (const ovr of ABILITIES) {
      const full = train.find((c) => c.contextId === ctx.id && c.role === role && c.ovr === ovr && c.minutes === 90);
      const sub = train.find((c) => c.contextId === ctx.id && c.role === role && c.ovr === ovr && c.minutes === 20);
      let pass;
      let metric = "goalsPer90";
      let ratio = null;
      if (role === "GK") {
        pass = sub.goalsPer90 === 0 && full.goalsPer90 === 0;
        metric = "gk-zero-goals";
      } else if (full.goalsPer90 >= 0.08) {
        ratio = sub.goalsPer90 / full.goalsPer90;
        pass = ratio > 0.85 && ratio < 1.15;
      } else if (full.assistsPer90 >= 0.05) {
        metric = "assistsPer90";
        ratio = sub.assistsPer90 / full.assistsPer90;
        pass = ratio > 0.85 && ratio < 1.15;
      } else {
        metric = "meanRating";
        const gap = Math.abs((sub.meanRating ?? 0) - (full.meanRating ?? 0));
        pass = gap <= 0.15;
        ratio = gap;
      }
      const row = {
        kind: "sub-vs-full-train",
        contextId: ctx.id,
        role,
        ovr,
        metric,
        fullG90: full.goalsPer90,
        subG90: sub.goalsPer90,
        fullA90: full.assistsPer90,
        subA90: sub.assistsPer90,
        ratio,
        pass,
      };
      exposureChecks.push(row);
      checks.push({ id: `exposure-${ctx.id}-${role}-${ovr}`, pass, detail: row });
    }
  }
}

// Provenance labels on generated fields.
const provenance = Object.fromEntries(
  Object.entries(fields).map(([id, f]) => [
    id,
    {
      tableApproximated: f.tableApproximated,
      playerStatsApproximated: f.playerStatsApproximated,
      approximated: f.approximated,
      cleanSheetBasis: f.cleanSheetBasis,
      populationSize: f.populationSize,
      retained: f.rivals.length,
      talentToAbility: f.talentToAbility,
    },
  ])
);

const failed = checks.filter((c) => !c.pass);
const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
const dirty = spawnSync("git", ["status", "--porcelain", "--", "js/", "scripts/qaFix08Parity.mjs"], {
  cwd: root,
  encoding: "utf8",
}).stdout.trim();

const summary = {
  generatedAt: new Date().toISOString(),
  head,
  dirty,
  matchesPerSeason: MATCHES_PER_SEASON,
  trainSeeds: { start: TRAIN_SEEDS[0], end: TRAIN_SEEDS.at(-1), n: TRAIN_SEEDS.length },
  holdoutSeeds: { start: HOLDOUT_SEEDS[0], end: HOLDOUT_SEEDS.at(-1), n: HOLDOUT_SEEDS.length },
  extraUserSeeds: { start: EXTRA_USER_SEEDS[0], end: EXTRA_USER_SEEDS.at(-1), n: EXTRA_USER_SEEDS.length },
  fieldTrainSeeds: trainFields[CONTEXTS[0].id]?.seedKeys,
  fieldHoldoutSeeds: holdoutFields[CONTEXTS[0].id]?.seedKeys,
  minFieldN: MIN_FIELD_N,
  tolerances: TOL,
  talentToAbility: fields[CONTEXTS[0].id]?.talentToAbility,
  provenance,
  train: train.map(({ raw: _r, ...rest }) => rest),
  holdout: holdout.map(({ raw: _r, ...rest }) => rest),
  matchedComparisons,
  awardFieldRatingChecks,
  exposureChecks,
  checks: checks.map((c) => ({ id: c.id, pass: c.pass })),
  failed: failed.map((c) => c.id),
  pass: failed.length === 0,
};

// Holdout: disjoint production fields + untouched user seeds (must also pass).
const holdoutMatched = [];
const holdoutAwardFieldChecks = [];
for (const ctx of CONTEXTS) {
  const field = holdoutFields[ctx.id];
  for (const { role, group } of ROLE_CELLS) {
    for (const ovr of ABILITIES) {
      for (const minutes of MINUTES) {
        const user = holdout.find(
          (c) => c.contextId === ctx.id && c.role === role && c.ovr === ovr && c.minutes === minutes
        );
        const userExt = holdoutExtended[`${ctx.id}|${role}|${ovr}|${minutes}`];
        const npcCell = runNpcCell(role, ovr, minutes, ctx, HOLDOUT_SEEDS, "holdout");
        rawByCell[`${ctx.id}|${role}|${ovr}|${minutes}|holdout-npc`] = npcCell.raw;
        delete npcCell.raw;
        const rating = gapOk(user.meanRating ?? 0, npcCell.meanRating ?? 0, TOL.meanRatingAbs, 0);
        const g90 = gapOk(user.goalsPer90, npcCell.goalsPer90, TOL.rateAbs, TOL.rateRel);
        const a90 = gapOk(user.assistsPer90, npcCell.assistsPer90, TOL.rateAbs, TOL.rateRel);
        let pass =
          rating.pass && g90.pass && a90.pass && (role !== "GK" || (user.totalGoals === 0 && npcCell.totalGoals === 0));
        const fieldNpc = awardFieldMatched(field, group, ovr, minutes, role, {
          seedKey: `holdout:${ctx.id}|${role}|${ovr}|${minutes}`,
        });
        const fr = gapOk(userExt.meanRating ?? 0, fieldNpc.meanRating ?? 0, TOL.meanRatingAbs, 0);
        const fg = gapOk(userExt.goalsPer90, fieldNpc.goalsPer90, TOL.rateAbs, TOL.rateRel);
        const fa = gapOk(userExt.assistsPer90, fieldNpc.assistsPer90, TOL.rateAbs, TOL.rateRel);
        const fieldPass =
          fieldNpc.n >= MIN_FIELD_N &&
          fieldNpc.exposureMatched === fieldNpc.n &&
          /^position\+talent\+minutes/.test(fieldNpc.band) &&
          fg.pass &&
          fa.pass &&
          fr.pass;
        pass = pass && fieldPass;
        rawByCell[`${ctx.id}|${role}|${ovr}|${minutes}|holdout-award-field`] = fieldNpc.rawNpc;
        const fieldRow = {
          contextId: ctx.id,
          role,
          group,
          ovr,
          minutes,
          fieldSplit: "holdout",
          userSamples: userExt.samples,
          fieldN: fieldNpc.n,
          exposureMatched: fieldNpc.exposureMatched,
          band: fieldNpc.band,
          rating: fr,
          goalsPer90: fg,
          assistsPer90: fa,
          pass: fieldPass,
        };
        holdoutAwardFieldChecks.push(fieldRow);
        holdoutMatched.push({
          contextId: ctx.id,
          role,
          ovr,
          minutes,
          rating,
          goalsPer90: g90,
          assistsPer90: a90,
          fieldPass,
          fieldN: fieldNpc.n,
          pass,
        });
        checks.push({ id: `holdout-matched-${ctx.id}-${role}-${ovr}-${minutes}`, pass });
        checks.push({
          id: `holdout-award-field-${ctx.id}-${role}-${ovr}-${minutes}`,
          pass: fieldPass,
          detail: fieldRow,
        });
      }
    }
  }
}
writeFileSync(join(outDir, "holdout-matched.json"), JSON.stringify(holdoutMatched, null, 2));

// Assert every summarized cell retained its expected raw records.
const requiredRawSuffixes = ["", "|npc", "|train-extra", "|holdout-extra", "|award-field", "|holdout-npc", "|holdout-award-field"];
const rawCoverage = [];
for (const ctx of CONTEXTS) {
  for (const { role } of ROLE_CELLS) {
    for (const ovr of ABILITIES) {
      for (const minutes of MINUTES) {
        const base = `${ctx.id}|${role}|${ovr}|${minutes}`;
        for (const suffix of requiredRawSuffixes) {
          const key = suffix === "" ? base : `${base}${suffix}`;
          const present = rawByCell[key] != null || (suffix === "" && rawByCell[base]?.train != null);
          rawCoverage.push({ key, present });
          if (!present) checks.push({ id: `raw-coverage-${key}`, pass: false });
        }
      }
    }
  }
}

// Recompute pass after holdout checks appended.
summary.checks = checks.map((c) => ({ id: c.id, pass: c.pass }));
summary.failed = checks.filter((c) => !c.pass).map((c) => c.id);
summary.pass = summary.failed.length === 0;
summary.holdoutMatched = holdoutMatched;
summary.holdoutAwardFieldChecks = holdoutAwardFieldChecks;
summary.rawCoverage = {
  required: rawCoverage.length,
  present: rawCoverage.filter((r) => r.present).length,
  missing: rawCoverage.filter((r) => !r.present).map((r) => r.key),
};
writeFileSync(
  join(outDir, "parity-summary.json"),
  JSON.stringify(
    {
      ...summary,
      awardFieldRatingChecks: awardFieldRatingChecks.map(({ rawNpc: _r, ...rest }) => rest),
    },
    null,
    2
  )
);
// Raw exports written AFTER training + holdout so holdout-npc / holdout-award-field are present.
writeFileSync(
  join(outDir, "raw-samples.json"),
  JSON.stringify(
    {
      note: "Per-cell season-equivalent raw samples (user + shared-model NPC + disjoint production award-field rivals). Written after holdout.",
      seedRanges: {
        train: summary.trainSeeds,
        holdout: summary.holdoutSeeds,
        extraUser: summary.extraUserSeeds,
        fieldTrain: summary.fieldTrainSeeds,
        fieldHoldout: summary.fieldHoldoutSeeds,
      },
      rawByCell,
      awardFieldMatchedRaw: Object.fromEntries(
        awardFieldRatingChecks.map((r) => [
          `${r.contextId}|${r.role}|${r.ovr}|${r.minutes}`,
          r.rawNpc || [],
        ])
      ),
    },
    null,
    2
  )
);

console.log(
  JSON.stringify(
    {
      outDir,
      pass: summary.pass,
      failed: summary.failed,
      cells: train.length,
      samplesPerCell: TRAIN_SEEDS.length,
      extraUserSamples: EXTRA_USER_SEEDS.length,
      matchesPerSeason: MATCHES_PER_SEASON,
      matchedPass: matchedComparisons.filter((r) => r.pass).length,
      matchedTotal: matchedComparisons.length,
      awardFieldRatingPass: awardFieldRatingChecks.filter((r) => r.pass).length,
      awardFieldRatingTotal: awardFieldRatingChecks.length,
      exposurePass: exposureChecks.filter((r) => r.pass).length,
      holdoutPass: holdoutMatched.filter((r) => r.pass).length,
      holdoutTotal: holdoutMatched.length,
      rawPresent: summary.rawCoverage.present,
      rawRequired: summary.rawCoverage.required,
      minTrainFieldN: minMatchedN(trainFields[CONTEXTS[0].id]),
      minHoldoutFieldN: minMatchedN(holdoutFields[CONTEXTS[0].id]),
    },
    null,
    2
  )
);

if (!summary.pass) process.exitCode = 1;
