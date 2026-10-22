/* Full-screen celebration (PLAN.md §5.1): dark overlay, gold title, subtitle, ~34 confetti rectangles,
 * 3 seconds, then everything is deleted. Each celebration id plays once. */
#include <string.h>

#include "ui.h"
#include "theme.h"
#include "fonts/fonts.h"
#include "assets/hud_assets.h"
#include "ui_internal.h"

#define CELEBRATE_MS 3000
#define CONFETTI 34
#define SEEN_MAX 8

static lv_obj_t *overlay;
static char seen_ids[SEEN_MAX][48];
static uint8_t seen_next;
static uint32_t rng = 0x2545F491;   /* deterministic, so snapshots are reproducible */

static uint32_t rnd(uint32_t n)
{
    rng = rng * 1664525u + 1013904223u;
    return (rng >> 8) % n;
}

bool ui_celebration_seen(const char *id)
{
    for(int i = 0; i < SEEN_MAX; i++) if(!strcmp(seen_ids[i], id)) return true;
    return false;
}

void ui_celebration_mark(const char *id)
{
    strncpy(seen_ids[seen_next], id, sizeof seen_ids[0] - 1);
    seen_next = (seen_next + 1) % SEEN_MAX;
}

bool ui_celebrating(void) { return overlay != NULL; }

static void y_cb(void *o, int32_t v) { lv_obj_set_y(o, v); }
static void x_cb(void *o, int32_t v) { lv_obj_set_x(o, v); }
/* Two callbacks on purpose: lv_anim_start() replaces a running animation with the same var + callback. */
static void fade_in_cb(void *o, int32_t v) { lv_obj_set_style_opa(o, (lv_opa_t)v, 0); }
static void fade_out_cb(void *o, int32_t v) { lv_obj_set_style_opa(o, (lv_opa_t)v, 0); }

static void finish(lv_timer_t *t)
{
    lv_timer_delete(t);
    if(overlay) lv_obj_delete(overlay);
    overlay = NULL;
}

void ui_celebrate(const char *title, const char *sub, bool statik)
{
    if(overlay) lv_obj_delete(overlay);
    overlay = ui_rect(lv_layer_top(), 0, 0, SCREEN_W, SCREEN_H, lv_color_hex(0x000000), 0);
    lv_obj_set_style_bg_opa(overlay, 225, 0);   /* ~88%: the HUD only hints through */

    lv_obj_t *glow = ui_mask(overlay, &glow_banner, C_GOLD, (SCREEN_W - glow_banner.header.w) / 2, 150);
    lv_obj_set_style_image_opa(glow, LV_OPA_30, 0);

    lv_obj_t *box = ui_box(overlay, 0, 160, SCREEN_W, 130);
    lv_obj_t *t = ui_label(box, &font_48, C_GOLD, 0, 18, title);
    lv_obj_set_width(t, SCREEN_W);
    lv_obj_set_style_text_align(t, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_letter_space(t, 2, 0);
    lv_obj_t *s = ui_label(box, &font_20, C_LIME, 0, 80, sub);
    lv_obj_set_width(s, SCREEN_W);
    lv_obj_set_style_text_align(s, LV_TEXT_ALIGN_CENTER, 0);

    lv_color_t colors[4] = {C_PRIMARY, C_LIME, C_GOLD, C_CYAN};
    for(int i = 0; i < CONFETTI; i++) {
        int32_t x = (int32_t)rnd(SCREEN_W - 8);
        bool tall = rnd(2);
        lv_obj_t *c = ui_rect(overlay, x, -16, tall ? 6 : 10, tall ? 12 : 6, colors[i % 4], 1);
        uint32_t delay = rnd(900);
        uint32_t dur = 1400 + rnd(900);
        if(statik) {   /* snapshot of the peak: scatter them mid-fall */
            lv_obj_set_y(c, (int32_t)rnd(SCREEN_H - 20));
            continue;
        }
        ui_anim(c, y_cb, -16, SCREEN_H + 10, dur, delay, false);
        ui_anim(c, x_cb, x, x + (int32_t)rnd(120) - 60, dur, delay, false);
    }
    if(!statik) {
        ui_anim(overlay, fade_in_cb, 0, 255, 200, 0, false);
        ui_anim(overlay, fade_out_cb, 255, 0, 300, CELEBRATE_MS - 300, false);
        lv_timer_create(finish, CELEBRATE_MS, NULL);
    }
}
