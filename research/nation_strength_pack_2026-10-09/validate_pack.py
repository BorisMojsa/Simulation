from pathlib import Path
import json, hashlib, math
from collections import Counter
ROOT=Path(__file__).resolve().parent
def read(rel):
    return json.loads((ROOT/rel).read_text())
def require(condition, message):
    if not condition:
        raise RuntimeError(message)
checksums=read('SHA256SUMS.json')
for relative,expected in checksums['files'].items():
    actual=hashlib.sha256((ROOT/relative).read_bytes()).hexdigest()
    require(actual==expected,f'Checksum mismatch: {relative}')
observations=read('nation_observations_79.json')['nations']
input_nations=read('input_reports/nation-strength-coverage-report.json')['nations']
replacements=read('nation_replacements_59.json')['nations']
mappings=read('nation_identity_mappings.json')
require(len(observations)==79,'Expected 79 observations')
require(len(replacements)==59,'Expected 59 replacements')
require(len({r['nationId'] for r in observations})==79,'Duplicate selected IDs')
require({r['nationId'] for r in observations}=={r['nationId'] for r in input_nations},'Inventory ID mismatch')
by_id={r['nationId']:r for r in observations}
map_by_id={r['nationId']:r for r in mappings['mappings']}
require(len(map_by_id)==79,'Mapping count mismatch')
require({r['nationId'] for r in replacements}=={r['nationId'] for r in input_nations if r['fifaPoints'] is None},'Replacement ID mismatch')
require(len({r['fifaPoints'] for r in observations})==79,'Unexpected point clump')
counts=Counter(r['confederation'] for r in observations)
require(dict(counts)=={'AFC':12,'CAF':15,'CONCACAF':10,'CONMEBOL':10,'OFC':1,'UEFA':31},'Confederation count mismatch')
require(all(math.isfinite(r['fifaPoints']) and r['fifaPoints']>0 for r in observations),'Invalid points')
require(all(r['sourceEvidenceTier']=='corroborated_secondary' and not r['directPrimaryPointsVerified'] for r in observations),'Unsupported evidence tier')
require(all(r['publicationDate'] is None for r in observations),'Unsupported publication timestamps')
require(all(r['ratingAsOfDate']=='2026-10-07' for r in observations),'Edition mismatch')
raw={}
for sid in ['betimate','futbor','b_empire']:
    table=read(f'raw/{sid}_fifa_2026-10-07_inventory79.json')
    require(len(table['rows'])==79,f'{sid} row count mismatch')
    raw[sid]={r['fifaRank']:r for r in table['rows']}
disagreements=[]
for selected in observations:
    ident=map_by_id[selected['nationId']]
    rank=selected['fifaRank']
    require(ident['confederation']==selected['confederation'],'Identity confederation mismatch')
    for sid in raw:
        observed=raw[sid][rank]
        require(observed['providerTeamName'] in ident['providerAliases'],f'Ambiguous identity: {selected["name"]}/{sid}')
        require(observed['fifaPointsDecimal']==f'{observed["fifaPoints"]:.2f}','Decimal precision mismatch')
        if sid!='b_empire':
            require(observed['fifaPoints']==selected['fifaPoints'],f'Corroboration failure: {selected["name"]}')
            require(observed['publishedConfederation']==selected['confederation'],'Published confederation mismatch')
        elif observed['fifaPoints']!=selected['fifaPoints']:
            disagreements.append(selected['nationId'])
require(disagreements==['nation:australia'],'Unexpected publisher discrepancies')
extra=read('raw/australia_supplement_2026-10-07.json')['rows'][0]
require(extra['fifaPoints']==by_id['nation:australia']['fifaPoints']==1580.52,'Australia supplement mismatch')
matched_numeric=matched_rank=0
for old in input_nations:
    selected=by_id[old['nationId']]
    if old['fifaPoints'] is not None:
        require(old['fifaPoints']==selected['fifaPoints'] and old['fifaRank']==selected['fifaRank'],'Existing numeric evidence changed')
        matched_numeric+=1
    if old.get('knownRankWithoutPoints') is not None:
        require(old['knownRankWithoutPoints']==selected['fifaRank'],'Existing known rank changed')
        matched_rank+=1
require((matched_numeric,matched_rank)==(20,30),'Existing evidence count mismatch')
old_gaps=[r for r in input_nations if r['fifaPoints'] is None]
require({r['gameplayPointsPrior'] for r in old_gaps}=={1180},'Unexpected prior audit input')
pairs=read('paired_club_observations_75.json')['pairs']
require(len(pairs)==75,'Pair count mismatch')
audit=read('club_calibration_audit.json')
require(len(audit['targets'])==5,'Target count mismatch')
for target in audit['targets']:
    points=[p['footballDatabase']['rating'] for p in pairs if p['country']==target['country']]
    require([min(points),max(points)]==target['pairedFootballDatabaseRange'],'Incorrect target sample range')
    require(len(points)==target['pairedCountrySampleSize'],'Incorrect target sample size')
require([t['clubName'] for t in audit['targets'] if not t['targetWithinPairedInputRange']]==['AVS'],'Extrapolation audit mismatch')
prompt=(ROOT/'Cursor_Prompt.txt').read_text()
require(all(r['nationId']+' |' in prompt for r in observations),'Incomplete prompt appendix')
print(json.dumps({'integrity':'passed','checksummedFiles':len(checksums['files']),'nationIds':79,'formerGaps':59,'existingNumericValuesMatched':20,'existingRanksMatched':30,'twoTablePointAgreement':79,'secondaryDiscrepancyRetained':'Australia','confederationCorrections':3,'clubTargetsAudited':5,'clubExtrapolationFlag':'AVS','directPrimaryPointVerification':0},indent=2))
