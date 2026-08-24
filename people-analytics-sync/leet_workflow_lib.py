"""Leet Workflow / Task Manager proxy for Alert ops columns."""

from __future__ import annotations

import logging
import os
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

_BASE = (os.environ.get("LEET_WORKFLOW_API_BASE") or "").strip().rstrip("/")
_API_KEY = (os.environ.get("LEET_WORKFLOW_API_KEY") or os.environ.get("TASK_MANAGER_API_KEY") or "").strip()
_TIMEOUT = int(os.environ.get("LEET_WORKFLOW_API_TIMEOUT_SEC", "30"))


def workflow_configured() -> bool:
    return bool(_BASE and _API_KEY)


def _not_configured() -> Dict[str, Any]:
    if not _BASE:
        return {"configured": False, "error": "LEET_WORKFLOW_API_BASE not configured"}
    if not _API_KEY:
        return {"configured": False, "error": "LEET_WORKFLOW_API_KEY not configured"}
    return {"configured": False, "error": "Task Manager API not configured"}


def _with_configured(payload: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(payload)
    out.setdefault("configured", True)
    out.setdefault("scheduleSource", "task_manager")
    return out


def _operator_contact_fields(
    machine_id: str,
    operator_name: Optional[str],
    tm_email: Optional[str] = None,
    tm_phone: Optional[str] = None,
) -> Dict[str, Any]:
    """Vendon + Task Manager contact (email, phone, WhatsApp, Slack)."""
    try:
        from operator_contact_lib import resolve_operator_contact

        resolved = resolve_operator_contact(
            email=(tm_email or "").strip() or None,
            operator_name=(operator_name or "").strip() or None,
            machine_id=machine_id,
        )
    except Exception:
        logger.exception("operator contact enrich %s", machine_id)
        return {}
    out: Dict[str, Any] = {}
    email = resolved.get("email") or (tm_email or "").strip() or None
    phone = resolved.get("phone") or (tm_phone or "").strip() or None
    if email:
        out["operatorEmail"] = email
    if phone:
        out["operatorPhone"] = phone
    if resolved.get("whatsappUrl"):
        out["operatorWhatsappUrl"] = resolved.get("whatsappUrl")
    if resolved.get("slackDmUrl"):
        out["operatorSlackDmUrl"] = resolved.get("slackDmUrl")
    if resolved.get("operatorName"):
        out["operatorName"] = resolved.get("operatorName")
    src = resolved.get("emailSource")
    if src:
        out["contactSource"] = src
    elif tm_email:
        out["contactSource"] = "task_manager"
    return out


def _operator_schedule_from_task_manager(machine_id: str) -> Dict[str, Any]:
    from task_manager_client import (
        count_mtd_absent_late,
        get_active_schedule_period,
        get_schedule_period_detail,
        get_user_attendance_day,
        resolve_operator_for_machine_now,
    )

    period, err = get_active_schedule_period()
    if err or not period:
        return _with_configured({"error": err or "no active schedule period"})

    period_id = period.get("id")
    if period_id is None:
        return _with_configured({"error": "active period missing id"})

    detail, derr = get_schedule_period_detail(int(period_id))
    if derr or not detail:
        return _with_configured({"error": derr or "schedule period detail unavailable"})

    es, work_date = resolve_operator_for_machine_now(detail, machine_id)
    if not es:
        return _with_configured(
            {
                "operatorName": None,
                "present": None,
                "absentDaysMtd": None,
                "lateDaysMtd": None,
                "machineInCharge": None,
                "attendanceStatus": "not_scheduled",
                "attendanceStatusLabel": "Not scheduled",
            }
        )

    user = es.get("user") if isinstance(es.get("user"), dict) else {}
    user_id = user.get("id")
    operator_name = user.get("name") or user.get("email")
    tm_email = str(user.get("email") or "").strip() or None
    tm_phone = str(user.get("phone") or "").strip() or None
    machine_label = _machine_label_for_entry(es, machine_id, work_date)

    if user_id is None:
        return _with_configured(
            {
                "operatorName": operator_name,
                "machineInCharge": machine_label,
                "schedulePeriodName": detail.get("name") or period.get("name"),
                "workDate": work_date.isoformat(),
                "error": "scheduled user missing id",
            }
        )

    day_row, aerr = get_user_attendance_day(int(user_id), work_date)
    if aerr or not day_row:
        return _with_configured(
            {
                "operatorName": operator_name,
                "machineInCharge": machine_label,
                "schedulePeriodName": detail.get("name") or period.get("name"),
                "workDate": work_date.isoformat(),
                "error": aerr,
            }
        )

    status = day_row.get("attendance_status")
    state = day_row.get("state")
    present = status == "present" or state in ("working", "break")
    absent_mtd, late_mtd = count_mtd_absent_late(int(user_id), work_date)
    summary = day_row.get("summary") if isinstance(day_row.get("summary"), dict) else {}

    return _with_configured(
        {
            "operatorName": operator_name,
            "present": present if status in ("present", "absent", "pending") else None,
            "absentDaysMtd": absent_mtd,
            "lateDaysMtd": late_mtd,
            "machineInCharge": machine_label,
            "schedulePeriodName": detail.get("name") or period.get("name"),
            "attendanceStatus": status,
            "attendanceStatusLabel": day_row.get("attendance_status_label"),
            "state": state,
            "workDate": work_date.isoformat(),
            "todayClockIn": summary.get("clock_in_at"),
            "todayClockOut": summary.get("clock_out_at"),
            "positionType": es.get("position_type"),
            "positionLabel": es.get("position_label"),
            "taskManagerUserId": user_id,
            **_operator_contact_fields(machine_id, operator_name, tm_email, tm_phone),
        }
    )


def _machine_label_for_entry(es: Dict[str, Any], machine_id: str, on_date: date) -> Optional[str]:
    from task_manager_client import machine_id_matches, weekday_key

    day = (es.get("schedule") or {}).get(weekday_key(on_date))
    if not isinstance(day, dict):
        return None
    for m in day.get("vendon_machines") or []:
        if isinstance(m, dict) and machine_id_matches(m, machine_id):
            return str(m.get("name") or machine_id)
    vm = es.get("vendon_machine")
    if isinstance(vm, dict) and machine_id_matches(vm, machine_id):
        return str(vm.get("name") or machine_id)
    return None


def get_operator_schedule(machine_id: str) -> Dict[str, Any]:
    mid = (machine_id or "").strip()
    if not mid:
        return {"configured": workflow_configured(), "error": "machine_id required"}
    if not workflow_configured():
        return _not_configured()
    return _operator_schedule_from_task_manager(mid)


def _not_scheduled_attendance(machine_id: str, *, include_contact: bool = True) -> Dict[str, Any]:
    row: Dict[str, Any] = {
        "attendanceStatus": "not_scheduled",
        "attendanceStatusLabel": "Not scheduled",
        "pill": None,
    }
    if include_contact:
        row.update(_operator_contact_fields(machine_id, None))
    return row


def _build_attendance_map_for_ids(
    period_detail: Dict[str, Any],
    on_date: date,
    machine_ids: List[str],
    *,
    include_contact: bool = False,
) -> Dict[str, Any]:
    from task_manager_client import (
        attendance_pill,
        get_user_attendance_day,
        resolve_operator_for_machine_now,
    )

    by_machine: Dict[str, Any] = {}
    user_cache: Dict[str, Dict[str, Any]] = {}

    for mid in machine_ids:
        # Prefer nightshift-aware resolution; fall back to calendar on_date only if needed.
        es, work_date = resolve_operator_for_machine_now(period_detail, mid)
        if not es:
            from task_manager_client import find_operator_for_machine_on_date

            es = find_operator_for_machine_on_date(period_detail, mid, on_date)
            work_date = on_date
        if not es:
            by_machine[mid] = _not_scheduled_attendance(mid, include_contact=include_contact)
            continue
        user = es.get("user") if isinstance(es.get("user"), dict) else {}
        uid = user.get("id")
        operator_name = user.get("name") or user.get("email")
        tm_email = str(user.get("email") or "").strip() or None
        tm_phone = str(user.get("phone") or "").strip() or None
        contact = (
            _operator_contact_fields(mid, operator_name, tm_email, tm_phone) if include_contact else {}
        )
        if uid is None:
            by_machine[mid] = {
                "operatorName": contact.get("operatorName") or operator_name,
                "pill": None,
                "workDate": work_date.isoformat(),
                **contact,
            }
            continue
        uid_int = int(uid)
        cache_key = f"{uid_int}:{work_date.isoformat()}"
        if cache_key not in user_cache:
            day_row, _ = get_user_attendance_day(uid_int, work_date)
            user_cache[cache_key] = day_row or {}
        day_row = user_cache[cache_key]
        status = day_row.get("attendance_status")
        state = day_row.get("state")
        pill = attendance_pill(status, day_row.get("lateness_deduction"), state)
        by_machine[mid] = {
            "operatorName": contact.get("operatorName") or operator_name,
            "attendanceStatus": status,
            "attendanceStatusLabel": day_row.get("attendance_status_label"),
            "state": state,
            "present": status == "present" or state in ("working", "break"),
            "workDate": work_date.isoformat(),
            "pill": pill,
            **contact,
        }
    return by_machine


def get_machine_attendance_summaries(
    machine_ids: List[str],
    *,
    include_contact: bool = False,
) -> Dict[str, Any]:
    if not workflow_configured():
        return _not_configured()
    from task_manager_client import (
        get_active_schedule_period,
        get_schedule_period_detail,
        kuwait_today,
    )

    ids = [str(x).strip() for x in machine_ids if str(x).strip()]
    if not ids:
        return _with_configured({"byMachineId": {}})

    period, err = get_active_schedule_period()
    if err or not period:
        return _with_configured({"error": err or "no active schedule period", "byMachineId": {}})

    detail, derr = get_schedule_period_detail(int(period["id"]))
    if derr or not detail:
        return _with_configured({"error": derr or "schedule period detail unavailable", "byMachineId": {}})

    today = kuwait_today()
    by_machine = _build_attendance_map_for_ids(
        detail, today, ids, include_contact=include_contact
    )
    return _with_configured({"byMachineId": by_machine, "schedulePeriodName": detail.get("name")})


_dash_session_factory = None


def _dash_session():
    global _dash_session_factory
    if _dash_session_factory is None:
        from dashboard_access_models import create_dashboard_engine_and_session

        _, _dash_session_factory = create_dashboard_engine_and_session()
    return _dash_session_factory()


def _resolve_machine_name(machine_id: str) -> Optional[str]:
    mid = (machine_id or "").strip()
    if not mid:
        return None
    try:
        from dashboard_access_models import AlertMachineProfile

        db = _dash_session()
        try:
            prof = db.query(AlertMachineProfile).filter(AlertMachineProfile.machine_id == mid).first()
            if prof and prof.machine_name:
                return str(prof.machine_name).strip()
        finally:
            db.close()
    except Exception:
        logger.exception("resolve machine name for %s", mid)
    return None


def _parse_iso_ts(value: Any) -> Optional[datetime]:
    if value is None or value == "":
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _attendance_daily_cleaning_iso(machine_id: str) -> Optional[str]:
    """Latest Vendon-derived daily cleaning end from attendance snapshot cache."""
    mid = (machine_id or "").strip()
    if not mid:
        return None
    try:
        from db_pool import cache_key as attendance_cache_key, get_conn as attendance_get_conn
        from task_manager_client import kuwait_today

        today = kuwait_today()
        days = [(today - timedelta(days=i)).isoformat() for i in range(0, 4)]
        keys = [attendance_cache_key(d, d, "") for d in days if d]
        keys = [k for k in keys if k]
        if not keys:
            return None
        best_end: Optional[int] = None
        with attendance_get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT payload FROM attendance_snapshot_cache WHERE cache_key = ANY(%s)",
                    (keys,),
                )
                for row in cur.fetchall() or []:
                    payload = row[0] if row else None
                    if not isinstance(payload, dict):
                        continue
                    cleaning = payload.get("cleaning")
                    cleaning = cleaning if isinstance(cleaning, list) else []
                    for rec in cleaning:
                        if not isinstance(rec, dict):
                            continue
                        rec_mid = str(rec.get("machine_id") or "").strip()
                        if rec_mid != mid:
                            continue
                        end = rec.get("cleaning_end")
                        try:
                            end_i = int(end) if end is not None else 0
                        except (TypeError, ValueError):
                            end_i = 0
                        if end_i > 0 and (best_end is None or end_i > best_end):
                            best_end = end_i
        if best_end is None:
            return None
        return datetime.fromtimestamp(best_end, tz=timezone.utc).isoformat()
    except Exception:
        logger.exception("attendance daily cleaning lookup %s", mid)
        return None


