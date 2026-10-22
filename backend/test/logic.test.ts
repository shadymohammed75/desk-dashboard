import { describe, expect, it } from "vitest";
import { gymStatus } from "../src/logic/gym";
import {
  COACH_RULES, activeCelebration, coach, coachRule, levelFor, mascot, modeFor, newCelebrations, score, streak,
  week, xpEvents, type CoachInput,
} from "../src/logic/motivation";
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

describe("score (§4.3b)", () => {
  const g = config().goals;

  it("leaves parts with no data null and counts them as 0", () => {
    const s = score({ asleep_min: null, steps: null, active_kcal: null, kcal: null, protein_g: null }, g, "pending");
    expect(s).toEqual({ value: 0, parts: { sleep: null, move: null, food: null, gym: 0 } });
  });

  it("computes each part", () => {
    const s = score({ asleep_min: 450, steps: 5000, active_kcal: 600, kcal: 1950, protein_g: 160 }, g, "done");
    // move: (0.5 + 1) / 2 = .75 → 19 ; food: (1 + (1 - 650/2600)) / 2 = .875 → 22
    expect(s.parts).toEqual({ sleep: 25, move: 19, food: 22, gym: 25 });
    expect(s.value).toBe(91);
  });

  it("treats a rest day as full gym points and skip as zero", () => {
    const m = { asleep_min: null, steps: null, active_kcal: null, kcal: null, protein_g: null };
    expect(score(m, g, "rest").parts.gym).toBe(25);
    expect(score(m, g, "skipped").parts.gym).toBe(0);
  });

  it("floors kcal closeness at 0 and caps everything at 25", () => {
    const s = score({ asleep_min: 900, steps: 50000, active_kcal: 5000, kcal: 9000, protein_g: 400 }, g, "done");
    expect(s.parts).toEqual({ sleep: 25, move: 25, food: 13, gym: 25 });
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
    const g = config().goals;
    const gym = { status: "done", rest_training: true } as GymResult;
    const m = { asleep_min: null, steps: null, active_kcal: null, kcal: null, protein_g: null };
    expect(xpEvents(m, g, gym, false, 0)).toEqual(["gym_done", "rest_training"]);
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
    expect(week("2026-10-22", i, cfg, "pending").map((d) => d.state))
      .toEqual(["done", "missed", "rest", "today", "planned", "rest", "rest"]);
  });
});

describe("mode, coach and mascot", () => {
  const g = config().goals;
  const gym = (status: GymResult["status"]): GymResult =>
    ({ day_type: "push", label: "PUSH", muscles: [], status, done_min: null, source: "plan", rest_training: false });
  const base: CoachInput = { date: "2026-10-22", mode: "day", hour: 13, gym: gym("pending"), asleep_min: 430,
    protein_g: 100, goals: g, streak: 3 };

  it("maps hours to modes", () => {
    expect([4, 5, 9, 10, 17, 18, 22, 23].map(modeFor))
      .toEqual(["night", "morning", "morning", "day", "day", "evening", "evening", "night"]);
  });

  it("applies rule priority", () => {
    expect(coachRule({ ...base, gym: gym("done"), streak: 7 })).toBe("milestone");
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
        const text = v.replace("{L}", "ABCDEFGHIJKL").replace("{l}", "Abcdefghijkl").replace("{N}", "100").replace("{G}", "1000");
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
      { events: ["steps"], level: 7, streak: 6 },
      { events: ["steps", "gym_done", "protein"], level: 8, streak: 7 },
      "2026-10-22", gym, 500, "2026-10-22T19:00:00+02:00",
    );
    expect(c.map((x) => x.id)).toEqual(["gym_done_2026-10-22", "goal_protein_2026-10-22", "level_8", "streak_7_2026-10-22"]);
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
