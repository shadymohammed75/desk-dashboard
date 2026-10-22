// Assembles the display-ready /api/dashboard JSON from stored state. Pure: all inputs are passed in.
import type {
  BpReading, Celebration, Config, Dashboard, DayRecord, DaysIndex, DaySummary, GymResult, Score,
} from "../types";
import { latest, loggedOn } from "./bp";
import { gymStatus, plannedSplit } from "./gym";
import {
  activeCelebration, coach, levelFor, longestStreak, mascot, modeFor, pointsFor, streak, totalXp, week, weekDone,
  xpEvents, type DayMetrics,
} from "./motivation";
import { asleepBy, average, computeSleep } from "./sleep";
import { scoreOf, taskStates } from "./tasks";
import { addDays, localParts, toLocalIso } from "./time";

export const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

export interface State {
  now: Date;
  config: Config;
  day: DayRecord | undefined; // today's record
  bp: BpReading[];
  index: DaysIndex;
  lastIngest: string | null;
  bestStreak: number;
  celebrations: Celebration[];
}

export function metricsOf(day: DayRecord | undefined, date: string, tz: string) {
  const ing = day?.ingest;
  const sleep = ing ? computeSleep(ing.sleep_samples, date, tz) : null;
  const metrics: DayMetrics = {
    asleep_min: sleep?.asleep_min ?? null,
    steps: ing?.steps ?? null,
    active_kcal: ing?.active_kcal ?? null,
    kcal: ing?.nutrition.kcal ?? null,
    protein_g: ing?.nutrition.protein_g ?? null,
  };
  return { metrics, stages: sleep?.stages ?? null, onset: sleep?.onset ?? null };
}

/** Today's habits and score for one day. */
export function dayScore(day: DayRecord | undefined, date: string, config: Config, gym: GymResult): Score {
  const { metrics, onset } = metricsOf(day, date, config.timezone);
  const asleepByGoal = onset == null ? null : asleepBy(onset, date, config.goals.sleep_by, config.timezone);
  return scoreOf(taskStates(config, day, { gym, steps: metrics.steps, asleepByGoal }));
}

/** The compact per-day line stored in `meta:days`. */
export function summarizeDay(day: DayRecord | undefined, date: string, config: Config, bp: BpReading[]): DaySummary {
  const tz = config.timezone;
  const { metrics } = metricsOf(day, date, tz);
  const gym = gymStatus(day, config, date);
  const sc = dayScore(day, date, config, gym);
  const events = xpEvents(gym, sc, loggedOn(bp, date, tz));
  return {
    plan: plannedSplit(config, date), split: gym.day_type, status: gym.status,
    muscles: gym.status === "done" ? gym.muscles : [],
    asleep_min: metrics.asleep_min, events, points: pointsFor(events), score: sc.value,
  };
}

/** The index with today's live summary merged in (only when today has any data). */
export function withToday(index: DaysIndex, today: string, summary: DaySummary, hasData: boolean): DaysIndex {
  if (!hasData && !index.days[today]) return index;
  return { ...index, days: { ...index.days, [today]: summary } };
}

export interface Derived {
  today: string;
  gym: GymResult;
  index: DaysIndex;
  streak: number;
  level: ReturnType<typeof levelFor>;
}

/** Today's gym result, the live index, streak and level — shared by the dashboard and the write path. */
export function derive(s: Pick<State, "now" | "config" | "day" | "bp" | "index">): Derived {
  const today = localParts(s.now, s.config.timezone).date;
  const gym = gymStatus(s.day, s.config, today);
  const hasData = !!(s.day?.ingest || s.day?.gym || s.day?.tasks) || loggedOn(s.bp, today, s.config.timezone);
  const index = withToday(s.index, today, summarizeDay(s.day, today, s.config, s.bp), hasData);
  return {
    today, gym, index,
    streak: streak(today, index, s.config, gym.status),
    level: levelFor(totalXp(index)),
  };
}

export function buildDashboard(s: State): Dashboard {
  const { config, now } = s;
  const tz = config.timezone;
  const g = config.goals;
  const lp = localParts(now, tz);
  const { today, gym, index, streak: streakDays, level } = derive(s);
  const { metrics: m, stages } = metricsOf(s.day, today, tz);
  const sc = dayScore(s.day, today, config, gym);
  const mode = modeFor(lp.hour);
  const last = latest(s.bp);
  const cel = activeCelebration(s.celebrations, now);

  const avg7 = average(Array.from({ length: 7 }, (_, i) => index.days[addDays(today, -i)]?.asleep_min));
  const lastMs = s.lastIngest ? Date.parse(s.lastIngest) : Number.NaN;

  return {
    now: toLocalIso(now, tz),
    updated: Number.isNaN(lastMs) ? null : toLocalIso(new Date(lastMs), tz),
    stale: Number.isNaN(lastMs) || now.getTime() - lastMs > STALE_AFTER_MS,
    mode,
    sleep: { asleep_min: m.asleep_min, avg7_min: avg7, goal_min: g.sleep_min, stages },
    steps: { value: m.steps, goal: g.steps },
    active: { kcal: m.active_kcal, goal: g.active_kcal },
    food: { kcal: m.kcal, kcal_goal: g.kcal, protein_g: m.protein_g, protein_goal: g.protein_g },
    bp: last && { sys: last.sys, dia: last.dia, pulse: last.pulse, ts: toLocalIso(new Date(last.ts), tz) },
    // older stored ingests have no vitals
    vitals: s.day?.ingest?.vitals ?? { resting_hr: null, heart_rate: null, spo2: null },
    gym: {
      day_type: gym.day_type, label: gym.label, color: gym.color, icon: gym.icon, muscles: gym.muscles,
      status: gym.status, done_min: gym.done_min,
      week_done: weekDone(today, index, gym.status), week_target: g.gym_per_week,
    },
    score: sc,
    progress: {
      ...level, streak_days: streakDays,
      best_streak: Math.max(s.bestStreak, longestStreak(today, index, config, gym.status)),
    },
    week: week(today, index, config, gym),
    coach: coach({
      date: today, mode, hour: lp.hour, gym, asleep_min: m.asleep_min, protein_g: m.protein_g, goals: g,
      streak: streakDays, score: sc,
    }),
    mascot: mascot(mode, gym.status, m.asleep_min, g.sleep_min, sc.value, sc.perfect),
    celebrate: cel && { id: cel.id, title: cel.title, sub: cel.sub },
  };
}
