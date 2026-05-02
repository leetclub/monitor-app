#!/usr/bin/env python3
"""
Golden verification script:
Compare ONE request against:
  1) Your deployed API (DB-backed): GET /api/people-analytics
  2) Videoloft analytics endpoint:  POST https://euwest1-analytics.manything.com/people

It prints totals (in/out) and per-bucket diffs (by time bucket) for a single camera (uidd).

Usage:
  python3 people-analytics-sync/compare_api_videoloft.py \
    --uidd 1382465.8 \
    --start 2026-01-13 \
    --end 2026-01-13 \
    --interval hour

Intervals:
  - date
  - hour  (sent to Videoloft as 3600000)
  - 60000 (sent to Videoloft as 60000)
"""

import argparse
import os
from datetime import datetime
from typing import Dict, List, Tuple, Optional
from zoneinfo import ZoneInfo

import requests

def videoloft_authenticate() -> str:
    """
    Authenticate to Videoloft/Manything and return auth token.
    This is intentionally self-contained so the script does NOT depend on project Python deps.
    """
    email = os.getenv("VIDEOLOFT_EMAIL")
    username = os.getenv("VIDEOLOFT_USERNAME")
    password = os.getenv("VIDEOLOFT_PASSWORD")
    if not password or not (email or username):
        raise RuntimeError("Set VIDEOLOFT_PASSWORD and either VIDEOLOFT_EMAIL or VIDEOLOFT_USERNAME in env")

    login_url = "https://auth1.manything.com/login"
    payload = {"email": email or username, "password": password}

    r = requests.post(login_url, json=payload, timeout=30, allow_redirects=False)
    # Manything sometimes redirects to region auth endpoint (via HTTP redirect or JSON body {location: ...}).
    if r.status_code in (301, 302, 307, 308) and r.headers.get("Location"):
        r = requests.post(r.headers["Location"], json=payload, timeout=30, allow_redirects=False)

    if r.status_code != 200:
        raise RuntimeError(f"Videoloft login failed: {r.status_code} {r.text}")

    data = r.json()
    # Sometimes the first 200 response is just a region redirect hint.
    # Example: {"location": "https://euwest1-auth-1.manything.com"}
    if not (data.get("authToken") or data.get("token")) and data.get("location"):
        region_base = data["location"].rstrip("/")
        r = requests.post(f"{region_base}/login", json=payload, timeout=30)
        if r.status_code != 200:
            raise RuntimeError(f"Videoloft region login failed: {r.status_code} {r.text}")
        data = r.json()

    token = (
        data.get("authToken")
        or data.get("token")
        or (data.get("result") or {}).get("authToken")
        or ((data.get("result") or {}).get("webLogin") or {}).get("loginToken")
    )
    if not token:
        raise RuntimeError(f"Videoloft login response missing token: {data}")
    return token


def videoloft_fetch_people_analytics(
    token: str,
    uidd: str,
    start_ms: int,
    end_ms: int,
    interval: str,
    tz: str,
) -> List[Dict]:
    # Convert interval to Videoloft accepted format: "date" or number (ms)
    api_interval: object = interval
    if interval == "hour":
        api_interval = 3600000
    elif interval in ("60000", "minute"):
        api_interval = 60000

    url = "https://euwest1-analytics.manything.com/people"
    payload = {
        "uidds": [uidd],
        "startTime": start_ms,
        "endTime": end_ms,
        "interval": api_interval,
        "timeZone": tz,
    }
    r = requests.post(
        url,
        json=payload,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": f"ManythingToken {token}",
        },
        timeout=60,
    )
    if r.status_code != 200:
        raise RuntimeError(f"Videoloft people analytics failed: {r.status_code} {r.text}")
    data = r.json()
    if not isinstance(data, list):
        raise RuntimeError(f"Unexpected Videoloft payload type: {type(data)}")
    return data


def _parse_date(d: str) -> datetime:
    return datetime.strptime(d, "%Y-%m-%d")


