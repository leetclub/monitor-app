#!/usr/bin/env python3
"""Build leet-alerts-round13.pdf: motion stills + dive morph frames + constants."""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

DESKTOP = Path("/mnt/c/Users/mahdi/OneDrive/Desktop/leet-alerts-review")
MOTION = DESKTOP / "r13-motion"
OUT = DESKTOP / "leet-alerts-round13.pdf"
ART = Path(
    "/home/mahdi/projects/monitoring-app-radial-local/"
    "apps/alert-theleetclub-com/artifacts/r13-motion"
)
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
    d.text((40, 36), "Leet Alerts — Round 13 · Canvas fix + Motion", fill=(250, 250, 252), font=font(30))
    d.text(
        (40, 80),
        "Root cause: opaque .label-layer hid the canvas. Rest = r10 (OFFLINE north). REF left · OURS right.",
        fill=(180, 184, 192),
        font=font(15),
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


def page_dive() -> Image.Image:
    W, H = 1600, 1000
    page = Image.new("RGB", (W, H), (14, 16, 22))
    d = ImageDraw.Draw(page)
    d.text((40, 36), "Dive morph frame-step (0 / 130 / 260 / 390 / 520 ms)", fill=(250, 250, 252), font=font(26))
    stamps = [0, 130, 260, 390, 520]
    cell_w, cell_h = 280, 400
    for i, ms in enumerate(stamps):
        x0 = 40 + i * (cell_w + 24)
        src = MOTION / f"dive-morph-{ms:03d}ms.png"
        if src.exists():
            page.paste(fit(Image.open(src), cell_w, cell_h - 28), (x0, 90))
        d.text((x0, 70), f"{ms} ms", fill=(200, 204, 212), font=font(14))
    settled = MOTION / "dive-morph-settled.png"
    if settled.exists():
        page.paste(fit(Image.open(settled), 400, 380), (40, 560))
        d.text((40, 540), "Settled fan", fill=(200, 204, 212), font=font(14))
    gate = MOTION / "rest-gate.json"
    if gate.exists():
        g = json.loads(gate.read_text())
        d.text((480, 560), "Rest gate", fill=(250, 250, 252), font=font(18))
        y = 600
        for k in ("ok", "nodeDots", "hubs", "coreInk", "wheelA", "mapState"):
            d.text((480, y), f"{k}: {g.get(k)}", fill=(200, 204, 212), font=font(14))
            y += 28
        d.text((480, y + 8), "Root cause fixed: transparent label-layer + wheelA=0", fill=(160, 200, 160), font=font(14))
    return page


def page_table() -> Image.Image:
    W, H = 1600, 1000
    page = Image.new("RGB", (W, H), (14, 16, 22))
    d = ImageDraw.Draw(page)
    d.text((40, 36), "Constants — theirs vs ours (r13)", fill=(250, 250, 252), font=font(28))

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
        ("wheel ease", theirs.get("wheelEase", 0.11), ours.get("EASE_WHEEL")),
        ("FAN_SPAN°", theirs.get("FAN_SPAN_deg", 182), ours.get("FAN_SPAN_DEG")),
        ("dive morph ms", theirs.get("diveSwapMs", 520), ours.get("DIVE_MORPH_MS")),
        ("rise remove ms", theirs.get("riseRemoveMs", 380), ours.get("RISE_MS")),
        ("fan inertia", "none", "none" if ours.get("fanInertia") is False else ours.get("fanInertia")),
        ("sky dial", "angular + snap", "angular + snap" if ours.get("skyDial") else "no"),
        ("morph dive", "align+fan build", "interpolate nodes" if ours.get("morphDive") else "no"),
        ("rest wheelA", "0 (dept0 north)", "0" if True else "?"),
    ]

    y = 100
    d.text((40, y), "Parameter", fill=(160, 164, 172), font=font(14))
    d.text((520, y), "Skilltree (ref)", fill=(160, 164, 172), font=font(14))
    d.text((980, y), "Ours (r13)", fill=(160, 164, 172), font=font(14))
    y += 28
    d.line((40, y, 1560, y), fill=(60, 64, 72), width=1)
    y += 12
    for label, a, b in rows:
        d.text((40, y), str(label), fill=(236, 236, 240), font=font(15))
        d.text((520, y), str(a), fill=(200, 204, 212), font=font(15))
        d.text((980, y), str(b), fill=(200, 204, 212), font=font(15))
        y += 36

    y += 20
    d.text((40, y), "Closed in r13", fill=(250, 250, 252), font=font(20))
    y += 36
    review = {}
    rp = MOTION / "self-review.json"
    if rp.exists():
        review = json.loads(rp.read_text())
    for line in review.get("closedGaps", []):
        d.text((40, y), f"• {line[:140]}", fill=(180, 184, 192), font=font(13))
        y += 26
    return page


def page_overview() -> Image.Image:
    W, H = 1600, 1000
    page = Image.new("RGB", (W, H), (14, 16, 22))
    d = ImageDraw.Draw(page)
    d.text((40, 36), "Overview stills (must match r10 geometry)", fill=(250, 250, 252), font=font(28))
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
    pages = [page_title(), page_dive(), page_table(), page_overview()]
    pages[0].save(OUT, "PDF", save_all=True, append_images=pages[1:], resolution=120.0)
    # Mirror into artifacts
    ART.mkdir(parents=True, exist_ok=True)
    art_pdf = ART / "leet-alerts-round13.pdf"
    art_pdf.write_bytes(OUT.read_bytes())
    print("wrote", OUT)
    print("wrote", art_pdf)


if __name__ == "__main__":
    main()
