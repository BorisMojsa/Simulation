const fs = require('fs');
const path = require('path');

const BADGES_DIR = path.join(__dirname, 'badges');
const OUTPUT_FILE = path.join(__dirname, 'league-data.js');

const LEAGUE_CONFIG = {
  'England - Premier League': { tier: 5, financialPower: 5 },
  'Spain - LaLiga': { tier: 5, financialPower: 5 },
  'Germany - Bundesliga': { tier: 5, financialPower: 5 },
  'Italy - Serie A': { tier: 5, financialPower: 5 },
  'France - Ligue 1': { tier: 4, financialPower: 4 },
  'Portugal - Liga Portugal': { tier: 4, financialPower: 3 },
  'Netherlands - Eredivisie': { tier: 3, financialPower: 3 },
  'Belgium - Jupiler Pro League': { tier: 3, financialPower: 3 },
  'Austria - Bundesliga': { tier: 3, financialPower: 3 },
  'Denmark - Superliga': { tier: 3, financialPower: 2 },
  'Russia - Premier Liga': { tier: 4, financialPower: 3 },
  'Türkiye - Süper Lig': { tier: 3, financialPower: 3 },
  'Scotland - Scottish Premiership': { tier: 3, financialPower: 2 },
  'Switzerland - Super League': { tier: 3, financialPower: 2 },
  'Norway - Eliteserien': { tier: 2, financialPower: 2 },
  'Sweden - Allsvenskan': { tier: 2, financialPower: 2 },
  'Poland - PKO BP Ekstraklasa': { tier: 3, financialPower: 2 },
  'Czech Republic - Chance Liga': { tier: 2, financialPower: 2 },
  'Croatia - SuperSport HNL': { tier: 2, financialPower: 2 },
  'Romania - SuperLiga': { tier: 2, financialPower: 2 },
  'Serbia - Super liga Srbije': { tier: 2, financialPower: 2 },
  'Israel - Ligat ha\'Al': { tier: 2, financialPower: 2 },
  'Ukraine - Premier Liga': { tier: 3, financialPower: 2 },
  'Greece - Super League 1': { tier: 3, financialPower: 3 },
  'Bulgaria - efbet Liga': { tier: 2, financialPower: 1 },
};

const NATION_REPLACEMENTS = {
  'Türkiye': 'Turkey',
};

