# Leet Alert — product roadmap (PM spec)

**Captured:** 2026-06-17  
**App:** `apps/alert-theleetclub-com/` · **API:** `people-analytics-sync` (people-api)

This document records **requested additions** vs **what ships today**. Implementation order is suggested at the end; nothing here is live until listed in `PRODUCT-PROTOTYPE.md` changelog.

---

## 1. QA column (Quality Control visits)

### Requested UX

| Surface | Content |
|---------|---------|
| **Table cell (outside)** | Last QA visit date/time (relative or short date) |
| **Popup (tap cell)** | Last visit · QA officer name · QA summary · **Download report** · **Contact officer** (email, Slack DM, WhatsApp) |
| **Go Check** | Button sends a **template message** linked to **Slack DM** (not mailto-only) |

### Monitor reference (v1 GAS)

- `visit-tracking-tab.js` — SafetyCulture (iAuditor) EU API
- `getLastVisitTracking()` — per location + role: `lastVisitDateStr`, `user`, `daysSinceVisit`, `auditId`
- `getSafetyCultureQAComparison()` — current vs previous visit scores
- Report = open `https://app.eu.safetyculture.com/inspections/{auditId}` (not a file download)
- Token: `SAFETY_CULTURE_API_TOKEN` (already in `monitoring-app-v2-secrets`)

### Alert today

- Red Flags **QA Visit** column: placeholder `?`
- Overall **Last QA Check**: manual `lastQcVisitAt` from Live Dashboard config only — **no** officer, summary, or audit link
- **Go Check**: `mailto:` to strike operator email from snapshot

### Build work

1. **people-api:** `GET /api/alert/qa/last-visits` (or enrich red-flags snapshot) — port SafetyCulture search from `visit-tracking-tab.js`; match machine name → location; cache 15–30 min
2. **people-api:** `GET /api/alert/qa/audit/:auditId` — summary fields for popup
3. **Alert UI:** `QaVisitCell` + `QaVisitModal` (mirror `SalesHistoryModal` pattern)
4. **Go Check:** Slack workflow — template text + `slackAppUrl` / chat.postMessage (needs bot token + channel or DM); keep mailto fallback
5. **Contact officer:** reuse `PersonContactModal` + `useOperatorContact` (email from audit user or manual map)

---

## 2. Target column (next to Daily sales)

### Requested UX

**Table cell (stacked, like sales column):**

- Today sales vs target **%** (elapsed Kuwait clock, same as sales column)
- Today **remaining** to target **%**
- Yesterday sales vs target **%**

**Popup (tap cell):**

- Location owner name
- **Week-to-date** sales vs target (KWD amount + %)
- **WTD achievement trend %** vs **same weekday last week** WTD — counted through **last complete sales day** (yesterday), not including partial today
- Progress bar — today: green glowing fill + grey remainder (% to daily target)
- Progress bar — week: same style for weekly target remainder
- **Contact location owner** — email, Slack, WhatsApp

### Data sources today

| Source | What it has |
|--------|-------------|
| `GET /api/live-dashboard/snapshot` | `salesToday`, `dailyTarget` per machine — **daily % only** |
| `GET /api/alert/overall/daily-sales-elapsed` | Today vs yesterday same clock (Red Flags sales stack) |
| `targets-theleetclub-com` | `weekRevenueTargets.json`, WTD logic in `areasPerformance.ts` — **not wired to Alert** |
| Admin machine profiles | `location_owner` text |

### Build work

1. **people-api:** `GET /api/alert/targets/summary?machine_ids=` — daily % + remaining % + yesterday % + WTD amounts/% + prior-week WTD compare (reuse targets app math)
2. **people-api:** location owner contact — Vendon area owners API or Admin profile + Slack map
3. **Alert UI:** insert **`dailyTarget`** column after **`dailySales`** on Red Flags (workbook order update + `TargetElapsedStack` component)
4. **Alert UI:** `TargetHistoryModal` with dual progress bars + owner contact section

---

## 3. Cleaning alert notifications (15-hour window)

### Requested UX

- Automated alert when a machine **has not been cleaned within 15 hours**
- Delivery: push notifications and/or **red-zone** visual on dashboard

### Alert / Monitor today

- **No fixed 15h rule in code.** Live Dashboard uses configurable `max_hours_without_cleaning` per machine → `CLEANING` alert in snapshot
- v1 Visit Tracking uses **15 days** (not hours) for QA visit overdue highlight — different product
- Red Flags **Last cleaning** column: snapshot time + Admin cleaning windows (on/off schedule colors)
- Scheduled DC cleaning windows → **P2** tier + frequency exclusions (not “overdue 15h”)