def _last_cleaning_from_sources(machine_id: str) -> Tuple[Optional[str], Optional[str]]:
    mid = (machine_id or "").strip()
    if not mid:
        return None, None

    candidates: List[Tuple[datetime, str, str]] = []

    try:
        from dashboard_access_models import LiveMachineConfig

        db = _dash_session()
        try:
            cfg = db.query(LiveMachineConfig).filter(LiveMachineConfig.machine_id == mid).first()
            if cfg and cfg.last_cleaning_at:
                dt = cfg.last_cleaning_at
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                candidates.append((dt, dt.isoformat(), "live_dashboard"))
        finally:
            db.close()
    except Exception:
        logger.exception("live dashboard cleaning lookup %s", mid)

    cache_iso = _attendance_daily_cleaning_iso(mid)
    cache_dt = _parse_iso_ts(cache_iso)
    if cache_dt and cache_iso:
        candidates.append((cache_dt, cache_iso, "attendance_cache"))

    if not candidates:
        return None, None
    candidates.sort(key=lambda x: x[0], reverse=True)
    return candidates[0][1], candidates[0][2]


def _build_cleaning_payload(
    machine_id: str,
    workflow_row: Optional[Dict[str, Any]] = None,
    workflow_err: Optional[str] = None,
) -> Dict[str, Any]:
    mid = (machine_id or "").strip()
    iso, source = _last_cleaning_from_sources(mid)
    wf_iso = (workflow_row or {}).get("lastCleaningAt") if workflow_row else None
    if wf_iso:
        iso = str(wf_iso)
        source = "workflow"

    out = _with_configured(
        {
            "lastCleaningAt": iso,
            "cleaningSource": source,
            "commandCenterVerified": (workflow_row or {}).get("commandCenterVerified"),
            "comments": (workflow_row or {}).get("comments") or [],
            "media": (workflow_row or {}).get("media") or [],
            "highRisk": (workflow_row or {}).get("highRisk"),
            "ghostCheck": (workflow_row or {}).get("ghostCheck"),
        }
    )
    media = out.get("media") or []
    if media:
        for m in media:
            if not isinstance(m, dict):
                continue
            url = str(m.get("url") or "")
            label = str(m.get("label") or "").lower()
            if "monitor" in label:
                out.setdefault("monitorRecordUrl", url)
            elif "eod" in label:
                out.setdefault("eodVideoUrl", url)
            elif not out.get("videoUrl"):
                out["videoUrl"] = url

    cc = out.get("commandCenterVerified")
    if cc is True:
        out["note"] = "Command Center verified on Workflow"
    elif cc is False:
        out["note"] = "Uploaded on Workflow — pending Command Center verification"
    elif not iso:
        out["error"] = workflow_err or "cleaning API not available; no snapshot cleaning time found"
    return out


