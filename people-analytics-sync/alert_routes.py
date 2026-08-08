from __future__ import annotations

import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta, time as dt_time, date
from zoneinfo import ZoneInfo
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import urlencode

import requests
from flask import jsonify, request, session as flask_session
from sqlalchemy.orm import Session

from dashboard_access_models import (
    AlertMachineProfile,
    AlertDailySalesElapsedCache,
    AlertUserUiPrefs,
    LiveMachineConfig,
    MachineCleaningSchedule,
    QaManualSummary,
    RedAlertSnapshotCache,
    create_dashboard_engine_and_session,
)
from dashboard_access_routes import resolve_session_allowed_tabs, _check_secret
from vendon_machine_helpers import (
    machine_row_excluded,
    vendon_fetch_machine_list,
    vendon_json_api_error_message,
    vendon_machine_tag_for_alert_admin_detail,
)
from vendon_proxy_routes import (
    compute_remote_credits_logs_classic,
    compute_vends_resolved_for_machine,
    _fetch_vends_stats_window,
    _refresh_revenue_cache_single_day,
)
from red_alert_routes import compute_daily_incidents_elapsed
from models import PeopleAnalyticsRecord, VendonDailyMachineRevenueCache, create_engine_and_session
from sqlalchemy import func, text
from alert_downtime_lib import compute_machine_downtime_summary

logger = logging.getLogger(__name__)

LOCATION_OWNER_CANONICAL = ("MOH", "KU", "O2", "Others")


