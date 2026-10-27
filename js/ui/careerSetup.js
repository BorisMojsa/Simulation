import { WORLD_CUP_NATIONS, flagUrl } from "../data/worldCupNations.js";

/** Setup positions with pitch anchors (%, from top-left). Attack is toward the top. */
export const POSITION_OPTIONS = [
  { value: "ST", label: "Striker", x: 50, y: 11 },
  { value: "LW", label: "Left Winger", x: 16, y: 24 },
  { value: "RW", label: "Right Winger", x: 84, y: 24 },
  { value: "CAM", label: "Attacking Midfielder", x: 50, y: 34 },
  { value: "LM", label: "Left Midfielder", x: 16, y: 49 },
  { value: "CM", label: "Central Midfielder", x: 50, y: 49 },
  { value: "RM", label: "Right Midfielder", x: 84, y: 49 },
  { value: "CDM", label: "Defensive Midfielder", x: 50, y: 64 },
  { value: "LB", label: "Left Back", x: 16, y: 79 },
  { value: "CB", label: "Centre Back", x: 50, y: 79 },
  { value: "RB", label: "Right Back", x: 84, y: 79 },
  { value: "GK", label: "Goalkeeper", x: 50, y: 92 },
];

export const STARTING_AGES = [15, 16, 17, 18, 19];

const NATION_NAMES = new Set(WORLD_CUP_NATIONS.map((n) => n.name));
const POSITION_CODES = new Set(POSITION_OPTIONS.map((p) => p.value));
const POSITION_BY_CODE = new Map(POSITION_OPTIONS.map((p) => [p.value, p]));

function pitchSvgMarkup() {
  return `
    <svg class="career-setup-pitch-svg" viewBox="0 0 100 150" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <pattern id="career-pitch-stripes" patternUnits="userSpaceOnUse" width="100" height="12">
          <rect width="100" height="6" fill="rgba(255,255,255,0.03)" />
        </pattern>
      </defs>
      <rect class="career-setup-pitch-turf" x="0" y="0" width="100" height="150" />
      <rect x="0" y="0" width="100" height="150" fill="url(#career-pitch-stripes)" />
      <rect class="career-setup-pitch-line" x="2" y="2" width="96" height="146" fill="none" stroke-width="0.7" />
      <line class="career-setup-pitch-line" x1="2" y1="75" x2="98" y2="75" stroke-width="0.6" />
      <circle class="career-setup-pitch-line" cx="50" cy="75" r="12" fill="none" stroke-width="0.6" />
      <circle class="career-setup-pitch-dot" cx="50" cy="75" r="1.1" />
      <rect class="career-setup-pitch-line" x="22" y="2" width="56" height="22" fill="none" stroke-width="0.6" />
      <rect class="career-setup-pitch-line" x="34" y="2" width="32" height="10" fill="none" stroke-width="0.55" />
      <rect class="career-setup-pitch-line" x="22" y="126" width="56" height="22" fill="none" stroke-width="0.6" />
      <rect class="career-setup-pitch-line" x="34" y="138" width="32" height="10" fill="none" stroke-width="0.55" />
      <path class="career-setup-pitch-line" d="M 38 24 A 12 12 0 0 0 62 24" fill="none" stroke-width="0.55" />
      <path class="career-setup-pitch-line" d="M 38 126 A 12 12 0 0 1 62 126" fill="none" stroke-width="0.55" />
    </svg>
  `.trim();
}

function setText(el, text) {
  if (el) el.textContent = text;
}

function showError(el, message) {
  if (!el) return;
  el.textContent = message;
  el.hidden = !message;
}

function clearError(el) {
  showError(el, "");
}

function updateSelectedLines(form) {
  const nationality = form.querySelector('input[name="nationality"]:checked')?.value || "";
  const position = form.querySelector('input[name="primary-position"]:checked')?.value || "";
  const age = form.querySelector('input[name="starting-age"]:checked')?.value || "";
  const name = String(form.querySelector("#player-name")?.value ?? "").trim();

  const nationLine = form.querySelector("#selected-nationality-line");
  setText(nationLine, nationality ? `Selected nationality: ${nationality}` : "Selected nationality: —");

  const posMeta = POSITION_BY_CODE.get(position);
  const posLine = form.querySelector("#selected-position-line");
  setText(
    posLine,
    posMeta ? `Selected position: ${posMeta.value} — ${posMeta.label}` : "Selected position: —"
  );

  const summary = form.querySelector("#setup-summary");
  const parts = [];
  if (name) parts.push(name);
  if (age) parts.push(`age ${age}`);
  if (nationality) parts.push(nationality);
  if (posMeta) parts.push(posMeta.value);
  setText(summary, parts.length ? parts.join(" · ") : "Choose name, age, nationality, and position.");
}

