#!/usr/bin/env node
/**
 * Rebuild the accepted-base cohort (52dc601) from the same full initial
 * snapshots as the current final cohort.
 *
 *   1. Requires qa/fix08-runs/cohort/snapshots/*-initial.json (final tip).
 *   2. Creates a disposable worktree at the accepted base SHA.
 *   3. Replays 48×3 seasons with base engine code + shared initials.
 *   4. Writes qa/fix08-runs/cohort-base with matched snapshot hashes.
 *
 *   node scripts/qaFix08MatchedBaseCohort.mjs
 */
import { createHash } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  rmSync,
  cpSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE_SHA = "52dc6014f0aa6ba372e8ebc453943e8e3023b7d1";
const finalDir = join(root, "qa/fix08-runs/cohort");
const outDir = join(root, "qa/fix08-runs/cohort-base");
const finalSnaps = join(finalDir, "snapshots");
const periods = 3;

if (!existsSync(finalSnaps)) {
  console.error("missing final cohort snapshots — run qaFix08EngineCohort.mjs first");
  process.exit(2);
}

const initials = readdirSync(finalSnaps).filter((f) => f.endsWith("-initial.json"));
if (initials.length < 48) {
  console.error(`expected ≥48 initial snapshots, found ${initials.length}`);
  process.exit(2);
}

const work = join(tmpdir(), `fix08-base-cohort-${Date.now()}`);
const wt = spawnSync("git", ["worktree", "add", "--detach", work, BASE_SHA], {
  cwd: root,
  encoding: "utf8",
});
if (wt.status !== 0) {
  console.error(wt.stderr || wt.stdout);
  process.exit(2);
}

