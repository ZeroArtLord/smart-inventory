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

CREATE TABLE IF NOT EXISTS supply_area_deliveries (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  delivery_token text NOT NULL,
  delivery_id text NOT NULL,
  parent_cart_id text NOT NULL,
  payload jsonb NOT NULL,
  closed_at timestamptz NOT NULL,
  created_by text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, delivery_token)
);

CREATE INDEX IF NOT EXISTS supply_area_deliveries_workspace_closed_idx
  ON supply_area_deliveries (workspace_id, closed_at DESC);

CREATE INDEX IF NOT EXISTS supply_area_deliveries_workspace_delivery_idx
  ON supply_area_deliveries (workspace_id, delivery_id);
