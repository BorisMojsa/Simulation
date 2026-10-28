import assert from "node:assert/strict";
import { buildAcademyBrowserFixture } from "./js/simulation/academyBrowserFixture.js";
import { promoteAcademyGraduateToFirstTeam } from "./js/simulation/playerDevelopment.js";
import {
  selectNextCareerAction,
  isOfferExecutable,
  isFreeAgent,
} from "./js/simulation/contractLifecycle.js";
import { findExecutableParentOffer } from "./js/simulation/academyLifecycle.js";
import { roundTripCareerSnapshot } from "./js/simulation/careerSnapshot.js";
import { getWorldState } from "./js/simulation/worldState.js";
import { exportClubFinanceState } from "./js/simulation/clubFinance.js";
import { renderTransferOffers } from "./js/ui/rendering.js";
import { FakeElement, installMinimalDom } from "./tests/helpers/minimalDom.mjs";

const { ensure } = installMinimalDom(["offer-template", "transfer-offers", "simulate-btn"]);
const offerTemplate = ensure("offer-template", "template");
offerTemplate.content = {
  cloneNode() {
    const root = new FakeElement("", "div");
    root.className = "offer-card";
    const details = new FakeElement("", "div");
    details.className = "details";
    const actions = new FakeElement("", "div");
    actions.className = "offer-actions";
    root.appendChild(details);
    root.appendChild(actions);
    root.querySelector = (sel) => {
      if (sel === ".details") return details;
      if (sel === ".offer-actions") return actions;
      return null;
    };
    return root;
  },
};

const fixture = buildAcademyBrowserFixture({ mode: "age21-final-offers" });
assert.equal(fixture.ok, true, fixture.reason);
const p = fixture.player;
const before = {
  age: p.age,
  history: p.seasons.length,
  offers: p.pendingOffers.map((o) => ({
    id: o.offerId,
    club: o.club,
    executable: isOfferExecutable(p, o).ok,
  })),
  status: p.academyLifecycle.status,
  parent: p.club.parentClub.name,
  parentButtonCondition: !p.suppressParentContractOffer,
  hasValidatedParentOffer: Boolean(findExecutableParentOffer(p)),
};
const financeBefore = JSON.stringify(exportClubFinanceState());
const result = promoteAcademyGraduateToFirstTeam(p, 75);
const q = roundTripCareerSnapshot({ player: p, world: getWorldState() }).player;

const tray = ensure("transfer-offers");
tray.children = [];
tray.innerHTML = "";
const simulate = ensure("simulate-btn");
const unexpectedAction = () => {
  throw new Error("Unexpected action during render");
};
renderTransferOffers({
  player: q,
  transferContainer: tray,
  simulateBtn: simulate,
  applyTransfer: unexpectedAction,
  finishOfferWindow: unexpectedAction,
  promoteToParentClub: unexpectedAction,
});
const nextAction = selectNextCareerAction(q);
const texts = tray.children.map((x) => x.textContent || "");
console.log(
  JSON.stringify(
    {
      before,
      result,
      afterRestore: {
        age: q.age,
        history: q.seasons.length,
        isAcademy: q.club?.isAcademy,
        freeAgent: isFreeAgent(q),
        pendingOffers: q.pendingOffers.length,
        persistedReviewOffers: q.academyLifecycle.pendingReview?.offers?.length,
        status: q.academyLifecycle.status,
        nextAction,
        mainSyncWouldDisableSimulate: !nextAction.canSimulate,
        parentShortcutShown: texts.some((t) => /Sign with /i.test(t)),
        declineShown: texts.some((t) => /Decline all and leave academy/i.test(t)),
        offerCards: q.pendingOffers.map((o) => o.club),
        renderedChildren: tray.children.map((x) => ({ tag: x.tagName, text: x.textContent })),
        financesUnchanged: financeBefore === JSON.stringify(exportClubFinanceState()),
      },
    },
    null,
    2
  )
);
