-- name: PurchaseHistory :many
SELECT p.id,p.reference,p.created_at,w.name AS warehouse,coalesce(s.name,'')::text AS supplier,
 round(coalesce((SELECT sum(round(i.quantity*i.cost_price,2)) FROM purchase_order_items i WHERE i.purchase_id=p.id),0),2)::text AS total
FROM purchase_orders p JOIN warehouses w ON w.id=p.warehouse_id
LEFT JOIN suppliers s ON s.id=p.supplier_id
WHERE (sqlc.arg(query)::text='' OR p.reference ILIKE '%'||sqlc.arg(query)::text||'%' OR s.name ILIKE '%'||sqlc.arg(query)::text||'%')
AND (sqlc.arg(before_id)::text='' OR (p.created_at,p.id)<(NULLIF(sqlc.arg(before_date)::text,'')::timestamptz,NULLIF(sqlc.arg(before_id)::text,'')::uuid))
ORDER BY p.created_at DESC,p.id DESC LIMIT sqlc.arg(page_limit);

-- name: PurchaseHeader :one
SELECT p.id,p.reference,p.created_at,p.actor_type,w.name AS warehouse,coalesce(s.name,'')::text AS supplier,
 round(coalesce((SELECT sum(round(i.quantity*i.cost_price,2)) FROM purchase_order_items i WHERE i.purchase_id=p.id),0),2)::text AS total
FROM purchase_orders p JOIN warehouses w ON w.id=p.warehouse_id
LEFT JOIN suppliers s ON s.id=p.supplier_id
WHERE p.id=$1;

-- name: PurchaseLines :many
SELECT i.product_id,p.name,p.sku,i.quantity,i.cost_price::text AS cost_price,u.symbol AS unit_symbol,
 round(i.quantity*i.cost_price,2)::text AS total
FROM purchase_order_items i JOIN products p ON p.id=i.product_id
JOIN measurement_units u ON u.code=p.unit_code
WHERE i.purchase_id=$1 ORDER BY p.name,p.id;

-- name: AuditHistory :many
SELECT a.id,a.user_id,coalesce(u.name,'Deleted user')::text AS user_name,a.actor_type,a.action,a.resource_type,a.resource_id,a.before,a.after,a.metadata,a.created_at
FROM audit_logs a LEFT JOIN auth."user" u ON u.id=CASE WHEN a.user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN a.user_id::uuid END
WHERE (sqlc.arg(actor)::text='' OR a.actor_type=sqlc.arg(actor))
AND (sqlc.arg(query)::text='' OR a.action ILIKE '%'||sqlc.arg(query)::text||'%' OR a.resource_type ILIKE '%'||sqlc.arg(query)::text||'%')
AND (sqlc.arg(before_id)::text='' OR (a.created_at,a.id)<(NULLIF(sqlc.arg(before_date)::text,'')::timestamptz,NULLIF(sqlc.arg(before_id)::text,'')::uuid))
ORDER BY a.created_at DESC,a.id DESC LIMIT sqlc.arg(page_limit);
