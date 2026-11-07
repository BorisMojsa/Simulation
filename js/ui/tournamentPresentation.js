/**
 * Pure tournament presentation projection.
 *
 * Recomputes phase and whole-tournament records from saved fixtures for UI only.
 * Never simulates matches, commits results, or mutates inputs.
 *
 * Counting convention (explicit product policy):
 * - W/D/L and GF/GA use match goals after any extra time; shootout kicks are excluded.
 * - A 1–1 match won on penalties is P1 W0 D1 L0 GF1 GA1 plus one shootout won.
 * - Aggregate parent cards and byes are not games; two-leg ties expand to raw legs.
 */

const STAGE_DISPLAY = Object.freeze({
  league: "League phase",
  leaguePhase: "League phase",
  group: "Group stage",
  groups: "Group stage",
  playoff: "Knockout playoffs",
  R1: "Round One",
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarter-finals",
  SF: "Semi-finals",
  Final: "Final",
  placement: "Third-place match",
  "third-place": "Third-place match",
  "Third-place match": "Third-place match",
});

const RESULT_STATUS_LABELS = new Set([
  "Winners",
  "Runner-up",
  "Not in squad",
  "In progress",
  "Completed",
  "completed",
  "champion",
]);

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function emptyRecord() {
  return {
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    gf: 0,
    ga: 0,
    gd: 0,
    shootoutsWon: 0,
    shootoutsLost: 0,
  };
}

function freezeRecord(rec) {
  return Object.freeze({ ...rec, gd: rec.gf - rec.ga });
}

export function formatStageLabel(stage, { competitionId = null } = {}) {
  if (stage == null || stage === "") return "Unavailable";
  const raw = String(stage).trim();
  if (!raw) return "Unavailable";
  if (RESULT_STATUS_LABELS.has(raw)) return raw;
  if (STAGE_DISPLAY[raw]) return STAGE_DISPLAY[raw];

  const lower = raw.toLowerCase();
  if (lower === "league phase" || lower === "league") return "League phase";
  if (lower === "group stage" || lower === "groups" || lower === "group") return "Group stage";
  if (lower === "knockout playoffs" || lower === "playoff") return "Knockout playoffs";
  if (lower === "third-place" || lower === "third place" || lower === "third-place match") {
    return "Third-place match";
  }

  // Preserve competition-specific "Round One" / R1 wording already in STAGE_DISPLAY.
  const roundN = raw.match(/^R(\d+)$/i);
  if (roundN) {
    const n = Number(roundN[1]);
    if (n === 1) return "Round One";
    return `Round of ${n}`;
  }
  const roundOf = raw.match(/^Round of\s+(\d+)$/i);
  if (roundOf) return `Round of ${Number(roundOf[1])}`;
  if (/^quarter[- ]?finals?$/i.test(raw)) return "Quarter-finals";
  if (/^semi[- ]?finals?$/i.test(raw)) return "Semi-finals";
  if (/^final$/i.test(raw)) return "Final";

  // Do not convert every string containing "playoff" into Knockout playoffs.
  if (/knockout/i.test(raw) && !/playoff/i.test(raw)) return "Knockout";
  void competitionId;
  return raw;
}

export function resolveOpeningPhaseKind(campaign) {
  if (!campaign || campaign.qualified === false || campaign.showcase) return null;
  if (campaign.leaguePhase) return "league";
  if (Array.isArray(campaign.groups) && campaign.groups.length) return "group";
  if (campaign.groups?.groups?.length || campaign.groups?.openingLabel) {
    return campaign.groups.openingLabel?.toLowerCase().includes("league") ? "league" : "group";
  }
  if (campaign.openingPhase === "league" || campaign.openingPhase === "groups") {
    return campaign.openingPhase === "league" ? "league" : "group";
  }
  // Genuine knockout-only competitions may open in knockout.
  if (campaign.openingPhase === "knockout" || (!campaign.leaguePhase && !campaign.groups && campaign.allRounds?.length)) {
    return "knockout";
  }
  return null;
}

export function resolveOpeningPhaseLabel(campaign) {
  const kind = resolveOpeningPhaseKind(campaign);
  if (kind === "league") return "League phase";
  if (kind === "group") return "Group stage";
  if (kind === "knockout") return "Knockout";
  const legacy =
    campaign?.leaguePhase?.openingLabel ||
    campaign?.groups?.openingLabel ||
    (Array.isArray(campaign?.groups) ? null : null);
  if (legacy) return formatStageLabel(legacy);
  if (campaign?.qualified === false || campaign?.showcase) return "Unavailable";
  return "Unavailable";
}

export function phaseScopeNote(kind) {
  if (kind === "league") {
    return "League phase only. Knockout matches are shown in the tournament record.";
  }
  if (kind === "group") {
    return "Group stage only. Knockout matches are shown in the tournament record.";
  }
  return null;
}

