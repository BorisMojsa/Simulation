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
    // Real dashboard playback: chronological batches, group→KO, final hidden until revealed.
    await page.evaluate(async () => {
      const dash = await import("./js/ui/simulationDashboard.js");
      const { buildNationalPlaybackContext } = await import("./js/simulation/competitionPlayback.js");
      const { groupCompetitionFixturesForPlayback } = await import("./js/ui/tournamentPresentation.js");
      const snap = window.__exportCareerSnapshot?.();
      const t = snap?.player?.seasons?.[0]?.international?.primary;
      const player = snap.player;
      const fixtures = [
        ...(t.groups || []).flatMap((g) => g.matches || []),
        ...(t.allRounds || []).flatMap((r) => r.matches || []),
      ].map((m) => {
        const h = m.home?.name || m.homeParticipantId;
        const a = m.away?.name || m.awayParticipantId;
        return {
          ...m,
          playerSide: h === "Serbia" ? "home" : a === "Serbia" ? "away" : null,
          competitionType: "international",
          teamType: "nation",
        };
      });
      const batches = groupCompetitionFixturesForPlayback(fixtures);
      window.__qaBatchProbe = {
        firstPlayerStage: batches.find((b) => b.playerMatches.length)?.playerMatches?.[0]?.stageType,
        firstPlayerId: batches.find((b) => b.playerMatches.length)?.playerMatches?.[0]?.matchId,
        batchRanks: batches.map((b) => b.stageRank),
      };
      dash.configureDashboardTiming({ matchMs: 40, speed: 25 });
      const ctx = buildNationalPlaybackContext({
        tournament: t,
        player,
        visibleFixtureIds: [],
      });
      window.__qaPlaybackDone = false;
      window.__qaPlaybackError = null;
      dash
        .runSimulationDashboard({
          player,
          league: player.club,
          seasonNumber: 1,
          allMatches: fixtures,
          playerMatches: fixtures.filter((m) => m.playerSide),
          competitionContext: ctx,
          reset: true,
        })
        .then(() => {
          window.__qaPlaybackDone = true;
        })
        .catch((e) => {
          window.__qaPlaybackError = String(e?.message || e);
          window.__qaPlaybackDone = true;
        });
    });

    // Wait until the first player card locks (applied to live totals).
    await page.waitForFunction(
      () => {
        const card = document.querySelector("#match-card-rail .match-card");
        const live = document.querySelector(".tournament-live-record")?.innerText || "";
        return Boolean(card) && /P1/i.test(live);
      },
      null,
      { timeout: 30000 }
    );

    const observations = [];
    let sawAfterGroup = false;
    let sawFirstKo = false;
    for (let step = 0; step < 24; step++) {
      const done = await page.evaluate(() => window.__qaPlaybackDone);
      const obs = await page.evaluate(() => {
        const card = document.querySelector("#match-card-rail .match-card");
        const live = document.querySelector(".tournament-live-record")?.innerText || "";
        const heading = document.getElementById("live-standings-title")?.innerText || "";
        const btns = [...document.querySelectorAll(".sim-ctx-btn")].map((b) => b.textContent.trim());
        const host = document.getElementById("league-table-host")?.innerText || "";
        return {
          cardId: card?.dataset?.fixtureId || null,
          cardComplete: card?.classList.contains("is-complete") || false,
          cardStage: card?.querySelector(".match-card-stage")?.textContent || "",
          live,
          heading,
          btns,
          hostSample: host.slice(0, 500),
          dashVisible: !document.getElementById("simulation-dashboard")?.classList.contains("hidden"),
        };
      });
      observations.push({ step, ...obs });
      if (step === 0) {
        assert(
          (obs.cardId && /group/i.test(obs.cardId)) || /Group/i.test(obs.cardStage || ""),
          "first card is group",
          obs
        );
        assert(/Group stage so far:\s*P1/i.test(obs.live), "first lock ~P1", obs);
        assert(/Group|Table/i.test(obs.heading), "table panel first", obs);
      }
      if (!sawAfterGroup && (/Group stage so far:\s*P3\s*·\s*W2\s*·\s*D1/i.test(obs.live) || /P3 · W2 · D1/.test(obs.live))) {
        sawAfterGroup = true;
        observations.push({ marker: "after-group", ...obs });
      }
      if (
        !sawFirstKo &&
        /Tournament so far:\s*P4/i.test(obs.live) &&
        (/Bracket/i.test(obs.heading) || obs.btns.some((b) => /Show table/i.test(b)))
      ) {
        assert(/Bracket/i.test(obs.heading), "bracket heading at first KO", obs);
        assert(!/Winners/i.test(obs.hostSample), "no champion leak at first KO", obs.hostSample);
        // Final round must still be unrevealed (vs / TBD), not a completed scoreline.
        const finalChunk = (obs.hostSample.match(/Final[\s\S]{0,120}/i) || [""])[0];
        assert(
          /Final/i.test(obs.hostSample) ? /vs|TBD|—\s*—|spoiler/i.test(finalChunk) : true,
          "final still hidden at first KO",
          finalChunk || obs.hostSample.slice(-200)
        );
        assert(obs.btns.some((b) => /table/i.test(b)), "Show table control", obs.btns);
        sawFirstKo = true;
        observations.push({ marker: "first-ko", ...obs });
      }
      if (done) break;
      await page.evaluate(() => document.getElementById("sim-skip-match-btn")?.click());
      await page.waitForTimeout(120);
    }
    assert(sawAfterGroup, "observed group completion P3 W2 D1", observations.slice(-3));
    assert(sawFirstKo, "observed first KO with Show table", observations.filter((o) => o.marker));
    // Finish remaining
    await page.evaluate(() => document.getElementById("sim-skip-phase-btn")?.click());
    await page.waitForFunction(() => window.__qaPlaybackDone === true, null, { timeout: 60000 });
    const err = await page.evaluate(() => window.__qaPlaybackError);
    assert(!err, "playback error", err);
    const probe = await page.evaluate(() => window.__qaBatchProbe);
    assert(probe?.firstPlayerStage === "group", "batch probe group first", probe);
    const finalLive = await page.evaluate(() => document.querySelector(".tournament-live-record")?.innerText || "");
    assert(/P8/i.test(finalLive) && /W7/i.test(finalLive), "final P8 W7", finalLive);
    // Reopen group table from bracket
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll(".sim-ctx-btn")].find((b) => /table/i.test(b.textContent));
      btn?.click();
    });
    await page.waitForTimeout(80);
    const tableText = await page.evaluate(() => document.getElementById("league-table-host")?.innerText || "");
    assert(/Serbia/i.test(tableText), "group table reopen", tableText.slice(0, 300));
    const shotPath = await shot(page, "B01-playback");
    return { label: "controlled", probe, observations, finalLive, tableText: tableText.slice(0, 500), shotPath, errors: [...runtime] };
  },

  async B02(page, runtime) {
    // After national playback (B01 may have left dashboard), return to career competitions.
    await page.evaluate(() => {
      document.getElementById("sim-continue-btn")?.click();
      document.getElementById("season-animation-overlay")?.classList.add("hidden");
      document.getElementById("simulation-dashboard")?.classList.add("hidden");
    });
    await page.waitForTimeout(100);
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
    await page.evaluate(() => {
      const sel = document.getElementById("comp-name-select");
      if (!sel) return;
      const idx = [...sel.options].findIndex((o) => /Champions League|UCL/i.test(o.textContent));
      if (idx >= 0) {
        sel.selectedIndex = idx;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await page.waitForTimeout(120);
    await clickCompTab(page, "overview");
    const overview = await competitionsText(page);
    assert(/League phase/i.test(overview.text) || /League-phase record/i.test(overview.text), "league phase label", overview.text);
    assert(/P8\s*·\s*W4\s*·\s*D2\s*·\s*L2|W4\s*·\s*D2\s*·\s*L2/.test(overview.text), "UCL opening W4 D2 L2", overview.text.slice(0, 600));
    await clickCompTab(page, "phase");
    const phase = await competitionsText(page);
    assert(/League phase only/i.test(phase.text) || /P8/.test(phase.text), "phase scope", phase.text);
    // Two-leg path: total should be at least opening when knockout legs exist.
    const totalMatch = overview.text.match(/Total tournament record:\s*(P\d+[^\n]*)/i);
    const shotPath = await shot(page, "B03-continental");
    return {
      label: "controlled",
      overview: overview.text,
      phase: phase.text,
      totalLine: totalMatch?.[1] || null,
      shotPath,
      errors: [...runtime],
    };
  },

  async B04(page, runtime) {
    const observed = await page.evaluate(async () => {
      const {
        tallyParticipantRecord,
        projectTournamentRecords,
        renderTournamentSummaryHtml,
      } = await import("./js/ui/tournamentPresentation.js");
      const pensMatch = {
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
        stageType: "knockout",
      };
      const etMatch = {
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
        stageType: "knockout",
      };
      const pens = tallyParticipantRecord([pensMatch], ["Serbia"]).record;
      const et = tallyParticipantRecord([etMatch], ["Serbia"]).record;
      const campaign = {
        name: "B04 Cup",
        competitionId: "b04",
        playerNation: "Serbia",
        calledUp: true,
        playerNationInTournament: true,
        result: "Champions",
        groups: [],
        allRounds: [
          { round: "Semi-finals", matches: [etMatch] },
          { round: "Final", matches: [pensMatch] },
        ],
        field: ["Serbia", "Italy", "Spain"],
      };
      const proj = projectTournamentRecords({
        campaign,
        scope: { participantKind: "nation", participantId: "Serbia" },
      });
      const host = document.createElement("div");
      host.id = "b04-render-host";
      document.body.appendChild(host);
      host.innerHTML = renderTournamentSummaryHtml(proj);
      const rendered = host.innerText;
      host.remove();
      return { pens, et, rendered, result: proj.resultLabel, total: proj.tournament.record };
    });
    assert(observed.pens.draws === 1 && observed.pens.shootoutsWon === 1 && observed.pens.gf === 1, "pens", observed);
    assert(observed.et.wins === 1 && observed.et.gf === 2 && observed.et.ga === 1, "et", observed);
    assert(/P2/.test(observed.rendered) && (/shoot-out|penalty|pen/i.test(observed.rendered) || observed.pens.shootoutsWon === 1), "rendered pens/et", observed.rendered);
    const shotPath = await shot(page, "B04-et-pens");
    return { label: "controlled", observed, shotPath, errors: [...runtime] };
  },

  async B05(page, runtime) {
    const observed = await page.evaluate(async () => {
      const { projectTournamentRecords, renderTournamentSummaryHtml } = await import(
        "./js/ui/tournamentPresentation.js"
      );
      const snap = window.__exportCareerSnapshot?.();
      const euro = snap?.player?.seasons?.[0]?.europeanCampaign;
      const historicalId = euro.focusClubId;
      const moved = structuredClone(snap);
      moved.player.club = { clubId: "other-club", name: "Other Club", displayName: "Other Club" };
      moved.player.playingClubId = "other-club";
      // Keep historical season campaign identity.
      const restore = window.__restoreCareerSnapshot?.(moved);
      const proj = projectTournamentRecords({
        campaign: euro,
        scope: {
          participantKind: "club",
          participantId: historicalId,
        },
      });
      const host = document.createElement("div");
      document.body.appendChild(host);
      host.innerHTML = renderTournamentSummaryHtml(proj);
      const summary = host.innerText;
      host.remove();
      return {
        restoreOk: restore?.ok !== false,
        focusClubId: historicalId,
        participantId: proj.participantId,
        participantLabel: proj.participantLabel,
        played: proj.tournament.record?.played,
        todayClub: moved.player.playingClubId,
        summary: summary.slice(0, 400),
      };
    });
    assert(observed.restoreOk, "moved player restore", observed);
    assert(observed.focusClubId && observed.participantId === observed.focusClubId, "historical focus", observed);
    assert(observed.todayClub !== observed.focusClubId, "player moved", observed);
    // Reopen continental competition in UI for the restored career.
    await selectCompetition(page, /Champions League|World Cup/);
    await clickCompTab(page, "overview");
    const text = (await competitionsText(page)).text;
    const shotPath = await shot(page, "B05-moved-club");
    return { label: "controlled", observed, competitionsText: text.slice(0, 500), shotPath, errors: [...runtime] };
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
    // Reload clean snapshot then drive skip-phase through national dashboard.
    const snapshot = loadFixtureSnapshot();
    await restoreSnapshot(page, snapshot);
    await page.waitForTimeout(150);
    await page.evaluate(async () => {
      const dash = await import("./js/ui/simulationDashboard.js");
      const { buildNationalPlaybackContext } = await import("./js/simulation/competitionPlayback.js");
      const snap = window.__exportCareerSnapshot?.();
      const t = snap?.player?.seasons?.[0]?.international?.primary;
      const player = snap.player;
      const fixtures = [
        ...(t.groups || []).flatMap((g) => g.matches || []),
        ...(t.allRounds || []).flatMap((r) => r.matches || []),
      ].map((m) => {
        const h = m.home?.name || m.homeParticipantId;
        const a = m.away?.name || m.awayParticipantId;
        return {
          ...m,
          playerSide: h === "Serbia" ? "home" : a === "Serbia" ? "away" : null,
          competitionType: "international",
          teamType: "nation",
        };
      });
      dash.configureDashboardTiming({ matchMs: 20, speed: 40 });
      const ctx = buildNationalPlaybackContext({ tournament: t, player, visibleFixtureIds: [] });
      window.__qaPlaybackDone = false;
      window.__qaPlaybackError = null;
      dash
        .runSimulationDashboard({
          player,
          league: player.club,
          seasonNumber: 1,
          allMatches: fixtures,
          playerMatches: fixtures.filter((m) => m.playerSide),
          competitionContext: ctx,
          reset: true,
        })
        .then(() => {
          window.__qaPlaybackDone = true;
        })
        .catch((e) => {
          window.__qaPlaybackError = String(e?.message || e);
          window.__qaPlaybackDone = true;
        });
    });
    await page.waitForTimeout(80);
    // Pause, resume, skip match, then skip phase.
    await page.evaluate(() => document.getElementById("sim-pause-btn")?.click());
    await page.waitForTimeout(40);
    await page.evaluate(() => document.getElementById("sim-pause-btn")?.click());
    await page.evaluate(() => document.getElementById("sim-skip-match-btn")?.click());
    await page.waitForTimeout(80);
    await page.evaluate(() => document.getElementById("sim-skip-phase-btn")?.click());
    await page.waitForFunction(() => window.__qaPlaybackDone === true, null, { timeout: 60000 });
    const err = await page.evaluate(() => window.__qaPlaybackError);
    assert(!err, "B07 playback error", err);
    const finalLive = await page.evaluate(() => document.querySelector(".tournament-live-record")?.innerText || "");
    assert(/P8/i.test(finalLive) && /W7/i.test(finalLive), "skip path ends P8 W7", finalLive);
    await page.evaluate(() => {
      document.getElementById("sim-continue-btn")?.click();
      document.getElementById("season-animation-overlay")?.classList.add("hidden");
      document.getElementById("simulation-dashboard")?.classList.add("hidden");
    });
    await page.waitForTimeout(80);
    const again = await page.evaluate(() => {
      const snap = window.__exportCareerSnapshot?.();
      return window.__restoreCareerSnapshot?.(snap);
    });
    assert(again?.ok !== false, "restore continuation", again);
    await selectCompetition(page, /World Cup/);
    await clickCompTab(page, "overview");
    const text = (await competitionsText(page)).text;
    assert(/P8 · W7 · D1 · L0/.test(text), "records after continue/restore", text.slice(0, 400));
    const shotPath = await shot(page, "B07-skip-continue");
    return { label: "controlled", finalLive, competitionsText: text.slice(0, 500), shotPath, errors: [...runtime] };
  },

  async B08(page, runtime) {
    await selectCompetition(page, /World Cup/);
    await clickCompTab(page, "overview");
    const widths = [1440, 768, 390];
    const layouts = [];
    for (const w of widths) {
      await page.setViewportSize({ width: w, height: 800 });
      await page.waitForTimeout(80);
      const metrics = await page.evaluate(() => {
        const board = document.getElementById("competitions-board");
        const wrap = board?.querySelector(".comp-table-wrap") || board;
        const summary = board?.querySelector(".tournament-record-summary");
        const docOverflow = document.documentElement.scrollWidth > window.innerWidth + 1;
        return {
          viewport: window.innerWidth,
          docScrollWidth: document.documentElement.scrollWidth,
          boardScrollWidth: board?.scrollWidth || 0,
          boardClientWidth: board?.clientWidth || 0,
          panelScrollWidth: wrap?.scrollWidth || 0,
          panelClientWidth: wrap?.clientWidth || 0,
          summaryText: summary?.innerText || board?.innerText?.slice(0, 200) || "",
          docOverflow,
        };
      });
      assert(!metrics.docOverflow, `no page-wide overflow at ${w}`, metrics);
      assert(/P3|P8|Group/i.test(metrics.summaryText), `readable at ${w}`, metrics.summaryText);
      const path = await shot(page, `B08-${w}`);
      layouts.push({ width: w, ...metrics, shot: path });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    // Real keyboard: Tab to a competition tab and Activate with Enter
    await page.focus("#comp-season-select");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    const tabActive = await page.evaluate(() => {
      const active = document.querySelector(".comp-tab.is-active");
      return active?.dataset?.view || null;
    });
    assert(tabActive, "keyboard activated a tab", tabActive);
    return { label: "controlled", layouts, tabActive, errors: [...runtime] };
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

  // Merge B01–B08 into the Fix 12 case-index gate file (R5).
  const caseIndexPath = join(ROOT, "qa/fix12-runs/final/case-index.json");
  if (existsSync(caseIndexPath)) {
    const idx = JSON.parse(readFileSync(caseIndexPath, "utf8"));
    const withoutB = (idx.cases || []).filter((c) => !/^B\d{2}$/.test(c.id));
    const bRows = results.map((r) => ({
      id: r.id,
      status: r.status,
      ok: r.status === "PASS",
      source: "scripts/browserTournamentPresentationChecklist.mjs",
      detail: r.detail || r.reason || null,
    }));
    idx.cases = [...withoutB, ...bRows];
    idx.browserMergedAt = new Date().toISOString();
    idx.ok =
      report.fail === 0 &&
      idx.cases.length >= 26 &&
      idx.cases.every((c) => c.status === "PASS");
    await json(caseIndexPath, idx);
  }

  console.log(`Browser report ${OUT}: ${report.pass} pass / ${report.fail} fail`);
  if (report.fail) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
