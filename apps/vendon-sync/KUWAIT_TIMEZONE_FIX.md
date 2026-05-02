# Kuwait Timezone Fix (Permanent)

## Problem
Sync stored **5.6 KWD** for Sultan Hamra on 2026-01-16 while **Vendon shows 4.8 KWD** for the same day.  
Using UTC midnight-to-midnight included one extra vend from the next calendar day in Kuwait.

## Root Cause
**Vendon uses Kuwait local date** (UTC+3) for daily boundaries.  
- "2026-01-16" in Vendon = 2026-01-16 00:00:00 **Kuwait** to 23:59:59 **Kuwait**  
- In UTC that is: **2026-01-15 21:00:00** to **2026-01-16 20:59:59**

Our sync used UTC midnight-to-midnight (2026-01-16 00:00 to 23:59 UTC), which:
- Excluded vends from 2026-01-16 00:00–02:59 UTC (still 2026-01-16 in Kuwait)
- Included vends from 2026-01-16 21:00–23:59 UTC (already 2026-01-17 in Kuwait)

So we under-counted some and over-counted one, ending at 5.6 instead of 4.8.

## Fix (Permanent)
In `sync_service.py`:

1. **Kuwait timezone**  
   - `KUWAIT_TZ = timezone(timedelta(hours=3))`

2. **Date window in Kuwait local time**  
   - `start_dt = datetime.combine(sale_date, datetime.min.time(), tzinfo=KUWAIT_TZ)`  
   - `end_dt = datetime.combine(sale_date, datetime.max.time(), tzinfo=KUWAIT_TZ)`  
   - `from_timestamp = int(start_dt.timestamp())`  
   - `to_timestamp = int(end_dt.timestamp())`

This aligns our `/stats/vends` range with Vendon’s “day” and matches Vendon’s numbers (e.g. 4.8 KWD, 5 transactions for 393033 on 2026-01-16).

## Verification
- `./debug_vend_timestamps.py` – compares UTC vs Kuwait ranges; Kuwait matches 4.8 KWD.  
- Revert 393033 to 0, run sync for 2026-01-16, then `./verify_fix.sh` – DB shows 4.8 KWD and 5 transactions.

## Cronjob
`vendon-sales-sync` uses `programmeradmin25/people-analytics-sync:latest` with `imagePullPolicy: Always`, so the next run picks up the image that includes this fix.

