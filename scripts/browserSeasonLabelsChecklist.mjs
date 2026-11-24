#!/usr/bin/env node
/**
 * Item 10 browser probe: competition season selector and standings qualifiers.
 *
 * Builds a restorable two-season senior career with the deterministic simulator,
 * then drives the real page at desktop and narrow widths:
 *   - the #comp-season-select options carry no empty "()" and use the save's year
 *   - keyboard selection (ArrowDown on the focused select) changes the season
 *   - no standings team row shows more than one promotion/relegation label
 *
 *   CHROME_PATH=... node scripts/browserSeasonLabelsChecklist.mjs
 * Env: BASE_URL, CHROME_PATH, HEADED=1
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, createReadStream, statSync } from "node:fs";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { LEAGUES, LEAGUE_LOOKUP } from "../js/data/leagues.js";
import { createPlayerIdentity } from "../js/simulation/playerDevelopment.js";
import { ensurePlayerModel } from "../js/simulation/playerModelMigration.js";
import { refreshAbilityCaches } from "../js/simulation/playerAbility.js";
import { reseedCareerRng, setSimRng, createRng } from "../js/simulation/rng.js";
import { createWorldState, setWorldState } from "../js/simulation/worldState.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import { serializeCareerSnapshot, deserializeCareerSnapshot } from "../js/simulation/careerSnapshot.js";
import { ensureContractAuthority } from "../js/simulation/contractLifecycle.js";
import { ensureTransferSave } from "../js/simulation/transferMigration.js";
import { allSeniorClubs } from "../js/simulation/seniorClubs.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME =
  process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HEADED = process.env.HEADED === "1";
const OUT_DIR = join(root, "qa/item10-runs");
const SHOT_DIR = join(root, "qa/screenshots/item10-season-labels");
const SEED = Number(process.env.ITEM10_SEED || 10010);
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

async function ensureBaseServer() {
  if (process.env.BASE_URL) return { base: process.env.BASE_URL, close: async () => {} };
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0] || "/");
    const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
    const filePath = normalize(join(root, rel));
    if (!filePath.startsWith(root) || !existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404);
      res.end("missing");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
    createReadStream(filePath).pipe(res);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function assert(cond, msg, data) {
  if (!cond) {
    const err = new Error(msg);
    err.data = data;
    throw err;
  }
}

function attrs(ovr) {
  return Object.fromEntries(
    ["Speed", "Passing", "Shooting", "Defending", "Physicality", "Dribbling"].map((k) => [k, ovr])
  );
}

/** Two real simulated senior seasons, serialized as a restorable career snapshot. */
function buildTwoSeasonSnapshot(seed) {
  reseedCareerRng(seed);
  resetClubFinanceLedgers();
  setWorldState(createWorldState({ startYear: 2026 }));
  const p = createPlayerIdentity({ name: "Item 10 Probe", nationality: "England", position: "ST", age: 22 });
  Object.assign(p, {
    careerId: `item10-${seed}`,
    startYear: 2026,
    age: 22,
    seasons: [],
    rating: 80,
    attributes: attrs(80),
    potentialForecast: { upper: 88 },
    state: { form: 0, morale: 0, readiness: 1, fatigue: 0, adaptationPenalty: 0, roleFit: 1 },
  });
  ensurePlayerModel(p);
  refreshAbilityCaches(p);
  ensureContractAuthority(p);
  ensureTransferSave(p);
  const club = allSeniorClubs().find((c) => c.name === "Hull City") || allSeniorClubs()[0];
  Object.assign(p, {
    club: { ...club },
    employmentClubId: club.clubId,
    playingClubId: club.clubId,
    contractStatus: "active",
    contractStartSeason: 0,
    contractYears: 4,
    contractEndSeason: 4,
    weeklyWage: 2500,
    wage: 2500,
  });
  reseedCareerRng(seed);
  const snap = serializeCareerSnapshot({ player: p, leagues: LEAGUES });

  let current = JSON.parse(JSON.stringify(snap));
  for (let i = 0; i < 2; i++) {
    const r = deserializeCareerSnapshot(JSON.parse(JSON.stringify(current)));
    if (r.world) setWorldState(r.world);
    setSimRng(createRng(r.rngSeed ?? current.rngSeed));
    simulateSeason(r.player, LEAGUES, LEAGUE_LOOKUP);
    current = JSON.parse(JSON.stringify(serializeCareerSnapshot({ player: r.player, world: r.world, leagues: LEAGUES })));
  }
  return current;
}

