#!/usr/bin/env python3
"""Build leet-alerts-round8.pdf: overview + hover + category close-up (ref vs ours)."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

DESKTOP = Path("/mnt/c/Users/mahdi/OneDrive/Desktop/leet-alerts-review")
OUT = DESKTOP / "leet-alerts-round8.pdf"
ART = Path("/home/mahdi/projects/monitoring-app-radial-local/apps/alert-theleetclub-com/artifacts")

REF = DESKTOP / "skilltree-ref" / "01-overview.png"
OURS = DESKTOP / "overview-r8.png"
HOVER = DESKTOP / "hover-r8.png"
REF_HOVER = DESKTOP / "skilltree-ref" / "02-hover-department.png"
CLOSE_REF = DESKTOP / "closeup-ref-r8.png"
CLOSE_OURS = DESKTOP / "closeup-ours-r8.png"


def font(size: int):
    for name in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ):
        p = Path(name)
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def fit(im: Image.Image, w: int, h: int) -> Image.Image:
    im = im.convert("RGB")
    im.thumbnail((w, h), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (w, h), (20, 24, 32))
    x = (w - im.width) // 2
    y = (h - im.height) // 2
    canvas.paste(im, (x, y))
    return canvas


def labeled_panel(im: Image.Image, title: str, w: int, h: int) -> Image.Image:
    panel = Image.new("RGB", (w, h), (18, 22, 30))
    draw = ImageDraw.Draw(panel)
    draw.text((16, 12), title, fill=(244, 244, 245), font=font(22))
    body = fit(im, w - 24, h - 52)
    panel.paste(body, (12, 44))
    return panel


def page_side_by_side() -> Image.Image:
    W, H = 1600, 1000
    page = Image.new("RGB", (W, H), (14, 16, 22))
    draw = ImageDraw.Draw(page)
    draw.text((40, 28), "Leet Alerts — Round 8 overview", fill=(250, 250, 252), font=font(28))
    draw.text(
        (40, 64),
        "Left: skilltree.altari.ai · Right: ours r8 — spoke axes + regular ±zig, white nodes, grey lines, Marcellus",
        fill=(160, 160, 170),
        font=font(15),
    )
    pw, ph = (W - 80) // 2, H - 120
    left = labeled_panel(Image.open(REF), "Reference", pw, ph)
    right = labeled_panel(Image.open(OURS), "Ours r8", pw, ph)
    page.paste(left, (30, 100))
    page.paste(right, (40 + pw, 100))
    return page


def page_hover() -> Image.Image:
    W, H = 1600, 1000
    page = Image.new("RGB", (W, H), (14, 16, 22))
    draw = ImageDraw.Draw(page)
    draw.text((40, 28), "Round 8 — hover (REVENUE lit, others ~25%)", fill=(250, 250, 252), font=font(28))
    draw.text(
        (40, 64),
        "Left: Skilltree hover · Right: Leet Alerts r8 (pan/focus unchanged)",
        fill=(160, 160, 170),
        font=font(15),
    )
    pw, ph = (W - 80) // 2, H - 120
    if REF_HOVER.exists():
        left = labeled_panel(Image.open(REF_HOVER), "Reference hover", pw, ph)
    else:
        left = labeled_panel(Image.open(REF), "Reference overview", pw, ph)
    right = labeled_panel(Image.open(HOVER), "Ours r8 hover", pw, ph)
    page.paste(left, (30, 100))
    page.paste(right, (40 + pw, 100))
    return page


def page_closeup() -> Image.Image:
    W, H = 1600, 1000
    page = Image.new("RGB", (W, H), (14, 16, 22))
    draw = ImageDraw.Draw(page)
    draw.text((40, 28), "Round 8 — chain close-up (aligned spokes)", fill=(250, 250, 252), font=font(28))
    draw.text(
        (40, 64),
        "Each chain follows a straight radial axis; joints alternate a small fixed ±offset (buildSky proportion).",
        fill=(160, 160, 170),
        font=font(15),
    )
    pw, ph = (W - 80) // 2, H - 120
    left = labeled_panel(Image.open(CLOSE_REF), "Reference crop", pw, ph)
    right = labeled_panel(Image.open(CLOSE_OURS), "Ours r8 crop", pw, ph)
    page.paste(left, (30, 100))
    page.paste(right, (40 + pw, 100))
    return page


def main() -> None:
    DESKTOP.mkdir(parents=True, exist_ok=True)
    ART.mkdir(parents=True, exist_ok=True)
    for p in (REF, OURS, HOVER, CLOSE_REF, CLOSE_OURS):
        if not p.exists():
            raise SystemExit(f"missing: {p}")
    pages = [page_side_by_side(), page_hover(), page_closeup()]
    pages[0].save(
        OUT,
        "PDF",
        save_all=True,
        append_images=pages[1:],
        resolution=120.0,
    )
    dest = ART / "leet-alerts-round8.pdf"
    dest.write_bytes(OUT.read_bytes())
    print(f"wrote {OUT}")
    print(f"wrote {dest}")


if __name__ == "__main__":
    main()