/** Canonical participant identity keys for matching home/away fields. */
export function participantIdentityKeys(participant, { kind = "auto" } = {}) {
  if (participant == null) return Object.freeze([]);
  if (typeof participant === "string" || typeof participant === "number") {
    const s = String(participant);
    return Object.freeze(s ? [s] : []);
  }
  const keys = [];
  const push = (v) => {
    if (v == null || v === "") return;
    const s = String(v);
    if (!keys.includes(s)) keys.push(s);
  };
  if (kind === "nation" || kind === "auto") {
    push(participant.nationId);
    push(participant.name);
    push(participant.displayName);
    push(participant.nationality);
    push(participant.playerNation);
  }
  if (kind === "club" || kind === "auto") {
    push(participant.clubId);
    push(participant.focusClubId);
    push(participant.playingClubId);
    push(participant.name);
    push(participant.displayName);
  }
  return Object.freeze(keys);
}

function sideCanonicalIds(side, participantIdField) {
  const keys = [];
  const push = (v) => {
    if (v == null || v === "") return;
    const s = String(v);
    if (!keys.includes(s)) keys.push(s);
  };
  if (typeof side === "string") push(side);
  else if (side && typeof side === "object") {
    push(side.clubId);
    push(side.nationId);
  }
  // homeParticipantId / awayParticipantId are canonical for national fixtures (nation name)
  // and continental club IDs when present.
  push(participantIdField);
  return keys;
}

function sideDisplayNames(side) {
  const keys = [];
  const push = (v) => {
    if (v == null || v === "") return;
    const s = String(v);
    if (!keys.includes(s)) keys.push(s);
  };
  if (side && typeof side === "object") {
    push(side.name);
    push(side.displayName);
  }
  return keys;
}

function sideKeys(side, participantIdField) {
  return [...sideCanonicalIds(side, participantIdField), ...sideDisplayNames(side)];
}

/**
 * Resolve which side a fixture belongs to for a scoped participant.
 * Prefer canonical clubId / nationId / participantId fields when the fixture carries them.
 * Display names are a documented legacy fallback only when the side lacks a canonical ID.
 */
export function fixtureParticipantSide(fixture, participantKeys, { canonicalId = null } = {}) {
  if (!fixture || !participantKeys?.length) return null;
  const keySet = new Set(participantKeys.map(String));
  const canon = canonicalId != null && canonicalId !== "" ? String(canonicalId) : null;

  const homeCanon = sideCanonicalIds(fixture.home, fixture.homeParticipantId);
  const awayCanon = sideCanonicalIds(fixture.away, fixture.awayParticipantId);
  const homeHasCanon = homeCanon.length > 0;
  const awayHasCanon = awayCanon.length > 0;

  if (canon) {
    const homeCanonHit = homeCanon.includes(canon);
    const awayCanonHit = awayCanon.includes(canon);
    if (homeCanonHit && awayCanonHit) return "both";
    if (homeCanonHit) return "home";
    if (awayCanonHit) return "away";
    // Fixture sides carry canonical IDs that do not match the scoped club/nation —
    // do not fall through to shared display names (e.g. two "United" clubs).
    if (homeHasCanon && awayHasCanon) return null;
  }

  const homeNames = sideDisplayNames(fixture.home);
  const awayNames = sideDisplayNames(fixture.away);
  const homeHit =
    homeCanon.some((k) => keySet.has(k)) ||
    (!homeHasCanon && homeNames.some((k) => keySet.has(k)));
  const awayHit =
    awayCanon.some((k) => keySet.has(k)) ||
    (!awayHasCanon && awayNames.some((k) => keySet.has(k)));
  if (homeHit && awayHit) return "both";
  if (homeHit) return "home";
  if (awayHit) return "away";
  return null;
}

function matchIdOf(m) {
  return m?.matchId || m?.fixtureId || null;
}

function goalsOf(match) {
  const hg = match.matchHomeGoals ?? match.homeGoals;
  const ag = match.matchAwayGoals ?? match.awayGoals;
  if (hg == null || ag == null || Number.isNaN(Number(hg)) || Number.isNaN(Number(ag))) {
    return null;
  }
  return { hg: Number(hg), ag: Number(ag) };
}

function penaltyPair(match) {
  const ph = match.penaltyHome ?? match.homePenalties ?? match.penaltiesHome;
  const pa = match.penaltyAway ?? match.awayPenalties ?? match.penaltiesAway;
  if (ph == null || pa == null || Number.isNaN(Number(ph)) || Number.isNaN(Number(pa))) {
    return null;
  }
  return { ph: Number(ph), pa: Number(pa) };
}

function isPlayedRawMatch(match) {
  if (!match || match.isBye || match.isAggregate) return false;
  if (match.status && match.status !== "played") return false;
  if (match.spoilerHidden) return false;
  return goalsOf(match) != null;
}

function expandRawCandidates(nodes) {
  const out = [];
  for (const node of nodes || []) {
    if (!node) continue;
    if (node.isAggregate) {
      if (Array.isArray(node.legs)) out.push(...node.legs);
      continue;
    }
    if (Array.isArray(node.legs) && node.legs.length && !node.isAggregate) {
      // Defensive: some projections nest legs without the aggregate flag.
      out.push(...node.legs);
      continue;
    }
    out.push(node);
  }
  return out;
}

