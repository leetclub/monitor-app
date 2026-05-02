-- Debug script to check what data exists for a date range

-- Check interval types for device 1382465.8 for Jan 13-14
SELECT 
    DATE(first_timestamp) as date,
    interval_type,
    COUNT(*) as records,
    MIN(first_timestamp) as first_record,
    MAX(first_timestamp) as last_record,
    SUM(people_in) as total_in,
    SUM(people_out) as total_out
FROM people_analytics_records
WHERE uidd = '1382465.8'
  AND first_timestamp >= '2026-01-13 00:00:00'
  AND first_timestamp < '2026-01-15 00:00:00'
GROUP BY DATE(first_timestamp), interval_type
ORDER BY date, interval_type;

-- Check what would be returned with interval='hour' filter
SELECT 
    DATE(first_timestamp) as date,
    interval_type,
    COUNT(*) as records,
    SUM(people_in) as total_in,
    SUM(people_out) as total_out
FROM people_analytics_records
WHERE uidd = '1382465.8'
  AND first_timestamp >= '2026-01-13 00:00:00'
  AND first_timestamp < '2026-01-15 00:00:00'
  AND (interval_type = 'hour' OR interval_type = 'date')
GROUP BY DATE(first_timestamp), interval_type
ORDER BY date, interval_type;

-- Check what would be returned with interval='date' filter only
SELECT 
    DATE(first_timestamp) as date,
    interval_type,
    COUNT(*) as records,
    SUM(people_in) as total_in,
    SUM(people_out) as total_out
FROM people_analytics_records
WHERE uidd = '1382465.8'
  AND first_timestamp >= '2026-01-13 00:00:00'
  AND first_timestamp < '2026-01-15 00:00:00'
  AND interval_type = 'date'
GROUP BY DATE(first_timestamp), interval_type
ORDER BY date, interval_type;

