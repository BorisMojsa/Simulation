#!/usr/bin/env node
/**
 * Fix 11 growth calibration and full-career evidence driver.
 *
 * This runner deliberately keeps synthetic trajectories, constructed paths, and
 * natural careers in separate evidence sets. It does not tune coefficients.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applySkipOpeningDevelopment,
  createPlayerIdentity,
  finalizeAcademyPlayer
} from "../js/simulation/playerDevelopment.js";
import { simulateFullAcademyOpening } from "../js/simulation/academyOpening.js";
import {
  acceptAcademyGraduationOffer,
  declineAcademyReview,
  ensureAcademyLifecycle
} from "../js/simulation/academyLifecycle.js";
import { buildNarrativeAcademySeason } from "../js/simulation/narrativeAcademySeason.js";
import {
  buildFirstProContractDecision,
  signFirstProfessionalContract
} from "../js/simulation/proContractOffers.js";
import {
  developSeason,
  generateStartingAttributes,
  initializePlayerDevelopment
} from "../js/simulation/playerDevelopmentModel.js";
import { ACADEMY_POOL, LEAGUES, LEAGUE_LOOKUP } from "../js/data/leagues.js";
import {
  createRng,
  getSimRng,
  hashSeed,
  reseedCareerRng,
  setSimRng
} from "../js/simulation/rng.js";
import { createWorldState, getWorldState, setWorldState } from "../js/simulation/worldState.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import { serializeCareerSnapshot, deserializeCareerSnapshot } from "../js/simulation/careerSnapshot.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import {
  declineWindowAndContinue,
  isFreeAgent,
  selectNextCareerAction,
  settleBoundaryContractReview
} from "../js/simulation/contractLifecycle.js";
import { resolveSquadDecision } from "../js/simulation/squadDecisions.js";
import { applySeniorScenarioPolicy } from "../js/simulation/seniorCareerScenarios.js";
import { acceptPipelineOffer, generatePipelineOffers } from "../js/simulation/dealPipeline.js";
import {
  EPSILON,
  FIX11_SCHEMA_VERSION,
  assessRun,
  clonePlayerForPairing,
  displayedGain,
  isDisplayed99,
  isRaw99,
  reconcileGrossPositive,
  sourceHashes,
  summarize,
  validateDriverGuard,
  validateDriverSeasonResult
} from "./lib/fix11GrowthEvidence.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const RUNS_ROOT = join(ROOT, "qa/fix11-runs");
const WITNESS_ROOT = join(RUNS_ROOT, "witnesses");
const WITNESS_INDEX_PATH = join(WITNESS_ROOT, "index.json");
const PLAN_PATH = join(RUNS_ROOT, "plan.json");
const TARGETS_PATH = join(ROOT, "reports/fix11-calibration-targets.json");
const POSITIONS = ["GK", "CB", "LB", "CDM", "CM", "CAM", "RW", "ST"];
const NATIONS = ["England", "Spain", "Germany", "France", "Italy", "Brazil", "Serbia", "Japan"];
const VALID_POLICIES = ["mixed-default", "appropriate-minutes-loan", "elite-bench", "discovery"];
const HELP = `Fix 11 full-career growth calibration

Usage:
  node scripts/calibrateFullCareerGrowth.mjs --help
  node scripts/calibrateFullCareerGrowth.mjs --mode pilot
  node scripts/calibrateFullCareerGrowth.mjs --mode controlled
  node scripts/calibrateFullCareerGrowth.mjs --mode full-careers --policy mixed-default --n 50
  node scripts/calibrateFullCareerGrowth.mjs --mode paired --n 24
  node scripts/calibrateFullCareerGrowth.mjs --mode witness-replay --witness <id>
  node scripts/calibrateFullCareerGrowth.mjs --mode assess --dir qa/fix11-runs/<run>

Options:
  --mode <mode>       pilot | controlled | trajectories | full-careers | full |
                      holdout | paired | paired-engine-side | witness-replay | assess
  --policy <id>       mixed-default | appropriate-minutes-loan | elite-bench | discovery
  --n <count>         Override the selected cohort size
  --label <name>      Stable output directory label (default: UTC timestamp)
  --witness <id>      Replay witness id written by a previous run
  --dir <path>        Run directory for strict assessment
`;

function parseArgs(argv) {
  const args = { mode: "pilot", policy: "mixed-default", n: null, label: null, witness: null, dir: null };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (["--mode", "--policy", "--n", "--label", "--witness", "--dir"].includes(token)) {
      const key = token.slice(2);
      if (argv[i + 1] == null) throw new Error(`Missing value for ${token}`);
      args[key] = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (args.n != null) {
    args.n = Number(args.n);
    if (!Number.isInteger(args.n) || args.n < 1) throw new Error("--n must be a positive integer");
  }
  if (!VALID_POLICIES.includes(args.policy)) throw new Error(`Unknown policy: ${args.policy}`);
  return args;
}

/** Fixed 24-pair schedule shared by identity controls and base/final engine sides. */
function pairedCareerSchedule(seedRoot, n = 24) {
  const policies = ["mixed-default", "appropriate-minutes-loan"];
  const rows = [];
  for (let i = 0; i < n; i++) {
    const policy = policies[i % policies.length];
    const positionHint = POSITIONS[i % POSITIONS.length];
    const seed = hashSeed(`${seedRoot}:career-pair:${policy}:${positionHint}:${i}`);
    rows.push({
      pairIndex: i,
      index: 1000 + i,
      policy,
      positionHint,
      seed,
      cohort: `paired-${policy}`,
    });
  }
  return rows;
}

function safeLabel(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function makeRunDirectory(label) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(RUNS_ROOT, safeLabel(label || stamp));
  for (const child of ["trajectories", "careers", "paired", "witnesses"]) {
    mkdirSync(join(dir, child), { recursive: true });
  }
  return dir;
}

function writeJson(path, value) {
  try {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  } catch (error) {
    if (!String(error?.message || error).includes("Invalid string length")) throw error;
    // Huge witness worlds: write compact JSON without pretty-print to reduce peak string size.
    writeFileSync(path, JSON.stringify(value));
  }
}

/**
 * Compact a career snapshot for packaging.
 * Authoritative checkpoints keep resume-critical player/world fields for one more
 * Simulate/Continue season (B03/B04). Oversized historical match ledgers are
 * trimmed when they would exceed JSON string limits; equivalence is proven by
 * matching raw endpoints after a real UI season drive against afterSnapshot.
 */
/**
 * Deep-freeze a career snapshot so later season mutations cannot alias into it.
 * serializeWorldState keeps live club/nation object references inside entry arrays.
 */
function freezeCareerSnapshot(snapshot) {
  // Deep-clone aliased live refs. Long-career player.seasons trees can exceed
  // V8 string limits; keep only compact history plus the latest season full.
  const world = snapshot.world ? { ...snapshot.world } : null;
  if (world) {
    for (const key of ["clubs", "nations", "baselineClubs", "baselineNations"]) {
      if (world[key] != null) world[key] = JSON.parse(JSON.stringify(world[key]));
    }
  }
  let player = snapshot.player ? JSON.parse(JSON.stringify(snapshot.player)) : null;
  if (player?.seasons?.length > 2) {
    const total = player.seasons.length;
    player.seasons = player.seasons.map((season, index) => {
      if (index >= total - 1) return season;
      return {
        seasonNumber: season.seasonNumber,
        age: season.age,
        year: season.year,
        clubId: season.clubId || null,
        club: season.club || null,
        minutes: season.minutes ?? 0,
        appearances: season.appearances ?? null,
        averageRating: season.averageRating ?? season.avgRating ?? null,
        developmentBreakdown: season.developmentBreakdown || null,
        developmentExplanations: season.developmentExplanations || [],
        breakthrough: Boolean(season.breakthrough),
        sceneDevelopment: season.sceneDevelopment || null,
        baseOverallBefore: season.baseOverallBefore ?? null,
        baseOverallAfter: season.baseOverallAfter ?? null,
      };
    });
  }
  return {
    ...snapshot,
    player,
    world,
    clubFinance: snapshot.clubFinance ? JSON.parse(JSON.stringify(snapshot.clubFinance)) : null,
  };
}

