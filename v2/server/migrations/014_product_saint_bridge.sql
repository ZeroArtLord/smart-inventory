BEGIN;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS saint_bridge_source boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS saint_bridge_source_product_id text,
  ADD COLUMN IF NOT EXISTS saint_bridge_code text,
  ADD COLUMN IF NOT EXISTS saint_bridge_name text;

CREATE INDEX IF NOT EXISTS idx_products_workspace_saint_bridge_source
  ON products (workspace_id, saint_bridge_source_product_id)
  WHERE saint_bridge_source_product_id IS NOT NULL
    AND btrim(saint_bridge_source_product_id) <> '';

CREATE INDEX IF NOT EXISTS idx_products_workspace_saint_bridge_code
  ON products (workspace_id, saint_bridge_code)
  WHERE saint_bridge_code IS NOT NULL
    AND btrim(saint_bridge_code) <> '';

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_saint_bridge_not_self;

ALTER TABLE products
  ADD CONSTRAINT products_saint_bridge_not_self
  CHECK (
    saint_bridge_source_product_id IS NULL
    OR btrim(saint_bridge_source_product_id) = ''
    OR saint_bridge_source_product_id <> id
  );

COMMIT;
