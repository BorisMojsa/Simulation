/**
 * National group / best-thirds accounting and ranking adapters.
 * Accounting is pure P/W/D/L/GF/GA/GD/Pts; ranking is competition-specific.
 */

function goalsOf(match) {
  const hg = match.matchHomeGoals ?? match.homeGoals;
  const ag = match.matchAwayGoals ?? match.awayGoals;
  if (hg == null || ag == null || Number.isNaN(Number(hg)) || Number.isNaN(Number(ag))) {
    throw new Error(`Played national fixture missing scores: ${match.matchId || "?"}`);
  }
  return { hg: Number(hg), ag: Number(ag) };
}

export function emptyNationRow(nation) {
  const name = typeof nation === "string" ? nation : nation?.name;
  return {
    name,
    displayName: (typeof nation === "object" && nation?.displayName) || name,
    badge: (typeof nation === "object" && nation?.badge) || null,
    nationId: (typeof nation === "object" && (nation?.nationId || nation?.name)) || name,
    groupId: (typeof nation === "object" && nation?.groupId) || null,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    gf: 0,
    ga: 0,
    gd: 0,
    points: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    disciplinaryScore: (typeof nation === "object" && nation?.disciplinaryScore) || 0,
    fifaRank: (typeof nation === "object" && nation?.fifaRank) || null,
  };
}

/**
 * Pure table accounting over an explicit participant inventory and played fixtures.
 * Deduplicates by matchId within this call; does not reuse an external applied set with empty rows.
 */
export function accountNationalTable(participants, matches, { groupId = null } = {}) {
  const records = new Map();
  for (const p of participants || []) {
    const row = emptyNationRow(p);
    if (groupId) row.groupId = groupId;
    records.set(row.name, row);
  }
  const applied = new Set();
  for (const match of matches || []) {
    if (match.stageType && match.stageType !== "group" && match.stageType !== "league") continue;
    if (groupId && match.groupId && match.groupId !== groupId) continue;
    const id = match.matchId || match.fixtureId;
    if (!id) throw new Error("National fixture missing matchId");
    if (applied.has(id)) continue;
    if (match.status && match.status !== "played") continue;
    if (match.homeGoals == null && match.matchHomeGoals == null) continue;
    applied.add(id);
    const homeName = match.home?.name || match.homeParticipantId;
    const awayName = match.away?.name || match.awayParticipantId;
    if (!records.has(homeName) || !records.has(awayName)) {
      throw new Error(`National table participant missing for ${id}: ${homeName} vs ${awayName}`);
    }
    const { hg, ag } = goalsOf(match);
    const home = records.get(homeName);
    const away = records.get(awayName);
    home.played += 1;
    away.played += 1;
    home.gf += hg;
    home.ga += ag;
    away.gf += ag;
    away.ga += hg;
    home.goalsFor = home.gf;
    home.goalsAgainst = home.ga;
    away.goalsFor = away.gf;
    away.goalsAgainst = away.ga;
    if (hg > ag) {
      home.wins += 1;
      home.points += 3;
      away.losses += 1;
    } else if (ag > hg) {
      away.wins += 1;
      away.points += 3;
      home.losses += 1;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.points += 1;
      away.points += 1;
    }
  }
  for (const row of records.values()) {
    row.gd = row.gf - row.ga;
  }
  return { rows: [...records.values()], appliedIds: applied };
}

function h2hMiniTable(tiedNames, matches) {
  const set = new Set(tiedNames);
  const subset = (matches || []).filter((m) => {
    const h = m.home?.name || m.homeParticipantId;
    const a = m.away?.name || m.awayParticipantId;
    return set.has(h) && set.has(a);
  });
  const { rows } = accountNationalTable(tiedNames.map((n) => ({ name: n })), subset);
  return new Map(rows.map((r) => [r.name, r]));
}

function compareByKeys(a, b, keys) {
  for (const key of keys) {
    if (key === "points") {
      if (b.points !== a.points) return b.points - a.points;
    } else if (key === "gd") {
      if (b.gd !== a.gd) return b.gd - a.gd;
    } else if (key === "gf") {
      if (b.gf !== a.gf) return b.gf - a.gf;
    } else if (key === "wins") {
      if (b.wins !== a.wins) return b.wins - a.wins;
    } else if (key === "disciplinary") {
      // Lower disciplinary score is better (fewer cards). Missing → equal.
      const ad = a.disciplinaryScore ?? 0;
      const bd = b.disciplinaryScore ?? 0;
      if (ad !== bd) return ad - bd;
    } else if (key === "fifaRank") {
      // Lower FIFA rank is better. Missing ranks sort after known ones, then by name.
      const ar = a.fifaRank;
      const br = b.fifaRank;
      if (ar == null && br == null) continue;
      if (ar == null) return 1;
      if (br == null) return -1;
      if (ar !== br) return ar - br;
    } else if (key === "name") {
      return String(a.name).localeCompare(String(b.name));
    }
  }
  return 0;
}

/**
 * FIFA group ranking: points → H2H among tied → overall GD → GF → disciplinary → FIFA rank → name.
 * Best-thirds across groups must NOT use H2H (teams never met).
 */
export function rankFifaGroup(rows, matches) {
  return rankWithHeadToHead(rows, matches, {
    overallKeys: ["points", "gd", "gf", "disciplinary", "fifaRank", "name"],
    h2hKeys: ["points", "gd", "gf"],
  });
}

export function rankFifaBestThirds(rows) {
  return [...rows].sort((a, b) =>
    compareByKeys(a, b, ["points", "gd", "gf", "disciplinary", "fifaRank", "name"])
  );
}