def get_cleaning(machine_id: str) -> Dict[str, Any]:
    mid = (machine_id or "").strip()
    if not mid:
        return {"configured": workflow_configured(), "error": "machine_id required"}
    if not workflow_configured():
        return _not_configured()

    workflow_row: Optional[Dict[str, Any]] = None
    workflow_err: Optional[str] = None
    try:
        from task_manager_client import get_machine_cleaning_record

        workflow_row, workflow_err = get_machine_cleaning_record(mid)
    except Exception:
        logger.exception("workflow cleaning lookup %s", mid)

    return _build_cleaning_payload(mid, workflow_row, workflow_err)


def get_cleaning_map(machine_ids: List[str]) -> Dict[str, Any]:
    if not workflow_configured():
        return _not_configured()
    ids = [str(x).strip() for x in machine_ids if str(x).strip()]
    batch: Dict[str, Tuple[Optional[Dict[str, Any]], Optional[str]]] = {}
    try:
        from task_manager_client import get_machine_cleaning_records_batch

        batch = get_machine_cleaning_records_batch(ids)
    except Exception:
        logger.exception("workflow cleaning batch lookup")
    by_machine: Dict[str, Any] = {}
    for mid in ids:
        row, err = batch.get(mid, (None, None))
        if row is None and not batch:
            by_machine[mid] = get_cleaning(mid)
        else:
            by_machine[mid] = _build_cleaning_payload(mid, row, err)
    return _with_configured({"byMachineId": by_machine})


