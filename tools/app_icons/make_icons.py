#!/usr/bin/env python3
"""Render the Gym Log app icons (original art: the score-ring motif with a bolt) into backend/public/app/icons/.

Needs cairosvg:  pip install cairosvg   then   python3 tools/app_icons/make_icons.py
"""
import math
from pathlib import Path

import cairosvg

OUT = Path(__file__).resolve().parents[2] / "backend" / "public" / "app" / "icons"


def arc(cx, cy, r, a0, a1):
    p = lambda a: (cx + r * math.cos(math.radians(a - 90)), cy + r * math.sin(math.radians(a - 90)))
    (x0, y0), (x1, y1) = p(a0), p(a1)
    return f"M{x0:.1f},{y0:.1f} A{r},{r} 0 {1 if a1 - a0 > 180 else 0},1 {x1:.1f},{y1:.1f}"


def icon_svg(rounded: bool) -> str:
    colors = ["#22D3EE", "#FF6A1A", "#FFC53D", "#3DFF8F"]
    fill = [1.0, 0.85, 0.7, 1.0]
    segs = []
    for i, (c, f) in enumerate(zip(colors, fill)):
        a0 = i * 90 + 7
        segs.append(f'<path d="{arc(256, 256, 150, a0, a0 + 76)}" stroke="#1E2230" stroke-width="44" fill="none" stroke-linecap="round"/>')
        segs.append(f'<path d="{arc(256, 256, 150, a0, a0 + 76 * f)}" stroke="{c}" stroke-width="44" fill="none" stroke-linecap="round"/>')
    bg = '<rect width="512" height="512" rx="112" fill="#07080C"/>' if rounded else '<rect width="512" height="512" fill="#07080C"/>'
    bolt = '<path d="M276 150 L196 276 H248 L232 362 L316 228 H262 Z" fill="#FF6A1A"/>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">{bg}{"".join(segs)}{bolt}</svg>'


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    full = icon_svg(rounded=False).encode()   # iOS/Android apply their own mask
    for name, size in (("icon-512.png", 512), ("icon-192.png", 192), ("apple-touch-icon.png", 180)):
        cairosvg.svg2png(bytestring=full, write_to=str(OUT / name), output_width=size, output_height=size)
        print("wrote", OUT / name)
