# Workbook reference — `Overall` sheet (`alert.theleetclub.com.xlsx`)

Source files:

- Committed: `apps/alert-theleetclub-com/alert.theleetclub.com.xlsx`
- Your copy: same structure verified against `Downloads/alert.theleetclub.com.xlsx` (2026).

**Header row:** **row 3** (rows 1–2 are layout / blank — not row 1).

Re-extract headers after workbook edits:

```bash
python3 scripts/inspect_alert_xlsx_headers.py apps/alert-theleetclub-com/alert.theleetclub.com.xlsx
```

## Overall — row 3 (column titles)

Column **A** = **Aspect** (row labels in the workbook). Data columns are **B–U** (20 metrics). The app does not render the **Aspect** column; it uses the same **20 metrics** in `overallWorkbookColumns.ts` / short headers in the UI.

| # | Column (workbook) | In the app (`/overall`) | Data source today |
|---|-------------------|-------------------------|-------------------|
| 1 | **Operating Hours** | Hours (compact) | Alert Admin machine profile → **Location hours** |
| 2 | **Vending Machine** | Machine | Vendon list + tag; snapshot fallback for names if Vendon empty |
| 3 | **Operator** | Operator | Admin `operator_hours[0].name`; else Red Alert snapshot operator |
| 4 | **Attendance** | Attend. | **—** (shift / clock-in — not wired) |
| 5 | **Last Cleaned** | Cleaned | Red Alert snapshot **`lastCleaningAt`** when set |
| 6 | **Last Vend Failed** | Vend fail | Snapshot frequency dispense-fail **counts** (today / WTD) |
| 7 | **Last Transaction** | Last tx | Snapshot timestamps or minutes since sale |
| 8 | **Sales Trend** | Trend | **?** (Vendon aggregates + compare preset — not wired) |
| 9 | **Target Achieved** | Target | **?** |
| 10 | **Peak Hours** | Peak | **?** |
| 11 | **Promotion** | Promo | **?** |
| 12 | **Highest Product** | Top SKU | **?** |
| 13 | **Lowest Product** | Low SKU | **?** |
| 14 | **People Count** | Footfall | **?** |
| 15 | **Customer Calls** | Calls | **?** |
| 16 | **Most Issue** | Issue | Snapshot **`reasons`** (latest line) when on Red Flags |
| 17 | **Last QA Check** | QA | **?** |
| 18 | **Last Tech. Check** | Tech | **?** |
| 19 | **Wastage %** | Waste % | **?** |
| 20 | **Promotion Runs** | Promos | **?** |

Snapshot-backed cells apply only to machines that appear in the **Red Flags** snapshot.

Column labels come from `src/features/overall/overallWorkbookColumns.ts` (full titles + notes on hover).
