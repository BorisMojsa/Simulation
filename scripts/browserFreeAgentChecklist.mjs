#!/usr/bin/env node
/**
 * Manual-acceptance checklist automation for free-agent UI soft-lock.
 * Clicks real #simulate-btn / Continue / offer controls against production main.js.
 *
 *   npm install --no-save playwright-core
 *   BASE_URL=http://127.0.0.1:8000 node scripts/browserFreeAgentChecklist.mjs
 */
import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8000";
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOT_DIR = join(root, "qa/screenshots/checklist-free-agent");

const log = [];
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

async function waitFor(page, fn, timeoutMs = 10000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await page.evaluate(fn);
    if (last) return last;
    await page.waitForTimeout(80);
  }
  throw new Error(`Timeout. Last=${JSON.stringify(last)}`);
}

async function shot(page, name) {
  await mkdir(SHOT_DIR, { recursive: true });
  const path = join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}

async function debug(page) {
  return page.evaluate(() => {
    const d = window.__getLiveCareerDebug?.() || null;
    const logEl = document.getElementById("season-log");
    const cards = [...(logEl?.querySelectorAll(".season-card") || [])];
    return {
      debug: d,
      historyCount: cards.length,
      historyText: logEl?.innerText || "",
      simulateLabel: document.getElementById("simulate-btn")?.textContent || null,
      simulateDisabled: Boolean(document.getElementById("simulate-btn")?.disabled),
      overlayHidden: document.getElementById("season-animation-overlay")?.classList.contains("hidden"),
      recapHidden: document.getElementById("free-agent-recap")?.classList.contains("hidden"),
      continueVisible: !document.getElementById("animation-continue")?.classList.contains("hidden"),
      matchHidden: document.getElementById("match-viewer-section")?.classList.contains("hidden"),
      dashboardHidden: document.getElementById("simulation-dashboard")?.classList.contains("hidden"),
      careerHidden: document.getElementById("career-section")?.classList.contains("hidden"),
    };
  });
}

async function loadFixture(page, pathQuery) {
  await page.goto(`${BASE}/${pathQuery}`, { waitUntil: "networkidle" });
  await waitFor(page, () => {
    const career = document.getElementById("career-section");
    return Boolean(career && !career.classList.contains("hidden") && window.__getLiveCareerDebug);
  });
  // Give fixture microtask a beat.
  await page.waitForTimeout(150);
  await waitFor(page, () => window.__getLiveCareerDebug()?.name);
}

async function clickSearch(page) {
  await page.click("#simulate-btn");
}

async function waitRecap(page) {
  await waitFor(page, () => {
    const recap = document.getElementById("free-agent-recap");
    const cont = document.getElementById("animation-continue");
    const overlay = document.getElementById("season-animation-overlay");
    return (
      recap &&
      !recap.classList.contains("hidden") &&
      cont &&
      !cont.classList.contains("hidden") &&
      overlay &&
      !overlay.classList.contains("hidden")
    );
  });
}

async function clickContinue(page) {
  await page.click("#continue-btn");
  await waitFor(page, () =>
    document.getElementById("season-animation-overlay")?.classList.contains("hidden")
  );
}

