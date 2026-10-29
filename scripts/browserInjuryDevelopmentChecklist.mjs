#!/usr/bin/env node
/**
 * Browser acceptance for Fix 06: injury exposure → healthy training fraction.
 *
 *   python3 -m http.server 8000 --bind 127.0.0.1
 *   npm install --no-save playwright-core
 *   BASE_URL=http://127.0.0.1:8000 node scripts/browserInjuryDevelopmentChecklist.mjs
 *
 * Env:
 *   BASE_URL     default http://127.0.0.1:8000
 *   CHROME_PATH  default /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
 *   CASES        optional comma list (e.g. "B01,B03"). A partial run never reports
 *                `pass: true` in the JSON (fullRun=false) but the exit code reflects
 *                only the selected cases.
 *   HEADED=1     run headed Chrome
 *
 * Cases (from the Fix 06 brief):
 *   B01  Old injury, later healthy period
 *   B02  Injury crossing the development-period boundary (carry-in)
 *   B03  Injury year followed by a recovered year (two real seasons)
 *   B04  Mid-season pause → snapshot export → fresh page restore → move (loan) → finish
 *
 * Fixtures are built in Node with production APIs (createPlayerIdentity,
 * initializePlayerDevelopment, createWorldState, serializeCareerSnapshot,
 * buildLiveLoanBrowserFixture), production-shaped injury records are injected
 * on the *snapshot* player (never in production modules), written to
 * qa/fixtures/fix06/, then restored in the page through
 * `window.__restoreCareerSnapshot`. Every case then:
 *
 *   click real #simulate-btn → resolve decisions / presentation → real
 *   #continue-btn → overlay + dashboard closed, seasonActionInFlight === false
 *
 * with `__exportCareerSnapshot` captured before the final Continue and again
 * after the desk returns. Assertions compare production numbers
 * (`__getLiveCareerDebug().lastSeason.*` and the exported snapshot) to an
 * independent oracle that clips dated injury intervals to the June→June window
 * [Y-06-01, (Y+1)-06-01), Y = startYear + seasonIndex.
 *
 * Outputs:
 *   qa/screenshots/checklist-injury-development/*.png
 *   qa/fix06-runs/browser-report.json
 *   qa/fix06-runs/cases/*.json   (snapshots / per-case detail)
 *   qa/fixtures/fix06/*.json     (restorable initial snapshots)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { LEAGUE_BY_ID } from "../js/data/leagues.js";
import { createPlayerIdentity } from "../js/simulation/playerDevelopment.js";
import { initializePlayerDevelopment } from "../js/simulation/playerDevelopmentModel.js";
import { generateStartingAttributes } from "../js/simulation/playerDevelopmentModel.js";
import { createRng, reseedCareerRng } from "../js/simulation/rng.js";
import { createWorldState, setWorldState, getWorldState } from "../js/simulation/worldState.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import { ensurePlayingStints } from "../js/simulation/playingRegistration.js";
import { refreshAbilityCaches } from "../js/simulation/playerAbility.js";
import { serializeCareerSnapshot } from "../js/simulation/careerSnapshot.js";
import { createEmptyHealth } from "../js/simulation/playerHealth.js";
import { toDay, addDaysToDate } from "../js/simulation/playerState.js";
import { resolveDevelopmentPeriod } from "../js/simulation/seasonEvidence.js";
import { buildLiveLoanBrowserFixture } from "../js/simulation/liveLoanBrowserFixture.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8000";
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HEADED = process.env.HEADED === "1";
const SHOT_DIR = join(root, "qa/screenshots/checklist-injury-development");
const RUN_DIR = join(root, "qa/fix06-runs");
const OUT = join(RUN_DIR, "browser-report.json");
const CASE_DIR = join(RUN_DIR, "cases");
const FIXTURE_DIR = join(root, "qa/fixtures/fix06");

const REQUIRED_CASES = ["B01", "B02", "B03", "B04"];
const SELECTED = process.env.CASES
  ? process.env.CASES.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
  : REQUIRED_CASES;

const MS_PER_DAY = 86_400_000;
const HEALTHY_FLOOR = 0.15;
const EPS = 1e-9;

/* ------------------------------------------------------------------ */
/* Generic helpers                                                     */
/* ------------------------------------------------------------------ */

function assert(cond, msg, data) {
  if (!cond) {
    const err = new Error(msg);
    err.data = data;
    throw err;
  }
}

/** Finite number or throw. Never coerces null/undefined/"" to 0. */
function num(v, label) {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    const err = new Error(`${label}: expected a finite number, got ${JSON.stringify(v)} (${typeof v})`);
    err.data = { label, value: v ?? null };
    throw err;
  }
  return v;
}

function assertClose(actual, expected, label, eps = EPS) {
  const a = num(actual, `${label} (actual)`);
  const e = num(expected, `${label} (expected)`);
  assert(Math.abs(a - e) <= eps, `${label}: ${a} !== ${e} (±${eps})`, { actual: a, expected: e });
}

function assertEq(actual, expected, label) {
  assert(actual === expected, `${label}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`, {
    actual,
    expected,
  });
}

function assertSameSet(actual, expected, label) {
  const a = [...new Set(actual || [])].map(String).sort();
  const e = [...new Set(expected || [])].map(String).sort();
  assert(JSON.stringify(a) === JSON.stringify(e), `${label}: ${JSON.stringify(a)} !== ${JSON.stringify(e)}`, {
    actual: a,
    expected: e,
  });
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const jsonClone = (v) => JSON.parse(JSON.stringify(v));

async function loadPlaywright() {
  return import("playwright-core");
}

async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2));
}

/* ------------------------------------------------------------------ */
/* Browser helpers (reference: browserMatchParticipationChecklist)     */
/* ------------------------------------------------------------------ */

async function waitFor(page, fn, arg, timeoutMs = 25000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await page.evaluate(fn, arg);
    if (last) return last;
    await page.waitForTimeout(120);
  }
  throw new Error(`Timeout. Last=${JSON.stringify(last)}`);
}

const shotLog = [];
async function shot(page, name) {
  await mkdir(SHOT_DIR, { recursive: true });
  const path = join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  console.log(`  screenshot ${path}`);
  shotLog.push(path);
  return path;
}

async function debug(page) {
  return page.evaluate(() => window.__getLiveCareerDebug?.() || null);
}

