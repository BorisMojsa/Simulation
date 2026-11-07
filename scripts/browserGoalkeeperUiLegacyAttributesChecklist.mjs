#!/usr/bin/env node
/**
 * Fix 13 real-browser acceptance (B01–B05).
 *
 *   CHROME_PATH=... node scripts/browserGoalkeeperUiLegacyAttributesChecklist.mjs
 *   CASES=B02,B03 node scripts/browserGoalkeeperUiLegacyAttributesChecklist.mjs
 */
import { createReadStream, existsSync, readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  buildFix13AliasGkSnapshot,
  buildFix13ModernGkSnapshot,
  buildFix13OutfieldOnlyLegacyGkSnapshot,
  buildFix13OutfieldSnapshot,
  buildFix13PartialV3GkSnapshot,
  GK_ATTRIBUTE_KEYS,
} from "../js/simulation/fix13GoalkeeperBrowserFixtures.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUN = join(ROOT, "qa/fix13-runs/browser");
const SHOTS = join(RUN, "screenshots");
const CASES = join(RUN, "cases");
const FIX = join(ROOT, "qa/fix13-runs/final/fixtures");
const OUT = join(RUN, "browser-report.json");
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HEADED = process.env.HEADED === "1";
const IDS = ["B01", "B02", "B03", "B04", "B05"];
const SELECTED = (process.env.CASES || process.env.CASE || IDS.join(","))
  .split(",")
  .map((x) => x.trim().toUpperCase())
  .filter(Boolean);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
const OUTFIELD_KEYS = ["Speed", "Passing", "Shooting", "Defending", "Physicality", "Dribbling"];

function assert(cond, msg, data) {
  if (!cond) {
    const err = new Error(msg);
    err.data = data;
    throw err;
  }
}

async function json(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2));
}

function writeFixtures() {
  mkdirSync(FIX, { recursive: true });
  const modern = buildFix13ModernGkSnapshot();
  const legacy = buildFix13OutfieldOnlyLegacyGkSnapshot();
  const partial = buildFix13PartialV3GkSnapshot();
  const alias = buildFix13AliasGkSnapshot();
  const outfield = buildFix13OutfieldSnapshot();
  writeFileSync(join(FIX, "modern-gk.json"), JSON.stringify(modern));
  writeFileSync(join(FIX, "legacy-outfield-only-gk.json"), JSON.stringify(legacy));
  writeFileSync(join(FIX, "partial-v3-gk.json"), JSON.stringify(partial));
  writeFileSync(join(FIX, "alias-gk.json"), JSON.stringify(alias));
  writeFileSync(join(FIX, "outfield.json"), JSON.stringify(outfield));
  return { modern, legacy, partial, alias, outfield };
}

async function hostFixed() {
  if (process.env.BASE_URL) return { base: process.env.BASE_URL, close: async () => {} };
  const server = createServer((req, res) => {
    try {
      const rel = decodeURIComponent((req.url || "/").split("?")[0]).replace(/^\//, "") || "index.html";
      const path = normalize(join(ROOT, rel));
      if (!path.startsWith(ROOT)) res.writeHead(403).end("forbidden");
      else if (!existsSync(path) || !statSync(path).isFile()) res.writeHead(404).end("missing");
      else {
        res.writeHead(200, { "Content-Type": MIME[extname(path)] || "application/octet-stream" });
        createReadStream(path).pipe(res);
      }
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

async function openBrowser() {
  assert(existsSync(CHROME), `CHROME_PATH missing: ${CHROME}`);
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: CHROME, headless: !HEADED });
  return { browser };
}

async function openCasePage(browser, base, runtime) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => runtime.push({ type: "pageerror", message: String(e.message || e) }));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|Failed to load resource/i.test(m.text())) {
      runtime.push({ type: "console", message: m.text() });
    }
  });
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(
    () => typeof window.__restoreCareerSnapshot === "function" && typeof window.__exportCareerSnapshot === "function",
    null,
    { timeout: 60000 }
  );
  return { context, page };
}

