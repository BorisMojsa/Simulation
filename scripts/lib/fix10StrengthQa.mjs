/**
 * Shared Fix 10 strength / superstar QA helpers.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { clamp } from "../../js/utils/helpers.js";
import {
  effectiveTeamStrength,
  playerLineupImpact,
  describeTeamStrength,
  LINEUP_IMPACT_MODEL,
  finiteNumber,
  profileUnit,
} from "../../js/simulation/teamStrength.js";
import { expectedGoals, XG_MODEL, simulateMatch, resolveKnockout } from "../../js/simulation/matchEngine.js";
import { createRng } from "../../js/simulation/rng.js";
import { CLUB_PROFILES } from "../../js/data/identity/resolver.js";
import { NATION_PROFILES } from "../../js/data/strength/nationProfiles.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

export const TARGETS = JSON.parse(
  readFileSync(join(ROOT, "qa/fix10-runs/calibration-targets.json"), "utf8")
);

export const ROLE_REF_OFFSET = Object.freeze({ ST: 2, CM: 4, CB: 4, GK: 5 });
export const NEUTRAL_ATTRS = Object.freeze({ ...TARGETS.controls.neutralAttributes });

export function roleReference(quality, role) {
  return quality - ROLE_REF_OFFSET[role];
}

export function synthProfile(quality, { clubId = null, asymmetric = null } = {}) {
  const id = clubId || `club:synth:q${quality}`;
  const units = asymmetric || {
    attack: quality,
    midfield: quality,
    defence: quality,
    goalkeeper: quality,
  };
  return {
    clubId: id,
    name: `Synth Q${quality}`,
    displayName: `Synth Q${quality}`,
    overall: quality,
    attack: units.attack,
    midfield: units.midfield,
    defence: units.defence,
    goalkeeper: units.goalkeeper,
    replacementOvr: {
      GK: quality - 5,
      CB: quality - 4,
      RB: quality - 5,
      LB: quality - 5,
      CDM: quality - 4,
      CM: quality - 4,
      CAM: quality - 3,
      RM: quality - 4,
      LM: quality - 4,
      RW: quality - 1,
      LW: quality - 1,
      ST: quality - 2,
      CF: quality - 2,
    },
    depth: quality - 6,
    financialPower: 2,
    reputation: quality,
    componentDerivationStatus: asymmetric ? "controlled_asymmetric_fixture" : "derived_neutral",
    breakdownMethod: asymmetric ? "controlled_asymmetric_fixture" : "neutral_equal_split_v1",
    sourceStatus: "controlled_fixture",
    sourceType: "controlled_fixture",
  };
}

export function worldWithProfiles(profiles) {
  const clubs = new Map();
  for (const p of profiles) clubs.set(p.clubId, { ...p, replacementOvr: { ...p.replacementOvr } });
  return { clubs, nations: new Map(), form: new Map() };
}

export function teamRef(profile) {
  return { name: profile.name, clubId: profile.clubId };
}

export function makePlayer({
  position = "ST",
  ovr,
  minutes = 90,
  attributes = NEUTRAL_ATTRS,
  side = "home",
} = {}) {
  const attrs = { ...attributes };
  return {
    name: `QA ${position} ${ovr}`,
    position,
    currentOverallRaw: ovr,
    currentOverall: ovr,
    rating: ovr,
    attributes: attrs,
    matchParticipation: { minutes, matchDuration: 90, started: minutes >= 45 },
    _qaSide: side,
  };
}

export function poissonPmf(lambda, k) {
  const L = Math.max(0, lambda);
  let p = Math.exp(-L);
  for (let i = 1; i <= k; i += 1) p *= L / i;
  return p;
}

export function analyticMatchProbs(homeLambda, awayLambda, maxGoals = TARGETS.poisson.maxGoals) {
  let pWin = 0;
  let pDraw = 0;
  let pLoss = 0;
  for (let i = 0; i <= maxGoals; i += 1) {
    for (let j = 0; j <= maxGoals; j += 1) {
      const p = poissonPmf(homeLambda, i) * poissonPmf(awayLambda, j);
      if (i > j) pWin += p;
      else if (i === j) pDraw += p;
      else pLoss += p;
    }
  }
  const sum = pWin + pDraw + pLoss;
  return {
    pWin,
    pDraw,
    pLoss,
    sum,
    expectedPoints: 3 * pWin + pDraw,
  };
}

export function evaluatePlayerImpact({
  quality,
  role,
  ovr,
  minutes = 90,
  venue = "neutral",
  asymmetric = null,
  attributes = NEUTRAL_ATTRS,
} = {}) {
  const profile = synthProfile(quality, { asymmetric });
  const world = worldWithProfiles([profile]);
  const team = teamRef(profile);
  const player = makePlayer({ position: role, ovr, minutes, attributes });
  const base = effectiveTeamStrength(team, { worldState: world });
  const withPlayer = effectiveTeamStrength(team, {
    worldState: world,
    player,
    playerSide: "home",
    side: "home",
    playerMinutes: minutes,
    matchDuration: 90,
  });
  const opp = effectiveTeamStrength(team, { worldState: world });
  const x0 = expectedGoals(base, opp, { venue });
  const x1 = expectedGoals(withPlayer, opp, { venue });
  const probs0 = analyticMatchProbs(x0.home, x0.away);
  const probs1 = analyticMatchProbs(x1.home, x1.away);
  return {
    quality,
    role,
    ovr,
    minutes,
    venue,
    abilityRead: withPlayer.playerImpact ? ovr : null,
    base,
    withPlayer,
    x0,
    x1,
    ownXgPct: x0.home > 0 ? (x1.home / x0.home - 1) * 100 : 0,
    oppXgPct: x0.away > 0 ? (x1.away / x0.away - 1) * 100 : 0,
    dEp: probs1.expectedPoints - probs0.expectedPoints,
    dAttack: withPlayer.attack - base.attack,
    dMidfield: withPlayer.midfield - base.midfield,
    dDefence: withPlayer.defence - base.defence,
    dGoalkeeper: withPlayer.goalkeeper - base.goalkeeper,
    dOverall: withPlayer.overall - base.overall,
    probs0,
    probs1,
    playerImpact: withPlayer.playerImpact,
  };
}

export function inventorySummary() {
  const supplement = CLUB_PROFILES.filter(
    (p) =>
      p.sourceType === "afc_caf_supplement" ||
      p.provider === "afc_caf_supplement" ||
      String(p.calibrationId || "").includes("afc") ||
      String(p.sourceSnapshotId || "").includes("afc-caf")
  );
  // Supplement profiles are tagged in resolver merge; fall back to count delta vs 490.
  const runtime = CLUB_PROFILES.length;
  const estimatedUnits = CLUB_PROFILES.filter(
    (p) =>
      p.componentDerivationStatus === "derived_neutral" ||
      p.breakdownMethod === "neutral_equal_split_v1"
  ).length;
  return {
    runtimeClubs: runtime,
    nationProfiles: NATION_PROFILES.length,
    estimatedUnitClubs: estimatedUnits,
    xgModel: { ...XG_MODEL },
    lineupImpactModel: { ...LINEUP_IMPACT_MODEL },
  };
}

export function assertContractRow(row, targets = TARGETS) {
  const fails = [];
  const { role, quality } = row;
  if (role === "ST") {
    if (row.ownXgPct < targets.acceptance.stOwnXgPctRise.min || row.ownXgPct > targets.acceptance.stOwnXgPctRise.max) {
      fails.push(`ST own xG% ${row.ownXgPct}`);
    }
    if (Math.abs(row.dDefence) > 1e-9 || Math.abs(row.dGoalkeeper) > 1e-9) fails.push("ST leaked DEF/GK");
  }
  if (role === "GK") {
    const fall = -row.oppXgPct;
    if (fall < targets.acceptance.gkOppXgPctFall.min || fall > targets.acceptance.gkOppXgPctFall.max) {
      fails.push(`GK opp xG fall% ${fall}`);
    }
    if (Math.abs(row.dAttack) > 1e-9) fails.push("GK leaked ATK");
  }
  if (
    row.dEp < targets.acceptance.roleExpectedPointsGain.min ||
    row.dEp > targets.acceptance.roleExpectedPointsGain.max
  ) {
    fails.push(`EP ${row.dEp}`);
  }
  const unitMax = Math.max(
    Math.abs(row.dAttack),
    Math.abs(row.dMidfield),
    Math.abs(row.dDefence),
    Math.abs(row.dGoalkeeper)
  );
  if (unitMax > targets.acceptance.unitAbsChangeMax + 1e-9) fails.push(`unit ${unitMax}`);
  if (Math.abs(row.dOverall) > targets.acceptance.effectiveOverallAbsChangeMax + 1e-9) {
    fails.push(`overall ${row.dOverall}`);
  }
  if (row.probs0.sum < 1 - targets.poisson.tailTolerance) fails.push("prob sum");
  return fails;
}

export {
  effectiveTeamStrength,
  playerLineupImpact,
  describeTeamStrength,
  expectedGoals,
  simulateMatch,
  resolveKnockout,
  createRng,
  CLUB_PROFILES,
  NATION_PROFILES,
  LINEUP_IMPACT_MODEL,
  XG_MODEL,
  clamp,
  ROOT,
  finiteNumber,
  profileUnit,
};
