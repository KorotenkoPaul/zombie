# Bake tileable bark detail maps for treedress.js from a photo of oak bark (generated with Fal).
#   python3 pipeline/bark_maps.py src.png game/barkN.jpg game/barkH.jpg [size]
# barkN: tangent-space normal map (furrows vertical).  barkH: R = height (ridges light), G = cavity AO, B = fine albedo detail.
# Seamless: the image is blended with a half-offset copy of itself, with the seam of each hidden under the other.
import sys
import numpy as np
from PIL import Image, ImageFilter

src, outN, outH = sys.argv[1], sys.argv[2], sys.argv[3]
S = int(sys.argv[4]) if len(sys.argv) > 4 else 1024
im = Image.open(src).convert('RGB')
w, h = im.size; c = min(w, h); im = im.crop(((w - c) // 2, (h - c) // 2, (w - c) // 2 + c, (h - c) // 2 + c)).resize((S, S), Image.LANCZOS)
a = np.asarray(im).astype(np.float32) / 255.0

def seamless(x):
    r = np.roll(np.roll(x, S // 2, 0), S // 2, 1)
    u = np.linspace(-1, 1, S)
    m = np.minimum(1, np.maximum(0, 1.35 - np.maximum(np.abs(u)[None, :], np.abs(u)[:, None]) * 1.0))  # 1 in the middle, 0 at the borders
    m = (m ** 1.5)[..., None] if x.ndim == 3 else m ** 1.5
    return x * m + r * (1 - m)

a = seamless(a)
lum = (a[..., 0] * 0.3 + a[..., 1] * 0.59 + a[..., 2] * 0.11)

def blur(x, r):
    # wrap-around box blur (3 passes ~ gaussian), keeps tiling
    k = max(1, int(r))
    for _ in range(3):
        x = sum(np.roll(x, i, 0) for i in range(-k, k + 1)) / (2 * k + 1)
        x = sum(np.roll(x, i, 1) for i in range(-k, k + 1)) / (2 * k + 1)
    return x

# height: large-scale ridges (low-pass of luminance) + some mid detail, normalised
low = blur(lum, S / 300)
big = blur(lum, S / 16)
hgt = (low - big)
hgt = (hgt - np.percentile(hgt, 2)) / (np.percentile(hgt, 98) - np.percentile(hgt, 2))
hgt = np.clip(hgt, 0, 1)
fine = np.clip((lum - low) * 3 + 0.5, 0, 1)
# cavity AO: how far below the local average the height is
cav = np.clip(1 - np.maximum(0, blur(hgt, S / 64) - hgt) * 2.2, 0, 1)

# normal from height (central differences, wrap)
H = hgt * 0.6 + fine * 0.08
dx = (np.roll(H, -1, 1) - np.roll(H, 1, 1)) * (S / 256.0)
dy = (np.roll(H, -1, 0) - np.roll(H, 1, 0)) * (S / 256.0)
n = np.stack([-dx, dy, np.ones_like(dx)], -1)
n /= np.linalg.norm(n, axis=-1, keepdims=True)
Image.fromarray((n * 0.5 + 0.5).clip(0, 1).__mul__(255).astype(np.uint8)).save(outN, quality=92)
Image.fromarray((np.stack([hgt, cav, fine], -1) * 255).astype(np.uint8)).save(outH, quality=92)
print('ok', S, float(hgt.mean()), float(cav.mean()))
