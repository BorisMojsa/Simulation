/**
 * Bulk random career outcomes QA.
 * Plays many full careers with varied paths and writes aggregate + per-career results.
 *
 * Usage:
 *   node scripts/qaCareerOutcomes.mjs --n 100
 *   node scripts/qaCareerOutcomes.mjs --n 150 --seed 42
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
import { reseedCareerRng } from "../js/simulation/rng.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import { generateTransferOffers } from "../js/simulation/transferMarket.js";
import { acceptPipelineOffer } from "../js/simulation/dealPipeline.js";
import {
  ensureContractAuthority,
  isFreeAgent,
  selectNextCareerAction,
  applyContractExpiryAtBoundary,
  advanceFreeAgentPeriod,
} from "../js/simulation/contractLifecycle.js";
import { getBaseOverall, getCurrentOverall } from "../js/simulation/playerAbility.js";
import {
  ensureSeniorCareerState,
  resolveSeniorScenarioChoice,
  applySeniorScenarioPolicy,
} from "../js/simulation/seniorCareerScenarios.js";
import { resolveSquadDecision } from "../js/simulation/squadDecisions.js";
import { AWARD_DEFS } from "../js/simulation/individualAwards.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "qa", "findings");
const BUGS_PATH = path.join(OUT_DIR, "bugs-found.md");
const BUGS_JSON_PATH = path.join(OUT_DIR, "bugs-found.json");

const POSITIONS = ["ST", "LW", "RW", "CAM", "LM", "CM", "RM", "CDM", "LB", "CB", "RB", "GK"];
const AGES = [15, 16, 17, 18, 19];
const PATH_STYLES = ["loyal", "ambitious", "journeyman", "loan-heavy", "mixed"];

/** Living bug journal — flushed to disk after each career so progress is durable. */
class BugJournal {
  constructor() {
    this.entries = [];
    this.byCode = Object.create(null);
  }

  note(severity, code, message, detail = {}) {
    const key = `${code}::${detail.careerIndex ?? "?"}`;
    // Deduplicate exact same code+career unless countOccurrences requested
    if (!detail.allowDup && this.entries.some((e) => e._dedupe === key && e.message === message)) {
      const existing = this.entries.find((e) => e._dedupe === key && e.message === message);
      existing.hits = (existing.hits || 1) + 1;
      this.byCode[code] = (this.byCode[code] || 0) + 1;
      return existing;
    }
    const entry = {
      severity,
      code,
      message,
      hits: 1,
      at: new Date().toISOString(),
      _dedupe: key,
      ...detail,
    };
    this.entries.push(entry);
    this.byCode[code] = (this.byCode[code] || 0) + 1;
    return entry;
  }

