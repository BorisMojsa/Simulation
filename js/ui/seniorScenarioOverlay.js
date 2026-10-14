/**
 * Text-led senior career scene overlay (academy-style presentation).
 */
import {
  buildSeniorScenarioFeedback,
  formatSeniorScenarioContextLine,
  resolveSeniorScenarioChoice,
} from "../simulation/seniorCareerScenarios.js";
import { formatAbilityForDisplay } from "./abilityFormatting.js";

/**
 * Show a pending senior scenario and resolve on choice + Continue.
 * @returns {Promise<{ok:boolean, choiceId?:string, result?:object}>}
 */
export function showSeniorScenarioOverlay(player, pending, { onResolved } = {}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("senior-scenario-overlay");
    if (!overlay || !pending || pending.unschedulable) {
      resolve({ ok: false, reason: "no-overlay" });
      return;
    }

    const titleEl = document.getElementById("senior-scenario-title");
    const ctxEl = document.getElementById("senior-scenario-context");
    const setupEl = document.getElementById("senior-scenario-setup");
    const choicesEl = document.getElementById("senior-scenario-choices");
    const outcomeEl = document.getElementById("senior-scenario-outcome");
    const badgesEl = document.getElementById("senior-scenario-badges");
    const nextBtn = document.getElementById("senior-scenario-next");
    const ovrEl = document.getElementById("senior-scenario-ovr");

    if (titleEl) titleEl.textContent = pending.title || "Career moment";
    if (ctxEl) ctxEl.textContent = formatSeniorScenarioContextLine(pending);
    if (setupEl) setupEl.textContent = pending.setup || "";
    if (outcomeEl) {
      outcomeEl.textContent = "";
      outcomeEl.classList.add("hidden");
    }
    if (badgesEl) {
      badgesEl.textContent = "";
      badgesEl.classList.add("hidden");
    }
    if (nextBtn) nextBtn.classList.add("hidden");
    if (ovrEl) {
      ovrEl.textContent = formatAbilityForDisplay(player.currentOverall ?? player.rating);
    }
    if (choicesEl) choicesEl.innerHTML = "";

    let settled = false;
    let lastResult = null;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      overlay.classList.add("hidden");
      overlay.setAttribute("aria-hidden", "true");
      document.body.classList.remove("senior-scenario-open");
      if (typeof onResolved === "function") onResolved(payload);
      resolve(payload);
    };

    for (const choice of pending.choices || []) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "primary career-choice-btn";
      btn.textContent = choice.label;
      btn.addEventListener("click", () => {
        if (settled || lastResult) return;
        const result = resolveSeniorScenarioChoice(player, pending, choice.id);
        lastResult = result;
        for (const b of choicesEl.querySelectorAll("button")) {
          b.disabled = true;
          if (b === btn) b.classList.add("career-choice-selected");
        }
        if (outcomeEl) {
          outcomeEl.textContent = buildSeniorScenarioFeedback(result.outcome, result.badges);
          outcomeEl.classList.remove("hidden");
        }
        if (badgesEl && result.badges?.length) {
          badgesEl.innerHTML = result.badges
            .map((b) => `<span class="senior-effect-badge">${escapeHtml(b)}</span>`)
            .join("");
          badgesEl.classList.remove("hidden");
        }
        if (ovrEl) {
          ovrEl.textContent = formatAbilityForDisplay(player.currentOverall ?? player.rating);
          ovrEl.classList.add("is-flash");
          setTimeout(() => ovrEl.classList.remove("is-flash"), 400);
        }
        if (nextBtn) {
          nextBtn.classList.remove("hidden");
          nextBtn.focus();
        }
      });
      choicesEl?.appendChild(btn);
    }

    if (nextBtn) {
      nextBtn.onclick = () => {
        finish({ ok: true, choiceId: pending.chosenOptionId, result: lastResult });
      };
    }

    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("senior-scenario-open");
    choicesEl?.querySelector("button")?.focus();
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
