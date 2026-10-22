import { describe, expect, it } from "vitest";
import { gymStatus } from "../src/logic/gym";
import {
  COACH_RULES, activeCelebration, coach, coachRule, levelFor, mascot, modeFor, newCelebrations, pointsFor, streak,
  week, xpEvents, type CoachInput,
} from "../src/logic/motivation";
import { asleepBy } from "../src/logic/sleep";
import { scoreOf, taskStates } from "../src/logic/tasks";
import type { DayRecord, DaysIndex, DaySummary, GymResult, Ingest } from "../src/types";
import { config } from "./helpers";

const ingest = (over: Partial<Ingest> = {}): Ingest => ({
  sent_at: null, received_at: "2026-10-22T10:00:00Z", steps: null, active_kcal: null,
  nutrition: { kcal: null, protein_g: null }, sleep_samples: [], workouts: [], ...over,
});

describe("gym status (§4.3)", () => {
  const cfg = config();
  const THU = "2026-10-22"; // push
  const WED = "2026-10-21"; // rest

  it("is pending on a planned day with no data, rest on a rest day", () => {
    expect(gymStatus(undefined, cfg, THU)).toMatchObject({ status: "pending", label: "PUSH", day_type: "push" });
    expect(gymStatus(undefined, cfg, WED)).toMatchObject({ status: "rest", muscles: [] });
  });

  it("uses an Apple Health strength workout of 20+ min as a backup", () => {
    const day: DayRecord = { ingest: ingest({ workouts: [{ type: "Traditional Strength Training", duration_min: 41 }] }) };
    expect(gymStatus(day, cfg, THU)).toMatchObject({ status: "done", source: "health", done_min: 41,
      muscles: cfg.splits.push.muscles });
    const short: DayRecord = { ingest: ingest({ workouts: [{ type: "Functional Strength Training", duration_min: 15 }] }) };
    expect(gymStatus(short, cfg, THU).status).toBe("pending");
    const run: DayRecord = { ingest: ingest({ workouts: [{ type: "Running", duration_min: 40 }] }) };
    expect(gymStatus(run, cfg, THU).status).toBe("pending");
  });

  it("lets an app entry override Apple Health", () => {
    const day: DayRecord = {
      ingest: ingest({ workouts: [{ type: "Traditional Strength Training", duration_min: 41 }] }),
      gym: { action: "skip", split: null, muscles: null, duration_min: null, note: null, ts: "" },
    };
    expect(gymStatus(day, cfg, THU)).toMatchObject({ status: "skipped", source: "app" });
    day.gym = { action: "done", split: "push", muscles: ["chest", "triceps"], duration_min: 55, note: null, ts: "" };
    expect(gymStatus(day, cfg, THU)).toMatchObject({ status: "done", source: "app", muscles: ["chest", "triceps"], done_min: 55 });
  });

  it("defaults missing muscles to the logged split", () => {
    const day: DayRecord = { gym: { action: "done", split: "legs", muscles: null, duration_min: 50, note: null, ts: "" } };
    expect(gymStatus(day, cfg, THU)).toMatchObject({ day_type: "legs", label: "LEGS", muscles: cfg.splits.legs.muscles });
  });

  it("marks training on a rest day as done with the logged muscles", () => {
    const day: DayRecord = { gym: { action: "done", split: "pull", muscles: ["biceps"], duration_min: 30, note: null, ts: "" } };
    expect(gymStatus(day, cfg, WED)).toMatchObject({ status: "done", muscles: ["biceps"], rest_training: true });
  });
});

describe("daily score = habits (§4.3b)", () => {
  const cfg = config();
  const g = (status: GymResult["status"]) => ({ status } as GymResult);

  it("is the share of habits done, and perfect only when all are", () => {
    const none = scoreOf(taskStates(cfg, undefined, { gym: g("pending"), steps: null, asleepByGoal: null }));
    expect(none).toMatchObject({ value: 0, done: 0, total: 9, perfect: false });
    const manual = Object.fromEntries(cfg.tasks.map((t) => [t.id, true]));
    const all = scoreOf(taskStates(cfg, { tasks: manual }, { gym: g("done"), steps: 12000, asleepByGoal: true }));
    expect(all).toMatchObject({ value: 100, done: 9, perfect: true });
    const some = scoreOf(taskStates(cfg, { tasks: { apple: true, read: true } }, { gym: g("rest"), steps: 3000, asleepByGoal: false }));
    expect(some).toMatchObject({ value: 33, done: 3, perfect: false });   // gym (rest) + apple + read
  });

  it("ticks auto habits from data, and lets me tick them by hand when data is missing", () => {
    const t = (steps: number | null, manual = false) =>
      taskStates(cfg, manual ? { tasks: { steps: true } } : undefined, { gym: g("pending"), steps, asleepByGoal: null })
        .find((x) => x.id === "steps")!;
    expect(t(9999).done).toBe(false);
    expect(t(10000)).toMatchObject({ done: true, auto: true });
    expect(t(null, true).done).toBe(true);
  });

  it("knows whether I was asleep by 23:00", () => {
    const tz = "Europe/Berlin";
    expect(asleepBy(Date.parse("2026-10-21T22:55:00+02:00"), "2026-10-22", "23:00", tz)).toBe(true);
    expect(asleepBy(Date.parse("2026-10-21T23:20:00+02:00"), "2026-10-22", "23:00", tz)).toBe(false);
    expect(asleepBy(Date.parse("2026-10-22T00:30:00+02:00"), "2026-10-22", "23:00", tz)).toBe(false);
    expect(asleepBy(Date.parse("2026-10-22T00:20:00+02:00"), "2026-10-22", "00:30", tz)).toBe(true);
  });
});

