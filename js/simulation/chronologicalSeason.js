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
  dateCupRounds,
  dateContinentalMatches,
  dateInternationalWindows,
  sortChronological,
  simDate,
} from "./seasonCalendar.js";
import { squadReviewCheckpointDate } from "../data/registrationWindows.js";
import { evaluateSquadDecision, resolveSquadDecision } from "./squadDecisions.js";
import { generateLoanOffers } from "./loanMarket.js";
import { generatePipelineOffers } from "./dealPipeline.js";
import { exportClubFinanceState, importClubFinanceState } from "./clubFinance.js";
import {
  reconcileAfterClubChange,
  playerEligibleForClubMatch,
} from "./destinationSchedule.js";
import { applyDecisionPolicy } from "./decisionPolicies.js";
import { processPlayerMatchDay } from "./playerMatchDay.js";
import { resolveKnockout } from "./matchEngine.js";
import { simulateMatch } from "./matchEngine.js";
import { applyMatchFormUpdate } from "./worldState.js";
import { stableCareerId } from "./playerDevelopmentModel.js";
import {
  simulateEuropeanCampaign,
  simulateEuropeanFinalsShowcase,
} from "./europeanCompetition.js";
import { simulateInternationalSeason } from "./nationalTeam.js";
import {
  prepareDomesticCupBracket,
  simulateDomesticCupRound,
  finalizeDomesticCup,
} from "./domesticCup.js";
import { leagueMatchCount } from "./leaguePhase.js";

