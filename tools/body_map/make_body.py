#!/usr/bin/env python3
"""Generate tools/body_map/body.svg — an original, stylised front + back body map.

Shapes are drawn once for the figure's left half (viewer's left) and mirrored, as rounded polygons with
small gaps between muscles. Every muscle is one <path id="<muscle_id>"> (both sides as sub-paths), so the
backend, phone app, preview and firmware can all address it by the ids in PLAN.md §4.5.

Layout: front figure in x 0–140, back figure in x 160–300, both y 0–380. No transforms, so consumers can
crop a figure by its x range.

    python3 tools/body_map/make_body.py      # rewrites body.svg here and the phone app's copy
"""
from __future__ import annotations

import math
from pathlib import Path

W, H = 140, 380          # one figure
BACK_X = 160             # x offset of the back figure
CX = W / 2               # figure centre line

Pt = tuple[float, float]


def rounded(points: list[Pt], r: float) -> str:
    """Closed polygon path with every corner rounded by a quadratic curve of radius ~r."""
    n = len(points)
    out = []
    for i in range(n):
        p0, p1, p2 = points[i - 1], points[i], points[(i + 1) % n]
        def toward(a: Pt, b: Pt, d: float) -> Pt:
            L = math.dist(a, b)
            t = min(d, L / 2) / L if L else 0
            return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
        a = toward(p1, p0, r)
        b = toward(p1, p2, r)
        out.append(("M" if i == 0 else "L") + f"{a[0]:.1f},{a[1]:.1f}")
        out.append(f"Q{p1[0]:.1f},{p1[1]:.1f} {b[0]:.1f},{b[1]:.1f}")
    return " ".join(out) + " Z"


def ellipse(cx: float, cy: float, rx: float, ry: float) -> str:
    return (f"M{cx - rx:.1f},{cy:.1f} A{rx},{ry} 0 1,0 {cx + rx:.1f},{cy:.1f} "
            f"A{rx},{ry} 0 1,0 {cx - rx:.1f},{cy:.1f} Z")


def mirror(points: list[Pt]) -> list[Pt]:
    return [(2 * CX - x, y) for x, y in reversed(points)]


def shift(points: list[Pt], dx: float) -> list[Pt]:
    return [(x + dx, y) for x, y in points]


def both(points: list[Pt], r: float, dx: float = 0) -> str:
    """The left shape and its mirror image, as one path."""
    return rounded(shift(points, dx), r) + " " + rounded(shift(mirror(points), dx), r)


def one(points: list[Pt], r: float, dx: float = 0) -> str:
    return rounded(shift(points, dx), r)


# ------------------------------------------------------------------ silhouette (same outline front and back)

TORSO = [(52, 54), (88, 54), (97, 62), (97, 100), (92, 150), (95, 192), (45, 192), (48, 150), (43, 100), (43, 62)]
LIMBS_LEFT = [
    ([(63, 44), (77, 44), (79, 56), (61, 56)], 2),                       # neck (centred, drawn twice: harmless)
    ([(30, 60), (40, 58), (41, 128), (25, 126), (26, 70)], 6),           # upper arm
    ([(25, 130), (41, 132), (36, 186), (24, 184)], 5),                   # forearm
    ([(24, 188), (36, 190), (35, 208), (30, 212), (25, 208)], 4),        # hand
    ([(44, 196), (69, 196), (67, 240), (65, 282), (49, 282), (45, 240)], 6),  # thigh
    ([(48, 286), (66, 286), (63, 352), (52, 352)], 5),                   # shin
    ([(51, 355), (63, 355), (64, 368), (46, 370), (47, 362)], 3),        # foot
]


def silhouette(dx: float) -> str:
    parts = [ellipse(CX + dx, 27, 14, 18), one(TORSO, 6, dx)]
    neck, *limbs = LIMBS_LEFT
    parts.append(one(neck[0], neck[1], dx))
    parts += [both(p, r, dx) for p, r in limbs]
    return " ".join(parts)


