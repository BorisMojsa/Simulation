/**
 * Bulk career QA harness — runs many randomized careers headlessly and logs
 * confirmed anomalies (soft-locks, free-agent UI payload gaps, scenario effects,
 * transfer/contract weirdness, GK attribute shape).
 *
 * Usage:
 *   node scripts/qaBulkCareers.mjs --n 100
 *   node scripts/qaBulkCareers.mjs --n 20 --maxSeasons 12
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ACADEMY_POOL, LEAGUES, LEAGUE_LOOKUP } from "../js/data/leagues.js";
import { WORLD_CUP_NATIONS } from "../js/data/worldCupNations.js";
import {
  createPlayerIdentity,
  finalizeAcademyPlayer,
  promoteAcademyGraduateToFirstTeam,
} from "../js/simulation/playerDevelopment.js";
import { pickThreeAcademies } from "../js/simulation/narrativeAcademySeason.js";
import { ensurePlayerModel } from "../js/simulation/playerModelMigration.js";
import { ensureTransferSave } from "../js/simulation/transferMigration.js";
import { createWorldState, setWorldState } from "../js/simulation/worldState.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import { reseedCareerRng, createStreamRng } from "../js/simulation/rng.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import { generateTransferOffers } from "../js/simulation/transferMarket.js";
import { acceptPipelineOffer } from "../js/simulation/dealPipeline.js";
import {
  ensureContractAuthority,
  isFreeAgent,
  releaseToFreeAgency,
  selectNextCareerAction,
  applyContractExpiryAtBoundary,
} from "../js/simulation/contractLifecycle.js";
import { getBaseOverall, getCurrentOverall, getDisplayAttributeKeys } from "../js/simulation/playerAbility.js";
import { GK_ATTRIBUTE_KEYS, OUTFIELD_ATTRIBUTE_KEYS } from "../js/config/playerDevelopmentConfig.js";
import { STATS_KEYS } from "../js/config/playerConfig.js";
import {
  ensureSeniorCareerState,
  resolveSeniorScenarioChoice,
  applySeniorScenarioPolicy,
} from "../js/simulation/seniorCareerScenarios.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "qa", "findings");

const POSITIONS = ["ST", "LW", "RW", "CAM", "LM", "CM", "RM", "CDM", "LB", "CB", "RB", "GK"];
const AGES = [15, 16, 17, 18, 19];

function parseArgs(argv) {
  const out = { n: 100, maxSeasons: 18, seed: 20261027 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--n") out.n = Number(argv[++i]);
    else if (a === "--maxSeasons") out.maxSeasons = Number(argv[++i]);
    else if (a === "--seed") out.seed = Number(argv[++i]);
  }
  return out;
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

function note(findings, severity, code, message, detail = {}) {
  findings.push({ severity, code, message, ...detail, at: new Date().toISOString() });
}

function attributeKeysPresent(player) {
  const keys = Object.keys(player.attributes || {});
  return {
    keys,
    hasOutfield: OUTFIELD_ATTRIBUTE_KEYS.every((k) => k in (player.attributes || {})),
    hasGk: GK_ATTRIBUTE_KEYS.every((k) => k in (player.attributes || {})),
    displayKeys: getDisplayAttributeKeys(player.position),
    legacyStatsKeys: STATS_KEYS,
  };
}

function wouldSoftLockSeasonAnimation(seasonData) {
  // Mirrors js/ui/seasonAnimation.js animateSeasonSequence early-return.
  if (!seasonData) return { softLock: true, reason: "null-seasonData" };
  const { season, league, standings } = seasonData;
  if (!season || !league || !standings) {
    return {
      softLock: true,
      reason: "missing-league-or-standings",
      freeAgent: Boolean(seasonData.freeAgent),
      hasSeason: Boolean(season),
      hasLeague: Boolean(league),
      hasStandings: Boolean(standings),
    };
  }
  return { softLock: false };
}

function runOneCareer(careerIndex, rng, opts) {
  const findings = [];
  const nationality = pick(rng, WORLD_CUP_NATIONS).name;
  const position = pick(rng, POSITIONS);
  const age = pick(rng, AGES);
  const name = `QA${careerIndex}-${position}`;

  resetClubFinanceLedgers();
  setWorldState(createWorldState({ startYear: 2026 }));
  reseedCareerRng(`${opts.seed}:${careerIndex}:${name}`);

  let player;
  try {
    player = createPlayerIdentity({ name, nationality, position, age });
    ensurePlayerModel(player);
  } catch (err) {
    note(findings, "critical", "identity-create-failed", String(err?.message || err), {
      nationality,
      position,
      age,
    });
    return { ok: false, careerIndex, name, nationality, position, age, findings, summary: null };
  }

  const attrShape = attributeKeysPresent(player);
  if (position === "GK") {
    if (!attrShape.hasGk) {
      note(findings, "high", "gk-missing-gk-attrs", "GK player missing Reflexes/Handling/etc attributes", {
        keys: attrShape.keys,
        displayKeys: attrShape.displayKeys,
      });
    }
    if (attrShape.hasOutfield && !attrShape.hasGk) {
      note(findings, "high", "gk-outfield-only-attrs", "GK only has outfield attribute keys", {
        keys: attrShape.keys,
      });
    }
    // Future polish: UI still may present outfield language via legacy STATS_KEYS.
    if (STATS_KEYS.includes("Shooting") && attrShape.displayKeys.includes("Reflexes")) {
      // Informational — model is correct; flag if overview ever uses STATS_KEYS for GK.
      note(findings, "info", "gk-dual-attr-systems", "GK display keys are correct; legacy STATS_KEYS still outfield-shaped", {
        displayKeys: attrShape.displayKeys,
        legacyStatsKeys: STATS_KEYS,
      });
    }
  }

  const academies = pickThreeAcademies(ACADEMY_POOL, nationality, name);
  if (!academies?.length) {
    note(findings, "high", "no-academy-options", "pickThreeAcademies returned empty", { nationality });
    return { ok: false, careerIndex, name, nationality, position, age, findings, summary: null };
  }
  const academy = academies[Math.floor(rng() * academies.length)].academy;
  try {
    finalizeAcademyPlayer(player, academy);
  } catch (err) {
    note(findings, "critical", "academy-finalize-failed", String(err?.message || err));
    return { ok: false, careerIndex, name, nationality, position, age, findings, summary: null };
  }

  // Attempt first pro contract via parent club when possible.
  let signedPro = false;
  try {
    const senior = promoteAcademyGraduateToFirstTeam(player, 75);
    signedPro = Boolean(senior || (player.club && !player.club.isAcademy));
  } catch (err) {
    note(findings, "medium", "parent-promote-failed", String(err?.message || err));
  }

  if (!signedPro) {
    // Short academy seasons then force a pipeline offer accept if any appear.
    for (let a = 0; a < 3 && player.club?.isAcademy; a++) {
      try {
        const data = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
          pauseForDecisions: false,
          autoDecisionPolicy: "stay",
        });
        const lock = wouldSoftLockSeasonAnimation(data);
        if (lock.softLock) {
          note(findings, "critical", "ui-softlock-academy", "Season payload would soft-lock season animation", lock);
        }
        const offers = generateTransferOffers(
          data?.performanceScore ?? 60,
          player,
          LEAGUES,
 LEAGUE_LOOKUP,
          data?.season?.avgMatchRating ?? null
        );
        if (offers?.length) {
          const accept = acceptPipelineOffer(player, offers[0]);
          if (accept?.ok) signedPro = true;
        }
      } catch (err) {
        note(findings, "high", "academy-season-error", String(err?.message || err));
        break;
      }
    }
  }

  ensureTransferSave(player);
  ensureContractAuthority(player);
  ensureSeniorCareerState(player);

  const ovrStart = getBaseOverall(player);
  let seasonsRun = 0;
  let freeAgentHits = 0;
  let freeAgentSoftLocks = 0;
  let scenarioResolves = 0;
  let scenarioOvrMoves = 0;
  let scenarioOvrFlat = 0;
  let transfersAccepted = 0;
  let errors = 0;
  const clubs = [];
  const wageTrail = [];

  const maxSeasons = opts.maxSeasons;
  while (seasonsRun < maxSeasons && !player.isRetired && player.age < 42) {
    ensureContractAuthority(player);
    const next = selectNextCareerAction(player);

    // Resolve pending senior scenario with balanced auto policy if present.
    if (player.pendingSeniorScenario && !player.pendingSeniorScenario.resolved) {
      const pending = player.pendingSeniorScenario;
      const before = getCurrentOverall(player);
      try {
        applySeniorScenarioPolicy(player, pending, "balanced");
        // Policy may resolve; if still pending with choices, pick first.
        if (pending && !pending.resolved && pending.choices?.[0]) {
          resolveSeniorScenarioChoice(player, pending, pending.choices[0].id);
        }
        scenarioResolves += 1;
        const after = getCurrentOverall(player);
        if (Math.abs((after ?? 0) - (before ?? 0)) > 1e-9) scenarioOvrMoves += 1;
        else scenarioOvrFlat += 1;
        player.pendingSeniorScenario = null;
      } catch (err) {
        note(findings, "high", "scenario-resolve-error", String(err?.message || err), {
          scenarioId: pending?.scenarioId,
        });
        player.pendingSeniorScenario = null;
      }
    }

    if (player.pendingDecision) {
      player.pendingDecision = null;
    }

    try {
      let seasonData;
      if (isFreeAgent(player) || !player.club) {
        freeAgentHits += 1;
        seasonData = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
          pauseForDecisions: true,
        });
        const lock = wouldSoftLockSeasonAnimation(seasonData);
        if (lock.softLock) {
          freeAgentSoftLocks += 1;
          note(findings, "critical", "free-agent-ui-softlock", "Free-agent wait season would soft-lock the UI", {
            careerIndex,
            age: player.age,
            ...lock,
            seasonId: seasonData?.season?.seasonId,
          });
        }
        // Market search after FA wait
        const offers = generateTransferOffers(
          seasonData?.performanceScore ?? 55,
          player,
          LEAGUES,
          LEAGUE_LOOKUP,
          null
        );
        if (offers?.length) {
          const best = offers[0];
          const res = acceptPipelineOffer(player, best);
          if (res?.ok) {
            transfersAccepted += 1;
            clubs.push({
              club: best.clubDisplay || best.club,
              league: best.leagueDisplay || best.league,
              wage: best.wage,
              dealType: best.dealType || (best.isLoan ? "loan" : "permanent"),
              age: player.age,
            });
          } else {
            note(findings, "medium", "fa-offer-reject", "Free-agent offer failed to book", {
              reasons: res?.reasons || [res?.reason],
              club: best.club,
              wage: best.wage,
            });
          }
        }
      } else {
        seasonData = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
          pauseForDecisions: false,
          autoDecisionPolicy: "stay",
        });

        // Mid-season pause path: if somehow returned awaiting, auto-resume once.
        if (seasonData?.awaitingScenario && seasonData.pendingSeniorScenario) {
          const pending = seasonData.pendingSeniorScenario;
          const before = getCurrentOverall(player);
          player.pendingSeniorScenario = pending;
          try {
            if (pending.choices?.[0]) {
              resolveSeniorScenarioChoice(player, pending, pending.choices[0].id);
            } else {
              applySeniorScenarioPolicy(player, pending, "balanced");
            }
            scenarioResolves += 1;
            const after = getCurrentOverall(player);
            if (Math.abs((after ?? 0) - (before ?? 0)) > 1e-9) scenarioOvrMoves += 1;
            else scenarioOvrFlat += 1;
          } catch (err) {
            note(findings, "high", "midseason-scenario-error", String(err?.message || err));
          }
          player.pendingSeniorScenario = null;
          seasonData = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
            pauseForDecisions: false,
            autoDecisionPolicy: "stay",
            checkpoint: seasonData.checkpoint,
          });
        }

        if (seasonData?.awaitingDecision) {
          player.pendingDecision = null;
          player.pendingOffers = [];
          seasonData = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
            pauseForDecisions: false,
            autoDecisionPolicy: "stay",
            checkpoint: seasonData.checkpoint,
          });
        }

        const lock = wouldSoftLockSeasonAnimation(seasonData);
        if (lock.softLock && !seasonData?.awaitingDecision && !seasonData?.awaitingScenario) {
          note(findings, "critical", "ui-softlock-season", "Completed season payload would soft-lock animation", lock);
        }

        applyContractExpiryAtBoundary(player);

        // Opportunistic transfer every few seasons
        if (seasonsRun > 0 && seasonsRun % 4 === 0 && !isFreeAgent(player)) {
          const offers = generateTransferOffers(
            seasonData?.performanceScore ?? 60,
            player,
            LEAGUES,
            LEAGUE_LOOKUP,
            seasonData?.season?.avgMatchRating ?? null
          );
          const permanent = (offers || []).find((o) => !o.isLoan && !o.isRenewal);
          if (permanent && rng() < 0.55) {
            const res = acceptPipelineOffer(player, permanent);
            if (res?.ok) {
              transfersAccepted += 1;
              clubs.push({
                club: permanent.clubDisplay || permanent.club,
                league: permanent.leagueDisplay || permanent.league,
                wage: permanent.wage,
                fee: permanent.transferFee,
                dealType: permanent.dealType || "permanent",
                age: player.age,
                ovr: Math.round(getCurrentOverall(player) || 0),
              });
              // Realism flag: huge fee to tiny wage or reverse
              if (permanent.transferFee > 40_000_000 && (permanent.wage || 0) < 5000) {
                note(findings, "medium", "unrealistic-fee-wage", "High fee with very low wage", {
                  fee: permanent.transferFee,
                  wage: permanent.wage,
                  club: permanent.club,
                  ovr: getCurrentOverall(player),
                });
              }
              if ((permanent.wage || 0) > 250_000 && (getCurrentOverall(player) || 0) < 72) {
                note(findings, "medium", "unrealistic-wage-ovr", "Very high wage for modest overall", {
                  wage: permanent.wage,
                  ovr: getCurrentOverall(player),
                  club: permanent.club,
                });
              }
            }
          }
        }

        // Force free agency once mid-career to exercise the path
        if (
          freeAgentHits === 0 &&
          seasonsRun >= 5 &&
          player.age >= 24 &&
          !isFreeAgent(player) &&
          !player.club?.isAcademy &&
          rng() < 0.35
        ) {
          releaseToFreeAgency(player, "qa-forced-expiry");
        }
      }

      wageTrail.push({
        season: seasonsRun,
        age: player.age,
        club: player.club?.displayName || player.club?.name || (isFreeAgent(player) ? "Free agent" : null),
        wage: player.weeklyWage ?? player.wage ?? 0,
        ovr: Math.round(getCurrentOverall(player) || 0),
        freeAgent: isFreeAgent(player),
      });
      seasonsRun += 1;
    } catch (err) {
      errors += 1;
      note(findings, "critical", "season-throw", String(err?.message || err), {
        seasonsRun,
        age: player.age,
        club: player.club?.name,
        freeAgent: isFreeAgent(player),
        next,
      });
      break;
    }
  }

  const ovrEnd = getBaseOverall(player);
  if (scenarioResolves > 0 && scenarioOvrMoves === 0) {
    note(findings, "high", "scenarios-no-ovr-move", "Senior scenarios resolved but current overall never moved", {
      scenarioResolves,
      scenarioOvrFlat,
      ovrStart,
      ovrEnd,
    });
  }

  if (signedPro && seasonsRun >= 8 && clubs.length === 0 && transfersAccepted === 0 && !isFreeAgent(player)) {
    // Not necessarily a bug — one-club careers happen — mark as observation.
    note(findings, "info", "one-club-career", "No transfers accepted across long career", {
      seasonsRun,
      club: player.club?.name,
      ovr: ovrEnd,
    });
  }

  return {
    ok: errors === 0,
    careerIndex,
    name,
    nationality,
    position,
    age,
    findings,
    summary: {
      seasonsRun,
      signedPro,
      freeAgentHits,
      freeAgentSoftLocks,
      scenarioResolves,
      scenarioOvrMoves,
      scenarioOvrFlat,
      transfersAccepted,
      errors,
      ovrStart: Math.round(ovrStart || 0),
      ovrEnd: Math.round(ovrEnd || 0),
      finalClub: player.club?.displayName || player.club?.name || (isFreeAgent(player) ? "Free agent" : null),
      finalAge: player.age,
      clubs,
      attrShape,
    },
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const rng = mulberry32(opts.seed);

  const results = [];
  const aggregate = {
    careers: opts.n,
    seed: opts.seed,
    maxSeasons: opts.maxSeasons,
    freeAgentSoftLockCareers: 0,
    freeAgentSoftLockEvents: 0,
    critical: 0,
    high: 0,
    medium: 0,
    info: 0,
    byCode: {},
    positionCounts: {},
    scenarioOvrMoveRate: { moves: 0, flat: 0, resolves: 0 },
    gkAttrOk: 0,
    gkAttrBad: 0,
  };

  for (let i = 0; i < opts.n; i++) {
    const row = runOneCareer(i, rng, opts);
    results.push(row);
    aggregate.positionCounts[row.position] = (aggregate.positionCounts[row.position] || 0) + 1;
    if (row.summary?.freeAgentSoftLocks > 0) {
      aggregate.freeAgentSoftLockCareers += 1;
      aggregate.freeAgentSoftLockEvents += row.summary.freeAgentSoftLocks;
    }
    if (row.summary) {
      aggregate.scenarioOvrMoveRate.moves += row.summary.scenarioOvrMoves;
      aggregate.scenarioOvrMoveRate.flat += row.summary.scenarioOvrFlat;
      aggregate.scenarioOvrMoveRate.resolves += row.summary.scenarioResolves;
    }
    if (row.position === "GK") {
      if (row.summary?.attrShape?.hasGk) aggregate.gkAttrOk += 1;
      else aggregate.gkAttrBad += 1;
    }
    for (const f of row.findings) {
      aggregate[f.severity] = (aggregate[f.severity] || 0) + 1;
      aggregate.byCode[f.code] = (aggregate.byCode[f.code] || 0) + 1;
    }
    if ((i + 1) % 10 === 0 || i === 0) {
      console.log(`progress ${i + 1}/${opts.n}`);
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(OUT_DIR, `bulk-careers-${stamp}.json`);
  const mdPath = path.join(OUT_DIR, `bulk-careers-${stamp}.md`);
  const latestJson = path.join(OUT_DIR, "bulk-careers-latest.json");
  const latestMd = path.join(OUT_DIR, "bulk-careers-latest.md");

  const payload = { aggregate, results };
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  fs.writeFileSync(latestJson, JSON.stringify(payload, null, 2));

  const topCodes = Object.entries(aggregate.byCode)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([code, n]) => `- \`${code}\`: ${n}`)
    .join("\n");

  const criticalSamples = results
    .flatMap((r) => r.findings.filter((f) => f.severity === "critical").map((f) => ({ ...f, career: r.name })))
    .slice(0, 40);

  const md = `# Bulk career QA

- Careers: **${aggregate.careers}**
- Seed: \`${aggregate.seed}\`
- Max seasons / career: ${aggregate.maxSeasons}

## Severity totals

| Severity | Count |
| --- | ---: |
| critical | ${aggregate.critical || 0} |
| high | ${aggregate.high || 0} |
| medium | ${aggregate.medium || 0} |
| info | ${aggregate.info || 0} |

## Free-agent soft-lock (UI animation gap)

- Careers that hit free-agent soft-lock payload: **${aggregate.freeAgentSoftLockCareers}**
- Soft-lock events: **${aggregate.freeAgentSoftLockEvents}**

Root cause (confirmed in code): \`simulateSeason\` free-agent path returns \`{ season, freeAgent: true }\` without \`league\`/\`standings\`. \`showSeasonAnimation\` → \`animateSeasonSequence\` early-returns after opening the overlay and **never calls \`onContinue\`**, leaving the UI stuck.

## Senior scenario overall impact

- Resolves: ${aggregate.scenarioOvrMoveRate.resolves}
- Current-OVR moved: ${aggregate.scenarioOvrMoveRate.moves}
- Current-OVR flat: ${aggregate.scenarioOvrMoveRate.flat}

## Goalkeeper attribute shape

- GK careers with GK keys present: ${aggregate.gkAttrOk}
- GK careers missing GK keys: ${aggregate.gkAttrBad}

Model already defines Reflexes / Handling / Positioning / Diving / Kicking / Physicality. Legacy \`STATS_KEYS\` in \`playerConfig.js\` remains outfield-shaped.

## Top finding codes

${topCodes || "_none_"}

## Sample critical findings

${
  criticalSamples.length
    ? criticalSamples
        .map((f) => `- **${f.code}** (${f.career}): ${f.message}`)
        .join("\n")
    : "_none_"
}
`;

  fs.writeFileSync(mdPath, md);
  fs.writeFileSync(latestMd, md);
  console.log(JSON.stringify(aggregate, null, 2));
  console.log(`wrote ${jsonPath}`);
  console.log(`wrote ${mdPath}`);
}

main();
