/**
 * Baseline-compatible 48-record cohort runner for Fix 06 ↔ Fix 07 comparison.
 *
 * Uses only APIs present on accepted Fix 06 (`8313f27`): no playingTimeAssessment
 * module, no Fix 07-only recovery helpers. Same seeds/policies as the Fix 07
 * ordinary cohort. Run against a tree root:
 *
 *   ROOT=/path/to/fix06 node baseline/Fix07BaselineCohortRunner.mjs > baseline-out.json
 *   ROOT=/path/to/fix07 node baseline/Fix07BaselineCohortRunner.mjs > final-out.json
 *
 * Does not port Fix 07 production repairs into the Fix 06 tree.
 */
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";

const root = process.env.ROOT || process.cwd();
const mod = (p) => import(pathToFileURL(`${root}/${p}`));

const { createPlayerIdentity } = await mod("js/simulation/playerDevelopment.js");
const { ensurePlayerModel } = await mod("js/simulation/playerModelMigration.js");
const { refreshAbilityCaches } = await mod("js/simulation/playerAbility.js");
const { allSeniorClubs } = await mod("js/simulation/seniorClubs.js");
const { createWorldState, setWorldState } = await mod("js/simulation/worldState.js");
const { resetClubFinanceLedgers } = await mod("js/simulation/clubFinance.js");
const { reseedCareerRng } = await mod("js/simulation/rng.js");
const { ensureContractAuthority } = await mod("js/simulation/contractLifecycle.js");
const { simulateSeason } = await mod("js/simulation/seasonSimulator.js");
const { generateTransferOffers } = await mod("js/simulation/transferMarket.js");
const { acceptPipelineOffer, declineWindowAndContinue } = await mod("js/simulation/dealPipeline.js");
const { clubMinutesShare } = await mod("js/simulation/squadDecisions.js");
const { LEAGUES, LEAGUE_LOOKUP } = await mod("js/data/leagues.js");

const POLICY_MODE = {
  "renewal-first": "renewal-first",
  "beneficial-loan-first": "accept-first-loan",
  "accept-suitable-free-agent-offer": "stay",
  stay: "stay",
};

const CAREERS = [
  { id: "C01", seed: 707, position: "ST", rating: 58, age: 21, nationality: "Serbia", clubName: "Hull City", policy: "stay", setup: "fit", contractEndSeason: 5 },
  { id: "C02", seed: 708, position: "CM", rating: 66, age: 22, nationality: "Italy", clubName: "Atalanta", policy: "stay", setup: "reduced", contractEndSeason: 5 },
  { id: "C03", seed: 709, position: "CB", rating: 62, age: 20, nationality: "Spain", leagueId: "league:spain-la-liga", clubIndex: 5, policy: "beneficial-loan-first", setup: "fit", contractEndSeason: 5 },
  { id: "C04", seed: 710, position: "GK", rating: 60, age: 19, nationality: "England", leagueId: "league:england-premier-league", clubIndex: 10, policy: "beneficial-loan-first", setup: "low", contractEndSeason: 5 },
  { id: "C05", seed: 711, position: "ST", rating: 84, age: 27, nationality: "Brazil", leagueId: "league:italy-serie-a", clubIndex: 15, policy: "renewal-first", setup: "reduced", contractEndSeason: 1 },
  { id: "C06", seed: 712, position: "CM", rating: 84, age: 33, nationality: "England", clubName: "Hull City", policy: "renewal-first", setup: "fit", contractEndSeason: 1 },
  { id: "C07", seed: 713, position: "CB", rating: 64, age: 30, nationality: "Serbia", leagueId: "league:spain-la-liga", clubIndex: 9, policy: "accept-suitable-free-agent-offer", setup: "low", contractEndSeason: 1 },
  { id: "C08", seed: 714, position: "GK", rating: 68, age: 31, nationality: "Italy", leagueId: "league:italy-serie-a", clubIndex: 11, policy: "accept-suitable-free-agent-offer", setup: "reduced", contractEndSeason: 1 },
  { id: "C09", seed: 715, position: "ST", rating: 65, age: 24, nationality: "Spain", leagueId: "league:spain-la-liga", clubIndex: 3, policy: "stay", setup: "low", contractEndSeason: 5 },
  { id: "C10", seed: 716, position: "CM", rating: 61, age: 21, nationality: "Brazil", leagueId: "league:england-premier-league", clubIndex: 14, policy: "beneficial-loan-first", setup: "reduced", contractEndSeason: 5 },
  { id: "C11", seed: 717, position: "CB", rating: 84, age: 26, nationality: "England", leagueId: "league:italy-serie-a", clubIndex: 17, policy: "renewal-first", setup: "fit", contractEndSeason: 1 },
  { id: "C12", seed: 718, position: "GK", rating: 56, age: 23, nationality: "Serbia", leagueId: "league:england-premier-league", clubIndex: 16, policy: "accept-suitable-free-agent-offer", setup: "low", contractEndSeason: 1 },
];

