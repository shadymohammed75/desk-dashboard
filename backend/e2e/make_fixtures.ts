// Build deterministic API fixtures for the visual tests by running the REAL Worker (respond()) with simulated time:
// five weeks of mixed data (sessions, misses, a skip, a bonus rest-day session, habits, sleep, BP), then snapshots
// of /api/today, /api/config and /api/history at the moments we screenshot.
//   npx tsx e2e/make_fixtures.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { respond, type Env } from "../src/index";
import { addDays, weekdayOf } from "../src/logic/time";
import type { KVLike } from "../src/store";

const TOKEN = "fixture-ingest-token-0123456789";
const data = new Map<string, string>();
const kv: KVLike = {
  async get(k) { const v = data.get(k); return v === undefined ? null : JSON.parse(v); },
  async put(k, v) { data.set(k, v); },
};
const env: Env = { DASH: kv, INGEST_TOKEN: TOKEN, DEVICE_TOKEN: "fixture-device-token-0123456789" };

/** Berlin wall clock → Date (DST ends 2026-10-25 03:00). */
const at = (date: string, hm: string) => new Date(`${date}T${hm}:00${date >= "2026-10-25" ? "+01:00" : "+02:00"}`);

async function call(method: string, path: string, now: Date, body?: unknown) {
  const res = await respond(new Request(`https://x${path}`, {
    method, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env, now);
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}

let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

async function morning(date: string, early: boolean, steps: number) {
  const prev = addDays(date, -1);
  const fell = early ? "22:40" : "23:35";
  await call("POST", "/api/ingest", at(date, "07:30"), {
    date, steps, active_kcal: Math.round(steps / 18), nutrition: { kcal: 1700 + Math.round(rnd() * 900), protein_g: 90 + Math.round(rnd() * 80) },
    sleep_samples: [{ start: `${prev}T${fell}:00+02:00`, end: `${date}T06:50:00${date >= "2026-10-25" ? "+01:00" : "+02:00"}`, value: "Core" }],
    workouts: [],
    vitals: { resting_hr: 54 + Math.round(rnd() * 8), heart_rate: 62 + Math.round(rnd() * 20), spo2: 0.95 + Math.round(rnd() * 4) / 100 },
  });
}

async function tick(date: string, ids: string[], hm = "21:30") {
  for (const id of ids) await call("POST", "/api/tasks", at(date, hm), { id, done: true });
}

const MANUAL = ["apple", "no_sweets", "focus", "morning", "night", "read"];
const NOTES = ["PR bench 80kg", "Felt strong", null, "Short on time, still did it", null, "New grip on rows"];

async function simulateDay(date: string, i: number) {
  const wd = weekdayOf(date);
  const perfect = date === "2026-10-06" || date === "2026-10-15";
  const early = perfect || rnd() > 0.4;
  await morning(date, early, perfect ? 11200 : 4000 + Math.round(rnd() * 8000));
  if (Math.random() < 0 || date >= "2026-09-28" || i % 3 === 0) {
    await call("POST", "/api/bp", at(date, "08:00"), { sys: 120 + Math.round(rnd() * 12), dia: 76 + Math.round(rnd() * 8), pulse: 58 + Math.round(rnd() * 10), ts: at(date, "08:00").toISOString() });
  }
  const planned = !["wed", "sat", "sun"].includes(wd);
  const missed = ["2026-09-24", "2026-10-09"].includes(date);
  const skipped = date === "2026-10-13";
  if (planned && !missed && !skipped) {
    await call("POST", "/api/gym", at(date, "19:00"), { action: "done", duration_min: 45 + Math.round(rnd() * 30), note: NOTES[i % NOTES.length] });
  }
  if (skipped) await call("POST", "/api/gym", at(date, "18:00"), { action: "skip" });
  if (date === "2026-10-10") await call("POST", "/api/gym", at(date, "11:00"), { action: "done", split: "legs", duration_min: 40, note: "Bonus legs" });
  await tick(date, perfect ? MANUAL : MANUAL.filter(() => rnd() > 0.35));
}

const out = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
mkdirSync(out, { recursive: true });
async function snapshot(name: string, now: Date, extra: Record<string, unknown> = {}) {
  const fx = {
    now: now.toISOString(),
    today: await call("GET", "/api/today", now),
    config: await call("GET", "/api/config", now),
    history: await call("GET", "/api/history?days=45", now),
    ...extra,
  };
  writeFileSync(join(out, `${name}.json`), JSON.stringify(fx, null, 2));
  console.log(`${name}: score ${fx.today.dashboard.score.value}%, gym ${fx.today.dashboard.gym.status}, history ${fx.history.days.length} days`);
}

let i = 0;
for (let d = "2026-09-21"; d <= "2026-10-21"; d = addDays(d, 1)) await simulateDay(d, i++);

// Thursday 22 Oct: push day, pending at lunchtime
await morning("2026-10-22", true, 6400);
await tick("2026-10-22", ["apple", "morning"], "09:00");
const done = { action: "done", split: "push", muscles: ["chest", "front_delts", "triceps"], duration_min: 55, note: "PR bench 80kg" };
// the answer the app gets when it saves the session at 19:40 (computed on a copy, so "pending" stays pending)
const before = new Map(data);
const afterGym = await call("POST", "/api/gym", at("2026-10-22", "19:40"), done);
const afterHistory = await call("GET", "/api/history?days=45", at("2026-10-22", "19:41"));
data.clear();
before.forEach((v, k) => data.set(k, v));
await snapshot("push_pending", at("2026-10-22", "13:30"), { after_gym: afterGym, after_history: afterHistory });

await call("POST", "/api/gym", at("2026-10-22", "19:40"), done);
await snapshot("push_done", at("2026-10-22", "19:45"));
await tick("2026-10-22", ["no_sweets", "night", "read"]);
for (const d of ["2026-10-23", "2026-10-24"]) await simulateDay(d, i++);

// Sunday 25 Oct: spa day
await morning("2026-10-25", true, 3900);
await tick("2026-10-25", ["apple", "morning", "read"], "10:30");
await snapshot("spa_day", at("2026-10-25", "11:00"));
