# Fix: Historical Performance API Query Issue

## Problem

The API was returning "no data" because the query was looking for exact date matches (`start_date == yesterday AND end_date == yesterday`), but the sync service stores data for date ranges (e.g., last 30 days with `start_date = 2025-12-19` and `end_date = 2026-01-17`).

## Solution

Updated the API queries in `api_service.py` to check if the requested date falls WITHIN the stored date range:

**Before:**
```python
query = session.query(HistoricalPerformanceRecord).filter(
    and_(
        HistoricalPerformanceRecord.start_date == start_dt,
        HistoricalPerformanceRecord.end_date == end_dt
    )
)
```

**After:**
```python
query = session.query(HistoricalPerformanceRecord).filter(
    and_(
        HistoricalPerformanceRecord.start_date <= yesterday_dt,
        HistoricalPerformanceRecord.end_date >= yesterday_dt
    )
)
```

## Files Changed

- `historical-performance-sync/api_service.py`:
  - Fixed `get_best_machine_yesterday()` endpoint
  - Fixed `get_historical_performance()` endpoint

## Deployment Steps

1. **Rebuild the API Docker image:**
   ```bash
   cd historical-performance-sync
   docker build -f Dockerfile.api -t programmeradmin25/historical-performance-api:latest .
   ```

2. **Push the image to Docker Hub:**
   ```bash
   docker push programmeradmin25/historical-performance-api:latest
   ```

3. **Restart the API deployment** (Kubernetes will automatically pull the new image since `imagePullPolicy: Always` is set):
   ```bash
   kubectl rollout restart deployment historical-performance-api -n leet-monitor
   ```

4. **Verify the fix:**
   ```bash
   # Check API health
   curl https://historical-api.theleetclub.com/health
   
   # Test best-yesterday endpoint
   curl https://historical-api.theleetclub.com/api/historical-performance/best-yesterday
   ```

## Expected Result

After deployment, the API should:
- Return the best machine for yesterday (if data exists in the database)
- Return historical performance data for date ranges that overlap with stored ranges
- The frontend spinner should no longer get stuck on "Loading Historical Data Finding best performer..."

