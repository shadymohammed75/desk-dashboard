import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { berlin, DEVICE, INGEST, makeApi, sample } from "./helpers";

const ingestBody = (date: string, over: Record<string, unknown> = {}) => ({
  date,
  sent_at: `${date}T18:05:00+02:00`,
  steps: 8432,
  active_kcal: 512,
  nutrition: { kcal: 1850, protein_g: 120 },
  sleep_samples: [sample(`2026-10-21T23:30`, `2026-10-22T06:42`, "Core")],
  workouts: [],
  ...over,
});

/** Run mock/validate.py (the contract check) over real Worker output. */
function validateContract(named: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), "dash-"));
  const files = Object.entries(named).map(([n, d]) => {
    const p = join(dir, `${n}.json`);
    writeFileSync(p, JSON.stringify(d));
    return p;
  });
  return execFileSync("python3", [resolve(__dirname, "../../mock/validate.py"), ...files], { encoding: "utf8" });
}

describe("auth", () => {
  it("rejects missing and wrong tokens with 401", async () => {
    const { call } = makeApi();
    const now = berlin("2026-10-22T10:00");
    expect((await call("GET", "/api/dashboard", { token: null, now })).status).toBe(401);
    expect((await call("GET", "/api/dashboard", { token: "nope", now })).status).toBe(401);
    expect((await call("GET", "/api/today", { token: `${INGEST}x`, now })).status).toBe(401);
  });

  it("keeps the two tokens separate", async () => {
    const { call } = makeApi();
    const now = berlin("2026-10-22T10:00");
    expect((await call("GET", "/api/dashboard", { token: INGEST, now })).status).toBe(401);
    expect((await call("POST", "/api/ingest", { token: DEVICE, body: ingestBody("2026-10-22"), now })).status).toBe(401);
    expect((await call("POST", "/api/bp", { token: DEVICE, body: { sys: 120, dia: 80 }, now })).status).toBe(401);
  });

  it("returns 503 when a token secret is not configured", async () => {
    const api = makeApi();
    delete api.env.DEVICE_TOKEN;
    expect((await api.call("GET", "/api/dashboard", { token: "x", now: new Date() })).status).toBe(503);
  });

  it("refuses to run with a weak token", async () => {
    const api = makeApi();
    api.env.DEVICE_TOKEN = "short";
    const r = await api.call("GET", "/api/dashboard", { token: "short", now: new Date() });
    expect(r.status).toBe(503);
    expect(r.body.error).toMatch(/too short/);
  });

  it("throttles repeated wrong-token attempts", async () => {
    const api = makeApi();
    let n = 0;
    api.env.AUTH_LIMITER = { limit: async () => ({ success: ++n <= 2 }) };
    const now = new Date();
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await api.call("GET", "/api/today", { token: "wrong", now })).status);
    expect(codes).toEqual([401, 401, 429]);
    expect((await api.call("GET", "/api/today", { now })).status).toBe(200); // right token still works
    expect(n).toBe(3);
  });

  it("serves health without a token and 404/405 for unknown routes", async () => {
    const { call } = makeApi();
    const now = new Date();
    expect((await call("GET", "/api/health", { token: null, now })).body).toEqual({ ok: true });
    expect((await call("GET", "/api/nope", { now })).status).toBe(404);
    expect((await call("DELETE", "/api/gym", { now })).status).toBe(405);
  });
});

