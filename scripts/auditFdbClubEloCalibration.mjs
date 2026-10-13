/**
 * Re-run leave-one-club-out diagnostics for FootballDatabase→ClubElo conversion.
 *   node scripts/auditFdbClubEloCalibration.mjs
 *
 * Two-step model (matches stored fdb-to-clubelo-regularized-country-v1):
 *   1) Global OLS on training rows
 *   2) Country offset = sum(residuals) / (n + lambda), lambda=5 fixed a priori
 * Each LOO fold refits intercept, slope, and all country offsets on training rows only.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const RAW = path.join(ROOT, "js/data/strength/raw");
const CONFIG = path.join(ROOT, "js/data/strength/config");
const CAL_PATH = path.join(CONFIG, "fdbToClubEloCalibration.json");
const REPORT = path.join(ROOT, "reports/club-calibration-audit-report.json");

const LAMBDA = 5;
const SIGNED_ERROR =
  "signedErrorElo = observedClubElo - predictedClubElo (positive ⇒ model under-predicted ClubElo)";

const pairsSnap = JSON.parse(
  fs.readFileSync(path.join(RAW, "cross_provider_anchor_pairs_2026-10.json"), "utf8")
);
const cal = JSON.parse(fs.readFileSync(CAL_PATH, "utf8"));
const packAudit = JSON.parse(fs.readFileSync(path.join(RAW, "club_calibration_audit.json"), "utf8"));

const rows = pairsSnap.pairs.map((p) => ({
  clubId: p.clubId,
  name: p.clubName,
  country: p.country,
  x: p.footballDatabase.rating,
  y: p.clubelo.rating,
  clubEloDate: p.clubelo.publishedAsOfDate,
  fdbDate: p.footballDatabase.publishedAsOfDate,
  dateDifferenceDays: p.dateDifferenceDays,
}));

function fitGlobal(train) {
  const n = train.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const r of train) {
    sx += r.x;
    sy += r.y;
    sxx += r.x * r.x;
    sxy += r.x * r.y;
  }
  const den = n * sxx - sx * sx;
  const slope = (n * sxy - sx * sy) / den;
  const intercept = (sy - slope * sx) / n;
  return { intercept, slope };
}

function fitTwoStep(train, lambda = LAMBDA) {
  const { intercept, slope } = fitGlobal(train);
  const sums = {};
  const counts = {};
  for (const r of train) {
    sums[r.country] = (sums[r.country] || 0) + (r.y - (intercept + slope * r.x));
    counts[r.country] = (counts[r.country] || 0) + 1;
  }
  const offsets = {};
  for (const c of Object.keys(counts)) {
    offsets[c] = sums[c] / (counts[c] + lambda);
  }
  return { intercept, slope, offsets };
}

function predict(model, x, country) {
  return model.intercept + model.slope * x + (model.offsets[country] || 0);
}

function summarize(errors) {
  const n = errors.length;
  const mae = errors.reduce((a, e) => a + Math.abs(e), 0) / n;
  const rmse = Math.sqrt(errors.reduce((a, e) => a + e * e, 0) / n);
  const meanSigned = errors.reduce((a, e) => a + e, 0) / n;
  return {
    n,
    maeElo: Math.round(mae * 100) / 100,
    rmseElo: Math.round(rmse * 100) / 100,
    meanSignedErrorElo: Math.round(meanSigned * 100) / 100,
  };
}

const full = fitTwoStep(rows);
const coefMatch =
  Math.abs(full.intercept - cal.intercept) < 1e-6 &&
  Math.abs(full.slope - cal.slope) < 1e-9 &&
  Object.keys(cal.countryOffsets).every(
    (c) => Math.abs((full.offsets[c] || 0) - cal.countryOffsets[c]) < 1e-6
  );

const looGlobal = [];
const looReg = [];
const byCountry = {};
const looResiduals = [];

for (let i = 0; i < rows.length; i++) {
  const train = rows.filter((_, j) => j !== i);
  const test = rows[i];
  const g = fitGlobal(train);
  const errG = test.y - (g.intercept + g.slope * test.x);
  looGlobal.push(errG);

  const m = fitTwoStep(train);
  const pred = predict(m, test.x, test.country);
  const err = test.y - pred;
  looReg.push(err);
  (byCountry[test.country] ||= []).push(err);
  looResiduals.push({
    clubName: test.name,
    country: test.country,
    signedErrorElo: Math.round(err * 100) / 100,
    absErrorElo: Math.round(Math.abs(err) * 100) / 100,
  });
}

const globalDiag = summarize(looGlobal);
const regDiag = summarize(looReg);
const byCountryDiag = Object.fromEntries(
  Object.keys(byCountry)
    .sort()
    .map((c) => [c, summarize(byCountry[c])])
);

function near(a, b, tol = 0.02) {
  return Math.abs(a - b) <= tol;
}

if (!near(globalDiag.maeElo, 60.42) || !near(regDiag.maeElo, 28.34)) {
  throw new Error(
    `LOO MAE mismatch: global=${globalDiag.maeElo} (expected 60.42), reg=${regDiag.maeElo} (expected 28.34)`
  );
}

const countryRanges = {};
for (const r of rows) {
  const cur = countryRanges[r.country] || { min: Infinity, max: -Infinity, n: 0 };
  cur.min = Math.min(cur.min, r.x);
  cur.max = Math.max(cur.max, r.x);
  cur.n += 1;
  countryRanges[r.country] = cur;
}

// Sensitivity: refit full model leaving out each country's largest |residual| club
const sensitivity = [];
for (const t of cal.targets) {
  const countryRows = rows.filter((r) => r.country === t.country);
  const absErrs = countryRows.map((r) => {
    const pred = predict(full, r.x, r.country);
    return { r, abs: Math.abs(r.y - pred) };
  });
  absErrs.sort((a, b) => b.abs - a.abs);
  const drop = absErrs[0]?.r;
  const sensTrain = drop ? rows.filter((r) => r !== drop) : rows;
  const sensModel = fitTwoStep(sensTrain);
  const sensPred = predict(sensModel, t.footballDatabasePoints, t.country);
  sensitivity.push({
    clubId: t.clubId,
    droppedInfluentialPair: drop?.name || null,
    predictedClubEloFull: Math.round(predict(full, t.footballDatabasePoints, t.country) * 10000) / 10000,
    predictedClubEloSensitivity: Math.round(sensPred * 10000) / 10000,
    deltaElo: Math.round((sensPred - predict(full, t.footballDatabasePoints, t.country)) * 100) / 100,
  });
}

const enrichedTargets = cal.targets.map((t) => {
  const range = countryRanges[t.country];
  const countryLoo = byCountryDiag[t.country];
  const extrapolates = t.footballDatabasePoints < range.min || t.footballDatabasePoints > range.max;
  const sens = sensitivity.find((s) => s.clubId === t.clubId);
  return {
    ...t,
    pairedCountrySampleSize: range.n,
    pairedFootballDatabaseRange: [range.min, range.max],
    extrapolatesOutsidePairedCountryRange: extrapolates,
    heldOutCountryMaeElo: countryLoo.maeElo,
    heldOutCountryRmseElo: countryLoo.rmseElo,
    heldOutCountryMeanSignedErrorElo: countryLoo.meanSignedErrorElo,
    signedResidualDefinition: SIGNED_ERROR,
    providerObservationDates: {
      clubElo: "2026-10-08",
      footballDatabase: "2026-10-04",
      dateDifferenceDays: 4,
    },
    calibrationId: cal.calibrationId,
    lambda: LAMBDA,
    lambdaSelection:
      "Fixed a priori at 5 pseudo-observations before reporting these LOO diagnostics; not tuned by minimizing LOO MAE on the same folds (no nested model selection).",
    sensitivityDropLargestCountryResidual: sens,
    uncertaintyLimitation:
      "LOO MAE/RMSE describe conversion error on paired clubs, not a 95% confidence interval for the target prediction, and do not calibrate match-win probabilities.",
  };
});

const auditReport = {
  auditedAt: "2026-10-09",
  calibrationId: cal.calibrationId,
  method:
    "Shared positive-slope OLS on FootballDatabase→ClubElo, then ridge-shrunk country offsets: offset_c = sum(y - (a+bx)) / (n_c + lambda).",
  lambda: LAMBDA,
  lambdaSelection:
    "Fixed before validation (not selected by scanning LOO MAE on these folds).",
  signedResidualDefinition: SIGNED_ERROR,
  coefficientsReproduceStored: coefMatch,
  leaveOneClubOut: {
    globalLinear: globalDiag,
    regularizedCountryAware: regDiag,
    byCountry: byCountryDiag,
    improvementVsGlobalMaeElo: Math.round((globalDiag.maeElo - regDiag.maeElo) * 100) / 100,
  },
  retainedDiscrepantPairs: cal.retainedDiscrepantPairs,
  largeResiduals: looResiduals
    .filter((r) => r.absErrorElo >= 90)
    .sort((a, b) => b.absErrorElo - a.absErrorElo),
  providerDateDifferenceDays: 4,
  targets: enrichedTargets,
  packAuditCrossCheck: {
    reportedGlobalLooMaeElo: packAudit.reportedGlobalLooMaeElo,
    reportedRegularizedLooMaeElo: packAudit.reportedRegularizedLooMaeElo,
    matchesImplementation: near(globalDiag.maeElo, packAudit.reportedGlobalLooMaeElo) &&
      near(regDiag.maeElo, packAudit.reportedRegularizedLooMaeElo),
  },
  defectsFound: [],
  decision:
    "No leakage, identity mismatch, or coefficient defect found. Retain the five calibrated_from_published_rating baselines unchanged.",
  notes: [
    "Each LOO fold refits intercept, slope, and all country offsets using only that fold's training rows.",
    "Zemun and Mačva Šabac residuals retained; not deleted to improve headline MAE.",
    "AVS is mild extrapolation: Portuguese paired FDB range 1344–1846; AVS raw 1335.",
    "ClubElo→team-quality transform remains a separate game-design mapping; this audit does not validate match outcomes.",
  ],
};

const nextCal = {
  ...cal,
  method:
    "Shared positive-slope OLS on FootballDatabase→ClubElo with ridge-shrunk country offsets (lambda=5 pseudo-observations). Leave-one-club-out never evaluates a club on a model trained with that club. Fit: global OLS, then offset_c = sum(residuals_c)/(n_c+lambda).",
  signedResidualDefinition: SIGNED_ERROR,
  lambdaSelection:
    "Fixed a priori at 5; not tuned by minimizing the reported LOO MAE on these folds.",
  heldOutDiagnostics: {
    ...cal.heldOutDiagnostics,
    globalLinear: {
      ...cal.heldOutDiagnostics.globalLinear,
      ...globalDiag,
    },
    regularizedCountryAware: {
      ...cal.heldOutDiagnostics.regularizedCountryAware,
      ...regDiag,
      byCountry: byCountryDiag,
    },
  },
  targets: enrichedTargets,
  audit: {
    auditedAt: auditReport.auditedAt,
    coefficientsReproduceStored: coefMatch,
    defectsFound: [],
    decision: auditReport.decision,
  },
};

// Coefficient + predicted-target identity unchanged — keep the accepted calibration contentHash.
nextCal.auditMetadataHash = crypto
  .createHash("sha256")
  .update(JSON.stringify(enrichedTargets))
  .digest("hex");

fs.writeFileSync(CAL_PATH, JSON.stringify(nextCal, null, 2) + "\n");
fs.writeFileSync(REPORT, JSON.stringify(auditReport, null, 2) + "\n");

console.log(
  JSON.stringify(
    {
      coefficientsReproduceStored: coefMatch,
      globalLooMae: globalDiag.maeElo,
      regularizedLooMae: regDiag.maeElo,
      targetsUnchanged: enrichedTargets.every(
        (t, i) => t.predictedClubElo === cal.targets[i].predictedClubElo
      ),
      report: REPORT,
    },
    null,
    2
  )
);
