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
| `/red-flags` | Red Flags | **Red Alert** snapshot; columns match `alert.theleetclub.com.xlsx` **Red Flags** row 1 (see `docs/alert-workbook-red-flags-tab.md`); trailing columns **—** until API wires workbook metrics; five **timespan presets**; ~1 min refresh. |
| `/overall` | Overall | Workbook **Overall** sheet columns (see `docs/alert-workbook-overall-tab.md`); Admin-derived Operating Hours + Operator + snapshot Last Transaction; other workbook metrics show **—** until API wiring; ~1 min refresh. |
| `/admin` | Admin | User-entered data **not on Vendon** (schedules, cleaning, access). **Machines** (profiles, Vendon readout), **Who can use Alert**, **My access**, **Advanced**. |

---

## Permissions (summary)

**people-api** rules (same store as Monitor): view → Red Flags + Overall; **leetAlertAdmin** → Admin and edit **Who can use Alert** (same session rules API as Monitor **admin**); optional Monitor grid in **Advanced**. Adding people is limited to your Google Workspace domain(s): env **`ACCESS_ALLOWED_EMAIL_DOMAINS`** / **`DASHBOARD_ACCESS_EMAIL_DOMAINS`**, else the signed-in admin’s domain. No entitlements → **No access** after sign-in until an admin grants access.

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
| 2026-05-05 | **Admin → Location owner:** people-api parses **machine/fleet tags** only (validated short codes, nested `machine_tag` fields, fleet `group` — never raw `tags_display` / site strings); hint when Vendon yields no tag so legacy DB values can be cleared. |
| 2026-05-02 | **Who can use Alert** — org email domain allowlist (server + UI); **leetAlertAdmin** can save access rules. Red Alert / machine **location** text prefers Vendon **tags** and machine tag fields before the generic Vendon `location` string (aligns with Admin “location owner” / machine tag). |
| 2026-05-04 | **Red Flags** = **xlsx** column order (through **Tech Visit**); `alert.theleetclub.com.xlsx` in repo; `redFlagsWorkbookColumns.ts`; placeholders for columns not in snapshot; machine / alert split; **Admin** tag/priority (other row). |
| 2026-05-02 | **Timespan presets** (Today VS Yesterday default, +4) on Red Flags & Overall; Admin = data not on Vendon; five **figure SVGs** + PDF; Red Flags = Monitor Red Alert style. |
| 2026-05-01 | **Who can use Alert** steps; Machines vs workbook Admin; PO doc + PDF raster. |
| 2026-04-30 | Home hub; team access in Admin. |
