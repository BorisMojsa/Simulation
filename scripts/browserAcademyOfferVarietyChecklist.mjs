#!/usr/bin/env node
/**
 * Fix 14 real-browser acceptance (B01–B06).
 *
 *   python3 -m http.server 8014 --bind 127.0.0.1
 *   npm install --no-save playwright-core
 *   BASE_URL=http://127.0.0.1:8014 node scripts/browserAcademyOfferVarietyChecklist.mjs
 *
 * Or let this script start its own static server (default).
 */
import { createServer } from "node:http";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOT_DIR = join(root, "qa/screenshots/fix14-offer-variety");
const STATE_DIR = join(root, "qa/evidence/fix14-browser");

/** Predeclared seeds from deterministic engine probe (cohort prefix indices). */
const SEEDS = {
  B01_ENGLAND_16_ALL_HOME: 1806178795,
  B02_SERBIA_18_MIXED: 528215054,
  B03_GHANA_16: 1912595462,
  B04_ENGLAND_16_A: 1806178795,
  B04_ENGLAND_16_B: 1789401176,
  B06_ORDINARY: 1806178795,
};

const EXPECTED = {
  B01: [
    "club:england:leeds-united",
    "club:england:swansea-city",
    "club:england:tottenham-hotspur",
  ],
  B02: [
    "club:serbia:zeleznicar-pancevo",
    "club:serbia:novi-pazar",
    "club:turkey:kayserispor",
  ],
  B03: ["club:morocco:rs-berkane", "club:croatia:varazdin", "club:egypt:el-gouna"],
  B04b: [
    "club:england:crystal-palace",
    "club:england:blackburn-rovers",
    "club:belgium:mechelen",
  ],
};

const log = [];
const results = [];
const runtimeErrors = [];

function note(msg, data) {
  const row = { t: new Date().toISOString(), msg, ...(data || {}) };
  log.push(row);
  console.log(`• ${msg}`, data ? JSON.stringify(data) : "");
}

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

function projectLeaguesSource(src, mode) {
  const projection = `
;(() => {
  const all = ACADEMY_POOL.slice();
  ACADEMY_POOL.length = 0;
  const mode = ${JSON.stringify(mode)};
  if (mode === "empty") {
    // All-invalid parent rows: pool non-empty but nothing eligible for offers.
    for (const row of all.slice(0, 8)) {
      ACADEMY_POOL.push({
        ...row,
        isAcademy: true,
        parentClub: null,
        name: row?.name || "Ghost Academy",
      });
    }
    if (!ACADEMY_POOL.length) {
      ACADEMY_POOL.push({
        name: "Ghost Academy",
        isAcademy: true,
        nation: "England",
        parentClub: { name: "", clubId: "" },
      });
    }
    return;
  }
  const england = all.filter((a) => a?.nation === "England" && a?.parentClub?.clubId);
  if (mode === "one") {
    if (england[0]) ACADEMY_POOL.push(england[0]);
    return;
  }
  if (mode === "two") {
    for (const row of england.slice(0, 2)) ACADEMY_POOL.push(row);
  }
})();
`;
  return src + projection;
}

function stripIntroDom(html) {
  // Remove only required intro overlay markup so bootstrap path runs.
  return html.replace(
    /<div id="career-start-overlay"[\s\S]*?<\/div>\s*(?=<div id="season-animation-overlay")/,
    "<!-- fix14-test: career-start-overlay removed -->\n"
  );
}