/**
 * Collect unique played raw fixtures from heterogeneous campaign inventories.
 * Does not mutate inputs. Returns structured diagnostics on contradictory duplicates.
 */
export function collectRawPlayedFixtures(sources, { visibleFixtureIds = null, competitionId = null, editionId = null } = {}) {
  const vis =
    visibleFixtureIds == null
      ? null
      : visibleFixtureIds instanceof Set
        ? visibleFixtureIds
        : new Set(visibleFixtureIds);
  const bag = [];
  for (const src of sources || []) {
    if (!src) continue;
    if (Array.isArray(src)) bag.push(...src);
    else bag.push(src);
  }
  const expanded = expandRawCandidates(bag);
  const byId = new Map();
  const diagnostics = [];
  const anonymous = [];

  for (const match of expanded) {
    if (!isPlayedRawMatch(match)) continue;
    if (competitionId != null) {
      const cid = match.competitionId ?? match.cupCompetitionId ?? null;
      if (cid != null && String(cid) !== String(competitionId)) continue;
    }
    if (editionId != null) {
      const eid = match.editionId ?? null;
      if (eid != null && String(eid) !== String(editionId)) continue;
    }
    const id = matchIdOf(match);
    // Live reveal boundary: anonymous fixtures cannot match a reveal ID — exclude them.
    if (vis) {
      if (!id || !vis.has(id)) continue;
    } else if (!id) {
      anonymous.push(match);
      continue;
    }
    if (!byId.has(id)) {
      byId.set(id, match);
      continue;
    }
    const prev = byId.get(id);
    const g0 = goalsOf(prev);
    const g1 = goalsOf(match);
    const h0 = sideKeys(prev.home, prev.homeParticipantId).join("|");
    const h1 = sideKeys(match.home, match.homeParticipantId).join("|");
    const a0 = sideKeys(prev.away, prev.awayParticipantId).join("|");
    const a1 = sideKeys(match.away, match.awayParticipantId).join("|");
    const p0 = penaltyPair(prev);
    const p1 = penaltyPair(match);
    const pensDiffer =
      (p0 || p1) &&
      (!p0 || !p1 || p0.ph !== p1.ph || p0.pa !== p1.pa);
    if (
      !g0 ||
      !g1 ||
      g0.hg !== g1.hg ||
      g0.ag !== g1.ag ||
      h0 !== h1 ||
      a0 !== a1 ||
      pensDiffer
    ) {
      diagnostics.push({
        code: "contradictory_duplicate",
        matchId: id,
        message: `Contradictory duplicate fixture ${id}`,
        a: { goals: g0, home: h0, away: a0, pens: p0 },
        b: { goals: g1, home: h1, away: a1, pens: p1 },
      });
    }
  }

  return Object.freeze({
    fixtures: Object.freeze(vis ? [...byId.values()] : [...byId.values(), ...anonymous]),
    byId,
    diagnostics: Object.freeze(diagnostics),
    anonymousCount: anonymous.length,
  });
}

export function tallyParticipantRecord(fixtures, participantKeys, { canonicalId = null } = {}) {
  const keys = participantIdentityKeys(
    Array.isArray(participantKeys) ? { name: participantKeys[0], clubId: participantKeys[0] } : participantKeys
  );
  const keyList = Array.isArray(participantKeys)
    ? participantKeys.map(String)
    : keys;
  const canon =
    canonicalId != null
      ? String(canonicalId)
      : Array.isArray(participantKeys) && participantKeys.length === 1
        ? String(participantKeys[0])
        : participantKeys?.clubId || participantKeys?.focusClubId || participantKeys?.nationId || null;
  const rec = emptyRecord();
  const counted = [];
  for (const match of fixtures || []) {
    if (!isPlayedRawMatch(match)) continue;
    const side = fixtureParticipantSide(match, keyList, { canonicalId: canon });
    if (!side || side === "both") continue;
    const goals = goalsOf(match);
    if (!goals) continue;
    const gf = side === "home" ? goals.hg : goals.ag;
    const ga = side === "home" ? goals.ag : goals.hg;
    rec.played += 1;
    rec.gf += gf;
    rec.ga += ga;
    if (gf > ga) rec.wins += 1;
    else if (gf < ga) rec.losses += 1;
    else {
      rec.draws += 1;
      const pens = penaltyPair(match);
      if (pens) {
        const wonPens =
          (side === "home" && pens.ph > pens.pa) || (side === "away" && pens.pa > pens.ph);
        const lostPens =
          (side === "home" && pens.ph < pens.pa) || (side === "away" && pens.pa < pens.ph);
        if (wonPens) rec.shootoutsWon += 1;
        else if (lostPens) rec.shootoutsLost += 1;
      } else if (match.winnerSide === side) {
        rec.shootoutsWon += 1;
      } else if (match.winnerSide && match.winnerSide !== side) {
        rec.shootoutsLost += 1;
      }
    }
    counted.push(matchIdOf(match) || `${counted.length}`);
  }
  return Object.freeze({
    record: freezeRecord(rec),
    fixtureIds: Object.freeze(counted),
  });
}

