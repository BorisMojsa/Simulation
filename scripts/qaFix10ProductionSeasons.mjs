#!/usr/bin/env node
/**
 * Fix 10 production-schedule season study (R4).
 *
 * Runs real league double round-robin fixtures for weak and mid club contexts
 * with frozen 90' participation. Exports per-fixture results, GF/GA/points
 * distributions and paired replacement-vs-99 deltas.
 *
 * The synthetic self-vs-self 38-fixture probe in qaClubStrengthSuperstarImpact.mjs
 * remains labeled as a proxy only.
 *
 *   node scripts/qaFix10ProductionSeasons.mjs
 *   FIX10_PROD_SEASON_N=20 node scripts/qaFix10ProductionSeasons.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LEAGUES } from "../js/data/leagues.js";
import {
  createWorldState,
  setWorldState,
  getWorldState,
  attachClubIdentity,
} from "../js/simulation/worldState.js";
import { createRng, reseedCareerRng, setSimRng } from "../js/simulation/rng.js";
import { simulateMatch } from "../js/simulation/matchEngine.js";
import { flattenRoundRobinFixtures, dateLeagueFixtures } from "../js/simulation/seasonCalendar.js";
import { effectiveTeamStrength } from "../js/simulation/teamStrength.js";
import { roleReference, NEUTRAL_ATTRS, makePlayer } from "./lib/fix10StrengthQa.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "qa/fix10-runs/production-seasons");
mkdirSync(OUT, { recursive: true });

const SEASON_N = Number(process.env.FIX10_PROD_SEASON_N || 40);

/** Weak and mid club contexts on production league rosters. */
const CONTEXTS = [
  {
    id: "weak-hull",
    label: "weak",
    clubName: "Hull City",
    leagueName: "England - Premier League",
    roles: ["ST", "CM", "CB", "GK"],
  },
  {
    id: "mid-brentford",
    label: "mid",
    clubName: "Brentford",
    leagueName: "England - Premier League",
    roles: ["ST", "CM", "CB", "GK"],
  },
  {
    id: "weak-championship-sheffield",
    label: "weak",
    clubName: "Sheffield United",
    leagueName: "England - Championship",
    roles: ["ST", "CM"],
  },
];

function findLeague(name) {
  return LEAGUES.find((l) => l.name === name) || null;
}

function findClub(league, name) {
  return (league.clubs || []).find((c) => c.name === name) || null;
}

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    mean: mean(sorted),
    min: sorted[0] ?? null,
    p25: percentile(sorted, 25),
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    max: sorted.at(-1) ?? null,
  };
}

function buildPlayer({ role, ovr, club, seedTag }) {
  const p = makePlayer({
    position: role,
    ovr,
    minutes: 90,
    attributes: { ...NEUTRAL_ATTRS },
  });
  p.name = `Fix10Prod ${role} ${ovr}`;
  p.careerId = `fix10-prod-${seedTag}`;
  p.club = { ...club };
  p.playingClubId = club.clubId;
  p.employmentClubId = club.clubId;
  p.rating = ovr;
  p.currentOverall = ovr;
  p.currentOverallRaw = ovr;
  return p;
}

/**
 * Simulate one production league season for the subject club with frozen 90' minutes
 * whenever the player appears. Opponent clubs use world strength; subject side applies
 * the user player when `player` is non-null.
 */
