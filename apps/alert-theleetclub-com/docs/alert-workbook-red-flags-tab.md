# Workbook reference — `Red Flags` sheet (`alert.theleetclub.com.xlsx`)

Source files:

- Committed: `apps/alert-theleetclub-com/alert.theleetclub.com.xlsx`
- Verified against: `Downloads/alert.theleetclub.com.xlsx` (same structure).

**Header row:** **row 5** (not row 1 — rows above are title / spacing).

Re-extract headers:

```bash
python3 scripts/inspect_alert_xlsx_headers.py apps/alert-theleetclub-com/alert.theleetclub.com.xlsx
```

## Red Flags — row 5 (workbook vs app)

The workbook has **12** header cells from **Aspect** through **Tech Visit** (11 data columns after **Aspect**).

The live app adds **two** operator columns after **Tech Visit** (not in this xlsx file):

| Workbook # | Column (workbook) | In the app (`/red-flags`) | Data source today |
|------------|-------------------|---------------------------|-------------------|
| 1 | **Vending Machine** | Vending Machine | Name, ID, chips, last tx / OFF lines (snapshot) |
| 2 | **Alert Type** | Alert Type | `reasons[]` summary |
| 3 | **Operator** | Operator | `getOperatorDisplay` |
| 4 | **Frequency** | Today / Trend (dynamic subtitle) | `freqSplit()` + compare preset |
| 5 | **GO CHECK** | GO CHECK | `goCheckUrl` / mailto |
| 6 | **Send Credit** | **Credits Sent** (renamed in UI) | Remote credits count (today, Kuwait) |
| 7 | **Vends Resolved** | Vends Resolved | Placeholder **?** until API |
| 8 | **Test Credits** | **Dispense Tests** (renamed in UI) | Drink-test count (today, Kuwait) |
| 9 | **Last Cleaning** | Last Cleaning | Timestamp when snapshot provides it |
| 10 | **QA Visit** | QA Visit | Placeholder **?** until wired |
| 11 | **Tech Visit** | Tech Visit | Placeholder **?** until wired |
| — | *(not in workbook)* | **Call OP** | Slack DM / mailto (app-only) |
| — | *(not in workbook)* | **Call AM** | Slack DM (app-only) |

Row click opens the **detail** modal (no **Details** column in the workbook).

### Row 6+ notes (workbook)

Workbook body rows describe Send Credit / Vends Resolved / Test Credits rules and QA/Tech windows — implementation continues in **people-api** snapshot + feeds when those metrics are ready.
