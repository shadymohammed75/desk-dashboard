/* LVGL 9 configuration shared by the firmware and the cloud snapshot tool.
 * Only overrides are listed; everything else uses LVGL's defaults (lv_conf_internal.h). */
#ifndef LV_CONF_H
#define LV_CONF_H

#define LV_COLOR_DEPTH 16              /* RGB565 panel */

#define LV_USE_STDLIB_MALLOC  LV_STDLIB_CLIB
#define LV_USE_STDLIB_STRING  LV_STDLIB_CLIB
#define LV_USE_STDLIB_SPRINTF LV_STDLIB_CLIB

#define LV_DEF_REFR_PERIOD 33          /* ~30 fps is plenty for a desk HUD */
#define LV_USE_LOG 0

/* Our own Montserrat builds (tools/fonts) include "—" and "·", which the built-in fonts lack. */
#define LV_FONT_MONTSERRAT_14 0
#define LV_FONT_CUSTOM_DECLARE LV_FONT_DECLARE(font_14)
#define LV_FONT_DEFAULT &font_14

/* Every widget is styled explicitly by the UI; no default theme. */
#define LV_USE_THEME_DEFAULT 0
#define LV_USE_THEME_SIMPLE 0
#define LV_USE_THEME_MONO 0

/* Unused heavy features */
#define LV_USE_THORVG_INTERNAL 0
#define LV_USE_VECTOR_GRAPHIC 0
#define LV_BUILD_EXAMPLES 0
#define LV_BUILD_DEMOS 0
#define LV_USE_ASSERT_NULL 1
#define LV_USE_ASSERT_MALLOC 1

#endif /* LV_CONF_H */
