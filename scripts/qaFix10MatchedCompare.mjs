#!/usr/bin/env node
/**
 * Detached matched compare: accepted-base (296a14f) vs final Fix 10 code.
 * Spawns isolated Node processes; never emulates base with final coefficients.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRng } from "../js/simulation/rng.js";
import { resolveClub } from "../js/data/identity/resolver.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE_SHA = "296a14f2e921e68a946a802605e472662cb0894e";
const BASE_ROOT = process.env.FIX10_BASE_ROOT || join(ROOT, "../fix09");
const OUT = join(ROOT, "qa/fix10-runs/matched");
mkdirSync(join(OUT, "inputs"), { recursive: true });
mkdirSync(join(OUT, "base"), { recursive: true });
mkdirSync(join(OUT, "final"), { recursive: true });

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function buildCommonInput() {
  const pairs = [
    ["Hull City", "Burnley"],
    ["Brentford", "Crystal Palace"],
    ["Arsenal", "Manchester City"],
    ["Železničar Pančevo", "Red Star Belgrade"],
  ];
  const fixtures = [];
  for (const [homeName, awayName] of pairs) {
    const hr = resolveClub(homeName);
    const ar = resolveClub(awayName);
    if (!hr.ok || !ar.ok) throw new Error(`resolve failed ${homeName}/${awayName}`);
    const repl = hr.profile.replacementOvr?.ST ?? Math.round(hr.profile.overall - 2);
    for (const ovr of [repl, 99]) {
      for (const role of ovr === 99 ? ["ST", "CM", "CB", "GK"] : ["ST"]) {
        fixtures.push({
          id: `${homeName}__${awayName}__${role}__${ovr}`,
          homeName,
          awayName,
          homeClubId: hr.profile.clubId,
          awayClubId: ar.profile.clubId,
          homeProfile: hr.profile,
          awayProfile: ar.profile,
          role: role === "ST" || ovr === repl ? role : role,
          position: role,
          ovr,
          minutes: 90,
          venue: "neutral",
          form: 0,
          seed: sha256(`${homeName}|${awayName}|${role}|${ovr}`).slice(0, 12),
          numericSeed: Number.parseInt(sha256(`${homeName}|${awayName}|${role}|${ovr}`).slice(0, 8), 16),
        });
      }
    }
  }
  // Synthetic equal-quality controls
  for (const q of [55, 70]) {
    for (const role of ["ST", "CM", "CB", "GK"]) {
      for (const ovr of [q - (role === "ST" ? 2 : role === "GK" ? 5 : 4), 99]) {
        fixtures.push({
          id: `synth-q${q}__${role}__${ovr}`,
          synthetic: true,
          quality: q,
          position: role,
          ovr,
          minutes: 90,
          venue: "neutral",
          form: 0,
          seed: sha256(`synth|${q}|${role}|${ovr}`).slice(0, 12),
          numericSeed: Number.parseInt(sha256(`synth|${q}|${role}|${ovr}`).slice(0, 8), 16),
        });
      }
    }
  }
  return {
    baseSha: BASE_SHA,
    createdAt: new Date().toISOString(),
    fixtures,
  };
}

const common = buildCommonInput();
const commonJson = JSON.stringify(common, null, 2);
const commonPath = join(OUT, "inputs", "common-input.json");
writeFileSync(commonPath, commonJson);
const commonHash = sha256(commonJson);
writeFileSync(join(OUT, "inputs", "common-input.sha256"), `${commonHash}\n`);

const runnerSrc = `
import { readFileSync, writeFileSync } from "node:fs";
import { createRng } from "../js/simulation/rng.js";
import { effectiveTeamStrength } from "../js/simulation/teamStrength.js";
import { expectedGoals, simulateMatch } from "../js/simulation/matchEngine.js";

const inputPath = process.argv[2];
const outPath = process.argv[3];
const input = JSON.parse(readFileSync(inputPath, "utf8"));
const NEUTRAL = { Shooting:65, Passing:65, Defending:65, Reflexes:65, Handling:65, Positioning:65 };

function synth(q) {
  return {
    clubId: "club:synth:"+q, name: "Synth"+q,
    overall:q, attack:q, midfield:q, defence:q, goalkeeper:q,
    replacementOvr:{ ST:q-2, CM:q-4, CB:q-4, GK:q-5, CAM:q-3, RW:q-1, LW:q-1, RB:q-5, LB:q-5, CDM:q-4, RM:q-4, LM:q-4, CF:q-2 },
  };
}

const results = [];
for (const f of input.fixtures) {
  let homeProfile, awayProfile, home, away, world;
  if (f.synthetic) {
    homeProfile = synth(f.quality);
    awayProfile = synth(f.quality);
    awayProfile = { ...awayProfile, clubId: homeProfile.clubId + ":opp" };
    world = { clubs: new Map([[homeProfile.clubId, homeProfile],[awayProfile.clubId, awayProfile]]), nations:new Map(), form:new Map() };
    home = { name: homeProfile.name, clubId: homeProfile.clubId };
    away = { name: awayProfile.name, clubId: awayProfile.clubId };
  } else {
    homeProfile = f.homeProfile;
    awayProfile = f.awayProfile;
    world = {
      clubs: new Map([
        [homeProfile.clubId, { ...homeProfile, replacementOvr: { ...homeProfile.replacementOvr } }],
        [awayProfile.clubId, { ...awayProfile, replacementOvr: { ...awayProfile.replacementOvr } }],
      ]),
      nations: new Map(),
      form: new Map(),
    };
    home = { name: homeProfile.name, clubId: homeProfile.clubId };
    away = { name: awayProfile.name, clubId: awayProfile.clubId };
  }
  const player = {
    name: "QA",
    position: f.position,
    currentOverallRaw: f.ovr,
    attributes: { ...NEUTRAL },
  };
  const rng = createRng(f.numericSeed);
  const beforeSeed = rng.seed();
  const he = effectiveTeamStrength(home, { worldState: world, player, playerSide: "home", side: "home", playerMinutes: f.minutes });
  const ae = effectiveTeamStrength(away, { worldState: world });
  const xg = expectedGoals(he, ae, { venue: f.venue });
  const match = simulateMatch(home, away, {
    worldState: world,
    player,
    playerSide: "home",
    playerMinutes: f.minutes,
    venue: f.venue,
    rng: createRng(f.numericSeed),
  });
  results.push({
    id: f.id,
    beforeSeed,
    xg,
    homeEff: { overall: he.overall, attack: he.attack, midfield: he.midfield, defence: he.defence, goalkeeper: he.goalkeeper, impact: he.playerImpact },
    awayEff: { overall: ae.overall, attack: ae.attack, defence: ae.defence, goalkeeper: ae.goalkeeper },
    score: { home: match.homeGoals, away: match.awayGoals },
    abilityRead: player.currentOverallRaw,
  });
}
writeFileSync(outPath, JSON.stringify({ engineRoot: process.cwd(), results }, null, 2));
`;

const runnerFinal = join(OUT, "inputs", "replay-adapter-final.mjs");
const runnerBase = join(OUT, "inputs", "replay-adapter-base.mjs");
writeFileSync(runnerFinal, runnerSrc);
writeFileSync(runnerBase, runnerSrc);

function runSide(label, cwd, outFile) {
  if (!existsSync(cwd)) throw new Error(`Missing ${label} root: ${cwd}`);
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" });
  const sha = head.stdout.trim();
  // Write adapter into cwd temp so relative imports resolve against that engine tree.
  mkdirSync(join(cwd, "qa-tmp-fix10"), { recursive: true });
  const adapterPath = join(cwd, "qa-tmp-fix10", "replay-adapter.mjs");
  writeFileSync(adapterPath, runnerSrc);
  const r2 = spawnSync(process.execPath, [adapterPath, commonPath, outFile], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r2.status !== 0) {
    throw new Error(`${label} replay failed: ${r2.stderr || r2.stdout}`);
  }
  return { sha, outFile, adapterSha: sha256(runnerSrc) };
}

const finalOut = join(OUT, "final", "replay.json");
const baseOut = join(OUT, "base", "replay.json");
const finalMeta = runSide("final", ROOT, finalOut);
const baseMeta = runSide("base", BASE_ROOT, baseOut);

const finalRes = JSON.parse(readFileSync(finalOut, "utf8"));
const baseRes = JSON.parse(readFileSync(baseOut, "utf8"));

// Same-engine self replay
const selfOut = join(OUT, "final", "self-replay.json");
runSide("final-self", ROOT, selfOut);
const selfRes = JSON.parse(readFileSync(selfOut, "utf8"));
const selfOk = JSON.stringify(selfRes.results) === JSON.stringify(finalRes.results);

const summary = {
  commonInputSha256: commonHash,
  baseShaExpected: BASE_SHA,
  baseShaActual: baseMeta.sha,
  finalSha: finalMeta.sha,
  adapterSha256: finalMeta.adapterSha,
  selfReplayExact: selfOk,
  fixtureCount: common.fixtures.length,
  comparisons: finalRes.results.map((fr) => {
    const br = baseRes.results.find((x) => x.id === fr.id);
    return {
      id: fr.id,
      baseXgHome: br?.xg?.home,
      finalXgHome: fr.xg.home,
      baseImpactAtk: br?.homeEff?.impact?.attack,
      finalImpactAtk: fr.homeEff?.impact?.attack,
      deltaXgHome: fr.xg.home - (br?.xg?.home ?? 0),
    };
  }),
};
writeFileSync(join(OUT, "baseline-vs-final-summary.json"), JSON.stringify(summary, null, 2));
writeFileSync(join(ROOT, "qa/fix10-runs/baseline-vs-final-summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({
  ok: selfOk && baseMeta.sha.startsWith("296a14f"),
  commonInputSha256: commonHash,
  baseSha: baseMeta.sha,
  finalSha: finalMeta.sha,
  selfReplayExact: selfOk,
  out: join(OUT, "baseline-vs-final-summary.json"),
}, null, 2));
if (!selfOk) process.exit(1);
