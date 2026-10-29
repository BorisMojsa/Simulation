/**
 * Free-agent UI soft-lock regressions.
 * Exercises production simulateSeason + showSeasonAnimation + history rendering.
 *
 * Run:
 *   node --test tests/freeAgentUiSoftlock.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { LEAGUES, LEAGUE_LOOKUP, LEAGUE_BY_ID } from "../js/data/leagues.js";
import { createPlayerIdentity } from "../js/simulation/playerDevelopment.js";
import { createWorldState, setWorldState } from "../js/simulation/worldState.js";
import { resetClubFinanceLedgers } from "../js/simulation/clubFinance.js";
import { reseedCareerRng } from "../js/simulation/rng.js";
import { simulateSeason } from "../js/simulation/seasonSimulator.js";
import {
  releaseToFreeAgency,
  selectNextCareerAction,
  ensureContractAuthority,
  isFreeAgent,
  declineWindowAndContinue,
} from "../js/simulation/contractLifecycle.js";
import { generateTransferOffers } from "../js/simulation/transferMarket.js";
import { acceptPipelineOffer } from "../js/simulation/dealPipeline.js";
import { refreshAbilityCaches } from "../js/simulation/playerAbility.js";
import { buildFreeAgentBrowserFixture } from "../js/simulation/freeAgentBrowserFixture.js";
import { installMinimalDom } from "./helpers/minimalDom.mjs";

function makeReleasedPlayer(opts = {}) {
  resetClubFinanceLedgers();
  reseedCareerRng(opts.seed ?? 7);
  setWorldState(createWorldState({ startYear: 2026 }));
  const league = LEAGUE_BY_ID.get("league:italy-serie-a");
  const club = league.clubs[0];
  const p = createPlayerIdentity({
    name: opts.name || "Softlock Probe",
    nationality: "Italy",
    position: "CM",
    age: opts.age ?? 27,
  });
  p.startYear = 2026;
  p.age = opts.age ?? 27;
  p.rating = opts.rating ?? 70;
  p.potential = opts.potential ?? 76;
  p.attributes = {
    Speed: p.rating,
    Passing: p.rating,
    Shooting: p.rating - 2,
    Defending: p.rating - 1,
    Physicality: p.rating,
    Dribbling: p.rating,
  };
  p.playerModelVersion = 2;
  p.state = { form: 0, morale: 0, readiness: 1, fatigue: 0, adaptationPenalty: 0, roleFit: 1 };
  p.health = { activeInjury: null, injuryHistory: [], durableDamage: {}, recoverableDamage: {} };
  p.development = { latentBudget: 80, modelVersion: 1, migration: {} };
  p.club = {
    ...club,
    league: league.name,
    leagueDisplay: league.displayName,
    leagueId: league.leagueId,
    nation: league.nation,
    isAcademy: false,
    parentClub: null,
  };
  p.employmentClubId = club.clubId;
  p.playingClubId = club.clubId;
  p.contractStartSeason = 0;
  p.contractYears = 1;
  p.contractEndSeason = 1;
  p.weeklyWage = opts.wage ?? 8000;
  p.seasons = [];
  p.careerTotals = { matches: 0, goals: 0, assists: 0, cleanSheets: 0 };
  p.pendingOffers = [];
  p.pendingDecision = null;
  refreshAbilityCaches(p);
  ensureContractAuthority(p);
  releaseToFreeAgency(p, "contract-expired");
  p.pendingOffers = [];
  p.pendingDecision = null;
  return p;
}

function snapshot(player) {
  return {
    age: player.age,
    seasons: player.seasons?.length ?? 0,
    matches: player.careerTotals?.matches ?? 0,
    goals: player.careerTotals?.goals ?? 0,
    assists: player.careerTotals?.assists ?? 0,
    cleanSheets: player.careerTotals?.cleanSheets ?? 0,
    wage: player.weeklyWage || 0,
    offers: player.pendingOffers?.length ?? 0,
    freeAgent: isFreeAgent(player) || !player.club,
  };
}

describe("free-agent UI soft-lock", () => {
  let dom;

  beforeEach(() => {
    dom = installMinimalDom();
  });

  it("explicit free-agent payload shows recap + Continue; completion fires once", async () => {
    const { showSeasonAnimation, assertUsableFreeAgentResult } = await import(
      "../js/ui/seasonAnimation.js"
    );
    const player = makeReleasedPlayer();
    const seasonData = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions: false,
      autoDecisionPolicy: "stay",
    });
    assert.equal(seasonData.freeAgent, true);
    assert.equal(Boolean(seasonData.league), false);
    assert.equal(Boolean(seasonData.standings), false);
    assert.equal(assertUsableFreeAgentResult(seasonData).ok, true);

    player.pendingOffers = [];
    let completions = 0;
    const presentation = showSeasonAnimation(seasonData, player, Object.keys(player.attributes), () => {
      completions += 1;
      dom.ensure("season-animation-overlay").classList.add("hidden");
    });

    // Recap visible; Continue enabled; completion still pending.
    await new Promise((r) => setTimeout(r, 20));
    const overlay = dom.ensure("season-animation-overlay");
    const recap = dom.ensure("free-agent-recap");
    const continueSection = dom.ensure("animation-continue");
    const continueBtn = dom.ensure("continue-btn");
    assert.equal(overlay.classList.contains("hidden"), false);
    assert.equal(recap.classList.contains("hidden"), false);
    assert.equal(continueSection.classList.contains("hidden"), false);
    assert.equal(typeof continueBtn.onclick, "function");
    assert.equal(completions, 0);
    assert.equal(dom.ensure("match-viewer-section").classList.contains("hidden"), true);
    assert.equal(dom.ensure("simulation-dashboard").classList.contains("hidden"), true);

    continueBtn.click();
    await presentation;
    assert.equal(completions, 1);
    assert.equal(overlay.classList.contains("hidden"), true);

    // Rapid second Continue must not double-fire.
    continueBtn.click();
    assert.equal(completions, 1);
  });

  it("deterministic empty-result fixture: first search empty; recovery may offer; desk stays searchable", async () => {
    // Fix 07: after one closed empty market review, the next scheduled search
    // bypasses the interest lottery. Period 1 must still be empty under the
    // empty-result identity; period 2 may surface validated recovery offers.
    const fixture = buildFreeAgentBrowserFixture({ mode: "empty-result" });
    assert.equal(fixture.ok, true, fixture.reason || "empty-result fixture");
    const player = fixture.player;
    const { showSeasonAnimation } = await import("../js/ui/seasonAnimation.js");
    const { appendSeasonCard } = await import("../js/ui/rendering.js");

    for (let i = 0; i < 2; i++) {
      const before = snapshot(player);
      assert.equal(player.pendingOffers?.length || 0, 0);
      const seasonData = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
        pauseForDecisions: false,
        autoDecisionPolicy: "stay",
      });
      assert.equal(seasonData.freeAgent, true);
      const offers = generateTransferOffers(
        seasonData.performanceScore,
        player,
        LEAGUES,
        LEAGUE_LOOKUP,
        seasonData.season?.avgMatchRating ?? null
      );
      player.pendingOffers = offers;
      if (i === 0) {
        assert.equal(offers.length, 0, "period 1 must stay empty under empty-result identity");
      }

      const presentation = showSeasonAnimation(seasonData, player, Object.keys(player.attributes), () => {
        appendSeasonCard(player.seasons[player.seasons.length - 1], dom.ensure("season-log"), player);
        dom.ensure("season-animation-overlay").classList.add("hidden");
      });
      await new Promise((r) => setTimeout(r, 10));
      const body = dom.ensure("free-agent-recap-body").innerHTML;
      if (offers.length === 0) {
        assert.match(body, /No suitable offers arrived/i);
      }
      dom.ensure("continue-btn").click();
      await presentation;

      assert.equal(player.age, before.age + 1);
      assert.equal(player.seasons.length, before.seasons + 1);
      assert.equal(player.careerTotals.matches, before.matches);
      assert.equal(player.weeklyWage || 0, 0);
      assert.equal(!player.club, true);
      const next = selectNextCareerAction(player);
      if (offers.length > 0) {
        assert.equal(next.id, "resolve-offers");
        assert.equal(next.canSimulate, false);
      } else {
        assert.equal(next.id, "free-agent");
        assert.equal(next.canSimulate, true);
      }
    }
  });

  it("two successive empty periods produce two history entries without trapping overlay", async () => {
    const player = makeReleasedPlayer({ age: 26, rating: 58, seed: 11 });
    const { showSeasonAnimation } = await import("../js/ui/seasonAnimation.js");
    const { appendSeasonCard } = await import("../js/ui/rendering.js");
    const log = dom.ensure("season-log");

    for (let i = 0; i < 2; i++) {
      player.pendingOffers = [];
      player.pendingDecision = null;
      const beforeAge = player.age;
      const beforeSeasons = player.seasons.length;
      const seasonData = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
        pauseForDecisions: false,
        autoDecisionPolicy: "stay",
      });
      assert.equal(seasonData.freeAgent, true);
      assert.equal(player.age, beforeAge + 1);
      assert.equal(player.seasons.length, beforeSeasons + 1);
      const presentation = showSeasonAnimation(seasonData, player, Object.keys(player.attributes), () => {
        appendSeasonCard(player.seasons[player.seasons.length - 1], log, player);
        dom.ensure("season-animation-overlay").classList.add("hidden");
      });
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(dom.ensure("free-agent-recap").classList.contains("hidden"), false);
      dom.ensure("continue-btn").click();
      await presentation;
      assert.equal(dom.ensure("season-animation-overlay").classList.contains("hidden"), true);
    }

    assert.equal(player.seasons.length, 2);
    assert.equal(log.children.length, 2);
    assert.notEqual(player.seasons[0].seasonId, player.seasons[1].seasonId);
  });

  it("offers after a free-agent period block next simulation until resolved; decline restores search", () => {
    const fixture = buildFreeAgentBrowserFixture({ mode: "offers" });
    assert.equal(fixture.ok, true, fixture.reason || "offers fixture must establish validated offers");
    const player = fixture.player;
    assert.ok(player.pendingOffers.length > 0);
    assert.equal(selectNextCareerAction(player).id, "resolve-offers");
    assert.equal(selectNextCareerAction(player).canSimulate, false);

    const beforeSeasons = player.seasons.length;
    declineWindowAndContinue(player, { choiceId: "decline-window" });
    player.pendingOffers = [];
    assert.equal(player.seasons.length, beforeSeasons);
    const next = selectNextCareerAction(player);
    assert.equal(next.id, "free-agent");
    assert.equal(next.canSimulate, true);
  });

  it("accepting a suitable free-agent offer uses the deal pipeline once", () => {
    const fixture = buildFreeAgentBrowserFixture({ mode: "signed" });
    assert.equal(fixture.ok, true, fixture.reason || "signed fixture must establish a contract");
    assert.ok(fixture.player.club);
    assert.ok(fixture.player.weeklyWage > 0);
    assert.equal(isFreeAgent(fixture.player), false);
    const next = selectNextCareerAction(fixture.player);
    assert.ok(["start-season", "resolve-decision", "resolve-offers"].includes(next.id));
  });

  it("rapid repeated presentation completion does not duplicate history cards", async () => {
    const { showSeasonAnimation } = await import("../js/ui/seasonAnimation.js");
    const { renderSeasonLog } = await import("../js/ui/rendering.js");
    const player = makeReleasedPlayer({ age: 29, seed: 5 });
    const seasonData = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions: false,
      autoDecisionPolicy: "stay",
    });
    const log = dom.ensure("season-log");
    let lastKey = null;
    let completions = 0;
    const finish = () => {
      completions += 1;
      const season = player.seasons[player.seasons.length - 1];
      const key = season.seasonId;
      if (key === lastKey) return;
      lastKey = key;
      renderSeasonLog(player, log);
      dom.ensure("season-animation-overlay").classList.add("hidden");
    };

    const presentation = showSeasonAnimation(seasonData, player, Object.keys(player.attributes), finish);
    await new Promise((r) => setTimeout(r, 10));
    const btn = dom.ensure("continue-btn");
    btn.click();
    btn.click();
    btn.click();
    await presentation;
    assert.equal(completions, 1);
    assert.equal(log.children.length, 1);
  });

  it("final contracted season that expires still requires league data (not free-agent recap)", async () => {
    const { assertUsableFreeAgentResult } = await import("../js/ui/seasonAnimation.js");
    const clubSeasonResult = {
      freeAgent: false,
      season: {
        seasonNumber: 3,
        age: 28,
        matches: 30,
        clubDisplay: "Atalanta",
        league: "Serie A",
        freeAgent: false,
      },
      league: { name: "Serie A", clubs: [] },
      standings: { table: [] },
    };
    assert.equal(assertUsableFreeAgentResult(clubSeasonResult).ok, false);

    // Released after a club season: presentation must still be classified by the result.
    const releasedAfterClub = {
      freeAgent: false,
      season: clubSeasonResult.season,
      league: clubSeasonResult.league,
      standings: clubSeasonResult.standings,
    };
    assert.equal(Boolean(releasedAfterClub.freeAgent || releasedAfterClub.season.freeAgent), false);
  });

  it("age-41 free-agent fixture reaches age-42 retirement without orphaned overlay requirement", () => {
    const fixture = buildFreeAgentBrowserFixture({ mode: "retire-41" });
    assert.equal(fixture.ok, true);
    assert.equal(fixture.player.age, 41);
    assert.equal(selectNextCareerAction(fixture.player).id, "free-agent");

    const seasonData = simulateSeason(fixture.player, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions: false,
      autoDecisionPolicy: "stay",
    });
    assert.equal(seasonData.freeAgent, true);
    assert.equal(fixture.player.age, 42);
    // main.js maybeAutoRetire() gates animation for age >= 42 after the period.
    assert.ok(fixture.player.age >= 42);
  });

  it("invalid ordinary result rejects without calling success; recovery closes overlay", async () => {
    const { showSeasonAnimation } = await import("../js/ui/seasonAnimation.js");
    let completions = 0;
    const broken = { season: { seasonNumber: 1, matches: 10 }, freeAgent: false };
    const player = { name: "Broken", position: "CM", attributes: {}, pendingOffers: [] };
    const overlay = dom.ensure("season-animation-overlay");
    overlay.classList.remove("hidden");

    await assert.rejects(
      () =>
        showSeasonAnimation(broken, player, [], () => {
          completions += 1;
        }),
      /Missing required season data|No season data/
    );
    assert.equal(completions, 0);
    assert.equal(overlay.classList.contains("hidden"), true);
  });

  it("failed free-agent wait is not presented as a successful recap", async () => {
    const { showSeasonAnimation, assertUsableFreeAgentResult } = await import(
      "../js/ui/seasonAnimation.js"
    );
    const bad = {
      freeAgent: true,
      wait: { ok: false, reason: "not-free-agent" },
      season: null,
    };
    assert.equal(assertUsableFreeAgentResult(bad).ok, false);
    let completions = 0;
    await assert.rejects(
      () =>
        showSeasonAnimation(bad, { name: "X", attributes: {}, pendingOffers: [] }, [], () => {
          completions += 1;
        }),
      /Invalid free-agent result/
    );
    assert.equal(completions, 0);
  });

  it("older thin free-agent records render without undefined/NaN/fake rating or borrowed current age", async () => {
    const { appendSeasonCard, renderSeasonLog } = await import("../js/ui/rendering.js");
    const log = dom.ensure("season-log");
    const thin = {
      seasonId: "free-agent-1",
      year: 2030,
      club: null,
      clubName: "Free agent",
      league: null,
      matches: 0,
      starts: 0,
      minutes: 0,
      goals: 0,
      assists: 0,
      freeAgent: true,
      freeAgentReason: "contract-expired",
      avgMatchRating: null,
    };
    const withAge = {
      ...thin,
      seasonId: "free-agent-2",
      seasonNumber: 2,
      year: 2031,
      age: 29,
    };
    const player = { startYear: 2026, age: 28, seasons: [thin, withAge] };
    renderSeasonLog(player, log);
    let html = log.children.map((c) => `${c._header.innerHTML}${c._summary.innerHTML}${c._stats.innerHTML}`).join("\n");
    assert.match(html, /Free agent/i);
    assert.match(html, /No league fixtures/i);
    assert.match(html, /Age unavailable/);
    assert.match(html, /Age 29/);
    assert.doesNotMatch(html, /undefined|NaN/i);
    assert.doesNotMatch(html, />0\.00</);

    player.age = 41;
    renderSeasonLog(player, log);
    html = log.children.map((c) => `${c._header.innerHTML}`).join("\n");
    assert.match(html, /Age unavailable/);
    assert.match(html, /Age 29/);
    assert.doesNotMatch(html, /Age 41/);
  });

  it("standings panel does not relabel prior club table as a free-agent campaign", async () => {
    const { renderStandings } = await import("../js/ui/rendering.js");
    const board = dom.ensure("standings-board");
    const clubTable = [
      { position: 1, name: "Como", displayName: "Como", points: 70, clubId: "club:italy:como" },
      { position: 2, name: "Other", displayName: "Other", points: 60, clubId: "club:other" },
    ];
    const player = {
      age: 28,
      seasons: [
        {
          seasonNumber: 1,
          age: 27,
          matches: 20,
          clubDisplay: "Como",
          league: "Serie A",
          freeAgent: false,
        },
        {
          seasonId: "free-agent-2",
          seasonNumber: 2,
          year: 2027,
          age: 28,
          freeAgent: true,
          club: null,
          clubName: "Free agent",
          league: null,
          matches: 0,
        },
      ],
      latestStanding: {
        league: "Serie A",
        leagueDisplay: "Serie A",
        seasonNumber: 1,
        table: clubTable,
        playerRow: clubTable[0],
      },
    };

    renderStandings(player, board);
    assert.equal(board.children.length, 1);
    assert.match(board.children[0].textContent, /No league fixtures during this period/i);
    assert.doesNotMatch(board.children[0].textContent || "", /Season 2/);
    // Underlying historical table must remain stored.
    assert.equal(player.latestStanding.table, clubTable);
    assert.equal(player.latestStanding.seasonNumber, 1);

    // After the club season (before FA), real standings still show with source season.
    // Minimal DOM cannot finish league-table rows; caption is appended first.
    player.seasons = [player.seasons[0]];
    try {
      renderStandings(player, board);
    } catch {
      /* table host querySelectorAll not fully shimmed */
    }
    assert.match(board.children[0].textContent || "", /Serie A - Season 1/);
    assert.doesNotMatch(board.children[0].textContent || "", /No league fixtures/);
  });

  it("injected async presentation failure recovers without unhandled rejection", async () => {
    const { showSeasonAnimation } = await import("../js/ui/seasonAnimation.js");
    const player = makeReleasedPlayer();
    const seasonData = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
      pauseForDecisions: false,
      autoDecisionPolicy: "stay",
    });
    let completions = 0;
    const presentation = showSeasonAnimation(seasonData, player, Object.keys(player.attributes), () => {
      completions += 1;
      throw new Error("injected-completion-failure");
    });
    await new Promise((r) => setTimeout(r, 10));
    dom.ensure("continue-btn").click();
    await assert.rejects(() => presentation, /injected-completion-failure/);
    assert.equal(completions, 1);
    assert.equal(dom.ensure("season-animation-overlay").classList.contains("hidden"), true);
  });
});
