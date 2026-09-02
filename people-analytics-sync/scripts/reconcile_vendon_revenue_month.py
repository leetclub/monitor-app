#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from datetime import date, timedelta

from vendon_proxy_routes import _reconcile_revenue_cache

y = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
m = int(sys.argv[2]) if len(sys.argv) > 2 else 4
import calendar

d0 = date(y, m, 1)
d1 = date(y, m, calendar.monthrange(y, m)[1])
dates = []
cur = d0
while cur <= d1:
    dates.append(cur.isoformat())
    cur += timedelta(days=1)
res = _reconcile_revenue_cache(max_days=len(dates), newest_first=False, dates=dates)
print(
    json.dumps(
        {
            "window": f"{d0}..{d1}",
            "ok": res.get("ok"),
            "status": res.get("status"),
            "checkedDays": res.get("checkedDays"),
            "driftDaysFound": res.get("driftDaysFound"),
            "absDeltaKwdMax": res.get("absDeltaKwdMax"),
            "refreshed": res.get("refreshed"),
            "failed": res.get("failed"),
        },
        indent=2,
        default=str,
    ),
    flush=True,
)
raise SystemExit(0 if res.get("ok") else 1)
