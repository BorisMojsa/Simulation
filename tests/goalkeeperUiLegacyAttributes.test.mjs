/**
 * Fix 13 — Goalkeeper UI and legacy attribute repair (F01–F07).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ATTRIBUTE_MAX,
  DEVELOPMENT_MODEL_VERSION,
  GK_ATTRIBUTE_KEYS,
  OUTFIELD_ATTRIBUTE_KEYS,
  PLAYER_MODEL_VERSION,
  PREVIOUS_DEVELOPMENT_MODEL_VERSION,
} from "../js/config/playerDevelopmentConfig.js";
import { ACADEMY_POOL } from "../js/data/leagues.js";
import {
  calculateOverall,
  getDisplayAttributeKeys,
  isGoalkeeperPosition,
  refreshAbilityCaches,
  validateAttributes,
} from "../js/simulation/playerAbility.js";
import {
  createPlayerIdentity,
  finalizeAcademyPlayer,
} from "../js/simulation/playerDevelopment.js";
import {
  ensurePlayerModel,
  repairGoalkeeperAttributes,
} from "../js/simulation/playerModelMigration.js";
import {
  deserializeCareerSnapshot,
  roundTripCareerSnapshot,
  serializeCareerSnapshot,
} from "../js/simulation/careerSnapshot.js";
import { createWorldState, setWorldState } from "../js/simulation/worldState.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import { reseedCareerRng, getSimRng } from "../js/simulation/rng.js";
import {
  abilityDisplayChange,
  formatAbilityDisplayChange,
  rawAbilityEndpoints,
} from "../js/ui/abilityFormatting.js";

const GK_ORDER = [...GK_ATTRIBUTE_KEYS];

function pickAcademy() {
  const row = ACADEMY_POOL[0];
  return row.academy || row;
}

function validGkAttrs(base = 70) {
  return {
    Reflexes: base + 2.25,
    Handling: base + 1.1,
    Positioning: base - 0.4,
    Diving: base - 1.2,
    Kicking: base - 2.5,
    Physicality: base + 0.5,
  };
}

describe("F01 academy GK keys and outfield control", () => {
  it("pre-academy identity has no ratings; finalize yields exact six GK keys", () => {
    const gk = createPlayerIdentity({ name: "F01-GK", nationality: "Serbia", position: "GK", age: 16 });
    assert.equal(gk.attributes, null);
    ensurePlayerModel(gk);
    assert.equal(gk.attributes, null, "ensure must not invent pre-academy ratings");

    finalizeAcademyPlayer(gk, pickAcademy());
    const keys = getDisplayAttributeKeys(gk.position);
    assert.deepEqual(keys, GK_ORDER);
    const v = validateAttributes(gk.attributes, "GK");
    assert.equal(v.ok, true, v.errors?.join("; "));
    for (const k of keys) {
      const n = gk.attributes[k];
      assert.ok(Number.isFinite(n) && n >= 1 && n <= 99, `${k}=${n}`);
    }
    refreshAbilityCaches(gk);
    const ovr = calculateOverall(gk.attributes, "GK");
    assert.ok(Math.abs(ovr.raw - gk.baseOverallRaw) < 1e-9);
    assert.notEqual(gk.development?.migration?.gkProxy, true);

    assert.deepEqual(getDisplayAttributeKeys("Goalkeeper"), GK_ORDER);
    assert.equal(isGoalkeeperPosition("Goalkeeper"), true);

    const st = createPlayerIdentity({ name: "F01-ST", nationality: "Serbia", position: "ST", age: 16 });
    finalizeAcademyPlayer(st, pickAcademy());
    assert.deepEqual(getDisplayAttributeKeys(st.position), [...OUTFIELD_ATTRIBUTE_KEYS]);

    const before = calculateOverall(gk.attributes, "GK").raw;
    gk.attributes.Shooting = 99;
    gk.attributes.Dribbling = 11;
    const after = calculateOverall(gk.attributes, "GK").raw;
    assert.equal(after, before, "outfield leftovers must not affect GK OVR");
  });
});

describe("F02 restore complete modern and valid legacy GK", () => {
  it("preserves decimals/extras and does not mark native keepers as proxy", () => {
    const modern = {
      name: "ModernGK",
      position: "GK",
      age: 24,
      careerId: "f02-modern",
      rating: 74,
      baseOverallRaw: 74.2,
      attributes: { ...validGkAttrs(74), Speed: 33 },
      playerModelVersion: PLAYER_MODEL_VERSION,
      development: {
        modelVersion: DEVELOPMENT_MODEL_VERSION,
        migration: { version: 3, gkProxy: false },
        traits: {
          trainability: 1,
          professionalism: 0.5,
          naturalFitness: 0.5,
          resilience: 0.5,
          maturityOffsets: {},
          declineProtection: 0,
        },
      },
      careerTotals: { matches: 1, goals: 0, assists: 0, cleanSheets: 2 },
    };
    const rawReflexes = modern.attributes.Reflexes;
    const first = deserializeCareerSnapshot({ schemaVersion: 1, player: structuredClone(modern) });
    const second = deserializeCareerSnapshot({ schemaVersion: 1, player: structuredClone(modern) });
    assert.equal(first.player.attributes.Reflexes, rawReflexes);
    assert.equal(second.player.attributes.Reflexes, rawReflexes);
    assert.equal(first.player.attributes.Speed, 33);
    assert.notEqual(first.player.development?.migration?.gkProxy, true);

    const legacyValid = {
      name: "LegacyValid",
      position: "GK",
      age: 27,
      careerId: "f02-legacy",
      rating: 71,
      attributes: { ...validGkAttrs(71.3), Dribbling: 12 },
    };
    const trip = roundTripCareerSnapshot({
      player: structuredClone(legacyValid),
      world: createWorldState({ startYear: 2026 }),
    });
    assert.equal(validateAttributes(trip.player.attributes, "GK").ok, true);
    assert.equal(trip.player.attributes.Diving, legacyValid.attributes.Diving);
    assert.equal(trip.player.attributes.Dribbling, 12);

    const outfield = {
      name: "OF",
      position: "ST",
      age: 22,
      careerId: "f02-st",
      rating: 68,
      attributes: {
        Speed: 70,
        Passing: 65,
        Shooting: 72,
        Defending: 40,
        Physicality: 66,
        Dribbling: 71,
      },
    };
    const ofRestored = deserializeCareerSnapshot({ schemaVersion: 1, player: structuredClone(outfield) });
    assert.equal(ofRestored.player.attributes.Shooting, 72);
    assert.equal(ofRestored.player.rating, 68, "outfield restore must not rewrite rating");
    assert.deepEqual(ofRestored.player.attributes, outfield.attributes);

    const proxied = {
      name: "ProxyGK",
      position: "GK",
      age: 28,
      careerId: "f02-proxy",
      rating: 71,
      baseOverallRaw: 71,
      attributes: { ...validGkAttrs(71) },
      playerModelVersion: PLAYER_MODEL_VERSION,
      development: {
        modelVersion: DEVELOPMENT_MODEL_VERSION,
        migration: { version: 3, gkProxy: true },
        traits: {
          trainability: 1,
          professionalism: 0.5,
          naturalFitness: 0.5,
          resilience: 0.5,
          maturityOffsets: {},
          declineProtection: 0,
        },
      },
    };
    const proxiedRestored = deserializeCareerSnapshot({ schemaVersion: 1, player: structuredClone(proxied) });
    assert.equal(proxiedRestored.player.development.migration.gkProxy, true, "preserve existing gkProxy");
    assert.deepEqual(proxiedRestored.player.attributes, proxied.attributes);
  });
});

describe("F03 repair incomplete and stamped keepers", () => {
  it("fills only missing/invalid keys with provenance and stays idempotent", () => {
    const outfieldOnly = {
      name: "OO",
      position: "GK",
      age: 24,
      careerId: "f03-oo",
      rating: 70,
      baseOverallRaw: 70,
      attributes: {
        Speed: 60,
        Passing: 55,
        Shooting: 50,
        Defending: 65,
        Physicality: 72,
        Dribbling: 48,
      },
    };
    const r1 = repairGoalkeeperAttributes(structuredClone(outfieldOnly));
    assert.equal(r1.repaired, true);
    assert.equal(r1.player.attributes.Physicality, 72);
    assert.equal(r1.player.attributes.Speed, 60);
    assert.equal(validateAttributes(r1.player.attributes, "GK").ok, true);
    assert.equal(r1.player.development.migration.gkProxy, true);
    assert.ok(Math.abs(calculateOverall(r1.player.attributes, "GK").raw - 70) <= 0.05);

    const partial = {
      name: "Partial",
      position: "GK",
      age: 25,
      careerId: "f03-partial",
      rating: 68,
      baseOverallRaw: 68,
      attributes: { Reflexes: 75.25, Handling: null, Positioning: 66, Diving: "x", Kicking: 200, Physicality: 71 },
    };
    ensurePlayerModel(partial);
    assert.equal(partial.attributes.Reflexes, 75.25);
    assert.equal(partial.attributes.Physicality, 71);
    assert.equal(validateAttributes(partial.attributes, "GK").ok, true);
    assert.ok(partial.development.migration.gkRepair?.missingKeys?.length);

    const unreachable = {
      name: "Unreach",
      position: "GK",
      age: 26,
      careerId: "f03-unreach",
      rating: 99,
      baseOverallRaw: 99,
      attributes: { Reflexes: 50, Handling: 50, Positioning: 50, Physicality: 50 },
    };
    const u = repairGoalkeeperAttributes(unreachable);
    assert.equal(u.player.development.migration.gkRepair.unattainableDesired, true);
    assert.ok(Math.abs(calculateOverall(u.player.attributes, "GK").raw - u.reachableTarget) <= 0.05);

    const v2 = {
      name: "V2",
      position: "GK",
      age: 26,
      careerId: "f03-v2",
      rating: 64,
      playerModelVersion: 2,
      attributes: validGkAttrs(64),
      development: {
        modelVersion: PREVIOUS_DEVELOPMENT_MODEL_VERSION,
        migration: { version: 2 },
        traits: {
          trainability: 1.1,
          professionalism: 0.4,
          naturalFitness: 0.5,
          resilience: 0.6,
          maturityOffsets: { pace: 0, shooting: 0, passing: 0, defending: 0, physical: 0, mentality: 0 },
          declineProtection: 0.1,
        },
      },
    };
    const reflexes = v2.attributes.Reflexes;
    ensurePlayerModel(v2);
    assert.equal(v2.playerModelVersion, PLAYER_MODEL_VERSION);
    assert.equal(v2.attributes.Reflexes, reflexes);

    const v3bad = {
      name: "V3bad",
      position: "GK",
      age: 25,
      careerId: "f03-v3",
      rating: 68,
      baseOverallRaw: 68,
      playerModelVersion: PLAYER_MODEL_VERSION,
      attributes: {
        Reflexes: 70,
        Handling: null,
        Positioning: 66,
        Diving: Number.NaN,
        Kicking: 62,
        Physicality: 71,
      },
      development: {
        modelVersion: DEVELOPMENT_MODEL_VERSION,
        migration: { version: 3 },
        traits: {
          trainability: 1,
          professionalism: 0.5,
          naturalFitness: 0.5,
          resilience: 0.5,
          maturityOffsets: {},
          declineProtection: 0,
        },
      },
    };
    ensurePlayerModel(v3bad);
    assert.equal(v3bad.attributes.Reflexes, 70);
    assert.equal(validateAttributes(v3bad.attributes, "GK").ok, true);
    const again = ensurePlayerModel(v3bad);
    assert.equal(again.attributes.Handling, v3bad.attributes.Handling);

    // Single missing attribute and scale endpoints must land within ±0.05 OVR.
    const onlyPhys = {
      name: "OnlyPhys",
      position: "GK",
      age: 24,
      careerId: "f03-phys",
      rating: 54.9,
      baseOverallRaw: 54.9,
      attributes: {
        Reflexes: 58,
        Handling: 56,
        Positioning: 55,
        Diving: 54,
        Kicking: 50,
      },
    };
    const physRepair = repairGoalkeeperAttributes(structuredClone(onlyPhys));
    assert.equal(physRepair.reachableTarget, 54.9);
    assert.ok(
      Math.abs(calculateOverall(physRepair.player.attributes, "GK").raw - 54.9) <= 0.05,
      `single-missing Physicality ovr=${calculateOverall(physRepair.player.attributes, "GK").raw}`
    );

    const allMissing99 = {
      name: "All99",
      position: "GK",
      age: 24,
      careerId: "f03-99",
      rating: 99,
      baseOverallRaw: 99,
      attributes: { Speed: 70, Shooting: 60 },
    };
    const top = repairGoalkeeperAttributes(structuredClone(allMissing99));
    assert.equal(top.reachableTarget, 99);
    assert.ok(
      Math.abs(calculateOverall(top.player.attributes, "GK").raw - 99) <= 0.05,
      `all-missing target 99 ovr=${calculateOverall(top.player.attributes, "GK").raw}`
    );

    const allMissing1 = {
      name: "All1",
      position: "GK",
      age: 24,
      careerId: "f03-1",
      rating: 1,
      baseOverallRaw: 1,
      attributes: {},
    };
    const bottom = repairGoalkeeperAttributes(structuredClone(allMissing1));
    assert.equal(bottom.reachableTarget, 1);
    assert.ok(
      Math.abs(calculateOverall(bottom.player.attributes, "GK").raw - 1) <= 0.05,
      `all-missing target 1 ovr=${calculateOverall(bottom.player.attributes, "GK").raw}`
    );
  });
});

describe("F04 snapshot integrity and RNG stability", () => {
  it("leaves caller snapshot untouched and keeps sim RNG seed stable", () => {
    resetClubFinanceLedgers();
    const world = createWorldState({ startYear: 2026, seed: 4242 });
    setWorldState(world);
    reseedCareerRng("f04-rng");
    const seedBefore = getSimRng().seed();
    const player = {
      name: "F04",
      position: "GK",
      age: 24,
      careerId: "f04",
      rating: 70,
      baseOverallRaw: 70,
      attributes: {
        Speed: 60,
        Passing: 55,
        Shooting: 50,
        Defending: 65,
        Physicality: 72,
        Dribbling: 48,
      },
      pendingOffers: [{ id: "offer-1", clubId: "club-x" }],
      individualAwards: [{ name: "POTY" }],
      seasonCheckpoint: { seasonNumber: 3, missingGkBaseline: true },
      __fix13Marker: "keep-me",
    };
    const snap = serializeCareerSnapshot({ player, world });
    const originalJson = JSON.stringify(snap.player.attributes);
    const marker = snap.player.__fix13Marker;
    const restored = deserializeCareerSnapshot(structuredClone(snap));
    assert.equal(JSON.stringify(snap.player.attributes), originalJson);
    assert.equal(snap.player.__fix13Marker, marker);
    assert.equal(restored.player.__fix13Marker, "keep-me");
    assert.equal(restored.player.individualAwards[0].name, "POTY");
    assert.equal(restored.player.seasonCheckpoint.missingGkBaseline, true);
    assert.ok(Array.isArray(restored.player.pendingOffers));
    assert.equal(getSimRng().seed(), seedBefore);
  });
});

describe("F05 club summary attributeChanges and rounding", () => {
  it("canonical GK rows only; rounding witnesses; empty map safe", () => {
    const player = {
      position: "GK",
      attributes: { ...validGkAttrs(71), Shooting: 88, Dribbling: 12 },
    };
    const previousAttributes = { ...player.attributes };
    previousAttributes.Reflexes = 71.49;
    player.attributes.Reflexes = 71.51;
    previousAttributes.Handling = 71.51;
    player.attributes.Handling = 72.49;

    const keys = getDisplayAttributeKeys(player.position);
    const attributeChanges = {};
    for (const key of keys) {
      const oldV = previousAttributes[key];
      const newV = player.attributes[key];
      const entry = {};
      if (Number.isFinite(oldV)) entry.old = oldV;
      if (Number.isFinite(newV)) entry.new = newV;
      if (Number.isFinite(oldV) && Number.isFinite(newV)) entry.change = newV - oldV;
      attributeChanges[key] = entry;
    }
    assert.deepEqual(Object.keys(attributeChanges), GK_ORDER);
    assert.equal("Shooting" in attributeChanges, false);
    assert.equal(player.attributes.Shooting, 88);

    assert.equal(abilityDisplayChange(71.49, 71.51), 1);
    assert.equal(formatAbilityDisplayChange(71.49, 71.51), "+1");
    assert.equal(abilityDisplayChange(71.51, 72.49), 0);
    assert.equal(formatAbilityDisplayChange(71.51, 72.49), "0");

    // Resumed season with Diving absent from the baseline must not invent change: 0.
    const missingDiving = { Diving: { new: 72.4 } };
    assert.equal("change" in missingDiving.Diving, false);
    const divingEnds = rawAbilityEndpoints(missingDiving.Diving);
    assert.equal(divingEnds.rawBefore, null);
    assert.equal(divingEnds.rawAfter, 72.4);
    assert.equal(formatAbilityDisplayChange(divingEnds.rawBefore, divingEnds.rawAfter, "0"), "—");

    const falseZero = rawAbilityEndpoints({ old: undefined, new: 72.4, change: 0 });
    assert.equal(falseZero.rawBefore, null, "explicit missing old stays unavailable");
    assert.equal(formatAbilityDisplayChange(falseZero.rawBefore, falseZero.rawAfter, "0"), "—");

    // Empty / sparse maps: only keys with real change objects render; no invented zeros.
    const sparse = { Reflexes: { old: 70, new: 71, change: 1 } };
    const rendered = [];
    for (const key of getDisplayAttributeKeys("GK")) {
      const change = sparse[key];
      if (!change || typeof change !== "object") continue;
      rendered.push(key);
    }
    assert.deepEqual(rendered, ["Reflexes"]);
    assert.deepEqual(
      getDisplayAttributeKeys("GK").filter((k) => Object.keys({ Speed: 1, Shooting: 1 }).includes(k)),
      []
    );
  });
});

describe("F06 matched ensure fingerprints", () => {
  it("identical GK and outfield snapshots stay equal after ensure and matched seasons", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const { LEAGUES, LEAGUE_LOOKUP } = await import("../js/data/leagues.js");
    const { simulateSeason } = await import("../js/simulation/seasonSimulator.js");
    const { buildFix13ModernGkSnapshot, buildFix13OutfieldSnapshot } = await import(
      "../js/simulation/fix13GoalkeeperBrowserFixtures.js"
    );

    function fingerprint(player, seasonData) {
      return {
        attributes: structuredClone(player.attributes),
        rating: player.rating,
        baseOverallRaw: player.baseOverallRaw,
        ovr: calculateOverall(player.attributes, player.position).raw,
        minutes: seasonData?.season?.minutes ?? seasonData?.season?.seasonEvidence?.total?.minutes ?? null,
        cleanSheets: seasonData?.season?.cleanSheets ?? null,
        matches: seasonData?.season?.matches ?? null,
        attributeChangeKeys: Object.keys(seasonData?.attributeChanges || {}),
        rngSeed: getSimRng().seed(),
      };
    }

    function runCompletedSeason(snap, seed) {
      resetClubFinanceLedgers();
      reseedCareerRng(seed);
      const world = createWorldState({ startYear: 2026, seed });
      setWorldState(world);
      const restored = deserializeCareerSnapshot(structuredClone(snap));
      const player = restored.player;
      ensurePlayerModel(player);
      let data = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, { autoDecisionPolicy: "stay" });
      let guards = 0;
      while ((data?.awaitingScenario || data?.awaitingDecision) && guards < 24) {
        guards += 1;
        if (data.awaitingScenario) {
          player.pendingSeniorScenario = null;
          if (data.checkpoint) data.checkpoint.pendingSeniorScenario = null;
        }
        player.seasonCheckpoint = data.checkpoint || null;
        data = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
          autoDecisionPolicy: "stay",
          checkpoint: data.checkpoint || null,
        });
      }
      assert.ok(data?.season || data?.attributeChanges, "season completed", { keys: Object.keys(data || {}) });
      return { player, seasonData: data, fingerprint: fingerprint(player, data) };
    }

    const mkGk = () => ({
      name: "TwinGK",
      position: "GK",
      age: 23,
      careerId: "f06-gk",
      rating: 69,
      baseOverallRaw: 69,
      attributes: validGkAttrs(69),
      playerModelVersion: PLAYER_MODEL_VERSION,
      development: {
        modelVersion: DEVELOPMENT_MODEL_VERSION,
        migration: { version: 3 },
        traits: {
          trainability: 1,
          professionalism: 0.5,
          naturalFitness: 0.5,
          resilience: 0.5,
          maturityOffsets: {},
          declineProtection: 0,
        },
      },
    });
    const a = mkGk();
    const b = mkGk();
    ensurePlayerModel(a);
    ensurePlayerModel(b);
    assert.deepEqual(a.attributes, b.attributes);
    assert.equal(calculateOverall(a.attributes, "GK").raw, calculateOverall(b.attributes, "GK").raw);

    const mkSt = () => ({
      name: "TwinST",
      position: "ST",
      age: 22,
      careerId: "f06-st",
      rating: 70,
      attributes: {
        Speed: 72,
        Passing: 68,
        Shooting: 74,
        Defending: 41,
        Physicality: 70,
        Dribbling: 73,
      },
    });
    const s1 = mkSt();
    const s2 = mkSt();
    ensurePlayerModel(s1);
    ensurePlayerModel(s2);
    assert.deepEqual(s1.attributes, s2.attributes);

    const gkSnap = buildFix13ModernGkSnapshot({ seed: 13061, careerId: "f06-matched-gk" });
    const ofSnap = buildFix13OutfieldSnapshot({ seed: 13062, careerId: "f06-matched-st" });
    const gkA = runCompletedSeason(gkSnap, 13061);
    const gkB = runCompletedSeason(gkSnap, 13061);
    const ofA = runCompletedSeason(ofSnap, 13062);
    const ofB = runCompletedSeason(ofSnap, 13062);

    assert.deepEqual(gkA.fingerprint.attributes, gkB.fingerprint.attributes);
    assert.equal(gkA.fingerprint.ovr, gkB.fingerprint.ovr);
    assert.equal(gkA.fingerprint.rngSeed, gkB.fingerprint.rngSeed);
    assert.equal(gkA.fingerprint.minutes, gkB.fingerprint.minutes);
    assert.equal(gkA.fingerprint.cleanSheets, gkB.fingerprint.cleanSheets);
    assert.deepEqual(gkA.fingerprint.attributeChangeKeys, GK_ORDER);
    assert.equal("Shooting" in (gkA.seasonData.attributeChanges || {}), false);

    assert.deepEqual(ofA.fingerprint.attributes, ofB.fingerprint.attributes);
    assert.equal(ofA.fingerprint.ovr, ofB.fingerprint.ovr);
    assert.deepEqual(ofA.fingerprint.attributeChangeKeys, [...OUTFIELD_ATTRIBUTE_KEYS]);

    // Presentation intent: GK payload is canonical-role-only; durable extras remain on the player.
    assert.equal(gkA.player.attributes.Speed, gkSnap.player.attributes.Speed);
    assert.ok(!gkA.fingerprint.attributeChangeKeys.includes("Speed"));

    const evidence = {
      generatedAt: new Date().toISOString(),
      note:
        "Matched Fix 13 final runs with identical start snapshots/seeds. Durable GK/outfield state and RNG agree across repeats. attributeChanges is presentation-only (canonical role keys).",
      gk: { runA: gkA.fingerprint, runB: gkB.fingerprint },
      outfield: { runA: ofA.fingerprint, runB: ofB.fingerprint },
    };
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const outPath = join(root, "qa/fix13-runs/f06-matched-season.json");
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, JSON.stringify(evidence, null, 2));
  });
});

describe("F07 bulk QA lifecycle measurement", () => {
  it("reproduces pre-finalize empty keys then valid post-finalize; invalid control fails", () => {
    const gk = createPlayerIdentity({ name: "F07", nationality: "England", position: "GK", age: 16 });
    assert.equal(gk.attributes, null);
    const preKeys = Object.keys(gk.attributes || {});
    assert.deepEqual(preKeys, []);

    finalizeAcademyPlayer(gk, pickAcademy());
    assert.equal(validateAttributes(gk.attributes, "GK").ok, true);
    assert.deepEqual(getDisplayAttributeKeys(gk.position), GK_ORDER);

    const broken = structuredClone(gk);
    delete broken.attributes.Diving;
    assert.equal(validateAttributes(broken.attributes, "GK").ok, false);
    assert.ok(validateAttributes(broken.attributes, "GK").missing.includes("Diving"));
  });
});
