"""
Live Ops board — aggregated machine health for monitoring-app-v2 (airport-style dashboard).

Uses Vendon API + rows in monitoring_dashboard.live_machine_config / live_shift_clock_in.
"""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlencode

import requests
from flask import jsonify, request, session as flask_session
from sqlalchemy.orm import Session
from zoneinfo import ZoneInfo

from dashboard_access_models import (
    DashboardAccessDefault,
    DashboardAccessUser,
    LiveMachineConfig,
    LiveShiftClockIn,
    create_dashboard_engine_and_session,
)
from dashboard_access_routes import ALL_DASHBOARD_TAB_IDS, SUPER_ADMIN_EMAILS, _check_secret
from vendon_constants import EVENT_NAME_MAPPING, EXCLUDED_EVENT_NAMES

logger = logging.getLogger(__name__)

VENDON_API_BASE = (os.environ.get("VENDON_API_BASE") or "").strip().rstrip("/")
VENDON_API_KEY = (os.environ.get("VENDON_API_KEY") or "").strip()
VENDON_MAINTENANCE_URL = (
    (os.environ.get("VENDON_MAINTENANCE_URL") or "").strip().rstrip("/")
    or "https://cloud.vendon.net/rest/head/maintenance/preventativeMaintenanceSchedules"
)

MAINT_STATUS_RANK = {"overdue": 0, "due": 1, "due_soon": 2, "ok": 3}

_dash_engine_local = None
_dash_session_factory = None


def _dash_session() -> Session:
    global _dash_engine_local, _dash_session_factory
    if _dash_session_factory is None:
        _dash_engine_local, _dash_session_factory = create_dashboard_engine_and_session()
    return _dash_session_factory()


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


def _alias_live_dashboard_to_red_alert(tabs: List[str]) -> List[str]:
    if not tabs:
        return tabs
    if "*" in tabs or "redAlert" in tabs:
        return tabs
    if "liveDashboard" in tabs or "overall" in tabs:
        return list(tabs) + ["redAlert"]
    return tabs


