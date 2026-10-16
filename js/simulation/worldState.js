import {
  CLUB_STRENGTH_SNAPSHOT_DATE,
  CLUB_STRENGTH_BASELINE_SNAPSHOT_ID,
  CLUB_STRENGTH_TRANSFORM_VERSION,
} from "../data/strength/clubProfiles.generated.js?v=59";
import {
  NATION_PROFILES,
  NATION_STRENGTH_SNAPSHOT_DATE,
  NATION_STRENGTH_BASELINE_SNAPSHOT_ID,
  NATION_STRENGTH_TRANSFORM_VERSION,
  NATION_STRENGTH_CONTENT_HASH,
  NATION_STRENGTH_NORMALIZATION_VERSION,
} from "../data/strength/nationProfiles.js?v=59";
import { CLUB_PROFILES, resolveClub } from "../data/identity/resolver.js";
import { LEAGUES } from "../data/leagues.js";
import { createRng, hashSeed, reseedCareerRng, setSimRng, getSimRng } from "./rng.js";
import { clamp } from "../utils/helpers.js";

export const WORLD_STATE_SCHEMA_VERSION = 3;

function cloneProfile(p) {
  return {
    ...p,
    replacementOvr: { ...(p.replacementOvr || {}) },
    aliases: [...(p.aliases || [])],
    sourceConflict: p.sourceConflict ? { ...p.sourceConflict } : null,
    evidenceSourceIds: [...(p.evidenceSourceIds || [])],
    agreeingPointSourceIds: [...(p.agreeingPointSourceIds || [])],
    sourceUrls: [...(p.sourceUrls || [])],
  };
}

function freezeClubBaseline(p) {
  return {
    overall: p.overall,
    attack: p.attack,
    midfield: p.midfield,
    defence: p.defence,
    goalkeeper: p.goalkeeper,
    sourceStatus: p.sourceStatus || p.sourceType,
    ratingSourceStatus: p.ratingSourceStatus || p.sourceStatus || p.sourceType || null,
    strengthDerivationStatus: p.strengthDerivationStatus || null,
    sourceRating: p.sourceRating ?? null,
    primaryScaleRating: p.primaryScaleRating ?? null,
    provider: p.provider || null,
    sourceSnapshotId: p.sourceSnapshotId || null,
    calibrationId: p.calibrationId || null,
    transformVersion: p.transformVersion || null,
  };
}

function freezeNationBaseline(p) {
  return {
    nationId: p.nationId,
    overall: p.overall,
    overallExact: p.overallExact ?? p.overall,
    attack: p.attack,
    midfield: p.midfield,
    defence: p.defence,
    goalkeeper: p.goalkeeper,
    replacementOvr: { ...(p.replacementOvr || {}) },
    fifaPoints: p.fifaPoints ?? null,
    sourceRating: p.fifaPoints ?? p.sourceRating ?? null,
    sourceStatus: p.sourceStatus || p.sourceType,
    ratingSourceStatus: p.ratingSourceStatus || p.sourceStatus || p.sourceType || null,
    strengthDerivationStatus: p.strengthDerivationStatus || null,
    sourceEvidenceTier: p.sourceEvidenceTier || null,
    directPrimaryPointsVerified: p.directPrimaryPointsVerified === true,
    provider: p.provider || null,
    publisher: p.publisher || null,
    evidenceRef: p.evidenceRef || null,
    evidenceSourceIds: [...(p.evidenceSourceIds || [])],
    sourceUrls: [...(p.sourceUrls || [])],
    sourceSnapshotId: p.sourceSnapshotId || null,
    datasetId: p.datasetId || p.baselineSnapshotId || null,
    contentHash: p.contentHash || null,
    normalizationVersion: p.normalizationVersion || null,
    transformVersion: p.transformVersion || null,
    sourceConflict: p.sourceConflict ? { ...p.sourceConflict } : null,
    legacyGameplayPointsPrior:
      p.fifaPoints === 1180 || p.previousGameplayPointsPrior === 1180
        ? 1180
        : p.legacyGameplayPointsPrior ?? null,
  };
}

function freezeBaselineProfiles(profiles, idKey, freezer) {
  const frozen = {};
  for (const p of profiles) {
    frozen[p[idKey]] = freezer(p);
  }
  return frozen;
}

/** Freeze baselines from an already-loaded career nation map (legacy migration). */
function freezeNationsFromLiveMap(nationsMap) {
  const frozen = {};
  for (const [id, p] of nationsMap.entries?.() || Object.entries(nationsMap || {})) {
    if (!p) continue;
    frozen[id] = freezeNationBaseline({
      ...p,
      nationId: p.nationId || id,
      legacyGameplayPointsPrior:
        p.fifaPoints === 1180 ? 1180 : p.legacyGameplayPointsPrior ?? null,
    });
  }
  return frozen;
}

