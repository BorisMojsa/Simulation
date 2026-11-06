#!/usr/bin/env node
/**
 * Fix 12 real-browser acceptance (B01–B08).
 *
 *   npm install --no-save playwright-core
 *   node scripts/browserTournamentPresentationChecklist.mjs
 *   CASE=B02 node scripts/browserTournamentPresentationChecklist.mjs
 */
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUN = join(ROOT, "qa/fix12-runs/browser");
const SHOTS = join(RUN, "screenshots");
const CASES = join(RUN, "cases");
const OUT = join(RUN, "browser-report.json");
const CHROME =
  process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HEADED = process.env.HEADED === "1";
const IDS = Array.from({ length: 8 }, (_, i) => `B${String(i + 1).padStart(2, "0")}`);
const selectionText = process.env.CASES || process.env.CASE || "";
const SELECTED = selectionText
  ? selectionText.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean)
  : IDS;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

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

async function openBrowser(base) {
  assert(existsSync(CHROME), `CHROME_PATH missing: ${CHROME}`);
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: CHROME, headless: !HEADED });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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

async function restoreSnapshot(page, snapshot) {
  const result = await page.evaluate((s) => window.__restoreCareerSnapshot?.(s), snapshot);
  assert(result?.ok !== false, "__restoreCareerSnapshot failed", result);
  return result;
}

async function competitionsText(page) {
  return page.evaluate(() => {
    const board = document.getElementById("competitions-board");
    return {
      text: board?.innerText || "",
      html: board?.innerHTML || "",
    };
  });
}

async function clickCompTab(page, view) {
  await page.evaluate((v) => {
    const btn = document.querySelector(`.comp-tab[data-view="${v}"]`);
    btn?.click();
  }, view);
  await page.waitForTimeout(80);
}

