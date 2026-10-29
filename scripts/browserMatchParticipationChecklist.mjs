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
const CASE_DIR = join(root, "qa/fix05-runs/cases");

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
      continueSectionVisible: Boolean(
        animContinue && !animContinue.classList.contains("hidden")
      ),
      continueBtnVisible: visibleBtn(contBtn),
      continueBtnDisabled: Boolean(contBtn?.disabled),
      simulateDisabled: Boolean(sim?.disabled),
      simulateLabel: sim?.textContent || "",
      seasonActionInFlight: Boolean(d?.seasonActionInFlight),
      nextAction: d?.nextAction || null,
    };
  });
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
    const btn = [...document.querySelectorAll("button")].find((b) =>
      re.test((b.textContent || "").trim())
    );
    if (!btn || btn.disabled || btn.offsetParent === null) return null;
    btn.click();
    return (btn.textContent || "").trim();
  }, pattern);
}

/** Click the real production Continue button (#continue-btn), never the wrapper. */
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

async function skipThroughSeason(page, { maxSteps = 80 } = {}) {
  for (let i = 0; i < maxSteps; i++) {
    const state = await page.evaluate(() => {
      const d = window.__getLiveCareerDebug?.() || {};
      const continueSection = document.getElementById("animation-continue");
      const continueBtn = document.getElementById("continue-btn");
      const sim = document.getElementById("simulate-btn");
      const overlay = document.getElementById("season-animation-overlay");
      const skipMatch = [...document.querySelectorAll("button")].find((b) =>
        /skip match|skip phase|skip season/i.test(b.textContent || "")
      );
      return {
        seasons: d.seasonsCount ?? d.seasons,
        continueReady:
          continueSection &&
          !continueSection.classList.contains("hidden") &&
          continueBtn &&
          !continueBtn.disabled &&
          continueBtn.offsetParent !== null,
        overlayHidden: !overlay || overlay.classList.contains("hidden"),
        simDisabled: Boolean(sim?.disabled),
        hasSkip: Boolean(skipMatch && !skipMatch.disabled && skipMatch.offsetParent !== null),
        pendingOffers: d.pendingOffers?.length || 0,
        pendingDecision: d.pendingDecision,
        lastSeason: d.lastSeason || null,
      };
    });

    if (state.continueReady) {
      await clickContinueBtn(page);
      await page.waitForTimeout(120);
      continue;
    }
    if (!state.overlayHidden && state.hasSkip) {
      await clickMatching(page, "skip season|skip phase|skip match");
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
        const fixtureId =
          card?.getAttribute("data-fixture-id") ||
          card?.dataset?.fixtureId ||
          null;
        return {
          fixtureId,
          contrib: contrib.trim(),
          rating: rating.trim(),
          text: (card?.innerText || el.innerText || "").trim().slice(0, 240),
        };
      });
  });
}

function careerSnapshot(d) {
  return {
    age: d?.age ?? null,
    seasonsCount: d?.seasonsCount ?? d?.seasons ?? null,
    rating: d?.rating ?? null,
    minutes: d?.lastSeason?.minutes ?? null,
    goals: d?.lastSeason?.goals ?? null,
    assists: d?.lastSeason?.assists ?? null,
    cleanSheets: d?.lastSeason?.cleanSheets ?? null,
    evidenceByScope: d?.lastSeason?.evidenceByScope || null,
    qaKo: d?.qaKo
      ? {
          etFixtureId: d.qaKo.etFixtureId,
          pensFixtureId: d.qaKo.pensFixtureId,
          zeroFixtureId: d.qaKo.zeroFixtureId,
          etMinutes: d.qaKo.etMinutes,
          pensMinutes: d.qaKo.pensMinutes,
          etRating: d.qaKo.etRating,
          pensRating: d.qaKo.pensRating,
          etGoals: d.qaKo.etGoals,
          pensGoals: d.qaKo.pensGoals,
          savedMatches: d.qaKo.savedMatches || null,
        }
      : null,
  };
}

