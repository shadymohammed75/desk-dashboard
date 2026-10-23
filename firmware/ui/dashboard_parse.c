/* /api/dashboard → DashboardData, with cJSON (bundled with ESP-IDF/Arduino-ESP32; fetched by the snapshot tool). */
#include "dashboard_data.h"

#include <stdlib.h>
#include <string.h>

#include "cJSON.h"

static const cJSON *get(const cJSON *o, const char *k)
{
    return o ? cJSON_GetObjectItemCaseSensitive(o, k) : NULL;
}

static int32_t num(const cJSON *o, const char *k)
{
    const cJSON *v = get(o, k);
    return cJSON_IsNumber(v) ? (int32_t)(v->valuedouble + (v->valuedouble >= 0 ? 0.5 : -0.5)) : DD_NONE;
}

static void str(const cJSON *o, const char *k, char *dst, size_t n)
{
    const cJSON *v = get(o, k);
    dst[0] = '\0';
    if(cJSON_IsString(v) && v->valuestring) {
        strncpy(dst, v->valuestring, n - 1);
        dst[n - 1] = '\0';
    }
}

/* "#RRGGBB" → 0xRRGGBB; `fallback` when missing or malformed. */
static uint32_t color(const cJSON *o, const char *k, uint32_t fallback)
{
    const cJSON *v = get(o, k);
    if(!cJSON_IsString(v) || strlen(v->valuestring) != 7 || v->valuestring[0] != '#') return fallback;
    char *end;
    unsigned long c = strtoul(v->valuestring + 1, &end, 16);
    return *end ? fallback : (uint32_t)c;
}

static bool is(const cJSON *o, const char *k, const char *val)
{
    const cJSON *v = get(o, k);
    return cJSON_IsString(v) && strcmp(v->valuestring, val) == 0;
}

/* "HH:MM" → minutes after midnight; `fallback` when missing or malformed. */
static int16_t hhmm(const cJSON *o, const char *k, int16_t fallback)
{
    const cJSON *v = get(o, k);
    const char *s = cJSON_IsString(v) ? v->valuestring : NULL;
    if(!s || strlen(s) != 5 || s[2] != ':') return fallback;
    int h = (s[0] - '0') * 10 + (s[1] - '0'), m = (s[3] - '0') * 10 + (s[4] - '0');
    return (h >= 0 && h < 24 && m >= 0 && m < 60) ? (int16_t)(h * 60 + m) : fallback;
}

bool dd_in_window(int minute, int from, int to)
{
    return from <= to ? (minute >= from && minute < to) : (minute >= from || minute < to);
}

