-- VIGÍA Monitor. Revisión semanal independiente de stock y de los documentos V2.
-- No altera ninguna tabla, dato ni cola de sincronización antigua.
CREATE TABLE IF NOT EXISTS monitor_weekly_review_items (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  week_start date NOT NULL,
  item_key text NOT NULL CHECK (length(item_key) BETWEEN 3 AND 240),
  kind text NOT NULL CHECK (kind IN ('PRODUCT','EXTRA')),
  product_id text,
  description text,
  decision text NOT NULL CHECK (decision IN ('UNREVIEWED','BUY','ORDER','NOT_NEEDED','PENDING')),
  quantity numeric CHECK (quantity > 0),
  unit text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  deleted boolean NOT NULL DEFAULT false,
  version integer NOT NULL CHECK (version > 0),
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, week_start, item_key),
  CHECK (
    (kind = 'PRODUCT' AND product_id IS NOT NULL AND item_key = 'product:' || product_id AND description IS NULL)
    OR
    (kind = 'EXTRA' AND product_id IS NULL AND item_key LIKE 'extra:%'
     AND description IS NOT NULL AND length(trim(description)) > 0)
  )
);
CREATE INDEX IF NOT EXISTS monitor_weekly_review_items_recent
  ON monitor_weekly_review_items(workspace_id, week_start DESC);

-- Replay idempotente: un mismo evento no se aplica dos veces.
CREATE TABLE IF NOT EXISTS monitor_weekly_review_mutations (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  mutation_id text NOT NULL CHECK (length(mutation_id) BETWEEN 8 AND 128),
  week_start date NOT NULL,
  item_key text NOT NULL,
  request_fingerprint text NOT NULL,
  version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, mutation_id)
);
CREATE INDEX IF NOT EXISTS monitor_weekly_review_mutations_week
  ON monitor_weekly_review_mutations(workspace_id, week_start);
