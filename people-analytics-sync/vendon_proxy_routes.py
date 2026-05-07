"""
Vendon Cloud API proxy for monitoring-app-v2 (Delay Risk / events / maintenance / …).
Uses VENDON_API_KEY (same token as GAS Script Property API_KEY). Session + tab permission required.

Deployment note (v1 vs v2):
  - **people-analytics-sync** (this Flask app) is the shared BFF behind `people-analytics-api` in k8s.
    monitoring-app-v2 calls same-origin `/api/*` routes here with browser session cookies.
  - **Classic v1** (`monitoring-app` Google Apps Script) still talks to Vendon **directly** from GAS
    for several tabs — e.g. General Cleaning uses `maintenance-tab.js` → UrlFetch PUT to Vendon's
    `.../preventativeMaintenanceSchedules` with `API_KEY`. That path is unchanged.
  - Routes added here (e.g. `/api/vendon/maintenance/query`) are **additive** for v2 browsers only;
    they do not replace or alter v1 GAS flows.

Does not modify monitoring-app source; adds HTTP surface for the React client.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo

import requests
from flask import jsonify, request, session as flask_session

from sqlalchemy import and_, text, or_

from dashboard_access_models import (
    DashboardAccessDefault,
    DashboardAccessUser,
    create_dashboard_engine_and_session,
)
from dashboard_access_routes import ALL_DASHBOARD_TAB_IDS, SUPER_ADMIN_EMAILS, _check_secret
from vendon_constants import EVENT_NAME_MAPPING, EXCLUDED_EVENT_NAMES
from vendon_machine_helpers import vendon_fetch_machine_list, vendon_json_api_error_message
from models import (
    RemoteCreditReason,
    VendonEventCache,
    VendonDailyMachineRevenueCache,
    RemoteCreditsPreloadCache,
    create_engine_and_session,
)

logger = logging.getLogger(__name__)

VENDON_API_BASE = (os.environ.get("VENDON_API_BASE") or "").strip().rstrip("/")
VENDON_API_KEY = (os.environ.get("VENDON_API_KEY") or "").strip()
VENDON_USERNAME = (os.environ.get("VENDON_USERNAME") or "").strip()
VENDON_PASSWORD = (os.environ.get("VENDON_PASSWORD") or "").strip()
_VENDON_CLOUD_HEAD_BASE = (os.environ.get("VENDON_CLOUD_HEAD_BASE") or "https://cloud.vendon.net/rest/head").strip().rstrip("/")

# Full URL — same as monitoring-app/config.js MAINTENANCE_API_URL.
# Maintenance is under /rest/head/... NOT under VENDON_API_BASE (/rest/v1.9.0/...); do not join with that base.
_DEFAULT_VENDON_MAINTENANCE_URL = "https://cloud.vendon.net/rest/head/maintenance/preventativeMaintenanceSchedules"

# Strike channel (optional). If SLACK_WEBHOOK_PROXY_PREFIX is set, POST to prefix + quote(webhook); else POST directly to webhook.
SLACK_WEBHOOK_URL = (os.environ.get("SLACK_WEBHOOK_URL") or "").strip()
SLACK_WEBHOOK_PROXY_PREFIX = (os.environ.get("SLACK_WEBHOOK_PROXY_PREFIX") or "").strip()

_dash_session_local = None
_pa_session_local = None


def _get_dashboard_session():
    global _dash_session_local
    if _dash_session_local is None:
        _, _dash_session_local = create_dashboard_engine_and_session()
    return _dash_session_local()

def _get_people_analytics_session():
    global _pa_session_local
    if _pa_session_local is None:
        _, _pa_session_local = create_engine_and_session()
    return _pa_session_local()


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


def _require_any_machine_dropdown_tab() -> Tuple[Optional[str], Optional[Any]]:
    """Shared /api/vendon/machines list — any tab that shows a machine dropdown."""
    email = _require_session_email()
    if not email:
        return None, (jsonify({"error": "Unauthorized"}), 401)
    allowed = _allowed_tabs_for_email(email)
    tabs = ("events", "maintenance", "transactions", "waste", "remoteCredits")
    if not any(t in allowed for t in tabs):
        return None, (jsonify({"error": "Forbidden", "tab": "events|maintenance|transactions|waste"}), 403)
    return email, None


def _require_strike_tab() -> Tuple[Optional[str], Optional[Any]]:
    """Strike button: Delay Risk tab or Live Ops board."""
    email = _require_session_email()
    if not email:
        return None, (jsonify({"error": "Unauthorized"}), 401)
    allowed = _allowed_tabs_for_email(email)
    if "events" not in allowed and "liveDashboard" not in allowed:
        return None, (jsonify({"error": "Forbidden", "tab": "events|liveDashboard"}), 403)
    return email, None


def _vendon_headers() -> Dict[str, str]:
    return {"Authorization": f"Token {VENDON_API_KEY}"}


def _vendon_maintenance_put_headers() -> Dict[str, str]:
    """Match monitoring-app/maintenance-tab.js tryWithApiKey() (Origin/Referer + Token)."""
    h = dict(_vendon_headers())
    h.update(
        {
            "Content-Type": "application/json",
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "Origin": "https://cloud.vendon.net",
            "Referer": "https://cloud.vendon.net/preventative-maintenance-schedules",
        }
    )
    return h


def _vendon_preventative_maintenance_url() -> str:
    """
    Resolve upstream URL. Prefer VENDON_PREVENTATIVE_MAINTENANCE_URL (full https URL).
    Legacy: VENDON_PREVENTATIVE_MAINTENANCE_PATH was a path segment; if set, append to cloud host only
    (never to VENDON_API_BASE which is the v1.9.0 REST root).
    """
    explicit = (os.environ.get("VENDON_PREVENTATIVE_MAINTENANCE_URL") or "").strip()
    if explicit:
        return explicit.rstrip("/")
    legacy_path = (os.environ.get("VENDON_PREVENTATIVE_MAINTENANCE_PATH") or "").strip()
    if legacy_path.startswith("http"):
        return legacy_path.rstrip("/")
    if legacy_path.startswith("/"):
        host = (os.environ.get("VENDON_CLOUD_HOST") or "https://cloud.vendon.net").strip().rstrip("/")
        return f"{host}{legacy_path}"
    return _DEFAULT_VENDON_MAINTENANCE_URL.rstrip("/")


def _vendon_put_preventative_maintenance_schedules(json_body: Dict[str, Any]) -> Tuple[Optional[Any], Optional[str]]:
    """
    Forward to Vendon — same contract as GAS fetchMaintenanceSchedules() (PUT + JSON body).
    """
    if not VENDON_API_KEY:
        return None, "VENDON_API_KEY not configured on server"
    url = _vendon_preventative_maintenance_url()
    try:
        r = requests.put(url, headers=_vendon_maintenance_put_headers(), json=json_body, timeout=120)
        if r.status_code != 200:
            return None, f"Vendon API error {r.status_code}: {r.text[:800]}"
        try:
            return r.json(), None
        except Exception:
            return None, f"Vendon returned non-JSON: {r.text[:400]}"
    except Exception as ex:
        logger.exception("vendon_put_preventative_maintenance_schedules")
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
        try:
            data = r.json()
        except Exception:
            return None, f"Vendon returned non-JSON: {r.text[:400]}"
        if isinstance(data, dict):
            api_err = vendon_json_api_error_message(data)
            if api_err:
                return None, api_err
        return data, None
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
    """Replicate GAS fetchEvents pagination over full filtered set (max 5000 raw rows).

    IMPORTANT: Interpret start/end dates as Kuwait calendar days (Asia/Kuwait),
    then convert boundaries to UTC timestamps for Vendon API.
    """
    tz_kw = ZoneInfo("Asia/Kuwait")
    d0 = datetime.strptime(start_date, "%Y-%m-%d").replace(tzinfo=tz_kw)
    d1 = datetime.strptime(end_date, "%Y-%m-%d").replace(tzinfo=tz_kw)
    start_local = d0.replace(hour=0, minute=0, second=0, microsecond=0)
    end_local = d1.replace(hour=23, minute=59, second=59, microsecond=0)
    from_ts = int(start_local.astimezone(timezone.utc).timestamp())
    to_ts = int(end_local.astimezone(timezone.utc).timestamp())

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
    mrows_map, _ = vendon_fetch_machine_list(_vendon_get)
    for m in mrows_map:
        if not isinstance(m, dict):
            continue
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


def _event_key_for_cache(e: Dict[str, Any]) -> str:
    """
    Vendon event objects are not guaranteed to expose a stable 'id' consistently.
    Build a stable key that is good enough for (day, machine, received_at, name/base_code).
    """
    mid = str(e.get("machine_id") or e.get("machine") or "")
    name = str(e.get("name") or "")
    base = str(e.get("base_code") or "")
    ra = e.get("received_at") or 0
    rr = e.get("resolved_at") or 0
    dur = e.get("duration") or 0
    return f"{mid}|{name}|{base}|{ra}|{rr}|{dur}"


def _try_read_cached_events_single_day(
    date_str: str,
    machine_id: Optional[str],
    event_name_filter: Optional[str],
    limit: int,
    offset: int,
) -> Optional[Dict[str, Any]]:
    """Return cached, already-mapped rows if present. Returns None if cache empty."""
    try:
        day = datetime.strptime(date_str, "%Y-%m-%d").date()
    except Exception:
        return None
    db = _get_people_analytics_session()
    try:
        q = db.query(VendonEventCache).filter(VendonEventCache.cache_date == day)
        if machine_id:
            q = q.filter(VendonEventCache.machine_id == machine_id)
        if event_name_filter:
            # In this API, the filter value is the display-name id (same as GAS).
            q = q.filter(VendonEventCache.display_name == event_name_filter)
        total = q.count()
        rows = (
            q.order_by(VendonEventCache.received_at.desc().nullslast(), VendonEventCache.id.desc())
            .offset(offset)
            .limit(max(1, min(limit, 500)))
            .all()
        )
        if total <= 0:
            return None
        events: List[Dict[str, Any]] = []
        for r in rows:
            payload = r.payload_json or {}
            # Ensure required UI fields are present (GAS expects these keys)
            payload = dict(payload)
            payload.setdefault("machine_id", r.machine_id)
            payload.setdefault("machine_name", r.machine_name)
            payload.setdefault("name", r.name)
            payload.setdefault("base_code", r.base_code)
            payload.setdefault("display_name", r.display_name)
            payload.setdefault("received_at", r.received_at)
            payload.setdefault("resolved_at", r.resolved_at)
            payload.setdefault("duration", r.duration)
            events.append(payload)
        return {"events": events, "totalCount": total}
    finally:
        db.close()


def _fetch_vends_stats_window(from_ts: int, to_ts: int, machine_id: Optional[str] = None, max_rows: int = 25000) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """
    Vendon /stats/vends paginated fetch. Used for revenue + WEB cashless detection.
    """
    out: List[Dict[str, Any]] = []
    off = 0
    page_limit = 500
    while len(out) < max_rows:
        params: Dict[str, Any] = {"from_timestamp": from_ts, "to_timestamp": to_ts, "limit": page_limit, "offset": off}
        if machine_id:
            params["machine_id"] = machine_id
        data, err = _vendon_get("/stats/vends", params)
        if err:
            return [], err
        chunk = data.get("result") if isinstance(data, dict) else None
        chunk = chunk if isinstance(chunk, list) else []
        out.extend(chunk)
        if len(chunk) < page_limit:
            break
        off += page_limit
    return out[:max_rows], None


def _last_transactions_classic_rows(machine_id: Optional[str]) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """
    Same logic as monitoring-app/transactions-tab.js fetchLastTransactions:
    GET /stats/vends last 24h, limit 1000, then keep the newest vend per machine_id.
    """
    now = int(datetime.now(timezone.utc).timestamp())
    day_ago = now - 24 * 60 * 60
    params: Dict[str, Any] = {
        "from_timestamp": day_ago,
        "to_timestamp": now,
        "limit": 1000,
        "offset": 0,
    }
    if machine_id:
        params["machine_id"] = machine_id
    data, err = _vendon_get("/stats/vends", params)
    if err:
        return [], err
    if isinstance(data, dict):
        code = data.get("code")
        if code is not None and int(code) != 200:
            return [], f"Vendon stats/vends code {code}: {str(data)[:500]}"

    raw = data.get("result") if isinstance(data, dict) else None
    raw = raw if isinstance(raw, list) else []

    latest_by_machine: Dict[Any, Dict[str, Any]] = {}
    for trx in raw:
        mid = trx.get("machine_id")
        dt_raw = trx.get("datetime") or trx.get("timestamp") or 0
        try:
            dt_i = int(dt_raw)
        except (TypeError, ValueError):
            dt_i = 0
        prev = latest_by_machine.get(mid)
        prev_dt = -1
        if prev is not None:
            pr = prev.get("datetime") or prev.get("timestamp") or 0
            try:
                prev_dt = int(pr)
            except (TypeError, ValueError):
                prev_dt = -1
        if prev is None or dt_i > prev_dt:
            latest_by_machine[mid] = trx

    out: List[Dict[str, Any]] = []
    for trx in latest_by_machine.values():
        ts_raw = trx.get("datetime") or trx.get("timestamp") or 0
        try:
            ts_i = int(ts_raw)
        except (TypeError, ValueError):
            ts_i = 0
        mid_val = trx.get("machine_id")
        out.append(
            {
                "id": trx.get("id"),
                "machine_id": mid_val,
                "machine_name": trx.get("machine_name") or (f"Machine {mid_val}" if mid_val is not None else "Unknown"),
                "amount": trx.get("price") or 0,
                "timestamp": ts_i,
                "product_name": trx.get("name") or "Unknown Product",
            }
        )
    out.sort(key=lambda x: -int(x.get("timestamp") or 0))
    return out, None


def _is_web_cashless_vend(vend: Dict[str, Any]) -> bool:
    try:
        js = json.dumps(vend or {}, ensure_ascii=False).upper()
        if "WEB" in js and "CASHLESS" in js:
            return True
        candidates: List[str] = []
        for k in ("payment_type", "payment_type_name", "type", "pay_type", "pay_type_name"):
            v = vend.get(k)
            if v is not None:
                candidates.append(str(v))
        for v in candidates:
            u = v.upper()
            if "WEB" in u or "CASHLESS" in u:
                return True
        return False
    except Exception:
        return False


def _stats_vend_product_fields(vend: Dict[str, Any]) -> Tuple[str, str]:
    """
    Product name + selection from /stats/vends row.
    Vendon field names vary; mirror broad extraction like classic GAS (name / product_name / nested product).
    """
    raw_name = vend.get("name") or vend.get("product_name") or vend.get("product_title") or vend.get("title")
    if isinstance(raw_name, dict):
        raw_name = raw_name.get("name") or raw_name.get("title") or raw_name.get("product_name")
    name = str(raw_name or "").strip()

    nested = vend.get("product")
    if not name and isinstance(nested, dict):
        name = str(
            nested.get("name") or nested.get("title") or nested.get("product_name") or nested.get("label") or ""
        ).strip()

    sel_raw = vend.get("selection") or vend.get("product_id") or vend.get("selection_id") or vend.get("slot")
    if sel_raw is None and isinstance(nested, dict):
        sel_raw = nested.get("id") or nested.get("selection") or nested.get("product_id")
    selection = str(sel_raw or "").strip()

    return name, selection


def _kuwait_day_bounds_utc(date_str: str) -> Tuple[int, int]:
    """
    Return (from_ts, to_ts) for the full Kuwait calendar day [00:00..23:59:59] expressed as UTC timestamps.
    This matches the UI's expectations for "yesterday" in Kuwait operations.
    """
    tz = ZoneInfo("Asia/Kuwait")
    d = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=tz)
    start_loc = d.replace(hour=0, minute=0, second=0, microsecond=0)
    end_loc = d.replace(hour=23, minute=59, second=59, microsecond=0)
    return int(start_loc.astimezone(timezone.utc).timestamp()), int(end_loc.astimezone(timezone.utc).timestamp())


def _kuwait_range_bounds_utc(start_date_str: str, end_date_str: str) -> Tuple[int, int]:
    """Inclusive Kuwait calendar range [start 00:00 .. end 23:59:59]."""
    tz = ZoneInfo("Asia/Kuwait")
    d0 = datetime.strptime(start_date_str, "%Y-%m-%d").replace(tzinfo=tz).replace(hour=0, minute=0, second=0, microsecond=0)
    d1 = datetime.strptime(end_date_str, "%Y-%m-%d").replace(tzinfo=tz).replace(hour=23, minute=59, second=59, microsecond=0)
    return int(d0.astimezone(timezone.utc).timestamp()), int(d1.astimezone(timezone.utc).timestamp())


def _parse_failed_dispense_product(description: str) -> Tuple[str, str]:
    """
    Extract (product_name, selection) from Vendon event description.
    Matches GAS heuristics: "Product Karak, selection 20".
    """
    if not description:
        return "", ""
    prod = ""
    sel = ""
    try:
        m = re.search(r"Product\s+([^,]+)", description, flags=re.IGNORECASE)
        if m:
            prod = (m.group(1) or "").strip()
        s = re.search(r"selection\s+(\d+)", description, flags=re.IGNORECASE)
        if s:
            sel = (s.group(1) or "").strip()
    except Exception:
        pass
    return prod, sel


def _fetch_failed_dispense_events_single_machine(from_ts: int, to_ts: int, machine_id: str, max_rows: int = 8000) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    out: List[Dict[str, Any]] = []
    off = 0
    page_limit = 500
    while len(out) < max_rows:
        params = {"from_timestamp": from_ts, "to_timestamp": to_ts, "machine_id": machine_id, "limit": page_limit, "offset": off}
        data, err = _vendon_get("/event", params)
        if err:
            return [], err
        chunk = data.get("result") if isinstance(data, dict) else None
        chunk = chunk if isinstance(chunk, list) else []
        if not chunk:
            break
        for e in chunk:
            name = str(e.get("name") or e.get("base_code") or e.get("type") or "").lower()
            desc_src = str(e.get("description") or "")
            if not desc_src and isinstance(e.get("data"), str):
                desc_src = str(e.get("data"))
            desc_lc = desc_src.lower()
            if not desc_lc and isinstance(e.get("payload"), str):
                desc_lc = str(e.get("payload")).lower()
            is_failed = (
                ("dispense" in name and "failed" in name)
                or ("vend" in name and "failed" in name)
                or name.strip() == "product dispense/vend failed"
                or ("dispense" in desc_lc and "failed" in desc_lc)
                or ("vend failed" in desc_lc)
            )
            if not is_failed:
                continue
            raw_desc = desc_src or (str(e.get("payload") or "") if not isinstance(e.get("payload"), dict) else "")
            prod, sel = _parse_failed_dispense_product(raw_desc if raw_desc else "")
            edata = e.get("data") if isinstance(e.get("data"), dict) else {}
            if isinstance(e.get("payload"), dict):
                edata = {**edata, **e["payload"]}
            if not prod:
                prod = (
                    str(edata.get("product_name") or edata.get("product") or edata.get("name") or "").strip()
                )
            if not sel:
                sel = str(edata.get("selection") or "").strip()
            ts = e.get("datetime") or e.get("received_at") or e.get("timestamp") or 0
            try:
                ts_i = int(ts) if ts is not None else 0
            except Exception:
                ts_i = 0
            if ts_i > 10**12:
                ts_i = ts_i // 1000
            out.append(
                {
                    "id": e.get("id"),
                    "timestamp": ts_i,
                    "machine_id": str(e.get("machine_id") or machine_id),
                    "machine_name": e.get("machine_name") or "",
                    "product_name": prod,
                    "selection": sel,
                    "description": raw_desc,
                }
            )
        if len(chunk) < page_limit:
            break
        off += page_limit
        if off >= 5000:
            break
    return out[:max_rows], None


def _rc_norm_ts_seconds(ts: Any) -> int:
    if ts is None or ts == "":
        return 0
    try:
        n = int(float(ts))
    except Exception:
        return 0
    return n // 1000 if n > 10**12 else n


def _rc_js_date_string(ts_sec: int) -> str:
    """Approximate JS Date.toDateString() in Asia/Kuwait."""
    dt = datetime.fromtimestamp(ts_sec, tz=ZoneInfo("Asia/Kuwait"))
    return dt.strftime("%a %b %d %Y")


def _rc_machine_day_key(machine_id: Any, ts_sec: int) -> str:
    ts_i = _rc_norm_ts_seconds(ts_sec)
    return f"{machine_id}_{_rc_js_date_string(ts_i)}"


def _rc_reason_key(log_id: Any, machine_id: Any, ts_seconds: int) -> str:
    mid = str(machine_id).strip() if machine_id is not None and str(machine_id).strip() != "" else "_"
    return f"{log_id}|{mid}|{ts_seconds}"


def _rc_machine_ts_key(machine_id: Any, ts_seconds: int) -> str:
    mid = str(machine_id).strip() if machine_id is not None and str(machine_id).strip() != "" else "_"
    return f"{mid}|{ts_seconds}"


def _fetch_vendon_users_list() -> List[Dict[str, Any]]:
    data, err = _vendon_get("/user", None)
    if err or not isinstance(data, dict):
        return []
    rows = data.get("result")
    return rows if isinstance(rows, list) else []


def _basic_auth_header_vendon_cloud() -> Optional[str]:
    if not VENDON_USERNAME or not VENDON_PASSWORD:
        return None
    tok = base64.b64encode(f"{VENDON_USERNAME}:{VENDON_PASSWORD}".encode("utf-8")).decode("ascii")
    return f"Basic {tok}"


def _parse_remote_credit_record_python(record: Dict[str, Any], machine_id: str) -> Optional[Dict[str, Any]]:
    """Mirror parseRemoteCreditRecordRobust then parseRemoteCreditRecord (WEB credit sent + Vend successful only)."""
    raw = record.get("data") or ""
    if not isinstance(raw, str):
        raw = str(raw)

    lines = [ln.strip() for ln in re.split(r"<br\s*/?>\s*", raw, flags=re.IGNORECASE) if ln.strip()]
    credit_amount = None
    status = "Unknown"
    allowed_products = ""

    for line in lines:
        ll = line.lower()
        if "credit" in ll:
            parts = re.split(r"(?:=>|=&gt;)", line, maxsplit=1)
            if len(parts) >= 2:
                try:
                    credit_amount = float(parts[1].strip().split()[0])
                except Exception:
                    pass
        if "status" in ll:
            parts = re.split(r"(?:=>|=&gt;)", line, maxsplit=1)
            if len(parts) >= 2:
                status = parts[1].strip().split("<")[0].strip()
        if "allowed products" in ll:
            parts = re.split(r"(?:=>|=&gt;)", line, maxsplit=1)
            if len(parts) >= 2:
                allowed_products = parts[1].strip().split("<")[0].strip()

    if credit_amount is None:
        m_cred = re.search(r"Credit\s*(?:=>|=&gt;)\s*([\d.]+)", raw, flags=re.IGNORECASE)
        if m_cred:
            try:
                credit_amount = float(m_cred.group(1))
            except Exception:
                credit_amount = None
        m_stat = re.search(r"Status\s*(?:=>|=&gt;)\s*([^<\n]+)", raw, flags=re.IGNORECASE)
        if m_stat:
            status = m_stat.group(1).strip().split("<")[0].strip()
        m_prod = re.search(r"Allowed products\s*(?:=>|=&gt;)\s*([^<\n]+)", raw, flags=re.IGNORECASE)
        if m_prod:
            allowed_products = m_prod.group(1).strip()

    if status != "Vend successful":
        return None
    ts_raw = record.get("changed_at") or record.get("timestamp") or 0
    ts_i = _rc_norm_ts_seconds(ts_raw)

    return {
        "id": record.get("id"),
        "user_id": record.get("user_id"),
        "user_name": record.get("user_name") or "",
        "timestamp": ts_i,
        "machine_id": machine_id,
        "credit_amount": credit_amount or 0.0,
        "status": status,
        "allowed_products": allowed_products,
        "source": "settingChangeLog",
    }


def _fetch_remote_credits_setting_change_log(machine_id: str, from_ts: int, to_ts: int) -> List[Dict[str, Any]]:
    auth = _basic_auth_header_vendon_cloud()
    if not auth:
        logger.warning("Refund Tests: VENDON_USERNAME/VENDON_PASSWORD not set — skipping settingChangeLog remote credits")
        return []

    headers = {
        "accept": "*/*",
        "authorization": auth,
        "referer": f"https://cloud.vendon.net/device/{machine_id}/log",
        "user-agent": "Mozilla/5.0 (compatible; LeetMonitor/people-api)",
    }

    out: List[Dict[str, Any]] = []
    offset = 0
    limit = 200
    max_pages = 20
    max_successful = 10

    for _page in range(max_pages):
        url = (
            f"{_VENDON_CLOUD_HEAD_BASE}/machine/settingChangeLog"
            f"?id={quote(str(machine_id))}&from_timestamp={from_ts}&to_timestamp={to_ts}"
            f"&user=&limit={limit}&offset={offset}"
        )
        try:
            r = requests.get(url, headers=headers, timeout=120)
        except Exception as ex:
            logger.warning("settingChangeLog fetch failed for machine %s: %s", machine_id, ex)
            break
        if r.status_code != 200:
            logger.warning("settingChangeLog HTTP %s for machine %s", r.status_code, machine_id)
            break
        try:
            data = r.json()
        except Exception:
            break
        log_records = (((data.get("result") or {}) if isinstance(data, dict) else {}).get("log_records")) or []
        if not isinstance(log_records, list) or len(log_records) == 0:
            break

        for rec in log_records:
            if str(rec.get("action") or "") != "Remote credit sent":
                continue
            parsed = _parse_remote_credit_record_python(rec, str(machine_id))
            if parsed:
                out.append(parsed)

        if len(out) >= max_successful:
            break
        if len(log_records) < limit:
            break
        offset += limit

    out.sort(key=lambda x: int(x.get("timestamp") or 0))
    return out


def _batch_remote_credit_reason_maps(from_date: str, to_date: str) -> Tuple[Dict[str, str], Dict[str, str]]:
    reasons_by_key: Dict[str, str] = {}
    reasons_by_machine_ts: Dict[str, str] = {}
    db = _get_people_analytics_session()
    try:
        start_dt = datetime.strptime(from_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        end_dt = datetime.strptime(to_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        from_ts = int(start_dt.timestamp()) - 86400
        to_ts = int(end_dt.timestamp()) + 86400 * 2
        rows = db.query(RemoteCreditReason).filter(
            RemoteCreditReason.timestamp_val >= from_ts,
            RemoteCreditReason.timestamp_val <= to_ts,
        ).all()
        for r in rows:
            key_ts = int(r.timestamp_val or 0)
            if key_ts > 10**12:
                key_ts = key_ts // 1000
            k = _rc_reason_key(r.log_id, r.machine_id, key_ts)
            rs = r.reason or ""
            reasons_by_key[k] = rs
            reasons_by_machine_ts[_rc_machine_ts_key(r.machine_id, key_ts)] = rs
    finally:
        db.close()
    return reasons_by_key, reasons_by_machine_ts


def _fetch_vends_stats_window_gas_style(from_ts: int, to_ts: int, machine_id: Optional[str], max_rows: int = 25000) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """Same as _fetch_vends_stats_window but uses limit=1000 per page like classic GAS."""
    out: List[Dict[str, Any]] = []
    off = 0
    page_limit = 1000
    while len(out) < max_rows:
        params: Dict[str, Any] = {"from_timestamp": from_ts, "to_timestamp": to_ts, "limit": page_limit, "offset": off}
        if machine_id:
            params["machine_id"] = machine_id
        data, err = _vendon_get("/stats/vends", params)
        if err:
            return [], err
        if isinstance(data, dict) and data.get("code") is not None and int(data.get("code")) != 200:
            return [], f"Vendon stats/vends code {data.get('code')}"
        chunk = data.get("result") if isinstance(data, dict) else None
        chunk = chunk if isinstance(chunk, list) else []
        out.extend(chunk)
        if len(chunk) < page_limit:
            break
        off += page_limit
        if off > 50000:
            break
    return out[:max_rows], None


def _compute_remote_credits_logs_classic(start_date: str, end_date: str, machine_id_filter: str) -> Dict[str, Any]:
    """
    Full parity with monitoring-app-v1 remote-credits-tab.js getRemoteCreditsLogs (Kuwait calendar days + Vendon token + optional Basic Auth head API).
    """
    CUSTOM_REFUND_WINDOW_MINUTES = 5
    DRINK_TEST_WINDOW_MINUTES = 30
    TIME_WINDOW_MINUTES = 10
    AMOUNT_TOLERANCE = 0.01

    try:
        from_ts, to_ts = _kuwait_range_bounds_utc(start_date, end_date)
    except Exception as ex:
        return {"success": False, "error": f"Invalid date range: {ex}", "logs": [], "totals": []}

    mrows_rc, merr = vendon_fetch_machine_list(_vendon_get)
    if merr:
        return {"success": False, "error": merr, "logs": [], "totals": []}

    all_machines: List[Dict[str, Any]] = []
    for m in mrows_rc:
        if not isinstance(m, dict) or m.get("id") is None:
            continue
        all_machines.append({"id": str(m.get("id")), "name": m.get("name") or f"Machine {m.get('id')}"})

    sel = (machine_id_filter or "").strip()
    target_machines = [m for m in all_machines if not sel or str(m["id"]) == sel]
    if not target_machines:
        return {
            "success": True,
            "logs": [],
            "totals": [],
            "filters": {"startDate": start_date, "endDate": end_date, "machineId": sel},
        }

    all_users_cache = _fetch_vendon_users_list()

    web_cashless_vends: List[Dict[str, Any]] = []
    for machine in target_machines:
        mid = machine["id"]
        mname = machine["name"]
        vends, ve = _fetch_vends_stats_window_gas_style(from_ts, to_ts, mid, max_rows=25000)
        if ve:
            logger.warning("WEB cashless vends fetch issue machine %s: %s", mid, ve)
            continue
        for vend in vends:
            if not _is_web_cashless_vend(vend):
                continue
            ts_raw = vend.get("datetime") or vend.get("timestamp") or vend.get("time") or 0
            ts_i = _rc_norm_ts_seconds(ts_raw)
            try:
                price = float(vend.get("price") or 0)
            except Exception:
                price = 0.0
            pn, sel = _stats_vend_product_fields(vend)
            web_cashless_vends.append(
                {
                    "id": vend.get("id"),
                    "timestamp": ts_i,
                    "machine_id": mid,
                    "machine_name": mname,
                    "user_id": vend.get("user_id") or "",
                    "user_name": vend.get("user_name") or "",
                    "credit_amount": price,
                    "product_name": pn,
                    "selection": sel,
                }
            )

    failed_dispenses: List[Dict[str, Any]] = []
    for machine in target_machines:
        mid = machine["id"]
        chunk, fe = _fetch_failed_dispense_events_single_machine(from_ts, to_ts, mid)
        if fe:
            logger.warning("failed dispense events fetch issue machine %s: %s", mid, fe)
            continue
        failed_dispenses.extend(chunk)

    remote_credits_raw: List[Dict[str, Any]] = []
    for machine in target_machines:
        try:
            remote_credits_raw.extend(_fetch_remote_credits_setting_change_log(machine["id"], from_ts, to_ts))
        except Exception as ex:
            logger.warning("remote credits settingChangeLog machine %s: %s", machine["id"], ex)

    remote_credits: List[Dict[str, Any]] = []
    seen_rc: set = set()
    for credit in remote_credits_raw:
        key = f"{credit.get('machine_id')}_{credit.get('credit_amount')}_{credit.get('timestamp')}"
        if key in seen_rc:
            continue
        seen_rc.add(key)
        remote_credits.append(credit)

    reasons_by_key, reasons_by_machine_ts = _batch_remote_credit_reason_maps(start_date, end_date)

    first_tx_ms_by_day_key: Dict[str, float] = {}
    for wc in web_cashless_vends:
        ts_sec = int(wc.get("timestamp") or 0)
        if not ts_sec:
            continue
        dk = _rc_machine_day_key(wc.get("machine_id"), ts_sec)
        ms = float(ts_sec * 1000)
        prev = first_tx_ms_by_day_key.get(dk)
        if prev is None or ms < prev:
            first_tx_ms_by_day_key[dk] = ms

    logs_out: List[Dict[str, Any]] = []
    totals_by_machine: Dict[str, Dict[str, Any]] = {}

    for wc in web_cashless_vends:
        ts_sec = int(wc.get("timestamp") or 0)
        if not ts_sec:
            continue
        wc_ms = float(ts_sec * 1000)
        row_ts = _rc_norm_ts_seconds(wc.get("timestamp"))
        dk = _rc_machine_day_key(wc.get("machine_id"), ts_sec)

        same_machine_day_failed = []
        for fd in failed_dispenses:
            fts = int(fd.get("timestamp") or 0)
            if fts > 10**12:
                fts = fts // 1000
            if str(fd.get("machine_id")) != str(wc.get("machine_id")):
                continue
            if _rc_js_date_string(fts) != _rc_js_date_string(ts_sec):
                continue
            same_machine_day_failed.append(fd)

        matching_failed_within_5 = []
        for fd in same_machine_day_failed:
            fts = int(fd.get("timestamp") or 0)
            if fts > 10**12:
                fts = fts // 1000
            diff_min = abs(wc_ms - fts * 1000) / (1000 * 60)
            if diff_min <= CUSTOM_REFUND_WINDOW_MINUTES:
                matching_failed_within_5.append(fd)

        first_ms = first_tx_ms_by_day_key.get(dk)
        is_within_drink_window = False
        if first_ms is not None:
            is_within_drink_window = abs(wc_ms - first_ms) <= DRINK_TEST_WINDOW_MINUTES * 60 * 1000

        matching_remote_credits = []
        for rc in remote_credits:
            if str(rc.get("machine_id")) != str(wc.get("machine_id")):
                continue
            try:
                ramt = float(rc.get("credit_amount") or 0)
            except Exception:
                ramt = 0.0
            if abs(ramt - float(wc.get("credit_amount") or 0)) > AMOUNT_TOLERANCE:
                continue
            rts = int(rc.get("timestamp") or 0)
            if rts > 10**12:
                rts = rts // 1000
            diff_min = abs(wc_ms - rts * 1000) / (1000 * 60)
            if _rc_js_date_string(rts) != _rc_js_date_string(ts_sec):
                continue
            if diff_min <= TIME_WINDOW_MINUTES:
                matching_remote_credits.append(rc)

        category = "Reason Unidentified"
        matched_failed_dispense = None
        matched_remote_credit = None
        category_note = ""
        manual_reason = ""

        if matching_failed_within_5:
            matching_failed_within_5.sort(
                key=lambda a: (
                    0
                    if (
                        (a.get("product_name") or "").strip().lower()
                        == (wc.get("product_name") or "").strip().lower()
                        and bool((wc.get("product_name") or "").strip())
                    )
                    else 1,
                    abs(wc_ms - _rc_norm_ts_seconds(a.get("timestamp")) * 1000),
                )
            )
            matched_failed_dispense = matching_failed_within_5[0]

            matching_remote_credits.sort(
                key=lambda a: abs(wc_ms - _rc_norm_ts_seconds(a.get("timestamp")) * 1000)
            )
            if matching_remote_credits:
                matched_remote_credit = matching_remote_credits[0]

            category = "Custom Refunds"
            fms = _rc_norm_ts_seconds(matched_failed_dispense.get("timestamp"))
            time_diff_min = abs(wc_ms / 1000 - fms) / 60
            category_note = (
                f'Matched with failed dispense "{matched_failed_dispense.get("product_name") or "product"}" within {time_diff_min:.1f} minutes '
                f"(Customer Service KPI: 5 min)"
                + (" - confirmed by remote credit" if matched_remote_credit else "")
            )

        elif is_within_drink_window:
            category = "Drink Tests"
            fm = float(first_ms) if first_ms is not None else wc_ms
            tff = abs(wc_ms - fm) / (1000 * 60)
            try:
                fdt = datetime.fromtimestamp(fm / 1000.0, tz=ZoneInfo("Asia/Kuwait")).strftime("%H:%M:%S")
            except Exception:
                fdt = ""
            category_note = (
                f"Within {tff:.1f} minutes of first WEB cashless of day ({fdt}) - QA drink test"
            )

        else:
            category = "Reason Unidentified"
            category_note = "No failed dispense within 5 minutes and not within drink test window"
            full_key = _rc_reason_key(wc.get("id"), wc.get("machine_id"), row_ts)
            manual_reason = reasons_by_key.get(full_key) or reasons_by_machine_ts.get(_rc_machine_ts_key(wc.get("machine_id"), row_ts)) or ""
            if matching_remote_credits:
                matching_remote_credits.sort(
                    key=lambda a: abs(wc_ms - _rc_norm_ts_seconds(a.get("timestamp")) * 1000)
                )
                matched_remote_credit = matching_remote_credits[0]
                category_note += " (remote credit found)"

        display_user = ""
        if matched_remote_credit and matched_remote_credit.get("user_name"):
            display_user = str(matched_remote_credit.get("user_name"))
        elif wc.get("user_name"):
            display_user = str(wc.get("user_name"))
        elif wc.get("user_id") and all_users_cache:
            uid = str(wc.get("user_id"))
            user = next((u for u in all_users_cache if str(u.get("id")) == uid), None)
            if user:
                fn = (user.get("first_name") or "").strip()
                ln = (user.get("last_name") or "").strip()
                display_user = f"{fn} {ln}".strip()

        mfd_ts = _rc_norm_ts_seconds(matched_failed_dispense.get("timestamp")) if matched_failed_dispense else 0
        pn_row = str(wc.get("product_name") or "").strip()
        sel_row = str(wc.get("selection") or "").strip()
        # Classic UI column uses allowed_products || product_name (same vend product label).
        allowed_disp = pn_row or (f"Selection {sel_row}" if sel_row else "")
        logs_out.append(
            {
                "id": wc.get("id"),
                "timestamp": row_ts,
                "datetime": datetime.fromtimestamp(row_ts, tz=timezone.utc).isoformat().replace("+00:00", "Z"),
                "machine_id": wc.get("machine_id"),
                "machine_name": wc.get("machine_name"),
                "user_id": wc.get("user_id"),
                "user_name": display_user,
                "credit_amount": wc.get("credit_amount"),
                "status": category,
                "allowed_products": allowed_disp,
                "product_name": pn_row,
                "selection": sel_row,
                "user_type": "",
                "source": "stats/vends",
                "category": category,
                "category_note": category_note,
                "manual_reason": manual_reason,
                "matched_failed_dispense": (
                    {
                        "product_name": matched_failed_dispense.get("product_name"),
                        "selection": matched_failed_dispense.get("selection"),
                        "timestamp": mfd_ts,
                        "datetime": datetime.fromtimestamp(mfd_ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")
                        if mfd_ts
                        else "",
                        "description": matched_failed_dispense.get("description"),
                    }
                    if matched_failed_dispense
                    else None
                ),
                "matched_remote_credit": (
                    {
                        "amount": matched_remote_credit.get("credit_amount"),
                        "user_name": matched_remote_credit.get("user_name"),
                        "timestamp": matched_remote_credit.get("timestamp"),
                        "datetime": datetime.fromtimestamp(_rc_norm_ts_seconds(matched_remote_credit.get("timestamp")), tz=timezone.utc)
                        .isoformat()
                        .replace("+00:00", "Z")
                        if matched_remote_credit.get("timestamp")
                        else "",
                    }
                    if matched_remote_credit
                    else None
                ),
            }
        )

        mid_s = str(wc.get("machine_id"))
        if mid_s not in totals_by_machine:
            totals_by_machine[mid_s] = {
                "machine_id": wc.get("machine_id"),
                "machine_name": wc.get("machine_name"),
                "total_amount": 0.0,
                "count": 0,
                "custom_refunds_count": 0,
                "drink_tests_count": 0,
                "reason_unidentified_count": 0,
            }
        totals_by_machine[mid_s]["total_amount"] += float(wc.get("credit_amount") or 0)
        totals_by_machine[mid_s]["count"] += 1
        if category == "Custom Refunds":
            totals_by_machine[mid_s]["custom_refunds_count"] += 1
        elif category == "Drink Tests":
            totals_by_machine[mid_s]["drink_tests_count"] += 1
        elif category == "Reason Unidentified":
            totals_by_machine[mid_s]["reason_unidentified_count"] += 1

    logs_out.sort(key=lambda a: int(a.get("timestamp") or 0), reverse=True)
    totals_list = sorted(totals_by_machine.values(), key=lambda x: int(x.get("count") or 0), reverse=True)

    return {
        "success": True,
        "logs": logs_out,
        "totals": totals_list,
        "filters": {"startDate": start_date, "endDate": end_date, "machineId": sel},
    }


def _compute_remote_credits_logs_single_machine(date_str: str, machine_id: str, machine_name: str) -> Dict[str, Any]:
    """Preload/cache: full classic logic for one machine + single Kuwait day."""
    _ = machine_name  # names come from machines list inside classic path
    return _compute_remote_credits_logs_classic(date_str, date_str, machine_id)


def compute_remote_credits_logs_classic(start_date: str, end_date: str, machine_id_filter: str) -> Dict[str, Any]:
    """
    Public wrapper for remote credits classification (Custom Refunds / Drink Tests / Reason Unidentified).

    Used by Monitor (remoteCredits tab) and Leet Alert (Dispense Tests / Credits Sent columns).
    """
    return _compute_remote_credits_logs_classic(start_date, end_date, machine_id_filter)

def _ensure_revenue_table(db) -> None:
    db.execute(text("""
      CREATE TABLE IF NOT EXISTS vendon_daily_machine_revenue_cache (
        id SERIAL PRIMARY KEY,
        cache_date DATE NOT NULL,
        machine_id TEXT NOT NULL,
        machine_name TEXT,
        total_sales_kwd NUMERIC(12, 3) NOT NULL DEFAULT 0,
        total_transactions INTEGER NOT NULL DEFAULT 0,
        payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    """))
    db.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_vendon_daily_machine_revenue_cache_day_machine ON vendon_daily_machine_revenue_cache (cache_date, machine_id);"))
    db.execute(text("CREATE INDEX IF NOT EXISTS idx_vendon_daily_machine_revenue_cache_date ON vendon_daily_machine_revenue_cache (cache_date);"))


def _ensure_remote_credits_preload_table(db) -> None:
    db.execute(text("""
      CREATE TABLE IF NOT EXISTS remote_credits_preload_cache (
        id SERIAL PRIMARY KEY,
        cache_date DATE NOT NULL UNIQUE,
        best_machine_id TEXT,
        best_machine_name TEXT,
        best_machine_count INTEGER NOT NULL DEFAULT 0,
        from_date TEXT,
        to_date TEXT,
        payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    """))
    db.execute(text("CREATE INDEX IF NOT EXISTS idx_remote_credits_preload_cache_date ON remote_credits_preload_cache (cache_date);"))


def _refresh_revenue_cache_single_day(date_str: str) -> Dict[str, Any]:
    """
    Compute per-machine revenue for one day and store in DB.
    Note: This is intended for cron / internal warm-ups, not per-request heavy usage.
    """
    try:
        day = datetime.strptime(date_str, "%Y-%m-%d").date()
    except Exception as ex:
        return {"ok": False, "date": date_str, "error": f"Invalid date: {ex}"}
    from_ts, to_ts = _kuwait_day_bounds_utc(date_str)

    # Machines list for names
    mrows, err = vendon_fetch_machine_list(_vendon_get)
    if err:
        return {"ok": False, "date": date_str, "error": err}
    machines = [
        {"id": str(m.get("id")), "name": m.get("name") or str(m.get("id"))}
        for m in mrows
        if isinstance(m, dict) and m.get("id") is not None
    ]

    db = _get_people_analytics_session()
    try:
        _ensure_revenue_table(db)
        db.commit()

        db.query(VendonDailyMachineRevenueCache).filter(VendonDailyMachineRevenueCache.cache_date == day).delete(synchronize_session=False)

        inserted = 0
        for m in machines:
            vends, ve = _fetch_vends_stats_window(from_ts, to_ts, m["id"], max_rows=25000)
            if ve:
                logger.warning("revenue cache vends error for %s: %s", m["id"], ve)
                continue
            total_sales = 0.0
            total_tx = 0
            for v in vends:
                try:
                    price = float(v.get("price") or 0)
                except Exception:
                    price = 0.0
                total_sales += price
                total_tx += 1

            rec = VendonDailyMachineRevenueCache(
                cache_date=day,
                machine_id=m["id"],
                machine_name=m["name"],
                total_sales_kwd=total_sales,
                total_transactions=total_tx,
                payload_json={"machine_id": m["id"], "machine_name": m["name"], "totalSales": total_sales, "totalTransactions": total_tx},
                created_at=datetime.utcnow(),
            )
            db.add(rec)
            inserted += 1

        db.commit()
        return {"ok": True, "date": date_str, "inserted": inserted}
    except Exception as ex:
        db.rollback()
        logger.exception("revenue cache refresh failed")
        return {"ok": False, "date": date_str, "error": str(ex)}
    finally:
        db.close()


def _read_top_revenue_machines_cached(date_str: str, limit: int) -> Optional[Dict[str, Any]]:
    try:
        day = datetime.strptime(date_str, "%Y-%m-%d").date()
    except Exception:
        return None
    db = _get_people_analytics_session()
    try:
        q = db.query(VendonDailyMachineRevenueCache).filter(VendonDailyMachineRevenueCache.cache_date == day)
        rows = q.order_by(VendonDailyMachineRevenueCache.total_sales_kwd.desc()).limit(max(1, min(limit, 20))).all()
        if not rows:
            return None
        machines = [{"id": r.machine_id, "name": r.machine_name, "totalSales": float(r.total_sales_kwd or 0), "totalTransactions": int(r.total_transactions or 0)} for r in rows]
        return {"success": True, "machines": machines, "date": date_str, "fromCache": True}
    finally:
        db.close()


def _refresh_remote_credits_preload_cache(date_str: str) -> Dict[str, Any]:
    """
    Compute yesterday remote credits preload:
    - best machine by WEB cashless vend count
    - remote credits logs for that machine/day
    Store as one JSON payload for fast autoload.
    """
    try:
        day = datetime.strptime(date_str, "%Y-%m-%d").date()
    except Exception as ex:
        return {"ok": False, "date": date_str, "error": f"Invalid date: {ex}"}
    from_ts, to_ts = _kuwait_day_bounds_utc(date_str)

    mrows_pre, err = vendon_fetch_machine_list(_vendon_get)
    if err:
        return {"ok": False, "date": date_str, "error": err}
    machines = [
        {"id": str(m.get("id")), "name": m.get("name") or str(m.get("id"))}
        for m in mrows_pre
        if isinstance(m, dict) and m.get("id") is not None
    ]

    best = None
    for m in machines:
        vends, ve = _fetch_vends_stats_window(from_ts, to_ts, m["id"], max_rows=25000)
        if ve:
            continue
        c = 0
        for v in vends:
            if _is_web_cashless_vend(v):
                c += 1
        if best is None or c > best["count"]:
            best = {"machine_id": m["id"], "machine_name": m["name"], "count": c}

    if not best:
        best = {"machine_id": None, "machine_name": None, "count": 0}

    prefetched = None
    if best.get("machine_id"):
        prefetched = _compute_remote_credits_logs_single_machine(date_str, best["machine_id"], best.get("machine_name") or "")
    payload = {
        "success": True,
        "bestMachine": best,
        "fromDate": date_str,
        "toDate": date_str,
        "prefetchedResponse": prefetched,
    }

    db = _get_people_analytics_session()
    try:
        _ensure_remote_credits_preload_table(db)
        db.commit()
        # Upsert singleton per date
        existing = db.query(RemoteCreditsPreloadCache).filter(RemoteCreditsPreloadCache.cache_date == day).first()
        if existing:
            existing.best_machine_id = best.get("machine_id")
            existing.best_machine_name = best.get("machine_name")
            existing.best_machine_count = int(best.get("count") or 0)
            existing.from_date = date_str
            existing.to_date = date_str
            existing.payload_json = payload
            existing.created_at = datetime.utcnow()
        else:
            db.add(RemoteCreditsPreloadCache(
                cache_date=day,
                best_machine_id=best.get("machine_id"),
                best_machine_name=best.get("machine_name"),
                best_machine_count=int(best.get("count") or 0),
                from_date=date_str,
                to_date=date_str,
                payload_json=payload,
                created_at=datetime.utcnow(),
            ))
        db.commit()
        return {"ok": True, "date": date_str, "bestMachine": best}
    except Exception as ex:
        db.rollback()
        logger.exception("remote credits preload cache refresh failed")
        return {"ok": False, "date": date_str, "error": str(ex)}
    finally:
        db.close()


def _refresh_cache_single_day(date_str: str) -> Dict[str, Any]:
    """
    Fetch Vendon events for one day (full set), map/exclude, then upsert into DB.
    Returns { ok, date, inserted, totalMapped, error? }.
    """
    # Fetch all mapped events without paging slice
    base = fetch_and_process_events(
        start_date=date_str,
        end_date=date_str,
        machine_id=None,
        event_name_filter=None,
        limit=5000,
        offset=0,
    )
    if base.get("error"):
        return {"ok": False, "date": date_str, "error": base["error"]}

    # base.events is only first slice; re-fetch full set by calling fetch_and_process_events with large limit=5000 and offset=0
    # totalCount includes all mapped. But events list is limited to 5000 already; good enough.
    mapped = base.get("events") or []
    total = int(base.get("totalCount") or 0)
    try:
        day = datetime.strptime(date_str, "%Y-%m-%d").date()
    except Exception as ex:
        return {"ok": False, "date": date_str, "error": f"Invalid date: {ex}"}

    db = _get_people_analytics_session()
    try:
        # Ensure table exists even if migration wasn't applied yet.
        db.execute(text("""
          CREATE TABLE IF NOT EXISTS vendon_events_cache (
            id SERIAL PRIMARY KEY,
            cache_date DATE NOT NULL,
            event_key TEXT NOT NULL,
            vendon_event_id TEXT,
            machine_id TEXT,
            machine_name TEXT,
            name TEXT,
            base_code TEXT,
            display_name TEXT,
            received_at INTEGER,
            resolved_at INTEGER,
            duration INTEGER,
            payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        """))
        db.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_vendon_events_cache_date_key ON vendon_events_cache (cache_date, event_key);"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_vendon_events_cache_date ON vendon_events_cache (cache_date);"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_vendon_events_cache_machine_date ON vendon_events_cache (machine_id, cache_date);"))
        db.commit()

        # Replace-day strategy: delete then insert (keeps it simple + deterministic)
        db.query(VendonEventCache).filter(VendonEventCache.cache_date == day).delete(synchronize_session=False)
        inserted = 0
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        # Deduplicate within the same refresh run (Vendon can return duplicates occasionally).
        uniq: Dict[str, Dict[str, Any]] = {}
        for e in mapped:
            uniq[_event_key_for_cache(e)] = e
        for key, e in uniq.items():
            rec = VendonEventCache(
                cache_date=day,
                event_key=key,
                vendon_event_id=str(e.get("id") or "") or None,
                machine_id=str(e.get("machine_id") or e.get("machine") or "") or None,
                machine_name=str(e.get("machine_name") or "") or None,
                name=str(e.get("original_name") or e.get("name") or "") or None,
                base_code=str(e.get("original_base_code") or e.get("base_code") or "") or None,
                display_name=str(e.get("display_name") or "") or None,
                received_at=int(e.get("received_at") or 0) or None,
                resolved_at=int(e.get("resolved_at") or 0) or None,
                duration=int(e.get("duration") or 0) or None,
                payload_json=e,
                created_at=now,
            )
            db.add(rec)
            inserted += 1
        db.commit()
        return {"ok": True, "date": date_str, "inserted": inserted, "totalMapped": total, "deduped": len(uniq)}
    except Exception as ex:
        db.rollback()
        logger.exception("vendon cache refresh failed")
        return {"ok": False, "date": date_str, "error": str(ex)}
    finally:
        db.close()


def register_vendon_proxy_routes(app) -> None:
    def _verify_browser_token(auth_header: str, purpose_expected: str) -> Tuple[Optional[str], Optional[str]]:
        """
        Verify a short-lived HMAC token minted by GAS (dashboard-access-api.js getBrowserApiToken_).
        Header: Authorization: Bearer <base64url(json)>.<hex(hmac)>
        """
        if not auth_header:
            return None, "missing_auth"
        raw = auth_header.strip()
        if raw.lower().startswith("bearer "):
            raw = raw[7:].strip()
        if "." not in raw:
            return None, "bad_token"
        b64, hexsig = raw.split(".", 1)
        try:
            import base64
            # pad base64url
            pad = "=" * ((4 - (len(b64) % 4)) % 4)
            js = base64.urlsafe_b64decode((b64 + pad).encode("utf-8")).decode("utf-8")
        except Exception:
            return None, "bad_b64"
        secret = (os.environ.get("DASHBOARD_ACCESS_API_KEY") or "").strip()
        if not secret:
            return None, "server_secret_missing"
        try:
            import hmac, hashlib
            mac = hmac.new(secret.encode("utf-8"), js.encode("utf-8"), hashlib.sha256).hexdigest()
        except Exception:
            return None, "hmac_fail"
        if not hmac.compare_digest(mac, hexsig.strip().lower()):
            return None, "bad_sig"
        try:
            payload = json.loads(js)
        except Exception:
            return None, "bad_json"
        email = (payload.get("email") or "").strip().lower()
        purpose = (payload.get("purpose") or "").strip()
        exp = int(payload.get("exp") or 0)
        now = int(datetime.now(timezone.utc).timestamp())
        if not email:
            return None, "no_email"
        if purpose_expected and purpose != purpose_expected:
            return None, "bad_purpose"
        if exp <= now:
            return None, "expired"
        return email, None

    @app.route("/api/vendon/machines", methods=["GET", "OPTIONS"])
    def vendon_machines():
        if request.method == "OPTIONS":
            return "", 204
        err_resp = _require_any_machine_dropdown_tab()
        if err_resp[1]:
            return err_resp[1]
        rows, err = vendon_fetch_machine_list(_vendon_get)
        if err:
            return jsonify({"error": err}), 502
        machines = []
        for m in rows:
            if not isinstance(m, dict) or m.get("id") is None:
                continue
            machines.append({"id": m.get("id"), "name": m.get("name")})
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

    @app.route("/api/vendon/maintenance/query", methods=["POST", "OPTIONS"])
    def vendon_maintenance_query():
        """
        monitoring-app-v2 General Cleaning tab — session auth + dashboard tab 'maintenance'.
        Proxies JSON body to Vendon PUT .../preventativeMaintenanceSchedules (same as v1 GAS maintenance-tab.js).
        """
        if request.method == "OPTIONS":
            return "", 204
        err_resp = _require_tab("maintenance")
        if err_resp[1]:
            return err_resp[1]
        body = request.get_json(silent=True) or {}
        data, err = _vendon_put_preventative_maintenance_schedules(body)
        if err:
            return jsonify({"error": err, "result": [], "paging": {"total": 0}}), 502
        if not isinstance(data, dict):
            return jsonify({"error": "Unexpected Vendon response shape", "result": [], "paging": {"total": 0}}), 502
        return jsonify(data)

    @app.route("/api/vendon/last-transactions", methods=["POST", "OPTIONS"])
    def vendon_last_transactions():
        """
        monitoring-app-v2 Last Transactions — same as monitoring-app/transactions-tab.js (stats/vends 24h, latest per machine).
        """
        if request.method == "OPTIONS":
            return "", 204
        err_resp = _require_tab("transactions")
        if err_resp[1]:
            return err_resp[1]
        body = request.get_json(silent=True) or {}
        mid = (body.get("machineId") or body.get("machine_id") or "").strip() or None
        rows, err = _last_transactions_classic_rows(mid)
        if err:
            return jsonify({"error": err, "transactions": []}), 502
        return jsonify({"transactions": rows})

    @app.route("/api/vendon/remote-credits/bootstrap", methods=["POST", "OPTIONS"])
    def vendon_remote_credits_bootstrap():
        """
        Browser autoload: read cached preload for a past Kuwait day (same JSON as GAS top-web-cashless + prefetched logs).
        When warm, avoids an expensive all-machines scan on first paint.
        """
        if request.method == "OPTIONS":
            return "", 204
        err_resp = _require_tab("remoteCredits")
        if err_resp[1]:
            return err_resp[1]
        body = request.get_json(silent=True) or {}
        date_str = (body.get("date") or "").strip()
        if not date_str:
            date_str = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
        try:
            day = datetime.strptime(date_str, "%Y-%m-%d").date()
        except Exception:
            return jsonify({"success": False, "error": "Invalid date"}), 400
        today = datetime.now(timezone.utc).date()
        if day >= today:
            return jsonify({"success": True, "hasPreload": False, "reason": "not_historical_day"}), 200
        db = _get_people_analytics_session()
        try:
            _ensure_remote_credits_preload_table(db)
            db.commit()
            row = db.query(RemoteCreditsPreloadCache).filter(RemoteCreditsPreloadCache.cache_date == day).first()
            if row and row.payload_json:
                out = dict(row.payload_json)
                out["fromCache"] = True
                return jsonify({"success": True, "hasPreload": True, "payload": out}), 200
        finally:
            db.close()
        return jsonify({"success": True, "hasPreload": False}), 200

    @app.route("/api/vendon/remote-credits/query", methods=["POST", "OPTIONS"])
    def vendon_remote_credits_query():
        """
        monitoring-app-v2 Refund Tests — parity with monitoring-app-v1 getRemoteCreditsLogs (WEB cashless vs failed dispense + settingChangeLog).
        Session auth + dashboard tab 'remoteCredits'.
        """
        if request.method == "OPTIONS":
            return "", 204
        err_resp = _require_tab("remoteCredits")
        if err_resp[1]:
            return err_resp[1]
        body = request.get_json(silent=True) or {}
        start = (body.get("startDate") or body.get("start_date") or "").strip()
        end = (body.get("endDate") or body.get("end_date") or "").strip()
        machine_id = (body.get("machineId") or body.get("machine_id") or "").strip()
        if not start or not end:
            return jsonify({"success": False, "error": "startDate and endDate are required", "logs": [], "totals": []}), 400
        try:
            out = _compute_remote_credits_logs_classic(start, end, machine_id)
            return jsonify(out), 200
        except Exception as ex:
            logger.exception("vendon_remote_credits_query")
            return jsonify({"success": False, "error": str(ex), "logs": [], "totals": []}), 200

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

    @app.route("/api/vendon/gas/events/query", methods=["POST", "OPTIONS"])
    def vendon_events_gas_query():
        """
        GAS-friendly endpoint: secured by X-Dashboard-Access-Secret and email in body.
        If querying a single day strictly before today, prefer DB cache.
        """
        if request.method == "OPTIONS":
            return "", 204
        if not _check_secret():
            return jsonify({"error": "Unauthorized"}), 401
        body = request.get_json(silent=True) or {}
        email = (body.get("email") or "").strip().lower()
        if not email:
            return jsonify({"error": "email required"}), 400
        if "events" not in _allowed_tabs_for_email(email):
            return jsonify({"error": "Forbidden", "tab": "events"}), 403

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

        # Single-day cache preference (yesterday, etc.)
        if start == end:
            try:
                req_day = datetime.strptime(start, "%Y-%m-%d").date()
                today = datetime.now(timezone.utc).date()
                if req_day < today:
                    cached = _try_read_cached_events_single_day(start, machine_id, event_name, limit, offset)
                    if cached is not None:
                        cached["fromCache"] = True
                        return jsonify(cached)
                    # cache miss: fetch live once and seed cache for that day
                    seed = _refresh_cache_single_day(start)
                    if seed.get("ok"):
                        cached2 = _try_read_cached_events_single_day(start, machine_id, event_name, limit, offset)
                        if cached2 is not None:
                            cached2["fromCache"] = True
                            cached2["cacheSeeded"] = True
                            return jsonify(cached2)
            except Exception:
                pass

        result = fetch_and_process_events(start, end, machine_id, event_name, limit, offset)
        if result.get("error"):
            return jsonify({"events": [], "totalCount": 0, "error": result["error"]}), 200
        return jsonify({"events": result["events"], "totalCount": result["totalCount"], "fromCache": False})

    @app.route("/api/vendon/browser/events/query", methods=["POST", "OPTIONS"])
    def vendon_events_browser_query():
        """
        Browser-safe endpoint for legacy GAS UI.
        Auth via short-lived HMAC token minted by GAS (no UrlFetch quota).
        """
        if request.method == "OPTIONS":
            return "", 204
        email, terr = _verify_browser_token(request.headers.get("Authorization") or "", "events")
        if terr:
            return jsonify({"error": "Unauthorized", "code": terr}), 401
        if "events" not in _allowed_tabs_for_email(email):
            return jsonify({"error": "Forbidden", "tab": "events"}), 403
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

        # Prefer cache for past single-day
        if start == end:
            try:
                req_day = datetime.strptime(start, "%Y-%m-%d").date()
                today = datetime.now(timezone.utc).date()
                if req_day < today:
                    cached = _try_read_cached_events_single_day(start, machine_id, event_name, limit, offset)
                    if cached is not None:
                        cached["fromCache"] = True
                        return jsonify(cached), 200
            except Exception:
                pass

        result = fetch_and_process_events(start, end, machine_id, event_name, limit, offset)
        if result.get("error"):
            return jsonify({"events": [], "totalCount": 0, "error": result["error"]}), 200
        return jsonify({"events": result["events"], "totalCount": result["totalCount"], "fromCache": False}), 200

    @app.route("/api/vendon/internal/cache-events", methods=["POST", "OPTIONS"])
    def vendon_internal_cache_events():
        """Cron entrypoint: refresh cached Vendon events for a date (default yesterday)."""
        if request.method == "OPTIONS":
            return "", 204
        if not _check_secret():
            return jsonify({"error": "Unauthorized"}), 401
        body = request.get_json(silent=True) or {}
        date_str = (body.get("date") or "").strip()
        if not date_str:
            y = datetime.now(timezone.utc).date() - timedelta(days=1)
            date_str = y.isoformat()
        res = _refresh_cache_single_day(date_str)
        code = 200 if res.get("ok") else 502
        return jsonify(res), code

    @app.route("/api/vendon/internal/cache-revenue", methods=["POST", "OPTIONS"])
    def vendon_internal_cache_revenue():
        if request.method == "OPTIONS":
            return "", 204
        if not _check_secret():
            return jsonify({"error": "Unauthorized"}), 401
        body = request.get_json(silent=True) or {}
        date_str = (body.get("date") or "").strip()
        if not date_str:
            date_str = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
        res = _refresh_revenue_cache_single_day(date_str)
        return jsonify(res), (200 if res.get("ok") else 502)

    @app.route("/api/vendon/gas/top-revenue-machines", methods=["POST", "OPTIONS"])
    def vendon_gas_top_revenue_machines():
        if request.method == "OPTIONS":
            return "", 204
        if not _check_secret():
            return jsonify({"error": "Unauthorized"}), 401
        body = request.get_json(silent=True) or {}
        email = (body.get("email") or "").strip().lower()
        if not email:
            return jsonify({"error": "email required"}), 400
        if "refill" not in _allowed_tabs_for_email(email) and "historical" not in _allowed_tabs_for_email(email):
            # Reuse this endpoint for multiple tabs that need top revenue.
            return jsonify({"error": "Forbidden", "tab": "refill|historical"}), 403
        date_str = (body.get("date") or "").strip()
        limit = int(body.get("limit") or 5)
        limit = max(1, min(limit, 20))
        if not date_str:
            date_str = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
        cached = _read_top_revenue_machines_cached(date_str, limit)
        if cached is not None:
            return jsonify(cached), 200
        # Cache miss -> compute once and retry read
        seed = _refresh_revenue_cache_single_day(date_str)
        if seed.get("ok"):
            cached2 = _read_top_revenue_machines_cached(date_str, limit)
            if cached2 is not None:
                cached2["cacheSeeded"] = True
                return jsonify(cached2), 200
        return jsonify({"success": False, "error": seed.get("error") or "cache_miss"}), 200

    @app.route("/api/vendon/internal/cache-remote-credits-preload", methods=["POST", "OPTIONS"])
    def vendon_internal_cache_remote_credits_preload():
        if request.method == "OPTIONS":
            return "", 204
        if not _check_secret():
            return jsonify({"error": "Unauthorized"}), 401
        body = request.get_json(silent=True) or {}
        date_str = (body.get("date") or "").strip()
        if not date_str:
            date_str = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
        res = _refresh_remote_credits_preload_cache(date_str)
        return jsonify(res), (200 if res.get("ok") else 502)

    @app.route("/api/vendon/gas/remote-credits/top-web-cashless", methods=["POST", "OPTIONS"])
    def vendon_gas_remote_credits_top_web_cashless():
        if request.method == "OPTIONS":
            return "", 204
        if not _check_secret():
            return jsonify({"error": "Unauthorized"}), 401
        body = request.get_json(silent=True) or {}
        email = (body.get("email") or "").strip().lower()
        if not email:
            return jsonify({"error": "email required"}), 400
        if "remoteCredits" not in _allowed_tabs_for_email(email):
            return jsonify({"error": "Forbidden", "tab": "remoteCredits"}), 403
        date_str = (body.get("date") or "").strip()
        if not date_str:
            date_str = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
        try:
            day = datetime.strptime(date_str, "%Y-%m-%d").date()
        except Exception:
            return jsonify({"success": False, "error": "Invalid date"}), 200
        db = _get_people_analytics_session()
        try:
            _ensure_remote_credits_preload_table(db)
            db.commit()
            row = db.query(RemoteCreditsPreloadCache).filter(RemoteCreditsPreloadCache.cache_date == day).first()
            if row and row.payload_json:
                out = dict(row.payload_json)
                out["fromCache"] = True
                return jsonify(out), 200
        finally:
            db.close()
        # Seed on demand
        seed = _refresh_remote_credits_preload_cache(date_str)
        if seed.get("ok"):
            db2 = _get_people_analytics_session()
            try:
                row2 = db2.query(RemoteCreditsPreloadCache).filter(RemoteCreditsPreloadCache.cache_date == day).first()
                if row2 and row2.payload_json:
                    out2 = dict(row2.payload_json)
                    out2["fromCache"] = True
                    out2["cacheSeeded"] = True
                    return jsonify(out2), 200
            finally:
                db2.close()
        return jsonify({"success": False, "error": seed.get("error") or "cache_miss"}), 200

    @app.route("/api/monitoring/strike", methods=["POST", "OPTIONS"])
    def monitoring_strike():
        """Channel Slack post only (survey proxy); operator DMs remain in GAS until ported."""
        if request.method == "OPTIONS":
            return "", 204
        err_resp = _require_strike_tab()
        if err_resp[1]:
            return err_resp[1]
        body = request.get_json(silent=True) or {}
        strike_n = int(body.get("strikeNumber") or body.get("strike_number") or 0)
        machine_name = (body.get("machineName") or body.get("machine_name") or "Unknown").strip()
        event_type = (body.get("eventType") or body.get("event_type") or "Unknown").strip()
        operator_email = (body.get("operatorEmail") or body.get("operator_email") or "").strip()
        if strike_n not in (1, 2, 3):
            return jsonify({"success": False, "error": "strikeNumber must be 1, 2, or 3"}), 400
        op_line = f"\nOperator contact: {operator_email}" if operator_email else ""
        text = (
            f"⚠️ *STRIKE {strike_n}* ⚠️\n"
            f"Event Type: {event_type}\nMachine: {machine_name}\n"
            f"Timestamp: {body.get('timestamp') or ''}{op_line}"
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
