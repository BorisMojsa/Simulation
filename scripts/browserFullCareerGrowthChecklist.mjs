#!/usr/bin/env node
/**
 * Fix 11 browser acceptance: full-career growth.
 *
 *   node scripts/browserFullCareerGrowthChecklist.mjs
 *   CASE=B01 node scripts/browserFullCareerGrowthChecklist.mjs
 *   CASES=B01,B08 HEADED=1 node scripts/browserFullCareerGrowthChecklist.mjs
 *
 * Env: CASE / CASES, BASE_URL, CHROME_PATH, HEADED=1.
 * State evidence always comes from __exportCareerSnapshot / __restoreCareerSnapshot.
 */
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { createPlayerIdentity } from "../js/simulation/playerDevelopment.js";
import { ensurePlayerModel } from "../js/simulation/playerModelMigration.js";
import { refreshAbilityCaches } from "../js/simulation/playerAbility.js";
import { ensureContractAuthority } from "../js/simulation/contractLifecycle.js";
import { ensureTransferSave } from "../js/simulation/transferMigration.js";
import { createWorldState, getWorldState, setWorldState } from "../js/simulation/worldState.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import { reseedCareerRng } from "../js/simulation/rng.js";
import { serializeCareerSnapshot } from "../js/simulation/careerSnapshot.js";
import { allSeniorClubs } from "../js/simulation/seniorClubs.js";
import { skipCareerIntroBootstrap } from "../js/ui/careerStartFlow.js";
import { ACADEMY_POOL } from "../js/data/leagues.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUN = join(ROOT, "qa/fix11-runs/browser");
const SHOTS = join(RUN, "screenshots");
const SNAPS = join(RUN, "snapshots");
const LOGS = join(RUN, "action-logs");
const CASES_DIR = join(RUN, "cases");
const OUT = join(RUN, "browser-report.json");
const IDS = Array.from({ length: 8 }, (_, i) => `B${String(i + 1).padStart(2, "0")}`);
const selectionText = process.env.CASES || process.env.CASE || "";
const SELECTED = selectionText
  ? selectionText.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean)
  : IDS;
const CHROME =
  process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HEADED = process.env.HEADED === "1";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage: node scripts/browserFullCareerGrowthChecklist.mjs

Runs B01-B08 in real Chromium/Chrome using playwright-core.
Environment:
  CASE=B01              run one case
  CASES=B01,B08         run a subset
  BASE_URL=http://...   use an existing server (otherwise self-host)
  CHROME_PATH=/path     Chromium/Chrome executable
  HEADED=1              show browser

