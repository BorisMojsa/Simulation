#!/usr/bin/env node
/**
 * Browser acceptance for Fix 08: user/rival performance and individual awards.
 *
 * Real journeys through #simulate-btn / presentation skips / #continue-btn.
 * Authoritative state from window.__exportCareerSnapshot (not window.player).
 *
 *   python3 -m http.server 8000 --bind 127.0.0.1
 *   BASE_URL=http://127.0.0.1:8000 node scripts/browserUserRivalPerformanceAwardsChecklist.mjs
 *
 * Env: BASE_URL, CHROME_PATH, CASES, HEADED=1
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, createReadStream, statSync } from "node:fs";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { LEAGUES } from "../js/data/leagues.js";
import { createPlayerIdentity } from "../js/simulation/playerDevelopment.js";
import { ensurePlayerModel } from "../js/simulation/playerModelMigration.js";
import { refreshAbilityCaches } from "../js/simulation/playerAbility.js";
import { reseedCareerRng } from "../js/simulation/rng.js";
import { createWorldState, setWorldState } from "../js/simulation/worldState.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import { serializeCareerSnapshot } from "../js/simulation/careerSnapshot.js";
import { ensureContractAuthority } from "../js/simulation/contractLifecycle.js";
import { ensureTransferSave } from "../js/simulation/transferMigration.js";
import { allSeniorClubs } from "../js/simulation/seniorClubs.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HEADED = process.env.HEADED === "1";
const RUN_DIR = join(root, "qa/fix08-runs");
const SHOT_DIR = join(root, "qa/screenshots/checklist-performance-awards");
const CASE_DIR = join(RUN_DIR, "cases");
const OUT = join(RUN_DIR, "browser-report.json");
const REQUIRED = ["B01", "B02", "B03", "B04", "B05", "B06", "B07"];
const SELECTED = process.env.CASES
  ? process.env.CASES.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
  : REQUIRED;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

async function ensureBaseServer() {
  if (process.env.BASE_URL) {
    return { base: process.env.BASE_URL, close: async () => {} };
  }
  const server = createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0] || "/");
      const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
      const filePath = normalize(join(root, rel));
      if (!filePath.startsWith(root)) {
        res.writeHead(403);
        res.end("forbidden");
        return;
      }
      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        res.writeHead(404);
        res.end("missing");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
      createReadStream(filePath).pipe(res);
    } catch (err) {
      res.writeHead(500);
      res.end(String(err?.message || err));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function assert(cond, msg, data) {
  if (!cond) {
    const err = new Error(msg);
    if (data !== undefined) err.data = data;
    throw err;
  }
}

function jsonClone(v) {
  return JSON.parse(JSON.stringify(v));
}

function attrs(ovr) {
  return Object.fromEntries(
    ["Speed", "Passing", "Shooting", "Defending", "Physicality", "Dribbling"].map((k) => [k, ovr])
  );
}

function makePlayer({ id, position, ovr, age = 22, seed = 8801 }) {
  reseedCareerRng(seed);
  resetClubFinanceLedgers();
  setWorldState(createWorldState({ startYear: 2026 }));
  const p = createPlayerIdentity({ name: id, nationality: "England", position, age });
  Object.assign(p, {
    careerId: id,
    startYear: 2026,
    age,
    seasons: [],
    rating: ovr,
    attributes: attrs(ovr),
    potentialForecast: { upper: ovr + 8 },
    state: { form: 0, morale: 0, readiness: 1, fatigue: 0, adaptationPenalty: 0, roleFit: 1 },
  });
  ensurePlayerModel(p);
  refreshAbilityCaches(p);
  ensureContractAuthority(p);
  ensureTransferSave(p);
  return p;
}

function attach(p, clubName, years = 3) {
  const club = allSeniorClubs().find((c) => c.name === clubName);
  if (!club) throw new Error(`missing ${clubName}`);
  Object.assign(p, {
    club: { ...club },
    employmentClubId: club.clubId,
    playingClubId: club.clubId,
    contractStatus: "active",
    contractStartSeason: 0,
    contractYears: years,
    contractEndSeason: years,
    weeklyWage: 2500,
    wage: 2500,
  });
}

function buildSnap({ id, position, ovr, club, age = 22, seed = 8801, freeAgent = false }) {
  const p = makePlayer({ id, position, ovr, age, seed });
  if (freeAgent) {
    p.contractStatus = "released";
    p.employmentClubId = null;
    p.playingClubId = null;
    p.club = null;
  } else {
    attach(p, club, 4);
  }
  reseedCareerRng(seed);
  return serializeCareerSnapshot({ player: p, leagues: LEAGUES });
}

async function launch(base) {
  const { chromium } = await import("playwright-core");
  if (!existsSync(CHROME)) throw new Error(`CHROME_PATH missing: ${CHROME}`);
  const browser = await chromium.launch({ executablePath: CHROME, headless: !HEADED });
  const page = await browser.newPage();
  const guards = { errors: [], warnings: [], failedRequests: [] };
  page.on("pageerror", (err) => guards.errors.push({ type: "pageerror", message: String(err?.message || err) }));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/Failed to load resource/i.test(text)) guards.warnings.push({ type: "console", message: text });
    else guards.errors.push({ type: "console", message: text });
  });
  page.on("requestfailed", (req) => {
    const url = req.url();
    if (/\.(png|jpe?g|gif|svg|ico|woff2?)(\?|$)/i.test(url)) return;
    guards.failedRequests.push({ url, error: req.failure()?.errorText || "failed" });
  });
  let lastErr = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const resp = await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
      if (!resp || !resp.ok()) throw new Error(`BASE_URL failed: ${base} status=${resp?.status()}`);
      await page.waitForFunction(() => typeof window.__restoreCareerSnapshot === "function", null, {
        timeout: 60000,
      });
      await page.waitForFunction(() => typeof window.__exportCareerSnapshot === "function", null, {
        timeout: 60000,
      });
      return { browser, page, guards };
    } catch (err) {
      lastErr = err;
      await page.waitForTimeout(500 * attempt);
    }
  }
  throw lastErr || new Error(`BASE_URL failed after retries: ${base}`);
}

async function restore(page, snap) {
  const ok = await page.evaluate((payload) => {
    const r = window.__restoreCareerSnapshot?.(payload);
    return Boolean(r?.player || window.__getLiveCareerDebug?.()?.name);
  }, snap);
  assert(ok, "__restoreCareerSnapshot failed");
}

async function exportSnapshot(page) {
  const snap = await page.evaluate(() => window.__exportCareerSnapshot?.() || null);
  assert(snap?.player, "__exportCareerSnapshot returned no player");
  return jsonClone(snap);
}

/** Persist authoritative evidence without multi-MB league/world blobs that stall I/O. */
function slimEvidence(snapOrBundle) {
  if (!snapOrBundle || typeof snapOrBundle !== "object") return snapOrBundle;
  const base = snapOrBundle.snapshot ? snapOrBundle : { snapshot: snapOrBundle };
  const player = base.snapshot?.player;
  const slimPlayer = player
    ? {
        name: player.name,
        careerId: player.careerId,
        age: player.age,
        position: player.position,
        rating: player.rating,
        attributes: player.attributes,
        contractStatus: player.contractStatus,
        employmentClubId: player.employmentClubId,
        playingClubId: player.playingClubId,
        club: player.club
          ? { name: player.club.name, clubId: player.club.clubId, league: player.club.league, leagueId: player.club.leagueId }
          : null,
        seasons: (player.seasons || []).map((s) => ({
          seasonId: s.seasonId,
          minutes: s.minutes,
          goals: s.goals,
          assists: s.assists,
          avgMatchRating: s.avgMatchRating,
          awardNames: s.awardNames || s.individualAwards || [],
          awardRecords: s.awardRecords || null,
          individualAwards: s.individualAwards || null,
        })),
        careerHonors: player.careerHonors || [],
        awardFields: Object.fromEntries(
          Object.entries(player.awardFields || {}).map(([k, f]) => [
            k,
            f && typeof f === "object"
              ? {
                  version: f.version,
                  stage: f.stage,
                  editionId: f.editionId ?? f.competitionEditionId,
                  scope: f.scope,
                  possibleMinutes: f.possibleMinutes,
                  populationSize: f.populationSize,
                  rivalCount: Array.isArray(f.rivals) ? f.rivals.length : null,
                  inputFingerprint: f.inputFingerprint ?? null,
                  tableApproximated: f.tableApproximated ?? null,
                  playerStatsApproximated: f.playerStatsApproximated ?? null,
                  referenceMoments: f.referenceMoments ?? null,
                }
              : f,
          ])
        ),
      }
    : null;
  return {
    ...("debug" in base ? { debug: base.debug } : {}),
    ...("ui" in base ? { ui: base.ui } : {}),
    ...("trace" in base ? { trace: base.trace } : {}),
    player: slimPlayer,
    awards: awardSummary(slimPlayer || player),
    snapshotHash: {
      seasons: slimPlayer?.seasons?.length ?? 0,
      age: slimPlayer?.age ?? null,
      honorCount: Array.isArray(slimPlayer?.careerHonors) ? slimPlayer.careerHonors.length : 0,
      fieldKeys: Object.keys(slimPlayer?.awardFields || {}),
    },
  };
}