const CLUB_NAME_OVERRIDES = {
  // England
  'AFC Bournemouth': 'Bournemouth',
  'Arsenal FC': 'Arsenal',
  'Brentford FC': 'Brentford',
  'Brighton & Hove Albion': 'Brighton',
  'Burnley FC': 'Burnley',
  'Chelsea FC': 'Chelsea',
  'Crystal Palace FC': 'Crystal Palace',
  'Everton FC': 'Everton',
  'Fulham FC': 'Fulham',
  'Leeds United': 'Leeds United',
  'Liverpool FC': 'Liverpool',
  'Manchester City': 'Manchester City',
  'Manchester United': 'Manchester United',
  'Newcastle United': 'Newcastle United',
  'Nottingham Forest': 'Nottingham Forest',
  'Sunderland AFC': 'Sunderland',
  'Tottenham Hotspur': 'Tottenham Hotspur',
  'West Ham United': 'West Ham United',
  'Wolverhampton Wanderers': 'Wolves',

  // Spain
  'Athletic Bilbao': 'Athletic Club',
  'Atlético de Madrid': 'Atletico Madrid',
  'CA Osasuna': 'Osasuna',
  'Celta de Vigo': 'Celta Vigo',
  'Deportivo Alavés': 'Alaves',
  'FC Barcelona': 'Barcelona',
  'Elche CF': 'Elche',
  'Getafe CF': 'Getafe',
  'Girona FC': 'Girona',
  'Levante UD': 'Levante',
  'RCD Espanyol Barcelona': 'Espanyol',
  'RCD Mallorca': 'Mallorca',
  'Real Betis Balompié': 'Real Betis',
  'Sevilla FC': 'Sevilla',
  'Valencia CF': 'Valencia',
  'Villarreal CF': 'Villarreal',

  // Germany
  '1.FC Heidenheim 1846': 'Heidenheim',
  '1.FC Köln': 'FC Koln',
  '1.FC Union Berlin': 'Union Berlin',
  '1.FSV Mainz 05': 'Mainz 05',
  'Bayer 04 Leverkusen': 'Bayer Leverkusen',
  'Borussia Mönchengladbach': 'Borussia Monchengladbach',
  'FC Augsburg': 'Augsburg',
  'FC St. Pauli': 'St Pauli',
  'Hamburger SV': 'Hamburg',
  'SC Freiburg': 'Freiburg',
  'SV Werder Bremen': 'Werder Bremen',
  'TSG 1899 Hoffenheim': 'Hoffenheim',
  'VfB Stuttgart': 'Stuttgart',
  'VfL Wolfsburg': 'Wolfsburg',

  // Italy
  'ACF Fiorentina': 'Fiorentina',
  'AS Roma': 'Roma',
  'Atalanta BC': 'Atalanta',
  'Bologna FC 1909': 'Bologna',
  'Cagliari Calcio': 'Cagliari',
  'Como 1907': 'Como',
  'Genoa CFC': 'Genoa',
  'Juventus FC': 'Juventus',
  'Parma Calcio 1913': 'Parma',
  'Pisa Sporting Club': 'Pisa',
  'SS Lazio': 'Lazio',
  'SSC Napoli': 'Napoli',
  'Torino FC': 'Torino',
  'Udinese Calcio': 'Udinese',
  'US Cremonese': 'Cremonese',
  'US Lecce': 'Lecce',
  'US Sassuolo': 'Sassuolo',

  // France
  'AJ Auxerre': 'Auxerre',
  'Angers SCO': 'Angers',
  'AS Monaco': 'Monaco',
  'FC Lorient': 'Lorient',
  'FC Metz': 'Metz',
  'FC Nantes': 'Nantes',
  'FC Toulouse': 'Toulouse',
  'Le Havre AC': 'Le Havre',
  'LOSC Lille': 'Lille',
  'OGC Nice': 'Nice',
  'Olympique Lyon': 'Lyon',
  'Olympique Marseille': 'Marseille',
  'Paris FC': 'Paris FC',
  'Paris Saint-Germain': 'Paris Saint-Germain',
  'RC Lens': 'Lens',
  'RC Strasbourg Alsace': 'Strasbourg',
  'Stade Brestois 29': 'Brest',
  'Stade Rennais FC': 'Rennes',

  // Portugal
  'Casa Pia AC': 'Casa Pia',
  'CD Nacional': 'Nacional',
  'CD Santa Clara': 'Santa Clara',
  'CF Estrela Amadora SAD': 'Estrela Amadora',
  'FC Famalicão': 'Famalicao',
  'FC Alverca': 'Alverca',
  'FC Arouca': 'Arouca',
  'FC Porto': 'Porto',
  'FC Vizela': 'Vizela',
  'GD Estoril Praia': 'Estoril',
  'Gil Vicente FC': 'Gil Vicente',
  'Moreirense FC': 'Moreirense',
  'Portimonense SC': 'Portimonense',
  'Rio Ave FC': 'Rio Ave',
  'SC Braga': 'Braga',
  'SC Farense': 'Farense',
  'SL Benfica': 'Benfica',
  'Sporting CP': 'Sporting CP',
  'Vitória Guimarães SC': 'Vitoria Guimaraes',

  // Netherlands
  'Ajax Amsterdam': 'Ajax',
  'AZ Alkmaar': 'AZ Alkmaar',
  'Excelsior Rotterdam': 'Excelsior',
  'Feyenoord Rotterdam': 'Feyenoord',
  'Fortuna Sittard': 'Fortuna Sittard',
  'Go Ahead Eagles': 'Go Ahead Eagles',
  'NEC Nijmegen': 'NEC Nijmegen',
  'PSV Eindhoven': 'PSV Eindhoven',
  'RKC Waalwijk': 'RKC Waalwijk',
  'SC Heerenveen': 'Heerenveen',
  'Sparta Rotterdam': 'Sparta Rotterdam',
  'Twente Enschede FC': 'FC Twente',
  'FC Utrecht': 'Utrecht',
  'Vitesse Arnhem': 'Vitesse',

  // Belgium
  'Club Brugge KV': 'Club Brugge',
  'Cercle Brugge': 'Cercle Brugge',
  'KAA Gent': 'Gent',
  'KRC Genk': 'Genk',
  'Royal Antwerp FC': 'Royal Antwerp',
  'RSC Anderlecht': 'Anderlecht',
  'Union Saint-Gilloise': 'Union Saint-Gilloise',

  // Scotland
  'Celtic FC': 'Celtic',
  'Rangers FC': 'Rangers',
};

