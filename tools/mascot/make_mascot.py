#!/usr/bin/env python3
"""Draw "Pip", the dashboard mascot: an original 32×32 pixel creature in five moods.

Pip is a little orange energy bean with a spark antenna. Moods (PLAN.md §4.3b):
  sleepy  closed eyes, drooping antenna, floating "z"
  chill   sunglasses, easy smile
  pumped  determined brows, open grin, fists up
  proud   happy closed eyes, arms up, sparkles
  tired   heavy lids, sweat drop, dimmer colours

Outputs (one source for every client):
  tools/mascot/out/<mood>.png            32×32 RGBA
  tools/mascot/out/sheet.png             8× preview of all moods
  backend/public/app/mascot/<mood>.png   copy for the phone app
  firmware/ui/assets/mascot_assets.c/.h  LVGL 9 ARGB8888 images

    pip install pillow   then   python3 tools/mascot/make_mascot.py
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from lvgl_c import GENERATED, image_c  # noqa: E402

MOODS = ["sleepy", "chill", "pumped", "proud", "tired"]
S = 32

# palette
OUTLINE = (42, 18, 6, 255)
BODY = (255, 106, 26, 255)
SHADE = (201, 74, 14, 255)
LIGHT = (255, 160, 100, 255)
WHITE = (244, 245, 248, 255)
BLACK = (14, 10, 12, 255)
GOLD = (255, 197, 61, 255)
LIME = (61, 255, 143, 255)
CYAN = (34, 211, 238, 255)
CHEEK = (255, 120, 120, 255)
TIRED_BODY = (214, 96, 40, 255)
TIRED_SHADE = (168, 70, 28, 255)


class Canvas:
    def __init__(self) -> None:
        self.img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    def px(self, x: int, y: int, c) -> None:
        if 0 <= x < S and 0 <= y < S:
            self.img.putpixel((x, y), c)

    def pts(self, points, c) -> None:
        for x, y in points:
            self.px(x, y, c)

    def rect(self, x0: int, y0: int, x1: int, y1: int, c) -> None:
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.px(x, y, c)


def inside(x: int, y: int, cx=15.5, cy=18.0, rx=10.5, ry=9.5) -> bool:
    return ((x + 0.5 - cx - 0.5) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1.0


def body(c: Canvas, mood: str) -> None:
    base, shade = (TIRED_BODY, TIRED_SHADE) if mood in ("tired", "sleepy") else (BODY, SHADE)
    for y in range(S):
        for x in range(S):
            if inside(x, y):
                edge = not all(inside(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
                if edge:
                    c.px(x, y, OUTLINE)
                elif (x - 15.5) * 0.6 + (y - 18) > 5:   # lower-right shading
                    c.px(x, y, shade)
                else:
                    c.px(x, y, base)
    c.rect(9, 12, 10, 13, LIGHT)                      # highlight
    c.px(11, 11, LIGHT)
    # feet
    c.rect(10, 27, 13, 28, OUTLINE)
    c.rect(18, 27, 21, 28, OUTLINE)
    c.rect(11, 27, 12, 27, shade)
    c.rect(19, 27, 20, 27, shade)


def antenna(c: Canvas, mood: str) -> None:
    if mood == "sleepy":                              # drooping to the side
        c.pts([(16, 8), (17, 7), (18, 6), (19, 6)], OUTLINE)
        c.pts([(20, 6), (20, 7), (21, 7)], SHADE)
        return
    c.pts([(16, 8), (16, 7), (16, 6)], OUTLINE)
    spark = GOLD if mood != "tired" else (180, 140, 60, 255)
    c.pts([(17, 2), (16, 3), (15, 4), (16, 4), (17, 4), (16, 5)], spark)   # tiny bolt


def zed(c: Canvas, x: int, y: int, n: int) -> None:
    """An n×n letter Z."""
    for i in range(n):
        c.px(x + i, y, CYAN)
        c.px(x + i, y + n - 1, CYAN)
        c.px(x + n - 1 - i, y + i, CYAN)


def face(c: Canvas, mood: str) -> None:
    L, R = 11, 19   # left x of each eye
    ey = 16
    if mood == "sleepy":
        c.rect(L, ey + 1, L + 2, ey + 1, OUTLINE)
        c.rect(R, ey + 1, R + 2, ey + 1, OUTLINE)
        c.pts([(15, 21), (16, 21), (15, 22), (16, 22)], OUTLINE)            # little "o"
        zed(c, 22, 6, 5)                                                     # big Z
        zed(c, 27, 1, 4)                                                     # small z
    elif mood == "chill":
        c.rect(L - 1, ey, R + 3, ey, BLACK)                                   # sunglasses bar
        c.rect(L - 1, ey + 1, L + 3, ey + 2, BLACK)
        c.rect(R - 1, ey + 1, R + 3, ey + 2, BLACK)
        c.px(L, ey + 1, (90, 100, 130, 255))                                  # lens glint
        c.px(R, ey + 1, (90, 100, 130, 255))
        c.pts([(13, 21), (14, 22), (15, 22), (16, 22), (17, 22), (18, 21)], OUTLINE)       # easy smile
    elif mood == "pumped":
        for x0 in (L, R):
            c.rect(x0, ey, x0 + 2, ey + 2, WHITE)
            c.rect(x0 + 1, ey + 1, x0 + 1, ey + 2, BLACK)
        c.pts([(L - 1, ey - 3), (L, ey - 2), (L + 1, ey - 2), (L + 2, ey - 1)], OUTLINE)   # brows slant in
        c.pts([(R + 3, ey - 3), (R + 2, ey - 2), (R + 1, ey - 2), (R, ey - 1)], OUTLINE)
        c.rect(13, 21, 18, 21, OUTLINE)                                      # open grin
        c.rect(13, 22, 18, 22, WHITE)
        c.pts([(14, 23), (15, 23), (16, 23), (17, 23)], OUTLINE)
        # fists up
        for (ax, fx) in ((5, 3), (26, 27)):
            c.pts([(ax, 18), (ax, 17), (ax, 16), (ax, 15)], OUTLINE)
            c.rect(min(ax, fx), 12, min(ax, fx) + 2, 14, BODY)
            c.pts([(min(ax, fx), 11), (min(ax, fx) + 1, 11), (min(ax, fx) + 2, 11)], OUTLINE)
    elif mood == "proud":
        for x0 in (L, R):                                                    # ^ ^
            c.pts([(x0, ey + 1), (x0 + 1, ey), (x0 + 2, ey + 1)], OUTLINE)
        c.pts([(12, 21), (13, 22), (14, 23), (15, 23), (16, 23), (17, 23), (18, 22), (19, 21)], OUTLINE)
        c.rect(14, 22, 17, 22, CHEEK)                                        # tongue of joy
        c.px(9, 19, CHEEK); c.px(22, 19, CHEEK)
        c.pts([(5, 16), (4, 15), (3, 14), (3, 13)], OUTLINE)                 # arms up (V)
        c.pts([(26, 16), (27, 15), (28, 14), (28, 13)], OUTLINE)
        for sx, sy, col in ((3, 6, GOLD), (27, 7, GOLD), (25, 2, LIME), (6, 2, LIME)):     # sparkles
            c.pts([(sx, sy), (sx - 1, sy), (sx + 1, sy), (sx, sy - 1), (sx, sy + 1)], col)
    elif mood == "tired":
        for x0 in (L, R):
            c.rect(x0, ey, x0 + 2, ey, OUTLINE)                              # heavy lid
            c.rect(x0, ey + 1, x0 + 2, ey + 1, WHITE)
            c.px(x0 + 1, ey + 1, BLACK)
        c.pts([(13, 22), (14, 21), (15, 22), (16, 21), (17, 22), (18, 21)], OUTLINE)       # wavy mouth
        c.pts([(24, 9), (24, 10), (23, 11), (24, 11), (23, 12), (24, 12), (25, 12), (24, 13)], CYAN)  # sweat drop
        c.px(25, 11, WHITE)


def draw(mood: str) -> Image.Image:
    c = Canvas()
    antenna(c, mood)
    body(c, mood)
    face(c, mood)
    return c.img


def argb8888_bytes(img: Image.Image) -> bytes:
    """LVGL's lv_color32_t is stored as B, G, R, A."""
    rgba = img.tobytes()
    out = bytearray(len(rgba))
    out[0::4], out[1::4], out[2::4], out[3::4] = rgba[2::4], rgba[1::4], rgba[0::4], rgba[3::4]
    return bytes(out)


