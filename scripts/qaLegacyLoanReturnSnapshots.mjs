#!/usr/bin/env node
/**
 * Emit Item 2 legacy before/after snapshots + field diffs for the review ZIP.
 *
 *   OUT_DIR=/tmp/… node scripts/qaLegacyLoanReturnSnapshots.mjs
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = process.env.OUT_DIR || join(root, "qa/r2-02-evidence/item2-legacy");
const FIXTURE = join(root, "tests/fixtures/r2-02-legacy-coterminal-pending-1867753.json.gz");

function flatten(obj, prefix = "") {
  const out = {};
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      Object.assign(out, flatten(v, prefix ? `${prefix}.${k}` : k));
    }
  } else if (Array.isArray(obj)) {
    out[prefix || "$"] = `list[${obj.length}]`;
    for (let i = 0; i < Math.min(obj.length, 80); i++) {
      Object.assign(out, flatten(obj[i], `${prefix}[${i}]`));
    }
  } else {
    out[prefix || "$"] = obj;
  }
  return out;
}

function fieldDiffs(before, after, limit = 500) {
  const a = flatten(before);
  const b = flatten(after);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const diffs = [];
  for (const k of keys) {
    const av = a[k];
    const bv = b[k];
    if (JSON.stringify(av) !== JSON.stringify(bv)) {
      diffs.push({ path: k, before: av ?? null, after: bv ?? null });
      if (diffs.length >= limit) break;
    }
  }
  return diffs;
}

function slimPlayer(player) {
  return {
    club: player?.club
      ? {
          clubId: player.club.clubId,
          leagueId: player.club.leagueId,
          name: player.club.name,
          isLoanSpell: player.club.isLoanSpell,
        }
      : null,
    employmentClubId: player?.employmentClubId || null,
    playingClubId: player?.playingClubId || null,
    pendingContractReview: player?.pendingContractReview
      ? { status: player.pendingContractReview.status, reviewId: player.pendingContractReview.reviewId }
      : null,
    activeLoan: player?.activeLoan
      ? {
          status: player.activeLoan.status,
          parentClubId: player.activeLoan.parentClubId,
          borrowingClubId: player.activeLoan.borrowingClubId,
          endDate: player.activeLoan.endDate || null,
        }
      : null,
    playingStints: (player?.playingStints || []).map((s) => ({
      stintId: s.stintId,
      kind: s.kind,
      from: s.from,
      to: s.to,
      playingClubId: s.playingClubId,
      leagueId: s.leagueId,
      onLoan: s.onLoan,
    })),
    seasonsCount: player?.seasons?.length ?? 0,
    consumedTransitionIds: [...(player?.consumedTransitionIds || [])],
  };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const raw = JSON.parse(gunzipSync(await readFile(FIXTURE)).toString("utf8"));
  const before = {
    producedByCommit: "186775393ce1b433543758816ee2bda4f68c0f32",
    stage: "before-repair",
    player: slimPlayer(raw.player),
  };

  const { deserializeCareerSnapshot } = await import(
    join(root, "js/simulation/careerSnapshot.js")
  );
  const { setWorldState, getWorldState } = await import(join(root, "js/simulation/worldState.js"));
  const { repairStalePendingLoanReturnBoundary, endLoan } = await import(
    join(root, "js/simulation/loanMarket.js")
  );
  const { acceptPipelineOffer } = await import(join(root, "js/simulation/dealPipeline.js"));
  const { simulateSeason } = await import(join(root, "js/simulation/seasonSimulator.js"));
  const { LEAGUES, LEAGUE_LOOKUP } = await import(join(root, "js/data/leagues.js"));

  const restored = deserializeCareerSnapshot(structuredClone(raw));
  if (restored.world) setWorldState(restored.world);
  const player = restored.player;
  const afterLoad = {
    stage: "after-load-repair",
    player: slimPlayer(player),
    repair: repairStalePendingLoanReturnBoundary(player, getWorldState()),
  };

  const renewal =
    (player.pendingOffers || []).find((o) => o.isRenewal) ||
    (player.pendingContractReview?.offers || []).find((o) => o.isRenewal);
  const accepted = acceptPipelineOffer(player, renewal);
  const afterAccept = {
    stage: "after-renewal-accept",
    acceptOk: Boolean(accepted?.ok),
    player: slimPlayer(player),
    repair: repairStalePendingLoanReturnBoundary(player, getWorldState()),
    duplicateEndLoan: endLoan(player, "return"),
  };

  const season = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  const afterSeason = {
    stage: "after-parent-season",
    seasonOk: Boolean(season?.season),
    player: slimPlayer(player),
  };

  const loadDiffs = fieldDiffs(before.player, afterLoad.player);
  const acceptDiffs = fieldDiffs(afterLoad.player, afterAccept.player);

  await writeFile(join(OUT_DIR, "item2-before.json"), JSON.stringify(before, null, 2));
  await writeFile(join(OUT_DIR, "item2-after-load-repair.json"), JSON.stringify(afterLoad, null, 2));
  await writeFile(join(OUT_DIR, "item2-after-accept.json"), JSON.stringify(afterAccept, null, 2));
  await writeFile(join(OUT_DIR, "item2-after-parent-season.json"), JSON.stringify(afterSeason, null, 2));
  await writeFile(
    join(OUT_DIR, "item2-field-diffs-before-vs-after-load.json"),
    JSON.stringify(
      {
        pair: "before→after-load-repair",
        fieldDiffCount: loadDiffs.length,
        fieldDiffs: loadDiffs,
      },
      null,
      2
    )
  );
  await writeFile(
    join(OUT_DIR, "item2-field-diffs-after-load-vs-after-accept.json"),
    JSON.stringify(
      {
        pair: "after-load→after-accept",
        fieldDiffCount: acceptDiffs.length,
        fieldDiffs: acceptDiffs,
      },
      null,
      2
    )
  );

  const summary = {
    ok:
      afterLoad.player.club?.leagueId === "league:england-championship" &&
      afterLoad.player.playingStints?.find((s) => String(s.kind).includes("loan_return"))?.from ===
        "2027-06-30" &&
      afterLoad.player.playingStints?.find((s) => s.kind === "loan_start")?.to === "2027-06-30" &&
      afterAccept.acceptOk === true &&
      afterAccept.repair?.repaired === false &&
      afterAccept.duplicateEndLoan?.duplicate === true &&
      afterSeason.seasonOk === true,
    outDir: OUT_DIR,
    loadDiffCount: loadDiffs.length,
    acceptDiffCount: acceptDiffs.length,
  };
  await writeFile(join(OUT_DIR, "item2-summary.json"), JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    console.error("FAIL", summary);
    process.exit(1);
  }
  console.log("PASS", JSON.stringify(summary));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