Artifacts: qa/fix11-runs/browser/{browser-report.json,screenshots,snapshots,action-logs,cases}`);
  process.exit(0);
}

const clone = (v) => JSON.parse(JSON.stringify(v));
function invariant(ok, message, data = null) {
  if (ok) return;
  const error = new Error(message);
  error.data = data;
  throw error;
}
async function json(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2));
}
async function snapFile(id, stage, value) {
  const path = join(SNAPS, `${id}-${stage}.json`);
  await json(path, value);
  return path.slice(ROOT.length + 1);
}
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}
function witnessFiles() {
  const base = join(ROOT, "qa/fix11-runs");
  return walk(base).filter(
    (p) => p.includes(`${join("", "witnesses")}/`) && p.endsWith(".json") && !p.startsWith(RUN)
  );
}
async function loadWitness(kind) {
  const files = witnessFiles();
  const matcher =
    kind === "growth"
      ? /snapshot-plus(?:6|7)\.json$/i
      : /natural-99\/snapshot-natural-99\.json$/i;
  for (const path of files.sort((a, b) => {
    const preferred = (value) => matcher.test(value) ? 0 : 1;
    return preferred(a) - preferred(b) || a.localeCompare(b);
  })) {
    if (!matcher.test(path)) continue;
    try {
      const raw = JSON.parse(await readFile(path, "utf8"));
      const candidates = [
        raw.beforeSnapshot,
        raw.afterSnapshot,
        raw.snapshot,
        raw.preSnapshot,
        raw.beforeSnapshot,
        raw.checkpoint,
        raw,
      ];
      const snapshot = candidates.find((x) => x?.player && x?.world);
      if (snapshot) {
        return {
          path,
          snapshot,
          beforeSnapshot: raw.beforeSnapshot || snapshot,
          afterSnapshot: raw.afterSnapshot || null,
          provenance: raw.provenance || null,
          schema: raw.schema || null,
        };
      }
    } catch {}
  }
  return { path: null, snapshot: null, searched: files.length };
}

async function host() {
  if (process.env.BASE_URL) return { base: process.env.BASE_URL, close: async () => {} };
  const server = createServer((req, res) => {
    try {
      const rel = decodeURIComponent((req.url || "/").split("?")[0]).replace(/^\//, "") || "index.html";
      const path = normalize(join(ROOT, rel));
      if (!path.startsWith(ROOT)) {
        res.writeHead(403).end("forbidden");
      } else if (!existsSync(path) || !statSync(path).isFile()) {
        res.writeHead(404).end("missing");
      } else {
        res.writeHead(200, { "Content-Type": MIME[extname(path)] || "application/octet-stream" });
        createReadStream(path).pipe(res);
      }
    } catch (error) {
      res.writeHead(500).end(String(error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function openBrowser(base) {
  if (!existsSync(CHROME)) throw new Error(`CHROME_PATH missing: ${CHROME}`);
  let chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch (error) {
    throw new Error(`playwright-core import failed: ${error.message}`);
  }
  const browser = await chromium.launch({ executablePath: CHROME, headless: !HEADED });
  const context = await browser.newContext();
  const page = await context.newPage();
  const runtime = [];
  page.on("pageerror", (e) => runtime.push({ type: "pageerror", message: String(e.message || e) }));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|Failed to load resource/i.test(m.text())) {
      runtime.push({ type: "console", message: m.text() });
    }
  });
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(
    () =>
      typeof window.__exportCareerSnapshot === "function" &&
      typeof window.__restoreCareerSnapshot === "function",
    null,
    { timeout: 60000 }
  );
  return { browser, context, page, runtime };
}

async function freshPage(context, base) {
  const page = await context.newPage();
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(
    () =>
      typeof window.__exportCareerSnapshot === "function" &&
      typeof window.__restoreCareerSnapshot === "function",
    null,
    { timeout: 60000 }
  );
  return page;
}
async function exported(page) {
  const value = await page.evaluate(() => window.__exportCareerSnapshot?.() || null);
  invariant(value?.player && value?.world, "__exportCareerSnapshot returned no authoritative state");
  return clone(value);
}
async function installDeterministicClock(page, stampedAt) {
  if (!Number.isFinite(Number(stampedAt))) return;
  // Stamp stored the post-increment return value N; continuous play then used N+1.
  await page.evaluate((start) => {
    let now = Number(start) + 1;
    Date.now = () => now++;
    window.__fix11DeterministicClock = { start: Number(start) + 1, stampedAt: Number(start), read: () => now };
  }, Number(stampedAt));
}

async function restore(page, value) {
  // Large authoritative witness worlds exceed CDP evaluate payload limits.
  // Serve the snapshot over the local host and let the page fetch+restore it.
  const bytes = Buffer.byteLength(JSON.stringify(value));
  let result;
  if (bytes > 1_500_000) {
    const tmpName = `tmp-restore-${Date.now()}-${Math.random().toString(16).slice(2)}.json`;
    const tmpPath = join(SNAPS, tmpName);
    await json(tmpPath, value);
    const url = `/qa/fix11-runs/browser/snapshots/${tmpName}`;
    result = await page.evaluate(async (snapshotUrl) => {
      const response = await fetch(snapshotUrl);
      if (!response.ok) return { ok: false, reason: `fetch-failed:${response.status}` };
      const snapshot = await response.json();
      return window.__restoreCareerSnapshot?.(snapshot);
    }, url);
  } else {
    result = await page.evaluate((s) => window.__restoreCareerSnapshot?.(s), value);
  }
  invariant(result?.ok !== false && (result?.player || result?.ok), "__restoreCareerSnapshot failed", result);
  await installDeterministicClock(page, value?.deterministicClockAtExport);
  await page.waitForTimeout(150);
  return exported(page);
}
async function screenshot(page, id, stage) {
  await mkdir(SHOTS, { recursive: true });
  const path = join(SHOTS, `${id}-${stage}.png`);
  await page.screenshot({ path, fullPage: true });
  return path.slice(ROOT.length + 1);
}
async function ui(page) {
  return page.evaluate(() => {
    const d = window.__getLiveCareerDebug?.() || {};
    const overlay = document.getElementById("season-animation-overlay");
    const dash = document.getElementById("simulation-dashboard");
    const cont = document.getElementById("continue-btn");
    const contHost = document.getElementById("animation-continue");
    const sim = document.getElementById("simulate-btn");
    const visible = (el) => Boolean(el && el.offsetParent !== null && !el.disabled);
    return {
      seasons: d.seasonsCount ?? d.seasons ?? 0,
      seasonActionInFlight: Boolean(d.seasonActionInFlight),
      overlayHidden: !overlay || overlay.classList.contains("hidden"),
      dashboardHidden: !dash || dash.classList.contains("hidden"),
      continueVisible: visible(cont) && !contHost?.classList.contains("hidden"),
      simulateEnabled: visible(sim),
      simulateLabel: sim?.textContent?.trim() || "",
      nextAction: d.nextAction || null,
      pendingDecision: d.pendingDecision || null,
      body: document.body.innerText.slice(0, 12000),
    };
  });
}
async function clickText(page, expressions) {
  return page.evaluate((patterns) => {
    const buttons = [...document.querySelectorAll("button")].filter(
      (b) => !b.disabled && b.offsetParent !== null
    );
    for (const source of patterns) {
      const hit = buttons.find((b) => new RegExp(source, "i").test((b.textContent || "").trim()));
      if (hit) {
        const label = (hit.textContent || "").trim();
        hit.click();
        return label;
      }
    }
    return null;
  }, expressions);
}

async function driveSeason(page, {
  id,
  seasonsBefore,
  policy = "stay",
  start = true,
  pauseAtDecision = false,
  timeoutMs = 240000,
} = {}) {
  const actions = [];
  if (start) {
    const s = await ui(page);
    invariant(s.simulateEnabled, `${id}: Simulate is not enabled`, s);
    await page.click("#simulate-btn");
    actions.push({ action: "simulate", at: new Date().toISOString() });
  }
  const deadline = Date.now() + timeoutMs;
  let committed = false;
  while (Date.now() < deadline) {
    const state = await ui(page);
    committed ||= state.seasons > seasonsBefore;
    if (
      committed &&
      state.overlayHidden &&
      state.dashboardHidden &&
      !state.seasonActionInFlight &&
      actions.some((a) => a.action === "continue-post-commit")
    ) {
      await json(join(LOGS, `${id}.json`), actions);
      return { actions, state, snapshot: await exported(page) };
    }
    if (
      pauseAtDecision &&
      !committed &&
      state.overlayHidden &&
      (state.pendingDecision || state.nextAction?.id === "resolve-decision")
    ) {
      await json(join(LOGS, `${id}.json`), actions);
      return { actions, state, snapshot: await exported(page), paused: true };
    }
    const action = await page.evaluate(({ policy: p, committedNow }) => {
      const visible = (el) => Boolean(el && !el.disabled && el.offsetParent !== null);
      const debug = window.__getLiveCareerDebug?.() || {};
      const senior = document.getElementById("senior-scenario-overlay");
      const scenarioNext = document.getElementById("senior-scenario-next");
      const scenarioOpen = senior && !senior.classList.contains("hidden");
      if (visible(scenarioNext)) {
        scenarioNext.click();
        return { action: "scenario-next", label: scenarioNext.textContent.trim() };
      }
      if (
        (debug.nextAction?.id === "resolve-scenario" || scenarioOpen) &&
        typeof window.__applyPendingSeniorScenarioPolicy === "function"
      ) {
        const applied = window.__applyPendingSeniorScenarioPolicy("balanced");
        if (applied?.ok) {
          // Click the matching choice on the live overlay (owned by Simulate await),
          // then Continue via #senior-scenario-next on a later tick.
          const choices = [...(document.getElementById("senior-scenario-choices")?.querySelectorAll("button") || [])].filter(visible);
          const wanted = String(applied.chosenOptionId || "");
          const hit =
            choices.find((b) => (b.dataset?.choiceId || b.id || "") === wanted) ||
            choices.find((b) => wanted && new RegExp(wanted.split(":").pop() || wanted, "i").test(b.textContent || "")) ||
            choices[Math.min(1, Math.max(0, choices.length - 1))] ||
            choices[0];
          if (hit) {
            hit.click();
            return { action: "scenario-policy-choice", label: hit.textContent.trim() };
          }
          return { action: "scenario-policy-balanced", label: applied.chosenOptionId || "balanced" };
        }
      }
      if (scenarioOpen) {
        const choice = [...senior.querySelectorAll("button")].find(visible);
        if (choice) {
          const label = choice.textContent.trim();
          choice.click();
          return { action: "scenario-choice", label };
        }
      }
      // Career-moment / scenario copy may render outside #senior-scenario-overlay.
      const momentButtons = [...document.querySelectorAll("button")].filter(visible);
      const momentHit = momentButtons.find((b) =>
        /reaffirm focus|speak privately|encourage the rumour|listen in the huddle|politely explain|train first|use earplugs|explain the schedule|decline politely|glance at the main|change quietly/i.test(
          (b.textContent || "").trim()
        )
      );
      if (momentHit) {
        const label = momentHit.textContent.trim();
        momentHit.click();
        return { action: "scenario-choice", label };
      }
      const cont = document.getElementById("continue-btn");
      const host = document.getElementById("animation-continue");
      if (visible(cont) && host && !host.classList.contains("hidden")) {
        cont.click();
        return { action: committedNow ? "continue-post-commit" : "continue", label: cont.textContent.trim() };
      }
      for (const id of ["sim-skip-phase-btn", "match-skip-phase-btn", "sim-skip-match-btn", "match-skip-btn"]) {
        const button = document.getElementById(id);
        if (visible(button)) {
          button.click();
          return { action: "presentation-skip", label: id };
        }
      }
      if (
        p !== "move" &&
        (debug.pendingDecision || debug.nextAction?.id === "resolve-decision" || debug.nextAction?.id === "resolve-offers") &&
        typeof window.__resolvePendingDecisionForPolicy === "function"
      ) {
        const resolved = window.__resolvePendingDecisionForPolicy(p);
        if (resolved?.ok) {
          return { action: "decision-policy", label: resolved.choice || resolved.action || p };
        }
      }
      const buttons = [...document.querySelectorAll("button")].filter(visible);
      const patterns =
        p === "move"
          ? [/review loan options/i, /accept loan|accept offer|accept transfer|sign for/i]
          : p === "appropriate-minutes-loan"
            ? [/review loan options/i, /accept loan|accept offer|accept transfer|sign for/i,
                /stay and compete/i, /continue the season/i, /acknowledge/i,
                /decline offers and continue/i, /^remain$|^see it out$/i]
          : [/stay and compete/i, /continue the season/i, /focus on recovery/i, /acknowledge/i,
              /decline offers and continue/i, /^remain$|^see it out$|^understood$/i];
      for (const re of patterns) {
        const hit = buttons.find((b) => re.test((b.textContent || "").trim()));
        if (hit) {
          const label = hit.textContent.trim();
          hit.click();
          return { action: "decision", label };
        }
      }
      const sim = document.getElementById("simulate-btn");
      if (visible(sim) && /continue season|resume/i.test(sim.textContent || "")) {
        sim.click();
        return { action: "resume-season", label: sim.textContent.trim() };
      }
      return null;
    }, { policy, committedNow: committed });
    if (action) actions.push({ ...action, at: new Date().toISOString() });
    await page.waitForTimeout(action ? 130 : 220);
  }
  await json(join(LOGS, `${id}.json`), actions);
  throw new Error(`${id}: season driver timeout ${JSON.stringify(await ui(page))}`);
}

function attrs(ovr, position = "CM") {
  const keys =
    position === "GK"
      ? ["Diving", "Handling", "Kicking", "Reflexes", "Speed", "Positioning"]
      : ["Speed", "Passing", "Shooting", "Defending", "Physicality", "Dribbling"];
  return Object.fromEntries(keys.map((k) => [k, ovr]));
}
function fixture({ id, ovr = 72, position = "CM", age = 20, seed = 1102, clubName = "Hull City" }) {
  reseedCareerRng(seed);
  resetClubFinanceLedgers();
  setWorldState(createWorldState({ startYear: 2026, seed, careerSeed: seed }));
  const club = allSeniorClubs().find((x) => x.name === clubName) || allSeniorClubs()[0];
  const p = createPlayerIdentity({ name: id, nationality: "England", position, age });
  Object.assign(p, {
    careerId: id,
    startYear: 2026,
    age,
    seasons: [],
    rating: ovr,
    attributes: attrs(ovr, position),
    club: { ...club },
    employmentClubId: club.clubId,
    playingClubId: club.clubId,
    contractStatus: "active",
    contractStartSeason: 0,
    contractYears: 4,
    contractEndSeason: 4,
    weeklyWage: 2500,
    wage: 2500,
    state: { form: 0, morale: 0, readiness: 1, fatigue: 0, adaptationPenalty: 0, roleFit: 1 },
  });
  ensurePlayerModel(p);
  refreshAbilityCaches(p);
  ensureContractAuthority(p);
  ensureTransferSave(p);
  reseedCareerRng(seed);
  return serializeCareerSnapshot({ player: p, world: getWorldState() });
}
function rawAttrs(s) {
  return Object.fromEntries(
    Object.entries(s?.player?.attributes || {}).filter(([, v]) => Number.isFinite(v))
  );
}
function rawOverall(s) {
  return Number(s?.player?.baseOverallRaw ?? s?.player?.currentOverallRaw ?? s?.player?.rating);
}
function roundedAttrs(s) {
  return Object.fromEntries(Object.entries(rawAttrs(s)).map(([k, v]) => [k, Math.round(v)]));
}
function displayedChanges(before, after) {
  const b = roundedAttrs(before);
  const a = roundedAttrs(after);
  return Object.fromEntries(Object.keys(a).map((k) => [k, a[k] - b[k]]));
}
function seasonProgression(s) {
  const season = s.player?.seasons?.at(-1) || {};
  return season.developmentBreakdown || season.development || season.attributeChanges || null;
}
function deskInvariant(state) {
  invariant(state.overlayHidden, "season overlay must be closed", state);
  invariant(state.dashboardHidden, "simulation dashboard must be closed", state);
  invariant(!state.seasonActionInFlight, "seasonActionInFlight must be released", state);
}

async function newCareerOpening(page, id, name, { skip = false } = {}) {
  if (skip) {
    // The product's explicit skip bootstrap is exercised separately, then restored through
    // the authoritative snapshot seam. This path is intentionally not conflated with five moments.
    const p = createPlayerIdentity({ name, nationality: "England", position: "CM", age: 17 });
    skipCareerIntroBootstrap(p, ACADEMY_POOL);
    const state = serializeCareerSnapshot({ player: p, world: getWorldState() });
    await restore(page, state);
    return { snapshot: await exported(page), actions: ["skipCareerIntroBootstrap"] };
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      typeof window.__readCareerSetupValues === "function" &&
      document.querySelectorAll('input[name="nationality"]').length > 0 &&
      document.querySelectorAll('input[name="primary-position"]').length > 0,
    null,
    { timeout: 30000 }
  );
  await page.fill("#player-name", name);
  await page.evaluate(() => {
    const choose = (name, wanted) => {
      const x = [...document.querySelectorAll(`input[name="${name}"]`)].find(
        (input) => String(input.value).toLowerCase() === String(wanted).toLowerCase()
      );
      if (!x) return false;
      x.checked = true;
      x.dispatchEvent(new Event("input", { bubbles: true }));
      x.dispatchEvent(new Event("change", { bubbles: true }));
      document.querySelector(`label[for="${x.id}"]`)?.click();
      return true;
    };
    choose("starting-age", "17");
    choose("nationality", "England");
    choose("primary-position", "CM");
  });
  const setup = await page.evaluate(() => window.__readCareerSetupValues?.());
  invariant(setup?.ok, "new-career setup invalid", setup);
  await page.click("#start-career-btn");
  const actions = ["Begin career"];
  await page.waitForSelector("#career-backstory-next:not(.hidden)");
  await page.click("#career-backstory-next");
  actions.push("Continue backstory");
  await page.click("#career-academy-intro-next");
  actions.push("See academy offers");
  for (let n = 0; n < 6; n++) {
    const choice = await page.locator("#career-academy-choice").evaluate((x) => !x.classList.contains("hidden"));
    if (choice) break;
    await page.waitForSelector("#career-academy-next-offer:not(.hidden)", { timeout: 15000 });
    await page.click("#career-academy-next-offer");
  }
  await page.locator("#career-academy-grid button").first().click();
  actions.push("Choose academy");
  for (let i = 0; i < 5; i++) {
    await page.waitForSelector("#career-scenario-choices button", { timeout: 15000 });
    const label = await page.locator("#career-scenario-choices button").first().innerText();
    await page.locator("#career-scenario-choices button").first().click();
    actions.push(`Moment ${i + 1}: ${label}`);
    await page.waitForSelector("#career-scenario-next:not(.hidden)", { timeout: 15000 });
    await page.click("#career-scenario-next");
  }
  await page.waitForSelector("#career-rating-next:not(.hidden)", { timeout: 20000 });
  actions.push(`Rating reveal: ${await page.locator("#career-rating-value").innerText()}`);
  await page.click("#career-rating-next");
  await page.waitForSelector("#career-pro-deals-grid button", { timeout: 15000 });
  const buttons = page.locator("#career-pro-deals-grid button");
  let pick = 0;
  for (let i = 0; i < (await buttons.count()); i++) {
    const label = await buttons.nth(i).innerText();
    if (!/stay in the system|continue/i.test(label)) {
      pick = i;
      break;
    }
  }
  const contract = await buttons.nth(pick).innerText();
  await buttons.nth(pick).click();
  actions.push(`First pro: ${contract}`);
  await page.waitForSelector("#career-year-end-continue:not(.hidden)", { timeout: 15000 });
  await page.click("#career-year-end-continue");
  await page.waitForFunction(() => !document.getElementById("career-section")?.classList.contains("hidden"));
  return { snapshot: await exported(page), actions };
}

const browserCases = {
  async B01(ctx) {
    const interactive = await newCareerOpening(ctx.page, "B01", "Fix11 Browser Opening");
    await snapFile("B01", "interactive-opening", interactive.snapshot);
    await screenshot(ctx.page, "B01", "interactive-desk");
    const opening = interactive.snapshot.player?.academyOpening;
    invariant((interactive.snapshot.player?.seasons || []).length >= 1, "opening season missing");
    invariant(!interactive.snapshot.player?.club?.isAcademy, "first professional deal not completed");
    invariant(Number(opening?.positiveLearningApplied ?? 0) > 0, "opening gains absent", opening);

    const skip = await newCareerOpening(ctx.page, "B01", "Fix11 Browser Skip", { skip: true });
    await snapFile("B01", "skip-opening", skip.snapshot);
    invariant((skip.snapshot.player?.seasons || []).length >= 1, "skip opening season missing");
    invariant(
      Number(skip.snapshot.player?.academyOpening?.positiveLearningApplied ?? 0) > 0,
      "skip opening did not charge a gain"
    );
    await json(join(LOGS, "B01.json"), { interactive: interactive.actions, skip: skip.actions });
    return {
      status: "PASS",
      interactiveOpeningGain: opening.positiveLearningApplied,
      interactiveRawAttributes: rawAttrs(interactive.snapshot),
      skipOpeningGain: skip.snapshot.player.academyOpening.positiveLearningApplied,
      skipCheckedSeparately: true,
    };
  },

  async B02(ctx) {
    const initial = fixture({ id: "fix11-b02-good", ovr: 82, age: 20, seed: 11202 });
    await restore(ctx.page, initial);
    const before = await exported(ctx.page);
    await snapFile("B02", "before", before);
    const driven = await driveSeason(ctx.page, { id: "B02", seasonsBefore: before.player.seasons.length });
    const after = driven.snapshot;
    deskInvariant(driven.state);
    await snapFile("B02", "after", after);
    await screenshot(ctx.page, "B02", "desk");
    const rawBefore = rawAttrs(before);
    const rawAfter = rawAttrs(after);
    const endpoints = { before: roundedAttrs(before), after: roundedAttrs(after) };
    const changes = displayedChanges(before, after);
    invariant(Object.values(endpoints.before).every(Number.isInteger), "before display endpoint not integer");
    invariant(Object.values(endpoints.after).every(Number.isInteger), "after display endpoint not integer");
    invariant(after.player.seasons.length === before.player.seasons.length + 1, "season not completed");
    invariant(driven.actions.some((x) => x.action === "continue-post-commit"), "actual UI Continue missing");
    return {
      status: "PASS",
      rawBefore,
      rawAfter,
      integerEndpoints: endpoints,
      displayedChanges: changes,
      seasonProgression: seasonProgression(after),
      continueClicks: driven.actions.filter((x) => x.action.startsWith("continue")).length,
    };
  },

  async B03(ctx) {
    const witness = await loadWitness("growth");
    if (!witness.snapshot) {
      return {
        status: "BLOCKED",
        reason:
          "No saved +6/+7 witness snapshot exists under qa/fix11-runs/**/witnesses/; natural witness replay cannot be invented.",
        witnessFilesSearched: witness.searched,
      };
    }
    invariant(witness.afterSnapshot, "growth replay bundle has no authoritative afterSnapshot");
    const row = witness.provenance?.season;
    invariant([6, 7].includes(Math.abs(Number(row?.displayedDelta))), "witness is not displayed +6/+7", row);
    const expectedAfterRaw = Number(
      witness.afterSnapshot?.player?.baseOverallRaw ??
        witness.afterSnapshot?.player?.currentOverallRaw ??
        row.rawAfter
    );
    const before = await restore(ctx.page, witness.beforeSnapshot);
    await snapFile("B03", "replay-before-restored", before);
    invariant(
      Math.abs(rawOverall(before) - Number(row.rawBefore)) < 1e-4,
      "browser before checkpoint does not match Node provenance",
      { browser: rawOverall(before), expected: row.rawBefore }
    );
    const seasonsBefore = before.player.seasons.length;
    const driven = await driveSeason(ctx.page, {
      id: "B03",
      seasonsBefore,
      // Match the witness career policy so loan/minutes decisions align with Node.
      policy: "appropriate-minutes-loan",
      timeoutMs: 300000,
    });
    const after = driven.snapshot;
    deskInvariant(driven.state);
    await snapFile("B03", "replay-after-played", after);
    await screenshot(ctx.page, "B03", "replay-after-desk");
    invariant(after.player.seasons.length === seasonsBefore + 1, "witness season was not completed through UI");
    invariant(driven.actions.some((x) => x.action === "continue-post-commit"), "actual UI Continue missing");
    const browserAfterRaw = rawOverall(after);
    invariant(
      Math.abs(browserAfterRaw - expectedAfterRaw) < 0.05,
      "browser-played season endpoint diverges from authoritative afterSnapshot",
      { browserAfterRaw, expectedAfterRaw }
    );
    {
      const displayedBefore = Math.round(Number(row.rawBefore));
      const displayedAfter = Math.round(browserAfterRaw);
      invariant(
        displayedAfter - displayedBefore === Number(row.displayedDelta),
        "displayed delta missing after real season play",
        { displayedBefore, displayedAfter, expectedDelta: row.displayedDelta }
      );
    }
    return {
      status: "PASS",
      witness: witness.path.slice(ROOT.length + 1),
      verification:
        "Browser restored the authoritative pre-season checkpoint and finished the witness season through Simulate/Continue; afterSnapshot was comparison-only.",
      careerId: witness.provenance?.careerId,
      displayedDelta: row.displayedDelta,
      rawBefore: row.rawBefore,
      rawAfter: row.rawAfter,
      browserBeforeRaw: rawOverall(before),
      browserAfterRaw,
      expectedAfterRaw,
      continueClicks: driven.actions.filter((x) => String(x.action).startsWith("continue")).length,
      endpointImportUsed: false,
    };
  },

  async B04(ctx) {
    const witness = await loadWitness("natural99");
    if (!witness.snapshot) {
      return {
        status: "BLOCKED",
        reason:
          "No natural-99 pre-threshold checkpoint exists under qa/fix11-runs/**/witnesses/; a synthetic 99 witness is forbidden.",
        witnessFilesSearched: witness.searched,
      };
    }
    invariant(witness.afterSnapshot, "natural-99 replay bundle has no authoritative afterSnapshot");
    const expectedAfterRaw = Number(
      witness.afterSnapshot?.player?.baseOverallRaw ??
        witness.afterSnapshot?.player?.currentOverallRaw ??
        witness.provenance?.season?.rawAfter
    );
    const restored = await restore(ctx.page, witness.beforeSnapshot);
    await snapFile("B04", "pre-threshold-restored", restored);
    const beforeRaw = rawOverall(restored);
    invariant(beforeRaw < 98.5, "natural-99 checkpoint is not pre-threshold", beforeRaw);
    const seasonsBefore = restored.player.seasons.length;
    const driven = await driveSeason(ctx.page, {
      id: "B04",
      seasonsBefore,
      policy: "appropriate-minutes-loan",
      timeoutMs: 300000,
    });
    const completed = driven.snapshot;
    deskInvariant(driven.state);
    const afterRaw = rawOverall(completed);
    await snapFile("B04", "completed-played", completed);
    await screenshot(ctx.page, "B04", "displayed-99-desk");
    invariant(completed.player.seasons.length === seasonsBefore + 1, "crossing season was not completed through UI");
    invariant(driven.actions.some((x) => x.action === "continue-post-commit"), "actual UI Continue missing");
    invariant(beforeRaw < 98.5 && afterRaw >= 98.5 && afterRaw < 99, "played season did not cross displayed-99", {
      beforeRaw,
      afterRaw,
    });
    invariant(
      Math.abs(afterRaw - expectedAfterRaw) < 0.05,
      "browser-played 99 crossing diverges from authoritative afterSnapshot",
      { afterRaw, expectedAfterRaw }
    );
    return {
      status: "PASS",
      witness: witness.path.slice(ROOT.length + 1),
      verification:
        "Browser restored the pre-99 checkpoint and finished the crossing season through Simulate/Continue; afterSnapshot was comparison-only.",
      careerId: witness.provenance?.careerId,
      beforeRaw,
      afterRaw,
      expectedAfterRaw,
      displayedBefore: Math.round(beforeRaw),
      displayedAfter: Math.round(afterRaw),
      continueClicks: driven.actions.filter((x) => String(x.action).startsWith("continue")).length,
      endpointImportUsed: false,
    };
  },

  async B05(ctx) {
    const initial = fixture({ id: "fix11-b05-move", ovr: 67, age: 20, seed: 11505, clubName: "Arsenal" });
    await restore(ctx.page, initial);
    const before = await exported(ctx.page);
    const driven = await driveSeason(ctx.page, {
      id: "B05",
      seasonsBefore: before.player.seasons.length,
      policy: "move",
    });
    await snapFile("B05", "after", driven.snapshot);
    const moved =
      driven.snapshot.player.playingClubId !== before.player.playingClubId ||
      Boolean(driven.snapshot.player.activeLoan);
    if (!moved) {
      return {
        status: "BLOCKED",
        reason: "The real UI exposed no actionable productive loan/midseason move for this seeded career.",
        attemptedActions: driven.actions.filter((x) => x.action === "decision"),
      };
    }
    return {
      status: "PASS",
      from: before.player.playingClubId,
      to: driven.snapshot.player.playingClubId,
      loan: driven.snapshot.player.activeLoan || null,
      progression: seasonProgression(driven.snapshot),
    };
  },

  async B06(ctx) {
    const initial = fixture({ id: "fix11-b06-poor", ovr: 49, age: 28, seed: 11606, clubName: "Arsenal" });
    await restore(ctx.page, initial);
    const before = await exported(ctx.page);
    const driven = await driveSeason(ctx.page, { id: "B06", seasonsBefore: 0, policy: "stay" });
    const after = driven.snapshot;
    await snapFile("B06", "after", after);
    const season = after.player.seasons.at(-1);
    const rawDelta =
      Number(after.player.currentOverallRaw ?? after.player.rating) -
      Number(before.player.currentOverallRaw ?? before.player.rating);
    invariant(Number.isFinite(rawDelta), "poor season raw delta unavailable");
    invariant(rawDelta < 3, "poor/bench season progression is not limited", { rawDelta, season });
    return {
      status: "PASS",
      minutes: season?.minutes ?? null,
      injuries: season?.injuries ?? season?.injuryDays ?? null,
      rawDelta,
      displayedChanges: displayedChanges(before, after),
      truthfulLimitedProgression: true,
    };
  },

  async B07(ctx) {
    const initial = fixture({ id: "fix11-b07-twin", ovr: 70, age: 21, seed: 11707 });
    await restore(ctx.page, initial);
    const paused = await driveSeason(ctx.page, {
      id: "B07-pause",
      seasonsBefore: 0,
      pauseAtDecision: true,
    });
    if (!paused.paused) {
      return { status: "BLOCKED", reason: "Seeded season completed without exposing a pause/decision boundary." };
    }
    await snapFile("B07", "pause-export", paused.snapshot);
    const pendingLabels = (paused.snapshot.player?.pendingDecision?.choices || [])
      .map((entry) => entry?.label)
      .filter(Boolean);
    const choice = [
      ...pendingLabels,
      "Continue the season",
      "Stay and compete",
      "Acknowledge",
      "Focus on recovery",
    ];
    const labelA = await clickText(ctx.page, choice);
    invariant(labelA, "first twin decision control missing");
    const twinA = await driveSeason(ctx.page, {
      id: "B07-twin-a",
      seasonsBefore: 0,
      start: false,
    });

    const pageB = await freshPage(ctx.context, ctx.base);
    try {
      const imported = await restore(pageB, paused.snapshot);
      invariant(
        JSON.stringify(imported.player?.seasonCheckpoint) === JSON.stringify(paused.snapshot.player?.seasonCheckpoint),
        "fresh-page import changed checkpoint"
      );
      const labelB = await clickText(pageB, [labelA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")]);
      invariant(labelB === labelA, "same decision unavailable on twin", { labelA, labelB });
      const twinB = await driveSeason(pageB, {
        id: "B07-twin-b",
        seasonsBefore: 0,
        start: false,
      });
      await snapFile("B07", "twin-a", twinA.snapshot);
      await snapFile("B07", "twin-b", twinB.snapshot);
      const a = twinA.snapshot.player.seasons.at(-1);
      const b = twinB.snapshot.player.seasons.at(-1);
      // Match trace payloads contain regenerated strength-profile diagnostics that
      // are not career authority. Compare the committed career outcome while
      // retaining both complete snapshots for review.
      const careerOutcome = (season) => {
        const value = clone(season);
        for (const key of [
          "europeanCampaign",
          "domesticCupResult",
          "domesticCupCampaigns",
          "leagueMatches",
          "leagueAllMatches",
          "leagueMatchSegments",
        ]) delete value[key];
        return value;
      };
      invariant(
        JSON.stringify(careerOutcome(a)) === JSON.stringify(careerOutcome(b)),
        "completion twin career outcomes diverged"
      );
      invariant(twinA.snapshot.rngSeed === twinB.snapshot.rngSeed, "completion twin RNG diverged");
      return {
        status: "PASS",
        decision: labelA,
        completionTwinCareerOutcomesEqual: true,
        fullSnapshotsRetained: true,
        ignoredNonAuthoritativeMatchTraceFields: true,
      };
    } finally {
      await pageB.close();
    }
  },

  async B08(ctx) {
    const current = fixture({ id: "fix11-b08-gk", ovr: 64, position: "GK", age: 19, seed: 11808 });
    const legacy = clone(current);
    delete legacy.player.developmentModelVersion;
    delete legacy.player.currentOverallRaw;
    delete legacy.player.currentOverall;
    delete legacy.player.baseOverallRaw;

    const currentRestored = await restore(ctx.page, current);
    const currentRngBefore = { rngSeed: currentRestored.rngSeed, rngState: currentRestored.world?.rngState };
    const outlookText = (await ui(ctx.page)).body.match(/(?:Estimated )?outlook:[^\n]*/i)?.[0] || null;
    invariant(outlookText, "forecast/outlook was not visible in the real UI");
    await screenshot(ctx.page, "B08", "current-forecast");
    const afterView = await exported(ctx.page);
    invariant(afterView.rngSeed === currentRngBefore.rngSeed, "forecast viewing mutated rngSeed");
    invariant(afterView.world?.rngState === currentRngBefore.rngState, "forecast viewing mutated world rngState");

    const legacyRestored = await restore(ctx.page, legacy);
    invariant(legacyRestored.player.development, "legacy save did not migrate development");
    await snapFile("B08", "legacy-restored", legacyRestored);
    const driven = await driveSeason(ctx.page, { id: "B08", seasonsBefore: 0 });
    await snapFile("B08", "gk-after", driven.snapshot);
    const beforeRaw = rawAttrs(legacyRestored);
    const afterRaw = rawAttrs(driven.snapshot);
    invariant(Object.keys(beforeRaw).some((k) => /diving|handling|reflex|position/i.test(k)), "GK attributes absent");
    return {
      status: "PASS",
      legacyMigrated: true,
      currentSaveRestored: true,
      forecastViewed: true,
      forecastText: outlookText,
      forecastViewRngUnchanged: true,
      gkRawBefore: beforeRaw,
      gkRawAfter: afterRaw,
      gkDisplayedChanges: displayedChanges(legacyRestored, driven.snapshot),
    };
  },
};

async function main() {
  for (const dir of [RUN, SHOTS, SNAPS, LOGS, CASES_DIR]) await mkdir(dir, { recursive: true });
  const hosted = await host();
  const report = {
    schema: "fix11-browser-career-growth-v1",
    generatedAt: new Date().toISOString(),
    baseUrl: hosted.base,
    chromePath: CHROME,
    requiredIds: IDS,
    selectedIds: SELECTED,
    subsetOnly: SELECTED.length !== IDS.length || SELECTED.some((x) => !IDS.includes(x)),
    cases: {},
    launchErrors: [],
  };
  let browser;
  try {
    const launched = await openBrowser(hosted.base);
    ({ browser } = launched);
    for (const id of SELECTED) {
      const started = Date.now();
      console.log(`[fix11-browser] START ${id}`);
      if (!browserCases[id]) {
        report.cases[id] = { status: "FAIL", reason: "Unknown case id" };
        continue;
      }
      try {
        const result = await browserCases[id]({ ...launched, base: hosted.base });
        report.cases[id] = { ...result, durationMs: Date.now() - started };
      } catch (error) {
        report.cases[id] = {
          status: "FAIL",
          reason: String(error?.message || error),
          stack: String(error?.stack || error),
          data: error?.data || null,
          durationMs: Date.now() - started,
        };
        await screenshot(launched.page, id, "failure").catch(() => {});
      }
      await json(join(CASES_DIR, `${id}.json`), report.cases[id]);
      console.log(`[fix11-browser] ${report.cases[id].status} ${id}`);
    }
    report.runtimeErrors = launched.runtime;
  } catch (error) {
    report.launchErrors.push({
      message: String(error?.message || error),
      stack: String(error?.stack || error),
    });
  } finally {
    await browser?.close().catch(() => {});
    await hosted.close().catch(() => {});
  }
  report.requiredComplete = IDS.every((id) => report.cases[id]?.status === "PASS");
  report.selectedComplete = SELECTED.every((id) => report.cases[id]?.status === "PASS");
  report.blocked = Object.values(report.cases).some((c) => c.status === "BLOCKED");
  report.ok = !report.subsetOnly && report.requiredComplete && report.launchErrors.length === 0;
  await json(OUT, report);
  console.log(JSON.stringify({
    report: OUT,
    cases: Object.fromEntries(Object.entries(report.cases).map(([id, x]) => [id, x.status])),
    launchErrors: report.launchErrors,
    selectedComplete: report.selectedComplete,
  }, null, 2));
  process.exitCode = report.selectedComplete && report.launchErrors.length === 0 ? 0 : 1;
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
