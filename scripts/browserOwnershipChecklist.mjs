#!/usr/bin/env node
/**
 * Browser acceptance for Fix 02 club ownership after transfers/loans.
 *
 *   npm install --no-save playwright-core
 *   BASE_URL=http://127.0.0.1:8000 node scripts/browserOwnershipChecklist.mjs
 */
import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8000";
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOT_DIR = join(root, "qa/screenshots/checklist-ownership");
const FLOW = process.env.FLOW || "all";

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

async function waitFor(page, fn, timeoutMs = 20000) {
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

async function loadFixture(page, path) {
  await page.goto(`${BASE}/${path}`, { waitUntil: "networkidle" });
  await waitFor(
    page,
    () => {
      const d = window.__getLiveCareerDebug?.();
      return Boolean(d && (d.playingClubId || d.freeAgent || d.name));
    },
    25000
  );
}

async function clickButtonMatching(page, pattern) {
  const clicked = await page.evaluate((pat) => {
    const re = new RegExp(pat, "i");
    const btn = [...document.querySelectorAll("button")].find((b) => re.test((b.textContent || "").trim()));
    if (!btn) return null;
    btn.click();
    return (btn.textContent || "").trim();
  }, pattern);
  return clicked;
}

async function clickAcceptOffer(page, clubHint) {
  // Loan path: open the loan list first when the decision card is still showing.
  const review = await clickButtonMatching(page, "review loan options");
  if (review) await page.waitForTimeout(250);

  const clicked = await page.evaluate((hint) => {
    const buttons = [...document.querySelectorAll("button")];
    const btn = buttons.find((b) => {
      const t = (b.textContent || "").toLowerCase();
      const card = b.closest(".offer-card, .transfer-offer, .decision-card, article, li, div");
      const ctx = `${t} ${card?.innerText || ""}`.toLowerCase();
      return (
        (t.includes("accept loan") || t.includes("accept offer") || t.includes("accept")) &&
        ctx.includes(String(hint).toLowerCase())
      );
    });
    if (btn) {
      btn.click();
      return btn.textContent;
    }
    const any = buttons.find((b) => /accept loan|accept offer/i.test(b.textContent || ""));
    if (any) {
      any.click();
      return any.textContent;
    }
    return null;
  }, clubHint);
  assert(clicked, `no accept button for ${clubHint}`);
  return clicked;
}

async function skipScenesAndFinishSeason(page) {
  for (let i = 0; i < 40; i++) {
    const state = await page.evaluate(() => {
      const d = window.__getLiveCareerDebug?.() || {};
      const continueBtn = document.getElementById("animation-continue");
      const skipBtn = [...document.querySelectorAll("button")].find((b) =>
        /skip|continue|dismiss|close/i.test(b.textContent || "")
      );
      const sim = document.getElementById("simulate-btn");
      const overlayHidden = document.getElementById("season-animation-overlay")?.classList.contains("hidden");
      const scenarioHidden =
        !document.getElementById("senior-scenario-overlay") ||
        document.getElementById("senior-scenario-overlay").classList.contains("hidden");
      return {
        seasons: d.seasonsCount ?? d.age,
        playingClubId: d.playingClubId,
        employmentClubId: d.employmentClubId,
        pendingOffers: d.pendingOffers?.length || 0,
        pendingDecision: d.pendingDecision,
        continueVisible: continueBtn && !continueBtn.classList.contains("hidden"),
        overlayHidden,
        scenarioHidden,
        simDisabled: Boolean(sim?.disabled),
        simLabel: sim?.textContent || null,
        hasSkip: Boolean(skipBtn),
      };
    });

    if (state.continueVisible) {
      await page.click("#animation-continue");
      await page.waitForTimeout(150);
      continue;
    }
    if (!state.scenarioHidden) {
      await page.evaluate(() => {
        const btns = [...document.querySelectorAll("#senior-scenario-overlay button, .scenario-actions button")];
        const skip = btns.find((b) => /skip|continue|dismiss/i.test(b.textContent || "")) || btns[0];
        skip?.click();
      });
      await page.waitForTimeout(150);
      continue;
    }
    if (!state.overlayHidden) {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((el) =>
          /skip|continue/i.test(el.textContent || "")
        );
        b?.click();
      });
      await page.waitForTimeout(150);
      continue;
    }
    if (state.pendingOffers > 0 || state.pendingDecision) {
      return state;
    }
    if (!state.simDisabled && /simulate|next season|continue career/i.test(state.simLabel || "")) {
      // Season finished enough to leave mid-season resume.
      return state;
    }
    // Try simulating if enabled (resume after accept may auto-run)
    if (!state.simDisabled) {
      await page.click("#simulate-btn").catch(() => {});
      await page.waitForTimeout(200);
      continue;
    }
    await page.waitForTimeout(200);
  }
  return debug(page);
}

