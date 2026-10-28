/**
 * Deterministic academy desk fixtures for browser acceptance (Fix 04).
 *
 * Modes:
 * - continue-empty (default): Aston Villa Academy age 17, opening done, empty review
 *   forced via offer provider injection seam (controlled empty executable set).
 * - continue-offers: age 17 with a persisted pending review of real first-pro offers.
 * - age20-final-empty: age 20 so next period reaches 21 with forced empty final review.
 * - age21-final-offers: already 21 with pending final review offers (no year added).
 * - age21-legacy: over-age enrolled academy with no pending review (exit on simulate).
 * - age35-legacy: controlled age-35 academy (same exit path).
 * - pending-review: age 18 with a frozen pending review identity for restore tests.
 */
import { ACADEMY_POOL } from "../data/leagues.js";
import {
  createPlayerIdentity,
  finalizeAcademyPlayer,
  applySkipOpeningDevelopment,
} from "./playerDevelopment.js";
import { buildNarrativeAcademySeason } from "./narrativeAcademySeason.js";
import { createWorldState, setWorldState } from "./worldState.js";
import { resetClubFinanceLedgers } from "./clubFinance.js";
import { reseedCareerRng } from "./rng.js";
import { ensureTransferSave } from "./transferMigration.js";
import { ensureContractAuthority, selectNextCareerAction } from "./contractLifecycle.js";
import {
  ensureAcademyLifecycle,
  buildAndPersistAcademyReview,
  ACADEMY_EXIT_AGE,
} from "./academyLifecycle.js";
import { buildFirstProContractDecision } from "./proContractOffers.js";

export const ACADEMY_FIXTURE = {
  careerId: "academy-ui-fixture-v1",
  seed: 42,
  name: "Academy Fixture",
  nationality: "England",
  position: "RW",
  age: 17,
  startYear: 2026,
  parentClubId: "club:england:aston-villa",
};

/** Career id used with empty-offer provider for deterministic zero interest. */
export const ACADEMY_EMPTY_REVIEW_CAREER_ID = "academy-ui-empty-review-1";

function findAcademy(parentClubId) {
  return ACADEMY_POOL.find((a) => a.parentClub?.clubId === parentClubId);
}

/** Controlled empty first-pro decision — not a natural career outcome. */
export function emptyOfferProvider(player) {
  const parent = player.club?.parentClub
    ? { name: player.club.parentClub.name, displayName: player.club.parentClub.displayName }
    : null;
  return {
    parentOffers: false,
    parent,
    offers: [],
    verdict: {
      headline: "No professional offer yet",
      lead: "Controlled empty review for academy acceptance.",
    },
    rating: player.rating,
    rejectionLog: [{ clubId: "controlled", reasons: ["fixture-empty-provider"] }],
    emptyOffers: true,
  };
}

function baseAcademyPlayer(cfg) {
  resetClubFinanceLedgers();
  reseedCareerRng(cfg.seed);
  setWorldState(createWorldState({ startYear: cfg.startYear }));

  const academy = findAcademy(cfg.parentClubId);
  if (!academy) return { ok: false, reason: "academy-missing", player: null };

  const player = createPlayerIdentity({
    name: cfg.name,
    nationality: cfg.nationality,
    position: cfg.position,
    age: cfg.age,
  });
  player.startYear = cfg.startYear;
  player.careerId = cfg.careerId;
  finalizeAcademyPlayer(player, academy);
  applySkipOpeningDevelopment(player);
  // createPlayerIdentity clamps start age to ≤19; fixtures may need over-age enrollment.
  player.age = cfg.age;
  const ratingStart = player.rating;
  const year = buildNarrativeAcademySeason(player, ratingStart, player.rating, {
    seasonNumber: 1,
    year: cfg.startYear,
    academyPeriod: false,
  });
  player.seasons = [year];
  player.careerTotals = {
    matches: year.matches,
    goals: year.goals,
    assists: year.assists,
    cleanSheets: year.cleanSheets,
  };
  player.academyCareerTotals = { ...player.careerTotals };
  player.careerIntroComplete = true;
  player.suppressParentContractOffer = false;
  player.pendingOffers = [];
  ensureContractAuthority(player);
  ensureAcademyLifecycle(player);
  player.academyLifecycle.periodCount = 1;
  player.academyLifecycle.status = "enrolled";
  ensureTransferSave(player);
  return { ok: true, player, academy };
}

/**
 * Persist an empty pending review without calling the offer builder (controlled).
 */
function persistEmptyReview(player, { isFinal = false } = {}) {
  const life = ensureAcademyLifecycle(player);
  const reviewId = `academy-review:fixture-empty:${isFinal ? "final" : "mid"}`;
  const review = {
    reviewId,
    isFinal,
    createdAtSeasonCount: player.seasons?.length ?? 0,
    createdAtAge: player.age,
    offerCount: 0,
    emptyOffers: true,
    verdict: {
      headline: "No professional offer yet",
      lead: "Controlled empty academy review fixture.",
    },
    offers: [],
    rejectionLog: [{ reasons: ["fixture-empty-provider"] }],
    consumedOfferIds: [],
  };
  // Empty reviews are normally cleared immediately by policy; for the
  // continue-empty desk we want enrolled + no offers so simulate is enabled.
  life.pendingReviewId = null;
  life.pendingReview = null;
  life.status = "enrolled";
  player.pendingOffers = [];
  player._academyFixtureEmptyProvider = true;
  return review;
}

