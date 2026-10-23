/* Sleep scene (PLAN.md §5.1): shown inside the config's night window, 00:00–08:00 by default.
 *
 * The backlight on this board is on/off only, so light is kept down with pixels: pure black
 * everywhere, and every element is a dark tone (nothing above ~25% brightness). Pip sleeps on a
 * cushion under the moon, breathing slowly; three Z's drift up; a few stars twinkle. All loops are
 * slow (3–7 s) and cover small areas, so the panel redraws little. The whole scene shifts a few
 * pixels every 10 minutes to avoid image retention over an 8-hour night. */
#include <stdio.h>
#include <string.h>

#include "theme.h"
#include "fonts/fonts.h"
#include "assets/hud_assets.h"
#include "assets/mascot_assets.h"
#include "ui_internal.h"

#define N_STARS 16
#define N_Z 3
#define PIP_SCALE 3                  /* 32 px pixel art → 96 px */
#define PIP_X 352
#define PIP_Y 232
#define Z_MS 6600

static struct {
    lv_obj_t *root, *scene, *pip, *clock, *wake, *z[N_Z], *stars[N_STARS];
    int shift;
} N;

/* fixed "random" sky: x, y, size, twinkles */
static const int16_t STARS[N_STARS][4] = {
    {64, 52, 2, 0},   {142, 128, 3, 1}, {218, 34, 2, 0},  {120, 300, 2, 0}, {58, 214, 2, 1},  {300, 186, 2, 0},
    {372, 48, 2, 1},  {508, 34, 3, 0},  {586, 112, 2, 0}, {662, 58, 2, 1},  {740, 150, 3, 0}, {700, 272, 2, 0},
    {610, 214, 2, 1}, {76, 402, 2, 0},  {724, 398, 2, 0}, {468, 150, 2, 0},
};

/* ±6 px drift, one step every 10 minutes */
static const int8_t SHIFT[8][2] = {{0, 0}, {6, -3}, {3, 5}, {-5, 2}, {-3, -5}, {5, 4}, {-6, -2}, {2, -6}};

static void opa_cb(void *o, int32_t v) { lv_obj_set_style_opa(o, (lv_opa_t)v, 0); }
static void breathe_cb(void *o, int32_t v) { lv_obj_set_style_translate_y(o, v, 0); }

/* one Z drifting up and to the right, fading in then out; v = 0…1000 */
static void z_cb(void *o, int32_t v)
{
    int i = (int)(intptr_t)lv_obj_get_user_data(o);
    /* starts where the sprite's own little zz are, top right of Pip */
    lv_obj_set_pos(o, PIP_X + 84 + v * 60 / 1000 + i * 3, PIP_Y + 6 - v * 120 / 1000 - i * 6);
    int32_t opa = v < 250 ? v * 160 / 250 : (1000 - v) * 160 / 750;
    lv_obj_set_style_opa(o, (lv_opa_t)opa, 0);
}

static void loop_anim(void *var, lv_anim_exec_xcb_t cb, int32_t from, int32_t to, uint32_t ms, uint32_t delay,
                      bool reverse)
{
    lv_anim_t a;
    lv_anim_init(&a);
    lv_anim_set_var(&a, var);
    lv_anim_set_exec_cb(&a, cb);
    lv_anim_set_values(&a, from, to);
    lv_anim_set_duration(&a, ms);
    lv_anim_set_delay(&a, delay);
    lv_anim_set_path_cb(&a, reverse ? lv_anim_path_ease_in_out : lv_anim_path_linear);
    if(reverse) lv_anim_set_reverse_duration(&a, ms);
    lv_anim_set_repeat_count(&a, LV_ANIM_REPEAT_INFINITE);
    lv_anim_start(&a);
}

