/**
 * International tournament calendar + nation confederations.
 * Season calendar year = player.startYear + seasonNumber - 1
 * (e.g. 2026/27 season → tournament summer of 2026).
 */

import { WORLD_CUP_NATIONS } from "./worldCupNations.js";

export const CONFEDERATIONS = {
  UEFA: "UEFA",
  CONMEBOL: "CONMEBOL",
  CAF: "CAF",
  CONCACAF: "CONCACAF",
  AFC: "AFC",
  OFC: "OFC",
};

/** Nation name → confederation */
export const NATION_CONFEDERATION = {
  Algeria: "CAF",
  Angola: "CAF",
  Argentina: "CONMEBOL",
  Australia: "AFC",
  Austria: "UEFA",
  Belgium: "UEFA",
  Bolivia: "CONMEBOL",
  "Bosnia and Herzegovina": "UEFA",
  Brazil: "CONMEBOL",
  Bulgaria: "UEFA",
  Cameroon: "CAF",
  Canada: "CONCACAF",
  "Cape Verde": "CAF",
  Chile: "CONMEBOL",
  China: "AFC",
  Colombia: "CONMEBOL",
  "Costa Rica": "CONCACAF",
  Croatia: "UEFA",
  Curaçao: "CONCACAF",
  "Czech Republic": "UEFA",
  "DR Congo": "CAF",
  Denmark: "UEFA",
  Ecuador: "CONMEBOL",
  Egypt: "CAF",
  England: "UEFA",
  France: "UEFA",
  Germany: "UEFA",
  Ghana: "CAF",
  Greece: "UEFA",
  Haiti: "CONCACAF",
  Honduras: "CONCACAF",
  Hungary: "UEFA",
  Iceland: "UEFA",
  Iran: "AFC",
  Iraq: "AFC",
  Italy: "UEFA",
  "Ivory Coast": "CAF",
  Jamaica: "CONCACAF",
  Japan: "AFC",
  Jordan: "AFC",
  Mali: "CAF",
  Mexico: "CONCACAF",
  Morocco: "CAF",
  Netherlands: "UEFA",
  "New Zealand": "OFC",
  Nigeria: "CAF",
  "North Korea": "AFC",
  Norway: "UEFA",
  Panama: "CONCACAF",
  Paraguay: "CONMEBOL",
  Peru: "CONMEBOL",
  Poland: "UEFA",
  Portugal: "UEFA",
  Qatar: "AFC",
  "Republic of Ireland": "UEFA",
  Romania: "UEFA",
  Russia: "UEFA",
  "Saudi Arabia": "AFC",
  Scotland: "UEFA",
  Senegal: "CAF",
  Serbia: "UEFA",
  Slovakia: "UEFA",
  Slovenia: "UEFA",
  "South Africa": "CAF",
  "South Korea": "AFC",
  Spain: "UEFA",
  Sweden: "UEFA",
  Switzerland: "UEFA",
  Togo: "CAF",
  "Trinidad and Tobago": "CONCACAF",
  Tunisia: "CAF",
  Turkey: "UEFA",
  Ukraine: "UEFA",
  "United Arab Emirates": "AFC",
  "United States": "CONCACAF",
  Uruguay: "CONMEBOL",
  Uzbekistan: "AFC",
  Venezuela: "CONMEBOL",
  Wales: "UEFA",
};

/**
 * Major tournaments by calendar year rules (simplified but realistic cycles).
 * World Cup: every 4 years (…2026, 2030) → year % 4 === 2
 * Euro + Copa América: every 4 years (…2024, 2028) → year % 4 === 0
 * AFCON: every 2 years on odd years (…2025, 2027, 2029)
 * Asian Cup: every 4 years (…2027, 2031) → year % 4 === 3
 * Gold Cup: every 2 years on odd years (with AFCON years)
 */
export function tournamentsForYear(year) {
  const y = Number(year);
  const list = [];

  if (y % 4 === 2) {
    list.push({
      id: "world-cup",
      name: "FIFA World Cup",
      shortName: "World Cup",
      confederation: "FIFA",
      fieldSize: 16,
      groupSize: 4,
    });
  }

  if (y % 4 === 0) {
    list.push({
      id: "euro",
      name: "UEFA European Championship",
      shortName: "EURO",
      confederation: "UEFA",
      fieldSize: 16,
      groupSize: 4,
    });
    list.push({
      id: "copa-america",
      name: "Copa América",
      shortName: "Copa América",
      confederation: "CONMEBOL",
      fieldSize: 12,
      groupSize: 3,
    });
  }

  if (y % 2 === 1) {
    // Field sizes match the selectable WORLD_CUP_NATIONS pool (CAF 14, CONCACAF 10).
    // Simplified vs real 24/16-team tournaments — must stay fillable without inventing nations.
    list.push({
      id: "afcon",
      name: "Africa Cup of Nations",
      shortName: "AFCON",
      confederation: "CAF",
      fieldSize: 12,
      groupSize: 3,
    });
    list.push({
      id: "gold-cup",
      name: "CONCACAF Gold Cup",
      shortName: "Gold Cup",
      confederation: "CONCACAF",
      fieldSize: 8,
      groupSize: 4,
    });
  }

  if (y % 4 === 3) {
    // AFC selectable pool is 12 nations in this project.
    list.push({
      id: "asian-cup",
      name: "AFC Asian Cup",
      shortName: "Asian Cup",
      confederation: "AFC",
      fieldSize: 12,
      groupSize: 3,
    });
  }

  return list;
}

export function confederationForNation(nation) {
  return NATION_CONFEDERATION[nation] || null;
}

export function nationsInConfederation(conf) {
  return WORLD_CUP_NATIONS.filter((n) => NATION_CONFEDERATION[n.name] === conf).map((n) => n.name);
}

export function allTournamentNations() {
  return WORLD_CUP_NATIONS.map((n) => n.name);
}

export function flagForNation(nation) {
  const entry = WORLD_CUP_NATIONS.find((n) => n.name === nation);
  if (!entry?.code) return "";
  return `https://flagcdn.com/w80/${entry.code}.png`;
}
