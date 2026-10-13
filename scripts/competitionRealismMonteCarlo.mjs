/**
 * Seeded Monte Carlo: leagues, domestic cups, continental showcases, national tournaments.
 *   node scripts/competitionRealismMonteCarlo.mjs
 *
 * Writes reports/competition-realism-montecarlo.json
 * Does not modify gameplay data.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEAGUES } from "../js/data/leagues.js";
import { NATION_PROFILES, getNationProfile } from "../js/data/strength/nationProfiles.js";
import { resolveClub } from "../js/data/identity/resolver.js";
import { createWorldState, setWorldState } from "../js/simulation/worldState.js";
import { createRng, hashSeed, setSimRng } from "../js/simulation/rng.js";
import { simulateMatch } from "../js/simulation/matchEngine.js";
import { simulateLeagueSeason } from "../js/simulation/leagueFixtures.js";
import { simulateDomesticCup } from "../js/simulation/domesticCup.js";
import { simulateEuropeanFinalsShowcase } from "../js/simulation/europeanCompetition.js";
import { simulateInternationalSeason } from "../js/simulation/nationalTeam.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "reports/competition-realism-montecarlo.json");

const BASE_SEED = 20261009;
const LEAGUE_ITERS = 120;
const CUP_ITERS = 100;
const CONTINENTAL_ITERS = 150;
const NATIONAL_ITERS = 100;
const PAIR_ITERS = 2500;

const LEAGUE_NAMES = [
  "England - Premier League",
  "Spain - La Liga",
  "Italy - Serie A",
  "Germany - Bundesliga",
  "France - Ligue 1",
  "Netherlands - Eredivisie",
  "Portugal - Primeira Liga",
  "England - Championship",
  "Serbia - SuperLiga",
  "Brazil - Brasileirão Série A",
  "Argentina - Liga Profesional",
];

const CUP_NATIONS = ["England", "Spain", "Germany", "Italy", "France", "Serbia", "Portugal"];

const CONTINENTAL_LEAGUES = [
  "England - Premier League",
  "Spain - La Liga",
  "Brazil - Brasileirão Série A",
  "Argentina - Liga Profesional",
  "Mexico - Liga MX",
  "United States - MLS",
].filter((name) => LEAGUES.some((l) => l.name === name));

function pct(n, d) {
  return d ? Math.round((1000 * n) / d) / 10 : 0;
}

function mean(arr) {
  if (!arr.length) return null;
  return Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100;
}

function dummyPlayer(club, nationality = "England") {
  const profile = resolveClub(club.name, { nationHint: club.nation }).profile;
  const repl = profile?.replacementOvr?.CM ?? Math.round((profile?.overall ?? 70) - 3);
  return {
    name: "MC Probe",
    nationality,
    position: "CM",
    rating: repl,
    age: 24,
    attributes: {
      Passing: repl,
      Shooting: repl - 2,
      Defending: repl,
      Speed: repl,
      Physicality: repl,
      Dribbling: repl,
    },
    club: {
      name: club.name,
      displayName: club.displayName ?? club.name,
      clubId: club.clubId,
      badge: club.badge,
      financialTier: club.financialTier,
      overall: club.overall,
      nation: club.nation,
    },
  };
}

function strengthOf(teamLike) {
  if (!teamLike || teamLike.isBye) return null;
  if (teamLike.overall != null) return Number(teamLike.overall);
  if (teamLike.nationId || teamLike.isNation) {
    return getNationProfile(teamLike.name)?.overall ?? null;
  }
  const r = resolveClub(teamLike.name || teamLike.clubId);
  return r.ok ? r.profile.overall : null;
}

function classifyMatch(match) {
  if (!match || match.isBye) return null;
  const hs = match.effectiveStrength?.home?.overall ?? strengthOf(match.home);
  const as_ = match.effectiveStrength?.away?.overall ?? strengthOf(match.away);
  if (hs == null || as_ == null) return null;
  const gap = Math.abs(hs - as_);
  const homeStronger = hs > as_;
  const awayStronger = as_ > hs;
  const equal = Math.abs(hs - as_) < 0.05;
  const hg = match.matchHomeGoals ?? match.homeGoals;
  const ag = match.matchAwayGoals ?? match.awayGoals;
  let outcome = "draw";
  if (hg > ag) outcome = "home";
  else if (ag > hg) outcome = "away";

  let favoriteResult = "draw";
  if (!equal) {
    const favSide = homeStronger ? "home" : "away";
    if (outcome === "draw") favoriteResult = "draw";
    else if (outcome === favSide) favoriteResult = "favorite";
    else favoriteResult = "upset";
  }

  return {
    gap,
    equal,
    outcome,
    favoriteResult,
    homeStronger,
    venue: match.venue || "home",
  };
}

function bumpGapBucket(buckets, gap, favoriteResult) {
  let key;
  if (gap < 2) key = "0-2";
  else if (gap < 5) key = "2-5";
  else if (gap < 10) key = "5-10";
  else if (gap < 15) key = "10-15";
  else key = "15+";
  const b = buckets[key] || { n: 0, favorite: 0, upset: 0, draw: 0 };
  b.n += 1;
  b[favoriteResult] += 1;
  buckets[key] = b;
}

function quartileLabel(rank1Based, n) {
  const p = (rank1Based - 1) / Math.max(1, n - 1);
  if (p <= 0.25) return "Q1 strongest";
  if (p <= 0.5) return "Q2";
  if (p <= 0.75) return "Q3";
  return "Q4 weakest";
}

function resetWorld(seed) {
  const world = createWorldState({ seed, startYear: 2026 });
  setWorldState(world);
  setSimRng(createRng(seed));
  return world;
}

function ingestMatches(stats, matches) {
  for (const m of matches || []) {
    const c = classifyMatch(m);
    if (!c || c.equal) continue;
    stats.matches += 1;
    if (c.favoriteResult === "favorite") stats.favoriteWins += 1;
    else if (c.favoriteResult === "upset") stats.upsets += 1;
    else stats.draws += 1;
    bumpGapBucket(stats.byGap, c.gap, c.favoriteResult);
    if (c.venue === "home" || c.venue === "away") {
      stats.homeVenue = stats.homeVenue || { n: 0, homeWins: 0, draws: 0, awayWins: 0 };
      stats.homeVenue.n += 1;
      if (c.outcome === "home") stats.homeVenue.homeWins += 1;
      else if (c.outcome === "away") stats.homeVenue.awayWins += 1;
      else stats.homeVenue.draws += 1;
    } else if (c.venue === "neutral") {
      stats.neutralVenue = stats.neutralVenue || { n: 0, favorite: 0, upset: 0, draw: 0 };
      stats.neutralVenue.n += 1;
      stats.neutralVenue[c.favoriteResult] += 1;
    }
  }
}

function emptyMatchStats() {
  return {
    matches: 0,
    favoriteWins: 0,
    upsets: 0,
    draws: 0,
    byGap: {},
    homeVenue: null,
    neutralVenue: null,
  };
}

function finalizeMatchStats(s) {
  return {
    matches: s.matches,
    favoriteWinPct: pct(s.favoriteWins, s.matches),
    upsetPct: pct(s.upsets, s.matches),
    drawPct: pct(s.draws, s.matches),
    byGap: Object.fromEntries(
      Object.entries(s.byGap).map(([k, v]) => [
        k,
        {
          n: v.n,
          favoriteWinPct: pct(v.favorite, v.n),
          upsetPct: pct(v.upset, v.n),
          drawPct: pct(v.draw, v.n),
        },
      ])
    ),
    homeVenue: s.homeVenue
      ? {
          n: s.homeVenue.n,
          homeWinPct: pct(s.homeVenue.homeWins, s.homeVenue.n),
          drawPct: pct(s.homeVenue.draws, s.homeVenue.n),
          awayWinPct: pct(s.homeVenue.awayWins, s.homeVenue.n),
        }
      : null,
    neutralVenue: s.neutralVenue
      ? {
          n: s.neutralVenue.n,
          favoriteWinPct: pct(s.neutralVenue.favorite, s.neutralVenue.n),
          upsetPct: pct(s.neutralVenue.upset, s.neutralVenue.n),
          drawPct: pct(s.neutralVenue.draw, s.neutralVenue.n),
        }
      : null,
  };
}

// --- Direct pair probe (open play, no season form) ---
function runPairProbe() {
  const pairs = [
    { label: "Elite vs mid (Arsenal vs Brentford)", a: ["Arsenal", "England"], b: ["Brentford", "England"] },
    { label: "Elite vs weak (Bayern vs Paderborn)", a: ["Bayern Munich", "Germany"], b: ["SC Paderborn", "Germany"] },
    { label: "Close top (Real Madrid vs Barcelona)", a: ["Real Madrid", "Spain"], b: ["Barcelona", "Spain"] },
    { label: "Nation elite vs weak (Spain vs Togo)", a: null, b: null, na: "Spain", nb: "Togo" },
    { label: "Nation mid gap (Iran vs China)", a: null, b: null, na: "Iran", nb: "China" },
  ];
  const out = [];
  for (const [pi, p] of pairs.entries()) {
    let homeW = 0;
    let awayW = 0;
    let draws = 0;
    let favW = 0;
    let upset = 0;
    let gaps = [];
    for (let i = 0; i < PAIR_ITERS; i++) {
      const rng = createRng(hashSeed(`${BASE_SEED}:pair:${pi}:${i}`));
      let home;
      let away;
      if (p.na) {
        const A = getNationProfile(p.na);
        const B = getNationProfile(p.nb);
        home = { ...A, isNation: true, nationId: A.nationId };
        away = { ...B, isNation: true, nationId: B.nationId };
      } else {
        home = resolveClub(p.a[0], { nationHint: p.a[1] }).profile;
        away = resolveClub(p.b[0], { nationHint: p.b[1] }).profile;
      }
      const m = simulateMatch(home, away, { venue: "neutral", rng });
      const c = classifyMatch(m);
      gaps.push(c.gap);
      if (c.outcome === "home") homeW += 1;
      else if (c.outcome === "away") awayW += 1;
      else draws += 1;
      if (c.favoriteResult === "favorite") favW += 1;
      else if (c.favoriteResult === "upset") upset += 1;
    }
    const n = PAIR_ITERS;
    out.push({
      label: p.label,
      n,
      meanStrengthGap: mean(gaps),
      strongerSideWinPct: pct(favW, n - draws > 0 ? n : n), // among all incl draws later
      favoriteWinPct: pct(favW, n),
      upsetPct: pct(upset, n),
      drawPct: pct(draws, n),
      homeWinPct: pct(homeW, n),
      awayWinPct: pct(awayW, n),
    });
  }
  return out;
}

// --- Leagues ---
function runLeagues() {
  const results = [];
  for (const leagueName of LEAGUE_NAMES) {
    const league = LEAGUES.find((l) => l.name === leagueName);
    if (!league) continue;
    const ranked = [...league.clubs]
      .map((c) => ({ ...c, overall: c.overall ?? resolveClub(c.name, { nationHint: league.nation }).profile?.overall ?? 60 }))
      .sort((a, b) => b.overall - a.overall);
    const rankByName = new Map(ranked.map((c, i) => [c.name, i + 1]));
    const titleByQuartile = { "Q1 strongest": 0, Q2: 0, Q3: 0, "Q4 weakest": 0 };
    const titleByRank = {};
    const top1Wins = {};
    const matchStats = emptyMatchStats();
    let topSeedTitles = 0;
    let top4Titles = 0;

    for (let i = 0; i < LEAGUE_ITERS; i++) {
      const seed = hashSeed(`${BASE_SEED}:league:${leagueName}:${i}`);
      resetWorld(seed);
      // Probe player on bottom club so title race among strong sides is barely biased
      const probeClub = ranked[ranked.length - 1];
      const player = dummyPlayer({ ...probeClub, nation: league.nation }, league.nation);
      const sim = simulateLeagueSeason(league, player, 70);
      ingestMatches(matchStats, sim.allMatches);
      const champ = sim.table[0];
      const rank = rankByName.get(champ.name) || ranked.length;
      const q = quartileLabel(rank, ranked.length);
      titleByQuartile[q] += 1;
      titleByRank[rank] = (titleByRank[rank] || 0) + 1;
      top1Wins[champ.name] = (top1Wins[champ.name] || 0) + 1;
      if (rank === 1) topSeedTitles += 1;
      if (rank <= 4) top4Titles += 1;
    }

    const topWinners = Object.entries(top1Wins)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, titles]) => ({
        name,
        titles,
        titlePct: pct(titles, LEAGUE_ITERS),
        preseasonRank: rankByName.get(name),
        overall: ranked.find((c) => c.name === name)?.overall,
      }));

    results.push({
      league: leagueName,
      nation: league.nation,
      clubs: ranked.length,
      iterations: LEAGUE_ITERS,
      strongestClub: { name: ranked[0].name, overall: ranked[0].overall },
      topSeedTitlePct: pct(topSeedTitles, LEAGUE_ITERS),
      top4PreseasonTitlePct: pct(top4Titles, LEAGUE_ITERS),
      titlesByStrengthQuartile: Object.fromEntries(
        Object.entries(titleByQuartile).map(([k, v]) => [k, { titles: v, pct: pct(v, LEAGUE_ITERS) }])
      ),
      topWinners,
      matchOutcomes: finalizeMatchStats(matchStats),
    });
  }
  return results;
}

// --- Domestic cups ---
function runCups() {
  const results = [];
  for (const nation of CUP_NATIONS) {
    const league = LEAGUES.find((l) => l.nation === nation && (l.divisionLevel ?? 1) === 1);
    if (!league) continue;
    const clubs = LEAGUES.filter((l) => l.nation === nation).flatMap((l) =>
      l.clubs.map((c) => ({
        ...c,
        overall: c.overall ?? resolveClub(c.name, { nationHint: nation }).profile?.overall ?? 60,
        nation,
      }))
    );
    const unique = [];
    const seen = new Set();
    for (const c of clubs) {
      const id = c.clubId || c.name;
      if (seen.has(id)) continue;
      seen.add(id);
      unique.push(c);
    }
    unique.sort((a, b) => b.overall - a.overall);
    const rankByName = new Map(unique.map((c, i) => [c.name, i + 1]));
    const titleByQuartile = { "Q1 strongest": 0, Q2: 0, Q3: 0, "Q4 weakest": 0 };
    const topWinners = {};
    const matchStats = emptyMatchStats();
    let topSeed = 0;
    let top8 = 0;

    for (let i = 0; i < CUP_ITERS; i++) {
      const seed = hashSeed(`${BASE_SEED}:cup:${nation}:${i}`);
      resetWorld(seed);
      const probe = unique[unique.length - 1];
      const player = dummyPlayer(probe, nation);
      const cup = simulateDomesticCup(league, 70, 10, player);
      const matches = (cup.allRounds || []).flatMap((r) => r.matches || []).filter((m) => !m.isBye);
      ingestMatches(matchStats, matches);
      const winnerName = cup.winnerData?.name || cup.winner;
      const rank = rankByName.get(winnerName) || unique.length;
      titleByQuartile[quartileLabel(rank, unique.length)] += 1;
      topWinners[winnerName] = (topWinners[winnerName] || 0) + 1;
      if (rank === 1) topSeed += 1;
      if (rank <= 8) top8 += 1;
    }

    results.push({
      nation,
      cupLeagueAnchor: league.name,
      poolSize: unique.length,
      iterations: CUP_ITERS,
      topSeedTitlePct: pct(topSeed, CUP_ITERS),
      top8PreseasonTitlePct: pct(top8, CUP_ITERS),
      titlesByStrengthQuartile: Object.fromEntries(
        Object.entries(titleByQuartile).map(([k, v]) => [k, { titles: v, pct: pct(v, CUP_ITERS) }])
      ),
      topWinners: Object.entries(topWinners)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([name, titles]) => ({
          name,
          titles,
          titlePct: pct(titles, CUP_ITERS),
          preseasonRank: rankByName.get(name),
          overall: unique.find((c) => c.name === name)?.overall,
        })),
      matchOutcomes: finalizeMatchStats(matchStats),
    });
  }
  return results;
}

// --- Continental showcases ---
function runContinental() {
  const byComp = {};
  const matchStats = emptyMatchStats();

  for (const leagueName of CONTINENTAL_LEAGUES) {
    const league = LEAGUES.find((l) => l.name === leagueName);
    if (!league) continue;
    for (let i = 0; i < CONTINENTAL_ITERS; i++) {
      const seed = hashSeed(`${BASE_SEED}:cont:${leagueName}:${i}`);
      resetWorld(seed);
      const show = simulateEuropeanFinalsShowcase(league);
      for (const comp of show.competitions || []) {
        const field = [];
        for (const round of comp.allRounds || []) {
          for (const m of round.matches || []) {
            if (m.home && !m.home.isBye) field.push(m.home);
            if (m.away && !m.away.isBye) field.push(m.away);
          }
        }
        // unique field by name from first round
        const first = comp.allRounds?.[0]?.matches || [];
        const teams = [];
        const seen = new Set();
        for (const m of first) {
          for (const side of [m.home, m.away]) {
            if (!side || side.isBye) continue;
            if (seen.has(side.name)) continue;
            seen.add(side.name);
            teams.push(side);
          }
        }
        teams.sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));
        const rankByName = new Map(teams.map((t, idx) => [t.name, idx + 1]));
        const matches = (comp.allRounds || []).flatMap((r) => r.matches || []);
        ingestMatches(matchStats, matches);

        const key = comp.competition;
        const bucket = byComp[key] || {
          competition: key,
          iterations: 0,
          topSeedTitles: 0,
          top4Titles: 0,
          titleByQuartile: { "Q1 strongest": 0, Q2: 0, Q3: 0, "Q4 weakest": 0 },
          winners: {},
        };
        bucket.iterations += 1;
        const wName = comp.winnerData?.name || comp.winner;
        const rank = rankByName.get(wName) || teams.length;
        bucket.titleByQuartile[quartileLabel(rank, teams.length)] += 1;
        if (rank === 1) bucket.topSeedTitles += 1;
        if (rank <= 4) bucket.top4Titles += 1;
        bucket.winners[wName] = (bucket.winners[wName] || 0) + 1;
        byComp[key] = bucket;
      }
    }
  }

  return {
    competitions: Object.values(byComp).map((b) => ({
      competition: b.competition,
      iterations: b.iterations,
      topSeedTitlePct: pct(b.topSeedTitles, b.iterations),
      top4FieldTitlePct: pct(b.top4Titles, b.iterations),
      titlesByStrengthQuartile: Object.fromEntries(
        Object.entries(b.titleByQuartile).map(([k, v]) => [
          k,
          { titles: v, pct: pct(v, b.iterations) },
        ])
      ),
      topWinners: Object.entries(b.winners)
        .sort((a, b2) => b2[1] - a[1])
        .slice(0, 10)
        .map(([name, titles]) => ({
          name,
          titles,
          titlePct: pct(titles, b.iterations),
          overall: resolveClub(name).ok ? resolveClub(name).profile.overall : null,
        })),
    })),
    matchOutcomes: finalizeMatchStats(matchStats),
  };
}

// --- National tournaments ---
function runNational() {
  const years = [
    { year: 2026, focus: "world-cup" },
    { year: 2028, focus: "euro" },
    { year: 2028, focus: "copa-america", nationality: "Argentina" },
    { year: 2027, focus: "afcon", nationality: "Morocco" },
    { year: 2027, focus: "gold-cup", nationality: "Mexico" },
    { year: 2027, focus: "asian-cup", nationality: "Japan" },
  ];
  const byTournament = {};
  const matchStats = emptyMatchStats();
  const rankedNations = [...NATION_PROFILES].sort((a, b) => b.overall - a.overall);
  const globalRank = new Map(rankedNations.map((n, i) => [n.name, i + 1]));

  for (const cfg of years) {
    const nationality = cfg.nationality || "England";
    for (let i = 0; i < NATIONAL_ITERS; i++) {
      const seed = hashSeed(`${BASE_SEED}:nat:${cfg.year}:${cfg.focus}:${i}`);
      resetWorld(seed);
      // Anchor club irrelevant; nationality drives calendar. Low form → rare call-ups.
      const league = LEAGUES.find((l) => l.nation === "England") || LEAGUES[0];
      const club = league.clubs[0];
      const player = dummyPlayer({ ...club, nation: league.nation }, nationality);
      player.rating = 55;
      const intl = simulateInternationalSeason({
        player,
        calendarYear: cfg.year,
        avgMatchRating: 5.5,
      });
      for (const t of intl.tournaments || []) {
        if (cfg.focus && t.id !== cfg.focus) continue;
        const field = t.field || [];
        const fieldRanked = [...field]
          .map((name) => ({ name, overall: getNationProfile(name)?.overall ?? 60 }))
          .sort((a, b) => b.overall - a.overall);
        const rankByName = new Map(fieldRanked.map((n, idx) => [n.name, idx + 1]));
        const matches = [
          ...(t.groups || []).flatMap((g) => g.matches || []),
          ...(t.allRounds || []).flatMap((r) => r.matches || []),
        ];
        ingestMatches(matchStats, matches);

        const key = t.name;
        const bucket = byTournament[key] || {
          tournament: key,
          id: t.id,
          iterations: 0,
          topSeedTitles: 0,
          top4Titles: 0,
          titleByQuartile: { "Q1 strongest": 0, Q2: 0, Q3: 0, "Q4 weakest": 0 },
          winners: {},
        };
        bucket.iterations += 1;
        const wName = t.winnerData?.name || t.winner;
        const rank = rankByName.get(wName) || fieldRanked.length;
        bucket.titleByQuartile[quartileLabel(rank, fieldRanked.length)] += 1;
        if (rank === 1) bucket.topSeedTitles += 1;
        if (rank <= 4) bucket.top4Titles += 1;
        bucket.winners[wName] = (bucket.winners[wName] || 0) + 1;
        byTournament[key] = bucket;
      }
    }
  }

  return {
    tournaments: Object.values(byTournament).map((b) => ({
      tournament: b.tournament,
      id: b.id,
      iterations: b.iterations,
      topSeedTitlePct: pct(b.topSeedTitles, b.iterations),
      top4FieldTitlePct: pct(b.top4Titles, b.iterations),
      titlesByStrengthQuartile: Object.fromEntries(
        Object.entries(b.titleByQuartile).map(([k, v]) => [
          k,
          { titles: v, pct: pct(v, b.iterations) },
        ])
      ),
      topWinners: Object.entries(b.winners)
        .sort((a, b2) => b2[1] - a[1])
        .slice(0, 10)
        .map(([name, titles]) => ({
          name,
          titles,
          titlePct: pct(titles, b.iterations),
          overall: getNationProfile(name)?.overall ?? null,
          globalStrengthRank: globalRank.get(name) ?? null,
        })),
    })),
    matchOutcomes: finalizeMatchStats(matchStats),
  };
}

console.log("Running competition realism Monte Carlo…");
const started = Date.now();
const pairProbe = runPairProbe();
console.log("  pairs done");
const leagues = runLeagues();
console.log("  leagues done");
const cups = runCups();
console.log("  cups done");
const continental = runContinental();
console.log("  continental done");
const national = runNational();
console.log("  national done");

const report = {
  generatedAt: new Date().toISOString(),
  baseSeed: BASE_SEED,
  method:
    "Fresh world + Mulberry32 RNG per iteration. Favorite = higher effectiveStrength.overall at kickoff. Upset = weaker side wins in open play (draws excluded from favorite/upset split denominators are still counted in drawPct over all decided+drawn matches). Title quartiles use preseason/field strength ranks. Probe player placed on weak club with replacement-level OVR; national call-ups suppressed via low avgMatchRating.",
  config: {
    LEAGUE_ITERS,
    CUP_ITERS,
    CONTINENTAL_ITERS,
    NATIONAL_ITERS,
    PAIR_ITERS,
  },
  elapsedMs: Date.now() - started,
  pairProbe,
  leagues,
  cups,
  continental,
  national,
  summary: {
    leagueTopSeedTitlePctMean: mean(leagues.map((l) => l.topSeedTitlePct)),
    leagueTop4TitlePctMean: mean(leagues.map((l) => l.top4PreseasonTitlePct)),
    leagueMatchUpsetPctMean: mean(leagues.map((l) => l.matchOutcomes.upsetPct)),
    cupTop8TitlePctMean: mean(cups.map((c) => c.top8PreseasonTitlePct)),
    continentalTopSeedTitlePctMean: mean(continental.competitions.map((c) => c.topSeedTitlePct)),
    nationalTopSeedTitlePctMean: mean(national.tournaments.map((t) => t.topSeedTitlePct)),
  },
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`Wrote ${OUT} in ${report.elapsedMs}ms`);
console.log(JSON.stringify(report.summary, null, 2));
