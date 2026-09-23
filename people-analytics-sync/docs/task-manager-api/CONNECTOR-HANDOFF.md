# Workflow / Task Manager API — connector handoff

**For:** other product teams wiring connectors to Leet Workflow  
**Live base:** `https://workflow.theleetclub.com`  
**Auth:** header `X-Api-Key: <key>` on all `/api/v1/*` routes below (except Mobile company auth, which uses Bearer after login)  
**Package date:** 2026-09-23 (includes Omar’s **API Pull Data View** folder)  
**Postman:** `Task-Manager-API.postman_collection.json` + Live/Test environment examples in this folder  

Do **not** commit real API keys. Copy `*-environment.example.json` and set `api_key` locally.

---

## 1. What was tested (Live, 2026-09-23)

| Group | Endpoint | Result |
|-------|----------|--------|
| **NEW — API Pull Data View** | `GET /api/v1/vm-technical-issues` | **200** (473 tickets) |
| | `GET /api/v1/vm-technical-issues/{ticket_id}` | **200** (`TI-000473`) |
| | `GET /api/v1/tasks` | **200** (439 tasks) |
| | `GET /api/v1/tasks/{id}` | **200** |
| | `GET /api/v1/projects` | **200** |
| | `GET /api/v1/projects/{id}` | **200** |
| Existing reads | schedule-periods, attendance/users, daily-checks (`date` + `from`/`until`), quality-control | **200** |
| Filters | tech `status=open` | **200** |
| | task `status=open` | **422** — use `pending` / `in_progress` / `completed` / `cancelled` |
| | project query `status=active` | **200** (accepted; confirm with Workflow if unused) |

Writes (`urgent-operator`, `direct-messages`, `cleaning-overdue`) were verified earlier (201). Re-test before production automations.

---

## 2. Full catalog (arranged for connectors)

### A. API Pull Data View — **new view-only** (Mohammed Albaba request)

Read-only. Full detail on list rows. Pagination: `page`, `per_page` (max **100**). Response shape: `{ data: [...], pagination: { page, per_page, total, total_pages, has_next_page, has_prev_page } }`.

#### VM technical issues

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/v1/vm-technical-issues` | List. Filters: `vendon_id`, `user_id`, `date` **or** `from`+`until`, `status` (`open` \| `in_progress` \| `resolved`), `maintenance_tag`, `technical_issue_type_id`, `ticket_id`, `search`, `assigned_technician_user_id` |
| GET | `/api/v1/vm-technical-issues/{ticket_id}` | Detail by ticket (e.g. `TI-000473`). Optional scope: `vendon_id`, `user_id` |

**Useful fields:** `ticket_id`, `vendon_id`, `status`, `maintenance_tag`, `description`, `issue_type`, `machine`, `submitted_by`, `assigned_technician`, `fix` (duration / approved), `media` / `images` / `videos`, `report_date`, `created_at`.

#### Tasks

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/v1/tasks` | Full detail list. Filters: `user_id`, `assignee_user_id`, `issuer_user_id`, `status` (`pending` \| `in_progress` \| `completed` \| `cancelled`), `priority`, `search` |
| GET | `/api/v1/tasks/{id}` | Same payload for one task |

**Useful fields:** `id`, `title`, `status`, `priority`, `type`, `assignee` / `user_id`, `issuer`, `department`, `start_date` / `end_date`, `attachments` / `images` / `videos`, `checklist_items`, `messages`, `status_change_logs`.

#### Projects

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/v1/projects` | Full detail list. Filters: `user_id`, `department_head_user_id`, `step_assignee_user_id`, `date` or `from`+`until`, `search` |
| GET | `/api/v1/projects/{id}` | Same payload for one project |

**Useful fields:** `id`, `name`, `start`/`end`, `percent_done`, `completion`, `steps[]`, department-head assignees.

---

### B. Schedule & attendance (already used by Alert)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/schedule-periods` | Published periods; `?all=true`, `?active=true`, `?published=false`, `?from=&to=` |
| GET | `/api/v1/schedule-periods/{id}` | Period detail (assignments / machines) |
| GET | `/api/v1/attendance/users?all=true` | Attendance user list |
| GET | `/api/v1/attendance/users/{user_id}?date=` | One day |
| GET | `/api/v1/attendance/users/{user_id}/days?from=&until=` | Range |

