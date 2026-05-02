#!/usr/bin/env python3
"""Render PRODUCT-PROTOTYPE.md → PRODUCT-PROTOTYPE.pdf (Markdown + tables → WeasyPrint)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MD_PATH = ROOT / "PRODUCT-PROTOTYPE.md"
PDF_PATH = ROOT / "PRODUCT-PROTOTYPE.pdf"

CSS = """
@page {
  size: A4;
  margin: 16mm;
}
body {
  font-family: Helvetica, Arial, "Segoe UI", sans-serif;
  font-size: 10.5pt;
  line-height: 1.4;
  color: #111;
}
h1 { font-size: 18pt; margin: 0.4em 0 0.5em; border-bottom: 1px solid #ccc; padding-bottom: 6px; }
h2 {
  font-size: 13pt;
  margin: 1.1em 0 0.45em;
  color: #1a1a1a;
}
p { margin: 0.5em 0; }
hr { margin: 1em 0; border: none; border-top: 1px solid #ddd; }
ul { margin: 0.35em 0 0.5em 1.1em; padding: 0; }
li { margin: 0.2em 0; }
strong { font-weight: 650; }
code, tt {
  font-family: ui-monospace, monospace;
  font-size: 0.88em;
  background: #f3f4f6;
  padding: 1px 4px;
  border-radius: 3px;
}
table {
  width: 100%;
  border-collapse: collapse;
  margin: 0.6em 0 1em;
  font-size: 9.5pt;
}
th, td {
  border: 1px solid #ccc;
  padding: 6px 8px;
  text-align: left;
  vertical-align: top;
}
th {
  background: #f9fafb;
  font-weight: 600;
}
img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 0.75em auto;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 4px;
  background: #fff;
  page-break-inside: avoid;
}
figure {
  margin: 1em 0;
  page-break-inside: avoid;
}
figcaption, .caption {
  font-size: 9pt;
  color: #64748b;
  margin: 0.35em auto 1em;
  text-align: center;
  max-width: 540px;
}
"""


def main() -> int:
    if not MD_PATH.exists():
        print(f"Missing {MD_PATH.relative_to(Path.cwd()) if Path.cwd() in MD_PATH.parents else MD_PATH}", file=sys.stderr)
        return 1

    md_text = MD_PATH.read_text(encoding="utf-8")
    try:
        import markdown  # noqa: WPS433
    except ImportError:
        print("Python package 'markdown' not found.", file=sys.stderr)
        print("Create the venv: python3 -m venv .venv-docs && .venv-docs/bin/pip install markdown", file=sys.stderr)
        return 1

    md_html = markdown.markdown(
        md_text,
        extensions=["tables", "nl2br", "fenced_code", "extra"],
    )
    html = f"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><style>{CSS}</style>
</head><body>{md_html}</body></html>"""

    try:
        from weasyprint import HTML  # noqa: WPS433
    except ImportError:
        print("WeasyPrint not found. Install locally (e.g. pip install weasyprint) — see README.", file=sys.stderr)
        return 1

    HTML(string=html, base_url=str(ROOT)).write_pdf(PDF_PATH)
    print(f"Wrote {PDF_PATH.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
