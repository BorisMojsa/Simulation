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
  competitionForValidatedFinish,
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
/** Full field-level diff for QA evidence (empty array when equal). */
function collectFieldDiffs(a, b, path = "", out = []) {
  if (Object.is(a, b)) return out;
  if (typeof a !== typeof b || a == null || b == null || typeof a !== "object") {
    out.push({ path: path || "(root)", a, b });
    return out;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      out.push({ path: `${path || "(root)"}(type)`, aType: Array.isArray(a) ? "array" : typeof a, bType: Array.isArray(b) ? "array" : typeof b });
      return out;
    }
    if (a.length !== b.length) {
      out.push({ path: `${path || "(root)"}(length)`, a: a.length, b: b.length });
    }
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (i >= a.length) out.push({ path: `${path}[${i}]`, a: undefined, b: b[i], missing: "a" });
      else if (i >= b.length) out.push({ path: `${path}[${i}]`, a: a[i], b: undefined, missing: "b" });
      else collectFieldDiffs(a[i], b[i], `${path}[${i}]`, out);
    }
    return out;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (!(k in a)) out.push({ path: path ? `${path}.${k}` : k, a: undefined, b: b[k], missing: "a" });
    else if (!(k in b)) out.push({ path: path ? `${path}.${k}` : k, a: a[k], b: undefined, missing: "b" });
    else collectFieldDiffs(a[k], b[k], path ? `${path}.${k}` : k, out);
  }
  return out;
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
    qualified: Boolean(eu && eu.qualified !== false && !eu.showcase),
    showcase: Boolean(eu?.showcase),
    editionId: eu?.editionId || null,
    competitionId: eu?.competitionId || null,
    result: eu?.result || null,
    matchCount: Array.isArray(eu?.playerMatches) ? eu.playerMatches.length : 0,
  };
}

function expectedCompetitionFromFinish(league, row) {
  if (!league || !row) return null;
  return (
    competitionForValidatedFinish({ position: row.position, qualification: row.qualification }, league) ||
    qualificationForPosition(row.position, league, findSisterLeagues(league, LEAGUES)) ||
    null
  );
}

function decisionMatchesFinish(decision, expectedCompetition) {
  if (!expectedCompetition) {
    return !decision?.competition && (decision?.status === "not-qualified" || decision?.status == null);
  }
  return decision?.competition === expectedCompetition && decision?.status === "qualified";
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

/** Open a brand-new browser context+page on the same origin (isolated module cache). */
async function openFreshContextPage(browser, baseUrl, guards = null) {
  const context = await browser.newContext();
  const page = await context.newPage();
  if (guards) {
    page.on("pageerror", (err) =>
      guards.errors.push({ type: "pageerror", message: String(err?.message || err) })
    );
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      if (/Failed to load resource/i.test(text)) guards.warnings.push({ type: "console", message: text });
      else guards.errors.push({ type: "console", message: text });
    });
  }
  const resp = await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (!resp || !resp.ok()) throw new Error(`fresh context goto failed: ${baseUrl} status=${resp?.status()}`);
  await page.waitForFunction(() => typeof window.__restoreCareerSnapshot === "function", null, {
    timeout: 60000,
  });
  await page.waitForFunction(() => typeof window.__exportCareerSnapshot === "function", null, {
    timeout: 60000,
  });
  return { context, page };
}

