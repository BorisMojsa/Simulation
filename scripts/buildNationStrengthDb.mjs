/**
 * Build national-team strength profiles from the checked-in secondary FIFA inventory.
 *   node scripts/buildNationStrengthDb.mjs
 *
 * Offline only. Fails on missing IDs, duplicates, invalid confederations, or bad points.
 * Does not assign gameplay priors or interpolate rank→points.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { WORLD_CUP_NATIONS } from "../js/data/worldCupNations.js";
import { NATION_CONFEDERATION } from "../js/data/internationalCalendar.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const RAW = path.join(ROOT, "js/data/strength/raw");
const CONFIG = path.join(ROOT, "js/data/strength/config");
const OUT = path.join(ROOT, "js/data/strength/nationProfiles.generated.js");
const COVERAGE = path.join(ROOT, "reports/nation-strength-coverage-report.json");

const VALID_CONFEDERATIONS = new Set(["UEFA", "CAF", "CONMEBOL", "CONCACAF", "AFC", "OFC"]);
const EXPECTED_CONFED_COUNTS = { UEFA: 31, CAF: 15, CONCACAF: 10, CONMEBOL: 10, AFC: 12, OFC: 1 };

const transform = JSON.parse(fs.readFileSync(path.join(CONFIG, "transform.json"), "utf8"));
const selectedPack = JSON.parse(fs.readFileSync(path.join(RAW, "nation_observations_79.json"), "utf8"));
const identityMaps = JSON.parse(fs.readFileSync(path.join(CONFIG, "nation_identity_mappings.json"), "utf8"));
const discrepancies = JSON.parse(fs.readFileSync(path.join(RAW, "source_discrepancies.json"), "utf8"));
const sourceManifest = JSON.parse(fs.readFileSync(path.join(RAW, "source_manifest.json"), "utf8"));
const replacements = JSON.parse(fs.readFileSync(path.join(RAW, "nation_replacements_59.json"), "utf8"));

const DATASET_ID = selectedPack.datasetId;
const RANKING_EDITION = selectedPack.rankingEditionDate;

function fail(message) {
  throw new Error(`[buildNationStrengthDb] ${message}`);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function round2(v) {
  return Math.round(Number(v) * 100) / 100;
}

/** Full-precision quality before display rounding — monotonic over observed FIFA range. */
function fifaPointsToTeamQuality(points) {
  const p = Number(points);
  if (!Number.isFinite(p)) fail(`non-finite FIFA points: ${points}`);
  return clamp(28 + (p - 800) * 0.055, 40, 93);
}

