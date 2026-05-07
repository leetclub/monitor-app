"""
Red Alert tab — machines matching operational risk criteria (Vendon + live_machine_config).

Heavy aggregation runs on a schedule (POST /api/red-alert/internal/refresh); dashboard reads
from red_alert_snapshot_cache for fast responses.
"""
from __future__ import annotations

import json
import logging
import os
import smtplib
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo

import requests
from flask import jsonify, request, session as flask_session
from sqlalchemy import text
from sqlalchemy.orm import Session

from cleaning_schedule import (
    count_stale_sale_episodes_adjusted,
    is_timestamp_in_cleaning,
    operational_gap_seconds,
    resolve_cleaning_context,
)
from dashboard_access_models import (
    DashboardAccessDefault,
    DashboardAccessUser,
    LiveMachineConfig,
    MachineCleaningSchedule,
    MachineOperatorLive,
    RedAlertSnapshotCache,
    create_dashboard_engine_and_session,
)
from dashboard_access_routes import ALL_DASHBOARD_TAB_IDS, SUPER_ADMIN_EMAILS, _check_secret
from vendon_constants import EVENT_NAME_MAPPING, EXCLUDED_EVENT_NAMES
from vendon_machine_helpers import machine_location_for_red_alert, machine_row_excluded
from db_pool import cache_key as attendance_cache_key, get_conn as attendance_get_conn

logger = logging.getLogger(__name__)

VENDON_API_BASE = (os.environ.get("VENDON_API_BASE") or "").strip().rstrip("/")
VENDON_API_KEY = (os.environ.get("VENDON_API_KEY") or "").strip()

TX_STALE_MIN = 30
STALE_SALE_SEC = 30 * 60
OFF_STALE_SEC = 30 * 60
VEND_FAIL_MIN_24H = 5
RAW_VEND_FAIL = "Product dispense/vend failed"

# Read cached snapshot if present and newer than this (seconds). Cron should run more often (e.g. every 2–3 min).
RED_ALERT_CACHE_TTL_SEC = int(os.environ.get("RED_ALERT_CACHE_TTL_SEC", "300"))

_dash_session_factory = None

# Email alerts (optional; disabled unless explicitly enabled/configured)
RED_ALERT_EMAIL_ENABLED = (os.environ.get("RED_ALERT_EMAIL_ENABLED") or "").strip() in ("1", "true", "True", "yes", "YES")
RED_ALERT_EMAIL_COOLDOWN_MIN = int(os.environ.get("RED_ALERT_EMAIL_COOLDOWN_MIN", "180"))  # per machine+fingerprint

RED_ALERT_SMTP_HOST = (os.environ.get("RED_ALERT_SMTP_HOST") or "").strip()
RED_ALERT_SMTP_PORT = int(os.environ.get("RED_ALERT_SMTP_PORT", "587"))
RED_ALERT_SMTP_USER = (os.environ.get("RED_ALERT_SMTP_USER") or "").strip()
RED_ALERT_SMTP_PASS = (os.environ.get("RED_ALERT_SMTP_PASS") or "").strip()
RED_ALERT_FROM_EMAIL = (os.environ.get("RED_ALERT_FROM_EMAIL") or RED_ALERT_SMTP_USER or "").strip()


def _smtp_send(to_email: str, subject: str, text_body: str) -> Optional[str]:
    """
    Minimal SMTP sender (STARTTLS). Returns error string or None on success.
    Intentionally no HTML to keep it robust across clients.
    """
    if not (RED_ALERT_SMTP_HOST and RED_ALERT_FROM_EMAIL and to_email):
        return "smtp_not_configured"
    if not (RED_ALERT_SMTP_USER and RED_ALERT_SMTP_PASS):
        return "smtp_auth_missing"
    try:
        # Avoid email.header dependency and keep ASCII-safe headers.
        subj = subject.replace("\r", " ").replace("\n", " ").strip()
        msg = (
            f"From: {RED_ALERT_FROM_EMAIL}\r\n"
            f"To: {to_email}\r\n"
            f"Subject: {subj}\r\n"
            "MIME-Version: 1.0\r\n"
            "Content-Type: text/plain; charset=utf-8\r\n"
            "\r\n"
            f"{text_body}\r\n"
        )
        with smtplib.SMTP(RED_ALERT_SMTP_HOST, RED_ALERT_SMTP_PORT, timeout=30) as s:
            s.ehlo()
            s.starttls()
            s.ehlo()
            s.login(RED_ALERT_SMTP_USER, RED_ALERT_SMTP_PASS)
            s.sendmail(RED_ALERT_FROM_EMAIL, [to_email], msg.encode("utf-8"))
        return None
    except Exception as ex:
        logger.exception("red_alert smtp_send failed")
        return str(ex)


def _ensure_red_alert_email_log_table(db: Session) -> None:
    db.execute(
        text(
            """
        CREATE TABLE IF NOT EXISTS red_alert_email_log (
            machine_id TEXT NOT NULL,
            alert_fingerprint TEXT NOT NULL,
            to_email TEXT,
            sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (machine_id, alert_fingerprint)
        );
    """
        )
    )


def _should_send_email(db: Session, machine_id: str, fingerprint: str, cooldown_min: int) -> bool:
    """
    Dedupe emails by machine + fingerprint. Also allow re-send after cooldown by overwriting row.
    """
    if not machine_id or not fingerprint:
        return False
    _ensure_red_alert_email_log_table(db)
    row = db.execute(
        text(
            """
        SELECT sent_at
        FROM red_alert_email_log
        WHERE machine_id = :mid AND alert_fingerprint = :fp
        """
        ),
        {"mid": machine_id, "fp": fingerprint},
    ).fetchone()
    if not row or not row[0]:
        return True
    try:
        sent_at: datetime = row[0]
        age_min = (datetime.now(timezone.utc) - sent_at.astimezone(timezone.utc)).total_seconds() / 60.0
        return age_min >= float(max(1, cooldown_min))
    except Exception:
        return True


