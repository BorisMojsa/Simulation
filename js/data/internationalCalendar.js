/**
 * International tournament calendar + nation confederations.
 * Season calendar year = player.startYear + seasonNumber - 1
 * (e.g. 2026/27 season → tournament summer of 2026).
 */

import { WORLD_CUP_NATIONS } from "./worldCupNations.js";
import { NATIONAL_FORMATS } from "./competitions/formats.js";

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

function nationalEdition(id, year, overrides = {}) {
  const format = NATIONAL_FORMATS[id] || {};
  return {
    id,
    name: format.name || id,
    shortName: overrides.shortName || format.name || id,
    confederation: overrides.confederation || format.confederation || null,
    fieldSize: format.fieldSize,
    groupSize: format.groupSize,
    bestThirds: format.bestThirds || 0,
    thirdPlaceMatch: Boolean(format.thirdPlaceMatch),
    knockoutStart: format.knockoutStart,
    ruleVersion: format.ruleVersion,
    editionYear: year,
    year,
    ...overrides,
  };
}

/**
 * Major tournaments by calendar year. Field/advancement rules come from NATIONAL_FORMATS;
 * this calendar only chooses which editions occur in a year.
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
    list.push(nationalEdition("world-cup", y, { shortName: "World Cup", confederation: "FIFA" }));
  }

  if (y % 4 === 0) {
    list.push(nationalEdition("euro", y, { shortName: "EURO", confederation: "UEFA" }));
    list.push(
      nationalEdition("copa-america", y, { shortName: "Copa América", confederation: "CONMEBOL" })
    );
  }

  if (y % 2 === 1) {
    // Pool-limited vs real AFCON/Gold Cup field sizes — documented in NATIONAL_FORMATS.
    list.push(nationalEdition("afcon", y, { shortName: "AFCON", confederation: "CAF" }));
    list.push(nationalEdition("gold-cup", y, { shortName: "Gold Cup", confederation: "CONCACAF" }));
  }

  if (y % 4 === 3) {
    list.push(nationalEdition("asian-cup", y, { shortName: "Asian Cup", confederation: "AFC" }));
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
