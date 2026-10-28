/**
 * Shared league-table rebuild used by chronological sim and the live dashboard.
 * Idempotent by fixtureId / matchId so Pause/Skip/re-render never double-count.
 */

/**
 * @param {object[]} seedClubs — club stubs with name/displayName/badge/clubId/strength*
 * @param {object[]} matches
 * @param {{ appliedIds?: Set<string> }} [opts]
 */
export function rebuildTableFromMatches(seedClubs, matches, opts = {}) {
  const records = new Map();
  for (const c of seedClubs || []) {
    if (!c?.name) continue;
    records.set(c.name, emptyRow(c));
  }

  const applied = opts.appliedIds instanceof Set ? opts.appliedIds : new Set();
  for (const match of matches || []) {
    const id = matchKey(match);
    if (id && applied.has(id)) continue;
    if (id) applied.add(id);
    ensureRow(records, match.home);
    ensureRow(records, match.away);
    applyMatchToRecords(records, match);
  }

  return {
    table: sortTable(records),
    appliedIds: applied,
  };
}

export function matchKey(match) {
  if (!match) return null;
  return match.matchId || match.fixtureId || null;
}

/** Ensure league matches carry a stable matchId for the competition store / UI cursor. */
export function ensureLeagueMatchId(match) {
  if (!match) return match;
  if (!match.matchId) {
    match.matchId =
      match.fixtureId ||
      `league:${match.competitionId || match.leagueContextId || "lg"}:${match.date || "?"}:${
        match.home?.clubId || match.home?.name
      }:${match.away?.clubId || match.away?.name}`;
  }
  if (!match.fixtureId) match.fixtureId = match.matchId;
  return match;
}

export function emptyRow(club) {
  return {
    name: club.name,
    displayName: club.displayName ?? club.name,
    badge: club.badge || null,
    clubId: club.clubId || null,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points: 0,
    strength: club.strength ?? club.overall ?? 0,
    overall: club.overall ?? club.strength ?? 0,
    attack: club.attack ?? null,
    midfield: club.midfield ?? null,
    defence: club.defence ?? null,
    goalkeeper: club.goalkeeper ?? null,
    strengthTier: club.strengthTier || null,
  };
}

function ensureRow(records, club) {
  if (!club?.name || records.has(club.name)) return;
  records.set(club.name, emptyRow(club));
}

export function applyMatchToRecords(records, match) {
  const home = records.get(match.home?.name);
  const away = records.get(match.away?.name);
  if (!home || !away) return;
  const hg = Number(match.matchHomeGoals ?? match.homeGoals) || 0;
  const ag = Number(match.matchAwayGoals ?? match.awayGoals) || 0;
  home.played += 1;
  away.played += 1;
  home.goalsFor += hg;
  home.goalsAgainst += ag;
  away.goalsFor += ag;
  away.goalsAgainst += hg;
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

export function sortTable(records) {
  const list = records instanceof Map ? [...records.values()] : [...(records || [])];
  return list
    .map((r) => ({ ...r, goalDiff: r.goalsFor - r.goalsAgainst, matches: r.played }))
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.goalDiff - a.goalDiff ||
        b.goalsFor - a.goalsFor ||
        (b.strength || 0) - (a.strength || 0)
    )
    .map((row, idx) => ({ ...row, position: idx + 1 }));
}

/**
 * Group full-league matches by matchday for dashboard batches.
 * Player-club matches are flagged; background fixtures share the same batch.
 */
export function groupMatchesByMatchday(allMatches) {
  const groups = new Map();
  for (const m of allMatches || []) {
    const md = m.matchday || 0;
    if (!groups.has(md)) groups.set(md, { matchday: md, matches: [], playerMatches: [] });
    const g = groups.get(md);
    g.matches.push(m);
    if (m.playerSide) g.playerMatches.push(m);
  }
  return [...groups.values()].sort((a, b) => a.matchday - b.matchday);
}

/**
 * Deterministic cosmetic goal timeline when events lack goal minutes.
 * Never exceeds final goals; never reverses.
 */
