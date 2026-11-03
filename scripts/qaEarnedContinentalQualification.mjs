#!/usr/bin/env node
/**
 * Fix 09 QA exporter — focused matrix + 14×3 actual-engine cohort + independent oracle.
 *
 *   node scripts/qaEarnedContinentalQualification.mjs
 *   FIX09_OUT=qa/fix09-runs/final node scripts/qaEarnedContinentalQualification.mjs
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { LEAGUES, LEAGUE_LOOKUP } from "../js/data/leagues.js";
import {
  createWorldState,
  setWorldState,
  serializeWorldState,
} from "../js/simulation/worldState.js";
import { serializeCareerSnapshot } from "../js/simulation/careerSnapshot.js";
import { reseedCareerRng, getSimRng } from "../js/simulation/rng.js";
import { createPlayerIdentity } from "../js/simulation/playerDevelopment.js";
import { ensurePlayerModel } from "../js/simulation/playerModelMigration.js";
import { refreshAbilityCaches } from "../js/simulation/playerAbility.js";
import { ensureContractAuthority } from "../js/simulation/contractLifecycle.js";
import { ensureTransferSave } from "../js/simulation/transferMigration.js";
import { resetClubFinanceLedgers, exportClubFinanceState } from "../js/simulation/clubFinance.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import {
  getClubTargetDecision,
  getDomesticEditionRecord,
  sourceYearForContinentalTarget,
  validateStandingTable,
  expectedDomesticPlayCoverage,
} from "../js/simulation/earnedQualification.js";
import { continentalCompetitionForStanding } from "../js/data/competitions/qualification.js";
import { formatForCompetitionName } from "../js/data/competitions/formats.js";
import { competitionIdSlug } from "../js/simulation/continentalSchedule.js";

function competitionIdForName(competition) {
  if (!competition) return null;
  return formatForCompetitionName(competition)?.competitionId || competitionIdSlug(competition);
}

/** Parse leading YYYY from edition ids like 2026-uefa-champions-league. */
export function campaignEditionYear(editionId) {
  const m = String(editionId || "").match(/^(\d{4})-/);
  return m ? Number(m[1]) : null;
}

const __filename = fileURLToPath(import.meta.url);
const root = join(dirname(__filename), "..");
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

export function oracleCompetition(nation, leagueId, position) {
  if (!Number.isInteger(position) || position < 1) return null;
  const uefa = {
    "league:england-premier-league": { cl: 4, el: 1, uecl: 1 },
    "league:france-ligue-1": { cl: 3, el: 1, uecl: 1 },
    "league:serbia-superliga": { cl: 1, el: 1, uecl: 1 },
  };
  if (uefa[leagueId]) {
    const s = uefa[leagueId];
    if (position <= s.cl) return "Champions League";
    if (position <= s.cl + s.el) return "Europa League";
    if (position <= s.cl + s.el + s.uecl) return "Conference League";
    return null;
  }
  if (["Brazil", "Argentina", "Colombia", "Ecuador"].includes(nation)) {
    if (position <= 4) return "Copa Libertadores";
    if (position <= 8) return "Copa Sudamericana";
    return null;
  }
  if (["Mexico", "United States"].includes(nation)) {
    return position <= 4 ? "CONCACAF Champions Cup" : null;
  }
  if (["Saudi Arabia", "Japan", "South Korea"].includes(nation)) {
    return position <= 3 ? "AFC Champions League Elite" : null;
  }
  if (["Egypt", "Morocco"].includes(nation)) {
    return position <= 2 ? "CAF Champions League" : null;
  }
  return null;
}

/** True when a score is a present, finite, nonnegative integer (null/undefined rejected). */
export function isValidMatchScore(value) {
  return Number.isInteger(value) && value >= 0;
}

/**
 * Rebuild standings from edition-scoped source results (independent of production table).
 * Returns { ok, table } or { ok:false, reason }.
 */
export function rebuildStandingsFromSourceResults(sourceResults, league) {
  if (!Array.isArray(sourceResults) || !sourceResults.length || !league) {
    return { ok: false, reason: "missing-source-results", table: null };
  }
  const rows = new Map();
  for (const club of league.clubs || []) {
    if (!club?.clubId) continue;
    rows.set(club.clubId, {
      clubId: club.clubId,
      name: club.name,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      points: 0,
    });
  }
  const seen = new Set();
  for (const m of sourceResults) {
    const id = m.matchId || m.fixtureId;
    if (!id) return { ok: false, reason: "source-result-missing-id", table: null };
    if (seen.has(id)) return { ok: false, reason: "source-result-duplicate-id", matchId: id, table: null };
    seen.add(id);
    const homeId = m.homeClubId;
    const awayId = m.awayClubId;
    if (!homeId || !awayId) {
      return { ok: false, reason: "source-result-missing-clubs", matchId: id, table: null };
    }
    if (!rows.has(homeId) || !rows.has(awayId)) {
      return {
        ok: false,
        reason: "source-result-foreign-club",
        matchId: id,
        homeClubId: homeId,
        awayClubId: awayId,
        table: null,
      };
    }
    // Reject missing scores before numeric conversion — Number(null) === 0 is not a played score.
    if (!isValidMatchScore(m.homeGoals) || !isValidMatchScore(m.awayGoals)) {
      return {
        ok: false,
        reason: "source-result-missing-or-invalid-score",
        matchId: id,
        homeGoals: m.homeGoals,
        awayGoals: m.awayGoals,
        table: null,
      };
    }
    const hg = m.homeGoals;
    const ag = m.awayGoals;
    const home = rows.get(homeId);
    const away = rows.get(awayId);
    home.played += 1;
    away.played += 1;
    home.goalsFor += hg;
    home.goalsAgainst += ag;
    away.goalsFor += ag;
    away.goalsAgainst += hg;
    if (hg > ag) {
      home.wins += 1;
      home.points += 3;
      away.losses += 1;
    } else if (hg < ag) {
      away.wins += 1;
      away.points += 3;
      home.losses += 1;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.points += 1;
      away.points += 1;
    }
  }
  const table = [...rows.values()]
    .map((r) => ({ ...r, goalDiff: r.goalsFor - r.goalsAgainst }))
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.goalDiff - a.goalDiff ||
        b.goalsFor - a.goalsFor ||
        String(a.clubId).localeCompare(String(b.clubId))
    )
    .map((r, i) => ({ ...r, position: i + 1 }));
  return { ok: true, table, resultCount: seen.size };
}

