import { createRng, hashSeed } from "../../js/simulation/rng.js";
import { WORLD_CUP_NATIONS } from "../../js/data/worldCupNations.js";

export const CAREER_QA_POLICY_VERSION = "r2-03-career-qa-v2";
export const POSITIONS = ["ST", "LW", "RW", "CAM", "LM", "CM", "RM", "CDM", "LB", "CB", "RB", "GK"];
export const AGES = [15, 16, 17, 18, 19];
export const PATH_STYLES = ["loyal", "ambitious", "journeyman", "loan-heavy", "mixed"];
export const OPENING_PATHS = ["interactive", "skip"];
export const START_YEAR = 2026;

const NATIONS = WORLD_CUP_NATIONS.map((n) => n.name).filter(Boolean);

function requireFiniteInt(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return n;
}

function requireOpeningPath(value, label = "openingPath") {
  if (!OPENING_PATHS.includes(value)) {
    throw new Error(`Invalid ${label}: ${value} (expected ${OPENING_PATHS.join("|")})`);
  }
  return value;
}

function requirePolicyId(value, label = "policyId") {
  if (!PATH_STYLES.includes(value)) {
    throw new Error(`Unknown ${label}/policy: ${value}`);
  }
  return value;
}

/** Stable zero-based input row for one career. Drawn before any simulation. */
export function buildManifestRow(rootSeed, index, { maxAge = 42, openingPath = "interactive" } = {}) {
  const i = requireFiniteInt(index, "index");
  if (i < 0) throw new Error(`Invalid index: ${i}`);
  const seedRoot = requireFiniteInt(rootSeed, "seed");
  const opening = requireOpeningPath(openingPath);
  const setupSeed = hashSeed(`${seedRoot}:setup:${i}`);
  const setupRng = createRng(setupSeed);
  const position = setupRng.pick(POSITIONS);
  const age = setupRng.pick(AGES);
  const nationality = setupRng.pick(NATIONS);
  const pathStyle = setupRng.pick(PATH_STYLES);
  const name = `Career${i}_${position}`;
  const careerId = `cid_${hashSeed(`${name}|${nationality}|${position}|${age}`).toString(16)}`;
  const worldSeed = hashSeed(`${seedRoot}:world:${i}:${careerId}`);
  const academySeed = hashSeed(`${seedRoot}:academy:${i}:${careerId}:${age}`);
  const policySeed = hashSeed(`${seedRoot}:policy:${i}:${pathStyle}`);
  const openingSeed = hashSeed(`${seedRoot}:opening:${i}:${careerId}`);
  const retirementSeed = hashSeed(`${seedRoot}:retire:${i}:${careerId}`);
  for (const [label, seed] of Object.entries({
    setup: setupSeed,
    world: worldSeed,
    academy: academySeed,
    policy: policySeed,
    opening: openingSeed,
    retirement: retirementSeed,
  })) {
    if (!Number.isFinite(seed) || !Number.isInteger(seed)) {
      throw new Error(`Invalid derived seed ${label}: ${seed}`);
    }
  }
  return {
    index: i,
    rowKey: `row:${seedRoot}:${i}`,
    name,
    nationality,
    age,
    position,
    careerId,
    pathStyle,
    policyId: pathStyle,
    policyVersion: CAREER_QA_POLICY_VERSION,
    openingPath: opening,
    startYear: START_YEAR,
    maxAge,
    seedRoot,
    seeds: {
      setup: setupSeed,
      world: worldSeed,
      academy: academySeed,
      policy: policySeed,
      opening: openingSeed,
      retirement: retirementSeed,
    },
  };
}

export function buildManifest(rootSeed, n, { maxAge = 42, openingPath = "interactive" } = {}) {
  const count = requireFiniteInt(n, "n");
  if (count < 1) throw new Error(`Invalid n: ${count}`);
  const seed = requireFiniteInt(rootSeed, "seed");
  const opening = requireOpeningPath(openingPath);
  const rows = [];
  const seen = new Set();
  for (let i = 0; i < count; i++) {
    const row = buildManifestRow(seed, i, { maxAge, openingPath: opening });
    if (seen.has(row.rowKey)) throw new Error(`Duplicate manifest row key: ${row.rowKey}`);
    seen.add(row.rowKey);
    rows.push(row);
  }
  return {
    schemaVersion: CAREER_QA_POLICY_VERSION,
    seed,
    n: count,
    maxAge,
    openingPath: opening,
    generatedFor: "qaCareerOutcomes",
    rows,
  };
}

