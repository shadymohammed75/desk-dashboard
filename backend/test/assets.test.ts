import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MUSCLES } from "../src/types";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("body map", () => {
  const svg = read("tools/body_map/body.svg");

  it("is the single source of truth: the app copy is identical", () => {
    expect(read("backend/public/app/body.svg")).toBe(svg);
  });

  it("has one path per muscle id plus both silhouettes", () => {
    for (const id of [...MUSCLES, "silhouette_front", "silhouette_back"]) {
      expect(svg.match(new RegExp(`<path id="${id}"`, "g")), id).toHaveLength(1);
    }
  });
});