function migrateNationBaselines(baselineNations) {
  if (!baselineNations) return null;
  const out = {};
  for (const [id, b] of Object.entries(baselineNations)) {
    const legacyPrior =
      b.legacyGameplayPointsPrior ??
      (b.sourceRating === 1180 || b.fifaPoints === 1180 || b.ratingSourceStatus === "unresolved"
        ? 1180
        : null);
    out[id] = {
      ...b,
      nationId: b.nationId || id,
      fifaPoints: b.fifaPoints ?? b.sourceRating ?? null,
      sourceEvidenceTier: b.sourceEvidenceTier ?? null,
      directPrimaryPointsVerified: b.directPrimaryPointsVerified === true,
      legacyGameplayPointsPrior: legacyPrior,
      sourceConflict: b.sourceConflict || null,
    };
  }
  return out;
}

/**
 * Career-scoped world: mutable club/nation profiles, memberships, form, ledger.
 * Baseline snapshot IDs + frozen seed qualities are stored so a later rebuild of
 * bundled data cannot silently rewrite an in-progress career.
 */
export function createWorldState({ seed = null, startYear = 2026 } = {}) {
  const careerSeed = seed ?? hashSeed(`career:${Date.now()}:${Math.random()}`);
  const rng = createRng(careerSeed);
  setSimRng(rng);
  reseedCareerRng(careerSeed);

  const clubs = new Map();
  for (const p of CLUB_PROFILES) {
    clubs.set(p.clubId, cloneProfile(p));
  }

  const nations = new Map();
  for (const p of NATION_PROFILES) {
    nations.set(p.nationId, cloneProfile(p));
  }

  const leagueMemberships = new Map();
  for (const league of LEAGUES) {
    const ids = league.clubs.map((c) => c.clubId).filter(Boolean);
    leagueMemberships.set(league.leagueId || league.name, [...ids]);
  }

  return {
    schemaVersion: WORLD_STATE_SCHEMA_VERSION,
    snapshotDate: CLUB_STRENGTH_SNAPSHOT_DATE,
    nationSnapshotDate: NATION_STRENGTH_SNAPSHOT_DATE,
    clubBaselineSnapshotId: CLUB_STRENGTH_BASELINE_SNAPSHOT_ID,
    nationBaselineSnapshotId: NATION_STRENGTH_BASELINE_SNAPSHOT_ID,
    nationContentHash: NATION_STRENGTH_CONTENT_HASH,
    nationNormalizationVersion: NATION_STRENGTH_NORMALIZATION_VERSION,
    transformVersion: CLUB_STRENGTH_TRANSFORM_VERSION || NATION_STRENGTH_TRANSFORM_VERSION,
    baselineClubs: freezeBaselineProfiles(CLUB_PROFILES, "clubId", freezeClubBaseline),
    baselineNations: freezeBaselineProfiles(NATION_PROFILES, "nationId", freezeNationBaseline),
    seasonYear: startYear,
    rngSeed: careerSeed,
    rngState: rng.seed(),
    clubs,
    nations,
    leagueMemberships,
    form: new Map(),
    standings: new Map(),
    cupResults: new Map(),
    qualification: new Map(),
    editions: new Map(),
    matches: new Map(),
    ties: new Map(),
    fixtureLedger: [],
    formAppliedFixtures: new Set(),
    notes: {
      persistence: "session-only; serializeWorldState/deserializeWorldState provided for round-trips",
      baselinePolicy:
        "Careers keep frozen baselineClubs/baselineNations from creation time; future bundled rebuilds do not overwrite an active career's seed qualities.",
      nationMigration:
        "schemaVersion<3 careers without baselineNations freeze values from their live nations map and mark legacyGameplayPointsPrior=1180 where applicable; they are never upgraded in place to the new secondary inventory.",
    },
  };
}

let activeWorld = null;

export function getWorldState() {
  return activeWorld;
}

export function setWorldState(world) {
  activeWorld = world;
  if (world?.rngState != null) {
    const rng = createRng(world.rngSeed || 1);
    rng.setSeed(world.rngState);
    setSimRng(rng);
  }
  return activeWorld;
}

export function ensureWorldState(player) {
  if (activeWorld) return activeWorld;
  const world = createWorldState({ startYear: player?.startYear || 2026 });
  setWorldState(world);
  return world;
}

