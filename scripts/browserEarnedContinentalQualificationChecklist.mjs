#!/usr/bin/env node
/**
 * Browser acceptance for Fix 09: earned continental qualification.
 *
 * Real journeys through #simulate-btn / presentation skips / #continue-btn / Accept.
 * Authoritative state from window.__exportCareerSnapshot (not window.player).
 * Seed world.qualification in Node via commitCompletedDomesticEdition before serialize.
 *
 *   BASE_URL=http://127.0.0.1:8000 node scripts/browserEarnedContinentalQualificationChecklist.mjs
 *
 * Env: BASE_URL, CHROME_PATH, CASES, HEADED=1
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, createReadStream, statSync } from "node:fs";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { LEAGUES } from "../js/data/leagues.js";
import { createPlayerIdentity } from "../js/simulation/playerDevelopment.js";
import { ensurePlayerModel } from "../js/simulation/playerModelMigration.js";
import { refreshAbilityCaches } from "../js/simulation/playerAbility.js";
import { reseedCareerRng } from "../js/simulation/rng.js";
import { createWorldState, setWorldState, getWorldState } from "../js/simulation/worldState.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import { serializeCareerSnapshot } from "../js/simulation/careerSnapshot.js";
import { ensureContractAuthority } from "../js/simulation/contractLifecycle.js";
import { ensureTransferSave } from "../js/simulation/transferMigration.js";
import { qualificationForPosition, findSisterLeagues } from "../js/simulation/leaguePhase.js";
import {
  commitCompletedDomesticEdition,
  ensureBootstrapDomesticEdition,
  getClubTargetDecision,
} from "../js/simulation/earnedQualification.js";
import { preSeasonContinentalStanding } from "../js/simulation/chronologicalSeason.js";
import { prepareContinentalEdition } from "../js/simulation/continentalTournament.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HEADED = process.env.HEADED === "1";
const RUN_DIR = join(root, "qa/fix09-runs/browser");
const SHOT_DIR = join(root, "qa/screenshots/checklist-earned-continental");
const CASE_DIR = join(RUN_DIR, "cases");
const SNAP_DIR = join(RUN_DIR, "snapshots");
const OUT = join(RUN_DIR, "browser-report.json");
const REQUIRED = ["B01", "B02", "B03", "B04", "B05", "B06", "B07", "B08", "B09"];
const SELECTED = process.env.CASES
  ? process.env.CASES.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
  : REQUIRED;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

const EPL = "league:england-premier-league";
const ARSENAL = "club:england:arsenal";
const BRENTFORD = "club:england:brentford";

async function ensureBaseServer() {
  if (process.env.BASE_URL) {
    return { base: process.env.BASE_URL, close: async () => {} };
  }
  const server = createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0] || "/");
      const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
      const filePath = normalize(join(root, rel));
      if (!filePath.startsWith(root)) {
        res.writeHead(403);
        res.end("forbidden");
        return;
      }
      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        res.writeHead(404);
        res.end("missing");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
      createReadStream(filePath).pipe(res);
    } catch (err) {
      res.writeHead(500);
      res.end(String(err?.message || err));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function assert(cond, msg, data) {
  if (!cond) {
    const err = new Error(msg);
    if (data !== undefined) err.data = data;
    throw err;
  }
}
function jsonClone(v) {
  return JSON.parse(JSON.stringify(v));
}
function attrs(ovr) {
  return Object.fromEntries(
    ["Speed", "Passing", "Shooting", "Defending", "Physicality", "Dribbling"].map((k) => [k, ovr])
  );
}
function leagueById(id) {
  return LEAGUES.find((l) => l.leagueId === id);
}
function topFlight(nation) {
  return LEAGUES.find((l) => l.nation === nation && (l.divisionLevel ?? 1) === 1);
}
function clubIn(league, clubId) {
  return league.clubs.find((c) => c.clubId === clubId);
}

function orderedTable(league, placements = {}) {
  const sisters = findSisterLeagues(league, LEAGUES);
  const placed = new Map(Object.entries(placements));
  const remaining = league.clubs.filter((c) => ![...placed.values()].includes(c.clubId));
  const slots = Array.from({ length: league.clubs.length }, () => null);
  for (const [posStr, clubId] of placed) slots[Number(posStr) - 1] = clubIn(league, clubId);
  let r = 0;
  for (let i = 0; i < slots.length; i++) if (!slots[i]) slots[i] = remaining[r++];
  return slots.map((c, i) => {
    const position = i + 1;
    return {
      ...c,
      position,
      points: Math.max(0, 100 - i * 3),
      matches: 38,
      wins: 20,
      draws: 8,
      losses: 10,
      goalsFor: 50 - i,
      goalsAgainst: 20 + i,
      goalDiff: 30 - 2 * i,
      qualification: qualificationForPosition(position, league, sisters) || "",
    };
  });
}

function makePlayer({ id, position = "CM", ovr = 72, age = 22, seed = 9101 }) {
  reseedCareerRng(seed);
  resetClubFinanceLedgers();
  setWorldState(createWorldState({ startYear: 2026, seed, careerSeed: seed }));
  const p = createPlayerIdentity({ name: id, nationality: "England", position, age });
  Object.assign(p, {
    careerId: id,
    startYear: 2026,
    age,
    seasons: [],
    rating: ovr,
    attributes: attrs(ovr),
    potentialForecast: { upper: ovr + 8 },
    state: { form: 0, morale: 0, readiness: 1, fatigue: 0, adaptationPenalty: 0, roleFit: 1 },
  });
  ensurePlayerModel(p);
  refreshAbilityCaches(p);
  ensureContractAuthority(p);
  ensureTransferSave(p);
  return p;
}

function attachById(p, league, clubId, years = 4) {
  const club = clubIn(league, clubId);
  if (!club) throw new Error(`missing ${clubId}`);
  Object.assign(p, {
    club: { ...club, league: league.name, leagueId: league.leagueId, nation: league.nation },
    employmentClubId: club.clubId,
    playingClubId: club.clubId,
    contractStatus: "active",
    contractStartSeason: 0,
    contractYears: years,
    contractEndSeason: years,
    weeklyWage: 2500,
    wage: 2500,
  });
  return club;
}

/** Seed earned domestic finishes then serialize a restoreable career snapshot. */
function buildSeededSnap({
  id,
  clubId,
  leagueId = EPL,
  ovr = 74,
  seed = 9101,
  age = 22,
  position = "CM",
  placements = null,
  sourceYear = 2025,
  freeAgent = false,
  employmentClubId = null,
  playingClubId = null,
  stalePlayerRowClubId = null,
  prepareEdition = false,
  prepareSeasonYear = 2026,
}) {
  const league = leagueById(leagueId) || topFlight(leagueId) || leagueById(EPL);
  const p = makePlayer({ id, position, ovr, age, seed });
  if (freeAgent) {
    p.contractStatus = "released";
    p.employmentClubId = null;
    p.playingClubId = null;
    p.club = null;
  } else {
    attachById(p, league, clubId || playingClubId || ARSENAL);
  }
  if (employmentClubId) p.employmentClubId = employmentClubId;
  if (playingClubId) {
    p.playingClubId = playingClubId;
    const playClub = clubIn(league, playingClubId);
    if (playClub) {
      p.club = { ...playClub, league: league.name, leagueId: league.leagueId, nation: league.nation };
    }
  }
  const world = getWorldState();
  const table = orderedTable(
    league,
    placements || { 1: ARSENAL, 17: BRENTFORD }
  );
  commitCompletedDomesticEdition({ world, league, table, sourceYear });
  if (stalePlayerRowClubId) {
    const row = table.find((r) => r.clubId === stalePlayerRowClubId) || table[0];
    p.latestStanding = {
      leagueId: league.leagueId,
      seasonId: `${league.leagueId}::${sourceYear}`,
      table,
      playerRow: row,
    };
  }
  if (prepareEdition && !freeAgent) {
    const standing = preSeasonContinentalStanding(p, league, { world, seasonYear: prepareSeasonYear });
    if (standing) {
      prepareContinentalEdition({ standing, league, player: p, seasonYear: prepareSeasonYear, world });
    }
  }
  reseedCareerRng(seed);
  const snap = serializeCareerSnapshot({ player: p, world: getWorldState() });
  return snap;
}