function continueCommitProbe(beforeSnap, afterSnap) {
  const beforeSeasons = beforeSnap?.player?.seasons?.length ?? 0;
  const afterSeasons = afterSnap?.player?.seasons?.length ?? 0;
  const beforeAge = beforeSnap?.player?.age ?? null;
  const afterAge = afterSnap?.player?.age ?? null;
  const beforeLedger = beforeSnap?.world?.fixtureLedger?.length ?? 0;
  const afterLedger = afterSnap?.world?.fixtureLedger?.length ?? 0;
  const beforeFinance = JSON.stringify(beforeSnap?.clubFinance || null);
  const afterFinance = JSON.stringify(afterSnap?.clubFinance || null);
  return {
    seasonsUnchanged: beforeSeasons === afterSeasons,
    ageUnchanged: beforeAge === afterAge,
    fixtureLedgerUnchanged: beforeLedger === afterLedger,
    clubFinanceUnchanged: beforeFinance === afterFinance,
    before: { seasons: beforeSeasons, age: beforeAge, fixtureLedger: beforeLedger },
    after: { seasons: afterSeasons, age: afterAge, fixtureLedger: afterLedger },
  };
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
  // Clear desk decisions / leftover overlays that block or intercept Simulate.
  // When alreadyRunning, leave Continue / decline to the main loop so post-commit
  // clicks are counted and FA desk returns are not consumed early.
  for (let guard = 0; !alreadyRunning && guard < 24; guard++) {
    const pre = await uiState(page);
    if (!pre.simulateDisabled && pre.overlayHidden && pre.dashboardHidden && !pre.seasonActionInFlight) break;
    const cleared = await page.evaluate((policy) => {
      const buttons = [...document.querySelectorAll("button")].filter((b) => !b.disabled && b.offsetParent !== null);
      const click = (re) => {
        const btn = buttons.find((b) => re.test((b.textContent || "").trim()));
        if (btn) {
          btn.click();
          return (btn.textContent || "").trim();
        }
        return null;
      };
      // Drain animation/dashboard overlays before arming Simulate.
      const cont = document.getElementById("continue-btn");
      const contSection = document.getElementById("animation-continue");
      if (
        cont &&
        contSection &&
        !contSection.classList.contains("hidden") &&
        !cont.disabled &&
        cont.offsetParent !== null
      ) {
        cont.click();
        return "overlay:continue-btn";
      }
      for (const id of ["sim-skip-phase-btn", "match-skip-phase-btn", "sim-skip-match-btn", "match-skip-btn"]) {
        const el = document.getElementById(id);
        if (el && !el.disabled && el.offsetParent !== null) {
          el.click();
          return `overlay:${id}`;
        }
      }
      if (policy === "accept-move" || policy === "accept-cross-league" || policy === "accept-brentford-loan") {
        const loan = click(/review loan options|see loan|loan options/i);
        if (loan) return `desk-decision:${loan}`;
        if (policy === "accept-brentford-loan" || policy === "accept-cross-league") {
          const brentford = click(/brentford/i) || null;
          if (brentford && /accept|sign|loan/i.test(brentford)) return `desk-decision:${brentford}`;
        }
        const accept = click(/accept loan|accept offer|accept transfer|sign for|^accept$/i);
        if (accept) return `desk-decision:${accept}`;
      }
      if (policy === "decline-offers") {
        const decline =
          click(/continue as free agent \(train\s*\/\s*wait\)/i) ||
          click(/continue as free agent|remain a free agent/i) ||
          click(/decline all|decline offers|no thanks/i) ||
          click(/^decline$/i);
        if (decline) return `desk-decision:${decline}`;
      }
      const stay =
        click(/^stay and compete$/i) ||
        click(/^continue the season$/i) ||
        click(/^focus on recovery$/i) ||
        click(/^keep working$/i) ||
        click(/^acknowledge$/i) ||
        click(/decline offers and continue at/i) ||
        click(/^see it out$|^remain$|^understood$|^got it$/i);
      return stay ? `desk-decision:${stay}` : null;
    }, deskPolicy);
    if (cleared?.startsWith("desk-decision:") || cleared?.startsWith("overlay:")) {
      if (cleared.startsWith("desk-decision:")) {
        trace.deskDecisions.push(cleared.slice("desk-decision:".length));
      } else {
        trace.deskDecisions.push(cleared);
      }
      await page.waitForTimeout(200);
      continue;
    }
    break;
  }
  const ui0 = await uiState(page);
  if (!alreadyRunning) {
    // One more overlay drain if Simulate is still covered.
    if (!ui0.overlayHidden || !ui0.dashboardHidden) {
      for (let i = 0; i < 8; i++) {
        const drained = await page.evaluate(() => {
          const cont = document.getElementById("continue-btn");
          const section = document.getElementById("animation-continue");
          if (
            cont &&
            section &&
            !section.classList.contains("hidden") &&
            !cont.disabled &&
            cont.offsetParent !== null
          ) {
            cont.click();
            return "continue";
          }
          for (const id of ["sim-skip-phase-btn", "match-skip-phase-btn", "sim-skip-match-btn", "match-skip-btn"]) {
            const el = document.getElementById(id);
            if (el && !el.disabled && el.offsetParent !== null) {
              el.click();
              return id;
            }
          }
          return null;
        });
        if (!drained) break;
        await page.waitForTimeout(150);
      }
    }
    const uiArm = await uiState(page);
    assert(uiArm.simulateDisabled === false, "simulate must be enabled", uiArm);
    assert(uiArm.overlayHidden && uiArm.dashboardHidden, "overlays must be clear before simulate", uiArm);
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
    const nextId = cur.nextAction?.id || cur.debug?.nextAction?.id || null;
    const deskReadyNext =
      nextId === "start-season" ||
      nextId === "free-agent" ||
      nextId === "search-offers" ||
      nextId === "train-search";
    if (
      committed &&
      beforeContinue &&
      cur.overlayHidden &&
      cur.dashboardHidden &&
      cur.seasonActionInFlight === false &&
      (trace.postCommitContinueClicks >= 1 || deskReadyNext)
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
              trayButtons.find((b) => /continue as free agent \(train\s*\/\s*wait\)/i.test(b.textContent || "")) ||
              trayButtons.find((b) => /continue as free agent|remain a free agent/i.test(b.textContent || "")) ||
              trayButtons.find((b) => /decline offers and continue at/i.test(b.textContent || "")) ||
              trayButtons.find((b) => /decline all|decline offers|no thanks/i.test(b.textContent || "")) ||
              trayButtons.find((b) => /^decline$/i.test((b.textContent || "").trim()));
            if (decline) {
              decline.click();
              clicked.push(`desk-decision:${(decline.textContent || "").trim()}`);
              return clicked;
            }
          }
          if (policy === "accept-cross-league" || policy === "accept-move" || policy === "accept-brentford-loan") {
            const loanTray =
              trayButtons.find((b) => /review loan options|see loan|loan options/i.test(b.textContent || "")) ||
              null;
            if (loanTray) {
              loanTray.click();
              clicked.push(`desk-decision:${(loanTray.textContent || "").trim()}`);
              return clicked;
            }
            const preferBrentford = policy === "accept-brentford-loan" || policy === "accept-cross-league";
            const accept =
              (preferBrentford &&
                trayButtons.find(
                  (b) =>
                    /brentford/i.test(b.textContent || "") &&
                    /accept loan|accept offer|accept transfer|sign for|^accept$/i.test(b.textContent || "")
                )) ||
              trayButtons.find((b) =>
                /accept loan|accept offer|accept transfer|sign for/i.test(b.textContent || "")
              ) ||
              trayButtons.find((b) => /^accept$/i.test((b.textContent || "").trim()));
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
          if (policy === "accept-cross-league" || policy === "accept-move" || policy === "accept-brentford-loan") {
            const loanTray =
              buttons.find((b) => /review loan options|see loan|loan options/i.test(b.textContent || "")) || null;
            if (loanTray) {
              loanTray.click();
              clicked.push(`desk-decision:${(loanTray.textContent || "").trim()}`);
              return clicked;
            }
            const preferBrentford = policy === "accept-brentford-loan" || policy === "accept-cross-league";
            const accept =
              (preferBrentford &&
                buttons.find(
                  (b) =>
                    /brentford/i.test(b.textContent || "") &&
                    /accept loan|accept offer|accept transfer|sign for|^accept$/i.test(b.textContent || "")
                )) ||
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

/**
 * Drive until a real mid-season awaiting_decision checkpoint (season not yet committed).
 * Auto-clears senior scenarios so the pause is a registration/decision checkpoint, not a scene.
 * Does not auto-resolve the decision — caller branches from the exported snapshot.
 */
async function driveToMidSeasonPause(page, { seasonsBefore = 0, timeoutMs = 180000, shotPrefix = null } = {}) {
  const trace = { simulateClicks: 0, skipClicks: 0, deskDecisions: [], scenariosCleared: 0 };
  const ui0 = await uiState(page);
  assert(ui0.simulateDisabled === false, "simulate must be enabled for mid-season pause", ui0);
  await page.click("#simulate-btn");
  trace.simulateClicks += 1;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cur = await uiState(page);
    const seasonsNow = cur.debug?.seasonsCount ?? 0;
    if (seasonsNow > seasonsBefore) {
      throw new Error(
        `Season completed before mid-season pause: ${JSON.stringify({ seasonsBefore, seasonsNow, cur })}`
      );
    }
    const act = await page.evaluate(() => {
      const clicked = [];
      const senior = document.getElementById("senior-scenario-overlay");
      if (senior && !senior.classList.contains("hidden")) {
        const choice = [...senior.querySelectorAll("button")].find((b) => !b.disabled);
        if (choice) {
          choice.click();
          clicked.push("scenario");
          return clicked;
        }
      }
      // Do not auto-click stay/accept at the squad-review decision — that is the pause target.
      for (const id of ["sim-skip-phase-btn", "match-skip-phase-btn", "sim-skip-match-btn", "match-skip-btn"]) {
        const el = document.getElementById(id);
        if (el && !el.disabled && el.offsetParent !== null) {
          el.click();
          clicked.push(id);
        }
      }
      return clicked;
    });
    for (const c of act) {
      if (c === "scenario") trace.scenariosCleared += 1;
      if (/skip/i.test(c)) trace.skipClicks += 1;
    }
    if (act.includes("scenario")) {
      await page.waitForTimeout(180);
      continue;
    }
    const paused =
      cur.overlayHidden &&
      cur.dashboardHidden &&
      cur.seasonActionInFlight === false &&
      !act.length &&
      (cur.debug?.seasonCheckpoint === "awaiting_decision" ||
        cur.nextAction?.id === "resolve-decision" ||
        cur.nextAction?.id === "resolve-offers" ||
        Boolean(cur.debug?.pendingDecision) ||
        (Array.isArray(cur.debug?.pendingOffers) && cur.debug.pendingOffers.length > 0));
    if (paused) {
      const snapshot = await exportSnapshot(page);
      const ck = snapshot.player?.seasonCheckpoint;
      assert(
        ck?.status === "awaiting_decision" ||
          snapshot.player?.pendingDecision ||
          (snapshot.player?.pendingOffers || []).length > 0 ||
          cur.debug?.seasonCheckpoint === "awaiting_decision",
        "mid-season pause must expose awaiting_decision",
        { ckStatus: ck?.status, debug: cur.debug?.seasonCheckpoint, seasons: snapshot.player?.seasons?.length }
      );
      assert((snapshot.player?.seasons || []).length === seasonsBefore, "pause before season commit", {
        seasons: snapshot.player?.seasons?.length,
        seasonsBefore,
      });
      if (shotPrefix) await shot(page, `${shotPrefix}-mid-pause`);
      return { trace, snapshot, debug: cur.debug, ui: cur };
    }
    await page.waitForTimeout(act.length ? 120 : 200);
  }
  throw new Error(`Timed out waiting for mid-season pause: ${JSON.stringify({ seasonsBefore, trace, ui: await uiState(page) })}`);
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
  /** Same-club earned rollover: play season → Continue → next edition from saved final table. */
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
    await writeFullSnapshot("B01-desk.full.json", desk);
    const before = qualSummary(driven.beforeContinue.snapshot.player, driven.beforeContinue.snapshot);
    const after = qualSummary(desk.player, desk);
    assert(before.seasons >= 1, "season must complete", before);
    assert(before.europe.qualified && before.europe.competition === "Champions League", "same-club CL entry", before);
    assert(after.seasons === before.seasons && after.age === before.age, "Continue exact-once", { before, after });
    assert(after.europe.competition === before.europe.competition, "Continue preserves Europe", { before, after });
    assert(after.arsenal2026?.competition === "Champions League" || after.arsenal2026?.position === 1, "registry retained", after);

    // Next edition must start from the just-played final table (Continue already applied).
    const next = await driveSeasonToDesk(page, { seasonsBefore: after.seasons, shotPrefix: "B01-next" });
    const nextDesk = await exportSnapshot(page);
    await writeCase("B01-next-desk.json", slimEvidence(nextDesk));
    await writeFullSnapshot("B01-next-desk.full.json", nextDesk);
    const nextSum = qualSummary(nextDesk.player, nextDesk);
    assert(nextSum.seasons === after.seasons + 1, "second season completed", { after, nextSum });
    const sourceSeason = (desk.player.seasons || []).at(-1);
    const finalTable = sourceSeason?.standing?.table || null;
    assert(Array.isArray(finalTable) && finalTable.length > 0, "prior final table present for next entry");
    const arsenalRow = finalTable.find((r) => r.clubId === ARSENAL);
    assert(arsenalRow, "Arsenal row in completed source table", finalTable?.length);
    const league = leagueById(EPL);
    const expectedNext = expectedCompetitionFromFinish(league, arsenalRow);
    const sourceYear = 2026;
    const targetYear = 2027;
    const nextDecision = clubDecision(nextDesk, ARSENAL, targetYear);
    assert(
      decisionMatchesFinish(nextDecision, expectedNext),
      "next-year registry must match played finish",
      { expectedNext, nextDecision, position: arsenalRow.position }
    );
    if (expectedNext) {
      assert(nextSum.europe.qualified === true, "earned next entry must be qualified", nextSum);
      assert(nextSum.europe.competition === expectedNext, "next campaign competition from played table", {
        expectedNext,
        europe: nextSum.europe,
        position: arsenalRow.position,
      });
      assert(nextSum.europe.showcase !== true, "earned entry is not showcase", nextSum.europe);
    } else {
      assert(
        nextSum.europe.qualified !== true || nextSum.europe.showcase === true,
        "DNQ finish must not invent earned continental entry",
        { expectedNext, europe: nextSum.europe, position: arsenalRow.position }
      );
    }
    // No unearned player fixtures for a DNQ destination competition.
    if (!expectedNext && nextSum.europe.competition === "Champions League" && !nextSum.europe.showcase) {
      assert(false, "DNQ must not attach earned Champions League fixtures", nextSum);
    }
    await assertDeskUsable(page);
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    return {
      ok: true,
      before,
      after,
      next: nextSum,
      continued: true,
      nextEditionFromPlayedTable: true,
      sourceYear,
      targetYear,
      expectedNext,
      nextDecision,
      arsenalSourcePosition: arsenalRow.position,
      transitions: {
        seasons: [before.seasons, after.seasons, nextSum.seasons],
        europe: [before.europe.competition, after.europe.competition, nextSum.europe.competition],
      },
    };
  },

  /** Arsenal→DNQ Brentford: retain January coverage and require off-season acceptance + destination entry. */
  async B02(page, guards) {
    const { buildOwnershipTransferBrowserFixture } = await import(
      "../js/simulation/ownershipTransferBrowserFixture.js"
    );
    const league = leagueById(EPL);
    const brentford = clubIn(league, BRENTFORD);

    // --- Retained January mid-season permanent move (useful coverage). ---
    const januaryFixture = buildOwnershipTransferBrowserFixture({ seed: 9102, careerId: "fix09-b02-january" });
    assert(januaryFixture.ok, "january ownership transfer fixture ready", januaryFixture);
    commitCompletedDomesticEdition({
      world: getWorldState(),
      league,
      table: orderedTable(league, {
        1: ARSENAL,
        2: "club:england:crystal-palace",
        3: "club:england:everton",
        4: "club:england:leeds-united",
        17: BRENTFORD,
      }),
      sourceYear: 2025,
      forceReplace: true,
    });
    const januarySnap = serializeCareerSnapshot({ player: januaryFixture.player, world: getWorldState() });
    await writeCase("B02-january-initial.json", slimEvidence(januarySnap));
    await restore(page, januarySnap);
    await shot(page, "B02-01-start");
    assert(clubDecision(januarySnap, BRENTFORD, 2026)?.status === "not-qualified", "Brentford DNQ seeded");
    await page.waitForTimeout(300);
    const januaryAccepted = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button")].filter((b) => !b.disabled && b.offsetParent !== null);
      const hit =
        buttons.find((b) => /brentford/i.test(b.textContent || "") && /accept|sign/i.test(b.textContent || "")) ||
        buttons.find((b) => /accept offer|accept transfer|sign for|^accept$/i.test((b.textContent || "").trim()));
      if (!hit) return null;
      hit.click();
      return (hit.textContent || "").trim();
    });
    assert(januaryAccepted, "must accept January Brentford permanent offer", { januaryAccepted });
    const januaryDriven = await driveSeasonToDesk(page, {
      seasonsBefore: (januarySnap.player.seasons || []).length,
      alreadyRunning: true,
      shotPrefix: "B02",
      deskPolicy: "stay",
      timeoutMs: 240000,
    });
    const januaryDesk = await exportSnapshot(page);
    await writeCase("B02-desk.json", slimEvidence(januaryDesk));
    await writeFullSnapshot("B02-desk.full.json", januaryDesk);
    const januarySum = qualSummary(januaryDesk.player, januaryDesk);
    assert(januarySum.playingClubId === BRENTFORD, "january move to Brentford", januarySum);
    assert(
      januarySum.brentford2026?.status === "not-qualified" || januarySum.brentford2026?.position === 17,
      "january DNQ retained",
      januarySum
    );
    const januaryMoveDate = januaryFixture.checkpoint?.lastDate || "2027-01-10";
    const januaryLast = (januaryDesk.player.seasons || []).at(-1);
    const januaryPostCl = (januaryLast?.europeanCampaign?.playerMatches || []).filter(
      (m) =>
        String(m.date || "") >= String(januaryMoveDate) &&
        (m.home?.clubId === BRENTFORD || m.away?.clubId === BRENTFORD || m.teamId === BRENTFORD)
    );
    assert(januaryPostCl.length === 0, "january Brentford must not inherit Arsenal CL", { januaryPostCl });

    // --- Required off-season Arsenal→DNQ Brentford acceptance + destination season. ---
    const offSnap = buildSeededSnap({
      id: "fix09-b02-offseason",
      clubId: ARSENAL,
      seed: 9122,
      ovr: 76,
      placements: {
        1: ARSENAL,
        2: "club:england:crystal-palace",
        3: "club:england:everton",
        4: "club:england:leeds-united",
        17: BRENTFORD,
      },
    });
    const offOffer = {
      offerId: `fix09-b02-off:${BRENTFORD}`,
      club: brentford.name,
      clubDisplay: brentford.displayName || brentford.name,
      clubId: BRENTFORD,
      league: "England - Premier League",
      leagueId: EPL,
      nation: "England",
      dealType: "permanent",
      isLoan: false,
      isRenewal: false,
      isFreeAgent: false,
      transferFee: 12_000_000,
      wage: 6000,
      contractYears: 3,
      expectedRole: "starter",
      status: "pending",
      effectiveDate: "2026-07-01",
      reviewDate: "2026-07-01",
    };
    offSnap.player.pendingOffers = [offOffer];
    offSnap.player.pendingDecision = { kind: "transfer-offers", offers: [offOffer] };
    await writeCase("B02-initial.json", slimEvidence(offSnap));
    await writeFullSnapshot("B02-initial.full.json", offSnap);
    await restore(page, offSnap);
    await shot(page, "B02-offseason-start");
    assert((offSnap.player.seasons || []).length === 0, "off-season starts before any completed season");
    assert(String(offOffer.effectiveDate).startsWith("2026-07"), "off-season effective date");
    await page.waitForTimeout(300);
    const offAccepted = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button")].filter((b) => !b.disabled && b.offsetParent !== null);
      const hit =
        buttons.find((b) => /brentford/i.test(b.textContent || "") && /accept|sign/i.test(b.textContent || "")) ||
        buttons.find((b) => /accept offer|accept transfer|sign for|^accept$/i.test((b.textContent || "").trim()));
      if (!hit) return null;
      hit.click();
      return (hit.textContent || "").trim();
    });
    assert(offAccepted, "must accept off-season Brentford permanent offer", { offAccepted });
    const offDriven = await driveSeasonToDesk(page, {
      seasonsBefore: 0,
      shotPrefix: "B02-off",
      deskPolicy: "stay",
      timeoutMs: 240000,
    });
    const offDesk = await exportSnapshot(page);
    await writeCase("B02-offseason-desk.json", slimEvidence(offDesk));
    await writeFullSnapshot("B02-offseason-desk.full.json", offDesk);
    const offSum = qualSummary(offDesk.player, offDesk);
    assert(offSum.playingClubId === BRENTFORD, "off-season destination Brentford", offSum);
    assert(offSum.seasons >= 1, "off-season destination season completed", offSum);
    assert(
      offSum.europe.qualified !== true || offSum.europe.competition !== "Champions League",
      "off-season DNQ destination must not inherit Arsenal CL",
      offSum
    );
    assert(
      clubDecision(offDesk, BRENTFORD, 2026)?.status === "not-qualified",
      "off-season Brentford DNQ authority",
      clubDecision(offDesk, BRENTFORD, 2026)
    );
    const offStint = (offDesk.player.playingStints || []).find((s) => s.playingClubId === BRENTFORD);
    assert(offStint && String(offStint.from).startsWith("2026-07"), "off-season stint timing", offStint);
    await freshRestore(page, offDesk);
    const restored = await exportSnapshot(page);
    await writeCase("B02-fresh-restore.json", slimEvidence(restored));
    await writeFullSnapshot("B02-fresh-restore.full.json", restored);
    const rSum = qualSummary(restored.player, restored);
    assert(rSum.playingClubId === BRENTFORD, "fresh restore club");
    assert(rSum.seasons === offSum.seasons && rSum.age === offSum.age, "fresh restore seasons/age", { offSum, rSum });
    await assertDeskUsable(page);
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    return {
      ok: true,
      january: januarySum,
      offSeason: offSum,
      restored: rSum,
      freshRestore: true,
      transferAccepted: true,
      offSeasonAccepted: true,
      januaryAccepted: true,
      deskDecisions: [...(januaryDriven.trace.deskDecisions || []), ...(offDriven.trace.deskDecisions || [])],
    };
  },

  /** Same career: non-qualified Brentford → accept move onto qualified Arsenal. */
  async B03(page, guards) {
    const snap = buildSeededSnap({
      id: "fix09-b03",
      clubId: BRENTFORD,
      seed: 9103,
      ovr: 80,
      placements: { 1: ARSENAL, 17: BRENTFORD },
    });
    const arsenal = clubIn(leagueById(EPL), ARSENAL);
    const offer = {
      offerId: `fix09-b03:${ARSENAL}`,
      club: arsenal.name,
      clubDisplay: arsenal.displayName || arsenal.name,
      clubId: ARSENAL,
      league: "England - Premier League",
      leagueId: EPL,
      nation: "England",
      dealType: "permanent",
      isLoan: false,
      isRenewal: false,
      isFreeAgent: false,
      transferFee: 15_000_000,
      wage: 8000,
      contractYears: 3,
      expectedRole: "starter",
      status: "pending",
      effectiveDate: "2026-07-01",
      reviewDate: "2026-07-01",
    };
    snap.player.pendingOffers = [offer];
    snap.player.pendingDecision = { kind: "transfer-offers", offers: [offer] };
    await writeCase("B03-initial.json", slimEvidence(snap));
    await writeFullSnapshot("B03-initial.full.json", snap);
    await restore(page, snap);
    const startSum = qualSummary(snap.player, snap);
    assert(
      !startSum.europe.qualified || startSum.europe.competition !== "Champions League",
      "Brentford starts DNQ",
      startSum
    );
    await page.waitForTimeout(300);
    const accepted = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button")].filter((b) => !b.disabled && b.offsetParent !== null);
      const hit =
        buttons.find((b) => /arsenal/i.test(b.textContent || "") && /accept|sign/i.test(b.textContent || "")) ||
        buttons.find((b) => /accept offer|accept transfer|sign for|^accept$/i.test((b.textContent || "").trim()));
      if (!hit) return null;
      hit.click();
      return (hit.textContent || "").trim();
    });
    assert(accepted, "must accept Arsenal permanent offer", { accepted });
    const driven = await driveSeasonToDesk(page, {
      seasonsBefore: 0,
      shotPrefix: "B03",
      deskPolicy: "stay",
      timeoutMs: 240000,
    });
    const desk = await exportSnapshot(page);
    await writeCase("B03-desk.json", slimEvidence(desk));
    await writeFullSnapshot("B03-desk.full.json", desk);
    const posSum = qualSummary(desk.player, desk);
    assert(posSum.playingClubId === ARSENAL, "accepted reverse transfer into Arsenal", posSum);
    assert(posSum.europe.qualified && posSum.europe.competition === "Champions League", "qualified destination CL", posSum);
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    return { ok: true, start: startSum, positive: posSum, transferAccepted: true, deskDecisions: driven.trace.deskDecisions };
  },

  /** Real accepted loan: entry follows playing tip; require return with parent entry. */
  async B04(page, guards) {
    const { buildOwnershipTransferBrowserFixture } = await import(
      "../js/simulation/ownershipTransferBrowserFixture.js"
    );
    const fixture = buildOwnershipTransferBrowserFixture({
      seed: 9105,
      careerId: "fix09-b04",
      dealType: "loan",
    });
    assert(fixture.ok, "loan ownership fixture ready", fixture);
    // Authoritative parent CL / borrower DNQ for the controlled loan tip.
    const league = leagueById(EPL);
    commitCompletedDomesticEdition({
      world: getWorldState(),
      league,
      table: orderedTable(league, { 1: ARSENAL, 17: BRENTFORD }),
      sourceYear: 2025,
      forceReplace: true,
    });
    const snap = serializeCareerSnapshot({ player: fixture.player, world: getWorldState() });
    await writeCase("B04-initial.json", slimEvidence(snap));
    await writeFullSnapshot("B04-initial.full.json", snap);
    await restore(page, snap);
    await shot(page, "B04-01-loan-start");
    assert(clubDecision(snap, ARSENAL, 2026)?.competition === "Champions League", "parent qualified");
    assert(clubDecision(snap, BRENTFORD, 2026)?.status === "not-qualified", "borrower DNQ");

    await page.waitForTimeout(300);
    const accepted = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button")].filter((b) => !b.disabled && b.offsetParent !== null);
      const hit =
        buttons.find((b) => /brentford/i.test(b.textContent || "") && /accept loan|accept offer|^accept$/i.test(b.textContent || "")) ||
        buttons.find((b) => /accept loan/i.test(b.textContent || "")) ||
        buttons.find((b) => /accept offer|sign for|^accept$/i.test((b.textContent || "").trim()));
      if (!hit) return null;
      hit.click();
      return (hit.textContent || "").trim();
    });
    assert(accepted, "must click Accept on Brentford loan offer", { accepted });
    const driven = await driveSeasonToDesk(page, {
      seasonsBefore: (snap.player.seasons || []).length,
      alreadyRunning: true,
      shotPrefix: "B04",
      deskPolicy: "stay",
      timeoutMs: 240000,
    });
    const mid = await exportSnapshot(page);
    await writeCase("B04-mid.json", slimEvidence(mid));
    const borrowerId = mid.player.playingClubId;
    const loanAccepted =
      mid.player.activeLoan?.status === "active" ||
      (mid.player.employmentClubId === ARSENAL && borrowerId && borrowerId !== ARSENAL) ||
      borrowerId === BRENTFORD;
    assert(loanAccepted, "real loan acceptance required", {
      employment: mid.player.employmentClubId,
      playing: borrowerId,
      activeLoan: mid.player.activeLoan,
      deskDecisions: driven.trace.deskDecisions,
      accepted,
    });
    assert(borrowerId === BRENTFORD, "controlled loan must land at Brentford DNQ tip", {
      borrowerId,
      accepted,
    });
    const midSum = qualSummary(mid.player, mid);
    const borrowerDecision = clubDecision(mid, borrowerId, 2026);
    assert(borrowerDecision?.status === "not-qualified", "actual borrower is DNQ", borrowerDecision);
    // Playing-tip DNQ: no earned CL attachments for Brentford after the loan effective date.
    const moveDate = fixture.checkpoint?.lastDate || "2027-01-01";
    const last = (mid.player.seasons || []).at(-1);
    const postMoveBrentfordCl = (last?.europeanCampaign?.playerMatches || []).filter(
      (m) =>
        String(m.date || "") >= String(moveDate) &&
        (m.home?.clubId === BRENTFORD || m.away?.clubId === BRENTFORD || m.teamId === BRENTFORD)
    );
    assert(postMoveBrentfordCl.length === 0, "DNQ borrower must not inherit parent CL attachments", {
      postMoveBrentfordCl,
      midSum,
      borrowerDecision,
    });

    // Drive return window / next period if still on loan.
    let desk = mid;
    if (mid.player.activeLoan?.status === "active" || mid.player.playingClubId !== ARSENAL) {
      const returnedDrive = await driveSeasonToDesk(page, {
        seasonsBefore: (mid.player.seasons || []).length,
        shotPrefix: "B04-return",
        deskPolicy: "stay",
        timeoutMs: 240000,
      });
      desk = await exportSnapshot(page);
      await writeCase("B04-desk.json", slimEvidence(desk));
      void returnedDrive;
    } else {
      await writeCase("B04-desk.json", slimEvidence(desk));
    }
    await writeFullSnapshot("B04-desk.full.json", desk);
    const sum = qualSummary(desk.player, desk);
    assert(sum.arsenal2026?.competition === "Champions League", "parent registry intact", sum);
    const returned =
      desk.player.playingClubId === ARSENAL &&
      (desk.player.activeLoan == null || desk.player.activeLoan?.status === "returned");
    assert(returned, "loan return with parent playing tip required", {
      playing: desk.player.playingClubId,
      employment: desk.player.employmentClubId,
      activeLoan: desk.player.activeLoan,
    });
    assert(
      clubDecision(desk, ARSENAL, 2026)?.competition === "Champions League",
      "return restores parent qualification authority",
      clubDecision(desk, ARSENAL, 2026)
    );

    // --- Reverse direction: DNQ parent (Brentford) → qualified borrower (Arsenal). ---
    // Summer loan so subsequent-registration gates allow dated CL league-phase play.
    // Tables are committed before any season simulation via buildSeededSnap.
    const reverseSnap = buildSeededSnap({
      id: "fix09-b04-reverse",
      clubId: BRENTFORD,
      seed: 9135,
      ovr: 78,
      placements: { 1: ARSENAL, 17: BRENTFORD },
      prepareEdition: false,
    });
    const arsenalClub = clubIn(league, ARSENAL);
    const reverseOffer = {
      offerId: `fix09-b04-reverse:${ARSENAL}`,
      club: arsenalClub.name,
      clubDisplay: arsenalClub.displayName || arsenalClub.name,
      clubId: ARSENAL,
      league: league.name,
      leagueId: EPL,
      nation: "England",
      dealType: "loan",
      isLoan: true,
      isRenewal: false,
      isFreeAgent: false,
      transferFee: 0,
      wage: 5000,
      contractYears: 1,
      expectedRole: "rotation",
      status: "pending",
      effectiveDate: "2026-07-01",
      reviewDate: "2026-07-01",
      loanTerms: {
        loanId: `loan:fix09-b04-reverse:${BRENTFORD}:${ARSENAL}`,
        parentClubId: BRENTFORD,
        parentClubName: "Brentford",
        borrowingClubId: ARSENAL,
        startSeason: 0,
        endSeason: 1,
        startDate: "2026-07-01",
        endDate: "2027-05-31",
        borrowerWageShare: 0.5,
        parentWageShare: 0.5,
        loanFee: 0,
      },
    };
    reverseSnap.player.pendingOffers = [reverseOffer];
    reverseSnap.player.pendingDecision = { kind: "transfer-offers", offers: [reverseOffer] };
    // Freeze the borrower's earned CL edition into the world before acceptance so the
    // initial snapshot already shows Arsenal in the canonical field.
    {
      const { prepareContinentalEdition } = await import("../js/simulation/continentalTournament.js");
      const ghost = {
        ...reverseSnap.player,
        playingClubId: ARSENAL,
        employmentClubId: ARSENAL,
        club: { ...arsenalClub, league: league.name, leagueId: league.leagueId, nation: league.nation },
      };
      prepareContinentalEdition({
        standing: { position: 1, qualification: "League Champions" },
        league,
        player: ghost,
        seasonYear: 2026,
        world: getWorldState(),
      });
      Object.assign(reverseSnap, serializeCareerSnapshot({ player: reverseSnap.player, world: getWorldState() }));
      reverseSnap.player.pendingOffers = [reverseOffer];
      reverseSnap.player.pendingDecision = { kind: "transfer-offers", offers: [reverseOffer] };
    }
    await writeCase("B04-reverse-initial.json", slimEvidence(reverseSnap));
    await writeFullSnapshot("B04-reverse-initial.full.json", reverseSnap);
    assert((editionSummary(reverseSnap)?.field || []).includes(ARSENAL), "reverse initial field contains Arsenal");
    await restore(page, reverseSnap);
    await shot(page, "B04-reverse-start");
    assert(clubDecision(reverseSnap, BRENTFORD, 2026)?.status === "not-qualified", "reverse parent DNQ");
    assert(clubDecision(reverseSnap, ARSENAL, 2026)?.competition === "Champions League", "reverse borrower CL");
    await page.waitForTimeout(300);
    const reverseAccepted = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button")].filter((b) => !b.disabled && b.offsetParent !== null);
      const hit =
        buttons.find((b) => /arsenal/i.test(b.textContent || "") && /accept loan|accept offer|^accept$/i.test(b.textContent || "")) ||
        buttons.find((b) => /accept loan/i.test(b.textContent || ""));
      if (!hit) return null;
      hit.click();
      return (hit.textContent || "").trim();
    });
    assert(reverseAccepted, "must accept Arsenal loan from DNQ parent", { reverseAccepted });
    const reverseDriven = await driveSeasonToDesk(page, {
      seasonsBefore: 0,
      shotPrefix: "B04-reverse",
      deskPolicy: "stay",
      timeoutMs: 240000,
    });
    const reverseDesk = await exportSnapshot(page);
    await writeCase("B04-reverse-desk.json", slimEvidence(reverseDesk));
    await writeFullSnapshot("B04-reverse-desk.full.json", reverseDesk);
    assert(reverseDesk.player.playingClubId === ARSENAL, "reverse loan playing tip Arsenal", {
      playing: reverseDesk.player.playingClubId,
      employment: reverseDesk.player.employmentClubId,
    });
    assert(reverseDesk.player.employmentClubId === BRENTFORD, "reverse loan employment remains Brentford");
    const reverseSum = qualSummary(reverseDesk.player, reverseDesk);
    assert(
      reverseSum.europe.qualified === true && reverseSum.europe.competition === "Champions League",
      "qualified borrower grants its own CL entry",
      reverseSum
    );
    const reverseEd1 = editionSummary(reverseDesk);
    assert((reverseEd1?.field || []).includes(ARSENAL), "reverse desk CL field contains Arsenal", reverseEd1);
    const reverseLast = (reverseDesk.player.seasons || []).at(-1);
    const reverseBorrowerCl = (reverseLast?.europeanCampaign?.playerMatches || []).filter(
      (m) => m.home?.clubId === ARSENAL || m.away?.clubId === ARSENAL || m.teamId === ARSENAL
    );
    assert(reverseBorrowerCl.length > 0, "dated Arsenal CL observations on reverse loan", {
      count: reverseBorrowerCl.length,
      sample: reverseBorrowerCl.slice(0, 2),
      editionId: reverseLast?.europeanCampaign?.editionId,
    });

    // --- Cross-association loan: English parent → Dutch borrower (summer, pre-sim tables). ---
    const eredivisie = LEAGUES.find((l) => l.leagueId === "league:netherlands-eredivisie");
    assert(eredivisie, "Eredivisie present for cross-association loan");
    const twente = eredivisie.clubs.find((c) => c.clubId === "club:netherlands:twente") || eredivisie.clubs[0];
    const crossSnap = buildSeededSnap({
      id: "fix09-b04-cross",
      clubId: ARSENAL,
      seed: 9145,
      ovr: 78,
      placements: { 1: ARSENAL, 17: BRENTFORD },
    });
    commitCompletedDomesticEdition({
      world: getWorldState(),
      league: eredivisie,
      table: orderedTable(eredivisie, { 1: twente.clubId }),
      sourceYear: 2025,
      forceReplace: true,
    });
    // Re-serialize after Dutch table commit so the snapshot carries Twente's earned entry.
    const crossWorldSnap = serializeCareerSnapshot({ player: crossSnap.player, world: getWorldState() });
    const crossOffer = {
      offerId: `fix09-b04-cross:${twente.clubId}`,
      club: twente.name,
      clubDisplay: twente.displayName || twente.name,
      clubId: twente.clubId,
      league: eredivisie.name,
      leagueId: eredivisie.leagueId,
      nation: eredivisie.nation,
      dealType: "loan",
      isLoan: true,
      isRenewal: false,
      isFreeAgent: false,
      transferFee: 0,
      wage: 4500,
      contractYears: 1,
      expectedRole: "rotation",
      status: "pending",
      effectiveDate: "2026-07-01",
      reviewDate: "2026-07-01",
      loanTerms: {
        loanId: `loan:fix09-b04-cross:${ARSENAL}:${twente.clubId}`,
        parentClubId: ARSENAL,
        parentClubName: "Arsenal",
        borrowingClubId: twente.clubId,
        startSeason: 0,
        endSeason: 1,
        startDate: "2026-07-01",
        endDate: "2027-05-31",
        borrowerWageShare: 0.5,
        parentWageShare: 0.5,
        loanFee: 0,
      },
    };
    crossWorldSnap.player.pendingOffers = [crossOffer];
    crossWorldSnap.player.pendingDecision = { kind: "transfer-offers", offers: [crossOffer] };
    {
      const { prepareContinentalEdition } = await import("../js/simulation/continentalTournament.js");
      const ghost = {
        ...crossWorldSnap.player,
        playingClubId: twente.clubId,
        employmentClubId: twente.clubId,
        club: { ...twente, league: eredivisie.name, leagueId: eredivisie.leagueId, nation: eredivisie.nation },
      };
      prepareContinentalEdition({
        standing: { position: 1, qualification: "League Champions" },
        league: eredivisie,
        player: ghost,
        seasonYear: 2026,
        world: getWorldState(),
      });
      Object.assign(
        crossWorldSnap,
        serializeCareerSnapshot({ player: crossWorldSnap.player, world: getWorldState() })
      );
      crossWorldSnap.player.pendingOffers = [crossOffer];
      crossWorldSnap.player.pendingDecision = { kind: "transfer-offers", offers: [crossOffer] };
    }
    await writeCase("B04-cross-initial.json", slimEvidence(crossWorldSnap));
    await writeFullSnapshot("B04-cross-initial.full.json", crossWorldSnap);
    await restore(page, crossWorldSnap);
    assert(clubDecision(crossWorldSnap, twente.clubId, 2026)?.competition, "cross borrower pre-qualified", {
      decision: clubDecision(crossWorldSnap, twente.clubId, 2026),
    });
    assert(
      (editionSummary(crossWorldSnap)?.field || []).includes(twente.clubId),
      "cross initial field contains Twente",
      editionSummary(crossWorldSnap)
    );
    await page.waitForTimeout(300);
    const crossAccepted = await page.evaluate((borrowerName) => {
      const buttons = [...document.querySelectorAll("button")].filter((b) => !b.disabled && b.offsetParent !== null);
      const re = new RegExp(borrowerName, "i");
      const hit =
        buttons.find((b) => re.test(b.textContent || "") && /accept loan|accept offer|^accept$/i.test(b.textContent || "")) ||
        buttons.find((b) => /accept loan/i.test(b.textContent || ""));
      if (!hit) return null;
      hit.click();
      return (hit.textContent || "").trim();
    }, twente.name);
    assert(crossAccepted, "must accept cross-association loan", { crossAccepted, borrower: twente.name });
    const crossDriven = await driveSeasonToDesk(page, {
      seasonsBefore: 0,
      shotPrefix: "B04-cross",
      deskPolicy: "stay",
      timeoutMs: 240000,
    });
    const crossDesk = await exportSnapshot(page);
    await writeCase("B04-cross-desk.json", slimEvidence(crossDesk));
    await writeFullSnapshot("B04-cross-desk.full.json", crossDesk);
    assert(crossDesk.player.playingClubId === twente.clubId, "cross loan playing tip", {
      playing: crossDesk.player.playingClubId,
      expected: twente.clubId,
    });
    assert(crossDesk.player.employmentClubId === ARSENAL, "cross loan employment remains Arsenal");
    const crossBorrowerDecision = clubDecision(crossDesk, twente.clubId, 2026);
    assert(
      crossBorrowerDecision?.competition || crossBorrowerDecision?.status === "qualified",
      "cross borrower has own target qualification",
      crossBorrowerDecision
    );
    const crossLast = (crossDesk.player.seasons || []).at(-1);
    const crossEurope = crossLast?.europeanCampaign || null;
    const crossField = (crossEurope?.field || []).map((p) => p.clubId || p);
    assert(crossField.includes(twente.clubId), "cross desk field contains Twente borrower", {
      editionId: crossEurope?.editionId,
      field: crossField.slice(0, 12),
      competition: crossEurope?.competition,
    });
    const crossBorrowerObs = (crossEurope?.playerMatches || []).filter(
      (m) =>
        m.home?.clubId === twente.clubId ||
        m.away?.clubId === twente.clubId ||
        m.teamId === twente.clubId
    );
    assert(crossBorrowerObs.length > 0, "dated Twente continental observations on cross loan", {
      count: crossBorrowerObs.length,
      competition: crossEurope?.competition,
      editionId: crossEurope?.editionId,
      qualified: crossEurope?.qualified,
    });

    await assertDeskUsable(page);
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    void reverseDriven;
    void crossDriven;
    return {
      ok: true,
      sum,
      loanReturnExercised: true,
      loanAccepted: true,
      borrowerId,
      borrowerDecision,
      borrowerWasDnq: true,
      parentQualified: true,
      reverseLoan: {
        accepted: true,
        playingClubId: reverseDesk.player.playingClubId,
        employmentClubId: reverseDesk.player.employmentClubId,
        europe: reverseSum.europe,
      },
      crossAssociationLoan: {
        accepted: true,
        playingClubId: crossDesk.player.playingClubId,
        employmentClubId: crossDesk.player.employmentClubId,
        borrowerDecision: crossBorrowerDecision,
      },
      employmentAtDesk: desk.player.employmentClubId,
      playingAtDesk: desk.player.playingClubId,
      deskDecisions: driven.trace.deskDecisions,
      accepted,
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
    await writeFullSnapshot("B05-desk.full.json", desk);
    const ed1 = editionSummary(desk);
    assert(ed1?.editionId === ed0.editionId, "editionId frozen across season/move", { ed0, ed1 });
    assert(JSON.stringify(ed1.field) === JSON.stringify(ed0.field), "field frozen", { ed0, ed1 });
    const moved = desk.player.playingClubId !== ARSENAL;
    assert(moved, "mid-season move required", {
      playingClubId: desk.player.playingClubId,
      deskDecisions: driven.trace.deskDecisions,
    });
    const sum = qualSummary(desk.player, desk);
    await assertDeskUsable(page);
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    return {
      ok: true,
      editionPreserved: true,
      moved: true,
      destination: desk.player.playingClubId,
      europeAtDestination: sum.europe,
      ed0,
      ed1,
      deskDecisions: driven.trace.deskDecisions,
    };
  },

  /** Real mid-season pause / restore / finish branch compare. */
  async B06(page, guards) {
    const snap = buildSeededSnap({
      id: "fix09-b06",
      clubId: ARSENAL,
      seed: 9107,
      ovr: 79,
      placements: { 1: ARSENAL, 17: BRENTFORD },
    });
    await writeCase("B06-initial.json", slimEvidence(snap));
    // Fresh page before the live branch so prior cases cannot leave module caches
    // that a later freshRestore would wipe — otherwise live≠restored only in suite order.
    await freshRestore(page, snap);
    const paused = await driveToMidSeasonPause(page, { seasonsBefore: 0, shotPrefix: "B06" });
    await writeCase("B06-before-continue.json", slimEvidence({ snapshot: paused.snapshot, debug: paused.debug, ui: paused.ui }));
    await writeFullSnapshot("B06-before-continue.full.json", paused.snapshot);
    assert((paused.snapshot.player.seasons || []).length === 0, "mid-season pause before finalize");
    assert(
      paused.snapshot.player.seasonCheckpoint?.status === "awaiting_decision",
      "real awaiting_decision checkpoint required",
      {
        ck: paused.snapshot.player.seasonCheckpoint?.status,
        debug: paused.debug?.seasonCheckpoint,
      }
    );

    // A: continue live paused session (no reload/restore).
    // B/C/D: each restore the immutable pause JSON in a separate fresh browser context.
    const browser = page.context().browser();
    const baseUrl = new URL(page.url()).origin + "/";
    assert(browser, "B06 requires an attached browser for fresh contexts");

    async function assertPausedReady(p, label) {
      const ui = await uiState(p);
      assert(
        ui.debug?.seasonCheckpoint === "awaiting_decision" ||
          ui.nextAction?.id === "resolve-decision" ||
          ui.nextAction?.id === "resolve-offers" ||
          ui.nextAction?.id === "resume-season" ||
          Boolean(ui.debug?.pendingDecision) ||
          Boolean(paused.snapshot.player?.seasonCheckpoint),
        `${label}: mid-season pause still awaiting decision`,
        { seasonCheckpoint: ui.debug?.seasonCheckpoint, nextAction: ui.nextAction }
      );
    }

    async function finishLiveFromPause(shotPrefix) {
      await assertPausedReady(page, "live-A");
      const driven = await driveSeasonToDesk(page, {
        seasonsBefore: 0,
        alreadyRunning: true,
        shotPrefix,
        deskPolicy: "stay",
        timeoutMs: 240000,
      });
      const desk = await exportSnapshot(page);
      const continueProbe = continueCommitProbe(driven.beforeContinue?.snapshot, desk);
      return {
        driven,
        desk,
        preDecision: null,
        beforeContinue: driven.beforeContinue?.snapshot || null,
        continueProbe,
        path: "live",
        context: "shared-live-page",
      };
    }

    async function finishRestoredInFreshContext(shotPrefix, branchId) {
      const { context, page: p } = await openFreshContextPage(browser, baseUrl, guards);
      try {
        await restore(p, paused.snapshot);
        await assertPausedReady(p, branchId);
        const preDecision = await exportSnapshot(p);
        await writeCase(`B06-${branchId}-pre-decision.json`, slimEvidence(preDecision));
        await writeFullSnapshot(`B06-${branchId}-pre-decision.full.json`, preDecision);
        const driven = await driveSeasonToDesk(p, {
          seasonsBefore: 0,
          alreadyRunning: true,
          shotPrefix,
          deskPolicy: "stay",
          timeoutMs: 240000,
        });
        const desk = await exportSnapshot(p);
        const continueProbe = continueCommitProbe(driven.beforeContinue?.snapshot, desk);
        if (driven.beforeContinue?.snapshot) {
          await writeCase(`B06-${branchId}-before-continue.json`, slimEvidence(driven.beforeContinue));
          await writeFullSnapshot(`B06-${branchId}-before-continue.full.json`, driven.beforeContinue.snapshot);
        }
        return {
          driven,
          desk,
          preDecision,
          beforeContinue: driven.beforeContinue?.snapshot || null,
          continueProbe,
          path: "restored-fresh-context",
          context: branchId,
        };
      } finally {
        await context.close().catch(() => {});
      }
    }

    const branchA = await finishLiveFromPause("B06");
    await writeCase("B06-desk-a.json", slimEvidence(branchA.desk));
    await writeFullSnapshot("B06-desk-a.full.json", branchA.desk);
    if (branchA.beforeContinue) {
      await writeCase("B06-a-before-continue.json", slimEvidence({ snapshot: branchA.beforeContinue }));
      await writeFullSnapshot("B06-a-before-continue.full.json", branchA.beforeContinue);
    }
    const a = qualSummary(branchA.desk.player, branchA.desk);
    assert(a.seasons === 1, "branch A completes exactly one season", a);
    assert(a.europe.competition === "Champions League", "branch A CL from seeded parent", a);

    const branchB = await finishRestoredInFreshContext("B06-branch", "desk-b");
    await writeCase("B06-desk-b.json", slimEvidence(branchB.desk));
    await writeFullSnapshot("B06-desk-b.full.json", branchB.desk);
    const b = qualSummary(branchB.desk.player, branchB.desk);

    const branchC = await finishRestoredInFreshContext("B06-dual-a", "desk-c");
    await writeCase("B06-desk-c.json", slimEvidence(branchC.desk));
    await writeFullSnapshot("B06-desk-c.full.json", branchC.desk);

    const branchD = await finishRestoredInFreshContext("B06-dual-b", "desk-d");
    await writeCase("B06-desk-d.json", slimEvidence(branchD.desk));
    await writeFullSnapshot("B06-desk-d.full.json", branchD.desk);

    const fullSnapEqual = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    const abFullDiffs = collectFieldDiffs(branchA.desk, branchB.desk);
    const cdFullDiffs = collectFieldDiffs(branchC.desk, branchD.desk);
    const abEqual = fullSnapEqual(branchA.desk, branchB.desk);
    const cdEqual = fullSnapEqual(branchC.desk, branchD.desk);
    const dualEqual =
      fullSnapEqual(branchC.desk.world, branchD.desk.world) &&
      Number(branchC.desk.world?.rngState) === Number(branchD.desk.world?.rngState) &&
      fullSnapEqual(branchC.desk.clubFinance, branchD.desk.clubFinance) &&
      fullSnapEqual(branchC.desk.player?.pendingOffers || [], branchD.desk.player?.pendingOffers || []);

    await writeCase("B06-dual-restore-compare.json", {
      dualEqual,
      fullSnapshotEqualCD: cdEqual,
      pathC: branchC.path,
      pathD: branchD.path,
      branchC: "B06-desk-c",
      branchD: "B06-desk-d",
      freshContexts: true,
      fieldDiffCount: cdFullDiffs.length,
      fieldDiffs: cdFullDiffs,
      continueProbeC: branchC.continueProbe,
      continueProbeD: branchD.continueProbe,
      traceC: branchC.driven.trace,
      traceD: branchD.driven.trace,
    });

    const protectedCompare = {
      worldEqual: fullSnapEqual(branchA.desk.world, branchB.desk.world),
      fullSnapshotEqualAB: abEqual,
      rngEqual:
        Number(branchA.desk.world?.rngSeed) === Number(branchB.desk.world?.rngSeed) &&
        Number(branchA.desk.world?.rngState) === Number(branchB.desk.world?.rngState) &&
        Number(branchA.desk.rngSeed ?? branchA.desk.world?.rngState) ===
          Number(branchB.desk.rngSeed ?? branchB.desk.world?.rngState),
      clubFinanceEqual: fullSnapEqual(branchA.desk.clubFinance, branchB.desk.clubFinance),
      pendingOffersEqual: fullSnapEqual(
        branchA.desk.player.pendingOffers || [],
        branchB.desk.player.pendingOffers || []
      ),
      pendingDecisionEqual: fullSnapEqual(
        branchA.desk.player.pendingDecision || null,
        branchB.desk.player.pendingDecision || null
      ),
      playingStintsEqual: fullSnapEqual(
        branchA.desk.player.playingStints || [],
        branchB.desk.player.playingStints || []
      ),
      seasonsEqual: fullSnapEqual(branchA.desk.player.seasons || [], branchB.desk.player.seasons || []),
      qualificationEqual: fullSnapEqual(
        branchA.desk.world?.qualification || [],
        branchB.desk.world?.qualification || []
      ),
      wageEqual: branchA.desk.player.weeklyWage === branchB.desk.player.weeklyWage,
      contractEqual: branchA.desk.player.contractStatus === branchB.desk.player.contractStatus,
    };
    await writeCase("B06-protected-compare.json", {
      protectedCompare,
      branchAPath: branchA.path,
      branchBPath: branchB.path,
      liveVersusRestored: true,
      freshContextsBCD: true,
      dualRestoreEqual: dualEqual,
      fullSnapshotEqualAB: abEqual,
      fullSnapshotEqualCD: cdEqual,
      liveRestoredFieldDiffCount: abFullDiffs.length,
      liveRestoredFieldDiffs: abFullDiffs,
      continueProbeA: branchA.continueProbe,
      continueProbeB: branchB.continueProbe,
      continueProbeC: branchC.continueProbe,
      continueProbeD: branchD.continueProbe,
      traceA: branchA.driven.trace,
      traceB: branchB.driven.trace,
      traceC: branchC.driven.trace,
      traceD: branchD.driven.trace,
      pendingOffersA: (branchA.desk.player.pendingOffers || []).map((o) => o.clubId || o.club),
      pendingOffersB: (branchB.desk.player.pendingOffers || []).map((o) => o.clubId || o.club),
      ledgerKeysA: Object.keys(branchA.desk.clubFinance?.ledgers || {}).sort(),
      ledgerKeysB: Object.keys(branchB.desk.clubFinance?.ledgers || {}).sort(),
    });
    await writeCase("B06-action-traces.json", {
      A: branchA.driven.trace,
      B: branchB.driven.trace,
      C: branchC.driven.trace,
      D: branchD.driven.trace,
    });
    await writeCase("B06-continue-commit-probes.json", {
      A: branchA.continueProbe,
      B: branchB.continueProbe,
      C: branchC.continueProbe,
      D: branchD.continueProbe,
    });

    // Evaluate gates only after all branch evidence is written.
    assert(cdEqual, "B06 C↔D full snapshots must be byte-equal", {
      fieldDiffCount: cdFullDiffs.length,
      fieldDiffs: cdFullDiffs.slice(0, 40),
    });
    assert(dualEqual, "B06 dual-restore repeatability must hold", {
      fieldDiffCount: cdFullDiffs.length,
      fieldDiffs: cdFullDiffs.slice(0, 40),
    });
    assert(abEqual, "B06 A↔B full snapshots must be byte-equal", {
      fieldDiffCount: abFullDiffs.length,
      fieldDiffs: abFullDiffs.slice(0, 40),
    });
    assert(protectedCompare.worldEqual, "B06 world state must match across branches", {
      fieldDiffCount: abFullDiffs.length,
      fieldDiffs: abFullDiffs.slice(0, 40),
    });
    assert(protectedCompare.rngEqual, "B06 RNG state must match across branches", {
      a: { seed: branchA.desk.world?.rngSeed, state: branchA.desk.world?.rngState, top: branchA.desk.rngSeed },
      b: { seed: branchB.desk.world?.rngSeed, state: branchB.desk.world?.rngState, top: branchB.desk.rngSeed },
    });
    assert(protectedCompare.pendingOffersEqual, "B06 pendingOffers must match across branches", {
      offersA: (branchA.desk.player.pendingOffers || []).map((o) => o.clubId),
      offersB: (branchB.desk.player.pendingOffers || []).map((o) => o.clubId),
    });
    assert(protectedCompare.playingStintsEqual, "B06 playingStints must match across branches");
    assert(protectedCompare.seasonsEqual, "B06 seasons evidence must match across branches");
    assert(protectedCompare.qualificationEqual, "B06 qualification maps must match across branches");
    for (const [label, probe] of [
      ["A", branchA.continueProbe],
      ["B", branchB.continueProbe],
      ["C", branchC.continueProbe],
      ["D", branchD.continueProbe],
    ]) {
      assert(probe.seasonsUnchanged, `B06 Continue must not add a season commit (${label})`, probe);
      assert(probe.ageUnchanged, `B06 Continue must not advance age (${label})`, probe);
      assert(probe.fixtureLedgerUnchanged, `B06 Continue must not add fixtures (${label})`, probe);
      assert(probe.clubFinanceUnchanged, `B06 Continue must not mutate finance (${label})`, probe);
    }
    const liveLoanClubs = (branchA.desk.player.pendingDecision?.loanOffers || []).map((o) => o.clubId || o.club);
    const restoredLoanClubs = (branchB.desk.player.pendingDecision?.loanOffers || []).map((o) => o.clubId || o.club);
    const marketDivergence = {
      clubFinanceEqual: protectedCompare.clubFinanceEqual,
      pendingDecisionEqual: protectedCompare.pendingDecisionEqual,
      liveLoanClubs,
      restoredLoanClubs,
      onlyLedgerA: Object.keys(branchA.desk.clubFinance?.ledgers || {}).filter(
        (k) => !(branchB.desk.clubFinance?.ledgers || {})[k]
      ),
      onlyLedgerB: Object.keys(branchB.desk.clubFinance?.ledgers || {}).filter(
        (k) => !(branchA.desk.clubFinance?.ledgers || {})[k]
      ),
    };
    await writeCase("B06-live-market-divergence.json", marketDivergence);
    assert(dualEqual, "B06 dual-restore must keep finance/offers identical");
    assert(protectedCompare.clubFinanceEqual, "B06 clubFinance must match across live/restored branches", marketDivergence);
    assert(
      protectedCompare.pendingDecisionEqual,
      "B06 pendingDecision must match across live/restored branches",
      marketDivergence
    );
    assert(b.seasons === a.seasons && b.age === a.age, "branch seasons/age match", { a, b });
    assert(b.europe.competition === a.europe.competition, "branch Europe competition match", { a, b });
    assert(b.playingClubId === a.playingClubId, "branch playing club match", { a, b });
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    return {
      ok: true,
      midSeasonPauseBranch: true,
      checkpointStatus: paused.snapshot.player.seasonCheckpoint?.status,
      deskA: a,
      deskB: b,
      branchCompare: true,
      protectedCompare,
      freshContextsBCD: true,
      fullSnapshotEqualAB: abEqual,
      fullSnapshotEqualCD: cdEqual,
      traceA: branchA.driven.trace,
      traceB: branchB.driven.trace,
      traceC: branchC.driven.trace,
      traceD: branchD.driven.trace,
      continueProbes: {
        A: branchA.continueProbe,
        B: branchB.continueProbe,
        C: branchC.continueProbe,
        D: branchD.continueProbe,
      },
    };
  },

  /** Non-UEFA calendar-year league (Brazil) with played source→target rollover. */
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

    // Played source→target rollover: complete a second calendar year from the just-finished table.
    const next = await driveSeasonToDesk(page, {
      seasonsBefore: sum.seasons,
      shotPrefix: "B07-next",
      timeoutMs: 240000,
    });
    const nextDesk = await exportSnapshot(page);
    await writeCase("B07-next-desk.json", slimEvidence(nextDesk));
    await writeFullSnapshot("B07-desk.full.json", nextDesk);
    const nextSum = qualSummary(nextDesk.player, nextDesk);
    assert(nextSum.seasons === sum.seasons + 1, "Brazil second calendar year completed", { sum, nextSum });
    const sourceTable = (desk.player.seasons || []).at(-1)?.standing?.table || null;
    assert(Array.isArray(sourceTable) && sourceTable.length > 0, "Brazil source table present");
    const clubRow = sourceTable.find((r) => r.clubId === club.clubId);
    assert(clubRow, "club row in Brazil source table");
    const expectedNext = expectedCompetitionFromFinish(league, clubRow);
    const nextDecision = clubDecision(nextDesk, club.clubId, 2027);
    assert(
      decisionMatchesFinish(nextDecision, expectedNext),
      "Brazil next-year registry matches played finish",
      { expectedNext, nextDecision, position: clubRow.position }
    );
    if (expectedNext) {
      assert(nextSum.europe.competition === expectedNext, "Brazil rollover campaign matches finish", {
        expectedNext,
        europe: nextSum.europe,
      });
      assert(nextSum.europe.qualified === true && nextSum.europe.showcase !== true, "earned Brazil rollover", nextSum);
    } else {
      assert(
        nextSum.europe.qualified !== true || nextSum.europe.showcase === true,
        "Brazil DNQ finish must not invent earned continental entry",
        nextSum
      );
    }
    await assertDeskUsable(page);
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    void driven;
    void next;
    return {
      ok: true,
      sum,
      next: nextSum,
      clubId: club.clubId,
      leagueId: league.leagueId,
      expectedNext,
      nextDecision,
      calendarRollover: true,
    };
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

  /** Free-agent gap / re-signing: real search period, then accept; no obsolete Arsenal entry. */
  async B09(page, guards) {
    const startAge = 22;
    const snap = buildSeededSnap({
      id: "fix09-b09",
      clubId: BRENTFORD,
      seed: 9111,
      ovr: 70,
      age: startAge,
      freeAgent: true,
      placements: { 1: ARSENAL, 17: BRENTFORD },
      stalePlayerRowClubId: ARSENAL,
    });
    // Start with an empty market so Simulate advances a real FA search/train period.
    snap.player.pendingOffers = [];
    snap.player.pendingDecision = null;
    await writeCase("B09-initial.json", slimEvidence(snap));
    await writeFullSnapshot("B09-initial.full.json", snap);
    await restore(page, snap);
    await shot(page, "B09-01-fa-desk");
    const start = await exportSnapshot(page);
    assert(start.player.contractStatus === "released" || !start.player.club, "FA lifecycle");
    assert((start.player.seasons || []).length === 0, "FA starts with zero club seasons");
    const ui0 = await uiState(page);
    assert(ui0.simulateDisabled === false, "FA desk must expose Search/train simulate", ui0);

    await page.click("#simulate-btn");
    await page.waitForTimeout(500);
    // Clear any empty-market acknowledgements / Continue so the FA period commits.
    const faDriven = await driveSeasonToDesk(page, {
      seasonsBefore: 0,
      alreadyRunning: true,
      shotPrefix: "B09",
      deskPolicy: "decline-offers",
      timeoutMs: 180000,
    });
    const afterSearch = await exportSnapshot(page);
    await writeCase("B09-after-search.json", slimEvidence(afterSearch));
    await writeFullSnapshot("B09-after-search.full.json", afterSearch);
    const searchAge = afterSearch.player.age;
    const searchSeasons = (afterSearch.player.seasons || []).length;
    assert(
      searchAge > startAge || searchSeasons >= 1,
      "FA search/train period must advance age or record a free-agent season",
      { startAge, searchAge, searchSeasons, trace: faDriven.trace }
    );
    assert(
      afterSearch.player.contractStatus === "released" || !afterSearch.player.club,
      "still free agent after search period",
      {
        contractStatus: afterSearch.player.contractStatus,
        club: afterSearch.player.club,
      }
    );

    // Separate control: seed a real Brentford offer after the search gap and accept it.
    const brentford = clubIn(leagueById(EPL), BRENTFORD);
    const offer = {
      offerId: `fix09-b09:${BRENTFORD}:post-search`,
      club: brentford.name,
      clubDisplay: brentford.displayName || brentford.name,
      clubId: BRENTFORD,
      league: "England - Premier League",
      leagueId: EPL,
      nation: "England",
      dealType: "permanent",
      isLoan: false,
      isRenewal: false,
      isFreeAgent: true,
      transferFee: 0,
      wage: 4000,
      contractYears: 2,
      expectedRole: "rotation",
      status: "pending",
      effectiveDate: "2027-07-01",
      reviewDate: "2027-07-01",
    };
    afterSearch.player.pendingOffers = [offer];
    afterSearch.player.pendingDecision = { kind: "transfer-offers", offers: [offer] };
    await freshRestore(page, afterSearch);
    await page.waitForTimeout(300);
    const accepted = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button")].filter((b) => !b.disabled && b.offsetParent !== null);
      const hit =
        buttons.find((b) => /brentford/i.test(b.textContent || "") && /accept|sign/i.test(b.textContent || "")) ||
        buttons.find((b) => /accept offer|sign for|^accept$/i.test((b.textContent || "").trim()));
      if (!hit) return null;
      hit.click();
      return (hit.textContent || "").trim();
    });
    assert(accepted, "must accept real free-agent re-signing offer after search", { accepted });
    await page.waitForTimeout(400);
    const signed = await exportSnapshot(page);
    assert(
      signed.player.contractStatus === "active" && signed.player.playingClubId === BRENTFORD,
      "post-search re-signing required",
      {
        contractStatus: signed.player.contractStatus,
        playingClubId: signed.player.playingClubId,
      }
    );

    // Start the destination period and resolve entry for Brentford's actual target edition.
    const clubDriven = await driveSeasonToDesk(page, {
      seasonsBefore: (signed.player.seasons || []).length,
      shotPrefix: "B09-club",
      deskPolicy: "stay",
      timeoutMs: 240000,
    });
    const desk = await exportSnapshot(page);
    await writeCase("B09-desk.json", slimEvidence(desk));
    await writeFullSnapshot("B09-desk.full.json", desk);
    const sum = qualSummary(desk.player, desk);
    assert(sum.playingClubId === BRENTFORD, "destination period at Brentford", sum);
    assert(sum.seasons > searchSeasons, "destination club season completed after re-signing", {
      searchSeasons,
      seasons: sum.seasons,
    });
    assert(
      sum.europe.qualified !== true || sum.europe.competition !== "Champions League",
      "re-signed Brentford must not invent Arsenal CL",
      sum
    );
    assert(
      clubDecision(desk, BRENTFORD, 2026)?.status === "not-qualified" ||
        clubDecision(desk, BRENTFORD, 2027)?.status === "not-qualified" ||
        !sum.europe.qualified,
      "Brentford DNQ authority retained across FA gap",
      {
        b2026: clubDecision(desk, BRENTFORD, 2026),
        b2027: clubDecision(desk, BRENTFORD, 2027),
        europe: sum.europe,
      }
    );
    await assertDeskUsable(page);
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    void clubDriven;
    return {
      ok: true,
      sum,
      searchCompleted: true,
      searchAge,
      searchSeasons,
      startAge,
      reSignedClub: desk.player.playingClubId,
      noSoftLock: true,
      transitions: {
        ages: [startAge, searchAge, desk.player.age],
        seasons: [0, searchSeasons, sum.seasons],
        contract: ["released", "released", desk.player.contractStatus],
      },
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
  const requiredComplete = REQUIRED.every((id) => report.cases[id]?.ok);
  const selectedComplete = SELECTED.every((id) => report.cases[id]?.ok);
  const subsetOnly = SELECTED.length !== REQUIRED.length || SELECTED.some((id) => !REQUIRED.includes(id));
  report.requiredIds = REQUIRED;
  report.selectedIds = SELECTED;
  report.subsetOnly = subsetOnly;
  report.requiredComplete = requiredComplete;
  // Full acceptance requires all nine required IDs. A subset run cannot become a complete pass.
  report.ok = !report.blocked && !subsetOnly && requiredComplete;
  report.selectedOk = !report.blocked && selectedComplete;
  await writeFile(OUT, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        out: OUT,
        ok: report.ok,
        selectedOk: report.selectedOk,
        subsetOnly: report.subsetOnly,
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
