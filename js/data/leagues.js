import LEAGUE_DEFINITIONS from "../../league-data.js";
import { BADGE_BASE_PATH } from "../config/playerConfig.js";
import { CLUB_FINANCIAL_OVERRIDES } from "../config/clubFinancialOverrides.js";
import { slugify } from "../utils/helpers.js";

const ACTIVE_CLUB_FINANCIAL_OVERRIDES = (() => {
  const validClubNames = new Set();
  LEAGUE_DEFINITIONS.forEach((league) => {
    league.clubs.forEach((club) => {
      if (club.name) validClubNames.add(club.name);
      if (club.displayName) validClubNames.add(club.displayName);
    });
  });

  return Object.fromEntries(
    Object.entries(CLUB_FINANCIAL_OVERRIDES).filter(([name]) => validClubNames.has(name))
  );
})();

export const LEAGUES = LEAGUE_DEFINITIONS.map((league) => {
  const { clubs, badgeFolder, ...leagueMeta } = league;
  const leagueName = leagueMeta.name;
  const leagueDisplayName = leagueMeta.displayName ?? leagueName;
  const leagueSlug = slugify(leagueName);
  const leagueBadgeDir = badgeFolder ?? `${BADGE_BASE_PATH}/${leagueSlug}`;
  return {
    ...leagueMeta,
    name: leagueName,
    displayName: leagueDisplayName,
    badgeFolder: leagueBadgeDir,
    slug: leagueSlug,
    clubs: clubs.map((club) => {
      const clubName = club.name;
      const clubDisplayName = club.displayName ?? clubName;
      const clubSlug = slugify(clubName);
      const badgePath = club.badge ?? `${leagueBadgeDir}/${club.displayName ?? clubName}.png`;
      const financialTier =
        ACTIVE_CLUB_FINANCIAL_OVERRIDES[clubName] ??
        (club.displayName ? ACTIVE_CLUB_FINANCIAL_OVERRIDES[club.displayName] : undefined) ??
        leagueMeta.financialPower;
      return {
        name: clubName,
        displayName: clubDisplayName,
        slug: clubSlug,
        badge: badgePath,
        financialTier,
        tier: leagueMeta.tier,
        league: leagueName,
        leagueDisplay: leagueDisplayName,
      };
    }),
  };
});

export const LEAGUE_LOOKUP = new Map(LEAGUES.map((league) => [league.name, league]));

export const ACADEMY_POOL = LEAGUES.flatMap((league) =>
  league.clubs.map((club) => ({
    name: `${club.displayName ?? club.name} Academy`,
    league: league.name,
    leagueDisplay: league.displayName,
    tier: Math.max(1, league.tier - 2),
    badge: club.badge,
    financialTier: Math.max(1, club.financialTier - 1),
    isAcademy: true,
    parentClub: {
      name: club.name,
      displayName: club.displayName,
      league: league.name,
      leagueDisplay: league.displayName,
      tier: league.tier,
      badge: club.badge,
      financialTier: club.financialTier,
    },
  }))
);