export function buildAcademyBrowserFixture(opts = {}) {
  const mode = opts.mode || "continue-empty";
  const cfg = {
    ...ACADEMY_FIXTURE,
    ...(opts.cfg || {}),
    careerId: opts.careerId || ACADEMY_FIXTURE.careerId,
  };

  if (mode === "continue-empty" || mode === "empty" || mode === "") {
    cfg.careerId = opts.careerId || ACADEMY_EMPTY_REVIEW_CAREER_ID;
    cfg.age = 17;
    const built = baseAcademyPlayer(cfg);
    if (!built.ok) return built;
    persistEmptyReview(built.player, { isFinal: false });
    // Controlled empty offer provider — production review path still runs.
    built.player.academyOfferProvider = emptyOfferProvider;
    built.player.academyFixtureMode = "continue-empty";
    return {
      ok: true,
      mode: "continue-empty",
      player: built.player,
      nextAction: selectNextCareerAction(built.player),
      controlled: {
        emptyReviewProvider: true,
        provider: "player.academyOfferProvider",
      },
    };
  }

  if (mode === "continue-offers" || mode === "offers") {
    cfg.age = 17;
    const built = baseAcademyPlayer(cfg);
    if (!built.ok) return built;
    const review = buildAndPersistAcademyReview(built.player, { isFinal: false });
    if (review.emptyOffers) {
      // Try once more with a higher-rated player to get real offers.
      built.player.rating = Math.max(built.player.rating, 68);
      if (built.player.attributes) {
        for (const k of Object.keys(built.player.attributes)) {
          built.player.attributes[k] = Math.max(built.player.attributes[k], 66);
        }
      }
      const retry = buildAndPersistAcademyReview(built.player, { isFinal: false });
      if (retry.emptyOffers) {
        return { ok: false, reason: "no-executable-offers-for-fixture", player: built.player };
      }
    }
    return {
      ok: true,
      mode: "continue-offers",
      player: built.player,
      nextAction: selectNextCareerAction(built.player),
      reviewId: built.player.academyLifecycle.pendingReviewId,
    };
  }

  if (mode === "age20-final-empty") {
    cfg.age = 20;
    cfg.careerId = opts.careerId || ACADEMY_EMPTY_REVIEW_CAREER_ID;
    const built = baseAcademyPlayer(cfg);
    if (!built.ok) return built;
    built.player.academyFixtureMode = "final-empty";
    built.player.academyOfferProvider = emptyOfferProvider;
    persistEmptyReview(built.player, { isFinal: false });
    return {
      ok: true,
      mode: "age20-final-empty",
      player: built.player,
      nextAction: selectNextCareerAction(built.player),
      controlled: {
        nextPeriodReachesExit: ACADEMY_EXIT_AGE,
        emptyReviewProvider: true,
        provider: "player.academyOfferProvider",
      },
    };
  }

  if (mode === "age21-final-offers" || mode === "final-offers") {
    cfg.age = 21;
    const built = baseAcademyPlayer(cfg);
    if (!built.ok) return built;
    built.player.rating = Math.max(built.player.rating, 68);
    const review = buildAndPersistAcademyReview(built.player, { isFinal: true });
    if (review.emptyOffers) {
      return { ok: false, reason: "no-final-offers-for-fixture", player: built.player };
    }
    return {
      ok: true,
      mode: "age21-final-offers",
      player: built.player,
      nextAction: selectNextCareerAction(built.player),
      reviewId: built.player.academyLifecycle.pendingReviewId,
    };
  }

  if (mode === "age21-legacy" || mode === "legacy-21") {
    cfg.age = 21;
    const built = baseAcademyPlayer(cfg);
    if (!built.ok) return built;
    built.player.suppressParentContractOffer = true;
    built.player.academyLifecycle.status = "enrolled";
    return {
      ok: true,
      mode: "age21-legacy",
      player: built.player,
      nextAction: selectNextCareerAction(built.player),
    };
  }

  if (mode === "age35-legacy" || mode === "legacy-35") {
    cfg.age = 35;
    const built = baseAcademyPlayer(cfg);
    if (!built.ok) return built;
    built.player.suppressParentContractOffer = true;
    return {
      ok: true,
      mode: "age35-legacy",
      player: built.player,
      nextAction: selectNextCareerAction(built.player),
    };
  }

  if (mode === "pending-review") {
    cfg.age = 18;
    const built = baseAcademyPlayer(cfg);
    if (!built.ok) return built;
    built.player.rating = Math.max(built.player.rating, 68);
    const review = buildAndPersistAcademyReview(built.player, { isFinal: false });
    if (review.emptyOffers) {
      return { ok: false, reason: "no-pending-offers-for-fixture", player: built.player };
    }
    return {
      ok: true,
      mode: "pending-review",
      player: built.player,
      reviewId: review.reviewId,
      nextAction: selectNextCareerAction(built.player),
    };
  }

  return { ok: false, reason: `unknown-mode:${mode}`, player: null };
}
