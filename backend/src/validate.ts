// Input validation for every write. Hand-rolled to stay dependency-free; errors become 400s with a clear message.
import { MUSCLES, WEEKDAYS, type BpReading, type Config, type GymEntry, type Ingest, type SleepSample, type Workout } from "./types";
import { isDate } from "./logic/time";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const bad = (msg: string): never => {
  throw new HttpError(400, msg);
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function obj(v: unknown, path: string): Record<string, unknown> {
  return isObj(v) ? v : bad(`${path} must be a JSON object`);
}

/** Numbers may arrive as strings from iOS Shortcuts ("8432", "1850.5"); null/absent means "no data". */
function num(v: unknown, path: string, min: number, max: number, opts: { int?: boolean } = {}): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return bad(`${path} must be a number`);
  if (n < min || n > max) return bad(`${path} must be between ${min} and ${max}`);
  return opts.int ? Math.round(n) : Math.round(n * 10) / 10;
}

function reqNum(v: unknown, path: string, min: number, max: number, opts: { int?: boolean } = {}): number {
  return num(v, path, min, max, opts) ?? bad(`${path} is required`);
}

function str(v: unknown, path: string, max: number): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return bad(`${path} must be a string`);
  if (v.length > max) return bad(`${path} must be at most ${max} characters`);
  return v;
}

function iso(v: unknown, path: string): string {
  if (typeof v !== "string" || Number.isNaN(Date.parse(v)) || !/^\d{4}-\d{2}-\d{2}T/.test(v)) {
    return bad(`${path} must be an ISO 8601 date-time like 2026-10-22T08:10:00+02:00`);
  }
  return v;
}

function arr(v: unknown, path: string, max: number): unknown[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) return bad(`${path} must be an array`);
  if (v.length > max) return bad(`${path} has more than ${max} items`);
  return v;
}

const MUSCLE_SET = new Set<string>(MUSCLES);

function muscles(v: unknown, path: string): string[] {
  const list = arr(v, path, MUSCLES.length);
  for (const [i, m] of list.entries()) {
    if (typeof m !== "string" || !MUSCLE_SET.has(m)) bad(`${path}[${i}] is not a known muscle id (${String(m)})`);
  }
  return [...new Set(list as string[])];
}

// ---------------------------------------------------------------- POST /api/ingest

export function parseIngest(body: unknown, receivedAt: string): { date: string; ingest: Ingest } {
  const b = obj(body, "body");
  if (!isDate(b.date)) bad("date must be YYYY-MM-DD");
  const n = b.nutrition === undefined || b.nutrition === null ? {} : obj(b.nutrition, "nutrition");
  const sleep_samples: SleepSample[] = arr(b.sleep_samples, "sleep_samples", 3000).map((x, i) => {
    const s = obj(x, `sleep_samples[${i}]`);
    const start = iso(s.start, `sleep_samples[${i}].start`);
    const end = iso(s.end, `sleep_samples[${i}].end`);
    if (Date.parse(end) < Date.parse(start)) bad(`sleep_samples[${i}] ends before it starts`);
    return { start, end, value: str(s.value, `sleep_samples[${i}].value`, 60) ?? bad(`sleep_samples[${i}].value is required`) };
  });
  const workouts: Workout[] = arr(b.workouts, "workouts", 100).map((x, i) => {
    const w = obj(x, `workouts[${i}]`);
    return {
      type: str(w.type, `workouts[${i}].type`, 100) ?? bad(`workouts[${i}].type is required`),
      start: w.start === undefined || w.start === null ? undefined : iso(w.start, `workouts[${i}].start`),
      duration_min: reqNum(w.duration_min, `workouts[${i}].duration_min`, 0, 1440),
    };
  });
  return {
    date: b.date as string,
    ingest: {
      sent_at: b.sent_at === undefined || b.sent_at === null ? null : iso(b.sent_at, "sent_at"),
      received_at: receivedAt,
      steps: num(b.steps, "steps", 0, 300000, { int: true }),
      active_kcal: num(b.active_kcal, "active_kcal", 0, 20000, { int: true }),
      nutrition: {
        kcal: num(n.kcal, "nutrition.kcal", 0, 20000, { int: true }),
        protein_g: num(n.protein_g, "nutrition.protein_g", 0, 2000, { int: true }),
      },
      sleep_samples,
      workouts,
    },
  };
}

// ---------------------------------------------------------------- POST /api/gym

export type GymAction = { action: "undo"; date: string | null } | { action: "done" | "skip"; date: string | null; entry: GymEntry };

