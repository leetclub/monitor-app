"""
Alert Operator Activity — last touch times aligned with Monitor calculations.

- cleaning: Attendance & Cleaning daily cleaning_end (power-interrupt 3+3 pattern cache)
- remoteCredit: proven attendance work_start (remote credit + power proof)
- doorOpen: last Vendon door-opened event
- refill: last \"All Products refilled\" event
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from vendon_constants import EVENT_NAME_MAPPING, EXCLUDED_EVENT_NAMES

logger = logging.getLogger(__name__)

VendonGet = Callable[[str, Optional[Dict[str, Any]]], Tuple[Optional[Dict], Optional[str]]]


def _iso_utc(ts: int) -> str:
    return (
        datetime.fromtimestamp(int(ts), tz=timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


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


def _is_refill_event(e: Dict[str, Any]) -> bool:
    disp = _map_display_name(e)
    if disp == "All Products refilled":
        return True
    n = ((e.get("name") or "") + " " + (e.get("base_code") or "")).lower()
    return "all products refilled" in n or n.strip() == "refilled"


def _event_ts(e: Dict[str, Any]) -> int:
    ra = e.get("received_at")
    try:
        ts = int(ra) if ra is not None else 0
    except (TypeError, ValueError):
        ts = 0
    return ts if ts > 0 else 0


def _is_technician_type(user_type: Optional[str], user_name: Optional[str] = None) -> bool:
    ut = str(user_type or "").strip().lower()
    if ut == "technician" or ("tech" in ut and "operator" not in ut):
        return True
    name = str(user_name or "").strip().lower()
    if "technician" in name or re.search(r"\btech\b", name):
        if "operator" not in name:
            return True
    return False


def _attendance_detail_from_rec(rec: Dict[str, Any], ts_i: int) -> Dict[str, Any]:
    return {
        "ts": ts_i,
        "userName": str(
            rec.get("user_name")
            or rec.get("operator_name")
            or rec.get("userName")
            or ""
        ).strip()
        or None,
        "userType": str(rec.get("user_type") or rec.get("userType") or "").strip() or None,
        "date": str(rec.get("date") or "").strip() or None,
        "proven": bool(rec.get("attendance_proven", True)),
        "status": str(rec.get("status") or "").strip() or None,
    }


def _parse_attendance_ts(raw: Any) -> int:
    if raw is None:
        return 0
    if isinstance(raw, (int, float)):
        return int(raw) if int(raw) > 0 else 0
    s = str(raw).strip()
    if not s:
        return 0
    try:
        return int(float(s)) if float(s) > 0 else 0
    except (TypeError, ValueError):
        pass
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return int(dt.timestamp())
    except Exception:
        return 0


def _ingest_attendance_payload(
    payload: Dict[str, Any],
    *,
    cleaning_best: Dict[str, int],
    credit_best: Dict[str, int],
    credit_detail: Dict[str, Dict[str, Any]],
    tech_detail: Dict[str, Dict[str, Any]],
    tech_name_by_mid: Optional[Dict[str, set]] = None,
) -> None:
    cleaning = payload.get("cleaning")
    cleaning = cleaning if isinstance(cleaning, list) else []
    for rec in cleaning:
        if not isinstance(rec, dict):
            continue
        mid = str(rec.get("machine_id") or "").strip()
        if not mid:
            continue
        end_i = _parse_attendance_ts(rec.get("cleaning_end"))
        if end_i > cleaning_best.get(mid, 0):
            cleaning_best[mid] = end_i

    attendance = payload.get("attendance")
    attendance = attendance if isinstance(attendance, list) else []
    for rec in attendance:
        if not isinstance(rec, dict):
            continue
        mid = str(rec.get("machine_id") or "").strip()
        if not mid:
            continue
        ts_i = _parse_attendance_ts(rec.get("work_start") or rec.get("attendance_time"))
        if ts_i <= 0:
            continue
        detail = _attendance_detail_from_rec(rec, ts_i)
        if ts_i > credit_best.get(mid, 0):
            credit_best[mid] = ts_i
            credit_detail[mid] = detail
        is_tech = _is_technician_type(detail.get("userType"), detail.get("userName"))
        if not is_tech and tech_name_by_mid:
            uname = str(detail.get("userName") or "").strip().lower()
            assigned = tech_name_by_mid.get(mid) or set()
            if uname and any(uname == a or uname in a or a in uname for a in assigned if a):
                is_tech = True
                detail = dict(detail)
                detail["userType"] = detail.get("userType") or "technician"
                detail["matchedAssignedTech"] = True
        if is_tech:
            prev = tech_detail.get(mid)
            if not prev or ts_i > int(prev.get("ts") or 0):
                tech_detail[mid] = detail


def _load_assigned_tech_names() -> Dict[str, set]:
    """machine_id → set of lowercased technician names from Alert Admin profiles."""
    out: Dict[str, set] = {}
    try:
        from dashboard_access_models import AlertMachineProfile, create_dashboard_engine_and_session

        _, SessionLocal = create_dashboard_engine_and_session()
        db = SessionLocal()
        try:
            for row in db.query(AlertMachineProfile).all():
                mid = str(row.machine_id or "").strip()
                if not mid:
                    continue
                names: set = set()
                raw = row.technician_schedule
                if isinstance(raw, list):
                    for item in raw:
                        if isinstance(item, dict):
                            n = str(item.get("name") or "").strip().lower()
                            if n:
                                names.add(n)
                if names:
                    out[mid] = names
        finally:
            db.close()
    except Exception:
        logger.exception("operator_activity load assigned tech names failed")
    return out


def _read_attendance_activity(
    days: List[str],
) -> Tuple[Dict[str, int], Dict[str, int], Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    """
    From attendance_snapshot_cache (Monitor Attendance & Cleaning):
    - Prefer exact Kuwait day keys
    - Also merge any recent cache payloads (last 21d) so UTC-key skew / missed warms still surface
    - Technician presence = user_type technician OR name matches Admin-assigned tech for that machine
    """
    cleaning_best: Dict[str, int] = {}
    credit_best: Dict[str, int] = {}
    credit_detail: Dict[str, Dict[str, Any]] = {}
    tech_detail: Dict[str, Dict[str, Any]] = {}
    if not days:
        return cleaning_best, credit_best, credit_detail, tech_detail
    try:
        from db_pool import cache_key as attendance_cache_key, get_conn as attendance_get_conn

        tech_name_by_mid = _load_assigned_tech_names()
        keys = [attendance_cache_key(d, d, "") for d in days if d]
        keys = [k for k in keys if k]
        payloads: List[Dict[str, Any]] = []
        with attendance_get_conn() as conn:
            with conn.cursor() as cur:
                if keys:
                    cur.execute(
                        "SELECT payload FROM attendance_snapshot_cache WHERE cache_key = ANY(%s)",
                        (keys,),
                    )
                    for row in cur.fetchall() or []:
                        if row and isinstance(row[0], dict):
                            payloads.append(row[0])
                # Fallback: recent warms even if day-key mapping drifted (UTC vs Kuwait).
                cur.execute(
                    """
                    SELECT payload FROM attendance_snapshot_cache
                    WHERE generated_at > NOW() - INTERVAL '21 days'
                    ORDER BY generated_at DESC
                    LIMIT 40
                    """
                )
                for row in cur.fetchall() or []:
                    if row and isinstance(row[0], dict):
                        payloads.append(row[0])
        seen_payload = 0
        for payload in payloads:
            seen_payload += 1
            _ingest_attendance_payload(
                payload,
                cleaning_best=cleaning_best,
                credit_best=credit_best,
                credit_detail=credit_detail,
                tech_detail=tech_detail,
                tech_name_by_mid=tech_name_by_mid,
            )
        if seen_payload == 0:
            logger.warning("operator_activity: no attendance_snapshot_cache payloads in lookback")
    except Exception:
        logger.exception("operator_activity attendance cache read failed")
    return cleaning_best, credit_best, credit_detail, tech_detail


def _fallback_manual_cleaning() -> Dict[str, int]:
    """live_machine_config.last_cleaning_at when attendance cache misses."""
    out: Dict[str, int] = {}
    try:
        from dashboard_access_models import LiveMachineConfig, create_dashboard_engine_and_session

        _, SessionLocal = create_dashboard_engine_and_session()
        db = SessionLocal()
        try:
            for row in db.query(LiveMachineConfig).all():
                mid = str(row.machine_id or "").strip()
                if not mid or not row.last_cleaning_at:
                    continue
                dt = row.last_cleaning_at
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                out[mid] = int(dt.timestamp())
        finally:
            db.close()
    except Exception:
        logger.exception("operator_activity manual cleaning fallback failed")
    return out


def _scan_events_door_refill(
    vendon_get: VendonGet, from_ts: int, to_ts: int
) -> Tuple[Dict[str, int], Dict[str, int], Optional[str]]:
    door: Dict[str, int] = {}
    refill: Dict[str, int] = {}
    off = 0
    page_limit = 500
    while off < 20000:
        params = {
            "from_timestamp": from_ts,
            "to_timestamp": to_ts,
            "limit": page_limit,
            "offset": off,
        }
        data, err = vendon_get("/event", params)
        if err:
            return door, refill, err
        chunk = data.get("result") if isinstance(data, dict) else None
        chunk = chunk if isinstance(chunk, list) else []
        for e in chunk:
            if not isinstance(e, dict):
                continue
            name = e.get("name") or ""
            base = e.get("base_code") or ""
            if name in EXCLUDED_EVENT_NAMES or base in EXCLUDED_EVENT_NAMES:
                continue
            mid = str(e.get("machine_id") or e.get("machine") or "").strip()
            if not mid:
                continue
            ts = _event_ts(e)
            if ts <= 0:
                continue
            if _is_door_event(e) and ts > door.get(mid, 0):
                door[mid] = ts
            if _is_refill_event(e) and ts > refill.get(mid, 0):
                refill[mid] = ts
        if len(chunk) < page_limit:
            break
        off += page_limit
    return door, refill, None


def compute_operator_activity(
    vendon_get: VendonGet,
    *,
    history_days: int = 14,
    allowed_machine_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Build byMachineId activity map. Timestamps are ISO-8601 UTC (Z).
    """
    now = datetime.now(timezone.utc)
    kuwait_today = now.astimezone(ZoneInfo("Asia/Kuwait")).date()
    # Include today + prior days (attendance cron often has yesterday+; today may be partial).
    days = [(kuwait_today - timedelta(days=i)).isoformat() for i in range(0, max(1, history_days))]
    cleaning_ts, credit_ts, credit_detail, tech_detail = _read_attendance_activity(days)
    manual_clean = _fallback_manual_cleaning()
    for mid, ts in manual_clean.items():
        if ts > cleaning_ts.get(mid, 0):
            cleaning_ts[mid] = ts

    to_ts = int(now.timestamp())
    from_ts = to_ts - int(history_days) * 86400
    door_ts, refill_ts, ev_err = _scan_events_door_refill(vendon_get, from_ts, to_ts)
    if ev_err:
        logger.warning("operator_activity event scan: %s", ev_err)

    ids = set(allowed_machine_ids or [])
    if not ids:
        ids = set(cleaning_ts) | set(credit_ts) | set(door_ts) | set(refill_ts) | set(tech_detail)

    kuwait_today_iso = kuwait_today.isoformat()
    by_machine: Dict[str, Any] = {}
    for mid in sorted(ids):
        mid = str(mid).strip()
        if not mid:
            continue
        row: Dict[str, Any] = {
            "cleaningAt": _iso_utc(cleaning_ts[mid]) if cleaning_ts.get(mid) else None,
            "refillAt": _iso_utc(refill_ts[mid]) if refill_ts.get(mid) else None,
            "remoteCreditAt": _iso_utc(credit_ts[mid]) if credit_ts.get(mid) else None,
            "doorOpenAt": _iso_utc(door_ts[mid]) if door_ts.get(mid) else None,
        }
        detail = credit_detail.get(mid)
        if detail and detail.get("ts"):
            row["physicalAttendance"] = {
                "at": _iso_utc(int(detail["ts"])),
                "userName": detail.get("userName"),
                "userType": detail.get("userType"),
                "date": detail.get("date"),
                "proven": bool(detail.get("proven", True)),
                "status": detail.get("status"),
                "isToday": str(detail.get("date") or "") == kuwait_today_iso,
            }
        else:
            row["physicalAttendance"] = None
        tech = tech_detail.get(mid)
        if tech and tech.get("ts"):
            row["technicianPhysicalAttendance"] = {
                "at": _iso_utc(int(tech["ts"])),
                "userName": tech.get("userName"),
                "userType": tech.get("userType") or "technician",
                "date": tech.get("date"),
                "proven": bool(tech.get("proven", True)),
                "status": tech.get("status"),
                "isToday": str(tech.get("date") or "") == kuwait_today_iso,
            }
        else:
            row["technicianPhysicalAttendance"] = None
        # Latest of any activity — useful for column sort.
        latest = 0
        for key in ("cleaningAt", "refillAt", "remoteCreditAt", "doorOpenAt"):
            iso = row.get(key)
            if not iso:
                continue
            try:
                dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
                latest = max(latest, int(dt.timestamp()))
            except Exception:
                pass
        row["latestAt"] = _iso_utc(latest) if latest > 0 else None
        by_machine[mid] = row

    return {
        "timezone": "Asia/Kuwait",
        "asOf": now.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "historyDays": history_days,
        "comparisonNote": (
            "Cleaning + remote credit from Monitor Attendance & Cleaning cache "
            "(power-interrupt cleaning end; proven remote credit). "
            "technicianPhysicalAttendance = technician user_type OR name matches Admin-assigned tech. "
            "Door + refill from Vendon /event (Door opened / All Products refilled)."
        ),
        "eventScanError": ev_err,
        "byMachineId": by_machine,
    }
