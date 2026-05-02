-- Migration: Add unique constraint to prevent duplicate records
-- Run this to add the unique constraint to existing database

-- First, remove any existing duplicates (keep the most recent one)
DELETE FROM people_analytics_records
WHERE id NOT IN (
    SELECT DISTINCT ON (uidd, first_timestamp, last_timestamp, interval_type) id
    FROM people_analytics_records
    ORDER BY uidd, first_timestamp, last_timestamp, interval_type, synced_at DESC
);

-- Add unique constraint
ALTER TABLE people_analytics_records
ADD CONSTRAINT uq_uidd_timestamp_interval 
UNIQUE (uidd, first_timestamp, last_timestamp, interval_type);

