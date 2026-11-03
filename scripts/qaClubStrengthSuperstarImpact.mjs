#!/usr/bin/env node
/**
 * Fix 10 calibration exporter: deterministic gates, 5k-match samples, season probes.
 */
import { mkdirSync, writeFileSync, appendFileSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  ROOT,
  TARGETS,
  ROLE_REF_OFFSET,
  roleReference,
  evaluatePlayerImpact,
  assertContractRow,
  analyticMatchProbs,
  inventorySummary,
  synthProfile,
  worldWithProfiles,
  teamRef,
  makePlayer,
  simulateMatch,
  expectedGoals,
  effectiveTeamStrength,
  createRng,
  NEUTRAL_ATTRS,
} from "./lib/fix10StrengthQa.mjs";
import { resolveClub } from "../js/data/identity/resolver.js";

const OUT = join(ROOT, "qa/fix10-runs");
const GRID = join(OUT, "grids");
const CASES = join(OUT, "cases");
mkdirSync(GRID, { recursive: true });
mkdirSync(CASES, { recursive: true });

const started = new Date().toISOString();
const report = {
  started,
  modelVersion: TARGETS.modelVersion,
  inventory: inventorySummary(),
  deterministic: [],
  monteCarlo: [],
  realClubPairs: [],
  seasons: [],
  ok: true,
  failures: [],
};

