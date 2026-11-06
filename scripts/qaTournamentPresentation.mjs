#!/usr/bin/env node
/**
 * Fix 12 deterministic engine/presentation evidence exporter.
 *
 *   node scripts/qaTournamentPresentation.mjs --out qa/fix12-runs/final
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { LEAGUES } from "../js/data/leagues.js";
import { createRng } from "../js/simulation/rng.js";
import { createWorldState, setWorldState, serializeWorldState } from "../js/simulation/worldState.js";
import {
  generateStartingAttributes,
  initializePlayerDevelopment,
} from "../js/simulation/playerDevelopmentModel.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import {
  prepareNationalEdition,
  drainNationalEdition,
  buildNationalCampaignView,
} from "../js/simulation/nationalTournament.js";
import {
  prepareContinentalEdition,
  processContinentalMatchday,
  buildContinentalCampaignView,
} from "../js/simulation/continentalTournament.js";
import { serializeCareerSnapshot } from "../js/simulation/careerSnapshot.js";
import {
  collectRawPlayedFixtures,
  oracleTallyFromFixtures,
  projectTournamentRecords,
  resolveOpeningPhaseLabel,
} from "../js/ui/tournamentPresentation.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const OUT = resolve(ROOT, outIdx >= 0 ? args[outIdx + 1] : "qa/fix12-runs/final");

function sha256(text) {
  return createHash("sha256").update(String(text)).digest("hex");
}
function write(rel, value) {
  const path = join(OUT, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value, null, 2));
  return path;
}

function serbiaSetup(seed, year = 2026) {
  resetClubFinanceLedgers();
  const world = createWorldState({ seed, startYear: year });
  setWorldState(world);
  const league = LEAGUES.find((l) => l.nation === "Serbia");
  const club = league.clubs.find((c) => /Red Star/.test(c.name));
  const rng = createRng(12);
  const player = {
    name: "Fix12 QA",
    nationality: "Serbia",
    position: "ST",
    age: 25,
    careerId: `fix12-qa-${seed}`,
    startYear: year,
    rating: 85,
    attributes: generateStartingAttributes("ST", 85, 99, rng),
    club: { ...club, league: league.name, leagueId: league.leagueId, nation: league.nation },
    playingClubId: club.clubId,
    employmentClubId: club.clubId,
    seasons: [],
    careerTotals: { matches: 40, goals: 12, assists: 5, cleanSheets: 0 },
    careerHonors: {
      leagueTitles: 0,
      domesticCups: 0,
      europeanTitles: 0,
      internationalTitles: 1,
      individualAwards: 0,
    },
    weeklyWage: 50000,
    contractEndSeason: year + 3,
    pendingOffers: [],
    playingStints: [],
    latestStanding: {
      leagueId: league.leagueId,
      playerRow: { position: 1, qualification: "Champions League", points: 80 },
    },
  };
  initializePlayerDevelopment(player, { rng, careerId: player.careerId });
  return { world, league, club, player };
}

function f01Processor() {
  let groupGames = 0;
  return (req) => {
    const draw = req.stageType === "group" && ++groupGames === 3;
    const homeGoals = draw ? 1 : req.playerSide === "home" ? 2 : 0;
    const awayGoals = draw ? 1 : req.playerSide === "away" ? 2 : 0;
    return {
      match: {
        ...req,
        homeGoals,
        awayGoals,
        matchHomeGoals: homeGoals,
        matchAwayGoals: awayGoals,
        regulationHomeGoals: homeGoals,
        regulationAwayGoals: awayGoals,
        scoreline: `${homeGoals}-${awayGoals}`,
        winnerSide: draw ? null : req.playerSide,
        decidedBy: "regulation",
        events: [],
      },
    };
  };
}

function buildF01() {
  const { world, player, club, league } = serbiaSetup(12001, 2026);
  const ed = prepareNationalEdition({
    tournament: {
      id: "world-cup",
      name: "FIFA World Cup",
      shortName: "World Cup",
      confederation: "FIFA",
      fieldSize: 48,
      groupSize: 4,
      bestThirds: 8,
      editionYear: 2026,
      year: 2026,
    },
    player,
    calledUp: true,
    forceIncludeIfEligible: true,
    calendarYear: 2026,
    world,
  });
  drainNationalEdition(ed, { player, world, matchProcessor: f01Processor() });
  const view = buildNationalCampaignView(ed, { player, world });
  const nationFx = Object.values(view.fixtures || {}).filter((m) => {
    if (m.status !== "played") return false;
    const h = m.home?.name || m.homeParticipantId;
    const a = m.away?.name || m.awayParticipantId;
    return h === "Serbia" || a === "Serbia";
  });
  const oracle = oracleTallyFromFixtures(nationFx, ["Serbia"]);
  const proj = projectTournamentRecords({
    campaign: view,
    scope: { participantKind: "nation", participantId: "Serbia" },
  });
  return { world, player, club, league, view, nationFx, oracle, proj };
}

function buildUclControl() {
  const { world, league, club, player } = serbiaSetup(7, 2026);
  const state = prepareContinentalEdition({
    standing: player.latestStanding.playerRow,
    league,
    player,
    seasonYear: 2026,
  });
  const script = {
    1: { gf: 3, ga: 2 },
    2: { gf: 1, ga: 0 },
    3: { gf: 1, ga: 0 },
    4: { gf: 1, ga: 0 },
    5: { gf: 0, ga: 0 },
    6: { gf: 2, ga: 2 },
    7: { gf: 0, ga: 2 },
    8: { gf: 1, ga: 3 },
  };
  for (const md of state.openingMatchdays) {
    processContinentalMatchday(state, md, {
      player,
      matchProcessor: (req) => {
        const sc = script[md];
        const homeIsPlayer = req.playerSide === "home";
        const homeGoals = homeIsPlayer ? sc.gf : sc.ga;
        const awayGoals = homeIsPlayer ? sc.ga : sc.gf;
        return {
          match: {
            home: req.home,
            away: req.away,
            homeGoals,
            awayGoals,
            matchHomeGoals: homeGoals,
            matchAwayGoals: awayGoals,
            regulationHomeGoals: homeGoals,
            regulationAwayGoals: awayGoals,
            playerSide: req.playerSide,
            scoreline: `${homeGoals}-${awayGoals}`,
            events: [],
          },
        };
      },
    });
  }
  const view = buildContinentalCampaignView(state, { playerName: club.name, world });
  const row = view.leaguePhase.table.find((r) => r.clubId === club.clubId);
  const proj = projectTournamentRecords({
    campaign: view,
    scope: { participantKind: "club", participantId: club.clubId, participantLabel: club.name },
  });
  return { world, player, club, view, row, proj };
}

function gameplayFingerprint(view, kind) {
  if (kind === "national") {
    const fixtures = Object.values(view.fixtures || {})
      .filter((m) => m.status === "played")
      .map((m) => ({
        id: m.matchId,
        h: m.homeParticipantId || m.home?.name,
        a: m.awayParticipantId || m.away?.name,
        hg: m.matchHomeGoals ?? m.homeGoals,
        ag: m.matchAwayGoals ?? m.awayGoals,
        ph: m.penaltyHome ?? m.homePenalties ?? null,
        pa: m.penaltyAway ?? m.awayPenalties ?? null,
        stage: m.stageId,
      }))
      .sort((x, y) => String(x.id).localeCompare(String(y.id)));
    return { winner: view.winner, result: view.result, fixtures };
  }
  const fixtures = (view.leaguePhase?.matches || [])
    .map((m) => ({
      id: m.matchId,
      h: m.home?.clubId || m.home?.name,
      a: m.away?.clubId || m.away?.name,
      hg: m.matchHomeGoals ?? m.homeGoals,
      ag: m.matchAwayGoals ?? m.awayGoals,
    }))
    .sort((x, y) => String(x.id).localeCompare(String(y.id)));
  return {
    competition: view.competition,
    focusClubId: view.focusClubId,
    table: (view.leaguePhase?.table || []).map((r) => ({
      clubId: r.clubId,
      p: r.played,
      w: r.wins,
      d: r.draws,
      l: r.losses,
      pts: r.points,
      gf: r.goalsFor,
      ga: r.goalsAgainst,
    })),
    fixtures,
  };
}

mkdirSync(OUT, { recursive: true });
const failures = [];
const cases = [];

const f01 = buildF01();
const f01Ok =
  f01.proj.openingPhase.record.played === 3 &&
  f01.proj.openingPhase.record.wins === 2 &&
  f01.proj.openingPhase.record.draws === 1 &&
  f01.proj.tournament.record.played === 8 &&
  f01.proj.tournament.record.wins === 7 &&
  f01.proj.resultLabel === "Winners" &&
  resolveOpeningPhaseLabel(f01.view) === "Group stage";
if (!f01Ok) failures.push("F01 mismatch");
cases.push({
  id: "F01",
  ok: f01Ok,
  expected: { group: "3/2/1/0", total: "8/7/1/0", result: "Winners", opening: "Group stage" },
  actual: {
    group: f01.proj.openingPhase.record,
    total: f01.proj.tournament.record,
    result: f01.proj.resultLabel,
    opening: resolveOpeningPhaseLabel(f01.view),
  },
  oracle: f01.oracle.record,
  fixtureIds: f01.nationFx.map((m) => m.matchId),
});

const ucl = buildUclControl();
const uclOk =
  ucl.row.played === 8 &&
  ucl.row.wins === 4 &&
  ucl.row.draws === 2 &&
  ucl.row.losses === 2 &&
  ucl.row.points === 14 &&
  ucl.proj.openingPhase.record.played === 8;
if (!uclOk) failures.push("UEFA control mismatch");
cases.push({
  id: "F03-phase",
  ok: uclOk,
  expected: { p: 8, w: 4, d: 2, l: 2, pts: 14 },
  actual: {
    row: {
      p: ucl.row.played,
      w: ucl.row.wins,
      d: ucl.row.draws,
      l: ucl.row.losses,
      pts: ucl.row.points,
    },
    phase: ucl.proj.openingPhase.record,
  },
});

// Negative control: counting an aggregate must not inflate P
const aggPoison = collectRawPlayedFixtures([
  ...f01.nationFx,
  {
    matchId: "poison-agg",
    isAggregate: true,
    status: "played",
    home: { name: "Serbia" },
    away: { name: "X" },
    homeGoals: 9,
    awayGoals: 0,
    legs: f01.nationFx.slice(0, 2),
  },
]);
const poisonTally = oracleTallyFromFixtures(aggPoison.fixtures, ["Serbia"]);
const negOk = poisonTally.record.played === f01.oracle.record.played;
if (!negOk) failures.push("negative aggregate control failed");
cases.push({
  id: "F18-negative-aggregate",
  ok: negOk,
  expectedPlayed: f01.oracle.record.played,
  actualPlayed: poisonTally.record.played,
});

const nationalFp = gameplayFingerprint(f01.view, "national");
const continentalFp = gameplayFingerprint(ucl.view, "continental");
write("gameplay-parity/national-fingerprint.json", nationalFp);
write("gameplay-parity/continental-fingerprint.json", continentalFp);
write("gameplay-parity/national-fingerprint.sha256", sha256(JSON.stringify(nationalFp)) + "\n");
write("gameplay-parity/continental-fingerprint.sha256", sha256(JSON.stringify(continentalFp)) + "\n");

// Re-run identical recipes for parity self-check (same revision)
const f01b = buildF01();
const uclb = buildUclControl();
const nationalParity =
  sha256(JSON.stringify(gameplayFingerprint(f01b.view, "national"))) ===
  sha256(JSON.stringify(nationalFp));
const continentalParity =
  sha256(JSON.stringify(gameplayFingerprint(uclb.view, "continental"))) ===
  sha256(JSON.stringify(continentalFp));
if (!nationalParity || !continentalParity) failures.push("gameplay parity self-check failed");
write("gameplay-parity/parity-result.json", {
  nationalParity,
  continentalParity,
  note: "Matched identical seeds/injection on this revision; protected scores/IDs must match.",
});

// Browser-ready snapshot with controlled season history
f01.player.seasons = [
  {
    year: 2026,
    seasonLabel: "2026",
    clubId: f01.club.clubId,
    clubName: f01.club.displayName || f01.club.name,
    europeanCampaign: ucl.view,
    international: {
      year: 2026,
      hasTournaments: true,
      calledUp: true,
      tournaments: [f01.view],
      primary: f01.view,
      playerMatches: f01.view.playerMatches || [],
    },
    trophies: [{ kind: "international", label: "FIFA World Cup Winners", competition: "FIFA World Cup" }],
  },
];
const snapshot = serializeCareerSnapshot({ player: f01.player, world: f01.world });
write("fixtures/f01-career-snapshot.json", snapshot);
write("fixtures/f01-campaign.json", {
  recipe: {
    seed: 12001,
    nation: "Serbia",
    fieldSize: 48,
    forced: "2 group wins, 1 draw, 5 KO wins",
  },
  view: f01.view,
  projection: f01.proj,
  oracle: f01.oracle.record,
  fixtureInventory: f01.nationFx.map((m) => ({
    id: m.matchId,
    stage: m.stageId,
    stageType: m.stageType,
    score: m.scoreline || `${m.homeGoals}-${m.awayGoals}`,
  })),
});
write("fixtures/ucl-phase-control.json", {
  recipe: { seed: 7, script: "W4 D2 L2 Pts14" },
  row: {
    p: ucl.row.played,
    w: ucl.row.wins,
    d: ucl.row.draws,
    l: ucl.row.losses,
    pts: ucl.row.points,
  },
  projection: ucl.proj,
});

const testRun = spawnSync("node", ["--test", "tests/tournamentPresentation.test.mjs"], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
});
write("logs/tournamentPresentation.test.log", testRun.stdout + testRun.stderr);
if (testRun.status !== 0) failures.push("tournamentPresentation tests failed");

write("case-index.json", {
  generatedAt: new Date().toISOString(),
  out: OUT,
  cases,
  failures,
  ok: failures.length === 0,
});
write("README.md", `# Fix 12 QA export

Out: \`${OUT}\`

Cases: ${cases.length}
Failures: ${failures.length ? failures.join("; ") : "none"}

Rerun:
\`\`\`bash
node scripts/qaTournamentPresentation.mjs --out qa/fix12-runs/final
\`\`\`
`);

console.log(JSON.stringify({ out: OUT, ok: failures.length === 0, failures, cases: cases.length }, null, 2));
if (failures.length) process.exit(1);