export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object") throw new Error("Manifest must be an object");
  if (manifest.schemaVersion !== CAREER_QA_POLICY_VERSION) {
    throw new Error(
      `Unknown/unsupported manifest schemaVersion: ${manifest.schemaVersion} (expected ${CAREER_QA_POLICY_VERSION})`
    );
  }
  if (!OPENING_PATHS.includes(manifest.openingPath)) {
    throw new Error(`Invalid manifest openingPath: ${manifest.openingPath}`);
  }
  if (!Number.isInteger(manifest.seed)) throw new Error(`Invalid manifest seed: ${manifest.seed}`);
  if (!Number.isInteger(manifest.n) || manifest.n < 1) throw new Error(`Invalid manifest n: ${manifest.n}`);
  if (!Number.isInteger(manifest.maxAge) || manifest.maxAge < 20) {
    throw new Error(`Invalid manifest maxAge: ${manifest.maxAge}`);
  }
  if (!Array.isArray(manifest.rows) || !manifest.rows.length) {
    throw new Error("Manifest rows must be a non-empty array");
  }
  if (manifest.rows.length !== manifest.n) {
    throw new Error(`Manifest n=${manifest.n} but rows.length=${manifest.rows.length}`);
  }
  const seenKeys = new Set();
  const seenIndexes = new Set();
  for (const row of manifest.rows) {
    if (row == null || typeof row !== "object") throw new Error("Manifest row must be an object");
    if (!Number.isInteger(row.index) || row.index < 0) throw new Error(`Invalid row.index: ${row.index}`);
    if (seenIndexes.has(row.index)) throw new Error(`Duplicate manifest index: ${row.index}`);
    seenIndexes.add(row.index);
    if (!row.rowKey) throw new Error(`Missing rowKey for index ${row.index}`);
    if (seenKeys.has(row.rowKey)) throw new Error(`Duplicate rowKey: ${row.rowKey}`);
    seenKeys.add(row.rowKey);
    for (const key of ["name", "nationality", "position", "careerId", "pathStyle", "policyId", "openingPath"]) {
      if (!row[key]) throw new Error(`Manifest row ${row.index} missing ${key}`);
    }
    requirePolicyId(row.policyId, `row ${row.index} policyId`);
    requirePolicyId(row.pathStyle, `row ${row.index} pathStyle`);
    requireOpeningPath(row.openingPath, `row ${row.index} openingPath`);
    if (row.openingPath !== manifest.openingPath) {
      throw new Error(
        `Manifest row ${row.index} openingPath ${row.openingPath} conflicts with manifest openingPath ${manifest.openingPath}`
      );
    }
    if (row.policyVersion && row.policyVersion !== CAREER_QA_POLICY_VERSION) {
      throw new Error(`Unknown policyVersion on row ${row.index}: ${row.policyVersion}`);
    }
    if (!Number.isInteger(row.age) || row.age < 15 || row.age > 19) {
      throw new Error(`Manifest row ${row.index} has invalid age: ${row.age}`);
    }
    if (!row.seeds || typeof row.seeds !== "object") {
      throw new Error(`Manifest row ${row.index} missing seeds`);
    }
    for (const key of ["world", "academy", "policy", "opening", "retirement"]) {
      const seed = Number(row.seeds[key]);
      if (!Number.isFinite(seed) || !Number.isInteger(seed)) {
        throw new Error(`Manifest row ${row.index} invalid seed ${key}: ${row.seeds[key]}`);
      }
    }
  }
  return manifest;
}

export function selectManifestRows(manifest, careerIndex = null) {
  validateManifest(manifest);
  if (careerIndex == null || careerIndex === "") return [...manifest.rows];
  const idx = requireFiniteInt(careerIndex, "career-index");
  const row = manifest.rows.find((r) => r.index === idx);
  if (!row) throw new Error(`Unknown career-index ${idx} (manifest has ${manifest.rows.length} rows)`);
  return [row];
}

export function resolveOpeningOverride(manifestOpening, cliOpening) {
  if (cliOpening == null || cliOpening === "") return requireOpeningPath(manifestOpening);
  const cli = requireOpeningPath(cliOpening, "--opening");
  if (cli !== manifestOpening) {
    throw new Error(`Conflicting opening override: --opening ${cli} vs manifest ${manifestOpening}`);
  }
  return cli;
}
