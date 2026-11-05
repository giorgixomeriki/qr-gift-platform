"""Cut the approved hero scene out of its photographed background.

- Subject alpha: Apple Vision foreground mask (lift.swift), lightly
  tightened so no wall/table fringe survives at the edge, with edge colours
  decontaminated toward the subject's own colour.
- Shadow: taken from the photograph itself. Where the table around the
  subject is darker than the lit table nearby, that darkening becomes a
  translucent warm-brown shadow layer, limited to a band around the subject
  so the window-light pattern further out is dropped.
- Frame cuts: the subject runs off the source's right and bottom edges; the
  right one is placed against the viewport edge in CSS, the bottom one gets a
  short fade into the shadow (FADE_BOTTOM px).

Usage: python3 cutout.py source.png mask.png out.png [preview_bg_hex]
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

src_p, mask_p, out_p = sys.argv[1:4]
bg_hex = sys.argv[4] if len(sys.argv) > 4 else "F7F1E8"
FADE_BOTTOM = 70
SHADOW_BAND = 70.0  # px falloff of the photographed shadow away from the subject
SHADOW_MAX = 0.42

src = np.asarray(Image.open(src_p).convert("RGB")).astype(np.float32) / 255
m = np.asarray(Image.open(mask_p).convert("L")).astype(np.float32) / 255
H, W = m.shape

# 1. Tighten the soft edge a touch (remove background fringe) and smooth it.
m = np.clip((m - 0.18) / 0.82, 0, 1)
m = ndi.gaussian_filter(m, 0.6)

# 2. Decontaminate edge colours: pull partially transparent pixels toward
#    the colour of nearby solid subject pixels.
solid = m > 0.97
idx = ndi.distance_transform_edt(~solid, return_distances=False, return_indices=True)
inner = src[idx[0], idx[1]]
w = np.clip((0.97 - m) / 0.97, 0, 1)[..., None] * 0.65
rgb = src * (1 - w) + inner * w

# 3. Shadow. Only where the subject sits above (the table it rests on), not
#    around its sides or top: (a) the photograph's own darkening of the table
#    in a tight band under the subject, plus (b) a soft occlusion shadow
#    built from the subject's silhouette, dropped slightly downward.
L = src @ np.array([0.2126, 0.7152, 0.0722], np.float32)
bgmask = m < 0.02
Lbg = np.where(bgmask, L, 0)
ref = ndi.gaussian_filter(ndi.maximum_filter(Lbg, size=91), 25)
dark = np.clip((ref - L) / np.maximum(ref, 1e-3), 0, 1)
solidm = (m > 0.5).astype(np.float32)
below = np.zeros_like(m)
for k in range(0, 90, 6):  # is there subject within 90 px above this pixel?
    sh = np.zeros_like(m); sh[k:] = solidm[:H - k] if k else solidm
    below = np.maximum(below, sh * (1 - k / 90))
dist = ndi.distance_transform_edt(m < 0.5)
photo_sh = np.clip(dark * 1.4, 0, 1) * np.exp(-dist / 22.0) * below * bgmask
drop = np.zeros_like(m); drop[12:] = solidm[:-12]
occl = ndi.gaussian_filter(drop, 16) * below
shadow = np.clip(0.55 * ndi.gaussian_filter(photo_sh, 2) + 0.30 * occl, 0, SHADOW_MAX) * (1 - solidm)

# 4. Short fade where the ribbon is cut by the source's bottom edge.
fade = np.ones((H, 1), np.float32)
ramp = np.linspace(1, 0, FADE_BOTTOM, dtype=np.float32) ** 1.6
fade[H - FADE_BOTTOM:, 0] = ramp
# and the one eucalyptus tip cut by the top edge
fade_top = np.ones((H, 1), np.float32)
fade_top[:24, 0] = np.linspace(0, 1, 24, dtype=np.float32)
m = m * fade * fade_top
shadow = shadow * fade

# 5. Composite subject over shadow into one RGBA layer.
shade_rgb = np.array([0.24, 0.14, 0.11], np.float32)
a = m + shadow * (1 - m)
col = (rgb * m[..., None] + shade_rgb * (shadow * (1 - m))[..., None]) / np.maximum(a, 1e-4)[..., None]
out = np.dstack([np.clip(col, 0, 1), np.clip(a, 0, 1)])
Image.fromarray((out * 255 + 0.5).astype(np.uint8)).save(out_p)

bg = tuple(int(bg_hex[i:i + 2], 16) for i in (0, 2, 4))
prev = Image.new("RGBA", (W, H), bg + (255,))
prev.alpha_composite(Image.open(out_p))
prev.convert("RGB").save(out_p.replace(".png", "-on-ivory.jpg"), quality=90)
print("ok", W, H, "subject", float((m > 0.5).mean()), "shadow max", float(shadow.max()))