function europeOf(player) {
  const last = Array.isArray(player?.seasons) ? player.seasons.at(-1) : null;
  const eu = last?.europeanCampaign || null;
  return {
    competition: eu?.competition || null,
    qualified: Boolean(eu && eu.qualified !== false),
    editionId: eu?.editionId || null,
    competitionId: eu?.competitionId || null,
    result: eu?.result || null,
    matchCount: Array.isArray(eu?.playerMatches) ? eu.playerMatches.length : 0,
  };
}

function qualEntries(snap) {
  return Array.isArray(snap?.world?.qualification) ? snap.world.qualification : [];
}

function clubDecision(snap, clubId, targetYear) {
  const map = new Map(qualEntries(snap));
  const pointer = map.get(`club:${clubId}::target:${targetYear}`);
  if (!pointer?.domesticKey) return null;
  const edition = map.get(pointer.domesticKey);
  return edition?.entries?.[clubId] || null;
}

function editionSummary(snap, competitionId = "uefa-champions-league", editionId = "2026-uefa-champions-league") {
  const editions = Array.isArray(snap?.world?.editions) ? snap.world.editions : [];
  const hit = editions.find(([, e]) => e?.competitionId === competitionId || e?.editionId === editionId);
  const ed = hit?.[1] || null;
  if (!ed) return null;
  const field = ed.field || ed.lifecycle?.field || ed.participants || [];
  return {
    editionId: ed.editionId || null,
    competitionId: ed.competitionId || null,
    playerClubId: ed.playerClubId || null,
    field: field.map((c) => c.clubId || c).sort(),
    fieldSize: field.length,
  };
}

function qualSummary(player, snap) {
  const eu = europeOf(player);
  return {
    age: player?.age ?? null,
    seasons: player?.seasons?.length ?? 0,
    club: player?.club?.name ?? null,
    employmentClubId: player?.employmentClubId ?? null,
    playingClubId: player?.playingClubId ?? null,
    contractStatus: player?.contractStatus ?? null,
    rating: player?.rating ?? null,
    europe: eu,
    arsenal2026: clubDecision(snap, ARSENAL, 2026),
    brentford2026: clubDecision(snap, BRENTFORD, 2026),
    edition: editionSummary(snap),
  };
}

function slimEvidence(snapOrBundle) {
  if (!snapOrBundle || typeof snapOrBundle !== "object") return snapOrBundle;
  const base = snapOrBundle.snapshot ? snapOrBundle : { snapshot: snapOrBundle };
  const snap = base.snapshot;
  const player = snap?.player;
  const summary = qualSummary(player, snap);
  return {
    ...("debug" in base ? { debug: base.debug } : {}),
    ...("ui" in base ? { ui: base.ui } : {}),
    ...("trace" in base ? { trace: base.trace } : {}),
    player: player
      ? {
          name: player.name,
          careerId: player.careerId,
          age: player.age,
          rating: player.rating,
          contractStatus: player.contractStatus,
          employmentClubId: player.employmentClubId,
          playingClubId: player.playingClubId,
          club: player.club
            ? { name: player.club.name, clubId: player.club.clubId, league: player.club.league }
            : null,
          seasons: (player.seasons || []).map((s) => ({
            seasonId: s.seasonId,
            minutes: s.minutes,
            europe: europeOf({ seasons: [s] }),
          })),
          latestStanding: player.latestStanding
            ? {
                leagueId: player.latestStanding.leagueId,
                seasonId: player.latestStanding.seasonId,
                playerRowClubId: player.latestStanding.playerRow?.clubId || null,
                playerRowPosition: player.latestStanding.playerRow?.position ?? null,
              }
            : null,
        }
      : null,
    qualification: summary,
    qualKeys: qualEntries(snap).map(([k]) => k).slice(0, 40),
  };
}