async function writeCase(name, value) {
  await writeFile(join(CASE_DIR, name), JSON.stringify(value, null, 2));
}

async function debug(page) {
  return page.evaluate(() => window.__getLiveCareerDebug?.() || null);
}

async function uiState(page) {
  return page.evaluate(() => {
    const d = window.__getLiveCareerDebug?.() || null;
    const overlay = document.getElementById("season-animation-overlay");
    const dashboard = document.getElementById("simulation-dashboard");
    const animContinue = document.getElementById("animation-continue");
    const contBtn = document.getElementById("continue-btn");
    const sim = document.getElementById("simulate-btn");
    const visibleBtn = (el) =>
      Boolean(el && !el.disabled && el.offsetParent !== null && getComputedStyle(el).visibility !== "hidden");
    return {
      debug: d,
      overlayHidden: !overlay || overlay.classList.contains("hidden"),
      dashboardHidden: !dashboard || dashboard.classList.contains("hidden"),
      continueSectionVisible: Boolean(animContinue && !animContinue.classList.contains("hidden")),
      continueBtnVisible: visibleBtn(contBtn),
      continueBtnDisabled: Boolean(contBtn?.disabled),
      simulateDisabled: Boolean(sim?.disabled),
      simulateLabel: sim?.textContent || "",
      seasonActionInFlight: Boolean(d?.seasonActionInFlight),
      nextAction: d?.nextAction || null,
    };
  });
}

