/**
 * Pure competition playback contexts for the live dashboard.
 * Selectors accept a revealed-match visibility boundary; renderers never simulate.
 */

import {
  accountNationalTable,
  rankNationalGroup,
  rankBestThirds,
} from "./nationalTable.js";
import { rebuildTableFromMatches } from "./leagueTable.js";

function revealedSet(ids) {
  return ids instanceof Set ? ids : new Set(ids || []);
}

export function buildLeaguePlaybackContext({
  competitionId = "league",
  editionId = null,
  player,
  seedClubs,
  fixtures = [],
  ruleVersion = "league",
} = {}) {
  return {
    competitionId,
    editionId,
    participantType: "club",
    ruleVersion,
    playerParticipantId: player?.playingClubId || player?.club?.clubId || player?.club?.name,
    openingParticipantIds: (seedClubs || []).map((c) => c.clubId || c.name),
    fixtureIds: fixtures.map((f) => f.matchId || f.fixtureId).filter(Boolean),
    kickoffBatches: null,
    activeStageId: "league",
    activeGroupId: null,
    stageMode: "table",
    seedClubs,
    fixtures,
    getTableView(_scope, visibleIds) {
      const vis = revealedSet(visibleIds);
      const matches = fixtures.filter((m) => vis.has(m.matchId || m.fixtureId));
      const { table } = rebuildTableFromMatches(seedClubs, matches);
      return { kind: "league-table", table, bands: null };
    },
    getBracketView() {
      return null;
    },
    getOtherResults(_scope, visibleIds) {
      const vis = revealedSet(visibleIds);
      return fixtures.filter((m) => vis.has(m.matchId || m.fixtureId));
    },
  };
}

export function buildContinentalPlaybackContext({
  campaign,
  player,
  visibleStage = null,
} = {}) {
  const fixtures = [
    ...(campaign?.leaguePhase?.matches || []),
    ...(campaign?.playerMatches || []),
    ...(campaign?.allRounds || []).flatMap((r) => r.matches || []),
  ];
  const dedup = new Map();
  for (const f of fixtures) {
    const id = f.matchId || f.fixtureId;
    if (id) dedup.set(id, f);
  }
  const list = [...dedup.values()];
  const openingDone = Boolean(campaign?.leaguePhase?.complete || campaign?.groups);
  return {
    competitionId: campaign?.competitionId || "continental",
    editionId: campaign?.editionId || null,
    participantType: "club",
    ruleVersion: campaign?.ruleVersion || "continental",
    playerParticipantId: player?.playingClubId || player?.club?.clubId,
    openingParticipantIds: (campaign?.field || []).map((c) => c.clubId || c.name),
    fixtureIds: list.map((f) => f.matchId || f.fixtureId),
    activeStageId: visibleStage || campaign?.stageId || "opening",
    activeGroupId: null,
    stageMode: openingDone && (campaign?.allRounds?.length || campaign?.feederGraph) ? "bracket" : "table",
    campaign,
    fixtures: list,
    getTableView(_scope, visibleIds) {
      const vis = revealedSet(visibleIds);
      const matches = (campaign?.leaguePhase?.matches || []).filter((m) =>
        vis.has(m.matchId || m.fixtureId)
      );
      const seed = campaign?.field || [];
      const { table } = rebuildTableFromMatches(seed, matches);
      return {
        kind: "continental-table",
        table,
        bands: { direct: [1, 8], playoff: [9, 24], out: [25, 36] },
      };
    },
    getBracketView(visibleIds) {
      const vis = revealedSet(visibleIds);
      const rounds = (campaign?.allRounds || []).map((round) => ({
        ...round,
        matches: (round.matches || []).map((m) =>
          vis.has(m.matchId || m.fixtureId) ? m : { ...m, homeGoals: null, awayGoals: null, status: "scheduled", spoilerHidden: true }
        ),
      }));
      return { kind: "bracket", rounds };
    },
    getOtherResults(_scope, visibleIds) {
      const vis = revealedSet(visibleIds);
      return list.filter((m) => vis.has(m.matchId || m.fixtureId) && !m.playerSide);
    },
  };
}

