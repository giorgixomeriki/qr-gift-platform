"""Proposal: correct the AI-misspelled Georgian in the hero image.

Each fix: erase the garbled line from the paper (dark ink only, so the
note's faint ruled lines survive where possible), then set the correct text
in the site's own Georgian face (Google Sans Georgian, SIL OFL) on the same
baseline angle, colour and softness as the original lettering.

Usage: python3 fix_georgian.py source.png font.woff2 out.png
"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

src_p, font_p, out_p = sys.argv[1:4]
im = Image.open(src_p).convert("RGB")
A = np.asarray(im).astype(np.float32)

# (polygon to clean, text, left-baseline point, angle deg (y down => +ccw visually negative), x-height px, ink rgb, weight)
FIXES = [
    # hanging card, line 1 and 2
    dict(poly=[(372, 905), (548, 878), (553, 914), (377, 942)], text="შენი მილოცვა", base=(377, 931), angle=-8.7, size=10.0, ink=(62, 52, 50), weight=500),
    dict(poly=[(404, 937), (512, 920), (516, 950), (408, 966)], text="გელოდება", base=(410, 953), angle=-8.5, size=10.0, ink=(62, 52, 50), weight=500),
    # phone note, line 1 and 2
    dict(poly=[(960, 548), (1178, 576), (1174, 606), (956, 578)], text="ყველა ჩვეულებრივი", base=(965, 571), angle=7.4, size=9.6, ink=(78, 68, 66), weight=420),
    dict(poly=[(955, 580), (1176, 608), (1174, 642), (951, 610)], text="დღე შენთან ერთად", base=(961, 601), angle=6.9, size=9.6, ink=(78, 68, 66), weight=420),
    # phone note, line 3 (the original reads roughly "უ?რო ლაშაშია."); the heart is kept
    dict(poly=[(948, 609), (1108, 631), (1108, 667), (946, 649)], text="უფრო ლამაზია", tail=".", base=(957, 632), angle=7.1, size=9.3, ink=(78, 68, 66), weight=420),
]


def erase(A, poly):
    """Remove dark ink inside poly; fill from surrounding paper with
    normalized convolution, then restore the paper's grain."""
    H, W = A.shape[:2]
    pm = Image.new("L", (W, H), 0)
    ImageDraw.Draw(pm).polygon(poly, fill=255)
    region = np.asarray(pm) > 0
    L = A @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    paper = ndi.median_filter(np.where(region, L, np.nan_to_num(L)), size=15)
    ink = region & (L < paper - 9)
    ink = ndi.binary_dilation(ink, iterations=3) & ndi.binary_dilation(region, iterations=2)
    known = (~ink).astype(np.float32)
    out = A.copy()
    for c in range(3):
        num = ndi.gaussian_filter(A[..., c] * known, 6)
        den = ndi.gaussian_filter(known, 6)
        fill = num / np.maximum(den, 1e-3)
        out[..., c] = np.where(ink, fill, A[..., c])
    rng = np.random.default_rng(7)
    grain = ndi.gaussian_filter(rng.normal(0, 2.2, (H, W)), 0.6)[..., None]
    out = np.where(ink[..., None], out + grain, out)
    return out


def set_text(A, f):
    """Set f["text"] with its x-height (height of "ა") equal to f["size"]
    source px, baseline from f["base"], rotated by f["angle"] degrees."""
    S = 4  # supersample
    probe = ImageFont.truetype(font_p, size=100)
    xb = probe.getbbox("ა", anchor="ls")
    em = f["size"] * S * 100 / (-xb[1])
    font = ImageFont.truetype(font_p, size=int(round(em)))
    font.set_variation_by_axes([f["weight"]])
    tw = int(font.getlength(f["text"] + f.get("tail", ""))) + 40
    side = 2 * tw + 200
    c = side // 2
    layer = Image.new("L", (side, side), 0)
    draw = ImageDraw.Draw(layer)
    draw.text((c, c), f["text"], font=font, fill=255, anchor="ls")
    if f.get("tail"):  # punctuation from the Latin cut of the same family
        latin = ImageFont.truetype(font_p.replace("georgian", "latin"), size=int(round(em)))
        latin.set_variation_by_axes([f["weight"]])
        draw.text((c + font.getlength(f["text"]), c), f["tail"], font=latin, fill=255, anchor="ls")
    layer = layer.rotate(-f["angle"], resample=Image.BICUBIC, center=(c, c))
    small = layer.resize((side // S, side // S), Image.LANCZOS)
    a = ndi.gaussian_filter(np.asarray(small).astype(np.float32), 0.4)[..., None] / 255 * 0.94
    x0 = int(round(f["base"][0] - c / S)); y0 = int(round(f["base"][1] - c / S))
    H, W = A.shape[:2]
    hh, ww = a.shape[:2]
    ys, xs = slice(max(0, y0), min(H, y0 + hh)), slice(max(0, x0), min(W, x0 + ww))
    sub = a[ys.start - y0: ys.stop - y0, xs.start - x0: xs.stop - x0]
    ink = np.array(f["ink"], np.float32)
    A[ys, xs] = A[ys, xs] * (1 - sub) + ink * sub
    return A


# The note's faint ruled line under the first message line, measured from the
# original (y = 571.7 + 0.172 (x - 945), x 963-1170, about 11 levels darker
# than the paper, ~1.5 px wide). The erase removes it where the old glyphs
# crossed it, so it is redrawn whole, under the new text.
RULES = [
    dict(y0=571.7, x_ref=945, slope=0.172, x_from=963, x_to=1170, depth=11.0, sigma=0.75),
    dict(y0=637.75, x_ref=945, slope=0.172, x_from=947, x_to=1183, depth=7.0, sigma=0.75),
]


def draw_rule(A, r):
    """Draw the ruled line only where it is missing: each pixel is darkened
    to the line's measured profile against the paper beside it, never
    darker than it already is, so surviving stretches are not doubled."""
    for x in range(r["x_from"], r["x_to"] + 1):
        yc = r["y0"] + r["slope"] * (x - r["x_ref"])
        end = min(1.0, (x - r["x_from"] + 1) / 4, (r["x_to"] - x + 1) / 4)  # soft ends
        yi = int(round(yc))
        paper = np.median(np.concatenate([A[yi - 6:yi - 3, x], A[yi + 4:yi + 7, x]]), axis=0)
        paper_l = float(paper @ np.array([0.2126, 0.7152, 0.0722]))
        for y in range(yi - 3, yi + 4):
            g = np.exp(-0.5 * ((y - yc) / r["sigma"]) ** 2)
            target = paper * (1 - g * end * r["depth"] / max(paper_l, 1))
            A[y, x] = np.minimum(A[y, x], target)
    return A


for f in FIXES:
    A = erase(A, f["poly"])
for r in RULES:
    A = draw_rule(A, r)
for f in FIXES:
    A = set_text(A, f)
Image.fromarray(A.clip(0, 255).astype(np.uint8)).save(out_p)
print("ok")
