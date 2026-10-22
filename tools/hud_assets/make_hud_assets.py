#!/usr/bin/env python3
"""Generate the desk screen's small assets as LVGL 9 A8 masks (tinted at runtime with image_recolor):

  - icons: Material Symbols Rounded (fill), Apache-2.0 — the same SVGs as the phone app (tools/icons/svg, made by
    `npm run icons`); see CREDITS.md
  - glows: a soft ring glow behind the score ring and a banner glow for celebrations, plus a steam wisp for the
    rest-day hot tub (original; pre-rendered, because live LVGL shadows are expensive on the ESP32-S3)

    pip install cairosvg pillow   then   python3 tools/hud_assets/make_hud_assets.py
Output: firmware/ui/assets/hud_assets.c/.h (incl. icon_for(name, size)) and tools/hud_assets/out/sheet.png.
"""
from __future__ import annotations

import io
import re
import sys
from pathlib import Path

import cairosvg
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from lvgl_c import GENERATED, image_c  # noqa: E402

ICON_DIR = ROOT / "tools" / "icons" / "svg"
SPLIT_ICONS = ["fitness_center", "rowing", "directions_run", "hot_tub", "bedtime"]
SIZES: dict[str, list[int]] = {
    **{n: [14, 28] for n in SPLIT_ICONS},          # week dots, title
    "hot_tub": [14, 20, 28, 120], "bedtime": [14, 20, 28, 120],   # + pill, rest-day hero
    "directions_walk": [20], "nutrition": [20], "local_fire_department": [20], "favorite": [16],
    "trophy": [16], "check": [14, 18], "close": [14], "bolt": [20],
    "ecg_heart": [16], "spo2": [16],
}


def icon_alpha(name: str, size: int) -> Image.Image:
    svg = (ICON_DIR / f"{name}.svg").read_text()
    svg = re.sub(r'width="\d+" height="\d+"', f'width="{size}" height="{size}"', svg, count=1)
    svg = svg.replace("<path ", '<path fill="#fff" ')
    return Image.open(io.BytesIO(cairosvg.svg2png(bytestring=svg.encode()))).convert("RGBA").getchannel("A")


def steam_wisp(w: int = 14, h: int = 44) -> Image.Image:
    img = Image.new("L", (w, h), 0)
    ImageDraw.Draw(img).rounded_rectangle((4, 4, w - 4, h - 4), radius=4, fill=170)
    grad = Image.linear_gradient("L").resize((w, h))          # fade towards the top
    return Image.composite(img, Image.new("L", (w, h), 0), grad).filter(ImageFilter.GaussianBlur(2.2))


def ring_glow(size: int = 232, ring_d: int = 180, width: int = 16, blur: int = 9) -> Image.Image:
    img = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(img)
    o = (size - ring_d) // 2
    d.ellipse((o, o, o + ring_d, o + ring_d), outline=200, width=width)
    return img.filter(ImageFilter.GaussianBlur(blur))


def banner_glow(w: int = 640, h: int = 140, blur: int = 22) -> Image.Image:
    img = Image.new("L", (w, h), 0)
    ImageDraw.Draw(img).rounded_rectangle((60, 45, w - 60, h - 45), radius=25, fill=170)
    return img.filter(ImageFilter.GaussianBlur(blur))


def main() -> None:
    out = ROOT / "firmware" / "ui" / "assets"
    out.mkdir(parents=True, exist_ok=True)
    (HERE / "out").mkdir(exist_ok=True)
    assets: dict[str, Image.Image] = {}
    icons: list[tuple[str, int, str]] = []
    for name, sizes in SIZES.items():
        for size in sorted(set(sizes)):
            var = f"icon_{name}_{size}"
            assets[var] = icon_alpha(name, size)
            icons.append((name, size, var))
    assets["glow_ring"] = ring_glow()
    assets["glow_banner"] = banner_glow()
    assets["steam_wisp"] = steam_wisp()

    tool = "tools/hud_assets/make_hud_assets.py"
    src = GENERATED.format(tool=tool) + "/* Icons: Material Symbols Rounded (fill), Apache-2.0 — see CREDITS.md. */\n"
    src += '#include "hud_assets.h"\n#include <string.h>\n\n'
    src += "".join(image_c(n, im.width, im.height, "A8", im.tobytes()) for n, im in assets.items())
    src += "const lv_image_dsc_t *icon_for(const char *name, int size)\n{\n"
    src += "    static const struct { const char *name; int size; const lv_image_dsc_t *img; } T[] = {\n"
    src += "".join(f'        {{ "{n}", {sz}, &{v} }},\n' for n, sz, v in icons)
    src += "    };\n    const lv_image_dsc_t *fallback = NULL;\n"
    src += "    for(unsigned i = 0; i < sizeof T / sizeof T[0]; i++) {\n"
    src += "        if(name && strcmp(T[i].name, name) == 0 && T[i].size == size) return T[i].img;\n"
    src += '        if(!fallback && strcmp(T[i].name, "fitness_center") == 0 && T[i].size == size) fallback = T[i].img;\n'
    src += "    }\n    return fallback ? fallback : &icon_check_14;\n}\n"
    hdr = (GENERATED.format(tool=tool) + '#pragma once\n\n#include "lvgl.h"\n\n#ifdef __cplusplus\nextern "C" {\n#endif\n\n'
           + "".join(f"extern const lv_image_dsc_t {n};   /* {im.width}x{im.height} A8 */\n" for n, im in assets.items())
           + "\n/** Material Symbols icon by name (as sent by the API) and pixel size; unknown names fall back to\n"
           + " *  fitness_center at that size. */\nconst lv_image_dsc_t *icon_for(const char *name, int size);\n"
           + '\n#ifdef __cplusplus\n}\n#endif\n')
    (out / "hud_assets.c").write_text(src)
    (out / "hud_assets.h").write_text(hdr)

    small = [im for n, im in assets.items() if n.startswith("icon_") and im.width <= 28]
    sheet = Image.new("RGB", (sum(i.width + 12 for i in small) + 12, 44), (7, 8, 12))
    x = 12
    for im in small:
        sheet.paste(Image.new("RGB", im.size, (255, 106, 26)), (x, 22 - im.height // 2), im)
        x += im.width + 12
    sheet.resize((sheet.width * 2, sheet.height * 2), Image.NEAREST).save(HERE / "out" / "sheet.png")
    total = sum(im.width * im.height for im in assets.values())
    print(f"{len(assets)} assets ({len(icons)} icons), {total / 1024:.1f} KiB → {out}")


if __name__ == "__main__":
    main()
