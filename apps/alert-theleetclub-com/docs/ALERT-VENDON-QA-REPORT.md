# Alert vs VENDON QA Reconciliation Report

**Generated:** 2026-09-10 (fleet suite ~17:20; **Products/YoY function suite ~21:04** Asia/Kuwait)  
**Artifacts:** `ALERT-VENDON-QA-RESULTS.json`, `ALERT-VENDON-FUNCTION-QA-RESULTS.json`, `ALERT-VENDON-QA-RESULTS-COMBINED.json`, `ALERT-VENDON-TEST-MATRIX.csv`  
**Method:** Read-only. Alert actual = `vendon_daily_machine_revenue_cache` (+ Products date windows via `resolve_perf_window`). VENDON expected = live `/stats/vends` customer sales (`payment_method != WEB_CASHLESS`).  
**Tolerance:** monetary ≤ **0.01 KD**.

### Coverage honesty (important)

The first suite was **fleet cache reconciliation**, not a full per-function audit. That gap is acknowledged.

**Phase 2 (executed 2026-09-10 evening)** added **Performance → Products** scenarios the first run missed: location + presets + **custom range vs same range last year**, Period A / Period B / YoY, multi-location MTD, zero site — each compared to **live Vendon** with the same machines and dates.

Method note: Products KPIs were validated through the **same source product-compare uses** (`resolve_perf_window` + Σ `total_sales_kwd`). Direct in-pod HTTP `product-compare` was attempted first and **OOM-killed (exit 137)**; KPI math path was used instead.

Still not fully exhausted (follow-ups): browser DOM UI, Footfall cashless HTTP, sales-acceleration, machine-products popup, hourly single-day product buckets, `includeWebCashless` SKU mix via HTTP.

---

## 1. Executive Summary

### Combined (fleet + Products/YoY function suite)

```text
Fleet suite:     38 scenarios (35 executed) — 33 MATCH, 2 MISMATCH, 3 BLOCKED UI
Products suite:  22 scenarios (22 executed) — 22 MATCH, 0 MISMATCH
Combined matrix: see ALERT-VENDON-TEST-MATRIX.csv / COMBINED.json
```

### Fleet suite (original)

```text
MATCH: 33 | MISMATCH: 2 | PASS RATE: 94.3%
Confirmed Alert defects: 1 (P2 product mix unnamed)
Data timing: 1 (open-day semi-live)
```

### Products / YoY function suite (new)

```text
Total / executed: 22
MATCH: 22 | MISMATCH: 0 | PASS RATE: 100%
Including: 1 location × Sep 1–7 2026 vs Sep 1–7 2025 (LY) — exact match
```

**Conclusion:** Closed-day fleet customer revenue matched Vendon. **Performance → Products Period A / B / YoY** (including custom location range vs last year) matched live Vendon **exactly** in all 22 executed cases. One **P2** mix defect remains (blank product names). Open-day lag is timing, not closed-day math.

> **DATA DIFFERENCE ≠ APPLICATION DEFECT.** TC-MIX is the confirmed Alert defect. TC-TODAY is timing. Products YoY path: no defect found in this run.

---

## 2. System/Data Mapping

### Metric definition map

| Alert Metric | Alert Source | Alert Calculation | VENDON Source | VENDON Calculation |
| --- | --- | --- | --- | --- |
| Fleet / location **actual revenue (KD)** | `vendon_daily_machine_revenue_cache.total_sales_kwd` via Red Flags / Overall / Performance APIs | `SUM(price)` for non-`WEB_CASHLESS` vends per Kuwait calendar day | Vendon `/stats/vends` | Same filter + Kuwait day window |
| Transaction count | `total_transactions` | Count of non-WEB vends | Same | Same |
| Product mix revenue | `payload_json.productSales` | Per named product `SUM(price)` excl WEB; **skips empty product name** | Same vends | Group by product name |
| Product mix (incl WEB) | `payload_json.productSalesAll` | Named products including WEB | Same | Incl WEB |
| Footfall `revenueKd` | Commercial footfall APIs | **Includes WEB cashless** | Full Vendon sales | Incl WEB |
| Footfall `revenueCashlessKd` / Alert “actual” | Cashless-excl path | Excl WEB | Customer sales | Excl WEB |
| Today semi-live | Cache refreshed `*/15` CronJob | Same build as closed days | Live Vendon | Continuous |

### Mapping example (primary KPI)

```text
Alert:
  Red Flags / Overall / Performance → Actual revenue (customer KD)

Alert API / DB:
  vendon_daily_machine_revenue_cache.total_sales_kwd
  built by _revenue_cache_machine_payload()

Business calculation:
  SUM(price) WHERE NOT WEB_CASHLESS, Asia/Kuwait day bounds

Expected VENDON equivalent:
  SUM(live /stats/vends price) same filter + day
```

