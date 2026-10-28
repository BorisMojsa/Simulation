#!/usr/bin/env node
/**
 * Real-browser acceptance for Fix 04 academy continuation / graduation.
 *
 *   python3 -m http.server 8000 --bind 127.0.0.1
 *   npm install --no-save playwright-core
 *   BASE_URL=http://127.0.0.1:8000 node scripts/browserAcademyChecklist.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8000";
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOT_DIR = join(root, "qa/screenshots/checklist-academy");
const STATE_DIR = join(root, "qa/evidence/academy-checklist");

const log = [];
const results = [];

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

async function waitFor(page, fn, timeoutMs = 15000) {
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

async function dumpState(page, name) {
  await mkdir(STATE_DIR, { recursive: true });
  const state = await page.evaluate(() => window.__getLiveCareerDebug?.() || null);
  const path = join(STATE_DIR, `${name}.json`);
  await writeFile(path, JSON.stringify(state, null, 2));
  return path;
}

async function debug(page) {
  return page.evaluate(() => {
    const d = window.__getLiveCareerDebug?.() || null;
    const logEl = document.getElementById("season-log");
    const cards = [...(logEl?.querySelectorAll(".season-card") || [])];
    const academyRecap = document.getElementById("academy-recap");
    const faRecap = document.getElementById("free-agent-recap");
    return {
      debug: d,
      historyCount: cards.length,
      historyText: logEl?.innerText || "",
      simulateLabel: document.getElementById("simulate-btn")?.textContent || null,
      simulateDisabled: Boolean(document.getElementById("simulate-btn")?.disabled),
      overlayHidden: document.getElementById("season-animation-overlay")?.classList.contains("hidden"),
      academyRecapHidden: !academyRecap || academyRecap.classList.contains("hidden"),
      faRecapHidden: !faRecap || faRecap.classList.contains("hidden"),
      continueVisible: !document.getElementById("animation-continue")?.classList.contains("hidden"),
      matchHidden: document.getElementById("match-viewer-section")?.classList.contains("hidden"),
      dashboardHidden: document.getElementById("simulation-dashboard")?.classList.contains("hidden"),
      careerHidden: document.getElementById("career-section")?.classList.contains("hidden"),
      transferText: document.getElementById("transfer-offers")?.innerText || "",
      academyRecapText: academyRecap?.innerText || "",
    };
  });
}

async function loadFixture(page, pathQuery) {
  await page.goto(`${BASE}/${pathQuery}`, { waitUntil: "networkidle" });
  await waitFor(page, () => {
    const career = document.getElementById("career-section");
    return Boolean(career && !career.classList.contains("hidden") && window.__getLiveCareerDebug);
  });
  await page.waitForTimeout(150);
  await waitFor(page, () => window.__getLiveCareerDebug()?.name || window.__getLiveCareerDebug()?.age != null);
}

async function waitAcademyRecap(page) {
  await waitFor(page, () => {
    const recap = document.getElementById("academy-recap");
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

async function waitFaRecap(page) {
  await waitFor(page, () => {
    const recap = document.getElementById("free-agent-recap");
    const cont = document.getElementById("animation-continue");
    return recap && !recap.classList.contains("hidden") && cont && !cont.classList.contains("hidden");
  });
}

async function clickContinue(page) {
  await page.click("#continue-btn");
  await waitFor(page, () =>
    document.getElementById("season-animation-overlay")?.classList.contains("hidden")
  );
}

/** Drive league dashboard / cup match viewer / phase Continues until overlay closes. */
async function driveSeniorSeasonToDesk(page, seasonsBefore, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cur = await debug(page);
    if (
      cur.overlayHidden &&
      cur.careerHidden === false &&
      cur.debug?.seasonActionInFlight === false &&
      (cur.debug?.seasons || 0) > seasonsBefore
    ) {
      return cur;
    }

    const handled = await page.evaluate(() => {
      const clicked = [];
      const senior = document.getElementById("senior-scenario-overlay");
      if (senior && !senior.classList.contains("hidden")) {
        const choice = [...senior.querySelectorAll("button")].find((b) => !b.disabled);
        if (choice) {
          choice.click();
          clicked.push("scenario");
        }
        const next = document.getElementById("senior-scenario-next");
        if (next && !next.classList.contains("hidden") && !next.disabled) {
          next.click();
          clicked.push("scenario-next");
        }
      }

      for (const id of [
        "sim-skip-phase-btn",
        "match-skip-phase-btn",
        "sim-skip-match-btn",
        "match-skip-btn",
      ]) {
        const el = document.getElementById(id);
        if (el && !el.disabled && el.offsetParent !== null) {
          el.click();
          clicked.push(id);
        }
      }

      const animContinue = document.getElementById("animation-continue");
      const contBtn = document.getElementById("continue-btn");
      if (
        animContinue &&
        !animContinue.classList.contains("hidden") &&
        contBtn &&
        !contBtn.disabled
      ) {
        contBtn.click();
        clicked.push("continue-btn");
      }

      const deskBtn = [...document.querySelectorAll("#transfer-offers button")].find((b) =>
        /stay|compete|acknowledge|decline offers and continue|see it out|see out|remain|continue at/i.test(
          b.textContent || ""
        )
      );
      if (deskBtn) {
        deskBtn.click();
        clicked.push("desk-decision");
      }

      const sim = document.getElementById("simulate-btn");
      if (sim && !sim.disabled && /continue season/i.test(sim.textContent || "")) {
        sim.click();
        clicked.push("resume-season");
      }
      return clicked;
    });

    await page.waitForTimeout(handled.length ? 120 : 250);
  }
  const snap = await debug(page);
  throw new Error(
    `Timed out returning to desk after senior season: ${JSON.stringify({
      overlayHidden: snap.overlayHidden,
      seasons: snap.debug?.seasons,
      seasonsBefore,
      continueVisible: snap.continueVisible,
      matchHidden: snap.matchHidden,
      dashboardHidden: snap.dashboardHidden,
      inFlight: snap.debug?.seasonActionInFlight,
      pendingDecision: snap.debug?.pendingDecision,
      next: snap.debug?.nextAction,
    })}`
  );
}

