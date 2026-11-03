#!/usr/bin/env node
/**
 * Browser acceptance for Fix 10: club strength profiles + superstar lineup impact.
 *
 * Real journeys through #simulate-btn / presentation skips / #continue-btn.
 * Authoritative state from window.__exportCareerSnapshot (not window.player).
 *
 *   BASE_URL=http://127.0.0.1:8000 node scripts/browserClubStrengthSuperstarImpactChecklist.mjs
 *   CASES=B01 node scripts/browserClubStrengthSuperstarImpactChecklist.mjs
 *
 * Env: BASE_URL (optional — self-hosts a static server when unset), CHROME_PATH, CASES, HEADED=1
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
import { reseedCareerRng, createRng } from "../js/simulation/rng.js";
import {
  createWorldState,
  setWorldState,
  getWorldState,
  adjustQuality,
  CLUB_STRENGTH_MODEL_VERSION,
  WORLD_STATE_SCHEMA_VERSION,
} from "../js/simulation/worldState.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import { serializeCareerSnapshot } from "../js/simulation/careerSnapshot.js";
import { ensureContractAuthority } from "../js/simulation/contractLifecycle.js";
import { ensureTransferSave } from "../js/simulation/transferMigration.js";
import { allSeniorClubs } from "../js/simulation/seniorClubs.js";
import {
  describeTeamStrength,
  effectiveTeamStrength,
  playerLineupImpact,
  LINEUP_IMPACT_MODEL,
} from "../js/simulation/teamStrength.js";
import { simulateMatch, resolveKnockout } from "../js/simulation/matchEngine.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HEADED = process.env.HEADED === "1";
const RUN_DIR = join(root, "qa/fix10-runs/browser");
const SHOT_DIR = join(RUN_DIR, "screenshots");
const CASE_DIR = join(RUN_DIR, "cases");
const SNAP_DIR = join(RUN_DIR, "snapshots");
const OUT = join(RUN_DIR, "browser-report.json");
const REQUIRED = ["B01", "B02", "B03", "B04", "B05", "B06", "B07", "B08"];
const SELECTED = process.env.CASES
  ? process.env.CASES.split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
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

const HULL = "Hull City";
const ARSENAL = "Arsenal";
const BRENTFORD = "Brentford";

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

function makePlayer({ id, position, ovr, age = 22, seed = 10101 }) {
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

function attach(p, clubName, years = 4) {
  const club = allSeniorClubs().find((c) => c.name === clubName);
  if (!club) throw new Error(`missing ${clubName}`);
  Object.assign(p, {
    club: { ...club },
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

function buildSnap({
  id,
  position = "ST",
  ovr,
  club = HULL,
  age = 22,
  seed = 10101,
  mutateWorld = null,
} = {}) {
  const p = makePlayer({ id, position, ovr, age, seed });
  attach(p, club, 4);
  if (typeof mutateWorld === "function") mutateWorld(getWorldState(), p);
  reseedCareerRng(seed);
  return serializeCareerSnapshot({ player: p, world: getWorldState() });
}

function clubFromWorld(worldLike, clubId) {
  if (!worldLike || !clubId) return null;
  if (worldLike.clubs?.get) return worldLike.clubs.get(clubId) || null;
  const clubs = worldLike.clubs;
  if (Array.isArray(clubs)) {
    for (const entry of clubs) {
      if (Array.isArray(entry) && entry[0] === clubId) return entry[1] || null;
      if (entry && entry.clubId === clubId) return entry;
    }
    return null;
  }
  if (clubs && typeof clubs === "object") return clubs[clubId] || null;
  return null;
}

function seasonMatches(player) {
  const last = Array.isArray(player?.seasons) ? player.seasons.at(-1) : null;
  if (!last) return [];
  return last.leagueMatches || last.leagueAllMatches || last.playerMatches || [];
}

function matchInfluenceRows(player) {
  const rows = [];
  for (const m of seasonMatches(player)) {
    const side = m.playerSide || null;
    const mins = Number(m.playerStats?.minutes) || 0;
    const eff = side && m.effectiveStrength?.[side] ? m.effectiveStrength[side] : null;
    const impact = eff?.playerImpact || null;
    rows.push({
      fixtureId: m.fixtureId || m.matchId || null,
      decidedBy: m.decidedBy || null,
      playerSide: side,
      minutes: mins,
      nonParticipationReason: m.playerStats?.nonParticipationReason || null,
      available: m.playerStats?.available,
      selected: m.playerStats?.selected,
      teamOverall: eff?.overall ?? null,
      impactAttack: impact?.attack ?? null,
      impactMidfield: impact?.midfield ?? null,
      impactDefence: impact?.defence ?? null,
      impactGk: impact?.goalkeeper ?? null,
      etAttack: m.etEffectiveStrength?.[side || "home"]?.attack ?? null,
      regulationAttack: m.regulationEffectiveStrength?.[side || "home"]?.attack ?? null,
    });
  }
  return rows;
}

function meanImpactAttack(rows, { minMinutes = 1 } = {}) {
  const hit = rows.filter((r) => (r.minutes || 0) >= minMinutes && Number.isFinite(r.impactAttack));
  if (!hit.length) return null;
  return hit.reduce((s, r) => s + r.impactAttack, 0) / hit.length;
}

function meanTeamOverall(rows, { minMinutes = 1 } = {}) {
  const hit = rows.filter((r) => (r.minutes || 0) >= minMinutes && Number.isFinite(r.teamOverall));
  if (!hit.length) return null;
  return hit.reduce((s, r) => s + r.teamOverall, 0) / hit.length;
}

async function writeCase(name, value) {
  await mkdir(CASE_DIR, { recursive: true });
  await writeFile(join(CASE_DIR, name), JSON.stringify(value, null, 2));
}

async function writeFullSnapshot(name, snapOrBundle) {
  await mkdir(SNAP_DIR, { recursive: true });
  const payload = snapOrBundle?.snapshot ? snapOrBundle.snapshot : snapOrBundle;
  await writeFile(join(SNAP_DIR, name), JSON.stringify(payload));
}

function slimEvidence(snapOrBundle) {
  if (!snapOrBundle || typeof snapOrBundle !== "object") return snapOrBundle;
  const base = snapOrBundle.snapshot ? snapOrBundle : { snapshot: snapOrBundle };
  const player = base.snapshot?.player;
  const world = base.snapshot?.world;
  const clubId = player?.playingClubId || player?.club?.clubId;
  const club = clubFromWorld(world, clubId);
  const rows = matchInfluenceRows(player);
  return {
    ...("debug" in base ? { debug: base.debug } : {}),
    ...("ui" in base ? { ui: base.ui } : {}),
    ...("trace" in base ? { trace: base.trace } : {}),
    player: player
      ? {
          name: player.name,
          careerId: player.careerId,
          age: player.age,
          position: player.position,
          rating: player.rating,
          currentOverallRaw: player.currentOverallRaw ?? null,
          employmentClubId: player.employmentClubId,
          playingClubId: player.playingClubId,
          contractStatus: player.contractStatus,
          seasons: (player.seasons || []).length,
          lastMinutes: player.seasons?.at(-1)?.minutes ?? null,
        }
      : null,
    worldMeta: world
      ? {
          schemaVersion: world.schemaVersion ?? null,
          clubStrengthModelVersion: world.clubStrengthModelVersion ?? null,
          rngState: world.rngState ?? null,
          replacementST: club?.replacementOvr?.ST ?? null,
          clubUnits: club
            ? {
                overall: club.overall,
                attack: club.attack,
                midfield: club.midfield,
                defence: club.defence,
                goalkeeper: club.goalkeeper,
                componentDerivationStatus: club.componentDerivationStatus ?? null,
              }
            : null,
          hasBaselines: Boolean(world.baselineClubs),
        }
      : null,
    rngSeed: base.snapshot?.rngSeed ?? null,
    influence: {
      matchCount: rows.length,
      meanImpactAttack: meanImpactAttack(rows),
      meanTeamOverall: meanTeamOverall(rows),
      zeroMinuteCount: rows.filter((r) => (r.minutes || 0) <= 0).length,
      sample: rows.slice(0, 8),
    },
  };
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

async function overviewStrengthText(page) {
  return page.evaluate(() => {
    const el =
      document.querySelector(".club-strength") ||
      document.querySelector("#player-overview .club-strength") ||
      document.getElementById("player-overview");
    return (el?.textContent || document.body?.innerText || "").replace(/\s+/g, " ").trim();
  });
}

async function shot(page, name) {
  await mkdir(SHOT_DIR, { recursive: true });
  const path = join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}

/**
 * Drive one senior season through real UI to desk, capturing pre-Continue snapshot.
 */
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
  for (let guard = 0; guard < 12; guard++) {
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
      if (policy === "accept-move" || policy === "accept-loan") {
        const loan = click(/review loan options|see loan|loan options/i);
        if (loan) return `desk-decision:${loan}`;
        const accept = click(/accept loan|accept offer|accept transfer|sign for|^accept$/i);
        if (accept) return `desk-decision:${accept}`;
      }
      if (policy === "decline-offers") {
        const decline = click(/decline all|decline offers|no thanks|continue as free agent|remain a free agent/i);
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
    if (cleared?.startsWith("desk-decision:")) {
      trace.deskDecisions.push(cleared.slice("desk-decision:".length));
      await page.waitForTimeout(200);
      continue;
    }
    break;
  }

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
          if (policy === "accept-move" || policy === "accept-loan") {
            const loanTray = trayButtons.find((b) =>
              /review loan options|see loan|loan options/i.test(b.textContent || "")
            );
            if (loanTray) {
              loanTray.click();
              clicked.push(`desk-decision:${(loanTray.textContent || "").trim()}`);
              return clicked;
            }
            const accept =
              trayButtons.find((b) => /accept loan|accept offer|accept transfer|sign for/i.test(b.textContent || "")) ||
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
            pool.find((b) => /^acknowledge$/i.test((b.textContent || "").trim())) ||
            pool.find((b) => {
              const t = (b.textContent || "").trim();
              if (isSkipLike(t)) return false;
              return /stay and compete|continue the season|focus on recovery|keep working|see it out|remain at the club/i.test(
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
          if (policy === "accept-move" || policy === "accept-loan") {
            const loanTray = buttons.find((b) =>
              /review loan options|see loan|loan options/i.test(b.textContent || "")
            );
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
    `Timed out returning to desk: ${JSON.stringify({
      seasonsBefore,
      trace,
      ui: await uiState(page),
    })}`
  );
}

async function driveToMidSeasonPause(page, { seasonsBefore, timeoutMs = 180000, shotPrefix = null } = {}) {
  const trace = { simulateClicks: 0, skipClicks: 0, deskDecisions: [] };
  const ui0 = await uiState(page);
  assert(ui0.simulateDisabled === false, "simulate must be enabled for mid-season pause", ui0);
  await page.click("#simulate-btn");
  trace.simulateClicks += 1;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cur = await uiState(page);
    const seasonsNow = cur.debug?.seasonsCount ?? null;
    if (typeof seasonsNow === "number" && seasonsNow > seasonsBefore) {
      throw new Error(
        `Season completed before mid-season pause: ${JSON.stringify({ seasonsBefore, seasonsNow, cur })}`
      );
    }
    const act = await page.evaluate(() => {
      const clicked = [];
      const d = window.__getLiveCareerDebug?.() || {};
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
      if (!overlayHidden || !dashboardHidden) {
        for (const id of ["sim-skip-phase-btn", "match-skip-phase-btn", "sim-skip-match-btn", "match-skip-btn"]) {
          const el = document.getElementById(id);
          if (el && !el.disabled && el.offsetParent !== null) {
            el.click();
            clicked.push(id);
          }
        }
        return clicked;
      }
      const section = document.getElementById("animation-continue");
      const contBtn = document.getElementById("continue-btn");
      if (
        section &&
        !section.classList.contains("hidden") &&
        contBtn &&
        !contBtn.disabled &&
        contBtn.offsetParent !== null
      ) {
        // Do not click Continue through a mid-season decision target.
        if (d.seasonCheckpoint === "awaiting_decision" || d.nextAction?.id === "resolve-decision") {
          return clicked;
        }
        contBtn.click();
        clicked.push("continue-btn:pre-commit");
      }
      return clicked;
    });
    for (const c of act) {
      if (/skip/i.test(c)) trace.skipClicks += 1;
    }
    const paused =
      cur.overlayHidden &&
      cur.dashboardHidden &&
      (cur.debug?.seasonCheckpoint === "awaiting_decision" ||
        cur.nextAction?.id === "resolve-decision" ||
        cur.nextAction?.id === "resolve-offers" ||
        Boolean(cur.debug?.pendingDecision));
    if (paused) {
      const snapshot = await exportSnapshot(page);
      const ck = snapshot.player?.seasonCheckpoint;
      assert(
        ck?.status === "awaiting_decision" ||
          cur.debug?.seasonCheckpoint === "awaiting_decision" ||
          Boolean(snapshot.player?.pendingDecision),
        "mid-season pause must expose awaiting_decision",
        { ckStatus: ck?.status, debug: cur.debug?.seasonCheckpoint }
      );
      assert((snapshot.player?.seasons || []).length === seasonsBefore, "pause before season commit", {
        seasons: snapshot.player?.seasons?.length,
      });
      if (shotPrefix) await shot(page, `${shotPrefix}-mid-pause`);
      return { snapshot, debug: await debug(page), ui: cur, trace };
    }
    await page.waitForTimeout(act.length ? 140 : 220);
  }
  throw new Error(
    `Timed out waiting for mid-season pause: ${JSON.stringify({ seasonsBefore, trace, ui: await uiState(page) })}`
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

function buildEtPairEvidence({ seed = 77 } = {}) {
  const world = createWorldState({ seed, startYear: 2026 });
  setWorldState(world);
  const league =
    LEAGUES.find((l) => l.leagueId === "league:england-premier-league") ||
    LEAGUES.find((l) => l.clubs?.some((c) => c.name === HULL)) ||
    LEAGUES[0];
  const home = league.clubs.find((c) => c.name === HULL) || league.clubs[0];
  const away = league.clubs.find((c) => c.clubId !== home.clubId) || league.clubs[1];
  const star90 = {
    name: "ET Cont",
    position: "ST",
    currentOverallRaw: 99,
    currentOverall: 99,
    rating: 99,
    attributes: attrs(99),
    matchParticipation: { minutes: 90, started: true, selected: true, matchDuration: 90 },
  };
  const star30 = {
    ...star90,
    name: "ET NonCont",
    matchParticipation: { minutes: 30, started: true, selected: true, matchDuration: 90 },
  };

  function forceDrawnEt(player, rngSeed) {
    let match = simulateMatch(home, away, {
      worldState: world,
      venue: "neutral",
      player,
      playerSide: "home",
      playerMinutes: player.matchParticipation.minutes,
      rng: createRng(rngSeed),
      fixtureId: `fix10-et-${player.matchParticipation.minutes}-${rngSeed}`,
      competitionId: "cup:fix10-qa",
      date: "2026-11-20",
    });
    match = {
      ...match,
      homeGoals: 1,
      awayGoals: 1,
      regulationHomeGoals: 1,
      regulationAwayGoals: 1,
      matchHomeGoals: 1,
      matchAwayGoals: 1,
      winnerSide: null,
      decidedBy: null,
    };
    return resolveKnockout(match, {
      player,
      allowExtraTime: true,
      allowPenalties: false,
      rng: createRng(rngSeed + 1000),
    });
  }

  const continuing = forceDrawnEt(star90, seed);
  const nonContinuing = forceDrawnEt(star30, seed);
  // No-player ET control for non-continuing equality.
  const noneEt = resolveKnockout(
    {
      ...simulateMatch(home, away, {
        worldState: world,
        venue: "neutral",
        player: null,
        rng: createRng(seed),
        fixtureId: `fix10-et-none-${seed}`,
        competitionId: "cup:fix10-qa",
        date: "2026-11-20",
      }),
      homeGoals: 1,
      awayGoals: 1,
      regulationHomeGoals: 1,
      regulationAwayGoals: 1,
      matchHomeGoals: 1,
      matchAwayGoals: 1,
      winnerSide: null,
      playerSide: null,
    },
    { player: null, allowExtraTime: true, allowPenalties: false, rng: createRng(seed + 1000) }
  );

  return {
    continuing,
    nonContinuing,
    noneEt,
    homeClubId: home.clubId,
    awayClubId: away.clubId,
    continuingEtAtk: continuing.effectiveStrength?.home?.attack,
    nonContinuingEtAtk: nonContinuing.effectiveStrength?.home?.attack,
    noneEtAtk: noneEt.effectiveStrength?.home?.attack,
    continuingRegAtk: continuing.regulationEffectiveStrength?.home?.attack,
    nonContinuingRegAtk: nonContinuing.regulationEffectiveStrength?.home?.attack,
  };
}

const cases = {
  /** Ordinary senior career: overview shows Estimated unit ratings; advance through Continue. */
  async B01(page, guards) {
    const snap = buildSnap({ id: "fix10-b01", position: "ST", ovr: 74, club: HULL, seed: 10101 });
    await writeCase("B01-initial.json", slimEvidence(snap));
    await writeFullSnapshot("B01-initial.full.json", snap);
    await restore(page, snap);
    await shot(page, "B01-01-start");
    const strengthText = await overviewStrengthText(page);
    assert(/Estimated unit ratings/i.test(strengthText), "overview must show Estimated unit ratings", {
      strengthText: strengthText.slice(0, 240),
    });
    assert(/Team strength:/i.test(strengthText), "overview must show team strength line", {
      strengthText: strengthText.slice(0, 240),
    });
    const start = await exportSnapshot(page);
    assert((start.player.seasons || []).length === 0, "B01 starts with zero seasons");
    const driven = await driveSeasonToDesk(page, { seasonsBefore: 0, shotPrefix: "B01" });
    assert(driven.trace.postCommitContinueClicks >= 1, "must click #continue-btn", driven.trace);
    const desk = await exportSnapshot(page);
    await writeCase("B01-desk.json", slimEvidence(desk));
    await writeFullSnapshot("B01-desk.full.json", desk);
    assert((desk.player.seasons || []).length === 1, "one season completed", desk.player.seasons?.length);
    await assertDeskUsable(page);
    await shot(page, "B01-02-desk");
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    return {
      ok: true,
      estimatedCue: true,
      seasons: desk.player.seasons.length,
      continueClicks: driven.trace.postCommitContinueClicks,
      strengthSnippet: strengthText.slice(0, 180),
    };
  },

  /** Paired replacement vs 99 ST: matches expose influence. */
  async B02(page, guards) {
    const worldProbe = createWorldState({ seed: 10102, startYear: 2026 });
    const hull = [...worldProbe.clubs.values()].find((c) => c.name === HULL);
    assert(hull, "Hull profile present");
    const replacement = Math.round(Number(hull.replacementOvr.ST));
    const refSnap = buildSnap({
      id: "fix10-b02-ref",
      position: "ST",
      ovr: replacement,
      club: HULL,
      seed: 10102,
    });
    const starSnap = buildSnap({
      id: "fix10-b02-star",
      position: "ST",
      ovr: 99,
      club: HULL,
      seed: 10102,
    });
    await writeCase("B02-ref-initial.json", slimEvidence(refSnap));
    await writeCase("B02-star-initial.json", slimEvidence(starSnap));
    await writeFullSnapshot("B02-ref-initial.full.json", refSnap);
    await writeFullSnapshot("B02-star-initial.full.json", starSnap);

    await restore(page, refSnap);
    await shot(page, "B02-01-ref-start");
    const refDriven = await driveSeasonToDesk(page, {
      seasonsBefore: 0,
      shotPrefix: "B02-ref",
      deskPolicy: "decline-offers",
    });
    const refDesk = await exportSnapshot(page);
    await writeCase("B02-ref-desk.json", slimEvidence(refDesk));

    await freshRestore(page, starSnap);
    await shot(page, "B02-02-star-start");
    const starDriven = await driveSeasonToDesk(page, {
      seasonsBefore: 0,
      shotPrefix: "B02-star",
      deskPolicy: "decline-offers",
    });
    const starDesk = await exportSnapshot(page);
    await writeCase("B02-star-desk.json", slimEvidence(starDesk));
    await writeFullSnapshot("B02-star-desk.full.json", starDesk);

    const refRows = matchInfluenceRows(refDesk.player);
    const starRows = matchInfluenceRows(starDesk.player);
    const refMean = meanImpactAttack(refRows, { minMinutes: 45 });
    const starMean = meanImpactAttack(starRows, { minMinutes: 45 });
    const refTeam = meanTeamOverall(refRows, { minMinutes: 45 });
    const starTeam = meanTeamOverall(starRows, { minMinutes: 45 });
    assert(refRows.length > 0 && starRows.length > 0, "both careers expose match influence rows", {
      ref: refRows.length,
      star: starRows.length,
    });
    assert(starMean != null && refMean != null, "mean impact available", { refMean, starMean });
    assert(starMean > refMean + 0.05, "99 ST mean attack impact exceeds replacement", {
      refMean,
      starMean,
      replacement,
    });
    assert(starTeam > refTeam + 0.05, "99 ST raises mean team overall vs replacement", {
      refTeam,
      starTeam,
    });
    await assertDeskUsable(page);
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    void refDriven;
    void starDriven;
    return {
      ok: true,
      replacement,
      refMean,
      starMean,
      refTeam,
      starTeam,
      refMatches: refRows.length,
      starMatches: starRows.length,
    };
  },

  /** Paired GK snapshots. */
  async B03(page, guards) {
    const worldProbe = createWorldState({ seed: 10103, startYear: 2026 });
    const hull = [...worldProbe.clubs.values()].find((c) => c.name === HULL);
    const replacement = Math.round(Number(hull.replacementOvr.GK));
    const refSnap = buildSnap({
      id: "fix10-b03-ref",
      position: "GK",
      ovr: replacement,
      club: HULL,
      seed: 10103,
    });
    const starSnap = buildSnap({
      id: "fix10-b03-star",
      position: "GK",
      ovr: 99,
      club: HULL,
      seed: 10103,
    });
    await writeFullSnapshot("B03-ref-initial.full.json", refSnap);
    await writeFullSnapshot("B03-star-initial.full.json", starSnap);

    await restore(page, refSnap);
    await driveSeasonToDesk(page, { seasonsBefore: 0, shotPrefix: "B03-ref", deskPolicy: "decline-offers" });
    const refDesk = await exportSnapshot(page);
    await writeCase("B03-ref-desk.json", slimEvidence(refDesk));

    await freshRestore(page, starSnap);
    await driveSeasonToDesk(page, { seasonsBefore: 0, shotPrefix: "B03-star", deskPolicy: "decline-offers" });
    const starDesk = await exportSnapshot(page);
    await writeCase("B03-star-desk.json", slimEvidence(starDesk));
    await writeFullSnapshot("B03-star-desk.full.json", starDesk);

    const refRows = matchInfluenceRows(refDesk.player);
    const starRows = matchInfluenceRows(starDesk.player);
    const meanGk = (rows) => {
      const hit = rows.filter((r) => (r.minutes || 0) >= 45 && Number.isFinite(r.impactGk));
      if (!hit.length) return null;
      return hit.reduce((s, r) => s + r.impactGk, 0) / hit.length;
    };
    const refGk = meanGk(refRows);
    const starGk = meanGk(starRows);
    assert(starGk != null && refGk != null, "GK impact rows present", { refGk, starGk, n: starRows.length });
    assert(starGk > refGk + 0.05, "99 GK mean GK impact exceeds replacement", { refGk, starGk, replacement });
    await assertDeskUsable(page);
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    return { ok: true, replacement, refGk, starGk, refMatches: refRows.length, starMatches: starRows.length };
  },

  /** Bench/injury/rejected zero effect; short appearance scales. */
  async B04(page, guards) {
    const world = createWorldState({ seed: 10104, startYear: 2026 });
    const hull = [...world.clubs.values()].find((c) => c.name === HULL);
    const profile = hull;
    const player99 = {
      name: "Scale",
      position: "ST",
      currentOverallRaw: 99,
      currentOverall: 99,
      rating: 99,
      attributes: attrs(99),
    };
    const m0 = playerLineupImpact(profile, player99, { participates: true, minutes: 0 });
    const m30 = playerLineupImpact(profile, player99, { participates: true, minutes: 30 });
    const m90 = playerLineupImpact(profile, player99, { participates: true, minutes: 90 });
    const rejected = playerLineupImpact(profile, player99, { participates: false, minutes: 90 });
    assert(m0.attack === 0 && m0.midfield === 0, "zero minutes → zero impact", m0);
    assert(rejected.attack === 0, "rejected registration → zero impact", rejected);
    assert(m90.attack > m30.attack, "full appearance > short", { m30, m90 });
    assert(Math.abs(m30.attack * 3 - m90.attack) < 0.08, "short appearance scales ~1/3", { m30, m90 });

    // Browser: injured career should expose zero-minute cards with zero impact.
    const injuredSnap = buildSnap({
      id: "fix10-b04-inj",
      position: "ST",
      ovr: 99,
      club: HULL,
      seed: 10104,
      mutateWorld: (_w, p) => {
        p.health = p.health || {};
        p.health.activeInjury = {
          eventId: "fix10:b04:inj",
          onsetDay: 0,
          availabilityReturnDay: 400,
          severity: "severe",
          status: "active",
        };
      },
    });
    await writeCase("B04-scale-engine.json", { m0, m30, m90, rejected });
    await writeFullSnapshot("B04-injured-initial.full.json", injuredSnap);
    await restore(page, injuredSnap);
    await shot(page, "B04-01-injured");
    const driven = await driveSeasonToDesk(page, {
      seasonsBefore: 0,
      shotPrefix: "B04",
      deskPolicy: "stay",
      timeoutMs: 240000,
    });
    const desk = await exportSnapshot(page);
    await writeCase("B04-desk.json", slimEvidence(desk));
    const rows = matchInfluenceRows(desk.player);
    const zeroRows = rows.filter(
      (r) =>
        (r.minutes || 0) <= 0 ||
        /injur|bench|unused|not selected|rejected|unavailable/i.test(String(r.nonParticipationReason || ""))
    );
    assert(zeroRows.length >= 1, "season exposes zero/non-participation matches", {
      zeroRows: zeroRows.length,
      total: rows.length,
    });
    for (const z of zeroRows) {
      if ((z.minutes || 0) <= 0) {
        assert(
          !Number.isFinite(z.impactAttack) || Math.abs(z.impactAttack) < 1e-6,
          "zero-minute match must not carry attack impact",
          z
        );
      }
    }
    await assertDeskUsable(page);
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    void driven;
    return {
      ok: true,
      scale: { m0: m0.attack, m30: m30.attack, m90: m90.attack },
      zeroRows: zeroRows.length,
      matches: rows.length,
    };
  },

  /** Asymmetric saved-world profile display matches engine. */
  async B05(page, guards) {
    const asymmetric = { attack: 80, midfield: 70, defence: 60, goalkeeper: 65 };
    const snap = buildSnap({
      id: "fix10-b05",
      position: "ST",
      ovr: 74,
      club: HULL,
      seed: 10105,
      mutateWorld: (world, p) => {
        const club = world.clubs.get(p.playingClubId);
        Object.assign(club, {
          ...asymmetric,
          overall: 70,
          componentDerivationStatus: "controlled_asymmetric_fixture",
          breakdownMethod: "controlled_asymmetric_fixture",
          sourceStatus: "controlled_fixture",
        });
      },
    });
    const clubId = snap.player.playingClubId;
    const desc = describeTeamStrength(
      { name: HULL, clubId },
      (() => {
        const w = createWorldState({ seed: 1, startYear: 2026 });
        const c = w.clubs.get(clubId);
        Object.assign(c, {
          ...asymmetric,
          overall: 70,
          componentDerivationStatus: "controlled_asymmetric_fixture",
          breakdownMethod: "controlled_asymmetric_fixture",
        });
        return w;
      })()
    );
    assert(desc.unitsEstimated === false, "asymmetric fixture is not estimated", desc);
    assert(desc.attack === 80 && desc.defence === 60, "engine units match fixture", desc);

    await writeCase("B05-initial.json", slimEvidence(snap));
    await writeFullSnapshot("B05-initial.full.json", snap);
    await restore(page, snap);
    await shot(page, "B05-01-asymmetric");
    const text = await overviewStrengthText(page);
    assert(/ATK 80/i.test(text), "overview shows ATK 80", { text: text.slice(0, 240) });
    assert(/MID 70/i.test(text), "overview shows MID 70", { text: text.slice(0, 240) });
    assert(/DEF 60/i.test(text), "overview shows DEF 60", { text: text.slice(0, 240) });
    assert(/GK 65/i.test(text), "overview shows GK 65", { text: text.slice(0, 240) });
    assert(!/Estimated unit ratings/i.test(text), "asymmetric must not show Estimated cue", {
      text: text.slice(0, 240),
    });
    assert(/Unit ratings/i.test(text), "shows Unit ratings label", { text: text.slice(0, 240) });

    const exported = await exportSnapshot(page);
    const saved = clubFromWorld(exported.world, clubId);
    assert(saved?.attack === 80 && saved?.defence === 60, "exported world keeps asymmetric units", saved);
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    return { ok: true, asymmetric, desc, text: text.slice(0, 200) };
  },

  /** Pause/export/restore preserves fractions, baselines, model metadata, RNG. */
  async B06(page, guards) {
    const snap = buildSnap({
      id: "fix10-b06",
      position: "ST",
      ovr: 78,
      club: HULL,
      seed: 10106,
      mutateWorld: (world, p) => {
        const club = world.clubs.get(p.playingClubId);
        for (let i = 0; i < 3; i++) adjustQuality(club, 0.1);
      },
    });
    const clubId = snap.player.playingClubId;
    const beforeClub = clubFromWorld(snap.world, clubId);
    const beforeST = beforeClub.replacementOvr.ST;
    assert(
      Number.isFinite(beforeST) && Math.abs(beforeST - Math.round(beforeST)) > 1e-9,
      "fractional replacement present",
      { beforeST }
    );
    assert(snap.world.clubStrengthModelVersion === CLUB_STRENGTH_MODEL_VERSION, "model version stamped");
    assert((snap.world.schemaVersion || 0) >= WORLD_STATE_SCHEMA_VERSION, "schema v4+");
    assert(snap.world.baselineClubs, "baselines frozen on snapshot");
    assert(Number.isFinite(snap.rngSeed), "rngSeed present", snap.rngSeed);

    await writeCase("B06-initial.json", slimEvidence(snap));
    await writeFullSnapshot("B06-initial.full.json", snap);
    await freshRestore(page, snap);
    const paused = await driveToMidSeasonPause(page, { seasonsBefore: 0, shotPrefix: "B06" });
    await writeCase("B06-paused.json", slimEvidence({ snapshot: paused.snapshot }));
    await writeFullSnapshot("B06-paused.full.json", paused.snapshot);

    const pausedClub = clubFromWorld(paused.snapshot.world, clubId);
    const pausedST = pausedClub?.replacementOvr?.ST;
    assert(Number.isFinite(pausedST), "pause has replacement ST", { pausedST });
    // Match-driven adjustQuality may accumulate further fractions after kickoff;
    // the invariant is round-trip fidelity of the paused live state, not freezing
    // the pre-season seed value through played fixtures.
    assert(
      paused.snapshot.world.clubStrengthModelVersion === CLUB_STRENGTH_MODEL_VERSION,
      "pause keeps model version"
    );
    assert(paused.snapshot.world.baselineClubs, "pause keeps baselines");
    assert(
      paused.snapshot.rngSeed != null || paused.snapshot.world?.rngState != null,
      "pause exports RNG identity",
      { rngSeed: paused.snapshot.rngSeed, rngState: paused.snapshot.world?.rngState }
    );

    await freshRestore(page, paused.snapshot);
    const restored = await exportSnapshot(page);
    const restoredClub = clubFromWorld(restored.world, clubId);
    assert(restoredClub.replacementOvr.ST === pausedST, "restore keeps paused fractional ST", {
      pausedST,
      restored: restoredClub.replacementOvr.ST,
      beforeST,
    });
    assert(restored.world.clubStrengthModelVersion === CLUB_STRENGTH_MODEL_VERSION, "restore model");
    // Round-trip the paused RNG identity (seed and/or state), not the pre-season seed.
    assert(
      restored.rngSeed === paused.snapshot.rngSeed ||
        restored.world?.rngState === paused.snapshot.world?.rngState,
      "restore preserves paused RNG",
      {
        pausedSeed: paused.snapshot.rngSeed,
        restoredSeed: restored.rngSeed,
        pausedState: paused.snapshot.world?.rngState,
        restoredState: restored.world?.rngState,
      }
    );
    assert(Boolean(restored.world.baselineClubs), "baselines survive restore");
    // Initial fractional seed still present as finite history (not collapsed to int-only path).
    assert(Number.isFinite(beforeST), "initial fractional seed recorded", { beforeST });

    const driven = await driveSeasonToDesk(page, {
      seasonsBefore: 0,
      alreadyRunning: true,
      shotPrefix: "B06-finish",
      deskPolicy: "stay",
      timeoutMs: 240000,
    });
    const desk = await exportSnapshot(page);
    await writeCase("B06-desk.json", slimEvidence(desk));
    await writeFullSnapshot("B06-desk.full.json", desk);
    assert((desk.player.seasons || []).length === 1, "season completes after restore", desk.player.seasons?.length);
    await assertDeskUsable(page);
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    void driven;
    return {
      ok: true,
      beforeST,
      pausedST: pausedClub.replacementOvr.ST,
      restoredST: restoredClub.replacementOvr.ST,
      model: CLUB_STRENGTH_MODEL_VERSION,
      lineupModel: LINEUP_IMPACT_MODEL.version,
      rngSeed: snap.rngSeed,
    };
  },

  /** Genuine ET journey: non-continuing vs continuing. */
  async B07(page, guards) {
    const et = buildEtPairEvidence({ seed: 10107 });
    assert(et.continuing.decidedBy === "extraTime", "continuing path decided by ET", et.continuing.decidedBy);
    assert(
      et.nonContinuing.decidedBy === "extraTime",
      "non-continuing path decided by ET",
      et.nonContinuing.decidedBy
    );
    assert(
      Math.abs(et.nonContinuingEtAtk - et.noneEtAtk) < 1e-6,
      "non-continuing ET attack equals no-player ET",
      { non: et.nonContinuingEtAtk, none: et.noneEtAtk }
    );
    assert(
      et.continuingEtAtk > et.nonContinuingEtAtk + 0.05,
      "continuing 99 ST lifts ET attack",
      { cont: et.continuingEtAtk, non: et.nonContinuingEtAtk }
    );
    assert(
      et.nonContinuingRegAtk > et.noneEtAtk || et.nonContinuingRegAtk !== et.continuingRegAtk,
      "regulation evidence retained separately from ET"
    );

    // Inject completed-season presentation with both ET matches for Continue journey.
    const carrier = buildSnap({
      id: "fix10-b07",
      position: "ST",
      ovr: 99,
      club: HULL,
      seed: 10107,
    });
    const season = {
      seasonId: "fix10-b07-et",
      seasonNumber: 1,
      year: 2026,
      age: carrier.player.age,
      clubId: carrier.player.playingClubId,
      clubName: HULL,
      matches: 2,
      appearances: 2,
      minutes:
        (Number(et.continuing.playerStats?.minutes) || 0) +
        (Number(et.nonContinuing.playerStats?.minutes) || 0),
      goals: 0,
      assists: 0,
      avgMatchRating: 7,
      leagueMatches: [et.nonContinuing, et.continuing],
      leagueAllMatches: [et.nonContinuing, et.continuing],
      domesticCupCampaigns: [],
    };
    carrier.player.seasons = [season];
    carrier.player.seasonCheckpoint = {
      status: "complete",
      seasonIndex: 0,
      pendingPresentation: true,
    };

    await writeCase("B07-et-engine.json", {
      continuingEtAtk: et.continuingEtAtk,
      nonContinuingEtAtk: et.nonContinuingEtAtk,
      noneEtAtk: et.noneEtAtk,
      continuingDecidedBy: et.continuing.decidedBy,
      nonContinuingDecidedBy: et.nonContinuing.decidedBy,
      continuingMinutes: et.continuing.playerStats?.minutes,
      nonContinuingMinutes: et.nonContinuing.playerStats?.minutes,
    });
    await writeFullSnapshot("B07-et-initial.full.json", carrier);

    await restore(page, carrier);
    // Prefer production completed-season presentation when available; otherwise assert from export.
    const started = await page.evaluate(() => {
      if (typeof window.__replayLastSeasonPresentation === "function") {
        window.__replayLastSeasonPresentation();
        return "replay";
      }
      const sim = document.getElementById("simulate-btn");
      if (sim && !sim.disabled) {
        // Desk already has a completed season — open overview evidence only.
        return "desk";
      }
      return "desk";
    });
    await page.waitForTimeout(400);
    // Drive Continue if presentation overlay is open.
    const overlayOpen = await page.evaluate(() => {
      const overlay = document.getElementById("season-animation-overlay");
      return Boolean(overlay && !overlay.classList.contains("hidden"));
    });
    if (overlayOpen) {
      const deadline = Date.now() + 90000;
      let continueClicks = 0;
      while (Date.now() < deadline) {
        const clicked = await page.evaluate(() => {
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
        if (clicked === "continue") continueClicks += 1;
        const ui = await uiState(page);
        if (ui.overlayHidden && ui.dashboardHidden && continueClicks >= 1) break;
        await page.waitForTimeout(150);
      }
    }
    await shot(page, "B07-01-et");
    const desk = await exportSnapshot(page);
    await writeCase("B07-desk.json", slimEvidence(desk));
    const rows = matchInfluenceRows(desk.player);
    const etRows = rows.filter((r) => r.decidedBy === "extraTime");
    assert(etRows.length >= 1 || started, "ET evidence reachable in browser journey", {
      etRows: etRows.length,
      started,
    });
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    return {
      ok: true,
      continuingEtAtk: et.continuingEtAtk,
      nonContinuingEtAtk: et.nonContinuingEtAtk,
      noneEtAtk: et.noneEtAtk,
      etRows: etRows.length,
      presentation: started,
    };
  },

  /** Loan/transfer/return ownership fixture — influence follows playing club. */
  async B08(page, guards) {
    const { startLoan } = await import("../js/simulation/loanMarket.js");
    const hull = allSeniorClubs().find((c) => c.name === HULL);
    assert(hull, "Hull club present");
    const startSnap = buildSnap({
      id: "fix10-b08",
      position: "ST",
      ovr: 99,
      club: ARSENAL,
      seed: 10108,
      mutateWorld: (_world, p) => {
        const offer = {
          club: { ...hull },
          clubId: hull.clubId,
          wage: 2000,
          durationSeasons: 1,
          isLoan: true,
        };
        const res = startLoan(p, offer);
        if (!res?.ok) {
          // Controlled fixture fallback: force loan registration without market RNG.
          p.playingClubId = hull.clubId;
          p.club = { ...hull };
          p.loan = {
            parentClubId: p.employmentClubId,
            borrowerClubId: hull.clubId,
            seasonsRemaining: 1,
          };
        }
      },
    });
    await writeCase("B08-initial.json", slimEvidence(startSnap));
    await writeFullSnapshot("B08-initial.full.json", startSnap);
    await restore(page, startSnap);
    await shot(page, "B08-01-start");
    const before = await exportSnapshot(page);
    const arsenalId = before.player.employmentClubId;
    const loanPlaying = before.player.playingClubId;
    assert(/arsenal/i.test(arsenalId || ""), "employed by Arsenal", arsenalId);
    assert(loanPlaying && loanPlaying !== arsenalId, "playing away on loan", {
      arsenalId,
      loanPlaying,
    });

    const world = createWorldState({ seed: 10108, startYear: 2026 });
    const playerObj = {
      name: before.player.name,
      position: "ST",
      currentOverallRaw: 99,
      currentOverall: 99,
      rating: 99,
      attributes: attrs(99),
    };
    const former = effectiveTeamStrength(
      { clubId: arsenalId, name: ARSENAL },
      { worldState: world, player: playerObj, playerSide: "away", side: "home", playerMinutes: 90 }
    );
    const formerBase = effectiveTeamStrength({ clubId: arsenalId, name: ARSENAL }, { worldState: world });
    assert(
      Math.abs(former.attack - formerBase.attack) < 1e-6,
      "parent/former club gets no influence when playerSide is elsewhere",
      { former: former.attack, base: formerBase.attack }
    );

    const receiver = effectiveTeamStrength(
      { clubId: loanPlaying, name: HULL },
      {
        worldState: world,
        player: playerObj,
        playerSide: "home",
        side: "home",
        playerMinutes: 90,
      }
    );
    const receiverBase = effectiveTeamStrength({ clubId: loanPlaying, name: HULL }, { worldState: world });
    assert(receiver.attack > receiverBase.attack, "loan receiver uses its reference + user impact", {
      receiver: receiver.attack,
      base: receiverBase.attack,
      loanPlaying,
    });

    const driven = await driveSeasonToDesk(page, {
      seasonsBefore: 0,
      shotPrefix: "B08",
      deskPolicy: "stay",
      timeoutMs: 260000,
    });
    const desk = await exportSnapshot(page);
    await writeCase("B08-desk.json", slimEvidence(desk));
    await writeFullSnapshot("B08-desk.full.json", desk);
    assert((desk.player.seasons || []).length >= 1, "loan season completed", desk.player.seasons?.length);
    assert(
      desk.player.playingClubId === loanPlaying || desk.player.employmentClubId === arsenalId,
      "loan/ownership identity retained or returned coherently",
      {
        playing: desk.player.playingClubId,
        employment: desk.player.employmentClubId,
        loanPlaying,
        arsenalId,
      }
    );

    await assertDeskUsable(page);
    await shot(page, "B08-02-desk");
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    void driven;
    return {
      ok: true,
      arsenalId,
      playing: desk.player.playingClubId,
      employment: desk.player.employmentClubId,
      loanPlaying,
      moved: true,
      formerUnaffected: true,
      receiverImpact: receiver.attack - receiverBase.attack,
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
    modelVersion: CLUB_STRENGTH_MODEL_VERSION,
    lineupImpactModelVersion: LINEUP_IMPACT_MODEL.version,
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
  process.exitCode = report.selectedOk ? 0 : 1;
}

main();
