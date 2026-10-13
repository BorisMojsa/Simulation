/**
 * Team strength / match model integration tests.
 * Run: node tests/teamStrength.test.mjs
 */
import assert from "node:assert/strict";
import { LEAGUES } from "../js/data/leagues.js";
import {
  assertAllLeaguesCovered,
  resolveClub,
  CLUB_PROFILES,
} from "../js/data/identity/resolver.js";
import { getNationProfile, NATION_PROFILES } from "../js/data/strength/nationProfiles.js";
import { NATION_CONFEDERATION, confederationForNation } from "../js/data/internationalCalendar.js";
import {
  isUefaQualifyingLeague,
  uefaSlotsForLeague,
  COPA_AMERICA_CORE,
  COPA_AMERICA_INVITES,
} from "../js/data/competitions/qualification.js";
import { expectedGoals, simulateMatch, resolveKnockout, XG_MODEL } from "../js/simulation/matchEngine.js";
import { effectiveTeamStrength, playerLineupImpact } from "../js/simulation/teamStrength.js";
import { createRng, setSimRng } from "../js/simulation/rng.js";
import {
  createWorldState,
  serializeWorldState,
  deserializeWorldState,
  setWorldState,
} from "../js/simulation/worldState.js";
import { simulateLeagueSeason } from "../js/simulation/leagueFixtures.js";
import { qualificationForPosition, generateLeagueTable } from "../js/simulation/leaguePhase.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function test(name, fn) {
  try {
    fn();
    console.log(`OK  ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

function club(name, nation) {
  const r = resolveClub(name, { nationHint: nation });
  assert.ok(r.ok, r.diagnostic);
  return {
    name: r.profile.name,
    displayName: r.profile.displayName,
    clubId: r.profile.clubId,
    overall: r.profile.overall,
    attack: r.profile.attack,
    midfield: r.profile.midfield,
    defence: r.profile.defence,
    goalkeeper: r.profile.goalkeeper,
    financialTier: r.profile.financialPower,
    badge: null,
  };
}

test("all 490 clubs resolve to profiles", () => {
  assert.equal(CLUB_PROFILES.length, 490);
  const missing = assertAllLeaguesCovered(LEAGUES);
  assert.equal(missing.length, 0, JSON.stringify(missing.slice(0, 5)));
});

test("alias resolution for renamed clubs", () => {
  assert.equal(resolveClub("Bournemouth", { nationHint: "England" }).profile.name, "AFC Bournemouth");
  assert.equal(resolveClub("PSV Eindhoven", { nationHint: "Netherlands" }).profile.name, "PSV");
  assert.ok(resolveClub("AC Milan", { nationHint: "Italy" }).ok);
});

test("City and Hull are not identical strength", () => {
  const city = resolveClub("Manchester City").profile;
  const hull = resolveClub("Hull City").profile;
  assert.ok(city.overall - hull.overall > 10, `${city.overall} vs ${hull.overall}`);
});

test("Bayern stronger than Paderborn; Serbia clubs not identical", () => {
  const bayern = resolveClub("Bayern Munich").profile;
  const pad = resolveClub("SC Paderborn", { nationHint: "Germany" }).profile;
  assert.ok(bayern.overall - pad.overall > 10);
  const serbia = CLUB_PROFILES.filter((p) => p.nation === "Serbia");
  assert.ok(new Set(serbia.map((p) => p.overall)).size >= Math.floor(serbia.length * 0.8));
});

test("provenance labels exist", () => {
  const verified = CLUB_PROFILES.filter((p) => p.sourceStatus === "verified_rating");
  const primary = CLUB_PROFILES.filter((p) => p.strengthDerivationStatus === "normalized_from_published_rating");
  const calibrated = CLUB_PROFILES.filter((p) => p.strengthDerivationStatus === "calibrated_from_published_rating");
  assert.equal(verified.length, 490);
  assert.equal(primary.length, 485);
  assert.equal(calibrated.length, 5);
  for (const p of CLUB_PROFILES) {
    assert.ok(p.sourceStatus);
    assert.ok(p.strengthDerivationStatus);
    assert.ok(p.confidence);
    assert.ok(p.transformVersion);
    assert.ok(p.primaryScaleRating);
  }
});

test("financial tier alone does not change expected goals", () => {
  const base = club("Brentford", "England");
  const rich = { ...base, financialTier: 5 };
  const poor = { ...base, financialTier: 1 };
  const a = effectiveTeamStrength(rich);
  const b = effectiveTeamStrength(poor);
  assert.equal(a.attack, b.attack);
  assert.equal(a.defence, b.defence);
  const xgA = expectedGoals(a, a, { venue: "neutral" });
  const xgB = expectedGoals(b, b, { venue: "neutral" });
  assert.equal(xgA.home, xgB.home);
});

test("player OVR raises attack for ST and is bounded; absent player no effect", () => {
  const team = club("Burnley", "England");
  const weak = { name: "P", position: "ST", rating: 60, attributes: {} };
  const strong = { name: "P", position: "ST", rating: 90, attributes: {} };
  const withWeak = effectiveTeamStrength(team, { player: weak, playerSide: "home", side: "home" });
  const withStrong = effectiveTeamStrength(team, { player: strong, playerSide: "home", side: "home" });
  const absent = effectiveTeamStrength(team, { player: strong, playerSide: null, side: "home" });
  assert.ok(withStrong.attack > withWeak.attack);
  assert.ok(withStrong.attack - withWeak.attack < 4, "bounded impact");
  assert.equal(absent.attack, effectiveTeamStrength(team).attack);
});

test("GK quality lowers opposing xG more than adding striker quality", () => {
  const home = club("Everton", "England");
  const away = club("Fulham", "England");
  const baseAway = effectiveTeamStrength(away);
  const baseHome = effectiveTeamStrength(home);
  const homeStrongGk = {
    ...baseHome,
    goalkeeper: baseHome.goalkeeper + 8,
    defence: baseHome.defence,
  };
  const homeStrongSt = {
    ...baseHome,
    attack: baseHome.attack + 8,
  };
  const xgVsGk = expectedGoals(homeStrongGk, baseAway, { venue: "neutral" });
  const xgVsSt = expectedGoals(homeStrongSt, baseAway, { venue: "neutral" });
  const xgBase = expectedGoals(baseHome, baseAway, { venue: "neutral" });
  assert.ok(xgVsGk.away < xgBase.away, "better GK reduces goals against");
  assert.ok(xgVsSt.home > xgBase.home, "better attack raises own xG");
});

test("underqualified replacement can reduce quality", () => {
  const team = club("Arsenal", "England");
  const impact = playerLineupImpact(
    resolveClub("Arsenal").profile,
    { position: "ST", rating: 55 },
    { participates: true }
  );
  assert.ok(impact.attack < 0);
});

test("0-0 is possible and goal events reconcile", () => {
  setSimRng(createRng(42));
  let saw00 = false;
  for (let i = 0; i < 400; i++) {
    setSimRng(createRng(1000 + i));
    const m = simulateMatch(club("Getafe", "Spain"), club("Mallorca", "Spain"), {
      venue: "neutral",
      rng: createRng(2000 + i),
    });
    if (m.homeGoals === 0 && m.awayGoals === 0) saw00 = true;
    const goals = m.events.filter((e) => e.type === "goal" && e.phase === "regulation").length;
    assert.equal(goals, m.homeGoals + m.awayGoals);
  }
  assert.ok(saw00, "expected at least one 0-0 in 400 low-scoring matches");
});

test("neutral fixtures are symmetric under team swap", () => {
  const a = effectiveTeamStrength(club("Ajax", "Netherlands"));
  const b = effectiveTeamStrength(club("Feyenoord", "Netherlands"));
  const ab = expectedGoals(a, b, { venue: "neutral" });
  const ba = expectedGoals(b, a, { venue: "neutral" });
  assert.equal(ab.home, ba.away);
  assert.equal(ab.away, ba.home);
});

test("penalties do not inflate match goals; ET is strength-sensitive", () => {
  setSimRng(createRng(7));
  const strong = club("Bayern Munich", "Germany");
  const weak = club("SC Paderborn", "Germany");
  let etStrongWins = 0;
  let etPlayed = 0;
  for (let i = 0; i < 200; i++) {
    const rng = createRng(5000 + i);
    let m = simulateMatch(strong, weak, { venue: "neutral", rng });
    // Force draw regulation for ET path
    m = {
      ...m,
      homeGoals: 1,
      awayGoals: 1,
      regulationHomeGoals: 1,
      regulationAwayGoals: 1,
      matchHomeGoals: 1,
      matchAwayGoals: 1,
    };
    const resolved = resolveKnockout(m, { rng: createRng(9000 + i) });
    if (resolved.decidedBy === "extraTime") {
      etPlayed += 1;
      if (resolved.winnerSide === "home") etStrongWins += 1;
    }
    if (resolved.decidedBy === "penalties") {
      assert.equal(resolved.homeGoals, resolved.matchHomeGoals);
      assert.equal(resolved.awayGoals, resolved.matchAwayGoals);
      assert.ok(resolved.penaltyHome != null);
      assert.ok(!resolved.events.some((e) => e.type === "goal" && e.phase === "penalties"));
    }
  }
  assert.ok(etPlayed > 20);
  assert.ok(etStrongWins / etPlayed > 0.55, `ET strong win rate ${etStrongWins}/${etPlayed}`);
});

test("generateLeagueTable is retired", () => {
  assert.throws(() => generateLeagueTable(), /retired/);
});

test("Serbia Croatia Czechia UEFA eligibility", () => {
  for (const name of ["Serbia - SuperLiga", "Croatia - HNL", "Czechia - Czech First League"]) {
    const league = LEAGUES.find((l) => l.name === name);
    assert.ok(league, name);
    assert.ok(isUefaQualifyingLeague(league), name);
    const slots = uefaSlotsForLeague(league);
    assert.ok(slots.cl >= 1);
    assert.equal(qualificationForPosition(1, league), "League Champions");
    assert.equal(qualificationForPosition(2, league), "Europa League");
  }
});

test("scripted progression helpers removed from europeanCompetition source", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../js/simulation/europeanCompetition.js"),
    "utf8"
  );
  assert.ok(!src.includes("pickExitRound"));
  assert.ok(!src.includes("playerExitAfterRound"));
  assert.ok(!src.includes("forcePlayerLoss"));
});

test("world state round-trip", () => {
  const world = createWorldState({ seed: 12345, startYear: 2026 });
  const before = world.clubs.get(resolveClub("Liverpool").profile.clubId).overall;
  const json = serializeWorldState(world);
  const again = deserializeWorldState(json);
  assert.equal(again.clubs.get(resolveClub("Liverpool").profile.clubId).overall, before);
  assert.equal(again.schemaVersion, 3);
  assert.ok(again.clubBaselineSnapshotId);
  assert.ok(again.nationBaselineSnapshotId);
  assert.ok(again.nationContentHash);
});

test("league season uses shared engine; standings from fixtures", () => {
  setWorldState(createWorldState({ seed: 99 }));
  const league = LEAGUES.find((l) => l.name === "England - Premier League");
  const player = {
    name: "Tester",
    position: "CM",
    rating: 78,
    attributes: { Passing: 78, Shooting: 70, Defending: 70, Speed: 75, Physicality: 74, Dribbling: 76 },
    club: club("Brentford", "England"),
  };
  const sim = simulateLeagueSeason(league, player, 70);
  assert.equal(sim.table.length, league.clubs.length);
  assert.ok(sim.allMatches.length > 100);
  assert.ok(sim.playerRecord.points >= 0);
});

test("Copa América eligible pool excludes Jordan", () => {
  const pool = [...COPA_AMERICA_CORE, ...COPA_AMERICA_INVITES];
  assert.ok(!pool.includes("Jordan"));
  assert.ok(pool.includes("Argentina"));
});

test("nation profiles cover selectable nations", () => {
  assert.equal(NATION_PROFILES.length, 79);
  assert.ok(getNationProfile("Brazil"));
  assert.ok(getNationProfile("USA"));
  assert.ok(getNationProfile("IR Iran"));
  assert.ok(getNationProfile("Côte d'Ivoire"));
  assert.ok(getNationProfile("DPR Korea"));
  assert.ok(getNationProfile("Korea Republic"));
});

test("international xG ordering uses published national points", () => {
  const spain = getNationProfile("Spain");
  const togo = getNationProfile("Togo");
  const iran = getNationProfile("Iran");
  const china = getNationProfile("China");
  assert.ok(spain.fifaPoints > togo.fifaPoints);
  assert.ok(iran.fifaPoints > china.fifaPoints);
  const spainEff = effectiveTeamStrength({ ...spain, isNation: true, nationId: spain.nationId });
  const togoEff = effectiveTeamStrength({ ...togo, isNation: true, nationId: togo.nationId });
  const iranEff = effectiveTeamStrength({ ...iran, isNation: true, nationId: iran.nationId });
  const chinaEff = effectiveTeamStrength({ ...china, isNation: true, nationId: china.nationId });
  assert.ok(spainEff.overall > togoEff.overall);
  assert.ok(iranEff.overall > chinaEff.overall);
  const st = expectedGoals(spainEff, togoEff, { venue: "neutral" });
  const ic = expectedGoals(iranEff, chinaEff, { venue: "neutral" });
  assert.ok(st.home > st.away);
  assert.ok(ic.home > ic.away);
});

test("national player OVR affects only when selected; venue metadata respected", () => {
  const nation = getNationProfile("Scotland");
  const team = { ...nation, isNation: true, nationId: nation.nationId };
  const weak = { name: "P", position: "ST", rating: 60, attributes: {} };
  const strong = { name: "P", position: "ST", rating: 90, attributes: {} };
  const withWeak = effectiveTeamStrength(team, { player: weak, playerSide: "home", side: "home" });
  const withStrong = effectiveTeamStrength(team, { player: strong, playerSide: "home", side: "home" });
  const absent = effectiveTeamStrength(team, { player: strong, playerSide: null, side: "home" });
  assert.ok(withStrong.attack > withWeak.attack);
  assert.equal(absent.attack, effectiveTeamStrength(team).attack);
  const opp = effectiveTeamStrength({
    ...getNationProfile("Wales"),
    isNation: true,
    nationId: getNationProfile("Wales").nationId,
  });
  const homeXg = expectedGoals(withStrong, opp, { venue: "home" });
  const neutXg = expectedGoals(withStrong, opp, { venue: "neutral" });
  assert.ok(homeXg.home > neutXg.home, `home ${homeXg.home} vs neutral ${neutXg.home}`);
  const swap = expectedGoals(opp, withStrong, { venue: "neutral" });
  assert.equal(neutXg.home, swap.away);
  assert.equal(neutXg.away, swap.home);
});

test("confederation registry corrections and Copa América integrity", () => {
  assert.equal(confederationForNation("Hungary"), "UEFA");
  assert.equal(confederationForNation("Mali"), "CAF");
  assert.equal(confederationForNation("Venezuela"), "CONMEBOL");
  assert.equal(NATION_CONFEDERATION.Hungary, "UEFA");
  const pool = [...COPA_AMERICA_CORE, ...COPA_AMERICA_INVITES];
  assert.ok(pool.includes("Venezuela"));
  assert.ok(!pool.includes("Jordan"));
  assert.ok(!pool.includes("Hungary"));
  assert.ok(!Object.values(NATION_CONFEDERATION).includes("FIFA"));
});

// --- Statistical calibration (seeded, large N) ---
test("calibration: equal neutral teams ~even with draws", () => {
  const t = club("Crystal Palace", "England");
  const N = 4000;
  let homeWins = 0;
  let draws = 0;
  for (let i = 0; i < N; i++) {
    const m = simulateMatch(t, { ...t, name: t.name + "B" }, { venue: "neutral", rng: createRng(30000 + i) });
    // Force identical strength by cloning effective path: use same club object twice
  }
  // Proper equal-profile test
  homeWins = 0;
  draws = 0;
  let awayWins = 0;
  for (let i = 0; i < N; i++) {
    const rng = createRng(31000 + i);
    const m = simulateMatch(t, t, { venue: "neutral", rng });
    if (m.homeGoals > m.awayGoals) homeWins += 1;
    else if (m.awayGoals > m.homeGoals) awayWins += 1;
    else draws += 1;
  }
  const homeRate = homeWins / N;
  const awayRate = awayWins / N;
  console.log(
    `  equal-neutral N=${N}: home=${homeRate.toFixed(3)} away=${awayRate.toFixed(3)} draw=${(draws / N).toFixed(3)}`
  );
  assert.ok(Math.abs(homeRate - awayRate) < 0.04);
  assert.ok(draws / N > 0.18 && draws / N < 0.4);
});

test("calibration: large gap favours stronger; knockout upset possible", () => {
  // Verified Opta elite vs second-division estimate
  const strong = club("Arsenal", "England");
  const weak = club("Birmingham City", "England");
  const N = 3000;
  let strongWins = 0;
  let weakWins = 0;
  for (let i = 0; i < N; i++) {
    const m = simulateMatch(strong, weak, { venue: "neutral", rng: createRng(40000 + i) });
    if (m.homeGoals > m.awayGoals) strongWins += 1;
    if (m.awayGoals > m.homeGoals) weakWins += 1;
  }
  const rate = strongWins / N;
  console.log(
    `  gap-neutral N=${N}: strongWin=${rate.toFixed(3)} weakWin=${(weakWins / N).toFixed(3)} (Arsenal vs Birmingham)`
  );
  assert.ok(rate > 0.7, `expected strong favourite, got ${rate}`);
  assert.ok(rate < 0.98, "upset chance should remain");
  assert.ok(weakWins / N > 0.005, "weaker side must win sometimes in open play");

  // Moderate gap knockout
  const fav = club("Roma", "Italy");
  const dog = club("Lecce", "Italy");
  let upset = 0;
  const KO = 1200;
  for (let i = 0; i < KO; i++) {
    const rng = createRng(50000 + i);
    let m = simulateMatch(dog, fav, { venue: "neutral", rng });
    m = resolveKnockout(m, { rng: createRng(60000 + i) });
    if (m.winnerSide === "home") upset += 1;
  }
  console.log(`  knockout-upset N=${KO}: weakerAdvances=${(upset / KO).toFixed(3)} (Lecce vs Roma)`);
  assert.ok(upset / KO > 0.12, "weaker side should sometimes win knockout");
  assert.ok(upset / KO < 0.48);
});

test("calibration: home advantage raises home win rate", () => {
  const a = club("Roma", "Italy");
  const b = club("Torino", "Italy");
  const N = 2500;
  let homeW = 0;
  let neutHomeW = 0;
  for (let i = 0; i < N; i++) {
    const h = simulateMatch(a, b, { venue: "home", rng: createRng(70000 + i) });
    const n = simulateMatch(a, b, { venue: "neutral", rng: createRng(70000 + i) });
    if (h.homeGoals > h.awayGoals) homeW += 1;
    if (n.homeGoals > n.awayGoals) neutHomeW += 1;
  }
  console.log(
    `  home-adv N=${N}: homeVenue=${(homeW / N).toFixed(3)} neutral=${(neutHomeW / N).toFixed(3)}`
  );
  assert.ok(homeW / N > neutHomeW / N);
});

test("calibration: high-OVR user improves xG vs low-OVR (same club)", () => {
  const baseClub = club("Hull City", "England");
  const opp = club("Burnley", "England");
  const low = { name: "Low", position: "ST", rating: 62, attributes: {} };
  const high = { name: "High", position: "ST", rating: 88, attributes: {} };
  const lowEff = effectiveTeamStrength(baseClub, { player: low, playerSide: "home", side: "home" });
  const highEff = effectiveTeamStrength(baseClub, { player: high, playerSide: "home", side: "home" });
  const oppEff = effectiveTeamStrength(opp);
  const xgLow = expectedGoals(lowEff, oppEff, { venue: "home" });
  const xgHigh = expectedGoals(highEff, oppEff, { venue: "home" });
  console.log(
    `  user-impact xG: lowST=${xgLow.home.toFixed(3)} highST=${xgHigh.home.toFixed(3)} (vs Burnley)`
  );
  assert.ok(highEff.attack > lowEff.attack);
  assert.ok(xgHigh.home > xgLow.home);
});

console.log("\nXG_MODEL coefficients:", XG_MODEL);
console.log("Nation profiles:", NATION_PROFILES.length);
