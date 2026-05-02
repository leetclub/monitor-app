-- Migration: Add sync_type column to sync_verification_results table
-- This allows tracking verification results for different sync types (vendon-sync, people-analytics-sync, historical-performance-sync)

-- Add sync_type column (nullable for backward compatibility)
ALTER TABLE sync_verification_results 
ADD COLUMN IF NOT EXISTS sync_type VARCHAR(50);

-- Create index for faster queries by sync_type
CREATE INDEX IF NOT EXISTS idx_verification_sync_type ON sync_verification_results(sync_type, verification_date);

-- Update existing records to have default sync_type
UPDATE sync_verification_results 
SET sync_type = 'vendon-sync' 
WHERE sync_type IS NULL;

-- Add comment
COMMENT ON COLUMN sync_verification_results.sync_type IS 'Type of sync being verified: vendon-sync, people-analytics-sync, historical-performance-sync';