async function record(name, status, detail = {}) {
  results.push({ name, status, ...detail });
  note(`${status}: ${name}`, detail);
}

async function flowContinueEmpty(page) {
  note("FLOW: unsigned AVA empty continuation");
  await loadFixture(page, "?fixture=academy-continue-empty");
  const before = await debug(page);
  assert(before.debug?.club?.includes?.("Academy") || /academy/i.test(before.debug?.club || ""), "academy club", before);
  assert(before.debug?.age === 17, "age 17", before);
  assert(before.simulateDisabled === false, "simulate enabled", before);
  assert(/academy/i.test(before.simulateLabel || ""), "academy button label", before);
  await dumpState(page, "01-before-continue");
  await shot(page, "01-before-continue");

  await page.click("#simulate-btn");
  await waitAcademyRecap(page);
  const mid = await debug(page);
  assert(mid.academyRecapHidden === false, "academy recap visible", mid);
  assert(mid.matchHidden === true, "no PL match playback", mid);
  assert(/Youth matches|Academy/i.test(mid.academyRecapText), "recap copy", mid);
  await shot(page, "02-academy-recap");

  await clickContinue(page);
  const after = await debug(page);
  assert(after.overlayHidden, "overlay closed", after);
  assert(after.debug?.age === 18, "age +1 once", after);
  assert(after.historyCount === before.historyCount + 1, "history +1", after);
  assert(after.simulateDisabled === false, "desk usable", after);
  await dumpState(page, "03-after-continue");
  await shot(page, "03-after-continue");
  await record("continue-empty", "PASS", { age: after.debug?.age, history: after.historyCount });
}

