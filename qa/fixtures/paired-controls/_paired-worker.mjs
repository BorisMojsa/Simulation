#!/usr/bin/env node
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
const input = JSON.parse(readFileSync(inputPath, "utf8"));

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
  const { createWorldState, setWorldState, getWorldState } = await mod("js/simulation/worldState.js");
  const { resetClubFinanceLedgers, exportClubFinanceState } = await mod("js/simulation/clubFinance.js");
  const { createRng, reseedCareerRng, getSimRng } = await mod("js/simulation/rng.js");
  const {
    commitCompletedDomesticEdition,
    getClubTargetDecision,
    resolveClubContinentalEntry,
    normalizeFinishPosition,
    competitionForValidatedFinish,
    sourceYearForContinentalTarget,
  } = await mod("js/simulation/earnedQualification.js");
  const { preSeasonContinentalStanding } = await mod("js/simulation/chronologicalSeason.js");
  const {
    prepareContinentalEdition,
    listContinentalFixtures,
    processContinentalMatchday,
  } = await mod("js/simulation/continentalTournament.js");
  const { recordPlayingTransition, ensurePlayingStints } = await mod("js/simulation/playingRegistration.js");
  const { generateStartingAttributes, initializePlayerDevelopment } = await mod(
    "js/simulation/playerDevelopmentModel.js"
  );
  const { ensurePlayerModel } = await mod("js/simulation/playerModelMigration.js");
  const { refreshAbilityCaches } = await mod("js/simulation/playerAbility.js");
  const { ensureContractAuthority } = await mod("js/simulation/contractLifecycle.js");
  const { ensureTransferSave } = await mod("js/simulation/transferMigration.js");
  const { qualificationForPosition, findSisterLeagues } = await mod("js/simulation/leaguePhase.js");
  const { continentalCompetitionForStanding } = await mod("js/data/competitions/qualification.js");

  const league = LEAGUES.find((l) => l.leagueId === input.leagueId);
  const arsenal = league.clubs.find((c) => c.clubId === input.arsenalId);
  const brentford = league.clubs.find((c) => c.clubId === input.brentfordId);

  function orderedTable(placements = {}) {
    const sisters = findSisterLeagues(league, LEAGUES);
    const placed = new Map(Object.entries(placements));
    const remaining = league.clubs.filter((c) => ![...placed.values()].includes(c.clubId));
    const slots = Array.from({ length: league.clubs.length }, () => null);
    for (const [posStr, clubId] of placed) slots[Number(posStr) - 1] = league.clubs.find((c) => c.clubId === clubId);
    let r = 0;
    for (let i = 0; i < slots.length; i++) if (!slots[i]) slots[i] = remaining[r++];
    return slots.map((c, i) => {
      const position = i + 1;
      return {
        ...c,
        position,
        points: Math.max(0, 100 - i * 3),
        matches: 38,
        played: 38,
        wins: 20,
        draws: 8,
        losses: 10,
        goalsFor: 50 - i,
        goalsAgainst: 20 + i,
        goalDiff: 30 - 2 * i,
        qualification: qualificationForPosition(position, league, sisters) || "",
      };
    });
  }

  function makePlayer(club, extra = {}) {
    const rng = createRng(91);
    const p = {
      name: "Paired09",
      careerId: "paired09",
      position: "CM",
      nationality: "England",
      age: 24,
      startYear: 2026,
      rating: extra.rating ?? 90,
      attributes: generateStartingAttributes("CM", extra.rating ?? 90, 99, rng),
      club: { ...club, league: league.name, leagueId: league.leagueId, nation: league.nation },
      playingClubId: club.clubId,
      employmentClubId: club.clubId,
      seasons: [],
      ...extra,
    };
    ensurePlayerModel(p);
    initializePlayerDevelopment(p, { rng });
    refreshAbilityCaches(p);
    ensureContractAuthority(p);
    ensureTransferSave(p);
    ensurePlayingStints(p, { asOfDate: "2026-07-01" });
    return p;
  }

  resetClubFinanceLedgers();
  reseedCareerRng(input.seed);
  setWorldState(createWorldState({ startYear: 2026, rngSeed: input.seed }));
  const rngAfterRestore = captureRng(getSimRng);

  let result;
  if (input.id === "F01") {
    const table = orderedTable(input.placements);
    commitCompletedDomesticEdition({
      world: getWorldState(),
      league,
      table,
      sourceYear: 2025,
      provenance: "legacy-migrated",
    });
    const player = makePlayer(brentford);
    recordPlayingTransition(player, {
      kind: "permanent",
      effectiveDate: "2026-07-01",
      playingClubId: brentford.clubId,
      employmentClubId: brentford.clubId,
      leagueId: league.leagueId,
      clubName: brentford.name,
    });
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
    };
  } else if (input.id === "F02") {
    const table = orderedTable(input.placements);
    commitCompletedDomesticEdition({
      world: getWorldState(),
      league,
      table,
      sourceYear: 2025,
      provenance: "legacy-migrated",
    });
    const player = makePlayer(brentford);
    recordPlayingTransition(player, {
      kind: "permanent",
      effectiveDate: "2026-07-01",
      playingClubId: arsenal.clubId,
      employmentClubId: arsenal.clubId,
      leagueId: league.leagueId,
      clubName: arsenal.name,
    });
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
  } else if (input.id === "F03") {
    const table = orderedTable(input.placements);
    commitCompletedDomesticEdition({
      world: getWorldState(),
      league,
      table,
      sourceYear: 2025,
      provenance: "legacy-migrated",
    });
    const highOut = makePlayer(brentford, { rating: input.hotOvr });
    const entry = resolveClubContinentalEntry({
      world: getWorldState(),
      league,
      clubId: brentford.clubId,
      targetYear: 2026,
      player: highOut,
      allowBootstrap: false,
    });
    result = { status: entry.status, competition: entry.competition || null, ovr: input.hotOvr };
  } else if (input.id === "F05") {
    const table = orderedTable(input.placements);
    commitCompletedDomesticEdition({
      world: getWorldState(),
      league,
      table,
      sourceYear: 2024,
      provenance: "legacy-migrated",
    });
    const stale = resolveClubContinentalEntry({
      world: getWorldState(),
      clubId: arsenal.clubId,
      league,
      targetYear: 2026,
      allowBootstrap: false,
    });
    commitCompletedDomesticEdition({
      world: getWorldState(),
      league,
      table,
      sourceYear: 2025,
      provenance: "legacy-migrated",
    });
    const ok = resolveClubContinentalEntry({
      world: getWorldState(),
      clubId: arsenal.clubId,
      league,
      targetYear: 2026,
      allowBootstrap: false,
    });
    result = {
      staleStatus: stale.status,
      okStatus: ok.status,
      okCompetition: ok.competition || null,
      sourceYearFor2026: sourceYearForContinentalTarget(2026),
    };
  } else if (input.id === "F10") {
    const badPositions = [null, undefined, "", NaN, Infinity, -Infinity, 0, -1, 0.5, "1.5", "abc", 99];
    const rejected = badPositions.map((p) => ({
      value: String(p),
      normalizeOk: normalizeFinishPosition(p, { tableSize: 20 }).ok === true,
      competition: continentalCompetitionForStanding({ position: p }, league),
    }));
    const conflicting = competitionForValidatedFinish(
      { position: 17, qualification: "Champions League" },
      league,
      { tableSize: 20 }
    );
    const legacyNumeric = continentalCompetitionForStanding({ position: "3" }, league);
    result = { rejected, conflicting, legacyNumeric };
  } else if (input.id === "F15") {
    const table = orderedTable(input.placements);
    commitCompletedDomesticEdition({
      world: getWorldState(),
      league,
      table,
      sourceYear: 2025,
      provenance: "legacy-migrated",
    });
    const player = makePlayer(arsenal);
    const standing = preSeasonContinentalStanding(player, league, { world: getWorldState(), seasonYear: 2026 });
    const original = prepareContinentalEdition({
      standing,
      league,
      player,
      seasonYear: 2026,
      world: getWorldState(),
    });
    const played = [];
    for (const md of original.openingMatchdays || []) {
      const day = listContinentalFixtures(original).find((f) => f.matchday === md)?.date;
      if (day && day <= "2027-01-10") {
        processContinentalMatchday(original, md, { world: getWorldState(), player });
        played.push(md);
      }
    }
    const fieldBefore = original.field.map((c) => c.clubId).sort();
    const fixtureIdsBefore = Object.keys(original.fixtures).sort();
    recordPlayingTransition(player, {
      kind: "permanent",
      effectiveDate: "2027-01-10",
      playingClubId: brentford.clubId,
      employmentClubId: brentford.clubId,
      leagueId: league.leagueId,
      clubName: brentford.name,
    });
    player.club = { ...brentford, league: league.name, leagueId: league.leagueId, nation: league.nation };
    player.playingClubId = brentford.clubId;
    player.employmentClubId = brentford.clubId;
    const afterMove = listContinentalFixtures(original, {
      status: "scheduled",
      playerOnly: true,
      player,
    }).filter((f) => f.stageType === "league" && f.date > "2027-01-10").length;
    const refocus = prepareContinentalEdition({ league, player, seasonYear: 2026, world: getWorldState() });
    result = {
      playedMatchdays: played,
      fieldEqual: JSON.stringify(refocus.field.map((c) => c.clubId).sort()) === JSON.stringify(fieldBefore),
      fixturesEqual: JSON.stringify(Object.keys(refocus.fixtures).sort()) === JSON.stringify(fixtureIdsBefore),
      editionFocusClubId: refocus.editionFocusClubId,
      viewFocusClubId: refocus.viewFocusClubId,
      lateEligibleAfterMove: afterMove,
    };
  } else {
    throw new Error("unknown control " + input.id);
  }

  writeFileSync(
    outPath,
    JSON.stringify(
      {
        side,
        sourceSha: args.sha,
        rngAfterRestore,
        rngAfterRun: captureRng(getSimRng),
        clubFinanceKeys: Object.keys(exportClubFinanceState()?.ledgers || {}).sort(),
        result,
      },
      null,
      2
    )
  );
}