def get_tech_visit(machine_id: str, machine_name: Optional[str] = None) -> Dict[str, Any]:
    mid = (machine_id or "").strip()
    if not mid:
        return {"configured": workflow_configured(), "error": "machine_id required"}
    if not workflow_configured():
        return _not_configured()

    tm_err: Optional[str] = None
    try:
        from task_manager_client import get_latest_quality_control_visit

        visit, tm_err = get_latest_quality_control_visit(mid)
        if visit and visit.get("lastVisitAt"):
            return _with_configured(visit)
    except Exception:
        logger.exception("tech visit Task Manager QC for %s", mid)
        tm_err = "Task Manager quality-control lookup failed"

    name = (machine_name or "").strip() or _resolve_machine_name(mid) or ""
    if name:
        try:
            from safetyculture_qa_lib import tech_visit_for_machine_name

            visit = tech_visit_for_machine_name(name)
            if visit and (visit.get("lastVisitAt") or visit.get("lastVisitDate")):
                out: Dict[str, Any] = {
                    "lastVisitAt": visit.get("lastVisitAt") or visit.get("lastVisitDate"),
                    "visitorName": visit.get("officerName"),
                    "comment": visit.get("summary"),
                    "source": "safetyculture",
                }
                if tm_err:
                    out["note"] = tm_err
                return _with_configured(out)
        except Exception:
            logger.exception("tech visit SafetyCulture fallback for %s", name)

    return _with_configured(
        {
            "error": tm_err or "No tech / QC visit found for this machine",
        }
    )


