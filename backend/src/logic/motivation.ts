// Motivation engine (PLAN.md §4.3b). Every function here is pure.
import type {
  Celebration, Config, DaysIndex, GymResult, GymStatus, Mascot, Mode, Score, Tone, WeekState,
} from "../types";
import { dayStyle, isRestSplit, plannedSplit, splitInfo } from "./gym";
import { addDays, dayOfYear, mondayOf } from "./time";

// ---------------------------------------------------------------- metrics (shown, no longer scored directly)

export interface DayMetrics {
  asleep_min: number | null;
  steps: number | null;
  active_kcal: number | null;
  kcal: number | null;
  protein_g: number | null;
}

// ---------------------------------------------------------------- XP and levels

export const XP: Record<string, number> = {
  gym_done: 50, rest_training: 20, task: 10, bp: 10, perfect: 30,
};

/** XP events earned on one day. Recomputed from that day's data, so re-ingesting can never double them.
 *  Each done habit is "task:<id>" (+10), except the gym habit, which gym_done already rewards. */
export function xpEvents(gym: GymResult, score: Score, bpLogged: boolean): string[] {
  const e: string[] = [];
  if (gym.status === "done") e.push("gym_done");
  if (gym.status === "done" && gym.rest_training) e.push("rest_training");
  for (const t of score.tasks) if (t.done && t.id !== "gym") e.push(`task:${t.id}`);
  if (bpLogged) e.push("bp");
  if (score.perfect) e.push("perfect");
  return e;
}

export const pointsFor = (events: string[]) => events.reduce((a, e) => a + (XP[e.split(":")[0]] ?? 0), 0);

export const xpNext = (level: number) => 100 + 50 * level;

export function levelFor(totalXp: number): { level: number; xp: number; xp_next: number } {
  let level = 1;
  let xp = Math.max(0, totalXp);
  while (xp >= xpNext(level)) {
    xp -= xpNext(level);
    level++;
  }
  return { level, xp, xp_next: xpNext(level) };
}

export const totalXp = (index: DaysIndex) =>
  index.archived_xp + Object.values(index.days).reduce((a, d) => a + d.points, 0);

// ---------------------------------------------------------------- week strip and streak

export const firstTrackedDay = (index: DaysIndex): string | null => Object.keys(index.days).sort()[0] ?? null;

/** State of one day for the week strip. `todayGym` is today's live status. */
export function dayState(date: string, today: string, index: DaysIndex, config: Config, todayGym: GymStatus): WeekState {
  const rest = isRestSplit(config, plannedSplit(config, date));
  if (date > today) return rest ? "rest" : "planned";
  if (date === today) return todayGym === "done" ? "done" : todayGym === "skipped" ? "skipped" : "today";
  const s = index.days[date];
  if (s) {
    if (s.status === "done" || s.status === "skipped" || s.status === "rest") return s.status;
    return "missed";
  }
  const first = firstTrackedDay(index);
  if (!first || date < first) return rest ? "rest" : "planned"; // before tracking started
  return rest ? "rest" : "missed";
}

const LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

/** Week strip: state plus the colour/icon to draw (the split actually trained, else the day's planned style). */
export function week(today: string, index: DaysIndex, config: Config, todayGym: GymResult) {
  const mon = mondayOf(today);
  return LETTERS.map((d, i) => {
    const date = addDays(mon, i);
    const state = dayState(date, today, index, config, todayGym.status);
    const style = dayStyle(config, date);
    const trained = date === today ? (todayGym.status === "done" ? todayGym.day_type : null) : index.days[date]?.split;
    const sp = trained && trained !== style.split ? splitInfo(config, trained) : null;
    return { d, state, color: sp ? sp.color : style.color, icon: sp ? sp.icon : style.icon };
  });
}

export function weekDone(today: string, index: DaysIndex, todayGym: GymStatus): number {
  const mon = mondayOf(today);
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(mon, i);
    if (d > today) break;
    const status = d === today ? todayGym : index.days[d]?.status;
    if (status === "done") n++;
  }
  return n;
}

/**
 * Consecutive completed planned days. A gym day counts when done, a rest day counts automatically.
 * Today only adds once it's done (or a rest day); a pending today doesn't break the chain, a skip does.
 */