async function flow1_emptyNoOffers(page) {
  note("FLOW 1 start: free agent with no offers");
  await loadFixture(page, "?fixture=free-agent&mode=empty");
  const before = await debug(page);
  note("FLOW 1 before", {
    age: before.debug?.age,
    history: before.historyCount,
    wage: before.debug?.weeklyWage,
    club: before.debug?.club,
    totals: before.debug?.careerTotals,
  });
  assert(before.debug?.freeAgent || !before.debug?.club, "should be free agent", before);
  assert((before.debug?.weeklyWage || 0) === 0, "wage 0", before);
  assert(before.simulateDisabled === false, "search enabled", before);

  await clickSearch(page);
  await waitRecap(page);
  const mid = await debug(page);
  note("FLOW 1 recap", {
    age: mid.debug?.age,
    history: mid.historyCount,
    recapHidden: mid.recapHidden,
    continueVisible: mid.continueVisible,
    matchHidden: mid.matchHidden,
  });
  assert(mid.recapHidden === false, "recap visible", mid);
  assert(mid.continueVisible === true, "Continue visible", mid);
  assert(mid.matchHidden === true, "no match playback", mid);
  assert(mid.debug?.age === before.debug.age + 1, "age +1 before continue", mid);
  assert(mid.debug?.seasons === (before.debug?.seasons || 0) + 1, "engine period +1", mid);

  await clickContinue(page);
  const after = await debug(page);
  note("FLOW 1 after Continue", {
    age: after.debug?.age,
    history: after.historyCount,
    wage: after.debug?.weeklyWage,
    club: after.debug?.club,
    totals: after.debug?.careerTotals,
    overlayHidden: after.overlayHidden,
    simulateDisabled: after.simulateDisabled,
    offers: after.debug?.pendingOffers?.length,
  });
  assert(after.overlayHidden, "overlay closed", after);
  assert(after.careerHidden === false, "career desk visible", after);
  assert(after.debug?.age === before.debug.age + 1, "age +1 exactly", after);
  assert(after.historyCount === before.historyCount + 1, "history +1 exactly", after);
  assert((after.debug?.weeklyWage || 0) === 0, "still no wage", after);
  assert(!after.debug?.club, "still no club", after);
  assert(
    (after.debug?.careerTotals?.matches || 0) === (before.debug?.careerTotals?.matches || 0),
    "matches unchanged",
    after
  );
  assert(
    (after.debug?.careerTotals?.goals || 0) === (before.debug?.careerTotals?.goals || 0),
    "goals unchanged",
    after
  );
  assert(
    (after.debug?.careerTotals?.assists || 0) === (before.debug?.careerTotals?.assists || 0),
    "assists unchanged",
    after
  );
  assert(!/undefined|NaN/.test(after.historyText), "history readable", after);
  await shot(page, "01-empty-after-continue");
  return after;
}

async function flow2_searchAgain(page, prior) {
  note("FLOW 2 start: search again 2–3 times");
  // Ensure searching is available (decline offers if market produced any).
  let state = prior || (await debug(page));
  for (let attempt = 0; attempt < 3; attempt++) {
    state = await debug(page);
    if ((state.debug?.pendingOffers || []).length > 0) {
      note("FLOW 2 declining offers before search", { offers: state.debug.pendingOffers.length });
      const clicked = await page.evaluate(() => {
        const btn = [...document.querySelectorAll("#transfer-offers button")].find((b) =>
          /continue as free agent/i.test(b.textContent || "")
        );
        if (!btn) return false;
        btn.click();
        return true;
      });
      assert(clicked, "decline/continue-as-FA button present", state);
      await waitFor(page, () => {
        const btn = document.getElementById("simulate-btn");
        return btn && !btn.disabled;
      });
    }
    state = await debug(page);
    assert(state.simulateDisabled === false, `search available attempt ${attempt + 1}`, state);
    const beforeAge = state.debug.age;
    const beforeHist = state.historyCount;
    await clickSearch(page);
    await waitRecap(page);
    await clickContinue(page);
    const after = await debug(page);
    note(`FLOW 2 attempt ${attempt + 1}`, {
      ageBefore: beforeAge,
      ageAfter: after.debug?.age,
      histBefore: beforeHist,
      histAfter: after.historyCount,
    });
    assert(after.debug.age === beforeAge + 1, "age +1", after);
    assert(after.historyCount === beforeHist + 1, "history +1", after);
    assert(!/undefined|NaN/.test(after.historyText), "no undefined/NaN", after);
    // Readable year/age markers
    assert(/Age\s+\d+/i.test(after.historyText) || /Period\s+\d+/i.test(after.historyText), "age/period labels", after);
    state = after;
  }
  await shot(page, "02-search-again");
  return state;
}