function slimReplaySnapshot(snapshot, { authoritative = false } = {}) {
  // Avoid structuredClone on multi-hundred-MB live worlds; build a lean object.
  const player = snapshot?.player ? { ...snapshot.player } : null;
  const world = snapshot?.world ? { ...snapshot.world } : null;
  if (player?.seasons) {
    const keepFull = authoritative ? 2 : 0;
    const total = player.seasons.length;
    player.seasons = player.seasons.map((season, index) => {
      if (authoritative && index >= total - keepFull) {
        return {
          ...season,
          // Drop per-match ledgers nested in old seasons; keep development receipts.
          matches: undefined,
          fixtureLedger: undefined,
        };
      }
      return {
        seasonNumber: season.seasonNumber,
        age: season.age,
        year: season.year,
        clubId: season.clubId || null,
        club: season.club || null,
        minutes: season.minutes ?? 0,
        appearances: season.appearances ?? null,
        averageRating: season.averageRating ?? season.avgRating ?? null,
        rawOverallBefore: season.developmentBreakdown?.rawOverallBefore ?? null,
        rawOverallAfter: season.developmentBreakdown?.rawOverallAfter ?? null,
        developmentBreakdown: season.developmentBreakdown || null,
        developmentExplanations: season.developmentExplanations || [],
        breakthrough: Boolean(season.breakthrough),
        sceneDevelopment: season.sceneDevelopment || null,
      };
    });
  }
  if (world) {
    delete world.baselineClubs;
    delete world.baselineNations;
    const heavy = [
      "form",
      "standings",
      "cupResults",
      "qualification",
      "editions",
      "matches",
      "ties",
      "fixtureLedger",
      "formAppliedFixtures",
    ];
    for (const key of heavy) {
      if (!Array.isArray(world[key])) continue;
      // Keep a bounded recent slice for authoritative resume; empty otherwise.
      if (authoritative && world[key].length > 0) {
        world[key] = world[key].slice(-500);
      } else {
        world[key] = [];
      }
    }
  }
  return {
    schemaVersion: snapshot?.schemaVersion ?? null,
    exportedAt: snapshot?.exportedAt ?? null,
    player,
    world,
  };
}

function gitRevision() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function resetCareerState(seed) {
  resetClubFinanceLedgers();
  reseedCareerRng(seed);
  setWorldState(createWorldState({ startYear: 2026, seed }));
}

function withDeterministicClock(seed, operation) {
  const realNow = Date.now;
  let now = 1_800_000_000_000 + (Number(seed) >>> 0) * 1000;
  Date.now = () => now++;
  try {
    const result = operation();
    if (result && typeof result === "object") {
      result.deterministicClockEnd = now;
      result.deterministicClockSeed = Number(seed) >>> 0;
    }
    return result;
  } finally {
    Date.now = realNow;
  }
}

function makeSyntheticPlayer(seed, overrides = {}) {
  const rng = createRng(seed);
  const position = overrides.position || rng.pick(POSITIONS);
  const age = overrides.age ?? rng.int(17, 22);
  const start = overrides.start ?? rng.float(58, 76);
  const attributes = generateStartingAttributes(position, start, 99, rng);
  const player = {
    name: `Fix11Trajectory${seed}`,
    nationality: "Calibration",
    position,
    age,
    careerId: `fix11-trajectory-${seed}`,
    attributes,
    rating: start
  };
  initializePlayerDevelopment(player, { rng, careerId: player.careerId });
  return { player, rng };
}

function trajectoryContext(rng, policy, year) {
  if (policy === "poor") {
    return { usefulMinutes: 900, healthyTrainingFraction: 0.78, reliability: 0.55, P_long: -0.55, environmentMultiplier: 0.82 };
  }
  if (policy === "ordinary") {
    return { usefulMinutes: 2000, healthyTrainingFraction: 0.88, reliability: 0.7, P_long: 0.08, environmentMultiplier: 1.0 };
  }
  if (policy === "good") {
    // Production-realistic "good": strong minutes and clearly positive seasonP,
    // not the near-ceiling signals that natural match residuals rarely reach.
    return { usefulMinutes: 2700, healthyTrainingFraction: 0.96, reliability: 0.82, P_long: 0.48, environmentMultiplier: 1.12 };
  }
  if (policy === "exceptional") {
    return {
      usefulMinutes: 3200,
      healthyTrainingFraction: 1,
      reliability: 0.92,
      P_long: 0.82,
      environmentMultiplier: 1.28,
      forceBreakthrough: year % 4 === 0,
      recognition: {
        awards: [{ awardId: "player-of-the-season", status: "won" }],
        trophies: [{ kind: "league", participationWeight: 0.9 }]
      }
    };
  }
  return {
    usefulMinutes: rng.float(700, 3200),
    healthyTrainingFraction: rng.float(0.58, 1),
    reliability: rng.float(0.35, 0.92),
    P_long: rng.float(-0.55, 0.78),
    environmentMultiplier: rng.float(0.72, 1.28)
  };
}

function runTrajectory(seed, { years = 24, cohort = "natural-synthetic" } = {}) {
  const { player, rng } = makeSyntheticPlayer(seed);
  const history = [];
  let reconciliationFailures = 0;
  let ordinaryCapFailures = 0;
  let breakthroughCapFailures = 0;
  for (let year = 0; year < years && player.age < (player.position === "GK" ? 42 : 40); year++) {
    const before = player.baseOverallRaw;
    const result = developSeason(player, {
      elapsedYears: 1,
      ...trajectoryContext(rng, null, year),
      rng: rng.fork(`year:${year}`),
      seasonId: `fix11-traj:${seed}:${year}`,
      periodId: `fix11-traj:${seed}:${year}`,
      alreadyAppliedLearningGain: 0
    });
    const reconciliation = reconcileGrossPositive(result);
    if (!reconciliation.ok) reconciliationFailures++;
    const cap = result?.breakthrough?.occurred ? 9 : 8;
    if (reconciliation.grossPositive > cap + 1e-6) {
      if (cap === 9) breakthroughCapFailures++;
      else ordinaryCapFailures++;
    }
    player.age++;
    const after = player.baseOverallRaw;
    history.push({
      age: player.age,
      rawBefore: before,
      rawAfter: after,
      rawDelta: after - before,
      displayedDelta: displayedGain(before, after),
      breakthrough: Boolean(result?.breakthrough?.occurred),
      reconciliation
    });
  }
  const raws = history.map((row) => row.rawAfter);
  return {
    id: `trajectory-${seed}`,
    kind: "synthetic-trajectory",
    cohort,
    seed,
    position: player.position,
    startAge: history[0]?.age - 1,
    startRaw: history[0]?.rawBefore,
    peakRaw: raws.length ? Math.max(...raws) : player.baseOverallRaw,
    everDisplayed99: raws.some(isDisplayed99),
    everRaw99: raws.some(isRaw99),
    displayed99Before25: history.some((row) => row.age < 25 && isDisplayed99(row.rawAfter)),
    checks: { reconciliationFailures, ordinaryCapFailures, breakthroughCapFailures },
    history
  };
}

/**
 * Isolated signed-performance treatment.
 * Identical initialized attributes/traits/RNG; only P_long varies by band.
 * Minutes, health, confidence, environment stay fixed. Label composite
 * trajectoryContext scenarios separately — they are not this study.
 */
