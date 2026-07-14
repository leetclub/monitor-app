"""Alert Performance tab — location + product trajectory vs targets."""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any, Callable, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from alert_sx_lib import DEFAULT_SX_PRODUCT, growth_rate, pct_points, _product_cups_cached

logger = logging.getLogger(__name__)
_KWT = ZoneInfo("Asia/Kuwait")

VendonGetVends = Callable[..., Tuple[List[Dict[str, Any]], Optional[str]]]


def build_machine_performance(
    *,
    machine_id: str,
    machine_name: str,
    kwd_by_day: Dict[date, float],
    product_name: str,
    location_target_kd: Optional[float],
    product_target_cups: Optional[float],
    target_period: str,
    history_days: int,
    today: date,
    now_local: datetime,
    fetch_vends_fn: Optional[VendonGetVends],
) -> Dict[str, Any]:
    """Daily location KD + product cups for Revenue Trajectory / product charts."""
    pname = (product_name or "").strip() or DEFAULT_SX_PRODUCT
    period = (target_period or "daily").strip().lower()
    if period not in ("daily", "weekly", "monthly"):
        period = "daily"

    loc_tgt = float(location_target_kd) if location_target_kd is not None else None
    prod_tgt = float(product_target_cups) if product_target_cups is not None else None
    # Chart bars are daily — convert period targets to a daily yardstick
    daily_loc = loc_tgt
    daily_prod = prod_tgt
    if loc_tgt is not None:
        if period == "weekly":
            daily_loc = loc_tgt / 7.0
        elif period == "monthly":
            daily_loc = loc_tgt / 30.0
    if prod_tgt is not None:
        if period == "weekly":
            daily_prod = prod_tgt / 7.0
        elif period == "monthly":
            daily_prod = prod_tgt / 30.0

    days_out: List[Dict[str, Any]] = []
    start = today - timedelta(days=max(1, history_days) - 1)
    d = start
    prev_kwd: Optional[float] = None
    prev_cups: Optional[float] = None
    while d <= today:
        kwd = float(kwd_by_day.get(d) or 0) if kwd_by_day else 0.0
        cups = 0
        if fetch_vends_fn and pname:
            until = now_local if d == today else None
            cups = int(
                _product_cups_cached(machine_id, d, pname, fetch_vends_fn, until_local=until) or 0
            )
        g_loc = pct_points(growth_rate(kwd, prev_kwd)) if prev_kwd is not None else None
        g_prod = pct_points(growth_rate(float(cups), prev_cups)) if prev_cups is not None else None
        days_out.append(
            {
                "date": d.isoformat(),
                "weekday": d.strftime("%a"),
                "locationKwd": round(kwd, 4),
                "productCups": cups,
                "locationTargetKd": round(daily_loc, 4) if daily_loc is not None else None,
                "productTargetCups": round(daily_prod, 2) if daily_prod is not None else None,
                "locationGrowthPct": g_loc,
                "productGrowthPct": g_prod,
                "locationPctOfTarget": (
                    round((kwd / float(daily_loc)) * 100, 1)
                    if daily_loc and float(daily_loc) > 0
                    else None
                ),
                "productPctOfTarget": (
                    round((cups / float(daily_prod)) * 100, 1)
                    if daily_prod and float(daily_prod) > 0
                    else None
                ),
            }
        )
        prev_kwd = kwd
        prev_cups = float(cups)
        d += timedelta(days=1)

    # Simple SX for latest two growth steps on location
    sx_loc = None
    if len(days_out) >= 3:
        cur = days_out[-1]["locationKwd"]
        prev = days_out[-2]["locationKwd"]
        prior = days_out[-3]["locationKwd"]
        g1 = growth_rate(cur, prev)
        g0 = growth_rate(prev, prior)
        if g1 is not None and g0 is not None:
            sx_loc = pct_points(g1 - g0)

    sx_prod = None
    if len(days_out) >= 3:
        cur = float(days_out[-1]["productCups"])
        prev = float(days_out[-2]["productCups"])
        prior = float(days_out[-3]["productCups"])
        g1 = growth_rate(cur, prev)
        g0 = growth_rate(prev, prior)
        if g1 is not None and g0 is not None:
            sx_prod = pct_points(g1 - g0)

    return {
        "machineId": machine_id,
        "machineName": machine_name,
        "productName": pname,
        "targetPeriod": period,
        "locationTargetKd": location_target_kd,
        "productTargetCups": product_target_cups,
        "historyDays": history_days,
        "asOf": now_local.replace(microsecond=0).isoformat(),
        "locationSxPct": sx_loc,
        "productSxPct": sx_prod,
        "days": days_out,
    }


def summarize_machine_period(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Period totals + % of target for ranking charts."""
    days = payload.get("days") or []
    total_kwd = sum(float(d.get("locationKwd") or 0) for d in days)
    daily_tgt = None
    for d in days:
        if d.get("locationTargetKd") is not None:
            daily_tgt = float(d["locationTargetKd"])
            break
    period_tgt = (daily_tgt * len(days)) if daily_tgt and daily_tgt > 0 else None
    pct = round((total_kwd / period_tgt) * 100, 1) if period_tgt and period_tgt > 0 else None
    return {
        "machineId": payload.get("machineId"),
        "machineName": payload.get("machineName"),
        "totalLocationKwd": round(total_kwd, 4),
        "periodTargetKd": round(period_tgt, 4) if period_tgt is not None else None,
        "periodPctOfTarget": pct,
        "locationSxPct": payload.get("locationSxPct"),
        "days": payload.get("days") or [],
    }


def aggregate_fleet_days(machines: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Sum daily KD across machines; average daily target when present."""
    by_date: Dict[str, Dict[str, Any]] = {}
    for m in machines:
        for d in m.get("days") or []:
            key = str(d.get("date") or "")
            if not key:
                continue
            slot = by_date.setdefault(
                key,
                {
                    "date": key,
                    "weekday": d.get("weekday"),
                    "locationKwd": 0.0,
                    "targetSum": 0.0,
                    "targetN": 0,
                    "productCups": 0,
                },
            )
            slot["locationKwd"] += float(d.get("locationKwd") or 0)
            tgt = d.get("locationTargetKd")
            if tgt is not None and float(tgt) > 0:
                slot["targetSum"] += float(tgt)
                slot["targetN"] += 1
    out: List[Dict[str, Any]] = []
    prev: Optional[float] = None
    for key in sorted(by_date.keys()):
        slot = by_date[key]
            kwd = float(slot["locationKwd"])
            # For aggregate, sum targets (fleet target) not average
            fleet_tgt = float(slot["targetSum"]) if slot["targetN"] else None
            g = pct_points(growth_rate(kwd, prev)) if prev is not None else None
            out.append(
                {
                    "date": slot["date"],
                    "weekday": slot["weekday"],
                    "locationKwd": round(kwd, 4),
                    "productCups": 0,
                    "locationTargetKd": round(fleet_tgt, 4) if fleet_tgt is not None else None,
                    "productTargetCups": None,
                    "locationGrowthPct": g,
                    "productGrowthPct": None,
                    "locationPctOfTarget": (
                        round((kwd / fleet_tgt) * 100, 1) if fleet_tgt and fleet_tgt > 0 else None
                    ),
                    "productPctOfTarget": None,
                }
            )
            prev = kwd
    return out
