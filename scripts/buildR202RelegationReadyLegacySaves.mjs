#!/usr/bin/env node
/**
 * Build dual pre-fix co-terminal saves from ui-relegation-ready @ seed 42:
 * Ipswich PL season → CH, season-long Arsenal loan while Ipswich promotes, then
 * pending-review return with the classic +1y / snapshot-league defect applied
 * (1867753-shaped). Emits before-renewal and after-renewal saves + field diffs.
 *
 *   OUT_DIR=… node scripts/buildR202RelegationReadyLegacySaves.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LEAGUES, LEAGUE_LOOKUP, LEAGUE_BY_ID } from "../js/data/leagues.js";
import { buildMembershipBrowserFixture } from "../js/simulation/membershipBrowserFixture.js";
import { startLoan, endLoan, resolveLoanReturnEffectiveDate } from "../js/simulation/loanMarket.js";
import { openBoundaryContractReview } from "../js/simulation/contractLifecycle.js";
import { acceptPipelineOffer } from "../js/simulation/dealPipeline.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import {
  commitForcedEditionResults,
  finalizeMembershipAfterSeason,
  resolveClubLeagueMetadata,
} from "../js/simulation/leagueMembership.js";
import { findSeniorClubById } from "../js/simulation/seniorClubs.js";
import { getWorldState, setWorldState } from "../js/simulation/worldState.js";
import { serializeCareerSnapshot } from "../js/simulation/careerSnapshot.js";
import { exportClubFinanceState } from "../js/simulation/clubFinance.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = process.env.OUT_DIR || join(root, "tests/fixtures");
const EVIDENCE_DIR = process.env.EVIDENCE_DIR || join(root, "qa/r2-02-evidence/item2-relegation-ready");

const IPSWICH = "club:england:ipswich-town";
const ARSENAL = "club:england:arsenal";
const PL = "league:england-premier-league";
const CH = "league:england-championship";
const BASE_COMMIT = "186775393ce1b433543758816ee2bda4f68c0f32";

function orderWithClubAt(clubIds, clubId, position) {
  const rest = clubIds.filter((id) => id !== clubId);
  const idx = Math.max(0, Math.min(rest.length, position - 1));
  return [...rest.slice(0, idx), clubId, ...rest.slice(idx)];
}

function slimFinance(player, world) {
  try {
    return exportClubFinanceState?.(world) || null;
  } catch {
    return {
      parent: player?.clubFinance || null,
    };
  }
}

function fieldDiffs(before, after, limit = 400) {
  const flatten = (obj, prefix = "", out = {}) => {
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      for (const [k, v] of Object.entries(obj)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
    } else if (Array.isArray(obj)) {
      out[prefix || "$"] = `list[${obj.length}]`;
      for (let i = 0; i < Math.min(obj.length, 60); i++) flatten(obj[i], `${prefix}[${i}]`, out);
    } else {
      out[prefix || "$"] = obj;
    }
    return out;
  };
  const a = flatten(before);
  const b = flatten(after);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const diffs = [];
  for (const k of keys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
      diffs.push({ path: k, before: a[k] ?? null, after: b[k] ?? null });
      if (diffs.length >= limit) break;
    }
  }
  return diffs;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(EVIDENCE_DIR, { recursive: true });

  const ready = buildMembershipBrowserFixture({ mode: "ui-relegation-ready", seed: 42 });
  if (!ready.ok) throw new Error(`ui-relegation-ready failed: ${ready.reason}`);
  const player = ready.player;
  const world = getWorldState();
  const startYear = player.startYear || 2026;
  const loanYear = startYear + 1;

  const arsenal = findSeniorClubById(ARSENAL);
  if (!arsenal) throw new Error("arsenal missing");
  // endSeason is absolute completed-season count at expiry. After ui-relegation-ready
  // the player already has 1 season; a season-long loan must expire after the next one.
  const endSeason = (player.seasons?.length || 0) + 1;
  const loaned = startLoan(player, {
    isLoan: true,
    wage: 5000,
    expectedRole: "starter",
    clubId: ARSENAL,
    club: arsenal,
    loanTerms: {
      loanId: "r2-02-relegation-ready-arsenal-loan",
      borrowingClubId: ARSENAL,
      parentClubId: IPSWICH,
      borrowerWageShare: 0.5,
      parentWageShare: 0.5,
      loanFee: 0,
      endSeason,
      startDate: `${loanYear}-07-15`,
    },
  });
  if (!loaned.ok) throw new Error(`loan failed: ${loaned.reason}`);

  // Bias Ipswich to win Championship promotion during the Arsenal loan season.
  function biasClub(leagueId, targetId, high) {
    for (const id of world.leagueMemberships.get(leagueId) || []) {
      const profile = world.clubs.get(id);
      if (!profile) continue;
      const strong = id === targetId;
      const v = high ? (strong ? 94 : 48) : strong ? 40 : 90;
      profile.overall = v;
      profile.attack = v;
      profile.midfield = v;
      profile.defence = v;
      profile.goalkeeper = Math.max(38, v - 2);
    }
  }
  biasClub(CH, IPSWICH, true);
  biasClub(PL, ARSENAL, false);

  const done = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
    pauseForDecisions: false,
    autoDecisionPolicy: "stay",
  });
  if (!done?.season) throw new Error("arsenal season incomplete");

  if (!(world.leagueMemberships.get(PL) || []).includes(IPSWICH)) {
    const year = loanYear;
    const key = `england::${year}`;
    world.membershipTransitions?.delete?.(key);
    const ch = world.leagueEditionRosters.get(`${CH}::${year}`)?.clubIds;
    const pl = world.leagueEditionRosters.get(`${PL}::${year}`)?.clubIds;
    if (!ch || !pl) throw new Error(`missing edition freeze for ${year}`);
    const orderedCh = orderWithClubAt(ch, IPSWICH, 1);
    commitForcedEditionResults(LEAGUE_BY_ID.get(CH), year, orderedCh, world);
    commitForcedEditionResults(LEAGUE_BY_ID.get(PL), year, pl, world);
    const fin = finalizeMembershipAfterSeason({
      completedLeague: LEAGUE_BY_ID.get(CH),
      completedSeasonYear: year,
      world,
      completedClubId: IPSWICH,
      force: true,
    });
    if (!fin.ok && !fin.alreadyApplied) {
      throw new Error(`parent promotion failed: ${fin.reason}`);
    }
  }

  const liveAfterPromo = resolveClubLeagueMetadata(IPSWICH, world)?.leagueId;
  if (liveAfterPromo !== PL) {
    throw new Error(`expected Ipswich in PL after promotion, got ${liveAfterPromo}`);
  }

  // Co-terminal: open parent boundary review while loan still active, then soft-settle.
  if (player.activeLoan?.status !== "active") {
    throw new Error(`loan should still be active after Arsenal season, got ${player.activeLoan?.status}`);
  }
  player.contractEndSeason = player.seasons.length;
  openBoundaryContractReview(player, { performanceScore: 100, financeOk: true });
  const { generatePipelineOffers } = await import("../js/simulation/dealPipeline.js");
  const gen = generatePipelineOffers(player, {
    performanceScore: 100,
    reviewPhase: "boundary",
    forceReevaluate: true,
    forceGenerate: true,
  });
  const renewalOffer = (gen.offers || []).find((o) => o.isRenewal) || null;
  if (!renewalOffer) throw new Error("renewal missing after boundary review");
  player.pendingOffers = [renewalOffer];
  if (player.pendingContractReview) player.pendingContractReview.offers = [renewalOffer];

  const ended = endLoan(player, "return");
  if (!ended.ok && !ended.duplicate) throw new Error(`endLoan failed: ${ended.reason}`);
  const returnKind = [...(player.playingStints || [])]
    .reverse()
    .find((s) => String(s.kind || "").includes("loan_return"))?.kind;
  if (returnKind !== "loan_return_pending_review") {
    throw new Error(`expected pending-review return stint, got ${returnKind}`);
  }

  const expectedDate = resolveLoanReturnEffectiveDate(player, player.activeLoan, {});
  if (expectedDate !== "2028-06-30") {
    throw new Error(`expected return date 2028-06-30, got ${expectedDate}`);
  }

  // Serialize clean tips first (ensureTransferSave would otherwise repair), then
  // stamp the 1867753-shaped defect into the archived JSON payloads.
  const consumedBefore = [...(player.consumedTransitionIds || [])];
  const financeBefore = slimFinance(player, world);
  const cleanBefore = serializeCareerSnapshot({ player, world });
  const defectMeta = {
    late: `${Number(String(expectedDate).slice(0, 4)) + 1}-${String(expectedDate).slice(5)}`,
    returnStintId: cleanBefore.player?.playingStints?.find((s) => s.kind === "loan_return_pending_review")
      ?.stintId,
    borrowerStintId: cleanBefore.player?.playingStints?.find(
      (s) => s.playingClubId === ARSENAL || s.kind === "loan_start"
    )?.stintId,
  };
  function stampDefect(snap) {
    const playerSnap = snap.player;
    const returnStint = (playerSnap.playingStints || []).find(
      (s) => s.stintId === defectMeta.returnStintId || s.kind === "loan_return_pending_review"
    );
    const borrower = (playerSnap.playingStints || []).find(
      (s) => s.stintId === defectMeta.borrowerStintId || s.playingClubId === ARSENAL
    );
    if (!returnStint) throw new Error("stamp: missing return stint");
    returnStint.from = defectMeta.late;
    returnStint.leagueId = CH;
    if (borrower) borrower.to = defectMeta.late;
    if (playerSnap.club?.clubId === IPSWICH) {
      playerSnap.club = {
        ...playerSnap.club,
        leagueId: CH,
        league: "England - Championship",
        leagueDisplay: "Championship",
        divisionLevel: 2,
      };
    }
    return snap;
  }
  const beforeRenewal = stampDefect(structuredClone(cleanBefore));
  const beforePath = join(OUT_DIR, "r2-02-legacy-relegation-ready-before-renewal-1867753.json.gz");
  await writeFile(beforePath, gzipSync(Buffer.from(JSON.stringify(beforeRenewal))));

  const renewal =
    (player.pendingOffers || []).find((o) => o.isRenewal) ||
    (player.pendingContractReview?.offers || []).find((o) => o.isRenewal) ||
    renewalOffer;
  if (!renewal) throw new Error("renewal missing");
  const accepted = acceptPipelineOffer(player, renewal);
  if (!accepted?.ok) throw new Error(`accept failed: ${accepted?.reason}`);

  const cleanAfter = serializeCareerSnapshot({ player, world: getWorldState() });
  const afterRenewal = stampDefect(structuredClone(cleanAfter));
  const afterPath = join(OUT_DIR, "r2-02-legacy-relegation-ready-after-renewal-1867753.json.gz");
  await writeFile(afterPath, gzipSync(Buffer.from(JSON.stringify(afterRenewal))));
  const defect = defectMeta;

  const meta = {
    producedByCommit: BASE_COMMIT,
    seed: 42,
    mode: "ui-relegation-ready",
    borrowerId: ARSENAL,
    parentId: IPSWICH,
    expectedReturnDate: expectedDate,
    defectLateDate: defect.late,
    defectLeagueId: CH,
    liveLeagueIdAfterPromotion: PL,
    seasonsBeforeReturn: player.seasons?.length ?? null,
    consumedTransitionIds: consumedBefore,
    beforeRenewalPath: "tests/fixtures/r2-02-legacy-relegation-ready-before-renewal-1867753.json.gz",
    afterRenewalPath: "tests/fixtures/r2-02-legacy-relegation-ready-after-renewal-1867753.json.gz",
    returnStintId: defect.returnStintId,
    borrowerStintId: defect.borrowerStintId,
  };
  await writeFile(
    join(OUT_DIR, "r2-02-legacy-relegation-ready-1867753.meta.json"),
    JSON.stringify(meta, null, 2)
  );

  // Evidence copies + field diffs between the two legacy saves and repair tips.
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(join(EVIDENCE_DIR, "before-renewal.json.gz"), gzipSync(Buffer.from(JSON.stringify(beforeRenewal))));
  await writeFile(join(EVIDENCE_DIR, "after-renewal.json.gz"), gzipSync(Buffer.from(JSON.stringify(afterRenewal))));
  const tip = (snap) => {
    const ret = (snap.player?.playingStints || []).find(
      (s) => s.stintId === defect.returnStintId || s.kind === "loan_return_pending_review"
    );
    const bor = (snap.player?.playingStints || []).find(
      (s) => s.stintId === defect.borrowerStintId || s.playingClubId === ARSENAL
    );
    return {
      clubLeagueId: snap.player?.club?.leagueId,
      review: snap.player?.pendingContractReview?.status ?? null,
      returnFrom: ret?.from ?? null,
      returnLeagueId: ret?.leagueId ?? null,
      borrowerTo: bor?.to ?? null,
      consumed: snap.player?.consumedTransitionIds,
      seasons: snap.player?.seasons?.length,
      financeTx: Object.fromEntries(
        Object.entries(snap.clubFinance?.ledgers || {}).map(([k, v]) => [
          k,
          {
            cashAvailable: v?.cashAvailable ?? null,
            completedTransactionIds: v?.completedTransactionIds || [],
            loanFeeAndWageCommitments: v?.loanFeeAndWageCommitments ?? null,
          },
        ])
      ),
    };
  };
  const saveDiffs = fieldDiffs(tip(beforeRenewal), tip(afterRenewal));
  await writeFile(
    join(EVIDENCE_DIR, "field-diffs-before-vs-after-renewal-save.json"),
    JSON.stringify(
      { pair: "before-renewal-save→after-renewal-save", fieldDiffCount: saveDiffs.length, fieldDiffs: saveDiffs },
      null,
      2
    )
  );
  const repairBefore = fieldDiffs(tip(beforeRenewal), tip(cleanBefore));
  const repairAfter = fieldDiffs(tip(afterRenewal), tip(cleanAfter));
  await writeFile(
    join(EVIDENCE_DIR, "field-diffs-before-renewal-repair.json"),
    JSON.stringify(
      { pair: "before-renewal-defective→repaired", fieldDiffCount: repairBefore.length, fieldDiffs: repairBefore },
      null,
      2
    )
  );
  await writeFile(
    join(EVIDENCE_DIR, "field-diffs-after-renewal-repair.json"),
    JSON.stringify(
      { pair: "after-renewal-defective→repaired", fieldDiffCount: repairAfter.length, fieldDiffs: repairAfter },
      null,
      2
    )
  );
  await writeFile(join(EVIDENCE_DIR, "meta.json"), JSON.stringify({ ...meta, financeBefore }, null, 2));

  console.log(
    JSON.stringify(
      {
        ok: true,
        expectedDate,
        defectLate: defect.late,
        beforePath,
        afterPath,
        seasons: player.seasons?.length,
        live: liveAfterPromo,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
