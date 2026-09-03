BEGIN;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS presentations jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE products
SET presentations = jsonb_build_array(
  jsonb_build_object(
    'id', 'presentation_primary',
    'unitId', purchase_unit_id,
    'code', NULL,
    'name', NULL,
    'conversion', purchase_conversion,
    'primary', true,
    'active', true
  )
)
WHERE presentations = '[]'::jsonb
  AND purchase_unit_id IS NOT NULL
  AND (
    purchase_unit_id IS DISTINCT FROM inventory_unit_id
    OR ABS(purchase_conversion - 1) > 0.000001
  );

COMMIT;
