#!/usr/bin/env node
/**
 * Fix 14 paired academy-offer cohort (512 seeds × 5 nations × ages 16 & 18).
 *
 *   node scripts/exportFix14AcademyCohort.mjs
 *
 * Writes (gitignored / review ZIP only):
 *   qa/evidence/fix14-cohort/paired-rows.jsonl.gz
 *   qa/evidence/fix14-cohort/summary.json
 */
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createGzip } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE_SHA = "f2e32b84475bccd3094e6c1490af45816848f9b0";
const OUT_DIR = join(root, "qa/evidence/fix14-cohort");
const NATIONS = ["England", "Serbia", "United States", "Japan", "Ghana"];
const AGES = [16, 18];
const N = 512;
const PREFIX = "fix14-cohort-v1";

const finalSha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed:\n${r.stderr || r.stdout}`);
  }
  return r;
}

const { hashSeed } = await import(pathToFileURL(join(root, "js/simulation/rng.js")).href);
const {
  pickThreeAcademies,
  canonicalizeNation,
} = await import(pathToFileURL(join(root, "js/simulation/narrativeAcademySeason.js")).href);
const { ACADEMY_POOL } = await import(pathToFileURL(join(root, "js/data/leagues.js")).href);
const { academyNationOf } = await import(pathToFileURL(join(root, "js/data/academyOfferStories.js")).href);
const { regionDistance } = await import(pathToFileURL(join(root, "js/data/academyGeography.js")).href);

function rowFromOffers({ nation, age, seed, index, side, offers }) {
  const parents = offers.map((o) => ({
    clubId: o.academy.parentClub?.clubId || null,
    parentName: o.academy.parentClub?.name || o.academy.name,
    nation: canonicalizeNation(academyNationOf(o.academy)),
    isHome: o.isHome,
    divisionLevel: o.academy.parentClub?.divisionLevel ?? null,
    distance: o.isHome ? 0 : regionDistance(canonicalizeNation(nation), canonicalizeNation(academyNationOf(o.academy))),
  }));
  const homeCount = parents.filter((p) => p.isHome).length;
  const abroad = parents.filter((p) => !p.isHome);
  const trayKind =
    homeCount === parents.length ? "all-home" : homeCount === 0 ? "all-abroad" : "mixed";
  return {
    side,
    nationality: nation,
    age,
    index,
    seed,
    playerName: `Fix14 ${nation} ${index}`,
    trayKind,
    parentIds: parents.map((p) => p.clubId || p.parentName),
    nations: parents.map((p) => p.nation),
    homeFlags: parents.map((p) => p.isHome),
    divisions: parents.map((p) => p.divisionLevel),
    distances: parents.map((p) => p.distance),
    firstAbroadDistance: abroad[0]?.distance ?? null,
    firstAbroadNation: abroad[0]?.nation ?? null,
  };
}

/** Run old selector on accepted base in an isolated temp checkout. */
function runBaseCohort() {
  const tmp = mkdtempSync(join(tmpdir(), "fix14-base-"));
  try {
    sh("git", ["archive", BASE_SHA, "-o", join(tmp, "base.tar")]);
    sh("tar", ["-xf", join(tmp, "base.tar"), "-C", tmp]);
    const worker = `#!/usr/bin/env node
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";
const rootDir = process.argv[2];
const outPath = process.argv[3];
const mod = (rel) => import(pathToFileURL(rootDir.replace(/\\\\$/,"") + "/" + rel).href);
const { hashSeed, createRng } = await mod("js/simulation/rng.js");
const { pickThreeAcademies } = await mod("js/simulation/narrativeAcademySeason.js");
const { ACADEMY_POOL } = await mod("js/data/leagues.js");
const { academyNationOf } = await mod("js/data/academyOfferStories.js");
const { regionDistance } = await mod("js/data/academyGeography.js");

const NATIONS = ${JSON.stringify(NATIONS)};
const N = ${N};
const PREFIX = ${JSON.stringify(PREFIX)};
const rows = [];

function canonicalizeNation(raw) {
  if (raw == null) return null;
  const t = String(raw).trim();
  const map = {
    usa: "United States",
    "united states of america": "United States",
    türkiye: "Turkey",
    czechia: "Czech Republic",
    holland: "Netherlands",
    "korea republic": "South Korea",
  };
  return map[t.toLowerCase()] || t;
}

