/**
 * Edition-specific national knockout bracket definitions and third-place allocations.
 * Sources cited per competition; do not invent pairings.
 */

import { ANNEX_C_ROWS, ANNEX_C_WINNERS } from "./worldCupAnnexC.js";

/** EURO Article 21.03 fixed R16 skeleton (W/R/3 slots). */
export const EURO_R16_SKELETON = Object.freeze([
  { matchKey: "r16-1", home: { type: "winner", group: "B" }, away: { type: "third", slot: "WB" } },
  { matchKey: "r16-2", home: { type: "winner", group: "A" }, away: { type: "runner", group: "C" } },
  { matchKey: "r16-3", home: { type: "winner", group: "F" }, away: { type: "third", slot: "WF" } },
  { matchKey: "r16-4", home: { type: "runner", group: "D" }, away: { type: "runner", group: "E" } },
  { matchKey: "r16-5", home: { type: "winner", group: "E" }, away: { type: "third", slot: "WE" } },
  { matchKey: "r16-6", home: { type: "winner", group: "D" }, away: { type: "runner", group: "F" } },
  { matchKey: "r16-7", home: { type: "winner", group: "C" }, away: { type: "third", slot: "WC" } },
  { matchKey: "r16-8", home: { type: "runner", group: "A" }, away: { type: "runner", group: "B" } },
]);

/**
 * UEFA EURO Article 21.04 — allocation of four best thirds to WB/WC/WE/WF.
 * Source: Regulations of the UEFA European Football Championship 2026–28, Article 21.
 * https://documents.uefa.com/r/Regulations-of-the-UEFA-European-Football-Championship-2026-28/Article-21-Match-system-final-tournament-knockout-stage-Online
 */
export const EURO_ARTICLE_21 = Object.freeze([
  { thirds: "ABCD", WB: "A", WC: "D", WE: "B", WF: "C" },
  { thirds: "ABCE", WB: "A", WC: "E", WE: "B", WF: "C" },
  { thirds: "ABCF", WB: "A", WC: "F", WE: "B", WF: "C" },
  { thirds: "ABDE", WB: "D", WC: "E", WE: "A", WF: "B" },
  { thirds: "ABDF", WB: "D", WC: "F", WE: "A", WF: "B" },
  { thirds: "ABEF", WB: "E", WC: "F", WE: "B", WF: "A" },
  { thirds: "ACDE", WB: "E", WC: "D", WE: "C", WF: "A" },
  { thirds: "ACDF", WB: "F", WC: "D", WE: "C", WF: "A" },
  { thirds: "ACEF", WB: "E", WC: "F", WE: "C", WF: "A" },
  { thirds: "ADEF", WB: "E", WC: "F", WE: "D", WF: "A" },
  { thirds: "BCDE", WB: "E", WC: "D", WE: "B", WF: "C" },
  { thirds: "BCDF", WB: "F", WC: "D", WE: "C", WF: "B" },
  { thirds: "BCEF", WB: "F", WC: "E", WE: "C", WF: "B" },
  { thirds: "BDEF", WB: "F", WC: "E", WE: "D", WF: "B" },
  { thirds: "CDEF", WB: "F", WC: "E", WE: "D", WF: "C" },
]);

export const EURO_QF_FEEDERS = Object.freeze([
  { matchKey: "qf-1", home: { type: "winnerOf", matchKey: "r16-1" }, away: { type: "winnerOf", matchKey: "r16-2" } },
  { matchKey: "qf-2", home: { type: "winnerOf", matchKey: "r16-3" }, away: { type: "winnerOf", matchKey: "r16-4" } },
  { matchKey: "qf-3", home: { type: "winnerOf", matchKey: "r16-5" }, away: { type: "winnerOf", matchKey: "r16-6" } },
  { matchKey: "qf-4", home: { type: "winnerOf", matchKey: "r16-7" }, away: { type: "winnerOf", matchKey: "r16-8" } },
]);

export const EURO_SF_FEEDERS = Object.freeze([
  { matchKey: "sf-1", home: { type: "winnerOf", matchKey: "qf-1" }, away: { type: "winnerOf", matchKey: "qf-2" } },
  { matchKey: "sf-2", home: { type: "winnerOf", matchKey: "qf-3" }, away: { type: "winnerOf", matchKey: "qf-4" } },
]);

export const EURO_FINAL = Object.freeze({
  matchKey: "final",
  home: { type: "winnerOf", matchKey: "sf-1" },
  away: { type: "winnerOf", matchKey: "sf-2" },
});

/**
 * FIFA WC 2026 R32 fixed pairings (Article 12.6).
 * Third-place slots resolve via Annex C.
 */