export function streak(today: string, index: DaysIndex, config: Config, todayGym: GymStatus): number {
  if (todayGym === "skipped") return 0;
  let n = todayGym === "done" || todayGym === "rest" ? 1 : 0;
  const first = firstTrackedDay(index);
  if (!first) return n;
  for (let d = addDays(today, -1); d >= first; d = addDays(d, -1)) {
    const s = dayState(d, today, index, config, todayGym);
    if (s === "done" || s === "rest") n++;
    else break;
  }
  return n;
}

/** Longest run in the tracked history (same rules as `streak`), so rest-day growth counts without a write. */
export function longestStreak(today: string, index: DaysIndex, config: Config, todayGym: GymStatus): number {
  const first = firstTrackedDay(index);
  if (!first) return streak(today, index, config, todayGym);
  let best = 0;
  let run = 0;
  for (let d = first; d <= today; d = addDays(d, 1)) {
    const s = dayState(d, today, index, config, todayGym);
    if (s === "done" || s === "rest") best = Math.max(best, ++run);
    else if (s !== "today") run = 0;
  }
  return best;
}

export const STREAK_MILESTONES = [7, 14, 30, 50, 100];

// ---------------------------------------------------------------- mode, coach, mascot

export function modeFor(hour: number): Mode {
  if (hour >= 5 && hour < 10) return "morning";
  if (hour >= 18 && hour < 23) return "evening";
  if (hour >= 23 || hour < 5) return "night";
  return "day";
}

export const SHORT_SLEEP_MARGIN_MIN = 45;

export interface CoachInput {
  date: string;
  mode: Mode;
  hour: number;
  gym: GymResult;
  asleep_min: number | null;
  protein_g: number | null;
  goals: Config["goals"];
  streak: number;
  score: Score;
}

// My own short phrases. {L} = split label (PUSH), {l} = title case (Push), {N} = streak, {G} = grams to go,
// {R} = habits left, {T} = habits total.
export const COACH_RULES: { id: string; tone: Tone; variants: string[] }[] = [
  { id: "milestone", tone: "hype", variants: [
    "{N} days straight. Don't break it.", "{N}-day streak. Keep the chain alive.", "Streak {N}. This is who you are now."] },
  { id: "perfect", tone: "proud", variants: [
    "Perfect day. Every box ticked.", "{T} for {T}. That's a perfect day.", "All habits done. Legendary."] },
  { id: "tasks_left", tone: "nudge", variants: [
    "{R} habits left. Finish strong.", "{R} to go for a perfect day.", "Close it out: {R} habits left."] },
  { id: "done", tone: "proud", variants: [
    "{l} day crushed. Recover well.", "{l} done. That's a win.", "Session banked. Eat, sleep, repeat."] },
  { id: "short_sleep", tone: "calm", variants: [
    "Short night. Train smart, not heavy.", "Low battery. Go easy, still show up.", "Sleep was short. Quality over load."] },
  { id: "rested", tone: "hype", variants: [
    "Fully charged. Make it count.", "Good sleep banked. Use it.", "Rested and ready. Let's go."] },
  { id: "pending_evening", tone: "nudge", variants: [
    "Still time. 45 minutes is enough.", "Evening slot open. {L} awaits.", "Short and sharp beats skipped."] },
  { id: "pending_day", tone: "nudge", variants: [
    "{L} day loaded. You know the drill.", "{L} day. One session at a time.", "{L} is on the plan. Get it done."] },
  { id: "protein", tone: "nudge", variants: [
    "{G} g protein to go. Easy win.", "Protein gap: {G} g. Grab a shake.", "{G} g protein left. You've got this."] },
  { id: "rest", tone: "calm", variants: [
    "Rest day. Muscles grow now.", "Recovery is training too.", "Easy day. Walk, stretch, refuel."] },
  { id: "skipped", tone: "calm", variants: [
    "Skipped today. Tomorrow's a new rep.", "Rest taken. Back at it next time.", "No guilt. Reset and go again."] },
];

