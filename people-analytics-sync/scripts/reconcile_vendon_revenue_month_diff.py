#!/usr/bin/env python3
"""
Month-by-month live Vendon customer sales vs revenue cache.

Source of truth: live /stats/vends with payment_method != WEB_CASHLESS.
Prints per-month delta so operators know which months to force-refresh.

Env:
  VENDON_API_KEY, VENDON_API_BASE
  DB_* / DATABASE_URL (same as people-api)
  DIFF_YEAR=2026 (default: Kuwait current year)
  DIFF_THROUGH=YYYY-MM-DD (default: yesterday Kuwait)
  LIVE_ONLY=1 to skip DB (print live only)
"""
from __future__ import annotations

import calendar
import logging
import os
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("month_diff")

API_BASE = os.environ.get("VENDON_API_BASE", "https://cloud.vendon.net/rest/v1.9.0").rstrip("/")
API_KEY = os.environ.get("VENDON_API_KEY") or ""
H = {"Authorization": f"Token {API_KEY}", "Accept": "application/json"}
TZ = ZoneInfo("Asia/Kuwait")
LIMIT = 5000
TOL = 0.05


def _bounds(d0: date, d1: date) -> Tuple[int, int]:
    a = datetime(d0.year, d0.month, d0.day, 0, 0, 0, tzinfo=TZ)
    b = datetime(d1.year, d1.month, d1.day, 23, 59, 59, tzinfo=TZ)
    return int(a.timestamp()), int(b.timestamp())


def _fetch_page(frm: int, to: int, offset: int) -> dict:
    last_err: Optional[str] = None
    for attempt in range(14):
        try:
            r = requests.get(
                f"{API_BASE}/stats/vends",
                headers=H,
                params={
                    "from_timestamp": frm,
                    "to_timestamp": to,
                    "limit": LIMIT,
                    "offset": offset,
                },
                timeout=180,
            )
            if r.status_code in (400, 429, 500, 502, 503, 504):
                time.sleep(2.0 + attempt * 1.5)
                last_err = f"HTTP {r.status_code}"
                continue
            r.raise_for_status()
            data = r.json()
            if data.get("code") != 200:
                time.sleep(2.0 + attempt)
                last_err = f"code={data.get('code')}"
                continue
            return data
        except Exception as ex:
            last_err = str(ex)
            time.sleep(2.0 + attempt)
    raise RuntimeError(f"page failed {frm}..{to}@{offset}: {last_err}")


def live_customer_sum(d0: date, d1: date) -> float:
    total = 0.0
    cur = d0
    while cur <= d1:
        chunk_end = min(cur + timedelta(days=6), d1)
        frm, to = _bounds(cur, chunk_end)
        offset = 0
        while True:
            data = _fetch_page(frm, to, offset)
            rows = data.get("result") or []
            for v in rows:
                method = str(v.get("payment_method") or "").strip().upper()
                if method == "WEB_CASHLESS":
                    continue
                try:
                    total += float(v.get("price") or 0)
                except Exception:
                    pass
            log.info("%s..%s off=%s rows=%s cust=%.1f", cur, chunk_end, offset, len(rows), total)
            if len(rows) < LIMIT:
                break
            offset += LIMIT
            time.sleep(0.12)
        cur = chunk_end + timedelta(days=1)
    return round(total, 3)


def cache_month_sums(d0: date, d1: date) -> Dict[Tuple[int, int], float]:
    from sqlalchemy import func
    from models import VendonDailyMachineRevenueCache
    from api_service import SessionLocal

    try:
        from alert_routes import _pa_session

        sess = _pa_session()
    except Exception:
        sess = SessionLocal()
    out: Dict[Tuple[int, int], float] = {}
    try:
        rows = (
            sess.query(
                VendonDailyMachineRevenueCache.cache_date,
                func.sum(VendonDailyMachineRevenueCache.total_sales_kwd),
            )
            .filter(
                VendonDailyMachineRevenueCache.cache_date >= d0,
                VendonDailyMachineRevenueCache.cache_date <= d1,
            )
            .group_by(VendonDailyMachineRevenueCache.cache_date)
            .all()
        )
        for day, tot in rows:
            key = (day.year, day.month)
            out[key] = round(float(out.get(key, 0.0)) + float(tot or 0), 3)
    finally:
        sess.close()
    return out


def month_windows(year: int, through: date) -> List[Tuple[date, date, Tuple[int, int]]]:
    wins: List[Tuple[date, date, Tuple[int, int]]] = []
    for m in range(1, 13):
        start = date(year, m, 1)
        if start > through:
            break
        end = date(year, m, calendar.monthrange(year, m)[1])
        if end > through:
            end = through
        wins.append((start, end, (year, m)))
    return wins


def main() -> int:
    if not API_KEY:
        log.error("VENDON_API_KEY required")
        return 2
    today = datetime.now(TZ).date()
    year = int(os.environ.get("DIFF_YEAR") or today.year)
    through_s = (os.environ.get("DIFF_THROUGH") or "").strip()
    through = datetime.strptime(through_s, "%Y-%m-%d").date() if through_s else today - timedelta(days=1)
    live_only = str(os.environ.get("LIVE_ONLY") or "").strip().lower() in ("1", "true", "yes")

    cache_by_m: Dict[Tuple[int, int], float] = {}
    if not live_only:
        d0 = date(year, 1, 1)
        cache_by_m = cache_month_sums(d0, through)
        log.info("cache months loaded: %s", sorted(cache_by_m.keys()))

    bad: List[str] = []
    live_ytd = 0.0
    cache_ytd = 0.0
    print(f"# month diff year={year} through={through} tol={TOL}", flush=True)
    print("month\tlive\tcache\tdelta\tstatus", flush=True)
    for start, end, key in month_windows(year, through):
        live = live_customer_sum(start, end)
        cache = float(cache_by_m.get(key, 0.0)) if not live_only else float("nan")
        live_ytd += live
        if not live_only:
            cache_ytd += cache
            delta = round(live - cache, 3)
            status = "OK" if abs(delta) <= TOL else "DRIFT"
            if status == "DRIFT":
                bad.append(f"{key[0]}-{key[1]:02d}")
            print(f"{key[0]}-{key[1]:02d}\t{live:.3f}\t{cache:.3f}\t{delta:.3f}\t{status}", flush=True)
        else:
            print(f"{key[0]}-{key[1]:02d}\t{live:.3f}\t\t\tLIVE", flush=True)

    if not live_only:
        print(
            f"YTD\t{round(live_ytd, 3):.3f}\t{round(cache_ytd, 3):.3f}\t"
            f"{round(live_ytd - cache_ytd, 3):.3f}\t"
            f"{'OK' if abs(live_ytd - cache_ytd) <= TOL else 'DRIFT'}",
            flush=True,
        )
        if bad:
            print(f"BAD_MONTHS={','.join(bad)}", flush=True)
            print(
                "Hint: RECONCILE=1 BACKFILL_FROM=<month-start> BACKFILL_TO=<month-end> "
                "python scripts/backfill_vendon_revenue_cache.py",
                flush=True,
            )
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
