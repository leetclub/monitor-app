"""
Commercial footfall vs sales performance report — 5-day average 24h profile per location.

Scope: all People Count locations (excluding KU), all MOH Vendon machines, Oxygen + Sultan Hamra.
MOH machines without People Analytics inherit footfall/potential from a paired source (see config).
"""
from __future__ import annotations

import json
import logging
import os
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set, Tuple
from zoneinfo import ZoneInfo

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import PeopleAnalyticsRecord

logger = logging.getLogger(__name__)

TZ_KUWAIT = "Asia/Kuwait"
TZ = ZoneInfo(TZ_KUWAIT)

PRIMARY_BUSINESS_DAYS = [
    "2025-06-08",
    "2025-06-09",
    "2025-06-10",
    "2025-06-11",
    "2025-06-12",
]
JUN_15_BUSINESS_DAYS = [
    "2025-06-15",
    "2025-06-16",
    "2025-06-17",
    "2025-06-18",
    "2025-06-19",
]
# Target / Alert Footfall KU reference week (must stay in warm wait list).
JUL_06_BUSINESS_DAYS = [
    "2025-07-06",
    "2025-07-07",
    "2025-07-08",
    "2025-07-09",
    "2025-07-10",
]
FALLBACK_BUSINESS_DAYS = [
    "2026-05-10",
    "2026-05-11",
    "2026-05-12",
    "2026-05-13",
    "2026-05-14",
]

# MOH locations on Vendon (user list) — always include when present in fleet
MOH_VENDON_NAME_FRAGMENTS = [
    "adan casualty",
    "adan hall",
    "adan hospital",
    "adan main gate",
    "adan maternity",
    "amiri",
    "farwaniya",
    "jaber hospital",
    "jahra hospital",
    "jahra women",
    "maternity hospital",
    "moh main",
    "mubarak al kabir",
    "razi hospital",
    "zain hospital",
]

BENCHMARK_CONVERSION_PCT = float(os.environ.get("COMMERCIAL_BENCHMARK_CONVERSION_PCT", "6.2"))

# Bump when payload shape / postprocess logic changes (stale DB rows are re-finalized on read).
REPORT_PAYLOAD_VERSION = 27

# Hospital / retail traffic shape when only daily footfall exists (sums to 1.0)
_HOURLY_WEIGHT_RAW = [
    0.01, 0.01, 0.01, 0.01, 0.02, 0.03, 0.04, 0.07,
    0.10, 0.09, 0.06, 0.07, 0.08, 0.09, 0.06, 0.05,
    0.06, 0.08, 0.09, 0.07, 0.05, 0.04, 0.03, 0.02,
]
_HW_SUM = sum(_HOURLY_WEIGHT_RAW)
HOURLY_WEIGHTS = [w / _HW_SUM for w in _HOURLY_WEIGHT_RAW]


def _norm_name(s: str) -> str:
    return " ".join("".join(c.lower() if c.isalnum() else " " for c in (s or "")).split())


def _load_moh_mirror_map() -> Dict[str, str]:
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config", "commercial_moh_mirror_map.json")
    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
        if isinstance(raw, dict):
            return {_norm_name(k): _norm_name(v) for k, v in raw.items() if not str(k).startswith("_")}
    except Exception as ex:
        logger.warning("commercial_moh_mirror_map.json: %s", ex)
    return {}


def _is_ku_location(machine_name: str, owner_tag: Optional[str]) -> bool:
    tag = (owner_tag or "").strip().upper()
    if tag == "KU":
        return True
    n = _norm_name(machine_name)
    if re.search(r"\bku\b", n) or "kuwait university" in n:
        return True
    return False


def _is_moh_machine(machine_name: str, owner_tag: Optional[str]) -> bool:
    tag = (owner_tag or "").strip().upper()
    if tag == "MOH":
        return True
    n = _norm_name(machine_name)
    return any(frag in n for frag in MOH_VENDON_NAME_FRAGMENTS)


def _owner_segment(machine_name: str, owner_tag: Optional[str]) -> str:
    if _is_ku_location(machine_name, owner_tag):
        return "KU"
    if _is_moh_machine(machine_name, owner_tag):
        return "MOH"
    tag = (owner_tag or "").strip().upper()
    if tag in ("O2", "OXYGEN"):
        return "O2"
    n = _norm_name(machine_name)
    if "oxygen" in n or "sultan" in n or re.search(r"\bo2\b", n):
        return "O2"
    return "OTHER"


def _in_commercial_scope(machine_name: str, owner_tag: Optional[str]) -> bool:
    """People Count scope: all non-KU sites with footfall mapping, MOH fleet, Oxygen, Sultan Hamra."""
    if _is_ku_location(machine_name, owner_tag):
        return False
    if _is_moh_machine(machine_name, owner_tag):
        return True
    tag = (owner_tag or "").strip().upper()
    if tag in ("O2", "MOH", "OXYGEN"):
        return True
    n = _norm_name(machine_name)
    if "oxygen" in n or "sultan" in n:
        return True
    if re.search(r"\bo2\b", n):
        return True
    return False


def _vh_total_cups(vh: Dict[int, List[Dict[str, float]]]) -> float:
    return sum(
        vh.get(h, [{"cups": 0.0, "revenue": 0.0}])[di]["cups"]
        for h in range(24)
        for di in range(len(vh.get(0, [])))
    )


def _vh_total_revenue(vh: Dict[int, List[Dict[str, float]]]) -> float:
    return sum(
        vh.get(h, [{"cups": 0.0, "revenue": 0.0}])[di]["revenue"]
        for h in range(24)
        for di in range(len(vh.get(0, [])))
    )


def _get_cached_vh(
    machine_id: str,
    days: List[str],
    fetch_vends_fn,
    vend_cache: Dict[Tuple[str, Tuple[str, ...]], Dict[int, List[Dict[str, float]]]],
) -> Dict[int, List[Dict[str, float]]]:
    key = (machine_id, tuple(days))
    if key not in vend_cache:
        vend_cache[key] = _fetch_hourly_vends(machine_id, list(days), fetch_vends_fn)
    return vend_cache[key]


def _machine_has_sales(machine_id: str, days: List[str], fetch_vends_fn) -> bool:
    """Legacy probe — prefer _get_cached_vh + _vh_total_cups during report builds."""
    for day in days:
        start_utc, end_utc = _local_day_bounds_utc(day)
        from_ts = int(start_utc.replace(tzinfo=timezone.utc).timestamp())
        to_ts = int(end_utc.replace(tzinfo=timezone.utc).timestamp())
        vends, _ = fetch_vends_fn(from_ts, to_ts, machine_id)
        if vends:
            return True
    return False


