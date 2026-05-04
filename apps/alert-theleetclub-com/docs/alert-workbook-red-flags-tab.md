# Workbook reference — `Red Flags` sheet (`alert.theleetclub.com.xlsx`)

Source: product workbook **`Red Flags`** sheet — typically row **3** = column titles, row **4** = field notes/types (same pattern as `alert-workbook-admin-tab.md`).

**The `.xlsx` is not stored in git.** When the workbook changes, paste the header row into the table below and open a PR that updates this doc plus `src/features/redflags/redFlagsWorkbookColumns.ts` so visible titles stay aligned.

## Design intent

- **Look & feel:** Borrow Monitor **Red Alert** board patterns (density, chips, frequency graphic, row ranking) — **not** a pixel-perfect clone.
- **Columns:** Driven by this **Red Flags** sheet — the app table maps workbook columns to snapshot/API fields below.

## Column mapping (implementation)

| Workbook column (Red Flags sheet) | App column ( `/red-flags` ) | Data source |
|-----------------------------------|-----------------------------|-------------|
| **Machine** (vending machine / identity) | **Machine** | `machineName`, `machineId`, New/Updated/P2 chips, **last** alert line (`reasons`), **Last tx** / **Last OFF** lines (same block as Monitor Red Alert) |
| **Location** / site / owner | **Location** | `machineLocation` from snapshot (Vendon / site string on Red Alert row) |
| **Operator** (live + cleaning) | **Operator** | `operator` + `cleaningOperator` via `getOperatorDisplay()` |
| **Frequency** / WTD / trend (sheet name varies) | Dynamic heading (Compare preset) | `freqSplit()` — WTD, Today vs SW LW, or Today vs Yesterday |
| **Go check** | **Go check** | `goCheckUrl` or mailto from `strikeOperatorEmail` |
| **Details** | **Details** | Opens modal (full reasons + timestamps) |
| **PFA** | **PFA** | `pfaExcludeCleaning` |

### API / snapshot

Rows come from **`GET /api/alert/red-flags/snapshot`** (cached Red Alert payload). Shape: TypeScript **`RedAlertRow`** in `src/features/redflags/redAlertTypes.ts` — same family as Monitor v2 Red Alert.

### When the Excel headers differ

Rename strings only in **`redFlagsWorkbookColumns.ts`** (and this table). If a **new** workbook column needs data we do not expose yet, track it in the changelog and extend **people-api** snapshot rows first.