/**
 * Independent earned-entry oracle. Missing/wrong identity or source evidence fails.
 * Production stored positions are observed — expected ranks come from rebuilt source results.
 */
export function validateEarnedPeriodOracle({
  league,
  clubId,
  sourceYear,
  targetYear,
  decision = null,
  edition = null,
  participants = null,
  standingTable = null,
  europeCompetition = null,
  europeEditionId = null,
  europeCompetitionId = null,
  europeSeasonYear = null,
  worldEditions = null,
  worldMatches = null,
  requireParticipants = true,
  mode = "source-complete",
} = {}) {
  if (!league || !clubId || !Number.isFinite(Number(sourceYear)) || !Number.isFinite(Number(targetYear))) {
    return { ok: false, reason: "missing-identity" };
  }
  if (Number(targetYear) !== Number(sourceYear) + 1) {
    return { ok: false, reason: "wrong-source-target-pair" };
  }
  if (!edition) return { ok: false, reason: "missing-edition" };
  if (!edition?.completed && edition?.status !== "bootstrap") {
    return { ok: false, reason: "source-edition-incomplete" };
  }
  if (Number(edition.sourceEditionYear) !== Number(sourceYear)) {
    return {
      ok: false,
      reason: "edition-source-year-mismatch",
      expected: sourceYear,
      observed: edition.sourceEditionYear,
    };
  }
  const editionLeagueId = edition.leagueId || edition.sourceCompetitionId;
  if (editionLeagueId && editionLeagueId !== (league.leagueId || null)) {
    return {
      ok: false,
      reason: "edition-league-mismatch",
      expected: league.leagueId,
      observed: editionLeagueId,
    };
  }
  if (!decision) return { ok: false, reason: "missing-decision" };
  if (decision.clubId && decision.clubId !== clubId) {
    return { ok: false, reason: "decision-club-mismatch", expected: clubId, observed: decision.clubId };
  }
  if (
    decision.sourceEditionYear != null &&
    Number(decision.sourceEditionYear) !== Number(sourceYear)
  ) {
    return {
      ok: false,
      reason: "decision-source-year-mismatch",
      expected: sourceYear,
      observed: decision.sourceEditionYear,
    };
  }
  if (
    decision.targetContinentalYear != null &&
    Number(decision.targetContinentalYear) !== Number(targetYear)
  ) {
    return {
      ok: false,
      reason: "decision-target-year-mismatch",
      expected: targetYear,
      observed: decision.targetContinentalYear,
    };
  }

  let sourceResults = Array.isArray(edition.sourceResults) ? [...edition.sourceResults] : [];
  const matchIds = Array.isArray(edition.matchEvidenceIds) ? edition.matchEvidenceIds : [];
  const matchMap =
    worldMatches == null
      ? null
      : worldMatches instanceof Map
        ? worldMatches
        : new Map(worldMatches);

  // Played simulated editions must carry complete edition-scoped raw results.
  // Never fall back to production table positions as the expected ranks for the engine cohort.
  if (edition.provenance === "simulated-complete") {
    if (!sourceResults.length && !matchIds.length) {
      return { ok: false, reason: "missing-source-results" };
    }
    if (matchIds.length && matchMap) {
      for (const id of matchIds) {
        const m = matchMap.get(id);
        if (!m) return { ok: false, reason: "cited-match-missing", matchId: id };
        if (String(m.editionId) !== String(sourceYear)) {
          return {
            ok: false,
            reason: "cited-match-wrong-edition",
            matchId: id,
            expected: String(sourceYear),
            observed: m.editionId,
          };
        }
        if (m.competitionId && m.competitionId !== league.leagueId) {
          return {
            ok: false,
            reason: "cited-match-wrong-competition",
            matchId: id,
            expected: league.leagueId,
            observed: m.competitionId,
          };
        }
      }
      // Reconstruct slim results from the world store when the edition omitted them.
      if (!sourceResults.length) {
        sourceResults = matchIds.map((id) => {
          const m = matchMap.get(id);
          return {
            matchId: id,
            fixtureId: m.fixtureId || id,
            competitionId: m.competitionId || null,
            editionId: m.editionId != null ? String(m.editionId) : null,
            homeClubId: m.home?.clubId || m.homeClubId || null,
            awayClubId: m.away?.clubId || m.awayClubId || null,
            homeGoals: m.homeGoals ?? m.matchHomeGoals ?? null,
            awayGoals: m.awayGoals ?? m.matchAwayGoals ?? null,
          };
        });
      }
    }
    if (!sourceResults.length) {
      return { ok: false, reason: "missing-source-results" };
    }
    // Nonempty is not enough — require full schedule coverage from the league format.
    const coverage = expectedDomesticPlayCoverage(league);
    if (coverage.fixtures > 0 && sourceResults.length !== coverage.fixtures) {
      return {
        ok: false,
        reason: "incomplete-source-results",
        expected: coverage.fixtures,
        observed: sourceResults.length,
        coverageSource: coverage.source,
      };
    }
    if (matchIds.length && coverage.fixtures > 0 && matchIds.length !== coverage.fixtures) {
      return {
        ok: false,
        reason: "incomplete-match-evidence-ids",
        expected: coverage.fixtures,
        observed: matchIds.length,
      };
    }
  }

  // Immutable sourceResults must themselves belong to the claimed source edition.
  for (const m of sourceResults) {
    if (m.editionId != null && String(m.editionId) !== String(sourceYear)) {
      return {
        ok: false,
        reason: "source-result-wrong-edition",
        expected: String(sourceYear),
        observed: m.editionId,
        matchId: m.matchId || m.fixtureId,
      };
    }
    if (m.competitionId && m.competitionId !== league.leagueId) {
      return {
        ok: false,
        reason: "source-result-wrong-competition",
        expected: league.leagueId,
        observed: m.competitionId,
      };
    }
  }

  let expectedPosition = null;
  let rebuiltCompetition = null;
  if (sourceResults.length || edition.provenance === "simulated-complete") {
    const rebuilt = rebuildStandingsFromSourceResults(sourceResults, league);
    if (!rebuilt.ok || !rebuilt.table?.length) {
      return { ok: false, reason: rebuilt.reason || "rebuild-failed" };
    }
    if (edition.provenance === "simulated-complete") {
      const coverage = expectedDomesticPlayCoverage(league);
      if (coverage.perClub > 0) {
        const uneven = rebuilt.table.find((r) => Number(r.played) !== coverage.perClub);
        if (uneven) {
          return {
            ok: false,
            reason: "incomplete-club-coverage",
            clubId: uneven.clubId,
            expected: coverage.perClub,
            observed: uneven.played,
          };
        }
      }
    }
    const rebuiltRow = rebuilt.table.find((r) => r.clubId === clubId);
    if (!rebuiltRow) return { ok: false, reason: "club-absent-from-rebuilt-table" };
    expectedPosition = rebuiltRow.position;
    rebuiltCompetition =
      continentalCompetitionForStanding({ position: expectedPosition }, league) ||
      oracleCompetition(league.nation, league.leagueId, expectedPosition);
  } else {
    const table = standingTable || edition?.table || null;
    if (!table?.length) return { ok: false, reason: "missing-source-table" };
    const validation = validateStandingTable(table, league, {
      requireComplete: true,
      status: edition?.status || "complete",
      completed: true,
      sourceYear,
      requirePlayedEvidence: edition.provenance !== "bootstrap-synthetic",
      matchEvidenceIds: matchIds,
      provenance: edition.provenance,
    });
    if (!validation.ok) return { ok: false, reason: `invalid-table:${validation.reason}` };
    const row = table.find((r) => r.clubId === clubId);
    if (!row) return { ok: false, reason: "club-absent-from-source-table" };
    expectedPosition = row.position;
    rebuiltCompetition =
      continentalCompetitionForStanding({ position: row.position, qualification: row.qualification }, league) ||
      oracleCompetition(league.nation, league.leagueId, row.position);
  }

  if (Number(decision.position) !== Number(expectedPosition)) {
    return {
      ok: false,
      reason: "decision-rank-mismatch",
      expected: expectedPosition,
      observed: decision.position,
    };
  }
  if ((decision.competition || null) !== (rebuiltCompetition || null)) {
    return {
      ok: false,
      reason: "decision-competition-mismatch",
      expected: rebuiltCompetition,
      observed: decision.competition,
    };
  }
  const slotExpected = oracleCompetition(league.nation, league.leagueId, expectedPosition);
  if (slotExpected !== (decision.competition || null)) {
    return {
      ok: false,
      reason: "slot-oracle-mismatch",
      expected: slotExpected,
      observed: decision.competition,
    };
  }

  // mode=source-complete: validate the finished domestic source → next-year decision.
  // Target participation is checked separately when that continental edition exists.
  if (mode === "target-participation") {
    const participantList = Array.isArray(participants) ? participants : null;
    const isDnq = decision.status === "not-qualified" || !decision.competition;
    if (isDnq) {
      const wronglyPresent =
        participantList &&
        participantList.some((p) => {
          const id = p.clubId || p;
          if (id !== clubId) return false;
          // Club ID in an earned target field (with competition) contradicts DNQ.
          return Boolean(p.competition) || europeCompetition;
        });
      if (wronglyPresent) {
        return { ok: false, reason: "dnq-in-target-field", clubId, europeCompetition };
      }
    } else if (decision.status === "qualified" || decision.competition) {
      if (europeCompetition && europeCompetition !== decision.competition) {
        return {
          ok: false,
          reason: "target-competition-mismatch",
          expected: decision.competition,
          observed: europeCompetition,
        };
      }
      const expectedCompId =
        decision.targetCompetitionId || competitionIdForName(decision.competition);
      if (
        europeCompetitionId &&
        expectedCompId &&
        String(europeCompetitionId) !== String(expectedCompId)
      ) {
        return {
          ok: false,
          reason: "target-competition-id-mismatch",
          expected: expectedCompId,
          observed: europeCompetitionId,
        };
      }
      // Bind the actual campaign edition identity to the source→target year pair.
      const editionYearFromId = campaignEditionYear(europeEditionId);
      if (europeEditionId != null && europeEditionId !== "") {
        if (editionYearFromId == null) {
          return { ok: false, reason: "campaign-edition-unparseable", europeEditionId };
        }
        if (Number(editionYearFromId) !== Number(targetYear)) {
          return {
            ok: false,
            reason: "wrong-campaign-edition-year",
            expected: targetYear,
            observed: editionYearFromId,
            europeEditionId,
          };
        }
      }
      if (europeSeasonYear != null && Number(europeSeasonYear) !== Number(targetYear)) {
        return {
          ok: false,
          reason: "wrong-campaign-season-year",
          expected: targetYear,
          observed: europeSeasonYear,
        };
      }
      // Canonical world edition must exist for the claimed campaign identity.
      if (europeEditionId && worldEditions != null) {
        const editionMap =
          worldEditions instanceof Map ? worldEditions : new Map(worldEditions);
        let found = null;
        for (const [, ed] of editionMap) {
          if (ed && String(ed.editionId) === String(europeEditionId)) {
            found = ed;
            break;
          }
        }
        if (!found) {
          return {
            ok: false,
            reason: "campaign-edition-missing-from-world",
            europeEditionId,
          };
        }
        if (
          found.competitionId &&
          expectedCompId &&
          String(found.competitionId) !== String(expectedCompId)
        ) {
          return {
            ok: false,
            reason: "world-edition-competition-mismatch",
            expected: expectedCompId,
            observed: found.competitionId,
          };
        }
        if (
          found.seasonYear != null &&
          Number(found.seasonYear) !== Number(targetYear)
        ) {
          return {
            ok: false,
            reason: "world-edition-year-mismatch",
            expected: targetYear,
            observed: found.seasonYear,
          };
        }
        // Competition-store schema: participants + lifecycle.field. Also accept
        // legacy top-level field/clubs when present. Do not silently skip when
        // worldEditions was supplied but the stored edition has no member lists.
        const canonicalSets = [
          ["participants", found.participants],
          ["lifecycle.field", found.lifecycle?.field],
          ["field", found.field],
          ["clubs", found.clubs],
        ].filter(([, list]) => Array.isArray(list) && list.length > 0);
        if (!canonicalSets.length) {
          return {
            ok: false,
            reason: "missing-canonical-participants",
            europeEditionId,
          };
        }
        for (const [label, list] of canonicalSets) {
          const inSet = list.some((p) => (p?.clubId || p) === clubId);
          if (!inSet) {
            return {
              ok: false,
              reason: "participant-missing-from-world-edition",
              clubId,
              source: label,
            };
          }
        }
      }
      // Real continental fields are club objects/IDs; competition lives on the campaign.
      // Only treat an annotated participant.competition as a hard mismatch when present.
      const matching = (participantList || []).filter((p) => (p.clubId || p) === clubId);
      const annotatedConflict = matching.some(
        (p) => p && typeof p === "object" && p.competition && p.competition !== decision.competition
      );
      if (annotatedConflict) {
        return {
          ok: false,
          reason: "target-competition-mismatch",
          expected: decision.competition,
          observed: matching.find((p) => p?.competition)?.competition,
        };
      }
      const inParticipants = matching.length > 0;
      if (requireParticipants && !inParticipants) {
        return { ok: false, reason: "participant-missing-for-qualifier" };
      }
      // Display-name-only europeCompetition is never sufficient alone.
      if (!inParticipants && europeCompetition && europeCompetition === decision.competition) {
        return { ok: false, reason: "display-name-only-campaign-rejected" };
      }
    }
  } else if (Array.isArray(participants) && participants.length) {
    const wronglyPresent = participants.some(
      (p) => (p.clubId || p) === clubId && p.competition && p.competition !== decision.competition
    );
    if (wronglyPresent) return { ok: false, reason: "participant-contradiction-dnq" };
  }

  return {
    ok: true,
    rebuiltCompetition,
    sourcePosition: expectedPosition,
    sourceYear,
    targetYear,
    mode,
  };
}

