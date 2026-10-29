#!/usr/bin/env node
/**
 * Browser acceptance for Fix 07: playing-time, contract continuity, FA recovery.
 *
 *   python3 -m http.server 8000 --bind 127.0.0.1
 *   npm install --no-save playwright-core
 *   BASE_URL=http://127.0.0.1:8000 node scripts/browserPlayingTimeContractRecoveryChecklist.mjs
 *
 * Env: BASE_URL, CHROME_PATH, CASES (comma list), HEADED=1
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { LEAGUES, LEAGUE_LOOKUP, LEAGUE_BY_ID } from "../js/data/leagues.js";
import { createPlayerIdentity } from "../js/simulation/playerDevelopment.js";
import { ensurePlayerModel } from "../js/simulation/playerModelMigration.js";
import { refreshAbilityCaches } from "../js/simulation/playerAbility.js";
import { createRng, reseedCareerRng } from "../js/simulation/rng.js";
import { createWorldState, setWorldState, getWorldState } from "../js/simulation/worldState.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import { serializeCareerSnapshot } from "../js/simulation/careerSnapshot.js";
import {
  ensureContractAuthority,
  advanceFreeAgentPeriod,
} from "../js/simulation/contractLifecycle.js";
import { ensureTransferSave } from "../js/simulation/transferMigration.js";
import { allSeniorClubs } from "../js/simulation/seniorClubs.js";
import {
  generatePipelineOffers,
  acceptPipelineOffer,
  closeFreeAgentMarketReview,
} from "../js/simulation/dealPipeline.js";
import { buildLiveLoanBrowserFixture } from "../js/simulation/liveLoanBrowserFixture.js";
import { buildFreeAgentBrowserFixture } from "../js/simulation/freeAgentBrowserFixture.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8000";
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HEADED = process.env.HEADED === "1";
const SHOT_DIR = join(root, "qa/screenshots/checklist-playing-time-contract");
const RUN_DIR = join(root, "qa/fix07-runs");
const OUT = join(RUN_DIR, "browser-report.json");
const CASE_DIR = join(RUN_DIR, "cases");
const FIXTURE_DIR = join(root, "qa/fixtures/fix07");

const REQUIRED = ["B01", "B02", "B03", "B04", "B05", "B06", "B07"];
const SELECTED = process.env.CASES
  ? process.env.CASES.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
  : REQUIRED;

function assert(cond, msg, data) {
  if (!cond) {
    const err = new Error(msg);
    err.data = data;
    throw err;
  }
}
function num(v, label) {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`${label}: expected finite number, got ${JSON.stringify(v)}`);
  }
  return v;
}
const jsonClone = (v) => JSON.parse(JSON.stringify(v));

async function loadPlaywright() {
  return import("playwright-core");
}
async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2));
}

async function waitFor(page, fn, arg, timeoutMs = 30000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await page.evaluate(fn, arg);
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

async function exportSnap(page) {
  const snap = await page.evaluate(() => window.__exportCareerSnapshot?.() || null);
  assert(snap?.player, "export snapshot missing player");
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
      pendingDecision: d?.pendingDecision || null,
      pendingOffers: d?.pendingOffers?.length || 0,
    };
  });
}

async function clickContinueBtn(page) {
  return page.evaluate(() => {
    const section = document.getElementById("animation-continue");
    const btn = document.getElementById("continue-btn");
    if (!section || section.classList.contains("hidden")) return { clicked: false, reason: "section-hidden" };
    if (!btn || btn.disabled) return { clicked: false, reason: "btn-disabled" };
    if (btn.offsetParent === null) return { clicked: false, reason: "btn-not-visible" };
    btn.click();
    return { clicked: true };
  });
}

async function clickMatching(page, pattern) {
  return page.evaluate((pat) => {
    const re = new RegExp(pat, "i");
    const btn = [...document.querySelectorAll("button")].find(
      (b) => re.test((b.textContent || "").trim()) && !b.disabled && b.offsetParent !== null
    );
    if (!btn) return null;
    btn.click();
    return (btn.textContent || "").trim();
  }, pattern);
}

async function restoreSnapshot(page, snap) {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await waitFor(page, () => typeof window.__restoreCareerSnapshot === "function");
  const ok = await page.evaluate((data) => {
    const r = window.__restoreCareerSnapshot?.(data);
    return Boolean(r?.player || window.__getLiveCareerDebug?.()?.name);
  }, snap);
  assert(ok, "restoreCareerSnapshot failed");
  await page.waitForTimeout(200);
}

function attachGuards(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push({ type: "pageerror", message: String(err?.message || err) }));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push({ type: "console", message: msg.text() });
  });
  page.on("pageerror", () => {});
  return errors;
}

async function assertDeskClear(page, label) {
  const st = await uiState(page);
  assert(st.overlayHidden, `${label}: overlay open`);
  assert(st.dashboardHidden, `${label}: dashboard open`);
  assert(st.seasonActionInFlight === false, `${label}: seasonActionInFlight`);
  return st;
}

async function driveToDesk(page, { timeoutMs = 90000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let reachedContinue = false;
  let continueClicks = 0;
  const actions = [];
  while (Date.now() < deadline) {
    const cur = await uiState(page);
    if (cur.overlayHidden && cur.dashboardHidden && !cur.seasonActionInFlight && reachedContinue) {
      return { continueClicks, final: cur, actions };
    }
    // Prefer the real season Continue when the presentation tray owns the UI.
    if (cur.continueBtnVisible && !cur.continueBtnDisabled) {
      const cont = await clickContinueBtn(page);
      if (cont?.clicked) {
        reachedContinue = true;
        continueClicks += 1;
        actions.push({ type: "continue" });
        await page.waitForTimeout(160);
        continue;
      }
    }

    // Senior scenario overlay (ownership-style) — resolve before desk return.
    const scenarioHit = await page.evaluate(() => {
      const overlay = document.getElementById("senior-scenario-overlay");
      if (!overlay || overlay.classList.contains("hidden")) return null;
      const btns = [
        ...document.querySelectorAll("#senior-scenario-overlay button, .scenario-actions button"),
      ];
      const pick =
        btns.find((b) => /balanced|continue|acknowledge|proceed|ok/i.test(b.textContent || "")) ||
        btns.find((b) => !b.disabled && b.offsetParent !== null);
      if (!pick || pick.disabled) return null;
      pick.click();
      return (pick.textContent || "").trim();
    });
    if (scenarioHit) {
      actions.push({ type: "scenario", label: scenarioHit });
      await page.waitForTimeout(200);
      continue;
    }
    // Resolve desk decisions / offers only when the season overlay is not presenting Continue.
    if (
      cur.overlayHidden &&
      (cur.pendingDecision || cur.pendingOffers > 0 || cur.nextAction?.id === "resolve-decision")
    ) {
      const clicked =
        (await clickMatching(page, "Stay and compete")) ||
        (await clickMatching(page, "Acknowledge|acknowledge")) ||
        (await clickMatching(page, "remain|see out|Decline and leave|decline")) ||
        (await clickMatching(page, "accept|sign"));
      if (clicked) {
        actions.push({ type: "decision", label: clicked });
        await page.waitForTimeout(200);
        continue;
      }
    }
    if (cur.nextAction?.id === "resolve-scenario") {
      const clicked =
        (await clickMatching(page, "balanced|continue|acknowledge|proceed")) ||
        (await clickMatching(page, "ok|close"));
      if (clicked) {
        actions.push({ type: "scenario-text", label: clicked });
        await page.waitForTimeout(200);
        continue;
      }
    }
    const handled = await page.evaluate(() => {
      const clicked = [];
      for (const id of ["sim-skip-phase-btn", "match-skip-phase-btn", "sim-skip-match-btn", "match-skip-btn"]) {
        const el = document.getElementById(id);
        if (el && !el.disabled && el.offsetParent !== null) {
          el.click();
          clicked.push(id);
        }
      }
      const skip = [...document.querySelectorAll("button")].find((b) =>
        /skip season|skip phase|skip match/i.test(b.textContent || "")
      );
      if (skip && !skip.disabled && skip.offsetParent !== null) {
        skip.click();
        clicked.push("skip-text");
      }
      return clicked;
    });
    if (handled.length) actions.push({ type: "skip", ids: handled });
    if (!handled.length && cur.overlayHidden && !cur.simulateDisabled) {
      await page.click("#simulate-btn").catch(() => {});
      actions.push({ type: "simulate" });
    }
    await page.waitForTimeout(handled.length ? 140 : 200);
  }
  throw new Error(`driveToDesk timeout: ${JSON.stringify(await uiState(page))}`);
}

function attrs(ovr) {
  return Object.fromEntries(
    ["Speed", "Passing", "Shooting", "Defending", "Physicality", "Dribbling"].map((k) => [k, ovr])
  );
}

function makeRenewalFixture({ age = 36, ovr = 72, end = 1, id = "fix07-b02" } = {}) {
  reseedCareerRng(707);
  resetClubFinanceLedgers();
  setWorldState(createWorldState({ startYear: 2026 }));
  const hull = allSeniorClubs().find((c) => c.name === "Hull City");
  const p = createPlayerIdentity({ name: "Fix07 Renewal", nationality: "England", position: "ST", age });
  Object.assign(p, {
    careerId: id,
    startYear: 2026,
    age,
    rating: ovr,
    attributes: attrs(ovr),
    club: { ...hull },
    employmentClubId: hull.clubId,
    playingClubId: hull.clubId,
    contractStatus: "active",
    contractStartSeason: 0,
    contractYears: end,
    contractEndSeason: end,
    weeklyWage: 1500,
    wage: 1500,
    seasons: [],
  });
  ensurePlayerModel(p);
  refreshAbilityCaches(p);
  ensureContractAuthority(p);
  ensureTransferSave(p);
  const gen = generatePipelineOffers(p, {
    performanceScore: 85,
    forceGenerate: true,
    rng: createRng(707),
  });
  const renewal = gen.offers.find((o) => o.isRenewal);
  assert(renewal, "expected renewal offer for fixture");
  p.pendingOffers = [renewal];
  p.pendingDecision = null;
  return serializeCareerSnapshot({ player: p, world: getWorldState() });
}

function makeFreeAgentFixture(mode = "empty-result") {
  const fixture = buildFreeAgentBrowserFixture({ mode });
  assert(fixture.ok, fixture.reason || "fa fixture");
  return serializeCareerSnapshot({ player: fixture.player, world: getWorldState() });
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
    try {
      /* screenshot best-effort left to caller */
    } catch (_) {}
  }
}

