-- Script to remove duplicate records from people_analytics_records table
-- This keeps the most recent record (by synced_at) for each unique combination

-- STEP 1: Check current state
\echo '=== Checking for duplicates ==='
SELECT 
    COUNT(*) as total_records,
    COUNT(DISTINCT (uidd, first_timestamp, last_timestamp, interval_type)) as unique_combinations,
    COUNT(*) - COUNT(DISTINCT (uidd, first_timestamp, last_timestamp, interval_type)) as duplicate_count
FROM people_analytics_records;

-- STEP 2: Show what will be deleted (preview)
\echo '=== Preview: Records that will be deleted ==='
SELECT 
    id,
    uidd,
    first_timestamp,
    last_timestamp,
    interval_type,
    synced_at
FROM people_analytics_records
WHERE id NOT IN (
    SELECT DISTINCT ON (uidd, first_timestamp, last_timestamp, interval_type) id
    FROM people_analytics_records
    ORDER BY uidd, first_timestamp, last_timestamp, interval_type, synced_at DESC
)
ORDER BY uidd, first_timestamp, last_timestamp, interval_type, synced_at DESC
LIMIT 20;

-- STEP 3: Delete duplicates (keeps most recent by synced_at)
\echo '=== Deleting duplicate records ==='
DELETE FROM people_analytics_records
WHERE id NOT IN (
    SELECT DISTINCT ON (uidd, first_timestamp, last_timestamp, interval_type) id
    FROM people_analytics_records
    ORDER BY uidd, first_timestamp, last_timestamp, interval_type, synced_at DESC
);

-- STEP 4: Verify deletion
\echo '=== Verification: Checking for remaining duplicates ==='
SELECT 
    COUNT(*) as total_records,
    COUNT(DISTINCT (uidd, first_timestamp, last_timestamp, interval_type)) as unique_combinations,
    COUNT(*) - COUNT(DISTINCT (uidd, first_timestamp, last_timestamp, interval_type)) as remaining_duplicates
FROM people_analytics_records;

-- STEP 5: Add unique constraint (if not exists)
\echo '=== Adding unique constraint ==='
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'uq_uidd_timestamp_interval'
    ) THEN
        ALTER TABLE people_analytics_records
        ADD CONSTRAINT uq_uidd_timestamp_interval 
        UNIQUE (uidd, first_timestamp, last_timestamp, interval_type);
        RAISE NOTICE 'Unique constraint added successfully';
    ELSE
        RAISE NOTICE 'Unique constraint already exists';
    END IF;
END $$;

-- STEP 6: Final verification
\echo '=== Final verification ==='
SELECT 
    conname AS constraint_name,
    contype AS constraint_type
FROM pg_constraint
WHERE conrelid = 'people_analytics_records'::regclass
  AND conname = 'uq_uidd_timestamp_interval';

\echo '=== Done! ==='

