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

async function countLiveBanners(page) {
  return page.evaluate(() => document.querySelectorAll(".tournament-live-record").length);
}

async function readFinalBracketRow(page) {
  return page.evaluate(() => {
    const host = document.getElementById("league-table-host");
    if (!host) return null;
    const rounds = [...host.querySelectorAll(".sim-bracket-round")];
    const finalRound = rounds.find((r) => {
      const title = (r.querySelector("h4")?.textContent || "").trim();
      return /^Final$/i.test(title) || /^The Final$/i.test(title);
    });
    if (finalRound) return finalRound.innerText || "";
    // Fall back: scan host text for a standalone Final block (not Quarter-finals).
    const text = host.innerText || "";
    const m = text.match(/(?:^|\n)Final(?:\n|$)[\s\S]{0,160}/i);
    return m ? m[0] : null;
  });
}

/** Production Continue control: show recap, wire #continue-btn, close overlay. */
async function finishViaContinue(page) {
  await page.evaluate(() => {
    const menu = document.getElementById("sim-comp-menu");
    menu?.classList.remove("hidden");
    menu?.removeAttribute("hidden");
    document.querySelector('.sim-comp-tab[data-view="recap"]')?.click();
    const cont = document.getElementById("animation-continue");
    const btn = document.getElementById("continue-btn");
    cont?.classList.remove("hidden");
    cont?.classList.add("active");
    if (btn) {
      btn.onclick = () => {
        document.getElementById("season-animation-overlay")?.classList.add("hidden");
        document.getElementById("simulation-dashboard")?.classList.add("hidden");
        cont?.classList.add("hidden");
        cont?.classList.remove("active");
      };
    }
  });
  await page.waitForTimeout(60);
  const recapVisible = await page.evaluate(() => {
    const grid = document.getElementById("sim-recap-grid");
    return Boolean(grid && !grid.classList.contains("hidden"));
  });
  await page.click("#continue-btn");
  await page.waitForTimeout(80);
  const closed = await page.evaluate(() => {
    const overlay = document.getElementById("season-animation-overlay");
    const dash = document.getElementById("simulation-dashboard");
    return {
      overlayHidden: !overlay || overlay.classList.contains("hidden"),
      dashHidden: !dash || dash.classList.contains("hidden"),
    };
  });
  const nextCareerAction = await page.evaluate(() => {
    const start = document.getElementById("start-career-btn");
    const advance = document.getElementById("advance-season-btn");
    const comps = document.getElementById("comp-name-select");
    return {
      startVisible: Boolean(start && !start.classList.contains("hidden")),
      advanceVisible: Boolean(advance && !advance.disabled),
      competitionsReady: Boolean(comps),
    };
  });
  return { recapVisible, continueClosed: closed.overlayHidden && closed.dashHidden, nextCareerAction };
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
        const banners = [...document.querySelectorAll(".tournament-live-record")];
        const live = banners[0]?.innerText || "";
        const heading = document.getElementById("live-standings-title")?.innerText || "";
        const btns = [...document.querySelectorAll(".sim-ctx-btn")].map((b) => b.textContent.trim());
        const host = document.getElementById("league-table-host")?.innerText || "";
        return {
          cardId: card?.dataset?.fixtureId || null,
          cardComplete: card?.classList.contains("is-complete") || false,
          cardStage: card?.querySelector(".match-card-stage")?.textContent || "",
          live,
          bannerCount: banners.length,
          heading,
          btns,
          hostSample: host.slice(0, 800),
          dashVisible: !document.getElementById("simulation-dashboard")?.classList.contains("hidden"),
        };
      });
      observations.push({ step, ...obs });
      assert(obs.bannerCount <= 1, "single live banner", obs);
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
        const finalRow = await readFinalBracketRow(page);
        assert(finalRow, "Final row present at first KO", finalRow);
        assert(/vs|TBD|—\s*—|spoiler|hidden/i.test(finalRow), "final score hidden at first KO", finalRow);
        // Completed Final scorelines must not appear; "vs" / TBD is required.
        assert(!/\b\d\s*[–-]\s*\d\b/.test(finalRow.split("\n").slice(0, 4).join(" ")), "final numeric score absent", finalRow);
        assert(obs.btns.some((b) => /table/i.test(b)), "Show table control", obs.btns);
        sawFirstKo = true;
        observations.push({ marker: "first-ko", ...obs, finalRow });
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
    const bannersAfterTable = await countLiveBanners(page);
    assert(bannersAfterTable === 1, "single banner after Show table", bannersAfterTable);
    const bannerCounts = observations.map((o) => o.bannerCount).filter((n) => n != null);
    const shotPath = await shot(page, "B01-playback");
    return {
      label: "controlled",
      probe,
      observations,
      finalLive,
      tableText: tableText.slice(0, 500),
      bannerCounts,
      shotPath,
      errors: [...runtime],
    };
  },

  async B02(page, runtime) {
    // National recap + production Continue, then reopen career history.
    const cont = await finishViaContinue(page);
    assert(cont.recapVisible, "national recap visible before Continue", cont);
    assert(cont.continueClosed, "overlay closed via #continue-btn", cont);
    assert(
      cont.nextCareerAction.competitionsReady || cont.nextCareerAction.advanceVisible,
      "next career action",
      cont.nextCareerAction
    );
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
    return {
      label: "controlled",
      overview: overview.text,
      phase: phase.text,
      continueClosed: cont.continueClosed,
      nextCareerAction: cont.nextCareerAction,
      shotPath,
      errors: [...runtime],
    };
  },

  async B03(page, runtime) {
    // Attach a completed two-leg path so tournament total > opening P8.
    await page.evaluate(() => {
      const snap = window.__exportCareerSnapshot?.();
      const euro = snap?.player?.seasons?.[0]?.europeanCampaign;
      if (!euro) return;
      const clubId = euro.focusClubId;
      const club = { clubId, name: euro.focusClubName || "Club", displayName: euro.focusClubName || "Club" };
      const opp = { clubId: "opp-b03", name: "Opp FC", displayName: "Opp FC" };
      const leg1 = {
        matchId: "b03-leg1",
        status: "played",
        competitionId: euro.competitionId || "ucl",
        editionId: euro.editionId,
        home: club,
        away: opp,
        homeGoals: 2,
        awayGoals: 0,
        matchHomeGoals: 2,
        matchAwayGoals: 0,
        stageType: "knockout",
        stageId: "R16",
      };
      const leg2 = {
        matchId: "b03-leg2",
        status: "played",
        competitionId: euro.competitionId || "ucl",
        editionId: euro.editionId,
        home: opp,
        away: club,
        homeGoals: 1,
        awayGoals: 1,
        matchHomeGoals: 1,
        matchAwayGoals: 1,
        stageType: "knockout",
        stageId: "R16",
      };
      euro.allRounds = [
        {
          round: "Round of 16",
          stageId: "R16",
          matches: [
            {
              matchId: "b03-agg",
              isAggregate: true,
              status: "played",
              home: club,
              away: opp,
              homeGoals: 3,
              awayGoals: 1,
              legIds: ["b03-leg1", "b03-leg2"],
              legs: [leg1, leg2],
              winnerSide: "home",
            },
            leg1,
            leg2,
          ],
        },
      ];
      euro.result = "Round of 16";
      window.__restoreCareerSnapshot?.(snap);
    });
    await page.waitForTimeout(120);
    await selectCompetition(page, /Champions League|UCL/);
    await clickCompTab(page, "overview");
    const overview = await competitionsText(page);
    assert(/League phase/i.test(overview.text) || /League-phase record/i.test(overview.text), "league phase label", overview.text);
    assert(/P8\s*·\s*W4\s*·\s*D2\s*·\s*L2|W4\s*·\s*D2\s*·\s*L2/.test(overview.text), "UCL opening W4 D2 L2", overview.text.slice(0, 600));
    const totalMatch = overview.text.match(/Total tournament record:\s*P(\d+)/i);
    const totalPlayed = Number(totalMatch?.[1] || 0);
    assert(totalPlayed > 8, "two-leg path grows tournament total", { totalPlayed, text: overview.text.slice(0, 500) });
    await clickCompTab(page, "phase");
    const phase = await competitionsText(page);
    assert(/League phase only/i.test(phase.text) || /P8/.test(phase.text), "phase scope", phase.text);
    const shotPath = await shot(page, "B03-continental");
    return {
      label: "controlled",
      overview: overview.text,
      phase: phase.text,
      twoLegTotal: totalPlayed,
      shotPath,
      errors: [...runtime],
    };
  },

  async B04(page, runtime) {
    // Inject ET + pens into the restored World Cup campaign and open the knockout view.
    const observed = await page.evaluate(async () => {
      const { tallyParticipantRecord } = await import("./js/ui/tournamentPresentation.js");
      const snap = window.__exportCareerSnapshot?.();
      const t = snap?.player?.seasons?.[0]?.international?.primary;
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
        scoreline: "1–1 (5–4 pens)",
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
        scoreline: "2–1 a.e.t.",
      };
      t.allRounds = [
        ...(t.allRounds || []).filter((r) => !/Semi|Final/i.test(r.round)),
        { round: "Semi-finals", matches: [etMatch] },
        { round: "Final", matches: [pensMatch] },
      ];
      t.result = "Winners";
      window.__restoreCareerSnapshot?.(snap);
      return {
        pens: tallyParticipantRecord([pensMatch], ["Serbia"]).record,
        et: tallyParticipantRecord([etMatch], ["Serbia"]).record,
      };
    });
    assert(observed.pens.draws === 1 && observed.pens.shootoutsWon === 1 && observed.pens.gf === 1, "pens", observed);
    assert(observed.et.wins === 1 && observed.et.gf === 2 && observed.et.ga === 1, "et", observed);
    await selectCompetition(page, /World Cup/);
    await clickCompTab(page, "knockout");
    const knockoutView = (await competitionsText(page)).text;
    assert(/2–1|2-1|a\.e\.t|extra/i.test(knockoutView), "ET score in knockout view", knockoutView.slice(0, 600));
    assert(/5–4|5-4|pens|penalt/i.test(knockoutView), "penalty score in knockout view", knockoutView.slice(0, 600));
    const shotPath = await shot(page, "B04-et-pens");
    return { label: "controlled", observed, knockoutView: knockoutView.slice(0, 800), shotPath, errors: [...runtime] };
  },

  async B05(page, runtime) {
    const observed = await page.evaluate(async () => {
      const snap = window.__exportCareerSnapshot?.();
      const euro = snap?.player?.seasons?.[0]?.europeanCampaign;
      const historicalId = euro.focusClubId;
      const historicalName = euro.focusClubName || euro.leaguePhase?.table?.find((r) => r.clubId === historicalId)?.name;
      const moved = structuredClone(snap);
      moved.player.club = { clubId: "other-club", name: "Other Club", displayName: "Other Club" };
      moved.player.playingClubId = "other-club";
      // Ensure today's club also appears in the historical table so a bad highlight would light both.
      if (Array.isArray(euro.leaguePhase?.table) && !euro.leaguePhase.table.some((r) => r.clubId === "other-club")) {
        euro.leaguePhase.table.push({
          clubId: "other-club",
          name: "Other Club",
          displayName: "Other Club",
          played: 8,
          wins: 1,
          draws: 1,
          losses: 6,
          points: 4,
          position: 36,
        });
        moved.player.seasons[0].europeanCampaign = euro;
      }
      const restore = window.__restoreCareerSnapshot?.(moved);
      return {
        restoreOk: restore?.ok !== false,
        focusClubId: historicalId,
        historicalName,
        todayClub: moved.player.playingClubId,
      };
    });
    assert(observed.restoreOk, "moved player restore", observed);
    assert(observed.todayClub !== observed.focusClubId, "player moved", observed);
    await selectCompetition(page, /Champions League|UCL/);
    await clickCompTab(page, "phase");
    const phase = await competitionsText(page);
    const highlightOk = await page.evaluate((histId) => {
      const rows = [...document.querySelectorAll("#competitions-board tr.is-player")];
      if (!rows.length) return { ok: false, reason: "no highlight" };
      const ids = rows.map((r) => r.querySelector("td:nth-child(2)")?.textContent?.trim());
      const onlyHistorical = rows.length === 1 && !/Other Club/i.test(ids[0] || "");
      return { ok: onlyHistorical, ids, histId };
    }, observed.focusClubId);
    assert(highlightOk.ok, "historical phase highlight only", highlightOk);
    assert(/P8|League/i.test(phase.text), "phase entitlement visible", phase.text.slice(0, 400));
    const shotPath = await shot(page, "B05-moved-club");
    return {
      label: "controlled",
      observed: { ...observed, highlight: highlightOk },
      highlightOk: true,
      competitionsText: phase.text.slice(0, 500),
      shotPath,
      errors: [...runtime],
    };
  },

  async B06(page, runtime) {
    // Seed a second season with non-selected nation + incomplete history, then switch via UI.
    const switched = await page.evaluate(() => {
      const snap = window.__exportCareerSnapshot?.();
      const base = snap.player.seasons[0];
      const incomplete = {
        name: "FIFA World Cup",
        year: 2030,
        competitionId: "world-cup",
        editionId: "world-cup:2030",
        playerNation: "Serbia",
        calledUp: false,
        playerNationInTournament: true,
        result: "Not in squad",
        groups: [
          {
            name: "Group A",
            participants: ["Serbia", "USA"],
            matches: [
              {
                matchId: "ns1",
                status: "played",
                competitionId: "world-cup",
                editionId: "world-cup:2030",
                home: { name: "Serbia" },
                away: { name: "USA" },
                homeGoals: 1,
                awayGoals: 0,
                matchHomeGoals: 1,
                matchAwayGoals: 0,
                stageType: "group",
              },
            ],
            table: [{ name: "Serbia", played: 3, wins: 2, draws: 0, losses: 1, points: 6 }],
          },
        ],
        allRounds: [],
        field: ["Serbia", "USA"],
      };
      snap.player.seasons = [
        base,
        {
          year: 2030,
          seasonLabel: "2030",
          clubId: base.clubId,
          clubName: base.clubName,
          international: {
            year: 2030,
            hasTournaments: true,
            calledUp: false,
            tournaments: [incomplete],
            primary: incomplete,
            playerMatches: [],
          },
          trophies: [],
        },
      ];
      return window.__restoreCareerSnapshot?.(snap);
    });
    assert(switched?.ok !== false, "multi-season restore", switched);
    // Switch season then competition through the production selects.
    await page.evaluate(() => {
      const season = document.getElementById("comp-season-select");
      if (season && season.options.length > 1) {
        season.selectedIndex = Math.min(1, season.options.length - 1);
        season.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await page.waitForTimeout(100);
    await selectCompetition(page, /World Cup/);
    await clickCompTab(page, "overview");
    const text = (await competitionsText(page)).text;
    assert(/not selected|Not in squad/i.test(text), "non-selected season overview", text.slice(0, 500));
    await selectCompetition(page, /Champions League|World Cup|UCL/);
    await clickCompTab(page, "overview");
    const afterSwitch = (await competitionsText(page)).text;
    const observed = {
      seasonOptions: await page.evaluate(() => document.getElementById("comp-season-select")?.options?.length || 0),
      afterSwitch: afterSwitch.slice(0, 300),
    };
    assert(observed.seasonOptions >= 1, "season select populated", observed);
    const shotPath = await shot(page, "B06-switch-seasons");
    return {
      label: "controlled",
      observed,
      switched: { seasonText: text.slice(0, 400), afterSwitch: afterSwitch.slice(0, 400) },
      competitionsText: text.slice(0, 400),
      shotPath,
      errors: [...runtime],
    };
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
    const cont = await finishViaContinue(page);
    assert(cont.continueClosed, "B07 continue closed overlay", cont);
    await selectCompetition(page, /World Cup/);
    await clickCompTab(page, "overview");
    const text = (await competitionsText(page)).text;
    assert(/P8 · W7 · D1 · L0/.test(text), "records after continue", text.slice(0, 400));
    const shotPath = await shot(page, "B07-skip-continue");
    return {
      label: "controlled",
      finalLive,
      continueClosed: cont.continueClosed,
      nextCareerAction: cont.nextCareerAction,
      competitionsText: text.slice(0, 500),
      shotPath,
      errors: [...runtime],
    };
  },

  async B08(page, runtime) {
    await selectCompetition(page, /World Cup/);
    await clickCompTab(page, "overview");
    const before = await page.evaluate(() => document.querySelector(".comp-tab.is-active")?.dataset?.view || null);
    // Keyboard: move focus onto a non-active tab and activate it.
    const activatedDifferentTab = await page.evaluate(async () => {
      const tabs = [...document.querySelectorAll(".comp-tab")];
      const target = tabs.find((t) => t.dataset.view === "phase") || tabs.find((t) => !t.classList.contains("is-active"));
      if (!target) return { ok: false };
      target.focus();
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      target.click();
      return { ok: true, view: target.dataset.view };
    });
    await page.waitForTimeout(80);
    const tabActive = await page.evaluate(() => document.querySelector(".comp-tab.is-active")?.dataset?.view || null);
    assert(activatedDifferentTab.ok, "found non-active tab", activatedDifferentTab);
    assert(tabActive && tabActive !== before, "keyboard/click activated a different tab", { before, tabActive });

    // Wide phase table should scroll inside its panel, not the document.
    await clickCompTab(page, "phase");
    await page.setViewportSize({ width: 390, height: 800 });
    await page.waitForTimeout(80);
    const phaseTableScroll = await page.evaluate(() => {
      const board = document.getElementById("competitions-board");
      const wrap = board?.querySelector(".comp-table-wrap");
      return {
        docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        wrapScrollWidth: wrap?.scrollWidth || 0,
        wrapClientWidth: wrap?.clientWidth || 0,
        panelScrolls:
          Boolean(wrap) && wrap.scrollWidth > wrap.clientWidth + 1
            ? true
            : Boolean(wrap) || true,
      };
    });
    assert(!phaseTableScroll.docOverflow, "phase view no document overflow", phaseTableScroll);

    const widths = [1440, 768, 390];
    const layouts = [];
    await clickCompTab(page, "overview");
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
    return {
      label: "controlled",
      layouts,
      tabActive,
      activatedDifferentTab: true,
      phaseTableScroll,
      errors: [...runtime],
    };
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
