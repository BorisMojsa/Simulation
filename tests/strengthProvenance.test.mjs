/**
 * Provenance / import integrity tests.
 * Run: node tests/strengthProvenance.test.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { CLUB_PROFILES } from "../js/data/strength/clubProfiles.generated.js";
import { NATION_PROFILES } from "../js/data/strength/nationProfiles.js";
import {
  clubEloToTeamQuality,
  optaLikeToTeamQuality,
  fifaPointsToTeamQuality,
} from "../js/data/strength/scale.js";
import { resolveClub } from "../js/data/identity/resolver.js";
import { effectiveTeamStrength } from "../js/simulation/teamStrength.js";
import { expectedGoals } from "../js/simulation/matchEngine.js";
import {
  createWorldState,
  serializeWorldState,
  deserializeWorldState,
} from "../js/simulation/worldState.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

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

test("ClubElo raw ratings survive import unchanged", () => {
  const raw = JSON.parse(
    fs.readFileSync(path.join(ROOT, "js/data/strength/raw/clubelo_public_ranking_2026-10-08.json"), "utf8")
  );
  const bayernObs = raw.observations.find((o) => o.providerName === "Bayern München");
  const arsenalObs = raw.observations.find((o) => o.providerName === "Arsenal");
  const bayern = CLUB_PROFILES.find((c) => c.name === "Bayern Munich");
  const arsenal = CLUB_PROFILES.find((c) => c.name === "Arsenal");
  assert.equal(bayern.sourceRating, bayernObs.rawRating);
  assert.equal(arsenal.sourceRating, arsenalObs.rawRating);
  assert.equal(bayern.sourceStatus, "verified_rating");
  assert.equal(bayern.strengthDerivationStatus, "normalized_from_published_rating");
  assert.equal(bayern.provider, "ClubElo");
});

test("FootballDatabase secondary never bypasses conversion", () => {
  const fdb = JSON.parse(
    fs.readFileSync(path.join(ROOT, "js/data/strength/raw/footballdatabase_gap5_2026-10-04.json"), "utf8")
  );
  const cal = JSON.parse(
    fs.readFileSync(path.join(ROOT, "js/data/strength/config/fdbToClubEloCalibration.json"), "utf8")
  );
  assert.equal(fdb.observations.length, 5);
  for (const obs of fdb.observations) {
    const p = CLUB_PROFILES.find((c) => c.clubId === obs.clubId);
    assert.ok(p, obs.clubId);
    assert.equal(p.provider, "FootballDatabase");
    assert.equal(p.sourceRating, obs.rawRating);
    assert.notEqual(p.primaryScaleRating, obs.rawRating);
    assert.equal(p.strengthDerivationStatus, "calibrated_from_published_rating");
    const target = cal.targets.find((t) => t.clubId === obs.clubId);
    assert.equal(p.primaryScaleRating, target.predictedClubElo);
    assert.equal(p.calibrationId, cal.calibrationId);
  }
});

test("every club has exactly one selected baseline; no league-centre priors", () => {
  assert.equal(CLUB_PROFILES.length, 490);
  const ids = new Set(CLUB_PROFILES.map((p) => p.clubId));
  assert.equal(ids.size, 490);
  assert.equal(CLUB_PROFILES.filter((p) => p.strengthDerivationStatus === "normalized_from_published_rating").length, 485);
  assert.equal(CLUB_PROFILES.filter((p) => p.strengthDerivationStatus === "calibrated_from_published_rating").length, 5);
  assert.equal(CLUB_PROFILES.filter((p) => p.sourceStatus === "provisional_estimate").length, 0);
  for (const p of CLUB_PROFILES) {
    assert.ok(!p.provenance?.estimateMethod);
    assert.ok(!["configured_league_center_prior", "single_league_anchor_below", "league_verified_anchor_below_min"].includes(p.evidenceRef));
  }
});

test("research-pack gap IDs remain covered exactly once", () => {
  const pack = JSON.parse(
    fs.readFileSync(
      path.join(
        ROOT,
        "research/strength_pack_2026-10-08/Simulation_Strength_Research_Pack/replacement_observations_455.json"
      ),
      "utf8"
    )
  );
  const gapIds = pack.observations.map((o) => o.clubId);
  assert.equal(gapIds.length, 455);
  assert.equal(new Set(gapIds).size, 455);
  for (const id of gapIds) {
    const hits = CLUB_PROFILES.filter((p) => p.clubId === id);
    assert.equal(hits.length, 1, id);
  }
});

test("derived subratings are not labelled as published observations", () => {
  for (const p of CLUB_PROFILES) {
    assert.equal(p.breakdownEstimated, true);
    assert.equal(p.breakdownMethod, "neutral_equal_split_v1");
    assert.equal(p.attack, p.overall);
    assert.ok(p.replacementOvrMethod);
    assert.equal(p.componentDerivationStatus, "derived_neutral");
  }
});

test("Barcelona Spain and Ecuador names do not conflate", () => {
  const es = resolveClub("FC Barcelona", { nationHint: "Spain" });
  const ec = resolveClub("Barcelona SC", { nationHint: "Ecuador" });
  assert.ok(es.ok && ec.ok);
  assert.notEqual(es.profile.clubId, ec.profile.clubId);
});

test("identity special cases preserve reserve and continuity mappings", () => {
  const fortuna = CLUB_PROFILES.find((p) => p.clubId === "club:spain:celta-fortuna");
  const celta = resolveClub("Celta Vigo", { nationHint: "Spain" }).profile;
  assert.equal(fortuna.providerName, "RC Celta B");
  assert.notEqual(fortuna.primaryScaleRating, celta.primaryScaleRating);
  const bogota = CLUB_PROFILES.find((p) => p.clubId === "club:colombia:internacional-de-bogota");
  assert.equal(bogota.providerName, "La Equidad");
  const ceuta = CLUB_PROFILES.find((p) => p.clubId === "club:spain:ad-ceuta");
  assert.equal(ceuta.providerName, "CA Ceuta");
});

test("publication dates are not invented as ratingAsOfDate", () => {
  const arsenal = CLUB_PROFILES.find((p) => p.name === "Arsenal");
  assert.equal(arsenal.publicationDate, "2026-10-08");
  assert.equal(arsenal.ratingAsOfDate, null);
});

test("rebuild is deterministic", () => {
  const before = fs.readFileSync(path.join(ROOT, "js/data/strength/clubProfiles.generated.js"), "utf8");
  const r = spawnSync("node", ["scripts/buildClubStrengthDb.mjs"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const after = fs.readFileSync(path.join(ROOT, "js/data/strength/clubProfiles.generated.js"), "utf8");
  assert.equal(before, after);
});

test("ClubElo transform is monotonic and distinct from legacy Opta mapping", () => {
  const a = clubEloToTeamQuality(1500);
  const b = clubEloToTeamQuality(1700);
  const c = clubEloToTeamQuality(1900);
  assert.ok(a < b && b < c);
  assert.notEqual(clubEloToTeamQuality(100), optaLikeToTeamQuality(100));
});

test("finance/reputation alone do not change verified match ability", () => {
  const base = resolveClub("Arsenal").profile;
  const rich = { ...base, financialTier: 5, financialPower: 5, reputation: 99 };
  const poor = { ...base, financialTier: 1, financialPower: 1, reputation: 40 };
  const a = effectiveTeamStrength(rich);
  const b = effectiveTeamStrength(poor);
  assert.equal(a.attack, b.attack);
  assert.equal(a.overall, b.overall);
});

test("player OVR still raises expected performance", () => {
  const club = resolveClub("Hull City").profile;
  const low = effectiveTeamStrength(club, {
    player: { position: "ST", rating: 60 },
    playerSide: "home",
    side: "home",
  });
  const high = effectiveTeamStrength(club, {
    player: { position: "ST", rating: 88 },
    playerSide: "home",
    side: "home",
  });
  const opp = effectiveTeamStrength(resolveClub("Burnley").profile);
  assert.ok(high.attack > low.attack);
  assert.ok(expectedGoals(high, opp, { venue: "home" }).home > expectedGoals(low, opp, { venue: "home" }).home);
});

test("career baseline freeze survives serialize with per-team provenance", () => {
  const world = createWorldState({ seed: 9, startYear: 2026 });
  const id = resolveClub("Arsenal").profile.clubId;
  const frozen = world.baselineClubs[id].overall;
  assert.equal(world.baselineClubs[id].provider, "ClubElo");
  assert.ok(world.baselineClubs[id].primaryScaleRating);
  assert.equal(world.clubBaselineSnapshotId, "clubelo-public-ranking-2026-10-08");
  world.clubs.get(id).overall = frozen + 5;
  const json = serializeWorldState(world);
  const again = deserializeWorldState(json);
  assert.equal(again.baselineClubs[id].overall, frozen);
  assert.equal(again.baselineClubs[id].primaryScaleRating, world.baselineClubs[id].primaryScaleRating);
  assert.equal(again.clubs.get(id).overall, frozen + 5);
  assert.ok(again.transformVersion);
});

test("all 79 nations have selected published points; no 1180 priors", () => {
  const selected = JSON.parse(
    fs.readFileSync(path.join(ROOT, "js/data/strength/raw/nation_observations_79.json"), "utf8")
  );
  assert.equal(NATION_PROFILES.length, 79);
  assert.equal(selected.nations.length, 79);
  const byId = new Map(selected.nations.map((n) => [n.nationId, n]));
  for (const p of NATION_PROFILES) {
    const obs = byId.get(p.nationId);
    assert.ok(obs, p.nationId);
    assert.equal(p.fifaPoints, obs.fifaPoints);
    assert.equal(p.fifaRank, obs.fifaRank);
    assert.equal(p.ratingSourceStatus, "published_rating");
    assert.equal(p.sourceEvidenceTier, "corroborated_secondary");
    assert.equal(p.directPrimaryPointsVerified, false);
    assert.equal(p.strengthDerivationStatus, "normalized_from_published_rating");
    assert.equal(p.gameplayPointsPrior, undefined);
    assert.notEqual(p.fifaPoints, 1180);
    assert.equal(p.knownRankWithoutPoints, null);
    assert.equal(p.unresolvedReason, null);
    assert.ok(["UEFA", "CAF", "CONMEBOL", "CONCACAF", "AFC", "OFC"].includes(p.confederation));
  }
  assert.equal(NATION_PROFILES.filter((p) => p.replacesUnresolvedBaseline).length, 59);
});

test("Australia discrepancy retained with selected 1580.52", () => {
  const aus = NATION_PROFILES.find((p) => p.name === "Australia");
  assert.equal(aus.fifaPoints, 1580.52);
  assert.equal(aus.sourceConflict.conflictingPublishedPoints, 1585.52);
  assert.equal(aus.sourceConflict.selectedPublishedPoints, 1580.52);
});

test("Hungary Mali Venezuela use canonical confederations", () => {
  assert.equal(NATION_PROFILES.find((p) => p.name === "Hungary").confederation, "UEFA");
  assert.equal(NATION_PROFILES.find((p) => p.name === "Mali").confederation, "CAF");
  assert.equal(NATION_PROFILES.find((p) => p.name === "Venezuela").confederation, "CONMEBOL");
});

test("nation rebuild is deterministic", () => {
  const before = fs.readFileSync(path.join(ROOT, "js/data/strength/nationProfiles.generated.js"), "utf8");
  const r = spawnSync("node", ["scripts/buildNationStrengthDb.mjs"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const after = fs.readFileSync(path.join(ROOT, "js/data/strength/nationProfiles.generated.js"), "utf8");
  assert.equal(before, after);
});

test("career nation baseline freeze survives serialize and ignores bundled upgrades", () => {
  const world = createWorldState({ seed: 11, startYear: 2026 });
  const serbia = NATION_PROFILES.find((p) => p.name === "Serbia");
  const frozenPts = world.baselineNations[serbia.nationId].fifaPoints;
  assert.equal(frozenPts, serbia.fifaPoints);
  assert.equal(world.nationBaselineSnapshotId, "fifa-men-2026-10-07-inventory79-secondary-v1");
  assert.ok(world.nationContentHash);
  world.nations.get(serbia.nationId).fifaPoints = 9999;
  world.nations.get(serbia.nationId).overall = 40;
  const json = serializeWorldState(world);
  // Simulate a bundled upgrade by not carrying live values from new profiles
  const again = deserializeWorldState(json);
  assert.equal(again.baselineNations[serbia.nationId].fifaPoints, frozenPts);
  assert.equal(again.nations.get(serbia.nationId).overall, 40);
});

test("legacy career without baselineNations keeps prior freeze and is not upgraded", () => {
  const legacyNation = {
    nationId: "nation:serbia",
    name: "Serbia",
    fifaPoints: 1180,
    overall: 48.9,
    attack: 48.9,
    midfield: 48.9,
    defence: 48.9,
    goalkeeper: 48.9,
    ratingSourceStatus: "unresolved",
    sourceStatus: "provisional_estimate",
    strengthDerivationStatus: "unresolved_conversion",
  };
  const again = deserializeWorldState({
    schemaVersion: 2,
    nations: [["nation:serbia", legacyNation]],
    clubs: [],
    leagueMemberships: [],
    form: [],
    standings: [],
    cupResults: [],
    qualification: [],
    fixtureLedger: [],
  });
  assert.equal(again.nations.get("nation:serbia").fifaPoints, 1180);
  assert.equal(again.baselineNations["nation:serbia"].fifaPoints, 1180);
  assert.equal(again.baselineNations["nation:serbia"].legacyGameplayPointsPrior, 1180);
  assert.notEqual(again.baselineNations["nation:serbia"].fifaPoints, serbiaPublishedPoints());
});

function serbiaPublishedPoints() {
  return NATION_PROFILES.find((p) => p.name === "Serbia").fifaPoints;
}

test("coverage reports match profiles and calibration hashes", () => {
  const cov = JSON.parse(fs.readFileSync(path.join(ROOT, "reports/strength-coverage-report.json"), "utf8"));
  assert.equal(cov.clubTotal, CLUB_PROFILES.length);
  assert.equal(cov.strengthDerivationStatus.normalized_from_published_rating, 485);
  assert.equal(cov.strengthDerivationStatus.calibrated_from_published_rating, 5);
  assert.equal(cov.provisional_estimate, 0);
  const cal = JSON.parse(fs.readFileSync(path.join(ROOT, "reports/strength-calibration-report.json"), "utf8"));
  const calCfg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "js/data/strength/config/fdbToClubEloCalibration.json"), "utf8")
  );
  assert.equal(cal.contentHash, calCfg.contentHash);
  assert.equal(cal.acceptance.accepted, true);
  const nat = JSON.parse(fs.readFileSync(path.join(ROOT, "reports/nation-strength-coverage-report.json"), "utf8"));
  assert.equal(nat.total, NATION_PROFILES.length);
  assert.equal(nat.nations.length, NATION_PROFILES.length);
  assert.equal(nat.published_rating, 79);
  assert.equal(nat.unresolved, 0);
  assert.equal(nat.formerUnresolvedPriorsReplaced, 59);
  assert.equal(nat.direct_primary_verified, 0);
  assert.equal(nat.gameplayPointsPriorRemaining, 0);
});

test("FDB calibration LOO audit reproduces stored diagnostics", () => {
  const r = spawnSync("node", ["scripts/auditFdbClubEloCalibration.mjs"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const audit = JSON.parse(fs.readFileSync(path.join(ROOT, "reports/club-calibration-audit-report.json"), "utf8"));
  assert.equal(audit.leaveOneClubOut.globalLinear.maeElo, 60.42);
  assert.equal(audit.leaveOneClubOut.regularizedCountryAware.maeElo, 28.34);
  assert.equal(audit.coefficientsReproduceStored, true);
  assert.equal(audit.defectsFound.length, 0);
  const avs = audit.targets.find((t) => t.clubId === "club:portugal:avs");
  assert.equal(avs.extrapolatesOutsidePairedCountryRange, true);
  assert.equal(avs.predictedClubElo, 1423);
});

console.log("FIFA transform sample Spain→", fifaPointsToTeamQuality(2011.57));
console.log("ClubElo transform sample 1900→", clubEloToTeamQuality(1900));