async function writeCase(name, value) {
  await writeFile(join(CASE_DIR, name), JSON.stringify(value, null, 2));
}
async function writeFullSnapshot(name, snapOrBundle) {
  await mkdir(SNAP_DIR, { recursive: true });
  const payload = snapOrBundle?.snapshot ? snapOrBundle.snapshot : snapOrBundle;
  await writeFile(join(SNAP_DIR, name), JSON.stringify(payload));
}

async function launch(base) {
  const { chromium } = await import("playwright-core");
  if (!existsSync(CHROME)) throw new Error(`CHROME_PATH missing: ${CHROME}`);
  const browser = await chromium.launch({ executablePath: CHROME, headless: !HEADED });
  const page = await browser.newPage();
  const guards = { errors: [], warnings: [], failedRequests: [] };
  page.on("pageerror", (err) => guards.errors.push({ type: "pageerror", message: String(err?.message || err) }));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/Failed to load resource/i.test(text)) guards.warnings.push({ type: "console", message: text });
    else guards.errors.push({ type: "console", message: text });
  });
  page.on("requestfailed", (req) => {
    const url = req.url();
    if (/\.(png|jpe?g|gif|svg|ico|woff2?)(\?|$)/i.test(url)) return;
    guards.failedRequests.push({ url, error: req.failure()?.errorText || "failed" });
  });
  page.on("dialog", async (dialog) => {
    guards.warnings.push({ type: "dialog", message: dialog.message() });
    await dialog.dismiss().catch(() => {});
  });
  let lastErr = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const resp = await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
      if (!resp || !resp.ok()) throw new Error(`BASE_URL failed: ${base} status=${resp?.status()}`);
      await page.waitForFunction(() => typeof window.__restoreCareerSnapshot === "function", null, {
        timeout: 60000,
      });
      await page.waitForFunction(() => typeof window.__exportCareerSnapshot === "function", null, {
        timeout: 60000,
      });
      return { browser, page, guards };
    } catch (err) {
      lastErr = err;
      await page.waitForTimeout(500 * attempt);
    }
  }
  throw lastErr || new Error(`BASE_URL failed after retries: ${base}`);
}

async function restore(page, snap) {
  const ok = await page.evaluate((payload) => {
    const r = window.__restoreCareerSnapshot?.(payload);
    return Boolean(r?.player || window.__getLiveCareerDebug?.()?.name);
  }, snap);
  assert(ok, "__restoreCareerSnapshot failed");
}

async function exportSnapshot(page) {
  const snap = await page.evaluate(() => window.__exportCareerSnapshot?.() || null);
  assert(snap?.player, "__exportCareerSnapshot returned no player");
  return jsonClone(snap);
}

async function freshRestore(page, snap) {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => typeof window.__restoreCareerSnapshot === "function", null, {
    timeout: 60000,
  });
  await restore(page, snap);
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
      continueSectionVisible: Boolean(animContinue && !animContinue.classList.contains("hidden")),
      continueBtnVisible: visibleBtn(contBtn),
      continueBtnDisabled: Boolean(contBtn?.disabled),
      simulateDisabled: Boolean(sim?.disabled),
      simulateLabel: sim?.textContent || "",
      seasonActionInFlight: Boolean(d?.seasonActionInFlight),
      nextAction: d?.nextAction || null,
    };
  });
}

async function shot(page, name) {
  await mkdir(SHOT_DIR, { recursive: true });
  const path = join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}