describe("validation", () => {
  const now = berlin("2026-10-22T10:00");
  const cases: [string, string, unknown, RegExp][] = [
    ["POST", "/api/ingest", { date: "22.10.2026" }, /date must be YYYY-MM-DD/],
    ["POST", "/api/ingest", { date: "2026-10-22", steps: "lots" }, /steps must be a number/],
    ["POST", "/api/ingest", { date: "2026-10-22", sleep_samples: [{ start: "22 Oct at 23:00", end: "x", value: "Core" }] },
      /sleep_samples\[0\]\.start must be an ISO 8601/],
    ["POST", "/api/gym", { action: "finished" }, /action must be/],
    ["POST", "/api/gym", { action: "done", muscles: ["chest", "wings"] }, /muscles\[1\] is not a known muscle id/],
    ["POST", "/api/gym", { action: "done", split: "arms" }, /split must be one of/],
    ["POST", "/api/bp", { sys: 80, dia: 120 }, /dia must be lower than sys/],
    ["POST", "/api/bp", { sys: 120 }, /dia is required/],
    ["PUT", "/api/config", { schedule: { mon: "arms" } }, /schedule.tue is required/],
    ["PUT", "/api/config", { schedule: { mon: "arms", tue: "pull", wed: "rest", thu: "push", fri: "pull", sat: "rest", sun: "rest" } },
      /schedule.mon = "arms" is not a defined split/],
    ["PUT", "/api/config", { goals: { steps: -1 } }, /goals.steps/],
    ["PUT", "/api/config", { colour: "red" }, /unknown config field/],
  ];
  it.each(cases)("%s %s %j → 400", async (method, path, body, msg) => {
    const { call } = makeApi();
    const r = await call(method, path, { body, now });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(msg);
  });

  it("rejects invalid JSON", async () => {
    const api = makeApi();
    const req = new Request("https://dash.example/api/bp", {
      method: "POST", headers: { authorization: `Bearer ${INGEST}` }, body: "{not json",
    });
    const { respond } = await import("../src/index");
    const res = await respond(req, api.env, now);
    expect(res.status).toBe(400);
  });

  it("reads grouped thousands from German/English Shortcuts as whole numbers", async () => {
    const { call } = makeApi();
    await call("POST", "/api/ingest", {
      body: { date: "2026-10-22", steps: "8.432", active_kcal: "1,050", nutrition: { kcal: "2.150", protein_g: "120,4" } }, now,
    });
    const d = (await call("GET", "/api/dashboard", { now })).body;
    expect([d.steps.value, d.active.kcal, d.food.kcal, d.food.protein_g]).toEqual([8432, 1050, 2150, 120]);
  });

  it("accepts the exact body shape the iOS Shortcut builds (shortcuts/README.md)", async () => {
    const { call } = makeApi();
    const body = JSON.parse(`{"date":"2026-10-22","sent_at":"2026-10-22T07:05:12+02:00","steps":"8.432","active_kcal":"512",
      "nutrition":{"kcal":"1850","protein_g":"120"},
      "sleep_samples":[{"start":"2026-10-21T23:30:00+02:00","end":"2026-10-22T06:42:00+02:00","value":"Core"}],
      "workouts":[{"type":"Traditional Strength Training","start":"2026-10-22T06:50:00+02:00","duration_min":"41"}]}`);
    expect((await call("POST", "/api/ingest", { body, now })).body).toEqual({ ok: true, date: "2026-10-22" });
    const d = (await call("GET", "/api/dashboard", { now })).body;
    expect(d).toMatchObject({ steps: { value: 8432 }, sleep: { asleep_min: 432 }, gym: { status: "done", done_min: 41 } });
    const empty = { ...body, sleep_samples: [], workouts: [] };
    expect((await call("POST", "/api/ingest", { body: empty, now })).status).toBe(200);
  });

  it("shows what the last sync delivered", async () => {
    const { call } = makeApi();
    expect((await call("GET", "/api/debug/last-ingest", { now })).body).toEqual({ last_ingest: null, ingest: null });
    await call("POST", "/api/ingest", { body: ingestBody("2026-10-22"), now });
    const r = (await call("GET", "/api/debug/last-ingest", { now })).body;
    expect(r).toMatchObject({ date: "2026-10-22", steps: 8432, sleep: { samples: 1, values: ["Core"], asleep_min: 432 } });
    expect((await call("GET", "/api/debug/last-ingest", { now, token: DEVICE })).status).toBe(401);
  });

  it("accepts numbers sent as strings by Shortcuts", async () => {
    const { call } = makeApi();
    const r = await call("POST", "/api/ingest", { body: { date: "2026-10-22", steps: "8432", nutrition: { kcal: "1850,5" } }, now });
    expect(r.status).toBe(200);
    const d = (await call("GET", "/api/dashboard", { now })).body;
    expect(d.steps.value).toBe(8432);
    expect(d.food.kcal).toBe(1851);
  });
});

