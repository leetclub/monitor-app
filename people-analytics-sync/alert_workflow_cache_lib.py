"""DB-backed workflow attendance cache for Alert Live Op (cron-warmed)."""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_REFRESH_LOCK = threading.Lock()
_REFRESH_IN_FLIGHT = False

_dash_session_factory = None


def _dash_session():
    global _dash_session_factory
    if _dash_session_factory is None:
        from dashboard_access_models import create_dashboard_engine_and_session

        _, _dash_session_factory = create_dashboard_engine_and_session()
    return _dash_session_factory()


def _machine_ids_scheduled_today(period_detail: Dict[str, Any], on_date) -> List[str]:
    from task_manager_client import weekday_key

    day_key = weekday_key(on_date)
    ids: set[str] = set()
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
        for m in machines:
            if not isinstance(m, dict):
                continue
            for key in ("vendon_id", "id"):
                vid = str(m.get(key) or "").strip()
                if vid:
                    ids.add(vid)
    return sorted(ids)


def _not_scheduled_row() -> Dict[str, Any]:
    return {
        "attendanceStatus": "not_scheduled",
        "attendanceStatusLabel": "Not scheduled",
        "pill": None,
    }


def compute_workflow_attendance_payload() -> Dict[str, Any]:
    """Build fleet attendance map (no Vendon contact enrichment — fast for cron)."""
    from leet_workflow_lib import workflow_configured, _not_configured, _with_configured
    from task_manager_client import (
        attendance_pill,
        find_operator_for_machine_on_date,
        get_active_schedule_period,
        get_schedule_period_detail,
        get_user_attendance_day,
        kuwait_today,
    )

    if not workflow_configured():
        return _not_configured()

    period, err = get_active_schedule_period()
    if err or not period:
        return _with_configured({"error": err or "no active schedule period", "byMachineId": {}})

    detail, derr = get_schedule_period_detail(int(period["id"]))
    if derr or not detail:
        return _with_configured({"error": derr or "schedule period detail unavailable", "byMachineId": {}})

    today = kuwait_today()
    machine_ids = _machine_ids_scheduled_today(detail, today)
    by_machine: Dict[str, Any] = {}
    user_cache: Dict[int, Dict[str, Any]] = {}

    for mid in machine_ids:
        es = find_operator_for_machine_on_date(detail, mid, today)
        if not es:
            by_machine[mid] = _not_scheduled_row()
            continue
        user = es.get("user") if isinstance(es.get("user"), dict) else {}
        uid = user.get("id")
        operator_name = user.get("name") or user.get("email")
        if uid is None:
            by_machine[mid] = {"operatorName": operator_name, "pill": None}
            continue
        uid_int = int(uid)
        if uid_int not in user_cache:
            day_row, _ = get_user_attendance_day(uid_int, today)
            user_cache[uid_int] = day_row or {}
        day_row = user_cache[uid_int]
        status = day_row.get("attendance_status")
        state = day_row.get("state")
        pill = attendance_pill(status, day_row.get("lateness_deduction"), state)
        by_machine[mid] = {
            "operatorName": operator_name,
            "attendanceStatus": status,
            "attendanceStatusLabel": day_row.get("attendance_status_label"),
            "state": state,
            "present": status == "present" or state in ("working", "break"),
            "pill": pill,
        }

    return _with_configured(
        {
            "byMachineId": by_machine,
            "schedulePeriodName": detail.get("name"),
            "machineCount": len(by_machine),
        }
    )


def _load_cache_row():
    from dashboard_access_models import AlertWorkflowAttendanceCache

    db = _dash_session()
    try:
        return db.query(AlertWorkflowAttendanceCache).filter(AlertWorkflowAttendanceCache.id == 1).first()
    finally:
        db.close()


def save_workflow_attendance_cache(payload: Optional[Dict[str, Any]], err: Optional[str]) -> None:
    from dashboard_access_models import AlertWorkflowAttendanceCache
    from sqlalchemy import text

    db = _dash_session()
    try:
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
        """
            )
        )
        db.commit()
        row = db.query(AlertWorkflowAttendanceCache).filter(AlertWorkflowAttendanceCache.id == 1).first()
        if not row:
            row = AlertWorkflowAttendanceCache(id=1, payload_json={})
            db.add(row)
        if err:
            row.compute_error = err
            db.commit()
            return
        row.payload_json = payload or {}
        row.generated_at = datetime.now(timezone.utc)
        row.compute_error = None
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def load_workflow_attendance_cache() -> Optional[Dict[str, Any]]:
    from sqlalchemy import text

    db = _dash_session()
    try:
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
        """
            )
        )
        db.commit()
        from dashboard_access_models import AlertWorkflowAttendanceCache

        row = db.query(AlertWorkflowAttendanceCache).filter(AlertWorkflowAttendanceCache.id == 1).first()
    finally:
        db.close()
    if not row or not isinstance(row.payload_json, dict):
        return None
    payload = dict(row.payload_json)
    if row.generated_at:
        payload["cacheGeneratedAt"] = row.generated_at.isoformat()
    if row.compute_error:
        payload["cacheError"] = row.compute_error
    by = payload.get("byMachineId")
    if not isinstance(by, dict) or not by:
        return None
    payload.setdefault("configured", True)
    return payload


def slice_workflow_attendance(cached: Dict[str, Any], machine_ids: List[str]) -> Dict[str, Any]:
    by = cached.get("byMachineId") if isinstance(cached.get("byMachineId"), dict) else {}
    out: Dict[str, Any] = {}
    for mid in machine_ids:
        ent = by.get(mid)
        out[mid] = ent if isinstance(ent, dict) else _not_scheduled_row()
    return {
        "configured": cached.get("configured", True),
        "schedulePeriodName": cached.get("schedulePeriodName"),
        "byMachineId": out,
        "fromCache": True,
        "cacheGeneratedAt": cached.get("cacheGeneratedAt"),
    }


def refresh_workflow_attendance_cache() -> Dict[str, Any]:
    payload = compute_workflow_attendance_payload()
    if payload.get("configured") is False or payload.get("error"):
        save_workflow_attendance_cache(None, str(payload.get("error") or "not configured"))
        return {"ok": False, "error": payload.get("error")}
    save_workflow_attendance_cache(payload, None)
    return {
        "ok": True,
        "machineCount": len(payload.get("byMachineId") or {}),
        "schedulePeriodName": payload.get("schedulePeriodName"),
    }


def refresh_workflow_attendance_cache_async() -> None:
    global _REFRESH_IN_FLIGHT

    row = _load_cache_row()
    if row and row.generated_at:
        age = (datetime.now(timezone.utc) - row.generated_at).total_seconds()
        if age < 120:
            return

    if _REFRESH_IN_FLIGHT:
        return

    def _run() -> None:
        global _REFRESH_IN_FLIGHT
        with _REFRESH_LOCK:
            if _REFRESH_IN_FLIGHT:
                return
            _REFRESH_IN_FLIGHT = True
        try:
            refresh_workflow_attendance_cache()
        except Exception:
            logger.exception("workflow attendance cache async refresh")
        finally:
            _REFRESH_IN_FLIGHT = False

    threading.Thread(target=_run, daemon=True).start()
