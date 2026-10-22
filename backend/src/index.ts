// Cloudflare Worker: routing + auth. Static pages (/app, /flash) are served from public/ by Workers Static Assets.
// Only functions may be exported from this entry module (the Workers runtime rejects other exports).
import { buildDashboard, type State } from "./logic/dashboard";
import { addReading, latest } from "./logic/bp";
import { dayStyle, gymStatus, plannedSplit, splitInfo } from "./logic/gym";
import { dayScore } from "./logic/dashboard";
import { firstTrackedDay } from "./logic/motivation";
import { computeSleep } from "./logic/sleep";
import { addDays, localDate, toLocalIso, weekdayOf } from "./logic/time";
import { Store, type KVLike } from "./store";
import { HttpError, parseBp, parseConfig, parseGym, parseIngest, parseTask } from "./validate";

export interface Env {
  DASH: KVLike;
  ASSETS?: { fetch(req: Request): Promise<Response> };
  /** Workers Rate Limiting binding; throttles repeated wrong-token attempts per IP. */
  AUTH_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  INGEST_TOKEN?: string;
  DEVICE_TOKEN?: string;
}

const MAX_BODY_BYTES = 1024 * 1024;
/** Tokens shorter than this are refused outright, so a weak secret can't be brute-forced. */
const MIN_TOKEN_LENGTH = 24;
const GYM_BACKFILL_DAYS = 7;

const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-frame-options": "DENY",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json; charset=utf-8", ...SECURITY_HEADERS },
  });
}

/** Constant-time string comparison, so response timing can't leak how much of a token matched. */
function sameToken(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function requireToken(req: Request, env: Env, expected: string | undefined, name: string): Promise<void> {
  if (!expected) throw new HttpError(503, `${name} is not configured on the server`);
  if (expected.length < MIN_TOKEN_LENGTH) {
    throw new HttpError(503, `${name} is too short (minimum ${MIN_TOKEN_LENGTH} characters)`);
  }
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (m && sameToken(m[1].trim(), expected)) return;
  // Only failed attempts count against the limit, so normal use is never throttled.
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  if (env.AUTH_LIMITER && !(await env.AUTH_LIMITER.limit({ key: `auth:${ip}` })).success) {
    throw new HttpError(429, "too many failed attempts, try again in a minute");
  }
  throw new HttpError(401, "missing or invalid token");
}

async function readJson(req: Request): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_BODY_BYTES) throw new HttpError(413, "body too large");
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, "body too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "body is not valid JSON");
  }
}

async function loadState(store: Store, now: Date): Promise<State> {
  const config = await store.config();
  const today = localDate(now, config.timezone);
  const [day, bp, index, lastIngest, bestStreak, celebrations] = await Promise.all([
    store.day(today), store.bp(), store.index(), store.lastIngest(), store.bestStreak(), store.celebrations(),
  ]);
  return { now, config, day, bp, index, lastIngest, bestStreak, celebrations };
}

/** GET /api/today — what the phone app needs for its Today tab. */
async function todayView(store: Store, now: Date) {
  const s = await loadState(store, now);
  const date = localDate(now, s.config.timezone);
  const planKey = plannedSplit(s.config, date);
  return {
    date,
    plan: { ...splitInfo(s.config, planKey), ...dayStyle(s.config, date) },
    entry: s.day?.gym ?? null,
    bp_latest: latest(s.bp),
    dashboard: buildDashboard(s),
  };
}

async function historyView(store: Store, now: Date, days: number) {
  const [config, bp, index] = await Promise.all([store.config(), store.bp(), store.index()]);
  const tz = config.timezone;
  const today = localDate(now, tz);
  const first = firstTrackedDay(index);
  // A planned day nobody logged is "missed" only once tracking had started; before that there's just no data.
  const pastStatus = (date: string) => (first && date >= first ? "missed" : "no_data");
  const dates = Array.from({ length: days }, (_, i) => addDays(today, -i));
  const records = await Promise.all(dates.map((d) => store.day(d)));
  return {
    days: dates.map((date, i) => {
      const day = records[i];
      const gym = gymStatus(day, config, date);
      const planKey = plannedSplit(config, date);
      return {
        date,
        weekday: weekdayOf(date),
        plan: planKey,
        plan_label: dayStyle(config, date).label,
        split: gym.day_type,
        label: gym.label,
        color: gym.color,
        icon: gym.icon,
        score: dayScore(day, date, config, gym).value,
        status: gym.status === "pending" && date < today ? pastStatus(date) : gym.status,
        source: gym.source,
        muscles: gym.status === "done" ? gym.muscles : [],
        duration_min: gym.done_min,
        note: day.gym?.note ?? null,
        bp: bp.filter((r) => localDate(new Date(r.ts), tz) === date)
          .map((r) => ({ ...r, ts: toLocalIso(new Date(r.ts), tz) })),
      };
    }),
  };
}

