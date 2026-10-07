import { clamp, pickRandom, randFloat, randInt, slugify } from "../utils/helpers.js";

export function calculateContractLength(age, rating, potential, performanceScore) {
  if (age <= 20 && potential >= 85) {
    return randInt(4, 5);
  }

  if (age <= 24 && potential >= 80) {
    return randInt(3, 5);
  }

  if (age <= 28) {
    if (rating >= 85 || potential >= 85) {
      return randInt(3, 5);
    }
    return randInt(2, 4);
  }

  if (age <= 32) {
    if (rating >= 85 && performanceScore > 80) {
      return randInt(2, 4);
    }
    return randInt(2, 3);
  }

  if (age <= 35) {
    if (rating >= 80 && performanceScore > 75) {
      return randInt(1, 3);
    }
    return randInt(1, 2);
  }

  if (age <= 38) {
    if (rating >= 80 && performanceScore > 80) {
      return randInt(1, 2);
    }
    return 1;
  }

  return 1;
}

export function financialTierRequirement(rating) {
  if (rating >= 90) return 5;
  if (rating >= 84) return 4;
  if (rating >= 76) return 3;
  if (rating >= 68) return 2;
  return 1;
}

export function calculateRenewalInterest(player, performanceScore) {
  let interest = (performanceScore - 50) / 50;
  interest += (player.rating - 60) / 100;

  if (player.age >= 35) {
    interest -= (player.age - 34) * 0.1;
  }

  const recentSeasons = player.seasons.slice(-3);
  if (recentSeasons.length > 0) {
    const avgRecentPerformance =
      recentSeasons.reduce((sum, season) => {
        const estPerf = Math.min(100, season.goals * 5 + season.assists * 3 + season.matches * 0.5);
        return sum + estPerf;
      }, 0) / recentSeasons.length;
    interest += (avgRecentPerformance - 60) / 150;
  }

  interest = clamp(interest, 0, 1);
  return interest > 0.3 ? interest : 0;
}

export function generateRenewalOffer(player, performanceScore, leagueLookup) {
  if (!player.club || player.club.isAcademy) return null;

  const league = leagueLookup.get(player.club.league);
  if (!league) return null;

  const clubFinancial = player.club.financialTier || 2;
  const wageBase = player.rating * 650 * (1 + clubFinancial * 0.22);

  const wageIncrease = performanceScore > 80 ? randFloat(0.05, 0.15) : 0;
  const wage = Math.round(Math.max(1200, wageBase * (1 + wageIncrease) + randFloat(-1800, 5200)) / 100) * 100;

  const contractYears = calculateContractLength(player.age, player.rating, player.potential, performanceScore);

  return {
    club: player.club.name,
    clubDisplay: player.club.displayName ?? player.club.name,
    badge: player.club.badge,
    league: player.club.league,
    leagueDisplay: player.club.leagueDisplay ?? league.displayName ?? player.club.league,
    leagueSlug: league.slug,
    tier: player.club.tier,
    financialTier: clubFinancial,
    wage,
    transferFee: 0,
    contractYears,
    message: `${player.club.displayName ?? player.club.name} want to extend your contract.`,
    isRenewal: true,
  };
}

function tierFromRating(rating) {
  if (rating >= 82) return 5;
  if (rating >= 76) return 4;
  if (rating >= 70) return 3;
  if (rating >= 60) return 2;
  return 1;
}

function weightedLeague({ performanceScore, player, leagues }) {
  const ratingTier = tierFromRating(player.rating);
  const performanceBias = clamp((performanceScore - 65) / 12, -2, 3);
  const currentLeagueName = player.club?.league;

  const weights = leagues
    .map((league) => {
      let weight = league.financialPower * 2.4 + league.tier * 3;
      weight -= Math.max(0, ratingTier - league.tier) * 3;
      weight += performanceBias;
      if (league.name === currentLeagueName) weight += 1.5;
      if (performanceScore < 55 && league.tier > ratingTier) {
        weight -= 1.5;
      }
      return { league, weight: Math.max(0.3, weight) };
    })
    .filter(({ weight }) => weight > 0);

  const pool = weights.length ? weights : leagues.map((league) => ({ league, weight: 1 }));
  const total = pool.reduce((acc, item) => acc + item.weight, 0);
  let roll = Math.random() * total;
  for (const { league, weight } of pool) {
    if (roll < weight) return league;
    roll -= weight;
  }
  return pickRandom(leagues);
}

