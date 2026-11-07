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

async function clickProductionContinue(page) {
  return page.evaluate(() => {
    const section = document.getElementById("animation-continue");
    const btn = document.getElementById("continue-btn");
    if (!section || section.classList.contains("hidden")) return { clicked: false, reason: "section-hidden" };
    if (!btn || btn.disabled || btn.offsetParent === null) return { clicked: false, reason: "btn-not-visible" };
    btn.click();
    return { clicked: true, text: (btn.textContent || "").trim() };
  });
}

async function readUiDebug(page) {
  return page.evaluate(() => {
    const d = window.__getLiveCareerDebug?.() || null;
    const overlay = document.getElementById("season-animation-overlay");
    const dash = document.getElementById("simulation-dashboard");
    const sim = document.getElementById("simulate-btn");
    const intl = document.getElementById("international-animation");
    return {
      debug: d,
      overlayHidden: !overlay || overlay.classList.contains("hidden"),
      dashboardHidden: !dash || dash.classList.contains("hidden") || !dash.classList.contains("active"),
      seasonActionInFlight: Boolean(d?.seasonActionInFlight),
      simulateDisabled: Boolean(sim?.disabled),
      simulateText: (sim?.textContent || "").trim(),
      nextAction: d?.nextAction || null,
      qaFix12: d?.qaFix12 || null,
      internationalVisible: Boolean(intl && !intl.classList.contains("hidden")),
      internationalText: intl?.innerText?.slice(0, 800) || "",
    };
  });
}

function looksLikeNationalRecap(text) {
  return /Total tournament record:\s*P\d|Group-stage record:\s*P\d|Tournament so far:\s*P\d|Winners/i.test(
    text || ""
  );
}

async function readNationalRecapText(page) {
  return page.evaluate(() => {
    const intl = document.getElementById("international-animation");
    const intlText = intl?.innerText || "";
    const live = document.querySelector(".tournament-live-record")?.innerText || "";
    const host = document.getElementById("league-table-host")?.innerText || "";
    return { intlText, live, host, intlVisible: Boolean(intl && !intl.classList.contains("hidden")) };
  });
}

/**
 * Drive production showSeasonAnimation using only real #continue-btn / skip controls.
 * Never installs onclick handlers or toggles overlay visibility directly.
 */