### Cache / sync

| Item | Detail |
| --- | --- |
| Table | `vendon_daily_machine_revenue_cache` |
| Nightly | `vendon-revenue-cache` CronJob |
| Semi-live | `vendon-revenue-cache-semilive` `*/15` (today + yesterday + reconcile) |
| Audit | `vendon-revenue-cache-audit-fix` 09:30 / 18:30 UTC |
| Health | `GET /api/vendon/internal/cache-revenue-health` |
| Safe refresh | `POST /api/vendon/internal/cache-revenue` (documented; not used to mutate sales — rebuilds cache from Vendon) |

At run time heartbeat: `lastRefreshAt` ~280s before final TC-TODAY; `lastReconcileStatus=ok`.

---

## 3. Test Environment

| Item | Value |
| --- | --- |
| Timezone | Asia/Kuwait |
| Alert actual | people-api pod `people-analytics-api`, Postgres cache |
| VENDON expected | Live Vendon stats API via same pod credentials |
| Alert UI | Not authenticated this run → UI TCs BLOCKED |
| Destructive ops | None |
| Spec tolerance | 0.01 KD |

---

## 4. Test Coverage

| Dimension | Covered |
| --- | --- |
| Single day (14 days: 2026-08-27 → 2026-09-09) | Yes |
| Presets: Yday, day-before, WTD, last week, MTD, L7, L30 | Yes |
| Month start / Aug month-end / Aug→Sep transition | Yes |
| Top 5 + zero-activity locations | Yes |
| Multi-location (top 3 sum) | Yes |
| Product bottom-up (Σ productSales vs total) | Yes |
| WEB split (implied WEB from All − customer) | Yes |
| Open day (today) semi-live | Yes |
| Browser Overall / Red Flags / Footfall UI | BLOCKED |
| Random multi-product UI filters | Not executed (API product mix internal check only) |

---

## 5. Test Execution Summary

| Suite | Result |
| --- | --- |
| TC-DAY-* (14) | 14/14 MATCH (Δ 0.00) |
| TC-PRESET-* (7) | 7/7 MATCH |
| TC-BOUND-* (3) | 3/3 MATCH |
| TC-LOC-* (7) + MULTI | 8/8 MATCH |
| TC-WEB-SPLIT-YDAY | MATCH |
| TC-MIX-BOTTOM-UP-YDAY | FAIL — confirmed defect |
| TC-TODAY-SEMILIVE | FAIL — data timing |
| TC-UI-* (3) | BLOCKED |

---

## 6. Matching Scenarios (sample)

### 6a. Performance → Products (location / range / YoY) — executed Phase 2

Machine example: **Jaber Hospital - Gate 2** (`375535`) unless noted.

| ID | Criteria | Metric | VENDON | Alert | Diff | Result |
| --- | --- | --- | ---: | ---: | ---: | --- |
| TC-PC-CUSTOM-LOC-RANGE-A | Sep 1–7 2026 / Jaber Gate 2 | Period A KD | 2014.85 | 2014.85 | 0 | MATCH |
| TC-PC-CUSTOM-LOC-RANGE-LY-B | Sep 1–7 2025 / same location | Period B (= LY) | 1863.15 | 1863.15 | 0 | MATCH |
| TC-PC-CUSTOM-LOC-RANGE-YOY | Sep 1–7 2025 / YoY column | yoyKd | 1863.15 | 1863.15 | 0 | MATCH |
| TC-PC-YDAY-1LOC-A | Sep 9 / Jaber | Period A | 314.00 | 314.00 | 0 | MATCH |
| TC-PC-YDAY-YOY | Sep 9 2025 / Jaber | YoY | 354.65 | 354.65 | 0 | MATCH |
| TC-PC-LASTWEEK-1LOC-A | Aug 30–Sep 5 / Jaber | Period A | 2042.05 | 2042.05 | 0 | MATCH |
| TC-PC-LASTWEEK-YOY | Aug 30–Sep 5 2025 | YoY | 1843.05 | 1843.05 | 0 | MATCH |
| TC-PC-MTD-3LOC-A | Sep 1–10 / top 3 sites | Period A | 6321.00 | 6321.00 | 0 | MATCH |
| TC-PC-MTD-YOY | Sep 1–10 2025 / top 3 | YoY | 6766.95 | 6766.95 | 0 | MATCH |
| TC-PC-WTDVSLY-B | Sep 6–10 2025 / Jaber | WTD vs LY Period B | 1536.55 | 1536.55 | 0 | MATCH |
| TC-PC-LASTMONTH-YOY | Aug 2025 / Jaber | Last month YoY | 8086.25 | 8086.25 | 0 | MATCH |
| TC-OV-MTD-YOY-B | Sep 1–9 2025 / ALL fleet | MTD YoY fleet | 25786.26 | 25786.26 | 0 | MATCH |

