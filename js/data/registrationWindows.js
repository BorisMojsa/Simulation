/**
 * Association registration windows and league calendar shapes.
 * Declared simulation policy dates for the researched period — not a claim of
 * every future official window. Versioned separately from recruitment tuning.
 */
import { simDate, addDays, daysBetween } from "../simulation/seasonCalendar.js";

export const REGISTRATION_RULE_VERSION = "registration-windows-v1-2026-10-10";

/** League season shape for fixture dating. */
export const LEAGUE_CALENDAR = {
  "league:england-premier-league": { shape: "european", association: "assoc:england" },
  "league:england-championship": { shape: "european", association: "assoc:england" },
  "league:germany-bundesliga": { shape: "european", association: "assoc:germany" },
  "league:germany-2-bundesliga": { shape: "european", association: "assoc:germany" },
  "league:spain-la-liga": { shape: "european", association: "assoc:spain" },
  "league:spain-laliga-2": { shape: "european", association: "assoc:spain" },
  "league:italy-serie-a": { shape: "european", association: "assoc:italy" },
  "league:italy-serie-b": { shape: "european", association: "assoc:italy" },
  "league:france-ligue-1": { shape: "european", association: "assoc:france" },
  "league:france-ligue-2": { shape: "european", association: "assoc:france" },
  "league:brazil-brasileirao-serie-a": { shape: "calendar", association: "assoc:brazil" },
  "league:belgium-belgian-pro-league": { shape: "european", association: "assoc:belgium" },
  "league:argentina-liga-profesional": { shape: "calendar", association: "assoc:argentina" },
  "league:portugal-primeira-liga": { shape: "european", association: "assoc:portugal" },
  "league:poland-ekstraklasa": { shape: "european", association: "assoc:poland" },
  "league:denmark-superliga": { shape: "european", association: "assoc:denmark" },
  "league:norway-eliteserien": { shape: "calendar", association: "assoc:norway" },
  "league:mexico-liga-mx": { shape: "split", association: "assoc:mexico" },
  "league:colombia-categoria-primera-a": { shape: "calendar", association: "assoc:colombia" },
  "league:netherlands-eredivisie": { shape: "european", association: "assoc:netherlands" },
  "league:ecuador-ligapro-serie-a": { shape: "calendar", association: "assoc:ecuador" },
  "league:turkiye-super-lig": { shape: "european", association: "assoc:turkiye" },
  "league:united-states-mls": { shape: "calendar", association: "assoc:usa" },
  "league:czechia-czech-first-league": { shape: "european", association: "assoc:czechia" },
  "league:croatia-hnl": { shape: "european", association: "assoc:croatia" },
  "league:serbia-superliga": { shape: "european", association: "assoc:serbia" },
};

/**
 * Open registration windows by association for a career season keyed by
 * European seasonStartYear (Aug Y → May Y+1) or calendar year Y.
 */
export function associationWindows(associationId, seasonStartYear) {
  const y = Number(seasonStartYear) || 2026;
  const european = [
    { id: "summer", open: simDate(y, 6, 14), close: simDate(y, 9, 1), kind: "registration" },
    { id: "winter", open: simDate(y + 1, 1, 1), close: simDate(y + 1, 2, 1), kind: "registration" },
  ];
  const calendar = [
    { id: "pre-season", open: simDate(y, 1, 15), close: simDate(y, 4, 1), kind: "registration" },
    { id: "mid-season", open: simDate(y, 7, 1), close: simDate(y, 8, 5), kind: "registration" },
  ];
  const mls = [
    { id: "primary", open: simDate(y, 1, 20), close: simDate(y, 4, 23), kind: "registration" },
    { id: "secondary", open: simDate(y, 7, 5), close: simDate(y, 8, 15), kind: "registration" },
  ];
  const split = [
    { id: "apertura", open: simDate(y, 6, 1), close: simDate(y, 8, 15), kind: "registration" },
    { id: "clausura", open: simDate(y + 1, 1, 1), close: simDate(y + 1, 1, 25), kind: "registration" },
  ];

  if (associationId === "assoc:usa") return mls;
  if (associationId === "assoc:mexico") return split;
  if (
    associationId === "assoc:norway" ||
    associationId === "assoc:brazil" ||
    associationId === "assoc:argentina" ||
    associationId === "assoc:colombia" ||
    associationId === "assoc:ecuador"
  ) {
    return calendar;
  }
  return european;
}

