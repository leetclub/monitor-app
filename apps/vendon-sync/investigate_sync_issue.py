#!/usr/bin/env python3
"""
Investigate why sync fetched 0 vends for machine 393033 on 2026-01-16
when Vendon API actually has 5 vends with 4.8 KWD
"""
import requests
from datetime import datetime, timedelta
import os

VENDON_API_KEY = "7OMcvPEpSGsM6jRNZJnQVKZWlQEBWSqD"
VENDON_API_BASE = "https://cloud.vendon.net/rest/v1.9.0"

def test_timestamps():
    """Test different timestamp calculations"""
    target_date = "2026-01-16"
    machine_id = "393033"
    
    print("=" * 60)
    print("🔍 Investigating Sync Issue for Machine 393033")
    print("=" * 60)
    print()
    
    # Method 1: UTC midnight to midnight (what sync uses)
    date_obj = datetime.strptime(target_date, '%Y-%m-%d')
    start_dt_utc = datetime.combine(date_obj, datetime.min.time())
    end_dt_utc = datetime.combine(date_obj, datetime.max.time())
    from_ts_utc = int(start_dt_utc.timestamp())
    to_ts_utc = int(end_dt_utc.timestamp())
    
    print("Method 1: UTC midnight to midnight (sync's current method)")
    print(f"  Date: {target_date}")
    print(f"  Start UTC: {start_dt_utc} = {from_ts_utc}")
    print(f"  End UTC: {end_dt_utc} = {to_ts_utc}")
    
    # Test this
    url = f"{VENDON_API_BASE}/stats/vends"
    params = {
        'from_timestamp': from_ts_utc,
        'to_timestamp': to_ts_utc,
        'machine_id': machine_id,
        'limit': 10000
    }
    headers = {"Authorization": f"Token {VENDON_API_KEY}"}
    
    response = requests.get(url, params=params, headers=headers, timeout=30)
    if response.status_code == 200:
        data = response.json()
        if data.get('code') == 200:
            vends = data.get('result', [])
            revenue = sum(v.get('price', 0) for v in vends)
            print(f"  ✅ Result: {len(vends)} vends, {revenue:.2f} KWD")
            if vends:
                print(f"  First vend timestamp: {vends[0].get('timestamp')}")
                print(f"  Last vend timestamp: {vends[-1].get('timestamp')}")
        else:
            print(f"  ❌ API error: {data.get('code')}")
    else:
        print(f"  ❌ HTTP error: {response.status_code}")
    
    print()
    
    # Method 2: Try with wider range (maybe timezone issue)
    # Kuwait is UTC+3, so maybe we need to adjust
    start_dt_kuwait = start_dt_utc - timedelta(hours=3)
    end_dt_kuwait = end_dt_utc - timedelta(hours=3)
    from_ts_kuwait = int(start_dt_kuwait.timestamp())
    to_ts_kuwait = int(end_dt_kuwait.timestamp())
    
    print("Method 2: Kuwait timezone adjusted (UTC-3 hours)")
    print(f"  Start: {start_dt_kuwait} = {from_ts_kuwait}")
    print(f"  End: {end_dt_kuwait} = {to_ts_kuwait}")
    
    params2 = {
        'from_timestamp': from_ts_kuwait,
        'to_timestamp': to_ts_kuwait,
        'machine_id': machine_id,
        'limit': 10000
    }
    response2 = requests.get(url, params=params2, headers=headers, timeout=30)
    if response2.status_code == 200:
        data2 = response2.json()
        if data2.get('code') == 200:
            vends2 = data2.get('result', [])
            revenue2 = sum(v.get('price', 0) for v in vends2)
            print(f"  ✅ Result: {len(vends2)} vends, {revenue2:.2f} KWD")
    
    print()
    
    # Method 3: Try a wider range to see what timestamps the vends actually have
    print("Method 3: Wider range to find actual vend timestamps")
    wide_start = from_ts_utc - (24 * 60 * 60)  # 1 day before
    wide_end = to_ts_utc + (24 * 60 * 60)  # 1 day after
    
    params3 = {
        'from_timestamp': wide_start,
        'to_timestamp': wide_end,
        'machine_id': machine_id,
        'limit': 10000
    }
    response3 = requests.get(url, params=params3, headers=headers, timeout=30)
    if response3.status_code == 200:
        data3 = response3.json()
        if data3.get('code') == 200:
            vends3 = data3.get('result', [])
            print(f"  Found {len(vends3)} vends in wider range")
            if vends3:
                print("  Vend timestamps:")
                for v in vends3[:10]:
                    ts = v.get('timestamp')
                    dt = datetime.fromtimestamp(ts) if ts else None
                    print(f"    {ts} = {dt} = {v.get('price', 0)} KWD")
                
                # Check which ones fall on 2026-01-16
                on_date = [v for v in vends3 if v.get('timestamp') and from_ts_utc <= v.get('timestamp') <= to_ts_utc]
                print(f"\n  Vends that fall in UTC range ({from_ts_utc} to {to_ts_utc}): {len(on_date)}")
                if on_date:
                    revenue_on_date = sum(v.get('price', 0) for v in on_date)
                    print(f"  Revenue for those: {revenue_on_date:.2f} KWD")
    
    print()
    print("=" * 60)

if __name__ == "__main__":
    test_timestamps()