function nationalGroupList(campaign) {
  if (!campaign) return [];
  if (Array.isArray(campaign.groups)) return campaign.groups;
  if (Array.isArray(campaign.groups?.groups)) return campaign.groups.groups;
  return [];
}

function phaseFixturesFromCampaign(campaign) {
  const kind = resolveOpeningPhaseKind(campaign);
  if (kind === "league") return [...(campaign.leaguePhase?.matches || [])];
  if (kind === "group") {
    const groups = nationalGroupList(campaign);
    const nested = groups.flatMap((g) => g.matches || []);
    const flat = campaign.groups?.matches || [];
    return [...nested, ...flat];
  }
  return [];
}

function knockoutFixturesFromCampaign(campaign) {
  const rounds = campaign?.allRounds || [];
  const fromRounds = rounds.flatMap((r) => r.matches || []);
  const player = campaign?.playerMatches || [];
  const finalMatch = campaign?.finalMatch ? [campaign.finalMatch] : [];
  const third = campaign?.thirdPlaceMatch ? [campaign.thirdPlaceMatch] : [];
  return [...fromRounds, ...player, ...finalMatch, ...third];
}

function inventoryFixturesFromCampaign(campaign) {
  const phase = phaseFixturesFromCampaign(campaign);
  const ko = knockoutFixturesFromCampaign(campaign);
  const rawMap = campaign?.fixtures;
  const fromMap =
    rawMap && typeof rawMap === "object" && !Array.isArray(rawMap)
      ? Object.values(rawMap)
      : Array.isArray(rawMap)
        ? rawMap
        : [];
  return [...phase, ...ko, ...fromMap];
}

function resolveScope(campaign, scope = {}) {
  const competitionId =
    scope.competitionId ?? campaign?.competitionId ?? campaign?.id ?? campaign?.competition ?? null;
  const editionId = scope.editionId ?? campaign?.editionId ?? campaign?.year ?? campaign?.editionYear ?? null;
  let participantKind = scope.participantKind || null;
  let participantId = scope.participantId ?? null;
  let participantLabel = scope.participantLabel ?? null;

  if (!participantKind) {
    if (campaign?.focusClubId || campaign?.leaguePhase || campaign?.kind === "continental") {
      participantKind = "club";
    } else {
      participantKind = "nation";
    }
  }

  if (participantId == null) {
    if (participantKind === "club") {
      participantId = scope.focusClubId ?? campaign?.focusClubId ?? null;
    } else {
      participantId =
        scope.nation ??
        campaign?.playerNation ??
        scope.player?.nationality ??
        null;
    }
  }

  if (!participantLabel) {
    if (participantKind === "club") {
      const fieldHit = (campaign?.field || []).find(
        (c) => c.clubId === participantId || c.name === participantId
      );
      participantLabel = fieldHit?.displayName || fieldHit?.name || String(participantId || "Club");
    } else {
      participantLabel = String(participantId || "Nation");
    }
  }

  const keys = participantIdentityKeys(
    scope.participant || {
      clubId: participantKind === "club" ? participantId : null,
      name: participantId,
      displayName: participantLabel,
      nationality: participantKind === "nation" ? participantId : null,
      nationId: participantKind === "nation" ? participantId : null,
      focusClubId: participantKind === "club" ? participantId : null,
    },
    { kind: participantKind }
  );

  return {
    competitionId,
    editionId,
    participantKind,
    participantId,
    participantLabel,
    keys,
  };
}

function savedPhaseRow(campaign, scope) {
  const id = scope.participantId;
  if (!id) return null;
  const lpRows = campaign?.leaguePhase?.table || [];
  const fromLp = lpRows.find((r) => r.clubId === id || r.name === id || r.displayName === id);
  if (fromLp) return fromLp;
  for (const g of nationalGroupList(campaign)) {
    const row = (g.table || []).find((r) => r.clubId === id || r.name === id || r.nationId === id);
    if (row) return row;
  }
  return null;
}

function recordFromSavedRow(row) {
  if (!row) return null;
  return freezeRecord({
    played: Number(row.played) || 0,
    wins: Number(row.wins) || 0,
    draws: Number(row.draws) || 0,
    losses: Number(row.losses) || 0,
    gf: Number(row.goalsFor ?? row.gf) || 0,
    ga: Number(row.goalsAgainst ?? row.ga) || 0,
    gd: 0,
    shootoutsWon: 0,
    shootoutsLost: 0,
  });
}