async function shot(page, name) {
  await mkdir(SHOTS, { recursive: true });
  const path = join(SHOTS, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  return path.slice(ROOT.length + 1);
}

async function restore(page, snap) {
  const result = await page.evaluate((s) => window.__restoreCareerSnapshot(s), snap);
  assert(result?.ok, "restore failed", result);
  await page.waitForTimeout(120);
  return result;
}

async function readOverviewMetrics(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll(".player-metrics .metric")].map((el) => ({
      label: el.querySelector(".label")?.textContent?.trim() || "",
      value: el.querySelector(".value")?.textContent?.trim() || "",
    }));
    return {
      rows,
      labels: rows.map((r) => r.label),
      values: rows.map((r) => r.value),
      text: document.getElementById("player-overview")?.innerText || "",
    };
  });
}

async function exportPlayer(page) {
  return page.evaluate(() => window.__exportCareerSnapshot?.()?.player || null);
}

async function clickProductionContinue(page) {
  return page.evaluate(() => {
    const section = document.getElementById("animation-continue");
    const btn = document.getElementById("continue-btn");
    if (!section || section.classList.contains("hidden")) return { clicked: false };
    if (!btn || btn.disabled || btn.offsetParent === null) return { clicked: false };
    btn.click();
    return { clicked: true };
  });
}

