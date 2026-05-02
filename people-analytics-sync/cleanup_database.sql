-- Cleanup People Analytics Database
-- WARNING: This will delete all data! Use with caution.

-- Delete all records (keeps table structure)
TRUNCATE TABLE people_analytics_records;
TRUNCATE TABLE sync_logs;

-- Or drop tables completely (removes structure too)
-- DROP TABLE IF EXISTS people_analytics_records;
-- DROP TABLE IF EXISTS sync_logs;

-- Or drop entire database (requires reconnection to another database first)
-- \c postgres;
-- DROP DATABASE IF EXISTS people_analytics;