describe("split colours and day icons", () => {
  const cfg = config();
  it("styles Sunday as the spa day and other rest days with a moon", () => {
    expect(gymStatus(undefined, cfg, "2026-10-25")).toMatchObject({ status: "rest", label: "SPA DAY", icon: "hot_tub", color: "#2DD4BF" });
    expect(gymStatus(undefined, cfg, "2026-10-21")).toMatchObject({ label: "REST DAY", icon: "bedtime", color: "#2DD4BF" });
    expect(gymStatus(undefined, cfg, "2026-10-22")).toMatchObject({ label: "PUSH", icon: "fitness_center", color: "#FF6A1A" });
  });
  it("uses the trained split's colour when I log a different split", () => {
    const day: DayRecord = { gym: { action: "done", split: "legs", muscles: null, duration_min: 40, note: null, ts: "" } };
    expect(gymStatus(day, cfg, "2026-10-25")).toMatchObject({ label: "LEGS", color: "#8B7CFF", icon: "directions_run" });
  });
});

describe("XP and levels", () => {
  it("follows xp_next = 100 + 50 × level, with exact boundaries", () => {
    expect(levelFor(0)).toEqual({ level: 1, xp: 0, xp_next: 150 });
    expect(levelFor(149)).toEqual({ level: 1, xp: 149, xp_next: 150 });
    expect(levelFor(150)).toEqual({ level: 2, xp: 0, xp_next: 200 });
    expect(levelFor(350)).toEqual({ level: 3, xp: 0, xp_next: 250 });
  });

  it("gives a rest-day session a bonus on top of gym done (not double)", () => {
    const gym = { status: "done", rest_training: true } as GymResult;
    expect(xpEvents(gym, scoreOf([]), false)).toEqual(["gym_done", "rest_training"]);
  });

  it("gives 10 XP per habit and a perfect-day bonus", () => {
    const cfg = config();
    const manual = Object.fromEntries(cfg.tasks.map((t) => [t.id, true]));
    const gym = { status: "done", rest_training: false } as GymResult;
    const sc = scoreOf(taskStates(cfg, { tasks: manual }, { gym, steps: 0, asleepByGoal: false }));
    const e = xpEvents(gym, sc, true);
    expect(e.filter((x) => x.startsWith("task:"))).toHaveLength(8);   // every habit but "gym"
    expect(pointsFor(e)).toBe(50 + 8 * 10 + 10 + 30);
  });
});

describe("streak and week", () => {
  const cfg = config();
  const sum = (status: DaySummary["status"]): DaySummary =>
    ({ plan: "", status, muscles: [], asleep_min: null, events: [], points: 0 });
  // Mon 19 push, Tue 20 pull, Wed 21 rest, Thu 22 push (today)
  const idx = (days: Record<string, DaySummary>): DaysIndex => ({ archived_xp: 0, days });

  it("survives rest days and counts today once done", () => {
    const i = idx({ "2026-10-19": sum("done"), "2026-10-20": sum("done"), "2026-10-21": sum("rest") });
    expect(streak("2026-10-22", i, cfg, "pending")).toBe(3);
    expect(streak("2026-10-22", i, cfg, "done")).toBe(4);
  });

  it("counts rest days with no record at all", () => {
    const i = idx({ "2026-10-19": sum("done"), "2026-10-20": sum("done") });
    expect(streak("2026-10-22", i, cfg, "done")).toBe(4);
  });

  it("resets on a skip today and on a skipped or missed planned day", () => {
    const i = idx({ "2026-10-19": sum("done"), "2026-10-20": sum("done"), "2026-10-21": sum("rest") });
    expect(streak("2026-10-22", i, cfg, "skipped")).toBe(0);
    expect(streak("2026-10-22", idx({ ...i.days, "2026-10-20": sum("skipped") }), cfg, "done")).toBe(2);
    expect(streak("2026-10-22", idx({ ...i.days, "2026-10-20": sum("pending") }), cfg, "done")).toBe(2);
  });

  it("does not count days before tracking started", () => {
    expect(streak("2026-10-22", idx({}), cfg, "done")).toBe(1);
  });

  it("builds the week strip", () => {
    const i = idx({ "2026-10-19": sum("done"), "2026-10-20": sum("pending") });
    const wk = week("2026-10-22", i, cfg, gymStatus(undefined, cfg, "2026-10-22"));
    expect(wk.map((d) => d.state)).toEqual(["done", "missed", "rest", "today", "planned", "rest", "rest"]);
    expect(wk.map((d) => d.icon)).toEqual(["fitness_center", "rowing", "bedtime", "fitness_center", "rowing", "bedtime", "hot_tub"]);
    expect(wk[2].color).toBe("#2DD4BF");
  });
});

