# Workflow / Task Manager — pending vs Alert needs

**Updated:** 2026-07-29  
**Source package:** Postman collection + `Task-Manager-API-New-Endpoints.pdf` (2026-07-28)  
**Dev note:** Daily checks API is still under development (#5 / #6).

---

## Your six asks → status

| # | Need | Upstream | Alert / people-api | Still open |
|---|------|----------|--------------------|------------|
| **1** | POST urgent operator task → Received | `POST /api/v1/tasks/urgent-operator` | **Wired** — GO CHECK → TM Received; Slack/mailto fallback | **Live returns HTTP 500** (probed 2026-07-30). Slack fallback used until Workflow fixes. |
| **2** | POST message to scheduled operator | `POST /api/v1/direct-messages` | **Wired** — Call OP modal sends TM DM | **Live returns HTTP 500** |
| **3** | GET last tech visit (`vendon_id`) | `GET /api/v1/quality-control` | **Wired** — tech-visit proxy prefers QC; SafetyCulture fallback | Confirm QC ≡ tech visit with Workflow team |
| **4** | POST cleaning-overdue → inbox | `POST /api/v1/notifications/cleaning-overdue` | **Wired** — Cleaning alert modal Workflow channel | **Live returns HTTP 500** |
| **5** | CC review approved/rejected samples | Daily checks still evolving | Parser ready for `review_status` / `vm_review` when present | **Need samples from Workflow** |
| **6** | Daily-checks `from`/`until` / sync | Not on daily-checks yet (QC has range) | Still day-loop lookback | **Need from Workflow** |

## Proxy routes

| Alert route | TM upstream |
|-------------|-------------|
| `POST /api/alert/workflow/go-check` | `POST /api/v1/tasks/urgent-operator` |
| `POST /api/alert/workflow/dm-operator` | `POST /api/v1/direct-messages` |
| `POST /api/alert/workflow/cleaning-overdue` | `POST /api/v1/notifications/cleaning-overdue` |
| `GET /api/alert/workflow/tech-visit` | `GET /api/v1/quality-control` (+ SC fallback) |