export function buildNationalPlaybackContext({
  tournament,
  player,
  activeGroupId = null,
} = {}) {
  const groups = tournament?.groups || [];
  const playerNation = player?.nationality || tournament?.playerNation;
  const playerGroup =
    groups.find((g) => g.participants?.includes(playerNation)) ||
    groups.find((g) => g.table?.some((r) => r.name === playerNation)) ||
    groups[0];
  const groupId = activeGroupId || playerGroup?.groupId || playerGroup?.name?.replace(/^Group\s+/i, "") || null;
  const allGroupMatches = groups.flatMap((g) => g.matches || []);
  const koMatches = (tournament?.allRounds || []).flatMap((r) => r.matches || []);
  const fixtures = [...allGroupMatches, ...koMatches];
  const openingComplete = groups.every((g) => (g.matches || []).length >= 6 || g.finalized);
  const hasKo = Boolean(koMatches.length || tournament?.qualification?.finalized);

  return {
    competitionId: tournament?.competitionId || tournament?.id || "national",
    editionId: tournament?.editionId || null,
    participantType: "nation",
    ruleVersion: tournament?.ruleVersion || "national",
    playerParticipantId: playerNation,
    openingParticipantIds: (tournament?.field || []).slice(),
    fixtureIds: fixtures.map((f) => f.matchId || f.fixtureId).filter(Boolean),
    activeStageId: hasKo && openingComplete ? tournament?.stageId || "knockout" : "group",
    activeGroupId: groupId,
    stageMode: hasKo && openingComplete ? "bracket" : "table",
    tournament,
    groups,
    playerGroup,
    fixtures,
    getTableView(scope, visibleIds) {
      const vis = revealedSet(visibleIds);
      const gid = scope?.groupId || groupId;
      const group = groups.find((g) => g.groupId === gid || g.name === `Group ${gid}`) || playerGroup;
      if (!group) return { kind: "national-table", table: [], group: null };
      const matches = (group.matches || []).filter((m) => vis.has(m.matchId || m.fixtureId));
      const participants = (group.participants || []).map((n) => ({ name: n, groupId: group.groupId }));
      const { rows } = accountNationalTable(participants, matches, { groupId: group.groupId });
      const table = rankNationalGroup(tournament?.competitionId || tournament?.id, rows, matches);
      for (const row of table) {
        const live = group.table?.find((r) => r.name === row.name);
        if (live?.qualificationStatus && matches.length === (group.matches || []).length) {
          row.qualificationStatus = live.qualificationStatus;
          row.qualificationReason = live.qualificationReason;
        }
      }
      return { kind: "national-table", table, group, groupId: group.groupId };
    },
    getBestThirdsView(visibleIds) {
      const vis = revealedSet(visibleIds);
      const thirds = [];
      for (const g of groups) {
        const matches = (g.matches || []).filter((m) => vis.has(m.matchId || m.fixtureId));
        if (matches.length < (g.matches || []).length) continue;
        const third = g.table?.[2] || g.third;
        if (third) thirds.push({ ...third, groupId: g.groupId });
      }
      const ranked = rankBestThirds(tournament?.competitionId || tournament?.id, thirds);
      return { kind: "best-thirds", table: ranked };
    },
    getBracketView(visibleIds) {
      const vis = revealedSet(visibleIds);
      const rounds = (tournament?.allRounds || []).map((round) => ({
        ...round,
        matches: (round.matches || []).map((m) =>
          vis.has(m.matchId || m.fixtureId)
            ? m
            : {
                ...m,
                homeGoals: null,
                awayGoals: null,
                homePenalties: null,
                awayPenalties: null,
                winnerSide: null,
                status: "scheduled",
                spoilerHidden: true,
              }
        ),
      }));
      return { kind: "bracket", rounds };
    },
    getOtherResults(scope, visibleIds) {
      const vis = revealedSet(visibleIds);
      const gid = scope?.groupId || groupId;
      return allGroupMatches.filter(
        (m) =>
          vis.has(m.matchId || m.fixtureId) &&
          m.groupId !== gid &&
          !m.playerSide
      );
    },
  };
}
