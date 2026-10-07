import { clamp, randFloat } from "../utils/helpers.js";

const EUROPEAN_QUALIFYING_LEAGUES = new Set([
  "England - Premier League",
  "Spain - La Liga",
  "Germany - Bundesliga",
  "Italy - Serie A",
  "France - Ligue 1",
  "Portugal - Primeira Liga",
  "Netherlands - Eredivisie",
  "Belgium - Belgian Pro League",
  "Denmark - Superliga",
  "Türkiye - Süper Lig",
  "Turkey - Süper Lig",
  "Norway - Eliteserien",
  "Poland - Ekstraklasa",
  "Czech Republic - Czech First League",
  "Croatia - Croatian HNL",
  "Serbia - Serbian SuperLiga",
]);

export function leagueMatchCount(league) {
  const teamCount = league?.clubs?.length ?? 20;
  return (teamCount - 1) * 2;
}

export function isEuropeanQualificationLeague(league) {
  return Boolean(league && EUROPEAN_QUALIFYING_LEAGUES.has(league.name));
}

/**
 * Sister leagues in the same nation: one step up / down by tier.
 * Only nations with both a top flight and a second division are linked.
 */
export function findSisterLeagues(league, allLeagues = []) {
  if (!league?.nation) return { higher: null, lower: null };
  const peers = (allLeagues || []).filter(
    (l) => l.nation === league.nation && l.name !== league.name
  );
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

/** Auto promotion/relegation band size between linked divisions. */
export function divisionMoveSlots(league, sisters) {
  const size = league?.clubs?.length ?? 20;
  // 18-team top flights often move 2; bigger second tiers can move 3.
  const band = size >= 22 ? 3 : 2;
  return {
    promoteSlots: sisters?.higher ? band : 0,
    // No relegation from the lowest league we have for that nation.
    relegateSlots: sisters?.lower ? band : 0,
  };
}

export function qualificationForPosition(position, leagueOrTotalTeams, sisters = null) {
  const league = typeof leagueOrTotalTeams === "object" ? leagueOrTotalTeams : null;
  const totalTeams = league ? (league?.clubs?.length ?? 20) : leagueOrTotalTeams;
  const links = sisters ?? { higher: null, lower: null };
  const { promoteSlots, relegateSlots } = divisionMoveSlots(league || { clubs: { length: totalTeams } }, links);

  if (position === 1) return "League Champions";

  if (league && isEuropeanQualificationLeague(league)) {
    if (position <= 4 && totalTeams >= 16) return "Champions League";
    if (position === 5 && totalTeams >= 16) return "Europa League";
    if (position === 6 && totalTeams >= 18) return "Conference League";
  }

  // Second division (or any league with a higher sister): promotion places
  if (promoteSlots > 0 && position <= promoteSlots) {
    return "Promoted";
  }

  // Top flight (or any league with a lower sister): relegation places only
  if (relegateSlots > 0 && position > totalTeams - relegateSlots) {
    return "Relegated";
  }

  return "";
}

function ensurePlayerClubInList(clubs, player, playerClubName) {
  if (!playerClubName) return clubs;
  if (clubs.some((c) => c.name === playerClubName)) return clubs;
  return [
    ...clubs,
    {
      name: player.club?.name ?? playerClubName,
      displayName: player.club?.displayName ?? player.club?.name ?? playerClubName,
      badge: player.club?.badge ?? null,
      financialTier: player.club?.financialTier ?? 2,
    },
  ];
}

export function generateLeagueTable(league, playerClubName, performanceScore, player, allLeagues = []) {
  const totalMatches = leagueMatchCount(league);
  const sisters = findSisterLeagues(league, allLeagues);
  const sourceClubs = ensurePlayerClubInList(league.clubs || [], player, playerClubName);

  const clubs = sourceClubs.map((club) => ({
    name: club.name,
    displayName: club.displayName ?? club.name,
    badge: club.badge,
    financialTier: club.financialTier,
    strength: club.financialTier * 12 + league.tier * 4 + randFloat(-6, 6),
  }));

  const playerEntry = clubs.find((club) => club.name === playerClubName);
  if (playerEntry) {
    const baseStrength = playerEntry.strength;
    const playerImpact = baseStrength < 60 ? 0.4 : 0.25;

    const ratingBoost = (player.rating - 65) * playerImpact;
    const formBoost = (performanceScore - 65) * (playerImpact * 0.7);
    playerEntry.strength += ratingBoost + formBoost + randFloat(-3, 3);
  }

  clubs.forEach((club) => {
    if (club !== playerEntry) {
      const variation = club.strength < 50 ? randFloat(-4, 4) : randFloat(-2, 2);
      club.strength += variation;
    }
  });

  const minStrength = Math.min(...clubs.map((club) => club.strength));
  const maxStrength = Math.max(...clubs.map((club) => club.strength));

  const table = clubs
    .map((club) => {
      const normalized =
        maxStrength === minStrength ? 0.5 : (club.strength - minStrength) / (maxStrength - minStrength);
      const winRatio = clamp(0.25 + normalized * 0.45 + randFloat(-0.08, 0.08), 0.18, 0.68);
      const drawRatio = clamp(0.2 + (0.5 - normalized) * 0.2 + randFloat(-0.06, 0.06), 0.1, 0.35);
      let wins = Math.round(winRatio * totalMatches);
      let draws = Math.round(drawRatio * totalMatches);
      let losses = totalMatches - wins - draws;
      if (losses < 0) {
        draws = Math.max(0, draws + losses);
        losses = totalMatches - wins - draws;
      }
      const points = wins * 3 + draws;
      const goalDiff = Math.round((wins - losses) * (0.9 + randFloat(-0.3, 0.3)));
      return {
        name: club.name,
        displayName: club.displayName,
        badge: club.badge,
        points,
        wins,
        draws,
        losses,
        matches: totalMatches,
        goalDiff,
        strength: club.strength + randFloat(-1, 1),
      };
    })
    .sort((a, b) => b.points - a.points || b.goalDiff - a.goalDiff || b.strength - a.strength)
    .map((entry, index) => ({
      ...entry,
      position: index + 1,
      qualification: qualificationForPosition(index + 1, league, sisters),
    }));

  // Champions in a promotion league are still promoted; keep the champions label.
  if (sisters.higher) {
    const { promoteSlots } = divisionMoveSlots(league, sisters);
    table.forEach((row) => {
      if (row.position <= promoteSlots && row.qualification === "League Champions") {
        row.divisionMove = "promoted";
      } else if (row.position <= promoteSlots) {
        row.divisionMove = "promoted";
      }
    });
  }
  if (sisters.lower) {
    const { relegateSlots } = divisionMoveSlots(league, sisters);
    const totalTeams = table.length;
    table.forEach((row) => {
      if (row.position > totalTeams - relegateSlots) {
        row.divisionMove = "relegated";
      }
    });
  }

  const playerRecord = table.find((club) => club.name === playerClubName) || null;
  return { table, playerRecord, sisters };
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

  player.club = {
    ...player.club,
    league: target.name,
    leagueDisplay: target.displayName ?? target.name,
    tier: target.tier,
    // Keep club identity; nudge financial power toward the new league.
    financialTier: Math.max(
      1,
      Math.round(((player.club.financialTier ?? target.financialPower ?? 2) + (target.financialPower ?? 2)) / 2)
    ),
  };

  return {
    type,
    from: currentLeague.displayName ?? currentLeague.name,
    to: target.displayName ?? target.name,
    league: target,
  };
}