/** The first matching rule wins (order of COACH_RULES); the variant rotates daily. */
export function coachRule(c: CoachInput): string {
  const today = c.gym.status;
  const counted = today === "done" || today === "rest";
  const left = c.score.total - c.score.done;
  if (counted && STREAK_MILESTONES.includes(c.streak)) return "milestone";
  if (c.score.perfect) return "perfect";
  if (c.mode === "morning" && c.asleep_min != null && today !== "done") {
    if (c.asleep_min < c.goals.sleep_min - SHORT_SLEEP_MARGIN_MIN) return "short_sleep";
    if (c.asleep_min >= c.goals.sleep_min) return "rested";
  }
  if (today === "pending") return c.mode === "evening" || c.mode === "night" ? "pending_evening" : "pending_day";
  if (c.hour >= 17 && left > 0 && left <= 4) return "tasks_left";
  if (today === "done") return "done";
  if (c.hour >= 18 && c.protein_g != null && c.protein_g < c.goals.protein_g) return "protein";
  return today === "rest" ? "rest" : "skipped";
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export function coach(c: CoachInput): { text: string; tone: Tone } {
  const rule = COACH_RULES.find((r) => r.id === coachRule(c))!;
  const tpl = rule.variants[dayOfYear(c.date) % rule.variants.length];
  const text = tpl
    .replace("{L}", c.gym.label)
    .replace("{l}", titleCase(c.gym.label))
    .replace("{N}", String(c.streak))
    .replace("{G}", String(Math.max(0, Math.round(c.goals.protein_g - (c.protein_g ?? 0)))))
    .replace("{R}", String(c.score.total - c.score.done))
    .replaceAll("{T}", String(c.score.total));
  return { text, tone: rule.tone };
}

export function mascot(mode: Mode, gym: GymStatus, asleep: number | null, sleepGoal: number, scoreValue: number,
                       perfect = false): Mascot {
  if (perfect) return "proud";
  if (mode === "morning" && asleep != null && asleep < sleepGoal - SHORT_SLEEP_MARGIN_MIN) return "sleepy";
  if (gym === "done") return "proud";
  if (mode === "evening" && scoreValue < 40) return "tired";
  if (gym === "rest" || gym === "skipped") return "chill";
  return "pumped";
}

// ---------------------------------------------------------------- celebrations

export const CELEBRATE_ACTIVE_MS = 30 * 60 * 1000;

export interface ProgressSnapshot {
  events: string[];
  level: number;
  streak: number;
}

/** New celebrations caused by a change on `date` (only ever called for today). */
export function newCelebrations(
  before: ProgressSnapshot, after: ProgressSnapshot, date: string, gym: GymResult, xpNextLevel: number, at: string,
): Celebration[] {
  const out: Celebration[] = [];
  const gained = (e: string) => after.events.includes(e) && !before.events.includes(e);
  if (gained("gym_done")) {
    out.push({
      id: `gym_done_${date}`, prio: 2, at,
      title: gym.rest_training ? "BONUS SESSION DONE" : `${gym.label} DAY COMPLETE`,
      sub: `+${gym.rest_training ? XP.gym_done + XP.rest_training : XP.gym_done} XP · streak ${after.streak}`,
    });
  }
  if (gained("perfect")) {
    out.push({ id: `perfect_${date}`, prio: 3, at, title: "PERFECT DAY", sub: `+${XP.perfect} XP \u00b7 every habit done` });
  }
  if (after.level > before.level) {
    out.push({ id: `level_${after.level}`, prio: 4, at, title: `LEVEL UP · ${after.level}`, sub: `Next level at ${xpNextLevel} XP` });
  }
  for (const m of STREAK_MILESTONES) {
    if (after.streak >= m && before.streak < m) {
      out.push({ id: `streak_${m}_${date}`, prio: 3, at, title: `STREAK ${m}`, sub: `${m} planned days in a row` });
    }
  }
  return out;
}

/** The celebration to show now: highest priority among the active ones, newest first on ties. */
export function activeCelebration(list: Celebration[], now: Date): Celebration | null {
  const live = list.filter((c) => now.getTime() - Date.parse(c.at) < CELEBRATE_ACTIVE_MS && Date.parse(c.at) <= now.getTime());
  live.sort((a, b) => b.prio - a.prio || Date.parse(b.at) - Date.parse(a.at));
  return live[0] ?? null;
}