async function startServer() {
  if (process.env.BASE_URL) {
    return { base: process.env.BASE_URL, close: async () => {} };
  }
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      let rel = decodeURIComponent(url.pathname);
      if (rel === "/") rel = "/index.html";
      const poolMode = url.searchParams.get("pool");
      const noIntro = url.searchParams.get("noIntro") === "1";
      const filePath = join(root, rel);
      if (!filePath.startsWith(root) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      if (rel.endsWith("leagues.js") && poolMode) {
        const src = await readFile(filePath, "utf8");
        const body = projectLeaguesSource(src, poolMode);
        res.writeHead(200, { "Content-Type": MIME[".js"], "Cache-Control": "no-store" });
        res.end(body);
        return;
      }
      if (rel.endsWith("index.html") && noIntro) {
        const src = await readFile(filePath, "utf8");
        res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
        res.end(stripIntroDom(src));
        return;
      }
      if (rel.endsWith("narrativeAcademySeason.js") && url.searchParams.get("wrapAge") === "1") {
        // Served normally; age wrap is installed via init script + import shim below.
      }
      const type = MIME[extname(filePath)] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
      createReadStream(filePath).pipe(res);
    } catch (err) {
      res.writeHead(500);
      res.end(String(err));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function shot(page, name) {
  await mkdir(SHOT_DIR, { recursive: true });
  const path = join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}

async function dumpState(page, name) {
  await mkdir(STATE_DIR, { recursive: true });
  const state = await page.evaluate(() => window.__getLiveCareerDebug?.() || null);
  const path = join(STATE_DIR, `${name}.json`);
  await writeFile(path, JSON.stringify(state, null, 2));
  return path;
}

async function waitFor(page, fn, timeoutMs = 20000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await page.evaluate(fn);
    if (last) return last;
    await page.waitForTimeout(80);
  }
  throw new Error(`Timeout. Last=${JSON.stringify(last)}`);
}

/**
 * Documented local badge paths that may 404 in this harness:
 * - Ghana B03 tray clubs RS Berkane and El Gouna (missing badge assets)
 * - FAR Rabat collateral first-pro offer badge while enrolled at Berkane
 */
const DOCUMENTED_MISSING_BADGES = [
  "badges/Morocco - Botola Pro/RS Berkane.png",
  "badges/Egypt - Egyptian Premier League/El Gouna.png",
  "badges/Morocco - Botola Pro/FAR Rabat.png",
];

function isDocumentedImageFailure(urlOrText) {
  let s = String(urlOrText || "");
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep raw */
  }
  if (/flagcdn\.com|flags\//i.test(s)) return true;
  return DOCUMENTED_MISSING_BADGES.some(
    (p) => s.includes(p) || s.includes(encodeURI(p)) || s.includes(p.replace(/ /g, "%20"))
  );
}

function isAssertedFix04Dialog(text) {
  return /exceeds-wage-headroom|Deal could not be completed/i.test(String(text || ""));
}

function attachErrorListeners(page) {
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      const location = msg.location?.() || null;
      const locUrl = location?.url || "";
      if (/academy pool is empty/i.test(text)) {
        log.push({ t: new Date().toISOString(), assertedEmptyPool: text });
        return;
      }
      if (isDocumentedImageFailure(text) || isDocumentedImageFailure(locUrl)) {
        log.push({ t: new Date().toISOString(), documentedImageFailure: text, url: locUrl });
        return;
      }
      runtimeErrors.push({ type: "console", text, location });
      log.push({ t: new Date().toISOString(), consoleError: text, url: locUrl });
    }
  });
  page.on("pageerror", (err) => {
    if (/academy pool is empty/i.test(String(err))) {
      log.push({ t: new Date().toISOString(), assertedEmptyPoolPage: String(err) });
      return;
    }
    runtimeErrors.push({ type: "page", text: String(err) });
    log.push({ t: new Date().toISOString(), pageError: String(err) });
  });
  page.on("requestfailed", (req) => {
    const url = req.url();
    const failure = req.failure()?.errorText || "requestfailed";
    const resourceType = req.resourceType();
    const row = { url, resourceType, failure };
    if (isDocumentedImageFailure(url) || resourceType === "image" && isDocumentedImageFailure(url)) {
      log.push({ t: new Date().toISOString(), documentedImageRequest: row });
      return;
    }
    // Fail app/module load failures; ignore only documented image/flag assets.
    if (resourceType === "script" || resourceType === "document" || /\.m?js(\?|$)/i.test(url)) {
      runtimeErrors.push({ type: "requestfailed", ...row });
      log.push({ t: new Date().toISOString(), moduleRequestFailed: row });
      return;
    }
    if (resourceType === "image" || /\.(png|svg|jpe?g|webp)(\?|$)/i.test(url)) {
      // Undocumented image failure — record as error for review.
      runtimeErrors.push({ type: "image-requestfailed", ...row });
      log.push({ t: new Date().toISOString(), imageRequestFailed: row });
      return;
    }
    log.push({ t: new Date().toISOString(), otherRequestFailed: row });
  });
  page.on("response", (res) => {
    if (res.status() !== 404) return;
    const url = res.url();
    const resourceType = res.request().resourceType();
    const row = { url, resourceType, status: 404 };
    if (isDocumentedImageFailure(url)) {
      log.push({ t: new Date().toISOString(), documentedImage404: row });
      return;
    }
    if (resourceType === "script" || resourceType === "document" || /\.m?js(\?|$)/i.test(url)) {
      runtimeErrors.push({ type: "http404-module", ...row });
      return;
    }
    if (resourceType === "image" || /\.(png|svg|jpe?g|webp)(\?|$)/i.test(url)) {
      runtimeErrors.push({ type: "http404-image", ...row });
      return;
    }
    log.push({ t: new Date().toISOString(), http404: row });
  });
  page.on("dialog", async (dialog) => {
    const text = dialog.message();
    if (/academy pool is empty/i.test(text)) {
      log.push({ t: new Date().toISOString(), assertedEmptyPoolDialog: text });
      await dialog.dismiss();
      return;
    }
    runtimeErrors.push({ type: "dialog", text });
    log.push({ t: new Date().toISOString(), alert: text });
    await dialog.dismiss();
  });
}

async function newSeededContext(browser, seed, extraInit = null) {
  const context = await browser.newContext();
  await context.addInitScript((s) => {
    const orig = crypto.getRandomValues.bind(crypto);
    window.__fix14Entropy = { seed: s, consumed: 0, matchingCalls: 0 };
    crypto.getRandomValues = function getRandomValues(arr) {
      if (arr instanceof Uint32Array && arr.length === 1) {
        window.__fix14Entropy.matchingCalls += 1;
        if (window.__fix14Entropy.consumed === 0) {
          arr[0] = s >>> 0;
          window.__fix14Entropy.consumed = 1;
          return arr;
        }
      }
      return orig(arr);
    };
  }, seed >>> 0);
  if (extraInit) await context.addInitScript(extraInit);
  const page = await context.newPage();
  attachErrorListeners(page);
  return { context, page };
}

