# `alert.theleetclub.com`

This directory is reserved for the **alert** app/service deployed under `alert.theleetclub.com`.

## What belongs here

- App source code
- Docker/Kubernetes manifests (if applicable)
- Deployment notes and runbooks

## Product / PM handoff

- **`PRODUCT-PROTOTYPE.md`** — stakeholder-readable overview (routes, permissions, roadmap gaps, changelog). The app UI does **not** show “prototype”; that context lives here only. Update when UX or copy changes materially (see `.cursor/rules/leet-alert-prototype-doc.mdc`).
- **Always:** `.cursor/rules/leet-alert-docs-with-app-changes.mdc` — any change under this app should update **markdown + `docs/product-prototype/visual-prototype.svg` + PDF** in the same effort.
- **Workbook:** `alert.theleetclub.com.xlsx` in this folder (Admin / Overall / Red Flags sheets). **`docs/alert-workbook-admin-tab.md`** maps **Admin** → **Machines** tab; **`docs/alert-workbook-red-flags-tab.md`** maps **Red Flags** → **`/red-flags`** columns.
- **`PRODUCT-PROTOTYPE.pdf`** — generated from the Markdown + embedded **`docs/product-prototype/visual-prototype.svg`**. Regenerate after doc or diagram edits:

  ```bash
  cd apps/alert-theleetclub-com && npm run doc:pdf
  ```

  Use **Ubuntu/WSL** (requires `bash`, Python 3, and WeasyPrint dependencies — the script creates `.venv-docs/` and installs `markdown` + `weasyprint`). On first failure, install OS packages (e.g. Debian/Ubuntu: `libcairo2`, `libpango-1.0-0`, `libpangocairo-1.0-0`, `libgdk-pixbuf2.0-0`).
- **`docs/product-prototype/visual-prototype.svg`** — **visual wireframe** embedded in the markdown/PDF; edit when navigation or primary screens change.
- **`PRODUCT-PROTOTYPE.pdf`** — generated from markdown (includes the SVG). After **`PRODUCT-PROTOTYPE.md`** or the SVG changes, run **`npm run doc:pdf`** from this folder (**WSL or Git Bash**; uses `./scripts/gen-product-prototype-pdf.sh` + **`.venv-docs`** for Markdown/WeasyPrint). Commit **`PRODUCT-PROTOTYPE.pdf`** with the source files.  
  Requires OS libraries for WeasyPrint on Ubuntu: see [WeasyPrint install](https://doc.courtbouillon.org/weasyprint/stable/first_steps.html#installation) — e.g. `sudo apt install -y python3-pip python3-venv libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf2.0-0 libffi-dev shared-mime-info`.

