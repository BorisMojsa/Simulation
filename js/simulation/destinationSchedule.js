/**
 * Cross-league / cross-country mid-season schedule reconciliation.
 *
 * After an accepted transfer or loan, attach the player only to the destination
 * club's remaining eligible fixtures. Past destination matches initialise world
 * state without attributing appearances to the player.
 */
import { LEAGUES, LEAGUE_BY_ID } from "../data/leagues.js";
import { attachClubIdentity, getWorldState } from "./worldState.js";
import { effectiveTeamStrength } from "./teamStrength.js";
import { simulateMatch } from "./matchEngine.js";
import { applyMatchFormUpdate } from "./worldState.js";
import { createStreamRng, hashSeed } from "./rng.js";
import { sortChronological, dateCupRounds } from "./seasonCalendar.js?v=89";
import {
  calendarForLeague,
  destinationSeasonStartYear,
  isRegistrationOpen,
  leagueSeasonBounds,
  nextOpenRegistration,
  REGISTRATION_RULE_VERSION,
} from "../data/registrationWindows.js";
import { resolvePlayingClubAt, isPendingRegistrationBlocking } from "./playingRegistration.js";
import {
  freezeEditionRoster,
  resolveLeagueClubs,
  pairPolicyForLeague,
} from "./leagueMembership.js";

function isContinentalChronoEvent(ev) {
  return (
    ev?.kind === "continental" ||
    ev?.kind === "continental_md" ||
    ev?.kind === "continental_fixture"
  );
}

function roundRobinFixtures(clubs) {
  const fixtures = [];
  for (let i = 0; i < clubs.length; i++) {
    for (let j = 0; j < clubs.length; j++) {
      if (i !== j) fixtures.push({ home: clubs[i], away: clubs[j] });
    }
  }
  return fixtures;
}

/**
 * Deterministic shuffle for schedule generation (independent of match RNG).
 */
function seededShuffle(list, seedLabel) {
  const rng = createStreamRng(seedLabel, "fixture-order");
  return rng.shuffle(list);
}

/**
 * Date fixtures across a league's season bounds.
 */
export function dateFixturesForLeague(fixtures, leagueId, seasonStartYear) {
  const { start, end } = leagueSeasonBounds(leagueId, seasonStartYear);
  const n = fixtures.length;
  if (!n) return [];
  const span = Math.max(1, daysBetweenSafe(start, end));
  return fixtures.map((fx, i) => {
    const t = n === 1 ? 0 : i / (n - 1);
    const date = addDaysSafe(start, Math.round(t * span));
    return {
      ...fx,
      date,
      index: i,
      competitionType: "league",
      sortKey: `${date}:DL:${leagueId}:${i}`,
      destinationLeagueId: leagueId,
      fixtureId: `${leagueId}:${date}:DL:${i}`,
    };
  });
}

function daysBetweenSafe(a, b) {
  const [ay, am, ad] = String(a).split("-").map(Number);
  const [by, bm, bd] = String(b).split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

function addDaysSafe(iso, days) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + Number(days || 0));
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/**
 * Build a full deterministic destination league schedule for a season.
 */
export function buildDestinationLeagueSchedule(league, seasonStartYear, world = getWorldState()) {
  if (!league) return { clubs: [], dated: [], seasonStartYear };
  freezeEditionRoster(league, seasonStartYear, world);
  const clubs = resolveLeagueClubs(league, { world, seasonYear: seasonStartYear });
  const seed = `dest-sched:${league.leagueId}:${seasonStartYear}`;
  const fixtures = seededShuffle(roundRobinFixtures(clubs), seed);
  const dated = dateFixturesForLeague(fixtures, league.leagueId, seasonStartYear);
  return { clubs, dated, seasonStartYear, leagueId: league.leagueId };
}

/**
 * Decide whether a move can register immediately or must be future-dated.
 */
