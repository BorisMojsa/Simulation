import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRng } from "../../js/simulation/rng.js";

export const FIX11_SCHEMA_VERSION = "fix11-growth-v1";
export const EPSILON = 1e-6;

export function percentile(values, p) {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const q = Math.max(0, Math.min(1, Number(p)));
  const index = (sorted.length - 1) * q;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  return sorted[low] * (high - index) + sorted[high] * (index - low);
}

export function summarize(values) {
  const finite = values.filter(Number.isFinite);
  const rounded = (value) => (value == null ? null : Number(value.toFixed(4)));
  return {
    n: finite.length,
    min: finite.length ? Math.min(...finite) : null,
    mean: rounded(finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null),
    median: rounded(percentile(finite, 0.5)),
    p10: rounded(percentile(finite, 0.1)),
    p90: rounded(percentile(finite, 0.9)),
    p95: rounded(percentile(finite, 0.95)),
    p99: rounded(percentile(finite, 0.99)),
    max: finite.length ? Math.max(...finite) : null
  };
}

export function displayedOverall(raw) {
  return Number.isFinite(raw) ? Math.round(raw) : null;
}

export function isDisplayed99(raw) {
  return Number.isFinite(raw) && Math.round(raw) === 99;
}

export function isRaw99(raw) {
  return Number.isFinite(raw) && raw >= 99;
}

export function displayedGain(before, after) {
  const a = displayedOverall(before);
  const b = displayedOverall(after);
  return a == null || b == null ? null : b - a;
}

export function reconcileGrossPositive(result, tolerance = EPSILON) {
  const components = result?.components || {};
  const grossPositive =
    Math.max(0, Number(components.learning) || 0) +
    Math.max(0, Number(components.recognition) || 0) +
    Math.max(0, Number(components.positiveShock) || 0);
  const receipt = Number(result?.breakdown?.annualAllowanceUsed);
  const difference = Number.isFinite(receipt) ? receipt - grossPositive : null;
  return {
    ok: difference != null && Math.abs(difference) <= tolerance,
    grossPositive,
    receipt: Number.isFinite(receipt) ? receipt : null,
    difference
  };
}

/** Clone both pieces of paired state at the treatment boundary. */
export function clonePlayerForPairing(player, rngOrState) {
  const rngState =
    typeof rngOrState?.seed === "function"
      ? rngOrState.seed()
      : Number(rngOrState);
  if (!Number.isFinite(rngState)) {
    throw new Error("clonePlayerForPairing requires a finite RNG state");
  }
  return {
    player: structuredClone(player),
    rng: createRng(rngState),
    rngState
  };
}

export function validateDriverSeasonResult(result, startSeasonCount, endSeasonCount) {
  if (result?.awaitingScenario || result?.awaitingDecision || result?.pendingContractReview) {
    return { ok: false, reason: "pending-season-not-completed" };
  }
  if (!result?.season) {
    return { ok: false, reason: "null-season-not-completed" };
  }
  if (!(endSeasonCount > startSeasonCount)) {
    return { ok: false, reason: "season-payload-without-history-advance" };
  }
  return { ok: true };
}

export function validateDriverGuard(guard, maxIterations = 100) {
  return guard >= maxIterations
    ? { ok: false, reason: "season-drain-guard-exhausted" }
    : { ok: true };
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function sourceHashes(root = resolve(new URL("../..", import.meta.url).pathname)) {
  const files = {
    targets: "reports/fix11-calibration-targets.json",
    plan: "qa/fix11-runs/plan.json",
    developmentConfig: "js/config/playerDevelopmentConfig.js",
    developmentModel: "js/simulation/playerDevelopmentModel.js",
    academyOpening: "js/simulation/academyOpening.js",
    academyLifecycle: "js/simulation/academyLifecycle.js",
    seasonSimulator: "js/simulation/seasonSimulator.js",
    driver: "scripts/calibrateFullCareerGrowth.mjs"
  };
  return Object.fromEntries(
    Object.entries(files).map(([key, relative]) => {
      const absolute = join(root, relative);
      return [key, existsSync(absolute) ? sha256File(absolute) : null];
    })
  );
}

function gate(id, ok, detail, kind = "hard") {
  return { id, kind, ok: Boolean(ok), detail };
}

export function assessRun(dir) {
  const summaryPath = join(resolve(dir), "summary.json");
  if (!existsSync(summaryPath)) {
    return {
      ok: false,
      gates: [gate("summary-present", false, `Missing ${summaryPath}`)]
    };
  }

  let summary;
  try {
    summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      gates: [gate("summary-valid-json", false, String(error?.message || error))]
    };
  }

  const checks = summary.checks || {};
  const counts = summary.counts || {};
  const requiredHashes = [
    "targets", "plan", "developmentConfig", "developmentModel",
    "academyOpening", "academyLifecycle", "seasonSimulator", "driver"
  ];
  const packageComplete =
    typeof summary.mode === "string" &&
    requiredHashes.every((key) => typeof summary.hashes?.[key] === "string" && summary.hashes[key].length === 64) &&
    ["trajectories", "controlledRows", "careersRequested", "careersCompleted", "paired", "blocked"]
      .every((key) => Number.isInteger(counts[key]) && counts[key] >= 0) &&
    typeof checks.finiteValues === "boolean" &&
    ["reconciliationFailures", "ordinaryCapFailures", "breakthroughCapFailures", "falseCompletions"]
      .every((key) => Number.isInteger(checks[key]) && checks[key] >= 0);
  const gates = [
    gate("schema", summary.schemaVersion === FIX11_SCHEMA_VERSION, summary.schemaVersion),
    gate("package-complete", packageComplete, packageComplete ? "complete" : "required fields or source hashes missing"),
    gate("finite-values", checks.finiteValues !== false, checks.finiteValues),
    gate("gross-positive-reconciles", (checks.reconciliationFailures || 0) === 0, checks.reconciliationFailures),
    gate("ordinary-cap-8", (checks.ordinaryCapFailures || 0) === 0, checks.ordinaryCapFailures),
    gate("breakthrough-cap-9", (checks.breakthroughCapFailures || 0) === 0, checks.breakthroughCapFailures),
    gate("no-false-completions", (checks.falseCompletions || 0) === 0, checks.falseCompletions),
    gate("requested-work-completed", (counts.blocked || 0) === 0, counts.blocked)
  ];

  const natural = summary.naturalCareers || {};
  if ((natural.completed || 0) >= 100) {
    gates.push(
      gate(
        "displayed-99-before-25-rarity",
        (natural.displayed99Before25Rate || 0) < 0.01,
        natural.displayed99Before25Rate,
        "rarity"
      ),
      gate(
        "ever-displayed-99-rarity",
        (natural.everDisplayed99Rate || 0) <= 0.011,
        natural.everDisplayed99Rate,
        "rarity"
      )
    );
  } else {
    gates.push(
      gate(
        "rarity-sample-size",
        true,
        `Not evaluated: ${natural.completed || 0} natural careers; requires at least 100.`,
        "informational"
      )
    );
  }

  return {
    ok: gates.filter((item) => item.kind !== "informational").every((item) => item.ok),
    gates,
    summary
  };
}