function attrs(ovr) {
  return Object.fromEntries(
    ["Speed", "Passing", "Shooting", "Defending", "Physicality", "Dribbling"].map((k) => [k, ovr])
  );
}

function resolveClub(cfg) {
  const all = allSeniorClubs();
  if (cfg.clubName) {
    const named = all.find((c) => c.name === cfg.clubName);
    if (!named) throw new Error(`no senior club named ${cfg.clubName}`);
    return named;
  }
  // Match ordinary Fix 07 cohort resolution: leagueId + stable clubIndex over
  // senior clubs (league.clubs entries are objects, not raw IDs).
  const leagueClubs = all.filter((c) => c.leagueId === cfg.leagueId);
  const club = leagueClubs[cfg.clubIndex] || leagueClubs[0];
  if (!club) throw new Error(`no senior club for ${cfg.leagueId}#${cfg.clubIndex}`);
  return club;
}

function readiness(setup) {
  if (setup === "low") return { form: -0.4, morale: -0.2, readiness: 0.55, fatigue: 0.35 };
  if (setup === "reduced") return { form: -0.15, morale: 0, readiness: 0.75, fatigue: 0.2 };
  return { form: 0, morale: 0, readiness: 1, fatigue: 0 };
}

function makePlayer(cfg) {
  resetClubFinanceLedgers();
  setWorldState(createWorldState({ startYear: 2026 }));
  reseedCareerRng(cfg.seed);
  const club = resolveClub(cfg);
  if (!club?.clubId) throw new Error(`club resolution failed for ${cfg.id}`);
  const p = createPlayerIdentity({
    name: `Fix07Base-${cfg.id}`,
    nationality: cfg.nationality,
    position: cfg.position,
    age: cfg.age,
  });
  Object.assign(p, {
    careerId: `fix07-base-${cfg.id}`,
    startYear: 2026,
    age: cfg.age,
    rating: cfg.rating,
    attributes: attrs(cfg.rating),
    club: { ...club },
    employmentClubId: club.clubId,
    playingClubId: club.clubId,
    contractStatus: "active",
    contractStartSeason: 0,
    contractYears: cfg.contractEndSeason,
    contractEndSeason: cfg.contractEndSeason,
    weeklyWage: 1500,
    wage: 1500,
    seasons: [],
    state: { ...readiness(cfg.setup), roleFit: 1, adaptationPenalty: 0 },
  });
  ensurePlayerModel(p);
  refreshAbilityCaches(p);
  ensureContractAuthority(p);
  if (p.employmentClubId !== club.clubId || p.contractStatus !== "active") {
    throw new Error(`initial employment assertion failed for ${cfg.id}`);
  }
  return p;
}

function isFreeAgent(p) {
  return !p.employmentClubId || p.contractStatus === "released" || p.freeAgent;
}

function suitableFreeAgentOffer(offers) {
  return (
    (offers || []).find(
      (o) =>
        !o.isLoan &&
        !o.isRenewal &&
        o.expectedRole !== "ineligible" &&
        (o.projectedMinutesShare == null || o.projectedMinutesShare >= 0.35)
    ) || null
  );
}

