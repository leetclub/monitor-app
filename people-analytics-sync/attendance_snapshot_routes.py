"""
Attendance snapshot cache for Leet Monitor (GAS-compatible JSON).

- POST /api/attendance/internal/upsert — X-Dashboard-Access-Secret (trusted). Body: startDate, endDate, machineId?, payload (object).
- POST /api/attendance/internal/read — same header. Body: startDate, endDate, machineId? — returns { ok, fromCache, payload }.
- POST /api/attendance/browser/snapshot — Authorization: Bearer <HMAC token from getBrowserApiToken('attendance')>. Same body as read.

Merge into the main people-api Flask app:
  from attendance_snapshot_routes import attendance_snapshot_bp
  app.register_blueprint(attendance_snapshot_bp)
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from flask import Blueprint, jsonify, request
from psycopg2.extras import Json

from browser_token import verify_browser_token
from db_pool import cache_key, get_conn

attendance_snapshot_bp = Blueprint("attendance_snapshot", __name__)


def _api_key() -> str:
    return (os.environ.get("DASHBOARD_ACCESS_API_KEY") or "").strip()


def _auth_trusted_secret() -> bool:
    key = _api_key()
    if not key:
        return False
    got = (request.headers.get("X-Dashboard-Access-Secret") or "").strip()
    return bool(got) and hmac_compare(key, got)


def hmac_compare(a: str, b: str) -> bool:
    import hmac as _h

    return _h.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def _parse_body() -> Dict[str, Any]:
    try:
        return request.get_json(force=True, silent=False) or {}
    except Exception:
        return {}


def _norm_dates(body: Dict[str, Any]) -> Tuple[str, str, str]:
    sd = str(body.get("startDate") or body.get("start_date") or "").strip()
    ed = str(body.get("endDate") or body.get("end_date") or "").strip()
    mid = str(body.get("machineId") or body.get("machine_id") or "").strip()
    return sd, ed, mid


def _browser_email() -> Optional[str]:
    key = _api_key()
    if not key:
        return None
    auth = request.headers.get("Authorization") or ""
    if not auth.startswith("Bearer "):
        return None
    token = auth[len("Bearer ") :].strip()
    info = verify_browser_token(token, key, allowed_purposes=frozenset({"attendance"}))
    if not info:
        return None
    return str(info.get("email") or "").strip().lower() or None


def _browser_ok_or_401() -> Tuple[Optional[str], Optional[Tuple[Any, int]]]:
    email = _browser_email()
    if not email:
        return None, (jsonify({"error": "unauthorized"}), 401)
    return email, None


def _upsert_snapshot(sd: str, ed: str, mid: str, payload: Dict[str, Any]) -> Tuple[bool, Optional[str], str]:
    ck = cache_key(sd, ed, mid)
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO attendance_snapshot_cache (cache_key, start_date, end_date, machine_id, payload, generated_at)
                    VALUES (%s, %s::date, %s::date, %s, %s::jsonb, now())
                    ON CONFLICT (cache_key) DO UPDATE SET
                      payload = EXCLUDED.payload,
                      generated_at = now()
                    """,
                    (ck, sd, ed, mid, Json(payload)),
                )
        return True, None, ck
    except RuntimeError as e:
        return False, str(e), ck
    except Exception as e:
        return False, str(e), ck

def _vendon_env() -> Tuple[str, str]:
    base = (os.environ.get("VENDON_API_BASE") or "").strip().rstrip("/")
    key = (os.environ.get("VENDON_API_KEY") or "").strip()
    return base, key


def _vendon_basic_auth_env() -> Tuple[str, str, str]:
    """
    Vendon head endpoints (settingChangeLog) require Basic Auth in the legacy GAS flow.
    Configure these in K8s secret if you want exact parity (operator names + Vend successful).
    """
    head_base = (os.environ.get("VENDON_HEAD_BASE") or "https://cloud.vendon.net/rest/head").strip().rstrip("/")
    user = (os.environ.get("VENDON_USERNAME") or "").strip()
    pwd = (os.environ.get("VENDON_PASSWORD") or "").strip()
    return head_base, user, pwd


def _vendon_headers(api_key: str) -> Dict[str, str]:
    return {"Authorization": f"Token {api_key}"}


def _vendon_get_json(api_base: str, api_key: str, path: str, params: Optional[Dict[str, Any]] = None) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    try:
        import requests
    except Exception as e:
        return None, f"requests unavailable: {e}"
    if not api_base:
        return None, "VENDON_API_BASE not configured"
    if not api_key:
        return None, "VENDON_API_KEY not configured"
    url = f"{api_base}{path}"
    try:
        r = requests.get(url, headers=_vendon_headers(api_key), params=params or {}, timeout=120)
        if r.status_code != 200:
            return None, f"Vendon API error {r.status_code}: {r.text[:400]}"
        return r.json(), None
    except Exception as e:
        return None, str(e)


