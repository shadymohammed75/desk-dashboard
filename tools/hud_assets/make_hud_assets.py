#!/usr/bin/env python3
"""Generate the desk screen's small assets as LVGL 9 A8 masks (tinted at runtime with image_recolor):

  - icons: an original line-icon set (moon, steps, flame, fuel, heart, bolt, trophy, check, x)
  - glows: a soft ring glow behind the score ring and a banner glow for celebrations
    (pre-rendered, because live LVGL shadows are expensive on the ESP32-S3)

    pip install cairosvg pillow   then   python3 tools/hud_assets/make_hud_assets.py
Output: firmware/ui/assets/hud_assets.c/.h and tools/hud_assets/out/sheet.png (preview).
"""
from __future__ import annotations

import io
import sys
from pathlib import Path

import cairosvg
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from lvgl_c import GENERATED, image_c  # noqa: E402

# 24×24 line icons, stroke = white. Drawn for this project (same family as the phone app's icons).
ICONS = {
    "moon": '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>',
    "steps": '<path d="M7 4c2 0 3 2 3 4.5S9 13 7.5 13 5 11 5 8.5 5.5 4 7 4z"/><path d="M5.6 15.5h3.8"/>'
             '<path d="M16.5 8c1.5 0 2.5 2 2.5 4.5S18 17 16.5 17 14 15 14 12.5 15 8 16.5 8z"/><path d="M14.6 19.5h3.8"/>',
    "flame": '<path d="M12 21c-3.9 0-6-2.6-6-5.6 0-3.6 3-5.4 3.6-8.4 2.4 1.2 3.4 3.4 3.2 5.2 1-.6 1.7-1.8 1.8-3 '
             '1.8 1.6 3.4 3.6 3.4 6.2 0 3-2.1 5.6-6 5.6z"/>',
    "fuel": '<path d="M7 3v7a2 2 0 0 0 4 0V3M9 10v11"/><path d="M17 21V3c-2 1.5-3 4-3 7v3h3"/>',
    "heart": '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    "bolt": '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
    "trophy": '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/>'
              '<path d="M12 13v4M8.5 20h7M10 17h4"/>',
    "check": '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    "x": '<path d="M7 7l10 10M17 7L7 17"/>',
}
SIZES = {"moon": [14, 20], "steps": [20], "flame": [20, 28], "fuel": [20], "heart": [16], "bolt": [20],
         "trophy": [16], "check": [14, 18], "x": [14]}


def icon_alpha(name: str, size: int) -> Image.Image:
    stroke = 2.4 if size <= 16 else 2.1
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="{size}" height="{size}" fill="none" '
           f'stroke="#fff" stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round">{ICONS[name]}</svg>')
    png = cairosvg.svg2png(bytestring=svg.encode())
    return Image.open(io.BytesIO(png)).convert("RGBA").getchannel("A")


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
    for name, sizes in SIZES.items():
        for s in sizes:
            assets[f"icon_{name}_{s}"] = icon_alpha(name, s)
    assets["glow_ring"] = ring_glow()
    assets["glow_banner"] = banner_glow()

    tool = "tools/hud_assets/make_hud_assets.py"
    src = GENERATED.format(tool=tool) + '#include "hud_assets.h"\n\n'
    src += "".join(image_c(n, im.width, im.height, "A8", im.tobytes()) for n, im in assets.items())
    hdr = (GENERATED.format(tool=tool) + '#pragma once\n\n#include "lvgl.h"\n\n#ifdef __cplusplus\nextern "C" {\n#endif\n\n'
           + "".join(f"extern const lv_image_dsc_t {n};   /* {im.width}x{im.height} A8 */\n" for n, im in assets.items())
           + '\n#ifdef __cplusplus\n}\n#endif\n')
    (out / "hud_assets.c").write_text(src)
    (out / "hud_assets.h").write_text(hdr)

    # preview sheet
    icons = [im for n, im in assets.items() if n.startswith("icon_")]
    sheet = Image.new("RGB", (sum(i.width + 12 for i in icons) + 12, 40), (7, 8, 12))
    x = 12
    for im in icons:
        sheet.paste(Image.new("RGB", im.size, (255, 106, 26)), (x, 20 - im.height // 2), im)
        x += im.width + 12
    sheet.resize((sheet.width * 3, sheet.height * 3), Image.NEAREST).save(HERE / "out" / "sheet.png")
    total = sum(im.width * im.height for im in assets.values())
    print(f"{len(assets)} assets, {total / 1024:.1f} KiB → {out}")


if __name__ == "__main__":
    main()
