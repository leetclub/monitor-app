"""
Vendon Cloud API proxy for monitoring-app-v2 (Delay Risk / events tab).
Uses VENDON_API_KEY (same token as GAS Script Property API_KEY). Session + tab permission required.

Does not modify monitoring-app; adds HTTP surface for the React client.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote, urlencode

import requests
from flask import jsonify, request, session as flask_session

from dashboard_access_models import (
    DashboardAccessDefault,
    DashboardAccessUser,
    create_dashboard_engine_and_session,
)
from dashboard_access_routes import ALL_DASHBOARD_TAB_IDS, SUPER_ADMIN_EMAILS
from vendon_constants import EVENT_NAME_MAPPING, EXCLUDED_EVENT_NAMES

logger = logging.getLogger(__name__)

VENDON_API_BASE = (os.environ.get("VENDON_API_BASE") or "").strip().rstrip("/")
VENDON_API_KEY = (os.environ.get("VENDON_API_KEY") or "").strip()

# General Cleaning tab — same URL as GAS config.js MAINTENANCE_API_URL (PUT JSON body).
VENDON_MAINTENANCE_URL = (
    (os.environ.get("VENDON_MAINTENANCE_URL") or "").strip().rstrip("/")
    or "https://cloud.vendon.net/rest/head/maintenance/preventativeMaintenanceSchedules"
)

# Strike channel (optional). If SLACK_WEBHOOK_PROXY_PREFIX is set, POST to prefix + quote(webhook); else POST directly to webhook.
SLACK_WEBHOOK_URL = (os.environ.get("SLACK_WEBHOOK_URL") or "").strip()
SLACK_WEBHOOK_PROXY_PREFIX = (os.environ.get("SLACK_WEBHOOK_PROXY_PREFIX") or "").strip()

_dash_session_local = None


def _get_dashboard_session():
    global _dash_session_local
    if _dash_session_local is None:
        _, _dash_session_local = create_dashboard_engine_and_session()
    return _dash_session_local()


def _coerce_list(val: Any) -> List[str]:
    if val is None:
        return []
    if isinstance(val, list):
        return [str(x).strip() for x in val if str(x).strip()]
    if isinstance(val, str):
        try:
            p = json.loads(val)
            return p if isinstance(p, list) else []
        except Exception:
            return []
    return []


def _normalize_tabs(arr: List[str]) -> List[str]:
    if not arr:
        return []
    if "*" in arr:
        return list(ALL_DASHBOARD_TAB_IDS)
    return arr


def _allowed_tabs_for_email(email: str) -> List[str]:
    e = (email or "").strip().lower()
    if not e:
        return []
    if e in SUPER_ADMIN_EMAILS:
        return list(ALL_DASHBOARD_TAB_IDS)
    db = _get_dashboard_session()
    try:
        default_row = db.query(DashboardAccessDefault).filter(DashboardAccessDefault.id == 1).first()
        default_tabs = _coerce_list(default_row.default_tabs) if default_row else ["*"]
        if not default_tabs:
            default_tabs = ["*"]
        default_tabs = _normalize_tabs(default_tabs)
        for row in db.query(DashboardAccessUser).all():
            if row.email.strip().lower() == e:
                return _normalize_tabs(_coerce_list(row.allowed_tabs))
        return default_tabs
    finally:
        db.close()


def _require_session_email() -> Optional[str]:
    return (flask_session.get("email") or "").strip().lower() or None


def _require_tab(tab_id: str) -> Tuple[Optional[str], Optional[Any]]:
    email = _require_session_email()
    if not email:
        return None, (jsonify({"error": "Unauthorized"}), 401)
    allowed = _allowed_tabs_for_email(email)
    if tab_id not in allowed:
        return None, (jsonify({"error": "Forbidden", "tab": tab_id}), 403)
    return email, None


def _vendon_headers() -> Dict[str, str]:
    return {"Authorization": f"Token {VENDON_API_KEY}"}


def _vendon_put_maintenance_schedules(payload: Dict[str, Any]) -> Tuple[Optional[Dict], Optional[str]]:
    """Classic maintenance-tab.js: PUT preventativeMaintenanceSchedules with Token auth."""
    if not VENDON_API_KEY:
        return None, "VENDON_API_KEY not configured on server"
    headers = {
        **(_vendon_headers()),
        "Content-Type": "application/json",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": "https://cloud.vendon.net",
        "Referer": "https://cloud.vendon.net/preventative-maintenance-schedules",
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
        ),
    }
    try:
        r = requests.put(VENDON_MAINTENANCE_URL, headers=headers, json=payload, timeout=120)
        if r.status_code != 200:
            return None, f"Vendon maintenance API error {r.status_code}: {r.text[:800]}"
        try:
            return r.json(), None
        except Exception:
            return None, "Invalid JSON from Vendon maintenance API"
    except Exception as ex:
        logger.exception("vendon_put_maintenance_schedules")
        return None, str(ex)


def _vendon_get(path: str, params: Optional[Dict[str, Any]] = None) -> Tuple[Optional[Dict], Optional[str]]:
    if not VENDON_API_KEY:
        return None, "VENDON_API_KEY not configured on server"
    if not VENDON_API_BASE:
        return None, "VENDON_API_BASE not configured on server"
    url = f"{VENDON_API_BASE}{path}"
    if params:
        url = f"{url}?{urlencode({k: v for k, v in params.items() if v is not None})}"
    try:
        r = requests.get(url, headers=_vendon_headers(), timeout=120)
        if r.status_code != 200:
            return None, f"Vendon API error {r.status_code}: {r.text[:500]}"
        return r.json(), None
    except Exception as ex:
        logger.exception("vendon_get")
        return None, str(ex)


def _is_excluded_event(e: Dict[str, Any]) -> bool:
    name = e.get("name") or ""
    base = e.get("base_code") or ""
    if name in EXCLUDED_EVENT_NAMES or base in EXCLUDED_EVENT_NAMES:
        return True
    dur = e.get("duration")
    if dur is None and e.get("received_at") and e.get("resolved_at"):
        try:
            dur = int(e["resolved_at"]) - int(e["received_at"])
        except (TypeError, ValueError):
            dur = None
    if dur is not None and dur <= 600:
        return True
    return False


def _map_display_name(e: Dict[str, Any]) -> str:
    name = e.get("name") or ""
    base = e.get("base_code") or ""
    return (
        EVENT_NAME_MAPPING.get(name)
        or EVENT_NAME_MAPPING.get(base)
        or name
        or "Unknown Event"
    )


def _event_name_options() -> List[Dict[str, Any]]:
    """Same shape as GAS fetchEventNames() — id is display name, base_codes list."""
    seen: Dict[str, List[str]] = {}
    for raw, disp in EVENT_NAME_MAPPING.items():
        seen.setdefault(disp, []).append(raw)
    return [
        {
            "id": disp,
            "name": disp,
            "base_codes": codes,
            "display_name": disp,
        }
        for disp, codes in sorted(seen.items(), key=lambda x: x[0])
    ]


def fetch_and_process_events(
    start_date: str,
    end_date: str,
    machine_id: Optional[str],
    event_name_filter: Optional[str],
    limit: int,
    offset: int,
) -> Dict[str, Any]:
    """Replicate GAS fetchEvents pagination over full filtered set (max 5000 raw rows)."""
    d0 = datetime.strptime(start_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    d1 = datetime.strptime(end_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    from_ts = int(d0.timestamp())
    to_dt_end = d1.replace(hour=23, minute=59, second=59, microsecond=999000)
    to_ts = int(to_dt_end.timestamp())

    base_params: Dict[str, Any] = {
        "from_timestamp": from_ts,
        "to_timestamp": to_ts,
    }
    if machine_id:
        base_params["machine_id"] = machine_id

    all_events: List[Dict] = []
    page_limit = 500
    off = 0
    while True:
        params = {**base_params, "limit": page_limit, "offset": off}
        data, err = _vendon_get("/event", params)
        if err:
            return {"events": [], "totalCount": 0, "error": err}
        page_results = data.get("result") if isinstance(data, dict) else None
        page_results = page_results if isinstance(page_results, list) else []
        all_events.extend(page_results)
        paging = data.get("paging") if isinstance(data, dict) else None
        if paging and isinstance(paging, dict) and paging.get("total") is not None:
            if len(all_events) >= int(paging["total"]):
                break
        if len(page_results) < page_limit:
            break
        off += page_limit
        if len(all_events) >= 5000:
            break

    # Machine id -> name
    machines_map: Dict[str, str] = {}
    mdata, _ = _vendon_get("/machine", None)
    if mdata and isinstance(mdata.get("result"), list):
        for m in mdata["result"]:
            mid = str(m.get("id", ""))
            if mid:
                machines_map[mid] = m.get("name") or mid

    filtered = [e for e in all_events if not _is_excluded_event(e)]

    if event_name_filter:
        opts = _event_name_options()
        selected = next((o for o in opts if o.get("id") == event_name_filter), None)
        if selected and selected.get("base_codes"):
            codes = set(selected["base_codes"])
            filtered = [e for e in filtered if (e.get("name") or "") in codes]

    mapped: List[Dict[str, Any]] = []
    for e in filtered:
        disp = _map_display_name(e)
        mid = str(e.get("machine_id") or e.get("machine") or "")
        mapped.append(
            {
                **e,
                "display_name": disp,
                "original_name": e.get("name"),
                "original_base_code": e.get("base_code"),
                "machine_name": machines_map.get(mid) or e.get("machine_name") or mid or "Unknown",
            }
        )

    total = len(mapped)
    slice_events = mapped[offset : offset + max(1, min(limit, 5000))]
    return {"events": slice_events, "totalCount": total, "error": None}


def register_vendon_proxy_routes(app) -> None:
    @app.route("/api/vendon/machines", methods=["GET", "OPTIONS"])
    def vendon_machines():
        if request.method == "OPTIONS":
            return "", 204
        err_resp = _require_tab("events")
        if err_resp[1]:
            return err_resp[1]
        data, err = _vendon_get("/machine", None)
        if err:
            return jsonify({"error": err}), 502
        rows = data.get("result") if isinstance(data, dict) else None
        rows = rows if isinstance(rows, list) else []
        machines = [{"id": m.get("id"), "name": m.get("name")} for m in rows if m.get("id") is not None]
        machines.sort(key=lambda x: (x.get("name") or "").lower())
        return jsonify({"machines": machines})

    @app.route("/api/vendon/event-name-options", methods=["GET", "OPTIONS"])
    def vendon_event_name_options():
        if request.method == "OPTIONS":
            return "", 204
        err_resp = _require_tab("events")
        if err_resp[1]:
            return err_resp[1]
        return jsonify({"options": _event_name_options()})

    @app.route("/api/vendon/events/query", methods=["POST", "OPTIONS"])
    def vendon_events_query():
        if request.method == "OPTIONS":
            return "", 204
        err_resp = _require_tab("events")
        if err_resp[1]:
            return err_resp[1]
        body = request.get_json(silent=True) or {}
        start = (body.get("startDate") or body.get("start_date") or "").strip()
        end = (body.get("endDate") or body.get("end_date") or "").strip()
        if not start or not end:
            return jsonify({"error": "startDate and endDate required"}), 400
        machine_id = (body.get("machineId") or body.get("machine_id") or "").strip() or None
        event_name = (body.get("eventName") or body.get("event_name") or "").strip() or None
        limit = int(body.get("limit") or 100)
        offset = int(body.get("offset") or 0)
        limit = max(1, min(limit, 500))
        offset = max(0, offset)

        result = fetch_and_process_events(start, end, machine_id, event_name, limit, offset)
        if result.get("error"):
            return jsonify({"events": [], "totalCount": 0, "error": result["error"]}), 200
        return jsonify(
            {
                "events": result["events"],
                "totalCount": result["totalCount"],
            }
        )

    @app.route("/api/monitoring/strike", methods=["POST", "OPTIONS"])
    def monitoring_strike():
        """Channel Slack post only (survey proxy); operator DMs remain in GAS until ported."""
        if request.method == "OPTIONS":
            return "", 204
        err_resp = _require_tab("events")
        if err_resp[1]:
            return err_resp[1]
        body = request.get_json(silent=True) or {}
        strike_n = int(body.get("strikeNumber") or body.get("strike_number") or 0)
        machine_name = (body.get("machineName") or body.get("machine_name") or "Unknown").strip()
        event_type = (body.get("eventType") or body.get("event_type") or "Unknown").strip()
        if strike_n not in (1, 2, 3):
            return jsonify({"success": False, "error": "strikeNumber must be 1, 2, or 3"}), 400
        text = (
            f"⚠️ *STRIKE {strike_n}* ⚠️\n"
            f"Event Type: {event_type}\nMachine: {machine_name}\n"
            f"Timestamp: {body.get('timestamp') or ''}"
        )
        if not SLACK_WEBHOOK_URL:
            return jsonify(
                {
                    "success": False,
                    "error": "SLACK_WEBHOOK_URL not configured on API server",
                    "operatorResults": {"sent": [], "errors": ["Configure SLACK_WEBHOOK_URL in people-analytics-api secret"]},
                }
            ), 200

        try:
            if SLACK_WEBHOOK_PROXY_PREFIX:
                post_url = SLACK_WEBHOOK_PROXY_PREFIX.rstrip() + quote(SLACK_WEBHOOK_URL, safe="")
            else:
                post_url = SLACK_WEBHOOK_URL
            r = requests.post(
                post_url,
                json={"text": text},
                headers={"Content-Type": "application/json"},
                timeout=30,
            )
            ok = r.status_code == 200
            return jsonify(
                {
                    "success": ok,
                    "channelResult": {"success": ok, "status": r.status_code},
                    "operatorResults": {"sent": [], "errors": ["Operator DMs not implemented in v2 API yet — use classic tab if needed"]},
                }
            )
        except Exception as ex:
            logger.exception("monitoring_strike")
            return jsonify({"success": False, "error": str(ex)}), 200

    @app.route("/api/vendon/maintenance/query", methods=["POST", "OPTIONS"])
    def vendon_maintenance_query():
        """General Cleaning — proxy to Vendon preventative maintenance schedules (monitoring-app maintenance-tab.js)."""
        if request.method == "OPTIONS":
            return "", 204
        err_resp = _require_tab("maintenance")
        if err_resp[1]:
            return err_resp[1]
        body = request.get_json(silent=True) or {}
        raw_mids = body.get("machine_ids") or []
        machine_ids: List[int] = []
        if isinstance(raw_mids, list):
            for x in raw_mids:
                try:
                    machine_ids.append(int(x))
                except (TypeError, ValueError):
                    continue
        payload: Dict[str, Any] = {
            "offset": int(body.get("offset") or 0),
            "limit": int(body.get("limit") or 5000),
            "statuses": body.get("statuses") or ["ok", "due_soon", "due", "overdue"],
            "maintenance_type_ids": body.get("maintenance_type_ids") or [],
            "assigned_employee_ids": body.get("assigned_employee_ids") or [],
            "machine_ids": machine_ids,
            "location_ids": body.get("location_ids") or [],
            "machine_tag_ids": body.get("machine_tag_ids") or [],
            "client_ids": body.get("client_ids") or [],
        }
        data, err = _vendon_put_maintenance_schedules(payload)
        if err:
            return jsonify({"error": err, "result": [], "paging": {"total": 0}}), 502
        if not isinstance(data, dict):
            return jsonify({"error": "Unexpected response from Vendon", "result": [], "paging": {"total": 0}}), 502
        return jsonify(data), 200