  flush(meta = {}) {
    const sorted = [...this.entries].sort((a, b) => {
      const rank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      return (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || a.code.localeCompare(b.code);
    });
    const counts = Object.entries(this.byCode)
      .sort((a, b) => b[1] - a[1])
      .map(([code, n]) => `| \`${code}\` | ${n} |`)
      .join("\n");
    const lines = sorted.map((e) => {
      const where = [
        e.careerIndex != null ? `career #${e.careerIndex}` : null,
        e.name || null,
        e.position || null,
        e.age != null ? `age ${e.age}` : null,
        e.club || null,
      ]
        .filter(Boolean)
        .join(" · ");
      return `### ${e.severity.toUpperCase()} — \`${e.code}\`
- **What:** ${e.message}
- **Where:** ${where || "—"}
- **Hits:** ${e.hits || 1}
- **Detail:** \`${JSON.stringify({ ...e, _dedupe: undefined, message: undefined, severity: undefined, code: undefined, at: undefined, hits: undefined })}\`
`;
    });
    const md = `# Bugs found during career QA playthroughs

Updated live while careers run.  
Last flush: ${new Date().toISOString()}  
Careers completed so far: ${meta.careersDone ?? "—"} / ${meta.n ?? "—"}

## Counts by code

| Code | Events |
| --- | ---: |
${counts || "| — | 0 |"}

## Entries

${lines.join("\n") || "_No bugs logged yet._"}
`;
    fs.writeFileSync(BUGS_PATH, md);
    fs.writeFileSync(
      BUGS_JSON_PATH,
      JSON.stringify({ updatedAt: new Date().toISOString(), meta, byCode: this.byCode, entries: sorted }, null, 2)
    );
  }
}

function parseArgs(argv) {
  const out = { n: 100, seed: 20261027, maxAge: 42 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--n") out.n = Number(argv[++i]);
    else if (a === "--seed") out.seed = Number(argv[++i]);
    else if (a === "--maxAge") out.maxAge = Number(argv[++i]);
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

function mean(nums) {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function pct(nums, p) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.floor((s.length - 1) * p)));
  return s[i];
}

function round1(n) {
  return n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10;
}

function round0(n) {
  return n == null || !Number.isFinite(n) ? null : Math.round(n);
}

function maybeRetire(player, rng) {
  if (player.isRetired) return true;
  const age = player.age;
  if (age >= 42) {
    player.isRetired = true;
    player.retiredInSeason = player.seasons?.length ?? 0;
    return true;
  }
  if (age < 35) return false;
  const odds = { 35: 0.06, 36: 0.1, 37: 0.18, 38: 0.28, 39: 0.45, 40: 0.65, 41: 0.85 };
  if (rng() < (odds[age] || 0)) {
    player.isRetired = true;
    player.retiredInSeason = player.seasons?.length ?? 0;
    return true;
  }
  return false;
}

function countAwardLabels(seasons) {
  const counts = Object.create(null);
  for (const s of seasons || []) {
    for (const name of s.individualAwards || []) {
      counts[name] = (counts[name] || 0) + 1;
    }
    for (const rec of s.awardRecords || []) {
      if (rec?.outcome === "win" || rec?.won) {
        const label = rec.label || rec.awardId;
        if (label) counts[label] = counts[label] || 0; // already counted via names usually
      }
    }
  }
  return counts;
}

function countTrophies(seasons) {
  const out = {
    leagueTitles: 0,
    domesticCups: 0,
    continental: 0,
    international: 0,
    worldCups: 0,
    eurosOrCopa: 0,
    otherIntl: 0,
    byCompetition: Object.create(null),
  };
  for (const s of seasons || []) {
    for (const t of s.trophies || []) {
      const name = t.competition || t.simKey || t.label || "Unknown";
      out.byCompetition[name] = (out.byCompetition[name] || 0) + 1;
      if (t.kind === "league") out.leagueTitles += 1;
      else if (t.kind === "cup") out.domesticCups += 1;
      else if (t.kind === "continental") out.continental += 1;
      else if (t.kind === "international") {
        out.international += 1;
        const lower = String(name).toLowerCase();
        if (lower.includes("world cup")) out.worldCups += 1;
        else if (lower.includes("euro") || lower.includes("copa america") || lower.includes("africa cup") || lower.includes("asian cup") || lower.includes("gold cup") || lower.includes("nations league")) {
          out.eurosOrCopa += 1;
        } else out.otherIntl += 1;
      }
    }
  }
  return out;
}

function clubsPlayed(seasons) {
  const names = [];
  const seen = new Set();
  for (const s of seasons || []) {
    const n = s.clubDisplay || s.club || (s.freeAgent ? "Free agent" : null);
    if (!n) continue;
    if (!seen.has(n)) {
      seen.add(n);
      names.push(n);
    }
  }
  return names;
}

function resolvePendingScenario(player, rng) {
  const pending = player.pendingSeniorScenario;
  if (!pending || pending.resolved) {
    player.pendingSeniorScenario = null;
    return;
  }
  try {
    if (pending.choices?.length) {
      const choice = pick(rng, pending.choices);
      resolveSeniorScenarioChoice(player, pending, choice.id);
    } else {
      applySeniorScenarioPolicy(player, pending, pick(rng, ["balanced", "aggressive", "cautious"]));
    }
  } catch {
    /* continue */
  }
  player.pendingSeniorScenario = null;
}

function resolvePendingDecision(player, rng, style) {
  const decision = player.pendingDecision;
  if (!decision) return;
  const choices = decision.choices || [];
  if (!choices.length) {
    player.pendingDecision = null;
    return;
  }
  let choiceId = choices[0].id;
  if (style === "loan-heavy") {
    const loan = choices.find((c) => String(c.id).includes("loan") || String(c.label || "").toLowerCase().includes("loan"));
    if (loan) choiceId = loan.id;
    else choiceId = pick(rng, choices).id;
  } else if (style === "loyal") {
    const stay = choices.find((c) => /stay|see-out|reintegrate|reject/i.test(`${c.id} ${c.label || ""}`));
    choiceId = stay?.id || pick(rng, choices).id;
  } else {
    choiceId = pick(rng, choices).id;
  }
  try {
    resolveSquadDecision(player, decision, choiceId);
  } catch {
    player.pendingDecision = null;
  }
}

function maybeAcceptOffers(player, offers, rng, style) {
  if (!offers?.length) return { accepted: false };
  const permanent = offers.filter((o) => !o.isLoan && !o.isRenewal);
  const loans = offers.filter((o) => o.isLoan);
  const renewals = offers.filter((o) => o.isRenewal);

  let pickOffer = null;
  if (style === "loyal") {
    pickOffer = renewals[0] || (rng() < 0.12 ? permanent[0] : null);
  } else if (style === "ambitious") {
    pickOffer = permanent[0] || renewals[0] || null;
  } else if (style === "loan-heavy") {
    pickOffer = loans[0] || (rng() < 0.35 ? permanent[0] : renewals[0]) || null;
  } else if (style === "journeyman") {
    pickOffer = permanent[0] || loans[0] || renewals[0] || null;
  } else {
    // mixed
    const pool = [...permanent, ...loans, ...renewals];
    if (pool.length && rng() < 0.45) pickOffer = pick(rng, pool);
  }

  if (!pickOffer) return { accepted: false };
  try {
    const res = acceptPipelineOffer(player, pickOffer);
    return {
      accepted: Boolean(res?.ok),
      club: pickOffer.clubDisplay || pickOffer.club,
      dealType: pickOffer.dealType || (pickOffer.isLoan ? "loan" : pickOffer.isRenewal ? "renewal" : "permanent"),
      wage: pickOffer.wage,
      fee: pickOffer.transferFee,
    };
  } catch {
    return { accepted: false };
  }
}

function wouldSoftLockSeasonAnimation(seasonData) {
  if (!seasonData) return { softLock: true, reason: "null-seasonData" };
  if (seasonData.awaitingScenario || seasonData.awaitingDecision) return { softLock: false };
  if (seasonData.freeAgent && (!seasonData.league || !seasonData.standings)) {
    return { softLock: true, reason: "free-agent-missing-league-standings" };
  }
  if (!seasonData.season || (!seasonData.freeAgent && (!seasonData.league || !seasonData.standings))) {
    return {
      softLock: true,
      reason: "missing-required-animation-fields",
      hasSeason: Boolean(seasonData.season),
      hasLeague: Boolean(seasonData.league),
      hasStandings: Boolean(seasonData.standings),
      freeAgent: Boolean(seasonData.freeAgent),
    };
  }
  return { softLock: false };
}

function runOneCareer(index, rng, opts, bugs) {
  const nationality = pick(rng, WORLD_CUP_NATIONS).name;
  const position = pick(rng, POSITIONS);
  const startAge = pick(rng, AGES);
  const pathStyle = pick(rng, PATH_STYLES);
  const name = `Career${index}_${position}`;
  const ctx = { careerIndex: index, name, position, nationality, pathStyle };

  resetClubFinanceLedgers();
  setWorldState(createWorldState({ startYear: 2026 }));
  reseedCareerRng(`${opts.seed}:career:${index}:${name}`);

  const notes = [];
  let player;
  try {
    player = createPlayerIdentity({ name, nationality, position, age: startAge });
    ensurePlayerModel(player);
    const academies = pickThreeAcademies(ACADEMY_POOL, nationality, name);
    if (!academies?.length) {
      bugs?.note("high", "no-academy-options", "No academy offers for nationality", ctx);
      return { ok: false, error: "no-academy", name, nationality, position, startAge, pathStyle };
    }
    // Realism: all-home / no abroad variety when every offer is home pathway
    const homeOnly = academies.every((a) => a.homePathway || a.offer?.homePathway || a.academy?.nation === nationality);
    if (homeOnly && academies.length >= 3) {
      bugs?.note(
        "info",
        "academy-home-pathway-only",
        "All three academy offers were home-pathway / same-nation options",
        { ...ctx, academies: academies.map((a) => a.academy?.displayName || a.academy?.name) }
      );
    }
    finalizeAcademyPlayer(player, pick(rng, academies).academy);

    // First pro: try parent; otherwise stay academy a bit then take first offer.
    let signed = false;
    try {
      signed = Boolean(promoteAcademyGraduateToFirstTeam(player, 70 + Math.floor(rng() * 20)));
    } catch (err) {
      bugs?.note("medium", "parent-promote-threw", String(err?.message || err), ctx);
      signed = false;
    }
    for (let a = 0; a < 4 && player.club?.isAcademy; a++) {
      const data = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
        pauseForDecisions: false,
        autoDecisionPolicy: "stay",
      });
      const lock = wouldSoftLockSeasonAnimation(data);
      if (lock.softLock) {
        bugs?.note("critical", "ui-softlock-season-payload", "Season payload would soft-lock season animation UI", {
          ...ctx,
          age: player.age,
          ...lock,
        });
      }
      const offers = generateTransferOffers(
        data?.performanceScore ?? 60,
        player,
        LEAGUES,
        LEAGUE_LOOKUP,
        data?.season?.avgMatchRating ?? null
      );
      if (offers?.length) {
        const res = acceptPipelineOffer(player, offers[0]);
        if (res?.ok) {
          signed = true;
          break;
        }
        bugs?.note("medium", "first-pro-offer-rejected", "First pro offer failed to book", {
          ...ctx,
          reasons: res?.reasons || [res?.reason],
          club: offers[0].club,
        });
      }
    }
    if (!signed && player.club?.isAcademy) {
      notes.push("never-left-academy");
      bugs?.note("medium", "stuck-in-academy", "Player never left academy after several seasons", {
        ...ctx,
        age: player.age,
        academy: player.club?.displayName || player.club?.name,
      });
    }
  } catch (err) {
    bugs?.note("critical", "career-boot-failed", String(err?.message || err), ctx);
    return { ok: false, error: String(err?.message || err), name, nationality, position, startAge, pathStyle };
  }

  ensureTransferSave(player);
  ensureContractAuthority(player);
  ensureSeniorCareerState(player);

  const peak = { rating: getCurrentOverall(player) || 0, age: player.age, base: getBaseOverall(player) || 0 };
  const transfers = [];
  let freeAgentSeasons = 0;
  let softLockPayloadHits = 0;
  let seasonsSimulated = 0;
  let errors = 0;

  const hardCapSeasons = 30;
  while (!player.isRetired && player.age < opts.maxAge && seasonsSimulated < hardCapSeasons) {
    ensureContractAuthority(player);
    resolvePendingScenario(player, rng);
    if (player.pendingDecision) resolvePendingDecision(player, rng, pathStyle);

    try {
      if (isFreeAgent(player) || !player.club) {
        freeAgentSeasons += 1;
        // Engine path used by UI "train as free agent"
        const fa = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, { pauseForDecisions: true });
        const lock = wouldSoftLockSeasonAnimation(fa);
        if (lock.softLock) {
          softLockPayloadHits += 1;
          bugs?.note(
            "critical",
            "free-agent-ui-softlock",
            "Free-agent train/wait season returns payload that soft-locks the season animation overlay (no league/standings; onContinue never fires)",
            { ...ctx, age: player.age, club: "Free agent", ...lock }
          );
        }
        // Development realism: FA wait only ages + light fatigue reset — no attribute growth
        const offers = generateTransferOffers(fa?.performanceScore ?? 55, player, LEAGUES, LEAGUE_LOOKUP, null);
        if (offers?.length) {
          const moved = maybeAcceptOffers(player, offers, rng, pathStyle === "loyal" ? "ambitious" : pathStyle);
          if (moved.accepted) transfers.push({ ...moved, age: player.age, reason: "free-agent-sign" });
          else if (moved.attempted === false) {
            /* declined by policy */
          }
        } else if (freeAgentSeasons >= 3) {
          bugs?.note(
            "medium",
            "long-free-agency-no-offers",
            "Player spent multiple free-agent seasons with no market offers",
            { ...ctx, age: player.age, freeAgentSeasons }
          );
        }
      } else {
        let seasonData = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
          pauseForDecisions: true,
          autoDecisionPolicy: null,
        });

        // Mid-season scenario pause
        let guard = 0;
        while ((seasonData?.awaitingScenario || seasonData?.awaitingDecision) && guard++ < 6) {
          if (seasonData.awaitingScenario) {
            player.pendingSeniorScenario = seasonData.pendingSeniorScenario || player.pendingSeniorScenario;
            resolvePendingScenario(player, rng);
          }
          if (seasonData.awaitingDecision) {
            player.pendingDecision = seasonData.decision || player.pendingDecision;
            player.pendingOffers = seasonData.offers || player.pendingOffers || [];
            if (player.pendingOffers?.length) {
              const moved = maybeAcceptOffers(player, player.pendingOffers, rng, pathStyle);
              if (moved.accepted) transfers.push({ ...moved, age: player.age, reason: "mid-season" });
              player.pendingOffers = [];
              player.pendingDecision = null;
            } else if (player.pendingDecision) {
              resolvePendingDecision(player, rng, pathStyle);
            } else {
              player.pendingDecision = null;
            }
          }
          seasonData = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
            pauseForDecisions: true,
            autoDecisionPolicy: null,
            checkpoint: seasonData.checkpoint,
          });
        }

        applyContractExpiryAtBoundary(player);

        // End-of-season market
        if (!isFreeAgent(player) && player.club && !player.club.isAcademy) {
          const offers = generateTransferOffers(
            seasonData?.performanceScore ?? 60,
            player,
            LEAGUES,
            LEAGUE_LOOKUP,
            seasonData?.season?.avgMatchRating ?? null
          );
          player.pendingOffers = offers;
          if (!player.pendingDecision) {
            // light chance of squad decision already queued by finalize path; ignore if absent
          }
          const moved = maybeAcceptOffers(player, offers, rng, pathStyle);
          if (moved.accepted) {
            transfers.push({ ...moved, age: player.age, reason: "end-season" });
            const ovr = getCurrentOverall(player) || 0;
            if ((moved.wage || 0) > 200_000 && ovr < 75) {
              bugs?.note("medium", "unrealistic-wage-vs-ovr", "Very high wage relative to overall", {
                ...ctx,
                age: player.age,
                wage: moved.wage,
                ovr: round1(ovr),
                club: moved.club,
              });
            }
            if ((moved.fee || 0) > 50_000_000 && ovr < 78) {
              bugs?.note("medium", "unrealistic-fee-vs-ovr", "Very high transfer fee relative to overall", {
                ...ctx,
                age: player.age,
                fee: moved.fee,
                ovr: round1(ovr),
                club: moved.club,
              });
            }
          }
          player.pendingOffers = [];
        }

        // Flat unit strengths look unrealistic when ATK/MID/DEF/GK are identical
        const c = player.club;
        if (
          c &&
          !c.isAcademy &&
          Number.isFinite(c.attack) &&
          c.attack === c.midfield &&
          c.midfield === c.defence &&
          (c.goalkeeper == null || c.goalkeeper === c.attack)
        ) {
          bugs?.note(
            "low",
            "flat-club-unit-strengths",
            "Club attack/midfield/defence(/GK) strengths are identical — looks placeholder-like on the career desk",
            {
              ...ctx,
              club: c.displayName || c.name,
              overall: c.overall,
              attack: c.attack,
              midfield: c.midfield,
              defence: c.defence,
              goalkeeper: c.goalkeeper,
            }
          );
        }
      }

      const cur = getCurrentOverall(player) || 0;
      const base = getBaseOverall(player) || 0;
      if (cur > peak.rating) {
        peak.rating = cur;
        peak.age = player.age;
        peak.base = base;
      }

      // NaN / broken ratings
      if (!Number.isFinite(cur) || !Number.isFinite(base)) {
        bugs?.note("critical", "non-finite-rating", "Player rating became non-finite mid-career", {
          ...ctx,
          age: player.age,
          cur,
          base,
        });
        break;
      }

      seasonsSimulated += 1;
      if (maybeRetire(player, rng)) break;
    } catch (err) {
      errors += 1;
      notes.push(`season-error:${String(err?.message || err).slice(0, 120)}`);
      bugs?.note("critical", "season-throw", String(err?.message || err), {
        ...ctx,
        age: player.age,
        club: player.club?.displayName || player.club?.name || (isFreeAgent(player) ? "Free agent" : null),
        freeAgent: isFreeAgent(player),
      });
      // Try to unstick free-agent / bad state
      if (isFreeAgent(player) || !player.club) {
        try {
          advanceFreeAgentPeriod(player, { seasons: 1 });
        } catch {
          break;
        }
      } else {
        break;
      }
      if (errors >= 3) break;
    }
  }

  if (!player.isRetired) {
    player.isRetired = true;
    player.retiredInSeason = player.seasons?.length ?? 0;
  }

  const awardCounts = countAwardLabels(player.seasons);
  const trophies = countTrophies(player.seasons);
  const worldPlayerLabel = AWARD_DEFS.worldPlayer.label; // "World Player of the Year"
  const ballonEquiv = awardCounts[worldPlayerLabel] || 0;

  const finalRating = getCurrentOverall(player) || player.rating || 0;
  const finalBase = getBaseOverall(player) || 0;
  const clubs = clubsPlayed(player.seasons);

  return {
    ok: true,
    index,
    name,
    nationality,
    position,
    startAge,
    pathStyle,
    retiredAge: player.age,
    seasons: player.seasons?.length ?? 0,
    seasonsSimulated,
    finalClub: player.club?.displayName || player.club?.name || (isFreeAgent(player) ? "Free agent" : null),
    clubs,
    clubCount: clubs.filter((c) => c !== "Free agent").length,
    transfersAccepted: transfers.length,
    transfers,
    freeAgentSeasons,
    softLockPayloadHits,
    peakRating: round1(peak.rating),
    peakBase: round1(peak.base),
    peakAge: peak.age,
    finalRating: round1(finalRating),
    finalBase: round1(finalBase),
    careerTotals: { ...(player.careerTotals || {}) },
    careerHonors: { ...(player.careerHonors || {}) },
    awardCounts,
    ballonOrEquiv: ballonEquiv,
    trophies,
    worldCups: trophies.worldCups,
    notes,
    errors,
    nextActionAtEnd: selectNextCareerAction(player)?.id || null,
  };
}

