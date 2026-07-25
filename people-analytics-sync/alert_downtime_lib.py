"""
Per-machine operational downtime for Alert Red Flags / Overall.

Source: Vendon OFF episodes (Machine OFF, KNet OFF, Vendon OFF) from vendon_events_cache
plus a live /event fetch for the recent window. Duration uses operational time
(wall clock minus Admin cleaning windows), matching Red Alert gap math.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set, Tuple
from zoneinfo import ZoneInfo

from cleaning_schedule import operational_gap_seconds, resolve_cleaning_context
from dashboard_access_models import MachineCleaningSchedule, create_dashboard_engine_and_session
from models import VendonEventCache, create_engine_and_session
from vendon_constants import EVENT_NAME_MAPPING, EXCLUDED_EVENT_NAMES
from vendon_machine_helpers import machine_row_excluded, vendon_fetch_machine_list

logger = logging.getLogger(__name__)

OFF_DISPLAY_NAMES = frozenset({"Machine OFF", "KNet OFF", "Vendon OFF"})

# Look back this many days before the period start so unresolved / long OFF episodes clip correctly.
_LOOKBACK_DAYS = 2


def _map_display_name(e: Dict[str, Any]) -> str:
    name = e.get("name") or e.get("original_name") or ""
    base = e.get("base_code") or e.get("original_base_code") or ""
    disp = e.get("display_name")
    if disp and str(disp).strip() in OFF_DISPLAY_NAMES:
        return str(disp).strip()
    return (
        EVENT_NAME_MAPPING.get(name)
        or EVENT_NAME_MAPPING.get(base)
        or (str(disp).strip() if disp else "")
        or name
        or "Unknown Event"
    )


def _kuwait_day_start_ts(d: date) -> int:
    tz = ZoneInfo("Asia/Kuwait")
    return int(datetime(d.year, d.month, d.day, tzinfo=tz).timestamp())


def _merge_intervals(intervals: List[Tuple[int, int]]) -> List[Tuple[int, int]]:
    """Merge overlapping/adjacent [lo, hi) intervals so concurrent OFF types are not double-counted."""
    if not intervals:
        return []
    ordered = sorted((int(a), int(b)) for a, b in intervals if a < b)
    if not ordered:
        return []
    merged: List[Tuple[int, int]] = [ordered[0]]
    for lo, hi in ordered[1:]:
        prev_lo, prev_hi = merged[-1]
        if lo <= prev_hi:
            merged[-1] = (prev_lo, max(prev_hi, hi))
        else:
            merged.append((lo, hi))
    return merged


def _sum_off_operational_seconds(
    off_events: List[Tuple[int, Optional[int]]],
    win_lo: int,
    win_hi_excl: int,
    now_ts: int,
    ctx: Any,
) -> int:
    """Sum operational OFF seconds overlapping [win_lo, win_hi_excl).

    Overlapping Machine OFF / KNet OFF / Vendon OFF episodes are merged first so
    totals cannot exceed the window (e.g. ~90h “today” from concurrent types).
    """
    if not off_events or win_lo >= win_hi_excl:
        return 0
    clips: List[Tuple[int, int]] = []
    for rec, res_i in off_events:
        if rec <= 0:
            continue
        end_eff = res_i if res_i is not None else now_ts
        clip_lo = max(int(rec), int(win_lo))
        clip_hi = min(int(end_eff), int(win_hi_excl))
        if clip_lo >= clip_hi:
            continue
        clips.append((clip_lo, clip_hi))
    total = 0
    for clip_lo, clip_hi in _merge_intervals(clips):
        total += int(operational_gap_seconds(clip_lo, clip_hi, ctx))
    # Hard cap: never report more than the wall window (minus cleaning already applied per segment).
    max_wall = max(0, int(win_hi_excl) - int(win_lo))
    if total > max_wall:
        total = max_wall
    return total


def _parse_off_pair(e: Dict[str, Any]) -> Optional[Tuple[str, int, Optional[int]]]:
    name = e.get("name") or e.get("original_name") or ""
    base = e.get("base_code") or e.get("original_base_code") or ""
    if name in EXCLUDED_EVENT_NAMES or base in EXCLUDED_EVENT_NAMES:
        return None
    disp = _map_display_name(e)
    if disp not in OFF_DISPLAY_NAMES:
        return None
    mid = str(e.get("machine_id") or e.get("machine") or "").strip()
    if not mid:
        return None
    ra = e.get("received_at")
    try:
        rt = int(ra) if ra is not None else 0
    except (TypeError, ValueError):
        rt = 0
    if rt <= 0:
        return None
    res = e.get("resolved_at")
    try:
        res_i = int(res) if res is not None and int(res) > 0 else None
    except (TypeError, ValueError):
        res_i = None
    return mid, rt, res_i


def _load_off_events_from_cache(
    day_lo: date,
    day_hi_excl: date,
) -> List[Tuple[str, int, Optional[int]]]:
    out: List[Tuple[str, int, Optional[int]]] = []
    _, factory = create_engine_and_session()
    db = factory()
    try:
        rows = (
            db.query(VendonEventCache)
            .filter(
                VendonEventCache.cache_date >= day_lo,
                VendonEventCache.cache_date < day_hi_excl,
                VendonEventCache.display_name.in_(list(OFF_DISPLAY_NAMES)),
            )
            .all()
        )
        for r in rows:
            payload = r.payload_json if isinstance(r.payload_json, dict) else {}
            merged = dict(payload)
            merged.setdefault("machine_id", r.machine_id)
            merged.setdefault("name", r.name)
            merged.setdefault("base_code", r.base_code)
            merged.setdefault("display_name", r.display_name)
            merged.setdefault("received_at", r.received_at)
            merged.setdefault("resolved_at", r.resolved_at)
            parsed = _parse_off_pair(merged)
            if parsed:
                out.append(parsed)
    except Exception:
        logger.exception("alert downtime: vendon_events_cache read failed")
    finally:
        db.close()
    return out


def _dedupe_off_events(
    rows: List[Tuple[str, int, Optional[int]]],
) -> Dict[str, List[Tuple[int, Optional[int]]]]:
    seen: Set[Tuple[str, int, Optional[int]]] = set()
    by_mid: Dict[str, List[Tuple[int, Optional[int]]]] = {}
    for mid, rt, res_i in rows:
        key = (mid, rt, res_i)
        if key in seen:
            continue
        seen.add(key)
        by_mid.setdefault(mid, []).append((rt, res_i))
    return by_mid


def compute_machine_downtime_summary(
    *,
    period_lo: date,
    period_hi_excl: date,
    period_label: str,
    vendon_get,
    fetch_events_window,
) -> Dict[str, Any]:
    """
    Returns payload for GET /api/alert/overall/downtime-summary.

    todaySec  — operational OFF seconds for Kuwait today through now
    periodSec — operational OFF seconds for the compare baseline window (period B)
                e.g. Yesterday on today_vs_yesterday — clipped at now if open-ended
    """
    tz = ZoneInfo("Asia/Kuwait")
    now = datetime.now(timezone.utc)
    now_ts = int(now.timestamp())
    today = now.astimezone(tz).date()

    today_lo_ts = _kuwait_day_start_ts(today)
    today_hi_ts = now_ts

    period_lo_ts = _kuwait_day_start_ts(period_lo)
    # Closed calendar days use exclusive end; if baseline includes “now”, clip.
    period_hi_ts = min(_kuwait_day_start_ts(period_hi_excl), now_ts)
    if period_hi_ts < period_lo_ts:
        period_hi_ts = period_lo_ts

    cache_day_lo = min(period_lo, today) - timedelta(days=_LOOKBACK_DAYS)
    cache_day_hi = today + timedelta(days=1)

    cached = _load_off_events_from_cache(cache_day_lo, cache_day_hi)

    # Live recent window covers today (+ lookback) when cache is stale / incomplete.
    live_from = max(0, today_lo_ts - _LOOKBACK_DAYS * 86400)
    live_events, live_err = fetch_events_window(live_from, now_ts, max_rows=45000)
    if live_err:
        logger.warning("alert downtime live events: %s", live_err)
    live_parsed: List[Tuple[str, int, Optional[int]]] = []
    for e in live_events or []:
        if not isinstance(e, dict):
            continue
        parsed = _parse_off_pair(e)
        if parsed:
            live_parsed.append(parsed)

    off_by_mid = _dedupe_off_events(cached + live_parsed)

    fleet_rows, fleet_err = vendon_fetch_machine_list(vendon_get)
    machine_list: List[Dict[str, str]] = []
    if not fleet_err and fleet_rows:
        for m in fleet_rows:
            if m.get("id") is None:
                continue
            mid = str(m.get("id")).strip()
            mname = str(m.get("name") or mid)
            if not mid or machine_row_excluded(mname, mid):
                continue
            machine_list.append({"id": mid, "name": mname})

    _, dash_factory = create_dashboard_engine_and_session()
    dash = dash_factory()
    try:
        cleaning_rules: List[MachineCleaningSchedule] = dash.query(MachineCleaningSchedule).all()
    finally:
        dash.close()

    cleaning_by_mid: Dict[str, Any] = {}
    for m in machine_list:
        cleaning_by_mid[m["id"]] = resolve_cleaning_context(m["name"], cleaning_rules)

    by_machine: Dict[str, Dict[str, int]] = {}
    mids = set(cleaning_by_mid.keys()) | set(off_by_mid.keys())
    for mid in mids:
        ctx = cleaning_by_mid.get(mid)
        off_list = off_by_mid.get(mid, [])
        today_sec = _sum_off_operational_seconds(off_list, today_lo_ts, today_hi_ts, now_ts, ctx)
        period_sec = _sum_off_operational_seconds(off_list, period_lo_ts, period_hi_ts, now_ts, ctx)
        if today_sec <= 0 and period_sec <= 0:
            continue
        by_machine[mid] = {"todaySec": today_sec, "periodSec": period_sec}

    return {
        "ok": True,
        "labelToday": "Today",
        "labelPeriod": period_label or "Period",
        "dateToday": today.isoformat(),
        "periodStart": period_lo.isoformat(),
        "periodEndExclusive": period_hi_excl.isoformat(),
        "generatedAt": now.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "source": "vendon_off_events",
        "offTypes": sorted(OFF_DISPLAY_NAMES),
        "byMachineId": by_machine,
        "liveEventsError": live_err,
    }