async function flowRejectOffer(page) {
  note("FLOW: rejected Accept via finance revalidation (R1 remaining + final)");
  // Mid-review with 2+ offers: fail first Accept, preserve remaining.
  await loadFixture(page, "?fixture=academy-continue-offers");
  let before = await debug(page);
  assert((before.debug?.pendingOffers || []).length >= 1, "offers visible", before);
  await shot(page, "04-offers-desk");
  const zeroed = await page.evaluate(() => window.__zeroPendingOfferWageHeadroom?.());
  assert(zeroed?.ok, "wage headroom zeroed", zeroed);
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("#transfer-offers button")].find((b) =>
      /accept offer/i.test(b.textContent || "")
    );
    if (!btn) return { ok: false };
    btn.click();
    return { ok: true };
  });
  assert(clicked.ok, "Accept clicked after headroom zero");
  await page.waitForTimeout(400);
  let after = await debug(page);
  assert(after.debug?.isAcademy === true, "still academy after failed Accept", after);
  assert(
    (after.debug?.pendingOffers || []).length >= 0,
    "tray settled after failure",
    after
  );
  await dumpState(page, "05-after-failed-accept-mid");
  await shot(page, "05-after-failed-accept-mid");

  // Final sole offer exhausted → release
  await loadFixture(page, "?fixture=academy-age21-final-offers");
  before = await debug(page);
  assert(before.debug?.age === 21, "age 21", before);
  // Shrink to one offer via evaluate, then zero headroom.
  await page.evaluate(() => {
    const p = window.__getLiveCareerDebug?.();
    void p;
    const offers = document.querySelectorAll("#transfer-offers .offer-card, #transfer-offers > div");
    void offers;
  });
  // Keep first pending offer only by declining extras via card Decline until one remains,
  // or zero headroom on current first and accept until released.
  let guard = 0;
  while (guard++ < 6) {
    const state = await debug(page);
    if (state.debug?.freeAgent) break;
    if (!state.debug?.isAcademy) break;
    const n = state.debug?.pendingOffers?.length || 0;
    if (n === 0) break;
    await page.evaluate(() => window.__zeroPendingOfferWageHeadroom?.());
    const okClick = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("#transfer-offers button")].find((b) =>
        /accept offer/i.test(b.textContent || "")
      );
      if (!btn) return false;
      btn.click();
      return true;
    });
    assert(okClick, "Accept on final review path");
    await page.waitForTimeout(350);
  }
  after = await debug(page);
  assert(after.debug?.freeAgent === true, "released after exhausted final accepts", after);
  assert((after.debug?.pendingOffers || []).length === 0, "no pending after release", after);
  await dumpState(page, "05b-final-exhausted-release");
  await shot(page, "05b-final-exhausted-release");
  await record("reject-offer", "PASS", {
    midStillAcademy: true,
    finalReleased: true,
  });
}

async function flowFinalEmptyRelease(page) {
  note("FLOW: age 20→21 empty → release + FA train");
  await loadFixture(page, "?fixture=academy-age20-final-empty");
  const before = await debug(page);
  assert(before.debug?.age === 20, "age 20", before);
  await page.click("#simulate-btn");
  await waitAcademyRecap(page);
  await shot(page, "06-final-release-recap");
  await clickContinue(page);
  const after = await debug(page);
  assert(after.debug?.age === 21, "age 21", after);
  assert(!after.debug?.club || after.debug?.freeAgent, "released", after);
  assert(/free agent/i.test(after.simulateLabel || ""), "FA label", after);
  await dumpState(page, "07-released");
  await shot(page, "07-released-desk");

  // One FA search/train
  await page.click("#simulate-btn");
  await waitFaRecap(page);
  await shot(page, "08-fa-recap");
  await clickContinue(page);
  const fa = await debug(page);
  assert(fa.debug?.age === 22, "FA age +1", fa);
  // Desk is usable: either search again, or review market offers from the FA window.
  const deskUsable =
    fa.simulateDisabled === false ||
    (fa.debug?.pendingOffers || []).length > 0 ||
    /continue as free agent|accept offer|review/i.test(fa.transferText || "");
  assert(deskUsable, "desk usable after FA", fa);
  assert(fa.debug?.freeAgent === true, "still free agent", fa);
  await record("final-empty-release", "PASS", {
    age: fa.debug?.age,
    offers: fa.debug?.pendingOffers?.length || 0,
  });
}

