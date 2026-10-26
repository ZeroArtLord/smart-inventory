-- Agenda y pedidos Monitor: sin operaciones de inventario.
CREATE TABLE IF NOT EXISTS monitor_suppliers (
 workspace_id uuid NOT NULL REFERENCES workspaces(id), id text NOT NULL,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
 phone text NOT NULL CHECK(phone ~ '^[1-9][0-9]{7,14}$'),
 active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS monitor_supplier_assignments (
 workspace_id uuid NOT NULL REFERENCES workspaces(id), week_start date NOT NULL,
 round_number integer NOT NULL CHECK(round_number>0),item_key text NOT NULL,supplier_id text NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,week_start,round_number,item_key),
 FOREIGN KEY(workspace_id,supplier_id) REFERENCES monitor_suppliers(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS monitor_supplier_orders (
 workspace_id uuid NOT NULL REFERENCES workspaces(id),id uuid NOT NULL DEFAULT gen_random_uuid(),
 week_start date NOT NULL,round_number integer NOT NULL CHECK(round_number>0),supplier_id text NOT NULL,
 supplier_snapshot jsonb NOT NULL,items jsonb NOT NULL CHECK(jsonb_typeof(items)='array'),
 fingerprint text NOT NULL,replaces_order_id uuid,
 status text NOT NULL DEFAULT 'FINALIZED' CHECK(status IN ('FINALIZED','SENT','REPLACED')),
 finalized_by uuid NOT NULL REFERENCES users(id),finalized_at timestamptz NOT NULL DEFAULT now(),
 sent_by uuid REFERENCES users(id),sent_at timestamptz,
 PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,supplier_id) REFERENCES monitor_suppliers(workspace_id,id),
 FOREIGN KEY(workspace_id,replaces_order_id) REFERENCES monitor_supplier_orders(workspace_id,id)
);
CREATE INDEX IF NOT EXISTS monitor_supplier_orders_recent ON monitor_supplier_orders(workspace_id,week_start,round_number,finalized_at DESC);
CREATE TABLE IF NOT EXISTS monitor_supplier_preferences (
 workspace_id uuid NOT NULL,product_id text NOT NULL,supplier_id text NOT NULL,
 uses integer NOT NULL DEFAULT 1 CHECK(uses>0),last_confirmed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,product_id,supplier_id),
 FOREIGN KEY(workspace_id,product_id) REFERENCES products(workspace_id,id),
 FOREIGN KEY(workspace_id,supplier_id) REFERENCES monitor_suppliers(workspace_id,id)
);