export function serializeWorldState(world = activeWorld) {
  if (!world) return null;
  // Club finance ledgers live beside world state for career snapshots.
  let clubFinance = null;
  try {
    // Dynamic import avoided for sync serialize; callers of careerSnapshot attach finance.
    clubFinance = world.clubFinance || null;
  } catch {
    clubFinance = null;
  }
  return {
    schemaVersion: world.schemaVersion,
    snapshotDate: world.snapshotDate,
    nationSnapshotDate: world.nationSnapshotDate,
    clubBaselineSnapshotId: world.clubBaselineSnapshotId,
    nationBaselineSnapshotId: world.nationBaselineSnapshotId,
    nationContentHash: world.nationContentHash,
    nationNormalizationVersion: world.nationNormalizationVersion,
    transformVersion: world.transformVersion,
    baselineClubs: world.baselineClubs,
    baselineNations: world.baselineNations,
    seasonYear: world.seasonYear,
    rngSeed: world.rngSeed,
    rngState: getSimRng().seed(),
    clubs: [...world.clubs.entries()],
    nations: [...world.nations.entries()],
    leagueMemberships: [...world.leagueMemberships.entries()],
    form: [...world.form.entries()],
    standings: [...world.standings.entries()],
    cupResults: [...world.cupResults.entries()],
    qualification: [...world.qualification.entries()],
    editions: [...(world.editions || new Map()).entries()],
    matches: [...(world.matches || new Map()).entries()],
    ties: [...(world.ties || new Map()).entries()],
    fixtureLedger: world.fixtureLedger,
    formAppliedFixtures: [...(world.formAppliedFixtures || [])],
    clubFinance,
    notes: world.notes,
  };
}

export function deserializeWorldState(data) {
  if (!data) return null;

  const nations = new Map(data.nations || []);
  let baselineNations = migrateNationBaselines(data.baselineNations);
  if (!baselineNations) {
    // Legacy career: never replace with the current bundled snapshot.
    baselineNations = nations.size
      ? freezeNationsFromLiveMap(nations)
      : freezeBaselineProfiles(NATION_PROFILES, "nationId", freezeNationBaseline);
  }

  const world = {
    schemaVersion: data.schemaVersion ?? WORLD_STATE_SCHEMA_VERSION,
    snapshotDate: data.snapshotDate,
    nationSnapshotDate: data.nationSnapshotDate,
    clubBaselineSnapshotId: data.clubBaselineSnapshotId || CLUB_STRENGTH_BASELINE_SNAPSHOT_ID,
    nationBaselineSnapshotId: data.nationBaselineSnapshotId || null,
    nationContentHash: data.nationContentHash || null,
    nationNormalizationVersion: data.nationNormalizationVersion || null,
    transformVersion: data.transformVersion || CLUB_STRENGTH_TRANSFORM_VERSION,
    baselineClubs: data.baselineClubs || freezeBaselineProfiles(CLUB_PROFILES, "clubId", freezeClubBaseline),
    baselineNations,
    seasonYear: data.seasonYear,
    rngSeed: data.rngSeed,
    rngState: data.rngState,
    clubs: new Map(data.clubs || []),
    nations,
    leagueMemberships: new Map(data.leagueMemberships || []),
    form: new Map(data.form || []),
    standings: new Map(data.standings || []),
    cupResults: new Map(data.cupResults || []),
    qualification: new Map(data.qualification || []),
    editions: new Map(data.editions || []),
    matches: new Map(data.matches || []),
    ties: new Map(data.ties || []),
    fixtureLedger: data.fixtureLedger || [],
    formAppliedFixtures: new Set(data.formAppliedFixtures || []),
    notes: data.notes,
  };
  setWorldState(world);
  return world;
}

/** Update short-term form from a decided match (once per fixture identity). */
export function applyMatchFormUpdate(world, match) {
  if (!world || !match || match.isBye) return;
  if (!(world.formAppliedFixtures instanceof Set)) {
    world.formAppliedFixtures = new Set(world.formAppliedFixtures || []);
  }
  const fixtureKey =
    match.matchId || match.fixtureId || match._formKey || null;
  if (fixtureKey && world.formAppliedFixtures.has(fixtureKey)) return;
  if (!fixtureKey && match._formApplied) return;
  match._formApplied = true;
  if (fixtureKey) world.formAppliedFixtures.add(fixtureKey);

  const homeId = match.home?.clubId || match.home?.nationId || match.home?.name;
  const awayId = match.away?.clubId || match.away?.nationId || match.away?.name;
  if (!homeId || !awayId) return;

  const homeGoals = match.matchHomeGoals ?? match.homeGoals;
  const awayGoals = match.matchAwayGoals ?? match.awayGoals;
  let homeResult = 0.5;
  if (homeGoals > awayGoals) homeResult = 1;
  else if (homeGoals < awayGoals) homeResult = 0;

  const homeEff = match.effectiveStrength?.home?.overall ?? 70;
  const awayEff = match.effectiveStrength?.away?.overall ?? 70;
  const expectedHome = 1 / (1 + Math.pow(10, (awayEff - homeEff) / 20));

  bumpForm(world, homeId, homeResult - expectedHome);
  bumpForm(world, awayId, (1 - homeResult) - (1 - expectedHome));

  // Modest Elo-style residual on overall (bounded); not driven by finance.
  const k = 0.35;
  const homeClub = world.clubs.get(homeId) || world.nations.get(homeId);
  const awayClub = world.clubs.get(awayId) || world.nations.get(awayId);
  if (homeClub && awayClub) {
    const delta = k * (homeResult - expectedHome);
    adjustQuality(homeClub, delta);
    adjustQuality(awayClub, -delta);
  }

  world.fixtureLedger.push({
    fixtureId: match.fixtureId || null,
    competitionId: match.competitionId || match.competition,
    homeId,
    awayId,
    homeGoals,
    awayGoals,
    decidedBy: match.decidedBy,
    winnerSide: match.winnerSide,
  });
}

