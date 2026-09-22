BEGIN;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS barcodes jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE products
SET barcodes = jsonb_build_array(
  jsonb_build_object(
    'code', barcode,
    'label', 'Código principal',
    'conversion', 1,
    'active', true
  )
)
WHERE COALESCE(jsonb_array_length(barcodes), 0) = 0
  AND barcode IS NOT NULL
  AND btrim(barcode) <> '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_barcodes_array_check'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_barcodes_array_check
      CHECK (jsonb_typeof(barcodes) = 'array');
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_products_workspace_barcodes_gin
  ON products USING gin (barcodes);

COMMIT;