async function driveSeasonToDesk(
  page,
  { seasonsBefore, timeoutMs = 180000, shotPrefix = null, deskPolicy = "stay", alreadyRunning = false } = {}
) {
  const trace = {
    simulateClicks: 0,
    skipClicks: 0,
    postCommitContinueClicks: 0,
    preCommitContinueClicks: 0,
    deskDecisions: [],
    deskPolicy,
    alreadyRunning,
  };
  const ui0 = await uiState(page);
  if (!alreadyRunning) {
    assert(ui0.simulateDisabled === false, "simulate must be enabled", ui0);
    await page.click("#simulate-btn");
    trace.simulateClicks += 1;
  }
  let beforeContinue = null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cur = await uiState(page);
    const seasonsNow = cur.debug?.seasonsCount ?? null;
    const committed = typeof seasonsNow === "number" && seasonsNow > seasonsBefore;
    if (committed && !beforeContinue) {
      beforeContinue = {
        debug: await debug(page),
        snapshot: await exportSnapshot(page),
        ui: { overlayHidden: cur.overlayHidden, dashboardHidden: cur.dashboardHidden },
      };
      if (shotPrefix) await shot(page, `${shotPrefix}-before-continue`);
    }
    if (
      committed &&
      beforeContinue &&
      cur.overlayHidden &&
      cur.dashboardHidden &&
      cur.seasonActionInFlight === false &&
      (trace.postCommitContinueClicks >= 1 ||
        cur.nextAction?.id === "start-season" ||
        cur.debug?.nextAction?.id === "start-season")
    ) {
      return { trace, beforeContinue, final: cur };
    }
    const holdContinue = !beforeContinue;
    const act = await page.evaluate(
      ({ seasonsBefore: sb, hold, deskPolicy: policy, allowRearm, deskDecisionCount }) => {
        const clicked = [];
        const d = window.__getLiveCareerDebug?.() || {};
        const nowCommitted = (d.seasonsCount ?? 0) > sb;
        const senior = document.getElementById("senior-scenario-overlay");
        if (senior && !senior.classList.contains("hidden")) {
          const choice = [...senior.querySelectorAll("button")].find((b) => !b.disabled);
          if (choice) {
            choice.click();
            clicked.push("scenario");
            return clicked;
          }
        }
        const overlay = document.getElementById("season-animation-overlay");
        const dashboard = document.getElementById("simulation-dashboard");
        const overlayHidden = !overlay || overlay.classList.contains("hidden");
        const dashboardHidden = !dashboard || dashboard.classList.contains("hidden");
        const deskClear = overlayHidden && dashboardHidden;
        const needsDecision =
          d.nextAction?.id === "resolve-decision" ||
          d.nextAction?.id === "resolve-offers" ||
          d.seasonCheckpoint === "awaiting_decision" ||
          Boolean(d.pendingDecision);
        if (needsDecision && deskClear) {
          const tray = document.getElementById("transfer-offers") || document.body;
          const trayButtons = [...tray.querySelectorAll("button")].filter(
            (b) => !b.disabled && b.offsetParent !== null
          );
          const decisionActions = [
            ...tray.querySelectorAll("[data-decision-actions] button, .career-decision-card button"),
          ].filter((b) => !b.disabled && b.offsetParent !== null);
          const pool = decisionActions.length ? decisionActions : trayButtons;
          const isSkipLike = (t) => /skip remaining|skip phase|skip match|skip season/i.test(t);
          // Stay path: clear inbound offers so the season can resume.
          if (policy === "stay" || policy === "decline-offers") {
            const decline =
              trayButtons.find((b) => /decline offers and continue at/i.test(b.textContent || "")) ||
              trayButtons.find((b) => /decline all|decline offers|no thanks/i.test(b.textContent || "")) ||
              trayButtons.find((b) => /^decline$/i.test((b.textContent || "").trim()));
            if (decline) {
              decline.click();
              clicked.push(`desk-decision:${(decline.textContent || "").trim()}`);
              return clicked;
            }
          }
          if (policy === "accept-cross-league" || policy === "accept-move") {
            const loanTray =
              trayButtons.find((b) => /review loan options|see loan|loan options/i.test(b.textContent || "")) ||
              null;
            if (loanTray) {
              loanTray.click();
              clicked.push(`desk-decision:${(loanTray.textContent || "").trim()}`);
              return clicked;
            }
            const accept =
              trayButtons.find((b) =>
                /accept loan|accept offer|accept transfer|sign for/i.test(b.textContent || "")
              ) || trayButtons.find((b) => /^accept$/i.test((b.textContent || "").trim()));
            if (accept) {
              accept.click();
              clicked.push(`desk-decision:${(accept.textContent || "").trim()}`);
              return clicked;
            }
          }
          const decisionBtn =
            pool.find((b) => /^stay and compete$/i.test((b.textContent || "").trim())) ||
            pool.find((b) => /^continue the season$/i.test((b.textContent || "").trim())) ||
            pool.find((b) => /^focus on recovery$/i.test((b.textContent || "").trim())) ||
            pool.find((b) => /^keep working$/i.test((b.textContent || "").trim())) ||
            pool.find((b) => /^remain at the club$/i.test((b.textContent || "").trim())) ||
            pool.find((b) => /^see out the contract$/i.test((b.textContent || "").trim())) ||
            pool.find((b) =>
              /^(acknowledge|see it out|remain|stay|understood|got it)$/i.test((b.textContent || "").trim())
            ) ||
            pool.find((b) => {
              const t = (b.textContent || "").trim();
              if (isSkipLike(t)) return false;
              if (/review loan|see loan|decline offers|accept|sign for|seek a|request a permanent|ask to be sold/i.test(t))
                return false;
              return /stay and compete|continue the season|focus on recovery|keep working|see it out|remain at the club|^acknowledge$/i.test(
                t
              );
            });
          if (decisionBtn) {
            decisionBtn.click();
            clicked.push(`desk-decision:${(decisionBtn.textContent || "").trim()}`);
            return clicked;
          }
          return clicked;
        }
        const section = document.getElementById("animation-continue");
        const contBtn = document.getElementById("continue-btn");
        const continueReady = Boolean(
          section &&
            !section.classList.contains("hidden") &&
            contBtn &&
            !contBtn.disabled &&
            contBtn.offsetParent !== null
        );
        if (continueReady) {
          if (hold && nowCommitted) {
            clicked.push("hold-for-snapshot");
            return clicked;
          }
          contBtn.click();
          clicked.push(nowCommitted ? "continue-btn:post-commit" : "continue-btn:pre-commit");
          return clicked;
        }
        if (!deskClear) {
          for (const id of ["sim-skip-phase-btn", "match-skip-phase-btn", "sim-skip-match-btn", "match-skip-btn"]) {
            const el = document.getElementById(id);
            if (el && !el.disabled && el.offsetParent !== null) {
              el.click();
              clicked.push(id);
            }
          }
        }
        const midSeasonDesk = deskClear && !nowCommitted && !needsDecision;
        if (midSeasonDesk) {
          const host = document.getElementById("transfer-offers");
          const rootEl = host || document.body;
          const buttons = [...rootEl.querySelectorAll("button")].filter(
            (b) => !b.disabled && b.offsetParent !== null
          );
          if (policy === "accept-cross-league" || policy === "accept-move") {
            const loanTray =
              buttons.find((b) => /review loan options|see loan|loan options/i.test(b.textContent || "")) || null;
            if (loanTray) {
              loanTray.click();
              clicked.push(`desk-decision:${(loanTray.textContent || "").trim()}`);
              return clicked;
            }
            const accept =
              buttons.find((b) => /accept loan|accept offer|accept transfer|sign for/i.test(b.textContent || "")) ||
              buttons.find((b) => /^accept$/i.test((b.textContent || "").trim()));
            if (accept) {
              accept.click();
              clicked.push(`desk-decision:${(accept.textContent || "").trim()}`);
              return clicked;
            }
          }
          const stayBtn =
            buttons.find((b) => /^stay and compete$/i.test((b.textContent || "").trim())) ||
            buttons.find((b) => /decline offers and continue at/i.test(b.textContent || "")) ||
            buttons.find((b) => /^acknowledge$|^see it out$|^remain$/i.test((b.textContent || "").trim()));
          if (stayBtn && deskDecisionCount === 0) {
            stayBtn.click();
            clicked.push(`desk-decision:${(stayBtn.textContent || "").trim()}`);
            return clicked;
          }
          const sim = document.getElementById("simulate-btn");
          const simLabel = (sim?.textContent || "").trim();
          if (sim && !sim.disabled) {
            if (/continue season|resume/i.test(simLabel)) {
              sim.click();
              clicked.push("resume-season");
            } else if (allowRearm && /simulate/i.test(simLabel)) {
              sim.click();
              clicked.push("rearm-simulate");
            }
          }
        }
        return clicked;
      },
      {
        seasonsBefore,
        hold: holdContinue,
        deskPolicy,
        allowRearm: trace.deskDecisions.length > 0,
        deskDecisionCount: trace.deskDecisions.length,
      }
    );
    for (const c of act) {
      if (c === "continue-btn:post-commit") trace.postCommitContinueClicks += 1;
      else if (c === "continue-btn:pre-commit") trace.preCommitContinueClicks += 1;
      else if (c.startsWith("desk-decision:")) trace.deskDecisions.push(c.slice("desk-decision:".length));
      else if (/skip/i.test(c)) trace.skipClicks += 1;
    }
    await page.waitForTimeout(act.length && !act.includes("hold-for-snapshot") ? 140 : 220);
  }
  throw new Error(
    `Timed out returning to desk: ${JSON.stringify({ seasonsBefore, trace, ui: await uiState(page) })}`
  );
}

