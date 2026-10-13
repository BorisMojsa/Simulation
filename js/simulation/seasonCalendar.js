/**
 * Minimal dated event queue for a simulated season.
 * Dates are declared simulation calendar days — not published real fixtures.
 */

function pad(n) {
  return String(n).padStart(2, "0");
}

/** Build YYYY-MM-DD in a fixed simulated year (no wall-clock). */
export function simDate(year, month, day) {
  const y = Number(year);
  const m = clampInt(month, 1, 12);
  const dim = daysInMonth(y, m);
  const d = clampInt(day, 1, dim);
  return `${y}-${pad(m)}-${pad(d)}`;
}

function clampInt(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(Number(v) || lo)));
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(isoDate, days) {
  const [y, m, d] = String(isoDate).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + Number(days || 0));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function daysBetween(a, b) {
  const [ay, am, ad] = String(a).split("-").map(Number);
  const [by, bm, bd] = String(b).split("-").map(Number);
  const da = Date.UTC(ay, am - 1, ad);
  const db = Date.UTC(by, bm - 1, bd);
  return Math.round((db - da) / 86400000);
}

/**
 * Assign chronological dates to league fixtures across Aug–May.
 */
export function dateLeagueFixtures(fixtures, seasonStartYear) {
  const n = fixtures.length;
  if (!n) return [];
  const start = simDate(seasonStartYear, 8, 12);
  const end = simDate(seasonStartYear + 1, 5, 18);
  const span = Math.max(1, daysBetween(start, end));
  return fixtures.map((fx, i) => {
    const t = n === 1 ? 0 : i / (n - 1);
    const date = addDays(start, Math.round(t * span));
    return { ...fx, date, competitionType: "league", sortKey: `${date}:L:${i}` };
  });
}

/**
 * Spread cup rounds across the season after league MD dates exist.
 */
export function dateCupRounds(rounds, seasonStartYear) {
  // Typical domestic cup: Sep / Oct / Dec / Jan / Mar / May
  const anchors = [
    simDate(seasonStartYear, 9, 20),
    simDate(seasonStartYear, 10, 28),
    simDate(seasonStartYear, 12, 10),
    simDate(seasonStartYear + 1, 1, 22),
    simDate(seasonStartYear + 1, 3, 8),
    simDate(seasonStartYear + 1, 5, 12),
  ];
  return (rounds || []).map((round, i) => {
    const date = anchors[Math.min(i, anchors.length - 1)];
    return { ...round, date, competitionType: "domesticCup", sortKey: `${date}:C:${i}` };
  });
}

export function dateContinentalMatches(matches, seasonStartYear) {
  const start = simDate(seasonStartYear, 9, 16);
  const end = simDate(seasonStartYear + 1, 5, 28);
  const list = matches || [];
  const span = Math.max(1, daysBetween(start, end));
  return list.map((m, i) => {
    const t = list.length <= 1 ? 0.5 : i / (list.length - 1);
    const date = addDays(start, Math.round(t * span));
    return { ...m, date, competitionType: "continental", sortKey: `${date}:E:${i}` };
  });
}

export function dateInternationalWindows(matches, calendarYear) {
  // Rough international windows; simulation policy dates.
  const windows = [
    simDate(calendarYear, 9, 5),
    simDate(calendarYear, 10, 10),
    simDate(calendarYear, 11, 14),
    simDate(calendarYear + 1, 3, 22),
    simDate(calendarYear + 1, 6, 12),
  ];
  return (matches || []).map((m, i) => {
    const date = windows[Math.min(i, windows.length - 1)];
    return { ...m, date, competitionType: "international", sortKey: `${date}:I:${i}` };
  });
}

/** Sort any dated events into chronological order. */
export function sortChronological(events) {
  return [...events].sort((a, b) => {
    const da = a.date || a.sortKey || "";
    const db = b.date || b.sortKey || "";
    if (da < db) return -1;
    if (da > db) return 1;
    return String(a.sortKey || "").localeCompare(String(b.sortKey || ""));
  });
}

/**
 * @deprecated Use squadReviewCheckpointDate(leagueId, seasonStartYear) —
 * 10 January is a European mid-season REVIEW default, not a universal transfer window.
 */
export function winterWindowDate(seasonStartYear) {
  return simDate(seasonStartYear + 1, 1, 10);
}