function inventoryCompleteness(campaign, scope, collectedPhase, collectedTotal, { live = false } = {}) {
  if (!campaign) return "unavailable";
  if (campaign.qualified === false || campaign.showcase) return "none";
  if (campaign.status === "showcase") return "none";
  void collectedPhase;

  // Nation not in the tournament field → no entry (not a zero campaign).
  if (scope.participantKind === "nation") {
    const field = campaign.field || [];
    const inField =
      campaign.playerNationInTournament === true ||
      (Array.isArray(field) &&
        field.some((n) => (typeof n === "string" ? n : n?.name) === scope.participantId));
    if (campaign.playerNationInTournament === false || (field.length && !inField && scope.participantId)) {
      // Explicit not-in-field, or field present without the nation.
      if (campaign.playerNationInTournament === false) return "none";
      if (field.length && !inField) return "none";
    }
  }

  // Structure present (entered edition) vs raw inventory recovered.
  const hasPhaseStructure =
    Boolean(campaign.leaguePhase) ||
    nationalGroupList(campaign).length > 0 ||
    Boolean(campaign.groups?.groups?.length) ||
    Boolean(campaign.groups && !Array.isArray(campaign.groups) && campaign.groups.openingLabel) ||
    Boolean(campaign.fixtures) ||
    Boolean((campaign.allRounds || []).length) ||
    Boolean((campaign.playerMatches || []).length);

  if (!hasPhaseStructure) {
    return "unavailable";
  }

  // Partial: reconcile declared legIds against unique recovered played legs.
  const rounds = campaign.allRounds || [];
  for (const round of rounds) {
    for (const m of round.matches || []) {
      if (!m?.isAggregate) continue;
      const side = fixtureParticipantSide(m, scope.keys, { canonicalId: scope.participantId });
      if (!side) continue;
      if (m.status !== "played") continue;
      const declaredIds = Array.isArray(m.legIds) ? m.legIds.map(String).filter(Boolean) : [];
      const recoveredIds = new Set();
      for (const leg of m.legs || []) {
        if (!isPlayedRawMatch(leg)) continue;
        const lid = leg.matchId || leg.fixtureId;
        if (lid) recoveredIds.add(String(lid));
      }
      if (declaredIds.length) {
        const missingDeclared = declaredIds.some((id) => !recoveredIds.has(id));
        if (missingDeclared) return "partial";
      } else if (recoveredIds.size === 0) {
        return "partial";
      }
    }
  }

  if (collectedTotal.diagnostics.some((d) => d.code === "contradictory_duplicate")) {
    return "contradiction";
  }

  const saved = savedPhaseRow(campaign, scope);
  const savedPlayed = saved ? Number(saved.played) || 0 : 0;
  const uniqueOpening = new Set(
    (collectedPhase.fixtures || [])
      .map((m) => m.matchId || m.fixtureId)
      .filter(Boolean)
      .map(String)
  ).size;

  if (collectedTotal.fixtures.length === 0) {
    // Live reveal boundary with nothing visible is a truthful zero so far — not table-only.
    if (live) return "empty";
    // Known saved phase row without recoverable raw inventory → preserve phase, withhold total.
    if (saved && (savedPlayed > 0 || saved.wins > 0 || saved.draws > 0 || saved.losses > 0)) {
      return "table-only";
    }
    return "empty";
  }

  // Completed history with a saved phase row but only a partial raw opening recovery.
  if (
    !live &&
    saved &&
    savedPlayed > 0 &&
    uniqueOpening > 0 &&
    uniqueOpening < savedPlayed
  ) {
    return "partial";
  }

  return "complete";
}

export function formatRecordLine(record, { prefix = "", shootouts = true } = {}) {
  if (!record) return "";
  const base = `${prefix ? `${prefix}` : ""}P${record.played} · W${record.wins} · D${record.draws} · L${record.losses}`;
  if (
    shootouts &&
    record &&
    (record.shootoutsWon || record.shootoutsLost)
  ) {
    return `${base} · Pens ${record.shootoutsWon || 0}-${record.shootoutsLost || 0}`;
  }
  return base;
}

export function formatRecordShort(record) {
  if (!record) return "—";
  return `P${record.played} W${record.wins} D${record.draws} L${record.losses}`;
}

/**
 * Project phase + tournament records for a scoped participant.
 */