function clubTransferBudget(financialTier, leagueTier) {
  const ft = clamp(Math.round(financialTier || 1), 1, 5);
  const lt = clamp(Math.round(leagueTier || 1), 1, 5);
  const baseByFinancial = { 1: 8_000_000, 2: 20_000_000, 3: 45_000_000, 4: 75_000_000, 5: 130_000_000 };
  const tierMultiplier = { 1: 0.8, 2: 0.9, 3: 1.0, 4: 1.15, 5: 1.35 };
  const jitter = randFloat(0.9, 1.1);
  return Math.round(baseByFinancial[ft] * tierMultiplier[lt] * jitter);
}

function randomFeeFromValuation(valuation, maxBudget) {
  const cappedMax = Math.max(500_000, Math.floor(maxBudget));
  const low = clamp(valuation * 0.9, 500_000, cappedMax);
  const high = clamp(valuation * 1.1, low, cappedMax);
  const fee = randFloat(low, high);
  return Math.round(fee / 250_000) * 250_000;
}

function estimateTransferFee({ leagueTier, financialTier, maxBudget, player }) {
  const clubBudget = typeof maxBudget === "number" ? maxBudget : clubTransferBudget(financialTier, leagueTier);

  const rating = clamp(player.rating, 50, 95);
  const norm = clamp((rating - 60) / 34, 0, 1);
  const baseValuation = 2_000_000 + Math.pow(norm, 2.25) * 135_000_000;

  const age = player.age;
  let ageEffect;
  if (age <= 17) ageEffect = 2.7;
  else if (age <= 18) ageEffect = 2.4;
  else if (age <= 19) ageEffect = 2.2;
  else if (age <= 20) ageEffect = 2.0;
  else if (age <= 21) ageEffect = 1.75;
  else if (age <= 22) ageEffect = 1.5;
  else if (age <= 23) ageEffect = 1.2;
  else if (age <= 24) ageEffect = 1.0;
  else if (age <= 25) ageEffect = 0.96;
  else if (age <= 26) ageEffect = 0.94;
  else if (age <= 27) ageEffect = 0.92;
  else if (age <= 28) ageEffect = 0.90;
  else if (age <= 29) ageEffect = 0.88;
  else if (age <= 30) ageEffect = 0.86;
  else if (age <= 31) ageEffect = 0.83;
  else if (age <= 32) ageEffect = 0.80;
  else if (age <= 33) ageEffect = 0.76;
  else if (age <= 34) ageEffect = 0.72;
  else ageEffect = 0.68;

  const youthWeight = clamp((rating - 60) / 15, 0, 1);
  const primeWeight = clamp((rating - 65) / 25, 0, 1);
  const weight = age <= 24 ? youthWeight : primeWeight;
  const ageMultiplier = 1 + (ageEffect - 1) * weight;

  const envFactor = clamp(0.96 + leagueTier * 0.012 + financialTier * 0.018, 0.95, 1.1);
  const randomFactor = randFloat(0.95, 1.1);
  let valuation = baseValuation * ageMultiplier * envFactor * randomFactor;

  function sanityCapByRating(ratingValue) {
    if (ratingValue < 60) return 8_000_000;
    if (ratingValue < 66) return 25_000_000;
    if (ratingValue < 71) return 45_000_000;
    if (ratingValue < 76) return 70_000_000;
    if (ratingValue < 81) return 120_000_000;
    if (ratingValue < 86) return 170_000_000;
    if (ratingValue < 91) return 210_000_000;
    return 240_000_000;
  }

  const ratingCap = sanityCapByRating(rating);
  valuation = clamp(valuation, 500_000, Math.min(240_000_000, ratingCap));
  return randomFeeFromValuation(valuation, Math.min(clubBudget, ratingCap));
}

function buildOfferMessage(league, club, playerPosition) {
  const hooks = [
    `promise you regular ${playerPosition} minutes`,
    "are building an exciting young core",
    "want you to lead their project",
    "offer top-class facilities",
    "can guarantee European nights soon",
    "see you as a franchise player",
  ];

  const clubName = club.displayName ?? club.name;
  return `${clubName} (${league.displayName ?? league.name}) ${pickRandom(hooks)}.`;
}

