"""Promo tab — product targets, calendar day goals, swipe instrument logging."""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

_KWT = ZoneInfo("Asia/Kuwait")
DEFAULT_PRODUCT = "Americano Max"


def kuwait_today() -> date:
    return datetime.now(_KWT).date()


def _product_matches(vend: Dict[str, Any], product_name: str) -> bool:
    from vendon_proxy_routes import _stats_vend_product_fields

    needle = (product_name or "").strip().lower()
    if not needle:
        return False
    pn, _ = _stats_vend_product_fields(vend)
    return needle in (pn or "").strip().lower()


def product_cups_for_machine_day(
    machine_id: str,
    day: str,
    product_name: str,
    fetch_vends_fn: Callable[..., Tuple[List[Dict[str, Any]], Optional[str]]],
    *,
    until_local: Optional[datetime] = None,
) -> int:
    """Count product vends for one Kuwait calendar day (optionally capped at until_local)."""
    from commercial_footfall_report import _local_day_bounds_utc

    mid = (machine_id or "").strip()
    if not mid:
        return 0
    start_utc, end_utc = _local_day_bounds_utc(day)
    if until_local is not None:
        # _local_day_bounds_utc returns naive UTC; strip tz so the compare is valid.
        aware = until_local if until_local.tzinfo is not None else until_local.replace(tzinfo=_KWT)
        cap = aware.astimezone(timezone.utc).replace(tzinfo=None)
        if cap < end_utc:
            end_utc = cap
    from_ts = int(start_utc.replace(tzinfo=timezone.utc).timestamp())
    to_ts = int(end_utc.replace(tzinfo=timezone.utc).timestamp())
    vends, err = fetch_vends_fn(from_ts, to_ts, mid)
    if err:
        logger.warning("promo product vends %s %s: %s", mid, day, err)
        return 0
    return sum(1 for v in vends or [] if isinstance(v, dict) and _product_matches(v, product_name))


def product_cups_partial_day_compare(
    machine_id: str,
    product_name: str,
    fetch_vends_fn: Callable[..., Tuple[List[Dict[str, Any]], Optional[str]]],
    *,
    now: Optional[datetime] = None,
) -> Tuple[int, int]:
    """Cups sold today until now vs same clock window yesterday (Kuwait)."""
    now_local = (now or datetime.now(_KWT)).astimezone(_KWT)
    today = now_local.date().isoformat()
    yesterday = (now_local.date() - timedelta(days=1)).isoformat()
    today_cups = product_cups_for_machine_day(
        machine_id, today, product_name, fetch_vends_fn, until_local=now_local
    )
    y_end = now_local - timedelta(days=1)
    yesterday_cups = product_cups_for_machine_day(
        machine_id, yesterday, product_name, fetch_vends_fn, until_local=y_end
    )
    return today_cups, yesterday_cups


def _load_owner_by_machine(db) -> Dict[str, str]:
    from sqlalchemy import text

    out: Dict[str, str] = {}
    rows = db.execute(text("SELECT vendon_user_id, machine_ids FROM target_area_owner")).mappings().all()
    for row in rows:
        uid = str(row.get("vendon_user_id") or "").strip()
        if not uid:
            continue
        for mid in row.get("machine_ids") or []:
            sm = str(mid).strip()
            if sm:
                out[sm] = uid
    return out


def resolve_machine_product_assignments(
    db,
    machine_ids: List[str],
    owner_by_machine: Dict[str, str],
) -> Dict[str, str]:
    """machine_id -> product_name (owner assignment overrides default)."""
    from sqlalchemy import text

    out: Dict[str, str] = {mid: DEFAULT_PRODUCT for mid in machine_ids}
    if not machine_ids:
        return out
    rows = db.execute(
        text(
            """
            SELECT scope_type, machine_id, vendon_user_id, product_name
            FROM target_promo_assignment
            """
        )
    ).mappings().all()
    owner_products: Dict[str, str] = {}
    machine_products: Dict[str, str] = {}
    for row in rows:
        pname = str(row.get("product_name") or DEFAULT_PRODUCT).strip() or DEFAULT_PRODUCT
        if row.get("scope_type") == "owner" and row.get("vendon_user_id"):
            owner_products[str(row["vendon_user_id"])] = pname
        elif row.get("scope_type") == "machine" and row.get("machine_id"):
            machine_products[str(row["machine_id"])] = pname
    for mid in machine_ids:
        if mid in machine_products:
            out[mid] = machine_products[mid]
            continue
        owner = owner_by_machine.get(mid)
        if owner and owner in owner_products:
            out[mid] = owner_products[owner]
    return out