function ensurePlayerInClubs(league, player) {
  const clubs = [...(league.clubs || [])].map(attachClubIdentity);
  if (!player?.club?.name) return clubs;
  if (clubs.some((c) => c.name === player.club.name || c.clubId === player.club.clubId)) return clubs;
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

function createLeagueRecords(clubs, world) {
  return new Map(clubs.map((c) => {
    const eff = effectiveTeamStrength(c, { worldState: world });
    return [c.name, {
      name: c.name, displayName: c.displayName, badge: c.badge, clubId: c.clubId,
      played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0,
      strength: eff.overall, overall: eff.overall, attack: eff.attack,
      midfield: eff.midfield, defence: eff.defence, goalkeeper: eff.goalkeeper,
      strengthTier: eff.tierLabel,
    }];
  }));
}

// The playing league owns standings. Employment stays with the parent on a loan.
function destinationLeagueContext(recon, world) {
  if (!recon.destinationLeague) return null; // same-league move keeps its table
  const records = createLeagueRecords(recon.destinationClubs, world);
  for (const match of recon.destinationPastMatches || []) updateLeagueRecords(records, match);
  return { league: recon.destinationLeague, clubs: recon.destinationClubs, records };
}

/**
 * Pre-season continental entry proxy when current-season standing is unknown.
 * Prefers previous season finish; otherwise uses club quality bands.
 */
export function preSeasonContinentalStanding(player, league) {
  const prev = player.latestStanding?.playerRow;
  if (prev?.position) {
    return {
      position: prev.position,
      points: prev.points || 0,
      qualification: null,
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
  return {
    position,
    points: 0,
    qualification: null,
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

  if (checkpoint?.status === "awaiting_decision") {
    return resumeChronologicalSeason({
      player,
      league,
      seasonIndex,
      checkpoint,
      pauseForDecisions: false,
      autoDecisionPolicy,
    });
  }

  // ---- League fixtures ----
  let clubs = ensurePlayerInClubs(league, player).map((c) =>
    attachClubIdentity({
      ...c,
      tier: league.tier,
      league: league.name,
      leagueId: league.leagueId,
      nation: league.nation,
    })
  );
  const fixtures = [];
  for (let i = 0; i < clubs.length; i++) {
    for (let j = 0; j < clubs.length; j++) {
      if (i !== j) fixtures.push({ home: clubs[i], away: clubs[j] });
    }
  }
  const datedLeague = dateLeagueFixtures(rng.shuffle(fixtures), seasonStartYear);

  let records = createLeagueRecords(clubs, world);

  // ---- Pre-plan cup / europe / intl as dated "round" events ----
  const cupRoundDates = dateCupRounds(
    [{}, {}, {}, {}, {}, {}, {}],
    seasonStartYear
  ).map((r) => r.date);

  // Continental: eligibility from prior standing / quality; schedule KO dates.
  const preStanding = preSeasonContinentalStanding(player, league);
  let europePlan = null;
  if (preStanding) {
    europePlan = simulateEuropeanCampaign({
      standing: preStanding,
      league,
      performanceScore: 70,
      player,
    });
  }
  if (!europePlan) {
    europePlan = { ...simulateEuropeanFinalsShowcase(league), qualified: false, showcase: true };
  }

  // Date player's continental matches across the season; non-player rounds
  // are already simulated inside europePlan — we re-process PLAYER matches
  // chronologically with health by replaying dated slots that gate participation.
  // Practical approach: take playerMatches from europePlan, assign dates, and
  // when that date arrives run processPlayerMatchDay against the same opponents
  // (fresh sim with current health) instead of trusting the pre-sim stats.
  const europePlayerSlots = dateContinentalMatches(
    (europePlan.playerMatches || []).map((m, i) => ({
      index: i,
      home: m.home,
      away: m.away,
      round: m.round,
      prior: m,
    })),
    seasonStartYear
  );

  // International: decide call-up early using form seed; schedule windows.
  const intlProbe = simulateInternationalSeason({
    player,
    calendarYear,
    avgMatchRating: 6.8,
  });
  const intlSlots = dateInternationalWindows(
    (intlProbe.playerMatches || []).map((m, i) => ({
      index: i,
      prior: m,
      home: m.home,
      away: m.away,
    })),
    calendarYear
  );
  // If called up but tournament is summer-only with few matches, still place them.
  if (intlProbe.calledUp && !intlSlots.length) {
    intlSlots.push({
      index: 0,
      date: simDate(calendarYear + 1, 6, 15),
      competitionType: "international",
      sortKey: `${simDate(calendarYear + 1, 6, 15)}:I:0`,
      prior: null,
      synthetic: true,
    });
  }

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
  europePlayerSlots.forEach((slot, i) => {
    events.push({
      kind: "continental",
      date: slot.date,
      sortKey: slot.sortKey || `${slot.date}:E:${i}`,
      slot,
    });
  });
  intlSlots.forEach((slot, i) => {
    events.push({
      kind: "international",
      date: slot.date,
      sortKey: slot.sortKey || `${slot.date}:I:${i}`,
      slot,
    });
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

  let ordered = sortChronological(events);

  let cupState = null;
  let cupResult = null;
  let europeResimMatches = [];
  let intlResimMatches = [];
  const leaguePlayerMatches = [];
  const leagueAllMatches = [];
  const ledgerRecords = [];
  const playerMatchStats = { played: 0, goals: 0, assists: 0, yellow: 0, red: 0, minutes: 0, starts: 0 };
  let lastDate = null;
  const processedEventIds = [];

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
        const destination = destinationLeagueContext(recon, world);
        if (destination) {
          if (world) world.standings.set(league.leagueId || league.name, buildTable(records));
          ({ league, clubs, records } = destination);
          leagueAllMatches.push(...(recon.destinationPastMatches || []));
        }
        player.destinationScheduleMeta = recon.destinationMeta;
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
          europePlan,
          intlProbe,
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
    if (ev.kind === "registration_effective") {
      if (player.pendingRegistration?.effectiveDate === ev.date) {
        player.pendingRegistration = null;
      }
      lastDate = ev.date;
      continue;
    }
    if (ev.kind === "dest_cup_round") {
      // Lightweight destination cup: skip detailed bracket; no forced appearances.
      lastDate = ev.date;
      continue;
    }
    if (ev.kind === "league") {
      const fx = ev;
      const playingName = player.club?.name;
      const playingId = player.playingClubId || player.club?.clubId;
      const homeIsPlayer =
        fx.home.name === playingName || (playingId && fx.home.clubId === playingId);
      const awayIsPlayer =
        fx.away.name === playingName || (playingId && fx.away.clubId === playingId);
      let playerIn = homeIsPlayer ? "home" : awayIsPlayer ? "away" : null;
      if (playerIn && !playerEligibleForClubMatch(player, fx.date)) {
        playerIn = null;
      }

      if (!playerIn) {
        const match = simulateMatch(fx.home, fx.away, {
          competition: "league",
          worldState: world,
          rng,
          competitionId: league.leagueId,
          fixtureId: `${league.leagueId}:md:${ev.index}`,
          date: fx.date,
        });
        match.matchday = Math.floor(ev.index / Math.max(1, Math.floor(clubs.length / 2))) + 1;
        match.round = `Matchday ${match.matchday}`;
        applyMatchFormUpdate(world, match);
        leagueAllMatches.push(match);
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
        competitionId: league.leagueId,
        fixtureId: `${league.leagueId}:md:${ev.index}`,
        teamType: "club",
        competitionPriority: 1,
        rng,
        selRng,
        injuryRng,
        worldState: world,
      });
      match.matchday = Math.floor(ev.index / Math.max(1, Math.floor(clubs.length / 2))) + 1;
      match.round = `Matchday ${match.matchday}`;
      leagueAllMatches.push(match);
      leaguePlayerMatches.push(match);
      updateLeagueRecords(records, match);
      if (ledgerRecord) {
        ledgerRecords.push(ledgerRecord);
        accumulatePlayerStats(playerMatchStats, match, participation);
      }
      lastDate = fx.date;
    } else if (ev.kind === "cup_round") {
      if (cupResult) continue;
      if (!cupState) cupState = prepareDomesticCupBracket(league, player);

      const playerStillIn =
        !cupState.eliminatedRound &&
        cupState.remaining.some((c) => c && !c.isBye && c.name === cupState.playerName);

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
    } else if (ev.kind === "continental") {
      if (europePlan.showcase || europePlan.qualified === false) continue;
      const slot = ev.slot;
      const prior = slot.prior;
      if (!prior?.home || !prior?.away) continue;
      const playerSide = prior.playerSide;
      if (!playerSide) continue;
      const { match, participation, ledgerRecord } = processPlayerMatchDay({
        home: prior.home,
        away: prior.away,
        player,
        playerSide,
        date: ev.date,
        lastDate,
        competition: "europe",
        competitionType: "continental",
        competitionId: europePlan.competition,
        fixtureId: `europe:${europePlan.competition}:${slot.index}`,
        teamType: "club",
        competitionPriority: 1.05,
        venue: prior.venue || "home",
        rng,
        selRng,
        injuryRng,
        worldState: world,
        resolveKnockout,
      });
      match.round = prior.round || slot.round;
      europeResimMatches.push(match);
      if (ledgerRecord) {
        ledgerRecords.push(ledgerRecord);
        accumulatePlayerStats(playerMatchStats, match, participation);
      }
      lastDate = ev.date;
    } else if (ev.kind === "international") {
      if (!intlProbe.calledUp) continue;
      const slot = ev.slot;
      const prior = slot.prior;
      // Build sides from prior match or synthetic nation vs opponent
      let home = prior?.home;
      let away = prior?.away;
      let playerSide = prior?.playerSide || "home";
      if (!home || !away) {
        // Synthetic window match: nation vs generic opponent shell
        home = {
          name: player.nationality,
          displayName: player.nationality,
          isNation: true,
          nationId: player.nationality,
        };
        away = {
          name: "International Opponent",
          displayName: "International Opponent",
          isNation: true,
          nationId: "OPP",
        };
        playerSide = "home";
      }
      const { match, participation, ledgerRecord } = processPlayerMatchDay({
        home,
        away,
        player,
        playerSide,
        date: ev.date,
        lastDate,
        competition: "international",
        competitionType: "international",
        competitionId: intlProbe.callUpTournament || "international",
        fixtureId: `intl:${calendarYear}:${slot.index}`,
        teamType: "national",
        competitionPriority: 1.1,
        venue: "neutral",
        rng,
        selRng,
        injuryRng,
        worldState: world,
      });
      intlResimMatches.push(match);
      if (ledgerRecord) {
        ledgerRecords.push(ledgerRecord);
        accumulatePlayerStats(playerMatchStats, match, participation);
      }
      lastDate = ev.date;
    }
  }

  if (!cupResult) {
    if (!cupState) cupState = prepareDomesticCupBracket(league, player);
    cupResult = finalizeDomesticCup(cupState);
  }

  if (europeResimMatches.length) {
    europePlan = { ...europePlan, playerMatches: europeResimMatches };
  }
  if (intlResimMatches.length) {
    intlProbe.playerMatches = intlResimMatches;
  }

  const table = buildTable(records);
  if (world) world.standings.set(league.leagueId || league.name, table);
  player.seasonCheckpoint = null;

  return {
    status: "complete",
    league,
    table,
    playerRecord:
      table.find(
        (r) =>
          r.name === player.club?.name ||
          (player.playingClubId && r.clubId === player.playingClubId)
      ) || null,
    playerMatches: leaguePlayerMatches,
    allMatches: leagueAllMatches,
    playerMatchStats,
    ledgerRecords,
    expectedMatches: leagueMatchCount(league),
    domesticCupResult: cupResult,
    europeanCampaign: europePlan,
    internationalSeason: intlProbe,
    chronology: {
      events: ordered.length,
      lastDate,
      cupRounds: cupRoundDates.length,
      europeSlots: europePlayerSlots.length,
      intlSlots: intlSlots.length,
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

function buildSeasonCheckpoint(parts) {
  return {
    status: "awaiting_decision",
    version: 1,
    seasonIndex: parts.seasonIndex,
    leagueId: parts.leagueId,
    eventIndex: parts.eventIndex,
    seasonStartYear: parts.seasonStartYear,
    calendarYear: parts.calendarYear,
    lastDate: parts.lastDate,
    rngState: parts.rngState,
    finance: exportClubFinanceState(),
    processedEventIds: parts.processedEventIds,
    // Serializable accumulators
    records: [...parts.records.entries()],
    clubs: parts.clubs,
    cupState: parts.cupState,
    cupResult: parts.cupResult,
    europePlan: parts.europePlan,
    intlProbe: parts.intlProbe,
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
    playingClubIdAtPause: parts.playingClubIdAtPause,
    employmentClubIdAtPause: parts.employmentClubIdAtPause,
  };
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
  if (checkpoint.finance) importClubFinanceState(checkpoint.finance);

  const rng = getSimRng();
  if (checkpoint.rngState != null) rng.setSeed(checkpoint.rngState);
  const careerId = stableCareerId(player);
  const selRng = createStreamRng(careerId, `selection:chrono:${seasonIndex}:resume`);
  const injuryRng = createStreamRng(careerId, `injury:chrono:${seasonIndex}:resume`);
  const world = getWorldState();

  let ordered = checkpoint.ordered;
  let clubs = checkpoint.clubs;
  let records = new Map(checkpoint.records || []);
  let cupState = checkpoint.cupState;
  let cupResult = checkpoint.cupResult;
  let europePlan = checkpoint.europePlan;
  const intlProbe = checkpoint.intlProbe;
  let europeResimMatches = [...(checkpoint.europeResimMatches || [])];
  let intlResimMatches = [...(checkpoint.intlResimMatches || [])];
  const leaguePlayerMatches = [...(checkpoint.leaguePlayerMatches || [])];
  const leagueAllMatches = [...(checkpoint.leagueAllMatches || [])];
  const ledgerRecords = [...(checkpoint.ledgerRecords || [])];
  const playerMatchStats = { ...(checkpoint.playerMatchStats || {}) };
  let lastDate = checkpoint.lastDate;
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
    const destination = destinationLeagueContext(recon, world);
    if (destination) {
      if (world) world.standings.set(checkpoint.leagueId, buildTable(records));
      ({ league, clubs, records } = destination);
      leagueAllMatches.push(...(recon.destinationPastMatches || []));
    }
    destinationMeta = recon.destinationMeta;
    player.destinationScheduleMeta = destinationMeta;
  }

  for (let eventIndex = startAt; eventIndex < ordered.length; eventIndex++) {
    const ev = ordered[eventIndex];
    if (ev.kind === "window_decision") continue; // already processed
    if (ev.kind === "registration_effective") {
      if (player.pendingRegistration?.effectiveDate === ev.date) {
        player.pendingRegistration = null;
      }
      lastDate = ev.date;
      continue;
    }
    if (ev.kind === "dest_cup_round") {
      lastDate = ev.date;
      continue;
    }

    if (ev.kind === "league") {
      const fx = ev;
      const playingName = player.club?.name;
      const playingId = player.playingClubId || player.club?.clubId;
      const homeIsPlayer =
        fx.home.name === playingName || (playingId && fx.home.clubId === playingId);
      const awayIsPlayer =
        fx.away.name === playingName || (playingId && fx.away.clubId === playingId);
      let playerIn = homeIsPlayer ? "home" : awayIsPlayer ? "away" : null;
      if (playerIn && !playerEligibleForClubMatch(player, fx.date)) {
        playerIn = null;
      }

      if (!playerIn) {
        const match = simulateMatch(fx.home, fx.away, {
          competition: "league",
          worldState: world,
          rng,
          competitionId: league.leagueId,
          fixtureId: `${league.leagueId}:md:${ev.index}`,
          date: fx.date,
        });
        match.matchday = Math.floor(ev.index / Math.max(1, Math.floor(clubs.length / 2))) + 1;
        match.round = `Matchday ${match.matchday}`;
        applyMatchFormUpdate(world, match);
        leagueAllMatches.push(match);
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
        competitionId: league.leagueId,
        fixtureId: `${league.leagueId}:md:${ev.index}`,
        teamType: "club",
        competitionPriority: 1,
        rng,
        selRng,
        injuryRng,
        worldState: world,
      });
      match.matchday = Math.floor(ev.index / Math.max(1, Math.floor(clubs.length / 2))) + 1;
      match.round = `Matchday ${match.matchday}`;
      leagueAllMatches.push(match);
      leaguePlayerMatches.push(match);
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
        !cupState.eliminatedRound &&
        cupState.remaining.some((c) => c && !c.isBye && c.name === cupState.playerName);
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
    } else if (ev.kind === "continental") {
      if (europePlan.showcase || europePlan.qualified === false) continue;
      const slot = ev.slot;
      const prior = slot.prior;
      if (!prior?.home || !prior?.away) continue;
      const playerSide = prior.playerSide;
      if (!playerSide) continue;
      const { match, participation, ledgerRecord } = processPlayerMatchDay({
        home: prior.home,
        away: prior.away,
        player,
        playerSide,
        date: ev.date,
        lastDate,
        competition: "europe",
        competitionType: "continental",
        competitionId: europePlan.competition,
        fixtureId: `europe:${europePlan.competition}:${slot.index}`,
        teamType: "club",
        competitionPriority: 1.05,
        venue: prior.venue || "home",
        rng,
        selRng,
        injuryRng,
        worldState: world,
        resolveKnockout,
      });
      match.round = prior.round || slot.round;
      europeResimMatches.push(match);
      if (ledgerRecord) {
        ledgerRecords.push(ledgerRecord);
        accumulatePlayerStats(playerMatchStats, match, participation);
      }
      lastDate = ev.date;
    } else if (ev.kind === "international") {
      if (!intlProbe.calledUp) continue;
      const slot = ev.slot;
      const prior = slot.prior;
      let home = prior?.home;
      let away = prior?.away;
      let playerSide = prior?.playerSide || "home";
      if (!home || !away) {
        home = {
          name: player.nationality,
          displayName: player.nationality,
          isNation: true,
          nationId: player.nationality,
        };
        away = {
          name: "International Opponent",
          displayName: "International Opponent",
          isNation: true,
          nationId: "OPP",
        };
        playerSide = "home";
      }
      const { match, participation, ledgerRecord } = processPlayerMatchDay({
        home,
        away,
        player,
        playerSide,
        date: ev.date,
        lastDate,
        competition: "international",
        competitionType: "international",
        competitionId: intlProbe.callUpTournament || "international",
        fixtureId: `intl:${calendarYear}:${slot.index}`,
        teamType: "national",
        competitionPriority: 1.1,
        venue: "neutral",
        rng,
        selRng,
        injuryRng,
        worldState: world,
      });
      intlResimMatches.push(match);
      if (ledgerRecord) {
        ledgerRecords.push(ledgerRecord);
        accumulatePlayerStats(playerMatchStats, match, participation);
      }
      lastDate = ev.date;
    }
  }

  if (!cupResult) {
    if (!cupState) cupState = prepareDomesticCupBracket(league, player);
    cupResult = finalizeDomesticCup(cupState);
  }
  if (europeResimMatches.length) {
    europePlan = { ...europePlan, playerMatches: europeResimMatches };
  }
  if (intlResimMatches.length) {
    intlProbe.playerMatches = intlResimMatches;
  }

  const table = buildTable(records);
  if (world) world.standings.set(league.leagueId || league.name, table);
  player.seasonCheckpoint = null;

  return {
    status: "complete",
    league,
    table,
    playerRecord:
      table.find(
        (r) =>
          r.name === player.club?.name ||
          (player.playingClubId && r.clubId === player.playingClubId)
      ) || null,
    playerMatches: leaguePlayerMatches,
    allMatches: leagueAllMatches,
    playerMatchStats,
    ledgerRecords,
    expectedMatches: leagueMatchCount(league),
    domesticCupResult: cupResult,
    europeanCampaign: europePlan,
    internationalSeason: intlProbe,
    chronology: {
      events: ordered.length,
      lastDate,
      cupRounds: cupRoundDates.length,
      europeSlots: europePlayerSlots.length,
      intlSlots: intlSlots.length,
      resumedFrom: checkpoint.eventIndex,
    },
  };
}
