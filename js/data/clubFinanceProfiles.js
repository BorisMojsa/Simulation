/**
 * Club finance profiles for the playable world.
 *
 * Financial capacity is SEPARATE from sporting strength (ClubElo / team-quality).
 * Values are SOURCED INPUTS where noted, otherwise DECLARED SIMULATION ALLOCATIONS
 * with estimatedFields. Not claimed exact private transfer budgets.
 *
 * Display currency remains GBP; raw sourceCurrency retained on profiles.
 */
import { LEAGUES } from "./leagues.js";
import { FX_SNAPSHOT } from "../config/recruitmentConfig.js";
import { clamp } from "../utils/helpers.js";

export const FINANCE_PROFILE_VERSION = "club-finance-v1-2026-10-09";

/**
 * League baselines (GBP). Ordinary-club centres; club financialTier scales from these.
 * estimated: true unless a league has stronger public anchors for the pack.
 */
export const LEAGUE_FINANCE_BASELINES = {
  "league:england-premier-league": {
    sourceCurrency: "GBP",
    operatingRevenue: 220_000_000,
    playerPayrollBudget: 140_000_000,
    baselineCommittedPayroll: 105_000_000,
    boardTransferAuthorisation: 55_000_000,
    ordinarySingleDealBand: [2_000_000, 45_000_000],
    roleWageBandsWeekly: {
      prospect: [1500, 12000],
      cover: [8000, 45000],
      rotation: [25000, 90000],
      starter: [50000, 180000],
      key: [90000, 350000],
    },
    topPlayerWageReferenceWeekly: 300000,
    debtServiceReserve: 15_000_000,
    financialRuleAdapter: "premier-league-2026",
    confidence: "medium",
    estimated: true,
    notes: "Deloitte/PL framework; major spenders overridden per club.",
  },
  "league:england-championship": {
    sourceCurrency: "GBP",
    operatingRevenue: 28_000_000,
    playerPayrollBudget: 18_000_000,
    baselineCommittedPayroll: 14_000_000,
    boardTransferAuthorisation: 6_000_000,
    ordinarySingleDealBand: [200_000, 4_000_000],
    roleWageBandsWeekly: {
      prospect: [800, 3500],
      cover: [2500, 9000],
      rotation: [5000, 18000],
      starter: [8000, 35000],
      key: [15000, 55000],
    },
    topPlayerWageReferenceWeekly: 45000,
    debtServiceReserve: 2_000_000,
    financialRuleAdapter: "efl-championship",
    confidence: "medium",
    estimated: true,
    notes: "EFL/Deloitte; parachute clubs get elevated overrides.",
  },
  "league:germany-bundesliga": {
    sourceCurrency: "EUR",
    operatingRevenue: 160_000_000,
    playerPayrollBudget: 95_000_000,
    baselineCommittedPayroll: 72_000_000,
    boardTransferAuthorisation: 35_000_000,
    ordinarySingleDealBand: [1_000_000, 30_000_000],
    roleWageBandsWeekly: {
      prospect: [1200, 10000],
      cover: [6000, 35000],
      rotation: [18000, 70000],
      starter: [35000, 140000],
      key: [70000, 280000],
    },
    topPlayerWageReferenceWeekly: 250000,
    debtServiceReserve: 10_000_000,
    financialRuleAdapter: "dfl",
    confidence: "medium",
    estimated: true,
  },
  "league:germany-2-bundesliga": {
    sourceCurrency: "EUR",
    operatingRevenue: 22_000_000,
    playerPayrollBudget: 12_000_000,
    baselineCommittedPayroll: 9_500_000,
    boardTransferAuthorisation: 3_500_000,
    ordinarySingleDealBand: [150_000, 2_500_000],
    roleWageBandsWeekly: {
      prospect: [700, 3000],
      cover: [2000, 7000],
      rotation: [4000, 12000],
      starter: [6000, 22000],
      key: [10000, 35000],
    },
    topPlayerWageReferenceWeekly: 30000,
    debtServiceReserve: 1_200_000,
    financialRuleAdapter: "dfl-2",
    confidence: "medium",
    estimated: true,
    notes: "DFL 2. Bundesliga division baseline; distinct from Serie B.",
  },
  "league:spain-la-liga": {
    sourceCurrency: "EUR",
    operatingRevenue: 140_000_000,
    playerPayrollBudget: 90_000_000,
    baselineCommittedPayroll: 70_000_000,
    boardTransferAuthorisation: 30_000_000,
    ordinarySingleDealBand: [800_000, 28_000_000],
    roleWageBandsWeekly: {
      prospect: [1000, 9000],
      cover: [5000, 30000],
      rotation: [15000, 65000],
      starter: [30000, 130000],
      key: [60000, 300000],
    },
    topPlayerWageReferenceWeekly: 280000,
    debtServiceReserve: 12_000_000,
    financialRuleAdapter: "laliga-squad-cost",
    confidence: "medium",
    estimated: true,
  },
  "league:spain-laliga-2": {
    sourceCurrency: "EUR",
    operatingRevenue: 12_000_000,
    playerPayrollBudget: 7_000_000,
    baselineCommittedPayroll: 5_500_000,
    boardTransferAuthorisation: 1_800_000,
    ordinarySingleDealBand: [80_000, 1_200_000],
    roleWageBandsWeekly: {
      prospect: [500, 2200],
      cover: [1200, 4500],
      rotation: [2500, 8000],
      starter: [4000, 14000],
      key: [7000, 22000],
    },
    topPlayerWageReferenceWeekly: 18000,
    debtServiceReserve: 600_000,
    financialRuleAdapter: "laliga-2-squad-cost",
    confidence: "low",
    estimated: true,
  },
  "league:italy-serie-a": {
    sourceCurrency: "EUR",
    operatingRevenue: 120_000_000,
    playerPayrollBudget: 85_000_000,
    baselineCommittedPayroll: 68_000_000,
    boardTransferAuthorisation: 28_000_000,
    ordinarySingleDealBand: [700_000, 25_000_000],
    roleWageBandsWeekly: {
      prospect: [1000, 8500],
      cover: [4500, 28000],
      rotation: [14000, 60000],
      starter: [28000, 120000],
      key: [55000, 260000],
    },
    topPlayerWageReferenceWeekly: 240000,
    debtServiceReserve: 14_000_000,
    financialRuleAdapter: "figc",
    confidence: "medium",
    estimated: true,
  },
  "league:italy-serie-b": {
    sourceCurrency: "EUR",
    operatingRevenue: 14_000_000,
    playerPayrollBudget: 8_000_000,
    baselineCommittedPayroll: 6_500_000,
    boardTransferAuthorisation: 6_000_000,
    ordinarySingleDealBand: [100_000, 3_000_000],
    roleWageBandsWeekly: {
      prospect: [600, 2500],
      cover: [1500, 4000],
      rotation: [2500, 5500],
      starter: [3000, 8000],
      key: [5000, 14000],
    },
    topPlayerWageReferenceWeekly: 12000,
    debtServiceReserve: 800_000,
    financialRuleAdapter: "figc-serie-b",
    confidence: "medium",
    estimated: true,
    notes: "Conservative ordinary Serie B; no ordinary 100m bids. FIGC pressure context.",
  },
  "league:france-ligue-1": {
    sourceCurrency: "EUR",
    operatingRevenue: 90_000_000,
    playerPayrollBudget: 55_000_000,
    baselineCommittedPayroll: 42_000_000,
    boardTransferAuthorisation: 18_000_000,
    ordinarySingleDealBand: [400_000, 18_000_000],
    roleWageBandsWeekly: {
      prospect: [900, 7000],
      cover: [3500, 22000],
      rotation: [10000, 45000],
      starter: [20000, 90000],
      key: [40000, 200000],
    },
    topPlayerWageReferenceWeekly: 180000,
    debtServiceReserve: 8_000_000,
    financialRuleAdapter: "dncg",
    confidence: "medium",
    estimated: true,
  },
  "league:france-ligue-2": {
    sourceCurrency: "EUR",
    operatingRevenue: 10_000_000,
    playerPayrollBudget: 5_500_000,
    baselineCommittedPayroll: 4_400_000,
    boardTransferAuthorisation: 1_200_000,
    ordinarySingleDealBand: [50_000, 800_000],
    roleWageBandsWeekly: {
      prospect: [400, 1800],
      cover: [1000, 3500],
      rotation: [2000, 6000],
      starter: [3000, 10000],
      key: [5000, 16000],
    },
    topPlayerWageReferenceWeekly: 14000,
    debtServiceReserve: 400_000,
    financialRuleAdapter: "dncg-l2",
    confidence: "low",
    estimated: true,
  },
  "league:brazil-brasileirao-serie-a": {
    sourceCurrency: "BRL",
    operatingRevenue: 45_000_000,
    playerPayrollBudget: 22_000_000,
    baselineCommittedPayroll: 17_000_000,
    boardTransferAuthorisation: 8_000_000,
    ordinarySingleDealBand: [200_000, 6_000_000],
    roleWageBandsWeekly: {
      prospect: [400, 2500],
      cover: [1500, 8000],
      rotation: [4000, 18000],
      starter: [8000, 40000],
      key: [15000, 80000],
    },
    topPlayerWageReferenceWeekly: 70000,
    debtServiceReserve: 3_000_000,
    financialRuleAdapter: "cbf-generic",
    confidence: "low",
    estimated: true,
    notes: "EY club statements compilation; BRL→GBP via FX snapshot.",
  },
  "league:belgium-belgian-pro-league": {
    sourceCurrency: "EUR",
    operatingRevenue: 28_000_000,
    playerPayrollBudget: 16_000_000,
    baselineCommittedPayroll: 12_000_000,
    boardTransferAuthorisation: 5_000_000,
    ordinarySingleDealBand: [150_000, 4_000_000],
    roleWageBandsWeekly: {
      prospect: [600, 2800],
      cover: [1800, 7000],
      rotation: [4000, 14000],
      starter: [7000, 28000],
      key: [12000, 45000],
    },
    topPlayerWageReferenceWeekly: 40000,
    debtServiceReserve: 1_500_000,
    financialRuleAdapter: "uefa-monitored-generic",
    confidence: "low",
    estimated: true,
  },
  "league:argentina-liga-profesional": {
    sourceCurrency: "ARS",
    operatingRevenue: 18_000_000,
    playerPayrollBudget: 9_000_000,
    baselineCommittedPayroll: 7_000_000,
    boardTransferAuthorisation: 2_500_000,
    ordinarySingleDealBand: [80_000, 2_000_000],
    roleWageBandsWeekly: {
      prospect: [300, 1500],
      cover: [800, 4000],
      rotation: [2000, 9000],
      starter: [4000, 18000],
      key: [8000, 35000],
    },
    topPlayerWageReferenceWeekly: 30000,
    debtServiceReserve: 1_000_000,
    financialRuleAdapter: "afa-generic",
    confidence: "low",
    estimated: true,
  },
  "league:portugal-primeira-liga": {
    sourceCurrency: "EUR",
    operatingRevenue: 35_000_000,
    playerPayrollBudget: 18_000_000,
    baselineCommittedPayroll: 14_000_000,
    boardTransferAuthorisation: 7_000_000,
    ordinarySingleDealBand: [200_000, 8_000_000],
    roleWageBandsWeekly: {
      prospect: [500, 3000],
      cover: [1500, 8000],
      rotation: [4000, 16000],
      starter: [7000, 35000],
      key: [14000, 70000],
    },
    topPlayerWageReferenceWeekly: 60000,
    debtServiceReserve: 2_000_000,
    financialRuleAdapter: "uefa-monitored-generic",
    confidence: "medium",
    estimated: true,
  },
  "league:poland-ekstraklasa": {
    sourceCurrency: "PLN",
    operatingRevenue: 12_000_000,
    playerPayrollBudget: 6_000_000,
    baselineCommittedPayroll: 4_800_000,
    boardTransferAuthorisation: 1_500_000,
    ordinarySingleDealBand: [50_000, 1_000_000],
    roleWageBandsWeekly: {
      prospect: [300, 1200],
      cover: [800, 3000],
      rotation: [1500, 5500],
      starter: [2500, 10000],
      key: [4500, 18000],
    },
    topPlayerWageReferenceWeekly: 15000,
    debtServiceReserve: 400_000,
    financialRuleAdapter: "uefa-monitored-generic",
    confidence: "low",
    estimated: true,
  },
  "league:denmark-superliga": {
    sourceCurrency: "DKK",
    operatingRevenue: 14_000_000,
    playerPayrollBudget: 7_500_000,
    baselineCommittedPayroll: 6_000_000,
    boardTransferAuthorisation: 2_000_000,
    ordinarySingleDealBand: [60_000, 1_500_000],
    roleWageBandsWeekly: {
      prospect: [400, 1500],
      cover: [1000, 3500],
      rotation: [2000, 7000],
      starter: [3500, 12000],
      key: [6000, 22000],
    },
    topPlayerWageReferenceWeekly: 18000,
    debtServiceReserve: 500_000,
    financialRuleAdapter: "uefa-monitored-generic",
    confidence: "low",
    estimated: true,
  },
  "league:norway-eliteserien": {
    sourceCurrency: "NOK",
    operatingRevenue: 11_000_000,
    playerPayrollBudget: 6_000_000,
    baselineCommittedPayroll: 4_800_000,
    boardTransferAuthorisation: 1_400_000,
    ordinarySingleDealBand: [40_000, 1_000_000],
    roleWageBandsWeekly: {
      prospect: [350, 1400],
      cover: [900, 3200],
      rotation: [1800, 6500],
      starter: [3000, 11000],
      key: [5500, 20000],
    },
    topPlayerWageReferenceWeekly: 16000,
    debtServiceReserve: 400_000,
    financialRuleAdapter: "calendar-year-generic",
    confidence: "low",
    estimated: true,
    notes: "Calendar-year season; windows via seasonCalendar.",
  },
  "league:mexico-liga-mx": {
    sourceCurrency: "MXN",
    operatingRevenue: 25_000_000,
    playerPayrollBudget: 14_000_000,
    baselineCommittedPayroll: 11_000_000,
    boardTransferAuthorisation: 4_000_000,
    ordinarySingleDealBand: [100_000, 3_500_000],
    roleWageBandsWeekly: {
      prospect: [500, 2500],
      cover: [1500, 7000],
      rotation: [3500, 14000],
      starter: [6000, 28000],
      key: [12000, 50000],
    },
    topPlayerWageReferenceWeekly: 45000,
    debtServiceReserve: 1_200_000,
    financialRuleAdapter: "liga-mx-generic",
    confidence: "low",
    estimated: true,
  },
  "league:colombia-categoria-primera-a": {
    sourceCurrency: "COP",
    operatingRevenue: 8_000_000,
    playerPayrollBudget: 4_000_000,
    baselineCommittedPayroll: 3_200_000,
    boardTransferAuthorisation: 900_000,
    ordinarySingleDealBand: [30_000, 700_000],
    roleWageBandsWeekly: {
      prospect: [250, 1000],
      cover: [600, 2500],
      rotation: [1200, 4500],
      starter: [2000, 8000],
      key: [3500, 14000],
    },
    topPlayerWageReferenceWeekly: 12000,
    debtServiceReserve: 250_000,
    financialRuleAdapter: "dimayor-generic",
    confidence: "low",
    estimated: true,
    notes: "Supersociedades reporting route; COP units.",
  },
  "league:netherlands-eredivisie": {
    sourceCurrency: "EUR",
    operatingRevenue: 32_000_000,
    playerPayrollBudget: 17_000_000,
    baselineCommittedPayroll: 13_000_000,
    boardTransferAuthorisation: 6_000_000,
    ordinarySingleDealBand: [150_000, 5_000_000],
    roleWageBandsWeekly: {
      prospect: [500, 2800],
      cover: [1500, 7500],
      rotation: [3500, 15000],
      starter: [6500, 32000],
      key: [12000, 60000],
    },
    topPlayerWageReferenceWeekly: 55000,
    debtServiceReserve: 1_500_000,
    financialRuleAdapter: "uefa-monitored-generic",
    confidence: "medium",
    estimated: true,
  },
  "league:ecuador-ligapro-serie-a": {
    sourceCurrency: "USD",
    operatingRevenue: 6_000_000,
    playerPayrollBudget: 3_200_000,
    baselineCommittedPayroll: 2_500_000,
    boardTransferAuthorisation: 700_000,
    ordinarySingleDealBand: [20_000, 500_000],
    roleWageBandsWeekly: {
      prospect: [200, 900],
      cover: [500, 2000],
      rotation: [1000, 3500],
      starter: [1500, 6000],
      key: [2500, 10000],
    },
    topPlayerWageReferenceWeekly: 9000,
    debtServiceReserve: 200_000,
    financialRuleAdapter: "ligapro-economic-control",
    confidence: "low",
    estimated: true,
  },
  "league:turkiye-super-lig": {
    sourceCurrency: "TRY",
    operatingRevenue: 30_000_000,
    playerPayrollBudget: 18_000_000,
    baselineCommittedPayroll: 14_000_000,
    boardTransferAuthorisation: 5_000_000,
    ordinarySingleDealBand: [100_000, 4_000_000],
    roleWageBandsWeekly: {
      prospect: [500, 2500],
      cover: [1500, 8000],
      rotation: [3500, 16000],
      starter: [7000, 35000],
      key: [14000, 70000],
    },
    topPlayerWageReferenceWeekly: 60000,
    debtServiceReserve: 3_000_000,
    financialRuleAdapter: "tff-generic",
    confidence: "low",
    estimated: true,
  },
  "league:united-states-mls": {
    sourceCurrency: "USD",
    operatingRevenue: 40_000_000,
    playerPayrollBudget: 12_000_000,
    baselineCommittedPayroll: 9_500_000,
    boardTransferAuthorisation: 3_000_000,
    ordinarySingleDealBand: [50_000, 2_000_000],
    roleWageBandsWeekly: {
      prospect: [800, 2500],
      cover: [1500, 4500],
      rotation: [2500, 8000],
      starter: [4000, 14000],
      key: [8000, 25000],
    },
    topPlayerWageReferenceWeekly: 22000,
    debtServiceReserve: 1_000_000,
    financialRuleAdapter: "mls-2026",
    confidence: "medium",
    estimated: false,
    notes: "MLS 2026 senior budget USD 6.425m / max charge USD 803,125 — adapter converts charges; club funding still required.",
    mlsSeniorBudgetUsd: 6_425_000,
    mlsMaxBudgetChargeUsd: 803_125,
  },
  "league:czechia-czech-first-league": {
    sourceCurrency: "CZK",
    operatingRevenue: 10_000_000,
    playerPayrollBudget: 5_500_000,
    baselineCommittedPayroll: 4_400_000,
    boardTransferAuthorisation: 1_200_000,
    ordinarySingleDealBand: [40_000, 900_000],
    roleWageBandsWeekly: {
      prospect: [300, 1200],
      cover: [700, 2800],
      rotation: [1400, 5500],
      starter: [2500, 10000],
      key: [4500, 18000],
    },
    topPlayerWageReferenceWeekly: 15000,
    debtServiceReserve: 350_000,
    financialRuleAdapter: "uefa-monitored-generic",
    confidence: "low",
    estimated: true,
  },
  "league:croatia-hnl": {
    sourceCurrency: "EUR",
    operatingRevenue: 9_000_000,
    playerPayrollBudget: 5_000_000,
    baselineCommittedPayroll: 4_000_000,
    boardTransferAuthorisation: 1_100_000,
    ordinarySingleDealBand: [40_000, 1_200_000],
    roleWageBandsWeekly: {
      prospect: [300, 1400],
      cover: [800, 3500],
      rotation: [1600, 7000],
      starter: [3000, 14000],
      key: [6000, 28000],
    },
    topPlayerWageReferenceWeekly: 25000,
    debtServiceReserve: 400_000,
    financialRuleAdapter: "uefa-monitored-generic",
    confidence: "low",
    estimated: true,
  },
  "league:serbia-superliga": {
    sourceCurrency: "RSD",
    operatingRevenue: 8_000_000,
    playerPayrollBudget: 4_500_000,
    baselineCommittedPayroll: 3_600_000,
    boardTransferAuthorisation: 1_000_000,
    ordinarySingleDealBand: [30_000, 1_000_000],
    roleWageBandsWeekly: {
      prospect: [250, 1200],
      cover: [700, 3000],
      rotation: [1400, 6000],
      starter: [2500, 12000],
      key: [5000, 25000],
    },
    topPlayerWageReferenceWeekly: 22000,
    debtServiceReserve: 350_000,
    financialRuleAdapter: "uefa-monitored-generic",
    confidence: "low",
    estimated: true,
  },
  "league:saudi-arabia-saudi-pro-league": {
    sourceCurrency: "SAR",
    operatingRevenue: 45_000_000,
    playerPayrollBudget: 35_000_000,
    baselineCommittedPayroll: 28_000_000,
    boardTransferAuthorisation: 18_000_000,
    ordinarySingleDealBand: [500_000, 15_000_000],
    roleWageBandsWeekly: {
      prospect: [800, 5000],
      cover: [4000, 20000],
      rotation: [12000, 45000],
      starter: [25000, 90000],
      key: [50000, 200000],
    },
    topPlayerWageReferenceWeekly: 180000,
    debtServiceReserve: 3_000_000,
    financialRuleAdapter: "afc-generic",
    confidence: "low",
    estimated: true,
    notes: "Declared simulation allocation for AFC pathway; not club-by-club audited accounts.",
  },
  "league:japan-j1-league": {
    sourceCurrency: "JPY",
    operatingRevenue: 22_000_000,
    playerPayrollBudget: 12_000_000,
    baselineCommittedPayroll: 9_500_000,
    boardTransferAuthorisation: 4_000_000,
    ordinarySingleDealBand: [100_000, 3_500_000],
    roleWageBandsWeekly: {
      prospect: [400, 2000],
      cover: [1500, 7000],
      rotation: [3500, 14000],
      starter: [7000, 28000],
      key: [14000, 55000],
    },
    topPlayerWageReferenceWeekly: 50000,
    debtServiceReserve: 1_000_000,
    financialRuleAdapter: "afc-generic",
    confidence: "low",
    estimated: true,
  },
  "league:south-korea-k-league-1": {
    sourceCurrency: "KRW",
    operatingRevenue: 14_000_000,
    playerPayrollBudget: 8_000_000,
    baselineCommittedPayroll: 6_500_000,
    boardTransferAuthorisation: 2_500_000,
    ordinarySingleDealBand: [80_000, 2_500_000],
    roleWageBandsWeekly: {
      prospect: [350, 1600],
      cover: [1200, 5500],
      rotation: [2800, 11000],
      starter: [5500, 22000],
      key: [11000, 45000],
    },
    topPlayerWageReferenceWeekly: 40000,
    debtServiceReserve: 700_000,
    financialRuleAdapter: "afc-generic",
    confidence: "low",
    estimated: true,
  },
  "league:egypt-egyptian-premier-league": {
    sourceCurrency: "EGP",
    operatingRevenue: 10_000_000,
    playerPayrollBudget: 6_000_000,
    baselineCommittedPayroll: 4_800_000,
    boardTransferAuthorisation: 1_800_000,
    ordinarySingleDealBand: [50_000, 1_800_000],
    roleWageBandsWeekly: {
      prospect: [250, 1200],
      cover: [900, 4000],
      rotation: [2000, 8500],
      starter: [4000, 16000],
      key: [8000, 35000],
    },
    topPlayerWageReferenceWeekly: 32000,
    debtServiceReserve: 500_000,
    financialRuleAdapter: "caf-generic",
    confidence: "low",
    estimated: true,
  },
  "league:morocco-botola-pro": {
    sourceCurrency: "MAD",
    operatingRevenue: 7_000_000,
    playerPayrollBudget: 4_000_000,
    baselineCommittedPayroll: 3_200_000,
    boardTransferAuthorisation: 1_200_000,
    ordinarySingleDealBand: [40_000, 1_200_000],
    roleWageBandsWeekly: {
      prospect: [200, 1000],
      cover: [700, 3200],
      rotation: [1600, 7000],
      starter: [3000, 13000],
      key: [6000, 28000],
    },
    topPlayerWageReferenceWeekly: 25000,
    debtServiceReserve: 400_000,
    financialRuleAdapter: "caf-generic",
    confidence: "low",
    estimated: true,
  },
};

