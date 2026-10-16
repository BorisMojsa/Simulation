/**
 * Pure continental table projection from unique committed fixtures.
 */

import { clubKey } from "./continentalSchedule.js";

export function emptyContinentalRow(team) {
  return {
    team,
    name: team.name,
    displayName: team.displayName,
    badge: team.badge,
    clubId: team.clubId,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDiff: 0,
    points: 0,
    homeWins: 0,
    awayWins: 0,
    awayGoals: 0,
    strength: team.overall ?? 70,
    coefficient: team.coefficient ?? team.uefaCoefficient ?? team.overall ?? 70,
    position: 0,
    band: null,
  };
}

function applyResultToRow(row, gf, ga, { isHome = true } = {}) {
  row.played += 1;
  row.goalsFor += gf;
  row.goalsAgainst += ga;
  row.goalDiff = row.goalsFor - row.goalsAgainst;
  if (!isHome) row.awayGoals += gf;
  if (gf > ga) {
    row.wins += 1;
    row.points += 3;
    if (isHome) row.homeWins += 1;
    else row.awayWins += 1;
  } else if (gf === ga) {
    row.draws += 1;
    row.points += 1;
  } else {
    row.losses += 1;
  }
}

/**
 * Build table rows from unique played fixtures.
 * Does not count shootout kicks, aggregates, or scheduled fixtures.
 */
export function buildTableFromFixtures(participants, fixtures, { appliedIds = null } = {}) {
  const rows = new Map();
  for (const team of participants) {
    rows.set(clubKey(team), emptyContinentalRow(team));
  }
  const seen = appliedIds instanceof Set ? appliedIds : new Set();

  for (const match of fixtures || []) {
    if (!match || match.isBye || match.isAggregate) continue;
    if (match.status && match.status !== "played") continue;
    if (match.homeGoals == null || match.awayGoals == null) continue;
    const mid = match.matchId || match.fixtureId;
    if (mid) {
      if (seen.has(mid)) continue;
      seen.add(mid);
    }
    const homeId = clubKey(match.home);
    const awayId = clubKey(match.away);
    const homeRow = rows.get(homeId);
    const awayRow = rows.get(awayId);
    if (!homeRow || !awayRow) continue;
    const hg = match.matchHomeGoals ?? match.homeGoals;
    const ag = match.matchAwayGoals ?? match.awayGoals;
    // Regulation / ET goals only — never penalty shootout totals
    applyResultToRow(homeRow, hg, ag, { isHome: true });
    applyResultToRow(awayRow, ag, hg, { isHome: false });
  }

  return rows;
}

function opponentsMetrics(row, rowsById, fixtures) {
  const id = clubKey(row.team) || row.clubId || row.name;
  const oppIds = new Set();
  for (const m of fixtures || []) {
    const h = clubKey(m.home);
    const a = clubKey(m.away);
    if (h === id) oppIds.add(a);
    else if (a === id) oppIds.add(h);
  }
  let pts = 0;
  let gd = 0;
  let gf = 0;
  for (const oid of oppIds) {
    const o = rowsById.get(oid);
    if (!o) continue;
    pts += o.points;
    gd += o.goalDiff;
    gf += o.goalsFor;
  }
  return { pts, gd, gf };
}

/**
 * UEFA league-phase ordering (final criteria subset with documented coefficient fallback).
 * Points, GD, GF, away goals, wins, away wins, opponents' pts/GD/GF, then coefficient.
 * Does not substitute live OVR as a sporting tie-break ahead of coefficient.
 */