async function exportSnapshot(page) {
  const snap = await page.evaluate(() => window.__exportCareerSnapshot?.() || null);
  assert(snap?.player, "__exportCareerSnapshot returned a player snapshot");
  return jsonClone(snap);
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

/** Click the real production Continue button (#continue-btn), never a wrapper. */
async function clickContinueBtn(page) {
  return page.evaluate(() => {
    const section = document.getElementById("animation-continue");
    const btn = document.getElementById("continue-btn");
    if (!section || section.classList.contains("hidden")) return { clicked: false, reason: "section-hidden" };
    if (!btn || btn.disabled) return { clicked: false, reason: "btn-disabled" };
    if (btn.offsetParent === null) return { clicked: false, reason: "btn-not-visible" };
    btn.click();
    return { clicked: true, id: "continue-btn", text: (btn.textContent || "").trim() };
  });
}

/** Desk "stay / decline" control inside the transfer tray (mid-season or post-season). */
async function clickStayDecision(page) {
  return page.evaluate(() => {
    const host = document.getElementById("transfer-offers");
    if (!host) return null;
    const buttons = [...host.querySelectorAll("button")].filter(
      (b) => !b.disabled && b.offsetParent !== null
    );
    const stay =
      buttons.find((b) => /decline offers and continue at/i.test(b.textContent || "")) ||
      buttons.find((b) =>
        /stay|compete|acknowledge|decline offers and continue|see it out|see out|remain|continue at/i.test(
          b.textContent || ""
        )
      ) ||
      buttons.find((b) => /^decline$/i.test((b.textContent || "").trim()));
    if (!stay) return null;
    stay.click();
    return (stay.textContent || "").trim();
  });
}

/** Resolve post-season / mid-season desk blockers until Simulate is usable. */
async function resolveDeskObstacles(page, { timeoutMs = 20000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const clicked = [];
  while (Date.now() < deadline) {
    const cur = await uiState(page);
    const pending = Boolean(cur.debug?.pendingDecision) || (cur.debug?.pendingOffers?.length || 0) > 0;
    if (!cur.simulateDisabled && !pending) return { clicked, final: cur };
    const label = await clickStayDecision(page);
    if (label) {
      clicked.push(label);
      await page.waitForTimeout(250);
      continue;
    }
    if (!cur.simulateDisabled) return { clicked, final: cur };
    await page.waitForTimeout(200);
  }
  const final = await uiState(page);
  throw Object.assign(new Error("Desk obstacles did not clear before simulate"), {
    data: { clicked, nextAction: final.nextAction, simulateDisabled: final.simulateDisabled },
  });
}

/**
 * Drive one senior season to the career desk through real controls.
 *
 *  - optionally clicks the real #simulate-btn first
 *  - resolves mid-season desk decisions by declining/staying (unless handled by caller)
 *  - plays/skips presentation phases
 *  - captures `__exportCareerSnapshot` the instant the season is committed and
 *    BEFORE any post-commit #continue-btn click
 *  - requires at least one post-commit #continue-btn click and a closed
 *    overlay/dashboard with seasonActionInFlight === false
 */
async function driveSeasonToDesk(
  page,
  { seasonsBefore, clickSimulate = true, stayDecisions = true, timeoutMs = 180000, shotPrefix = null } = {}
) {
  const trace = {
    simulateClicks: 0,
    resumeClicks: 0,
    skipClicks: 0,
    scenarioClicks: 0,
    deskDecisions: [],
    postCommitContinueClicks: 0,
    preCommitContinueClicks: 0,
  };

  if (clickSimulate) {
    const ui = await uiState(page);
    assert(ui.simulateDisabled === false, "simulate control must be enabled before the season", ui);
    await page.click("#simulate-btn");
    trace.simulateClicks += 1;
  }

  let beforeContinue = null;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const cur = await uiState(page);
    const seasonsNow = cur.debug?.seasonsCount ?? null;
    const committed = typeof seasonsNow === "number" && seasonsNow > seasonsBefore;

    if (committed && !beforeContinue) {
      const snapshot = await exportSnapshot(page);
      const dbg = await debug(page);
      beforeContinue = {
        debug: dbg,
        snapshot,
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
      ({ seasonsBefore: sb, stay, hold }) => {
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
          const next = document.getElementById("senior-scenario-next");
          if (next && !next.classList.contains("hidden") && !next.disabled) {
            next.click();
            clicked.push("scenario-next");
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

        for (const id of [
          "sim-skip-phase-btn",
          "match-skip-phase-btn",
          "sim-skip-match-btn",
          "match-skip-btn",
        ]) {
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

        if (stay && midSeasonDesk) {
          const host = document.getElementById("transfer-offers");
          const buttons = host
            ? [...host.querySelectorAll("button")].filter((b) => !b.disabled && b.offsetParent !== null)
            : [];
          const stayBtn =
            buttons.find((b) => /decline offers and continue at/i.test(b.textContent || "")) ||
            buttons.find((b) =>
              /stay|compete|acknowledge|decline offers and continue|see it out|see out|remain|continue at/i.test(
                b.textContent || ""
              )
            ) ||
            buttons.find((b) => /^decline$/i.test((b.textContent || "").trim()));
          if (stayBtn) {
            const label = (stayBtn.textContent || "").trim();
            stayBtn.click();
            clicked.push(`desk-decision:${label}`);
          }
        }

        const sim = document.getElementById("simulate-btn");
        if (
          midSeasonDesk &&
          sim &&
          !sim.disabled &&
          /continue season/i.test(sim.textContent || "") &&
          !(d.pendingDecision || (d.pendingOffers || []).length)
        ) {
          sim.click();
          clicked.push("resume-season");
        }
        return clicked;
      },
      { seasonsBefore, stay: stayDecisions, hold: holdContinue }
    );

    for (const c of act) {
      if (c === "continue-btn:post-commit") trace.postCommitContinueClicks += 1;
      else if (c === "continue-btn:pre-commit") trace.preCommitContinueClicks += 1;
      else if (c === "resume-season") trace.resumeClicks += 1;
      else if (c === "scenario" || c === "scenario-next") trace.scenarioClicks += 1;
      else if (c.startsWith("desk-decision:")) trace.deskDecisions.push(c.slice("desk-decision:".length));
      else if (/skip/i.test(c)) trace.skipClicks += 1;
    }

    await page.waitForTimeout(act.length && !act.includes("hold-for-snapshot") ? 140 : 220);
  }

  const snap = await uiState(page);
  throw Object.assign(
    new Error(
      `Timed out returning to desk: ${JSON.stringify({
        overlayHidden: snap.overlayHidden,
        dashboardHidden: snap.dashboardHidden,
        inFlight: snap.seasonActionInFlight,
        continueSectionVisible: snap.continueSectionVisible,
        continueBtnVisible: snap.continueBtnVisible,
        seasonsBefore,
        seasons: snap.debug?.seasonsCount,
        pendingDecision: snap.debug?.pendingDecision,
        nextAction: snap.nextAction,
        trace,
      })}`
    ),
    { data: { trace, snap } }
  );
}

/* ------------------------------------------------------------------ */
/* Runtime guards: page errors, unhandled rejections, alerts           */
/* ------------------------------------------------------------------ */

function attachRuntimeGuards(page, sink) {
  page.on("pageerror", (err) => sink.errors.push({ type: "pageerror", message: String(err?.message || err) }));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // Missing static assets (badges, favicon) are not simulation failures.
    if (/Failed to load resource/i.test(text)) sink.warnings.push({ type: "console", message: text });
    else sink.errors.push({ type: "console", message: text });
  });
  page.on("dialog", async (dialog) => {
    sink.errors.push({ type: "dialog", message: `${dialog.type()}: ${dialog.message()}` });
    await dialog.dismiss().catch(() => {});
  });
}

async function collectWindowGuards(page, sink) {
  const items = await page
    .evaluate(() => window.__fix06Guards?.slice() || [])
    .catch(() => []);
  for (const it of items) sink.errors.push(it);
}

async function openSession(browser, sink) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    window.__fix06Guards = [];
    window.addEventListener("unhandledrejection", (e) => {
      window.__fix06Guards.push({
        type: "unhandledrejection",
        message: String(e?.reason?.message || e?.reason || "unknown"),
      });
    });
    window.addEventListener("error", (e) => {
      window.__fix06Guards.push({ type: "window-error", message: String(e?.message || "unknown") });
    });
  });
  const page = await context.newPage();
  attachRuntimeGuards(page, sink);
  return { context, page };
}

async function gotoIndex(page) {
  await page.goto(`${BASE}/index.html`, { waitUntil: "networkidle" });
  await waitFor(
    page,
    () =>
      typeof window.__restoreCareerSnapshot === "function" &&
      typeof window.__exportCareerSnapshot === "function" &&
      typeof window.__getLiveCareerDebug === "function",
    undefined,
    30000
  );
}

async function restoreSnapshot(page, snapshot) {
  const res = await page.evaluate((snap) => window.__restoreCareerSnapshot?.(snap), snapshot);
  assert(res?.ok === true, "__restoreCareerSnapshot ok", res);
  await page.waitForTimeout(150);
  return res;
}

/* ------------------------------------------------------------------ */
/* Independent oracle                                                  */
/* ------------------------------------------------------------------ */

/** Y = startYear + seasonIndex; window [Y-06-01, (Y+1)-06-01) in UTC epoch days. */
function expectedPeriod(startYear, seasonIndex) {
  const Y = startYear + seasonIndex;
  const startDay = Date.UTC(Y, 5, 1) / MS_PER_DAY;
  const endDay = Date.UTC(Y + 1, 5, 1) / MS_PER_DAY;
  return {
    seasonStartYear: Y,
    seasonIndex,
    startDate: `${Y}-06-01`,
    endExclusiveDate: `${Y + 1}-06-01`,
    startDay,
    endDay,
    days: endDay - startDay,
  };
}

function finiteOrNull(v) {
  return v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
}

/** Return boundary: availability → expected → onset+duration → observation (legacy). */
function oracleReturnDay(rec) {
  const avail = finiteOrNull(rec.availabilityReturnDay);
  if (avail != null) return avail;
  const expected = finiteOrNull(rec.expectedReturnDay);
  if (expected != null) return expected;
  const start = oracleStartDay(rec);
  const dur = finiteOrNull(rec.durationDays);
  if (start != null && dur != null) return start + dur;
  return finiteOrNull(rec.recoveredDay);
}

function oracleStartDay(rec) {
  return finiteOrNull(rec.startDay ?? rec.onsetDay) ?? toDay(rec.date);
}

function oracleHealth(health, period) {
  const records = [];
  for (const r of health?.injuryHistory || []) records.push({ rec: r, active: false });
  if (health?.activeInjury) records.push({ rec: health.activeInjury, active: true });

  const clipped = [];
  const contributing = new Set();
  const excludedUnknown = new Set();
  const perEvent = {};
  for (const { rec, active } of records) {
    const start = oracleStartDay(rec);
    const end = oracleReturnDay(rec);
    const id = rec.eventId != null ? String(rec.eventId) : null;
    const usable = start != null && end != null && end > start;
    if (!usable) {
      if (!active && id) excludedUnknown.add(id);
      continue;
    }
    const a = Math.max(start, period.startDay);
    const b = Math.min(end, period.endDay);
    if (b > a) {
      clipped.push([a, b]);
      if (id) {
        contributing.add(id);
        perEvent[id] = { start, end, clippedStart: a, clippedEnd: b, clippedDays: b - a };
      }
    }
  }
  clipped.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const [a, b] of clipped) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  const injuredDays = merged.reduce((s, [a, b]) => s + (b - a), 0);
  const rawFraction = clamp(1 - injuredDays / period.days, 0, 1);
  return {
    injuredDays,
    rawFraction,
    appliedFraction: clamp(rawFraction, HEALTHY_FLOOR, 1),
    contributingEventIds: [...contributing],
    excludedUnknownIds: [...excludedUnknown],
    perEvent,
    mergedIntervals: merged,
  };
}