const TRAILING_TOKENS = [
  'FC',
  'CF',
  'SC',
  'AFC',
  'SAD',
  'S.A.D.',
  'FK',
  'BK',
  'SK',
  'IK',
  'IF',
  'FF',
  'FK',
  'HK',
  'KF',
  'Fotbal Club',
  'Football Club',
  'Futebol Clube',
];

function sanitizeClubName(rawName) {
  const override = CLUB_NAME_OVERRIDES[rawName];
  if (override) {
    return override;
  }

  let name = rawName.normalize('NFD').replace(/[\u0300-\u036f]/gu, '');
  name = name.replace(/ß/gu, 'ss');

  name = name.replace(/^(?:[A-Z]{1,3}\\.)\\s+/u, '').trim();
  name = name.replace(/^(?:FC|SC|FK|IF)\\s+/iu, '').trim();

  for (const token of TRAILING_TOKENS) {
    const pattern = new RegExp(`\\s+${token.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}$`, 'iu');
    name = name.replace(pattern, '').trim();
  }

  name = name.replace(/\\s+/g, ' ').trim();

  if (!name) {
    return rawName;
  }

  return name;
}

function collectLeagues() {
  if (!fs.existsSync(BADGES_DIR)) {
    throw new Error(`Badges directory not found: ${BADGES_DIR}`);
  }

  const leagues = [];
  const entries = fs.readdirSync(BADGES_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullName = entry.name.trim();
    const [rawNation, leagueName] = fullName.split(' - ');
    const displayName = leagueName ? leagueName.trim() : fullName;
    const nationSource = leagueName ? rawNation : fullName;
    const nation = (NATION_REPLACEMENTS[nationSource] || nationSource).trim();
    const internalName = fullName;
    const leaguePath = path.join(BADGES_DIR, entry.name);
    const files = fs.readdirSync(leaguePath).filter((file) => file.toLowerCase().endsWith('.png'));
    const clubs = files
      .map((file) => {
        const original = file.slice(0, -4);
        const cleanName = sanitizeClubName(original);
        return {
          name: cleanName,
          displayName: cleanName === original ? undefined : original,
          badge: `badges/${entry.name}/${file}`,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

    const config = LEAGUE_CONFIG[fullName] || { tier: 2, financialPower: 2 };

    leagues.push({
      name: internalName,
      displayName,
      nation,
      tier: config.tier,
      financialPower: config.financialPower,
      badgeFolder: `badges/${entry.name}`,
      clubs,
    });
  }

  const order = Object.keys(LEAGUE_CONFIG);
  leagues.sort((a, b) => {
    const aIndex = order.indexOf(a.name);
    const bIndex = order.indexOf(b.name);
    if (aIndex !== -1 && bIndex !== -1) {
      return aIndex - bIndex;
    }
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;
    if (a.tier !== b.tier) {
      return b.tier - a.tier;
    }
    return a.name.localeCompare(b.name);
  });

  return leagues;
}

function generateModule(leagues) {
  const serialized = JSON.stringify(leagues, null, 2);
  return `// Auto-generated by generate_league_data.js\n// Do not edit this file manually.\n\nexport const LEAGUE_DEFINITIONS = ${serialized};\n\nexport default LEAGUE_DEFINITIONS;\n`;
}

function main() {
  const leagues = collectLeagues();
  const moduleSource = generateModule(leagues);
  fs.writeFileSync(OUTPUT_FILE, moduleSource, 'utf8');
  console.log(`Generated ${OUTPUT_FILE} with ${leagues.length} leagues.`);
}

if (require.main === module) {
  main();
}
