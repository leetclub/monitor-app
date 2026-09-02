#!/usr/bin/env python3
"""
Backfill / reconcile vendon_daily_machine_revenue_cache for YTD/LY windows
(and optionally an explicit from/to). Uses the same fleet-fetch refresh as the API.

Vendon live customer sales (excl. WEB_CASHLESS) is the source of truth.

Env:
  VENDON_API_KEY, VENDON_API_BASE
  DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD (or DATABASE_URL via get_database_url)
  BACKFILL_FROM=2025-01-01  BACKFILL_TO=yesterday (optional)
  BACKFILL_MAX_DAYS=0  (0 = all missing / all reconcile candidates)
  RECONCILE=1  — compare live vs cache and refresh drifted days (not only missing)
  FORCE_REFRESH=1 — with FROM/TO, refresh every day in range (ignore match)
"""
from __future__ import annotations

import logging
import os
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("backfill_revenue_cache")


def _truthy(name: str) -> bool:
    return str(os.environ.get(name) or "").strip().lower() in ("1", "true", "yes", "on")


def main() -> int:
    from vendon_proxy_routes import (
        _fill_revenue_cache_gaps,
        _list_missing_revenue_cache_dates,
        _reconcile_revenue_cache,
        _refresh_revenue_cache_single_day,
        _ytd_ly_gap_windows,
    )

    tz = ZoneInfo("Asia/Kuwait")
    today = datetime.now(tz).date()
    yday = today - timedelta(days=1)

    from_s = (os.environ.get("BACKFILL_FROM") or "").strip()
    to_s = (os.environ.get("BACKFILL_TO") or "").strip()
    max_raw = (os.environ.get("BACKFILL_MAX_DAYS") or "0").strip()
    try:
        max_days = int(max_raw)
    except ValueError:
        max_days = 0

    reconcile = _truthy("RECONCILE")
    force_refresh = _truthy("FORCE_REFRESH")

    if reconcile:
        dates = None
        if from_s and to_s:
            d0 = datetime.strptime(from_s, "%Y-%m-%d").date()
            d1 = datetime.strptime(to_s, "%Y-%m-%d").date()
            dates = []
            cur = d0
            while cur <= d1:
                dates.append(cur.isoformat())
                cur += timedelta(days=1)
        cap = max_days if max_days > 0 else (len(dates) if dates else 400)
        log.info("reconcile mode max_days=%s dates=%s", cap, len(dates) if dates else "ytd+ly")
        res = _reconcile_revenue_cache(max_days=cap, newest_first=True, dates=dates)
        log.info(
            "reconcile status=%s checked=%s drift=%s refreshed=%s failed=%s absDeltaMax=%s",
            res.get("status"),
            res.get("checkedDays"),
            res.get("driftDaysFound"),
            len(res.get("refreshed") or []),
            len(res.get("failed") or []),
            res.get("absDeltaKwdMax"),
        )
        for row in res.get("refreshed") or []:
            log.info("  refreshed %s", row)
        for row in res.get("failed") or []:
            log.error("  failed %s", row)
        return 0 if res.get("ok") else 1

    if force_refresh and from_s and to_s:
        d0 = datetime.strptime(from_s, "%Y-%m-%d").date()
        d1 = datetime.strptime(to_s, "%Y-%m-%d").date()
        days = []
        cur = d0
        while cur <= d1:
            days.append(cur.isoformat())
            cur += timedelta(days=1)
        if max_days > 0:
            days = days[:max_days]
        ok_n = fail_n = 0
        for i, ds in enumerate(days, 1):
            log.info("[%s/%s] force refresh %s", i, len(days), ds)
            res = _refresh_revenue_cache_single_day(ds, fleet_fetch=True)
            if res.get("ok"):
                ok_n += 1
            else:
                fail_n += 1
                log.error("  FAIL %s", res.get("error"))
        log.info("force done ok=%s fail=%s", ok_n, fail_n)
        return 0 if fail_n == 0 else 1

    if from_s and to_s:
        d0 = datetime.strptime(from_s, "%Y-%m-%d").date()
        d1 = datetime.strptime(to_s, "%Y-%m-%d").date()
        missing = _list_missing_revenue_cache_dates(d0, d1)
        log.info("explicit window %s..%s missing=%s", d0, d1, len(missing))
    else:
        missing = []
        seen = set()
        for a, b in _ytd_ly_gap_windows(today):
            for ds in _list_missing_revenue_cache_dates(a, b):
                if ds not in seen:
                    seen.add(ds)
                    missing.append(ds)
        log.info("YTD+LY windows missing=%s", len(missing))

    missing = sorted(missing)
    if max_days > 0:
        missing = missing[:max_days]

    ok_n = fail_n = 0
    for i, ds in enumerate(missing, 1):
        log.info("[%s/%s] refreshing %s", i, len(missing), ds)
        res = _refresh_revenue_cache_single_day(ds, fleet_fetch=True)
        if res.get("ok"):
            ok_n += 1
            log.info("  ok inserted=%s", res.get("inserted"))
        else:
            fail_n += 1
            log.error("  FAIL %s", res.get("error"))

    # Final gap report for YTD/LY
    left = 0
    for a, b in _ytd_ly_gap_windows(today):
        left += len(_list_missing_revenue_cache_dates(a, b))
    log.info("done ok=%s fail=%s ytd_ly_gaps_remaining=%s", ok_n, fail_n, left)
    return 0 if fail_n == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
