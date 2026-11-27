-- name: ListProducts :many
SELECT p.id, p.name, p.sku, p.barcode, p.description, p.location, p.icon, p.minimum, p.unit_code, u.symbol AS unit_symbol, u.name AS unit_name, u.decimals AS unit_decimals,
  p.category_id, coalesce(c.name,'')::text AS category, p.cost_price::text AS cost_price,
  p.sale_price::text AS sale_price, coalesce(sum(i.quantity),0)::numeric AS stock
FROM products p JOIN measurement_units u ON u.code=p.unit_code LEFT JOIN categories c ON c.id=p.category_id
LEFT JOIN inventory i ON i.product_id=p.id AND (sqlc.arg(warehouse)::text='' OR i.warehouse_id=NULLIF(sqlc.arg(warehouse),'')::uuid)
WHERE p.status=sqlc.arg(status)
AND ((p.name || ' ' || p.sku || ' ' || p.barcode) ILIKE '%'||sqlc.arg(query)::text||'%')
AND (sqlc.arg(category)::text='' OR p.category_id=NULLIF(sqlc.arg(category),'')::uuid)
GROUP BY p.id,c.name,u.symbol,u.name,u.decimals
HAVING (sqlc.arg(stock_filter)::text='' OR (sqlc.arg(stock_filter)='low' AND coalesce(sum(i.quantity),0)<=p.minimum) OR (sqlc.arg(stock_filter)='out' AND coalesce(sum(i.quantity),0)=0))
ORDER BY p.name,p.id LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);

-- name: ExportProducts :many
SELECT p.id, p.name, p.sku, p.barcode, p.description, p.location, p.icon, p.minimum, p.unit_code, u.symbol AS unit_symbol, u.name AS unit_name, u.decimals AS unit_decimals,
  p.category_id, coalesce(c.name,'')::text AS category, p.cost_price::text AS cost_price,
  p.sale_price::text AS sale_price, coalesce(sum(i.quantity),0)::numeric AS stock
FROM products p JOIN measurement_units u ON u.code=p.unit_code LEFT JOIN categories c ON c.id=p.category_id
LEFT JOIN inventory i ON i.product_id=p.id AND (sqlc.arg(warehouse)::text='' OR i.warehouse_id=NULLIF(sqlc.arg(warehouse),'')::uuid)
WHERE p.status=sqlc.arg(status)
AND ((p.name || ' ' || p.sku || ' ' || p.barcode) ILIKE '%'||sqlc.arg(query)::text||'%')
AND (sqlc.arg(category)::text='' OR p.category_id=NULLIF(sqlc.arg(category),'')::uuid)
AND (sqlc.arg(after_id)::text='' OR p.id>NULLIF(sqlc.arg(after_id),'')::uuid)
GROUP BY p.id,c.name,u.symbol,u.name,u.decimals
HAVING (sqlc.arg(stock_filter)::text='' OR (sqlc.arg(stock_filter)='low' AND coalesce(sum(i.quantity),0)<=p.minimum) OR (sqlc.arg(stock_filter)='out' AND coalesce(sum(i.quantity),0)=0))
ORDER BY p.id LIMIT sqlc.arg(page_limit);

-- name: GetProduct :one
SELECT * FROM products WHERE id=$1 AND status='active';

-- name: GetProductView :one
SELECT p.id,p.name,p.sku,p.barcode,p.description,p.location,p.icon,p.minimum,p.unit_code,u.symbol AS unit_symbol,u.name AS unit_name,u.decimals AS unit_decimals,p.category_id,coalesce(c.name,'')::text AS category,
p.cost_price::text AS cost_price,p.sale_price::text AS sale_price,coalesce(sum(i.quantity),0)::numeric AS stock
FROM products p JOIN measurement_units u ON u.code=p.unit_code LEFT JOIN categories c ON c.id=p.category_id
LEFT JOIN inventory i ON i.product_id=p.id
WHERE p.id=$1 AND p.status='active' GROUP BY p.id,c.name,u.symbol,u.name,u.decimals;

