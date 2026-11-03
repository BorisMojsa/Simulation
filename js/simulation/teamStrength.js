import { clamp } from "../utils/helpers.js";
import { resolveClub, resolveNation } from "../data/identity/resolver.js";
import { tierLabelFromQuality } from "../data/strength/scale.js";

/**
 * Fix 10 lineup-impact model.
 * Role weights are unit-local shares (not a team-wide 1/11 diluted again by the
 * four-unit overall mean). Soft map keeps 90→99 separation without rewriting weak clubs.
 */
export const LINEUP_IMPACT_MODEL = Object.freeze({
  version: "fix10-lineup-impact-v1",
  saturationDenominator: 30,
  squadFactorBase: 1.16,
  squadFactorSlope: 1 / 80,
  squadFactorMin: 0.55,
  squadFactorMax: 1.3,
  unitBound: 12,
  overallBound: 6,
  /** Neutrality references for secondary attributes (equal → zero secondary contribution). */
  referenceAttributes: Object.freeze({
    Shooting: 65,
    Passing: 65,
    Defending: 65,
    Reflexes: 65,
    Handling: 65,
    Positioning: 65,
  }),
});

const ATTACK_POS = new Set(["ST", "CF", "RW", "LW"]);
const CREATE_POS = new Set(["CAM", "CM", "RM", "LM"]);
const DEFEND_POS = new Set(["CB", "RB", "LB", "CDM"]);

/** Unit-local role weights. Primary channel dominates; cross-effects are intentional. */
const ROLE_UNIT_WEIGHTS = Object.freeze({
  ST: Object.freeze({ attack: 0.34, midfield: 0.08, defence: 0, goalkeeper: 0 }),
  CF: Object.freeze({ attack: 0.32, midfield: 0.1, defence: 0, goalkeeper: 0 }),
  RW: Object.freeze({ attack: 0.3, midfield: 0.12, defence: 0, goalkeeper: 0 }),
  LW: Object.freeze({ attack: 0.3, midfield: 0.12, defence: 0, goalkeeper: 0 }),
  CAM: Object.freeze({ attack: 0.16, midfield: 0.34, defence: 0.04, goalkeeper: 0 }),
  CM: Object.freeze({ attack: 0.11, midfield: 0.36, defence: 0.1, goalkeeper: 0 }),
  RM: Object.freeze({ attack: 0.12, midfield: 0.32, defence: 0.06, goalkeeper: 0 }),
  LM: Object.freeze({ attack: 0.12, midfield: 0.32, defence: 0.06, goalkeeper: 0 }),
  CDM: Object.freeze({ attack: 0.04, midfield: 0.28, defence: 0.28, goalkeeper: 0 }),
  CB: Object.freeze({ attack: 0, midfield: 0.07, defence: 0.38, goalkeeper: 0.05 }),
  RB: Object.freeze({ attack: 0.04, midfield: 0.12, defence: 0.32, goalkeeper: 0.02 }),
  LB: Object.freeze({ attack: 0.04, midfield: 0.12, defence: 0.32, goalkeeper: 0.02 }),
  GK: Object.freeze({ attack: 0, midfield: 0, defence: 0.1, goalkeeper: 0.48 }),
});

function emptyImpact() {
  return { attack: 0, midfield: 0, defence: 0, goalkeeper: 0, deltaOvr: 0 };
}

function finiteNumber(value, fallback = null) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roleWeights(pos) {
  if (ROLE_UNIT_WEIGHTS[pos]) return ROLE_UNIT_WEIGHTS[pos];
  if (ATTACK_POS.has(pos)) return ROLE_UNIT_WEIGHTS.ST;
  if (CREATE_POS.has(pos)) return ROLE_UNIT_WEIGHTS.CM;
  if (DEFEND_POS.has(pos)) return ROLE_UNIT_WEIGHTS.CB;
  return ROLE_UNIT_WEIGHTS.CM;
}

function softSaturate(delta) {
  const den = LINEUP_IMPACT_MODEL.saturationDenominator;
  return delta / (1 + Math.abs(delta) / den);
}

function squadFactor(overall) {
  const q = finiteNumber(overall, 70);
  return clamp(
    LINEUP_IMPACT_MODEL.squadFactorBase - (q - 70) * LINEUP_IMPACT_MODEL.squadFactorSlope,
    LINEUP_IMPACT_MODEL.squadFactorMin,
    LINEUP_IMPACT_MODEL.squadFactorMax
  );
}

function playerAbility(player) {
  const raw = finiteNumber(player?.currentOverallRaw, null);
  if (raw != null) return raw;
  const cur = finiteNumber(player?.currentOverall, null);
  if (cur != null) return cur;
  const rating = finiteNumber(player?.rating, null);
  return rating != null ? rating : 60;
}

