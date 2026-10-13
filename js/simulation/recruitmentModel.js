/**
 * Sporting suitability, scouting assessment, and eligible club candidates.
 * Rich clubs are not suitable merely because they can pay.
 */
import { clamp } from "../utils/helpers.js";
import { createStreamRng, hashSeed } from "./rng.js";
import { safePlayerOverall } from "./playerOverallSafe.js";
import { roleStarterBenchmark } from "./playerSelection.js";
import { sportingProfileFromTeam } from "./teamStrength.js";
import {
  ROLE_GAPS,
  CLUB_STRENGTH_BANDS,
  SCOUTING,
  PROSPECT_PATHWAY,
  RECRUITMENT_CONFIG_VERSION,
} from "../config/recruitmentConfig.js";

export { RECRUITMENT_CONFIG_VERSION };

function gaussian(rng) {
  // Box-Muller
  let u = 0;
  let v = 0;
  while (u === 0) u = rng.random();
  while (v === 0) v = rng.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Deterministic abstract depth chart per club/position/season.
 * Not rerolled when offers refresh.
 */
export function abstractDepthChart(clubId, position, seasonKey = "0") {
  const rng = createStreamRng(`${clubId}:${seasonKey}`, `depth:${position || "CM"}`);
  const starterGap = rng.float(-1.5, 2.5);
  const rotationGap = starterGap - rng.float(3, 5);
  const coverGap = rotationGap - rng.float(2, 4);
  const vacancy = rng.chance(0.22);
  const coverNeed = rng.chance(0.55) || vacancy;
  return {
    clubId,
    position,
    seasonKey,
    starterGap,
    rotationGap,
    coverGap,
    vacancy,
    coverNeed,
    strategy: rng.chance(0.28) ? "develop" : rng.chance(0.35) ? "win-now" : "balanced",
  };
}

/**
 * Scouted assessment with uncertainty — never reads true potential as perfect knowledge.
 */
export function assessPlayerForClub(player, club, opts = {}) {
  const careerId = opts.careerId || player.careerId || player.name || "career";
  const seasonKey = String(opts.seasonIndex ?? player.seasons?.length ?? 0);
  const rng = createStreamRng(careerId, `scout:${club.clubId || club.name}:${seasonKey}`);

  const trueOvr = Number(opts.trueOverall ?? safePlayerOverall(player));
  const truePotential = Number(player.development?.latentBudget ?? player.potential ?? trueOvr + 5);

  const recent = player.seasons?.slice(-2) || [];
  const matchSample = recent.reduce((s, se) => s + (se.matches || 0), 0);
  const shrink =
    matchSample >= SCOUTING.minMatchesForFullEvidence
      ? 1
      : SCOUTING.tinySampleShrink +
        (1 - SCOUTING.tinySampleShrink) * (matchSample / SCOUTING.minMatchesForFullEvidence);

  const readinessNoise = gaussian(rng) * SCOUTING.readinessNoiseSd;
  const upsideNoise = gaussian(rng) * SCOUTING.upsideNoiseSd;

  const assessedReadiness = clamp(trueOvr + readinessNoise * shrink, 40, 99);
  const assessedUpside = clamp(truePotential + upsideNoise, assessedReadiness, 99);

  // Persist lightweight evidence on player (stable across reloads if seasonKey unchanged).
  if (player && opts.persist !== false) {
    if (!player.scoutingEvidence) player.scoutingEvidence = {};
    const key = `${club.clubId || club.name}:${seasonKey}`;
    if (!player.scoutingEvidence[key]) {
      player.scoutingEvidence[key] = {
        assessedReadiness,
        assessedUpside,
        matchSample,
        seasonKey,
        clubId: club.clubId || null,
      };
    }
    return player.scoutingEvidence[key];
  }

  return { assessedReadiness, assessedUpside, matchSample, seasonKey, clubId: club.clubId || null };
}

/**
 * Map readiness gap → projected role (aligned with selection model).
 */
export function projectRole(assessedReadiness, teamProfile, position, depth) {
  const benchmark = roleStarterBenchmark(teamProfile, position);
  const gap = assessedReadiness - benchmark;
  const adjustedStarter = ROLE_GAPS.starter + (depth?.starterGap || 0) * 0.15;
  const rotationThresh = ROLE_GAPS.rotation + (depth?.rotationGap || 0) * 0.1;
  const coverThresh = ROLE_GAPS.cover;

  let role = "ineligible";
  if (gap >= adjustedStarter) role = "starter";
  else if (gap >= rotationThresh) role = "rotation";
  else if (gap >= coverThresh && (depth?.coverNeed || depth?.vacancy)) role = "cover";
  else if (gap >= ROLE_GAPS.prospectMax) role = "prospect";

  // Expected minutes share (forecast, not a guarantee).
  let minutesShare = 0;
  if (role === "starter") minutesShare = 0.72;
  else if (role === "rotation") minutesShare = 0.42;
  else if (role === "cover") minutesShare = 0.18;
  else if (role === "prospect") minutesShare = 0.08;

  if (depth?.vacancy && role !== "ineligible") minutesShare = Math.min(0.85, minutesShare + 0.12);

  return {
    role,
    gap,
    benchmark,
    minutesShare,
    minutesRange: [
      Math.round(minutesShare * 0.7 * 100),
      Math.round(Math.min(0.95, minutesShare * 1.25) * 100),
    ],
  };
}

export function isEliteClub(club, teamProfile) {
  const ovr = Number(teamProfile?.overall ?? club.overall ?? 0);
  return ovr >= CLUB_STRENGTH_BANDS.eliteSeniorMinOverall;
}

/**
 * Hard sporting eligibility for a senior permanent/free role.
 */
export function evaluateSportingFit(player, club, opts = {}) {
  const teamProfile =
    opts.teamProfile ||
    sportingProfileFromTeam(club, opts.worldState) || {
      overall: club.overall || 70,
      replacementOvr: {},
    };
  const seasonKey = String(opts.seasonIndex ?? player.seasons?.length ?? 0);
  const depth = abstractDepthChart(club.clubId || club.name, player.position, seasonKey);
  const scout = assessPlayerForClub(player, club, opts);
  const projection = projectRole(scout.assessedReadiness, teamProfile, player.position, depth);
  const elite = isEliteClub(club, teamProfile);

  const age = Number(player.age) || 20;
  let pathway = "senior";
  let eligible = projection.role !== "ineligible" && projection.role !== "prospect";

  // Prospect pathway — separate gate for elite / large readiness gap.
  const prospectQualified =
    age <= PROSPECT_PATHWAY.maxAge &&
    scout.assessedUpside >= PROSPECT_PATHWAY.minAssessedUpside &&
    projection.gap >= -PROSPECT_PATHWAY.maxReadinessGap &&
    (projection.role === "prospect" || projection.role === "cover") &&
    (depth.strategy === "develop" || elite);

  // First-pro / development: non-elite clubs may take ordinary young players as prospects
  // without requiring exceptional scouted upside (elite still needs the full gate).
  const relaxedDevelopment =
    Boolean(opts.relaxedDevelopment) &&
    age <= PROSPECT_PATHWAY.maxAge + 1 &&
    !elite &&
    projection.gap >= -PROSPECT_PATHWAY.maxReadinessGap &&
    (projection.role === "prospect" || projection.role === "cover" || projection.role === "ineligible");

  if (!eligible && (prospectQualified || relaxedDevelopment)) {
    eligible = true;
    pathway = "prospect";
    projection.role = "prospect";
  }

  // Ordinary players must never get elite SENIOR offers without genuine readiness.
  if (elite && pathway === "senior") {
    const readyForEliteSenior =
      scout.assessedReadiness >= teamProfile.overall - 4 &&
      (projection.role === "starter" || projection.role === "rotation");
    if (!readyForEliteSenior) {
      if (prospectQualified) {
        pathway = "prospect";
        projection.role = "prospect";
      } else {
        eligible = false;
      }
    }
  }

  if (elite && pathway === "senior" && projection.role === "cover") {
    eligible = false;
  }

  // Hard floor: assessed readiness below 70 cannot be elite senior.
  if (elite && pathway === "senior" && scout.assessedReadiness < 70) {
    eligible = false;
  }

  // Academy parent: always allow a development/first-pro look if within prospect gap.
  if (opts.forceParent && projection.gap >= -PROSPECT_PATHWAY.maxReadinessGap - 2) {
    eligible = true;
    if (projection.role === "ineligible" || projection.role === "prospect") {
      projection.role = "prospect";
      pathway = "prospect";
    }
  }

  return {
    eligible,
    pathway,
    projection,
    scout,
    depth,
    teamOverall: teamProfile.overall,
    elite,
    reasons: eligible ? [] : ["sporting-fit-failed"],
  };
}

/**
 * Weight among already-qualified candidates (reach / familiarity).
 * National-team strength is NOT used.
 */
export function recruitmentWeight(player, club, fit, opts = {}) {
  let w = 1;
  const nation = player.nationality || player.club?.nation;
  if (club.nation && nation && club.nation === nation) w += 1.4;
  if (club.league === player.club?.league) w += 1.1;
  if (club.leagueId === player.club?.leagueId) w += 0.5;
  if (fit.depth.vacancy) w += 0.8;
  if (fit.pathway === "prospect") w *= 0.35;
  if (fit.projection.role === "starter") w += 0.6;
  if (fit.projection.role === "cover") w += 0.2;
  // Prefer closer sporting level for ordinary players
  const gap = Math.abs((fit.scout.assessedReadiness || 60) - (fit.teamOverall || 70));
  w *= clamp(1.4 - gap / 25, 0.25, 1.4);
  if (opts.preferLowerDivisions && (club.divisionLevel || 1) > 1) w += 0.4;
  return Math.max(0.05, w);
}

/**
 * Filter all senior clubs to sporting-eligible candidates.
 */
export function findEligibleClubs(player, clubs, opts = {}) {
  const eligible = [];
  for (const club of clubs) {
    if (!club || club.isAcademy) continue;
    if (club.name === player.club?.name && !opts.allowCurrentClub) continue;
    const fit = evaluateSportingFit(player, club, {
      ...opts,
      relaxedDevelopment: opts.relaxedDevelopment || opts.dealType === "loan" || opts.dealType === "first_pro",
    });
    if (!fit.eligible) continue;
    if (fit.pathway === "prospect" && fit.elite) {
      const rng = createStreamRng(
        opts.careerId || player.careerId || player.name,
        `prospect-roll:${club.clubId}:${opts.seasonIndex ?? 0}`
      );
      if (!opts.skipProspectProbability && !rng.chance(PROSPECT_PATHWAY.offerProbability)) {
        continue;
      }
    }
    eligible.push({
      club,
      fit,
      weight: recruitmentWeight(player, club, fit, opts),
    });
  }
  return eligible;
}

export function pickWeighted(candidates, rng, count) {
  const pool = [...candidates];
  const picked = [];
  while (picked.length < count && pool.length) {
    const total = pool.reduce((s, c) => s + c.weight, 0);
    let roll = rng.random() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      roll -= pool[idx].weight;
      if (roll <= 0) break;
    }
    idx = Math.min(idx, pool.length - 1);
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picked;
}

/** Stable hash helper for tests / reports. */
export function recruitmentSeedToken(player, label) {
  return hashSeed(`${player.careerId || player.name}:${label}`);
}
