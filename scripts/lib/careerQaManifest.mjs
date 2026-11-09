import { createRng, hashSeed } from "../../js/simulation/rng.js";
import { WORLD_CUP_NATIONS } from "../../js/data/worldCupNations.js";

export const CAREER_QA_POLICY_VERSION = "r2-03-career-qa-v1";
export const POSITIONS = ["ST", "LW", "RW", "CAM", "LM", "CM", "RM", "CDM", "LB", "CB", "RB", "GK"];
export const AGES = [15, 16, 17, 18, 19];
export const PATH_STYLES = ["loyal", "ambitious", "journeyman", "loan-heavy", "mixed"];
export const START_YEAR = 2026;

const NATIONS = WORLD_CUP_NATIONS.map((n) => n.name).filter(Boolean);

function requireFiniteInt(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return n;
}

/** Stable zero-based input row for one career. Drawn before any simulation. */
export function buildManifestRow(rootSeed, index, { maxAge = 42 } = {}) {
  const i = requireFiniteInt(index, "index");
  if (i < 0) throw new Error(`Invalid index: ${i}`);
  const seedRoot = requireFiniteInt(rootSeed, "seed");
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

export function buildManifest(rootSeed, n, { maxAge = 42 } = {}) {
  const count = requireFiniteInt(n, "n");
  if (count < 1) throw new Error(`Invalid n: ${count}`);
  const seed = requireFiniteInt(rootSeed, "seed");
  const rows = [];
  const seen = new Set();
  for (let i = 0; i < count; i++) {
    const row = buildManifestRow(seed, i, { maxAge });
    if (seen.has(row.rowKey)) throw new Error(`Duplicate manifest row key: ${row.rowKey}`);
    seen.add(row.rowKey);
    rows.push(row);
  }
  return {
    schemaVersion: CAREER_QA_POLICY_VERSION,
    seed,
    n: count,
    maxAge,
    generatedFor: "qaCareerOutcomes",
    rows,
  };
}

export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object") throw new Error("Manifest must be an object");
  if (!Array.isArray(manifest.rows) || !manifest.rows.length) {
    throw new Error("Manifest rows must be a non-empty array");
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
    for (const key of ["name", "nationality", "position", "careerId", "pathStyle", "policyId"]) {
      if (!row[key]) throw new Error(`Manifest row ${row.index} missing ${key}`);
    }
    if (!Number.isInteger(row.age) || row.age < 15 || row.age > 19) {
      throw new Error(`Manifest row ${row.index} has invalid age: ${row.age}`);
    }
    if (!row.seeds || typeof row.seeds !== "object") {
      throw new Error(`Manifest row ${row.index} missing seeds`);
    }
    for (const key of ["world", "academy", "policy", "opening", "retirement"]) {
      if (!Number.isFinite(Number(row.seeds[key]))) {
        throw new Error(`Manifest row ${row.index} missing seed ${key}`);
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