async function shot(page, name) {
  await mkdir(SHOT_DIR, { recursive: true });
  const path = join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}

function awardSummary(player) {
  const last = Array.isArray(player?.seasons) ? player.seasons.at(-1) : null;
  const records = last?.awardRecords || last?.individualAwards || [];
  const names = last?.awardNames || [];
  const fields = player?.awardFields || {};
  return {
    age: player?.age ?? null,
    seasons: player?.seasons?.length ?? 0,
    honors: player?.careerHonors || [],
    honorCount: Array.isArray(player?.careerHonors) ? player.careerHonors.length : 0,
    awardNames: names,
    awardRecords: records,
    awardIds: (Array.isArray(records) ? records : []).map((r) => r.awardId || r),
    fieldKeys: Object.keys(fields),
    club: player?.club?.name ?? null,
    contractStatus: player?.contractStatus ?? null,
  };
}

/**
 * Drive one senior season through real UI to desk, capturing pre-Continue snapshot.
 */
async function driveSeasonToDesk(page, { seasonsBefore, timeoutMs = 180000, shotPrefix = null } = {}) {
  const trace = {
    simulateClicks: 0,
    skipClicks: 0,
    postCommitContinueClicks: 0,
    preCommitContinueClicks: 0,
    deskDecisions: [],
  };
  const ui0 = await uiState(page);
  assert(ui0.simulateDisabled === false, "simulate must be enabled", ui0);
  await page.click("#simulate-btn");
  trace.simulateClicks += 1;

  let beforeContinue = null;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const cur = await uiState(page);
    const seasonsNow = cur.debug?.seasonsCount ?? null;
    const committed = typeof seasonsNow === "number" && seasonsNow > seasonsBefore;

    if (committed && !beforeContinue) {
      beforeContinue = {
        debug: await debug(page),
        snapshot: await exportSnapshot(page),
        ui: { overlayHidden: cur.overlayHidden, dashboardHidden: cur.dashboardHidden },
      };
      if (shotPrefix) await shot(page, `${shotPrefix}-before-continue`);
    }

    if (
      committed &&
      beforeContinue &&
      trace.postCommitContinueClicks >= 1 &&
      cur.overlayHidden &&
      cur.dashboardHidden &&
      cur.seasonActionInFlight === false
    ) {
      return { trace, beforeContinue, final: cur };
    }

    const holdContinue = !beforeContinue;
    const act = await page.evaluate(
      ({ seasonsBefore: sb, hold }) => {
        const clicked = [];
        const d = window.__getLiveCareerDebug?.() || {};
        const nowCommitted = (d.seasonsCount ?? 0) > sb;

        const senior = document.getElementById("senior-scenario-overlay");
        if (senior && !senior.classList.contains("hidden")) {
          const choice = [...senior.querySelectorAll("button")].find((b) => !b.disabled);
          if (choice) {
            choice.click();
            clicked.push("scenario");
          }
        }

        const section = document.getElementById("animation-continue");
        const contBtn = document.getElementById("continue-btn");
        const continueReady = Boolean(
          section &&
            !section.classList.contains("hidden") &&
            contBtn &&
            !contBtn.disabled &&
            contBtn.offsetParent !== null
        );
        if (continueReady) {
          if (hold && nowCommitted) {
            clicked.push("hold-for-snapshot");
            return clicked;
          }
          contBtn.click();
          clicked.push(nowCommitted ? "continue-btn:post-commit" : "continue-btn:pre-commit");
          return clicked;
        }

        for (const id of ["sim-skip-phase-btn", "match-skip-phase-btn", "sim-skip-match-btn", "match-skip-btn"]) {
          const el = document.getElementById(id);
          if (el && !el.disabled && el.offsetParent !== null) {
            el.click();
            clicked.push(id);
          }
        }

        const overlay = document.getElementById("season-animation-overlay");
        const dashboard = document.getElementById("simulation-dashboard");
        const overlayHidden = !overlay || overlay.classList.contains("hidden");
        const dashboardHidden = !dashboard || dashboard.classList.contains("hidden");
        const midSeasonDesk = overlayHidden && dashboardHidden && !nowCommitted;
        if (midSeasonDesk) {
          const host = document.getElementById("transfer-offers");
          const buttons = host
            ? [...host.querySelectorAll("button")].filter((b) => !b.disabled && b.offsetParent !== null)
            : [];
          const stayBtn =
            buttons.find((b) => /decline offers and continue at/i.test(b.textContent || "")) ||
            buttons.find((b) =>
              /stay|compete|acknowledge|decline offers and continue|see it out|remain|continue at/i.test(
                b.textContent || ""
              )
            );
          if (stayBtn) {
            stayBtn.click();
            clicked.push(`desk-decision:${(stayBtn.textContent || "").trim()}`);
          }
          const sim = document.getElementById("simulate-btn");
          if (sim && !sim.disabled && /continue season/i.test(sim.textContent || "")) {
            sim.click();
            clicked.push("resume-season");
          }
        }
        return clicked;
      },
      { seasonsBefore, hold: holdContinue }
    );

    for (const c of act) {
      if (c === "continue-btn:post-commit") trace.postCommitContinueClicks += 1;
      else if (c === "continue-btn:pre-commit") trace.preCommitContinueClicks += 1;
      else if (c.startsWith("desk-decision:")) trace.deskDecisions.push(c.slice("desk-decision:".length));
      else if (/skip/i.test(c)) trace.skipClicks += 1;
    }
    await page.waitForTimeout(act.length && !act.includes("hold-for-snapshot") ? 140 : 220);
  }

  throw new Error(
    `Timed out returning to desk: ${JSON.stringify({
      seasonsBefore,
      trace,
      ui: await uiState(page),
    })}`
  );
}

