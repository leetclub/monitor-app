"""Sales Acceleration (SX) for Alert — location KD + optional promoted product cups."""
from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
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
) -> Optional[float]:
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
    return float(total)


def _side_payload(
    sales: Tuple[Optional[float], Optional[float], Optional[float]],
    *,
    unit: str,
) -> Dict[str, Any]:
    cur, prev, prior = sales
    g_cur = growth_rate(cur, prev)
    g_prev = growth_rate(prev, prior)
    sx = sales_acceleration(cur, prev, prior)
    return {
        "current": cur,
        "previous": prev,
        "prior": prior,
        "growthCurrentPct": pct_points(g_cur),
        "growthPreviousPct": pct_points(g_prev),
        "sxPct": pct_points(sx),
        "unit": unit,
    }


def promoted_product_specs(cfg: Dict[str, Any]) -> List[Tuple[str, Optional[float]]]:
    """
    Ordered (productName, dailyTargetCups) from Admin promoted products.
    Falls back to legacy sx_product_name / daily_product_target, else default Americano Max.
    """
    raw = cfg.get("promoted_products") or cfg.get("promotedProducts") or []
    out: List[Tuple[str, Optional[float]]] = []
    seen = set()
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            name = str(
                item.get("productName") or item.get("product_name") or item.get("name") or ""
            ).strip()
            if not name:
                continue
            key = name.lower()
            if key in seen:
                continue
            seen.add(key)
            tgt_raw = item.get("dailyTarget", item.get("daily_target", item.get("target")))
            try:
                tgt = float(tgt_raw) if tgt_raw is not None and str(tgt_raw).strip() != "" else None
            except (TypeError, ValueError):
                tgt = None
            out.append((name, tgt))
    if out:
        return out[:12]
    pname = (cfg.get("sx_product_name") or "").strip()
    if not pname:
        return []
    ptgt = cfg.get("daily_product_target")
    try:
        cups = float(ptgt) if ptgt is not None else None
    except (TypeError, ValueError):
        cups = None
    return [(pname, cups)]


def build_sx_row(
    *,
    machine_id: str,
    location_sales: Tuple[Optional[float], Optional[float], Optional[float]],
    product_sales: Tuple[Optional[float], Optional[float], Optional[float]] = (None, None, None),
    location_target_kd: Optional[float],
    product_target: Optional[float] = None,
    product_name: Optional[str] = None,
    products: Optional[List[Dict[str, Any]]] = None,
    label_cur: str,
    label_prev: str,
    label_prior: str,
) -> Dict[str, Any]:
    loc = _side_payload(location_sales, unit="kwd")
    prod_list = list(products or [])
    # Legacy single `product` = primary / first when present (compat for older clients).
    primary = prod_list[0] if prod_list else None
    if primary is None and (product_name or any(x is not None for x in product_sales)):
        primary = {
            "productName": (product_name or "").strip() or None,
            "productTargetCups": product_target,
            **_side_payload(product_sales, unit="cups"),
        }
        prod_list = [primary]
    return {
        "machineId": machine_id,
        "productName": (primary or {}).get("productName") if primary else None,
        "locationTargetKd": location_target_kd,
        "productTargetCups": (primary or {}).get("productTargetCups") if primary else product_target,
        "location": loc,
        # Dashboard no longer uses Prod; kept null/empty so clients do not show a fake single-SKU box.
        "product": None,
        "products": prod_list,
        "productNames": [str(p.get("productName") or "").strip() for p in prod_list if p.get("productName")],
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
    include_products: bool = False,
) -> Dict[str, Any]:
    """
    Fleet SX for Red Flags / Overall.

    By default only location KD SX (dashboard cell). Pass include_products=True for a
    scoped machine detail popup — computes SX for every Admin promoted product.
    """
    c_lo, c_hi = third_period(a_lo, a_hi, b_lo, b_hi)
    label_c = "Prior"
    by_machine: Dict[str, Any] = {}

    # product_triples[(mid, pname_lower)] = (cur, prev, prior)
    product_triples: Dict[Tuple[str, str], Tuple[Optional[float], Optional[float], Optional[float]]] = {}
    product_jobs: List[Tuple[str, str]] = []

    if include_products and fetch_vends_fn:
        for mid in machine_ids:
            cfg = cfg_by_mid.get(mid) or {}
            for pname, _tgt in promoted_product_specs(cfg):
                if pname:
                    product_jobs.append((mid, pname))

        def _one(mid: str, pname: str) -> Tuple[str, str, Tuple[Optional[float], Optional[float], Optional[float]]]:
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
            return mid, pname, (
                float(cur) if cur is not None else None,
                float(prev) if prev is not None else None,
                float(prior) if prior is not None else None,
            )

        with ThreadPoolExecutor(max_workers=min(8, max(1, len(product_jobs)))) as pool:
            futs = [pool.submit(_one, mid, pname) for mid, pname in product_jobs]
            for fut in as_completed(futs):
                try:
                    mid, pname, triple = fut.result()
                    product_triples[(mid, pname.lower())] = triple
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

        products_out: List[Dict[str, Any]] = []
        if include_products:
            for pname, ptgt in promoted_product_specs(cfg):
                triple = product_triples.get((mid, pname.lower()), (None, None, None))
                side = _side_payload(triple, unit="cups")
                products_out.append(
                    {
                        "productName": pname,
                        "productTargetCups": float(ptgt) if ptgt is not None else None,
                        **side,
                    }
                )

        by_machine[mid] = build_sx_row(
            machine_id=mid,
            location_sales=(loc_cur, loc_prev, loc_prior),
            location_target_kd=float(loc_target) if loc_target is not None else None,
            products=products_out if include_products else [],
            label_cur=label_a,
            label_prev=label_b,
            label_prior=label_c,
        )

    return {
        "byMachineId": by_machine,
        "includeProducts": bool(include_products),
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
