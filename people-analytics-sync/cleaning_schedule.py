"""
DC cleaning schedule: match machine name to DB rules, detect Kuwait-local windows,
subtract cleaning overlap from sale gaps for Red Alert.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from zoneinfo import ZoneInfo


@dataclass
class CleaningContext:
    """Resolved schedule for one machine (from first matching rule)."""

    cleaning_operator: str
    tz_name: str
    windows: List[Dict[str, str]]  # {"start": "HH:MM", "end": "HH:MM"}


def hhmm_to_minutes(hhmm: str) -> int:
    p = (hhmm or "").strip().split(":")
    if len(p) != 2:
        return 0
    return int(p[0]) * 60 + int(p[1])


def _window_segment_utc(day_local_start: datetime, start_min: int, end_min: int) -> Tuple[int, int]:
    """Same calendar day in tz; [start_min, end_min) from midnight, no midnight wrap."""
    ws = int(day_local_start.timestamp()) + start_min * 60
    we = int(day_local_start.timestamp()) + end_min * 60
    return ws, we


def overlap_cleaning_seconds(t_lo: int, t_hi: int, windows: List[Dict[str, str]], tz_name: str) -> int:
    """Seconds of [t_lo, t_hi] that fall inside any daily recurring window (local tz)."""
    if t_hi <= t_lo or not windows:
        return 0
    tz = ZoneInfo(tz_name)
    overlap = 0
    cur_local = datetime.fromtimestamp(t_lo, tz=timezone.utc).astimezone(tz)
    end_local = datetime.fromtimestamp(t_hi, tz=timezone.utc).astimezone(tz)
    d = cur_local.date()
    end_d = end_local.date()
    one = timedelta(days=1)
    while d <= end_d:
        day0 = datetime(d.year, d.month, d.day, 0, 0, 0, tzinfo=tz)
        for w in windows:
            sm = hhmm_to_minutes(str(w.get("start") or "00:00"))
            em = hhmm_to_minutes(str(w.get("end") or "00:00"))
            if em <= sm:
                continue
            ws, we = _window_segment_utc(day0, sm, em)
            a = max(t_lo, ws)
            b = min(t_hi, we)
            if b > a:
                overlap += b - a
        d = d + one
    return overlap


def is_timestamp_in_cleaning(utc_ts: int, ctx: Optional[CleaningContext]) -> bool:
    if not ctx or not ctx.windows:
        return False
    return overlap_cleaning_seconds(utc_ts, utc_ts + 1, ctx.windows, ctx.tz_name) > 0


def operational_gap_seconds(t_prev: int, t_next: int, ctx: Optional[CleaningContext]) -> int:
    """Wall gap minus time inside cleaning windows."""
    if t_next <= t_prev:
        return 0
    wall = t_next - t_prev
    if not ctx or not ctx.windows:
        return wall
    oc = overlap_cleaning_seconds(t_prev, t_next, ctx.windows, ctx.tz_name)
    return max(0, wall - oc)


def count_stale_sale_episodes_adjusted(
    vends_ts: List[int],
    win_start: int,
    win_end: int,
    ctx: Optional[CleaningContext],
    stale_sec: int,
) -> int:
    """
    Like raw episode count, but gaps use operational time (cleaning subtracted).
    Chronic no-vend in lookback still counts 1 when appropriate.
    """
    full = sorted({int(t) for t in vends_ts if t and t > 0})
    ts = [t for t in full if t <= win_end]
    if not ts:
        if not full:
            if is_timestamp_in_cleaning(win_end, ctx):
                return 0
            return 1 if win_end >= win_start else 0
        return 0
    n = 0
    for i in range(1, len(ts)):
        prev, cur = ts[i - 1], ts[i]
        op = operational_gap_seconds(prev, cur, ctx)
        if op < stale_sec:
            continue
        if win_start <= cur <= win_end:
            n += 1
    last = ts[-1]
    op_ongoing = operational_gap_seconds(last, win_end, ctx)
    if op_ongoing >= stale_sec and not is_timestamp_in_cleaning(win_end, ctx):
        n += 1
    return n


def resolve_cleaning_context(
    machine_name: str,
    rules: List[Any],
) -> Optional[CleaningContext]:
    """
    rules: ORM rows with name_pattern, cleaning_operator, timezone, windows, priority.
    """
    if not machine_name or not rules:
        return None
    name_l = machine_name.lower()
    best: Optional[Any] = None
    best_key: Tuple[int, int] = (-1, -1)  # priority, pattern len
    for r in rules:
        pat = (r.name_pattern or "").strip().lower()
        if not pat or pat not in name_l:
            continue
        pr = int(r.priority or 0)
        ln = len(pat)
        key = (pr, ln)
        if key > best_key:
            best_key = key
            best = r
    if not best:
        return None
    w = best.windows
    if isinstance(w, str):
        import json

        try:
            w = json.loads(w)
        except Exception:
            w = []
    if not isinstance(w, list):
        w = []
    return CleaningContext(
        cleaning_operator=str(best.cleaning_operator or "").strip(),
        tz_name=(best.timezone or "Asia/Kuwait").strip() or "Asia/Kuwait",
        windows=[x for x in w if isinstance(x, dict)],
    )