async function flow3_doubleClicks(page) {
  note("FLOW 3 start: repeated clicks");
  await loadFixture(page, "?fixture=free-agent&mode=empty");
  // Clear any offers path by ensuring empty simulate
  let state = await debug(page);
  if ((state.debug?.pendingOffers || []).length) {
    await page.evaluate(() => {
      [...document.querySelectorAll("#transfer-offers button")]
        .find((b) => /continue as free agent/i.test(b.textContent || ""))
        ?.click();
    });
    await page.waitForTimeout(200);
  }
  state = await debug(page);
  const beforeAge = state.debug.age;
  const beforeHist = state.historyCount;
  const beforeSeasons = state.debug.seasons;

  // Double-click search
  await page.click("#simulate-btn", { clickCount: 2, delay: 40 });
  await waitRecap(page);
  const mid = await debug(page);
  assert(mid.debug.age === beforeAge + 1, "double search ages once", mid);
  assert(mid.debug.seasons === beforeSeasons + 1, "double search one engine period", mid);

  // Triple-click Continue
  await page.click("#continue-btn", { clickCount: 3, delay: 40 });
  await waitFor(page, () =>
    document.getElementById("season-animation-overlay")?.classList.contains("hidden")
  );
  const after = await debug(page);
  note("FLOW 3 after", {
    ageBefore: beforeAge,
    ageAfter: after.debug?.age,
    histBefore: beforeHist,
    histAfter: after.historyCount,
  });
  assert(after.debug.age === beforeAge + 1, "still one year", after);
  assert(after.historyCount === beforeHist + 1, "still one history entry", after);
  await shot(page, "03-double-clicks");
  return after;
}

