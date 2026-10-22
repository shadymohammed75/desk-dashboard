// Sleep: the night ending on `date`, from Apple Health "Sleep Analysis" samples.
import type { SleepSample } from "../types";
import { addDays, zonedToUtc } from "./time";

type Stage = "deep" | "core" | "rem" | "awake";
type Interval = [number, number];

/** Map Health/Shortcuts labels ("Core", "Asleep Core", "REM", "Asleep", "In Bed", …) to a stage. */
export function stageOf(value: string): Stage | null {
  const v = value.toLowerCase();
  if (v.includes("bed")) return null;
  if (v.includes("awake")) return "awake";
  if (v.includes("deep")) return "deep";
  if (v.includes("rem")) return "rem";
  if (v.includes("core") || v.includes("asleep") || v.includes("unspecified")) return "core";
  return null;
}

/** Total length of the union of intervals, in ms. */
function unionMs(intervals: Interval[]): number {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [curS, curE] = [Number.NaN, Number.NaN];
  for (const [s, e] of sorted) {
    if (Number.isNaN(curS) || s > curE) {
      if (!Number.isNaN(curS)) total += curE - curS;
      [curS, curE] = [s, e];
    } else if (e > curE) {
      curE = e;
    }
  }
  if (!Number.isNaN(curS)) total += curE - curS;
  return total;
}

export interface SleepResult {
  asleep_min: number;
  stages: Record<Stage, number>;
  /** When I first fell asleep (ms since epoch), for the "asleep by 23:00" habit. */
  onset: number;
}

/**
 * The night ending on `date` is everything between 15:00 the day before and 15:00 on `date` (local).
 * Samples are clipped to that window; overlaps (e.g. watch + phone) are merged, so nothing counts twice.
 */
export function computeSleep(samples: SleepSample[], date: string, tz: string): SleepResult | null {
  const winStart = zonedToUtc(addDays(date, -1), 15, 0, tz).getTime();
  const winEnd = zonedToUtc(date, 15, 0, tz).getTime();
  const byStage: Record<Stage, Interval[]> = { deep: [], core: [], rem: [], awake: [] };
  for (const s of samples) {
    const stage = stageOf(s.value);
    if (!stage) continue;
    const start = Math.max(Date.parse(s.start), winStart);
    const end = Math.min(Date.parse(s.end), winEnd);
    if (end > start) byStage[stage].push([start, end]);
  }
  const asleep = [...byStage.deep, ...byStage.core, ...byStage.rem];
  if (asleep.length === 0) return null;
  const min = (ms: number) => Math.round(ms / 60000);
  return {
    onset: Math.min(...asleep.map(([s]) => s)),
    asleep_min: min(unionMs(asleep)),
    stages: {
      deep: min(unionMs(byStage.deep)),
      core: min(unionMs(byStage.core)),
      rem: min(unionMs(byStage.rem)),
      awake: min(unionMs(byStage.awake)),
    },
  };
}

/** Mean of the non-null values, rounded; null when there are none. */
export function average(values: (number | null | undefined)[]): number | null {
  const v = values.filter((x): x is number => typeof x === "number");
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
}

/** True when sleep started no later than `by` ("HH:MM") on the evening before `date`. Times after midnight are late. */
export function asleepBy(onset: number, date: string, by: string, tz: string): boolean {
  const [h, m] = by.split(":").map(Number);
  // "by" is on the previous evening when it is in the afternoon/evening, otherwise early on `date` itself
  const day = h >= 12 ? addDays(date, -1) : date;
  return onset <= zonedToUtc(day, h, m, tz).getTime();
}