async function driveSeasonToDesk(page, { timeoutMs = 240000 } = {}) {
  const beforeSeasons = await page.evaluate(() => window.__exportCareerSnapshot?.()?.player?.seasons?.length || 0);
  await page.click("#simulate-btn");
  const deadline = Date.now() + timeoutMs;
  let continueClicks = 0;
  let summaryLabels = null;
  let summaryItems = null;
  let endpointWitness = null;
  let sawCommit = false;
  while (Date.now() < deadline) {
    const ui = await page.evaluate(() => {
      const visible = (el) => Boolean(el && !el.disabled && el.offsetParent !== null);
      const overlay = document.getElementById("season-animation-overlay");
      const dash = document.getElementById("simulation-dashboard");
      const summary = document.getElementById("summary-animation");
      const cont = document.getElementById("continue-btn");
      const contHost = document.getElementById("animation-continue");
      const d = window.__getLiveCareerDebug?.() || {};
      const p = window.__exportCareerSnapshot?.()?.player || null;
      const baselines = p?.development?.seasonStartBaseline || {};
      const baselineKeys = Object.keys(baselines);
      const baseline = baselineKeys.length ? baselines[baselineKeys[baselineKeys.length - 1]] : null;
      const items = [...document.querySelectorAll("#rating-changes-grid .rating-item")].map((el) => ({
        label: el.querySelector(".rating-name")?.textContent?.trim() || "",
        delta: el.querySelector(".rating-change")?.textContent?.trim() || "",
        value: el.querySelector(".rating-new")?.textContent?.trim() || "",
        polarity: el.classList.contains("positive")
          ? "positive"
          : el.classList.contains("negative")
            ? "negative"
            : "neutral",
      }));
      return {
        overlayHidden: !overlay || overlay.classList.contains("hidden"),
        dashboardHidden: !dash || dash.classList.contains("hidden") || !dash.classList.contains("active"),
        summaryVisible: Boolean(summary && !summary.classList.contains("hidden") && summary.classList.contains("active")),
        continueVisible: visible(cont) && contHost && !contHost.classList.contains("hidden"),
        seasonActionInFlight: Boolean(d.seasonActionInFlight),
        seasons: p?.seasons?.length || 0,
        nextAction: d.nextAction || null,
        items,
        baselineAttributes: baseline?.attributes || null,
        endAttributes: p?.attributes ? { ...p.attributes } : null,
      };
    });
    if (ui.summaryVisible && ui.items?.length) {
      summaryItems = ui.items;
      summaryLabels = ui.items.map((i) => i.label);
      endpointWitness = {
        baselineAttributes: ui.baselineAttributes,
        endAttributes: ui.endAttributes,
      };
    }
    sawCommit ||= ui.seasons > beforeSeasons;
    if (
      sawCommit &&
      ui.overlayHidden &&
      ui.dashboardHidden &&
      ui.seasonActionInFlight === false &&
      continueClicks > 0
    ) {
      return {
        continueClosed: true,
        continueClicks,
        summaryLabels,
        summaryItems,
        endpointWitness,
        seasonsBefore: beforeSeasons,
        seasonsAfter: ui.seasons,
        seasonActionInFlight: false,
      };
    }

    const action = await page.evaluate(() => {
      const visible = (el) => Boolean(el && !el.disabled && el.offsetParent !== null);
      const debug = window.__getLiveCareerDebug?.() || {};
      const senior = document.getElementById("senior-scenario-overlay");
      const scenarioNext = document.getElementById("senior-scenario-next");
      const scenarioOpen = senior && !senior.classList.contains("hidden");
      if (visible(scenarioNext)) {
        scenarioNext.click();
        return "scenario-next";
      }
      if (
        (debug.nextAction?.id === "resolve-scenario" ||
          debug.seasonCheckpoint === "awaiting_scenario" ||
          scenarioOpen) &&
        typeof window.__applyPendingSeniorScenarioPolicy === "function"
      ) {
        const applied = window.__applyPendingSeniorScenarioPolicy("balanced");
        if (applied?.ok) {
          const choices = [
            ...(document.getElementById("senior-scenario-choices")?.querySelectorAll("button") || []),
          ].filter(visible);
          const wanted = String(applied.chosenOptionId || "");
          const hit =
            choices.find((b) => (b.dataset?.choiceId || b.id || "") === wanted) ||
            choices[Math.min(1, Math.max(0, choices.length - 1))] ||
            choices[0];
          if (hit) {
            hit.click();
            return `scenario-choice:${hit.textContent.trim()}`;
          }
          return "scenario-policy";
        }
      }
      if (scenarioOpen) {
        const choice = [...senior.querySelectorAll("button")].find(visible);
        if (choice) {
          choice.click();
          return `scenario-open:${choice.textContent.trim()}`;
        }
      }
      const contHost = document.getElementById("animation-continue");
      const cont = document.getElementById("continue-btn");
      if (contHost && !contHost.classList.contains("hidden") && visible(cont)) {
        cont.click();
        return "continue";
      }
      for (const id of ["sim-skip-phase-btn", "match-skip-phase-btn", "sim-skip-match-btn", "match-skip-btn"]) {
        const el = document.getElementById(id);
        if (visible(el)) {
          el.click();
          return id;
        }
      }
      if (typeof window.__resolvePendingDecisionForPolicy === "function") {
        const resolved = window.__resolvePendingDecisionForPolicy("stay");
        if (resolved?.ok) return "decision-policy";
      }
      const buttons = [...document.querySelectorAll("button")].filter(visible);
      const patterns = [
        /stay and compete/i,
        /continue the season/i,
        /acknowledge/i,
        /decline offers and continue/i,
        /^remain$|^see it out$|^understood$/i,
      ];
      for (const re of patterns) {
        const hit = buttons.find((b) => re.test((b.textContent || "").trim()));
        if (hit) {
          hit.click();
          return `decision:${hit.textContent.trim()}`;
        }
      }
      const sim = document.getElementById("simulate-btn");
      if (visible(sim) && /continue season|resume/i.test(sim.textContent || "")) {
        sim.click();
        return "resume";
      }
      return null;
    });
    if (action === "continue") continueClicks += 1;
    await page.waitForTimeout(action ? 140 : 220);
  }
  const snap = await page.evaluate(() => ({
    seasons: window.__exportCareerSnapshot?.()?.player?.seasons?.length || 0,
    debug: window.__getLiveCareerDebug?.() || null,
    body: document.body.innerText.slice(0, 800),
  }));
  throw Object.assign(new Error("Timed out driving season to desk"), { data: snap });
}

async function startNewGkCareer(page) {
  const actions = [];
  await page.waitForFunction(
    () =>
      document.querySelectorAll('input[name="nationality"]').length > 0 &&
      document.querySelectorAll('input[name="primary-position"]').length > 0,
    null,
    { timeout: 30000 }
  );
  await page.fill("#player-name", "Fix13 Browser GK");
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
    choose("primary-position", "GK");
  });
  actions.push("filled-setup-gk");
  await page.click("#start-career-btn");
  actions.push("Begin career");
  await page.waitForSelector("#career-backstory-next:not(.hidden)", { timeout: 20000 });
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
    await page.locator("#career-scenario-choices button").first().click();
    actions.push(`Moment ${i + 1}`);
    await page.waitForSelector("#career-scenario-next:not(.hidden)", { timeout: 15000 });
    await page.click("#career-scenario-next");
  }
  await page.waitForSelector("#career-rating-next:not(.hidden)", { timeout: 20000 });
  await page.click("#career-rating-next");
  actions.push("Rating reveal");
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
  await buttons.nth(pick).click();
  actions.push("Pro deal");
  await page.waitForSelector("#career-year-end-continue:not(.hidden)", { timeout: 15000 });
  await page.click("#career-year-end-continue");
  actions.push("Year-end continue");
  await page.waitForFunction(() => !document.getElementById("career-section")?.classList.contains("hidden"), null, {
    timeout: 20000,
  });
  await page.waitForFunction(
    () => document.querySelectorAll("#player-overview .player-metrics .metric").length >= 6,
    null,
    { timeout: 20000 }
  );
  return { actions };
}