describe("mode, coach and mascot", () => {
  const g = config().goals;
  const gym = (status: GymResult["status"]): GymResult => ({ day_type: "push", label: "PUSH", color: "#FF6A1A",
    icon: "fitness_center", muscles: [], status, done_min: null, source: "plan", rest_training: false });
  const sc = (done: number, total = 9) => ({ value: 0, done, total, perfect: done === total, tasks: [] });
  const base: CoachInput = { date: "2026-10-22", mode: "day", hour: 13, gym: gym("pending"), asleep_min: 430,
    protein_g: 100, goals: g, streak: 3, score: sc(2) };

  it("maps hours to modes", () => {
    expect([4, 5, 9, 10, 17, 18, 22, 23].map(modeFor))
      .toEqual(["night", "morning", "morning", "day", "day", "evening", "evening", "night"]);
  });

  it("applies rule priority", () => {
    expect(coachRule({ ...base, gym: gym("done"), streak: 7 })).toBe("milestone");
    expect(coachRule({ ...base, gym: gym("done"), score: sc(9) })).toBe("perfect");
    expect(coachRule({ ...base, gym: gym("done"), hour: 19, mode: "evening", score: sc(7) })).toBe("tasks_left");
    expect(coachRule({ ...base, gym: gym("done"), hour: 19, mode: "evening", score: sc(2) })).toBe("done");
    expect(coachRule({ ...base, gym: gym("pending"), streak: 7 })).toBe("pending_day"); // today not counted yet
    expect(coachRule({ ...base, mode: "morning", asleep_min: 300, gym: gym("done") })).toBe("done");
    expect(coachRule({ ...base, mode: "morning", asleep_min: 300 })).toBe("short_sleep");
    expect(coachRule({ ...base, mode: "morning", asleep_min: 460 })).toBe("rested");
    expect(coachRule({ ...base, mode: "morning", asleep_min: 430 })).toBe("pending_day");
    expect(coachRule({ ...base, mode: "evening", hour: 19 })).toBe("pending_evening");
    expect(coachRule({ ...base, mode: "evening", hour: 19, gym: gym("rest") })).toBe("protein");
    expect(coachRule({ ...base, mode: "evening", hour: 19, gym: gym("rest"), protein_g: 170 })).toBe("rest");
    expect(coachRule({ ...base, gym: gym("skipped") })).toBe("skipped");
  });

  it("keeps every coach line under 50 characters and rotates daily", () => {
    const long = { ...base, gym: { ...gym("pending"), label: "ABCDEFGHIJKL" }, streak: 100, protein_g: 0 };
    for (const r of COACH_RULES) {
      for (const v of r.variants) {
        const text = v.replace("{L}", "ABCDEFGHIJKL").replace("{l}", "Abcdefghijkl").replace("{N}", "100").replace("{G}", "1000")
          .replace("{R}", "15").replaceAll("{T}", "15");
        expect(text.length, text).toBeLessThan(50);
      }
    }
    expect(coach(long).text.length).toBeLessThan(50);
    const days = ["2026-10-22", "2026-10-23", "2026-10-24"].map((date) => coach({ ...base, date }).text);
    expect(new Set(days).size).toBe(3);
  });

  it("picks the mascot mood", () => {
    expect(mascot("morning", "pending", 300, 450, 20)).toBe("sleepy");
    expect(mascot("evening", "done", 450, 450, 30)).toBe("proud");
    expect(mascot("evening", "pending", 450, 450, 30)).toBe("tired");
    expect(mascot("day", "rest", 450, 450, 80)).toBe("chill");
    expect(mascot("day", "pending", 450, 450, 50)).toBe("pumped");
  });
});

describe("celebrations", () => {
  const gym = { label: "PUSH", rest_training: false } as GymResult;

  it("emits gym, goal, level and streak events only when newly reached", () => {
    const c = newCelebrations(
      { events: ["task:apple"], level: 7, streak: 6 },
      { events: ["task:apple", "gym_done", "perfect"], level: 8, streak: 7 },
      "2026-10-22", gym, 500, "2026-10-22T19:00:00+02:00",
    );
    expect(c.map((x) => x.id)).toEqual(["gym_done_2026-10-22", "perfect_2026-10-22", "level_8", "streak_7_2026-10-22"]);
    expect(c[0]).toMatchObject({ title: "PUSH DAY COMPLETE", sub: "+50 XP · streak 7" });
  });

  it("shows the highest-priority active one for 30 minutes", () => {
    const list = [
      { id: "a", title: "", sub: "", at: "2026-10-22T19:00:00+02:00", prio: 2 },
      { id: "b", title: "", sub: "", at: "2026-10-22T19:00:00+02:00", prio: 4 },
    ];
    expect(activeCelebration(list, new Date("2026-10-22T19:10:00+02:00"))?.id).toBe("b");
    expect(activeCelebration(list, new Date("2026-10-22T19:31:00+02:00"))).toBeNull();
  });
});
