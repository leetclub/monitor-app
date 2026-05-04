# Workbook reference — `Admin` tab (alert.theleetclub.com.xlsx)

Source: product workbook **Admin** sheet, row 3 (column titles) and row 4 (field types).  
Regenerate or diff when the xlsx changes; keep the **Machine profile** form in the app aligned with this.

| Column (workbook) | In the app (Machines tab) | Notes from workbook |
|-------------------|----------------------------|---------------------|
| Vending machine | **Vending machine** — `<select>` from synced Vendon list | Machine identity |
| Location owner | **Location owner** — **Vendon machine tag** when present (see `vendon_machine_tag_explicit` → `vendon_location_owner_tag` in API); else site/location fallback | Tag for location / grouping |
| Location hours | **Location hours** — 9 / 12 / 16 / 24 hrs | Drives Overall “Operating hours” context |
| Operating days | **Operating days** — All week / Weekends off / Custom weekdays | |
| Cleaning schedule | **Cleaning schedule** — start/end time windows | Green/yellow/red logic on monitors uses this |
| Operator hours | **Operator hours** — named people + time ranges | Multiple operators allowed |
| Technician | **Technician** — JSON schedule until visual editor | Visit days + hours; Workflow API |
| QA officer | **QA officer** — JSON schedule until visual editor | Visit days + hours; Workflow API |

Overall and Red Flags sheets describe **downstream** columns (fleet KPIs, alert columns); those screens consume Admin machine data where noted above. **Red Flags** table mapping: `docs/alert-workbook-red-flags-tab.md`.