function runFocused(outDir) {
  const r = spawnSync("node", ["--test", "tests/earnedContinentalQualification.test.mjs"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  writeFileSync(join(outDir, "focused-f01-f25.log"), `${r.stdout}\n${r.stderr}`);
  return { exitCode: r.status ?? 1, stdout: r.stdout };
}

const COHORT = [
  { seed: 9101, nation: "England", position: "CM" },
  { seed: 9102, nation: "England", position: "GK" },
  { seed: 9103, nation: "France", position: "CM" },
  { seed: 9104, nation: "France", position: "GK" },
  { seed: 9105, nation: "Serbia", position: "CM" },
  { seed: 9106, nation: "Serbia", position: "GK" },
  { seed: 9107, nation: "Brazil", position: "CM" },
  { seed: 9108, nation: "Brazil", position: "GK" },
  { seed: 9109, nation: "Mexico", position: "CM" },
  { seed: 9110, nation: "Mexico", position: "GK" },
  { seed: 9111, nation: "Saudi Arabia", position: "CM" },
  { seed: 9112, nation: "Saudi Arabia", position: "GK" },
  { seed: 9113, nation: "Egypt", position: "CM" },
  { seed: 9114, nation: "Egypt", position: "GK" },
];

function makeCareer(seed, nation, position) {
  reseedCareerRng(seed);
  resetClubFinanceLedgers();
  const world = createWorldState({ seed, careerSeed: seed, startYear: 2026 });
  setWorldState(world);
  const league = LEAGUES.find((l) => l.nation === nation && (l.divisionLevel ?? 1) === 1);
  if (!league) return null;
  const club = [...league.clubs].sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))[0];
  const player = createPlayerIdentity({
    name: `Fix09 Cohort ${seed}`,
    nationality: nation === "United States" ? "United States" : nation,
    position,
    age: 22,
  });
  const ovr = Math.round(club.overall || 72);
  const attrs = Object.fromEntries(
    ["Speed", "Passing", "Shooting", "Defending", "Physicality", "Dribbling"].map((k) => [k, ovr])
  );
  Object.assign(player, {
    careerId: `fix09-cohort-${seed}`,
    startYear: 2026,
    rating: ovr,
    attributes: attrs,
    potentialForecast: { upper: ovr + 8 },
    state: { form: 0, morale: 0, readiness: 1, fatigue: 0, adaptationPenalty: 0, roleFit: 1 },
    club: {
      ...club,
      league: league.name,
      leagueDisplay: league.displayName,
      leagueId: league.leagueId,
      nation: league.nation,
    },
    employmentClubId: club.clubId,
    playingClubId: club.clubId,
    contractStatus: "active",
    contractStartSeason: 0,
    contractYears: 5,
    contractEndSeason: 5,
    weeklyWage: 3000,
    seasons: [],
  });
  ensurePlayerModel(player);
  refreshAbilityCaches(player);
  ensureContractAuthority(player);
  ensureTransferSave(player);
  return { player, league, world, club };
}

