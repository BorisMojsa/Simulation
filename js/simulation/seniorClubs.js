import { LEAGUES } from "../data/leagues.js";

/** Flatten senior clubs with league metadata. */
export function allSeniorClubs() {
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

export function findSeniorClub(clubName) {
  if (!clubName) return null;
  return allSeniorClubs().find((c) => c.name === clubName || c.displayName === clubName) ?? null;
}

export function findSeniorClubById(clubId) {
  if (!clubId) return null;
  return allSeniorClubs().find((c) => c.clubId === clubId) ?? null;
}