async function fillSetup(page, { name, nationality, age, position = "ST" }) {
  await page.waitForFunction(
    () =>
      document.querySelectorAll('input[name="nationality"]').length > 0 &&
      document.querySelectorAll('input[name="starting-age"]').length > 0 &&
      document.querySelectorAll('input[name="primary-position"]').length > 0,
    null,
    { timeout: 60000 }
  );
  await page.fill("#player-name", name);
  const selected = await page.evaluate(
    ({ nationality, age, position }) => {
      const choose = (inputName, wanted) => {
        const x = [...document.querySelectorAll(`input[name="${inputName}"]`)].find(
          (input) => String(input.value).toLowerCase() === String(wanted).toLowerCase()
        );
        if (!x) return false;
        x.checked = true;
        x.dispatchEvent(new Event("input", { bubbles: true }));
        x.dispatchEvent(new Event("change", { bubbles: true }));
        document.querySelector(`label[for="${x.id}"]`)?.click();
        return true;
      };
      return {
        age: choose("starting-age", String(age)),
        nationality: choose("nationality", nationality),
        position: choose("primary-position", position),
      };
    },
    { nationality, age, position }
  );
  assert(selected.age && selected.nationality && selected.position, "setup filled", selected);
}

async function startCareer(page) {
  await page.click("#start-career-btn");
  await waitFor(
    page,
    () => {
      const overlay = document.getElementById("career-start-overlay");
      const career = document.getElementById("career-section");
      const boot = document.getElementById("app-boot-error");
      if (boot && !boot.classList.contains("hidden") && boot.textContent) return { boot: boot.textContent };
      if (overlay && !overlay.classList.contains("hidden")) return { overlay: true };
      if (career && !career.classList.contains("hidden")) return { desk: true };
      return null;
    },
    20000
  );
}

async function clickWhenReady(page, selector, timeoutMs = 20000) {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return Boolean(el && !el.classList.contains("hidden") && !el.disabled && el.offsetParent !== null);
    },
    selector,
    { timeout: timeoutMs }
  );
  await page.click(selector);
}

async function revealAllOffers(page) {
  await clickWhenReady(page, "#career-backstory-next");
  const introText = await page.evaluate(() => document.getElementById("career-academy-intro-text")?.textContent || "");
  await clickWhenReady(page, "#career-academy-intro-next");
  const reveals = [];
  for (let i = 0; i < 6; i++) {
    const choiceVisible = await page.evaluate(() => {
      const choice = document.getElementById("career-academy-choice");
      return Boolean(choice && !choice.classList.contains("hidden"));
    });
    if (choiceVisible) break;

    await page.waitForFunction(
      () => {
        const choice = document.getElementById("career-academy-choice");
        if (choice && !choice.classList.contains("hidden")) return true;
        const next = document.getElementById("career-academy-next-offer");
        return Boolean(next && !next.classList.contains("hidden") && !next.disabled);
      },
      null,
      { timeout: 20000 }
    );

    const state = await page.evaluate(() => {
      const choice = document.getElementById("career-academy-choice");
      const idx = document.getElementById("career-academy-offer-index")?.textContent || "";
      const name = document.querySelector("#career-academy-feature .career-academy-name")?.textContent || "";
      const tag = document.querySelector("#career-academy-feature .career-academy-tag")?.textContent || "";
      const next = document.getElementById("career-academy-next-offer");
      return {
        choiceVisible: Boolean(choice && !choice.classList.contains("hidden")),
        idx,
        name,
        tag,
        nextLabel: next?.textContent || "",
      };
    });
    if (state.choiceVisible) break;
    if (state.name) reveals.push({ idx: state.idx, name: state.name, tag: state.tag });
    await page.click("#career-academy-next-offer");
    await page.waitForTimeout(200);
  }
  await page.waitForFunction(
    () => {
      const choice = document.getElementById("career-academy-choice");
      return Boolean(choice && !choice.classList.contains("hidden"));
    },
    null,
    { timeout: 20000 }
  );
  const grid = await page.evaluate(() =>
    [...document.querySelectorAll("#career-academy-grid .career-academy-card")].map((card) => ({
      name: card.querySelector(".career-academy-name")?.textContent || "",
      tag: card.querySelector(".career-academy-tag")?.textContent || "",
      parent: card.querySelector(".career-academy-parent")?.textContent || "",
      league: card.querySelector(".career-academy-league")?.textContent || "",
    }))
  );
  const lead = await page.evaluate(() => document.getElementById("career-academy-lead")?.textContent || "");
  const entropy = await page.evaluate(() => window.__fix14Entropy || null);
  return { reveals, grid, lead, intro: introText, entropy };
}

async function chooseGridCard(page, index) {
  const info = await page.evaluate((idx) => {
    const cards = [...document.querySelectorAll("#career-academy-grid button.career-academy-card")];
    const card = cards[idx];
    if (!card) return { ok: false, count: cards.length };
    const snapshot = {
      name: card.querySelector(".career-academy-name")?.textContent || "",
      parent: card.querySelector(".career-academy-parent")?.textContent || "",
      tag: card.querySelector(".career-academy-tag")?.textContent || "",
    };
    card.click();
    return { ok: true, snapshot, count: cards.length };
  }, index);
  assert(info.ok, "grid card clicked", info);
  return info.snapshot;
}