/**
 * EURO group ranking (Article 20): points → H2H (reapplied to remaining subset) →
 * overall GD → GF → disciplinary → FIFA rank fallback → name.
 * Special last-match ranking shootout is a separate event and must not alter points/GF/GA.
 */
export function rankEuroGroup(rows, matches) {
  return rankWithHeadToHead(rows, matches, {
    overallKeys: ["points", "gd", "gf", "disciplinary", "fifaRank", "name"],
    h2hKeys: ["points", "gd", "gf"],
    reapplySubset: true,
  });
}

/** EURO best-thirds (Article 19): points → GD → GF → wins → disciplinary → FIFA rank → name. */
export function rankEuroBestThirds(rows) {
  return [...rows].sort((a, b) =>
    compareByKeys(a, b, ["points", "gd", "gf", "wins", "disciplinary", "fifaRank", "name"])
  );
}

function rankWithHeadToHead(rows, matches, { overallKeys, h2hKeys, reapplySubset = false }) {
  const sorted = [...rows].sort((a, b) => compareByKeys(a, b, ["points"]));
  const result = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].points === sorted[i].points) j += 1;
    const tied = sorted.slice(i, j);
    if (tied.length === 1) {
      result.push(tied[0]);
    } else {
      result.push(...orderTiedSubset(tied, matches, h2hKeys, overallKeys, reapplySubset));
    }
    i = j;
  }
  return result;
}

function orderTiedSubset(tied, matches, h2hKeys, overallKeys, reapplySubset) {
  if (tied.length <= 1) return tied;
  const names = tied.map((r) => r.name);
  const mini = h2hMiniTable(names, matches);
  const enriched = tied.map((r) => {
    const h = mini.get(r.name) || emptyNationRow(r.name);
    return {
      ...r,
      _h2hPoints: h.points,
      _h2hGd: h.gd,
      _h2hGf: h.gf,
    };
  });
  enriched.sort((a, b) => {
    for (const key of h2hKeys) {
      if (key === "points" && a._h2hPoints !== b._h2hPoints) return b._h2hPoints - a._h2hPoints;
      if (key === "gd" && a._h2hGd !== b._h2hGd) return b._h2hGd - a._h2hGd;
      if (key === "gf" && a._h2hGf !== b._h2hGf) return b._h2hGf - a._h2hGf;
    }
    return compareByKeys(a, b, overallKeys.filter((k) => k !== "points"));
  });

  if (!reapplySubset || enriched.length <= 2) {
    return enriched.map(stripH2h);
  }

  // Re-apply H2H to any still-tied subset after the mini-league.
  const out = [];
  let i = 0;
  while (i < enriched.length) {
    let j = i + 1;
    while (
      j < enriched.length &&
      enriched[j]._h2hPoints === enriched[i]._h2hPoints &&
      enriched[j]._h2hGd === enriched[i]._h2hGd &&
      enriched[j]._h2hGf === enriched[i]._h2hGf
    ) {
      j += 1;
    }
    const sub = enriched.slice(i, j);
    if (sub.length > 1 && sub.length < enriched.length) {
      out.push(...orderTiedSubset(sub.map(stripH2h), matches, h2hKeys, overallKeys, false));
    } else {
      out.push(...sub.map(stripH2h));
    }
    i = j;
  }
  return out;
}

function stripH2h(row) {
  const { _h2hPoints, _h2hGd, _h2hGf, ...rest } = row;
  return rest;
}

export function rankNationalGroup(competitionId, rows, matches) {
  if (competitionId === "euro") return rankEuroGroup(rows, matches);
  if (competitionId === "world-cup") return rankFifaGroup(rows, matches);
  // Pool-limited cups: points/GD/GF then FIFA rank / name (documented fallback).
  return [...rows].sort((a, b) => compareByKeys(a, b, ["points", "gd", "gf", "fifaRank", "name"]));
}

export function rankBestThirds(competitionId, rows) {
  if (competitionId === "euro") return rankEuroBestThirds(rows);
  if (competitionId === "world-cup") return rankFifaBestThirds(rows);
  return [...rows].sort((a, b) => compareByKeys(a, b, ["points", "gd", "gf", "fifaRank", "name"]));
}

/** Verify table accounting invariants for a completed isolated table. */
export function assertTableInvariants(rows, fixtures) {
  const P = rows.reduce((s, r) => s + r.played, 0);
  const W = rows.reduce((s, r) => s + r.wins, 0);
  const D = rows.reduce((s, r) => s + r.draws, 0);
  const L = rows.reduce((s, r) => s + r.losses, 0);
  const GF = rows.reduce((s, r) => s + r.gf, 0);
  const GA = rows.reduce((s, r) => s + r.ga, 0);
  const Pts = rows.reduce((s, r) => s + r.points, 0);
  const n = fixtures.length;
  const draws = fixtures.filter((m) => {
    const { hg, ag } = goalsOf(m);
    return hg === ag;
  }).length;
  const decisive = n - draws;
  if (P !== 2 * n) throw new Error(`P=${P} expected ${2 * n}`);
  if (W !== L) throw new Error(`W=${W} L=${L}`);
  if (D !== 2 * draws) throw new Error(`D=${D} expected ${2 * draws}`);
  if (GF !== GA) throw new Error(`GF=${GF} GA=${GA}`);
  if (Pts !== 3 * decisive + 2 * draws) throw new Error(`Pts=${Pts}`);
  for (const r of rows) {
    if (r.played !== r.wins + r.draws + r.losses) throw new Error(`${r.name} P≠W+D+L`);
    if (r.points !== 3 * r.wins + r.draws) throw new Error(`${r.name} Pts`);
    if (r.gd !== r.gf - r.ga) throw new Error(`${r.name} GD`);
  }
  return true;
}