function sha(obj) {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

// --- Deterministic contract matrix ---
const matrix = [];
for (const quality of [55, 70, 88]) {
  for (const role of ["ST", "CM", "CB", "GK"]) {
    for (const ovr of [roleReference(quality, role) - 10, roleReference(quality, role), 75, 85, 90, 95, 99]) {
      for (const minutes of [0, 30, 45, 90]) {
        const row = evaluatePlayerImpact({ quality, role, ovr, minutes });
        matrix.push({
          quality,
          role,
          ovr,
          minutes,
          ownXgPct: row.ownXgPct,
          oppXgPct: row.oppXgPct,
          dEp: row.dEp,
          dOverall: row.dOverall,
          dAttack: row.dAttack,
          dDefence: row.dDefence,
          dGoalkeeper: row.dGoalkeeper,
          x0: row.x0,
          x1: row.x1,
        });
      }
    }
  }
}
writeFileSync(join(GRID, "impact-matrix.jsonl"), matrix.map((r) => JSON.stringify(r)).join("\n") + "\n");

for (const quality of TARGETS.controls.qualities) {
  for (const role of TARGETS.controls.roles) {
    const row = evaluatePlayerImpact({ quality, role, ovr: 99 });
    const fails = assertContractRow(row);
    const entry = { quality, role, ovr: 99, ...row, fails };
    report.deterministic.push({
      quality,
      role,
      ownXgPct: row.ownXgPct,
      oppXgPct: row.oppXgPct,
      dEp: row.dEp,
      fails,
    });
    if (fails.length) {
      report.ok = false;
      report.failures.push(...fails.map((f) => `${role}@${quality}: ${f}`));
    }
    if (quality === 70) {
      const r90 = evaluatePlayerImpact({ quality, role, ovr: 90 });
      if (row.dEp - r90.dEp < 0.02) {
        report.ok = false;
        report.failures.push(`99vs90 ${role}`);
      }
    }
  }
}

// --- 5000-seed monte carlo for representative pairs ---
const MC_N = Number(process.env.FIX10_MC_N || 5000);
for (const quality of [55, 70]) {
  for (const role of ["ST", "CM", "CB", "GK"]) {
    for (const ovr of [roleReference(quality, role), 99]) {
      const profile = synthProfile(quality);
      const world = worldWithProfiles([profile]);
      const team = teamRef(profile);
      const player = ovr === roleReference(quality, role) ? null : makePlayer({ position: role, ovr, minutes: 90 });
      let w = 0;
      let d = 0;
      let l = 0;
      let gf = 0;
      let ga = 0;
      for (let seed = 0; seed < MC_N; seed += 1) {
        const m = simulateMatch(team, team, {
          worldState: world,
          venue: "neutral",
          player,
          playerSide: player ? "home" : null,
          playerMinutes: player ? 90 : null,
          rng: createRng(10_000 + seed),
        });
        gf += m.homeGoals;
        ga += m.awayGoals;
        if (m.homeGoals > m.awayGoals) w += 1;
        else if (m.homeGoals === m.awayGoals) d += 1;
        else l += 1;
      }
      const analytic = (() => {
        const row = evaluatePlayerImpact({ quality, role, ovr: player ? 99 : roleReference(quality, role) });
        return row.probs1;
      })();
      report.monteCarlo.push({
        quality,
        role,
        ovr: player ? 99 : roleReference(quality, role),
        n: MC_N,
        empirical: { w, d, l, gf, ga, ep: (3 * w + d) / MC_N },
        analyticEp: analytic.expectedPoints,
      });
    }
  }
}

// --- Real club striker pairs from section 3.2 ---
const PAIRS = [
  ["Hull City", "Burnley"],
  ["Brentford", "Crystal Palace"],
  ["Arsenal", "Manchester City"],
  ["Železničar Pančevo", "Red Star Belgrade"],
];
for (const [homeName, awayName] of PAIRS) {
  const hr = resolveClub(homeName);
  const ar = resolveClub(awayName);
  if (!hr.ok || !ar.ok) {
    report.failures.push(`resolve ${homeName}/${awayName}`);
    report.ok = false;
    continue;
  }
  const world = {
    clubs: new Map([
      [hr.profile.clubId, { ...hr.profile, replacementOvr: { ...hr.profile.replacementOvr } }],
      [ar.profile.clubId, { ...ar.profile, replacementOvr: { ...ar.profile.replacementOvr } }],
    ]),
    nations: new Map(),
    form: new Map(),
  };
  const home = { name: hr.profile.name, clubId: hr.profile.clubId };
  const away = { name: ar.profile.name, clubId: ar.profile.clubId };
  const repl = hr.profile.replacementOvr?.ST ?? hr.profile.overall - 2;
  const conditions = [
    { label: "replacement", ovr: repl },
    { label: "star99", ovr: 99 },
  ];
  const pairOut = { home: homeName, away: awayName, homeOverall: hr.profile.overall, awayOverall: ar.profile.overall, conditions: [] };
  for (const c of conditions) {
    const player = makePlayer({ position: "ST", ovr: c.ovr, minutes: 90, attributes: { ...NEUTRAL_ATTRS } });
    const he = effectiveTeamStrength(home, {
      worldState: world,
      player,
      playerSide: "home",
      side: "home",
      playerMinutes: 90,
    });
    const ae = effectiveTeamStrength(away, { worldState: world });
    const xg = expectedGoals(he, ae, { venue: "neutral" });
    const probs = analyticMatchProbs(xg.home, xg.away);
    pairOut.conditions.push({ ...c, xg, expectedPoints: probs.expectedPoints, homeAttack: he.attack });
  }
  const baseEp = pairOut.conditions[0].expectedPoints;
  const starEp = pairOut.conditions[1].expectedPoints;
  pairOut.deltaEp = starEp - baseEp;
  pairOut.ownXgPct =
    ((pairOut.conditions[1].xg.home / pairOut.conditions[0].xg.home) - 1) * 100;
  report.realClubPairs.push(pairOut);
}

// --- Controlled league-season proxy: 38 fixed opponents, frozen participation ---
const SEASON_N = Number(process.env.FIX10_SEASON_N || 100);
for (const quality of [55, 70]) {
  for (const role of ["ST", "CM", "CB", "GK"]) {
    for (const ovr of [roleReference(quality, role), 99]) {
      const points = [];
      for (let seasonSeed = 0; seasonSeed < SEASON_N; seasonSeed += 1) {
        let pts = 0;
        let gf = 0;
        let ga = 0;
        const profile = synthProfile(quality);
        const world = worldWithProfiles([profile]);
        const team = teamRef(profile);
        const player =
          ovr === roleReference(quality, role)
            ? null
            : makePlayer({ position: role, ovr, minutes: 90 });
        for (let fixture = 0; fixture < 38; fixture += 1) {
          const m = simulateMatch(team, team, {
            worldState: world,
            venue: fixture % 2 === 0 ? "home" : "away",
            player,
            playerSide: player ? "home" : null,
            playerMinutes: player ? 90 : null,
            rng: createRng(seasonSeed * 1000 + fixture + quality * 17),
          });
          gf += m.homeGoals;
          ga += m.awayGoals;
          if (m.homeGoals > m.awayGoals) pts += 3;
          else if (m.homeGoals === m.awayGoals) pts += 1;
        }
        points.push({ pts, gf, ga });
      }
      const mean = points.reduce((s, p) => s + p.pts, 0) / points.length;
      report.seasons.push({ quality, role, ovr, seasons: SEASON_N, meanPoints: mean });
    }
  }
}

report.finished = new Date().toISOString();
report.matrixSha256 = sha(matrix.slice(0, 20));
writeFileSync(join(OUT, "calibration-summary.json"), JSON.stringify(report, null, 2));
writeFileSync(join(CASES, "calibration-gate.json"), JSON.stringify({ ok: report.ok, failures: report.failures }, null, 2));
console.log(JSON.stringify({ ok: report.ok, failures: report.failures, out: join(OUT, "calibration-summary.json") }, null, 2));
if (!report.ok) process.exit(1);