export function projectTournamentRecords({
  campaign = null,
  scope = {},
  visibleFixtureIds = null,
  live = false,
} = {}) {
  const resolved = resolveScope(campaign, scope);
  const competitionLabel =
    campaign?.name || campaign?.competition || String(resolved.competitionId || "Competition");
  const editionLabel =
    campaign?.year || campaign?.editionYear || campaign?.seasonYear || resolved.editionId || "";
  const openingKind = resolveOpeningPhaseKind(campaign);
  const openingLabel = resolveOpeningPhaseLabel(campaign);
  const note = phaseScopeNote(openingKind);

  if (!campaign) {
    return Object.freeze({
      competitionLabel,
      editionLabel,
      participantLabel: resolved.participantLabel,
      participantKind: resolved.participantKind,
      participantId: resolved.participantId,
      competitionId: resolved.competitionId,
      editionId: resolved.editionId,
      resultLabel: null,
      openingPhase: Object.freeze({ kind: null, label: "Unavailable", record: null, note: null }),
      tournament: Object.freeze({
        record: null,
        completeness: "unavailable",
        label: "Record unavailable",
      }),
      shootouts: Object.freeze({ won: 0, lost: 0 }),
      diagnostics: Object.freeze([{ code: "missing_campaign", message: "No campaign provided" }]),
      phaseFixtureIds: Object.freeze([]),
      tournamentFixtureIds: Object.freeze([]),
      live,
    });
  }

  // Nation outside the field (even without showcase flag).
  if (resolved.participantKind === "nation") {
    const field = campaign.field || [];
    const named = (n) => (typeof n === "string" ? n : n?.name);
    const inField =
      campaign.playerNationInTournament === true ||
      (Array.isArray(field) && field.some((n) => named(n) === resolved.participantId));
    if (
      campaign.playerNationInTournament === false ||
      (field.length > 0 && resolved.participantId && !inField)
    ) {
      return Object.freeze({
        competitionLabel,
        editionLabel,
        participantLabel: resolved.participantLabel,
        participantKind: resolved.participantKind,
        participantId: resolved.participantId,
        competitionId: resolved.competitionId,
        editionId: resolved.editionId,
        resultLabel: campaign.result || "No entry",
        openingPhase: Object.freeze({ kind: null, label: "Unavailable", record: null, note: null }),
        tournament: Object.freeze({ record: null, completeness: "none", label: "No entry" }),
        shootouts: Object.freeze({ won: 0, lost: 0 }),
        diagnostics: Object.freeze([]),
        phaseFixtureIds: Object.freeze([]),
        tournamentFixtureIds: Object.freeze([]),
        calledUp: campaign.calledUp,
        selectionLabel: null,
        live,
      });
    }
  }

  if (campaign.qualified === false || campaign.showcase) {
    return Object.freeze({
      competitionLabel,
      editionLabel,
      participantLabel: resolved.participantLabel,
      participantKind: resolved.participantKind,
      participantId: resolved.participantId,
      competitionId: resolved.competitionId,
      editionId: resolved.editionId,
      resultLabel: campaign.result || "Not entered",
      openingPhase: Object.freeze({ kind: null, label: "Unavailable", record: null, note: null }),
      tournament: Object.freeze({
        record: null,
        completeness: "none",
        label: "No entry",
      }),
      shootouts: Object.freeze({ won: 0, lost: 0 }),
      diagnostics: Object.freeze([]),
      phaseFixtureIds: Object.freeze([]),
      tournamentFixtureIds: Object.freeze([]),
      calledUp: campaign.calledUp,
      selectionLabel:
        campaign.calledUp === false && campaign.playerNationInTournament
          ? "Nation record · you were not selected"
          : null,
      live,
    });
  }

  const phaseSource = phaseFixturesFromCampaign(campaign);
  const totalSource = inventoryFixturesFromCampaign(campaign);

  const collectedPhase = collectRawPlayedFixtures(phaseSource, {
    visibleFixtureIds,
    competitionId: resolved.competitionId,
    editionId: resolved.editionId,
  });
  const collectedTotal = collectRawPlayedFixtures(totalSource, {
    visibleFixtureIds,
    competitionId: resolved.competitionId,
    editionId: resolved.editionId,
  });

  const phaseTally = tallyParticipantRecord(collectedPhase.fixtures, resolved.keys, {
    canonicalId: resolved.participantId,
  });
  const totalTally = tallyParticipantRecord(collectedTotal.fixtures, resolved.keys, {
    canonicalId: resolved.participantId,
  });
  const completeness = inventoryCompleteness(campaign, resolved, collectedPhase, collectedTotal, {
    live,
  });
  const diagnostics = [...collectedPhase.diagnostics, ...collectedTotal.diagnostics];
  const savedRow = savedPhaseRow(campaign, resolved);

  let tournamentBlock;
  let phaseRecord =
    openingKind === "league" || openingKind === "group" ? phaseTally.record : null;

  if (completeness === "contradiction") {
    tournamentBlock = {
      record: null,
      completeness,
      label: "Record unavailable (integrity conflict)",
    };
  } else if (completeness === "unavailable") {
    tournamentBlock = { record: null, completeness, label: "Record unavailable" };
  } else if (completeness === "table-only") {
    phaseRecord = recordFromSavedRow(savedRow) || phaseRecord;
    tournamentBlock = {
      record: null,
      completeness: "partial",
      label: "Record unavailable",
      phaseFromSavedTable: true,
    };
  } else if (completeness === "partial") {
    // Prefer the saved opening row when raw inventory under-covers it.
    const savedPlayed = savedRow ? Number(savedRow.played) || 0 : 0;
    if (savedRow && savedPlayed > (phaseTally.record?.played || 0)) {
      phaseRecord = recordFromSavedRow(savedRow) || phaseRecord;
    }
    // Withhold an exact tournament total when inventory is incomplete.
    tournamentBlock = {
      record: null,
      completeness,
      label: "Partial known record",
      knownMatches: totalTally.record,
      phaseFromSavedTable: Boolean(savedRow && savedPlayed > (phaseTally.record?.played || 0)),
    };
  } else if (completeness === "empty") {
    tournamentBlock = {
      record: freezeRecord(emptyRecord()),
      completeness,
      label: live ? "No matches revealed so far" : "No matches played",
    };
  } else {
    tournamentBlock = {
      record: totalTally.record,
      completeness,
      label: "Total tournament record",
    };
  }

  return Object.freeze({
    competitionLabel,
    editionLabel,
    participantLabel: resolved.participantLabel,
    participantKind: resolved.participantKind,
    participantId: resolved.participantId,
    competitionId: resolved.competitionId,
    editionId: resolved.editionId,
    resultLabel: campaign.result || null,
    openingPhase: Object.freeze({
      kind: openingKind,
      label: openingLabel,
      record: phaseRecord,
      note,
      fixtureIds: phaseTally.fixtureIds,
    }),
    tournament: Object.freeze(tournamentBlock),
    shootouts: Object.freeze({
      won: totalTally.record?.shootoutsWon || 0,
      lost: totalTally.record?.shootoutsLost || 0,
    }),
    diagnostics: Object.freeze(diagnostics),
    phaseFixtureIds: phaseTally.fixtureIds,
    tournamentFixtureIds: totalTally.fixtureIds,
    calledUp: campaign.calledUp,
    selectionLabel:
      campaign.calledUp === false && (campaign.playerNationInTournament || resolved.participantKind === "nation")
        ? "Nation record · you were not selected"
        : null,
    live,
    bracketRoundCount: (campaign.allRounds || []).length,
    playerPathRoundCount: (campaign.rounds || []).length,
  });
}

