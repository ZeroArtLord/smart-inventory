BEGIN;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS manual_procurement_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_procurement_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_procurement_requested_by text,
  ADD COLUMN IF NOT EXISTS manual_procurement_requested_source text;

CREATE INDEX IF NOT EXISTS idx_products_workspace_manual_procurement
  ON products(workspace_id, manual_procurement_requested)
  WHERE manual_procurement_requested = true;

COMMIT;
