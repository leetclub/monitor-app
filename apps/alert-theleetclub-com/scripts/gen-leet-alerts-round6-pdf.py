#!/usr/bin/env python3
"""Build leet-alerts-round6.pdf: overview side-by-side first, then hover still."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

DESKTOP = Path("/mnt/c/Users/mahdi/Desktop/leet-alerts-review")
ASSETS = Path("/home/mahdi/.cursor/projects/home-mahdi-projects-monitoring-app-radial-local/assets")
OUT = DESKTOP / "leet-alerts-round6.pdf"
ART = Path("/home/mahdi/projects/monitoring-app-radial-local/apps/alert-theleetclub-com/artifacts")

REF = ASSETS / "ref_over.png"
OURS = DESKTOP / "overview-r6.png"
HOVER = DESKTOP / "hover-r6.png"
R5 = ASSETS / "overview-r5.png"


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
    canvas = Image.new("RGB", (w, h), (20, 20, 32))
    x = (w - im.width) // 2
    y = (h - im.height) // 2
    canvas.paste(im, (x, y))
    return canvas


def labeled_panel(im: Image.Image, title: str, w: int, h: int) -> Image.Image:
    panel = Image.new("RGB", (w, h), (18, 18, 28))
    draw = ImageDraw.Draw(panel)
    draw.text((16, 12), title, fill=(244, 244, 245), font=font(22))
    body = fit(im, w - 24, h - 52)
    panel.paste(body, (12, 44))
    return panel


def page_side_by_side() -> Image.Image:
    W, H = 1600, 1000
    page = Image.new("RGB", (W, H), (14, 14, 22))
    draw = ImageDraw.Draw(page)
    draw.text((40, 28), "Leet Alerts — Round 6 overview", fill=(250, 250, 252), font=font(28))
    draw.text(
        (40, 64),
        "Left: reference overview (t≈46s) · Right: our r6 (short stubby trees, no core→hub lines, pan/hover)",
        fill=(160, 160, 170),
        font=font(16),
    )
    pw, ph = (W - 80) // 2, H - 120
    left = labeled_panel(Image.open(REF), "Reference", pw, ph)
    right = labeled_panel(Image.open(OURS), "Ours r6", pw, ph)
    page.paste(left, (30, 100))
    page.paste(right, (40 + pw, 100))
    return page


def page_hover() -> Image.Image:
    W, H = 1600, 1000
    page = Image.new("RGB", (W, H), (14, 14, 22))
    draw = ImageDraw.Draw(page)
    draw.text((40, 28), "Round 6 — hover focus (REVENUE lit, others ~25%)", fill=(250, 250, 252), font=font(28))
    draw.text(
        (40, 64),
        "Hover anywhere on a department lights it; others dim. Drag pans (no rotate). Click zooms into focus tree.",
        fill=(160, 160, 170),
        font=font(16),
    )
    body = labeled_panel(Image.open(HOVER), "Hover state", W - 60, H - 120)
    page.paste(body, (30, 100))
    return page


def page_vs_r5() -> Image.Image:
    W, H = 1600, 1000
    page = Image.new("RGB", (W, H), (14, 14, 22))
    draw = ImageDraw.Draw(page)
    draw.text((40, 28), "Round 5 → Round 6 (branches shortened)", fill=(250, 250, 252), font=font(28))
    pw, ph = (W - 80) // 2, H - 120
    if R5.exists():
        left = labeled_panel(Image.open(R5), "r5 (long fill)", pw, ph)
    else:
        left = labeled_panel(Image.open(OURS), "r5 missing", pw, ph)
    right = labeled_panel(Image.open(OURS), "r6 (stubby)", pw, ph)
    page.paste(left, (30, 100))
    page.paste(right, (40 + pw, 100))
    return page


def main() -> None:
    DESKTOP.mkdir(parents=True, exist_ok=True)
    ART.mkdir(parents=True, exist_ok=True)
    pages = [page_side_by_side(), page_hover(), page_vs_r5()]
    pages[0].save(
        OUT,
        "PDF",
        save_all=True,
        append_images=pages[1:],
        resolution=120.0,
    )
    dest = ART / "leet-alerts-round6.pdf"
    dest.write_bytes(OUT.read_bytes())
    print(f"wrote {OUT}")
    print(f"wrote {dest}")


if __name__ == "__main__":
    main()
