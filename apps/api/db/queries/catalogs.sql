-- name: ListUnits :many
SELECT code,name,symbol,decimals,active FROM measurement_units ORDER BY name;

-- name: GetUnit :one
SELECT code,name,symbol,decimals,active FROM measurement_units WHERE code=$1 FOR SHARE;

-- name: SaveUnit :one
INSERT INTO measurement_units (code,name,symbol,decimals,active) VALUES ($1,$2,$3,$4,$5)
ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name,symbol=EXCLUDED.symbol,active=EXCLUDED.active
RETURNING code,name,symbol,decimals,active;

-- name: LockUnit :one
SELECT code,name,symbol,decimals,active FROM measurement_units WHERE code=$1 FOR UPDATE;

-- name: HasProductMovements :one
SELECT EXISTS(SELECT 1 FROM stock_movements WHERE product_id=$1);

-- name: ResolveCategory :one
INSERT INTO categories (name) VALUES ($1)
ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id;

-- name: InventorySummary :one
SELECT count(*)::integer AS products,
 count(*) FILTER (WHERE stock<=minimum)::integer AS low,
 count(*) FILTER (WHERE stock=0)::integer AS empty,
 round(coalesce(sum(stock*cost_price),0),2)::text AS stock_value
FROM (
 SELECT p.id,p.minimum,p.cost_price,coalesce(sum(i.quantity),0) AS stock
 FROM products p LEFT JOIN inventory i ON i.product_id=p.id
 WHERE p.status='active' GROUP BY p.id
) totals;

-- name: CountProducts :one
SELECT count(*)::integer FROM (
 SELECT p.id,p.minimum,coalesce(sum(i.quantity),0) AS stock
 FROM products p LEFT JOIN inventory i ON i.product_id=p.id AND (sqlc.arg(warehouse)::text='' OR i.warehouse_id=NULLIF(sqlc.arg(warehouse),'')::uuid)
 WHERE p.status=sqlc.arg(status)
 AND ((p.name || ' ' || p.sku || ' ' || p.barcode) ILIKE '%'||sqlc.arg(query)::text||'%')
 AND (sqlc.arg(category)::text='' OR p.category_id=NULLIF(sqlc.arg(category),'')::uuid) GROUP BY p.id
) p WHERE sqlc.arg(stock_filter)::text='' OR (sqlc.arg(stock_filter)='low' AND stock<=minimum) OR (sqlc.arg(stock_filter)='out' AND stock=0);

-- name: CountMovements :one
SELECT count(*)::integer FROM stock_movements m JOIN products p ON p.id=m.product_id
WHERE (sqlc.arg(product)::text='' OR m.product_id=NULLIF(sqlc.arg(product),'')::uuid)
AND (sqlc.arg(warehouse)::text='' OR m.warehouse_id=NULLIF(sqlc.arg(warehouse),'')::uuid)
AND (sqlc.arg(query)::text='' OR p.name ILIKE '%'||sqlc.arg(query)::text||'%' OR m.reference ILIKE '%'||sqlc.arg(query)::text||'%')
AND (sqlc.arg(kind)::text='' OR (sqlc.arg(kind)='in' AND m.quantity>0) OR (sqlc.arg(kind)='out' AND m.quantity<0) OR (sqlc.arg(kind)='adjustment' AND m.type LIKE 'adjustment_%') OR (sqlc.arg(kind)='return' AND m.type LIKE 'return_%') OR (sqlc.arg(kind)='transfer' AND m.type LIKE 'transfer_%'))
AND (sqlc.arg(since)::text='' OR m.created_at>=NULLIF(sqlc.arg(since)::text,'')::timestamptz);


-- name: UpdateCategory :one
UPDATE categories SET name=$2 WHERE id=$1 RETURNING id,name;
-- name: UpdateWarehouse :one
UPDATE warehouses SET name=$2 WHERE id=$1 RETURNING id,name;
-- name: UpdateSupplier :one
UPDATE suppliers SET name=$2,email=$3 WHERE id=$1 RETURNING id,name,email;
-- name: DeleteCategory :execrows
DELETE FROM categories WHERE id=$1;
-- name: DeleteWarehouse :execrows
DELETE FROM warehouses WHERE id=$1;
-- name: DeleteSupplier :execrows
DELETE FROM suppliers WHERE id=$1;
-- name: RestoreProduct :one
UPDATE products SET status='active',updated_at=now() WHERE id=$1 AND status='archived' RETURNING id,status;

-- name: LockCategory :one
SELECT id,name FROM categories WHERE id=$1 FOR UPDATE;
-- name: LockWarehouse :one
SELECT id,name FROM warehouses WHERE id=$1 FOR UPDATE;
-- name: LockSupplier :one
SELECT id,name,email FROM suppliers WHERE id=$1 FOR UPDATE;

-- name: GetLookup :one
SELECT c.id,c.name,''::text AS email FROM categories c
WHERE c.id=sqlc.arg(id) AND sqlc.arg(resource)::text='categories'
UNION ALL SELECT w.id,w.name,''::text AS email FROM warehouses w
WHERE w.id=sqlc.arg(id) AND sqlc.arg(resource)::text='warehouses'
UNION ALL SELECT s.id,s.name,s.email FROM suppliers s
WHERE s.id=sqlc.arg(id) AND sqlc.arg(resource)::text='suppliers';
