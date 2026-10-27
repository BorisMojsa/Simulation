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
 * Build a conflict-free double round-robin (circle method).
 * Returns fixtures grouped into rounds; each club appears once per round.
 */
export function buildRoundRobinRounds(clubs) {
  const list = [...(clubs || [])];
  if (list.length < 2) return [];
  const n = list.length;
  const working = [...list];
  if (n % 2 === 1) working.push(null); // bye
  const m = working.length;
  const roundsPerHalf = m - 1;
  const halfSize = m / 2;
  const firstHalf = [];

  for (let round = 0; round < roundsPerHalf; round++) {
    const pairs = [];
    for (let i = 0; i < halfSize; i++) {
      const home = working[i];
      const away = working[m - 1 - i];
      if (home && away) pairs.push({ home, away, round: round + 1 });
    }
    firstHalf.push(pairs);
    // Rotate all but first
    const fixed = working[0];
    const rest = working.slice(1);
    rest.unshift(rest.pop());
    working.splice(0, working.length, fixed, ...rest);
  }

  const secondHalf = firstHalf.map((pairs, ri) =>
    pairs.map((p) => ({
      home: p.away,
      away: p.home,
      round: roundsPerHalf + ri + 1,
    }))
  );
  return [...firstHalf, ...secondHalf];
}

/**
 * Flatten round-robin rounds into an ordered fixture list with stable IDs.
 */
export function flattenRoundRobinFixtures(clubs, opts = {}) {
  const rounds = buildRoundRobinRounds(clubs);
  const fixtures = [];
  const prefix = opts.idPrefix || "lg";
  rounds.forEach((pairs, ri) => {
    pairs.forEach((p, mi) => {
      fixtures.push({
        ...p,
        matchday: ri + 1,
        fixtureId:
          p.fixtureId ||
          `${prefix}:md${ri + 1}:${p.home.clubId || p.home.name}:${p.away.clubId || p.away.name}`,
      });
    });
  });
  return fixtures;
}

/**
 * Assign chronological dates to league fixtures across Aug–May.
 * When fixtures carry `matchday`/`round`, all matches on the same matchday share a date
 * so no club is double-booked.
 */
export function dateLeagueFixtures(fixtures, seasonStartYear) {
  const n = fixtures.length;
  if (!n) return [];
  const start = simDate(seasonStartYear, 8, 12);
  const end = simDate(seasonStartYear + 1, 5, 18);
  const span = Math.max(1, daysBetween(start, end));

  const matchdays = [...new Set(fixtures.map((fx) => fx.matchday || fx.round || null))];
  const hasMatchdays = matchdays.every((md) => md != null);
  if (hasMatchdays) {
    const sortedMds = [...new Set(matchdays)].sort((a, b) => a - b);
    const dateByMd = new Map();
    sortedMds.forEach((md, i) => {
      const t = sortedMds.length === 1 ? 0 : i / (sortedMds.length - 1);
      dateByMd.set(md, addDays(start, Math.round(t * span)));
    });
    return fixtures.map((fx, i) => {
      const md = fx.matchday || fx.round;
      const date = dateByMd.get(md);
      return {
        ...fx,
        date,
        competitionType: "league",
        sortKey: `${date}:L:${md}:${i}`,
      };
    });
  }

  // Legacy path: spread individually (may conflict — prefer round-robin input).
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

/**
 * Date international appearances.
 * Tournament finals windows sit in the edition summer (calendarYear for WC/EURO hosted that year).
 * Each match gets a distinct viable date — never collapse many fixtures onto one anchor day.
 */
export function dateInternationalWindows(matches, calendarYear, { editionYear = null } = {}) {
  const list = matches || [];
  if (!list.length) return [];
  const y = Number(editionYear || calendarYear);
  // Summer tournament block for the edition year, plus earlier international windows.
  const start = simDate(y, 6, 12);
  const end = simDate(y, 7, 18);
  const span = Math.max(list.length, daysBetween(start, end));
  return list.map((m, i) => {
    const t = list.length <= 1 ? 0 : i / (list.length - 1);
    const date = addDays(start, Math.round(t * Math.min(span, daysBetween(start, end))));
    return { ...m, date, competitionType: "international", sortKey: `${date}:I:${String(i).padStart(3, "0")}` };
  });
}

/** Sort any dated events into chronological order. */
export function sortChronological(events) {
  return [...events].sort(compareChronoEvents);
}

function compareChronoEvents(a, b) {
  const da = a.date || a.sortKey || "";
  const db = b.date || b.sortKey || "";
  if (da < db) return -1;
  if (da > db) return 1;
  const sk = String(a.sortKey || "").localeCompare(String(b.sortKey || ""));
  if (sk) return sk;
  return String(a.eventId || a.matchId || "").localeCompare(String(b.eventId || b.matchId || ""));
}

/**
 * Preserve the processed prefix (indices 0..processedThroughInclusive) and merge
 * only the unprocessed suffix with newEvents in global chronological order.
 * Deduplicates by stable eventId (preferred) or kind+matchId/sortKey.
 * Never sorts or reindexes the completed prefix.
 */
export function mergePendingEvents(ordered, processedThroughInclusive, newEvents) {
  if (!newEvents?.length) return ordered || [];
  const list = [...(ordered || [])];
  const cut = Math.max(-1, Number(processedThroughInclusive));
  const prefix = cut >= 0 ? list.slice(0, cut + 1) : [];
  const pending = cut >= 0 ? list.slice(cut + 1) : list;

  const idOf = (ev) =>
    ev?.eventId ||
    (ev?.matchId ? `${ev.kind || "fx"}:${ev.matchId}` : null) ||
    (ev?.kind === "continental_md" || ev?.kind === "national_md"
      ? `${ev.kind}:${ev.editionId || ""}:${ev.matchday}`
      : null) ||
    ev?.sortKey ||
    null;

  const seen = new Set();
  for (const ev of prefix) {
    const id = idOf(ev);
    if (id) seen.add(id);
  }
  for (const ev of pending) {
    const id = idOf(ev);
    if (id) seen.add(id);
  }

  const fresh = [];
  for (const ev of newEvents) {
    const id = idOf(ev);
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    fresh.push(ev);
  }
  if (!fresh.length) return list;

  const mergedPending = sortChronological([...pending, ...fresh]);
  return [...prefix, ...mergedPending];
}

/**
 * @deprecated Use squadReviewCheckpointDate(leagueId, seasonStartYear) —
 * 10 January is a European mid-season REVIEW default, not a universal transfer window.
 */
export function winterWindowDate(seasonStartYear) {
  return simDate(seasonStartYear + 1, 1, 10);
}