function summarizePeriod(player, cfg, seasonIdx, kind, faAction, thrown) {
  const season = player.seasons?.[player.seasons.length - 1] || null;
  let share = null;
  let shareSource = null;
  try {
    const s = clubMinutesShare(player, { persistAssessment: false });
    share = s?.share ?? null;
    shareSource = s?.assessment?.source || s?.source || null;
  } catch {
    share = null;
  }
  return {
    caseId: `${cfg.id}-${cfg.position}-seed${cfg.seed}-p${seasonIdx + 1}`,
    seed: cfg.seed,
    policy: cfg.policy,
    setup: cfg.setup,
    kind,
    faAction,
    thrown: thrown || null,
    age: player.age,
    seasons: player.seasons?.length || 0,
    employmentClubId: player.employmentClubId || null,
    playingClubId: player.playingClubId || null,
    contractStatus: player.contractStatus || null,
    contractEndSeason: player.contractEndSeason ?? null,
    weeklyWage: player.weeklyWage ?? null,
    matches: season?.matches ?? null,
    minutes: season?.minutes ?? null,
    standingMatches: season?.standing?.matches ?? null,
    share,
    shareSource,
    // Measured exposure only — source "none"/unknown must not count as share 1.
    measuredShare:
      shareSource && shareSource !== "none" && typeof share === "number" && Number.isFinite(share)
        ? share
        : null,
    freeAgent: Boolean(isFreeAgent(player)),
    loanActive: player.activeLoan?.status === "active",
    pendingReview: player.pendingContractReview?.status || null,
  };
}

function stepPeriod(player, cfg) {
  const out = { kind: "club-season", faAction: null, thrown: null };
  try {
    if (isFreeAgent(player)) {
      const offers = generateTransferOffers(70, player, LEAGUES, LEAGUE_LOOKUP, null);
      let signed = false;
      if (cfg.policy === "accept-suitable-free-agent-offer") {
        const offer = suitableFreeAgentOffer(offers);
        if (offer) {
          const acc = acceptPipelineOffer(player, offer);
          if (!acc.ok) throw new Error(`fa accept failed: ${acc.reason}`);
          signed = true;
          out.faAction = "signed";
          player.pendingOffers = [];
        }
      }
      if (!signed) {
        if (offers.length && typeof declineWindowAndContinue === "function") {
          player.pendingOffers = offers;
          declineWindowAndContinue(player, { choiceId: "decline-window" });
          out.faAction = "refused";
        } else out.faAction = "empty-wait";
        const res = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, { pauseForDecisions: false });
        out.kind = "free-agent-period";
        if (!res?.freeAgent) throw new Error("fa wait missing freeAgent flag");
        return out;
      }
    }
    const res = simulateSeason(player, LEAGUES, LEAGUE_LOOKUP, {
      autoDecisionPolicy: POLICY_MODE[cfg.policy],
      pauseForDecisions: false,
    });
    if (res?.freeAgent || res?.awaitingDecision) throw new Error("club period incomplete");
  } catch (e) {
    out.thrown = String(e?.stack || e);
  }
  return out;
}

const initialFixtures = [];
const records = [];
for (const cfg of CAREERS) {
  const player = makePlayer(cfg);
  initialFixtures.push({
    id: cfg.id,
    seed: cfg.seed,
    policy: cfg.policy,
    setup: cfg.setup,
    employmentClubId: player.employmentClubId,
    playingClubId: player.playingClubId,
    contractStatus: player.contractStatus,
    contractEndSeason: player.contractEndSeason,
    clubName: player.club?.name || null,
    leagueId: player.club?.leagueId || null,
  });
  for (let k = 0; k < 4; k++) {
    const step = stepPeriod(player, cfg);
    records.push(summarizePeriod(player, cfg, k, step.kind, step.faAction, step.thrown));
  }
}

if (initialFixtures.length !== 12 || initialFixtures.some((f) => !f.employmentClubId)) {
  throw new Error("all 12 careers must resolve an initial employer before simulation");
}

const measured = records.map((r) => r.measuredShare).filter((x) => typeof x === "number" && Number.isFinite(x));
const summary = {
  generatedAt: new Date().toISOString(),
  root,
  recordCount: records.length,
  thrown: records.filter((r) => r.thrown).length,
  freeAgentPeriods: records.filter((r) => r.kind === "free-agent-period").length,
  clubSeasons: records.filter((r) => r.kind === "club-season").length,
  loansActive: records.filter((r) => r.loanActive).length,
  initialEmployedCareers: initialFixtures.filter((f) => f.contractStatus === "active").length,
  meanMeasuredShare: measured.length ? measured.reduce((a, b) => a + b, 0) / measured.length : null,
  measuredShareCount: measured.length,
  unknownOrNoneShareCount: records.length - measured.length,
};

const out = { summary, initialFixtures, records };
const dest = process.env.FIX07_BASELINE_OUT;
if (dest) writeFileSync(dest, JSON.stringify(out, null, 2));
console.log(JSON.stringify(summary));
if (!dest) console.log(JSON.stringify(out));