function runControlled(seedRoot, nPerBand) {
  const performanceBands = {
    poor: -0.55,
    ordinary: 0.08,
    good: 0.48,
    exceptional: 0.82,
  };
  const sharedContext = {
    usefulMinutes: 2600,
    healthyTrainingFraction: 0.95,
    reliability: 0.82,
    environmentMultiplier: 1.05,
  };
  const bands = {};
  const roles = POSITIONS;
  for (const policy of Object.keys(performanceBands)) {
    const rows = [];
    for (let i = 0; i < nPerBand; i++) {
      const position = roles[i % roles.length];
      const seed = hashSeed(`${seedRoot}:perf-only:${position}:${i}`);
      const { player, rng } = makeSyntheticPlayer(seed, { position, age: 19, start: 70 });
      const before = player.baseOverallRaw;
      const result = developSeason(player, {
        elapsedYears: 1,
        ...sharedContext,
        P_long: performanceBands[policy],
        rng: rng.fork("controlled-season"),
        seasonId: `fix11-controlled-perf:${policy}:${position}:${i}`,
        periodId: `fix11-controlled-perf:${policy}:${position}:${i}`,
        alreadyAppliedLearningGain: 0
      });
      const after = player.baseOverallRaw;
      rows.push({
        treatment: "signed-performance-P_long-only",
        policy,
        position,
        P_long: performanceBands[policy],
        sharedContext,
        rawBefore: before,
        rawAfter: after,
        rawDelta: after - before,
        displayedDelta: displayedGain(before, after),
        breakthrough: Boolean(result?.breakthrough?.occurred),
        reconciliation: reconcileGrossPositive(result),
        components: result?.components || null,
      });
    }
    bands[policy] = {
      treatment: "signed-performance-P_long-only",
      P_long: performanceBands[policy],
      rawDelta: summarize(rows.map((row) => row.rawDelta)),
      displayedPlus6Or7: rows.filter((row) => row.displayedDelta === 6 || row.displayedDelta === 7).length,
      rows
    };
  }
  return bands;
}

function offerScore(offer, policy, rng) {
  const minutes = Number(offer.projectedMinutesShare) || Number(offer.projectedMinutesRange?.[0]) / 4000 || 0;
  const role = { starter: 4, rotation: 3, prospect: 2, cover: 1 }[offer.expectedRole] || 0;
  const challenge = Number(offer.scouting?.assessedReadiness) || 0;
  const wages = Math.log1p(Math.max(0, Number(offer.wage) || 0)) / 20;
  if (policy === "appropriate-minutes-loan") return minutes * 6 + role * 2 + challenge + wages + (offer.isLoan ? 1.5 : 0);
  if (policy === "elite-bench") return (1 - minutes) * 6 - role + challenge * 2 + wages;
  if (policy === "discovery") return minutes * 2 + role + wages + rng.float(0, 0.001);
  return minutes * 3 + role + challenge + wages + rng.float(0, 1.5);
}

function rankedOffers(offers, policy, rng) {
  return [...(offers || [])]
    .filter(Boolean)
    .map((offer) => ({ offer, score: offerScore(offer, policy, rng) }))
    .sort((a, b) => b.score - a.score)
    .map((row) => row.offer);
}

function resolveOffers(player, policy, rng) {
  const offers = rankedOffers(player.pendingOffers, policy, rng);
  if (player.club?.isAcademy && player.academyLifecycle?.pendingReview) {
    for (const offer of offers) {
      const deal =
        player.academyLifecycle.pendingReview.offers?.find((candidate) => (candidate.offer || candidate).offerId === offer.offerId) ||
        offer;
      const result = acceptAcademyGraduationOffer(player, deal);
      if (result.ok) return { ok: true, action: "academy-offer-accepted", offerId: offer.offerId };
    }
    return declineAcademyReview(player, { reason: "fix11-policy-declined" });
  }
  for (const offer of offers) {
    const result = acceptPipelineOffer(player, offer);
    if (result?.ok) return { ok: true, action: "offer-accepted", offerId: offer.offerId };
  }
  return declineWindowAndContinue(player, { choiceId: "see-out" });
}

function chooseDecision(decision, policy) {
  const choices = decision?.allowedChoices || (decision?.choices || []).map((choice) => choice.id);
  const preferred =
    policy === "appropriate-minutes-loan"
      ? ["review-loans", "new-loan", "accept-renewal", "stay-compete", "remain", "see-out", "acknowledge"]
      : policy === "elite-bench"
        ? ["stay-compete", "remain", "accept-renewal", "see-out", "acknowledge"]
        : ["accept-renewal", "review-loans", "stay-compete", "remain", "see-out", "acknowledge"];
  return preferred.find((choice) => choices.includes(choice)) || choices[0] || null;
}

/**
 * Headless equivalent of the production senior-scenario overlay's Continue
 * button. This is an acknowledgement after a successful receipt, not a guard
 * bypass: unresolved or unreceipted scenarios remain pending and block.
 */
function acknowledgeResolvedScenario(player, pending) {
  if (!pending?.resolved || !pending.abilityReceipt || !pending.chosenOptionId) {
    return { ok: false, reason: "scenario-not-fully-resolved" };
  }
  if (player.pendingSeniorScenario !== pending) {
    return { ok: false, reason: "scenario-identity-mismatch" };
  }
  player.pendingSeniorScenario = null;
  return { ok: true, action: "scenario-acknowledged" };
}

function resolveActionBeforeSeason(player, policy, rng) {
  const action = selectNextCareerAction(player);
  if (action.canSimulate) return { ok: true, action: "simulate" };
  if (action.id === "retired") return { ok: true, action: "retired" };
  if (action.id === "resolve-scenario") {
    const pending = player.pendingSeniorScenario || player.seasonCheckpoint?.pendingSeniorScenario;
    if (!pending) return { ok: false, reason: "scenario-action-without-scenario" };
    if (!pending.resolved) {
      const result = applySeniorScenarioPolicy(player, pending, "balanced");
      if (!result?.ok) return { ok: false, reason: `scenario-resolution:${result?.reason || "failed"}` };
    }
    return acknowledgeResolvedScenario(player, pending);
  }
  if (action.id === "resolve-decision") {
    const choice = chooseDecision(player.pendingDecision, policy);
    if (!choice) return { ok: false, reason: "decision-without-valid-choice" };
    const result = resolveSquadDecision(player, player.pendingDecision, choice);
    return result?.ok ? { ok: true, action: result.action } : { ok: false, reason: `decision:${result?.reason}` };
  }
  if (action.id === "resolve-offers" || action.id === "academy-review" || action.id === "academy-final-review") {
    const result = resolveOffers(player, policy, rng);
    return result?.ok ? { ok: true, action: result.action } : { ok: false, reason: `offers:${result?.reason}` };
  }
  if (action.id === "resolve-contract-review") {
    const result = settleBoundaryContractReview(player, { choice: "no-offer", reason: "fix11-no-executable-offer" });
    return result?.ok ? { ok: true, action: result.action } : { ok: false, reason: `contract-review:${result?.reason}` };
  }
  return { ok: false, reason: `unsupported-next-action:${action.id}` };
}