### C. Daily checks (Last clean)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/daily-checks?all=true&date=` | One Kuwait day |
| GET | `/api/v1/daily-checks?all=true&from=&until=` | Range (Live OK) |
| GET | `/api/v1/daily-checks?...&vendon_id=` | Filter machine |
| GET | `/api/v1/daily-checks/{id}` | Detail + media + `vm_review` |

### D. Quality control (tech visit source)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/quality-control?vendon_id=&all=true` | QC visits for machine |
| GET | `/api/v1/quality-control/{id}` | Visit detail |

### E. Writes (Alert GO CHECK / DM / cleaning overdue)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/v1/tasks/urgent-operator` | Urgent Received task (JSON or multipart) |
| POST | `/api/v1/direct-messages` | System DM to operator |
| POST | `/api/v1/notifications/cleaning-overdue` | Cleaning-overdue inbox DM |

### F. Mobile — company auth / profile (**not** for server connectors)

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/v1/mobile/auth/login` | Company user login → Bearer token |
| GET | `/api/v1/mobile/auth/me` | Current user |
| POST | `/api/v1/mobile/auth/logout` | Logout |
| GET/PATCH | `/api/v1/mobile/profile` | Profile (JSON or multipart) |

Prefer **X-Api-Key** server-to-server connectors. Mobile folder is for the company app, not Alert/BFF keys.

---

## 3. Alert app mapping

| Alert need | Upstream | Status |
|------------|----------|--------|
| Attendance / Live Op | schedule + attendance | **Wired** |
| Last clean | daily-checks | **Wired** |
| Tech visit (QC) | quality-control (+ SC fallback) | **Wired** |
| GO CHECK / Call OP DM / cleaning overdue | writes in §E | **Wired** |
| **Active technical issues / tech fixing** | **vm-technical-issues** | **API ready** — people-api proxy added 2026-09-23: `GET /api/alert/workflow/technical-issues`, `.../technical-issues-map` |
| Customer calls | — | **Still missing** — not in this collection |
| Tasks / projects dashboards | tasks, projects | Available for Workflow/connectors; Alert UI not required yet |

---

## 4. people-api proxies (Alert session auth)

Base: Alert same-origin `/api/alert/workflow/*` → Task Manager with server key.

| Alert route | Upstream |
|-------------|----------|
| `GET .../operator-schedule` | schedule + attendance |
| `GET .../machine-attendance-map` | batch attendance |
| `GET .../cleaning` / `cleaning-map` | daily-checks |
| `GET .../tech-visit` | quality-control |
| `GET .../technical-issues` | vm-technical-issues (active open/in_progress) |
| `GET .../technical-issues-map` | batch active issues |
| `POST .../go-check` | urgent-operator |
| `POST .../dm-operator` | direct-messages |
| `POST .../cleaning-overdue` | cleaning-overdue |

---

## 5. Quick curl examples

```bash
BASE=https://workflow.theleetclub.com
KEY=YOUR_KEY

# Active tech issues for a machine
curl -sS -H "X-Api-Key: $KEY" -H "Accept: application/json" \
  "$BASE/api/v1/vm-technical-issues?vendon_id=417279&status=open&per_page=25"

# Tasks pending
curl -sS -H "X-Api-Key: $KEY" -H "Accept: application/json" \
  "$BASE/api/v1/tasks?status=pending&page=1&per_page=25"

# Projects
curl -sS -H "X-Api-Key: $KEY" -H "Accept: application/json" \
  "$BASE/api/v1/projects?page=1&per_page=25"
```

Probe helper (from people-analytics-sync):

```bash
python3 scripts/_tmp_probe_pull_data_view.py
```

---

## 6. Files in this package

| File | Purpose |
|------|---------|
| `CONNECTOR-HANDOFF.md` | This doc |
| `Task-Manager-API.postman_collection.json` | Full collection (api_key redacted) |
| `Task-Manager-API-Live.postman_environment.example.json` | Live base URL |
| `Task-Manager-API-Test.postman_environment.example.json` | Staging base URL |
| `README.md` | Alert-oriented overview |
| `PENDING-ALERT-INTEGRATION.md` | Historical Alert asks tracker |

Ask Workflow for a dedicated connector API key if you should not share the Alert BFF key.
