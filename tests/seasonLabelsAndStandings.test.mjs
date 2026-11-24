import { test } from "node:test";
import assert from "node:assert/strict";
import {
  seasonSelectorYearLabel,
  seasonSelectorText,
  standingQualifierLines,
} from "../js/ui/rendering.js";

const player = { startYear: 2026 };

test("selector shows season number and canonical year for ordinary senior seasons", () => {
  const s = { seasonNumber: 2, age: 19, club: "Hull City" };
  const yearText = seasonSelectorYearLabel(s, player);
  assert.equal(yearText, "2027/28");
  assert.equal(seasonSelectorText(1, yearText), "Season 2 (2027/28)");
});

test("selector prefers an explicit season label and a numeric year", () => {
  assert.equal(seasonSelectorYearLabel({ seasonLabel: "2029/30" }, player), "2029/30");
  assert.equal(seasonSelectorYearLabel({ year: 2031 }, player), "2031/32");
});

test("selector never renders empty year parentheses for records without identity", () => {
  const yearText = seasonSelectorYearLabel({ seasonNumber: 1 }, { startYear: undefined });
  assert.equal(yearText, null);
  assert.equal(seasonSelectorText(0, yearText), "Season 1");
  assert.ok(!seasonSelectorText(0, yearText).includes("()"));
  assert.ok(!seasonSelectorText(0, seasonSelectorYearLabel({ seasonLabel: "  " }, null)).includes("()"));
});

test("academy and free-agent periods use the same year identity as the season card", () => {
  const academy = { seasonNumber: 1, year: 2026 };
  assert.equal(seasonSelectorText(0, seasonSelectorYearLabel(academy, player)), "Season 1 (2026/27)");
  const freeAgent = { seasonNumber: 3 };
  assert.equal(seasonSelectorText(2, seasonSelectorYearLabel(freeAgent, player)), "Season 3 (2028/29)");
});

test("legacy records with an empty string label fall back to the start-year derivation", () => {
  const legacy = { seasonNumber: 1, seasonLabel: "" };
  assert.equal(seasonSelectorYearLabel(legacy, player), "2026/27");
});

test("a promotion is rendered once when qualification and divisionMove describe the same move", () => {
  const team = { qualification: "Promoted", divisionMove: "promoted" };
  assert.deepEqual(standingQualifierLines(team), ["Promoted"]);
});

test("a relegation is rendered once when qualification and divisionMove describe the same move", () => {
  const team = { qualification: "Relegated", divisionMove: "relegated" };
  assert.deepEqual(standingQualifierLines(team), ["Relegated"]);
});

test("divisionMove alone still labels the move once", () => {
  assert.deepEqual(standingQualifierLines({ divisionMove: "promoted" }), ["Promoted"]);
  assert.deepEqual(standingQualifierLines({ divisionMove: "relegated" }), ["Relegated"]);
});

test("provisional live tables add the provisional marker to the qualification only", () => {
  const team = { qualification: "Promoted", divisionMove: "promoted" };
  assert.deepEqual(standingQualifierLines(team, { live: true }), ["Promoted · provisional"]);
});

test("qualification text without a division move is kept as-is", () => {
  assert.deepEqual(
    standingQualifierLines({ qualification: "Champions League" }),
    ["Champions League"]
  );
  assert.deepEqual(standingQualifierLines({}), []);
});
