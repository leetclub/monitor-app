-- Script to check for duplicates in people_analytics_records table

-- 1. Check if unique constraint exists
SELECT 
    conname AS constraint_name,
    contype AS constraint_type
FROM pg_constraint
WHERE conrelid = 'people_analytics_records'::regclass
  AND conname = 'uq_uidd_timestamp_interval';

-- 2. Find duplicate records (same uidd, first_timestamp, last_timestamp, interval_type)
SELECT 
    uidd,
    first_timestamp,
    last_timestamp,
    interval_type,
    COUNT(*) as duplicate_count,
    MIN(id) as first_id,
    MAX(id) as last_id,
    MIN(synced_at) as oldest_sync,
    MAX(synced_at) as newest_sync
FROM people_analytics_records
GROUP BY uidd, first_timestamp, last_timestamp, interval_type
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, uidd, first_timestamp;

-- 3. Count total duplicate records (records that will be removed)
WITH duplicates AS (
    SELECT 
        uidd,
        first_timestamp,
        last_timestamp,
        interval_type,
        COUNT(*) as cnt
    FROM people_analytics_records
    GROUP BY uidd, first_timestamp, last_timestamp, interval_type
    HAVING COUNT(*) > 1
)
SELECT 
    SUM(cnt - 1) as total_duplicate_records_to_remove,
    COUNT(*) as unique_duplicate_groups
FROM duplicates;

-- 4. Show sample duplicate records (first 10 groups)
SELECT 
    p.id,
    p.uidd,
    p.first_timestamp,
    p.last_timestamp,
    p.interval_type,
    p.people_in,
    p.people_out,
    p.synced_at,
    ROW_NUMBER() OVER (
        PARTITION BY p.uidd, p.first_timestamp, p.last_timestamp, p.interval_type 
        ORDER BY p.synced_at DESC
    ) as row_num
FROM people_analytics_records p
WHERE (p.uidd, p.first_timestamp, p.last_timestamp, p.interval_type) IN (
    SELECT uidd, first_timestamp, last_timestamp, interval_type
    FROM people_analytics_records
    GROUP BY uidd, first_timestamp, last_timestamp, interval_type
    HAVING COUNT(*) > 1
    LIMIT 10
)
ORDER BY p.uidd, p.first_timestamp, p.last_timestamp, p.interval_type, p.synced_at DESC;