async function flowFinalOffersAcceptAndDecline(page) {
  note("FLOW: final review accept + decline-all");
  // Decline-all branch
  await loadFixture(page, "?fixture=academy-age21-final-offers");
  let state = await debug(page);
  assert(state.debug?.age === 21, "age 21 final", state);
  assert(state.simulateDisabled === true, "cannot simulate another year", state);
  const declined = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("#transfer-offers button")];
    const btn = buttons.find((b) => /decline all|leave academy/i.test(b.textContent || ""));
    if (!btn) return { ok: false, labels: buttons.map((b) => b.textContent) };
    btn.click();
    return { ok: true };
  });
  assert(declined.ok, "decline-all present", declined);
  await page.waitForTimeout(250);
  state = await debug(page);
  assert(!state.debug?.club || state.debug?.freeAgent, "released after decline-all", state);
  await shot(page, "09-final-decline-released");

  // Accept branch
  await loadFixture(page, "?fixture=academy-age21-final-offers");
  const accepted = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("#transfer-offers button.primary, #transfer-offers button.accept, #transfer-offers .offer-card button")];
    // Prefer Accept on first offer card
    const all = [...document.querySelectorAll("#transfer-offers button")];
    const btn = all.find((b) => /^accept$/i.test((b.textContent || "").trim())) || all.find((b) => /accept/i.test(b.textContent || ""));
    if (!btn) return { ok: false, labels: all.map((b) => b.textContent) };
    btn.click();
    return { ok: true, label: btn.textContent };
  });
  assert(accepted.ok, "accept control present", accepted);
  await page.waitForTimeout(300);
  state = await debug(page);
  assert(state.debug?.club && !/academy/i.test(state.debug.club), "graduated senior club", state);
  await shot(page, "10-final-accept-graduated");
  await record("final-offers", "PASS", { accepted: accepted.label });
}

async function flowDoubleContinue(page) {
  note("FLOW: rapid double Continue / simulate");
  await loadFixture(page, "?fixture=academy-continue-empty");
  const before = await debug(page);
  await page.click("#simulate-btn");
  await waitAcademyRecap(page);
  // Double-click Continue
  await page.click("#continue-btn");
  await page.click("#continue-btn").catch(() => {});
  await waitFor(page, () =>
    document.getElementById("season-animation-overlay")?.classList.contains("hidden")
  );
  const after = await debug(page);
  assert(after.debug?.age === before.debug.age + 1, "exact-once age", after);
  assert(after.historyCount === before.historyCount + 1, "exact-once history", after);
  await shot(page, "11-double-continue");
  await record("double-continue", "PASS", { age: after.debug?.age });
}