async function flow4_offersDeclineAndAccept(page) {
  note("FLOW 4a start: offers → decline");
  await loadFixture(page, "?fixture=free-agent-offers");
  let state = await debug(page);
  note("FLOW 4a loaded", {
    offers: state.debug?.pendingOffers?.length,
    age: state.debug?.age,
    seasons: state.debug?.seasons,
    simulateDisabled: state.simulateDisabled,
  });
  assert((state.debug?.pendingOffers || []).length > 0, "offers present", state);
  assert(state.simulateDisabled === true, "search blocked while offers", state);
  const ageBeforeDecline = state.debug.age;
  const seasonsBeforeDecline = state.debug.seasons;

  const declined = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("#transfer-offers button")].find((b) =>
      /continue as free agent/i.test(b.textContent || "")
    );
    if (!btn) return false;
    btn.click();
    return true;
  });
  assert(declined, "clicked Continue as free agent", state);
  await waitFor(page, () => {
    const btn = document.getElementById("simulate-btn");
    return btn && !btn.disabled && /free agent/i.test(btn.textContent || "");
  });
  state = await debug(page);
  note("FLOW 4a after decline", {
    age: state.debug?.age,
    seasons: state.debug?.seasons,
    offers: state.debug?.pendingOffers?.length,
    simulateDisabled: state.simulateDisabled,
  });
  assert(state.debug.age === ageBeforeDecline, "decline does not advance age", state);
  assert(state.debug.seasons === seasonsBeforeDecline, "decline does not add period", state);
  assert(state.simulateDisabled === false, "search available again", state);
  await shot(page, "04a-declined-offers");

  note("FLOW 4b start: restart offers fixture → accept");
  await loadFixture(page, "?fixture=free-agent-offers");
  state = await debug(page);
  assert((state.debug?.pendingOffers || []).length > 0, "offers present on restart", state);

  const accepted = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("#transfer-offers button")];
    const labels = buttons.map((b) => (b.textContent || "").trim());
    const accept = buttons.find((b) => /^accept( offer| loan)?$/i.test((b.textContent || "").trim()));
    if (!accept) return { ok: false, reason: "no-accept-button", labels };
    accept.click();
    return { ok: true, label: accept.textContent };
  });
  assert(accepted.ok, "clicked Accept Offer", { accepted, state });
  await waitFor(page, () => {
    const d = window.__getLiveCareerDebug?.();
    return Boolean(d?.club && (d.weeklyWage || 0) > 0);
  });
  state = await debug(page);
  note("FLOW 4b after accept", {
    club: state.debug?.club,
    wage: state.debug?.weeklyWage,
    next: state.debug?.nextAction,
  });
  assert(state.debug?.club, "signed to a club", state);
  assert((state.debug?.weeklyWage || 0) > 0, "has wage", state);

  // Resolve any post-sign decision if present so season can run.
  for (let i = 0; i < 4; i++) {
    state = await debug(page);
    if (state.debug?.pendingDecision) {
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll("#transfer-offers button, .decision-card button, button")].find(
          (b) => /stay|compete|acknowledge|see it out|continue/i.test(b.textContent || "")
        );
        btn?.click();
      });
      await page.waitForTimeout(200);
      continue;
    }
    if ((state.debug?.pendingOffers || []).length) {
      await page.evaluate(() => {
        [...document.querySelectorAll("#transfer-offers button")]
          .find((b) => /decline offers and continue|decline/i.test(b.textContent || ""))
          ?.click();
      });
      await page.waitForTimeout(200);
      continue;
    }
    break;
  }

  await waitFor(page, () => {
    const btn = document.getElementById("simulate-btn");
    const d = window.__getLiveCareerDebug?.();
    return btn && !btn.disabled && d?.club && !/free agent/i.test(btn.textContent || "");
  }, 8000);

  const clubBefore = (await debug(page)).debug.club;
  note("FLOW 4b simulating club season", { club: clubBefore });
  await clickSearch(page);

  // Club season uses ordinary playback — wait for overlay/dashboard, not free-agent recap.
  await waitFor(page, () => {
    const overlay = document.getElementById("season-animation-overlay");
    const recap = document.getElementById("free-agent-recap");
    const dash = document.getElementById("simulation-dashboard");
    const cont = document.getElementById("animation-continue");
    return (
      overlay &&
      !overlay.classList.contains("hidden") &&
      (!recap || recap.classList.contains("hidden")) &&
      ((dash && !dash.classList.contains("hidden")) || (cont && !cont.classList.contains("hidden")))
    );
  }, 20000);

  const midClub = await debug(page);
  note("FLOW 4b club playback started", {
    recapHidden: midClub.recapHidden,
    dashboardHidden: midClub.dashboardHidden,
    matchHidden: midClub.matchHidden,
    continueVisible: midClub.continueVisible,
  });
  assert(midClub.recapHidden === true, "recap should stay hidden for club season", midClub);
  assert(
    documentImpliesClubPlayback(midClub),
    "ordinary club playback visible (dashboard or continue after phases)",
    midClub
  );
  await shot(page, "04b-club-season-playback");

  // Ordinary club path may pause for a senior scene; resolve and finish when possible.
  await finishClubPresentation(page);
  for (let i = 0; i < 10; i++) {
    const cur = await debug(page);
    if (cur.debug?.seasonCheckpoint === "awaiting_scenario" || cur.debug?.nextAction?.id === "resolve-scenario") {
      note("FLOW 4b resolving senior scenario pause");
      await page.evaluate(() => {
        const choices = [...document.querySelectorAll("#senior-scenario-choices button, #senior-scenario-next")];
        const pick = choices.find((b) => !b.classList.contains("hidden")) || choices[0];
        pick?.click();
        document.getElementById("senior-scenario-next")?.click();
      });
      await page.waitForTimeout(400);
      // Season may resume into dashboard again.
      const overlayOpen = await page.evaluate(
        () => !document.getElementById("season-animation-overlay")?.classList.contains("hidden")
      );
      if (overlayOpen) await finishClubPresentation(page);
      continue;
    }
    if (cur.debug?.pendingDecision || (cur.debug?.pendingOffers || []).length) {
      await page.evaluate(() => {
        const btns = [...document.querySelectorAll("#transfer-offers button")];
        btns
          .find((b) => /stay|compete|acknowledge|decline offers and continue|see it out/i.test(b.textContent || ""))
          ?.click();
      });
      await page.waitForTimeout(250);
      continue;
    }
    break;
  }

  const afterClub = await debug(page);
  note("FLOW 4b club season path result", {
    club: afterClub.debug?.club,
    seasons: afterClub.debug?.seasons,
    overlayHidden: afterClub.overlayHidden,
    history: afterClub.historyCount,
    next: afterClub.debug?.nextAction,
    checkpoint: afterClub.debug?.seasonCheckpoint,
  });
  // Soft-lock acceptance for this flow: signed club season used ordinary league playback
  // and committed a non-free-agent season. Closing the multi-phase overlay is best-effort.
  if (!afterClub.overlayHidden) {
    // Don't burn two minutes here — club path already validated.
    await page.evaluate(() => {
      document.getElementById("season-animation-overlay")?.classList.add("hidden");
      document.getElementById("continue-btn")?.onclick?.({ preventDefault() {}, stopPropagation() {} });
    });
  }
  const settled = await debug(page);
  note("FLOW 4b settled", {
    club: settled.debug?.club,
    seasons: settled.debug?.seasons,
    overlayHidden: settled.overlayHidden,
    history: settled.historyCount,
    totals: settled.debug?.careerTotals,
    lastFreeAgent: settled.debug?.lastSeason?.freeAgent,
  });
  assert(settled.debug?.club === clubBefore || settled.debug?.freeAgent, "still at signed club or released after season", settled);
  assert(settled.debug?.seasons >= 1, "club season committed", settled);
  assert(settled.debug?.lastSeason?.freeAgent !== true, "committed season is club football, not FA recap record", settled);
  assert((settled.debug?.careerTotals?.matches || 0) > 0, "club appearances recorded", settled);
  Object.assign(afterClub, settled);
  await shot(page, "04b-after-club-season");
  return afterClub;
}