function aggregate(results) {
  const ok = results.filter((r) => r.ok);
  const finals = ok.map((r) => r.finalRating).filter((n) => n != null);
  const peaks = ok.map((r) => r.peakRating).filter((n) => n != null);
  const ages = ok.map((r) => r.retiredAge).filter((n) => n != null);
  const apps = ok.map((r) => r.careerTotals?.matches || 0);
  const goals = ok.map((r) => r.careerTotals?.goals || 0);
  const assists = ok.map((r) => r.careerTotals?.assists || 0);

  const awardTotals = Object.create(null);
  const trophyCompTotals = Object.create(null);
  let ballon = 0;
  let worldCups = 0;
  let leagueTitles = 0;
  let cups = 0;
  let continental = 0;
  let intl = 0;
  let individualAwardWins = 0;
  const byPosition = Object.create(null);
  const byPath = Object.create(null);
  const byNation = Object.create(null);

  for (const r of ok) {
    ballon += r.ballonOrEquiv || 0;
    worldCups += r.worldCups || 0;
    leagueTitles += r.trophies?.leagueTitles || 0;
    cups += r.trophies?.domesticCups || 0;
    continental += r.trophies?.continental || 0;
    intl += r.trophies?.international || 0;
    individualAwardWins += r.careerHonors?.individualAwards || 0;
    for (const [k, v] of Object.entries(r.awardCounts || {})) {
      awardTotals[k] = (awardTotals[k] || 0) + v;
    }
    for (const [k, v] of Object.entries(r.trophies?.byCompetition || {})) {
      trophyCompTotals[k] = (trophyCompTotals[k] || 0) + v;
    }
    byPosition[r.position] = byPosition[r.position] || { n: 0, finals: [], peaks: [], ballon: 0, worldCups: 0 };
    byPosition[r.position].n += 1;
    byPosition[r.position].finals.push(r.finalRating);
    byPosition[r.position].peaks.push(r.peakRating);
    byPosition[r.position].ballon += r.ballonOrEquiv || 0;
    byPosition[r.position].worldCups += r.worldCups || 0;

    byPath[r.pathStyle] = byPath[r.pathStyle] || { n: 0, finals: [], clubCounts: [] };
    byPath[r.pathStyle].n += 1;
    byPath[r.pathStyle].finals.push(r.finalRating);
    byPath[r.pathStyle].clubCounts.push(r.clubCount);

    byNation[r.nationality] = (byNation[r.nationality] || 0) + 1;
  }

  const summarizePos = Object.fromEntries(
    Object.entries(byPosition).map(([pos, row]) => [
      pos,
      {
        n: row.n,
        avgFinal: round1(mean(row.finals)),
        avgPeak: round1(mean(row.peaks)),
        maxPeak: round1(Math.max(...row.peaks)),
        ballonOrEquiv: row.ballon,
        worldCups: row.worldCups,
      },
    ])
  );

  const summarizePath = Object.fromEntries(
    Object.entries(byPath).map(([style, row]) => [
      style,
      {
        n: row.n,
        avgFinal: round1(mean(row.finals)),
        avgClubs: round1(mean(row.clubCounts)),
      },
    ])
  );

  const topFinal = [...ok].sort((a, b) => b.finalRating - a.finalRating).slice(0, 10);
  const lowFinal = [...ok].sort((a, b) => a.finalRating - b.finalRating).slice(0, 10);
  const topPeak = [...ok].sort((a, b) => b.peakRating - a.peakRating).slice(0, 10);
  const mostAwards = [...ok]
    .sort((a, b) => (b.careerHonors?.individualAwards || 0) - (a.careerHonors?.individualAwards || 0))
    .slice(0, 10);
  const mostBallon = [...ok].sort((a, b) => (b.ballonOrEquiv || 0) - (a.ballonOrEquiv || 0)).slice(0, 10);
  const mostWC = [...ok].sort((a, b) => (b.worldCups || 0) - (a.worldCups || 0)).slice(0, 10);

  return {
    careersOk: ok.length,
    careersFailed: results.length - ok.length,
    ratings: {
      final: {
        min: round1(Math.min(...finals)),
        max: round1(Math.max(...finals)),
        avg: round1(mean(finals)),
        p10: round1(pct(finals, 0.1)),
        p50: round1(pct(finals, 0.5)),
        p90: round1(pct(finals, 0.9)),
      },
      peak: {
        min: round1(Math.min(...peaks)),
        max: round1(Math.max(...peaks)),
        avg: round1(mean(peaks)),
        p10: round1(pct(peaks, 0.1)),
        p50: round1(pct(peaks, 0.5)),
        p90: round1(pct(peaks, 0.9)),
      },
    },
    retirementAge: {
      min: Math.min(...ages),
      max: Math.max(...ages),
      avg: round1(mean(ages)),
    },
    playingCareer: {
      avgAppearances: round0(mean(apps)),
      avgGoals: round0(mean(goals)),
      avgAssists: round0(mean(assists)),
      avgClubs: round1(mean(ok.map((r) => r.clubCount))),
      avgTransfersAccepted: round1(mean(ok.map((r) => r.transfersAccepted))),
      careersWithFreeAgentTime: ok.filter((r) => r.freeAgentSeasons > 0).length,
      freeAgentSoftLockPayloadHits: ok.reduce((a, r) => a + (r.softLockPayloadHits || 0), 0),
    },
    honorsTotals: {
      leagueTitles,
      domesticCups: cups,
      continentalTitles: continental,
      internationalTitles: intl,
      worldCups,
      individualAwardWins,
      worldPlayerOfTheYear_BallonEquiv: ballon,
      careersWithAtLeastOneBallonEquiv: ok.filter((r) => (r.ballonOrEquiv || 0) > 0).length,
      careersWithWorldCup: ok.filter((r) => (r.worldCups || 0) > 0).length,
    },
    awardTotals,
    trophyCompetitionTotals: trophyCompTotals,
    byPosition: summarizePos,
    byPathStyle: summarizePath,
    nationalityCounts: byNation,
    leaderboards: {
      highestFinalRating: topFinal.map(brief),
      lowestFinalRating: lowFinal.map(brief),
      highestPeakRating: topPeak.map(brief),
      mostIndividualAwards: mostAwards.map(brief),
      mostWorldPlayerOfTheYear: mostBallon.map(brief),
      mostWorldCups: mostWC.map(brief),
    },
  };
}

