import { clamp, randFloat } from "../utils/helpers.js";

const EUROPEAN_QUALIFYING_LEAGUES = new Set([
  "England - Premier League",
  "Spain - LaLiga",
  "Germany - Bundesliga",
  "Italy - Serie A",
  "France - Ligue 1",
  "Portugal - Liga Portugal",
  "Netherlands - Eredivisie",
  "Belgium - Jupiler Pro League",
  "Austria - Bundesliga",
  "Denmark - Superliga",
  "Russia - Premier Liga",
  "Türkiye - Süper Lig",
  "Scotland - Scottish Premiership",
  "Switzerland - Super League",
  "Norway - Eliteserien",
  "Sweden - Allsvenskan",
  "Poland - PKO BP Ekstraklasa",
  "Czech Republic - Chance Liga",
  "Croatia - SuperSport HNL",
  "Romania - SuperLiga",
  "Serbia - SuperLiga",
  "Israel - Ligat ha'Al",
  "Ukraine - Premier Liga",
  "Greece - Super League 1",
  "Bulgaria - efbet Liga",
]);

export function leagueMatchCount(league) {
  const teamCount = league?.clubs?.length ?? 20;
  return (teamCount - 1) * 2;
}

export function isEuropeanQualificationLeague(league) {
  return Boolean(league && EUROPEAN_QUALIFYING_LEAGUES.has(league.name));
}

export function qualificationForPosition(position, leagueOrTotalTeams) {
  const league = typeof leagueOrTotalTeams === "object" ? leagueOrTotalTeams : null;
  const totalTeams = league ? (league?.clubs?.length ?? 20) : leagueOrTotalTeams;

  if (position === 1) return "League Champions";

  if (league && isEuropeanQualificationLeague(league)) {
    if (position <= 4 && totalTeams >= 16) return "Champions League";
    if (position === 5 && totalTeams >= 16) return "Europa League";
    if (position === 6 && totalTeams >= 18) return "Conference League";
  }

  if (position > totalTeams - Math.max(2, Math.round(totalTeams * 0.1))) return "Relegated";
  return "";
}

export function generateLeagueTable(league, playerClubName, performanceScore, player) {
  const totalMatches = leagueMatchCount(league);
  const clubs = league.clubs.map((club) => ({
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
      const normalized = maxStrength === minStrength ? 0.5 : (club.strength - minStrength) / (maxStrength - minStrength);
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
    .map((entry, index, array) => ({
      ...entry,
      position: index + 1,
      qualification: qualificationForPosition(index + 1, league),
    }));

  const playerRecord = table.find((club) => club.name === playerClubName) || null;
  return { table, playerRecord };
}
