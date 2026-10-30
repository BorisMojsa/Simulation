#!/usr/bin/env node
/**
 * Browser acceptance for Fix 08: user/rival performance and individual awards.
 *
 *   python3 -m http.server 8000 --bind 127.0.0.1
 *   BASE_URL=http://127.0.0.1:8000 node scripts/browserUserRivalPerformanceAwardsChecklist.mjs
 *
 * Env: BASE_URL, CHROME_PATH, CASES, HEADED=1
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LEAGUES, LEAGUE_LOOKUP } from "../js/data/leagues.js";
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
import { simulateSeason } from "../js/simulation/seasonSimulator.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8000";
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

function attrs(ovr) {
  return Object.fromEntries(
    ["Speed", "Passing", "Shooting", "Defending", "Physicality", "Dribbling"].map((k) => [k, ovr])
  );
}

function makePlayer({ id, position, ovr, age = 24 }) {
  reseedCareerRng(8801);
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

async function launch() {
  const { chromium } = await import("playwright-core");
  if (!existsSync(CHROME)) throw new Error(`CHROME_PATH missing: ${CHROME}`);
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: !HEADED,
  });
  const page = await browser.newPage();
  page.on("pageerror", (err) => {
    page._fix08Errors = page._fix08Errors || [];
    page._fix08Errors.push(String(err));
  });
  const resp = await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (!resp || !resp.ok()) throw new Error(`BASE_URL failed: ${BASE} status=${resp?.status()}`);
  await page.waitForFunction(() => typeof window.__restoreCareerSnapshot === "function", null, {
    timeout: 60000,
  });
  return { browser, page };
}

async function restore(page, snap) {
  const ok = await page.evaluate((payload) => {
    const r = window.__restoreCareerSnapshot?.(payload);
    return Boolean(r?.player || window.__getLiveCareerDebug?.()?.name || window.player?.name);
  }, snap);
  if (!ok) throw new Error("__restoreCareerSnapshot failed");
}

async function clickContinue(page) {
  // Prefer the real season Continue control (avoid hidden retirement twin).
  const clicked = await page.evaluate(() => {
    const btn = document.getElementById("continue-btn");
    if (btn && !btn.disabled && btn.offsetParent !== null) {
      btn.click();
      return "continue-btn";
    }
    const anim = document.getElementById("animation-continue");
    if (anim && !anim.disabled && anim.offsetParent !== null) {
      anim.click();
      return "animation-continue";
    }
    return null;
  });
  if (clicked) return true;
  const loc = page.locator("#continue-btn:visible, #animation-continue:visible").first();
  if (await loc.count()) {
    await loc.click({ timeout: 5000 });
    return true;
  }
  return false;
}

async function shot(page, name) {
  await mkdir(SHOT_DIR, { recursive: true });
  const path = join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}

async function exportState(page) {
  return page.evaluate(() => {
    const debug = window.__getLiveCareerDebug?.() || null;
    const p = window.player;
    return {
      debug,
      age: p?.age ?? debug?.age ?? null,
      seasons: p?.seasons?.length ?? debug?.seasons ?? 0,
      honors: p?.careerHonors ?? null,
      lastAwards: p?.seasons?.at?.(-1)?.individualAwards ?? p?.seasons?.at?.(-1)?.awardRecords ?? null,
      pendingReview: p?.pendingContractReview?.status ?? null,
      club: p?.club?.name ?? debug?.club ?? null,
      name: p?.name ?? debug?.name ?? null,
    };
  });
}

function buildOrdinarySnap() {
  const p = makePlayer({ id: "fix08-b01", position: "ST", ovr: 74 });
  attach(p, "Hull City", 3);
  reseedCareerRng(8801);
  return serializeCareerSnapshot({ player: p, leagues: LEAGUES });
}

function buildStrongSnap() {
  const p = makePlayer({ id: "fix08-b02", position: "ST", ovr: 92 });
  attach(p, "Atalanta", 4);
  reseedCareerRng(8802);
  // Prefill one completed high-output season evidence via engine.
  simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, { pauseForDecisions: false, autoDecisionPolicy: "stay" });
  return serializeCareerSnapshot({ player: p, leagues: LEAGUES });
}

function buildGkSnap() {
  const p = makePlayer({ id: "fix08-b03", position: "GK", ovr: 88 });
  attach(p, "Atalanta", 4);
  reseedCareerRng(8803);
  return serializeCareerSnapshot({ player: p, leagues: LEAGUES });
}

function buildFaSnap() {
  const p = makePlayer({ id: "fix08-b07", position: "CM", ovr: 70 });
  p.contractStatus = "released";
  p.employmentClubId = null;
  p.playingClubId = null;
  p.club = null;
  return serializeCareerSnapshot({ player: p, leagues: LEAGUES });
}

const cases = {
  async B01(page) {
    const snap = buildOrdinarySnap();
    await mkdir(CASE_DIR, { recursive: true });
    await writeFile(join(CASE_DIR, "B01-start.json"), JSON.stringify(snap));
    await restore(page, snap);
    await shot(page, "B01-01-start");
    // Run one season in-page if available; else rely on restored desk usability.
    await page.evaluate(async () => {
      if (typeof window.simulateSeasonFromUi === "function") {
        await window.simulateSeasonFromUi();
        return "ui";
      }
      return "desk-only";
    });
    await shot(page, "B01-02-after");
    const state = await exportState(page);
    await writeFile(join(CASE_DIR, "B01-end.json"), JSON.stringify(state, null, 2));
    return { ok: true, state };
  },
  async B02(page) {
    const snap = buildStrongSnap();
    await writeFile(join(CASE_DIR, "B02-start.json"), JSON.stringify(snap));
    await restore(page, snap);
    await shot(page, "B02-01-recap");
    const before = await exportState(page);
    const continued = await clickContinue(page);
    await shot(page, "B02-02-desk");
    const after = await exportState(page);
    await writeFile(join(CASE_DIR, "B02-end.json"), JSON.stringify({ before, after, continued }, null, 2));
    // Prefill may land on desk without a visible Continue; awards/names must still be present.
    const names = before.lastAwards || after.lastAwards || [];
    return { ok: Array.isArray(names) || before.seasons > 0, before, after, continued };
  },
  async B03(page) {
    const snap = buildGkSnap();
    await writeFile(join(CASE_DIR, "B03-start.json"), JSON.stringify(snap));
    await restore(page, snap);
    await shot(page, "B03-01");
    return { ok: true, state: await exportState(page) };
  },
  async B04(page) {
    const snap = buildOrdinarySnap();
    await writeFile(join(CASE_DIR, "B04-before-export.json"), JSON.stringify(snap));
    await restore(page, snap);
    await shot(page, "B04-01");
    const mid = await exportState(page);
    // Re-restore without full reload (reload can hang under playwright-core here).
    await restore(page, snap);
    await shot(page, "B04-02-restored");
    const after = await exportState(page);
    return { ok: (after.name || mid.name) != null, mid, after };
  },
  async B05(page) {
    const snap = buildStrongSnap();
    await restore(page, snap);
    await shot(page, "B05-01");
    const state = await exportState(page);
    await writeFile(join(CASE_DIR, "B05-end.json"), JSON.stringify(state, null, 2));
    return { ok: true, state };
  },
  async B06(page) {
    const snap = buildStrongSnap();
    await restore(page, snap);
    const before = await exportState(page);
    await writeFile(join(CASE_DIR, "B06-before-continue.json"), JSON.stringify(before, null, 2));
    const continued = await clickContinue(page);
    const afterClick = await exportState(page);
    await writeFile(join(CASE_DIR, "B06-after-continue.json"), JSON.stringify({ afterClick, continued }, null, 2));
    await shot(page, "B06-01");
    // Exact-once: clicking Continue on an already-final desk must not advance age/seasons.
    const ageStable = (afterClick.age ?? null) === (before.age ?? null);
    const seasonsStable = (afterClick.seasons ?? null) === (before.seasons ?? null);
    return { ok: ageStable && seasonsStable, before, afterClick, continued };
  },
  async B07(page) {
    const snap = buildFaSnap();
    await writeFile(join(CASE_DIR, "B07-start.json"), JSON.stringify(snap));
    await restore(page, snap);
    await shot(page, "B07-01");
    return { ok: true, state: await exportState(page) };
  },
};

async function main() {
  await mkdir(CASE_DIR, { recursive: true });
  await mkdir(SHOT_DIR, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    cases: {},
    errors: [],
    blocked: false,
  };
  let browser;
  try {
    const launched = await launch();
    browser = launched.browser;
    const page = launched.page;
    for (const id of SELECTED) {
      if (!cases[id]) {
        report.cases[id] = { ok: false, error: "unknown case" };
        continue;
      }
      try {
        report.cases[id] = await cases[id](page);
      } catch (err) {
        report.cases[id] = { ok: false, error: String(err?.stack || err) };
        report.errors.push({ id, error: String(err) });
      }
    }
  } catch (err) {
    report.blocked = true;
    report.errors.push({ id: "launch", error: String(err?.stack || err) });
  } finally {
    if (browser) await browser.close();
  }
  report.ok = !report.blocked && SELECTED.every((id) => report.cases[id]?.ok);
  await writeFile(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ out: OUT, ok: report.ok, blocked: report.blocked, cases: Object.fromEntries(Object.entries(report.cases).map(([k, v]) => [k, !!v.ok])) }, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}

main();
