#!/usr/bin/env python3
"""
Full audit: vendon_daily_machine_revenue_cache vs live Vendon customer sales.

Vendon is source of truth (payment_method != WEB_CASHLESS).
Walks every calendar day in [FROM, TO] in week chunks (OOM-safe).

Env / args:
  AUDIT_FROM=2025-01-01
  AUDIT_TO=2026-09-01          (default: Kuwait yesterday)
  AUDIT_FIX=1                  refresh drifted/missing days
  AUDIT_TOLERANCE=0.05
  AUDIT_REPORT=/tmp/vendon_cache_audit.json

Usage (in people-api pod):
  PYTHONPATH=/app python3 scripts/audit_vendon_revenue_cache.py
  PYTHONPATH=/app python3 scripts/audit_vendon_revenue_cache.py --fix
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("audit_revenue_cache")

TZ = ZoneInfo("Asia/Kuwait")
DEFAULT_TOL = 0.05


def _parse_day(s: str) -> date:
    return datetime.strptime(s.strip(), "%Y-%m-%d").date()


def _week_chunks(d0: date, d1: date) -> List[Tuple[date, date]]:
    out: List[Tuple[date, date]] = []
    cur = d0
    while cur <= d1:
        end = min(cur + timedelta(days=6), d1)
        out.append((cur, end))
        cur = end + timedelta(days=1)
    return out


def main() -> int:
    from vendon_proxy_routes import (
        REVENUE_CACHE_RECONCILE_TOLERANCE_KWD,
        _cache_day_customer_sum,
        _live_day_customer_sum,
        _list_missing_revenue_cache_dates,
        _refresh_revenue_cache_single_day,
    )

    today = datetime.now(TZ).date()
    yday = today - timedelta(days=1)

    ap = argparse.ArgumentParser(description="Audit revenue cache vs live Vendon")
    ap.add_argument("--from", dest="d_from", default=os.environ.get("AUDIT_FROM") or "2025-01-01")
    ap.add_argument("--to", dest="d_to", default=os.environ.get("AUDIT_TO") or yday.isoformat())
    ap.add_argument("--fix", action="store_true", default=str(os.environ.get("AUDIT_FIX") or "").lower() in ("1", "true", "yes"))
    ap.add_argument("--tolerance", type=float, default=float(os.environ.get("AUDIT_TOLERANCE") or DEFAULT_TOL or REVENUE_CACHE_RECONCILE_TOLERANCE_KWD))
    ap.add_argument("--report", default=os.environ.get("AUDIT_REPORT") or "/tmp/vendon_cache_audit.json")
    args = ap.parse_args()

    d0 = _parse_day(args.d_from)
    d1 = _parse_day(args.d_to)
    if d0 > d1:
        log.error("from > to")
        return 2
    tol = max(0.0, float(args.tolerance))
    do_fix = bool(args.fix)

    missing = _list_missing_revenue_cache_dates(d0, d1)
    report: Dict[str, Any] = {
        "startedAt": datetime.now(timezone_utc()).isoformat(),
        "from": d0.isoformat(),
        "to": d1.isoformat(),
        "toleranceKwd": tol,
        "fix": do_fix,
        "missingDaysBefore": missing,
        "matched": [],
        "drifted": [],
        "missing": [],
        "liveErrors": [],
        "refreshed": [],
        "refreshFailed": [],
        "monthSummary": {},
    }

    checked = 0
    abs_delta_max = 0.0
    live_sum = 0.0
    cache_sum = 0.0

    for w0, w1 in _week_chunks(d0, d1):
        log.info("week %s..%s", w0, w1)
        cur = w0
        while cur <= w1:
            ds = cur.isoformat()
            ym = f"{cur.year}-{cur.month:02d}"
            month = report["monthSummary"].setdefault(
                ym, {"days": 0, "matched": 0, "drifted": 0, "missing": 0, "liveKd": 0.0, "cacheKd": 0.0, "deltaKd": 0.0}
            )
            cache_v = _cache_day_customer_sum(cur)
            live_v, live_err = _live_day_customer_sum(ds)
            checked += 1
            month["days"] += 1

            if live_err or live_v is None:
                report["liveErrors"].append({"date": ds, "error": live_err or "none"})
                log.error("live fail %s: %s", ds, live_err)
                cur += timedelta(days=1)
                continue

            live_sum += float(live_v)
            month["liveKd"] = round(month["liveKd"] + float(live_v), 4)

            if cache_v is None:
                delta = float(live_v)
                abs_delta_max = max(abs_delta_max, abs(delta))
                report["missing"].append({"date": ds, "live": live_v})
                month["missing"] += 1
                month["deltaKd"] = round(month["deltaKd"] + delta, 4)
                needs = True
                reason = "missing"
            else:
                cache_sum += float(cache_v)
                month["cacheKd"] = round(month["cacheKd"] + float(cache_v), 4)
                delta = round(float(live_v) - float(cache_v), 4)
                abs_delta_max = max(abs_delta_max, abs(delta))
                month["deltaKd"] = round(month["deltaKd"] + delta, 4)
                if abs(delta) <= tol:
                    report["matched"].append({"date": ds, "live": live_v, "cache": cache_v, "delta": delta})
                    month["matched"] += 1
                    needs = False
                    reason = "ok"
                else:
                    report["drifted"].append(
                        {"date": ds, "live": live_v, "cache": cache_v, "delta": delta}
                    )
                    month["drifted"] += 1
                    needs = True
                    reason = "drift"

            if needs and do_fix:
                res = _refresh_revenue_cache_single_day(ds, fleet_fetch=True)
                if res.get("ok"):
                    report["refreshed"].append({"date": ds, "reason": reason, "deltaBefore": delta, "live": live_v})
                    log.info("refreshed %s (%s delta=%s)", ds, reason, delta)
                else:
                    report["refreshFailed"].append({"date": ds, "error": res.get("error"), "reason": reason})
                    log.error("refresh fail %s: %s", ds, res.get("error"))
            elif needs:
                log.warning("%s %s live=%s cache=%s delta=%s", reason, ds, live_v, cache_v, delta)

            cur += timedelta(days=1)

        # Persist partial report after each week so crashes don't lose progress.
        _write_report(args.report, report, checked, live_sum, cache_sum, abs_delta_max, done=False)

    report["finishedAt"] = datetime.now(timezone_utc()).isoformat()
    report["checkedDays"] = checked
    report["liveTotalKd"] = round(live_sum, 3)
    report["cacheTotalKd"] = round(cache_sum, 3)
    report["deltaTotalKd"] = round(live_sum - cache_sum, 3)
    report["absDeltaKwdMax"] = round(abs_delta_max, 4)
    report["matchedDays"] = len(report["matched"])
    report["driftedDays"] = len(report["drifted"])
    report["missingDays"] = len(report["missing"])
    report["liveErrorDays"] = len(report["liveErrors"])
    report["refreshedDays"] = len(report["refreshed"])
    # Keep matched list short in final report (full list already huge); keep drifted/missing full.
    if len(report["matched"]) > 50:
        report["matchedSample"] = report["matched"][:20] + report["matched"][-20:]
        report["matched"] = []  # counts retained above
    _write_report(args.report, report, checked, live_sum, cache_sum, abs_delta_max, done=True)

    print(
        json.dumps(
            {
                "from": report["from"],
                "to": report["to"],
                "checkedDays": checked,
                "matchedDays": report["matchedDays"],
                "driftedDays": report["driftedDays"],
                "missingDays": report["missingDays"],
                "liveErrorDays": report["liveErrorDays"],
                "refreshedDays": report["refreshedDays"],
                "liveTotalKd": report["liveTotalKd"],
                "cacheTotalKd": report["cacheTotalKd"],
                "deltaTotalKd": report["deltaTotalKd"],
                "absDeltaKwdMax": report["absDeltaKwdMax"],
                "report": args.report,
                "monthSummary": report["monthSummary"],
            },
            indent=2,
        ),
        flush=True,
    )
    bad = report["driftedDays"] + report["missingDays"] + report["liveErrorDays"] + len(report["refreshFailed"])
    return 1 if bad else 0


def timezone_utc():
    from datetime import timezone

    return timezone.utc


def _write_report(
    path: str,
    report: Dict[str, Any],
    checked: int,
    live_sum: float,
    cache_sum: float,
    abs_delta_max: float,
    *,
    done: bool,
) -> None:
    payload = dict(report)
    payload["checkedDays"] = checked
    payload["liveTotalKdSoFar"] = round(live_sum, 3)
    payload["cacheTotalKdSoFar"] = round(cache_sum, 3)
    payload["deltaTotalKdSoFar"] = round(live_sum - cache_sum, 3)
    payload["absDeltaKwdMax"] = round(abs_delta_max, 4)
    payload["done"] = done
    Path(path).write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    log.info("wrote %s (checked=%s done=%s)", path, checked, done)


if __name__ == "__main__":
    raise SystemExit(main())
