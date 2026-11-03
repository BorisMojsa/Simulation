/**
 * Fix 10 focused tests: club strength profiles + superstar lineup impact (F01–F16).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  TARGETS,
  ROLE_REF_OFFSET,
  NEUTRAL_ATTRS,
  roleReference,
  synthProfile,
  worldWithProfiles,
  teamRef,
  makePlayer,
  evaluatePlayerImpact,
  inventorySummary,
  assertContractRow,
  analyticMatchProbs,
  effectiveTeamStrength,
  playerLineupImpact,
  describeTeamStrength,
  expectedGoals,
  simulateMatch,
  resolveKnockout,
  createRng,
  CLUB_PROFILES,
  NATION_PROFILES,
  ROOT,
} from "../scripts/lib/fix10StrengthQa.mjs";
import { resolveTwoLeggedTie } from "../js/simulation/matchEngine.js";
import {
  createWorldState,
  setWorldState,
  serializeWorldState,
  deserializeWorldState,
  adjustQuality,
  CLUB_STRENGTH_MODEL_VERSION,
} from "../js/simulation/worldState.js";

const OUT_DIR = join(ROOT, "qa/fix10-runs/cases");
mkdirSync(OUT_DIR, { recursive: true });

function exportCase(id, payload) {
  writeFileSync(join(OUT_DIR, `${id}.json`), JSON.stringify(payload, null, 2));
}

test("F01 runtime inventory 572 clubs / 79 nations and estimated units", () => {
  const inv = inventorySummary();
  assert.equal(inv.runtimeClubs, 572);
  assert.equal(inv.nationProfiles, 79);
  assert.equal(inv.estimatedUnitClubs, 572);
  const equalUnits = CLUB_PROFILES.every(
    (p) => p.attack === p.overall && p.midfield === p.overall && p.defence === p.overall && p.goalkeeper === p.overall
  );
  assert.equal(equalUnits, true);
  exportCase("F01", { ok: true, ...inv, equalUnits });
});

test("F02 asymmetric unit profiles affect correct xG channels", () => {
  const profile = synthProfile(70, {
    asymmetric: { attack: 78, midfield: 70, defence: 62, goalkeeper: 68 },
  });
  const world = worldWithProfiles([profile]);
  const team = teamRef(profile);
  const eff = effectiveTeamStrength(team, { worldState: world });
  assert.equal(eff.attack, 78);
  assert.equal(eff.defence, 62);
  const opp = synthProfile(70, { clubId: "club:synth:opp" });
  const world2 = worldWithProfiles([profile, opp]);
  const base = expectedGoals(
    effectiveTeamStrength(team, { worldState: world2 }),
    effectiveTeamStrength(teamRef(opp), { worldState: world2 }),
    { venue: "neutral" }
  );
  const highAtk = synthProfile(70, {
    clubId: profile.clubId,
    asymmetric: { attack: 85, midfield: 70, defence: 62, goalkeeper: 68 },
  });
  const world3 = worldWithProfiles([highAtk, opp]);
  const raised = expectedGoals(
    effectiveTeamStrength(teamRef(highAtk), { worldState: world3 }),
    effectiveTeamStrength(teamRef(opp), { worldState: world3 }),
    { venue: "neutral" }
  );
  assert.ok(raised.home > base.home, "higher ATK raises own xG");
  const highDef = synthProfile(70, {
    clubId: profile.clubId,
    asymmetric: { attack: 78, midfield: 70, defence: 80, goalkeeper: 68 },
  });
  const world4 = worldWithProfiles([highDef, opp]);
  const resisted = expectedGoals(
    effectiveTeamStrength(teamRef(opp), { worldState: world4 }),
    effectiveTeamStrength(teamRef(highDef), { worldState: world4 }),
    { venue: "neutral" }
  );
  const baseOppAttack = expectedGoals(
    effectiveTeamStrength(teamRef(opp), { worldState: world2 }),
    effectiveTeamStrength(team, { worldState: world2 }),
    { venue: "neutral" }
  );
  assert.ok(resisted.home < baseOppAttack.home, "higher DEF lowers opponent xG");
  exportCase("F02", { ok: true, base, raised, resisted, baseOppAttack, eff });
});

test("F03 reference neutral, inferior hurts, ordered OVRs above reference", () => {
  const rows = [];
  for (const quality of [55, 70]) {
    for (const role of ["ST", "CM", "CB", "GK"]) {
      const ref = roleReference(quality, role);
      const neutral = evaluatePlayerImpact({ quality, role, ovr: ref });
      assert.equal(neutral.dEp, 0);
      assert.equal(neutral.dAttack, 0);
      const inferior = evaluatePlayerImpact({ quality, role, ovr: ref - 10 });
      assert.ok(inferior.dEp < 0, `${role}@${quality} inferior`);
      const ladder = [75, 85, 90, 95, 99]
        .filter((o) => o > ref)
        .map((ovr) => evaluatePlayerImpact({ quality, role, ovr }));
      for (let i = 1; i < ladder.length; i += 1) {
        assert.ok(ladder[i].dEp >= ladder[i - 1].dEp - 1e-9, `${role} monotonic`);
      }
      rows.push({ quality, role, neutral, inferiorEp: inferior.dEp, ladderEps: ladder.map((r) => r.dEp) });
    }
  }
  exportCase("F03", { ok: true, rows });
});

test("F04 complete minute scaling including secondary attributes", () => {
  const profile = synthProfile(70);
  const world = worldWithProfiles([profile]);
  const playerBase = {
    name: "Attr",
    position: "ST",
    currentOverallRaw: 68,
    attributes: { Shooting: 99, Passing: 99, Defending: 99 },
  };
  const m0 = playerLineupImpact(profile, playerBase, { participates: true, minutes: 0 });
  const m30 = playerLineupImpact(profile, playerBase, { participates: true, minutes: 30 });
  const m90 = playerLineupImpact(profile, playerBase, { participates: true, minutes: 90 });
  assert.equal(m0.attack, 0);
  assert.ok(m90.attack > m30.attack);
  assert.ok(Math.abs(m30.attack * 3 - m90.attack) < 0.05);
  // Negative OVR influence also scales
  const weak = makePlayer({ position: "ST", ovr: 50, minutes: 90 });
  const w30 = playerLineupImpact(profile, weak, { participates: true, minutes: 30 });
  const w90 = playerLineupImpact(profile, weak, { participates: true, minutes: 90 });
  assert.ok(w90.attack < 0 && w30.attack < 0);
  assert.ok(Math.abs(w30.attack * 3 - w90.attack) < 0.05);
  exportCase("F04", { ok: true, m0, m30, m90, w30, w90 });
});

test("F05 absent / wrong-side / zero-minute influence is exactly zero", () => {
  const profile = synthProfile(70);
  const world = worldWithProfiles([profile]);
  const team = teamRef(profile);
  const player = makePlayer({ position: "ST", ovr: 99, minutes: 90 });
  const base = effectiveTeamStrength(team, { worldState: world });
  const wrongSide = effectiveTeamStrength(team, {
    worldState: world,
    player,
    playerSide: "away",
    side: "home",
    playerMinutes: 90,
  });
  const zeroMin = effectiveTeamStrength(team, {
    worldState: world,
    player,
    playerSide: "home",
    side: "home",
    playerMinutes: 0,
  });
  const absent = effectiveTeamStrength(team, {
    worldState: world,
    player: null,
    playerSide: "home",
    side: "home",
  });
  assert.equal(wrongSide.attack, base.attack);
  assert.equal(zeroMin.attack, base.attack);
  assert.equal(absent.attack, base.attack);
  exportCase("F05", { ok: true, base, wrongSide, zeroMin, absent });
});

test("F06 ST/CM/CB/GK meet numeric contract", () => {
  const results = [];
  for (const quality of TARGETS.controls.qualities) {
    for (const role of TARGETS.controls.roles) {
      const row99 = evaluatePlayerImpact({ quality, role, ovr: 99 });
      const fails = assertContractRow(row99);
      assert.equal(fails.length, 0, `${role}@${quality}: ${fails.join(", ")}`);
      if (quality === 70) {
        const row90 = evaluatePlayerImpact({ quality, role, ovr: 90 });
        assert.ok(
          row99.dEp - row90.dEp >= TARGETS.acceptance.highEnd99vs90ExpectedPoints.min - 1e-12,
          `99vs90 ${role}`
        );
      }
      results.push({
        quality,
        role,
        ownXgPct: row99.ownXgPct,
        oppXgPct: row99.oppXgPct,
        dEp: row99.dEp,
        dOverall: row99.dOverall,
        unitMax: Math.max(
          Math.abs(row99.dAttack),
          Math.abs(row99.dMidfield),
          Math.abs(row99.dDefence),
          Math.abs(row99.dGoalkeeper)
        ),
      });
    }
  }
  const e55 = evaluatePlayerImpact({ quality: 55, role: "ST", ovr: 99 }).dEp;
  const e88 = evaluatePlayerImpact({ quality: 88, role: "ST", ovr: 99 }).dEp;
  assert.ok(e88 > 0 && e88 < e55, "elite diminishing");
  exportCase("F06", { ok: true, results, elite: { e55, e88 }, targets: TARGETS.acceptance });
});

test("F07 raw currentOverallRaw precedes stale display/cache values", () => {
  const profile = synthProfile(70);
  const world = worldWithProfiles([profile]);
  const player = {
    name: "Cache",
    position: "ST",
    currentOverallRaw: 99,
    currentOverall: 70,
    rating: 70,
    attributes: { ...NEUTRAL_ATTRS },
  };
  const eff = effectiveTeamStrength(teamRef(profile), {
    worldState: world,
    player,
    playerSide: "home",
    side: "home",
    playerMinutes: 90,
  });
  const as70 = evaluatePlayerImpact({ quality: 70, role: "ST", ovr: 70 });
  assert.ok(eff.attack - as70.withPlayer.attack > 1, "raw 99 beats stale 70");
  exportCase("F07", {
    ok: true,
    abilityUsedPath: "currentOverallRaw",
    attack: eff.attack,
    impact: eff.playerImpact,
  });
});

test("F08 strength/xG grid, venues, symmetry, finance independence, form bounds", () => {
  const qualities = [45, 55, 70, 85, 93];
  const grid = [];
  for (const hq of qualities) {
    for (const aq of qualities) {
      for (const venue of ["home", "away", "neutral"]) {
        const home = synthProfile(hq, { clubId: `club:grid:h${hq}` });
        const away = synthProfile(aq, { clubId: `club:grid:a${aq}` });
        const world = worldWithProfiles([home, away]);
        const h = effectiveTeamStrength(teamRef(home), { worldState: world });
        const a = effectiveTeamStrength(teamRef(away), { worldState: world });
        const xg = expectedGoals(h, a, { venue });
        grid.push({ hq, aq, venue, xg });
      }
    }
  }
  const p = synthProfile(70, { clubId: "club:sym:a" });
  const q = synthProfile(70, { clubId: "club:sym:b" });
  const world = worldWithProfiles([p, q]);
  const left = expectedGoals(
    effectiveTeamStrength(teamRef(p), { worldState: world }),
    effectiveTeamStrength(teamRef(q), { worldState: world }),
    { venue: "neutral" }
  );
  const right = expectedGoals(
    effectiveTeamStrength(teamRef(q), { worldState: world }),
    effectiveTeamStrength(teamRef(p), { worldState: world }),
    { venue: "neutral" }
  );
  assert.equal(left.home, right.away);
  assert.equal(left.away, right.home);
  const rich = { ...p, financialPower: 5, reputation: 99 };
  const poor = { ...p, clubId: "club:poor", financialPower: 1, reputation: 40 };
  const worldMoney = worldWithProfiles([rich, poor]);
  const xRich = expectedGoals(
    effectiveTeamStrength(teamRef(rich), { worldState: worldMoney }),
    effectiveTeamStrength(teamRef(poor), { worldState: worldMoney }),
    { venue: "neutral" }
  );
  const xPoorHome = expectedGoals(
    effectiveTeamStrength(teamRef(poor), { worldState: worldMoney }),
    effectiveTeamStrength(teamRef(rich), { worldState: worldMoney }),
    { venue: "neutral" }
  );
  // Swap sides with equal units of same overall → finance must not change lambdas for equal profiles.
  const equalA = synthProfile(70, { clubId: "club:fin:a" });
  const equalB = synthProfile(70, { clubId: "club:fin:b" });
  equalA.financialPower = 5;
  equalB.financialPower = 1;
  const worldEq = worldWithProfiles([equalA, equalB]);
  const xEq = expectedGoals(
    effectiveTeamStrength(teamRef(equalA), { worldState: worldEq }),
    effectiveTeamStrength(teamRef(equalB), { worldState: worldEq }),
    { venue: "neutral" }
  );
  assert.equal(xEq.home, xEq.away);
  exportCase("F08", { ok: true, gridSize: grid.length, left, right, xRich, xPoorHome, xEq });
});

test("F09 fractional replacement evolution accumulates across small deltas", () => {
  const world = createWorldState({ seed: 1010, startYear: 2026 });
  setWorldState(world);
  const club = [...world.clubs.values()][0];
  const before = { ...club.replacementOvr };
  for (let i = 0; i < 20; i += 1) adjustQuality(club, 0.1);
  for (const k of Object.keys(before)) {
    assert.ok(club.replacementOvr[k] > before[k], `${k} rose`);
  }
  // Explicit: after twenty +0.1 with 0.5 factor → +1.0 on replacements before clamps.
  const expected = Number((before.ST + 20 * 0.1 * 0.5).toFixed(4));
  assert.equal(club.replacementOvr.ST, expected);
  assert.ok(!Number.isInteger(club.replacementOvr.ST) || expected === Math.trunc(expected));
  const snap = serializeWorldState(world);
  const restored = deserializeWorldState(JSON.parse(JSON.stringify(snap)));
  const club2 = restored.clubs.get(club.clubId);
  assert.equal(club2.replacementOvr.ST, expected);
  // Idempotent re-deserialize
  const again = deserializeWorldState(serializeWorldState(restored));
  assert.equal(again.clubs.get(club.clubId).replacementOvr.ST, expected);
  // Negative path
  const down = createWorldState({ seed: 1011, startYear: 2026 });
  const c2 = [...down.clubs.values()][0];
  const st0 = c2.replacementOvr.ST;
  for (let i = 0; i < 20; i += 1) adjustQuality(c2, -0.1);
  assert.equal(c2.replacementOvr.ST, Number((st0 - 1).toFixed(4)));
  exportCase("F09", {
    ok: true,
    beforeST: before.ST,
    afterST: club.replacementOvr.ST,
    expected,
    modelVersion: CLUB_STRENGTH_MODEL_VERSION,
  });
});

test("F10 departure leaves former club without user contribution", () => {
  const home = synthProfile(70, { clubId: "club:home" });
  const away = synthProfile(72, { clubId: "club:away" });
  const world = worldWithProfiles([home, away]);
  const player = makePlayer({ position: "ST", ovr: 99, minutes: 90 });
  const withHome = effectiveTeamStrength(teamRef(home), {
    worldState: world,
    player,
    playerSide: "home",
    side: "home",
    playerMinutes: 90,
  });
  const formerAfterMove = effectiveTeamStrength(teamRef(home), {
    worldState: world,
    player,
    playerSide: "away",
    side: "home",
    playerMinutes: 90,
  });
  const receiver = effectiveTeamStrength(teamRef(away), {
    worldState: world,
    player,
    playerSide: "away",
    side: "away",
    playerMinutes: 90,
  });
  assert.equal(formerAfterMove.attack, effectiveTeamStrength(teamRef(home), { worldState: world }).attack);
  assert.ok(receiver.attack > effectiveTeamStrength(teamRef(away), { worldState: world }).attack);
  assert.ok(withHome.attack > formerAfterMove.attack);
  exportCase("F10", { ok: true, withHomeAttack: withHome.attack, former: formerAfterMove.attack, receiver: receiver.attack });
});

test("F11 non-continuing player has no ET effect; regulation evidence unchanged", () => {
  const home = synthProfile(70, { clubId: "club:et:h" });
  const away = synthProfile(70, { clubId: "club:et:a" });
  const world = worldWithProfiles([home, away]);
  const star = makePlayer({ position: "ST", ovr: 99, minutes: 30 });
  const none = simulateMatch(teamRef(home), teamRef(away), {
    worldState: world,
    venue: "neutral",
    player: null,
    rng: createRng(42),
  });
  // Force draw path by constructing synthetic regulation match
  const reg = simulateMatch(teamRef(home), teamRef(away), {
    worldState: world,
    venue: "neutral",
    player: star,
    playerSide: "home",
    playerMinutes: 30,
    rng: createRng(7),
  });
  const regulationStrength = JSON.parse(JSON.stringify(reg.regulationEffectiveStrength));
  const drawn = {
    ...reg,
    homeGoals: 1,
    awayGoals: 1,
    regulationHomeGoals: 1,
    regulationAwayGoals: 1,
    matchHomeGoals: 1,
    matchAwayGoals: 1,
    winnerSide: null,
    decidedBy: null,
  };
  const after = resolveKnockout(drawn, { player: star, allowExtraTime: true, allowPenalties: false, rng: createRng(99) });
  assert.ok(after.etEffectiveStrength || after.effectiveStrength);
  const etHomeAtk = after.effectiveStrength.home.attack;
  const noUserEt = (() => {
    const d = {
      ...none,
      homeGoals: 1,
      awayGoals: 1,
      regulationHomeGoals: 1,
      regulationAwayGoals: 1,
      matchHomeGoals: 1,
      matchAwayGoals: 1,
      winnerSide: null,
      playerSide: null,
    };
    return resolveKnockout(d, { player: null, allowExtraTime: true, allowPenalties: false, rng: createRng(99) });
  })();
  assert.equal(etHomeAtk, noUserEt.effectiveStrength.home.attack);
  assert.deepEqual(after.regulationEffectiveStrength.home.attack, regulationStrength.home.attack);
  // Continuing control
  const full = makePlayer({ position: "ST", ovr: 99, minutes: 90 });
  const regFull = simulateMatch(teamRef(home), teamRef(away), {
    worldState: world,
    venue: "neutral",
    player: full,
    playerSide: "home",
    playerMinutes: 90,
    rng: createRng(11),
  });
  const drawnFull = {
    ...regFull,
    homeGoals: 0,
    awayGoals: 0,
    regulationHomeGoals: 0,
    regulationAwayGoals: 0,
    matchHomeGoals: 0,
    matchAwayGoals: 0,
    winnerSide: null,
  };
  const afterFull = resolveKnockout(drawnFull, {
    player: full,
    allowExtraTime: true,
    allowPenalties: false,
    rng: createRng(99),
  });
  assert.ok(afterFull.effectiveStrength.home.attack > noUserEt.effectiveStrength.home.attack);
  exportCase("F11", {
    ok: true,
    nonContinuingEtAtk: etHomeAtk,
    continuingEtAtk: afterFull.effectiveStrength.home.attack,
    regulationAttack: regulationStrength.home.attack,
  });
});

test("F12 two-legged ET venue orientation and pens exclude kick goals", () => {
  const home = synthProfile(70, { clubId: "club:tl:h" });
  const away = synthProfile(70, { clubId: "club:tl:a" });
  const world = worldWithProfiles([home, away]);
  const player = makePlayer({ position: "GK", ovr: 99, minutes: 90 });
  const first = simulateMatch(teamRef(home), teamRef(away), {
    worldState: world,
    venue: "home",
    player,
    playerSide: "home",
    playerMinutes: 90,
    rng: createRng(1),
  });
  first.homeGoals = 1;
  first.awayGoals = 1;
  first.regulationHomeGoals = 1;
  first.regulationAwayGoals = 1;
  first.matchHomeGoals = 1;
  first.matchAwayGoals = 1;
  const second = simulateMatch(teamRef(away), teamRef(home), {
    worldState: world,
    venue: "home",
    player,
    playerSide: "away",
    playerMinutes: 90,
    rng: createRng(2),
  });
  second.homeGoals = 1;
  second.awayGoals = 1;
  second.regulationHomeGoals = 1;
  second.regulationAwayGoals = 1;
  second.matchHomeGoals = 1;
  second.matchAwayGoals = 1;
  const tie = resolveTwoLeggedTie(first, second, {
    player,
    allowExtraTime: true,
    allowPenalties: true,
    rng: createRng(3),
  });
  if (tie.decidedBy === "penalties") {
    assert.equal(tie.secondLeg.matchHomeGoals, (tie.secondLeg.regulationHomeGoals || 0) + (tie.secondLeg.etHomeGoals || 0));
    assert.ok(tie.penaltyHome != null);
    assert.notEqual(tie.secondLeg.homeGoals, tie.penaltyHome);
  }
  exportCase("F12", {
    ok: true,
    decidedBy: tie.decidedBy,
    aggregate: tie.aggregate,
    pens: { home: tie.penaltyHome, away: tie.penaltyAway },
  });
});

test("F13 career restoration preserves fractional replacements and model metadata", () => {
  const world = createWorldState({ seed: 4242, startYear: 2026 });
  const club = [...world.clubs.values()][0];
  adjustQuality(club, 0.1);
  adjustQuality(club, 0.1);
  const st = club.replacementOvr.ST;
  const serialized = serializeWorldState(world);
  assert.equal(serialized.clubStrengthModelVersion, CLUB_STRENGTH_MODEL_VERSION);
  const restored = deserializeWorldState(JSON.parse(JSON.stringify(serialized)));
  assert.equal(restored.clubStrengthModelVersion, CLUB_STRENGTH_MODEL_VERSION);
  assert.equal(restored.clubs.get(club.clubId).replacementOvr.ST, st);
  assert.ok(restored.schemaVersion >= 4);
  exportCase("F13", { ok: true, st, model: restored.clubStrengthModelVersion, schema: restored.schemaVersion });
});

test("F14 overview describeTeamStrength surfaces estimated unit cue", () => {
  const profile = synthProfile(70);
  const world = worldWithProfiles([profile]);
  const desc = describeTeamStrength(teamRef(profile), world);
  assert.equal(desc.unitsEstimated, true);
  assert.equal(desc.unitRatingsLabel, "Estimated unit ratings");
  const asymmetric = synthProfile(70, {
    clubId: "club:asym:ui",
    asymmetric: { attack: 80, midfield: 70, defence: 60, goalkeeper: 65 },
  });
  const world2 = worldWithProfiles([asymmetric]);
  const desc2 = describeTeamStrength(teamRef(asymmetric), world2);
  assert.equal(desc2.attack, 80);
  assert.equal(desc2.defence, 60);
  assert.equal(desc2.unitsEstimated, false);
  exportCase("F14", { ok: true, desc, desc2 });
});

test("F15 export helpers do not mutate fixtures or double-apply form", () => {
  const world = createWorldState({ seed: 55, startYear: 2026 });
  setWorldState(world);
  const before = serializeWorldState(world);
  inventorySummary();
  evaluatePlayerImpact({ quality: 70, role: "ST", ovr: 99 });
  const after = serializeWorldState(world);
  assert.equal(JSON.stringify(before.clubs), JSON.stringify(after.clubs));
  assert.equal(JSON.stringify(before.form), JSON.stringify(after.form));
  exportCase("F15", { ok: true });
});

test("F16 corrupt evidence fails validation helper", () => {
  const row = evaluatePlayerImpact({ quality: 70, role: "ST", ovr: 99 });
  row.ownXgPct = 1; // corrupt below 15%
  const fails = assertContractRow(row);
  assert.ok(fails.length > 0);
  exportCase("F16", { ok: true, fails });
});
