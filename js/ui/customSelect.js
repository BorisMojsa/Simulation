/**
 * Accessible custom select that matches site styling.
 * Supports optional leading images (e.g. nation flags).
 */

function closeAllExcept(exceptRoot) {
  document.querySelectorAll(".custom-select.is-open").forEach((root) => {
    if (root !== exceptRoot) setOpen(root, false);
  });
}

function setOpen(root, open) {
  const trigger = root.querySelector(".custom-select-trigger");
  const menu = root.querySelector(".custom-select-menu");
  if (!trigger || !menu) return;
  root.classList.toggle("is-open", open);
  trigger.setAttribute("aria-expanded", open ? "true" : "false");
  menu.hidden = !open;
  if (open) {
    const selected = menu.querySelector('[aria-selected="true"]') || menu.querySelector("[role='option']");
    selected?.focus?.();
  }
}

function setValue(root, value, labelHtml, labelText) {
  const hidden = root.querySelector('input[type="hidden"]');
  const valueEl = root.querySelector(".custom-select-value");
  const trigger = root.querySelector(".custom-select-trigger");
  if (hidden) {
    hidden.value = value;
    hidden.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (valueEl) valueEl.innerHTML = labelHtml;
  trigger?.classList.toggle("is-placeholder", !value);
  root.querySelectorAll('[role="option"]').forEach((opt) => {
    opt.setAttribute("aria-selected", opt.dataset.value === value ? "true" : "false");
  });
  root.dataset.value = value;
  if (labelText) root.dataset.label = labelText;
}

export function initCustomSelect(root, { options, placeholder, required = false } = {}) {
  if (!root || root.dataset.ready === "1") return;

  const name = root.dataset.name;
  const listId = `${name}-listbox`;

  root.innerHTML = `
    <button type="button" class="custom-select-trigger is-placeholder" aria-haspopup="listbox" aria-expanded="false" aria-controls="${listId}">
      <span class="custom-select-value">${placeholder}</span>
      <span class="custom-select-chevron" aria-hidden="true"></span>
    </button>
    <ul class="custom-select-menu" id="${listId}" role="listbox" hidden></ul>
    <input type="hidden" name="${name}" id="${name}" value="" ${required ? "required" : ""} />
  `;

  const menu = root.querySelector(".custom-select-menu");
  const trigger = root.querySelector(".custom-select-trigger");

  options.forEach((opt) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.tabIndex = -1;
    li.dataset.value = opt.value;
    li.setAttribute("aria-selected", "false");
    li.innerHTML = opt.html;
    li.addEventListener("click", () => {
      setValue(root, opt.value, opt.html, opt.label);
      setOpen(root, false);
      trigger.focus();
    });
    menu.appendChild(li);
  });

  trigger.addEventListener("click", () => {
    const willOpen = !root.classList.contains("is-open");
    closeAllExcept(root);
    setOpen(root, willOpen);
  });

  trigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      closeAllExcept(root);
      setOpen(root, true);
    }
  });

  menu.addEventListener("keydown", (event) => {
    const optionsEls = [...menu.querySelectorAll('[role="option"]')];
    const current = document.activeElement;
    const idx = optionsEls.indexOf(current);
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(root, false);
      trigger.focus();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      optionsEls[Math.min(idx + 1, optionsEls.length - 1)]?.focus();
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      optionsEls[Math.max(idx - 1, 0)]?.focus();
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      current?.click();
    }
  });

  root.dataset.ready = "1";
}

export function initCustomSelectOutsideClose() {
  if (document.documentElement.dataset.customSelectOutside === "1") return;
  document.documentElement.dataset.customSelectOutside = "1";
  document.addEventListener("click", (event) => {
    if (event.target.closest(".custom-select")) return;
    closeAllExcept(null);
  });
}

export function getCustomSelectValue(name) {
  const input = document.getElementById(name);
  return input ? String(input.value || "").trim() : "";
}

export function customSelectsAreValid(names) {
  return names.every((name) => Boolean(getCustomSelectValue(name)));
}
