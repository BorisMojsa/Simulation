/**
 * Continental result integrity: schedule constraints, table accounting,
 * identity, playoffs, two-leg resolution, chronology agreement.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LEAGUES } from "../js/data/leagues.js";
import { createRng } from "../js/simulation/rng.js";
import { createWorldState, setWorldState, serializeWorldState, deserializeWorldState } from "../js/simulation/worldState.js";
import {
  generateStartingAttributes,
  initializePlayerDevelopment,
} from "../js/simulation/playerDevelopmentModel.js";
import {
  buildLeaguePhaseSchedule,
  validateLeaguePhaseSchedule,
} from "../js/simulation/continentalSchedule.js";
import {
  prepareContinentalEdition,
  processContinentalMatchday,
  processContinentalFixture,
  advanceContinentalStage,
  simulateContinentalCampaign,
  buildContinentalCampaignView,
  listContinentalFixtures,
  simulatePlayoffRound,
} from "../js/simulation/continentalTournament.js";
import { resolveTwoLeggedTie, simulateMatch } from "../js/simulation/matchEngine.js";
import { simulateChronologicalSeason } from "../js/simulation/chronologicalSeason.js";
import { getMatch } from "../js/simulation/competitionStore.js";
import { effectiveTeamStrength } from "../js/simulation/teamStrength.js";
import { attachClubIdentity } from "../js/simulation/worldState.js";

function englandSpainField(n = 36) {
  return LEAGUES.filter((l) => l.nation === "England" || l.nation === "Spain")
    .flatMap((l) => l.clubs)
    .slice(0, n);
}

function redStarSetup(seed = 3) {
  const world = createWorldState({ seed, startYear: 2026 });
  setWorldState(world);
  const league = LEAGUES.find((l) => l.nation === "Serbia");
  const club = league.clubs.find((c) => /Red Star/.test(c.name));
  const rng = createRng(42);
  const player = {
    name: "Continental audit",
    nationality: "Serbia",
    position: "CM",
    age: 22,
    careerId: `continental-audit-${seed}`,
    startYear: 2026,
    rating: 72,
    attributes: generateStartingAttributes("CM", 72, 99, rng),
    club: { ...club, league: league.name, leagueId: league.leagueId, nation: league.nation },
    latestStanding: {
      leagueId: league.leagueId,
      playerRow: { position: 2, qualification: "Europa League", points: 60 },
    },
  };
  initializePlayerDevelopment(player, { rng, careerId: player.careerId });
  return { world, league, club, player };
}

function tallyClub(matches, clubId) {
  const tally = { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, h: 0, a: 0 };
  for (const m of matches) {
    const home = m.home?.clubId === clubId || m.homeClubId === clubId;
    const away = m.away?.clubId === clubId || m.awayClubId === clubId;
    if (!home && !away) continue;
    const gf = home ? m.homeGoals : m.awayGoals;
    const ga = home ? m.awayGoals : m.homeGoals;
    tally.p += 1;
    tally.gf += gf;
    tally.ga += ga;
    if (home) tally.h += 1;
    else tally.a += 1;
    if (gf > ga) {
      tally.w += 1;
      tally.pts += 3;
    } else if (gf === ga) {
      tally.d += 1;
      tally.pts += 1;
    } else {
      tally.l += 1;
    }
  }
  return tally;
}

describe("league-phase schedule constraints", () => {
  for (const [opponents, homeCount, label] of [
    [8, 4, "UCL/UEL"],
    [6, 3, "UECL"],
  ]) {
    it(`${label}: 1000 seeds produce valid 36-club schedules`, () => {
      const field = englandSpainField(36);
      let bad = 0;
      const failedSeeds = [];
      for (let s = 1; s <= 1000; s++) {
        try {
          const fx = buildLeaguePhaseSchedule(field, opponents, homeCount, createRng(s));
          const v = validateLeaguePhaseSchedule(field, fx, { opponents, homeCount });
          if (!v.ok) {
            bad += 1;
            if (failedSeeds.length < 5) failedSeeds.push({ s, reason: v.reason });
          }
          const maxMd = Math.max(...fx.map((f) => f.matchday));
          if (maxMd !== opponents) {
            bad += 1;
            if (failedSeeds.length < 5) failedSeeds.push({ s, reason: `maxMd=${maxMd}` });
          }
        } catch (err) {
          bad += 1;
          if (failedSeeds.length < 5) failedSeeds.push({ s, reason: String(err.message || err) });
        }
      }
      assert.equal(bad, 0, `failures: ${JSON.stringify(failedSeeds)}`);
    });
  }

  it("is deterministic for identical seed and field", () => {
    const field = englandSpainField(36);
    const a = buildLeaguePhaseSchedule(field, 8, 4, createRng(99));
    const b = buildLeaguePhaseSchedule(field, 8, 4, createRng(99));
    assert.deepEqual(
      a.map((f) => [f.matchday, f.home.clubId || f.home.name, f.away.clubId || f.away.name]),
      b.map((f) => [f.matchday, f.home.clubId || f.home.name, f.away.clubId || f.away.name])
    );
  });
});

describe("controlled four-win accounting", () => {
  it("injected results produce P8 W4 D2 L2 Pts14 for Red Star and mirrored opponents", () => {
    const { world, league, club, player } = redStarSetup(7);
    const standing = player.latestStanding.playerRow;
    const state = prepareContinentalEdition({ standing, league, player, seasonYear: 2026 });
    assert.ok(state);
    assert.equal(state.openingMatchdays.length, 8);

    // Build a lookup of Red Star fixtures by MD, then force known scores via matchProcessor.
    const script = {
      1: { gf: 3, ga: 2 }, // home win
      2: { gf: 1, ga: 0 },
      3: { gf: 1, ga: 0 },
      4: { gf: 1, ga: 0 }, // away win (Strasbourg home 0-1)
      5: { gf: 0, ga: 0 },
      6: { gf: 2, ga: 2 },
      7: { gf: 0, ga: 2 }, // away loss
      8: { gf: 1, ga: 3 }, // away loss
    };

    for (const md of state.openingMatchdays) {
      processContinentalMatchday(state, md, {
        player,
        matchProcessor: (req) => {
          const sc = script[md];
          const homeIsPlayer = req.playerSide === "home";
          const homeGoals = homeIsPlayer ? sc.gf : sc.ga;
          const awayGoals = homeIsPlayer ? sc.ga : sc.gf;
          return {
            match: {
              home: req.home,
              away: req.away,
              homeGoals,
              awayGoals,
              matchHomeGoals: homeGoals,
              matchAwayGoals: awayGoals,
              regulationHomeGoals: homeGoals,
              regulationAwayGoals: awayGoals,
              playerSide: req.playerSide,
              scoreline: `${homeGoals}-${awayGoals}`,
              events: [],
            },
          };
        },
      });
    }

    const view = buildContinentalCampaignView(state, { playerName: club.name, world });
    const row = view.leaguePhase.table.find((r) => r.clubId === club.clubId);
    assert.equal(row.played, 8);
    assert.equal(row.wins, 4);
    assert.equal(row.draws, 2);
    assert.equal(row.losses, 2);
    assert.equal(row.points, 14);
    assert.equal(row.goalDiff, 0);
    assert.equal(row.goalsFor, 9);
    assert.equal(row.goalsAgainst, 9);

    const playerLp = view.playerMatches.filter((m) => /^League phase/.test(m.round));
    const tally = tallyClub(playerLp, club.clubId);
    assert.deepEqual(
      { p: tally.p, w: tally.w, d: tally.d, l: tally.l, pts: tally.pts, gf: tally.gf, ga: tally.ga },
      { p: 8, w: 4, d: 2, l: 2, pts: 14, gf: 9, ga: 9 }
    );
    assert.equal(tally.h, 4);
    assert.equal(tally.a, 4);

    // Every other club row mirrors the shared fixtures
    for (const r of view.leaguePhase.table) {
      assert.equal(r.played, 8);
      assert.equal(r.points, 3 * r.wins + r.draws);
      assert.equal(r.goalDiff, r.goalsFor - r.goalsAgainst);
    }
    const sumP = view.leaguePhase.table.reduce((s, r) => s + r.played, 0);
    assert.equal(sumP, 288);
    assert.equal(view.leaguePhase.matches.length, 144);
    assert.equal(Math.max(...view.leaguePhase.matches.map((m) => m.matchday)), 8);
  });
});

describe("chronology agrees with committed table", () => {
  it("seed-3 Red Star viewer tallies match league-phase table", () => {
    const { world, league, club, player } = redStarSetup(3);
    const result = simulateChronologicalSeason({ player, league, seasonIndex: 0 });
    const campaign = result.europeanCampaign;
    const row = campaign.leaguePhase.table.find((r) => r.clubId === club.clubId);
    const shown = campaign.playerMatches.filter((m) => /^League phase/.test(m.round));
    const tally = tallyClub(shown, club.clubId);
    assert.equal(row.played, tally.p);
    assert.equal(row.wins, tally.w);
    assert.equal(row.draws, tally.d);
    assert.equal(row.losses, tally.l);
    assert.equal(row.points, tally.pts);
    assert.equal(row.goalsFor, tally.gf);
    assert.equal(row.goalsAgainst, tally.ga);
    assert.ok(Math.max(...shown.map((m) => +(m.round.match(/MD(\d+)/) || [])[1] || 0)) <= 8);
    for (const m of shown) {
      const id = m.matchId || m.fixtureId;
      assert.ok(world.matches.has(id), `missing store entry ${id}`);
      const stored = world.matches.get(id);
      assert.equal(stored.homeGoals, m.homeGoals);
      assert.equal(stored.awayGoals, m.awayGoals);
    }
  });
});

describe("identity and duplicates", () => {
  it("reprocessing a fixture is idempotent", () => {
    const { world, league, player } = redStarSetup(11);
    const state = prepareContinentalEdition({
      standing: player.latestStanding.playerRow,
      league,
      player,
      seasonYear: 2026,
    });
    const firstId = listContinentalFixtures(state, { status: "scheduled" })[0].matchId;
    const a = processContinentalFixture(state, firstId, { player });
    const ledgerBefore = world.fixtureLedger.length;
    const formBefore = world.formAppliedFixtures.size;
    const rngBefore = world.rngState;
    const b = processContinentalFixture(state, firstId, { player });
    assert.equal(a.match.matchId, b.match.matchId);
    assert.equal(a.match.homeGoals, b.match.homeGoals);
    assert.equal(a.match.awayGoals, b.match.awayGoals);
    assert.equal(world.fixtureLedger.length, ledgerBefore);
    assert.equal(world.formAppliedFixtures.size, formBefore);
    assert.equal(b.alreadyPlayed, true);
  });

  it("consecutive editions use disjoint match IDs", () => {
    const { world, league, player } = redStarSetup(1);
    const c2026 = simulateContinentalCampaign({
      standing: player.latestStanding.playerRow,
      league,
      player,
      seasonYear: 2026,
    });
    const ids2026 = new Set((c2026.leaguePhase.matches || []).map((m) => m.matchId));
    const c2027 = simulateContinentalCampaign({
      standing: player.latestStanding.playerRow,
      league,
      player,
      seasonYear: 2027,
    });
    const ids2027 = (c2027.leaguePhase.matches || []).map((m) => m.matchId);
    const overlap = ids2027.filter((id) => ids2026.has(id));
    assert.equal(overlap.length, 0, `collisions: ${overlap.slice(0, 3)}`);
    for (const m of c2027.leaguePhase.matches) {
      const stored = getMatch(m.matchId, world);
      assert.ok(stored);
      assert.equal(stored.home?.clubId || stored.homeClubId, m.home?.clubId || m.homeClubId);
      assert.equal(stored.homeGoals, m.homeGoals);
    }
  });
});

describe("playoff-only advancement", () => {
  it("playoff round creates 8 winners and no speculative final", () => {
    const { world, league, player } = redStarSetup(4);
    const state = prepareContinentalEdition({
      standing: player.latestStanding.playerRow,
      league,
      player,
      seasonYear: 2026,
    });
    for (const md of state.openingMatchdays) {
      processContinentalMatchday(state, md, { player });
    }
    advanceContinentalStage(state, { player });
    const playoff = simulatePlayoffRound(state, { player });
    assert.ok(playoff);
    assert.equal(playoff.winners.length, 8);
    const stages = state.knockout.stages.map((s) => s.stageId);
    assert.ok(stages.includes("playoff"));
    assert.ok(!stages.includes("Final") || state.status === "complete");
    // Before draining further, Final fixtures must not exist yet if we only ran playoff
    const finalFx = listContinentalFixtures(state).filter((f) => f.stageId === "Final");
    // After simulatePlayoffRound alone, R16 may be created by advance — but QF/SF/Final must not be played
    const playedFinal = finalFx.filter((f) => f.played);
    assert.equal(playedFinal.length, 0);
  });
});

describe("two-leg extra-time orientation", () => {
  it("audit seed-4: Čukarički ET win is first-leg-relative away", () => {
    const world = createWorldState({ seed: 1, startYear: 2026 });
    setWorldState(world);
    const a = attachClubIdentity({
      name: "Red Star Belgrade",
      clubId: "club:serbia:red-star-belgrade",
      overall: 72,
      attack: 72,
      midfield: 72,
      defence: 72,
      goalkeeper: 70,
    });
    const b = attachClubIdentity({
      name: "Cukaricki",
      clubId: "club:serbia:cukaricki",
      overall: 68,
      attack: 68,
      midfield: 68,
      defence: 68,
      goalkeeper: 66,
    });
    const first = {
      home: a,
      away: b,
      homeGoals: 1,
      awayGoals: 0,
      matchHomeGoals: 1,
      matchAwayGoals: 0,
      regulationHomeGoals: 1,
      regulationAwayGoals: 0,
      events: [],
    };
    const second = {
      home: b,
      away: a,
      homeGoals: 1,
      awayGoals: 0,
      matchHomeGoals: 1,
      matchAwayGoals: 0,
      regulationHomeGoals: 1,
      regulationAwayGoals: 0,
      events: [],
      effectiveStrength: {
        home: effectiveTeamStrength(b, { worldState: world }),
        away: effectiveTeamStrength(a, { worldState: world }),
      },
    };
    const resolved = resolveTwoLeggedTie(first, second, { rng: createRng(4) });
    assert.equal(resolved.decidedBy, "extraTime");
    assert.equal(resolved.etHomeGoals, 1);
    assert.equal(resolved.etAwayGoals, 0);
    // Pre-fix returned winnerSide 'home' (second-leg orientation). Correct is 'away'.
    assert.equal(resolved.winnerSide, "away");
    assert.equal(resolved.secondLeg.homeGoals, 2);
    assert.equal(resolved.secondLeg.matchHomeGoals, 2);
    assert.equal(resolved.aggregate, "1-2");
  });
});

describe("JSON round-trip", () => {
  it("rebuilds campaign after serialize/deserialize", () => {
    const { world, league, player } = redStarSetup(5);
    const campaign = simulateContinentalCampaign({
      standing: player.latestStanding.playerRow,
      league,
      player,
      seasonYear: 2026,
    });
    const snap = serializeWorldState(world);
    const restored = deserializeWorldState(JSON.parse(JSON.stringify(snap)));
    setWorldState(restored);
    for (const m of campaign.leaguePhase.matches) {
      const stored = getMatch(m.matchId, restored);
      assert.ok(stored, m.matchId);
      assert.equal(stored.homeGoals, m.homeGoals);
      assert.equal(stored.awayGoals, m.awayGoals);
      assert.ok(stored.matchday != null);
    }
  });
});
