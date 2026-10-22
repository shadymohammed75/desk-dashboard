// Time-zone helpers built on Intl only (no date library). Dates are "YYYY-MM-DD" strings in local time.
import { WEEKDAYS, type Weekday } from "../types";

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

export interface LocalParts {
  date: string;
  hour: number;
  minute: number;
  second: number;
}

export function localParts(instant: Date, tz: string): LocalParts {
  const p: Record<string, string> = {};
  for (const { type, value } of formatter(tz).formatToParts(instant)) p[type] = value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

export const localDate = (instant: Date, tz: string): string => localParts(instant, tz).date;

/** Minutes the zone is ahead of UTC at `instant` (Berlin: 60 or 120). */
export function offsetMinutes(instant: Date, tz: string): number {
  const l = localParts(instant, tz);
  const [y, m, d] = l.date.split("-").map(Number);
  const asUtc = Date.UTC(y, m - 1, d, l.hour, l.minute, l.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/** ISO 8601 with the zone's offset, e.g. "2026-10-22T18:10:00+02:00". */
export function toLocalIso(instant: Date, tz: string): string {
  const l = localParts(instant, tz);
  const off = offsetMinutes(instant, tz);
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${l.date}T${pad(l.hour)}:${pad(l.minute)}:${pad(l.second)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** The UTC instant of a local wall-clock time. */
export function zonedToUtc(date: string, hour: number, minute: number, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const off1 = offsetMinutes(new Date(guess), tz);
  let t = guess - off1 * 60000;
  const off2 = offsetMinutes(new Date(t), tz);
  if (off2 !== off1) t = guess - off2 * 60000;
  return new Date(t);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function weekdayOf(date: string): Weekday {
  const [y, m, d] = date.split("-").map(Number);
  return WEEKDAYS[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7];
}

export function mondayOf(date: string): string {
  return addDays(date, -WEEKDAYS.indexOf(weekdayOf(date)));
}

export function dayOfYear(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000);
}

export const isDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
