/**
 * Dated playing-registration authority for club-match ownership.
 * Employment (employer) is separate; only playing registration authorizes club appearances.
 *
 * Stints are half-open [from, to): effective on `from`, closed at `to` (exclusive).
 *
 * Tip helpers are inlined (not imported from contractLifecycle) to avoid circular imports.
 */

export const PLAYING_REGISTRATION_VERSION = 1;

function tipPlayingClubId(player) {
  return player?.playingClubId || player?.club?.clubId || null;
}

function tipEmploymentClubId(player) {
  return (
    player?.employmentClubId ||
    player?.parentClubSnapshot?.clubId ||
    (player?.activeLoan?.status === "active" ? player.activeLoan.parentClubId : null) ||
    (player?.club && !player.club.isLoanSpell ? player.club.clubId : null) ||
    null
  );
}

function clubIdOf(side) {
  if (!side || side.isBye) return null;
  return side.clubId || null;
}

function dateKey(d) {
  return d == null ? null : String(d);
}

/** Ensure playingStints exists; seed one open stint from live IDs when missing. */
export function ensurePlayingStints(player, { asOfDate = null } = {}) {
  if (!player || typeof player !== "object") return player;
  if (!Array.isArray(player.playingStints)) player.playingStints = [];

  if (player.playingStints.length === 0) {
    const playingId = tipPlayingClubId(player);
    if (playingId) {
      player.playingStints.push({
        stintId: `stint:seed:${player.careerId || player.name || "p"}:${playingId}`,
        from: asOfDate || `${player.startYear || 2026}-07-01`,
        to: null,
        playingClubId: playingId,
        employmentClubId: tipEmploymentClubId(player) || playingId,
        leagueId: player.club?.leagueId || null,
        clubName: player.club?.name || null,
        kind: "seed",
        onLoan: Boolean(player.activeLoan?.status === "active" || player.club?.isLoanSpell),
      });
    }
  }
  player.playingRegistrationVersion = PLAYING_REGISTRATION_VERSION;
  return player;
}

function openStint(player) {
  const list = player.playingStints || [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i] && list[i].to == null) return list[i];
  }
  return null;
}

/**
 * Close any open stint at `atDate` (exclusive end) and optionally open a new one.
 * When `playingClubId` is null, leaves a registration gap (no club appearances).
 */
export function recordPlayingTransition(
  player,
  {
    effectiveDate,
    playingClubId = null,
    employmentClubId = null,
    leagueId = null,
    clubName = null,
    kind = "permanent",
    onLoan = false,
    closePriorAt = null,
  } = {}
) {
  if (!player) return null;
  ensurePlayingStints(player, { asOfDate: effectiveDate });
  const from = dateKey(effectiveDate);
  if (!from) return null;

  const closeAt = dateKey(closePriorAt) || from;
  const prior = openStint(player);
  if (prior) {
    // Do not rewrite earlier matches: close at the transition boundary.
    if (!prior.to || String(prior.to) > closeAt) {
      prior.to = closeAt;
    }
  }

  if (!playingClubId) {
    return { closed: prior || null, opened: null };
  }

  // Avoid duplicate open stint for the same club/date.
  const last = player.playingStints[player.playingStints.length - 1];
  if (
    last &&
    last.playingClubId === playingClubId &&
    last.from === from &&
    last.to == null &&
    Boolean(last.onLoan) === Boolean(onLoan)
  ) {
    return { closed: prior || null, opened: last };
  }

  const stint = {
    stintId: `stint:${kind}:${player.careerId || player.name || "p"}:${playingClubId}:${from}:${player.playingStints.length}`,
    from,
    to: null,
    playingClubId,
    employmentClubId: employmentClubId || tipEmploymentClubId(player) || playingClubId,
    leagueId: leagueId || player.club?.leagueId || null,
    clubName: clubName || player.club?.name || null,
    kind,
    onLoan: Boolean(onLoan),
  };
  player.playingStints.push(stint);
  return { closed: prior || null, opened: stint };
}

/**
 * Playing club ID valid on `date` (inclusive of stint.from, exclusive of stint.to).
 * Falls back to live tip only when no stints exist after ensure.
 */