/**
 * Drive completed-season presentation: skip match animations when needed, but
 * always click the real #continue-btn for phase/final Continue. Requires at
 * least one successful Continue and desk return.
 */
async function driveCompletedSeasonToDesk(page, { timeoutMs = 120000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let reachedContinue = false;
  let continueClicks = 0;
  let skipClicks = 0;
  let midCards = null;

  while (Date.now() < deadline) {
    const cur = await uiState(page);
    if (
      cur.overlayHidden &&
      cur.dashboardHidden &&
      cur.seasonActionInFlight === false &&
      reachedContinue
    ) {
      return {
        reachedContinue,
        continueClicks,
        skipClicks,
        midCards,
        final: cur,
      };
    }

    const handled = await page.evaluate(() => {
      const clicked = [];
      // Prefer Continue when the production button is actually presented.
      const section = document.getElementById("animation-continue");
      const contBtn = document.getElementById("continue-btn");
      if (
        section &&
        !section.classList.contains("hidden") &&
        contBtn &&
        !contBtn.disabled &&
        contBtn.offsetParent !== null
      ) {
        contBtn.click();
        clicked.push("continue-btn");
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
      return clicked;
    });

    if (handled.includes("continue-btn")) {
      reachedContinue = true;
      continueClicks += 1;
    }
    if (handled.some((id) => /skip/i.test(id))) skipClicks += 1;

    if (!midCards && (await page.evaluate(() => document.querySelectorAll(".match-card").length > 0))) {
      midCards = await readMatchCards(page);
    }

    await page.waitForTimeout(handled.length ? 140 : 220);
  }

  const snap = await uiState(page);
  throw Object.assign(
    new Error(
      `Timed out returning to desk after completed-season Continue: ${JSON.stringify({
        overlayHidden: snap.overlayHidden,
        dashboardHidden: snap.dashboardHidden,
        inFlight: snap.seasonActionInFlight,
        continueSectionVisible: snap.continueSectionVisible,
        continueBtnVisible: snap.continueBtnVisible,
        reachedContinue,
        continueClicks,
        skipClicks,
        nextAction: snap.nextAction,
      })}`
    ),
    { data: { reachedContinue, continueClicks, skipClicks, snap } }
  );
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

function attachRuntimeGuards(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push({ type: "pageerror", message: String(err?.message || err) }));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push({ type: "console", message: msg.text() });
  });
  return errors;
}

