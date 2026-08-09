"""HTTP client for Leet Task Manager read API (/api/v1/*)."""

from __future__ import annotations

import logging
import os
import time
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

import requests

logger = logging.getLogger(__name__)

_KWT = ZoneInfo("Asia/Kuwait")
_BASE = (os.environ.get("LEET_WORKFLOW_API_BASE") or "").strip().rstrip("/")
_API_KEY = (os.environ.get("LEET_WORKFLOW_API_KEY") or os.environ.get("TASK_MANAGER_API_KEY") or "").strip()
_TIMEOUT = int(os.environ.get("LEET_WORKFLOW_API_TIMEOUT_SEC", "30"))

_WEEKDAY_KEYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")

_CACHE: Dict[str, Tuple[float, Any]] = {}
_PERIOD_TTL = 300.0
_ATTENDANCE_DAY_TTL = float(os.environ.get("ALERT_WORKFLOW_ATTENDANCE_DAY_CACHE_SEC", "120"))


def task_manager_configured() -> bool:
    return bool(_BASE and _API_KEY)


def kuwait_today() -> date:
    return datetime.now(_KWT).date()


def weekday_key(d: date) -> str:
    return _WEEKDAY_KEYS[d.weekday()]


def _headers() -> Dict[str, str]:
    return {"Accept": "application/json", "X-Api-Key": _API_KEY}


def _get(path: str, params: Optional[Dict[str, Any]] = None) -> Tuple[Optional[Any], Optional[str]]:
    if not task_manager_configured():
        return None, "LEET_WORKFLOW_API_BASE or LEET_WORKFLOW_API_KEY not configured"
    url = f"{_BASE}{path}"
    try:
        res = requests.get(url, headers=_headers(), params=params or {}, timeout=_TIMEOUT)
        if res.status_code >= 400:
            if res.status_code == 404:
                return None, None
            detail = _response_error_detail(res)
            return None, f"Task Manager GET {path} failed ({res.status_code}){detail}"
        if not res.content:
            return {}, None
        return res.json(), None
    except Exception as ex:
        logger.exception("task_manager GET %s", path)
        return None, str(ex)


def _response_error_detail(res: requests.Response) -> str:
    try:
        payload = res.json()
    except Exception:
        text = (res.text or "").strip()
        return f": {text[:240]}" if text else ""
    if isinstance(payload, dict):
        for key in ("message", "error", "detail"):
            val = payload.get(key)
            if isinstance(val, str) and val.strip():
                return f": {val.strip()[:240]}"
        errs = payload.get("errors")
        if isinstance(errs, dict) and errs:
            return f": {str(errs)[:240]}"
    return ""


def _post_json(path: str, body: Dict[str, Any]) -> Tuple[Optional[Any], Optional[str], int]:
    """POST JSON; returns (json_or_none, error, http_status)."""
    if not task_manager_configured():
        return None, "LEET_WORKFLOW_API_BASE or LEET_WORKFLOW_API_KEY not configured", 0
    url = f"{_BASE}{path}"
    headers = {**_headers(), "Content-Type": "application/json"}
    try:
        res = requests.post(url, headers=headers, json=body, timeout=_TIMEOUT)
        status = int(res.status_code)
        if status >= 400:
            detail = _response_error_detail(res)
            hint = ""
            if status >= 500:
                hint = (
                    " — Live Task Manager crashed after validation; ask Workflow to check "
                    "Laravel logs and TASKS_SYSTEM_ISSUER_ADMIN_ID on production"
                )
            return None, f"Task Manager POST {path} failed ({status}){detail}{hint}", status
        if not res.content:
            return {}, None, status
        try:
            return res.json(), None, status
        except Exception:
            return {"raw": (res.text or "")[:500]}, None, status
    except Exception as ex:
        logger.exception("task_manager POST %s", path)
        return None, str(ex), 0