function runCohort(outDir) {
  const rows = [];
  let oracleViolations = 0;
  let completedPeriods = 0;
  mkdirSync(join(outDir, "cohort"), { recursive: true });
  mkdirSync(join(outDir, "cohort-snapshots"), { recursive: true });

  for (const spec of COHORT) {
    const built = makeCareer(spec.seed, spec.nation, spec.position);
    if (!built) {
      rows.push({ ...spec, ok: false, reason: "league-missing" });
      oracleViolations += 1;
      continue;
    }
    const { player, league, world, club } = built;
    const initialCareer = serializeCareerSnapshot({ player, world });
    const initialSnap = {
      rngSeed: world.rngSeed,
      rngState: getSimRng().seed(),
      playerClubId: club.clubId,
      leagueId: league.leagueId,
      player: initialCareer.player,
      world: initialCareer.world,
      clubFinance: exportClubFinanceState(),
    };
    writeFileSync(
      join(outDir, "cohort-snapshots", `fixture-${spec.seed}-initial.json`),
      JSON.stringify(initialSnap)
    );
    const periods = [];
    let fixtureOk = true;
    for (let i = 0; i < 3; i++) {
      const beforeSeed = getSimRng().seed();
      const seasonsBefore = player.seasons.length;
      let data = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
        pauseForDecisions: false,
        autoDecisionPolicy: "stay",
      });
      let guards = 0;
      while (data?.awaitingScenario && guards < 8) {
        guards += 1;
        player.pendingSeniorScenario = null;
        if (data.checkpoint) data.checkpoint.pendingSeniorScenario = null;
        data = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
          pauseForDecisions: false,
          autoDecisionPolicy: "stay",
        });
      }
      if (player.seasons.length !== seasonsBefore + 1) {
        oracleViolations += 1;
        fixtureOk = false;
        periods.push({
          periodIndex: i,
          ok: false,
          reason: "period-not-completed",
          seasonsBefore,
          seasonsAfter: player.seasons.length,
        });
        continue;
      }
      const season = player.seasons[player.seasons.length - 1];
      const sourceYear = (player.startYear || 2026) + Math.max(0, player.seasons.length - 1);
      const targetYear = sourceYear + 1;
      const clubId = player.playingClubId || club.clubId;
      const periodLeague =
        LEAGUES.find((l) => l.leagueId === (season?.leagueId || league.leagueId)) || league;
      const edition = getDomesticEditionRecord(world, periodLeague.leagueId, sourceYear);
      const decisionWrap = getClubTargetDecision(world, clubId, targetYear);
      const decision = decisionWrap?.entry || null;
      const europe = season?.europeanCampaign || null;
      const participants = europe?.field || europe?.participants || europe?.lifecycle?.field || [];
      // Validate just-completed source → next-year decision from edition-scoped results.
      const oracle = validateEarnedPeriodOracle({
        league: periodLeague,
        clubId,
        sourceYear,
        targetYear,
        decision,
        edition,
        participants: null,
        standingTable: edition?.table || season?.standing?.table || null,
        worldMatches: world.matches,
        mode: "source-complete",
      });
      // Separately: current campaign entry must match the PRIOR source year decision.
      const priorSourceYear = sourceYear - 1;
      const priorDecision = getClubTargetDecision(world, clubId, sourceYear)?.entry || null;
      const priorEdition = getDomesticEditionRecord(world, periodLeague.leagueId, priorSourceYear);
      let campaignOracle = { ok: true, reason: "no-prior-source" };
      if (priorEdition?.completed || priorEdition?.status === "bootstrap") {
        campaignOracle = validateEarnedPeriodOracle({
          league: periodLeague,
          clubId,
          sourceYear: priorSourceYear,
          targetYear: sourceYear,
          decision: priorDecision,
          edition: priorEdition,
          participants: Array.isArray(participants) ? participants : [],
          europeCompetition: europe?.competition || null,
          europeEditionId: europe?.editionId || null,
          europeCompetitionId: europe?.competitionId || null,
          europeSeasonYear: europe?.seasonYear ?? europe?.year ?? null,
          worldEditions: world.editions,
          worldMatches: world.matches,
          mode: "target-participation",
          requireParticipants: Boolean(priorDecision?.competition),
        });
        // DNQ prior decision: campaign must not be a qualified earned entry for a contradictory competition.
        // Never overwrite a concrete oracle failure (e.g. DNQ present in the target field).
        if (priorDecision && !priorDecision.competition) {
          if (europe?.qualified && europe?.competition && !europe?.showcase) {
            campaignOracle = { ok: false, reason: "dnq-had-earned-campaign" };
          } else if (campaignOracle.ok) {
            campaignOracle = { ok: true, reason: "dnq-or-showcase" };
          }
        }
      }
      const periodOk = oracle.ok && campaignOracle.ok !== false;
      if (!periodOk) {
        oracleViolations += 1;
        fixtureOk = false;
      } else {
        completedPeriods += 1;
      }
      periods.push({
        periodIndex: i,
        sourceYear,
        targetYear,
        playingClubId: clubId,
        leagueId: periodLeague.leagueId,
        tableSize: edition?.table?.length || season?.standing?.table?.length || null,
        sourceRow: edition?.table?.find((r) => r.clubId === clubId) || null,
        sourceResultsCount: edition?.sourceResults?.length || 0,
        position: decision?.position ?? null,
        competition: decision?.competition ?? null,
        provenance: decision?.provenance || edition?.provenance || null,
        europeCompetition: europe?.competition || null,
        europeQualified: europe?.qualified !== false && !europe?.showcase,
        participants: (Array.isArray(participants) ? participants : []).map((p) => p.clubId || p),
        matchEvidenceIds: edition?.matchEvidenceIds?.length || 0,
        oracle,
        campaignOracle,
        oracleOk: periodOk,
        rngBefore: beforeSeed,
        rngAfter: getSimRng().seed(),
      });
    }
    const finalCareer = serializeCareerSnapshot({ player, world });
    const finalSnap = {
      rngSeed: world.rngSeed,
      rngState: getSimRng().seed(),
      playerClubId: player.playingClubId,
      seasons: player.seasons.length,
      player: finalCareer.player,
      world: finalCareer.world,
      clubFinance: exportClubFinanceState(),
    };
    writeFileSync(
      join(outDir, "cohort-snapshots", `fixture-${spec.seed}-final.json`),
      JSON.stringify(finalSnap)
    );
    const record = {
      ...spec,
      ok: fixtureOk,
      initialSnap: {
        rngSeed: initialSnap.rngSeed,
        rngState: initialSnap.rngState,
        playerClubId: initialSnap.playerClubId,
        leagueId: initialSnap.leagueId,
      },
      finalRng: getSimRng().seed(),
      periods,
      worldQualificationKeys: [...(world.qualification?.keys?.() || [])].filter((k) =>
        String(k).startsWith("domestic:")
      ).length,
    };
    rows.push(record);
    writeFileSync(join(outDir, "cohort", `fixture-${spec.seed}.json`), JSON.stringify(record, null, 2));
  }
  return { rows, oracleViolations, completedPeriods };
}

