export const BADGE_BASE_PATH = "badges";

export const POSITION_PROFILES = {
  GK: { goalRate: 0.01, assistRate: 0.02, cleanSheetRate: 0.46, growthBias: { Defending: 4, Physicality: 2, Passing: 1 } },
  RB: { goalRate: 0.05, assistRate: 0.12, cleanSheetRate: 0.28, growthBias: { Speed: 2, Passing: 2, Defending: 3 } },
  LB: { goalRate: 0.05, assistRate: 0.12, cleanSheetRate: 0.28, growthBias: { Speed: 2, Passing: 2, Defending: 3 } },
  CB: { goalRate: 0.04, assistRate: 0.05, cleanSheetRate: 0.4, growthBias: { Defending: 4, Physicality: 3 } },
  CDM: { goalRate: 0.08, assistRate: 0.14, cleanSheetRate: 0.22, growthBias: { Passing: 3, Defending: 3 } },
  CM: { goalRate: 0.12, assistRate: 0.2, cleanSheetRate: 0.18, growthBias: { Passing: 3, Dribbling: 2 } },
  CAM: { goalRate: 0.22, assistRate: 0.24, cleanSheetRate: 0.1, growthBias: { Passing: 3, Shooting: 3, Dribbling: 2 } },
  RM: { goalRate: 0.2, assistRate: 0.23, cleanSheetRate: 0.12, growthBias: { Speed: 3, Dribbling: 3, Passing: 2 } },
  LM: { goalRate: 0.2, assistRate: 0.23, cleanSheetRate: 0.12, growthBias: { Speed: 3, Dribbling: 3, Passing: 2 } },
  RW: { goalRate: 0.27, assistRate: 0.25, cleanSheetRate: 0.08, growthBias: { Speed: 3, Shooting: 4, Dribbling: 3 } },
  LW: { goalRate: 0.27, assistRate: 0.25, cleanSheetRate: 0.08, growthBias: { Speed: 3, Shooting: 4, Dribbling: 3 } },
  ST: { goalRate: 0.36, assistRate: 0.18, cleanSheetRate: 0.04, growthBias: { Shooting: 4, Physicality: 3, Dribbling: 2 } },
  DEFAULT: { goalRate: 0.18, assistRate: 0.18, cleanSheetRate: 0.15, growthBias: { Passing: 2, Dribbling: 2 } },
};

export const POSITION_STYLES = {
  GK: ["Shot Stopper", "Sweeper Keeper", "Ball Playing Keeper"],
  RB: ["Overlapping Fullback", "Wing Back", "Defensive Fullback"],
  LB: ["Overlapping Fullback", "Wing Back", "Defensive Fullback"],
  CB: ["Ball Playing Centre Back", "Stopper", "Sweeper"],
  CDM: ["Anchor Man", "Deep Lying Playmaker", "Ball Winner"],
  CM: ["Box-to-Box", "Deep Lying Playmaker", "Advanced Playmaker"],
  CAM: ["Shadow Striker", "Creative Maestro", "Roaming Playmaker"],
  RM: ["Traditional Winger", "Wide Creator", "Wide Playmaker"],
  LM: ["Traditional Winger", "Wide Creator", "Wide Playmaker"],
  RW: ["Inverted Winger", "Touchline Winger", "Inside Forward"],
  LW: ["Inverted Winger", "Touchline Winger", "Inside Forward"],
  ST: ["Poacher", "Complete Forward", "Target Striker"],
};

export const ATTRIBUTE_MODIFIERS = {
  GK: { Speed: -12, Passing: -4, Shooting: -18, Defending: 6, Physicality: 4, Dribbling: -8 },
  RB: { Speed: 4, Passing: 1, Shooting: -5, Defending: 3, Physicality: 0, Dribbling: 2 },
  LB: { Speed: 4, Passing: 1, Shooting: -5, Defending: 3, Physicality: 0, Dribbling: 2 },
  CB: { Speed: -6, Passing: -2, Shooting: -8, Defending: 8, Physicality: 6, Dribbling: -4 },
  CDM: { Speed: -1, Passing: 4, Shooting: -3, Defending: 4, Physicality: 3, Dribbling: 1 },
  CM: { Speed: 2, Passing: 4, Shooting: 1, Defending: -2, Physicality: 1, Dribbling: 2 },
  CAM: { Speed: 3, Passing: 5, Shooting: 4, Defending: -4, Physicality: -1, Dribbling: 4 },
  RM: { Speed: 6, Passing: 2, Shooting: 0, Defending: -2, Physicality: -1, Dribbling: 4 },
  LM: { Speed: 6, Passing: 2, Shooting: 0, Defending: -2, Physicality: -1, Dribbling: 4 },
  RW: { Speed: 7, Passing: 2, Shooting: 4, Defending: -4, Physicality: -1, Dribbling: 5 },
  LW: { Speed: 7, Passing: 2, Shooting: 4, Defending: -4, Physicality: -1, Dribbling: 5 },
  ST: { Speed: 4, Passing: -1, Shooting: 8, Defending: -6, Physicality: 4, Dribbling: 2 },
  DEFAULT: { Speed: 2, Passing: 2, Shooting: 2, Defending: 0, Physicality: 0, Dribbling: 2 },
};

export const STATS_KEYS = ["Speed", "Passing", "Shooting", "Defending", "Physicality", "Dribbling"];
