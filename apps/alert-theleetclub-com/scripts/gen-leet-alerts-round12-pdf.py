#!/usr/bin/env python3
"""Build leet-alerts-round12.pdf: motion stills + constants table."""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

DESKTOP = Path("/mnt/c/Users/mahdi/OneDrive/Desktop/leet-alerts-review")
MOTION = DESKTOP / "r12-motion"
OUT = DESKTOP / "leet-alerts-round12.pdf"
NOTES = DESKTOP / "skilltree-ref" / "INTERACTION-NOTES.json"
OURS = MOTION / "ours-constants.json"


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


def page_title() -> Image.Image:
    W, H = 1600, 1000
    page = Image.new("RGB", (W, H), (14, 16, 22))
    d = ImageDraw.Draw(page)
    d.text((40, 36), "Leet Alerts — Round 12 · Interaction + Motion", fill=(250, 250, 252), font=font(30))
    d.text(
        (40, 80),
        "Side-by-side stills from r12-motion webms (left REF · right OURS) · viewport 1440×900",
        fill=(180, 184, 192),
        font=font(16),
    )
    clips = [
        ("01-hover-fan", "Hover across one fan"),
        ("02-wheel-zoom", "Wheel zoom in/out"),
        ("03-drag-release", "Drag with release / inertia"),
        ("04-hub-focus-back", "Click hub then back"),
        ("05-click-node", "Click node → panel"),
        ("06-next-arrow", "Next category arrow"),
        ("07-dial-drag", "Sky dial drag + snap"),
    ]
    # 2×3 grid
    cell_w, cell_h = 740, 200
    for i, (name, label) in enumerate(clips):
        col, row = i % 2, i // 2
        x0, y0 = 40 + col * (cell_w + 40), 110 + row * (cell_h + 18)
        src = MOTION / f"frame-{name}.png"
        if not src.exists():
            src = MOTION / f"still-{name}.png"
        if src.exists():
            panel = fit(Image.open(src), cell_w, cell_h - 28)
            page.paste(panel, (x0, y0 + 24))
        d.text((x0, y0), f"{name} — {label}", fill=(230, 230, 234), font=font(14))
    return page


def page_table() -> Image.Image:
    W, H = 1600, 1000
    page = Image.new("RGB", (W, H), (14, 16, 22))
    d = ImageDraw.Draw(page)
    d.text((40, 36), "Constants — theirs vs ours", fill=(250, 250, 252), font=font(28))

    theirs = {}
    if NOTES.exists():
        data = json.loads(NOTES.read_text())
        theirs = data.get("constantsSummary", {})
    ours = {}
    if OURS.exists():
        o = json.loads(OURS.read_text())
        ours = o.get("ours", o)

    rows = [
        ("tick / camera ease", theirs.get("tickEase", 0.13), ours.get("EASE_CAM")),
        ("hover dim others", theirs.get("hoverDimOthers", 0.18), ours.get("DIM_OTHERS")),
        ("node faded", theirs.get("nodeFaded", 0.25), ours.get("NODE_FADED")),
        ("drag cancel click", theirs.get("dragDistCancelClick", 8), ours.get("DRAG_CLICK_CANCEL")),
        ("wheel zoom exp", theirs.get("wheelZoomExp", 0.01), ours.get("WHEEL_ZOOM_EXP")),
        ("zoom step in/out", f"{theirs.get('zoomStepIn', 1.25)} / {theirs.get('zoomStepOut', 0.8)}",
         f"{ours.get('ZOOM_STEP_IN')} / {ours.get('ZOOM_STEP_OUT')}"),
        ("fan scale min/max", "0.42 – 1.9", f"{ours.get('Z_FAN_MIN')} – {ours.get('Z_FAN_MAX')}"),
        ("rise scale threshold", theirs.get("riseScaleThreshold", 0.43), ours.get("RISE_SCALE")),
        ("FAN_SPAN°", theirs.get("FAN_SPAN_deg", 182), ours.get("FAN_SPAN_DEG")),
        ("R0 / R_BASE / R_STEP", f"{theirs.get('R0', 248)} / {theirs.get('R_BASE', 410)} / {theirs.get('R_STEP', 214)}",
         f"{ours.get('R0_FAN')} / {ours.get('R_BASE')} / {ours.get('R_STEP')}"),
        ("dive swap ms", theirs.get("diveSwapMs", 520), ours.get("DIVE_SWAP_MS")),
        ("rise remove ms", theirs.get("riseRemoveMs", 380), ours.get("RISE_MS")),
        ("fan inertia", "none", "none" if ours.get("fanInertia") is False else ours.get("fanInertia")),
        ("sky dial", "angular + snap", "angular + snap" if ours.get("skyDial") else "no"),
        ("morph dive", "align+fan build", "interpolate nodes" if ours.get("morphDive") else "no"),
        ("hover node scale", "1.12 (CSS)", ours.get("HOVER_NODE_SCALE")),
    ]

    y = 100
    d.text((40, y), "Parameter", fill=(160, 164, 172), font=font(14))
    d.text((520, y), "Skilltree (ref)", fill=(160, 164, 172), font=font(14))
    d.text((980, y), "Ours (r11)", fill=(160, 164, 172), font=font(14))
    y += 28
    d.line((40, y, 1560, y), fill=(60, 64, 72), width=1)
    y += 12
    for label, a, b in rows:
        d.text((40, y), str(label), fill=(236, 236, 240), font=font(15))
        d.text((520, y), str(a), fill=(200, 204, 212), font=font(15))
        d.text((980, y), str(b), fill=(200, 204, 212), font=font(15))
        y += 36

    y += 20
    d.text((40, y), "Unmatched / intentional deltas", fill=(250, 250, 252), font=font(20))
    y += 36
    review = {}
    rp = MOTION / "self-review.json"
    if rp.exists():
        review = json.loads(rp.read_text())
    for line in review.get("unmatched", []):
        d.text((40, y), f"• {line[:140]}", fill=(180, 184, 192), font=font(13))
        y += 26
    return page


def page_overview() -> Image.Image:
    W, H = 1600, 1000
    page = Image.new("RGB", (W, H), (14, 16, 22))
    d = ImageDraw.Draw(page)
    d.text((40, 36), "Overview stills (r10 geometry kept)", fill=(250, 250, 252), font=font(28))
    ref = MOTION / "ref-overview.png"
    ours = MOTION / "ours-overview.png"
    if ref.exists():
        page.paste(fit(Image.open(ref), 740, 820), (40, 90))
        d.text((40, 70), "REF", fill=(200, 200, 200), font=font(14))
    if ours.exists():
        page.paste(fit(Image.open(ours), 740, 820), (820, 90))
        d.text((820, 70), "OURS", fill=(200, 200, 200), font=font(14))
    return page


def main():
    pages = [page_title(), page_table(), page_overview()]
    pages[0].save(OUT, "PDF", save_all=True, append_images=pages[1:], resolution=120.0)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