export function buildScoreRevealPath(match) {
  const finalH = Number(match?.homeGoals ?? match?.matchHomeGoals) || 0;
  const finalA = Number(match?.awayGoals ?? match?.matchAwayGoals) || 0;
  const events = [...(match?.events || [])]
    .filter((e) => e.type === "goal")
    .sort((a, b) => (a.minute || 0) - (b.minute || 0));

  const path = [{ t: 0, home: 0, away: 0, cosmetic: false }];
  let h = 0;
  let a = 0;
  let cosmetic = false;

  if (events.length) {
    for (const ev of events) {
      if (ev.team === "home") h += 1;
      else if (ev.team === "away") a += 1;
      if (h > finalH || a > finalA) {
        // Clamp — never exceed finals
        h = Math.min(h, finalH);
        a = Math.min(a, finalA);
      }
      const minute = Math.max(1, Math.min(90, Number(ev.minute) || 45));
      path.push({ t: minute / 90, home: h, away: a, cosmetic: false });
    }
  }

  if (h !== finalH || a !== finalA) {
    cosmetic = true;
    // Deterministic spacing of remaining goals between 0.2 and 0.95 of match
    const needH = finalH - h;
    const needA = finalA - a;
    const steps = [];
    for (let i = 0; i < needH; i++) steps.push("home");
    for (let i = 0; i < needA; i++) steps.push("away");
    // Stable interleave from club ids / names
    const seed = String(matchKey(match) || `${match?.home?.name}-${match?.away?.name}`);
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    for (let i = steps.length - 1; i > 0; i--) {
      hash = (hash * 1664525 + 1013904223) >>> 0;
      const j = hash % (i + 1);
      [steps[i], steps[j]] = [steps[j], steps[i]];
    }
    const total = steps.length;
    steps.forEach((side, i) => {
      if (side === "home") h += 1;
      else a += 1;
      const t = total === 1 ? 0.55 : 0.2 + (0.75 * (i + 1)) / (total + 1);
      path.push({ t, home: h, away: a, cosmetic: true });
    });
  }

  // Ensure final lock point
  const last = path[path.length - 1];
  if (!last || last.home !== finalH || last.away !== finalA) {
    path.push({ t: 1, home: finalH, away: finalA, cosmetic });
  } else if (last.t < 1) {
    path.push({ t: 1, home: finalH, away: finalA, cosmetic: last.cosmetic });
  }

  return { path, cosmetic, finalHome: finalH, finalAway: finalA };
}

/**
 * Format player contribution for a completed match card.
 * @param {object} match
 * @param {{ position?: string }} player
 */
export function formatMatchContribution(match, player = {}) {
  const ps = match?.playerStats || {};
  const played = Boolean(ps.played) || (Number(ps.minutes) || 0) > 0;
  const reason = ps.nonParticipationReason || match?.nonParticipationReason || null;

  if (!match?.playerSide) {
    return {
      kind: "spectator",
      text: "",
      ratingText: "—",
      rating: null,
    };
  }

  if (!played) {
    const label =
      reason === "injured"
        ? "Injured"
        : reason === "suspended"
          ? "Suspended"
          : reason === "rested"
            ? "Rested"
            : reason === "not_eligible" || reason === "ineligible"
              ? "Not eligible"
              : reason === "not_selected"
                ? "Not selected"
                : reason === "unused" || reason === "unused_substitute" || reason === "bench"
                  ? "Unused substitute"
                  : "Did not play";
    return {
      kind: "no-appearance",
      text: label,
      ratingText: "—",
      rating: null,
      reason,
    };
  }

  const rating = ps.rating != null && Number.isFinite(Number(ps.rating)) ? Number(ps.rating) : null;
  const ratingText = rating != null ? rating.toFixed(1) : "—";
  const minutes = Number(ps.minutes) || 0;
  const started = Boolean(ps.started);
  const statusBit = started ? "Started" : "Sub";
  const isGk = (player.position || ps.position) === "GK";

  if (isGk) {
    const conceded =
      match.playerSide === "home"
        ? Number(match.awayGoals ?? match.matchAwayGoals) || 0
        : Number(match.homeGoals ?? match.matchHomeGoals) || 0;
    const teamShutout = conceded === 0;
    const individualCs = minutes >= 60 && teamShutout;
    const csLabel = individualCs
      ? "Clean sheet"
      : teamShutout
        ? "Team shutout (no CS credit)"
        : "Conceded";
    return {
      kind: "gk",
      text: `${csLabel} · ${minutes}' · ${statusBit}`,
      ratingText,
      rating,
      cleanSheet: individualCs,
      teamShutout,
      minutes,
    };
  }

  const goals = Number(ps.goals) || 0;
  const assists = Number(ps.assists) || 0;
  return {
    kind: "outfield",
    text: `${goals}G / ${assists}A · ${minutes}' · ${statusBit}`,
    ratingText,
    rating,
    goals,
    assists,
    minutes,
  };
}
