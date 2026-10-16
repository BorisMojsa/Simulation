/**
 * Validated UEFA-style league-phase schedules and canonical fixture identities.
 * Structural constraints only — does not implement official pot/association draw rules.
 */

export function clubKey(c) {
  return c?.clubId || c?.name;
}

/**
 * Circle-method round-robin factorization for an even-sized field.
 * Returns (n-1) rounds; each round is a perfect matching of index pairs.
 */
export function roundRobinFactorization(n) {
  if (!Number.isInteger(n) || n < 2 || n % 2 !== 0) {
    throw new Error(`roundRobinFactorization requires even n>=2, got ${n}`);
  }
  const rounds = [];
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let round = 0; round < n - 1; round++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      pairs.push([arr[i], arr[n - 1 - i]]);
    }
    rounds.push(pairs);
    // Rotate all but the first element
    const last = arr.pop();
    arr.splice(1, 0, last);
  }
  return rounds;
}

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Orient selected matchings so each club has exactly homeCount homes.
 * The union of k perfect matchings is k-regular; with k even it decomposes into closed
 * trails, and orienting every trail edge in walking direction gives each club k/2 homes.
 * Returns null if homeCount is not half the matchday count.
 */
function orientMatchings(field, matchings, homeCount, rng) {
  if (homeCount * 2 !== matchings.length) return null;
  const edges = [];
  const adjacency = field.map(() => []);
  matchings.forEach((pairs, md) => {
    pairs.forEach(([i, j]) => {
      const e = edges.length;
      edges.push({ i, j, md, home: null, used: false });
      adjacency[i].push(e);
      adjacency[j].push(e);
    });
  });
  for (let v = 0; v < adjacency.length; v++) adjacency[v] = rng.shuffle(adjacency[v]);

  const cursor = adjacency.map(() => 0);
  const nextUnused = (v) => {
    while (cursor[v] < adjacency[v].length && edges[adjacency[v][cursor[v]]].used) cursor[v] += 1;
    return cursor[v] < adjacency[v].length ? adjacency[v][cursor[v]] : -1;
  };
  for (const start of rng.shuffle(field.map((_, v) => v))) {
    while (nextUnused(start) >= 0) {
      let v = start;
      for (let e = nextUnused(v); e >= 0; e = nextUnused(v)) {
        const edge = edges[e];
        edge.used = true;
        edge.home = v;
        v = edge.i === v ? edge.j : edge.i;
      }
    }
  }

  return edges
    .map((edge, idx) => ({ edge, idx }))
    .sort((a, b) => a.edge.md - b.edge.md || a.idx - b.idx)
    .map(({ edge }) => {
      const home = field[edge.home];
      const away = field[edge.home === edge.i ? edge.j : edge.i];
      return {
        home,
        away,
        matchday: edge.md + 1,
        homeClubId: clubKey(home),
        awayClubId: clubKey(away),
      };
    });
}

/**
 * Validate a completed league-phase schedule against format constraints.
 */
export function validateLeaguePhaseSchedule(field, fixtures, { opponents, homeCount } = {}) {
  const n = field.length;
  const ids = field.map(clubKey);
  const idSet = new Set(ids);
  if (idSet.size !== n) {
    return { ok: false, reason: "duplicate-club-ids" };
  }
  if (!Number.isInteger(opponents) || opponents < 1) {
    return { ok: false, reason: "invalid-opponents" };
  }
  if (homeCount * 2 !== opponents) {
    return { ok: false, reason: "home-count-mismatch" };
  }
  const expectedFixtures = (n * opponents) / 2;
  if (fixtures.length !== expectedFixtures) {
    return {
      ok: false,
      reason: `fixture-count:${fixtures.length}!=${expectedFixtures}`,
    };
  }

  const played = new Map(ids.map((id) => [id, new Set()]));
  const homes = new Map(ids.map((id) => [id, 0]));
  const mdOccupancy = new Map(ids.map((id) => [id, new Map()]));
  const pairs = new Set();
  const mdCounts = new Map();

  for (const fx of fixtures) {
    const h = clubKey(fx.home);
    const a = clubKey(fx.away);
    const md = fx.matchday;
    if (!idSet.has(h) || !idSet.has(a) || h === a) {
      return { ok: false, reason: "invalid-participants" };
    }
    const pk = pairKey(h, a);
    if (pairs.has(pk)) return { ok: false, reason: `repeat-pair:${pk}` };
    pairs.add(pk);
    if (played.get(h).has(a)) return { ok: false, reason: `repeat-opponent:${h}` };
    played.get(h).add(a);
    played.get(a).add(h);
    homes.set(h, homes.get(h) + 1);
    mdCounts.set(md, (mdCounts.get(md) || 0) + 1);
    const hMd = mdOccupancy.get(h);
    const aMd = mdOccupancy.get(a);
    if (hMd.get(md) || aMd.get(md)) {
      return { ok: false, reason: `double-md:${md}` };
    }
    hMd.set(md, true);
    aMd.set(md, true);
  }

  for (const id of ids) {
    if (played.get(id).size !== opponents) {
      return { ok: false, reason: `opponents:${id}:${played.get(id).size}` };
    }
    if (homes.get(id) !== homeCount) {
      return { ok: false, reason: `homes:${id}:${homes.get(id)}` };
    }
    for (let md = 1; md <= opponents; md++) {
      if (!mdOccupancy.get(id).get(md)) {
        return { ok: false, reason: `missing-md:${id}:MD${md}` };
      }
    }
  }

  const perMd = n / 2;
  for (let md = 1; md <= opponents; md++) {
    if (mdCounts.get(md) !== perMd) {
      return { ok: false, reason: `md-size:MD${md}:${mdCounts.get(md)}` };
    }
  }
  if ([...mdCounts.keys()].some((md) => md < 1 || md > opponents)) {
    return { ok: false, reason: "extra-matchday" };
  }

  return { ok: true };
}

