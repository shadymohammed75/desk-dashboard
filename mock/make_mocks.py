#!/usr/bin/env python3
"""Generate mock/*.json: sample /api/dashboard responses for the app, the desk screen and the snapshot tool.

The score follows PLAN.md §4.3b: the share of today's habits done; all done = perfect day.
    python3 mock/make_mocks.py      then      python3 mock/validate.py
"""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent
GOALS = dict(steps=10000, active_kcal=600, kcal=2600, protein_g=160, sleep_min=450, gym_per_week=4)
TEAL, ORANGE, CYAN, VIOLET = "#2DD4BF", "#FF6A1A", "#22D3EE", "#8B7CFF"
SPLITS = {
    "push": ("PUSH", ORANGE, "fitness_center", ["chest", "front_delts", "side_delts", "triceps"]),
    "pull": ("PULL", CYAN, "rowing", ["lats", "upper_back", "traps", "rear_delts", "biceps", "forearms"]),
    "legs": ("LEGS", VIOLET, "directions_run", ["quads", "hamstrings", "glutes", "calves"]),
    "rest": ("REST DAY", TEAL, "hot_tub", []),
}
SCHEDULE = ["push", "pull", "rest", "push", "pull", "rest", "rest"]          # Mon..Sun
DAY_ICON = {2: "bedtime", 5: "bedtime", 6: "hot_tub"}                     # Wed, Sat, Sun
TASKS = [
    ("gym", "Train or rest as planned", "fitness_center", True),
    ("apple", "Eat one apple", "nutrition", False),
    ("no_sweets", "No sweets", "no_food", False),
    ("focus", "4h focus session", "timer", False),
    ("steps", "Steps goal", "directions_walk", True),
    ("morning", "Morning routine", "wb_sunny", False),
    ("night", "Night routine", "dark_mode", False),
    ("sleep_early", "Asleep by 23:00", "bedtime", True),
    ("read", "Read something", "menu_book", False),
]
PUSH = SPLITS["push"][3]


def score(done_ids):
    tasks = [{"id": i, "label": l, "icon": ic, "done": i in done_ids, "auto": a} for i, l, ic, a in TASKS]
    done = sum(t["done"] for t in tasks)
    return {"value": round(100 * done / len(tasks)), "done": done, "total": len(tasks), "perfect": done == len(tasks),
            "tasks": tasks}


def week(states, done_split=None):
    out = []
    for i, (d, st) in enumerate(zip("MTWTFSS", states)):
        split = SCHEDULE[i] if not (done_split and done_split[0] == i) else done_split[1]
        _, color, icon, _ = SPLITS[split]
        out.append({"d": d, "state": st, "color": color, "icon": DAY_ICON.get(i, icon) if split == "rest" else icon})
    return out


def gym(status, day_type="push", muscles=None, done_min=None, week_done=2, label=None, icon=None):
    lab, color, ic, m = SPLITS[day_type]
    return {"day_type": day_type, "label": label or lab, "color": color, "icon": icon or ic,
            "muscles": PUSH if muscles is None and day_type == "push" else (muscles if muscles is not None else m),
            "status": status, "done_min": done_min, "week_done": week_done, "week_target": GOALS["gym_per_week"]}


def dash(now, updated, mode, *, sleep, stages, avg7, steps, active, kcal, protein, bp, gym, done, progress, week,
         coach, mascot, celebrate=None, stale=False, vitals=(58, 72, 97)):
    return {
        "now": now, "updated": updated, "stale": stale, "mode": mode,
        "sleep": {"asleep_min": sleep, "avg7_min": avg7, "goal_min": GOALS["sleep_min"], "stages": stages},
        "steps": {"value": steps, "goal": GOALS["steps"]},
        "active": {"kcal": active, "goal": GOALS["active_kcal"]},
        "food": {"kcal": kcal, "kcal_goal": GOALS["kcal"], "protein_g": protein, "protein_goal": GOALS["protein_g"]},
        "bp": bp, "vitals": dict(zip(("resting_hr", "heart_rate", "spo2"), vitals)), "gym": gym, "score": score(done), "progress": progress, "week": week,
        "coach": coach, "mascot": mascot, "celebrate": celebrate,
    }


