// Blood pressure: latest reading. Values are shown neutrally, never judged.
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

export function loggedOn(list: BpReading[], date: string, tz: string): boolean {
  return list.some((r) => localDate(new Date(r.ts), tz) === date);
}