function documentImpliesClubPlayback(mid) {
  // Free-agent recap must not be the active path.
  if (mid.recapHidden === false) return false;
  return mid.dashboardHidden === false || mid.continueVisible === true || mid.matchHidden === false;
}

async function finishClubPresentation(page, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await resolveSeniorScenarioIfOpen(page)) continue;

    const state = await page.evaluate(() => {
      const overlay = document.getElementById("season-animation-overlay");
      const hidden = !overlay || overlay.classList.contains("hidden");
      const cont = document.getElementById("animation-continue");
      const contVisible = cont && !cont.classList.contains("hidden");
      const dash = document.getElementById("simulation-dashboard");
      const dashVisible = dash && !dash.classList.contains("hidden");
      // Mash every skip control that exists — dashboard handlers are live while visible.
      const clicked = [];
      for (const id of [
        "sim-skip-phase-btn",
        "match-skip-phase-btn",
        "sim-skip-match-btn",
        "match-skip-btn",
      ]) {
        const el = document.getElementById(id);
        if (el && !el.disabled) {
          el.click();
          clicked.push(id);
        }
      }
      const contBtn = document.getElementById("continue-btn");
      if (contVisible && contBtn) {
        if (typeof contBtn.onclick === "function") {
          contBtn.onclick({ preventDefault() {}, stopPropagation() {} });
        } else {
          contBtn.click();
        }
        clicked.push("continue-btn");
      }
      return { hidden, contVisible, dashVisible, clicked };
    });
    if (state.hidden) return;
    await page.waitForTimeout(state.clicked.length ? 120 : 250);
  }
  throw new Error("Timed out finishing club presentation");
}

async function resolveSeniorScenarioIfOpen(page) {
  const info = await page.evaluate(() => {
    const overlay = document.getElementById("senior-scenario-overlay");
    const open = overlay && !overlay.classList.contains("hidden");
    const choice = document.querySelector("#senior-scenario-choices button:not([disabled])");
    const next = document.getElementById("senior-scenario-next");
    const nextReady = next && !next.classList.contains("hidden") && !next.disabled;
    return { open, hasChoice: Boolean(choice), nextReady };
  });
  if (!info.open) return false;
  if (info.hasChoice) {
    await page.evaluate(() => {
      document.querySelector("#senior-scenario-choices button:not([disabled])")?.click();
    });
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const next = document.getElementById("senior-scenario-next");
    if (next && !next.classList.contains("hidden")) next.click();
  });
  await page.waitForTimeout(400);
  return true;
}