function healthEventIds(health) {
  const ids = new Set();
  for (const r of health?.injuryHistory || []) if (r?.eventId != null) ids.add(String(r.eventId));
  if (health?.activeInjury?.eventId != null) ids.add(String(health.activeInjury.eventId));
  return ids;
}

function findInjury(health, eventId) {
  const id = String(eventId);
  if (health?.activeInjury && String(health.activeInjury.eventId) === id) {
    return { rec: health.activeInjury, where: "active" };
  }
  const hit = (health?.injuryHistory || []).find((r) => String(r?.eventId) === id);
  return hit ? { rec: hit, where: "history" } : null;
}

/**
 * Validate `lastSeason` numbers from __getLiveCareerDebug (and the committed
 * season inside the exported snapshot) against the oracle.
 */
function checkSeasonHealth(label, ls, snapshot, { startYear, seasonIndex }) {
  assert(ls, `${label}: lastSeason present on __getLiveCareerDebug`);
  const exp = expectedPeriod(startYear, seasonIndex);
  const snapPlayer = snapshot.player;

  // Production helper must agree with the independent June→June definition.
  const prod = resolveDevelopmentPeriod(snapPlayer, { seasonIndex });
  assertEq(prod.periodStartDay, exp.startDay, `${label}: resolveDevelopmentPeriod start day`);
  assertEq(prod.periodEndDay, exp.endDay, `${label}: resolveDevelopmentPeriod end day`);

  const dp = ls.developmentPeriod;
  assert(dp && typeof dp === "object", `${label}: lastSeason.developmentPeriod present`, ls);
  assertEq(num(dp.seasonStartYear, `${label} dp.seasonStartYear`), exp.seasonStartYear, `${label}: seasonStartYear`);
  assertEq(num(dp.seasonIndex, `${label} dp.seasonIndex`), exp.seasonIndex, `${label}: seasonIndex`);
  assertEq(dp.startDate, exp.startDate, `${label}: period startDate`);
  assertEq(dp.endExclusiveDate, exp.endExclusiveDate, `${label}: period endExclusiveDate`);
  assertEq(num(dp.startDay, `${label} dp.startDay`), exp.startDay, `${label}: period startDay`);
  assertEq(num(dp.endDay, `${label} dp.endDay`), exp.endDay, `${label}: period endDay`);
  assertEq(num(dp.days, `${label} dp.days`), exp.days, `${label}: period days`);
  assert(dp.periodId != null && String(dp.periodId) !== "", `${label}: periodId present`, dp);
  // The committed season's own id (when exposed) must be the period's id.
  const snapSeasonForId = snapshot.player.seasons?.[snapshot.player.seasons.length - 1];
  const committedSeasonId =
    ls.seasonId ?? snapSeasonForId?.seasonId ?? snapSeasonForId?.seasonEvidence?.seasonId ?? null;
  if (committedSeasonId != null) {
    assertEq(String(committedSeasonId), String(dp.seasonId), `${label}: committed season id matches period seasonId`);
  }

  const he = ls.healthEvidence;
  assert(he && typeof he === "object", `${label}: lastSeason.healthEvidence present`, ls);
  assertEq(he.hasDatedWindow, true, `${label}: health evidence used a dated window`);
  assertEq(num(he.windowStartDay, `${label} he.windowStartDay`), exp.startDay, `${label}: health window start`);
  assertEq(num(he.windowEndDay, `${label} he.windowEndDay`), exp.endDay, `${label}: health window end`);
  assertEq(num(he.seasonDays, `${label} he.seasonDays`), exp.days, `${label}: health seasonDays`);
  assert(
    !["history-durations", "default-no-health-data", "explicit-override"].includes(he.method),
    `${label}: dated-window method expected, got ${he.method}`,
    he
  );

  const oracle = oracleHealth(snapPlayer.health, exp);
  const raw = num(ls.rawHealthyTrainingFraction, `${label} rawHealthyTrainingFraction`);
  const applied = num(ls.healthyTrainingFraction, `${label} healthyTrainingFraction`);
  const devHealthy = num(ls.developmentBreakdownHealthy, `${label} developmentBreakdownHealthy`);
  assert(raw >= 0 && raw <= 1, `${label}: raw fraction in [0,1]`, { raw });
  assert(applied >= HEALTHY_FLOOR - EPS && applied <= 1, `${label}: applied fraction in [floor,1]`, { applied });
  assertClose(raw, oracle.rawFraction, `${label}: rawHealthyTrainingFraction vs oracle`);
  assertClose(applied, oracle.appliedFraction, `${label}: healthyTrainingFraction vs oracle (floored)`);
  assertClose(devHealthy, applied, `${label}: developmentBreakdown.healthyTrainingFraction == applied`);
  assertClose(
    num(he.rawHealthyTrainingFraction, `${label} he.raw`),
    raw,
    `${label}: healthEvidence.raw == lastSeason.raw`
  );
  assertClose(
    num(he.appliedHealthyTrainingFraction, `${label} he.applied`),
    applied,
    `${label}: healthEvidence.applied == lastSeason.applied`
  );
  assertClose(num(he.injuredDays, `${label} he.injuredDays`), oracle.injuredDays, `${label}: injuredDays vs oracle`);
  assertSameSet(he.contributingEventIds, oracle.contributingEventIds, `${label}: contributingEventIds`);
  assertSameSet(he.excludedUnknownEventIds, oracle.excludedUnknownIds, `${label}: excludedUnknownEventIds`);
  const clippedSum = (he.clippedIntervals || []).reduce(
    (s, c) => s + num(c.clippedDays, `${label} clippedDays`),
    0
  );
  assert(
    clippedSum + EPS >= oracle.injuredDays,
    `${label}: sum of clipped intervals covers merged injured days`,
    { clippedSum, injuredDays: oracle.injuredDays }
  );
  for (const c of he.clippedIntervals || []) {
    assert(
      num(c.clippedStartDay, `${label} clippedStartDay`) >= exp.startDay &&
        num(c.clippedEndDay, `${label} clippedEndDay`) <= exp.endDay,
      `${label}: clipped interval stays inside the development window`,
      c
    );
  }
  // Exactly one clipped interval per eventId (no active/history double charge).
  const idCounts = {};
  for (const c of he.clippedIntervals || []) idCounts[c.eventId] = (idCounts[c.eventId] || 0) + 1;
  for (const [id, n] of Object.entries(idCounts)) {
    assert(n === 1, `${label}: injury ${id} charged exactly once`, { id, n });
  }

  // Cross-check the committed season inside the exported snapshot.
  const snapSeason = snapPlayer.seasons?.[snapPlayer.seasons.length - 1];
  assert(snapSeason, `${label}: snapshot has the committed season`);
  assertClose(
    num(snapSeason.seasonEvidence?.rawHealthyTrainingFraction, `${label} snapshot raw`),
    raw,
    `${label}: snapshot season raw == debug raw`
  );
  assertClose(
    num(snapSeason.seasonEvidence?.healthyTrainingFraction, `${label} snapshot applied`),
    applied,
    `${label}: snapshot season applied == debug applied`
  );

  return {
    period: exp,
    developmentPeriod: dp,
    raw,
    applied,
    developmentBreakdownHealthy: devHealthy,
    method: he.method,
    injuredDays: oracle.injuredDays,
    injuryCount: he.injuryCount ?? null,
    overlappingInjuryCount: he.overlappingInjuryCount ?? null,
    contributingEventIds: [...(he.contributingEventIds || [])],
    excludedUnknownEventIds: [...(he.excludedUnknownEventIds || [])],
    clippedIntervals: he.clippedIntervals || [],
    oracle,
  };
}

/** Before/after-Continue invariants: the final Continue must not re-run the period. */
function checkContinueIsInert(label, before, after) {
  const bl = before.debug.lastSeason;
  const al = after.debug.lastSeason;
  assert(bl && al, `${label}: lastSeason before and after`);
  assertEq(after.debug.seasonsCount, before.debug.seasonsCount, `${label}: seasonsCount unchanged by Continue`);
  assertEq(after.debug.age, before.debug.age, `${label}: age unchanged by Continue`);
  assertEq(al.seasonId, bl.seasonId, `${label}: lastSeason.seasonId unchanged`);
  assertClose(
    num(al.rawHealthyTrainingFraction, `${label} after raw`),
    num(bl.rawHealthyTrainingFraction, `${label} before raw`),
    `${label}: rawHealthyTrainingFraction unchanged by Continue`
  );
  assertClose(
    num(al.healthyTrainingFraction, `${label} after applied`),
    num(bl.healthyTrainingFraction, `${label} before applied`),
    `${label}: healthyTrainingFraction unchanged by Continue`
  );
  assertClose(
    num(al.developmentBreakdownHealthy, `${label} after dev`),
    num(bl.developmentBreakdownHealthy, `${label} before dev`),
    `${label}: developmentBreakdownHealthy unchanged by Continue`
  );
  assert(
    JSON.stringify(al.developmentPeriod) === JSON.stringify(bl.developmentPeriod),
    `${label}: developmentPeriod unchanged by Continue`,
    { before: bl.developmentPeriod, after: al.developmentPeriod }
  );
  assert(
    JSON.stringify(al.healthEvidence) === JSON.stringify(bl.healthEvidence),
    `${label}: healthEvidence unchanged by Continue`,
    { before: bl.healthEvidence, after: al.healthEvidence }
  );
  assert(
    JSON.stringify(after.snapshot.player.health.injuryHistory) ===
      JSON.stringify(before.snapshot.player.health.injuryHistory) &&
      JSON.stringify(after.snapshot.player.health.activeInjury) ===
        JSON.stringify(before.snapshot.player.health.activeInjury),
    `${label}: injury records unchanged by Continue`
  );
  assertEq(
    after.snapshot.player.seasons.length,
    before.snapshot.player.seasons.length,
    `${label}: snapshot season count unchanged by Continue`
  );
}