def _vendon_head_get_json_basic(
    head_base: str, username: str, password: str, path: str, params: Optional[Dict[str, Any]] = None
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    try:
        import requests
    except Exception as e:
        return None, f"requests unavailable: {e}"
    if not username or not password:
        return None, "Vendon Basic Auth not configured"
    url = f"{head_base}{path}"
    try:
        r = requests.get(url, auth=(username, password), params=params or {}, timeout=120)
        if r.status_code != 200:
            return None, f"Vendon head API error {r.status_code}: {r.text[:400]}"
        return r.json(), None
    except Exception as e:
        return None, str(e)


def _kuwait_day_bounds_utc(date_str: str) -> Tuple[int, int]:
    """
    Kuwait calendar day [00:00..23:59:59] expressed as UTC timestamps.
    Matches existing server-side vendon caches + UI expectations.
    """
    tz = ZoneInfo("Asia/Kuwait")
    d = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=tz)
    start_loc = d.replace(hour=0, minute=0, second=0, microsecond=0)
    end_loc = d.replace(hour=23, minute=59, second=59, microsecond=0)
    return int(start_loc.astimezone(timezone.utc).timestamp()), int(end_loc.astimezone(timezone.utc).timestamp())


def _parse_iso_date(date_str: str) -> datetime:
    # date_str is YYYY-MM-DD
    return datetime.strptime(date_str, "%Y-%m-%d")


