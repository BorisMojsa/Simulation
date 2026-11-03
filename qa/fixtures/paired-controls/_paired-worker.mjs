#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a, true];
  })
);
const side = args.side;
const rootDir = args.root;
const inputPath = args.input;
const outPath = args.out;
const shared = JSON.parse(readFileSync(inputPath, "utf8"));
const rootUrl = pathToFileURL(rootDir.endsWith("/") ? rootDir : rootDir + "/");
const mod = (rel) => import(new URL(rel, rootUrl));

function captureRng(getSimRng) {
  try {
    return Number(getSimRng().seed());
  } catch {
    return null;
  }
}

async function runFinal() {
  const { LEAGUES } = await mod("js/data/leagues.js");
  const { setWorldState, deserializeWorldState, getWorldState } = await mod("js/simulation/worldState.js");
  const { importClubFinanceState, exportClubFinanceState } = await mod("js/simulation/clubFinance.js");
  const { createRng, reseedCareerRng, getSimRng, setSimRng } = await mod("js/simulation/rng.js");
  const {
    getClubTargetDecision,
    resolveClubContinentalEntry,
    normalizeFinishPosition,
    competitionForValidatedFinish,
    sourceYearForContinentalTarget,
    commitCompletedDomesticEdition,
  } = await mod("js/simulation/earnedQualification.js");
  const { preSeasonContinentalStanding } = await mod("js/simulation/chronologicalSeason.js");
  const {
    prepareContinentalEdition,
    listContinentalFixtures,
    processContinentalMatchday,
  } = await mod("js/simulation/continentalTournament.js");
  const { continentalCompetitionForStanding } = await mod("js/data/competitions/qualification.js");
  const { recordPlayingTransition } = await mod("js/simulation/playingRegistration.js");

  const league = LEAGUES.find((l) => l.leagueId === shared.leagueId);
  const arsenal = league.clubs.find((c) => c.clubId === shared.arsenalId);
  const brentford = league.clubs.find((c) => c.clubId === shared.brentfordId);

  importClubFinanceState(structuredClone(shared.clubFinance));
  const world = deserializeWorldState(structuredClone(shared.world));
  setWorldState(world);
  reseedCareerRng(shared.worldRngSeed);
  const rng = createRng(shared.worldRngSeed);
  rng.setSeed(shared.expectedRngAfterRestore);
  setSimRng(rng);
  world.rngState = shared.expectedRngAfterRestore;
  const rngAfterRestore = captureRng(getSimRng);
  if (rngAfterRestore !== shared.expectedRngAfterRestore) {
    throw new Error(
      "final RNG restore mismatch: got " + rngAfterRestore + " expected " + shared.expectedRngAfterRestore
    );
  }

  const player = structuredClone(shared.player);
  let result;
  if (shared.id === "F01") {
    const standing = preSeasonContinentalStanding(player, league, { world: getWorldState(), seasonYear: 2026 });
    const edition = standing
      ? prepareContinentalEdition({ standing, league, player, seasonYear: 2026, world: getWorldState() })
      : null;
    const decision = getClubTargetDecision(getWorldState(), brentford.clubId, 2026)?.entry || null;
    const eligible = edition
      ? listContinentalFixtures(edition, { status: "scheduled", playerOnly: true, player }).length
      : 0;
    result = {
      standing: standing ? { position: standing.position, competition: standing.competition || null } : null,
      editionCompetition: edition?.competition || null,
      eligibleCount: eligible,
      decisionStatus: decision?.status || null,
      decisionCompetition: decision?.competition || null,
      decisionPosition: decision?.position ?? null,
      staleArsenalRowPosition: player.latestStanding?.playerRow?.position ?? null,
      staleArsenalRowClubId: player.latestStanding?.playerRow?.clubId ?? null,
    };
  } else if (shared.id === "F02") {
    player.club = { ...arsenal, league: league.name, leagueId: league.leagueId, nation: league.nation };
    player.playingClubId = arsenal.clubId;
    player.employmentClubId = arsenal.clubId;
    const entry = resolveClubContinentalEntry({
      world: getWorldState(),
      league,
      clubId: arsenal.clubId,
      targetYear: 2026,
      player,
      allowBootstrap: false,
    });
    result = { status: entry.status, competition: entry.competition || null, position: entry.position ?? null };
  } else if (shared.id === "F03") {
    const entry = resolveClubContinentalEntry({
      world: getWorldState(),
      league,
      clubId: brentford.clubId,
      targetYear: 2026,
      player,
      allowBootstrap: false,
    });
    result = {
      status: entry.status,
      competition: entry.competition || null,
      ovr: shared.hotOvr,
    };
  } else if (shared.id === "F05") {
    const stale = resolveClubContinentalEntry({
      world: getWorldState(),
      league,
      clubId: arsenal.clubId,
      targetYear: 2026,
      player,
      allowBootstrap: false,
    });
    // Commit the correct source year from the shared table (same bytes both sides use).
    commitCompletedDomesticEdition({
      world: getWorldState(),
      league,
      table: shared.table,
      sourceYear: shared.sourceYear || 2025,
      provenance: "legacy-migrated",
    });
    const ok = resolveClubContinentalEntry({
      world: getWorldState(),
      league,
      clubId: arsenal.clubId,
      targetYear: 2026,
      player,
      allowBootstrap: false,
    });
    result = {
      staleStatus: stale.status === "qualified" ? "qualified" : "unresolved",
      okStatus: ok.status,
      okCompetition: ok.competition || null,
      sourceYearFor2026: sourceYearForContinentalTarget(2026),
    };
  } else if (shared.id === "F10") {
    const badPositions = [null, undefined, "", NaN, Infinity, -Infinity, 0, -1, 0.5, "1.5", "abc", 99];
    const rejected = badPositions.map((p) => {
      const n = normalizeFinishPosition(p, { tableSize: league.clubs.length });
      return {
        value: String(p),
        normalizeOk: Boolean(n?.ok),
        competition: n?.ok
          ? competitionForValidatedFinish({ position: n.position }, league, {
              tableSize: league.clubs.length,
            })
          : null,
      };
    });
    const conflicting = competitionForValidatedFinish(
      { position: 17, qualification: "Champions League" },
      league,
      { tableSize: league.clubs.length }
    );
    const legacy = normalizeFinishPosition("3", { tableSize: league.clubs.length });
    const legacyNumeric = legacy.ok
      ? competitionForValidatedFinish({ position: legacy.position }, league, {
          tableSize: league.clubs.length,
        })
      : null;
    result = { rejected, conflicting, legacyNumeric };
  } else if (shared.id === "F15") {
    player.club = { ...arsenal, league: league.name, leagueId: league.leagueId, nation: league.nation };
    player.playingClubId = arsenal.clubId;
    player.employmentClubId = arsenal.clubId;
    const standing = preSeasonContinentalStanding(player, league, { world: getWorldState(), seasonYear: 2026 });
    const original = prepareContinentalEdition({
      standing,
      league,
      player,
      seasonYear: 2026,
      world: getWorldState(),
    });
    const fixtureIdsBefore = Object.keys(original.fixtures || {}).sort();
    const fieldBefore = (original.field || []).map((c) => c.clubId || c).sort();
    const scoresBefore = {};
    for (const id of fixtureIdsBefore) {
      const f = original.fixtures[id];
      scoresBefore[id] = {
        status: f?.status || null,
        homeGoals: f?.homeGoals ?? f?.score?.home ?? null,
        awayGoals: f?.awayGoals ?? f?.score?.away ?? null,
        tieId: f?.tieId || null,
      };
    }
    const played = [];
    for (const md of original.openingMatchdays || []) {
      const day = listContinentalFixtures(original).find((f) => f.matchday === md)?.date;
      if (day && day <= "2027-01-10") {
        processContinentalMatchday(original, md, { player });
        played.push(md);
      }
    }
    recordPlayingTransition(player, {
      kind: "permanent",
      effectiveDate: "2027-01-10",
      playingClubId: brentford.clubId,
      employmentClubId: brentford.clubId,
      leagueId: league.leagueId,
      clubName: brentford.name,
    });
    player.playingClubId = brentford.clubId;
    player.employmentClubId = brentford.clubId;
    player.club = { ...brentford, league: league.name, leagueId: league.leagueId, nation: league.nation };
    const afterMove = listContinentalFixtures(original, {
      status: "scheduled",
      playerOnly: true,
      player,
    }).filter((f) => f.stageType === "league" && f.date > "2027-01-10").length;
    const refocus = prepareContinentalEdition({
      standing: preSeasonContinentalStanding(player, league, { world: getWorldState(), seasonYear: 2026 }),
      league,
      player,
      seasonYear: 2026,
      world: getWorldState(),
    });
    const fixtureIdsAfter = Object.keys(refocus.fixtures || {}).sort();
    const scoresAfter = {};
    for (const id of fixtureIdsAfter) {
      const f = refocus.fixtures[id];
      scoresAfter[id] = {
        status: f?.status || null,
        homeGoals: f?.homeGoals ?? f?.score?.home ?? null,
        awayGoals: f?.awayGoals ?? f?.score?.away ?? null,
        tieId: f?.tieId || null,
      };
    }
    result = {
      playedMatchdays: played,
      fieldEqual: JSON.stringify((refocus.field || []).map((c) => c.clubId || c).sort()) === JSON.stringify(fieldBefore),
      fixturesEqual: JSON.stringify(fixtureIdsAfter) === JSON.stringify(fixtureIdsBefore),
      scoresEqual: JSON.stringify(scoresAfter) === JSON.stringify(scoresBefore),
      fixtureIdsBefore,
      fixtureIdsAfter,
      editionFocusClubId: refocus.editionFocusClubId || refocus.playerClubId || null,
      viewFocusClubId: refocus.viewFocusClubId || null,
      lateEligibleAfterMove: afterMove,
    };
  } else {
    throw new Error("unknown control " + shared.id);
  }

  writeFileSync(
    outPath,
    JSON.stringify(
      {
        side,
        sourceSha: args.sha,
        rngAfterRestore,
        expectedRngAfterRestore: shared.expectedRngAfterRestore,
        rngMatchesExpected: rngAfterRestore === shared.expectedRngAfterRestore,
        rngAfterRun: captureRng(getSimRng),
        clubFinanceKeys: Object.keys(exportClubFinanceState()?.ledgers || {}).sort(),
        inputHash: args.inputHash,
        result,
      },
      null,
      2
    )
  );
}

