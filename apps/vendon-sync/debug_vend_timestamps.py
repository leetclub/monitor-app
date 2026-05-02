#!/usr/bin/env python3
"""
Debug: Find exact timestamp boundaries Vendon uses for 2026-01-16
so we can match 4.8 KWD (5 vends) exactly.
Set VENDON_API_KEY in env if not using a default.
"""
import os
import requests
from datetime import datetime, timezone, timedelta

VENDON_API_KEY = os.environ.get("VENDON_API_KEY", "")
VENDON_API_BASE = "https://cloud.vendon.net/rest/v1.9.0"
MACHINE_ID = "393033"

def fetch_vends(from_ts, to_ts):
    url = f"{VENDON_API_BASE}/stats/vends"
    params = {"from_timestamp": from_ts, "to_timestamp": to_ts, "machine_id": MACHINE_ID, "limit": 10000}
    r = requests.get(url, headers={"Authorization": f"Token {VENDON_API_KEY}"}, params=params, timeout=30)
    if r.status_code != 200:
        return []
    d = r.json()
    if d.get("code") != 200:
        return []
    return d.get("result", [])

def main():
    if not VENDON_API_KEY:
        print("Set VENDON_API_KEY in the environment.")
        return
    # 2026-01-16 in various interpretations
    date_str = "2026-01-16"
    
    # 1) UTC midnight to midnight
    start_utc = datetime(2026, 1, 16, 0, 0, 0, tzinfo=timezone.utc)
    end_utc = datetime(2026, 1, 16, 23, 59, 59, 999999, tzinfo=timezone.utc)
    from_utc = int(start_utc.timestamp())
    to_utc = int(end_utc.timestamp())
    
    # 2) Kuwait (UTC+3): 2026-01-16 00:00 Kuwait = 2026-01-15 21:00 UTC
    #    2026-01-16 23:59:59 Kuwait = 2026-01-16 20:59:59 UTC
    start_kuwait = datetime(2026, 1, 15, 21, 0, 0, tzinfo=timezone.utc)
    end_kuwait = datetime(2026, 1, 16, 20, 59, 59, 999999, tzinfo=timezone.utc)
    from_kuwait = int(start_kuwait.timestamp())
    to_kuwait = int(end_kuwait.timestamp())
    
    # 3) UTC: 2026-01-16 00:00:00 to 2026-01-16 23:59:59 (exclusive of 2026-01-17)
    #    Vendon often uses exclusive end: try end = 2026-01-17 00:00:00 - 1
    end_utc_excl = datetime(2026, 1, 17, 0, 0, 0, tzinfo=timezone.utc).timestamp() - 1
    to_utc_excl = int(end_utc_excl)
    
    print("=== Vendon timestamp debug for 2026-01-16, machine 393033 ===\n")
    
    # Fetch with wide range to see ALL vends and their timestamps
    wide_start = int(datetime(2026, 1, 14, 0, 0, 0, tzinfo=timezone.utc).timestamp())
    wide_end = int(datetime(2026, 1, 18, 23, 59, 59, tzinfo=timezone.utc).timestamp())
    all_vends = fetch_vends(wide_start, wide_end)
    
    print(f"Wide range (Jan 14-18 UTC): {len(all_vends)} vends")
    total_wide = sum(v.get("price", 0) for v in all_vends)
    print(f"Total revenue in wide range: {total_wide:.2f} KWD\n")
    
    # Show each vend: timestamp, as datetime (UTC and Kuwait), price
    print("Each vend (timestamp, UTC, Kuwait UTC, price):")
    for v in all_vends:
        ts = v.get("timestamp")
        price = v.get("price", 0)
        if ts is None:
            print(f"  ts=None price={price}")
            continue
        dt_utc = datetime.fromtimestamp(ts, tz=timezone.utc)
        # Kuwait = UTC+3
        dt_kuwait = dt_utc + timedelta(hours=3)
        in_utc_day = from_utc <= ts <= to_utc
        in_kuwait_day = from_kuwait <= ts <= to_kuwait
        print(f"  ts={ts} | {dt_utc} | Kuwait: {dt_kuwait} | {price} KWD | in_utc_2026-01-16={in_utc_day} in_kuwait_2026-01-16={in_kuwait_day}")
    
    # Test each range
    print("\n--- Range tests ---")
    
    v_utc = fetch_vends(from_utc, to_utc)
    r_utc = sum(v.get("price", 0) for v in v_utc)
    print(f"UTC 2026-01-16 00:00 to 23:59:59: {len(v_utc)} vends, {r_utc:.2f} KWD")
    
    v_utc_excl = fetch_vends(from_utc, to_utc_excl)
    r_utc_excl = sum(v.get("price", 0) for v in v_utc_excl)
    print(f"UTC 2026-01-16 00:00 to 2026-01-17 00:00-1s: {len(v_utc_excl)} vends, {r_utc_excl:.2f} KWD")
    
    v_kuwait = fetch_vends(from_kuwait, to_kuwait)
    r_kuwait = sum(v.get("price", 0) for v in v_kuwait)
    print(f"Kuwait 2026-01-16 (as UTC 2026-01-15 21:00 to 2026-01-16 20:59:59): {len(v_kuwait)} vends, {r_kuwait:.2f} KWD")
    
    # Target: 4.8 KWD, 5 vends
    print("\n--- Target: 4.8 KWD, 5 vends ---")
    if abs(r_utc - 4.8) < 0.01 and len(v_utc) == 5:
        print("UTC range matches.")
    elif abs(r_kuwait - 4.8) < 0.01 and len(v_kuwait) == 5:
        print("Kuwait (UTC+3) range matches. USE THIS in sync.")
    else:
        print("Need to find exact range. Try binary search or check Vendon docs.")

if __name__ == "__main__":
    main()

