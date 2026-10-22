// Gym status for one day, following PLAN.md §4.3 (priority order).
import type { Config, DayRecord, GymResult, Split } from "../types";
import { weekdayOf } from "./time";

/** Apple Health workout types that count as a gym session (backup when I forget to tap). */
const STRENGTH = /strength|weight|functional|resistance/i;
export const MIN_HEALTH_WORKOUT_MIN = 20;

export function splitInfo(config: Config, key: string): Split {
  return config.splits[key] ?? { label: key.toUpperCase(), muscles: [] };
}

export function plannedSplit(config: Config, date: string): string {
  return config.schedule[weekdayOf(date)] ?? "rest";
}

export const isRestSplit = (config: Config, key: string) =>
  key === "rest" || splitInfo(config, key).muscles.length === 0;

export function gymStatus(day: DayRecord | undefined, config: Config, date: string): GymResult {
  const planKey = plannedSplit(config, date);
  const plan = splitInfo(config, planKey);
  const planIsRest = isRestSplit(config, planKey);
  const base = { day_type: planKey, label: plan.label, muscles: plan.muscles, done_min: null, rest_training: false };

  // 1. A manual entry from the app always wins.
  const entry = day?.gym;
  if (entry?.action === "done") {
    const key = entry.split ?? planKey;
    const split = splitInfo(config, key);
    const muscles = entry.muscles?.length ? entry.muscles : split.muscles.length ? split.muscles : plan.muscles;
    return {
      day_type: key, label: split.label, muscles, status: "done",
      done_min: entry.duration_min, source: "app", rest_training: planIsRest,
    };
  }
  if (entry?.action === "skip") return { ...base, status: "skipped", source: "app" };

  // 2. Apple Health backup: a strength workout of 20+ minutes.
  const workout = (day?.ingest?.workouts ?? []).find(
    (w) => STRENGTH.test(w.type) && w.duration_min >= MIN_HEALTH_WORKOUT_MIN,
  );
  if (workout) {
    return { ...base, status: "done", done_min: Math.round(workout.duration_min), source: "health",
             rest_training: planIsRest };
  }

  // 3. Rest days.  4. Otherwise pending.
  return { ...base, status: planIsRest ? "rest" : "pending", source: "plan" };
}