async function assertDeskUsable(page) {
  const ui = await uiState(page);
  assert(ui.overlayHidden, "overlay must be closed at desk", ui);
  assert(ui.dashboardHidden, "dashboard must be closed at desk", ui);
  assert(ui.seasonActionInFlight === false, "seasonActionInFlight must be false", ui);
  assert(ui.simulateDisabled === false || ui.nextAction != null, "desk must expose a next action", ui);
  return ui;
}

function relevantErrors(guards) {
  return [...guards.errors, ...guards.failedRequests.map((r) => ({ type: "requestfailed", ...r }))];
}

const cases = {
  /** Same-club earned rollover: seeded CL finish → season → Continue preserves entry. */
  async B01(page, guards) {
    const snap = buildSeededSnap({
      id: "fix09-b01",
      clubId: ARSENAL,
      seed: 9101,
      ovr: 78,
      placements: { 1: ARSENAL, 17: BRENTFORD },
    });
    await writeCase("B01-initial.json", slimEvidence(snap));
    await writeFullSnapshot("B01-initial.full.json", snap);
    await restore(page, snap);
    await shot(page, "B01-01-start");
    assert(clubDecision(snap, ARSENAL, 2026)?.competition === "Champions League", "seed Arsenal CL");
    const driven = await driveSeasonToDesk(page, { seasonsBefore: 0, shotPrefix: "B01" });
    const desk = await exportSnapshot(page);
    await writeCase("B01-before-continue.json", slimEvidence(driven.beforeContinue));
    await writeCase("B01-desk.json", slimEvidence(desk));
    const before = qualSummary(driven.beforeContinue.snapshot.player, driven.beforeContinue.snapshot);
    const after = qualSummary(desk.player, desk);
    assert(before.seasons >= 1, "season must complete", before);
    assert(before.europe.qualified && before.europe.competition === "Champions League", "same-club CL entry", before);
    assert(after.seasons === before.seasons && after.age === before.age, "Continue exact-once", { before, after });
    assert(after.europe.competition === before.europe.competition, "Continue preserves Europe", { before, after });
    assert(after.arsenal2026?.competition === "Champions League" || after.arsenal2026?.position === 1, "registry retained", after);
    await assertDeskUsable(page);
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    return { ok: true, before, after, continued: true };
  },

  /** Off-season Arsenal→Brentford: no CL inheritance; fresh-page restore. */
  async B02(page, guards) {
    const snap = buildSeededSnap({
      id: "fix09-b02",
      clubId: BRENTFORD,
      seed: 9102,
      ovr: 76,
      placements: { 1: ARSENAL, 17: BRENTFORD },
      stalePlayerRowClubId: ARSENAL,
    });
    await writeCase("B02-initial.json", slimEvidence(snap));
    await writeFullSnapshot("B02-initial.full.json", snap);
    await restore(page, snap);
    await shot(page, "B02-01-start");
    assert(clubDecision(snap, BRENTFORD, 2026)?.status === "not-qualified", "Brentford DNQ seeded");
    const driven = await driveSeasonToDesk(page, { seasonsBefore: 0, shotPrefix: "B02" });
    const desk = await exportSnapshot(page);
    await writeCase("B02-desk.json", slimEvidence(desk));
    const sum = qualSummary(desk.player, desk);
    assert(sum.playingClubId === BRENTFORD, "still Brentford", sum);
    assert(
      !sum.europe.qualified || sum.europe.competition !== "Champions League",
      "no Arsenal CL inheritance",
      sum
    );
    assert(sum.brentford2026?.status === "not-qualified" || sum.brentford2026?.position === 17, "DNQ retained", sum);
    await freshRestore(page, desk);
    const restored = await exportSnapshot(page);
    await writeCase("B02-fresh-restore.json", slimEvidence(restored));
    const rSum = qualSummary(restored.player, restored);
    assert(rSum.playingClubId === BRENTFORD, "fresh restore club");
    assert(
      !rSum.europe.qualified || rSum.europe.competition !== "Champions League",
      "fresh restore no CL inheritance",
      rSum
    );
    await assertDeskUsable(page);
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    return { ok: true, sum, restored: rSum, freshRestore: true };
  },

  /** Non-qualified path → move onto qualified Arsenal grants CL. */
  async B03(page, guards) {
    const negative = buildSeededSnap({
      id: "fix09-b03-neg",
      clubId: BRENTFORD,
      seed: 9103,
      ovr: 74,
      placements: { 1: ARSENAL, 17: BRENTFORD },
    });
    await writeCase("B03-negative-initial.json", slimEvidence(negative));
    await restore(page, negative);
    const drivenNeg = await driveSeasonToDesk(page, { seasonsBefore: 0, shotPrefix: "B03-neg" });
    const negSum = qualSummary(drivenNeg.beforeContinue.snapshot.player, drivenNeg.beforeContinue.snapshot);
    assert(
      !negSum.europe.qualified || negSum.europe.competition !== "Champions League",
      "Brentford negative path",
      negSum
    );

    const positive = buildSeededSnap({
      id: "fix09-b03-pos",
      clubId: ARSENAL,
      seed: 9104,
      ovr: 80,
      placements: { 1: ARSENAL, 17: BRENTFORD },
      stalePlayerRowClubId: BRENTFORD,
    });
    await writeCase("B03-positive-initial.json", slimEvidence(positive));
    await restore(page, positive);
    const drivenPos = await driveSeasonToDesk(page, { seasonsBefore: 0, shotPrefix: "B03-pos" });
    const desk = await exportSnapshot(page);
    await writeCase("B03-positive-desk.json", slimEvidence(desk));
    const posSum = qualSummary(desk.player, desk);
    assert(posSum.europe.qualified && posSum.europe.competition === "Champions League", "Arsenal positive CL", posSum);
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    return { ok: true, negative: negSum, positive: posSum };
  },

  /** Loan ownership: entry follows playing tip; parent/borrower registry; return if UI supports. */
  async B04(page, guards) {
    const snap = buildSeededSnap({
      id: "fix09-b04",
      clubId: BRENTFORD,
      seed: 9105,
      ovr: 72,
      placements: { 1: ARSENAL, 17: BRENTFORD },
      employmentClubId: ARSENAL,
      playingClubId: BRENTFORD,
    });
    snap.player.activeLoan = {
      status: "active",
      parentClubId: ARSENAL,
      loanClubId: BRENTFORD,
      returnSeason: 1,
    };
    await writeCase("B04-initial.json", slimEvidence(snap));
    await writeFullSnapshot("B04-initial.full.json", snap);
    await restore(page, snap);
    await shot(page, "B04-01-loan-start");
    const start = await exportSnapshot(page);
    assert(start.player.employmentClubId === ARSENAL, "parent employment tip");
    assert(start.player.playingClubId === BRENTFORD, "borrower playing tip");
    assert(clubDecision(snap, ARSENAL, 2026)?.competition === "Champions League", "parent qualified");
    assert(clubDecision(snap, BRENTFORD, 2026)?.status === "not-qualified", "borrower DNQ");

    const driven = await driveSeasonToDesk(page, { seasonsBefore: 0, shotPrefix: "B04", deskPolicy: "stay" });
    const desk = await exportSnapshot(page);
    await writeCase("B04-desk.json", slimEvidence(desk));
    const sum = qualSummary(desk.player, desk);
    assert(
      !sum.europe.qualified || sum.europe.competition !== "Champions League",
      "loan season follows playing club DNQ",
      sum
    );
    assert(sum.arsenal2026?.competition === "Champions League", "parent registry intact", sum);
    const returned =
      desk.player.playingClubId === ARSENAL ||
      desk.player.activeLoan?.status === "returned" ||
      desk.player.activeLoan == null;
    await assertDeskUsable(page);
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    return {
      ok: true,
      sum,
      loanReturnExercised: returned,
      employmentAtDesk: desk.player.employmentClubId,
      playingAtDesk: desk.player.playingClubId,
      deskDecisions: driven.trace.deskDecisions,
    };
  },

  /** Mid-season move must not redraw a prepared world continental edition. */
  async B05(page, guards) {
    const snap = buildSeededSnap({
      id: "fix09-b05",
      clubId: ARSENAL,
      seed: 9106,
      ovr: 82,
      placements: { 1: ARSENAL, 17: BRENTFORD },
      prepareEdition: true,
    });
    const ed0 = editionSummary(snap);
    assert(ed0?.fieldSize > 0, "pre-seeded CL edition present", ed0);
    await writeCase("B05-initial.json", slimEvidence(snap));
    await writeFullSnapshot("B05-initial.full.json", snap);
    await restore(page, snap);
    await shot(page, "B05-01-start");
    const driven = await driveSeasonToDesk(page, {
      seasonsBefore: 0,
      shotPrefix: "B05",
      deskPolicy: "accept-move",
      timeoutMs: 240000,
    });
    const desk = await exportSnapshot(page);
    await writeCase("B05-desk.json", slimEvidence(desk));
    const ed1 = editionSummary(desk);
    assert(ed1?.editionId === ed0.editionId, "editionId frozen across season/move", { ed0, ed1 });
    assert(JSON.stringify(ed1.field) === JSON.stringify(ed0.field), "field frozen", { ed0, ed1 });
    const moved = desk.player.playingClubId !== ARSENAL;
    await assertDeskUsable(page);
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    return {
      ok: true,
      editionPreserved: true,
      moved,
      ed0,
      ed1,
      deskDecisions: driven.trace.deskDecisions,
      note: moved ? "mid-season move accepted" : "no move offer; edition still preserved under stay path",
    };
  },

  /** Pause / restore / Continue branch compare. */
  async B06(page, guards) {
    const snap = buildSeededSnap({
      id: "fix09-b06",
      clubId: ARSENAL,
      seed: 9107,
      ovr: 79,
      placements: { 1: ARSENAL, 17: BRENTFORD },
    });
    await writeCase("B06-initial.json", slimEvidence(snap));
    await restore(page, snap);
    const driven = await driveSeasonToDesk(page, { seasonsBefore: 0, shotPrefix: "B06" });
    const before = driven.beforeContinue.snapshot;
    await writeCase("B06-before-continue.json", slimEvidence(driven.beforeContinue));
    await writeFullSnapshot("B06-before-continue.full.json", driven.beforeContinue);
    const deskA = await exportSnapshot(page);
    await writeCase("B06-desk-a.json", slimEvidence(deskA));
    const a = qualSummary(before.player, before);
    const b = qualSummary(deskA.player, deskA);
    assert(a.europe.competition === "Champions League", "B06 CL before Continue", a);
    assert(b.europe.competition === a.europe.competition, "Continue preserves Europe", { a, b });
    assert(a.seasons === b.seasons && a.age === b.age, "Continue exact-once", { a, b });

    await freshRestore(page, before);
    const ui = await uiState(page);
    if (ui.continueBtnVisible && !ui.continueBtnDisabled) {
      await page.click("#continue-btn");
      await page.waitForTimeout(400);
    } else {
      // Restored mid-presentation: drive remaining Continue/skips to desk.
      const seasonsBefore = (before.player.seasons || []).length - 1;
      await driveSeasonToDesk(page, {
        seasonsBefore: Math.max(0, seasonsBefore),
        alreadyRunning: true,
        shotPrefix: "B06-branch",
      });
    }
    const deskB = await exportSnapshot(page);
    await writeCase("B06-desk-b.json", slimEvidence(deskB));
    const c = qualSummary(deskB.player, deskB);
    assert(c.europe.competition === b.europe.competition, "restore+Continue Europe matches", { b, c });
    assert(c.seasons === b.seasons && c.age === b.age, "branch seasons/age match", { b, c });
    assert(c.arsenal2026?.competition === b.arsenal2026?.competition, "registry branch match", { b, c });
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    return { ok: true, before: a, deskA: b, deskB: c, branchCompare: true };
  },

  /** Non-UEFA calendar-year league (Brazil). */
  async B07(page, guards) {
    const league = topFlight("Brazil");
    assert(league, "Brazil top flight present");
    const club = league.clubs[0];
    const snap = buildSeededSnap({
      id: "fix09-b07",
      clubId: club.clubId,
      leagueId: league.leagueId,
      seed: 9108,
      ovr: 78,
      age: 24,
      placements: { 1: club.clubId },
      sourceYear: 2025,
    });
    // Rebuild nationality for Brazilian club.
    snap.player.nationality = "Brazil";
    await writeCase("B07-initial.json", slimEvidence(snap));
    await writeFullSnapshot("B07-initial.full.json", snap);
    await restore(page, snap);
    await shot(page, "B07-01-start");
    const driven = await driveSeasonToDesk(page, { seasonsBefore: 0, shotPrefix: "B07", timeoutMs: 240000 });
    const desk = await exportSnapshot(page);
    await writeCase("B07-desk.json", slimEvidence(desk));
    const sum = qualSummary(desk.player, desk);
    assert(sum.europe.qualified, "Brazil P1 must earn continental entry", sum);
    assert(
      /libertadores/i.test(sum.europe.competition || ""),
      "calendar-year Brazil → Copa Libertadores",
      sum
    );
    await assertDeskUsable(page);
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    return { ok: true, sum, clubId: club.clubId, leagueId: league.leagueId };
  },

  /** Bootstrap/missing evidence stable; OVR cannot grant known non-qualifier. */
  async B08(page, guards) {
    // Known non-qualifier season drive (moderate OVR so offers do not stall the desk).
    const dnq = buildSeededSnap({
      id: "fix09-b08-dnq",
      clubId: BRENTFORD,
      seed: 9109,
      ovr: 72,
      placements: { 1: ARSENAL, 17: BRENTFORD },
    });
    await writeCase("B08-dnq-initial.json", slimEvidence(dnq));
    await restore(page, dnq);
    const drivenDnq = await driveSeasonToDesk(page, {
      seasonsBefore: 0,
      shotPrefix: "B08-dnq",
      deskPolicy: "decline-offers",
    });
    const dnqSum = qualSummary(drivenDnq.beforeContinue.snapshot.player, drivenDnq.beforeContinue.snapshot);
    assert(
      !dnqSum.europe.qualified || dnqSum.europe.competition !== "Champions League",
      "known DNQ cannot earn CL",
      dnqSum
    );

    // OVR perturbation: same earned DNQ evidence with inflated rating — still no CL grant at restore.
    const hot = buildSeededSnap({
      id: "fix09-b08-ovr",
      clubId: BRENTFORD,
      seed: 9109,
      ovr: 95,
      placements: { 1: ARSENAL, 17: BRENTFORD },
    });
    await writeCase("B08-ovr-initial.json", slimEvidence(hot));
    await restore(page, hot);
    const hotSnap = await exportSnapshot(page);
    const hotEntry = clubDecision(hotSnap, BRENTFORD, 2026);
    assert(hotEntry?.status === "not-qualified", "OVR 95 still DNQ in registry", hotEntry);
    assert(hotEntry?.competition == null, "OVR cannot invent competition", hotEntry);
    assert(Number(hotSnap.player.rating) >= 90, "perturbation rating present", hotSnap.player.rating);

    // Missing evidence / bootstrap path: ensureBootstrap then serialize.
    const league = leagueById(EPL);
    const p = makePlayer({ id: "fix09-b08-boot", position: "CM", ovr: 70, seed: 9110 });
    attachById(p, league, BRENTFORD);
    const world = getWorldState();
    const boot = ensureBootstrapDomesticEdition({ world, league, targetYear: 2026, streamSeed: 9110 });
    assert(boot.ok, "bootstrap ok", boot);
    const entry = getClubTargetDecision(world, BRENTFORD, 2026)?.entry || null;
    reseedCareerRng(9110);
    const bootSnap = serializeCareerSnapshot({ player: p, world });
    await writeCase("B08-bootstrap-initial.json", slimEvidence(bootSnap));
    await restore(page, bootSnap);
    await shot(page, "B08-bootstrap-desk");
    const bootStart = await exportSnapshot(page);
    const bootEntry = clubDecision(bootStart, BRENTFORD, 2026);
    assert(bootEntry, "bootstrap decision survives restore", bootEntry);
    assert(
      bootEntry.competition === entry?.competition && bootEntry.position === entry?.position,
      "bootstrap stable across restore",
      { entry, bootEntry }
    );
    if (bootEntry.status === "not-qualified") {
      assert(bootEntry.competition == null, "bootstrap DNQ has no competition");
    }
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    return {
      ok: true,
      dnq: dnqSum,
      ovrPerturbation: hotEntry,
      bootstrap: bootEntry,
      bootstrapStable: true,
    };
  },

  /** Free-agent gap / re-signing: no obsolete Arsenal entry; no soft-lock. */
  async B09(page, guards) {
    const snap = buildSeededSnap({
      id: "fix09-b09",
      clubId: BRENTFORD,
      seed: 9111,
      ovr: 70,
      freeAgent: true,
      placements: { 1: ARSENAL, 17: BRENTFORD },
      stalePlayerRowClubId: ARSENAL,
    });
    await writeCase("B09-initial.json", slimEvidence(snap));
    await writeFullSnapshot("B09-initial.full.json", snap);
    await restore(page, snap);
    await shot(page, "B09-01-fa-desk");
    const start = await exportSnapshot(page);
    assert(start.player.contractStatus === "released" || !start.player.club, "FA lifecycle");
    const ui0 = await uiState(page);
    assert(ui0.simulateDisabled === false, "FA desk must not soft-lock", ui0);

    const seasonsBefore = (start.player.seasons || []).length;
    await page.click("#simulate-btn");
    const deadline = Date.now() + 120000;
    let beforeContinue = null;
    while (Date.now() < deadline) {
      const cur = await uiState(page);
      const seasonsNow = cur.debug?.seasonsCount ?? null;
      const committed = typeof seasonsNow === "number" && seasonsNow > seasonsBefore;
      if (committed && !beforeContinue) {
        beforeContinue = await exportSnapshot(page);
        await shot(page, "B09-02-before-continue");
      }
      if (committed && beforeContinue && cur.continueBtnVisible && !cur.continueBtnDisabled) {
        await page.click("#continue-btn");
        await page.waitForTimeout(250);
        continue;
      }
      if (
        committed &&
        beforeContinue &&
        cur.overlayHidden &&
        cur.dashboardHidden &&
        cur.seasonActionInFlight === false
      ) {
        break;
      }
      // Decline offers so search can finish; Accept first viable re-sign if present near end.
      await page.evaluate(() => {
        const buttons = [...document.querySelectorAll("button")].filter((b) => !b.disabled && b.offsetParent !== null);
        const decline = buttons.find((b) =>
          /continue as free agent|decline all|no thanks|remain a free agent|decline offers/i.test(
            b.textContent || ""
          )
        );
        if (decline) {
          decline.click();
          return;
        }
        const accept = buttons.find((b) => /^accept$|accept offer|sign for/i.test((b.textContent || "").trim()));
        if (accept) accept.click();
      });
      await page.waitForTimeout(200);
    }
    assert(beforeContinue, "B09 must complete a search/training period without soft-lock");
    const desk = await exportSnapshot(page);
    await writeCase("B09-after-search.json", slimEvidence(desk));
    const sum = qualSummary(desk.player, desk);
    assert(
      !sum.europe.qualified || sum.europe.competition !== "Champions League",
      "FA gap must not invent obsolete Arsenal CL",
      sum
    );
    if (desk.player.playingClubId === BRENTFORD) {
      assert(
        !sum.europe.qualified || sum.europe.competition !== "Champions League",
        "re-sign Brentford still DNQ",
        sum
      );
    }
    await assertDeskUsable(page);
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    return {
      ok: true,
      sum,
      searchCompleted: true,
      reSignedClub: desk.player.playingClubId || null,
      noSoftLock: true,
    };
  },
};