async function flowLoan() {
  console.log("\nFLOW 1: cross-country loan (live-loan → Rudeš)");
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
  });
  const page = await browser.newPage();
  try {
    await loadFixture(page, "?fixture=live-loan");
    let d = await debug(page);
    assert(d?.playingClubId === "club:italy:atalanta", "start at Atalanta", d);
    await shot(page, "01-loan-before-accept");
    await clickAcceptOffer(page, "rude");
    await page.waitForTimeout(300);
    d = await debug(page);
    assert(d.playingClubId === "club:croatia:rudes", "playing club becomes Rudeš", d);
    assert(d.employmentClubId === "club:italy:atalanta", "employer remains Atalanta", d);
    await shot(page, "02-loan-after-accept");
    await skipScenesAndFinishSeason(page);
    d = await debug(page);
    assert(d.playingClubId === "club:croatia:rudes", "playing remains Rudeš after resume", d);
    assert(d.employmentClubId === "club:italy:atalanta", "employment remains Atalanta after resume", d);
    await shot(page, "03-loan-after-resume");
    console.log("  OK loan ownership", {
      playing: d.playingClubId,
      employment: d.employmentClubId,
      honors: d.careerHonors,
      trophies: d.lastSeasonTrophies,
    });
  } finally {
    await browser.close();
  }
}

async function flowTransfer() {
  console.log("\nFLOW 2: same-league permanent (ownership-transfer → Brentford)");
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
  });
  const page = await browser.newPage();
  try {
    await loadFixture(page, "?fixture=ownership-transfer");
    let d = await debug(page);
    assert(d?.playingClubId === "club:england:arsenal", "start at Arsenal", d);
    await shot(page, "04-transfer-before-accept");
    await clickAcceptOffer(page, "brentford");
    await page.waitForTimeout(400);
    d = await debug(page);
    assert(d.playingClubId === "club:england:brentford", "playing club becomes Brentford", d);
    assert(d.employmentClubId === "club:england:brentford", "employment becomes Brentford", d);
    await shot(page, "05-transfer-after-accept");
    await skipScenesAndFinishSeason(page);
    d = await debug(page);
    assert(d.playingClubId === "club:england:brentford", "still Brentford after season", d);
    const trophies = d.lastSeasonTrophies || d.seasonTrophies || [];
    if (Array.isArray(trophies)) {
      for (const t of trophies) {
        if (t?.kind === "continental" || /champions league/i.test(t?.label || t?.competition || "")) {
          assert(
            t.winningClubId,
            "continental honor must carry winningClubId (no unlabeled world-won trophy)",
            t
          );
        }
      }
    }
    console.log("  OK transfer ownership", {
      playing: d.playingClubId,
      honors: d.careerHonors,
      lastSeasonHonors: d.lastSeasonHonors,
      trophies,
    });
    await shot(page, "06-transfer-after-resume");
  } finally {
    await browser.close();
  }
}

async function flowFreeAgentSmoke() {
  console.log("\nFLOW 3: free-agent signed → playable club season");
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
  });
  const page = await browser.newPage();
  try {
    await loadFixture(page, "?fixture=free-agent-signed");
    let d = await debug(page);
    assert(d?.playingClubId || d?.clubId, "signed free-agent fixture has a club", d);
    await shot(page, "07-free-agent-signed");
    // Drive one season so undated acceptance still yields destination club football.
    if (!d.simDisabled) {
      await page.click("#simulate-btn").catch(() => {});
      await skipScenesAndFinishSeason(page);
      d = await debug(page);
    }
    assert(d?.playingClubId || d?.clubId, "still registered after season", d);
    const apps = d.lastSeasonClubApps ?? d.clubAppearances ?? null;
    console.log("  OK free-agent signed season", {
      playing: d.playingClubId || d.clubId,
      seasons: d.seasonsCount,
      clubApps: apps,
      openStint: d.openPlayingStintClubId,
    });
    await shot(page, "08-free-agent-after-season");
  } finally {
    await browser.close();
  }
}

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  const runAll = FLOW === "all";
  try {
    if (runAll || FLOW === "1") await flowLoan();
    if (runAll || FLOW === "2") await flowTransfer();
    if (runAll || FLOW === "3") await flowFreeAgentSmoke();
    console.log("\nOwnership browser checklist passed.");
  } catch (e) {
    console.error("\nOwnership browser checklist FAILED:", e.message, e.data || "");
    process.exitCode = 1;
  }
}

main();