export async function handle(req: Request, env: Env, now: Date): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method;

  if (!path.startsWith("/api/") && path !== "/api") {
    if (path === "/") return Response.redirect(new URL("/app/", url).toString(), 302);
    return env.ASSETS ? env.ASSETS.fetch(req) : new Response("Not found", { status: 404 });
  }

  const store = new Store(env.DASH);
  const route = `${method} ${path}`;
  const app = () => requireToken(req, env, env.INGEST_TOKEN, "INGEST_TOKEN");

  switch (route) {
    case "GET /api/health":
      return json({ ok: true });

    case "GET /api/dashboard": {
      await requireToken(req, env, env.DEVICE_TOKEN, "DEVICE_TOKEN");
      return json(buildDashboard(await loadState(store, now)));
    }

    case "POST /api/ingest": {
      await app();
      const { date, ingest } = parseIngest(await readJson(req), now.toISOString());
      const day = await store.day(date);
      await store.putDay(date, { ...day, ingest });
      await store.putLastIngest(now.toISOString());
      await store.recompute(date, now);
      return json({ ok: true, date });
    }

    case "POST /api/gym": {
      await app();
      const config = await store.config();
      const action = parseGym(await readJson(req), config, now.toISOString());
      const today = localDate(now, config.timezone);
      const date = action.date ?? today;
      if (date > today || date < addDays(today, -GYM_BACKFILL_DAYS)) {
        throw new HttpError(400, `date must be within the last ${GYM_BACKFILL_DAYS} days`);
      }
      const day = await store.day(date);
      if (action.action === "undo") delete day.gym;
      else day.gym = action.entry;
      await store.putDay(date, day);
      await store.recompute(date, now);
      return json(await todayView(store, now));
    }

    case "POST /api/bp": {
      await app();
      const reading = parseBp(await readJson(req), now);
      const [config, list] = await Promise.all([store.config(), store.bp()]);
      await store.putBp(addReading(list, reading));
      await store.recompute(localDate(new Date(reading.ts), config.timezone), now);
      return json(await todayView(store, now));
    }

    case "POST /api/tasks": {
      await app();
      const config = await store.config();
      const t = parseTask(await readJson(req), config);
      const today = localDate(now, config.timezone);
      const date = t.date ?? today;
      if (date > today || date < addDays(today, -GYM_BACKFILL_DAYS)) {
        throw new HttpError(400, `date must be within the last ${GYM_BACKFILL_DAYS} days`);
      }
      const day = await store.day(date);
      day.tasks = { ...day.tasks, [t.id]: t.done };
      await store.putDay(date, day);
      await store.recompute(date, now);
      return json(await todayView(store, now));
    }

    case "GET /api/config":
      await app();
      return json(await store.config());

    case "PUT /api/config": {
      await app();
      const config = parseConfig(await readJson(req), await store.config());
      await store.putConfig(config);
      await store.recompute(localDate(now, config.timezone), now);
      return json(config);
    }

    case "GET /api/debug/last-ingest": {
      // What the last Health sync actually delivered, to debug the iOS Shortcut without reading KV by hand.
      await app();
      const [config, last] = await Promise.all([store.config(), store.lastIngest()]);
      const tz = config.timezone;
      const date = last ? localDate(new Date(last), tz) : null;
      const ing = date ? (await store.day(date)).ingest : undefined;
      if (!ing || !date) return json({ last_ingest: last, ingest: null });
      const samples = ing.sleep_samples;
      return json({
        last_ingest: toLocalIso(new Date(ing.received_at), tz),
        date,
        sent_at: ing.sent_at,
        steps: ing.steps,
        active_kcal: ing.active_kcal,
        nutrition: ing.nutrition,
        sleep: {
          samples: samples.length,
          values: [...new Set(samples.map((x) => x.value))],
          first_start: samples[0]?.start ?? null,
          last_end: samples[samples.length - 1]?.end ?? null,
          asleep_min: computeSleep(samples, date, tz)?.asleep_min ?? null,
        },
        workouts: ing.workouts,
        vitals: ing.vitals ?? null,
      });
    }

    case "GET /api/today":
      await app();
      return json(await todayView(store, now));

    case "GET /api/history": {
      await app();
      const raw = url.searchParams.get("days") ?? "14";
      const days = Number(raw);
      if (!Number.isInteger(days) || days < 1 || days > 60) throw new HttpError(400, "days must be an integer from 1 to 60");
      return json(await historyView(store, now, days));
    }
  }

  const known = ["/api/health", "/api/dashboard", "/api/ingest", "/api/gym", "/api/bp", "/api/tasks", "/api/config", "/api/today",
    "/api/history", "/api/debug/last-ingest"];
  if (known.includes(path)) throw new HttpError(405, `${method} is not allowed on ${path}`);
  throw new HttpError(404, `no route for ${path}`);
}

/** `handle` plus error mapping; `now` is injectable for tests. */
export async function respond(req: Request, env: Env, now = new Date()): Promise<Response> {
  try {
    return await handle(req, env, now);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error("unhandled error", e);
    return json({ error: "internal error" }, 500);
  }
}

export default {
  fetch: (req: Request, env: Env) => respond(req, env),
};
