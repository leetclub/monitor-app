# Leet Alert — product scope (PM / PO)

**App:** [alert.theleetclub.com](https://alert.theleetclub.com) · **Repo:** `apps/alert-theleetclub-com/`  
**Refresh PDF:** `npm run doc:pdf` (commit md + `figures/wire-*.svg` + `PRODUCT-PROTOTYPE.pdf`).  
Shipped UI has no “prototype” wording — wireframes are documentation only.

---

## Routes & capabilities

| Route | Area | What users get |
|-------|------|----------------|
| `/` | Entry | Redirect to **Home**. |
| `/login` | Login | Google sign-in. |
| `/home` | Home | Cards: **Red Flags** → **Overall** → **Admin** (if role allows). |
| `/red-flags` | Red Flags | Monitor **Red Alert**–style table: only machines with **active violations**; five **timespan presets** (incl. Today VS Yesterday default); ~1 min refresh. |
| `/overall` | Overall | **All** machines + snapshot columns; same timespan presets; **KPI** cells for workbook metrics when wired; ~1 min refresh. |
| `/admin` | Admin | User-entered data **not on Vendon** (schedules, cleaning, access). **Machines** (profiles, Vendon readout), **Who can use Alert**, **My access**, **Advanced**. |

---

## Permissions (summary)

**people-api** rules (same store as Monitor): view → Red Flags + Overall; **leetAlertAdmin** → Admin; org **admin** → edit **Who can use Alert** + optional Monitor grid. No entitlements → **No access** after sign-in until an admin grants access.

---

## Visual UI prototype (figures 0–4)

Aligned with current React shell (`App.tsx`), Home (“Choose a workspace”), and Admin vertical sections (`AdminPage.tsx`).

![0 Login](docs/product-prototype/figures/wire-00-login.svg)

*Figure 0 — Login*

![1 Shell + Home](docs/product-prototype/figures/wire-01-shell-home.svg)

*Figure 1 — Sidebar **Operations**; nav Home · Admin · Red Flags · Overall; Home hero + cards (Priority / Fleet / Configuration).*

![2 Red Flags](docs/product-prototype/figures/wire-02-red-flags.svg)

*Figure 2 — Toolbar, compare preset, table.*

![3 Overall](docs/product-prototype/figures/wire-03-overall.svg)

*Figure 3 — Same compare pattern; fleet table.*

![4 Admin](docs/product-prototype/figures/wire-04-admin.svg)

*Figure 4 — Settings header; **Sections** sidebar (Machines active); Machines tab — machine picker, location owner datalist, Vendon tag.*

**Composite SVG (all panels):** `docs/product-prototype/visual-prototype.svg`

---

## PO quick facts

- Lists refetch ~**1 min**; **Refresh now** on each screen.
- Admin order: **Machines → Who can use Alert → My access → Advanced** (team tab only if org admin).

---

## Changelog

| Date (UTC) | Summary |
|------------|---------|
| 2026-05-04 | Admin **Machines**: Location owner driven by **Vendon machine tag** first; Technician/QA JSON help (`[]` empty); time zone + priority copy (priority from cleaning-schedule sync); GET profiles return **priority**. |
| 2026-05-02 | **Timespan presets** (Today VS Yesterday default, +4) on Red Flags & Overall; Admin = data not on Vendon; five **figure SVGs** + PDF; Red Flags = Monitor Red Alert style. |
| 2026-05-01 | **Who can use Alert** steps; Machines vs workbook Admin; PO doc + PDF raster. |
| 2026-04-30 | Home hub; team access in Admin. |
