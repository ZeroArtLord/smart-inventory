BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_stock_nonnegative'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_stock_nonnegative
      CHECK (min_stock >= 0 AND max_stock >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_min_not_above_max'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_min_not_above_max
      CHECK (max_stock = 0 OR min_stock <= max_stock);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_purchase_conversion_positive'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_purchase_conversion_positive
      CHECK (purchase_conversion > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_replenishment_method_valid'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_replenishment_method_valid
      CHECK (replenishment_method IN ('PURCHASE','ORDER','BOTH','NONE'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'documents_type_valid'
  ) THEN
    ALTER TABLE documents
      ADD CONSTRAINT documents_type_valid
      CHECK (type IN ('COUNT','ENTRY','SUPPLY','ADJUSTMENT'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'documents_status_valid'
  ) THEN
    ALTER TABLE documents
      ADD CONSTRAINT documents_status_valid
      CHECK (
        status IN (
          'DRAFT','CLOSED','VERIFIED','READY_FOR_SAINT',
          'SENT_TO_SAINT','SAINT_PENDING','POSTED','CANCELLED'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'movements_quantity_nonnegative'
  ) THEN
    ALTER TABLE movements
      ADD CONSTRAINT movements_quantity_nonnegative
      CHECK (quantity >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'movements_delta_required'
  ) THEN
    ALTER TABLE movements
      ADD CONSTRAINT movements_delta_required
      CHECK (
        type NOT IN ('ADJUSTMENT','REVERSAL')
        OR delta IS NOT NULL
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'lots_quantities_valid'
  ) THEN
    ALTER TABLE lots
      ADD CONSTRAINT lots_quantities_valid
      CHECK (
        original_quantity >= 0
        AND remaining_quantity >= 0
        AND remaining_quantity <= original_quantity
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'lots_unit_cost_nonnegative'
  ) THEN
    ALTER TABLE lots
      ADD CONSTRAINT lots_unit_cost_nonnegative
      CHECK (unit_cost IS NULL OR unit_cost >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'replenishments_quantities_valid'
  ) THEN
    ALTER TABLE replenishments
      ADD CONSTRAINT replenishments_quantities_valid
      CHECK (
        requested_quantity > 0
        AND received_quantity >= 0
        AND pending_quantity >= 0
        AND received_quantity <= requested_quantity
        AND pending_quantity <= requested_quantity
      );
  END IF;
END $$;

COMMIT;
