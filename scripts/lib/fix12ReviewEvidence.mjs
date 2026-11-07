/** Shared Fix 12 review package helpers. */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const EVIDENCE_SCHEMA = 2;
export const REQUIRED_CASE_IDS = [
  ...Array.from({ length: 18 }, (_, i) => `F${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 8 }, (_, i) => `B${String(i + 1).padStart(2, "0")}`),
];

export const REQUIRED_SUITE_INPUTS = [
  "qa/fix09-runs/final/full-suite.log",
  "qa/fix10-runs/calibration-targets.json",
  "qa/fix11-runs/plan.json",
  "qa/fix11-runs/witnesses/index.json",
  "qa/fix11-runs/witnesses/natural-99/career.json",
  "qa/fix11-runs/witnesses/plus6-plus7/career-plus6.json",
  "qa/fix11-runs/witnesses/plus6-plus7/career-plus7.json",
  ...Array.from({ length: 20 }, (_, i) => `qa/fix11-runs/cases/F${String(i + 1).padStart(2, "0")}.json`),
];

export const TESTED_SOURCE_PATHS = [
  "js/ui/tournamentPresentation.js",
  "js/ui/simulationDashboard.js",
  "js/ui/rendering.js",
  "js/ui/seasonAnimation.js",
  "js/simulation/competitionPlayback.js",
  "js/simulation/nationalTournament.js",
  "tests/tournamentPresentation.test.mjs",
  "scripts/browserTournamentPresentationChecklist.mjs",
  "scripts/qaTournamentPresentation.mjs",
  "style.css",
];

export const REQUIRED_PARITY_PAIR_FILES = [
  "world-cup-12001-base.json",
  "world-cup-12001-final.json",
  "ucl-seed7-w4d2l2-base.json",
  "ucl-seed7-w4d2l2-final.json",
  "libertadores-seed7-base.json",
  "libertadores-seed7-final.json",
];

/** Minimum observation keys each browser PASS row must retain. */
export const BROWSER_REQUIRED_DETAIL_KEYS = {
  B01: ["observations", "probe", "finalLive", "bannerCounts"],
  B02: ["overview", "continueClosed", "nextCareerAction"],
  B03: ["overview", "phase", "twoLegTotal"],
  B04: ["observed", "knockoutView"],
  B05: ["observed", "highlightOk"],
  B06: ["observed", "switched"],
  B07: ["finalLive", "continueClosed", "nextCareerAction"],
  B08: ["layouts", "tabActive", "activatedDifferentTab", "phaseTableScroll"],
};

export function browserDetailHollow(detail) {
  if (!detail || typeof detail !== "object") return true;
  if (Object.keys(detail).length === 0) return true;
  return false;
}

export function browserDetailMissingKeys(id, detail) {
  const required = BROWSER_REQUIRED_DETAIL_KEYS[id] || [];
  if (browserDetailHollow(detail)) return required.length ? required : ["detail"];
  return required.filter((k) => detail[k] == null || detail[k] === "");
}

export function sha256File(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

export function sha256Buffer(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export function listFiles(dir, out = [], prefix = "") {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(abs).isDirectory()) listFiles(abs, out, rel);
    else out.push(rel);
  }
  return out;
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function computeSourceManifest(entries) {
  return {
    schema: EVIDENCE_SCHEMA,
    files: entries.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

function oracleNormId(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/^nation:/, "")
    .replace(/^club:/, "")
    .replace(/[-_]+/g, " ")
    .trim();
}

function oracleSideIds(side, participantIdField) {
  if (side == null) return [];
  if (typeof side === "string") return [side];
  return [
    side.clubId,
    side.nationId,
    side.participantId,
    participantIdField,
    side.name,
    side.displayName,
  ].filter((x) => x != null && x !== "");
}

function oracleSideMatches(side, participantIdField, participantId) {
  const want = String(participantId);
  const wantNorm = oracleNormId(want);
  for (const id of oracleSideIds(side, participantIdField)) {
    const raw = String(id);
    if (raw === want) return true;
    if (oracleNormId(raw) === wantNorm) return true;
  }
  return false;
}

/** Tiny independent oracle — duplicates presentation math without importing production helper. */
export function independentOracleFromFixtures(fixtures, participantId) {
  const byId = new Map();
  for (const m of fixtures || []) {
    if (!m || m.isBye || m.isAggregate) continue;
    if (m.status && m.status !== "played") continue;
    const id = m.matchId || m.fixtureId;
    if (!id) continue;
    const hg = m.matchHomeGoals ?? m.homeGoals;
    const ag = m.matchAwayGoals ?? m.awayGoals;
    if (hg == null || ag == null) continue;
    byId.set(id, m);
  }
  let played = 0;
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let gf = 0;
  let ga = 0;
  for (const m of byId.values()) {
    let side = null;
    if (oracleSideMatches(m.home, m.homeParticipantId, participantId)) side = "home";
    else if (oracleSideMatches(m.away, m.awayParticipantId, participantId)) side = "away";
    else continue;
    const hg = Number(m.matchHomeGoals ?? m.homeGoals);
    const ag = Number(m.matchAwayGoals ?? m.awayGoals);
    const gFor = side === "home" ? hg : ag;
    const gAg = side === "home" ? ag : hg;
    played += 1;
    gf += gFor;
    ga += gAg;
    if (gFor > gAg) wins += 1;
    else if (gFor < gAg) losses += 1;
    else draws += 1;
  }
  return { played, wins, draws, losses, gf, ga, gd: gf - ga };
}

export function assessPackageEvidence({
  root = null,
  manifest,
  caseIndex,
  browserReport,
  f01Fixture,
  presentationTestLog,
  fullSuiteLog,
  gameplayParity,
  sourceManifest = null,
  packagedSuiteProof = null,
}) {
  const problems = [];
  if (!manifest?.finalSha) problems.push("manifest missing finalSha");
  if (!manifest?.baseSha && !manifest?.acceptedBaseSha) {
    problems.push("manifest missing baseSha/acceptedBaseSha");
  }
  if (manifest?.remoteSha && manifest.remoteSha !== manifest.finalSha) {
    problems.push("remoteSha != finalSha");
  }

  const cases = caseIndex?.cases || [];
  for (const id of REQUIRED_CASE_IDS) {
    const row = cases.find((c) => c.id === id);
    if (!row) problems.push(`case-index missing ${id}`);
    else if (row.status !== "PASS") problems.push(`case-index ${id} status ${row.status}`);
  }

  for (const id of REQUIRED_CASE_IDS.filter((x) => x.startsWith("B"))) {
    const row = (browserReport?.results || []).find((r) => r.id === id);
    if (!row) problems.push(`missing browser case ${id}`);
    else if (row.status !== "PASS") problems.push(`browser ${id} status ${row.status}`);
    else {
      const missing = browserDetailMissingKeys(id, row.detail);
      if (missing.length) problems.push(`browser ${id} missing observations: ${missing.join(",")}`);
    }
  }

  if (root) {
    for (const id of REQUIRED_CASE_IDS.filter((x) => x.startsWith("B"))) {
      const casePath = join(root, "qa/fix12/browser/cases", `${id}.json`);
      if (!existsSync(casePath)) problems.push(`missing browser case file ${id}.json`);
      else {
        const payload = readJson(casePath);
        if (payload.status !== "PASS") problems.push(`browser case file ${id} not PASS`);
        const missing = browserDetailMissingKeys(id, payload.detail);
        if (missing.length) problems.push(`browser case file ${id} missing observations: ${missing.join(",")}`);
      }
    }
    for (const rel of REQUIRED_SUITE_INPUTS) {
      if (!existsSync(join(root, "source", rel))) {
        problems.push(`packaged source missing suite input ${rel}`);
      }
    }
    // Every packaged source file must match the committed source-content manifest.
    if (sourceManifest?.files?.length) {
      for (const row of sourceManifest.files) {
        const abs = join(root, "source", row.path);
        if (!existsSync(abs)) {
          problems.push(`packaged source missing ${row.path}`);
          continue;
        }
        if (row.sha256 && sha256File(abs) !== row.sha256) {
          problems.push(`source identity mismatch ${row.path}`);
        }
      }
    }
    // Matched parity pairs + suite log must be present and hashed.
    for (const name of REQUIRED_PARITY_PAIR_FILES) {
      const abs = join(root, "qa/fix12/final/gameplay-parity", name);
      if (!existsSync(abs)) problems.push(`missing parity pair file ${name}`);
    }
    if (!existsSync(join(root, "qa/fix12/packaged-suite.log"))) {
      problems.push("missing packaged-suite.log");
    } else if (packagedSuiteProof) {
      const log = readFileSync(join(root, "qa/fix12/packaged-suite.log"), "utf8");
      if (!new RegExp(`# pass ${packagedSuiteProof.pass}`).test(log)) {
        problems.push("packaged-suite.log inconsistent with proof");
      }
    }
    // Tie parity summary SHAs to the package manifest.
    if (gameplayParity?.baseSha && manifest?.acceptedBaseSha && gameplayParity.baseSha !== manifest.acceptedBaseSha) {
      problems.push("parity baseSha != manifest acceptedBaseSha");
    }
    if (gameplayParity?.finalSha && manifest?.finalSha && gameplayParity.finalSha !== manifest.finalSha) {
      problems.push("parity finalSha != manifest finalSha");
    }
  }

  if (browserReport?.fail) problems.push(`browser fail count ${browserReport.fail}`);
  if (caseIndex && caseIndex.ok === false) problems.push("qa case-index not ok");

  const group = f01Fixture?.projection?.openingPhase?.record;
  const total = f01Fixture?.projection?.tournament?.record;
  if (!group || group.played !== 3 || group.wins !== 2 || group.draws !== 1 || group.losses !== 0) {
    problems.push("F01 group record mismatch in fixture");
  }
  if (!total || total.played !== 8 || total.wins !== 7 || total.draws !== 1 || total.losses !== 0) {
    problems.push("F01 total record mismatch in fixture");
  }

  const inventory = f01Fixture?.fixtureInventory || f01Fixture?.rawFixtures || [];
  if (!Array.isArray(inventory) || inventory.length < 8) {
    problems.push("F01 fixture inventory missing or short");
  } else {
    // Prefer full match objects when present; else reconstruct minimal from inventory rows + claimed scores.
    const raw = f01Fixture.rawNationFixtures;
    if (!Array.isArray(raw) || raw.length < 8) {
      problems.push("F01 rawNationFixtures missing for independent oracle");
    } else {
      const oracle = independentOracleFromFixtures(raw, "Serbia");
      if (oracle.played !== 8 || oracle.wins !== 7 || oracle.draws !== 1 || oracle.losses !== 0) {
        problems.push("independent oracle disagrees with F01 totals");
      }
      if (f01Fixture.oracle && f01Fixture.oracle.wins !== oracle.wins) {
        problems.push("stored F01 oracle disagrees with recomputed oracle");
      }
    }
  }

  if (presentationTestLog && !/# pass 1[89]/.test(presentationTestLog) && !/# pass 19/.test(presentationTestLog)) {
    if (!/# pass 18/.test(presentationTestLog) && !/# pass 19/.test(presentationTestLog)) {
      problems.push("presentation test log missing expected pass count");
    }
  }
  if (fullSuiteLog) {
    if (/# fail [1-9]/.test(fullSuiteLog)) problems.push("full suite has failures");
    if (!/# pass 246/.test(fullSuiteLog) && !/# tests 246/.test(fullSuiteLog)) {
      // Allow packaged-suite proof alternate path (R1 added one focused case → 246)
      if (!packagedSuiteProof || packagedSuiteProof.pass !== 246) {
        problems.push("full suite log missing 246 pass proof");
      }
    }
  } else {
    problems.push("missing full-suite log");
  }

  if (!gameplayParity) problems.push("missing gameplay parity result");
  else {
    if (gameplayParity.nationalParity === false || gameplayParity.continentalParity === false) {
      problems.push("gameplay parity failed");
    }
    if (gameplayParity.sameRevisionOnly) {
      problems.push("parity compared same revision on both sides");
    }
    if (!gameplayParity.baseSha || !gameplayParity.finalSha) {
      problems.push("parity missing base/final SHAs");
    }
    if (gameplayParity.baseSha && gameplayParity.finalSha && gameplayParity.baseSha === gameplayParity.finalSha) {
      problems.push("parity baseSha equals finalSha");
    }
    const controls = gameplayParity.controls || [];
    if (controls.length < 3) problems.push("parity requires World Cup, UCL, and Libertadores controls");
    for (const c of controls) {
      if (!c.matched) problems.push(`parity control ${c.id || "?"} not matched`);
      if (c.finalRng == null || c.baseRng == null) problems.push(`parity control ${c.id} missing RNG`);
      if (!c.baseHash || !c.finalHash || c.baseHash !== c.finalHash) {
        problems.push(`parity control ${c.id} fingerprint mismatch`);
      }
    }
    if (!gameplayParity.pairDigests || typeof gameplayParity.pairDigests !== "object") {
      problems.push("parity result missing pairDigests map");
    } else {
      for (const name of REQUIRED_PARITY_PAIR_FILES) {
        if (!gameplayParity.pairDigests[name]) {
          problems.push(`parity pairDigests missing ${name}`);
        } else if (root) {
          const abs = join(root, "qa/fix12/final/gameplay-parity", name);
          if (!existsSync(abs)) problems.push(`missing parity pair file ${name}`);
          else if (sha256File(abs) !== gameplayParity.pairDigests[name]) {
            problems.push(`parity pair digest mismatch ${name}`);
          }
        }
      }
    }
  }

  if (sourceManifest?.files) {
    for (const p of TESTED_SOURCE_PATHS) {
      if (!sourceManifest.files.some((f) => f.path === p)) {
        problems.push(`source manifest missing tested path ${p}`);
      }
    }
    const fp = manifest?.testedSourceFingerprint;
    if (fp && typeof fp === "object") {
      for (const p of TESTED_SOURCE_PATHS) {
        const row = sourceManifest.files.find((f) => f.path === p);
        if (row && fp[p] && fp[p] !== row.sha256) {
          problems.push(`tested fingerprint mismatch for ${p}`);
        }
      }
    } else if (typeof fp === "string") {
      // Legacy single-file fingerprint — require multi-file object for re-review packages
      problems.push("testedSourceFingerprint must cover full tested source map");
    }
  }

  if (packagedSuiteProof) {
    if (packagedSuiteProof.exitStatus !== 0) problems.push("packaged suite proof nonzero exit");
    if (packagedSuiteProof.pass !== 246 || packagedSuiteProof.fail !== 0) {
      problems.push("packaged suite proof counts not 246/0");
    }
  } else if (root) {
    problems.push("missing packaged maintained-suite proof");
  }

  return { ok: problems.length === 0, problems };
}