### 6b. Fleet cache suite (sample)

| ID | Criteria | Metric | VENDON | Alert | Diff | Result |
| --- | ---: | --- | ---: | ---: | ---: | --- |
| TC-DAY-2026-09-09 | Sep 9 / ALL / ALL | Fleet customer KD | 3646.36 | 3646.36 | 0 | MATCH |
| TC-PRESET-MTD | Sep 1–9 / ALL | Fleet customer KD | 26386.76 | 26386.76 | 0 | MATCH |
| TC-PRESET-L30 | Last 30 closed days | Fleet customer KD | 84073.96 | 84073.96 | 0 | MATCH |
| TC-BOUND-MONTH-XITION | Aug 30–Sep 2 | Fleet customer KD | 13834.01 | 13834.01 | 0 | MATCH |
| TC-LOC-1-375535 | Sep 9 / Jaber Gate 2 | Machine KD | 314.00 | 314.00 | 0 | MATCH |
| TC-LOC-MULTI-TOP3 | Sep 9 / top 3 machines | Sum KD | 700.60 | 700.60 | 0 | MATCH |
| TC-LOC-6-325250 | Sep 9 / zero site | Machine KD | 0 | 0 | 0 | MATCH |

Full rows: `ALERT-VENDON-QA-RESULTS.json` / `ALERT-VENDON-TEST-MATRIX.csv`.

---

## 7. Mismatch Scenarios

### TC-MIX-BOTTOM-UP-YDAY

| Field | Value |
| --- | --- |
| Criteria | 2026-09-09 / ALL locations / product mix bottom-up |
| VENDON / Alert total (customer) | **3646.36** (cache total matches live) |
| Σ productSales (Alert) | **3643.96** |
| Abs / % | **−2.4** / **−0.0658%** |
| Reproducible | Yes (machine-level) |
| Record drill-down | Farwaniya Main gate (`375531`): customer 195.35; named mix 192.95; **unnamed 2.4**; WEB 2.5; 201 vends |
| Cache | Not stale — total matches live |
| Classification | **CONFIRMED ALERT DEFECT** |
| Priority | **P2** |
| Alert defect? | **YES** (mix vs total internal inconsistency) |

Root cause in code (`_revenue_cache_machine_payload`): customer totals always `+= price`, but `productSales` only updates when `prod_name` is truthy. Blank names disappear from Performance product breakdowns while still counting in fleet KPIs. Other code paths use `"Unknown Product"`; this path does not.

### TC-TODAY-SEMILIVE

| Field | Value |
| --- | --- |
| Criteria | 2026-09-10 (open day) / ALL |
| VENDON live | **2744.50** |
| Alert cache | **2732.10** |
| Abs / % | **−12.40** / **−0.45%** |
| Heartbeat age | ~280s after last refresh |
| Reproducible | Expected while day is open and sales continue |
| Classification | **DATA_TIMING_DIFFERENCE** |
| Alert calculation defect? | **NO** (closed days Δ=0) |

---

## 8. Full Mismatch Register

| ID | Criteria | Metric | VENDON | Alert | Abs Diff | % Diff | Classification |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| TC-MIX-BOTTOM-UP-YDAY | Sep 9 / ALL / mix | Σ productSales vs total | 3646.36 | 3643.96 | −2.40 | −0.066% | CONFIRMED_ALERT_DEFECT |
| TC-TODAY-SEMILIVE | Sep 10 / ALL | Today fleet KD | 2744.50 | 2732.10 | −12.40 | −0.452% | DATA_TIMING_DIFFERENCE |

---

## 9. Cache Investigation

- Closed days 2026-08-27…2026-09-09: cache ≡ live (Δ 0.00) → **not stale**.
- Semi-live heartbeat healthy at run (`lastReconcileStatus=ok`).
- Today lag (~12.4 KD / ~0.45%) consistent with ≤15-minute refresh + ongoing sales.
- Safe refresh exists (`POST .../cache-revenue`); not required for closed-day PASS set.

---

## 10. Date/Timezone Investigation

- Day windows use **Asia/Kuwait** midnight bounds converted to UTC for Vendon fetch.
- Inclusive calendar days `[from, to]` for multi-day presets.
- Month start (Sep 1), Aug 31, and Aug 30–Sep 2 transition all matched → no off-by-one day bug in tested range.

---

## 11. Filter Validation

| Filter | Result |
| --- | --- |
| All locations | MATCH (presets + days) |
| Single high-volume location | MATCH (5 machines) |
| Zero-activity location | MATCH (0=0) |
| Multi-location sum | MATCH (top 3) |
| Product mix vs total | FAIL (unnamed omitted) — see §7 |