# ------------------------------------------------------------------ muscles

FRONT = {
    "side_delts":   both([(28, 64), (37, 60), (39, 80), (29, 84)], 4),
    "front_delts":  both([(40, 60), (50, 59), (48, 76), (42, 80)], 4),
    "chest":        both([(52, 62), (68, 62), (68, 93), (53, 92), (49, 78)], 5),
    "biceps":       both([(28, 89), (40, 85), (39, 122), (28, 123)], 5),
    "forearms":     both([(27, 134), (39, 136), (35, 180), (27, 178)], 4),
    "obliques":     both([(47, 99), (57, 101), (57, 150), (50, 160), (46, 130)], 4),
    "abs":          " ".join(
        rounded([(x0, y0), (x0 + 9, y0), (x0 + 9, y0 + h), (x0, y0 + h)], 3)
        for y0, h in ((99, 17), (119, 17), (139, 17), (159, 19))
        for x0 in (60, 71)
    ),
    "quads":        both([(47, 200), (67, 200), (64, 272), (56, 278), (49, 272)], 5),
    "calves_front": both([(51, 292), (63, 292), (61, 340), (54, 344)], 4),
}

BACK = {
    "traps":        one([(62, 46), (78, 46), (92, 62), (80, 80), (70, 100), (60, 80), (48, 62)], 4, BACK_X),
    "rear_delts":   both([(29, 63), (44, 60), (46, 76), (36, 82), (29, 80)], 4, BACK_X),
    "upper_back":   both([(48, 67), (56, 78), (64, 100), (51, 102), (46, 84)], 3, BACK_X),
    "triceps":      both([(28, 88), (41, 84), (40, 124), (28, 124)], 5, BACK_X),
    "lats":         both([(45, 106), (62, 108), (64, 136), (55, 150), (48, 140), (44, 120)], 4, BACK_X),
    "lower_back":   one([(57, 154), (83, 154), (86, 186), (54, 186)], 5, BACK_X),
    "glutes":       both([(47, 192), (68, 192), (68, 222), (58, 228), (48, 222)], 6, BACK_X),
    "hamstrings":   both([(48, 232), (66, 232), (64, 276), (57, 280), (50, 276)], 5, BACK_X),
    "calves":       both([(50, 290), (64, 290), (63, 326), (57, 336), (51, 326)], 5, BACK_X),
}


def build() -> str:
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        "<!-- Original stylised body map for Desk Health Dashboard. Generated by make_body.py — edit that, not this. -->",
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {BACK_X + W} {H}" width="{BACK_X + W}" height="{H}">',
        "  <style>",
        "    .silhouette { fill: #11131A; stroke: #4A5063; stroke-width: 1.2; }",
        "    .muscle { fill: #1E2230; stroke: #2A3042; stroke-width: 0.8; }",
        "  </style>",
        '  <g id="front" data-x="0" data-width="140">',
        f'    <path id="silhouette_front" class="silhouette" d="{silhouette(0)}"/>',
    ]
    lines += [f'    <path id="{k}" class="muscle" data-view="front" d="{d}"/>' for k, d in FRONT.items()]
    lines += [
        "  </g>",
        f'  <g id="back" data-x="{BACK_X}" data-width="{W}">',
        f'    <path id="silhouette_back" class="silhouette" d="{silhouette(BACK_X)}"/>',
    ]
    lines += [f'    <path id="{k}" class="muscle" data-view="back" d="{d}"/>' for k, d in BACK.items()]
    lines += ["  </g>", "</svg>", ""]
    return "\n".join(lines)


# The phone app serves its own copy; keep both identical (a backend test checks this).
APP_COPY = Path(__file__).resolve().parents[2] / "backend" / "public" / "app" / "body.svg"

if __name__ == "__main__":
    svg = build()
    for out in (Path(__file__).with_name("body.svg"), APP_COPY):
        out.write_text(svg)
        print(f"wrote {out} ({len(FRONT)} front + {len(BACK)} back muscles)")