def _mark_sent_email(db: Session, machine_id: str, fingerprint: str, to_email: str) -> None:
    _ensure_red_alert_email_log_table(db)
    db.execute(
        text(
            """
        INSERT INTO red_alert_email_log (machine_id, alert_fingerprint, to_email, sent_at)
        VALUES (:mid, :fp, :to_email, NOW())
        ON CONFLICT (machine_id, alert_fingerprint)
        DO UPDATE SET to_email = EXCLUDED.to_email, sent_at = NOW()
        """
        ),
        {"mid": machine_id, "fp": fingerprint, "to_email": to_email or None},
    )


def _build_red_alert_email(row: Dict[str, Any]) -> Tuple[str, str]:
    """
    Returns (subject, body) for operator notification.
    Template matches monitoring-app request (critical; plain text).
    """
    machine_name = (row.get("machineName") or row.get("machineId") or "Unknown").strip()
    location = (row.get("machineLocation") or "—").strip()
    reasons = row.get("reasons") or []
    reasons = reasons if isinstance(reasons, list) else [str(reasons)]
    top_reason = (str(reasons[0]).strip() if reasons else "Operational risk criteria triggered")
    # Derive a lightweight "code" from the primary condition present.
    code = "RED_ALERT"
    top_u = top_reason.upper()
    if "LAST TX" in top_u or "TRANSACTION" in top_u or "NO SALE" in top_u:
        code = "NO_TX"
    elif "OFF" in top_u:
        code = "OFF"
    elif "VEND FAILED" in top_u or "DISPENSE" in top_u:
        code = "VEND_FAIL"

    detected_at = (
        row.get("lastOffEventAtUtc")
        or row.get("lastTransactionAtUtc")
        or row.get("cacheGeneratedAt")
        or row.get("generatedAt")
        or datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    )

    subject = "(!!) CRITICAL Vending Machine Alert - Immediate Action Required"
    body = "\n".join(
        [
            "‼️  (( CRITICAL ALERT ))  ‼️",
            "",
            "⛔  An urgent issue has been detected on one of your vending machines. Please review the details immediately:",
            "",
            f"MACHINE ID: {machine_name}",
            f"LOCATION: {location}",
            f"ERROR CODE: {code}",
            f"DESCRIPTION: {top_reason}",
            f"TIME DETECTED: {detected_at}",
            "",
            "⚠️  ACTION REQUIRED ⚠️",
            "",
            "Immediate troubleshooting is necessary. Please prioritize resolving this issue and update the status once complete.",
            "",
            "*** Failure to act promptly may result in service disruption. ***",
            "",
            "Thank you for your immediate attention.",
            "",
            "Best regards,",
            "",
            "LEET Central Command",
        ]
    )
    return subject, body