-- name: GetProductViewBySKU :one
SELECT p.id,p.name,p.sku,p.barcode,p.description,p.location,p.icon,p.minimum,p.unit_code,u.symbol AS unit_symbol,u.name AS unit_name,u.decimals AS unit_decimals,p.category_id,coalesce(c.name,'')::text AS category,
p.cost_price::text AS cost_price,p.sale_price::text AS sale_price,coalesce(sum(i.quantity),0)::numeric AS stock
FROM products p JOIN measurement_units u ON u.code=p.unit_code LEFT JOIN categories c ON c.id=p.category_id
LEFT JOIN inventory i ON i.product_id=p.id
WHERE lower(p.sku)=lower($1) AND p.status='active' GROUP BY p.id,c.name,u.symbol,u.name,u.decimals;

-- name: ProductStock :one
SELECT coalesce(sum(quantity),0)::numeric FROM inventory WHERE product_id=$1;

-- name: LockProduct :one
SELECT * FROM products WHERE id=$1 AND status='active' FOR UPDATE;

-- name: CreateProduct :one
INSERT INTO products (name,sku,category_id,cost_price,sale_price,minimum,description,location,icon,barcode,unit_code)
VALUES ($1,$2,$3,$4::numeric,$5::numeric,$6,$7,$8,$9,$10,$11) RETURNING id;

-- name: UpdateProduct :exec
UPDATE products SET name=$2,category_id=$3,cost_price=$4::numeric,sale_price=$5::numeric,minimum=$6,
description=$7,location=$8,barcode=$9,unit_code=$10,updated_at=now() WHERE id=$1;

-- name: ArchiveProduct :exec
UPDATE products SET status='archived',updated_at=now() WHERE id=$1;

-- name: ListCategories :many
SELECT id,name FROM categories WHERE name ILIKE '%'||$1::text||'%' ORDER BY name,id LIMIT $2 OFFSET $3;
-- name: CreateCategory :one
INSERT INTO categories (name) VALUES ($1) RETURNING id,name;
-- name: ListWarehouses :many
SELECT id,name FROM warehouses WHERE name ILIKE '%'||$1::text||'%' ORDER BY created_at,id LIMIT $2 OFFSET $3;
-- name: CreateWarehouse :one
INSERT INTO warehouses (name) VALUES ($1) RETURNING id,name;
-- name: ListSuppliers :many
SELECT id,name,email FROM suppliers WHERE name ILIKE '%'||$1::text||'%' ORDER BY name,id LIMIT $2 OFFSET $3;
-- name: CreateSupplier :one
INSERT INTO suppliers (name,email) VALUES ($1,$2) RETURNING id,name,email;

-- name: EnsureInventory :exec
INSERT INTO inventory (warehouse_id,product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING;
-- name: LockInventory :one
SELECT quantity FROM inventory WHERE warehouse_id=$1 AND product_id=$2 FOR UPDATE;
-- name: SetInventory :exec
UPDATE inventory SET quantity=$3,updated_at=now() WHERE warehouse_id=$1 AND product_id=$2;
-- name: GetInventory :many
SELECT warehouse_id,product_id,quantity FROM inventory
WHERE (sqlc.arg(product)::text='' OR product_id=NULLIF(sqlc.arg(product)::text,'')::uuid)
AND (sqlc.arg(warehouse)::text='' OR warehouse_id=NULLIF(sqlc.arg(warehouse)::text,'')::uuid)
ORDER BY warehouse_id,product_id LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);
-- name: RecordMovement :one
INSERT INTO stock_movements (product_id,warehouse_id,quantity,type,user_id,actor_type,reference,transfer_id)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id;
-- name: ListMovements :many
SELECT m.id,m.product_id,m.warehouse_id,m.quantity,m.type,m.actor_type,m.user_id,m.reference,m.created_at,p.name,p.unit_code,u.symbol AS unit_symbol
FROM stock_movements m JOIN products p ON p.id=m.product_id
JOIN measurement_units u ON u.code=p.unit_code
WHERE (sqlc.arg(product)::text='' OR m.product_id=NULLIF(sqlc.arg(product),'')::uuid)
AND (sqlc.arg(warehouse)::text='' OR m.warehouse_id=NULLIF(sqlc.arg(warehouse),'')::uuid)
AND (sqlc.arg(query)::text='' OR p.name ILIKE '%'||sqlc.arg(query)::text||'%' OR m.reference ILIKE '%'||sqlc.arg(query)::text||'%')
AND (sqlc.arg(kind)::text='' OR (sqlc.arg(kind)='in' AND m.quantity>0) OR (sqlc.arg(kind)='out' AND m.quantity<0) OR (sqlc.arg(kind)='adjustment' AND m.type LIKE 'adjustment_%') OR (sqlc.arg(kind)='return' AND m.type LIKE 'return_%') OR (sqlc.arg(kind)='transfer' AND m.type LIKE 'transfer_%'))
AND (sqlc.arg(since)::text='' OR m.created_at>=NULLIF(sqlc.arg(since)::text,'')::timestamptz)
ORDER BY m.created_at DESC,m.id DESC LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);

