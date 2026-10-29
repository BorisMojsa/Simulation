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
  assertPlayableRegistration,
} from "../js/simulation/contractLifecycle.js";
import { ensureTransferSave } from "../js/simulation/transferMigration.js";
import { allSeniorClubs } from "../js/simulation/seniorClubs.js";
import {
  generatePipelineOffers,
  acceptPipelineOffer,
  closeFreeAgentMarketReview,
} from "../js/simulation/dealPipeline.js";
import { generateLoanOffers, startLoan } from "../js/simulation/loanMarket.js";
import { resolveSquadDecision } from "../js/simulation/squadDecisions.js";
import { buildLiveLoanBrowserFixture } from "../js/simulation/liveLoanBrowserFixture.js";
import { buildFreeAgentBrowserFixture } from "../js/simulation/freeAgentBrowserFixture.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import { applySeniorScenarioPolicy } from "../js/simulation/seniorCareerScenarios.js";

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

/** Compact player/review evidence for case JSON (full snaps blow string limits). */
function slimPlayer(snapOrPlayer) {
  const p = snapOrPlayer?.player || snapOrPlayer;
  if (!p) return null;
  return {
    careerId: p.careerId || null,
    age: p.age ?? null,
    contractStatus: p.contractStatus || null,
    employmentClubId: p.employmentClubId || null,
    playingClubId: p.playingClubId || null,
    contractEndSeason: p.contractEndSeason ?? null,
    seasons: p.seasons?.length ?? 0,
    pendingContractReview: p.pendingContractReview
      ? {
          status: p.pendingContractReview.status || null,
          outcome: p.pendingContractReview.outcome || null,
          settledChoice: p.pendingContractReview.settledChoice || null,
        }
      : null,
    activeLoanStatus: p.activeLoan?.status || null,
  };
}

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
      return {
        continueClicks,
        final: cur,
        actions,
        beforeFinalContinue: driveToDesk._beforeFinalContinue || null,
      };
    }
    // Prefer the real season Continue when the presentation tray owns the UI.
    if (cur.continueBtnVisible && !cur.continueBtnDisabled) {
      const beforeFinalContinue = await exportSnap(page).catch(() => null);
      const cont = await clickContinueBtn(page);
      if (cont?.clicked) {
        reachedContinue = true;
        continueClicks += 1;
        actions.push({ type: "continue", beforeFinalContinueAge: beforeFinalContinue?.player?.age });
        // Retain the latest pre-Continue export for case assertions.
        driveToDesk._beforeFinalContinue = beforeFinalContinue;
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
        (await clickMatching(page, "Continue the season")) ||
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
        const assessment =
          fixture.decision.playingTimeAssessment ||
          fixture.player.pendingDecision?.playingTimeAssessment;
        const currentClub = fixture.player.playingClubId || fixture.player.club?.clubId;
        assert(currentClub, "current club required");
        assert(assessment, "playing-time assessment required on development-loan");
        assert(
          assessment.representedClubId === currentClub,
          `assessment club ${assessment.representedClubId} !== ${currentClub}`
        );
        assert(Number(assessment.opportunityCapacity) > 0, "opportunity capacity required");
        assert(Number.isFinite(assessment.share), "assessment share required");
        const snap = serializeCareerSnapshot({
          player: fixture.player,
          world: getWorldState(),
          checkpoint: fixture.checkpoint,
        });
        await writeJson(join(FIXTURE_DIR, "B01.json"), snap);
        await restoreSnapshot(page, snap);
        await shot(page, "B01-review");
        const before = await exportSnap(page);
        const loanOpts =
          (await clickMatching(page, "Review loan options|loan options")) ||
          (await clickMatching(page, "See loan|loan"));
        assert(loanOpts, "Review loan options must be clicked");
        await page.waitForTimeout(250);
        await shot(page, "B01-loan-tray");
        // Decline/back from loan tray, then stay.
        const back =
          (await clickMatching(page, "Stay and compete|Stay")) ||
          (await clickMatching(page, "Back|Cancel|Decline|close|acknowledge"));
        assert(back, "must leave loan tray via stay/decline");
        await page.waitForTimeout(200);
        const stay =
          (await clickMatching(page, "Stay and compete")) ||
          (await clickMatching(page, "stay|compete|acknowledge"));
        if (!(await uiState(page)).overlayHidden || (await uiState(page)).pendingDecision) {
          assert(stay || /stay|compete|acknowledge/i.test(String(back)), "stay path exercised");
        }
        await page.waitForTimeout(250);
        const beforeContinue = await exportSnap(page);
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
          stay: stay || back,
          loanOpts,
          assessment: {
            club: assessment.representedClubId,
            capacity: assessment.opportunityCapacity,
            share: assessment.share,
            eligible: assessment.eligibleFixtureCount,
          },
        });
        await shot(page, "B01-desk");
        assert(after.player.contractStatus === "active" || after.player.employmentClubId, "contract preserved");
        assert(after.player.age === before.player.age || after.player.age === before.player.age + 1, "age continuity");
        return {
          stay: stay || back,
          loanOpts,
          continueClicks: driven.continueClicks,
          age: after.player.age,
        };
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
        const hull = allSeniorClubs().find((c) => c.name === "Hull City");

        function completeToPendingRenewal(player) {
          let data = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
            pauseForDecisions: true,
            autoDecisionPolicy: null,
          });
          let guard = 0;
          while ((data.awaitingScenario || data.awaitingDecision) && ++guard < 40) {
            if (data.awaitingScenario) {
              applySeniorScenarioPolicy(
                player,
                player.pendingSeniorScenario || data.pendingSeniorScenario,
                "balanced"
              );
              player.pendingSeniorScenario = null;
            } else if (data.awaitingDecision) {
              const d = data.decision || player.pendingDecision;
              const choice = (d.allowedChoices || d.choices?.map((c) => c.id) || [])[0];
              assert(choice, `paused decision has no choice (${d?.kind})`);
              const resolved = resolveSquadDecision(player, d, choice);
              assert(resolved.ok, `resolve ${choice} failed: ${resolved.reason}`);
              player.pendingOffers = [];
            }
            data = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
              pauseForDecisions: true,
              autoDecisionPolicy: null,
              keepPendingBoundaryReview: true,
              checkpoint: data.checkpoint,
            });
          }
          return data;
        }

        // Prefabricate ALL pause + restore fixtures before any browser mutation.
        // Pause snaps must be built first — completeToPendingRenewal mutates shared club state.
        function pauseBeforeCompletion(player) {
          let data = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
            pauseForDecisions: true,
            autoDecisionPolicy: null,
          });
          let guard = 0;
          while (data.awaitingScenario && !(player.seasons?.length >= 1) && ++guard < 8) {
            const pending = player.pendingSeniorScenario || data.pendingSeniorScenario;
            applySeniorScenarioPolicy(player, pending, "balanced");
            player.pendingSeniorScenario = null;
            data = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
              pauseForDecisions: true,
              autoDecisionPolicy: null,
              checkpoint: data.checkpoint,
            });
          }
          assert(!(player.seasons?.length >= 1), "paused fixture must not already complete the season");
          assert(data.awaitingDecision && data.checkpoint, "paused fixture needs a live squad decision");
          player.seasonCheckpoint = data.checkpoint;
          player.pendingDecision = data.decision || player.pendingDecision;
          player.pendingOffers = data.offers || player.pendingOffers || [];
          return serializeCareerSnapshot({
            player,
            world: getWorldState(),
            checkpoint: data.checkpoint,
          });
        }

        function buildPositivePlayer(id, name = "Fix07 Positive Review") {
          reseedCareerRng(707);
          resetClubFinanceLedgers();
          setWorldState(createWorldState({ startYear: 2026 }));
          const p = createPlayerIdentity({
            name,
            nationality: "England",
            position: "ST",
            age: 24,
          });
          Object.assign(p, {
            careerId: id,
            startYear: 2026,
            age: 24,
            rating: 90,
            attributes: attrs(90),
            club: { ...hull },
            employmentClubId: hull.clubId,
            playingClubId: hull.clubId,
            contractStatus: "active",
            contractStartSeason: 0,
            contractYears: 1,
            contractEndSeason: 1,
            weeklyWage: 1500,
            wage: 1500,
            seasons: [],
          });
          ensurePlayerModel(p);
          refreshAbilityCaches(p);
          ensureContractAuthority(p);
          return p;
        }

        function buildCoterminalPlayer(id, name = "Fix07 CoTerminal") {
          reseedCareerRng(707);
          resetClubFinanceLedgers();
          setWorldState(createWorldState({ startYear: 2026 }));
          const atalanta = allSeniorClubs().find((c) => c.name === "Atalanta");
          const p = createPlayerIdentity({
            name,
            nationality: "England",
            position: "ST",
            age: 24,
          });
          Object.assign(p, {
            careerId: id,
            startYear: 2026,
            age: 24,
            rating: 90,
            attributes: attrs(90),
            club: { ...atalanta },
            employmentClubId: atalanta.clubId,
            playingClubId: atalanta.clubId,
            contractStatus: "active",
            contractStartSeason: 0,
            contractYears: 1,
            contractEndSeason: 1,
            weeklyWage: 1500,
            wage: 1500,
            seasons: [],
          });
          ensurePlayerModel(p);
          refreshAbilityCaches(p);
          ensureContractAuthority(p);
          const loans = generateLoanOffers(p, { maxOffers: 3, rng: createRng(707) });
          assert(loans.offers?.length > 0, "co-terminal loan offers required");
          assert(startLoan(p, loans.offers[0]).ok, "co-terminal startLoan");
          reseedCareerRng(708);
          return { player: p, loanClub: loans.offers[0].clubId, parent: atalanta.clubId };
        }

        // One pause fixture per club path — a second build can land a different loan
        // club / minute path (Hertha 90' → will-not-renew) while live stays on Schalke.
        // Clone the live pause snap for Accept so resume stays on the same seeded path.
        const positiveLiveStart = pauseBeforeCompletion(buildPositivePlayer("fix07-b03-positive-live"));
        const positiveAcceptStart = jsonClone(positiveLiveStart);
        const cotermLiveBuilt = buildCoterminalPlayer("fix07-b03-coterminal-live");
        const cotermLiveMeta = {
          snap: pauseBeforeCompletion(cotermLiveBuilt.player),
          loanClub: cotermLiveBuilt.loanClub,
          parent: cotermLiveBuilt.parent,
        };
        const cotermAcceptStart = {
          snap: jsonClone(cotermLiveMeta.snap),
          parent: cotermLiveMeta.parent,
          loanClub: cotermLiveMeta.loanClub,
        };
        await writeJson(join(FIXTURE_DIR, "B03-positive-start.json"), positiveLiveStart);
        await writeJson(join(FIXTURE_DIR, "B03-positive-accept-start.json"), positiveAcceptStart);
        await writeJson(join(FIXTURE_DIR, "B03-coterminal-start.json"), cotermLiveMeta.snap);
        await writeJson(join(FIXTURE_DIR, "B03.json"), cotermLiveMeta.snap);
        await writeJson(join(FIXTURE_DIR, "B03-coterminal-accept-start.json"), cotermAcceptStart.snap);

        // Restore fixtures after pause snaps (may mutate Hull/Atalanta club state).
        const restorePositiveEarly = buildPositivePlayer(
          "fix07-b03-positive-restore",
          "Fix07 Positive Restore"
        );
        completeToPendingRenewal(restorePositiveEarly);
        assert(
          restorePositiveEarly.pendingContractReview?.outcome === "wants-renewal",
          "early positive restore fixture"
        );
        const positiveRestoreSnap = serializeCareerSnapshot({
          player: restorePositiveEarly,
          world: getWorldState(),
        });
        await writeJson(join(FIXTURE_DIR, "B03-positive.json"), positiveRestoreSnap);

        const cotermRestoreBuilt = buildCoterminalPlayer(
          "fix07-b03-coterminal-restore",
          "Fix07 CoTerminal Restore"
        );
        completeToPendingRenewal(cotermRestoreBuilt.player);
        assert(
          cotermRestoreBuilt.player.pendingContractReview?.outcome === "wants-renewal",
          "early coterm restore fixture"
        );
        const cotermRestoreSnap = serializeCareerSnapshot({
          player: cotermRestoreBuilt.player,
          world: getWorldState(),
        });
        await writeJson(join(FIXTURE_DIR, "B03-coterminal.json"), cotermRestoreSnap);

        // A) Negative terminal review (genuine non-renewal) via UI.
        reseedCareerRng(707);
        resetClubFinanceLedgers();
        setWorldState(createWorldState({ startYear: 2026 }));
        const negativePlayer = createPlayerIdentity({
          name: "Fix07 Expiry",
          nationality: "England",
          position: "ST",
          age: 28,
        });
        Object.assign(negativePlayer, {
          careerId: "fix07-b03-negative",
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
        ensurePlayerModel(negativePlayer);
        refreshAbilityCaches(negativePlayer);
        ensureContractAuthority(negativePlayer);
        const negativeSnap = serializeCareerSnapshot({
          player: negativePlayer,
          world: getWorldState(),
        });
        await writeJson(join(FIXTURE_DIR, "B03-negative.json"), negativeSnap);
        await restoreSnapshot(page, negativeSnap);
        const negBefore = await exportSnap(page);
        assert(negBefore.player.contractStatus === "active", "negative starts employed");
        await shot(page, "B03-start");
        await page.click("#simulate-btn");
        let negDeclined = false;
        for (let i = 0; i < 40; i++) {
          const cur = await uiState(page);
          if (cur.pendingDecision || cur.pendingOffers > 0) {
            const hit =
              (await clickMatching(page, "Decline and leave|decline-renewal|Decline")) ||
              (await clickMatching(page, "decline|leave|see out|acknowledge|remain|stay"));
            if (hit && /decline|leave/i.test(hit)) negDeclined = true;
            await page.waitForTimeout(200);
            continue;
          }
          break;
        }
        const negBeforeFinalContinue = await exportSnap(page);
        const negDriven = await driveToDesk(page);
        await assertDeskClear(page, "B03-negative");
        const negAfter = await exportSnap(page);
        assert(
          negAfter.player.contractStatus === "released" ||
            negAfter.player.freeAgent ||
            !negAfter.player.playingClubId,
          "expected free agent after negative terminal review"
        );
        assert(negAfter.player.age === negBefore.player.age + 1, "negative ages once");
        const negReview = negAfter.player.pendingContractReview;
        assert(
          negReview?.outcome === "will-not-renew" ||
            negReview?.settledChoice === "non-renewal" ||
            negAfter.player.contractStatus === "released",
          "negative path must settle genuine non-renewal/release"
        );

        async function waitBoundaryTray(label) {
          const actions = [];
          let beforeFinalContinue = null;
          let continueClicks = 0;
          let sawPendingReview = false;
          const deadline = Date.now() + 180000;
          while (Date.now() < deadline) {
            const cur = await uiState(page);
            const snap = await exportSnap(page).catch(() => null);
            const review = snap?.player?.pendingContractReview;
            const renewals = (snap?.player?.pendingOffers || []).filter((o) => o.isRenewal);
            const decisionKind = snap?.player?.pendingDecision?.kind || cur.pendingDecision?.kind;
            const lead = snap?.player?.pendingDecision?.lead || "";
            const reviewReady =
              review?.status === "pending" &&
              review?.outcome === "wants-renewal" &&
              renewals.length > 0 &&
              decisionKind === "boundary-renewal";
            if (reviewReady) {
              sawPendingReview = true;
              assert(
                !/will become a free agent after settlement/i.test(lead),
                `${label}: premature FA wording (${lead})`
              );
            }

            if (cur.continueBtnVisible && !cur.continueBtnDisabled) {
              beforeFinalContinue = snap;
              if (reviewReady) {
                actions.push({
                  type: "review-before-continue",
                  decision: decisionKind,
                  offerId: renewals[0].offerId,
                });
              }
              const cont = await clickContinueBtn(page);
              if (cont?.clicked) {
                continueClicks += 1;
                actions.push({ type: "continue", age: snap?.player?.age });
              }
              await page.waitForTimeout(160);
              continue;
            }

            if (reviewReady && cur.overlayHidden && cur.dashboardHidden) {
              const ready = await page.evaluate(() =>
                [...document.querySelectorAll("button")].some(
                  (b) =>
                    /Decline and leave|^Decline$|Accept Offer|^Accept$/i.test(
                      (b.textContent || "").trim()
                    ) &&
                    !b.disabled &&
                    b.offsetParent !== null
                )
              );
              if (ready) {
                return {
                  snap,
                  beforeFinalContinue,
                  continueClicks,
                  actions,
                  offerId: renewals[0].offerId,
                  lead,
                  decisionKind,
                };
              }
            }

            const scenarioHit = await page.evaluate(() => {
              const overlay = document.getElementById("senior-scenario-overlay");
              if (!overlay || overlay.classList.contains("hidden")) return null;
              const btns = [
                ...document.querySelectorAll(
                  "#senior-scenario-overlay button, .scenario-actions button"
                ),
              ];
              const pick =
                btns.find((b) =>
                  /balanced|continue|acknowledge|proceed|ok/i.test(b.textContent || "")
                ) || btns.find((b) => !b.disabled && b.offsetParent !== null);
              if (!pick || pick.disabled) return null;
              pick.click();
              return (pick.textContent || "").trim();
            });
            if (scenarioHit) {
              actions.push({ type: "scenario", label: scenarioHit });
              await page.waitForTimeout(200);
              continue;
            }

            if (
              cur.overlayHidden &&
              decisionKind !== "boundary-renewal" &&
              (cur.pendingDecision ||
                cur.pendingOffers > 0 ||
                cur.nextAction?.id === "resolve-decision")
            ) {
              const clicked =
                (await clickMatching(page, "Continue the season")) ||
                (await clickMatching(page, "Stay and compete")) ||
                (await clickMatching(page, "Acknowledge|acknowledge")) ||
                (await clickMatching(page, "remain|see out|compete")) ||
                (await clickMatching(page, "Decline|decline"));
              if (clicked) {
                actions.push({ type: "decision", label: clicked, kind: decisionKind });
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

            await page.evaluate(() => {
              for (const id of [
                "sim-skip-phase-btn",
                "match-skip-phase-btn",
                "sim-skip-match-btn",
                "match-skip-btn",
              ]) {
                const el = document.getElementById(id);
                if (el && !el.disabled && el.offsetParent !== null) el.click();
              }
            });
            await page.waitForTimeout(120);
          }
          const last = await exportSnap(page).catch(() => null);
          throw new Error(
            `${label}: boundary wants-renewal tray not reached (sawPending=${sawPendingReview}, review=${last?.player?.pendingContractReview?.status}/${last?.player?.pendingContractReview?.outcome}, decision=${last?.player?.pendingDecision?.kind}, seasons=${last?.player?.seasons?.length}, age=${last?.player?.age})`
          );
        }

        async function clearDeskNoAdvance(label) {
          for (let i = 0; i < 40; i++) {
            const cur = await uiState(page);
            if (
              cur.overlayHidden &&
              cur.dashboardHidden &&
              !cur.seasonActionInFlight &&
              cur.nextAction?.id !== "resolve-scenario"
            ) {
              break;
            }
            if (cur.continueBtnVisible && !cur.continueBtnDisabled) {
              await clickContinueBtn(page);
            } else if (cur.nextAction?.id === "resolve-scenario" || cur.pendingDecision) {
              await clickMatching(
                page,
                "Acknowledge|acknowledge|Continue|continue|remain|stay|balanced|OK"
              );
            } else {
              await page.waitForTimeout(120);
            }
          }
          await assertDeskClear(page, label);
        }

        // B/C) Live / accept / restore paths — all pause fixtures were prefabricated
        // before any browser club mutations so shared Hull/Atalanta state stays clean.
        async function resumePausedSeason(label) {
          const st = await uiState(page);
          if (st.pendingDecision || st.pendingOffers > 0) {
            assert(
              (await clickMatching(page, "Continue the season")) ||
                (await clickMatching(page, "Stay and compete")) ||
                (await clickMatching(page, "Acknowledge|acknowledge|remain|stay|compete")),
              `${label} must resolve paused decision through UI`
            );
          } else if (!st.simulateDisabled) {
            await page.click("#simulate-btn");
          }
        }

        await restoreSnapshot(page, positiveLiveStart);
        const posBefore = await exportSnap(page);
        assert(posBefore.player.contractStatus === "active", "positive live starts employed");
        assert(!(posBefore.player.pendingContractReview?.status === "pending"), "starts pre-review");
        assert(!(posBefore.player.seasons?.length >= 1), "positive live starts pre-completion");
        await shot(page, "B03-positive-start");
        await resumePausedSeason("B03-positive-live");
        const posTray = await waitBoundaryTray("B03-positive-live");
        await shot(page, "B03-positive-tray");
        const posDecline =
          (await clickMatching(page, "Decline and leave|decline-renewal")) ||
          (await clickMatching(page, "^Decline$|Decline"));
        assert(posDecline, "positive live Decline control required");
        await page.waitForTimeout(250);
        const posAfterDecline = await exportSnap(page);
        assert(posAfterDecline.player.age === posBefore.player.age + 1, "positive live ages once");
        await clearDeskNoAdvance("B03-positive-live");
        const posAfter = await exportSnap(page);
        await shot(page, "B03-desk");
        assert(
          posAfter.player.contractStatus === "released" || !posAfter.player.employmentClubId,
          "positive live decline releases"
        );

        await restoreSnapshot(page, positiveRestoreSnap);
        const restorePosBefore = await exportSnap(page);
        assert(restorePosBefore.player.pendingContractReview?.status === "pending", "restore pending");
        const restoreDecline =
          (await clickMatching(page, "Decline and leave|decline-renewal")) ||
          (await clickMatching(page, "^Decline$|Decline"));
        assert(restoreDecline, "restore Decline required");
        await clearDeskNoAdvance("B03-positive-restore");

        await restoreSnapshot(page, positiveAcceptStart);
        await resumePausedSeason("B03-positive-accept");
        const posAcceptTray = await waitBoundaryTray("B03-positive-accept");
        const posAccept =
          (await clickMatching(page, "Accept Offer")) ||
          (await clickMatching(page, "^Accept$|Accept|Sign"));
        assert(posAccept, "positive live Accept control required");
        await page.waitForTimeout(250);
        const posAccepted = await exportSnap(page);
        assert(posAccepted.player.contractStatus === "active", "accepted renewal stays active");
        assert(posAccepted.player.contractEndSeason > 1, "accepted renewal extends");
        assert(posAccepted.player.employmentClubId === hull.clubId, "employer preserved");
        await clearDeskNoAdvance("B03-positive-accept");

        await restoreSnapshot(page, cotermLiveMeta.snap);
        const cotermBefore = await exportSnap(page);
        assert(cotermBefore.player.activeLoan?.status === "active", "coterm starts on loan");
        assert(!(cotermBefore.player.seasons?.length >= 1), "coterm starts pre-completion");
        await shot(page, "B03-coterminal-start");
        await resumePausedSeason("B03-coterminal-live");
        const cotermTray = await waitBoundaryTray("B03-coterminal-live");
        await shot(page, "B03-coterminal-tray");
        assert(cotermTray.continueClicks > 0, "coterm live must click final Continue");
        assert(cotermTray.beforeFinalContinue, "coterm live beforeFinalContinue required");
        const cotermDecline =
          (await clickMatching(page, "Decline and leave|decline-renewal")) ||
          (await clickMatching(page, "^Decline$|Decline"));
        assert(cotermDecline, "coterm live Decline required");
        await page.waitForTimeout(250);
        const cotermAfterDecline = await exportSnap(page);
        await clearDeskNoAdvance("B03-coterminal-live");
        const cotermAfter = await exportSnap(page);
        await shot(page, "B03-coterminal-desk");
        assert(
          cotermAfter.player.pendingContractReview?.status === "settled" ||
            !cotermAfter.player.employmentClubId,
          "coterm live review settled after decline"
        );

        await restoreSnapshot(page, cotermRestoreSnap);
        const restoreCotermDecline =
          (await clickMatching(page, "Decline and leave|decline-renewal")) ||
          (await clickMatching(page, "^Decline$|Decline"));
        assert(restoreCotermDecline, "coterm restore Decline required");
        await clearDeskNoAdvance("B03-coterminal-restore");

        await restoreSnapshot(page, cotermAcceptStart.snap);
        await resumePausedSeason("B03-coterminal-accept");
        const cotermAcceptTray = await waitBoundaryTray("B03-coterminal-accept");
        const cotermAccept =
          (await clickMatching(page, "Accept Offer")) ||
          (await clickMatching(page, "^Accept$|Accept|Sign"));
        assert(cotermAccept, "coterm live Accept required");
        await page.waitForTimeout(250);
        const cotermAccepted = await exportSnap(page);
        assert(cotermAccepted.player.contractStatus === "active", "coterm accept active");
        assert(cotermAccepted.player.employmentClubId === cotermAcceptStart.parent, "parent kept");
        assert(cotermAccepted.player.contractEndSeason > 1, "coterm accept extends");
        await clearDeskNoAdvance("B03-coterminal-accept");

        await writeJson(join(CASE_DIR, "B03.json"), {
          negative: {
            before: slimPlayer(negBefore),
            beforeFinalContinue: slimPlayer(negBeforeFinalContinue),
            after: slimPlayer(negAfter),
            declined: negDeclined,
            driven: {
              continueClicks: negDriven?.continueClicks ?? null,
              actions: negDriven?.actions || [],
              beforeFinalContinue: slimPlayer(negDriven?.beforeFinalContinue),
              final: slimPlayer(negDriven?.final),
            },
            reviewOutcome: negAfter.player.pendingContractReview?.outcome || null,
            settledChoice: negAfter.player.pendingContractReview?.settledChoice || null,
          },
          positiveLive: {
            before: slimPlayer(posBefore),
            beforeFinalContinue: slimPlayer(posTray.beforeFinalContinue),
            afterDecline: slimPlayer(posAfterDecline),
            after: slimPlayer(posAfter),
            declined: Boolean(posDecline),
            offerId: posTray.offerId,
            continueClicks: posTray.continueClicks,
            actions: posTray.actions,
            lead: posTray.lead,
          },
          positiveAcceptLive: {
            beforeFinalContinue: slimPlayer(posAcceptTray.beforeFinalContinue),
            after: slimPlayer(posAccepted),
            continueClicks: posAcceptTray.continueClicks,
            actions: posAcceptTray.actions,
            offerId: posAcceptTray.offerId,
          },
          positiveRestore: {
            before: slimPlayer(restorePosBefore),
            declined: Boolean(restoreDecline),
          },
          coterminalLive: {
            before: slimPlayer(cotermBefore),
            beforeFinalContinue: slimPlayer(cotermTray.beforeFinalContinue),
            afterDecline: slimPlayer(cotermAfterDecline),
            after: slimPlayer(cotermAfter),
            declined: Boolean(cotermDecline),
            continueClicks: cotermTray.continueClicks,
            actions: cotermTray.actions,
            lead: cotermTray.lead,
            loanClub: cotermLiveMeta.loanClub,
            parent: cotermLiveMeta.parent,
          },
          coterminalAcceptLive: {
            beforeFinalContinue: slimPlayer(cotermAcceptTray.beforeFinalContinue),
            after: slimPlayer(cotermAccepted),
            continueClicks: cotermAcceptTray.continueClicks,
            actions: cotermAcceptTray.actions,
            parent: cotermAcceptStart.parent,
          },
          coterminalRestore: {
            declined: Boolean(restoreCotermDecline),
          },
        });
        return {
          negativeOutcome: negAfter.player.pendingContractReview?.outcome || "released",
          positiveLiveDeclined: Boolean(posDecline),
          positiveLiveAccepted: posAccepted.player.contractEndSeason > 1,
          coterminalLiveDeclined: Boolean(cotermDecline),
          coterminalLiveAccepted: cotermAccepted.player.contractEndSeason > 1,
          cotermContinueClicks: cotermTray.continueClicks,
        };
      });
    }

    if (SELECTED.includes("B04")) {
      await caseRun("B04", async () => {
        // Start at ordinary empty FA desk; wait/search through UI until recovery Accept.
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
          pendingOffers: [],
          pendingDecision: null,
        });
        ensurePlayerModel(p);
        refreshAbilityCaches(p);
        ensureContractAuthority(p);
        ensureTransferSave(p);
        const snap = serializeCareerSnapshot({ player: p, world: getWorldState() });
        await writeJson(join(FIXTURE_DIR, "B04.json"), snap);
        await restoreSnapshot(page, snap);
        const before = await exportSnap(page);
        await shot(page, "B04-start");
        assert(!(before.player.pendingOffers || []).length, "starts without recovery offers");
        await page.click("#simulate-btn");
        let driven = await driveToDesk(page);
        await assertDeskClear(page, "B04-wait1");
        const mid = await exportSnap(page);
        assert(num(mid.player.age, "age1") === num(before.player.age, "age0") + 1, "age +1 on wait");
        // Clear empty tray / decision so the next scheduled search can run.
        for (let i = 0; i < 20; i++) {
          const st = await uiState(page);
          if (!st.simulateDisabled && st.overlayHidden) break;
          if (st.continueBtnVisible && !st.continueBtnDisabled) {
            await clickContinueBtn(page);
          } else if (st.pendingOffers > 0 || st.pendingDecision) {
            await clickMatching(page, "Decline|decline|Acknowledge|acknowledge|remain|stay|Continue");
          } else {
            await page.waitForTimeout(120);
          }
        }
        {
          const st = await uiState(page);
          assert(!st.simulateDisabled, "simulate must unlock for recovery search");
        }
        // Second scheduled search should enter recovery and surface Accept.
        await page.click("#simulate-btn");
        let tray = null;
        for (let i = 0; i < 160; i++) {
          tray = await uiState(page);
          const acceptReady = await page.evaluate(() =>
            [...document.querySelectorAll("button")].some(
              (b) =>
                /Accept Offer|^Accept$/i.test((b.textContent || "").trim()) &&
                !b.disabled &&
                b.offsetParent !== null
            )
          );
          if (acceptReady && tray.pendingOffers > 0 && tray.overlayHidden) break;
          // Finish season presentation before the offer tray is actionable.
          if (tray.continueBtnVisible && !tray.continueBtnDisabled) {
            await clickContinueBtn(page);
          } else if (tray.pendingDecision && tray.overlayHidden) {
            await clickMatching(page, "Acknowledge|acknowledge|decline|remain|stay");
          } else if (!tray.simulateDisabled && tray.overlayHidden && tray.pendingOffers === 0) {
            await page.click("#simulate-btn").catch(() => {});
          } else {
            await page.waitForTimeout(150);
          }
        }
        assert(tray?.pendingOffers > 0, "recovery must surface offers in live UI");
        const acceptReady = await page.evaluate(() =>
          [...document.querySelectorAll("button")].some(
            (b) =>
              /Accept Offer|^Accept$/i.test((b.textContent || "").trim()) &&
              !b.disabled &&
              b.offsetParent !== null
          )
        );
        assert(acceptReady, "recovery Accept control must be visible on desk");
        const beforeAccept = await exportSnap(page);
        await shot(page, "B04-recovery-tray");
        const accept =
          (await clickMatching(page, "Accept Offer")) ||
          (await clickMatching(page, "Accept|Sign"));
        assert(accept, "recovery Accept control required");
        await page.waitForTimeout(300);
        const afterSign = await exportSnap(page);
        assert(afterSign.player.age === beforeAccept.player.age, "signing must not age");
        assert(afterSign.player.club || afterSign.player.employmentClubId, "signed club required");
        assert(afterSign.player.contractStatus === "active", "active after recovery sign");
        await page.click("#simulate-btn");
        driven = await driveToDesk(page);
        const beforeFinalContinue = driven.beforeFinalContinue || null;
        await assertDeskClear(page, "B04-final");
        const after = await exportSnap(page);
        await writeJson(join(CASE_DIR, "B04.json"), {
          before,
          mid,
          beforeAccept,
          beforeFinalContinue,
          after,
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
        const completedDealsBefore = (after.player.completedDealIds || []).length;
        // Require a real attempted duplicate through the production QA seam.
        const dup = await page.evaluate((offer) => {
          const fn = window.__acceptPipelineOffer || window.__acceptTransferOffer;
          if (typeof fn !== "function") return { attempted: false, reason: "missing-accept-seam" };
          return fn(offer);
        }, a.player.pendingOffers[0]);
        assert(dup?.attempted === true, "duplicate accept must be attempted via production seam");
        assert(dup.ok === false, `duplicate accept must reject, got ${JSON.stringify(dup)}`);
        await page.waitForTimeout(200);
        const afterDup = await exportSnap(page);
        assert(afterDup.player.contractEndSeason === endAfter, "duplicate accept must not re-extend");
        assert(afterDup.player.weeklyWage === wageAfter, "duplicate accept must not rebook wage");
        assert(
          (afterDup.player.completedDealIds || []).length === completedDealsBefore,
          "duplicate accept must not add finance transaction id"
        );
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
          beforeFinalContinue: driven.beforeFinalContinue || null,
          final,
          driven,
        });
        await shot(page, "B07-desk");
        return { offerId: a.player.pendingOffers[0].offerId, end: endAfter, dupReason: dup.reason };
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