async function driveOpeningToDesk(page, { preferStay = false } = {}) {
  for (let i = 0; i < 5; i++) {
    await waitFor(page, () => document.querySelectorAll("#career-scenario-choices button").length > 0);
    await page.evaluate(() => document.querySelector("#career-scenario-choices button")?.click());
    await waitFor(page, () => {
      const btn = document.getElementById("career-scenario-next");
      return Boolean(btn && !btn.classList.contains("hidden") && !btn.disabled);
    });
    await page.click("#career-scenario-next");
  }
  await waitFor(page, () => {
    const btn = document.getElementById("career-rating-next");
    return Boolean(btn && !btn.classList.contains("hidden"));
  }, 25000);
  await page.click("#career-rating-next");
  await waitFor(page, () => (document.getElementById("career-pro-deals-grid")?.children?.length || 0) > 0);
  await page.evaluate((preferStay) => {
    const cards = [...document.querySelectorAll("#career-pro-deals-grid button")];
    const stay = cards.find((c) => /stay in the system|continue/i.test(c.textContent || ""));
    const accept = cards.find((c) => !/stay in the system|continue/i.test(c.textContent || ""));
    const pick = preferStay ? stay || accept || cards[0] : accept || stay || cards[0];
    pick?.click();
    return pick?.textContent?.slice(0, 80);
  }, preferStay);
  await waitFor(page, () => {
    const btn = document.getElementById("career-year-end-continue");
    return Boolean(btn && !btn.classList.contains("hidden"));
  }, 20000);
  await page.click("#career-year-end-continue");
  await waitFor(page, () => {
    const career = document.getElementById("career-section");
    return Boolean(career && !career.classList.contains("hidden") && window.__getLiveCareerDebug?.()?.name);
  });
}

async function record(name, status, detail = {}) {
  results.push({ name, status, ...detail });
  note(`${status}: ${name}`, detail);
}

async function runB01(browser, base) {
  const { context, page } = await newSeededContext(browser, SEEDS.B01_ENGLAND_16_ALL_HOME);
  try {
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await fillSetup(page, { name: "Fix14 B01", nationality: "England", age: 16 });
    await startCareer(page);
    const tray = await revealAllOffers(page);
    assert(tray.entropy?.consumed === 1, "entropy consumed once", tray.entropy);
    assert(tray.entropy?.matchingCalls === 1, "exactly one matching entropy call", tray.entropy);
    assert(tray.grid.length === 3, "three cards", tray.grid);
    assert(tray.grid.every((c) => /Home/i.test(c.tag)), "all Home tags", tray.grid);
    assert(tray.reveals.length === 3, "three reveals", tray.reveals);
    assert(
      tray.reveals.map((r) => r.name).join("|") === tray.grid.map((c) => c.name).join("|"),
      "reveal/compare order",
      tray
    );
    const leagues = tray.grid.map((c) => c.league);
    assert(
      leagues.some((l) => /Premier League/i.test(l)) && leagues.some((l) => /Championship/i.test(l)),
      "two parent divisions on tray",
      leagues
    );
    const chosen = await chooseGridCard(page, 1);
    assert(/Swansea/i.test(chosen.name + chosen.parent), "second card Swansea", chosen);
    // Parent ID before signing
    const beforeSign = await page.evaluate(() => {
      const snap = window.__exportCareerSnapshot?.();
      const p = snap?.player;
      return {
        clubId: p?.club?.clubId || null,
        parentClubId: p?.club?.parentClub?.clubId || null,
        isAcademy: p?.club?.isAcademy,
        name: p?.club?.name || p?.club?.displayName,
      };
    });
    assert(beforeSign.isAcademy === true, "still academy before signing", beforeSign);
    assert(
      beforeSign.parentClubId === "club:england:swansea-city",
      "selected parent ID before signing",
      beforeSign
    );
    await driveOpeningToDesk(page);
    const state = await page.evaluate(() => window.__getLiveCareerDebug?.());
    const snap = await page.evaluate(() => window.__exportCareerSnapshot?.());
    assert(state?.name === "Fix14 B01", "player name", state);
    const opening = snap?.player?.seasons?.[0];
    assert(/Swansea/i.test(opening?.club || opening?.clubDisplay || ""), "opening history Swansea", opening);
    await shot(page, "B01-desk");
    await dumpState(page, "B01-state");
    await writeFile(
      join(STATE_DIR, "B01-tray.json"),
      JSON.stringify({ tray, beforeSign, opening, terminal: state }, null, 2)
    );
    await record("B01", "PASS", {
      seed: SEEDS.B01_ENGLAND_16_ALL_HOME,
      grid: tray.grid,
      chosen,
      beforeSign,
      expectedParents: EXPECTED.B01,
    });
  } finally {
    await context.close();
  }
}

