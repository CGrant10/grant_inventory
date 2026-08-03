"""Generate the PWA icon set: a teal box glyph on a dark rounded square.

Run after changing the mark:  python tools/make_icons.py
"""
from PIL import Image, ImageDraw

BG     = (15, 20, 23)
ACCENT = (47, 214, 164)
OUT    = "assets/icons"


def draw(size, maskable=False):
    s = size * 4  # supersample, then downscale for clean edges
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if maskable:
        # Maskable icons get cropped to a circle by the launcher: fill edge to
        # edge and keep the glyph inside the 80% safe zone.
        d.rectangle([0, 0, s, s], fill=BG)
        scale = 0.52
    else:
        d.rounded_rectangle([0, 0, s, s], radius=int(s * 0.22), fill=BG)
        scale = 0.62

    # An open-topped crate seen from the front, with a fill line across it.
    w = s * scale
    h = w * 0.80
    x0, y0 = (s - w) / 2, (s - h) / 2 + s * 0.02
    x1, y1 = x0 + w, y0 + h
    lw = max(2, int(s * 0.038))

    d.rounded_rectangle([x0, y0, x1, y1], radius=int(w * 0.10),
                        outline=ACCENT, width=lw)
    # Lid line and the "how full is it" band.
    d.line([x0, y0 + h * 0.28, x1, y0 + h * 0.28], fill=ACCENT, width=lw)
    d.rectangle([x0 + lw * 1.4, y0 + h * 0.52, x1 - lw * 1.4, y1 - lw * 1.4],
                fill=ACCENT)
    # Handle notch on the lid.
    d.line([s / 2 - w * 0.11, y0, s / 2 + w * 0.11, y0], fill=BG, width=int(lw * 2.2))

    return img.resize((size, size), Image.LANCZOS)


for size in (192, 512):
    draw(size).save(f"{OUT}/icon-{size}.png")
    draw(size, maskable=True).save(f"{OUT}/icon-{size}-maskable.png")

draw(180).save(f"{OUT}/apple-touch-icon.png")
print("icons written to", OUT)
