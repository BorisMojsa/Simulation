import { clamp } from "../utils/helpers.js";
import { resolveClub, resolveNation } from "../data/identity/resolver.js";
import { tierLabelFromQuality } from "../data/strength/scale.js";

const ATTACK_POS = new Set(["ST", "CF", "RW", "LW"]);
const CREATE_POS = new Set(["CAM", "CM", "RM", "LM"]);
const DEFEND_POS = new Set(["CB", "RB", "LB", "CDM"]);

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

/**
 * Lineup contribution of the user player vs the normal replacement for that role.
 * Absent / not called up → zero. Underqualified → can reduce quality.
 *
 * Sanity: +20 OVR vs 70-avg XI ≈ +1.8 on simple XI average (bounded here by role weights).
 */
export function playerLineupImpact(profile, player, { participates = true, minutes = 90, matchDuration = 90 } = {}) {
  const empty = { attack: 0, midfield: 0, defence: 0, goalkeeper: 0, deltaOvr: 0 };
  if (!participates || !player || !profile) return empty;

  const minuteShare = clamp((Number(minutes) || 0) / Math.max(1, Number(matchDuration) || 90), 0, 1);
  if (minuteShare <= 0) return empty;

  const pos = player.position || "CM";
  const replacement = profile.replacementOvr?.[pos] ?? profile.overall - 4;
  const ability =
    Number.isFinite(player.currentOverallRaw)
      ? player.currentOverallRaw
      : Number.isFinite(player.currentOverall)
        ? player.currentOverall
        : Number(player.rating) || 60;
  const delta = ability - replacement;

  // One of eleven; diminishing returns in already-strong squads.
  const squadFactor = clamp(1.15 - (profile.overall - 70) / 80, 0.55, 1.25);
  const xiShare = (1 / 11) * squadFactor;
  // Soft saturation so megastars don't rewrite weak clubs into elites.
  const saturated = Math.tanh(delta / 18) * 18;
  const scaled = saturated * xiShare * minuteShare;

  const impact = { ...empty, deltaOvr: Number(scaled.toFixed(3)) };

  if (pos === "GK") {
    impact.goalkeeper = scaled * 1.35;
    impact.defence = scaled * 0.25;
  } else if (DEFEND_POS.has(pos)) {
    impact.defence = scaled * 1.15;
    impact.midfield = scaled * (pos === "CDM" ? 0.35 : 0.15);
  } else if (CREATE_POS.has(pos)) {
    impact.midfield = scaled * 1.1;
    impact.attack = scaled * (pos === "CAM" ? 0.45 : 0.25);
    if (pos === "CDM" || pos === "CM") impact.defence = scaled * 0.2;
  } else if (ATTACK_POS.has(pos)) {
    impact.attack = scaled * 1.2;
    impact.midfield = scaled * 0.25;
  } else {
    impact.midfield = scaled * 0.8;
    impact.attack = scaled * 0.3;
  }

  // Attribute support (secondary; OVR remains primary via delta).
  const attrs = player.attributes || {};
  if (attrs.Shooting) impact.attack += ((attrs.Shooting - 65) / 220) * xiShare;
  if (attrs.Passing) impact.midfield += ((attrs.Passing - 65) / 240) * xiShare;
  if (attrs.Defending) impact.defence += ((attrs.Defending - 65) / 220) * xiShare;

  return {
    attack: Number(impact.attack.toFixed(3)),
    midfield: Number(impact.midfield.toFixed(3)),
    defence: Number(impact.defence.toFixed(3)),
    goalkeeper: Number(impact.goalkeeper.toFixed(3)),
    deltaOvr: impact.deltaOvr,
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
    };
  }

  const minutes =
    playerMinutes != null
      ? Number(playerMinutes)
      : player?.matchParticipation?.minutes != null
        ? Number(player.matchParticipation.minutes)
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
  const form = clamp(formAdj, -2.5, 2.5);

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
  };
}

export function describeTeamStrength(team, worldState = null) {
  const eff = effectiveTeamStrength(team, { worldState });
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
  };
}
