#!/usr/bin/env python3
"""Build leet-alerts-round14.pdf."""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

DESKTOP = Path("/mnt/c/Users/mahdi/OneDrive/Desktop/leet-alerts-review")
MOTION = DESKTOP / "r14-motion"
OUT = DESKTOP / "leet-alerts-round14.pdf"
ART = Path(
    "/home/mahdi/projects/monitoring-app-radial-local/"
    "apps/alert-theleetclub-com/artifacts/r14-motion"
)


def font(size: int):
    for name in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        p = Path(name)
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def fit(im: Image.Image, w: int, h: int) -> Image.Image:
    im = im.convert("RGB")
    im.thumbnail((w, h), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (w, h), (20, 24, 32))
    canvas.paste(im, ((w - im.width) // 2, (h - im.height) // 2))
    return canvas


def page_clips() -> Image.Image:
    W, H = 1600, 1000
    page = Image.new("RGB", (W, H), (14, 16, 22))
    d = ImageDraw.Draw(page)
    d.text((40, 36), "Leet Alerts — Round 14 · Morph + Dial coast + Hover glow", fill=(250, 250, 252), font=font(28))
    d.text((40, 78), "REF left · OURS right · mid-clip frames", fill=(180, 184, 192), font=font(15))
    clips = [
        ("01-hover-fan", "Hover ease + solid glow path"),
        ("02-wheel-zoom", "Ctrl-wheel dive"),
        ("03-drag-release", "Fan pan (no inertia)"),
        ("04-hub-focus-back", "Morph dive + rise"),
        ("05-click-node", "Node → panel"),
        ("06-next-arrow", "Arrow step + ease"),
        ("07-dial-drag", "Dial coast + snap"),
    ]
    cell_w, cell_h = 740, 200
    for i, (name, label) in enumerate(clips):
        col, row = i % 2, i // 2
        x0, y0 = 40 + col * (cell_w + 40), 110 + row * (cell_h + 18)
        src = MOTION / f"frame-{name}.png"
        if src.exists():
            page.paste(fit(Image.open(src), cell_w, cell_h - 28), (x0, y0 + 24))
        d.text((x0, y0), f"{name} — {label}", fill=(230, 230, 234), font=font(14))
    return page


def page_morph(kind: str) -> Image.Image:
    W, H = 1600, 1000
    page = Image.new("RGB", (W, H), (14, 16, 22))
    d = ImageDraw.Draw(page)
    title = "Dive morph — 8 evenly spaced stills" if kind == "dive" else "Rise morph — 8 evenly spaced stills"
    d.text((40, 36), title, fill=(250, 250, 252), font=font(26))
    cell_w, cell_h = 360, 400
    for i in range(8):
        col, row = i % 4, i // 4
        x0, y0 = 40 + col * (cell_w + 20), 90 + row * (cell_h + 40)
        src = MOTION / f"{kind}-{i:02d}.png"
        if src.exists():
            page.paste(fit(Image.open(src), cell_w, cell_h - 24), (x0, y0 + 22))
        d.text((x0, y0), f"{kind} {i}/7", fill=(200, 204, 212), font=font(13))
    return page


def page_notes() -> Image.Image:
    W, H = 1600, 1000
    page = Image.new("RGB", (W, H), (14, 16, 22))
    d = ImageDraw.Draw(page)
    d.text((40, 36), "Round 14 — what changed", fill=(250, 250, 252), font=font(28))
    y = 100
    lines = [
        "Morph: nodes + camera share easeInOutCubic over DIVE_MORPH_MS=900 / RISE_MS=700.",
        "No instant zoom=0.5 snap; no focusLayout rebuild flash at end of dive.",
        "Dial: track angular velocity; on release coast with friction then snapWheel detent.",
        "Arrows: stepWheel sets wheelT; same EASE_WHEEL=0.11 ease into seat.",
        "Hover: HOVER_FADE_MS=350; hovered department paths = solid glowing strokes + lit dots.",
        "Fan drag still has no inertia (ref).",
    ]
    review = MOTION / "self-review.json"
    if review.exists():
        data = json.loads(review.read_text())
        mr = data.get("morphReport", {})
        lines.append(f"Dive distinct camY={mr.get('dive', {}).get('distinctCamY')} zoom={mr.get('dive', {}).get('distinctZoom')}")
        lines.append(f"Rise distinct camY={mr.get('rise', {}).get('distinctCamY')} zoom={mr.get('rise', {}).get('distinctZoom')}")
    for line in lines:
        d.text((40, y), f"• {line}", fill=(200, 204, 212), font=font(16))
        y += 36
    return page


def main():
    pages = [page_clips(), page_morph("dive"), page_morph("rise"), page_notes()]
    pages[0].save(OUT, "PDF", save_all=True, append_images=pages[1:], resolution=120.0)
    ART.mkdir(parents=True, exist_ok=True)
    (ART / "leet-alerts-round14.pdf").write_bytes(OUT.read_bytes())
    print("wrote", OUT)


if __name__ == "__main__":
    main()