function drainOneSeason(player, policy, rng) {
  let checkpoint = player.seasonCheckpoint || null;
  let guard = 0;
  const startSeasonCount = player.seasons?.length || 0;
  const startAge = player.age;

  while (guard++ < 100) {
    if (!checkpoint) {
      const pre = resolveActionBeforeSeason(player, policy, rng);
      if (!pre.ok) return { ok: false, reason: pre.reason, guard };
      if (pre.action === "retired") return { ok: true, retired: true, completed: false, guard };
      if (pre.action !== "simulate") {
        checkpoint = player.seasonCheckpoint || null;
        continue;
      }
    }

    let result;
    try {
      result = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
        pauseForDecisions: true,
        autoDecisionPolicy: null,
        checkpoint
      });
    } catch (error) {
      return {
        ok: false,
        reason: "production-season-throw",
        error: String(error?.message || error),
        stack: String(error?.stack || ""),
        guard
      };
    }
    if (result?.awaitingScenario) {
      const pending = player.pendingSeniorScenario || result.pendingSeniorScenario;
      if (!pending) return { ok: false, reason: "awaiting-scenario-without-payload", guard };
      const resolution = pending.resolved ? { ok: true } : applySeniorScenarioPolicy(player, pending, "balanced");
      if (!resolution?.ok) return { ok: false, reason: `scenario:${resolution?.reason || "failed"}`, guard };
      const acknowledged = acknowledgeResolvedScenario(player, pending);
      if (!acknowledged.ok) return { ok: false, reason: `scenario-acknowledge:${acknowledged.reason}`, guard };
      checkpoint = result.checkpoint;
      continue;
    }
    if (result?.awaitingDecision) {
      if (result.offers?.length && (!player.pendingOffers || player.pendingOffers.length === 0)) {
        player.pendingOffers = result.offers;
      }
      if (player.pendingOffers?.length) {
        const offerResult = resolveOffers(player, policy, rng);
        if (!offerResult?.ok) return { ok: false, reason: `paused-offers:${offerResult?.reason}`, guard };
      } else {
        const decision = player.pendingDecision || result.decision;
        const choice = chooseDecision(decision, policy);
        if (!decision || !choice) return { ok: false, reason: "awaiting-decision-without-choice", guard };
        const resolved = resolveSquadDecision(player, decision, choice);
        if (!resolved?.ok) return { ok: false, reason: `paused-decision:${resolved?.reason}`, guard };
      }
      checkpoint = result.checkpoint;
      continue;
    }

    const endSeasonCount = player.seasons?.length || 0;
    const validation = validateDriverSeasonResult(result, startSeasonCount, endSeasonCount);
    if (!validation.ok) return { ...validation, guard };
    return {
      ok: true,
      completed: true,
      guard,
      result,
      startAge,
      endAge: player.age,
      startSeasonCount,
      endSeasonCount
    };
  }
  return { ...validateDriverGuard(guard, 100), guard };
}

function bootstrapNaturalCareer(index, seed, policy, cohort = "natural-mixed") {
  resetCareerState(seed);
  const setupRng = createRng(hashSeed(`fix11:setup:${seed}`));
  const controlledStart = cohort === "controlled-start-stress";
  const position = controlledStart ? "RW" : POSITIONS[index % POSITIONS.length];
  const player = createPlayerIdentity({
    name: `Fix11Career${index}_${seed}`,
    nationality: controlledStart ? "United States" : NATIONS[index % NATIONS.length],
    position,
    age: controlledStart ? 17 : 15 + (index % 5)
  });
  const rngStateAfterIdentity = getSimRng().seed();
  const identity = {
    careerId: player.careerId,
    position: player.position,
    age: player.age,
    rngStateAfterIdentity
  };
  const academy = controlledStart ? ACADEMY_POOL[0] : ACADEMY_POOL[setupRng.int(0, ACADEMY_POOL.length - 1)];
  finalizeAcademyPlayer(player, academy);
  // Rebuild after academy selection with an explicit seed; passing the player
  // object here would trigger createWorldState's Date.now/Math.random fallback.
  setWorldState(createWorldState({ seed, startYear: player.startYear || 2026 }));

  const openingPath = index % 2 === 0 ? "interactive" : "skip";
  const openingBefore = player.baseOverallRaw;
  if (openingPath === "interactive") {
    simulateFullAcademyOpening(player, {
      policy: policy === "elite-bench" ? "reckless" : policy === "appropriate-minutes-loan" ? "thoughtful" : "balanced",
      rng: createRng(hashSeed(`fix11:opening:${seed}`))
    });
  } else {
    applySkipOpeningDevelopment(player);
  }
  const openingAfter = player.baseOverallRaw;
  const academySeason = buildNarrativeAcademySeason(player, openingBefore, openingAfter);
  player.seasons.push(academySeason);
  for (const key of ["matches", "goals", "assists", "cleanSheets"]) {
    player.careerTotals[key] += academySeason[key] || 0;
  }
  ensureAcademyLifecycle(player);

  const firstPro = buildFirstProContractDecision(player);
  const dealOffers = rankedOffers(firstPro.offers.map((deal) => deal.offer), policy, setupRng);
  const chosen = dealOffers[0];
  let signed = false;
  if (chosen) {
    const deal = firstPro.offers.find((candidate) => candidate.offer.offerId === chosen.offerId);
    signed = Boolean(signFirstProfessionalContract(player, deal)?.ok);
  }
  return {
    player,
    rng: setupRng,
    manifest: {
      seed,
      policy,
      cohort,
      identity,
      academyId: academy.academyId || academy.clubId || academy.name,
      openingPath,
      openingRawGain: openingAfter - openingBefore,
      firstProOfferCount: firstPro.offers.length,
      firstProSigned: signed
    }
  };
}

function runNaturalCareer(
  index,
  seed,
  policy,
  cohort = "natural-mixed",
  { captureWitnessSnapshots = false, captureSeasonNumber = null } = {}
) {
  return withDeterministicClock(seed, () =>
    runNaturalCareerWithClock(index, seed, policy, cohort, { captureWitnessSnapshots, captureSeasonNumber })
  );
}

function runNaturalCareerWithClock(
  index,
  seed,
  policy,
  cohort,
  { captureWitnessSnapshots = false, captureSeasonNumber = null } = {}
) {
  const { player, rng, manifest } = bootstrapNaturalCareer(index, seed, policy, cohort);
  const seasons = [];
  const witnesses = [];
  const witnessSnapshots = [];
  let blocked = null;
  let falseCompletions = 0;
  const ageLimit = player.position === "GK" ? 42 : 40;
  let steps = 0;
  while (!player.isRetired && player.age < ageLimit && steps++ < 45) {
    const before = player.baseOverallRaw;
    const beforeSnapshot = captureWitnessSnapshots
      ? (() => {
          const snapshot = freezeCareerSnapshot(serializeCareerSnapshot({ player, world: getWorldState() }));
          // Date.now is post-increment. After this stamp returns N, continuous play
          // continues at N+1. Resume must start at N+1 (see installDeterministicClock).
          snapshot.deterministicClockAtExport = Date.now();
          return snapshot;
        })()
      : null;
    const drain = drainOneSeason(player, policy, rng);
    if (!drain.ok) {
      blocked = {
        reason: drain.reason,
        error: drain.error || null,
        age: player.age,
        nextAction: selectNextCareerAction(player),
        guard: drain.guard
      };
      break;
    }
    if (drain.retired) break;
    if (!drain.completed) {
      falseCompletions++;
      blocked = { reason: "non-completed-result", age: player.age };
      break;
    }
    const after = player.baseOverallRaw;
    const season = drain.result.season;
    const row = {
      seasonNumber: season.seasonNumber,
      age: player.age,
      rawBefore: before,
      rawAfter: after,
      rawDelta: after - before,
      displayedDelta: displayedGain(before, after),
      displayed99: isDisplayed99(after),
      raw99: isRaw99(after),
      freeAgent: Boolean(season.freeAgent),
      academy: Boolean(season.academyPeriod || season.isNarrativeAcademyYear),
      minutes: season.minutes ?? 0,
      clubId: season.clubId || null,
      seasonP: season.seasonEvidence?.seasonP ?? season.ledgerSummary?.seasonP ?? null,
      reliability: season.seasonEvidence?.reliability ?? season.ledgerSummary?.reliability ?? null,
      environment: season.developmentBreakdown?.environment ?? null,
      learning: season.developmentBreakdown?.components
        ? {
            ...season.developmentBreakdown.components,
            allowanceUsed: season.developmentBreakdown.annualAllowanceUsed ?? null,
            allowance: season.developmentBreakdown.annualAllowance ?? null,
            scenePositive: season.sceneDevelopment?.grossPositive ?? null,
            sceneNegative: season.sceneDevelopment?.grossNegative ?? null,
            sceneNet: season.sceneDevelopment?.net ?? null,
            sceneEventCount: season.sceneDevelopment?.eventCount ?? null,
          }
        : null,
      components: season.developmentBreakdown?.components || null,
      sceneDevelopment: season.sceneDevelopment || null,
      performance: season.developmentBreakdown?.performance ?? null,
      recognitionPoints: season.developmentBreakdown?.recognitionPoints ?? null,
      breakthrough: Boolean(season.breakthrough),
      explanations: season.developmentExplanations || []
    };
    seasons.push(row);
    if (row.displayed99 || Math.abs(row.displayedDelta) >= 6) {
      witnesses.push({ id: `${player.careerId}:season:${row.seasonNumber}`, ...row });
      const wantSnapshot =
        captureWitnessSnapshots &&
        (captureSeasonNumber == null || Number(captureSeasonNumber) === Number(row.seasonNumber));
      
      if (wantSnapshot) {
        witnessSnapshots.push({
          id: `${player.careerId}:season:${row.seasonNumber}`,
          provenance: {
            careerId: player.careerId,
            seed,
            policy,
            cohort,
            season: row
          },
          beforeSnapshot,
          afterSnapshot: (() => {
            const snapshot = freezeCareerSnapshot(serializeCareerSnapshot({ player, world: getWorldState() }));
            snapshot.deterministicClockAtExport = Date.now();
            return snapshot;
          })(),
        });
      }
    }
    if (isFreeAgent(player)) {
      const market = generatePipelineOffers(player, {
        performanceScore: drain.result.performanceScore ?? 55,
        reviewPhase: "free-agent"
      });
      if (market.offers?.length) player.pendingOffers = market.offers;
    }
  }
  const raws = seasons.map((season) => season.rawAfter);
  return {
    id: player.careerId,
    kind: cohort === "controlled-start-stress" ? "constructed-full-career" : "natural-full-career",
    cohort,
    policy,
    manifest,
    completed: blocked == null && (player.isRetired || player.age >= ageLimit),
    terminalReason: player.isRetired ? "production-retirement" : player.age >= ageLimit ? "age-limit" : "blocked",
    blocked,
    finalAge: player.age,
    seniorAndAcademyPeriods: player.seasons?.length || 0,
    peakRaw: raws.length ? Math.max(player.baseOverallRaw, ...raws) : player.baseOverallRaw,
    everDisplayed99: raws.some(isDisplayed99),
    everRaw99: raws.some(isRaw99),
    displayed99Before25: seasons.some((season) => season.age < 25 && season.displayed99),
    falseCompletions,
    witnesses,
    ...(captureWitnessSnapshots ? { witnessSnapshots } : {}),
    seasons
  };
}

