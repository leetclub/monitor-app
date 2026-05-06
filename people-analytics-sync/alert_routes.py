from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
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
from vendon_machine_helpers import machine_row_excluded, vendon_machine_tag_for_alert_admin_detail
from vendon_proxy_routes import compute_remote_credits_logs_classic

logger = logging.getLogger(__name__)

VENDON_API_BASE = (os.environ.get("VENDON_API_BASE") or "").strip().rstrip("/")
VENDON_API_KEY = (os.environ.get("VENDON_API_KEY") or "").strip()

_dash_session_factory = None


def _dash_session() -> Session:
    global _dash_session_factory
    if _dash_session_factory is None:
        _, _dash_session_factory = create_dashboard_engine_and_session()
    return _dash_session_factory()


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
        return r.json(), None
    except Exception as ex:
        logger.exception("alert vendon_get")
        return None, str(ex)


def register_alert_routes(app) -> None:
    @app.route("/api/alert/machines", methods=["GET", "OPTIONS"])
    def alert_machines():
        if request.method == "OPTIONS":
            return "", 204
        _, denied = _require_alert_read()
        if denied:
            return denied
        data, err = _vendon_get("/machine", None)
        if err:
            return jsonify({"error": err, "machines": [], "location_owner_options": []}), 502
        rows = data.get("result") if isinstance(data, dict) else None
        rows = rows if isinstance(rows, list) else []
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
                        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
                    }
                )
            return jsonify({"rows": out})
        except Exception as ex:
            logger.exception("alert overall admin profiles")
            return jsonify({"error": "failed", "message": str(ex)}), 500
        finally:
            db.close()

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