async function driveProductionSeasonToDesk(page, { timeoutMs = 180000, onNationalDashboard = null } = {}) {
  const deadline = Date.now() + timeoutMs;
  let continueClicks = 0;
  let nationalRecap = null;
  let pauseResumeSkip = false;
  let sawNationalDashboard = false;
  let waitedForNationalRecap = false;

  while (Date.now() < deadline) {
    const ui = await readUiDebug(page);
    if (ui.overlayHidden && ui.dashboardHidden && ui.seasonActionInFlight === false && continueClicks > 0) {
      return {
        continueClosed: true,
        continueClicks,
        nationalRecap,
        pauseResumeSkip,
        seasonActionInFlight: false,
        nextCareerAction: ui.nextAction,
        simulateText: ui.simulateText,
        simulateDisabled: ui.simulateDisabled,
        qaFix12: ui.qaFix12,
      };
    }

    const dashState = await page.evaluate(() => {
      const dash = document.getElementById("simulation-dashboard");
      const active = Boolean(dash && !dash.classList.contains("hidden") && dash.classList.contains("active"));
      const live = document.querySelector(".tournament-live-record")?.innerText || "";
      const stage = document.querySelector("#match-card-rail .match-card-stage")?.textContent || "";
      const title = document.getElementById("sim-dash-title")?.textContent || "";
      const national = /World Cup|Group stage|FIFA|international/i.test(`${live}\n${stage}\n${title}`);
      return { active, national, live, stage, title };
    });
    if (dashState.active && dashState.national && !sawNationalDashboard) {
      sawNationalDashboard = true;
      if (typeof onNationalDashboard === "function") {
        pauseResumeSkip = Boolean(await onNationalDashboard(page));
      } else {
        await page.evaluate(() => document.getElementById("sim-skip-phase-btn")?.click());
        await page.waitForTimeout(80);
      }
    } else if (dashState.active && !dashState.national) {
      // Empty/domestic league slate before internationals — skip through quickly.
      await page.evaluate(() => document.getElementById("sim-skip-phase-btn")?.click());
      await page.waitForTimeout(40);
    }

    const recap = await readNationalRecapText(page);
    if (looksLikeNationalRecap(recap.intlText)) nationalRecap = recap.intlText;
    else if (looksLikeNationalRecap(recap.live)) nationalRecap = nationalRecap || recap.live;

    // After national playback, wait briefly for the production international recap
    // screen so Continue does not race past it before we observe totals.
    if (sawNationalDashboard && !nationalRecap && !waitedForNationalRecap && !dashState.active) {
      waitedForNationalRecap = true;
      try {
        await page.waitForFunction(
          () => {
            const intl = document.getElementById("international-animation");
            const text = intl?.innerText || "";
            return (
              intl &&
              !intl.classList.contains("hidden") &&
              /Winners|Group-stage record:\s*P\d|Total tournament record:\s*P\d/i.test(text)
            );
          },
          null,
          { timeout: 8000 }
        );
        const after = await readNationalRecapText(page);
        if (looksLikeNationalRecap(after.intlText)) nationalRecap = after.intlText;
      } catch {
        /* continue driving; assertion later will fail if still missing */
      }
    }

    const cont = await clickProductionContinue(page);
    if (cont.clicked) {
      continueClicks += 1;
      await page.waitForTimeout(180);
      continue;
    }

    await page.evaluate(() => {
      for (const id of ["sim-skip-phase-btn", "match-skip-phase-btn", "sim-skip-match-btn", "match-skip-btn"]) {
        const el = document.getElementById(id);
        if (el && !el.disabled && el.offsetParent !== null) el.click();
      }
    });
    await page.waitForTimeout(160);
  }
  const snap = await readUiDebug(page);
  throw Object.assign(new Error("Timed out driving production season to desk"), { snap, continueClicks, nationalRecap });
}