export function resolveMoveRegistration({
  destinationLeagueId,
  departureDate,
  originSeasonStartYear,
}) {
  const destSeasonYear = destinationSeasonStartYear(
    destinationLeagueId,
    departureDate,
    originSeasonStartYear
  );
  const reg = isRegistrationOpen(destinationLeagueId, departureDate, destSeasonYear);
  if (reg.open) {
    return {
      ok: true,
      immediate: true,
      effectiveDate: departureDate,
      seasonStartYear: destSeasonYear,
      window: reg.window,
      ruleVersion: REGISTRATION_RULE_VERSION,
    };
  }
  // Also try origin season key for European destinations mid-winter
  const regOrigin = isRegistrationOpen(destinationLeagueId, departureDate, originSeasonStartYear);
  if (regOrigin.open) {
    return {
      ok: true,
      immediate: true,
      effectiveDate: departureDate,
      seasonStartYear: originSeasonStartYear,
      window: regOrigin.window,
      ruleVersion: REGISTRATION_RULE_VERSION,
    };
  }
  const next = nextOpenRegistration(destinationLeagueId, departureDate, originSeasonStartYear);
  if (!next) {
    return { ok: false, reason: "no-future-registration-window", ruleVersion: REGISTRATION_RULE_VERSION };
  }
  return {
    ok: true,
    immediate: false,
    effectiveDate: next.effectiveDate,
    seasonStartYear: next.seasonStartYear,
    window: next,
    futureStart: true,
    ruleVersion: REGISTRATION_RULE_VERSION,
  };
}

/**
 * After a club change, rebuild remaining events so the player only appears for
 * the destination club from effectiveDate onward.
 *
 * @returns {{ ordered, destinationMeta, pastSimulated }}
 */