async function runB02(browser, base) {
  const { context, page } = await newSeededContext(browser, SEEDS.B02_SERBIA_18_MIXED);
  try {
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await fillSetup(page, { name: "Fix14 B02", nationality: "Serbia", age: 18 });
    await startCareer(page);
    const tray = await revealAllOffers(page);
    assert(tray.entropy?.consumed === 1, "entropy once", tray.entropy);
    assert(tray.grid.length === 3, "three cards", tray.grid);
    const homes = tray.grid.filter((c) => /Home/i.test(c.tag));
    const abroad = tray.grid.filter((c) => /Abroad/i.test(c.tag));
    assert(homes.length === 2 && abroad.length === 1, "2 home + 1 abroad", tray.grid);
    const chosen = await chooseGridCard(page, 2);
    assert(/Kayseri/i.test(chosen.name + chosen.parent), "third card Kayserispor", chosen);
    assert(/Abroad/i.test(chosen.tag), "third card Abroad tag", chosen);
    await driveOpeningToDesk(page, { preferStay: true });
    const state = await page.evaluate(() => window.__getLiveCareerDebug?.());
    const snap = await page.evaluate(() => window.__exportCareerSnapshot?.());
    assert(snap?.player, "snapshot export");
    assert(snap.player.nationality === "Serbia", "nationality preserved", {
      nationality: snap.player.nationality,
    });
    const hist = await page.evaluate(() => document.getElementById("season-log")?.innerText || "");
    const openingClub = snap.player.seasons?.[0]?.club || snap.player.seasons?.[0]?.clubDisplay || "";
    assert(
      /Kayseri/i.test(hist) || /Kayseri/i.test(openingClub),
      "clicked academy in history",
      { hist: hist.slice(0, 500), openingClub, club: state?.club }
    );
    const nextAction = state?.nextAction || null;
    assert(nextAction?.id === "start-season", "valid next-action ID", nextAction);
    assert(nextAction?.canSimulate === true, "can simulate next", nextAction);
    const restoreResult = await page.evaluate((data) => window.__restoreCareerSnapshot?.(data), snap);
    assert(restoreResult?.ok === true, "restore returns ok:true", restoreResult);
    await page.waitForTimeout(200);
    const entropyAfterRestore = await page.evaluate(() => window.__fix14Entropy || null);
    assert(entropyAfterRestore?.consumed === 1, "entropy still one after restore", entropyAfterRestore);
    const restoredSnap = await page.evaluate(() => window.__exportCareerSnapshot?.());
    const restoredState = await page.evaluate(() => window.__getLiveCareerDebug?.());
    assert(restoredSnap?.player?.nationality === "Serbia", "restored nationality", restoredSnap?.player?.nationality);
    assert(
      restoredSnap?.player?.seasons?.[0]?.club === snap.player.seasons?.[0]?.club,
      "restore same opening without redraw",
      {
        before: snap.player.seasons?.[0]?.club,
        after: restoredSnap?.player?.seasons?.[0]?.club,
      }
    );
    assert(restoredState?.nextAction?.id === "start-season", "restored next action", restoredState?.nextAction);
    await shot(page, "B02-desk");
    await dumpState(page, "B02-state");
    await writeFile(
      join(STATE_DIR, "B02-tray.json"),
      JSON.stringify({
        tray,
        chosen,
        nextAction,
        openingClub,
        restoreResult,
        entropyAfterRestore,
        terminal: state,
      }, null, 2)
    );
    await record("B02", "PASS", {
      seed: SEEDS.B02_SERBIA_18_MIXED,
      grid: tray.grid,
      chosen,
      nextAction,
      restoreResult,
      entropyAfterRestore,
      expectedParents: EXPECTED.B02,
    });
  } finally {
    await context.close();
  }
}

async function runB03(browser, base) {
  const { context, page } = await newSeededContext(browser, SEEDS.B03_GHANA_16);
  try {
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await fillSetup(page, { name: "Fix14 B03", nationality: "Ghana", age: 16 });
    await startCareer(page);
    const tray = await revealAllOffers(page);
    assert(tray.grid.length === 3, "three offers", tray.grid);
    assert(tray.grid.every((c) => /Abroad/i.test(c.tag)), "all Abroad", tray.grid);
    assert(new Set(tray.grid.map((c) => c.name)).size === 3, "distinct academies", tray.grid);
    const chosen = await chooseGridCard(page, 0);
    const beforeSign = await page.evaluate(() => {
      const p = window.__exportCareerSnapshot?.()?.player;
      return {
        parentClubId: p?.club?.parentClub?.clubId || null,
        nation: p?.club?.nation || p?.club?.parentClub?.nation || null,
        isAcademy: p?.club?.isAcademy,
      };
    });
    assert(beforeSign.parentClubId === "club:morocco:rs-berkane", "selected parent in player state", beforeSign);
    await driveOpeningToDesk(page);
    const snap = await page.evaluate(() => window.__exportCareerSnapshot?.());
    const { ACADEMY_POOL } = await import(pathToFileURL(join(root, "js/data/leagues.js")).href);
    const { academyNationOf } = await import(pathToFileURL(join(root, "js/data/academyOfferStories.js")).href);
    const { resolveGeographicNation } = await import(pathToFileURL(join(root, "js/data/academyGeography.js")).href);
    const byParentId = new Map();
    for (const row of ACADEMY_POOL) {
      const id = row?.parentClub?.clubId;
      if (!id || byParentId.has(id)) continue;
      byParentId.set(id, row);
    }
    const mapped = tray.grid.map((card) => {
      const blob = `${card.name || ""} ${card.parent || ""}`;
      let match = null;
      for (const id of EXPECTED.B03) {
        const row = byParentId.get(id);
        if (!row) continue;
        const parentName = row.parentClub?.name || "";
        const academyName = row.name || "";
        const needles = [parentName, academyName].filter(Boolean);
        if (needles.some((n) => new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(blob))) {
          match = row;
          break;
        }
      }
      if (!match) {
        match = ACADEMY_POOL.find((a) => {
          const parentName = a?.parentClub?.name || "";
          const academyName = a?.name || "";
          return [parentName, academyName].some(
            (n) => n && new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(blob)
          );
        });
      }
      assert(match?.parentClub?.clubId, "card maps to catalog parent", { card, blob });
      const parentId = match.parentClub.clubId;
      const nation =
        resolveGeographicNation(academyNationOf(match)) || academyNationOf(match) || match.parentClub?.nation;
      return { name: card.name, parent: card.parent, parentId, nation };
    });
    assert(mapped.length === 3, "three catalog mappings", mapped);
    assert(new Set(mapped.map((m) => m.parentId)).size === 3, "three distinct catalog parent IDs", mapped);
    assert(new Set(mapped.map((m) => m.nation)).size === 3, "three distinct catalog nations", mapped);
    assert(
      EXPECTED.B03.every((id) => mapped.some((m) => m.parentId === id)),
      "mapped parents match expected B03 set",
      mapped
    );
    const opening = snap?.player?.seasons?.[0];
    assert(/Berkane/i.test(opening?.club || ""), "opening records Berkane", opening);
    await shot(page, "B03-desk");
    await dumpState(page, "B03-state");
    await writeFile(
      join(STATE_DIR, "B03-tray.json"),
      JSON.stringify({ tray, beforeSign, mapped, opening }, null, 2)
    );
    await record("B03", "PASS", {
      seed: SEEDS.B03_GHANA_16,
      grid: tray.grid,
      beforeSign,
      mapped,
      expectedParents: EXPECTED.B03,
    });
  } finally {
    await context.close();
  }
}

