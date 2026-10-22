/* Desk screen "Training HUD" (PLAN.md §5.1), 800×480, non-touch. Pure LVGL 9.
 *
 * Layout: HUD bar (48) · left column (500: score ring, stat rows, BP card, week card)
 *         · right column (300: today title, body map, muscle names, status pill) · coach bar (40).
 * Looping animations are limited to two at a time (breathing muscles + pulsing today dot, or the
 * evening pill pulse instead of the dot). Everything else animates only when data changes. */
#include "ui.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "theme.h"
#include "fonts/fonts.h"
#include "assets/body_assets.h"
#include "assets/hud_assets.h"
#include "assets/mascot_assets.h"
#include "ui_internal.h"

/* ------------------------------------------------------------------ state */

typedef struct {
    lv_obj_t *root, *icon, *label, *trophy, *pct, *pct_check, *value, *unit, *sub, *hl;
    lv_obj_t *blocks[10];
    lv_obj_t *stages[4];
    lv_color_t color;
} stat_row_t;

typedef struct {
    lv_obj_t *base[BODY_MAX_PARTS];       /* untrained muscle; indexed like body_parts[] */
    lv_obj_t *glow[BODY_MAX_PARTS];       /* coloured overlays (in the reveal box) */
    lv_obj_t *fill[BODY_MAX_PARTS];
    lv_obj_t *reveal, *content;           /* reveal clips content for the bottom-to-top sweep */
    lv_obj_t *sil_fill, *sil_line;
} figure_t;

static struct {
    lv_obj_t *scr, *main, *night;
    /* hud */
    lv_obj_t *clock, *mascot, *lv, *xp_text, *xp_bar, *xp_fill, *flame, *streak, *live_dot, *live_text;
    /* score */
    lv_obj_t *ring_glow, *arcs[DD_MAX_TASKS], *score, *score_label, *perfect;
    int32_t shown_score;
    /* stats */
    stat_row_t rows[3];
    /* bp */
    lv_obj_t *vit_label[4], *vit_value[4], *vit_unit[4];
    /* week */
    lv_obj_t *week_letter[7], *week_dot[7], *week_icon[7], *week_count, *week_unit;
    /* right column */
    lv_obj_t *today_label, *title, *title_icon, *names, *pill, *pill_icon, *pill_text;
    lv_obj_t *figs[2], *rest_art, *rest_icon, *steam[3];
    figure_t fig[2];
    /* coach */
    lv_obj_t *coach_accent, *coach_text, *coach_week;
    char coach_shown[72];
    /* night */
    lv_obj_t *night_clock, *night_score;

    DashboardData last;
    bool have_last, statik, offline, clock_overridden;
    ui_seen_fn seen;
    ui_mark_fn mark;
} U;

/* ------------------------------------------------------------------ helpers */

