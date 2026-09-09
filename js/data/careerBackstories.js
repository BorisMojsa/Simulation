/**
 * Random origin stories shown after setup. Each receives { name, nationality }.
 * Keep tone grounded — youth football, family, local pitches, dreams.
 */
export const CAREER_BACKSTORIES = [
  ({ name, nationality }) =>
    `${name} grew up in ${nationality}, where the nearest full-size pitch was a bus ride away. A worn ball and a wall behind the garage were enough to start the obsession.`,
  ({ name, nationality }) =>
    `In a quiet ${nationality} town, ${name} was the kid who always carried a ball — to school, to shops, everywhere. Teachers learned to expect mud on the knees.`,
  ({ name, nationality }) =>
    `${name}'s first memories of football are crowded living-room kickabouts in ${nationality}, dodging furniture while commentating every goal in a whisper.`,
  ({ name, nationality }) =>
    `Raised in ${nationality}, ${name} spent summers in scratch matches that lasted until sunset. No refs, no lines — just first to five wins.`,
  ({ name, nationality }) =>
    `${name} was never the tallest in ${nationality} youth games, but had the habit of arriving a second earlier than anyone else to the ball.`,
  ({ name, nationality }) =>
    `A cousin's hand-me-down boots were ${name}'s first pair. In ${nationality}, that small detail felt like being handed a ticket somewhere bigger.`,
  ({ name, nationality }) =>
    `${name} used to watch late kick-offs on a crackling TV in ${nationality}, memorising celebrations and replaying them alone under streetlights.`,
  ({ name, nationality }) =>
    `School coaches in ${nationality} argued where ${name} should play. The player quietly preferred wherever the ball was most often.`,
  ({ name, nationality }) =>
    `${name}'s family couldn't always afford travel tournaments across ${nationality}. Local cups became the stage — and the grudge matches felt like finals.`,
  ({ name, nationality }) =>
    `On rainy ${nationality} evenings, ${name} trained alone: cones from water bottles, goals marked by jumpers, imagination doing the rest.`,
  ({ name, nationality }) =>
    `A PE teacher in ${nationality} slipped ${name} a trial flyer. It sat folded in a pocket for a week before courage won.`,
  ({ name, nationality }) =>
    `${name} grew up bilingual on the pitch in ${nationality} — football slang crossed borders faster than homework ever did.`,
  ({ name, nationality }) =>
    `The first time ${name} wore a proper kit in ${nationality}, the shirt hung loose. Pride made it fit anyway.`,
  ({ name, nationality }) =>
    `${name} was the player opponents marked tight in ${nationality} youth leagues — not always because of skill, sometimes because of sheer stubborn runs.`,
  ({ name, nationality }) =>
    `In ${nationality}, ${name}'s grandparents kept every newspaper clipping, even when the photo was just a blurry squad line.`,
  ({ name, nationality }) =>
    `${name} learned early in ${nationality}: a bad touch gets laughed off in training; a brave one gets remembered.`,
  ({ name, nationality }) =>
    `Futsal halls in ${nationality} taught ${name} close control. The transition to grass felt like being given more oxygen.`,
  ({ name, nationality }) =>
    `${name} once missed a decisive penalty in a ${nationality} school final. The walk home lasted hours — and built something harder than pride.`,
  ({ name, nationality }) =>
    `Volunteer coaches in ${nationality} rotated yearly; ${name} stayed constant, collecting drills like other kids collected cards.`,
  ({ name, nationality }) =>
    `${name}'s room in ${nationality} had posters of idols and a calendar circled with trial dates that kept moving — until one didn't.`,
  ({ name, nationality }) =>
    `Playing up an age group in ${nationality}, ${name} discovered fear and adrenaline taste almost the same.`,
  ({ name, nationality }) =>
    `${name} wasn't the captain on paper in ${nationality}, but teammates still looked over before big moments.`,
  ({ name, nationality }) =>
    `A harsh winter in ${nationality} froze the local pitch. ${name} trained in hallways instead — touch drills, no excuses.`,
  ({ name, nationality }) =>
    `${name} wrote tactics in a school notebook: arrows, formations, dreams. Teachers thought it was maths.`,
  ({ name, nationality }) =>
    `In ${nationality}, ${name}'s first "agent" was an uncle with a loud voice and a second-hand car for away games.`,
  ({ name, nationality }) =>
    `${name} celebrated goals quietly at first — then learned in ${nationality} that joy is part of the work too.`,
  ({ name, nationality }) =>
    `A torn cheap boot didn't stop ${name} finishing a cup game in ${nationality}. Tape, grit, and a sore toe wrote the story.`,
  ({ name, nationality }) =>
    `${name} watched seniors in ${nationality}'s regional league and clocked their habits: how they warmed up, how they spoke to refs.`,
  ({ name, nationality }) =>
    `Social media highlights from ${nationality} youth football made ${name} both inspired and restless — comparison became fuel.`,
  ({ name, nationality }) =>
    `${name} once played a friendly in ${nationality} against a side nobody recognised. They won 6-0; humility arrived the next morning in training.`,
  ({ name, nationality }) =>
    `Long coach journeys across ${nationality} taught ${name} to sleep anywhere and wake up ready to sprint.`,
  ({ name, nationality }) =>
    `${name}'s parents in ${nationality} balanced shifts and petrol money so trials stayed possible. That weight sits on every good pass.`,
  ({ name, nationality }) =>
    `In ${nationality}, ${name} was told to "play simple." The advice clashed with instinct — and both were sometimes right.`,
  ({ name, nationality }) =>
    `${name} kept a ball under the desk during online school in ${nationality}. Multitasking started early.`,
  ({ name, nationality }) =>
    `A dog once stole ${name}'s match ball in ${nationality}. The chase went viral locally; the club scout saw the clip.`,
  ({ name, nationality }) =>
    `${name} learned to read the game from a grandparent who never kicked a ball but never missed a pattern on TV.`,
  ({ name, nationality }) =>
    `Beach football in ${nationality} gave ${name} ankles that could adjust to anything — except maybe studying for exams.`,
  ({ name, nationality }) =>
    `${name} was the substitute who warmed up like a starter. In ${nationality}, attitude became a reputation.`,
  ({ name, nationality }) =>
    `A red card in a ${nationality} derby youth game haunted ${name} for months — then became a lesson about timing tackles.`,
  ({ name, nationality }) =>
    `${name} practised set-pieces alone in ${nationality}, counting steps until muscle memory replaced doubt.`,
  ({ name, nationality }) =>
    `In ${nationality}, ${name}'s club shared kits between age groups. Number 7 one year, 19 the next — identity stayed in the feet.`,
  ({ name, nationality }) =>
    `${name} once played goalkeeper in a pinch in ${nationality}. The gloves smelled wrong, but the hands learned something new.`,
  ({ name, nationality }) =>
    `Nutrition was rice and whatever was on sale — ${nationality} wasn't a performance-kitchen household. Hunger was literal and metaphorical.`,
  ({ name, nationality }) =>
    `${name} memorised a pro player's interview about rejection. In ${nationality}, those words replayed on bad trial days.`,
  ({ name, nationality }) =>
    `A local journalist in ${nationality} wrote half a paragraph about ${name}. The clipping still lives in a drawer.`,
  ({ name, nationality }) =>
    `${name} chose football over a safer hobby in ${nationality}. Friends drifted; the pitch didn't.`,
  ({ name, nationality }) =>
    `Thunder stopped a final in ${nationality}. ${name} stood under shelter, already replaying the moment play would resume.`,
  ({ name, nationality }) =>
    `${name} speaks softly off the pitch in ${nationality}. On it, volume comes through runs and pressing.`,
  ({ name, nationality }) =>
    `The first professional academy letter addressed to ${name} in ${nationality} had a typo in the surname. It was framed anyway.`,
  ({ name, nationality }) =>
    `${name} knows ${nationality}'s youth pyramid is a lottery. This chapter starts with three doors — only one leads forward first.`,
  ({ name, nationality }) =>
    `Tonight, ${name} leaves the small-pitch stories of ${nationality} for a bigger notebook. The pen is heavy — but the boots are ready.`,
];

export function pickRandomBackstory(ctx) {
  const fn = CAREER_BACKSTORIES[Math.floor(Math.random() * CAREER_BACKSTORIES.length)];
  return fn(ctx);
}