export function reconcileAfterClubChange({
  player,
  previousClubId,
  previousLeagueId,
  departureDate,
  ordered,
  eventIndex,
  originSeasonStartYear,
  world = null,
  rng = null,
  initialisePastDestination = true,
}) {
  const destLeagueId = player.club?.leagueId || player.playingClub?.leagueId;
  const destClubId = player.playingClubId || player.club?.clubId;
  if (!destLeagueId || !destClubId) {
    return { ordered, destinationMeta: null, pastSimulated: 0, error: "missing-destination" };
  }

  const registration = resolveMoveRegistration({
    destinationLeagueId: destLeagueId,
    departureDate,
    originSeasonStartYear,
  });
  if (!registration.ok) {
    return { ordered, destinationMeta: null, pastSimulated: 0, error: registration.reason };
  }

  const effectiveDate = registration.effectiveDate;
  const destSeasonYear = registration.seasonStartYear;
  const destLeague = LEAGUE_BY_ID.get(destLeagueId) || LEAGUES.find((l) => l.leagueId === destLeagueId);
  if (!destLeague) {
    return { ordered, destinationMeta: null, pastSimulated: 0, error: "unknown-destination-league" };
  }

  const sameLeague = previousLeagueId && previousLeagueId === destLeagueId;
  // Same-league moves keep the existing remaining league events; only swap participation via club id.
  // Keep continental_md world ticks; drop player-only continental_fixture slots for the departed club
  // (attachment is also enforced at play time). Cup rounds stay — attachment rebinds separately.
  if (sameLeague) {
    const head = ordered.slice(0, eventIndex + 1);
    const tail = ordered.slice(eventIndex + 1).map((ev) => {
      if (ev.kind === "continental_fixture") return null;
      if (ev.kind === "continental") return null;
      return ev;
    }).filter(Boolean);
    if (registration.futureStart || effectiveDate > departureDate) {
      tail.unshift({
        kind: "registration_effective",
        date: effectiveDate,
        sortKey: `${effectiveDate}:REG:0`,
        clubId: destClubId,
        leagueId: destLeagueId,
      });
      player.pendingRegistration = {
        clubId: destClubId,
        leagueId: destLeagueId,
        effectiveDate,
        ruleVersion: REGISTRATION_RULE_VERSION,
      };
    } else {
      player.pendingRegistration = null;
    }
    const remainingLeague = tail.filter((e) => e.kind === "league").length;
    return {
      ordered: [...head, ...sortChronological(tail)],
      destinationMeta: {
        registration,
        previousClubId,
        previousLeagueId,
        destLeagueId,
        destClubId,
        effectiveDate,
        pastFixtures: 0,
        futureFixtures: remainingLeague,
        pastSimulated: 0,
        sameLeague: true,
        ruleVersion: REGISTRATION_RULE_VERSION,
      },
      pastSimulated: 0,
    };
  }

  const w = world || getWorldState();
  const schedule = buildDestinationLeagueSchedule(destLeague, destSeasonYear, w);
  // Modeled senior leagues must already include the destination club.
  if (!schedule.clubs.some((c) => c.clubId === destClubId || c.name === player.club?.name)) {
    if (pairPolicyForLeague(destLeagueId) || (destLeague.clubs || []).length >= 10) {
      return {
        ordered,
        destinationMeta: null,
        pastSimulated: 0,
        error: "destination-club-missing-from-edition",
      };
    }
    schedule.clubs.push(
      attachClubIdentity({
        ...player.club,
        league: destLeague.name,
        leagueId: destLeague.leagueId,
        nation: destLeague.nation,
      })
    );
  }

  const past = schedule.dated.filter((fx) => fx.date < effectiveDate);
  const future = schedule.dated.filter((fx) => fx.date >= effectiveDate);

  if (!future.length && !registration.futureStart) {
    // Calendar gap until next season's fixtures — rebuild next season if empty
    const nextYear = destSeasonYear + 1;
    const nextSched = buildDestinationLeagueSchedule(destLeague, nextYear, w);
    const nextFuture = nextSched.dated.filter((fx) => fx.date >= effectiveDate);
    if (nextFuture.length) {
      future.push(...nextFuture);
      schedule.seasonStartYear = nextYear;
    }
  }

  if (!future.length) {
    return {
      ordered,
      destinationMeta: { registration, schedule: { leagueId: destLeagueId, fixtures: 0 } },
      pastSimulated: 0,
      error: "missing-destination-schedule",
    };
  }

  // Initialise already-played destination matches (world + standings seed only).
  // Do not attribute appearances or stats to the player.
  let pastSimulated = 0;
  const pastMatches = [];
  const pastRng =
    rng || createStreamRng(`dest-past:${destLeagueId}:${destSeasonYear}`, "seed-standings");
  if (initialisePastDestination && past.length && pastRng) {
    for (const fx of past) {
      const match = simulateMatch(fx.home, fx.away, {
        competition: "league",
        worldState: w,
        rng: pastRng,
        competitionId: destLeagueId,
        fixtureId: fx.fixtureId || `dest-past:${destLeagueId}:${fx.sortKey}`,
        date: fx.date,
      });
      match.matchday = Math.floor(fx.index / Math.max(1, Math.floor(schedule.clubs.length / 2))) + 1;
      match.round = `Matchday ${match.matchday}`;
      match.destinationLeagueId = destLeagueId;
      match.historySegment = "destination-past";
      applyMatchFormUpdate(w, match);
      pastMatches.push(match);
      pastSimulated += 1;
    }
  }

  // Keep events up to and including current cursor; rebuild the tail.
  const head = ordered.slice(0, eventIndex + 1);
  const oldTail = ordered.slice(eventIndex + 1);

  // Drop previous-club player league fixtures and destination-incompatible cups.
  // Keep international. Drop continental player slots tied to previous club.
  // Keep non-player world simulation for previous league by converting player league
  // events for other clubs — actually old league events that don't involve dest club
  // should still run as world matches for the origin league table if we still care;
  // for career focus, drop origin-league events after departure (world already has results).
  const filteredTail = oldTail.filter((ev) => {
    if (ev.kind === "international" || ev.kind === "national_md" || ev.kind === "national_fixture") {
      return true;
    }
    if (ev.kind === "window_decision") return false;
    if (ev.kind === "registration_effective") return false;
    // Keep continental_md so other clubs / stages advance; drop player-only fixture slots.
    if (ev.kind === "continental_md") return true;
    if (ev.kind === "continental_fixture" || ev.kind === "continental") return false;
    if (ev.kind === "cup_round") {
      // Only keep if same association domestic cup — drop cross-association
      const prevAssoc = calendarForLeague(previousLeagueId).association;
      const destAssoc = calendarForLeague(destLeagueId).association;
      return prevAssoc === destAssoc;
    }
    if (ev.kind === "league") {
      // Drop all origin-league remaining fixtures after departure
      if (ev.destinationLeagueId && ev.destinationLeagueId !== destLeagueId) return false;
      if (!ev.destinationLeagueId && previousLeagueId && previousLeagueId !== destLeagueId) {
        return false;
      }
      // Same-league move: keep fixtures; player participation uses new club id
      return true;
    }
    return true;
  });

  const destEvents = future.map((fx) => ({
    kind: "league",
    date: fx.date,
    sortKey: fx.sortKey || `${fx.date}:DL:${fx.index}`,
    index: fx.index,
    home: fx.home,
    away: fx.away,
    destinationLeagueId: destLeagueId,
    destinationClubId: destClubId,
    fixtureId: fx.fixtureId || `${destLeagueId}:${fx.sortKey}`,
  }));

  // Future-start: insert a registration gate before first playing fixture
  const gateEvents = [];
  if (registration.futureStart || effectiveDate > departureDate) {
    gateEvents.push({
      kind: "registration_effective",
      date: effectiveDate,
      sortKey: `${effectiveDate}:REG:0`,
      clubId: destClubId,
      leagueId: destLeagueId,
    });
  }

  // Cross-association only: schedule remaining destination-cup anchors (full Sep–May set).
  // Same-association moves keep origin `cup_round` events and rebind attachment.
  const prevAssoc = calendarForLeague(previousLeagueId).association;
  const destAssoc = calendarForLeague(destLeagueId).association;
  const destCupEvents = [];
  if (prevAssoc !== destAssoc) {
    const cupAnchors = dateCupRounds([{}, {}, {}, {}, {}, {}], destSeasonYear).filter(
      (r) => r.date >= effectiveDate
    );
    for (let i = 0; i < cupAnchors.length; i++) {
      const r = cupAnchors[i];
      destCupEvents.push({
        kind: "dest_cup_round",
        date: r.date,
        sortKey: `${r.date}:DC:${i}`,
        roundIndex: i,
        destinationLeagueId: destLeagueId,
        destinationSeasonStartYear: destSeasonYear,
      });
    }
  }

  const newTail = sortChronological([...gateEvents, ...destEvents, ...destCupEvents, ...filteredTail]);
  // Prevent same-day incompatible double appearances: if intl + league same day, keep both
  // but mark league as lower priority — processPlayerMatchDay handles fatigue. Strip duplicate
  // league fixtures for the same clubs/date.
  const deduped = dedupeLeagueEvents(newTail);

  const newOrdered = [...head, ...deduped];

  // Pending registration: player may already have club identity but must not play before gate
  if (registration.futureStart) {
    player.pendingRegistration = {
      clubId: destClubId,
      leagueId: destLeagueId,
      effectiveDate,
      ruleVersion: REGISTRATION_RULE_VERSION,
    };
  } else {
    player.pendingRegistration = null;
  }

  return {
    ordered: newOrdered,
    destinationClubs: schedule.clubs,
    pastMatches,
    destinationMeta: {
      registration,
      previousClubId,
      previousLeagueId,
      destLeagueId,
      destClubId,
      effectiveDate,
      pastFixtures: past.length,
      futureFixtures: future.length,
      pastSimulated,
      scheduleSeasonStartYear: schedule.seasonStartYear,
      sameLeague: false,
      ruleVersion: REGISTRATION_RULE_VERSION,
    },
    pastSimulated,
  };
}

