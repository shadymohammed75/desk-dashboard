import defaultConfig from "../src/config.default.json";
import { respond, type Env } from "../src/index";
import type { KVLike } from "../src/store";
import type { Config, SleepSample } from "../src/types";

export const INGEST = "test-ingest-token-0123456789abcdef";
export const DEVICE = "test-device-token-0123456789abcdef";

export function memKV(): KVLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async get(key) {
      const v = data.get(key);
      return v === undefined ? null : JSON.parse(v);
    },
    async put(key, value) {
      data.set(key, value);
    },
  };
}

export const config = (): Config => structuredClone(defaultConfig) as Config;

/** Berlin wall-clock time in late October 2026 (UTC+2 until the 25th). */
export const berlin = (s: string) => new Date(`${s}:00+02:00`);

export const sample = (start: string, end: string, value: string): SleepSample => ({
  start: `${start}:00+02:00`, end: `${end}:00+02:00`, value,
});

/** A small in-memory Worker for API tests. */
export function makeApi() {
  const kv = memKV();
  const env: Env = { DASH: kv, INGEST_TOKEN: INGEST, DEVICE_TOKEN: DEVICE };
  async function call(method: string, path: string, opts: { body?: unknown; token?: string | null; now: Date }) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const token = opts.token === undefined ? (path === "/api/dashboard" ? DEVICE : INGEST) : opts.token;
    if (token) headers.authorization = `Bearer ${token}`;
    const req = new Request(`https://dash.example${path}`, {
      method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const res = await respond(req, env, opts.now);
    return { status: res.status, body: (await res.json()) as any };
  }
  return { kv, env, call };
}
