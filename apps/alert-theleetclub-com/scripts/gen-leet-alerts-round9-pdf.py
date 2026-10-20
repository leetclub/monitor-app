#!/usr/bin/env python3
"""Build leet-alerts-round9.pdf: Skilltree ref vs ours side-by-side, then hover."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

DESKTOP = Path("/mnt/c/Users/mahdi/OneDrive/Desktop/leet-alerts-review")
OUT = DESKTOP / "leet-alerts-round9.pdf"
ART = Path("/home/mahdi/projects/monitoring-app-radial-local/apps/alert-theleetclub-com/artifacts")

REF = DESKTOP / "skilltree-ref" / "01-overview.png"
OURS = DESKTOP / "overview-r9.png"
HOVER = DESKTOP / "hover-r9.png"
REF_HOVER = DESKTOP / "skilltree-ref" / "02-hover-department.png"


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
    draw.text((40, 28), "Leet Alerts — Round 9 overview", fill=(250, 250, 252), font=font(28))
    draw.text(
        (40, 64),
        "Left: skilltree ref · Right: ours r9 — dept gaps, titles clear of toolbar, smaller crisp core",
        fill=(160, 160, 170),
        font=font(15),
    )
    pw, ph = (W - 80) // 2, H - 120
    left = labeled_panel(Image.open(REF), "Reference", pw, ph)
    right = labeled_panel(Image.open(OURS), "Ours r9", pw, ph)
    page.paste(left, (30, 100))
    page.paste(right, (40 + pw, 100))
    return page


def page_hover() -> Image.Image:
    W, H = 1600, 1000
    page = Image.new("RGB", (W, H), (14, 16, 22))
    draw = ImageDraw.Draw(page)
    draw.text((40, 28), "Round 9 — hover (REVENUE lit, others ~25%)", fill=(250, 250, 252), font=font(28))
    pw, ph = (W - 80) // 2, H - 120
    if REF_HOVER.exists():
        left = labeled_panel(Image.open(REF_HOVER), "Reference hover", pw, ph)
    else:
        left = labeled_panel(Image.open(REF), "Reference overview", pw, ph)
    right = labeled_panel(Image.open(HOVER), "Ours r9 hover", pw, ph)
    page.paste(left, (30, 100))
    page.paste(right, (40 + pw, 100))
    return page


def main() -> None:
    DESKTOP.mkdir(parents=True, exist_ok=True)
    ART.mkdir(parents=True, exist_ok=True)
    for p in (REF, OURS, HOVER):
        if not p.exists():
            raise SystemExit(f"missing: {p}")
    pages = [page_side_by_side(), page_hover()]
    pages[0].save(
        OUT,
        "PDF",
        save_all=True,
        append_images=pages[1:],
        resolution=120.0,
    )
    dest = ART / "leet-alerts-round9.pdf"
    dest.write_bytes(OUT.read_bytes())
    print(f"wrote {OUT}")
    print(f"wrote {dest}")


if __name__ == "__main__":
    main()
