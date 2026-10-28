import { LEAGUES } from "../data/leagues.js";
import { getWorldState } from "./worldState.js";
import { resolveClubLeagueMetadata, staticClubById } from "./leagueMembership.js";

/** Flatten senior clubs with career-aware league metadata when a world is active. */
export function allSeniorClubs(world = getWorldState()) {
  if (!world?.leagueMemberships?.size) {
    return LEAGUES.flatMap((league) =>
      league.clubs.map((club) => ({
        name: club.name,
        displayName: club.displayName ?? club.name,
        clubId: club.clubId,
        badge: club.badge,
        financialTier: club.financialTier,
        reputation: club.reputation,
        overall: club.overall,
        attack: club.attack,
        midfield: club.midfield,
        defence: club.defence,
        goalkeeper: club.goalkeeper,
        strengthTier: club.strengthTier,
        tier: league.tier,
        divisionLevel: league.divisionLevel ?? club.divisionLevel,
        league: league.name,
        leagueDisplay: league.displayName,
        leagueId: league.leagueId,
        nation: league.nation,
      }))
    );
  }

  const out = [];
  const seen = new Set();
  for (const [leagueId, ids] of world.leagueMemberships.entries()) {
    const league = LEAGUES.find((l) => l.leagueId === leagueId);
    if (!league) continue;
    for (const clubId of ids || []) {
      if (!clubId || seen.has(clubId)) continue;
      seen.add(clubId);
      const seed = staticClubById(clubId);
      const meta = resolveClubLeagueMetadata(clubId, world);
      if (!seed && !meta) continue;
      out.push({
        name: seed?.name || meta?.name,
        displayName: seed?.displayName ?? seed?.name ?? meta?.name,
        clubId,
        badge: seed?.badge,
        financialTier: seed?.financialTier,
        reputation: seed?.reputation,
        overall: seed?.overall ?? world.clubs?.get(clubId)?.overall,
        attack: seed?.attack,
        midfield: seed?.midfield,
        defence: seed?.defence,
        goalkeeper: seed?.goalkeeper,
        strengthTier: seed?.strengthTier,
        tier: league.tier,
        divisionLevel: league.divisionLevel,
        league: league.name,
        leagueDisplay: league.displayName,
        leagueId: league.leagueId,
        nation: league.nation,
      });
    }
  }
  return out;
}

export function findSeniorClub(clubName) {
  if (!clubName) return null;
  return allSeniorClubs().find((c) => c.name === clubName || c.displayName === clubName) ?? null;
}

export function findSeniorClubById(clubId) {
  if (!clubId) return null;
  const meta = resolveClubLeagueMetadata(clubId);
  if (meta?.clubId) {
    return (
      allSeniorClubs().find((c) => c.clubId === clubId) || {
        ...meta,
        name: meta.name || staticClubById(clubId)?.name,
        displayName: meta.displayName || meta.name || staticClubById(clubId)?.displayName,
      }
    );
  }
  return allSeniorClubs().find((c) => c.clubId === clubId) ?? null;
}
