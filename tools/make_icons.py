"""Build every icon from the one source mark.

Source: assets/logo-source.png — the Grant Household Inventory badge.
Run after changing the mark:  python tools/make_icons.py

Outputs
  assets/logo.png                 badge cropped to its circle, transparent outside
  assets/icons/icon-{192,512}.png rounded square, cream field
  assets/icons/icon-*-maskable    full bleed, badge inside the 80% safe zone
  assets/icons/apple-touch-icon   180px square (iOS applies its own mask)
  assets/icons/favicon-{32,64}    browser tab
"""

from PIL import Image, ImageDraw

SRC = "assets/logo-source.png"
OUT = "assets/icons"
CREAM = (247, 244, 239, 255)


def circle_crop(path):
    """Crop the badge to its outer ring and knock out everything beyond it."""
    img = Image.open(path).convert("RGBA")

    # The ring is the darkest thing in the frame, so its bbox is the badge's bbox.
    mask = img.convert("L").point(lambda v: 255 if v < 200 else 0)
    box = mask.getbbox()
    if box is None:
        raise SystemExit(f"no mark found in {path}")

    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    # A hair outside the ring, so antialiasing on the stroke isn't clipped flat.
    r = min(x1 - x0, y1 - y0) / 2 * 1.01
    img = img.crop((round(cx - r), round(cy - r), round(cx + r), round(cy + r)))

    w, h = img.size
    ss = 4
    alpha = Image.new("L", (w * ss, h * ss), 0)
    ImageDraw.Draw(alpha).ellipse([0, 0, w * ss, h * ss], fill=255)
    img.putalpha(alpha.resize((w, h), Image.LANCZOS))
    return img


def fit(badge, size, scale):
    """Badge centred on a transparent square of `size`, occupying `scale` of it."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = round(size * scale)
    canvas.alpha_composite(badge.resize((d, d), Image.LANCZOS),
                           ((size - d) // 2, (size - d) // 2))
    return canvas


def rounded(size, scale, badge):
    """Any-purpose icon: cream rounded square with the badge inset."""
    ss = 4
    s = size * ss
    field = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(field).rounded_rectangle([0, 0, s, s], radius=int(s * 0.22), fill=CREAM)
    field.alpha_composite(fit(badge, s, scale))
    return field.resize((size, size), Image.LANCZOS)


def maskable(size, badge):
    """Launchers crop maskable icons to a circle — fill the frame, inset the mark."""
    ss = 4
    s = size * ss
    field = Image.new("RGBA", (s, s), CREAM)
    field.alpha_composite(fit(badge, s, 0.78))
    return field.resize((size, size), Image.LANCZOS)


badge = circle_crop(SRC)
badge.resize((512, 512), Image.LANCZOS).save("assets/logo.png")

for size in (192, 512):
    rounded(size, 0.94, badge).save(f"{OUT}/icon-{size}.png")
    maskable(size, badge).save(f"{OUT}/icon-{size}-maskable.png")

# iOS masks apple-touch-icon itself, so hand it a full-bleed square.
field = Image.new("RGBA", (180, 180), CREAM)
field.alpha_composite(fit(badge, 180, 0.96))
field.save(f"{OUT}/apple-touch-icon.png")

for size in (32, 64):
    rounded(size, 0.98, badge).save(f"{OUT}/favicon-{size}.png")

print("icons written from", SRC)
