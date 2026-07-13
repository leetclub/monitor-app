"""Sales Acceleration (SX) for Alert — location KD + linked product cups."""
from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

_KWT = ZoneInfo("Asia/Kuwait")
_PRODUCT_CUPS_CACHE: Dict[str, Tuple[float, int]] = {}
_PRODUCT_CUPS_CACHE_SEC = 600


def _sum_kwd_in_range(
    rows_by_day: Dict[date, float],
    start_incl: date,
    end_excl: date,
) -> Optional[float]:
    """Sum KD for [start, end). Missing calendar days count as 0 when the machine has any cached days."""
    if not rows_by_day:
        return None
    total = 0.0
    d = start_incl
    while d < end_excl:
        total += float(rows_by_day.get(d) or 0)
        d += timedelta(days=1)
    return total


def growth_rate(current: Optional[float], previous: Optional[float]) -> Optional[float]:
    """(current - previous) / previous as a ratio (×100 for display %)."""
    if current is None or previous is None:
        return None
    try:
        cur = float(current)
        prev = float(previous)
    except (TypeError, ValueError):
        return None
    if prev == 0:
        if cur > 0:
            return 1.0
        if cur == 0:
            return 0.0
        return None
    return (cur - prev) / prev


DEFAULT_SX_PRODUCT = "Americano Max"


def sales_acceleration(
    current: Optional[float],
    previous: Optional[float],
    prior: Optional[float],
) -> Optional[float]:
    """SX = current growth rate − previous growth rate (ratio difference)."""
    g_cur = growth_rate(current, previous)
    g_prev = growth_rate(previous, prior)
    if g_cur is None or g_prev is None:
        return None
    return g_cur - g_prev


def third_period(
    a_lo: date,
    a_hi: date,
    b_lo: date,
    b_hi: date,
) -> Tuple[date, date]:
    """Period before B with the same length as B (half-open [lo, hi))."""
    span = max(1, (b_hi - b_lo).days)
    return b_lo - timedelta(days=span), b_lo


def pct_points(ratio: Optional[float]) -> Optional[float]:
    if ratio is None:
        return None
    return round(float(ratio) * 10000) / 100


def _product_cups_cached(
    machine_id: str,
    day: date,
    product_name: str,
    fetch_vends_fn: Callable[..., Tuple[List[Dict[str, Any]], Optional[str]]],
    *,
    until_local: Optional[datetime] = None,
) -> int:
    from promo_lib import product_cups_for_machine_day

    bucket = ""
    if until_local is not None:
        # 10-minute buckets so elapsed windows stay stable briefly
        bucket = until_local.astimezone(_KWT).strftime("%H%M")[:3] + "0"
    key = f"{machine_id}|{product_name.strip().lower()}|{day.isoformat()}|{bucket}"
    hit = _PRODUCT_CUPS_CACHE.get(key)
    if hit and (time.time() - hit[0]) < _PRODUCT_CUPS_CACHE_SEC:
        return hit[1]
    cups = product_cups_for_machine_day(
        machine_id,
        day.isoformat(),
        product_name,
        fetch_vends_fn,
        until_local=until_local,
    )
    _PRODUCT_CUPS_CACHE[key] = (time.time(), int(cups))
    return int(cups)


def sum_product_cups_in_range(
    machine_id: str,
    product_name: str,
    start_incl: date,
    end_excl: date,
    fetch_vends_fn: Callable[..., Tuple[List[Dict[str, Any]], Optional[str]]],
    *,
    today: date,
    now_local: datetime,
    elapsed_for_today: bool,
) -> Optional[int]:
    if not (machine_id and product_name and start_incl < end_excl):
        return None
    total = 0
    d = start_incl
    while d < end_excl:
        until = None
        if elapsed_for_today and d == today:
            until = now_local
        elif elapsed_for_today and d < today:
            # same clock on prior days
            until = now_local - timedelta(days=(today - d).days)
        total += _product_cups_cached(
            machine_id, d, product_name, fetch_vends_fn, until_local=until
        )
        d += timedelta(days=1)
    return total


def build_sx_row(
    *,
    machine_id: str,
    location_sales: Tuple[Optional[float], Optional[float], Optional[float]],
    product_sales: Tuple[Optional[float], Optional[float], Optional[float]],
    location_target_kd: Optional[float],
    product_target: Optional[float],
    product_name: Optional[str],
    label_cur: str,
    label_prev: str,
    label_prior: str,
) -> Dict[str, Any]:
    cur_l, prev_l, prior_l = location_sales
    cur_p, prev_p, prior_p = product_sales
    g_loc_cur = growth_rate(cur_l, prev_l)
    g_loc_prev = growth_rate(prev_l, prior_l)
    g_prod_cur = growth_rate(cur_p, prev_p)
    g_prod_prev = growth_rate(prev_p, prior_p)
    sx_loc = sales_acceleration(cur_l, prev_l, prior_l)
    sx_prod = sales_acceleration(cur_p, prev_p, prior_p)
    return {
        "machineId": machine_id,
        "productName": (product_name or "").strip() or None,
        "locationTargetKd": location_target_kd,
        "productTargetCups": product_target,
        "location": {
            "current": cur_l,
            "previous": prev_l,
            "prior": prior_l,
            "growthCurrentPct": pct_points(g_loc_cur),
            "growthPreviousPct": pct_points(g_loc_prev),
            "sxPct": pct_points(sx_loc),
            "unit": "kwd",
        },
        "product": {
            "current": cur_p,
            "previous": prev_p,
            "prior": prior_p,
            "growthCurrentPct": pct_points(g_prod_cur),
            "growthPreviousPct": pct_points(g_prod_prev),
            "sxPct": pct_points(sx_prod),
            "unit": "cups",
        },
        "labels": {
            "current": label_cur,
            "previous": label_prev,
            "prior": label_prior,
        },
    }