/**
 * One-year environment treatment (correctly labelled; not a full-career study).
 */
function runEnvironmentPaired(seedRoot, n) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const seed = hashSeed(`${seedRoot}:env:${i}`);
    const { player, rng } = makeSyntheticPlayer(seed, { age: 19, start: 70, position: POSITIONS[i % POSITIONS.length] });
    const state = rng.seed();
    const left = clonePlayerForPairing(player, state);
    const right = clonePlayerForPairing(player, state);
    const base = {
      elapsedYears: 1,
      usefulMinutes: 2600,
      healthyTrainingFraction: 0.95,
      reliability: 0.82,
      P_long: 0.48,
      seasonId: `fix11-pair-env:${i}`,
      periodId: `fix11-pair-env:${i}`,
      alreadyAppliedLearningGain: 0
    };
    const before = player.baseOverallRaw;
    const control = developSeason(left.player, { ...base, environmentMultiplier: 0.9, rng: left.rng });
    const treatment = developSeason(right.player, { ...base, environmentMultiplier: 1.2, rng: right.rng });
    rows.push({
      id: `env-pair-${i}`,
      kind: "true-paired-environment-treatment",
      scope: "one-development-year",
      seed,
      clonedRngState: state,
      treatment: "environmentMultiplier:0.9->1.2",
      before,
      controlAfter: left.player.baseOverallRaw,
      treatmentAfter: right.player.baseOverallRaw,
      treatmentEffect: right.player.baseOverallRaw - left.player.baseOverallRaw,
      controlReconciliation: reconcileGrossPositive(control),
      treatmentReconciliation: reconcileGrossPositive(treatment)
    });
  }
  return rows;
}

/**
 * Historical same-engine repeatability control. Useful, but does NOT satisfy
 * the accepted-base / final engine comparison gate (see paired-base-final).
 */
function runPairedNaturalCareerIdentity(seedRoot, n = 24) {
  const rows = [];
  const revision = gitRevision();
  for (const spec of pairedCareerSchedule(seedRoot, n)) {
    const left = runNaturalCareer(spec.index, spec.seed, spec.policy, spec.cohort);
    const right = runNaturalCareer(spec.index, spec.seed, spec.policy, spec.cohort);
    rows.push({
      id: `career-pair-${spec.pairIndex}`,
      kind: "paired-natural-career-identity",
      scope: "full-career",
      policy: spec.policy,
      positionHint: spec.positionHint,
      seed: spec.seed,
      index: spec.index,
      sourceRevision: revision,
      left: {
        id: left.id,
        peakRaw: left.peakRaw,
        everDisplayed99: left.everDisplayed99,
        completed: left.completed,
        seasons: left.seasons?.length ?? 0,
      },
      right: {
        id: right.id,
        peakRaw: right.peakRaw,
        everDisplayed99: right.everDisplayed99,
        completed: right.completed,
        seasons: right.seasons?.length ?? 0,
      },
      identityMatch:
        left.id === right.id &&
        Math.abs((left.peakRaw ?? 0) - (right.peakRaw ?? 0)) <= 1e-9 &&
        left.everDisplayed99 === right.everDisplayed99,
    });
  }
  return rows;
}

/**
 * One side of the accepted-base / final paired study. Writes full careers for
 * the shared 24-pair schedule under the current engine root.
 */
function runPairedEngineSideCareers(seedRoot, n = 24) {
  const engineIdentity = process.env.FIX11_ENGINE_IDENTITY || gitRevision();
  const careers = [];
  for (const spec of pairedCareerSchedule(seedRoot, n)) {
    const career = runNaturalCareer(spec.index, spec.seed, spec.policy, spec.cohort);
    career.manifest = {
      ...(career.manifest || {}),
      index: spec.index,
      pairIndex: spec.pairIndex,
      seed: spec.seed,
      policy: spec.policy,
      positionHint: spec.positionHint,
      engineIdentity,
      study: "paired-natural-career-base-final",
    };
    careers.push(career);
  }
  return careers;
}

function runPaired(seedRoot, n) {
  const envCount = Math.min(n, 24);
  const careerCount = Math.min(n, 24);
  return {
    environmentYear: runEnvironmentPaired(seedRoot, envCount),
    naturalCareers: runPairedNaturalCareerIdentity(seedRoot, careerCount),
    note:
      "environmentYear is a one-year environmentMultiplier treatment. naturalCareers here are same-engine identity controls only. The accepted-base/final comparison lives in qa/fix11-runs/paired-base-final (kind paired-natural-career-base-final).",
  };
}

function flattenPaired(paired) {
  if (Array.isArray(paired)) return { environmentYear: paired, naturalCareers: [], note: null };
  return {
    environmentYear: paired?.environmentYear || [],
    naturalCareers: paired?.naturalCareers || [],
    note: paired?.note || null,
  };
}