def _parse_snapshot_focus_date(raw: Optional[str]) -> Optional[date]:
    if raw is None or not str(raw).strip():
        return None
    try:
        return datetime.strptime(str(raw).strip()[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _vend_timestamps_for_window(now: datetime, focus: Optional[date]) -> Tuple[int, int]:
    """Without focus: last 7 days. With focus: UTC slice around that calendar day (covers all machine timezones)."""
    if focus is None:
        return int((now - timedelta(days=7)).timestamp()), int(now.timestamp())
    utc_start = datetime.combine(focus - timedelta(days=3), time.min, tzinfo=timezone.utc)
    utc_end = datetime.combine(focus + timedelta(days=3), time.max, tzinfo=timezone.utc)
    to_cap = min(now, utc_end)
    return int(utc_start.timestamp()), int(to_cap.timestamp())


def _allowed_tabs_for_email(email: str) -> List[str]:
    e = (email or "").strip().lower()
    if not e:
        return []
    if e in SUPER_ADMIN_EMAILS:
        return _alias_live_dashboard_to_red_alert(list(ALL_DASHBOARD_TAB_IDS))
    db = _dash_session()
    try:
        default_row = db.query(DashboardAccessDefault).filter(DashboardAccessDefault.id == 1).first()
        default_tabs = _coerce_list(default_row.default_tabs) if default_row else ["*"]
        if not default_tabs:
            default_tabs = ["*"]
        default_tabs = _normalize_tabs(default_tabs)
        for row in db.query(DashboardAccessUser).all():
            if row.email.strip().lower() == e:
                return _alias_live_dashboard_to_red_alert(_normalize_tabs(_coerce_list(row.allowed_tabs)))
        return _alias_live_dashboard_to_red_alert(default_tabs)
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


def _require_any_tab(tab_ids: List[str]) -> Tuple[Optional[str], Optional[Any]]:
    email = _require_session_email()
    if not email:
        return None, (jsonify({"error": "Unauthorized"}), 401)
    allowed = set(_allowed_tabs_for_email(email))
    if not any(t in allowed for t in tab_ids):
        return None, (jsonify({"error": "Forbidden", "tabs": tab_ids}), 403)
    return email, None


def _vendon_headers() -> Dict[str, str]:
    return {"Authorization": f"Token {VENDON_API_KEY}"}


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
        logger.exception("live_dashboard vendon_get")
        return None, str(ex)


def _vendon_put_maintenance_schedules(payload: Dict[str, Any]) -> Tuple[Optional[Dict], Optional[str]]:
    if not VENDON_API_KEY:
        return None, "VENDON_API_KEY not configured on server"
    headers = {
        **(_vendon_headers()),
        "Content-Type": "application/json",
        "Accept": "*/*",
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
        logger.exception("live_dashboard maintenance")
        return None, str(ex)


def _map_display_name(e: Dict[str, Any]) -> str:
    name = e.get("name") or ""
    base = e.get("base_code") or ""
    return (
        EVENT_NAME_MAPPING.get(name)
        or EVENT_NAME_MAPPING.get(base)
        or name
        or "Unknown Event"
    )


def _is_door_event(e: Dict[str, Any]) -> bool:
    disp = _map_display_name(e)
    if disp == "Door opened":
        return True
    n = (e.get("name") or "") + " " + (e.get("base_code") or "")
    return "door" in n.lower()


def _fetch_all_vends(from_ts: int, to_ts: int) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    rows: List[Dict[str, Any]] = []
    off = 0
    page_limit = 500
    while off < 50000:
        params = {
            "from_timestamp": from_ts,
            "to_timestamp": to_ts,
            "limit": page_limit,
            "offset": off,
        }
        data, err = _vendon_get("/stats/vends", params)
        if err:
            return [], err
        chunk = data.get("result") if isinstance(data, dict) else None
        chunk = chunk if isinstance(chunk, list) else []
        rows.extend(chunk)
        if len(chunk) < page_limit:
            break
        off += page_limit
    return rows, None


def _fetch_door_last_ts(from_ts: int, to_ts: int) -> Tuple[Dict[str, int], Optional[str]]:
    """machine_id -> max unix ts for door-like events (not using delay-risk short-event exclusion)."""
    last: Dict[str, int] = {}
    off = 0
    page_limit = 500
    while off < 12000:
        params = {
            "from_timestamp": from_ts,
            "to_timestamp": to_ts,
            "limit": page_limit,
            "offset": off,
        }
        data, err = _vendon_get("/event", params)
        if err:
            return {}, err
        chunk = data.get("result") if isinstance(data, dict) else None
        chunk = chunk if isinstance(chunk, list) else []
        for e in chunk:
            name = e.get("name") or ""
            base = e.get("base_code") or ""
            if name in EXCLUDED_EVENT_NAMES or base in EXCLUDED_EVENT_NAMES:
                continue
            if not _is_door_event(e):
                continue
            mid = str(e.get("machine_id") or e.get("machine") or "")
            if not mid:
                continue
            ra = e.get("received_at")
            try:
                ts = int(ra) if ra is not None else 0
            except (TypeError, ValueError):
                ts = 0
            if ts <= 0:
                continue
            if ts > last.get(mid, 0):
                last[mid] = ts
        if len(chunk) < page_limit:
            break
        off += page_limit
    return last, None


def _maintenance_worst_by_machine() -> Tuple[Dict[str, str], Optional[str]]:
    """machine_id str -> worst status label among schedules."""
    payload = {
        "offset": 0,
        "limit": 8000,
        "statuses": ["ok", "due_soon", "due", "overdue"],
        "maintenance_type_ids": [],
        "assigned_employee_ids": [],
        "machine_ids": [],
        "location_ids": [],
        "machine_tag_ids": [],
        "client_ids": [],
    }
    data, err = _vendon_put_maintenance_schedules(payload)
    if err:
        return {}, err
    rows = data.get("result") if isinstance(data, dict) else None
    rows = rows if isinstance(rows, list) else []
    worst: Dict[str, int] = {}
    for row in rows:
        st = (row.get("status") or "").lower().strip()
        if st not in MAINT_STATUS_RANK:
            continue
        mid = row.get("machine_id")
        if mid is None:
            continue
        mkey = str(mid).strip()
        if not mkey:
            continue
        rank = MAINT_STATUS_RANK[st]
        if mkey not in worst or rank < worst[mkey]:
            worst[mkey] = rank
    inv = {v: k for k, v in MAINT_STATUS_RANK.items()}
    return {k: inv[v] for k, v in worst.items()}, None


def _parse_hhmm(s: str) -> Optional[Tuple[int, int]]:
    s = (s or "").strip()
    m = re.match(r"^(\d{1,2}):(\d{2})$", s)
    if not m:
        return None
    h, mi = int(m.group(1)), int(m.group(2))
    if h > 23 or mi > 59:
        return None
    return h, mi


def _decimal_or_none(v: Any) -> Optional[Decimal]:
    if v is None or v == "":
        return None
    try:
        return Decimal(str(v))
    except Exception:
        return None


def _gas_verify_email_tab(body: Any, tab_id: str) -> Optional[Any]:
    """Returns Flask error response tuple if denied, else None."""
    if not _check_secret():
        return (jsonify({"error": "Unauthorized"}), 401)
    if not isinstance(body, dict):
        body = {}
    email = (body.get("email") or "").strip().lower()
    if not email:
        return (jsonify({"error": "email required"}), 400)
    if tab_id not in _allowed_tabs_for_email(email):
        return (jsonify({"error": "Forbidden", "tab": tab_id}), 403)
    return None


def _gas_verify_email_any_tab(body: Any, tab_ids: List[str]) -> Optional[Any]:
    if not _check_secret():
        return (jsonify({"error": "Unauthorized"}), 401)
    if not isinstance(body, dict):
        body = {}
    email = (body.get("email") or "").strip().lower()
    if not email:
        return (jsonify({"error": "email required"}), 400)
    allowed = set(_allowed_tabs_for_email(email))
    if not any(t in allowed for t in tab_ids):
        return (jsonify({"error": "Forbidden", "tabs": tab_ids}), 403)
    return None


def _live_snapshot_payload(focus_date: Optional[date] = None) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    from_ts, to_ts = _vend_timestamps_for_window(now, focus_date)

    machines_data, m_err = _vendon_get("/machine", None)
    if m_err:
        return {"error": m_err, "machines": []}
    mrows = machines_data.get("result") if isinstance(machines_data, dict) else None
    mrows = mrows if isinstance(mrows, list) else []
    machine_list = [{"id": str(m.get("id")), "name": m.get("name") or str(m.get("id"))} for m in mrows if m.get("id") is not None]

    vends, v_err = _fetch_all_vends(from_ts, to_ts)
    if v_err:
        logger.warning("live snapshot vends: %s", v_err)

    last_vend_ts: Dict[str, int] = {}

    for v in vends:
        mid = str(v.get("machine_id") or v.get("machine") or "")
        if not mid:
            continue
        ts = v.get("timestamp") or v.get("time")
        try:
            ts_i = int(ts)
        except (TypeError, ValueError):
            continue
        if ts_i > last_vend_ts.get(mid, 0):
            last_vend_ts[mid] = ts_i

    door_ts, d_err = _fetch_door_last_ts(from_ts - 86400, to_ts)
    if d_err:
        logger.warning("live snapshot doors: %s", d_err)

    maint_by_m, maint_err = _maintenance_worst_by_machine()
    if maint_err:
        logger.warning("live snapshot maintenance: %s", maint_err)

    db = _dash_session()
    configs: Dict[str, LiveMachineConfig] = {}
    try:
        for row in db.query(LiveMachineConfig).all():
            configs[row.machine_id] = row
    finally:
        db.close()

    out_machines: List[Dict[str, Any]] = []

    for m in machine_list:
        mid = m["id"]
        cfg = configs.get(mid)
        tz_name = (cfg.shift_timezone if cfg else None) or "Asia/Kuwait"
        try:
            tz = ZoneInfo(tz_name)
        except Exception:
            tz = ZoneInfo("Asia/Kuwait")

        local_today = now.astimezone(tz).date()
        local_yesterday = local_today - timedelta(days=1)
        focus_prev_date = focus_date - timedelta(days=1) if focus_date else None

        min_iv = int(cfg.min_sale_interval_minutes) if cfg and cfg.min_sale_interval_minutes else 10
        max_no_clean_h = float(cfg.max_hours_without_cleaning) if cfg and cfg.max_hours_without_cleaning is not None else None
        max_no_qc_h = float(cfg.max_hours_without_qc) if cfg and cfg.max_hours_without_qc is not None else None
        target = float(cfg.daily_sales_target) if cfg and cfg.daily_sales_target is not None else None

        lv = last_vend_ts.get(mid)
        sale_age_min: Optional[float] = None
        if lv is not None:
            sale_age_min = (to_ts - lv) / 60.0
        no_sale = lv is None or (sale_age_min is not None and sale_age_min > float(min_iv))

        maint_st = maint_by_m.get(mid, "unknown")

        cleaning_alert = False
        if maint_st in ("overdue", "due"):
            cleaning_alert = True
        if max_no_clean_h is not None and cfg and cfg.last_cleaning_at is not None:
            age_h = (now - cfg.last_cleaning_at.replace(tzinfo=cfg.last_cleaning_at.tzinfo or timezone.utc)).total_seconds() / 3600.0
            if age_h > max_no_clean_h:
                cleaning_alert = True
        elif max_no_clean_h is not None and cfg and cfg.last_cleaning_at is None:
            cleaning_alert = True

        qc_alert = False
        if max_no_qc_h is not None and cfg and cfg.last_qc_visit_at is not None:
            age_q = (now - cfg.last_qc_visit_at.replace(tzinfo=cfg.last_qc_visit_at.tzinfo or timezone.utc)).total_seconds() / 3600.0
            if age_q > max_no_qc_h:
                qc_alert = True
        elif max_no_qc_h is not None and cfg and cfg.last_qc_visit_at is None:
            qc_alert = True

        # Sales by local calendar day in machine TZ; optional focusDate compares that day vs previous
        sales_today = 0.0
        sales_yesterday = 0.0
        sales_on_focus_day = 0.0
        sales_on_focus_prev = 0.0
        for v in vends:
            if str(v.get("machine_id") or "") != mid:
                continue
            ts = v.get("timestamp") or v.get("time")
            try:
                ts_i = int(ts)
            except (TypeError, ValueError):
                continue
            local_d = datetime.fromtimestamp(ts_i, tz=tz).date()
            amt_raw = v.get("amount") or v.get("Amount") or 0
            try:
                amt = float(amt_raw)
            except (TypeError, ValueError):
                continue
            if local_d == local_today:
                sales_today += amt
            if local_d == local_yesterday:
                sales_yesterday += amt
            if focus_date is not None:
                if local_d == focus_date:
                    sales_on_focus_day += amt
                elif focus_prev_date is not None and local_d == focus_prev_date:
                    sales_on_focus_prev += amt

        shift_late = False
        clock_in_ts: Optional[int] = None
        hhmm = (cfg.expected_shift_start if cfg else None) or ""
        parsed = _parse_hhmm(hhmm)
        grace = int(cfg.shift_grace_minutes) if cfg and cfg.shift_grace_minutes else 15
        if parsed:
            h, mi = parsed
            start_dt = datetime(
                local_today.year, local_today.month, local_today.day, h, mi, tzinfo=tz
            )
            deadline = start_dt + timedelta(minutes=grace)
            now_local = now.astimezone(tz)
            db2 = _dash_session()
            try:
                row = (
                    db2.query(LiveShiftClockIn)
                    .filter(LiveShiftClockIn.machine_id == mid, LiveShiftClockIn.shift_date == local_today)
                    .first()
                )
                if row and row.clock_in_at:
                    c = row.clock_in_at
                    if c.tzinfo is None:
                        c = c.replace(tzinfo=timezone.utc)
                    clock_in_ts = int(c.timestamp())
                    if c.astimezone(tz) > deadline:
                        shift_late = True
                elif now_local > deadline:
                    shift_late = True
            finally:
                db2.close()

        alerts: List[Dict[str, str]] = []
        if no_sale:
            alerts.append(
                {
                    "level": "critical",
                    "code": "NO_RECENT_SALE",
                    "message": f"No sale within {min_iv} min (or no vends in 7d window)",
                }
            )
        if cleaning_alert:
            alerts.append({"level": "critical", "code": "CLEANING", "message": "Cleaning / maintenance threshold breached"})
        if qc_alert:
            alerts.append({"level": "warning", "code": "QC_VISIT", "message": "Quality control visit overdue"})
        if shift_late:
            alerts.append({"level": "critical", "code": "SHIFT_LATE", "message": "Shift start late or missing clock-in"})

        rank = 10
        if alerts:
            if any(a["level"] == "critical" for a in alerts):
                rank = 0
            else:
                rank = 2
        else:
            rank = 5
        if maint_st == "overdue":
            rank = min(rank, 1)

        row_out: Dict[str, Any] = {
                "machineId": mid,
                "name": m["name"],
                "alerts": alerts,
                "sortRank": rank,
                "lastVendAt": lv,
                "saleAgeMinutes": sale_age_min,
                "lastDoorOpenAt": door_ts.get(mid),
                "maintenanceStatus": maint_st,
                "salesToday": round(sales_today, 4),
                "salesYesterday": round(sales_yesterday, 4),
                "dailyTarget": target,
                "lastCleaningAt": cfg.last_cleaning_at.isoformat() if cfg and cfg.last_cleaning_at else None,
                "lastQcVisitAt": cfg.last_qc_visit_at.isoformat() if cfg and cfg.last_qc_visit_at else None,
                "strikeOperatorEmail": cfg.strike_operator_email if cfg else None,
                "shift": {
                    "expectedStart": hhmm or None,
                    "timezone": tz_name,
                    "graceMinutes": grace,
                    "clockInAt": clock_in_ts,
                    "late": shift_late,
                },
        }
        if focus_date is not None:
            row_out["salesOnFocusDay"] = round(sales_on_focus_day, 4)
            row_out["salesOnFocusPrevDay"] = round(sales_on_focus_prev, 4)
        out_machines.append(row_out)

    out_machines.sort(key=lambda x: (x["sortRank"], x["name"].lower()))

    return {
        "generatedAt": now.isoformat(),
        "focusDate": focus_date.isoformat() if focus_date else None,
        "errors": {"vends": v_err, "doors": d_err, "maintenance": maint_err},
        "machines": out_machines,
    }


def register_live_dashboard_routes(app) -> None:
    @app.route("/api/live-dashboard/snapshot", methods=["GET", "OPTIONS"])
    def live_dashboard_snapshot():
        if request.method == "OPTIONS":
            return "", 204
        err = _require_any_tab(["liveDashboard", "overall"])
        if err[1]:
            return err[1]
        focus_date = _parse_snapshot_focus_date(request.args.get("focusDate"))
        payload = _live_snapshot_payload(focus_date=focus_date)
        if payload.get("error"):
            return jsonify({"error": payload["error"], "machines": payload.get("machines", [])}), 502
        return jsonify(payload)

    @app.route("/api/live-dashboard/gas/snapshot", methods=["POST", "OPTIONS"])
    def live_dashboard_gas_snapshot():
        if request.method == "OPTIONS":
            return "", 204
        body = request.get_json(silent=True) or {}
        denied = _gas_verify_email_tab(body, "liveDashboard")
        if denied:
            return denied
        payload = _live_snapshot_payload()
        if payload.get("error"):
            return jsonify({"error": payload["error"], "machines": payload.get("machines", [])}), 502
        return jsonify(payload)

    @app.route("/api/live-dashboard/config", methods=["GET", "OPTIONS"])
    def live_dashboard_config_list():
        if request.method == "OPTIONS":
            return "", 204
        err = _require_tab("admin")
        if err[1]:
            return err[1]
        db = _dash_session()
        try:
            rows = db.query(LiveMachineConfig).order_by(LiveMachineConfig.machine_id).all()
            items = []
            for r in rows:
                items.append(
                    {
                        "machineId": r.machine_id,
                        "minSaleIntervalMinutes": r.min_sale_interval_minutes,
                        "maxHoursWithoutCleaning": float(r.max_hours_without_cleaning) if r.max_hours_without_cleaning is not None else None,
                        "maxHoursWithoutQc": float(r.max_hours_without_qc) if r.max_hours_without_qc is not None else None,
                        "strikeOperatorEmail": r.strike_operator_email,
                        "dailySalesTarget": float(r.daily_sales_target) if r.daily_sales_target is not None else None,
                        "expectedShiftStart": r.expected_shift_start,
                        "shiftTimezone": r.shift_timezone,
                        "shiftGraceMinutes": r.shift_grace_minutes,
                        "lastCleaningAt": r.last_cleaning_at.isoformat() if r.last_cleaning_at else None,
                        "lastQcVisitAt": r.last_qc_visit_at.isoformat() if r.last_qc_visit_at else None,
                        "redAlertOperatorName": r.red_alert_operator_name,
                        "excludeCleaningTimeoutsPfa": bool(r.exclude_cleaning_timeouts_pfa) if r.exclude_cleaning_timeouts_pfa is not None else False,
                    }
                )
            return jsonify({"items": items})
        finally:
            db.close()

    @app.route("/api/live-dashboard/machine/<machine_id>", methods=["PUT", "OPTIONS"])
    def live_dashboard_machine_put(machine_id: str):
        if request.method == "OPTIONS":
            return "", 204
        err = _require_tab("admin")
        if err[1]:
            return err[1]
        mid = (machine_id or "").strip()
        if not mid:
            return jsonify({"error": "machine_id required"}), 400
        body = request.get_json(silent=True) or {}

        db = _dash_session()
        try:
            row = db.query(LiveMachineConfig).filter(LiveMachineConfig.machine_id == mid).first()
            if not row:
                row = LiveMachineConfig(machine_id=mid)
                db.add(row)
            if "minSaleIntervalMinutes" in body:
                row.min_sale_interval_minutes = int(body["minSaleIntervalMinutes"] or 10)
            if "maxHoursWithoutCleaning" in body:
                row.max_hours_without_cleaning = _decimal_or_none(body.get("maxHoursWithoutCleaning"))
            if "maxHoursWithoutQc" in body:
                row.max_hours_without_qc = _decimal_or_none(body.get("maxHoursWithoutQc"))
            if "strikeOperatorEmail" in body:
                row.strike_operator_email = (body.get("strikeOperatorEmail") or "").strip() or None
            if "dailySalesTarget" in body:
                row.daily_sales_target = _decimal_or_none(body.get("dailySalesTarget"))
            if "expectedShiftStart" in body:
                v = body.get("expectedShiftStart")
                row.expected_shift_start = (str(v).strip() if v else None) or None
            if "shiftTimezone" in body:
                v = body.get("shiftTimezone")
                row.shift_timezone = (str(v).strip() if v else None) or None
            if "shiftGraceMinutes" in body:
                row.shift_grace_minutes = int(body.get("shiftGraceMinutes") or 15)
            if "lastCleaningAt" in body:
                raw = body.get("lastCleaningAt")
                if not raw:
                    row.last_cleaning_at = None
                else:
                    row.last_cleaning_at = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            if "lastQcVisitAt" in body:
                raw = body.get("lastQcVisitAt")
                if not raw:
                    row.last_qc_visit_at = None
                else:
                    row.last_qc_visit_at = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            if "redAlertOperatorName" in body:
                v = body.get("redAlertOperatorName")
                row.red_alert_operator_name = (str(v).strip() if v else None) or None
            if "excludeCleaningTimeoutsPfa" in body:
                row.exclude_cleaning_timeouts_pfa = bool(body.get("excludeCleaningTimeoutsPfa"))
            db.commit()
            return jsonify({"ok": True, "machineId": mid})
        except Exception as ex:
            logger.exception("live_dashboard_machine_put")
            db.rollback()
            return jsonify({"error": str(ex)}), 500
        finally:
            db.close()

    @app.route("/api/live-dashboard/shift-clock-in", methods=["POST", "OPTIONS"])
    def live_shift_clock_in():
        if request.method == "OPTIONS":
            return "", 204
        err = _require_any_tab(["liveDashboard", "operations", "admin"])
        if err[1]:
            return err[1]
        body = request.get_json(silent=True) or {}
        mid = str(body.get("machineId") or body.get("machine_id") or "").strip()
        if not mid:
            return jsonify({"error": "machineId required"}), 400
        email = _require_session_email() or ""
        db = _dash_session()
        try:
            cfg = db.query(LiveMachineConfig).filter(LiveMachineConfig.machine_id == mid).first()
            tz_name = (cfg.shift_timezone if cfg else None) or "Asia/Kuwait"
            try:
                tz = ZoneInfo(tz_name)
            except Exception:
                tz = ZoneInfo("Asia/Kuwait")
            now = datetime.now(timezone.utc)
            local_today = now.astimezone(tz).date()
            raw_ts = body.get("clockInAt") or body.get("clock_in_at")
            if raw_ts:
                clock_in = datetime.fromisoformat(str(raw_ts).replace("Z", "+00:00"))
            else:
                clock_in = now
            existing = (
                db.query(LiveShiftClockIn)
                .filter(LiveShiftClockIn.machine_id == mid, LiveShiftClockIn.shift_date == local_today)
                .first()
            )
            if existing:
                existing.clock_in_at = clock_in
                existing.recorded_by = email
            else:
                db.add(
                    LiveShiftClockIn(
                        machine_id=mid,
                        shift_date=local_today,
                        clock_in_at=clock_in,
                        recorded_by=email,
                    )
                )
            db.commit()
            return jsonify({"ok": True})
        except Exception as ex:
            logger.exception("live_shift_clock_in")
            db.rollback()
            return jsonify({"error": str(ex)}), 500
        finally:
            db.close()

    @app.route("/api/live-dashboard/gas/config", methods=["POST", "OPTIONS"])
    def live_dashboard_gas_config_list():
        if request.method == "OPTIONS":
            return "", 204
        body = request.get_json(silent=True) or {}
        denied = _gas_verify_email_tab(body, "admin")
        if denied:
            return denied
        db = _dash_session()
        try:
            rows = db.query(LiveMachineConfig).order_by(LiveMachineConfig.machine_id).all()
            items = []
            for r in rows:
                items.append(
                    {
                        "machineId": r.machine_id,
                        "minSaleIntervalMinutes": r.min_sale_interval_minutes,
                        "maxHoursWithoutCleaning": float(r.max_hours_without_cleaning) if r.max_hours_without_cleaning is not None else None,
                        "maxHoursWithoutQc": float(r.max_hours_without_qc) if r.max_hours_without_qc is not None else None,
                        "strikeOperatorEmail": r.strike_operator_email,
                        "dailySalesTarget": float(r.daily_sales_target) if r.daily_sales_target is not None else None,
                        "expectedShiftStart": r.expected_shift_start,
                        "shiftTimezone": r.shift_timezone,
                        "shiftGraceMinutes": r.shift_grace_minutes,
                        "lastCleaningAt": r.last_cleaning_at.isoformat() if r.last_cleaning_at else None,
                        "lastQcVisitAt": r.last_qc_visit_at.isoformat() if r.last_qc_visit_at else None,
                        "redAlertOperatorName": r.red_alert_operator_name,
                        "excludeCleaningTimeoutsPfa": bool(r.exclude_cleaning_timeouts_pfa) if r.exclude_cleaning_timeouts_pfa is not None else False,
                    }
                )
            return jsonify({"items": items})
        finally:
            db.close()

    @app.route("/api/live-dashboard/gas/machine/<machine_id>", methods=["POST", "OPTIONS"])
    def live_dashboard_gas_machine_put(machine_id: str):
        if request.method == "OPTIONS":
            return "", 204
        body = request.get_json(silent=True) or {}
        denied = _gas_verify_email_tab(body, "admin")
        if denied:
            return denied
        mid = (machine_id or "").strip()
        if not mid:
            return jsonify({"error": "machine_id required"}), 400
        cfg = {k: v for k, v in body.items() if k != "email"}

        db = _dash_session()
        try:
            row = db.query(LiveMachineConfig).filter(LiveMachineConfig.machine_id == mid).first()
            if not row:
                row = LiveMachineConfig(machine_id=mid)
                db.add(row)
            if "minSaleIntervalMinutes" in cfg:
                row.min_sale_interval_minutes = int(cfg["minSaleIntervalMinutes"] or 10)
            if "maxHoursWithoutCleaning" in cfg:
                row.max_hours_without_cleaning = _decimal_or_none(cfg.get("maxHoursWithoutCleaning"))
            if "maxHoursWithoutQc" in cfg:
                row.max_hours_without_qc = _decimal_or_none(cfg.get("maxHoursWithoutQc"))
            if "strikeOperatorEmail" in cfg:
                row.strike_operator_email = (cfg.get("strikeOperatorEmail") or "").strip() or None
            if "dailySalesTarget" in cfg:
                row.daily_sales_target = _decimal_or_none(cfg.get("dailySalesTarget"))
            if "expectedShiftStart" in cfg:
                v = cfg.get("expectedShiftStart")
                row.expected_shift_start = (str(v).strip() if v else None) or None
            if "shiftTimezone" in cfg:
                v = cfg.get("shiftTimezone")
                row.shift_timezone = (str(v).strip() if v else None) or None
            if "shiftGraceMinutes" in cfg:
                row.shift_grace_minutes = int(cfg.get("shiftGraceMinutes") or 15)
            if "lastCleaningAt" in cfg:
                raw = cfg.get("lastCleaningAt")
                if not raw:
                    row.last_cleaning_at = None
                else:
                    row.last_cleaning_at = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            if "lastQcVisitAt" in cfg:
                raw = cfg.get("lastQcVisitAt")
                if not raw:
                    row.last_qc_visit_at = None
                else:
                    row.last_qc_visit_at = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            if "redAlertOperatorName" in cfg:
                v = cfg.get("redAlertOperatorName")
                row.red_alert_operator_name = (str(v).strip() if v else None) or None
            if "excludeCleaningTimeoutsPfa" in cfg:
                row.exclude_cleaning_timeouts_pfa = bool(cfg.get("excludeCleaningTimeoutsPfa"))
            db.commit()
            return jsonify({"ok": True, "machineId": mid})
        except Exception as ex:
            logger.exception("live_dashboard_gas_machine_put")
            db.rollback()
            return jsonify({"error": str(ex)}), 500
        finally:
            db.close()

    @app.route("/api/live-dashboard/gas/shift-clock-in", methods=["POST", "OPTIONS"])
    def live_dashboard_gas_shift_clock_in():
        if request.method == "OPTIONS":
            return "", 204
        body = request.get_json(silent=True) or {}
        denied = _gas_verify_email_any_tab(body, ["liveDashboard", "operations", "admin"])
        if denied:
            return denied
        mid = str(body.get("machineId") or body.get("machine_id") or "").strip()
        if not mid:
            return jsonify({"error": "machineId required"}), 400
        recorder = (body.get("email") or "").strip().lower()
        db = _dash_session()
        try:
            cfg = db.query(LiveMachineConfig).filter(LiveMachineConfig.machine_id == mid).first()
            tz_name = (cfg.shift_timezone if cfg else None) or "Asia/Kuwait"
            try:
                tz = ZoneInfo(tz_name)
            except Exception:
                tz = ZoneInfo("Asia/Kuwait")
            now = datetime.now(timezone.utc)
            local_today = now.astimezone(tz).date()
            raw_ts = body.get("clockInAt") or body.get("clock_in_at")
            if raw_ts:
                clock_in = datetime.fromisoformat(str(raw_ts).replace("Z", "+00:00"))
            else:
                clock_in = now
            existing = (
                db.query(LiveShiftClockIn)
                .filter(LiveShiftClockIn.machine_id == mid, LiveShiftClockIn.shift_date == local_today)
                .first()
            )
            if existing:
                existing.clock_in_at = clock_in
                existing.recorded_by = recorder
            else:
                db.add(
                    LiveShiftClockIn(
                        machine_id=mid,
                        shift_date=local_today,
                        clock_in_at=clock_in,
                        recorded_by=recorder,
                    )
                )
            db.commit()
            return jsonify({"ok": True})
        except Exception as ex:
            logger.exception("live_dashboard_gas_shift_clock_in")
            db.rollback()
            return jsonify({"error": str(ex)}), 500
        finally:
            db.close()
