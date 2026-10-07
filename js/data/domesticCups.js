/**
 * Domestic cup definitions for every nation that has a league in the sim.
 * startSize: bracket size at the round where our clubs enter (power of 2).
 * Nations with two divisions include both tiers in the draw.
 */

export const DOMESTIC_CUPS = {
  England: {
    name: "FA Cup",
    shortName: "FA Cup",
    startSize: 64, // PL + Championship (~44) → Round of 64 field
    includeSecondDivision: true,
    rounds: ["Round of 64", "Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
  },
  Germany: {
    name: "DFB-Pokal",
    shortName: "DFB-Pokal",
    startSize: 64,
    includeSecondDivision: true,
    rounds: ["Round of 64", "Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
  },
  Spain: {
    name: "Copa del Rey",
    shortName: "Copa del Rey",
    startSize: 64,
    includeSecondDivision: true,
    rounds: ["Round of 64", "Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
  },
  Italy: {
    name: "Coppa Italia",
    shortName: "Coppa Italia",
    startSize: 64,
    includeSecondDivision: true,
    rounds: ["Round of 64", "Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
  },
  France: {
    name: "Coupe de France",
    shortName: "Coupe de France",
    startSize: 64,
    includeSecondDivision: true,
    rounds: ["Round of 64", "Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
  },
  Brazil: {
    name: "Copa do Brasil",
    shortName: "Copa do Brasil",
    startSize: 64,
    includeSecondDivision: false,
    rounds: ["Round of 64", "Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
  },
  Belgium: {
    name: "Belgian Cup",
    shortName: "Croky Cup",
    startSize: 32,
    includeSecondDivision: false,
    rounds: ["Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
  },
  Argentina: {
    name: "Copa Argentina",
    shortName: "Copa Argentina",
    startSize: 64,
    includeSecondDivision: false,
    rounds: ["Round of 64", "Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
  },
  Portugal: {
    name: "Taça de Portugal",
    shortName: "Taça de Portugal",
    startSize: 32,
    includeSecondDivision: false,
    rounds: ["Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
  },
  Poland: {
    name: "Polish Cup",
    shortName: "Puchar Polski",
    startSize: 32,
    includeSecondDivision: false,
    rounds: ["Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
  },
  Denmark: {
    name: "Danish Cup",
    shortName: "Pokalen",
    startSize: 32,
    includeSecondDivision: false,
    rounds: ["Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
  },
  Norway: {
    name: "Norwegian Football Cup",
    shortName: "NM Cupen",
    startSize: 32,
    includeSecondDivision: false,
    rounds: ["Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
  },
  Mexico: {
    name: "Copa MX",
    shortName: "Copa MX",
    startSize: 32,
    includeSecondDivision: false,
    rounds: ["Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
  },
  Colombia: {
    name: "Copa Colombia",
    shortName: "Copa Colombia",
    startSize: 32,
    includeSecondDivision: false,
    rounds: ["Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
  },
  Netherlands: {
    name: "KNVB Cup",
    shortName: "KNVB Beker",
    startSize: 32,
    includeSecondDivision: false,
    rounds: ["Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
  },
  Ecuador: {
    name: "Copa Ecuador",
    shortName: "Copa Ecuador",
    startSize: 32,
    includeSecondDivision: false,
    rounds: ["Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
  },
  Turkey: {
    name: "Turkish Cup",
    shortName: "Türkiye Kupası",
    startSize: 64,
    includeSecondDivision: false,
    rounds: ["Round of 64", "Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
  },
  "United States": {
    name: "U.S. Open Cup",
    shortName: "Open Cup",
    startSize: 32,
    includeSecondDivision: false,
    rounds: ["Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
  },
  "Czech Republic": {
    name: "Czech Cup",
    shortName: "MOL Cup",
    startSize: 32,
    includeSecondDivision: false,
    rounds: ["Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
  },
  Croatia: {
    name: "Croatian Football Cup",
    shortName: "Hrvatski kup",
    startSize: 32,
    includeSecondDivision: false,
    rounds: ["Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
  },
  Serbia: {
    name: "Serbian Cup",
    shortName: "Kup Srbije",
    startSize: 32,
    includeSecondDivision: false,
    rounds: ["Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
  },
};

export function cupConfigForNation(nation) {
  return (
    DOMESTIC_CUPS[nation] || {
      name: `${nation} Cup`,
      shortName: `${nation} Cup`,
      startSize: 32,
      includeSecondDivision: false,
      rounds: ["Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
    }
  );
}