function dedupeLeagueEvents(events) {
  const seen = new Set();
  const out = [];
  for (const ev of events) {
    if (ev.kind !== "league") {
      out.push(ev);
      continue;
    }
    const key = `${ev.date}:${ev.home?.clubId || ev.home?.name}:${ev.away?.clubId || ev.away?.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ev);
  }
  return out;
}

/**
 * Whether the player is eligible to appear in a club fixture on this date.
 * Uses dated playing registration when available.
 */
export function playerEligibleForClubMatch(player, date) {
  if (!player) return false;
  if (player.club?.isAcademy) return false;
  if (player.contractStatus === "released" || player.contractStatus === "expired") {
    // Still allow appearances that belong to a season already underway if contract
    // covers the current season index (half-open: seasons.length < end).
    const end = player.contractEndSeason;
    const done = player.seasons?.length ?? 0;
    if (end != null && done >= end) return false;
  }
  if (player.contractEndSeason != null) {
    const done = player.seasons?.length ?? 0;
    if (done >= player.contractEndSeason) return false;
  }
  if (isPendingRegistrationBlocking(player, date)) return false;
  const playingId = resolvePlayingClubAt(player, date);
  if (!playingId) return false;
  return true;
}

export { isContinentalChronoEvent };

export function findLeagueById(leagueId) {
  return LEAGUE_BY_ID.get(leagueId) || LEAGUES.find((l) => l.leagueId === leagueId) || null;
}
