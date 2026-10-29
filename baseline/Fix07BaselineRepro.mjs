import { pathToFileURL } from 'node:url';
const root = process.cwd();
const mod = async p => import(pathToFileURL(root + '/' + p));
const { clubMinutesShare } = await mod('js/simulation/squadDecisions.js');
const { createPlayerIdentity } = await mod('js/simulation/playerDevelopment.js');
const { ensurePlayerModel } = await mod('js/simulation/playerModelMigration.js');
const { refreshAbilityCaches } = await mod('js/simulation/playerAbility.js');
const { allSeniorClubs } = await mod('js/simulation/seniorClubs.js');
const { generatePipelineOffers, buildValidatedOffer, acceptPipelineOffer } = await mod('js/simulation/dealPipeline.js');
const { generateTransferOffers } = await mod('js/simulation/transferMarket.js');
const { createRng, reseedCareerRng } = await mod('js/simulation/rng.js');
const { resetClubFinanceLedgers } = await mod('js/simulation/clubFinance.js');
const { createWorldState, setWorldState } = await mod('js/simulation/worldState.js');
const { advanceFreeAgentPeriod, ensureContractAuthority, evaluateRenewalReview, applyRenewalTerms } = await mod('js/simulation/contractLifecycle.js');
function fixture(ovr=72, age=23, id='bug07-probe') {
  reseedCareerRng(707); resetClubFinanceLedgers(); setWorldState(createWorldState({ startYear:2026 }));
  const p = createPlayerIdentity({name:'Bug07 Research',nationality:'Serbia',position:'ST',age});
  Object.assign(p,{careerId:id,startYear:2026,age,club:null,seasons:[],contractStatus:'released',contractEndSeason:0,employmentClubId:null,playingClubId:null,weeklyWage:0,wage:0,rating:ovr,attributes:Object.fromEntries(['Speed','Passing','Shooting','Defending','Physicality','Dribbling'].map(k=>[k,ovr])),potentialForecast:{upper:ovr+8}});
  ensurePlayerModel(p);refreshAbilityCaches(p);ensureContractAuthority(p); return p;
}
const shares = {
  tenFullGamesIn38: clubMinutesShare({seasons:[{matches:10,minutes:900,standing:{matches:38}}]}),
  low600In38:clubMinutesShare({seasons:[{matches:10,minutes:600,standing:{matches:38}}]}),
  explicitZero:clubMinutesShare({seasons:[{matches:10,minutes:900,participationLedger:{eligibleClubMatches:38,availableClubMinutes:3420,clubMinutesPlayed:0}}]}),
  previousClubLedger:clubMinutesShare({seasons:[{matches:10,minutes:600,standing:{matches:38}}],seasonLedger:{seasonId:'old',eligibleClubMatches:5,availableClubMinutes:450,clubMinutesPlayed:450}})
};
console.log('SHARES',JSON.stringify(shares));
const markets=[];
for(const ovr of [58,62,66,72]) {
 const p=fixture(ovr,23,`bug07-market-${ovr}`);const periods=[];
 for(let i=0;i<4;i++){
  const g=generatePipelineOffers(p,{performanceScore:55});
  const forced=generatePipelineOffers(p,{performanceScore:55,forceGenerate:true});
  periods.push({age:p.age,period:p.seasons.length,eligible:g.eligibleCount,offers:g.offers.length,rejections:g.rejectionLog,forcedEligible:forced.eligibleCount,forcedOffers:forced.offers.length,forcedReject:forced.rejectionLog});
  advanceFreeAgentPeriod(p,{seasons:1});
 }
 markets.push({ovr:p.rating,periods});
}
console.log('MARKETS',JSON.stringify(markets));
const failures=[];
for(let i=0;i<80;i++) {
 const p=fixture(66,23,`bug07-search-${i}`);
 const g=generatePipelineOffers(p,{performanceScore:55});
 if(!g.offers.length){const f=generatePipelineOffers(p,{performanceScore:55,forceGenerate:true});failures.push({id:p.careerId,eligible:g.eligibleCount,rejections:g.rejectionLog,forcedEligible:f.eligibleCount,forcedOffers:f.offers.length,forcedReject:f.rejectionLog}); if(failures.length>=5)break;}
}
console.log('EMPTY_SEARCH',JSON.stringify(failures));
const rp=fixture(72,23,'bug07-renewal'); const club=allSeniorClubs().find(c=>c.name==='Atalanta');
Object.assign(rp,{club:{...club},employmentClubId:club.clubId,playingClubId:club.clubId,contractStatus:'active',contractEndSeason:1,contractYears:1,contractStartSeason:0,contractRevision:null,renewalReview:null,weeklyWage:7200,wage:7200});
ensureContractAuthority(rp);
const poor=evaluateRenewalReview(rp,{performanceScore:55,financeOk:true});
const later=evaluateRenewalReview(rp,{performanceScore:85,financeOk:true});
const forced=evaluateRenewalReview(rp,{performanceScore:85,financeOk:true,forceReevaluate:true});
console.log('REVIEW_LATCH',JSON.stringify({poor,later,forced}));
const renewPlayer=fixture(72,36,'bug07-short-renewal');const hull=allSeniorClubs().find(c=>c.name==='Hull City');
Object.assign(renewPlayer,{club:{...hull},employmentClubId:hull.clubId,playingClubId:hull.clubId,contractStatus:'active',contractEndSeason:1,contractYears:1,contractStartSeason:0,contractRevision:null,renewalReview:null,weeklyWage:1500,wage:1500});
ensureContractAuthority(renewPlayer);
const generatedRenewal=generatePipelineOffers(renewPlayer,{performanceScore:85,forceGenerate:true,rng:createRng(707)}).offers.find(o=>o.isRenewal);
if(generatedRenewal){const before=renewPlayer.contractEndSeason;const accepted=acceptPipelineOffer(renewPlayer,generatedRenewal);console.log('ONE_YEAR_RENEWAL',JSON.stringify({age:renewPlayer.age,before,offeredYears:generatedRenewal.contractYears,after:renewPlayer.contractEndSeason,accepted:accepted.ok,acceptReason:accepted.reason,offerId:generatedRenewal.offerId,review:renewPlayer.renewalReview}));}else console.log('ONE_YEAR_RENEWAL_NO_OFFER',JSON.stringify(renewPlayer.renewalReview));
const { simulateSeason } = await mod('js/simulation/seasonSimulator.js');
const { LEAGUES, LEAGUE_LOOKUP } = await mod('js/data/leagues.js');
for (const [ovr, clubName] of [[58,'Hull City'],[72,'Atalanta']]) {
 const p=fixture(ovr,21,`bug07-full-${ovr}`);const c=allSeniorClubs().find(c=>c.name===clubName);
 if(!c){console.log('MISSING_CLUB',clubName);continue;}
 Object.assign(p,{club:{...c},employmentClubId:c.clubId,playingClubId:c.clubId,contractStatus:'active',contractEndSeason:2,contractYears:2,contractStartSeason:0,contractRevision:null,renewalReview:null,weeklyWage:1500,wage:1500});
 ensureContractAuthority(p);reseedCareerRng(707);
 const data=simulateSeason(p,LEAGUES,LEAGUE_LOOKUP,{autoDecisionPolicy:'stay'});
 const s=data.season;
 const clubRows=s.ledgerRecords.filter(r=>!r.isInternational&&r.teamType!=='national');
 const avail=clubRows.filter(r=>r.available===true);
 console.log('FULL_SEASON',JSON.stringify({ovr,clubName,share:clubMinutesShare(p),savedMatches:s.matches,savedMinutes:s.minutes,standingMatches:s.standing?.matches,ledgerClubRows:clubRows.length,eligibleClubRows:avail.length,eligibleMinutesFromRows:avail.reduce((a,b)=>a+(b.availableMinutes??b.matchDuration??90),0),durationValues:[...new Set(avail.map(b=>b.availableMinutes??b.matchDuration))],clubOnlyMinutes:clubRows.reduce((a,b)=>a+b.minutes,0),independent90Share:clubRows.reduce((a,b)=>a+b.minutes,0)/(avail.length*90),internationalRows:s.ledgerRecords.length-clubRows.length,hasParticipationLedger:!!s.participationLedger,healthMissed:s.seasonEvidence?.health?.injuredDays,performance:data.performanceScore,contractActive:p.contractStatus}));
}