function aggregateSummary({ args, runDir, trajectories, controlled, careers, paired, startedAt }) {
  const allTrajectoryChecks = trajectories.flatMap((row) => [row.checks || {}]);
  const controlledRows = Object.values(controlled || {}).flatMap((band) => band.rows || []);
  const pairedFlat = flattenPaired(paired);
  const reconciliationFailures =
    allTrajectoryChecks.reduce((sum, row) => sum + (row.reconciliationFailures || 0), 0) +
    controlledRows.filter((row) => !row.reconciliation.ok).length +
    pairedFlat.environmentYear.filter((row) => !row.controlReconciliation.ok || !row.treatmentReconciliation.ok).length;
  const ordinaryCapFailures = allTrajectoryChecks.reduce((sum, row) => sum + (row.ordinaryCapFailures || 0), 0);
  const breakthroughCapFailures = allTrajectoryChecks.reduce((sum, row) => sum + (row.breakthroughCapFailures || 0), 0);
  const completedCareers = careers.filter((row) => row.completed);
  const completedNaturalCareers = completedCareers.filter((row) => row.kind === "natural-full-career");
  const naturalComponentFailures = completedNaturalCareers.reduce((sum, career) => {
    let failures = 0;
    for (const season of career.seasons || []) {
      const components = season.components || season.learning;
      if (!components) continue;
      const grossPositive =
        Math.max(0, Number(components.learning) || 0) +
        Math.max(0, Number(components.recognition) || 0) +
        Math.max(0, Number(components.positiveShock) || 0);
      const receipt = Number(components.allowanceUsed);
      if (Number.isFinite(receipt) && Math.abs(receipt - grossPositive) > EPSILON) failures++;
      const cap = season.breakthrough ? 9 : 8;
      if (grossPositive > cap + EPSILON) failures++;
    }
    return sum + failures;
  }, 0);
  const finiteValues = [...trajectories.flatMap((row) => row.history), ...careers.flatMap((row) => row.seasons)]
    .every((row) => Number.isFinite(row.rawBefore) && Number.isFinite(row.rawAfter) && Number.isFinite(row.rawDelta));
  const summary = {
    schemaVersion: FIX11_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    startedAt,
    runtimeMs: Date.now() - Date.parse(startedAt),
    mode: args.mode,
    policy: args.policy,
    runDirectory: runDir,
    tuningPerformed: false,
    gitRevision: gitRevision(),
    nodeVersion: process.version,
    hashes: sourceHashes(ROOT),
    counts: {
      trajectories: trajectories.length,
      controlledRows: controlledRows.length,
      careersRequested: careers.length,
      careersCompleted: completedCareers.length,
      paired: pairedFlat.environmentYear.length + pairedFlat.naturalCareers.length,
      pairedEnvironmentYear: pairedFlat.environmentYear.length,
      pairedNaturalCareers: pairedFlat.naturalCareers.length,
      blocked: careers.filter((row) => row.blocked).length
    },
    pairedStudies: {
      note: pairedFlat.note,
      environmentYearEffect: summarize(pairedFlat.environmentYear.map((row) => row.treatmentEffect)),
      naturalCareerIdentityMatches: pairedFlat.naturalCareers.filter((row) => row.identityMatch).length,
      naturalCareerIdentityTotal: pairedFlat.naturalCareers.length,
    },
    checks: {
      finiteValues,
      reconciliationFailures,
      ordinaryCapFailures,
      breakthroughCapFailures,
      naturalComponentAccountingFailures: naturalComponentFailures,
      falseCompletions: careers.reduce((sum, row) => sum + row.falseCompletions, 0)
    },
    syntheticTrajectories: {
      peakRaw: summarize(trajectories.map((row) => row.peakRaw)),
      everDisplayed99Rate: trajectories.length ? trajectories.filter((row) => row.everDisplayed99).length / trajectories.length : null,
      everRaw99Rate: trajectories.length ? trajectories.filter((row) => row.everRaw99).length / trajectories.length : null
    },
    controlled: Object.fromEntries(
      Object.entries(controlled || {}).map(([key, value]) => [
        key,
        { rawDelta: value.rawDelta, displayedPlus6Or7: value.displayedPlus6Or7 }
      ])
    ),
    naturalCareers: {
      completed: completedNaturalCareers.length,
      peakRaw: summarize(completedNaturalCareers.map((row) => row.peakRaw)),
      everDisplayed99Rate: completedNaturalCareers.length
        ? completedNaturalCareers.filter((row) => row.everDisplayed99).length / completedNaturalCareers.length
        : null,
      everRaw99Rate: completedNaturalCareers.length
        ? completedNaturalCareers.filter((row) => row.everRaw99).length / completedNaturalCareers.length
        : null,
      displayed99Before25Rate: completedNaturalCareers.length
        ? completedNaturalCareers.filter((row) => row.displayed99Before25).length / completedNaturalCareers.length
        : null
    },
    constructedCareers: {
      completed: completedCareers.length - completedNaturalCareers.length,
      peakRaw: summarize(completedCareers.filter((row) => row.kind === "constructed-full-career").map((row) => row.peakRaw))
    },
    paired: {
      environmentYearTreatmentEffect: summarize(pairedFlat.environmentYear.map((row) => row.treatmentEffect)),
      naturalCareerIdentityMatches: pairedFlat.naturalCareers.filter((row) => row.identityMatch).length,
      naturalCareerIdentityTotal: pairedFlat.naturalCareers.length,
    },
    blockers: careers.filter((row) => row.blocked).map((row) => ({ id: row.id, ...row.blocked }))
  };
  writeJson(join(runDir, "summary.json"), summary);
  if (summary.blockers.length) {
    writeJson(join(runDir, "BLOCKED.json"), {
      schemaVersion: FIX11_SCHEMA_VERSION,
      status: "BLOCKED",
      note: "These are production-flow failures. No pending state was discarded to force completion.",
      blockers: summary.blockers
    });
  }
  return summary;
}

const CLAIM_TOLERANCE = 1e-6;

export function loadWitnessIndex(path = WITNESS_INDEX_PATH) {
  const index = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(index.witnesses)) throw new Error(`Invalid witness index: ${path}`);
  return index;
}

function splitWitnessArg(witnessArg) {
  const raw = String(witnessArg ?? "").trim();
  const match = raw.match(/:season:(\d+)$/);
  if (!match) return { base: raw, seasonNumber: null };
  return { base: raw.slice(0, match.index), seasonNumber: Number(match[1]) };
}

function careerIdOf(career) {
  return career?.id || career?.manifest?.identity?.careerId || null;
}

function assertUniqueWitnessIndex(index) {
  const ids = index.witnesses.map((entry) => entry.id);
  const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (dupes.length) throw new Error(`Ambiguous witness id: ${dupes.join(", ")}`);
}

function claimForCareerId(index, careerId) {
  const matches = index.witnesses.filter((entry) => entry.id === careerId);
  if (matches.length === 0) throw new Error(`Witness not found: ${careerId}`);
  if (matches.length > 1) throw new Error(`Ambiguous witness id: ${careerId}`);
  const claim = matches[0];
  if (claim.expected?.careerId !== claim.id) {
    throw new Error(`Witness index careerId mismatch for ${claim.id}`);
  }
  return claim;
}

function assertSeasonClaim(claim, seasonNumber) {
  if (seasonNumber == null) return;
  const expected = claim.expected?.seasonNumber;
  if (Number(expected) !== seasonNumber) {
    throw new Error(`Witness season claim ${seasonNumber} does not match indexed season ${expected} for ${claim.id}`);
  }
}

/**
 * Resolve a witness id or career JSON path to its indexed claim.
 * Unknown and ambiguous ids throw before any career is replayed.
 * A `:season:N` suffix is stripped for the id lookup and kept as the season claim.
 * Lookup is exact career-id equality. It never falls through to natural-99.
 */
export function validateWitnessLookup(witnessArg, { indexPath = WITNESS_INDEX_PATH } = {}) {
  if (witnessArg == null || String(witnessArg).trim() === "") {
    throw new Error("--mode witness-replay requires --witness <id>");
  }
  const index = loadWitnessIndex(indexPath);
  assertUniqueWitnessIndex(index);
  const { base, seasonNumber } = splitWitnessArg(witnessArg);
  const direct = resolve(base);
  if (existsSync(direct)) {
    if (!statSync(direct).isFile() || !direct.endsWith(".json")) {
      throw new Error(`Witness path must be a career JSON file: ${witnessArg}`);
    }
    const career = JSON.parse(readFileSync(direct, "utf8"));
    const actualId = careerIdOf(career);
    const claimedId = base.match(/cid_[a-z0-9]+/i)?.[0] || null;
    if (claimedId && actualId !== claimedId) {
      throw new Error(`Witness path claims ${claimedId} but contains ${actualId || "no career id"}`);
    }
    if (!actualId) throw new Error(`Witness file has no career id: ${witnessArg}`);
    const claim = claimForCareerId(index, actualId);
    assertSeasonClaim(claim, seasonNumber);
    if (career.id !== claim.expected.careerId) {
      throw new Error(`Refusing to use ${career.id} for requested ${claim.expected.careerId}`);
    }
    return {
      claim,
      path: direct,
      career,
      seasonNumber: seasonNumber ?? claim.expected.seasonNumber
    };
  }

  if (!/^cid_[a-z0-9]+$/i.test(base)) throw new Error(`Witness not found: ${witnessArg}`);
  const claim = claimForCareerId(index, base);
  assertSeasonClaim(claim, seasonNumber);
  const path = resolve(dirname(indexPath), claim.file);
  if (!existsSync(path)) throw new Error(`Indexed witness file not found: ${claim.file}`);
  const career = JSON.parse(readFileSync(path, "utf8"));
  const actualId = careerIdOf(career);
  if (actualId !== claim.id || actualId !== claim.expected.careerId) {
    throw new Error(`Indexed file identity mismatch: expected ${claim.id}, got ${actualId}`);
  }
  if (actualId !== base) throw new Error(`Refusing to replay ${actualId} for requested ${base}`);
  return {
    claim,
    path,
    career,
    seasonNumber: seasonNumber ?? claim.expected.seasonNumber
  };
}

