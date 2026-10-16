/**
 * Continental club campaigns (UEFA / CONMEBOL / CONCACAF / AFC / CAF).
 * Implementation lives in continentalTournament.js — this module keeps the public API.
 */

import { LEAGUES } from "../data/leagues.js";
import { isUefaQualifyingLeague } from "../data/competitions/qualification.js";
import { resolveKnockout, simulateMatch } from "./matchEngine.js";
import { getSimRng } from "./rng.js";
import { attachClubIdentity, applyMatchFormUpdate, getWorldState } from "./worldState.js";
import {
  simulateContinentalCampaign,
  reconcileCampaignWithPlayerMatches,
  prepareContinentalEdition,
  processContinentalMatchday,
  processContinentalFixture,
  advanceContinentalStage,
  buildContinentalCampaignView,
  drainContinentalEdition,
  listContinentalFixtures,
  loadContinentalEdition,
} from "./continentalTournament.js";

export {
  reconcileCampaignWithPlayerMatches,
  prepareContinentalEdition,
  processContinentalMatchday,
  processContinentalFixture,
  advanceContinentalStage,
  buildContinentalCampaignView,
  drainContinentalEdition,
  listContinentalFixtures,
  loadContinentalEdition,
};

const EUROPE_NATIONS = new Set([
  "England", "Spain", "Germany", "Italy", "France", "Portugal", "Netherlands",
  "Belgium", "Denmark", "Turkey", "Norway", "Poland", "Czech Republic", "Croatia", "Serbia",
]);
const CONMEBOL_NATIONS = new Set(["Brazil", "Argentina", "Colombia", "Ecuador"]);
const CONCACAF_NATIONS = new Set(["Mexico", "United States"]);
const AFC_NATIONS = new Set(["Saudi Arabia", "Japan", "South Korea"]);
const CAF_NATIONS = new Set(["Egypt", "Morocco"]);

function slimFromLeagueClub(club, league) {
  return attachClubIdentity({
    name: club.name,
    displayName: club.displayName ?? club.name,
    badge: club.badge ?? null,
    clubId: club.clubId,
    financialTier: club.financialTier ?? league.financialPower ?? 2,
    tier: league.tier ?? 3,
    overall: club.overall,
    attack: club.attack,
    midfield: club.midfield,
    defence: club.defence,
    goalkeeper: club.goalkeeper,
    nation: league.nation,
    league: league.name,
    leagueId: league.leagueId,
  });
}

function clubsFromNations(nations, { excludeName = "", excludeId = null, limit = 48, minOverall = 0 } = {}) {
  const topByNation = new Map();
  LEAGUES.filter((l) => nations.has(l.nation)).forEach((league) => {
    const cur = topByNation.get(league.nation);
    if (!cur || (league.tier ?? 0) > (cur.tier ?? 0)) {
      topByNation.set(league.nation, league);
    }
  });

  const out = [];
  const seen = new Set();
  [...topByNation.values()]
    .sort((a, b) => (b.tier ?? 0) - (a.tier ?? 0))
    .forEach((league) => {
      [...league.clubs]
        .sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))
        .forEach((club) => {
          if (club.name === excludeName || (excludeId && club.clubId === excludeId)) return;
          if (seen.has(club.clubId || club.name)) return;
          if ((club.overall ?? 0) < minOverall) return;
          seen.add(club.clubId || club.name);
          out.push(slimFromLeagueClub(club, league));
        });
    });
  return out
    .sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))
    .slice(0, limit);
}

function continentForLeague(league) {
  const nation = league?.nation;
  if (!nation) return null;
  if (EUROPE_NATIONS.has(nation) || isUefaQualifyingLeague(league)) return "uefa";
  if (CONMEBOL_NATIONS.has(nation)) return "conmebol";
  if (CONCACAF_NATIONS.has(nation)) return "concacaf";
  if (AFC_NATIONS.has(nation)) return "afc";
  if (CAF_NATIONS.has(nation)) return "caf";
  return null;
}

