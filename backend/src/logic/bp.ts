// Blood pressure: latest reading and a 7-day trend of daily means. Values are shown neutrally, never judged.
import type { BpReading } from "../types";
import { addDays, localDate } from "./time";

export const BP_KEEP = 60;

/** Insert a reading, keep the list sorted by time and capped at BP_KEEP. */
export function addReading(list: BpReading[], r: BpReading): BpReading[] {
  const next = [...list.filter((x) => x.ts !== r.ts), r];
  next.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  return next.slice(-BP_KEEP);
}

export function latest(list: BpReading[]): BpReading | null {
  return list.length ? list[list.length - 1] : null;
}

/** Daily means (rounded) for the 7 days ending `today`, oldest first; days without readings are left out. */
export function trend7(list: BpReading[], today: string, tz: string): [number, number][] {
  const from = addDays(today, -6);
  const byDay = new Map<string, BpReading[]>();
  for (const r of list) {
    const d = localDate(new Date(r.ts), tz);
    if (d < from || d > today) continue;
    byDay.set(d, [...(byDay.get(d) ?? []), r]);
  }
  return [...byDay.keys()].sort().map((d) => {
    const rs = byDay.get(d)!;
    const mean = (k: "sys" | "dia") => Math.round(rs.reduce((a, r) => a + r[k], 0) / rs.length);
    return [mean("sys"), mean("dia")];
  });
}

export function loggedOn(list: BpReading[], date: string, tz: string): boolean {
  return list.some((r) => localDate(new Date(r.ts), tz) === date);
}
