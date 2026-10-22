#!/usr/bin/env python3
"""Validate mock/*.json against the /api/dashboard contract (PLAN.md §4.2, §4.3b).

Usage: python3 mock/validate.py [files...]   (defaults to every mock/*.json)
Exits non-zero on the first file with problems.
"""
import json
import re
import sys
from pathlib import Path

MODES = {"morning", "day", "evening", "night"}
WEEK_STATES = {"done", "rest", "missed", "skipped", "today", "planned"}
TONES = {"hype", "nudge", "calm", "proud"}
MASCOTS = {"sleepy", "chill", "pumped", "proud", "tired"}
GYM_STATUS = {"pending", "done", "skipped", "rest"}
MUSCLES = {
    "chest", "front_delts", "side_delts", "biceps", "forearms", "abs", "obliques", "quads", "calves_front",
    "traps", "rear_delts", "upper_back", "lats", "triceps", "lower_back", "glutes", "hamstrings", "calves",
}
COLOR = re.compile(r"^#[0-9A-Fa-f]{6}$")
ICON = re.compile(r"^[a-z0-9_]{2,40}$")
TOP_KEYS = {"now", "updated", "stale", "mode", "sleep", "steps", "active", "food", "bp", "gym",
            "score", "progress", "week", "coach", "mascot", "celebrate"}


def is_num_or_null(v):
    return v is None or (isinstance(v, (int, float)) and not isinstance(v, bool))


def check(d):
    errs = []
    def need(cond, msg):
        if not cond:
            errs.append(msg)

    need(set(d) == TOP_KEYS, f"top-level keys differ: missing {TOP_KEYS - set(d)}, extra {set(d) - TOP_KEYS}")
    need(isinstance(d.get("now"), str), "now must be an ISO string")
    need(d.get("updated") is None or isinstance(d["updated"], str), "updated must be string or null")
    need(isinstance(d.get("stale"), bool), "stale must be bool")
    need(d.get("mode") in MODES, f"bad mode {d.get('mode')}")

    s = d.get("sleep") or {}
    for k in ("asleep_min", "avg7_min", "goal_min"):
        need(is_num_or_null(s.get(k)), f"sleep.{k} must be number/null")
    if s.get("stages") is not None:
        need(set(s["stages"]) == {"deep", "core", "rem", "awake"}, "sleep.stages keys")

    need(is_num_or_null((d.get("steps") or {}).get("value")), "steps.value")
    need(is_num_or_null((d.get("active") or {}).get("kcal")), "active.kcal")
    f = d.get("food") or {}
    for k in ("kcal", "kcal_goal", "protein_g", "protein_goal"):
        need(is_num_or_null(f.get(k)), f"food.{k}")

    bp = d.get("bp")
    if bp is not None:
        need(all(is_num_or_null(bp.get(k)) for k in ("sys", "dia", "pulse")), "bp numbers")
        need(all(isinstance(p, list) and len(p) == 2 for p in bp.get("trend7", [])), "bp.trend7 pairs")
        need(len(bp.get("trend7", [])) <= 7, "bp.trend7 has more than 7 days")

    g = d.get("gym") or {}
    need(g.get("status") in GYM_STATUS, f"bad gym.status {g.get('status')}")
    need(set(g.get("muscles", [])) <= MUSCLES, f"unknown muscles {set(g.get('muscles', [])) - MUSCLES}")
    if g.get("status") == "rest":
        need(g.get("muscles") == [], "rest day must have no muscles")
    if g.get("status") == "done":
        need(isinstance(g.get("done_min"), int), "done needs done_min")
    else:
        need(g.get("done_min") is None, "done_min only when done")

    need(isinstance(g.get("color"), str) and COLOR.match(g["color"]), "gym.color must be #RRGGBB")
    need(isinstance(g.get("icon"), str) and ICON.match(g["icon"]), "gym.icon must be a Material Symbols name")

    # score = share of today's habits done; perfect = all done (PLAN.md §4.3b)
    sc = d.get("score") or {}
    need(set(sc) == {"value", "done", "total", "perfect", "tasks"}, f"score keys differ: {set(sc)}")
    tasks = sc.get("tasks") or []
    need(all(set(t) == {"id", "label", "icon", "done", "auto"} for t in tasks), "score.tasks item keys")
    need(len({t.get("id") for t in tasks}) == len(tasks), "score.tasks ids must be unique")
    n_done = sum(bool(t.get("done")) for t in tasks)
    need(sc.get("done") == n_done and sc.get("total") == len(tasks), "score.done/total don't match tasks")
    need(sc.get("value") == (round(100 * n_done / len(tasks)) if tasks else 0), "score.value != round(100*done/total)")
    need(sc.get("perfect") == (len(tasks) > 0 and n_done == len(tasks)), "score.perfect must mean all habits done")
    gym_task = next((t for t in tasks if t.get("id") == "gym"), None)
    if gym_task:
        need(gym_task["done"] == (g.get("status") in ("done", "rest")), "gym habit must match gym.status")

    pr = d.get("progress") or {}
    need(pr.get("xp_next") == 100 + 50 * pr.get("level", 0), "xp_next != 100 + 50*level")
    need(0 <= pr.get("xp", -1) < pr.get("xp_next", 0), "xp out of range")
    need(pr.get("best_streak", 0) >= pr.get("streak_days", 0), "best_streak < streak_days")

    w = d.get("week") or []
    need(len(w) == 7, "week must have 7 days")
    need(all(x.get("state") in WEEK_STATES for x in w), "bad week state")
    need(all(COLOR.match(str(x.get("color"))) and ICON.match(str(x.get("icon"))) for x in w), "week items need color + icon")
    need(sum(x.get("state") == "today" for x in w) <= 1, "more than one 'today'")

    c = d.get("coach") or {}
    need(c.get("tone") in TONES, "bad coach.tone")
    need(isinstance(c.get("text"), str) and len(c["text"]) < 50, "coach.text must be < 50 chars")
    need(d.get("mascot") in MASCOTS, "bad mascot")

    cel = d.get("celebrate")
    if cel is not None:
        need(set(cel) == {"id", "title", "sub"}, "celebrate keys")
    return errs


def main(argv):
    files = [Path(p) for p in argv] or sorted(Path(__file__).parent.glob("*.json"))
    bad = 0
    for p in files:
        errs = check(json.loads(p.read_text()))
        print(f"{'FAIL' if errs else 'ok  '} {p.name}")
        for e in errs:
            print(f"     - {e}")
        bad += bool(errs)
    print(f"{len(files) - bad}/{len(files)} valid")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