export function renderTournamentSummaryHtml(projection, { escapeHtml = (s) => String(s ?? "") } = {}) {
  if (!projection) return "";
  const lines = [];
  const title = [projection.participantLabel, projection.competitionLabel, projection.editionLabel]
    .filter(Boolean)
    .join(" · ");
  lines.push(`<div class="tournament-record-summary" data-completeness="${escapeHtml(
    projection.tournament?.completeness || ""
  )}">`);
  lines.push(`<p class="tournament-record-title"><strong>${escapeHtml(title)}</strong></p>`);
  if (projection.resultLabel) {
    lines.push(`<p>Result: ${escapeHtml(projection.resultLabel)}</p>`);
  }
  if (projection.selectionLabel) {
    lines.push(`<p class="tournament-selection-note">${escapeHtml(projection.selectionLabel)}</p>`);
  }
  if (projection.openingPhase?.label && projection.openingPhase.label !== "Unavailable") {
    lines.push(`<p>Opening phase: ${escapeHtml(projection.openingPhase.label)}</p>`);
  } else if (projection.openingPhase?.label === "Unavailable") {
    lines.push(`<p>Opening phase: Unavailable</p>`);
  }
  if (projection.openingPhase?.record) {
    const phaseName =
      projection.openingPhase.kind === "league" ? "League-phase record" : "Group-stage record";
    lines.push(
      `<p>${escapeHtml(phaseName)}: ${escapeHtml(formatRecordLine(projection.openingPhase.record, { shootouts: false }))}</p>`
    );
    if (projection.openingPhase.note) {
      lines.push(`<p class="tournament-phase-note">${escapeHtml(projection.openingPhase.note)}</p>`);
    }
  }
  if (projection.tournament?.completeness === "complete" || projection.tournament?.completeness === "empty") {
    if (projection.tournament.record) {
      lines.push(
        `<p>Total tournament record: ${escapeHtml(
          formatRecordLine(projection.tournament.record)
        )}</p>`
      );
    }
  } else if (projection.tournament?.label) {
    lines.push(`<p>${escapeHtml(projection.tournament.label)}</p>`);
    const known = projection.tournament.record || projection.tournament.knownMatches;
    if (projection.tournament.completeness === "partial" && known) {
      lines.push(`<p>Known matches: ${escapeHtml(formatRecordLine(known))}</p>`);
    }
  }
  if (projection.shootouts && (projection.shootouts.won || projection.shootouts.lost)) {
    lines.push(
      `<p class="tournament-shootout-note">Shootouts decide drawn matches after extra time; penalty kicks are not included in goals.</p>`
    );
  }
  if (projection.diagnostics?.length) {
    lines.push(
      `<p class="tournament-integrity-note">Integrity: ${escapeHtml(
        projection.diagnostics.map((d) => d.message || d.code).join("; ")
      )}</p>`
    );
  }
  if (projection.bracketRoundCount != null || projection.playerPathRoundCount != null) {
    lines.push(
      `<p class="tournament-round-meta">Your knockout path: ${
        projection.playerPathRoundCount ?? 0
      } round(s). Full bracket lists ${projection.bracketRoundCount ?? 0} round(s), including other ties and any placement match — not games won.</p>`
    );
  }
  lines.push("</div>");
  return lines.join("\n");
}

/**
 * Playback stage mode from revealed fixtures (not completed campaign final state).
 */