function createFlagImage(code) {
  const img = document.createElement("img");
  img.className = "career-setup-flag";
  img.src = flagUrl(code, 80);
  img.srcset = `${flagUrl(code, 80)} 1x, ${flagUrl(code, 160)} 2x`;
  img.alt = "";
  img.width = 64;
  img.height = 44;
  img.loading = "lazy";
  img.decoding = "async";
  img.addEventListener(
    "error",
    () => {
      const fallback = document.createElement("span");
      fallback.className = "career-setup-flag-fallback";
      fallback.setAttribute("aria-hidden", "true");
      img.replaceWith(fallback);
    },
    { once: true }
  );
  return img;
}

function renderAgeChips(container) {
  container.replaceChildren();
  for (const age of STARTING_AGES) {
    const id = `starting-age-${age}`;
    const label = document.createElement("label");
    label.className = "career-setup-age-chip";
    label.htmlFor = id;

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "starting-age";
    input.id = id;
    input.value = String(age);
    input.className = "career-setup-visually-hidden";

    const text = document.createElement("span");
    text.className = "career-setup-age-chip-text";
    text.textContent = String(age);

    label.append(input, text);
    container.append(label);
  }
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

function renderNationGrid(container) {
  container.replaceChildren();
  for (const nation of WORLD_CUP_NATIONS) {
    const id = `nationality-${nation.code}`;
    const label = document.createElement("label");
    label.className = "career-setup-nation-card";
    label.htmlFor = id;
    label.dataset.nationName = nation.name;
    label.dataset.nationSearch = normalizeSearchText(nation.name);

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "nationality";
    input.id = id;
    input.value = nation.name;
    input.className = "career-setup-visually-hidden";

    const stage = document.createElement("span");
    stage.className = "career-setup-flag-stage";
    stage.append(createFlagImage(nation.code));

    const name = document.createElement("span");
    name.className = "career-setup-nation-name";
    name.textContent = nation.name;

    const check = document.createElement("span");
    check.className = "career-setup-nation-check";
    check.setAttribute("aria-hidden", "true");
    check.textContent = "✓";

    label.append(input, stage, name, check);
    container.append(label);
  }
}

/**
 * Filter nation cards in place. Checked nationality stays selected even when hidden.
 * @param {HTMLFormElement} form
 * @param {string} query
 * @param {{ keepFocus?: boolean }} [opts]
 */
function filterNationGrid(form, query, opts = {}) {
  const grid = form.querySelector("#nationality-grid");
  const emptyEl = form.querySelector("#nationality-empty");
  const clearBtn = form.querySelector("#nationality-search-clear");
  const searchInput = form.querySelector("#nationality-search");
  if (!grid) return;

  const needle = normalizeSearchText(query);
  const cards = grid.querySelectorAll(".career-setup-nation-card");
  let visible = 0;

  for (const card of cards) {
    const haystack = card.dataset.nationSearch || normalizeSearchText(card.dataset.nationName);
    const match = !needle || haystack.includes(needle);
    card.hidden = !match;
    if (match) visible += 1;
  }

  if (emptyEl) emptyEl.hidden = visible > 0 || !needle;
  if (clearBtn) clearBtn.hidden = !needle;
  searchInput?.setAttribute("aria-expanded", visible > 0 || !needle ? "true" : "false");

  if (opts.keepFocus && searchInput && document.activeElement !== searchInput) {
    searchInput.focus({ preventScroll: true });
  }
}

function bindNationSearch(form) {
  const searchInput = form.querySelector("#nationality-search");
  const clearBtn = form.querySelector("#nationality-search-clear");
  if (!searchInput) return;

  const apply = () => filterNationGrid(form, searchInput.value, { keepFocus: true });

  searchInput.addEventListener("input", apply);
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
    }
  });

  clearBtn?.addEventListener("click", () => {
    searchInput.value = "";
    filterNationGrid(form, "");
    searchInput.focus({ preventScroll: true });
  });
}

function renderPositionPitch(pitchEl) {
  pitchEl.replaceChildren();
  pitchEl.insertAdjacentHTML("afterbegin", pitchSvgMarkup());

  const markers = document.createElement("div");
  markers.className = "career-setup-pitch-markers";

  for (const pos of POSITION_OPTIONS) {
    const id = `primary-position-${pos.value}`;
    const label = document.createElement("label");
    label.className = "career-setup-pos-marker";
    label.htmlFor = id;
    label.style.left = `${pos.x}%`;
    label.style.top = `${pos.y}%`;
    label.title = pos.label;

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "primary-position";
    input.id = id;
    input.value = pos.value;
    input.className = "career-setup-visually-hidden";
    input.setAttribute("aria-label", `${pos.value} — ${pos.label}`);

    const code = document.createElement("span");
    code.className = "career-setup-pos-code";
    code.textContent = pos.value;

    const check = document.createElement("span");
    check.className = "career-setup-pos-check";
    check.setAttribute("aria-hidden", "true");
    check.textContent = "✓";

    label.append(input, code, check);
    markers.append(label);
  }

  pitchEl.append(markers);
}

