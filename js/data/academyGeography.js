/**
 * Geographic regions for academy offer weighting.
 * Nearby nations are far more likely; distant ones stay rare but possible.
 */

export const NATION_REGION = {
  // Balkans / SE Europe
  Serbia: "balkans",
  Croatia: "balkans",
  "Bosnia and Herzegovina": "balkans",
  Montenegro: "balkans",
  "North Macedonia": "balkans",
  Albania: "balkans",
  Slovenia: "balkans",
  Kosovo: "balkans",
  Bulgaria: "balkans",
  Romania: "balkans",
  Greece: "balkans",
  Turkey: "balkans",
  Türkiye: "balkans",

  // Central Europe
  "Czech Republic": "central_europe",
  Czechia: "central_europe",
  Poland: "central_europe",
  Germany: "central_europe",
  Austria: "central_europe",
  Hungary: "central_europe",
  Slovakia: "central_europe",
  Switzerland: "central_europe",

  // Western / NW Europe
  England: "west_europe",
  Scotland: "west_europe",
  Wales: "west_europe",
  "Northern Ireland": "west_europe",
  "Republic of Ireland": "west_europe",
  France: "west_europe",
  Belgium: "west_europe",
  Netherlands: "west_europe",
  Holland: "west_europe",
  Luxembourg: "west_europe",

  // South-west Europe
  Spain: "south_europe",
  Portugal: "south_europe",
  Italy: "south_europe",
  Andorra: "south_europe",
  Malta: "south_europe",

  // Nordics
  Denmark: "nordic",
  Norway: "nordic",
  Sweden: "nordic",
  Finland: "nordic",
  Iceland: "nordic",

  // South America
  Brazil: "south_america",
  Argentina: "south_america",
  Colombia: "south_america",
  Ecuador: "south_america",
  Uruguay: "south_america",
  Chile: "south_america",
  Peru: "south_america",
  Paraguay: "south_america",
  Bolivia: "south_america",
  Venezuela: "south_america",

  // North / Central America
  "United States": "north_america",
  USA: "north_america",
  "United States of America": "north_america",
  Mexico: "north_america",
  Canada: "north_america",
  "Costa Rica": "north_america",
  Panama: "north_america",
  Honduras: "north_america",
  Jamaica: "north_america",
  Haiti: "north_america",
  "Curaçao": "north_america",

  // Africa (no clubs in dataset yet — still used for origin weighting)
  Nigeria: "africa",
  Ghana: "africa",
  Senegal: "africa",
  Morocco: "africa",
  Egypt: "africa",
  Cameroon: "africa",
  "Ivory Coast": "africa",
  Algeria: "africa",
  Tunisia: "africa",
  "South Africa": "africa",
  "DR Congo": "africa",
  Angola: "africa",
  "Cape Verde": "africa",

  // Asia / Oceania
  Japan: "asia",
  "South Korea": "asia",
  "Korea Republic": "asia",
  "North Korea": "asia",
  China: "asia",
  Australia: "oceania",
  "New Zealand": "oceania",
  "Saudi Arabia": "asia",
  Qatar: "asia",
  Iran: "asia",
  Iraq: "asia",
  Jordan: "asia",
};

/** Relative distance costs between regions (0 = same). */
const REGION_DISTANCE = {
  balkans: {
    balkans: 0,
    central_europe: 1,
    south_europe: 1,
    west_europe: 2,
    nordic: 2,
    africa: 2,
    asia: 3,
    south_america: 4,
    north_america: 4,
    oceania: 4,
  },
  central_europe: {
    central_europe: 0,
    balkans: 1,
    west_europe: 1,
    south_europe: 1,
    nordic: 1,
    africa: 2,
    asia: 3,
    south_america: 4,
    north_america: 4,
    oceania: 4,
  },
  west_europe: {
    west_europe: 0,
    central_europe: 1,
    south_europe: 1,
    nordic: 1,
    balkans: 2,
    africa: 2,
    north_america: 3,
    south_america: 3,
    asia: 3,
    oceania: 4,
  },
  south_europe: {
    south_europe: 0,
    balkans: 1,
    west_europe: 1,
    central_europe: 1,
    africa: 1,
    nordic: 2,
    south_america: 3,
    north_america: 3,
    asia: 3,
    oceania: 4,
  },
  nordic: {
    nordic: 0,
    west_europe: 1,
    central_europe: 1,
    balkans: 2,
    south_europe: 2,
    north_america: 3,
    africa: 3,
    asia: 3,
    south_america: 4,
    oceania: 4,
  },
  south_america: {
    south_america: 0,
    north_america: 2,
    west_europe: 3,
    south_europe: 3,
    central_europe: 3,
    balkans: 4,
    nordic: 4,
    africa: 3,
    asia: 4,
    oceania: 4,
  },
  north_america: {
    north_america: 0,
    south_america: 2,
    west_europe: 3,
    south_europe: 3,
    central_europe: 3,
    nordic: 3,
    balkans: 4,
    africa: 3,
    asia: 3,
    oceania: 4,
  },
  africa: {
    africa: 0,
    south_europe: 1,
    balkans: 2,
    west_europe: 2,
    central_europe: 2,
    south_america: 3,
    north_america: 3,
    nordic: 3,
    asia: 2,
    oceania: 4,
  },
  asia: {
    asia: 0,
    oceania: 2,
    balkans: 3,
    central_europe: 3,
    west_europe: 3,
    south_europe: 3,
    africa: 2,
    nordic: 3,
    north_america: 3,
    south_america: 4,
  },
  oceania: {
    oceania: 0,
    asia: 2,
    north_america: 3,
    west_europe: 4,
    south_europe: 4,
    central_europe: 4,
    balkans: 4,
    nordic: 4,
    africa: 4,
    south_america: 4,
  },
};

const DISTANCE_WEIGHT = {
  0: 100, // same region (non-home nation still in region)
  1: 14, // neighbouring region
  2: 3.5,
  3: 0.45,
  4: 0.08, // very far — rare but possible
};

export function regionForNation(nation) {
  if (!nation) return null;
  return NATION_REGION[nation] || null;
}

export function regionDistance(fromNation, toNation) {
  const a = regionForNation(fromNation);
  const b = regionForNation(toNation);
  if (!a || !b) return 3;
  if (a === b) return 0;
  const row = REGION_DISTANCE[a];
  if (!row) return 3;
  return row[b] ?? 3;
}

/** Weight for offering a club in `clubNation` to a player from `playerNation`. */
export function academyOfferWeight(playerNation, clubNation, { isHome = false } = {}) {
  if (isHome) return 120;
  const d = regionDistance(playerNation, clubNation);
  return DISTANCE_WEIGHT[d] ?? 0.2;
}
