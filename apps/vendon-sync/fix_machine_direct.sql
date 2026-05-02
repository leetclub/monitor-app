-- Fix machine 393033 for 2026-01-16
-- This will be updated with correct values from Vendon API

-- First, let's see what we have
SELECT machine_id, total_revenue, total_transactions, sale_date 
FROM vendon_sales_records 
WHERE machine_id = '393033' AND DATE(sale_date) = '2026-01-16';

-- Update with correct values (4.80 KWD, 5 transactions)
-- Note: We'll fetch the actual data first, then update
UPDATE vendon_sales_records
SET 
    total_revenue = 4.80,
    total_transactions = 5,
    synced_at = CURRENT_TIMESTAMP
WHERE machine_id = '393033' 
  AND DATE(sale_date) = '2026-01-16';

-- Verify the update
SELECT machine_id, total_revenue, total_transactions, sale_date 
FROM vendon_sales_records 
WHERE machine_id = '393033' AND DATE(sale_date) = '2026-01-16';