def _scheduled_operator_user_id(machine_id: str) -> Tuple[Optional[int], Dict[str, Any]]:
    schedule = get_operator_schedule(machine_id)
    raw = schedule.get("taskManagerUserId")
    try:
        uid = int(raw) if raw is not None else None
    except (TypeError, ValueError):
        uid = None
    return uid, schedule


def post_go_check(body: Dict[str, Any]) -> Dict[str, Any]:
    if not workflow_configured():
        return _not_configured()

    machine_id = str(body.get("machineId") or body.get("machine_id") or "").strip()
    machine_name = str(body.get("machineName") or body.get("machine_name") or machine_id).strip()
    error_type = str(body.get("errorType") or body.get("error_type") or "").strip()
    message = str(body.get("message") or "").strip()

    if not machine_id:
        return _with_configured({"ok": False, "error": "machineId required"})
    if not error_type:
        return _with_configured({"ok": False, "error": "errorType required"})
    if not message:
        return _with_configured({"ok": False, "error": "message required"})

    user_id, schedule = _scheduled_operator_user_id(machine_id)
    operator_name = str(schedule.get("operatorName") or "Operator").strip() or "Operator"
    operator_email = str(schedule.get("operatorEmail") or "").strip().lower()

    task_message = "\n".join(
        [
            "URGENT ACTION REQUIRED",
            "",
            f"Machine: {machine_name} (#{machine_id})",
            f"Operator: {operator_name}",
            f"Error type: {error_type}",
            "",
            message,
            "",
            "Due: 24 hours · Sent from Leet Alert GO CHECK",
        ]
    )

    if user_id is not None:
        try:
            from zoneinfo import ZoneInfo

            from task_manager_client import post_urgent_operator_task

            kwt = ZoneInfo("Asia/Kuwait")
            now = datetime.now(kwt)
            due = now + timedelta(hours=24)
            task, terr = post_urgent_operator_task(
                title=f"GO CHECK: {error_type}"[:120],
                user_id=user_id,
                message=task_message,
                vendon_id=machine_id,
                start_date=now.date().isoformat(),
                end_date=due.date().isoformat(),
                due_time=due.strftime("%H:%M"),
            )
            if terr is None:
                task_id = None
                if isinstance(task, dict):
                    task_id = task.get("id") or (task.get("task") or {}).get("id")
                return _with_configured(
                    {
                        "ok": True,
                        "delivery": "task_manager_received",
                        "taskId": task_id,
                        "operatorName": operator_name,
                        "operatorEmail": operator_email or None,
                        "taskManagerUserId": user_id,
                        "note": "Urgent task created in Workflow Received.",
                    }
                )
            tm_err = terr
        except Exception as ex:
            logger.exception("GO CHECK urgent-operator for %s", machine_id)
            tm_err = str(ex)
    else:
        tm_err = str(schedule.get("error") or "No scheduled operator user_id for this machine")

    slack_text = "\n".join(
        [
            ":rotating_light: *URGENT ACTION REQUIRED*",
            "",
            f"*Machine:* {machine_name} (#{machine_id})",
            f"*Operator:* {operator_name}",
            f"*Error type:* {error_type}",
            "",
            message,
            "",
            "_Due: 24 hours · Sent from Leet Alert GO CHECK_",
        ]
    )

    from slack_dm_lib import mailto_go_check_url, send_slack_dm_to_email, slack_dm_configured

    mailto_url = mailto_go_check_url(
        operator_email,
        machine_name=machine_name,
        machine_id=machine_id,
        error_type=error_type,
        message=message,
    )

    if slack_dm_configured() and operator_email:
        sent = send_slack_dm_to_email(operator_email, slack_text)
        if sent.get("ok"):
            return _with_configured(
                {
                    "ok": True,
                    "delivery": "slack_dm",
                    "operatorEmail": operator_email,
                    "operatorName": operator_name,
                    "slackUserId": sent.get("slackUserId"),
                    "note": f"Task Manager Received failed ({tm_err}); sent via Slack DM.",
                }
            )
        err = str(sent.get("error") or "Slack DM failed")
        if mailto_url:
            return _with_configured(
                {
                    "ok": False,
                    "error": f"{tm_err}; Slack: {err}",
                    "delivery": "none",
                    "operatorEmail": operator_email,
                    "operatorName": operator_name,
                    "mailtoUrl": mailto_url,
                    "note": "Open email fallback or ask ops to map operator email in Slack.",
                }
            )
        return _with_configured(
            {
                "ok": False,
                "error": f"{tm_err}; Slack: {err}",
                "operatorEmail": operator_email or None,
                "operatorName": operator_name,
            }
        )

    if mailto_url:
        return _with_configured(
            {
                "ok": False,
                "error": tm_err,
                "delivery": "mailto",
                "operatorEmail": operator_email,
                "operatorName": operator_name,
                "mailtoUrl": mailto_url,
                "note": "Task Manager write failed; use the email fallback.",
            }
        )

    return _with_configured(
        {
            "ok": False,
            "error": tm_err,
            "operatorName": operator_name,
            "note": "Could not create Workflow Received task or fall back to Slack/email.",
        }
    )