export function generateTransferOffers(performanceScore, player, leagues, leagueLookup, avgMatchRating = null) {
  const offers = [];
  const seen = new Set();
  const currentSeason = player.seasons.length;
  const formBoost =
    avgMatchRating == null
      ? 0
      : avgMatchRating >= 8.0
        ? 18
        : avgMatchRating >= 7.5
          ? 10
          : avgMatchRating >= 7.0
            ? 4
            : avgMatchRating < 6.3
              ? -14
              : avgMatchRating < 6.7
                ? -6
                : 0;
  const effectivePerf = performanceScore + formBoost;

  if (player.contractEndSeason !== null && currentSeason >= player.contractEndSeason) {
    const renewalInterest = calculateRenewalInterest(player, effectivePerf);
    if (renewalInterest > 0) {
      const renewalOffer = generateRenewalOffer(player, effectivePerf, leagueLookup);
      if (renewalOffer) {
        offers.push(renewalOffer);
        seen.add(`${player.club.league}:${player.club.name}`);
      }
    }
  }

  if (player.club?.isAcademy && player.club.parentClub) {
    const parent = player.club.parentClub;
    const parentLeague = leagueLookup.get(parent.league);
    const parentSlug = parentLeague ? parentLeague.slug : slugify(parent.name);
    const parentKey = `${parentSlug}:${slugify(parent.name)}`;
    const wage = Math.round(Math.max(800, player.rating * 240 + randFloat(-600, 1200)) / 100) * 100;
    const contractYears = calculateContractLength(player.age, player.rating, player.potential, 75);
    offers.push({
      club: parent.name,
      clubDisplay: parent.displayName ?? parent.name,
      badge: parent.badge,
      league: parent.league,
      leagueDisplay: parent.leagueDisplay ?? parentLeague?.displayName ?? parent.league,
      leagueSlug: parentSlug,
      tier: parent.tier,
      financialTier: parent.financialTier,
      wage,
      transferFee: 0,
      contractYears,
      message: `${parent.displayName ?? parent.name} are ready to offer you your first professional contract.`,
      isParentOffer: true,
    });
    seen.add(parentKey);
  }

  const interestScore = effectivePerf + player.rating * 1.5;
  let chance = Math.min(0.92, 0.22 + interestScore / 240);
  if (effectivePerf < 55) chance *= 0.6;
  if (effectivePerf < 45) chance *= 0.35;
  if (avgMatchRating != null && avgMatchRating >= 7.8) chance = Math.min(0.96, chance + 0.12);
  if (Math.random() > chance) {
    return offers;
  }

  const baseSlots = Math.min(4, 1 + Math.floor(player.rating / 20));
  const performanceMultiplier =
    effectivePerf > 95 ? 1.7 : effectivePerf > 80 ? 1.3 : effectivePerf < 55 ? 0.6 : 1;
  const formSlots =
    avgMatchRating != null && avgMatchRating >= 8.0 ? 1 : avgMatchRating != null && avgMatchRating >= 7.5 ? 0.5 : 0;

  const targetOffers = Math.max(
    offers.length || 1,
    Math.round(baseSlots * performanceMultiplier + formSlots)
  );
  let safety = 0;

  while (offers.length < targetOffers && safety < 160) {
    safety += 1;
    const league = weightedLeague({ performanceScore: effectivePerf, player, leagues });
    const club = pickRandom(league.clubs);
    if (!club) continue;

    const key = `${league.slug}:${club.slug}`;
    if (seen.has(key) || club.name === player.club.name) continue;

    const clubFinancial = club.financialTier ?? league.financialPower;
    const requiredTier = financialTierRequirement(player.rating);
    const ratingTier = tierFromRating(player.rating);

    // Hot form opens doors at richer clubs
    const formTierRelax =
      avgMatchRating != null && avgMatchRating >= 7.8 ? 1 : avgMatchRating != null && avgMatchRating >= 7.4 ? 0 : 0;

    if (clubFinancial < requiredTier - formTierRelax) continue;
    if (league.tier < Math.max(3, ratingTier - 1 - (avgMatchRating >= 7.6 ? 1 : 0))) continue;

    if (effectivePerf < 50 && league.tier >= ratingTier + 1 && Math.random() > 0.35) {
      continue;
    }

    const wageBase = player.rating * 650 * (1 + clubFinancial * 0.22);
    const wage = Math.round(Math.max(1200, wageBase + randFloat(-1800, 5200)) / 100) * 100;

    const clubBudget = clubTransferBudget(clubFinancial, league.tier);
    const transferFee = estimateTransferFee({
      leagueTier: league.tier,
      financialTier: clubFinancial,
      maxBudget: clubBudget,
      player,
    });

    if (transferFee > clubBudget) continue;

    const contractYears = calculateContractLength(player.age, player.rating, player.potential, effectivePerf);

    seen.add(key);
    offers.push({
      club: club.name,
      clubDisplay: club.displayName ?? club.name,
      badge: club.badge,
      league: league.name,
      leagueDisplay: league.displayName ?? league.name,
      leagueSlug: league.slug,
      tier: league.tier,
      financialTier: clubFinancial,
      wage,
      transferFee,
      contractYears,
      message: buildOfferMessage(league, club, player.position),
    });
  }

  return offers;
}