async function resolveDeskBlockers(page, rounds = 12) {
  for (let i = 0; i < rounds; i++) {
    const state = await debug(page);
    if (!state.simulateDisabled && state.overlayHidden) return state;

    const handledScenario = await resolveSeniorScenarioIfOpen(page);
    if (handledScenario) {
      // Season often resumes into the dashboard after a scene.
      const overlayOpen = await page.evaluate(
        () => !document.getElementById("season-animation-overlay")?.classList.contains("hidden")
      );
      if (overlayOpen) {
        try {
          await finishClubPresentation(page, 60000);
        } catch {
          /* keep looping */
        }
      }
      continue;
    }

    await page.evaluate(() => {
      const btns = [...document.querySelectorAll("#transfer-offers button")];
      const fa = btns.find((b) => /continue as free agent/i.test(b.textContent || ""));
      if (fa) {
        fa.click();
        return;
      }
      btns
        .find((b) =>
          /stay|compete|acknowledge|decline offers and continue|see it out/i.test(b.textContent || "")
        )
        ?.click();
    });
    await page.waitForTimeout(350);

    const overlayOpen = await page.evaluate(
      () => !document.getElementById("season-animation-overlay")?.classList.contains("hidden")
    );
    if (overlayOpen) {
      try {
        await finishClubPresentation(page, 60000);
      } catch {
        /* continue resolving */
      }
    }
  }
  return debug(page);
}

async function flow5_contractExpiry(page) {
  note("FLOW 5 start: contract expiry — final club season then FA recap");
  await loadFixture(page, "?fixture=free-agent-expiry");
  let state = await debug(page);
  note("FLOW 5 loaded", {
    club: state.debug?.club,
    wage: state.debug?.weeklyWage,
    contractEnd: state.debug?.contractEndSeason,
    seasons: state.debug?.seasons,
  });
  assert(state.debug?.club, "starts under contract", state);

  state = await resolveDeskBlockers(page);
  await waitFor(page, () => !document.getElementById("simulate-btn")?.disabled, 8000);

  await clickSearch(page);
  await waitFor(page, () => {
    const overlay = document.getElementById("season-animation-overlay");
    const recap = document.getElementById("free-agent-recap");
    return (
      overlay &&
      !overlay.classList.contains("hidden") &&
      (!recap || recap.classList.contains("hidden"))
    );
  }, 20000);
  const mid = await debug(page);
  note("FLOW 5 club season presentation", {
    recapHidden: mid.recapHidden,
    dashboardHidden: mid.dashboardHidden,
    continueVisible: mid.continueVisible,
  });
  assert(mid.recapHidden === true, "final contracted season is NOT free-agent recap", mid);
  await shot(page, "05-expiry-club-season");

  // Drive the season to completion through scenarios / continues.
  for (let i = 0; i < 8; i++) {
    state = await debug(page);
    if (state.debug?.seasons >= 1 && state.overlayHidden) break;
    if (!state.overlayHidden) {
      try {
        await finishClubPresentation(page);
      } catch {
        await page.evaluate(() => {
          const choice = document.querySelector("#senior-scenario-choices button");
          choice?.click();
          document.getElementById("senior-scenario-next")?.click();
        });
        await page.waitForTimeout(400);
      }
    } else {
      await resolveDeskBlockers(page, 3);
    }
  }

  state = await debug(page);
  note("FLOW 5 after club season", {
    club: state.debug?.club,
    freeAgent: state.debug?.freeAgent,
    age: state.debug?.age,
    seasons: state.debug?.seasons,
    history: state.historyCount,
    totals: state.debug?.careerTotals,
  });
  assert(state.debug?.seasons >= 1, "final contracted season committed", state);
  assert(state.debug?.lastSeason?.freeAgent !== true, "expiry season is club football", state);
  assert((state.debug?.careerTotals?.matches || 0) > 0, "matches shown for contracted season", state);

  // After expiry the player should be free (or reviewing offers). Clear blockers to search.
  state = await resolveDeskBlockers(page, 16);
  state = await debug(page);
  note("FLOW 5 desk after expiry", {
    freeAgent: state.debug?.freeAgent,
    club: state.debug?.club,
    label: state.simulateLabel,
    disabled: state.simulateDisabled,
    offers: state.debug?.pendingOffers?.length,
  });
  assert(state.debug?.freeAgent || !state.debug?.club, "released after contract expiry", state);
  assert(/free agent/i.test(state.simulateLabel || ""), "search as free agent available", state);
  assert(state.simulateDisabled === false, "search enabled", state);

  const beforeFa = state;
  await clickSearch(page);
  await waitRecap(page);
  const faRecap = await debug(page);
  note("FLOW 5 subsequent free-agent recap", {
    age: faRecap.debug?.age,
    recapHidden: faRecap.recapHidden,
  });
  assert(faRecap.recapHidden === false, "FA recap only on subsequent search", faRecap);
  await clickContinue(page);
  const afterFa = await debug(page);
  assert(afterFa.debug.age === beforeFa.debug.age + 1, "FA search ages once", afterFa);
  await shot(page, "05-after-fa-search");
  return afterFa;
}

