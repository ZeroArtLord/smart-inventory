-- VIGÍA Monitor: surtidos operativos sin libro de existencias.
-- Migración ADITIVA: no modifica documents, movements, stock ni colas V2.
CREATE TABLE IF NOT EXISTS monitor_supply_deliveries (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  id text NOT NULL CHECK (char_length(id) BETWEEN 8 AND 128),
  operational_date date NOT NULL,
  destination_area_id text NOT NULL,
  destination_area_name text NOT NULL,
  notes text NOT NULL DEFAULT '',
  lines jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) > 0),
  request_fingerprint char(64) NOT NULL,
  recorded_by uuid NOT NULL REFERENCES users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);

CREATE INDEX IF NOT EXISTS monitor_supply_deliveries_date_idx
  ON monitor_supply_deliveries(workspace_id, operational_date DESC, recorded_at DESC);
CREATE INDEX IF NOT EXISTS monitor_supply_deliveries_area_idx
  ON monitor_supply_deliveries(workspace_id, destination_area_id, operational_date DESC);