/**
 * Build a complete league-phase schedule with structural guarantees.
 * Retries orientation/round selection deterministically from the supplied rng.
 */
export function buildLeaguePhaseSchedule(field, opponents, homeCount, rng, {
  maxAttempts = 80,
} = {}) {
  const n = field.length;
  if (n % 2 !== 0) {
    throw new Error(`League-phase field must be even (got ${n})`);
  }
  if (opponents > n - 1) {
    throw new Error(`opponents ${opponents} exceeds field size ${n}`);
  }
  if (homeCount * 2 !== opponents) {
    throw new Error(`homeCount ${homeCount} must be opponents/2`);
  }

  const factorization = roundRobinFactorization(n);
  const roundIndices = Array.from({ length: factorization.length }, (_, i) => i);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const order = rng.shuffle([...roundIndices]);
    const chosen = order.slice(0, opponents).map((ri) => factorization[ri]);
    // Keep matchday order stable as chosen order (seeded)
    const fixtures = orientMatchings(field, chosen, homeCount, rng);
    if (!fixtures) continue;
    const check = validateLeaguePhaseSchedule(field, fixtures, { opponents, homeCount });
    if (check.ok) return fixtures;
  }

  throw new Error(
    `Failed to build valid league-phase schedule for n=${n} opponents=${opponents} after ${maxAttempts} attempts`
  );
}

/** Canonical competition slug for IDs (prefer format competitionId). */
export function competitionIdSlug(competitionIdOrName, format = null) {
  if (format?.competitionId) return format.competitionId;
  if (!competitionIdOrName) return "competition";
  if (String(competitionIdOrName).includes("-")) return String(competitionIdOrName);
  return String(competitionIdOrName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function buildEditionId(seasonYear, competitionId) {
  return `${seasonYear || 2026}-${competitionId}`;
}

/**
 * Stable fixture identity. Never derive from a player's filtered match index.
 */
export function makeFixtureId({
  competitionId,
  editionId,
  stageId,
  matchday = null,
  homeClubId,
  awayClubId,
  regionId = null,
  groupId = null,
  tieId = null,
  legNumber = null,
}) {
  const parts = [competitionId, editionId, stageId];
  if (regionId) parts.push(`reg:${regionId}`);
  if (groupId != null && groupId !== "") parts.push(`g:${groupId}`);
  if (matchday != null) parts.push(`md${matchday}`);
  if (tieId) {
    parts.push(tieId);
    if (legNumber != null) parts.push(`leg${legNumber}`);
  } else {
    parts.push(homeClubId, awayClubId);
  }
  return parts.join(":");
}

export function makeTieId({ competitionId, editionId, stageId, index, regionId = null }) {
  const parts = [competitionId, editionId, stageId, "tie", String(index)];
  if (regionId) parts.splice(3, 0, `reg:${regionId}`);
  return parts.join(":");
}

/** Official-ish UEFA league-phase MD anchors (shared by all fixtures of that MD). */
export function leaguePhaseMatchdayDate(seasonStartYear, matchday, opponentsPerClub = 8) {
  // UCL/UEL: Sep–Jan (8 MDs). UECL: compressed six-MD window.
  const anchors8 = [
    [9, 17],
    [10, 1],
    [10, 22],
    [11, 5],
    [11, 26],
    [12, 10],
    [1, 21],
    [1, 28],
  ];
  const anchors6 = [
    [10, 2],
    [10, 23],
    [11, 6],
    [11, 27],
    [12, 11],
    [12, 18],
  ];
  const anchors = opponentsPerClub <= 6 ? anchors6 : anchors8;
  const [month, day] = anchors[Math.min(Math.max(matchday, 1), anchors.length) - 1];
  const year = month >= 7 ? seasonStartYear : seasonStartYear + 1;
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** Knockout stage date anchors after the league phase. */
export function knockoutStageDate(seasonStartYear, stageId, legNumber = 1) {
  const table = {
    playoff: [
      [2, 12],
      [2, 19],
    ],
    R16: [
      [3, 5],
      [3, 12],
    ],
    QF: [
      [4, 9],
      [4, 16],
    ],
    SF: [
      [4, 30],
      [5, 7],
    ],
    Final: [[5, 28]],
  };
  const legs = table[stageId] || table.R16;
  const [month, day] = legs[Math.min(Math.max(legNumber, 1), legs.length) - 1];
  const year = month >= 7 ? seasonStartYear : seasonStartYear + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