def compute_fleet_sx(
    *,
    machine_ids: List[str],
    machine_names: Dict[str, str],
    cfg_by_mid: Dict[str, Dict[str, Any]],
    kwd_by_mid_day: Dict[str, Dict[date, float]],
    a_lo: date,
    a_hi: date,
    b_lo: date,
    b_hi: date,
    label_a: str,
    label_b: str,
    today: date,
    now_local: datetime,
    elapsed_for_today: bool,
    fetch_vends_fn: Optional[Callable[..., Tuple[List[Dict[str, Any]], Optional[str]]]] = None,
    daily_target_fallback_fn: Optional[Callable[[str, Optional[str]], Optional[float]]] = None,
) -> Dict[str, Any]:
    c_lo, c_hi = third_period(a_lo, a_hi, b_lo, b_hi)
    label_c = "Prior"
    by_machine: Dict[str, Any] = {}

    product_jobs: List[Tuple[str, str]] = []
    for mid in machine_ids:
        cfg = cfg_by_mid.get(mid) or {}
        pname = (cfg.get("sx_product_name") or "").strip() or DEFAULT_SX_PRODUCT
        if pname and fetch_vends_fn:
            product_jobs.append((mid, pname))

    product_triples: Dict[str, Tuple[Optional[float], Optional[float], Optional[float]]] = {}
    if product_jobs and fetch_vends_fn:
        def _one(mid: str, pname: str) -> Tuple[str, Tuple[Optional[float], Optional[float], Optional[float]]]:
            cur = sum_product_cups_in_range(
                mid, pname, a_lo, a_hi, fetch_vends_fn,
                today=today, now_local=now_local, elapsed_for_today=elapsed_for_today,
            )
            prev = sum_product_cups_in_range(
                mid, pname, b_lo, b_hi, fetch_vends_fn,
                today=today, now_local=now_local, elapsed_for_today=elapsed_for_today,
            )
            prior = sum_product_cups_in_range(
                mid, pname, c_lo, c_hi, fetch_vends_fn,
                today=today, now_local=now_local, elapsed_for_today=elapsed_for_today,
            )
            return mid, (
                float(cur) if cur is not None else None,
                float(prev) if prev is not None else None,
                float(prior) if prior is not None else None,
            )

        with ThreadPoolExecutor(max_workers=min(6, max(1, len(product_jobs)))) as pool:
            futs = [pool.submit(_one, mid, pname) for mid, pname in product_jobs]
            for fut in as_completed(futs):
                try:
                    mid, triple = fut.result()
                    product_triples[mid] = triple
                except Exception:
                    logger.exception("SX product cups")

    for mid in machine_ids:
        cfg = cfg_by_mid.get(mid) or {}
        days = kwd_by_mid_day.get(mid) or {}
        loc_cur = _sum_kwd_in_range(days, a_lo, a_hi)
        loc_prev = _sum_kwd_in_range(days, b_lo, b_hi)
        loc_prior = _sum_kwd_in_range(days, c_lo, c_hi)
        loc_target = cfg.get("daily_sales_target")
        if loc_target is None and daily_target_fallback_fn:
            loc_target = daily_target_fallback_fn(machine_names.get(mid) or mid, cfg.get("location_owner"))
        pname = (cfg.get("sx_product_name") or "").strip() or DEFAULT_SX_PRODUCT
        prod_target = cfg.get("daily_product_target")
        prod_triple = product_triples.get(mid, (None, None, None))
        by_machine[mid] = build_sx_row(
            machine_id=mid,
            location_sales=(loc_cur, loc_prev, loc_prior),
            product_sales=prod_triple,
            location_target_kd=float(loc_target) if loc_target is not None else None,
            product_target=float(prod_target) if prod_target is not None else None,
            product_name=pname,
            label_cur=label_a,
            label_prev=label_b,
            label_prior=label_c,
        )

    return {
        "byMachineId": by_machine,
        "dateFrom": a_lo.isoformat(),
        "dateTo": (a_hi - timedelta(days=1)).isoformat(),
        "baselineFrom": b_lo.isoformat(),
        "baselineTo": (b_hi - timedelta(days=1)).isoformat(),
        "priorFrom": c_lo.isoformat(),
        "priorTo": (c_hi - timedelta(days=1)).isoformat(),
        "labelCurrent": label_a,
        "labelPrevious": label_b,
        "labelPrior": label_c,
        "source": "vendon+config",
    }
