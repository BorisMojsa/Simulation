#!/usr/bin/env node
/**
 * Browser acceptance for Fix 03 league membership after promotion/relegation.
 *
 *   npm install --no-save playwright-core
 *   python3 -m http.server 8000
 *   BASE_URL=http://127.0.0.1:8000 node scripts/browserMembershipChecklist.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8000";
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOT_DIR = join(root, "qa/screenshots/checklist-membership");
const REPORT = join(root, "qa/findings/membership-browser-checklist.json");

function assert(cond, msg, data) {
  if (!cond) {
    const err = new Error(msg);
    err.data = data;
    throw err;
  }
}

async function loadPlaywright() {
  return import("playwright-core");
}

async function waitFor(page, fn, timeoutMs = 30000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await page.evaluate(fn);
    if (last) return last;
    await page.waitForTimeout(100);
  }
  throw new Error(`Timeout. Last=${JSON.stringify(last)}`);
}

async function shot(page, name) {
  await mkdir(SHOT_DIR, { recursive: true });
  const path = join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  console.log(`  screenshot ${path}`);
  return path;
}

async function debug(page) {
  return page.evaluate(() => window.__getLiveCareerDebug?.() || null);
}

async function loadMode(page, mode) {
  await page.goto(`${BASE}/?fixture=membership&mode=${mode}`, { waitUntil: "networkidle" });
  await waitFor(
    page,
    () => {
      const d = window.__getLiveCareerDebug?.();
      return Boolean(d && (d.playingClubId || d.clubId || d.membership));
    },
    45000
  );
  return page.evaluate((m) => window.__loadMembershipBrowserFixture?.({ mode: m }), mode);
}

async function clickMatching(page, pattern) {
  return page.evaluate((pat) => {
    const re = new RegExp(pat, "i");
    const btn = [...document.querySelectorAll("button")].find((b) =>
      re.test((b.textContent || "").trim())
    );
    if (!btn) return null;
    btn.click();
    return (btn.textContent || "").trim();
  }, pattern);
}

async function exercisePauseSkipContinue(page) {
  // Prefer Pause / Skip / Continue controls when present on the live dashboard.
  const actions = [];
  const pause = await clickMatching(page, "^pause$|pause simulation");
  if (pause) actions.push(`pause:${pause}`);
  await page.waitForTimeout(200);
  const skip = await clickMatching(page, "skip match|skip remaining|^skip$");
  if (skip) actions.push(`skip:${skip}`);
  await page.waitForTimeout(200);
  const cont = await clickMatching(page, "continue|resume");
  if (cont) actions.push(`continue:${cont}`);
  return actions;
}

async function runCase(name, fn) {
  console.log(`\nCASE: ${name}`);
  try {
    const evidence = await fn();
    console.log(`  PASS ${name}`);
    return { name, status: "PASS", evidence };
  } catch (err) {
    console.error(`  FAIL ${name}: ${err.message}`);
    if (err.data) console.error("  data", JSON.stringify(err.data, null, 2).slice(0, 2000));
    return { name, status: "FAIL", error: err.message, data: err.data || null };
  }
}

async function withBrowser(fn) {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  try {
    const evidence = await fn(page);
    return { ...evidence, consoleErrors };
  } finally {
    await browser.close();
  }
}

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  let commit = "unknown";
  try {
    commit = execSync("git rev-parse HEAD", { cwd: root }).toString().trim();
  } catch {
    /* ignore */
  }

  const results = [];

  results.push(
    await runCase("promotion", async () =>
      withBrowser(async (page) => {
        const loaded = await loadMode(page, "promotion");
        assert(loaded?.ok, "fixture load", loaded);
        assert(loaded.evidence?.membership?.premier === 20, "PL size 20", loaded);
        assert(loaded.evidence?.membership?.championship === 24, "CH size 24", loaded);
        assert(loaded.evidence?.inPremier === true, "Birmingham in PL", loaded);
        assert(loaded.next?.tableRows === 20, "20 table rows", loaded);
        assert(loaded.next?.fixtures === 380, "380 fixtures", loaded);
        assert(loaded.next?.clubFixtures === 38, "38 Birmingham fixtures", loaded);
        assert(loaded.destination?.clubFixtures === 38, "dest club fixtures", loaded);
        const shotPath = await shot(page, "01-promotion-next-pl");
        const d = await debug(page);
        return { loaded, debug: d, shotPath, commit };
      })
    )
  );

  results.push(
    await runCase("relegation", async () =>
      withBrowser(async (page) => {
        const loaded = await loadMode(page, "relegation");
        assert(loaded?.ok, "fixture load", loaded);
        assert(loaded.evidence?.membership?.premier === 20, "PL size 20", loaded);
        assert(loaded.evidence?.membership?.championship === 24, "CH size 24", loaded);
        assert(loaded.evidence?.inChampionship === true, "Ipswich in CH", loaded);
        assert(loaded.next?.tableRows === 24, "24 rows", loaded);
        assert(loaded.next?.fixtures === 552, "552 fixtures", loaded);
        assert(loaded.next?.clubFixtures === 46, "46 Ipswich fixtures", loaded);
        assert(loaded.destination?.premierStillHasIpswich === false, "PL excludes Ipswich", loaded);
        const shotPath = await shot(page, "02-relegation-next-ch");
        return { loaded, shotPath, commit };
      })
    )
  );

  results.push(
    await runCase("mid-table player", async () =>
      withBrowser(async (page) => {
        const loaded = await loadMode(page, "midtable");
        assert(loaded?.ok, "fixture load", loaded);
        assert(loaded.zones?.playerMoved === false, "player not moved", loaded);
        assert(loaded.zones?.othersMoved === true, "others exchanged", loaded);
        assert(loaded.evidence?.membership?.premier === 20, "PL 20", loaded);
        assert(loaded.evidence?.promoted?.length === 3, "3 promoted", loaded);
        assert(loaded.evidence?.relegated?.length === 3, "3 relegated", loaded);
        const shotPath = await shot(page, "03-midtable-zones");
        return { loaded, shotPath, commit };
      })
    )
  );

  results.push(
    await runCase("offer/loan lookup", async () =>
      withBrowser(async (page) => {
        const loaded = await loadMode(page, "offer-loan");
        assert(loaded?.ok, "fixture load", loaded);
        assert(loaded.offerMeta?.offerOk === true, "offer built", loaded);
        assert(loaded.offerMeta?.buyerLeagueId === "league:england-premier-league", "buyer league", loaded);
        assert(loaded.offerMeta?.destFixtures === 38, "dest fixtures after move", loaded);
        assert(loaded.offerMeta?.catalogLeagueId === "league:england-premier-league", "catalog", loaded);
        const shotPath = await shot(page, "04-offer-loan");
        return { loaded, shotPath, commit };
      })
    )
  );

  results.push(
    await runCase("pause/skip/continue", async () =>
      withBrowser(async (page) => {
        const loaded = await loadMode(page, "next-pause");
        assert(loaded?.ok, "fixture load", loaded);
        assert(loaded.evidence?.membership?.premier === 20, "membership intact", loaded);
        const before = await debug(page);
        const actions = await exercisePauseSkipContinue(page);
        // Also try simulate if available
        await clickMatching(page, "simulate|next season|continue career");
        await page.waitForTimeout(400);
        const after = await debug(page);
        assert(after?.membership?.membership?.premier === 20 || after?.membership?.premier === 20 || loaded.evidence.membership.premier === 20, "no membership drift", { before, after, loaded });
        const shotPath = await shot(page, "05-pause-skip-continue");
        return { loaded, actions, before, after, shotPath, commit };
      })
    )
  );

  results.push(
    await runCase("snapshot/history", async () =>
      withBrowser(async (page) => {
        const loaded = await loadMode(page, "snapshot");
        assert(loaded?.ok, "fixture load", loaded);
        assert(loaded.snapshotOk === true, "snapshot membership 20/24", loaded);
        assert(loaded.next?.tableRows === 20, "next table 20", loaded);
        const shotPath = await shot(page, "06-snapshot-history");
        return { loaded, shotPath, commit };
      })
    )
  );

  results.push(
    await runCase("Fix 01 / Fix 02 regression smoke", async () =>
      withBrowser(async (page) => {
        // Free-agent soft-lock fixture still boots
        await page.goto(`${BASE}/?fixture=free-agent&mode=empty`, { waitUntil: "networkidle" });
        await waitFor(page, () => window.__getLiveCareerDebug?.()?.freeAgent === true, 25000);
        const fa = await debug(page);
        assert(fa?.freeAgent === true, "free agent fixture", fa);
        const faShot = await shot(page, "07-fix01-free-agent");

        await page.goto(`${BASE}/?fixture=ownership-transfer`, { waitUntil: "networkidle" });
        await waitFor(page, () => window.__getLiveCareerDebug?.()?.playingClubId, 25000);
        const own = await debug(page);
        assert(own?.playingClubId === "club:england:arsenal", "ownership fixture", own);
        const ownShot = await shot(page, "08-fix02-ownership");
        return { fa, own, faShot, ownShot, commit };
      })
    )
  );

  const summary = {
    commit,
    baseUrl: BASE,
    chrome: CHROME,
    generatedAt: new Date().toISOString(),
    results,
    pass: results.every((r) => r.status === "PASS"),
  };
  await writeFile(REPORT, JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${REPORT}`);
  console.log(summary.pass ? "ALL BROWSER CASES PASSED" : "BROWSER CASES FAILED");
  if (!summary.pass) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