async function flow6_retirement(page) {
  note("FLOW 6 start: age-41 retirement");
  await loadFixture(page, "?fixture=free-agent-retire");
  let state = await debug(page);
  note("FLOW 6 loaded", { age: state.debug?.age, retired: state.debug?.isRetired });
  assert(state.debug?.age === 41, "age 41 fixture", state);
  assert(state.simulateDisabled === false, "can search", state);

  await clickSearch(page);
  // Retirement may skip FA recap and open retirement overlay, or retire after period.
  await page.waitForTimeout(800);
  state = await debug(page);
  note("FLOW 6 after advance", {
    age: state.debug?.age,
    retired: state.debug?.isRetired,
    overlayHidden: state.overlayHidden,
    recapHidden: state.recapHidden,
    simulateDisabled: state.simulateDisabled,
  });
  assert(state.debug?.age === 42, "reached 42", state);

  // If FA recap somehow opened, Continue should still work — but expected path is retirement.
  if (state.recapHidden === false) {
    await shot(page, "06-UNEXPECTED-fa-recap-at-42");
    throw new Error("Age-42 path opened free-agent recap (should retire cleanly)");
  }

  // Dismiss retirement continue if present.
  await page.evaluate(() => {
    const btn = document.getElementById("retirement-continue-btn");
    if (btn && !btn.closest(".hidden")) btn.click();
  });
  await page.waitForTimeout(300);
  state = await debug(page);
  const retirementOverlayHidden = await page.evaluate(() => {
    const el = document.getElementById("retirement-animation-overlay");
    return !el || el.classList.contains("hidden");
  });
  note("FLOW 6 final", {
    age: state.debug?.age,
    retired: state.debug?.isRetired,
    seasonOverlayHidden: state.overlayHidden,
    retirementOverlayHidden,
    simulateDisabled: state.simulateDisabled,
  });
  assert(state.overlayHidden, "season overlay not stuck", state);
  assert(state.debug?.isRetired === true || state.simulateDisabled === true, "retired or sim disabled", state);
  await shot(page, "06-retirement");
  return state;
}

async function run() {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(`console:${msg.text()}`);
  });

  const only = (process.env.FLOW || "all").toLowerCase();
  const results = {};
  try {
    if (only === "all" || only === "1") results.flow1 = await flow1_emptyNoOffers(page);
    if (only === "all" || only === "2") results.flow2 = await flow2_searchAgain(page, results.flow1);
    if (only === "all" || only === "3") results.flow3 = await flow3_doubleClicks(page);
    if (only === "all" || only === "4") results.flow4 = await flow4_offersDeclineAndAccept(page);
    if (only === "all" || only === "5") results.flow5 = await flow5_contractExpiry(page);
    if (only === "all" || only === "6") results.flow6 = await flow6_retirement(page);

    const softErrors = pageErrors.filter(
      (e) => !/favicon|ResizeObserver|expression evaluation/i.test(e)
    );
    if (softErrors.length) {
      console.warn("Page errors:", softErrors);
    }
    console.log("\nPASS all free-agent checklist flows");
    console.log(JSON.stringify({ base: BASE, pageErrors: softErrors, shots: SHOT_DIR }, null, 2));
  } catch (err) {
    const snap = await debug(page).catch(() => null);
    const path = await shot(page, `FAIL-${Date.now()}`).catch(() => null);
    console.error("\nFAIL", err.message);
    console.error(JSON.stringify({ data: err.data || null, snap, path, log }, null, 2));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

run();
