#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a, true];
  })
);
const rootDir = args.root;
const inputPath = args.input;
const outPath = args.out;
const recipe = JSON.parse(await (await import("node:fs")).promises.readFile(inputPath, "utf8"));
const rootUrl = pathToFileURL(rootDir.endsWith("/") ? rootDir : rootDir + "/");
const mod = (rel) => import(new URL(rel, rootUrl));

const { LEAGUES } = await mod("js/data/leagues.js");
const { createWorldState, setWorldState, getWorldState, serializeWorldState } = await mod(
  "js/simulation/worldState.js"
);
const { resetClubFinanceLedgers, exportClubFinanceState } = await mod("js/simulation/clubFinance.js");
const { createRng, reseedCareerRng, getSimRng } = await mod("js/simulation/rng.js");
const {
  commitCompletedDomesticEdition,
} = await mod("js/simulation/earnedQualification.js");
const { recordPlayingTransition, ensurePlayingStints } = await mod("js/simulation/playingRegistration.js");
const { generateStartingAttributes, initializePlayerDevelopment } = await mod(
  "js/simulation/playerDevelopmentModel.js"
);
const { ensurePlayerModel } = await mod("js/simulation/playerModelMigration.js");
const { refreshAbilityCaches } = await mod("js/simulation/playerAbility.js");
const { ensureContractAuthority } = await mod("js/simulation/contractLifecycle.js");
const { ensureTransferSave } = await mod("js/simulation/transferMigration.js");
const { qualificationForPosition, findSisterLeagues } = await mod("js/simulation/leaguePhase.js");

const league = LEAGUES.find((l) => l.leagueId === recipe.leagueId);
const arsenal = league.clubs.find((c) => c.clubId === recipe.arsenalId);
const brentford = league.clubs.find((c) => c.clubId === recipe.brentfordId);

function orderedTable(placements = {}) {
  const sisters = findSisterLeagues(league, LEAGUES);
  const placed = new Map(Object.entries(placements));
  const remaining = league.clubs.filter((c) => ![...placed.values()].includes(c.clubId));
  const slots = Array.from({ length: league.clubs.length }, () => null);
  for (const [posStr, clubId] of placed) slots[Number(posStr) - 1] = league.clubs.find((c) => c.clubId === clubId);
  let r = 0;
  for (let i = 0; i < slots.length; i++) if (!slots[i]) slots[i] = remaining[r++];
  return slots.map((c, i) => {
    const position = i + 1;
    return {
      ...c,
      position,
      points: Math.max(0, 100 - i * 3),
      matches: 38,
      played: 38,
      wins: 20,
      draws: 8,
      losses: 10,
      goalsFor: 50 - i,
      goalsAgainst: 20 + i,
      goalDiff: 30 - 2 * i,
      qualification: qualificationForPosition(position, league, sisters) || "",
    };
  });
}

resetClubFinanceLedgers();
reseedCareerRng(recipe.seed);
setWorldState(createWorldState({ seed: recipe.seed, startYear: 2026 }));
const rngAfterCreate = Number(getSimRng().seed());
if (rngAfterCreate !== Number(recipe.seed) && Number(getWorldState().rngSeed) !== Number(recipe.seed)) {
  // createWorldState({seed}) must install that seed as career rngSeed.
  throw new Error("createWorldState ignored seed: got " + getWorldState().rngSeed);
}

const table = orderedTable(recipe.placements);
const sourceYear = recipe.sourceYear ?? 2025;
// F05 archives a stale 2024 commit only; the final worker adds the correct 2025 mapping.
const commitYear = recipe.id === "F05" ? 2024 : sourceYear;
commitCompletedDomesticEdition({
  world: getWorldState(),
  league,
  table,
  sourceYear: commitYear,
  provenance: recipe.provenance || "legacy-migrated",
});

const homeClub =
  recipe.playerClubId === recipe.brentfordId
    ? brentford
    : recipe.playerClubId === recipe.arsenalId
      ? arsenal
      : league.clubs.find((c) => c.clubId === recipe.playerClubId) || brentford;

const rng = createRng(91);
const rating = recipe.rating ?? recipe.hotOvr ?? 90;
const player = {
  name: "Paired09",
  careerId: "paired09",
  position: "CM",
  nationality: "England",
  age: 24,
  startYear: 2026,
  rating,
  attributes: generateStartingAttributes("CM", rating, 99, rng),
  club: { ...homeClub, league: league.name, leagueId: league.leagueId, nation: league.nation },
  playingClubId: homeClub.clubId,
  employmentClubId: homeClub.clubId,
  seasons: [],
};
ensurePlayerModel(player);
initializePlayerDevelopment(player, { rng });
refreshAbilityCaches(player);
ensureContractAuthority(player);
ensureTransferSave(player);
ensurePlayingStints(player, { asOfDate: "2026-07-01" });

// Shared stale Arsenal first-place row for F01 (both workers must see the same evidence).
const arsenalRow = table.find((r) => r.clubId === arsenal.clubId);
const brentfordRow = table.find((r) => r.clubId === brentford.clubId);
if (recipe.id === "F01") {
  player.latestStanding = {
    leagueId: league.leagueId,
    seasonId: league.leagueId + "::" + sourceYear,
    table,
    playerRow: arsenalRow,
  };
  recordPlayingTransition(player, {
    kind: "permanent",
    effectiveDate: "2026-07-01",
    playingClubId: brentford.clubId,
    employmentClubId: brentford.clubId,
    leagueId: league.leagueId,
    clubName: brentford.name,
  });
} else if (recipe.id === "F02" || recipe.id === "F15") {
  player.latestStanding = {
    leagueId: league.leagueId,
    seasonId: league.leagueId + "::" + sourceYear,
    table,
    playerRow: arsenalRow,
  };
} else if (recipe.id === "F03") {
  player.latestStanding = {
    leagueId: league.leagueId,
    seasonId: league.leagueId + "::" + sourceYear,
    table,
    playerRow: brentfordRow,
  };
} else if (recipe.id === "F05") {
  player.latestStanding = {
    leagueId: league.leagueId,
    seasonId: league.leagueId + "::2024",
    table,
    playerRow: table[0],
  };
}

const world = getWorldState();
world.rngState = getSimRng().seed();
const shared = {
  id: recipe.id,
  seed: recipe.seed,
  leagueId: recipe.leagueId,
  arsenalId: recipe.arsenalId,
  brentfordId: recipe.brentfordId,
  placements: recipe.placements,
  sourceYear,
  rating,
  hotOvr: recipe.hotOvr ?? null,
  playerClubId: homeClub.clubId,
  table,
  arsenalRow,
  brentfordRow,
  player: structuredClone(player),
  world: serializeWorldState(world),
  clubFinance: exportClubFinanceState(),
  expectedRngAfterRestore: Number(getSimRng().seed()),
  worldRngSeed: Number(world.rngSeed),
  worldRngState: Number(world.rngState),
};
writeFileSync(outPath, JSON.stringify(shared));
console.log(JSON.stringify({ id: recipe.id, expectedRngAfterRestore: shared.expectedRngAfterRestore }));