def main() -> None:
    out_dir = HERE / "out"
    app_dir = ROOT / "backend" / "public" / "app" / "mascot"
    fw_dir = ROOT / "firmware" / "ui" / "assets"
    for d in (out_dir, app_dir, fw_dir):
        d.mkdir(parents=True, exist_ok=True)

    imgs = {m: draw(m) for m in MOODS}
    sheet = Image.new("RGBA", (len(MOODS) * (S + 4) * 8, (S + 4) * 8), (7, 8, 12, 255))
    for i, (m, img) in enumerate(imgs.items()):
        img.save(out_dir / f"{m}.png")
        img.save(app_dir / f"{m}.png")
        sheet.alpha_composite(img.resize((S * 8, S * 8), Image.NEAREST), (i * (S + 4) * 8 + 16, 16))
    sheet.save(out_dir / "sheet.png")

    tool = "tools/mascot/make_mascot.py"
    src = GENERATED.format(tool=tool) + '#include "mascot_assets.h"\n\n'
    src += "".join(image_c(f"mascot_{m}", S, S, "ARGB8888", argb8888_bytes(img)) for m, img in imgs.items())
    src += "const lv_image_dsc_t *mascot_for(const char *mood)\n{\n"
    for m in MOODS:
        src += f'    if(mood && strcmp(mood, "{m}") == 0) return &mascot_{m};\n'
    src += "    return &mascot_chill;\n}\n"
    (fw_dir / "mascot_assets.c").write_text(src.replace('#include "mascot_assets.h"\n', '#include "mascot_assets.h"\n#include <string.h>\n', 1))
    (fw_dir / "mascot_assets.h").write_text(
        GENERATED.format(tool=tool) + "#pragma once\n\n#include \"lvgl.h\"\n\n#ifdef __cplusplus\nextern \"C\" {\n#endif\n\n"
        + "".join(f"extern const lv_image_dsc_t mascot_{m};\n" for m in MOODS)
        + "\n/** Image for a `mascot` value from /api/dashboard; unknown moods fall back to chill. */\n"
        + "const lv_image_dsc_t *mascot_for(const char *mood);\n\n#ifdef __cplusplus\n}\n#endif\n")
    print(f"wrote {len(MOODS)} moods → {out_dir}, {app_dir}, {fw_dir}")


if __name__ == "__main__":
    main()