export function sortUefaLeaguePhaseRows(rows, fixtures = []) {
  const list = [...rows];
  const byId = new Map(list.map((r) => [clubKey(r.team) || r.clubId || r.name, r]));
  const cache = new Map();
  const opp = (r) => {
    const id = clubKey(r.team) || r.clubId || r.name;
    if (!cache.has(id)) cache.set(id, opponentsMetrics(r, byId, fixtures));
    return cache.get(id);
  };

  return list.sort((a, b) => {
    const oa = opp(a);
    const ob = opp(b);
    return (
      b.points - a.points ||
      b.goalDiff - a.goalDiff ||
      b.goalsFor - a.goalsFor ||
      (b.awayGoals || 0) - (a.awayGoals || 0) ||
      b.wins - a.wins ||
      (b.awayWins || 0) - (a.awayWins || 0) ||
      oa.pts - ob.pts ||
      oa.gd - ob.gd ||
      oa.gf - ob.gf ||
      (b.coefficient ?? 0) - (a.coefficient ?? 0) ||
      String(a.name || "").localeCompare(String(b.name || ""))
    );
  });
}

/** Generic non-UEFA sort: points, GD, GF, then coefficient/name — no live strength. */
export function sortContinentalRows(rows) {
  return [...rows].sort(
    (a, b) =>
      b.points - a.points ||
      b.goalDiff - a.goalDiff ||
      b.goalsFor - a.goalsFor ||
      (b.coefficient ?? 0) - (a.coefficient ?? 0) ||
      String(a.name || "").localeCompare(String(b.name || ""))
  );
}

export function finalizeLeaguePhaseTable(participants, fixtures, leaguePhaseFormat, {
  uefaStyle = true,
} = {}) {
  const rowsMap = buildTableFromFixtures(participants, fixtures);
  const sorter = uefaStyle ? (rows) => sortUefaLeaguePhaseRows(rows, fixtures) : sortContinentalRows;
  const lp = leaguePhaseFormat || {};
  return sorter([...rowsMap.values()]).map((r, i) => {
    r.position = i + 1;
    if (lp.advanceDirect && r.position <= lp.advanceDirect) r.band = "R16";
    else if (
      lp.advancePlayoff &&
      r.position >= lp.advancePlayoff[0] &&
      r.position <= lp.advancePlayoff[1]
    ) {
      r.band = "playoff";
    } else if (lp.advancePerRegion && r.position <= lp.advancePerRegion) {
      r.band = "R16";
    } else {
      r.band = "eliminated";
    }
    return r;
  });
}

/** Accounting invariants for a completed phase table + fixtures. */
export function assertPhaseAccounting(table, fixtures, {
  expectedParticipants = null,
  expectedPlayedPerClub = null,
} = {}) {
  const playedFixtures = (fixtures || []).filter(
    (m) => m && !m.isBye && !m.isAggregate && m.homeGoals != null && m.awayGoals != null
  );
  const sum = (key) => table.reduce((s, r) => s + (r[key] || 0), 0);
  const errors = [];
  for (const r of table) {
    if (r.played !== r.wins + r.draws + r.losses) {
      errors.push(`${r.name}: P!=W+D+L`);
    }
    if (r.points !== 3 * r.wins + r.draws) errors.push(`${r.name}: Pts`);
    if (r.goalDiff !== r.goalsFor - r.goalsAgainst) errors.push(`${r.name}: GD`);
    if (expectedPlayedPerClub != null && r.played !== expectedPlayedPerClub) {
      errors.push(`${r.name}: played ${r.played}`);
    }
  }
  if (expectedParticipants != null && table.length !== expectedParticipants) {
    errors.push(`participants ${table.length}`);
  }
  if (sum("played") !== 2 * playedFixtures.length) errors.push("sum(P)");
  if (sum("wins") !== sum("losses")) errors.push("sum(W)!=sum(L)");
  const draws = playedFixtures.filter((m) => m.homeGoals === m.awayGoals).length;
  if (sum("draws") !== 2 * draws) errors.push("sum(D)");
  if (sum("goalsFor") !== sum("goalsAgainst")) errors.push("sum(GF)!=sum(GA)");
  if (sum("goalDiff") !== 0) errors.push("sum(GD)");
  return { ok: errors.length === 0, errors };
}