function assertDeskClosed(label, ui) {
  assertEq(ui.overlayHidden, true, `${label}: season overlay closed`);
  assertEq(ui.dashboardHidden, true, `${label}: simulation dashboard closed`);
  assertEq(ui.seasonActionInFlight, false, `${label}: seasonActionInFlight cleared`);
  assert(ui.debug?.nextAction, `${label}: next career action present`, ui.debug);
  assert(
    ui.debug.nextAction.canSimulate === true ||
      ui.debug.pendingOffers?.length > 0 ||
      Boolean(ui.debug.pendingDecision),
    `${label}: usable next step (simulate or pending decision/offers)`,
    ui.debug.nextAction
  );
}

function compactFacts(f) {
  return {
    period: f.period,
    raw: f.raw,
    applied: f.applied,
    developmentBreakdownHealthy: f.developmentBreakdownHealthy,
    method: f.method,
    injuredDays: f.injuredDays,
    injuryCount: f.injuryCount,
    overlappingInjuryCount: f.overlappingInjuryCount,
    contributingEventIds: f.contributingEventIds,
    excludedUnknownEventIds: f.excludedUnknownEventIds,
    clippedIntervals: f.clippedIntervals,
  };
}

/* ------------------------------------------------------------------ */
/* Fixture construction (Node, production APIs)                        */
/* ------------------------------------------------------------------ */

const START_YEAR = 2026;
const FIXTURE_SEEDS = { B01: 603, B02: 604, B03: 605, B04: 42 };

/**
 * Production-shaped injury record (see sampleInjuryFromExposure / advanceHealth).
 * `status: "recovered"` adds recoveredDay + availabilityReturnDay; "active"
 * keeps progress < 1 until the (future) return day.
 */
function makeInjuryRecord({
  eventId,
  startDate,
  durationDays,
  status,
  severity = "moderate",
  kind = "match",
  asOfDay = null,
  observedLagDays = 1,
}) {
  const startDay = toDay(startDate);
  assert(startDay != null, `bad startDate for ${eventId}`);
  const expectedReturnDay = startDay + durationDays;
  const penalty = { minor: 2, moderate: 3, major: 4.5, severe: 6 }[severity] ?? 3;
  const readiness = { minor: 0.85, moderate: 0.75, major: 0.65, severe: 0.55 }[severity] ?? 0.75;
  const rec = {
    eventId,
    kind,
    severity,
    date: startDate,
    startDay,
    durationDays,
    expectedReturnDate: addDaysToDate(startDate, durationDays),
    expectedReturnDay,
    temporaryEffects: { overallPenalty: penalty, scale: 1, attributePenalties: {} },
    returnReadiness: readiness,
    probability: 0.01,
    durableDamage: {},
    durableDamageTotal: 0,
    progress: 0,
  };
  if (status === "recovered") {
    rec.progress = 1;
    rec.temporaryEffects.scale = 0;
    rec.recoveredDay = expectedReturnDay + observedLagDays;
    rec.availabilityReturnDay = expectedReturnDay;
  } else {
    const ref = asOfDay ?? startDay;
    rec.progress = clamp((ref - startDay) / Math.max(1, durationDays), 0, 0.99);
    rec.temporaryEffects.scale = 1 - rec.progress;
  }
  return rec;
}

/** Brief literal: old injury [100,400) expressed in raw day numbers. */
function makeRawDayInjury(eventId, startDay, endDay) {
  return {
    eventId,
    kind: "match",
    severity: "severe",
    date: startDay,
    startDay,
    durationDays: endDay - startDay,
    expectedReturnDate: endDay,
    expectedReturnDay: endDay,
    temporaryEffects: { overallPenalty: 6, scale: 0, attributePenalties: {} },
    returnReadiness: 0.55,
    probability: 0.01,
    durableDamage: {},
    durableDamageTotal: 0,
    progress: 1,
    recoveredDay: endDay + 1,
    availabilityReturnDay: endDay,
  };
}

/** Pre-dating legacy row (duration only, no onset) — must never charge a later window. */
function makeLegacyDurationOnly(eventId, durationDays) {
  return {
    eventId,
    kind: "match",
    severity: "severe",
    durationDays,
    progress: 1,
    temporaryEffects: { overallPenalty: 0, scale: 0, attributePenalties: {} },
    durableDamage: {},
    durableDamageTotal: 0,
  };
}

function setHealth(player, { history = [], active = null, lastAdvancedDay = null } = {}) {
  player.health = {
    ...createEmptyHealth(),
    ...(player.health && typeof player.health === "object" ? player.health : {}),
    injuryHistory: history,
    activeInjury: active,
    lastAdvancedDay: lastAdvancedDay ?? player.health?.lastAdvancedDay ?? null,
  };
  player.development ||= {};
  player.development.appliedEventIds ||= {};
  for (const r of [...history, ...(active ? [active] : [])]) {
    if (r?.eventId) player.development.appliedEventIds[`injury:${r.eventId}`] = true;
  }
}

function snapshotNow(player) {
  const snap = serializeCareerSnapshot({ player, world: getWorldState() });
  return jsonClone(snap);
}

/** PL Arsenal ST (production identity + development init), fresh career before season 1. */
function buildArsenalStPlayer({ careerId, seed }) {
  resetClubFinanceLedgers();
  reseedCareerRng(seed);
  setWorldState(createWorldState({ seed, startYear: START_YEAR }));

  const league = LEAGUE_BY_ID.get("league:england-premier-league");
  const club = league?.clubs.find((c) => c.clubId === "club:england:arsenal");
  assert(club, "Arsenal club present for fixtures");

  const rng = createRng(seed);
  const player = createPlayerIdentity({
    name: `Fix06 ${careerId}`,
    nationality: "England",
    position: "ST",
    age: 19,
  });
  const rating = 78;
  const potential = 88;
  player.startYear = START_YEAR;
  player.careerId = careerId;
  player.rating = rating;
  player.potential = potential;
  player.attributes = generateStartingAttributes("ST", rating, 99, rng);
  player.playerModelVersion = 2;
  player.state = { form: 0, morale: 0, readiness: 1, fatigue: 0, adaptationPenalty: 0, roleFit: 1 };
  player.health = createEmptyHealth();
  player.development = { latentBudget: potential + 2, modelVersion: 1, migration: {} };
  player.club = {
    ...club,
    league: league.name,
    leagueDisplay: league.displayName,
    leagueId: league.leagueId,
    nation: league.nation,
    isAcademy: false,
    parentClub: null,
  };
  player.employmentClubId = club.clubId;
  player.playingClubId = club.clubId;
  player.contractStartSeason = 0;
  player.contractYears = 4;
  player.contractEndSeason = 4;
  player.weeklyWage = 50000;
  player.seasons = [];
  player.pendingOffers = [];
  player.pendingDecision = null;
  player.seasonCheckpoint = null;
  player.decisionCooldowns = {};
  initializePlayerDevelopment(player, { rng, careerId, budget: 99, potential });
  player.currentOverall = rating;
  player.currentOverallRaw = rating;
  player.baseOverallRaw = rating;
  refreshAbilityCaches(player);
  ensurePlayingStints(player, { asOfDate: `${START_YEAR}-07-01` });
  // Re-pin world + career RNG so the browser restore resumes from `seed`.
  reseedCareerRng(seed);
  setWorldState(createWorldState({ seed, startYear: START_YEAR }));
  return player;
}

const B01_IDS = {
  oldDated: "fix06:B01:old-2025-09",
  oldRawDays: "fix06:B01:old-raw-100-400",
  legacy: "fix06:B01:legacy-duration-only",
};
const B02_IDS = { carryIn: "fix06:B02:carry-in-2026-05" };
const B03_IDS = { y1: "fix06:B03:year1-injury" };
const B04_IDS = { prePause: "fix06:B04:pre-pause-history", acrossPause: "fix06:B04:across-pause-active" };

