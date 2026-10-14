import { clamp } from "../utils/helpers.js";
import {
  isUefaQualifyingLeague,
  uefaSlotsForLeague,
  leagueIdFromName,
  AFC_TOP_FLIGHT_LEAGUE_IDS,
  CAF_TOP_FLIGHT_LEAGUE_IDS,
  AFC_ASSOCIATION_SLOTS,
  CAF_ASSOCIATION_SLOTS,
  associationIdForNation,
} from "../data/competitions/qualification.js";
import { attachClubIdentity, exchangeLeagueMembership, getWorldState } from "./worldState.js";

export function leagueMatchCount(league) {
  const teamCount = league?.clubs?.length ?? 20;
  return (teamCount - 1) * 2;
}

export function isEuropeanQualificationLeague(league) {
  return isUefaQualifyingLeague(league);
}

/**
 * Sister leagues in the same nation: one step up / down by divisionLevel, then tier.
 */
export function findSisterLeagues(league, allLeagues = []) {
  if (!league?.nation) return { higher: null, lower: null };
  const peers = (allLeagues || []).filter(
    (l) => l.nation === league.nation && l.name !== league.name
  );
  const div = league.divisionLevel ?? 1;
  const higherByDiv =
    peers
      .filter((l) => (l.divisionLevel ?? 99) < div)
      .sort((a, b) => (b.tier ?? 0) - (a.tier ?? 0))[0] ?? null;
  const lowerByDiv =
    peers
      .filter((l) => (l.divisionLevel ?? 0) > div)
      .sort((a, b) => (b.tier ?? 0) - (a.tier ?? 0))[0] ?? null;

  if (higherByDiv || lowerByDiv) {
    return { higher: higherByDiv, lower: lowerByDiv };
  }

  // Fallback: legacy tier ordering (higher tier number = stronger / higher division in this project)
  const higher =
    peers
      .filter((l) => (l.tier ?? 0) > (league.tier ?? 0))
      .sort((a, b) => a.tier - b.tier)[0] ?? null;
  const lower =
    peers
      .filter((l) => (l.tier ?? 0) < (league.tier ?? 0))
      .sort((a, b) => b.tier - a.tier)[0] ?? null;
  return { higher, lower };
}

export function divisionMoveSlots(league, sisters) {
  const size = league?.clubs?.length ?? 20;
  const band = size >= 22 ? 3 : 2;
  return {
    promoteSlots: sisters?.higher ? band : 0,
    relegateSlots: sisters?.lower ? band : 0,
  };
}

export function qualificationForPosition(position, leagueOrTotalTeams, sisters = null) {
  const league = typeof leagueOrTotalTeams === "object" ? leagueOrTotalTeams : null;
  const totalTeams = league ? (league?.clubs?.length ?? 20) : leagueOrTotalTeams;
  const links = sisters ?? { higher: null, lower: null };
  const { promoteSlots, relegateSlots } = divisionMoveSlots(
    league || { clubs: { length: totalTeams } },
    links
  );

  if (position === 1) return "League Champions";

  if (league && isUefaQualifyingLeague(league)) {
    const slots = uefaSlotsForLeague(league) || { cl: 1, el: 1, uecl: 1 };
    // Position 1 already returned as League Champions (counts as the first CL place).
    // Remaining direct CL places: 2 .. slots.cl
    if (position > 1 && position <= slots.cl) return "Champions League";
    let cursor = slots.cl;
    for (let i = 0; i < slots.el; i++) {
      cursor += 1;
      if (position === cursor) return "Europa League";
    }
    for (let i = 0; i < slots.uecl; i++) {
      cursor += 1;
      if (position === cursor) return "Conference League";
    }
  }

  const leagueId = league ? league.leagueId || leagueIdFromName(league.name) : null;
  if (league && leagueId && AFC_TOP_FLIGHT_LEAGUE_IDS.has(leagueId)) {
    const slots = AFC_ASSOCIATION_SLOTS[associationIdForNation(league.nation)] || { elite: 2 };
    if (position > 1 && position <= slots.elite) return "AFC Champions League Elite";
  }
  if (league && leagueId && CAF_TOP_FLIGHT_LEAGUE_IDS.has(leagueId)) {
    const slots = CAF_ASSOCIATION_SLOTS[associationIdForNation(league.nation)] || { cl: 2 };
    if (position > 1 && position <= slots.cl) return "CAF Champions League";
  }

  if (promoteSlots > 0 && position <= promoteSlots) {
    return "Promoted";
  }

  if (relegateSlots > 0 && position > totalTeams - relegateSlots) {
    return "Relegated";
  }

  return "";
}

/**
 * @deprecated Standings must come from simulateLeagueSeason fixtures.
 * Kept as a thin adapter that throws if misused without a table.
 */
export function generateLeagueTable() {
  throw new Error(
    "generateLeagueTable is retired. Use simulateLeagueSeason() so standings come from shared match results."
  );
}

/** Move the player's club registration into a sister division after the season. */
export function applyDivisionMovement(player, playerRecord, currentLeague, allLeagues = []) {
  if (!player?.club || !playerRecord || !currentLeague) return null;
  const sisters = findSisterLeagues(currentLeague, allLeagues);
  const { promoteSlots, relegateSlots } = divisionMoveSlots(currentLeague, sisters);
  const totalTeams = currentLeague.clubs?.length ?? playerRecord.position;

  let target = null;
  let type = null;

  if (sisters.higher && playerRecord.position <= promoteSlots) {
    target = sisters.higher;
    type = "promoted";
  } else if (sisters.lower && playerRecord.position > totalTeams - relegateSlots) {
    target = sisters.lower;
    type = "relegated";
  }

  if (!target || !type) return null;

  const club = attachClubIdentity(player.club);
  const fromId = currentLeague.leagueId || leagueIdFromName(currentLeague.name);
  const toId = target.leagueId || leagueIdFromName(target.name);
  const world = getWorldState();
  if (world && club.clubId) {
    exchangeLeagueMembership(world, fromId, toId, club.clubId);
  }

  player.club = {
    ...club,
    league: target.name,
    leagueDisplay: target.displayName ?? target.name,
    leagueId: toId,
    tier: target.tier,
    divisionLevel: target.divisionLevel ?? club.divisionLevel,
    // Keep sporting quality; finance may drift slightly toward new league environment for wages only.
    financialTier: clamp(
      Math.round(
        ((club.financialTier ?? target.financialPower ?? 2) + (target.financialPower ?? 2)) / 2
      ),
      1,
      5
    ),
  };

  return {
    type,
    from: currentLeague.displayName ?? currentLeague.name,
    to: target.displayName ?? target.name,
    league: target,
    clubId: club.clubId,
  };
}