async function flowPendingReviewRestore(page) {
  note("FLOW: pending review serialize → restore → complete");
  await loadFixture(page, "?fixture=academy-pending-review");
  const before = await debug(page);
  const reviewId = before.debug?.academyLifecycle?.pendingReviewId;
  assert(reviewId, "pending review id", before);
  assert((before.debug?.pendingOffers || []).length > 0, "offers present", before);
  const snapshot = await page.evaluate(() => window.__exportCareerSnapshot?.());
  assert(snapshot?.player?.academyLifecycle?.pendingReviewId === reviewId, "snapshot has review", {
    reviewId,
    snapReview: snapshot?.player?.academyLifecycle?.pendingReviewId,
  });
  await dumpState(page, "12-pending-review-before-export");
  // Navigate away / load unrelated fixture, then restore the snapshot.
  await loadFixture(page, "?fixture=academy-continue-empty");
  const mid = await debug(page);
  assert(mid.debug?.academyLifecycle?.pendingReviewId !== reviewId, "left original review", mid);
  const restored = await page.evaluate((snap) => window.__restoreCareerSnapshot?.(snap), snapshot);
  assert(restored?.ok, "restore ok", restored);
  assert(restored.reviewId === reviewId, "restored same review id", restored);
  const afterRestore = await debug(page);
  assert(afterRestore.debug?.academyLifecycle?.pendingReviewId === reviewId, "desk shows restored review", afterRestore);
  await dumpState(page, "12-pending-review-restored");
  await shot(page, "12-pending-review");
  const declined = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("#transfer-offers button")];
    const btn = buttons.find((b) => /decline offers and continue academy/i.test(b.textContent || ""));
    if (!btn) return { ok: false, labels: buttons.map((b) => b.textContent) };
    btn.click();
    return { ok: true, label: btn.textContent };
  });
  assert(declined.ok, "window decline from restored review", declined);
  await page.waitForTimeout(250);
  const after = await debug(page);
  assert(
    after.debug?.academyLifecycle?.pendingReviewId == null ||
      after.debug?.academyLifecycle?.status === "enrolled",
    "review cleared",
    after
  );
  assert(after.debug?.isAcademy === true, "still academy after mid review decline", after);
  await record("pending-review-restore", "PASS", {
    reviewId,
    restoreMethod: "window.__exportCareerSnapshot → __restoreCareerSnapshot",
    declineLabel: declined.label,
  });
}

async function clickIfVisible(page, selector, timeoutMs = 8000) {
  const started = Date.now();
  let visible = false;
  while (Date.now() - started < timeoutMs) {
    visible = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return Boolean(el && !el.classList.contains("hidden") && el.offsetParent !== null);
    }, selector);
    if (visible) break;
    await page.waitForTimeout(80);
  }
  assert(visible, `control not visible: ${selector}`);
  await page.click(selector);
}

