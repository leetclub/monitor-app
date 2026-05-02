#!/usr/bin/env bash
# Generate PRODUCT-PROTOTYPE.pdf from PRODUCT-PROTOTYPE.md (Ubuntu/WSL/Git Bash).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VENV="${ROOT}/.venv-docs"
if [[ ! -d "${VENV}" ]]; then
  python3 -m venv "${VENV}"
fi

"${VENV}/bin/pip" install -q "markdown>=3.5,<4" "weasyprint>=62,<67" "cairosvg>=2.7,<3"

"${VENV}/bin/python" "${ROOT}/scripts/gen-product-prototype-pdf.py"
