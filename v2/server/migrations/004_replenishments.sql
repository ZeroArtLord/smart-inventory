BEGIN;

CREATE TABLE IF NOT EXISTS replenishments (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  id text NOT NULL,
  product_id text NOT NULL,
  product_name text,
  supplier_id text,
  method text NOT NULL CHECK (method IN ('PURCHASE','ORDER')),
  status text NOT NULL CHECK (
    status IN (
      'DRAFT',
      'ORDERED',
      'IN_TRANSIT',
      'PARTIALLY_RECEIVED',
      'RECEIVED',
      'CANCELLED'
    )
  ),
  requested_quantity numeric(18,6) NOT NULL,
  received_quantity numeric(18,6) NOT NULL DEFAULT 0,
  pending_quantity numeric(18,6) NOT NULL,
  expected_at timestamptz,
  reference text,
  notes text,
  owner_id text,
  source_suggestion jsonb,
  receipt_documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  ordered_at timestamptz,
  received_at timestamptz,
  cancelled_at timestamptz,
  updated_by text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

CREATE INDEX IF NOT EXISTS idx_replenishments_workspace_status
  ON replenishments(workspace_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_replenishments_workspace_product
  ON replenishments(workspace_id, product_id, status);

CREATE INDEX IF NOT EXISTS idx_replenishments_workspace_supplier
  ON replenishments(workspace_id, supplier_id, status);

COMMIT;