function replacementOvr(overall) {
  const base = Math.round(overall - 3);
  const mk = (d) => Math.max(45, Math.min(92, base + d));
  return {
    GK: mk(0),
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

function sha256Stable(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function inventoryNames() {
  return WORLD_CUP_NATIONS.map((n) => n.name).sort();
}

const inventory = inventoryNames();
if (inventory.length !== 79) {
  fail(`Expected 79 inventory nations from WORLD_CUP_NATIONS + registry, got ${inventory.length}`);
}

const observations = selectedPack.nations;
if (!Array.isArray(observations) || observations.length !== 79) {
  fail(`Expected 79 selected observations, got ${observations?.length}`);
}

const byId = new Map();
for (const obs of observations) {
  if (byId.has(obs.nationId)) fail(`Duplicate nationId ${obs.nationId}`);
  byId.set(obs.nationId, obs);
}

const mapById = new Map(identityMaps.mappings.map((m) => [m.nationId, m]));
if (mapById.size !== 79) fail(`Expected 79 identity mappings, got ${mapById.size}`);

const discrepancyById = new Map((discrepancies.items || []).map((d) => [d.nationId, d]));
const replacementIds = new Set((replacements.nations || []).map((n) => n.nationId));

const semanticPayload = observations
  .map((o) => ({
    nationId: o.nationId,
    fifaPoints: o.fifaPoints,
    fifaRank: o.fifaRank,
    confederation: o.confederation,
    ratingAsOfDate: o.ratingAsOfDate,
    sourceEvidenceTier: o.sourceEvidenceTier,
    evidenceSourceIds: o.evidenceSourceIds,
    agreeingPointSourceIds: o.agreeingPointSourceIds,
    evidenceConflictStatus: o.evidenceConflictStatus,
  }))
  .sort((a, b) => a.nationId.localeCompare(b.nationId));
const contentHash = sha256Stable(semanticPayload);

const profiles = [];
const nationRows = [];
const confCounts = { UEFA: 0, CAF: 0, CONMEBOL: 0, CONCACAF: 0, AFC: 0, OFC: 0 };

for (const name of inventory) {
  const obs = [...byId.values()].find((o) => o.name === name);
  if (!obs) fail(`No selected observation for inventory nation "${name}"`);

  const ident = mapById.get(obs.nationId);
  if (!ident) fail(`Missing identity mapping for ${obs.nationId}`);
  if (ident.canonicalName !== name) fail(`Identity canonical mismatch for ${name}`);

  const registryConf = NATION_CONFEDERATION[name];
  if (!registryConf) fail(`NATION_CONFEDERATION missing ${name}`);
  if (registryConf !== obs.confederation || registryConf !== ident.confederation) {
    fail(
      `Confederation mismatch for ${name}: registry=${registryConf} obs=${obs.confederation} map=${ident.confederation}`
    );
  }
  if (!VALID_CONFEDERATIONS.has(obs.confederation)) {
    fail(`Invalid confederation ${obs.confederation} for ${name}`);
  }
  if (obs.ratingAsOfDate !== RANKING_EDITION || obs.rankingEditionDate !== RANKING_EDITION) {
    fail(`Edition mismatch for ${name}`);
  }
  if (!Number.isFinite(obs.fifaPoints) || obs.fifaPoints <= 0) {
    fail(`Invalid points for ${name}: ${obs.fifaPoints}`);
  }
  if (obs.fifaPointsDecimal !== obs.fifaPoints.toFixed(2)) {
    fail(`Decimal precision mismatch for ${name}`);
  }
  if (obs.sourceEvidenceTier !== "corroborated_secondary") {
    fail(`Unexpected evidence tier for ${name}`);
  }
  if (obs.directPrimaryPointsVerified === true) {
    fail(`Pack incorrectly marked primary-verified for ${name}`);
  }
  if (obs.publicationDate != null) {
    fail(`Unsupported publicationDate for ${name}`);
  }

  confCounts[obs.confederation] += 1;

  const qualityExact = fifaPointsToTeamQuality(obs.fifaPoints);
  const q = round2(qualityExact);
  const aliases = (ident.providerAliases || []).filter((a) => a !== name);
  const disc = discrepancyById.get(obs.nationId) || null;

  const publisherIds = obs.agreeingPointSourceIds || obs.evidenceSourceIds || [];
  const publishers = publisherIds.map((id) => {
    const src = (sourceManifest.sources || []).find((s) => s.sourceId === id);
    return src?.publisher || id;
  });

  const profile = {
    nationId: obs.nationId,
    name,
    displayName: name,
    aliases,
    associationId: `assoc:${obs.nationId.replace(/^nation:/, "")}`,
    confederation: obs.confederation,
    fifaPoints: obs.fifaPoints,
    fifaRank: obs.fifaRank,
    knownRankWithoutPoints: null,
    overall: q,
    overallExact: qualityExact,
    attack: q,
    midfield: q,
    defence: q,
    goalkeeper: q,
    breakdownEstimated: true,
    breakdownMethod: transform.subratings.method,
    componentDerivationStatus: "derived_neutral",
    replacementOvr: replacementOvr(q),
    replacementOvrMethod: transform.replacementOvr.method,
    depth: round2(q - 5),
    reputation: q,
    sourceType: "published_rating",
    sourceStatus: "published_rating",
    ratingSourceStatus: "published_rating",
    strengthDerivationStatus: "normalized_from_published_rating",
    unresolvedReason: null,
    sourceEvidenceTier: obs.sourceEvidenceTier,
    directPrimaryPointsVerified: false,
    confidence: "medium",
    snapshotDate: null,
    ratingAsOfDate: obs.ratingAsOfDate,
    publicationDate: null,
    retrievedAt: obs.retrievedAt,
    sourceSnapshotId: DATASET_ID,
    datasetId: DATASET_ID,
    contentHash,
    sourceUrls: (sourceManifest.sources || [])
      .filter((s) => (obs.evidenceSourceIds || []).includes(s.sourceId))
      .map((s) => s.url),
    evidenceRef: `secondary-fifa-men-inventory79-${RANKING_EDITION}`,
    evidenceSourceIds: obs.evidenceSourceIds,
    agreeingPointSourceIds: obs.agreeingPointSourceIds,
    evidenceConflictStatus: obs.evidenceConflictStatus,
    publishers,
    originProvider: "fifa",
    provider: "fifa",
    publisher: publishers.join(", "),
    transformVersion: transform.transformVersion,
    baselineSnapshotId: DATASET_ID,
    normalizationVersion: "nation-strength-inventory79-v1",
    sourceConflict: disc
      ? {
          conflictingSource: disc.conflictingSource,
          conflictingPublishedPoints: disc.conflictingPublishedPoints,
          selectedPublishedPoints: disc.selectedPublishedPoints,
          differencePoints: disc.differencePoints,
          selectionRationale: disc.selectionRationale,
          discrepancyResolution: disc.discrepancyResolution,
        }
      : null,
    notes:
      disc != null
        ? `Selected published FIFA points ${obs.fifaPoints} (${RANKING_EDITION}) from corroborated secondary tables; Australia conflict retained (B-Empire ${disc.conflictingPublishedPoints}). Not a direct FIFA export.`
        : `Selected published FIFA points ${obs.fifaPoints} (${RANKING_EDITION}) from corroborated secondary republications (Betimate/Futbor/B-Empire). Not a direct FIFA export.`,
    tierLabel:
      q >= 88 ? "Elite" : q >= 80 ? "Strong" : q >= 70 ? "Competitive" : q >= 60 ? "Average" : "Developing",
    replacesUnresolvedBaseline: Boolean(obs.replacesUnresolvedBaseline),
    previousGameplayPointsPrior: obs.previousGameplayPointsPrior ?? null,
  };
  profiles.push(profile);

  nationRows.push({
    nationId: profile.nationId,
    name: profile.name,
    confederation: profile.confederation,
    provider: profile.provider,
    publisher: profile.publisher,
    publicationDate: profile.publicationDate,
    ratingAsOfDate: profile.ratingAsOfDate,
    retrievedAt: profile.retrievedAt,
    fifaPoints: profile.fifaPoints,
    fifaRank: profile.fifaRank,
    knownRankWithoutPoints: null,
    gameplayPointsPrior: null,
    ratingSourceStatus: profile.ratingSourceStatus,
    sourceEvidenceTier: profile.sourceEvidenceTier,
    directPrimaryPointsVerified: false,
    strengthDerivationStatus: profile.strengthDerivationStatus,
    sourceStatus: profile.sourceStatus,
    unresolvedReason: null,
    evidenceConflictStatus: profile.evidenceConflictStatus,
    replacesUnresolvedBaseline: profile.replacesUnresolvedBaseline,
  });
}

for (const [conf, expected] of Object.entries(EXPECTED_CONFED_COUNTS)) {
  if (confCounts[conf] !== expected) {
    fail(`Confederation count ${conf}: got ${confCounts[conf]}, expected ${expected}`);
  }
}

if (profiles.length !== 79) fail(`Profile count ${profiles.length}`);
if (new Set(profiles.map((p) => p.fifaPoints)).size !== 79) {
  fail("Unexpected duplicate FIFA point values across inventory");
}
if (profiles.some((p) => p.fifaPoints === 1180)) {
  fail("Provisional prior 1180 still present in production snapshot");
}
if (profiles.some((p) => p.ratingSourceStatus !== "published_rating")) {
  fail("Non-published rating status in production snapshot");
}
if (replacementIds.size !== 59) fail(`Expected 59 replacements, got ${replacementIds.size}`);
for (const id of replacementIds) {
  const p = profiles.find((x) => x.nationId === id);
  if (!p) fail(`Replacement id missing from profiles: ${id}`);
  if (!p.replacesUnresolvedBaseline) fail(`Replacement flag missing for ${id}`);
}

// Ordering check: higher points → higher or equal quality (clipping may equalize at ceiling)
const ordered = [...profiles].sort((a, b) => a.fifaPoints - b.fifaPoints);
for (let i = 1; i < ordered.length; i++) {
  if (ordered[i].overallExact + 1e-9 < ordered[i - 1].overallExact) {
    fail(
      `Non-monotonic quality: ${ordered[i - 1].name} (${ordered[i - 1].fifaPoints}) → ${ordered[i].name} (${ordered[i].fifaPoints})`
    );
  }
}

profiles.sort((a, b) => a.nationId.localeCompare(b.nationId));
nationRows.sort((a, b) => a.nationId.localeCompare(b.nationId));

const generatedAt = new Date().toISOString();

const file = `/* AUTO-GENERATED by scripts/buildNationStrengthDb.mjs — do not hand-edit */
export const NATION_STRENGTH_SCHEMA_VERSION = 4;
export const NATION_STRENGTH_SNAPSHOT_DATE = ${JSON.stringify(RANKING_EDITION)};
export const NATION_STRENGTH_BASELINE_SNAPSHOT_ID = ${JSON.stringify(DATASET_ID)};
export const NATION_STRENGTH_TRANSFORM_VERSION = ${JSON.stringify(transform.transformVersion)};
export const NATION_STRENGTH_CONTENT_HASH = ${JSON.stringify(contentHash)};
export const NATION_STRENGTH_NORMALIZATION_VERSION = "nation-strength-inventory79-v1";
export const NATION_PROFILES = ${JSON.stringify(profiles, null, 2)};
`;

fs.writeFileSync(OUT, file);

const coverage = {
  generatedAt,
  semanticIdentity: {
    datasetId: DATASET_ID,
    contentHash,
    normalizationVersion: "nation-strength-inventory79-v1",
    rankingEditionDate: RANKING_EDITION,
    retrievedAt: selectedPack.retrievedAt,
  },
  total: profiles.length,
  published_rating: profiles.length,
  corroborated_secondary: profiles.filter((p) => p.sourceEvidenceTier === "corroborated_secondary").length,
  direct_primary_verified: profiles.filter((p) => p.directPrimaryPointsVerified).length,
  verified_rating: 0,
  manual_estimate: 0,
  provisional_estimate: 0,
  unresolved: 0,
  rankKnownWithoutPoints: 0,
  formerUnresolvedPriorsReplaced: replacementIds.size,
  arbitraryPointEstimatesOrInterpolations: 0,
  gameplayPointsPriorRemaining: profiles.filter((p) => p.fifaPoints === 1180).length,
  confederationCounts: confCounts,
  confederationCorrections: [
    { nationId: "nation:hungary", confederation: "UEFA" },
    { nationId: "nation:mali", confederation: "CAF" },
    { nationId: "nation:venezuela", confederation: "CONMEBOL" },
  ],
  australiaDiscrepancy: discrepancyById.get("nation:australia") || null,
  baselineSnapshotId: DATASET_ID,
  transformVersion: transform.transformVersion,
  pointRange: [
    Math.min(...profiles.map((p) => p.fifaPoints)),
    Math.max(...profiles.map((p) => p.fifaPoints)),
  ],
  sourceAccessLimitations: [
    "Numeric points are corroborated secondary republications of the FIFA men's ranking edition labelled 2026-10-07 (Betimate, Futbor, B-Empire; Australia also FIFA Ranking Calculator).",
    "Direct official FIFA numeric export was not obtained; directPrimaryPointsVerified remains 0 for all rows.",
    "Publisher agreement is corroboration and may share an upstream feed; not proof of independence.",
    "Pack captures the application's 79-team inventory, not a complete 211-row official export.",
    "publicationDate is unknown (null); ranking edition date, retrievedAt, and report generatedAt are distinct.",
    "ATK/MID/DEF/GK and replacement OVRs are model-derived, not independently published FIFA attributes.",
  ],
  nations: nationRows,
  unresolvedNations: [],
};

fs.writeFileSync(COVERAGE, JSON.stringify(coverage, null, 2));
console.log(`Wrote ${profiles.length} nation profiles`);
console.log({
  datasetId: DATASET_ID,
  contentHash,
  published_rating: coverage.published_rating,
  formerUnresolvedPriorsReplaced: coverage.formerUnresolvedPriorsReplaced,
  direct_primary_verified: coverage.direct_primary_verified,
  confederationCounts: confCounts,
});
