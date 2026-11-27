-- OpenStock AI baseline schema (single user, single tenant).
-- The auth schema matches Better Auth 1.7.7 (email/password + jwt plugin).
-- +goose Up
CREATE SCHEMA IF NOT EXISTS auth;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

create table auth."user" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table auth."session" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" uuid not null references auth."user" ("id") on delete cascade);

create table auth."account" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "accountId" text not null, "providerId" text not null, "userId" uuid not null references auth."user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);

create table auth."verification" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table auth."jwks" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "publicKey" text not null, "privateKey" text not null, "createdAt" timestamptz not null, "expiresAt" timestamptz, "alg" text, "crv" text);

create table auth."rateLimit" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

create index "session_userId_idx" on auth."session" ("userId");
create index "account_userId_idx" on auth."account" ("userId");
create index "verification_identifier_idx" on auth."verification" ("identifier");
-- Single-owner guarantee: at most one row can ever exist in auth."user".
create unique index "user_single_owner_idx" on auth."user" ((true));

CREATE TABLE measurement_units (
  code text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{0,23}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  symbol text NOT NULL CHECK (length(btrim(symbol)) BETWEEN 1 AND 16),
  decimals integer NOT NULL DEFAULT 0 CHECK (decimals BETWEEN 0 AND 3),
  active boolean NOT NULL DEFAULT true
);
-- Old Spanish codes: ud->pcs, caja->box, paq->pack; the rest are unchanged.
INSERT INTO measurement_units (code,name,symbol,decimals) VALUES
 ('pcs','Pieces','pcs',0), ('box','Boxes','box',0), ('pack','Packs','pack',0),
 ('kg','Kilograms','kg',3), ('g','Grams','g',3), ('l','Liters','l',3),
 ('ml','Milliliters','ml',3), ('m','Meters','m',3), ('m2','Square meters','m²',3);

CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO warehouses (name) VALUES ('Main warehouse');
CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  email text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES categories(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  sku text NOT NULL CHECK (length(btrim(sku)) BETWEEN 1 AND 80), barcode text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '', location text NOT NULL DEFAULT '', icon text NOT NULL DEFAULT 'package',
  unit_code text NOT NULL DEFAULT 'pcs' REFERENCES measurement_units(code),
  minimum numeric(18,3) NOT NULL DEFAULT 0 CHECK (minimum BETWEEN 0 AND 1000000000),
  cost_price numeric(18,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  sale_price numeric(18,2) NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX products_sku ON products (lower(sku));
CREATE INDEX products_category ON products (category_id);
CREATE INDEX products_unit ON products (unit_code);
CREATE INDEX products_status_name ON products (status,name,id);
-- One search expression index, rather than three indexes for name/SKU/barcode.
CREATE INDEX products_search_trgm ON products USING gin ((name || ' ' || sku || ' ' || barcode) gin_trgm_ops);

CREATE TABLE inventory (
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  product_id uuid NOT NULL REFERENCES products(id),
  quantity numeric(18,3) NOT NULL DEFAULT 0 CHECK (quantity BETWEEN 0 AND 1000000000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (warehouse_id,product_id)
);
-- Stock totals and product detail join by product, not by warehouse (the PK order).
CREATE INDEX inventory_product ON inventory (product_id,warehouse_id);

CREATE TABLE stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  quantity numeric(18,3) NOT NULL CHECK (quantity <> 0),
  type text NOT NULL CHECK (type IN ('initial','purchase','sale','adjustment_in','adjustment_out','transfer_in','transfer_out','return_in','return_out')),
  user_id text NOT NULL, actor_type text NOT NULL CHECK (actor_type IN ('human','ai','system')),
  reference text NOT NULL DEFAULT '', transfer_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX movements_date ON stock_movements (created_at DESC,id DESC);
CREATE INDEX movements_product ON stock_movements (product_id,created_at DESC);
CREATE INDEX movements_warehouse ON stock_movements (warehouse_id,created_at DESC,id DESC);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('human','ai','system')), action text NOT NULL,
  resource_type text NOT NULL, resource_id text NOT NULL, before jsonb, after jsonb,
  metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_date ON audit_logs (created_at DESC,id DESC);

CREATE TABLE idempotency_keys (
  user_id text NOT NULL, key uuid NOT NULL, operation text NOT NULL,
  request_hash text NOT NULL, response jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,key)
);

CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id), supplier_id uuid REFERENCES suppliers(id),
  reference text NOT NULL UNIQUE,
  user_id text NOT NULL, actor_type text NOT NULL CHECK (actor_type IN ('human','ai','system')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchases_date ON purchase_orders (created_at DESC,id DESC);
CREATE INDEX purchases_warehouse ON purchase_orders (warehouse_id);
CREATE INDEX purchases_supplier ON purchase_orders (supplier_id) WHERE supplier_id IS NOT NULL;
CREATE TABLE purchase_order_items (
  purchase_id uuid NOT NULL REFERENCES purchase_orders(id), product_id uuid NOT NULL REFERENCES products(id),
  quantity numeric(18,3) NOT NULL CHECK (quantity > 0), cost_price numeric(18,2) NOT NULL CHECK (cost_price >= 0),
  PRIMARY KEY (purchase_id,product_id)
);
CREATE INDEX purchase_items_product ON purchase_order_items (product_id);

CREATE TABLE agent_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL,
  conversation_id text NOT NULL, tool_name text NOT NULL, tool_input jsonb NOT NULL,
  result jsonb, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed')),
  approval_status text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected','not_required')),
  started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, error text
);
CREATE INDEX agent_actions_user_date ON agent_actions (user_id,started_at DESC);