def _cached(key: str, ttl: float, loader):
    now = time.monotonic()
    ent = _CACHE.get(key)
    if ent and now - ent[0] < ttl:
        return ent[1], None
    val, err = loader()
    if err:
        return None, err
    _CACHE[key] = (now, val)
    return val, None


def get_active_schedule_period() -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    def load():
        data, err = _get("/api/v1/schedule-periods", {"active": "true", "per_page": 5})
        if err:
            return None, err
        rows = data.get("data") if isinstance(data, dict) else None
        if not isinstance(rows, list) or not rows:
            return None, "no active schedule period"
        return rows[0], None

    return _cached("active_period", _PERIOD_TTL, load)


def get_schedule_period_detail(period_id: int) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    key = f"period_detail:{period_id}"

    def load():
        data, err = _get(f"/api/v1/schedule-periods/{period_id}")
        if err:
            return None, err
        row = data.get("data") if isinstance(data, dict) else None
        if not isinstance(row, dict):
            return None, "invalid schedule period response"
        return row, None

    return _cached(key, _PERIOD_TTL, load)


def machine_id_matches(entry: Dict[str, Any], machine_id: str) -> bool:
    mid = str(machine_id or "").strip()
    if not mid:
        return False
    for key in ("vendon_id", "id"):
        if str(entry.get(key) or "").strip() == mid:
            return True
    name = str(entry.get("name") or "").strip().lower()
    return bool(name and name == mid.lower())


def find_operator_for_machine_on_date(
    period_detail: Dict[str, Any],
    machine_id: str,
    on_date: Optional[date] = None,
) -> Optional[Dict[str, Any]]:
    """Return employee_schedule row whose weekday schedule lists this machine."""
    d = on_date or kuwait_today()
    day_key = weekday_key(d)
    best: Optional[Dict[str, Any]] = None
    for es in period_detail.get("employee_schedules") or []:
        if not isinstance(es, dict):
            continue
        day = (es.get("schedule") or {}).get(day_key)
        if not isinstance(day, dict) or day.get("off"):
            continue
        machines = day.get("vendon_machines") or []
        if not isinstance(machines, list):
            machines = []
        top_vm = es.get("vendon_machine")
        if isinstance(top_vm, dict):
            machines = list(machines) + [top_vm]
        matched = any(isinstance(m, dict) and machine_id_matches(m, machine_id) for m in machines)
        if not matched:
            continue
        if es.get("position_type") == "operator":
            return es
        if best is None:
            best = es
    return best


def get_user_attendance_day(user_id: int, on_date: Optional[date] = None) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    d = on_date or kuwait_today()
    key = f"attendance_day:{user_id}:{d.isoformat()}"

    def load():
        data, err = _get(f"/api/v1/attendance/users/{user_id}", {"date": d.isoformat()})
        if err:
            return None, err
        row = data.get("data") if isinstance(data, dict) else None
        if not isinstance(row, dict):
            return None, "invalid attendance day response"
        return row, None

    return _cached(key, _ATTENDANCE_DAY_TTL, load)


