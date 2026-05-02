# How to Verify Data Source and Compare with Videoloft

## 1. Check Which Source is Being Used

### Method 1: Check Browser Console Logs

When you load the People Analytics tab, check the browser console (F12 → Console tab). Look for:

**✅ Using Database:**
```
📊 [DATA SOURCE] Trying database API first...
✅ [DATA SOURCE] ✅ USING DATABASE API (not Videoloft) ✅
```

**⚠️ Using Videoloft (Fallback):**
```
📊 [DATA SOURCE] Trying database API first...
⚠️ [DATA SOURCE] Database API failed or returned no data, falling back to Videoloft
⚠️ [DATA SOURCE] ⚠️ USING VIDEOLOFT DIRECTLY (not database) ⚠️
```

### Method 2: Check Apps Script Logs

1. Go to Google Apps Script editor
2. View → Executions
3. Click on the latest execution
4. Check logs for `[DATA SOURCE]` messages

### Method 3: Check Network Tab

1. Open browser DevTools (F12)
2. Go to Network tab
3. Load People Analytics tab
4. Look for requests to:
   - ✅ `people-api.theleetclub.com` = Using Database API
   - ❌ `euwest1-analytics.manything.com` = Using Videoloft directly

## 2. Compare Database vs Videoloft Data

### Quick SQL Check

```bash
# Check what's in database for today
psql -h db-postgresql-nyc1-51052-do-user-18469088-0.i.db.ondigitalocean.com \
     -p 25060 -U doadmin -d people_analytics \
     -c "SELECT uidd, DATE(first_timestamp) as date, SUM(people_in) as total_in, SUM(people_out) as total_out, COUNT(*) as records FROM people_analytics_records WHERE DATE(first_timestamp) = CURRENT_DATE GROUP BY uidd, DATE(first_timestamp) ORDER BY uidd;"
```

### Detailed Comparison Script

Run the comparison script to verify data matches:

```bash
# Compare today's data
python3 people-analytics-sync/compare_db_videoloft.py 2026-01-14 2026-01-14

# Compare specific device
python3 people-analytics-sync/compare_db_videoloft.py 2026-01-14 2026-01-14 1382465.21

# Compare date range
python3 people-analytics-sync/compare_db_videoloft.py 2026-01-13 2026-01-14
```

This will show:
- ✅ Matching records
- ⚠️ Records with differences
- 📦 Records only in database
- 🌐 Records only in Videoloft
- Match percentage

## 3. Force Using Database Only

If you want to ensure it ALWAYS uses the database (no Videoloft fallback), modify `testPeopleAnalyticsWrapper`:

```javascript
// In people-analytics.js, change the fallback logic:
if (!result.success || (result.success && result.data.length === 0)) {
  // Instead of falling back, return error
  console.error("❌ Database API returned no data - check if data is synced");
  return {
    success: false,
    error: "No data available in database. Please ensure data is synced.",
    data: [],
    totalRecords: 0,
    summary: null
  };
}
```

## 4. Test API Directly

Test the API to see what it returns:

```bash
# Get today's data
curl "https://people-api.theleetclub.com/api/people-analytics?start_date=$(date +%Y-%m-%d)&end_date=$(date +%Y-%m-%d)" | jq '.summary'

# Get specific device
curl "https://people-api.theleetclub.com/api/people-analytics?uidds=1382465.21&start_date=$(date +%Y-%m-%d)&end_date=$(date +%Y-%m-%d)" | jq '.data | length'
```

## 5. Verify Data Completeness

Before switching, ensure database has all historical data:

```bash
# Check date range
psql -h db-postgresql-nyc1-51052-do-user-18469088-0.i.db.ondigitalocean.com \
     -p 25060 -U doadmin -d people_analytics \
     -f people-analytics-sync/check_historical_coverage.sql
```

## 6. Expected Behavior

### Normal Operation (Database Working):
1. Frontend calls `testPeopleAnalyticsWrapper`
2. Wrapper calls `fetchPeopleAnalyticsFromDatabase`
3. Database API returns data
4. ✅ Uses database data

### Fallback (Database Empty/Failed):
1. Frontend calls `testPeopleAnalyticsWrapper`
2. Wrapper calls `fetchPeopleAnalyticsFromDatabase`
3. Database API fails or returns empty
4. ⚠️ Falls back to `fetchPeopleAnalytics` (Videoloft)

## 7. Troubleshooting

### Issue: Always using Videoloft

**Check:**
1. Is API accessible? `curl https://people-api.theleetclub.com/health`
2. Does database have data? Check with SQL queries above
3. Check Apps Script logs for API errors

**Fix:**
- Ensure API is running and accessible
- Run initial sync to populate database
- Check API logs: `kubectl logs -l app=people-analytics-api -n leet-monitor`

### Issue: Data doesn't match

**Check:**
1. Run comparison script
2. Check if sync is running: `kubectl get jobs -n leet-monitor -l app=people-analytics-sync`
3. Check sync logs for errors

**Fix:**
- Ensure CronJob is running hourly
- Check for sync errors
- Run manual sync if needed

