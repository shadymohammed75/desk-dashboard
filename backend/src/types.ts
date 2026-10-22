// Shared types for the Worker. The /api/dashboard shape mirrors PLAN.md §4.2 and mock/*.json.

export type GymStatus = "pending" | "done" | "skipped" | "rest";
export type Mode = "morning" | "day" | "evening" | "night";
export type WeekState = "done" | "rest" | "missed" | "skipped" | "today" | "planned";
export type Tone = "hype" | "nudge" | "calm" | "proud";
export type Mascot = "sleepy" | "chill" | "pumped" | "proud" | "tired";
export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const MUSCLES = [
  "chest", "front_delts", "side_delts", "biceps", "forearms", "abs", "obliques", "quads", "calves_front",
  "traps", "rear_delts", "upper_back", "lats", "triceps", "lower_back", "glutes", "hamstrings", "calves",
] as const;
export type Muscle = (typeof MUSCLES)[number];

export interface Split {
  label: string;
  muscles: string[];
}

export interface Goals {
  steps: number;
  active_kcal: number;
  kcal: number;
  protein_g: number;
  sleep_min: number;
  gym_per_week: number;
}

export interface Config {
  timezone: string;
  schedule: Record<Weekday, string>;
  splits: Record<string, Split>;
  goals: Goals;
}

export interface SleepSample {
  start: string;
  end: string;
  value: string;
}

export interface Workout {
  type: string;
  start?: string;
  duration_min: number;
}

/** Body of POST /api/ingest, stored as-is (minus `date`) on the day record. */
export interface Ingest {
  sent_at: string | null;
  received_at: string;
  steps: number | null;
  active_kcal: number | null;
  nutrition: { kcal: number | null; protein_g: number | null };
  sleep_samples: SleepSample[];
  workouts: Workout[];
}

export interface GymEntry {
  action: "done" | "skip";
  split: string | null;
  muscles: string[] | null;
  duration_min: number | null;
  note: string | null;
  ts: string;
}

/** KV `day:YYYY-MM-DD`. */
export interface DayRecord {
  ingest?: Ingest;
  gym?: GymEntry;
}

export interface BpReading {
  sys: number;
  dia: number;
  pulse: number | null;
  ts: string;
}

/** One line of the compact per-day index kept in KV `meta:days`. */
export interface DaySummary {
  plan: string;
  status: GymStatus;
  muscles: string[];
  asleep_min: number | null;
  events: string[];
  points: number;
}

/** KV `meta:days`: per-day summaries used for streaks, the week strip, XP and the 7-day sleep average. */
export interface DaysIndex {
  archived_xp: number;
  days: Record<string, DaySummary>;
}

export interface Celebration {
  id: string;
  title: string;
  sub: string;
  at: string;
  prio: number;
}

export interface ScoreParts {
  sleep: number | null;
  move: number | null;
  food: number | null;
  gym: number;
}

export interface GymResult {
  day_type: string;
  label: string;
  muscles: string[];
  status: GymStatus;
  done_min: number | null;
  source: "app" | "health" | "plan";
  /** Trained although the plan said rest. */
  rest_training: boolean;
}

export interface Dashboard {
  now: string;
  updated: string | null;
  stale: boolean;
  mode: Mode;
  sleep: { asleep_min: number | null; avg7_min: number | null; goal_min: number;
           stages: { deep: number; core: number; rem: number; awake: number } | null };
  steps: { value: number | null; goal: number };
  active: { kcal: number | null; goal: number };
  food: { kcal: number | null; kcal_goal: number; protein_g: number | null; protein_goal: number };
  bp: { sys: number; dia: number; pulse: number | null; ts: string; trend7: [number, number][] } | null;
  gym: { day_type: string; label: string; muscles: string[]; status: GymStatus; done_min: number | null;
         week_done: number; week_target: number };
  score: { value: number; parts: ScoreParts };
  progress: { level: number; xp: number; xp_next: number; streak_days: number; best_streak: number };
  week: { d: string; state: WeekState }[];
  coach: { text: string; tone: Tone };
  mascot: Mascot;
  celebrate: { id: string; title: string; sub: string } | null;
}