function buildFixtureB01() {
  const seed = FIXTURE_SEEDS.B01;
  const player = buildArsenalStPlayer({ careerId: "fix06-b01-old-injury", seed });
  const history = [
    // Dated, long recovered before the June window opens (2025-09-01 → 2025-12-30).
    makeInjuryRecord({
      eventId: B01_IDS.oldDated,
      startDate: "2025-09-01",
      durationDays: 120,
      status: "recovered",
      severity: "major",
    }),
    // Brief literal: [100, 400) in raw day numbers (1970) — far outside any June window.
    makeRawDayInjury(B01_IDS.oldRawDays, 100, 400),
    // Legacy row without onset: unscoped history must not charge every later year.
    makeLegacyDurationOnly(B01_IDS.legacy, 300),
  ];
  setHealth(player, { history, active: null, lastAdvancedDay: toDay(`${START_YEAR}-07-01`) });
  return { seed, snapshot: snapshotNow(player), ids: B01_IDS };
}

function buildFixtureB02() {
  const seed = FIXTURE_SEEDS.B02;
  const player = buildArsenalStPlayer({ careerId: "fix06-b02-carry-in", seed });
  // 2026-05-10 + 61d = 2026-07-10: opens before the window (06-01) and returns inside it.
  const asOf = toDay(`${START_YEAR}-07-01`);
  const active = makeInjuryRecord({
    eventId: B02_IDS.carryIn,
    startDate: "2026-05-10",
    durationDays: 61,
    status: "active",
    severity: "major",
    asOfDay: asOf,
  });
  setHealth(player, { history: [], active, lastAdvancedDay: asOf });
  return { seed, snapshot: snapshotNow(player), ids: B02_IDS };
}

function buildFixtureB03() {
  const seed = FIXTURE_SEEDS.B03;
  const player = buildArsenalStPlayer({ careerId: "fix06-b03-injury-then-recovered", seed });
  const asOf = toDay(`${START_YEAR}-07-01`);
  // Severe, 200 days starting inside year 1: 2026-06-15 → 2026-12-31.
  const active = makeInjuryRecord({
    eventId: B03_IDS.y1,
    startDate: "2026-06-15",
    durationDays: 200,
    status: "active",
    severity: "severe",
    asOfDay: asOf,
  });
  setHealth(player, { history: [], active, lastAdvancedDay: asOf });
  return { seed, snapshot: snapshotNow(player), ids: B03_IDS };
}

function buildFixtureB04() {
  const seed = FIXTURE_SEEDS.B04;
  const built = buildLiveLoanBrowserFixture({ seed });
  assert(built?.ok, `live-loan fixture must reach the winter window: ${built?.reason}`, built);
  const player = built.player;
  const pauseDate = player.seasonCheckpoint?.lastDate;
  const pauseDay = toDay(pauseDate);
  assert(pauseDay != null, "checkpoint lastDate resolves to a day", { pauseDate });
  assertEq(player.seasonCheckpoint.status, "awaiting_decision", "fixture is paused at the winter window");

  const history = [...(player.health?.injuryHistory || [])];
  history.push(
    makeInjuryRecord({
      eventId: B04_IDS.prePause,
      startDate: "2026-10-05",
      durationDays: 40,
      status: "recovered",
      severity: "major",
    })
  );
  let active = player.health?.activeInjury || null;
  if (!active) {
    // Starts 10 days before the pause, returns 20 days after it → straddles the pause.
    const startDate = new Date((pauseDay - 10) * MS_PER_DAY).toISOString().slice(0, 10);
    active = makeInjuryRecord({
      eventId: B04_IDS.acrossPause,
      startDate,
      durationDays: 30,
      status: "active",
      severity: "moderate",
      asOfDay: pauseDay,
    });
  }
  setHealth(player, { history, active, lastAdvancedDay: pauseDay });
  return {
    seed,
    snapshot: snapshotNow(player),
    ids: B04_IDS,
    pauseDate,
    pauseDay,
    activeId: active.eventId,
    checkpointPeriod: jsonClone(player.seasonCheckpoint.developmentPeriod || null),
  };
}

/* ------------------------------------------------------------------ */
/* Case runner                                                         */
/* ------------------------------------------------------------------ */

const results = [];

async function caseRun(id, name, fn) {
  console.log(`\nCASE ${id}: ${name}`);
  const sink = { errors: [], warnings: [] };
  const startedAt = Date.now();
  let browser = null;
  try {
    const { chromium } = await loadPlaywright();
    browser = await chromium.launch({ executablePath: CHROME, headless: !HEADED });
    const detail = await fn({ browser, sink });
    assert(sink.errors.length === 0, "no page errors / unhandled rejections / alerts", sink.errors);
    results.push({
      id,
      name,
      status: "PASS",
      durationMs: Date.now() - startedAt,
      detail,
      runtimeErrors: sink.errors,
      runtimeWarnings: sink.warnings,
    });
    console.log(`  PASS ${id}`);
  } catch (e) {
    results.push({
      id,
      name,
      status: "FAIL",
      durationMs: Date.now() - startedAt,
      error: String(e?.message || e),
      data: e?.data ?? null,
      runtimeErrors: sink.errors,
      runtimeWarnings: sink.warnings,
    });
    console.error(`  FAIL ${id}:`, e?.message || e);
    if (sink.errors.length) console.error("  runtime errors:", JSON.stringify(sink.errors));
  } finally {
    await browser?.close().catch(() => {});
  }
}