export function resolvePlayingClubAt(player, date) {
  if (!player) return null;
  ensurePlayingStints(player, { asOfDate: date });
  const d = dateKey(date);
  if (!d) return tipPlayingClubId(player);

  const stints = player.playingStints || [];
  for (let i = stints.length - 1; i >= 0; i--) {
    const s = stints[i];
    if (!s?.playingClubId) continue;
    if (String(s.from) > d) continue;
    if (s.to != null && String(s.to) <= d) continue;
    return s.playingClubId;
  }
  return null;
}

export function resolvePlayingStintAt(player, date) {
  if (!player) return null;
  ensurePlayingStints(player, { asOfDate: date });
  const d = dateKey(date);
  if (!d) return openStint(player);
  const stints = player.playingStints || [];
  for (let i = stints.length - 1; i >= 0; i--) {
    const s = stints[i];
    if (!s?.playingClubId) continue;
    if (String(s.from) > d) continue;
    if (s.to != null && String(s.to) <= d) continue;
    return s;
  }
  return null;
}

/**
 * Domestic pending-registration gate (destination not yet eligible).
 */
export function isPendingRegistrationBlocking(player, date) {
  const pending = player?.pendingRegistration?.effectiveDate;
  if (!pending) return false;
  return String(date) < String(pending);
}

/**
 * Validate which fixture side the user may represent on `date`.
 * National teamType bypasses club registration.
 * @returns {"home"|"away"|null}
 */
export function resolveValidatedClubSide({
  player,
  home,
  away,
  date,
  teamType = "club",
} = {}) {
  if (!player) return null;
  if (teamType === "national") {
    // National identity is not club registration — callers supply side separately.
    return null;
  }
  if (isPendingRegistrationBlocking(player, date)) return null;

  const playingId = resolvePlayingClubAt(player, date);
  if (!playingId) return null;

  const homeId = clubIdOf(home);
  const awayId = clubIdOf(away);
  if (homeId && homeId === playingId) return "home";
  if (awayId && awayId === playingId) return "away";

  // Name fallback only when both sides lack clubId (legacy fixtures) and tip name matches.
  if (!homeId && !awayId) {
    const name = player.club?.name;
    if (name && home?.name === name) return "home";
    if (name && away?.name === name) return "away";
  }
  return null;
}

/**
 * Whether the player is entitled to a club honor for `winningClubId`.
 * Requires a dated stint for that club overlapping the competition window
 * and at least one positive-minute observation for that club (when ledger provided).
 */
export function playerEntitledToClubHonor(player, {
  winningClubId,
  competitionId = null,
  ledgerRecords = null,
  playerMatches = null,
  requireContribution = true,
} = {}) {
  if (!player || !winningClubId) return false;
  const stints = player.playingStints || [];
  const hadStint = stints.some((s) => s.playingClubId === winningClubId);
  if (!hadStint && tipPlayingClubId(player) !== winningClubId) return false;

  if (!requireContribution) return hadStint || tipPlayingClubId(player) === winningClubId;

  if (Array.isArray(ledgerRecords)) {
    const hit = ledgerRecords.some(
      (r) =>
        r &&
        Number(r.minutes) > 0 &&
        r.teamId === winningClubId &&
        (!competitionId || r.competitionId === competitionId)
    );
    if (hit) return true;
  }
  if (Array.isArray(playerMatches)) {
    const hit = playerMatches.some((m) => {
      const mins = m?.playerStats?.minutes ?? m?.minutes ?? 0;
      if (!(mins > 0)) return false;
      const sideClub =
        m.playerSide === "home"
          ? m.home?.clubId
          : m.playerSide === "away"
            ? m.away?.clubId
            : m.playerClubId || m.teamId;
      return sideClub === winningClubId;
    });
    if (hit) return true;
  }
  return false;
}

/** Season-evidence shape from playing stints. */
export function playingStintsForEvidence(player) {
  ensurePlayingStints(player);
  return (player.playingStints || []).map((s) => ({
    clubId: s.playingClubId,
    playingClubId: s.playingClubId,
    clubName: s.clubName,
    leagueId: s.leagueId,
    onLoan: Boolean(s.onLoan),
    from: s.from,
    to: s.to,
    kind: s.kind,
    stintId: s.stintId,
    employmentClubId: s.employmentClubId,
  }));
}