TREND = [[126, 80], [130, 84], [124, 79], [128, 82], [127, 81], [131, 83], [128, 82]]
BP = {"sys": 128, "dia": 82, "pulse": 64, "ts": "2026-10-22T08:10:00+02:00", "trend7": TREND}
STAGES = {"deep": 72, "core": 250, "rem": 95, "awake": 15}
THU = ["done", "done", "rest", "today", "planned", "rest", "rest"]
THU_DONE = ["done", "done", "rest", "done", "planned", "rest", "rest"]
PROG = {"level": 7, "xp": 340, "xp_next": 450, "streak_days": 12, "best_streak": 21}

m = {}
m["morning_short_sleep"] = dash(
    "2026-10-22T07:15:00+02:00", "2026-10-22T07:05:00+02:00", "morning",
    sleep=340, stages={"deep": 41, "core": 214, "rem": 58, "awake": 27}, avg7=405, steps=900, active=40,
    kcal=None, protein=None, bp=BP, gym=gym("pending"), done={"morning"}, progress=PROG, week=week(THU),
    coach={"text": "Short night. Train smart, not heavy.", "tone": "calm"}, mascot="sleepy", vitals=(63, 66, None))

m["push_pending_day"] = dash(
    "2026-10-22T13:30:00+02:00", "2026-10-22T13:12:00+02:00", "day",
    sleep=432, stages=STAGES, avg7=410, steps=5200, active=280, kcal=1100, protein=70, bp=BP, gym=gym("pending"),
    done={"apple", "morning", "sleep_early"}, progress={**PROG, "xp": 370}, week=week(THU),
    coach={"text": "PUSH day loaded. You know the drill.", "tone": "nudge"}, mascot="pumped")

m["push_pending_evening"] = dash(
    "2026-10-22T18:10:00+02:00", "2026-10-22T18:05:00+02:00", "evening",
    sleep=432, stages=STAGES, avg7=410, steps=8432, active=512, kcal=1850, protein=120, bp=BP, gym=gym("pending"),
    done={"apple", "no_sweets", "focus", "morning", "sleep_early"}, progress={**PROG, "xp": 390}, week=week(THU),
    coach={"text": "Still time. 45 minutes is enough.", "tone": "nudge"}, mascot="pumped")

m["push_done_celebrate"] = dash(
    "2026-10-22T19:40:00+02:00", "2026-10-22T19:35:00+02:00", "evening",
    sleep=432, stages=STAGES, avg7=410, steps=7800, active=480, kcal=1700, protein=110, bp=BP,
    gym=gym("done", muscles=["chest", "front_delts", "triceps"], done_min=55, week_done=3),
    done={"gym", "apple", "no_sweets", "focus", "morning", "sleep_early"},
    progress={"level": 7, "xp": 440, "xp_next": 450, "streak_days": 13, "best_streak": 21}, week=week(THU_DONE),
    coach={"text": "3 habits left. Finish strong.", "tone": "nudge"}, mascot="proud",
    celebrate={"id": "gym_done_2026-10-22", "title": "PUSH DAY COMPLETE", "sub": "+50 XP · streak 13"})

m["rest_day"] = dash(
    "2026-10-21T15:00:00+02:00", "2026-10-21T14:40:00+02:00", "day",
    sleep=465, stages={"deep": 80, "core": 268, "rem": 105, "awake": 12}, avg7=412, steps=6400, active=310,
    kcal=1600, protein=95,
    bp={**BP, "sys": 127, "dia": 81, "pulse": 62, "ts": "2026-10-21T08:05:00+02:00", "trend7": TREND[:6]},
    gym=gym("rest", "rest", icon="bedtime"), done={"gym", "apple", "morning", "sleep_early"},
    progress={"level": 7, "xp": 290, "xp_next": 450, "streak_days": 11, "best_streak": 21},
    week=week(["done", "done", "today", "planned", "planned", "rest", "rest"]),
    coach={"text": "Rest day. Muscles grow now.", "tone": "calm"}, mascot="chill")

