-- Quick SQL to check historical data coverage
-- Run this to verify all data is in the database before switching frontend

-- 1. Check date range in database
SELECT 
    MIN(first_timestamp)::date as earliest_date,
    MAX(first_timestamp)::date as latest_date,
    COUNT(*) as total_records,
    COUNT(DISTINCT uidd) as unique_devices,
    COUNT(DISTINCT DATE(first_timestamp)) as unique_days
FROM people_analytics_records;

-- 2. Check recent data (last 7 days)
SELECT 
    DATE(first_timestamp) as date,
    COUNT(*) as records,
    COUNT(DISTINCT uidd) as devices,
    SUM(people_in) as total_in,
    SUM(people_out) as total_out
FROM people_analytics_records
WHERE first_timestamp >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY DATE(first_timestamp)
ORDER BY date DESC;

-- 3. Check if today's data exists
SELECT 
    CASE 
        WHEN COUNT(*) > 0 THEN '✅ Today''s data exists'
        ELSE '❌ No data for today'
    END as status,
    COUNT(*) as records_today,
    MAX(synced_at) as last_sync_time
FROM people_analytics_records
WHERE DATE(first_timestamp) = CURRENT_DATE;

-- 4. Check data freshness (last sync per device)
SELECT 
    uidd,
    MAX(synced_at) as last_sync,
    COUNT(*) as total_records,
    MAX(first_timestamp)::date as latest_data_date
FROM people_analytics_records
GROUP BY uidd
ORDER BY last_sync DESC;

-- 5. Summary for decision
SELECT 
    CASE 
        WHEN MAX(first_timestamp)::date >= CURRENT_DATE - INTERVAL '1 day' 
        THEN '✅ Database is up to date - Safe to switch frontend'
        ELSE '⚠️  Database missing recent data - Run full sync first'
    END as recommendation,
    MAX(first_timestamp)::date as latest_data_date,
    CURRENT_DATE as today,
    CURRENT_DATE - MAX(first_timestamp)::date as days_behind
FROM people_analytics_records;

