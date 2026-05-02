-- Check what interval types exist in database for a date range

SELECT 
    DATE(first_timestamp) as date,
    interval_type,
    COUNT(*) as record_count,
    COUNT(DISTINCT uidd) as devices,
    SUM(people_in) as total_in,
    SUM(people_out) as total_out
FROM people_analytics_records
WHERE uidd = '1382465.8'
  AND first_timestamp >= '2026-01-13'
  AND first_timestamp < '2026-01-15'
GROUP BY DATE(first_timestamp), interval_type
ORDER BY date, interval_type;

-- Check all interval types in database
SELECT DISTINCT interval_type, COUNT(*) as count
FROM people_analytics_records
GROUP BY interval_type
ORDER BY interval_type;