export function calendarForLeague(leagueId) {
  return (
    LEAGUE_CALENDAR[leagueId] || {
      shape: "european",
      association: "assoc:generic-european",
    }
  );
}

export function isRegistrationOpen(leagueId, isoDate, seasonStartYear) {
  const cal = calendarForLeague(leagueId);
  const windows = associationWindows(cal.association, seasonStartYear);
  const d = String(isoDate);
  for (const w of windows) {
    if (d >= w.open && d <= w.close) {
      return { open: true, window: w, association: cal.association };
    }
  }
  return { open: false, window: null, association: cal.association, windows };
}

/**
 * Mid-season squad REVIEW checkpoint — not a universal registration authorisation.
 * Placed near the midpoint of the league's competition calendar.
 */
export function squadReviewCheckpointDate(leagueId, seasonStartYear) {
  const cal = calendarForLeague(leagueId);
  const y = Number(seasonStartYear) || 2026;
  if (cal.shape === "calendar") {
    return simDate(y, 7, 15);
  }
  if (cal.shape === "split") {
    return simDate(y, 11, 20);
  }
  // European: early January review — may coincide with winter window for some associations
  // but registration is checked separately via isRegistrationOpen.
  return simDate(y + 1, 1, 10);
}

/**
 * League competition date span for fixture generation.
 */
export function leagueSeasonBounds(leagueId, seasonStartYear) {
  const cal = calendarForLeague(leagueId);
  const y = Number(seasonStartYear) || 2026;
  if (cal.shape === "calendar") {
    return { start: simDate(y, 3, 30), end: simDate(y, 11, 20), calendarYear: y };
  }
  if (cal.shape === "split") {
    return { start: simDate(y, 7, 10), end: simDate(y + 1, 5, 20), calendarYear: y };
  }
  return { start: simDate(y, 8, 12), end: simDate(y + 1, 5, 18), calendarYear: y };
}

/**
 * Map a European career seasonStartYear to the destination league's season key.
 * Calendar-year leagues in January after a European winter move use the upcoming year.
 */
export function destinationSeasonStartYear(leagueId, departureDate, originSeasonStartYear) {
  const cal = calendarForLeague(leagueId);
  const y = Number(originSeasonStartYear) || 2026;
  const [dy, dm] = String(departureDate).split("-").map(Number);
  if (cal.shape === "calendar") {
    // If departing after the calendar season ended, attach to next calendar season.
    if (dm >= 12 || (dm === 1 && dy === y + 1) || (dm <= 2 && dy === y + 1)) {
      return dy; // e.g. Jan 2027 → Norway 2027
    }
    return dy;
  }
  // European / split: keep origin season key when move is inside Aug–May
  return y;
}

export function dateInRange(isoDate, start, end) {
  const d = String(isoDate);
  return d >= start && d <= end;
}

export function nextOpenRegistration(leagueId, fromDate, seasonStartYear) {
  const cal = calendarForLeague(leagueId);
  // Search current and next season keys
  for (const year of [seasonStartYear, seasonStartYear + 1, seasonStartYear + 2]) {
    const windows = associationWindows(cal.association, year);
    for (const w of windows) {
      if (w.close >= fromDate) {
        const start = w.open > fromDate ? w.open : fromDate;
        if (start <= w.close) return { ...w, seasonStartYear: year, effectiveDate: start };
      }
    }
  }
  return null;
}

export { simDate, addDays, daysBetween };
