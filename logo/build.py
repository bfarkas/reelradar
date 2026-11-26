"""Builds the ReelRadar master SVGs (symbol, small cut, wordmark, lockups) from exact geometry.
Run with a Python that has fontTools: python build.py /path/to/Inter-ExtraBold.ttf"""
import sys
from math import hypot, sqrt
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

OUT = Path(__file__).parent / "masters"
OUT.mkdir(exist_ok=True)
INK, CORAL, CORAL_DEEP, PAPER = "#0D3438", "#FF6A3D", "#E8521F", "#FFFFFF"  # Teal & Orange

# --- Symbol: rounded play triangle cut by radar arcs centred at (CX, 128) ---
L, T, B, X, CX, RC = 64, 40, 216, 216, 4, 16  # RC = corner rounding along each edge


def f(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


def along(p, q, d):  # point d units from p towards q
    n = hypot(q[0] - p[0], q[1] - p[1])
    return (p[0] + (q[0] - p[0]) * d / n, p[1] + (q[1] - p[1]) * d / n)


def hit(r):  # circle r around (CX,128) meets the upper edge (L,T)->(X,128)
    dx, dy, ox, oy = X - L, 128 - T, L - CX, T - 128
    a, b, c = dx * dx + dy * dy, 2 * (ox * dx + oy * dy), ox * ox + oy * oy - r * r
    t = (-b + sqrt(b * b - 4 * a * c)) / (2 * a)
    assert RC / 175.6 < t < 1 - RC / 175.6, "arc must cut the straight part of the edge"
    return (L + dx * t, T + dy * t)


def low(p):
    return (p[0], 256 - p[1])


def pt(p):
    return f"{f(p[0])} {f(p[1])}"


def symbol_path(gaps):
    """gaps: list of (r_inner, r_outer) white bands, ordered left to right."""
    tl, tip, bl = (L, T), (X, 128), (L, B)
    d = []
    # left piece: both rounded left corners, closed by the first gap's inner arc
    r = gaps[0][0]
    h = hit(r)
    d.append(f"M{pt(along(tl, bl, RC))}Q{pt(tl)} {pt(along(tl, tip, RC))}L{pt(h)}"
             f"A{r} {r} 0 0 1 {pt(low(h))}L{pt(along(bl, tip, RC))}Q{pt(bl)} {pt(along(bl, tl, RC))}Z")
    # middle bands
    for (_, r0), (r1, _) in zip(gaps, gaps[1:]):
        a, b = hit(r0), hit(r1)
        d.append(f"M{pt(a)}L{pt(b)}A{r1} {r1} 0 0 1 {pt(low(b))}L{pt(low(a))}A{r0} {r0} 0 0 0 {pt(a)}Z")
    # tip piece with rounded tip
    r = gaps[-1][1]
    h = hit(r)
    d.append(f"M{pt(h)}L{pt(along(tip, tl, RC))}Q{pt(tip)} {pt(along(tip, bl, RC))}"
             f"L{pt(low(h))}A{r} {r} 0 0 0 {pt(h)}Z")
    return "".join(d)


SYMBOL = symbol_path([(124, 140), (162, 178)])
SMALL = symbol_path([(134, 156)])  # small-size cut: one wider gap, for 16-32 px


def svg(w, h, body, title="ReelRadar logo"):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(w)} {f(h)}" width="{f(w)}" height="{f(h)}">'
            f"<title>{title}</title>{body}</svg>\n")


# --- Wordmark: Inter ExtraBold (SIL OFL) converted to outlines ---
font = TTFont(sys.argv[1])
gs, cmap, hmtx = font.getGlyphSet(), font.getBestCmap(), font["hmtx"]
UPM, CAP = font["head"].unitsPerEm, font["OS/2"].sCapHeight
TRACK = -0.02 * UPM  # slight negative tracking at display size


def wordmark(text, cap_px):
    s = cap_px / CAP
    x, parts = 0.0, []
    for ch in text:
        g = cmap[ord(ch)]
        pen = SVGPathPen(gs)
        gs[g].draw(TransformPen(pen, (s, 0, 0, -s, x * s, 0)))  # y-up font -> y-down svg, baseline at 0
        parts.append(pen.getCommands())
        x += hmtx[g][0] + TRACK
    return "".join(parts), (x - TRACK) * s


# Horizontal lockup: symbol 256 tall; cap height = 0.5 of symbol height, centred on the symbol's centre line
CAP_H = 88
wm, wm_w = wordmark("ReelRadar", CAP_H)
GAP = 56  # space between symbol and wordmark = width of the left piece's flat-to-arc depth, roughly
sym_bbox = (L, T, X, B)
base_y = 128 + CAP_H / 2


def lockup_h(sym_fill, word_fill):
    x0 = X + GAP
    w = x0 + wm_w + L  # right margin mirrors the symbol's left margin
    return svg(w, 256, f'<path fill="{sym_fill}" d="{SYMBOL}"/>'
                       f'<g transform="translate({f(x0)} {f(base_y)})"><path fill="{word_fill}" d="{wm}"/></g>')


def lockup_stacked(sym_fill, word_fill):
    cap = 64
    wm2, w2 = wordmark("ReelRadar", cap)
    w = max(w2 + 80, 256)
    sx = (w - 256) / 2 + 128 - (L + X) / 2 + 128 - 128  # centre the symbol's bbox
    sx = w / 2 - (L + X) / 2
    by = B + 48 + cap
    return svg(w, by + 40, f'<g transform="translate({f(sx)} 0)"><path fill="{sym_fill}" d="{SYMBOL}"/></g>'
                           f'<g transform="translate({f((w - w2) / 2)} {f(by)})"><path fill="{word_fill}" d="{wm2}"/></g>')


files = {
    "reelradar-symbol.svg": svg(256, 256, f'<path fill="{INK}" d="{SYMBOL}"/>'),
    "reelradar-symbol-coral.svg": svg(256, 256, f'<path fill="{CORAL}" d="{SYMBOL}"/>'),
    "reelradar-symbol-small.svg": svg(256, 256, f'<path fill="{INK}" d="{SMALL}"/>'),
    "reelradar-symbol-small-coral.svg": svg(256, 256, f'<path fill="{CORAL}" d="{SMALL}"/>'),
    "reelradar-horizontal.svg": lockup_h(INK, INK),
    "reelradar-horizontal-accent.svg": lockup_h(CORAL_DEEP, INK),
    "reelradar-horizontal-on-dark.svg": lockup_h(CORAL, PAPER),
    "reelradar-stacked.svg": lockup_stacked(INK, INK),
    "reelradar-stacked-on-dark.svg": lockup_stacked(CORAL, PAPER),
    "reelradar-wordmark.svg": svg(wm_w, CAP_H * 1.12, f'<g transform="translate(0 {CAP_H * 1.1})"><path fill="{INK}" d="{wm}"/></g>'),
}
for name, data in files.items():
    (OUT / name).write_text(data)
    print("wrote", OUT / name)
