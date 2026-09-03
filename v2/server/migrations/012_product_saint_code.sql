BEGIN;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS saint_code text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_workspace_saint_code
  ON products (
    workspace_id,
    lower(saint_code)
  )
  WHERE saint_code IS NOT NULL
    AND btrim(saint_code) <> '';

CREATE INDEX IF NOT EXISTS idx_products_workspace_saint_code
  ON products (
    workspace_id,
    saint_code
  );

COMMIT;
