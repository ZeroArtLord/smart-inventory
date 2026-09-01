BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_movements_single_reversal
  ON movements(workspace_id, reversed_movement_id)
  WHERE reversed_movement_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_movements_workspace_document
  ON movements(workspace_id, document_id, created_at);

CREATE INDEX IF NOT EXISTS idx_movements_workspace_lot
  ON movements(workspace_id, lot_id, created_at)
  WHERE lot_id IS NOT NULL;

COMMIT;