async function main() {
  await mkdir(CASE_DIR, { recursive: true });
  await mkdir(FIXTURE_DIR, { recursive: true });
  await mkdir(SHOT_DIR, { recursive: true });

  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: !HEADED,
  });
  const page = await browser.newPage();
  const runtimeErrors = attachGuards(page);

  try {
    if (SELECTED.includes("B01")) {
      await caseRun("B01", async () => {
        const fixture = buildLiveLoanBrowserFixture({ seed: 42 });
        assert(fixture.ok, fixture.reason);
        assert(fixture.decision?.kind === "development-loan", "expected development-loan");
        const assessment = fixture.decision.playingTimeAssessment || fixture.player.pendingDecision?.playingTimeAssessment;
        const currentClub = fixture.player.playingClubId || fixture.player.club?.clubId;
        assert(currentClub, "current club required");
        if (assessment) {
          assert(
            assessment.representedClubId === currentClub,
            `assessment club ${assessment.representedClubId} !== ${currentClub}`
          );
          assert(Number(assessment.opportunityCapacity) > 0, "opportunity capacity required");
        }
        const snap = serializeCareerSnapshot({
          player: fixture.player,
          world: getWorldState(),
          checkpoint: fixture.checkpoint,
        });
        await writeJson(join(FIXTURE_DIR, "B01.json"), snap);
        await restoreSnapshot(page, snap);
        await shot(page, "B01-review");
        const before = await exportSnap(page);
        // Prove loan-options control is present without leaving the stay path unresolved.
        const loanOptsVisible = await page.evaluate(() => {
          const re = /Review loan options|loan options|See loan/i;
          return [...document.querySelectorAll("button")].some(
            (b) => re.test((b.textContent || "").trim()) && !b.disabled && b.offsetParent !== null
          );
        });
        assert(loanOptsVisible, "Review loan options control must be available");
        const stay =
          (await clickMatching(page, "Stay and compete")) ||
          (await clickMatching(page, "stay|compete|acknowledge"));
        assert(stay, "Stay and compete control missing");
        await page.waitForTimeout(250);
        const beforeContinue = await exportSnap(page);
        // Resume remaining season / presentation to desk.
        if (!(await uiState(page)).simulateDisabled) {
          await page.click("#simulate-btn").catch(() => {});
        }
        const driven = await driveToDesk(page);
        await assertDeskClear(page, "B01");
        const after = await exportSnap(page);
        await writeJson(join(CASE_DIR, "B01.json"), {
          before,
          beforeContinue,
          after,
          driven,
          stay,
          loanOptsVisible,
          assessmentClub: assessment?.representedClubId || null,
          capacity: assessment?.opportunityCapacity ?? null,
        });
        await shot(page, "B01-desk");
        assert(after.player.contractStatus === "active" || after.player.employmentClubId, "contract preserved");
        assert(after.player.age === before.player.age || after.player.age === before.player.age + 1, "age continuity");
        return { stay, loanOptsVisible, continueClicks: driven.continueClicks, age: after.player.age };
      });
    }

    if (SELECTED.includes("B02")) {
      await caseRun("B02", async () => {
        const snap = makeRenewalFixture();
        await writeJson(join(FIXTURE_DIR, "B02.json"), snap);
        await restoreSnapshot(page, snap);
        await shot(page, "B02-offer");
        const before = await exportSnap(page);
        const beforeEnd = before.player.contractEndSeason;
        const accept = await clickMatching(page, "Accept|Sign|accept");
        assert(accept, "Accept control missing");
        await page.waitForTimeout(300);
        const mid = await exportSnap(page);
        assert(num(mid.player.contractEndSeason, "end") > beforeEnd, "renewal must extend term");
        // Complete a season through the old expiry boundary
        await page.click("#simulate-btn").catch(() => {});
        const driven = await driveToDesk(page);
        await assertDeskClear(page, "B02");
        const after = await exportSnap(page);
        await writeJson(join(CASE_DIR, "B02.json"), { before, mid, after, driven });
        await shot(page, "B02-desk");
        assert(!after.player.freeAgentSpell || after.player.contractStatus === "active", "still employed");
        return {
          beforeEnd,
          afterEnd: mid.player.contractEndSeason,
          seasons: after.player.seasons?.length,
        };
      });
    }

    if (SELECTED.includes("B03")) {
      await caseRun("B03", async () => {
        // Start BEFORE the terminal season; reach boundary review through UI.
        reseedCareerRng(707);
        resetClubFinanceLedgers();
        setWorldState(createWorldState({ startYear: 2026 }));
        const hull = allSeniorClubs().find((c) => c.name === "Hull City");
        const p = createPlayerIdentity({
          name: "Fix07 Expiry",
          nationality: "England",
          position: "ST",
          age: 28,
        });
        Object.assign(p, {
          careerId: "fix07-b03",
          startYear: 2026,
          age: 28,
          rating: 55,
          attributes: attrs(55),
          club: { ...hull },
          employmentClubId: hull.clubId,
          playingClubId: hull.clubId,
          contractStatus: "active",
          contractStartSeason: 0,
          contractYears: 1,
          contractEndSeason: 1,
          weeklyWage: 4000,
          wage: 4000,
          seasons: [],
        });
        ensurePlayerModel(p);
        refreshAbilityCaches(p);
        ensureContractAuthority(p);
        const snap = serializeCareerSnapshot({ player: p, world: getWorldState() });
        await writeJson(join(FIXTURE_DIR, "B03.json"), snap);
        await restoreSnapshot(page, snap);
        const before = await exportSnap(page);
        assert(before.player.contractStatus === "active", "starts employed");
        await shot(page, "B03-start");
        await page.click("#simulate-btn");
        // Prefer explicit decline/leave on terminal review when present.
        let declined = false;
        for (let i = 0; i < 40; i++) {
          const cur = await uiState(page);
          if (cur.pendingDecision || cur.pendingOffers > 0) {
            const hit =
              (await clickMatching(page, "Decline and leave|decline-renewal|Decline")) ||
              (await clickMatching(page, "decline|leave|see out|acknowledge|remain|stay"));
            if (hit && /decline|leave/i.test(hit)) declined = true;
            await page.waitForTimeout(200);
            continue;
          }
          break;
        }
        const beforeFinalContinue = await exportSnap(page);
        const driven = await driveToDesk(page);
        await assertDeskClear(page, "B03");
        const after = await exportSnap(page);
        await shot(page, "B03-desk");
        assert(
          after.player.contractStatus === "released" || after.player.freeAgent || !after.player.playingClubId,
          "expected free agent after terminal review"
        );
        assert(after.player.age === before.player.age + 1, "one completed season ages once");
        const st = await uiState(page);
        assert(
          st.simulateDisabled === false || /free agent|train|search/i.test(st.simulateLabel),
          "usable FA action"
        );
        await writeJson(join(CASE_DIR, "B03.json"), {
          before,
          beforeFinalContinue,
          after,
          declined,
          driven,
        });
        return { freeAgent: true, age: after.player.age, seasons: after.player.seasons?.length, declined };
      });
    }

    if (SELECTED.includes("B04")) {
      await caseRun("B04", async () => {
        // Production recovery path: empty ordinary search → wait → recovery offers → Accept.
        reseedCareerRng(707);
        resetClubFinanceLedgers();
        setWorldState(createWorldState({ startYear: 2026 }));
        const p = createPlayerIdentity({
          name: "Fix07 Recovery",
          nationality: "Serbia",
          position: "ST",
          age: 23,
        });
        Object.assign(p, {
          careerId: "bug07-search-0",
          startYear: 2026,
          age: 23,
          rating: 66,
          attributes: attrs(66),
          club: null,
          employmentClubId: null,
          playingClubId: null,
          contractStatus: "released",
          contractEndSeason: 0,
          weeklyWage: 0,
          wage: 0,
          seasons: [],
          freeAgentReason: "contract-expired",
        });
        ensurePlayerModel(p);
        refreshAbilityCaches(p);
        ensureContractAuthority(p);
        ensureTransferSave(p);
        const empty = generatePipelineOffers(p, { performanceScore: 55 });
        assert(empty.offers.length === 0, "ordinary search empty");
        closeFreeAgentMarketReview(p, {
          ...empty,
          interestGateDeclined: empty.diagnostics?.interestGateResult === "declined",
        });
        advanceFreeAgentPeriod(p, { seasons: 1 });
        const recovery = generatePipelineOffers(p, { performanceScore: 55 });
        assert(recovery.offers.length > 0, "recovery must yield offers");
        assert(recovery.diagnostics?.interestGateResult === "recovery-bypass", "recovery bypass");
        p.pendingOffers = recovery.offers;
        p.pendingDecision = null;
        const snap = serializeCareerSnapshot({ player: p, world: getWorldState() });
        await writeJson(join(FIXTURE_DIR, "B04.json"), snap);
        await restoreSnapshot(page, snap);
        const beforeAccept = await exportSnap(page);
        await shot(page, "B04-start");
        assert((beforeAccept.player.pendingOffers || []).length > 0, "recovery offers on tray");
        const accept = await clickMatching(page, "Accept|Sign");
        assert(accept, "recovery Accept control required");
        await page.waitForTimeout(300);
        const afterSign = await exportSnap(page);
        assert(afterSign.player.age === beforeAccept.player.age, "signing must not age");
        assert(afterSign.player.club || afterSign.player.employmentClubId, "signed club required");
        assert(afterSign.player.contractStatus === "active", "active after recovery sign");
        const beforeFinalContinue = await exportSnap(page);
        await page.click("#simulate-btn");
        const driven = await driveToDesk(page);
        await assertDeskClear(page, "B04-final");
        const after = await exportSnap(page);
        await writeJson(join(CASE_DIR, "B04.json"), {
          beforeAccept,
          beforeFinalContinue,
          after,
          emptyReviewId: empty.reviewId,
          recoveryReviewId: recovery.reviewId,
          signed: true,
          driven,
        });
        await shot(page, "B04-desk");
        return {
          signed: true,
          age: after.player.age,
          club: after.player.club?.clubId || after.player.employmentClubId,
        };
      });
    }

    if (SELECTED.includes("B05")) {
      await caseRun("B05", async () => {
        // Non-retiring constrained FA: prove empty/validation without age-40 retirement roulette.
        reseedCareerRng(707);
        resetClubFinanceLedgers();
        setWorldState(createWorldState({ startYear: 2026 }));
        const p = createPlayerIdentity({
          name: "Fix07 Empty",
          nationality: "Serbia",
          position: "ST",
          age: 23,
        });
        Object.assign(p, {
          careerId: "fix07-b05-constrained",
          startYear: 2026,
          age: 23,
          rating: 42,
          attributes: attrs(42),
          club: null,
          employmentClubId: null,
          playingClubId: null,
          contractStatus: "released",
          contractEndSeason: 0,
          weeklyWage: 0,
          wage: 0,
          seasons: [],
          freeAgentReason: "contract-expired",
        });
        ensurePlayerModel(p);
        refreshAbilityCaches(p);
        ensureContractAuthority(p);
        ensureTransferSave(p);
        const snap = serializeCareerSnapshot({ player: p, world: getWorldState() });
        await writeJson(join(FIXTURE_DIR, "B05.json"), { ...snap, qaConstraint: "age23-ovr42-non-retiring" });
        await restoreSnapshot(page, snap);
        const ages = [];
        const windows = [];
        for (let i = 0; i < 2; i++) {
          const before = await exportSnap(page);
          ages.push(before.player.age);
          assert(!before.player.isRetired, "must not retire in constrained empty fixture");
          let st = await uiState(page);
          if (st.simulateDisabled) {
            const unlock =
              (await clickMatching(page, "Acknowledge|acknowledge|decline|remain|stay|train|search")) ||
              (await clickContinueBtn(page));
            assert(unlock || !st.simulateDisabled, "simulate must become usable for wait");
            await page.waitForTimeout(200);
            st = await uiState(page);
          }
          assert(!st.simulateDisabled, "simulate enabled for constrained wait");
          await page.click("#simulate-btn");
          await driveToDesk(page);
          await assertDeskClear(page, `B05-w${i}`);
          const after = await exportSnap(page);
          assert(after.player.age === before.player.age + 1, "one age per wait");
          assert(!(after.player.club), "no club football");
          assert(!after.player.isRetired, "wait must not count retirement as success");
          windows.push({
            age: after.player.age,
            empty: after.player.freeAgentSpell?.consecutiveEmptyReviews ?? null,
            lastClosed: after.player.freeAgentSpell?.lastClosedClassification ?? null,
          });
        }
        await shot(page, "B05-desk");
        const final = await exportSnap(page);
        await writeJson(join(CASE_DIR, "B05.json"), { ages, windows, final, constrained: true });
        return { ages, finalAge: final.player.age, windows };
      });
    }

    if (SELECTED.includes("B06")) {
      await caseRun("B06", async () => {
        const fixture = buildLiveLoanBrowserFixture({ seed: 42 });
        assert(fixture.ok, fixture.reason);
        const offer = fixture.offers.find(
          (o) => o.isLoan && o.leagueId && o.leagueId !== "league:italy-serie-a"
        );
        assert(offer, "cross-league loan offer");
        // Put loan offers on the tray for Accept
        fixture.player.pendingDecision = null;
        fixture.player.pendingOffers = [offer];
        const snap = serializeCareerSnapshot({
          player: fixture.player,
          world: getWorldState(),
          checkpoint: fixture.checkpoint,
        });
        await writeJson(join(FIXTURE_DIR, "B06.json"), snap);
        await restoreSnapshot(page, snap);
        await shot(page, "B06-offer");
        const parentId = snap.player.employmentClubId;
        const accept = await clickMatching(page, "Accept|Sign");
        assert(accept, "loan Accept missing");
        await page.waitForTimeout(300);
        const mid = await exportSnap(page);
        assert(mid.player.activeLoan?.status === "active" || mid.player.playingClubId !== parentId, "on loan");
        assert(mid.player.employmentClubId === parentId, "parent employment retained");
        await page.click("#simulate-btn").catch(() => {});
        const driven = await driveToDesk(page);
        await assertDeskClear(page, "B06");
        const after = await exportSnap(page);
        await writeJson(join(CASE_DIR, "B06.json"), { parentId, mid, after, offer: offer.clubId, driven });
        await shot(page, "B06-desk");
        return { parentId, playing: after.player.playingClubId, employment: after.player.employmentClubId };
      });
    }

    if (SELECTED.includes("B07")) {
      await caseRun("B07", async () => {
        const snap = makeRenewalFixture({ id: "fix07-b07" });
        await writeJson(join(FIXTURE_DIR, "B07.json"), snap);
        await restoreSnapshot(page, snap);
        const a = await exportSnap(page);
        await restoreSnapshot(page, a);
        const b = await exportSnap(page);
        assert(a.player.pendingOffers?.[0]?.offerId === b.player.pendingOffers?.[0]?.offerId, "offer identity");
        assert(a.player.contractRevision === b.player.contractRevision, "revision stable");
        await shot(page, "B07-restored");
        const accept = await clickMatching(page, "Accept|Sign");
        assert(accept, "Accept after restore");
        await page.waitForTimeout(250);
        const after = await exportSnap(page);
        assert(after.player.contractEndSeason > a.player.contractEndSeason, "extended after restore");
        const endAfter = after.player.contractEndSeason;
        const wageAfter = after.player.weeklyWage;
        // Attempt stale/duplicate accept through the live interface payload.
        const dup = await page.evaluate((offer) => {
          const fn = window.__acceptTransferOffer || window.__acceptPipelineOffer;
          if (typeof fn === "function") return fn(offer);
          // Fall back: clicking Accept again must not extend further.
          const btn = [...document.querySelectorAll("button")].find((el) =>
            /Accept|Sign/i.test(el.textContent || "")
          );
          if (btn && !btn.disabled && btn.offsetParent !== null) {
            btn.click();
            return { clickedAgain: true };
          }
          return { clickedAgain: false, remainingOffers: window.__exportCareerSnapshot?.()?.player?.pendingOffers?.length || 0 };
        }, a.player.pendingOffers[0]);
        await page.waitForTimeout(200);
        const afterDup = await exportSnap(page);
        assert(afterDup.player.contractEndSeason === endAfter, "duplicate accept must not re-extend");
        assert(afterDup.player.weeklyWage === wageAfter, "duplicate accept must not rebook wage");
        const beforeFinalContinue = await exportSnap(page);
        await page.click("#simulate-btn").catch(() => {});
        const driven = await driveToDesk(page);
        await assertDeskClear(page, "B07");
        const final = await exportSnap(page);
        await writeJson(join(CASE_DIR, "B07.json"), {
          a,
          b,
          after,
          afterDup,
          dup,
          beforeFinalContinue,
          final,
          driven,
        });
        await shot(page, "B07-desk");
        return { offerId: a.player.pendingOffers[0].offerId, end: endAfter };
      });
    }
  } finally {
    const unexpected = runtimeErrors.filter(
      (e) =>
        !/favicon|DevTools|Download the React|status of 404|Failed to load resource/i.test(
          e.message || ""
        )
    );
    const report = {
      generatedAt: new Date().toISOString(),
      base: BASE,
      selected: SELECTED,
      fullRun: SELECTED.length === REQUIRED.length && REQUIRED.every((c) => SELECTED.includes(c)),
      results,
      runtimeErrors: unexpected,
      pass: results.every((r) => r.status === "PASS") && unexpected.length === 0 && results.length === SELECTED.length,
    };
    await writeJson(OUT, report);
    console.log(`\nWrote ${OUT}`);
    console.log(JSON.stringify({ pass: report.pass, results: results.map((r) => [r.name, r.status]) }, null, 2));
    await browser.close();
    if (!report.pass) process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