export function simulateEuropeanCampaign({ standing, league, performanceScore, player, seasonYear = null }) {
  void performanceScore;
  return simulateContinentalCampaign({ standing, league, player, seasonYear });
}

/** Finals-only showcase for the player's continental confederation. */
export function simulateEuropeanFinalsShowcase(league = null) {
  const rng = getSimRng();
  const world = getWorldState();
  const conf = continentForLeague(league) || "uefa";
  let comps;
  let nations;
  if (conf === "conmebol") {
    comps = ["Copa Libertadores", "Copa Sudamericana"];
    nations = CONMEBOL_NATIONS;
  } else if (conf === "concacaf") {
    comps = ["CONCACAF Champions Cup"];
    nations = CONCACAF_NATIONS;
  } else if (conf === "afc") {
    comps = ["AFC Champions League Elite"];
    nations = AFC_NATIONS;
  } else if (conf === "caf") {
    comps = ["CAF Champions League"];
    nations = CAF_NATIONS;
  } else {
    comps = ["Champions League", "Europa League", "Conference League"];
    nations = EUROPE_NATIONS;
  }

  const pool = clubsFromNations(nations, {
    limit: 48,
    minOverall: conf === "uefa" ? 66 : 58,
  });
  const competitions = comps.map((name) => {
    const size = name === "CONCACAF Champions Cup" ? 8 : name === "CAF Champions League" ? 16 : 16;
    let field = rng.shuffle(pool).slice(0, size);
    while (field.length < 4 && pool.length) field.push(rng.pick(pool));
    let bracketSize = 1;
    while (bracketSize * 2 <= field.length) bracketSize *= 2;
    const use = field.slice(0, bracketSize);
    let remaining = rng.shuffle(use);
    let finalMatch = null;
    const allRounds = [];
    const feederGraph = [];
    while (remaining.length > 1) {
      if (remaining.length % 2 === 1) {
        throw new Error(`Showcase ${name}: odd bracket ${remaining.length}`);
      }
      const next = [];
      const roundMatches = [];
      const label = remaining.length === 2 ? "Final" : `Round of ${remaining.length}`;
      for (let i = 0; i < remaining.length; i += 2) {
        const a = remaining[i];
        const b = remaining[i + 1];
        const tieId = `showcase:${name}:${label}:${i / 2}`;
        let match = resolveKnockout(
          simulateMatch(a, b, {
            competition: "europe",
            worldState: world,
            rng,
            competitionId: name,
          }),
          { rng }
        );
        match.round = label;
        match.cupName = name;
        match.tieId = tieId;
        match.feedsInto =
          remaining.length === 2 ? null : `showcase:${name}:${remaining.length === 4 ? "Final" : `Round of ${remaining.length / 2}`}:${Math.floor(i / 4)}`;
        applyMatchFormUpdate(world, match);
        if (remaining.length === 2) finalMatch = match;
        roundMatches.push(match);
        next.push(match.winnerSide === "home" ? a : b);
        feederGraph.push({ tieId, feedsInto: match.feedsInto, round: label, winner: next[next.length - 1].name });
      }
      allRounds.push({ round: label, matches: roundMatches });
      remaining = next;
    }
    const winnerClub = remaining[0];
    return {
      competition: name,
      allRounds,
      feederGraph,
      finalMatch,
      finalists: finalMatch ? [finalMatch.home, finalMatch.away] : null,
      winner: winnerClub?.displayName ?? null,
      winnerData: winnerClub || null,
    };
  });

  return {
    competition: comps[0] || "Continental finals",
    result: "Not qualified",
    won: false,
    qualified: false,
    rounds: [],
    playerMatches: [],
    finalMatch: competitions[0]?.finalMatch || null,
    finalists: competitions[0]?.finalists || null,
    winner: competitions[0]?.winner || null,
    winnerData: competitions[0]?.winnerData || null,
    showcase: true,
    competitions,
    confederation: conf,
    allRounds: competitions[0]?.allRounds || [],
    feederGraph: competitions[0]?.feederGraph || [],
  };
}
