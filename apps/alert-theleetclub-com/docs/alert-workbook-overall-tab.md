# Workbook reference — `Overall` sheet (`alert.theleetclub.com.xlsx`)

Source file (committed): `apps/alert-theleetclub-com/alert.theleetclub.com.xlsx`  
Sheet: **Overall**

Header preview (re-run after workbook edits):

```bash
python3 scripts/read_xlsx_headers.py
```

## Overall — row 1 (column titles)

Exact extraction from the workbook (column **A** = **Aspect**; data columns start at **Operating Hours**):

| # | Column (workbook) | In the app (`/overall`) | Data source today |
|---|-------------------|-------------------------|-------------------|
| 1 | **Operating Hours** | Operating Hours | From Admin profile: `location_hours` + `location_owner` (tag) |
| 2 | **Vending Machine** | Vending Machine | Vendon machine name + ID |
| 3 | **Operator** | Operator | From Admin profile `operator_hours[0].name` (fallback: snapshot operator) |
| 4 | **Attendance** | Attendance | **—** (needs shift/clock-in API wiring) |
| 5 | **Last Cleaned** | Last Cleaned | **—** (needs cleaning record + schedule evaluation) |
| 6 | **Last Vend Failed** | Last Vend Failed | **—** (Vendon field not exposed in snapshot payload yet) |
| 7 | **Last Transaction** | Last Transaction | From Red Alert snapshot (`lastTransactionAtUtc` or minutes) |
| 8 | **Sales Trend** | Sales Trend | **—** (Vendon sales aggregates + compare preset) |
| 9 | **Target Achieved** | Target Achieved | **—** |
| 10 | **Peak Hours** | Peak Hours | **—** |
| 11 | **Promotion** | Promotion | **—** |
| 12 | **Highest Product** | Highest Product | **—** |
| 13 | **Lowest Product** | Lowest Product | **—** |
| 14 | **People Count** | People Count | **—** |
| 15 | **Customer Calls** | Customer Calls | **—** |
| 16 | **Most Issue** | Most Issue | **—** |
| 17 | **Last QA Check** | Last QA Check | **—** |
| 18 | **Last Tech. Check** | Last Tech. Check | **—** |
| 19 | **Wastage %** | Wastage % | **—** |
| 20 | **Promotion Runs** | Promotion Runs | **—** |

Column labels come from `src/features/overall/overallWorkbookColumns.ts`.

