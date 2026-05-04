# Workbook reference — `Red Flags` sheet (`alert.theleetclub.com.xlsx`)

Source file (committed): `apps/alert-theleetclub-com/alert.theleetclub.com.xlsx`  
Sheets: **Admin**, **Overall**, **Red Flags**.

Regenerate header preview:

```bash
python3 scripts/read_xlsx_headers.py
```

## Red Flags — row 1 (column titles)

Exact extraction from the workbook (column **A** = **Aspect** labels in the sheet; data columns start at **Vending Machine**):

| # | Column (workbook) | In the app (`/red-flags`) | Data source today |
|---|-------------------|---------------------------|-------------------|
| 1 | **Vending Machine** | **Vending Machine** | Machine name, ID, New/Updated/P2 chips, **Last tx** / **Last OFF** lines (Red Alert snapshot) |
| 2 | **Alert Type** | **Alert Type** | Primary alert copy from `reasons[]` (same family as Red Alert) |
| 3 | **Operator** | **Operator** | Live ops + cleaning (`getOperatorDisplay`) |
| 4 | **Frequency** | **Frequency** (subtitle follows compare preset) | `freqSplit()` / WTD vs baseline |
| 5 | **GO CHECK** | **GO CHECK** | `goCheckUrl` or mailto from strike operator |
| 6 | **Send Credit** | **Send Credit** | **—** (workbook thresholds — extend snapshot API) |
| 7 | **Vends Resolved** | **Vends Resolved** | **—** (workbook timing logic — extend snapshot API) |
| 8 | **Test Credits** | **Test Credits** | **—** (extend snapshot API) |
| 9 | **Last Cleaning** | **Last Cleaning** | **—** (Admin / live dashboard join — planned) |
| 10 | **QA Visit** | **QA Visit** | **—** (Workflow API — planned) |
| 11 | **Tech Visit** | **Tech Visit** | **—** (Workflow API — planned) |

Row click opens the **detail** dialog (full reasons, timestamps). The workbook does not name a **Details** column; we keep the modal for parity with operations.

### Row 2 notes (workbook)

Workbook describes Send Credit / Vends Resolved / Test Credits color rules and QA/Tech visit windows — implementation belongs in **people-api** snapshot rows when those metrics are ready.