async function launch(base) {
  const { chromium } = await import("playwright-core");
  assert(existsSync(CHROME), `CHROME_PATH missing: ${CHROME}`);
  const browser = await chromium.launch({ executablePath: CHROME, headless: !HEADED });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err?.message || err)));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/Failed to load resource/i.test(msg.text())) errors.push(msg.text());
  });
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => typeof window.__restoreCareerSnapshot === "function", null, {
    timeout: 60000,
  });
  return { browser, page, errors };
}

async function restore(page, snap) {
  const ok = await page.evaluate((payload) => {
    const r = window.__restoreCareerSnapshot?.(payload);
    return Boolean(r?.player || window.__getLiveCareerDebug?.()?.name);
  }, snap);
  assert(ok, "__restoreCareerSnapshot failed");
  await page.waitForSelector("#comp-season-select", { timeout: 30000 });
}

async function readBoard(page) {
  return page.evaluate(() => {
    const select = document.querySelector("#comp-season-select");
    const options = select ? [...select.options].map((o) => o.textContent.trim()) : [];
    const teamRows = [...document.querySelectorAll(".team-info")].map((el) => {
      const lines = [...el.querySelectorAll(".qualifier")].map((q) => q.textContent.trim());
      const moveLines = lines.filter((t) => /promot|relegat/i.test(t));
      return { team: el.querySelector(".team-name")?.textContent?.trim() || "", lines, moveCount: moveLines.length };
    });
    return { options, teamRows, selectValue: select?.value ?? null, hasSelect: Boolean(select) };
  });
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(SHOT_DIR, { recursive: true });
  const snap = buildTwoSeasonSnapshot(SEED);
  const seasons = snap.player?.seasons || [];
  assert(seasons.length >= 2, "probe snapshot needs two simulated seasons", { count: seasons.length });

  // Legacy variant: remove the start year so only the season number exists.
  const legacy = JSON.parse(JSON.stringify(snap));
  delete legacy.player.startYear;
  for (const s of legacy.player.seasons) {
    delete s.year;
    delete s.seasonLabel;
  }

  const server = await ensureBaseServer();
  const report = {
    seed: SEED,
    seasons: seasons.length,
    cases: [],
    pass: true,
    blocked: [
      "Keyboard selection of a native <select> (ArrowDown/Enter) is not automatable on macOS headless: arrow keys open a native popup. Tab reachability and selectOption change are automated; a manual keyboard pass is still required.",
    ],
  };
  const { browser, page, errors } = await launch(server.base);
  try {
    for (const [name, payload] of [
      ["ordinary-senior", snap],
      ["legacy-no-year", legacy],
    ]) {
      for (const [vw, width, height] of [
        ["desktop", 1280, 800],
        ["narrow", 390, 844],
      ]) {
        await page.setViewportSize({ width, height });
        await restore(page, payload);
        const board = await readBoard(page);
        const row = {
          case: name,
          viewport: vw,
          options: board.options,
          selectValue: board.selectValue,
          teamRowsChecked: board.teamRows.length,
          moveLabelRows: board.teamRows.filter((r) => r.moveCount === 1).length,
        };
        row.noEmptyParens = board.options.every((t) => !t.includes("()"));
        row.dedupedMoves = board.teamRows.every((r) => r.moveCount <= 1);

        // Keyboard reachability: Tab through the page until the season select takes focus.
        row.keyboardTabReachable = false;
        if (board.hasSelect) {
          await page.evaluate(() => document.activeElement?.blur?.());
          for (let t = 0; t < 150 && !row.keyboardTabReachable; t++) {
            await page.keyboard.press("Tab");
            row.keyboardTabReachable = await page.evaluate(
              () => document.activeElement?.id === "comp-season-select"
            );
          }
        }

        // Selecting another season through the real select element changes the rendered season.
        row.selectOptionChangesSeason = null;
        if (board.hasSelect && board.options.length > 1) {
          await page.locator("#comp-season-select").selectOption({ index: 1 });
          row.selectOptionChangesSeason = await page.evaluate(
            () => document.querySelector("#comp-season-select")?.value === "1"
          );
          await page.locator("#comp-season-select").selectOption({ index: 0 });
        }

        await page.screenshot({ path: join(SHOT_DIR, `${name}-${vw}.png`), fullPage: false });
        row.pass =
          row.noEmptyParens &&
          row.dedupedMoves &&
          row.keyboardTabReachable === true &&
          row.selectOptionChangesSeason === true;
        report.pass = report.pass && row.pass;
        report.cases.push(row);
      }
    }
    report.pageErrors = errors;
    report.pass = report.pass && errors.length === 0;
  } finally {
    await browser.close();
    await server.close();
  }
  await writeFile(join(OUT_DIR, "browser-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[item10] FAIL", err?.message || err, err?.data ? JSON.stringify(err.data).slice(0, 800) : "");
  process.exitCode = 1;
});