function brief(r) {
  return {
    name: r.name,
    position: r.position,
    nationality: r.nationality,
    pathStyle: r.pathStyle,
    finalRating: r.finalRating,
    peakRating: r.peakRating,
    retiredAge: r.retiredAge,
    clubs: r.clubCount,
    ballonOrEquiv: r.ballonOrEquiv,
    worldCups: r.worldCups,
    individualAwards: r.careerHonors?.individualAwards || 0,
    leagueTitles: r.trophies?.leagueTitles || 0,
    finalClub: r.finalClub,
  };
}

function toMarkdown(meta, agg) {
  const awardLines = Object.entries(agg.awardTotals || {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `| ${k} | ${v} |`)
    .join("\n");
  const trophyLines = Object.entries(agg.trophyCompetitionTotals || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([k, v]) => `| ${k} | ${v} |`)
    .join("\n");
  const posLines = Object.entries(agg.byPosition || {})
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(
      ([pos, row]) =>
        `| ${pos} | ${row.n} | ${row.avgFinal} | ${row.avgPeak} | ${row.maxPeak} | ${row.ballonOrEquiv} | ${row.worldCups} |`
    )
    .join("\n");

  const lb = (rows) =>
    rows
      .map(
        (r, i) =>
          `| ${i + 1} | ${r.name} | ${r.position} | ${r.nationality} | ${r.finalRating} | ${r.peakRating} | ${r.ballonOrEquiv} | ${r.worldCups} | ${r.individualAwards} | ${r.finalClub || "—"} |`
      )
      .join("\n");

  return `# Career outcomes QA

Generated: ${meta.generatedAt}  
Careers requested: **${meta.n}** · completed OK: **${agg.careersOk}** · failed: **${agg.careersFailed}**  
Seed: \`${meta.seed}\`  
Note: **World Player of the Year** is this sim’s Ballon d’Or-style award.

## End-of-career rating

| Stat | Final OVR | Peak OVR |
| --- | ---: | ---: |
| Min | ${agg.ratings.final.min} | ${agg.ratings.peak.min} |
| Average | ${agg.ratings.final.avg} | ${agg.ratings.peak.avg} |
| Median (p50) | ${agg.ratings.final.p50} | ${agg.ratings.peak.p50} |
| p90 | ${agg.ratings.final.p90} | ${agg.ratings.peak.p90} |
| Max | ${agg.ratings.final.max} | ${agg.ratings.peak.max} |

## Retirement & playing volume

- Retirement age: min ${agg.retirementAge.min} · avg ${agg.retirementAge.avg} · max ${agg.retirementAge.max}
- Avg career appearances: ${agg.playingCareer.avgAppearances}
- Avg career goals: ${agg.playingCareer.avgGoals}
- Avg career assists: ${agg.playingCareer.avgAssists}
- Avg clubs per career: ${agg.playingCareer.avgClubs}
- Avg accepted transfers: ${agg.playingCareer.avgTransfersAccepted}
- Careers that spent time as free agent: ${agg.playingCareer.careersWithFreeAgentTime}
- Free-agent UI soft-lock payload hits (known issue, noted if stumbled into): ${agg.playingCareer.freeAgentSoftLockPayloadHits}

## Honors totals (across all careers)

| Honor | Total |
| --- | ---: |
| League titles | ${agg.honorsTotals.leagueTitles} |
| Domestic cups | ${agg.honorsTotals.domesticCups} |
| Continental titles | ${agg.honorsTotals.continentalTitles} |
| International titles (all) | ${agg.honorsTotals.internationalTitles} |
| World Cups | ${agg.honorsTotals.worldCups} |
| Individual award wins | ${agg.honorsTotals.individualAwardWins} |
| World Player of the Year (Ballon equiv.) | ${agg.honorsTotals.worldPlayerOfTheYear_BallonEquiv} |
| Careers with ≥1 Ballon equiv. | ${agg.honorsTotals.careersWithAtLeastOneBallonEquiv} |
| Careers with ≥1 World Cup | ${agg.honorsTotals.careersWithWorldCup} |

## Individual awards breakdown

| Award | Wins |
| --- | ---: |
${awardLines || "| — | 0 |"}

## Trophy competitions (top)

| Competition | Wins |
| --- | ---: |
${trophyLines || "| — | 0 |"}

## By position

| Pos | N | Avg final | Avg peak | Max peak | Ballon equiv. | World Cups |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${posLines}

## Leaderboards

### Highest final rating
| # | Name | Pos | Nation | Final | Peak | Ballon | WC | Awards | Final club |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
${lb(agg.leaderboards.highestFinalRating)}

### Lowest final rating
| # | Name | Pos | Nation | Final | Peak | Ballon | WC | Awards | Final club |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
${lb(agg.leaderboards.lowestFinalRating)}

### Most World Player of the Year
| # | Name | Pos | Nation | Final | Peak | Ballon | WC | Awards | Final club |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
${lb(agg.leaderboards.mostWorldPlayerOfTheYear)}

### Most World Cups
| # | Name | Pos | Nation | Final | Peak | Ballon | WC | Awards | Final club |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
${lb(agg.leaderboards.mostWorldCups)}

### Most individual awards
| # | Name | Pos | Nation | Final | Peak | Ballon | WC | Awards | Final club |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
${lb(agg.leaderboards.mostIndividualAwards)}
`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const rng = mulberry32(opts.seed);
  const bugs = new BugJournal();
  const results = [];

  // Seed the bugs doc immediately so it exists while the run is in progress.
  bugs.flush({ careersDone: 0, n: opts.n, seed: opts.seed, status: "starting" });

  console.log(`Playing ${opts.n} full careers via real season engine (seed ${opts.seed})…`);
  for (let i = 0; i < opts.n; i++) {
    const row = runOneCareer(i, rng, opts, bugs);
    results.push(row);
    bugs.flush({ careersDone: i + 1, n: opts.n, seed: opts.seed, status: "running" });
    if ((i + 1) % 5 === 0 || i === 0) {
      const ok = results.filter((r) => r.ok).length;
      const bugCodes = Object.keys(bugs.byCode).length;
      console.log(`progress ${i + 1}/${opts.n} (ok ${ok}, bug-codes ${bugCodes})`);
    }
  }

  const agg = aggregate(results);
  const meta = {
    generatedAt: new Date().toISOString(),
    n: opts.n,
    seed: opts.seed,
    maxAge: opts.maxAge,
    method:
      "Each career is played season-by-season through simulateSeason with pauseForDecisions, random academy/setup, path-style transfer/loan decisions, senior scenario choices, and retirement odds matching the live UI.",
    note: "World Player of the Year is the Ballon d'Or-style award in this sim.",
  };
  const payload = { meta, aggregate: agg, careers: results, bugs: { byCode: bugs.byCode, entries: bugs.entries } };

  const stamp = meta.generatedAt.replace(/[:.]/g, "-");
  const jsonPath = path.join(OUT_DIR, `career-outcomes-${stamp}.json`);
  const mdPath = path.join(OUT_DIR, `career-outcomes-${stamp}.md`);
  const latestJson = path.join(OUT_DIR, "career-outcomes-latest.json");
  const latestMd = path.join(OUT_DIR, "career-outcomes-latest.md");
  const md = toMarkdown(meta, agg);

  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  fs.writeFileSync(latestJson, JSON.stringify(payload, null, 2));
  fs.writeFileSync(mdPath, md);
  fs.writeFileSync(latestMd, md);
  bugs.flush({ careersDone: opts.n, n: opts.n, seed: opts.seed, status: "complete" });

  console.log(JSON.stringify({ meta, summary: agg.ratings, honors: agg.honorsTotals, bugCodes: bugs.byCode }, null, 2));
  console.log(`wrote ${latestMd}`);
  console.log(`wrote ${latestJson}`);
  console.log(`wrote ${BUGS_PATH}`);
}

main();
