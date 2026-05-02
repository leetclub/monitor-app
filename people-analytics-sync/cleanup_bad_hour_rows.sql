-- Remove misaligned hourly rows (created by non-hour-aligned sync windows)
-- These rows have first_timestamp not on :00 and will never match Videoloft hourly buckets.
--
-- Usage example (edit uidd + date range):
--   DELETE bad hour rows for one camera between 2026-01-13 and 2026-01-15
--
-- IMPORTANT: This only deletes interval_type='hour' rows that are NOT aligned to the hour.

-- Customize these:
-- \set uidd '1382465.8'
-- \set start_date '2026-01-13'
-- \set end_date   '2026-01-15'

-- Preview count:
SELECT COUNT(*) AS bad_hour_rows
FROM people_analytics_records
WHERE interval_type = 'hour'
  AND uidd = :'uidd'
  AND first_timestamp >= :'start_date'::date
  AND first_timestamp <  :'end_date'::date
  AND (
    -- bad start boundary (should be HH:00:00)
    EXTRACT(MINUTE FROM first_timestamp) <> 0 OR EXTRACT(SECOND FROM first_timestamp) <> 0
    OR
    -- bad end boundary (Videoloft hour buckets end at HH:59:00)
    EXTRACT(MINUTE FROM last_timestamp) <> 59 OR EXTRACT(SECOND FROM last_timestamp) <> 0
  );

-- Delete:
DELETE FROM people_analytics_records
WHERE interval_type = 'hour'
  AND uidd = :'uidd'
  AND first_timestamp >= :'start_date'::date
  AND first_timestamp <  :'end_date'::date
  AND (
    EXTRACT(MINUTE FROM first_timestamp) <> 0 OR EXTRACT(SECOND FROM first_timestamp) <> 0
    OR EXTRACT(MINUTE FROM last_timestamp) <> 59 OR EXTRACT(SECOND FROM last_timestamp) <> 0
  );

-- Verify remaining hourly rows are hour-aligned:
SELECT
  DATE(first_timestamp) AS d,
  COUNT(*) AS hour_rows,
  SUM(CASE WHEN EXTRACT(MINUTE FROM first_timestamp) = 0 AND EXTRACT(SECOND FROM first_timestamp) = 0 THEN 1 ELSE 0 END) AS aligned_start_rows,
  SUM(CASE WHEN EXTRACT(MINUTE FROM last_timestamp) = 59 AND EXTRACT(SECOND FROM last_timestamp) = 0 THEN 1 ELSE 0 END) AS aligned_end_rows
FROM people_analytics_records
WHERE interval_type = 'hour'
  AND uidd = :'uidd'
  AND first_timestamp >= :'start_date'::date
  AND first_timestamp <  :'end_date'::date
GROUP BY 1
ORDER BY 1;