async function runB04(browser, base) {
  async function once(seed) {
    const { context, page } = await newSeededContext(browser, seed);
    try {
      await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      await fillSetup(page, { name: "Fix14 B04", nationality: "England", age: 16 });
      await startCareer(page);
      const tray = await revealAllOffers(page);
      assert(tray.entropy?.consumed === 1, "seed consumed", tray.entropy);
      assert(tray.entropy?.matchingCalls === 1, "all matching entropy calls counted once", tray.entropy);
      assert(tray.grid.length === 3, "offer count 3", tray);
      assert(tray.reveals.length === 3, "three reveals", tray.reveals);
      assert(
        tray.reveals.map((r) => r.name).join("|") === tray.grid.map((c) => c.name).join("|"),
        "reveal sequence matches grid",
        tray
      );
      return { tray, context };
    } catch (err) {
      await context.close();
      throw err;
    }
  }
  const a = await once(SEEDS.B04_ENGLAND_16_A);
  const namesA = a.tray.grid.map((c) => c.name).join("|");
  const revealsA = a.tray.reveals.map((r) => r.name).join("|");
  await a.context.close();
  const b = await once(SEEDS.B04_ENGLAND_16_A);
  const namesA2 = b.tray.grid.map((c) => c.name).join("|");
  const revealsA2 = b.tray.reveals.map((r) => r.name).join("|");
  await b.context.close();
  assert(namesA === namesA2 && revealsA === revealsA2, "identical seed replay reveal+grid", {
    namesA,
    namesA2,
    revealsA,
    revealsA2,
  });
  const c = await once(SEEDS.B04_ENGLAND_16_B);
  const namesB = c.tray.grid.map((c) => c.name).join("|");
  await c.context.close();
  assert(namesA !== namesB, "different seed different tray", { namesA, namesB });
  await writeFile(
    join(STATE_DIR, "B04-trays.json"),
    JSON.stringify({ a: a.tray, b: b.tray, c: c.tray }, null, 2)
  );
  await record("B04", "PASS", { namesA, namesB, revealsA, seeds: [SEEDS.B04_ENGLAND_16_A, SEEDS.B04_ENGLAND_16_B] });
}

