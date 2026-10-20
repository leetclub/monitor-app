#!/usr/bin/env python3
"""Build leet-alerts-round10.pdf: side-by-side + same-scale overlay + hover."""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageChops

DESKTOP = Path("/mnt/c/Users/mahdi/OneDrive/Desktop/leet-alerts-review")
OUT = DESKTOP / "leet-alerts-round10.pdf"
ART = Path("/home/mahdi/projects/monitoring-app-radial-local/apps/alert-theleetclub-com/artifacts")

REF = DESKTOP / "skilltree-ref" / "01-overview.png"
OURS = DESKTOP / "overview-r10.png"
HOVER = DESKTOP / "hover-r10.png"
FAN_JSON = DESKTOP / "fan-angles-r10.json"


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


def same_scale_overlay(ref: Image.Image, ours: Image.Image, size: tuple[int, int] = (1440, 900)) -> Image.Image:
    """Fit both to the same canvas size and blend 50/50 for fan-angle comparison."""
    W, H = size
    a = fit(ref, W, H)
    b = fit(ours, W, H)
    # 50/50 blend
    blend = Image.blend(a, b, 0.5)
    # Also build a difference-tint hint: where they diverge
    diff = ImageChops.difference(a, b)
    diff = diff.point(lambda v: min(255, int(v * 1.8)))
    # Mild red channel boost on diff, then mix lightly into blend
    r, g, bch = diff.split()
    tint = Image.merge("RGB", (r.point(lambda v: min(255, v + 40)), g, bch))
    out = Image.blend(blend, tint, 0.18)
    return out


def page_side_by_side() -> Image.Image:
    W, H = 1600, 1000
    page = Image.new("RGB", (W, H), (14, 16, 22))
    draw = ImageDraw.Draw(page)
    draw.text((40, 28), "Leet Alerts — Round 10 overview", fill=(250, 250, 252), font=font(28))
    fan_note = ""
    if FAN_JSON.exists():
        data = json.loads(FAN_JSON.read_text())
        fan_note = f"  ·  ours fan avg ≈ {data.get('fanAvg', 0):.0f}° (buildSky target 140°)"
    draw.text(
        (40, 64),
        "Left: skilltree ref · Right: ours r10 — SPAN≈140° wide fans, short chains, hubs~20%H tips~34%H"
        + fan_note,
        fill=(160, 160, 170),
        font=font(14),
    )
    pw, ph = (W - 80) // 2, H - 120
    left = labeled_panel(Image.open(REF), "Reference", pw, ph)
    right = labeled_panel(Image.open(OURS), "Ours r10", pw, ph)
    page.paste(left, (30, 100))
    page.paste(right, (40 + pw, 100))
    return page


def page_overlay() -> Image.Image:
    W, H = 1600, 1000
    page = Image.new("RGB", (W, H), (14, 16, 22))
    draw = ImageDraw.Draw(page)
    draw.text((40, 28), "Round 10 — same-scale overlay (ref ⊕ ours)", fill=(250, 250, 252), font=font(28))
    draw.text(
        (40, 64),
        "Both fitted to 1440×900 and blended 50/50. Wide ~140° fans should align; narrow brooms would miss the ref arcs.",
        fill=(160, 160, 170),
        font=font(15),
    )
    overlay = same_scale_overlay(Image.open(REF), Image.open(OURS))
    body = labeled_panel(overlay, "Overlay @ same scale", W - 60, H - 120)
    page.paste(body, (30, 100))
    # Save overlay PNG for review
    overlay_path = DESKTOP / "overlay-r10.png"
    overlay.save(overlay_path)
    (ART / "overlay-r10.png").write_bytes(overlay_path.read_bytes())
    return page


def page_hover() -> Image.Image:
    W, H = 1600, 1000
    page = Image.new("RGB", (W, H), (14, 16, 22))
    draw = ImageDraw.Draw(page)
    draw.text((40, 28), "Round 10 — hover (REVENUE lit, others ~25%)", fill=(250, 250, 252), font=font(28))
    body = labeled_panel(Image.open(HOVER), "Ours r10 hover", W - 60, H - 120)
    page.paste(body, (30, 100))
    return page


def main() -> None:
    DESKTOP.mkdir(parents=True, exist_ok=True)
    ART.mkdir(parents=True, exist_ok=True)
    for p in (REF, OURS, HOVER):
        if not p.exists():
            raise SystemExit(f"missing: {p}")
    pages = [page_side_by_side(), page_overlay(), page_hover()]
    pages[0].save(
        OUT,
        "PDF",
        save_all=True,
        append_images=pages[1:],
        resolution=120.0,
    )
    dest = ART / "leet-alerts-round10.pdf"
    dest.write_bytes(OUT.read_bytes())
    print(f"wrote {OUT}")
    print(f"wrote {dest}")
    if FAN_JSON.exists():
        data = json.loads(FAN_JSON.read_text())
        print(f"fanAvg={data.get('fanAvg'):.1f}° hubs={data.get('hub'):.3f} tip={data.get('tip'):.3f}")


if __name__ == "__main__":
    main()
