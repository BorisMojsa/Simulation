/**
 * Chronological season orchestrator: league, domestic cup, continental, and
 * international fixtures share one dated event queue so injuries/fatigue/selection
 * carry correctly across competition boundaries.
 */
import { attachClubIdentity, getWorldState } from "./worldState.js";
import { effectiveTeamStrength } from "./teamStrength.js";
import { getSimRng, createStreamRng } from "./rng.js";
import {
  dateLeagueFixtures,
  flattenRoundRobinFixtures,
  dateCupRounds,
  sortChronological,
  simDate,
  daysBetween,
  mergePendingEvents,
} from "./seasonCalendar.js?v=89";
import { rivalsForClub } from "../data/clubRivals.js";
import { createRng } from "./rng.js";
import { squadReviewCheckpointDate } from "../data/registrationWindows.js";
import { evaluateSquadDecision, resolveSquadDecision } from "./squadDecisions.js";
import { generateLoanOffers } from "./loanMarket.js";
import { generatePipelineOffers } from "./dealPipeline.js";
import { exportClubFinanceState, importClubFinanceState } from "./clubFinance.js";
import {
  reconcileAfterClubChange,
  playerEligibleForClubMatch,
  findLeagueById,
} from "./destinationSchedule.js?v=81";
import { applyDecisionPolicy } from "./decisionPolicies.js";
import { processPlayerMatchDay } from "./playerMatchDay.js";
import { resolveKnockout } from "./matchEngine.js";
import { simulateMatch } from "./matchEngine.js";
import { applyMatchFormUpdate } from "./worldState.js";
import { stableCareerId } from "./playerDevelopmentModel.js";
import {
  simulateEuropeanFinalsShowcase,
} from "./europeanCompetition.js?v=81";
import {
  prepareSeasonContinental,
  buildContinentalChronoEvents,
  processContinentalChronoEvent,
  finalizeSeasonContinental,
  buildContinentalCampaignView,
  reloadEditionFromWorld,
  eventsForAttachedPendingFixtures,
} from "./continentalChronology.js";
import {
  prepareSeasonInternational,
  buildNationalChronoEvents,
  processNationalChronoEvent,
  finalizeSeasonNational,
  buildInternationalSeasonView,
  reloadNationalEditionFromWorld,
} from "./nationalChronology.js";
import {
  prepareDomesticCupBracket,
  prepareDestinationCupContinuation,
  simulateDomesticCupRound,
  finalizeDomesticCup,
  rebindDomesticCupAttachment,
} from "./domesticCup.js";
import { resolveValidatedClubSide } from "./playingRegistration.js";
import {
  leagueMatchCount,
  findSisterLeagues,
  qualificationForPosition,
} from "./leaguePhase.js";
import { LEAGUES } from "../data/leagues.js";
import {
  planSeniorScenarioEvents,
  buildPendingSeniorScenario,
  applySeniorScenarioPolicy,
  ensureSeniorCareerState,
} from "./seniorCareerScenarios.js?v=88";
import { ensureLeagueMatchId } from "./leagueTable.js";
import { commitLeagueMatchResult } from "./leagueEditionAdapter.js";
import {
  freezeEditionRoster,
  leagueViewForEdition,
  pairPolicyForLeague,
  resolveLeagueClubs,
} from "./leagueMembership.js";

/**
 * Resolve edition clubs from career membership. Modeled senior leagues must
 * already contain the player's club — never append a 21st/25th side.
 */
function ensurePlayerInClubs(league, player, { world = null, seasonYear = null } = {}) {
  const clubs = resolveLeagueClubs(league, { world, seasonYear });
  if (!player?.club?.name && !player?.club?.clubId) return clubs;
  const present = clubs.some(
    (c) =>
      (player.club.clubId && c.clubId === player.club.clubId) ||
      (player.club.name && c.name === player.club.name)
  );
  if (present) return clubs;
  const leagueId = league.leagueId || league.name;
  if (pairPolicyForLeague(leagueId) || (league.clubs || []).length >= 10) {
    throw new Error(
      `leagueMembership: player club ${player.club.clubId || player.club.name} missing from ${leagueId} edition roster`
    );
  }
  // Academy / non-modeled paths may still enroll the player side.
  clubs.push(
    attachClubIdentity({
      name: player.club.name,
      displayName: player.club.displayName ?? player.club.name,
      badge: player.club.badge,
      clubId: player.club.clubId,
      financialTier: player.club.financialTier ?? league.financialPower ?? 2,
      tier: league.tier,
      overall: player.club.overall,
    })
  );
  return clubs;
}

function initLeagueRecords(clubs, world) {
  const records = new Map();
  for (const c of clubs) {
    const eff = effectiveTeamStrength(c, { worldState: world });
    records.set(c.name, {
      name: c.name,
      displayName: c.displayName,
      badge: c.badge,
      clubId: c.clubId,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      points: 0,
      strength: eff.overall,
      overall: eff.overall,
      attack: eff.attack,
      midfield: eff.midfield,
      defence: eff.defence,
      goalkeeper: eff.goalkeeper,
      strengthTier: eff.tierLabel,
    });
  }
  return records;
}

function ensureRecordClub(records, club, world) {
  if (!club?.name || records.has(club.name)) return;
  const eff = effectiveTeamStrength(club, { worldState: world });
  records.set(club.name, {
    name: club.name,
    displayName: club.displayName,
    badge: club.badge,
    clubId: club.clubId,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points: 0,
    strength: eff.overall,
    overall: eff.overall,
    attack: eff.attack,
    midfield: eff.midfield,
    defence: eff.defence,
    goalkeeper: eff.goalkeeper,
    strengthTier: eff.tierLabel,
  });
}

/**
 * After a cross-league move, replace the active league table context with the
 * destination competition, seeding standings from already-played dest matches.
 */
function applyDestinationLeagueContext(recon, world) {
  const destLeague = findLeagueById(recon.destinationMeta?.destLeagueId);
  if (!destLeague || recon.destinationMeta?.sameLeague) {
    return null;
  }
  const seasonYear = recon.destinationMeta?.scheduleSeasonStartYear;
  const clubs = (recon.destinationClubs?.length
    ? recon.destinationClubs
    : resolveLeagueClubs(destLeague, { world, seasonYear })
  ).map((c) =>
    attachClubIdentity({
      ...c,
      tier: destLeague.tier,
      league: destLeague.name,
      leagueId: destLeague.leagueId,
      nation: destLeague.nation,
    })
  );
  const records = initLeagueRecords(clubs, world);
  for (const match of recon.pastMatches || []) {
    ensureRecordClub(records, match.home, world);
    ensureRecordClub(records, match.away, world);
    updateLeagueRecords(records, match);
  }
  return { activeLeague: { ...destLeague, clubs }, clubs, records };
}

function tagLeagueMatch(match, { activeLeague, player, historySegment, seasonStartYear, world }) {
  match.leagueContextId = activeLeague?.leagueId || match.competitionId;
  match.leagueContextName = activeLeague?.displayName || activeLeague?.name;
  match.historySegment = historySegment;
  match.playerClubId = player.playingClubId || player.club?.clubId || null;
  match.playerClubName = player.club?.name || null;
  ensureLeagueMatchId(match);
  try {
    commitLeagueMatchResult(match, activeLeague, seasonStartYear, world);
  } catch {
    // Competition store is optional for domestic; table still uses match arrays.
  }
  return match;
}

function findPlayingClubRow(table, player) {
  if (!table?.length || !player) return null;
  // Playing registration only — never fall back to employment/parent club.
  const playingId = player.playingClubId || player.club?.clubId;
  if (!playingId) return null;
  return table.find((r) => r.clubId === playingId) || null;
}

function buildLeagueMatchSegments(playerMatches) {
  const segments = [];
  for (const match of playerMatches || []) {
    const key = match.leagueContextId || match.competitionId || "league";
    const labelBase = match.leagueContextName || match.competition || "League";
    let seg = segments.find((s) => s.key === key && s.segment === match.historySegment);
    if (!seg) {
      const isOrigin = match.historySegment === "origin";
      seg = {
        key,
        segment: match.historySegment || "destination",
        leagueId: key,
        leagueDisplay: labelBase,
        label: isOrigin ? `${labelBase} · before move` : `${labelBase}`,
        matches: [],
      };
      segments.push(seg);
    }
    seg.matches.push(match);
  }
  return segments;
}

function leagueMatchday(ev, clubCount) {
  const perDay = Math.max(1, Math.floor(Math.max(2, clubCount) / 2));
  const idx = Number.isFinite(ev?.index) ? ev.index : 0;
  return Math.floor(idx / perDay) + 1;
}