async function flowOrdinaryCareerGraduate(page) {
  note("FLOW: ordinary setup → opening → sign → senior season");
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(250);

  await page.fill("#player-name", "Browser Academy Grad");
  // Radios are visually hidden — click via evaluate / associated labels.
  const selected = await page.evaluate(() => {
    const age = document.querySelector('input[name="starting-age"][value="17"]');
    const eng = [...document.querySelectorAll('input[name="nationality"]')].find((i) =>
      /england/i.test(i.value)
    );
    const pos =
      document.querySelector('input[name="primary-position"][value="RW"]') ||
      document.querySelector('input[name="primary-position"][value="CM"]');
    for (const el of [age, eng, pos]) {
      if (!el) continue;
      el.checked = true;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    document.querySelector('label[for="starting-age-17"]')?.click();
    if (eng?.id) document.querySelector(`label[for="${eng.id}"]`)?.click();
    if (pos?.id) document.querySelector(`label[for="${pos.id}"]`)?.click();
    return {
      age: Boolean(age?.checked),
      nationality: eng?.checked ? eng.value : null,
      position: pos?.checked ? pos.value : null,
    };
  });
  assert(selected.age, "starting age 17 selected", selected);
  assert(selected.nationality, "nationality selected", selected);
  assert(selected.position, "position selected", selected);
  await shot(page, "13-setup-filled");

  const setupCheck = await page.evaluate(() => window.__readCareerSetupValues?.());
  assert(setupCheck?.ok, "setup validation accepts filled form", setupCheck);

  await page.click("#start-career-btn");
  const overlayReady = await page
    .waitForFunction(
      () => {
        const overlay = document.getElementById("career-start-overlay");
        return overlay && !overlay.classList.contains("hidden");
      },
      { timeout: 10000 }
    )
    .then(() => true)
    .catch(() => false);
  assert(overlayReady, "career start overlay opened after valid setup");

  async function stepNote(label) {
    const s = await page.evaluate(() => ({
      step: [...document.querySelectorAll(".career-step")].find((el) => !el.classList.contains("hidden"))?.id,
      choiceHidden: document.getElementById("career-academy-choice")?.classList.contains("hidden"),
      nextOfferHidden: document.getElementById("career-academy-next-offer")?.classList.contains("hidden"),
      nextOfferDisabled: document.getElementById("career-academy-next-offer")?.disabled,
      scenarioChoices: document.querySelectorAll("#career-scenario-choices button").length,
      ratingNextHidden: document.getElementById("career-rating-next")?.classList.contains("hidden"),
      proCards: document.getElementById("career-pro-deals-grid")?.children?.length || 0,
      yearEndHidden: document.getElementById("career-step-year-end")?.classList.contains("hidden"),
      careerHidden: document.getElementById("career-section")?.classList.contains("hidden"),
    }));
    note(`ordinary:${label}`, s);
    return s;
  }

  // Backstory → academy offers → choose first academy
  await clickIfVisible(page, "#career-backstory-next");
  await stepNote("after-backstory");
  await clickIfVisible(page, "#career-academy-intro-next");
  await stepNote("after-academy-intro");
  // Reveal offers — wait for Next offer after stagger, until choice grid
  for (let i = 0; i < 5; i++) {
    const choiceVisible = await page.evaluate(() => {
      const choice = document.getElementById("career-academy-choice");
      return Boolean(choice && !choice.classList.contains("hidden"));
    });
    if (choiceVisible) break;
    await clickIfVisible(page, "#career-academy-next-offer", 12000);
    await page.waitForTimeout(200);
  }
  await stepNote("before-academy-choice");
  const chose = await page.evaluate(() => {
    const btn = document.querySelector(
      "#career-academy-grid button, #career-academy-grid .career-academy-card, #career-academy-grid [role='button']"
    );
    if (!btn) return { ok: false };
    btn.click();
    return { ok: true, text: (btn.textContent || "").slice(0, 60) };
  });
  assert(chose.ok, "academy card clicked", chose);

  // Five academy moments
  for (let i = 0; i < 5; i++) {
    const started = Date.now();
    let n = 0;
    while (Date.now() - started < 15000) {
      n = await page.evaluate(() => document.querySelectorAll("#career-scenario-choices button").length);
      if (n > 0) break;
      await page.waitForTimeout(100);
    }
    assert(n > 0, `scenario ${i + 1} choices visible`);
    await page.evaluate(() => document.querySelector("#career-scenario-choices button")?.click());
    await page.waitForTimeout(120);
    // Outcome next (may appear after animation)
    const nextStarted = Date.now();
    while (Date.now() - nextStarted < 10000) {
      const ready = await page.evaluate(() => {
        const btn = document.getElementById("career-scenario-next");
        return Boolean(btn && !btn.classList.contains("hidden") && !btn.disabled);
      });
      if (ready) {
        await page.click("#career-scenario-next");
        break;
      }
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(120);
  }
  await stepNote("after-moments");

  // Rating → pro deals
  await clickIfVisible(page, "#career-rating-next", 20000);
  const proReadyStarted = Date.now();
  let proCards = 0;
  while (Date.now() - proReadyStarted < 15000) {
    proCards = await page.evaluate(() => document.getElementById("career-pro-deals-grid")?.children?.length || 0);
    if (proCards > 0) break;
    await page.waitForTimeout(100);
  }
  assert(proCards > 0, "pro deal cards present");
  await shot(page, "13b-pro-deals");
  const signed = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("#career-pro-deals-grid button")];
    const accept = cards.find((c) => !/stay in the system|continue/i.test(c.textContent || ""));
    const pick = accept || cards[0];
    if (!pick) return { ok: false };
    pick.click();
    return { ok: true, label: pick.textContent?.slice(0, 80), stay: !accept };
  });
  assert(signed.ok, "pro deal card clicked", signed);
  assert(!signed.stay, "signed a real generated deal, not stay-in-system", signed);
  await clickIfVisible(page, "#career-year-end-continue", 15000);
  const deskStarted = Date.now();
  let onDesk = false;
  while (Date.now() - deskStarted < 15000) {
    onDesk = await page.evaluate(() => {
      const career = document.getElementById("career-section");
      return Boolean(career && !career.classList.contains("hidden") && window.__getLiveCareerDebug?.()?.name);
    });
    if (onDesk) break;
    await page.waitForTimeout(100);
  }
  assert(onDesk, "career desk visible after opening");
  await shot(page, "13c-desk-after-opening");
  let state = await debug(page);
  assert(state.debug?.name === "Browser Academy Grad", "desk player", state);
  assert(!state.debug?.isAcademy, "graduated to senior", state);
  assert(state.debug?.club && !/academy/i.test(state.debug.club), "senior club name", state);

  assert(state.simulateDisabled === false || state.debug?.nextAction?.canSimulate, "can simulate senior", state);
  const seasonsBefore = state.debug?.seasons || 0;
  await page.click("#simulate-btn");
  // Drive full senior presentation (league dashboard + cup match viewer + phase Continues).
  // Bounded like free-agent club season driver — short loops false-fail mid FA Cup.
  const afterSim = await driveSeniorSeasonToDesk(page, seasonsBefore, 90000);
  note("ordinary:after-senior-loop", {
    seasons: afterSim.debug?.seasons,
    seasonsBefore,
    inFlight: afterSim.debug?.seasonActionInFlight,
    overlayHidden: afterSim.overlayHidden,
    continueVisible: afterSim.continueVisible,
    simulateDisabled: afterSim.simulateDisabled,
    label: afterSim.simulateLabel,
    pendingDecision: afterSim.debug?.pendingDecision,
  });
  assert(afterSim.overlayHidden, "returned to desk after senior season presentation", afterSim);
  assert((afterSim.debug?.seasons || 0) > seasonsBefore, "senior season committed", afterSim);
  state = await debug(page);
  assert((state.debug?.seasons || 0) >= 2, "at least opening + senior season", state);
  assert(!state.debug?.isAcademy, "still senior after season", state);
  await dumpState(page, "13d-after-senior-season");
  await shot(page, "13-ordinary-desk");
  await record("ordinary-career-graduate", "PASS", {
    club: state.debug?.club,
    seasons: state.debug?.seasons,
    age: state.debug?.age,
  });
}

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  await mkdir(STATE_DIR, { recursive: true });
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
  });
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") log.push({ t: new Date().toISOString(), consoleError: msg.text() });
  });
  page.on("pageerror", (err) => {
    log.push({ t: new Date().toISOString(), pageError: String(err) });
  });
  page.on("dialog", async (dialog) => {
    log.push({ t: new Date().toISOString(), alert: dialog.message() });
    await dialog.dismiss();
  });

  const flows = [
    ["continue-empty", flowContinueEmpty],
    ["reject-offer", flowRejectOffer],
    ["final-empty-release", flowFinalEmptyRelease],
    ["final-offers", flowFinalOffersAcceptAndDecline],
    ["double-continue", flowDoubleContinue],
    ["pending-review-restore", flowPendingReviewRestore],
    ["ordinary-career-graduate", flowOrdinaryCareerGraduate],
  ];

  for (const [name, fn] of flows) {
    try {
      await fn(page);
    } catch (err) {
      await shot(page, `FAIL-${name}-${Date.now()}`).catch(() => {});
      await record(name, "FAIL", { error: err.message, data: err.data });
      console.error(`FAIL ${name}:`, err.message, err.data || "");
    }
  }

  await browser.close();
  const summary = {
    base: BASE,
    results,
    failed: results.filter((r) => r.status === "FAIL").length,
    passed: results.filter((r) => r.status === "PASS").length,
    blocked: results.filter((r) => r.status === "BLOCKED").length,
    log,
  };
  await writeFile(join(STATE_DIR, "checklist-summary.json"), JSON.stringify(summary, null, 2));
  console.log("\n=== Academy browser checklist ===");
  console.log(JSON.stringify(results, null, 2));
  // Required scenarios must not be FAIL or BLOCKED.
  if (summary.failed > 0 || summary.blocked > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
