"""
Alert Operator Activity — last touch times aligned with Monitor calculations.

- cleaning: Attendance & Cleaning daily cleaning_end (power-interrupt 3+3 pattern cache)
- remoteCredit: proven attendance work_start (remote credit + power proof)
- doorOpen: last Vendon door-opened event
- refill: last \"All Products refilled\" event
"""
from __future__ import annotations

import logging
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


def _read_attendance_activity(days: List[str]) -> Tuple[Dict[str, int], Dict[str, int]]:
    """
    From attendance_snapshot_cache (Monitor Attendance & Cleaning):
    - cleaning_end → last cleaning unix
    - attendance work_start / attendance_time → last proven remote credit unix
    """
    cleaning_best: Dict[str, int] = {}
    credit_best: Dict[str, int] = {}
    if not days:
        return cleaning_best, credit_best
    try:
        from db_pool import cache_key as attendance_cache_key, get_conn as attendance_get_conn

        keys = [attendance_cache_key(d, d, "") for d in days if d]
        keys = [k for k in keys if k]
        if not keys:
            return cleaning_best, credit_best
        payloads: List[Dict[str, Any]] = []
        with attendance_get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT payload FROM attendance_snapshot_cache WHERE cache_key = ANY(%s)",
                    (keys,),
                )
                for row in cur.fetchall() or []:
                    if row and isinstance(row[0], dict):
                        payloads.append(row[0])
        for payload in payloads:
            cleaning = payload.get("cleaning")
            cleaning = cleaning if isinstance(cleaning, list) else []
            for rec in cleaning:
                if not isinstance(rec, dict):
                    continue
                mid = str(rec.get("machine_id") or "").strip()
                if not mid:
                    continue
                end = rec.get("cleaning_end")
                try:
                    end_i = int(end) if end is not None else 0
                except Exception:
                    end_i = 0
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
                raw = rec.get("work_start") or rec.get("attendance_time")
                try:
                    ts_i = int(raw) if raw is not None else 0
                except Exception:
                    ts_i = 0
                if ts_i > credit_best.get(mid, 0):
                    credit_best[mid] = ts_i
    except Exception:
        logger.exception("operator_activity attendance cache read failed")
    return cleaning_best, credit_best


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
    cleaning_ts, credit_ts = _read_attendance_activity(days)
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
        ids = set(cleaning_ts) | set(credit_ts) | set(door_ts) | set(refill_ts)

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
            "Door + refill from Vendon /event (Door opened / All Products refilled)."
        ),
        "eventScanError": ev_err,
        "byMachineId": by_machine,
    }