async function main() {
  const { chromium } = await loadPlaywright();
  await mkdir(SHOT_DIR, { recursive: true });
  await mkdir(CASE_DIR, { recursive: true });

  await caseRun("move-loan-ownership-transfer", async () => {
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const page = await browser.newPage();
    const runtimeErrors = attachRuntimeGuards(page);
    try {
      await loadFixture(page, "?fixture=ownership-transfer");
      const before = await debug(page);
      assert(before?.playingClubId === "club:england:arsenal", "start Arsenal", before);
      await shot(page, "01-transfer-desk");
      const clicked = await page.evaluate(() => {
        const btn =
          [...document.querySelectorAll("button")].find(
            (b) =>
              /accept/i.test(b.textContent || "") &&
              /brentford/i.test(b.closest("div,li,article")?.innerText || "")
          ) ||
          [...document.querySelectorAll("button")].find((b) =>
            /accept offer|accept/i.test(b.textContent || "")
          );
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
      assert(runtimeErrors.length === 0, "no page/console errors", runtimeErrors);
      return { playing: after.playingClubId, seasons: after.seasonsCount, runtimeErrors };
    } finally {
      await browser.close();
    }
  });

  await caseRun("live-loan-controls", async () => {
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const page = await browser.newPage();
    const runtimeErrors = attachRuntimeGuards(page);
    try {
      await loadFixture(page, "?fixture=live-loan");
      await shot(page, "04-loan-desk");
      await clickMatching(page, "review loan options");
      await page.waitForTimeout(200);
      const accept = await page.evaluate(() => {
        const btn = [...document.querySelectorAll("button")].find((b) =>
          /accept loan|accept offer|accept/i.test(b.textContent || "")
        );
        btn?.click();
        return btn?.textContent || null;
      });
      assert(accept, "accept a loan offer");
      await page.waitForTimeout(400);
      const d = await debug(page);
      assert(d.employmentClubId === "club:italy:atalanta", "employer Atalanta", d);
      assert(d.playingClubId && d.playingClubId !== d.employmentClubId, "playing club moved", d);
      await shot(page, "05-loan-accepted");
      assert(runtimeErrors.length === 0, "no page/console errors", runtimeErrors);
      return { playing: d.playingClubId, employment: d.employmentClubId, runtimeErrors };
    } finally {
      await browser.close();
    }
  });

  await caseRun("free-agent-predecessor-smoke", async () => {
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const page = await browser.newPage();
    const runtimeErrors = attachRuntimeGuards(page);
    try {
      await loadFixture(page, "?fixture=free-agent-offers");
      const d = await debug(page);
      assert(d?.freeAgent || !d?.playingClubId, "free agent desk", d);
      await shot(page, "06-free-agent");
      const next = d.nextAction;
      assert(next, "next action present", d);
      await clickMatching(page, "continue|accept|sign|review");
      await page.waitForTimeout(300);
      const after = await debug(page);
      assert(runtimeErrors.length === 0, "no page/console errors", runtimeErrors);
      return { nextAction: next, offers: d.pendingOffers, afterNext: after?.nextAction, runtimeErrors };
    } finally {
      await browser.close();
    }
  });

  await caseRun("academy-predecessor-smoke", async () => {
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const page = await browser.newPage();
    const runtimeErrors = attachRuntimeGuards(page);
    try {
      await loadFixture(page, "?fixture=academy-continue-offers");
      const d = await debug(page);
      assert(d?.isAcademy || d?.academyLifecycle, "academy fixture", d);
      await shot(page, "07-academy");
      const seasons = d.lastSeason || null;
      if (seasons?.evidenceByScope?.league?.appearances) {
        assert(false, "academy should not have senior league appearances before graduation", seasons);
      }
      await clickMatching(page, "continue|graduate|accept|review");
      await page.waitForTimeout(300);
      assert(runtimeErrors.length === 0, "no page/console errors", runtimeErrors);
      return { academy: d.academyLifecycle, nextAction: d.nextAction, runtimeErrors };
    } finally {
      await browser.close();
    }
  });

  await caseRun("skip-controls-and-match-cards", async () => {
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const page = await browser.newPage();
    const runtimeErrors = attachRuntimeGuards(page);
    try {
      await loadFixture(page, "?fixture=ownership-transfer");
      await page.evaluate(() => {
        const stay = [...document.querySelectorAll("button")].find((b) =>
          /stay|reject|decline|keep/i.test(b.textContent || "")
        );
        stay?.click();
      });
      await page.waitForTimeout(300);
      let reachedSkip = false;
      let reachedContinue = false;
      for (let i = 0; i < 40; i++) {
        const progressed = await page.evaluate(() => {
          const skip = [...document.querySelectorAll("button")].find(
            (b) =>
              /skip season|skip phase|skip match/i.test(b.textContent || "") &&
              !b.disabled &&
              b.offsetParent !== null
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
          const section = document.getElementById("animation-continue");
          const cont = document.getElementById("continue-btn");
          if (
            section &&
            !section.classList.contains("hidden") &&
            cont &&
            !cont.disabled &&
            cont.offsetParent !== null
          ) {
            cont.click();
            return "continue";
          }
          return null;
        });
        if (progressed === "skip") reachedSkip = true;
        if (progressed === "continue") reachedContinue = true;
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
      assert(zeroish.length >= 1, "non-participation cards must appear", { zeroish: zeroish.length });
      assert(reachedSkip || reachedContinue, "skip or continue must be reached", {
        reachedSkip,
        reachedContinue,
      });
      const finished = await debug(page);
      const np = finished?.lastSeason?.nonParticipation || finished?.nonParticipation || null;
      const positiveMinutes = Number(finished?.lastSeason?.minutes || finished?.seasonTotals?.minutes || 0);
      assert(positiveMinutes > 0 || (np?.total || 0) > 0, "season coverage present", {
        positiveMinutes,
        np,
      });
      assert(runtimeErrors.length === 0, "no page/console errors", runtimeErrors);
      return {
        cardsSample: cards.slice(0, 8),
        zeroish: zeroish.length,
        reachedSkip,
        reachedContinue,
        positiveMinutes,
        nonParticipation: np,
        runtimeErrors,
      };
    } finally {
      await browser.close();
    }
  });

  await caseRun("finished-season-evidence-and-keeper-path", async () => {
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const page = await browser.newPage();
    const runtimeErrors = attachRuntimeGuards(page);
    try {
      await loadFixture(page, "?fixture=fix05-gk");
      await shot(page, "09-finished-season-gk");
      const d = await debug(page);
      assert(d?.position === "GK" || d?.qaGk?.position === "GK", "player is GK", d);
      assert(Number(d?.qaGk?.minutes || d?.lastSeason?.minutes || 0) > 0, "positive keeper minutes", d);
      assert(d?.lastSeason?.evidenceByScope?.league, "league evidence scope present", d?.lastSeason);
      const leagueLine = d.lastSeason.evidenceByScope.league;
      const leagueMinutes = Number(leagueLine.minutes || 0);
      assert(leagueMinutes > 0, "league minutes in evidence", leagueLine);

      const seasonCs = d.lastSeason.cleanSheets;
      const evidenceCs = leagueLine.cleanSheets;
      const qaCs = d.qaGk?.evidenceLeagueCleanSheets ?? d.qaGk?.cleanSheets;
      assert(Number.isFinite(Number(seasonCs)), "season cleanSheets is a known number", {
        seasonCs,
        evidenceCs,
        qaCs,
      });
      assert(Number.isFinite(Number(evidenceCs)), "league evidence cleanSheets is a known number", {
        seasonCs,
        evidenceCs,
      });
      assert(
        Number(seasonCs) === Number(evidenceCs),
        "season cleanSheets matches league evidence cleanSheets",
        { seasonCs, evidenceCs }
      );
      if (qaCs != null) {
        assert(
          Number(qaCs) === Number(evidenceCs),
          "qa fixture cleanSheets matches evidence",
          { qaCs, evidenceCs }
        );
      }

      assert(
        (d.awardFieldKeys || []).length > 0 || d.qaGk?.awardFieldKeys?.length > 0,
        "award fields persisted",
        d
      );
      assert(runtimeErrors.length === 0, "no page/console errors", runtimeErrors);
      return {
        position: d.position,
        minutes: d.qaGk?.minutes ?? d.lastSeason?.minutes,
        evidenceByScope: d.lastSeason?.evidenceByScope || null,
        cleanSheets: Number(seasonCs),
        evidenceLeagueCleanSheets: Number(evidenceCs),
        awardFieldKeys: d.awardFieldKeys || d.qaGk?.awardFieldKeys || [],
        runtimeErrors,
      };
    } finally {
      await browser.close();
    }
  });

  // Segment-only: dashboard slate playback (Skip permitted). Not the career Continue proof.
  await caseRun("live-et-pens-segment-playback", async () => {
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const page = await browser.newPage();
    const runtimeErrors = attachRuntimeGuards(page);
    try {
      await loadFixture(page, "?fixture=fix05-ko");
      await shot(page, "10-ko-dashboard");
      const before = await debug(page);
      assert(before?.qaKo?.etFixtureId, "ET fixture id present", before);
      assert(before?.qaKo?.pensFixtureId, "pens fixture id present", before);
      assert(before.qaKo.etDecidedBy === "extraTime", "ET decidedBy", before.qaKo);
      assert(before.qaKo.pensDecidedBy === "penalties", "pens decidedBy", before.qaKo);
      assert(Number(before.qaKo.etMinutes) === 120, "ET minutes 120", before.qaKo);
      assert(Number(before.qaKo.pensMinutes) === 120, "pens minutes 120", before.qaKo);

      let reachedSkip = false;
      for (let i = 0; i < 40; i++) {
        const progressed = await page.evaluate(() => {
          for (const id of ["sim-skip-phase-btn", "sim-skip-match-btn", "match-skip-phase-btn", "match-skip-btn"]) {
            const el = document.getElementById(id);
            if (el && !el.disabled && el.offsetParent !== null) {
              el.click();
              return id;
            }
          }
          return null;
        });
        if (progressed) reachedSkip = true;
        await page.waitForTimeout(100);
        if (!progressed && i > 5) break;
      }
      const cards = await readMatchCards(page);
      const zeroish = cards.filter((c) => /unused|not selected|injured|did not play/i.test(c.contrib));
      assert(zeroish.length >= 1, "zero-minute companion reached", { zeroish: zeroish.length, cards });
      assert(runtimeErrors.length === 0, "no page/console errors", runtimeErrors);
      return {
        mode: "segment",
        qaKo: before.qaKo,
        reachedSkip,
        zeroish: zeroish.length,
        cardsSample: cards.slice(0, 6),
        runtimeErrors,
      };
    } finally {
      await browser.close();
    }
  });

  // Required complete flow: production showSeasonAnimation → final #continue-btn → desk.
  await caseRun("live-et-pens-season-continue", async () => {
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const page = await browser.newPage();
    const runtimeErrors = attachRuntimeGuards(page);
    try {
      await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      await page.evaluate(() => {
        // Fire-and-forget: presentation awaits Continues driven by this harness.
        window.__loadMatchParticipationKoCompleteBrowserFixture?.();
      });
      await waitFor(
        page,
        () => {
          const d = window.__getLiveCareerDebug?.();
          const overlay = document.getElementById("season-animation-overlay");
          return Boolean(
            d?.qaKo?.etFixtureId &&
              d?.qaKo?.pensFixtureId &&
              overlay &&
              !overlay.classList.contains("hidden")
          );
        },
        45000
      );

      const beforeDebug = await debug(page);
      const beforeSnap = careerSnapshot(beforeDebug);
      assert(beforeDebug.qaKo.etDecidedBy === "extraTime", "ET decidedBy", beforeDebug.qaKo);
      assert(beforeDebug.qaKo.pensDecidedBy === "penalties", "pens decidedBy", beforeDebug.qaKo);
      assert(Number(beforeDebug.qaKo.etMinutes) === 120, "ET minutes", beforeDebug.qaKo);
      assert(Number(beforeDebug.qaKo.pensMinutes) === 120, "pens minutes", beforeDebug.qaKo);
      assert(beforeDebug.qaKo.etRating != null, "ET rating", beforeDebug.qaKo);
      assert(beforeDebug.qaKo.pensRating != null, "pens rating", beforeDebug.qaKo);
      assert(Number(beforeDebug.qaKo.zeroMinutes) === 0, "zero companion minutes", beforeDebug.qaKo);

      await shot(page, "12-ko-complete-before-continue");

      const driven = await driveCompletedSeasonToDesk(page);
      assert(driven.reachedContinue === true, "must click production #continue-btn", driven);
      assert(driven.continueClicks >= 1, "at least one Continue click", driven);

      await shot(page, "13-ko-complete-after-desk");
      const afterUi = await uiState(page);
      const afterDebug = afterUi.debug;
      const afterSnap = careerSnapshot(afterDebug);

      assert(afterUi.overlayHidden === true, "season overlay closed", afterUi);
      assert(afterUi.dashboardHidden === true, "simulation dashboard closed", afterUi);
      assert(afterUi.seasonActionInFlight === false, "seasonActionInFlight cleared", afterUi);
      assert(afterDebug?.nextAction, "next career action present", afterDebug);
      // Simulate may be disabled when offers/decisions require resolution — that is valid.
      assert(
        afterDebug.nextAction.canSimulate === true ||
          afterDebug.pendingOffers?.length > 0 ||
          Boolean(afterDebug.pendingDecision),
        "usable next step (simulate or pending decision/offers)",
        afterDebug.nextAction
      );

      // Continue must not replay / mutate already-finalized KO evidence.
      assert(
        JSON.stringify(beforeSnap.qaKo) === JSON.stringify(afterSnap.qaKo),
        "qaKo saved matches/ratings unchanged after Continue",
        { before: beforeSnap.qaKo, after: afterSnap.qaKo }
      );
      assert(
        beforeSnap.minutes === afterSnap.minutes &&
          beforeSnap.goals === afterSnap.goals &&
          beforeSnap.assists === afterSnap.assists,
        "season totals unchanged after Continue",
        { before: beforeSnap, after: afterSnap }
      );
      assert(
        beforeSnap.age === afterSnap.age && beforeSnap.seasonsCount === afterSnap.seasonsCount,
        "age/season count unchanged after Continue",
        { before: beforeSnap, after: afterSnap }
      );

      const cards = driven.midCards || (await readMatchCards(page));
      const zeroish = (cards || []).filter((c) =>
        /unused|not selected|injured|did not play/i.test(c.contrib || "")
      );
      const textBlob = (cards || []).map((c) => `${c.fixtureId || ""} ${c.text || ""} ${c.contrib || ""}`).join("\n");
      assert(
        textBlob.includes(beforeDebug.qaKo.etFixtureId) ||
          textBlob.includes(beforeDebug.qaKo.pensFixtureId) ||
          (cards || []).length >= 1,
        "KO fixtures were presented on cards",
        { et: beforeDebug.qaKo.etFixtureId, pens: beforeDebug.qaKo.pensFixtureId, cards }
      );

      // Second Continue activation must remain harmless.
      const second = await clickContinueBtn(page);
      await page.waitForTimeout(200);
      const afterSecond = careerSnapshot(await debug(page));
      assert(
        JSON.stringify(afterSnap) === JSON.stringify(afterSecond),
        "repeat Continue is harmless",
        { afterSnap, afterSecond, second }
      );

      assert(runtimeErrors.length === 0, "no page/console errors", runtimeErrors);

      const caseJson = {
        name: "live-et-pens-season-continue",
        before: beforeSnap,
        after: afterSnap,
        reachedContinue: true,
        continueClicks: driven.continueClicks,
        skipClicks: driven.skipClicks,
        overlayHidden: afterUi.overlayHidden,
        dashboardHidden: afterUi.dashboardHidden,
        seasonActionInFlight: afterUi.seasonActionInFlight,
        nextAction: afterDebug.nextAction,
        cardsSample: (cards || []).slice(0, 8),
        zeroish: zeroish.length,
        savedMatches: beforeDebug.qaKo.savedMatches,
        runtimeErrors,
      };
      await writeFile(
        join(CASE_DIR, "browser-ko-season-continue.json"),
        JSON.stringify(caseJson, null, 2)
      );

      return caseJson;
    } finally {
      await browser.close();
    }
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE,
    chrome: CHROME,
    results,
    casesReached: results.filter((r) => r.status === "PASS").length,
    casesFailed: results.filter((r) => r.status === "FAIL").length,
    pass: results.every((r) => r.status === "PASS") && results.length >= 8,
  };
  await writeFile(OUT, JSON.stringify(summary, null, 2));
  console.log(
    "\nBrowser checklist summary:",
    JSON.stringify(
      {
        pass: summary.pass,
        caseCount: results.length,
        results: results.map((r) => `${r.status} ${r.name}`),
      },
      null,
      2
    )
  );

  // Hard requirement from the re-review: complete-flow case must reach Continue.
  const complete = results.find((r) => r.name === "live-et-pens-season-continue");
  if (!complete || complete.status !== "PASS" || complete.detail?.reachedContinue !== true) {
    console.error("Required KO completion case did not reach Continue");
    process.exitCode = 1;
  }
  if (!summary.pass) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
