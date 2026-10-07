/**
 * Narrative copy for academy trial offers: how the door opened,
 * and what staff promise once you're in the room.
 */

import { pickRandom } from "../utils/helpers.js";

const ABROAD_ARRIVALS = [
  (ctx) =>
    `A scout on holiday in ${ctx.home} saw you in a kickabout that was never meant to be scouted. He filmed thirty seconds on his phone and sent it upstairs at ${ctx.club}.`,
  (ctx) =>
    `Your cousin's teammate knows a kit man at ${ctx.club}. One forwarded clip later, a trial invite lands in your inbox from ${ctx.nation}.`,
  (ctx) =>
    `A friend's uncle used to play reserves in ${ctx.nation}. He still has a number. He dials it for you, half joking — then ${ctx.club} call back.`,
  (ctx) =>
    `Your dad knows a travel agent who knows a physio who knows an academy coach at ${ctx.club}. The chain is ridiculous. The offer is real.`,
  (ctx) =>
    `An agent passing through ${ctx.home} for another deal watches you for twelve minutes and texts a contact at ${ctx.club}: "trust me on this one."`,
  (ctx) =>
    `A youth tournament abroad goes wrong for everyone else. You stay upright. A ${ctx.nation} coach from ${ctx.club} asks for your name before the bus leaves.`,
  (ctx) =>
    `You post a training clip with no caption. Someone at ${ctx.club} shares it in a staff group chat. Three days later they ask for a passport scan.`,
  (ctx) =>
    `A former school coach moved to ${ctx.nation} years ago. He still checks local games from ${ctx.home} online — and he still knows people at ${ctx.club}.`,
  (ctx) =>
    `Your mum's colleague has a partner who works hospitality on matchdays at ${ctx.club}. She slips your name into a conversation that should have been about catering.`,
  (ctx) =>
    `A rival academy in ${ctx.home} rejects you cold. Their rejection email somehow reaches a scout network linked to ${ctx.club}. Curiosity does the rest.`,
  (ctx) =>
    `You play a charity game for a local cause. A tourist in the crowd works recruitment for ${ctx.club}. He stays after everyone else leaves.`,
  (ctx) =>
    `A language-exchange host family in ${ctx.nation} takes you to a public session at ${ctx.club}. You keep the ball. Staff keep your number.`,
  (ctx) =>
    `An online gaming friend turns out to be the nephew of a ${ctx.club} youth coach. The joke about "send me a clip" stops being a joke.`,
  (ctx) =>
    `A sports teacher from ${ctx.nation} is seconded to a school in ${ctx.home} for a term. He watches PE like it's a trial. ${ctx.club} get a quiet tip.`,
  (ctx) =>
    `Your brother works a summer job near the training ground of ${ctx.club}. He talks too much in the canteen. Someone listens.`,
  (ctx) =>
    `A cancelled flight strands a ${ctx.nation} scout in your city. He kills time at a district final. You are the only reason he misses his rebooked connection happily.`,
  (ctx) =>
    `A futsal night with friends gets filmed by a stranger. The stranger works media for ${ctx.club}. The clip finds the right eyes.`,
  (ctx) =>
    `You share a hostel bunk with a trialist heading to ${ctx.club}. He gets cut. He leaves your name with the coach instead of bitterness.`,
  (ctx) =>
    `A diaspora club night in ${ctx.home} ends with a guest speaker from ${ctx.club}'s academy. He asks who the kid with the clean first touch was.`,
  (ctx) =>
    `An old family friend emigrated to ${ctx.nation} decades ago. He never made it as a player. Helping you into ${ctx.club} is the unfinished story he wanted.`,
  (ctx) =>
    `A referee who booked you twice still rates you. He mentions you to a mate who consults for ${ctx.club}. Odd route. Open door.`,
  (ctx) =>
    `Your grandparents holiday near the coast in ${ctx.nation}. They watch a public open day at ${ctx.club} and somehow talk staff into watching "their grandson's reel."`,
  (ctx) =>
    `A podcast guest from ${ctx.club} takes a random listener question. Your question isn't random — you attached a clip. They follow up off-air.`,
  (ctx) =>
    `A medical internship at a clinic treating ${ctx.club} youth players turns into a corridor conversation: "there's a kid from ${ctx.home} you should see."`,
];

const HOME_ARRIVALS = [
  (ctx) =>
    `${ctx.club} have been quietly logging your district games for months. This week they finally put a date on the calendar.`,
  (ctx) =>
    `A local derby performance puts your name on a whiteboard at ${ctx.club}. The call comes before the weekend is over.`,
  (ctx) =>
    `Someone from ${ctx.club} stood in the rain at your last cup tie and never introduced themselves — until today.`,
  (ctx) =>
    `Your current coach admits he tipped ${ctx.club} weeks ago. He just didn't want to get your hopes up early.`,
  (ctx) =>
    `${ctx.club} run a regional screening day. You were not the loudest invite. You are the one they ask to stay late.`,
  (ctx) =>
    `A parent in the stands films everything. One of those clips reaches a contact inside ${ctx.club}. They ask for a proper look.`,
  (ctx) =>
    `You already know kids who train at ${ctx.club}. This time the invite has your name on it.`,
  (ctx) =>
    `${ctx.club} lost a similar profile last window. Staff are under pressure to find the next one. Your file lands on the desk.`,
  (ctx) =>
    `A school tournament final in ${ctx.home} ends with a handshake from someone wearing ${ctx.club} kit under a coat.`,
  (ctx) =>
    `The academy at ${ctx.club} prefers quiet types who work. Your quiet season of graft finally gets noticed.`,
];