-- name: RecordAudit :exec
INSERT INTO audit_logs (user_id,actor_type,action,resource_type,resource_id,before,after,metadata)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8);
-- name: ClaimIdempotency :exec
INSERT INTO idempotency_keys (user_id,key,operation,request_hash) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING;
-- name: LockIdempotency :one
SELECT operation,request_hash,response FROM idempotency_keys WHERE user_id=$1 AND key=$2 FOR UPDATE;
-- name: CompleteIdempotency :exec
UPDATE idempotency_keys SET response=$3 WHERE user_id=$1 AND key=$2;

-- name: GetSettings :one
SELECT settings FROM settings WHERE id;
-- name: SaveSettings :exec
UPDATE settings SET settings=$1 WHERE id;

-- name: CreatePurchase :one
INSERT INTO purchase_orders (warehouse_id,supplier_id,reference,user_id,actor_type) VALUES ($1,$2,$3,$4,$5) RETURNING id;
-- name: RecordPurchaseItem :exec
INSERT INTO purchase_order_items (purchase_id,product_id,quantity,cost_price) VALUES ($1,$2,$3,$4::numeric);
-- name: ListPurchases :many
SELECT id,reference,warehouse_id,supplier_id,created_at FROM purchase_orders ORDER BY created_at DESC LIMIT $1 OFFSET $2;

-- name: CreateAgentAction :one
INSERT INTO agent_actions (id,user_id,conversation_id,tool_name,tool_input,approval_status,actor_type,client_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING RETURNING id;

-- name: LowStock :many
SELECT p.id,p.name,p.sku,p.minimum,p.unit_code,u.symbol AS unit_symbol,coalesce(sum(i.quantity),0)::numeric AS stock
FROM products p JOIN measurement_units u ON u.code=p.unit_code LEFT JOIN inventory i ON i.product_id=p.id
WHERE p.status='active' GROUP BY p.id,u.symbol HAVING coalesce(sum(i.quantity),0)<=p.minimum ORDER BY p.name LIMIT $1 OFFSET $2;

-- name: ListAudit :many
SELECT id,user_id,actor_type,action,resource_type,resource_id,before,after,metadata,created_at
FROM audit_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2;

-- name: ListAgentActions :many
SELECT id,conversation_id,tool_name,tool_input,result,status,approval_status,started_at,completed_at,error
FROM agent_actions WHERE user_id=$1 ORDER BY started_at DESC LIMIT 100;
-- name: GetAgentAction :one
SELECT * FROM agent_actions WHERE user_id=$1 AND id=$2 FOR UPDATE;
-- name: ReadAgentAction :one
SELECT * FROM agent_actions WHERE user_id=$1 AND id=$2;
-- name: ApproveAgentAction :execrows
UPDATE agent_actions SET approval_status=$3 WHERE user_id=$1 AND id=$2 AND status='pending' AND approval_status='pending';
-- name: CompleteAgentAction :exec
UPDATE agent_actions SET result=$3,status=$4,error=$5,completed_at=now() WHERE user_id=$1 AND id=$2;
