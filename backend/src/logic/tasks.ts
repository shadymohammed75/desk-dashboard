// Daily habits and the score (PLAN.md §4.3b): score = share of today's habits done; all done = perfect day.
import type { Config, DayRecord, GymResult, Score, TaskState } from "../types";

export interface TaskInputs {
  gym: GymResult;
  steps: number | null;
  /** null when there's no sleep data */
  asleepByGoal: boolean | null;
}

export function taskStates(config: Config, day: DayRecord | undefined, x: TaskInputs): TaskState[] {
  return config.tasks.map((t) => {
    let auto = false;
    if (t.auto === "gym") auto = x.gym.status === "done" || x.gym.status === "rest";
    if (t.auto === "steps") auto = x.steps != null && x.steps >= config.goals.steps;
    if (t.auto === "sleep_early") auto = x.asleepByGoal === true;
    const manual = day?.tasks?.[t.id] === true;
    return { id: t.id, label: t.label, icon: t.icon, done: auto || manual, auto: !!t.auto };
  });
}

export function scoreOf(tasks: TaskState[]): Score {
  const done = tasks.filter((t) => t.done).length;
  const total = tasks.length;
  return { value: total ? Math.round((100 * done) / total) : 0, done, total, perfect: total > 0 && done === total, tasks };
}