describe("dashboard", () => {
  it("works with no data at all", async () => {
    const { call } = makeApi();
    const d = (await call("GET", "/api/dashboard", { now: berlin("2026-10-22T10:30") })).body;
    expect(d).toMatchObject({
      stale: true, updated: null, mode: "day", bp: null, celebrate: null,
      sleep: { asleep_min: null, avg7_min: null, stages: null },
      steps: { value: null }, food: { kcal: null, protein_g: null },
      gym: { status: "pending", label: "PUSH", week_done: 0 },
      score: { value: 0, parts: { sleep: null, move: null, food: null, gym: 0 } },
      progress: { level: 1, xp: 0, xp_next: 150, streak_days: 0 },
    });
    expect(d.week.map((x: any) => x.state)).toEqual(["planned", "planned", "rest", "today", "planned", "rest", "rest"]);
    expect(validateContract({ no_data: d })).toContain("1/1 valid");
  });

  it("shows ingested data, then goes stale after 3 hours", async () => {
    const { call } = makeApi();
    await call("POST", "/api/ingest", { body: ingestBody("2026-10-22"), now: berlin("2026-10-22T18:05") });
    let d = (await call("GET", "/api/dashboard", { now: berlin("2026-10-22T18:10") })).body;
    expect(d).toMatchObject({
      now: "2026-10-22T18:10:00+02:00", updated: "2026-10-22T18:05:00+02:00", stale: false, mode: "evening",
      sleep: { asleep_min: 432 }, steps: { value: 8432 }, food: { kcal: 1850, protein_g: 120 },
      coach: { tone: "nudge" }, mascot: "pumped",
    });
    d = (await call("GET", "/api/dashboard", { now: berlin("2026-10-22T21:06") })).body;
    expect(d.stale).toBe(true);
  });

  it("lets an app 'done' override Apple Health and fills the body map with what I trained", async () => {
    const { call } = makeApi();
    const now = berlin("2026-10-22T19:00");
    await call("POST", "/api/ingest", {
      body: ingestBody("2026-10-22", { workouts: [{ type: "Traditional Strength Training", duration_min: 40 }] }), now,
    });
    let d = (await call("GET", "/api/dashboard", { now })).body;
    expect(d.gym).toMatchObject({ status: "done", done_min: 40, muscles: ["chest", "front_delts", "side_delts", "triceps"] });
    await call("POST", "/api/gym", {
      body: { action: "done", split: "push", muscles: ["chest", "front_delts", "triceps"], duration_min: 55, note: "PR bench 80kg" }, now,
    });
    d = (await call("GET", "/api/dashboard", { now })).body;
    expect(d.gym).toMatchObject({ status: "done", done_min: 55, muscles: ["chest", "front_delts", "triceps"], week_done: 1 });
  });

  it("handles training on a rest day", async () => {
    const { call } = makeApi();
    const now = berlin("2026-10-21T17:00"); // Wednesday, rest
    const r = await call("POST", "/api/gym", { body: { action: "done", split: "legs", duration_min: 45 }, now });
    expect(r.body.dashboard.gym).toMatchObject({ status: "done", label: "LEGS", muscles: ["quads", "hamstrings", "glutes", "calves"] });
    expect(r.body.dashboard.celebrate).toMatchObject({ title: "BONUS SESSION DONE", sub: "+70 XP · streak 1" });
    expect(r.body.dashboard.progress.xp).toBe(70);
  });

  it("supports skip, then undo", async () => {
    const { call } = makeApi();
    const now = berlin("2026-10-22T12:00");
    let r = await call("POST", "/api/gym", { body: { action: "skip" }, now });
    expect(r.body.dashboard.gym.status).toBe("skipped");
    expect(r.body.dashboard.week[3].state).toBe("skipped");
    expect(r.body.dashboard.progress.streak_days).toBe(0);
    r = await call("POST", "/api/gym", { body: { action: "undo" }, now });
    expect(r.body.dashboard.gym.status).toBe("pending");
    expect(r.body.entry).toBeNull();
  });

  it("does not double XP on repeated ingest", async () => {
    const { call } = makeApi();
    const now = berlin("2026-10-22T20:00");
    const body = ingestBody("2026-10-22", { steps: 12000, nutrition: { kcal: 2500, protein_g: 170 } });
    await call("POST", "/api/ingest", { body, now });
    const xp1 = (await call("GET", "/api/dashboard", { now })).body.progress.xp;
    expect(xp1).toBe(40); // steps + protein
    for (let i = 0; i < 3; i++) await call("POST", "/api/ingest", { body, now });
    expect((await call("GET", "/api/dashboard", { now })).body.progress.xp).toBe(xp1);
  });

  it("fires a celebration once and keeps it for 30 minutes", async () => {
    const { call } = makeApi();
    const t0 = berlin("2026-10-22T19:00");
    await call("POST", "/api/gym", { body: { action: "done", duration_min: 55 }, now: t0 });
    let d = (await call("GET", "/api/dashboard", { now: berlin("2026-10-22T19:10") })).body;
    expect(d.celebrate).toEqual({ id: "gym_done_2026-10-22", title: "PUSH DAY COMPLETE", sub: "+50 XP · streak 1" });
    // undo + redo must not create a second celebration
    await call("POST", "/api/gym", { body: { action: "undo" }, now: berlin("2026-10-22T19:20") });
    await call("POST", "/api/gym", { body: { action: "done", duration_min: 55 }, now: berlin("2026-10-22T19:21") });
    d = (await call("GET", "/api/dashboard", { now: berlin("2026-10-22T19:45") })).body;
    expect(d.celebrate).toBeNull();
  });

  it("logs BP and shows a 7-day trend", async () => {
    const { call } = makeApi();
    await call("POST", "/api/bp", { body: { sys: 126, dia: 80, pulse: 66, ts: "2026-10-21T08:00:00+02:00" }, now: berlin("2026-10-22T08:00") });
    await call("POST", "/api/bp", { body: { sys: 128, dia: 82, pulse: 64, ts: "2026-10-22T08:10:00+02:00" }, now: berlin("2026-10-22T08:11") });
    await call("POST", "/api/bp", { body: { sys: 132, dia: 84, pulse: 70 }, now: berlin("2026-10-22T20:00") });
    const d = (await call("GET", "/api/dashboard", { now: berlin("2026-10-22T20:01") })).body;
    expect(d.bp).toMatchObject({ sys: 132, dia: 84, pulse: 70, ts: "2026-10-22T20:00:00+02:00", trend7: [[126, 80], [130, 83]] });
    expect(d.progress.xp).toBe(20); // "BP logged" once per day (21st + 22nd), not per reading
  });

  it("changes today's plan when the config is edited", async () => {
    const { call } = makeApi();
    const now = berlin("2026-10-22T12:00");
    const cfg = (await call("GET", "/api/config", { now })).body;
    const r = await call("PUT", "/api/config", { body: { schedule: { ...cfg.schedule, thu: "legs" } }, now });
    expect(r.status).toBe(200);
    const d = (await call("GET", "/api/dashboard", { now })).body;
    expect(d.gym).toMatchObject({ day_type: "legs", label: "LEGS", muscles: ["quads", "hamstrings", "glutes", "calves"] });
  });

  it("rolls the week over on Monday and keeps the streak through rest days", async () => {
    const { call } = makeApi();
    await call("POST", "/api/gym", { body: { action: "done" }, now: berlin("2026-10-22T18:00") }); // Thu push
    await call("POST", "/api/gym", { body: { action: "done" }, now: berlin("2026-10-23T18:00") }); // Fri pull
    let d = (await call("GET", "/api/dashboard", { now: berlin("2026-10-25T12:00") })).body;          // Sun rest
    expect(d.gym.week_done).toBe(2);
    expect(d.progress.streak_days).toBe(4); // Thu, Fri, Sat (rest), Sun (rest)
    d = (await call("GET", "/api/dashboard", { now: new Date("2026-10-26T09:00:00+01:00") })).body;  // Mon, after DST
    expect(d.gym).toMatchObject({ week_done: 0, status: "pending", label: "PUSH" });
    expect(d.week.map((x: any) => x.state)).toEqual(["today", "planned", "rest", "planned", "planned", "rest", "rest"]);
    expect(d.now).toBe("2026-10-26T09:00:00+01:00");
    expect(d.progress.streak_days).toBe(4);
    // Missing Monday resets the streak on Tuesday
    d = (await call("GET", "/api/dashboard", { now: new Date("2026-10-27T09:00:00+01:00") })).body;
    expect(d.progress).toMatchObject({ streak_days: 0, best_streak: 4 });
    expect(d.week[0].state).toBe("missed");
  });

  it("returns history for the app", async () => {
    const { call } = makeApi();
    await call("POST", "/api/gym", { body: { action: "done", duration_min: 50, note: "felt strong" }, now: berlin("2026-10-22T18:00") });
    await call("POST", "/api/bp", { body: { sys: 125, dia: 81 }, now: berlin("2026-10-22T18:30") });
    const h = (await call("GET", "/api/history?days=3", { now: berlin("2026-10-22T20:00") })).body;
    expect(h.days.map((x: any) => [x.date, x.status])).toEqual([["2026-10-22", "done"], ["2026-10-21", "rest"], ["2026-10-20", "no_data"]]);
    expect(h.days[0]).toMatchObject({ note: "felt strong", duration_min: 50, bp: [{ sys: 125, dia: 81 }] });
    expect((await call("GET", "/api/history?days=99", { now: new Date() })).status).toBe(400);
    // once tracking has started, an unlogged planned day is "missed"
    const later = (await call("GET", "/api/history?days=7", { now: berlin("2026-10-27T20:00") })).body;
    expect(later.days.find((x: any) => x.date === "2026-10-26").status).toBe("missed");
  });

  it("produces output that passes the mock contract in every state", async () => {
    const out: Record<string, unknown> = {};
    const { call } = makeApi();
    await call("POST", "/api/ingest", { body: ingestBody("2026-10-22"), now: berlin("2026-10-22T07:05") });
    out.morning = (await call("GET", "/api/dashboard", { now: berlin("2026-10-22T07:15") })).body;
    out.evening = (await call("GET", "/api/dashboard", { now: berlin("2026-10-22T19:00") })).body;
    await call("POST", "/api/gym", { body: { action: "done", duration_min: 55 }, now: berlin("2026-10-22T19:30") });
    await call("POST", "/api/bp", { body: { sys: 128, dia: 82, pulse: 64 }, now: berlin("2026-10-22T19:31") });
    out.done = (await call("GET", "/api/dashboard", { now: berlin("2026-10-22T19:35") })).body;
    out.rest = (await call("GET", "/api/dashboard", { now: berlin("2026-10-24T12:00") })).body;
    out.stale = (await call("GET", "/api/dashboard", { now: berlin("2026-10-23T12:00") })).body;
    expect(validateContract(out)).toContain("5/5 valid");
  });
});