function secondaryAttributeContribution(player, minuteShare, xiShare) {
  const attrs = player?.attributes && typeof player.attributes === "object" ? player.attributes : {};
  const ref = LINEUP_IMPACT_MODEL.referenceAttributes;
  const pos = player?.position || "CM";
  let attack = 0;
  let midfield = 0;
  let defence = 0;
  let goalkeeper = 0;

  if (pos === "GK") {
    const reflexes = finiteNumber(attrs.Reflexes, null);
    const handling = finiteNumber(attrs.Handling, null);
    const positioning = finiteNumber(attrs.Positioning, null);
    if (reflexes != null) goalkeeper += ((reflexes - ref.Reflexes) / 200) * xiShare;
    if (handling != null) goalkeeper += ((handling - ref.Handling) / 240) * xiShare;
    if (positioning != null) defence += ((positioning - ref.Positioning) / 260) * xiShare;
  } else {
    const shooting = finiteNumber(attrs.Shooting, null);
    const passing = finiteNumber(attrs.Passing, null);
    const defending = finiteNumber(attrs.Defending, null);
    if (shooting != null) attack += ((shooting - ref.Shooting) / 220) * xiShare;
    if (passing != null) midfield += ((passing - ref.Passing) / 240) * xiShare;
    if (defending != null) defence += ((defending - ref.Defending) / 220) * xiShare;
  }

  return {
    attack: attack * minuteShare,
    midfield: midfield * minuteShare,
    defence: defence * minuteShare,
    goalkeeper: goalkeeper * minuteShare,
  };
}

/**
 * Build a sporting profile snapshot for a club or nation team object.
 * Prefers mutable career profile fields when present.
 */
export function sportingProfileFromTeam(team, worldState = null) {
  if (!team || team.isBye) return null;

  if (team.isNation || team.nationId) {
    const id = team.nationId || team.name;
    const mutable = worldState?.nations?.get?.(id) || worldState?.nations?.[id];
    if (mutable) return { ...mutable, kind: "nation" };
    const r = resolveNation(team.name || id);
    if (!r.ok) {
      console.warn(r.diagnostic || "unresolved nation", team);
      return fallbackNation(team);
    }
    return { ...r.profile, kind: "nation" };
  }

  const clubId = team.clubId || null;
  if (worldState?.clubs) {
    const mutable =
      (clubId && (worldState.clubs.get?.(clubId) || worldState.clubs[clubId])) ||
      null;
    if (mutable) return { ...mutable, kind: "club" };
  }

  // Academy sides inherit the senior club's sporting profile (no separate academy ratings).
  const resolveTarget =
    team.isAcademy && (team.parentClub?.name || team.parentClub?.clubId)
      ? team.parentClub
      : team;

  const r = resolveClub(resolveTarget);
  if (!r.ok) {
    // Academies without a resolvable parent are expected; skip noisy console spam.
    if (!team.isAcademy) {
      console.warn(r.diagnostic || "unresolved club", team);
    }
    return fallbackClub(team);
  }

  const seed = r.profile;
  if (worldState?.clubs) {
    const mutable = worldState.clubs.get?.(seed.clubId) || worldState.clubs[seed.clubId];
    if (mutable) return { ...mutable, kind: "club" };
  }
  return { ...seed, kind: "club" };
}

function fallbackClub(team) {
  const overall = 62;
  return {
    clubId: team.clubId || `club:fallback:${team.name}`,
    name: team.name,
    displayName: team.displayName ?? team.name,
    overall,
    attack: overall,
    midfield: overall,
    defence: overall,
    goalkeeper: overall,
    replacementOvr: defaultReplacement(overall),
    depth: overall - 6,
    financialPower: team.financialTier ?? 2,
    reputation: overall,
    sourceType: "runtime_fallback",
    confidence: "none",
    componentDerivationStatus: "derived_neutral",
    breakdownMethod: "neutral_equal_split_v1",
    kind: "club",
  };
}

function fallbackNation(team) {
  const overall = 65;
  return {
    nationId: team.nationId || `nation:fallback:${team.name}`,
    name: team.name,
    displayName: team.displayName ?? team.name,
    overall,
    attack: overall,
    midfield: overall,
    defence: overall,
    goalkeeper: overall,
    replacementOvr: defaultReplacement(overall),
    depth: overall - 5,
    kind: "nation",
    sourceType: "runtime_fallback",
    componentDerivationStatus: "derived_neutral",
    breakdownMethod: "neutral_equal_split_v1",
  };
}

function defaultReplacement(overall) {
  const b = Math.round(overall - 4);
  return {
    GK: b,
    CB: b,
    RB: b - 1,
    LB: b - 1,
    CDM: b,
    CM: b,
    CAM: b + 1,
    RM: b,
    LM: b,
    RW: b + 1,
    LW: b + 1,
    ST: b + 2,
  };
}

