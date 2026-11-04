#!/usr/bin/env node
/**
 * Fix 10 career cohort runner: 24 careers × 3 periods with full inputs.
 *
 * Preserves documented Yokohama schedule exclusion (seed 9109) and supports a
 * declared supplemental fixture to reach 24 completed careers.
 *
 *   node scripts/qaFix10CareerCohort.mjs
 *   node scripts/qaFix10CareerCohort.mjs --supplemental-only
 *   FIX10_COHORT_N=3 node scripts/qaFix10CareerCohort.mjs   # smoke
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPlayerIdentity } from "../js/simulation/playerDevelopment.js";
import { ensurePlayerModel } from "../js/simulation/playerModelMigration.js";
import { refreshAbilityCaches } from "../js/simulation/playerAbility.js";
import { ensureContractAuthority } from "../js/simulation/contractLifecycle.js";
import { ensureTransferSave } from "../js/simulation/transferMigration.js";
import {
  createWorldState,
  setWorldState,
  serializeWorldState,
  deserializeWorldState,
  CLUB_STRENGTH_MODEL_VERSION,
} from "../js/simulation/worldState.js";
import { reseedCareerRng } from "../js/simulation/rng.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import { allSeniorClubs } from "../js/simulation/seniorClubs.js";
import { LEAGUES, LEAGUE_LOOKUP } from "../js/data/leagues.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import { resolveSquadDecision } from "../js/simulation/squadDecisions.js";
import { applySeniorScenarioPolicy } from "../js/simulation/seniorCareerScenarios.js";
import { startLoan } from "../js/simulation/loanMarket.js";
import { ensurePlayingStints } from "../js/simulation/playingRegistration.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "qa/fix10-runs/career-cohort");
mkdirSync(OUT, { recursive: true });

const ATTR_KEYS = [
  "Speed",
  "Passing",
  "Shooting",
  "Defending",
  "Physicality",
  "Dribbling",
  "Reflexes",
  "Handling",
  "Positioning",
  "Diving",
  "Kicking",
];

/** Primary 24-slot plan. Index 9 (Yokohama CM @ 9109) is the known schedule failure. */
export const COHORT_PLAN = [
  { club: "Hull City", role: "ST" },
  { club: "Brentford", role: "CM" },
  { club: "Burnley", role: "CB" },
  { club: "Everton", role: "GK" },
  { club: "Atalanta", role: "ST" },
  { club: "Lecce", role: "CM" },
  { club: "Red Star Belgrade", role: "CB" },
  { club: "Partizan", role: "GK" },
  { club: "Al Hilal", role: "ST" },
  { club: "Yokohama F. Marinos", role: "CM" }, // documented exclusion
  { club: "São Paulo", role: "CB" },
  { club: "Club Brugge", role: "GK" },
  { club: "Fulham", role: "ST" },
  { club: "Getafe", role: "CM" },
  { club: "Mallorca", role: "CB" },
  { club: "Bologna", role: "GK" },
  { club: "Torino", role: "ST" },
  { club: "Crystal Palace", role: "CM" },
  { club: "Wolverhampton Wanderers", role: "CB" },
  { club: "Tottenham Hotspur", role: "GK" },
  { club: "West Ham United", role: "ST" },
  { club: "Nottingham Forest", role: "CM" },
  { club: "Bolton Wanderers", role: "CB" },
  { club: "Sheffield United", role: "GK" },
];

/** Declared supplemental replacing the Yokohama exclusion slot. */
export const SUPPLEMENTAL_PLAN = [
  {
    seed: 9124,
    club: "Brighton & Hove Albion",
    role: "CM",
    replacesExclusionSeed: 9109,
    reason: "Declared supplemental after Yokohama AFC league-phase schedule failure",
  },
];

const PERIODS = 3;
const BASE_SEED = 9100;

function parseArgs(argv) {
  const out = { supplementalOnly: false, n: Number(process.env.FIX10_COHORT_N) || COHORT_PLAN.length };
  for (const a of argv) {
    if (a === "--supplemental-only") out.supplementalOnly = true;
  }
  return out;
}

function attrs(ovr) {
  return Object.fromEntries(ATTR_KEYS.map((k) => [k, ovr]));
}

function clubByName(name) {
  return allSeniorClubs().find((c) => c.name === name) || null;
}

function drainSeason(player) {
  let data = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: true,
    autoDecisionPolicy: null,
  });
  let guard = 0;
  while ((data.awaitingScenario || data.awaitingDecision) && guard++ < 80) {
    if (data.awaitingScenario) {
      const pending = player.pendingSeniorScenario || data.pendingSeniorScenario;
      applySeniorScenarioPolicy(player, pending, "balanced");
      player.pendingSeniorScenario = null;
    }
    if (data.awaitingDecision) {
      const d = player.pendingDecision || data.decision;
      const choices = d.allowedChoices || (d.choices || []).map((c) => c.id);
      const pick =
        ["stay-compete", "see-out", "acknowledge", "remain", "stay"].find((c) => choices.includes(c)) ||
        choices[0];
      resolveSquadDecision(player, d, pick);
    }
    data = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions: true,
      autoDecisionPolicy: null,
      checkpoint: data.checkpoint,
    });
  }
  return data;
}

