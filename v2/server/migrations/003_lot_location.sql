BEGIN;

ALTER TABLE lots
  ADD COLUMN IF NOT EXISTS location_id text;

CREATE INDEX IF NOT EXISTS idx_lots_workspace_product_location
  ON lots(workspace_id, product_id, location_id);

COMMIT;
