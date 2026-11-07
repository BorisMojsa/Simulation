/**
 * Fix 13 browser fixtures — senior GK snapshots for restore/desk/summary flows.
 */
import { LEAGUE_BY_ID } from "../data/leagues.js";
import {
  DEVELOPMENT_MODEL_VERSION,
  GK_ATTRIBUTE_KEYS,
  PLAYER_MODEL_VERSION,
} from "../config/playerDevelopmentConfig.js";
import { createWorldState, setWorldState } from "./worldState.js";
import { resetClubFinanceLedgers } from "./clubFinance.js";
import { reseedCareerRng, createRng } from "./rng.js";
import { initializePlayerDevelopment } from "./playerDevelopmentModel.js";
import { ensurePlayingStints } from "./playingRegistration.js";
import { refreshAbilityCaches } from "./playerAbility.js";
import { serializeCareerSnapshot } from "./careerSnapshot.js";

function baseClub() {
  const league = LEAGUE_BY_ID.get("league:england-premier-league");
  const club = league.clubs.find((c) => c.clubId === "club:england:arsenal") || league.clubs[0];
  return { league, club };
}

function withClub(player, league, club) {
  player.club = {
    ...club,
    league: league.name,
    leagueDisplay: league.displayName,
    leagueId: league.leagueId,
    nation: league.nation,
    isAcademy: false,
  };
  player.employmentClubId = club.clubId;
  player.playingClubId = club.clubId;
  player.contractStartSeason = 0;
  player.contractYears = 4;
  player.contractEndSeason = 4;
  player.weeklyWage = 15000;
  player.seasons = player.seasons || [];
  player.careerTotals = player.careerTotals || { matches: 0, goals: 0, assists: 0, cleanSheets: 0 };
  player.careerHonors = player.careerHonors || {
    leagueTitles: 0,
    europeanTitles: 0,
    domesticCups: 0,
    individualAwards: 0,
    internationalTitles: 0,
  };
  player.autoDecisionPolicy = "stay";
  return player;
}

function stampV3(player, { gkProxy = false } = {}) {
  player.playerModelVersion = PLAYER_MODEL_VERSION;
  initializePlayerDevelopment(player, {
    rng: createRng(13),
    careerId: player.careerId,
    budget: 99,
  });
  player.development.migration = {
    ...(player.development.migration || {}),
    version: 3,
    gkProxy,
  };
  player.development.modelVersion = DEVELOPMENT_MODEL_VERSION;
  refreshAbilityCaches(player);
  return player;
}

export function buildFix13ModernGkSnapshot(opts = {}) {
  resetClubFinanceLedgers();
  reseedCareerRng(opts.seed || 13001);
  const world = createWorldState({ startYear: opts.startYear || 2026, seed: opts.seed || 13001 });
  setWorldState(world);
  const { league, club } = baseClub();
  const player = withClub(
    {
      name: opts.name || "Fix13 Modern GK",
      nationality: league.nation || "Serbia",
      position: "GK",
      age: 23,
      careerId: opts.careerId || "fix13-modern-gk",
      startYear: opts.startYear || 2026,
      rating: 74,
      potential: 84,
      attributes: {
        Reflexes: 76.2,
        Handling: 74.1,
        Positioning: 73.4,
        Diving: 72.8,
        Kicking: 70.5,
        Physicality: 75.0,
        Speed: 41,
        Shooting: 22,
      },
    },
    league,
    club
  );
  stampV3(player, { gkProxy: false });
  ensurePlayingStints(player, { asOfDate: `${player.startYear}-07-01` });
  return serializeCareerSnapshot({ player, world });
}