/** Named club multipliers / absolute overrides (GBP unless noted). Conservative. */
const CLUB_FINANCE_OVERRIDES = {
  "club:england:manchester-city": { boardMult: 2.4, payrollMult: 1.8, dealMax: 120_000_000, confidence: "medium" },
  "club:england:manchester-united": { boardMult: 1.9, payrollMult: 1.7, dealMax: 90_000_000, confidence: "medium" },
  "club:england:liverpool": { boardMult: 1.8, payrollMult: 1.6, dealMax: 85_000_000, confidence: "medium" },
  "club:england:chelsea": { boardMult: 2.0, payrollMult: 1.7, dealMax: 100_000_000, confidence: "medium" },
  "club:england:arsenal": { boardMult: 1.6, payrollMult: 1.5, dealMax: 75_000_000, confidence: "medium" },
  "club:germany:bayern-munich": { boardMult: 2.2, payrollMult: 1.8, dealMax: 100_000_000, confidence: "medium" },
  "club:germany:borussia-dortmund": { boardMult: 1.5, payrollMult: 1.4, dealMax: 60_000_000, confidence: "medium" },
  "club:spain:real-madrid": { boardMult: 2.3, payrollMult: 1.9, dealMax: 120_000_000, confidence: "medium" },
  "club:spain:barcelona": { boardMult: 1.4, payrollMult: 1.6, dealMax: 70_000_000, confidence: "low" },
  "club:spain:atletico-madrid": { boardMult: 1.5, payrollMult: 1.4, dealMax: 60_000_000, confidence: "medium" },
  "club:france:paris-saint-germain": { boardMult: 2.5, payrollMult: 2.0, dealMax: 130_000_000, confidence: "medium" },
  "club:italy:inter": { boardMult: 1.5, payrollMult: 1.4, dealMax: 55_000_000, confidence: "medium" },
  "club:italy:juventus": { boardMult: 1.5, payrollMult: 1.4, dealMax: 55_000_000, confidence: "medium" },
  "club:italy:ac-milan": { boardMult: 1.5, payrollMult: 1.4, dealMax: 55_000_000, confidence: "medium" },
  "club:netherlands:ajax": { boardMult: 1.6, payrollMult: 1.3, dealMax: 40_000_000, confidence: "medium" },
  "club:netherlands:psv": { boardMult: 1.4, payrollMult: 1.2, dealMax: 30_000_000, confidence: "medium" },
  "club:netherlands:feyenoord": { boardMult: 1.3, payrollMult: 1.15, dealMax: 25_000_000, confidence: "medium" },
  "club:portugal:benfica": { boardMult: 1.7, payrollMult: 1.3, dealMax: 45_000_000, confidence: "medium" },
  "club:portugal:porto": { boardMult: 1.6, payrollMult: 1.25, dealMax: 40_000_000, confidence: "medium" },
  "club:portugal:sporting-cp": { boardMult: 1.5, payrollMult: 1.2, dealMax: 35_000_000, confidence: "medium" },
  "club:brazil:flamengo": { boardMult: 1.8, payrollMult: 1.5, dealMax: 25_000_000, confidence: "low" },
  "club:brazil:palmeiras": { boardMult: 1.6, payrollMult: 1.4, dealMax: 20_000_000, confidence: "low" },
};

