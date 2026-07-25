"""
Alert machine inactive schedule helpers.

inactive_schedule JSON shape:
  {
    "weekdays": [0-6],   # Sun=0 … Sat=6 — inactive every matching weekday
    "dates": ["YYYY-MM-DD"],
    "ranges": [{"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}]
  }

is_active=False → always inactive on boards.
is_active=True + schedule match for Kuwait today → inactive today (shaded).
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo


def _parse_iso_date(s: Any) -> Optional[date]:
    try:
        return datetime.strptime(str(s)[:10], "%Y-%m-%d").date()
    except Exception:
        return None


def kuwait_weekday_sun0(d: date) -> int:
    """Python weekday Mon=0 → Sun=0 … Sat=6."""
    return (d.weekday() + 1) % 7


def normalize_inactive_schedule(raw: Any) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        return {"weekdays": [], "dates": [], "ranges": []}
    weekdays: List[int] = []
    for x in raw.get("weekdays") or []:
        try:
            n = int(x)
        except (TypeError, ValueError):
            continue
        if 0 <= n <= 6 and n not in weekdays:
            weekdays.append(n)
    weekdays.sort()
    dates: List[str] = []
    for x in raw.get("dates") or []:
        d = _parse_iso_date(x)
        if d:
            iso = d.isoformat()
            if iso not in dates:
                dates.append(iso)
    dates.sort()
    ranges: List[Dict[str, str]] = []
    for r in raw.get("ranges") or []:
        if not isinstance(r, dict):
            continue
        a = _parse_iso_date(r.get("start"))
        b = _parse_iso_date(r.get("end"))
        if a and b and a <= b:
            ranges.append({"start": a.isoformat(), "end": b.isoformat()})
    return {"weekdays": weekdays, "dates": dates, "ranges": ranges}


def machine_inactive_on(
    *,
    is_active: bool = True,
    inactive_schedule: Any = None,
    on_date: Optional[date] = None,
) -> Dict[str, Any]:
    """
    Returns { inactive: bool, reason: 'always'|'weekday'|'date'|'range'|None, label: str }.
    """
    d = on_date or datetime.now(ZoneInfo("Asia/Kuwait")).date()
    if is_active is False:
        return {"inactive": True, "reason": "always", "label": "Inactive"}
    sched = normalize_inactive_schedule(inactive_schedule)
    wd = kuwait_weekday_sun0(d)
    if wd in (sched.get("weekdays") or []):
        return {"inactive": True, "reason": "weekday", "label": "Inactive today"}
    iso = d.isoformat()
    if iso in (sched.get("dates") or []):
        return {"inactive": True, "reason": "date", "label": "Inactive today"}
    for r in sched.get("ranges") or []:
        a = _parse_iso_date(r.get("start"))
        b = _parse_iso_date(r.get("end"))
        if a and b and a <= d <= b:
            return {"inactive": True, "reason": "range", "label": "Inactive today"}
    return {"inactive": False, "reason": None, "label": ""}