def fetch_promo_performance(
    db,
    machines: List[Dict[str, Any]],
    start_day: str,
    end_day: str,
    fetch_vends_fn: Callable[..., Tuple[List[Dict[str, Any]], Optional[str]]],
    *,
    machine_ids: Optional[Set[str]] = None,
    owner_by_machine: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    from sqlalchemy import text

    ids: List[str] = []
    names: Dict[str, str] = {}
    owners = dict(owner_by_machine or {})
    if not owners:
        owners = _load_owner_by_machine(db)
    for m in machines:
        mid = str(m.get("id") or m.get("machineId") or "").strip()
        if not mid:
            continue
        if machine_ids is not None and mid not in machine_ids:
            continue
        ids.append(mid)
        names[mid] = str(m.get("name") or mid)
        owners.setdefault(mid, "")

    products = resolve_machine_product_assignments(db, ids, owners)

    target_rows = db.execute(
        text(
            """
            SELECT machine_id, target_date::text AS target_date, target_cups
            FROM target_promo_day_target
            WHERE machine_id = ANY(:ids)
              AND target_date >= CAST(:start_day AS date)
              AND target_date <= CAST(:end_day AS date)
            ORDER BY target_date
            """
        ),
        {"ids": ids, "start_day": start_day, "end_day": end_day},
    ).mappings().all()

    targets_by_machine: Dict[str, Dict[str, int]] = {mid: {} for mid in ids}
    for row in target_rows:
        mid = str(row["machine_id"])
        targets_by_machine.setdefault(mid, {})[str(row["target_date"])] = int(row["target_cups"] or 0)

    start = datetime.strptime(start_day, "%Y-%m-%d").date()
    end = datetime.strptime(end_day, "%Y-%m-%d").date()
    days: List[str] = []
    d = start
    while d <= end:
        days.append(d.isoformat())
        d += timedelta(days=1)

    achieved_by_machine: Dict[str, Dict[str, int]] = {mid: {} for mid in ids}

    def _one(mid: str) -> Tuple[str, Dict[str, int]]:
        product = products.get(mid, DEFAULT_PRODUCT)
        day_counts: Dict[str, int] = {}
        for day in days:
            day_counts[day] = product_cups_for_machine_day(mid, day, product, fetch_vends_fn)
        return mid, day_counts

    workers = max(1, min(8, len(ids)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_one, mid): mid for mid in ids}
        for fut in as_completed(futures):
            mid = futures[fut]
            try:
                key, counts = fut.result()
                achieved_by_machine[key] = counts
            except Exception as ex:
                logger.warning("promo performance machine=%s: %s", mid, ex)

    locations: List[Dict[str, Any]] = []
    for mid in ids:
        day_rows = []
        total_target = 0
        total_achieved = 0
        for day in days:
            target = int(targets_by_machine.get(mid, {}).get(day, 0))
            achieved = int(achieved_by_machine.get(mid, {}).get(day, 0))
            total_target += target
            total_achieved += achieved
            pct = round(achieved / target * 100.0, 1) if target > 0 else None
            day_rows.append(
                {
                    "date": day,
                    "targetCups": target,
                    "achievedCups": achieved,
                    "remainingCups": max(0, target - achieved),
                    "pct": pct,
                }
            )
        period_pct = round(total_achieved / total_target * 100.0, 1) if total_target > 0 else None
        locations.append(
            {
                "machineId": mid,
                "machineName": names.get(mid, mid),
                "productName": products.get(mid, DEFAULT_PRODUCT),
                "days": day_rows,
                "totalTargetCups": total_target,
                "totalAchievedCups": total_achieved,
                "periodPct": period_pct,
            }
        )

    return {
        "startDate": start_day,
        "endDate": end_day,
        "defaultProduct": DEFAULT_PRODUCT,
        "locations": locations,
    }
