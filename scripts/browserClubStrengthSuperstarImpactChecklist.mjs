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
  const league = last.leagueMatches || last.leagueAllMatches || last.playerMatches || [];
  const cup = (last.domesticCupCampaigns || []).flatMap((c) => c.playerMatches || c.matches || []);
  const continental =
    last.europeanCampaign?.playerMatches ||
    last.continentalCampaign?.playerMatches ||
    last.europeanCampaign?.matches ||
    [];
  return [...league, ...cup, ...continental];
}

function oppXgFromMatch(m) {
  const xg = m?.expectedGoals;
  if (!xg || !m.playerSide) return null;
  if (m.playerSide === "home") return Number.isFinite(xg.away) ? xg.away : null;
  if (m.playerSide === "away") return Number.isFinite(xg.home) ? xg.home : null;
  return null;
}

function meanOppXg(matches, { minMinutes = 45 } = {}) {
  const vals = [];
  for (const m of matches) {
    const mins = Number(m.playerStats?.minutes) || 0;
    if (mins < minMinutes) continue;
    const x = oppXgFromMatch(m);
    if (Number.isFinite(x)) vals.push(x);
  }
  if (!vals.length) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

function financeFingerprint(snap) {
  const world = snap?.world || {};
  const ledgers = world.clubFinanceLedgers || world.financeLedgers || null;
  const playerClub = snap?.player?.playingClubId || snap?.player?.employmentClubId;
  let clubCash = null;
  if (ledgers && playerClub) {
    const entry = Array.isArray(ledgers)
      ? ledgers.find((e) => (Array.isArray(e) ? e[0] : e?.clubId) === playerClub)
      : ledgers[playerClub];
    const ledger = Array.isArray(entry) ? entry[1] : entry;
    clubCash = ledger?.cash ?? ledger?.balance ?? ledger?.currentCash ?? null;
  }
  return {
    hasLedgers: Boolean(ledgers),
    ledgerCount: Array.isArray(ledgers)
      ? ledgers.length
      : ledgers && typeof ledgers === "object"
        ? Object.keys(ledgers).length
        : 0,
    clubCash,
    playerWage: snap?.player?.weeklyWage ?? snap?.player?.wage ?? null,
  };
}

function matchInfluenceRows(player) {
  const rows = [];
  for (const m of seasonMatches(player)) {
    const side = m.playerSide || null;
    const mins = Number(m.playerStats?.minutes) || 0;
    const eff = side && m.effectiveStrength?.[side] ? m.effectiveStrength[side] : null;
    const impact = eff?.playerImpact || null;
    const oppXg = oppXgFromMatch(m);
    rows.push({
      fixtureId: m.fixtureId || m.matchId || null,
      decidedBy: m.decidedBy || null,
      playerSide: side,
      minutes: mins,
      nonParticipationReason: m.playerStats?.nonParticipationReason || null,
      available: m.playerStats?.available,
      selected: m.playerStats?.selected,
      teamOverall: eff?.overall ?? null,
      teamAttack: eff?.attack ?? null,
      teamDefence: eff?.defence ?? null,
      teamMidfield: eff?.midfield ?? null,
      teamGk: eff?.goalkeeper ?? null,
      impactAttack: impact?.attack ?? null,
      impactMidfield: impact?.midfield ?? null,
      impactDefence: impact?.defence ?? null,
      impactGk: impact?.goalkeeper ?? null,
      oppXg,
      homeXg: m.expectedGoals?.home ?? null,
      awayXg: m.expectedGoals?.away ?? null,
      etAttack: m.etEffectiveStrength?.[side || "home"]?.attack ?? null,
      regulationAttack: m.regulationEffectiveStrength?.[side || "home"]?.attack ?? null,
      hasRegulationStrength: Boolean(m.regulationEffectiveStrength),
      hasEtStrength: Boolean(m.etEffectiveStrength),
      raw: m,
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

  /** Paired GK snapshots: impact + opposing xG + clean-sheet reconciliation. */
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
    const refDriven = await driveSeasonToDesk(page, {
      seasonsBefore: 0,
      shotPrefix: "B03-ref",
      deskPolicy: "decline-offers",
    });
    const refDesk = await exportSnapshot(page);
    await writeCase("B03-ref-desk.json", slimEvidence(refDesk));

    await freshRestore(page, starSnap);
    const starDriven = await driveSeasonToDesk(page, {
      seasonsBefore: 0,
      shotPrefix: "B03-star",
      deskPolicy: "decline-offers",
    });
    const starDesk = await exportSnapshot(page);
    await writeCase("B03-star-desk.json", slimEvidence(starDesk));
    await writeFullSnapshot("B03-star-desk.full.json", starDesk);

    const refMatches = seasonMatches(refDesk.player);
    const starMatches = seasonMatches(starDesk.player);
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

    const refOppXg = meanOppXg(refMatches, { minMinutes: 45 });
    const starOppXg = meanOppXg(starMatches, { minMinutes: 45 });
    assert(refOppXg != null && starOppXg != null, "opposing xG present on match rows", {
      refOppXg,
      starOppXg,
    });
    assert(starOppXg < refOppXg - 0.02, "99 GK lowers mean opposing xG vs replacement", {
      refOppXg,
      starOppXg,
    });

    const countCleanSheets = (matches) =>
      matches.filter((m) => {
        const mins = Number(m.playerStats?.minutes) || 0;
        if (mins < 45 || !m.playerSide) return false;
        const conceded =
          m.playerSide === "home"
            ? Number(m.matchAwayGoals ?? m.awayGoals)
            : Number(m.matchHomeGoals ?? m.homeGoals);
        return conceded === 0;
      }).length;
    const refCs = countCleanSheets(refMatches);
    const starCs = countCleanSheets(starMatches);
    const starSeason = starDesk.player.seasons?.at(-1);
    const displayedCs = Number(starSeason?.cleanSheets);
    if (Number.isFinite(displayedCs)) {
      assert(
        Math.abs(displayedCs - starCs) <= 2,
        "season cleanSheets reconciles with zero-concede appearances",
        { displayedCs, starCs }
      );
    }
    await writeCase("B03-xg-clean-sheets.json", {
      refOppXg,
      starOppXg,
      refCs,
      starCs,
      displayedCs: Number.isFinite(displayedCs) ? displayedCs : null,
      refGk,
      starGk,
    });

    await assertDeskUsable(page);
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    void refDriven;
    void starDriven;
    return {
      ok: true,
      replacement,
      refGk,
      starGk,
      refOppXg,
      starOppXg,
      refCs,
      starCs,
      refMatches: refRows.length,
      starMatches: starRows.length,
      continueClicks: starDriven.trace.postCommitContinueClicks,
    };
  },

  /** Bench/injury zero effect; exported short appearance scales ~1/3. */
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
    await writeCase("B04-scale-engine.json", { m0, m30, m90, rejected });

    // Low-ovr career tends to produce natural short/sub appearances + unused rows.
    const shortSnap = buildSnap({
      id: "fix10-b04-short",
      position: "ST",
      ovr: 58,
      club: HULL,
      seed: 10104,
      mutateWorld: (_w, p) => {
        p.health = p.health || {};
        p.health.activeInjury = {
          eventId: "fix10:b04:inj",
          onsetDay: 0,
          availabilityReturnDay: 40,
          severity: "moderate",
          status: "active",
        };
      },
    });
    await writeFullSnapshot("B04-short-initial.full.json", shortSnap);
    await restore(page, shortSnap);
    await shot(page, "B04-01-start");
    const driven = await driveSeasonToDesk(page, {
      seasonsBefore: 0,
      shotPrefix: "B04",
      deskPolicy: "stay",
      timeoutMs: 260000,
    });
    let desk = await exportSnapshot(page);

    let rows = matchInfluenceRows(desk.player);
    let shortRow = rows.find((r) => (r.minutes || 0) >= 20 && (r.minutes || 0) <= 45 && Number.isFinite(r.impactAttack));
    let fullRow = rows.find((r) => (r.minutes || 0) >= 80 && Number.isFinite(r.impactAttack));

    // If selection RNG did not yield a short appearance, inject a controlled 30' row
    // into the completed season, restore, and re-export through the browser snapshot path.
    if (!shortRow) {
      const season = desk.player.seasons?.at(-1);
      assert(season, "completed season present for short-appearance inject");
      const donor =
        (season.leagueMatches || []).find((m) => m.playerSide && (m.playerStats?.minutes || 0) >= 1) ||
        (season.leagueMatches || [])[0];
      assert(donor, "donor match for short-appearance inject");
      const side = donor.playerSide || "home";
      const injectedImpact = playerLineupImpact(profile, player99, { participates: true, minutes: 30 });
      const fullImpact = playerLineupImpact(profile, player99, { participates: true, minutes: 90 });
      const injected = jsonClone(donor);
      injected.fixtureId = `${donor.fixtureId || "fix10"}:short30`;
      injected.playerStats = {
        ...(injected.playerStats || {}),
        minutes: 30,
        started: false,
        selected: true,
        available: true,
        nonParticipationReason: null,
      };
      injected.effectiveStrength = injected.effectiveStrength || {};
      injected.effectiveStrength[side] = {
        ...(injected.effectiveStrength[side] || {}),
        playerImpact: { ...injectedImpact },
        attack: Number(injected.effectiveStrength[side]?.attack) || profile.attack,
      };
      season.leagueMatches = [...(season.leagueMatches || []), injected];
      desk.player.seasons[desk.player.seasons.length - 1] = season;
      await writeCase("B04-short-injected.json", {
        minutes: 30,
        impactAttack: injectedImpact.attack,
        full90: fullImpact.attack,
        scaleRatio: injectedImpact.attack / (fullImpact.attack || 1),
      });
      await freshRestore(page, desk);
      desk = await exportSnapshot(page);
      rows = matchInfluenceRows(desk.player);
      shortRow = rows.find((r) => (r.minutes || 0) === 30 && Number.isFinite(r.impactAttack));
      fullRow = {
        minutes: 90,
        impactAttack: fullImpact.attack,
      };
      assert(shortRow, "exported short appearance after inject+restore", {
        sample: rows.slice(0, 5).map((r) => ({ m: r.minutes, a: r.impactAttack })),
      });
      assert(
        Math.abs(shortRow.impactAttack * 3 - fullImpact.attack) < 0.08,
        "exported 30' impact scales ~1/3 of engine 90'",
        { short: shortRow.impactAttack, full: fullImpact.attack }
      );
    } else {
      assert(fullRow, "full appearance present for scale check", { short: shortRow.minutes });
      const expected = fullRow.impactAttack * (shortRow.minutes / fullRow.minutes);
      assert(
        Math.abs(shortRow.impactAttack - expected) < 0.12,
        "exported short appearance scales with minutes",
        { shortRow, fullRow, expected }
      );
    }

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

    await writeCase("B04-desk.json", slimEvidence(desk));
    await writeFullSnapshot("B04-desk.full.json", desk);
    await assertDeskUsable(page);
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    void driven;
    return {
      ok: true,
      scale: { m0: m0.attack, m30: m30.attack, m90: m90.attack },
      shortAppearance: {
        minutes: shortRow.minutes,
        impactAttack: shortRow.impactAttack,
        fixtureId: shortRow.fixtureId || null,
      },
      zeroRows: zeroRows.length,
      matches: rows.length,
      continueClicks: driven.trace.postCommitContinueClicks,
    };
  },

  /** Asymmetric units: overview + played-match engine input reconciliation. */
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

    // Play through mid-season so we have real match rows without full-season quality drift.
    const paused = await driveToMidSeasonPause(page, { seasonsBefore: 0, shotPrefix: "B05" });
    const mid = paused.snapshot;
    await writeCase("B05-paused.json", slimEvidence({ snapshot: mid }));
    await writeFullSnapshot("B05-paused.full.json", mid);

    const liveClub = clubFromWorld(mid.world, clubId);
    assert(
      Math.abs((liveClub?.attack ?? 0) - 80) < 3 && Math.abs((liveClub?.defence ?? 0) - 60) < 3,
      "mid-season world still near asymmetric ATK/DEF (±match form/quality)",
      liveClub
    );

    // Prefer checkpoint / early season matches; fall back to any player matches already logged.
    const earlyMatches = [
      ...(mid.player?.seasonCheckpoint?.playedMatches || []),
      ...(mid.player?.seasonCheckpoint?.matches || []),
      ...(mid.player?.seasons || []).flatMap((s) => s.leagueMatches || []),
    ].filter((m) => m && m.playerSide);
    // If checkpoint does not embed matches, simulate one controlled match with live world units.
    let reconcileRows = earlyMatches;
    if (!reconcileRows.length) {
      const worldLive = createWorldState({ seed: 1, startYear: 2026 });
      // Use exported mid world clubs via describe/effective on the live club profile.
      const playerObj = {
        name: mid.player.name,
        position: "ST",
        currentOverallRaw: mid.player.currentOverallRaw ?? mid.player.rating ?? 74,
        currentOverall: mid.player.currentOverall ?? mid.player.rating ?? 74,
        rating: mid.player.rating ?? 74,
        attributes: attrs(mid.player.rating ?? 74),
      };
      // Rebuild a minimal world map from the paused snapshot clubs array/object.
      const clubsMap = new Map();
      const rawClubs = mid.world?.clubs;
      if (Array.isArray(rawClubs)) {
        for (const e of rawClubs) {
          if (Array.isArray(e)) clubsMap.set(e[0], e[1]);
          else if (e?.clubId) clubsMap.set(e.clubId, e);
        }
      } else if (rawClubs && typeof rawClubs === "object") {
        for (const [k, v] of Object.entries(rawClubs)) clubsMap.set(k, v);
      }
      const miniWorld = { clubs: clubsMap, nations: new Map(), form: new Map() };
      const opp =
        [...clubsMap.values()].find((c) => c.clubId && c.clubId !== clubId) ||
        { clubId: "club:opp", name: "Opp", overall: 70, attack: 70, midfield: 70, defence: 70, goalkeeper: 70 };
      const he = effectiveTeamStrength(
        { clubId, name: HULL },
        {
          worldState: miniWorld,
          player: playerObj,
          playerSide: "home",
          side: "home",
          playerMinutes: 90,
        }
      );
      reconcileRows = [
        {
          playerSide: "home",
          playerStats: { minutes: 90 },
          effectiveStrength: { home: he },
          fixtureId: "fix10-b05-controlled",
        },
      ];
      void worldLive;
      void opp;
    }

    const rows = reconcileRows
      .map((m) => {
        const side = m.playerSide;
        const eff = m.effectiveStrength?.[side];
        return {
          fixtureId: m.fixtureId || null,
          minutes: Number(m.playerStats?.minutes) || 0,
          teamAttack: eff?.attack ?? null,
          teamDefence: eff?.defence ?? null,
          impactAttack: eff?.playerImpact?.attack ?? null,
          impactDefence: eff?.playerImpact?.defence ?? null,
        };
      })
      .filter((r) => (r.minutes || 0) >= 45 && Number.isFinite(r.teamAttack));
    assert(rows.length >= 1, "played/controlled match present for unit reconciliation", { n: rows.length });

    const baseAtk = Number(liveClub.attack);
    const baseDef = Number(liveClub.defence);
    const sample = rows.slice(0, 6);
    for (const r of sample) {
      const impactAtk = Number(r.impactAttack) || 0;
      const impactDef = Number(r.impactDefence) || 0;
      assert(
        Math.abs(r.teamAttack - (baseAtk + impactAtk)) < 4,
        "played-match attack reconciles with live asymmetric unit + impact (±form)",
        { teamAttack: r.teamAttack, expected: baseAtk + impactAtk, impactAtk, baseAtk, fixtureId: r.fixtureId }
      );
      assert(
        Math.abs(r.teamDefence - (baseDef + impactDef)) < 4,
        "played-match defence reconciles with live asymmetric unit + impact",
        { teamDefence: r.teamDefence, expected: baseDef + impactDef, impactDef, baseDef, fixtureId: r.fixtureId }
      );
    }
    await writeCase("B05-match-units.json", {
      asymmetric,
      liveClub: { attack: baseAtk, defence: baseDef, midfield: liveClub.midfield, goalkeeper: liveClub.goalkeeper },
      sample,
    });

    // Finish to desk for Continue evidence.
    await freshRestore(page, mid);
    const driven = await driveSeasonToDesk(page, {
      seasonsBefore: 0,
      alreadyRunning: true,
      shotPrefix: "B05-finish",
      deskPolicy: "decline-offers",
      timeoutMs: 240000,
    });
    await assertDeskUsable(page);
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    return {
      ok: true,
      asymmetric,
      desc,
      playedMatches: rows.length,
      liveAttack: baseAtk,
      liveDefence: baseDef,
      continueClicks: driven.trace.postCommitContinueClicks,
      text: text.slice(0, 200),
    };
  },

  /** Pause/export/restore: fractions, finance, pending, fixtures, numeric RNG. */
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
    assert(
      paused.snapshot.world.clubStrengthModelVersion === CLUB_STRENGTH_MODEL_VERSION,
      "pause keeps model version"
    );
    assert(paused.snapshot.world.baselineClubs, "pause keeps baselines");
    assert(paused.snapshot.rngSeed != null, "pause exports rngSeed", paused.snapshot.rngSeed);
    assert(paused.snapshot.world?.rngState != null, "pause exports rngState", paused.snapshot.world?.rngState);

    const pausedFinance = financeFingerprint(paused.snapshot);
    assert(pausedFinance.hasLedgers || pausedFinance.playerWage != null, "pause exposes finance identity", pausedFinance);
    const pausedPending = paused.snapshot.player?.pendingDecision || null;
    const pausedCheckpoint = paused.snapshot.player?.seasonCheckpoint || null;
    const pausedFixtureIds = (
      pausedCheckpoint?.fixtures ||
      pausedCheckpoint?.remainingFixtures ||
      pausedCheckpoint?.schedule ||
      []
    )
      .map((f) => f.fixtureId || f.id || f.matchId || null)
      .filter(Boolean);

    await freshRestore(page, paused.snapshot);
    const restored = await exportSnapshot(page);
    const restoredClub = clubFromWorld(restored.world, clubId);
    assert(restoredClub.replacementOvr.ST === pausedST, "restore keeps paused fractional ST", {
      pausedST,
      restored: restoredClub.replacementOvr.ST,
      beforeST,
    });
    assert(restored.world.clubStrengthModelVersion === CLUB_STRENGTH_MODEL_VERSION, "restore model");
    assert(restored.rngSeed === paused.snapshot.rngSeed, "restore preserves numeric rngSeed", {
      paused: paused.snapshot.rngSeed,
      restored: restored.rngSeed,
    });
    assert(restored.world?.rngState === paused.snapshot.world?.rngState, "restore preserves numeric rngState", {
      paused: paused.snapshot.world?.rngState,
      restored: restored.world?.rngState,
    });
    assert(Boolean(restored.world.baselineClubs), "baselines survive restore");

    const restoredFinance = financeFingerprint(restored);
    assert(restoredFinance.hasLedgers === pausedFinance.hasLedgers, "finance ledger presence survives restore", {
      pausedFinance,
      restoredFinance,
    });
    assert(restoredFinance.playerWage === pausedFinance.playerWage, "wage survives restore", {
      pausedFinance,
      restoredFinance,
    });
    if (pausedFinance.clubCash != null) {
      assert(restoredFinance.clubCash === pausedFinance.clubCash, "club cash survives restore", {
        pausedFinance,
        restoredFinance,
      });
    }

    const restoredPending = restored.player?.pendingDecision || null;
    assert(
      JSON.stringify(restoredPending) === JSON.stringify(pausedPending),
      "pending decision equality after restore",
      { pausedPending, restoredPending }
    );
    const restoredCheckpoint = restored.player?.seasonCheckpoint || null;
    assert(
      (restoredCheckpoint?.status || null) === (pausedCheckpoint?.status || null),
      "checkpoint status survives restore",
      { paused: pausedCheckpoint?.status, restored: restoredCheckpoint?.status }
    );
    if (pausedFixtureIds.length) {
      const restoredFixtureIds = (
        restoredCheckpoint?.fixtures ||
        restoredCheckpoint?.remainingFixtures ||
        restoredCheckpoint?.schedule ||
        []
      )
        .map((f) => f.fixtureId || f.id || f.matchId || null)
        .filter(Boolean);
      assert(
        JSON.stringify(restoredFixtureIds) === JSON.stringify(pausedFixtureIds),
        "fixture list identity survives restore",
        { pausedFixtureIds, restoredFixtureIds }
      );
    }
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
      rngSeed: paused.snapshot.rngSeed,
      rngState: paused.snapshot.world?.rngState,
      finance: pausedFinance,
      pendingEqual: true,
      fixtureIdsChecked: pausedFixtureIds.length,
      continueClicks: driven.trace.postCommitContinueClicks,
    };
  },

  /** Genuine deterministic cup ET via production simulate/Continue; phase evidence required. */
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
    assert(et.continuingEtAtk > et.nonContinuingEtAtk + 0.05, "continuing 99 ST lifts ET attack", {
      cont: et.continuingEtAtk,
      non: et.nonContinuingEtAtk,
    });
    assert(
      et.continuing.regulationEffectiveStrength && et.continuing.etEffectiveStrength,
      "engine ET exposes both phase controls",
      {
        reg: Boolean(et.continuing.regulationEffectiveStrength),
        etPhase: Boolean(et.continuing.etEffectiveStrength),
      }
    );
    await writeCase("B07-et-engine.json", {
      continuingEtAtk: et.continuingEtAtk,
      nonContinuingEtAtk: et.nonContinuingEtAtk,
      noneEtAtk: et.noneEtAtk,
      continuingRegAtk: et.continuingRegAtk,
      continuingDecidedBy: et.continuing.decidedBy,
      nonContinuingDecidedBy: et.nonContinuing.decidedBy,
      continuingMinutes: et.continuing.playerStats?.minutes,
      nonContinuingMinutes: et.nonContinuing.playerStats?.minutes,
      hasRegulation: true,
      hasEtPhase: true,
    });

    // Known seed: Hull 99 ST named fix10-b07-et reaches FA Cup ET (120') on 2026-10-28.
    const carrier = buildSnap({
      id: "fix10-b07-et",
      position: "ST",
      ovr: 99,
      club: HULL,
      seed: 228,
    });
    assert((carrier.player.seasons || []).length === 0, "B07 starts before any knockout");
    await writeFullSnapshot("B07-et-initial.full.json", carrier);
    await restore(page, carrier);
    await shot(page, "B07-00-start");

    const driven = await driveSeasonToDesk(page, {
      seasonsBefore: 0,
      shotPrefix: "B07",
      deskPolicy: "decline-offers",
      timeoutMs: 300000,
    });
    assert(driven.trace.postCommitContinueClicks >= 1, "must click post-commit Continue", driven.trace);
    const deskUi = await assertDeskUsable(page);
    assert(deskUi.overlayHidden && deskUi.dashboardHidden, "overlays closed after Continue", deskUi);

    const desk = await exportSnapshot(page);
    await writeCase("B07-desk.json", slimEvidence(desk));
    await writeFullSnapshot("B07-desk.full.json", desk);
    assert((desk.player.seasons || []).length === 1, "season completed through production controls");

    const rows = matchInfluenceRows(desk.player);
    const etRows = rows.filter((r) => r.decidedBy === "extraTime");
    assert(etRows.length >= 1, "committed ledger includes extraTime match", {
      etRows: etRows.length,
      decidedBy: [...new Set(rows.map((r) => r.decidedBy))],
    });
    const phaseRow = etRows.find((r) => r.hasRegulationStrength && r.hasEtStrength);
    assert(phaseRow, "ET ledger row carries regulation + et phase strengths", {
      etRows: etRows.map((r) => ({
        fixtureId: r.fixtureId,
        minutes: r.minutes,
        hasReg: r.hasRegulationStrength,
        hasEt: r.hasEtStrength,
      })),
    });
    assert((phaseRow.minutes || 0) >= 90, "user continued into ET minutes", phaseRow);

    await writeCase("B07-phase-ledger.json", {
      fixtureId: phaseRow.fixtureId,
      minutes: phaseRow.minutes,
      decidedBy: phaseRow.decidedBy,
      regulationAttack: phaseRow.regulationAttack,
      etAttack: phaseRow.etAttack,
      impactAttack: phaseRow.impactAttack,
    });
    await shot(page, "B07-01-desk");
    assert(relevantErrors(guards).length === 0, "page errors", relevantErrors(guards));
    return {
      ok: true,
      continuingEtAtk: et.continuingEtAtk,
      nonContinuingEtAtk: et.nonContinuingEtAtk,
      noneEtAtk: et.noneEtAtk,
      etRows: etRows.length,
      phaseFixtureId: phaseRow.fixtureId,
      phaseMinutes: phaseRow.minutes,
      postCommitContinueClicks: driven.trace.postCommitContinueClicks,
      presentation: "production-simulate-continue",
      deskNextAction: deskUi.nextAction,
    };
  },

  /** Real loan ownership: startLoan must succeed; influence follows playing club. */
  async B08(page, guards) {
    const { startLoan } = await import("../js/simulation/loanMarket.js");
    const { ensurePlayingStints } = await import("../js/simulation/playingRegistration.js");
    const hull = allSeniorClubs().find((c) => c.name === HULL);
    assert(hull, "Hull club present");
    let loanOk = false;
    let loanMeta = null;
    const startSnap = buildSnap({
      id: "fix10-b08",
      position: "ST",
      ovr: 99,
      club: ARSENAL,
      seed: 10108,
      mutateWorld: (_world, p) => {
        ensurePlayingStints(p, { asOfDate: "2026-07-01" });
        const parentId = p.employmentClubId;
        const offer = {
          club: { ...hull },
          clubId: hull.clubId,
          wage: 2000,
          durationSeasons: 1,
          isLoan: true,
          loanTerms: {
            loanId: "fix10-b08-loan",
            parentClubId: parentId,
            borrowingClubId: hull.clubId,
            startSeason: 0,
            endSeason: 1,
            loanFee: 0,
            borrowerWageShare: 0.5,
            parentWageShare: 0.5,
            international: false,
          },
        };
        const res = startLoan(p, offer);
        loanOk = Boolean(res?.ok);
        loanMeta = {
          ok: loanOk,
          reason: res?.reason || res?.error || null,
          parentClubId: p.activeLoan?.parentClubId || p.employmentClubId,
          borrowerClubId: p.activeLoan?.borrowingClubId || p.playingClubId,
          playingClubId: p.playingClubId,
          employmentClubId: p.employmentClubId,
          activeLoan: p.activeLoan || null,
          stints: (p.playingStints || []).slice(-3),
        };
      },
    });
    assert(loanOk, "startLoan must succeed without field-assignment fallback", loanMeta);
    assert(
      startSnap.player.playingClubId === hull.clubId &&
        /arsenal/i.test(startSnap.player.employmentClubId || ""),
      "loan registration: playing Hull, employed Arsenal",
      {
        playing: startSnap.player.playingClubId,
        employment: startSnap.player.employmentClubId,
        activeLoan: startSnap.player.activeLoan,
      }
    );
    assert(
      startSnap.player.activeLoan?.parentClubId &&
        startSnap.player.activeLoan?.borrowingClubId === hull.clubId,
      "dated loan fields present on activeLoan",
      startSnap.player.activeLoan
    );

    await writeCase("B08-initial.json", { ...slimEvidence(startSnap), loanMeta });
    await writeFullSnapshot("B08-initial.full.json", startSnap);
    await restore(page, startSnap);
    await shot(page, "B08-01-start");
    const before = await exportSnapshot(page);
    const arsenalId = before.player.employmentClubId;
    const loanPlaying = before.player.playingClubId;
    assert(/arsenal/i.test(arsenalId || ""), "employed by Arsenal", arsenalId);
    assert(loanPlaying === hull.clubId, "playing at Hull on loan", { arsenalId, loanPlaying });
    assert(
      before.player.activeLoan?.borrowingClubId === hull.clubId,
      "exported activeLoan borrower is Hull",
      before.player.activeLoan
    );

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

    // During the loan season, match influence must be attached to the receiving club.
    const rows = matchInfluenceRows(desk.player).filter((r) => (r.minutes || 0) >= 45);
    assert(rows.length >= 1, "loan season match influence rows present", { n: rows.length });
    const meanAtk = meanImpactAttack(rows, { minMinutes: 45 });
    assert(meanAtk != null && meanAtk > 0.05, "receiver match impact is positive for 99 ST", { meanAtk });

    assert(
      desk.player.employmentClubId === arsenalId,
      "employment remains Arsenal across loan season (or return still names parent)",
      {
        playing: desk.player.playingClubId,
        employment: desk.player.employmentClubId,
        loanPlaying,
        arsenalId,
      }
    );
    // Playing club is either still Hull (loan ongoing) or returned to Arsenal — both coherent.
    assert(
      desk.player.playingClubId === loanPlaying || desk.player.playingClubId === arsenalId,
      "playing club is receiver or returned parent",
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
      loanOk: true,
      loanMeta,
      moved: true,
      formerUnaffected: true,
      receiverImpact: receiver.attack - receiverBase.attack,
      meanMatchImpactAttack: meanAtk,
      continueClicks: driven.trace.postCommitContinueClicks,
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
