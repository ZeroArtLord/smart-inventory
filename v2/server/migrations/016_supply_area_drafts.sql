CREATE TABLE IF NOT EXISTS supply_area_drafts (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_cart_id text NOT NULL,
  product_id text NOT NULL,
  product_name text NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  allocations jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, parent_cart_id, product_id)
);

CREATE INDEX IF NOT EXISTS supply_area_drafts_workspace_cart_idx
  ON supply_area_drafts (workspace_id, parent_cart_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS supply_area_drafts_workspace_product_idx
  ON supply_area_drafts (workspace_id, product_id, updated_at DESC);