const handlers = {
  async B01(page, runtime, fixtures) {
    const started = await startNewGkCareer(page);
    // Wait until desk metrics appear (academy opening may still be animating).
    await page.waitForFunction(
      () => document.querySelectorAll("#player-overview .player-metrics .metric").length >= 6,
      null,
      { timeout: 90000 }
    ).catch(() => {});
    const metrics = await readOverviewMetrics(page);
    assert(metrics.labels.length === 6, "six metric rows", metrics);
    assert(
      JSON.stringify(metrics.labels) === JSON.stringify([...GK_ATTRIBUTE_KEYS]),
      "ordered GK labels",
      metrics.labels
    );
    const player = await exportPlayer(page);
    assert(player?.position === "GK" || /goalkeeper/i.test(player?.position || ""), "gk position", player?.position);
    assert(player?.development?.migration?.gkProxy !== true, "native not proxy", player?.development?.migration);
    for (let i = 0; i < GK_ATTRIBUTE_KEYS.length; i++) {
      const key = GK_ATTRIBUTE_KEYS[i];
      const raw = player.attributes?.[key];
      const shown = Number(metrics.values[i]);
      assert(Number.isFinite(raw), `raw ${key}`, raw);
      assert(shown === Math.round(raw), `display ${key}`, { shown, raw });
    }
    await restore(page, fixtures.outfield);
    const ofMetrics = await readOverviewMetrics(page);
    assert(
      JSON.stringify(ofMetrics.labels) === JSON.stringify(OUTFIELD_KEYS),
      "outfield labels",
      ofMetrics.labels
    );
    const shotPath = await shot(page, "B01-overview");
    return { label: "controlled", started, metrics, outfieldLabels: ofMetrics.labels, shotPath, errors: [...runtime] };
  },

  async B02(page, runtime, fixtures) {
    await restore(page, fixtures.modern);
    const before = await exportPlayer(page);
    assert(before.attributes.Speed === 41, "extra field retained", before.attributes);
    const driven = await driveSeasonToDesk(page);
    assert(driven.continueClosed, "continue closed", driven);
    assert(driven.seasonsAfter === driven.seasonsBefore + 1, "one new season", driven);
    assert(
      JSON.stringify(driven.summaryLabels) === JSON.stringify([...GK_ATTRIBUTE_KEYS]),
      "summary GK labels only",
      driven.summaryLabels
    );
    assert(!driven.summaryLabels?.includes("Speed"), "no Speed row", driven.summaryLabels);
    assert(!driven.summaryLabels?.includes("Shooting"), "no Shooting row", driven.summaryLabels);
    assert(driven.endpointWitness?.baselineAttributes, "season-start baseline captured", driven.endpointWitness);
    assert(driven.endpointWitness?.endAttributes, "season-end attributes captured", driven.endpointWitness);
    const endpointCompare = [];
    for (const item of driven.summaryItems || []) {
      const key = item.label;
      const rawBefore = driven.endpointWitness.baselineAttributes[key];
      const rawAfter = driven.endpointWitness.endAttributes[key];
      assert(Number.isFinite(rawBefore), `baseline ${key}`, rawBefore);
      assert(Number.isFinite(rawAfter), `end ${key}`, rawAfter);
      const expectedValue = String(Math.round(rawAfter));
      const expectedDelta =
        Math.round(rawAfter) - Math.round(rawBefore) === 0
          ? "0"
          : Math.round(rawAfter) - Math.round(rawBefore) > 0
            ? `+${Math.round(rawAfter) - Math.round(rawBefore)}`
            : String(Math.round(rawAfter) - Math.round(rawBefore));
      assert(item.value === expectedValue, `B02 value ${key}`, { item, rawBefore, rawAfter });
      assert(item.delta === expectedDelta, `B02 delta ${key}`, { item, rawBefore, rawAfter, expectedDelta });
      endpointCompare.push({ key, rawBefore, rawAfter, shownValue: item.value, shownDelta: item.delta });
    }
    assert(endpointCompare.length === GK_ATTRIBUTE_KEYS.length, "all GK endpoints compared", endpointCompare);
    const desk = await page.evaluate(() => ({
      careerVisible: !document.getElementById("career-section")?.classList.contains("hidden"),
      overlayHidden: document.getElementById("season-animation-overlay")?.classList.contains("hidden"),
      inFlight: Boolean(window.__getLiveCareerDebug?.()?.seasonActionInFlight),
      simDisabled: document.getElementById("simulate-btn")?.disabled,
    }));
    assert(desk.careerVisible && desk.overlayHidden && desk.inFlight === false, "desk returned", desk);
    const shotPath = await shot(page, "B02-desk");
    return { label: "controlled", driven, endpointCompare, desk, shotPath, errors: [...runtime] };
  },

  async B03(page, runtime, fixtures) {
    await restore(page, fixtures.legacy);
    const first = await readOverviewMetrics(page);
    assert(JSON.stringify(first.labels) === JSON.stringify([...GK_ATTRIBUTE_KEYS]), "legacy labels", first.labels);
    assert(!first.labels.includes("Speed"), "no outfield-only rows", first.labels);
    const p1 = await exportPlayer(page);
    assert(p1.development?.migration?.gkProxy === true, "proxy marked", p1.development?.migration);
    assert(typeof p1.attributes.Physicality === "number", "physicality retained type");
    // Second restore identical path
    await restore(page, fixtures.legacy);
    const p2 = await exportPlayer(page);
    for (const k of GK_ATTRIBUTE_KEYS) {
      assert(Math.abs(p1.attributes[k] - p2.attributes[k]) < 1e-9, `idempotent ${k}`, {
        a: p1.attributes[k],
        b: p2.attributes[k],
      });
    }

    await restore(page, fixtures.partial);
    const partialMetrics = await readOverviewMetrics(page);
    assert(
      JSON.stringify(partialMetrics.labels) === JSON.stringify([...GK_ATTRIBUTE_KEYS]),
      "partial v3 labels",
      partialMetrics.labels
    );
    const partialPlayer = await exportPlayer(page);
    assert(partialPlayer.attributes.Reflexes === fixtures.partial.player.attributes.Reflexes, "reflexes preserved");

    await restore(page, fixtures.legacy);
    const driven = await driveSeasonToDesk(page);
    assert(driven.continueClosed && driven.seasonsAfter === driven.seasonsBefore + 1, "repaired season", driven);
    const shotPath = await shot(page, "B03-repaired");
    return {
      label: "controlled",
      firstLabels: first.labels,
      proxy: true,
      partialLabels: partialMetrics.labels,
      driven,
      shotPath,
      errors: [...runtime],
    };
  },

  async B04(page, runtime, fixtures) {
    await page.setViewportSize({ width: 390, height: 800 });
    await restore(page, fixtures.alias);
    const metrics = await readOverviewMetrics(page);
    assert(JSON.stringify(metrics.labels) === JSON.stringify([...GK_ATTRIBUTE_KEYS]), "alias desk labels", metrics.labels);
    await page.evaluate(() => document.getElementById("retire-btn")?.click());
    await page.waitForFunction(
      () => !document.getElementById("retirement-animation-overlay")?.classList.contains("hidden"),
      null,
      { timeout: 15000 }
    );
    await page.waitForTimeout(2500);
    await page.waitForFunction(
      () => (document.getElementById("timeline-container")?.innerText || "").length > 10,
      null,
      { timeout: 15000 }
    );
    const timeline = await page.evaluate(() => {
      const items = [...document.querySelectorAll("#timeline-container .timeline-item")].map(
        (el) => el.innerText || ""
      );
      return {
        texts: items,
        joined: items.join("\n"),
        raw: document.getElementById("timeline-container")?.innerText || "",
      };
    });
    const blob = `${timeline.joined}\n${timeline.raw}`;
    assert(/\d+G\s+\d+A\s+7CS/.test(blob) || /7CS/.test(blob.replace(/\s+/g, "")), "clean-sheet suffix", timeline);
    assert(!/undefinedCS/i.test(blob), "no undefinedCS", blob);
    const withoutCs = timeline.texts.filter((t) => /Season 2/i.test(t));
    assert(withoutCs.length >= 1, "season 2 timeline row present", timeline.texts);
    assert(!/undefined/i.test(withoutCs.join("\n")), "season 2 no undefined counts", withoutCs);
    assert(!/\d+CS/.test(withoutCs.join("\n")), "season 2 omits fabricated CS", withoutCs);
    await page.evaluate(() => document.getElementById("retirement-continue-btn")?.click());
    await page.waitForFunction(
      () => document.getElementById("retirement-animation-overlay")?.classList.contains("hidden"),
      null,
      { timeout: 20000 }
    );
    const retirementClosed = await page.evaluate(
      () => document.getElementById("retirement-animation-overlay")?.classList.contains("hidden") === true
    );
    assert(retirementClosed, "retirement overlay closed via Continue", { retirementClosed });
    const shotPath = await shot(page, "B04-retirement");
    await page.setViewportSize({ width: 1440, height: 900 });
    return { label: "controlled", metrics, timeline, retirementClosed, shotPath, errors: [...runtime] };
  },

  async B05(page, runtime, fixtures) {
    await restore(page, fixtures.outfield);
    const outDriven = await driveSeasonToDesk(page);
    assert(outDriven.continueClosed, "outfield continue", outDriven);
    assert(
      JSON.stringify(outDriven.summaryLabels) === JSON.stringify(OUTFIELD_KEYS),
      "outfield summary labels",
      outDriven.summaryLabels
    );

    // Seed thin/empty GK change maps into the production summary renderer and
    // read the real #rating-changes-grid DOM (not an in-test key filter).
    await restore(page, fixtures.modern);
    const emptyDom = await page.evaluate(async () => {
      const { showSummaryAnimation } = await import("./js/ui/seasonAnimation.js?v=92");
      const overlay = document.getElementById("season-animation-overlay");
      overlay?.classList.remove("hidden");
      const player = window.__exportCareerSnapshot().player;
      showSummaryAnimation(
        { clubDisplay: player.club?.displayName || "Club", age: player.age, matches: 0, goals: 0, assists: 0, cleanSheets: 0, yellowCards: 0, redCards: 0, avgMatchRating: 6.5 },
        {},
        player
      );
      const items = [...document.querySelectorAll("#rating-changes-grid .rating-item")].map((el) => ({
        label: el.querySelector(".rating-name")?.textContent?.trim() || "",
        delta: el.querySelector(".rating-change")?.textContent?.trim() || "",
        value: el.querySelector(".rating-new")?.textContent?.trim() || "",
      }));
      return { items, labels: items.map((i) => i.label) };
    });
    assert(emptyDom.items.length === 0, "empty map renders no rating rows", emptyDom);

    const thinDom = await page.evaluate(async () => {
      const { showSummaryAnimation } = await import("./js/ui/seasonAnimation.js?v=92");
      const player = window.__exportCareerSnapshot().player;
      const attributeChanges = {
        Reflexes: { old: 70, new: 71, change: 1 },
        Handling: { new: 72 }, // unavailable old endpoint
        Speed: { old: 40, new: 41, change: 1 }, // must not appear on GK
        Shooting: { old: 20, new: 21, change: 1 },
      };
      showSummaryAnimation(
        { clubDisplay: player.club?.displayName || "Club", age: player.age, matches: 1, goals: 0, assists: 0, cleanSheets: 0, yellowCards: 0, redCards: 0, avgMatchRating: 6.8 },
        attributeChanges,
        player
      );
      // Stale key-list argument must be ignored when a player object is passed —
      // also prove a mixed payload cannot inject outfield labels.
      return [...document.querySelectorAll("#rating-changes-grid .rating-item")].map((el) => ({
        label: el.querySelector(".rating-name")?.textContent?.trim() || "",
        delta: el.querySelector(".rating-change")?.textContent?.trim() || "",
        value: el.querySelector(".rating-new")?.textContent?.trim() || "",
      }));
    });
    assert(thinDom.some((r) => r.label === "Reflexes" && r.delta === "+1" && r.value === "71"), "reflexes row", thinDom);
    assert(thinDom.some((r) => r.label === "Handling" && r.delta === "—" && r.value === "72"), "handling unavailable old", thinDom);
    assert(!thinDom.some((r) => r.label === "Speed" || r.label === "Shooting"), "no outfield rows from mixed payload", thinDom);
    assert(thinDom.every((r) => GK_ATTRIBUTE_KEYS.includes(r.label)), "only GK labels", thinDom);

    // Outfield club recap already returned via production #continue-btn (outDriven).
    // Close the seeded summary overlay without inventing a completion callback.
    await page.evaluate(() => {
      document.getElementById("summary-animation")?.classList.add("hidden");
      document.getElementById("summary-animation")?.classList.remove("active");
      document.getElementById("season-animation-overlay")?.classList.add("hidden");
      document.getElementById("animation-continue")?.classList.add("hidden");
    });

    const desk = await page.evaluate((continueClosed) => ({
      overlayHidden: document.getElementById("season-animation-overlay")?.classList.contains("hidden"),
      inFlight: Boolean(window.__getLiveCareerDebug?.()?.seasonActionInFlight),
      continueClosed,
    }), outDriven.continueClosed);
    assert(desk.overlayHidden && desk.inFlight === false && desk.continueClosed, "returned desk", desk);
    const shotPath = await shot(page, "B05-outfield");
    return { label: "controlled", outDriven, emptyDom, thinDom, desk, shotPath, errors: [...runtime] };
  },
};

