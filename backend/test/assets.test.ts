import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MUSCLES } from "../src/types";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("body map", () => {
  const svg = read("tools/body_map/body.svg");
  const map = JSON.parse(read("tools/body_map/muscle_map.json"));

  it("is the single source of truth: the app copy is identical", () => {
    expect(read("backend/public/app/body.svg")).toBe(svg);
  });

  it("lights every muscle id from at least one polygon on the right view", () => {
    const ids = new Set([...svg.matchAll(/data-ids="([^"]*)"/g)].flatMap((m) => m[1].split(" ").filter(Boolean)));
    for (const id of MUSCLES) expect(ids.has(id), id).toBe(true);
    for (const id of ids) expect((MUSCLES as readonly string[]).includes(id), `unknown id ${id}`).toBe(true);
  });

  it("maps only known muscle ids in muscle_map.json", () => {
    const flat = (v: unknown): string[] =>
      Array.isArray(v) ? (v as string[]) : Object.values(v as object).flatMap(flat);
    for (const view of ["front", "back"]) {
      for (const ids of Object.values(map[view])) {
        for (const id of flat(ids)) expect((MUSCLES as readonly string[]).includes(id), id).toBe(true);
      }
    }
  });
});

describe("mascot", () => {
  it("has an app sprite for every mood the API can return", () => {
    for (const mood of ["sleepy", "chill", "pumped", "proud", "tired"]) {
      const png = readFileSync(resolve(root, `backend/public/app/mascot/${mood}.png`));
      expect(png.subarray(1, 4).toString(), mood).toBe("PNG");
    }
  });
});