def _yesterday_utc_str() -> str:
    return (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()


def _vendon_machine_list(api_base: str, api_key: str) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    data, err = _vendon_get_json(api_base, api_key, "/machine", None)
    if err:
        return [], err
    rows = data.get("result") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        return [], "Vendon /machine returned invalid payload"
    out: List[Dict[str, Any]] = []
    for m in rows:
        if not isinstance(m, dict):
            continue
        mid = m.get("id")
        if mid is None:
            continue
        out.append({"id": str(mid), "name": m.get("name") or str(mid)})
    out.sort(key=lambda x: (x.get("name") or "").lower())
    return out, None


def _vendon_fetch_users(api_base: str, api_key: str) -> List[Dict[str, Any]]:
    """
    Same source as legacy GAS `fetchUsers()` (`GET /user`).
    Used to mirror `findActualUserForCredit(...)`.
    """
    data, err = _vendon_get_json(api_base, api_key, "/user", None)
    if err:
        return []
    rows = data.get("result") if isinstance(data, dict) else None
    return rows if isinstance(rows, list) else []


def _determine_user_type(user: Dict[str, Any]) -> str:
    if not user:
        return "operator"
    type_s = str(user.get("type") or "")
    type_title = str(user.get("type_title") or "")
    tl = type_s.lower()
    ttl = type_title.lower()
    if "route" in tl or "route" in ttl or "driver" in tl or "driver" in ttl:
        return "route_driver"
    if "operator" in tl or "operator" in ttl:
        return "operator"
    return "operator"


def _user_type_from_credit_record(user_name: str) -> str:
    un = (user_name or "").lower()
    if "route" in un or "driver" in un:
        return "route_driver"
    return "operator"


def _find_actual_user_for_credit(user_id: str, user_name: str, all_users: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Port of GAS `findActualUserForCredit`.
    """
    uid = str(user_id or "").strip()
    unm = str(user_name or "").strip()

    if uid:
        for u in all_users:
            if str(u.get("id") or "") == uid:
                fn = str(u.get("first_name") or "").strip()
                ln = str(u.get("last_name") or "").strip()
                full = f"{fn} {ln}".strip()
                return {"id": u.get("id"), "name": full or unm, "type": _determine_user_type(u)}

    if unm and unm not in ("Unknown Operator", "System"):
        for u in all_users:
            fn = str(u.get("first_name") or "").strip()
            ln = str(u.get("last_name") or "").strip()
            full = f"{fn} {ln}".strip()
            if full.lower() == unm.lower():
                return {"id": u.get("id"), "name": full or unm, "type": _determine_user_type(u)}
        ul = unm.lower()
        for u in all_users:
            fn = str(u.get("first_name") or "").strip()
            ln = str(u.get("last_name") or "").strip()
            full = f"{fn} {ln}".strip().lower()
            if fn.lower() in ul or ln.lower() in ul or (full and full in ul):
                return {"id": u.get("id"), "name": f"{fn} {ln}".strip() or unm, "type": _determine_user_type(u)}

    return {"id": uid or None, "name": unm or "Unknown User", "type": "operator"}


def _iso_date_from_unix_like_gas(ts: int) -> str:
    """
    Match GAS: `new Date(ts * 1000).toISOString().split('T')[0]` (UTC calendar day).
    """
    if not ts:
        return ""
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).date().isoformat()


def _check_consecutive_events_gas(events: List[Dict[str, Any]], required_count: int, max_time_window_seconds: int) -> bool:
    """
    Port of GAS `checkConsecutiveEvents(events, requiredCount, maxTimeWindow)`.
    """
    if required_count <= 1 or len(events) < required_count:
        return False
    sorted_events = sorted(events, key=lambda e: int(e.get("received_at") or 0))
    n = required_count
    for i in range(0, len(sorted_events) - n + 1):
        first_ts = int(sorted_events[i].get("received_at") or 0)
        last_ts = int(sorted_events[i + n - 1].get("received_at") or 0)
        if first_ts and last_ts and (last_ts - first_ts) <= max_time_window_seconds:
            return True
    return False


def _find_consecutive_events_gas(
    sorted_events: List[Dict[str, Any]], start_index: int, required_count: int, max_time_window_seconds: int
) -> Optional[Dict[str, Any]]:
    """
    Port of GAS `findConsecutiveEvents(events, startIndex, requiredCount, maxTimeWindow)`.
    """
    if start_index < 0 or required_count <= 0:
        return None
    if start_index + required_count > len(sorted_events):
        return None
    first = sorted_events[start_index]
    last = sorted_events[start_index + required_count - 1]
    first_ts = int(first.get("received_at") or 0)
    last_ts = int(last.get("received_at") or 0)
    if not first_ts or not last_ts:
        return None
    if (last_ts - first_ts) <= max_time_window_seconds:
        return {
            "firstEvent": first,
            "lastEvent": last,
            "lastIndex": start_index + required_count - 1,
        }
    return None


def _integrate_cleaning_finish_times(
    attendance_records: List[Dict[str, Any]], cleaning_records: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Port of GAS `integrateCleaningFinishTimes(attendanceRecords, cleaningRecords)`.
    """
    out: List[Dict[str, Any]] = []
    for a in attendance_records:
        mid = str(a.get("machine_id") or "")
        d = str(a.get("date") or "")
        match = None
        for c in cleaning_records:
            if (
                str(c.get("machine_id") or "") == mid
                and str(c.get("date") or "") == d
                and c.get("status") == "completed"
                and c.get("cleaning_end")
            ):
                match = c
                break
        if match:
            new_end = int(match.get("cleaning_end") or 0)
            ws = int(a.get("work_start") or a.get("attendance_time") or 0)
            new_dur = (new_end - ws) if new_end and ws else None
            aa = dict(a)
            aa["work_end"] = new_end
            aa["actual_work_duration"] = new_dur
            aa["cleaning_finish_time"] = new_end
            aa["cleaning_duration"] = match.get("cleaning_duration")
            aa["cleaning_start"] = match.get("cleaning_start")
            aa["work_end_source"] = "daily_cleaning"
            out.append(aa)
        else:
            aa = dict(a)
            aa["work_end_source"] = "power_events"
            out.append(aa)
    return out


def _check_general_cleaning_for_day(
    power_events_sorted: List[Dict[str, Any]], machine_id: str, machine_name: str, date_str: str
) -> Optional[Dict[str, Any]]:
    """
    Port of GAS `checkGeneralCleaningForDay` (returns one record or None).
    """
    if len(power_events_sorted) < 6:
        return None
    sorted_events = list(power_events_sorted)
    i = 0
    while i < (len(sorted_events) - 5):
        start_pat = _find_consecutive_events_gas(sorted_events, i, 3, 180)
        if start_pat:
            cleaning_start = int(start_pat["firstEvent"].get("received_at") or 0)
            j = int(start_pat["lastIndex"]) + 1
            end_pat = None
            while j < (len(sorted_events) - 2) and end_pat is None:
                end_pat = _find_consecutive_events_gas(sorted_events, j, 3, 180)
                if end_pat:
                    cleaning_end = int(end_pat["lastEvent"].get("received_at") or 0)
                    cleaning_duration = (cleaning_end - cleaning_start) if cleaning_end and cleaning_start else None
                    return {
                        "machine_id": machine_id,
                        "machine_name": machine_name,
                        "cleaning_start": cleaning_start,
                        "cleaning_end": cleaning_end,
                        "cleaning_duration": cleaning_duration,
                        "date": date_str,
                        "status": "completed",
                        "type": "general",
                    }
                j += 1
            i = int(start_pat["lastIndex"]) + 1
        else:
            i += 1
    return None


def _get_saturdays_in_range(start_date: str, end_date: str) -> List[str]:
    d0 = datetime.strptime(start_date, "%Y-%m-%d").date()
    d1 = datetime.strptime(end_date, "%Y-%m-%d").date()
    out: List[str] = []
    cur = d0
    while cur <= d1:
        if cur.weekday() == 5:  # Saturday
            out.append(cur.isoformat())
        cur = cur + timedelta(days=1)
    return out


def _fetch_vends_stats_window(
    api_base: str,
    api_key: str,
    from_ts: int,
    to_ts: int,
    machine_id: Optional[str] = None,
    max_rows: int = 25000,
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """
    Vendon /stats/vends paginated fetch. This is token-friendly (unlike /rest/head settingChangeLog).
    """
    out: List[Dict[str, Any]] = []
    off = 0
    page_limit = 500
    while len(out) < max_rows:
        params: Dict[str, Any] = {"from_timestamp": from_ts, "to_timestamp": to_ts, "limit": page_limit, "offset": off}
        if machine_id:
            params["machine_id"] = machine_id
        data, err = _vendon_get_json(api_base, api_key, "/stats/vends", params)
        if err:
            return [], err
        chunk = data.get("result") if isinstance(data, dict) else None
        chunk = chunk if isinstance(chunk, list) else []
        out.extend(chunk)
        if len(chunk) < page_limit:
            break
        off += page_limit
    return out[:max_rows], None


def _parse_setting_change_log_credit_record(record: Dict[str, Any], machine_id: str) -> Optional[Dict[str, Any]]:
    """
    Port of GAS parseRemoteCreditRecordRobust/parseRemoteCreditRecord.
    Requires:
      - action == "Remote credit sent"
      - Status == "Vend successful"
    """
    try:
        if (record.get("action") or "") != "Remote credit sent":
            return None
        data = str(record.get("data") or "")
        # Split on <br> like GAS
        import re
        lines = [x.strip() for x in re.split(r"<br\s*/?>\s*\n?", data) if x and x.strip()]
        credit_amount: Optional[float] = None
        status = "Unknown"
        allowed_products = ""
        for line in lines:
            low = line.lower()
            if "credit" in low:
                parts = re.split(r"(?:=>|=&gt;)", line)
                if len(parts) >= 2:
                    try:
                        credit_amount = float(parts[1].strip())
                    except Exception:
                        pass
            if "status" in low:
                parts = re.split(r"(?:=>|=&gt;)", line)
                if len(parts) >= 2:
                    status = parts[1].strip()
            if "allowed products" in low:
                parts = re.split(r"(?:=>|=&gt;)", line)
                if len(parts) >= 2:
                    allowed_products = parts[1].strip()
        if status != "Vend successful":
            return None
        ts = record.get("changed_at")
        try:
            ts_i = int(ts) if ts is not None else 0
        except Exception:
            ts_i = 0
        if not ts_i:
            return None
        return {
            "id": record.get("id"),
            "user_id": record.get("user_id") or "",
            "user_name": record.get("user_name") or "",
            "timestamp": ts_i,
            "machine_id": machine_id,
            "credit_amount": credit_amount,
            "status": status,
            "allowed_products": allowed_products,
            "source": "settingChangeLog",
        }
    except Exception:
        return None


def _collect_remote_credits_setting_change_log(
    head_base: str,
    username: str,
    password: str,
    machine_id: str,
    from_ts: int,
    to_ts: int,
    max_pages: int = 20,
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    out: List[Dict[str, Any]] = []
    limit = 200
    offset = 0
    for _ in range(max_pages):
        data, err = _vendon_head_get_json_basic(
            head_base,
            username,
            password,
            "/machine/settingChangeLog",
            {
                "id": machine_id,
                "from_timestamp": from_ts,
                "to_timestamp": to_ts,
                "user": "",
                "limit": limit,
                "offset": offset,
            },
        )
        if err:
            return [], err
        rows = (((data or {}).get("result") or {}).get("log_records")) if isinstance(data, dict) else None
        rows = rows if isinstance(rows, list) else []
        if not rows:
            break
        parsed_this_page = 0
        for rec in rows:
            if not isinstance(rec, dict):
                continue
            parsed = _parse_setting_change_log_credit_record(rec, machine_id)
            if parsed:
                out.append(parsed)
                parsed_this_page += 1
        if len(rows) < limit:
            break
        offset += limit
        # Small early-exit like GAS: stop after enough successes
        if parsed_this_page >= 10:
            break
    out.sort(key=lambda x: int(x.get("timestamp") or 0))
    return out, None


def _is_web_cashless_vend(vend: Dict[str, Any]) -> bool:
    """
    Heuristic for "remote credit" style vends when we can't use Vendon /rest/head settingChangeLog.

    Production GAS uses "Remote credit sent" logs; on server we approximate using Vendon vends stats.
    We intentionally broaden beyond WEB+CASHLESS because some environments don't include both tokens.
    """
    try:
        js = json.dumps(vend or {}, ensure_ascii=False).upper()
        # Strong signal
        if "WEB" in js and "CASHLESS" in js:
            return True
        # Broader cashless signals (still exclude obvious card swipes by requiring "CREDIT" or "REMOTE" somewhere)
        if "CASHLESS" in js and ("CREDIT" in js or "REMOTE" in js or "WEB" in js):
            return True
        candidates: List[str] = []
        for k in ("payment_type", "payment_type_name", "type", "pay_type", "pay_type_name"):
            v = vend.get(k)
            if v is not None:
                candidates.append(str(v))
        for v in candidates:
            u = v.upper()
            if "WEB" in u and "CASHLESS" in u:
                return True
            if "CASHLESS" in u and ("REMOTE" in u or "CREDIT" in u or "WEB" in u):
                return True
        return False
    except Exception:
        return False


def _collect_power_events(
    api_base: str,
    api_key: str,
    from_ts: int,
    to_ts: int,
    machine_id: Optional[str] = None,
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """
    Vendon /event is paginated. Production GAS typically sees more than 500 rows/day across all machines.
    Without paging we under-count both attendance proofs and cleaning sessions.
    """
    out: List[Dict[str, Any]] = []
    off = 0
    page_limit = 500
    max_rows = 20000
    while len(out) < max_rows:
        params: Dict[str, Any] = {
            "from_timestamp": from_ts,
            "to_timestamp": to_ts,
            "limit": page_limit,
            "offset": off,
        }
        if machine_id:
            params["machine_id"] = machine_id
        data, err = _vendon_get_json(api_base, api_key, "/event", params)
        if err:
            return [], err
        rows = data.get("result") if isinstance(data, dict) else None
        rows = rows if isinstance(rows, list) else []
        if not rows:
            break
        for e in rows:
            if not isinstance(e, dict):
                continue
            name = (e.get("name") or "").strip()
            base = (e.get("base_code") or "").strip()
            if name in ("Power Supply Interrupted", "Machine out of order due to power failure") or base in (
                "Power Supply Interrupted",
                "Machine out of order due to power failure",
            ):
                try:
                    out.append(
                        {
                            "machine_id": str(e.get("machine_id") or ""),
                            "received_at": int(e.get("received_at") or 0),
                            "name": name or base,
                        }
                    )
                except Exception:
                    continue
        if len(rows) < page_limit:
            break
        off += page_limit
    out.sort(key=lambda x: int(x.get("received_at") or 0))
    return out, None


def _has_consecutive_events(events: List[Dict[str, Any]], min_count: int, within_seconds: int) -> bool:
    if not events or min_count <= 1:
        return False
    times = [int(e.get("received_at") or 0) for e in events if int(e.get("received_at") or 0) > 0]
    times.sort()
    run = 1
    for i in range(1, len(times)):
        if times[i] - times[i - 1] <= within_seconds:
            run += 1
            if run >= min_count:
                return True
        else:
            run = 1
    return False


def _find_cleaning_finish_time(power_events_sorted: List[Dict[str, Any]], attendance_time: int) -> Optional[int]:
    """
    Port of GAS `findCleaningFinishTime(machineId, attendanceTime, date)`.
    """
    if not power_events_sorted or attendance_time <= 0:
        return None
    # Only consider events after attendance time (same as GAS filtering to `> attendanceTime`)
    events = [e for e in power_events_sorted if int(e.get("received_at") or 0) > int(attendance_time)]
    if len(events) < 3:
        return None

    cleaning_patterns: List[Dict[str, int]] = []
    for i in range(0, len(events) - 2):
        e1 = int(events[i].get("received_at") or 0)
        e2 = int(events[i + 1].get("received_at") or 0)
        e3 = int(events[i + 2].get("received_at") or 0)
        if not e1 or not e2 or not e3:
            continue
        td1 = e2 - e1
        td2 = e3 - e2
        if td1 <= 180 and td2 <= 180:
            total = e3 - e1
            if total <= 300:
                cleaning_patterns.append({"start": e1, "end": e3, "duration": total})

    if not cleaning_patterns:
        return None
    # Patterns that start strictly after attendance time
    valid = [p for p in cleaning_patterns if p["start"] > int(attendance_time)]
    if not valid:
        return None
    valid.sort(key=lambda p: p["start"])
    return int(valid[0]["end"])


def _find_consecutive_events(
    sorted_events: List[Dict[str, Any]], start_index: int, count: int, max_time_window_seconds: int
) -> Optional[Dict[str, Any]]:
    return _find_consecutive_events_gas(sorted_events, start_index, count, max_time_window_seconds)


def _find_cleaning_patterns_in_day(
    sorted_events: List[Dict[str, Any]], machine_id: str, machine_name: str, date_str: str
) -> List[Dict[str, Any]]:
    """
    Mirrors GAS `findCleaningPatternsInDay` for a single day.
    Start pattern: 3 consecutive events (<=180s gaps)
    End pattern: next 3 consecutive events (<=180s gaps)
    """
    out: List[Dict[str, Any]] = []
    i = 0
    # GAS uses while i < len-5
    while i < (len(sorted_events) - 5):
        start_pat = _find_consecutive_events(sorted_events, i, 3, 180)
        if start_pat:
            cleaning_start = int(start_pat["firstEvent"].get("received_at") or 0)
            j = int(start_pat["lastIndex"]) + 1
            end_pat = None
            while j < (len(sorted_events) - 2) and end_pat is None:
                end_pat = _find_consecutive_events(sorted_events, j, 3, 180)
                if end_pat:
                    cleaning_end = int(end_pat["lastEvent"].get("received_at") or 0)
                    dur = (cleaning_end - cleaning_start) if cleaning_end and cleaning_start else None
                    out.append(
                        {
                            "machine_id": machine_id,
                            "machine_name": machine_name,
                            "cleaning_start": cleaning_start,
                            "cleaning_end": cleaning_end,
                            "cleaning_duration": dur,
                            "date": date_str,
                            "status": "completed",
                            "type": "daily",
                        }
                    )
                    i = int(end_pat["lastIndex"]) + 1
                    break
                j += 1
            if end_pat is None:
                out.append(
                    {
                        "machine_id": machine_id,
                        "machine_name": machine_name,
                        "cleaning_start": cleaning_start,
                        "cleaning_end": None,
                        "cleaning_duration": None,
                        "date": date_str,
                        "status": "incomplete",
                        "type": "daily",
                    }
                )
                i = int(start_pat["lastIndex"]) + 1
        else:
            i += 1
    return out


def _compute_attendance_snapshot(sd: str, ed: str, machine_id: str) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    Parity target: legacy GAS `getAttendanceAndCleaningData` for a single day:
    - Remote credits: `fetchRemoteCreditsFromSettingChangeLog` (Basic Auth /rest/head) with optional vends fallback
    - Attendance: `processAttendanceWithCorrectAPI` + `processAttendanceForCredit` (incl. `/user` name resolution)
    - Work end: `findCleaningFinishTime` then `integrateCleaningFinishTimes` (daily cleaning wins)
    - General cleaning: `processGeneralCleaning` (Saturdays)
    """
    api_base, api_key = _vendon_env()
    if not api_base or not api_key:
        return None, "Vendon env not configured"
    # Use Kuwait calendar bounds per day; range currently used as [sd..ed] but warmer is single-day in practice.
    if sd != ed:
        # For now we only support single-day warm correctly (range stitching is done client-side).
        return None, "range_not_supported"
    # Single consistent calendar day window (Kuwait) for BOTH:
    # - `/rest/head/machine/settingChangeLog` remote credits
    # - `/event` power events + `/stats/vends` fallback
    #
    # Splitting credits vs power into different day-bound schemes can drop credits that still
    # have power proof inside the Kuwait day window (classic parity issue).
    day_from_ts, day_to_ts = _kuwait_day_bounds_utc(sd)

    machines, merr = _vendon_machine_list(api_base, api_key)
    if merr:
        return None, merr
    target = machines
    if machine_id:
        target = [m for m in machines if str(m.get("id")) == str(machine_id)]
    machines_map = {str(m["id"]): (m.get("name") or str(m["id"])) for m in target}
    all_users = _vendon_fetch_users(api_base, api_key)

    power_events, perr = _collect_power_events(api_base, api_key, day_from_ts, day_to_ts, machine_id or None)
    if perr:
        return None, perr
    power_by_machine: Dict[str, List[Dict[str, Any]]] = {}
    for e in power_events:
        mid = str(e.get("machine_id") or "")
        power_by_machine.setdefault(mid, []).append(e)
    # Ensure each machine list is sorted (used for cleaning finish time).
    for mid in list(power_by_machine.keys()):
        power_by_machine[mid].sort(key=lambda x: int(x.get("received_at") or 0))

    raw_attendance_rows: List[Dict[str, Any]] = []
    cleaning_rows: List[Dict[str, Any]] = []
    general_cleaning_rows: List[Dict[str, Any]] = []
    total_remote_credits = 0
    total_valid = 0
    recorded_users: set[str] = set()
    head_base, ba_user, ba_pwd = _vendon_basic_auth_env()
    basic_auth_configured = bool(ba_user and ba_pwd)
    setting_change_log_last_error: Optional[str] = None
    credits_from_setting_change_log = 0
    credits_from_stats_vends = 0
    machines_used_stats_vends_fallback = 0

    for m in target:
        mid = str(m.get("id"))
        credits: List[Dict[str, Any]] = []
        # Prefer exact parity (settingChangeLog) when Basic Auth is configured.
        if ba_user and ba_pwd:
            credits, cerr = _collect_remote_credits_setting_change_log(head_base, ba_user, ba_pwd, mid, day_from_ts, day_to_ts)
            if cerr:
                # Fall back to token-only vends when head API fails
                credits = []
                # Keep the last non-empty error for operators debugging missing names ("WEB cashless" fallback).
                if cerr.strip():
                    setting_change_log_last_error = cerr.strip()
        if not credits:
            machines_used_stats_vends_fallback += 1
            vends, verr = _fetch_vends_stats_window(api_base, api_key, day_from_ts, day_to_ts, mid, max_rows=25000)
            if verr:
                continue
            for vend in vends:
                if not isinstance(vend, dict):
                    continue
                if not _is_web_cashless_vend(vend):
                    continue
                ts = vend.get("datetime") or vend.get("timestamp") or vend.get("time") or 0
                try:
                    ts_i = int(ts) if ts is not None else 0
                except Exception:
                    ts_i = 0
                credits.append(
                    {
                        "timestamp": ts_i,
                        "user_name": vend.get("user_name") or "",
                        "credit_amount": vend.get("price") or 0,
                        "product_name": vend.get("name") or vend.get("product_name") or "",
                        "selection": vend.get("selection") or vend.get("product_id") or "",
                        "status": "Vend successful",
                        "source": "stats/vends",
                    }
                )
            credits.sort(key=lambda x: int(x.get("timestamp") or 0))
        for c in credits:
            src = (c.get("source") or "").strip()
            if src == "settingChangeLog":
                credits_from_setting_change_log += 1
            elif src == "stats/vends":
                credits_from_stats_vends += 1
        total_remote_credits += len(credits)
        pe = power_by_machine.get(mid) or []
        # Daily cleaning sessions for this machine/day
        if len(pe) >= 6:
            cleaning_rows.extend(_find_cleaning_patterns_in_day(pe, mid, machines_map.get(mid) or mid, sd))

        mname = machines_map.get(mid) or mid
        if sd == ed:
            try:
                d = datetime.strptime(sd, "%Y-%m-%d").date()
                if d.weekday() == 5:  # Saturday
                    gc = _check_general_cleaning_for_day(pe, mid, mname, sd)
                    if gc:
                        general_cleaning_rows.append(gc)
            except Exception:
                pass

        successful = [c for c in credits if (c.get("status") or "") == "Vend successful"]
        successful.sort(key=lambda x: int(x.get("timestamp") or 0))
        for c in successful:
            ts = int(c.get("timestamp") or 0)
            if not ts:
                continue
            window = [x for x in pe if ts <= int(x.get("received_at") or 0) <= ts + 180]
            window.sort(key=lambda x: int(x.get("received_at") or 0))
            ok = _check_consecutive_events_gas(window, 2, 180)
            if not ok:
                continue

            user_details = _find_actual_user_for_credit(str(c.get("user_id") or ""), str(c.get("user_name") or ""), all_users)
            actual_date = _iso_date_from_unix_like_gas(ts)
            credit_date = actual_date
            is_date_in_range = sd <= actual_date <= ed
            is_credit_in_range = sd <= credit_date <= ed
            if not (is_date_in_range or is_credit_in_range):
                continue

            user_key = f"{mid}_{actual_date}_{c.get('user_id') or c.get('user_name')}"
            if user_key in recorded_users:
                continue

            work_end = _find_cleaning_finish_time(pe, ts)
            work_duration = (work_end - ts) if (work_end and work_end > ts) else None

            credit_name = str(c.get("user_name") or "").strip()
            display_name = str(user_details.get("name") or "").strip() or credit_name or "Unknown User"
            user_type = user_details.get("type") or _user_type_from_credit_record(credit_name)

            raw_attendance_rows.append(
                {
                    "machine_id": mid,
                    "machine_name": mname,
                    "date": actual_date,
                    "attendance_time": ts,
                    "user_type": user_type,
                    "user_name": display_name,
                    "operator_name": display_name,
                    "work_start": ts,
                    "work_end": work_end,
                    "cleaning_finish_time": work_end,
                    "actual_work_duration": work_duration,
                    "attendance_proven": True,
                    "remote_credit_id": c.get("id"),
                    "credit_user_name": c.get("user_name") or "",
                    "credit_amount": c.get("credit_amount"),
                    "power_events_count": len(window),
                    "consecutive_events_found": True,
                    "status": "confirmed",
                }
            )
            recorded_users.add(user_key)
            total_valid += 1

    enhanced_attendance = _integrate_cleaning_finish_times(raw_attendance_rows, cleaning_rows)

    out = {
        "success": True,
        "attendance": enhanced_attendance,
        "cleaning": cleaning_rows,
        "generalCleaning": general_cleaning_rows,
        "attendanceCount": len(enhanced_attendance),
        "cleaningCount": len(cleaning_rows),
        "generalCleaningCount": len(general_cleaning_rows),
        "hasAttendanceData": len(enhanced_attendance) > 0,
        "attendanceError": None,
        "allTimeCleaningAverages": [],
        "cacheWarmInfo": {
            "startDate": sd,
            "endDate": ed,
            "machineId": machine_id or "",
            "remoteCreditsSeen": total_remote_credits,
            "validAttendance": total_valid,
            "usersFetched": len(all_users),
            "basicAuthConfigured": basic_auth_configured,
            "settingChangeLogLastError": setting_change_log_last_error,
            "remoteCreditsFromSettingChangeLog": credits_from_setting_change_log,
            "remoteCreditsFromStatsVends": credits_from_stats_vends,
            "machinesUsedStatsVendsFallback": machines_used_stats_vends_fallback,
            "operatorNameNote": (
                "Operator names come from settingChangeLog user_name when Basic Auth is configured; "
                "stats/vends fallback often lacks user_name, so the UI shows WEB cashless."
            ),
        },
    }
    return out, None


@attendance_snapshot_bp.route("/api/attendance/internal/upsert", methods=["POST"])
def attendance_internal_upsert():
    if not _auth_trusted_secret():
        return jsonify({"ok": False, "error": "unauthorized"}), 401
    body = _parse_body()
    sd, ed, mid = _norm_dates(body)
    payload = body.get("payload")
    if not sd or not ed or payload is None:
        return jsonify({"ok": False, "error": "startDate, endDate, and payload are required"}), 400
    ck = cache_key(sd, ed, mid)
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO attendance_snapshot_cache (cache_key, start_date, end_date, machine_id, payload, generated_at)
                    VALUES (%s, %s::date, %s::date, %s, %s::jsonb, now())
                    ON CONFLICT (cache_key) DO UPDATE SET
                      payload = EXCLUDED.payload,
                      generated_at = now()
                    """,
                    (ck, sd, ed, mid, Json(payload)),
                )
    except RuntimeError as e:
        return jsonify({"ok": False, "error": str(e)}), 503
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    return jsonify({"ok": True, "cache_key": ck})


@attendance_snapshot_bp.route("/api/attendance/internal/read", methods=["POST"])
def attendance_internal_read():
    if not _auth_trusted_secret():
        return jsonify({"ok": False, "error": "unauthorized"}), 401
    body = _parse_body()
    sd, ed, mid = _norm_dates(body)
    if not sd or not ed:
        return jsonify({"ok": False, "error": "startDate and endDate are required"}), 400
    ck = cache_key(sd, ed, mid)
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT payload, generated_at
                    FROM attendance_snapshot_cache
                    WHERE cache_key = %s
                    """,
                    (ck,),
                )
                row = cur.fetchone()
    except RuntimeError as e:
        return jsonify({"ok": False, "error": str(e)}), 503
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    if not row:
        return jsonify({"ok": True, "fromCache": False})
    payload, gen_at = row[0], row[1]
    gen_iso = gen_at.isoformat() if hasattr(gen_at, "isoformat") else str(gen_at)
    return jsonify({"ok": True, "fromCache": True, "generatedAt": gen_iso, "payload": payload})


@attendance_snapshot_bp.route("/api/attendance/internal/warm", methods=["POST"])
def attendance_internal_warm():
    """
    Cron entrypoint: compute attendance snapshot server-side and upsert into attendance_snapshot_cache.
    Body: { date?: 'YYYY-MM-DD', startDate?, endDate?, machineId? }
    """
    if not _auth_trusted_secret():
        return jsonify({"ok": False, "error": "unauthorized"}), 401
    body = _parse_body()
    # Default to yesterday single day
    date_str = str(body.get("date") or "").strip()
    if date_str:
        sd = ed = date_str
        mid = str(body.get("machineId") or "").strip()
    else:
        sd, ed, mid = _norm_dates(body)
        if not sd or not ed:
            sd = ed = _yesterday_utc_str()
        mid = mid or ""

    payload, err = _compute_attendance_snapshot(sd, ed, mid)
    if err or payload is None:
        return jsonify({"ok": False, "error": err or "compute_failed", "startDate": sd, "endDate": ed, "machineId": mid}), 502

    ok, uerr, ck = _upsert_snapshot(sd, ed, mid, payload)
    if not ok:
        return jsonify({"ok": False, "error": uerr or "upsert_failed"}), 503
    return jsonify(
        {
            "ok": True,
            "cache_key": ck,
            "startDate": sd,
            "endDate": ed,
            "machineId": mid,
            "attendanceCount": int(payload.get("attendanceCount") or 0),
        }
    )


@attendance_snapshot_bp.route("/api/attendance/browser/snapshot", methods=["POST"])
def attendance_browser_snapshot():
    email, terr = _browser_ok_or_401()
    if terr:
        return terr
    body = _parse_body()
    sd, ed, mid = _norm_dates(body)
    if not sd or not ed:
        return jsonify({"error": "startDate and endDate are required"}), 400
    ck = cache_key(sd, ed, mid)
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT payload, generated_at
                    FROM attendance_snapshot_cache
                    WHERE cache_key = %s
                    """,
                    (ck,),
                )
                row = cur.fetchone()
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 503
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    # 200 (not HTTP 404): cache miss is normal cold path; avoids misleading "route not found" in DevTools.
    if not row:
        return jsonify({"error": "cache_miss", "fromCache": False}), 200
    payload, gen_at = row[0], row[1]
    gen_iso = gen_at.isoformat() if hasattr(gen_at, "isoformat") else str(gen_at)
    out = dict(payload) if isinstance(payload, dict) else {"raw": payload}
    out["fromCache"] = True
    out["cacheNote"] = "people-api attendance_snapshot_cache"
    out["generatedAt"] = gen_iso
    return jsonify(out)


@attendance_snapshot_bp.route("/api/attendance/browser/warm", methods=["POST"])
def attendance_browser_warm():
    """
    Browser-initiated warmup for a SINGLE day only.
    Use when cache_miss happens and GAS fallback is disabled (UrlFetch quota safe).
    """
    email, terr = _browser_ok_or_401()
    if terr:
        return terr
    body = _parse_body()
    sd, ed, mid = _norm_dates(body)
    if not sd or not ed:
        return jsonify({"error": "startDate and endDate are required"}), 400
    if sd != ed:
        return jsonify({"error": "range_not_supported", "message": "Warm supports single-day only"}), 400
    if mid:
        return jsonify({"error": "machine_not_supported", "message": "Warm supports all machines only"}), 400

    payload, err = _compute_attendance_snapshot(sd, ed, "")
    if err or payload is None:
        return jsonify({"error": err or "compute_failed"}), 502
    ok, uerr, _ck = _upsert_snapshot(sd, ed, "", payload)
    if not ok:
        return jsonify({"error": uerr or "upsert_failed"}), 503
    out = dict(payload)
    out["fromCache"] = True
    out["cacheNote"] = "people-api attendance_snapshot_cache (warmed)"
    out["generatedAt"] = datetime.now(timezone.utc).isoformat()
    out["warmEmail"] = email
    return jsonify(out), 200


@attendance_snapshot_bp.route("/api/attendance/internal/health", methods=["GET"])
def attendance_cache_health():
    if not _auth_trusted_secret():
        return jsonify({"ok": False}), 401
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT count(*) FROM attendance_snapshot_cache")
                n = cur.fetchone()[0]
        return jsonify({"ok": True, "rows": int(n)})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


def register_attendance_snapshot_routes(app: Any) -> None:
    app.register_blueprint(attendance_snapshot_bp)
