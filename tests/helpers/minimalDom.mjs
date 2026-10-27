/**
 * Minimal DOM shim for Node presentation tests (no jsdom dependency).
 * Covers the element APIs used by seasonAnimation + appendSeasonCard.
 */

class FakeClassList {
  constructor(initial = []) {
    this._set = new Set(initial);
  }
  add(...names) {
    names.flat().filter(Boolean).forEach((n) => this._set.add(n));
  }
  remove(...names) {
    names.flat().filter(Boolean).forEach((n) => this._set.delete(n));
  }
  contains(name) {
    return this._set.has(name);
  }
  toggle(name, force) {
    if (force === true) this._set.add(name);
    else if (force === false) this._set.delete(name);
    else if (this._set.has(name)) this._set.delete(name);
    else this._set.add(name);
    return this._set.has(name);
  }
  toString() {
    return [...this._set].join(" ");
  }
}

export class FakeElement {
  constructor(id = "", tagName = "div") {
    this.id = id;
    this.tagName = String(tagName).toUpperCase();
    this.classList = new FakeClassList(id.includes("overlay") || id.includes("animation") || id.includes("section") || id.includes("continue") || id.includes("recap") || id.includes("reveal") || id.includes("dashboard") || id.includes("viewer") || id.includes("skip") ? ["hidden"] : []);
    this.innerHTML = "";
    this._text = "";
    this.onclick = null;
    this.children = [];
    this.style = {};
    this.attributes = {};
    this.parentNode = null;
    this.content = null;
  }

  get textContent() {
    return this._text;
  }
  set textContent(v) {
    this._text = v == null ? "" : String(v);
    this.innerHTML = this._text;
  }

  get className() {
    return this.classList.toString();
  }
  set className(v) {
    this.classList = new FakeClassList(String(v || "").split(/\s+/).filter(Boolean));
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
  querySelector(sel) {
    if (sel === "header") return this._header || (this._header = new FakeElement("", "header"));
    if (sel === ".summary") return this._summary || (this._summary = new FakeElement("", "dl"));
    if (sel === ".stats") return this._stats || (this._stats = new FakeElement("", "div"));
    return null;
  }
  querySelectorAll() {
    return [];
  }
  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }
  prepend(child) {
    this.children.unshift(child);
    child.parentNode = this;
    return child;
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
    this.parentNode = null;
  }
  click() {
    if (typeof this.onclick === "function") this.onclick({ preventDefault() {}, stopPropagation() {} });
  }
  addEventListener() {}
  removeEventListener() {}
  scrollIntoView() {}
}

const ANIMATION_IDS = [
  "season-animation-overlay",
  "simulation-dashboard",
  "match-viewer-section",
  "league-animation",
  "cup-animation",
  "european-animation",
  "international-callup-animation",
  "international-animation",
  "awards-animation",
  "trophies-animation",
  "summary-animation",
  "overall-reveal",
  "free-agent-recap",
  "free-agent-recap-info",
  "free-agent-recap-body",
  "animation-continue",
  "continue-btn",
  "match-skip-btn",
  "match-skip-phase-btn",
  "match-skip-bar",
  "match-card-rail",
  "league-table-host",
  "league-table-rows",
  "cup-rounds",
  "european-rounds",
  "international-tournaments",
  "international-announcement",
  "awards-items",
  "trophies-items",
  "player-stats-grid",
  "rating-changes-grid",
  "match-events-feed",
  "league-trophy-banner",
  "old-rating-value",
  "new-rating-value",
  "rating-change-text",
  "league-season-info",
  "cup-info",
  "european-info",
  "international-info",
  "international-callup-info",
  "awards-info",
  "trophies-info",
  "summary-info",
  "overall-info",
  "match-phase-label",
  "match-progress-label",
  "match-round-label",
  "match-home-name",
  "match-away-name",
  "match-home-badge",
  "match-away-badge",
  "match-home-score",
  "match-away-score",
  "match-clock",
  "match-player-note",
  "sim-comp-menu",
  "sim-awaiting-banner",
  "sim-awaiting-text",
  "season-log",
  "player-overview",
  "transfer-offers",
  "standings-board",
  "competitions-board",
  "simulate-btn",
];

export function installMinimalDom(extraIds = []) {
  const elements = new Map();
  const ensure = (id, tag = "div") => {
    if (!elements.has(id)) {
      const el = new FakeElement(id, tag);
      if (id === "continue-btn" || id === "simulate-btn" || id === "match-skip-btn" || id === "match-skip-phase-btn") {
        el.tagName = "BUTTON";
        el.disabled = false;
      }
      if (id === "season-animation-overlay" || id === "animation-continue" || id === "free-agent-recap") {
        el.classList.add("hidden");
      }
      elements.set(id, el);
    }
    return elements.get(id);
  };

  for (const id of [...ANIMATION_IDS, ...extraIds]) ensure(id);

  const template = new FakeElement("season-template", "template");
  template.content = {
    cloneNode() {
      const article = new FakeElement("", "article");
      article.className = "season-card";
      article._header = new FakeElement("", "header");
      article._summary = new FakeElement("", "dl");
      article._summary.className = "summary";
      article._stats = new FakeElement("", "div");
      article._stats.className = "stats";
      article.querySelector = (sel) => {
        if (sel === "header") return article._header;
        if (sel === ".summary") return article._summary;
        if (sel === ".stats") return article._stats;
        return null;
      };
      return article;
    },
  };
  elements.set("season-template", template);

  const doc = {
    getElementById(id) {
      return ensure(id);
    },
    querySelector(sel) {
      if (sel === ".rating-arrow") return ensure("rating-arrow");
      if (sel.startsWith("#")) return ensure(sel.slice(1));
      return null;
    },
    querySelectorAll() {
      return [];
    },
    createElement(tag) {
      return new FakeElement("", tag);
    },
    createTextNode(text) {
      const n = new FakeElement("", "#text");
      n.textContent = text;
      return n;
    },
  };

  globalThis.document = doc;
  globalThis.window = globalThis.window || globalThis;
  globalThis.HTMLElement = FakeElement;
  return { document: doc, elements, ensure };
}
