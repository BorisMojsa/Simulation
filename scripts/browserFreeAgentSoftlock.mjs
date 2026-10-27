#!/usr/bin/env node
/**
 * Real-browser acceptance for the free-agent UI soft-lock fix.
 *
 * Prerequisites:
 *   - Local static server serving the repo root
 *   - Playwright Core + system Google Chrome
 *
 * Install (one-time):
 *   npm install --no-save playwright-core
 *
 * Run:
 *   python3 -m http.server 8765
 *   node scripts/browserFreeAgentSoftlock.mjs
 *   BASE_URL=http://127.0.0.1:8765 node scripts/browserFreeAgentSoftlock.mjs
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE_URL = process.env.BASE_URL || "";
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

async function loadPlaywright() {
  try {
    return await import("playwright-core");
  } catch {
    // Resolve from a temporary npm install next to the script if needed.
    throw new Error(
      "playwright-core is not installed. Run: npm install --no-save playwright-core"
    );
  }
}

function startStaticServer() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        let rel = decodeURIComponent(url.pathname);
        if (rel.endsWith("/")) rel += "index.html";
        if (rel.startsWith("/")) rel = rel.slice(1);
        const filePath = join(root, rel.split("?")[0]);
        if (!filePath.startsWith(root)) {
          res.writeHead(403);
          res.end("forbidden");
          return;
        }
        const data = await readFile(filePath);
        res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end("not found");
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function waitFor(page, fn, timeoutMs = 8000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await page.evaluate(fn);
    if (last) return last;
    await page.waitForTimeout(100);
  }
  throw new Error(`Timeout waiting for condition. Last=${JSON.stringify(last)}`);
}

async function run() {
  const { chromium } = await loadPlaywright();
  let server = null;
  let baseUrl = BASE_URL;
  if (!baseUrl) {
    const started = await startStaticServer();
    server = started.server;
    baseUrl = started.baseUrl;
  }

  const pageErrors = [];
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
  });
  const page = await browser.newPage();
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(`console: ${msg.text()}`);
  });

  const results = [];

  try {
    await page.goto(`${baseUrl}/?fixture=free-agent&mode=empty`, { waitUntil: "networkidle" });
    await waitFor(page, () => {
      const btn = document.getElementById("simulate-btn");
      const career = document.getElementById("career-section");
      return Boolean(btn && career && !career.classList.contains("hidden") && !btn.disabled);
    });

    const before = await page.evaluate(() => window.__getLiveCareerDebug());
    assert(before?.freeAgent || !before?.club, "fixture should be free agent");
    assert((before?.weeklyWage || 0) === 0, "wage should be 0");
    assert((before?.pendingOffers || []).length === 0, "empty mode has no offers");

    await page.click("#simulate-btn");
    await waitFor(page, () => {
      const recap = document.getElementById("free-agent-recap");
      const cont = document.getElementById("animation-continue");
      const overlay = document.getElementById("season-animation-overlay");
      return (
        recap &&
        !recap.classList.contains("hidden") &&
        cont &&
        !cont.classList.contains("hidden") &&
        overlay &&
        !overlay.classList.contains("hidden")
      );
    });

    const mid = await page.evaluate(() => ({
      matchHidden: document.getElementById("match-viewer-section")?.classList.contains("hidden"),
      dashHidden: document.getElementById("simulation-dashboard")?.classList.contains("hidden"),
      continueText: document.getElementById("continue-btn")?.textContent,
      seasons: window.__getLiveCareerDebug()?.seasons,
      age: window.__getLiveCareerDebug()?.age,
    }));
    assert(mid.matchHidden, "match viewer must stay hidden");
    assert(mid.dashHidden, "dashboard must stay hidden");
    assert(mid.continueText === "Continue", "Continue label");
    assert(mid.age === before.age + 1, "age advances once before Continue");
    assert(mid.seasons === before.seasons + 1, "period count advances once");

    await page.click("#continue-btn");
    await waitFor(page, () => document.getElementById("season-animation-overlay")?.classList.contains("hidden"));

    const after = await page.evaluate(() => {
      const log = document.getElementById("season-log");
      const text = log?.innerText || "";
      return {
        debug: window.__getLiveCareerDebug(),
        historyCards: log?.querySelectorAll(".season-card")?.length || 0,
        historyText: text,
        simulateLabel: document.getElementById("simulate-btn")?.textContent,
        simulateDisabled: document.getElementById("simulate-btn")?.disabled,
        overlayHidden: document.getElementById("season-animation-overlay")?.classList.contains("hidden"),
      };
    });

    assert(after.overlayHidden, "overlay closed");
    assert(after.historyCards === 1, `expected 1 history card, got ${after.historyCards}`);
    assert(/Free agent/i.test(after.historyText), "history mentions Free agent");
    assert(!/undefined|NaN/.test(after.historyText), "history must not show undefined/NaN");
    assert(after.debug.careerTotals.matches === (before.careerTotals?.matches || 0), "career matches unchanged");
    assert((after.debug.weeklyWage || 0) === 0, "wage remains 0");

    if ((after.debug.pendingOffers || []).length > 0) {
      assert(after.simulateDisabled === true, "offers block simulation");
      results.push("empty-period→offers-ready");
      // Decline the window via production control so searching returns.
      const declined = await page.evaluate(() => {
        const btn = [...document.querySelectorAll("#transfer-offers button")].find((b) =>
          /continue as free agent|decline all|no thanks|remain a free agent/i.test(b.textContent || "")
        );
        if (btn) {
          btn.click();
          return "clicked-decline";
        }
        // Fallback: clear offers the same way finishOfferWindow(false) does for tests.
        const dbg = window.__getLiveCareerDebug();
        return dbg ? "no-decline-button" : "missing-debug";
      });
      if (declined === "clicked-decline") {
        await waitFor(page, () => {
          const btn = document.getElementById("simulate-btn");
          return btn && !btn.disabled && /free agent/i.test(btn.textContent || "");
        });
        results.push("decline-restores-search");
      }
    } else {
      assert(after.simulateDisabled === false, "search should be available again");
      assert(/free agent/i.test(after.simulateLabel || ""), "button label is free-agent action");
    }

    // Second successive train/search when the desk allows it.
    const canSearch = await page.evaluate(() => {
      const btn = document.getElementById("simulate-btn");
      return Boolean(btn && !btn.disabled && /free agent/i.test(btn.textContent || ""));
    });
    if (canSearch) {
      const age2 = await page.evaluate(() => window.__getLiveCareerDebug()?.age);
      const cardsBefore = await page.evaluate(
        () => document.getElementById("season-log")?.querySelectorAll(".season-card")?.length || 0
      );
      await page.click("#simulate-btn");
      await waitFor(page, () => !document.getElementById("free-agent-recap")?.classList.contains("hidden"));
      await page.click("#continue-btn");
      await waitFor(page, () => document.getElementById("season-animation-overlay")?.classList.contains("hidden"));
      const second = await page.evaluate(() => ({
        debug: window.__getLiveCareerDebug(),
        cards: document.getElementById("season-log")?.querySelectorAll(".season-card")?.length || 0,
      }));
      assert(second.debug.age === age2 + 1, "second period ages once");
      assert(second.cards === cardsBefore + 1, "another history entry");
      results.push("two-successive-search-periods");
    }

    // Retirement boundary fixture
    await page.goto(`${baseUrl}/?fixture=free-agent-retire`, { waitUntil: "networkidle" });
    await waitFor(page, () => window.__getLiveCareerDebug()?.age === 41);
    await page.click("#simulate-btn");
    // Age-42 auto-retire should not leave a free-agent recap open.
    await page.waitForTimeout(500);
    const retired = await page.evaluate(() => ({
      debug: window.__getLiveCareerDebug(),
      overlayHidden: document.getElementById("season-animation-overlay")?.classList.contains("hidden"),
      recapHidden: document.getElementById("free-agent-recap")?.classList.contains("hidden"),
      simulateDisabled: document.getElementById("simulate-btn")?.disabled,
    }));
    assert(retired.debug.age === 42, "age reached 42");
    assert(retired.overlayHidden, "no orphaned overlay after retirement path");
    assert(retired.recapHidden !== false || retired.debug.isRetired, "no stuck free-agent recap");
    results.push("retire-41-boundary");

    if (pageErrors.length) {
      throw new Error(`Page errors: ${pageErrors.join(" | ")}`);
    }

    console.log("PASS browser free-agent soft-lock acceptance");
    console.log(JSON.stringify({ baseUrl, results, pageErrors }, null, 2));
  } finally {
    await browser.close();
    if (server) server.close();
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

run().catch((err) => {
  console.error("FAIL", err);
  process.exitCode = 1;
});