function sameNumber(actual, expected) {
  return Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= CLAIM_TOLERANCE;
}

export function validateWitnessClaim(claim, career, replayed = career) {
  const errors = [];
  const expected = claim.expected || {};
  const careerId = expected.careerId;
  const savedIdentity = career.manifest?.identity || {};
  const replayIdentity = replayed.manifest?.identity || {};
  for (const [label, actual, wanted] of [
    ["saved career id", career.id, careerId],
    ["saved identity", savedIdentity.careerId, careerId],
    ["replayed career id", replayed.id, careerId],
    ["replayed identity", replayIdentity.careerId, careerId],
    ["saved seed", career.manifest?.seed, expected.seed],
    ["replayed seed", replayed.manifest?.seed, expected.seed],
    ["saved policy", career.policy, expected.policy],
    ["replayed policy", replayed.policy, expected.policy],
    ["saved index", career.manifest?.index, expected.index],
  ]) {
    if (actual !== wanted) errors.push(`${label}: expected ${wanted}, got ${actual}`);
  }

  const seasonNumber = expected.seasonNumber ?? null;
  const savedSeason = seasonNumber == null ? null : career.seasons?.find((row) => row.seasonNumber === seasonNumber);
  const replaySeason = seasonNumber == null ? null : replayed.seasons?.find((row) => row.seasonNumber === seasonNumber);
  if (seasonNumber != null && (!savedSeason || !replaySeason)) {
    errors.push(`target period missing: season ${seasonNumber}`);
  }
  for (const [label, season] of [["saved", savedSeason], ["replayed", replaySeason]]) {
    if (expected.rawBefore != null && !sameNumber(season?.rawBefore, expected.rawBefore)) {
      errors.push(`${label} rawBefore: expected ${expected.rawBefore}, got ${season?.rawBefore}`);
    }
    if (expected.rawAfter != null && !sameNumber(season?.rawAfter, expected.rawAfter)) {
      errors.push(`${label} rawAfter: expected ${expected.rawAfter}, got ${season?.rawAfter}`);
    }
    if (expected.displayedDelta != null && season?.displayedDelta !== expected.displayedDelta) {
      errors.push(`${label} displayedDelta: expected ${expected.displayedDelta}, got ${season?.displayedDelta}`);
    }
    if (expected.displayed99 != null && season?.displayed99 !== expected.displayed99) {
      errors.push(`${label} displayed99: expected ${expected.displayed99}, got ${season?.displayed99}`);
    }
  }
  if (expected.peakRaw != null) {
    if (!sameNumber(career.peakRaw, expected.peakRaw)) {
      errors.push(`saved peakRaw: expected ${expected.peakRaw}, got ${career.peakRaw}`);
    }
    if (!sameNumber(replayed.peakRaw, expected.peakRaw)) {
      errors.push(`replayed peakRaw: expected ${expected.peakRaw}, got ${replayed.peakRaw}`);
    }
  }
  if (expected.everDisplayed99 != null) {
    if (career.everDisplayed99 !== expected.everDisplayed99) {
      errors.push(`saved everDisplayed99: expected ${expected.everDisplayed99}, got ${career.everDisplayed99}`);
    }
    if (replayed.everDisplayed99 !== expected.everDisplayed99) {
      errors.push(`replayed everDisplayed99: expected ${expected.everDisplayed99}, got ${replayed.everDisplayed99}`);
    }
  }
  if (replayed.blocked) errors.push(`replay blocked: ${replayed.blocked.reason}`);
  return { ok: errors.length === 0, reason: errors[0] || null, errors, season: replaySeason };
}

