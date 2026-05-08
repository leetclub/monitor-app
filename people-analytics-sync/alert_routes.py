from __future__ import annotations

import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlencode

import requests
from flask import jsonify, request, session as flask_session
from sqlalchemy.orm import Session

from dashboard_access_models import (
    AlertMachineProfile,
    MachineCleaningSchedule,
    RedAlertSnapshotCache,
    create_dashboard_engine_and_session,
)
from dashboard_access_routes import resolve_session_allowed_tabs
from vendon_machine_helpers import (
    machine_row_excluded,
    vendon_fetch_machine_list,
    vendon_json_api_error_message,
    vendon_machine_tag_for_alert_admin_detail,
)
from vendon_proxy_routes import compute_remote_credits_logs_classic
from models import PeopleAnalyticsRecord, VendonDailyMachineRevenueCache, create_engine_and_session
from sqlalchemy import func

logger = logging.getLogger(__name__)

VENDON_API_BASE = (os.environ.get("VENDON_API_BASE") or "").strip().rstrip("/")
VENDON_API_KEY = (os.environ.get("VENDON_API_KEY") or "").strip()

# monitoring-app-v1 waste-tab.js: motion area-overrides + Vendon /stats/vends (same formula).
MOTION_AREA_OVERRIDES_URL = (
    os.environ.get("MOTION_AREA_OVERRIDES_URL") or "https://motion.theleetclub.com/api/area-overrides"
).strip().rstrip("/")
MOTION_AREA_OVERRIDES_API_KEY = (os.environ.get("MOTION_AREA_OVERRIDES_API_KEY") or "").strip()

_dash_session_factory = None
_pa_session_factory = None


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
        r = requests.get(url, headers=_vendon_headers(), timeout=120)
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