export const WC_R32_SKELETON = Object.freeze([
  { matchKey: "m73", home: { type: "runner", group: "A" }, away: { type: "runner", group: "B" } },
  { matchKey: "m74", home: { type: "winner", group: "E" }, away: { type: "third", winnerCol: "E" } },
  { matchKey: "m75", home: { type: "winner", group: "F" }, away: { type: "runner", group: "C" } },
  { matchKey: "m76", home: { type: "winner", group: "C" }, away: { type: "runner", group: "F" } },
  { matchKey: "m77", home: { type: "winner", group: "I" }, away: { type: "third", winnerCol: "I" } },
  { matchKey: "m78", home: { type: "runner", group: "E" }, away: { type: "runner", group: "I" } },
  { matchKey: "m79", home: { type: "winner", group: "A" }, away: { type: "third", winnerCol: "A" } },
  { matchKey: "m80", home: { type: "winner", group: "L" }, away: { type: "third", winnerCol: "L" } },
  { matchKey: "m81", home: { type: "winner", group: "D" }, away: { type: "third", winnerCol: "D" } },
  { matchKey: "m82", home: { type: "winner", group: "G" }, away: { type: "third", winnerCol: "G" } },
  { matchKey: "m83", home: { type: "runner", group: "K" }, away: { type: "runner", group: "L" } },
  { matchKey: "m84", home: { type: "winner", group: "H" }, away: { type: "runner", group: "J" } },
  { matchKey: "m85", home: { type: "winner", group: "B" }, away: { type: "third", winnerCol: "B" } },
  { matchKey: "m86", home: { type: "winner", group: "J" }, away: { type: "runner", group: "H" } },
  { matchKey: "m87", home: { type: "winner", group: "K" }, away: { type: "third", winnerCol: "K" } },
  { matchKey: "m88", home: { type: "runner", group: "D" }, away: { type: "runner", group: "G" } },
]);

/** Subsequent WC knockout feeders (paired winners of adjacent R32 ties). */
export const WC_R16_FEEDERS = Object.freeze([
  { matchKey: "r16-1", home: { type: "winnerOf", matchKey: "m73" }, away: { type: "winnerOf", matchKey: "m74" } },
  { matchKey: "r16-2", home: { type: "winnerOf", matchKey: "m75" }, away: { type: "winnerOf", matchKey: "m76" } },
  { matchKey: "r16-3", home: { type: "winnerOf", matchKey: "m77" }, away: { type: "winnerOf", matchKey: "m78" } },
  { matchKey: "r16-4", home: { type: "winnerOf", matchKey: "m79" }, away: { type: "winnerOf", matchKey: "m80" } },
  { matchKey: "r16-5", home: { type: "winnerOf", matchKey: "m81" }, away: { type: "winnerOf", matchKey: "m82" } },
  { matchKey: "r16-6", home: { type: "winnerOf", matchKey: "m83" }, away: { type: "winnerOf", matchKey: "m84" } },
  { matchKey: "r16-7", home: { type: "winnerOf", matchKey: "m85" }, away: { type: "winnerOf", matchKey: "m86" } },
  { matchKey: "r16-8", home: { type: "winnerOf", matchKey: "m87" }, away: { type: "winnerOf", matchKey: "m88" } },
]);

export const WC_QF_FEEDERS = Object.freeze([
  { matchKey: "qf-1", home: { type: "winnerOf", matchKey: "r16-1" }, away: { type: "winnerOf", matchKey: "r16-2" } },
  { matchKey: "qf-2", home: { type: "winnerOf", matchKey: "r16-3" }, away: { type: "winnerOf", matchKey: "r16-4" } },
  { matchKey: "qf-3", home: { type: "winnerOf", matchKey: "r16-5" }, away: { type: "winnerOf", matchKey: "r16-6" } },
  { matchKey: "qf-4", home: { type: "winnerOf", matchKey: "r16-7" }, away: { type: "winnerOf", matchKey: "r16-8" } },
]);

export const WC_SF_FEEDERS = Object.freeze([
  { matchKey: "sf-1", home: { type: "winnerOf", matchKey: "qf-1" }, away: { type: "winnerOf", matchKey: "qf-2" } },
  { matchKey: "sf-2", home: { type: "winnerOf", matchKey: "qf-3" }, away: { type: "winnerOf", matchKey: "qf-4" } },
]);

export const WC_FINAL = Object.freeze({
  matchKey: "final",
  home: { type: "winnerOf", matchKey: "sf-1" },
  away: { type: "winnerOf", matchKey: "sf-2" },
});

export const WC_THIRD_PLACE = Object.freeze({
  matchKey: "third-place",
  home: { type: "loserOf", matchKey: "sf-1" },
  away: { type: "loserOf", matchKey: "sf-2" },
});

const euroLookup = new Map(EURO_ARTICLE_21.map((r) => [r.thirds, r]));
const annexCLookup = (() => {
  const map = new Map();
  for (const row of ANNEX_C_ROWS) {
    const key = [...row].sort().join("");
    const assignment = {};
    ANNEX_C_WINNERS.forEach((w, i) => {
      assignment[w] = row[i];
    });
    map.set(key, assignment);
  }
  return map;
})();

export function allocateEuroThirds(thirdGroupLetters) {
  const key = [...thirdGroupLetters].sort().join("");
  const row = euroLookup.get(key);
  if (!row) {
    throw new Error(`EURO Article 21: no allocation for thirds ${key}`);
  }
  return { WB: row.WB, WC: row.WC, WE: row.WE, WF: row.WF, key };
}

export function allocateWorldCupThirds(thirdGroupLetters) {
  const key = [...thirdGroupLetters].sort().join("");
  const assignment = annexCLookup.get(key);
  if (!assignment) {
    throw new Error(`FIFA Annex C: no allocation for thirds ${key}`);
  }
  return { assignment, key };
}

export function allEuroThirdCombinations() {
  return EURO_ARTICLE_21.map((r) => r.thirds);
}

export function allWorldCupThirdCombinations() {
  return ANNEX_C_ROWS.map((row) => [...row].sort().join(""));
}

export { ANNEX_C_ROWS, ANNEX_C_WINNERS };
