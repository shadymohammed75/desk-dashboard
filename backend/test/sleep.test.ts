import { describe, expect, it } from "vitest";
import { average, computeSleep, stageOf } from "../src/logic/sleep";
import { localDate, mondayOf, offsetMinutes, toLocalIso, weekdayOf, zonedToUtc } from "../src/logic/time";
import { sample } from "./helpers";

const TZ = "Europe/Berlin";

describe("time helpers", () => {
  it("knows Berlin offsets on both sides of the DST change", () => {
    expect(offsetMinutes(new Date("2026-10-22T12:00:00Z"), TZ)).toBe(120);
    expect(offsetMinutes(new Date("2026-10-26T12:00:00Z"), TZ)).toBe(60);
    expect(toLocalIso(new Date("2026-10-22T16:10:00Z"), TZ)).toBe("2026-10-22T18:10:00+02:00");
    expect(zonedToUtc("2026-10-26", 9, 0, TZ).toISOString()).toBe("2026-10-26T08:00:00.000Z");
  });

  it("uses the local date, not UTC, near midnight", () => {
    expect(localDate(new Date("2026-10-21T22:30:00Z"), TZ)).toBe("2026-10-22");
  });

  it("finds weekdays and Mondays", () => {
    expect(weekdayOf("2026-10-22")).toBe("thu");
    expect(mondayOf("2026-10-22")).toBe("2026-10-19");
    expect(mondayOf("2026-10-19")).toBe("2026-10-19");
    expect(mondayOf("2026-10-25")).toBe("2026-10-19");
  });
});

describe("sleep", () => {
  it("maps Health labels to stages", () => {
    expect(stageOf("Core")).toBe("core");
    expect(stageOf("Asleep Core")).toBe("core");
    expect(stageOf("Asleep")).toBe("core");
    expect(stageOf("REM")).toBe("rem");
    expect(stageOf("Deep")).toBe("deep");
    expect(stageOf("Awake")).toBe("awake");
    expect(stageOf("In Bed")).toBeNull();
  });

  it("sums a night that crosses midnight", () => {
    const r = computeSleep([
      sample("2026-10-21T23:30", "2026-10-22T01:00", "Core"),
      sample("2026-10-22T01:00", "2026-10-22T02:00", "Deep"),
      sample("2026-10-22T02:00", "2026-10-22T02:10", "Awake"),
      sample("2026-10-22T02:10", "2026-10-22T06:40", "REM"),
    ], "2026-10-22", TZ)!;
    expect(r.asleep_min).toBe(90 + 60 + 270);
    expect(r.stages).toEqual({ deep: 60, core: 90, rem: 270, awake: 10 });
  });

  it("merges overlapping samples from watch and phone instead of double counting", () => {
    const r = computeSleep([
      sample("2026-10-21T23:00", "2026-10-22T03:00", "Asleep"),
      sample("2026-10-22T01:00", "2026-10-22T05:00", "Core"),
      sample("2026-10-22T04:30", "2026-10-22T06:00", "REM"),
      sample("2026-10-21T22:30", "2026-10-22T07:00", "In Bed"),
    ], "2026-10-22", TZ)!;
    expect(r.asleep_min).toBe(7 * 60); // 23:00 → 06:00
  });

  it("ignores naps from the previous afternoon and clips to the night window", () => {
    const r = computeSleep([
      sample("2026-10-21T13:00", "2026-10-21T14:00", "Core"),   // yesterday's nap: outside
      sample("2026-10-21T14:30", "2026-10-21T15:30", "Core"),   // half inside
      sample("2026-10-22T00:00", "2026-10-22T07:00", "Core"),
    ], "2026-10-22", TZ)!;
    expect(r.asleep_min).toBe(30 + 420);
  });

  it("returns null without any asleep samples", () => {
    expect(computeSleep([], "2026-10-22", TZ)).toBeNull();
    expect(computeSleep([sample("2026-10-21T23:00", "2026-10-22T07:00", "In Bed")], "2026-10-22", TZ)).toBeNull();
  });

  it("averages only days with data", () => {
    expect(average([400, null, 420, undefined])).toBe(410);
    expect(average([null, undefined])).toBeNull();
  });
});
