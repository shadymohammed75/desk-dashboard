/* Render the desk screen UI (firmware/ui, unchanged) for one mock JSON into PNGs, on Linux.
 *
 *   snapshot <mock.json> <out.png>                    final frame (animations settled, no celebration)
 *   snapshot <mock.json> <out.png> --celebrate        the celebration overlay at its peak
 *   snapshot <mock.json> <out-prefix> --frames NAME   6 frames of one animation: <out-prefix>_<NAME>_<i>.png
 *        NAME: score | breathe | done | dot | coach | celebrate | pill | night
 *
 * Time is simulated (custom tick), so output is deterministic and fast. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "lvgl.h"
#include "ui.h"
#include "dashboard_data.h"

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "stb_image_write.h"

#define W 800
#define H 480

static uint32_t sim_ms;
static uint16_t fb[W * H];
static lv_display_t *disp;

static uint32_t tick_cb(void) { return sim_ms; }

static void flush_cb(lv_display_t *d, const lv_area_t *a, uint8_t *px)
{
    const uint16_t *src = (const uint16_t *)px;
    int32_t w = lv_area_get_width(a);
    for(int32_t y = a->y1; y <= a->y2; y++) {
        memcpy(&fb[y * W + a->x1], src, (size_t)w * 2);
        src += w;
    }
    lv_display_flush_ready(d);
}

/* Run LVGL for `ms` of simulated time in 5 ms steps. */
static void advance(uint32_t ms)
{
    uint32_t end = sim_ms + ms;
    while(sim_ms < end) {
        sim_ms += 5;
        lv_timer_handler();
    }
}

static int write_png(const char *path)
{
    lv_obj_invalidate(lv_screen_active());
    lv_refr_now(disp);
    static uint8_t rgb[W * H * 3];
    for(int i = 0; i < W * H; i++) {
        uint16_t c = fb[i];
        uint8_t r = (c >> 11) & 0x1F, g = (c >> 5) & 0x3F, b = c & 0x1F;
        rgb[i * 3 + 0] = (uint8_t)((r << 3) | (r >> 2));
        rgb[i * 3 + 1] = (uint8_t)((g << 2) | (g >> 4));
        rgb[i * 3 + 2] = (uint8_t)((b << 3) | (b >> 2));
    }
    if(!stbi_write_png(path, W, H, 3, rgb, W * 3)) {
        fprintf(stderr, "cannot write %s\n", path);
        return 1;
    }
    printf("  %s\n", path);
    return 0;
}

static char *read_file(const char *path)
{
    FILE *f = fopen(path, "rb");
    if(!f) return NULL;
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *buf = malloc((size_t)n + 1);
    if(fread(buf, 1, (size_t)n, f) != (size_t)n) { fclose(f); free(buf); return NULL; }
    buf[n] = '\0';
    fclose(f);
    return buf;
}

static int frames(DashboardData *d, const char *prefix, const char *name)
{
    uint32_t dur;
    DashboardData before = *d;
    bool need_before = true;

    if(!strcmp(name, "score")) { before.score = 0; dur = 600; }
    else if(!strcmp(name, "done")) { before.gym = DD_GYM_PENDING; d->gym = DD_GYM_DONE; dur = 560; }
    else if(!strcmp(name, "coach")) { snprintf(before.coach, sizeof before.coach, "..."); dur = 400; }
    else if(!strcmp(name, "breathe")) { d->gym = DD_GYM_PENDING; dur = 2400; need_before = false; }
    else if(!strcmp(name, "dot")) { d->mode = DD_MODE_DAY; dur = 1600; need_before = false; }
    else if(!strcmp(name, "pill")) { d->gym = DD_GYM_PENDING; d->mode = DD_MODE_EVENING; dur = 1000; need_before = false; }
    else if(!strcmp(name, "night")) { dur = 6600; need_before = false; }
    else if(!strcmp(name, "celebrate")) {
        if(!d->has_celebrate) { fprintf(stderr, "mock has no celebrate event\n"); return 1; }
        dur = 2900;
        need_before = false;
    }
    else { fprintf(stderr, "unknown animation %s\n", name); return 2; }

    if(need_before) {
        before.has_celebrate = false;
        ui_set_static(true);
        ui_update(&before);
        advance(50);
    }
    ui_set_static(false);
    if(strcmp(name, "celebrate") != 0) d->has_celebrate = false;
    ui_update(d);
    if(!strcmp(name, "night")) ui_set_night(true, "02:40");
    for(int i = 0; i < 6; i++) {
        char path[512];
        snprintf(path, sizeof path, "%s_%s_%d.png", prefix, name, i);
        if(write_png(path)) return 1;
        advance(dur / 5);
    }
    return 0;
}

int main(int argc, char **argv)
{
    if(argc < 3) {
        fprintf(stderr, "usage: %s <mock.json> <out.png|prefix> [--celebrate | --frames NAME]\n", argv[0]);
        return 2;
    }
    char *json = read_file(argv[1]);
    DashboardData d;
    if(!json || !dashboard_parse(json, &d)) {
        fprintf(stderr, "cannot parse %s\n", argv[1]);
        return 1;
    }
    free(json);

    lv_init();
    lv_tick_set_cb(tick_cb);
    disp = lv_display_create(W, H);
    static uint16_t buf[W * 60];
    lv_display_set_buffers(disp, buf, NULL, sizeof buf, LV_DISPLAY_RENDER_MODE_PARTIAL);
    lv_display_set_flush_cb(disp, flush_cb);
    ui_init(disp);

    if(argc >= 5 && !strcmp(argv[3], "--frames")) return frames(&d, argv[2], argv[4]);

    bool celebrate = argc >= 4 && !strcmp(argv[3], "--celebrate");
    if(!celebrate) d.has_celebrate = false;   /* final frame = after the celebration has played */
    ui_set_static(true);
    ui_update(&d);
    /* the device decides from its clock; here the mock's "now" stands in for it */
    char hhmm[6];
    snprintf(hhmm, sizeof hhmm, "%.5s", d.now + 11);
    int minute = (hhmm[0] - '0') * 600 + (hhmm[1] - '0') * 60 + (hhmm[3] - '0') * 10 + (hhmm[4] - '0');
    ui_set_night(dd_in_window(minute, d.night_from, d.night_to), hhmm);
    advance(100);
    return write_png(argv[2]);
}