async function main() {
  await mkdir(CASE_DIR, { recursive: true });
  await mkdir(SHOT_DIR, { recursive: true });
  await mkdir(SNAP_DIR, { recursive: true });
  const hosted = await ensureBaseServer();
  const report = {
    generatedAt: new Date().toISOString(),
    base: hosted.base,
    cases: {},
    errors: [],
    blocked: false,
  };
  let browser;
  try {
    const launched = await launch(hosted.base);
    browser = launched.browser;
    const page = launched.page;
    const guards = launched.guards;
    for (const id of SELECTED) {
      if (!cases[id]) {
        report.cases[id] = { ok: false, error: "unknown case" };
        continue;
      }
      guards.errors = [];
      guards.failedRequests = [];
      const t0 = Date.now();
      console.log(`[browser] start ${id}`);
      try {
        report.cases[id] = await cases[id](page, guards);
        console.log(`[browser] pass ${id} ${Date.now() - t0}ms`);
        if (!report.cases[id].ok) report.errors.push({ id, error: "case returned ok:false" });
      } catch (err) {
        console.log(`[browser] fail ${id} ${Date.now() - t0}ms: ${err?.message || err}`);
        report.cases[id] = { ok: false, error: String(err?.stack || err), data: err?.data };
        report.errors.push({ id, error: String(err) });
      }
    }
  } catch (err) {
    report.blocked = true;
    report.errors.push({ id: "launch", error: String(err?.stack || err) });
  } finally {
    if (browser) await browser.close().catch(() => {});
    await hosted.close().catch(() => {});
  }
  report.ok = !report.blocked && SELECTED.every((id) => report.cases[id]?.ok);
  await writeFile(OUT, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        out: OUT,
        ok: report.ok,
        blocked: report.blocked,
        base: report.base,
        cases: Object.fromEntries(Object.entries(report.cases).map(([k, v]) => [k, !!v.ok])),
      },
      null,
      2
    )
  );
  process.exitCode = report.ok ? 0 : 1;
}

main();
