// KV access and the write-side recompute. Keys:
//   day:YYYY-MM-DD   Health ingest + gym entry for that day
//   bp:recent        last 60 BP readings
//   config           schedule, splits, goals
//   meta:last_ingest ISO time of the last Health sync
//   meta:days        compact per-day summaries (streak, week strip, XP, sleep average)
//   meta:best_streak best streak ever
//   meta:celebrate   recent celebration events
import defaultConfig from "./config.default.json";
import type { BpReading, Celebration, Config, DayRecord, DaysIndex } from "./types";
import { summarizeDay } from "./logic/dashboard";
import { gymStatus } from "./logic/gym";
import { levelFor, longestStreak, newCelebrations, streak, totalXp, type ProgressSnapshot } from "./logic/motivation";
import { addDays, localDate, toLocalIso } from "./logic/time";

export interface KVLike {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
}

/** Days kept in meta:days; older days fold into archived_xp so lifetime XP is never lost. */
export const INDEX_KEEP_DAYS = 400;
const CELEBRATIONS_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

export class Store {
  constructor(private kv: KVLike) {}

  private async json<T>(key: string, fallback: T): Promise<T> {
    return ((await this.kv.get(key, "json")) as T | null) ?? fallback;
  }
  private put(key: string, value: unknown) {
    return this.kv.put(key, JSON.stringify(value));
  }

  config = () => this.json<Config>("config", structuredClone(defaultConfig) as Config);
  putConfig = (c: Config) => this.put("config", c);
  day = (date: string) => this.json<DayRecord>(`day:${date}`, {});
  putDay = (date: string, d: DayRecord) => this.put(`day:${date}`, d);
  bp = () => this.json<BpReading[]>("bp:recent", []);
  putBp = (list: BpReading[]) => this.put("bp:recent", list);
  index = () => this.json<DaysIndex>("meta:days", { archived_xp: 0, days: {} });
  lastIngest = () => this.json<string | null>("meta:last_ingest", null);
  putLastIngest = (iso: string) => this.put("meta:last_ingest", iso);
  bestStreak = () => this.json<number>("meta:best_streak", 0);
  celebrations = () => this.json<Celebration[]>("meta:celebrate", []);

  /**
   * Re-derive the summary for `date` after any write touching it, then update XP, best streak and
   * celebrations. Recomputing from the stored day (instead of incrementing) makes every write idempotent.
   */
  async recompute(date: string, now: Date): Promise<void> {
    const [config, day, bp, index, best, cels] = await Promise.all([
      this.config(), this.day(date), this.bp(), this.index(), this.bestStreak(), this.celebrations(),
    ]);
    const tz = config.timezone;
    const today = localDate(now, tz);
    const todayStatus = (idx: DaysIndex) =>
      idx.days[today]?.status ?? gymStatus(undefined, config, today).status;
    const snapshot = (idx: DaysIndex): ProgressSnapshot => ({
      events: idx.days[date]?.events ?? [],
      level: levelFor(totalXp(idx)).level,
      streak: streak(today, idx, config, todayStatus(idx)),
    });

    const before = snapshot(index);
    const next: DaysIndex = { archived_xp: index.archived_xp, days: { ...index.days } };
    next.days[date] = summarizeDay(day, date, config, bp);
    const cutoff = addDays(today, -INDEX_KEEP_DAYS);
    for (const d of Object.keys(next.days)) {
      if (d < cutoff) {
        next.archived_xp += next.days[d].points;
        delete next.days[d];
      }
    }
    const after = snapshot(next);
    const writes: Promise<void>[] = [this.put("meta:days", next)];
    // meta:best_streak is a floor that survives pruning of meta:days; the live value is derived on read.
    const longest = longestStreak(today, next, config, todayStatus(next));
    if (longest > best) writes.push(this.put("meta:best_streak", longest));

    if (date === today) {
      const gym = gymStatus(day, config, date);
      const fresh = newCelebrations(before, after, date, gym, levelFor(totalXp(next)).xp_next, toLocalIso(now, tz));
      const kept = cels.filter((c) => now.getTime() - Date.parse(c.at) < CELEBRATIONS_KEEP_MS);
      const added = fresh.filter((c) => !kept.some((k) => k.id === c.id));
      if (added.length || kept.length !== cels.length) writes.push(this.put("meta:celebrate", [...kept, ...added]));
    }
    await Promise.all(writes);
  }
}