export function unitsAreEstimated(profile) {
  if (!profile) return true;
  const status = profile.componentDerivationStatus || profile.strengthDerivationStatus || "";
  const method = profile.breakdownMethod || "";
  return (
    status === "derived_neutral" ||
    method === "neutral_equal_split_v1" ||
    status.includes("neutral") ||
    method.includes("neutral")
  );
}

/**
 * Lineup contribution of the user player vs the normal replacement for that role.
 * Absent / not called up → zero. Underqualified → can reduce quality.
 *
 * Entire contribution vector (OVR channel + secondary attributes) is scaled by
 * minute share before rounding. Unit changes are bounded.
 */
export function playerLineupImpact(profile, player, { participates = true, minutes = 90, matchDuration = 90 } = {}) {
  const empty = emptyImpact();
  if (!participates || !player || !profile) return empty;

  const duration = Math.max(1, finiteNumber(matchDuration, 90));
  const played = finiteNumber(minutes, 0);
  if (played == null || played <= 0) return empty;
  const minuteShare = clamp(played / duration, 0, 1);
  if (minuteShare <= 0) return empty;

  const pos = player.position || "CM";
  const replacementRaw = profile.replacementOvr?.[pos];
  const replacement =
    finiteNumber(replacementRaw, null) ??
    finiteNumber(profile.overall, 70) - 4;
  const ability = playerAbility(player);
  const delta = ability - replacement;

  const sf = squadFactor(profile.overall);
  // Soft map of OVR gap; role weights are the unit share (avoid 1/11 then /4 dilution).
  const saturated = softSaturate(delta);
  const ovrScaled = saturated * sf * minuteShare;
  const weights = roleWeights(pos);

  // Secondary attributes use a small XI share so they cannot dominate the OVR channel.
  const attrShare = (1 / 11) * sf;
  const secondary = secondaryAttributeContribution(player, minuteShare, attrShare);

  let attack = ovrScaled * weights.attack + secondary.attack;
  let midfield = ovrScaled * weights.midfield + secondary.midfield;
  let defence = ovrScaled * weights.defence + secondary.defence;
  let goalkeeper = ovrScaled * weights.goalkeeper + secondary.goalkeeper;

  const bound = LINEUP_IMPACT_MODEL.unitBound;
  attack = clamp(attack, -bound, bound);
  midfield = clamp(midfield, -bound, bound);
  defence = clamp(defence, -bound, bound);
  goalkeeper = clamp(goalkeeper, -bound, bound);

  // Attempted overall lift before four-unit averaging (diagnostic only).
  const attemptedOverall = (attack + midfield + defence + goalkeeper) / 4;

  return {
    attack: Number(attack.toFixed(3)),
    midfield: Number(midfield.toFixed(3)),
    defence: Number(defence.toFixed(3)),
    goalkeeper: Number(goalkeeper.toFixed(3)),
    deltaOvr: Number(attemptedOverall.toFixed(3)),
    modelVersion: LINEUP_IMPACT_MODEL.version,
  };
}

/**
 * Rebuild effective strength for a later phase from immutable regulation inputs.
 * Removing player impact must not drop form or resolve against a later world.
 */
export function phaseEffectiveStrength(regulationEff, {
  player = null,
  playerSide = null,
  side = null,
  phaseMinutes = 0,
  phaseDuration = 30,
} = {}) {
  if (!regulationEff) {
    return {
      overall: 50,
      attack: 50,
      midfield: 50,
      defence: 50,
      goalkeeper: 50,
      profile: null,
      playerImpact: emptyImpact(),
      tierLabel: "Average",
      formAdj: 0,
    };
  }

  const profile = regulationEff.profile;
  const form = clamp(finiteNumber(regulationEff.formAdj, 0) ?? 0, -2.5, 2.5);
  const participates =
    Boolean(player) &&
    Boolean(playerSide) &&
    Boolean(side) &&
    playerSide === side &&
    finiteNumber(phaseMinutes, 0) > 0;

  const impact = playerLineupImpact(profile, player, {
    participates,
    minutes: phaseMinutes,
    matchDuration: phaseDuration,
  });

  if (!profile) {
    return {
      ...regulationEff,
      playerImpact: impact,
      formAdj: form,
    };
  }

  const attack = clamp(profile.attack + impact.attack + form * 0.35, 25, 99);
  const midfield = clamp(profile.midfield + impact.midfield + form * 0.4, 25, 99);
  const defence = clamp(profile.defence + impact.defence + form * 0.3, 25, 99);
  const goalkeeper = clamp(profile.goalkeeper + impact.goalkeeper + form * 0.2, 25, 99);
  const overall = clamp((attack + midfield + defence + goalkeeper) / 4, 25, 99);

  return {
    clubId: regulationEff.clubId ?? profile.clubId ?? null,
    nationId: regulationEff.nationId ?? profile.nationId ?? null,
    name: regulationEff.name ?? profile.name,
    displayName: regulationEff.displayName ?? profile.displayName ?? profile.name,
    overall: Number(overall.toFixed(2)),
    attack: Number(attack.toFixed(2)),
    midfield: Number(midfield.toFixed(2)),
    defence: Number(defence.toFixed(2)),
    goalkeeper: Number(goalkeeper.toFixed(2)),
    financialPower: regulationEff.financialPower ?? profile.financialPower,
    reputation: regulationEff.reputation ?? profile.reputation ?? overall,
    profile,
    playerImpact: impact,
    formAdj: form,
    tierLabel: tierLabelFromQuality(overall),
    phase: "extraTime",
  };
}

