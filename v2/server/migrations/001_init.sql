BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_auth_id text UNIQUE,
  email text,
  display_name text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role_code text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS categories (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  id text NOT NULL,
  name text NOT NULL,
  name_normalized text,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS suppliers (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  id text NOT NULL,
  name text NOT NULL,
  name_normalized text,
  phone text,
  email text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS locations (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  id text NOT NULL,
  name text NOT NULL,
  name_normalized text,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS products (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  id text NOT NULL,
  sku text,
  name text NOT NULL,
  name_normalized text,
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  barcode text,
  category_id text,
  inventory_unit_id text,
  purchase_unit_id text,
  purchase_conversion numeric(18,6) NOT NULL DEFAULT 1,
  min_stock numeric(18,6) NOT NULL DEFAULT 0,
  max_stock numeric(18,6) NOT NULL DEFAULT 0,
  replenishment_method text NOT NULL DEFAULT 'BOTH',
  supplier_id text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);

CREATE INDEX IF NOT EXISTS idx_products_workspace_name
  ON products(workspace_id, name_normalized);

CREATE INDEX IF NOT EXISTS idx_products_workspace_barcode
  ON products(workspace_id, barcode);

CREATE TABLE IF NOT EXISTS documents (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  id text NOT NULL,
  type text NOT NULL,
  status text NOT NULL,
  owner_id text,
  location_id text,
  destination_id text,
  supplier_id text,
  reference text,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  closed_at timestamptz,
  closed_by text,
  PRIMARY KEY (workspace_id, id)
);

CREATE INDEX IF NOT EXISTS idx_documents_workspace_status
  ON documents(workspace_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS document_lines (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  id text NOT NULL,
  document_id text NOT NULL,
  product_id text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

CREATE INDEX IF NOT EXISTS idx_document_lines_document
  ON document_lines(workspace_id, document_id);

CREATE TABLE IF NOT EXISTS lots (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  id text NOT NULL,
  product_id text NOT NULL,
  lot_number text,
  received_at timestamptz NOT NULL,
  expires_at timestamptz,
  original_quantity numeric(18,6) NOT NULL,
  remaining_quantity numeric(18,6) NOT NULL,
  unit_cost numeric(18,6),
  supplier_id text,
  document_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

CREATE INDEX IF NOT EXISTS idx_lots_expiration
  ON lots(workspace_id, expires_at)
  WHERE remaining_quantity > 0;

CREATE TABLE IF NOT EXISTS movements (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  id text NOT NULL,
  product_id text NOT NULL,
  type text NOT NULL CHECK (type IN ('ENTRY','SUPPLY','ADJUSTMENT','TRANSFER','REVERSAL')),
  quantity numeric(18,6) NOT NULL DEFAULT 0,
  delta numeric(18,6),
  document_id text,
  lot_id text,
  location_id text,
  user_id text,
  reversed_movement_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

CREATE INDEX IF NOT EXISTS idx_movements_product_effective
  ON movements(workspace_id, product_id, effective_at);

CREATE TABLE IF NOT EXISTS sync_events (
  server_seq bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  client_event_id text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  operation text NOT NULL,
  payload jsonb NOT NULL,
  user_id text,
  applied_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, client_event_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_events_workspace_seq
  ON sync_events(workspace_id, server_seq);

CREATE OR REPLACE FUNCTION reject_movement_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Inventory movements are immutable; create a REVERSAL instead';
END;
$$;

DROP TRIGGER IF EXISTS movements_no_update ON movements;
CREATE TRIGGER movements_no_update
BEFORE UPDATE OR DELETE ON movements
FOR EACH ROW
EXECUTE FUNCTION reject_movement_mutation();

CREATE OR REPLACE VIEW inventory_stock AS
SELECT
  workspace_id,
  product_id,
  location_id,
  SUM(
    CASE
      WHEN type = 'ENTRY' THEN quantity
      WHEN type = 'SUPPLY' THEN -quantity
      WHEN type IN ('ADJUSTMENT','REVERSAL') THEN COALESCE(delta, 0)
      ELSE 0
    END
  ) AS stock
FROM movements
GROUP BY workspace_id, product_id, location_id;

COMMIT;