CREATE TABLE agent_sessions (
  user_id text NOT NULL, session_id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_sessions_user ON agent_sessions (user_id);

-- Exactly one settings row; the migration seeds it and the API only updates it.
CREATE TABLE settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  settings jsonb NOT NULL
);
INSERT INTO settings (id,settings) VALUES (true,'{"store":"My store","email":"","currency":"USD","timezone":"UTC","automatic":true,"confirm":true,"lowStock":true,"voice":false}');

-- A correction creates a compensating movement, never edits the ledger.
-- +goose StatementBegin
CREATE FUNCTION forbid_ledger_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'immutable ledger'; END;
$$;
-- +goose StatementEnd
CREATE TRIGGER immutable_movements BEFORE UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION forbid_ledger_change();
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION forbid_ledger_change();

-- Separate runtime privileges from the owner used only by migrations.
-- +goose StatementBegin
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='openstock_api') THEN
    CREATE ROLE openstock_api NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='openstock_auth') THEN
    CREATE ROLE openstock_auth NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
-- +goose StatementEnd
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public,auth TO openstock_api;
GRANT SELECT ON auth."user",auth.session TO openstock_api;
-- FOR SHARE needs UPDATE on one column, never on tokens or other session data.
GRANT UPDATE ("createdAt") ON auth.session TO openstock_api;
GRANT USAGE ON SCHEMA auth TO openstock_auth;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA auth TO openstock_auth;

GRANT SELECT,INSERT,UPDATE ON categories,warehouses,suppliers,products,inventory,stock_movements,
  audit_logs,idempotency_keys,purchase_orders,purchase_order_items,agent_actions,agent_sessions,
  measurement_units TO openstock_api;
-- The settings row is seeded by this migration; the API can only read and update it.
GRANT SELECT,UPDATE ON settings TO openstock_api;
-- Ledger is append-only. Catalog deletion is constrained by existing references.
REVOKE UPDATE ON stock_movements,audit_logs FROM openstock_api;
GRANT DELETE ON categories,warehouses,suppliers TO openstock_api;

-- +goose Down
DROP SCHEMA auth CASCADE;
DROP TABLE settings,agent_sessions,agent_actions,purchase_order_items,purchase_orders,idempotency_keys,audit_logs,stock_movements,inventory,products,suppliers,warehouses,categories,measurement_units;
DROP FUNCTION forbid_ledger_change();