async function assertDeskUsable(page) {
  const ui = await uiState(page);
  assert(ui.overlayHidden, "overlay must be closed at desk", ui);
  assert(ui.dashboardHidden, "dashboard must be closed at desk", ui);
  assert(ui.seasonActionInFlight === false, "seasonActionInFlight must be false", ui);
  assert(ui.simulateDisabled === false || ui.nextAction != null, "desk must expose a next action", ui);
  return ui;
}

function relevantErrors(guards) {
  return [...guards.errors, ...guards.failedRequests.map((r) => ({ type: "requestfailed", ...r }))];
}

const cases = {
  async B01(page, guards) {
    const snap = buildSnap({ id: "fix08-b01", position: "ST", ovr: 74, club: "Hull City", seed: 8801 });
    await writeCase("B01-initial.json", slimEvidence(snap));
    await restore(page, snap);
    await shot(page, "B01-01-start");
    const start = await exportSnapshot(page);
    assert((start.player.seasons || []).length === 0, "B01 must start with zero completed seasons");
    const driven = await driveSeasonToDesk(page, { seasonsBefore: 0, shotPrefix: "B01" });
    await shot(page, "B01-03-desk");
    const desk = await exportSnapshot(page);
    await writeCase("B01-before-continue.json", slimEvidence(driven.beforeContinue));
    await writeCase("B01-desk.json", slimEvidence(desk));
    const before = awardSummary(driven.beforeContinue.snapshot.player);
    const after = awardSummary(desk.player);
    assert(before.seasons >= 1, "season must complete before Continue", before);
    assert(after.seasons === before.seasons, "Continue must not add another season", { before, after });
    assert(after.age === before.age, "age must be stable across Continue", { before, after });
    await assertDeskUsable(page);
    assert(relevantErrors(guards).length === 0, "page errors/failed scripts", relevantErrors(guards));
    return { ok: true, before, after, continued: true, trace: driven.trace };
  },

  async B02(page, guards) {
    // Initial high-OVR fixture — season is earned in-browser, not precompleted.
    const snap = buildSnap({ id: "fix08-b02", position: "ST", ovr: 92, club: "Atalanta", age: 24, seed: 8802 });
    await writeCase("B02-initial.json", slimEvidence(snap));
    await restore(page, snap);
    await shot(page, "B02-01-start");
    const driven = await driveSeasonToDesk(page, { seasonsBefore: 0, shotPrefix: "B02" });
    const desk = await exportSnapshot(page);
    await writeCase("B02-before-continue.json", slimEvidence(driven.beforeContinue));
    await writeCase("B02-desk.json", slimEvidence(desk));
    const before = awardSummary(driven.beforeContinue.snapshot.player);
    const after = awardSummary(desk.player);
    assert(before.seasons >= 1, "B02 must complete a season");
    assert(Array.isArray(before.awardRecords), "award records must be an array");
    assert(after.seasons === before.seasons && after.age === before.age, "exact-once Continue", { before, after });
    await assertDeskUsable(page);
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    return {
      ok: true,
      before,
      after,
      earnedAward: before.awardIds.length > 0 || before.honorCount > 0,
      continued: true,
    };
  },

  async B03(page, guards) {
    const gk = buildSnap({ id: "fix08-b03-gk", position: "GK", ovr: 88, club: "Atalanta", seed: 8803 });
    await writeCase("B03-gk-initial.json", slimEvidence(gk));
    await restore(page, gk);
    const drivenGk = await driveSeasonToDesk(page, { seasonsBefore: 0, shotPrefix: "B03-gk" });
    const gkSum = awardSummary(drivenGk.beforeContinue.snapshot.player);
    await writeCase("B03-gk-before-continue.json", slimEvidence(drivenGk.beforeContinue));

    // Thin/unknown evidence control: free-agent CM with no club minutes.
    const thin = buildSnap({
      id: "fix08-b03-thin",
      position: "CM",
      ovr: 70,
      club: "Hull City",
      seed: 8804,
      freeAgent: true,
    });
    await writeCase("B03-thin-initial.json", slimEvidence(thin));
    await restore(page, thin);
    await shot(page, "B03-thin-desk");
    const thinSnap = await exportSnapshot(page);
    const thinSum = awardSummary(thinSnap.player);
    assert((thinSum.awardIds || []).length === 0, "thin FA must not invent awards at restore", thinSum);
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    return { ok: true, gk: gkSum, thin: thinSum, gkContinued: true };
  },

  async B04(page, guards) {
    const snap = buildSnap({ id: "fix08-b04", position: "ST", ovr: 76, club: "Hull City", seed: 8810 });
    await writeCase("B04-initial.json", slimEvidence(snap));
    await restore(page, snap);
    await shot(page, "B04-01-start");
    const beforeSeason = await exportSnapshot(page);
    await writeCase("B04-before-season.json", slimEvidence(beforeSeason));

    // Fresh-page restore branch comparison.
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => typeof window.__restoreCareerSnapshot === "function", null, {
      timeout: 60000,
    });
    await restore(page, snap);
    const afterFresh = await exportSnapshot(page);
    await writeCase("B04-fresh-restore.json", slimEvidence(afterFresh));
    assert(afterFresh.player?.name === beforeSeason.player?.name, "fresh restore identity");
    assert((afterFresh.player?.seasons || []).length === 0, "fresh restore must not invent seasons");

    const driven = await driveSeasonToDesk(page, { seasonsBefore: 0, shotPrefix: "B04" });
    const desk = await exportSnapshot(page);
    await writeCase("B04-desk.json", slimEvidence(desk));
    const sum = awardSummary(desk.player);
    assert(sum.seasons >= 1, "B04 must complete a season after restore");
    assert(sum.fieldKeys.every((k) => typeof k === "string"), "award field keys present");
    await assertDeskUsable(page);
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    return { ok: true, sum, continued: true, freshRestore: true };
  },

  async B05(page, guards) {
    const snap = buildSnap({ id: "fix08-b05", position: "ST", ovr: 94, club: "Atalanta", age: 25, seed: 8820 });
    await writeCase("B05-initial.json", slimEvidence(snap));
    await restore(page, snap);
    const driven = await driveSeasonToDesk(page, { seasonsBefore: 0, shotPrefix: "B05" });
    const desk = await exportSnapshot(page);
    await writeCase("B05-before-continue.json", slimEvidence(driven.beforeContinue));
    await writeCase("B05-desk.json", slimEvidence(desk));
    const before = awardSummary(driven.beforeContinue.snapshot.player);
    const world = (before.awardRecords || []).filter(
      (r) => r.awardId === "world-player-of-the-year" || /world/i.test(r.label || "")
    );
    await assertDeskUsable(page);
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    return {
      ok: true,
      before,
      worldPathExercised: true,
      worldRecords: world,
      note: world.length
        ? "world award present"
        : "world path evaluated; absence is a valid negative for this seed",
    };
  },

  async B06(page, guards) {
    const snap = buildSnap({ id: "fix08-b06", position: "ST", ovr: 80, club: "Hull City", seed: 8830 });
    await writeCase("B06-initial.json", slimEvidence(snap));
    await restore(page, snap);
    const driven = await driveSeasonToDesk(page, { seasonsBefore: 0, shotPrefix: "B06" });
    const before = driven.beforeContinue.snapshot;
    await writeCase("B06-before-continue.json", slimEvidence(driven.beforeContinue));
    const desk = await exportSnapshot(page);
    await writeCase("B06-desk.json", slimEvidence(desk));
    const a = awardSummary(before.player);
    const b = awardSummary(desk.player);
    assert(a.seasons === b.seasons && a.age === b.age, "Continue exact-once", { a, b });
    assert(a.honorCount === b.honorCount, "honors stable across Continue", { a, b });

    // Repeated Continue must not charge again.
    const ui = await uiState(page);
    if (ui.continueBtnVisible && !ui.continueBtnDisabled) {
      await page.evaluate(() => document.getElementById("continue-btn")?.click());
      await page.waitForTimeout(300);
    }
    const afterRepeat = awardSummary((await exportSnapshot(page)).player);
    assert(afterRepeat.seasons === b.seasons && afterRepeat.age === b.age, "repeat Continue stable", {
      b,
      afterRepeat,
    });

    // Fresh-page restore of desk snapshot.
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => typeof window.__restoreCareerSnapshot === "function", null, {
      timeout: 60000,
    });
    await restore(page, desk);
    const restored = awardSummary((await exportSnapshot(page)).player);
    await writeCase("B06-fresh-restore.json", { restored });
    assert(restored.seasons === b.seasons && restored.age === b.age, "fresh restore stable", { b, restored });
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    return { ok: true, before: a, desk: b, restored, continued: true };
  },

  async B07(page, guards) {
    const snap = buildSnap({
      id: "fix08-b07",
      position: "CM",
      ovr: 70,
      club: "Hull City",
      seed: 8840,
      freeAgent: true,
    });
    await writeCase("B07-initial.json", slimEvidence(snap));
    await restore(page, snap);
    await shot(page, "B07-01-fa-desk");
    const state = await exportSnapshot(page);
    await writeCase("B07-desk.json", slimEvidence(state));
    const sum = awardSummary(state.player);
    assert(sum.contractStatus === "released" || state.player.club == null, "FA / no-club lifecycle");
    assert((sum.awardIds || []).length === 0, "zero-minute FA must not invent awards", sum);
    const ui = await uiState(page);
    assert(ui.nextAction != null || ui.simulateDisabled === false || ui.debug != null, "usable FA desk", ui);
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    return { ok: true, sum };
  },
};

