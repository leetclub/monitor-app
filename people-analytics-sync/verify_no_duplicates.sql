-- Quick verification script to check if there are any duplicates

-- Check 1: Count duplicates
SELECT 
    CASE 
        WHEN COUNT(*) = COUNT(DISTINCT (uidd, first_timestamp, last_timestamp, interval_type)) 
        THEN '✅ NO DUPLICATES - All records are unique'
        ELSE '❌ DUPLICATES FOUND - ' || 
             (COUNT(*) - COUNT(DISTINCT (uidd, first_timestamp, last_timestamp, interval_type)))::text || 
             ' duplicate records exist'
    END as status,
    COUNT(*) as total_records,
    COUNT(DISTINCT (uidd, first_timestamp, last_timestamp, interval_type)) as unique_combinations,
    COUNT(*) - COUNT(DISTINCT (uidd, first_timestamp, last_timestamp, interval_type)) as duplicate_count
FROM people_analytics_records;

-- Check 2: Verify unique constraint exists
SELECT 
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM pg_constraint 
            WHERE conname = 'uq_uidd_timestamp_interval'
        )
        THEN '✅ Unique constraint exists'
        ELSE '❌ Unique constraint MISSING'
    END as constraint_status;

-- Check 3: Show any remaining duplicates (if any)
SELECT 
    uidd,
    first_timestamp,
    last_timestamp,
    interval_type,
    COUNT(*) as count,
    array_agg(id ORDER BY synced_at DESC) as record_ids,
    array_agg(synced_at ORDER BY synced_at DESC) as sync_times
FROM people_analytics_records
GROUP BY uidd, first_timestamp, last_timestamp, interval_type
HAVING COUNT(*) > 1
ORDER BY count DESC
LIMIT 10;

