-- Verify People Analytics Database Setup
-- Run this to check if tables exist and see sample data

-- Check if tables exist
SELECT 
    table_name,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public' 
  AND table_name IN ('people_analytics_records', 'sync_logs')
ORDER BY table_name;

-- Count records in each table
SELECT 
    'people_analytics_records' as table_name,
    COUNT(*) as record_count
FROM people_analytics_records
UNION ALL
SELECT 
    'sync_logs' as table_name,
    COUNT(*) as record_count
FROM sync_logs;

-- Show recent records (if any)
SELECT 
    uidd,
    first_timestamp,
    people_in,
    people_out,
    net_traffic
FROM people_analytics_records
ORDER BY first_timestamp DESC
LIMIT 10;

-- Show recent sync logs
SELECT 
    id,
    sync_started_at,
    sync_completed_at,
    status,
    records_synced
FROM sync_logs
ORDER BY sync_started_at DESC
LIMIT 10;

-- Check date range of data
SELECT 
    MIN(first_timestamp) as earliest_record,
    MAX(first_timestamp) as latest_record,
    COUNT(*) as total_records
FROM people_analytics_records;

