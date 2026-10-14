import LEAGUE_DEFINITIONS from "../../league-data.js";
import { BADGE_BASE_PATH } from "../config/playerConfig.js";
import { CLUB_FINANCIAL_OVERRIDES, FINANCIAL_ALIAS_LOOKUP } from "../config/clubFinancialOverrides.js";
import { slugify } from "../utils/helpers.js";
import { normalizeName } from "./identity/normalize.js";
import { resolveClub } from "./identity/resolver.js";
import { leagueIdFromName } from "./competitions/qualification.js";
import { tierLabelFromQuality } from "./strength/scale.js";
import { AFC_CAF_LEAGUE_DEFINITIONS } from "./strength/afcCafClubSupplement.js?v=1";

function financialTierForClub(clubName, displayName, leagueFinancialPower) {
  const keys = [clubName, displayName].filter(Boolean);
  for (const k of keys) {
    if (CLUB_FINANCIAL_OVERRIDES[k] != null) return CLUB_FINANCIAL_OVERRIDES[k];
  }
  for (const k of keys) {
    const aliasTier = FINANCIAL_ALIAS_LOOKUP[normalizeName(k)];
    if (aliasTier != null) return aliasTier;
  }
  // Documented fallback: league financialPower when no club override matches.
  return leagueFinancialPower;
}

const DIVISION_LEVEL_BY_LEAGUE = {
  "England - Premier League": 1,
  "England - Championship": 2,
  "Germany - Bundesliga": 1,
  "Germany - 2. Bundesliga": 2,
  "Spain - La Liga": 1,
  "Spain - LaLiga 2": 2,
  "Italy - Serie A": 1,
  "Italy - Serie B": 2,
  "France - Ligue 1": 1,
  "France - Ligue 2": 2,
};

const ALL_LEAGUE_DEFINITIONS = [...LEAGUE_DEFINITIONS, ...AFC_CAF_LEAGUE_DEFINITIONS];

export const LEAGUES = ALL_LEAGUE_DEFINITIONS.map((league) => {
  const { clubs, badgeFolder, ...leagueMeta } = league;
  const leagueName = leagueMeta.name;
  const leagueDisplayName = leagueMeta.displayName ?? leagueName;
  const leagueSlug = slugify(leagueName);
  const leagueBadgeDir = badgeFolder ?? `${BADGE_BASE_PATH}/${leagueSlug}`;
  const leagueId = leagueIdFromName(leagueName);
  const divisionLevel =
    DIVISION_LEVEL_BY_LEAGUE[leagueName] ??
    (leagueMeta.tier >= 4 ? 1 : leagueMeta.tier >= 3 ? 1 : 1);

  return {
    ...leagueMeta,
    name: leagueName,
    displayName: leagueDisplayName,
    badgeFolder: leagueBadgeDir,
    slug: leagueSlug,
    leagueId,
    // Historical "tier" remains a quality-ish ranking (higher = stronger league context).
    // divisionLevel is the explicit top-flight / second-division membership.
    divisionLevel: DIVISION_LEVEL_BY_LEAGUE[leagueName] ?? divisionLevel,
    clubs: clubs.map((club) => {
      const clubName = club.name;
      const clubDisplayName = club.displayName ?? clubName;
      const clubSlug = slugify(clubName);
      const badgePath = club.badge ?? `${leagueBadgeDir}/${club.displayName ?? clubName}.png`;
      const financialTier = financialTierForClub(
        clubName,
        clubDisplayName,
        leagueMeta.financialPower
      );
      const resolved = resolveClub(clubName, { nationHint: leagueMeta.nation });
      const profile = resolved.ok ? resolved.profile : null;
      return {
        name: clubName,
        displayName: clubDisplayName,
        slug: clubSlug,
        badge: badgePath,
        clubId: profile?.clubId || `club:${normalizeName(clubName).replace(/\s+/g, "-")}`,
        financialTier,
        reputation: profile?.reputation ?? financialTier * 16,
        overall: profile?.overall ?? null,
        attack: profile?.attack ?? null,
        midfield: profile?.midfield ?? null,
        defence: profile?.defence ?? null,
        goalkeeper: profile?.goalkeeper ?? null,
        strengthTier: profile ? tierLabelFromQuality(profile.overall) : null,
        tier: leagueMeta.tier,
        divisionLevel: DIVISION_LEVEL_BY_LEAGUE[leagueName] ?? 1,
        league: leagueName,
        leagueDisplay: leagueDisplayName,
        leagueId,
        nation: leagueMeta.nation,
        associationId: profile?.associationId || null,
        confederation: profile?.confederation || null,
      };
    }),
  };
});

export const LEAGUE_LOOKUP = new Map(LEAGUES.map((league) => [league.name, league]));
export const LEAGUE_BY_ID = new Map(LEAGUES.map((league) => [league.leagueId, league]));

export const ACADEMY_POOL = LEAGUES.flatMap((league) =>
  league.clubs.map((club) => ({
    name: `${club.displayName ?? club.name} Academy`,
    displayName: `${club.displayName ?? club.name} Academy`,
    league: league.name,
    leagueDisplay: league.displayName,
    leagueId: league.leagueId,
    nation: league.nation,
    tier: Math.max(1, league.tier - 2),
    badge: club.badge,
    financialTier: Math.max(1, club.financialTier - 1),
    isAcademy: true,
    parentClub: {
      name: club.name,
      displayName: club.displayName,
      clubId: club.clubId,
      league: league.name,
      leagueDisplay: league.displayName,
      leagueId: league.leagueId,
      nation: league.nation,
      tier: league.tier,
      divisionLevel: league.divisionLevel,
      badge: club.badge,
      financialTier: club.financialTier,
      reputation: club.reputation,
      overall: club.overall,
      attack: club.attack,
      midfield: club.midfield,
      defence: club.defence,
      goalkeeper: club.goalkeeper,
      strengthTier: club.strengthTier,
    },
  }))
);
