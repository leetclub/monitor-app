# Leet Alert — product overview (PM handoff)

**Purpose:** Readable **single document** for product managers and stakeholders. Share **`PRODUCT-PROTOTYPE.md`** or the generated **`PRODUCT-PROTOTYPE.pdf`** (same folder). Regenerate the PDF after edits: from this directory run **`npm run doc:pdf`**.

**Shipped UI:** The running app must **not** show words like “prototype”, “draft experiment”, or lab badges — operators see a normal product. **Roadmap, fidelity, and wireframes live only in this repo** (`PRODUCT-PROTOTYPE.md`, **`docs/product-prototype/visual-prototype.svg`**, PDF). Cursor workspace rule **`leet-alert-docs-with-app-changes.mdc`** reminds every agent to update doc + visual + PDF whenever Alert app code changes (any chat).

**App URL (production):** `https://alert.theleetclub.com` (ingress subject to cluster config; confirm with engineering.)

**Code:** `monitoring-app/apps/alert-theleetclub-com/`

---

## Visual reference (schematic, docs only)

Low-fidelity **SVG wireframe** (`visual-prototype.svg`) — **not** screenshots. It is **more detailed** than before: login, signed-in shell + Home, Red Flags (toolbar + compare strip + full column headers), Overall (fleet list), Admin (tabs + Machines panel + Team access editor concept).

**Maintain:** whenever routes or primary widgets change, edit **`docs/product-prototype/visual-prototype.svg`**, update this markdown if tables/copy shift, run **`npm run doc:pdf`**, commit **`.md` + `.svg` + `.pdf`**.

<figure>

![Leet Alert visual reference - login, shell, Red Flags, Overall, Admin](docs/product-prototype/visual-prototype.svg)

<figcaption>Figures 0–4: Login; shell + Home destination cards; Red Flags (chips, compare presets, table columns); Overall; Admin (Machines vs Team access overview).</figcaption>

</figure>

---

## Relationship to the shipped UI

- **In the app:** no “prototype” / lab / draft wording in the UI — same Google sign-in, permissions, and data as operators expect.
- **In this doc:** engineering/PM tracks **what is done vs evolving** (routes, KPI wiring, changelog). Treat **Known gaps** below as the “prototype roadmap” checklist, not terminology shown to users.

---

## Who uses it

| Audience | Typical need |
|----------|----------------|
| Operators | See machines that need attention (Red Flags), fleet roll-up (Overall). |
| Alert admins | Machine profiles (workbook **Admin** tab), **Who can use Alert** (Leet Alert–only toggles), optional full Monitor grid, legacy cleaning rules. |
| Product / PM | Validate journeys, copy, and prioritization of screens. |

---

## Information architecture (routes)

| Route | Name | What it is |
|-------|------|------------|
| `/` | Redirect | Sends signed-in users to **Home**. |
| `/home` | Home | Start screen: short intro and cards to Red Flags, Overall, and Admin (if allowed). |
| `/red-flags` | Red Flags | Machines currently failing checks; reasons column; compare date controls for future KPI wiring. |
| `/overall` | Overall | Full machine list and fleet-oriented view; KPI/compare detail evolves with data connections. |
| `/admin` | Admin | Tabs: **Machines** (xlsx Admin columns), **Who can use Alert** (steps 1–2 Leet Alert access; step 3 full Monitor JSON), **My access**, **Advanced** (substring cleaning). |
| `/login` | Login | Google sign-in; unauthenticated users only. |

---

## Permissions (plain language)

Access comes from the **same dashboard-access rules** as Monitor (`people-api`). Approximate mapping:

- **View Leet Alert** — can open Red Flags and Overall.
- **Manage Leet Alert settings** — can open Admin (machines, own access view; team editing only with org admin).
- **Org access admin** (Monitor “admin” capability) — can use **Who can use Alert** in Admin to add/remove Leet Alert access and open the full permission grid (step 3) when needed.

If someone can sign in but sees **No access**, they need a colleague with team-access rights to grant Leet Alert visibility.

---

## Data behavior

- Client polls/refetches on the order of **about one minute** for snapshot lists unless the user clicks **Refresh now**.
- Red Flags content reflects API `/api/alert/red-flags/snapshot` (machines with active reasons).
- Overall lists machines from `/api/alert/machines`.

---

## Deploy & operations

- **Image:** `programmeradmin25/alert-theleetclub-com:latest`
- **Kubernetes:** `Deployment` **`alert-app`**, namespace **`leet-monitor`**, label **`app=alert-app`**
- **Manifests:** `apps/alert-theleetclub-com/k8s/app.yaml`, `ingress.yaml`

Engineering runs from WSL: `npm run build` (optional local check), `docker build` + `docker push`, `kubectl rollout restart deployment/alert-app`, then verify pods (see repo deploy rule).

---

## Known gaps / not final (check with engineering)

- **Admin** sheet fields are reflected in the **Machines** tab (machine, owner, hours, days, cleaning, operators, technician/QA JSON). **Red Flags** / **Overall** workbook tabs list many more KPI columns (attendance, promotions, wastage, …) — those roll out as APIs and queries land; compare presets are wired in UI ahead of full metrics.
- Compare presets and KPI columns: UI is present; **full metric parity** depends on finalized data wiring from reporting/spec.
- Copy and visual hierarchy are tuned for operators; **final marketing naming** may differ.

---

## Changelog (keep this section updated)

When you change routes, permissions behavior, major copy, or roadmap items in **Known gaps**, **add a row** (newest first).

| Date (UTC) | Summary |
|------------|---------|
| 2026-05-01 | Admin tab **Who can use Alert**: dedicated shell + steps 1–3 (Leet Alert–only vs full Monitor grid); Machines aligned to xlsx **Admin** tab + **`docs/alert-workbook-admin-tab.md`**; tab subtitles; PRODUCT doc updated. |
| 2026-04-30 | Home hub (`/home`), sidebar hints; Team access in Admin; operator-facing copy on Red Flags / Overall. |
