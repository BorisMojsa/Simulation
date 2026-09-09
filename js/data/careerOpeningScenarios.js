/**
 * Interactive moments for the narrative academy year. Each scenario:
 * - setup: scene text
 * - choices: { label, minDelta, maxDelta } overall rating change (rolled per pick)
 * - outcomes: per-choice array of possible result lines (one picked at random)
 */

export function scenarioGroupForPosition(position) {
  if (position === "GK") return "GK";
  if (["RB", "LB", "CB", "CDM"].includes(position)) return "DEF";
  if (["RW", "LW"].includes(position)) return "WING";
  if (position === "ST") return "ST";
  return "MID";
}

export function pickScenariosForPosition(position, count = 3) {
  const key = scenarioGroupForPosition(position);
  const pool = OPENING_SCENARIOS[key] ?? OPENING_SCENARIOS.MID;
  if (!pool?.length) return [];
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(count, copy.length));
}

const OPENING_SCENARIOS = {
  GK: [
    {
      setup:
        "Cup semi-final, 118th minute. A lofted ball drops toward the far top corner. You're off your line — commit now or hold?",
      choices: [
        { label: "Fly and punch aggressively", minDelta: -2, maxDelta: 4 },
        { label: "Hold the line and narrow the angle", minDelta: -1, maxDelta: 3 },
        { label: "Call a defender to head clear", minDelta: -2, maxDelta: 2 },
      ],
      outcomes: [
        ["You reach it — chaos in the box but the ball's gone.", "A clean punch sparks a counter. The bench erupts."],
        ["You stand tall; the shot whistles past the post.", "They chip you — but it lands on the roof of the net."],
        ["Your shout clears traffic; the header sails wide.", "Miscommunication — a glancing touch nearly sneaks in."],
      ],
    },
    {
      setup:
        "A back-pass under pressure arrives short. A striker closes fast. Do you clear long, try to dribble, or smash it first time?",
      choices: [
        { label: "Clear into the stands if needed", minDelta: -1, maxDelta: 2 },
        { label: "Take a touch and beat the press", minDelta: -3, maxDelta: 4 },
        { label: "First-time pass to full-back", minDelta: -2, maxDelta: 3 },
      ],
      outcomes: [
        ["Safety first — groans, but no goal.", "The clearance finds touch. Reset."],
        ["You glide past — composure highlights reel.", "A toe-poke wins the duel. Heart in mouth."],
        ["Crisp ball out — attack builds.", "It's under-hit; you recover with a slide."],
      ],
    },
    {
      setup: "Penalty in a derby youth match. You've studied this taker. Dive early, wait, or stand up and react?",
      choices: [
        { label: "Guess left early", minDelta: -2, maxDelta: 4 },
        { label: "Wait and react late", minDelta: -1, maxDelta: 3 },
        { label: "Stay big and central", minDelta: -2, maxDelta: 3 },
      ],
      outcomes: [
        ["Correct — you bat it away.", "Wrong way — net ripples."],
        ["Strong hand — rebound cleared.", "Power beats you low."],
        ["They panic and lift it over.", "Placement beats size."],
      ],
    },
    {
      setup:
        "Your defence steps high. A ball over the top sends their striker through. Rush out to sweep or hold the box?",
      choices: [
        { label: "Sprint out — sweeper-keeper", minDelta: -3, maxDelta: 4 },
        { label: "Hold — trust recovery runs", minDelta: -2, maxDelta: 2 },
        { label: "Shout and show for a square ball", minDelta: -2, maxDelta: 3 },
      ],
      outcomes: [
        ["You toe it away — textbook.", "A chip floats over you."],
        ["A last-ditch tackle saves you.", "They finish across goal."],
        ["They hesitate; your defence arrives.", "The pass never comes — shot from distance."],
      ],
    },
    {
      setup: "Set piece. Wall argues about the jump. You want one more on the post — or reorganise the wall entirely?",
      choices: [
        { label: "Add a body on the post", minDelta: -1, maxDelta: 3 },
        { label: "Rebuild the wall wider", minDelta: -1, maxDelta: 2 },
        { label: "Trust the wall — focus on trajectory", minDelta: -2, maxDelta: 4 },
      ],
      outcomes: [
        ["The post-clatter saves a certain goal.", "The gap was still there — top bins."],
        ["The wider wall blocks the angle.", "They go under — you gather."],
        ["You fly — fingertip over.", "The knuckleball dips under the bar."],
      ],
    },
    {
      setup:
        "Coach wants you to start attacks quickly. Distribution: long diagonal to the winger, short to the #6, or clipped to the #9?",
      choices: [
        { label: "Long diagonal", minDelta: -2, maxDelta: 4 },
        { label: "Short to the six", minDelta: -1, maxDelta: 3 },
        { label: "Clip toward the striker", minDelta: -2, maxDelta: 3 },
      ],
      outcomes: [
        ["Perfect weight — break on.", "Overhit — throw-in."],
        ["Tempo control — they love it.", "Pressed — hurried clearance."],
        ["Striker brings it down — half chance.", "Cut out at the edge of the box."],
      ],
    },
    {
      setup: "Training drill: reflex saves from six yards. Coach adds a distraction — crowd noise tape. Embrace it or ask to focus quietly?",
      choices: [
        { label: "Crank the noise — embrace chaos", minDelta: 0, maxDelta: 3 },
        { label: "Ask for silence first set", minDelta: -1, maxDelta: 2 },
        { label: "Alternate sets with a teammate", minDelta: 0, maxDelta: 3 },
      ],
      outcomes: [
        ["You thrive — coach nods.", "A few spills, then you settle."],
        ["Clean reps — fundamentals locked.", "Feels too easy; match pace shocks later."],
        ["Healthy competition lifts both of you.", "You learn their tells."],
      ],
    },
    {
      setup:
        "Rival fans behind the goal chant your name — not kindly. Next goal kick: hurry play, slow it down, or acknowledge with a wave?",
      choices: [
        { label: "Quick goal kick — front foot", minDelta: -2, maxDelta: 3 },
        { label: "Slow breath, place the ball", minDelta: -1, maxDelta: 3 },
        { label: "Small wave — ice in the veins", minDelta: -2, maxDelta: 4 },
      ],
      outcomes: [
        ["You catch them sleeping — counter.", "Rushed — straight to their striker."],
        ["Rhythm returns — defence organises.", "Whistle for time-wasting — harsh."],
        ["They boo louder — you smile inside.", "They throw something — you stay focused."],
      ],
    },
    {
      setup: "Injured defender leaves. You're asked to captain the wall for a free kick. Who marks the runner — you organise or take runner yourself?",
      choices: [
        { label: "Organise — point and shout", minDelta: 0, maxDelta: 3 },
        { label: "You track the main jumper", minDelta: -2, maxDelta: 4 },
        { label: "Zonal — trust lanes", minDelta: -2, maxDelta: 2 },
      ],
      outcomes: [
        ["Clear assignments — header away.", "Someone switches off — scramble."],
        ["You meet it first — punch clear.", "A flick-on wrong-foots you."],
        ["Zonal works — calm clearance.", "A ghost run — back-post tap."],
      ],
    },
    {
      setup: "Shootout in a tournament. Fifth taker stares you down. Trash talk, stay silent, or step forward first?",
      choices: [
        { label: "Quiet eye contact", minDelta: -1, maxDelta: 3 },
        { label: "Low words — mind games", minDelta: -2, maxDelta: 4 },
        { label: "Step on the line early — pressure", minDelta: -3, maxDelta: 3 },
      ],
      outcomes: [
        ["They drag it wide.", "They bury it — no blame on you."],
        ["They hesitate — saved.", "They laugh it off and scores."],
        ["Ref resets — you still save the next.", "Yellow for encroachment — chaos."],
      ],
    },
    {
      setup: "Wet gloves, slippery ball. Coach says play out from the back. Risk a pass through lines or go long?",
      choices: [
        { label: "Split the press — through lines", minDelta: -3, maxDelta: 4 },
        { label: "Long to the channel", minDelta: -1, maxDelta: 2 },
        { label: "Chip to full-back in space", minDelta: -2, maxDelta: 3 },
      ],
      outcomes: [
        ["Silky — midfield turns.", "Intercepted — heart attack."],
        ["Safe — second ball won.", "Aimless — turnover."],
        ["Touch and go — attack lives.", "Slip — corner conceded."],
      ],
    },
    {
      setup: "You disagree with a defender's positioning at a corner. Half-time corridor: confront, note it for coach, or let it go?",
      choices: [
        { label: "Speak directly — professional tone", minDelta: -1, maxDelta: 3 },
        { label: "Tell the coach quietly", minDelta: -1, maxDelta: 2 },
        { label: "Let performance talk second half", minDelta: -2, maxDelta: 3 },
      ],
      outcomes: [
        ["They listen — second half tighter.", "Tension — but you clean a cross anyway."],
        ["Coach adjusts the zonal mark.", "Nothing changes — you make two saves."],
        ["Two stops — respect earned.", "A miscommunication costs one — painful."],
      ],
    },
  ],

  DEF: [
    {
      setup:
        "Final minute, you're the last defender. Striker cuts inside from the flank. Show him outside, step in early, or drop and jockey?",
      choices: [
        { label: "Show outside — funnel wide", minDelta: -1, maxDelta: 3 },
        { label: "Step in — win it now", minDelta: -3, maxDelta: 4 },
        { label: "Drop and jockey", minDelta: -1, maxDelta: 2 },
      ],
      outcomes: [
        ["Cross sails over — whistle.", "He chops back — you stay with him."],
        ["Clean tackle — crowd roars.", "Beaten — last-man tension."],
        ["He shoots early — block.", "He finds a lane — corner."],
      ],
    },
    {
      setup: "From a corner, you can mark the tower or zone the near post. Your height is average — what's the call?",
      choices: [
        { label: "Mark their biggest threat", minDelta: -2, maxDelta: 4 },
        { label: "Near-post zone", minDelta: -1, maxDelta: 3 },
        { label: "Block the keeper's lane", minDelta: -2, maxDelta: 2 },
      ],
      outcomes: [
        ["You win the header — clearance.", "A shove you don't get — goal."],
        ["Flick cleared — job done.", "Near-post flick — panic."],
        ["Screen works — punch lands.", "Wrong read — back-post free header."],
      ],
    },
    {
      setup:
        "Full-back overlaps but you're exposed 2v1. Hold the line and delay, step to the ball, or scream for midfield cover?",
      choices: [
        { label: "Delay — body angle", minDelta: -1, maxDelta: 3 },
        { label: "Step to ball carrier", minDelta: -3, maxDelta: 4 },
        { label: "Organise cover loudly", minDelta: -1, maxDelta: 2 },
      ],
      outcomes: [
        ["Pass goes sideways — reset.", "Split — but keeper sweeps."],
        ["Forced backward pass.", "Slid through — chase back."],
        ["Help arrives — tackle together.", "Miscommunication — gap opens."],
      ],
    },
    {
      setup: "You have a yellow. Aggressive tackle on a counter, hold and foul smartly, or trust pace?",
      choices: [
        { label: "Full-blooded challenge", minDelta: -3, maxDelta: 3 },
        { label: "Professional foul — take the card", minDelta: -2, maxDelta: 2 },
        { label: "Sprint and jockey", minDelta: -2, maxDelta: 4 },
      ],
      outcomes: [
        ["Ball first — legend.", "Red mist — early shower."],
        ["Free kick wide — acceptable.", "Booking — but goal still comes."],
        ["Track and block the shot.", "Pace fails — they score."],
      ],
    },
    {
      setup: "Build-up: centre-back partner wants a risky pass through midfield. Hit it, bounce wide, or go long?",
      choices: [
        { label: "Play through the lines", minDelta: -3, maxDelta: 4 },
        { label: "Bounce to full-back", minDelta: -1, maxDelta: 3 },
        { label: "Long over the top", minDelta: -2, maxDelta: 2 },
      ],
      outcomes: [
        ["Line-breaking — coach claps.", "Cut out — counter attack."],
        ["Tempo — retained.", "Pressed — hurried hoof."],
        ["Striker races onto it.", "Goalkeeper collects."],
      ],
    },
    {
      setup: "Opponent dives in the box. You're innocent. Protest hard, stay calm, or help him up?",
      choices: [
        { label: "Calm word to the ref", minDelta: -1, maxDelta: 3 },
        { label: "Animated protest", minDelta: -3, maxDelta: 2 },
        { label: "Offer a hand — no words", minDelta: -2, maxDelta: 3 },
      ],
      outcomes: [
        ["VAR mood — no penalty.", "Penalty given — harsh."],
        ["Yellow for dissent.", "Ref waves play on."],
        ["Crowd boos — you don't care.", "They shove you — whistle."],
      ],
    },
    {
      setup: "Training: coach wants you at CDM for a drill. You're usually deeper. Lead the press, sit shielding, or hybrid?",
      choices: [
        { label: "High press trigger", minDelta: -2, maxDelta: 4 },
        { label: "Sit and screen", minDelta: -1, maxDelta: 2 },
        { label: "Step when #10 receives", minDelta: -2, maxDelta: 3 },
      ],
      outcomes: [
        ["Win ball high — goal.", "Bypassed once — learn."],
        ["Interception — simple.", "Runner slips past."],
        ["Forced backward — turnover.", "Late step — shot flies."],
      ],
    },
    {
      setup: "Long throw into your box. Attack it in the air, stay on the line for second balls, or mark zonally?",
      choices: [
        { label: "Attack the ball", minDelta: -2, maxDelta: 4 },
        { label: "Hold the line", minDelta: -1, maxDelta: 2 },
        { label: "Zonal front post", minDelta: -2, maxDelta: 3 },
      ],
      outcomes: [
        ["Header away — relief.", "Flicked on — scramble save."],
        ["Offside trap works.", "Runner from deep — chaos."],
        ["First contact yours.", "Near-post miss — groans."],
      ],
    },
    {
      setup: "YouTube scout video due Friday. Include your best tackles only, or show passing and leadership clips too?",
      choices: [
        { label: "Tackles and duels reel", minDelta: 0, maxDelta: 2 },
        { label: "Balanced — pass + defend", minDelta: 0, maxDelta: 3 },
        { label: "Add voiceover explaining reads", minDelta: -1, maxDelta: 4 },
      ],
      outcomes: [
        ["Views spike — old-school love.", "Feedback: one-dimensional."],
        ["Staff praise maturity.", "Some clips feel slow."],
        ["Academy director shares it.", "Audio too quiet — redo."],
      ],
    },
    {
      setup: "Teammate loses focus in a session. Call them out, tell coach, or lift them with a small joke?",
      choices: [
        { label: "Direct chat on the pitch", minDelta: -2, maxDelta: 3 },
        { label: "Whisper to coach at water break", minDelta: -1, maxDelta: 2 },
        { label: "Light joke — reset mood", minDelta: -2, maxDelta: 4 },
      ],
      outcomes: [
        ["They sharpen up.", "Argument — both benched."],
        ["Coach addresses group.", "Feels like snitching."],
        ["Laugh breaks tension.", "Joke lands wrong — silence."],
      ],
    },
    {
      setup: "Opponent targets your weaker foot in build-up. Force right foot anyway, reshape body, or go long every time?",
      choices: [
        { label: "Rep weaker foot under pressure", minDelta: -3, maxDelta: 4 },
        { label: "Body shape to protect", minDelta: -1, maxDelta: 3 },
        { label: "Long relief", minDelta: -2, maxDelta: 2 },
      ],
      outcomes: [
        ["Progressive pass — growth.", "Turnover — lesson logged."],
        ["Calm half-turn.", "Pressed into corner."],
        ["Safety — attack resets.", "Predictable — they squeeze."],
      ],
    },
    {
      setup: "Aerial duel vs taller striker. Time jump early, late, or block the run illegally smart?",
      choices: [
        { label: "Jump early — meet at highest point", minDelta: -2, maxDelta: 3 },
        { label: "Late leap", minDelta: -2, maxDelta: 4 },
        { label: "Front him — don't jump", minDelta: -1, maxDelta: 2 },
      ],
      outcomes: [
        ["You nick it — brave.", "Outjumped — corner."],
        ["Perfect timing — header clear.", "Caught under — goal."],
        ["He can't climb — wide shot.", "Foul — free kick."],
      ],
    },
  ],

  MID: [
    {
      setup:
        "Final third, you're carrying at pace. Winger screams wide, striker checks short. Slide wide, through ball central, or take the shot?",
      choices: [
        { label: "Slide to the winger", minDelta: -1, maxDelta: 3 },
        { label: "Through ball into channel", minDelta: -3, maxDelta: 4 },
        { label: "Strike from 20 yards", minDelta: -2, maxDelta: 4 },
      ],
      outcomes: [
        ["Low cross — scramble goal.", "Cut out at near post."],
        ["Striker races — one-on-one.", "Keeper collects."],
        ["Top corner — pandemonium.", "Row Z — groans."],
      ],
    },
    {
      setup: "You're on a yellow. Opponent runs past — tactical pull, sprint recovery, or let him go?",
      choices: [
        { label: "Tactical shirt pull", minDelta: -3, maxDelta: 1 },
        { label: "Sprint and shoulder", minDelta: -2, maxDelta: 4 },
        { label: "Track inside — funnel", minDelta: -1, maxDelta: 2 },
      ],
      outcomes: [
        ["Second yellow — tunnel.", "Ref warns — you survive."],
        ["Shoulder to shoulder — fair.", "Outpaced — cover arrives."],
        ["Shot blocked — corner.", "Cutback — tap-in."],
      ],
    },
    {
      setup: "Coach benches you next friendly. Extra running after, study clips calmly, or knock and ask why?",
      choices: [
        { label: "Extra fitness after session", minDelta: 0, maxDelta: 3 },
        { label: "Clips and notes", minDelta: 0, maxDelta: 3 },
        { label: "Ask for five minutes", minDelta: -2, maxDelta: 4 },
      ],
      outcomes: [
        ["Staff notice the work.", "Legs heavy next day."],
        ["Tactical quiz — you ace it.", "Overthink — paralysis."],
        ["Honest chat — clarity.", "Awkward silence."],
      ],
    },
    {
      setup: "Free kick 22 yards. You fancy it — but the #10 is the usual taker. Claim it, dummy run, or set up a tap?",
      choices: [
        { label: "Take responsibility", minDelta: -2, maxDelta: 4 },
        { label: "Let the #10 — peel off", minDelta: -1, maxDelta: 3 },
        { label: "Decoy wall — low pass", minDelta: -2, maxDelta: 3 },
      ],
      outcomes: [
        ["Curl — side netting.", "Goal — silence doubters."],
        ["#10 scores — you celebrate.", "Saved — rebound chaos."],
        ["Routine works — tap-in.", "Offside — frustration."],
      ],
    },
    {
      setup: "High press — you receive on the turn with two shadows. One touch wall, back to goal shield, or risky flick?",
      choices: [
        { label: "One-two wall pass", minDelta: -2, maxDelta: 4 },
        { label: "Shield and lay off", minDelta: -1, maxDelta: 2 },
        { label: "Flick over the shoulder", minDelta: -3, maxDelta: 4 },
      ],
      outcomes: [
        ["Split lines — break.", "Intercepted — counter."],
        ["Foul drawn — free kick.", "Dispossessed."],
        ["Highlight reel.", "Laugh from the bench."],
      ],
    },
    {
      setup: "Academy classroom: nutrition talk. Ask a sharp question, stay quiet, or share your meal prep?",
      choices: [
        { label: "Ask about match-day timing", minDelta: 0, maxDelta: 2 },
        { label: "Listen only", minDelta: -1, maxDelta: 1 },
        { label: "Share what works for you", minDelta: -1, maxDelta: 3 },
      ],
      outcomes: [
        ["Staff bookmark you as serious.", "Question feels basic."],
        ["You zone out — miss one tip.", "Solid notes."],
        ["Teammates tease — dietician smiles.", "TMI — awkward."],
      ],
    },
    {
      setup: "Wide overload — full-back underlaps. Thread the pass now, delay for the overlap, or switch far side?",
      choices: [
        { label: "Thread the underlap", minDelta: -3, maxDelta: 4 },
        { label: "Delay — then release", minDelta: -1, maxDelta: 3 },
        { label: "Switch to far winger", minDelta: -2, maxDelta: 3 },
      ],
      outcomes: [
        ["Defence splits — big chance.", "Read and cut out."],
        ["Timing perfect — cross.", "Caught in possession."],
        ["Switch lands — 1v1.", "Overhit — throw."],
      ],
    },
    {
      setup: "Captain's armband for a youth cup. Lead with voice, lead with example quietly, or decline politely?",
      choices: [
        { label: "Loud organisation", minDelta: -2, maxDelta: 3 },
        { label: "Quiet example", minDelta: 0, maxDelta: 3 },
        { label: "Suggest a senior take it", minDelta: -1, maxDelta: 2 },
      ],
      outcomes: [
        ["Team responds — clean sheet.", "Someone rolls eyes."],
        ["Two assists — armband fits.", "Anonymous game."],
        ["Senior grateful.", "Coach wanted you — missed moment."],
      ],
    },
    {
      setup: "Transition defence — you're the first reverse press. Hunt the ball, screen passing lane, or foul to stop rhythm?",
      choices: [
        { label: "Aggressive counter-press", minDelta: -2, maxDelta: 4 },
        { label: "Screen and delay", minDelta: -1, maxDelta: 3 },
        { label: "Professional foul", minDelta: -3, maxDelta: 2 },
      ],
      outcomes: [
        ["Win it high — goal.", "Bypassed — numbers down."],
        ["Forces backward — shape set.", "Split — shot."],
        ["Yellow — team resets.", "Advantage — they score anyway."],
      ],
    },
    {
      setup: "Sports psychologist session optional. Go eager, go sceptical but try, or skip for extra training?",
      choices: [
        { label: "Engage fully", minDelta: 0, maxDelta: 3 },
        { label: "Try one exercise", minDelta: -1, maxDelta: 2 },
        { label: "Skip — extra touches", minDelta: -1, maxDelta: 3 },
      ],
      outcomes: [
        ["Breathing routine sticks.", "Feels fluffy — still useful."],
        ["One visualisation helps pens.", "Restless — clock watching."],
        ["Technique sharpens.", "Miss a mental tool later."],
      ],
    },
    {
      setup: "You're double-marked. Drag markers wide, drop deep between lines, or run in behind off the shoulder?",
      choices: [
        { label: "Drag wide — free a teammate", minDelta: -1, maxDelta: 3 },
        { label: "Drop between lines", minDelta: -2, maxDelta: 4 },
        { label: "Spin in behind", minDelta: -3, maxDelta: 4 },
      ],
      outcomes: [
        ["Central overload — goal.", "Isolated — turnover."],
        ["Turn and face — progressive.", "Pressed — back pass."],
        ["Flag up — marginal.", "Clean through — finish."],
      ],
    },
    {
      setup: "Halftime, you're down 1-0. Speak in the circle, wait for coach, or pull aside the quietest player?",
      choices: [
        { label: "Short team word", minDelta: -2, maxDelta: 3 },
        { label: "Listen to coach first", minDelta: -1, maxDelta: 2 },
        { label: "One-to-one encouragement", minDelta: 0, maxDelta: 4 },
      ],
      outcomes: [
        ["Energy lifts — equaliser.", "Wrong tone — eyes down."],
        ["Plan works second half.", "Same mistakes."],
        ["They score the winner.", "Nothing changes."],
      ],
    },
  ],

  WING: [
    {
      setup:
        "1v1 vs a full-back who bites early every time. Fake outside go inside, chop back to the line, or square early?",
      choices: [
        { label: "Fake outside — cut in", minDelta: -2, maxDelta: 4 },
        { label: "Chop back to the byline", minDelta: -2, maxDelta: 3 },
        { label: "Early square to onrushing CM", minDelta: -1, maxDelta: 3 },
      ],
      outcomes: [
        ["Curler — near post.", "Tackle — corner."],
        ["Cross — assist.", "Blocked — throw."],
        ["Arriving shot — goal.", "Behind the runner."],
      ],
    },
    {
      setup: "Tracking back feels endless. Coach wants one more sprint to cover overlap. Go, jog, or point to a teammate?",
      choices: [
        { label: "Sprint — cover", minDelta: -1, maxDelta: 3 },
        { label: "Jog — show presence", minDelta: -2, maxDelta: 2 },
        { label: "Swap responsibility verbally", minDelta: -2, maxDelta: 3 },
      ],
      outcomes: [
        ["Block cross — breathless pride.", "Late — back post header."],
        ["Gap exploited once.", "Enough to slow attack."],
        ["Midfielder slides across.", "Miscommunication — goal."],
      ],
    },
    {
      setup: "Counter-attack 3v2 — you're wide. Drive inside, hug touchline, or dummy for trailing runner?",
      choices: [
        { label: "Drive inside — shoot", minDelta: -2, maxDelta: 4 },
        { label: "Hug line — late cross", minDelta: -2, maxDelta: 3 },
        { label: "Dummy — slip runner", minDelta: -3, maxDelta: 4 },
      ],
      outcomes: [
        ["Keeper saves — rebound goal.", "Blazed over."],
        ["Far-post header — yes.", "Overhit."],
        ["Assist of the season.", "Misread — offside."],
      ],
    },
    {
      setup: "Weak-foot cross needed. Trust it, cut back to strong foot, or recycle?",
      choices: [
        { label: "Whip with weak foot", minDelta: -3, maxDelta: 4 },
        { label: "Cut back — strong foot", minDelta: -1, maxDelta: 2 },
        { label: "Recycle to overlapping FB", minDelta: -1, maxDelta: 3 },
      ],
      outcomes: [
        ["Perfect arc — assist.", "Throw-in — groans."],
        ["Defender reads cutback.", "Deflected — corner."],
        ["Second cross scores.", "Slow — attack dies."],
      ],
    },
    {
      setup: "Defensive set piece — you're on the post or in the wall. Volunteer post, stay in wall, or mark edge of box?",
      choices: [
        { label: "Post duty", minDelta: -2, maxDelta: 3 },
        { label: "Wall", minDelta: -1, maxDelta: 2 },
        { label: "Edge of box — counter threat", minDelta: -2, maxDelta: 4 },
      ],
      outcomes: [
        ["Goal-line clearance.", "Near-post flick — panic."],
        ["Block — bruise worth it.", "Gap — deflection."],
        ["Break 80 yards — fouled.", "Caught upfield — 2v1."],
      ],
    },
    {
      setup: "Social post after a win — team photo, solo skill clip, or nothing?",
      choices: [
        { label: "Team celebration", minDelta: 0, maxDelta: 2 },
        { label: "Skill clip", minDelta: -2, maxDelta: 3 },
        { label: "Stay off phone", minDelta: 0, maxDelta: 2 },
      ],
      outcomes: [
        ["Likes from academy staff.", "Cringe caption."],
        ["Scouts share it.", "Teammate thinks it's selfish."],
        ["Focus reputation grows.", "Invisible online."],
      ],
    },
    {
      setup: "Inverted winger role — cut in for shot, overlap the #10, or combine wall with striker?",
      choices: [
        { label: "Cut in — curl", minDelta: -2, maxDelta: 4 },
        { label: "Underlap #10", minDelta: -2, maxDelta: 3 },
        { label: "One-two with striker", minDelta: -3, maxDelta: 4 },
      ],
      outcomes: [
        ["Top bins.", "Blocked — ricochet goal."],
        ["Chance created central.", "Crowded — turnover."],
        ["Tap-in assist.", "Offside."],
      ],
    },
    {
      setup: "Wind howling down the pitch. Hit early cross, wait for support, or drive to the box?",
      choices: [
        { label: "Early whipped cross", minDelta: -2, maxDelta: 3 },
        { label: "Wait — low cutback", minDelta: -2, maxDelta: 4 },
        { label: "Drive baseline", minDelta: -3, maxDelta: 4 },
      ],
      outcomes: [
        ["Swerves out — goal kick.", "Defender own goal."],
        ["Keeper parries — rebound.", "Too late — blocked."],
        ["Penalty shout.", "Smothered at feet."],
      ],
    },
    {
      setup: "Rival winger trash talks. Ignore, chirp back, or beat him next duel silently?",
      choices: [
        { label: "Ignore", minDelta: -1, maxDelta: 2 },
        { label: "Chirp back", minDelta: -3, maxDelta: 3 },
        { label: "Silent nutmeg next touch", minDelta: -3, maxDelta: 4 },
      ],
      outcomes: [
        ["Focus — clean 1v1 win.", "Frustration foul."],
        ["Both booked.", "He shuts up after you score."],
        ["Crowd gasps.", "Lose ball — embarrassment."],
      ],
    },
    {
      setup: "Coach asks you to play right when you're a left-footer. Accept instantly, ask for hybrid role, or request stay left?",
      choices: [
        { label: "Accept — adapt", minDelta: -1, maxDelta: 3 },
        { label: "Hybrid — cut in always", minDelta: 0, maxDelta: 3 },
        { label: "Argue for natural side", minDelta: -2, maxDelta: 2 },
      ],
      outcomes: [
        ["Two-footed growth spurt.", "Awkward touches early."],
        ["Tactical flexibility noted.", "Coach tweaks plan."],
        ["You stay left — limited minutes.", "Coach respects honesty."],
      ],
    },
    {
      setup: "Last seconds — corner for you to take. Inswinger, outswinger, short routine?",
      choices: [
        { label: "Inswinger — crowd the keeper", minDelta: -2, maxDelta: 3 },
        { label: "Outswinger — back post", minDelta: -2, maxDelta: 4 },
        { label: "Short — rehearsed", minDelta: -3, maxDelta: 3 },
      ],
      outcomes: [
        ["Header — winner.", "Cleared — full time."],
        ["Back-post volley.", "Over everyone's head."],
        ["Shot from edge — deflected in.", "Overplayed — turnover."],
      ],
    },
    {
      setup: "Recovery day — ice bath, yoga session with team, or solo bike?",
      choices: [
        { label: "Ice bath", minDelta: 0, maxDelta: 2 },
        { label: "Team yoga", minDelta: 0, maxDelta: 3 },
        { label: "Solo bike", minDelta: -1, maxDelta: 2 },
      ],
      outcomes: [
        ["Legs fresh next session.", "Too long — stiff."],
        ["Bonding — inside joke born.", "Laugh during pose."],
        ["Clear head.", "Miss a stretch cue."],
      ],
    },
  ],

  ST: [
    {
      setup:
        "One-on-one, keeper rushes early. Round him, chip, or power through body?",
      choices: [
        { label: "Round the keeper", minDelta: -3, maxDelta: 4 },
        { label: "Delicate chip", minDelta: -2, maxDelta: 4 },
        { label: "Early strike through legs", minDelta: -2, maxDelta: 3 },
      ],
      outcomes: [
        ["Empty net — calm.", "Tackled by the keeper."],
        ["Floated perfection.", "Caught on the line."],
        ["Squirms through.", "Saved — face of keeper."],
      ],
    },
    {
      setup: "Back to goal, centre-back tight. Spin, lay off first touch, or win a foul?",
      choices: [
        { label: "Spin and shoot", minDelta: -3, maxDelta: 4 },
        { label: "Lay off — wall pass", minDelta: -1, maxDelta: 3 },
        { label: "Use body — draw foul", minDelta: -2, maxDelta: 2 },
      ],
      outcomes: [
        ["Top corner screamer.", "Blocked — counter."],
        ["Teammate scores — your hockey assist.", "Pass intercepted."],
        ["Free kick — dangerous.", "Ref waves play on."],
      ],
    },
    {
      setup: "Cross from right — you're on penalty spot. Attack near post, peel off back post, or dummy?",
      choices: [
        { label: "Near-post dart", minDelta: -2, maxDelta: 4 },
        { label: "Back post drift", minDelta: -2, maxDelta: 3 },
        { label: "Dummy — let it run", minDelta: -3, maxDelta: 4 },
      ],
      outcomes: [
        ["Glancing header — goal.", "Keeper claims."],
        ["Free header — over.", "Nod down — tap-in."],
        ["Runner behind scores.", "Ball sails — wasted."],
      ],
    },
    {
      setup: "You're on a hat-trick. Teammate is on zero goals. Last penalty — claim it, gift it, or let coach decide?",
      choices: [
        { label: "Take it — finish the hat-trick", minDelta: -1, maxDelta: 3 },
        { label: "Gift to teammate", minDelta: 0, maxDelta: 4 },
        { label: "Ask coach quickly", minDelta: -1, maxDelta: 2 },
      ],
      outcomes: [
        ["Scores — match ball.", "Saved — tension."],
        ["They score — embrace.", "They miss — guilt."],
        ["Coach says you — scored.", "Coach says them — awkward."],
      ],
    },
    {
      setup: "High press from you on their CB. Jump early, curved run to block 'keeper, or sit on pivot?",
      choices: [
        { label: "Jump early — force long", minDelta: -2, maxDelta: 3 },
        { label: "Curve run — block lane", minDelta: -1, maxDelta: 3 },
        { label: "Mark pivot midfielder", minDelta: -2, maxDelta: 2 },
      ],
      outcomes: [
        ["Long ball — you chase.", "Bypassed — exposed."],
        ["Forced back pass — goal kick.", "Split — danger."],
        ["Interception — break.", "Foul — yellow."],
      ],
    },
    {
      setup: "Target-man service — chest down in traffic, flick header on, or let it run for winger?",
      choices: [
        { label: "Chest and lay off", minDelta: -2, maxDelta: 4 },
        { label: "Flick header", minDelta: -3, maxDelta: 4 },
        { label: "Dummy run — channel", minDelta: -2, maxDelta: 3 },
      ],
      outcomes: [
        ["Assist stamped.", "Dispossessed."],
        ["Lobbed volley almost.", "Misjudged — goal kick."],
        ["Winger in — goal.", "Flag up."],
      ],
    },
    {
      setup: "Offside trap game — timing run from shoulder. Go early, hold, or check to then go?",
      choices: [
        { label: "Early break", minDelta: -3, maxDelta: 3 },
        { label: "Hold line — late burst", minDelta: -2, maxDelta: 4 },
        { label: "Check to then spin", minDelta: -2, maxDelta: 4 },
      ],
      outcomes: [
        ["Flag — marginal.", "Clean through — finish."],
        ["Perfect timing — assist.", "Late — ball overhit."],
        ["Turn and shot.", "Crowded."],
      ],
    },
    {
      setup: "Nutritionist says drop weight for sharpness. Follow plan strictly, negotiate cheat meal, or ignore quietly?",
      choices: [
        { label: "Strict plan", minDelta: 0, maxDelta: 3 },
        { label: "Negotiate one cheat", minDelta: -1, maxDelta: 2 },
        { label: "Quiet ignore", minDelta: -3, maxDelta: 2 },
      ],
      outcomes: [
        ["Explosiveness up.", "Energy low one week."],
        ["Balance works.", "Guilt after pizza."],
        ["Coach notices sluggishness.", "You feel fine — risky."],
      ],
    },
    {
      setup: "Two strikers — you're asked to run channels, not stay central. Accept, ask for split roles, or resist?",
      choices: [
        { label: "Channel runs all game", minDelta: -1, maxDelta: 3 },
        { label: "Suggest alternating central", minDelta: 0, maxDelta: 3 },
        { label: "Insist on central reference", minDelta: -3, maxDelta: 2 },
      ],
      outcomes: [
        ["Assist from wide.", "Isolated — frustrated."],
        ["Coach adapts — both score.", "Too complex — confusion."],
        ["Benched next half.", "Hold-up shines."],
      ],
    },
    {
      setup: "Rebound off bar — you're first there. Overhead, chest and volley, or header back across?",
      choices: [
        { label: "Overhead attempt", minDelta: -3, maxDelta: 4 },
        { label: "Chest — volley", minDelta: -2, maxDelta: 4 },
        { label: "Header across goal", minDelta: -2, maxDelta: 3 },
      ],
      outcomes: [
        ["Stadium roar.", "Row Z."],
        ["Thunderbolt.", "Skied."],
        ["Tap-in for partner.", "Wide."],
      ],
    },
    {
      setup: "Interview after scoring. Humble, confident soundbite, or joke with press?",
      choices: [
        { label: "Credit teammates", minDelta: 0, maxDelta: 2 },
        { label: "Confident — back yourself", minDelta: -2, maxDelta: 3 },
        { label: "Light joke", minDelta: -2, maxDelta: 3 },
      ],
      outcomes: [
        ["Parents proud.", "Forgotten headline."],
        ["Polarising — scouts notice.", "Quote misread online."],
        ["Viral clip.", "Awkward silence."],
      ],
    },
    {
      setup: "Injury scare — tight hamstring. Play on, sub self, or signal bench immediately?",
      choices: [
        { label: "Play on — stretch at stoppage", minDelta: -3, maxDelta: 2 },
        { label: "Ask for sub", minDelta: -1, maxDelta: 3 },
        { label: "Immediate signal", minDelta: -2, maxDelta: 2 },
      ],
      outcomes: [
        ["Score winner — pay Monday.", "Pop — long layoff."],
        ["Team respects maturity.", "Miss golden chance later."],
        ["Scan clear — precaution.", "Minor strain — two weeks."],
      ],
    },
  ],
};
