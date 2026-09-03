BEGIN;

CREATE TABLE IF NOT EXISTS workspace_initial_loads (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id),
  run_id text NOT NULL,
  source text NOT NULL DEFAULT 'SAINT',
  document_id text NOT NULL,
  product_count integer NOT NULL DEFAULT 0,
  positive_stock_count integer NOT NULL DEFAULT 0,
  applied_by text,
  applied_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_initial_loads_run
  ON workspace_initial_loads(workspace_id, run_id);

COMMIT;