async function runBase() {
  const { LEAGUES } = await mod("js/data/leagues.js");
  const { createWorldState, setWorldState, getWorldState } = await mod("js/simulation/worldState.js");
  const { resetClubFinanceLedgers, importClubFinanceState, exportClubFinanceState } = await mod(
    "js/simulation/clubFinance.js"
  );
  const { createRng, reseedCareerRng, getSimRng, setSimRng } = await mod("js/simulation/rng.js");
  const { preSeasonContinentalStanding } = await mod("js/simulation/chronologicalSeason.js");
  const { prepareContinentalEdition, listContinentalFixtures, processContinentalMatchday } = await mod(
    "js/simulation/continentalTournament.js"
  );
  const { continentalCompetitionForStanding } = await mod("js/data/competitions/qualification.js");
  const { recordPlayingTransition } = await mod("js/simulation/playingRegistration.js");

  const league = LEAGUES.find((l) => l.leagueId === shared.leagueId);
  const arsenal = league.clubs.find((c) => c.clubId === shared.arsenalId);
  const brentford = league.clubs.find((c) => c.clubId === shared.brentfordId);

  resetClubFinanceLedgers();
  if (shared.clubFinance) importClubFinanceState(structuredClone(shared.clubFinance));
  // Deterministic world create, then restore archived runtime RNG state.
  setWorldState(createWorldState({ seed: shared.seed, startYear: 2026 }));
  reseedCareerRng(shared.worldRngSeed ?? shared.seed);
  const rng = createRng(shared.worldRngSeed ?? shared.seed);
  rng.setSeed(shared.expectedRngAfterRestore);
  setSimRng(rng);
  getWorldState().rngSeed = shared.worldRngSeed ?? shared.seed;
  getWorldState().rngState = shared.expectedRngAfterRestore;
  const rngAfterRestore = captureRng(getSimRng);
  if (rngAfterRestore !== shared.expectedRngAfterRestore) {
    throw new Error(
      "base RNG restore mismatch: got " + rngAfterRestore + " expected " + shared.expectedRngAfterRestore
    );
  }

  // Same underlying player bytes as final (adapter only attaches base-era standing usage).
  const player = structuredClone(shared.player);
  const table = shared.table;

  let result;
  if (shared.id === "F01") {
    // Preserve the shared stale Arsenal row exactly.
    player.latestStanding = {
      leagueId: league.leagueId,
      seasonId: league.leagueId + "::" + (shared.sourceYear || 2025),
      table,
      playerRow: shared.arsenalRow,
    };
    const standing = preSeasonContinentalStanding(player, league);
    const edition = standing
      ? prepareContinentalEdition({ standing, league, player, seasonYear: 2026 })
      : null;
    const eligible = edition
      ? listContinentalFixtures(edition, { status: "scheduled", playerOnly: true, player }).length
      : 0;
    result = {
      standing: standing ? { position: standing.position, competition: standing.qualification || null } : null,
      editionCompetition: edition?.competition || null,
      eligibleCount: eligible,
      decisionStatus: null,
      decisionCompetition: null,
      decisionPosition: standing?.position ?? null,
      staleArsenalRowPosition: player.latestStanding?.playerRow?.position ?? null,
      staleArsenalRowClubId: player.latestStanding?.playerRow?.clubId ?? null,
      adapter: "base-latestStanding-shared-player",
    };
  } else if (shared.id === "F02") {
    player.club = { ...arsenal, league: league.name, leagueId: league.leagueId, nation: league.nation };
    player.playingClubId = arsenal.clubId;
    player.employmentClubId = arsenal.clubId;
    player.latestStanding = {
      leagueId: league.leagueId,
      seasonId: league.leagueId + "::" + (shared.sourceYear || 2025),
      table,
      playerRow: shared.arsenalRow,
    };
    const standing = preSeasonContinentalStanding(player, league);
    result = {
      status: standing ? "qualified" : "not-qualified",
      competition: standing ? continentalCompetitionForStanding(standing, league) : null,
      position: standing?.position ?? null,
      adapter: "base-latestStanding-shared-player",
    };
  } else if (shared.id === "F03") {
    player.latestStanding = {
      leagueId: league.leagueId,
      seasonId: league.leagueId + "::" + (shared.sourceYear || 2025),
      table,
      playerRow: shared.brentfordRow,
    };
    const standing = preSeasonContinentalStanding(player, league);
    result = {
      status: standing ? "qualified" : "not-qualified",
      competition: standing ? continentalCompetitionForStanding(standing, league) : null,
      ovr: shared.hotOvr,
      adapter: "base-latestStanding-shared-player",
    };
  } else if (shared.id === "F05") {
    // Shared world has only the 2024 commit; base has no edition registry target-year gate.
    player.latestStanding = {
      leagueId: league.leagueId,
      seasonId: league.leagueId + "::2024",
      table,
      playerRow: table[0],
    };
    const staleStanding = preSeasonContinentalStanding(player, league);
    player.latestStanding = {
      leagueId: league.leagueId,
      seasonId: league.leagueId + "::" + (shared.sourceYear || 2025),
      table,
      playerRow: shared.arsenalRow,
    };
    const okStanding = preSeasonContinentalStanding(player, league);
    result = {
      staleStatus: staleStanding ? "qualified" : "unresolved",
      okStatus: okStanding ? "qualified" : "unresolved",
      okCompetition: okStanding ? continentalCompetitionForStanding(okStanding, league) : null,
      sourceYearFor2026: 2025,
      adapter: "base-latestStanding-year-switch",
    };
  } else if (shared.id === "F10") {
    const badPositions = [null, undefined, "", NaN, Infinity, -Infinity, 0, -1, 0.5, "1.5", "abc", 99];
    const rejected = badPositions.map((p) => ({
      value: String(p),
      normalizeOk: Number.isInteger(Number(p)) && Number(p) >= 1 && Number(p) <= 20,
      competition: continentalCompetitionForStanding({ position: p }, league),
    }));
    const conflicting = continentalCompetitionForStanding(
      { position: 17, qualification: "Champions League" },
      league
    );
    const legacyNumeric = continentalCompetitionForStanding({ position: "3" }, league);
    result = { rejected, conflicting, legacyNumeric, adapter: "base-label-fallback" };
  } else if (shared.id === "F15") {
    player.club = { ...arsenal, league: league.name, leagueId: league.leagueId, nation: league.nation };
    player.playingClubId = arsenal.clubId;
    player.employmentClubId = arsenal.clubId;
    player.latestStanding = {
      leagueId: league.leagueId,
      seasonId: league.leagueId + "::" + (shared.sourceYear || 2025),
      table,
      playerRow: shared.arsenalRow,
    };
    const standing = preSeasonContinentalStanding(player, league);
    const original = prepareContinentalEdition({ standing, league, player, seasonYear: 2026 });
    const fixtureIdsBefore = Object.keys(original.fixtures || {}).sort();
    const fieldBefore = (original.field || []).map((c) => c.clubId || c).sort();
    const scoresBefore = {};
    for (const id of fixtureIdsBefore) {
      const f = original.fixtures[id];
      scoresBefore[id] = {
        status: f?.status || null,
        homeGoals: f?.homeGoals ?? f?.score?.home ?? null,
        awayGoals: f?.awayGoals ?? f?.score?.away ?? null,
        tieId: f?.tieId || null,
      };
    }
    const played = [];
    for (const md of original.openingMatchdays || []) {
      const day = listContinentalFixtures(original).find((f) => f.matchday === md)?.date;
      if (day && day <= "2027-01-10") {
        processContinentalMatchday(original, md, { player });
        played.push(md);
      }
    }
    recordPlayingTransition(player, {
      kind: "permanent",
      effectiveDate: "2027-01-10",
      playingClubId: brentford.clubId,
      employmentClubId: brentford.clubId,
      leagueId: league.leagueId,
      clubName: brentford.name,
    });
    player.playingClubId = brentford.clubId;
    player.employmentClubId = brentford.clubId;
    player.club = { ...brentford, league: league.name, leagueId: league.leagueId, nation: league.nation };
    const afterMove = listContinentalFixtures(original, {
      status: "scheduled",
      playerOnly: true,
      player,
    }).filter((f) => f.stageType === "league" && f.date > "2027-01-10").length;
    const refocus = prepareContinentalEdition({
      standing: preSeasonContinentalStanding(
        {
          ...player,
          latestStanding: {
            leagueId: league.leagueId,
            table,
            playerRow: shared.brentfordRow,
          },
        },
        league
      ),
      league,
      player,
      seasonYear: 2026,
    });
    const fixtureIdsAfter = Object.keys(refocus?.fixtures || {}).sort();
    const scoresAfter = {};
    for (const id of fixtureIdsAfter) {
      const f = refocus.fixtures[id];
      scoresAfter[id] = {
        status: f?.status || null,
        homeGoals: f?.homeGoals ?? f?.score?.home ?? null,
        awayGoals: f?.awayGoals ?? f?.score?.away ?? null,
        tieId: f?.tieId || null,
      };
    }
    result = {
      playedMatchdays: played,
      fieldEqual: JSON.stringify((refocus?.field || []).map((c) => c.clubId || c).sort()) === JSON.stringify(fieldBefore),
      fixturesEqual: JSON.stringify(fixtureIdsAfter) === JSON.stringify(fixtureIdsBefore),
      scoresEqual: JSON.stringify(scoresAfter) === JSON.stringify(scoresBefore),
      fixtureIdsBefore,
      fixtureIdsAfter,
      editionFocusClubId: refocus?.editionFocusClubId || refocus?.playerClubId || null,
      viewFocusClubId: refocus?.viewFocusClubId || null,
      lateEligibleAfterMove: afterMove,
      adapter: "base-soft-refocus-shared-player",
    };
  } else {
    throw new Error("unknown control " + shared.id);
  }

  writeFileSync(
    outPath,
    JSON.stringify(
      {
        side,
        sourceSha: args.sha,
        rngAfterRestore,
        expectedRngAfterRestore: shared.expectedRngAfterRestore,
        rngMatchesExpected: rngAfterRestore === shared.expectedRngAfterRestore,
        rngAfterRun: captureRng(getSimRng),
        clubFinanceKeys: Object.keys(exportClubFinanceState()?.ledgers || {}).sort(),
        inputHash: args.inputHash,
        result,
      },
      null,
      2
    )
  );
}

if (side === "final") await runFinal();
else if (side === "base") await runBase();
else throw new Error("side must be base|final");