/**
 * Effective team qualities for a match side.
 * formAdj / venue applied by caller or here via options.
 */
export function effectiveTeamStrength(team, {
  player = null,
  playerSide = null,
  side = null,
  worldState = null,
  formAdj = 0,
  playerMinutes = null,
  matchDuration = 90,
} = {}) {
  const profile = sportingProfileFromTeam(team, worldState);
  if (!profile) {
    return {
      overall: 50,
      attack: 50,
      midfield: 50,
      defence: 50,
      goalkeeper: 50,
      profile: null,
      playerImpact: playerLineupImpact(null, null),
      tierLabel: "Average",
      formAdj: 0,
      unitsEstimated: true,
    };
  }

  const minutes =
    playerMinutes != null
      ? finiteNumber(playerMinutes, 0)
      : player?.matchParticipation?.minutes != null
        ? finiteNumber(player.matchParticipation.minutes, 0)
        : 90;

  const participates =
    Boolean(player) &&
    Boolean(playerSide) &&
    Boolean(side) &&
    playerSide === side &&
    minutes > 0;

  const impact = playerLineupImpact(profile, player, {
    participates,
    minutes,
    matchDuration,
  });
  const form = clamp(finiteNumber(formAdj, 0) ?? 0, -2.5, 2.5);

  const attack = clamp(profile.attack + impact.attack + form * 0.35, 25, 99);
  const midfield = clamp(profile.midfield + impact.midfield + form * 0.4, 25, 99);
  const defence = clamp(profile.defence + impact.defence + form * 0.3, 25, 99);
  const goalkeeper = clamp(profile.goalkeeper + impact.goalkeeper + form * 0.2, 25, 99);
  const overall = clamp(
    (attack + midfield + defence + goalkeeper) / 4,
    25,
    99
  );

  return {
    clubId: profile.clubId || null,
    nationId: profile.nationId || null,
    name: profile.name,
    displayName: profile.displayName ?? profile.name,
    overall: Number(overall.toFixed(2)),
    attack: Number(attack.toFixed(2)),
    midfield: Number(midfield.toFixed(2)),
    defence: Number(defence.toFixed(2)),
    goalkeeper: Number(goalkeeper.toFixed(2)),
    financialPower: profile.financialPower ?? team.financialTier ?? 2,
    reputation: profile.reputation ?? overall,
    profile,
    playerImpact: impact,
    formAdj: form,
    tierLabel: tierLabelFromQuality(overall),
    unitsEstimated: unitsAreEstimated(profile),
    componentDerivationStatus: profile.componentDerivationStatus || null,
    breakdownMethod: profile.breakdownMethod || null,
    lineupImpactModelVersion: LINEUP_IMPACT_MODEL.version,
  };
}

export function describeTeamStrength(team, worldState = null) {
  const eff = effectiveTeamStrength(team, { worldState });
  const estimated = eff.unitsEstimated === true || unitsAreEstimated(eff.profile);
  return {
    overall: eff.overall,
    attack: eff.attack,
    midfield: eff.midfield,
    defence: eff.defence,
    goalkeeper: eff.goalkeeper,
    tierLabel: eff.tierLabel,
    sourceType: eff.profile?.sourceStatus || eff.profile?.sourceType,
    snapshotDate: eff.profile?.publicationDate || eff.profile?.snapshotDate,
    sourceStatus: eff.profile?.sourceStatus,
    unitsEstimated: estimated,
    unitRatingsLabel: estimated ? "Estimated unit ratings" : "Unit ratings",
    componentDerivationStatus: eff.componentDerivationStatus,
    breakdownMethod: eff.breakdownMethod,
    lineupImpactModelVersion: eff.lineupImpactModelVersion || LINEUP_IMPACT_MODEL.version,
  };
}
