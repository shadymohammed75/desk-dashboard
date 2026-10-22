/* Desk screen UI ("Training HUD"). Pure LVGL 9: no Arduino includes, so the same code runs on the
 * ESP32-S3 and in the cloud snapshot tool (tools/snapshot). */
#pragma once

#include "lvgl.h"
#include "dashboard_data.h"

#ifdef __cplusplus
extern "C" {
#endif

/** Build all widgets on `disp`'s active screen. Call once. */
void ui_init(lv_display_t *disp);

/** Show new data. Animates only what changed (score sweep, done sweep, coach fade, celebration). */
void ui_update(const DashboardData *d);

/** Device-side overrides: live clock text (e.g. "THU 22 OCT · 18:10") and fetch failures. */
void ui_set_clock(const char *text);
void ui_set_offline(bool offline);

/** Snapshot mode: no looping animations (breathing, pulsing); everything rests at full strength. */
void ui_set_static(bool on);

/** Celebration ids already shown. The firmware can persist them (NVS) through these hooks. */
typedef bool (*ui_seen_fn)(const char *id);
typedef void (*ui_mark_fn)(const char *id);
void ui_set_celebration_store(ui_seen_fn seen, ui_mark_fn mark);

/** True while the full-screen celebration is on screen. */
bool ui_celebrating(void);

/** Large buffers (the 800×480 background) go through this; firmware points it at PSRAM. */
#ifndef UI_LARGE_ALLOC
#define UI_LARGE_ALLOC(size) lv_malloc(size)
#endif

#ifdef __cplusplus
}
#endif