const PITCHES = [
  (ctx) =>
    `The head of academy sits you down and says first-team minutes are earned, not gifted — but they promise real pathway reviews every eight weeks at ${ctx.club}.`,
  (ctx) =>
    `Coaches talk about housing, schooling support, and a strength plan built around your age. ${ctx.club} want you sharp, not rushed.`,
  (ctx) =>
    `They sell the culture: early mornings, hard feedback, no shortcuts. In return, ${ctx.club} promise video analysis and a mentor from the senior group.`,
  (ctx) =>
    `A coach who used to play your position walks you through the building. He promises you will not get lost in a big squad at ${ctx.club}.`,
  (ctx) =>
    `"We don't collect prospects," they say. "${ctx.club} develop them." The sentence is rehearsed. The training pitch still looks serious.`,
  (ctx) =>
    `They highlight ${ctx.league}: competitive minutes, travel that teaches you, and a style that fits how you already play.`,
  (ctx) =>
    `Staff promise a clear position map for the next year — where you train, who you compete with, and how ${ctx.club} measure progress.`,
  (ctx) =>
    `The facilities pitch is short. The personality pitch is longer: they want leaders in small moments. ${ctx.club} think you fit that mould.`,
  (ctx) =>
    `They talk about patience with the body and impatience with bad habits. ${ctx.club} offer a nutrition plan and a coach who answers late texts.`,
  (ctx) =>
    `A senior coach promises honest minutes in internal games and no politics if you outgrow your age group at ${ctx.club}.`,
  (ctx) =>
    `They mention language support, family visits, and a buddy system — especially if the move feels big. ${ctx.club} have done this before.`,
  (ctx) =>
    `"Come here and you will be uncomfortable in the right ways," the coach says. ${ctx.club} sell growth, not comfort.`,
  (ctx) =>
    `They show you the board of graduates who made the jump. Not all of them. Enough of them. ${ctx.club} want your name in the next column.`,
  (ctx) =>
    `The promise is simple: daily standards, weekly feedback, monthly targets. ${ctx.club} keep paperwork boring so football can stay sharp.`,
  (ctx) =>
    `An academy goalkeeping / outfield specialist (depending on your role) will own your development block. ${ctx.club} do not want generic coaching.`,
  (ctx) =>
    `They talk about the city, the dressing room, and why kids stay. ${ctx.club} know retention is part of development.`,
  (ctx) =>
    `Coaches promise you will train with older boys when ready — not as a mascot, as a competitor. That is the ${ctx.club} line.`,
  (ctx) =>
    `They are blunt about competition for your spot. Then they promise the tools to win it. ${ctx.club} respect ambition that works.`,
];

const INTROS = [
  (ctx) =>
    `After the first calls, three academies stay on the line. Each path into the game looks different for ${ctx.name}.`,
  (ctx) =>
    `This week the noise becomes concrete. Three clubs want ${ctx.name} in their building — for reasons that are not identical.`,
  (ctx) =>
    `Somewhere between hope and logistics, three trial doors open for ${ctx.name}. Hear each story before you choose.`,
  (ctx) =>
    `${ctx.name}'s phone fills with names, trains, and promises. Three offers matter. The rest can wait.`,
  (ctx) =>
    `People talk about "big clubs" and "right clubs." For ${ctx.name}, three options arrive with their own reasons.`,
];

function fill(templates, ctx) {
  const fn = pickRandom(templates);
  return typeof fn === "function" ? fn(ctx) : fn;
}

export function academyNationOf(entry) {
  if (entry?.nation) return entry.nation;
  if (entry?.parentClub?.nation) return entry.parentClub.nation;
  const league = entry?.league || entry?.parentClub?.league || "";
  const dash = league.indexOf(" - ");
  if (dash > 0) return league.slice(0, dash).trim();
  return null;
}

export function buildAcademyIntro({ name, nationality }) {
  return fill(INTROS, { name, home: nationality });
}

export function buildAcademyOfferStories(academy, { name, nationality, isHome }) {
  const club = academy.parentClub?.displayName ?? academy.parentClub?.name ?? academy.displayName ?? academy.name;
  const nation = academyNationOf(academy) || "abroad";
  const league = academy.leagueDisplay ?? academy.league ?? "the league";
  const ctx = {
    name,
    home: nationality,
    club,
    nation,
    league,
  };
  return {
    arrivalStory: fill(isHome ? HOME_ARRIVALS : ABROAD_ARRIVALS, ctx),
    pitch: fill(PITCHES, ctx),
  };
}