/** financialTier 1–5 scale vs league ordinary centre. */
const TIER_SCALE = {
  1: { board: 0.45, payroll: 0.55, deal: 0.4, wage: 0.55 },
  2: { board: 0.7, payroll: 0.75, deal: 0.65, wage: 0.75 },
  3: { board: 1.0, payroll: 1.0, deal: 1.0, wage: 1.0 },
  4: { board: 1.35, payroll: 1.25, deal: 1.4, wage: 1.3 },
  5: { board: 1.75, payroll: 1.55, deal: 1.9, wage: 1.65 },
};

function scaleBand(band, mult) {
  return [Math.round(band[0] * mult), Math.round(band[1] * mult)];
}

function scaleWageBands(bands, mult) {
  const out = {};
  for (const [role, [lo, hi]] of Object.entries(bands)) {
    out[role] = [Math.max(100, Math.round(lo * mult)), Math.max(200, Math.round(hi * mult))];
  }
  return out;
}

/**
 * Baseline numeric fields are declared GBP simulation allocations.
 * sourceCurrency documents typical club reporting currency; FX_SNAPSHOT is used
 * when converting statutory foreign amounts (e.g. MLS USD charges).
 */
function normalizeBaseline(baseline) {
  return {
    ...baseline,
    operatingRevenueGbp: baseline.operatingRevenue,
    playerPayrollBudgetGbp: baseline.playerPayrollBudget,
    baselineCommittedPayrollGbp: baseline.baselineCommittedPayroll,
    boardTransferAuthorisationGbp: baseline.boardTransferAuthorisation,
    ordinarySingleDealBandGbp: [...baseline.ordinarySingleDealBand],
    roleWageBandsWeeklyGbp: { ...baseline.roleWageBandsWeekly },
    topPlayerWageReferenceWeeklyGbp: baseline.topPlayerWageReferenceWeekly,
    debtServiceReserveGbp: baseline.debtServiceReserve,
  };
}