def _day_window(anchor_iso: str, n_days: int, day_offset: int = 0) -> List[str]:
    start = datetime.strptime(anchor_iso, "%Y-%m-%d").replace(tzinfo=TZ) + timedelta(days=day_offset)
    return [(start + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(n_days)]


def _nearest_sales_window(
    machine_id: str,
    anchor_first: str,
    n_days: int,
    fetch_vends_fn,
    vend_cache: Optional[Dict[Tuple[str, Tuple[str, ...]], Dict[int, List[Dict[str, float]]]]] = None,
    max_shift_days: int = 84,
) -> Optional[List[str]]:
    """First n-day window with Vendon cup sales, preferring dates closest to anchor_first."""
    best: Optional[List[str]] = None
    best_abs = max_shift_days + 1
    cache = vend_cache if vend_cache is not None else {}
    # Coarse weekly steps, then fill gaps — keeps warm job fast vs per-day scan.
    shifts = [0]
    for w in range(7, max_shift_days + 1, 7):
        shifts.extend([w, -w])
    for offset in shifts:
        if abs(offset) >= best_abs:
            continue
        window = _day_window(anchor_first, n_days, offset)
        vh = (
            _get_cached_vh(machine_id, window, fetch_vends_fn, cache)
            if vend_cache is not None
            else _fetch_hourly_vends(machine_id, window, fetch_vends_fn)
        )
        if _vh_total_cups(vh) > 0:
            best = window
            best_abs = abs(offset)
            if offset == 0:
                return best
    return best


def _sales_display_meta(
    sales_kind: str, sales_days: List[str], requested_days: List[str]
) -> Optional[Dict[str, Any]]:
    if sales_kind == "actual":
        return {
            "kind": "actual",
            "label": f"Actual Vendon sales ({sales_days[0]}–{sales_days[-1]})",
            "shortLabel": "Actual sales",
            "color": "#1e6fd6",
        }
    if sales_kind == "proxy_benchmark":
        return {
            "kind": "proxy_benchmark",
            "label": (
                f"Proxy sales — new/no history for {requested_days[0]}–{requested_days[-1]}; "
                f"using benchmark {sales_days[0]}–{sales_days[-1]}"
            ),
            "shortLabel": f"Proxy · {sales_days[0]}–{sales_days[-1]}",
            "color": "#b45309",
        }
    if sales_kind == "proxy_nearest":
        return {
            "kind": "proxy_nearest",
            "label": (
                f"Proxy sales — no data for requested week or May benchmark; "
                f"nearest week with sales: {sales_days[0]}–{sales_days[-1]}"
            ),
            "shortLabel": f"Nearest · {sales_days[0]}–{sales_days[-1]}",
            "color": "#7c3aed",
        }
    if sales_kind == "proxy_footfall_week":
        return {
            "kind": "proxy_footfall_week",
            "label": (
                f"Sales aligned to camera week {sales_days[0]}–{sales_days[-1]} "
                f"(same week as footfall)"
            ),
            "shortLabel": f"Aligned · {sales_days[0]}–{sales_days[-1]}",
            "color": "#0d9488",
        }
    return None


def _apply_sales_kind_to_daily(
    daily: Dict[str, Any], sales_kind: str, requested_days: List[str]
) -> None:
    daily["salesDataKind"] = sales_kind
    daily["requestedSalesPeriodDates"] = list(requested_days)
    daily["salesIsActual"] = sales_kind == "actual"
    daily["periodsAligned"] = (
        list(daily.get("salesPeriodDates") or [])
        == list(daily.get("footfallPeriodDates") or [])
    )
    if sales_kind != "actual" and sales_kind != "none":
        extra = " Cups/revenue are from a proxy Vendon week (not the selected sales period)."
        daily["conversionNote"] = (daily.get("conversionNote") or "").strip() + extra


def _local_day_bounds_utc(day_iso: str) -> Tuple[datetime, datetime]:
    start_local = datetime.strptime(day_iso, "%Y-%m-%d").replace(tzinfo=TZ)
    end_local = start_local.replace(hour=23, minute=59, second=59, microsecond=0)
    return (
        start_local.astimezone(timezone.utc).replace(tzinfo=None),
        end_local.astimezone(timezone.utc).replace(tzinfo=None),
    )


def _traffic_totals_for_uidds(
    session: Session, uidds: List[str], days: List[str]
) -> Dict[str, Any]:
    """Sum in / out / net (people_in − people_out) for occupancy-style indicators."""
    if not uidds or not days:
        return {
            "totalIn": 0.0,
            "totalOut": 0.0,
            "totalNet": 0.0,
            "avgDailyNet": 0.0,
            "netTrafficNote": None,
        }
    start_utc, _ = _local_day_bounds_utc(days[0])
    _, end_utc = _local_day_bounds_utc(days[-1])
    tin = (
        session.query(func.sum(PeopleAnalyticsRecord.people_in))
        .filter(PeopleAnalyticsRecord.uidd.in_(uidds))
        .filter(PeopleAnalyticsRecord.first_timestamp >= start_utc)
        .filter(PeopleAnalyticsRecord.first_timestamp <= end_utc)
        .scalar()
    )
    tout = (
        session.query(func.sum(PeopleAnalyticsRecord.people_out))
        .filter(PeopleAnalyticsRecord.uidd.in_(uidds))
        .filter(PeopleAnalyticsRecord.first_timestamp >= start_utc)
        .filter(PeopleAnalyticsRecord.first_timestamp <= end_utc)
        .scalar()
    )
    tnet = (
        session.query(func.sum(PeopleAnalyticsRecord.net_traffic))
        .filter(PeopleAnalyticsRecord.uidd.in_(uidds))
        .filter(PeopleAnalyticsRecord.first_timestamp >= start_utc)
        .filter(PeopleAnalyticsRecord.first_timestamp <= end_utc)
        .scalar()
    )
    total_in = float(tin or 0)
    total_out = float(tout or 0)
    total_net = float(tnet or 0) if tnet is not None else (total_in - total_out)
    nf = len(days)
    return {
        "totalIn": round(total_in, 1),
        "totalOut": round(total_out, 1),
        "totalNet": round(total_net, 1),
        "avgDailyNet": round(total_net / nf, 1) if nf else 0.0,
        "netTrafficNote": None,
    }


def _footfall_display_meta(
    kind: str, source_label: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    if kind == "actual":
        return {
            "kind": "actual",
            "label": "Actual camera detections (people_in)",
            "shortLabel": "Actual detections",
            "color": "#5eb8e8",
        }
    if kind == "mirrored":
        src = source_label or "peer site"
        return {
            "kind": "mirrored",
            "label": f"Footfall mirrored from {src}",
            "shortLabel": f"Mirrored · {src}",
            "color": "#5eb8e8",
        }
    if kind == "projected":
        src = source_label or "similar site in segment"
        return {
            "kind": "projected",
            "label": f"Footfall mirrored from {src}",
            "shortLabel": f"Mirrored · {src}",
            "color": "#5eb8e8",
        }
    return None


def _kuwait_hour_from_ts(ts: datetime) -> int:
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(TZ).hour


def _hourly_footfall_by_uidds(
    session: Session,
    uidds: List[str],
    days: List[str],
    vl_cache: Optional[Dict[str, Dict[str, Dict[int, float]]]] = None,
) -> Tuple[Dict[int, List[float]], Dict[str, Any]]:
    """
    Per-hour lists of daily totals (one value per business day) for averaging.
    Falls back: hour → minute (60000) → daily (date) weighted shape.
    """
    meta: Dict[str, Any] = {
        "uiddCount": len(uidds),
        "granularity": "none",
        "source": "none",
        "dbRows": 0,
    }
    if not uidds:
        return {h: [0.0] * len(days) for h in range(24)}, meta

    per_hour_days: Dict[int, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    total_rows = 0

    for interval in ("hour", "60000"):
        per_hour_days = defaultdict(lambda: defaultdict(float))
        total_rows = 0
        for day in days:
            start_utc, end_utc = _local_day_bounds_utc(day)
            rows = (
                session.query(PeopleAnalyticsRecord)
                .filter(PeopleAnalyticsRecord.uidd.in_(uidds))
                .filter(PeopleAnalyticsRecord.interval_type == interval)
                .filter(PeopleAnalyticsRecord.first_timestamp >= start_utc)
                .filter(PeopleAnalyticsRecord.first_timestamp <= end_utc)
                .all()
            )
            total_rows += len(rows)
            for r in rows:
                h = _kuwait_hour_from_ts(r.first_timestamp)
                per_hour_days[h][day] += float(r.people_in or 0)
        if total_rows > 0 and sum(per_hour_days[h].get(d, 0) for h in range(24) for d in days) > 0:
            meta["granularity"] = "hour" if interval == "hour" else "minute"
            meta["source"] = interval
            meta["dbRows"] = total_rows
            break

    if meta["granularity"] == "none":
        daily_by_day: Dict[str, float] = {}
        for day in days:
            start_utc, end_utc = _local_day_bounds_utc(day)
            row = (
                session.query(func.sum(PeopleAnalyticsRecord.people_in))
                .filter(PeopleAnalyticsRecord.uidd.in_(uidds))
                .filter(PeopleAnalyticsRecord.interval_type == "date")
                .filter(PeopleAnalyticsRecord.first_timestamp >= start_utc)
                .filter(PeopleAnalyticsRecord.first_timestamp <= end_utc)
                .scalar()
            )
            daily_by_day[day] = float(row or 0)
            if row:
                total_rows += 1
        if sum(daily_by_day.values()) > 0:
            meta["granularity"] = "estimated_hourly"
            meta["source"] = "date_weighted"
            meta["dbRows"] = total_rows
            per_hour_days = defaultdict(lambda: defaultdict(float))
            for day in days:
                daily_total = daily_by_day.get(day, 0.0)
                if daily_total <= 0:
                    continue
                for h in range(24):
                    per_hour_days[h][day] = daily_total * HOURLY_WEIGHTS[h]

    out: Dict[int, List[float]] = {}
    for h in range(24):
        out[h] = [per_hour_days[h].get(d, 0.0) for d in days]
    total = sum(sum(out[h]) for h in range(24))
    if total <= 0 and uidds:
        if vl_cache:
            vl_out, vl_meta = _hourly_footfall_from_videoloft_cache(uidds, days, vl_cache)
            if sum(sum(vl_out[h]) for h in range(24)) > 0:
                return vl_out, vl_meta
        vl_out, vl_meta = _hourly_footfall_from_videoloft(uidds, days)
        if sum(sum(vl_out[h]) for h in range(24)) > 0:
            return vl_out, vl_meta
    return out, meta


def _db_has_footfall_in_period(session: Session, days: List[str]) -> bool:
    if not days:
        return False
    start_utc, _ = _local_day_bounds_utc(days[0])
    _, end_utc = _local_day_bounds_utc(days[-1])
    total = (
        session.query(func.sum(PeopleAnalyticsRecord.people_in))
        .filter(PeopleAnalyticsRecord.first_timestamp >= start_utc)
        .filter(PeopleAnalyticsRecord.first_timestamp <= end_utc)
        .scalar()
    )
    return float(total or 0) > 0


def _db_has_footfall_for_uidds(session: Session, uidds: List[str], days: List[str]) -> bool:
    if not uidds or not days:
        return False
    start_utc, _ = _local_day_bounds_utc(days[0])
    _, end_utc = _local_day_bounds_utc(days[-1])
    total = (
        session.query(func.sum(PeopleAnalyticsRecord.people_in))
        .filter(PeopleAnalyticsRecord.uidd.in_(uidds))
        .filter(PeopleAnalyticsRecord.first_timestamp >= start_utc)
        .filter(PeopleAnalyticsRecord.first_timestamp <= end_utc)
        .scalar()
    )
    return float(total or 0) > 0


def _last_footfall_days_for_uidds(session: Session, uidds: List[str], count: int = 5) -> List[str]:
    """Most recent business days with People Count for these cameras (fleet-wide DB sync window)."""
    if not uidds or count <= 0:
        return []
    rows = (
        session.query(func.date(PeopleAnalyticsRecord.first_timestamp).label("d"))
        .filter(PeopleAnalyticsRecord.uidd.in_(uidds))
        .filter(PeopleAnalyticsRecord.interval_type.in_(("hour", "60000", "date")))
        .group_by(func.date(PeopleAnalyticsRecord.first_timestamp))
        .having(func.sum(PeopleAnalyticsRecord.people_in) > 0)
        .order_by(func.date(PeopleAnalyticsRecord.first_timestamp).desc())
        .limit(count)
        .all()
    )
    out: List[str] = []
    for r in rows:
        d = r.d
        if hasattr(d, "isoformat"):
            out.append(d.isoformat())
        else:
            out.append(str(d)[:10])
    return sorted(out)


def _collect_prefetch_uidds(
    machines: List[Dict[str, Any]],
    resolve_uidds_fn,
    days: List[str],
    name_camera_map: Optional[Dict[str, List[str]]] = None,
    cameras: Optional[List[Dict[str, Any]]] = None,
    cmap: Optional[Dict[str, Any]] = None,
) -> Set[str]:
    """Gather every camera uidd we might need (per-machine resolve + commercial name map)."""
    from alert_routes import _uidds_from_mapping_entry

    all_uidds: Set[str] = set()
    for m in machines:
        mid = str(m.get("id") or "")
        mname = str(m.get("name") or "")
        owner = m.get("location_owner") or m.get("owner_tag")
        if not mid or _is_ku_location(mname, owner):
            continue
        if not _in_commercial_scope(mname, owner) and not _is_moh_machine(mname, owner):
            continue
        uids, _ = resolve_uidds_fn(mid, mname, days)
        all_uidds.update(uids)
    if name_camera_map and cameras:
        seen_frags: Set[str] = set()
        for frags in name_camera_map.values():
            key = "|".join(sorted(frags))
            if key in seen_frags:
                continue
            seen_frags.add(key)
            uids = _uidds_from_mapping_entry(cameras, {"cameraNames": frags})
            all_uidds.update(uids)
        if cmap:
            for mid, raw in cmap.items():
                if str(mid).startswith("_"):
                    continue
                uids = _uidds_from_mapping_entry(cameras, raw if isinstance(raw, dict) else {"cameraNames": [raw]})
                all_uidds.update(uids)
    return all_uidds


def _prefetch_videoloft_footfall_cache(
    machines: List[Dict[str, Any]],
    resolve_uidds_fn,
    days: List[str],
    name_camera_map: Optional[Dict[str, List[str]]] = None,
    cameras: Optional[List[Dict[str, Any]]] = None,
    cmap: Optional[Dict[str, Any]] = None,
) -> Dict[str, Dict[str, Dict[int, float]]]:
    """
    One Videoloft call per day for all mapped cameras (day -> uidd -> hour -> people_in).
    """
    cache: Dict[str, Dict[str, Dict[int, float]]] = {d: defaultdict(lambda: defaultdict(float)) for d in days}
    all_uidds = _collect_prefetch_uidds(machines, resolve_uidds_fn, days, name_camera_map, cameras, cmap)
    if not all_uidds:
        return cache
    try:
        from sync_service import VideoloftClient

        cli = VideoloftClient()
        if not cli.authenticate():
            logger.warning("Videoloft prefetch: auth failed")
            return cache
        uid_list = list(all_uidds)
        for day in days:
            start_utc, end_utc = _local_day_bounds_utc(day)
            start_ms = int(start_utc.replace(tzinfo=timezone.utc).timestamp() * 1000)
            end_ms = int(end_utc.replace(tzinfo=timezone.utc).timestamp() * 1000)
            data = cli.fetch_people_analytics(uid_list, start_ms, end_ms, interval="hour", timezone=TZ_KUWAIT)
            if not isinstance(data, list):
                continue
            for rec in data:
                uid_str = str(rec.get("uid") or "")
                dev_str = str(rec.get("deviceId") or "")
                uidd = f"{uid_str}.{dev_str}" if uid_str and dev_str else (uid_str or dev_str)
                if not uidd or uidd not in all_uidds:
                    # also match if record uidd is in our list
                    if rec.get("uidd"):
                        uidd = str(rec.get("uidd"))
                    if uidd not in all_uidds:
                        continue
                first_ts = rec.get("firstTimestamp") or 0
                try:
                    ts_i = int(first_ts)
                except (TypeError, ValueError):
                    continue
                if ts_i < 1_000_000_000_000:
                    ts_i *= 1000
                dt = datetime.utcfromtimestamp(ts_i / 1000.0).replace(tzinfo=timezone.utc).astimezone(TZ)
                if dt.strftime("%Y-%m-%d") != day:
                    continue
                cache[day][uidd][dt.hour] += float(rec.get("in") or 0)
        logger.info("Videoloft prefetch: %s uidds, %s days", len(all_uidds), len(days))
    except Exception as ex:
        logger.warning("Videoloft prefetch failed: %s", ex)
    return cache


def _hourly_footfall_from_videoloft_cache(
    uidds: List[str],
    days: List[str],
    vl_cache: Dict[str, Dict[str, Dict[int, float]]],
) -> Tuple[Dict[int, List[float]], Dict[str, Any]]:
    meta: Dict[str, Any] = {"granularity": "hour", "source": "videoloft_prefetch", "uiddCount": len(uidds)}
    per_hour_days: Dict[int, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for day in days:
        day_c = vl_cache.get(day) or {}
        for h in range(24):
            for uid in uidds:
                per_hour_days[h][day] += float(day_c.get(uid, {}).get(h, 0.0))
    out: Dict[int, List[float]] = {h: [per_hour_days[h].get(d, 0.0) for d in days] for h in range(24)}
    return out, meta


def _hourly_footfall_from_videoloft(
    uidds: List[str], days: List[str]
) -> Tuple[Dict[int, List[float]], Dict[str, Any]]:
    """Live Videoloft fetch when DB has no rows for the requested period."""
    meta: Dict[str, Any] = {"granularity": "hour", "source": "videoloft_live", "uiddCount": len(uidds)}
    per_hour_days: Dict[int, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    try:
        from sync_service import VideoloftClient

        cli = VideoloftClient()
        if not cli.authenticate():
            meta["source"] = "videoloft_auth_failed"
            return {h: [0.0] * len(days) for h in range(24)}, meta
        rows = 0
        for day in days:
            start_utc, end_utc = _local_day_bounds_utc(day)
            start_ms = int(start_utc.replace(tzinfo=timezone.utc).timestamp() * 1000)
            end_ms = int(end_utc.replace(tzinfo=timezone.utc).timestamp() * 1000)
            data = cli.fetch_people_analytics(uidds, start_ms, end_ms, interval="hour", timezone=TZ_KUWAIT)
            if not isinstance(data, list):
                continue
            for rec in data:
                rows += 1
                first_ts = rec.get("firstTimestamp") or rec.get("first_timestamp") or 0
                try:
                    ts_i = int(first_ts)
                except (TypeError, ValueError):
                    continue
                if ts_i < 1_000_000_000_000:
                    ts_i *= 1000
                dt = datetime.utcfromtimestamp(ts_i / 1000.0).replace(tzinfo=timezone.utc).astimezone(TZ)
                if dt.strftime("%Y-%m-%d") != day:
                    continue
                h = dt.hour
                per_hour_days[h][day] += float(rec.get("in") or 0)
        meta["dbRows"] = rows
        out: Dict[int, List[float]] = {}
        for h in range(24):
            out[h] = [per_hour_days[h].get(d, 0.0) for d in days]
        return out, meta
    except Exception as ex:
        logger.warning("Videoloft live footfall failed: %s", ex)
        meta["source"] = "videoloft_error"
        meta["error"] = str(ex)[:200]
        return {h: [0.0] * len(days) for h in range(24)}, meta


def _vend_day_bucket() -> Dict[str, float]:
    return {
        "cups": 0.0,
        "revenue": 0.0,
        "cupsCashless": 0.0,
        "cupsWeb": 0.0,
        "revenueCashless": 0.0,
        "revenueWeb": 0.0,
    }


try:
    from vendon_proxy_routes import _is_web_cashless_vend
except ImportError:

    def _is_web_cashless_vend(vend: Dict[str, Any]) -> bool:  # type: ignore[misc]
        return False


def _fetch_hourly_vends(
    machine_id: str, days: List[str], fetch_vends_fn
) -> Dict[int, List[Dict[str, float]]]:
    """
    Returns hour -> list of {cups, revenue, cupsCashless, cupsWeb, revenueWeb} per day.
    fetch_vends_fn(from_ts, to_ts, machine_id) -> (vends_list, error)
    """
    per_hour_days: Dict[int, Dict[str, Dict[str, float]]] = defaultdict(
        lambda: defaultdict(_vend_day_bucket)
    )
    for day in days:
        start_utc, end_utc = _local_day_bounds_utc(day)
        from_ts = int(start_utc.replace(tzinfo=timezone.utc).timestamp())
        to_ts = int(end_utc.replace(tzinfo=timezone.utc).timestamp())
        vends, err = fetch_vends_fn(from_ts, to_ts, machine_id)
        if err:
            logger.warning("vends %s %s: %s", machine_id, day, err)
            continue
        for v in vends or []:
            try:
                ts_raw = v.get("datetime") or v.get("timestamp") or 0
                ts_i = int(ts_raw)
                if ts_i <= 0:
                    continue
                if ts_i < 1_000_000_000_000:
                    ts_i *= 1000
                dt = datetime.fromtimestamp(ts_i / 1000.0, tz=timezone.utc).astimezone(TZ)
                if dt.strftime("%Y-%m-%d") != day:
                    continue
                h = dt.hour
                price = float(v.get("price") or 0)
                per_hour_days[h][day]["cups"] += 1
                per_hour_days[h][day]["revenue"] += price
                if _is_web_cashless_vend(v):
                    per_hour_days[h][day]["cupsWeb"] += 1
                    per_hour_days[h][day]["revenueWeb"] += price
                else:
                    per_hour_days[h][day]["cupsCashless"] += 1
                    per_hour_days[h][day]["revenueCashless"] += price
            except Exception:
                continue
    out: Dict[int, List[Dict[str, float]]] = {}
    for h in range(24):
        out[h] = [per_hour_days[h].get(d, _vend_day_bucket()) for d in days]
    return out


def _sum_vends_day(vh: Dict[int, List[Dict[str, float]]], day_index: int = 0) -> Dict[str, float]:
    cups = cashless = web = revenue = revenue_cashless = 0.0
    for h in range(24):
        buckets = vh.get(h, [_vend_day_bucket()])
        if day_index >= len(buckets):
            continue
        bucket = buckets[day_index]
        cups += float(bucket.get("cups") or 0)
        cashless += float(bucket.get("cupsCashless") or bucket.get("cups") or 0)
        web += float(bucket.get("cupsWeb") or 0)
        revenue += float(bucket.get("revenue") or 0)
        revenue_cashless += float(bucket.get("revenueCashless") or 0)
    if revenue_cashless <= 0 and revenue > 0:
        revenue_cashless = max(0.0, revenue)
    return {
        "cups": round(cups, 1),
        "cupsCashless": round(cashless, 1),
        "cupsWeb": round(web, 1),
        "revenueKd": round(revenue, 3),
        "revenueCashlessKd": round(revenue_cashless, 3),
    }


def fetch_machines_period_sales(
    machines: List[Dict[str, Any]],
    start_day: str,
    end_day: str,
    fetch_vends_fn,
    machine_ids: Optional[Set[str]] = None,
    *,
    max_workers: int = 8,
) -> Dict[str, Dict[str, float]]:
    """Live Vendon cups/revenue summed across an inclusive date range (Kuwait calendar days)."""
    from concurrent.futures import ThreadPoolExecutor, as_completed

    start = datetime.strptime(start_day, "%Y-%m-%d").date()
    end = datetime.strptime(end_day, "%Y-%m-%d").date()
    if end < start:
        start, end = end, start
    days: List[str] = []
    cur = start
    while cur <= end:
        days.append(cur.isoformat())
        cur += timedelta(days=1)
    if not days:
        return {}

    ids: List[str] = []
    for m in machines:
        mid = str(m.get("id") or m.get("machineId") or "").strip()
        if not mid:
            continue
        if machine_ids is not None and mid not in machine_ids:
            continue
        mname = str(m.get("name") or "")
        owner = m.get("location_owner") or m.get("owner_tag")
        if not (
            _in_commercial_scope(mname, owner)
            or _is_ku_location(mname, owner)
            or _is_moh_machine(mname, owner)
        ):
            continue
        ids.append(mid)

    out: Dict[str, Dict[str, float]] = {}

    def _one(mid: str) -> Tuple[str, Dict[str, float]]:
        vh = _fetch_hourly_vends(mid, days, fetch_vends_fn)
        cups = cashless = web = revenue = revenue_cashless = 0.0
        for di in range(len(days)):
            row = _sum_vends_day(vh, di)
            cups += row["cups"]
            cashless += row["cupsCashless"]
            web += row["cupsWeb"]
            revenue += row["revenueKd"]
            revenue_cashless += row.get("revenueCashlessKd") or 0.0
        return mid, {
            "cups": round(cups, 1),
            "cupsCashless": round(cashless, 1),
            "cupsWeb": round(web, 1),
            "revenueKd": round(revenue, 3),
            "revenueCashlessKd": round(revenue_cashless, 3),
        }

    if not ids:
        return out

    workers = max(1, min(max_workers, len(ids)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_one, mid): mid for mid in ids}
        for fut in as_completed(futures):
            mid = futures[fut]
            try:
                key, row = fut.result()
                out[key] = row
            except Exception as ex:
                logger.warning(
                    "period-sales vendon fetch failed machine=%s %s..%s: %s",
                    mid,
                    start_day,
                    end_day,
                    ex,
                )
    return out


def fetch_machines_day_sales(
    machines: List[Dict[str, Any]],
    day: str,
    fetch_vends_fn,
    machine_ids: Optional[Set[str]] = None,
    *,
    max_workers: int = 8,
) -> Dict[str, Dict[str, float]]:
    """
    Live Vendon cups for one Kuwait calendar day — no full footfall report build.
    Used by targets.theleetclub.com achievement · today.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    ids: List[str] = []
    for m in machines:
        mid = str(m.get("id") or m.get("machineId") or "").strip()
        if not mid:
            continue
        if machine_ids is not None and mid not in machine_ids:
            continue
        mname = str(m.get("name") or "")
        owner = m.get("location_owner") or m.get("owner_tag")
        if not (
            _in_commercial_scope(mname, owner)
            or _is_ku_location(mname, owner)
            or _is_moh_machine(mname, owner)
        ):
            continue
        ids.append(mid)

    out: Dict[str, Dict[str, float]] = {}

    def _one(mid: str) -> Tuple[str, Dict[str, float]]:
        vh = _fetch_hourly_vends(mid, [day], fetch_vends_fn)
        return mid, _sum_vends_day(vh, 0)

    if not ids:
        return out

    workers = max(1, min(max_workers, len(ids)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_one, mid): mid for mid in ids}
        for fut in as_completed(futures):
            mid = futures[fut]
            try:
                key, row = fut.result()
                out[key] = row
            except Exception as ex:
                logger.warning("today-sales vendon fetch failed machine=%s day=%s: %s", mid, day, ex)
    return out


def _avg(vals: List[float]) -> float:
    if not vals:
        return 0.0
    return sum(vals) / len(vals)


def _build_hourly_profile(
    footfall_day_lists: Dict[int, List[float]],
    vends_day_lists: Dict[int, List[Dict[str, float]]],
    n_days: int,
    benchmark_pct: float,
) -> List[Dict[str, Any]]:
    hours: List[Dict[str, Any]] = []
    footfall_vals = []
    for h in range(24):
        fd = footfall_day_lists.get(h, [0.0] * n_days)
        vd = vends_day_lists.get(h, [_vend_day_bucket() for _ in range(n_days)])
        footfall = _avg(fd)
        cups = _avg([x["cups"] for x in vd])
        cups_cashless = _avg([x.get("cupsCashless", x["cups"]) for x in vd])
        cups_web = _avg([x.get("cupsWeb", 0.0) for x in vd])
        revenue = round(_avg([x["revenue"] for x in vd]), 3)
        revenue_web = round(_avg([x.get("revenueWeb", 0.0) for x in vd]), 3)
        conv_pct = (cups_cashless / footfall * 100.0) if footfall > 0 else 0.0
        rev_per_visitor = (revenue / footfall) if footfall > 0 else 0.0
        aspired_cups = footfall * benchmark_pct / 100.0
        uplift_cups = max(0.0, aspired_cups - cups)
        avg_cup_price = (revenue / cups) if cups > 0 else 0.5
        uplift_kd = round(uplift_cups * avg_cup_price, 3)
        footfall_vals.append(footfall)
        hours.append(
            {
                "hour": h,
                "label": f"{h:02d}:00",
                "footfall": round(footfall, 1),
                "cups": round(cups, 1),
                "cupsCashless": round(cups_cashless, 1),
                "cupsWeb": round(cups_web, 1),
                "revenueWebKd": revenue_web,
                "conversionRatio": f"{int(round(footfall))}:{int(round(cups))}",
                "conversionPct": round(conv_pct, 2),
                "revenueKd": revenue,
                "revenuePerVisitorKd": round(rev_per_visitor, 4),
                "benchmarkConversionPct": benchmark_pct,
                "aspiredCups": round(aspired_cups, 1),
                "upliftCups": round(uplift_cups, 1),
                "upliftKd": uplift_kd,
            }
        )

    p75 = sorted(footfall_vals)[int(0.75 * 23)] if footfall_vals else 0
    for row in hours:
        f = row["footfall"]
        c = row["conversionPct"]
        row["isSurge"] = f >= p75 and p75 > 0
        row["isWeakConversion"] = row["isSurge"] and c < benchmark_pct
        row["isHighEfficiency"] = c >= benchmark_pct * 1.15 and f > 0
        row["isStrongMonetization"] = row["revenuePerVisitorKd"] >= (
            max((h["revenuePerVisitorKd"] for h in hours), default=0) * 0.85
        )
    return hours


def _footfall_lists_have_signal(fh: Dict[int, List[float]]) -> bool:
    return any(sum(fd) > 0 for fd in (fh or {}).values())


def _footfall_shape_for_sales_calendar(
    fh: Dict[int, List[float]], n_sales_days: int
) -> Dict[int, List[float]]:
    """Reuse camera-week hourly shape on the sales calendar when sales week has no detections."""
    return {
        h: [_avg(fd)] * n_sales_days
        for h, fd in (fh or {}).items()
        if h < 24
    }


def _recompute_hourly_uplift_and_conversion(
    hours: List[Dict[str, Any]], benchmark_pct: float
) -> None:
    """Recalculate conversion/uplift flags after footfall is mirrored or projected onto hours."""
    if not hours:
        return
    footfall_vals = [float(h.get("footfall") or 0) for h in hours]
    p75 = sorted(footfall_vals)[int(0.75 * max(len(footfall_vals) - 1, 0))] if footfall_vals else 0
    max_rpv = 0.0
    for row in hours:
        footfall = float(row.get("footfall") or 0)
        cups = float(row.get("cupsCashless") or row.get("cups") or 0)
        revenue = float(row.get("revenueKd") or 0)
        conv_pct = (cups / footfall * 100.0) if footfall > 0 else 0.0
        rev_per_visitor = (revenue / footfall) if footfall > 0 else 0.0
        aspired_cups = footfall * benchmark_pct / 100.0
        uplift_cups = max(0.0, aspired_cups - cups)
        avg_cup_price = (revenue / cups) if cups > 0 else 0.5
        row["conversionRatio"] = (
            f"{int(round(footfall))}:{int(round(cups))}"
        )
        row["conversionPct"] = round(conv_pct, 2)
        row["benchmarkConversionPct"] = benchmark_pct
        row["revenuePerVisitorKd"] = round(rev_per_visitor, 4)
        row["aspiredCups"] = round(aspired_cups, 1)
        row["upliftCups"] = round(uplift_cups, 1)
        row["upliftKd"] = round(uplift_cups * avg_cup_price, 3)
        max_rpv = max(max_rpv, row["revenuePerVisitorKd"])
    for row in hours:
        f = float(row.get("footfall") or 0)
        c = float(row.get("conversionPct") or 0)
        row["isSurge"] = f >= p75 and p75 > 0
        row["isWeakConversion"] = row["isSurge"] and c < benchmark_pct
        row["isHighEfficiency"] = c >= benchmark_pct * 1.15 and f > 0
        row["isStrongMonetization"] = row["revenuePerVisitorKd"] >= max_rpv * 0.85 if max_rpv > 0 else False


def _period_missed_potential_kd(daily: Dict[str, Any], benchmark_pct: float) -> float:
    """Benchmark gap on period footfall (primary KPI — not only surge-hour uplift)."""
    ff = float(daily.get("projectedFootfall") or daily.get("totalFootfall") or 0)
    cups = float(daily.get("totalCups") or 0)
    if ff <= 0:
        return 0.0
    target_cups = ff * benchmark_pct / 100.0
    uplift_cups = max(0.0, target_cups - cups)
    rev = float(daily.get("totalRevenueKd") or 0)
    avg_price = (rev / cups) if cups > 0 else 0.5
    return round(uplift_cups * avg_price, 3)


def _ensure_hourly_footfall_from_daily(loc: Dict[str, Any]) -> None:
    """When daily totals have footfall but chart hours are still zero (stale cache / misaligned weeks)."""
    hours = loc.get("hours") or []
    if not hours:
        return
    hour_ff = sum(float(h.get("footfall") or 0) for h in hours)
    if hour_ff > 0:
        return
    daily = loc.get("daily") or {}
    total = float(daily.get("projectedFootfall") or daily.get("totalFootfall") or 0)
    if total <= 0:
        return
    nf = max(int(daily.get("footfallDayCount") or 5), 1)
    avg_daily = total / nf
    for row in hours:
        hi = int(row.get("hour") or 0)
        if 0 <= hi < len(HOURLY_WEIGHTS):
            row["footfall"] = round(avg_daily * HOURLY_WEIGHTS[hi], 1)
            if loc.get("footfallDataKind") == "projected":
                row["footfallProjected"] = True


def _hourly_in_out_day_lists(
    session: Session, uidds: List[str], days: List[str]
) -> Tuple[Dict[int, List[float]], Dict[int, List[float]]]:
    """Per-hour daily totals for people_in and people_out (same shape as footfall lists)."""
    per_in: Dict[int, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    per_out: Dict[int, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    if not uidds or not days:
        empty = {h: [0.0] * len(days) for h in range(24)}
        return empty, empty
    for interval in ("hour", "60000"):
        per_in = defaultdict(lambda: defaultdict(float))
        per_out = defaultdict(lambda: defaultdict(float))
        hits = 0
        for day in days:
            start_utc, end_utc = _local_day_bounds_utc(day)
            rows = (
                session.query(PeopleAnalyticsRecord)
                .filter(PeopleAnalyticsRecord.uidd.in_(uidds))
                .filter(PeopleAnalyticsRecord.interval_type == interval)
                .filter(PeopleAnalyticsRecord.first_timestamp >= start_utc)
                .filter(PeopleAnalyticsRecord.first_timestamp <= end_utc)
                .all()
            )
            for r in rows:
                h = _kuwait_hour_from_ts(r.first_timestamp)
                per_in[h][day] += float(r.people_in or 0)
                per_out[h][day] += float(r.people_out or 0)
                hits += 1
        if hits > 0 and sum(per_in[h].get(d, 0) for h in range(24) for d in days) > 0:
            break
    tin = {h: [per_in[h].get(d, 0.0) for d in days] for h in range(24)}
    tout = {h: [per_out[h].get(d, 0.0) for d in days] for h in range(24)}
    return tin, tout


def _attach_hourly_net_traffic(
    hours: List[Dict[str, Any]], tin: Dict[int, List[float]], tout: Dict[int, List[float]]
) -> None:
    for hi, row in enumerate(hours):
        if hi >= 24:
            break
        pi = _avg(tin.get(hi, [0.0]))
        po = _avg(tout.get(hi, [0.0]))
        row["peopleIn"] = round(pi, 1)
        row["peopleOut"] = round(po, 1)
        row["netTraffic"] = round(pi - po, 1)


def _rebuild_days_breakdown_estimate(loc: Dict[str, Any]) -> None:
    """Fill aligned daily rows when projection/mirror left footfall at 0 in raw camera days."""
    daily = loc.get("daily") or {}
    sales_days = list(daily.get("salesPeriodDates") or loc.get("salesPeriodDates") or [])
    foot_days = list(
        daily.get("footfallPeriodDates") or loc.get("footfallPeriodDates") or sales_days
    )
    if not sales_days:
        return
    bd = loc.get("daysBreakdown")
    if isinstance(bd, dict) and bd.get("mode") == "split":
        bd.setdefault(
            "note",
            "Sales week and camera week differ — merged table pairs Sun–Thu by day index; "
            "detections may come from another calendar week (see footfall source date).",
        )
        rows = bd.get("rows") or []
        if not rows or sum(float(r.get("footfall") or 0) for r in rows) <= 0:
            bd["rows"] = _merge_daily_breakdown_rows(
                bd.get("salesRows") or [],
                bd.get("footfallRows") or [],
                sales_days,
                foot_days,
                daily=daily,
                footfall_estimated=loc.get("footfallDataKind") in ("projected", "mirrored"),
            )
        return
    rows = (bd or {}).get("rows") if isinstance(bd, dict) else bd
    if not isinstance(rows, list):
        rows = []
    needs_fill = not rows or all(float(r.get("footfall") or 0) <= 0 for r in rows)
    total_ff = float(daily.get("projectedFootfall") or daily.get("totalFootfall") or 0)
    if not needs_fill or total_ff <= 0:
        if isinstance(bd, dict) and bd.get("mode") == "aligned":
            bd.setdefault("note", None)
        return
    nf = max(len(sales_days), 1)
    total_cups = float(daily.get("totalCups") or 0)
    total_rev = float(daily.get("totalRevenueKd") or 0)
    total_in = float(daily.get("totalIn") or 0)
    total_out = float(daily.get("totalOut") or 0)
    total_net = float(daily.get("totalNet") or 0)
    new_rows: List[Dict[str, Any]] = []
    for day in sales_days:
        tf = round(total_ff / nf, 1)
        tc = round(total_cups / nf, 1)
        tr = round(total_rev / nf, 3)
        conv = (tc / tf * 100.0) if tf > 0 else 0.0
        new_rows.append(
            {
                "date": day,
                "footfall": tf,
                "cups": tc,
                "conversionRatio": f"{int(round(tf))}:{int(round(tc))}",
                "conversionPct": round(conv, 2),
                "revenueKd": tr,
                "revenuePerVisitorKd": round(tr / tf, 4) if tf > 0 else 0.0,
                "peopleIn": round(total_in / nf, 1) if total_in > 0 else None,
                "peopleOut": round(total_out / nf, 1) if total_out > 0 else None,
                "netTraffic": round(total_net / nf, 1) if total_net != 0 or total_in > 0 else None,
                "footfallEstimated": loc.get("footfallDataKind") in ("projected", "mirrored"),
            }
        )
    note = None
    if loc.get("footfallDataKind") in ("projected", "mirrored"):
        note = (
            "Footfall is projected or mirrored — daily detections are split evenly across Sun–Thu "
            "(use hourly chart for shape)."
        )
    loc["daysBreakdown"] = {"mode": "aligned", "rows": new_rows, "note": note}


def _recompute_daily_conversion_from_footfall(loc: Dict[str, Any]) -> None:
    """Keep period conversionRatio / conversionPct aligned with final footfall totals."""
    daily = loc.setdefault("daily", {})
    ff = float(daily.get("projectedFootfall") or daily.get("totalFootfall") or 0)
    cups = float(daily.get("totalCupsCashless") or daily.get("totalCups") or 0)
    if ff > 0 and cups >= 0:
        daily["conversionPct"] = round(cups / ff * 100.0, 2)
        daily["conversionRatio"] = f"{int(round(ff))}:{int(round(cups))}"


def _refresh_location_metrics_from_hours(
    loc: Dict[str, Any], benchmark_pct: float
) -> None:
    kind = loc.get("footfallDataKind") or "none"
    if kind not in ("mirrored", "projected"):
        _ensure_hourly_footfall_from_daily(loc)
    hours = loc.get("hours") or []
    _recompute_hourly_uplift_and_conversion(hours, benchmark_pct)
    _recompute_daily_conversion_from_footfall(loc)
    daily = loc.setdefault("daily", {})
    hourly_uplift = round(sum(float(h.get("upliftKd") or 0) for h in hours), 3)
    period_uplift = _period_missed_potential_kd(daily, benchmark_pct)
    daily["illustrativeMissedPotentialKd"] = max(hourly_uplift, period_uplift)
    loc["insights"] = _insights(hours, loc.get("locationName") or "")
    _rebuild_aligned_days_breakdown(loc)
    _rebuild_days_breakdown_estimate(loc)


def _moh_site_key(machine_name: str) -> str:
    n = _norm_name(machine_name)
    for frag in sorted(MOH_VENDON_NAME_FRAGMENTS, key=len, reverse=True):
        if frag in n:
            return frag
    for token in (
        "farwaniya",
        "adan",
        "jaber",
        "jahra",
        "amiri",
        "razi",
        "zain",
        "maternity",
        "mubarak",
        "sabah",
    ):
        if token in n:
            return token
    if " - " in (machine_name or ""):
        return _norm_name((machine_name or "").split(" - ")[0])
    return n[:48] if n else "unknown"


def _is_moh_gate_name(machine_name: str, position_key: Optional[str] = None) -> bool:
    n = _norm_name(machine_name)
    if (position_key or "") == "gate":
        return True
    return "gate" in n or "main entrance" in n


def _find_moh_gate_profile_hours(
    site_key: str,
    profile_by_name: Dict[str, List[Dict[str, Any]]],
    exclude_norm: Optional[str] = None,
) -> Tuple[Optional[str], List[Dict[str, Any]]]:
    best_name: Optional[str] = None
    best_hours: List[Dict[str, Any]] = []
    best_ff = 0.0
    for norm, rows in profile_by_name.items():
        if exclude_norm and norm == exclude_norm:
            continue
        if not _is_moh_gate_name(norm):
            continue
        if _moh_site_key(norm) != site_key:
            continue
        ff = sum(float(r.get("footfall") or 0) for r in rows)
        if ff > best_ff:
            best_ff = ff
            best_name = norm
            best_hours = rows
    return best_name, best_hours


def _copy_moh_footfall_from_source(
    loc: Dict[str, Any], src: Dict[str, Any], src_label: str, *, gate_donor: bool
) -> None:
    for i, row in enumerate(loc.get("hours") or []):
        if i >= len(src.get("hours") or []):
            break
        sh = src["hours"][i]
        row["footfall"] = float(sh.get("footfall") or 0)
        row["footfallMirror"] = {
            "value": row["footfall"],
            "color": "#5eb8e8",
            "label": src_label,
        }
    sd = src.get("daily") or {}
    dd = loc.setdefault("daily", {})
    dd["totalFootfall"] = sd.get("totalFootfall")
    dd["avgDailyFootfall"] = sd.get("avgDailyFootfall")
    dd["projectedFootfall"] = sd.get("totalFootfall")
    loc["mirrorSourceName"] = src_label
    verb = "gate" if gate_donor else "site"
    loc["mirrorDisplay"] = {
        "text": f"Footfall mirrored from {verb} {src_label}",
        "color": "#5eb8e8",
        "parenthetical": True,
    }
    loc["projectionPeerName"] = src_label
    loc["footfallDataKind"] = "mirrored"
    loc["footfallDisplay"] = _footfall_display_meta("mirrored", src_label)
    loc["hasPeopleFootfall"] = False


def _apply_commercial_moh_mirror_map_overrides(
    locations: List[Dict[str, Any]], mirror_map: Dict[str, str]
) -> None:
    """
    Sites listed in commercial_moh_mirror_map.json must not use their own camera
    for footfall (Y-MOH has no reliable people count). Always mirror from the
    configured peer even when a low-quality local UID exists.
    """
    if not mirror_map:
        return
    by_norm: Dict[str, Dict[str, Any]] = {}
    for loc in locations:
        by_norm[_norm_name(str(loc.get("locationName") or ""))] = loc

    for loc in locations:
        norm = _norm_name(str(loc.get("locationName") or ""))
        peer_norm = mirror_map.get(norm)
        if not peer_norm:
            continue
        peer = by_norm.get(peer_norm)
        peer_label = str(peer.get("locationName") or peer_norm) if peer else peer_norm
        daily = loc.setdefault("daily", {})
        raw_ff = float(daily.get("totalFootfall") or 0)
        if raw_ff > 0 and loc.get("hasPeopleFootfall"):
            diag = loc.setdefault("footfallDiagnostics", {})
            if isinstance(diag, dict):
                diag["localCameraFootfallDiscarded"] = raw_ff
        loc["mirrorSourceName"] = peer_label
        loc["projectionPeerName"] = peer_label
        loc["mirrorDisplay"] = {
            "text": f"Footfall mirrored from site {peer_label}",
            "color": "#5eb8e8",
            "parenthetical": True,
        }
        loc["footfallDataKind"] = "mirrored"
        loc["footfallDisplay"] = _footfall_display_meta("mirrored", peer_label)
        loc["hasPeopleFootfall"] = False


def _apply_moh_gate_footfall_peers(
    locations: List[Dict[str, Any]], benchmark_pct: float
) -> None:
    """MOH gate with camera footfall → other gates at same hospital; else any camera site → gate."""
    best_gate: Dict[str, Dict[str, Any]] = {}
    best_site_camera: Dict[str, Dict[str, Any]] = {}
    for loc in locations:
        if not _is_moh_machine(loc.get("locationName") or "", loc.get("locationOwner")):
            continue
        ff = float((loc.get("daily") or {}).get("totalFootfall") or 0)
        if ff <= 0 or not loc.get("hasPeopleFootfall"):
            continue
        site = _moh_site_key(loc.get("locationName") or "")
        prev_site = best_site_camera.get(site)
        if not prev_site or ff > float((prev_site.get("daily") or {}).get("totalFootfall") or 0):
            best_site_camera[site] = loc
        if not _is_moh_gate_name(
            loc.get("locationName") or "", loc.get("machinePositionKey")
        ):
            continue
        prev = best_gate.get(site)
        if not prev or ff > float((prev.get("daily") or {}).get("totalFootfall") or 0):
            best_gate[site] = loc

    for loc in locations:
        if not _is_moh_machine(loc.get("locationName") or "", loc.get("locationOwner")):
            continue
        if not _is_moh_gate_name(
            loc.get("locationName") or "", loc.get("machinePositionKey")
        ):
            continue
        ff = float((loc.get("daily") or {}).get("totalFootfall") or 0)
        if ff > 0 and loc.get("hasPeopleFootfall"):
            continue
        site = _moh_site_key(loc.get("locationName") or "")
        src = best_gate.get(site) or best_site_camera.get(site)
        if not src or src.get("machineId") == loc.get("machineId"):
            continue
        src_label = src.get("locationName") or site
        gate_donor = src is best_gate.get(site)
        _copy_moh_footfall_from_source(loc, src, src_label, gate_donor=gate_donor)
        _refresh_location_metrics_from_hours(loc, benchmark_pct)


def _period_totals(
    footfall_day_lists: Dict[int, List[float]],
    vends_day_lists: Dict[int, List[Dict[str, float]]],
    sales_days: List[str],
    footfall_days: List[str],
    hours: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Period KPIs from raw day lists (not sum of hourly averages).

    - totalFootfall = sum of daily People Count (camera people_in) across footfall_days.
    - totalCups / revenue = sum across sales_days (Vendon).
    - hourlyProfileFootfallSum = sum of 24 hourly averages (≈ one avg business day, not 5-day total).
    """
    nf = len(footfall_days)
    ns = len(sales_days)
    daily_ff = [
        sum(footfall_day_lists.get(h, [0.0] * nf)[di] for h in range(24)) for di in range(nf)
    ]
    daily_cups = [
        sum(vends_day_lists.get(h, [_vend_day_bucket() for _ in range(ns)])[di]["cups"] for h in range(24))
        for di in range(ns)
    ]
    daily_cups_cashless = [
        sum(
            vends_day_lists.get(h, [_vend_day_bucket() for _ in range(ns)])[di].get("cupsCashless", 0)
            for h in range(24)
        )
        for di in range(ns)
    ]
    daily_cups_web = [
        sum(vends_day_lists.get(h, [_vend_day_bucket() for _ in range(ns)])[di].get("cupsWeb", 0) for h in range(24))
        for di in range(ns)
    ]
    daily_rev = [
        sum(vends_day_lists.get(h, [_vend_day_bucket() for _ in range(ns)])[di]["revenue"] for h in range(24))
        for di in range(ns)
    ]
    daily_rev_web = [
        sum(
            vends_day_lists.get(h, [_vend_day_bucket() for _ in range(ns)])[di].get("revenueWeb", 0)
            for h in range(24)
        )
        for di in range(ns)
    ]
    period_ff = sum(daily_ff)
    period_cups = sum(daily_cups)
    period_cups_cashless = sum(daily_cups_cashless)
    period_cups_web = sum(daily_cups_web)
    period_rev = round(sum(daily_rev), 3)
    period_rev_web = round(sum(daily_rev_web), 3)
    avg_daily_ff = (period_ff / nf) if nf else 0.0
    avg_daily_cups = (period_cups / ns) if ns else 0.0
    hourly_sum_ff = sum(h["footfall"] for h in hours)
    same_window = sales_days == footfall_days
    if same_window and period_ff > 0:
        conv_pct = period_cups / period_ff * 100.0
        conv_ratio = f"{int(round(period_ff))}:{int(round(period_cups))}"
        conv_note = None
    elif avg_daily_ff > 0:
        conv_pct = avg_daily_cups / avg_daily_ff * 100.0
        conv_ratio = f"{int(round(avg_daily_ff))}:{int(round(avg_daily_cups))}"
        conv_note = (
            "Conversion uses avg daily cups ÷ avg daily footfall (sales dates ≠ footfall dates)"
        )
    else:
        conv_pct = 0.0
        conv_ratio = "0:0"
        conv_note = None
    rpv = (period_rev / period_ff) if period_ff > 0 else 0.0
    uplift = round(sum(h["upliftKd"] for h in hours), 3)
    return {
        "totalFootfall": round(period_ff, 1),
        "avgDailyFootfall": round(avg_daily_ff, 1),
        "hourlyProfileFootfallSum": round(hourly_sum_ff, 1),
        "footfallPeriodDates": list(footfall_days),
        "salesPeriodDates": list(sales_days),
        "footfallDayCount": nf,
        "salesDayCount": ns,
        "periodsAligned": same_window,
        "footfallIsDetections": True,
        "detectionsPerCup": round(period_ff / period_cups, 1) if period_cups > 0 and same_window else None,
        "conversionNote": conv_note,
        "totalCups": round(period_cups, 1),
        "totalCupsCashless": round(period_cups_cashless, 1),
        "totalCupsWeb": round(period_cups_web, 1),
        "remoteCreditKd": period_rev_web,
        "avgDailyCups": round(avg_daily_cups, 1),
        "totalRevenueKd": period_rev,
        "conversionPct": round(conv_pct, 2),
        "conversionRatio": conv_ratio,
        "revenuePerVisitorKd": round(rpv, 4),
        "illustrativeMissedPotentialKd": uplift,
    }


def parse_report_days(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    dates_csv: Optional[str] = None,
    default_days: Optional[List[str]] = None,
    *,
    calendar_days: bool = False,
) -> List[str]:
    if dates_csv:
        out = [d.strip() for d in dates_csv.split(",") if d.strip()]
        if out:
            return out
    if start_date and end_date:
        s = datetime.strptime(start_date, "%Y-%m-%d").date()
        e = datetime.strptime(end_date, "%Y-%m-%d").date()
        days: List[str] = []
        cur = s
        while cur <= e:
            # Default: Kuwait business week Sun–Thu. calendar_days=True keeps Fri/Sat
            # (Alert compare presets / full calendar ranges).
            if calendar_days or cur.weekday() in (6, 0, 1, 2, 3):
                days.append(cur.isoformat())
            cur += timedelta(days=1)
        return days
    return list(default_days or PRIMARY_BUSINESS_DAYS)


def _empty_footfall_lists(n_days: int) -> Dict[int, List[float]]:
    return {h: [0.0] * n_days for h in range(24)}


def _empty_vends_lists(n_days: int) -> Dict[int, List[Dict[str, float]]]:
    return {h: [{"cups": 0.0, "revenue": 0.0} for _ in range(n_days)] for h in range(24)}


def _merge_daily_breakdown_rows(
    sales_rows: List[Dict[str, Any]],
    footfall_rows: List[Dict[str, Any]],
    sales_days: List[str],
    footfall_days: List[str],
    daily: Optional[Dict[str, Any]] = None,
    footfall_estimated: bool = False,
) -> List[Dict[str, Any]]:
    """
    One row per sales day: Vendon cups/revenue + footfall from the same Sun–Thu index
    in the camera week, or an even split of period footfall when camera days are empty.
    """
    daily = daily or {}
    merged: List[Dict[str, Any]] = []
    n_sales = max(len(sales_days), 1)
    total_ff = float(daily.get("projectedFootfall") or daily.get("totalFootfall") or 0)
    ff_per_day = total_ff / n_sales if total_ff > 0 else 0.0
    foot_has_signal = sum(float(r.get("footfall") or 0) for r in footfall_rows) > 0

    for i, day in enumerate(sales_days):
        sr = sales_rows[i] if i < len(sales_rows) else {}
        fr = footfall_rows[i] if i < len(footfall_rows) else {}
        tf = float(fr.get("footfall") or 0)
        if tf <= 0 and not foot_has_signal and ff_per_day > 0:
            tf = ff_per_day
        elif tf <= 0 and foot_has_signal:
            tf = float(fr.get("footfall") or 0)
        tc = float(sr.get("cups") or 0)
        tr = float(sr.get("revenueKd") or 0)
        conv = (tc / tf * 100.0) if tf > 0 else float(sr.get("conversionPct") or 0)
        ratio = (
            f"{int(round(tf))}:{int(round(tc))}"
            if tf > 0
            else str(sr.get("conversionRatio") or "0:0")
        )
        row: Dict[str, Any] = {
            "date": day,
            "footfall": round(tf, 1),
            "cups": round(tc, 1),
            "conversionRatio": ratio,
            "conversionPct": round(conv, 2),
            "revenueKd": round(tr, 3),
            "revenuePerVisitorKd": round(tr / tf, 4) if tf > 0 else float(sr.get("revenuePerVisitorKd") or 0),
        }
        if footfall_estimated or (footfall_days and footfall_days != sales_days):
            row["footfallEstimated"] = True
        if i < len(footfall_days) and footfall_days[i] != day:
            row["footfallSourceDate"] = footfall_days[i]
        merged.append(row)
    return merged


def _days_breakdown_rows(
    footfall_day_lists: Dict[int, List[float]],
    vends_day_lists: Dict[int, List[Dict[str, float]]],
    days: List[str],
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    n = len(days)
    for di, day in enumerate(days):
        tf = sum(footfall_day_lists.get(h, [0.0] * n)[di] for h in range(24))
        tc = sum(vends_day_lists.get(h, [{"cups": 0.0, "revenue": 0.0}] * n)[di]["cups"] for h in range(24))
        tr = round(
            sum(vends_day_lists.get(h, [{"cups": 0.0, "revenue": 0.0}] * n)[di]["revenue"] for h in range(24)),
            3,
        )
        conv = (tc / tf * 100.0) if tf > 0 else 0.0
        rows.append(
            {
                "date": day,
                "footfall": round(tf, 1),
                "cups": round(tc, 1),
                "conversionRatio": f"{int(round(tf))}:{int(round(tc))}",
                "conversionPct": round(conv, 2),
                "revenueKd": tr,
                "revenuePerVisitorKd": round(tr / tf, 4) if tf > 0 else 0.0,
            }
        )
    return rows


def _hourly_in_out_by_uidds(
    session: Session, uidds: List[str], days: List[str]
) -> Tuple[Dict[int, List[float]], Dict[int, List[float]]]:
    """Per-hour average in/out per business day (for net traffic charts)."""
    per_in: Dict[int, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    per_out: Dict[int, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    if not uidds or not days:
        empty = {h: [0.0] * len(days) for h in range(24)}
        return empty, empty
    for day in days:
        start_utc, end_utc = _local_day_bounds_utc(day)
        rows = (
            session.query(PeopleAnalyticsRecord)
            .filter(PeopleAnalyticsRecord.uidd.in_(uidds))
            .filter(PeopleAnalyticsRecord.interval_type == "hour")
            .filter(PeopleAnalyticsRecord.first_timestamp >= start_utc)
            .filter(PeopleAnalyticsRecord.first_timestamp <= end_utc)
            .all()
        )
        for r in rows:
            h = _kuwait_hour_from_ts(r.first_timestamp)
            per_in[h][day] += float(r.people_in or 0)
            per_out[h][day] += float(r.people_out or 0)
    tin = {h: [per_in[h].get(d, 0.0) for d in days] for h in range(24)}
    tout = {h: [per_out[h].get(d, 0.0) for d in days] for h in range(24)}
    return tin, tout


def _attach_hourly_net_traffic(
    hours: List[Dict[str, Any]], tin: Dict[int, List[float]], tout: Dict[int, List[float]], n_days: int
) -> None:
    for row in hours:
        hi = int(row.get("hour") or 0)
        if hi < 0 or hi >= 24:
            continue
        pi = _avg(tin.get(hi, [0.0] * n_days))
        po = _avg(tout.get(hi, [0.0] * n_days))
        row["peopleIn"] = round(pi, 1)
        row["peopleOut"] = round(po, 1)
        row["netTraffic"] = round(pi - po, 1)


def _rebuild_aligned_days_breakdown(loc: Dict[str, Any]) -> None:
    """Fill daily rows when footfall was projected/mirrored but hourly lists were empty at build."""
    daily = loc.get("daily") or {}
    sales_days = list(daily.get("salesPeriodDates") or loc.get("salesPeriodDates") or [])
    if not sales_days:
        return
    bd = loc.get("daysBreakdown") or {}
    if isinstance(bd, list):
        return
    if bd.get("mode") == "split":
        foot_days = list(
            daily.get("footfallPeriodDates") or loc.get("footfallPeriodDates") or sales_days
        )
        bd["rows"] = _merge_daily_breakdown_rows(
            bd.get("salesRows") or [],
            bd.get("footfallRows") or [],
            sales_days,
            foot_days,
            daily=daily,
            footfall_estimated=loc.get("footfallDataKind") in ("projected", "mirrored"),
        )
        return
    rows = bd.get("rows") or []
    if rows and sum(float(r.get("footfall") or 0) for r in rows) > 0:
        return
    total_ff = float(daily.get("projectedFootfall") or daily.get("totalFootfall") or 0)
    total_cups = float(daily.get("totalCups") or 0)
    total_rev = float(daily.get("totalRevenueKd") or 0)
    if total_ff <= 0 and total_cups <= 0:
        return
    nf = max(len(sales_days), 1)
    new_rows: List[Dict[str, Any]] = []
    for day in sales_days:
        tf = total_ff / nf if total_ff > 0 else 0.0
        tc = total_cups / nf if total_cups > 0 else 0.0
        tr = total_rev / nf if total_rev > 0 else 0.0
        conv = (tc / tf * 100.0) if tf > 0 else 0.0
        new_rows.append(
            {
                "date": day,
                "footfall": round(tf, 1),
                "cups": round(tc, 1),
                "conversionRatio": f"{int(round(tf))}:{int(round(tc))}",
                "conversionPct": round(conv, 2),
                "revenueKd": round(tr, 3),
                "revenuePerVisitorKd": round(tr / tf, 4) if tf > 0 else 0.0,
                "footfallEstimated": loc.get("footfallDataKind") in ("projected", "mirrored"),
            }
        )
    loc["daysBreakdown"] = {
        "mode": "aligned",
        "rows": new_rows,
        "note": (
            "Daily values estimated from period totals and hourly shape "
            "(camera week may differ from sales week — see banner)."
            if loc.get("footfallDataKind") != "actual"
            else None
        ),
    }


def _days_breakdown(
    footfall_day_lists: Dict[int, List[float]],
    vends_day_lists: Dict[int, List[Dict[str, float]]],
    sales_days: List[str],
    footfall_days: List[str],
) -> Dict[str, Any]:
    """Daily rows; when sales ≠ footfall weeks, split so dates are not mixed."""
    if sales_days == footfall_days:
        return {
            "mode": "aligned",
            "rows": _days_breakdown_rows(footfall_day_lists, vends_day_lists, sales_days),
        }
    sales_rows = _days_breakdown_rows(
        _empty_footfall_lists(len(sales_days)), vends_day_lists, sales_days
    )
    footfall_rows = _days_breakdown_rows(
        footfall_day_lists, _empty_vends_lists(len(footfall_days)), footfall_days
    )
    return {
        "mode": "split",
        "note": (
            "Sales week and camera week differ — merged table uses Sun–Thu index; "
            "optional tables below show each calendar separately."
        ),
        "salesRows": sales_rows,
        "footfallRows": footfall_rows,
        "rows": _merge_daily_breakdown_rows(
            sales_rows,
            footfall_rows,
            sales_days,
            footfall_days,
        ),
    }


def _resolve_hourly_footfall_lists(
    session: Session,
    uidds: List[str],
    aligned_days: List[str],
    vl_cache: Optional[Dict[str, Dict[str, Dict[int, float]]]] = None,
) -> Tuple[Dict[int, List[float]], Dict[str, Any], str]:
    """
    Footfall for the single aligned Sun–Thu week (same as Vendon sales after coerce).
    When the sales week has no camera rows, reuse the last camera week's hourly shape.
    """
    fh, foot_meta = _hourly_footfall_by_uidds(
        session, uidds, aligned_days, vl_cache=vl_cache
    )
    if _footfall_lists_have_signal(fh):
        foot_meta.setdefault("footfallDataKind", "actual")
        return fh, foot_meta, "primary"

    last_days = _last_footfall_days_for_uidds(session, uidds, len(aligned_days))
    if last_days and list(last_days) != list(aligned_days):
        fh_src, _ = _hourly_footfall_by_uidds(
            session, uidds, last_days, vl_cache=vl_cache
        )
        if _footfall_lists_have_signal(fh_src):
            fh = _footfall_shape_for_sales_calendar(fh_src, len(aligned_days))
            foot_meta["footfallPeriodNote"] = (
                f"Camera detections from {last_days[0]}–{last_days[-1]} "
                f"applied to sales week {aligned_days[0]}–{aligned_days[-1]} "
                "(same cups/revenue calendar)."
            )
            foot_meta["footfallDataKind"] = "actual"
            return fh, foot_meta, "shaped_from_last_camera_week"

    foot_meta.setdefault("footfallDataKind", "actual")
    return fh, foot_meta, "primary"


def _annotate_footfall_period_meta(
    foot_meta: Dict[str, Any],
    foot_days: List[str],
    sales_days: List[str],
    foot_period: str,
) -> None:
    """Metadata uses the resolved sales calendar (not the originally requested week)."""
    foot_meta["footfallPeriodDates"] = list(foot_days)
    foot_meta["salesPeriodDates"] = list(sales_days)
    if foot_days == sales_days:
        foot_meta.pop("footfallPeriodNote", None)
        return
    if foot_period == "db_last_available":
        foot_meta["footfallPeriodNote"] = (
            f"Sales {sales_days[0]}–{sales_days[-1]} · camera detections {foot_days[0]}–{foot_days[-1]} (no camera data for sales week)"
        )
    else:
        foot_meta["footfallPeriodNote"] = (
            f"Sales {sales_days[0]}–{sales_days[-1]} · camera detections {foot_days[0]}–{foot_days[-1]} (different weeks)"
        )


def _hourly_profile_for_location(
    fh: Dict[int, List[float]],
    vh: Dict[int, List[Dict[str, float]]],
    sales_days: List[str],
    foot_days: List[str],
    fh_sales: Optional[Dict[int, List[float]]] = None,
) -> List[Dict[str, Any]]:
    """
    Hourly chart/heatmap rows use the sales calendar (Vendon cups/revenue).
    Period KPI totals still use foot_days for camera detections when weeks differ.
    """
    if sales_days == foot_days:
        return _build_hourly_profile(fh, vh, len(sales_days), BENCHMARK_CONVERSION_PCT)
    n = len(sales_days)
    fh_chart = fh_sales if fh_sales is not None else _empty_footfall_lists(n)
    return _build_hourly_profile(fh_chart, vh, n, BENCHMARK_CONVERSION_PCT)


def _chart_hours_for_location(
    session: Session,
    uidds: List[str],
    fh: Dict[int, List[float]],
    vh: Dict[int, List[Dict[str, float]]],
    sales_days: List[str],
    foot_days: List[str],
    vl_cache: Optional[Dict[str, Dict[str, Dict[int, float]]]] = None,
) -> List[Dict[str, Any]]:
    if sales_days == foot_days:
        hours = _hourly_profile_for_location(fh, vh, sales_days, foot_days)
    else:
        fh_sales, _ = _hourly_footfall_by_uidds(session, uidds, sales_days, vl_cache=vl_cache)
        if not _footfall_lists_have_signal(fh_sales) and _footfall_lists_have_signal(fh):
            fh_sales = _footfall_shape_for_sales_calendar(fh, len(sales_days))
        hours = _hourly_profile_for_location(fh, vh, sales_days, foot_days, fh_sales=fh_sales)
    if uidds:
        tin, tout = _hourly_in_out_by_uidds(session, uidds, foot_days)
        _attach_hourly_net_traffic(hours, tin, tout, len(foot_days))
    return hours


def _build_period_compare_bundle(
    session: Session,
    machine_id: str,
    uidds: Optional[List[str]],
    compare_days: List[str],
    fetch_vends_fn,
    vend_cache: Dict[Tuple[str, Tuple[str, ...]], Dict[int, List[Dict[str, float]]]],
    vl_cache: Optional[Dict[str, Dict[str, Dict[int, float]]]] = None,
) -> Tuple[Optional[List[Dict[str, Any]]], Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """Hourly profile, period totals, and day-by-day rows for the compare week."""
    if not compare_days:
        return None, None, None
    vh2 = _get_cached_vh(machine_id, compare_days, fetch_vends_fn, vend_cache)
    foot_days2, _ = _footfall_days_for_period(compare_days, uidds if uidds else None)
    if uidds:
        fh2, _ = _hourly_footfall_by_uidds(session, uidds, foot_days2, vl_cache=vl_cache)
        cmp_h = _chart_hours_for_location(
            session, uidds, fh2, vh2, compare_days, foot_days2, vl_cache=vl_cache
        )
    else:
        fh2 = {h: [0.0] * len(foot_days2) for h in range(24)}
        cmp_h = _hourly_profile_for_location(fh2, vh2, compare_days, foot_days2)
    cmp_d = _period_totals(fh2, vh2, compare_days, foot_days2, cmp_h)
    if uidds:
        cmp_d.update(_traffic_totals_for_uidds(session, uidds, foot_days2))
    cmp_bd = _days_breakdown(fh2, vh2, compare_days, foot_days2)
    return cmp_h, cmp_d, cmp_bd


def _sync_sales_footfall_calendar(loc: Dict[str, Any]) -> None:
    """Ensure footfall week metadata matches the Vendon sales week shown in charts."""
    daily = loc.setdefault("daily", {})
    sales = list(
        daily.get("salesPeriodDates")
        or loc.get("salesPeriodDates")
        or loc.get("periodDates")
        or []
    )
    if not sales:
        return
    kind = loc.get("footfallDataKind") or "none"
    if kind in ("mirrored", "projected", "none") or not loc.get("hasPeopleFootfall"):
        daily["footfallPeriodDates"] = sales
        loc["footfallPeriodDates"] = sales
        daily["periodsAligned"] = True
        diag = loc.setdefault("footfallDiagnostics", {})
        if isinstance(diag, dict):
            diag["footfallPeriodDates"] = sales
    else:
        foot = list(daily.get("footfallPeriodDates") or loc.get("footfallPeriodDates") or [])
        if foot and foot != sales:
            daily["footfallPeriodDates"] = sales
            loc["footfallPeriodDates"] = sales
            diag = loc.setdefault("footfallDiagnostics", {})
            if isinstance(diag, dict):
                diag["footfallPeriodDates"] = sales


def _sanitize_location_footfall(loc: Dict[str, Any]) -> None:
    """
    Keep totalFootfall for camera/mirrored sites only; estimates live in projectedFootfall.
    Repairs stale cache rows that copied projected totals into totalFootfall.
    """
    daily = loc.setdefault("daily", {})
    kind = loc.get("footfallDataKind") or "none"
    has_pa = bool(loc.get("hasPeopleFootfall"))
    mirrored = kind == "mirrored" or bool(loc.get("mirrorDisplay"))

    if kind == "projected":
        pf = float(daily.get("projectedFootfall") or daily.get("totalFootfall") or 0)
        if pf > 0:
            daily["projectedFootfall"] = pf
        daily["totalFootfall"] = 0.0
        loc["hasPeopleFootfall"] = False
        return

    if not has_pa and not mirrored:
        tf = float(daily.get("totalFootfall") or 0)
        pf = float(daily.get("projectedFootfall") or 0)
        if tf > 0 or pf > 0:
            daily["projectedFootfall"] = pf or tf
            daily["totalFootfall"] = 0.0
            loc["footfallDataKind"] = "projected"
            loc["hasPeopleFootfall"] = False
            if not loc.get("footfallDisplay"):
                loc["footfallDisplay"] = _footfall_display_meta("projected")


def _ranking_footfall_value(loc: Dict[str, Any]) -> float:
    """Peak-traffic ranking: camera/mirrored detections only (not projected estimates)."""
    kind = loc.get("footfallDataKind") or "none"
    if kind in ("projected", "none"):
        return 0.0
    if kind == "mirrored" or bool(loc.get("hasPeopleFootfall")):
        return float((loc.get("daily") or {}).get("totalFootfall") or 0)
    return 0.0


def _ranking_projected_footfall_value(loc: Dict[str, Any]) -> float:
    if (loc.get("footfallDataKind") or "none") != "projected":
        return 0.0
    daily = loc.get("daily") or {}
    return float(int(round(float(daily.get("projectedFootfall") or daily.get("totalFootfall") or 0))))


def _build_commercial_rankings(locations: List[Dict[str, Any]]) -> Dict[str, Any]:
    by_footfall = sorted(
        [l for l in locations if _ranking_footfall_value(l) > 0],
        key=lambda x: -_ranking_footfall_value(x),
    )
    by_projected = sorted(
        [l for l in locations if _ranking_projected_footfall_value(l) > 0],
        key=lambda x: -_ranking_projected_footfall_value(x),
    )
    by_revenue = sorted(locations, key=lambda x: -float((x.get("daily") or {}).get("totalRevenueKd") or 0))
    by_conv = sorted(
        [l for l in locations if _ranking_footfall_value(l) > 0],
        key=lambda x: -float((x.get("daily") or {}).get("conversionPct") or 0),
    )
    by_uplift = sorted(
        locations,
        key=lambda x: -float((x.get("daily") or {}).get("illustrativeMissedPotentialKd") or 0),
    )
    by_rpv = sorted(
        [l for l in locations if _ranking_footfall_value(l) > 0],
        key=lambda x: -float((x.get("daily") or {}).get("revenuePerVisitorKd") or 0),
    )

    def _row(loc: Dict[str, Any], value: float) -> Dict[str, Any]:
        return {
            "machineId": loc["machineId"],
            "name": loc["locationName"],
            "value": value,
        }

    return {
        "byFootfall": [
            _row(l, _ranking_footfall_value(l)) for l in by_footfall[:15]
        ],
        "byProjectedFootfall": [
            _row(l, _ranking_projected_footfall_value(l)) for l in by_projected[:15]
        ],
        "byRevenue": [
            _row(l, float((l.get("daily") or {}).get("totalRevenueKd") or 0))
            for l in by_revenue[:15]
        ],
        "byConversion": [
            _row(l, float((l.get("daily") or {}).get("conversionPct") or 0))
            for l in by_conv[:15]
        ],
        "byMissedPotential": [
            _row(
                l,
                float((l.get("daily") or {}).get("illustrativeMissedPotentialKd") or 0),
            )
            for l in by_uplift[:15]
        ],
        "byRevenuePerVisitor": [
            _row(l, float((l.get("daily") or {}).get("revenuePerVisitorKd") or 0))
            for l in by_rpv[:15]
        ],
    }


def _insights(hours: List[Dict[str, Any]], location_name: str) -> Dict[str, Any]:
    if not hours:
        return {"summary": f"No hourly profile for {location_name}."}
    peak_exp = max(hours, key=lambda x: x["footfall"])
    peak_mon = max(hours, key=lambda x: x["revenuePerVisitorKd"])
    weak = [h for h in hours if h.get("isWeakConversion")]
    high_eff = [h for h in hours if h.get("isHighEfficiency")]
    weak_hours = ", ".join(h["label"] for h in weak[:5]) or "—"
    summary = (
        f"{location_name}: peak exposure at {peak_exp['label']} ({peak_exp['footfall']:.0f} visitors/hr avg), "
        f"best monetization at {peak_mon['label']} ({peak_mon['revenuePerVisitorKd']:.4f} KD/visitor); "
        f"{len(weak)} weak-conversion surge hour(s) with ~{sum(h['upliftKd'] for h in weak):.1f} KD illustrative uplift."
    )
    return {
        "summary": summary,
        "peakExposureHour": peak_exp["label"],
        "peakExposureFootfall": peak_exp["footfall"],
        "peakMonetizationHour": peak_mon["label"],
        "peakMonetizationRpvKd": peak_mon["revenuePerVisitorKd"],
        "weakConversionHours": [h["label"] for h in weak],
        "highEfficiencyHours": [h["label"] for h in high_eff],
        "weakConversionWindowCount": len(weak),
    }


def finalize_commercial_report_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Enrich / repair payloads (including older Postgres cache rows) so UI metrics stay consistent.
    Rankings and footfall field split run on every read; full re-projection only when version is stale.
    """
    locs = payload.get("locations") or []
    if not locs:
        payload["reportPayloadVersion"] = REPORT_PAYLOAD_VERSION
        return payload

    version = int(payload.get("reportPayloadVersion") or 0)
    benchmark = float(payload.get("benchmarkConversionPct") or BENCHMARK_CONVERSION_PCT)

    from commercial_footfall_projection import (
        apply_projected_footfall_and_targets,
        machine_position_key,
        machine_site_key,
        segment_benchmark_pct,
    )

    if version < REPORT_PAYLOAD_VERSION:
        for loc in locs:
            mname = loc.get("locationName") or ""
            owner = loc.get("locationOwner")
            seg = loc.get("ownerSegment") or _owner_segment(mname, owner)
            loc["ownerSegment"] = seg
            if not loc.get("machinePositionKey"):
                loc["machinePositionKey"] = machine_position_key(mname, None)
            if not loc.get("machineSiteKey"):
                loc["machineSiteKey"] = machine_site_key(mname, seg)
        _apply_moh_gate_footfall_peers(locs, benchmark)

    _apply_commercial_moh_mirror_map_overrides(locs, _load_moh_mirror_map())

    for loc in locs:
        _sanitize_location_footfall(loc)

    apply_projected_footfall_and_targets(
        locs,
        _owner_segment,
        _footfall_display_meta,
        benchmark,
    )
    for loc in locs:
        _sync_sales_footfall_calendar(loc)
        seg = loc.get("ownerSegment") or _owner_segment(
            loc.get("locationName") or "", loc.get("locationOwner")
        )
        seg_bench = segment_benchmark_pct(seg, benchmark)
        _refresh_location_metrics_from_hours(loc, seg_bench)
        _rebuild_aligned_days_breakdown(loc)
        _rebuild_days_breakdown_estimate(loc)
        cmp_bd = loc.get("compareDaysBreakdown")
        cmp_daily = loc.get("compareDaily") or {}
        cmp_sales = list(
            cmp_daily.get("salesPeriodDates")
            or loc.get("comparePeriodDates")
            or []
        )
        if isinstance(cmp_bd, dict) and cmp_sales:
            cmp_foot = list(
                cmp_daily.get("footfallPeriodDates")
                or cmp_sales
            )
            if cmp_bd.get("mode") == "split":
                cmp_bd.setdefault(
                    "rows",
                    _merge_daily_breakdown_rows(
                        cmp_bd.get("salesRows") or [],
                        cmp_bd.get("footfallRows") or [],
                        cmp_sales,
                        cmp_foot,
                        daily=cmp_daily,
                        footfall_estimated=loc.get("footfallDataKind")
                        in ("projected", "mirrored"),
                    ),
                )
            elif not (cmp_bd.get("rows") or []):
                cmp_bd["rows"] = _days_breakdown_rows(
                    {h: [0.0] * len(cmp_sales) for h in range(24)},
                    {h: [{"cups": 0.0, "revenue": 0.0}] * len(cmp_sales) for h in range(24)},
                    cmp_sales,
                )
        _sanitize_location_footfall(loc)

    payload["rankings"] = _build_commercial_rankings(locs)
    payload["reportPayloadVersion"] = REPORT_PAYLOAD_VERSION
    payload["locationCount"] = len(locs)
    return payload


def build_commercial_footfall_report(
    session: Session,
    machines: List[Dict[str, Any]],
    resolve_uidds_fn,
    fetch_vends_fn,
    videoloft_cameras: Optional[List[Dict[str, Any]]] = None,
    alert_camera_map: Optional[Dict[str, Any]] = None,
    primary_days: Optional[List[str]] = None,
    fallback_days: Optional[List[str]] = None,
    compare_days: Optional[List[str]] = None,
    allow_sales_proxy: bool = True,
) -> Dict[str, Any]:
    """
    Build full report payload.

    resolve_uidds_fn(machine_id, machine_name) -> (uidds, source)
    fetch_vends_fn(from_ts, to_ts, machine_id) -> (vends, error)

    allow_sales_proxy: when False (Alert calendar Periods), never substitute
    Jun/May proxy weeks — keep the requested dates with zero cups if empty.
    """
    primary_days = list(primary_days or PRIMARY_BUSINESS_DAYS)
    # None → default May week; [] → no fallback (Alert calendar windows).
    if fallback_days is None:
        fallback_days = list(FALLBACK_BUSINESS_DAYS)
    else:
        fallback_days = list(fallback_days)
    compare_days_list = list(compare_days) if compare_days else []

    from commercial_footfall_resolve import load_commercial_name_camera_map

    name_camera_map = load_commercial_name_camera_map()
    vl_cache: Optional[Dict[str, Dict[str, Dict[int, float]]]] = None
    if _db_has_footfall_in_period(session, primary_days):
        prefetch_days = primary_days
    elif fallback_days:
        prefetch_days = fallback_days
    else:
        prefetch_days = primary_days
    if prefetch_days and not _db_has_footfall_in_period(session, prefetch_days):
        logger.info(
            "No DB footfall for %s–%s; prefetching Videoloft",
            prefetch_days[0],
            prefetch_days[-1],
        )
        vl_cache = _prefetch_videoloft_footfall_cache(
            machines,
            resolve_uidds_fn,
            prefetch_days,
            name_camera_map=name_camera_map,
            cameras=videoloft_cameras,
            cmap=alert_camera_map,
        )

    mirror_map = _load_moh_mirror_map()
    name_to_machine: Dict[str, Dict[str, Any]] = {}
    for m in machines:
        name_to_machine[_norm_name(m.get("name") or "")] = m

    locations_out: List[Dict[str, Any]] = []
    included_ids: Set[str] = set()

    def _footfall_days_for_period(
        days_used: List[str], uidds: Optional[List[str]] = None
    ) -> Tuple[List[str], str]:
        """Footfall dates may differ from Vendon sales dates when historical PA is missing."""
        if not uidds:
            # No camera: footfall is mirrored/projected — always use the sales week.
            return list(days_used), "mirror_sales_calendar"
        n = len(days_used)
        if uidds and _db_has_footfall_for_uidds(session, uidds, days_used):
            return days_used, "primary"
        if days_used != fallback_days:
            if uidds and _db_has_footfall_for_uidds(session, uidds, fallback_days):
                return fallback_days, "fallback_footfall_db"
        if uidds:
            last_days = _last_footfall_days_for_uidds(session, uidds, n)
            if last_days:
                return last_days, "db_last_available"
        if vl_cache and uidds and any(
            sum(
                (vl_cache.get(d) or {}).get(uid, {}).get(h, 0)
                for h in range(24)
                for uid in uidds
            )
            > 0
            for d in (days_used if days_used != fallback_days else fallback_days)
        ):
            return days_used, "primary_videoloft"
        if days_used != fallback_days:
            return fallback_days, "fallback_footfall_videoloft"
        return days_used, "primary"

    def _resolve_sales_days(
        machine_id: str,
    ) -> Tuple[List[str], str, str, List[str], Dict[int, List[Dict[str, float]]]]:
        """
        Resolve Vendon sales window per machine (single cached hourly fetch per window).
        New locations without last-year sales → May 10–14 benchmark, else nearest week with data.
        Returns (sales_days, period_key, sales_data_kind, requested_days, hourly_vends).
        """
        requested = list(primary_days)
        n = len(requested)
        vh_req = _get_cached_vh(machine_id, requested, fetch_vends_fn, vend_cache)
        if _vh_total_cups(vh_req) > 0:
            return requested, "primary", "actual", requested, vh_req

        # Alert user-selected Periods: do not swap in Jun/May proxy cups.
        if not allow_sales_proxy:
            return requested, "primary_no_sales", "none", requested, vh_req

        bench = list(fallback_days)
        if bench and list(requested) != list(bench):
            vh_bench = _get_cached_vh(machine_id, bench, fetch_vends_fn, vend_cache)
            if _vh_total_cups(vh_bench) > 0:
                return bench, "proxy_benchmark", "proxy_benchmark", requested, vh_bench

        nearest = _nearest_sales_window(
            machine_id, requested[0], n, fetch_vends_fn, vend_cache=vend_cache
        )
        if nearest:
            vh_near = _get_cached_vh(machine_id, nearest, fetch_vends_fn, vend_cache)
            return nearest, "proxy_nearest", "proxy_nearest", requested, vh_near

        return requested, "primary_no_sales", "none", requested, vh_req

    def _coerce_aligned_calendar(
        machine_id: str,
        uidds: Optional[List[str]],
        sales_days: List[str],
        foot_days: List[str],
        foot_period: str,
        vh: Dict[int, List[Dict[str, float]]],
        sales_kind: str,
    ) -> Tuple[List[str], List[str], Dict[int, List[Dict[str, float]]], str, str]:
        """
        One Sun–Thu week for Vendon sales and footfall per machine.
        Prefer the sales week; if camera data only exists on another week, move sales too.
        """
        if sales_days == foot_days:
            return sales_days, foot_days, vh, sales_kind, foot_period

        if not uidds:
            return sales_days, sales_days, vh, sales_kind, "mirror_sales_calendar"

        if _db_has_footfall_for_uidds(session, uidds, sales_days):
            return sales_days, sales_days, vh, sales_kind, "primary"

        fh_sales, _ = _hourly_footfall_by_uidds(
            session, uidds, sales_days, vl_cache=vl_cache
        )
        if _footfall_lists_have_signal(fh_sales):
            return sales_days, sales_days, vh, sales_kind, "primary"

        vh_foot = _get_cached_vh(machine_id, foot_days, fetch_vends_fn, vend_cache)
        # Move sales to the camera week only when the resolved sales week has no Vendon cups.
        if _vh_total_cups(vh_foot) > 0 and _vh_total_cups(vh) <= 0:
            if not allow_sales_proxy:
                return sales_days, sales_days, vh, sales_kind, "sales_week_aligned"
            return foot_days, foot_days, vh_foot, "proxy_footfall_week", foot_period

        if allow_sales_proxy and fallback_days and list(fallback_days) != list(sales_days):
            vh_fb = _get_cached_vh(machine_id, fallback_days, fetch_vends_fn, vend_cache)
            has_sales = _vh_total_cups(vh_fb) > 0
            has_ff = _db_has_footfall_for_uidds(session, uidds, fallback_days)
            if not has_ff:
                fh_fb, _ = _hourly_footfall_by_uidds(
                    session, uidds, fallback_days, vl_cache=vl_cache
                )
                has_ff = _footfall_lists_have_signal(fh_fb)
            if has_sales and has_ff:
                sk = "proxy_benchmark" if list(sales_days) != list(fallback_days) else sales_kind
                return fallback_days, fallback_days, vh_fb, sk, "primary"

        return sales_days, sales_days, vh, sales_kind, "sales_week_aligned"

    def _loc_payload(
        mid: str,
        mname: str,
        owner: Any,
        days: List[str],
        period_key: str,
        data_source: str,
        people_map_source: str,
        has_pa: bool,
        hours: List[Dict[str, Any]],
        daily: Dict[str, Any],
        ins: Dict[str, Any],
        foot_meta: Dict[str, Any],
        fh: Dict[int, List[float]],
        vh: Dict[int, List[Dict[str, float]]],
        mirror_name: Optional[str] = None,
        mirror_display: Optional[Dict[str, Any]] = None,
        compare_hours: Optional[List[Dict[str, Any]]] = None,
        compare_daily: Optional[Dict[str, Any]] = None,
        compare_days_breakdown: Optional[Dict[str, Any]] = None,
        requested_sales_dates: Optional[List[str]] = None,
        sales_data_kind: str = "actual",
        sales_display: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        req_sales = list(requested_sales_dates or days)
        return {
            "machineId": mid,
            "locationName": mname,
            "locationOwner": owner,
            "dataSource": data_source,
            "peopleMapSource": people_map_source,
            "periodLabel": f"{len(days)}-day average business-day profile",
            "periodDates": days,
            "periodKey": period_key,
            "hasPeopleFootfall": has_pa,
            "mirrorSourceName": mirror_name,
            "mirrorDisplay": mirror_display,
            "footfallDiagnostics": foot_meta,
            "hours": hours,
            "daily": daily,
            "footfallPeriodDates": foot_meta.get("footfallPeriodDates") or list(days),
            "salesPeriodDates": list(days),
            "requestedSalesPeriodDates": req_sales,
            "salesDataKind": sales_data_kind,
            "salesDisplay": sales_display,
            "footfallDataKind": foot_meta.get("footfallDataKind") or ("actual" if has_pa else "none"),
            "footfallDisplay": foot_meta.get("footfallDisplay"),
            "machinePositionKey": machine_position_by_id.get(mid, "site_default"),
            "machineSiteKey": machine_site_by_id.get(mid, "site_default"),
            "ownerSegment": _owner_segment(mname, owner),
            "projectionPeerName": None,
            "daysBreakdown": _days_breakdown(fh, vh, days, days),
            "insights": ins,
            "comparePeriodDates": compare_days_list or None,
            "compareHours": compare_hours,
            "compareDaily": compare_daily,
            "compareDaysBreakdown": compare_days_breakdown,
        }

    def _append_location(loc: Dict[str, Any]) -> None:
        locations_out.append(loc)
        included_ids.add(loc["machineId"])
        norm = _norm_name(loc["locationName"])
        profile_by_name[norm] = loc["hours"]
        daily_loc = loc.get("daily") or {}
        meta_by_name[norm] = {
            "locationName": loc.get("locationName"),
            "totalFootfall": float(daily_loc.get("totalFootfall") or 0),
            "totalRevenueKd": float(daily_loc.get("totalRevenueKd") or 0),
            "hasPeopleFootfall": bool(loc.get("hasPeopleFootfall")),
            "site": loc.get("machineSiteKey"),
            "position": loc.get("machinePositionKey"),
            "segment": loc.get("ownerSegment"),
        }

    profile_by_name: Dict[str, List[Dict[str, Any]]] = {}
    meta_by_name: Dict[str, Dict[str, Any]] = {}
    vend_cache: Dict[Tuple[str, Tuple[str, ...]], Dict[int, List[Dict[str, float]]]] = {}

    from commercial_footfall_projection import (
        find_moh_mirror_peer,
        machine_position_key,
        machine_site_key,
    )

    machine_position_by_id: Dict[str, str] = {}
    machine_site_by_id: Dict[str, str] = {}
    for m in machines:
        mid = str(m.get("id") or "")
        if not mid:
            continue
        mname = str(m.get("name") or "")
        owner = m.get("location_owner") or m.get("owner_tag")
        seg = _owner_segment(mname, owner)
        raw = m.get("machine_raw") if isinstance(m.get("machine_raw"), dict) else None
        machine_position_by_id[mid] = machine_position_key(mname, raw)
        machine_site_by_id[mid] = machine_site_key(mname, seg)

    mapped_machine_ids: Set[str] = set()
    if alert_camera_map:
        mapped_machine_ids = {str(k) for k in alert_camera_map if not str(k).startswith("_")}

    # Pass 1: in-scope machines with People Analytics footfall (non-KU)
    for m in machines:
        mid = str(m.get("id") or "")
        mname = str(m.get("name") or "")
        owner = m.get("location_owner") or m.get("owner_tag")
        if not mid or (
            not _in_commercial_scope(mname, owner) and mid not in mapped_machine_ids
        ):
            continue
        days, period_key, sales_kind, requested_sales, vh = _resolve_sales_days(mid)
        uidds, map_src = resolve_uidds_fn(mid, mname, days)
        if not uidds and videoloft_cameras:
            frags = name_camera_map.get(_norm_name(mname)) or []
            if frags:
                from alert_routes import _uidds_from_mapping_entry

                uidds = _uidds_from_mapping_entry(videoloft_cameras, {"cameraNames": frags})
                if uidds:
                    map_src = "commercial_name_map"
        if not uidds:
            continue
        foot_days, foot_period = _footfall_days_for_period(days, uidds)
        days, foot_days, vh, sales_kind, foot_period = _coerce_aligned_calendar(
            mid, uidds, days, foot_days, foot_period, vh, sales_kind
        )
        fh, foot_meta, foot_res_period = _resolve_hourly_footfall_lists(
            session, uidds, days, vl_cache=vl_cache
        )
        _annotate_footfall_period_meta(foot_meta, days, days, foot_res_period or foot_period)
        if foot_days == days:
            foot_meta.setdefault(
                "footfallPeriodNote",
                "Footfall and sales use the same calendar week (camera + Vendon).",
            )
        hours = _chart_hours_for_location(session, uidds, fh, vh, days, foot_days, vl_cache)
        daily = _period_totals(fh, vh, days, foot_days, hours)
        if uidds:
            daily.update(_traffic_totals_for_uidds(session, uidds, foot_days))
        _apply_sales_kind_to_daily(daily, sales_kind, requested_sales)
        sdisp = _sales_display_meta(sales_kind, days, requested_sales)
        foot_meta["footfallDataKind"] = "actual"
        foot_meta["footfallDisplay"] = _footfall_display_meta("actual")
        ins = _insights(hours, mname)
        cmp_h, cmp_d, cmp_bd = _build_period_compare_bundle(
            session, mid, uidds, compare_days_list, fetch_vends_fn, vend_cache, vl_cache
        )
        _append_location(
            _loc_payload(
                mid, mname, owner, days, period_key, "people_analytics", map_src, True,
                hours, daily, ins, foot_meta, fh, vh,
                compare_hours=cmp_h, compare_daily=cmp_d, compare_days_breakdown=cmp_bd,
                requested_sales_dates=requested_sales,
                sales_data_kind=sales_kind,
                sales_display=sdisp,
            )
        )
        name_to_machine[_norm_name(mname)] = m

    # Pass 2: MOH Vendon machines (including those without PA)
    for m in machines:
        mid = str(m.get("id") or "")
        mname = str(m.get("name") or "")
        owner = m.get("location_owner") or m.get("owner_tag")
        if not mid or mid in included_ids or _is_ku_location(mname, owner):
            continue
        if not _is_moh_machine(mname, owner):
            continue
        days, period_key, sales_kind, requested_sales, vh = _resolve_sales_days(mid)
        uidds_pre, _ = resolve_uidds_fn(mid, mname, days)
        foot_days, foot_period = _footfall_days_for_period(days, uidds_pre or None)
        days, foot_days, vh, sales_kind, foot_period = _coerce_aligned_calendar(
            mid, uidds_pre or None, days, foot_days, foot_period, vh, sales_kind
        )
        if uidds_pre and mid not in included_ids:
            fh, foot_meta, foot_res_period = _resolve_hourly_footfall_lists(
                session, uidds_pre, days, vl_cache=vl_cache
            )
            _annotate_footfall_period_meta(foot_meta, days, days, foot_res_period or foot_period)
            hours = _chart_hours_for_location(session, uidds_pre, fh, vh, days, foot_days, vl_cache)
            daily = _period_totals(fh, vh, days, foot_days, hours)
            _apply_sales_kind_to_daily(daily, sales_kind, requested_sales)
            sdisp = _sales_display_meta(sales_kind, days, requested_sales)
            ins = _insights(hours, mname)
            cmp_h, cmp_d, cmp_bd = _build_period_compare_bundle(
                session, mid, uidds_pre, compare_days_list, fetch_vends_fn, vend_cache, vl_cache
            )
            _append_location(
                _loc_payload(
                    mid, mname, owner or "MOH", days, period_key, "people_analytics",
                    "map", True, hours, daily, ins, foot_meta, fh, vh,
                    compare_hours=cmp_h, compare_daily=cmp_d, compare_days_breakdown=cmp_bd,
                    requested_sales_dates=requested_sales,
                    sales_data_kind=sales_kind,
                    sales_display=sdisp,
                )
            )
            continue
        uidds, map_src = resolve_uidds_fn(mid, mname, days)
        foot_days, foot_period = _footfall_days_for_period(days, uidds if uidds else None)
        days, foot_days, vh, sales_kind, foot_period = _coerce_aligned_calendar(
            mid, uidds if uidds else None, days, foot_days, foot_period, vh, sales_kind
        )
        if not uidds:
            uidds, map_src = resolve_uidds_fn(mid, mname, days)
        norm_mname = _norm_name(mname)
        config_mirror = mirror_map.get(norm_mname)
        loc_revenue = _vh_total_revenue(vh)
        mirror_name = find_moh_mirror_peer(
            mname,
            loc_revenue,
            config_mirror,
            meta_by_name,
            _moh_site_key,
            norm_mname,
        )
        mirror_hours = profile_by_name.get(mirror_name or "", []) if mirror_name else []
        if not mirror_hours or sum(row.get("footfall", 0) for row in mirror_hours) <= 0:
            gate_peer, gate_hours = _find_moh_gate_profile_hours(
                _moh_site_key(mname), profile_by_name, exclude_norm=norm_mname
            )
            if gate_hours and sum(row.get("footfall", 0) for row in gate_hours) > 0:
                mirror_name = gate_peer
                mirror_hours = gate_hours
        has_pa = bool(uidds)
        foot_meta: Dict[str, Any] = {"granularity": "mirror", "source": "mirror"}
        if has_pa:
            fh, foot_meta, foot_res_period = _resolve_hourly_footfall_lists(
                session, uidds, days, vl_cache=vl_cache
            )
            _annotate_footfall_period_meta(foot_meta, days, days, foot_res_period or foot_period)
        elif mirror_hours and sum(row.get("footfall", 0) for row in mirror_hours) > 0:
            fh = {i: [row["footfall"]] * len(days) for i, row in enumerate(mirror_hours)}
        elif mirror_name and mirror_name in name_to_machine:
            src_m = name_to_machine[mirror_name]
            src_mid = str(src_m.get("id") or "")
            src_mname = str(src_m.get("name") or "")
            src_uidds, src_map = resolve_uidds_fn(src_mid, src_mname, foot_days)
            if src_uidds:
                fh, foot_meta = _hourly_footfall_by_uidds(session, src_uidds, foot_days, vl_cache=vl_cache)
                foot_meta["source"] = f"mirror_from_{src_map}"
                empty_vh = {
                    h: [{"cups": 0.0, "revenue": 0.0}] * len(days) for h in range(24)
                }
                mirror_hours = _build_hourly_profile(
                    fh, empty_vh, len(days), BENCHMARK_CONVERSION_PCT
                )
            else:
                fh = {h: [0.0] * len(days) for h in range(24)}
        else:
            fh = {h: [0.0] * len(days) for h in range(24)}

        if has_pa:
            hours = _chart_hours_for_location(session, uidds, fh, vh, days, foot_days, vl_cache)
        else:
            hours = _hourly_profile_for_location(
                _empty_footfall_lists(len(days)), vh, days, foot_days
            )
        if mirror_hours and not has_pa:
            for i, row in enumerate(hours):
                if i < len(mirror_hours):
                    src = mirror_hours[i]
                    row["footfallMirror"] = {
                        "value": src["footfall"],
                        "color": "#5eb8e8",
                        "label": mirror_name,
                    }
                    row["footfall"] = src["footfall"]
                    row["conversionRatio"] = (
                        f"{int(round(src['footfall']))}:{int(round(row['cups']))}"
                    )
                    if src["footfall"] > 0:
                        row["conversionPct"] = round(row["cups"] / src["footfall"] * 100, 2)
                        row["revenuePerVisitorKd"] = round(row["revenueKd"] / src["footfall"], 4)
                    row["aspiredCups"] = round(src["footfall"] * BENCHMARK_CONVERSION_PCT / 100, 1)
                    row["upliftCups"] = round(max(0, row["aspiredCups"] - row["cups"]), 1)
                    avg_p = (row["revenueKd"] / row["cups"]) if row["cups"] > 0 else 0.5
                    row["upliftKd"] = round(row["upliftCups"] * avg_p, 3)

        if not foot_meta.get("footfallPeriodDates"):
            _annotate_footfall_period_meta(foot_meta, days, days, foot_period)
        daily = _period_totals(fh, vh, days, foot_days, hours)
        _apply_sales_kind_to_daily(daily, sales_kind, requested_sales)
        sdisp = _sales_display_meta(sales_kind, days, requested_sales)
        ins = _insights(hours, mname)
        mirror_display = None
        if mirror_name and not has_pa:
            src_loc = next((l for l in locations_out if _norm_name(l["locationName"]) == mirror_name), None)
            src_label = src_loc["locationName"] if src_loc else mirror_name
            mirror_display = {
                "text": f"Footfall & potential mirrored from {src_label}",
                "color": "#5eb8e8",
                "parenthetical": True,
            }

        cmp_h, cmp_d, cmp_bd = _build_period_compare_bundle(
            session, mid, uidds if uidds else None, compare_days_list, fetch_vends_fn, vend_cache, vl_cache
        )
        _append_location(
            _loc_payload(
                mid, mname, owner or "MOH", days, period_key, "moh_vendon",
                map_src if has_pa else "mirror", has_pa,
                hours, daily, ins, foot_meta, fh, vh,
                mirror_name=mirror_name, mirror_display=mirror_display,
                compare_hours=cmp_h, compare_daily=cmp_d, compare_days_breakdown=cmp_bd,
                requested_sales_dates=requested_sales,
                sales_data_kind=sales_kind,
                sales_display=sdisp,
            )
        )

    # Pass 3: O2 / Sultan / other in-scope machines with sales but no footfall map yet
    for m in machines:
        mid = str(m.get("id") or "")
        mname = str(m.get("name") or "")
        owner = m.get("location_owner") or m.get("owner_tag")
        if not mid or mid in included_ids or not _in_commercial_scope(mname, owner):
            continue
        if _is_moh_machine(mname, owner):
            continue
        days, period_key, sales_kind, requested_sales, vh = _resolve_sales_days(mid)
        if _vh_total_cups(vh) <= 0:
            continue
        uidds, map_src = resolve_uidds_fn(mid, mname, days)
        if not uidds and videoloft_cameras:
            frags = name_camera_map.get(_norm_name(mname)) or []
            if frags:
                from alert_routes import _uidds_from_mapping_entry

                uidds = _uidds_from_mapping_entry(videoloft_cameras, {"cameraNames": frags})
                if uidds:
                    map_src = "commercial_name_map"
        foot_days, foot_period = _footfall_days_for_period(days, uidds if uidds else None)
        days, foot_days, vh, sales_kind, foot_period = _coerce_aligned_calendar(
            mid, uidds if uidds else None, days, foot_days, foot_period, vh, sales_kind
        )
        if uidds:
            fh, foot_meta, foot_res_period = _resolve_hourly_footfall_lists(
                session, uidds, days, vl_cache=vl_cache
            )
            _annotate_footfall_period_meta(foot_meta, days, days, foot_res_period or foot_period)
        else:
            fh = {h: [0.0] * len(days) for h in range(24)}
            foot_meta = {"granularity": "none", "source": "no_camera_map", "uiddCount": 0}
            _annotate_footfall_period_meta(foot_meta, days, days, foot_period)
        if uidds:
            hours = _chart_hours_for_location(session, uidds, fh, vh, days, foot_days, vl_cache)
        else:
            hours = _hourly_profile_for_location(
                _empty_footfall_lists(len(days)), vh, days, foot_days
            )
        daily = _period_totals(fh, vh, days, foot_days, hours)
        _apply_sales_kind_to_daily(daily, sales_kind, requested_sales)
        sdisp = _sales_display_meta(sales_kind, days, requested_sales)
        ins = _insights(hours, mname)
        cmp_h, cmp_d, cmp_bd = _build_period_compare_bundle(
            session, mid, uidds if uidds else None, compare_days_list, fetch_vends_fn, vend_cache, vl_cache
        )
        _append_location(
            _loc_payload(
                mid, mname, owner, days, period_key, "vendon_sales",
                map_src if uidds else "none", bool(uidds),
                hours, daily, ins, foot_meta, fh, vh,
                compare_hours=cmp_h, compare_daily=cmp_d, compare_days_breakdown=cmp_bd,
                requested_sales_dates=requested_sales,
                sales_data_kind=sales_kind,
                sales_display=sdisp,
            )
        )

    # Pass 4: KU fleet (Vendon sales; projected footfall from KU segment profile)
    for m in machines:
        mid = str(m.get("id") or "")
        mname = str(m.get("name") or "")
        owner = m.get("location_owner") or m.get("owner_tag")
        if not mid or mid in included_ids or not _is_ku_location(mname, owner):
            continue
        days, period_key, sales_kind, requested_sales, vh = _resolve_sales_days(mid)
        if _vh_total_cups(vh) <= 0:
            continue
        foot_days = list(days)
        fh = {h: [0.0] * len(foot_days) for h in range(24)}
        foot_meta = {
            "granularity": "none",
            "source": "ku_projected",
            "uiddCount": 0,
            "footfallPeriodDates": foot_days,
        }
        _annotate_footfall_period_meta(foot_meta, days, days, "mirror_sales_calendar")
        hours = _hourly_profile_for_location(fh, vh, days, days)
        daily = _period_totals(fh, vh, days, foot_days, hours)
        _apply_sales_kind_to_daily(daily, sales_kind, requested_sales)
        sdisp = _sales_display_meta(sales_kind, days, requested_sales)
        ins = _insights(hours, mname)
        _append_location(
            _loc_payload(
                mid,
                mname,
                owner or "KU",
                days,
                period_key,
                "ku_vendon",
                "none",
                False,
                hours,
                daily,
                ins,
                foot_meta,
                fh,
                vh,
                requested_sales_dates=requested_sales,
                sales_data_kind=sales_kind,
                sales_display=sdisp,
            )
        )

    _apply_moh_gate_footfall_peers(locations_out, BENCHMARK_CONVERSION_PCT)

    from commercial_footfall_projection import apply_projected_footfall_and_targets

    apply_projected_footfall_and_targets(
        locations_out,
        _owner_segment,
        _footfall_display_meta,
        BENCHMARK_CONVERSION_PCT,
    )

    for loc in locations_out:
        _refresh_location_metrics_from_hours(loc, BENCHMARK_CONVERSION_PCT)

    result = {
        "generatedAt": datetime.now(tz=TZ).isoformat(),
        "benchmarkConversionPct": BENCHMARK_CONVERSION_PCT,
        "primaryPeriod": primary_days,
        "fallbackPeriod": fallback_days,
        "comparePeriod": compare_days_list or None,
        "currency": "KD",
        "locations": locations_out,
        "locationCount": len(locations_out),
        "reportPayloadVersion": REPORT_PAYLOAD_VERSION,
    }

    result["rankings"] = _build_commercial_rankings(locations_out)
    return finalize_commercial_report_payload(result)