/** Shared single-season flow for B01/B02: restore → simulate → Continue → desk. */
async function runSingleSeasonCase({ browser, sink, id, fixture, startYear = START_YEAR, extra }) {
  await mkdir(CASE_DIR, { recursive: true });
  await writeJson(join(FIXTURE_DIR, `${id}-initial.json`), fixture.snapshot);

  const { context, page } = await openSession(browser, sink);
  try {
    await gotoIndex(page);
    const restored = await restoreSnapshot(page, fixture.snapshot);
    const d0 = await debug(page);
    assertEq(d0.seasonsCount, 0, `${id}: starts before season 1`);
    assertEq(d0.position, "ST", `${id}: ST position`);
    assertEq(d0.playingClubId, "club:england:arsenal", `${id}: Arsenal`);
    const ui0 = await uiState(page);
    assertEq(ui0.simulateDisabled, false, `${id}: simulate enabled after restore`);
    await shot(page, `${id}-01-restored-desk`);

    // Injected records survive restore (production migrations must not drop them).
    const restoredSnap = await exportSnapshot(page);
    const injectedIds = healthEventIds(fixture.snapshot.player.health);
    const restoredIds = healthEventIds(restoredSnap.player.health);
    for (const eid of injectedIds) {
      assert(restoredIds.has(eid), `${id}: injected injury ${eid} survived restore`, {
        injected: [...injectedIds],
        restored: [...restoredIds],
      });
    }

    const driven = await driveSeasonToDesk(page, {
      seasonsBefore: 0,
      clickSimulate: true,
      stayDecisions: true,
      shotPrefix: `${id}-02`,
    });
    assert(driven.trace.simulateClicks >= 1, `${id}: real #simulate-btn clicked`, driven.trace);
    assert(driven.trace.postCommitContinueClicks >= 1, `${id}: real #continue-btn clicked`, driven.trace);

    await shot(page, `${id}-03-after-desk`);
    const afterUi = await uiState(page);
    const afterSnapshot = await exportSnapshot(page);
    const before = driven.beforeContinue;
    // Persist evidence first so a failing assertion still leaves artefacts to inspect.
    await writeJson(join(CASE_DIR, `${id}-before-continue.json`), before.snapshot);
    await writeJson(join(CASE_DIR, `${id}-after-desk.json`), afterSnapshot);
    assertDeskClosed(id, afterUi);
    const after = { debug: afterUi.debug, snapshot: afterSnapshot };

    assertEq(before.debug.seasonsCount, 1, `${id}: one committed season before Continue`);
    const facts = checkSeasonHealth(`${id} before Continue`, before.debug.lastSeason, before.snapshot, {
      startYear,
      seasonIndex: 0,
    });
    checkSeasonHealth(`${id} after desk`, after.debug.lastSeason, after.snapshot, { startYear, seasonIndex: 0 });
    checkContinueIsInert(id, before, after);

    const caseExtra = extra
      ? await extra({ facts, before, after, restoredSnap, fixture })
      : {};

    await collectWindowGuards(page, sink);

    return {
      seed: fixture.seed,
      restoreNextAction: restored.nextAction,
      trace: driven.trace,
      before: compactFacts(facts),
      after: {
        overlayHidden: afterUi.overlayHidden,
        dashboardHidden: afterUi.dashboardHidden,
        seasonActionInFlight: afterUi.seasonActionInFlight,
        nextAction: afterUi.debug.nextAction,
        lastSeason: {
          healthyTrainingFraction: afterUi.debug.lastSeason.healthyTrainingFraction,
          rawHealthyTrainingFraction: afterUi.debug.lastSeason.rawHealthyTrainingFraction,
          developmentBreakdownHealthy: afterUi.debug.lastSeason.developmentBreakdownHealthy,
          developmentPeriod: afterUi.debug.lastSeason.developmentPeriod,
        },
      },
      snapshotFiles: {
        initial: `qa/fixtures/fix06/${id}-initial.json`,
        beforeContinue: `qa/fix06-runs/cases/${id}-before-continue.json`,
        afterDesk: `qa/fix06-runs/cases/${id}-after-desk.json`,
      },
      ...caseExtra,
    };
  } finally {
    await collectWindowGuards(page, sink).catch(() => {});
    await context.close().catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* Cases                                                               */
/* ------------------------------------------------------------------ */

async function caseB01({ browser, sink }) {
  const fixture = buildFixtureB01();
  return runSingleSeasonCase({
    browser,
    sink,
    id: "B01",
    fixture,
    extra: async ({ facts, before }) => {
      const ids = fixture.ids;
      const period = facts.period;
      // None of the old injuries intersects the 2026-06-01 → 2027-06-01 window.
      for (const [key, eid] of Object.entries({ oldDated: ids.oldDated, oldRawDays: ids.oldRawDays })) {
        const hit = findInjury(before.snapshot.player.health, eid);
        assert(hit, `B01: ${key} still present on the player`, { eid });
        const start = oracleStartDay(hit.rec);
        const end = oracleReturnDay(hit.rec);
        assert(end <= period.startDay, `B01: ${key} ended before the development window`, {
          start,
          end,
          periodStart: period.startDay,
        });
        assert(
          !facts.contributingEventIds.includes(eid),
          `B01: old injury ${key} must not contribute to the healthy fraction`,
          { eid, contributing: facts.contributingEventIds }
        );
        assert(
          !facts.clippedIntervals.some((c) => c.eventId === eid),
          `B01: old injury ${key} has no clipped interval`,
          facts.clippedIntervals
        );
      }
      // Legacy duration-only row: excluded as unknown, never charged.
      const legacy = findInjury(before.snapshot.player.health, ids.legacy);
      if (legacy) {
        assert(
          facts.excludedUnknownEventIds.includes(ids.legacy),
          "B01: legacy duration-only injury is reported as excluded-unknown",
          facts.excludedUnknownEventIds
        );
        assert(
          !facts.contributingEventIds.includes(ids.legacy),
          "B01: legacy duration-only injury does not contribute",
          facts.contributingEventIds
        );
      }
      // The no-window legacy formula would have zeroed this season; the dated window must not.
      const legacyNoWindow = clamp(1 - (120 + 300 + 300) / 300, 0, 1);
      assert(
        facts.raw > legacyNoWindow,
        "B01: raw fraction is not dragged down by historical durations",
        { raw: facts.raw, legacyNoWindow }
      );
      // New injuries (if any) are the only legitimate source of lost time.
      const newIds = facts.contributingEventIds.filter(
        (eid) => !Object.values(ids).includes(eid)
      );
      const newInjuredDays = facts.injuredDays;
      if (newIds.length === 0) {
        assertEq(facts.injuredDays, 0, "B01: no overlapping injuries ⇒ zero injured days");
        assertClose(facts.raw, 1, "B01: no overlapping injuries ⇒ raw fraction exactly 1");
        assertClose(facts.applied, 1, "B01: no overlapping injuries ⇒ applied fraction exactly 1");
      } else {
        assertClose(
          facts.raw,
          clamp(1 - newInjuredDays / period.days, 0, 1),
          "B01: raw fraction reflects only new in-window injuries"
        );
      }
      return {
        oldInjuryIds: Object.values(ids),
        newOverlappingEventIds: newIds,
        zeroNewOverlap: newIds.length === 0,
        legacyNoWindowWouldBe: legacyNoWindow,
      };
    },
  });
}

async function caseB02({ browser, sink }) {
  const fixture = buildFixtureB02();
  return runSingleSeasonCase({
    browser,
    sink,
    id: "B02",
    fixture,
    extra: async ({ facts, before }) => {
      const eid = B02_IDS.carryIn;
      const period = facts.period;
      const hit = findInjury(before.snapshot.player.health, eid);
      assert(hit, "B02: carry-in injury present after the season", { eid });
      const injStart = toDay("2026-05-10");
      const injReturn = injStart + 61;
      assertEq(oracleStartDay(hit.rec), injStart, "B02: carry-in onset unchanged by the season");
      assertEq(oracleReturnDay(hit.rec), injReturn, "B02: carry-in return boundary unchanged by the season");
      assert(injStart < period.startDay && injReturn > period.startDay, "B02: injury really crosses the window start", {
        injStart,
        injReturn,
        periodStart: period.startDay,
      });
      const expectedClip = injReturn - period.startDay; // 2026-06-01 → 2026-07-10 = 39d
      assertEq(expectedClip, 39, "B02: expected in-window carry-in days");
      const interval = facts.clippedIntervals.find((c) => c.eventId === eid);
      assert(interval, "B02: carry-in injury has a clipped interval", facts.clippedIntervals);
      assertEq(num(interval.startDay, "B02 interval.startDay"), injStart, "B02: interval keeps true onset");
      assertEq(num(interval.returnDay, "B02 interval.returnDay"), injReturn, "B02: interval keeps true return");
      assertEq(num(interval.clippedStartDay, "B02 clippedStartDay"), period.startDay, "B02: clipped to window start");
      assertEq(num(interval.clippedEndDay, "B02 clippedEndDay"), injReturn, "B02: clipped end is the return day");
      assertEq(num(interval.clippedDays, "B02 clippedDays"), expectedClip, "B02: only the in-window days are charged");
      assert(facts.contributingEventIds.includes(eid), "B02: carry-in contributes", facts.contributingEventIds);
      assert(facts.injuredDays >= expectedClip, "B02: injured days include the carry-in", {
        injuredDays: facts.injuredDays,
      });
      assert(
        facts.raw <= 1 - expectedClip / period.days + EPS,
        "B02: raw fraction is reduced by at least the carry-in share",
        { raw: facts.raw, ceiling: 1 - expectedClip / period.days }
      );
      assertEq(hit.where, "history", "B02: carry-in injury is closed into history by season end");
      assertEq(
        num(hit.rec.availabilityReturnDay, "B02 availabilityReturnDay"),
        injReturn,
        "B02: closed record keeps availability boundary (not the later observation day)"
      );
      return {
        carryInEventId: eid,
        carryInClippedDays: expectedClip,
        carryInWhere: hit.where,
        recoveredDay: hit.rec.recoveredDay ?? null,
        availabilityReturnDay: hit.rec.availabilityReturnDay,
      };
    },
  });
}

async function caseB03({ browser, sink }) {
  const fixture = buildFixtureB03();
  await mkdir(CASE_DIR, { recursive: true });
  await writeJson(join(FIXTURE_DIR, "B03-initial.json"), fixture.snapshot);

  const { context, page } = await openSession(browser, sink);
  try {
    await gotoIndex(page);
    await restoreSnapshot(page, fixture.snapshot);
    const d0 = await debug(page);
    assertEq(d0.seasonsCount, 0, "B03: starts before season 1");
    await shot(page, "B03-01-restored-desk");

    // ---- Year 1: injury year ----
    const y1 = await driveSeasonToDesk(page, {
      seasonsBefore: 0,
      clickSimulate: true,
      stayDecisions: true,
      shotPrefix: "B03-02-y1",
    });
    assert(y1.trace.postCommitContinueClicks >= 1, "B03 y1: real #continue-btn clicked", y1.trace);
    await shot(page, "B03-03-y1-desk");
    const y1Ui = await uiState(page);
    assertDeskClosed("B03 y1", y1Ui);
    const y1AfterSnap = await exportSnapshot(page);
    const y1Facts = checkSeasonHealth("B03 y1 before Continue", y1.beforeContinue.debug.lastSeason, y1.beforeContinue.snapshot, {
      startYear: START_YEAR,
      seasonIndex: 0,
    });
    checkSeasonHealth("B03 y1 after desk", y1Ui.debug.lastSeason, y1AfterSnap, {
      startYear: START_YEAR,
      seasonIndex: 0,
    });
    checkContinueIsInert("B03 y1", y1.beforeContinue, { debug: y1Ui.debug, snapshot: y1AfterSnap });

    const y1Interval = y1Facts.clippedIntervals.find((c) => c.eventId === B03_IDS.y1);
    assert(y1Interval, "B03 y1: injury-year event is charged in year 1", y1Facts.clippedIntervals);
    assertEq(num(y1Interval.clippedDays, "B03 y1 clippedDays"), 200, "B03 y1: full 200 days inside the window");
    assert(y1Facts.injuredDays >= 200, "B03 y1: at least 200 injured days", { injuredDays: y1Facts.injuredDays });
    assert(y1Facts.raw <= 1 - 200 / y1Facts.period.days + EPS, "B03 y1: raw fraction ≤ 1 − 200/365", {
      raw: y1Facts.raw,
    });
    const y1Hit = findInjury(y1.beforeContinue.snapshot.player.health, B03_IDS.y1);
    assert(y1Hit, "B03 y1: injury record retained after season 1");
    assertEq(y1Hit.where, "history", "B03 y1: injury closed into history by the end of year 1");
    await writeJson(join(CASE_DIR, "B03-y1-before-continue.json"), y1.beforeContinue.snapshot);
    await writeJson(join(CASE_DIR, "B03-y1-after-desk.json"), y1AfterSnap);

    // ---- Year 2: recovered year ----
    const cleared = await resolveDeskObstacles(page);
    await shot(page, "B03-04-y2-desk");
    const y2 = await driveSeasonToDesk(page, {
      seasonsBefore: 1,
      clickSimulate: true,
      stayDecisions: true,
      shotPrefix: "B03-05-y2",
    });
    assert(y2.trace.postCommitContinueClicks >= 1, "B03 y2: real #continue-btn clicked", y2.trace);
    await shot(page, "B03-06-y2-desk");
    const y2Ui = await uiState(page);
    assertDeskClosed("B03 y2", y2Ui);
    const y2AfterSnap = await exportSnapshot(page);
    assertEq(y2.beforeContinue.debug.seasonsCount, 2, "B03 y2: two committed seasons before Continue");
    const y2Facts = checkSeasonHealth("B03 y2 before Continue", y2.beforeContinue.debug.lastSeason, y2.beforeContinue.snapshot, {
      startYear: START_YEAR,
      seasonIndex: 1,
    });
    checkSeasonHealth("B03 y2 after desk", y2Ui.debug.lastSeason, y2AfterSnap, {
      startYear: START_YEAR,
      seasonIndex: 1,
    });
    checkContinueIsInert("B03 y2", y2.beforeContinue, { debug: y2Ui.debug, snapshot: y2AfterSnap });

    assertEq(y2Facts.period.seasonStartYear, 2027, "B03 y2: second period is 2027-06-01…");
    assertEq(y2Facts.period.startDate, "2027-06-01", "B03 y2: period start");
    assertEq(y2Facts.period.endExclusiveDate, "2028-06-01", "B03 y2: period end");
    assertEq(y2Facts.period.startDay, y1Facts.period.endDay, "B03: year 2 starts exactly where year 1 ends (no overlap)");
    assert(
      !y2Facts.contributingEventIds.includes(B03_IDS.y1),
      "B03 y2: year-1 injury must not be charged again",
      y2Facts.contributingEventIds
    );
    assert(
      !y2Facts.clippedIntervals.some((c) => c.eventId === B03_IDS.y1),
      "B03 y2: no clipped interval for the year-1 injury",
      y2Facts.clippedIntervals
    );
    assert(
      findInjury(y2.beforeContinue.snapshot.player.health, B03_IDS.y1),
      "B03 y2: year-1 injury record is still on file (history is kept, just not re-charged)"
    );
    if (y2Facts.oracle.contributingEventIds.length === 0) {
      assertEq(y2Facts.injuredDays, 0, "B03 y2: recovered year has zero injured days");
      assertClose(y2Facts.raw, 1, "B03 y2: recovered year raw fraction exactly 1");
      assertClose(y2Facts.applied, 1, "B03 y2: recovered year applied fraction exactly 1");
    }
    if (y2Facts.injuredDays < y1Facts.injuredDays) {
      assert(y2Facts.raw > y1Facts.raw, "B03: recovered year has a higher raw healthy fraction", {
        y1: y1Facts.raw,
        y2: y2Facts.raw,
      });
      assert(y2Facts.applied >= y1Facts.applied, "B03: recovered year applied fraction not lower", {
        y1: y1Facts.applied,
        y2: y2Facts.applied,
      });
    }

    await writeJson(join(CASE_DIR, "B03-y2-before-continue.json"), y2.beforeContinue.snapshot);
    await writeJson(join(CASE_DIR, "B03-y2-after-desk.json"), y2AfterSnap);
    await collectWindowGuards(page, sink);

    return {
      seed: fixture.seed,
      deskObstaclesBeforeYear2: cleared.clicked,
      year1: { trace: y1.trace, ...compactFacts(y1Facts) },
      year2: { trace: y2.trace, ...compactFacts(y2Facts) },
      year1ClosedIntoHistory: true,
      year2ChargedYear1Injury: false,
      snapshotFiles: {
        initial: "qa/fixtures/fix06/B03-initial.json",
        y1BeforeContinue: "qa/fix06-runs/cases/B03-y1-before-continue.json",
        y1AfterDesk: "qa/fix06-runs/cases/B03-y1-after-desk.json",
        y2BeforeContinue: "qa/fix06-runs/cases/B03-y2-before-continue.json",
        y2AfterDesk: "qa/fix06-runs/cases/B03-y2-after-desk.json",
      },
    };
  } finally {
    await collectWindowGuards(page, sink).catch(() => {});
    await context.close().catch(() => {});
  }
}

async function acceptLoanFromDesk(page) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await page.evaluate(() => {
      const host = document.getElementById("transfer-offers");
      const buttons = host
        ? [...host.querySelectorAll("button")].filter((b) => !b.disabled && b.offsetParent !== null)
        : [];
      const accept = buttons.find((b) => /^accept loan$/i.test((b.textContent || "").trim()));
      if (accept) {
        const card = accept.closest(".offer-card, .offer, article, li, div");
        const label = (card?.innerText || "").replace(/\s+/g, " ").slice(0, 160);
        accept.click();
        return { clicked: "accept-loan", label };
      }
      const loanChoice = buttons.find((b) => /loan/i.test(b.textContent || "") && !/^decline$/i.test((b.textContent || "").trim()));
      if (loanChoice) {
        const label = (loanChoice.textContent || "").trim();
        loanChoice.click();
        return { clicked: "decision-choice", label };
      }
      return { clicked: null, labels: buttons.map((b) => (b.textContent || "").trim()) };
    });
    if (res.clicked === "accept-loan") return res;
    if (!res.clicked) {
      throw Object.assign(new Error("No Accept Loan control reachable at the winter window"), { data: res });
    }
    await page.waitForTimeout(250);
  }
  throw new Error("Accept Loan control did not appear after choosing the loan decision");
}