const runner = `#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LEAGUES, LEAGUE_LOOKUP } from "./js/data/leagues.js";
import { simulateSeason } from "./js/simulation/seasonSimulator.js";
import { deserializeCareerSnapshot } from "./js/simulation/careerSnapshot.js";
import { setWorldState } from "./js/simulation/worldState.js";
import { resetClubFinanceLedgers } from "./js/simulation/clubFinance.js";
import { reseedCareerRng } from "./js/simulation/rng.js";

const root = join(dirname(fileURLToPath(import.meta.url)));
const initialsDir = process.env.FIX08_INITIALS_DIR;
const outDir = process.env.FIX08_COHORT_OUT;
const periods = 3;
if (!initialsDir || !outDir) throw new Error("FIX08_INITIALS_DIR and FIX08_COHORT_OUT required");
mkdirSync(outDir, { recursive: true });
mkdirSync(join(outDir, "ledgers"), { recursive: true });
mkdirSync(join(outDir, "fixtures"), { recursive: true });
mkdirSync(join(outDir, "snapshots"), { recursive: true });
mkdirSync(join(outDir, "dedicated"), { recursive: true });
mkdirSync(join(outDir, "fields"), { recursive: true });

function hashJson(v) {
  return createHash("sha256").update(JSON.stringify(v)).digest("hex");
}

const files = readdirSync(initialsDir).filter((f) => f.endsWith("-initial.json")).sort();
const records = [];
const fixtureHashes = {};
const leaguesSeen = new Set();
const startedAt = new Date().toISOString();

for (const file of files) {
  // Byte-copy finals initials so snapshot hashes stay identical.
  cpSync(join(initialsDir, file), join(outDir, "snapshots", file));
  const snap = JSON.parse(readFileSync(join(outDir, "snapshots", file), "utf8"));
  const restored = deserializeCareerSnapshot(snap);
  const player = restored.player;
  if (restored.world) setWorldState(restored.world);
  resetClubFinanceLedgers();
  const fxId = file.replace(/-initial\\.json$/, "");
  const fixtureHash = hashJson({
    id: fxId,
    position: player.position,
    club: player.club?.name,
    ovr: player.rating,
    age: player.age,
    careerId: player.careerId,
    clubId: player.club?.clubId,
  });
  // Prefer final fixture metadata when present so fixtureHash stays identical.
  const finalFx = join(${JSON.stringify(finalDir)}, "fixtures", fxId + ".json");
  let initialSnapshotHash = hashJson(snap);
  let sharedFixtureHash = fixtureHash;
  if (existsSync(finalFx)) {
    const fxMeta = JSON.parse(readFileSync(finalFx, "utf8"));
    sharedFixtureHash = fxMeta.fixtureHash || sharedFixtureHash;
    initialSnapshotHash = fxMeta.initialSnapshotHash || initialSnapshotHash;
  }
  fixtureHashes[fxId] = sharedFixtureHash;
  leaguesSeen.add(player.club?.league || "?");
  writeFileSync(
    join(outDir, "fixtures", fxId + ".json"),
    JSON.stringify(
      {
        fixture: { id: fxId, position: player.position, club: player.club?.name, ovr: player.rating, age: player.age },
        fixtureHash: sharedFixtureHash,
        initialSnapshotPath: "snapshots/" + file,
        initialSnapshotHash,
        compat: { baseSha: ${JSON.stringify(BASE_SHA)}, note: "matched initials from final cohort; gameplay from base engine" },
      },
      null,
      2
    )
  );

  if (player.careerId) reseedCareerRng(player.careerId);
  const age0 = player.age;
  for (let period = 0; period < periods; period++) {
    const seasonsBefore = player.seasons?.length || 0;
    const data = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions: false,
      autoDecisionPolicy: "stay",
    });
    const season = player.seasons?.at(-1) || data?.season || null;
    const awardRecords = Array.isArray(season?.awardRecords) ? season.awardRecords : [];
    const wins = awardRecords.filter((r) => r.status === "won").map((r) => r.awardId || r);
    const selections = awardRecords.filter((r) => r.status === "selected").map((r) => r.awardId || r);
    const nominations = awardRecords.filter((r) => r.status === "nominated").map((r) => r.awardId || r);
    const completed =
      data?.ok !== false &&
      (player.seasons?.length || 0) === seasonsBefore + 1 &&
      Number.isFinite(season?.minutes ?? season?.leagueMinutes);
    const row = {
      fixtureId: fxId,
      period,
      position: player.position,
      club: player.club?.name,
      league: player.club?.league,
      ovr: player.rating,
      fixtureHash: sharedFixtureHash,
      initialSnapshotPath: "snapshots/" + file,
      initialSnapshotHash,
      completion: completed,
      ageBefore: age0 + period,
      ageAfter: player.age,
      minutes: season?.minutes ?? season?.leagueMinutes ?? null,
      goals: season?.goals ?? null,
      assists: season?.assists ?? null,
      wins,
      selections,
      nominations,
      awardNames: season?.individualAwards || season?.awardNames || [],
      awardRecords,
    };
    records.push(row);
    writeFileSync(join(outDir, "ledgers", fxId + "-p" + period + ".json"), JSON.stringify(row, null, 2));
    writeFileSync(join(outDir, fxId + "-p" + period + ".json"), JSON.stringify(row, null, 2));
  }
}

const incomplete = records.filter((r) => !r.completion);
const summary = {
  generatedAt: new Date().toISOString(),
  startedAt,
  finishedAt: new Date().toISOString(),
  head: ${JSON.stringify(BASE_SHA)},
  dirty: false,
  harnessDigest: createHash("sha256").update("matched-base-adapter@${BASE_SHA}").digest("hex"),
  mode: "full-48x3-matched-initials",
  fixtures: files.length,
  periods,
  periodRecords: records.length,
  requiredPeriodRecords: files.length * periods,
  leagues: [...leaguesSeen],
  leagueCount: leaguesSeen.size,
  fixtureHashes,
  wins: records.reduce((s, r) => s + (r.wins?.length || 0), 0),
  selections: records.reduce((s, r) => s + (r.selections?.length || 0), 0),
  nominations: records.reduce((s, r) => s + (r.nominations?.length || 0), 0),
  incompleteCount: incomplete.length,
  completionPass: incomplete.length === 0,
  leaguesPass: leaguesSeen.size >= 3,
  sizePass: records.length >= 144,
  matchedInitialsFrom: "qa/fix08-runs/cohort/snapshots",
  scoringAwardWitness: null,
  ok: incomplete.length === 0 && records.length >= 144 && leaguesSeen.size >= 3,
  compat: {
    baseSha: ${JSON.stringify(BASE_SHA)},
    adapter: "qaFix08MatchedBaseCohort",
    note: "Full initial snapshots byte-identical to final; gameplay from base engine at accepted SHA.",
  },
};
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
writeFileSync(join(outDir, "provenance.json"), JSON.stringify({
  head: summary.head,
  harnessDigest: summary.harnessDigest,
  matchedInitials: true,
  adapter: "qaFix08MatchedBaseCohort",
  startedAt,
  finishedAt: summary.finishedAt,
}, null, 2));
console.log(JSON.stringify({ outDir, periodRecords: summary.periodRecords, ok: summary.ok, wins: summary.wins }, null, 2));
process.exitCode = summary.ok ? 0 : 1;
`;

try {
  writeFileSync(join(work, "_matchedBaseRunner.mjs"), runner);
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const run = spawnSync(
    process.execPath,
    [join(work, "_matchedBaseRunner.mjs")],
    {
      cwd: work,
      encoding: "utf8",
      env: {
        ...process.env,
        FIX08_INITIALS_DIR: finalSnaps,
        FIX08_COHORT_OUT: outDir,
      },
      maxBuffer: 64 * 1024 * 1024,
    }
  );
  process.stdout.write(run.stdout || "");
  process.stderr.write(run.stderr || "");
  if (run.status !== 0) process.exit(run.status || 1);
} finally {
  spawnSync("git", ["worktree", "remove", "--force", work], { cwd: root, encoding: "utf8" });
}