/**
 * Build a ClubFinanceProfile for one club.
 */
export function buildClubFinanceProfile(club, league) {
  const leagueId = league.leagueId || club.leagueId;
  const rawBaseline = LEAGUE_FINANCE_BASELINES[leagueId];
  if (!rawBaseline) {
    // Conservative non-elite fallback — never elite defaults.
    return {
      clubId: club.clubId,
      leagueId,
      financialSeason: FINANCE_PROFILE_VERSION,
      sourceCurrency: "GBP",
      operatingRevenue: 4_000_000,
      playerPayrollBudget: 2_000_000,
      baselineCommittedPayroll: 1_600_000,
      boardTransferAuthorisation: 500_000,
      ordinarySingleDealBand: [20_000, 350_000],
      exceptionalDealPolicy: "board-exception-rare",
      roleWageBands: {
        prospect: [200, 800],
        cover: [500, 1800],
        rotation: [1000, 3000],
        starter: [1500, 5000],
        key: [2500, 8000],
      },
      topPlayerWageReference: 7000,
      debtServiceReserve: 150_000,
      existingTransferCommitments: 0,
      ownerFundingPolicy: "none",
      financialRuleAdapter: "conservative-fallback",
      sourceUrls: [],
      scope: "declared_simulation_allocation",
      confidence: "none",
      estimatedFields: ["all"],
      profileVersion: FINANCE_PROFILE_VERSION,
      fxVersion: FX_SNAPSHOT.version,
      estimated: true,
    };
  }

  const baseline = normalizeBaseline(rawBaseline);
  const ft = clamp(Math.round(club.financialTier || league.financialPower || 2), 1, 5);
  // Within a league, financialTier alone must not pull ordinary second-division clubs
  // up to top-flight spending. Scale gently; league baseline already sets the centre.
  const scale = TIER_SCALE[ft] || TIER_SCALE[2];
  const override = CLUB_FINANCE_OVERRIDES[club.clubId] || {};

  const board =
    Math.round(baseline.boardTransferAuthorisationGbp * scale.board * (override.boardMult || 1));
  const payroll = Math.round(
    baseline.playerPayrollBudgetGbp * scale.payroll * (override.payrollMult || 1)
  );
  const committed = Math.round(baseline.baselineCommittedPayrollGbp * scale.payroll * (override.payrollMult || 1) * 0.78);
  let dealBand = scaleBand(baseline.ordinarySingleDealBandGbp, scale.deal);
  if (override.dealMax != null) {
    dealBand = [dealBand[0], Math.min(dealBand[1] * (override.boardMult || 1.2), override.dealMax)];
  }

  const estimatedFields = rawBaseline.estimated
    ? [
        "operatingRevenue",
        "playerPayrollBudget",
        "boardTransferAuthorisation",
        "ordinarySingleDealBand",
        "roleWageBands",
      ]
    : ["boardTransferAuthorisation", "ordinarySingleDealBand"];

  return {
    clubId: club.clubId,
    leagueId,
    clubName: club.name,
    displayName: club.displayName ?? club.name,
    financialSeason: FINANCE_PROFILE_VERSION,
    sourceCurrency: rawBaseline.sourceCurrency,
    operatingRevenue: Math.round(baseline.operatingRevenueGbp * scale.board * (override.boardMult || 1)),
    playerPayrollBudget: payroll,
    baselineCommittedPayroll: committed,
    boardTransferAuthorisation: board,
    ordinarySingleDealBand: dealBand,
    exceptionalDealPolicy: override.dealMax ? "named-major-spender" : "ordinary",
    roleWageBands: scaleWageBands(baseline.roleWageBandsWeeklyGbp, scale.wage),
    topPlayerWageReference: Math.round(
      baseline.topPlayerWageReferenceWeeklyGbp * scale.wage * (override.payrollMult || 1)
    ),
    debtServiceReserve: Math.round(baseline.debtServiceReserveGbp * scale.board),
    existingTransferCommitments: 0,
    ownerFundingPolicy: "none",
    financialRuleAdapter: rawBaseline.financialRuleAdapter,
    sourceUrls: [],
    scope: "declared_simulation_allocation",
    confidence: override.confidence || rawBaseline.confidence || "low",
    estimatedFields,
    profileVersion: FINANCE_PROFILE_VERSION,
    fxVersion: FX_SNAPSHOT.version,
    estimated: Boolean(rawBaseline.estimated),
    mlsSeniorBudgetUsd: rawBaseline.mlsSeniorBudgetUsd ?? null,
    mlsMaxBudgetChargeUsd: rawBaseline.mlsMaxBudgetChargeUsd ?? null,
    notes: rawBaseline.notes || null,
  };
}