async function runB05(browser, base) {
  // One-candidate pool
  {
    const { context, page } = await newSeededContext(browser, 42);
    try {
      await page.route("**/js/data/leagues.js**", async (route) => {
        const src = await readFile(join(root, "js/data/leagues.js"), "utf8");
        await route.fulfill({
          status: 200,
          contentType: "text/javascript",
          body: projectLeaguesSource(src, "one"),
        });
      });
      await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      await fillSetup(page, { name: "Fix14 B05one", nationality: "England", age: 16 });
      await startCareer(page);
      const tray = await revealAllOffers(page);
      assert(tray.grid.length === 1, "one selectable card", tray.grid);
      assert(/one/i.test(tray.intro) || /One door/i.test(tray.lead) || /1 of 1/i.test(tray.reveals[0]?.idx || ""), "count wording", tray);
      await chooseGridCard(page, 0);
      await driveOpeningToDesk(page);
      await shot(page, "B05-one");
      await record("B05-one", "PASS", { grid: tray.grid, lead: tray.lead, intro: tray.intro });
    } finally {
      await context.close();
    }
  }
  // Two-candidate pool
  {
    const { context, page } = await newSeededContext(browser, 43);
    try {
      await page.route("**/js/data/leagues.js**", async (route) => {
        const src = await readFile(join(root, "js/data/leagues.js"), "utf8");
        await route.fulfill({
          status: 200,
          contentType: "text/javascript",
          body: projectLeaguesSource(src, "two"),
        });
      });
      await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      await fillSetup(page, { name: "Fix14 B05two", nationality: "England", age: 17 });
      await startCareer(page);
      const tray = await revealAllOffers(page);
      assert(tray.grid.length === 2, "two cards", tray.grid);
      assert(/two|both|2 of 2/i.test([tray.intro, tray.lead, ...tray.reveals.map((r) => r.idx)].join(" ")), "two-count wording", tray);
      await chooseGridCard(page, 1);
      await driveOpeningToDesk(page);
      await shot(page, "B05-two");
      await record("B05-two", "PASS", { grid: tray.grid });
    } finally {
      await context.close();
    }
  }
  // Missing intro DOM → bootstrap with real age
  {
    const { context, page } = await newSeededContext(browser, SEEDS.B01_ENGLAND_16_ALL_HOME);
    try {
      await page.route("**/js/simulation/narrativeAcademySeason.js**", async (route) => {
        const src = await readFile(join(root, "js/simulation/narrativeAcademySeason.js"), "utf8");
        // Interpose by rewriting the export function body entry:
        const patched = src.replace(
          "export function pickThreeAcademies(pool, nationality = null, playerName = \"\", opts = {}) {",
          `export function pickThreeAcademies(pool, nationality = null, playerName = "", opts = {}) {
  globalThis.__fix14PickerCalls = globalThis.__fix14PickerCalls || [];
  globalThis.__fix14PickerCalls.push({ nationality, playerName, opts: opts && typeof opts === "object" ? { ...opts } : opts });
`
        );
        await route.fulfill({
          status: 200,
          contentType: "text/javascript",
          body: patched,
        });
      });
      await page.route(/\/(\?.*)?$/, async (route) => {
        if (route.request().resourceType() === "document") {
          const src = await readFile(join(root, "index.html"), "utf8");
          await route.fulfill({
            status: 200,
            contentType: "text/html",
            body: stripIntroDom(src),
          });
          return;
        }
        await route.continue();
      });
      await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      await fillSetup(page, { name: "Fix14 B05boot", nationality: "England", age: 18 });
      await startCareer(page);
      await waitFor(page, () => window.__getLiveCareerDebug?.()?.name === "Fix14 B05boot", 20000);
      const state = await page.evaluate(() => window.__getLiveCareerDebug?.());
      const calls = await page.evaluate(() => window.__fix14PickerCalls || []);
      assert(state?.name === "Fix14 B05boot", "bootstrap playable", state);
      assert(state?.age === 18, "age preserved", state);
      assert(calls.length >= 1, "picker observed", calls);
      assert(calls.some((c) => Number(c.opts?.age) === 18), "bootstrap forwarded age 18", calls);
      const entropy = await page.evaluate(() => window.__fix14Entropy);
      assert(entropy?.consumed === 1 && entropy?.matchingCalls === 1, "seed consumed once", entropy);
      const snap = await page.evaluate(() => window.__exportCareerSnapshot?.());
      const opening = snap?.player?.seasons?.[0];
      // Age-18 draw for this seed starts at Leeds (first domestic).
      assert(
        /Leeds/i.test(opening?.club || opening?.clubDisplay || state?.club || ""),
        "bootstrap used expected first academy",
        { opening, club: state?.club }
      );
      await shot(page, "B05-bootstrap");
      await dumpState(page, "B05-bootstrap");
      await writeFile(
        join(STATE_DIR, "B05-bootstrap-tray.json"),
        JSON.stringify({ calls, opening, club: state?.club, entropy }, null, 2)
      );
      await record("B05-bootstrap", "PASS", {
        age: state?.age,
        club: state?.club,
        openingClub: opening?.club,
        pickerAges: calls.map((c) => c.opts?.age),
      });
    } finally {
      await context.close();
    }
  }
  // Empty pool → startup error + setup usable
  {
    const { context, page } = await newSeededContext(browser, 1);
    try {
      await page.route("**/js/data/leagues.js**", async (route) => {
        const src = await readFile(join(root, "js/data/leagues.js"), "utf8");
        await route.fulfill({
          status: 200,
          contentType: "text/javascript",
          body: projectLeaguesSource(src, "empty"),
        });
      });
      await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      await fillSetup(page, { name: "Fix14 B05empty", nationality: "England", age: 16 });
      await page.click("#start-career-btn");
      const boot = await waitFor(
        page,
        () => {
          const el = document.getElementById("app-boot-error");
          if (el && !el.classList.contains("hidden") && /academy pool is empty/i.test(el.textContent || "")) {
            return el.textContent;
          }
          return null;
        },
        15000
      );
      const setupVisible = await page.evaluate(() => {
        const form = document.getElementById("setup-form");
        const start = document.getElementById("start-career-btn");
        const setupSection =
          document.getElementById("setup-section") ||
          document.querySelector(".career-setup-form")?.closest("section");
        return {
          formPresent: Boolean(form),
          formEnabled: Boolean(form && ![...form.elements].every((el) => el.disabled)),
          setupVisible: Boolean(setupSection && !setupSection.classList.contains("hidden")),
          startVisible: Boolean(start && start.offsetParent !== null && !start.classList.contains("hidden")),
          startEnabled: Boolean(start && !start.disabled),
          nameValue: document.getElementById("player-name")?.value || "",
        };
      });
      assert(/academy pool is empty/i.test(boot), "startup error", { boot });
      assert(setupVisible.setupVisible, "setup section visible", setupVisible);
      assert(setupVisible.startVisible && setupVisible.startEnabled, "Start Career visible+enabled", setupVisible);
      await shot(page, "B05-empty");
      await record("B05-empty", "PASS", { boot, setupVisible });
    } finally {
      await context.close();
    }
  }
  await record("B05", "PASS", { cases: ["one", "two", "bootstrap", "empty"] });
}

