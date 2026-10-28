#!/usr/bin/env node
/**
 * Browser acceptance for Fix 05 match participation / evidence ledger.
 *
 *   npm install --no-save playwright-core
 *   BASE_URL=http://127.0.0.1:8000 node scripts/browserMatchParticipationChecklist.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8000";
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOT_DIR = join(root, "qa/screenshots/checklist-match-participation");
const OUT = join(root, "qa/fix05-runs/browser-report.json");

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

async function waitFor(page, fn, timeoutMs = 25000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await page.evaluate(fn);
    if (last) return last;
    await page.waitForTimeout(120);
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

async function loadFixture(page, path) {
  await page.goto(`${BASE}/${path}`, { waitUntil: "networkidle" });
  await waitFor(
    page,
    () => {
      const d = window.__getLiveCareerDebug?.();
      return Boolean(d && (d.playingClubId || d.freeAgent || d.name || d.isAcademy));
    },
    30000
  );
}

async function clickMatching(page, pattern) {
  return page.evaluate((pat) => {
    const re = new RegExp(pat, "i");
    const btn = [...document.querySelectorAll("button")].find((b) => re.test((b.textContent || "").trim()));
    if (!btn) return null;
    btn.click();
    return (btn.textContent || "").trim();
  }, pattern);
}

async function skipThroughSeason(page, { maxSteps = 80 } = {}) {
  for (let i = 0; i < maxSteps; i++) {
    const state = await page.evaluate(() => {
      const d = window.__getLiveCareerDebug?.() || {};
      const continueBtn = document.getElementById("animation-continue");
      const sim = document.getElementById("simulate-btn");
      const overlay = document.getElementById("season-animation-overlay");
      const skipMatch = [...document.querySelectorAll("button")].find((b) =>
        /skip match|skip phase|skip season/i.test(b.textContent || "")
      );
      return {
        seasons: d.seasonsCount ?? d.seasons,
        continueVisible: continueBtn && !continueBtn.classList.contains("hidden"),
        overlayHidden: !overlay || overlay.classList.contains("hidden"),
        simDisabled: Boolean(sim?.disabled),
        simLabel: sim?.textContent || "",
        hasSkip: Boolean(skipMatch),
        pendingOffers: d.pendingOffers?.length || 0,
        pendingDecision: d.pendingDecision,
        lastSeason: d.lastSeason || null,
      };
    });

    if (state.continueVisible) {
      await page.click("#animation-continue").catch(() => {});
      await page.waitForTimeout(120);
      continue;
    }
    if (!state.overlayHidden && state.hasSkip) {
      await clickMatching(page, "skip season|skip phase|skip match|continue");
      await page.waitForTimeout(120);
      continue;
    }
    if (state.pendingOffers || state.pendingDecision) return state;
    if (state.lastSeason?.matches != null && state.overlayHidden) return state;
    if (!state.simDisabled) {
      await page.click("#simulate-btn").catch(() => {});
      await page.waitForTimeout(200);
      continue;
    }
    await page.waitForTimeout(150);
  }
  return debug(page);
}

async function readMatchCards(page) {
  return page.evaluate(() => {
    return [...document.querySelectorAll(".match-card, [data-role='contrib']")]
      .slice(0, 40)
      .map((el) => {
        const card = el.classList.contains("match-card") ? el : el.closest(".match-card");
        const contrib = card?.querySelector("[data-role='contrib']")?.textContent || el.textContent || "";
        const rating = card?.querySelector("[data-role='rating']")?.textContent || "";
        return { contrib: contrib.trim(), rating: rating.trim() };
      });
  });
}

const results = [];

async function caseRun(name, fn) {
  console.log(`\nCASE: ${name}`);
  try {
    const detail = await fn();
    results.push({ name, status: "PASS", detail });
    console.log(`  PASS ${name}`);
  } catch (e) {
    results.push({ name, status: "FAIL", error: String(e.message || e), data: e.data || null });
    console.error(`  FAIL ${name}:`, e.message || e);
  }
}

async function main() {
  const { chromium } = await loadPlaywright();
  await mkdir(SHOT_DIR, { recursive: true });

  await caseRun("move-loan-ownership-transfer", async () => {
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const page = await browser.newPage();
    try {
      await loadFixture(page, "?fixture=ownership-transfer");
      const before = await debug(page);
      assert(before?.playingClubId === "club:england:arsenal", "start Arsenal", before);
      await shot(page, "01-transfer-desk");
      const clicked = await page.evaluate(() => {
        const btn = [...document.querySelectorAll("button")].find((b) =>
          /accept/i.test(b.textContent || "") && /brentford/i.test(b.closest("div,li,article")?.innerText || "")
        ) || [...document.querySelectorAll("button")].find((b) => /accept offer|accept/i.test(b.textContent || ""));
        btn?.click();
        return btn?.textContent || null;
      });
      assert(clicked, "accept transfer");
      await page.waitForTimeout(400);
      const after = await debug(page);
      assert(after.playingClubId === "club:england:brentford", "playing Brentford", after);
      await shot(page, "02-transfer-accepted");
      await skipThroughSeason(page);
      await shot(page, "03-transfer-season");
      return { playing: after.playingClubId, seasons: after.seasonsCount };
    } finally {
      await browser.close();
    }
  });

  await caseRun("live-loan-controls", async () => {
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const page = await browser.newPage();
    try {
      await loadFixture(page, "?fixture=live-loan");
      await shot(page, "04-loan-desk");
      await clickMatching(page, "review loan options");
      await page.waitForTimeout(200);
      const accept = await page.evaluate(() => {
        const btn = [...document.querySelectorAll("button")].find((b) => /accept loan|accept offer|accept/i.test(b.textContent || ""));
        btn?.click();
        return btn?.textContent || null;
      });
      assert(accept, "accept a loan offer");
      await page.waitForTimeout(400);
      const d = await debug(page);
      assert(d.employmentClubId === "club:italy:atalanta", "employer Atalanta", d);
      assert(d.playingClubId && d.playingClubId !== d.employmentClubId, "playing club moved", d);
      await shot(page, "05-loan-accepted");
      return { playing: d.playingClubId, employment: d.employmentClubId };
    } finally {
      await browser.close();
    }
  });

  await caseRun("free-agent-predecessor-smoke", async () => {
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const page = await browser.newPage();
    try {
      await loadFixture(page, "?fixture=free-agent-offers");
      const d = await debug(page);
      assert(d?.freeAgent || !d?.playingClubId, "free agent desk", d);
      await shot(page, "06-free-agent");
      const next = d.nextAction;
      assert(next, "next action present", d);
      return { nextAction: next, offers: d.pendingOffers };
    } finally {
      await browser.close();
    }
  });

  await caseRun("academy-predecessor-smoke", async () => {
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const page = await browser.newPage();
    try {
      await loadFixture(page, "?fixture=academy-continue-offers");
      const d = await debug(page);
      assert(d?.isAcademy || d?.academyLifecycle, "academy fixture", d);
      await shot(page, "07-academy");
      const seasons = d.lastSeason || null;
      if (seasons?.evidenceByScope?.league?.appearances) {
        // Academy must not invent senior league fixtures pre-graduation.
        assert(false, "academy should not have senior league appearances before graduation", seasons);
      }
      return { academy: d.academyLifecycle, nextAction: d.nextAction };
    } finally {
      await browser.close();
    }
  });

  await caseRun("skip-controls-and-match-cards", async () => {
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const page = await browser.newPage();
    try {
      // Ordinary career: start page then fill setup if needed — ownership fixture already mid-season.
      await loadFixture(page, "?fixture=ownership-transfer");
      // Decline/stay path: skip decision by simulating continue if possible.
      await page.evaluate(() => {
        const stay = [...document.querySelectorAll("button")].find((b) => /stay|reject|decline|keep/i.test(b.textContent || ""));
        stay?.click();
      });
      await page.waitForTimeout(300);
      // Drive simulate / skip season
      for (let i = 0; i < 30; i++) {
        const progressed = await page.evaluate(() => {
          const skip = [...document.querySelectorAll("button")].find((b) =>
            /skip season|skip phase|skip match/i.test(b.textContent || "")
          );
          if (skip) {
            skip.click();
            return "skip";
          }
          const sim = document.getElementById("simulate-btn");
          if (sim && !sim.disabled) {
            sim.click();
            return "sim";
          }
          const cont = document.getElementById("animation-continue");
          if (cont && !cont.classList.contains("hidden")) {
            cont.click();
            return "continue";
          }
          return null;
        });
        await page.waitForTimeout(150);
        if (!progressed) break;
      }
      await shot(page, "08-skip-controls");
      const cards = await readMatchCards(page);
      const zeroish = cards.filter((c) =>
        /unused|not selected|injured|did not play/i.test(c.contrib)
      );
      const ratedZero = zeroish.filter((c) => c.rating && c.rating !== "—" && c.rating !== "-");
      assert(ratedZero.length === 0, "zero-minute cards must not show numeric ratings", ratedZero);
      return { cardsSample: cards.slice(0, 8), zeroish: zeroish.length };
    } finally {
      await browser.close();
    }
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE,
    chrome: CHROME,
    results,
    pass: results.every((r) => r.status === "PASS"),
  };
  await writeFile(OUT, JSON.stringify(summary, null, 2));
  console.log("\nBrowser checklist summary:", JSON.stringify({ pass: summary.pass, results: results.map((r) => `${r.status} ${r.name}`) }, null, 2));
  if (!summary.pass) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
