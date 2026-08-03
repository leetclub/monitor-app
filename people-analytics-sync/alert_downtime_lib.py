"""
Per-machine operational downtime for Alert Red Flags / Overall.

Source: Vendon OFF episodes (Machine OFF, KNet OFF, Vendon OFF) from vendon_events_cache
plus a live /event fetch for the recent window. Duration uses operational time
(wall clock minus Admin cleaning windows), matching Red Alert gap math.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Dict, List, Optional, Set, Tuple
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


def _parse_off_pair(e: Dict[str, Any]) -> Optional[Tuple[str, str, int, Optional[int]]]:
    """Return (machine_id, display_name, received_at, resolved_at)."""
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
    return mid, disp, rt, res_i


def _load_off_events_from_cache(
    day_lo: date,
    day_hi_excl: date,
) -> List[Tuple[str, str, int, Optional[int]]]:
    out: List[Tuple[str, str, int, Optional[int]]] = []
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
    rows: List[Tuple[str, str, int, Optional[int]]],
) -> Dict[str, List[Tuple[str, int, Optional[int]]]]:
    """machine_id → list of (display_name, received_at, resolved_at)."""
    seen: Set[Tuple[str, str, int, Optional[int]]] = set()
    by_mid: Dict[str, List[Tuple[str, int, Optional[int]]]] = {}
    for mid, disp, rt, res_i in rows:
        key = (mid, disp, rt, res_i)
        if key in seen:
            continue
        seen.add(key)
        by_mid.setdefault(mid, []).append((disp, rt, res_i))
    return by_mid


def _off_pairs_only(
    typed: List[Tuple[str, int, Optional[int]]],
) -> List[Tuple[int, Optional[int]]]:
    return [(rt, res_i) for _disp, rt, res_i in typed]


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
    live_parsed: List[Tuple[str, str, int, Optional[int]]] = []
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
        off_list = _off_pairs_only(off_by_mid.get(mid, []))
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


def _iso_kwt(ts: int) -> str:
    tz = ZoneInfo("Asia/Kuwait")
    return datetime.fromtimestamp(int(ts), tz=tz).replace(microsecond=0).isoformat()


def _collect_off_by_mid(
    *,
    today: date,
    fetch_events_window,
) -> Tuple[Dict[str, List[Tuple[str, int, Optional[int]]]], Optional[str], int]:
    now_ts = int(datetime.now(timezone.utc).timestamp())
    today_lo_ts = _kuwait_day_start_ts(today)
    cache_day_lo = today - timedelta(days=_LOOKBACK_DAYS)
    cache_day_hi = today + timedelta(days=1)
    cached = _load_off_events_from_cache(cache_day_lo, cache_day_hi)
    live_from = max(0, today_lo_ts - _LOOKBACK_DAYS * 86400)
    live_events, live_err = fetch_events_window(live_from, now_ts, max_rows=45000)
    live_parsed: List[Tuple[str, str, int, Optional[int]]] = []
    for e in live_events or []:
        if not isinstance(e, dict):
            continue
        parsed = _parse_off_pair(e)
        if parsed:
            live_parsed.append(parsed)
    return _dedupe_off_events(cached + live_parsed), live_err, now_ts


def compute_machine_downtime_detail(
    machine_id: str,
    machine_name: Optional[str],
    *,
    vendon_get,
    fetch_events_window,
    sales_baselines: Optional[List[Dict[str, Any]]] = None,
    fetch_window_sales: Optional[Callable[[str, int, int], float]] = None,
) -> Dict[str, Any]:
    """
    Per-machine OFF events for Kuwait today + estimated KD loss.

    Loss method (preferred): actual Vendon sales on the baseline day during the
    **same clock hours** as the downtime (e.g. today 10:15–11:40 → yesterday 10:15–11:40).
    Primary baseline = yesterday; also day-before and same weekday last week.

    Fallback if window sales unavailable: day same-elapsed rate × operational seconds.
    """
    mid = str(machine_id or "").strip()
    if not mid:
        return {"ok": False, "error": "machine_id required", "events": []}

    tz = ZoneInfo("Asia/Kuwait")
    now = datetime.now(timezone.utc)
    today = now.astimezone(tz).date()
    today_lo_ts = _kuwait_day_start_ts(today)
    now_ts = int(now.timestamp())

    off_by_mid, live_err, now_ts = _collect_off_by_mid(
        today=today,
        fetch_events_window=fetch_events_window,
    )
    typed = off_by_mid.get(mid, [])

    name = (machine_name or "").strip() or mid
    if not (machine_name or "").strip():
        fleet_rows, _ferr = vendon_fetch_machine_list(vendon_get)
        for m in fleet_rows or []:
            if str(m.get("id") or "").strip() == mid:
                name = str(m.get("name") or mid)
                break

    _, dash_factory = create_dashboard_engine_and_session()
    dash = dash_factory()
    try:
        cleaning_rules: List[MachineCleaningSchedule] = dash.query(MachineCleaningSchedule).all()
    finally:
        dash.close()
    ctx = resolve_cleaning_context(name, cleaning_rules)

    # Keep clip timestamps for window-aligned loss.
    event_clips: List[Tuple[Dict[str, Any], int, int]] = []
    for disp, rt, res_i in typed:
        end_eff = res_i if res_i is not None else now_ts
        clip_lo = max(int(rt), int(today_lo_ts))
        clip_hi = min(int(end_eff), int(now_ts))
        if clip_lo >= clip_hi:
            continue
        wall_sec = clip_hi - clip_lo
        op_sec = int(operational_gap_seconds(clip_lo, clip_hi, ctx))
        max_wall = max(0, now_ts - today_lo_ts)
        if op_sec > max_wall:
            op_sec = max_wall
        ev = {
            "eventType": disp,
            "startAt": _iso_kwt(clip_lo),
            "endAt": _iso_kwt(clip_hi) if res_i is not None and res_i <= now_ts else None,
            "endAtEffective": _iso_kwt(clip_hi),
            "open": res_i is None or int(res_i) > now_ts,
            "wallSec": wall_sec,
            "operationalSec": op_sec,
        }
        event_clips.append((ev, clip_lo, clip_hi))

    event_clips.sort(key=lambda t: str(t[0].get("startAt") or ""), reverse=True)
    events = [t[0] for t in event_clips]

    today_merged_sec = _sum_off_operational_seconds(
        _off_pairs_only(typed), today_lo_ts, now_ts, now_ts, ctx
    )

    baselines_out: List[Dict[str, Any]] = []
    for b in sales_baselines or []:
        if not isinstance(b, dict):
            continue
        label = str(b.get("label") or "").strip() or "Baseline"
        day_iso = str(b.get("date") or "").strip()
        try:
            baseline_day = date.fromisoformat(day_iso) if day_iso else None
        except ValueError:
            baseline_day = None
        kwd = b.get("kwd")
        elapsed_sec = b.get("elapsedSec")
        try:
            kwd_f = float(kwd) if kwd is not None else None
            el_f = float(elapsed_sec) if elapsed_sec is not None else None
        except (TypeError, ValueError):
            kwd_f, el_f = None, None
        rate = None
        if kwd_f is not None and el_f is not None and el_f > 0:
            rate = kwd_f / el_f
        baselines_out.append(
            {
                "id": str(b.get("id") or label).strip(),
                "label": label,
                "date": day_iso or None,
                "baselineDay": baseline_day,
                "kwd": round(kwd_f, 4) if kwd_f is not None else None,
                "elapsedSec": int(el_f) if el_f is not None else None,
                "kwdPerSec": round(rate, 8) if rate is not None else None,
                "primary": bool(b.get("primary")),
            }
        )

    def _shift_window(clip_lo: int, clip_hi: int, baseline_day: date) -> Tuple[int, int]:
        """Map today's [clip_lo, clip_hi) onto the same clock on baseline_day (Kuwait)."""
        off_lo = int(clip_lo) - int(today_lo_ts)
        off_hi = int(clip_hi) - int(today_lo_ts)
        b_start = _kuwait_day_start_ts(baseline_day)
        return b_start + max(0, off_lo), b_start + max(0, off_hi)

    window_cache: Dict[Tuple[int, int], Optional[float]] = {}

    def _sales_for_window(ws: int, we: int) -> Optional[float]:
        if we <= ws:
            return 0.0
        key = (int(ws), int(we))
        if key in window_cache:
            return window_cache[key]
        val: Optional[float] = None
        if fetch_window_sales is not None:
            try:
                val = float(fetch_window_sales(mid, key[0], key[1]))
            except Exception:
                logger.exception("downtime window sales %s %s-%s", mid, ws, we)
                val = None
        window_cache[key] = val
        return val

    # Prefetch unique baseline windows (events + merged) in parallel.
    prefetch: List[Tuple[int, int]] = []
    for _ev, clip_lo, clip_hi in event_clips:
        for b in baselines_out:
            bd = b.get("baselineDay")
            if not isinstance(bd, date):
                continue
            b_lo, b_hi = _shift_window(clip_lo, clip_hi, bd)
            if b_hi > b_lo:
                prefetch.append((b_lo, b_hi))
    # Merged intervals for today total (no double-count across OFF types)
    merge_clips: List[Tuple[int, int]] = []
    for _disp, rt, res_i in typed:
        end_eff = res_i if res_i is not None else now_ts
        clip_lo = max(int(rt), int(today_lo_ts))
        clip_hi = min(int(end_eff), int(now_ts))
        if clip_lo < clip_hi:
            merge_clips.append((clip_lo, clip_hi))
    merged = _merge_intervals(merge_clips)
    for clip_lo, clip_hi in merged:
        for b in baselines_out:
            bd = b.get("baselineDay")
            if not isinstance(bd, date):
                continue
            b_lo, b_hi = _shift_window(clip_lo, clip_hi, bd)
            if b_hi > b_lo:
                prefetch.append((b_lo, b_hi))

    uniq_prefetch = sorted(set(prefetch))
    if fetch_window_sales is not None and uniq_prefetch:
        def _job(pair: Tuple[int, int]) -> None:
            _sales_for_window(pair[0], pair[1])

        with ThreadPoolExecutor(max_workers=min(6, max(1, len(uniq_prefetch)))) as pool:
            list(pool.map(_job, uniq_prefetch))

    used_window_sales = False
    for ev, clip_lo, clip_hi in event_clips:
        op = int(ev.get("operationalSec") or 0)
        loss_by: Dict[str, Optional[float]] = {}
        primary_loss: Optional[float] = None
        for b in baselines_out:
            bid = str(b.get("id") or b.get("label"))
            bd = b.get("baselineDay")
            loss: Optional[float] = None
            if isinstance(bd, date):
                b_lo, b_hi = _shift_window(clip_lo, clip_hi, bd)
                sales = _sales_for_window(b_lo, b_hi)
                if sales is not None:
                    loss = round(float(sales), 3)
                    used_window_sales = True
            if loss is None:
                rate = b.get("kwdPerSec")
                if rate is not None and op > 0:
                    loss = round(float(rate) * op, 3)
            loss_by[bid] = loss
            if b.get("primary") and loss is not None and primary_loss is None:
                primary_loss = loss
        if primary_loss is None:
            for b in baselines_out:
                bid = str(b.get("id") or b.get("label"))
                if loss_by.get(bid) is not None:
                    primary_loss = loss_by[bid]
                    break
        ev["estimatedLossKwd"] = loss_by
        ev["estimatedLossPrimaryKwd"] = primary_loss

    # Today total: sum window sales over merged OFF intervals (primary baseline)
    total_by: Dict[str, Optional[float]] = {str(b.get("id") or b.get("label")): 0.0 for b in baselines_out}
    total_ok: Dict[str, bool] = {k: True for k in total_by}
    for clip_lo, clip_hi in merged:
        for b in baselines_out:
            bid = str(b.get("id") or b.get("label"))
            bd = b.get("baselineDay")
            piece: Optional[float] = None
            if isinstance(bd, date):
                b_lo, b_hi = _shift_window(clip_lo, clip_hi, bd)
                sales = _sales_for_window(b_lo, b_hi)
                if sales is not None:
                    piece = float(sales)
                    used_window_sales = True
            if piece is None:
                rate = b.get("kwdPerSec")
                op = int(operational_gap_seconds(clip_lo, clip_hi, ctx))
                if rate is not None and op > 0:
                    piece = float(rate) * op
            if piece is None:
                total_ok[bid] = False
            else:
                total_by[bid] = float(total_by.get(bid) or 0) + piece
    for bid, ok in total_ok.items():
        if not ok:
            total_by[bid] = None
        elif total_by.get(bid) is not None:
            total_by[bid] = round(float(total_by[bid]), 3)

    primary_id = None
    for b in baselines_out:
        if b.get("primary"):
            primary_id = str(b.get("id") or b.get("label"))
            break
    if primary_id is None and baselines_out:
        primary_id = str(baselines_out[0].get("id") or baselines_out[0].get("label"))
    total_primary = total_by.get(primary_id) if primary_id else None

    # Strip non-JSON baselineDay
    for b in baselines_out:
        b.pop("baselineDay", None)

    method = (
        "estimated_kd = actual Vendon sales on the baseline day during the same Kuwait clock hours "
        "as the downtime (e.g. today 10:15–11:40 vs yesterday 10:15–11:40). "
        "Primary = yesterday; also day before and same weekday last week. "
        "Concurrent OFF types are listed separately; today total merges overlaps."
    )
    if not used_window_sales:
        method = (
            "Fallback: baseline same-elapsed KD / elapsed seconds × downtime operational seconds "
            "(window-aligned sales unavailable). Primary = yesterday."
        )

    return {
        "ok": True,
        "machineId": mid,
        "machineName": name,
        "dateToday": today.isoformat(),
        "generatedAt": now.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "todayMergedOperationalSec": today_merged_sec,
        "estimatedLossTodayPrimaryKwd": total_primary,
        "estimatedLossTodayKwd": total_by,
        "lossMethod": method,
        "lossAlignedToClock": used_window_sales,
        "baselines": baselines_out,
        "events": events,
        "liveEventsError": live_err,
        "offTypes": sorted(OFF_DISPLAY_NAMES),
    }