m["perfect_day"] = dash(
    "2026-10-22T21:15:00+02:00", "2026-10-22T21:00:00+02:00", "evening",
    sleep=470, stages={"deep": 85, "core": 270, "rem": 104, "awake": 11}, avg7=430, steps=10450, active=560,
    kcal=1950, protein=136, bp=BP, gym=gym("done", muscles=PUSH, done_min=62, week_done=3),
    done={t[0] for t in TASKS}, progress={"level": 8, "xp": 80, "xp_next": 500, "streak_days": 13, "best_streak": 21},
    week=week(THU_DONE), coach={"text": "Perfect day. Every box ticked.", "tone": "proud"}, mascot="proud",
    celebrate={"id": "perfect_2026-10-22", "title": "PERFECT DAY", "sub": "+30 XP · every habit done"})

m["streak_milestone"] = dash(
    "2026-10-22T19:05:00+02:00", "2026-10-22T19:00:00+02:00", "evening",
    sleep=440, stages=STAGES, avg7=420, steps=8200, active=450, kcal=2000, protein=120, bp=BP,
    gym=gym("done", muscles=PUSH, done_min=58, week_done=3),
    done={"gym", "apple", "no_sweets", "focus", "morning", "night", "sleep_early", "read"},
    progress={"level": 9, "xp": 120, "xp_next": 550, "streak_days": 14, "best_streak": 21}, week=week(THU_DONE),
    coach={"text": "14 days straight. Don't break it.", "tone": "hype"}, mascot="proud",
    celebrate={"id": "streak_14_2026-10-22", "title": "STREAK 14", "sub": "14 planned days in a row"})

m["no_data"] = dash(
    "2026-10-22T10:30:00+02:00", None, "day",
    sleep=None, stages=None, avg7=None, steps=None, active=None, kcal=None, protein=None, bp=None,
    gym=gym("pending", week_done=0), done=set(),
    progress={"level": 1, "xp": 0, "xp_next": 150, "streak_days": 0, "best_streak": 0},
    week=week(["planned", "planned", "rest", "today", "planned", "rest", "rest"]),
    coach={"text": "PUSH day loaded. You know the drill.", "tone": "nudge"}, mascot="pumped", stale=True,
    vitals=(None, None, None))

m["stale"] = dash(
    "2026-10-22T16:20:00+02:00", "2026-10-22T11:55:00+02:00", "day",
    sleep=432, stages=STAGES, avg7=410, steps=3100, active=150, kcal=900, protein=55, bp=BP, gym=gym("pending"),
    done={"apple", "morning"}, progress={**PROG, "xp": 360}, week=week(THU),
    coach={"text": "PUSH day loaded. You know the drill.", "tone": "nudge"}, mascot="pumped", stale=True)

# Sunday spa day (also the day the clocks go back: +01:00 from 03:00)
m["spa_day"] = dash(
    "2026-10-25T11:00:00+01:00", "2026-10-25T10:40:00+01:00", "day",
    sleep=480, stages={"deep": 90, "core": 280, "rem": 100, "awake": 10}, avg7=440, steps=4200, active=210,
    kcal=1400, protein=90,
    bp={**BP, "sys": 124, "dia": 79, "pulse": 60, "ts": "2026-10-25T09:00:00+01:00", "trend7": TREND[2:]},
    gym=gym("rest", "rest", label="SPA DAY", icon="hot_tub", week_done=3),
    done={"gym", "apple", "morning", "sleep_early", "read"},
    progress={"level": 8, "xp": 190, "xp_next": 500, "streak_days": 16, "best_streak": 21},
    week=week(["done", "done", "rest", "done", "done", "rest", "today"]),
    coach={"text": "Rest day. Muscles grow now.", "tone": "calm"}, mascot="chill")

for name, d in m.items():
    (OUT / f"{name}.json").write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
    print(f"{name:22} score {d['score']['value']:3} ({d['score']['done']}/{d['score']['total']})")
