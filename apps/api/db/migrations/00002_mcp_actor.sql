-- MCP clients act as a third non-human actor. Their tool calls are registered as agent actions
-- like the built-in agent's, and the OAuth client that made them is stored with the action.
-- +goose Up
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_actor_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_actor_type_check CHECK (actor_type IN ('human','ai','mcp','system'));
ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_actor_type_check;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_actor_type_check CHECK (actor_type IN ('human','ai','mcp','system'));
ALTER TABLE purchase_orders DROP CONSTRAINT purchase_orders_actor_type_check;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_actor_type_check CHECK (actor_type IN ('human','ai','mcp','system'));
ALTER TABLE agent_actions
  ADD COLUMN actor_type text NOT NULL DEFAULT 'ai' CHECK (actor_type IN ('ai','mcp')),
  ADD COLUMN client_id text CHECK (length(client_id) <= 512);

-- +goose Down
ALTER TABLE agent_actions DROP COLUMN client_id, DROP COLUMN actor_type;
ALTER TABLE purchase_orders DROP CONSTRAINT purchase_orders_actor_type_check;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_actor_type_check CHECK (actor_type IN ('human','ai','system'));
ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_actor_type_check;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_actor_type_check CHECK (actor_type IN ('human','ai','system'));
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_actor_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_actor_type_check CHECK (actor_type IN ('human','ai','system'));