function runProductionSeason({ league, subjectClub, player, seasonSeed }) {
  reseedCareerRng(seasonSeed);
  setSimRng(createRng(seasonSeed));
  const world = getWorldState();
  const clubs = (league.clubs || []).map((c) =>
    attachClubIdentity({
      ...c,
      tier: league.tier,
      league: league.name,
      leagueId: league.leagueId,
      nation: league.nation,
    })
  );
  const fixtures = flattenRoundRobinFixtures(clubs, {
    idPrefix: `prod:${league.leagueId}:${seasonSeed}`,
  });
  const dated = dateLeagueFixtures(fixtures, 2026);
  const subjectName = subjectClub.name;

  let pts = 0;
  let gf = 0;
  let ga = 0;
  let played = 0;
  const fixtureRows = [];

  for (let index = 0; index < dated.length; index++) {
    const fx = dated[index];
    const playerIn =
      fx.home.name === subjectName || fx.away.name === subjectName
        ? fx.home.name === subjectName
          ? "home"
          : "away"
        : null;

    const match = simulateMatch(fx.home, fx.away, {
      playerSide: player && playerIn ? playerIn : null,
      player: player && playerIn ? player : null,
      competition: "league",
      venue: "home",
      worldState: world,
      rng: createRng(seasonSeed * 10007 + index),
      competitionId: league.leagueId,
      fixtureId: fx.fixtureId || `${league.leagueId}:${seasonSeed}:md:${index}`,
      editionId: String(seasonSeed),
      playerMinutes: player && playerIn ? 90 : null,
      date: fx.date,
      // Frozen participation: skip injury/selection — minutes locked at 90.
    });

    if (!playerIn) continue;
    played += 1;
    const hg = match.matchHomeGoals ?? match.homeGoals;
    const ag = match.matchAwayGoals ?? match.awayGoals;
    const subjectGoals = playerIn === "home" ? hg : ag;
    const oppGoals = playerIn === "home" ? ag : hg;
    gf += subjectGoals;
    ga += oppGoals;
    let matchPts = 0;
    if (subjectGoals > oppGoals) matchPts = 3;
    else if (subjectGoals === oppGoals) matchPts = 1;
    pts += matchPts;

    const sideEff = match.effectiveStrength?.[playerIn] || null;
    fixtureRows.push({
      index,
      date: fx.date,
      venue: playerIn,
      opponent: playerIn === "home" ? fx.away.name : fx.home.name,
      gf: subjectGoals,
      ga: oppGoals,
      pts: matchPts,
      minutes: match.playerStats?.minutes ?? (player ? 90 : 0),
      teamAttack: sideEff?.attack ?? null,
      teamOverall: sideEff?.overall ?? null,
      impactAttack: sideEff?.playerImpact?.attack ?? null,
      homeXg: match.homeXg ?? match.expectedGoals?.home ?? null,
      awayXg: match.awayXg ?? match.expectedGoals?.away ?? null,
    });
  }

  return { pts, gf, ga, played, fixtures: fixtureRows };
}