---

## 12. Cross-Tab Consistency

- Same underlying cache field feeds Overall / Red Flags / Performance fleet KPIs → consistent for customer KD.
- Product tab (Σ `productSales`) can under-read vs fleet total when unnamed products exist → **ALERT INTERNAL INCONSISTENCY** (confirmed).
- Footfall `revenueKd` **must not** be cross-compared to Alert “actual” without using cashless-excl field (definition difference).

---

## 13. Bottom-Up Reconciliation

| Check | Expected | Observed |
| --- | --- | --- |
| Daily components → range totals | Sum of TC-DAY within MTD/L7 | Consistent with presets (fleet totals matched live) |
| Location components → multi | Top3 sum | MATCH 700.60 |
| Product components → fleet total | Σ productSales = total | **FAIL** −2.4 KD |

---

## 14. Root Cause Classification

| ID | Classification | Defect? |
| --- | --- | --- |
| TC-MIX-BOTTOM-UP-YDAY | CONFIRMED ALERT DEFECT | Yes — mix bucket logic |
| TC-TODAY-SEMILIVE | DATA TIMING DIFFERENCE | No |
| Closed-day fleet | OK | No |
| Footfall revenueKd | EXPECTED BUSINESS RULE (definition) | N/A — do not treat as defect vs customer sales |

---

## 15. Confirmed Defects

### P2 — Product mix omits unnamed products

- **Where:** `people-analytics-sync/vendon_proxy_routes.py` → `_revenue_cache_machine_payload`
- **Impact:** Performance Products / mix charts understate revenue vs fleet KPIs when Vendon returns blank product names.
- **Evidence:** 2026-09-09 Farwaniya Main gate unnamed customer KD = 2.4; fleet total still correct vs Vendon.
- **Suggested fix:** Bucket empty names as `"Unknown Product"` (or equivalent) in both `productSales` and `productSalesAll`, matching other Alert paths. Re-cache affected days after fix.
- **Not:** A fleet total vs Vendon defect (those matched).

No P0/P1 fleet-total defects found in this run.

---

## 16. Blocked Tests

| ID | Why blocked |
| --- | --- |
| TC-UI-OVERALL-KPIS | No authenticated browser session to Alert UI |
| TC-UI-REDFLAGS | Same |
| TC-UI-FOOTFALL-REV | Same + definition note only |

Underlying APIs for Overall/Red Flags revenue were covered by TC-DAY / TC-PRESET.

---

## 17. Recommendations

1. **Fix** unnamed product bucketing in `_revenue_cache_machine_payload`; add a unit/regression test: blank name still appears in mix and Σ mix = total (excl WEB).
2. **Keep** semi-live 15m for today; document UI copy that “today” may lag live by up to refresh interval.
3. **Footfall QA:** always reconcile `revenueCashlessKd` (or Alert actual) to Vendon customer sales — never raw `revenueKd` alone.
4. **Optional follow-up:** authenticated Playwright scrape of KPI DOM vs same API numbers (UI-only class).
5. **Ops:** rotate any API keys that appeared in historical debug `set -x` CronJob logs (prior incident).

---

## 18. Evidence / Reproduction Details

```bash
# Inside people-api pod (read-only compare)
# Script used: people-analytics-sync/scripts/_tmp_alert_vendon_full_qa.py
# Runner: people-analytics-sync/scripts/_tmp_run_full_qa.sh

# Farwaniya unnamed drill-down (2026-09-09):
# customer=195.35 named=192.95 unnamed=2.4 web=2.5 n_vends=201
```

Mismatch checklist answers (TC-MIX):

1. Criteria: 2026-09-09, ALL locations, Σ productSales vs total_sales_kwd  
2. VENDON / Alert total: 3646.36 (match)  
3. Alert mix sum: 3643.96  
4. Diff: −2.4 KD  
5. %: −0.0658%  
6. Reproducible: yes  
7. Cache: no (totals fresh)  
8. Timing: no  
9. Timezone: no  
10. Business definition: mix silently drops blank names (bug vs “Unknown Product” elsewhere)  
11. Record-level: yes — Farwaniya Main gate  
12. Root cause: `if prod_name:` gate in payload builder  
13. Confirmed Alert defect: **YES** (P2)

Mismatch checklist answers (TC-TODAY):

1. 2026-09-10 ALL  
2. Live 2744.50  
3. Cache 2732.10  
4. −12.4  
5. −0.45%  
6. Expected while day open  
7. Semi-live cadence involved  
8. Timing: yes  
9–11. N/A for defect  
12. Open-day lag  
13. Confirmed Alert defect: **NO**
