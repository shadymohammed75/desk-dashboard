/* "Training HUD" design tokens (PLAN.md §5.1). */
#pragma once

#include "lvgl.h"

#define C_BG          lv_color_hex(0x07080C)
#define C_PANEL       lv_color_hex(0x11131A)
#define C_PANEL_2     lv_color_hex(0x171A23)
#define C_BORDER      lv_color_hex(0x1E2230)
#define C_MUSCLE      lv_color_hex(0x232836)   /* untrained muscle */
#define C_MUSCLE_LINE lv_color_hex(0x343B4D)
#define C_BODY_PART   lv_color_hex(0x191C25)   /* head, hands, feet… */
#define C_TEAL        lv_color_hex(0x2DD4BF)   /* rest days */
#define C_PRIMARY     lv_color_hex(0xFF6A1A)   /* today's target, CTAs, score ring */
#define C_CYAN        lv_color_hex(0x22D3EE)   /* sleep, recovery */
#define C_LIME        lv_color_hex(0x3DFF8F)   /* done, goals hit */
#define C_GOLD        lv_color_hex(0xFFC53D)   /* XP, level, streak */
#define C_VIOLET      lv_color_hex(0x8B7CFF)   /* REM, accents */
#define C_AMBER       lv_color_hex(0xFFB020)   /* stale data / warnings only */
#define C_DEEP        lv_color_hex(0x3B5BDB)   /* deep sleep */
#define C_TEXT        lv_color_hex(0xF4F5F8)
#define C_TEXT_DIM    lv_color_hex(0x8A90A2)
#define C_TEXT_FAINT  lv_color_hex(0x4A5063)
#define C_INK         lv_color_hex(0x160800)   /* text on bright pills */

#define SCREEN_W 800
#define SCREEN_H 480
#define HUD_H    48
#define COACH_H  40
#define LEFT_W   500
#define RADIUS   14
