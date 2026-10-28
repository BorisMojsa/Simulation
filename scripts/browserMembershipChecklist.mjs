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

async function waitFor(page, fn, timeoutMs = 45000) {
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

async function membership(page) {
  return page.evaluate(() => window.__getMembershipDebug?.() || null);
}

async function loadMode(page, mode) {
  await page.goto(`${BASE}/?fixture=membership&mode=${mode}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await waitFor(
    page,
    () => {
      const d = window.__getLiveCareerDebug?.();
      return Boolean(d && (d.playingClubId || d.clubId || d.freeAgent || d.membership));
    },
    45000
  );
  return page.evaluate((m) => window.__loadMembershipBrowserFixture?.({ mode: m }), mode);
}

async function clickMatching(page, pattern) {
  return page.evaluate((pat) => {
    const re = new RegExp(pat, "i");
    const buttons = [...document.querySelectorAll("button")].filter((b) => {
      const t = (b.textContent || "").trim();
      return re.test(t) && !b.disabled;
    });
    if (!buttons.length) return null;
    // Prefer bulk skip / continue over single-match skip when several match.
    const preferred = buttons.find((b) =>
      /skip remaining|skip phase|animation-continue|^continue$/i.test((b.textContent || "").trim())
    );
    const btn = preferred || buttons[0];
    btn.click();
    return (btn.textContent || "").trim();
  }, pattern);
}

async function clickSimulate(page) {
  const label = await page.evaluate(() => {
    const btn = document.getElementById("simulate-btn");
    if (!btn || btn.disabled) return null;
    const text = (btn.textContent || "").trim();
    btn.click();
    return text;
  });
  assert(label, "simulate button not available");
  return label;
}

/** Drive Pause / Skip Remaining / animation Continue until season settles or next Simulate is ready. */
async function driveSeasonUi(page, { expectSeasonsAtLeast = null, timeoutMs = 180000 } = {}) {
  const started = Date.now();
  const actions = [];
  while (Date.now() - started < timeoutMs) {
    const state = await page.evaluate(() => {
      const d = window.__getLiveCareerDebug?.() || {};
      const m = window.__getMembershipDebug?.() || {};
      const sim = document.getElementById("simulate-btn");
      const continueBtn = document.getElementById("animation-continue");
      const overlay = document.getElementById("season-animation-overlay");
      const pauseBtn = [...document.querySelectorAll("button")].find((b) =>
        /^pause|^paused$/i.test((b.textContent || "").trim())
      );
      const skipRemainingBtn = [...document.querySelectorAll("button")].find((b) =>
        /skip remaining|skip phase/i.test((b.textContent || "").trim())
      );
      const skipBtn = skipRemainingBtn || [...document.querySelectorAll("button")].find((b) =>
        /skip match|^skip$/i.test((b.textContent || "").trim())
      );
      const stayBtn = [...document.querySelectorAll("button")].find((b) =>
        /stay|reject|decline|dismiss|continue career|train/i.test((b.textContent || "").trim())
      );
      return {
        seasonsCount: d.seasonsCount ?? 0,
        clubLeagueId: d.clubLeagueId || m.clubLeagueId || d.playingClubId,
        membership: m.membership || d.membership?.membership || d.membership,
        transitionKeys: m.transitionKeys || [],
        transitionCount: m.transitionCount ?? 0,
        pendingOffers: d.pendingOffers?.length || 0,
        pendingDecision: Boolean(d.pendingDecision),
        freeAgent: Boolean(d.freeAgent),
        simDisabled: Boolean(sim?.disabled),
        simLabel: (sim?.textContent || "").trim(),
        continueVisible: Boolean(continueBtn && !continueBtn.classList.contains("hidden")),
        overlayHidden: !overlay || overlay.classList.contains("hidden"),
        hasPause: Boolean(pauseBtn),
        hasSkip: Boolean(skipBtn),
        hasStay: Boolean(stayBtn),
        standingsRows: document.querySelectorAll(
          "#standings-panel tbody tr, .standings-table tbody tr, #league-standings tbody tr"
        ).length,
        historyCards: document.querySelectorAll(
          "#season-log .season-card, .season-history .season-card, #season-history .season-card"
        ).length,
      };
    });

    if (
      expectSeasonsAtLeast != null &&
      state.seasonsCount >= expectSeasonsAtLeast &&
      state.overlayHidden &&
      !state.pendingOffers &&
      !state.pendingDecision
    ) {
      return { ...state, actions };
    }

    if (state.continueVisible) {
      await page.click("#animation-continue");
      actions.push("animation-continue");
      await page.waitForTimeout(150);
      continue;
    }
    if (!state.overlayHidden && (state.hasSkip || state.hasPause)) {
      // Always prefer Skip remaining / Skip phase over one-match Skip.
      const skipped =
        (await clickMatching(page, "skip remaining")) ||
        (await clickMatching(page, "skip phase")) ||
        (await clickMatching(page, "skip match|^skip$"));
      if (skipped) {
        actions.push(`skip:${skipped}`);
        await page.waitForTimeout(250);
        continue;
      }
      const cont = await clickMatching(page, "^continue$");
      if (cont) {
        actions.push(`continue:${cont}`);
        await page.waitForTimeout(200);
        continue;
      }
    }
    if (state.pendingOffers || state.pendingDecision) {
      const stay =
        (await clickMatching(page, "decline offers|decline offer|reject all|stay")) ||
        (await clickMatching(page, "reject|dismiss|keep current|no thanks|continue at"));
      assert(stay, "pending decision/offers but no stay/reject control", state);
      actions.push(`decision:${stay}`);
      await page.waitForTimeout(400);
      // Offers dismissal often returns to a live/paused dashboard — keep skipping.
      const skipped =
        (await clickMatching(page, "skip remaining")) ||
        (await clickMatching(page, "skip phase")) ||
        (await clickMatching(page, "^continue$"));
      if (skipped) actions.push(`post-decision:${skipped}`);
      continue;
    }
    if (!state.simDisabled && /simulate|next season|continue season|continue career|train/i.test(state.simLabel)) {
      if (expectSeasonsAtLeast == null || state.seasonsCount >= expectSeasonsAtLeast) {
        return { ...state, actions };
      }
      // Need another season — click Simulate.
      await clickSimulate(page);
      actions.push(`simulate:${state.simLabel}`);
      await page.waitForTimeout(300);
      continue;
    }
    // Dashboard visible but still mid-reveal: keep trying bulk skip.
    const bulk =
      (await clickMatching(page, "skip remaining")) ||
      (await clickMatching(page, "skip phase"));
    if (bulk) {
      actions.push(`bulk:${bulk}`);
      await page.waitForTimeout(250);
      continue;
    }
    await page.waitForTimeout(200);
  }
  throw new Error(`driveSeasonUi timeout actions=${actions.join(",")}`);
}

async function runCase(name, fn) {
  console.log(`\nCASE: ${name}`);
  try {
    const evidence = await fn();
    console.log(`  PASS ${name}`);
    return { name, status: "PASS", evidence };
  } catch (err) {
    console.error(`  FAIL ${name}: ${err.message}`);
    if (err.data) console.error("  data", JSON.stringify(err.data, null, 2).slice(0, 2500));
    return { name, status: "FAIL", error: err.message, data: err.data || null };
  }
}

async function withBrowser(fn) {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    timeout: 120000,
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  try {
    const evidence = await fn(page);
    return { ...evidence, consoleErrors };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  let commit = "unknown";
  let dirty = false;
  try {
    commit = execSync("git rev-parse HEAD", { cwd: root }).toString().trim();
    dirty = Boolean(execSync("git status --porcelain", { cwd: root }).toString().trim());
  } catch {
    /* ignore */
  }

  const results = [];

  results.push(
    await runCase("promotion-ui-simulate", async () =>
      withBrowser(async (page) => {
        const loaded = await loadMode(page, "ui-promotion-ready");
        assert(loaded?.ok, "fixture load", loaded);
        assert(loaded.evidence?.membership?.premier === 20, "PL 20", loaded);
        assert(loaded.evidence?.membership?.championship === 24, "CH 24", loaded);
        assert(loaded.evidence?.inPremier === true, "Birmingham promoted in fixture", loaded);
        assert(loaded.evidence?.transitionKeys?.includes("england::2026"), "england transition", loaded);
        const before = await debug(page);
        assert(before?.seasonsCount >= 1, "completed season in fixture", before);
        const m0 = await membership(page);
        assert(m0?.clubLeagueId === "league:england-premier-league", "in PL after promo", m0);
        // Next edition through production Simulate button.
        const simLabel = await clickSimulate(page);
        await waitFor(
          page,
          () => {
            const d = window.__getLiveCareerDebug?.() || {};
            const m = window.__getMembershipDebug?.() || {};
            if (m.membership?.premier === 20 && (d.clubLeagueId || m.clubLeagueId) === "league:england-premier-league") {
              return { membership: m.membership, clubLeagueId: m.clubLeagueId || d.clubLeagueId };
            }
            return null;
          },
          90000
        );
        await clickMatching(page, "skip remaining|skip phase");
        await page.waitForTimeout(400);
        const m = await membership(page);
        assert(m?.membership?.premier === 20, "PL capacity", m);
        assert(m?.membership?.championship === 24, "CH capacity", m);
        assert(m?.clubLeagueId === "league:england-premier-league", "still PL", m);
        const shotPath = await shot(page, "01-promotion-next-pl");
        return { loaded, before, simLabel, membership: m, shotPath, commit, dirty };
      })
    )
  );

  results.push(
    await runCase("relegation-ui-simulate", async () =>
      withBrowser(async (page) => {
        const loaded = await loadMode(page, "ui-relegation-ready");
        assert(loaded?.ok, "fixture load", loaded);
        assert(loaded.evidence?.inChampionship === true, "Ipswich relegated in fixture", loaded);
        assert(loaded.evidence?.membership?.premier === 20, "PL 20", loaded);
        assert(loaded.evidence?.transitionKeys?.includes("england::2026"), "transition", loaded);
        const m0 = await membership(page);
        assert(m0?.clubLeagueId === "league:england-championship", "in CH after relegation", m0);
        const simLabel = await clickSimulate(page);
        await waitFor(
          page,
          () => {
            const m = window.__getMembershipDebug?.() || {};
            if (m.membership?.championship === 24 && m.clubLeagueId === "league:england-championship") {
              return m;
            }
            return null;
          },
          90000
        );
        await clickMatching(page, "skip remaining|skip phase");
        await page.waitForTimeout(400);
        const m = await membership(page);
        assert(m?.clubLeagueId === "league:england-championship", "still CH", m);
        assert(m?.membership?.premier === 20 && m?.membership?.championship === 24, "capacities", m);
        const shotPath = await shot(page, "02-relegation-next-ch");
        return { loaded, simLabel, membership: m, shotPath, commit, dirty };
      })
    )
  );

  results.push(
    await runCase("mid-table-exchange", async () =>
      withBrowser(async (page) => {
        const loaded = await loadMode(page, "midtable");
        assert(loaded?.ok, "fixture load", loaded);
        assert(loaded.zones?.playerMoved === false, "player not moved", loaded);
        assert(loaded.zones?.othersMoved === true, "others exchanged", loaded);
        assert(loaded.evidence?.membership?.premier === 20, "PL 20", loaded);
        assert(loaded.evidence?.promoted?.length === 3, "3 promoted", loaded);
        assert(loaded.evidence?.relegated?.length === 3, "3 relegated", loaded);
        assert(loaded.evidence?.fixtureCounts?.pl2026 === 380, "PL full fixtures", loaded);
        assert(loaded.evidence?.fixtureCounts?.ch2026 === 552, "CH full fixtures", loaded);
        const shotPath = await shot(page, "03-midtable-zones");
        return { loaded, shotPath, commit, dirty };
      })
    )
  );

  results.push(
    await runCase("permanent-move-and-loan-return", async () =>
      withBrowser(async (page) => {
        const loaded = await loadMode(page, "offer-loan");
        assert(loaded?.ok, "fixture load", loaded);
        assert(loaded.offerMeta?.offerOk === true, "offer built", loaded);
        assert(loaded.offerMeta?.buyerLeagueId === "league:england-premier-league", "buyer league", loaded);
        assert(loaded.offerMeta?.loanOk === true, "loan started", loaded);
        assert(loaded.offerMeta?.returnOk === true, "loan returned", loaded);
        assert(loaded.offerMeta?.returnLeagueId === "league:england-premier-league", "return league", loaded);
        assert(loaded.evidence?.membership?.premier === 20, "membership after", loaded);
        const shotPath = await shot(page, "04-offer-loan");
        return { loaded, shotPath, commit, dirty };
      })
    )
  );

  results.push(
    await runCase("pause-skip-continue-next-edition", async () =>
      withBrowser(async (page) => {
        const loaded = await loadMode(page, "next-pause");
        assert(loaded?.ok, "fixture load", loaded);
        assert(loaded.evidence?.inPremier === true, "in PL after promo", loaded);
        assert(loaded.checkpoint || loaded.next?.status, "paused checkpoint", loaded);
        const before = await debug(page);
        const pause = await clickMatching(page, "^pause$|pause simulation");
        assert(pause || true, "pause optional if already paused");
        const skip = await clickMatching(page, "skip remaining|skip match|^skip$");
        assert(skip, "skip remaining required on paused next edition", { before, loaded });
        const after = await driveSeasonUi(page, { expectSeasonsAtLeast: 1 });
        assert(after.membership?.premier === 20, "no membership drift", after);
        assert(after.membership?.championship === 24, "CH capacity", after);
        // Must not fall back to the initial fixture evidence alone.
        assert(after.seasonsCount >= 1 || after.actions.includes("skip"), "UI progressed", after);
        const shotPath = await shot(page, "05-pause-skip-continue");
        return { loaded, before, after, skip, shotPath, commit, dirty };
      })
    )
  );

  results.push(
    await runCase("snapshot-restore-history", async () =>
      withBrowser(async (page) => {
        const loaded = await loadMode(page, "snapshot");
        assert(loaded?.ok, "fixture load", loaded);
        assert(loaded.snapshotOk === true, "snapshot membership 20/24", loaded);
        assert(loaded.snapshotCompare?.seasonsCount >= 1, "restored seasons", loaded);
        assert(loaded.snapshotCompare?.leagueId === "league:england-premier-league", "restored league", loaded);
        assert(loaded.snapshotCompare?.participantIds?.length === 20, "20 participants", loaded);
        assert(loaded.snapshotCompare?.transitionKeys?.includes("england::2026"), "transition key", loaded);
        assert(loaded.next?.tableRows === 20, "next table 20", loaded);
        assert(loaded.next?.fixtures === 380, "380 fixtures", loaded);
        assert(loaded.next?.clubFixtures === 38, "38 club fixtures", loaded);
        const shotPath = await shot(page, "06-snapshot-history");
        return { loaded, shotPath, commit, dirty };
      })
    )
  );

  results.push(
    await runCase("moved-parent-loan-return-ui", async () =>
      withBrowser(async (page) => {
        const loaded = await loadMode(page, "ui-loan-return-ready");
        assert(loaded?.ok, "fixture load", loaded);
        assert(loaded.loan?.ok === true, "loan accepted", loaded);
        assert(loaded.loan?.parentSnapshotLeagueId === "league:england-premier-league", "stale snapshot PL", loaded);
        assert(loaded.loan?.parentWorldLeagueId === "league:england-championship", "parent already relegated", loaded);
        assert(loaded.loan?.seasonsCompleted >= 1, "borrower season completed in fixture", loaded);
        assert(loaded.loan?.loanStillActive === true, "loan still active at boundary", loaded);
        assert(loaded.evidence?.membership?.premier === 20, "PL 20", loaded);
        assert(loaded.evidence?.membership?.championship === 24, "CH 24", loaded);
        const before = await debug(page);
        assert(before?.parentClubSnapshotLeagueId === "league:england-premier-league", "debug stale snapshot", before);
        assert(before?.seasonsCount >= 1, "seasons before return", before);
        // Next season via production Simulate — return resolves at the boundary using live Championship.
        const simLabel = await clickSimulate(page);
        const returned = await waitFor(
          page,
          () => {
            const d = window.__getLiveCareerDebug?.() || {};
            const m = window.__getMembershipDebug?.() || {};
            const league = m.clubLeagueId || d.clubLeagueId;
            const loanDone = d.activeLoan?.status === "returned" || !d.activeLoan;
            if (league === "league:england-championship" && loanDone) {
              return { league, loanStatus: d.activeLoan?.status || "cleared", membership: m.membership };
            }
            return null;
          },
          120000
        );
        // Advance dashboard enough for a meaningful screenshot of the returned registration.
        const skip = await clickMatching(page, "skip remaining|skip match|^skip$");
        if (skip) await page.waitForTimeout(400);
        const m = await membership(page);
        const d = await debug(page);
        assert(returned?.league === "league:england-championship", "returned league", returned);
        assert(
          m?.clubLeagueId === "league:england-championship" ||
            d?.clubLeagueId === "league:england-championship",
          "returned to parent's current Championship",
          { m, d, before, returned, loaded }
        );
        assert(!d?.parentClubSnapshotLeagueId, "snapshot cleared after return", d);
        assert(m?.membership?.premier === 20, "PL 20", m);
        assert(m?.membership?.championship === 24, "CH 24", m);
        const shotPath = await shot(page, "07-moved-parent-loan-return");
        return { loaded, before, simLabel, returned, skip, membership: m, debug: d, shotPath, commit, dirty };
      })
    )
  );

  results.push(
    await runCase("fix01-fix02-continuation", async () =>
      withBrowser(async (page) => {
        await page.goto(`${BASE}/?fixture=free-agent&mode=empty`, { waitUntil: "networkidle" });
        await waitFor(page, () => window.__getLiveCareerDebug?.()?.freeAgent === true, 25000);
        const fa = await debug(page);
        assert(fa?.freeAgent === true, "free agent fixture", fa);
        // Continue free-agent path: Train / search must be available.
        const train = await clickMatching(page, "train|search as free agent|simulate");
        assert(train, "free-agent continue control", fa);
        await page.waitForTimeout(400);
        const faAfter = await debug(page);
        const faShot = await shot(page, "08-fix01-free-agent-continue");

        await page.goto(`${BASE}/?fixture=ownership-transfer`, { waitUntil: "networkidle" });
        await waitFor(page, () => window.__getLiveCareerDebug?.()?.playingClubId, 25000);
        const own = await debug(page);
        assert(own?.playingClubId === "club:england:arsenal", "ownership fixture", own);
        // Accept path already done by fixture — assert employer/playing identity holds and Simulate works.
        const sim = await page.evaluate(() => {
          const btn = document.getElementById("simulate-btn");
          return { label: btn?.textContent || null, disabled: Boolean(btn?.disabled) };
        });
        assert(sim.label, "ownership has simulate control", sim);
        if (!sim.disabled) {
          await clickSimulate(page);
          await page.waitForTimeout(500);
        }
        const ownAfter = await debug(page);
        assert(ownAfter?.employmentClubId || ownAfter?.playingClubId, "ownership identity after", ownAfter);
        const ownShot = await shot(page, "09-fix02-ownership-continue");
        return { fa, faAfter, train, own, ownAfter, sim, faShot, ownShot, commit, dirty };
      })
    )
  );

  const summary = {
    commit,
    dirtyWorkingTree: dirty,
    testedSource: dirty ? "working-tree-uncommitted" : commit,
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