def _send_red_alert_operator_emails(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Send operator emails for each machine currently on the board.
    Safe-by-default: no SMTP/env → no-op, and deduped by machine+primary reason.
    Returns summary dict for logging.
    """
    if not RED_ALERT_EMAIL_ENABLED:
        return {"enabled": False, "sent": 0, "skipped": 0, "errors": 0, "reason": "disabled"}
    if not (RED_ALERT_SMTP_HOST and RED_ALERT_SMTP_USER and RED_ALERT_SMTP_PASS and RED_ALERT_FROM_EMAIL):
        return {"enabled": True, "sent": 0, "skipped": 0, "errors": 0, "reason": "smtp_not_configured"}

    rows = payload.get("rows") if isinstance(payload, dict) else None
    rows = rows if isinstance(rows, list) else []
    sent = 0
    skipped = 0
    errors = 0
    db = _dash_session()
    try:
        _ensure_red_alert_email_log_table(db)
        db.commit()
        for row in rows:
            if not isinstance(row, dict):
                skipped += 1
                continue
            to_email = (row.get("operatorEmail") or "").strip()
            mid = (row.get("machineId") or "").strip()
            reasons = row.get("reasons") or []
            reasons = reasons if isinstance(reasons, list) else [str(reasons)]
            fp = (reasons[0] if reasons else "red_alert").strip() if isinstance((reasons[0] if reasons else "red_alert"), str) else str(reasons[0] if reasons else "red_alert")
            fingerprint = f"v1:{fp}"
            if not (to_email and "@" in to_email and mid):
                skipped += 1
                continue
            if not _should_send_email(db, mid, fingerprint, RED_ALERT_EMAIL_COOLDOWN_MIN):
                skipped += 1
                continue
            subject, body = _build_red_alert_email({**payload, **row})
            err = _smtp_send(to_email, subject, body)
            if err:
                errors += 1
                continue
            _mark_sent_email(db, mid, fingerprint, to_email)
            sent += 1
        db.commit()
    except Exception:
        logger.exception("red_alert send emails")
        db.rollback()
        return {"enabled": True, "sent": sent, "skipped": skipped, "errors": errors + 1, "reason": "exception"}
    finally:
        db.close()
    return {"enabled": True, "sent": sent, "skipped": skipped, "errors": errors, "cooldownMin": RED_ALERT_EMAIL_COOLDOWN_MIN}


def _kuwait_calendar_day_start_ts(now_utc: datetime) -> int:
    """Asia/Kuwait local midnight (start of calendar day) as Unix seconds."""
    tz = ZoneInfo("Asia/Kuwait")
    loc = now_utc.astimezone(tz)
    day0 = loc.replace(hour=0, minute=0, second=0, microsecond=0)
    return int(day0.timestamp())


def _iso_utc_z(ts: int) -> str:
    """UTC ISO with whole seconds + Z suffix (reliable in JS Date.parse)."""
    return (
        datetime.fromtimestamp(ts, tz=timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    )


def _kuwait_sunday_week_bounds(now_utc: datetime) -> Tuple[int, int, int, int]:
    """
    Kuwait weeks start Sunday 00:00 Asia/Kuwait.
    Returns (this_week_start_ts, this_week_end_ts_excl, last_week_start_ts, last_week_end_ts_excl)
    where last_week_end_ts_excl == this_week_start_ts.
    """
    tz = ZoneInfo("Asia/Kuwait")
    loc = now_utc.astimezone(tz)
    days_since_sunday = (loc.weekday() + 1) % 7  # Mon=0 .. Sun=6 → days back to Sunday
    week_start_local = loc.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days_since_sunday)
    this_ws = int(week_start_local.timestamp())
    this_we = this_ws + 7 * 86400
    last_ws = this_ws - 7 * 86400
    return this_ws, this_we, last_ws, this_ws


def _count_off_episodes_ge_threshold(
    off_events: List[Tuple[int, Optional[int]]],
    win_lo: int,
    win_hi_excl: int,
    now_ts: int,
    ctx: Any,
    thresh_sec: int,
) -> int:
    """
    Each Vendon OFF row is one episode. Count it for the window if the operational-time overlap
    inside [win_lo, win_hi_excl) is >= thresh_sec (cleaning windows subtracted).
    """
    if not off_events:
        return 0
    n = 0
    for rec, res_i in sorted(off_events, key=lambda x: x[0]):
        if rec <= 0:
            continue
        if is_timestamp_in_cleaning(rec, ctx):
            continue
        end_eff = res_i if res_i is not None else now_ts
        clip_lo = max(rec, win_lo)
        clip_hi = min(end_eff, win_hi_excl)
        if clip_lo >= clip_hi:
            continue
        if operational_gap_seconds(clip_lo, clip_hi, ctx) >= thresh_sec:
            n += 1
    return n


def _dash_session() -> Session:
    global _dash_session_factory
    if _dash_session_factory is None:
        _, _dash_session_factory = create_dashboard_engine_and_session()
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
    if "liveDashboard" in tabs:
        return list(tabs) + ["redAlert"]
    return tabs


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


def _gas_verify_email_tab(body: Any, tab_id: str) -> Optional[Any]:
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
        logger.exception("red_alert vendon_get")
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


def _fetch_all_vends(from_ts: int, to_ts: int) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    rows: List[Dict[str, Any]] = []
    off = 0
    page_limit = 500
    while off < 80000:
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


def _fetch_events_window(from_ts: int, to_ts: int, max_rows: int = 45000) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    out: List[Dict[str, Any]] = []
    off = 0
    page_limit = 500
    while len(out) < max_rows:
        params = {"from_timestamp": from_ts, "to_timestamp": to_ts, "limit": page_limit, "offset": off}
        data, err = _vendon_get("/event", params)
        if err:
            return [], err
        chunk = data.get("result") if isinstance(data, dict) else None
        chunk = chunk if isinstance(chunk, list) else []
        out.extend(chunk)
        if len(chunk) < page_limit:
            break
        off += page_limit
    return out[:max_rows], None


def _load_cache_row() -> Optional[RedAlertSnapshotCache]:
    db = _dash_session()
    try:
        return db.query(RedAlertSnapshotCache).filter(RedAlertSnapshotCache.id == 1).first()
    finally:
        db.close()


def _save_red_alert_cache(payload: Optional[Dict[str, Any]], err: Optional[str]) -> None:
    db = _dash_session()
    try:
        row = db.query(RedAlertSnapshotCache).filter(RedAlertSnapshotCache.id == 1).first()
        if not row:
            row = RedAlertSnapshotCache(id=1, payload_json={})
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


def _vend_looks_web_cashless(vend: Dict[str, Any]) -> bool:
    """Same heuristic as people-api remote-credits preload (Token /stats/vends only)."""
    try:
        js = json.dumps(vend or {}, ensure_ascii=False).upper()
        if "WEB" in js and "CASHLESS" in js:
            return True
        for k in ("payment_type", "payment_type_name", "type", "pay_type", "pay_type_name"):
            val = vend.get(k)
            if val is None:
                continue
            u = str(val).upper()
            if "WEB" in u or "CASHLESS" in u:
                return True
    except Exception:
        pass
    return False


def _ensure_machine_operator_live_table(db: Session) -> None:
    db.execute(
        text(
            """
        CREATE TABLE IF NOT EXISTS machine_operator_live (
            machine_id TEXT PRIMARY KEY,
            operator_name TEXT NOT NULL,
            last_credit_ts INTEGER,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    """
        )
    )


def _persist_last_web_operators(last_web_op: Dict[str, Tuple[str, int]]) -> None:
    """Upsert latest WEB-cashless operator per machine (Postgres, monitoring_dashboard)."""
    if not last_web_op:
        return
    db = _dash_session()
    try:
        _ensure_machine_operator_live_table(db)
        db.commit()
        now = datetime.now(timezone.utc)
        for mid, (name, ts_i) in last_web_op.items():
            mid_s = str(mid)
            row = db.query(MachineOperatorLive).filter(MachineOperatorLive.machine_id == mid_s).first()
            if row:
                row.operator_name = name
                row.last_credit_ts = int(ts_i) if ts_i else None
                row.updated_at = now
            else:
                db.add(
                    MachineOperatorLive(
                        machine_id=mid_s,
                        operator_name=name,
                        last_credit_ts=int(ts_i) if ts_i else None,
                        updated_at=now,
                    )
                )
        db.commit()
    except Exception:
        logger.exception("persist machine_operator_live")
        db.rollback()
    finally:
        db.close()


def _verify_hmac_browser_token(auth_header: str, purpose_expected: str) -> Tuple[Optional[str], Optional[str]]:
    """Verify short-lived token from GAS getBrowserApiToken_ (same contract as vendon_proxy_routes)."""
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

        pad = "=" * ((4 - (len(b64) % 4)) % 4)
        js = base64.urlsafe_b64decode((b64 + pad).encode("utf-8")).decode("utf-8")
    except Exception:
        return None, "bad_b64"
    secret = (os.environ.get("DASHBOARD_ACCESS_API_KEY") or "").strip()
    if not secret:
        return None, "server_secret_missing"
    try:
        import hashlib
        import hmac

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


def _compute_red_alert_payload() -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    to_ts = int(now.timestamp())
    ts_24h = to_ts - 86400
    ts_14d = to_ts - 14 * 86400
    ts_21d = to_ts - 21 * 86400
    ts_48h = to_ts - 48 * 3600
    this_ws, this_we, last_ws, last_we = _kuwait_sunday_week_bounds(now)

    def _read_attendance_daily_cleaning_cache(day_iso: str) -> Dict[str, str]:
        """
        Read attendance_snapshot_cache for a single Kuwait day and return machine_id -> ISO timestamp (UTC, Z) for the
        latest daily cleaning end time.

        This mirrors the "Attendance & Cleaning" derived daily cleaning logic (Vendon power event patterns) that operators
        rely on, without re-running the heavy aggregation inside the Red Alert refresh loop.
        """
        try:
            ck = attendance_cache_key(day_iso, day_iso, "")
            with attendance_get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT payload FROM attendance_snapshot_cache WHERE cache_key = %s",
                        (ck,),
                    )
                    row = cur.fetchone()
            if not row:
                return {}
            payload = row[0]
            if not isinstance(payload, dict):
                return {}
            cleaning = payload.get("cleaning")
            cleaning = cleaning if isinstance(cleaning, list) else []
            best_end: Dict[str, int] = {}
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
                if end_i <= 0:
                    continue
                prev = best_end.get(mid) or 0
                if end_i > prev:
                    best_end[mid] = end_i
            out: Dict[str, str] = {}
            for mid, end_i in best_end.items():
                out[mid] = (
                    datetime.fromtimestamp(int(end_i), tz=timezone.utc)
                    .replace(microsecond=0)
                    .isoformat()
                    .replace("+00:00", "Z")
                )
            return out
        except Exception:
            logger.exception("attendance_snapshot_cache read failed")
            return {}

    kuwait_today = now.astimezone(ZoneInfo("Asia/Kuwait")).date().isoformat()
    kuwait_yesterday = (now.astimezone(ZoneInfo("Asia/Kuwait")).date() - timedelta(days=1)).isoformat()
    daily_cleaning_end_iso_by_machine = _read_attendance_daily_cleaning_cache(kuwait_today)
    if not daily_cleaning_end_iso_by_machine:
        daily_cleaning_end_iso_by_machine = _read_attendance_daily_cleaning_cache(kuwait_yesterday)

    mdata, m_err = _vendon_get("/machine", None)
    if m_err:
        return {"error": m_err, "rows": []}
    mrows = mdata.get("result") if isinstance(mdata, dict) else None
    mrows = mrows if isinstance(mrows, list) else []
    machine_list = []
    for m in mrows:
        if m.get("id") is None:
            continue
        mid = str(m.get("id"))
        name = m.get("name") or mid
        if machine_row_excluded(name, mid):
            continue
        machine_list.append(
            {
                "id": mid,
                "name": name,
                "location": machine_location_for_red_alert(m),
            }
        )

    cleaning_rules: List[MachineCleaningSchedule] = []
    db_sched = _dash_session()
    try:
        cleaning_rules = db_sched.query(MachineCleaningSchedule).all()
    finally:
        db_sched.close()

    cleaning_by_mid: Dict[str, Any] = {}
    for m in machine_list:
        cleaning_by_mid[m["id"]] = resolve_cleaning_context(m["name"], cleaning_rules)

    vends_21d, ve = _fetch_all_vends(ts_21d, to_ts)
    if ve:
        logger.warning("red_alert vends: %s", ve)

    vends_by_mid: Dict[str, List[int]] = {}
    last_vend: Dict[str, int] = {}
    last_web_op: Dict[str, Tuple[str, int]] = {}
    for v in vends_21d:
        mid = str(v.get("machine_id") or v.get("machine") or "")
        if not mid:
            continue
        ts = v.get("timestamp") or v.get("time")
        try:
            ts_i = int(ts)
        except (TypeError, ValueError):
            continue
        vends_by_mid.setdefault(mid, []).append(ts_i)
        if ts_i > last_vend.get(mid, 0):
            last_vend[mid] = ts_i
        if _vend_looks_web_cashless(v):
            un = str(v.get("user_name") or "").strip()
            if un:
                prev = last_web_op.get(mid)
                if not prev or ts_i > prev[1]:
                    last_web_op[mid] = (un, ts_i)

    events_14d, ee = _fetch_events_window(ts_14d, to_ts)
    if ee:
        logger.warning("red_alert events 14d: %s", ee)

    fail_this_week: Dict[str, int] = {}
    fail_last_week: Dict[str, int] = {}
    fail_today: Dict[str, int] = {}
    fail_same_day_lw: Dict[str, int] = {}
    fail_yesterday: Dict[str, int] = {}
    fail_24h: Dict[str, int] = {}
    off_events_by_mid: Dict[str, List[Tuple[int, Optional[int]]]] = {}

    today_lo = _kuwait_calendar_day_start_ts(now)
    elapsed_today = max(0, to_ts - today_lo)
    lw_day_lo = today_lo - 7 * 86400
    lw_day_hi_excl = lw_day_lo + elapsed_today
    yesterday_lo = today_lo - 86400
    yesterday_hi_excl = yesterday_lo + elapsed_today

    for e in events_14d:
        name = e.get("name") or ""
        base = e.get("base_code") or ""
        if name in EXCLUDED_EVENT_NAMES or base in EXCLUDED_EVENT_NAMES:
            continue
        mid = str(e.get("machine_id") or e.get("machine") or "")
        if not mid:
            continue
        ra = e.get("received_at")
        try:
            rt = int(ra) if ra is not None else 0
        except (TypeError, ValueError):
            rt = 0
        if rt <= 0:
            continue

        ctx = cleaning_by_mid.get(mid)
        disp = _map_display_name(e)
        if disp in ("KNet OFF", "Machine OFF"):
            if not is_timestamp_in_cleaning(rt, ctx):
                res = e.get("resolved_at")
                try:
                    res_i = int(res) if res is not None else None
                except (TypeError, ValueError):
                    res_i = None
                off_events_by_mid.setdefault(mid, []).append((rt, res_i))

        if name != RAW_VEND_FAIL and base != RAW_VEND_FAIL:
            continue
        if is_timestamp_in_cleaning(rt, ctx):
            continue
        if this_ws <= rt < this_we:
            fail_this_week[mid] = fail_this_week.get(mid, 0) + 1
        if last_ws <= rt < last_we:
            fail_last_week[mid] = fail_last_week.get(mid, 0) + 1
        if today_lo <= rt < to_ts:
            fail_today[mid] = fail_today.get(mid, 0) + 1
        if lw_day_lo <= rt < lw_day_hi_excl:
            fail_same_day_lw[mid] = fail_same_day_lw.get(mid, 0) + 1
        if elapsed_today > 0 and yesterday_lo <= rt < yesterday_hi_excl:
            fail_yesterday[mid] = fail_yesterday.get(mid, 0) + 1
        if rt >= ts_24h:
            fail_24h[mid] = fail_24h.get(mid, 0) + 1

    off_bad: Dict[str, bool] = {}
    for e in events_14d:
        name = e.get("name") or ""
        base = e.get("base_code") or ""
        if name in EXCLUDED_EVENT_NAMES or base in EXCLUDED_EVENT_NAMES:
            continue
        disp = _map_display_name(e)
        if disp not in ("KNet OFF", "Machine OFF"):
            continue
        mid = str(e.get("machine_id") or e.get("machine") or "")
        if not mid:
            continue
        ra = e.get("received_at")
        try:
            rec = int(ra) if ra is not None else 0
        except (TypeError, ValueError):
            rec = 0
        if rec <= 0 or rec < ts_48h:
            continue
        ctx = cleaning_by_mid.get(mid)
        if is_timestamp_in_cleaning(rec, ctx):
            continue
        res = e.get("resolved_at")
        try:
            res_i = int(res) if res is not None else None
        except (TypeError, ValueError):
            res_i = None
        age = to_ts - rec
        if res_i is not None:
            continue
        if age >= OFF_STALE_SEC:
            off_bad[mid] = True

    db = _dash_session()
    configs: Dict[str, LiveMachineConfig] = {}
    try:
        for row in db.query(LiveMachineConfig).all():
            configs[row.machine_id] = row
    finally:
        db.close()

    rows_out: List[Dict[str, Any]] = []

    for m in machine_list:
        mid = m["id"]
        cfg = configs.get(mid)
        ctx = cleaning_by_mid.get(mid)

        sale_age_min: Optional[float] = None
        lv = last_vend.get(mid)
        if lv is not None:
            sale_age_min = (to_ts - lv) / 60.0
        last_tx_at_utc = _iso_utc_z(lv) if lv else None
        no_tx = lv is None or (sale_age_min is not None and sale_age_min >= float(TX_STALE_MIN))
        if no_tx and is_timestamp_in_cleaning(to_ts, ctx):
            no_tx = False

        vf = fail_24h.get(mid, 0)
        vend_fail_bad = vf >= VEND_FAIL_MIN_24H

        off_alert = off_bad.get(mid, False)

        if not (no_tx or off_alert or vend_fail_bad):
            continue

        reasons: List[str] = []
        if no_tx:
            reasons.append("Last tx ≥%s min" % TX_STALE_MIN)
        if off_alert:
            reasons.append("KNet/Machine OFF ≥%s min" % (OFF_STALE_SEC // 60))
        if vend_fail_bad:
            reasons.append("Vend failed ≥%s / 24h" % VEND_FAIL_MIN_24H)

        during_scheduled_cleaning_now = bool(ctx and is_timestamp_in_cleaning(to_ts, ctx))
        # Priority 2 = now falls inside DC cleaning windows — keep red flag but sort below tier 1.
        alert_priority_tier = 2 if during_scheduled_cleaning_now else 1
        if during_scheduled_cleaning_now:
            reasons.append(
                "Now inside scheduled cleaning window — downtime/OFF may be expected; "
                "frequency counts exclude KNet/Machine OFF, vend fails, and stale gaps that fall in these windows"
            )

        c_fail_tw = fail_this_week.get(mid, 0)
        c_fail_lw = fail_last_week.get(mid, 0)
        c_fail_td = fail_today.get(mid, 0)
        c_fail_ldw = fail_same_day_lw.get(mid, 0)
        vlist = vends_by_mid.get(mid, [])
        off_list = off_events_by_mid.get(mid, [])
        last_off_ts: Optional[int] = None
        if off_list:
            try:
                last_off_ts = max(rt for rt, _ in off_list)
            except ValueError:
                last_off_ts = None
        last_off_at_utc = _iso_utc_z(last_off_ts) if last_off_ts else None
        c_stale_tw = count_stale_sale_episodes_adjusted(vlist, this_ws, to_ts, ctx, STALE_SALE_SEC)
        c_stale_lw = count_stale_sale_episodes_adjusted(vlist, last_ws, last_we, ctx, STALE_SALE_SEC)
        c_off_tw = _count_off_episodes_ge_threshold(off_list, this_ws, this_we, to_ts, ctx, OFF_STALE_SEC)
        c_off_lw = _count_off_episodes_ge_threshold(off_list, last_ws, last_we, to_ts, ctx, OFF_STALE_SEC)

        if elapsed_today > 0:
            c_stale_td = count_stale_sale_episodes_adjusted(vlist, today_lo, to_ts, ctx, STALE_SALE_SEC)
            c_off_td = _count_off_episodes_ge_threshold(off_list, today_lo, to_ts, to_ts, ctx, OFF_STALE_SEC)
            lw_stale_end_incl = lw_day_lo + elapsed_today - 1
            c_stale_ldw = count_stale_sale_episodes_adjusted(vlist, lw_day_lo, lw_stale_end_incl, ctx, STALE_SALE_SEC)
            c_off_ldw = _count_off_episodes_ge_threshold(off_list, lw_day_lo, lw_day_hi_excl, to_ts, ctx, OFF_STALE_SEC)
            y_end_incl = yesterday_lo + elapsed_today - 1
            c_stale_y = count_stale_sale_episodes_adjusted(vlist, yesterday_lo, y_end_incl, ctx, STALE_SALE_SEC)
            c_off_y = _count_off_episodes_ge_threshold(off_list, yesterday_lo, yesterday_hi_excl, to_ts, ctx, OFF_STALE_SEC)
            c_fail_y = fail_yesterday.get(mid, 0)
        else:
            c_stale_td = 0
            c_off_td = 0
            c_stale_ldw = 0
            c_off_ldw = 0
            c_stale_y = 0
            c_off_y = 0
            c_fail_y = 0

        sum_tw = c_fail_tw + c_off_tw + c_stale_tw
        sum_lw = c_fail_lw + c_off_lw + c_stale_lw
        elapsed = max(0, to_ts - this_ws)
        week_sec = 7 * 86400
        frac = max(min(elapsed / float(week_sec), 1.0), 0.02)
        expected_lw_slice = max(sum_lw * frac, 0.01)
        aligned_lw_baseline = round(float(expected_lw_slice), 1)
        try:
            pct = ((sum_tw - expected_lw_slice) / expected_lw_slice) * 100.0
        except Exception:
            pct = 0.0

        sum_td = c_fail_td + c_off_td + c_stale_td
        sum_ldw = c_fail_ldw + c_off_ldw + c_stale_ldw
        sum_y = c_fail_y + c_off_y + c_stale_y
        denom_sd = max(sum_ldw, 0.01)
        try:
            pct_sd = ((sum_td - sum_ldw) / denom_sd) * 100.0
        except Exception:
            pct_sd = 0.0
        denom_y = max(sum_y, 0.01)
        try:
            pct_vs_y = ((sum_td - sum_y) / denom_y) * 100.0
        except Exception:
            pct_vs_y = 0.0

        manual_op = (cfg.red_alert_operator_name if cfg and cfg.red_alert_operator_name else "").strip()
        web_t = last_web_op.get(mid)
        web_name = (web_t[0] if web_t else "").strip()
        if manual_op:
            op_name = manual_op
        elif web_name:
            op_name = web_name
        else:
            op_name = "—"
        cleaning_op = (ctx.cleaning_operator if ctx else "") or ""
        mail = (cfg.strike_operator_email if cfg and cfg.strike_operator_email else "") or ""
        # Admin-only flag from live_machine_config (null if no row for this machine_id).
        if cfg is None:
            pfa_admin: Optional[bool] = None
        else:
            pfa_admin = bool(cfg.exclude_cleaning_timeouts_pfa)
        on_cleaning_schedule = bool(ctx and getattr(ctx, "windows", None))
        # Board "PFA" column: Yes if admin checked PFA OR machine name matched machine_cleaning_schedule (cleaning list).
        if pfa_admin is True or on_cleaning_schedule:
            pfa_board = True
        elif cfg is not None:
            pfa_board = False
        else:
            pfa_board = None

        subj = quote("Go Check: " + (m.get("name") or mid))
        body = quote("Please check machine " + (m.get("name") or mid) + " (" + mid + "). Reasons: " + "; ".join(reasons))
        action_url = ("mailto:" + mail + "?subject=" + subj + "&body=" + body) if mail else ""

        last_clean_iso = daily_cleaning_end_iso_by_machine.get(mid) or (
            cfg.last_cleaning_at.isoformat() if cfg and cfg.last_cleaning_at else None
        )

        rows_out.append(
            {
                "machineId": mid,
                "machineName": m["name"],
                "machineLocation": (m.get("location") or None),
                "operator": op_name,
                "cleaningOperator": cleaning_op or None,
                "operatorEmail": mail or None,
                # Prefer Vendon-derived Attendance & Cleaning daily cleaning end time; fall back to manual Live Dashboard config.
                "lastCleaningAt": last_clean_iso,
                "lastTransactionAtUtc": last_tx_at_utc,
                "lastOffEventAtUtc": last_off_at_utc,
                "minutesSinceLastTransaction": round(sale_age_min, 1) if sale_age_min is not None else None,
                "frequency": {
                    "dispenseFailsThisWeek": c_fail_tw,
                    "dispenseFailsLastWeek": c_fail_lw,
                    "dispenseFailsToday": c_fail_td,
                    "dispenseFailsSameDayLastWeek": c_fail_ldw,
                    "dispenseFailsYesterdaySameElapsed": c_fail_y,
                    "offEpisodesThisWeek": c_off_tw,
                    "offEpisodesLastWeek": c_off_lw,
                    "offEpisodesToday": c_off_td,
                    "offEpisodesSameDayLastWeek": c_off_ldw,
                    "offEpisodesYesterdaySameElapsed": c_off_y,
                    "staleSaleEpisodesThisWeek": c_stale_tw,
                    "staleSaleEpisodesLastWeek": c_stale_lw,
                    "staleSaleEpisodesToday": c_stale_td,
                    "staleSaleEpisodesSameDayLastWeek": c_stale_ldw,
                    "staleSaleEpisodesYesterdaySameElapsed": c_stale_y,
                    "totalCriteriaHitsThisWeek": sum_tw,
                    "totalCriteriaHitsLastWeek": sum_lw,
                    "totalCriteriaHitsLastWeekAlignedToWtD": aligned_lw_baseline,
                    "totalCriteriaHitsToday": sum_td,
                    "totalCriteriaHitsSameDayLastWeek": sum_ldw,
                    "totalCriteriaHitsYesterdaySameElapsed": sum_y,
                    "dispenseFails7d": c_fail_tw,
                    "dispenseFailsPrior7d": c_fail_lw,
                    "offEvents7d": c_off_tw,
                    "offEventsPrior7d": c_off_lw,
                    "staleSaleEpisodes7d": c_stale_tw,
                    "staleSaleEpisodesPrior7d": c_stale_lw,
                    "totalCriteriaHits7d": sum_tw,
                    "totalCriteriaHitsPrior7d": sum_lw,
                },
                "happensWeek": sum_tw,
                "happenedLastWeek": sum_lw,
                "happenedLastWeekAlignedSlice": aligned_lw_baseline,
                "happenedPctVsPriorWeek": round(pct, 1),
                "happensToday": sum_td,
                "happenedSameDayLastWeek": sum_ldw,
                "happenedPctVsSameDayLastWeek": round(pct_sd, 1),
                "happenedYesterdaySameElapsed": sum_y,
                "happenedPctVsYesterdaySameElapsed": round(pct_vs_y, 1),
                "reasons": reasons,
                "pfaExcludeCleaning": pfa_board,
                "pfaExcludeCleaningAdmin": pfa_admin,
                "onCleaningSchedule": on_cleaning_schedule,
                "duringScheduledCleaningNow": during_scheduled_cleaning_now,
                "alertPriorityTier": alert_priority_tier,
                "goCheckUrl": action_url,
            }
        )

    rows_out.sort(
        key=lambda x: (
            x.get("alertPriorityTier") or 1,
            -(x.get("happensWeek") or 0),
            (x["machineName"] or "").lower(),
        )
    )
    try:
        _persist_last_web_operators(last_web_op)
    except Exception:
        logger.exception("red_alert: operator live persist (non-fatal)")
    return {
        "generatedAt": now.isoformat(),
        "weekContext": {
            "timezone": "Asia/Kuwait",
            "weekStartsOn": "Sunday",
            "thisWeekStartUtc": datetime.fromtimestamp(this_ws, tz=timezone.utc).isoformat(),
            "thisWeekEndUtc": datetime.fromtimestamp(this_we, tz=timezone.utc).isoformat(),
            "lastWeekStartUtc": datetime.fromtimestamp(last_ws, tz=timezone.utc).isoformat(),
            "frequencyThisWeekNote": "Counts are week-to-date for the current Kuwait week (Sun–Sat).",
            "trendPercentNote": (
                "Arrow % compares WTD total to happenedLastWeekAlignedSlice (full last week × fraction of "
                "this Kuwait week elapsed). Use happenedLastWeek for the full prior Sun–Sat total only."
            ),
            "trendPercentSameDayNote": (
                "happenedPctVsSameDayLastWeek compares Kuwait calendar today so far to the same elapsed period "
                "on the same weekday last week (A+B+C with the same cleaning exclusions)."
            ),
            "trendPercentYesterdaySameElapsedNote": (
                "happenedPctVsYesterdaySameElapsed compares Kuwait calendar today so far to the same elapsed period "
                "on yesterday's calendar day (A+B+C with the same cleaning exclusions)."
            ),
        },
        "criteria": {
            "lastTransactionStaleMinutes": TX_STALE_MIN,
            "offStaleMinutes": OFF_STALE_SEC // 60,
            "vendFailMin24h": VEND_FAIL_MIN_24H,
            "boardRule": (
                "A machine is on the board if ANY of: (1) no sale/transaction on that machine for ≥30 minutes; "
                "(2) an unresolved KNet OFF or Machine OFF event aged ≥30 minutes (from received_at; last 48h of events scanned); "
                "(3) ≥5 Product dispense/vend failed events in the rolling last 24 hours."
            ),
            "frequencyDefinition": (
                "Per-machine weekly frequency (this Kuwait week WTD vs last full Kuwait week): "
                "(A) stale-sale episodes — count when operational time since the previous sale is ≥30 minutes "
                "(gaps shrink by scheduled DC cleaning windows from machine_cleaning_schedule); "
                "(B) KNet OFF / Machine OFF episodes — each Vendon OFF row whose overlap with the week has "
                "≥30 minutes of operational time (cleaning subtracted); events whose received_at falls inside "
                "a cleaning window are ignored (not counted); "
                "(C) vend-fail count — raw 'Product dispense/vend failed' events in the week with received_at "
                "outside cleaning windows (events during cleaning are excluded). "
                "The big number in the table is (A)+(B)+(C) for this week WTD. The small % compares that WTD sum "
                "to the same portion of last week's (A)+(B)+(C) for a fair trend."
            ),
            "sortingNote": (
                "Rows with alertPriorityTier=2 are still red-flagged but sorted after tier=1: "
                "current time falls inside this machine's scheduled DC cleaning window (downtime may be expected)."
            ),
        },
        "rows": rows_out,
    }


def _red_alert_payload_serve_from_cache() -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    Returns (payload, error_code). On success payload includes cache metadata.
    error_code: cache_empty | compute_error — caller may fall back to live Vendon compute.
    """
    row = _load_cache_row()
    if not row or not row.payload_json:
        return None, "cache_empty"
    if row.compute_error:
        return None, "compute_error"
    ttl = max(60, RED_ALERT_CACHE_TTL_SEC)
    if row.generated_at:
        age = (datetime.now(timezone.utc) - row.generated_at).total_seconds()
        if age > ttl:
            stale = True
        else:
            stale = False
    else:
        stale = True
    out = dict(row.payload_json)
    out["fromCache"] = True
    out["cacheGeneratedAt"] = row.generated_at.isoformat() if row.generated_at else None
    out["cacheStale"] = stale
    return out, None


def register_red_alert_routes(app) -> None:
    @app.route("/api/red-alert/snapshot", methods=["GET", "OPTIONS"])
    def red_alert_snapshot():
        if request.method == "OPTIONS":
            return "", 204
        err = _require_tab("redAlert")
        if err[1]:
            return err[1]
        payload, cerr = _red_alert_payload_serve_from_cache()
        if payload is not None:
            return jsonify(payload)
        try:
            live = _compute_red_alert_payload()
            if live.get("error"):
                return jsonify({"error": live["error"], "rows": []}), 502
            live["fromCache"] = False
            live["cacheStale"] = True
            live["cacheNote"] = cerr or "live_fallback"
            return jsonify(live)
        except Exception as ex:
            logger.exception("red_alert_snapshot")
            return jsonify({"error": "red_alert_failed", "message": str(ex), "rows": []}), 500

    @app.route("/api/red-alert/gas/snapshot", methods=["POST", "OPTIONS"])
    def red_alert_gas_snapshot():
        if request.method == "OPTIONS":
            return "", 204
        body = request.get_json(silent=True) or {}
        denied = _gas_verify_email_tab(body, "redAlert")
        if denied:
            return denied
        payload, cerr = _red_alert_payload_serve_from_cache()
        if payload is not None:
            return jsonify(payload)
        try:
            live = _compute_red_alert_payload()
            if live.get("error"):
                return jsonify({"error": live["error"], "rows": []}), 502
            live["fromCache"] = False
            live["cacheStale"] = True
            live["cacheNote"] = cerr or "live_fallback"
            if cerr == "cache_empty":
                try:
                    _save_red_alert_cache(live, None)
                    live["cacheNote"] = "live_compute_seed"
                except Exception:
                    logger.exception("red_alert seed cache after live compute")
            return jsonify(live)
        except Exception as ex:
            logger.exception("red_alert_gas_snapshot")
            return jsonify({"error": "red_alert_failed", "message": str(ex), "rows": []}), 500

    @app.route("/api/red-alert/browser/snapshot", methods=["POST", "OPTIONS"])
    def red_alert_browser_snapshot():
        """
        Browser → people-api (HMAC token). Same JSON as /api/red-alert/gas/snapshot without GAS UrlFetch.
        """
        if request.method == "OPTIONS":
            return "", 204
        email, terr = _verify_hmac_browser_token(request.headers.get("Authorization") or "", "red-alert")
        if terr:
            return jsonify({"error": "Unauthorized", "code": terr}), 401
        if "redAlert" not in _allowed_tabs_for_email(email):
            return jsonify({"error": "Forbidden", "tab": "redAlert"}), 403
        payload, cerr = _red_alert_payload_serve_from_cache()
        if payload is not None:
            return jsonify(payload)
        try:
            live = _compute_red_alert_payload()
            if live.get("error"):
                return jsonify({"error": live["error"], "rows": []}), 502
            live["fromCache"] = False
            live["cacheStale"] = True
            live["cacheNote"] = cerr or "live_fallback"
            if cerr == "cache_empty":
                try:
                    _save_red_alert_cache(live, None)
                    live["cacheNote"] = "live_compute_seed"
                except Exception:
                    logger.exception("red_alert browser seed cache after live compute")
            return jsonify(live)
        except Exception as ex:
            logger.exception("red_alert_browser_snapshot")
            return jsonify({"error": "red_alert_failed", "message": str(ex), "rows": []}), 500

    @app.route("/api/red-alert/internal/refresh", methods=["POST", "OPTIONS"])
    def red_alert_internal_refresh():
        if request.method == "OPTIONS":
            return "", 204
        if not _check_secret():
            return jsonify({"error": "Unauthorized"}), 401
        try:
            payload = _compute_red_alert_payload()
            if payload.get("error"):
                _save_red_alert_cache(None, payload["error"])
                return jsonify({"ok": False, "error": payload["error"]}), 502
            payload["fromCache"] = False
            payload["cacheStale"] = False
            _save_red_alert_cache(payload, None)
            # Optional operator email alerts (safe: disabled unless env configured).
            try:
                mail_summary = _send_red_alert_operator_emails(payload)
            except Exception:
                logger.exception("red_alert email summary failed (non-fatal)")
                mail_summary = {"enabled": RED_ALERT_EMAIL_ENABLED, "sent": 0, "skipped": 0, "errors": 1}
            return jsonify(
                {
                    "ok": True,
                    "generatedAt": payload.get("generatedAt"),
                    "rowCount": len(payload.get("rows") or []),
                    "email": mail_summary,
                }
            )
        except Exception as ex:
            logger.exception("red_alert_internal_refresh")
            _save_red_alert_cache(None, str(ex))
            return jsonify({"ok": False, "error": str(ex)}), 500
