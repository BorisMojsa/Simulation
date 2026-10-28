import { ACADEMY_POOL, LEAGUES, LEAGUE_LOOKUP } from './js/data/leagues.js';
import {
  createPlayerIdentity, finalizeAcademyPlayer, applySkipOpeningDevelopment,
  promoteAcademyGraduateToFirstTeam,
} from './js/simulation/playerDevelopment.js';
import { buildNarrativeAcademySeason } from './js/simulation/narrativeAcademySeason.js';
import { buildFirstProContractDecision } from './js/simulation/proContractOffers.js';
import { simulateSeason } from './js/simulation/seasonSimulator.js';
import { createWorldState, setWorldState, getWorldState } from './js/simulation/worldState.js';
import { resetClubFinanceLedgers } from './js/simulation/clubFinance.js';
import {
  ensureContractAuthority, selectNextCareerAction, assertPlayableRegistration,
  isContractActive,
} from './js/simulation/contractLifecycle.js';
import { reseedCareerRng } from './js/simulation/rng.js';

const academy = ACADEMY_POOL.find(
  a => a.parentClub?.clubId === 'club:england:aston-villa'
);
if (!academy) throw new Error('Aston Villa academy fixture missing');

function make() {
  resetClubFinanceLedgers();
  setWorldState(createWorldState({ startYear: 2026 }));
  const p = createPlayerIdentity({
    name: 'Bug04 Academy Baseline', nationality: 'England', position: 'RW', age: 17,
  });
  finalizeAcademyPlayer(p, academy);
  applySkipOpeningDevelopment(p);
  const year = buildNarrativeAcademySeason(p, p.rating, p.rating);
  p.seasons.push(year);
  for (const k of ['matches', 'goals', 'assists', 'cleanSheets']) {
    p.careerTotals[k] += year[k];
  }
  p.careerIntroComplete = true;
  p.suppressParentContractOffer = true;
  p.pendingOffers = [];
  reseedCareerRng(42);
  return p;
}

const p = make();
const firstPro = buildFirstProContractDecision(p);
ensureContractAuthority(p);
const before = {
  age: p.age, seasons: p.seasons.length, club: p.club.name,
  clubId: p.club.clubId ?? null, playingClubId: p.playingClubId ?? null,
  nextAction: selectNextCareerAction(p).id, offerCount: firstPro.offers.length,
};
const data = simulateSeason(p, LEAGUES, LEAGUE_LOOKUP, {
  pauseForDecisions: false, autoDecisionPolicy: 'stay',
});
const membership = getWorldState().leagueMemberships.get(academy.leagueId);
const academyFixtures = (data.leagueAllMatches || []).filter(
  m => m.home?.name === academy.name || m.away?.name === academy.name
);
const continued = {
  age: p.age, seasons: p.seasons.length, club: p.club?.name,
  isAcademy: p.club?.isAcademy, tableRows: data.standings?.table?.length,
  allLeagueFixtures: data.leagueAllMatches?.length,
  academyFixtures: academyFixtures.length,
  attachedPlayerFixtures: data.leaguePlayerMatches?.length,
  clubAppearances: data.season?.ledgerSummary?.club?.appearances,
  clubMinutes: data.season?.ledgerSummary?.club?.minutes,
  seniorWorldMembership: membership?.length,
  nextAction: selectNextCareerAction(p).id,
};
const adult = make();
adult.age = 35;
const adultAcademy = {
  age: adult.age, active: isContractActive(adult),
  playable: assertPlayableRegistration(adult),
  nextAction: selectNextCareerAction(adult).id,
};
const missingParent = make();
delete missingParent.club.parentClub;
const promotion = promoteAcademyGraduateToFirstTeam(missingParent);
const orphan = {
  returned: promotion, club: missingParent.club?.name,
  isAcademy: missingParent.club?.isAcademy,
  clubId: missingParent.club?.clubId ?? null,
  contractEndSeason: missingParent.contractEndSeason,
  playable: assertPlayableRegistration(missingParent),
  nextAction: selectNextCareerAction(missingParent).id,
};
console.log(JSON.stringify({
  baseline: 'f937a7092ecf658d4655d2112b4bed45809a1d1f',
  scope: 'Controlled engine probes; not a naturally empty menu or browser test.',
  before, continued, adultAcademy, orphan,
}, null, 2));