### Build work

1. **Product decision:** 15h global default vs per-machine threshold (extend Live Dashboard or Alert-only rule)
2. **people-api:** cleaning overdue evaluator on snapshot build or cron; flag `cleaningOverdue15h` on row
3. **Alert UI:** row/cell red-zone styling + optional browser push (needs permission + service worker) or Slack webhook digest

---

## 4. Column sorting

### Requested

- Highest sales **today**
- Highest sales **month** (calendar month or rolling 30d — confirm with ops)
- QC visits: **latest** first / **oldest** first

### Alert today

- Red Flags: fixed sort — alert tier → frequency (compare preset) → machine name (`rankRows`)
- Overall: name sort only
- **No clickable column headers**

### Build work

1. **Alert UI:** sort state on table headers (`SortableTh`); client sort for loaded snapshot
2. **people-api:** optional `?sort=` on snapshot for large fleets
3. Wire sales sort to `dailySales` / target stack values; QC sort after QA API exists

---

## 5. QC visit popup + document access

Same as §1 popup; emphasize:

- **Download report** → SafetyCulture inspection URL (or PDF export if API supports)
- Full document opens from popup CTA

---

## 6. Operator — last machine access + contact

### Requested UX

Under **Operator** column:

- Relative timestamp: “5 minutes ago”, “10 minutes ago” — **last time operator opened the machine**
- Contact: phone + email (partially shipped — tap name → modal; Call OP icons)

### Backend today

- `red_alert_routes.py` derives operator from latest **WEB cashless vend** per machine (`last_web_op`)
- Persisted to `machine_operator_live.last_credit_ts` — **not exposed on any GET API**

### Build work

1. **people-api:** add `operatorLastAccessAt` (+ optional `operatorLastAccessAgo`) to red-flags snapshot row
2. **Alert UI:** muted line under operator name in `OperatorCell` (`formatDistanceToNow`)
3. Contact: already via `/api/alert/operator-contact` + Vendon phone — verify all operators

---

## 7. Tech Visit column

Not detailed in latest message; workbook column exists as placeholder `?`. Likely parallel to QA with technician role filter in SafetyCulture — confirm role mapping with ops.

---

## Cross-cutting

| Need | Notes |
|------|--------|
| **Slack** | `monitoring-app-v2-secrets`: bot token + workspace id; dynamic `GET /api/alert/slack-user-map` (91 users) |
| **SafetyCulture** | Port from GAS to people-api; token in k8s secrets |
| **Week targets** | Share `weekRevenueTargets.json` or DB table with targets app |
| **PM docs** | Update `PRODUCT-PROTOTYPE.md` + wireframe SVGs per shipped slice |
| **Deploy** | people-api image + alert-app image (Azure `dev` sync per repo rules) |

---

## Suggested delivery phases

| Phase | Scope | Outcome |
|-------|--------|---------|
| **P1** | Operator last access on snapshot + API field; QA last-visit API + table cell + popup (read-only); Target column daily stack + popup (daily + WTD) | Core columns usable |
| **P2** | Go Check Slack template; QA contact + report link; Target owner contact; column sorting (sales + QC) | Ops workflow parity |
| **P3** | Cleaning 15h alerts + red-zone / push; Tech visit column; month sales sort | Alerts + polish |

---

## Open questions for PM / ops

1. **15 hours cleaning** — fixed globally or per machine? Same as Live Dashboard `max_hours_without_cleaning`?
2. **Month sales sort** — calendar month Kuwait, or rolling 30 days?
3. **QA officer contact** — always from SafetyCulture audit user email, or separate roster?
4. **Go Check Slack** — DM to operator only, or also post to a channel?
5. **Target column** — Red Flags only, or Overall too?
6. **Location owner** — Admin `location_owner` field, Vendon area owners, or targets app `areaOwners`?

---

## Related files

| Area | Path |
|------|------|
| Red Flags columns | `src/features/redflags/redFlagsWorkbookColumns.ts` |
| Monitor QA (reference) | `visit-tracking-tab.js` |
| Red Alert snapshot | `people-analytics-sync/red_alert_routes.py` |
| Targets math (reference) | `apps/targets-theleetclub-com/src/lib/areasPerformance.ts` |
| Operator contact | `people-analytics-sync/operator_contact_lib.py`, `src/components/PersonContactModal.tsx` |
| Live product doc | `PRODUCT-PROTOTYPE.md` |