def post_dm_operator(body: Dict[str, Any]) -> Dict[str, Any]:
    if not workflow_configured():
        return _not_configured()

    machine_id = str(body.get("machineId") or body.get("machine_id") or "").strip()
    message = str(body.get("message") or "").strip()
    if not machine_id:
        return _with_configured({"ok": False, "error": "machineId required"})
    if not message:
        return _with_configured({"ok": False, "error": "message required"})

    user_id, schedule = _scheduled_operator_user_id(machine_id)
    operator_name = str(schedule.get("operatorName") or "Operator").strip() or "Operator"
    if user_id is None:
        return _with_configured(
            {
                "ok": False,
                "error": str(schedule.get("error") or "No scheduled operator user_id for this machine"),
                "operatorName": operator_name,
            }
        )

    try:
        from task_manager_client import post_direct_message

        row, err = post_direct_message(user_id=user_id, message=message)
        if err:
            return _with_configured(
                {
                    "ok": False,
                    "error": err,
                    "operatorName": operator_name,
                    "taskManagerUserId": user_id,
                }
            )
        dm_id = None
        if isinstance(row, dict):
            dm_id = row.get("id") or (row.get("direct_message") or {}).get("id")
        return _with_configured(
            {
                "ok": True,
                "delivery": "task_manager_dm",
                "directMessageId": dm_id,
                "operatorName": operator_name,
                "taskManagerUserId": user_id,
                "note": "Message delivered to operator Workflow inbox.",
            }
        )
    except Exception as ex:
        logger.exception("DM operator for %s", machine_id)
        return _with_configured({"ok": False, "error": str(ex), "operatorName": operator_name})


