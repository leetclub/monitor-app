-- SX / product target fields on live_machine_config (Alert Admin).
-- Location daily target remains daily_sales_target (overrides week-default when set).

ALTER TABLE live_machine_config
  ADD COLUMN IF NOT EXISTS sx_product_name TEXT,
  ADD COLUMN IF NOT EXISTS daily_product_target NUMERIC(14, 4);

COMMENT ON COLUMN live_machine_config.sx_product_name IS
  'Vendon product name substring for SX Prod / product target (Alert Admin)';
COMMENT ON COLUMN live_machine_config.daily_product_target IS
  'Daily product target in cups for the linked SX product (Alert Admin)';