function periodEvidence(player) {
  const world = serializeWorldState();
  const entry = (world.clubs || []).find((e) =>
    Array.isArray(e) ? e[0] === player.playingClubId : e.clubId === player.playingClubId
  );
  const profile = Array.isArray(entry) ? entry[1] : entry;
  const last = player.seasons?.at(-1) || null;
  const nationalCaps = Array.isArray(player.nationalTeamCaps)
    ? player.nationalTeamCaps.length
    : Number(player.internationalCaps) || 0;
  const stints = (player.playingStints || player.registrationHistory || []).slice(-4).map((s) => ({
    clubId: s.clubId || s.playingClubId || null,
    employmentClubId: s.employmentClubId || null,
    startDate: s.startDate || s.from || null,
    endDate: s.endDate || s.to || null,
    kind: s.kind || s.type || null,
  }));
  return {
    seasons: player.seasons?.length ?? 0,
    playingClubId: player.playingClubId,
    employmentClubId: player.employmentClubId,
    modelVersion: world.clubStrengthModelVersion,
    schema: world.schemaVersion,
    replacementST: profile?.replacementOvr?.ST ?? null,
    lastMinutes: last?.minutes ?? null,
    lastGoals: last?.goals ?? null,
    ownershipSplit: player.playingClubId !== player.employmentClubId,
    nationalCaps,
    recentStints: stints,
  };
}

/**
 * Run one career for `periods` seasons. Returns a fixture row.
 */
export function runCareerFixture({ i, club: clubName, role, seed, ovr, loan = false, periods = PERIODS }) {
  reseedCareerRng(seed);
  resetClubFinanceLedgers();
  setWorldState(createWorldState({ startYear: 2026, seed }));

  const club = clubByName(clubName);
  if (!club) throw new Error(`club-not-found:${clubName}`);

  const player = createPlayerIdentity({
    name: `F10C${i}`,
    nationality: i % 5 === 0 ? "Serbia" : club.nation || "England",
    position: role,
    age: 21 + (i % 6),
  });
  Object.assign(player, {
    careerId: `fix10-c${i}-s${seed}`,
    startYear: 2026,
    rating: ovr,
    attributes: attrs(ovr),
    state: { form: 0, morale: 0, readiness: 1, fatigue: 0, adaptationPenalty: 0, roleFit: 1 },
    seasons: [],
    club: { ...club },
    employmentClubId: club.clubId,
    playingClubId: club.clubId,
    contractStatus: "active",
    contractYears: 3,
    contractEndSeason: 3,
    weeklyWage: 2000,
    wage: 2000,
  });
  ensurePlayerModel(player);
  refreshAbilityCaches(player);
  ensureContractAuthority(player);
  ensureTransferSave(player);
  ensurePlayingStints(player, { asOfDate: "2026-07-01" });

  if (loan) {
    const borrower =
      allSeniorClubs().find((c) => c.clubId !== club.clubId && c.nation === club.nation) ||
      allSeniorClubs().find((c) => c.clubId !== club.clubId);
    if (borrower) {
      const res = startLoan(player, {
        club: { ...borrower },
        clubId: borrower.clubId,
        wage: 1500,
        durationSeasons: 1,
        isLoan: true,
      });
      if (!res?.ok) {
        player.playingClubId = borrower.clubId;
        player.club = { ...borrower };
        player.loan = {
          parentClubId: player.employmentClubId,
          borrowerClubId: borrower.clubId,
          seasonsRemaining: 1,
        };
      }
    }
  }

  const input = {
    i,
    seed,
    role,
    ovr,
    club: club.name,
    clubId: club.clubId,
    leagueId: club.leagueId,
    loan,
    periods,
    modelVersion: CLUB_STRENGTH_MODEL_VERSION,
  };
  writeFileSync(join(OUT, `input-${seed}.json`), JSON.stringify(input, null, 2));

  const periodRows = [];
  for (let period = 0; period < periods; period++) {
    reseedCareerRng(seed + period * 97);
    drainSeason(player);
    periodRows.push({ period, ...periodEvidence(player) });
  }

  const snap = serializeWorldState();
  writeFileSync(join(OUT, `world-final-${seed}.json`), JSON.stringify(snap));
  const restored = deserializeWorldState(JSON.parse(JSON.stringify(snap)));
  const restoreOk =
    restored.clubStrengthModelVersion === CLUB_STRENGTH_MODEL_VERSION &&
    (restored.schemaVersion || 0) >= 4;

  return {
    i,
    role,
    club: club.name,
    leagueId: club.leagueId,
    seed,
    ovr,
    loan,
    periods: periodRows,
    restoreOk,
    excluded: false,
    inputPath: `input-${seed}.json`,
    worldFinalPath: `world-final-${seed}.json`,
  };
}