async function runBase() {
  // Accepted base lacks earnedQualification.js — use latestStanding + preSeasonContinentalStanding.
  const { LEAGUES } = await mod("js/data/leagues.js");
  const { createWorldState, setWorldState } = await mod("js/simulation/worldState.js");
  const { resetClubFinanceLedgers } = await mod("js/simulation/clubFinance.js");
  const { createRng, reseedCareerRng, getSimRng } = await mod("js/simulation/rng.js");
  const { preSeasonContinentalStanding } = await mod("js/simulation/chronologicalSeason.js");
  const { prepareContinentalEdition, listContinentalFixtures, processContinentalMatchday } = await mod(
    "js/simulation/continentalTournament.js"
  );
  const { qualificationForPosition, findSisterLeagues } = await mod("js/simulation/leaguePhase.js");
  const { continentalCompetitionForStanding } = await mod("js/data/competitions/qualification.js");

  const league = LEAGUES.find((l) => l.leagueId === input.leagueId);
  const arsenal = league.clubs.find((c) => c.clubId === input.arsenalId);
  const brentford = league.clubs.find((c) => c.clubId === input.brentfordId);

  function orderedTable(placements = {}) {
    const sisters = findSisterLeagues(league, LEAGUES);
    const placed = new Map(Object.entries(placements));
    const remaining = league.clubs.filter((c) => ![...placed.values()].includes(c.clubId));
    const slots = Array.from({ length: league.clubs.length }, () => null);
    for (const [posStr, clubId] of placed) slots[Number(posStr) - 1] = league.clubs.find((c) => c.clubId === clubId);
    let r = 0;
    for (let i = 0; i < slots.length; i++) if (!slots[i]) slots[i] = remaining[r++];
    return slots.map((c, i) => {
      const position = i + 1;
      return {
        ...c,
        position,
        points: Math.max(0, 100 - i * 3),
        matches: 38,
        played: 38,
        wins: 20,
        draws: 8,
        losses: 10,
        goalsFor: 50 - i,
        goalsAgainst: 20 + i,
        goalDiff: 30 - 2 * i,
        qualification: qualificationForPosition(position, league, sisters) || "",
      };
    });
  }

  function makePlayer(club, extra = {}) {
    return {
      name: "Paired09",
      careerId: "paired09",
      position: "CM",
      nationality: "England",
      age: 24,
      startYear: 2026,
      rating: extra.rating ?? 90,
      overall: extra.rating ?? 90,
      club: { ...club, league: league.name, leagueId: league.leagueId, nation: league.nation, overall: extra.rating ?? club.overall },
      playingClubId: club.clubId,
      employmentClubId: club.clubId,
      seasons: [],
      ...extra,
    };
  }

  resetClubFinanceLedgers();
  reseedCareerRng(input.seed);
  setWorldState(createWorldState({ startYear: 2026, rngSeed: input.seed }));
  const rngAfterRestore = captureRng(getSimRng);

  let result;
  if (input.id === "F01") {
    const table = orderedTable(input.placements);
    // Base adapter: attach Arsenal finish onto Brentford career via latestStanding (pre-Fix-09 path).
    const player = makePlayer(brentford, {
      latestStanding: {
        leagueId: league.leagueId,
        seasonId: league.leagueId + "::2025",
        table,
        playerRow: table.find((r) => r.clubId === arsenal.clubId),
      },
    });
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
      adapter: "base-latestStanding-inherit",
    };
  } else if (input.id === "F02") {
    const table = orderedTable(input.placements);
    const player = makePlayer(arsenal, {
      latestStanding: {
        leagueId: league.leagueId,
        seasonId: league.leagueId + "::2025",
        table,
        playerRow: table.find((r) => r.clubId === arsenal.clubId),
      },
    });
    const standing = preSeasonContinentalStanding(player, league);
    result = {
      status: standing ? "qualified" : "not-qualified",
      competition: standing ? continentalCompetitionForStanding(standing, league) : null,
      position: standing?.position ?? null,
      adapter: "base-latestStanding",
    };
  } else if (input.id === "F03") {
    const table = orderedTable(input.placements);
    const player = makePlayer(brentford, {
      rating: input.hotOvr,
      latestStanding: {
        leagueId: league.leagueId,
        seasonId: league.leagueId + "::2025",
        table,
        playerRow: table.find((r) => r.clubId === brentford.clubId),
      },
    });
    // Base may still OVR-seed when standing is weak; capture whatever preSeason returns.
    const standing = preSeasonContinentalStanding(player, league);
    result = {
      status: standing ? "qualified" : "not-qualified",
      competition: standing ? continentalCompetitionForStanding(standing, league) : null,
      ovr: input.hotOvr,
      adapter: "base-latestStanding-or-ovr",
    };
  } else if (input.id === "F05") {
    // Base has no edition registry — stale/future incomplete mapping is not enforced.
    const table = orderedTable(input.placements);
    const player = makePlayer(arsenal, {
      latestStanding: {
        leagueId: league.leagueId,
        seasonId: league.leagueId + "::2024",
        table,
        playerRow: table[0],
      },
    });
    const staleStanding = preSeasonContinentalStanding(player, league);
    player.latestStanding.seasonId = league.leagueId + "::2025";
    const okStanding = preSeasonContinentalStanding(player, league);
    result = {
      staleStatus: staleStanding ? "qualified" : "unresolved",
      okStatus: okStanding ? "qualified" : "unresolved",
      okCompetition: okStanding ? continentalCompetitionForStanding(okStanding, league) : null,
      sourceYearFor2026: 2025,
      adapter: "base-no-edition-registry",
    };
  } else if (input.id === "F10") {
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
  } else if (input.id === "F15") {
    const table = orderedTable(input.placements);
    const player = makePlayer(arsenal, {
      latestStanding: {
        leagueId: league.leagueId,
        seasonId: league.leagueId + "::2025",
        table,
        playerRow: table.find((r) => r.clubId === arsenal.clubId),
      },
    });
    const standing = preSeasonContinentalStanding(player, league);
    const original = prepareContinentalEdition({ standing, league, player, seasonYear: 2026 });
    const played = [];
    for (const md of original.openingMatchdays || []) {
      const day = listContinentalFixtures(original).find((f) => f.matchday === md)?.date;
      if (day && day <= "2027-01-10") {
        processContinentalMatchday(original, md, { player });
        played.push(md);
      }
    }
    const fieldBefore = original.field.map((c) => c.clubId).sort();
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
            playerRow: table.find((r) => r.clubId === brentford.clubId),
          },
        },
        league
      ),
      league,
      player,
      seasonYear: 2026,
    });
    result = {
      playedMatchdays: played,
      fieldEqual: JSON.stringify((refocus?.field || []).map((c) => c.clubId).sort()) === JSON.stringify(fieldBefore),
      fixturesEqual: false,
      editionFocusClubId: refocus?.editionFocusClubId || refocus?.playerClubId || null,
      viewFocusClubId: refocus?.viewFocusClubId || null,
      lateEligibleAfterMove: afterMove,
      adapter: "base-soft-refocus",
    };
  } else {
    throw new Error("unknown control " + input.id);
  }

  writeFileSync(
    outPath,
    JSON.stringify(
      {
        side,
        sourceSha: args.sha,
        rngAfterRestore,
        rngAfterRun: captureRng(getSimRng),
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