bool dashboard_parse(const char *json, DashboardData *d)
{
    memset(d, 0, sizeof(*d));
    cJSON *root = cJSON_Parse(json);
    if(!cJSON_IsObject(root)) {
        cJSON_Delete(root);
        return false;
    }

    str(root, "now", d->now, sizeof d->now);
    str(root, "updated", d->updated, sizeof d->updated);
    d->stale = cJSON_IsTrue(get(root, "stale"));
    d->mode = is(root, "mode", "morning") ? DD_MODE_MORNING : is(root, "mode", "evening") ? DD_MODE_EVENING
              : is(root, "mode", "night") ? DD_MODE_NIGHT : DD_MODE_DAY;

    const cJSON *sl = get(root, "sleep");
    d->sleep_min = num(sl, "asleep_min");
    d->sleep_avg7 = num(sl, "avg7_min");
    d->sleep_goal = num(sl, "goal_min");
    const cJSON *st = get(sl, "stages");
    d->has_stages = cJSON_IsObject(st);
    d->deep = num(st, "deep");
    d->core = num(st, "core");
    d->rem = num(st, "rem");
    d->awake = num(st, "awake");

    d->steps = num(get(root, "steps"), "value");
    d->steps_goal = num(get(root, "steps"), "goal");
    d->active = num(get(root, "active"), "kcal");
    d->active_goal = num(get(root, "active"), "goal");
    const cJSON *f = get(root, "food");
    d->kcal = num(f, "kcal");
    d->kcal_goal = num(f, "kcal_goal");
    d->protein = num(f, "protein_g");
    d->protein_goal = num(f, "protein_goal");

    const cJSON *bp = get(root, "bp");
    d->has_bp = cJSON_IsObject(bp);
    d->bp_sys = num(bp, "sys");
    d->bp_dia = num(bp, "dia");
    d->bp_pulse = num(bp, "pulse");
    str(bp, "ts", d->bp_ts, sizeof d->bp_ts);

    const cJSON *vit = get(root, "vitals");
    d->resting_hr = num(vit, "resting_hr");
    d->heart_rate = num(vit, "heart_rate");
    d->spo2 = num(vit, "spo2");

    const cJSON *g = get(root, "gym");
    str(g, "day_type", d->day_type, sizeof d->day_type);
    str(g, "label", d->label, sizeof d->label);
    d->color = color(g, "color", 0xFF6A1A);
    str(g, "icon", d->icon, sizeof d->icon);
    const cJSON *m;
    cJSON_ArrayForEach(m, get(g, "muscles")) {
        if(d->muscles_n >= DD_MAX_MUSCLES || !cJSON_IsString(m)) continue;
        strncpy(d->muscles[d->muscles_n], m->valuestring, sizeof d->muscles[0] - 1);
        d->muscles_n++;
    }
    d->gym = is(g, "status", "done") ? DD_GYM_DONE : is(g, "status", "skipped") ? DD_GYM_SKIPPED
             : is(g, "status", "rest") ? DD_GYM_REST : DD_GYM_PENDING;
    d->done_min = num(g, "done_min");
    d->week_done = num(g, "week_done");
    d->week_target = num(g, "week_target");

    const cJSON *sc = get(root, "score");
    d->score = num(sc, "value");
    d->perfect = cJSON_IsTrue(get(sc, "perfect"));
    const cJSON *t;
    cJSON_ArrayForEach(t, get(sc, "tasks")) {
        if(d->tasks_total >= DD_MAX_TASKS) break;
        bool done = cJSON_IsTrue(get(t, "done"));
        d->task_done[d->tasks_total++] = done;
        d->tasks_done += done;
    }

    const cJSON *p = get(root, "progress");
    d->level = num(p, "level");
    d->xp = num(p, "xp");
    d->xp_next = num(p, "xp_next");
    d->streak = num(p, "streak_days");
    d->best_streak = num(p, "best_streak");

    int i = 0;
    const cJSON *w;
    cJSON_ArrayForEach(w, get(root, "week")) {
        if(i >= 7) break;
        str(w, "d", d->week_d[i], sizeof d->week_d[i]);
        d->week_color[i] = color(w, "color", 0xFF6A1A);
        str(w, "icon", d->week_icon[i], sizeof d->week_icon[i]);
        d->week[i] = is(w, "state", "done") ? DD_WEEK_DONE : is(w, "state", "rest") ? DD_WEEK_REST
                     : is(w, "state", "missed") ? DD_WEEK_MISSED : is(w, "state", "skipped") ? DD_WEEK_SKIPPED
                     : is(w, "state", "today") ? DD_WEEK_TODAY : DD_WEEK_PLANNED;
        i++;
    }

    const cJSON *c = get(root, "coach");
    str(c, "text", d->coach, sizeof d->coach);
    d->tone = is(c, "tone", "hype") ? DD_TONE_HYPE : is(c, "tone", "calm") ? DD_TONE_CALM
              : is(c, "tone", "proud") ? DD_TONE_PROUD : DD_TONE_NUDGE;
    str(root, "mascot", d->mascot, sizeof d->mascot);

    const cJSON *cel = get(root, "celebrate");
    d->has_celebrate = cJSON_IsObject(cel);
    str(cel, "id", d->cel_id, sizeof d->cel_id);
    str(cel, "title", d->cel_title, sizeof d->cel_title);
    str(cel, "sub", d->cel_sub, sizeof d->cel_sub);

    const cJSON *night = get(root, "night");
    d->night_from = hhmm(night, "from", 0);
    d->night_to = hhmm(night, "to", 8 * 60);

    cJSON_Delete(root);
    return true;
}
