/* DashboardData mirrors the /api/dashboard JSON (PLAN.md §4.2). Flat, fixed-size, no heap.
 * Numbers that can be null in JSON use DD_NONE. */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define DD_NONE INT32_MIN
#define DD_MAX_MUSCLES 18

typedef enum { DD_MODE_MORNING, DD_MODE_DAY, DD_MODE_EVENING, DD_MODE_NIGHT } dd_mode_t;
typedef enum { DD_GYM_PENDING, DD_GYM_DONE, DD_GYM_SKIPPED, DD_GYM_REST } dd_gym_t;
typedef enum { DD_WEEK_PLANNED, DD_WEEK_DONE, DD_WEEK_REST, DD_WEEK_MISSED, DD_WEEK_SKIPPED, DD_WEEK_TODAY } dd_week_t;
typedef enum { DD_TONE_NUDGE, DD_TONE_HYPE, DD_TONE_CALM, DD_TONE_PROUD } dd_tone_t;

typedef struct {
    char now[32];                 /* ISO with offset, e.g. 2026-10-22T18:10:00+02:00 */
    char updated[32];             /* "" when null */
    bool stale;
    dd_mode_t mode;

    int32_t sleep_min, sleep_avg7, sleep_goal;
    bool has_stages;
    int32_t deep, core, rem, awake;

    int32_t steps, steps_goal;
    int32_t active, active_goal;
    int32_t kcal, kcal_goal, protein, protein_goal;

    bool has_bp;
    int32_t bp_sys, bp_dia, bp_pulse;
    char bp_ts[32];
    uint8_t bp_trend_n;
    int16_t bp_trend[7][2];

    char day_type[24];
    char label[16];
    char muscles[DD_MAX_MUSCLES][16];
    uint8_t muscles_n;
    dd_gym_t gym;
    int32_t done_min;
    int32_t week_done, week_target;

    int32_t score;
    int32_t part_sleep, part_move, part_food, part_gym;   /* DD_NONE = no data ("—") */

    int32_t level, xp, xp_next, streak, best_streak;

    dd_week_t week[7];
    char week_d[7][2];

    char coach[72];
    dd_tone_t tone;
    char mascot[12];

    bool has_celebrate;
    char cel_id[48], cel_title[40], cel_sub[48];
} DashboardData;

/** Parse an /api/dashboard response. Returns false (and leaves *out zeroed) on malformed JSON. */
bool dashboard_parse(const char *json, DashboardData *out);

#ifdef __cplusplus
}
#endif