/** Build a complete double-round-robin result set for oracle coverage controls. */
export function synthesizeCompleteSourceResults(league, sourceYear) {
  const clubs = (league.clubs || []).filter((c) => c?.clubId);
  const results = [];
  let n = 0;
  for (let i = 0; i < clubs.length; i++) {
    for (let j = 0; j < clubs.length; j++) {
      if (i === j) continue;
      const home = clubs[i];
      const away = clubs[j];
      const homeWins = i < j;
      results.push({
        matchId: `${league.leagueId}::${sourceYear}:syn:${n++}`,
        editionId: String(sourceYear),
        competitionId: league.leagueId,
        homeClubId: home.clubId,
        awayClubId: away.clubId,
        homeGoals: homeWins ? 2 : 0,
        awayGoals: homeWins ? 0 : 1,
      });
    }
  }
  return results;
}

function runCorruptionControls() {
  const league = LEAGUES.find((l) => l.leagueId === "league:england-premier-league");
  const arsenal = "club:england:arsenal";
  const brentford = "club:england:brentford";
  const completeResults = synthesizeCompleteSourceResults(league, 2025);
  const rebuiltComplete = rebuildStandingsFromSourceResults(completeResults, league);
  const arsenalPos = rebuiltComplete.table.find((r) => r.clubId === arsenal)?.position;
  const goodEdition = {
    completed: true,
    status: "complete",
    provenance: "simulated-complete",
    leagueId: league.leagueId,
    sourceEditionYear: 2025,
    targetContinentalYear: 2026,
    sourceResults: completeResults,
    matchEvidenceIds: completeResults.map((m) => m.matchId),
    table: (league.clubs || []).map((c, i) => ({
      ...c,
      position: i + 1,
      points: Math.max(0, 100 - i * 3),
      matches: 38,
      played: 38,
      wins: 20,
      draws: 8,
      losses: 10,
      goalsFor: 50 - i,
      goalsAgainst: 20 + i,
    })),
  };
  const goodDecision = {
    clubId: arsenal,
    position: arsenalPos,
    competition: oracleCompetition(league.nation, league.leagueId, arsenalPos) || "Champions League",
    status: "qualified",
    sourceEditionYear: 2025,
    targetContinentalYear: 2026,
    targetCompetitionId: "uefa-champions-league",
  };
  const oneResult = [completeResults.find((m) => m.homeClubId === arsenal || m.awayClubId === arsenal)];
  const almostComplete = completeResults.slice(0, -1);
  const cases = [
    validateEarnedPeriodOracle({
      league,
      clubId: arsenal,
      sourceYear: 2025,
      targetYear: 2026,
      decision: null,
      edition: null,
      participants: [],
    }),
    validateEarnedPeriodOracle({
      league,
      clubId: arsenal,
      sourceYear: 2025,
      targetYear: 2026,
      decision: goodDecision,
      edition: { ...goodEdition, table: [], sourceResults: [], matchEvidenceIds: [] },
      participants: [],
    }),
    validateEarnedPeriodOracle({
      league,
      clubId: arsenal,
      sourceYear: 2025,
      targetYear: 2026,
      decision: { ...goodDecision, clubId: brentford, sourceEditionYear: 2020, targetContinentalYear: 2021 },
      edition: {
        ...goodEdition,
        leagueId: "league:spain-la-liga",
        sourceEditionYear: 2020,
        targetContinentalYear: 2021,
      },
    }),
    validateEarnedPeriodOracle({
      league,
      clubId: arsenal,
      sourceYear: 2025,
      targetYear: 2026,
      decision: goodDecision,
      edition: goodEdition,
      participants: [],
      europeCompetition: "Champions League",
      mode: "target-participation",
      requireParticipants: true,
    }),
    validateEarnedPeriodOracle({
      league,
      clubId: arsenal,
      sourceYear: 2025,
      targetYear: 2026,
      decision: goodDecision,
      edition: {
        ...goodEdition,
        matchEvidenceIds: ["league:england-premier-league::2025:md:0"],
        sourceResults: [],
      },
      worldMatches: new Map([
        [
          "league:england-premier-league::2025:md:0",
          {
            editionId: "2024",
            competitionId: league.leagueId,
            homeGoals: 1,
            awayGoals: 0,
            home: { clubId: arsenal },
            away: { clubId: brentford },
          },
        ],
      ]),
    }),
    validateEarnedPeriodOracle({
      league,
      clubId: arsenal,
      sourceYear: 2025,
      targetYear: 2026,
      decision: goodDecision,
      edition: { ...goodEdition, sourceResults: [], matchEvidenceIds: [] },
    }),
    validateEarnedPeriodOracle({
      league,
      clubId: arsenal,
      sourceYear: 2025,
      targetYear: 2026,
      decision: goodDecision,
      edition: {
        ...goodEdition,
        matchEvidenceIds: ["m-null"],
        sourceResults: [
          {
            matchId: "m-null",
            editionId: "2025",
            competitionId: league.leagueId,
            homeClubId: arsenal,
            awayClubId: brentford,
            homeGoals: null,
            awayGoals: 0,
          },
        ],
      },
    }),
    validateEarnedPeriodOracle({
      league,
      clubId: arsenal,
      sourceYear: 2025,
      targetYear: 2026,
      decision: goodDecision,
      edition: { ...goodEdition, provenance: "legacy-migrated" },
      participants: [{ clubId: arsenal }],
      europeCompetition: "Europa League",
      mode: "target-participation",
    }),
    validateEarnedPeriodOracle({
      league,
      clubId: brentford,
      sourceYear: 2025,
      targetYear: 2026,
      decision: {
        clubId: brentford,
        position: 17,
        competition: null,
        status: "not-qualified",
        sourceEditionYear: 2025,
        targetContinentalYear: 2026,
      },
      edition: { ...goodEdition, provenance: "legacy-migrated", sourceResults: [], matchEvidenceIds: [] },
      participants: [{ clubId: brentford, competition: "Champions League" }],
      europeCompetition: "Champions League",
      mode: "target-participation",
    }),
    // Partial coverage must fail even when the incomplete rebuild still ranks Arsenal first.
    validateEarnedPeriodOracle({
      league,
      clubId: arsenal,
      sourceYear: 2025,
      targetYear: 2026,
      decision: goodDecision,
      edition: {
        ...goodEdition,
        sourceResults: oneResult,
        matchEvidenceIds: oneResult.map((m) => m.matchId),
      },
    }),
    validateEarnedPeriodOracle({
      league,
      clubId: arsenal,
      sourceYear: 2025,
      targetYear: 2026,
      decision: goodDecision,
      edition: {
        ...goodEdition,
        sourceResults: almostComplete,
        matchEvidenceIds: almostComplete.map((m) => m.matchId),
      },
    }),
    // Wrong actual campaign edition/year must fail target-participation.
    validateEarnedPeriodOracle({
      league,
      clubId: arsenal,
      sourceYear: 2025,
      targetYear: 2026,
      decision: goodDecision,
      edition: { ...goodEdition, provenance: "legacy-migrated", sourceResults: [], matchEvidenceIds: [] },
      participants: [{ clubId: arsenal }],
      europeCompetition: "Champions League",
      europeEditionId: "1900-uefa-champions-league",
      europeCompetitionId: "uefa-champions-league",
      europeSeasonYear: 1900,
      mode: "target-participation",
      requireParticipants: true,
    }),
  ];
  // Canonical participant deletion: campaign projection still lists Arsenal, but
  // world.editions participants + lifecycle.field do not — must fail.
  const canonicalEdition = {
    editionId: "2026-uefa-champions-league",
    seasonYear: 2026,
    competitionId: "uefa-champions-league",
    participants: [{ clubId: arsenal }, { clubId: brentford }],
    lifecycle: { field: [{ clubId: arsenal }, { clubId: brentford }] },
  };
  const deletedCanonical = {
    ...canonicalEdition,
    participants: canonicalEdition.participants.filter((p) => (p.clubId || p) !== arsenal),
    lifecycle: {
      field: canonicalEdition.lifecycle.field.filter((p) => (p.clubId || p) !== arsenal),
    },
  };
  const canonicalPositive = validateEarnedPeriodOracle({
    league,
    clubId: arsenal,
    sourceYear: 2025,
    targetYear: 2026,
    decision: goodDecision,
    edition: { ...goodEdition, provenance: "legacy-migrated", sourceResults: [], matchEvidenceIds: [] },
    participants: [{ clubId: arsenal }],
    europeCompetition: "Champions League",
    europeEditionId: "2026-uefa-champions-league",
    europeCompetitionId: "uefa-champions-league",
    europeSeasonYear: 2026,
    worldEditions: new Map([["uefa-champions-league::2026-uefa-champions-league", canonicalEdition]]),
    mode: "target-participation",
    requireParticipants: true,
  });
  const canonicalDeletion = validateEarnedPeriodOracle({
    league,
    clubId: arsenal,
    sourceYear: 2025,
    targetYear: 2026,
    decision: goodDecision,
    edition: { ...goodEdition, provenance: "legacy-migrated", sourceResults: [], matchEvidenceIds: [] },
    participants: [{ clubId: arsenal }],
    europeCompetition: "Champions League",
    europeEditionId: "2026-uefa-champions-league",
    europeCompetitionId: "uefa-champions-league",
    europeSeasonYear: 2026,
    worldEditions: new Map([["uefa-champions-league::2026-uefa-champions-league", deletedCanonical]]),
    mode: "target-participation",
    requireParticipants: true,
  });
  const emptyCanonical = validateEarnedPeriodOracle({
    league,
    clubId: arsenal,
    sourceYear: 2025,
    targetYear: 2026,
    decision: goodDecision,
    edition: { ...goodEdition, provenance: "legacy-migrated", sourceResults: [], matchEvidenceIds: [] },
    participants: [{ clubId: arsenal }],
    europeCompetition: "Champions League",
    europeEditionId: "2026-uefa-champions-league",
    europeCompetitionId: "uefa-champions-league",
    europeSeasonYear: 2026,
    worldEditions: new Map([
      [
        "uefa-champions-league::2026-uefa-champions-league",
        {
          editionId: "2026-uefa-champions-league",
          seasonYear: 2026,
          competitionId: "uefa-champions-league",
        },
      ],
    ]),
    mode: "target-participation",
    requireParticipants: true,
  });
  cases.push(canonicalDeletion, emptyCanonical);
  const negativesOk = cases.every((c) => c.ok === false);
  const completeOk = validateEarnedPeriodOracle({
    league,
    clubId: arsenal,
    sourceYear: 2025,
    targetYear: 2026,
    decision: goodDecision,
    edition: goodEdition,
    mode: "source-complete",
  });
  const campaignOk = validateEarnedPeriodOracle({
    league,
    clubId: arsenal,
    sourceYear: 2025,
    targetYear: 2026,
    decision: goodDecision,
    edition: { ...goodEdition, provenance: "legacy-migrated", sourceResults: [], matchEvidenceIds: [] },
    participants: [{ clubId: arsenal }],
    europeCompetition: "Champions League",
    europeEditionId: "2026-uefa-champions-league",
    europeCompetitionId: "uefa-champions-league",
    europeSeasonYear: 2026,
    worldEditions: new Map([["uefa-champions-league::2026-uefa-champions-league", canonicalEdition]]),
    mode: "target-participation",
    requireParticipants: true,
  });
  return (
    negativesOk &&
    completeOk.ok === true &&
    campaignOk.ok === true &&
    canonicalPositive.ok === true &&
    canonicalDeletion.ok === false &&
    canonicalDeletion.reason === "participant-missing-from-world-edition" &&
    emptyCanonical.ok === false &&
    emptyCanonical.reason === "missing-canonical-participants"
  );
}

