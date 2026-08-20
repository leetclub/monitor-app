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
        "wtd": "wtd",
        "week_to_date": "wtd",
        "wtd_only": "wtd",
        "wtd_vs_wtd": "this_week",
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
        "wtd_vs_ly": "wtd_vs_ly",
        "wtd_vs_yoy": "wtd_vs_ly",
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

    # WTD alone — current week to today; prior window mirrors for callers that still need it,
    # but product-compare can disable comparison via compare=0.
    if p == "wtd":
        win_start = _kuwait_week_start(today)
        win_end = today
        span = (win_end - win_start).days + 1
        prev_end = win_start - timedelta(days=1)
        prev_start = prev_end - timedelta(days=span - 1)
        return win_start, win_end, prev_start, prev_end, "wtd"

    if p in ("this_week",):
        win_start = _kuwait_week_start(today)
        win_end = today
        span = (win_end - win_start).days + 1
        prev_end = win_start - timedelta(days=1)
        prev_start = prev_end - timedelta(days=span - 1)
        return win_start, win_end, prev_start, prev_end, "this_week"

    # WTD vs same week last year (up to same weekday / elapsed days).
    if p == "wtd_vs_ly":
        win_start = _kuwait_week_start(today)
        win_end = today
        span = (win_end - win_start).days
        try:
            prev_start = date(win_start.year - 1, win_start.month, win_start.day)
        except ValueError:
            prev_start = win_start - timedelta(days=365)
        prev_end = prev_start + timedelta(days=span)
        return win_start, win_end, prev_start, prev_end, "wtd_vs_ly"

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


def _avg(vals: List[float]) -> Optional[float]:
    clean = [float(v) for v in vals if v is not None and float(v) >= 0]
    if not clean:
        return None
    return round(sum(clean) / len(clean), 4)


def build_location_sales_insights(
    kwd_by_day: Dict[date, float],
    *,
    today: date,
) -> Dict[str, Any]:
    """Rolling KD stats to help set location targets (from revenue cache)."""
    def sum_range(lo: date, hi: date) -> float:
        tot = 0.0
        d = lo
        while d <= hi:
            tot += float(kwd_by_day.get(d) or 0)
            d += timedelta(days=1)
        return round(tot, 4)

    def daily_list(lo: date, hi: date) -> List[float]:
        out: List[float] = []
        d = lo
        while d <= hi:
            out.append(float(kwd_by_day.get(d) or 0))
            d += timedelta(days=1)
        return out

    yday = today - timedelta(days=1)
    last7_lo = today - timedelta(days=6)
    last14_lo = today - timedelta(days=13)
    last28_lo = today - timedelta(days=27)
    week_sun = _kuwait_week_start(today)
    last_week_lo = week_sun - timedelta(days=7)
    last_week_hi = week_sun - timedelta(days=1)

    avg7 = _avg(daily_list(last7_lo, today))
    avg14 = _avg(daily_list(last14_lo, today))
    avg28 = _avg(daily_list(last28_lo, today))
    # Suggested daily ≈ mild stretch on 14-day average
    suggested = round(avg14 * 1.05, 3) if avg14 and avg14 > 0 else (avg7 if avg7 else None)

    return {
        "unit": "kd",
        "todayKd": round(float(kwd_by_day.get(today) or 0), 4),
        "yesterdayKd": round(float(kwd_by_day.get(yday) or 0), 4),
        "avgDaily7d": avg7,
        "avgDaily14d": avg14,
        "avgDaily28d": avg28,
        "last7TotalKd": sum_range(last7_lo, today),
        "wtdTotalKd": sum_range(week_sun, today),
        "lastWeekTotalKd": sum_range(last_week_lo, last_week_hi),
        "suggestedDailyKd": suggested,
        "hint": (
            f"14-day avg {avg14:.2f} KD/day · last week {sum_range(last_week_lo, last_week_hi):.1f} KD total"
            if avg14
            else "Not enough recent sales in cache yet."
        ),
    }


def build_product_cups_insights(
    cups_by_day: Dict[date, float],
    *,
    today: date,
    product_name: str,
) -> Dict[str, Any]:
    """Rolling cups stats for one promoted product."""
    def daily_list(lo: date, hi: date) -> List[float]:
        out: List[float] = []
        d = lo
        while d <= hi:
            out.append(float(cups_by_day.get(d) or 0))
            d += timedelta(days=1)
        return out

    def sum_range(lo: date, hi: date) -> float:
        return round(sum(daily_list(lo, hi)), 2)

    yday = today - timedelta(days=1)
    last7_lo = today - timedelta(days=6)
    last14_lo = today - timedelta(days=13)
    week_sun = _kuwait_week_start(today)
    last_week_lo = week_sun - timedelta(days=7)
    last_week_hi = week_sun - timedelta(days=1)
    avg7 = _avg(daily_list(last7_lo, today))
    avg14 = _avg(daily_list(last14_lo, today))
    suggested = round(avg14 * 1.05, 1) if avg14 and avg14 > 0 else (avg7 if avg7 else None)
    return {
        "productName": product_name,
        "unit": "cups",
        "todayCups": int(cups_by_day.get(today) or 0),
        "yesterdayCups": int(cups_by_day.get(yday) or 0),
        "avgDaily7d": avg7,
        "avgDaily14d": avg14,
        "last7TotalCups": int(sum_range(last7_lo, today)),
        "wtdTotalCups": int(sum_range(week_sun, today)),
        "lastWeekTotalCups": int(sum_range(last_week_lo, last_week_hi)),
        "suggestedDailyCups": suggested,
        "hint": (
            f"{product_name}: 14-day avg {avg14:.1f} cups/day · last week {sum_range(last_week_lo, last_week_hi):.0f} cups"
            if avg14
            else f"{product_name}: not enough recent cups yet."
        ),
    }