async function main() {
  await mkdir(RUN, { recursive: true });
  await mkdir(CASES, { recursive: true });
  const fixtures = writeFixtures();
  const testedSourceFingerprint = Object.fromEntries(
    [
      "js/ui/rendering.js",
      "js/ui/seasonAnimation.js",
      "js/ui/retirementAnimation.js",
      "js/simulation/playerModelMigration.js",
      "js/simulation/careerSnapshot.js",
      "js/simulation/seasonSimulator.js",
      "js/simulation/fix13GoalkeeperBrowserFixtures.js",
      "main.js",
      "scripts/qaBulkCareers.mjs",
      "scripts/browserGoalkeeperUiLegacyAttributesChecklist.mjs",
      "tests/goalkeeperUiLegacyAttributes.test.mjs",
    ].map((rel) => [rel, createHash("sha256").update(readFileSync(join(ROOT, rel))).digest("hex")])
  );

  const server = await hostFixed();
  const { browser } = await openBrowser();
  const results = [];
  try {
    for (const id of SELECTED) {
      const runtime = [];
      const { context, page } = await openCasePage(browser, server.base, runtime);
      const started = Date.now();
      let entry = { id, status: "FAIL", durationMs: 0 };
      try {
        const detail = await handlers[id](page, runtime, fixtures);
        entry = {
          id,
          status: "PASS",
          durationMs: Date.now() - started,
          label: detail.label,
          errors: detail.errors || [],
          detail: { ...detail, errors: undefined },
        };
        if ((detail.errors || []).length) {
          entry.status = "FAIL";
          entry.reason = "runtime errors";
        }
      } catch (error) {
        entry = {
          id,
          status: "FAIL",
          durationMs: Date.now() - started,
          reason: error.message,
          data: error.data || null,
          errors: [...runtime],
        };
        try {
          entry.shot = await shot(page, `${id}-FAIL`);
        } catch {
          /* ignore */
        }
      }
      await context.close();
      results.push(entry);
      await json(join(CASES, `${id}.json`), entry);
      console.log(`${id} ${entry.status}${entry.reason ? ` — ${entry.reason}` : ""}`);
    }
  } finally {
    await browser.close();
    await server.close();
  }

  const report = {
    generatedAt: new Date().toISOString(),
    testedSourceFingerprint,
    selected: SELECTED,
    results,
    pass: results.filter((r) => r.status === "PASS").length,
    fail: results.filter((r) => r.status === "FAIL").length,
  };
  await json(OUT, report);
  console.log(`Browser report ${OUT}: ${report.pass} pass / ${report.fail} fail`);
  if (report.fail) process.exit(1);
}

await main();