def get_user_attendance_days(
    user_id: int,
    from_date: date,
    until_date: date,
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    data, err = _get(
        f"/api/v1/attendance/users/{user_id}/days",
        {"from": from_date.isoformat(), "until": until_date.isoformat()},
    )
    if err:
        return [], err
    rows = data.get("data") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        return [], "invalid attendance days response"
    return rows, None


def count_mtd_absent_late(user_id: int, on_date: Optional[date] = None) -> Tuple[int, int]:
    d = on_date or kuwait_today()
    month_start = d.replace(day=1)
    rows, err = get_user_attendance_days(user_id, month_start, d)
    if err:
        return 0, 0
    absent = sum(1 for r in rows if r.get("attendance_status") == "absent")
    late = sum(1 for r in rows if r.get("lateness_deduction"))
    return absent, late


def attendance_pill(status: Optional[str], lateness: Any, state: Optional[str]) -> Optional[Dict[str, str]]:
    st = str(status or "").strip().lower()
    if st == "present":
        if lateness:
            return {"label": "Late", "color": "y"}
        if state == "working":
            return {"label": "Working", "color": "g"}
        if state == "break":
            return {"label": "On break", "color": "o"}
        return {"label": "Present", "color": "g"}
    if st == "absent":
        return {"label": "Absent", "color": "r"}
    if st == "pending":
        return {"label": "Pending", "color": "o"}
    if st == "not_scheduled":
        return {"label": "Missing", "color": "o"}
    return None


def _boolish(val: Any) -> bool:
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return bool(val)
    if isinstance(val, str):
        return val.strip().lower() in ("1", "true", "yes", "y", "verified", "approved", "pass", "passed")
    return False


def _cleaning_days_back() -> int:
    try:
        return max(1, min(31, int(os.environ.get("LEET_WORKFLOW_CLEANING_DAYS_BACK", "7"))))
    except (TypeError, ValueError):
        return 7


def _daily_check_vendon_id(row: Dict[str, Any]) -> str:
    machine = row.get("machine")
    if isinstance(machine, dict):
        vid = str(machine.get("vendon_id") or "").strip()
        if vid:
            return vid
    return str(
        row.get("vendon_id")
        or row.get("vendon_machine_id")
        or row.get("machine_id")
        or ""
    ).strip()


def _cc_from_vm_review(vm_review: Any) -> Optional[bool]:
    """
    Live Workflow vm_review (2026-08): check_result_cleaned / refilled / presentable / camera
    plus load_audit_type. Older shapes used cleaned/presentable/camera + reviewed_at.
    """
    if not isinstance(vm_review, dict) or not vm_review:
        return None
    for key in ("command_center_verified", "commandCenterVerified", "verified", "approved"):
        if vm_review.get(key) is not None:
            return _boolish(vm_review.get(key))
    checks = [
        vm_review.get("check_result_cleaned"),
        vm_review.get("check_result_refilled"),
        vm_review.get("check_result_presentable"),
        vm_review.get("check_result_camera"),
        vm_review.get("cleaned"),
        vm_review.get("refilled"),
        vm_review.get("presentable"),
        vm_review.get("camera"),
    ]
    present = [v for v in checks if v is not None]
    if present:
        return all(_boolish(v) for v in present)
    # Any structured review payload implies CC completed the audit.
    if (
        vm_review.get("load_audit_type")
        or vm_review.get("load_audit_type_label")
        or vm_review.get("reviewed_at")
        or vm_review.get("completed_at")
        or vm_review.get("audited_at")
        or vm_review.get("updated_at")
    ):
        return True
    return None


def _audit_flags_from_vm_review(vm_review: Any) -> Tuple[Optional[bool], Optional[bool]]:
    if not isinstance(vm_review, dict):
        return None, None
    audit_type = str(vm_review.get("load_audit_type") or vm_review.get("audit_type") or "").strip().lower()
    high_risk = True if audit_type == "high_risk" else False if audit_type else None
    ghost = True if audit_type == "ghost" else False if audit_type else None
    return high_risk, ghost


def _fetch_daily_check_detail(check_id: Any) -> Optional[Dict[str, Any]]:
    cid = str(check_id or "").strip()
    if not cid:
        return None
    data, err = _get(f"/api/v1/daily-checks/{cid}")
    if err or not isinstance(data, dict):
        return None
    row = data.get("data")
    return row if isinstance(row, dict) else None


def _merge_daily_check_rows(list_row: Dict[str, Any], detail_row: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    merged = dict(list_row)
    if not detail_row:
        return merged
    for key in ("media", "vm_review", "on_cam_inspections", "comments", "comment", "notes"):
        if detail_row.get(key) is not None:
            merged[key] = detail_row[key]
    return merged


def _media_label(m: Dict[str, Any]) -> str:
    kind = str(m.get("kind") or "").strip().lower()
    if kind == "cleaning_video":
        return "Cleaning video"
    if kind == "refilled_image":
        return "Refilled photo"
    if kind == "monitor_record":
        return "Monitor record"
    if kind == "eod_video":
        return "EOD video"
    return str(m.get("label") or m.get("name") or m.get("type") or m.get("attachment_name") or "Media").strip()


def _parse_cleaning_record(row: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize Task Manager daily-check / legacy cleaning payloads for Alert."""
    if not isinstance(row, dict):
        return {}

    vm_review = row.get("vm_review")
    if not isinstance(vm_review, dict):
        vm_review = None

    verified_raw = (
        row.get("command_center_verified")
        if row.get("command_center_verified") is not None
        else row.get("commandCenterVerified")
        if row.get("commandCenterVerified") is not None
        else row.get("verified")
        if row.get("verified") is not None
        else row.get("cc_verified")
    )
    cc_verified: Optional[bool]
    if isinstance(verified_raw, bool):
        cc_verified = verified_raw
    elif isinstance(verified_raw, (int, float)):
        cc_verified = bool(verified_raw)
    elif isinstance(verified_raw, str):
        cc_verified = verified_raw.strip().lower() in ("1", "true", "yes", "verified", "approved")
    else:
        cc_verified = _cc_from_vm_review(vm_review)

    if cc_verified is None:
        review_status = str(row.get("review_status") or "").strip().lower()
        if review_status in ("approved", "verified", "complete", "completed", "passed", "reviewed"):
            cc_verified = True
        elif review_status in ("pending", "awaiting_review", "submitted", "open"):
            cc_verified = False
        elif row.get("id") is not None:
            cc_verified = False

    ts = (
        row.get("created_at")
        or row.get("submitted_at")
        or row.get("cleaned_at")
        or row.get("cleaning_completed_at")
        or row.get("finished_at")
        or row.get("updated_at")
    )
    if not ts and row.get("check_date"):
        day = str(row.get("check_date") or "").strip()
        if day:
            ts = f"{day}T00:00:00+00:00"
    if not ts and row.get("date"):
        day = str(row.get("date") or "").strip()
        if day:
            ts = f"{day}T00:00:00+00:00"

    comments: List[str] = []
    for key in ("comment", "comments", "operator_comment", "notes"):
        val = row.get(key)
        if isinstance(val, str) and val.strip():
            comments.append(val.strip())
        elif isinstance(val, list):
            for c in val:
                if isinstance(c, str) and c.strip():
                    comments.append(c.strip())
                elif isinstance(c, dict):
                    txt = str(c.get("text") or c.get("body") or c.get("comment") or "").strip()
                    if txt:
                        comments.append(txt)

    issues = row.get("issues")
    if isinstance(issues, str) and issues.strip():
        comments.append(issues.strip())
    elif isinstance(issues, list):
        for item in issues:
            if isinstance(item, str) and item.strip():
                comments.append(item.strip())
            elif isinstance(item, dict):
                txt = str(item.get("text") or item.get("message") or item.get("issue") or "").strip()
                if txt:
                    comments.append(txt)

    inspections = row.get("on_cam_inspections")
    if isinstance(inspections, list):
        for item in inspections:
            if not isinstance(item, dict):
                continue
            txt = str(item.get("notes") or item.get("comment") or item.get("text") or "").strip()
            if txt:
                comments.append(txt)

    media: List[Dict[str, str]] = []
    seen_urls: set[str] = set()

    def _add_media(url: str, label: str) -> None:
        u = (url or "").strip()
        if not u:
            return
        # Normalize for dedupe (strip query noise that often duplicates the same file).
        key = u.split("?", 1)[0].rstrip("/")
        if key in seen_urls:
            return
        seen_urls.add(key)
        media.append({"url": u, "label": (label or "Media").strip() or "Media"})

    for key in ("media", "attachments", "files", "videos"):
        val = row.get(key)
        if not isinstance(val, list):
            continue
        for m in val:
            if not isinstance(m, dict):
                continue
            url = str(m.get("url") or m.get("download_url") or m.get("public_url") or "").strip()
            if not url:
                continue
            _add_media(url, _media_label(m))
    for url_key, label in (
        ("video_url", "Cleaning video"),
        ("monitor_record_url", "Monitor record"),
        ("eod_video_url", "EOD video"),
    ):
        url = str(row.get(url_key) or "").strip()
        if url:
            _add_media(url, label)

    high_risk, ghost_check = _audit_flags_from_vm_review(vm_review)

    return {
        "lastCleaningAt": str(ts).strip() if ts else None,
        "commandCenterVerified": cc_verified,
        "comments": comments,
        "media": media,
        "rawStatus": str(row.get("status") or row.get("verification_status") or "").strip() or None,
        "highRisk": high_risk,
        "ghostCheck": ghost_check,
    }


def _daily_checks_list_for_day(day_iso: str, vendon_id: Optional[str] = None) -> Tuple[Optional[List[Dict[str, Any]]], Optional[str]]:
    params: Dict[str, Any] = {"all": "true", "date": day_iso}
    if vendon_id:
        params["vendon_id"] = vendon_id
    data, err = _get("/api/v1/daily-checks", params)
    if err:
        return None, err
    if not isinstance(data, dict):
        return [], None
    rows = data.get("data")
    if not isinstance(rows, list):
        return [], None
    return [r for r in rows if isinstance(r, dict)], None


def _daily_checks_list_for_range(
    from_iso: str,
    until_iso: str,
    vendon_id: Optional[str] = None,
) -> Tuple[Optional[List[Dict[str, Any]]], Optional[str]]:
    """
    Prefer Live `from`/`until` (verified 2026-08-09). Falls back to per-day `date=` if range fails.
    """
    params: Dict[str, Any] = {"all": "true", "from": from_iso, "until": until_iso, "per_page": 200}
    if vendon_id:
        params["vendon_id"] = vendon_id
    data, err = _get("/api/v1/daily-checks", params)
    if not err and isinstance(data, dict):
        rows = data.get("data")
        if isinstance(rows, list):
            return [r for r in rows if isinstance(r, dict)], None
        return [], None
    # Fallback: day loop (older deployments / rate-limit quirks)
    try:
        start = date.fromisoformat(from_iso)
        end = date.fromisoformat(until_iso)
    except ValueError:
        return None, err or "invalid from/until"
    if end < start:
        start, end = end, start
    merged: List[Dict[str, Any]] = []
    last_err = err
    d = start
    while d <= end:
        rows, day_err = _daily_checks_list_for_day(d.isoformat(), vendon_id=vendon_id)
        if day_err:
            last_err = day_err
        elif rows:
            merged.extend(rows)
        d += timedelta(days=1)
    if merged:
        return merged, None
    return None, last_err


def _pick_latest_daily_check(rows: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    parsed_rows: List[Tuple[str, Dict[str, Any]]] = []
    for row in rows:
        parsed = _parse_cleaning_record(row)
        ts = str(parsed.get("lastCleaningAt") or row.get("date") or "").strip()
        if ts or row.get("id"):
            parsed_rows.append((ts, row))
    if not parsed_rows:
        return None
    parsed_rows.sort(key=lambda x: x[0], reverse=True)
    return parsed_rows[0][1]


def _resolve_daily_check_row(row: Dict[str, Any]) -> Dict[str, Any]:
    detail = _fetch_daily_check_detail(row.get("id"))
    return _merge_daily_check_rows(row, detail)


def get_machine_cleaning_record(machine_id: str) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    Latest VM daily check from Task Manager (`GET /api/v1/daily-checks`).
    Override path via LEET_WORKFLOW_CLEANING_PATH only for legacy integrations.
    """
    mid = (machine_id or "").strip()
    if not mid:
        return None, "machine_id required"
    if not task_manager_configured():
        return None, "Task Manager API not configured"

    custom = (os.environ.get("LEET_WORKFLOW_CLEANING_PATH") or "").strip()
    if custom and custom != "/api/v1/daily-checks":
        data, err = _get(custom, {"machine_id": mid, "vendon_machine_id": mid, "vendon_id": mid, "per_page": 5})
        if err:
            return None, err
        rows = data.get("data") if isinstance(data, dict) else None
        if isinstance(rows, list) and rows:
            row = _pick_latest_daily_check(rows)
            if row:
                return _parse_cleaning_record(_resolve_daily_check_row(row)), None

    today = kuwait_today()
    from_iso = (today - timedelta(days=max(0, _cleaning_days_back() - 1))).isoformat()
    until_iso = today.isoformat()
    rows, err = _daily_checks_list_for_range(from_iso, until_iso, vendon_id=mid)
    if err:
        return None, err
    row = _pick_latest_daily_check(rows or [])
    if not row:
        return None, None
    return _parse_cleaning_record(_resolve_daily_check_row(row)), None


def get_machine_cleaning_records_batch(
    machine_ids: List[str],
) -> Dict[str, Tuple[Optional[Dict[str, Any]], Optional[str]]]:
    """Batch latest daily checks for many machines (prefer one from/until call)."""
    ids = [str(x).strip() for x in machine_ids if str(x).strip()]
    out: Dict[str, Tuple[Optional[Dict[str, Any]], Optional[str]]] = {mid: (None, None) for mid in ids}
    if not ids:
        return out
    if not task_manager_configured():
        err = "Task Manager API not configured"
        return {mid: (None, err) for mid in ids}

    want = set(ids)
    best_row_by_mid: Dict[str, Dict[str, Any]] = {}
    best_ts_by_mid: Dict[str, str] = {}
    today = kuwait_today()
    from_iso = (today - timedelta(days=max(0, _cleaning_days_back() - 1))).isoformat()
    until_iso = today.isoformat()
    rows, last_err = _daily_checks_list_for_range(from_iso, until_iso)

    for row in rows or []:
        vid = _daily_check_vendon_id(row)
        if not vid or vid not in want:
            continue
        parsed = _parse_cleaning_record(row)
        ts = str(parsed.get("lastCleaningAt") or row.get("check_date") or row.get("date") or "").strip()
        prev = best_ts_by_mid.get(vid)
        if prev is not None and ts <= prev:
            continue
        best_ts_by_mid[vid] = ts
        best_row_by_mid[vid] = row

    for mid in ids:
        row = best_row_by_mid.get(mid)
        if not row:
            if last_err:
                out[mid] = (None, last_err)
            continue
        out[mid] = (_parse_cleaning_record(_resolve_daily_check_row(row)), None)
    return out


def _unwrap_data(payload: Any) -> Any:
    if isinstance(payload, dict) and "data" in payload:
        return payload.get("data")
    return payload


def post_urgent_operator_task(
    *,
    title: str,
    user_id: int,
    message: str,
    vendon_id: str,
    start_date: str,
    end_date: str,
    due_time: Optional[str] = None,
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    body: Dict[str, Any] = {
        "title": title,
        "user_id": int(user_id),
        "message": message,
        "vendon_id": int(vendon_id) if str(vendon_id).isdigit() else vendon_id,
        "start_date": start_date,
        "end_date": end_date,
    }
    if due_time:
        body["due_time"] = due_time
    data, err, _status = _post_json("/api/v1/tasks/urgent-operator", body)
    if err:
        return None, err
    row = _unwrap_data(data)
    return row if isinstance(row, dict) else (data if isinstance(data, dict) else {}), None


def post_direct_message(*, user_id: int, message: str) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    body = {"user_id": int(user_id), "message": message}
    data, err, _status = _post_json("/api/v1/direct-messages", body)
    if err:
        return None, err
    row = _unwrap_data(data)
    return row if isinstance(row, dict) else (data if isinstance(data, dict) else {}), None


def post_cleaning_overdue_notification(
    *,
    user_id: int,
    vendon_id: str,
    overdue_date: Optional[str] = None,
    message: Optional[str] = None,
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    body: Dict[str, Any] = {
        "user_id": int(user_id),
        "vendon_id": int(vendon_id) if str(vendon_id).isdigit() else vendon_id,
    }
    if overdue_date:
        body["overdue_date"] = overdue_date
    if message:
        body["message"] = message
    data, err, _status = _post_json("/api/v1/notifications/cleaning-overdue", body)
    if err:
        return None, err
    row = _unwrap_data(data)
    return row if isinstance(row, dict) else (data if isinstance(data, dict) else {}), None


def _qc_visit_sort_key(row: Dict[str, Any]) -> str:
    for key in ("recorded_at", "updated_at", "date", "visit_date", "created_at"):
        val = row.get(key)
        if val:
            return str(val)
    return ""


def _parse_quality_control_visit(row: Dict[str, Any]) -> Dict[str, Any]:
    visitor = row.get("visitor") if isinstance(row.get("visitor"), dict) else {}
    visitor_name = (
        str(visitor.get("name") or "").strip()
        or str(row.get("visitor_name") or row.get("inspector_name") or "").strip()
        or None
    )
    date_raw = (
        row.get("recorded_at")
        or row.get("date")
        or row.get("visit_date")
        or row.get("updated_at")
        or row.get("created_at")
    )
    last_visit_at = str(date_raw).strip() if date_raw else None
    if last_visit_at and "T" not in last_visit_at and len(last_visit_at) >= 10:
        last_visit_at = f"{last_visit_at[:10]}T00:00:00+00:00"

    comment_parts: List[str] = []
    for key in ("issue_detected", "recommendations", "comment", "notes", "summary"):
        val = row.get(key)
        if isinstance(val, str) and val.strip():
            comment_parts.append(val.strip())
    incident = str(row.get("incident_type") or "").strip()
    result = str(row.get("result") or "").strip()
    status = str(row.get("issue_status") or "").strip()
    meta = " · ".join(p for p in (incident, result, status) if p)
    if meta:
        comment_parts.insert(0, meta)
    comment = " — ".join(comment_parts) if comment_parts else None

    return {
        "lastVisitAt": last_visit_at,
        "visitorName": visitor_name,
        "comment": comment,
        "source": "task_manager_quality_control",
        "qualityControlId": row.get("id"),
        "incidentType": incident or None,
        "result": result or None,
        "issueStatus": status or None,
    }


def get_latest_quality_control_visit(
    vendon_id: str,
    *,
    days_back: int = 90,
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Latest QC visit for a machine (`GET /api/v1/quality-control`). Used as tech-visit source."""
    mid = str(vendon_id or "").strip()
    if not mid:
        return None, "vendon_id required"
    if not task_manager_configured():
        return None, "Task Manager API not configured"

    today = kuwait_today()
    params: Dict[str, Any] = {
        "vendon_id": mid,
        "all": "true",
        "from": (today - timedelta(days=max(1, days_back))).isoformat(),
        "until": today.isoformat(),
    }
    data, err = _get("/api/v1/quality-control", params)
    if err:
        # Fallback without range if server rejects from/until
        data, err = _get("/api/v1/quality-control", {"vendon_id": mid, "all": "true"})
        if err:
            return None, err

    rows = data.get("data") if isinstance(data, dict) else None
    if not isinstance(rows, list) or not rows:
        return None, None

    dict_rows = [r for r in rows if isinstance(r, dict)]
    if not dict_rows:
        return None, None
    dict_rows.sort(key=_qc_visit_sort_key, reverse=True)
    return _parse_quality_control_visit(dict_rows[0]), None

