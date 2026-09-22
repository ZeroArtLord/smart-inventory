ALTER TABLE areas
  ADD COLUMN IF NOT EXISTS shortcut_key text NULL;

UPDATE areas
SET shortcut_key = NULLIF(upper(trim(shortcut_key)), '')
WHERE shortcut_key IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'areas_shortcut_key_format'
  ) THEN
    ALTER TABLE areas
      ADD CONSTRAINT areas_shortcut_key_format
      CHECK (
        shortcut_key IS NULL
        OR shortcut_key ~ '^[A-Z0-9]$'
      );
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS areas_workspace_shortcut_unique
  ON areas (workspace_id, shortcut_key)
  WHERE shortcut_key IS NOT NULL;