for (const nation of NATIONS) {
  for (let i = 0; i < N; i++) {
    const seed = hashSeed(PREFIX + "|" + nation + "|" + i);
    const rng = createRng(seed);
    const orig = Math.random;
    Math.random = () => rng.random();
    let offers;
    try {
      offers = pickThreeAcademies(ACADEMY_POOL, nation, "Fix14 " + nation + " " + i);
    } finally {
      Math.random = orig;
    }
    const parents = offers.map((o) => {
      const nat = canonicalizeNation(academyNationOf(o.academy));
      return {
        clubId: o.academy.parentClub?.clubId || null,
        parentName: o.academy.parentClub?.name || o.academy.name,
        nation: nat,
        isHome: o.isHome,
        divisionLevel: o.academy.parentClub?.divisionLevel ?? null,
        distance: o.isHome ? 0 : regionDistance(canonicalizeNation(nation), nat),
      };
    });
    const homeCount = parents.filter((p) => p.isHome).length;
    const abroad = parents.filter((p) => !p.isHome);
    const trayKind = homeCount === parents.length ? "all-home" : homeCount === 0 ? "all-abroad" : "mixed";
    // Base has no age; emit one baseline row reused for both ages.
    rows.push({
      side: "base",
      nationality: nation,
      age: null,
      index: i,
      seed,
      playerName: "Fix14 " + nation + " " + i,
      trayKind,
      parentIds: parents.map((p) => p.clubId || p.parentName),
      nations: parents.map((p) => p.nation),
      homeFlags: parents.map((p) => p.isHome),
      divisions: parents.map((p) => p.divisionLevel),
      distances: parents.map((p) => p.distance),
      firstAbroadDistance: abroad[0]?.distance ?? null,
      firstAbroadNation: abroad[0]?.nation ?? null,
    });
  }
}
writeFileSync(outPath, JSON.stringify(rows));
`;
    const workerPath = join(tmp, "_fix14_base_worker.mjs");
    writeFileSync(workerPath, worker);
    const outPath = join(tmp, "base-rows.json");
    const r = spawnSync(process.execPath, [workerPath, tmp, outPath], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (r.status !== 0) throw new Error(`base worker failed: ${r.stderr || r.stdout}`);
    return JSON.parse(readFileSync(outPath, "utf8"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

await mkdir(OUT_DIR, { recursive: true });
console.log("Running accepted-base cohort…");
const baseRows = runBaseCohort();
console.log(`base rows: ${baseRows.length}`);

console.log("Running final cohort…");
const finalRows = [];
for (const nation of NATIONS) {
  for (const age of AGES) {
    for (let i = 0; i < N; i++) {
      const seed = hashSeed(`${PREFIX}|${nation}|${i}`);
      const offers = pickThreeAcademies(ACADEMY_POOL, nation, `Fix14 ${nation} ${i}`, { age, seed });
      finalRows.push(rowFromOffers({ nation, age, seed, index: i, side: "final", offers }));
    }
  }
}
console.log(`final rows: ${finalRows.length}`);

const paired = [];
for (const nation of NATIONS) {
  for (let i = 0; i < N; i++) {
    const base = baseRows.find((r) => r.nationality === nation && r.index === i);
    for (const age of AGES) {
      const fin = finalRows.find((r) => r.nationality === nation && r.age === age && r.index === i);
      paired.push({
        nationality: nation,
        age,
        index: i,
        seed: fin.seed,
        playerName: fin.playerName,
        base,
        final: fin,
      });
    }
  }
}

const failures = [];
const summary = {
  baseSha: BASE_SHA,
  finalSha,
  prefix: PREFIX,
  nations: NATIONS,
  ages: AGES,
  seedsPerNation: N,
  pairedRows: paired.length,
  byNationAge: {},
  failures: [],
};

function rate(rows, pred) {
  return rows.length ? rows.filter(pred).length / rows.length : 0;
}

for (const nation of NATIONS) {
  for (const age of AGES) {
    const rows = paired.filter((p) => p.nationality === nation && p.age === age);
    const finals = rows.map((r) => r.final);
    const bases = rows.map((r) => r.base);
    const mixedFinal = rate(finals, (r) => r.trayKind === "mixed");
    const allHomeFinal = rate(finals, (r) => r.trayKind === "all-home");
    const allAbroadFinal = rate(finals, (r) => r.trayKind === "all-abroad");
    const mixedBase = rate(bases, (r) => r.trayKind === "mixed");
    const uniqueTrays = new Set(finals.map((r) => r.parentIds.join("|"))).size;
    const uniqueParents = new Set(finals.flatMap((r) => r.parentIds)).size;
    const destHist = {};
    const distHist = {};
    let firstAbroadNear = 0;
    let firstAbroadTotal = 0;
    let homeDivMix = 0;
    let dupParents = 0;
    let ltTwoHome = 0;
    let ghanaNationFail = 0;

    for (const r of finals) {
      if (new Set(r.parentIds).size !== r.parentIds.length) dupParents += 1;
      const homes = r.homeFlags.filter(Boolean).length;
      if (nation !== "Ghana" && homes < 2) ltTwoHome += 1;
      if (nation === "England") {
        const homeDivs = r.divisions.filter((_, i) => r.homeFlags[i]).slice(0, 2);
        if (new Set(homeDivs).size === 2) homeDivMix += 1;
      }
      if (nation === "Ghana") {
        if (!(r.trayKind === "all-abroad" && new Set(r.nations).size === 3)) ghanaNationFail += 1;
      }
      for (const n of r.nations) destHist[n] = (destHist[n] || 0) + 1;
      if (r.firstAbroadDistance != null) {
        firstAbroadTotal += 1;
        distHist[r.firstAbroadDistance] = (distHist[r.firstAbroadDistance] || 0) + 1;
        if (r.firstAbroadDistance <= 1) firstAbroadNear += 1;
      }
    }

    const block = {
      mixedFinal,
      allHomeFinal,
      allAbroadFinal,
      mixedBase,
      mixedLiftPp: (mixedFinal - mixedBase) * 100,
      uniqueTrays,
      uniqueParents,
      destHist,
      distHist,
      firstAbroadNearShare: firstAbroadTotal ? firstAbroadNear / firstAbroadTotal : null,
      englandHomeDivMix: nation === "England" ? homeDivMix / finals.length : null,
      dupParents,
      ltTwoHome,
      ghanaNationFail,
    };
    summary.byNationAge[`${nation}|${age}`] = block;

    if (nation !== "Ghana") {
      if (age === 16 && !(mixedFinal >= 0.2 && mixedFinal <= 0.34)) {
        failures.push(`${nation} age16 mixed ${mixedFinal}`);
      }
      if (age === 18 && !(mixedFinal >= 0.58 && mixedFinal <= 0.72)) {
        failures.push(`${nation} age18 mixed ${mixedFinal}`);
      }
      if (age === 18 && mixedFinal - mixedBase < 0.25) {
        failures.push(`${nation} age18 lift ${((mixedFinal - mixedBase) * 100).toFixed(1)}pp`);
      }
      if (ltTwoHome) failures.push(`${nation} age${age} trays with <2 home: ${ltTwoHome}`);
      if (dupParents) failures.push(`${nation} age${age} duplicate parents: ${dupParents}`);
    }
    if (nation === "England" && homeDivMix !== finals.length) {
      failures.push(`England age${age} division mix ${homeDivMix}/${finals.length}`);
    }
    if (nation === "Ghana" && ghanaNationFail) {
      failures.push(`Ghana age${age} nation diversity fails ${ghanaNationFail}`);
    }
    if (firstAbroadTotal && firstAbroadNear / firstAbroadTotal < 0.7) {
      failures.push(`${nation} age${age} first-abroad near share ${firstAbroadNear}/${firstAbroadTotal}`);
    }
  }
}

summary.failures = failures;
summary.ok = failures.length === 0;

const gzPath = join(OUT_DIR, "paired-rows.jsonl.gz");
await new Promise((resolve, reject) => {
  const out = createWriteStream(gzPath);
  const gz = createGzip();
  gz.pipe(out);
  out.on("finish", resolve);
  out.on("error", reject);
  gz.on("error", reject);
  for (const row of paired) {
    gz.write(`${JSON.stringify(row)}\n`);
  }
  gz.end();
});

await writeFile(join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) {
  console.error("COHORT FAILURES", failures);
  process.exit(1);
}
console.log(`Wrote ${gzPath}`);
console.log(`Wrote ${join(OUT_DIR, "summary.json")}`);