function runPrimary(limit) {
  const rows = [];
  const exclusions = [];
  let failures = 0;
  const n = Math.min(limit, COHORT_PLAN.length);
  for (let i = 0; i < n; i++) {
    const { club, role } = COHORT_PLAN[i];
    const seed = BASE_SEED + i;
    const ovr = 68 + (i % 6) * 2;
    const loan = i % 8 === 7;
    try {
      const row = runCareerFixture({ i, club, role, seed, ovr, loan });
      rows.push(row);
      writeFileSync(join(OUT, `fixture-${seed}.json`), JSON.stringify(row, null, 2));
      console.log(JSON.stringify({ event: "career-ok", i, seed, club, role }));
    } catch (err) {
      failures += 1;
      const exclusion = {
        i,
        club,
        role,
        seed,
        error: String(err?.message || err),
      };
      exclusions.push(exclusion);
      rows.push({ i, role, club, seed, ovr, excluded: true, error: exclusion.error });
      writeFileSync(join(OUT, `fixture-${seed}.json`), JSON.stringify(rows.at(-1), null, 2));
      console.log(JSON.stringify({ event: "career-excluded", ...exclusion }));
    }
  }
  return { rows, exclusions, failures };
}

function runSupplemental() {
  const seeds = [];
  const rows = [];
  let completed = 0;
  for (const plan of SUPPLEMENTAL_PLAN) {
    const club = clubByName(plan.club);
    if (!club) throw new Error(`supplemental-club-missing:${plan.club}`);
    const i = 1000 + plan.seed;
    const ovr = 72;
    try {
      const row = runCareerFixture({
        i,
        club: plan.club,
        role: plan.role,
        seed: plan.seed,
        ovr,
        loan: false,
      });
      row.supplemental = true;
      row.replacesExclusionSeed = plan.replacesExclusionSeed;
      row.reason = plan.reason;
      rows.push(row);
      seeds.push(plan.seed);
      completed += 1;
      writeFileSync(join(OUT, `fixture-${plan.seed}.json`), JSON.stringify(row, null, 2));
      console.log(JSON.stringify({ event: "supplemental-ok", seed: plan.seed, club: plan.club }));
    } catch (err) {
      rows.push({
        seed: plan.seed,
        club: plan.club,
        role: plan.role,
        excluded: true,
        supplemental: true,
        error: String(err?.message || err),
      });
      console.log(
        JSON.stringify({
          event: "supplemental-fail",
          seed: plan.seed,
          error: String(err?.message || err),
        })
      );
    }
  }
  const summary = {
    completed,
    seeds,
    rows,
    replacesExclusionSeed: SUPPLEMENTAL_PLAN[0]?.replacesExclusionSeed ?? null,
    reason: SUPPLEMENTAL_PLAN[0]?.reason ?? null,
  };
  writeFileSync(join(OUT, "supplemental-summary.json"), JSON.stringify(summary, null, 2));
  return summary;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let primary = { rows: [], exclusions: [], failures: 0 };

  if (!args.supplementalOnly) {
    primary = runPrimary(args.n);
    const completed = primary.rows.filter((r) => !r.excluded).length;
    const summary = {
      careers: Math.min(args.n, COHORT_PLAN.length),
      periodsEach: PERIODS,
      failures: primary.failures,
      exclusions: primary.exclusions,
      completed,
      rows: primary.rows,
      runner: "scripts/qaFix10CareerCohort.mjs",
      plan: COHORT_PLAN,
      baseSeed: BASE_SEED,
    };
    writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  } else if (existsSync(join(OUT, "summary.json"))) {
    primary = {
      rows: JSON.parse(readFileSync(join(OUT, "summary.json"), "utf8")).rows || [],
      exclusions: JSON.parse(readFileSync(join(OUT, "summary.json"), "utf8")).exclusions || [],
      failures: 0,
    };
  }

  const supplemental = runSupplemental();

  // Merge supplemental pointer into primary summary when present.
  if (existsSync(join(OUT, "summary.json"))) {
    const summary = JSON.parse(readFileSync(join(OUT, "summary.json"), "utf8"));
    summary.supplemental = {
      completed: supplemental.completed,
      seeds: supplemental.seeds,
      replacesExclusionSeed: supplemental.replacesExclusionSeed,
      reason: supplemental.reason,
      path: "supplemental-summary.json",
    };
    writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  }

  const completed = (primary.rows || []).filter((r) => !r.excluded).length;
  console.log(
    JSON.stringify(
      {
        ok: completed + supplemental.completed >= 24,
        completed,
        supplementalCompleted: supplemental.completed,
        exclusions: primary.exclusions,
        out: OUT,
      },
      null,
      2
    )
  );
  if (completed + supplemental.completed < 24) process.exitCode = 1;
}

main();