lv_obj_t *ui_box(lv_obj_t *parent, int32_t x, int32_t y, int32_t w, int32_t h)
{
    lv_obj_t *o = lv_obj_create(parent);
    lv_obj_remove_style_all(o);
    lv_obj_remove_flag(o, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_pos(o, x, y);
    lv_obj_set_size(o, w, h);
    return o;
}

lv_obj_t *ui_rect(lv_obj_t *parent, int32_t x, int32_t y, int32_t w, int32_t h, lv_color_t c, int32_t radius)
{
    lv_obj_t *o = ui_box(parent, x, y, w, h);
    lv_obj_set_style_bg_color(o, c, 0);
    lv_obj_set_style_bg_opa(o, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(o, radius, 0);
    return o;
}

static lv_obj_t *panel(lv_obj_t *parent, int32_t x, int32_t y, int32_t w, int32_t h)
{
    lv_obj_t *o = ui_rect(parent, x, y, w, h, C_PANEL, RADIUS);
    lv_obj_set_style_border_color(o, C_BORDER, 0);
    lv_obj_set_style_border_width(o, 1, 0);
    return o;
}

lv_obj_t *ui_label(lv_obj_t *parent, const lv_font_t *font, lv_color_t color, int32_t x, int32_t y, const char *text)
{
    lv_obj_t *l = lv_label_create(parent);
    lv_obj_set_style_text_font(l, font, 0);
    lv_obj_set_style_text_color(l, color, 0);
    lv_obj_set_pos(l, x, y);
    lv_label_set_text(l, text);
    return l;
}

/* An UPPERCASE, letter-spaced, dim label (§5.1 typography). */
static lv_obj_t *caption(lv_obj_t *parent, int32_t x, int32_t y, const char *text)
{
    lv_obj_t *l = ui_label(parent, &font_12, C_TEXT_DIM, x, y, text);
    lv_obj_set_style_text_letter_space(l, 2, 0);
    return l;
}

lv_obj_t *ui_mask(lv_obj_t *parent, const lv_image_dsc_t *src, lv_color_t color, int32_t x, int32_t y)
{
    lv_obj_t *img = lv_image_create(parent);
    lv_image_set_src(img, src);
    lv_obj_set_pos(img, x, y);
    lv_obj_set_style_image_recolor(img, color, 0);
    lv_obj_set_style_image_recolor_opa(img, LV_OPA_COVER, 0);
    return img;
}

static void set_mask_color(lv_obj_t *img, lv_color_t c)
{
    lv_obj_set_style_image_recolor(img, c, 0);
}

static void show(lv_obj_t *o, bool on)
{
    if(on) lv_obj_remove_flag(o, LV_OBJ_FLAG_HIDDEN);
    else lv_obj_add_flag(o, LV_OBJ_FLAG_HIDDEN);
}

static bool has(int32_t v) { return v != DD_NONE; }

static int32_t pct_of(int32_t v, int32_t goal)
{
    if(!has(v) || !has(goal) || goal <= 0) return 0;
    int32_t p = (int32_t)((int64_t)v * 100 / goal);
    return p > 999 ? 999 : p;
}

static void fmt_thousands(char *buf, size_t n, int32_t v)
{
    if(!has(v)) { snprintf(buf, n, "\xE2\x80\x94"); return; }        /* — */
    if(v >= 1000) snprintf(buf, n, "%d,%03d", (int)(v / 1000), (int)(v % 1000));
    else snprintf(buf, n, "%d", (int)v);
}

static void fmt_sleep(char *buf, size_t n, int32_t min)
{
    if(!has(min)) snprintf(buf, n, "\xE2\x80\x94");
    else snprintf(buf, n, "%dh%02d", (int)(min / 60), (int)(min % 60));
}

/* "2026-10-22T18:10:00+02:00" → minutes since 2000-01-01 (local wall clock; both sides share the offset). */
static int64_t iso_minutes(const char *iso)
{
    int y, mo, d, h, mi;
    if(sscanf(iso, "%d-%d-%dT%d:%d", &y, &mo, &d, &h, &mi) != 5) return -1;
    static const int cum[] = {0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334};
    int64_t days = (int64_t)(y - 2000) * 365 + (y - 1997) / 4 + cum[(mo - 1) % 12] + d - 1;
    if(mo > 2 && y % 4 == 0) days++;
    return (days * 24 + h) * 60 + mi;
}

static const char *muscle_short(const char *id)
{
    if(strstr(id, "delts")) return "delts";
    if(!strcmp(id, "upper_back")) return "upper back";
    if(!strcmp(id, "lower_back")) return "lower back";
    if(!strcmp(id, "calves_front")) return "calves";
    return id;
}

/* ------------------------------------------------------------------ animations */

static void anim_opa_cb(void *obj, int32_t v) { lv_obj_set_style_opa(obj, (lv_opa_t)v, 0); }
static void anim_image_opa_cb(void *obj, int32_t v) { lv_obj_set_style_image_opa(obj, (lv_opa_t)v, 0); }
static void anim_bg_opa_cb(void *obj, int32_t v) { lv_obj_set_style_bg_opa(obj, (lv_opa_t)v, 0); }
static void anim_outline_cb(void *obj, int32_t v)
{
    lv_obj_set_style_outline_opa(obj, (lv_opa_t)(255 - v * 255 / 6), 0);
    lv_obj_set_style_outline_pad(obj, v, 0);
}

void ui_anim(void *var, lv_anim_exec_xcb_t cb, int32_t from, int32_t to, uint32_t ms, uint32_t delay, bool loop)
{
    lv_anim_t a;
    lv_anim_init(&a);
    lv_anim_set_var(&a, var);
    lv_anim_set_exec_cb(&a, cb);
    lv_anim_set_values(&a, from, to);
    lv_anim_set_duration(&a, ms);
    lv_anim_set_delay(&a, delay);
    lv_anim_set_path_cb(&a, loop ? lv_anim_path_ease_in_out : lv_anim_path_ease_out);
    if(loop) {
        lv_anim_set_reverse_duration(&a, ms);
        lv_anim_set_repeat_count(&a, LV_ANIM_REPEAT_INFINITE);
    }
    lv_anim_start(&a);
}

/* ------------------------------------------------------------------ HUD bar */

static void build_hud(lv_obj_t *p)
{
    lv_obj_t *bar = ui_rect(p, 0, 0, SCREEN_W, HUD_H, lv_color_hex(0x0B0C11), 0);
    lv_obj_set_style_border_side(bar, LV_BORDER_SIDE_BOTTOM, 0);
    lv_obj_set_style_border_width(bar, 1, 0);
    lv_obj_set_style_border_color(bar, C_BORDER, 0);

    U.clock = ui_label(bar, &font_16, C_TEXT, 16, 15, "");
    U.mascot = lv_image_create(bar);
    lv_obj_set_pos(U.mascot, 292, 8);
    U.lv = ui_label(bar, &font_16, C_GOLD, 334, 6, "");
    U.xp_text = ui_label(bar, &font_12, C_TEXT_DIM, 390, 8, "");
    lv_obj_set_width(U.xp_text, 104);
    lv_obj_set_style_text_align(U.xp_text, LV_TEXT_ALIGN_RIGHT, 0);
    U.xp_bar = ui_rect(bar, 334, 29, 160, 8, C_BORDER, 4);
    U.xp_fill = ui_rect(U.xp_bar, 0, 0, 0, 8, C_GOLD, 4);

    U.flame = ui_mask(bar, &icon_local_fire_department_20, C_GOLD, 590, 13);
    U.streak = ui_label(bar, &font_20, C_GOLD, 614, 11, "");
    U.live_dot = ui_rect(bar, 680, 19, 10, 10, C_LIME, 5);
    U.live_text = ui_label(bar, &font_14, C_TEXT_DIM, 698, 15, "live");
}

static void xp_width_cb(void *obj, int32_t v) { lv_obj_set_width(obj, v); }

static void update_hud(const DashboardData *d, const DashboardData *prev)
{
    if(!U.clock_overridden) {
        static const char *mon[] = {"JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"};
        static const char *wd[] = {"SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"};
        int y, m, day, h, mi;
        if(sscanf(d->now, "%d-%d-%dT%d:%d", &y, &m, &day, &h, &mi) == 5 && m >= 1 && m <= 12) {
            static const int t[] = {0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4};
            int yy = y - (m < 3);
            int w = (yy + yy / 4 - yy / 100 + yy / 400 + t[m - 1] + day) % 7;
            lv_label_set_text_fmt(U.clock, "%s %d %s \xC2\xB7 %02d:%02d", wd[w], day, mon[m - 1], h, mi);
        }
    }
    lv_image_set_src(U.mascot, mascot_for(d->mascot));
    lv_label_set_text_fmt(U.lv, "LV %d", (int)d->level);
    lv_label_set_text_fmt(U.xp_text, "%d/%d XP", (int)d->xp, (int)d->xp_next);
    int32_t w = d->xp_next > 0 ? 160 * d->xp / d->xp_next : 0;
    int32_t from = prev ? lv_obj_get_width(U.xp_fill) : 0;
    if(U.statik || from == w) lv_obj_set_width(U.xp_fill, w);
    else ui_anim(U.xp_fill, xp_width_cb, from, w, 700, prev && d->has_celebrate ? 3000 : 0, false);

    bool milestone = d->streak == 7 || d->streak == 14 || d->streak == 30 || d->streak == 50 || d->streak == 100;
    lv_label_set_text_fmt(U.streak, "%d", (int)d->streak);
    lv_obj_set_style_text_color(U.streak, milestone ? C_LIME : C_GOLD, 0);
    set_mask_color(U.flame, milestone ? C_LIME : C_GOLD);

    bool warn = U.offline || d->stale;
    lv_obj_set_style_bg_color(U.live_dot, warn ? C_AMBER : C_LIME, 0);
    lv_obj_set_style_text_color(U.live_text, warn ? C_AMBER : C_TEXT_DIM, 0);
    if(U.offline) lv_label_set_text(U.live_text, "offline");
    else if(!d->updated[0]) lv_label_set_text(U.live_text, "no sync yet");
    else if(d->stale) {
        int64_t age = iso_minutes(d->now) - iso_minutes(d->updated);
        if(age >= 0 && age < 48 * 60) lv_label_set_text_fmt(U.live_text, "data %dh old", (int)(age / 60));
        else lv_label_set_text(U.live_text, "data old");
    }
    else lv_label_set_text(U.live_text, "live");
}

/* ------------------------------------------------------------------ score ring */

#define RING_X 18
#define RING_Y 62
#define RING_D 180

static void build_ring(lv_obj_t *p)
{
    U.ring_glow = ui_mask(p, &glow_ring, C_GOLD, RING_X + RING_D / 2 - glow_ring.header.w / 2,
                          RING_Y + RING_D / 2 - glow_ring.header.h / 2);
    show(U.ring_glow, false);
    /* one segment per daily habit (PLAN.md §4.3b); up to DD_MAX_TASKS, the unused ones stay hidden */
    for(int i = 0; i < DD_MAX_TASKS; i++) {
        lv_obj_t *a = lv_arc_create(p);
        lv_obj_remove_style_all(a);
        lv_obj_remove_flag(a, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_set_pos(a, RING_X, RING_Y);
        lv_obj_set_size(a, RING_D, RING_D);
        lv_arc_set_rotation(a, 0);
        lv_arc_set_range(a, 0, 1);
        lv_obj_set_style_arc_width(a, 14, LV_PART_MAIN);
        lv_obj_set_style_arc_color(a, C_BORDER, LV_PART_MAIN);
        lv_obj_set_style_arc_rounded(a, true, LV_PART_MAIN);
        lv_obj_set_style_arc_width(a, 14, LV_PART_INDICATOR);
        lv_obj_set_style_arc_color(a, C_LIME, LV_PART_INDICATOR);
        lv_obj_set_style_arc_rounded(a, true, LV_PART_INDICATOR);
        show(a, false);
        U.arcs[i] = a;
    }
    lv_obj_t *centre = ui_box(p, RING_X, RING_Y, RING_D, RING_D);
    U.score = ui_label(centre, &font_48, C_TEXT, 0, 0, "0%");
    lv_obj_align(U.score, LV_ALIGN_CENTER, 0, -10);
    U.score_label = caption(centre, 0, 0, "");
    lv_obj_align(U.score_label, LV_ALIGN_CENTER, 0, 26);
    U.perfect = ui_label(centre, &font_12, C_BG, 0, 0, "PERFECT DAY");
    lv_obj_set_style_bg_color(U.perfect, C_GOLD, 0);
    lv_obj_set_style_bg_opa(U.perfect, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(U.perfect, 6, 0);
    lv_obj_set_style_pad_hor(U.perfect, 6, 0);
    lv_obj_set_style_pad_ver(U.perfect, 1, 0);
    lv_obj_set_style_text_letter_space(U.perfect, 2, 0);
    lv_obj_align(U.perfect, LV_ALIGN_CENTER, 0, 44);
    show(U.perfect, false);
}

static void score_cb(void *label, int32_t v) { lv_label_set_text_fmt(label, "%d%%", (int)v); }

static void update_ring(const DashboardData *d)
{
    int n = d->tasks_total;
    int32_t gap = n > 1 ? 14 : 0;   /* wide enough that the rounded ends don't close the gaps */
    int32_t span = n ? (360 - n * gap) / n : 0;
    for(int i = 0; i < DD_MAX_TASKS; i++) {
        lv_obj_t *a = U.arcs[i];
        show(a, i < n);
        if(i >= n) continue;
        int32_t start = 270 + gap / 2 + i * (span + gap);      /* first habit at 12 o'clock, clockwise */
        lv_arc_set_bg_angles(a, start, start + span);
        lv_arc_set_value(a, d->task_done[i] ? 1 : 0);
        lv_obj_set_style_arc_color(a, d->perfect ? C_GOLD : C_LIME, LV_PART_INDICATOR);
    }
    lv_obj_set_style_text_font(U.score, d->score >= 100 ? &font_36 : &font_48, 0);   /* "100%" must clear the ring */
    if(U.statik || d->score == U.shown_score) lv_label_set_text_fmt(U.score, "%d%%", (int)d->score);
    else ui_anim(U.score, score_cb, U.shown_score, d->score, 600, 0, false);
    U.shown_score = d->score;
    lv_label_set_text_fmt(U.score_label, "%d/%d HABITS", (int)d->tasks_done, (int)d->tasks_total);
    lv_obj_align(U.score_label, LV_ALIGN_CENTER, 0, 26);

    lv_obj_set_style_text_color(U.score, d->perfect ? C_GOLD : C_TEXT, 0);
    show(U.perfect, d->perfect);
    show(U.ring_glow, d->perfect);
    lv_obj_set_style_image_opa(U.ring_glow, LV_OPA_60, 0);
}

/* ------------------------------------------------------------------ stat rows */

#define ROWS_X 214
#define ROW_W  270
#define BLOCK_W 9
#define BLOCK_GAP 3

static void build_row(lv_obj_t *p, stat_row_t *r, int32_t y, const char *name, const lv_image_dsc_t *icon, lv_color_t color)
{
    r->color = color;
    r->hl = ui_rect(p, ROWS_X - 8, y - 6, ROW_W + 16, 66, lv_color_hex(0x0E1B22), 10);
    lv_obj_set_style_border_color(r->hl, C_CYAN, 0);
    lv_obj_set_style_border_opa(r->hl, LV_OPA_30, 0);
    lv_obj_set_style_border_width(r->hl, 1, 0);
    show(r->hl, false);
    r->root = ui_box(p, ROWS_X, y, ROW_W, 60);
    r->icon = ui_mask(r->root, icon, color, 0, -2);
    r->label = caption(r->root, 26, 2, name);
    r->trophy = ui_mask(r->root, &icon_trophy_16, C_LIME, 0, 0);
    lv_obj_align_to(r->trophy, r->label, LV_ALIGN_OUT_RIGHT_MID, 6, -1);
    r->pct = ui_label(r->root, &font_14, C_TEXT_DIM, ROW_W - 80, 0, "");
    lv_obj_set_width(r->pct, 80);
    lv_obj_set_style_text_align(r->pct, LV_TEXT_ALIGN_RIGHT, 0);
    r->pct_check = ui_mask(r->root, &icon_check_14, C_LIME, 0, 2);
    r->value = ui_label(r->root, &font_28, C_TEXT, 0, 16, "");
    r->unit = ui_label(r->root, &font_14, C_TEXT_DIM, 0, 30, "");
    int32_t bx = ROW_W - (10 * BLOCK_W + 9 * BLOCK_GAP);
    for(int i = 0; i < 10; i++) r->blocks[i] = ui_rect(r->root, bx + i * (BLOCK_W + BLOCK_GAP), 28, BLOCK_W, 10, C_BORDER, 2);
    r->sub = ui_label(r->root, &font_12, C_TEXT_DIM, 0, 49, "");
}

static void set_row(stat_row_t *r, const char *value, const char *unit, int32_t pct, bool known, const char *sub)
{
    bool hit = known && pct >= 100;
    lv_label_set_text(r->value, value);
    lv_obj_set_style_text_color(r->value, known ? C_TEXT : C_TEXT_FAINT, 0);
    lv_label_set_text(r->unit, unit);
    lv_obj_align_to(r->unit, r->value, LV_ALIGN_OUT_RIGHT_BOTTOM, 6, -5);
    show(r->trophy, hit);
    show(r->pct_check, hit);
    if(!known) lv_label_set_text(r->pct, "\xE2\x80\x94");
    else if(hit) lv_label_set_text(r->pct, "GOAL");
    else lv_label_set_text_fmt(r->pct, "%d%%", (int)pct);
    lv_obj_set_style_text_color(r->pct, hit ? C_LIME : known ? C_TEXT_DIM : C_TEXT_FAINT, 0);
    if(hit) {
        lv_obj_update_layout(r->pct);
        int32_t tw = lv_text_get_width("GOAL", 4, &font_14, 0);
        lv_obj_set_pos(r->pct_check, ROW_W - tw - 18, 2);
    }
    int32_t filled = known ? (pct >= 100 ? 10 : (pct + 5) / 10) : 0;
    for(int i = 0; i < 10; i++) {
        lv_obj_set_style_bg_color(r->blocks[i], i < filled ? (hit ? C_LIME : r->color) : C_BORDER, 0);
    }
    lv_label_set_text(r->sub, sub);
}

static void build_rows(lv_obj_t *p)
{
    build_row(p, &U.rows[0], 60, "SLEEP", &icon_bedtime_20, C_VIOLET);
    build_row(p, &U.rows[1], 128, "MOVE", &icon_directions_walk_20, C_CYAN);
    build_row(p, &U.rows[2], 196, "FUEL", &icon_nutrition_20, C_GOLD);
    /* sleep stage bar sits where the other rows have a sub line */
    lv_color_t sc[4] = {C_DEEP, C_CYAN, C_VIOLET, C_TEXT_FAINT};
    for(int i = 0; i < 4; i++) U.rows[0].stages[i] = ui_rect(U.rows[0].root, 0, 52, 0, 5, sc[i], 2);
}

static void update_rows(const DashboardData *d)
{
    char v[24], unit[24], sub[48];

    /* sleep */
    fmt_sleep(v, sizeof v, d->sleep_min);
    if(has(d->sleep_avg7)) {
        char a[16];
        fmt_sleep(a, sizeof a, d->sleep_avg7);
        snprintf(unit, sizeof unit, "avg %s", a);
    }
    else unit[0] = '\0';
    set_row(&U.rows[0], v, unit, pct_of(d->sleep_min, d->sleep_goal), has(d->sleep_min), "");
    int32_t total = d->has_stages ? d->deep + d->core + d->rem + d->awake : 0;
    int32_t x = 0, vals[4] = {d->deep, d->core, d->rem, d->awake};
    for(int i = 0; i < 4; i++) {
        int32_t w = total > 0 ? (ROW_W * vals[i] + total / 2) / total : 0;
        if(i == 3 && total > 0) w = ROW_W - x;
        lv_obj_set_x(U.rows[0].stages[i], x);
        lv_obj_set_width(U.rows[0].stages[i], w > 2 ? w - 2 : w);
        show(U.rows[0].stages[i], w > 0);
        x += w;
    }

    /* move: steps and active kcal */
    fmt_thousands(v, sizeof v, d->steps);
    char a[16], g[16];
    fmt_thousands(a, sizeof a, d->active);
    fmt_thousands(g, sizeof g, d->active_goal);
    snprintf(sub, sizeof sub, "%s / %s active kcal", a, g);
    set_row(&U.rows[1], v, "steps", pct_of(d->steps, d->steps_goal), has(d->steps), sub);

    /* fuel: protein first, kcal underneath */
    if(has(d->protein)) snprintf(v, sizeof v, "%d g", (int)d->protein);
    else snprintf(v, sizeof v, "\xE2\x80\x94");
    snprintf(unit, sizeof unit, "/ %d g", (int)d->protein_goal);
    fmt_thousands(a, sizeof a, d->kcal);
    fmt_thousands(g, sizeof g, d->kcal_goal);
    snprintf(sub, sizeof sub, "%s / %s kcal", a, g);
    set_row(&U.rows[2], v, unit, pct_of(d->protein, d->protein_goal), has(d->protein), sub);

    /* morning: the sleep row is highlighted */
    show(U.rows[0].hl, d->mode == DD_MODE_MORNING);
}

/* ------------------------------------------------------------------ vitals card (blood pressure + Health) */

#define BP_X 16
#define BP_Y 270
#define BP_W 250
#define BP_H 160
#define VIT_COL 118
#define VIT_ROW 62

static void build_bp(lv_obj_t *p)
{
    lv_obj_t *c = panel(p, BP_X, BP_Y, BP_W, BP_H);
    caption(c, 14, 12, "VITALS");
    /* 2x2: blood pressure (logged in the app), then resting HR, latest HR and blood oxygen (Apple Health) */
    static const lv_image_dsc_t *const icons[4] = {&icon_blood_pressure_16, &icon_ecg_heart_16, &icon_favorite_16,
                                                   &icon_spo2_16};
    static const char *const labels[4] = {"BP", "RESTING", "HEART", "SPO2"};
    static const char *const units[4] = {"", "bpm", "bpm", "%"};
    const lv_color_t colors[4] = {C_TEXT, lv_color_hex(0xFF5A7A), lv_color_hex(0xFF8A5B), C_CYAN};
    for(int i = 0; i < 4; i++) {
        int32_t x = 14 + (i % 2) * VIT_COL, y = 36 + (i / 2) * VIT_ROW;
        ui_mask(c, icons[i], colors[i], x, y);
        U.vit_label[i] = ui_label(c, &font_12, C_TEXT_DIM, x + 21, y + 1, labels[i]);
        U.vit_value[i] = ui_label(c, &font_28, C_TEXT, x - 1, y + 18, "");
        U.vit_unit[i] = ui_label(c, &font_12, C_TEXT_DIM, 0, 0, units[i]);
    }
}

static void update_bp(const DashboardData *d)
{
    char today[11] = {0}, bpday[11] = {0};
    memcpy(today, d->now, 10);
    memcpy(bpday, d->bp_ts, 10);
    bool logged_today = d->has_bp && strcmp(today, bpday) == 0;

    if(d->has_bp) {
        lv_label_set_text_fmt(U.vit_value[0], "%d/%d", (int)d->bp_sys, (int)d->bp_dia);
        lv_obj_set_style_text_color(U.vit_value[0], logged_today ? C_TEXT : C_TEXT_DIM, 0);
        /* time today, MM-DD for an older reading */
        lv_label_set_text_fmt(U.vit_label[0], "BP \xC2\xB7 %.5s", logged_today ? d->bp_ts + 11 : d->bp_ts + 5);
    }
    else {
        lv_label_set_text(U.vit_value[0], "\xE2\x80\x94");
        lv_obj_set_style_text_color(U.vit_value[0], C_TEXT_FAINT, 0);
        lv_label_set_text(U.vit_label[0], "BP \xC2\xB7 log in app");
    }

    const int32_t vit[4] = {0, d->resting_hr, d->heart_rate, d->spo2};
    for(int i = 1; i < 4; i++) {
        if(has(vit[i])) lv_label_set_text_fmt(U.vit_value[i], "%d", (int)vit[i]);
        else lv_label_set_text(U.vit_value[i], "\xE2\x80\x94");
        lv_obj_set_style_text_color(U.vit_value[i], has(vit[i]) ? C_TEXT : C_TEXT_FAINT, 0);
        show(U.vit_unit[i], has(vit[i]));
        lv_obj_align_to(U.vit_unit[i], U.vit_value[i], LV_ALIGN_OUT_RIGHT_BOTTOM, 4, -5);
    }
}

/* ------------------------------------------------------------------ week card */

#define WK_X 278
#define WK_Y 270
#define WK_W 206
#define WK_H 160

static void build_week(lv_obj_t *p)
{
    lv_obj_t *c = panel(p, WK_X, WK_Y, WK_W, WK_H);
    caption(c, 14, 12, "THIS WEEK");
    for(int i = 0; i < 7; i++) {
        int32_t cx = 14 + i * 27;
        U.week_letter[i] = ui_label(c, &font_12, C_TEXT_DIM, cx + 6, 38, "");
        U.week_dot[i] = ui_rect(c, cx, 58, 22, 22, C_BG, 11);
        U.week_icon[i] = ui_mask(c, &icon_bedtime_14, C_TEAL, cx + 4, 62);
    }
    U.week_count = ui_label(c, &font_28, C_TEXT, 14, 100, "");
    U.week_unit = ui_label(c, &font_14, C_TEXT_DIM, 0, 0, "sessions");
}

static void update_week(const DashboardData *d, bool loops)
{
    for(int i = 0; i < 7; i++) {
        lv_obj_t *dot = U.week_dot[i], *ic = U.week_icon[i];
        lv_color_t c = lv_color_hex(d->week_color[i]);
        lv_label_set_text(U.week_letter[i], d->week_d[i]);
        lv_anim_delete(dot, NULL);
        lv_obj_set_style_border_width(dot, 0, 0);
        lv_obj_set_style_outline_width(dot, 0, 0);
        lv_obj_set_style_bg_opa(dot, LV_OPA_TRANSP, 0);
        show(dot, true);
        show(ic, true);
        lv_image_set_src(ic, icon_for(d->week_icon[i], 14));
        set_mask_color(ic, c);
        lv_obj_set_style_text_color(U.week_letter[i], d->week[i] == DD_WEEK_TODAY ? C_TEXT : C_TEXT_DIM, 0);
        switch(d->week[i]) {
            case DD_WEEK_DONE:                       /* filled in the split colour, dark icon */
                lv_obj_set_style_bg_color(dot, c, 0);
                lv_obj_set_style_bg_opa(dot, LV_OPA_COVER, 0);
                set_mask_color(ic, C_BG);
                break;
            case DD_WEEK_REST:                       /* teal tint, moon or hot tub */
                lv_obj_set_style_bg_color(dot, C_TEAL, 0);
                lv_obj_set_style_bg_opa(dot, LV_OPA_20, 0);
                set_mask_color(ic, C_TEAL);
                break;
            case DD_WEEK_MISSED:
            case DD_WEEK_SKIPPED:                    /* faint outline + x, no guilt colours */
                lv_obj_set_style_border_color(dot, C_TEXT_FAINT, 0);
                lv_obj_set_style_border_width(dot, 1, 0);
                lv_image_set_src(ic, &icon_close_14);
                set_mask_color(ic, C_TEXT_FAINT);
                break;
            case DD_WEEK_TODAY:
                lv_obj_set_style_border_color(dot, c, 0);
                lv_obj_set_style_border_width(dot, 2, 0);
                lv_obj_set_style_outline_color(dot, c, 0);
                lv_obj_set_style_outline_width(dot, 2, 0);
                lv_obj_set_style_outline_opa(dot, LV_OPA_TRANSP, 0);
                if(loops) ui_anim(dot, anim_outline_cb, 0, 6, 800, 0, true);
                break;
            default:                                 /* planned: split-coloured ring */
                lv_obj_set_style_border_color(dot, c, 0);
                lv_obj_set_style_border_opa(dot, LV_OPA_60, 0);
                lv_obj_set_style_border_width(dot, 2, 0);
                break;
        }
        lv_obj_align_to(ic, dot, LV_ALIGN_CENTER, 0, 0);
    }
    lv_label_set_text_fmt(U.week_count, "%d/%d", (int)d->week_done, (int)d->week_target);
    lv_obj_set_style_text_color(U.week_count, d->week_done >= d->week_target && d->week_target > 0 ? C_LIME : C_TEXT, 0);
    lv_obj_align_to(U.week_unit, U.week_count, LV_ALIGN_OUT_RIGHT_BOTTOM, 6, -5);
}

/* ------------------------------------------------------------------ body map (the star) */

#define FIG_Y 118
#define FIG_GAP 14
#define FIG_X0 (LEFT_W + (SCREEN_W - LEFT_W - 2 * BODY_FIG_W - FIG_GAP) / 2)
static const int32_t FIG_X[2] = {FIG_X0, FIG_X0 + BODY_FIG_W + FIG_GAP};
#define REST_ICON 120

static void build_body(lv_obj_t *p)
{
    U.today_label = caption(p, LEFT_W + 24, 62, "TODAY");
    U.title_icon = ui_mask(p, &icon_fitness_center_28, C_PRIMARY, LEFT_W + 22, 79);
    U.title = ui_label(p, &font_28, C_PRIMARY, LEFT_W + 58, 78, "");
    lv_obj_set_style_text_letter_space(U.title, 1, 0);

    for(int v = 0; v < 2; v++) {
        figure_t *f = &U.fig[v];
        lv_obj_t *fig = ui_box(p, FIG_X[v], FIG_Y, BODY_FIG_W, BODY_FIG_H);
        U.figs[v] = fig;
        lv_obj_add_flag(fig, LV_OBJ_FLAG_OVERFLOW_VISIBLE);
        /* layers: body fill (#191C25), muscles (#232836), outlines (#343B4D), then the lit overlays */
        f->sil_fill = ui_mask(fig, v ? &body_sil_back_fill : &body_sil_front_fill, C_BODY_PART, 0, 0);
        f->sil_line = ui_mask(fig, v ? &body_sil_back_line : &body_sil_front_line, C_MUSCLE_LINE, 0, 0);
        /* the reveal box clips the coloured overlays; it grows upward for the "done" sweep */
        f->reveal = ui_box(fig, -BODY_GLOW_PAD, -BODY_GLOW_PAD, BODY_FIG_W + 2 * BODY_GLOW_PAD, BODY_FIG_H + 2 * BODY_GLOW_PAD);
        f->content = ui_box(f->reveal, 0, 0, BODY_FIG_W + 2 * BODY_GLOW_PAD, BODY_FIG_H + 2 * BODY_GLOW_PAD);
        for(uint32_t i = 0; i < body_parts_count; i++) {
            const body_part_t *bp = &body_parts[i];
            if((int)bp->view != v) continue;
            f->base[i] = ui_mask(fig, bp->img, C_MUSCLE, bp->x, bp->y);
            lv_obj_move_to_index(f->base[i], 1);   /* above the body fill, below the outlines */
            f->glow[i] = ui_mask(f->content, bp->glow, C_PRIMARY, bp->x, bp->y);
            f->fill[i] = ui_mask(f->content, bp->img, C_PRIMARY, bp->x + BODY_GLOW_PAD, bp->y + BODY_GLOW_PAD);
        }
    }
    /* rest days: a big teal icon instead of the body, with steam rising from the hot tub */
    U.rest_art = ui_box(p, LEFT_W, FIG_Y, SCREEN_W - LEFT_W, BODY_FIG_H);
    U.rest_icon = ui_mask(U.rest_art, &icon_hot_tub_120, C_TEAL, (SCREEN_W - LEFT_W - REST_ICON) / 2, 70);
    for(int i = 0; i < 3; i++) {
        U.steam[i] = ui_mask(U.rest_art, &steam_wisp, C_TEAL, (SCREEN_W - LEFT_W) / 2 - 22 + i * 18, 52);
        lv_obj_set_style_image_opa(U.steam[i], LV_OPA_TRANSP, 0);
    }
    show(U.rest_art, false);

    U.names = ui_label(p, &font_14, C_TEXT_DIM, LEFT_W, 368, "");
    lv_obj_set_width(U.names, SCREEN_W - LEFT_W);
    lv_obj_set_style_text_align(U.names, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_letter_space(U.names, 1, 0);

    U.pill = ui_rect(p, LEFT_W + 30, 392, 240, 40, C_PRIMARY, 20);
    U.pill_icon = ui_mask(U.pill, &icon_check_18, C_INK, 0, 11);
    U.pill_text = ui_label(U.pill, &font_16, C_INK, 0, 11, "");
    lv_obj_set_style_text_letter_space(U.pill_text, 1, 0);
}

static void sweep_cb(void *fig_ptr, int32_t v)
{
    figure_t *f = fig_ptr;
    int32_t full = BODY_FIG_H + 2 * BODY_GLOW_PAD;
    lv_obj_set_y(f->reveal, -BODY_GLOW_PAD + full - v);
    lv_obj_set_height(f->reveal, v);
    lv_obj_set_y(f->content, -(full - v));
}

static bool muscle_on(const DashboardData *d, const char *id)
{
    for(int i = 0; i < d->muscles_n; i++) {
        if(!strcmp(d->muscles[i], id)) return true;
        if(!strcmp(id, "calves_front") && !strcmp(d->muscles[i], "calves")) return true;
    }
    return false;
}

/* A polygon group lights when any of its space-separated ids is trained today. */
static bool part_on(const DashboardData *d, const char *ids)
{
    char id[24];
    while(*ids) {
        size_t n = strcspn(ids, " ");
        if(n && n < sizeof id) {
            memcpy(id, ids, n);
            id[n] = '\0';
            if(muscle_on(d, id)) return true;
        }
        ids += n + (ids[n] == ' ');
    }
    return false;
}

static void steam_cb(void *wisp, int32_t v)
{
    /* rise 30 px while fading in and out */
    lv_obj_set_style_translate_y(wisp, -v * 30 / 255, 0);
    lv_obj_set_style_image_opa(wisp, (lv_opa_t)(v < 128 ? v * 2 : (255 - v) * 2), 0);
}

static void update_body(const DashboardData *d, const DashboardData *prev, bool loops)
{
    bool rest = d->gym == DD_GYM_REST, done = d->gym == DD_GYM_DONE, skipped = d->gym == DD_GYM_SKIPPED;
    lv_color_t split = rest ? C_TEAL : lv_color_hex(d->color);          /* split colour, used everywhere */
    lv_color_t accent = done ? C_LIME : skipped ? C_TEXT_DIM : split;

    /* title: split icon + name in the split colour ("PUSH DAY", "SPA DAY") */
    char title[32];
    if(strstr(d->label, "DAY")) snprintf(title, sizeof title, "%s", d->label);
    else snprintf(title, sizeof title, "%s DAY", d->label);
    lv_label_set_text(U.title, title);
    lv_obj_set_style_text_color(U.title, split, 0);
    lv_image_set_src(U.title_icon, icon_for(d->icon, 28));
    set_mask_color(U.title_icon, split);

    /* rest days show the big icon instead of the body */
    show(U.figs[0], !rest);
    show(U.figs[1], !rest);
    show(U.rest_art, rest);
    for(int i = 0; i < 3; i++) lv_anim_delete(U.steam[i], steam_cb);
    if(rest) {
        bool tub = !strcmp(d->icon, "hot_tub");
        lv_image_set_src(U.rest_icon, tub ? &icon_hot_tub_120 : &icon_bedtime_120);
        for(int i = 0; i < 3; i++) {
            show(U.steam[i], tub);
            if(!tub) continue;
            if(loops) {            /* the steam is a loop; on rest days nothing breathes, so the budget holds */
                lv_anim_t a;
                lv_anim_init(&a);
                lv_anim_set_var(&a, U.steam[i]);
                lv_anim_set_exec_cb(&a, steam_cb);
                lv_anim_set_values(&a, 0, 255);
                lv_anim_set_duration(&a, 2400);
                lv_anim_set_delay(&a, (uint32_t)i * 800);
                lv_anim_set_repeat_count(&a, LV_ANIM_REPEAT_INFINITE);
                lv_anim_start(&a);
            }
            else steam_cb(U.steam[i], 100 + i * 40);   /* snapshot: a still frame with visible steam */
        }
    }

    bool sweep = done && !U.statik && (!prev || prev->gym != DD_GYM_DONE);
    for(int v = 0; v < 2; v++) {
        figure_t *f = &U.fig[v];
        lv_anim_delete(f, sweep_cb);
        sweep_cb(f, BODY_FIG_H + 2 * BODY_GLOW_PAD);
        for(uint32_t i = 0; i < body_parts_count; i++) {
            if((int)body_parts[i].view != v) continue;
            lv_obj_t *base = f->base[i], *glow = f->glow[i], *fill = f->fill[i];
            bool on = !rest && part_on(d, body_parts[i].ids);
            (void)base;
            lv_anim_delete(glow, NULL);
            lv_anim_delete(fill, NULL);
            show(fill, on);
            show(glow, on && !skipped);
            set_mask_color(fill, accent);
            set_mask_color(glow, accent);
            lv_obj_set_style_image_opa(fill, LV_OPA_COVER, 0);
            lv_obj_set_style_image_opa(glow, done ? LV_OPA_50 : LV_OPA_70, 0);
            if(on && d->gym == DD_GYM_PENDING && loops) {     /* breathing: 55% → 100% → 55% over 2.4 s */
                ui_anim(fill, anim_image_opa_cb, 140, 255, 1200, 0, true);
                ui_anim(glow, anim_image_opa_cb, 40, 200, 1200, 0, true);
            }
        }
        if(sweep) ui_anim(f, sweep_cb, 0, BODY_FIG_H + 2 * BODY_GLOW_PAD, 500, v * 60, false);
    }

    /* muscle names (deduplicated: front/side/rear delts → "delts") */
    char names[96] = "";
    const char *seen[DD_MAX_MUSCLES];
    int ns = 0;
    for(int i = 0; i < d->muscles_n && !rest; i++) {
        const char *s = muscle_short(d->muscles[i]);
        bool dup = false;
        for(int k = 0; k < ns; k++) dup |= !strcmp(seen[k], s);
        if(dup) continue;
        seen[ns++] = s;
        if(names[0]) strncat(names, " \xC2\xB7 ", sizeof names - strlen(names) - 1);
        strncat(names, s, sizeof names - strlen(names) - 1);
    }
    for(char *c = names; *c; c++) if(*c >= 'a' && *c <= 'z') *c -= 32;
    lv_label_set_text(U.names, rest ? "RECOVERY IS TRAINING TOO" : names);
    lv_label_set_long_mode(U.names, LV_LABEL_LONG_DOT);

    /* status pill */
    char pill[40];
    lv_color_t bg = split, fg = C_INK;
    const lv_image_dsc_t *icon = &icon_bolt_20;
    lv_opa_t bg_opa = LV_OPA_COVER;
    if(done) {
        bg = C_LIME;
        icon = &icon_check_18;
        if(has(d->done_min)) snprintf(pill, sizeof pill, "DONE \xC2\xB7 %d MIN", (int)d->done_min);
        else snprintf(pill, sizeof pill, "DONE");
    }
    else if(rest) { bg = C_TEAL; fg = C_TEAL; bg_opa = LV_OPA_20; icon = icon_for(d->icon, 20); snprintf(pill, sizeof pill, "RECOVERY DAY"); }
    else if(skipped) { bg = lv_color_hex(0x2A3042); fg = C_TEXT_DIM; icon = &icon_close_14; snprintf(pill, sizeof pill, "SKIPPED"); }
    else snprintf(pill, sizeof pill, "LET'S GO");
    lv_anim_delete(U.pill, NULL);
    lv_obj_set_style_bg_color(U.pill, bg, 0);
    lv_obj_set_style_bg_opa(U.pill, bg_opa, 0);
    lv_label_set_text(U.pill_text, pill);
    lv_obj_set_style_text_color(U.pill_text, fg, 0);
    lv_image_set_src(U.pill_icon, icon);
    set_mask_color(U.pill_icon, fg);
    int32_t tw = lv_text_get_width(pill, strlen(pill), &font_16, 1);
    int32_t iw = icon->header.w;
    int32_t x0 = (240 - (iw + 8 + tw)) / 2;
    lv_obj_set_pos(U.pill_icon, x0, (40 - icon->header.h) / 2);
    lv_obj_set_pos(U.pill_text, x0 + iw + 8, 11);
    /* evening + pending: the pill pulses faster (and takes the today-dot's looping slot) */
    if(loops && d->gym == DD_GYM_PENDING && d->mode == DD_MODE_EVENING) ui_anim(U.pill, anim_bg_opa_cb, 150, 255, 500, 0, true);
}

/* ------------------------------------------------------------------ coach bar */

static void build_coach(lv_obj_t *p)
{
    lv_obj_t *bar = ui_rect(p, 0, SCREEN_H - COACH_H, SCREEN_W, COACH_H, lv_color_hex(0x0B0C11), 0);
    lv_obj_set_style_border_side(bar, LV_BORDER_SIDE_TOP, 0);
    lv_obj_set_style_border_width(bar, 1, 0);
    lv_obj_set_style_border_color(bar, C_BORDER, 0);
    U.coach_accent = ui_rect(bar, 0, 0, 4, COACH_H, C_PRIMARY, 0);
    U.coach_text = ui_label(bar, &font_20, C_TEXT, 20, 8, "");
    lv_obj_set_width(U.coach_text, 640);
    lv_label_set_long_mode(U.coach_text, LV_LABEL_LONG_DOT);
    U.coach_week = ui_label(bar, &font_14, C_TEXT_DIM, SCREEN_W - 136, 12, "");
    lv_obj_set_width(U.coach_week, 120);
    lv_obj_set_style_text_align(U.coach_week, LV_TEXT_ALIGN_RIGHT, 0);
}

static void update_coach(const DashboardData *d)
{
    lv_color_t c = d->tone == DD_TONE_HYPE ? C_GOLD : d->tone == DD_TONE_CALM ? C_CYAN
                   : d->tone == DD_TONE_PROUD ? C_LIME : C_PRIMARY;
    lv_obj_set_style_bg_color(U.coach_accent, c, 0);
    if(strcmp(U.coach_shown, d->coach) != 0) {
        lv_label_set_text(U.coach_text, d->coach);
        snprintf(U.coach_shown, sizeof U.coach_shown, "%s", d->coach);
        if(!U.statik) ui_anim(U.coach_text, anim_opa_cb, 0, 255, 400, 0, false);
    }
    lv_label_set_text_fmt(U.coach_week, "%d/%d this wk", (int)d->week_done, (int)d->week_target);
}

/* ------------------------------------------------------------------ night screen */

static void build_night(void)
{
    U.night = ui_rect(U.scr, 0, 0, SCREEN_W, SCREEN_H, lv_color_hex(0x000000), 0);
    U.night_clock = ui_label(U.night, &font_48, C_TEXT_FAINT, 0, 0, "");
    lv_obj_align(U.night_clock, LV_ALIGN_CENTER, 0, -16);
    U.night_score = ui_label(U.night, &font_14, C_TEXT_FAINT, 0, 0, "");
    lv_obj_align(U.night_score, LV_ALIGN_CENTER, 0, 30);
    show(U.night, false);
}

/* ------------------------------------------------------------------ public API */

void ui_init(lv_display_t *disp)
{
    LV_ASSERT_MSG(body_parts_count <= BODY_MAX_PARTS, "figure_t arrays are indexed like body_parts[]");
    memset(&U, 0, sizeof U);
    U.scr = lv_display_get_screen_active(disp);
    lv_obj_remove_style_all(U.scr);
    lv_obj_set_style_bg_color(U.scr, C_BG, 0);
    lv_obj_set_style_bg_opa(U.scr, LV_OPA_COVER, 0);
    lv_obj_remove_flag(U.scr, LV_OBJ_FLAG_SCROLLABLE);

    ui_background(U.scr);
    U.main = ui_box(U.scr, 0, 0, SCREEN_W, SCREEN_H);
    build_hud(U.main);
    build_ring(U.main);
    build_rows(U.main);
    build_bp(U.main);
    build_week(U.main);
    build_body(U.main);
    build_coach(U.main);
    build_night();
}

void ui_update(const DashboardData *d)
{
    const DashboardData *prev = U.have_last ? &U.last : NULL;
    bool loops = !U.statik;

    bool night = d->mode == DD_MODE_NIGHT;
    show(U.night, night);
    show(U.main, !night);
    if(night) {
        lv_label_set_text_fmt(U.night_clock, "%.5s", d->now + 11);
        lv_label_set_text_fmt(U.night_score, "SCORE %d", (int)d->score);
    }

    /* while a celebration plays, the HUD updates underneath and the XP bar fills after it */
    update_hud(d, prev);
    update_ring(d);
    update_rows(d);
    update_bp(d);
    /* at most two looping animations: breathing + today dot, or breathing + evening pill */
    bool pill_pulse = d->gym == DD_GYM_PENDING && d->mode == DD_MODE_EVENING;
    update_week(d, loops && !pill_pulse);
    update_body(d, prev, loops);
    update_coach(d);

    if(d->has_celebrate && !night) {
        bool seen = U.seen ? U.seen(d->cel_id) : ui_celebration_seen(d->cel_id);
        if(!seen) {
            if(U.mark) U.mark(d->cel_id);
            ui_celebration_mark(d->cel_id);
            ui_celebrate(d->cel_title, d->cel_sub, U.statik);
        }
    }

    U.last = *d;
    U.have_last = true;
}

void ui_set_clock(const char *text)
{
    U.clock_overridden = text != NULL;
    if(text) lv_label_set_text(U.clock, text);
}

void ui_set_offline(bool offline)
{
    U.offline = offline;
    if(U.have_last) update_hud(&U.last, &U.last);
}

void ui_set_static(bool on) { U.statik = on; }

void ui_set_celebration_store(ui_seen_fn seen, ui_mark_fn mark)
{
    U.seen = seen;
    U.mark = mark;
}