function updateLeagueRecords(records, match) {
  const home = records.get(match.home.name);
  const away = records.get(match.away.name);
  if (!home || !away) return;
  const hg = match.matchHomeGoals ?? match.homeGoals;
  const ag = match.matchAwayGoals ?? match.awayGoals;
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
  } else if (ag > hg) {
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

function buildTable(records) {
  return [...records.values()]
    .map((r) => ({ ...r, goalDiff: r.goalsFor - r.goalsAgainst, matches: r.played }))
    .sort(
      (a, b) =>
        b.points - a.points || b.goalDiff - a.goalDiff || b.goalsFor - a.goalsFor || b.strength - a.strength
    )
    .map((row, idx) => ({ ...row, position: idx + 1 }));
}

/**
 * Pre-season continental entry proxy when current-season standing is unknown.
 * Prefers previous season finish; otherwise uses club quality bands.
 */
export function preSeasonContinentalStanding(player, league) {
  const prev = player.latestStanding?.playerRow;
  const prevLeagueId =
    player.latestStanding?.leagueId ||
    player.latestStanding?.league?.leagueId ||
    player.latestStanding?.playerRow?.leagueId;
  const currentLeagueId = league?.leagueId || league?.name;
  // Do not reuse a finish from a different association/league (e.g. after transfer).
  const sameLeague =
    !prevLeagueId ||
    !currentLeagueId ||
    prevLeagueId === currentLeagueId ||
    prevLeagueId === league?.name;

  if (prev?.position && sameLeague) {
    const sisters = findSisterLeagues(league, LEAGUES);
    const qualification =
      prev.qualification ||
      qualificationForPosition(prev.position, league, sisters) ||
      "";
    return {
      position: prev.position,
      points: prev.points || 0,
      qualification,
      divisionMove: null,
      record: { wins: prev.wins || 0, draws: prev.draws || 0, losses: prev.losses || 0 },
      matches: prev.matches || 0,
      goalDiff: prev.goalDiff || 0,
      strength: prev.strength || player.club?.overall || 70,
      table: player.latestStanding?.table || null,
    };
  }
  const overall = Number(player.club?.overall) || 70;
  // Simulation-policy seeding — not claimed real UEFA access list.
  let position = 12;
  if (overall >= 84) position = 1;
  else if (overall >= 80) position = 2;
  else if (overall >= 76) position = 3;
  else if (overall >= 72) position = 5;
  else if (overall >= 68) position = 7;
  else return null;
  const sisters = findSisterLeagues(league, LEAGUES);
  const qualification = qualificationForPosition(position, league, sisters) || "";
  return {
    position,
    points: 0,
    qualification,
    divisionMove: null,
    record: { wins: 0, draws: 0, losses: 0 },
    matches: 0,
    goalDiff: 0,
    strength: overall,
    table: null,
  };
}

function accumulatePlayerStats(stats, match, participation) {
  const ps = match.playerStats || {};
  if (ps.played && (ps.minutes || 0) > 0) {
    stats.played += 1;
    stats.minutes += ps.minutes || 0;
    if (participation?.started) stats.starts += 1;
    stats.goals += ps.goals || 0;
    stats.assists += ps.assists || 0;
    stats.yellow += ps.yellow || 0;
    stats.red += ps.red || 0;
  }
}

/**
 * Run a club+intl season with one chronological queue.
 * Supports mid-season pause at the winter window when pauseForDecisions is true.
 *
 * @returns complete season result, or
 *   { status: "awaiting_decision", checkpoint, decision, offers, partialPlayerMatchStats }
 */
export function simulateChronologicalSeason({
  player,
  league,
  seasonIndex = 0,
  checkpoint = null,
  pauseForDecisions = false,
  autoDecisionPolicy = null,
}) {
  const rng = getSimRng();
  const careerId = stableCareerId(player);
  const selRng = createStreamRng(careerId, `selection:chrono:${seasonIndex}`);
  const injuryRng = createStreamRng(careerId, `injury:chrono:${seasonIndex}`);
  const world = getWorldState();
  const seasonStartYear = (player.startYear || 2026) + seasonIndex;
  const calendarYear = seasonStartYear;

  if (checkpoint?.status === "awaiting_decision" || checkpoint?.status === "awaiting_scenario") {
    return resumeChronologicalSeason({
      player,
      league,
      seasonIndex,
      checkpoint,
      pauseForDecisions,
      autoDecisionPolicy,
    });
  }

  // ---- League fixtures (career/edition roster authority) ----
  freezeEditionRoster(league, seasonStartYear, world);
  const editionLeague = leagueViewForEdition(league, { world, seasonYear: seasonStartYear });
  let activeLeague = editionLeague;
  let clubs = ensurePlayerInClubs(editionLeague, player, {
    world,
    seasonYear: seasonStartYear,
  });
  const fixtures = flattenRoundRobinFixtures(clubs, {
    idPrefix: `lg:${editionLeague.leagueId || editionLeague.name}:${seasonStartYear}`,
  });
  const datedLeague = dateLeagueFixtures(fixtures, seasonStartYear);
  let records = initLeagueRecords(clubs, world);
  let historySegment = "origin";

  // ---- Pre-plan cup / europe / intl as dated "round" events ----
  const cupRoundDates = dateCupRounds(
    [{}, {}, {}, {}, {}, {}, {}],
    seasonStartYear
  ).map((r) => r.date);

  // Continental: prepare edition (schedule only). Fixtures play once on their dates.
  const preStanding = preSeasonContinentalStanding(player, league);
  let europeEdition = prepareSeasonContinental({
    standing: preStanding,
    league,
    player,
    seasonYear: seasonStartYear,
    world,
  });
  let europePlan = europeEdition
    ? buildContinentalCampaignView(europeEdition, {
        playerName: europeEdition.playerClub?.name,
        world,
      })
    : { ...simulateEuropeanFinalsShowcase(league), qualified: false, showcase: true };
  const europePlayerSlots = buildContinentalChronoEvents(europeEdition);

  // International: prepare editions (draw/call-up/schedule only) — play on dated events.
  const intlSeason = prepareSeasonInternational({
    player,
    calendarYear,
    avgMatchRating: 6.8,
    world,
    rng,
  });
  let intlPrimaryEdition = intlSeason.primaryEdition || null;
  const intlSlots = intlPrimaryEdition ? buildNationalChronoEvents(intlPrimaryEdition) : [];
  // Compatibility alias used by senior-scenario planners and checkpoints.
  const intlProbe = intlSeason;

  // Cup: simulate via progressive engine on round dates (player-aware).
  // Build events: league fixtures + cup round ticks + europe slots + intl slots.
  const events = [];
  datedLeague.forEach((fx, index) => {
    events.push({
      kind: "league",
      date: fx.date,
      sortKey: fx.sortKey,
      index,
      home: fx.home,
      away: fx.away,
    });
  });
  cupRoundDates.forEach((date, i) => {
    events.push({ kind: "cup_round", date, sortKey: `${date}:C:${i}`, roundIndex: i });
  });
  europePlayerSlots.forEach((ev) => {
    events.push(ev);
  });
  intlSlots.forEach((ev) => {
    events.push(ev);
  });

  // Mid-season SQUAD REVIEW checkpoint (not a universal registration authorisation).
  // Registration eligibility is checked per destination association at accept time.
  const reviewDate = squadReviewCheckpointDate(league.leagueId, seasonStartYear);
  events.push({
    kind: "window_decision",
    date: reviewDate,
    sortKey: `${reviewDate}:W:0`,
    window: "squad-review",
    reviewOnly: true,
  });

  // Optional senior career scenes: one independent 30% roll per entered competition edition.
  if (!player.club?.isAcademy) {
    ensureSeniorCareerState(player);
    const planned = planSeniorScenarioEvents(player, {
      league,
      seasonStartYear,
      europePlan,
      intlProbe,
      cupRoundDates,
      datedLeague,
      europePlayerSlots,
      intlSlots,
    });
    for (const sev of planned.events) {
      events.push(sev);
    }
  }

  let ordered = sortChronological(events);

  let cupState = null;
  let cupResult = null;
  let cupCampaigns = [];
  let europeResimMatches = []; // legacy checkpoint field; continental no longer re-sims
  let intlResimMatches = []; // legacy checkpoint field; national results live in store/edition
  const lastDateRef = { current: null };
  const leaguePlayerMatches = [];
  const leagueAllMatches = [];
  const ledgerRecords = [];
  const playerMatchStats = { played: 0, goals: 0, assists: 0, yellow: 0, red: 0, minutes: 0, starts: 0 };
  let lastDate = null;
  const processedEventIds = [];
  let destinationMeta = player.destinationScheduleMeta || null;

  for (let eventIndex = 0; eventIndex < ordered.length; eventIndex++) {
    const ev = ordered[eventIndex];
    const eventId = `${ev.kind}:${ev.sortKey || ev.date}:${eventIndex}`;
    if (ev.kind === "window_decision") {
      const clubBefore = player.playingClubId || player.club?.clubId;
      const leagueBefore = player.club?.leagueId || league.leagueId;
      const pauseResult = handleWindowDecision({
        player,
        seasonIndex,
        playerMatchStats,
        pauseForDecisions,
        autoDecisionPolicy,
        window: ev.window,
        date: ev.date,
        seasonStartYear,
        league,
        leagueAllMatches,
      });
      processedEventIds.push(eventId);
      lastDate = ev.date;
      const clubAfter = player.playingClubId || player.club?.clubId;
      if (clubAfter && clubBefore && clubAfter !== clubBefore) {
        const recon = reconcileAfterClubChange({
          player,
          previousClubId: clubBefore,
          previousLeagueId: leagueBefore,
          departureDate: ev.date,
          ordered,
          eventIndex,
          originSeasonStartYear: seasonStartYear,
          world,
          rng,
          initialisePastDestination: true,
        });
        if (recon.error === "missing-destination-schedule") {
          throw new Error(
            `Cross-league move to ${player.club?.leagueId} has no remaining destination fixtures after ${ev.date}`
          );
        }
        if (recon.ordered) ordered = recon.ordered;
        destinationMeta = recon.destinationMeta;
        player.destinationScheduleMeta = destinationMeta;
        const switched = applyDestinationLeagueContext(recon, world);
        if (switched) {
          activeLeague = switched.activeLeague;
          clubs = switched.clubs;
          records = switched.records;
          historySegment = "destination";
        }
        if (cupState) rebindDomesticCupAttachment(cupState, player);
        if (europeEdition) {
          ordered = mergePendingEvents(
            ordered,
            eventIndex,
            eventsForAttachedPendingFixtures(europeEdition, player, { onOrAfterDate: ev.date })
          );
        }
      }
      if (pauseResult?.pause) {
        const ck = buildSeasonCheckpoint({
          seasonIndex,
          leagueId: league.leagueId || league.name,
          eventIndex,
          ordered,
          clubs,
          records,
          cupState,
          cupResult,
          cupCampaigns,
          europePlan,
          europeEdition,
          intlProbe,
          intlPrimaryEdition,
          europeResimMatches,
          intlResimMatches,
          leaguePlayerMatches,
          leagueAllMatches,
          ledgerRecords,
          playerMatchStats,
          lastDate,
          processedEventIds,
          cupRoundDates,
          europePlayerSlots,
          intlSlots,
          seasonStartYear,
          calendarYear,
          rngState: rng.seed(),
          selRngState: selRng.seed(),
          injuryRngState: injuryRng.seed(),
          decision: pauseResult.decision,
          offers: pauseResult.offers,
          playingClubIdAtPause: player.playingClubId || player.club?.clubId,
          employmentClubIdAtPause: player.employmentClubId || player.club?.clubId,
        });
        player.seasonCheckpoint = ck;
        player.pendingDecision = pauseResult.decision;
        player.pendingOffers = pauseResult.offers || [];
        return {
          status: "awaiting_decision",
          checkpoint: ck,
          decision: pauseResult.decision,
          offers: pauseResult.offers,
          partialPlayerMatchStats: { ...playerMatchStats },
          chronology: { events: ordered.length, lastDate, pausedAt: ev.date },
        };
      }
      continue;
    }
    if (ev.kind === "senior_scenario") {
      const sceneResult = handleSeniorScenarioEvent({
        player,
        event: ev,
        pauseForDecisions,
        autoDecisionPolicy,
        playerMatchStats,
        intlProbe,
        leaguePlayerMatches,
        ordered,
        eventIndex,
      });
      processedEventIds.push(eventId);
      lastDate = ev.date;
      if (sceneResult?.pause) {
        const ck = buildSeasonCheckpoint({
          seasonIndex,
          leagueId: league.leagueId || league.name,
          eventIndex,
          ordered,
          clubs,
          records,
          cupState,
          cupResult,
          cupCampaigns,
          europePlan,
          europeEdition,
          intlProbe,
          intlPrimaryEdition,
          europeResimMatches,
          intlResimMatches,
          leaguePlayerMatches,
          leagueAllMatches,
          ledgerRecords,
          playerMatchStats,
          lastDate,
          processedEventIds,
          cupRoundDates,
          europePlayerSlots,
          intlSlots,
          seasonStartYear,
          calendarYear,
          rngState: rng.seed(),
          selRngState: selRng.seed(),
          injuryRngState: injuryRng.seed(),
          decision: null,
          offers: [],
          playingClubIdAtPause: player.playingClubId || player.club?.clubId,
          employmentClubIdAtPause: player.employmentClubId || player.club?.clubId,
          pendingSeniorScenario: sceneResult.pending,
          status: "awaiting_scenario",
        });
        player.seasonCheckpoint = ck;
        player.pendingSeniorScenario = sceneResult.pending;
        return {
          status: "awaiting_scenario",
          checkpoint: ck,
          pendingSeniorScenario: sceneResult.pending,
          partialPlayerMatchStats: { ...playerMatchStats },
          chronology: { events: ordered.length, lastDate, pausedAt: ev.date },
        };
      }
      continue;
    }
    if (ev.kind === "registration_effective") {
      if (player.pendingRegistration?.effectiveDate === ev.date) {
        player.pendingRegistration = null;
      }
      lastDate = ev.date;
      continue;
    }
    if (ev.kind === "dest_cup_round") {
      // Destination-association cup after loan/transfer registration.
      if (player.playingClubId || ev.destinationLeagueId) {
        const destLeague = findLeagueById(ev.destinationLeagueId) || activeLeague;
        if (destLeague && (!cupState || !cupState._destBound)) {
          if (cupState && !cupState._destBound) {
            if (!cupResult) {
              cupState.playerAttached = false;
              cupResult = finalizeDomesticCup(cupState);
            }
            cupCampaigns = rememberCupCampaign(cupCampaigns, cupResult);
          }
          cupState = prepareDestinationCupContinuation(destLeague, player, {
            asOfDate: ev.date,
            seasonStartYear:
              ev.destinationSeasonStartYear ||
              destinationMeta?.scheduleSeasonStartYear ||
              seasonStartYear,
          });
        }
        if (cupState && cupState._destBound && !cupState.finished) {
          simulateDomesticCupRound(cupState, {
            player,
            date: ev.date,
            matchProcessor: ({ home, away, playerSide, date, label }) =>
              processPlayerMatchDay({
                home,
                away,
                player,
                playerSide,
                date,
                lastDate,
                competition: "cup",
                competitionType: "domesticCup",
                competitionId: cupState.config.name,
                fixtureId: `destcup:${cupState.config.name}:${ev.roundIndex}:${label}`,
                teamType: "club",
                competitionPriority: 0.85,
                rng,
                selRng,
                injuryRng,
                worldState: world,
                resolveKnockout,
              }),
          });
          const proc = cupState.lastProcessorResult;
          if (proc?.ledgerRecord) {
            ledgerRecords.push(proc.ledgerRecord);
            accumulatePlayerStats(playerMatchStats, proc.match, proc.participation);
          }
          cupState.lastProcessorResult = null;
          if (cupState.finished || cupState.eliminatedRound) {
            const destCup = finalizeDomesticCup(cupState);
            cupCampaigns = rememberCupCampaign(cupCampaigns, destCup);
            cupResult = destCup;
          }
        }
      }
      lastDate = ev.date;
      continue;
    }
    if (ev.kind === "league") {
      const fx = ev;
      const competitionId = ev.destinationLeagueId || activeLeague.leagueId || league.leagueId;
      let playerIn = resolveValidatedClubSide({
        player,
        home: fx.home,
        away: fx.away,
        date: fx.date,
        teamType: "club",
      });
      if (playerIn && !playerEligibleForClubMatch(player, fx.date)) {
        playerIn = null;
      }
      const matchday = leagueMatchday(ev, clubs.length);
      const fixtureId = ev.fixtureId || `${competitionId}:md:${ev.index}`;

      if (!playerIn) {
        const match = simulateMatch(fx.home, fx.away, {
          competition: "league",
          worldState: world,
          rng,
          competitionId,
          fixtureId,
          date: fx.date,
        });
        match.matchday = matchday;
        match.round = `Matchday ${match.matchday}`;
        tagLeagueMatch(match, { activeLeague, player, historySegment, seasonStartYear, world });
        applyMatchFormUpdate(world, match);
        leagueAllMatches.push(match);
        ensureRecordClub(records, match.home, world);
        ensureRecordClub(records, match.away, world);
        updateLeagueRecords(records, match);
        continue;
      }

      const { match, participation, ledgerRecord } = processPlayerMatchDay({
        home: fx.home,
        away: fx.away,
        player,
        playerSide: playerIn,
        date: fx.date,
        lastDate,
        competition: "league",
        competitionType: "league",
        competitionId,
        fixtureId,
        teamType: "club",
        competitionPriority: 1,
        rng,
        selRng,
        injuryRng,
        worldState: world,
      });
      match.matchday = matchday;
      match.round = `Matchday ${match.matchday}`;
      tagLeagueMatch(match, { activeLeague, player, historySegment, seasonStartYear, world });
      leagueAllMatches.push(match);
      leaguePlayerMatches.push(match);
      ensureRecordClub(records, match.home, world);
      ensureRecordClub(records, match.away, world);
      updateLeagueRecords(records, match);
      if (ledgerRecord) {
        ledgerRecords.push(ledgerRecord);
        accumulatePlayerStats(playerMatchStats, match, participation);
      }
      lastDate = fx.date;
    } else if (ev.kind === "cup_round") {
      if (cupResult) continue;
      if (!cupState) cupState = prepareDomesticCupBracket(activeLeague, player);

      const playerStillIn =
        cupState.playerAttached !== false &&
        !cupState.eliminatedRound &&
        cupState.remaining.some(
          (c) =>
            c &&
            !c.isBye &&
            ((cupState.playerClubId && c.clubId === cupState.playerClubId) ||
              c.name === cupState.playerName)
        );

      if (cupState.finished || cupState.remaining.length <= 1) {
        cupResult = finalizeDomesticCup(cupState);
        continue;
      }

      // One scheduled round per date while the player remains; after elimination,
      // finish the bracket immediately so the winner is known without idle ticks.
      simulateDomesticCupRound(cupState, {
        player,
        date: ev.date,
        matchProcessor: ({ home, away, playerSide, date, label }) => {
          const result = processPlayerMatchDay({
            home,
            away,
            player,
            playerSide,
            date,
            lastDate,
            competition: "cup",
            competitionType: "domesticCup",
            competitionId: cupState.config.name,
            fixtureId: `cup:${cupState.config.name}:${ev.roundIndex}:${label}`,
            teamType: "club",
            competitionPriority: 0.9,
            rng,
            selRng,
            injuryRng,
            worldState: world,
            resolveKnockout,
          });
          return result;
        },
      });

      const proc = cupState.lastProcessorResult;
      if (proc) {
        if (proc.ledgerRecord) {
          ledgerRecords.push(proc.ledgerRecord);
          accumulatePlayerStats(playerMatchStats, proc.match, proc.participation);
        }
        lastDate = ev.date;
        cupState.lastProcessorResult = null;
      }

      if (cupState.finished || cupState.remaining.length <= 1) {
        cupResult = finalizeDomesticCup(cupState);
      } else if (!playerStillIn || cupState.eliminatedRound) {
        // Player out — complete remaining rounds without further calendar waits.
        cupResult = finalizeDomesticCup(cupState);
      }
    } else if (
      ev.kind === "continental_md" ||
      ev.kind === "continental_fixture" ||
      ev.kind === "continental_gate"
    ) {
      if (!europeEdition || europePlan?.showcase || europePlan?.qualified === false) continue;
      lastDateRef.current = lastDate;
      const processed = processContinentalChronoEvent({
        ev,
        edition: europeEdition,
        ordered,
        eventIndex,
        player,
        rng,
        selRng,
        injuryRng,
        world,
        lastDateRef,
        ledgerRecords,
        playerMatchStats,
        accumulatePlayerStats,
      });
      europeEdition = processed.edition;
      ordered = processed.ordered;
      if (processed.europePlan) europePlan = processed.europePlan;
      lastDate = lastDateRef.current || ev.date;
    } else if (ev.kind === "national_md" || ev.kind === "national_fixture") {
      if (!intlPrimaryEdition) continue;
      lastDateRef.current = lastDate;
      const processed = processNationalChronoEvent({
        ev,
        edition: intlPrimaryEdition,
        ordered,
        eventIndex,
        player,
        rng,
        selRng,
        injuryRng,
        world,
        lastDateRef,
        ledgerRecords,
        playerMatchStats,
        accumulatePlayerStats,
      });
      intlPrimaryEdition = processed.edition;
      ordered = processed.ordered;
      if (processed.campaignView) {
        intlSeason.primary = processed.campaignView;
        intlSeason.playerMatches = processed.campaignView.playerMatches || [];
      }
      lastDate = lastDateRef.current || ev.date;
    }
  }

  if (!cupResult) {
    if (!cupState) cupState = prepareDomesticCupBracket(activeLeague, player);
    cupResult = finalizeDomesticCup(cupState);
  }
  cupCampaigns = rememberCupCampaign(cupCampaigns, cupResult);

  if (europeEdition && !europePlan?.showcase) {
    lastDateRef.current = lastDate;
    europePlan = finalizeSeasonContinental({
      edition: europeEdition,
      player,
      rng,
      selRng,
      injuryRng,
      world,
      lastDateRef,
      ledgerRecords,
      playerMatchStats,
      accumulatePlayerStats,
    }) || europePlan;
  }
  // National editions finalize through the store-backed lifecycle (no reconcile/replay).
  if (typeof intlSeason !== "undefined" && (intlSeason?.editions?.length || intlPrimaryEdition)) {
    lastDateRef.current = lastDate;
    const finalizedIntl = finalizeSeasonNational({
      edition: intlPrimaryEdition,
      season: intlSeason,
      player,
      rng,
      selRng,
      injuryRng,
      world,
      lastDateRef,
      ledgerRecords,
      playerMatchStats,
      accumulatePlayerStats,
    });
    if (finalizedIntl) {
      Object.assign(intlProbe, finalizedIntl);
    }
  }

  const table = buildTable(records);
  if (world) world.standings.set(activeLeague.leagueId || activeLeague.name, table);
  player.seasonCheckpoint = null;
  const playerRecord = findPlayingClubRow(table, player);
  const leagueMatchSegments = buildLeagueMatchSegments(leaguePlayerMatches);

  return {
    status: "complete",
    table,
    activeLeague,
    playerRecord,
    playerMatches: leaguePlayerMatches,
    allMatches: leagueAllMatches,
    leagueMatchSegments,
    playerMatchStats,
    ledgerRecords,
    expectedMatches: leagueMatchCount(activeLeague),
    domesticCupResult: cupResult,
    domesticCupCampaigns: cupCampaigns.length ? cupCampaigns : cupResult ? [cupResult] : [],
    europeanCampaign: europePlan,
    internationalSeason: intlProbe,
    chronology: {
      events: ordered.length,
      lastDate,
      cupRounds: cupRoundDates.length,
      europeSlots: europePlayerSlots.length,
      intlSlots: intlSlots.length,
      activeLeagueId: activeLeague.leagueId,
      playingClubId: player.playingClubId || player.club?.clubId,
      employmentClubId: player.employmentClubId || null,
    },
  };
}

function midSeasonPerformanceProxy(stats) {
  const apps = stats.played || 0;
  const impact = (stats.goals || 0) * 5 + (stats.assists || 0) * 3 + apps * 0.5;
  return Math.max(35, Math.min(90, 55 + impact / Math.max(1, apps) - (apps < 5 ? 8 : 0)));
}

function midSeasonSeasonProxy(playerMatchStats, leagueAllMatches = [], playerClubId = null) {
  const clubGames = (leagueAllMatches || []).filter(
    (m) =>
      !playerClubId ||
      m.home?.clubId === playerClubId ||
      m.away?.clubId === playerClubId ||
      m.home?.name === playerClubId ||
      m.away?.name === playerClubId
  );
  const eligible = Math.max(clubGames.length, playerMatchStats?.played || 0);
  const minutes = playerMatchStats?.minutes || 0;
  return {
    matches: eligible,
    minutes,
    injuryAbsences: 0,
    participationLedger: {
      eligibleClubMatches: eligible,
      availableClubMinutes: Math.max(1, eligible) * 90,
      clubMinutesPlayed: minutes,
    },
  };
}

function handleWindowDecision({
  player,
  seasonIndex,
  playerMatchStats,
  pauseForDecisions,
  autoDecisionPolicy,
  window,
  date,
  seasonStartYear,
  league,
  leagueAllMatches = [],
}) {
  if (player.club?.isAcademy) return { pause: false };
  const perf = midSeasonPerformanceProxy(playerMatchStats);
  const clubId = player.playingClubId || player.club?.clubId || player.club?.name;
  const seasonProxy = midSeasonSeasonProxy(playerMatchStats, leagueAllMatches, clubId);
  const decision = evaluateSquadDecision(player, {
    seasonIndex,
    checkpoint: "mid-season",
    performanceScore: perf,
    date,
    season: seasonProxy,
  });
  let offers = [];
  const policyMode = typeof autoDecisionPolicy === "string" ? autoDecisionPolicy : autoDecisionPolicy?.mode;
  const loanDecision =
    decision?.kind === "development-loan" || decision?.kind === "surplus";
  const wantLoan = policyMode === "accept-first-loan" || loanDecision;
  const wantTransfer =
    policyMode === "accept-first-transfer" || policyMode === "accept-cross-league-transfer";

  // Keep loan offers on the decision until the manager path "Review loan options"
  // is chosen — do not pre-dump them into the transfer tray.
  if (wantLoan && !loanDecision) {
    offers = generateLoanOffers(player, { maxOffers: 4, performanceScore: perf }).offers;
  }
  if (wantTransfer || (!decision && !loanDecision) || policyMode === "stay") {
    const pipe = generatePipelineOffers(player, {
      performanceScore: perf,
      forceGenerate: wantTransfer,
      rng: createStreamRng(stableCareerId(player), `review:${seasonIndex}:${date}`),
    });
    const merged = [...offers];
    for (const o of pipe.offers) {
      if (!merged.some((m) => m.clubId === o.clubId && m.dealType === o.dealType)) merged.push(o);
    }
    offers = merged.slice(0, 5);
  }

  // Tag offers with destination registration status (review ≠ registration).
  const stamp = (list) => {
    for (const o of list || []) {
      o.reviewDate = date;
      o.reviewOnlyCheckpoint = true;
      if (o.isLoan && o.loanTerms) {
        o.loanTerms.startDate = o.loanTerms.startDate || date;
        o.loanTerms.endDate =
          o.loanTerms.endDate || simDate(Number(seasonStartYear) + 1, 5, 31);
      }
    }
  };
  stamp(offers);
  stamp(decision?.loanOffers);

  if (autoDecisionPolicy) {
    const policyOffers = loanDecision
      ? [...(decision.loanOffers || []), ...offers]
      : offers;
    const applied = applyAutoDecisionPolicy(player, decision, policyOffers, autoDecisionPolicy, {
      date,
      seasonStartYear,
    });
    return { pause: false, autoApplied: applied, clubChanged: Boolean(applied?.offer) };
  }

  if (pauseForDecisions) {
    // Always yield at the review checkpoint for interactive careers so mid-season
    // moves can be accepted; empty markets still get a usable continuation.
    return {
      pause: true,
      decision: decision || {
        kind: "stay-compete",
        headline: "Mid-season review",
        lead: "No urgent squad decision. You can continue the season, or wait if offers arrive.",
        choices: [{ id: "acknowledge", label: "Continue the season" }],
        cooldownKind: "stay-compete",
      },
      offers,
    };
  }
  return { pause: false };
}

function applyAutoDecisionPolicy(player, decision, offers, policy, ctx = {}) {
  return applyDecisionPolicy(
    player,
    { decision, offers },
    policy,
    {
      departureDate: ctx.date,
      originSeasonStartYear: ctx.seasonStartYear,
      date: ctx.date,
    }
  );
}

/** Retain distinct domestic-cup campaigns (e.g. Coppa then Croatian cup) without merging brackets. */
function rememberCupCampaign(campaigns, result) {
  if (!result?.name) return campaigns || [];
  const list = [...(campaigns || [])];
  const firstId =
    (result.playerMatches || [])[0]?.fixtureId ||
    (result.playerMatches || [])[0]?.matchId ||
    `${result.name}:${result.result || ""}:${(result.playerMatches || []).length}`;
  const exists = list.some((c) => {
    const id =
      (c.playerMatches || [])[0]?.fixtureId ||
      (c.playerMatches || [])[0]?.matchId ||
      `${c.name}:${c.result || ""}:${(c.playerMatches || []).length}`;
    return c.name === result.name && id === firstId;
  });
  if (!exists) list.push(result);
  return list;
}

function buildSeasonCheckpoint(parts) {
  return {
    status: parts.status || "awaiting_decision",
    version: 3,
    seasonIndex: parts.seasonIndex,
    leagueId: parts.leagueId,
    eventIndex: parts.eventIndex,
    seasonStartYear: parts.seasonStartYear,
    calendarYear: parts.calendarYear,
    lastDate: parts.lastDate,
    rngState: parts.rngState,
    selRngState: parts.selRngState,
    injuryRngState: parts.injuryRngState,
    // Snapshot of finance at pause — ordinary resume must NOT re-import over
    // post-decision bookings. Full career restore uses careerSnapshot instead.
    finance: exportClubFinanceState(),
    financeAuthority: "checkpoint-pause",
    processedEventIds: parts.processedEventIds,
    // Serializable accumulators
    records: [...parts.records.entries()],
    clubs: parts.clubs,
    cupState: parts.cupState,
    cupResult: parts.cupResult,
    cupCampaigns: parts.cupCampaigns || [],
    europePlan: parts.europePlan,
    europeEdition: parts.europeEdition || null,
    intlProbe: parts.intlProbe,
    intlPrimaryEdition: parts.intlPrimaryEdition || null,
    europeResimMatches: parts.europeResimMatches,
    intlResimMatches: parts.intlResimMatches,
    leaguePlayerMatches: parts.leaguePlayerMatches,
    leagueAllMatches: parts.leagueAllMatches,
    ledgerRecords: parts.ledgerRecords,
    playerMatchStats: parts.playerMatchStats,
    cupRoundDates: parts.cupRoundDates,
    europePlayerSlots: parts.europePlayerSlots,
    intlSlots: parts.intlSlots,
    ordered: parts.ordered,
    decision: parts.decision,
    offers: parts.offers,
    pendingSeniorScenario: parts.pendingSeniorScenario || null,
    playingClubIdAtPause: parts.playingClubIdAtPause,
    employmentClubIdAtPause: parts.employmentClubIdAtPause,
  };
}

function recentClubResults(playerMatchStats, leaguePlayerMatches = []) {
  const results = [];
  for (const m of leaguePlayerMatches || []) {
    if (!m?.playerStats?.minutes) continue;
    const side = m.playerSide;
    const gf = side === "home" ? m.homeGoals : m.awayGoals;
    const ga = side === "home" ? m.awayGoals : m.homeGoals;
    if (gf > ga) results.push("W");
    else if (gf < ga) results.push("L");
    else results.push("D");
  }
  return results.slice(-5);
}

function handleSeniorScenarioEvent({
  player,
  event,
  pauseForDecisions,
  autoDecisionPolicy,
  playerMatchStats,
  intlProbe,
  leaguePlayerMatches = [],
  ordered = [],
  eventIndex = 0,
}) {
  if (player.club?.isAcademy) return { pause: false };

  // Truthful runtime context — never invent defeat/derby/leave/congestion.
  const recentResults = recentClubResults(playerMatchStats, leaguePlayerMatches);
  const afterLoss = recentResults.length > 0 && recentResults[recentResults.length - 1] === "L";
  const oppName =
    event.opponent?.name ||
    event.away?.name ||
    event.home?.name ||
    event.fixture?.away?.name ||
    event.fixture?.home?.name;
  const myName = player.club?.name;
  const rivals = rivalsForClub(myName);
  const rivalMatchup = Boolean(oppName && rivals.includes(oppName));

  // Congestion: overlapping fixtures within 3 days around the event date.
  let fixtureCongestion = false;
  let travelCongestion = false;
  if (event.date && ordered.length) {
    const nearby = ordered.filter((ev) => {
      if (!ev?.date || ev.kind === "senior_scenario" || ev.kind === "winter_window") return false;
      return Math.abs(daysBetween(event.date, ev.date)) <= 3;
    });
    fixtureCongestion = nearby.length >= 3;
    const nations = new Set(
      nearby
        .map((ev) => ev.competitionType)
        .filter((t) => t === "continental" || t === "international")
    );
    travelCongestion = nations.size > 0 && nearby.length >= 2;
  }

  const onLeave = Boolean(player.seniorCareer?.life?.onLeave || player.onLeave);
  const standout =
    (playerMatchStats?.goals || 0) + (playerMatchStats?.assists || 0) >= 3 ||
    (playerMatchStats?.minutes || 0) >= 450;
  const benched =
    (playerMatchStats?.starts || 0) === 0 && (playerMatchStats?.played || 0) > 0;

  // Next fixture after this scene date (for derby / opponent context).
  let nextFixture = false;
  let strongOpponentUpcoming = false;
  let awayTravelReturn = false;
  if (event.date && ordered.length) {
    const upcoming = ordered.find(
      (ev, i) =>
        i > eventIndex &&
        ev?.date &&
        (ev.kind === "league_match" ||
          ev.kind === "cup_match" ||
          ev.kind === "continental_match" ||
          ev.home ||
          ev.away)
    );
    nextFixture = Boolean(upcoming);
    if (upcoming) {
      const opp =
        upcoming.opponent?.name ||
        (upcoming.home?.name === myName ? upcoming.away?.name : upcoming.home?.name);
      if (opp && rivals.includes(opp)) {
        /* rival already handled via nearby match */
      }
      const myStr = Number(player.club?.strength ?? player.rating ?? 70);
      const oppStr = Number(upcoming.opponentStrength ?? upcoming.away?.strength ?? upcoming.home?.strength);
      if (Number.isFinite(oppStr) && oppStr > myStr + 4) strongOpponentUpcoming = true;
      const isAway =
        upcoming.away?.clubId === player.playingClubId ||
        upcoming.away?.name === myName ||
        upcoming.isHome === false;
      if (isAway) awayTravelReturn = true;
    }
  }

  const matchAnnotations = leaguePlayerMatches.flatMap((m) => m.annotations || m.events || []);
  const matchErrorEvidence = matchAnnotations.some(
    (a) => a === "error" || a?.type === "error" || a?.kind === "error"
  );
  const missedChanceEvidence =
    player.position !== "GK" &&
    matchAnnotations.some((a) => a === "miss" || a?.type === "miss" || a?.kind === "missed_chance");
  const gkReboundEvidence =
    player.position === "GK" &&
    matchAnnotations.some((a) => a === "rebound" || a?.type === "rebound" || a?.kind === "handling");

  const pending = buildPendingSeniorScenario(player, event, {
    playerMatchStats,
    recentResults,
    intlCalledUp: Boolean(intlProbe?.calledUp),
    nationalCallUp: event.competitionType === "international" && Boolean(intlProbe?.calledUp),
    fixtureCongestion,
    travelCongestion,
    onLeave,
    rivalMatchup,
    nextFixture: nextFixture || rivalMatchup,
    strongOpponentUpcoming,
    awayTravelReturn,
    matchErrorEvidence,
    missedChanceEvidence,
    gkReboundEvidence,
    highWorkload: fixtureCongestion || travelCongestion,
    // force* only when the underlying fact is true (not invented).
    forceAfterLoss: afterLoss,
    forceStandout: standout,
    forceBenched: benched,
    leadershipContext: (player.age || 0) >= 22 && (playerMatchStats?.starts || 0) >= 5,
    experiencedSenior: (player.age || 0) >= 28,
    returningFromInjury: Boolean(
      player.health?.status === "returning" || player.health?.status === "rehab"
    ),
    clearedFullTraining: player.health?.status === "cleared" || player.health?.status === "available",
    firstNationalCamp:
      event.competitionType === "international" &&
      !player.seniorCareer?.firstNationalCampAttended,
    poorFormEvidence:
      Number.isFinite(playerMatchStats?.avgMatchRating) &&
      playerMatchStats.avgMatchRating > 0 &&
      playerMatchStats.avgMatchRating < 6.4,
  });

  if (!pending || pending.unschedulable) {
    ensureSeniorCareerState(player).lastSkipReason = pending?.reason || "unschedulable";
    return { pause: false, skipped: true, reason: pending?.reason };
  }

  if (autoDecisionPolicy) {
    const policy =
      typeof autoDecisionPolicy === "object" && autoDecisionPolicy.seniorPolicy
        ? autoDecisionPolicy.seniorPolicy
        : "balanced";
    applySeniorScenarioPolicy(player, pending, policy);
    return { pause: false, autoApplied: true };
  }

  if (pauseForDecisions) {
    player.pendingSeniorScenario = pending;
    return { pause: true, pending };
  }

  // Non-interactive seasons without an explicit policy still resolve neutrally.
  applySeniorScenarioPolicy(player, pending, "balanced");
  return { pause: false, autoApplied: true };
}

/**
 * Resume a paused chronological season after the user resolves a winter decision.
 * Does not re-simulate events before the checkpoint cursor.
 */
export function resumeChronologicalSeason({
  player,
  league,
  seasonIndex,
  checkpoint,
  pauseForDecisions = false,
  autoDecisionPolicy = null,
}) {
  if (!checkpoint?.ordered) {
    throw new Error("resumeChronologicalSeason: missing checkpoint.ordered");
  }
  // Do not import checkpoint.finance on ordinary resume — accepted deals after the
  // pause must remain booked. Full restore goes through deserializeCareerSnapshot.
  if (checkpoint.restoreFinance && checkpoint.finance) {
    importClubFinanceState(checkpoint.finance);
  }

  const rng = getSimRng();
  if (checkpoint.rngState != null) rng.setSeed(checkpoint.rngState);
  const careerId = stableCareerId(player);
  // Restore stream states so pause/resume cannot change selection/injury outcomes.
  const selRng =
    checkpoint.selRngState != null
      ? createRng(checkpoint.selRngState)
      : createStreamRng(careerId, `selection:chrono:${seasonIndex}`);
  const injuryRng =
    checkpoint.injuryRngState != null
      ? createRng(checkpoint.injuryRngState)
      : createStreamRng(careerId, `injury:chrono:${seasonIndex}`);
  const world = getWorldState();
  const seasonStartYear = checkpoint.seasonStartYear ?? (player.startYear || 2026) + seasonIndex;

  let ordered = checkpoint.ordered;
  let activeLeague = findLeagueById(checkpoint.leagueId) || league;
  let clubs = checkpoint.clubs || [];
  let records = new Map(checkpoint.records || []);
  let historySegment = "origin";
  for (const m of checkpoint.leaguePlayerMatches || []) {
    if (!m.historySegment) {
      m.historySegment = "origin";
      m.leagueContextId = m.leagueContextId || checkpoint.leagueId;
      m.leagueContextName =
        m.leagueContextName || activeLeague?.displayName || activeLeague?.name;
    }
  }
  let cupState = checkpoint.cupState;
  let cupResult = checkpoint.cupResult;
  let cupCampaigns = [...(checkpoint.cupCampaigns || [])];
  let europePlan = checkpoint.europePlan;
  let europeEdition =
    checkpoint.europeEdition ||
    reloadEditionFromWorld(checkpoint.europeEdition || europePlan, world);
  if (europeEdition && !europeEdition.fixtures && europePlan?.editionId) {
    europeEdition = reloadEditionFromWorld(
      { competitionId: europePlan.competitionId, editionId: europePlan.editionId },
      world
    );
  }
  const intlProbe = checkpoint.intlProbe;
  let intlSeason = checkpoint.intlProbe || null;
  let intlPrimaryEdition =
    checkpoint.intlPrimaryEdition ||
    reloadNationalEditionFromWorld(checkpoint.intlPrimaryEdition, world) ||
    (intlSeason?.primaryEdition
      ? reloadNationalEditionFromWorld(intlSeason.primaryEdition, world)
      : null);
  if (!intlPrimaryEdition && intlSeason?.primary?.editionId) {
    intlPrimaryEdition = reloadNationalEditionFromWorld(
      {
        competitionId: intlSeason.primary.competitionId || intlSeason.primary.id,
        editionId: intlSeason.primary.editionId,
      },
      world
    );
  }
  let europeResimMatches = [...(checkpoint.europeResimMatches || [])];
  let intlResimMatches = [...(checkpoint.intlResimMatches || [])];
  const leaguePlayerMatches = [...(checkpoint.leaguePlayerMatches || [])];
  const leagueAllMatches = [...(checkpoint.leagueAllMatches || [])];
  const ledgerRecords = [...(checkpoint.ledgerRecords || [])];
  const playerMatchStats = { ...(checkpoint.playerMatchStats || {}) };
  let lastDate = checkpoint.lastDate;
  const lastDateRef = { current: lastDate };
  const cupRoundDates = checkpoint.cupRoundDates || [];
  const europePlayerSlots = checkpoint.europePlayerSlots || [];
  const intlSlots = checkpoint.intlSlots || [];
  const calendarYear = checkpoint.calendarYear;
  const startAt = (checkpoint.eventIndex ?? 0) + 1;
  let destinationMeta = null;

  // If the player changed club during the pause, attach destination remaining fixtures.
  const pauseClubId = checkpoint.playingClubIdAtPause;
  const nowClubId = player.playingClubId || player.club?.clubId;
  if (pauseClubId && nowClubId && pauseClubId !== nowClubId) {
    const recon = reconcileAfterClubChange({
      player,
      previousClubId: pauseClubId,
      previousLeagueId: checkpoint.leagueId,
      departureDate: checkpoint.lastDate || ordered[checkpoint.eventIndex]?.date,
      ordered,
      eventIndex: checkpoint.eventIndex,
      originSeasonStartYear: checkpoint.seasonStartYear,
      world,
      rng,
      initialisePastDestination: true,
    });
    if (recon.error === "missing-destination-schedule") {
      throw new Error(
        `Cross-league move to ${player.club?.leagueId} has no remaining destination fixtures after ${checkpoint.lastDate}`
      );
    }
    if (recon.ordered) ordered = recon.ordered;
    destinationMeta = recon.destinationMeta;
    player.destinationScheduleMeta = destinationMeta;
    const switched = applyDestinationLeagueContext(recon, world);
    if (switched) {
      activeLeague = switched.activeLeague;
      clubs = switched.clubs;
      records = switched.records;
      historySegment = "destination";
    }
    if (cupState) rebindDomesticCupAttachment(cupState, player);
    if (europeEdition) {
      ordered = mergePendingEvents(
        ordered,
        checkpoint.eventIndex ?? 0,
        eventsForAttachedPendingFixtures(europeEdition, player, {
          onOrAfterDate: checkpoint.lastDate,
        })
      );
    }
  }

  for (let eventIndex = startAt; eventIndex < ordered.length; eventIndex++) {
    const ev = ordered[eventIndex];
    const eventId = `${ev.kind}:${ev.sortKey || ev.date}:${eventIndex}`;
    // Skip only the event we already paused on; later window_decision / scenes must still run.
    if ((checkpoint.processedEventIds || []).includes(eventId)) continue;

    if (ev.kind === "window_decision") {
      const clubBefore = player.playingClubId || player.club?.clubId;
      const leagueBefore = player.club?.leagueId || league.leagueId;
      const pauseResult = handleWindowDecision({
        player,
        seasonIndex: checkpoint.seasonIndex,
        playerMatchStats,
        pauseForDecisions,
        autoDecisionPolicy,
        window: ev.window,
        date: ev.date,
        seasonStartYear: checkpoint.seasonStartYear,
        league: activeLeague || league,
        leagueAllMatches,
      });
      lastDate = ev.date;
      const clubAfter = player.playingClubId || player.club?.clubId;
      if (clubAfter && clubBefore && clubAfter !== clubBefore) {
        const recon = reconcileAfterClubChange({
          player,
          previousClubId: clubBefore,
          previousLeagueId: leagueBefore,
          departureDate: ev.date,
          ordered,
          eventIndex,
          originSeasonStartYear: checkpoint.seasonStartYear,
          world,
          rng,
          initialisePastDestination: true,
        });
        if (recon.error === "missing-destination-schedule") {
          throw new Error(
            `Cross-league move to ${player.club?.leagueId} has no remaining destination fixtures after ${ev.date}`
          );
        }
        if (recon.ordered) ordered = recon.ordered;
        destinationMeta = recon.destinationMeta;
        player.destinationScheduleMeta = destinationMeta;
        const switched = applyDestinationLeagueContext(recon, world);
        if (switched) {
          activeLeague = switched.activeLeague;
          clubs = switched.clubs;
          records = switched.records;
          historySegment = "destination";
        }
        if (cupState) rebindDomesticCupAttachment(cupState, player);
        if (europeEdition) {
          ordered = mergePendingEvents(
            ordered,
            eventIndex,
            eventsForAttachedPendingFixtures(europeEdition, player, { onOrAfterDate: ev.date })
          );
        }
      }
      if (pauseResult?.pause) {
        const ck = buildSeasonCheckpoint({
          seasonIndex: checkpoint.seasonIndex,
          leagueId: activeLeague.leagueId || league.leagueId || league.name,
          eventIndex,
          ordered,
          clubs,
          records,
          cupState,
          cupResult,
          cupCampaigns,
          europePlan,
          europeEdition,
          intlProbe,
          intlPrimaryEdition,
          europeResimMatches,
          intlResimMatches,
          leaguePlayerMatches,
          leagueAllMatches,
          ledgerRecords,
          playerMatchStats,
          lastDate,
          processedEventIds: [...(checkpoint.processedEventIds || []), eventId],
          cupRoundDates,
          europePlayerSlots,
          intlSlots,
          seasonStartYear: checkpoint.seasonStartYear,
          calendarYear,
          rngState: rng.seed(),
          selRngState: selRng.seed(),
          injuryRngState: injuryRng.seed(),
          decision: pauseResult.decision,
          offers: pauseResult.offers,
          playingClubIdAtPause: player.playingClubId || player.club?.clubId,
          employmentClubIdAtPause: player.employmentClubId || player.club?.clubId,
          status: "awaiting_decision",
        });
        player.seasonCheckpoint = ck;
        player.pendingDecision = pauseResult.decision;
        player.pendingOffers = pauseResult.offers || [];
        return {
          status: "awaiting_decision",
          checkpoint: ck,
          decision: pauseResult.decision,
          offers: pauseResult.offers,
          partialPlayerMatchStats: { ...playerMatchStats },
          chronology: { events: ordered.length, lastDate, pausedAt: ev.date },
        };
      }
      continue;
    }
    if (ev.kind === "senior_scenario") {
      const sceneResult = handleSeniorScenarioEvent({
        player,
        event: ev,
        pauseForDecisions,
        autoDecisionPolicy,
        playerMatchStats,
        intlProbe,
        leaguePlayerMatches,
        ordered,
        eventIndex,
      });
      lastDate = ev.date;
      if (sceneResult?.pause) {
        const ck = buildSeasonCheckpoint({
          seasonIndex: checkpoint.seasonIndex,
          leagueId: activeLeague.leagueId || league.leagueId || league.name,
          eventIndex,
          ordered,
          clubs,
          records,
          cupState,
          cupResult,
          cupCampaigns,
          europePlan,
          europeEdition,
          intlProbe,
          intlPrimaryEdition,
          europeResimMatches,
          intlResimMatches,
          leaguePlayerMatches,
          leagueAllMatches,
          ledgerRecords,
          playerMatchStats,
          lastDate,
          processedEventIds: [...(checkpoint.processedEventIds || []), eventId],
          cupRoundDates,
          europePlayerSlots,
          intlSlots,
          seasonStartYear: checkpoint.seasonStartYear,
          calendarYear,
          rngState: rng.seed(),
          selRngState: selRng.seed(),
          injuryRngState: injuryRng.seed(),
          decision: null,
          offers: [],
          playingClubIdAtPause: player.playingClubId || player.club?.clubId,
          employmentClubIdAtPause: player.employmentClubId || player.club?.clubId,
          pendingSeniorScenario: sceneResult.pending,
          status: "awaiting_scenario",
        });
        player.seasonCheckpoint = ck;
        player.pendingSeniorScenario = sceneResult.pending;
        return {
          status: "awaiting_scenario",
          checkpoint: ck,
          pendingSeniorScenario: sceneResult.pending,
          partialPlayerMatchStats: { ...playerMatchStats },
          chronology: { events: ordered.length, lastDate, pausedAt: ev.date },
        };
      }
      continue;
    }
    if (ev.kind === "registration_effective") {
      if (player.pendingRegistration?.effectiveDate === ev.date) {
        player.pendingRegistration = null;
      }
      lastDate = ev.date;
      continue;
    }
    if (ev.kind === "dest_cup_round") {
      if (player.playingClubId || ev.destinationLeagueId) {
        const destLeague = findLeagueById(ev.destinationLeagueId) || activeLeague;
        if (destLeague && (!cupState || !cupState._destBound)) {
          if (cupState && !cupState._destBound) {
            if (!cupResult) {
              cupState.playerAttached = false;
              cupResult = finalizeDomesticCup(cupState);
            }
            cupCampaigns = rememberCupCampaign(cupCampaigns, cupResult);
          }
          cupState = prepareDestinationCupContinuation(destLeague, player, {
            asOfDate: ev.date,
            seasonStartYear:
              ev.destinationSeasonStartYear ||
              destinationMeta?.scheduleSeasonStartYear ||
              seasonStartYear,
          });
        }
        if (cupState && cupState._destBound && !cupState.finished) {
          simulateDomesticCupRound(cupState, {
            player,
            date: ev.date,
            matchProcessor: ({ home, away, playerSide, date, label }) =>
              processPlayerMatchDay({
                home,
                away,
                player,
                playerSide,
                date,
                lastDate,
                competition: "cup",
                competitionType: "domesticCup",
                competitionId: cupState.config.name,
                fixtureId: `destcup:${cupState.config.name}:${ev.roundIndex}:${label}`,
                teamType: "club",
                competitionPriority: 0.85,
                rng,
                selRng,
                injuryRng,
                worldState: world,
                resolveKnockout,
              }),
          });
          const proc = cupState.lastProcessorResult;
          if (proc?.ledgerRecord) {
            ledgerRecords.push(proc.ledgerRecord);
            accumulatePlayerStats(playerMatchStats, proc.match, proc.participation);
          }
          cupState.lastProcessorResult = null;
          if (cupState.finished || cupState.eliminatedRound) {
            const destCup = finalizeDomesticCup(cupState);
            cupCampaigns = rememberCupCampaign(cupCampaigns, destCup);
            cupResult = destCup;
          }
        }
      }
      lastDate = ev.date;
      continue;
    }

    if (ev.kind === "league") {
      const fx = ev;
      const competitionId = ev.destinationLeagueId || activeLeague.leagueId || league.leagueId;
      let playerIn = resolveValidatedClubSide({
        player,
        home: fx.home,
        away: fx.away,
        date: fx.date,
        teamType: "club",
      });
      if (playerIn && !playerEligibleForClubMatch(player, fx.date)) {
        playerIn = null;
      }
      const matchday = leagueMatchday(ev, clubs.length);
      const fixtureId = ev.fixtureId || `${competitionId}:md:${ev.index}`;

      if (!playerIn) {
        const match = simulateMatch(fx.home, fx.away, {
          competition: "league",
          worldState: world,
          rng,
          competitionId,
          fixtureId,
          date: fx.date,
        });
        match.matchday = matchday;
        match.round = `Matchday ${match.matchday}`;
        tagLeagueMatch(match, { activeLeague, player, historySegment, seasonStartYear, world });
        applyMatchFormUpdate(world, match);
        leagueAllMatches.push(match);
        ensureRecordClub(records, match.home, world);
        ensureRecordClub(records, match.away, world);
        updateLeagueRecords(records, match);
        continue;
      }

      const { match, participation, ledgerRecord } = processPlayerMatchDay({
        home: fx.home,
        away: fx.away,
        player,
        playerSide: playerIn,
        date: fx.date,
        lastDate,
        competition: "league",
        competitionType: "league",
        competitionId,
        fixtureId,
        teamType: "club",
        competitionPriority: 1,
        rng,
        selRng,
        injuryRng,
        worldState: world,
      });
      match.matchday = matchday;
      match.round = `Matchday ${match.matchday}`;
      tagLeagueMatch(match, { activeLeague, player, historySegment, seasonStartYear, world });
      leagueAllMatches.push(match);
      leaguePlayerMatches.push(match);
      ensureRecordClub(records, match.home, world);
      ensureRecordClub(records, match.away, world);
      updateLeagueRecords(records, match);
      if (ledgerRecord) {
        ledgerRecords.push(ledgerRecord);
        accumulatePlayerStats(playerMatchStats, match, participation);
      }
      lastDate = fx.date;
    } else if (ev.kind === "cup_round") {
      if (cupResult) continue;
      if (!cupState) cupState = prepareDomesticCupBracket(league, player);
      if (cupState.finished || cupState.remaining.length <= 1) {
        cupResult = finalizeDomesticCup(cupState);
        continue;
      }
      const playerStillIn =
        cupState.playerAttached !== false &&
        !cupState.eliminatedRound &&
        cupState.remaining.some(
          (c) =>
            c &&
            !c.isBye &&
            ((cupState.playerClubId && c.clubId === cupState.playerClubId) ||
              c.name === cupState.playerName)
        );
      simulateDomesticCupRound(cupState, {
        player,
        date: ev.date,
        matchProcessor: ({ home, away, playerSide, date, label }) => {
          const result = processPlayerMatchDay({
            home,
            away,
            player,
            playerSide,
            date,
            lastDate,
            competition: "cup",
            competitionType: "domesticCup",
            competitionId: cupState.config.name,
            fixtureId: `cup:${cupState.config.name}:${ev.roundIndex}:${label}`,
            teamType: "club",
            competitionPriority: 0.9,
            rng,
            selRng,
            injuryRng,
            worldState: world,
            resolveKnockout,
          });
          return result;
        },
      });
      const proc = cupState.lastProcessorResult;
      if (proc) {
        if (proc.ledgerRecord) {
          ledgerRecords.push(proc.ledgerRecord);
          accumulatePlayerStats(playerMatchStats, proc.match, proc.participation);
        }
        lastDate = ev.date;
        cupState.lastProcessorResult = null;
      }
      if (cupState.finished || cupState.remaining.length <= 1) {
        cupResult = finalizeDomesticCup(cupState);
      } else if (!playerStillIn || cupState.eliminatedRound) {
        cupResult = finalizeDomesticCup(cupState);
      }
    } else if (
      ev.kind === "continental_md" ||
      ev.kind === "continental_fixture" ||
      ev.kind === "continental_gate"
    ) {
      if (!europeEdition || europePlan?.showcase || europePlan?.qualified === false) continue;
      lastDateRef.current = lastDate;
      const processed = processContinentalChronoEvent({
        ev,
        edition: europeEdition,
        ordered,
        eventIndex,
        player,
        rng,
        selRng,
        injuryRng,
        world,
        lastDateRef,
        ledgerRecords,
        playerMatchStats,
        accumulatePlayerStats,
      });
      europeEdition = processed.edition;
      ordered = processed.ordered;
      if (processed.europePlan) europePlan = processed.europePlan;
      lastDate = lastDateRef.current || ev.date;
    } else if (ev.kind === "national_md" || ev.kind === "national_fixture") {
      if (!intlPrimaryEdition) continue;
      lastDateRef.current = lastDate;
      const processed = processNationalChronoEvent({
        ev,
        edition: intlPrimaryEdition,
        ordered,
        eventIndex,
        player,
        rng,
        selRng,
        injuryRng,
        world,
        lastDateRef,
        ledgerRecords,
        playerMatchStats,
        accumulatePlayerStats,
      });
      intlPrimaryEdition = processed.edition;
      ordered = processed.ordered;
      if (processed.campaignView && intlSeason) {
        intlSeason.primary = processed.campaignView;
        intlSeason.playerMatches = processed.campaignView.playerMatches || [];
      }
      lastDate = lastDateRef.current || ev.date;
    }
  }

  if (!cupResult) {
    if (!cupState) cupState = prepareDomesticCupBracket(activeLeague, player);
    cupResult = finalizeDomesticCup(cupState);
  }
  cupCampaigns = rememberCupCampaign(cupCampaigns, cupResult);
  if (europeEdition && !europePlan?.showcase) {
    lastDateRef.current = lastDate;
    europePlan = finalizeSeasonContinental({
      edition: europeEdition,
      player,
      rng,
      selRng,
      injuryRng,
      world,
      lastDateRef,
      ledgerRecords,
      playerMatchStats,
      accumulatePlayerStats,
    }) || europePlan;
  }
  // National editions finalize through the store-backed lifecycle (no reconcile/replay).
  if (typeof intlSeason !== "undefined" && (intlSeason?.editions?.length || intlPrimaryEdition)) {
    lastDateRef.current = lastDate;
    const finalizedIntl = finalizeSeasonNational({
      edition: intlPrimaryEdition,
      season: intlSeason,
      player,
      rng,
      selRng,
      injuryRng,
      world,
      lastDateRef,
      ledgerRecords,
      playerMatchStats,
      accumulatePlayerStats,
    });
    if (finalizedIntl) {
      Object.assign(intlProbe, finalizedIntl);
    }
  }

  const table = buildTable(records);
  if (world) world.standings.set(activeLeague.leagueId || activeLeague.name, table);
  player.seasonCheckpoint = null;
  const playerRecord = findPlayingClubRow(table, player);
  const leagueMatchSegments = buildLeagueMatchSegments(leaguePlayerMatches);

  return {
    status: "complete",
    table,
    activeLeague,
    playerRecord,
    playerMatches: leaguePlayerMatches,
    allMatches: leagueAllMatches,
    leagueMatchSegments,
    playerMatchStats,
    ledgerRecords,
    expectedMatches: leagueMatchCount(activeLeague),
    domesticCupResult: cupResult,
    domesticCupCampaigns: cupCampaigns.length ? cupCampaigns : cupResult ? [cupResult] : [],
    europeanCampaign: europePlan,
    internationalSeason: intlProbe,
    chronology: {
      events: ordered.length,
      lastDate,
      cupRounds: cupRoundDates.length,
      europeSlots: europePlayerSlots.length,
      intlSlots: intlSlots.length,
      resumedFrom: checkpoint.eventIndex,
      activeLeagueId: activeLeague.leagueId,
      playingClubId: player.playingClubId || player.club?.clubId,
      employmentClubId: player.employmentClubId || null,
    },
  };
}