def _decimal_or_none(v: Any) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _normalize_staff_visit_schedule(raw: Any) -> List[Dict[str, Any]]:
    """Technician / QA schedule rows from Admin Machines (name + optional Vendon id + days + windows)."""
    if not isinstance(raw, list):
        return []
    out: List[Dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = str(
            item.get("name")
            or item.get("person")
            or item.get("technician")
            or item.get("officer")
            or ""
        ).strip()
        uid = str(item.get("vendon_user_id") or item.get("vendonUserId") or "").strip() or None
        days: List[int] = []
        for d in item.get("days") or item.get("visit_days") or item.get("weekdays") or []:
            try:
                n = int(d)
            except (TypeError, ValueError):
                continue
            if 0 <= n <= 6 and n not in days:
                days.append(n)
        days.sort()
        windows: List[Dict[str, str]] = []
        raw_wins = item.get("windows")
        if isinstance(raw_wins, list):
            for w in raw_wins:
                if not isinstance(w, dict):
                    continue
                start = str(w.get("start") or "").strip()
                end = str(w.get("end") or "").strip()
                if start and end:
                    windows.append({"start": start, "end": end})
        if not name and not uid and not days and not windows:
            continue
        out.append(
            {
                "name": name,
                "vendon_user_id": uid,
                "days": days,
                "windows": windows,
            }
        )
    return out


def _normalize_operator_hours(raw: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: List[Dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        uid = str(item.get("vendon_user_id") or item.get("vendonUserId") or "").strip() or None
        windows: List[Dict[str, str]] = []
        raw_wins = item.get("windows")
        if isinstance(raw_wins, list):
            for w in raw_wins:
                if not isinstance(w, dict):
                    continue
                start = str(w.get("start") or "").strip()
                end = str(w.get("end") or "").strip()
                if start and end:
                    windows.append({"start": start, "end": end})
        if not name and not uid and not windows:
            continue
        out.append({"name": name, "vendon_user_id": uid, "windows": windows})
    return out

VENDON_API_BASE = (os.environ.get("VENDON_API_BASE") or "").strip().rstrip("/")
VENDON_API_KEY = (os.environ.get("VENDON_API_KEY") or "").strip()

# monitoring-app-v1 waste-tab.js: motion area-overrides + Vendon /stats/vends (same formula).
MOTION_AREA_OVERRIDES_URL = (
    os.environ.get("MOTION_AREA_OVERRIDES_URL") or "https://motion.theleetclub.com/api/area-overrides"
).strip().rstrip("/")
MOTION_AREA_OVERRIDES_API_KEY = (os.environ.get("MOTION_AREA_OVERRIDES_API_KEY") or "").strip()

_dash_session_factory = None
_pa_session_factory = None

# Short TTL caches so Alert boards do not stampede the single gunicorn worker.
_ALERT_ROUTE_CACHE: Dict[str, Tuple[float, Any]] = {}
_ALERT_REMOTE_CREDITS_CACHE_SEC = int(os.environ.get("ALERT_REMOTE_CREDITS_CACHE_SEC", "90"))
_ALERT_REMOTE_CREDITS_MAX_VENDS_RESOLVE = int(os.environ.get("ALERT_REMOTE_CREDITS_MAX_VENDS_RESOLVE", "12"))
_ALERT_REMOTE_CREDITS_MAX_WORKERS = int(os.environ.get("ALERT_REMOTE_CREDITS_MAX_WORKERS", "4"))
_DAILY_SALES_ELAPSED_CACHE_SEC = int(os.environ.get("ALERT_DAILY_SALES_ELAPSED_CACHE_SEC", "60"))
_DAILY_SALES_DB_STALE_SEC = int(os.environ.get("ALERT_DAILY_SALES_DB_STALE_SEC", "55"))
_DAILY_SALES_ELAPSED_HISTORY_DAYS = int(os.environ.get("ALERT_DAILY_SALES_ELAPSED_HISTORY_DAYS", "8"))
_DAILY_INCIDENTS_ELAPSED_CACHE_SEC = int(os.environ.get("ALERT_DAILY_INCIDENTS_ELAPSED_CACHE_SEC", "120"))
_ALERT_REVENUE_CACHE_SEED_TTL_SEC = int(os.environ.get("ALERT_REVENUE_CACHE_SEED_TTL_SEC", "900"))
_ALERT_DOWNTIME_CACHE_SEC = int(os.environ.get("ALERT_DOWNTIME_CACHE_SEC", "120"))


def _vendon_revenue_cache_has_day(db: Session, day: date) -> bool:
    return (
        db.query(VendonDailyMachineRevenueCache.id)
        .filter(VendonDailyMachineRevenueCache.cache_date == day)
        .limit(1)
        .first()
        is not None
    )


def _maybe_seed_vendon_revenue_cache(day: date) -> None:
    """Queue background warm of vendon_daily_machine_revenue_cache (never blocks the HTTP request)."""
    throttle_key = f"revenue_seed:{day.isoformat()}"
    cached = _alert_cache_get(throttle_key, _ALERT_REVENUE_CACHE_SEED_TTL_SEC)
    if cached is not None:
        return
    db = _pa_session()
    try:
        if _vendon_revenue_cache_has_day(db, day):
            _alert_cache_set(throttle_key, {"ok": True, "skipped": "exists"})
            return
    finally:
        db.close()

    _alert_cache_set(throttle_key, {"ok": False, "inFlight": True})

    def _run_seed() -> None:
        try:
            res = _refresh_revenue_cache_single_day(day.isoformat())
            _alert_cache_set(throttle_key, res)
            if not res.get("ok"):
                logger.warning("vendon revenue cache seed failed for %s: %s", day.isoformat(), res.get("error"))
        except Exception:
            logger.exception("vendon revenue cache seed error for %s", day.isoformat())

    import threading

    threading.Thread(target=_run_seed, daemon=True).start()


def _ensure_alert_ops_cache_tables(db: Session) -> None:
    db.execute(
        text(
            """
        CREATE TABLE IF NOT EXISTS alert_workflow_attendance_cache (
          id INTEGER PRIMARY KEY,
          payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          generated_at TIMESTAMPTZ,
          compute_error TEXT
        );
        INSERT INTO alert_workflow_attendance_cache (id, payload_json)
        VALUES (1, '{}'::jsonb) ON CONFLICT (id) DO NOTHING;
        CREATE TABLE IF NOT EXISTS alert_daily_sales_elapsed_cache (
          id INTEGER PRIMARY KEY,
          payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          cache_bucket TEXT,
          generated_at TIMESTAMPTZ,
          compute_error TEXT
        );
        INSERT INTO alert_daily_sales_elapsed_cache (id, payload_json)
        VALUES (1, '{}'::jsonb) ON CONFLICT (id) DO NOTHING;
    """
        )
    )


def _load_daily_sales_elapsed_db_cache() -> Optional[Dict[str, Any]]:
    db = _dash_session()
    try:
        _ensure_alert_ops_cache_tables(db)
        db.commit()
        row = db.query(AlertDailySalesElapsedCache).filter(AlertDailySalesElapsedCache.id == 1).first()
        if not row or not isinstance(row.payload_json, dict) or not row.payload_json.get("byMachineId"):
            return None
        payload = dict(row.payload_json)
        if row.generated_at:
            payload["cacheGeneratedAt"] = row.generated_at.isoformat()
        payload["fromCache"] = True
        if row.cache_bucket:
            payload["cacheBucket"] = row.cache_bucket
        return payload
    finally:
        db.close()


def _save_daily_sales_elapsed_db_cache(payload: Optional[Dict[str, Any]], err: Optional[str], cache_bucket: str) -> None:
    db = _dash_session()
    try:
        _ensure_alert_ops_cache_tables(db)
        db.commit()
        row = db.query(AlertDailySalesElapsedCache).filter(AlertDailySalesElapsedCache.id == 1).first()
        if not row:
            row = AlertDailySalesElapsedCache(id=1, payload_json={})
            db.add(row)
        if err:
            row.compute_error = err
            db.commit()
            return
        row.payload_json = payload or {}
        row.cache_bucket = cache_bucket
        row.generated_at = datetime.now(timezone.utc)
        row.compute_error = None
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _daily_sales_cache_is_stale(payload: Dict[str, Any], cache_bucket: str) -> bool:
    if payload.get("cacheBucket") != cache_bucket:
        return True
    gen = payload.get("cacheGeneratedAt")
    if not gen:
        return True
    try:
        ts = datetime.fromisoformat(str(gen).replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        age = (datetime.now(timezone.utc) - ts).total_seconds()
        return age > _DAILY_SALES_DB_STALE_SEC
    except Exception:
        return True


def _kuwait_elapsed_window_end(day: date, now_local: datetime) -> datetime:
    tz = now_local.tzinfo
    if day == now_local.date():
        return now_local
    return datetime.combine(day, now_local.time(), tzinfo=tz)


def _alert_cache_get(key: str, ttl_sec: int) -> Optional[Any]:
    ent = _ALERT_ROUTE_CACHE.get(key)
    if not ent:
        return None
    ts, val = ent
    if time.monotonic() - ts > ttl_sec:
        return None
    return val


def _alert_cache_set(key: str, val: Any) -> None:
    _ALERT_ROUTE_CACHE[key] = (time.monotonic(), val)


def _dash_session() -> Session:
    global _dash_session_factory
    if _dash_session_factory is None:
        _, _dash_session_factory = create_dashboard_engine_and_session()
    return _dash_session_factory()


def _pa_session() -> Session:
    global _pa_session_factory
    if _pa_session_factory is None:
        _, _pa_session_factory = create_engine_and_session()
    return _pa_session_factory()


def _require_session_email() -> Optional[str]:
    return (flask_session.get("email") or "").strip().lower() or None


def _can_alert_read(allowed: list, matched_by: str) -> bool:
    """Red Flags / Overall — same operators as classic Red Alert may use `redAlert` only."""
    if matched_by == "super_admin":
        return True
    if "*" in allowed:
        return True
    return "leetAlert" in allowed or "redAlert" in allowed


def _can_alert_admin(allowed: list, matched_by: str) -> bool:
    """Alert Admin (cleaning schedules, etc.) — explicit `leetAlertAdmin` or break-glass super-admin."""
    if matched_by == "super_admin":
        return True
    if "*" in allowed:
        return True
    return "leetAlertAdmin" in allowed


def _require_alert_read() -> Tuple[Optional[str], Optional[Any]]:
    email, allowed, matched_by = resolve_session_allowed_tabs()
    if not email:
        return None, (jsonify({"error": "Unauthorized"}), 401)
    if not _can_alert_read(allowed, matched_by):
        return None, (jsonify({"error": "Forbidden", "need": ["leetAlert", "redAlert"]}), 403)
    return email, None


def _require_alert_admin() -> Tuple[Optional[str], Optional[Any]]:
    email, allowed, matched_by = resolve_session_allowed_tabs()
    if not email:
        return None, (jsonify({"error": "Unauthorized"}), 401)
    if not _can_alert_admin(allowed, matched_by):
        return None, (jsonify({"error": "Forbidden", "need": ["leetAlertAdmin"]}), 403)
    return email, None


def _vendon_headers() -> Dict[str, str]:
    return {"Authorization": f"Token {VENDON_API_KEY}"}


def _sync_machine_cleaning_schedule(
    db: Session,
    *,
    machine_id: str,
    machine_name: str,
    cleaning_windows: Any,
    operator_hours: Any,
    timezone_s: str,
    priority: int,
) -> None:
    """Upsert machine_cleaning_schedule row using exact machine name as pattern (Red Alert matcher)."""
    pattern = (machine_name or machine_id or "").strip()
    if not pattern:
        return
    windows = cleaning_windows if cleaning_windows is not None else []
    op = "Operator"
    if isinstance(operator_hours, list) and operator_hours:
        first = operator_hours[0]
        if isinstance(first, dict):
            name = (first.get("name") or "").strip()
            if name:
                op = name
    now = datetime.now(timezone.utc)
    row = db.query(MachineCleaningSchedule).filter(MachineCleaningSchedule.name_pattern == pattern).first()
    if row:
        row.cleaning_operator = op
        row.timezone = timezone_s or "Asia/Kuwait"
        row.windows = windows
        row.priority = priority
        row.updated_at = now
    else:
        db.add(
            MachineCleaningSchedule(
                name_pattern=pattern,
                cleaning_operator=op,
                timezone=timezone_s or "Asia/Kuwait",
                windows=windows,
                priority=priority,
                updated_at=now,
            )
        )


def _vendon_get(path: str, params: Optional[Dict[str, Any]] = None) -> Tuple[Optional[Dict], Optional[str]]:
    if not VENDON_API_KEY:
        return None, "VENDON_API_KEY not configured on server"
    if not VENDON_API_BASE:
        return None, "VENDON_API_BASE not configured on server"
    url = f"{VENDON_API_BASE}{path}"
    if params:
        url = f"{url}?{urlencode({k: v for k, v in params.items() if v is not None})}"
    try:
        r = requests.get(url, headers=_vendon_headers(), timeout=45)
        if r.status_code != 200:
            return None, f"Vendon API error {r.status_code}: {r.text[:500]}"
        data = r.json()
        if isinstance(data, dict):
            api_err = vendon_json_api_error_message(data)
            if api_err:
                return None, api_err
        return data, None
    except Exception as ex:
        logger.exception("alert vendon_get")
        return None, str(ex)


def _kuwait_date_today_iso() -> str:
    return datetime.now(ZoneInfo("Asia/Kuwait")).date().isoformat()


def _kuwait_day_bounds_utc(date_str: str) -> Tuple[int, int]:
    tz = ZoneInfo("Asia/Kuwait")
    d = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=tz)
    start_loc = d.replace(hour=0, minute=0, second=0, microsecond=0)
    end_loc = d.replace(hour=23, minute=59, second=59, microsecond=0)
    return int(start_loc.astimezone(timezone.utc).timestamp()), int(end_loc.astimezone(timezone.utc).timestamp())


def _fetch_motion_area_overrides(machine_id: str, date_str: str) -> Tuple[Optional[List[Dict[str, Any]]], Optional[str]]:
    """Same upstream as monitoring-app-v1/waste-tab.js area-overrides."""
    if not MOTION_AREA_OVERRIDES_API_KEY:
        return None, "MOTION_AREA_OVERRIDES_API_KEY not configured"
    url = f"{MOTION_AREA_OVERRIDES_URL}?{urlencode({'date': date_str, 'machine_id': machine_id})}"
    try:
        r = requests.get(
            url,
            headers={
                "Accept": "application/json",
                "X-API-KEY": MOTION_AREA_OVERRIDES_API_KEY,
            },
            timeout=45,
        )
        if r.status_code != 200:
            return None, f"motion HTTP {r.status_code}: {r.text[:300]}"
        data = r.json()
        if not isinstance(data, dict):
            return None, "motion: non-object JSON"
        inner = data.get("data")
        if inner is None:
            inner = []
        if not isinstance(inner, list):
            return None, "motion: data not a list"
        return inner, None
    except Exception as ex:
        logger.exception("motion area_overrides")
        return None, str(ex)


def _fetch_vends_machine_day(machine_id: str, from_ts: int, to_ts: int) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    out: List[Dict[str, Any]] = []
    off = 0
    page_limit = 500
    while len(out) < 25000:
        params: Dict[str, Any] = {
            "from_timestamp": from_ts,
            "to_timestamp": to_ts,
            "limit": page_limit,
            "offset": off,
            "machine_id": machine_id,
        }
        data, err = _vendon_get("/stats/vends", params)
        if err:
            return [], err
        chunk = data.get("result") if isinstance(data, dict) else None
        chunk = chunk if isinstance(chunk, list) else []
        out.extend(chunk)
        if len(chunk) < page_limit:
            break
        off += page_limit
    return out[:25000], None


def _fetch_all_vends(from_ts: int, to_ts: int, *, max_rows: int = 12000) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """Paginated /stats/vends for fleet-wide windows (Alert Overall same-elapsed sales)."""
    rows: List[Dict[str, Any]] = []
    off = 0
    page_limit = 500
    while off < 50000 and len(rows) < max_rows:
        params: Dict[str, Any] = {
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
    return rows[:max_rows], None


def _vend_amount_kwd(v: Dict[str, Any]) -> float:
    amt_raw = v.get("price") or v.get("amount") or v.get("Amount") or 0
    try:
        return float(amt_raw)
    except (TypeError, ValueError):
        return 0.0


def _vend_ts(v: Dict[str, Any]) -> int:
    ts_raw = v.get("datetime") or v.get("timestamp") or v.get("time") or 0
    try:
        return int(ts_raw) if ts_raw is not None else 0
    except (TypeError, ValueError):
        return 0


def _waste_metrics_v1(machine_id: str, date_str: str) -> Tuple[Optional[float], Optional[str], Dict[str, Any]]:
    """
    Port of monitoring-app-v1 calculateWaste / location aggregate (wastePercent formula).
    wastePercent = totalWaste / (totalSales + totalWaste) * 100 when denominator > 0.

    Units: totalWaste / totalSales are cup/unit counts (stock available − sold), not KD.
    Meta also returns avgVendKwd + estimatedWasteKwd (cups × avg sold vend price) for Alert.
    """
    overrides, oerr = _fetch_motion_area_overrides(machine_id, date_str)
    if oerr:
        return None, oerr, {}
    if not overrides:
        return None, None, {"note": "no_refill_data"}

    from_ts, to_ts = _kuwait_day_bounds_utc(date_str)
    vends, verr = _fetch_vends_machine_day(machine_id, from_ts, to_ts)
    if verr:
        return None, verr, {}

    sales_by_stock: Dict[str, int] = {}
    vend_amounts: List[float] = []
    for sale in vends:
        if not isinstance(sale, dict):
            continue
        sid = sale.get("stock_id")
        if sid is None:
            continue
        k = str(sid)
        sales_by_stock[k] = sales_by_stock.get(k, 0) + 1
        amt = _vend_amount_kwd(sale)
        if amt > 0:
            vend_amounts.append(amt)

    total_waste = 0
    total_sales = 0
    for ov in overrides:
        if not isinstance(ov, dict):
            continue
        sid = ov.get("stock_id")
        if sid is None:
            continue
        k = str(sid)
        try:
            orig = int(ov.get("original_quantity") or 0)
            upd = int(ov.get("updated_quantity") or 0)
        except (TypeError, ValueError):
            orig, upd = 0, 0
        refill_added = upd - orig
        total_available = orig + refill_added
        sales = sales_by_stock.get(k, 0)
        waste = total_available - sales
        total_waste += waste
        total_sales += sales

    avg_vend = round(sum(vend_amounts) / len(vend_amounts), 4) if vend_amounts else None
    waste_cups = max(0, int(total_waste))
    # Fallback ticket when there are waste cups but no priced vends today (same default as downtime lib).
    ticket = avg_vend if avg_vend is not None and avg_vend > 0 else (0.30 if waste_cups > 0 else None)
    estimated_waste_kwd = (
        round(float(waste_cups) * float(ticket), 3) if ticket is not None and waste_cups > 0 else 0.0
    )

    meta: Dict[str, Any] = {
        "totalWaste": total_waste,
        "totalSales": total_sales,
        "wasteCups": waste_cups,
        "avgVendKwd": ticket,
        "estimatedWasteKwd": estimated_waste_kwd,
        "source": "motion_area_overrides+vendon_vends",
    }

    denom = total_sales + total_waste
    if denom <= 0:
        return 0.0, None, meta
    pct = (float(total_waste) / float(denom)) * 100.0
    return pct, None, meta


# ---------------------------------------------------------------------------
# Overall — People Count (Monitor v1 / index.html ``peopleCameraToMachineMap``
# resolution + Videoloft device list → DB ``people_analytics_records``, same dates as ``/api/people-analytics``).
# ---------------------------------------------------------------------------

_DEFAULT_ALERT_PEOPLE_CAMERA_MAP: Dict[str, Any] = {
    "375535": {"cameraId": None, "cameraNames": ["Jaber Hospital - Gate 2"]},
    "413319": {"cameraId": None, "cameraNames": ["Mubarak hospital", "Mubarak hospital bar"]},
    "375498": {"cameraId": None, "cameraNames": ["Oxygen Riggai"]},
    "385017": {"cameraId": None, "cameraNames": ["Jahra Parking", "Jahra Parking 2"]},
}


def _deep_merge_alert_people_maps(base: Dict[str, Any], overlay: Dict[str, Any]) -> Dict[str, Any]:
    """Shallow-merge top-level keys; per-machine dicts merged so partial overrides keep defaults."""
    out = dict(base)
    for mid, oval in overlay.items():
        mid_s = str(mid).strip()
        if not mid_s:
            continue
        b = out.get(mid_s)
        if isinstance(b, dict) and isinstance(oval, dict):
            merged = dict(b)
            merged.update(oval)
            out[mid_s] = merged
        else:
            out[mid_s] = oval
    return out


def _load_alert_people_camera_map() -> Dict[str, Any]:
    m: Dict[str, Any] = dict(_DEFAULT_ALERT_PEOPLE_CAMERA_MAP)
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "alert_people_camera_map.json")
    try:
        if os.path.isfile(path):
            with open(path, encoding="utf-8") as f:
                raw = json.load(f)
            if isinstance(raw, dict):
                m = _deep_merge_alert_people_maps(m, raw)
    except Exception as ex:
        logger.warning("alert_people_camera_map.json: %s", ex)
    env_raw = (os.environ.get("ALERT_PEOPLE_CAMERA_MAP_JSON") or "").strip()
    if env_raw:
        try:
            parsed = json.loads(env_raw)
            if isinstance(parsed, dict):
                m = _deep_merge_alert_people_maps(m, parsed)
        except json.JSONDecodeError as ex:
            logger.warning("ALERT_PEOPLE_CAMERA_MAP_JSON invalid: %s", ex)
    return m


_videoloft_camera_cache_at: float = 0.0
_videoloft_camera_cache: List[Dict[str, Any]] = []

_VIDEOLOFT_CAMERA_CACHE_SEC = float(os.environ.get("ALERT_VIDEOLOFT_CAMERA_CACHE_SEC", "86400"))


def _get_videoloft_cameras_cached() -> List[Dict[str, Any]]:
    """Optional Videoloft device list — same envelope as Monitor v1 / ``sync_service.VideoloftClient``."""
    global _videoloft_camera_cache_at, _videoloft_camera_cache
    now = time.time()
    if _videoloft_camera_cache and (now - _videoloft_camera_cache_at) < _VIDEOLOFT_CAMERA_CACHE_SEC:
        return list(_videoloft_camera_cache)
    try:
        from sync_service import VideoloftClient

        cli = VideoloftClient()
        if not cli.authenticate():
            return list(_videoloft_camera_cache)
        cams = cli.get_cameras()
        _videoloft_camera_cache = cams or []
        _videoloft_camera_cache_at = now
        return list(_videoloft_camera_cache)
    except ValueError:
        logger.info("Videoloft credentials not configured; people footfall resolves from static map IDs only.")
    except Exception as ex:
        logger.warning("Videoloft camera list failed: %s", ex)
    return list(_videoloft_camera_cache)


def _normalize_fuzzy_fragment(s: str) -> str:
    if not s:
        return ""
    return " ".join("".join(c.lower() if c.isalnum() else " " for c in str(s)).split())


def _uidds_from_mapping_entry(cameras: List[Dict[str, Any]], mapping_val: Any) -> List[str]:
    """
    Mirrors index.html people tab: if ``cameraId`` is set, use only that uidd; else match
    ``cameraNames`` fragments against Videoloft ``phonename`` / ``alias`` (substring).
    """
    out: List[str] = []
    if not isinstance(mapping_val, dict) or not cameras:
        return out
    cid = mapping_val.get("cameraId")
    if cid is not None and str(cid).strip():
        return [str(cid).strip()]

    names: List[str] = []
    if isinstance(mapping_val.get("cameraNames"), list):
        for n in mapping_val["cameraNames"]:
            if n is None:
                continue
            frag = str(n).strip()
            if frag:
                names.append(frag)
    legacy_cn = mapping_val.get("cameraName")
    if legacy_cn is not None and str(legacy_cn).strip():
        names.append(str(legacy_cn).strip())

    for cam in cameras:
        cid_s = cam.get("id")
        if not cid_s:
            continue
        cname = str(cam.get("name") or "")
        calias = str(cam.get("alias") or "")
        for frag in names:
            fl = frag.lower()
            if fl and (fl in cname.lower() or fl in calias.lower()):
                if str(cid_s) not in out:
                    out.append(str(cid_s))
                break
    return list(dict.fromkeys(out))


def _fuzzy_machine_name_uidds(machine_name: str, cameras: List[Dict[str, Any]]) -> List[str]:
    """Opt-in substring-style match (monitoring-app fuzzy) — off unless ``ALERT_PEOPLE_FUZZY_MATCH=true``."""
    flag = (os.environ.get("ALERT_PEOPLE_FUZZY_MATCH") or "").strip().lower()
    if flag not in ("1", "true", "yes") or not machine_name.strip() or not cameras:
        return []
    mn = _normalize_fuzzy_fragment(machine_name)
    if len(mn) < 6:
        return []
    picks: List[str] = []
    for cam in cameras:
        cid = cam.get("id")
        nm = _normalize_fuzzy_fragment(str(cam.get("name") or ""))
        if not cid or not nm:
            continue
        if mn in nm or nm in mn:
            picks.append(str(cid))
        else:
            mw = mn.split()
            nw = nm.split()
            if len(mw) >= 2 and len(nw) >= 2 and mw[0] == nw[0] and mw[1] == nw[1]:
                picks.append(str(cid))
    return list(dict.fromkeys(picks))


def _resolve_machine_people_uidds(
    machine_id: str, machine_name: str, cmap: Dict[str, Any], cameras: List[Dict[str, Any]]
) -> Tuple[List[str], str]:
    raw = cmap.get(machine_id)
    if isinstance(raw, dict):
        uids = _uidds_from_mapping_entry(cameras, raw)
        if uids:
            return uids, "map"
        cid_only = raw.get("cameraId")
        if cid_only is not None and str(cid_only).strip():
            return [str(cid_only).strip()], "map_explicit"
        return [], "no_uidd_for_map"

    uids_f = _fuzzy_machine_name_uidds(machine_name, cameras)
    if uids_f:
        return uids_f, "fuzzy"
    return [], "no_mapping"


def _local_calendar_day_bounds_utc_naive(day_iso: str, tz_name: str) -> Tuple[datetime, datetime]:
    tz = ZoneInfo(tz_name)
    start_local = datetime.strptime(day_iso, "%Y-%m-%d").replace(tzinfo=tz)
    end_local = datetime.strptime(day_iso, "%Y-%m-%d").replace(hour=23, minute=59, second=59, microsecond=0, tzinfo=tz)
    return (
        start_local.astimezone(ZoneInfo("UTC")).replace(tzinfo=None),
        end_local.astimezone(ZoneInfo("UTC")).replace(tzinfo=None),
    )


def _sum_people_in_by_uidd_day(
    pa_session, uidd_set: frozenset, day_iso: str, tz_name: str
) -> Dict[str, int]:
    """
    Per-uidd summed ``people_in`` for a Kuwait calendar day.

    Live cron stores **hour** buckets; legacy backfill may have **date** rows.
    Prefer hourly sums when present so today/yesterday match Videoloft; otherwise use daily rows.
    """
    if not uidd_set:
        return {}
    start_naive_utc, end_naive_utc = _local_calendar_day_bounds_utc_naive(day_iso, tz_name)
    uid_list = list(uidd_set)

    def _sum_for_interval(interval_type: str) -> Dict[str, int]:
        rows = (
            pa_session.query(PeopleAnalyticsRecord.uidd, func.sum(PeopleAnalyticsRecord.people_in))
            .filter(PeopleAnalyticsRecord.interval_type == interval_type)
            .filter(PeopleAnalyticsRecord.uidd.in_(uid_list))
            .filter(PeopleAnalyticsRecord.first_timestamp >= start_naive_utc)
            .filter(PeopleAnalyticsRecord.first_timestamp <= end_naive_utc)
            .group_by(PeopleAnalyticsRecord.uidd)
            .all()
        )
        return {str(r[0]): int(r[1] or 0) for r in rows}

    hour_map = _sum_for_interval("hour")
    date_map = _sum_for_interval("date")
    out: Dict[str, int] = {}
    for u in uid_list:
        h = hour_map.get(u, 0)
        if h > 0:
            out[u] = h
        else:
            out[u] = date_map.get(u, 0)
    return out


def _classic_remote_credits_by_machine(day_iso: str) -> Dict[str, Dict[str, int]]:
    """Fleet-wide credits + drink tests for a Kuwait day (cached — expensive Vendon scan)."""
    key = f"rc-classic:{day_iso}"
    hit = _alert_cache_get(key, max(_ALERT_REMOTE_CREDITS_CACHE_SEC, 120))
    if isinstance(hit, dict):
        return hit
    out = compute_remote_credits_logs_classic(day_iso, day_iso, "")
    totals = out.get("totals") if isinstance(out, dict) else None
    totals = totals if isinstance(totals, list) else []
    by_machine: Dict[str, Dict[str, int]] = {}
    for t in totals:
        if not isinstance(t, dict):
            continue
        mid = str(t.get("machine_id") or "").strip()
        if not mid:
            continue
        by_machine[mid] = {
            "credits_sent": int(t.get("count") or 0),
            "dispense_tests": int(t.get("drink_tests_count") or 0),
        }
    _alert_cache_set(key, by_machine)
    return by_machine


def _alert_allowed_machine_ids() -> Tuple[set[str], Optional[str]]:
    """Active Vendon machines shown in Alert (excludes test/hidden rows)."""
    rows, err = vendon_fetch_machine_list(_vendon_get)
    if err:
        return set(), err
    allowed: set[str] = set()
    for m in rows or []:
        if m.get("id") is None:
            continue
        mid = str(m.get("id")).strip()
        mname = m.get("name") or mid
        if not mid or machine_row_excluded(mname, mid):
            continue
        allowed.add(mid)
    if not allowed:
        return set(), "No fleet machines after exclusions"
    return allowed, None


def _vend_machine_id(v: Dict[str, Any]) -> str:
    mid_raw = v.get("machine_id")
    if mid_raw is None:
        mid_raw = v.get("machine")
    if mid_raw is None:
        return ""
    return str(mid_raw).strip()


def _vend_row_dedupe_key(v: Dict[str, Any]) -> str:
    for k in ("id", "vend_id", "transaction_id", "sale_id"):
        raw = v.get(k)
        if raw is not None and str(raw).strip():
            return f"{k}:{raw}"
    ts_i = _vend_ts(v)
    mid = _vend_machine_id(v)
    amt = _vend_amount_kwd(v)
    return f"ts:{ts_i}:{mid}:{amt}"


def _machine_window_sales_kwd(mid: str, ws: int, we: int) -> Tuple[float, bool]:
    """Per-machine /stats/vends — Kuwait elapsed window [ws, we], deduped rows."""
    vends, err = _fetch_vends_stats_window(ws, we, mid, max_rows=25000)
    if err:
        raise RuntimeError(f"machine {mid}: {err}")
    truncated = len(vends) >= 25000
    total = 0.0
    seen: set[str] = set()
    for v in vends:
        if not isinstance(v, dict):
            continue
        ts_i = _vend_ts(v)
        if ts_i <= 0 or ts_i < ws or ts_i > we:
            continue
        amt = _vend_amount_kwd(v)
        if amt <= 0:
            continue
        key = _vend_row_dedupe_key(v)
        if key in seen:
            continue
        seen.add(key)
        total += amt
    return total, truncated


def _refresh_daily_sales_elapsed_cache_internal(
    now_local: Optional[datetime] = None,
) -> Tuple[Dict[str, Any], Optional[Any]]:
    tz = ZoneInfo("Asia/Kuwait")
    now_local = now_local or datetime.now(tz)
    cache_bucket = now_local.replace(second=0, microsecond=0).isoformat()
    allowed_ids, allow_err = _alert_allowed_machine_ids()
    if allow_err:
        err_body = {
            "error": allow_err,
            "timezone": "Asia/Kuwait",
            "today": now_local.date().isoformat(),
            "asOfLocal": now_local.isoformat(),
            "byMachineId": {},
        }
        _save_daily_sales_elapsed_db_cache(None, allow_err, cache_bucket)
        return {}, (jsonify(err_body), 502)
    allowed_list = sorted(allowed_ids)

    today = now_local.date()
    yesterday = today - timedelta(days=1)
    history_days = max(2, min(_DAILY_SALES_ELAPSED_HISTORY_DAYS, 14))
    day_offsets = [today - timedelta(days=i) for i in range(history_days)]

    elapsed_windows: List[Tuple[int, int]] = []
    for d in day_offsets:
        ws = int(datetime.combine(d, dt_time.min, tzinfo=tz).timestamp())
        we = int(_kuwait_elapsed_window_end(d, now_local).timestamp())
        elapsed_windows.append((ws, we))

    def _sales_elapsed_machine_entry(mid: str) -> Dict[str, Any]:
        return {
            "machineId": mid,
            "todayKwd": 0.0,
            "yesterdaySameElapsedKwd": 0.0,
            "yesterdayFullDayKwd": 0.0,
            "dailyElapsed": [
                {"date": d.isoformat(), "weekday": d.strftime("%a"), "kwd": 0.0}
                for d in day_offsets
            ],
        }

    by_machine: Dict[str, Dict[str, Any]] = {mid: _sales_elapsed_machine_entry(mid) for mid in allowed_list}

    def _apply_machine_kwd(mid: str, i: int, kwd: float, truncated: bool) -> None:
        ent = by_machine[mid]
        ent["dailyElapsed"][i]["kwd"] = round(float(ent["dailyElapsed"][i].get("kwd") or 0) + kwd, 4)
        if i == 0:
            ent["todayKwd"] = round(float(ent.get("todayKwd") or 0) + kwd, 4)
        elif i == 1:
            ent["yesterdaySameElapsedKwd"] = round(float(ent.get("yesterdaySameElapsedKwd") or 0) + kwd, 4)
        if truncated and i < len(ent["dailyElapsed"]) and isinstance(ent["dailyElapsed"][i], dict):
            ent["dailyElapsed"][i]["incomplete"] = True

    per_machine_jobs: List[Tuple[str, int, int, int]] = []
    for i in range(min(2, len(elapsed_windows))):
        ws, we = elapsed_windows[i]
        for mid in allowed_list:
            per_machine_jobs.append((mid, i, ws, we))

    def _per_machine_job(job: Tuple[str, int, int, int]) -> Tuple[str, int, float, bool, Optional[str]]:
        mid, i, ws, we = job
        try:
            kwd, truncated = _machine_window_sales_kwd(mid, ws, we)
            return mid, i, kwd, truncated, None
        except Exception as ex:
            return mid, i, 0.0, False, str(ex)

    workers = min(8, max(1, len(allowed_list)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for mid, i, kwd, truncated, err in pool.map(_per_machine_job, per_machine_jobs):
            if err:
                logger.warning("daily-sales-elapsed machine %s day %s: %s", mid, i, err)
                continue
            _apply_machine_kwd(mid, i, kwd, truncated)

    def _apply_vends_for_day(i: int, vends: List[Dict[str, Any]], ws: int, we: int) -> None:
        day_truncated = len(vends) >= 12000
        for v in vends:
            if not isinstance(v, dict):
                continue
            mid = _vend_machine_id(v)
            if not mid or mid not in allowed_ids:
                continue
            ts_i = _vend_ts(v)
            if ts_i <= 0 or ts_i < ws or ts_i > we:
                continue
            amt = _vend_amount_kwd(v)
            if amt <= 0:
                continue
            _apply_machine_kwd(mid, i, amt, False)

        if day_truncated:
            for mid in allowed_list:
                daily = by_machine[mid].get("dailyElapsed") or []
                if i < len(daily) and isinstance(daily[i], dict):
                    daily[i]["incomplete"] = True

    for i in range(2, len(elapsed_windows)):
        ws, we = elapsed_windows[i]
        vends, err = _fetch_all_vends(ws, we)
        if err:
            logger.warning("daily-sales-elapsed skip day %s: %s", day_offsets[i].isoformat(), err)
            continue
        _apply_vends_for_day(i, vends, ws, we)

    # Yesterday + day-before full calendar days — revenue cache (completed-day totals).
    day_before = today - timedelta(days=2)
    for full_day in (yesterday, day_before):
        _maybe_seed_vendon_revenue_cache(full_day)
    rev_db = _pa_session()
    try:
        for full_day in (yesterday, day_before):
            if not _vendon_revenue_cache_has_day(rev_db, full_day):
                try:
                    _refresh_revenue_cache_single_day(full_day.isoformat())
                except Exception:
                    logger.exception("daily-sales-elapsed sync revenue seed for %s", full_day.isoformat())

        rev_rows = (
            rev_db.query(VendonDailyMachineRevenueCache)
            .filter(VendonDailyMachineRevenueCache.cache_date.in_([yesterday, day_before]))
            .all()
        )
        for r in rev_rows:
            mid = (r.machine_id or "").strip()
            if not mid or mid not in allowed_ids:
                continue
            sales = float(r.total_sales_kwd or 0)
            if sales <= 0:
                continue
            ent = by_machine[mid]
            if r.cache_date == yesterday:
                ent["yesterdayFullDayKwd"] = round(sales, 4)
                ent["yesterdayFullDaySource"] = "revenue_cache"
            elif r.cache_date == day_before:
                ent["dayBeforeFullDayKwd"] = round(sales, 4)
                ent["dayBeforeFullDaySource"] = "revenue_cache"
    finally:
        rev_db.close()

    out: Dict[str, Any] = {}
    for mid in allowed_list:
        ent = by_machine[mid]
        daily = ent.get("dailyElapsed") or []
        for slot in daily:
            if isinstance(slot, dict):
                slot["kwd"] = round(float(slot.get("kwd") or 0), 4)
        today_k = round(float(ent.get("todayKwd") or 0), 4)
        yest_k = round(float(ent.get("yesterdaySameElapsedKwd") or 0), 4)
        if daily and isinstance(daily[0], dict):
            today_k = round(float(daily[0].get("kwd") or today_k), 4)
        if len(daily) > 1 and isinstance(daily[1], dict):
            yest_k = round(float(daily[1].get("kwd") or yest_k), 4)
        yest_full_raw = ent.get("yesterdayFullDayKwd")
        yest_full_k: Optional[float] = None
        if yest_full_raw is not None:
            yest_full_k = round(float(yest_full_raw or 0), 4)
            if yest_full_k <= 0:
                yest_full_k = None
        day_before_full_raw = ent.get("dayBeforeFullDayKwd")
        day_before_full_k: Optional[float] = None
        if day_before_full_raw is not None:
            day_before_full_k = round(float(day_before_full_raw or 0), 4)
            if day_before_full_k <= 0:
                day_before_full_k = None
        trend_pct = None
        if yest_k > 0:
            trend_pct = round(((today_k - yest_k) / yest_k) * 100.0, 2)
        row_out: Dict[str, Any] = {
            "todayKwd": today_k,
            "yesterdaySameElapsedKwd": yest_k,
            "trendPct": trend_pct,
            "dailyElapsed": daily,
        }
        if yest_full_k is not None:
            row_out["yesterdayFullDayKwd"] = yest_full_k
        if day_before_full_k is not None:
            row_out["dayBeforeFullDayKwd"] = day_before_full_k
        if ent.get("yesterdayFullDayIncomplete"):
            row_out["yesterdayFullDayIncomplete"] = True
        out[mid] = row_out

    fleet_today = round(sum(float(v.get("todayKwd") or 0) for v in out.values()), 4)
    fleet_yest_full = round(
        sum(float(v["yesterdayFullDayKwd"]) for v in out.values() if v.get("yesterdayFullDayKwd") is not None),
        4,
    )
    fleet_day_before_full = round(
        sum(float(v["dayBeforeFullDayKwd"]) for v in out.values() if v.get("dayBeforeFullDayKwd") is not None),
        4,
    )
    fleet_yest_elapsed = round(
        sum(float(v.get("yesterdaySameElapsedKwd") or 0) for v in out.values()),
        4,
    )

    payload: Dict[str, Any] = {
        "timezone": "Asia/Kuwait",
        "today": today.isoformat(),
        "yesterday": yesterday.isoformat(),
        "historyDays": history_days,
        "historyDates": [d.isoformat() for d in day_offsets],
        "asOfLocal": now_local.strftime("%Y-%m-%dT%H:%M:%S"),
        "comparisonNote": "Each day: midnight Kuwait through the same clock time as this request (fair intraday windows).",
        "fleetTodayKwd": fleet_today,
        "fleetYesterdayFullDayKwd": fleet_yest_full,
        "fleetDayBeforeFullDayKwd": fleet_day_before_full,
        "fleetYesterdaySameElapsedKwd": fleet_yest_elapsed,
        "allowedMachineIds": allowed_list,
        "byMachineId": out,
        "cacheBucket": cache_bucket,
        "cacheGeneratedAt": datetime.now(timezone.utc).isoformat(),
        "stale": False,
    }
    _save_daily_sales_elapsed_db_cache(payload, None, cache_bucket)
    return payload, None


def register_alert_routes(app) -> None:
    @app.route("/api/alert/machines", methods=["GET", "OPTIONS"])
    def alert_machines():
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        rows, err = vendon_fetch_machine_list(_vendon_get)
        if err:
            return jsonify({"error": err, "machines": [], "location_owner_options": []}), 502
        tags_from_machines: List[str] = []
        machines: List[Dict[str, Any]] = []
        for m in rows:
            if m.get("id") is None:
                continue
            mid = str(m.get("id"))
            mname = m.get("name") or mid
            if machine_row_excluded(mname, mid):
                continue
            tag, tag_source = vendon_machine_tag_for_alert_admin_detail(m)
            if tag:
                tags_from_machines.append(tag)
            machines.append(
                {
                    "id": mid,
                    "name": mname,
                    "vendon_location_owner": tag,
                    "vendon_tag_source": tag_source,
                }
            )
        machines.sort(key=lambda x: (x.get("name") or "").lower())
        # Do not merge ``/location`` endpoint names — those are site/branch titles, not machine/fleet tags (confuses Admin datalist).
        options = sorted(set(list(LOCATION_OWNER_CANONICAL) + tags_from_machines), key=lambda s: s.lower())
        return jsonify({"machines": machines, "location_owner_options": options})

    @app.route("/api/alert/operator-contact", methods=["GET", "OPTIONS"])
    def alert_operator_contact():
        """Resolve operator email, phone, and Slack DM from strike email and/or display name."""
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        from operator_contact_lib import resolve_operator_contact

        email = (request.args.get("email") or request.args.get("strikeEmail") or "").strip()
        name = (request.args.get("name") or request.args.get("operatorName") or "").strip()
        machine_id = (request.args.get("machineId") or request.args.get("machine_id") or "").strip()
        if not email and not name and not machine_id:
            return jsonify({"error": "email, name, or machineId required"}), 400
        try:
            out = resolve_operator_contact(email=email or None, operator_name=name or None, machine_id=machine_id or None)
            return jsonify(out)
        except Exception as ex:
            logger.exception("alert_operator_contact")
            return jsonify({"error": str(ex)}), 500

    @app.route("/api/alert/slack-user-map", methods=["GET", "OPTIONS"])
    def alert_slack_user_map():
        """Email → Slack user id for all workspace members (cached users.list)."""
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        from slack_user_map_lib import get_slack_user_map_payload

        force = (request.args.get("refresh") or "").strip().lower() in ("1", "true", "yes")
        try:
            return jsonify(get_slack_user_map_payload(force=force))
        except Exception as ex:
            logger.exception("alert_slack_user_map")
            return jsonify({"error": str(ex)}), 500

    @app.route("/api/alert/qa/last-visit", methods=["GET", "OPTIONS"])
    def alert_qa_last_visit():
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        machine_name = (request.args.get("machineName") or request.args.get("name") or "").strip()
        if not machine_name:
            return jsonify({"error": "machineName required"}), 400
        from safetyculture_qa_lib import qa_visit_for_machine_name
        from qa_manual_summary_lib import admin_summary_mtd_for_machine, admin_summary_month_counts

        hit = qa_visit_for_machine_name(machine_name)
        db = _dash_session()
        try:
            counts = admin_summary_month_counts(db)
            mtd = admin_summary_mtd_for_machine(machine_name, counts)
        finally:
            db.close()
        if hit:
            hit = {**hit, "adminSummaryMtd": mtd}
        return jsonify({"visit": hit, "adminSummaryMtd": mtd})

    @app.route("/api/alert/qa/machine-audits", methods=["GET", "OPTIONS"])
    def alert_qa_machine_audits():
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        machine_name = (request.args.get("machineName") or request.args.get("name") or "").strip()
        if not machine_name:
            return jsonify({"error": "machineName required"}), 400
        from safetyculture_qa_lib import clear_qa_caches, list_qc_audits_for_machine

        if (request.args.get("refresh") or "").strip() in ("1", "true", "yes"):
            clear_qa_caches()
        days_raw = request.args.get("days")
        days = int(days_raw) if days_raw and str(days_raw).isdigit() else None
        payload = list_qc_audits_for_machine(
            machine_name,
            days=days,
            date_from=(request.args.get("from") or request.args.get("dateFrom") or "").strip() or None,
            date_to=(request.args.get("to") or request.args.get("dateTo") or "").strip() or None,
            location_query=(request.args.get("location") or request.args.get("locationQuery") or "").strip() or None,
            sort=(request.args.get("sort") or "date").strip(),
            order=(request.args.get("order") or "desc").strip(),
        )
        return jsonify(payload)

    @app.route("/api/alert/qa/fleet", methods=["GET", "OPTIONS"])
    def alert_qa_fleet():
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        from qa_manual_summary_lib import admin_summary_mtd_for_machine, admin_summary_month_counts, kuwait_year_month
        from safetyculture_qa_lib import clear_qa_caches, fleet_qc_visits_in_range

        if (request.args.get("refresh") or "").strip() in ("1", "true", "yes"):
            clear_qa_caches()
        rows, err = vendon_fetch_machine_list(_vendon_get)
        if err:
            return jsonify({"error": err, "byMachine": {}, "total": 0}), 502
        machine_names: List[str] = []
        for m in rows:
            if m.get("id") is None:
                continue
            mname = str(m.get("name") or m.get("id") or "").strip()
            if not mname or machine_row_excluded(mname, str(m.get("id"))):
                continue
            machine_names.append(mname)

        payload = fleet_qc_visits_in_range(
            machine_names,
            date_from=(request.args.get("from") or request.args.get("dateFrom") or "").strip() or None,
            date_to=(request.args.get("to") or request.args.get("dateTo") or "").strip() or None,
        )
        db = _dash_session()
        try:
            counts = admin_summary_month_counts(db)
        finally:
            db.close()
        by_machine = dict(payload.get("byMachine") or {})
        enriched: Dict[str, Any] = {}
        for mname, row in by_machine.items():
            if not isinstance(row, dict):
                continue
            admin_mtd = admin_summary_mtd_for_machine(mname, counts)
            enriched[mname] = {**row, "adminSummaryMtd": admin_mtd}
        payload = dict(payload)
        payload["byMachine"] = enriched
        payload["adminSummaryMtdByMachine"] = counts
        payload["yearMonth"] = kuwait_year_month()
        return jsonify(payload)

    @app.route("/api/alert/qa/summary", methods=["GET", "OPTIONS"])
    def alert_qa_summary():
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        from qa_manual_summary_lib import (
            admin_summary_mtd_for_machine,
            admin_summary_month_counts,
            enrich_qc_visits_with_admin_summaries,
            kuwait_year_month,
        )
        from safetyculture_qa_lib import clear_qa_caches, latest_qc_by_machine_map, qa_visits_payload

        refresh = (request.args.get("refresh") or "").strip() in ("1", "true", "yes")
        if refresh:
            clear_qa_caches()
        rows, list_err = vendon_fetch_machine_list(_vendon_get)
        machine_names: List[str] = []
        if not list_err:
            for m in rows:
                if m.get("id") is None:
                    continue
                mname = str(m.get("name") or m.get("id") or "").strip()
                if not mname or machine_row_excluded(mname, str(m.get("id"))):
                    continue
                machine_names.append(mname)

        latest_map: Dict[str, Any] = {}
        latest_payload: Dict[str, Any] = {}
        if machine_names:
            latest_payload = latest_qc_by_machine_map(machine_names)
            latest_map = dict(latest_payload.get("byMachine") or {})

        payload = qa_visits_payload(refresh=False)

        db = _dash_session()
        try:
            counts = admin_summary_month_counts(db)
            by_loc = dict(payload.get("byLocationKey") or {})
            by_loc = enrich_qc_visits_with_admin_summaries(by_loc, db)
        finally:
            db.close()
        payload = dict(payload)
        payload["adminSummaryMtdByMachine"] = counts
        payload["yearMonth"] = kuwait_year_month()
        latest_by_machine: Dict[str, Any] = {}
        for mname, row in latest_map.items():
            if not isinstance(row, dict):
                continue
            admin_mtd = admin_summary_mtd_for_machine(mname, counts)
            latest_by_machine[mname] = {**row, "adminSummaryMtd": admin_mtd}
        payload["latestByMachine"] = latest_by_machine
        payload["latestByMachineDateFrom"] = latest_payload.get("dateFrom") if latest_map else None
        payload["latestByMachineDateTo"] = latest_payload.get("dateTo") if latest_map else None
        if latest_payload.get("warning"):
            payload["warning"] = latest_payload.get("warning")
        if latest_payload.get("partial"):
            payload["partial"] = latest_payload.get("partial")
        if latest_payload.get("error") and not latest_map:
            payload["error"] = latest_payload.get("error")
        for nk, row in list(by_loc.items()):
            if isinstance(row, dict):
                loc = str(row.get("location") or "")
                admin_mtd = counts.get(nk, 0) or admin_summary_mtd_for_machine(loc, counts)
                by_loc[nk] = {**row, "adminSummaryMtd": admin_mtd}
        payload["byLocationKey"] = by_loc
        visits = []
        for row in payload.get("visits") or []:
            if not isinstance(row, dict):
                continue
            loc = str(row.get("location") or "")
            from safetyculture_qa_lib import _norm_key

            nk = _norm_key(loc)
            admin_mtd = counts.get(nk, 0) or admin_summary_mtd_for_machine(loc, counts)
            visits.append({**row, "adminSummaryMtd": admin_mtd})
        payload["visits"] = visits
        return jsonify(payload)

    @app.route("/api/alert/qa/findings", methods=["GET", "OPTIONS"])
    def alert_qa_findings():
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        from qa_findings_lib import qa_findings_payload

        return jsonify(qa_findings_payload())

    @app.route("/api/alert/qa/manual-summary", methods=["GET", "OPTIONS"])
    def alert_qa_manual_summary():
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        machine_name = (request.args.get("machineName") or request.args.get("name") or "").strip()
        if not machine_name:
            return jsonify({"error": "machineName required"}), 400

        from qa_machine_alias_lib import machine_names_for_lookup
        from qa_manual_summary_lib import kuwait_year_month, month_count_for_machine, parse_bullet_lines

        db = _dash_session()
        try:
            names = machine_names_for_lookup(machine_name)
            row = (
                db.query(QaManualSummary)
                .filter(func.lower(func.trim(QaManualSummary.machine_name)).in_(names))
                .order_by(QaManualSummary.created_at.desc())
                .first()
            )
            month_count = month_count_for_machine(db, machine_name)
            if not row:
                return jsonify(
                    {
                        "machineName": machine_name,
                        "summary": None,
                        "bullets": [],
                        "savedAt": None,
                        "savedBy": None,
                        "monthCount": month_count,
                        "yearMonth": kuwait_year_month(),
                    }
                )
            return jsonify(
                {
                    "machineName": row.machine_name,
                    "summary": row.summary_text,
                    "bullets": parse_bullet_lines(row.summary_text),
                    "savedAt": row.created_at.isoformat() if row.created_at else None,
                    "savedBy": row.created_by,
                    "monthCount": month_count,
                    "yearMonth": kuwait_year_month(),
                }
            )
        except Exception as ex:
            logger.exception("alert_qa_manual_summary")
            return jsonify({"error": str(ex)}), 500
        finally:
            db.close()

    @app.route("/api/alert/admin/qa-manual-summaries", methods=["GET", "POST", "OPTIONS"])
    def alert_admin_qa_manual_summaries():
        if request.method == "OPTIONS":
            return "", 204
        email, denied = _require_alert_admin()
        if denied:
            return denied

        from qa_machine_alias_lib import machine_names_for_lookup
        from qa_manual_summary_lib import (
            kuwait_year_month,
            month_count_for_machine,
            parse_bullet_lines,
            validate_bullet_summary,
        )

        db = _dash_session()
        try:
            if request.method == "GET":
                machine_name = (request.args.get("machineName") or request.args.get("name") or "").strip()
                if not machine_name:
                    return jsonify({"error": "machineName required"}), 400
                ym = kuwait_year_month()
                names = machine_names_for_lookup(machine_name)
                rows = (
                    db.query(QaManualSummary)
                    .filter(func.lower(func.trim(QaManualSummary.machine_name)).in_(names))
                    .filter(
                        text(
                            "to_char(created_at AT TIME ZONE 'Asia/Kuwait', 'YYYY-MM') = :ym"
                        ).bindparams(ym=ym)
                    )
                    .order_by(QaManualSummary.created_at.desc())
                    .limit(50)
                    .all()
                )
                month_count = month_count_for_machine(db, machine_name)
                latest = (
                    db.query(QaManualSummary)
                    .filter(func.lower(func.trim(QaManualSummary.machine_name)).in_(names))
                    .order_by(QaManualSummary.created_at.desc())
                    .first()
                )
                out_rows = []
                for r in rows:
                    out_rows.append(
                        {
                            "id": r.id,
                            "summary": r.summary_text,
                            "bullets": parse_bullet_lines(r.summary_text),
                            "savedAt": r.created_at.isoformat() if r.created_at else None,
                            "savedBy": r.created_by,
                        }
                    )
                latest_payload = None
                if latest:
                    latest_payload = {
                        "machineName": latest.machine_name,
                        "summary": latest.summary_text,
                        "bullets": parse_bullet_lines(latest.summary_text),
                        "savedAt": latest.created_at.isoformat() if latest.created_at else None,
                        "savedBy": latest.created_by,
                    }
                return jsonify(
                    {
                        "machineName": machine_name,
                        "yearMonth": ym,
                        "monthCount": month_count,
                        "rows": out_rows,
                        "latest": latest_payload,
                    }
                )

            body = request.get_json(silent=True) or {}
            machine_name = (body.get("machineName") or body.get("machine_name") or "").strip()
            summary_text = (body.get("summary") or body.get("summary_text") or "").strip()
            if not machine_name:
                return jsonify({"error": "machineName required"}), 400
            ok, err = validate_bullet_summary(summary_text)
            if not ok:
                return jsonify({"error": "invalid_format", "message": err}), 400

            row = QaManualSummary(
                machine_name=machine_name,
                summary_text=summary_text,
                created_by=email,
                created_at=datetime.now(timezone.utc),
            )
            db.add(row)
            db.commit()
            db.refresh(row)
            month_count = month_count_for_machine(db, machine_name)
            return jsonify(
                {
                    "ok": True,
                    "id": row.id,
                    "machineName": machine_name,
                    "summary": summary_text,
                    "bullets": parse_bullet_lines(summary_text),
                    "savedAt": row.created_at.isoformat() if row.created_at else None,
                    "savedBy": email,
                    "monthCount": month_count,
                    "yearMonth": kuwait_year_month(),
                }
            )
        except Exception as ex:
            logger.exception("alert_admin_qa_manual_summaries")
            db.rollback()
            return jsonify({"error": "save_failed", "message": str(ex)}), 500
        finally:
            db.close()

    @app.route("/api/alert/targets/machine-detail", methods=["GET", "OPTIONS"])
    def alert_targets_machine_detail():
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        machine_id = (request.args.get("machineId") or request.args.get("machine_id") or "").strip()
        machine_name = (request.args.get("machineName") or request.args.get("name") or "").strip()
        if not machine_id:
            return jsonify({"error": "machineId required"}), 400
        from alert_target_lib import build_machine_target_detail

        db = _dash_session()
        try:
            prof = db.query(AlertMachineProfile).filter(AlertMachineProfile.machine_id == machine_id).first()
            loc_owner = (prof.location_owner if prof else None) or None
            daily_cfg = None
            from dashboard_access_models import LiveMachineConfig

            lmc = db.query(LiveMachineConfig).filter(LiveMachineConfig.machine_id == machine_id).first()
            if lmc and lmc.daily_sales_target is not None:
                daily_cfg = float(lmc.daily_sales_target)
            today_kwd = float(request.args.get("todayKwd") or 0)
            yest_kwd = float(request.args.get("yesterdayKwd") or 0)
            out = build_machine_target_detail(
                machine_id=machine_id,
                machine_name=machine_name or (prof.machine_name if prof else machine_id),
                location_owner=loc_owner,
                daily_target_cfg=daily_cfg,
                today_kwd=today_kwd,
                yesterday_kwd=yest_kwd,
                db=db,
            )
            return jsonify(out)
        except Exception as ex:
            logger.exception("alert_targets_machine_detail")
            return jsonify({"error": str(ex)}), 500
        finally:
            db.close()

    @app.route("/api/alert/red-flags/snapshot", methods=["GET", "OPTIONS"])
    def alert_red_flags_snapshot():
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        db = _dash_session()
        try:
            row = db.query(RedAlertSnapshotCache).filter(RedAlertSnapshotCache.id == 1).first()
            if not row or not row.payload_json:
                return jsonify(
                    {
                        "rows": [],
                        "fromCache": True,
                        "cacheStale": True,
                        "cacheGeneratedAt": None,
                        "error": "cache_empty",
                    }
                )
            if row.compute_error:
                return jsonify(
                    {
                        "rows": [],
                        "fromCache": True,
                        "cacheStale": True,
                        "cacheGeneratedAt": row.generated_at.isoformat() if row.generated_at else None,
                        "error": row.compute_error,
                    }
                )
            payload = dict(row.payload_json or {})
            payload["fromCache"] = True
            payload["cacheGeneratedAt"] = row.generated_at.isoformat() if row.generated_at else None
            payload["cacheStale"] = False
            return jsonify(payload)
        finally:
            db.close()

    @app.route("/api/alert/operator-activity", methods=["GET", "OPTIONS"])
    def alert_operator_activity():
        """
        Last operator touch times for Alert Operator Activity column:
        cleaning (Attendance & Cleaning cache), remote credit (proven attendance),
        door open + refill (Vendon /event).
        """
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        try:
            history_days = 14
            try:
                history_days = max(3, min(30, int(request.args.get("days") or 14)))
            except (TypeError, ValueError):
                history_days = 14
            raw_ids = (request.args.get("machines") or "").strip()
            requested = [x.strip() for x in raw_ids.split(",") if x.strip()]
            if len(requested) > 500:
                requested = requested[:500]

            cache_key = f"op-act:v5:{history_days}:{','.join(sorted(requested)) if requested else 'all'}"
            cached = _alert_cache_get(cache_key, 90)
            if cached is not None:
                return jsonify(cached)

            from alert_operator_activity_lib import compute_operator_activity

            allowed = requested
            if not allowed:
                rows, list_err = vendon_fetch_machine_list(_vendon_get)
                if list_err:
                    return jsonify({"error": list_err, "byMachineId": {}}), 502
                allowed = [str(r.get("id") or "").strip() for r in (rows or []) if str(r.get("id") or "").strip()]

            payload = compute_operator_activity(
                _vendon_get,
                history_days=history_days,
                allowed_machine_ids=allowed,
            )
            _alert_cache_set(cache_key, payload)
            return jsonify(payload)
        except Exception as ex:
            logger.exception("alert_operator_activity")
            return jsonify({"error": str(ex), "byMachineId": {}}), 500

    @app.route("/api/alert/remote-credits/today-totals", methods=["GET", "OPTIONS"])
    def alert_remote_credits_today_totals():
        """
        Lightweight summary for Alert boards:
        - credits_sent: total remote credits for the Kuwait calendar day
        - dispense_tests: Drink Tests count (same criteria as Monitor refund tests)
        - vends_resolved: last failed vend vs nearest remote credit within 5 minutes (when ``machines`` query provided)
        - cleaning_windows / timezone: from Alert machine profile for Last Cleaning column styling
        """
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        try:
            kuwait_today = datetime.now(timezone.utc).astimezone(ZoneInfo("Asia/Kuwait")).date().isoformat()
            raw_ids = (request.args.get("machines") or "").strip()
            requested_machines = [x.strip() for x in raw_ids.split(",") if x.strip()]
            if len(requested_machines) > 400:
                requested_machines = requested_machines[:400]

            cache_key = f"rc:{kuwait_today}:{','.join(sorted(requested_machines))}"
            cached = _alert_cache_get(cache_key, _ALERT_REMOTE_CREDITS_CACHE_SEC)
            if cached is not None:
                return jsonify(cached)

            classic = _classic_remote_credits_by_machine(kuwait_today)
            scope_ids = requested_machines if requested_machines else list(classic.keys())
            by_machine: Dict[str, Any] = {}
            for mid in scope_ids:
                base = classic.get(mid)
                by_machine[mid] = {
                    "credits_sent": int(base.get("credits_sent") or 0) if base else 0,
                    "dispense_tests": int(base.get("dispense_tests") or 0) if base else 0,
                }

            resolve_ids = list(dict.fromkeys(requested_machines if requested_machines else list(classic.keys())))
            if resolve_ids:
                cap = max(1, _ALERT_REMOTE_CREDITS_MAX_VENDS_RESOLVE)
                resolve_ids = resolve_ids[:cap]
                max_workers = min(_ALERT_REMOTE_CREDITS_MAX_WORKERS, max(1, len(resolve_ids)))

                def _one(mid: str) -> Tuple[str, Dict[str, Any]]:
                    try:
                        return mid, compute_vends_resolved_for_machine(mid, kuwait_today)
                    except Exception as ex:
                        logger.warning("vends_resolved machine %s: %s", mid, ex)
                        return mid, {"status": "unknown", "reason": str(ex)}

                with ThreadPoolExecutor(max_workers=max_workers) as pool:
                    futs = [pool.submit(_one, mid) for mid in resolve_ids]
                    for fut in as_completed(futs):
                        mid, vr = fut.result()
                        row = by_machine.setdefault(mid, {"credits_sent": 0, "dispense_tests": 0})
                        row["vends_resolved"] = vr.get("status") if isinstance(vr, dict) else "unknown"

            profile_ids = list(dict.fromkeys(requested_machines)) if requested_machines else list(by_machine.keys())
            if profile_ids:
                db = _dash_session()
                try:
                    rows = db.query(AlertMachineProfile).filter(AlertMachineProfile.machine_id.in_(profile_ids)).all()
                    for pr in rows:
                        pid = str(pr.machine_id or "").strip()
                        if not pid:
                            continue
                        slot = by_machine.setdefault(pid, {"credits_sent": 0, "dispense_tests": 0})
                        slot["cleaning_windows"] = pr.cleaning_windows if pr.cleaning_windows is not None else []
                        tz_s = (pr.timezone or "").strip() or "Asia/Kuwait"
                        slot["timezone"] = tz_s
                finally:
                    db.close()

            payload = {"date": kuwait_today, "byMachineId": by_machine}
            _alert_cache_set(cache_key, payload)
            return jsonify(payload)
        except Exception as ex:
            logger.exception("alert_remote_credits_today_totals")
            return jsonify({"date": None, "byMachineId": {}, "error": str(ex)}), 200

    @app.route("/api/alert/admin/cleaning-schedules", methods=["GET", "POST", "OPTIONS"])
    def alert_admin_cleaning_schedules():
        if request.method == "OPTIONS":
            return "", 204
        email, denied = _require_alert_admin()
        if denied:
            return denied

        db = _dash_session()
        try:
            if request.method == "GET":
                rows = db.query(MachineCleaningSchedule).order_by(MachineCleaningSchedule.priority.desc(), MachineCleaningSchedule.name_pattern.asc()).all()
                out = []
                for r in rows:
                    out.append(
                        {
                            "id": r.id,
                            "name_pattern": r.name_pattern,
                            "cleaning_operator": r.cleaning_operator,
                            "timezone": r.timezone,
                            "windows": r.windows,
                            "priority": r.priority,
                            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
                        }
                    )
                return jsonify({"rows": out})

            body = request.get_json(silent=True) or {}
            name_pattern = (body.get("name_pattern") or "").strip()
            cleaning_operator = (body.get("cleaning_operator") or "").strip()
            timezone_s = (body.get("timezone") or "Asia/Kuwait").strip() or "Asia/Kuwait"
            windows = body.get("windows")
            priority = int(body.get("priority") or 0)
            if not name_pattern or not cleaning_operator:
                return jsonify({"error": "name_pattern and cleaning_operator are required"}), 400
            if windows is None:
                return jsonify({"error": "windows is required"}), 400

            row = db.query(MachineCleaningSchedule).filter(MachineCleaningSchedule.name_pattern == name_pattern).first()
            now = datetime.now(timezone.utc)
            if row:
                row.cleaning_operator = cleaning_operator
                row.timezone = timezone_s
                row.windows = windows
                row.priority = priority
                row.updated_at = now
            else:
                row = MachineCleaningSchedule(
                    name_pattern=name_pattern,
                    cleaning_operator=cleaning_operator,
                    timezone=timezone_s,
                    windows=windows,
                    priority=priority,
                    updated_at=now,
                )
                db.add(row)
            db.commit()
            db.refresh(row)
            return jsonify({"ok": True, "id": row.id, "updated_by": email})
        except Exception as ex:
            logger.exception("alert admin cleaning schedules")
            db.rollback()
            return jsonify({"error": "save_failed", "message": str(ex)}), 500
        finally:
            db.close()

    @app.route("/api/alert/admin/cleaning-schedules/<int:row_id>", methods=["DELETE", "OPTIONS"])
    def alert_admin_cleaning_schedule_delete(row_id: int):
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_admin()
        if denied:
            return denied
        db = _dash_session()
        try:
            row = db.query(MachineCleaningSchedule).filter(MachineCleaningSchedule.id == int(row_id)).first()
            if not row:
                return jsonify({"error": "not_found"}), 404
            db.delete(row)
            db.commit()
            return jsonify({"ok": True})
        except Exception as ex:
            logger.exception("alert admin cleaning schedule delete")
            db.rollback()
            return jsonify({"error": "delete_failed", "message": str(ex)}), 500
        finally:
            db.close()

    @app.route("/api/alert/admin/machine-profiles", methods=["GET", "POST", "OPTIONS"])
    def alert_admin_machine_profiles():
        if request.method == "OPTIONS":
            return "", 204
        email, denied = _require_alert_admin()
        if denied:
            return denied

        db = _dash_session()
        try:
            if request.method == "GET":
                rows = db.query(AlertMachineProfile).order_by(
                    AlertMachineProfile.machine_name.asc(),
                    AlertMachineProfile.machine_id.asc(),
                ).all()
                out: List[Dict[str, Any]] = []
                target_by_mid: Dict[str, Dict[str, Any]] = {}
                from alert_targets_lib import products_from_lmc_row

                for lmc in db.query(LiveMachineConfig).all():
                    mid_k = str(lmc.machine_id)
                    products = products_from_lmc_row(lmc)
                    target_by_mid[mid_k] = {
                        "daily_sales_target": (
                            float(lmc.daily_sales_target) if lmc.daily_sales_target is not None else None
                        ),
                        "sx_product_name": (lmc.sx_product_name or None),
                        "daily_product_target": (
                            float(lmc.daily_product_target) if lmc.daily_product_target is not None else None
                        ),
                        "sx_target_period": (lmc.sx_target_period or "daily"),
                        "location_target_metric": (
                            (lmc.location_target_metric or "revenue").strip().lower()
                            if getattr(lmc, "location_target_metric", None)
                            else "revenue"
                        ),
                        "daily_location_cups_target": (
                            float(lmc.daily_location_cups_target)
                            if getattr(lmc, "daily_location_cups_target", None) is not None
                            else None
                        ),
                        "promoted_products": products,
                    }
                for r in rows:
                    pat = (r.machine_name or r.machine_id or "").strip()
                    priority_out = 10
                    if pat:
                        sched = (
                            db.query(MachineCleaningSchedule)
                            .filter(MachineCleaningSchedule.name_pattern == pat)
                            .first()
                        )
                        if sched is not None:
                            priority_out = int(sched.priority or 0)
                    lmc_fields = target_by_mid.get(str(r.machine_id)) or {}
                    out.append(
                        {
                            "machine_id": r.machine_id,
                            "machine_name": r.machine_name,
                            "location_owner": r.location_owner,
                            "location_hours": r.location_hours,
                            "operating_days": r.operating_days,
                            "cleaning_windows": r.cleaning_windows,
                            "operator_hours": r.operator_hours,
                            "technician_schedule": r.technician_schedule,
                            "qa_schedule": r.qa_schedule,
                            "timezone": r.timezone,
                            "is_active": bool(getattr(r, "is_active", True)),
                            "inactive_schedule": getattr(r, "inactive_schedule", None) or {},
                            "priority": priority_out,
                            "daily_sales_target": lmc_fields.get("daily_sales_target"),
                            "sx_product_name": lmc_fields.get("sx_product_name"),
                            "daily_product_target": lmc_fields.get("daily_product_target"),
                            "sx_target_period": lmc_fields.get("sx_target_period") or "daily",
                            "location_target_metric": lmc_fields.get("location_target_metric") or "revenue",
                            "daily_location_cups_target": lmc_fields.get("daily_location_cups_target"),
                            "promoted_products": lmc_fields.get("promoted_products") or [],
                            "updated_by": r.updated_by,
                            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
                        }
                    )
                return jsonify({"rows": out})

            body = request.get_json(silent=True) or {}
            mid = (body.get("machine_id") or "").strip()
            if not mid:
                return jsonify({"error": "machine_id is required"}), 400
            mname = (body.get("machine_name") or "").strip() or None
            loc_owner = (body.get("location_owner") or "").strip() or None
            loc_hours = (body.get("location_hours") or "").strip() or None
            if loc_hours and loc_hours not in ("9", "12", "16", "24"):
                return jsonify({"error": "location_hours must be 9, 12, 16, or 24 (hours preset)"}), 400
            op_days = body.get("operating_days")
            if op_days is None:
                op_days = {"preset": "all_week"}
            cw = body.get("cleaning_windows")
            if cw is None:
                cw = []
            oh = _normalize_operator_hours(body.get("operator_hours"))
            tech = _normalize_staff_visit_schedule(body.get("technician_schedule"))
            qa = _normalize_staff_visit_schedule(body.get("qa_schedule"))
            tz_s = (body.get("timezone") or "Asia/Kuwait").strip() or "Asia/Kuwait"
            is_active_raw = body.get("is_active")
            if is_active_raw is None:
                is_active_val = True
            else:
                is_active_val = bool(is_active_raw) if not isinstance(is_active_raw, str) else str(is_active_raw).strip().lower() in (
                    "1",
                    "true",
                    "yes",
                    "active",
                )
            from alert_inactive_lib import normalize_inactive_schedule
            from sqlalchemy.orm.attributes import flag_modified

            inactive_sched = normalize_inactive_schedule(body.get("inactive_schedule"))
            priority = int(body.get("priority") or 10)
            daily_target_raw = body.get("daily_sales_target")
            sx_product_name_raw = body.get("sx_product_name")
            daily_product_target_raw = body.get("daily_product_target")
            sx_target_period_raw = body.get("sx_target_period")

            now = datetime.now(timezone.utc)
            row = db.query(AlertMachineProfile).filter(AlertMachineProfile.machine_id == mid).first()
            if row:
                row.machine_name = mname
                row.location_owner = loc_owner
                row.location_hours = loc_hours
                row.operating_days = op_days
                row.cleaning_windows = cw
                row.operator_hours = oh
                row.technician_schedule = tech
                row.qa_schedule = qa
                row.timezone = tz_s
                row.is_active = is_active_val
                row.inactive_schedule = inactive_sched
                row.updated_by = email
                row.updated_at = now
                # JSONB: force dirty so technician/QA/operator arrays always persist
                flag_modified(row, "operating_days")
                flag_modified(row, "cleaning_windows")
                flag_modified(row, "operator_hours")
                flag_modified(row, "technician_schedule")
                flag_modified(row, "qa_schedule")
                flag_modified(row, "inactive_schedule")
            else:
                row = AlertMachineProfile(
                    machine_id=mid,
                    machine_name=mname,
                    location_owner=loc_owner,
                    location_hours=loc_hours,
                    operating_days=op_days,
                    cleaning_windows=cw,
                    operator_hours=oh,
                    technician_schedule=tech,
                    qa_schedule=qa,
                    timezone=tz_s,
                    is_active=is_active_val,
                    inactive_schedule=inactive_sched,
                    updated_by=email,
                    updated_at=now,
                )
                db.add(row)

            pat_name = mname or mid
            _sync_machine_cleaning_schedule(
                db,
                machine_id=mid,
                machine_name=pat_name,
                cleaning_windows=cw,
                operator_hours=oh,
                timezone_s=tz_s,
                priority=priority,
            )
            if (
                "daily_sales_target" in body
                or "sx_product_name" in body
                or "daily_product_target" in body
                or "sx_target_period" in body
                or "promoted_products" in body
                or "location_target_metric" in body
                or "daily_location_cups_target" in body
            ):
                from alert_targets_lib import (
                    legacy_primary_from_products,
                    normalize_metric,
                    normalize_period,
                    normalize_promoted_products,
                )

                lmc = db.query(LiveMachineConfig).filter(LiveMachineConfig.machine_id == mid).first()
                if not lmc:
                    lmc = LiveMachineConfig(machine_id=mid)
                    db.add(lmc)
                if "daily_sales_target" in body:
                    lmc.daily_sales_target = _decimal_or_none(daily_target_raw)
                if "location_target_metric" in body:
                    lmc.location_target_metric = normalize_metric(body.get("location_target_metric"), "revenue")
                if "daily_location_cups_target" in body:
                    lmc.daily_location_cups_target = _decimal_or_none(body.get("daily_location_cups_target"))
                if "promoted_products" in body:
                    from sqlalchemy.orm.attributes import flag_modified

                    products = normalize_promoted_products(body.get("promoted_products"))
                    lmc.promoted_products = list(products)
                    flag_modified(lmc, "promoted_products")
                    pname, ptgt, per = legacy_primary_from_products(products)
                    lmc.sx_product_name = pname
                    lmc.daily_product_target = _decimal_or_none(ptgt)
                    lmc.sx_target_period = per
                else:
                    if "sx_product_name" in body:
                        pname = (str(sx_product_name_raw).strip() if sx_product_name_raw is not None else "") or None
                        lmc.sx_product_name = pname
                    if "daily_product_target" in body:
                        lmc.daily_product_target = _decimal_or_none(daily_product_target_raw)
                    if "sx_target_period" in body:
                        lmc.sx_target_period = normalize_period(sx_target_period_raw, "daily")
            db.commit()
            db.refresh(row)
            return jsonify({"ok": True, "machine_id": row.machine_id, "updated_by": email})
        except Exception as ex:
            logger.exception("alert admin machine profiles")
            db.rollback()
            return jsonify({"error": "save_failed", "message": str(ex)}), 500
        finally:
            db.close()

    @app.route("/api/alert/admin/targets", methods=["GET", "POST", "OPTIONS"])
    def alert_admin_targets():
        """Location + multi-product targets (LMC only — does not touch cleaning profiles)."""
        if request.method == "OPTIONS":
            return "", 204
        email, denied = _require_alert_admin()
        if denied:
            return denied
        from alert_targets_lib import (
            legacy_primary_from_products,
            normalize_metric,
            normalize_period,
            normalize_promoted_products,
            products_from_lmc_row,
        )

        db = _dash_session()
        try:
            if request.method == "GET":
                out: List[Dict[str, Any]] = []
                for lmc in db.query(LiveMachineConfig).all():
                    products = products_from_lmc_row(lmc)
                    out.append(
                        {
                            "machineId": str(lmc.machine_id),
                            "dailySalesTarget": (
                                float(lmc.daily_sales_target) if lmc.daily_sales_target is not None else None
                            ),
                            "locationTargetMetric": normalize_metric(
                                getattr(lmc, "location_target_metric", None), "revenue"
                            ),
                            "dailyLocationCupsTarget": (
                                float(lmc.daily_location_cups_target)
                                if getattr(lmc, "daily_location_cups_target", None) is not None
                                else None
                            ),
                            "sxTargetPeriod": normalize_period(lmc.sx_target_period, "daily"),
                            "promotedProducts": products,
                            "sxProductName": lmc.sx_product_name,
                            "dailyProductTarget": (
                                float(lmc.daily_product_target) if lmc.daily_product_target is not None else None
                            ),
                        }
                    )
                return jsonify({"rows": out})

            body = request.get_json(silent=True) or {}
            mid = str(body.get("machineId") or body.get("machine_id") or "").strip()
            if not mid:
                return jsonify({"error": "machineId required"}), 400
            lmc = db.query(LiveMachineConfig).filter(LiveMachineConfig.machine_id == mid).first()
            if not lmc:
                lmc = LiveMachineConfig(machine_id=mid)
                db.add(lmc)
            if "dailySalesTarget" in body or "daily_sales_target" in body:
                lmc.daily_sales_target = _decimal_or_none(
                    body.get("dailySalesTarget", body.get("daily_sales_target"))
                )
            if "locationTargetMetric" in body or "location_target_metric" in body:
                lmc.location_target_metric = normalize_metric(
                    body.get("locationTargetMetric", body.get("location_target_metric")), "revenue"
                )
            if "dailyLocationCupsTarget" in body or "daily_location_cups_target" in body:
                lmc.daily_location_cups_target = _decimal_or_none(
                    body.get("dailyLocationCupsTarget", body.get("daily_location_cups_target"))
                )
            if "sxTargetPeriod" in body or "sx_target_period" in body:
                lmc.sx_target_period = normalize_period(
                    body.get("sxTargetPeriod", body.get("sx_target_period")), "daily"
                )
            if "promotedProducts" in body or "promoted_products" in body:
                from sqlalchemy.orm.attributes import flag_modified

                products = normalize_promoted_products(
                    body.get("promotedProducts", body.get("promoted_products"))
                )
                # Replace list so each product keeps its own target (JSONB needs flag_modified)
                lmc.promoted_products = list(products)
                flag_modified(lmc, "promoted_products")
                pname, ptgt, per = legacy_primary_from_products(products)
                lmc.sx_product_name = pname
                lmc.daily_product_target = _decimal_or_none(ptgt)
                if "sxTargetPeriod" not in body and "sx_target_period" not in body:
                    lmc.sx_target_period = per
            db.commit()
            db.refresh(lmc)
            return jsonify(
                {
                    "ok": True,
                    "machineId": mid,
                    "updatedBy": email,
                    "locationTargetMetric": normalize_metric(
                        getattr(lmc, "location_target_metric", None), "revenue"
                    ),
                    "dailySalesTarget": (
                        float(lmc.daily_sales_target) if lmc.daily_sales_target is not None else None
                    ),
                    "dailyLocationCupsTarget": (
                        float(lmc.daily_location_cups_target)
                        if getattr(lmc, "daily_location_cups_target", None) is not None
                        else None
                    ),
                    "sxTargetPeriod": normalize_period(lmc.sx_target_period, "daily"),
                    "promotedProducts": products_from_lmc_row(lmc),
                }
            )
        except Exception as ex:
            logger.exception("alert_admin_targets")
            db.rollback()
            return jsonify({"error": str(ex)}), 500
        finally:
            db.close()

    @app.route("/api/alert/admin/targets/bulk-location", methods=["POST", "OPTIONS"])
    def alert_admin_targets_bulk_location():
        """
        Apply the same LOCATION target fields to many machines.
        Does NOT touch promotedProducts / SX product cups (those stay per machine).
        Body: { machineIds: [], locationTargetMetric?, dailySalesTarget?, dailyLocationCupsTarget?, sxTargetPeriod? }
        """
        if request.method == "OPTIONS":
            return "", 204
        email, denied = _require_alert_admin()
        if denied:
            return denied
        from alert_targets_lib import normalize_metric, normalize_period

        body = request.get_json(silent=True) or {}
        machine_ids: List[str] = [
            str(x).strip()
            for x in (body.get("machineIds") or body.get("machine_ids") or [])
            if str(x).strip()
        ]
        if not machine_ids:
            return jsonify({"error": "machineIds required"}), 400
        if len(machine_ids) > 200:
            return jsonify({"error": "machineIds max 200"}), 400

        has_metric = "locationTargetMetric" in body or "location_target_metric" in body
        has_kd = "dailySalesTarget" in body or "daily_sales_target" in body
        has_cups = "dailyLocationCupsTarget" in body or "daily_location_cups_target" in body
        has_period = "sxTargetPeriod" in body or "sx_target_period" in body
        if not (has_metric or has_kd or has_cups or has_period):
            return jsonify({"error": "provide at least one location target field"}), 400

        db = _dash_session()
        try:
            updated = 0
            for mid in machine_ids:
                lmc = db.query(LiveMachineConfig).filter(LiveMachineConfig.machine_id == mid).first()
                if not lmc:
                    lmc = LiveMachineConfig(machine_id=mid)
                    db.add(lmc)
                if has_metric:
                    lmc.location_target_metric = normalize_metric(
                        body.get("locationTargetMetric", body.get("location_target_metric")), "revenue"
                    )
                if has_kd:
                    lmc.daily_sales_target = _decimal_or_none(
                        body.get("dailySalesTarget", body.get("daily_sales_target"))
                    )
                if has_cups:
                    lmc.daily_location_cups_target = _decimal_or_none(
                        body.get("dailyLocationCupsTarget", body.get("daily_location_cups_target"))
                    )
                if has_period:
                    lmc.sx_target_period = normalize_period(
                        body.get("sxTargetPeriod", body.get("sx_target_period")), "daily"
                    )
                updated += 1
            db.commit()
            return jsonify({"ok": True, "updated": updated, "updatedBy": email})
        except Exception as ex:
            logger.exception("alert_admin_targets_bulk_location")
            db.rollback()
            return jsonify({"error": str(ex)}), 500
        finally:
            db.close()

    @app.route("/api/alert/admin/vendon-products", methods=["GET", "OPTIONS"])
    def alert_admin_vendon_products():
        """Distinct product names from recent Vendon vends (per machine or fleet sample)."""
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_admin()
        if denied:
            return denied
        mid = (request.args.get("machineId") or request.args.get("machine_id") or "").strip()
        try:
            lookback = max(3, min(45, int(request.args.get("days") or 21)))
        except (TypeError, ValueError):
            lookback = 21
        cache_key = f"perf:vendon-products:v2:{mid or 'fleet'}:{lookback}"
        cached = _alert_cache_get(cache_key, 300)
        if cached is not None:
            return jsonify(cached)

        tz = ZoneInfo("Asia/Kuwait")
        today = datetime.now(tz).date()
        start = today - timedelta(days=lookback - 1)
        from vendon_proxy_routes import _stats_vend_product_fields

        names: Dict[str, int] = {}
        try:
            from_ts, _ = _kuwait_day_bounds_utc(start.isoformat())
            _, to_ts = _kuwait_day_bounds_utc(today.isoformat())
        except Exception:
            from_ts = to_ts = 0

        def _accumulate_vends(vends: Optional[List[Any]]) -> None:
            for v in vends or []:
                if not isinstance(v, dict):
                    continue
                pn, _sel = _stats_vend_product_fields(v)
                pn = (pn or "").strip()
                if not pn or len(pn) < 2:
                    continue
                names[pn] = names.get(pn, 0) + 1

        if from_ts and to_ts:
            if mid:
                # One window for the selected machine (same path Admin → Targets uses)
                vends, _err = _fetch_vends_machine_day(mid, from_ts, to_ts)
                _accumulate_vends(vends)
            else:
                # Fleet sample: one paginated /stats/vends window — avoid N sequential
                # machine calls (was timing out Admin → Promo on open).
                vends, _err = _fetch_all_vends(from_ts, to_ts, max_rows=8000)
                _accumulate_vends(vends)

        products = [
            {"name": n, "productName": n, "vendCount": c}
            for n, c in sorted(names.items(), key=lambda kv: (-kv[1], kv[0].lower()))
        ]
        body = {
            "machineId": mid or None,
            "days": lookback,
            "products": products[:200],
            "count": len(products),
        }
        _alert_cache_set(cache_key, body)
        return jsonify(body)

    @app.route("/api/alert/admin/target-insights", methods=["GET", "OPTIONS"])
    def alert_admin_target_insights():
        """
        Cached sales insights to help set location/product targets.
        Query: machineId=…&products=Name1,Name2 (optional; else uses promoted + top Vendon)
        Location KD from revenue cache; product cups from Vendon (cached ~5 min).
        """
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_admin()
        if denied:
            return denied
        mid = (request.args.get("machineId") or request.args.get("machine_id") or "").strip()
        if not mid:
            return jsonify({"error": "machineId required"}), 400
        raw_prods = (request.args.get("products") or "").strip()
        want_products = [p.strip() for p in raw_prods.split(",") if p.strip()][:12]
        cache_key = f"perf:target-insights:v1:{mid}:{','.join(sorted(x.lower() for x in want_products)) or 'auto'}"
        cached = _alert_cache_get(cache_key, 300)
        if cached is not None:
            return jsonify(cached)

        tz = ZoneInfo("Asia/Kuwait")
        now_local = datetime.now(tz)
        today = now_local.date()
        fetch_lo = today - timedelta(days=34)
        for seed in (fetch_lo + timedelta(days=i) for i in range(0, 36)):
            if seed > today:
                break
            _maybe_seed_vendon_revenue_cache(seed)

        db = _pa_session()
        try:
            cache_rows = (
                db.query(VendonDailyMachineRevenueCache)
                .filter(
                    VendonDailyMachineRevenueCache.machine_id == mid,
                    VendonDailyMachineRevenueCache.cache_date >= fetch_lo,
                    VendonDailyMachineRevenueCache.cache_date <= today,
                )
                .all()
            )
            kwd_by_day: Dict[date, float] = {}
            for r in cache_rows:
                if r.cache_date is None:
                    continue
                kwd_by_day[r.cache_date] = float(r.total_sales_kwd or 0)
            elapsed_payload = _load_daily_sales_elapsed_db_cache()
            by_e = (elapsed_payload or {}).get("byMachineId") or {}
            ent = by_e.get(mid) if isinstance(by_e, dict) else None
            if isinstance(ent, dict) and ent.get("todayKwd") is not None:
                kwd_by_day[today] = float(ent["todayKwd"])

            from alert_targets_lib import (
                build_location_sales_insights,
                build_product_cups_insights,
                products_from_lmc_row,
            )
            location = build_location_sales_insights(kwd_by_day, today=today)

            dash = _dash_session()
            try:
                lmc = dash.query(LiveMachineConfig).filter(LiveMachineConfig.machine_id == mid).first()
                promoted = products_from_lmc_row(lmc) if lmc else []
            finally:
                dash.close()

            names = want_products or [p["productName"] for p in promoted if p.get("productName")]
            if not names:
                # light fallback: reuse vendon-products cache if warm
                vp = _alert_cache_get(f"perf:vendon-products:v2:{mid}:21", 300) or {}
                names = [x.get("name") for x in (vp.get("products") or [])[:5] if x.get("name")]

            # One Vendon window for the lookback — bucket cups by product×day (fast + cacheable)
            from promo_lib import _product_matches

            cups_maps: Dict[str, Dict[date, float]] = {n: {} for n in names[:8]}
            try:
                from_ts, _ = _kuwait_day_bounds_utc(fetch_lo.isoformat())
                _, to_ts = _kuwait_day_bounds_utc(today.isoformat())
            except Exception:
                from_ts = to_ts = 0
            if from_ts and to_ts and cups_maps:
                vends, _verr = _fetch_vends_machine_day(mid, from_ts, to_ts)
                for v in vends or []:
                    if not isinstance(v, dict):
                        continue
                    matched = None
                    for want in cups_maps.keys():
                        if _product_matches(v, want):
                            matched = want
                            break
                    if not matched:
                        continue
                    ts = v.get("timestamp") or v.get("time") or v.get("created_at")
                    try:
                        if isinstance(ts, (int, float)):
                            vd = datetime.fromtimestamp(int(ts), tz=timezone.utc).astimezone(tz).date()
                        else:
                            continue
                    except Exception:
                        continue
                    if vd < fetch_lo or vd > today:
                        continue
                    cups_maps[matched][vd] = float(cups_maps[matched].get(vd) or 0) + 1.0

            product_insights: List[Dict[str, Any]] = [
                build_product_cups_insights(cups_maps.get(pname) or {}, today=today, product_name=pname)
                for pname in cups_maps.keys()
            ]

            body = {
                "machineId": mid,
                "asOf": now_local.replace(microsecond=0).isoformat(),
                "cachedTtlSec": 300,
                "location": location,
                "products": product_insights,
            }
            _alert_cache_set(cache_key, body)
            return jsonify(body)
        except Exception as ex:
            logger.exception("alert_admin_target_insights")
            return jsonify({"error": str(ex)}), 500
        finally:
            db.close()

    @app.route("/api/alert/overall/admin-profiles", methods=["GET", "OPTIONS"])
    def alert_overall_admin_profiles():
        """
        Read-only subset of Admin machine profiles for the Overall sheet.
        Requires only Alert read access (leetAlert or redAlert).
        """
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied

        db = _dash_session()
        try:
            rows = db.query(AlertMachineProfile).all()
            out: List[Dict[str, Any]] = []
            from alert_inactive_lib import machine_inactive_on

            for r in rows:
                op0 = None
                if isinstance(r.operator_hours, list) and r.operator_hours:
                    first = r.operator_hours[0]
                    if isinstance(first, dict):
                        op0 = (first.get("name") or "").strip() or None
                is_active_val = bool(getattr(r, "is_active", True))
                inactive_sched = getattr(r, "inactive_schedule", None) or {}
                inactive_now = machine_inactive_on(
                    is_active=is_active_val,
                    inactive_schedule=inactive_sched,
                )
                out.append(
                    {
                        "machine_id": r.machine_id,
                        "machine_name": r.machine_name,
                        "location_owner": r.location_owner,
                        "location_hours": r.location_hours,
                        "operator_name": op0,
                        "timezone": r.timezone,
                        "operating_days": r.operating_days,
                        "cleaning_windows": r.cleaning_windows,
                        "operator_hours": r.operator_hours,
                        "technician_schedule": r.technician_schedule,
                        "qa_schedule": r.qa_schedule,
                        "is_active": is_active_val,
                        "inactive_schedule": inactive_sched,
                        "inactiveToday": bool(inactive_now.get("inactive")),
                        "inactiveLabel": inactive_now.get("label") or None,
                        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
                    }
                )
            return jsonify({"rows": out})
        except Exception as ex:
            logger.exception("alert overall admin profiles")
            return jsonify({"error": "failed", "message": str(ex)}), 500
        finally:
            db.close()

    @app.route("/api/alert/overall/last-transactions", methods=["GET", "OPTIONS"])
    def alert_overall_last_transactions():
        """
        Vendon-backed last transaction per machine (last 7d window).
        Used as a fallback when the Red Alert snapshot has no ISO timestamp.
        """
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        now = int(datetime.now(timezone.utc).timestamp())
        week_ago = now - 7 * 24 * 60 * 60
        params: Dict[str, Any] = {
            "from_timestamp": week_ago,
            "to_timestamp": now,
            "limit": 5000,
            "offset": 0,
        }
        data, err = _vendon_get("/stats/vends", params)
        if err:
            return jsonify({"error": err, "byMachineId": {}}), 502
        raw = data.get("result") if isinstance(data, dict) else None
        raw = raw if isinstance(raw, list) else []

        latest: Dict[str, Dict[str, Any]] = {}
        for trx in raw:
            if not isinstance(trx, dict):
                continue
            mid_raw = trx.get("machine_id")
            if mid_raw is None:
                continue
            mid = str(mid_raw).strip()
            if not mid:
                continue
            ts_raw = trx.get("datetime") or trx.get("timestamp") or 0
            try:
                ts_i = int(ts_raw) if ts_raw is not None else 0
            except Exception:
                ts_i = 0
            if ts_i <= 0:
                continue
            prev = latest.get(mid)
            prev_ts = int(prev.get("timestamp") or 0) if isinstance(prev, dict) else 0
            if prev is None or ts_i > prev_ts:
                latest[mid] = {
                    "timestamp": ts_i,
                    "machine_name": trx.get("machine_name"),
                    "product_name": trx.get("name") or trx.get("product_name"),
                    "amount": trx.get("price") or 0,
                }

        return jsonify({"byMachineId": latest, "fromTimestamp": week_ago, "toTimestamp": now})

    @app.route("/api/alert/overall/daily-sales-elapsed", methods=["GET", "OPTIONS"])
    def alert_overall_daily_sales_elapsed():
        """
        Kuwait calendar **today so far** vs **yesterday until the same clock time** (when the request runs).

        Uses Vendon /stats/vends — fair intraday comparison for the Overall **Sales** column.
        """
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied

        tz = ZoneInfo("Asia/Kuwait")
        now_local = datetime.now(tz)
        cache_bucket = now_local.replace(second=0, microsecond=0).isoformat()
        cache_key = f"sales-elapsed:v3:{cache_bucket}"
        force_fresh = (request.args.get("fresh") or "").strip().lower() in ("1", "true", "yes")
        cached = _alert_cache_get(cache_key, _DAILY_SALES_ELAPSED_CACHE_SEC)
        if cached is not None and not force_fresh:
            return jsonify(cached)

        db_cached = _load_daily_sales_elapsed_db_cache()
        db_stale = db_cached is not None and _daily_sales_cache_is_stale(db_cached, cache_bucket)

        if force_fresh or db_cached is None or db_stale:
            payload, err_status = _refresh_daily_sales_elapsed_cache_internal(now_local)
            if err_status:
                return err_status
            _alert_cache_set(cache_key, payload)
            return jsonify(payload)

        _alert_cache_set(cache_key, db_cached)
        return jsonify(db_cached)

    @app.route("/api/alert/red-flags/daily-incidents-elapsed", methods=["GET", "OPTIONS"])
    def alert_red_flags_daily_incidents_elapsed():
        """
        Kuwait calendar **today so far** vs **yesterday / prior days** until the same clock time.

        Combined Red Alert criteria hits (stale sale + OFF + vend fail) for trend history popups.
        Optional ``machines=id1,id2`` limits scope (max 400 ids).
        """
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied

        tz = ZoneInfo("Asia/Kuwait")
        now_local = datetime.now(tz)
        cache_bucket = now_local.replace(second=0, microsecond=0).isoformat()
        raw_ids = (request.args.get("machines") or "").strip()
        requested = [x.strip() for x in raw_ids.split(",") if x.strip()]
        if len(requested) > 400:
            requested = requested[:400]
        cache_key = f"incidents-elapsed:{cache_bucket}:{','.join(sorted(requested))}"
        cached = _alert_cache_get(cache_key, _DAILY_INCIDENTS_ELAPSED_CACHE_SEC)
        if cached is not None:
            return jsonify(cached)

        try:
            payload = compute_daily_incidents_elapsed(
                machine_ids=requested if requested else None,
            )
        except Exception as ex:
            logger.exception("alert_red_flags_daily_incidents_elapsed")
            return (
                jsonify(
                    {
                        "error": str(ex),
                        "timezone": "Asia/Kuwait",
                        "today": now_local.date().isoformat(),
                        "asOfLocal": now_local.strftime("%Y-%m-%dT%H:%M:%S"),
                        "byMachineId": {},
                    }
                ),
                502,
            )

        if payload.get("error"):
            return (
                jsonify(
                    {
                        "error": payload.get("error"),
                        "timezone": "Asia/Kuwait",
                        "today": now_local.date().isoformat(),
                        "asOfLocal": now_local.strftime("%Y-%m-%dT%H:%M:%S"),
                        "byMachineId": {},
                    }
                ),
                502,
            )

        _alert_cache_set(cache_key, payload)
        return jsonify(payload)

    def _kuwait_week_start_sunday(d: date) -> date:
        return d - timedelta(days=(d.weekday() + 1) % 7)

    def _parse_iso_date(s: Optional[str]) -> Optional[date]:
        if not s:
            return None
        try:
            return datetime.strptime(str(s)[:10], "%Y-%m-%d").date()
        except ValueError:
            return None

    def _alert_preset_periods(
        preset: str,
        today: date,
        a_start: Optional[str] = None,
        a_end: Optional[str] = None,
        b_start: Optional[str] = None,
        b_end: Optional[str] = None,
    ) -> Tuple[Tuple[date, date], Tuple[date, date], str, str]:
        """Half-open [start, end) calendar ranges for period A vs B + short labels."""
        y = today - timedelta(days=1)
        db = today - timedelta(days=2)
        lw = today - timedelta(days=7)

        def day_range(d0: date) -> Tuple[date, date]:
            return d0, d0 + timedelta(days=1)

        if preset == "yesterday_vs_day_before":
            return day_range(y), day_range(db), "Yest.", "−2d"
        if preset == "today_vs_same_day_last_week":
            return day_range(today), day_range(lw), "Today", "LW"
        if preset == "wtd_vs_last_week":
            ws = _kuwait_week_start_sunday(today)
            elapsed = (today - ws).days + 1
            last_ws = ws - timedelta(days=7)
            last_end = last_ws + timedelta(days=elapsed)
            return (ws, today + timedelta(days=1)), (last_ws, last_end), "WTD", "Last WTD"
        if preset == "mtd_vs_mtd":
            m0 = date(today.year, today.month, 1)
            if today.month == 1:
                prev_m0 = date(today.year - 1, 12, 1)
            else:
                prev_m0 = date(today.year, today.month - 1, 1)
            import calendar

            prev_last = calendar.monthrange(prev_m0.year, prev_m0.month)[1]
            prev_end = date(prev_m0.year, prev_m0.month, min(today.day, prev_last))
            return (m0, today + timedelta(days=1)), (prev_m0, prev_end + timedelta(days=1)), "MTD", "Last MTD"
        if preset == "mtd_vs_yoy":
            import calendar

            m0 = date(today.year, today.month, 1)
            ly_year = today.year - 1
            ly_m0 = date(ly_year, today.month, 1)
            ly_last = calendar.monthrange(ly_year, today.month)[1]
            ly_end = date(ly_year, today.month, min(today.day, ly_last))
            return (m0, today + timedelta(days=1)), (ly_m0, ly_end + timedelta(days=1)), "MTD", "YoY"
        if preset == "custom_vs_custom":
            a_lo = _parse_iso_date(a_start)
            a_hi = _parse_iso_date(a_end)
            b_lo = _parse_iso_date(b_start)
            b_hi = _parse_iso_date(b_end)
            if a_lo and a_hi and a_lo < a_hi and b_lo and b_hi and b_lo < b_hi:
                return (a_lo, a_hi), (b_lo, b_hi), "Period A", "Period B"
        return day_range(today), day_range(y), "Today", "Yest."

    def _sum_sales_in_range(
        rows: List[VendonDailyMachineRevenueCache],
        start_incl: date,
        end_excl: date,
    ) -> Tuple[float, int, Optional[Dict[str, Any]]]:
        sales = 0.0
        tx = 0
        latest_payload: Optional[Dict[str, Any]] = None
        latest_day: Optional[date] = None
        for r in rows:
            cd = r.cache_date
            if cd is None or cd < start_incl or cd >= end_excl:
                continue
            sales += float(r.total_sales_kwd or 0)
            tx += int(r.total_transactions or 0)
            if latest_day is None or cd > latest_day:
                latest_day = cd
                latest_payload = r.payload_json if isinstance(r.payload_json, dict) else None
        return sales, tx, latest_payload

    def _aggregate_product_counts_in_range(
        rows: List[VendonDailyMachineRevenueCache],
        start_incl: date,
        end_excl: date,
    ) -> Dict[str, int]:
        totals: Dict[str, int] = {}
        for r in rows:
            cd = r.cache_date
            if cd is None or cd < start_incl or cd >= end_excl:
                continue
            payload = r.payload_json if isinstance(r.payload_json, dict) else {}
            pc = payload.get("productCounts") if isinstance(payload.get("productCounts"), dict) else None
            if not pc:
                # Legacy cache: fold single top/low into the mix.
                for key in ("topProduct", "lowProduct"):
                    item = payload.get(key)
                    if isinstance(item, dict) and item.get("name"):
                        name = str(item.get("name") or "").strip()
                        if not name:
                            continue
                        try:
                            c = int(item.get("count") or 0)
                        except (TypeError, ValueError):
                            c = 0
                        if c > 0:
                            totals[name] = max(int(totals.get(name) or 0), c)
                continue
            for name_raw, cnt_raw in pc.items():
                name = str(name_raw or "").strip()
                if not name:
                    continue
                try:
                    c = int(cnt_raw or 0)
                except (TypeError, ValueError):
                    c = 0
                if c <= 0:
                    continue
                totals[name] = int(totals.get(name) or 0) + c
        return totals

    def _product_extremes_from_counts(counts: Dict[str, int], *, n: int = 5) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        if not counts:
            return [], []
        ordered = sorted(counts.items(), key=lambda kv: (-int(kv[1]), str(kv[0]).lower()))
        ordered_low = sorted(counts.items(), key=lambda kv: (int(kv[1]), str(kv[0]).lower()))
        top = [{"name": name, "count": int(c)} for name, c in ordered[:n]]
        low = [{"name": name, "count": int(c)} for name, c in ordered_low[:n]]
        return top, low

    @app.route("/api/alert/overall/vendon-sales-summary", methods=["GET", "OPTIONS"])
    def alert_overall_vendon_sales_summary():
        """
        Per-machine sales / tx + product/peak-hour helpers from VendonDailyMachineRevenueCache.
        This is used by the Alert Overall board to fill fields that can be sourced reliably.
        """
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied

        preset = (request.args.get("preset") or "today_vs_yesterday").strip()
        tz = ZoneInfo("Asia/Kuwait")
        today_kw = datetime.now(tz).date()

        (a_lo, a_hi), (b_lo, b_hi), label_a, label_b = _alert_preset_periods(
            preset,
            today_kw,
            request.args.get("aStart"),
            request.args.get("aEnd"),
            request.args.get("bStart"),
            request.args.get("bEnd"),
        )

        fetch_lo = min(a_lo, b_lo)
        fetch_hi = max(a_hi, b_hi)

        b_period_days: set[date] = set()
        cur = b_lo
        while cur < b_hi:
            b_period_days.add(cur)
            cur += timedelta(days=1)

        a_period_days: set[date] = set()
        cur = a_lo
        while cur < a_hi:
            a_period_days.add(cur)
            cur += timedelta(days=1)

        seed_days = a_period_days | b_period_days
        recent_cutoff = today_kw - timedelta(days=62)
        for d in sorted(seed_days):
            # YoY baseline is same calendar month last year — outside the 62-day warm window.
            needs_yoy_baseline = preset == "mtd_vs_yoy" and d in b_period_days
            if needs_yoy_baseline or d >= recent_cutoff:
                _maybe_seed_vendon_revenue_cache(d)

        fleet_rows, fleet_err = vendon_fetch_machine_list(_vendon_get)
        fleet_ids: List[str] = []
        if not fleet_err and fleet_rows:
            for m in fleet_rows:
                if m.get("id") is None:
                    continue
                mid = str(m.get("id")).strip()
                mname = m.get("name") or mid
                if not mid or machine_row_excluded(str(mname), mid):
                    continue
                fleet_ids.append(mid)

        db = _pa_session()
        try:
            cache_rows = (
                db.query(VendonDailyMachineRevenueCache)
                .filter(
                    VendonDailyMachineRevenueCache.cache_date >= fetch_lo,
                    VendonDailyMachineRevenueCache.cache_date < fetch_hi,
                )
                .all()
            )

            by_machine_rows: Dict[str, List[VendonDailyMachineRevenueCache]] = {}
            for r in cache_rows:
                mid = (r.machine_id or "").strip()
                if not mid:
                    continue
                by_machine_rows.setdefault(mid, []).append(r)
            for mid in fleet_ids:
                by_machine_rows.setdefault(mid, [])

            out: Dict[str, Any] = {
                "preset": preset,
                "dateAStart": a_lo.isoformat(),
                "dateAEnd": a_hi.isoformat(),
                "dateBStart": b_lo.isoformat(),
                "dateBEnd": b_hi.isoformat(),
                "labelA": label_a,
                "labelB": label_b,
                "byMachineId": {},
            }
            for mid, rows in by_machine_rows.items():
                a_sales, a_tx, a_payload = _sum_sales_in_range(rows, a_lo, a_hi)
                b_sales, b_tx, b_payload = _sum_sales_in_range(rows, b_lo, b_hi)
                trend_pct = None
                if b_sales > 0:
                    trend_pct = ((a_sales - b_sales) / b_sales) * 100.0
                payload = a_payload or {}
                peak_hour = payload.get("peakHour")
                peak_hour_from_yesterday = False
                if not peak_hour and isinstance(b_payload, dict):
                    y_ph = b_payload.get("peakHour") if isinstance(b_payload, dict) else None
                    if isinstance(y_ph, dict) and y_ph.get("label"):
                        peak_hour = {**y_ph, "label": f"{y_ph.get('label')} yest."}
                        peak_hour_from_yesterday = True
                a_counts = _aggregate_product_counts_in_range(rows, a_lo, a_hi)
                top_products, low_products = _product_extremes_from_counts(a_counts, n=5)
                if not top_products:
                    # Prefer lists from latest day payload; else single top/low.
                    raw_top = payload.get("topProducts") if isinstance(payload.get("topProducts"), list) else None
                    raw_low = payload.get("lowProducts") if isinstance(payload.get("lowProducts"), list) else None
                    if raw_top:
                        top_products = [
                            {"name": str(x.get("name") or "").strip(), "count": int(x.get("count") or 0)}
                            for x in raw_top
                            if isinstance(x, dict) and str(x.get("name") or "").strip()
                        ][:5]
                    elif isinstance(payload.get("topProduct"), dict) and payload["topProduct"].get("name"):
                        top_products = [
                            {
                                "name": str(payload["topProduct"].get("name")),
                                "count": int(payload["topProduct"].get("count") or 0),
                            }
                        ]
                    if raw_low:
                        low_products = [
                            {"name": str(x.get("name") or "").strip(), "count": int(x.get("count") or 0)}
                            for x in raw_low
                            if isinstance(x, dict) and str(x.get("name") or "").strip()
                        ][:5]
                    elif isinstance(payload.get("lowProduct"), dict) and payload["lowProduct"].get("name"):
                        low_products = [
                            {
                                "name": str(payload["lowProduct"].get("name")),
                                "count": int(payload["lowProduct"].get("count") or 0),
                            }
                        ]

                out["byMachineId"][mid] = {
                    "aSalesKwd": round(a_sales, 4),
                    "bSalesKwd": round(b_sales, 4),
                    "aTx": a_tx,
                    "bTx": b_tx,
                    "trendPct": round(trend_pct, 2) if trend_pct is not None else None,
                    "peakHour": peak_hour,
                    "peakHourFromYesterday": peak_hour_from_yesterday,
                    "topProduct": payload.get("topProduct")
                    or (top_products[0] if top_products else None),
                    "lowProduct": payload.get("lowProduct")
                    or (low_products[0] if low_products else None),
                    "topProducts": top_products,
                    "lowProducts": low_products,
                }

            return jsonify(out)
        except Exception as ex:
            logger.exception("alert overall vendon sales summary")
            return jsonify({"error": "failed", "message": str(ex)}), 500
        finally:
            db.close()

    @app.route("/api/alert/overall/downtime-summary", methods=["GET", "OPTIONS"])
    def alert_overall_downtime_summary():
        """
        Per-machine operational downtime (Today + compare baseline period B).

        Default preset today_vs_yesterday → boxes Today | Yest. (not Today | Today).
        Sums Vendon Machine OFF / KNet OFF / Vendon OFF overlap; overlapping OFF types
        are merged. Cleaning windows subtracted (same operational-time math as Red Alert).
        """
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied

        preset = (request.args.get("preset") or "today_vs_yesterday").strip()
        tz = ZoneInfo("Asia/Kuwait")
        today_kw = datetime.now(tz).date()
        _a, (b_lo, b_hi), _label_a, label_b = _alert_preset_periods(
            preset,
            today_kw,
            request.args.get("aStart"),
            request.args.get("aEnd"),
            request.args.get("bStart"),
            request.args.get("bEnd"),
        )

        cache_key = (
            f"alert-downtime:v4:{preset}:{b_lo.isoformat()}:{b_hi.isoformat()}:"
            f"{request.args.get('bStart') or ''}:{request.args.get('bEnd') or ''}"
        )
        cached = _alert_cache_get(cache_key, _ALERT_DOWNTIME_CACHE_SEC)
        if cached is not None:
            return jsonify(cached)

        try:
            from red_alert_routes import _fetch_events_window

            payload = compute_machine_downtime_summary(
                period_lo=b_lo,
                period_hi_excl=b_hi,
                period_label=label_b,
                vendon_get=_vendon_get,
                fetch_events_window=_fetch_events_window,
            )
            payload["preset"] = preset
            _alert_cache_set(cache_key, payload)
            return jsonify(payload)
        except Exception as ex:
            logger.exception("alert overall downtime summary")
            return jsonify({"ok": False, "error": "failed", "message": str(ex), "byMachineId": {}}), 500

    @app.route("/api/alert/overall/downtime-detail", methods=["GET", "OPTIONS"])
    def alert_overall_downtime_detail():
        """
        Per-machine OFF events for Kuwait today + projected revenue loss.

        Query: machine_id (required), machine_name (optional), spoilage_kwd (optional override).
        Primary: baseline hourly KD × downtime hours × peak multiplier (+ spoilage).
        Spoilage default: Monitor waste for Kuwait today (motion area-overrides − Vendon sales)
        converted to KD as waste cups × avg vend price. Same source as Overall Waste % column.
        """
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied

        mid = (request.args.get("machine_id") or request.args.get("machineId") or "").strip()
        mname = (request.args.get("machine_name") or request.args.get("machineName") or "").strip()
        if not mid:
            return jsonify({"ok": False, "error": "machine_id required", "events": []}), 400

        spoilage_explicit = False
        spoilage_kwd = 0.0
        raw_spoil = request.args.get("spoilage_kwd")
        if raw_spoil is None:
            raw_spoil = request.args.get("spoilageKwd")
        if raw_spoil is not None and str(raw_spoil).strip() != "":
            try:
                spoilage_kwd = max(0.0, float(raw_spoil))
                spoilage_explicit = True
            except (TypeError, ValueError):
                spoilage_kwd = 0.0
                spoilage_explicit = False

        tz = ZoneInfo("Asia/Kuwait")
        now_local = datetime.now(tz)
        today = now_local.date()

        # Auto spoilage from Monitor waste (motion refills − Vendon sales) × avg vend KD.
        waste_meta: Dict[str, Any] = {}
        avg_vend_from_waste: Optional[float] = None
        if not spoilage_explicit:
            if not MOTION_AREA_OVERRIDES_API_KEY:
                waste_meta = {
                    "skipped": True,
                    "reason": "MOTION_AREA_OVERRIDES_API_KEY not configured (same source as Monitor waste tab)",
                }
            else:
                try:
                    _pct, werr, wmeta = _waste_metrics_v1(mid, today.isoformat())
                    waste_meta = dict(wmeta or {})
                    if werr:
                        waste_meta["error"] = werr
                    if _pct is not None:
                        waste_meta["wastePct"] = round(float(_pct), 2)
                    est = waste_meta.get("estimatedWasteKwd")
                    if est is not None:
                        try:
                            spoilage_kwd = max(0.0, float(est))
                        except (TypeError, ValueError):
                            spoilage_kwd = 0.0
                    if waste_meta.get("avgVendKwd") is not None:
                        try:
                            avg_vend_from_waste = float(waste_meta["avgVendKwd"])
                        except (TypeError, ValueError):
                            avg_vend_from_waste = None
                except Exception as ex:
                    logger.exception("downtime-detail waste for %s", mid)
                    waste_meta = {"error": str(ex)}

        def _elapsed_sec_for_day(d: date) -> int:
            ws = int(datetime.combine(d, dt_time.min, tzinfo=tz).timestamp())
            we = int(_kuwait_elapsed_window_end(d, now_local).timestamp())
            return max(0, we - ws)

        sales_baselines: List[Dict[str, Any]] = []
        baseline_hourly: Optional[float] = None
        try:
            elapsed_payload = _load_daily_sales_elapsed_db_cache() or {}
            row = (elapsed_payload.get("byMachineId") or {}).get(mid) or {}
            daily = row.get("dailyElapsed") if isinstance(row.get("dailyElapsed"), list) else []

            def _day_kwd(i: int) -> Optional[float]:
                if i == 1 and row.get("yesterdaySameElapsedKwd") is not None:
                    try:
                        return float(row.get("yesterdaySameElapsedKwd"))
                    except (TypeError, ValueError):
                        pass
                if i < len(daily) and isinstance(daily[i], dict):
                    try:
                        return float(daily[i].get("kwd"))
                    except (TypeError, ValueError):
                        return None
                return None

            candidates = [
                (1, "yesterday", "Yesterday", True),
                (2, "day_before", "Day before", False),
                (7, "same_weekday_last_week", "Same weekday last week", False),
            ]
            for idx, bid, label, primary in candidates:
                d = today - timedelta(days=idx)
                kwd = _day_kwd(idx)
                if kwd is None and idx < len(daily) and isinstance(daily[idx], dict):
                    try:
                        kwd = float(daily[idx].get("kwd"))
                    except (TypeError, ValueError):
                        kwd = None
                sales_baselines.append(
                    {
                        "id": bid,
                        "label": label,
                        "date": d.isoformat(),
                        "kwd": kwd,
                        "elapsedSec": _elapsed_sec_for_day(d),
                        "primary": primary,
                    }
                )

            # Prefer yesterday only when it has real sales; a 0 KD day must not
            # become 0 KD/h (that zeroes the whole projected-loss calculator).
            y_kwd = _day_kwd(1)
            y_el = _elapsed_sec_for_day(today - timedelta(days=1))
            if y_kwd is not None and float(y_kwd) > 0.005 and y_el > 0:
                baseline_hourly = float(y_kwd) / (float(y_el) / 3600.0)
            else:
                sum_kwd = 0.0
                sum_hours = 0.0
                for i in range(1, 8):
                    k = _day_kwd(i)
                    el = _elapsed_sec_for_day(today - timedelta(days=i))
                    if k is None or float(k) <= 0.005 or el <= 0:
                        continue
                    sum_kwd += float(k)
                    sum_hours += float(el) / 3600.0
                if sum_hours > 0 and sum_kwd > 0:
                    baseline_hourly = sum_kwd / sum_hours

            # Last resort: live same-elapsed window sales for yesterday / day before.
            if baseline_hourly is None or baseline_hourly <= 0.005:
                for days_back in (1, 2, 7):
                    d = today - timedelta(days=days_back)
                    ws = int(datetime.combine(d, dt_time.min, tzinfo=tz).timestamp())
                    we = int(_kuwait_elapsed_window_end(d, now_local).timestamp())
                    if we <= ws:
                        continue
                    try:
                        kwd, _trunc = _machine_window_sales_kwd(mid, ws, we)
                    except Exception:
                        logger.exception("downtime-detail live baseline sales %s day-%s", mid, days_back)
                        continue
                    hours = (we - ws) / 3600.0
                    if kwd is not None and float(kwd) > 0.005 and hours > 0:
                        baseline_hourly = float(kwd) / hours
                        # Keep baselines list consistent when cache had null/0.
                        for b in sales_baselines:
                            if b.get("id") == ("yesterday" if days_back == 1 else "day_before" if days_back == 2 else "same_weekday_last_week"):
                                if b.get("kwd") is None or float(b.get("kwd") or 0) <= 0.005:
                                    b["kwd"] = round(float(kwd), 4)
                        break
        except Exception:
            logger.exception("downtime-detail sales baselines for %s", mid)

        def _window_sales(machine_id: str, ws: int, we: int) -> float:
            kwd, _trunc = _machine_window_sales_kwd(machine_id, ws, we)
            return float(kwd)

        try:
            from alert_downtime_lib import compute_machine_downtime_detail
            from red_alert_routes import _fetch_events_window

            payload = compute_machine_downtime_detail(
                mid,
                mname or None,
                vendon_get=_vendon_get,
                fetch_events_window=_fetch_events_window,
                sales_baselines=sales_baselines,
                fetch_window_sales=_window_sales,
                baseline_hourly_kwd=baseline_hourly,
                avg_vend_kwd=avg_vend_from_waste,
                spoilage_kwd=spoilage_kwd,
            )
            payload["spoilageSource"] = (
                "explicit_query"
                if spoilage_explicit
                else ("monitor_waste" if waste_meta and not waste_meta.get("skipped") else "none")
            )
            payload["spoilageExplicit"] = spoilage_explicit
            payload["waste"] = waste_meta
            return jsonify(payload)
        except Exception as ex:
            logger.exception("alert overall downtime detail")
            return jsonify({"ok": False, "error": "failed", "message": str(ex), "events": []}), 500

    @app.route("/api/alert/overall/sales-acceleration", methods=["GET", "OPTIONS"])
    def alert_overall_sales_acceleration():
        """
        Sales Acceleration (SX) per machine — location KD on the fleet table.
        Optional includeProducts=1 with machines=… returns every Admin promoted product
        (cups SX) for the detail popup. SX = G_current − G_previous where G = (cur − prev) / prev.
        """
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied

        from alert_sx_lib import compute_fleet_sx
        from week_revenue_target_lib import daily_target_kd_from_week

        preset = (request.args.get("preset") or "today_vs_yesterday").strip()
        tz = ZoneInfo("Asia/Kuwait")
        now_local = datetime.now(tz)
        today = now_local.date()
        (a_lo, a_hi), (b_lo, b_hi), label_a, label_b = _alert_preset_periods(
            preset,
            today,
            request.args.get("aStart"),
            request.args.get("aEnd"),
            request.args.get("bStart"),
            request.args.get("bEnd"),
        )
        elapsed_for_today = preset in ("today_vs_yesterday", "today_vs_same_day_last_week")

        fleet_rows, fleet_err = vendon_fetch_machine_list(_vendon_get)
        if fleet_err:
            return jsonify({"error": fleet_err, "byMachineId": {}}), 502

        machine_ids: List[str] = []
        machine_names: Dict[str, str] = {}
        for m in fleet_rows:
            if m.get("id") is None:
                continue
            mid = str(m["id"])
            mname = str(m.get("name") or mid).strip()
            if not mname or machine_row_excluded(mname, mid):
                continue
            machine_ids.append(mid)
            machine_names[mid] = mname

        scope = (request.args.get("machines") or "").strip()
        if scope:
            want = {x.strip() for x in scope.split(",") if x.strip()}
            machine_ids = [m for m in machine_ids if m in want]

        include_products = str(request.args.get("includeProducts") or request.args.get("include_products") or "").strip().lower() in (
            "1",
            "true",
            "yes",
        )
        # Product SX is for the detail popup only (can be many promoted SKUs). Fleet table is Loc KD.
        if include_products and not scope:
            # Avoid scanning every machine's product cups unless explicitly scoped.
            include_products = False

        dash = _dash_session()
        try:
            from alert_targets_lib import products_from_lmc_row

            cfg_by_mid: Dict[str, Dict[str, Any]] = {}
            for lmc in dash.query(LiveMachineConfig).all():
                mid = str(lmc.machine_id)
                products = products_from_lmc_row(lmc)
                cfg_by_mid[mid] = {
                    "daily_sales_target": (
                        float(lmc.daily_sales_target) if lmc.daily_sales_target is not None else None
                    ),
                    "sx_product_name": (lmc.sx_product_name or None),
                    "daily_product_target": (
                        float(lmc.daily_product_target) if lmc.daily_product_target is not None else None
                    ),
                    "promoted_products": products,
                }
            for r in dash.query(AlertMachineProfile).all():
                mid = str(r.machine_id)
                cfg_by_mid.setdefault(mid, {})
                cfg_by_mid[mid]["location_owner"] = r.location_owner
        finally:
            dash.close()

        from alert_sx_lib import third_period

        c_lo, c_hi = third_period(a_lo, a_hi, b_lo, b_hi)
        fetch_lo = min(a_lo, b_lo, c_lo)
        fetch_hi = max(a_hi, b_hi, c_hi)

        # Seed completed-day revenue cache for Loc KD (same pattern as vendon-sales-summary).
        seed_day = fetch_lo
        while seed_day < fetch_hi:
            if seed_day < today:
                _maybe_seed_vendon_revenue_cache(seed_day)
            seed_day += timedelta(days=1)

        db = _pa_session()
        try:
            cache_rows = (
                db.query(VendonDailyMachineRevenueCache)
                .filter(
                    VendonDailyMachineRevenueCache.cache_date >= fetch_lo,
                    VendonDailyMachineRevenueCache.cache_date < fetch_hi,
                )
                .all()
            )
            kwd_by_mid_day: Dict[str, Dict[date, float]] = {}
            for r in cache_rows:
                mid = str(r.machine_id or "").strip()
                if not mid or r.cache_date is None:
                    continue
                kwd_by_mid_day.setdefault(mid, {})[r.cache_date] = float(r.total_sales_kwd or 0)

            # Overlay elapsed KD for today/yesterday when using today-based presets
            if elapsed_for_today:
                elapsed_payload = _load_daily_sales_elapsed_db_cache()
                by_e = (elapsed_payload or {}).get("byMachineId") or {}
                for mid in machine_ids:
                    ent = by_e.get(mid) if isinstance(by_e, dict) else None
                    if not isinstance(ent, dict):
                        continue
                    days_map = kwd_by_mid_day.setdefault(mid, {})
                    if ent.get("todayKwd") is not None:
                        days_map[today] = float(ent["todayKwd"])
                    y = today - timedelta(days=1)
                    if ent.get("yesterdaySameElapsedKwd") is not None:
                        days_map[y] = float(ent["yesterdaySameElapsedKwd"])
                    daily = ent.get("dailyElapsed") or []
                    if isinstance(daily, list):
                        for i, row in enumerate(daily):
                            if not isinstance(row, dict) or row.get("kwd") is None:
                                continue
                            try:
                                d = date.fromisoformat(str(row.get("date") or ""))
                            except Exception:
                                continue
                            if i >= 2:
                                days_map[d] = float(row["kwd"])

            def _fetch_vends(from_ts: int, to_ts: int, mid: str):
                return _fetch_vends_machine_day(mid, from_ts, to_ts)

            def _fallback_target(mname: str, owner: Optional[str]) -> Optional[float]:
                try:
                    return daily_target_kd_from_week(mname, owner)
                except Exception:
                    return None

            out = compute_fleet_sx(
                machine_ids=machine_ids,
                machine_names=machine_names,
                cfg_by_mid=cfg_by_mid,
                kwd_by_mid_day=kwd_by_mid_day,
                a_lo=a_lo,
                a_hi=a_hi,
                b_lo=b_lo,
                b_hi=b_hi,
                label_a=label_a,
                label_b=label_b,
                today=today,
                now_local=now_local,
                elapsed_for_today=elapsed_for_today,
                fetch_vends_fn=_fetch_vends if include_products else None,
                daily_target_fallback_fn=_fallback_target,
                include_products=include_products,
            )
            out["preset"] = preset
            return jsonify(out)
        except Exception as ex:
            logger.exception("alert overall sales acceleration")
            return jsonify({"error": "failed", "message": str(ex)}), 500
        finally:
            db.close()

    @app.route("/api/alert/performance/machine-products", methods=["GET", "OPTIONS"])
    def alert_performance_machine_products():
        """
        Per-machine product mix for Performance / Red Flags popups.

        Query: machineId (required), machineName (optional).
        Returns day / week / month grains with cups, vs prior period, vs same dates last year,
        top5 / lowest5 names, and YoY top5 comparison.
        """
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied

        mid = (request.args.get("machineId") or request.args.get("machine_id") or "").strip()
        mname = (request.args.get("machineName") or request.args.get("machine_name") or "").strip()
        if not mid:
            return jsonify({"error": "machineId required"}), 400

        cache_key = f"perf:machine-products:v1:{mid}"
        cached = _alert_cache_get(cache_key, 120)
        if cached is not None:
            return jsonify(cached)

        from alert_targets_lib import resolve_perf_window

        tz = ZoneInfo("Asia/Kuwait")
        now_local = datetime.now(tz)
        today = now_local.date()

        def _grain_windows(grain: str) -> Tuple[date, date, date, date, date, date, str]:
            """current start/end, prev start/end, yoy start/end, label."""
            if grain == "day":
                cur_s = cur_e = today
                prev_s = prev_e = today - timedelta(days=1)
                try:
                    yoy_s = yoy_e = date(today.year - 1, today.month, today.day)
                except ValueError:
                    yoy_s = yoy_e = today - timedelta(days=365)
                return cur_s, cur_e, prev_s, prev_e, yoy_s, yoy_e, "Today"
            preset = "this_week" if grain == "week" else "this_month"
            win_s, win_e, prev_s, prev_e, _pid = resolve_perf_window(
                today=today, preset=preset, history_days=31
            )
            span = (win_e - win_s).days
            try:
                yoy_s = date(win_s.year - 1, win_s.month, win_s.day)
            except ValueError:
                yoy_s = win_s - timedelta(days=365)
            yoy_e = yoy_s + timedelta(days=span)
            label = "This week (WTD)" if grain == "week" else "This month (MTD)"
            return win_s, win_e, prev_s, prev_e, yoy_s, yoy_e, label

        def _trend(cur: float, base: float) -> Optional[float]:
            if base > 0:
                return round(((cur - base) / base) * 100.0, 1)
            if cur > 0:
                return 100.0
            return 0.0

        def _slice_from_counts(
            cur: Dict[str, int],
            prev: Dict[str, int],
            yoy: Dict[str, int],
            *,
            label: str,
            cur_s: date,
            cur_e: date,
            prev_s: date,
            prev_e: date,
            yoy_s: date,
            yoy_e: date,
        ) -> Dict[str, Any]:
            names = set(cur) | set(prev) | set(yoy)
            products = []
            for name in names:
                cups = int(cur.get(name) or 0)
                prev_cups = int(prev.get(name) or 0)
                yoy_cups = int(yoy.get(name) or 0)
                products.append(
                    {
                        "name": name,
                        "cups": cups,
                        "prevCups": prev_cups,
                        "yoyCups": yoy_cups,
                        "trendPct": _trend(float(cups), float(prev_cups)),
                        "yoyTrendPct": _trend(float(cups), float(yoy_cups)),
                    }
                )
            products.sort(key=lambda p: (-int(p["cups"]), str(p["name"]).lower()))
            top5 = [{"name": p["name"], "cups": p["cups"]} for p in products[:5] if p["cups"] > 0]
            lowest_src = [p for p in products if p["cups"] > 0]
            lowest_src.sort(key=lambda p: (int(p["cups"]), str(p["name"]).lower()))
            lowest5 = [{"name": p["name"], "cups": p["cups"]} for p in lowest_src[:5]]
            yoy_ranked = sorted(
                [{"name": n, "cups": int(c)} for n, c in yoy.items() if int(c) > 0],
                key=lambda p: (-int(p["cups"]), str(p["name"]).lower()),
            )[:5]
            yoy_compare = []
            for p in top5:
                yoy_cups = int(yoy.get(p["name"]) or 0)
                yoy_compare.append(
                    {
                        "name": p["name"],
                        "cups": p["cups"],
                        "yoyCups": yoy_cups,
                        "yoyTrendPct": _trend(float(p["cups"]), float(yoy_cups)),
                    }
                )
            return {
                "label": label,
                "window": {
                    "start": cur_s.isoformat(),
                    "end": cur_e.isoformat(),
                    "prevStart": prev_s.isoformat(),
                    "prevEnd": prev_e.isoformat(),
                    "yoyStart": yoy_s.isoformat(),
                    "yoyEnd": yoy_e.isoformat(),
                },
                "products": products,
                "top5": top5,
                "lowest5": lowest5,
                "top5Yoy": yoy_ranked,
                "yoyCompare": yoy_compare,
            }

        db = _pa_session()
        try:
            # Pull enough history for month + YoY month.
            fetch_lo = date(today.year - 1, 1, 1)
            fetch_hi = today
            rows = (
                db.query(VendonDailyMachineRevenueCache)
                .filter(
                    VendonDailyMachineRevenueCache.machine_id == mid,
                    VendonDailyMachineRevenueCache.cache_date >= fetch_lo,
                    VendonDailyMachineRevenueCache.cache_date <= fetch_hi,
                )
                .all()
            )
            if not mname:
                for r in rows:
                    if (r.machine_name or "").strip():
                        mname = str(r.machine_name).strip()
                        break
            if not mname:
                mname = mid

            by_grain: Dict[str, Any] = {}
            for grain in ("day", "week", "month"):
                cur_s, cur_e, prev_s, prev_e, yoy_s, yoy_e, label = _grain_windows(grain)
                # Cache ranges are inclusive end days; _aggregate uses end_excl.
                cur = _aggregate_product_counts_in_range(rows, cur_s, cur_e + timedelta(days=1))
                prev = _aggregate_product_counts_in_range(rows, prev_s, prev_e + timedelta(days=1))
                yoy = _aggregate_product_counts_in_range(rows, yoy_s, yoy_e + timedelta(days=1))

                # Live fallback for current grain when cache has no productCounts yet.
                if not cur:
                    try:
                        from_ts, _ = _kuwait_day_bounds_utc(cur_s.isoformat())
                        _, to_ts = _kuwait_day_bounds_utc(cur_e.isoformat())
                        vends, _err = _fetch_vends_machine_day(mid, from_ts, to_ts)
                        from vendon_proxy_routes import _stats_vend_product_fields

                        live: Dict[str, int] = {}
                        for v in vends or []:
                            if not isinstance(v, dict):
                                continue
                            pn, _sel = _stats_vend_product_fields(v)
                            pn = (pn or "").strip()
                            if pn:
                                live[pn] = int(live.get(pn) or 0) + 1
                        cur = live
                    except Exception:
                        logger.exception("machine-products live vends %s %s", mid, grain)

                by_grain[grain] = _slice_from_counts(
                    cur,
                    prev,
                    yoy,
                    label=label,
                    cur_s=cur_s,
                    cur_e=cur_e,
                    prev_s=prev_s,
                    prev_e=prev_e,
                    yoy_s=yoy_s,
                    yoy_e=yoy_e,
                )

            body = {
                "ok": True,
                "machineId": mid,
                "machineName": mname,
                "asOf": now_local.replace(microsecond=0).isoformat(),
                "byGrain": by_grain,
            }
            _alert_cache_set(cache_key, body)
            return jsonify(body)
        except Exception as ex:
            logger.exception("alert_performance_machine_products")
            return jsonify({"ok": False, "error": str(ex)}), 500
        finally:
            db.close()

    @app.route("/api/alert/performance/machine-detail", methods=["GET", "OPTIONS"])
    def alert_performance_machine_detail():
        """
        Performance tab: Revenue Trajectory daily KD/cups vs targets for one machine.
        Query: machineId (required), days=14
        """
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        mid = (request.args.get("machineId") or request.args.get("machine_id") or "").strip()
        if not mid:
            return jsonify({"error": "machineId_required"}), 400
        try:
            history_days = max(7, min(45, int(request.args.get("days") or 14)))
        except (TypeError, ValueError):
            history_days = 14

        cache_key = f"perf:v2:{mid}:{history_days}"
        cached = _alert_cache_get(cache_key, 90)
        if cached is not None:
            return jsonify(cached)

        tz = ZoneInfo("Asia/Kuwait")
        now_local = datetime.now(tz)
        today = now_local.date()
        fetch_lo = today - timedelta(days=history_days - 1)

        seed = fetch_lo
        while seed < today:
            _maybe_seed_vendon_revenue_cache(seed)
            seed += timedelta(days=1)

        fleet_rows, fleet_err = vendon_fetch_machine_list(_vendon_get)
        if fleet_err:
            return jsonify({"error": fleet_err}), 502
        machine_name = mid
        for m in fleet_rows or []:
            if str(m.get("id") or "") == mid:
                machine_name = str(m.get("name") or mid).strip() or mid
                break

        dash = _dash_session()
        try:
            lmc = dash.query(LiveMachineConfig).filter(LiveMachineConfig.machine_id == mid).first()
            prof = dash.query(AlertMachineProfile).filter(AlertMachineProfile.machine_id == mid).first()
            loc_target = float(lmc.daily_sales_target) if lmc and lmc.daily_sales_target is not None else None
            pname = (lmc.sx_product_name if lmc else None) or None
            prod_target = float(lmc.daily_product_target) if lmc and lmc.daily_product_target is not None else None
            period = (lmc.sx_target_period if lmc and lmc.sx_target_period else None) or "daily"
            owner = (prof.location_owner if prof else None) or None
            if loc_target is None:
                try:
                    from week_revenue_target_lib import daily_target_kd_from_week

                    loc_target = daily_target_kd_from_week(machine_name, owner)
                except Exception:
                    loc_target = None
        finally:
            dash.close()

        db = _pa_session()
        try:
            cache_rows = (
                db.query(VendonDailyMachineRevenueCache)
                .filter(
                    VendonDailyMachineRevenueCache.machine_id == mid,
                    VendonDailyMachineRevenueCache.cache_date >= fetch_lo,
                    VendonDailyMachineRevenueCache.cache_date <= today,
                )
                .all()
            )
            kwd_by_day: Dict[date, float] = {}
            for r in cache_rows:
                if r.cache_date is None:
                    continue
                kwd_by_day[r.cache_date] = float(r.total_sales_kwd or 0)

            elapsed_payload = _load_daily_sales_elapsed_db_cache()
            by_e = (elapsed_payload or {}).get("byMachineId") or {}
            ent = by_e.get(mid) if isinstance(by_e, dict) else None
            if isinstance(ent, dict) and ent.get("todayKwd") is not None:
                kwd_by_day[today] = float(ent["todayKwd"])

            from alert_performance_lib import build_machine_performance
            from alert_sx_lib import DEFAULT_SX_PRODUCT

            def _fetch_vends(from_ts: int, to_ts: int, machine_id: str = mid):
                return _fetch_vends_machine_day(machine_id, from_ts, to_ts)

            payload = build_machine_performance(
                machine_id=mid,
                machine_name=machine_name,
                kwd_by_day=kwd_by_day,
                product_name=(pname or DEFAULT_SX_PRODUCT),
                location_target_kd=loc_target,
                product_target_cups=prod_target,
                target_period=period,
                history_days=history_days,
                today=today,
                now_local=now_local,
                fetch_vends_fn=_fetch_vends,
            )
            # Attach area-owner (vendon_user_id) for promo swipe deck.
            try:
                from promo_lib import _load_owner_by_machine

                owner_map = _load_owner_by_machine(db)
                payload["vendonUserId"] = owner_map.get(mid)
                if payload.get("vendonUserId"):
                    own = db.execute(
                        text(
                            "SELECT vendon_user_name FROM target_area_owner WHERE vendon_user_id = :id"
                        ),
                        {"id": payload["vendonUserId"]},
                    ).mappings().first()
                    payload["vendonUserName"] = (own or {}).get("vendon_user_name")
            except Exception:
                payload["vendonUserId"] = None

            _alert_cache_set(cache_key, payload)
            return jsonify(payload)
        except Exception as ex:
            logger.exception("alert_performance_machine_detail")
            return jsonify({"error": str(ex)}), 500
        finally:
            db.close()

    @app.route("/api/alert/performance/fleet", methods=["GET", "OPTIONS"])
    def alert_performance_fleet():
        """
        Multi-machine Performance graphs (Areas-style).
        Query: machineIds=id1,id2 (max 120) OR empty = top revenue machines from cache window
               preset=last_week|this_week|last_2_weeks|this_month|last_month|today|yesterday
               days=14 (rolling fallback)
               includeProducts=0|1 (default 0 for speed — location KD only)
        """
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        try:
            history_days = max(1, min(62, int(request.args.get("days") or 14)))
        except (TypeError, ValueError):
            history_days = 14
        preset = (request.args.get("preset") or "last_week").strip().lower()
        include_products = str(request.args.get("includeProducts") or "0").strip().lower() in (
            "1",
            "true",
            "yes",
        )
        raw_ids = (request.args.get("machineIds") or request.args.get("machine_ids") or "").strip()
        requested = [x.strip() for x in raw_ids.split(",") if x.strip()]
        explicit_machine_ids = bool(requested)
        # Soft cap — clients batch when loading the full fleet. Cache-backed path stays light.
        if len(requested) > 120:
            requested = requested[:120]

        from alert_targets_lib import resolve_perf_window

        tz = ZoneInfo("Asia/Kuwait")
        now_local = datetime.now(tz)
        today = now_local.date()
        win_start, win_end, prev_start, prev_end, preset_id = resolve_perf_window(
            today=today,
            preset=preset,
            history_days=history_days,
        )
        history_days = (win_end - win_start).days + 1
        fetch_lo = min(win_start, prev_start)
        fetch_hi = max(win_end, today)

        cache_key = (
            f"perf:fleet:v7:{','.join(sorted(requested)) or 'auto'}:"
            f"{preset_id}:{win_start}:{win_end}:p{int(include_products)}"
        )
        cached = _alert_cache_get(cache_key, 120)
        if cached is not None:
            return jsonify(cached)

        # Explicit machineIds: skip Vendon /machine (paginated fleet scan) and background
        # revenue seeds — cron warms cache; both saturated the single gunicorn worker CPU.
        if not explicit_machine_ids:
            seed = fetch_lo
            while seed <= fetch_hi:
                _maybe_seed_vendon_revenue_cache(seed)
                seed += timedelta(days=1)

        name_by_id: Dict[str, str] = {}
        fleet_err: Optional[str] = None

        def _vendon_name_map() -> Tuple[Dict[str, str], Optional[str]]:
            """id → display name; cached so batched machineIds requests do not re-scan Vendon each time."""
            cached = _alert_cache_get("perf:vendon-machine-names:v1", 600)
            if isinstance(cached, dict) and cached:
                return {str(k): str(v) for k, v in cached.items() if k and v}, None
            fleet_rows, err = vendon_fetch_machine_list(_vendon_get)
            if err:
                return {}, err
            out: Dict[str, str] = {}
            for m in fleet_rows or []:
                mid = str(m.get("id") or "").strip()
                if not mid:
                    continue
                out[mid] = str(m.get("name") or mid).strip() or mid
            if out:
                _alert_cache_set("perf:vendon-machine-names:v1", out)
            return out, None

        vendon_names, fleet_err = _vendon_name_map()
        if explicit_machine_ids:
            # Prefer real location names — never leave charts labeled with raw Vendon IDs.
            name_by_id = {mid: (vendon_names.get(mid) or mid) for mid in requested}
        else:
            if fleet_err and not vendon_names:
                return jsonify({"error": fleet_err, "machines": []}), 502
            name_by_id = dict(vendon_names)

        db = _pa_session()
        try:
            if not requested:
                # Auto: machines with revenue in window (cap for overview speed)
                rows = (
                    db.query(
                        VendonDailyMachineRevenueCache.machine_id,
                        func.sum(VendonDailyMachineRevenueCache.total_sales_kwd).label("tot"),
                    )
                    .filter(
                        VendonDailyMachineRevenueCache.cache_date >= win_start,
                        VendonDailyMachineRevenueCache.cache_date <= win_end,
                    )
                    .group_by(VendonDailyMachineRevenueCache.machine_id)
                    .order_by(func.sum(VendonDailyMachineRevenueCache.total_sales_kwd).desc())
                    .limit(200)
                    .all()
                )
                requested = [str(r.machine_id) for r in rows if r.machine_id]
                requested = [mid for mid in requested if mid in name_by_id] or list(name_by_id.keys())[:200]

            cache_rows = (
                db.query(VendonDailyMachineRevenueCache)
                .filter(
                    VendonDailyMachineRevenueCache.machine_id.in_(requested),
                    VendonDailyMachineRevenueCache.cache_date >= fetch_lo,
                    VendonDailyMachineRevenueCache.cache_date <= today,
                )
                .all()
            )
            kwd_map: Dict[str, Dict[date, float]] = {mid: {} for mid in requested}
            for r in cache_rows:
                mid = str(r.machine_id or "").strip()
                if mid not in kwd_map or r.cache_date is None:
                    continue
                kwd_map[mid][r.cache_date] = float(r.total_sales_kwd or 0)

            elapsed_payload = _load_daily_sales_elapsed_db_cache()
            by_e = (elapsed_payload or {}).get("byMachineId") or {}
            for mid in requested:
                ent = by_e.get(mid) if isinstance(by_e, dict) else None
                if isinstance(ent, dict) and ent.get("todayKwd") is not None:
                    kwd_map.setdefault(mid, {})[today] = float(ent["todayKwd"])

            dash = _dash_session()
            cfg: Dict[str, Dict[str, Any]] = {}
            try:
                from week_revenue_target_lib import daily_target_kd_from_week
                from alert_sx_lib import DEFAULT_SX_PRODUCT

                lmcs = {
                    str(r.machine_id): r
                    for r in dash.query(LiveMachineConfig)
                    .filter(LiveMachineConfig.machine_id.in_(requested))
                    .all()
                }
                profs = {
                    str(r.machine_id): r
                    for r in dash.query(AlertMachineProfile)
                    .filter(AlertMachineProfile.machine_id.in_(requested))
                    .all()
                }
                for mid in requested:
                    lmc = lmcs.get(mid)
                    prof = profs.get(mid)
                    mname = (
                        (str(prof.machine_name).strip() if prof and prof.machine_name else None)
                        or name_by_id.get(mid)
                        or mid
                    )
                    name_by_id[mid] = mname
                    loc_target = float(lmc.daily_sales_target) if lmc and lmc.daily_sales_target is not None else None
                    owner = (prof.location_owner if prof else None) or None
                    if loc_target is None:
                        try:
                            loc_target = daily_target_kd_from_week(mname, owner)
                        except Exception:
                            loc_target = None
                    cfg[mid] = {
                        "name": mname,
                        "loc_target": loc_target,
                        "prod_target": float(lmc.daily_product_target)
                        if lmc and lmc.daily_product_target is not None
                        else None,
                        "pname": (lmc.sx_product_name if lmc else None) or DEFAULT_SX_PRODUCT,
                        "period": (lmc.sx_target_period if lmc and lmc.sx_target_period else None) or "daily",
                    }
            finally:
                dash.close()

            from concurrent.futures import ThreadPoolExecutor, as_completed

            from alert_performance_lib import (
                aggregate_fleet_days,
                build_machine_performance,
                summarize_machine_period,
            )
            from alert_sx_lib import DEFAULT_SX_PRODUCT

            def _build_one(mid: str) -> Dict[str, Any]:
                c = cfg.get(mid) or {}
                fetch_fn = None
                if include_products:

                    def _fetch_vends(from_ts: int, to_ts: int, machine_id: str = mid):
                        return _fetch_vends_machine_day(machine_id, from_ts, to_ts)

                    fetch_fn = _fetch_vends
                payload = build_machine_performance(
                    machine_id=mid,
                    machine_name=c.get("name") or name_by_id.get(mid) or mid,
                    kwd_by_day=kwd_map.get(mid) or {},
                    product_name=c.get("pname") or DEFAULT_SX_PRODUCT,
                    location_target_kd=c.get("loc_target"),
                    product_target_cups=c.get("prod_target"),
                    target_period=c.get("period") or "daily",
                    history_days=history_days,
                    today=today,
                    now_local=now_local,
                    fetch_vends_fn=fetch_fn,
                    range_start=win_start,
                    range_end=win_end,
                )
                return summarize_machine_period(payload)

            machines_out: List[Dict[str, Any]] = []
            # Location-only path is cache-backed and fast — allow more workers lightly
            workers = min(8 if not include_products else 4, max(1, len(requested)))
            with ThreadPoolExecutor(max_workers=workers) as pool:
                futs = {pool.submit(_build_one, mid): mid for mid in requested}
                for fut in as_completed(futs):
                    mid = futs[fut]
                    try:
                        machines_out.append(fut.result())
                    except Exception:
                        logger.exception("alert_performance_fleet machine %s", mid)

            # Previous-period + YoY totals (cache only — for growth KPIs / popup)
            def _sum_kwd_by_mid(d0: date, d1: date) -> Dict[str, float]:
                out_map: Dict[str, float] = {mid: 0.0 for mid in requested}
                if d0 > d1 or not requested:
                    return out_map
                rows_sum = (
                    db.query(
                        VendonDailyMachineRevenueCache.machine_id,
                        func.sum(VendonDailyMachineRevenueCache.total_sales_kwd).label("tot"),
                    )
                    .filter(
                        VendonDailyMachineRevenueCache.machine_id.in_(requested),
                        VendonDailyMachineRevenueCache.cache_date >= d0,
                        VendonDailyMachineRevenueCache.cache_date <= d1,
                    )
                    .group_by(VendonDailyMachineRevenueCache.machine_id)
                    .all()
                )
                for r in rows_sum:
                    mid = str(r.machine_id or "").strip()
                    if mid:
                        out_map[mid] = float(r.tot or 0)
                return out_map

            prev_kwd_by_mid = _sum_kwd_by_mid(prev_start, prev_end)
            yoy_start = win_start - timedelta(days=365)
            yoy_end = win_end - timedelta(days=365)
            yoy_kwd_by_mid = _sum_kwd_by_mid(yoy_start, yoy_end)

            for m in machines_out:
                mid = str(m.get("machineId") or "").strip()
                m["prevPeriodLocationKwd"] = round(prev_kwd_by_mid.get(mid, 0.0), 4)
                m["yoyPeriodLocationKwd"] = round(yoy_kwd_by_mid.get(mid, 0.0), 4)
                cur = float(m.get("totalLocationKwd") or 0)
                prev_m = float(m.get("prevPeriodLocationKwd") or 0)
                yoy_m = float(m.get("yoyPeriodLocationKwd") or 0)
                m["prevPeriodGrowthPct"] = (
                    round((cur / prev_m) * 100, 1) if prev_m > 0 else None
                )
                m["yoyGrowthPct"] = round((cur / yoy_m) * 100, 1) if yoy_m > 0 else None

            def _growth_group(
                rows: List[Dict[str, Any]],
                compare_key: str,
            ) -> Dict[str, Any]:
                period = sum(float(m.get("totalLocationKwd") or 0) for m in rows)
                compare = sum(float(m.get(compare_key) or 0) for m in rows)
                rate = round((period / compare) * 100, 1) if compare > 0 else None
                details = []
                for m in rows:
                    mid = str(m.get("machineId") or "")
                    cur = float(m.get("totalLocationKwd") or 0)
                    cmp_v = float(m.get(compare_key) or 0)
                    details.append(
                        {
                            "machineId": mid,
                            "machineName": m.get("machineName") or mid,
                            "periodKd": round(cur, 4),
                            "compareKd": round(cmp_v, 4),
                            "ratePct": round((cur / cmp_v) * 100, 1) if cmp_v > 0 else None,
                        }
                    )
                return {
                    "ratePct": rate,
                    "periodKd": round(period, 4),
                    "compareKd": round(compare, 4),
                    "machineCount": len(rows),
                    "machines": details,
                }

            # Rank by period sales (matches Overview Top/Lowest 5)
            machines_out.sort(
                key=lambda m: (
                    -float(m.get("totalLocationKwd") or 0),
                    str(m.get("machineName") or ""),
                )
            )
            by_sales = list(machines_out)
            top5 = by_sales[:5]
            lowest5 = list(reversed(by_sales[-5:])) if by_sales else []

            growth_prev = {
                "all": _growth_group(by_sales, "prevPeriodLocationKwd"),
                "top5": _growth_group(top5, "prevPeriodLocationKwd"),
                "lowest5": _growth_group(lowest5, "prevPeriodLocationKwd"),
            }
            growth_yoy = {
                "all": _growth_group(by_sales, "yoyPeriodLocationKwd"),
                "top5": _growth_group(top5, "yoyPeriodLocationKwd"),
                "lowest5": _growth_group(lowest5, "yoyPeriodLocationKwd"),
            }

            aggregate_days = aggregate_fleet_days(machines_out)
            product_names = sorted(
                {
                    str(m.get("productName") or "").strip()
                    for m in machines_out
                    if str(m.get("productName") or "").strip()
                }
            )

            period_actual = sum(float(m.get("totalLocationKwd") or 0) for m in machines_out)
            period_target = sum(float(m.get("periodTargetKd") or 0) for m in machines_out)
            prev_actual = float(growth_prev["all"]["compareKd"] or 0)
            yoy_actual = float(growth_yoy["all"]["compareKd"] or 0)
            with_tgt = [
                m
                for m in machines_out
                if m.get("periodTargetKd") is not None and float(m.get("periodTargetKd") or 0) > 0
            ]
            hit_count = sum(
                1
                for m in with_tgt
                if float(m.get("totalLocationKwd") or 0) >= float(m.get("periodTargetKd") or 0)
            )
            achievement_rate = (
                round((hit_count / len(with_tgt)) * 100, 1) if with_tgt else None
            )
            growth_pct = growth_prev["all"].get("ratePct")
            yoy_growth_pct = growth_yoy["all"].get("ratePct")
            deficit = round(period_actual - period_target, 4) if period_target > 0 else None

            body = {
                "historyDays": history_days,
                "preset": preset_id,
                "window": {
                    "start": win_start.isoformat(),
                    "end": win_end.isoformat(),
                    "prevStart": prev_start.isoformat(),
                    "prevEnd": prev_end.isoformat(),
                    "yoyStart": yoy_start.isoformat(),
                    "yoyEnd": yoy_end.isoformat(),
                },
                "includeProducts": bool(include_products),
                "asOf": now_local.replace(microsecond=0).isoformat(),
                "machineCount": len(machines_out),
                "productName": product_names[0] if len(product_names) == 1 else None,
                "productNames": product_names,
                "machines": machines_out,
                "aggregateDays": aggregate_days,
                "kpis": {
                    "deficitKd": deficit,
                    "periodActualKd": round(period_actual, 4),
                    "periodTargetKd": round(period_target, 4) if period_target > 0 else None,
                    "achievementRatePct": achievement_rate,
                    "machinesOnTarget": hit_count,
                    "machinesWithTarget": len(with_tgt),
                    "growthRatePct": growth_pct,
                    "prevPeriodActualKd": round(prev_actual, 4),
                    "yoyGrowthRatePct": yoy_growth_pct,
                    "yoyPeriodActualKd": round(yoy_actual, 4),
                    "growthVsPrev": growth_prev,
                    "growthVsYoy": growth_yoy,
                },
            }
            _alert_cache_set(cache_key, body)
            return jsonify(body)
        except Exception as ex:
            logger.exception("alert_performance_fleet")
            return jsonify({"error": str(ex), "machines": []}), 500
        finally:
            db.close()

    @app.route("/api/alert/promo/instruments", methods=["GET", "POST", "OPTIONS"])
    def alert_promo_instruments():
        """Promo swipe instruments keyed by area-owner vendon_user_id (Alert auth)."""
        if request.method == "OPTIONS":
            return "", 204
        if request.method == "GET":
            _, denied = _require_alert_read()
            if denied:
                return denied
            vendon_user_id = (request.args.get("vendon_user_id") or request.args.get("vendonUserId") or "").strip()
            if not vendon_user_id:
                return jsonify({"ok": False, "error": "vendonUserId required", "instruments": []}), 400
            db = _pa_session()
            try:
                rows = db.execute(
                    text(
                        """
                        SELECT id, vendon_user_id, name, sort_order, active, updated_at
                        FROM target_promo_instrument
                        WHERE active = TRUE AND vendon_user_id = :uid
                        ORDER BY sort_order, id
                        """
                    ),
                    {"uid": vendon_user_id},
                ).mappings().all()
                out = []
                for r in rows:
                    d = dict(r)
                    if d.get("updated_at") is not None:
                        d["updated_at"] = str(d["updated_at"])
                    out.append(d)
                return jsonify({"ok": True, "instruments": out})
            except Exception as ex:
                logger.exception("alert_promo_instruments GET")
                return jsonify({"ok": False, "error": str(ex), "instruments": []}), 500
            finally:
                db.close()

        email, denied = _require_alert_admin()
        if denied:
            return denied
        body = request.get_json(silent=True) or {}
        vendon_user_id = str(body.get("vendonUserId") or body.get("vendon_user_id") or "").strip()
        names = body.get("names") or body.get("instruments") or []
        if not vendon_user_id:
            return jsonify({"ok": False, "error": "vendonUserId required"}), 400
        clean_names = [str(n).strip() for n in names if str(n).strip()]
        if not clean_names:
            return jsonify({"ok": False, "error": "names required"}), 400
        db = _pa_session()
        try:
            db.execute(
                text("UPDATE target_promo_instrument SET active = FALSE WHERE vendon_user_id = :uid"),
                {"uid": vendon_user_id},
            )
            for i, name in enumerate(clean_names):
                db.execute(
                    text(
                        """
                        INSERT INTO target_promo_instrument (vendon_user_id, name, sort_order, active, updated_at)
                        VALUES (:uid, :name, :ord, TRUE, NOW())
                        """
                    ),
                    {"uid": vendon_user_id, "name": name, "ord": i},
                )
            db.commit()
            return jsonify({"ok": True, "count": len(clean_names), "updatedBy": email})
        except Exception as ex:
            db.rollback()
            logger.exception("alert_promo_instruments POST")
            return jsonify({"ok": False, "error": str(ex)}), 500
        finally:
            db.close()

    @app.route("/api/alert/promo/swipe", methods=["POST", "OPTIONS"])
    def alert_promo_swipe():
        """Log promo instrument swipe: Δ cups today vs same clock yesterday (Kuwait)."""
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        body = request.get_json(silent=True) or {}
        instrument_id = body.get("instrumentId") or body.get("instrument_id")
        machine_id = str(body.get("machineId") or body.get("machine_id") or "").strip()
        product_name = str(body.get("productName") or body.get("product_name") or "Americano Max").strip()
        vendon_user_id = str(body.get("vendonUserId") or body.get("vendon_user_id") or "").strip()
        try:
            instrument_id = int(instrument_id)
        except (TypeError, ValueError):
            return jsonify({"ok": False, "error": "instrumentId required"}), 400
        if not machine_id:
            return jsonify({"ok": False, "error": "machineId required"}), 400
        if not vendon_user_id:
            return jsonify({"ok": False, "error": "vendonUserId required"}), 400

        from promo_lib import product_cups_partial_day_compare

        def _fetch_vends(from_ts: int, to_ts: int, mid: str = machine_id):
            return _fetch_vends_machine_day(mid, from_ts, to_ts)

        today_cups, yesterday_cups = product_cups_partial_day_compare(
            machine_id, product_name, _fetch_vends
        )
        delta = today_cups - yesterday_cups
        db = _pa_session()
        try:
            ins = db.execute(
                text(
                    """
                    INSERT INTO target_promo_swipe_event
                      (instrument_id, machine_id, vendon_user_id, swiped_at,
                       product_cups_now, product_cups_yesterday_same_time, delta_cups, note)
                    VALUES (:iid, :mid, :uid, NOW(), :now_c, :y_c, :delta, :note)
                    RETURNING id, swiped_at
                    """
                ),
                {
                    "iid": instrument_id,
                    "mid": machine_id,
                    "uid": vendon_user_id,
                    "now_c": today_cups,
                    "y_c": yesterday_cups,
                    "delta": delta,
                    "note": str(body.get("note") or "").strip() or None,
                },
            ).mappings().first()
            db.commit()
            return jsonify(
                {
                    "ok": True,
                    "eventId": ins.get("id") if ins else None,
                    "productCupsNow": today_cups,
                    "productCupsYesterdaySameTime": yesterday_cups,
                    "deltaCups": delta,
                    "swipedAt": str(ins.get("swiped_at")) if ins else None,
                }
            )
        except Exception as ex:
            db.rollback()
            logger.exception("alert_promo_swipe")
            return jsonify({"ok": False, "error": str(ex)}), 500
        finally:
            db.close()

    @app.route("/api/alert/promo/assignments", methods=["GET", "POST", "OPTIONS"])
    def alert_promo_assignments():
        """Promo product assignments — same tables as target-site (Alert auth)."""
        if request.method == "OPTIONS":
            return "", 204
        if request.method == "GET":
            _, denied = _require_alert_admin()
            if denied:
                return denied
            db = _pa_session()
            try:
                rows = db.execute(
                    text(
                        """
                        SELECT id, scope_type, machine_id, vendon_user_id, product_name, updated_by, updated_at
                        FROM target_promo_assignment
                        ORDER BY updated_at DESC
                        """
                    )
                ).mappings().all()
                out = []
                for r in rows:
                    d = dict(r)
                    if d.get("updated_at") is not None:
                        d["updated_at"] = str(d["updated_at"])
                    out.append(d)
                return jsonify({"ok": True, "assignments": out})
            except Exception as ex:
                logger.exception("alert_promo_assignments GET")
                return jsonify({"ok": False, "error": str(ex), "assignments": []}), 500
            finally:
                db.close()

        email, denied = _require_alert_admin()
        if denied:
            return denied
        body = request.get_json(silent=True) or {}
        scope_type = str(body.get("scopeType") or body.get("scope_type") or "").strip().lower()
        machine_id = str(body.get("machineId") or body.get("machine_id") or "").strip() or None
        vendon_user_id = str(body.get("vendonUserId") or body.get("vendon_user_id") or "").strip() or None
        product_name = str(body.get("productName") or body.get("product_name") or "Americano Max").strip()
        updated_by = str(body.get("updatedBy") or email or "alert-admin").strip()
        if scope_type not in ("machine", "owner"):
            return jsonify({"ok": False, "error": "scopeType must be machine or owner"}), 400
        if scope_type == "machine" and not machine_id:
            return jsonify({"ok": False, "error": "machineId required for machine scope"}), 400
        if scope_type == "owner" and not vendon_user_id:
            return jsonify({"ok": False, "error": "vendonUserId required for owner scope"}), 400
        db = _pa_session()
        try:
            if scope_type == "machine":
                db.execute(
                    text("DELETE FROM target_promo_assignment WHERE scope_type = 'machine' AND machine_id = :mid"),
                    {"mid": machine_id},
                )
            else:
                db.execute(
                    text(
                        "DELETE FROM target_promo_assignment WHERE scope_type = 'owner' AND vendon_user_id = :uid"
                    ),
                    {"uid": vendon_user_id},
                )
            db.execute(
                text(
                    """
                    INSERT INTO target_promo_assignment
                      (scope_type, machine_id, vendon_user_id, product_name, updated_by, updated_at)
                    VALUES (:scope_type, :machine_id, :vendon_user_id, :product_name, :updated_by, NOW())
                    """
                ),
                {
                    "scope_type": scope_type,
                    "machine_id": machine_id,
                    "vendon_user_id": vendon_user_id,
                    "product_name": product_name or "Americano Max",
                    "updated_by": updated_by,
                },
            )
            db.commit()
            return jsonify({"ok": True})
        except Exception as ex:
            db.rollback()
            logger.exception("alert_promo_assignments POST")
            return jsonify({"ok": False, "error": str(ex)}), 500
        finally:
            db.close()

    @app.route("/api/alert/promo/day-targets", methods=["GET", "POST", "OPTIONS"])
    def alert_promo_day_targets():
        if request.method == "OPTIONS":
            return "", 204
        if request.method == "GET":
            _, denied = _require_alert_admin()
            if denied:
                return denied
            start = (request.args.get("start_date") or request.args.get("startDate") or "").strip()
            end = (request.args.get("end_date") or request.args.get("endDate") or "").strip()
            machine_id = (request.args.get("machine_id") or request.args.get("machineId") or "").strip()
            db = _pa_session()
            try:
                q = """
                    SELECT id, machine_id, target_date::text AS target_date, target_cups, updated_by, updated_at
                    FROM target_promo_day_target
                    WHERE 1=1
                """
                params: Dict[str, Any] = {}
                if start:
                    q += " AND target_date >= CAST(:start AS date)"
                    params["start"] = start
                if end:
                    q += " AND target_date <= CAST(:end AS date)"
                    params["end"] = end
                if machine_id:
                    q += " AND machine_id = :mid"
                    params["mid"] = machine_id
                q += " ORDER BY target_date, machine_id"
                rows = db.execute(text(q), params).mappings().all()
                out = []
                for r in rows:
                    d = dict(r)
                    if d.get("updated_at") is not None:
                        d["updated_at"] = str(d["updated_at"])
                    out.append(d)
                return jsonify({"ok": True, "dayTargets": out})
            except Exception as ex:
                logger.exception("alert_promo_day_targets GET")
                return jsonify({"ok": False, "error": str(ex), "dayTargets": []}), 500
            finally:
                db.close()

        email, denied = _require_alert_admin()
        if denied:
            return denied
        body = request.get_json(silent=True) or {}
        machine_id = str(body.get("machineId") or body.get("machine_id") or "").strip()
        target_date = str(body.get("targetDate") or body.get("target_date") or "").strip()
        try:
            target_cups = int(body.get("targetCups") or body.get("target_cups") or 0)
        except (TypeError, ValueError):
            return jsonify({"ok": False, "error": "targetCups must be an integer"}), 400
        updated_by = str(body.get("updatedBy") or email or "alert-admin").strip()
        if not machine_id or not target_date:
            return jsonify({"ok": False, "error": "machineId and targetDate required"}), 400
        db = _pa_session()
        try:
            db.execute(
                text(
                    """
                    INSERT INTO target_promo_day_target (machine_id, target_date, target_cups, updated_by, updated_at)
                    VALUES (:mid, CAST(:d AS date), :cups, :by, NOW())
                    ON CONFLICT (machine_id, target_date)
                    DO UPDATE SET target_cups = EXCLUDED.target_cups, updated_by = EXCLUDED.updated_by, updated_at = NOW()
                    """
                ),
                {"mid": machine_id, "d": target_date, "cups": max(0, target_cups), "by": updated_by},
            )
            db.commit()
            return jsonify({"ok": True})
        except Exception as ex:
            db.rollback()
            logger.exception("alert_promo_day_targets POST")
            return jsonify({"ok": False, "error": str(ex)}), 500
        finally:
            db.close()

    @app.route("/api/alert/promo/day-targets/bulk", methods=["POST", "OPTIONS"])
    def alert_promo_day_targets_bulk():
        if request.method == "OPTIONS":
            return "", 204
        email, denied = _require_alert_admin()
        if denied:
            return denied
        body = request.get_json(silent=True) or {}
        machine_ids: List[str] = [
            str(x).strip() for x in (body.get("machineIds") or body.get("machine_ids") or []) if str(x).strip()
        ]
        dates: List[str] = [str(x).strip() for x in (body.get("dates") or []) if str(x).strip()]
        try:
            target_cups = int(body.get("targetCups") or body.get("target_cups") or 0)
        except (TypeError, ValueError):
            return jsonify({"ok": False, "error": "targetCups must be an integer"}), 400
        updated_by = str(body.get("updatedBy") or email or "alert-admin").strip()
        if not machine_ids or not dates:
            return jsonify({"ok": False, "error": "machineIds and dates required"}), 400
        db = _pa_session()
        try:
            for mid in machine_ids:
                for d in dates:
                    db.execute(
                        text(
                            """
                            INSERT INTO target_promo_day_target (machine_id, target_date, target_cups, updated_by, updated_at)
                            VALUES (:mid, CAST(:d AS date), :cups, :by, NOW())
                            ON CONFLICT (machine_id, target_date)
                            DO UPDATE SET target_cups = EXCLUDED.target_cups, updated_by = EXCLUDED.updated_by, updated_at = NOW()
                            """
                        ),
                        {"mid": mid, "d": d, "cups": max(0, target_cups), "by": updated_by},
                    )
            db.commit()
            return jsonify({"ok": True, "saved": len(machine_ids) * len(dates)})
        except Exception as ex:
            db.rollback()
            logger.exception("alert_promo_day_targets_bulk")
            return jsonify({"ok": False, "error": str(ex)}), 500
        finally:
            db.close()

    @app.route("/api/alert/promo/performance", methods=["GET", "OPTIONS"])
    def alert_promo_performance():
        """Promo cups vs calendar day targets — same engine as target-site (Alert auth)."""
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        from promo_lib import fetch_promo_performance, kuwait_today

        start = (request.args.get("start_date") or request.args.get("startDate") or "").strip()
        end = (request.args.get("end_date") or request.args.get("endDate") or "").strip()
        if not start or not end:
            today = kuwait_today().isoformat()
            start = start or today
            end = end or today
        raw_ids = (request.args.get("machine_ids") or request.args.get("machineIds") or "").strip()
        machine_ids: Optional[Set[str]] = (
            {x.strip() for x in raw_ids.split(",") if x.strip()} if raw_ids else None
        )

        rows, err = vendon_fetch_machine_list(_vendon_get)
        if err:
            return jsonify({"ok": False, "error": err, "locations": []}), 502
        machines = []
        for m in rows:
            if m.get("id") is None:
                continue
            mid = str(m.get("id")).strip()
            if not mid:
                continue
            machines.append({"id": mid, "name": m.get("name") or mid})

        db = _pa_session()
        try:
            # Default: only machines with day targets in the window (avoids full-fleet vend scans).
            if machine_ids is None:
                tgt_rows = db.execute(
                    text(
                        """
                        SELECT DISTINCT machine_id
                        FROM target_promo_day_target
                        WHERE target_date >= CAST(:start AS date)
                          AND target_date <= CAST(:end AS date)
                        """
                    ),
                    {"start": start, "end": end},
                ).mappings().all()
                machine_ids = {str(r["machine_id"]).strip() for r in tgt_rows if r.get("machine_id")}

            def _fetch_vends(from_ts: int, to_ts: int, mid: str):
                return _fetch_vends_machine_day(mid, from_ts, to_ts)

            payload = fetch_promo_performance(
                db,
                machines,
                start,
                end,
                _fetch_vends,
                machine_ids=machine_ids,
            )
            return jsonify({"ok": True, **payload})
        except Exception as ex:
            logger.exception("alert_promo_performance")
            return jsonify({"ok": False, "error": str(ex), "locations": []}), 500
        finally:
            db.close()

    @app.route("/api/alert/promo/swipe-events", methods=["GET", "OPTIONS"])
    def alert_promo_swipe_events():
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        vendon_user_id = (request.args.get("vendon_user_id") or request.args.get("vendonUserId") or "").strip()
        machine_id = (request.args.get("machine_id") or request.args.get("machineId") or "").strip()
        db = _pa_session()
        try:
            q = """
                SELECT e.id, e.instrument_id, i.name AS instrument_name, e.machine_id, e.vendon_user_id,
                       e.swiped_at, e.product_cups_now, e.product_cups_yesterday_same_time, e.delta_cups, e.note
                FROM target_promo_swipe_event e
                JOIN target_promo_instrument i ON i.id = e.instrument_id
                WHERE 1=1
            """
            params: Dict[str, Any] = {}
            if vendon_user_id:
                q += " AND e.vendon_user_id = :uid"
                params["uid"] = vendon_user_id
            if machine_id:
                q += " AND e.machine_id = :mid"
                params["mid"] = machine_id
            q += " ORDER BY e.swiped_at DESC LIMIT 50"
            rows = db.execute(text(q), params).mappings().all()
            out = []
            for r in rows:
                d = dict(r)
                if d.get("swiped_at") is not None:
                    d["swiped_at"] = str(d["swiped_at"])
                out.append(d)
            return jsonify({"ok": True, "events": out})
        except Exception as ex:
            logger.exception("alert_promo_swipe_events")
            return jsonify({"ok": False, "error": str(ex), "events": []}), 500
        finally:
            db.close()

    @app.route("/api/alert/overall/waste-by-machine", methods=["GET", "OPTIONS"])
    def alert_overall_waste_by_machine():
        """
        Waste % per machine — same computation as monitoring-app-v1 waste-tab.js
        (motion area-overrides + Vendon vends for the Kuwait calendar day).

        Requires env MOTION_AREA_OVERRIDES_API_KEY (and optional MOTION_AREA_OVERRIDES_URL).

        Query: date=YYYY-MM-DD (default Kuwait today), maxWorkers=8
        """
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied

        date_str = (request.args.get("date") or "").strip() or _kuwait_date_today_iso()
        try:
            datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError:
            return jsonify({"error": "invalid_date"}), 400

        max_workers_raw = request.args.get("maxWorkers") or "8"
        try:
            max_workers = max(1, min(int(max_workers_raw), 24))
        except ValueError:
            max_workers = 8

        rows, err = vendon_fetch_machine_list(_vendon_get)
        if err:
            return jsonify({"error": err, "date": date_str, "byMachineId": {}}), 502

        mids: List[str] = []
        for m in rows:
            if m.get("id") is None:
                continue
            mid = str(m.get("id")).strip()
            mname = m.get("name") or mid
            if machine_row_excluded(str(mname), mid):
                continue
            mids.append(mid)

        if not MOTION_AREA_OVERRIDES_API_KEY:
            return jsonify(
                {
                    "date": date_str,
                    "byMachineId": {},
                    "skipped": True,
                    "reason": "MOTION_AREA_OVERRIDES_API_KEY not configured (same source as Monitor v1 waste tab)",
                }
            )

        by_machine: Dict[str, Any] = {}

        def job(mid: str) -> Tuple[str, Dict[str, Any]]:
            try:
                pct, e, meta = _waste_metrics_v1(mid, date_str)
                return mid, {"wastePct": pct, "error": e, **meta}
            except Exception as ex:
                return mid, {"wastePct": None, "error": str(ex)}

        with ThreadPoolExecutor(max_workers=max_workers) as ex:
            futs = {ex.submit(job, mid): mid for mid in mids}
            for fut in as_completed(futs):
                mid, payload = fut.result()
                by_machine[mid] = payload

        return jsonify({"date": date_str, "byMachineId": by_machine, "machinesProcessed": len(mids)})

    @app.route("/api/alert/overall/people-footfall", methods=["GET", "OPTIONS"])
    def alert_overall_people_footfall():
        """
        People Count (Monitor v1 / Videoloft): summed ``people_in`` from ``people_analytics_records``
        by summing **hour** buckets (live sync) with **date** fallback — same Videoloft source as ``GET /api/people-analytics``.

        Resolution order per Vendon machine id:
          1. ``alert_routes.DEFAULT`` map + optional ``alert_people_camera_map.json`` + ``ALERT_PEOPLE_CAMERA_MAP_JSON``
          2. Videoloft ``/devices`` list (cached; needs ``VIDEOLOFT_*`` like the sync worker) to resolve ``cameraNames``
          3. Optional ``ALERT_PEOPLE_FUZZY_MATCH=true`` substring match by machine display name.

        Dates: Kuwait calendar ranges per **compare preset** (default today vs yesterday).
        Query: preset=… and optional aStart/aEnd/bStart/bEnd for custom_vs_custom.
        """
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied

        preset = (request.args.get("preset") or "today_vs_yesterday").strip()
        tz_name = "Asia/Kuwait"
        tz = ZoneInfo(tz_name)
        today_s = _kuwait_date_today_iso()
        try:
            today_d = datetime.strptime(today_s, "%Y-%m-%d").date()
        except ValueError:
            return jsonify({"error": "invalid server date"}), 500

        (a_lo, a_hi), (b_lo, b_hi), label_a, label_b = _alert_preset_periods(
            preset,
            today_d,
            request.args.get("aStart"),
            request.args.get("aEnd"),
            request.args.get("bStart"),
            request.args.get("bEnd"),
        )
        yesterday_s = (today_d - timedelta(days=1)).isoformat()

        rows, verr = vendon_fetch_machine_list(_vendon_get)
        if verr:
            return jsonify({"error": verr, "today": today_s, "yesterday": yesterday_s, "byMachineId": {}}), 502

        mids_info: List[Tuple[str, str]] = []
        for m in rows:
            if m.get("id") is None:
                continue
            mid = str(m.get("id")).strip()
            mname = m.get("name") or mid
            if machine_row_excluded(str(mname), mid):
                continue
            mids_info.append((mid, str(mname)))

        cmap = _load_alert_people_camera_map()
        cameras = _get_videoloft_cameras_cached()

        resolved: Dict[str, Tuple[List[str], str]] = {}
        all_uidds: set = set()
        for mid, mname in mids_info:
            uids, src = _resolve_machine_people_uidds(mid, mname, cmap, cameras)
            resolved[mid] = (uids, src)
            for u in uids:
                all_uidds.add(u)

        pa = _pa_session()
        try:
            uf = frozenset(all_uidds)
            dates_needed: set = set()
            cur = a_lo
            while cur < a_hi:
                dates_needed.add(cur.isoformat())
                cur += timedelta(days=1)
            cur = b_lo
            while cur < b_hi:
                dates_needed.add(cur.isoformat())
                cur += timedelta(days=1)
            by_day_uidd: Dict[str, Dict[str, int]] = {}
            for ds in dates_needed:
                by_day_uidd[ds] = _sum_people_in_by_uidd_day(pa, uf, ds, tz_name)
        finally:
            pa.close()

        def _sum_uidds(uids: List[str], lo: date, hi: date) -> int:
            total = 0
            cur = lo
            while cur < hi:
                bucket = by_day_uidd.get(cur.isoformat()) or {}
                for u in uids:
                    total += int(bucket.get(u, 0) or 0)
                cur += timedelta(days=1)
            return total

        out: Dict[str, Any] = {}
        videoloft_ok = bool(cameras)
        for mid, mname in mids_info:
            uids, how = resolved.get(mid, ([], "no_mapping"))
            mapped = bool(uids)
            primary_in = _sum_uidds(uids, a_lo, a_hi) if mapped else None
            baseline_in = _sum_uidds(uids, b_lo, b_hi) if mapped else None
            trend_pct = None
            if mapped and baseline_in is not None and baseline_in > 0:
                trend_pct = ((float(primary_in) - float(baseline_in)) / float(baseline_in)) * 100.0
            hint = ""
            if not uids:
                hint = (
                    "no_camera_mapping"
                    if how == "no_mapping"
                    else (
                        "map_needs_cameras_or_cameraId"
                        if how == "no_uidd_for_map" and videoloft_ok
                        else "map_needs_videoloft_or_cameraId"
                    )
                )
            out[mid] = {
                "mapped": mapped,
                "primaryIn": primary_in if mapped else None,
                "baselineIn": baseline_in if mapped else None,
                "todayIn": primary_in if mapped else None,
                "yesterdayIn": baseline_in if mapped else None,
                "trendPct": trend_pct if mapped else None,
                "primaryLabel": label_a,
                "baselineLabel": label_b,
                "uidds": uids,
                "resolve": how,
                "hint": hint or None,
            }

        return jsonify(
            {
                "timezone": tz_name,
                "preset": preset,
                "today": today_s,
                "yesterday": yesterday_s,
                "dateAStart": a_lo.isoformat(),
                "dateAEnd": a_hi.isoformat(),
                "dateBStart": b_lo.isoformat(),
                "dateBEnd": b_hi.isoformat(),
                "labelA": label_a,
                "labelB": label_b,
                "videoloftDevicesLoaded": videoloft_ok,
                "byMachineId": out,
                "machinesProcessed": len(mids_info),
            }
        )

    @app.route("/api/alert/admin/machine-profiles/<path:machine_id>", methods=["DELETE", "OPTIONS"])
    def alert_admin_machine_profile_delete(machine_id: str):
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_admin()
        if denied:
            return denied
        db = _dash_session()
        try:
            row = db.query(AlertMachineProfile).filter(AlertMachineProfile.machine_id == machine_id).first()
            if not row:
                return jsonify({"error": "not_found"}), 404
            pat = (row.machine_name or row.machine_id or "").strip()
            db.delete(row)
            if pat:
                legacy = db.query(MachineCleaningSchedule).filter(MachineCleaningSchedule.name_pattern == pat).first()
                if legacy:
                    db.delete(legacy)
            db.commit()
            return jsonify({"ok": True})
        except Exception as ex:
            logger.exception("alert admin machine profile delete")
            db.rollback()
            return jsonify({"error": "delete_failed", "message": str(ex)}), 500
        finally:
            db.close()

    @app.route("/api/alert/workflow/operator-schedule", methods=["GET", "OPTIONS"])
    def alert_workflow_operator_schedule():
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        from leet_workflow_lib import get_operator_schedule

        machine_id = (request.args.get("machine_id") or request.args.get("machineId") or "").strip()
        return jsonify(get_operator_schedule(machine_id))

    @app.route("/api/alert/workflow/machine-attendance-map", methods=["GET", "OPTIONS"])
    def alert_workflow_machine_attendance_map():
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        from alert_workflow_cache_lib import (
            load_workflow_attendance_cache,
            refresh_workflow_attendance_cache_async,
            slice_workflow_attendance,
        )
        from leet_workflow_lib import get_machine_attendance_summaries

        raw = (request.args.get("machine_ids") or request.args.get("machineIds") or "").strip()
        machine_ids = [x.strip() for x in raw.split(",") if x.strip()]

        cached = load_workflow_attendance_cache()
        if cached is not None:
            refresh_workflow_attendance_cache_async()
            return jsonify(slice_workflow_attendance(cached, machine_ids))

        payload = get_machine_attendance_summaries(machine_ids, include_contact=False)
        refresh_workflow_attendance_cache_async()
        return jsonify(payload)

    @app.route("/api/alert/internal/workflow-attendance-refresh", methods=["POST", "OPTIONS"])
    def alert_internal_workflow_attendance_refresh():
        if request.method == "OPTIONS":
            return "", 204
        if not _check_secret():
            return jsonify({"error": "Unauthorized"}), 401
        from alert_workflow_cache_lib import refresh_workflow_attendance_cache

        try:
            res = refresh_workflow_attendance_cache()
            status = 200 if res.get("ok") else 502
            return jsonify(res), status
        except Exception as ex:
            logger.exception("alert_internal_workflow_attendance_refresh")
            return jsonify({"ok": False, "error": str(ex)}), 500

    @app.route("/api/alert/internal/daily-sales-elapsed-refresh", methods=["POST", "OPTIONS"])
    def alert_internal_daily_sales_elapsed_refresh():
        if request.method == "OPTIONS":
            return "", 204
        if not _check_secret():
            return jsonify({"error": "Unauthorized"}), 401
        try:
            payload, err_status = _refresh_daily_sales_elapsed_cache_internal()
            if err_status:
                return err_status
            return jsonify(
                {
                    "ok": True,
                    "asOfLocal": payload.get("asOfLocal"),
                    "fleetTodayKwd": payload.get("fleetTodayKwd"),
                    "machineCount": len(payload.get("byMachineId") or {}),
                }
            )
        except Exception as ex:
            logger.exception("alert_internal_daily_sales_elapsed_refresh")
            return jsonify({"ok": False, "error": str(ex)}), 500

    @app.route("/api/alert/workflow/cleaning", methods=["GET", "OPTIONS"])
    def alert_workflow_cleaning():
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        from leet_workflow_lib import get_cleaning

        machine_id = (request.args.get("machine_id") or request.args.get("machineId") or "").strip()
        return jsonify(get_cleaning(machine_id))

    @app.route("/api/alert/workflow/cleaning-map", methods=["GET", "OPTIONS"])
    def alert_workflow_cleaning_map():
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        from leet_workflow_lib import get_cleaning_map

        raw = (request.args.get("machine_ids") or request.args.get("machineIds") or "").strip()
        ids = [x.strip() for x in raw.split(",") if x.strip()]
        return jsonify(get_cleaning_map(ids))

    @app.route("/api/alert/workflow/tech-visit", methods=["GET", "OPTIONS"])
    def alert_workflow_tech_visit():
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        from leet_workflow_lib import get_tech_visit

        machine_id = (request.args.get("machine_id") or request.args.get("machineId") or "").strip()
        machine_name = (request.args.get("machine_name") or request.args.get("machineName") or "").strip()
        return jsonify(get_tech_visit(machine_id, machine_name or None))

    @app.route("/api/alert/workflow/go-check", methods=["POST", "OPTIONS"])
    def alert_workflow_go_check():
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        from leet_workflow_lib import post_go_check

        body = request.get_json(silent=True) or {}
        return jsonify(
            post_go_check(
                {
                    "machineId": body.get("machineId") or body.get("machine_id"),
                    "machineName": body.get("machineName") or body.get("machine_name"),
                    "errorType": body.get("errorType") or body.get("error_type"),
                    "message": body.get("message"),
                }
            )
        )

    @app.route("/api/alert/workflow/dm-operator", methods=["POST", "OPTIONS"])
    def alert_workflow_dm_operator():
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        from leet_workflow_lib import post_dm_operator

        body = request.get_json(silent=True) or {}
        return jsonify(
            post_dm_operator(
                {
                    "machineId": body.get("machineId") or body.get("machine_id"),
                    "operatorEmail": body.get("operatorEmail") or body.get("operator_email"),
                    "message": body.get("message"),
                }
            )
        )

    @app.route("/api/alert/workflow/cleaning-overdue", methods=["POST", "OPTIONS"])
    def alert_workflow_cleaning_overdue():
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        from leet_workflow_lib import post_cleaning_overdue

        body = request.get_json(silent=True) or {}
        return jsonify(
            post_cleaning_overdue(
                {
                    "machineId": body.get("machineId") or body.get("machine_id"),
                    "message": body.get("message"),
                    "overdueDate": body.get("overdueDate") or body.get("overdue_date"),
                }
            )
        )

    @app.route("/api/alert/workflow/qa-bullets", methods=["GET", "OPTIONS"])
    def alert_workflow_qa_bullets():
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        from leet_workflow_lib import qa_bullets

        audit_id = (request.args.get("audit_id") or request.args.get("auditId") or "").strip()
        return jsonify(qa_bullets(audit_id))

    @app.route("/api/alert/workflow/qa-report-download", methods=["GET", "OPTIONS"])
    def alert_workflow_qa_report_download():
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        from safetyculture_qa_lib import export_audit_pdf
        from flask import Response

        audit_id = (request.args.get("audit_id") or request.args.get("auditId") or "").strip()
        pdf_bytes, filename, err = export_audit_pdf(audit_id)
        if err or not pdf_bytes:
            return jsonify({"error": err or "export failed"}), 502
        safe_name = (filename or "qa-report.pdf").replace('"', "")
        return Response(
            pdf_bytes,
            mimetype="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{safe_name}"',
                "Cache-Control": "private, max-age=300",
            },
        )

    @app.route("/api/alert/area-owner-map", methods=["GET", "OPTIONS"])
    def alert_area_owner_map():
        """
        Machine id → Area owner person name (Admin → Area owners assignment).
        Used by Red Flags / Overall Owner box (highest priority over location tags).
        """
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        cache_key = "alert-area-owner-map:v1"
        cached = _alert_cache_get(cache_key, 120)
        if cached is not None:
            return jsonify(cached)
        db = _pa_session()
        try:
            rows = db.execute(
                text(
                    """
                    SELECT vendon_user_id, vendon_user_name, machine_ids, updated_at
                    FROM target_area_owner
                    ORDER BY updated_at DESC NULLS LAST
                    """
                )
            ).fetchall()
            by_machine: Dict[str, Dict[str, str]] = {}
            for r in rows:
                name = str(r.vendon_user_name or "").strip()
                uid = str(r.vendon_user_id or "").strip()
                if not name:
                    continue
                mids_raw = r.machine_ids
                if isinstance(mids_raw, str):
                    try:
                        mids_raw = json.loads(mids_raw)
                    except Exception:
                        mids_raw = []
                for mid in mids_raw or []:
                    mid_s = str(mid or "").strip()
                    if not mid_s or mid_s in by_machine:
                        continue
                    by_machine[mid_s] = {
                        "vendonUserId": uid,
                        "name": name,
                    }
            payload = {"ok": True, "byMachineId": by_machine}
            _alert_cache_set(cache_key, payload)
            return jsonify(payload)
        except Exception as ex:
            logger.exception("alert_area_owner_map")
            return jsonify({"ok": False, "error": str(ex), "byMachineId": {}}), 500
        finally:
            db.close()

    @app.route("/api/alert/admin/vendon-users", methods=["GET", "OPTIONS"])
    def alert_admin_vendon_users():
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_admin()
        if denied:
            return denied
        try:
            from target_vendon_users import fetch_vendon_users_for_target

            return jsonify({"users": fetch_vendon_users_for_target()})
        except Exception as ex:
            logger.exception("alert_admin_vendon_users")
            return jsonify({"error": str(ex), "users": []}), 500

    @app.route("/api/alert/admin/area-owners", methods=["GET", "OPTIONS"])
    def alert_admin_area_owners_list():
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_admin()
        if denied:
            return denied
        db = _pa_session()
        try:
            rows = db.execute(
                text(
                    """
                    SELECT vendon_user_id, vendon_user_name, machine_ids, login_username,
                           password_hash, updated_by, updated_at
                    FROM target_area_owner
                    ORDER BY vendon_user_name ASC
                    """
                )
            ).fetchall()
            catalog: Dict[str, str] = {}
            vendon_rows, _ = vendon_fetch_machine_list(_vendon_get)
            for m in vendon_rows or []:
                mid = str(m.get("id") or "").strip()
                if mid:
                    catalog[mid] = str(m.get("name") or mid).strip()
            out: List[Dict[str, Any]] = []
            for r in rows:
                mids_raw = r.machine_ids
                if isinstance(mids_raw, str):
                    try:
                        mids_raw = json.loads(mids_raw)
                    except Exception:
                        mids_raw = []
                machine_ids = [str(x) for x in (mids_raw or [])]
                out.append(
                    {
                        "vendonUserId": r.vendon_user_id,
                        "vendonUserName": r.vendon_user_name,
                        "machineIds": machine_ids,
                        "machines": [{"id": mid, "name": catalog.get(mid) or mid} for mid in machine_ids],
                        "loginUsername": r.login_username,
                        "hasLogin": bool(r.login_username and r.password_hash),
                        "updatedBy": r.updated_by,
                        "updatedAt": r.updated_at.isoformat() if r.updated_at else None,
                    }
                )
            return jsonify({"rows": out})
        except Exception as ex:
            logger.exception("alert_admin_area_owners_list")
            return jsonify({"error": str(ex), "rows": []}), 500
        finally:
            db.close()

    @app.route("/api/alert/admin/area-owners/<vendon_user_id>", methods=["PUT", "DELETE", "OPTIONS"])
    def alert_admin_area_owners_mutate(vendon_user_id: str):
        if request.method == "OPTIONS":
            return "", 204
        email, denied = _require_alert_admin()
        if denied:
            return denied
        uid = (vendon_user_id or "").strip()
        if not uid:
            return jsonify({"error": "vendon_user_id required"}), 400
        # target_area_owner lives in people_analytics (same as target-site / promo tables).
        db = _pa_session()
        try:
            if request.method == "DELETE":
                db.execute(text("DELETE FROM target_area_owner WHERE vendon_user_id = :id"), {"id": uid})
                db.commit()
                return jsonify({"ok": True})

            body = request.get_json(silent=True) or {}
            from target_site_routes import hash_area_password

            name = str(body.get("vendonUserName") or body.get("name") or "").strip()
            raw_ids = body.get("machineIds") or []
            if not isinstance(raw_ids, list):
                return jsonify({"error": "machineIds must be a list"}), 400
            machine_ids = [str(x).strip() for x in raw_ids if str(x).strip()]
            password = body.get("password") or body.get("newPassword")
            login_username = str(body.get("loginUsername") or "").strip().lower() or None

            db.execute(
                text(
                    """
                    INSERT INTO target_area_owner (vendon_user_id, vendon_user_name, machine_ids, updated_by, updated_at)
                    VALUES (:id, :name, CAST(:mids AS jsonb), :by, NOW())
                    ON CONFLICT (vendon_user_id) DO UPDATE SET
                      vendon_user_name = EXCLUDED.vendon_user_name,
                      machine_ids = EXCLUDED.machine_ids,
                      updated_by = EXCLUDED.updated_by,
                      updated_at = NOW()
                    """
                ),
                {"id": uid, "name": name or uid, "mids": json.dumps(machine_ids), "by": email},
            )
            if login_username or password:
                sets: List[str] = []
                params: Dict[str, Any] = {"id": uid}
                if login_username:
                    sets.append("login_username = :login")
                    params["login"] = login_username
                if password:
                    if len(str(password)) < 6:
                        return jsonify({"error": "Password must be at least 6 characters"}), 400
                    sets.append("password_hash = :phash")
                    params["phash"] = hash_area_password(str(password))
                if sets:
                    db.execute(
                        text(f"UPDATE target_area_owner SET {', '.join(sets)} WHERE vendon_user_id = :id"),
                        params,
                    )
            db.commit()
            return jsonify({"ok": True})
        except Exception as ex:
            db.rollback()
            logger.exception("alert_admin_area_owners_mutate")
            return jsonify({"error": str(ex)}), 500
        finally:
            db.close()

    @app.route("/api/alert/me/ui-prefs", methods=["GET", "PUT", "OPTIONS"])
    def alert_me_ui_prefs():
        """Per-user Alert UI preferences (column layouts, etc.)."""
        if request.method == "OPTIONS":
            return "", 204
        email, denied = _require_alert_read()
        if denied:
            return denied
        db = _dash_session()
        try:
            if request.method == "GET":
                row = db.query(AlertUserUiPrefs).filter(AlertUserUiPrefs.email == email).first()
                prefs = row.prefs if row and isinstance(row.prefs, dict) else {}
                return jsonify({"email": email, "prefs": prefs, "updatedAt": row.updated_at.isoformat() if row and row.updated_at else None})

            body = request.get_json(silent=True) or {}
            if not isinstance(body, dict):
                return jsonify({"error": "JSON object required"}), 400
            patch = body.get("prefs")
            if patch is None and "redFlagsColumns" in body:
                patch = {"redFlagsColumns": body.get("redFlagsColumns")}
            if not isinstance(patch, dict):
                return jsonify({"error": "prefs object required"}), 400

            row = db.query(AlertUserUiPrefs).filter(AlertUserUiPrefs.email == email).first()
            merged: Dict[str, Any] = dict(row.prefs) if row and isinstance(row.prefs, dict) else {}
            for key, val in patch.items():
                if isinstance(val, dict) and isinstance(merged.get(key), dict):
                    inner = dict(merged[key])
                    inner.update(val)
                    merged[key] = inner
                else:
                    merged[key] = val
            if row:
                row.prefs = merged
            else:
                row = AlertUserUiPrefs(email=email, prefs=merged)
                db.add(row)
            db.commit()
            db.refresh(row)
            return jsonify({"email": email, "prefs": row.prefs, "updatedAt": row.updated_at.isoformat() if row.updated_at else None})
        except Exception as ex:
            db.rollback()
            logger.exception("alert_me_ui_prefs")
            return jsonify({"error": str(ex)}), 500
        finally:
            db.close()

