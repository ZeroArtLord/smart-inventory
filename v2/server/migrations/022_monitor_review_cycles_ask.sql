-- VIGÍA Monitor: ciclos repetibles sin afectar inventario ni documentos V2.
-- La tabla de revisión semanal conserva SOLO el borrador activo; cada cierre
-- conserva íntegro el estado anterior en JSONB inmutable (misma transacción).
-- Al crear un ciclo nuevo nunca se borran auditorías o archivos de compras V2.
CREATE TABLE IF NOT EXISTS monitor_review_cycles (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  week_start date NOT NULL,
  current_round integer NOT NULL DEFAULT 1 CHECK (current_round > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,week_start)
);
CREATE TABLE IF NOT EXISTS monitor_review_archives (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  week_start date NOT NULL,
  round_number integer NOT NULL CHECK (round_number > 0),
  items jsonb NOT NULL CHECK (jsonb_typeof(items)='array'),
  total_products integer NOT NULL CHECK (total_products >= 0),
  counts jsonb NOT NULL CHECK (jsonb_typeof(counts)='object'),
  closed_by uuid NOT NULL REFERENCES users(id),
  closed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,week_start,round_number)
);
CREATE INDEX IF NOT EXISTS monitor_review_archives_recent
  ON monitor_review_archives(workspace_id,closed_at DESC);
-- Compatibilidad: los registros antiguos de revisión continúan en ciclo 1.
INSERT INTO monitor_review_cycles(workspace_id,week_start,current_round)
SELECT DISTINCT workspace_id,week_start,1
FROM monitor_weekly_review_items
ON CONFLICT (workspace_id,week_start) DO NOTHING;
ALTER TABLE monitor_weekly_review_items
  DROP CONSTRAINT IF EXISTS monitor_weekly_review_items_decision_check;
ALTER TABLE monitor_weekly_review_items
  ADD CONSTRAINT monitor_weekly_review_items_decision_check
  CHECK (decision IN ('UNREVIEWED','BUY','ORDER','NOT_NEEDED','PENDING','ASK'));