let _cache = null;

export function getAllClubFinanceProfiles() {
  if (_cache) return _cache;
  const map = new Map();
  for (const league of LEAGUES) {
    for (const club of league.clubs) {
      const profile = buildClubFinanceProfile(club, league);
      map.set(profile.clubId, profile);
    }
  }
  _cache = map;
  return map;
}

export function getClubFinanceProfile(clubId) {
  if (!clubId) return null;
  return getAllClubFinanceProfiles().get(clubId) || null;
}

export function financeCoverageReport() {
  const profiles = [...getAllClubFinanceProfiles().values()];
  const byLeague = {};
  const allClubIds = [];
  for (const league of LEAGUES) {
    const ids = league.clubs.map((c) => c.clubId);
    allClubIds.push(...ids);
    const missing = ids.filter((id) => !getClubFinanceProfile(id));
    const leagueProfiles = ids.map((id) => getClubFinanceProfile(id)).filter(Boolean);
    byLeague[league.leagueId] = {
      clubs: ids.length,
      profiles: ids.length - missing.length,
      missing,
      hasBaseline: Boolean(LEAGUE_FINANCE_BASELINES[league.leagueId]),
      estimated: leagueProfiles.filter((p) => p.estimated).length,
      sourced: leagueProfiles.filter((p) => !p.estimated).length,
    };
  }
  const idSet = new Set(allClubIds);
  const duplicateIds = allClubIds.filter((id, i) => allClubIds.indexOf(id) !== i);
  const unmatchedProfileIds = profiles
    .map((p) => p.clubId)
    .filter((id) => !idSet.has(id) && !String(id).startsWith("club:test:"));
  const estimatedCount = profiles.filter((p) => p.estimated).length;
  const sourcedCount = profiles.length - estimatedCount;
  return {
    profileVersion: FINANCE_PROFILE_VERSION,
    fxVersion: FX_SNAPSHOT.version,
    clubCount: profiles.length,
    leagueCount: LEAGUES.length,
    estimatedCount,
    sourcedCount,
    uniqueClubIds: idSet.size === allClubIds.length,
    duplicateIds: [...new Set(duplicateIds)],
    unmatchedProfileIds,
    leaguesMissingBaseline: LEAGUES.filter((l) => !LEAGUE_FINANCE_BASELINES[l.leagueId]).map(
      (l) => l.leagueId
    ),
    eliteFallbackOnMissing: false,
    byLeague,
    honesty:
      "Most board authorisations and wage bands are declared simulation allocations with estimatedFields — not verified private club budgets. Inferred transfer allocations must not be described as audited accounts.",
  };
}

/** Synthetic Serie B fixture for hard invariant tests (not a claim about every club). */
export const SYNTHETIC_SERIE_B_FIXTURE = {
  clubId: "club:test:synthetic-serie-b",
  leagueId: "league:italy-serie-b",
  remainingTransferAuthorisation: 6_000_000,
  ordinarySingleDealMaximum: 3_000_000,
  remainingAnnualPlayerWageHeadroom: 520_000,
  roleWeeklyBaseSalaryBand: [2000, 5000],
  remainingAnnualSquadCostHeadroom: 900_000,
};