async function selectCompetition(page, labelRe) {
  await page.evaluate((source) => {
    const sel = document.getElementById("comp-name-select");
    if (!sel) return false;
    const re = new RegExp(source, "i");
    const idx = [...sel.options].findIndex((o) => re.test(o.textContent || ""));
    if (idx < 0) return false;
    sel.selectedIndex = idx;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, labelRe.source || String(labelRe));
  await page.waitForTimeout(80);
}

async function shot(page, name) {
  await mkdir(SHOTS, { recursive: true });
  const path = join(SHOTS, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  return path.slice(ROOT.length + 1);
}

function loadFixtureSnapshot() {
  const path = join(ROOT, "qa/fix12-runs/final/fixtures/f01-career-snapshot.json");
  assert(existsSync(path), `Missing fixture snapshot ${path}. Run qaTournamentPresentation.mjs first.`);
  return JSON.parse(readFileSync(path, "utf8"));
}

async function ensureFixtureExport() {
  const path = join(ROOT, "qa/fix12-runs/final/fixtures/f01-career-snapshot.json");
  if (existsSync(path)) return;
  const r = spawnSync("node", ["scripts/qaTournamentPresentation.mjs", "--out", "qa/fix12-runs/final"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`qa exporter failed: ${r.stderr || r.stdout}`);
}

const handlers = {
  async B01(page, runtime) {
    // Controlled World Cup playback stage transition via in-page modules + reveal IDs
    const observed = await page.evaluate(async () => {
      const { buildNationalPlaybackContext } = await import("./js/simulation/competitionPlayback.js");
      const { projectTournamentRecords } = await import("./js/ui/tournamentPresentation.js");
      const snap = window.__exportCareerSnapshot?.();
      const t = snap?.player?.seasons?.[0]?.international?.primary;
      if (!t) return { ok: false, reason: "no-primary" };
      const groupIds = (t.groups || [])
        .flatMap((g) => g.matches || [])
        .filter(
          (m) =>
            (m.home?.name || m.homeParticipantId) === "Serbia" ||
            (m.away?.name || m.awayParticipantId) === "Serbia"
        )
        .map((m) => m.matchId);
      const koIds = (t.allRounds || [])
        .flatMap((r) => r.matches || [])
        .filter(
          (m) =>
            (m.home?.name || m.homeParticipantId) === "Serbia" ||
            (m.away?.name || m.awayParticipantId) === "Serbia"
        )
        .map((m) => m.matchId);
      const ctx0 = buildNationalPlaybackContext({
        tournament: t,
        player: snap.player,
        visibleFixtureIds: [],
      });
      const mid = projectTournamentRecords({
        campaign: t,
        scope: { participantKind: "nation", participantId: "Serbia" },
        visibleFixtureIds: groupIds.slice(0, 1),
        live: true,
      });
      const ctxKo = buildNationalPlaybackContext({
        tournament: t,
        player: snap.player,
        visibleFixtureIds: [...groupIds, koIds[0]],
      });
      const full = projectTournamentRecords({
        campaign: t,
        scope: { participantKind: "nation", participantId: "Serbia" },
        visibleFixtureIds: [...groupIds, ...koIds],
        live: true,
      });
      return {
        ok: true,
        initialMode: ctx0.stageMode,
        midPlayed: mid.tournament.record.played,
        koMode: ctxKo.stageMode,
        fullPlayed: full.tournament.record.played,
        groupIds,
        firstKo: koIds[0],
        scores: (t.playerMatches || []).map((m) => ({
          id: m.matchId,
          score: m.scoreline || `${m.homeGoals}-${m.awayGoals}`,
        })),
      };
    });
    assert(observed.ok, "B01 module observe failed", observed);
    assert(observed.initialMode === "table", "initial stageMode table", observed);
    assert(observed.midPlayed === 1, "mid-group revealed-only", observed);
    assert(observed.koMode === "bracket", "KO transition", observed);
    assert(observed.fullPlayed === 8, "full reveal P8", observed);
    return { label: "controlled", observed, errors: [...runtime] };
  },

  async B02(page, runtime) {
    await selectCompetition(page, /World Cup/);
    await clickCompTab(page, "overview");
    const overview = await competitionsText(page);
    assert(/Opening phase:\s*Group stage/i.test(overview.text), "Opening phase Group stage", overview.text.slice(0, 500));
    assert(/Group-stage record:\s*P3 · W2 · D1 · L0/i.test(overview.text), "group record", overview.text);
    assert(/Total tournament record:\s*P8 · W7 · D1 · L0/i.test(overview.text), "total record", overview.text);
    assert(/Winners/i.test(overview.text), "result winners", overview.text);
    assert(!/Opening phase:\s*Knockout/i.test(overview.text), "must not say Knockout opening", overview.text);
    assert(/not games won/i.test(overview.text), "round meta clarified", overview.text);
    await clickCompTab(page, "phase");
    const phase = await competitionsText(page);
    assert(/Group stage only/i.test(phase.text), "phase caption", phase.text);
    const shotPath = await shot(page, "B02-overview-history");
    return { label: "controlled", overview: overview.text, phase: phase.text, shotPath, errors: [...runtime] };
  },

  async B03(page, runtime) {
    // Switch competition select to continental if present
    await page.evaluate(() => {
      const sel = document.getElementById("comp-name-select");
      if (!sel) return;
      const idx = [...sel.options].findIndex((o) => /Champions|Europa|Conference|continental/i.test(o.textContent));
      if (idx >= 0) {
        sel.selectedIndex = idx;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await page.waitForTimeout(100);
    await clickCompTab(page, "overview");
    const overview = await competitionsText(page);
    assert(/League phase/i.test(overview.text) || /League-phase record/i.test(overview.text), "league phase label", overview.text);
    await clickCompTab(page, "phase");
    const phase = await competitionsText(page);
    assert(/League phase only/i.test(phase.text) || /P8/i.test(phase.text), "phase scope", phase.text);
    const shotPath = await shot(page, "B03-continental");
    return { label: "controlled", overview: overview.text, phase: phase.text, shotPath, errors: [...runtime] };
  },

  async B04(page, runtime) {
    const observed = await page.evaluate(async () => {
      const { tallyParticipantRecord } = await import("./js/ui/tournamentPresentation.js");
      const match = {
        matchId: "b04-pens",
        status: "played",
        home: { name: "Serbia" },
        away: { name: "Italy" },
        homeGoals: 1,
        awayGoals: 1,
        matchHomeGoals: 1,
        matchAwayGoals: 1,
        penaltyHome: 5,
        penaltyAway: 4,
        winnerSide: "home",
        decidedBy: "penalties",
      };
      const et = {
        matchId: "b04-et",
        status: "played",
        home: { name: "Serbia" },
        away: { name: "Spain" },
        homeGoals: 2,
        awayGoals: 1,
        matchHomeGoals: 2,
        matchAwayGoals: 1,
        regulationHomeGoals: 1,
        regulationAwayGoals: 1,
        decidedBy: "extraTime",
        winnerSide: "home",
      };
      return {
        pens: tallyParticipantRecord([match], ["Serbia"]).record,
        et: tallyParticipantRecord([et], ["Serbia"]).record,
      };
    });
    assert(observed.pens.draws === 1 && observed.pens.shootoutsWon === 1 && observed.pens.gf === 1, "pens", observed);
    assert(observed.et.wins === 1 && observed.et.gf === 2 && observed.et.ga === 1, "et", observed);
    return { label: "controlled", observed, errors: [...runtime] };
  },

  async B05(page, runtime) {
    const observed = await page.evaluate(async () => {
      const { projectTournamentRecords } = await import("./js/ui/tournamentPresentation.js");
      const snap = window.__exportCareerSnapshot?.();
      const euro = snap?.player?.seasons?.[0]?.europeanCampaign;
      const moved = structuredClone(snap.player);
      moved.club = { clubId: "other-club", name: "Other Club", displayName: "Other Club" };
      moved.playingClubId = "other-club";
      const proj = projectTournamentRecords({
        campaign: euro,
        scope: {
          participantKind: "club",
          participantId: euro.focusClubId,
        },
      });
      return {
        focusClubId: euro.focusClubId,
        participantId: proj.participantId,
        played: proj.tournament.record?.played,
        todayClub: moved.playingClubId,
      };
    });
    assert(observed.focusClubId && observed.participantId === observed.focusClubId, "historical focus", observed);
    assert(observed.todayClub !== observed.focusClubId, "player moved", observed);
    return { label: "controlled", observed, errors: [...runtime] };
  },

  async B06(page, runtime) {
    const observed = await page.evaluate(async () => {
      const { projectTournamentRecords } = await import("./js/ui/tournamentPresentation.js");
      const notSelected = {
        name: "FIFA World Cup",
        year: 2026,
        competitionId: "world-cup",
        editionId: "world-cup:2026",
        playerNation: "Serbia",
        calledUp: false,
        playerNationInTournament: true,
        result: "Not in squad",
        groups: [
          {
            name: "Group A",
            participants: ["Serbia"],
            matches: [
              {
                matchId: "ns1",
                status: "played",
                competitionId: "world-cup",
                editionId: "world-cup:2026",
                home: { name: "Serbia" },
                away: { name: "USA" },
                homeGoals: 1,
                awayGoals: 0,
                matchHomeGoals: 1,
                matchAwayGoals: 0,
                stageType: "group",
              },
            ],
            table: [],
          },
        ],
        allRounds: [],
      };
      const proj = projectTournamentRecords({
        campaign: notSelected,
        scope: { participantKind: "nation", participantId: "Serbia" },
      });
      const none = projectTournamentRecords({
        campaign: { showcase: true, qualified: false, competition: "UCL" },
        scope: { participantKind: "club", participantId: "x" },
      });
      return {
        result: proj.resultLabel,
        selection: proj.selectionLabel,
        played: proj.tournament.record?.played,
        none: none.tournament.completeness,
      };
    });
    assert(observed.result === "Not in squad", "not selected", observed);
    assert(/not selected/i.test(observed.selection || ""), "selection label", observed);
    assert(observed.none === "none", "showcase none", observed);
    // Switch seasons/competitions in UI
    await clickCompTab(page, "overview");
    const text = (await competitionsText(page)).text;
    return { label: "controlled", observed, competitionsText: text.slice(0, 400), errors: [...runtime] };
  },

  async B07(page, runtime) {
    const observed = await page.evaluate(async () => {
      const { projectTournamentRecords } = await import("./js/ui/tournamentPresentation.js");
      const { buildNationalPlaybackContext } = await import("./js/simulation/competitionPlayback.js");
      const snap = window.__exportCareerSnapshot?.();
      const t = snap?.player?.seasons?.[0]?.international?.primary;
      const allIds = [
        ...(t.groups || []).flatMap((g) => (g.matches || []).map((m) => m.matchId)),
        ...(t.allRounds || []).flatMap((r) => (r.matches || []).map((m) => m.matchId)),
      ].filter(Boolean);
      const full = projectTournamentRecords({
        campaign: t,
        scope: { participantKind: "nation", participantId: "Serbia" },
        visibleFixtureIds: allIds,
      });
      const ctx = buildNationalPlaybackContext({
        tournament: t,
        player: snap.player,
        visibleFixtureIds: allIds,
      });
      return {
        played: full.tournament.record.played,
        wins: full.tournament.record.wins,
        stageMode: ctx.stageMode,
      };
    });
    assert(observed.played === 8 && observed.wins === 7, "skip/full reveal totals", observed);
    assert(observed.stageMode === "bracket", "full reveal bracket", observed);
    // Continue-like: snapshot restore preserves seasons
    const again = await page.evaluate(() => {
      const snap = window.__exportCareerSnapshot?.();
      return window.__restoreCareerSnapshot?.(snap);
    });
    assert(again?.ok !== false, "restore continuation", again);
    await selectCompetition(page, /World Cup/);
    await clickCompTab(page, "overview");
    const text = (await competitionsText(page)).text;
    assert(/P8 · W7 · D1 · L0/.test(text), "records after restore", text.slice(0, 400));
    return { label: "controlled", observed, errors: [...runtime] };
  },

  async B08(page, runtime) {
    const widths = [1440, 768, 390];
    const layouts = [];
    for (const w of widths) {
      await page.setViewportSize({ width: w, height: 800 });
      await page.waitForTimeout(60);
      const metrics = await page.evaluate(() => {
        const board = document.getElementById("competitions-board");
        const summary = board?.querySelector(".tournament-record-summary");
        return {
          boardScrollWidth: board?.scrollWidth || 0,
          boardClientWidth: board?.clientWidth || 0,
          summaryText: summary?.innerText || board?.innerText?.slice(0, 200) || "",
          overflowX: board ? board.scrollWidth > board.clientWidth + 2 : false,
        };
      });
      const path = await shot(page, `B08-${w}`);
      layouts.push({ width: w, ...metrics, shot: path });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    // Keyboard: tab buttons reachable
    const tabOk = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll(".comp-tab")];
      return tabs.every((t) => t.tagName === "BUTTON" && t.getAttribute("type") === "button");
    });
    assert(tabOk, "comp tabs are buttons");
    assert(layouts.every((l) => /P3|P8|Group/i.test(l.summaryText)), "readable totals", layouts);
    return { label: "controlled", layouts, errors: [...runtime] };
  },
};

async function main() {
  await mkdir(RUN, { recursive: true });
  await mkdir(CASES, { recursive: true });
  await ensureFixtureExport();
  const snapshot = loadFixtureSnapshot();
  const sourceFp = createHash("sha256")
    .update(readFileSync(join(ROOT, "js/ui/tournamentPresentation.js")))
    .digest("hex");

  const server = await hostFixed();
  const { browser, page, runtime } = await openBrowser(server.base);
  const results = [];
  try {
    await restoreSnapshot(page, snapshot);
    await page.waitForTimeout(200);
    for (const id of SELECTED) {
      runtime.length = 0;
      const started = Date.now();
      let entry = { id, status: "FAIL", durationMs: 0 };
      try {
        const detail = await handlers[id](page, runtime);
        entry = {
          id,
          status: "PASS",
          durationMs: Date.now() - started,
          label: detail.label,
          errors: detail.errors || [],
          detail: {
            ...detail,
            errors: undefined,
          },
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
    sourceFingerprint: sourceFp,
    selected: SELECTED,
    results,
    pass: results.filter((r) => r.status === "PASS").length,
    fail: results.filter((r) => r.status === "FAIL").length,
    notRun: IDS.filter((id) => !SELECTED.includes(id)).map((id) => ({ id, status: "NOT RUN" })),
  };
  await json(OUT, report);
  console.log(`Browser report ${OUT}: ${report.pass} pass / ${report.fail} fail`);
  if (report.fail) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