function runPairedStudy(ctx) {
  const league = findLeague(ctx.leagueName);
  if (!league) throw new Error(`league-missing:${ctx.leagueName}`);
  const subject = findClub(league, ctx.clubName);
  if (!subject) throw new Error(`club-missing:${ctx.clubName}`);

  const club = attachClubIdentity({
    ...subject,
    tier: league.tier,
    league: league.name,
    leagueId: league.leagueId,
    nation: league.nation,
  });

  // Probe quality from live world for role-reference baseline.
  setWorldState(createWorldState({ seed: 7000, startYear: 2026 }));
  const baseEff = effectiveTeamStrength(club, { worldState: getWorldState() });
  const quality = Math.round(baseEff.overall);

  const study = {
    id: ctx.id,
    label: ctx.label,
    club: club.name,
    clubId: club.clubId,
    leagueId: league.leagueId,
    leagueName: league.name,
    quality,
    seasons: SEASON_N,
    frozenMinutes: 90,
    schedule: "production-double-round-robin",
    roles: {},
  };

  for (const role of ctx.roles) {
    const refOvr = Math.round(roleReference(quality, role));
    const conditions = [
      { key: "replacement", ovr: refOvr },
      { key: "star99", ovr: 99 },
    ];
    const byCond = {};

    for (const cond of conditions) {
      const seasonSummaries = [];
      const allPts = [];
      const allGf = [];
      const allGa = [];
      const sampleFixtures = [];

      for (let s = 0; s < SEASON_N; s++) {
        const seasonSeed = 800000 + quality * 97 + role.charCodeAt(0) * 13 + cond.ovr * 3 + s;
        setWorldState(createWorldState({ seed: seasonSeed, startYear: 2026 }));
        const player = buildPlayer({
          role,
          ovr: cond.ovr,
          club,
          seedTag: `${ctx.id}-${role}-${cond.key}-${s}`,
        });
        const result = runProductionSeason({
          league,
          subjectClub: club,
          player,
          seasonSeed,
        });
        seasonSummaries.push({
          seasonSeed,
          pts: result.pts,
          gf: result.gf,
          ga: result.ga,
          played: result.played,
        });
        allPts.push(result.pts);
        allGf.push(result.gf);
        allGa.push(result.ga);
        if (s === 0) {
          sampleFixtures.push(...result.fixtures);
          writeFileSync(
            join(OUT, `${ctx.id}-${role}-${cond.key}-fixtures-s0.json`),
            JSON.stringify(
              {
                context: ctx.id,
                role,
                condition: cond.key,
                ovr: cond.ovr,
                fixtures: result.fixtures,
              },
              null,
              2
            )
          );
        }
      }

      byCond[cond.key] = {
        ovr: cond.ovr,
        points: distribution(allPts),
        gf: distribution(allGf),
        ga: distribution(allGa),
        seasons: seasonSummaries,
        sampleFixtureCount: sampleFixtures.length,
      };
    }

    const pairedDeltas = byCond.replacement.seasons.map((rep, idx) => {
      const star = byCond.star99.seasons[idx];
      return {
        seasonSeedRep: rep.seasonSeed,
        seasonSeedStar: star.seasonSeed,
        dPts: star.pts - rep.pts,
        dGf: star.gf - rep.gf,
        dGa: star.ga - rep.ga,
      };
    });

    study.roles[role] = {
      refOvr,
      replacement: {
        ovr: byCond.replacement.ovr,
        points: byCond.replacement.points,
        gf: byCond.replacement.gf,
        ga: byCond.replacement.ga,
      },
      star99: {
        ovr: byCond.star99.ovr,
        points: byCond.star99.points,
        gf: byCond.star99.gf,
        ga: byCond.star99.ga,
      },
      pairedDelta: {
        points: distribution(pairedDeltas.map((d) => d.dPts)),
        gf: distribution(pairedDeltas.map((d) => d.dGf)),
        ga: distribution(pairedDeltas.map((d) => d.dGa)),
        sample: pairedDeltas.slice(0, 8),
      },
      seasonCount: SEASON_N,
    };

    writeFileSync(
      join(OUT, `${ctx.id}-${role}-paired.json`),
      JSON.stringify({ ...study.roles[role], pairedDeltas }, null, 2)
    );
  }

  return study;
}

function main() {
  const started = new Date().toISOString();
  const studies = [];
  for (const ctx of CONTEXTS) {
    console.log(JSON.stringify({ event: "start-context", id: ctx.id, seasons: SEASON_N }));
    const study = runPairedStudy(ctx);
    studies.push(study);
    writeFileSync(join(OUT, `${ctx.id}-summary.json`), JSON.stringify(study, null, 2));
  }

  const report = {
    started,
    finished: new Date().toISOString(),
    kind: "production-schedule",
    syntheticProxyNote:
      "qaClubStrengthSuperstarImpact.mjs seasons[] remain a synthetic self-vs-self proxy; this report is the production-schedule gate.",
    seasonN: SEASON_N,
    frozenParticipationMinutes: 90,
    contexts: studies,
    ok: studies.length === CONTEXTS.length,
  };
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        ok: report.ok,
        out: join(OUT, "summary.json"),
        contexts: studies.map((s) => ({
          id: s.id,
          club: s.club,
          roles: Object.keys(s.roles),
          stDeltaPtsMean: s.roles.ST?.pairedDelta?.points?.mean ?? null,
        })),
      },
      null,
      2
    )
  );
  if (!report.ok) process.exit(1);
}

main();
