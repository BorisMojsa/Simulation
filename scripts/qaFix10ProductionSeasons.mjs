#!/usr/bin/env node
/**
 * Fix 10 production-schedule season study (R4).
 *
 * Real league double round-robin for weak and mid clubs with frozen 90' minutes.
 * Paired replacement vs 99 share one common season seed and fixture RNG identity;
 * OVR is never part of seed derivation.
 *
 * Gate target: at least 100 seasons per condition (FIX10_PROD_SEASON_N may raise
 * but not lower the acceptance floor recorded in summary.minSeasonsRequired).
 *
 *   node scripts/qaFix10ProductionSeasons.mjs
 *   FIX10_PROD_SEASON_N=100 node scripts/qaFix10ProductionSeasons.mjs
 */
import { mkdirSync, writeFileSync, createWriteStream } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createGzip } from "node:zlib";
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
mkdirSync(join(OUT, "fixtures"), { recursive: true });

/** Acceptance floor — smoke runs that set a lower env still record the required target. */
export const MIN_SEASONS_REQUIRED = 100;
const SEASON_N = Math.max(MIN_SEASONS_REQUIRED, Number(process.env.FIX10_PROD_SEASON_N || MIN_SEASONS_REQUIRED));

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
];

function sha(obj) {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

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

/** Common season seed — must NOT include ovr / condition. */
export function sharedSeasonSeed({ quality, role, seasonIndex }) {
  return 800000 + quality * 97 + role.charCodeAt(0) * 13 + seasonIndex;
}

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

    // Fixture RNG identity is seasonSeed + index only (shared across conditions).
    const fixtureSeed = seasonSeed * 10007 + index;
    const match = simulateMatch(fx.home, fx.away, {
      playerSide: player && playerIn ? playerIn : null,
      player: player && playerIn ? player : null,
      competition: "league",
      venue: "home",
      worldState: world,
      rng: createRng(fixtureSeed),
      competitionId: league.leagueId,
      fixtureId: fx.fixtureId || `${league.leagueId}:${seasonSeed}:md:${index}`,
      editionId: String(seasonSeed),
      playerMinutes: player && playerIn ? 90 : null,
      date: fx.date,
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
      fixtureId: match.fixtureId,
      fixtureSeed,
      date: fx.date,
      venue: playerIn,
      home: fx.home.name,
      away: fx.away.name,
      opponent: playerIn === "home" ? fx.away.name : fx.home.name,
      gf: subjectGoals,
      ga: oppGoals,
      pts: matchPts,
      minutes: match.playerStats?.minutes ?? (player ? 90 : 0),
      playerOvr: player?.currentOverallRaw ?? null,
      teamAttack: sideEff?.attack ?? null,
      teamOverall: sideEff?.overall ?? null,
      impactAttack: sideEff?.playerImpact?.attack ?? null,
      homeXg: match.expectedGoals?.home ?? null,
      awayXg: match.expectedGoals?.away ?? null,
    });
  }

  return { pts, gf, ga, played, fixtures: fixtureRows, fixturesSha256: sha(fixtureRows) };
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
    minSeasonsRequired: MIN_SEASONS_REQUIRED,
    frozenMinutes: 90,
    schedule: "production-double-round-robin",
    sharedSeasonSeeds: true,
    roles: {},
  };

  const fixturesJsonlPath = join(OUT, "fixtures", `${ctx.id}.jsonl.gz`);
  const fixturesJsonl = createGzip();
  fixturesJsonl.pipe(createWriteStream(fixturesJsonlPath, { flags: "w" }));

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

      for (let s = 0; s < SEASON_N; s++) {
        const seasonSeed = sharedSeasonSeed({ quality, role, seasonIndex: s });
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
          seasonIndex: s,
          seasonSeed,
          pts: result.pts,
          gf: result.gf,
          ga: result.ga,
          played: result.played,
          fixturesSha256: result.fixturesSha256,
        });
        allPts.push(result.pts);
        allGf.push(result.gf);
        allGa.push(result.ga);

        fixturesJsonl.write(
          JSON.stringify({
            context: ctx.id,
            role,
            condition: cond.key,
            ovr: cond.ovr,
            seasonIndex: s,
            seasonSeed,
            fixturesSha256: result.fixturesSha256,
            fixtures: result.fixtures,
          }) + "\n"
        );
      }

      // Same-condition self-replay of season 0 must match exactly.
      {
        const seasonSeed = sharedSeasonSeed({ quality, role, seasonIndex: 0 });
        setWorldState(createWorldState({ seed: seasonSeed, startYear: 2026 }));
        const player = buildPlayer({
          role,
          ovr: cond.ovr,
          club,
          seedTag: `${ctx.id}-${role}-${cond.key}-self`,
        });
        const replay = runProductionSeason({
          league,
          subjectClub: club,
          player,
          seasonSeed,
        });
        const first = seasonSummaries[0];
        if (replay.fixturesSha256 !== first.fixturesSha256 || replay.pts !== first.pts) {
          throw new Error(
            `self-replay-mismatch:${ctx.id}:${role}:${cond.key} first=${first.fixturesSha256} replay=${replay.fixturesSha256}`
          );
        }
      }

      byCond[cond.key] = {
        ovr: cond.ovr,
        points: distribution(allPts),
        gf: distribution(allGf),
        ga: distribution(allGa),
        seasons: seasonSummaries,
      };
    }

    // Paired seeds must be identical across conditions.
    const pairedDeltas = byCond.replacement.seasons.map((rep, idx) => {
      const star = byCond.star99.seasons[idx];
      if (rep.seasonSeed !== star.seasonSeed) {
        throw new Error(
          `paired-seed-mismatch:${ctx.id}:${role}:idx${idx} rep=${rep.seasonSeed} star=${star.seasonSeed}`
        );
      }
      return {
        seasonIndex: idx,
        seasonSeed: rep.seasonSeed,
        dPts: star.pts - rep.pts,
        dGf: star.gf - rep.gf,
        dGa: star.ga - rep.ga,
        repFixturesSha256: rep.fixturesSha256,
        starFixturesSha256: star.fixturesSha256,
      };
    });

    study.roles[role] = {
      refOvr,
      replacement: {
        ovr: byCond.replacement.ovr,
        points: byCond.replacement.points,
        gf: byCond.replacement.gf,
        ga: byCond.replacement.ga,
        seasonSeeds: byCond.replacement.seasons.map((s) => s.seasonSeed),
      },
      star99: {
        ovr: byCond.star99.ovr,
        points: byCond.star99.points,
        gf: byCond.star99.gf,
        ga: byCond.star99.ga,
        seasonSeeds: byCond.star99.seasons.map((s) => s.seasonSeed),
      },
      pairedSeedsEqual: pairedDeltas.every((d) => Number.isFinite(d.seasonSeed)),
      pairedDelta: {
        points: distribution(pairedDeltas.map((d) => d.dPts)),
        gf: distribution(pairedDeltas.map((d) => d.dGf)),
        ga: distribution(pairedDeltas.map((d) => d.dGa)),
        sample: pairedDeltas.slice(0, 8),
      },
      seasonCount: SEASON_N,
      selfReplayExact: true,
    };

    writeFileSync(
      join(OUT, `${ctx.id}-${role}-paired.json`),
      JSON.stringify({ ...study.roles[role], pairedDeltas }, null, 2)
    );
  }

  fixturesJsonl.end();
  study.fixturesPath = `fixtures/${ctx.id}.jsonl.gz`;
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

  const ok =
    studies.length === CONTEXTS.length &&
    SEASON_N >= MIN_SEASONS_REQUIRED &&
    studies.every((s) =>
      ["ST", "CM", "CB", "GK"].every(
        (role) => s.roles[role]?.seasonCount >= MIN_SEASONS_REQUIRED && s.roles[role]?.pairedSeedsEqual === true
      )
    );

  const report = {
    started,
    finished: new Date().toISOString(),
    kind: "production-schedule",
    syntheticProxyNote:
      "qaClubStrengthSuperstarImpact.mjs seasons[] remain a synthetic self-vs-self proxy; this report is the production-schedule gate.",
    seasonN: SEASON_N,
    minSeasonsRequired: MIN_SEASONS_REQUIRED,
    frozenParticipationMinutes: 90,
    sharedSeasonSeeds: true,
    contexts: studies,
    ok,
  };
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        ok: report.ok,
        out: join(OUT, "summary.json"),
        seasonN: SEASON_N,
        minSeasonsRequired: MIN_SEASONS_REQUIRED,
        contexts: studies.map((s) => ({
          id: s.id,
          club: s.club,
          roles: Object.keys(s.roles),
          stDeltaPtsMean: s.roles.ST?.pairedDelta?.points?.mean ?? null,
          pairedSeedsEqual: s.roles.ST?.pairedSeedsEqual,
        })),
      },
      null,
      2
    )
  );
  if (!report.ok) process.exit(1);
}

main();