function replayWitness(args) {
  if (!args.witness) throw new Error("--mode witness-replay requires --witness <id>");
  const { claim, path: candidate, career: witness } = validateWitnessLookup(args.witness);
  const expected = claim.expected;
  const requestedId = splitWitnessArg(args.witness).base.match(/^cid_[a-z0-9]+$/i)?.[0] || null;
  if (requestedId && witness.id !== requestedId) {
    throw new Error(`Refusing to replay ${witness.id} for requested ${requestedId}`);
  }
  if (witness.kind === "synthetic-trajectory") {
    return runTrajectory(witness.seed, { cohort: "witness-replay" });
  }
  if (witness.kind && witness.kind !== "natural-full-career" && witness.kind !== "natural-witness") {
    throw new Error(`Unsupported witness kind: ${witness.kind}`);
  }
  const cohort = witness.cohort || witness.manifest?.cohort || "natural-mixed";
  const replayed = runNaturalCareer(expected.index, expected.seed, expected.policy, cohort, {
    captureWitnessSnapshots: true,
    captureSeasonNumber: expected.seasonNumber,
  });
  if (replayed.manifest) replayed.manifest.index = expected.index;
  const snapshotFiles = [];
  for (const entry of replayed.witnessSnapshots || []) {
    if (entry.provenance?.careerId !== expected.careerId) continue;
    const suffix = entry.provenance.season.displayed99
      ? "natural-99"
      : `plus${Math.abs(entry.provenance.season.displayedDelta)}`;
    const output = join(dirname(candidate), `snapshot-${suffix}.json`);
    // Keep the full live world for the single claimed season so B03/B04 can
    // finish through Simulate/Continue. baselineClubs/Nations are required for
    // resume equivalence — dropping them changes match residuals.
    writeJson(output, {
      schema: "fix11-replay-witness-snapshot-v1",
      generatedFrom: candidate,
      id: entry.id,
      provenance: entry.provenance,
      beforeSnapshot: entry.beforeSnapshot,
      afterSnapshot: entry.afterSnapshot,
      packagingNote: "authoritative-full-world-claimed-season",
    });
    snapshotFiles.push(output);
  }
  delete replayed.witnessSnapshots;

  // Refresh saved career + indexed numeric claims when the engine's multi-stint
  // path shifts raw endpoints but preserves the advertised displayed outcomes.
  if (process.env.UPDATE_WITNESS_CLAIMS === "1") {
    const seasonNumber = expected.seasonNumber;
    const replaySeason = replayed.seasons?.find((row) => row.seasonNumber === seasonNumber);
    if (!replaySeason) throw new Error(`Cannot update claims: season ${seasonNumber} missing from replay`);
    if (expected.displayedDelta != null && replaySeason.displayedDelta !== expected.displayedDelta) {
      throw new Error(
        `Refusing claim update: displayedDelta changed ${expected.displayedDelta} -> ${replaySeason.displayedDelta}`
      );
    }
    if (expected.displayed99 != null && replaySeason.displayed99 !== expected.displayed99) {
      throw new Error(
        `Refusing claim update: displayed99 changed ${expected.displayed99} -> ${replaySeason.displayed99}`
      );
    }
    writeJson(candidate, {
      ...replayed,
      kind: witness.kind || "natural-full-career",
      cohort: witness.cohort || replayed.cohort,
    });
    const index = loadWitnessIndex();
    const entry = index.witnesses.find((row) => row.id === claim.id);
    if (!entry) throw new Error(`Cannot update index: ${claim.id} missing`);
    entry.expected = {
      ...entry.expected,
      rawBefore: replaySeason.rawBefore,
      rawAfter: replaySeason.rawAfter,
      displayedDelta: replaySeason.displayedDelta,
      displayed99: replaySeason.displayed99,
      peakRaw: replayed.peakRaw,
      everDisplayed99: replayed.everDisplayed99,
    };
    writeJson(WITNESS_INDEX_PATH, index);
    claim.expected = entry.expected;
  }

  const savedForValidation = process.env.UPDATE_WITNESS_CLAIMS === "1" ? replayed : witness;
  const validation = validateWitnessClaim(claim, savedForValidation, replayed);
  return {
    ...replayed,
    witnessSource: candidate,
    snapshotFiles,
    claim,
    validation,
    matchedDisplayed99: Boolean(replayed.everDisplayed99),
    matchedPeakRaw: replayed.peakRaw
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }
  if (args.mode === "assess") {
    if (!args.dir) throw new Error("--mode assess requires --dir <run-directory>");
    const assessment = assessRun(resolve(ROOT, args.dir));
    console.log(JSON.stringify({ ok: assessment.ok, gates: assessment.gates }, null, 2));
    if (!assessment.ok) process.exitCode = 1;
    return;
  }
  if (args.mode === "witness-replay") {
    let replay;
    try {
      replay = replayWitness(args);
    } catch (error) {
      console.log(JSON.stringify({ ok: false, reason: error.message, witness: args.witness }, null, 2));
      process.exitCode = 1;
      return;
    }
    const validation = replay.validation || { ok: false, reason: "missing validation", errors: ["missing validation"] };
    const season = validation.season || null;
    const summary = {
      witness: args.witness,
      careerId: replay.id ?? null,
      expectedCareerId: replay.claim?.expected?.careerId ?? null,
      seed: replay.manifest?.seed ?? null,
      policy: replay.policy ?? null,
      index: replay.manifest?.index ?? null,
      seasonNumber: season?.seasonNumber ?? null,
      rawBefore: season?.rawBefore ?? null,
      rawAfter: season?.rawAfter ?? null,
      displayedDelta: season?.displayedDelta ?? null,
      displayed99: season?.displayed99 ?? null,
      peakRaw: replay.peakRaw ?? null,
      everDisplayed99: replay.everDisplayed99 ?? null,
      witnessSource: replay.witnessSource ?? null,
    };
    if (replay.blocked || !validation.ok) {
      console.log(JSON.stringify({
        ok: false,
        reason: validation.reason || replay.blocked?.reason || "witness validation failed",
        errors: validation.errors || [],
        blocked: replay.blocked || null,
        ...summary,
      }, null, 2));
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
    return;
  }

  const plan = JSON.parse(readFileSync(PLAN_PATH, "utf8"));
  void JSON.parse(readFileSync(TARGETS_PATH, "utf8"));
  const runDir = makeRunDirectory(args.label);
  const startedAt = new Date().toISOString();
  const trajectories = [];
  let controlled = {};
  const careers = [];
  let paired = [];

  const trajectoryCount =
    args.n ?? (args.mode === "pilot" ? plan.cohorts.pilot.trajectories : args.mode === "holdout" ? plan.cohorts.holdoutTrajectories : plan.cohorts.syntheticTrajectories);
  if (["pilot", "trajectories", "full", "holdout"].includes(args.mode)) {
    const root = args.mode === "holdout" ? plan.seedDeclarations.holdout.root : plan.seedDeclarations.calibration.root;
    for (let i = 0; i < trajectoryCount; i++) {
      const seed =
        args.mode === "holdout"
          ? plan.seedDeclarations.holdout.precommittedRange.startInclusive + i
          : hashSeed(`${root}:${i}`);
      const row = runTrajectory(seed, { cohort: args.mode === "holdout" ? "holdout" : "calibration" });
      trajectories.push(row);
      writeJson(join(runDir, "trajectories", `${row.id}.json`), row);
    }
  }

  if (["pilot", "controlled", "full"].includes(args.mode)) {
    controlled = runControlled(plan.seedDeclarations.calibration.root, args.n ?? (args.mode === "pilot" ? 10 : 250));
    writeJson(join(runDir, "controlled.json"), controlled);
  }

  if (["pilot", "full-careers", "full"].includes(args.mode)) {
    const careerCount = args.n ?? (args.mode === "pilot" ? plan.cohorts.pilot.careers : plan.cohorts.fullCareers.total);
    for (let i = 0; i < careerCount; i++) {
      let careerPolicy = args.policy;
      let cohort = "natural-mixed";
      if (args.mode === "full" && args.n == null) {
        if (i < plan.cohorts.fullCareers.mixedDefault) {
          careerPolicy = "mixed-default";
        } else if (i < plan.cohorts.fullCareers.mixedDefault + plan.cohorts.fullCareers.appropriateMinutesLoan) {
          careerPolicy = "appropriate-minutes-loan";
          cohort = "natural-appropriate-minutes-loan";
        } else {
          careerPolicy = "mixed-default";
          cohort = "controlled-start-stress";
        }
      }
      const seed = hashSeed(`${plan.seedDeclarations.naturalCareers.root}:${careerPolicy}:${cohort}:${i}`);
      const row = runNaturalCareer(i, seed, careerPolicy, cohort);
      row.manifest.index = i;
      careers.push(row);
      writeJson(join(runDir, "careers", `${safeLabel(row.id)}.json`), row);
      for (const witness of row.witnesses) {
        writeJson(join(runDir, "witnesses", `${safeLabel(witness.id)}.json`), {
          kind: "natural-witness",
          id: witness.id,
          policy: row.policy,
          manifest: row.manifest,
          event: witness,
          careerFile: `../careers/${safeLabel(row.id)}.json`
        });
      }
    }
  }

  if (args.mode === "paired-engine-side") {
    const pairCount = args.n ?? Math.min(24, plan.cohorts.pairedCareers);
    const sideCareers = runPairedEngineSideCareers(plan.seedDeclarations.paired.root, pairCount);
    for (const row of sideCareers) {
      careers.push(row);
      writeJson(join(runDir, "careers", `${safeLabel(row.id)}.json`), row);
    }
    writeJson(join(runDir, "paired", "manifest.json"), {
      kind: "paired-engine-side",
      engineIdentity: process.env.FIX11_ENGINE_IDENTITY || gitRevision(),
      naturalCareerCount: sideCareers.length,
      sourceRevision: gitRevision(),
    });
  }

  if (["pilot", "paired", "full"].includes(args.mode)) {
    const pairCount = args.n ?? (args.mode === "pilot" ? plan.cohorts.pilot.paired : Math.min(24, plan.cohorts.pairedCareers));
    paired = runPaired(plan.seedDeclarations.paired.root, pairCount);
    writeJson(join(runDir, "paired", "manifest.json"), {
      note: paired.note,
      environmentYearCount: paired.environmentYear.length,
      naturalCareerCount: paired.naturalCareers.length,
      sourceRevision: gitRevision(),
      historicalIdentityControl: true,
    });
    for (const row of paired.environmentYear) writeJson(join(runDir, "paired", `${row.id}.json`), row);
    for (const row of paired.naturalCareers) writeJson(join(runDir, "paired", `${row.id}.json`), row);
  }

  const summary = aggregateSummary({ args, runDir, trajectories, controlled, careers, paired, startedAt });
  const assessment = assessRun(runDir);
  summary.assessment = { ok: assessment.ok, gates: assessment.gates };
  writeJson(join(runDir, "summary.json"), summary);
  console.log(JSON.stringify({
    ok: assessment.ok,
    run: basename(runDir),
    counts: summary.counts,
    checks: summary.checks,
    blockers: summary.blockers
  }, null, 2));
  if (!assessment.ok) process.exitCode = 1;
}

const launchedAsScript = process.argv[1] && String(process.argv[1]).endsWith("calibrateFullCareerGrowth.mjs");
if (launchedAsScript) {
  try {
    main();
  } catch (error) {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
  }
}