export function parseGym(body: unknown, config: Config, nowIso: string): GymAction {
  const b = obj(body, "body");
  const action = b.action;
  if (action !== "done" && action !== "skip" && action !== "undo") bad('action must be "done", "skip" or "undo"');
  const date = b.date === undefined || b.date === null ? null : isDate(b.date) ? (b.date as string) : bad("date must be YYYY-MM-DD");
  if (action === "undo") return { action, date };
  const split = str(b.split, "split", 20);
  if (split !== null && !(split in config.splits) && split !== "other") {
    bad(`split must be one of: ${[...Object.keys(config.splits), "other"].join(", ")}`);
  }
  return {
    action: action as "done" | "skip",
    date,
    entry: {
      action: action as "done" | "skip",
      split,
      muscles: b.muscles === undefined || b.muscles === null ? null : muscles(b.muscles, "muscles"),
      duration_min: num(b.duration_min, "duration_min", 1, 600, { int: true }),
      note: str(b.note, "note", 200),
      ts: nowIso,
    },
  };
}

// ---------------------------------------------------------------- POST /api/bp

export function parseBp(body: unknown, now: Date): BpReading {
  const b = obj(body, "body");
  const sys = reqNum(b.sys, "sys", 60, 260, { int: true });
  const dia = reqNum(b.dia, "dia", 30, 180, { int: true });
  if (dia >= sys) bad("dia must be lower than sys");
  const ts = b.ts === undefined || b.ts === null ? now.toISOString() : iso(b.ts, "ts");
  if (Date.parse(ts) > now.getTime() + 5 * 60 * 1000) bad("ts is in the future");
  return { sys, dia, pulse: num(b.pulse, "pulse", 25, 250, { int: true }), ts: new Date(ts).toISOString() };
}

// ---------------------------------------------------------------- PUT /api/config

function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Any of timezone/schedule/splits/goals may be sent; each one sent replaces the current one. */
export function parseConfig(body: unknown, current: Config): Config {
  const b = obj(body, "body");
  const known = ["timezone", "schedule", "splits", "goals"];
  const unknown = Object.keys(b).filter((k) => !known.includes(k));
  if (unknown.length) bad(`unknown config field(s): ${unknown.join(", ")}`);
  if (Object.keys(b).length === 0) bad(`send at least one of: ${known.join(", ")}`);

  const timezone = b.timezone === undefined ? current.timezone : str(b.timezone, "timezone", 64) ?? bad("timezone is required");
  if (!validTimezone(timezone)) bad(`timezone ${timezone} is not a valid IANA time zone`);

  let splits = current.splits;
  if (b.splits !== undefined) {
    const s = obj(b.splits, "splits");
    if (Object.keys(s).length === 0 || Object.keys(s).length > 12) bad("splits must have 1 to 12 entries");
    splits = {};
    for (const [key, v] of Object.entries(s)) {
      if (!/^[a-z0-9_]{1,20}$/.test(key)) bad(`split key "${key}" must be lowercase letters, digits or _`);
      const sp = obj(v, `splits.${key}`);
      const label = str(sp.label, `splits.${key}.label`, 12) ?? bad(`splits.${key}.label is required`);
      if (!label.trim()) bad(`splits.${key}.label is empty`);
      splits[key] = { label: label.trim(), muscles: muscles(sp.muscles, `splits.${key}.muscles`) };
    }
  }

  let schedule = current.schedule;
  if (b.schedule !== undefined) {
    const s = obj(b.schedule, "schedule");
    schedule = { ...current.schedule };
    for (const d of WEEKDAYS) {
      if (typeof s[d] !== "string") bad(`schedule.${d} is required`);
      schedule[d] = s[d] as string;
    }
  }
  for (const d of WEEKDAYS) {
    if (!(schedule[d] in splits)) bad(`schedule.${d} = "${schedule[d]}" is not a defined split`);
  }

  let goals = current.goals;
  if (b.goals !== undefined) {
    const g = obj(b.goals, "goals");
    goals = {
      steps: reqNum(g.steps, "goals.steps", 1, 100000, { int: true }),
      active_kcal: reqNum(g.active_kcal, "goals.active_kcal", 1, 10000, { int: true }),
      kcal: reqNum(g.kcal, "goals.kcal", 500, 10000, { int: true }),
      protein_g: reqNum(g.protein_g, "goals.protein_g", 1, 1000, { int: true }),
      sleep_min: reqNum(g.sleep_min, "goals.sleep_min", 60, 960, { int: true }),
      gym_per_week: reqNum(g.gym_per_week, "goals.gym_per_week", 0, 14, { int: true }),
    };
  }
  return { timezone, schedule, splits, goals };
}