export function buildFix13OutfieldOnlyLegacyGkSnapshot(opts = {}) {
  resetClubFinanceLedgers();
  reseedCareerRng(opts.seed || 13002);
  const world = createWorldState({ startYear: opts.startYear || 2026, seed: opts.seed || 13002 });
  setWorldState(world);
  const { league, club } = baseClub();
  const player = withClub(
    {
      name: opts.name || "Fix13 Legacy GK",
      nationality: league.nation || "Serbia",
      position: "GK",
      age: 24,
      careerId: opts.careerId || "fix13-legacy-gk",
      startYear: opts.startYear || 2026,
      rating: 70,
      baseOverallRaw: 70,
      potential: 80,
      attributes: {
        Speed: 58,
        Passing: 54,
        Shooting: 40,
        Defending: 66,
        Physicality: 72,
        Dribbling: 45,
      },
    },
    league,
    club
  );
  // Intentionally unversioned / incomplete — restore path must repair.
  ensurePlayingStints(player, { asOfDate: `${player.startYear}-07-01` });
  return serializeCareerSnapshot({ player, world });
}

export function buildFix13PartialV3GkSnapshot(opts = {}) {
  resetClubFinanceLedgers();
  reseedCareerRng(opts.seed || 13003);
  const world = createWorldState({ startYear: opts.startYear || 2026, seed: opts.seed || 13003 });
  setWorldState(world);
  const { league, club } = baseClub();
  const player = withClub(
    {
      name: opts.name || "Fix13 Partial V3 GK",
      nationality: league.nation || "Serbia",
      position: "GK",
      age: 25,
      careerId: opts.careerId || "fix13-partial-v3",
      startYear: opts.startYear || 2026,
      rating: 68,
      baseOverallRaw: 68,
      potential: 78,
      attributes: {
        Reflexes: 71.4,
        Handling: null,
        Positioning: 67,
        Diving: Number.NaN,
        Kicking: 63,
        Physicality: 70.2,
        Speed: 38,
      },
      playerModelVersion: PLAYER_MODEL_VERSION,
      development: {
        modelVersion: DEVELOPMENT_MODEL_VERSION,
        migration: { version: 3 },
        traits: {
          trainability: 1,
          professionalism: 0.5,
          naturalFitness: 0.5,
          resilience: 0.5,
          maturityOffsets: {},
          declineProtection: 0,
        },
      },
    },
    league,
    club
  );
  ensurePlayingStints(player, { asOfDate: `${player.startYear}-07-01` });
  return serializeCareerSnapshot({ player, world });
}

export function buildFix13AliasGkSnapshot(opts = {}) {
  const snap = buildFix13ModernGkSnapshot({ ...opts, careerId: opts.careerId || "fix13-alias-gk", name: "Fix13 Alias GK" });
  snap.player.position = "Goalkeeper";
  snap.player.seasons = [
    {
      seasonNumber: 1,
      age: 22,
      clubDisplay: snap.player.club?.displayName || snap.player.club?.name,
      badge: snap.player.club?.badge || "",
      goals: 0,
      assists: 0,
      cleanSheets: 7,
    },
    {
      seasonNumber: 2,
      age: 23,
      clubDisplay: snap.player.club?.displayName || snap.player.club?.name,
      badge: snap.player.club?.badge || "",
      goals: 0,
      assists: 1,
      // Missing cleanSheets — retirement timeline must not fabricate undefinedCS
    },
  ];
  snap.player.careerTotals.cleanSheets = 7;
  return snap;
}

export function buildFix13OutfieldSnapshot(opts = {}) {
  resetClubFinanceLedgers();
  reseedCareerRng(opts.seed || 13004);
  const world = createWorldState({ startYear: opts.startYear || 2026, seed: opts.seed || 13004 });
  setWorldState(world);
  const { league, club } = baseClub();
  const player = withClub(
    {
      name: opts.name || "Fix13 Outfield",
      nationality: league.nation || "Serbia",
      position: "ST",
      age: 22,
      careerId: opts.careerId || "fix13-outfield",
      startYear: opts.startYear || 2026,
      rating: 72,
      potential: 82,
      attributes: {
        Speed: 74,
        Passing: 68,
        Shooting: 76,
        Defending: 42,
        Physicality: 70,
        Dribbling: 73,
      },
    },
    league,
    club
  );
  stampV3(player);
  ensurePlayingStints(player, { asOfDate: `${player.startYear}-07-01` });
  return serializeCareerSnapshot({ player, world });
}

export { GK_ATTRIBUTE_KEYS };