def _waste_metrics_v1(machine_id: str, date_str: str) -> Tuple[Optional[float], Optional[str], Dict[str, Any]]:
    """
    Port of monitoring-app-v1 calculateWaste / location aggregate (wastePercent formula).
    wastePercent = totalWaste / (totalSales + totalWaste) * 100 when denominator > 0.
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
    for sale in vends:
        if not isinstance(sale, dict):
            continue
        sid = sale.get("stock_id")
        if sid is None:
            continue
        k = str(sid)
        sales_by_stock[k] = sales_by_stock.get(k, 0) + 1

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

    denom = total_sales + total_waste
    if denom <= 0:
        return 0.0, None, {"totalWaste": total_waste, "totalSales": total_sales}
    pct = (float(total_waste) / float(denom)) * 100.0
    return pct, None, {"totalWaste": total_waste, "totalSales": total_sales}


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
    """Per-uidd summed ``people_in`` for interval ``date`` in the given local calendar day (Monitor-style)."""
    if not uidd_set:
        return {}
    start_naive_utc, end_naive_utc = _local_calendar_day_bounds_utc_naive(day_iso, tz_name)
    uid_list = list(uidd_set)
    rows = (
        pa_session.query(PeopleAnalyticsRecord.uidd, func.sum(PeopleAnalyticsRecord.people_in))
        .filter(PeopleAnalyticsRecord.interval_type == "date")
        .filter(PeopleAnalyticsRecord.uidd.in_(uid_list))
        .filter(PeopleAnalyticsRecord.first_timestamp >= start_naive_utc)
        .filter(PeopleAnalyticsRecord.first_timestamp <= end_naive_utc)
        .group_by(PeopleAnalyticsRecord.uidd)
        .all()
    )
    return {str(r[0]): int(r[1] or 0) for r in rows}


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
        options = sorted(set(tags_from_machines), key=lambda s: s.lower())
        return jsonify({"machines": machines, "location_owner_options": options})

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

    @app.route("/api/alert/remote-credits/today-totals", methods=["GET", "OPTIONS"])
    def alert_remote_credits_today_totals():
        """
        Lightweight summary for Alert boards:
        - credits_sent: total remote credits for the Kuwait calendar day
        - dispense_tests: Drink Tests count (same criteria as Monitor refund tests)
        """
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        try:
            kuwait_today = datetime.now(timezone.utc).astimezone(ZoneInfo("Asia/Kuwait")).date().isoformat()
            out = compute_remote_credits_logs_classic(kuwait_today, kuwait_today, "")
            totals = out.get("totals") if isinstance(out, dict) else None
            totals = totals if isinstance(totals, list) else []
            by_machine: Dict[str, Any] = {}
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
            return jsonify({"date": kuwait_today, "byMachineId": by_machine})
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
                            "priority": priority_out,
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
            oh = body.get("operator_hours")
            if oh is None:
                oh = []
            tech = body.get("technician_schedule")
            if tech is None:
                tech = []
            qa = body.get("qa_schedule")
            if qa is None:
                qa = []
            tz_s = (body.get("timezone") or "Asia/Kuwait").strip() or "Asia/Kuwait"
            priority = int(body.get("priority") or 10)

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
                row.updated_by = email
                row.updated_at = now
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
            db.commit()
            db.refresh(row)
            return jsonify({"ok": True, "machine_id": row.machine_id, "updated_by": email})
        except Exception as ex:
            logger.exception("alert admin machine profiles")
            db.rollback()
            return jsonify({"error": "save_failed", "message": str(ex)}), 500
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
            for r in rows:
                op0 = None
                if isinstance(r.operator_hours, list) and r.operator_hours:
                    first = r.operator_hours[0]
                    if isinstance(first, dict):
                        op0 = (first.get("name") or "").strip() or None
                out.append(
                    {
                        "machine_id": r.machine_id,
                        "location_owner": r.location_owner,
                        "location_hours": r.location_hours,
                        "operator_name": op0,
                        "timezone": r.timezone,
                        "operating_days": r.operating_days,
                        "cleaning_windows": r.cleaning_windows,
                        "operator_hours": r.operator_hours,
                        "technician_schedule": r.technician_schedule,
                        "qa_schedule": r.qa_schedule,
                        "priority": r.priority,
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
        Vendon-backed last transaction per machine (last 24h window).
        Used as a fallback for machines that are not present in the Red Alert snapshot.
        """
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        now = int(datetime.now(timezone.utc).timestamp())
        day_ago = now - 24 * 60 * 60
        params: Dict[str, Any] = {
            "from_timestamp": day_ago,
            "to_timestamp": now,
            "limit": 1000,
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

        return jsonify({"byMachineId": latest, "fromTimestamp": day_ago, "toTimestamp": now})

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

        if preset == "today_vs_same_day_last_week":
            a0 = today_kw
            b0 = today_kw - timedelta(days=7)
        else:
            # Default: today vs yesterday
            a0 = today_kw
            b0 = today_kw - timedelta(days=1)

        date_a = a0.isoformat()
        date_b = b0.isoformat()

        db = _pa_session()
        try:
            # Sum totals for each machine for each day (cache is per-day).
            rows = (
                db.query(
                    VendonDailyMachineRevenueCache.cache_date.label("cache_date"),
                    VendonDailyMachineRevenueCache.machine_id.label("machine_id"),
                    func.sum(VendonDailyMachineRevenueCache.total_sales_kwd).label("sales_kwd"),
                    func.sum(VendonDailyMachineRevenueCache.total_transactions).label("tx_count"),
                    func.max(VendonDailyMachineRevenueCache.payload_json).label("payload_json"),
                )
                .filter(VendonDailyMachineRevenueCache.cache_date.in_([a0, b0]))
                .group_by(VendonDailyMachineRevenueCache.cache_date, VendonDailyMachineRevenueCache.machine_id)
                .all()
            )

            by_machine: Dict[str, Dict[str, Any]] = {}
            for r in rows:
                mid = (r.machine_id or "").strip()
                if not mid:
                    continue
                ent = by_machine.get(mid) or {"machine_id": mid}
                if r.cache_date == a0:
                    ent["a"] = {
                        "date": date_a,
                        "salesKwd": float(r.sales_kwd or 0),
                        "tx": int(r.tx_count or 0),
                        "payload": r.payload_json or {},
                    }
                elif r.cache_date == b0:
                    ent["b"] = {
                        "date": date_b,
                        "salesKwd": float(r.sales_kwd or 0),
                        "tx": int(r.tx_count or 0),
                        "payload": r.payload_json or {},
                    }
                by_machine[mid] = ent

            out: Dict[str, Any] = {"preset": preset, "dateA": date_a, "dateB": date_b, "byMachineId": {}}
            for mid, ent in by_machine.items():
                a = ent.get("a")
                b = ent.get("b")
                a_sales = float(a.get("salesKwd") or 0) if isinstance(a, dict) else None
                b_sales = float(b.get("salesKwd") or 0) if isinstance(b, dict) else None
                trend_pct = None
                if a_sales is not None and b_sales is not None and b_sales > 0:
                    trend_pct = ((a_sales - b_sales) / b_sales) * 100.0
                payload = (a.get("payload") if isinstance(a, dict) else {}) or {}
                out["byMachineId"][mid] = {
                    "aSalesKwd": a_sales,
                    "bSalesKwd": b_sales,
                    "trendPct": trend_pct,
                    "peakHour": payload.get("peakHour"),
                    "topProduct": payload.get("topProduct"),
                    "lowProduct": payload.get("lowProduct"),
                }

            return jsonify(out)
        except Exception as ex:
            logger.exception("alert overall vendon sales summary")
            return jsonify({"error": "failed", "message": str(ex)}), 500
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
        for ``interval_type=date`` — same DB source as ``GET /api/people-analytics``.

        Resolution order per Vendon machine id:
          1. ``alert_routes.DEFAULT`` map + optional ``alert_people_camera_map.json`` + ``ALERT_PEOPLE_CAMERA_MAP_JSON``
          2. Videoloft ``/devices`` list (cached; needs ``VIDEOLOFT_*`` like the sync worker) to resolve ``cameraNames``
          3. Optional ``ALERT_PEOPLE_FUZZY_MATCH=true`` substring match by machine display name.

        Dates: Kuwait **today vs yesterday** (vs-yesterday trend matches Overall sales trend semantics).
        """
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied

        tz_name = "Asia/Kuwait"
        today_s = _kuwait_date_today_iso()
        try:
            d0 = datetime.strptime(today_s, "%Y-%m-%d").date()
            yesterday_s = (d0 - timedelta(days=1)).isoformat()
        except ValueError:
            return jsonify({"error": "invalid server date"}), 500

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
            by_today = _sum_people_in_by_uidd_day(pa, uf, today_s, tz_name)
            by_yest = _sum_people_in_by_uidd_day(pa, uf, yesterday_s, tz_name)
        finally:
            pa.close()

        out: Dict[str, Any] = {}
        videoloft_ok = bool(cameras)
        for mid, mname in mids_info:
            uids, how = resolved.get(mid, ([], "no_mapping"))
            mapped = bool(uids)
            today_in = 0
            yest_in = 0
            per_cam_today = {u: by_today.get(u, 0) for u in uids}
            per_cam_yest = {u: by_yest.get(u, 0) for u in uids}
            for u in uids:
                today_in += int(per_cam_today.get(u, 0) or 0)
                yest_in += int(per_cam_yest.get(u, 0) or 0)
            trend_pct = None
            if mapped and yest_in > 0:
                trend_pct = ((float(today_in) - float(yest_in)) / float(yest_in)) * 100.0
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
                "todayIn": today_in if mapped else None,
                "yesterdayIn": yest_in if mapped else None,
                "trendPct": trend_pct if mapped else None,
                "uidds": uids,
                "resolve": how,
                "hint": hint or None,
            }

        return jsonify(
            {
                "timezone": tz_name,
                "today": today_s,
                "yesterday": yesterday_s,
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

