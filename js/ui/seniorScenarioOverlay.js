/**
 * Text-led senior career scene overlay (academy-style presentation).
 */
import {
  buildSeniorScenarioFeedback,
  formatSeniorScenarioContextLine,
  resolveSeniorScenarioChoice,
} from "../simulation/seniorCareerScenarios.js?v=88";
import { formatAbilityForDisplay, roundAbilityForDisplay } from "./abilityFormatting.js";
import { getBaseOverall, getCurrentOverall, refreshAbilityCaches } from "../simulation/playerAbility.js";

/**
 * Show a pending senior scenario and resolve on choice + Continue.
 * Restores a resolved result screen when pending.resolved is already true.
 * @returns {Promise<{ok:boolean, choiceId?:string, result?:object}>}
 */
export function showSeniorScenarioOverlay(player, pending, { onResolved, onPlayerUpdated } = {}) {
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

    refreshAbilityCaches(player);
    const paintAbility = () => {
      if (!ovrEl) return;
      // Headline matches the player card: current overall.
      const current = roundAbilityForDisplay(getCurrentOverall(player));
      const base = roundAbilityForDisplay(getBaseOverall(player));
      ovrEl.textContent =
        base != null && current != null && base !== current
          ? `OVR ${formatAbilityForDisplay(current)} · Base ${formatAbilityForDisplay(base)}`
          : `OVR ${formatAbilityForDisplay(current ?? base)}`;
    };
    paintAbility();
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

    const showResult = (result) => {
      lastResult = result;
      for (const b of choicesEl?.querySelectorAll("button") || []) {
        b.disabled = true;
        if (b.dataset.choiceId === pending.chosenOptionId) {
          b.classList.add("career-choice-selected");
        }
      }
      if (outcomeEl) {
        outcomeEl.textContent = buildSeniorScenarioFeedback(
          result.outcome,
          result.badges,
          result.abilityReceipt
        );
        outcomeEl.classList.remove("hidden");
      }
      if (badgesEl && result.badges?.length) {
        badgesEl.innerHTML = result.badges
          .map((b) => `<span class="senior-effect-badge">${escapeHtml(b)}</span>`)
          .join("");
        badgesEl.classList.remove("hidden");
      }
      paintAbility();
      ovrEl?.classList.add("is-flash");
      setTimeout(() => ovrEl?.classList.remove("is-flash"), 400);
      if (typeof onPlayerUpdated === "function") onPlayerUpdated(player);
      if (nextBtn) {
        nextBtn.classList.remove("hidden");
        nextBtn.focus();
      }
    };

    // Restore resolved-but-not-continued result screen.
    if (pending.resolved && pending.sampledOutcome) {
      for (const choice of pending.choices || []) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "primary career-choice-btn";
        btn.textContent = choice.label;
        btn.dataset.choiceId = choice.id;
        btn.disabled = true;
        if (choice.id === pending.chosenOptionId) btn.classList.add("career-choice-selected");
        choicesEl?.appendChild(btn);
      }
      showResult({
        ok: true,
        duplicate: true,
        outcome: pending.sampledOutcome,
        badges: pending.badges || [],
        abilityReceipt: pending.abilityReceipt,
      });
    } else {
      for (const choice of pending.choices || []) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "primary career-choice-btn";
        btn.textContent = choice.label;
        btn.dataset.choiceId = choice.id;
        btn.addEventListener("click", () => {
          if (settled || lastResult) return;
          const result = resolveSeniorScenarioChoice(player, pending, choice.id);
          if (!result.ok) {
            if (outcomeEl) {
              outcomeEl.textContent = "Something went wrong resolving this moment. Please try again.";
              outcomeEl.classList.remove("hidden");
            }
            return;
          }
          showResult(result);
        });
        choicesEl?.appendChild(btn);
      }
    }

    if (nextBtn) {
      nextBtn.onclick = () => {
        // Clear pending only when continuing chronology.
        if (player.pendingSeniorScenario === pending) {
          player.pendingSeniorScenario = null;
        }
        finish({ ok: true, choiceId: pending.chosenOptionId, result: lastResult });
      };
    }

    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("senior-scenario-open");
    if (!pending.resolved) choicesEl?.querySelector("button")?.focus();
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
