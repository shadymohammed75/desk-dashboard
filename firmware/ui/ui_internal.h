/* Shared between the ui_*.c files; not part of the public API. */
#pragma once

#include "lvgl.h"

lv_obj_t *ui_box(lv_obj_t *parent, int32_t x, int32_t y, int32_t w, int32_t h);
lv_obj_t *ui_rect(lv_obj_t *parent, int32_t x, int32_t y, int32_t w, int32_t h, lv_color_t c, int32_t radius);
lv_obj_t *ui_label(lv_obj_t *parent, const lv_font_t *font, lv_color_t color, int32_t x, int32_t y, const char *text);
lv_obj_t *ui_mask(lv_obj_t *parent, const lv_image_dsc_t *src, lv_color_t color, int32_t x, int32_t y);
void ui_anim(void *var, lv_anim_exec_xcb_t cb, int32_t from, int32_t to, uint32_t ms, uint32_t delay, bool loop);

/* ui_bg.c */
void ui_background(lv_obj_t *scr);

/* ui_celebrate.c */
void ui_celebrate(const char *title, const char *sub, bool statik);
bool ui_celebration_seen(const char *id);
void ui_celebration_mark(const char *id);