void ui_night_build(lv_obj_t *scr)
{
    N.root = ui_rect(scr, 0, 0, SCREEN_W, SCREEN_H, lv_color_hex(0x000000), 0);
    N.scene = ui_box(N.root, 0, 0, SCREEN_W, SCREEN_H);

    for(int i = 0; i < N_STARS; i++) {
        N.stars[i] = ui_rect(N.scene, STARS[i][0], STARS[i][1], STARS[i][2], STARS[i][2],
                             lv_color_hex(STARS[i][3] ? 0x2A2E3E : 0x1C1F2A), 1);
    }

    ui_mask(N.scene, &icon_bedtime_120, lv_color_hex(0x2A2418), 216, 64);   /* warm, dim moon */

    ui_rect(N.scene, PIP_X - 27, PIP_Y + 84, 150, 14, lv_color_hex(0x0D0F15), 7);   /* cushion */
    N.pip = lv_image_create(N.scene);
    lv_image_set_src(N.pip, &mascot_sleepy);
    lv_image_set_antialias(N.pip, false);                  /* crisp pixel art */
    lv_image_set_inner_align(N.pip, LV_IMAGE_ALIGN_STRETCH);
    lv_obj_set_size(N.pip, 32 * PIP_SCALE, 32 * PIP_SCALE);
    lv_obj_set_pos(N.pip, PIP_X, PIP_Y);
    lv_obj_set_style_image_opa(N.pip, 64, 0);              /* 25%: a silhouette, not a light */

    static const lv_font_t *const zf[N_Z] = {&font_14, &font_20, &font_28};
    for(int i = 0; i < N_Z; i++) {
        N.z[i] = ui_label(N.scene, zf[i], lv_color_hex(0x1F4A55), 0, 0, "Z");   /* the sprite's teal, dimmed */
        lv_obj_set_user_data(N.z[i], (void *)(intptr_t)i);
        z_cb(N.z[i], 250 + i * 250);
    }

    N.clock = ui_label(N.scene, &font_48, lv_color_hex(0x1E2230), 0, 0, "");
    lv_obj_align(N.clock, LV_ALIGN_BOTTOM_MID, 0, -46);
    N.wake = ui_label(N.scene, &font_12, lv_color_hex(0x1E222D), 0, 0, "");
    lv_obj_align(N.wake, LV_ALIGN_BOTTOM_MID, 0, -26);

    lv_obj_add_flag(N.root, LV_OBJ_FLAG_HIDDEN);
}

/* Start or stop the loops; static mode (snapshots) keeps everything still at a pleasant mid-frame. */
void ui_night_show(bool on, bool statik)
{
    bool was_on = !lv_obj_has_flag(N.root, LV_OBJ_FLAG_HIDDEN);
    if(on) lv_obj_remove_flag(N.root, LV_OBJ_FLAG_HIDDEN);
    else lv_obj_add_flag(N.root, LV_OBJ_FLAG_HIDDEN);
    if(on == was_on) return;

    lv_anim_delete(N.pip, NULL);
    for(int i = 0; i < N_Z; i++) lv_anim_delete(N.z[i], NULL);
    for(int i = 0; i < N_STARS; i++) lv_anim_delete(N.stars[i], NULL);
    if(!on || statik) return;

    loop_anim(N.pip, breathe_cb, 0, -3, 2600, 0, true);
    for(int i = 0; i < N_Z; i++) loop_anim(N.z[i], z_cb, 0, 1000, Z_MS, (uint32_t)i * (Z_MS / N_Z), false);
    for(int i = 0, k = 0; i < N_STARS; i++) {
        if(!STARS[i][3]) continue;
        loop_anim(N.stars[i], opa_cb, LV_OPA_COVER, 70, 3000 + (uint32_t)k * 900, (uint32_t)k * 700, true);
        k++;
    }
}

/* "HH:MM" now, and the end of the window ("08:00"). Also nudges the scene every 10 minutes. */
void ui_night_set_time(const char *hhmm, const char *until)
{
    lv_label_set_text(N.clock, hhmm);
    lv_label_set_text_fmt(N.wake, "SLEEP WELL \xC2\xB7 UNTIL %s", until);
    lv_obj_align(N.clock, LV_ALIGN_BOTTOM_MID, 0, -46);
    lv_obj_align(N.wake, LV_ALIGN_BOTTOM_MID, 0, -26);
    int minutes = (hhmm[0] - '0') * 600 + (hhmm[1] - '0') * 60 + (hhmm[3] - '0') * 10 + (hhmm[4] - '0');
    int step = (minutes / 10) % 8;
    if(step != N.shift) {
        N.shift = step;
        lv_obj_set_pos(N.scene, SHIFT[step][0], SHIFT[step][1]);
    }
}