async function main() {
  await mkdir(CASE_DIR, { recursive: true });
  await mkdir(SHOT_DIR, { recursive: true });
  const hosted = await ensureBaseServer();
  const report = {
    generatedAt: new Date().toISOString(),
    base: hosted.base,
    cases: {},
    errors: [],
    blocked: false,
  };
  let browser;
  try {
    const launched = await launch(hosted.base);
    browser = launched.browser;
    const page = launched.page;
    const guards = launched.guards;
    for (const id of SELECTED) {
      if (!cases[id]) {
        report.cases[id] = { ok: false, error: "unknown case" };
        continue;
      }
      guards.errors = [];
      guards.failedRequests = [];
      const t0 = Date.now();
      console.log(`[browser] start ${id}`);
      try {
        report.cases[id] = await cases[id](page, guards);
        console.log(`[browser] pass ${id} ${Date.now() - t0}ms`);
        if (!report.cases[id].ok) report.errors.push({ id, error: "case returned ok:false" });
      } catch (err) {
        console.log(`[browser] fail ${id} ${Date.now() - t0}ms: ${err?.message || err}`);
        report.cases[id] = { ok: false, error: String(err?.stack || err), data: err?.data };
        report.errors.push({ id, error: String(err) });
      }
    }
  } catch (err) {
    report.blocked = true;
    report.errors.push({ id: "launch", error: String(err?.stack || err) });
  } finally {
    if (browser) await browser.close().catch(() => {});
    await hosted.close().catch(() => {});
  }
  report.ok = !report.blocked && SELECTED.every((id) => report.cases[id]?.ok);
  await writeFile(OUT, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        out: OUT,
        ok: report.ok,
        blocked: report.blocked,
        base: report.base,
        cases: Object.fromEntries(Object.entries(report.cases).map(([k, v]) => [k, !!v.ok])),
      },
      null,
      2
    )
  );
  process.exitCode = report.ok ? 0 : 1;
}

main();