async function startFix12CompleteFixture(page) {
  await page.evaluate(() => {
    window.__fix12FixturePromise = window.__loadFix12TournamentPresentationBrowserFixture?.();
  });
  await page.waitForFunction(
    () => {
      const d = window.__getLiveCareerDebug?.();
      const overlay = document.getElementById("season-animation-overlay");
      return Boolean(d?.qaFix12?.expectedTotal && overlay && !overlay.classList.contains("hidden"));
    },
    null,
    { timeout: 60000 }
  );
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
    // Production completed-season path (showSeasonAnimation → #continue-btn → desk).
    await startFix12CompleteFixture(page);
    const before = await readUiDebug(page);
    assert(before.seasonActionInFlight === true, "season in flight during presentation", before);
    const driven = await driveProductionSeasonToDesk(page);
    assert(driven.continueClosed === true, "overlay/dashboard closed by production Continue", driven);
    assert(driven.continueClicks >= 1, "clicked production #continue-btn", driven);
    assert(driven.seasonActionInFlight === false, "seasonActionInFlight cleared", driven);
    assert(driven.nextCareerAction?.canSimulate === true, "simulate next season available", driven.nextCareerAction);
    assert(
      /Total tournament record:\s*P8\s*·\s*W7|Group-stage record:\s*P3|Winners/i.test(driven.nationalRecap || ""),
      "national recap totals",
      driven.nationalRecap
    );
    const simEnabled = await page.evaluate(() => {
      const btn = document.getElementById("simulate-btn");
      return Boolean(btn && !btn.disabled);
    });
    assert(simEnabled, "#simulate-btn enabled after return", driven);

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
      nationalRecap: driven.nationalRecap,
      continueClosed: driven.continueClosed,
      seasonActionInFlight: driven.seasonActionInFlight,
      nextCareerAction: driven.nextCareerAction,
      continueClicks: driven.continueClicks,
      shotPath,
      errors: [...runtime],
    };
  },

  async B03(page, runtime) {
    await restoreSnapshot(page, loadFixtureSnapshot());
    await page.waitForTimeout(100);
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
    const phaseMatch = overview.text.match(/League-phase record:\s*P(\d+)/i);
    const totalMatch = overview.text.match(/Total tournament record:\s*P(\d+)/i);
    const phasePlayed = Number(phaseMatch?.[1] || 0);
    const tournamentPlayed = Number(totalMatch?.[1] || 0);
    assert(phasePlayed === 8, "exact league-phase P8", { phasePlayed, text: overview.text.slice(0, 500) });
    assert(tournamentPlayed === 10, "exact tournament P10 after two legs", { tournamentPlayed, text: overview.text.slice(0, 500) });
    await clickCompTab(page, "phase");
    const phase = await competitionsText(page);
    assert(/League phase only/i.test(phase.text) || /P8/.test(phase.text), "phase scope", phase.text);

    // Conference / group-format view via constructed campaign projection in the competitions board.
    const conferenceOrGroup = await page.evaluate(async () => {
      const { projectTournamentRecords, renderTournamentSummaryHtml } = await import(
        "./js/ui/tournamentPresentation.js"
      );
      const campaign = {
        name: "UEFA Conference League",
        competitionId: "uecl",
        editionId: "uecl:2026",
        focusClubId: "club-a",
        result: "Group stage",
        groups: {
          openingLabel: "League phase",
          groups: [
            {
              name: "Group A",
              participants: ["Alpha", "Beta"],
              matches: [],
              table: [
                { clubId: "club-a", name: "Alpha", played: 6, wins: 3, draws: 1, losses: 2, points: 10 },
              ],
            },
          ],
        },
        allRounds: [],
      };
      const proj = projectTournamentRecords({
        campaign,
        scope: { participantKind: "club", participantId: "club-a" },
      });
      const host = document.createElement("div");
      host.id = "b03-conference-host";
      document.body.appendChild(host);
      host.innerHTML = renderTournamentSummaryHtml(proj);
      const text = host.innerText;
      host.remove();
      return /Conference|Group|League/i.test(text) && /P6|P0|Partial|record/i.test(text);
    });
    assert(conferenceOrGroup === true, "conference/group-format view exercised", conferenceOrGroup);
    const shotPath = await shot(page, "B03-continental");
    return {
      label: "controlled",
      overview: overview.text,
      phase: phase.text,
      twoLegTotal: tournamentPlayed,
      phasePlayed,
      tournamentPlayed,
      conferenceOrGroup: true,
      shotPath,
      errors: [...runtime],
    };
  },

  async B04(page, runtime) {
    await restoreSnapshot(page, loadFixtureSnapshot());
    await page.waitForTimeout(100);
    // Inject controlled Serbia–Spain ET semi and Serbia–Italy pens final into career history.
    const observed = await page.evaluate(async () => {
      const { tallyParticipantRecord } = await import("./js/ui/tournamentPresentation.js");
      const snap = window.__exportCareerSnapshot?.();
      const intl = snap?.player?.seasons?.[0]?.international;
      const pensMatch = {
        matchId: "b04-pens",
        status: "played",
        home: { name: "Serbia", displayName: "Serbia" },
        away: { name: "Italy", displayName: "Italy" },
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
        home: { name: "Serbia", displayName: "Serbia" },
        away: { name: "Spain", displayName: "Spain" },
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
      const controlledRounds = [
        { round: "Semi-finals", stageId: "SF", matches: [etMatch] },
        { round: "Final", stageId: "Final", matches: [pensMatch] },
      ];
      for (const target of [intl?.primary, ...(intl?.tournaments || [])].filter(Boolean)) {
        target.allRounds = controlledRounds;
        target.rounds = controlledRounds;
        target.result = "Winners";
        target.winner = "Serbia";
      }
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
    await page.waitForTimeout(80);
    const knockoutView = (await competitionsText(page)).text;
    const semiChunk = (knockoutView.match(/Semi-finals[\s\S]{0,260}/i) || [""])[0];
    const finalChunk = (knockoutView.match(/(?:^|\n)Final(?:\n|$)[\s\S]{0,260}/i) || [""])[0];
    const serbiaSpainEt =
      /Serbia/i.test(semiChunk) && /Spain/i.test(semiChunk) && (/2–1|2-1/.test(semiChunk) || /a\.e\.t/i.test(semiChunk));
    const serbiaItalyPens =
      /Serbia/i.test(finalChunk) && /Italy/i.test(finalChunk) && (/5–4|5-4/.test(finalChunk) || /pens|penalt/i.test(finalChunk));
    assert(serbiaSpainEt, "Serbia–Spain ET semi in knockout view", semiChunk || knockoutView.slice(0, 400));
    assert(serbiaItalyPens, "Serbia–Italy pens final in knockout view", finalChunk || knockoutView.slice(0, 400));
    const shotPath = await shot(page, "B04-et-pens");
    return {
      label: "controlled",
      observed,
      knockoutView: knockoutView.slice(0, 800),
      serbiaSpainEt: true,
      serbiaItalyPens: true,
      shotPath,
      errors: [...runtime],
    };
  },

  async B05(page, runtime) {
    await restoreSnapshot(page, loadFixtureSnapshot());
    await page.waitForTimeout(100);
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
    await restoreSnapshot(page, loadFixtureSnapshot());
    await page.waitForTimeout(100);
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
    // Same production completed-season path, with pause/resume/skip during national dashboard.
    await startFix12CompleteFixture(page);
    const driven = await driveProductionSeasonToDesk(page, {
      onNationalDashboard: async (p) => {
        await p.evaluate(() => document.getElementById("sim-pause-btn")?.click());
        await p.waitForTimeout(40);
        await p.evaluate(() => document.getElementById("sim-pause-btn")?.click());
        await p.evaluate(() => document.getElementById("sim-skip-match-btn")?.click());
        await p.waitForTimeout(60);
        const liveMid = await p.evaluate(() => document.querySelector(".tournament-live-record")?.innerText || "");
        await p.evaluate(() => document.getElementById("sim-skip-phase-btn")?.click());
        await p.waitForTimeout(200);
        const liveEnd = await p.evaluate(() => document.querySelector(".tournament-live-record")?.innerText || "");
        await p.evaluate((probe) => {
          window.__qaB07Live = probe;
        }, { liveMid, liveEnd });
        return /P8/i.test(liveEnd) && /W7/i.test(liveEnd);
      },
    });
    const liveProbe = await page.evaluate(() => window.__qaB07Live || null);
    assert(driven.pauseResumeSkip === true, "pause/resume/skip path reached P8 W7", { driven, liveProbe });
    assert(driven.continueClosed === true, "production Continue closed overlay", driven);
    assert(driven.seasonActionInFlight === false, "seasonActionInFlight cleared", driven);
    assert(driven.nextCareerAction?.canSimulate === true, "next simulate action", driven.nextCareerAction);
    await selectCompetition(page, /World Cup/);
    await clickCompTab(page, "overview");
    const text = (await competitionsText(page)).text;
    assert(/P8 · W7 · D1 · L0/.test(text), "records after continue", text.slice(0, 400));
    const shotPath = await shot(page, "B07-skip-continue");
    return {
      label: "controlled",
      finalLive: liveProbe?.liveEnd || "",
      pauseResumeSkip: true,
      continueClosed: driven.continueClosed,
      seasonActionInFlight: driven.seasonActionInFlight,
      nextCareerAction: driven.nextCareerAction,
      competitionsText: text.slice(0, 500),
      shotPath,
      errors: [...runtime],
    };
  },

  async B08(page, runtime) {
    await restoreSnapshot(page, loadFixtureSnapshot());
    await page.waitForTimeout(100);
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

    // Inject a genuinely wide phase table at 390px, scroll it inside the panel.
    await page.setViewportSize({ width: 390, height: 800 });
    await page.waitForTimeout(40);
    await page.evaluate(() => {
      const board = document.getElementById("competitions-board");
      const view = board?.querySelector(".competitions-view") || board;
      if (!view) return;
      // Wide table must scroll inside .comp-table-wrap; wrap width follows the
      // competitions board / panel chain (not the table content).
      view.innerHTML = `<div class="comp-table-wrap" id="b08-wide-wrap"><table class="comp-table" id="b08-wide-table" style="width:max-content;min-width:960px"><thead><tr>${Array.from(
        { length: 16 },
        (_, i) => `<th style="min-width:70px">Col${i}</th>`
      ).join("")}</tr></thead><tbody><tr>${Array.from(
        { length: 16 },
        (_, i) => `<td style="min-width:70px">Cell${i}</td>`
      ).join("")}</tr></tbody></table></div>`;
    });
    await page.waitForTimeout(80);
    const phaseTableScroll = await page.evaluate(() => {
      const board = document.getElementById("competitions-board");
      const wrap = document.getElementById("b08-wide-wrap");
      if (!wrap || !board) return { ok: false };
      const before = wrap.scrollLeft;
      wrap.scrollLeft = 160;
      const after = wrap.scrollLeft;
      // Prefer documentElement; also check body in case clip containers differ.
      const docOverflow =
        document.documentElement.scrollWidth > window.innerWidth + 1 ||
        document.body.scrollWidth > window.innerWidth + 1;
      return {
        ok: true,
        docOverflow,
        boardClientWidth: board.clientWidth,
        wrapScrollWidth: wrap.scrollWidth,
        wrapClientWidth: wrap.clientWidth,
        scrolledInsidePanel: after > before,
        scrollLeft: after,
        overflowX: getComputedStyle(wrap).overflowX,
      };
    });
    assert(phaseTableScroll.ok, "wide phase wrap present", phaseTableScroll);
    assert(phaseTableScroll.wrapScrollWidth > 0 && phaseTableScroll.wrapClientWidth > 0, "positive wrap widths", phaseTableScroll);
    assert(
      phaseTableScroll.wrapClientWidth <= phaseTableScroll.boardClientWidth + 1,
      "wrap constrained to board",
      phaseTableScroll
    );
    assert(phaseTableScroll.wrapScrollWidth > phaseTableScroll.wrapClientWidth, "table wider than panel", phaseTableScroll);
    assert(phaseTableScroll.scrolledInsidePanel === true, "scrolled inside panel", phaseTableScroll);
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
  const testedSourceFingerprint = Object.fromEntries(
    [
      "js/ui/tournamentPresentation.js",
      "js/ui/simulationDashboard.js",
      "js/ui/rendering.js",
      "js/ui/seasonAnimation.js",
      "js/simulation/competitionPlayback.js",
      "js/simulation/nationalTournament.js",
      "js/simulation/fix12TournamentPresentationBrowserFixture.js",
      "main.js",
      "tests/tournamentPresentation.test.mjs",
      "scripts/browserTournamentPresentationChecklist.mjs",
      "scripts/qaTournamentPresentation.mjs",
      "style.css",
    ].map((rel) => [rel, createHash("sha256").update(readFileSync(join(ROOT, rel))).digest("hex")])
  );
  const fixtureDigest = createHash("sha256")
    .update(readFileSync(join(ROOT, "qa/fix12-runs/final/fixtures/f01-career-snapshot.json")))
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
    testedSourceFingerprint,
    fixtureDigest,
    // Legacy single-module field retained for older readers.
    sourceFingerprint: testedSourceFingerprint["js/ui/tournamentPresentation.js"],
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