async function caseB04({ browser, sink }) {
  const fixture = buildFixtureB04();
  await mkdir(CASE_DIR, { recursive: true });
  await writeJson(join(FIXTURE_DIR, "B04-initial.json"), fixture.snapshot);

  const cp0 = fixture.snapshot.player.seasonCheckpoint;
  assert(cp0?.developmentPeriod, "B04 fixture: checkpoint carries developmentPeriod", cp0);

  // ---- Session A: restore the paused career, inspect, export ----
  const a = await openSession(browser, sink);
  let pausedSnapshot;
  let pausedDebug;
  try {
    await gotoIndex(a.page);
    await restoreSnapshot(a.page, fixture.snapshot);
    pausedDebug = await debug(a.page);
    assertEq(pausedDebug.seasonsCount, 0, "B04: paused before the first season completes");
    assertEq(pausedDebug.seasonCheckpoint, "awaiting_decision", "B04: checkpoint awaiting decision after restore");
    assert(pausedDebug.pendingDecision || pausedDebug.pendingOffers.length, "B04: decision/offers pending after restore", pausedDebug);
    const uiA = await uiState(a.page);
    assertEq(uiA.seasonActionInFlight, false, "B04: seasonActionInFlight false after restore");
    await shot(a.page, "B04-01-paused-restored");

    pausedSnapshot = await exportSnapshot(a.page);
    const ck = pausedSnapshot.player.seasonCheckpoint;
    assert(ck?.developmentPeriod, "B04: exported pause snapshot keeps checkpoint.developmentPeriod", ck);
    assert(
      JSON.stringify(ck.developmentPeriod) === JSON.stringify(cp0.developmentPeriod),
      "B04: checkpoint developmentPeriod identical to the fixture",
      { fixture: cp0.developmentPeriod, exported: ck.developmentPeriod }
    );
    assertEq(num(ck.developmentPeriod.startDay, "B04 ck.startDay"), expectedPeriod(START_YEAR, 0).startDay, "B04: pause period start day");
    assertEq(num(ck.developmentPeriod.endDay, "B04 ck.endDay"), expectedPeriod(START_YEAR, 0).endDay, "B04: pause period end day");
    for (const eid of [B04_IDS.prePause, fixture.activeId]) {
      const hit = findInjury(pausedSnapshot.player.health, eid);
      assert(hit, `B04: ${eid} present in pause snapshot`);
    }
    assertEq(
      findInjury(pausedSnapshot.player.health, fixture.activeId).where,
      "active",
      "B04: across-pause injury is still active at the pause"
    );
    await writeJson(join(CASE_DIR, "B04-paused-export.json"), pausedSnapshot);
    await collectWindowGuards(a.page, sink);
  } finally {
    await a.context.close().catch(() => {});
  }

  // ---- Session B: brand-new page, restore the exported pause, then move ----
  const b = await openSession(browser, sink);
  try {
    await gotoIndex(b.page);
    // Fresh page must not still hold session A's career.
    const blank = await debug(b.page);
    assert(blank === null, "B04: fresh page starts without the paused career", blank);
    await restoreSnapshot(b.page, pausedSnapshot);
    const resumedDebug = await debug(b.page);
    assertEq(resumedDebug.seasonCheckpoint, "awaiting_decision", "B04: restored checkpoint is still awaiting_decision");
    assertEq(resumedDebug.pendingDecision, pausedDebug.pendingDecision, "B04: pending decision preserved across restore");
    assertEq(resumedDebug.seasonsCount, 0, "B04: no season committed by restore");
    const reExport = await exportSnapshot(b.page);
    assert(
      JSON.stringify(reExport.player.seasonCheckpoint.developmentPeriod) === JSON.stringify(cp0.developmentPeriod),
      "B04: developmentPeriod stable across export → restore → export",
      reExport.player.seasonCheckpoint.developmentPeriod
    );
    assert(
      JSON.stringify(reExport.player.health.injuryHistory) === JSON.stringify(pausedSnapshot.player.health.injuryHistory) &&
        JSON.stringify(reExport.player.health.activeInjury) === JSON.stringify(pausedSnapshot.player.health.activeInjury),
      "B04: injury records stable across export → restore → export"
    );
    await shot(b.page, "B04-02-restored-fresh-page");

    const employmentBefore = resumedDebug.employmentClubId;
    // Move: accept a validated development loan (production tray).
    const accepted = await acceptLoanFromDesk(b.page);
    await shot(b.page, "B04-03-loan-accepted");
    const afterMove = await debug(b.page);
    assert(afterMove.activeLoan, "B04: loan active after the move", afterMove);
    assert(
      afterMove.playingClubId && afterMove.playingClubId !== afterMove.employmentClubId,
      "B04: playing club differs from employer after the loan",
      afterMove
    );
    assertEq(afterMove.employmentClubId, employmentBefore, "B04: employer (parent) unchanged by loan");

    // Resume (auto-resumed by the production flow) → presentation → real Continue → desk.
    const driven = await driveSeasonToDesk(b.page, {
      seasonsBefore: 0,
      clickSimulate: false,
      stayDecisions: true,
      shotPrefix: "B04-04",
    });
    assert(driven.trace.postCommitContinueClicks >= 1, "B04: real #continue-btn clicked", driven.trace);
    await shot(b.page, "B04-05-after-desk");
    const afterUi = await uiState(b.page);
    assertDeskClosed("B04", afterUi);
    const afterSnapshot = await exportSnapshot(b.page);
    const before = driven.beforeContinue;

    assertEq(before.debug.seasonsCount, 1, "B04: exactly one season committed (pause/move did not double-count)");
    const facts = checkSeasonHealth("B04 before Continue", before.debug.lastSeason, before.snapshot, {
      startYear: START_YEAR,
      seasonIndex: 0,
    });
    checkSeasonHealth("B04 after desk", afterUi.debug.lastSeason, afterSnapshot, {
      startYear: START_YEAR,
      seasonIndex: 0,
    });
    checkContinueIsInert("B04", before, { debug: afterUi.debug, snapshot: afterSnapshot });

    // The paused checkpoint's period is the one that was evidenced (move must not re-window).
    assert(
      JSON.stringify(
        (({ periodId, seasonId, seasonIndex, seasonStartYear, startDate, endExclusiveDate, startDay, endDay, days }) => ({
          periodId, seasonId, seasonIndex, seasonStartYear, startDate, endExclusiveDate, startDay, endDay, days,
        }))(facts.developmentPeriod)
      ) ===
        JSON.stringify(
          (({ periodId, seasonId, seasonIndex, seasonStartYear, startDate, endExclusiveDate, startDay, endDay, days }) => ({
            periodId, seasonId, seasonIndex, seasonStartYear, startDate, endExclusiveDate, startDay, endDay, days,
          }))(cp0.developmentPeriod)
        ),
      "B04: completed season used the same developmentPeriod as the pause checkpoint",
      { checkpoint: cp0.developmentPeriod, season: facts.developmentPeriod }
    );

    // Both injected injuries are charged exactly once with their true in-window length.
    const pre = facts.clippedIntervals.find((c) => c.eventId === B04_IDS.prePause);
    assert(pre, "B04: pre-pause injury has a clipped interval", facts.clippedIntervals);
    assertEq(num(pre.clippedDays, "B04 pre clippedDays"), 40, "B04: pre-pause injury charged for all 40 days");
    const across = facts.clippedIntervals.find((c) => c.eventId === fixture.activeId);
    assert(across, "B04: across-pause injury has a clipped interval", facts.clippedIntervals);
    const acrossHit = findInjury(before.snapshot.player.health, fixture.activeId);
    assert(acrossHit, "B04: across-pause injury still on file after completion");
    const expectedAcross =
      oracleReturnDay(acrossHit.rec) - oracleStartDay(acrossHit.rec);
    assertEq(
      num(across.clippedDays, "B04 across clippedDays"),
      expectedAcross,
      "B04: across-pause injury charged for its full duration once (no pause/resume double count)"
    );
    assertEq(acrossHit.where, "history", "B04: across-pause injury closed into history");
    assertEq(
      num(acrossHit.rec.availabilityReturnDay, "B04 availabilityReturnDay"),
      oracleStartDay(acrossHit.rec) + num(acrossHit.rec.durationDays, "B04 durationDays"),
      "B04: closed across-pause injury keeps its availability boundary"
    );
    assert(facts.injuredDays >= 40 + expectedAcross, "B04: injured days include both (non-overlapping) injected events", {
      injuredDays: facts.injuredDays,
      injected: 40 + expectedAcross,
    });
    assert(
      facts.raw <= 1 - (40 + expectedAcross) / facts.period.days + EPS,
      "B04: raw fraction at most 1 − injected days / 365 (injected events do not overlap)",
      { raw: facts.raw, injected: 40 + expectedAcross }
    );

    await writeJson(join(CASE_DIR, "B04-before-continue.json"), before.snapshot);
    await writeJson(join(CASE_DIR, "B04-after-desk.json"), afterSnapshot);
    await collectWindowGuards(b.page, sink);

    return {
      seed: fixture.seed,
      pauseDate: fixture.pauseDate,
      pauseDay: fixture.pauseDay,
      checkpointDevelopmentPeriod: cp0.developmentPeriod,
      pausedPendingDecision: pausedDebug.pendingDecision,
      accepted,
      afterMove: {
        playingClubId: afterMove.playingClubId,
        employmentClubId: afterMove.employmentClubId,
        activeLoan: afterMove.activeLoan,
      },
      trace: driven.trace,
      before: compactFacts(facts),
      after: {
        overlayHidden: afterUi.overlayHidden,
        dashboardHidden: afterUi.dashboardHidden,
        seasonActionInFlight: afterUi.seasonActionInFlight,
        nextAction: afterUi.debug.nextAction,
      },
      snapshotFiles: {
        initial: "qa/fixtures/fix06/B04-initial.json",
        pausedExport: "qa/fix06-runs/cases/B04-paused-export.json",
        beforeContinue: "qa/fix06-runs/cases/B04-before-continue.json",
        afterDesk: "qa/fix06-runs/cases/B04-after-desk.json",
      },
    };
  } finally {
    await collectWindowGuards(b.page, sink).catch(() => {});
    await b.context.close().catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

const CASES = [
  { id: "B01", name: "Old injury, later healthy period", fn: caseB01 },
  { id: "B02", name: "Injury crossing the boundary (carry-in)", fn: caseB02 },
  { id: "B03", name: "Injury year followed by recovered year", fn: caseB03 },
  { id: "B04", name: "Pause, snapshot restore and move", fn: caseB04 },
];

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  await mkdir(CASE_DIR, { recursive: true });
  await mkdir(FIXTURE_DIR, { recursive: true });

  for (const id of SELECTED) {
    if (!REQUIRED_CASES.includes(id)) throw new Error(`Unknown case id in CASES: ${id}`);
  }

  for (const c of CASES) {
    if (!SELECTED.includes(c.id)) continue;
    await caseRun(c.id, c.name, c.fn);
  }

  const selectedResults = results.filter((r) => SELECTED.includes(r.id));
  const fullRun = REQUIRED_CASES.every((id) => selectedResults.some((r) => r.id === id));
  const selectedPass =
    selectedResults.length === SELECTED.length && selectedResults.every((r) => r.status === "PASS");
  const summary = {
    generatedAt: new Date().toISOString(),
    fix: "06",
    baseUrl: BASE,
    chrome: CHROME,
    period: "Y = startYear + seasonIndex; [Y-06-01, (Y+1)-06-01)",
    selectedCases: SELECTED,
    fullRun,
    results,
    casesReached: selectedResults.filter((r) => r.status === "PASS").length,
    casesFailed: selectedResults.filter((r) => r.status === "FAIL").length,
    screenshots: shotLog,
    pass: fullRun && selectedPass,
  };
  await writeJson(OUT, summary);
  console.log(
    "\nFix 06 browser checklist summary:",
    JSON.stringify(
      {
        pass: summary.pass,
        fullRun,
        report: OUT,
        results: results.map((r) => `${r.status} ${r.id} ${r.name}`),
      },
      null,
      2
    )
  );

  if (!selectedPass) process.exitCode = 1;
  else if (!fullRun) console.warn("Partial run (CASES filter): report.pass is false by design.");
}

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection in harness:", err);
  process.exitCode = 1;
});

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
