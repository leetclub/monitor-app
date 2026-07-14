"""Alert Admin Targets + Performance calendar windows (Kuwait)."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Tuple

VALID_METRICS = ("revenue", "cups")
VALID_PERIODS = ("daily", "weekly", "monthly")


def normalize_metric(raw: Any, default: str = "revenue") -> str:
    s = str(raw or "").strip().lower()
    if s in ("kd", "kwd", "sales", "money"):
        return "revenue"
    if s in ("cup", "units"):
        return "cups"
    return s if s in VALID_METRICS else default


def normalize_period(raw: Any, default: str = "daily") -> str:
    s = str(raw or "").strip().lower()
    return s if s in VALID_PERIODS else default


def normalize_promoted_products(raw: Any) -> List[Dict[str, Any]]:
    """Normalize promoted product rows; keep order; drop empty names."""
    if raw is None:
        return []
    if isinstance(raw, dict):
        raw = [raw]
    if not isinstance(raw, list):
        return []
    out: List[Dict[str, Any]] = []
    seen = set()
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        name = str(
            item.get("productName")
            or item.get("product_name")
            or item.get("name")
            or ""
        ).strip()
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        metric = normalize_metric(item.get("metric") or item.get("targetMetric"), "cups")
        tgt_raw = item.get("dailyTarget", item.get("daily_target", item.get("target")))
        try:
            daily_target = float(tgt_raw) if tgt_raw is not None and str(tgt_raw).strip() != "" else None
        except (TypeError, ValueError):
            daily_target = None
        if daily_target is not None and daily_target < 0:
            daily_target = None
        period = normalize_period(item.get("period") or item.get("targetPeriod"), "daily")
        primary = bool(item.get("primary")) if "primary" in item else (i == 0 and not out)
        out.append(
            {
                "productName": name,
                "metric": metric,
                "dailyTarget": round(daily_target, 4) if daily_target is not None else None,
                "period": period,
                "primary": primary,
            }
        )
    if out and not any(p.get("primary") for p in out):
        out[0]["primary"] = True
    # Only one primary
    saw = False
    for p in out:
        if p.get("primary") and not saw:
            saw = True
        else:
            p["primary"] = False if saw else p.get("primary")
    if out and not saw:
        out[0]["primary"] = True
    return out[:12]


def products_from_lmc_row(lmc: Any) -> List[Dict[str, Any]]:
    """Read promoted_products JSON or fall back to legacy sx_product_name fields."""
    raw = getattr(lmc, "promoted_products", None)
    products = normalize_promoted_products(raw)
    if products:
        return products
    pname = (getattr(lmc, "sx_product_name", None) or "").strip()
    if not pname:
        return []
    ptgt = getattr(lmc, "daily_product_target", None)
    try:
        cups = float(ptgt) if ptgt is not None else None
    except (TypeError, ValueError):
        cups = None
    return [
        {
            "productName": pname,
            "metric": "cups",
            "dailyTarget": cups,
            "period": normalize_period(getattr(lmc, "sx_target_period", None), "daily"),
            "primary": True,
        }
    ]


def legacy_primary_from_products(
    products: List[Dict[str, Any]],
) -> Tuple[Optional[str], Optional[float], str]:
    """Mirror primary product into legacy LMC columns for SX/Performance compat."""
    if not products:
        return None, None, "daily"
    primary = next((p for p in products if p.get("primary")), products[0])
    name = str(primary.get("productName") or "").strip() or None
    tgt = primary.get("dailyTarget")
    try:
        tgt_f = float(tgt) if tgt is not None else None
    except (TypeError, ValueError):
        tgt_f = None
    # Legacy column is cups-oriented; still store numeric target for primary
    return name, tgt_f, normalize_period(primary.get("period"), "daily")


def _kuwait_week_start(d: date) -> date:
    """Sunday-start week (matches Alert WTD presets)."""
    # Python: Mon=0 … Sun=6 → days since Sunday
    return d - timedelta(days=(d.weekday() + 1) % 7)


def resolve_perf_window(
    *,
    today: date,
    preset: str,
    history_days: int = 14,
) -> Tuple[date, date, date, date, str]:
    """
    Return (win_start, win_end, prev_start, prev_end, preset_id).
    win_end is inclusive; for open periods ends at today.
    """
    p = (preset or "last_week").strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "wtd": "this_week",
        "week_to_date": "this_week",
        "thisweek": "this_week",
        "lastweek": "last_week",
        "last_2_week": "last_2_weeks",
        "last2weeks": "last_2_weeks",
        "mtd": "this_month",
        "month_to_date": "this_month",
        "thismonth": "this_month",
        "lastmonth": "last_month",
        "rolling": "rolling",
        "days": "rolling",
    }
    p = aliases.get(p, p)

    if p == "today":
        win_start = win_end = today
        prev_start = prev_end = today - timedelta(days=1)
        return win_start, win_end, prev_start, prev_end, "today"

    if p == "yesterday":
        y = today - timedelta(days=1)
        win_start = win_end = y
        prev_start = prev_end = y - timedelta(days=1)
        return win_start, win_end, prev_start, prev_end, "yesterday"

    if p in ("this_week",):
        win_start = _kuwait_week_start(today)
        win_end = today
        span = (win_end - win_start).days + 1
        prev_end = win_start - timedelta(days=1)
        prev_start = prev_end - timedelta(days=span - 1)
        return win_start, win_end, prev_start, prev_end, "this_week"

    if p in ("last_week",):
        this_sun = _kuwait_week_start(today)
        win_start = this_sun - timedelta(days=7)
        win_end = this_sun - timedelta(days=1)
        prev_start = win_start - timedelta(days=7)
        prev_end = win_start - timedelta(days=1)
        return win_start, win_end, prev_start, prev_end, "last_week"

    if p in ("last_2_weeks",):
        this_sun = _kuwait_week_start(today)
        win_end = this_sun - timedelta(days=1)
        win_start = win_end - timedelta(days=13)
        prev_end = win_start - timedelta(days=1)
        prev_start = prev_end - timedelta(days=13)
        return win_start, win_end, prev_start, prev_end, "last_2_weeks"

    if p in ("this_month",):
        win_start = today.replace(day=1)
        win_end = today
        # Previous: same elapsed days of prior month
        if win_start.month == 1:
            prev_month_start = date(win_start.year - 1, 12, 1)
        else:
            prev_month_start = date(win_start.year, win_start.month - 1, 1)
        elapsed = (win_end - win_start).days
        prev_start = prev_month_start
        prev_end = prev_month_start + timedelta(days=elapsed)
        # Clamp prev_end to last day of that month
        if prev_month_start.month == 12:
            next_m = date(prev_month_start.year + 1, 1, 1)
        else:
            next_m = date(prev_month_start.year, prev_month_start.month + 1, 1)
        last_prev = next_m - timedelta(days=1)
        if prev_end > last_prev:
            prev_end = last_prev
        return win_start, win_end, prev_start, prev_end, "this_month"

    if p in ("last_month",):
        first_this = today.replace(day=1)
        win_end = first_this - timedelta(days=1)
        win_start = win_end.replace(day=1)
        if win_start.month == 1:
            prev_start = date(win_start.year - 1, 12, 1)
        else:
            prev_start = date(win_start.year, win_start.month - 1, 1)
        prev_end = win_start - timedelta(days=1)
        return win_start, win_end, prev_start, prev_end, "last_month"

    # Rolling fallback
    days = max(1, min(62, int(history_days or 14)))
    win_end = today
    win_start = today - timedelta(days=days - 1)
    prev_end = win_start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=days - 1)
    return win_start, win_end, prev_start, prev_end, "rolling"


def daily_yardstick(period_target: Optional[float], period: str) -> Optional[float]:
    """Convert period target to a daily yardstick for charts."""
    if period_target is None:
        return None
    try:
        v = float(period_target)
    except (TypeError, ValueError):
        return None
    if v <= 0:
        return None
    per = normalize_period(period, "daily")
    if per == "weekly":
        return v / 7.0
    if per == "monthly":
        return v / 30.0
    return v