def post_cleaning_overdue(body: Dict[str, Any]) -> Dict[str, Any]:
    if not workflow_configured():
        return _not_configured()

    machine_id = str(body.get("machineId") or body.get("machine_id") or "").strip()
    message = str(body.get("message") or "").strip() or None
    overdue_date = str(body.get("overdueDate") or body.get("overdue_date") or "").strip() or None
    if not machine_id:
        return _with_configured({"ok": False, "error": "machineId required"})

    user_id, schedule = _scheduled_operator_user_id(machine_id)
    operator_name = str(schedule.get("operatorName") or "Operator").strip() or "Operator"
    if user_id is None:
        return _with_configured(
            {
                "ok": False,
                "error": str(schedule.get("error") or "No scheduled operator user_id for this machine"),
                "operatorName": operator_name,
            }
        )

    if not overdue_date:
        try:
            from task_manager_client import kuwait_today

            overdue_date = kuwait_today().isoformat()
        except Exception:
            overdue_date = date.today().isoformat()

    try:
        from task_manager_client import post_cleaning_overdue_notification

        row, err = post_cleaning_overdue_notification(
            user_id=user_id,
            vendon_id=machine_id,
            overdue_date=overdue_date,
            message=message,
        )
        if err:
            return _with_configured(
                {
                    "ok": False,
                    "error": err,
                    "operatorName": operator_name,
                    "taskManagerUserId": user_id,
                }
            )
        return _with_configured(
            {
                "ok": True,
                "delivery": "task_manager_cleaning_overdue",
                "operatorName": operator_name,
                "taskManagerUserId": user_id,
                "overdueDate": overdue_date,
                "payload": row if isinstance(row, dict) else None,
                "note": "Cleaning-overdue notification delivered to operator inbox.",
            }
        )
    except Exception as ex:
        logger.exception("cleaning-overdue for %s", machine_id)
        return _with_configured({"ok": False, "error": str(ex), "operatorName": operator_name})


def _heuristic_bullets_from_text(text: str, limit: int = 5) -> List[str]:
    raw = str(text or "").strip()
    if not raw:
        return []
    parts = re.split(r"[·\n;]+|\.\s+", raw)
    out: List[str] = []
    for p in parts:
        s = re.sub(r"\s+", " ", p).strip(" -•")
        if len(s) < 8:
            continue
        if s not in out:
            out.append(s)
        if len(out) >= limit:
            break
    if not out and raw:
        out = [raw[:240]]
    return out[:limit]


def qa_bullets(audit_id: str) -> Dict[str, Any]:
    aid = (audit_id or "").strip()
    if not aid:
        return {"configured": workflow_configured(), "error": "audit_id required", "bullets": []}

    try:
        from qa_ai_summary_lib import qa_ai_bullets_for_audit

        ai_payload = qa_ai_bullets_for_audit(aid)
        return {
            "configured": workflow_configured(),
            "bullets": ai_payload.get("bullets") or [],
            "summary": ai_payload.get("summary"),
            "score": ai_payload.get("score"),
            "source": ai_payload.get("source"),
            "aiConfigured": ai_payload.get("aiConfigured"),
            "aiError": ai_payload.get("aiError"),
            "error": ai_payload.get("error"),
        }
    except Exception as ex:
        logger.exception("qa_bullets for %s", aid)
        summary = ""
        try:
            from safetyculture_qa_lib import _get_audit, _summary_text, _extract_score

            detail = _get_audit(aid)
            if detail:
                score = _extract_score(detail)
                summary = _summary_text(detail, score)
        except Exception:
            logger.exception("qa_bullets safetyculture fallback for %s", aid)

        bullets = _heuristic_bullets_from_text(summary)
        return {
            "configured": workflow_configured(),
            "bullets": bullets,
            "source": "safetyculture_heuristic" if bullets else "none",
            "summary": summary or None,
            "error": str(ex),
        }