function bumpForm(world, id, delta) {
  const prev = world.form.get(id) || { form: 0 };
  const form = clamp(prev.form * 0.85 + delta * 2.2, -2.5, 2.5);
  world.form.set(id, { form: Number(form.toFixed(3)) });
}

function adjustQuality(profile, delta) {
  const d = clamp(delta, -0.45, 0.45);
  profile.overall = clamp(Number((profile.overall + d).toFixed(2)), 30, 96);
  profile.attack = clamp(Number((profile.attack + d * 0.9).toFixed(2)), 28, 96);
  profile.midfield = clamp(Number((profile.midfield + d).toFixed(2)), 28, 96);
  profile.defence = clamp(Number((profile.defence + d * 0.9).toFixed(2)), 28, 96);
  profile.goalkeeper = clamp(Number((profile.goalkeeper + d * 0.7).toFixed(2)), 28, 96);
  // Refresh replacement band gently
  if (profile.replacementOvr) {
    for (const k of Object.keys(profile.replacementOvr)) {
      profile.replacementOvr[k] = Math.round(clamp(profile.replacementOvr[k] + d * 0.5, 40, 93));
    }
  }
}

/**
 * End-of-season squad development: finance aids recruitment potential slowly;
 * does not grant a direct match bonus.
 */
export function applySeasonDevelopment(world) {
  if (!world) return;
  for (const profile of world.clubs.values()) {
    const financePull = ((profile.financialPower || 2) - 3) * 0.08;
    const meanRevert = (72 - profile.overall) * 0.02;
    const noise = (hashSeed(profile.clubId + ":" + world.seasonYear) % 100) / 100 - 0.5;
    const delta = clamp(financePull + meanRevert + noise * 0.15, -0.6, 0.6);
    adjustQuality(profile, delta);
  }
  world.seasonYear += 1;
  // Decay form
  for (const [id, entry] of world.form.entries()) {
    world.form.set(id, { form: clamp(entry.form * 0.35, -1.5, 1.5) });
  }
}

/** Promotion/relegation: swap membership lists, keep clubIds. */
export function exchangeLeagueMembership(world, fromLeagueId, toLeagueId, clubId) {
  if (!world || !clubId) return false;
  const from = world.leagueMemberships.get(fromLeagueId);
  const to = world.leagueMemberships.get(toLeagueId);
  if (!from || !to) return false;
  const idx = from.indexOf(clubId);
  if (idx === -1) return false;
  from.splice(idx, 1);
  if (!to.includes(clubId)) to.push(clubId);
  const club = world.clubs.get(clubId);
  if (club) {
    club.leagueId = toLeagueId;
  }
  return true;
}

export function attachClubIdentity(clubLike) {
  if (!clubLike) return clubLike;
  if (clubLike.clubId && clubLike.overall != null) return clubLike;
  const resolveTarget =
    clubLike.isAcademy && (clubLike.parentClub?.name || clubLike.parentClub?.clubId)
      ? clubLike.parentClub
      : clubLike;
  const r = resolveClub(resolveTarget);
  if (!r.ok) return clubLike;
  return {
    ...clubLike,
    // Keep academy identity; borrow senior sporting numbers when missing.
    clubId: clubLike.clubId ?? (clubLike.isAcademy ? undefined : r.profile.clubId),
    overall: clubLike.overall ?? r.profile.overall,
    attack: clubLike.attack ?? r.profile.attack,
    midfield: clubLike.midfield ?? r.profile.midfield,
    defence: clubLike.defence ?? r.profile.defence,
    goalkeeper: clubLike.goalkeeper ?? r.profile.goalkeeper,
    financialTier: clubLike.financialTier ?? r.profile.financialPower,
    reputation: clubLike.reputation ?? r.profile.reputation,
  };
}