def _bucket_key(rec: Dict) -> str:
    # Use firstTimestamp as the bucket key (seconds or ms); normalize to seconds.
    ts = rec.get("firstTimestamp")
    if ts is None:
        return "no-firstTimestamp"
    if isinstance(ts, (int, float)) and ts > 1e12:
        ts = int(ts // 1000)
    return str(int(ts))


def fetch_from_api(api_base: str, uidd: str, start: str, end: str, interval: str) -> Tuple[Dict, List[Dict]]:
    url = f"{api_base.rstrip('/')}/api/people-analytics"
    params = {
        "uidds": uidd,
        "start_date": start,
        "end_date": end,
        "interval": interval,
        "limit": "10000",
    }
    r = requests.get(url, params=params, timeout=60)
    r.raise_for_status()
    body = r.json()
    if not body.get("success"):
        raise RuntimeError(f"API returned success=false: {body}")

    # Convert API records to Videoloft-like shape for comparison.
    api_recs: List[Dict] = []
    for rec in body.get("data", []):
        first_dt = datetime.fromisoformat(rec["first_timestamp"])
        last_dt = datetime.fromisoformat(rec["last_timestamp"])
        api_recs.append(
            {
                "firstTimestamp": int(first_dt.timestamp()),
                "lastTimestamp": int(last_dt.timestamp()),
                "in": rec.get("in", 0),
                "out": rec.get("out", 0),
                "uidd": rec.get("uidd"),
            }
        )

    summary = body.get("summary") or {}
    return summary, api_recs


def fetch_from_videoloft(uidd: str, start: str, end: str, interval: str, tz: str) -> List[Dict]:
    # Interpret YYYY-MM-DD in the requested timezone (default Asia/Kuwait) before converting to epoch ms.
    tzinfo = ZoneInfo(tz)
    start_dt = _parse_date(start).replace(tzinfo=tzinfo)
    end_dt = _parse_date(end).replace(hour=23, minute=59, second=59, tzinfo=tzinfo)
    start_ms = int(start_dt.timestamp() * 1000)
    end_ms = int(end_dt.timestamp() * 1000)
    token = videoloft_authenticate()
    return videoloft_fetch_people_analytics(token, uidd, start_ms, end_ms, interval, tz)


def totals(recs: List[Dict]) -> Tuple[int, int]:
    total_in = sum(int(r.get("in", 0) or 0) for r in recs)
    total_out = sum(int(r.get("out", 0) or 0) for r in recs)
    return total_in, total_out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--uidd", required=True, help="Camera uidd, e.g. 1382465.8")
    ap.add_argument("--start", required=True, help="YYYY-MM-DD")
    ap.add_argument("--end", required=True, help="YYYY-MM-DD")
    ap.add_argument("--interval", required=True, choices=["date", "hour", "60000"], help="Interval to compare")
    ap.add_argument("--api-base", default=os.getenv("PEOPLE_ANALYTICS_API_BASE", "https://people-api.theleetclub.com"))
    ap.add_argument("--timezone", default=os.getenv("TIMEZONE", "Asia/Kuwait"))
    args = ap.parse_args()

    print("=== Request ===")
    print(f"uidd: {args.uidd}")
    print(f"start: {args.start}")
    print(f"end: {args.end}")
    print(f"interval: {args.interval}")
    print(f"api_base: {args.api_base}")
    print(f"timezone: {args.timezone}")
    print()

    api_summary, api_recs = fetch_from_api(args.api_base, args.uidd, args.start, args.end, args.interval)
    vl_recs = fetch_from_videoloft(args.uidd, args.start, args.end, args.interval, args.timezone)

    api_in, api_out = totals(api_recs)
    vl_in, vl_out = totals(vl_recs)

    print("=== Totals ===")
    print(f"API (DB):      in={api_in} out={api_out} records={len(api_recs)}")
    print(f"Videoloft:     in={vl_in} out={vl_out} records={len(vl_recs)}")
    if api_in == vl_in and api_out == vl_out:
        print("✅ Totals match")
    else:
        print("❌ Totals differ")
    print()

    # Per-bucket compare
    api_map = {_bucket_key(r): r for r in api_recs}
    vl_map = {_bucket_key(r): r for r in vl_recs}
    keys = sorted(set(api_map.keys()) | set(vl_map.keys()))

    diffs = []
    for k in keys:
        a = api_map.get(k)
        v = vl_map.get(k)
        if a and v:
            if int(a.get("in", 0) or 0) != int(v.get("in", 0) or 0) or int(a.get("out", 0) or 0) != int(v.get("out", 0) or 0):
                diffs.append((k, a, v))
        elif v and not a:
            diffs.append((k, None, v))
        elif a and not v:
            diffs.append((k, a, None))

    print("=== Bucket diffs (first 20) ===")
    if not diffs:
        print("✅ No per-bucket diffs")
    else:
        for k, a, v in diffs[:20]:
            if a is None:
                print(f"- {k}: missing in API, videoloft in={v.get('in')} out={v.get('out')}")
            elif v is None:
                print(f"- {k}: extra in API, api in={a.get('in')} out={a.get('out')}")
            else:
                print(f"- {k}: api in={a.get('in')} out={a.get('out')} | videoloft in={v.get('in')} out={v.get('out')}")

    print()
    print("=== API summary (FYI) ===")
    print(api_summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