export function resolvePlaybackStageMode({
  campaign = null,
  visibleFixtureIds = null,
  participantType = "nation",
} = {}) {
  const vis =
    visibleFixtureIds == null
      ? null
      : visibleFixtureIds instanceof Set
        ? visibleFixtureIds
        : new Set(visibleFixtureIds);

  if (participantType === "club" || campaign?.leaguePhase || campaign?.focusClubId) {
    const openingDone = Boolean(
      campaign?.leaguePhase?.frozen ||
        campaign?.leaguePhase?.complete ||
        campaign?.groups?.frozen ||
        (campaign?.groups?.groups || []).length
    );
    if (!openingDone) return "table";
    if (vis == null) {
      // No visibility boundary supplied: treat as completed history → bracket when KO exists.
      return campaign?.allRounds?.length || campaign?.feederGraph ? "bracket" : "table";
    }
    if (vis.size === 0) return "table";
    const koVisible = (campaign?.allRounds || []).some((round) =>
      (round.matches || []).some((m) => {
        if (m?.isAggregate) {
          return (m.legs || []).some((leg) => {
            const id = matchIdOf(leg);
            return id && vis.has(id) && isPlayedRawMatch(leg);
          });
        }
        const id = matchIdOf(m);
        return id && vis.has(id) && !m.spoilerHidden && (m.homeGoals != null || m.matchHomeGoals != null || m.status === "played");
      })
    );
    return koVisible ? "bracket" : "table";
  }

  // National
  const groups = nationalGroupList(campaign);
  if (vis == null) {
    const openingComplete = groups.length
      ? groups.every((g) => (g.matches || []).length >= 6 || g.finalized)
      : false;
    const hasKo = Boolean((campaign?.allRounds || []).length || campaign?.qualification?.finalized);
    return hasKo && openingComplete ? "bracket" : "table";
  }
  if (vis.size === 0) return "table";
  const koMatches = (campaign?.allRounds || []).flatMap((r) => r.matches || []);
  const koVisible = koMatches.some((m) => {
    const id = matchIdOf(m);
    return id && vis.has(id) && !m.spoilerHidden;
  });
  return koVisible ? "bracket" : "table";
}

/** Independent oracle for tests/QA: tally from an explicit fixture list only. */
export function oracleTallyFromFixtures(fixtures, participantKeys, opts = {}) {
  const collected = collectRawPlayedFixtures(fixtures);
  return tallyParticipantRecord(collected.fixtures, participantKeys, opts);
}

const KO_STAGE_ORDER = Object.freeze({
  playoff: 10,
  R1: 15,
  R32: 20,
  R16: 30,
  QF: 40,
  SF: 50,
  placement: 55,
  "third-place": 55,
  Final: 60,
});

function playbackStageRank(match) {
  const type = match?.stageType;
  const id = match?.stageId;
  if (type === "group" || type === "league" || id === "group" || id === "league" || id === "groups") {
    return 0;
  }
  if (type === "placement" || id === "placement" || id === "third-place") return 55;
  if (id && KO_STAGE_ORDER[id] != null) return KO_STAGE_ORDER[id];
  if (type === "knockout") return 25;
  // Legacy fixtures: positive matchday without KO stage → opening phase.
  if (match?.matchday != null && Number(match.matchday) > 0 && !type) return 0;
  return 40;
}

function playbackStageBucket(match) {
  const rank = playbackStageRank(match);
  return rank === 0 ? "opening" : `ko:${rank}`;
}

function playbackBatchKey(match) {
  const bucket = playbackStageBucket(match);
  // Stage is always part of the key so same-date opening/KO never share a batch.
  if (match?.date) return `date:${match.date}:${bucket}`;
  const rank = playbackStageRank(match);
  if (rank === 0 && match?.matchday != null && Number(match.matchday) > 0) {
    return `md:${match.matchday}:${bucket}`;
  }
  // Documented legacy fallback: stage + identity when date is absent.
  return `stage:${match?.stageId || match?.stageType || "x"}:${match?.matchId || match?.fixtureId || "anon"}`;
}

/**
 * Chronological, stage-aware batches for competition playback.
 * Opening-phase fixtures precede knockout even when dates are missing or mixed.
 * Same-date (or legacy matchday) batches never mix group cards with knockout cards.
 */
export function groupCompetitionFixturesForPlayback(allMatches) {
  const sorted = [...(allMatches || [])].sort((a, b) => {
    // Stage separation always wins over date so undated opening stays before dated KO.
    const ra = playbackStageRank(a) - playbackStageRank(b);
    if (ra) return ra;
    const da = a?.date || "";
    const db = b?.date || "";
    if (da && db && da !== db) return da.localeCompare(db);
    if (da && !db) return -1;
    if (!da && db) return 1;
    const ma = Number(a?.matchday) || 0;
    const mb = Number(b?.matchday) || 0;
    if (ma !== mb) return ma - mb;
    return String(matchIdOf(a) || "").localeCompare(String(matchIdOf(b) || ""));
  });
  const groups = new Map();
  const order = [];
  for (const m of sorted) {
    const key = playbackBatchKey(m);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        matchday: m.matchday ?? null,
        date: m.date || null,
        stageRank: playbackStageRank(m),
        matches: [],
        playerMatches: [],
      });
      order.push(key);
    }
    const g = groups.get(key);
    g.matches.push(m);
    if (m.playerSide) g.playerMatches.push(m);
  }
  return order.map((k) => groups.get(k));
}

export function snapshotForImmutabilityCheck(value) {
  return cloneJson(value);
}

export const TOURNAMENT_PRESENTATION_CONTRACT = Object.freeze({
  stageDisplay: STAGE_DISPLAY,
  version: 1,
});
