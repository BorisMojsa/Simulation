/**
 * Build club strength profiles from checked-in ClubElo / FootballDatabase snapshots.
 * Deterministic. Offline after snapshots are present — no network.
 *
 *   node scripts/buildClubStrengthDb.mjs
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import LEAGUE_DEFINITIONS from "../league-data.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const RAW = path.join(ROOT, "js/data/strength/raw");
const CONFIG = path.join(ROOT, "js/data/strength/config");
const OUT = path.join(ROOT, "js/data/strength/clubProfiles.generated.js");
const MATCH_REPORT = path.join(ROOT, "reports/strength-matching-report.json");
const COVERAGE_REPORT = path.join(ROOT, "reports/strength-coverage-report.json");
const AUDIT = path.join(ROOT, "reports/strength-audit-initial.json");
const CALIBRATION_REPORT = path.join(ROOT, "reports/strength-calibration-report.json");

const PRIMARY_CLUB_SNAPSHOT = "clubelo-public-ranking-2026-10-08";
const SCHEMA_VERSION = 3;

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function normalizeLight(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/đ/g, "d")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/amp;/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function associationId(nation) {
  return `assoc:${normalizeLight(nation).replace(/\s+/g, "-")}`;
}

function leagueId(leagueName) {
  return `league:${normalizeLight(leagueName).replace(/\s+/g, "-")}`;
}

function clubIdFor(name, nation) {
  return `club:${normalizeLight(nation).replace(/\s+/g, "-")}:${normalizeLight(name).replace(/\s+/g, "-")}`;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function round2(v) {
  return Math.round(Number(v) * 100) / 100;
}

function sha256Json(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const transform = readJson(path.join(CONFIG, "transform.json"));
const calibration = readJson(path.join(CONFIG, "fdbToClubEloCalibration.json"));
const identityMappings = readJson(path.join(CONFIG, "clubeloIdentityMappings.json"));
const clubEloSnap = readJson(path.join(RAW, "clubelo_public_ranking_2026-10-08.json"));
const fdbSnap = readJson(path.join(RAW, "footballdatabase_gap5_2026-10-04.json"));
const pairsSnap = readJson(path.join(RAW, "cross_provider_anchor_pairs_2026-10.json"));

function clubEloToGameQuality(elo) {
  const { intercept, slope, clipMin, clipMax } = transform.clubEloToTeamQuality;
  return round2(clamp(intercept + slope * Number(elo), clipMin, clipMax));
}

function positionalNeutral(overall) {
  const q = round2(overall);
  return {
    attack: q,
    midfield: q,
    defence: q,
    goalkeeper: q,
    breakdownEstimated: true,
    breakdownMethod: transform.subratings.method,
    componentDerivationStatus: "derived_neutral",
  };
}

function replacementByPosition(overall) {
  const starter = Math.round(overall - 4);
  const mk = (d) => Math.round(clamp(starter + d, 40, 92));
  return {
    GK: mk(-1),
    CB: mk(0),
    RB: mk(-1),
    LB: mk(-1),
    CDM: mk(0),
    CM: mk(0),
    CAM: mk(1),
    RM: mk(0),
    LM: mk(0),
    RW: mk(1),
    LW: mk(1),
    ST: mk(2),
  };
}

function fdbToClubElo(points, country) {
  const pred =
    calibration.intercept +
    calibration.slope * Number(points) +
    (calibration.countryOffsets[country] || 0);
  return Math.round(pred);
}

// --- Inventory game clubs ---
const gameClubs = [];
for (const league of LEAGUE_DEFINITIONS) {
  const confederation = ["Brazil", "Argentina", "Colombia", "Ecuador"].includes(league.nation)
    ? "CONMEBOL"
    : ["Mexico", "United States"].includes(league.nation)
      ? "CONCACAF"
      : "UEFA";
  league.clubs.forEach((club, index) => {
    const name = club.name;
    const displayName = club.displayName ?? club.name;
    gameClubs.push({
      clubId: clubIdFor(name, league.nation),
      name,
      displayName,
      nation: league.nation,
      leagueName: league.name,
      leagueId: leagueId(league.name),
      associationId: associationId(league.nation),
      confederation,
      divisionLevel: /Championship|2\. Bundesliga|LaLiga 2|Serie B|Ligue 2/i.test(league.name)
        ? 2
        : 1,
      index,
      leagueSize: league.clubs.length,
      financialPower: league.financialPower ?? 2,
    });
  });
}

if (gameClubs.length !== 490) {
  throw new Error(`Expected 490 game clubs, got ${gameClubs.length}`);
}

const byId = new Map(gameClubs.map((c) => [c.clubId, c]));

// Integrity: raw hashes
const clubEloHash = sha256Json(clubEloSnap.observations);
if (clubEloHash !== clubEloSnap.contentHash) {
  throw new Error("ClubElo snapshot contentHash mismatch");
}
const fdbHash = sha256Json(fdbSnap.observations);
if (fdbHash !== fdbSnap.contentHash) {
  throw new Error("FootballDatabase snapshot contentHash mismatch");
}
const pairsHash = sha256Json(pairsSnap.pairs);
if (pairsHash !== pairsSnap.contentHash) {
  throw new Error("Anchor pairs contentHash mismatch");
}

const matchReport = {
  acceptedPrimary: [],
  acceptedSecondaryCalibrated: [],
  unmatched: [],
  duplicates: [],
  identityChecks: {
    existing35Resolved: identityMappings.existing35.length,
    specialCases: identityMappings.specialCases.length,
  },
};

const selected = new Map();

for (const obs of clubEloSnap.observations) {
  if (!byId.has(obs.clubId)) {
    matchReport.unmatched.push({ clubId: obs.clubId, reason: "clubId_not_in_game_inventory", provider: "ClubElo" });
    continue;
  }
  if (selected.has(obs.clubId)) {
    matchReport.duplicates.push({ clubId: obs.clubId, provider: "ClubElo" });
    continue;
  }
  if (obs.providerProvisional === true) {
    matchReport.unmatched.push({
      clubId: obs.clubId,
      reason: "provider_provisional_row_not_selected",
      provider: "ClubElo",
    });
    continue;
  }
  selected.set(obs.clubId, {
    kind: "primary",
    obs,
    primaryScaleRating: obs.rawRating,
    ratingSourceStatus: "verified_rating",
    strengthDerivationStatus: "normalized_from_published_rating",
  });
  matchReport.acceptedPrimary.push({
    clubId: obs.clubId,
    providerName: obs.providerName,
    rawRating: obs.rawRating,
  });
}

if (!calibration.acceptance?.accepted) {
  throw new Error("FDB→ClubElo calibration is not accepted; refusing secondary conversion");
}

for (const obs of fdbSnap.observations) {
  if (!byId.has(obs.clubId)) {
    matchReport.unmatched.push({
      clubId: obs.clubId,
      reason: "clubId_not_in_game_inventory",
      provider: "FootballDatabase",
    });
    continue;
  }
  if (selected.has(obs.clubId)) {
    matchReport.duplicates.push({ clubId: obs.clubId, provider: "FootballDatabase" });
    continue;
  }
  const predicted = fdbToClubElo(obs.rawRating, obs.country);
  const targetMeta = calibration.targets.find((t) => t.clubId === obs.clubId);
  if (!targetMeta?.withinAcceptanceRange || predicted < 1000 || predicted > 2200) {
    matchReport.unmatched.push({
      clubId: obs.clubId,
      reason: "unresolved_conversion",
      provider: "FootballDatabase",
      predictedClubElo: predicted,
    });
    continue;
  }
  selected.set(obs.clubId, {
    kind: "secondary_calibrated",
    obs,
    primaryScaleRating: predicted,
    secondaryRawRating: obs.rawRating,
    ratingSourceStatus: "verified_rating",
    strengthDerivationStatus: "calibrated_from_published_rating",
    calibrationId: calibration.calibrationId,
  });
  matchReport.acceptedSecondaryCalibrated.push({
    clubId: obs.clubId,
    footballDatabasePoints: obs.rawRating,
    calibratedClubElo: predicted,
  });
}

const missing = gameClubs.filter((c) => !selected.has(c.clubId));
if (missing.length) {
  throw new Error(
    `Missing baselines for ${missing.length} clubs: ${missing
      .slice(0, 8)
      .map((m) => m.clubId)
      .join(", ")}`
  );
}
if (selected.size !== 490) {
  throw new Error(`Expected 490 selected baselines, got ${selected.size}`);
}

const ALIASES = {
  "AFC Bournemouth": ["Bournemouth"],
  "Brighton & Hove Albion": ["Brighton"],
  "Wolverhampton Wanderers": ["Wolves"],
  PSV: ["PSV Eindhoven"],
  "FC Barcelona": ["Barcelona"],
  "Atlético Madrid": ["Atletico Madrid", "Atletico de Madrid", "Atlético de Madrid"],
  "Inter Milan": ["Inter", "Internazionale"],
  "Bayern Munich": ["Bayern München"],
  "West Ham United": ["West Ham"],
  "Leeds United": ["Leeds"],
  "AC Milan": ["Milan"],
  "Athletic Bilbao": ["Athletic Club"],
  "NEC Nijmegen": ["NEC", "Nijmegen"],
  "Wisła Płock": ["Plock", "Wisla Plock"],
};

const profiles = [];
const aliasIndex = {};

for (const club of gameClubs) {
  const sel = selected.get(club.clubId);
  const obs = sel.obs;
  const sourceRating = obs.rawRating;
  const primaryScaleRating = sel.primaryScaleRating;
  const overall = clubEloToGameQuality(primaryScaleRating);
  const pos = positionalNeutral(overall);
  const aliases = new Set([club.name, club.displayName]);
  for (const [canonical, list] of Object.entries(ALIASES)) {
    if (normalizeLight(canonical) === normalizeLight(club.name) || normalizeLight(canonical) === normalizeLight(club.displayName)) {
      aliases.add(canonical);
      list.forEach((a) => aliases.add(a));
    }
  }

  const isPrimary = sel.kind === "primary";
  const provenance = {
    clubId: club.clubId,
    provider: obs.provider,
    providerTeamId: obs.providerCode ?? null,
    providerName: obs.providerName,
    rawRating: sourceRating,
    rawRatingScale: obs.rawRatingScale,
    primaryScaleRating,
    primaryScale: "club_elo",
    providerProvisional: obs.providerProvisional,
    ratingAsOfDate: obs.ratingAsOfDate,
    publicationDate: obs.publishedAsOfDate,
    retrievedAt: obs.retrievedOn,
    sourceUrl: obs.sourceUrl,
    sourceLocator: obs.sourceLocator,
    evidenceRef: obs.matchMethod,
    identityEvidenceUrls: obs.identityEvidenceUrls || [],
    selectionNote: obs.selectionNote || null,
    sourceSnapshotId: obs.snapshotId,
    transformVersion: transform.transformVersion,
    calibrationId: sel.calibrationId || null,
    ratingSourceStatus: sel.ratingSourceStatus,
    strengthDerivationStatus: sel.strengthDerivationStatus,
    parserVersion: isPrimary ? clubEloSnap.parserVersion : fdbSnap.parserVersion,
    mappingVersion: isPrimary ? clubEloSnap.mappingVersion : fdbSnap.mappingVersion,
    contentHash: isPrimary ? clubEloSnap.contentHash : fdbSnap.contentHash,
  };

  const profile = {
    clubId: club.clubId,
    name: club.name,
    displayName: club.displayName,
    aliases: [...aliases].filter((a) => a && a !== club.name),
    associationId: club.associationId,
    nation: club.nation,
    confederation: club.confederation,
    leagueId: club.leagueId,
    leagueName: club.leagueName,
    divisionLevel: club.divisionLevel,
    sourceRating,
    sourceScale: isPrimary ? "club_elo" : "footballdatabase_points",
    primaryScaleRating,
    primaryScale: "club_elo",
    overall,
    ...pos,
    replacementOvr: replacementByPosition(overall),
    replacementOvrMethod: transform.replacementOvr.method,
    depth: round2(clamp(overall - 6, 28, 90)),
    financialPower: clamp(Math.round(club.financialPower), 1, 5),
    reputation: round2(clamp(overall * 0.85 + club.financialPower * 2.5, 25, 98)),
    sourceType: sel.ratingSourceStatus,
    sourceStatus: sel.ratingSourceStatus,
    ratingSourceStatus: sel.ratingSourceStatus,
    strengthDerivationStatus: sel.strengthDerivationStatus,
    confidence: isPrimary ? "medium" : "medium_low",
    snapshotDate: obs.publishedAsOfDate,
    ratingAsOfDate: obs.ratingAsOfDate,
    publicationDate: obs.publishedAsOfDate,
    retrievedAt: obs.retrievedOn,
    sourceSnapshotId: obs.snapshotId,
    sourceUrls: obs.sourceUrl ? [obs.sourceUrl] : [],
    evidenceRef: obs.matchMethod,
    provider: obs.provider,
    providerName: obs.providerName,
    providerTeamId: obs.providerCode ?? null,
    providerProvisional: obs.providerProvisional,
    transformVersion: transform.transformVersion,
    calibrationId: sel.calibrationId || null,
    baselineSnapshotId: PRIMARY_CLUB_SNAPSHOT,
    notes: isPrimary
      ? "ClubElo display Elo imported as primary baseline; team quality via clubEloToTeamQuality; subratings/replacement OVR are derived model parameters."
      : `FootballDatabase points ${sourceRating} converted to ClubElo ${primaryScaleRating} via ${calibration.calibrationId}; not a ClubElo publication.`,
    provenance,
  };

  profiles.push(profile);

  for (const a of aliases) {
    for (const key of new Set([normalizeLight(a)].filter(Boolean))) {
      const soft = key
        .replace(/\b(fc|cf|afc|sc|ac|as|ssc|rcd|ud|cd|fk|nk|sk|bk|if|sv|tsv|vfb|vfl|fsv|1)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      for (const k of new Set([key, soft].filter(Boolean))) {
        if (aliasIndex[k] && aliasIndex[k] !== club.clubId) {
          aliasIndex[k] = `__ambiguous__:${aliasIndex[k]}|${club.clubId}`;
        } else if (!String(aliasIndex[k] || "").startsWith("__ambiguous__")) {
          aliasIndex[k] = club.clubId;
        }
      }
      aliasIndex[`${normalizeLight(club.nation)}::${soft}`] = club.clubId;
    }
  }
}

profiles.sort((a, b) => a.clubId.localeCompare(b.clubId));

// Sanity
const city = profiles.find((p) => p.name === "Manchester City");
const hull = profiles.find((p) => p.name === "Hull City");
if (!city || !hull || city.overall - hull.overall < 8) {
  throw new Error(`City/Hull spread failed: ${city?.overall} vs ${hull?.overall}`);
}
const primaryCount = profiles.filter((p) => p.strengthDerivationStatus === "normalized_from_published_rating").length;
const calibratedCount = profiles.filter((p) => p.strengthDerivationStatus === "calibrated_from_published_rating").length;
if (primaryCount !== 485) throw new Error(`Expected 485 primary ClubElo baselines, got ${primaryCount}`);
if (calibratedCount !== 5) throw new Error(`Expected 5 calibrated baselines, got ${calibratedCount}`);

// Raw values must match snapshots exactly (secondary raw is FDB; primaryScale is calibrated)
for (const p of profiles) {
  if (p.provider === "ClubElo") {
    const obs = clubEloSnap.observations.find((o) => o.clubId === p.clubId);
    if (!obs || obs.rawRating !== p.sourceRating) {
      throw new Error(`ClubElo raw altered for ${p.clubId}`);
    }
  } else if (p.provider === "FootballDatabase") {
    const obs = fdbSnap.observations.find((o) => o.clubId === p.clubId);
    if (!obs || obs.rawRating !== p.sourceRating) {
      throw new Error(`FDB raw altered for ${p.clubId}`);
    }
    if (p.primaryScaleRating !== fdbToClubElo(obs.rawRating, obs.country)) {
      throw new Error(`Calibrated Elo altered for ${p.clubId}`);
    }
  } else {
    throw new Error(`Unexpected provider ${p.provider}`);
  }
}

// Forbidden estimate methods must not appear
for (const p of profiles) {
  const method = p.provenance?.estimateMethod;
  if (
    method &&
    [
      "configured_league_center_prior",
      "single_league_anchor_below",
      "league_verified_anchor_below_min",
    ].includes(method)
  ) {
    throw new Error(`Forbidden estimate method on ${p.clubId}: ${method}`);
  }
}

const file = `/* AUTO-GENERATED by scripts/buildClubStrengthDb.mjs — do not hand-edit */
export const CLUB_STRENGTH_SCHEMA_VERSION = ${SCHEMA_VERSION};
export const CLUB_STRENGTH_SNAPSHOT_DATE = ${JSON.stringify(clubEloSnap.publicationDate)};
export const CLUB_STRENGTH_BASELINE_SNAPSHOT_ID = ${JSON.stringify(PRIMARY_CLUB_SNAPSHOT)};
export const CLUB_STRENGTH_TRANSFORM_VERSION = ${JSON.stringify(transform.transformVersion)};
export const CLUB_STRENGTH_CALIBRATION_ID = ${JSON.stringify(calibration.calibrationId)};
export const CLUB_PROFILES = ${JSON.stringify(profiles, null, 2)};
export const CLUB_ALIAS_INDEX = ${JSON.stringify(aliasIndex, null, 2)};
`;

fs.writeFileSync(OUT, file);

const byLeague = {};
for (const p of profiles) {
  if (!byLeague[p.leagueName]) {
    byLeague[p.leagueName] = {
      total: 0,
      club_elo_primary: 0,
      footballdatabase_calibrated: 0,
      verified_rating: 0,
      results_derived: 0,
      unresolved: 0,
    };
  }
  byLeague[p.leagueName].total += 1;
  byLeague[p.leagueName].verified_rating += 1;
  if (p.strengthDerivationStatus === "normalized_from_published_rating") {
    byLeague[p.leagueName].club_elo_primary += 1;
  } else if (p.strengthDerivationStatus === "calibrated_from_published_rating") {
    byLeague[p.leagueName].footballdatabase_calibrated += 1;
  }
}

const coverage = {
  generatedAt: "2026-10-08",
  clubTotal: profiles.length,
  leagues: 26,
  countries: 21,
  ratingSourceStatus: {
    verified_rating: profiles.filter((p) => p.ratingSourceStatus === "verified_rating").length,
    results_derived: 0,
    unresolved: 0,
  },
  strengthDerivationStatus: {
    normalized_from_published_rating: primaryCount,
    calibrated_from_published_rating: calibratedCount,
    results_derived: 0,
    unresolved_conversion: 0,
  },
  // Backward-compatible counters (all new baselines have published observations)
  verified_rating: profiles.filter((p) => p.sourceStatus === "verified_rating").length,
  manual_estimate: 0,
  provisional_estimate: 0,
  baselineSnapshotId: PRIMARY_CLUB_SNAPSHOT,
  transformVersion: transform.transformVersion,
  calibrationId: calibration.calibrationId,
  byLeague,
  providerCounts: {
    ClubElo: primaryCount,
    FootballDatabase: calibratedCount,
  },
  sourceAccessLimitations: [
    "ClubElo values are a structured transcription of publicly rendered country ranking tables (2026-10-08), not an official bulk API export.",
    "Five clubs use FootballDatabase points (updated after matches on 2026-10-04) converted via fdb-to-clubelo-regularized-country-v1.",
    "Archived Opta snapshots retained for provenance only; not mixed into new-career ClubElo baselines.",
    "No 35-season historical results archive was ingested; results_derived count is zero.",
    "National-team ratings are out of scope for this club snapshot.",
  ],
  unresolvedClubs: [],
  inventoryReconciliation: {
    expectedClubs: 490,
    researchPackGapIds: 455,
    additionalPrimaryNamesResolved: 35,
    additions: [],
    removals: [],
    note: "All 455 uploaded gap IDs present unchanged; 35 additional names resolved uniquely to existing clubIds; union covers every game club once.",
  },
};

fs.mkdirSync(path.dirname(MATCH_REPORT), { recursive: true });
fs.writeFileSync(MATCH_REPORT, JSON.stringify(matchReport, null, 2));
fs.writeFileSync(COVERAGE_REPORT, JSON.stringify(coverage, null, 2));
fs.writeFileSync(
  CALIBRATION_REPORT,
  JSON.stringify(
    {
      generatedAt: "2026-10-08",
      calibrationId: calibration.calibrationId,
      contentHash: calibration.contentHash,
      acceptance: calibration.acceptance,
      heldOutDiagnostics: calibration.heldOutDiagnostics,
      targets: calibration.targets,
      clubEloToTeamQuality: transform.clubEloToTeamQuality,
    },
    null,
    2
  )
);
fs.writeFileSync(
  AUDIT,
  JSON.stringify(
    {
      auditedAt: "2026-10-08",
      priorClaim: {
        verified_rating: 35,
        provisional_estimate: 455,
        note: "Prior rebuild used Opta top tables + league-centre priors.",
      },
      afterRebuild: {
        clubEloPrimary: primaryCount,
        footballDatabaseCalibrated: calibratedCount,
        provisional_estimate: 0,
        results_derived: 0,
        unresolved: 0,
      },
      providerMigration: {
        from: "opta-public-top30-spursweb-2026-06-06 (+ league priors)",
        to: PRIMARY_CLUB_SNAPSHOT,
        archivedOptaKept: true,
      },
    },
    null,
    2
  )
);

console.log(`Wrote ${profiles.length} profiles → ${OUT}`);
console.log(`ClubElo primary: ${primaryCount}; FDB calibrated: ${calibratedCount}`);
console.log(
  `Manchester City ${city.overall} (Elo ${city.primaryScaleRating}) vs Hull ${hull.overall} (Elo ${hull.primaryScaleRating})`
);
