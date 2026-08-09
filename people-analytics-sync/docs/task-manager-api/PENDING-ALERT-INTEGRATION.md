# Workflow / Task Manager — pending vs Alert needs

**Updated:** 2026-08-09  
**Source package:** Postman collection + `Task-Manager-API-New-Endpoints.pdf` (2026-07-28) — still the latest shared package on disk.  
**Live re-probe:** 2026-08-09 from people-api → `https://workflow.theleetclub.com`

## Live write APIs — verified 2026-08-03

| Check | Result |
|-------|--------|
| Reads (schedule, attendance, daily-checks, quality-control) | **200 OK** |
| `POST /api/v1/tasks/urgent-operator` | **201 Created** |
| `POST /api/v1/direct-messages` | **201 Created** |
| `POST /api/v1/notifications/cleaning-overdue` | **201 Created** |

Probe script: `people-analytics-sync/scripts/probe_tm_writes_vs_reads.py`

## Daily-checks Live updates (2026-08-09)

| Check | Result |
|-------|--------|
| `GET /api/v1/daily-checks?all=true&date=YYYY-MM-DD` | **200** (as before) |
| `GET /api/v1/daily-checks?all=true&from=&until=` | **200** — **now works** (was open as ask #6) |
| `review_status` + `vm_review` | Live samples: `pending` + `vm_review: null`; **`complete`** + full `vm_review` (`check_result_cleaned` / `refilled` / `presentable` / `camera`, `load_audit_type`) |
| Rejected sample | **Not seen yet** in recent days (only `pending` / `complete`) |

Alert client updated to:

- Prefer **from/until** for cleaning map/lookups (day-loop fallback).
- Parse Live `check_result_*` fields for CC verified green/red.

## Your six asks → status

| # | Need | Upstream | Alert / people-api | Still open |
|---|------|----------|--------------------|------------|
| **1** | POST urgent operator task → Received | `POST /api/v1/tasks/urgent-operator` | **Wired** — GO CHECK → TM; Slack fallback | **Live OK (201)** |
| **2** | POST message to scheduled operator | `POST /api/v1/direct-messages` | **Wired** — Call OP DM | **Live OK (201)** |
| **3** | GET last tech visit (`vendon_id`) | `GET /api/v1/quality-control` | **Wired** — QC + SC fallback | Confirm QC ≡ tech visit (Live QC returns visitor/date/issue/result) |
| **4** | POST cleaning-overdue → inbox | `POST /api/v1/notifications/cleaning-overdue` | **Wired** — Cleaning alert send | **Live OK (201)** |
| **5** | CC review approved/rejected samples | Live: `complete` + `vm_review` | Parser updated for `check_result_*` | Still want an explicit **rejected** sample if CC uses a status other than `complete` + failed checks |
| **6** | Daily-checks `from`/`until` / sync | **Live OK (200)** | Wired into cleaning fetch | Optional: webhook / `updated_since` still nice-to-have |

## Proxy routes

| Alert route | TM upstream |
|-------------|-------------|
| `POST /api/alert/workflow/go-check` | `POST /api/v1/tasks/urgent-operator` |
| `POST /api/alert/workflow/dm-operator` | `POST /api/v1/direct-messages` |
| `POST /api/alert/workflow/cleaning-overdue` | `POST /api/v1/notifications/cleaning-overdue` |
| `GET /api/alert/workflow/tech-visit` | `GET /api/v1/quality-control` (+ SC fallback) |
| `GET /api/alert/workflow/cleaning` / `cleaning-map` | `GET /api/v1/daily-checks` (`from`/`until`, fallback `date=`) |

## Postman note

Repo copy: `docs/task-manager-api/Task-Manager-API.postman_collection.json` (same endpoint set as Downloads `postman 2`, Jul 29).  
If Workflow shared a **newer** collection after that, drop it into `docs/task-manager-api/` (or Downloads) and we will re-diff.