async function main() {
  const outDir = process.env.FIX09_OUT || join(root, "qa/fix09-runs/final");
  mkdirSync(outDir, { recursive: true });
  const started = new Date().toISOString();
  const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
  const focused = runFocused(outDir);
  const cohort = runCohort(outDir);
  const corruptionOk = runCorruptionControls();
  const requiredPeriods = COHORT.length * 3;
  const report = {
    fix: "09-earned-continental-qualification",
    started,
    ended: new Date().toISOString(),
    sourceSha: sha,
    node: process.version,
    focused: {
      exitCode: focused.exitCode,
      pass: focused.exitCode === 0,
    },
    cohort: {
      fixtures: COHORT.length,
      periodsPerFixture: 3,
      requiredPeriods,
      completedPeriods: cohort.completedPeriods,
      oracleViolations: cohort.oracleViolations,
      rows: cohort.rows.map((r) => ({
        seed: r.seed,
        nation: r.nation,
        position: r.position,
        ok: r.ok,
        periodCompetitions: (r.periods || []).map((p) => p.competition),
        oracleOk: (r.periods || []).every((p) => p.oracleOk === true),
      })),
    },
    corruptionControlsPass: corruptionOk,
    sourceYearForTarget2026: sourceYearForContinentalTarget(2026),
  };
  writeFileSync(join(outDir, "qa-report.json"), JSON.stringify(report, null, 2));
  writeFileSync(
    join(outDir, "qa-report.md"),
    `# Fix 09 QA report

- Focused F01–F25 exit: ${focused.exitCode}
- Cohort completed periods: ${cohort.completedPeriods} / ${requiredPeriods}
- Oracle violations: ${cohort.oracleViolations}
- Corruption controls: ${corruptionOk ? "PASS" : "FAIL"}
- Source: ${sha}
`
  );

  console.log(
    JSON.stringify(
      {
        focusedExit: focused.exitCode,
        cohortPeriods: cohort.completedPeriods,
        requiredPeriods,
        oracleViolations: cohort.oracleViolations,
        corruptionControlsPass: corruptionOk,
      },
      null,
      2
    )
  );
  const fail =
    focused.exitCode !== 0 ||
    cohort.oracleViolations > 0 ||
    cohort.completedPeriods < requiredPeriods ||
    !corruptionOk;
  process.exit(fail ? 1 : 0);
}

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