/**
 * Mount visual career-setup controls into an existing setup form shell.
 * @param {HTMLFormElement} form
 */
export function initCareerSetup(form) {
  if (!form || form.dataset.careerSetupInit === "1") return;
  form.dataset.careerSetupInit = "1";

  const ageHost = form.querySelector("#starting-age-chips");
  const nationHost = form.querySelector("#nationality-grid");
  const pitchHost = form.querySelector("#position-pitch");

  if (ageHost) renderAgeChips(ageHost);
  if (nationHost) renderNationGrid(nationHost);
  if (pitchHost) renderPositionPitch(pitchHost);
  bindNationSearch(form);

  const refresh = () => updateSelectedLines(form);
  form.addEventListener("change", (event) => {
    const t = event.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (t.name === "nationality") clearError(form.querySelector("#nationality-error"));
    if (t.name === "primary-position") clearError(form.querySelector("#primary-position-error"));
    if (t.name === "starting-age") clearError(form.querySelector("#starting-age-error"));
    refresh();
  });
  form.querySelector("#player-name")?.addEventListener("input", () => {
    clearError(form.querySelector("#player-name-error"));
    refresh();
  });
  refresh();
}

/**
 * Read and strictly validate setup values.
 * @returns {{ ok: true, data: { name: string, nationality: string, position: string, age: number } }
 *   | { ok: false, errors: Record<string, string>, focus: HTMLElement | null }}
 */
export function readCareerSetupValues(form) {
  const formData = new FormData(form);
  const name = String(formData.get("player-name") ?? "").trim();
  const nationality = String(formData.get("nationality") ?? "");
  const position = String(formData.get("primary-position") ?? "");
  const ageRaw = String(formData.get("starting-age") ?? "");
  const age = Number(ageRaw);

  /** @type {Record<string, string>} */
  const errors = {};

  if (!name) {
    errors.name = "Enter a player name.";
  } else if (name.length > 30) {
    errors.name = "Name must be 30 characters or fewer.";
  }

  if (!ageRaw || !Number.isInteger(age) || !STARTING_AGES.includes(age)) {
    errors.age = "Choose a starting age.";
  }

  if (!nationality || !NATION_NAMES.has(nationality)) {
    errors.nationality = "Choose a nationality.";
  }

  if (!position || !POSITION_CODES.has(position)) {
    errors.position = "Choose a primary position.";
  }

  if (Object.keys(errors).length) {
    return { ok: false, errors, focus: firstInvalidControl(form, errors) };
  }

  return {
    ok: true,
    data: { name, nationality, position, age },
  };
}

function firstInvalidControl(form, errors) {
  if (errors.name) return form.querySelector("#player-name");
  if (errors.age) return form.querySelector('input[name="starting-age"]');
  if (errors.nationality) {
    const checked = form.querySelector('input[name="nationality"]:checked');
    if (checked && !checked.closest(".career-setup-nation-card")?.hidden) return checked;
    const firstVisible = [...form.querySelectorAll(".career-setup-nation-card")]
      .find((card) => !card.hidden)
      ?.querySelector('input[name="nationality"]');
    if (firstVisible) return firstVisible;
    return form.querySelector("#nationality-search") || checked || form.querySelector('input[name="nationality"]');
  }
  if (errors.position) {
    const checked = form.querySelector('input[name="primary-position"]:checked');
    return checked || form.querySelector('input[name="primary-position"]');
  }
  return null;
}

/**
 * Apply field errors and move focus to the first invalid control.
 * @param {HTMLFormElement} form
 * @param {Record<string, string>} errors
 * @param {HTMLElement | null} focusEl
 */
export function applyCareerSetupErrors(form, errors, focusEl) {
  showError(form.querySelector("#player-name-error"), errors.name || "");
  showError(form.querySelector("#starting-age-error"), errors.age || "");
  showError(form.querySelector("#nationality-error"), errors.nationality || "");
  showError(form.querySelector("#primary-position-error"), errors.position || "");

  form.querySelector("#player-name")?.setAttribute("aria-invalid", errors.name ? "true" : "false");

  if (focusEl && typeof focusEl.focus === "function") {
    focusEl.focus({ preventScroll: false });
    if (typeof focusEl.scrollIntoView === "function") {
      focusEl.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    // Nation / age / position radios: scroll the labeled card into view
    const card = focusEl.closest?.(".career-setup-nation-card, .career-setup-age-chip, .career-setup-pos-marker");
    card?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }
}

export function clearCareerSetupErrors(form) {
  applyCareerSetupErrors(form, {}, null);
}
