/**
 * UI contract checks for league dashboard + cup/continental skip wiring.
 * Run: node tests/simulationDashboardUi.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function test(name, fn) {
  try {
    fn();
    console.log(`OK  ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

const html = readFileSync(join(root, "index.html"), "utf8");
const dashJs = readFileSync(join(root, "js/ui/simulationDashboard.js"), "utf8");
const animJs = readFileSync(join(root, "js/ui/seasonAnimation.js"), "utf8");
const css = readFileSync(join(root, "style.css"), "utf8");

test("dashboard skip buttons use dedicated sim-* IDs", () => {
  assert.match(html, /id="sim-skip-match-btn"/);
  assert.match(html, /id="sim-skip-phase-btn"/);
  assert.doesNotMatch(html, /id="match-skip-btn-legacy"/);
  assert.match(dashJs, /sim-skip-match-btn/);
  assert.match(dashJs, /sim-skip-phase-btn/);
  // Dashboard must not bind the cup/continental skip IDs
  assert.doesNotMatch(dashJs, /\$\("match-skip-btn"\)/);
  assert.doesNotMatch(dashJs, /\$\("match-skip-phase-btn"\)/);
});

test("cup/continental skip bar owns match-skip-btn IDs inside match viewer", () => {
  assert.match(html, /id="match-skip-bar"/);
  assert.match(html, /id="match-skip-btn"/);
  assert.match(html, /id="match-skip-phase-btn"/);
  // Skip controls live inside the match viewer header (always on-screen with the scoreboard)
  const viewerIdx = html.indexOf('id="match-viewer-section"');
  const skipIdx = html.indexOf('id="match-skip-bar"');
  assert.ok(skipIdx > viewerIdx, "skip bar must be inside match viewer section");
  assert.match(animJs, /getElementById\("match-skip-btn"\)/);
  assert.match(animJs, /getElementById\("match-skip-phase-btn"\)/);
  assert.match(animJs, /wireSkipControls\(\)/);
  assert.match(animJs, /setSkipBarVisible\(true\)/);
});

test("competition tab flicker removed from live league UI", () => {
  assert.match(html, /sim-comp-menu[^>]*hidden/);
  assert.doesNotMatch(html, /data-view="cup"/);
  assert.doesNotMatch(html, /data-view="continental"/);
  assert.doesNotMatch(html, /data-view="national"/);
  assert.match(dashJs, /setCompetitionMenuVisible\(false\)/);
});

test("match card rail is a vertical newest-on-top column", () => {
  assert.match(css, /\.match-card-rail\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(dashJs, /rail\.prepend\(card\)/);
  assert.match(dashJs, /Newest match on top/);
});

if (!process.exitCode) console.log("\nAll simulationDashboard UI contract tests passed.");
