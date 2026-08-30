BEGIN;

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS workspace_key text;

UPDATE workspaces
SET workspace_key = COALESCE(workspace_key, 'workspace-' || id::text)
WHERE workspace_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_workspace_key
  ON workspaces(workspace_key);

COMMIT;
