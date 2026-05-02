# Targets Tab Data Sources

## Summary

The targets tab now uses **cached database** for fast data loading instead of calling Vendon API directly.

## What Data Comes from Database (Fast) ✅

### 1. **Lowest Performing Machine Yesterday**
- **Function**: `fetchLowestMachineYesterdayFromCache()`
- **API Endpoint**: `GET /api/vendon-sales/lowest-yesterday`
- **Source**: `vendon_sales_records` table
- **Speed**: ⚡ Very fast (single DB query)
- **Used in**: Preloading targets tab on app start

### 2. **Yesterday's Revenue for Specific Machine**
- **Function**: `fetchTargetsData()` (updated)
- **API Endpoint**: `GET /api/vendon-sales?machine_ids={id}&date={date}`
- **Source**: `vendon_sales_records` table
- **Speed**: ⚡ Very fast (single DB query with index)
- **Used in**: Calculating targets data for selected machine
- **Fallback**: If cache fails, falls back to direct Vendon API

## What Still Comes from Vendon API Directly ❌

### 1. **Machine List**
- **Function**: `fetchMachines()`
- **API Endpoint**: `GET /machines`
- **Why**: Machine metadata not stored in DB
- **Used in**: Machine dropdown, machine name mapping

### 2. **Baseline Data (Best Days)**
- **Source**: JSON file (not from API)
- **Why**: Historical reference data, doesn't change frequently
- **Used in**: Comparing yesterday vs all-time best days

### 3. **Real-time/Today's Data**
- **When**: Viewing today's data (not synced yet)
- **Why**: Today's data hasn't been synced to DB yet
- **Used in**: Real-time dashboards (if needed)

## Data Flow

### Preload Flow (App Start):
1. ✅ `fetchLowestMachineYesterdayFromCache()` → DB (fast)
2. ✅ `fetchTargetsData()` → DB for revenue (fast)
3. ❌ `fetchMachines()` → Vendon API (needed for machine names)
4. ✅ Baseline data → JSON file (local)

### User Selection Flow:
1. User selects machine from dropdown
2. ✅ `fetchTargetsData()` → DB for revenue (fast)
3. ✅ Baseline data → JSON file (local)
4. Render comparison

## Performance Improvements

### Before:
- ❌ Scanned all machines individually via Vendon API
- ❌ Each machine = 1 API call (slow, rate-limited)
- ❌ Total time: 30-60 seconds for 50+ machines

### After:
- ✅ Single DB query for lowest machine
- ✅ Single DB query for machine revenue
- ✅ Total time: < 2 seconds

## API Endpoints Used

### From Cached DB:
- `GET /api/vendon-sales/lowest-yesterday` - Lowest machine yesterday
- `GET /api/vendon-sales?machine_ids={id}&date={date}` - Revenue for specific machine/date

### Still from Vendon API:
- `GET /machines` - Machine list and metadata
- `GET /stats/vends` (fallback only) - If cache fails

## Spinner Timing Fix

The spinner now uses `requestAnimationFrame` to ensure it stays visible until data is fully rendered:
- Before: Hidden after 500ms timeout (too early)
- After: Hidden after rendering completes (correct timing)

## Testing

To verify targets tab is using DB:
1. Check browser console for logs:
   - `✅ Got revenue from cache: X KWD`
   - `✅ Found lowest machine from cache`
2. Check network tab:
   - Should see requests to `vendon-api.theleetclub.com`
   - Should NOT see requests to `cloud.vendon.net` (unless fallback)