const FIX04_REQUIRED = [
  "continue-empty",
  "reject-offer",
  "final-empty-release",
  "final-offers",
  "double-continue",
  "pending-review-restore",
  "parent-shortcut-safe",
  "ordinary-career-graduate",
];

async function runB06(base) {
  note("B06: spawning existing Fix 04 academy checklist with pinned ordinary seed");
  const summaryPath = join(root, "qa/evidence/academy-checklist/checklist-summary.json");
  const stamp = Date.now();
  // Force a freshly generated summary — do not accept a pre-existing tracked PASS file.
  if (existsSync(summaryPath)) {
    await writeFile(join(STATE_DIR, `B06-preexisting-summary-${stamp}.json`), await readFile(summaryPath));
    const { unlink } = await import("node:fs/promises");
    await unlink(summaryPath);
  }
  const env = {
    ...process.env,
    BASE_URL: base,
    ACADEMY_OFFER_SEED: String(SEEDS.B06_ORDINARY),
  };
  const child = spawn(process.execPath, [join(root, "scripts/browserAcademyChecklist.mjs")], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => {
    stdout += d;
    process.stdout.write(d);
  });
  child.stderr.on("data", (d) => {
    stderr += d;
    process.stderr.write(d);
  });
  const code = await new Promise((resolve) => child.on("close", resolve));
  await writeFile(join(STATE_DIR, "B06-fix04-stdout.log"), stdout);
  await writeFile(join(STATE_DIR, "B06-fix04-stderr.log"), stderr);
  assert(code === 0, "Fix 04 checklist exit 0", { code, stderr: stderr.slice(-500) });
  assert(existsSync(summaryPath), "fresh Fix 04 summary written", { summaryPath });
  const summary = JSON.parse(await readFile(summaryPath, "utf8"));
  await writeFile(join(STATE_DIR, "B06-fix04-checklist-summary.json"), JSON.stringify(summary, null, 2));
  assert(summary.failed === 0 && summary.blocked === 0, "Fix 04 no failures", summary);
  assert(summary.passed === 8, "exactly eight passes", summary);
  const byName = Object.fromEntries((summary.results || []).map((r) => [r.name, r]));
  for (const name of FIX04_REQUIRED) {
    assert(byName[name]?.status === "PASS", `required PASS ${name}`, byName[name]);
  }
  const ordinary = byName["ordinary-career-graduate"];
  assert(ordinary?.seasons >= 2 && ordinary?.club, "ordinary senior terminal state", ordinary);
  // Validate child browser error log — only allow empty / no unexpected page errors.
  const childErrors = (summary.log || []).filter(
    (row) => row.consoleError || row.pageError || row.alert
  );
  const unexpectedChild = childErrors.filter((row) => {
    const text = row.consoleError || row.pageError || row.alert || "";
    if (/academy pool is empty/i.test(text)) return false;
    if (isDocumentedImageFailure(text)) return false;
    // reject-offer flow intentionally surfaces wage-headroom alerts.
    if (row.alert && isAssertedFix04Dialog(row.alert)) return false;
    return true;
  });
  assert(unexpectedChild.length === 0, "Fix 04 child unexpected errors", unexpectedChild);
  await record("B06", "PASS", {
    exit: code,
    passed: summary.passed,
    results: summary.results,
    ordinary,
    freshSummary: "qa/evidence/fix14-browser/B06-fix04-checklist-summary.json",
  });
}

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  await mkdir(STATE_DIR, { recursive: true });
  const { base, close } = await startServer();
  note("server", { base });
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const version = await browser.version();
  note("browser", { version, chrome: CHROME });

  const cases = [
    ["B01", () => runB01(browser, base)],
    ["B02", () => runB02(browser, base)],
    ["B03", () => runB03(browser, base)],
    ["B04", () => runB04(browser, base)],
    ["B05", () => runB05(browser, base)],
    ["B06", () => runB06(base)],
  ];

  for (const [name, fn] of cases) {
    try {
      await fn();
    } catch (err) {
      console.error(`FAIL ${name}:`, err.message, err.data || "");
      await record(name, "FAIL", { error: err.message, data: err.data });
    }
  }

  await browser.close();
  await close();

  const unexpected = runtimeErrors.filter((e) => !/academy pool is empty/i.test(e.text || ""));
  const summary = {
    base,
    browserVersion: version,
    seeds: SEEDS,
    results,
    failed: results.filter((r) => r.status === "FAIL").length,
    passed: results.filter((r) => r.status === "PASS").length,
    runtimeErrors: unexpected,
    log,
  };
  await writeFile(join(STATE_DIR, "browser-summary.json"), JSON.stringify(summary, null, 2));
  await writeFile(join(STATE_DIR, "runtime-errors.json"), JSON.stringify(unexpected, null, 2));
  console.log("\n=== Fix 14 browser checklist ===");
  console.log(JSON.stringify(results, null, 2));
  if (summary.failed > 0 || unexpected.length > 0) {
    console.error("Unexpected errors:", unexpected);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
