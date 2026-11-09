import { roundAbilityForDisplay } from "../../js/ui/abilityFormatting.js";
import { CAREER_QA_POLICY_VERSION } from "./careerQaManifest.mjs";

function finite(nums) {
  return (nums || []).filter((n) => Number.isFinite(n));
}

export function percentile(values, p) {
  const sorted = [...finite(values)].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const q = Math.max(0, Math.min(1, Number(p)));
  const index = (sorted.length - 1) * q;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  return sorted[low] * (high - index) + sorted[high] * (index - low);
}

export function summarize(values) {
  const xs = finite(values);
  return {
    n: xs.length,
    min: xs.length ? Math.min(...xs) : null,
    mean: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null,
    p10: percentile(xs, 0.1),
    median: percentile(xs, 0.5),
    p90: percentile(xs, 0.9),
    max: xs.length ? Math.max(...xs) : null,
  };
}

function countBy(rows, keyFn) {
  const out = Object.create(null);
  for (const row of rows) {
    const key = keyFn(row);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function isCompleted(record) {
  return record?.end?.endReason === "engine-retirement" || record?.end?.endReason === "policy-age-cutoff";
}

function isSigned(record) {
  return record?.ratings?.firstProStatus === "signed" && record?.ratings?.firstPro != null;
}

/** Strip operational timestamps for equality comparisons. */
export function canonicalCareerRecord(record) {
  const clone = structuredClone(record);
  delete clone.runtime;
  delete clone.generatedAt;
  delete clone.deterministicClockEnd;
  delete clone.deterministicClockSeed;
  return clone;
}

export function aggregateCareers(records, meta = {}) {
  const all = records || [];
  const completed = all.filter(isCompleted);
  const signed = all.filter(isSigned);
  const unsigned = all.filter((r) => !isSigned(r));
  const incomplete = all.filter((r) => r.incomplete || !isCompleted(r));

  const firstProCurrent = signed.map((r) => r.ratings.firstPro.current);
  const firstProBase = signed.map((r) => r.ratings.firstPro.base);
  const firstProDesk = signed.map((r) => r.ratings.firstPro.desk);
  const peakCurrent = completed.map((r) => r.ratings?.peakCurrent?.value).filter(Number.isFinite);
  const peakBase = completed.map((r) => r.ratings?.peakBase?.value).filter(Number.isFinite);
  const finalCurrent = completed.map((r) => r.ratings?.finalCurrent).filter(Number.isFinite);
  const finalBase = completed.map((r) => r.ratings?.finalBase).filter(Number.isFinite);

  const deskPeaks = completed
    .map((r) => {
      const v = r.ratings?.peakBase?.value ?? r.ratings?.peakCurrent?.value;
      return Number.isFinite(v) ? roundAbilityForDisplay(v) : null;
    })
    .filter(Number.isFinite);

  const firstPro80to81 = firstProDesk.filter((d) => d === 80 || d === 81).length;
  const peak90 = peakCurrent.filter((v) => v >= 90).length;
  const peak95 = peakCurrent.filter((v) => v >= 95).length;
  const desk99 = deskPeaks.filter((d) => d === 99).length;
  const lowerTailPeak = peakCurrent.filter((v) => v < 70).length;

  const endReasons = countBy(all, (r) => r.end?.endReason || "unknown");

  return {
    schemaVersion: CAREER_QA_POLICY_VERSION,
    meta: {
      ...meta,
      percentileDefinition: "nearest-rank on sorted finite values at index floor((n-1)*p); ties keep raw precision until presentation",
      thresholdOvrBasis: {
        firstPro80to81: "displayed desk OVR from base (roundAbilityForDisplay)",
        peak90and95: "raw current peak",
        desk99: "displayed OVR from peak base (fallback peak current)",
        oldCurrentPeakConvention: "ratings.peakRatingCurrentConvention / peakCurrent.value",
      },
      denominators: {
        all: all.length,
        completed: completed.length,
        signed: signed.length,
        unsigned: unsigned.length,
        incomplete: incomplete.length,
      },
    },
    composition: {
      startAge: countBy(all, (r) => String(r.startAge ?? r.input?.age)),
      nationality: countBy(all, (r) => r.nationality || r.input?.nationality),
      position: countBy(all, (r) => r.position || r.input?.position),
      policy: countBy(all, (r) => r.pathStyle || r.input?.pathStyle),
    },
    firstPro: {
      signed: signed.length,
      unsigned: unsigned.length,
      current: summarize(firstProCurrent),
      base: summarize(firstProBase),
      desk: summarize(firstProDesk),
      starts80to81: { numerator: firstPro80to81, denominator: signed.length },
    },
    peaks: {
      completedDenominator: completed.length,
      current: summarize(peakCurrent),
      base: summarize(peakBase),
      below70: { numerator: lowerTailPeak, denominator: completed.length },
      at90plus: { numerator: peak90, denominator: completed.length },
      at95plus: { numerator: peak95, denominator: completed.length },
      desk99: { numerator: desk99, denominator: completed.length },
    },
    finals: {
      completedDenominator: completed.length,
      current: summarize(finalCurrent),
      base: summarize(finalBase),
    },
    endReasons,
    unsignedCount: unsigned.length,
    incompleteCount: incomplete.length,
    calibrationReferences: {
      avgFirstProTarget: "68-69",
      rareFirstPro80to81: true,
      avgPeakTarget: "83-84",
      about40of200at90plus: true,
      rareDesk99: true,
    },
  };
}

export function toHumanSummary(summary, meta) {
  const lines = [
    `# Career QA summary`,
    ``,
    `SHA: ${meta?.testedSha || "—"}`,
    `Seed: ${meta?.seed ?? "—"} · n: ${meta?.n ?? summary?.meta?.denominators?.all ?? "—"} · maxAge: ${meta?.maxAge ?? "—"}`,
    `Completed: ${summary.meta.denominators.completed} · Signed: ${summary.meta.denominators.signed} · Incomplete: ${summary.meta.denominators.incomplete}`,
    ``,
    `## First-pro OVR (signed)`,
    `- mean current: ${summary.firstPro.current.mean}`,
    `- mean desk: ${summary.firstPro.desk.mean}`,
    `- 80–81 desk starts: ${summary.firstPro.starts80to81.numerator}/${summary.firstPro.starts80to81.denominator}`,
    ``,
    `## Peaks (completed)`,
    `- mean current peak: ${summary.peaks.current.mean}`,
    `- 90+: ${summary.peaks.at90plus.numerator}/${summary.peaks.at90plus.denominator}`,
    `- 95+: ${summary.peaks.at95plus.numerator}/${summary.peaks.at95plus.denominator}`,
    `- desk 99: ${summary.peaks.desk99.numerator}/${summary.peaks.desk99.denominator}`,
    ``,
    `## End reasons`,
    ...Object.entries(summary.endReasons || {}).map(([k, v]) => `- ${k}: ${v}`),
    ``,
    `Rerun: ${meta?.rerunCommand || "—"}`,
  ];
  return lines.join("\n");
}

/** Field-path diffs for two career records (canonicalized). */
export function diffCareerRecords(a, b, prefix = "") {
  const ca = canonicalCareerRecord(a);
  const cb = canonicalCareerRecord(b);
  const diffs = [];
  const walk = (left, right, path) => {
    if (Object.is(left, right)) return;
    if (left && right && typeof left === "object" && typeof right === "object" && !Array.isArray(left) && !Array.isArray(right)) {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
      for (const key of keys) walk(left[key], right[key], path ? `${path}.${key}` : key);
      return;
    }
    if (Array.isArray(left) && Array.isArray(right)) {
      const n = Math.max(left.length, right.length);
      for (let i = 0; i < n; i++) walk(left[i], right[i], `${path}[${i}]`);
      return;
    }
    diffs.push({ path: path || prefix || "$", left, right });
  };
  walk(ca, cb, prefix);
  return diffs;
}
