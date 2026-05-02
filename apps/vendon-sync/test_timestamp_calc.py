#!/usr/bin/env python3
from datetime import datetime, timezone

# Test timestamp calculation
date_str = "2026-01-16"
date_obj = datetime.strptime(date_str, '%Y-%m-%d').date()

# Current method (naive datetime - uses local timezone)
start_dt_naive = datetime.combine(date_obj, datetime.min.time())
end_dt_naive = datetime.combine(date_obj, datetime.max.time())
from_ts_naive = int(start_dt_naive.timestamp())
to_ts_naive = int(end_dt_naive.timestamp())

print("Current method (naive datetime):")
print(f"  Start: {start_dt_naive} = {from_ts_naive}")
print(f"  End: {end_dt_naive} = {to_ts_naive}")
print(f"  Start date: {datetime.fromtimestamp(from_ts_naive)}")
print(f"  End date: {datetime.fromtimestamp(to_ts_naive)}")

# Fixed method (UTC explicit)
start_dt_utc = datetime.combine(date_obj, datetime.min.time(), tzinfo=timezone.utc)
end_dt_utc = datetime.combine(date_obj, datetime.max.time(), tzinfo=timezone.utc)
from_ts_utc = int(start_dt_utc.timestamp())
to_ts_utc = int(end_dt_utc.timestamp())

print("\nFixed method (UTC explicit):")
print(f"  Start: {start_dt_utc} = {from_ts_utc}")
print(f"  End: {end_dt_utc} = {to_ts_utc}")
print(f"  Start date: {datetime.fromtimestamp(from_ts_utc)}")
print(f"  End date: {datetime.fromtimestamp(to_ts_utc)}")

print("\nDifference:")
print(f"  Start diff: {from_ts_naive - from_ts_utc} seconds = {(from_ts_naive - from_ts_utc) / 3600} hours")
print(f"  End diff: {to_ts_naive - to_ts_utc} seconds = {(to_ts_naive - to_ts_utc) / 3600} hours")

