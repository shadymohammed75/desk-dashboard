/* The 800×480 background: near-black, a faint 24 px dot grid and one soft orange glow behind the body map.
 * Rendered once into a canvas at boot, so it costs no CPU afterwards (PLAN.md §5.1). */
#include "ui.h"
#include "theme.h"
#include "ui_internal.h"

#define GLOW_X 650
#define GLOW_Y 250
#define GLOW_R 230

/* 4×4 ordered dither, so the faint glow doesn't show RGB565 bands as visible rings. */
static const uint8_t BAYER[4][4] = {{0, 8, 2, 10}, {12, 4, 14, 6}, {3, 11, 1, 9}, {15, 7, 13, 5}};

static inline uint32_t dither(uint32_t v, uint32_t step, uint32_t b)
{
    v += b * step / 16;
    return v > 255 ? 255 : v;
}

static inline uint16_t rgb565(uint32_t r, uint32_t g, uint32_t b, int32_t x, int32_t y)
{
    uint32_t t = BAYER[y & 3][x & 3];
    r = dither(r, 8, t);
    g = dither(g, 4, t);
    b = dither(b, 8, t);
    return (uint16_t)(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3));
}

void ui_background(lv_obj_t *scr)
{
    uint16_t *buf = UI_LARGE_ALLOC(SCREEN_W * SCREEN_H * 2);
    if(!buf) return;   /* plain screen colour still works */
    const uint32_t br = 0x07, bg = 0x08, bb = 0x0C;          /* C_BG */
    for(int32_t y = 0; y < SCREEN_H; y++) {
        for(int32_t x = 0; x < SCREEN_W; x++) {
            uint32_t r = br, g = bg, b = bb;
            int32_t dx = x - GLOW_X, dy = y - GLOW_Y;
            int32_t d2 = dx * dx + dy * dy;
            if(d2 < GLOW_R * GLOW_R) {
                /* quadratic falloff, peak ~9% of #FF6A1A */
                int32_t t = 256 - d2 * 256 / (GLOW_R * GLOW_R);
                int32_t a = t * t / 256 * 23 / 256;
                r += (0xFF - r) * a / 256;
                g += (0x6A - g) * a / 256;
                b += (0x1A - b) * a / 256;
            }
            if(x % 24 == 12 && y % 24 == 12) {                /* dot grid: white at ~4% (a bit more to survive RGB565) */
                r += (0xFF - r) * 14 / 256;
                g += (0xFF - g) * 14 / 256;
                b += (0xFF - b) * 14 / 256;
            }
            buf[y * SCREEN_W + x] = rgb565(r, g, b, x, y);
        }
    }
    lv_obj_t *canvas = lv_canvas_create(scr);
    lv_canvas_set_buffer(canvas, buf, SCREEN_W, SCREEN_H, LV_COLOR_FORMAT_RGB565);
    lv_obj_set_pos(canvas, 0, 0);
}
