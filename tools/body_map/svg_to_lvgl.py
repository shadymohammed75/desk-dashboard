#!/usr/bin/env python3
"""Convert tools/body_map/body.svg into LVGL 9 assets for the desk screen.

For each figure (front, back) it renders:
  - the silhouette fill and the silhouette outline as two A8 masks (full figure size),
  - every muscle as an A8 alpha mask cropped to its bounding box, with its x/y offset in the figure,
  - a soft pre-blurred glow mask per muscle (live LVGL shadows are too slow on the ESP32-S3).
A8 masks are tinted at runtime with the style's image_recolor, so one mask serves every state
(orange pending, lime done, grey skipped, cyan rest).

Emits firmware/ui/assets/body_assets.c/.h with a table {id, img, glow, x, y, view}.

    pip install cairosvg pillow
    python3 tools/body_map/svg_to_lvgl.py [--scale 0.64]
"""
from __future__ import annotations

import argparse
import io
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import cairosvg
from PIL import Image, ImageFilter

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from lvgl_c import GENERATED, image_c  # noqa: E402

SVG_NS = "{http://www.w3.org/2000/svg}"
FIG_W, FIG_H = 140, 380
VIEWS = {"front": 0, "back": 160}
OUTLINE_WIDTH = 2.0  # SVG units; ~1.3 px at the default scale
GLOW_PAD = 7         # px of soft glow around each muscle
GLOW_BLUR = 3.5


def render_alpha(path_d: str, view_x: int, scale: float, *, stroke: bool = False) -> Image.Image:
    """Render one path of a figure to an 8-bit alpha image of the whole figure."""
    paint = (f'fill="none" stroke="#fff" stroke-width="{OUTLINE_WIDTH}" stroke-linejoin="round"' if stroke
             else 'fill="#fff"')
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_x} 0 {FIG_W} {FIG_H}" '
           f'width="{FIG_W * scale:.0f}" height="{FIG_H * scale:.0f}"><path d="{path_d}" {paint}/></svg>')
    png = cairosvg.svg2png(bytestring=svg.encode())
    return Image.open(io.BytesIO(png)).convert("RGBA").getchannel("A")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scale", type=float, default=0.64, help="pixels per SVG unit (default 0.64 → 90×243 per figure)")
    ap.add_argument("--svg", type=Path, default=HERE / "body.svg")
    ap.add_argument("--out", type=Path, default=ROOT / "firmware" / "ui" / "assets")
    args = ap.parse_args()

    tree = ET.parse(args.svg)
    paths = {p.get("id"): p for p in tree.iter(f"{SVG_NS}path")}
    fig_w, fig_h = round(FIG_W * args.scale), round(FIG_H * args.scale)

    c_parts: list[str] = []
    table: list[str] = []
    total = 0
    for view, vx in VIEWS.items():
        sil = paths[f"silhouette_{view}"].get("d")
        for kind, stroke in (("fill", False), ("line", True)):
            img = render_alpha(sil, vx, args.scale, stroke=stroke)
            name = f"body_sil_{view}_{kind}"
            c_parts.append(image_c(name, img.width, img.height, "A8", img.tobytes()))
            total += img.width * img.height
        for pid, p in paths.items():
            if p.get("data-view") != view:
                continue
            alpha = render_alpha(p.get("d"), vx, args.scale)
            box = alpha.getbbox()
            if not box:
                raise SystemExit(f"{pid}: renders empty at scale {args.scale}")
            crop = alpha.crop(box)
            name = f"body_img_{pid}"
            c_parts.append(image_c(name, crop.width, crop.height, "A8", crop.tobytes()))
            padded = Image.new("L", (crop.width + 2 * GLOW_PAD, crop.height + 2 * GLOW_PAD), 0)
            padded.paste(crop, (GLOW_PAD, GLOW_PAD))
            glow = padded.filter(ImageFilter.GaussianBlur(GLOW_BLUR))
            c_parts.append(image_c(f"body_glow_{pid}", glow.width, glow.height, "A8", glow.tobytes()))
            table.append(f'    {{ "{pid}", &{name}, &body_glow_{pid}, {box[0]}, {box[1]}, BODY_VIEW_{view.upper()} }},')
            total += crop.width * crop.height + glow.width * glow.height

    args.out.mkdir(parents=True, exist_ok=True)
    header = f"""{GENERATED.format(tool="tools/body_map/svg_to_lvgl.py")}#pragma once

#include "lvgl.h"

#ifdef __cplusplus
extern "C" {{
#endif

#define BODY_FIG_W {fig_w}
#define BODY_FIG_H {fig_h}
#define BODY_GLOW_PAD {GLOW_PAD}   /* glow image = muscle image grown by this on every side */

typedef enum {{ BODY_VIEW_FRONT = 0, BODY_VIEW_BACK = 1 }} body_view_t;

typedef struct {{
    const char *id;              /* muscle id from PLAN.md §4.5 */
    const lv_image_dsc_t *img;   /* A8 mask, tint with image_recolor */
    const lv_image_dsc_t *glow;  /* A8 soft glow, drawn at (x, y) - BODY_GLOW_PAD */
    int16_t x, y;                /* offset inside the figure */
    body_view_t view;
}} body_part_t;

extern const lv_image_dsc_t body_sil_front_fill, body_sil_front_line, body_sil_back_fill, body_sil_back_line;
extern const body_part_t body_parts[];
extern const uint32_t body_parts_count;

#ifdef __cplusplus
}}
#endif
"""
    source = (GENERATED.format(tool="tools/body_map/svg_to_lvgl.py")
              + '#include "body_assets.h"\n\n'
              + "".join(c_parts)
              + "const body_part_t body_parts[] = {\n" + "\n".join(table) + "\n};\n"
              + "const uint32_t body_parts_count = sizeof(body_parts) / sizeof(body_parts[0]);\n")
    (args.out / "body_assets.h").write_text(header)
    (args.out / "body_assets.c").write_text(source)
    print(f"figure {fig_w}×{fig_h} px, {len(table)} muscles, {total / 1024:.1f} KiB of pixel data → {args.out}")


if __name__ == "__main__":
    main()
