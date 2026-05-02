# Data Storage Approach

## Current Approach: Store Individual Records with Deduplication

### Why This Approach?

1. **Flexibility**: Store granular data (per time period) allows flexible querying
   - Can aggregate by hour, day, week, month in queries
   - Can see patterns within a day
   - Can track changes over time

2. **Data Integrity**: Each record represents a specific time period from Videoloft
   - Preserves original data structure
   - Can see when data was last synced
   - Can track if data changed between syncs

3. **Deduplication**: Using unique constraint on `(uidd, first_timestamp, last_timestamp, interval_type)`
   - Prevents duplicate records from multiple sync runs
   - Uses PostgreSQL `ON CONFLICT DO UPDATE` (upsert) to update existing records
   - Keeps the most recent data if Videoloft updates a record

### How It Works

1. **Sync Process** (every minute):
   - Fetches data from Videoloft for the last 1 day (including today)
   - For each record, uses upsert logic:
     - If record exists (same device + time period): Updates it
     - If record doesn't exist: Inserts it

2. **Query Process** (from webapp):
   - API queries records by date range and device IDs
   - Can aggregate on-the-fly:
     - Sum `people_in` and `people_out` for date range
     - Group by day, hour, etc.
     - Calculate totals per machine

### Example Query Results

For a date range query, you get:
```json
{
  "data": [
    {
      "uidd": "1382465.21",
      "first_timestamp": "2026-01-13T10:55:00",
      "last_timestamp": "2026-01-13T11:00:00",
      "in": 1,
      "out": 4,
      "netTraffic": -3
    },
    // ... more records
  ],
  "summary": {
    "totalIn": 5512,
    "totalOut": 5708,
    "netTraffic": -196,
    "totalRecords": 161
  }
}
```

The API automatically sums up all records in the date range to give you totals per machine.

## Alternative Approach: Daily Aggregation (NOT Recommended)

### Why NOT to use daily aggregation:

1. **Loss of Granularity**: Can't see hourly patterns
2. **Less Flexible**: Hard to change aggregation later
3. **More Complex**: Need to handle partial days, timezone issues
4. **Data Loss**: If Videoloft updates historical data, harder to reconcile

### If You Still Want Daily Aggregation:

You could add a materialized view or separate table:
```sql
CREATE TABLE daily_aggregates AS
SELECT 
    uidd,
    DATE(first_timestamp) as date,
    SUM(people_in) as total_in,
    SUM(people_out) as total_out,
    COUNT(*) as record_count
FROM people_analytics_records
GROUP BY uidd, DATE(first_timestamp);
```

But this adds complexity and the current approach is more flexible.

## Recommendation

**Keep the current approach** (individual records with deduplication) because:
- ✅ More flexible for future requirements
- ✅ Preserves all data
- ✅ Easy to query and aggregate
- ✅ Prevents duplicates automatically
- ✅ Can handle data updates from Videoloft

The API already handles aggregation in queries, so you get the best of both worlds:
- Granular storage (flexibility)
- Aggregated results (performance)

