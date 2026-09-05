BEGIN;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS intelligence_mode text NOT NULL DEFAULT 'SEED',
  ADD COLUMN IF NOT EXISTS target_days numeric(10,3) NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS safety_days numeric(10,3) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_intelligence_mode_check'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_intelligence_mode_check
      CHECK (intelligence_mode IN ('SEED','ADAPTIVE','HARD_LIMIT'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_target_days_check'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_target_days_check
      CHECK (target_days > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_safety_days_check'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_safety_days_check
      CHECK (safety_days >= 0);
  END IF;
END
$$;

COMMIT;
