#!/usr/bin/env python3
"""Convert tools/body_map/body.svg into LVGL 9 assets for the desk screen.

body.svg is generated from react-native-body-highlighter (MIT, see CREDITS.md) by make_body.mjs. Each figure is a
<g id="front|back" data-x data-y data-width data-height>; muscles are <path class="muscle" data-ids="…">, the rest
of the body is <path class="part">. For each figure this renders:
  - the whole body's fill and its outlines as two A8 masks (tinted #232836 / #343B4D at runtime),
  - every muscle path as an A8 mask cropped to its bounding box, plus a soft pre-blurred glow mask.
A8 masks are tinted with the style's image_recolor, so one mask serves every state and split colour.

Emits firmware/ui/assets/body_assets.c/.h with a table {ids, img, glow, x, y, view}.

    pip install cairosvg pillow
    python3 tools/body_map/svg_to_lvgl.py [--height 243]
"""
from __future__ import annotations

import argparse
import io
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import cairosvg
from PIL import Image, ImageFilter

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from lvgl_c import GENERATED, image_c  # noqa: E402

NS = "{http://www.w3.org/2000/svg}"
GLOW_PAD = 7         # px of soft glow around each muscle
GLOW_BLUR = 3.5
OUTLINE_PX = 1.0     # outline width on screen


def render(paths: list[str], box: tuple[float, float, float, float], size: tuple[int, int], *, stroke_units: float = 0) -> Image.Image:
    """Render paths (fill, or outline only when stroke_units > 0) into an 8-bit alpha image of the figure box."""
    x, y, w, h = box
    paint = (f'fill="none" stroke="#fff" stroke-width="{stroke_units:.2f}" stroke-linejoin="round"' if stroke_units
             else 'fill="#fff"')
    body = "".join(f'<path d="{d}" {paint}/>' for d in paths)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x} {y} {w} {h}" width="{size[0]}" height="{size[1]}">'
           f'{body}</svg>')
    return Image.open(io.BytesIO(cairosvg.svg2png(bytestring=svg.encode()))).convert("RGBA").getchannel("A")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--height", type=int, default=243, help="figure height in pixels (default 243)")
    ap.add_argument("--svg", type=Path, default=HERE / "body.svg")
    ap.add_argument("--out", type=Path, default=ROOT / "firmware" / "ui" / "assets")
    args = ap.parse_args()

    root = ET.parse(args.svg).getroot()
    c_parts: list[str] = []
    table: list[str] = []
    total = 0
    fig_w = fig_h = 0
    for view_index, view in enumerate(("front", "back")):
        g = root.find(f".//{NS}g[@id='{view}']")
        box = tuple(float(g.get(k)) for k in ("data-x", "data-y", "data-width", "data-height"))
        scale = args.height / box[3]
        size = (round(box[2] * scale), args.height)
        fig_w, fig_h = size
        paths = list(g.iter(f"{NS}path"))
        everything = [p.get("d") for p in paths]

        for kind, img in (("fill", render(everything, box, size)),
                          ("line", render(everything, box, size, stroke_units=OUTLINE_PX / scale))):
            c_parts.append(image_c(f"body_sil_{view}_{kind}", img.width, img.height, "A8", img.tobytes()))
            total += img.width * img.height

        for i, p in enumerate(q for q in paths if q.get("class") == "muscle" and q.get("data-ids")):
            alpha = render([p.get("d")], box, size)
            bb = alpha.getbbox()
            if not bb:
                continue
            crop = alpha.crop(bb)
            name = f"body_{view}_{i}"
            c_parts.append(image_c(f"{name}_img", crop.width, crop.height, "A8", crop.tobytes()))
            padded = Image.new("L", (crop.width + 2 * GLOW_PAD, crop.height + 2 * GLOW_PAD), 0)
            padded.paste(crop, (GLOW_PAD, GLOW_PAD))
            glow = padded.filter(ImageFilter.GaussianBlur(GLOW_BLUR))
            c_parts.append(image_c(f"{name}_glow", glow.width, glow.height, "A8", glow.tobytes()))
            table.append(f'    {{ "{p.get("data-ids")}", &{name}_img, &{name}_glow, {bb[0]}, {bb[1]}, '
                         f'BODY_VIEW_{view.upper()} }},   /* {p.get("data-slug")} */')
            total += crop.width * crop.height + glow.width * glow.height

    tool = "tools/body_map/svg_to_lvgl.py"
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "body_assets.h").write_text(f"""{GENERATED.format(tool=tool)}/* Body polygons: react-native-body-highlighter (MIT), see CREDITS.md. */
#pragma once

#include "lvgl.h"

#ifdef __cplusplus
extern "C" {{
#endif

#define BODY_FIG_W {fig_w}
#define BODY_FIG_H {fig_h}
#define BODY_GLOW_PAD {GLOW_PAD}   /* glow image = muscle image grown by this on every side */
#define BODY_MAX_PARTS 40

typedef enum {{ BODY_VIEW_FRONT = 0, BODY_VIEW_BACK = 1 }} body_view_t;

typedef struct {{
    const char *ids;             /* space-separated muscle ids (PLAN.md §4.5) this polygon group lights for */
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
""")
    (args.out / "body_assets.c").write_text(
        GENERATED.format(tool=tool) + '#include "body_assets.h"\n\n' + "".join(c_parts)
        + "const body_part_t body_parts[] = {\n" + "\n".join(table) + "\n};\n"
        + "const uint32_t body_parts_count = sizeof(body_parts) / sizeof(body_parts[0]);\n")
    print(f"figure {fig_w}×{fig_h} px, {len(table)} muscle groups, {total / 1024:.1f} KiB of pixel data → {args.out}")


if __name__ == "__main__":
    main()
