"""Target detail for Alert Red Flags Target column modal."""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, time as dt_time
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from week_revenue_target_lib import (
    daily_target_kd_from_week,
    infer_owner_segment,
    target_business_days,
    week_revenue_target_kd_rounded,
)

logger = logging.getLogger(__name__)


def _sunday_on_or_before(d: date) -> date:
    return d - timedelta(days=(d.weekday() + 1) % 7)


def _sum_revenue(db: Session, machine_id: str, days: List[date]) -> float:
    if not days:
        return 0.0
    try:
        from models import VendonDailyMachineRevenueCache

        rows = (
            db.query(VendonDailyMachineRevenueCache)
            .filter(
                VendonDailyMachineRevenueCache.machine_id == machine_id,
                VendonDailyMachineRevenueCache.cache_date.in_(days),
            )
            .all()
        )
        return sum(float(r.total_sales_kwd or 0) for r in rows)
    except Exception:
        logger.exception("alert_target revenue sum")
        return 0.0


def _pct(actual: float, target: float) -> Optional[float]:
    if target <= 0:
        return None
    return round((actual / target) * 10000) / 100


def build_machine_target_detail(
    *,
    machine_id: str,
    machine_name: str,
    location_owner: Optional[str],
    daily_target_cfg: Optional[float],
    today_kwd: float,
    yesterday_kwd: float,
    db: Optional[Session] = None,
) -> Dict[str, Any]:
    tz = ZoneInfo("Asia/Kuwait")
    today = datetime.now(tz).date()
    yesterday = today - timedelta(days=1)
    segment = infer_owner_segment(machine_name, location_owner)
    week_target = week_revenue_target_kd_rounded(machine_name)
    daily_target = daily_target_cfg
    if daily_target is None or daily_target <= 0:
        daily_target = daily_target_kd_from_week(machine_name, location_owner)
    daily_target_f = float(daily_target) if daily_target and daily_target > 0 else None

    today_pct = _pct(today_kwd, daily_target_f) if daily_target_f else None
    yesterday_pct = _pct(yesterday_kwd, daily_target_f) if daily_target_f else None
    remaining_pct = None
    if daily_target_f and daily_target_f > 0:
        remaining_pct = round(max(0.0, (daily_target_f - today_kwd) / daily_target_f * 10000)) / 100

    week_start = _sunday_on_or_before(today)
    # Sun–Thu business week through today for WTD (today uses live elapsed sales from client)
    biz_days = target_business_days(segment)
    week_end_full = week_start + timedelta(days=biz_days - 1)
    days_elapsed: List[date] = []
    cur = week_start
    while cur <= today and cur <= week_end_full:
        days_elapsed.append(cur)
        cur += timedelta(days=1)

    wtd_actual = 0.0
    prior_wtd_actual = 0.0
    if db and machine_id:
        try:
            from alert_routes import _maybe_seed_vendon_revenue_cache

            seed_days = set(days_elapsed + [x - timedelta(days=7) for x in days_elapsed])
            for d in seed_days:
                _maybe_seed_vendon_revenue_cache(d)
        except Exception:
            logger.exception("alert_target wtd cache seed")
        days_before_today = [d for d in days_elapsed if d < today]
        wtd_actual = _sum_revenue(db, machine_id, days_before_today)
        if today in days_elapsed:
            wtd_actual += float(today_kwd or 0)
        prior_days: List[date] = [d - timedelta(days=7) for d in days_elapsed]
        prior_before_today = [d for d in prior_days if d < today - timedelta(days=7)]
        prior_wtd_actual = _sum_revenue(db, machine_id, prior_before_today)
        if today in days_elapsed:
            prior_wtd_actual += float(yesterday_kwd or 0)

    wtd_pct = _pct(wtd_actual, float(week_target)) if week_target else None
    prior_wtd_pct = _pct(prior_wtd_actual, float(week_target)) if week_target else None
    wtd_trend_pct = None
    if prior_wtd_pct is not None and wtd_pct is not None and prior_wtd_pct > 0:
        wtd_trend_pct = round(((wtd_pct - prior_wtd_pct) / prior_wtd_pct) * 10000) / 100

    owner_contact: Dict[str, Any] = {}
    if location_owner:
        try:
            from operator_contact_lib import resolve_operator_contact

            owner_contact = resolve_operator_contact(operator_name=location_owner, machine_id=machine_id)
        except Exception:
            pass

    return {
        "machineId": machine_id,
        "machineName": machine_name,
        "locationOwner": location_owner,
        "segment": segment,
        "dailyTargetKd": daily_target_f,
        "weekTargetKd": week_target,
        "todayKwd": today_kwd,
        "yesterdayKwd": yesterday_kwd,
        "todayPct": today_pct,
        "yesterdayPct": yesterday_pct,
        "remainingPct": remaining_pct,
        "wtdActualKd": round(wtd_actual, 3),
        "wtdTargetKd": week_target,
        "wtdPct": wtd_pct,
        "priorWtdActualKd": round(prior_wtd_actual, 3),
        "priorWtdPct": prior_wtd_pct,
        "wtdTrendPct": wtd_trend_pct,
        "wtdThroughDate": today.isoformat(),
        "ownerContact": owner_contact,
    }
