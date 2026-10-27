/**
 * Senior career scenario bank (catalogue IDs 25–80).
 * contentVersion 2 — narrative deltas via senior scenario model.
 */
export const NEW_SENIOR_SCENARIO_DEFS = [
  {
    "id": "video-pattern-review",
    "title": "Pattern review",
    "contentVersion": 2,
    "tags": [
      "training",
      "club"
    ],
    "eligibility": [
      "senior"
    ],
    "setup": "The analyst loads clips of how opponents shift when you receive between the lines. Your coach wants you sharper on the triggers before tomorrow's session.",
    "choices": [
      {
        "id": "video-pattern-review:work-through-the-clips-with-the-analyst-and-note",
        "label": "Work through the clips with the analyst and note your triggers",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "video-pattern-review:work-through-the-clips-with-the-analyst-and-note:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You map the press triggers with the analyst and arrive at training already one step ahead on your first touch.",
            "effects": [
              "training"
            ]
          },
          {
            "id": "video-pattern-review:work-through-the-clips-with-the-analyst-and-note:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "The review helps, though you still need reps to make the reads automatic.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "video-pattern-review:work-through-the-clips-with-the-analyst-and-note:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You overthink the patterns and your first actions in the drill look hesitant.",
            "effects": [
              "training"
            ]
          }
        ]
      },
      {
        "id": "video-pattern-review:skim-the-key-moments-and-carry-one-cue-into-trai",
        "label": "Skim the key moments and carry one cue into training",
        "disposition": "balanced",
        "results": [
          {
            "id": "video-pattern-review:skim-the-key-moments-and-carry-one-cue-into-trai:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You take one clear cue from the video and apply it cleanly in the next unit.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "video-pattern-review:skim-the-key-moments-and-carry-one-cue-into-trai:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You remember the shape of the move without fully owning the timing yet.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "video-pattern-review:skim-the-key-moments-and-carry-one-cue-into-trai:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You miss a detail the clip highlighted and the coach stops the drill to reset you.",
            "effects": [
              "coachTrust",
              "reputation",
              "training"
            ]
          }
        ]
      },
      {
        "id": "video-pattern-review:ask-to-skip-the-meeting-and-prove-it-on-the-pitc",
        "label": "Ask to skip the meeting and prove it on the pitch instead",
        "disposition": "ambitious",
        "results": [
          {
            "id": "video-pattern-review:ask-to-skip-the-meeting-and-prove-it-on-the-pitc:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You dominate the live rep and staff notice your intensity.",
            "effects": [
              "coachTrust"
            ]
          },
          {
            "id": "video-pattern-review:ask-to-skip-the-meeting-and-prove-it-on-the-pitc:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Training feels fine, but you never closed the gap the video was meant to fix.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "video-pattern-review:ask-to-skip-the-meeting-and-prove-it-on-the-pitc:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You shrug off the tactical homework and look unprepared when the pattern repeats.",
            "effects": [
              "training",
              "support"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "weak-side-session",
    "title": "Weak-side work",
    "contentVersion": 2,
    "tags": [
      "training",
      "club"
    ],
    "eligibility": [
      "senior"
    ],
    "setup": "Today's unit isolates weak-side runs and receiving angles you rarely use in match rhythm. The assistant wants detail on your body shape before the group moves on.",
    "choices": [
      {
        "id": "weak-side-session:repeat-the-movement-slowly-until-the-shape-feels",
        "label": "Repeat the movement slowly until the shape feels natural",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "weak-side-session:repeat-the-movement-slowly-until-the-shape-feels:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Your shape on the blind-side receive tightens and the pass sticks cleanly.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "weak-side-session:repeat-the-movement-slowly-until-the-shape-feels:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "The drill lands without drama; improvement is incremental.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "weak-side-session:repeat-the-movement-slowly-until-the-shape-feels:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Fatigue makes your hips square early and the ball runs away.",
            "effects": [
              "readiness"
            ]
          }
        ]
      },
      {
        "id": "weak-side-session:join-the-drill-at-match-pace-with-standard-effor",
        "label": "Join the drill at match pace with standard effort",
        "disposition": "balanced",
        "results": [
          {
            "id": "weak-side-session:join-the-drill-at-match-pace-with-standard-effor:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You hit the timings the coach asked for on most repetitions.",
            "effects": [
              "coachTrust"
            ]
          },
          {
            "id": "weak-side-session:join-the-drill-at-match-pace-with-standard-effor:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You get through the set without a standout moment either way.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "weak-side-session:join-the-drill-at-match-pace-with-standard-effor:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You rush the check and clip a simple pass wide.",
            "effects": [
              "reputation"
            ]
          }
        ]
      },
      {
        "id": "weak-side-session:demand-extra-reps-at-full-speed-until-you-beat-t",
        "label": "Demand extra reps at full speed until you beat the marker every time",
        "disposition": "ambitious",
        "results": [
          {
            "id": "weak-side-session:demand-extra-reps-at-full-speed-until-you-beat-t:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You win the last three duels and the group feeds off your tempo.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "weak-side-session:demand-extra-reps-at-full-speed-until-you-beat-t:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "High intensity helps some reps and costs you on others.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "weak-side-session:demand-extra-reps-at-full-speed-until-you-beat-t:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You chase glory on the final run and pull up tight in the hamstring.",
            "effects": [
              "morale"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "new-shape-rehearsal",
    "title": "New shape rehearsal",
    "contentVersion": 2,
    "tags": [
      "training",
      "club"
    ],
    "eligibility": [
      "senior"
    ],
    "setup": "The staff trial a tweaked shape in an eleven-v-eleven rehearsal. Your role shifts a few metres and the spacing feels unfamiliar at first.",
    "choices": [
      {
        "id": "new-shape-rehearsal:ask-the-coach-to-walk-through-your-landmarks-bet",
        "label": "Ask the coach to walk through your landmarks between sets",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "new-shape-rehearsal:ask-the-coach-to-walk-through-your-landmarks-bet:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Landmarks click and your off-ball runs start to mesh with the midfield.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "new-shape-rehearsal:ask-the-coach-to-walk-through-your-landmarks-bet:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You understand the idea but still hunt the old habits.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "new-shape-rehearsal:ask-the-coach-to-walk-through-your-landmarks-bet:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You drift back to last week's position and disrupt the spacing.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "new-shape-rehearsal:listen-in-the-huddle-and-adjust-as-the-flow-sett",
        "label": "Listen in the huddle and adjust as the flow settles",
        "disposition": "balanced",
        "results": [
          {
            "id": "new-shape-rehearsal:listen-in-the-huddle-and-adjust-as-the-flow-sett:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You find a workable compromise between the old role and the new one.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "new-shape-rehearsal:listen-in-the-huddle-and-adjust-as-the-flow-sett:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "The rehearsal passes; nobody singles out your adjustment.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "new-shape-rehearsal:listen-in-the-huddle-and-adjust-as-the-flow-sett:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "A late switch catches you flat-footed in transition.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "new-shape-rehearsal:push-into-the-highest-line-and-force-the-team-to",
        "label": "Push into the highest line and force the team to play around you",
        "disposition": "ambitious",
        "results": [
          {
            "id": "new-shape-rehearsal:push-into-the-highest-line-and-force-the-team-to:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Your aggressive line forces quicker decisions and the coach smiles.",
            "effects": [
              "coachTrust"
            ]
          },
          {
            "id": "new-shape-rehearsal:push-into-the-highest-line-and-force-the-team-to:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You test the limits without breaking the exercise entirely.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "new-shape-rehearsal:push-into-the-highest-line-and-force-the-team-to:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You leave a gap behind you that ends in a cheap rehearsal goal.",
            "effects": [
              "morale"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "specialist-technique-clinic",
    "title": "Technique clinic",
    "contentVersion": 2,
    "tags": [
      "training",
      "club"
    ],
    "eligibility": [
      "senior"
    ],
    "setup": "A specialist coach runs a small-group clinic on a skill that separates starters from squad players. Balls are laid out in tight grids and the standard is unforgiving.",
    "choices": [
      {
        "id": "specialist-technique-clinic:stay-after-to-log-extra-touches-on-your-weaker-s",
        "label": "Stay after to log extra touches on your weaker side",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "specialist-technique-clinic:stay-after-to-log-extra-touches-on-your-weaker-s:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Extra touches on your weak side show in the next passing block.",
            "effects": [
              "training"
            ]
          },
          {
            "id": "specialist-technique-clinic:stay-after-to-log-extra-touches-on-your-weaker-s:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "The clinic helps marginally; your dominant foot still does most of the work.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "specialist-technique-clinic:stay-after-to-log-extra-touches-on-your-weaker-s:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You stay too long and feel heavy when the main session starts.",
            "effects": [
              "readiness",
              "training"
            ]
          }
        ]
      },
      {
        "id": "specialist-technique-clinic:complete-the-circuit-at-the-pace-the-staff-set",
        "label": "Complete the circuit at the pace the staff set",
        "disposition": "balanced",
        "results": [
          {
            "id": "specialist-technique-clinic:complete-the-circuit-at-the-pace-the-staff-set:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You finish every station cleanly without needing a redo.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "specialist-technique-clinic:complete-the-circuit-at-the-pace-the-staff-set:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You pass the circuit; nothing feels dramatically sharper.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "specialist-technique-clinic:complete-the-circuit-at-the-pace-the-staff-set:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You hurry the last grid and scuff two simple passes.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "specialist-technique-clinic:turn-the-final-station-into-a-competition-you-re",
        "label": "Turn the final station into a competition you refuse to lose",
        "disposition": "ambitious",
        "results": [
          {
            "id": "specialist-technique-clinic:turn-the-final-station-into-a-competition-you-re:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You win the station race and the group buzzes around you.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "specialist-technique-clinic:turn-the-final-station-into-a-competition-you-re:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "The competitive edge helps, though form beats flash on some reps.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "specialist-technique-clinic:turn-the-final-station-into-a-competition-you-re:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You collide with a mannequin chasing a point and limp out of the drill.",
            "effects": [
              "training"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "training-measurement-review",
    "title": "Measurement review",
    "contentVersion": 2,
    "tags": [
      "training",
      "club"
    ],
    "eligibility": [
      "senior"
    ],
    "setup": "Sports science shares your latest sprint and load numbers beside video from yesterday. The staff ask how you want to use the feedback this week.",
    "choices": [
      {
        "id": "training-measurement-review:build-a-small-adjustment-plan-with-the-physio",
        "label": "Build a small adjustment plan with the physio",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "training-measurement-review:build-a-small-adjustment-plan-with-the-physio:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "A targeted tweak to your warm-up leaves you fresher in the afternoon block.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "training-measurement-review:build-a-small-adjustment-plan-with-the-physio:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "The data sits in the background while training feels normal.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "training-measurement-review:build-a-small-adjustment-plan-with-the-physio:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You tweak too much and arrive at the main set slightly undercooked.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "training-measurement-review:take-the-numbers-as-context-and-train-as-planned",
        "label": "Take the numbers as context and train as planned",
        "disposition": "balanced",
        "results": [
          {
            "id": "training-measurement-review:take-the-numbers-as-context-and-train-as-planned:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You match effort to the recommended band and stay consistent.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "training-measurement-review:take-the-numbers-as-context-and-train-as-planned:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Numbers neither lift nor limit you today.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "training-measurement-review:take-the-numbers-as-context-and-train-as-planned:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You misread a flag and overreach on the first explosive rep.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "training-measurement-review:ignore-the-sheet-and-push-harder-to-prove-the-da",
        "label": "Ignore the sheet and push harder to prove the data wrong",
        "disposition": "reckless",
        "results": [
          {
            "id": "training-measurement-review:ignore-the-sheet-and-push-harder-to-prove-the-da:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You fly through the sprints and the room notices.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "training-measurement-review:ignore-the-sheet-and-push-harder-to-prove-the-da:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Extra work feels good now; recovery tomorrow is another story.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "training-measurement-review:ignore-the-sheet-and-push-harder-to-prove-the-da:negative",
            "abilityCategory": "negative",
            "delta": -3,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You blow past load limits and the physio pulls you from the next unit.",
            "effects": [
              "morale"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "scouting-feedback",
    "title": "Scouting feedback",
    "contentVersion": 2,
    "tags": [
      "training",
      "match"
    ],
    "eligibility": [
      "nextFixture"
    ],
    "setup": "Opposition notes land on the board before the next fixture. Clips show how their back line reacts when you drop or spin.",
    "choices": [
      {
        "id": "scouting-feedback:study-the-clips-and-rehearse-your-triggers-with-",
        "label": "Study the clips and rehearse your triggers with a teammate",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "scouting-feedback:study-the-clips-and-rehearse-your-triggers-with-:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Your first rehearsal run mirrors the scout's trigger and the coach nods.",
            "effects": [
              "coachTrust"
            ]
          },
          {
            "id": "scouting-feedback:study-the-clips-and-rehearse-your-triggers-with-:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You absorb the basics without a standout rehearsal moment.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "scouting-feedback:study-the-clips-and-rehearse-your-triggers-with-:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You confuse two markers in the notes and drill the wrong cue.",
            "effects": [
              "training"
            ]
          }
        ]
      },
      {
        "id": "scouting-feedback:glance-at-the-main-threats-and-trust-your-match-",
        "label": "Glance at the main threats and trust your match habits",
        "disposition": "balanced",
        "results": [
          {
            "id": "scouting-feedback:glance-at-the-main-threats-and-trust-your-match-:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You pick up one habit to exploit without overloading your head.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "scouting-feedback:glance-at-the-main-threats-and-trust-your-match-:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Preparation feels standard for a senior week.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "scouting-feedback:glance-at-the-main-threats-and-trust-your-match-:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "A subtle detail in their press catches you off guard in a small-sided game.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "scouting-feedback:tell-staff-you-already-know-this-opponent-and-sk",
        "label": "Tell staff you already know this opponent and skip the walk-through",
        "disposition": "ambitious",
        "results": [
          {
            "id": "scouting-feedback:tell-staff-you-already-know-this-opponent-and-sk:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You call the matchup early in the meeting and teammates lean in.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "scouting-feedback:tell-staff-you-already-know-this-opponent-and-sk:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Confidence is high; the plan still needs fine-tuning on the pitch.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "scouting-feedback:tell-staff-you-already-know-this-opponent-and-sk:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You dismiss a warning sign and get isolated in the prep match.",
            "effects": [
              "morale"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "under-pressure-training",
    "title": "Under pressure",
    "contentVersion": 2,
    "tags": [
      "training",
      "club"
    ],
    "eligibility": [
      "senior"
    ],
    "setup": "The coach cranks up pressure in a finishing drill: limited touches, live whistle, crowded boxes. Mistakes are punished with extra runs.",
    "choices": [
      {
        "id": "under-pressure-training:slow-your-first-touch-to-choose-the-cleaner-fini",
        "label": "Slow your first touch to choose the cleaner finish",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "under-pressure-training:slow-your-first-touch-to-choose-the-cleaner-fini:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Your composure under pressure shows in two calm finishes.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "under-pressure-training:slow-your-first-touch-to-choose-the-cleaner-fini:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You survive the drill without a highlight or a disaster.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "under-pressure-training:slow-your-first-touch-to-choose-the-cleaner-fini:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Hesitation on the first touch invites a block you should beat.",
            "effects": [
              "training"
            ]
          }
        ]
      },
      {
        "id": "under-pressure-training:play-at-normal-tempo-and-accept-the-odd-mistake",
        "label": "Play at normal tempo and accept the odd mistake",
        "disposition": "balanced",
        "results": [
          {
            "id": "under-pressure-training:play-at-normal-tempo-and-accept-the-odd-mistake:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You trade a few errors for realistic match rhythm.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "under-pressure-training:play-at-normal-tempo-and-accept-the-odd-mistake:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "The drill passes; your finishing line stays steady.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "under-pressure-training:play-at-normal-tempo-and-accept-the-odd-mistake:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "A rushed shot after a heavy touch earns you the extra run.",
            "effects": [
              "readiness",
              "training"
            ]
          }
        ]
      },
      {
        "id": "under-pressure-training:attack-every-ball-first-time-regardless-of-traff",
        "label": "Attack every ball first-time regardless of traffic",
        "disposition": "ambitious",
        "results": [
          {
            "id": "under-pressure-training:attack-every-ball-first-time-regardless-of-traff:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You nail a volley through traffic and the group erupts.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "under-pressure-training:attack-every-ball-first-time-regardless-of-traff:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Flashy attempts land about half the time.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "under-pressure-training:attack-every-ball-first-time-regardless-of-traff:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You clatter a teammate chasing a screamer and the coach stops the drill.",
            "effects": [
              "coachTrust",
              "training"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "personal-training-plan",
    "title": "Personal plan",
    "contentVersion": 2,
    "tags": [
      "training",
      "club"
    ],
    "eligibility": [
      "senior"
    ],
    "setup": "The coach offers a optional add-on block tailored to your role this month. It costs forty minutes and overlaps with some players' recovery window.",
    "choices": [
      {
        "id": "personal-training-plan:accept-the-plan-and-slot-it-around-recovery",
        "label": "Accept the plan and slot it around recovery",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "personal-training-plan:accept-the-plan-and-slot-it-around-recovery:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "The extra block sharpens a role detail you keep seeing on video.",
            "effects": [
              "readiness"
            ]
          },
          {
            "id": "personal-training-plan:accept-the-plan-and-slot-it-around-recovery:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You skip the add-on and nothing changes immediately.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "personal-training-plan:accept-the-plan-and-slot-it-around-recovery:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You under-recover and feel flat in the next morning unit.",
            "effects": [
              "readiness"
            ]
          }
        ]
      },
      {
        "id": "personal-training-plan:decline-politely-and-keep-the-squad-schedule",
        "label": "Decline politely and keep the squad schedule",
        "disposition": "balanced",
        "results": [
          {
            "id": "personal-training-plan:decline-politely-and-keep-the-squad-schedule:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You stay aligned with the group plan and remain fresh.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "personal-training-plan:decline-politely-and-keep-the-squad-schedule:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "A normal day passes without role-specific gains.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "personal-training-plan:decline-politely-and-keep-the-squad-schedule:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "A nagging tightness reminds you the schedule was already full.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "personal-training-plan:stack-the-add-on-on-top-of-a-full-day-without-te",
        "label": "Stack the add-on on top of a full day without telling staff",
        "disposition": "reckless",
        "results": [
          {
            "id": "personal-training-plan:stack-the-add-on-on-top-of-a-full-day-without-te:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You cram two sessions in and feel like the hardest worker in the building.",
            "effects": [
              "training"
            ]
          },
          {
            "id": "personal-training-plan:stack-the-add-on-on-top-of-a-full-day-without-te:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "The volume catches up by evening; sleep is shorter than planned.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "personal-training-plan:stack-the-add-on-on-top-of-a-full-day-without-te:negative",
            "abilityCategory": "negative",
            "delta": -3,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Staff pull you aside — doubling load without clearance was a mistake.",
            "effects": [
              "coachTrust"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "starting-place-competition",
    "title": "Starting place",
    "contentVersion": 2,
    "tags": [
      "training",
      "club"
    ],
    "eligibility": [
      "senior"
    ],
    "setup": "A teammate in your position has been excellent in training. The coach says selection is still open for the weekend.",
    "choices": [
      {
        "id": "starting-place-competition:ask-what-detail-would-swing-the-decision-and-wor",
        "label": "Ask what detail would swing the decision and work on it",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "starting-place-competition:ask-what-detail-would-swing-the-decision-and-wor:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You address the exact detail the coach named and it shows in the final unit.",
            "effects": [
              "coachTrust"
            ]
          },
          {
            "id": "starting-place-competition:ask-what-detail-would-swing-the-decision-and-wor:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Training stays solid; selection remains a coin flip.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "starting-place-competition:ask-what-detail-would-swing-the-decision-and-wor:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You obsess over the rivalry and your touch gets tight.",
            "effects": [
              "training"
            ]
          }
        ]
      },
      {
        "id": "starting-place-competition:keep-your-standards-high-without-commenting-on-s",
        "label": "Keep your standards high without commenting on selection",
        "disposition": "balanced",
        "results": [
          {
            "id": "starting-place-competition:keep-your-standards-high-without-commenting-on-s:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Your professionalism keeps the room calm and your level steady.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "starting-place-competition:keep-your-standards-high-without-commenting-on-s:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Neither you nor your rival separates clearly today.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "starting-place-competition:keep-your-standards-high-without-commenting-on-s:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "A sloppy rep at the wrong moment sticks in the staff's memory.",
            "effects": [
              "coachTrust"
            ]
          }
        ]
      },
      {
        "id": "starting-place-competition:tell-the-group-you-expect-to-start-and-back-it-u",
        "label": "Tell the group you expect to start and back it up publicly",
        "disposition": "ambitious",
        "results": [
          {
            "id": "starting-place-competition:tell-the-group-you-expect-to-start-and-back-it-u:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You seize the last drill and the bench reacts to your energy.",
            "effects": [
              "training"
            ]
          },
          {
            "id": "starting-place-competition:tell-the-group-you-expect-to-start-and-back-it-u:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Bold talk raises stakes; one mistake would look louder now.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "starting-place-competition:tell-the-group-you-expect-to-start-and-back-it-u:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "The comment ruffles your rival and the session turns scrappy.",
            "effects": [
              "training"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "substitute-preparation",
    "title": "Substitute prep",
    "contentVersion": 2,
    "tags": [
      "match",
      "club"
    ],
    "eligibility": [
      "substituteAppearances"
    ],
    "setup": "You have been coming off the bench lately. Matchday rhythm is different — warm-up length, touch counts, and when to ramp intensity.",
    "choices": [
      {
        "id": "substitute-preparation:rehearse-your-activation-routine-with-the-fitnes",
        "label": "Rehearse your activation routine with the fitness coach",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "substitute-preparation:rehearse-your-activation-routine-with-the-fitnes:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Your activation leaves you sharp in the first minute you enter.",
            "effects": [
              "readiness"
            ]
          },
          {
            "id": "substitute-preparation:rehearse-your-activation-routine-with-the-fitnes:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "You feel acceptable when called; nothing exceptional.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "substitute-preparation:rehearse-your-activation-routine-with-the-fitnes:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "You overthink the routine and miss the coach's first wave.",
            "effects": [
              "coachTrust"
            ]
          }
        ]
      },
      {
        "id": "substitute-preparation:follow-the-same-touch-pattern-you-used-last-matc",
        "label": "Follow the same touch pattern you used last match",
        "disposition": "balanced",
        "results": [
          {
            "id": "substitute-preparation:follow-the-same-touch-pattern-you-used-last-matc:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "A familiar touch pattern keeps errors down when you enter.",
            "effects": [
              "training"
            ]
          },
          {
            "id": "substitute-preparation:follow-the-same-touch-pattern-you-used-last-matc:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "You perform adequately without seizing the moment.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "substitute-preparation:follow-the-same-touch-pattern-you-used-last-matc:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "You are half a step late to the first press the coach wanted.",
            "effects": [
              "coachTrust"
            ]
          }
        ]
      },
      {
        "id": "substitute-preparation:skip-parts-of-the-warm-up-to-stay-loose-and-joke",
        "label": "Skip parts of the warm-up to stay loose and joke with the stands",
        "disposition": "reckless",
        "results": [
          {
            "id": "substitute-preparation:skip-parts-of-the-warm-up-to-stay-loose-and-joke:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "You look relaxed and play a risky flick that comes off.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "substitute-preparation:skip-parts-of-the-warm-up-to-stay-loose-and-joke:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Loose prep works until it does not — today it is average.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "substitute-preparation:skip-parts-of-the-warm-up-to-stay-loose-and-joke:negative",
            "abilityCategory": "negative",
            "delta": -3,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Cold muscles and a slow start draw a pointed substitution stare.",
            "effects": [
              "morale"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "rotated-after-strong-game",
    "title": "After a strong game",
    "contentVersion": 2,
    "tags": [
      "training",
      "club"
    ],
    "eligibility": [
      "rotatedAfterStrong"
    ],
    "setup": "You played well at the weekend but were rested midweek for load reasons. Today you rejoin the main group while others carry minutes from the cup tie.",
    "choices": [
      {
        "id": "rotated-after-strong-game:meet-the-coach-to-clarify-what-you-must-show-in-",
        "label": "Meet the coach to clarify what you must show in training",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "rotated-after-strong-game:meet-the-coach-to-clarify-what-you-must-show-in-:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Clear expectations help you target the exact intensity the staff want.",
            "effects": [
              "coachTrust"
            ]
          },
          {
            "id": "rotated-after-strong-game:meet-the-coach-to-clarify-what-you-must-show-in-:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You blend back in without a sharp edge or a slip.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "rotated-after-strong-game:meet-the-coach-to-clarify-what-you-must-show-in-:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You read the rotation as a slight and your body language shows it.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "rotated-after-strong-game:treat-the-session-like-any-other-and-hit-your-ma",
        "label": "Treat the session like any other and hit your marks",
        "disposition": "balanced",
        "results": [
          {
            "id": "rotated-after-strong-game:treat-the-session-like-any-other-and-hit-your-ma:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Consistent effort keeps you in the selection picture.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "rotated-after-strong-game:treat-the-session-like-any-other-and-hit-your-ma:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "The session is steady; nobody gains a big advantage on you.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "rotated-after-strong-game:treat-the-session-like-any-other-and-hit-your-ma:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You fade late and look like the break disrupted your rhythm.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "rotated-after-strong-game:push-for-leadership-reps-even-though-you-did-not",
        "label": "Push for leadership reps even though you did not play midweek",
        "disposition": "ambitious",
        "results": [
          {
            "id": "rotated-after-strong-game:push-for-leadership-reps-even-though-you-did-not:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You drive standards in the possession game and teammates follow.",
            "effects": [
              "training"
            ]
          },
          {
            "id": "rotated-after-strong-game:push-for-leadership-reps-even-though-you-did-not:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "High energy lands well though minutes management still applies.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "rotated-after-strong-game:push-for-leadership-reps-even-though-you-did-not:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You overheat a rondo and the coach cools you down for tomorrow.",
            "effects": [
              "coachTrust"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "training-unit-disagreement",
    "title": "Unit disagreement",
    "contentVersion": 2,
    "tags": [
      "training",
      "club"
    ],
    "eligibility": [
      "senior"
    ],
    "setup": "You and a senior teammate disagree on who should hold the rest defence in a pressing drill. The unit stops while others wait.",
    "choices": [
      {
        "id": "training-unit-disagreement:suggest-a-quick-huddle-with-the-coach-to-align-r",
        "label": "Suggest a quick huddle with the coach to align roles",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "training-unit-disagreement:suggest-a-quick-huddle-with-the-coach-to-align-r:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "A thirty-second alignment clears the drill and the press improves.",
            "effects": [
              "training"
            ]
          },
          {
            "id": "training-unit-disagreement:suggest-a-quick-huddle-with-the-coach-to-align-r:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "The unit moves on; the underlying question stays unresolved.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "training-unit-disagreement:suggest-a-quick-huddle-with-the-coach-to-align-r:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "The debate drags and the coach cuts the set short annoyed.",
            "effects": [
              "coachTrust"
            ]
          }
        ]
      },
      {
        "id": "training-unit-disagreement:defer-and-run-the-coach-s-call-without-debate",
        "label": "Defer and run the coach's call without debate",
        "disposition": "balanced",
        "results": [
          {
            "id": "training-unit-disagreement:defer-and-run-the-coach-s-call-without-debate:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You sacrifice preference for flow and the drill finishes on time.",
            "effects": [
              "training"
            ]
          },
          {
            "id": "training-unit-disagreement:defer-and-run-the-coach-s-call-without-debate:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Compliance keeps peace; learning is limited.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "training-unit-disagreement:defer-and-run-the-coach-s-call-without-debate:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You sulk through the rep and your press trigger is late.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "training-unit-disagreement:insist-your-version-is-right-and-refuse-to-switc",
        "label": "Insist your version is right and refuse to switch",
        "disposition": "reckless",
        "results": [
          {
            "id": "training-unit-disagreement:insist-your-version-is-right-and-refuse-to-switc:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You win the argument and the next rep looks sharper to you.",
            "effects": [
              "readiness"
            ]
          },
          {
            "id": "training-unit-disagreement:insist-your-version-is-right-and-refuse-to-switc:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Standing firm works once; trust takes a dent.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "training-unit-disagreement:insist-your-version-is-right-and-refuse-to-switc:negative",
            "abilityCategory": "negative",
            "delta": -3,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "The coach benches the drill and singles out the noise you caused.",
            "effects": [
              "coachTrust",
              "training"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "new-teammate-language",
    "title": "New teammate",
    "contentVersion": 2,
    "tags": [
      "training",
      "club"
    ],
    "eligibility": [
      "senior"
    ],
    "setup": "A new signing speaks little of the dressing-room language yet. Calls in training are getting missed on your side of the pitch.",
    "choices": [
      {
        "id": "new-teammate-language:pair-up-and-walk-through-your-usual-calls-before",
        "label": "Pair up and walk through your usual calls before the session",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "new-teammate-language:pair-up-and-walk-through-your-usual-calls-before:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Shared vocabulary shows up in two clean transitions you combine on.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "new-teammate-language:pair-up-and-walk-through-your-usual-calls-before:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Communication is better though not seamless.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "new-teammate-language:pair-up-and-walk-through-your-usual-calls-before:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "A misunderstanding leaves you both chasing the same pass.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "new-teammate-language:shout-simpler-english-commands-during-the-drill",
        "label": "Shout simpler English commands during the drill",
        "disposition": "balanced",
        "results": [
          {
            "id": "new-teammate-language:shout-simpler-english-commands-during-the-drill:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Clear shouts get you through the unit without major errors.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "new-teammate-language:shout-simpler-english-commands-during-the-drill:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "The session works; chemistry will take time.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "new-teammate-language:shout-simpler-english-commands-during-the-drill:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "They misread a shout and the coach stops play frustrated.",
            "effects": [
              "coachTrust"
            ]
          }
        ]
      },
      {
        "id": "new-teammate-language:let-them-figure-it-out-while-you-focus-on-your-o",
        "label": "Let them figure it out while you focus on your own reps",
        "disposition": "ambitious",
        "results": [
          {
            "id": "new-teammate-language:let-them-figure-it-out-while-you-focus-on-your-o:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You dominate the ball and they learn by watching you.",
            "effects": [
              "training"
            ]
          },
          {
            "id": "new-teammate-language:let-them-figure-it-out-while-you-focus-on-your-o:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Leading by example helps; verbal glue is still thin.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "new-teammate-language:let-them-figure-it-out-while-you-focus-on-your-o:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Isolation grows and the coach asks why you are not linking.",
            "effects": [
              "coachTrust"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "vice-captain-request",
    "title": "Vice-captain ask",
    "contentVersion": 2,
    "tags": [
      "club",
      "leadership"
    ],
    "eligibility": [
      "leadershipContext"
    ],
    "setup": "The captain pulls you aside before travel. They want help setting tone if the match turns tense.",
    "choices": [
      {
        "id": "vice-captain-request:agree-on-specific-moments-you-will-step-in",
        "label": "Agree on specific moments you will step in",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "vice-captain-request:agree-on-specific-moments-you-will-step-in:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Shared cues keep the bench calm when momentum swings.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "vice-captain-request:agree-on-specific-moments-you-will-step-in:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You support quietly; nothing dramatic is required yet.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "vice-captain-request:agree-on-specific-moments-you-will-step-in:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Over-planning makes you stiff when a simpler word was enough.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "vice-captain-request:say-you-will-lead-by-example-without-extra-speec",
        "label": "Say you will lead by example without extra speeches",
        "disposition": "balanced",
        "results": [
          {
            "id": "vice-captain-request:say-you-will-lead-by-example-without-extra-speec:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Your actions settle a younger player after a bad call.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "vice-captain-request:say-you-will-lead-by-example-without-extra-speec:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "The match passes without a leadership flashpoint.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "vice-captain-request:say-you-will-lead-by-example-without-extra-speec:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You miss a moment to intervene and the captain covers alone.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "vice-captain-request:tell-them-you-are-ready-to-take-the-armband-your",
        "label": "Tell them you are ready to take the armband yourself soon",
        "disposition": "ambitious",
        "results": [
          {
            "id": "vice-captain-request:tell-them-you-are-ready-to-take-the-armband-your:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You speak with authority in a heated spell and the group responds.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "vice-captain-request:tell-them-you-are-ready-to-take-the-armband-your:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Ambition shows; the captain watches how far you push it.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "vice-captain-request:tell-them-you-are-ready-to-take-the-armband-your:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Your line about the armband lands awkwardly in the room.",
            "effects": [
              "morale"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "dressing-room-frustration",
    "title": "Dressing-room mood",
    "contentVersion": 2,
    "tags": [
      "club",
      "match"
    ],
    "eligibility": [
      "afterLoss"
    ],
    "setup": "A bitter loss leaves the dressing room flat. Some players want to dissect the game now; others need silence.",
    "choices": [
      {
        "id": "dressing-room-frustration:suggest-a-ten-minute-cool-down-then-a-brief-team",
        "label": "Suggest a ten-minute cool-down then a brief team talk",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "dressing-room-frustration:suggest-a-ten-minute-cool-down-then-a-brief-team:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "The room exhales and tomorrow's review will start on better footing.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "dressing-room-frustration:suggest-a-ten-minute-cool-down-then-a-brief-team:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Tension fades slowly; nobody breaks the silence badly.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "dressing-room-frustration:suggest-a-ten-minute-cool-down-then-a-brief-team:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Even your measured tone feels too soon for a few teammates.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "dressing-room-frustration:change-quietly-and-leave-analysis-for-tomorrow",
        "label": "Change quietly and leave analysis for tomorrow",
        "disposition": "balanced",
        "results": [
          {
            "id": "dressing-room-frustration:change-quietly-and-leave-analysis-for-tomorrow:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "You protect recovery time and sleep stays intact.",
            "effects": [
              "readiness"
            ]
          },
          {
            "id": "dressing-room-frustration:change-quietly-and-leave-analysis-for-tomorrow:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "The loss lingers without a constructive outlet tonight.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "dressing-room-frustration:change-quietly-and-leave-analysis-for-tomorrow:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Avoidance reads as indifference to a teammate who wanted talk.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "dressing-room-frustration:launch-into-who-failed-at-the-back-while-emotion",
        "label": "Launch into who failed at the back while emotions are raw",
        "disposition": "reckless",
        "results": [
          {
            "id": "dressing-room-frustration:launch-into-who-failed-at-the-back-while-emotion:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "A few agree loudly; most of the room shuts down.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "dressing-room-frustration:launch-into-who-failed-at-the-back-while-emotion:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Venting relieves you briefly and widens cracks elsewhere.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "dressing-room-frustration:launch-into-who-failed-at-the-back-while-emotion:negative",
            "abilityCategory": "negative",
            "delta": -3,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "The coach walks in mid-rant and trust takes a hit.",
            "effects": [
              "coachTrust"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "academy-player-trains-up",
    "title": "Academy invite",
    "contentVersion": 2,
    "tags": [
      "training",
      "club"
    ],
    "eligibility": [
      "senior"
    ],
    "setup": "An academy prospect trains with the seniors for the week. Staff want you to model habits without crushing their confidence.",
    "choices": [
      {
        "id": "academy-player-trains-up:offer-one-technical-tip-after-each-drill-they-jo",
        "label": "Offer one technical tip after each drill they join",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "academy-player-trains-up:offer-one-technical-tip-after-each-drill-they-jo:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Your tips land and their touch improves by Thursday.",
            "effects": [
              "training"
            ]
          },
          {
            "id": "academy-player-trains-up:offer-one-technical-tip-after-each-drill-they-jo:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You help a little; they mostly learn by watching.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "academy-player-trains-up:offer-one-technical-tip-after-each-drill-they-jo:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Too much instruction slows their natural play.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "academy-player-trains-up:include-them-in-rondos-without-making-it-a-lesso",
        "label": "Include them in rondos without making it a lesson",
        "disposition": "balanced",
        "results": [
          {
            "id": "academy-player-trains-up:include-them-in-rondos-without-making-it-a-lesso:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Inclusive rondos build respect both ways.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "academy-player-trains-up:include-them-in-rondos-without-making-it-a-lesso:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "The week is fine; mentoring is subtle.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "academy-player-trains-up:include-them-in-rondos-without-making-it-a-lesso:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You ignore them once and staff notice the missed chance.",
            "effects": [
              "coachTrust"
            ]
          }
        ]
      },
      {
        "id": "academy-player-trains-up:show-them-the-standard-by-dominating-every-duel",
        "label": "Show them the standard by dominating every duel",
        "disposition": "ambitious",
        "results": [
          {
            "id": "academy-player-trains-up:show-them-the-standard-by-dominating-every-duel:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "They see top speed and raise their own tempo.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "academy-player-trains-up:show-them-the-standard-by-dominating-every-duel:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Intensity inspires and intimidates in equal measure.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "academy-player-trains-up:show-them-the-standard-by-dominating-every-duel:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You nutmeg them twice and the coach asks for professionalism.",
            "effects": [
              "coachTrust"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "costly-error-review",
    "title": "Costly error",
    "contentVersion": 2,
    "tags": [
      "match",
      "training"
    ],
    "eligibility": [
      "matchErrorEvidence"
    ],
    "setup": "Video review opens on the mistake that cost the team last match. Your coach asks what you want to do with the clip.",
    "choices": [
      {
        "id": "costly-error-review:rewind-the-moment-with-staff-and-rebuild-the-dec",
        "label": "Rewind the moment with staff and rebuild the decision tree",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "costly-error-review:rewind-the-moment-with-staff-and-rebuild-the-dec:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You leave with a clear if-then cue for the same pressure.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "costly-error-review:rewind-the-moment-with-staff-and-rebuild-the-dec:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "The review stings briefly then fades into normal training.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "costly-error-review:rewind-the-moment-with-staff-and-rebuild-the-dec:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Reliving the clip shakes your confidence in the next live rep.",
            "effects": [
              "reputation"
            ]
          }
        ]
      },
      {
        "id": "costly-error-review:acknowledge-it-and-move-to-today-s-corrective-dr",
        "label": "Acknowledge it and move to today's corrective drill",
        "disposition": "balanced",
        "results": [
          {
            "id": "costly-error-review:acknowledge-it-and-move-to-today-s-corrective-dr:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "The corrective drill addresses the root issue cleanly.",
            "effects": [
              "training"
            ]
          },
          {
            "id": "costly-error-review:acknowledge-it-and-move-to-today-s-corrective-dr:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You patch the error without deep reflection.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "costly-error-review:acknowledge-it-and-move-to-today-s-corrective-dr:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "The same trigger appears in training and you repeat the mistake.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "costly-error-review:close-the-laptop-and-say-everyone-makes-those-er",
        "label": "Close the laptop and say everyone makes those errors",
        "disposition": "reckless",
        "results": [
          {
            "id": "costly-error-review:close-the-laptop-and-say-everyone-makes-those-er:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You move on mentally and play freely in the afternoon.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "costly-error-review:close-the-laptop-and-say-everyone-makes-those-er:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Dismissal keeps mood light; learning is thinner.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "costly-error-review:close-the-laptop-and-say-everyone-makes-those-er:negative",
            "abilityCategory": "negative",
            "delta": -3,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Staff read your shrug as unwillingness and limit your minutes.",
            "effects": [
              "coachTrust"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "missed-chance-response",
    "title": "Missed chance",
    "contentVersion": 2,
    "tags": [
      "match",
      "training"
    ],
    "eligibility": [
      "missedChanceEvidence"
    ],
    "setup": "Your big chance from the weekend is on the screen again. Teammates pretend not to stare while the coach waits for your reaction.",
    "choices": [
      {
        "id": "missed-chance-response:break-down-body-shape-and-pick-a-training-focus",
        "label": "Break down body shape and pick a training focus",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "missed-chance-response:break-down-body-shape-and-pick-a-training-focus:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "A finishing tweak shows up when the chance is recreated.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "missed-chance-response:break-down-body-shape-and-pick-a-training-focus:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You reset; the miss no longer dominates your head.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "missed-chance-response:break-down-body-shape-and-pick-a-training-focus:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Over-analysis makes your next shot snatched.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "missed-chance-response:laugh-it-off-once-and-concentrate-on-the-next-dr",
        "label": "Laugh it off once and concentrate on the next drill",
        "disposition": "balanced",
        "results": [
          {
            "id": "missed-chance-response:laugh-it-off-once-and-concentrate-on-the-next-dr:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Light humour defuses the room and you train normally.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "missed-chance-response:laugh-it-off-once-and-concentrate-on-the-next-dr:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "The moment passes without extra work on it.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "missed-chance-response:laugh-it-off-once-and-concentrate-on-the-next-dr:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Jokes land flat and someone thinks you do not care.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "missed-chance-response:demand-the-same-chance-recreated-until-you-score",
        "label": "Demand the same chance recreated until you score",
        "disposition": "ambitious",
        "results": [
          {
            "id": "missed-chance-response:demand-the-same-chance-recreated-until-you-score:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You bury three in a row in the recreated scenario.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "missed-chance-response:demand-the-same-chance-recreated-until-you-score:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Extra reps help though defenders start cheating the drill.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "missed-chance-response:demand-the-same-chance-recreated-until-you-score:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You argue for more time and the session runs late annoyed.",
            "effects": [
              "training"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "goalkeeper-rebound-review",
    "title": "Rebound duty",
    "contentVersion": 2,
    "tags": [
      "match",
      "training"
    ],
    "eligibility": [
      "gkReboundEvidence"
    ],
    "setup": "Clips show where you could have claimed or punched cleaner on rebounds. The goalkeeper coach wants a plan for the next matchweek.",
    "choices": [
      {
        "id": "goalkeeper-rebound-review:work-footwork-and-decision-triggers-with-the-gk-",
        "label": "Work footwork and decision triggers with the GK coach",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "goalkeeper-rebound-review:work-footwork-and-decision-triggers-with-the-gk-:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Your first-step speed to cutbacks looks sharper in training.",
            "effects": [
              "readiness"
            ]
          },
          {
            "id": "goalkeeper-rebound-review:work-footwork-and-decision-triggers-with-the-gk-:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Routine prep holds; rebound work is incremental.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "goalkeeper-rebound-review:work-footwork-and-decision-triggers-with-the-gk-:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "New cues clutter an already busy command sheet.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "goalkeeper-rebound-review:keep-your-usual-prep-and-note-one-rebound-cue",
        "label": "Keep your usual prep and note one rebound cue",
        "disposition": "balanced",
        "results": [
          {
            "id": "goalkeeper-rebound-review:keep-your-usual-prep-and-note-one-rebound-cue:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "One cue reduces a half-second hesitation on crosses.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "goalkeeper-rebound-review:keep-your-usual-prep-and-note-one-rebound-cue:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Standard prep leaves you neither worse nor better.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "goalkeeper-rebound-review:keep-your-usual-prep-and-note-one-rebound-cue:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You misjudge a floater in the next drill and the unit groans.",
            "effects": [
              "training"
            ]
          }
        ]
      },
      {
        "id": "goalkeeper-rebound-review:tell-the-unit-you-will-dominate-the-box-regardle",
        "label": "Tell the unit you will dominate the box regardless of scheme",
        "disposition": "ambitious",
        "results": [
          {
            "id": "goalkeeper-rebound-review:tell-the-unit-you-will-dominate-the-box-regardle:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Aggressive claiming sends a message in a crowded box drill.",
            "effects": [
              "training"
            ]
          },
          {
            "id": "goalkeeper-rebound-review:tell-the-unit-you-will-dominate-the-box-regardle:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Bold positioning works until a misread causes a scramble.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "goalkeeper-rebound-review:tell-the-unit-you-will-dominate-the-box-regardle:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You charge out once too often and concede a cheap training goal.",
            "effects": [
              "morale"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "unused-substitute-response",
    "title": "Unused sub",
    "contentVersion": 2,
    "tags": [
      "match",
      "club"
    ],
    "eligibility": [
      "unusedSubstitute"
    ],
    "setup": "You warmed up fully but stayed on the bench for the full ninety. The ride home is quiet and your legs still buzz.",
    "choices": [
      {
        "id": "unused-substitute-response:cool-down-properly-and-log-how-your-body-feels",
        "label": "Cool down properly and log how your body feels",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "unused-substitute-response:cool-down-properly-and-log-how-your-body-feels:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Proper cooling preserves readiness for the next session.",
            "effects": [
              "readiness",
              "training"
            ]
          },
          {
            "id": "unused-substitute-response:cool-down-properly-and-log-how-your-body-feels:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "You feel average tomorrow — neither sharp nor sore.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "unused-substitute-response:cool-down-properly-and-log-how-your-body-feels:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Residual stiffness from skipping steps shows up in activation.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "unused-substitute-response:shake-it-off-with-the-same-post-match-routine-as",
        "label": "Shake it off with the same post-match routine as starters",
        "disposition": "balanced",
        "results": [
          {
            "id": "unused-substitute-response:shake-it-off-with-the-same-post-match-routine-as:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Routine keeps mood stable heading into training.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "unused-substitute-response:shake-it-off-with-the-same-post-match-routine-as:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Disappointment lingers quietly.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "unused-substitute-response:shake-it-off-with-the-same-post-match-routine-as:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "You brood overnight and sleep is shorter.",
            "effects": [
              "readiness"
            ]
          }
        ]
      },
      {
        "id": "unused-substitute-response:skip-the-cool-down-and-vent-online-about-selecti",
        "label": "Skip the cool-down and vent online about selection",
        "disposition": "reckless",
        "results": [
          {
            "id": "unused-substitute-response:skip-the-cool-down-and-vent-online-about-selecti:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "The post feels cathartic in the moment.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "unused-substitute-response:skip-the-cool-down-and-vent-online-about-selecti:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Online venting fades; staff may still see it.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "unused-substitute-response:skip-the-cool-down-and-vent-online-about-selecti:negative",
            "abilityCategory": "negative",
            "delta": -3,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "A screenshot reaches the club and trust erodes quickly.",
            "effects": [
              "coachTrust"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "cup-elimination-response",
    "title": "Cup exit",
    "contentVersion": 2,
    "tags": [
      "match",
      "club"
    ],
    "eligibility": [
      "cupEliminated"
    ],
    "setup": "Cup elimination stings on a night you expected more minutes. The squad scatters on different travel times tomorrow.",
    "choices": [
      {
        "id": "cup-elimination-response:text-the-coach-a-brief-note-and-reset-sleep-toni",
        "label": "Text the coach a brief note and reset sleep tonight",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "cup-elimination-response:text-the-coach-a-brief-note-and-reset-sleep-toni:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Sleep and a clear note leave you professional for league focus.",
            "effects": [
              "readiness"
            ]
          },
          {
            "id": "cup-elimination-response:text-the-coach-a-brief-note-and-reset-sleep-toni:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "The exit hurts but your week structure stays intact.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "cup-elimination-response:text-the-coach-a-brief-note-and-reset-sleep-toni:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "You stare at the message draft too long and sleep late anyway.",
            "effects": [
              "readiness"
            ]
          }
        ]
      },
      {
        "id": "cup-elimination-response:put-it-behind-you-and-follow-the-recovery-plan",
        "label": "Put it behind you and follow the recovery plan",
        "disposition": "balanced",
        "results": [
          {
            "id": "cup-elimination-response:put-it-behind-you-and-follow-the-recovery-plan:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Recovery protocol keeps your body on schedule.",
            "effects": [
              "readiness"
            ]
          },
          {
            "id": "cup-elimination-response:put-it-behind-you-and-follow-the-recovery-plan:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Emotion flatlines into a normal training day.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "cup-elimination-response:put-it-behind-you-and-follow-the-recovery-plan:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Muted frustration leaks into a sluggish morning activation.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "cup-elimination-response:stay-out-late-telling-anyone-who-listens-the-tie",
        "label": "Stay out late telling anyone who listens the tie was unfair",
        "disposition": "reckless",
        "results": [
          {
            "id": "cup-elimination-response:stay-out-late-telling-anyone-who-listens-the-tie:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Night stories bond a few teammates who stayed out.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "cup-elimination-response:stay-out-late-telling-anyone-who-listens-the-tie:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Hangover readiness is not match readiness.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "cup-elimination-response:stay-out-late-telling-anyone-who-listens-the-tie:negative",
            "abilityCategory": "negative",
            "delta": -3,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Staff hear about the night out and question your focus.",
            "effects": [
              "coachTrust"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "strong-opponent-preparation",
    "title": "Big opponent",
    "contentVersion": 2,
    "tags": [
      "training",
      "match"
    ],
    "eligibility": [
      "strongOpponentUpcoming"
    ],
    "setup": "A top opponent arrives next. The staff tailor rehearsal to their press and your escape routes.",
    "choices": [
      {
        "id": "strong-opponent-preparation:map-their-press-triggers-with-the-analyst-before",
        "label": "Map their press triggers with the analyst before training",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "strong-opponent-preparation:map-their-press-triggers-with-the-analyst-before:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Your first escape in rehearsal beats the simulated press.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "strong-opponent-preparation:map-their-press-triggers-with-the-analyst-before:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Prep feels solid without a breakthrough moment.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "strong-opponent-preparation:map-their-press-triggers-with-the-analyst-before:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You memorize triggers that do not match what they actually run.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "strong-opponent-preparation:trust-the-game-plan-shared-in-the-meeting",
        "label": "Trust the game plan shared in the meeting",
        "disposition": "balanced",
        "results": [
          {
            "id": "strong-opponent-preparation:trust-the-game-plan-shared-in-the-meeting:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You execute the shared plan cleanly in the main unit.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "strong-opponent-preparation:trust-the-game-plan-shared-in-the-meeting:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Standard prep; belief is steady not soaring.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "strong-opponent-preparation:trust-the-game-plan-shared-in-the-meeting:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "A detail in their rotation catches you in the prep match.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "strong-opponent-preparation:tell-teammates-you-will-carry-the-game-on-your-o",
        "label": "Tell teammates you will carry the game on your own",
        "disposition": "ambitious",
        "results": [
          {
            "id": "strong-opponent-preparation:tell-teammates-you-will-carry-the-game-on-your-o:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You win the rehearsal duel and energy spikes.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "strong-opponent-preparation:tell-teammates-you-will-carry-the-game-on-your-o:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Big talk raises eyes; the collective plan still matters.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "strong-opponent-preparation:tell-teammates-you-will-carry-the-game-on-your-o:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Teammates tighten up hearing you claim the tie alone.",
            "effects": [
              "morale"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "achievement-comedown",
    "title": "After the high",
    "contentVersion": 2,
    "tags": [
      "club",
      "life"
    ],
    "eligibility": [
      "recentAchievement"
    ],
    "setup": "A personal award or milestone still glows on your phone. Training is back to mundane reps and smaller crowds.",
    "choices": [
      {
        "id": "achievement-comedown:thank-staff-privately-and-return-to-baseline-hab",
        "label": "Thank staff privately and return to baseline habits",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "achievement-comedown:thank-staff-privately-and-return-to-baseline-hab:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Gratitude lands well and your focus returns to the next match.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "achievement-comedown:thank-staff-privately-and-return-to-baseline-hab:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "The high fades on schedule.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "achievement-comedown:thank-staff-privately-and-return-to-baseline-hab:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "You over-thank everyone and miss the start of a drill.",
            "effects": [
              "training"
            ]
          }
        ]
      },
      {
        "id": "achievement-comedown:enjoy-the-memory-briefly-then-join-the-group-nor",
        "label": "Enjoy the memory briefly then join the group normally",
        "disposition": "balanced",
        "results": [
          {
            "id": "achievement-comedown:enjoy-the-memory-briefly-then-join-the-group-nor:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Normal habits keep performance steady.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "achievement-comedown:enjoy-the-memory-briefly-then-join-the-group-nor:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Neither uplift nor drop shows in training.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "achievement-comedown:enjoy-the-memory-briefly-then-join-the-group-nor:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Complacency slips into one lazy pressing run.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "achievement-comedown:lean-into-celebrations-all-week-with-late-nights",
        "label": "Lean into celebrations all week with late nights",
        "disposition": "reckless",
        "results": [
          {
            "id": "achievement-comedown:lean-into-celebrations-all-week-with-late-nights:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Stories from the night bond a clique on the squad.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "achievement-comedown:lean-into-celebrations-all-week-with-late-nights:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Fun costs an edge in Friday activation.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "achievement-comedown:lean-into-celebrations-all-week-with-late-nights:negative",
            "abilityCategory": "negative",
            "delta": -3,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Sleep debt and a missed curfew note reach the coach.",
            "effects": [
              "readiness",
              "coachTrust"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "high-stakes-run-in",
    "title": "Run-in pressure",
    "contentVersion": 2,
    "tags": [
      "match",
      "training"
    ],
    "eligibility": [
      "highStakesRunIn"
    ],
    "setup": "League arithmetic says every point matters now. The coach trims tactical talk to what you must execute.",
    "choices": [
      {
        "id": "high-stakes-run-in:write-three-non-negotiables-for-your-role-this-w",
        "label": "Write three non-negotiables for your role this week",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "high-stakes-run-in:write-three-non-negotiables-for-your-role-this-w:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Your non-negotiables show up cleanly in the rehearsal scoreline.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "high-stakes-run-in:write-three-non-negotiables-for-your-role-this-w:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Clarity helps without a standout swing.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "high-stakes-run-in:write-three-non-negotiables-for-your-role-this-w:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Too many rules make your play robotic in possession.",
            "effects": [
              "training"
            ]
          }
        ]
      },
      {
        "id": "high-stakes-run-in:keep-the-same-weekly-rhythm-that-got-you-here",
        "label": "Keep the same weekly rhythm that got you here",
        "disposition": "balanced",
        "results": [
          {
            "id": "high-stakes-run-in:keep-the-same-weekly-rhythm-that-got-you-here:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Steady rhythm preserves energy for the weekend.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "high-stakes-run-in:keep-the-same-weekly-rhythm-that-got-you-here:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "The run-in feels like any other week so far.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "high-stakes-run-in:keep-the-same-weekly-rhythm-that-got-you-here:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Routine hides a small tactical tweak you needed to absorb.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "high-stakes-run-in:demand-the-ball-in-every-drill-like-it-is-the-fi",
        "label": "Demand the ball in every drill like it is the final day",
        "disposition": "ambitious",
        "results": [
          {
            "id": "high-stakes-run-in:demand-the-ball-in-every-drill-like-it-is-the-fi:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You dominate possession drills and belief surges.",
            "effects": [
              "training"
            ]
          },
          {
            "id": "high-stakes-run-in:demand-the-ball-in-every-drill-like-it-is-the-fi:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "High demand lifts you and tires others occasionally.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "high-stakes-run-in:demand-the-ball-in-every-drill-like-it-is-the-fi:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You force play through traffic and turnover numbers spike.",
            "effects": [
              "morale"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "sleep-routine-disruption",
    "title": "Sleep disrupted",
    "contentVersion": 2,
    "tags": [
      "life",
      "training"
    ],
    "eligibility": [
      "senior"
    ],
    "setup": "Travel and a late fixture throw your sleep pattern off. Staff offer a modified morning plan.",
    "choices": [
      {
        "id": "sleep-routine-disruption:take-the-modified-activation-and-nap-window-offe",
        "label": "Take the modified activation and nap window offered",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "sleep-routine-disruption:take-the-modified-activation-and-nap-window-offe:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "You feel human again by the afternoon technical block.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "sleep-routine-disruption:take-the-modified-activation-and-nap-window-offe:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Grogginess fades slowly through the day.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "sleep-routine-disruption:take-the-modified-activation-and-nap-window-offe:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "You nap too long and miss a video meeting.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "sleep-routine-disruption:push-through-the-standard-morning-schedule",
        "label": "Push through the standard morning schedule",
        "disposition": "balanced",
        "results": [
          {
            "id": "sleep-routine-disruption:push-through-the-standard-morning-schedule:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "You survive the day without major errors.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "sleep-routine-disruption:push-through-the-standard-morning-schedule:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Readiness is average, not sharp.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "sleep-routine-disruption:push-through-the-standard-morning-schedule:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Heavy eyes cost you on the first explosive rep.",
            "effects": [
              "readiness"
            ]
          }
        ]
      },
      {
        "id": "sleep-routine-disruption:skip-sleep-advice-and-hammer-a-full-gym-session-",
        "label": "Skip sleep advice and hammer a full gym session instead",
        "disposition": "reckless",
        "results": [
          {
            "id": "sleep-routine-disruption:skip-sleep-advice-and-hammer-a-full-gym-session-:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "The gym blow-off clears your head temporarily.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "sleep-routine-disruption:skip-sleep-advice-and-hammer-a-full-gym-session-:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "You feel wired then crash before evening meal.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "sleep-routine-disruption:skip-sleep-advice-and-hammer-a-full-gym-session-:negative",
            "abilityCategory": "negative",
            "delta": -3,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Double fatigue hits tomorrow when the schedule stays full.",
            "effects": [
              "readiness"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "late-team-return",
    "title": "Late return",
    "contentVersion": 2,
    "tags": [
      "travel",
      "club"
    ],
    "eligibility": [
      "awayTravelReturn"
    ],
    "setup": "The squad bus reaches base well after midnight after an away trip. Recovery slots are staggered but video for the next opponent is already uploaded.",
    "choices": [
      {
        "id": "late-team-return:watch-the-shortened-clip-pack-then-sleep",
        "label": "Watch the shortened clip pack then sleep",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "late-team-return:watch-the-shortened-clip-pack-then-sleep:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "You bank sleep and still know the two triggers that matter.",
            "effects": [
              "readiness"
            ]
          },
          {
            "id": "late-team-return:watch-the-shortened-clip-pack-then-sleep:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Balance holds; detail is decent not exhaustive.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "late-team-return:watch-the-shortened-clip-pack-then-sleep:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Even the short pack keeps you up too late.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "late-team-return:sleep-first-and-catch-clips-at-breakfast",
        "label": "Sleep first and catch clips at breakfast",
        "disposition": "balanced",
        "results": [
          {
            "id": "late-team-return:sleep-first-and-catch-clips-at-breakfast:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Sleep preserves legs for the morning session.",
            "effects": [
              "readiness",
              "training"
            ]
          },
          {
            "id": "late-team-return:sleep-first-and-catch-clips-at-breakfast:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "You learn the opponent slightly later than peers.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "late-team-return:sleep-first-and-catch-clips-at-breakfast:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Breakfast cram leaves one gap the coach quizzes you on.",
            "effects": [
              "coachTrust"
            ]
          }
        ]
      },
      {
        "id": "late-team-return:stay-up-to-finish-every-minute-of-opponent-video",
        "label": "Stay up to finish every minute of opponent video tonight",
        "disposition": "ambitious",
        "results": [
          {
            "id": "late-team-return:stay-up-to-finish-every-minute-of-opponent-video:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "You enter training knowing their patterns cold.",
            "effects": [
              "training"
            ]
          },
          {
            "id": "late-team-return:stay-up-to-finish-every-minute-of-opponent-video:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Knowledge is high; legs feel the night in sprints.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "late-team-return:stay-up-to-finish-every-minute-of-opponent-video:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Exhaustion shows and the coach trims your afternoon load.",
            "effects": [
              "coachTrust"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "meal-preparation-schedule",
    "title": "Meal timing",
    "contentVersion": 2,
    "tags": [
      "life",
      "training"
    ],
    "eligibility": [
      "senior"
    ],
    "setup": "Nutrition staff flag that your matchday meal timing slipped last week. They propose a tighter schedule around training moves.",
    "choices": [
      {
        "id": "meal-preparation-schedule:follow-the-proposed-schedule-for-the-full-week",
        "label": "Follow the proposed schedule for the full week",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "meal-preparation-schedule:follow-the-proposed-schedule-for-the-full-week:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Energy in the late session feels even and controlled.",
            "effects": [
              "training"
            ]
          },
          {
            "id": "meal-preparation-schedule:follow-the-proposed-schedule-for-the-full-week:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "The plan works; cravings are manageable.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "meal-preparation-schedule:follow-the-proposed-schedule-for-the-full-week:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Rigid timing clashes with a family dinner and you stress.",
            "effects": [
              "support"
            ]
          }
        ]
      },
      {
        "id": "meal-preparation-schedule:eat-sensibly-without-obsessing-over-the-clock",
        "label": "Eat sensibly without obsessing over the clock",
        "disposition": "balanced",
        "results": [
          {
            "id": "meal-preparation-schedule:eat-sensibly-without-obsessing-over-the-clock:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "You fuel adequately for training demands.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "meal-preparation-schedule:eat-sensibly-without-obsessing-over-the-clock:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Nothing dramatic changes in performance.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "meal-preparation-schedule:eat-sensibly-without-obsessing-over-the-clock:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "A heavy unplanned lunch sits wrong in afternoon drills.",
            "effects": [
              "readiness",
              "training"
            ]
          }
        ]
      },
      {
        "id": "meal-preparation-schedule:skip-meals-to-cut-weight-quickly-before-photos",
        "label": "Skip meals to cut weight quickly before photos",
        "disposition": "reckless",
        "results": [
          {
            "id": "meal-preparation-schedule:skip-meals-to-cut-weight-quickly-before-photos:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "You look leaner in the mirror briefly.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "meal-preparation-schedule:skip-meals-to-cut-weight-quickly-before-photos:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Under-fueling shows as sluggish finishing.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "meal-preparation-schedule:skip-meals-to-cut-weight-quickly-before-photos:negative",
            "abilityCategory": "negative",
            "delta": -3,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Staff intervene when weight drops faster than agreed.",
            "effects": [
              "coachTrust"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "fitness-load-conversation",
    "title": "Load talk",
    "contentVersion": 2,
    "tags": [
      "training",
      "club"
    ],
    "eligibility": [
      "highWorkload"
    ],
    "setup": "Your rolling load is among the highest in the squad. The fitness coach wants an honest conversation about the next ten days.",
    "choices": [
      {
        "id": "fitness-load-conversation:agree-a-small-deload-with-clear-on-pitch-targets",
        "label": "Agree a small deload with clear on-pitch targets",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "fitness-load-conversation:agree-a-small-deload-with-clear-on-pitch-targets:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Targeted deload keeps you sharp for the weekend press.",
            "effects": [
              "readiness"
            ]
          },
          {
            "id": "fitness-load-conversation:agree-a-small-deload-with-clear-on-pitch-targets:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Adjustment is subtle; you feel similar.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "fitness-load-conversation:agree-a-small-deload-with-clear-on-pitch-targets:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "You negotiate too much volume back into the deload.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "fitness-load-conversation:say-you-feel-fine-and-keep-the-current-plan",
        "label": "Say you feel fine and keep the current plan",
        "disposition": "balanced",
        "results": [
          {
            "id": "fitness-load-conversation:say-you-feel-fine-and-keep-the-current-plan:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Honest check-in confirms you can handle the week.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "fitness-load-conversation:say-you-feel-fine-and-keep-the-current-plan:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Load stays high without incident today.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "fitness-load-conversation:say-you-feel-fine-and-keep-the-current-plan:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "A tight hamstring warns you on the last rep.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "fitness-load-conversation:ask-to-add-sprints-because-you-feel-unstoppable",
        "label": "Ask to add sprints because you feel unstoppable",
        "disposition": "ambitious",
        "results": [
          {
            "id": "fitness-load-conversation:ask-to-add-sprints-because-you-feel-unstoppable:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Extra sprints boost confidence before a big game.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "fitness-load-conversation:ask-to-add-sprints-because-you-feel-unstoppable:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "You feel elite now; tissue stress accumulates quietly.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "fitness-load-conversation:ask-to-add-sprints-because-you-feel-unstoppable:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "The physio stops you mid-session citing spike risk.",
            "effects": [
              "training"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "individual-recovery-responsibility",
    "title": "Recovery duty",
    "contentVersion": 2,
    "tags": [
      "training",
      "life"
    ],
    "eligibility": [
      "senior"
    ],
    "setup": "Recovery is mostly unsupervised today — pool, bike, mobility. Nobody counts reps unless something goes wrong.",
    "choices": [
      {
        "id": "individual-recovery-responsibility:complete-the-full-mobility-checklist-logged-on-t",
        "label": "Complete the full mobility checklist logged on the app",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "individual-recovery-responsibility:complete-the-full-mobility-checklist-logged-on-t:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "You enter tomorrow's session moving freely.",
            "effects": [
              "training"
            ]
          },
          {
            "id": "individual-recovery-responsibility:complete-the-full-mobility-checklist-logged-on-t:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Recovery is adequate for a normal week.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "individual-recovery-responsibility:complete-the-full-mobility-checklist-logged-on-t:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Overdoing mobility leaves you oddly tired.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "individual-recovery-responsibility:do-the-main-items-and-skip-the-optional-extras",
        "label": "Do the main items and skip the optional extras",
        "disposition": "balanced",
        "results": [
          {
            "id": "individual-recovery-responsibility:do-the-main-items-and-skip-the-optional-extras:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Essentials keep you on track with the squad.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "individual-recovery-responsibility:do-the-main-items-and-skip-the-optional-extras:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "You skip marginal gains.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "individual-recovery-responsibility:do-the-main-items-and-skip-the-optional-extras:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "A small stiffness appears after skipping hip work.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "individual-recovery-responsibility:leave-early-because-you-feel-fine-after-ten-minu",
        "label": "Leave early because you feel fine after ten minutes",
        "disposition": "reckless",
        "results": [
          {
            "id": "individual-recovery-responsibility:leave-early-because-you-feel-fine-after-ten-minu:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Extra free time boosts mood today.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "individual-recovery-responsibility:leave-early-because-you-feel-fine-after-ten-minu:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Cutting corners rarely shows immediately.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "individual-recovery-responsibility:leave-early-because-you-feel-fine-after-ten-minu:negative",
            "abilityCategory": "negative",
            "delta": -3,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Staff notice incomplete logs and question professionalism.",
            "effects": [
              "coachTrust"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "weather-disrupted-session",
    "title": "Weather change",
    "contentVersion": 2,
    "tags": [
      "training",
      "club"
    ],
    "eligibility": [
      "senior"
    ],
    "setup": "Rain turns the planned pitch session into a cramped indoor hall. Touch counts will be high and space tight.",
    "choices": [
      {
        "id": "weather-disrupted-session:adjust-touch-size-and-ask-for-a-role-specific-co",
        "label": "Adjust touch size and ask for a role-specific constraint",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "weather-disrupted-session:adjust-touch-size-and-ask-for-a-role-specific-co:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Constraints sharpen your tight-space decision making.",
            "effects": [
              "readiness"
            ]
          },
          {
            "id": "weather-disrupted-session:adjust-touch-size-and-ask-for-a-role-specific-co:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Indoor work helps without a breakout moment.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "weather-disrupted-session:adjust-touch-size-and-ask-for-a-role-specific-co:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You over-handle and lose the passing rhythm.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "weather-disrupted-session:play-the-futsal-style-session-as-designed",
        "label": "Play the futsal-style session as designed",
        "disposition": "balanced",
        "results": [
          {
            "id": "weather-disrupted-session:play-the-futsal-style-session-as-designed:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You adapt quickly to the smaller surface.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "weather-disrupted-session:play-the-futsal-style-session-as-designed:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "The session passes as a useful touch-up.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "weather-disrupted-session:play-the-futsal-style-session-as-designed:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "A sloppy turn gifts a transition the coach hates.",
            "effects": [
              "coachTrust"
            ]
          }
        ]
      },
      {
        "id": "weather-disrupted-session:treat-it-like-a-street-contest-and-dribble-at-ev",
        "label": "Treat it like a street contest and dribble at every chance",
        "disposition": "ambitious",
        "results": [
          {
            "id": "weather-disrupted-session:treat-it-like-a-street-contest-and-dribble-at-ev:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You beat three players in a row and lift the group.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "weather-disrupted-session:treat-it-like-a-street-contest-and-dribble-at-ev:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Flashy dribbles mix with lost possession.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "weather-disrupted-session:treat-it-like-a-street-contest-and-dribble-at-ev:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You nutmeg a senior and the drill turns overly physical.",
            "effects": [
              "training"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "cleared-full-training",
    "title": "Full training",
    "contentVersion": 2,
    "tags": [
      "training",
      "club"
    ],
    "eligibility": [
      "clearedFullTraining"
    ],
    "setup": "Medical staff clear you for full contact after a knock. The coach wants to see confidence as much as fitness.",
    "choices": [
      {
        "id": "cleared-full-training:build-through-controlled-contact-before-live-tac",
        "label": "Build through controlled contact before live tackling",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "cleared-full-training:build-through-controlled-contact-before-live-tac:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Gradual contact rebuilds trust in the injured side.",
            "effects": [
              "coachTrust"
            ]
          },
          {
            "id": "cleared-full-training:build-through-controlled-contact-before-live-tac:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You complete training without setback.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "cleared-full-training:build-through-controlled-contact-before-live-tac:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Caution makes you half a step late on a 50-50.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "cleared-full-training:join-every-drill-at-normal-intensity-immediately",
        "label": "Join every drill at normal intensity immediately",
        "disposition": "balanced",
        "results": [
          {
            "id": "cleared-full-training:join-every-drill-at-normal-intensity-immediately:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Normal intensity shows the knock is behind you.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "cleared-full-training:join-every-drill-at-normal-intensity-immediately:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Performance is steady; burst is still returning.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "cleared-full-training:join-every-drill-at-normal-intensity-immediately:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "One awkward landing reminds you to respect the heal.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "cleared-full-training:fly-into-the-hardest-duel-first-to-send-a-messag",
        "label": "Fly into the hardest duel first to send a message",
        "disposition": "ambitious",
        "results": [
          {
            "id": "cleared-full-training:fly-into-the-hardest-duel-first-to-send-a-messag:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You win the first duel and the bench reacts.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "cleared-full-training:fly-into-the-hardest-duel-first-to-send-a-messag:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Aggression proves fitness; timing is occasionally rash.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "cleared-full-training:fly-into-the-hardest-duel-first-to-send-a-messag:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You reopen the knock and the physio pulls you immediately.",
            "effects": [
              "reputation"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "long-international-journey",
    "title": "After international travel",
    "contentVersion": 2,
    "tags": [
      "travel",
      "international"
    ],
    "eligibility": [
      "returnFromNationalTrip"
    ],
    "setup": "You land from national-team duty with jet lag and a club session in thirty-six hours. Messages from both staffs offer different priorities.",
    "choices": [
      {
        "id": "long-international-journey:sync-with-club-physio-on-sleep-and-a-tapered-fir",
        "label": "Sync with club physio on sleep and a tapered first session",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "long-international-journey:sync-with-club-physio-on-sleep-and-a-tapered-fir:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Tapered work leaves you clear-headed for travel day two.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "long-international-journey:sync-with-club-physio-on-sleep-and-a-tapered-fir:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Adaptation is gradual but stable.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "long-international-journey:sync-with-club-physio-on-sleep-and-a-tapered-fir:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Mis-timed sleep pills groggier you at morning activation.",
            "effects": [
              "readiness"
            ]
          }
        ]
      },
      {
        "id": "long-international-journey:train-as-usual-and-let-match-rhythm-catch-up",
        "label": "Train as usual and let match rhythm catch up",
        "disposition": "balanced",
        "results": [
          {
            "id": "long-international-journey:train-as-usual-and-let-match-rhythm-catch-up:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Club rhythm returns without drama.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "long-international-journey:train-as-usual-and-let-match-rhythm-catch-up:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Jet lag lingers quietly through the week.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "long-international-journey:train-as-usual-and-let-match-rhythm-catch-up:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "You mis-time a run and pick up a avoidable knock.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "long-international-journey:insist-on-starting-the-next-match-to-prove-loyal",
        "label": "Insist on starting the next match to prove loyalty",
        "disposition": "ambitious",
        "results": [
          {
            "id": "long-international-journey:insist-on-starting-the-next-match-to-prove-loyal:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Your declaration fires up supporters and staff debate minutes.",
            "effects": [
              "coachTrust",
              "reputation"
            ]
          },
          {
            "id": "long-international-journey:insist-on-starting-the-next-match-to-prove-loyal:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Ambition shows; body may not fully agree yet.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "long-international-journey:insist-on-starting-the-next-match-to-prove-loyal:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "You play tired and the coach protects you after.",
            "effects": [
              "coachTrust"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "critical-column",
    "title": "Critical press",
    "contentVersion": 2,
    "tags": [
      "media",
      "match"
    ],
    "eligibility": [
      "poorFormEvidence"
    ],
    "setup": "A columnist questions your form and singles out one recurring flaw. Teammates have seen the headline on their phones.",
    "choices": [
      {
        "id": "critical-column:ask-staff-for-a-private-clip-pack-on-that-flaw",
        "label": "Ask staff for a private clip pack on that flaw",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "critical-column:ask-staff-for-a-private-clip-pack-on-that-flaw:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Targeted work on the flaw shows in the next training clip.",
            "effects": [
              "reputation"
            ]
          },
          {
            "id": "critical-column:ask-staff-for-a-private-clip-pack-on-that-flaw:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Form steadies without a dramatic fix.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "critical-column:ask-staff-for-a-private-clip-pack-on-that-flaw:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Obsessing on criticism makes you tight in possession.",
            "effects": [
              "training"
            ]
          }
        ]
      },
      {
        "id": "critical-column:ignore-the-noise-and-train-normally",
        "label": "Ignore the noise and train normally",
        "disposition": "balanced",
        "results": [
          {
            "id": "critical-column:ignore-the-noise-and-train-normally:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Blocking noise preserves composure.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "critical-column:ignore-the-noise-and-train-normally:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "The column lingers in the back of your mind.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "critical-column:ignore-the-noise-and-train-normally:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "A passive training day fits the narrative unfortunately.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "critical-column:call-the-writer-out-on-social-media",
        "label": "Call the writer out on social media",
        "disposition": "reckless",
        "results": [
          {
            "id": "critical-column:call-the-writer-out-on-social-media:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Your reply trends and some fans rally.",
            "effects": [
              "reputation"
            ]
          },
          {
            "id": "critical-column:call-the-writer-out-on-social-media:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Online heat distracts from preparation.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "critical-column:call-the-writer-out-on-social-media:negative",
            "abilityCategory": "negative",
            "delta": -3,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "The club media team asks you to delete the post.",
            "effects": [
              "reputation"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "viral-training-clip",
    "title": "Viral clip",
    "contentVersion": 2,
    "tags": [
      "media",
      "training"
    ],
    "eligibility": [
      "senior"
    ],
    "setup": "A phone clip of your training trick spreads overnight. Strangers tag you; sponsors notice.",
    "choices": [
      {
        "id": "viral-training-clip:thank-staff-and-keep-the-rest-of-the-week-low-ke",
        "label": "Thank staff and keep the rest of the week low-key",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "viral-training-clip:thank-staff-and-keep-the-rest-of-the-week-low-ke:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Humility keeps coach trust while confidence stays up.",
            "effects": [
              "coachTrust"
            ]
          },
          {
            "id": "viral-training-clip:thank-staff-and-keep-the-rest-of-the-week-low-ke:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "The moment passes without changing your schedule.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "viral-training-clip:thank-staff-and-keep-the-rest-of-the-week-low-ke:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Over-modesty makes you seem unsure of your own skill.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "viral-training-clip:enjoy-it-briefly-then-focus-on-the-next-session",
        "label": "Enjoy it briefly then focus on the next session",
        "disposition": "balanced",
        "results": [
          {
            "id": "viral-training-clip:enjoy-it-briefly-then-focus-on-the-next-session:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Normal training prevents distraction.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "viral-training-clip:enjoy-it-briefly-then-focus-on-the-next-session:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Virality fades before the weekend.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "viral-training-clip:enjoy-it-briefly-then-focus-on-the-next-session:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You try the trick once too often and annoy the unit.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "viral-training-clip:ask-to-recreate-the-trick-for-club-media-every-d",
        "label": "Ask to recreate the trick for club media every day",
        "disposition": "ambitious",
        "results": [
          {
            "id": "viral-training-clip:ask-to-recreate-the-trick-for-club-media-every-d:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Extra content boosts your profile neatly.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "viral-training-clip:ask-to-recreate-the-trick-for-club-media-every-d:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Media time eats recovery minutes.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "viral-training-clip:ask-to-recreate-the-trick-for-club-media-every-d:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "A failed recreate becomes the clip people share instead.",
            "effects": [
              "reputation"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "long-interview-invitation",
    "title": "Long interview",
    "contentVersion": 2,
    "tags": [
      "media",
      "life"
    ],
    "eligibility": [
      "senior"
    ],
    "setup": "A podcast wants two hours midweek to discuss your career arc. Club media say it is approved if you manage recovery.",
    "choices": [
      {
        "id": "long-interview-invitation:schedule-it-after-training-with-a-hard-stop-time",
        "label": "Schedule it after training with a hard stop time",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "long-interview-invitation:schedule-it-after-training-with-a-hard-stop-time:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Structured timing keeps legs fresh for the session after.",
            "effects": [
              "training"
            ]
          },
          {
            "id": "long-interview-invitation:schedule-it-after-training-with-a-hard-stop-time:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Interview fits without stealing focus.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "long-interview-invitation:schedule-it-after-training-with-a-hard-stop-time:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Even with a stop time, mental fatigue shows late.",
            "effects": [
              "readiness"
            ]
          }
        ]
      },
      {
        "id": "long-interview-invitation:decline-and-protect-the-full-recovery-window",
        "label": "Decline and protect the full recovery window",
        "disposition": "balanced",
        "results": [
          {
            "id": "long-interview-invitation:decline-and-protect-the-full-recovery-window:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Recovery wins; nobody questions the call.",
            "effects": [
              "readiness"
            ]
          },
          {
            "id": "long-interview-invitation:decline-and-protect-the-full-recovery-window:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Opportunity passes quietly.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "long-interview-invitation:decline-and-protect-the-full-recovery-window:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Some supporters wanted the story and read absence as arrogance.",
            "effects": [
              "reputation"
            ]
          }
        ]
      },
      {
        "id": "long-interview-invitation:accept-and-treat-it-as-main-event-energy-all-day",
        "label": "Accept and treat it as main event energy all day",
        "disposition": "ambitious",
        "results": [
          {
            "id": "long-interview-invitation:accept-and-treat-it-as-main-event-energy-all-day:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "The episode lands well and your name trends.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "long-interview-invitation:accept-and-treat-it-as-main-event-energy-all-day:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Buzz is real; sleep is shorter than planned.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "long-interview-invitation:accept-and-treat-it-as-main-event-energy-all-day:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "You sound flat in training after late recording.",
            "effects": [
              "morale"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "supporter-criticism-encounter",
    "title": "Supporter encounter",
    "contentVersion": 2,
    "tags": [
      "life",
      "match"
    ],
    "eligibility": [
      "poorFormEvidence"
    ],
    "setup": "Leaving training, a supporter shouts criticism about your recent performances. Security is nearby but not intervening yet.",
    "choices": [
      {
        "id": "supporter-criticism-encounter:acknowledge-them-calmly-and-keep-walking",
        "label": "Acknowledge them calmly and keep walking",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "supporter-criticism-encounter:acknowledge-them-calmly-and-keep-walking:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Measured response defuses the moment; staff approve.",
            "effects": [
              "coachTrust"
            ]
          },
          {
            "id": "supporter-criticism-encounter:acknowledge-them-calmly-and-keep-walking:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Nothing escalates; mood is unchanged.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "supporter-criticism-encounter:acknowledge-them-calmly-and-keep-walking:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Engaging at all gives a quote someone records.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "supporter-criticism-encounter:ignore-and-focus-on-getting-to-the-car",
        "label": "Ignore and focus on getting to the car",
        "disposition": "balanced",
        "results": [
          {
            "id": "supporter-criticism-encounter:ignore-and-focus-on-getting-to-the-car:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Silence keeps you in control of the narrative.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "supporter-criticism-encounter:ignore-and-focus-on-getting-to-the-car:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "The shout sticks in your head briefly.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "supporter-criticism-encounter:ignore-and-focus-on-getting-to-the-car:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Ignored anger sometimes grows louder next time.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "supporter-criticism-encounter:shout-back-and-invite-them-to-say-it-again",
        "label": "Shout back and invite them to say it again",
        "disposition": "reckless",
        "results": [
          {
            "id": "supporter-criticism-encounter:shout-back-and-invite-them-to-say-it-again:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "A few fans film the exchange for clicks.",
            "effects": [
              "reputation"
            ]
          },
          {
            "id": "supporter-criticism-encounter:shout-back-and-invite-them-to-say-it-again:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Heat fades but clips remain online.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "supporter-criticism-encounter:shout-back-and-invite-them-to-say-it-again:negative",
            "abilityCategory": "negative",
            "delta": -3,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Security step in and the club issues a conduct reminder.",
            "effects": [
              "morale"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "agent-public-comments",
    "title": "Agent quotes",
    "contentVersion": 2,
    "tags": [
      "media",
      "club"
    ],
    "eligibility": [
      "senior"
    ],
    "setup": "Your agent speaks publicly about your ambitions and playing time. The coach has not mentioned it yet; teammates have.",
    "choices": [
      {
        "id": "agent-public-comments:call-your-agent-and-align-on-club-first-messagin",
        "label": "Call your agent and align on club-first messaging",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "agent-public-comments:call-your-agent-and-align-on-club-first-messagin:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Aligned messaging calms the room before training starts.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "agent-public-comments:call-your-agent-and-align-on-club-first-messagin:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Rumours quiet without a public statement.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "agent-public-comments:call-your-agent-and-align-on-club-first-messagin:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "The call takes hours and drains pre-session focus.",
            "effects": [
              "training"
            ]
          }
        ]
      },
      {
        "id": "agent-public-comments:say-nothing-publicly-and-let-the-club-handle-it",
        "label": "Say nothing publicly and let the club handle it",
        "disposition": "balanced",
        "results": [
          {
            "id": "agent-public-comments:say-nothing-publicly-and-let-the-club-handle-it:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Silence keeps you professional inside the building.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "agent-public-comments:say-nothing-publicly-and-let-the-club-handle-it:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Uncertainty lingers in the background.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "agent-public-comments:say-nothing-publicly-and-let-the-club-handle-it:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Teammates assume you knew about the quotes beforehand.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "agent-public-comments:agree-with-the-agent-on-camera-to-force-the-issu",
        "label": "Agree with the agent on camera to force the issue",
        "disposition": "ambitious",
        "results": [
          {
            "id": "agent-public-comments:agree-with-the-agent-on-camera-to-force-the-issu:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Bold alignment spikes transfer talk immediately.",
            "effects": [
              "reputation"
            ]
          },
          {
            "id": "agent-public-comments:agree-with-the-agent-on-camera-to-force-the-issu:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Pressure rises on you to back words with form.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "agent-public-comments:agree-with-the-agent-on-camera-to-force-the-issu:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Coach trust drops after the interview airs.",
            "effects": [
              "coachTrust"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "community-coaching-workshop",
    "title": "Community workshop",
    "contentVersion": 2,
    "tags": [
      "life",
      "club"
    ],
    "eligibility": [
      "senior"
    ],
    "setup": "The club asks you to lead a short technique workshop for local youth before travel. It is optional but visible.",
    "choices": [
      {
        "id": "community-coaching-workshop:prepare-two-simple-drills-and-keep-it-structured",
        "label": "Prepare two simple drills and keep it structured",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "community-coaching-workshop:prepare-two-simple-drills-and-keep-it-structured:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Kids leave with a clear skill; parents thank the club.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "community-coaching-workshop:prepare-two-simple-drills-and-keep-it-structured:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Goodwill rises without costing much energy.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "community-coaching-workshop:prepare-two-simple-drills-and-keep-it-structured:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Over-running the slot makes you late for activation.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "community-coaching-workshop:show-up-and-play-small-sided-with-them-casually",
        "label": "Show up and play small-sided with them casually",
        "disposition": "balanced",
        "results": [
          {
            "id": "community-coaching-workshop:show-up-and-play-small-sided-with-them-casually:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Casual play lifts mood and keeps it fun.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "community-coaching-workshop:show-up-and-play-small-sided-with-them-casually:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Community wins; coaching detail is light.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "community-coaching-workshop:show-up-and-play-small-sided-with-them-casually:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "You skip stretching after and feel tight later.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "community-coaching-workshop:turn-it-into-a-skills-showcase-for-cameras",
        "label": "Turn it into a skills showcase for cameras",
        "disposition": "ambitious",
        "results": [
          {
            "id": "community-coaching-workshop:turn-it-into-a-skills-showcase-for-cameras:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Highlights reel boosts club brand and your face.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "community-coaching-workshop:turn-it-into-a-skills-showcase-for-cameras:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Showboating inspires some kids and annoys staff timing.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "community-coaching-workshop:turn-it-into-a-skills-showcase-for-cameras:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "A trick attempt goes wrong on wet turf and you tweak an ankle.",
            "effects": [
              "morale"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "dressing-room-photo-request",
    "title": "Dressing-room photo",
    "contentVersion": 2,
    "tags": [
      "media",
      "club"
    ],
    "eligibility": [
      "senior"
    ],
    "setup": "A teammate wants a celebratory dressing-room photo after a win. Club rules require media officer approval.",
    "choices": [
      {
        "id": "dressing-room-photo-request:ask-the-media-officer-for-a-quick-approved-snap",
        "label": "Ask the media officer for a quick approved snap",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "dressing-room-photo-request:ask-the-media-officer-for-a-quick-approved-snap:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Approved photo lands clean and boosts morale online.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "dressing-room-photo-request:ask-the-media-officer-for-a-quick-approved-snap:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "You celebrate privately without wider reach.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "dressing-room-photo-request:ask-the-media-officer-for-a-quick-approved-snap:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Waiting kills the moment and the group moves on.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "dressing-room-photo-request:skip-the-photo-and-celebrate-inside-the-room-onl",
        "label": "Skip the photo and celebrate inside the room only",
        "disposition": "balanced",
        "results": [
          {
            "id": "dressing-room-photo-request:skip-the-photo-and-celebrate-inside-the-room-onl:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Rules respected; bonding stays in-house.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "dressing-room-photo-request:skip-the-photo-and-celebrate-inside-the-room-onl:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "No photo means no external story — fine by you.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "dressing-room-photo-request:skip-the-photo-and-celebrate-inside-the-room-onl:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Some teammates wanted the memory shared publicly.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "dressing-room-photo-request:post-immediately-before-approval-arrives",
        "label": "Post immediately before approval arrives",
        "disposition": "reckless",
        "results": [
          {
            "id": "dressing-room-photo-request:post-immediately-before-approval-arrives:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Instant post trends before compliance checks finish.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "dressing-room-photo-request:post-immediately-before-approval-arrives:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Likes roll in; compliance team flags the upload.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "dressing-room-photo-request:post-immediately-before-approval-arrives:negative",
            "abilityCategory": "negative",
            "delta": -3,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Unauthorized background details force a takedown and fine.",
            "effects": [
              "morale"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "misquoted-comment",
    "title": "Misquote",
    "contentVersion": 2,
    "tags": [
      "media",
      "club"
    ],
    "eligibility": [
      "senior"
    ],
    "setup": "A newspaper misquotes your post-match comment and twists the meaning. Corrective options range from silence to escalation.",
    "choices": [
      {
        "id": "misquoted-comment:work-with-club-media-on-a-brief-clarification",
        "label": "Work with club media on a brief clarification",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "misquoted-comment:work-with-club-media-on-a-brief-clarification:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Clarification steers the story back without drama.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "misquoted-comment:work-with-club-media-on-a-brief-clarification:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "The misquote loses steam in a day.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "misquoted-comment:work-with-club-media-on-a-brief-clarification:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Correction draws more eyes to the original headline.",
            "effects": [
              "reputation"
            ]
          }
        ]
      },
      {
        "id": "misquoted-comment:let-it-fade-unless-asked-directly",
        "label": "Let it fade unless asked directly",
        "disposition": "balanced",
        "results": [
          {
            "id": "misquoted-comment:let-it-fade-unless-asked-directly:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Silence avoids a second news cycle.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "misquoted-comment:let-it-fade-unless-asked-directly:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Some supporters still believe the bad quote.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "misquoted-comment:let-it-fade-unless-asked-directly:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "A teammate answers for you and misses context.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "misquoted-comment:rant-about-the-journalist-on-live-stream",
        "label": "Rant about the journalist on live stream",
        "disposition": "reckless",
        "results": [
          {
            "id": "misquoted-comment:rant-about-the-journalist-on-live-stream:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Fans enjoy the fire; journalists enjoy it more.",
            "effects": [
              "reputation"
            ]
          },
          {
            "id": "misquoted-comment:rant-about-the-journalist-on-live-stream:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Stream venting feels good then looks unprofessional.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "misquoted-comment:rant-about-the-journalist-on-live-stream:negative",
            "abilityCategory": "negative",
            "delta": -3,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Club fines and sponsor emails follow quickly.",
            "effects": [
              "morale"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "language-learning-routine",
    "title": "Language routine",
    "contentVersion": 2,
    "tags": [
      "life",
      "club"
    ],
    "eligibility": [
      "languageAdaptationNeed"
    ],
    "setup": "Daily life and changing-room banter still outpace your grasp of the local language. The club offers optional tutoring slots.",
    "choices": [
      {
        "id": "language-learning-routine:book-tutoring-and-drill-football-phrases-nightly",
        "label": "Book tutoring and drill football phrases nightly",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "language-learning-routine:book-tutoring-and-drill-football-phrases-nightly:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "You understand tactical shouts earlier in sessions.",
            "effects": [
              "training"
            ]
          },
          {
            "id": "language-learning-routine:book-tutoring-and-drill-football-phrases-nightly:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Progress is steady; jokes still fly past you.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "language-learning-routine:book-tutoring-and-drill-football-phrases-nightly:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Evening study cuts into sleep once midweek.",
            "effects": [
              "readiness"
            ]
          }
        ]
      },
      {
        "id": "language-learning-routine:learn-phrases-ad-hoc-from-teammates",
        "label": "Learn phrases ad hoc from teammates",
        "disposition": "balanced",
        "results": [
          {
            "id": "language-learning-routine:learn-phrases-ad-hoc-from-teammates:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Teammate lessons build rapport slowly.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "language-learning-routine:learn-phrases-ad-hoc-from-teammates:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Functional communication works on pitch.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "language-learning-routine:learn-phrases-ad-hoc-from-teammates:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "A misunderstood joke lands awkwardly at lunch.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "language-learning-routine:rely-on-english-and-body-language-only",
        "label": "Rely on English and body language only",
        "disposition": "ambitious",
        "results": [
          {
            "id": "language-learning-routine:rely-on-english-and-body-language-only:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "On-pitch English carries you for now.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "language-learning-routine:rely-on-english-and-body-language-only:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Isolation outside football shrinks slowly.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "language-learning-routine:rely-on-english-and-body-language-only:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Coach frustration grows when calls are missed in drills.",
            "effects": [
              "coachTrust",
              "training"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "new-city-commute",
    "title": "New commute",
    "contentVersion": 2,
    "tags": [
      "life",
      "club"
    ],
    "eligibility": [
      "recentClubMove"
    ],
    "setup": "Your new club city means a longer commute and unfamiliar traffic patterns. Arrival times at the training ground have wobbled.",
    "choices": [
      {
        "id": "new-city-commute:test-routes-this-week-and-build-a-buffer",
        "label": "Test routes this week and build a buffer",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "new-city-commute:test-routes-this-week-and-build-a-buffer:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Consistent early arrival impresses staff.",
            "effects": [
              "coachTrust"
            ]
          },
          {
            "id": "new-city-commute:test-routes-this-week-and-build-a-buffer:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Commute stress drops after a few days.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "new-city-commute:test-routes-this-week-and-build-a-buffer:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Over-buffering costs morning recovery time at home.",
            "effects": [
              "readiness",
              "support"
            ]
          }
        ]
      },
      {
        "id": "new-city-commute:leave-at-the-same-time-and-adjust-if-late",
        "label": "Leave at the same time and adjust if late",
        "disposition": "balanced",
        "results": [
          {
            "id": "new-city-commute:leave-at-the-same-time-and-adjust-if-late:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Most days you arrive on time.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "new-city-commute:leave-at-the-same-time-and-adjust-if-late:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Occasional lateness is noted quietly.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "new-city-commute:leave-at-the-same-time-and-adjust-if-late:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Traffic wins twice and the coach mentions punctuality.",
            "effects": [
              "coachTrust"
            ]
          }
        ]
      },
      {
        "id": "new-city-commute:cut-it-close-daily-to-maximize-sleep",
        "label": "Cut it close daily to maximize sleep",
        "disposition": "reckless",
        "results": [
          {
            "id": "new-city-commute:cut-it-close-daily-to-maximize-sleep:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Extra sleep helps legs occasionally.",
            "effects": [
              "readiness"
            ]
          },
          {
            "id": "new-city-commute:cut-it-close-daily-to-maximize-sleep:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Near-miss lateness adds weekly stress.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "new-city-commute:cut-it-close-daily-to-maximize-sleep:negative",
            "abilityCategory": "negative",
            "delta": -3,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "You arrive flustered twice and prep suffers.",
            "effects": [
              "morale"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "family-visit-matchweek",
    "title": "Family visit",
    "contentVersion": 2,
    "tags": [
      "life",
      "club"
    ],
    "eligibility": [
      "senior"
    ],
    "setup": "Family fly in for matchweek. They want time around training, media, and recovery blocks.",
    "choices": [
      {
        "id": "family-visit-matchweek:block-clear-windows-for-them-around-staff-schedu",
        "label": "Block clear windows for them around staff schedule",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "family-visit-matchweek:block-clear-windows-for-them-around-staff-schedu:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "support",
            "text": "Quality time without schedule clashes lifts home mood.",
            "effects": [
              "support"
            ]
          },
          {
            "id": "family-visit-matchweek:block-clear-windows-for-them-around-staff-schedu:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "support",
            "text": "Family feels included; performance stays steady.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "family-visit-matchweek:block-clear-windows-for-them-around-staff-schedu:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "support",
            "text": "Planning talks eat mental space before a tactical meeting.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "family-visit-matchweek:fit-visits-between-whatever-gaps-appear",
        "label": "Fit visits between whatever gaps appear",
        "disposition": "balanced",
        "results": [
          {
            "id": "family-visit-matchweek:fit-visits-between-whatever-gaps-appear:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "support",
            "text": "Flexible visits work most days.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "family-visit-matchweek:fit-visits-between-whatever-gaps-appear:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "support",
            "text": "Some plans fall through when session runs long.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "family-visit-matchweek:fit-visits-between-whatever-gaps-appear:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "support",
            "text": "A missed dinner frustrates someone you care about.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "family-visit-matchweek:bring-them-into-the-training-ground-unannounced",
        "label": "Bring them into the training ground unannounced",
        "disposition": "ambitious",
        "results": [
          {
            "id": "family-visit-matchweek:bring-them-into-the-training-ground-unannounced:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "support",
            "text": "They feel special seeing inner workings.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "family-visit-matchweek:bring-them-into-the-training-ground-unannounced:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "support",
            "text": "Rules bend once; staff remember.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "family-visit-matchweek:bring-them-into-the-training-ground-unannounced:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "support",
            "text": "Unauthorized access draws a compliance warning.",
            "effects": [
              "morale"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "quiet-time-or-social-invite",
    "title": "Quiet or social",
    "contentVersion": 2,
    "tags": [
      "life",
      "club"
    ],
    "eligibility": [
      "senior"
    ],
    "setup": "Teammates invite you out the night before a light session. You also promised yourself quiet recovery at home.",
    "choices": [
      {
        "id": "quiet-time-or-social-invite:join-for-one-hour-then-head-home-on-schedule",
        "label": "Join for one hour then head home on schedule",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "quiet-time-or-social-invite:join-for-one-hour-then-head-home-on-schedule:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "support",
            "text": "Brief social time helps mood without costing sleep.",
            "effects": [
              "readiness"
            ]
          },
          {
            "id": "quiet-time-or-social-invite:join-for-one-hour-then-head-home-on-schedule:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "support",
            "text": "Balance feels sustainable through the week.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "quiet-time-or-social-invite:join-for-one-hour-then-head-home-on-schedule:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "support",
            "text": "One more drink request makes you late leaving.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "quiet-time-or-social-invite:skip-and-recharge-alone",
        "label": "Skip and recharge alone",
        "disposition": "balanced",
        "results": [
          {
            "id": "quiet-time-or-social-invite:skip-and-recharge-alone:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "support",
            "text": "Solitude resets your head clearly.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "quiet-time-or-social-invite:skip-and-recharge-alone:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "support",
            "text": "You miss bonding that helps younger players.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "quiet-time-or-social-invite:skip-and-recharge-alone:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "support",
            "text": "Isolation feels heavier than you expected.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "quiet-time-or-social-invite:stay-out-late-you-only-live-once-this-week",
        "label": "Stay out late — you only live once this week",
        "disposition": "ambitious",
        "results": [
          {
            "id": "quiet-time-or-social-invite:stay-out-late-you-only-live-once-this-week:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "support",
            "text": "Stories from the night tighten squad bonds.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "quiet-time-or-social-invite:stay-out-late-you-only-live-once-this-week:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "support",
            "text": "Late return whispers into morning activation.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "quiet-time-or-social-invite:stay-out-late-you-only-live-once-this-week:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "support",
            "text": "The coach notices tired eyes and cuts your reps.",
            "effects": [
              "coachTrust"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "personal-study-schedule",
    "title": "Study schedule",
    "contentVersion": 2,
    "tags": [
      "life",
      "training"
    ],
    "eligibility": [
      "senior"
    ],
    "setup": "You enrolled in a course alongside football. Assignment deadlines clash with a dense fixture list.",
    "choices": [
      {
        "id": "personal-study-schedule:map-deadlines-to-travel-days-with-staff-awarenes",
        "label": "Map deadlines to travel days with staff awareness",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "personal-study-schedule:map-deadlines-to-travel-days-with-staff-awarenes:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Steady progress on flights keeps stress low.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "personal-study-schedule:map-deadlines-to-travel-days-with-staff-awarenes:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Course and career coexist without drama.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "personal-study-schedule:map-deadlines-to-travel-days-with-staff-awarenes:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "One deadline slips when extra time goes to recovery.",
            "effects": [
              "readiness"
            ]
          }
        ]
      },
      {
        "id": "personal-study-schedule:submit-good-enough-work-when-time-appears",
        "label": "Submit good-enough work when time appears",
        "disposition": "balanced",
        "results": [
          {
            "id": "personal-study-schedule:submit-good-enough-work-when-time-appears:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Assignments pass; grades are not your peak.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "personal-study-schedule:submit-good-enough-work-when-time-appears:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Neither study nor football gains an edge.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "personal-study-schedule:submit-good-enough-work-when-time-appears:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Rushed work earns a poor mark you wanted to avoid.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "personal-study-schedule:pull-an-all-nighter-before-matchday",
        "label": "Pull an all-nighter before matchday",
        "disposition": "ambitious",
        "results": [
          {
            "id": "personal-study-schedule:pull-an-all-nighter-before-matchday:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "You finish the paper and feel accomplished.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "personal-study-schedule:pull-an-all-nighter-before-matchday:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Sleep debt shows in sharpness the next day.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "personal-study-schedule:pull-an-all-nighter-before-matchday:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Matchday focus suffers after zero sleep.",
            "effects": [
              "readiness"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "household-disruption",
    "title": "Household noise",
    "contentVersion": 2,
    "tags": [
      "life"
    ],
    "eligibility": [
      "senior"
    ],
    "setup": "Builders or neighbours disrupt sleep at home midweek. Hotel rooms are available through the club if you ask.",
    "choices": [
      {
        "id": "household-disruption:request-a-short-hotel-stay-on-heavy-session-nigh",
        "label": "Request a short hotel stay on heavy session nights",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "household-disruption:request-a-short-hotel-stay-on-heavy-session-nigh:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Quiet hotel sleep restores readiness.",
            "effects": [
              "readiness"
            ]
          },
          {
            "id": "household-disruption:request-a-short-hotel-stay-on-heavy-session-nigh:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Disruption eases without full relocation.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "household-disruption:request-a-short-hotel-stay-on-heavy-session-nigh:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Hotel logistics eat an evening you needed blank.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "household-disruption:use-earplugs-and-keep-the-usual-routine",
        "label": "Use earplugs and keep the usual routine",
        "disposition": "balanced",
        "results": [
          {
            "id": "household-disruption:use-earplugs-and-keep-the-usual-routine:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Earplugs help enough to train normally.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "household-disruption:use-earplugs-and-keep-the-usual-routine:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Fatigue is noticeable but manageable.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "household-disruption:use-earplugs-and-keep-the-usual-routine:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Broken sleep shows in reaction drills.",
            "effects": [
              "readiness",
              "training"
            ]
          }
        ]
      },
      {
        "id": "household-disruption:stay-up-frustrated-and-scroll-until-late",
        "label": "Stay up frustrated and scroll until late",
        "disposition": "reckless",
        "results": [
          {
            "id": "household-disruption:stay-up-frustrated-and-scroll-until-late:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Scrolling distracts from noise briefly.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "household-disruption:stay-up-frustrated-and-scroll-until-late:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Mental fog lingers into morning.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "household-disruption:stay-up-frustrated-and-scroll-until-late:negative",
            "abilityCategory": "negative",
            "delta": -3,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Irritable mood spills into a rondo argument.",
            "effects": [
              "morale"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "partner-shared-routine",
    "title": "Shared routine",
    "contentVersion": 2,
    "tags": [
      "life"
    ],
    "eligibility": [
      "hasPartner"
    ],
    "setup": "Your partner wants a shared morning routine while you navigate training times. Compromise is possible but not automatic.",
    "choices": [
      {
        "id": "partner-shared-routine:align-calendars-and-protect-one-joint-breakfast-",
        "label": "Align calendars and protect one joint breakfast weekly",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "partner-shared-routine:align-calendars-and-protect-one-joint-breakfast-:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "support",
            "text": "Shared planning reduces friction during a busy week.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "partner-shared-routine:align-calendars-and-protect-one-joint-breakfast-:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "support",
            "text": "Relationship steady; football unchanged.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "partner-shared-routine:align-calendars-and-protect-one-joint-breakfast-:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "support",
            "text": "Calendar talks feel like another meeting.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "partner-shared-routine:train-first-and-catch-up-when-schedule-allows",
        "label": "Train first and catch up when schedule allows",
        "disposition": "balanced",
        "results": [
          {
            "id": "partner-shared-routine:train-first-and-catch-up-when-schedule-allows:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "support",
            "text": "Flexible catch-ups work most days.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "partner-shared-routine:train-first-and-catch-up-when-schedule-allows:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "support",
            "text": "Partner accepts gaps; closeness is average.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "partner-shared-routine:train-first-and-catch-up-when-schedule-allows:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "support",
            "text": "Missed plans stack and tension rises.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "partner-shared-routine:ask-them-to-fully-adapt-to-your-football-clock",
        "label": "Ask them to fully adapt to your football clock",
        "disposition": "ambitious",
        "results": [
          {
            "id": "partner-shared-routine:ask-them-to-fully-adapt-to-your-football-clock:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "support",
            "text": "Clear football priority simplifies decisions.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "partner-shared-routine:ask-them-to-fully-adapt-to-your-football-clock:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "support",
            "text": "Support at home is structured but rigid.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "partner-shared-routine:ask-them-to-fully-adapt-to-your-football-clock:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "support",
            "text": "Resentment surfaces when they cancel their plans again.",
            "effects": [
              "morale"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "newcomer-social-integration",
    "title": "New city social",
    "contentVersion": 2,
    "tags": [
      "life",
      "club"
    ],
    "eligibility": [
      "recentClubMove"
    ],
    "setup": "You still do not know many people outside the squad in your new city. Teammates invite you to a local event.",
    "choices": [
      {
        "id": "newcomer-social-integration:go-along-and-ask-questions-about-the-area",
        "label": "Go along and ask questions about the area",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "newcomer-social-integration:go-along-and-ask-questions-about-the-area:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "New contacts make daily life smoother off pitch.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "newcomer-social-integration:go-along-and-ask-questions-about-the-area:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Social base grows slowly.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "newcomer-social-integration:go-along-and-ask-questions-about-the-area:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Event runs late and you shorten recovery.",
            "effects": [
              "readiness"
            ]
          }
        ]
      },
      {
        "id": "newcomer-social-integration:decline-this-time-and-explore-solo-on-a-day-off",
        "label": "Decline this time and explore solo on a day off",
        "disposition": "balanced",
        "results": [
          {
            "id": "newcomer-social-integration:decline-this-time-and-explore-solo-on-a-day-off:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Solo exploring builds independence.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "newcomer-social-integration:decline-this-time-and-explore-solo-on-a-day-off:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Loneliness persists another week.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "newcomer-social-integration:decline-this-time-and-explore-solo-on-a-day-off:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Getting lost eats time before evening meal prep.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "newcomer-social-integration:skip-events-and-stay-online-with-old-friends-onl",
        "label": "Skip events and stay online with old friends only",
        "disposition": "reckless",
        "results": [
          {
            "id": "newcomer-social-integration:skip-events-and-stay-online-with-old-friends-onl:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Old friends keep you grounded emotionally.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "newcomer-social-integration:skip-events-and-stay-online-with-old-friends-onl:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Local integration stalls.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "newcomer-social-integration:skip-events-and-stay-online-with-old-friends-onl:negative",
            "abilityCategory": "negative",
            "delta": -3,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Homesickness spikes before an important match.",
            "effects": [
              "support"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "loan-first-week",
    "title": "Loan first week",
    "contentVersion": 2,
    "tags": [
      "club",
      "training"
    ],
    "eligibility": [
      "activeLoanStart"
    ],
    "setup": "Your loan club's methods differ from your parent side. First-week meetings stack up alongside fitness tests.",
    "choices": [
      {
        "id": "loan-first-week:take-notes-in-every-meeting-and-ask-where-you-fi",
        "label": "Take notes in every meeting and ask where you fit",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "loan-first-week:take-notes-in-every-meeting-and-ask-where-you-fi:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Notes help you execute the press trigger they actually use.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "loan-first-week:take-notes-in-every-meeting-and-ask-where-you-fi:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Adaptation is orderly if slow.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "loan-first-week:take-notes-in-every-meeting-and-ask-where-you-fi:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Too many questions delay your first impression on pitch.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "loan-first-week:observe-first-then-mirror-the-loudest-leaders",
        "label": "Observe first then mirror the loudest leaders",
        "disposition": "balanced",
        "results": [
          {
            "id": "loan-first-week:observe-first-then-mirror-the-loudest-leaders:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Mirroring leaders speeds social acceptance.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "loan-first-week:observe-first-then-mirror-the-loudest-leaders:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "You blend in without starring yet.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "loan-first-week:observe-first-then-mirror-the-loudest-leaders:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Copying the wrong leader picks up a bad habit.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "loan-first-week:tell-them-your-parent-club-way-is-better",
        "label": "Tell them your parent club way is better",
        "disposition": "ambitious",
        "results": [
          {
            "id": "loan-first-week:tell-them-your-parent-club-way-is-better:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Confidence shows in your first training touch.",
            "effects": [
              "training"
            ]
          },
          {
            "id": "loan-first-week:tell-them-your-parent-club-way-is-better:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Comparison talk creates quiet friction.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "loan-first-week:tell-them-your-parent-club-way-is-better:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Staff label you difficult before a league minute.",
            "effects": [
              "coachTrust"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "loan-development-check-in",
    "title": "Loan check-in",
    "contentVersion": 2,
    "tags": [
      "club",
      "training"
    ],
    "eligibility": [
      "activeLoanProgress"
    ],
    "setup": "Parent club staff visit to review your loan progress midseason. Loan coaches want honest feedback without unsettling the group.",
    "choices": [
      {
        "id": "loan-development-check-in:prepare-specific-clips-and-questions-for-both-st",
        "label": "Prepare specific clips and questions for both staffs",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "loan-development-check-in:prepare-specific-clips-and-questions-for-both-st:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Dual feedback yields a clear development target.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "loan-development-check-in:prepare-specific-clips-and-questions-for-both-st:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Review passes smoothly.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "loan-development-check-in:prepare-specific-clips-and-questions-for-both-st:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Dual allegiance questions tire you mentally.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "loan-development-check-in:keep-feedback-general-and-positive-in-the-room",
        "label": "Keep feedback general and positive in the room",
        "disposition": "balanced",
        "results": [
          {
            "id": "loan-development-check-in:keep-feedback-general-and-positive-in-the-room:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Diplomacy keeps loan dressing room calm.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "loan-development-check-in:keep-feedback-general-and-positive-in-the-room:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Growth plan stays vague.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "loan-development-check-in:keep-feedback-general-and-positive-in-the-room:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Parent club wanted sharper honesty on minutes.",
            "effects": [
              "readiness"
            ]
          }
        ]
      },
      {
        "id": "loan-development-check-in:push-for-an-immediate-recall-to-parent-club",
        "label": "Push for an immediate recall to parent club",
        "disposition": "ambitious",
        "results": [
          {
            "id": "loan-development-check-in:push-for-an-immediate-recall-to-parent-club:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Recall talk energizes you short term.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "loan-development-check-in:push-for-an-immediate-recall-to-parent-club:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Loan club feels secondary instantly.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "loan-development-check-in:push-for-an-immediate-recall-to-parent-club:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Public recall push strains relationships here.",
            "effects": [
              "support"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "first-permanent-move-induction",
    "title": "Permanent move",
    "contentVersion": 2,
    "tags": [
      "club",
      "life"
    ],
    "eligibility": [
      "permanentTransferInduction"
    ],
    "setup": "Your permanent transfer induction week mixes medicals, media, and tactical tests. Expectations are higher than on loan.",
    "choices": [
      {
        "id": "first-permanent-move-induction:complete-every-induction-module-and-introduce-yo",
        "label": "Complete every induction module and introduce yourself widely",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "first-permanent-move-induction:complete-every-induction-module-and-introduce-yo:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Broad introductions build allies across departments.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "first-permanent-move-induction:complete-every-induction-module-and-introduce-yo:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Induction finishes without gaps.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "first-permanent-move-induction:complete-every-induction-module-and-introduce-yo:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Packed schedule leaves legs heavy for first training.",
            "effects": [
              "readiness"
            ]
          }
        ]
      },
      {
        "id": "first-permanent-move-induction:focus-on-pitch-tasks-and-meet-people-as-you-go",
        "label": "Focus on pitch tasks and meet people as you go",
        "disposition": "balanced",
        "results": [
          {
            "id": "first-permanent-move-induction:focus-on-pitch-tasks-and-meet-people-as-you-go:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "On-pitch focus earns coach attention quickly.",
            "effects": [
              "coachTrust"
            ]
          },
          {
            "id": "first-permanent-move-induction:focus-on-pitch-tasks-and-meet-people-as-you-go:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Off-pitch networks form slower.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "first-permanent-move-induction:focus-on-pitch-tasks-and-meet-people-as-you-go:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Media module gap causes a minor compliance nag.",
            "effects": [
              "reputation"
            ]
          }
        ]
      },
      {
        "id": "first-permanent-move-induction:skip-social-modules-to-maximize-pitch-time-only",
        "label": "Skip social modules to maximize pitch time only",
        "disposition": "ambitious",
        "results": [
          {
            "id": "first-permanent-move-induction:skip-social-modules-to-maximize-pitch-time-only:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Extra pitch reps sharpen first-touch under new patterns.",
            "effects": [
              "readiness",
              "training"
            ]
          },
          {
            "id": "first-permanent-move-induction:skip-social-modules-to-maximize-pitch-time-only:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Isolation off pitch shows when you need help later.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "first-permanent-move-induction:skip-social-modules-to-maximize-pitch-time-only:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "adaptation",
            "text": "Skipped safeguarding briefing becomes an embarrassing redo.",
            "effects": [
              "morale"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "parent-club-return-review",
    "title": "Return review",
    "contentVersion": 2,
    "tags": [
      "club",
      "training"
    ],
    "eligibility": [
      "loanReturn"
    ],
    "setup": "You return from loan to the parent club's squad. Roles shifted while you were away and minutes are not guaranteed.",
    "choices": [
      {
        "id": "parent-club-return-review:meet-coaches-with-a-loan-report-and-ask-for-a-de",
        "label": "Meet coaches with a loan report and ask for a defined role",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "parent-club-return-review:meet-coaches-with-a-loan-report-and-ask-for-a-de:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Defined role shortens reintegration by a week.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "parent-club-return-review:meet-coaches-with-a-loan-report-and-ask-for-a-de:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Return feels orderly.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "parent-club-return-review:meet-coaches-with-a-loan-report-and-ask-for-a-de:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Negotiation energy dips before fitness tests.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "parent-club-return-review:reintegrate-quietly-and-let-performance-speak",
        "label": "Reintegrate quietly and let performance speak",
        "disposition": "balanced",
        "results": [
          {
            "id": "parent-club-return-review:reintegrate-quietly-and-let-performance-speak:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Solid training rebuilds trust gradually.",
            "effects": [
              "coachTrust"
            ]
          },
          {
            "id": "parent-club-return-review:reintegrate-quietly-and-let-performance-speak:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Selection remains open.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "parent-club-return-review:reintegrate-quietly-and-let-performance-speak:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Quiet approach hides useful loan insights staff wanted.",
            "effects": [
              "coachTrust"
            ]
          }
        ]
      },
      {
        "id": "parent-club-return-review:demand-starts-based-on-loan-numbers",
        "label": "Demand starts based on loan numbers",
        "disposition": "ambitious",
        "results": [
          {
            "id": "parent-club-return-review:demand-starts-based-on-loan-numbers:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Loan stats back your confidence in meetings.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "parent-club-return-review:demand-starts-based-on-loan-numbers:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Teammates bristle at entitlement tone.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "parent-club-return-review:demand-starts-based-on-loan-numbers:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Coach reminds you the parent squad moved on without you.",
            "effects": [
              "coachTrust"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "national-role-adjustment",
    "title": "National role",
    "contentVersion": 2,
    "tags": [
      "international",
      "training"
    ],
    "eligibility": [
      "nationalCallUp"
    ],
    "setup": "National team staff tweak your role in camp — different spacing than at club. A friendly is two days away.",
    "choices": [
      {
        "id": "national-role-adjustment:stay-after-meetings-to-confirm-triggers-with-the",
        "label": "Stay after meetings to confirm triggers with the assistant",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "national-role-adjustment:stay-after-meetings-to-confirm-triggers-with-the:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Trigger clarity shows in a sharp rehearsal sequence.",
            "effects": [
              "readiness"
            ]
          },
          {
            "id": "national-role-adjustment:stay-after-meetings-to-confirm-triggers-with-the:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "You adapt adequately for the friendly.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "national-role-adjustment:stay-after-meetings-to-confirm-triggers-with-the:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Over-meeting drains legs before the match.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "national-role-adjustment:play-the-role-as-drawn-without-overthinking",
        "label": "Play the role as drawn without overthinking",
        "disposition": "balanced",
        "results": [
          {
            "id": "national-role-adjustment:play-the-role-as-drawn-without-overthinking:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Simple execution keeps errors low.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "national-role-adjustment:play-the-role-as-drawn-without-overthinking:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "National role feels workable not natural yet.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "national-role-adjustment:play-the-role-as-drawn-without-overthinking:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Misread spacing causes a breakaway against in training.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "national-role-adjustment:tell-the-manager-your-club-role-should-stay-unch",
        "label": "Tell the manager your club role should stay unchanged",
        "disposition": "ambitious",
        "results": [
          {
            "id": "national-role-adjustment:tell-the-manager-your-club-role-should-stay-unch:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Assertiveness earns a longer on-pitch conversation.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "national-role-adjustment:tell-the-manager-your-club-role-should-stay-unch:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Staff question flexibility for tactical tweaks.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "national-role-adjustment:tell-the-manager-your-club-role-should-stay-unch:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Manager benches you partially for the friendly.",
            "effects": [
              "coachTrust"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "national-bench-response",
    "title": "National bench",
    "contentVersion": 2,
    "tags": [
      "international",
      "match"
    ],
    "eligibility": [
      "nationalBenchDuty"
    ],
    "setup": "You travel with the national team but expect bench duty this camp. Minutes at club level still depend on how you handle the week.",
    "choices": [
      {
        "id": "national-bench-response:treat-camp-as-learning-chart-set-pieces-and-rest",
        "label": "Treat camp as learning — chart set pieces and rest well",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "national-bench-response:treat-camp-as-learning-chart-set-pieces-and-rest:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Set-piece notes help club and country later.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "national-bench-response:treat-camp-as-learning-chart-set-pieces-and-rest:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Bench duty passes without growth or harm.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "national-bench-response:treat-camp-as-learning-chart-set-pieces-and-rest:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Too much note-taking cuts into activation.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "national-bench-response:stay-professional-and-train-at-standard-intensit",
        "label": "Stay professional and train at standard intensity",
        "disposition": "balanced",
        "results": [
          {
            "id": "national-bench-response:stay-professional-and-train-at-standard-intensit:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Professionalism keeps club coach reassured.",
            "effects": [
              "coachTrust"
            ]
          },
          {
            "id": "national-bench-response:stay-professional-and-train-at-standard-intensit:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Week is neutral emotionally.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "national-bench-response:stay-professional-and-train-at-standard-intensit:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Frustration leaks into one flat training rep at club return.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "national-bench-response:complain-to-media-friends-about-disrespect",
        "label": "Complain to media friends about disrespect",
        "disposition": "reckless",
        "results": [
          {
            "id": "national-bench-response:complain-to-media-friends-about-disrespect:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Off-record vent feels validating.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "national-bench-response:complain-to-media-friends-about-disrespect:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Story risk hangs over the camp.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "national-bench-response:complain-to-media-friends-about-disrespect:negative",
            "abilityCategory": "negative",
            "delta": -3,
            "conditionalWeight": 1,
            "focus": "role-learning",
            "text": "Leak traces back and national call-ups pause.",
            "effects": [
              "morale"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "renewal-uncertainty-focus",
    "title": "Contract uncertainty",
    "contentVersion": 2,
    "tags": [
      "club",
      "life"
    ],
    "eligibility": [
      "contractUncertainty"
    ],
    "setup": "Your contract situation is unresolved midseason. Agents, rumours, and family questions stack beside football.",
    "choices": [
      {
        "id": "renewal-uncertainty-focus:set-talk-windows-outside-training-and-focus-on-p",
        "label": "Set talk windows outside training and focus on pitch",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "renewal-uncertainty-focus:set-talk-windows-outside-training-and-focus-on-p:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Boundaries keep training sharp despite noise.",
            "effects": [
              "readiness"
            ]
          },
          {
            "id": "renewal-uncertainty-focus:set-talk-windows-outside-training-and-focus-on-p:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Uncertainty remains managed not solved.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "renewal-uncertainty-focus:set-talk-windows-outside-training-and-focus-on-p:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Even bounded talks drain a morning once.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "renewal-uncertainty-focus:let-representatives-handle-talk-while-you-play",
        "label": "Let representatives handle talk while you play",
        "disposition": "balanced",
        "results": [
          {
            "id": "renewal-uncertainty-focus:let-representatives-handle-talk-while-you-play:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Delegation preserves match focus.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "renewal-uncertainty-focus:let-representatives-handle-talk-while-you-play:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "You feel slightly out of the loop.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "renewal-uncertainty-focus:let-representatives-handle-talk-while-you-play:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "A surprise rumour hits without your prep.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "renewal-uncertainty-focus:use-interviews-to-apply-public-pressure-for-a-de",
        "label": "Use interviews to apply public pressure for a deal",
        "disposition": "ambitious",
        "results": [
          {
            "id": "renewal-uncertainty-focus:use-interviews-to-apply-public-pressure-for-a-de:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Public pressure moves negotiations faster maybe.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "renewal-uncertainty-focus:use-interviews-to-apply-public-pressure-for-a-de:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Club hierarchy dislikes the tactic.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "renewal-uncertainty-focus:use-interviews-to-apply-public-pressure-for-a-de:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "routine",
            "text": "Coach questions commitment in a team meeting.",
            "effects": [
              "coachTrust"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "experienced-player-role-evolution",
    "title": "Role evolution",
    "contentVersion": 2,
    "tags": [
      "training",
      "club"
    ],
    "eligibility": [
      "experiencedSenior"
    ],
    "setup": "Age and squad depth push you toward a evolved role — less burst, more precision. Staff want to see acceptance in training, not mourning old habits.",
    "choices": [
      {
        "id": "experienced-player-role-evolution:work-with-a-coach-on-the-new-skill-set-deliberat",
        "label": "Work with a coach on the new skill set deliberately",
        "disposition": "thoughtful",
        "results": [
          {
            "id": "experienced-player-role-evolution:work-with-a-coach-on-the-new-skill-set-deliberat:positive",
            "abilityCategory": "positive",
            "delta": 2,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "New passing angles and timing look natural by week's end.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "experienced-player-role-evolution:work-with-a-coach-on-the-new-skill-set-deliberat:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Evolution proceeds without fireworks.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "experienced-player-role-evolution:work-with-a-coach-on-the-new-skill-set-deliberat:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Letting go of old runs feels emotionally odd.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "experienced-player-role-evolution:blend-old-and-new-approaches-until-told-otherwis",
        "label": "Blend old and new approaches until told otherwise",
        "disposition": "balanced",
        "results": [
          {
            "id": "experienced-player-role-evolution:blend-old-and-new-approaches-until-told-otherwis:positive",
            "abilityCategory": "positive",
            "delta": 1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Hybrid play keeps you useful in multiple phases.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "experienced-player-role-evolution:blend-old-and-new-approaches-until-told-otherwis:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Transition identity stays unclear.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "experienced-player-role-evolution:blend-old-and-new-approaches-until-told-otherwis:negative",
            "abilityCategory": "negative",
            "delta": -1,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Half-old habits confuse younger players copying you.",
            "effects": [
              "morale"
            ]
          }
        ]
      },
      {
        "id": "experienced-player-role-evolution:prove-you-still-have-the-old-explosiveness-every",
        "label": "Prove you still have the old explosiveness every rep",
        "disposition": "ambitious",
        "results": [
          {
            "id": "experienced-player-role-evolution:prove-you-still-have-the-old-explosiveness-every:positive",
            "abilityCategory": "positive",
            "delta": 3,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Explosive reps remind everyone what you can still do.",
            "effects": [
              "morale"
            ]
          },
          {
            "id": "experienced-player-role-evolution:prove-you-still-have-the-old-explosiveness-every:neutral",
            "abilityCategory": "neutral",
            "delta": 0,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Flash bursts cost recovery on other days.",
            "effects": [
              "none"
            ]
          },
          {
            "id": "experienced-player-role-evolution:prove-you-still-have-the-old-explosiveness-every:negative",
            "abilityCategory": "negative",
            "delta": -2,
            "conditionalWeight": 1,
            "focus": "technique",
            "text": "Chasing youth every session aggravates a chronic knock.",
            "effects": [
              "training"
            ]
          }
        ]
      }
    ]
  },
];
