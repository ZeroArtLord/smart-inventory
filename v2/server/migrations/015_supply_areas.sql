CREATE TABLE IF NOT EXISTS areas (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id text NOT NULL,
  name text NOT NULL,
  name_normalized text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS areas_workspace_name_unique
  ON areas (workspace_id, lower(name));

CREATE INDEX IF NOT EXISTS areas_workspace_active_sort_idx
  ON areas (workspace_id, active, sort_order, name);
