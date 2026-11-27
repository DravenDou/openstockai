-- Analytics read models for the dashboard and the agent. Single user, read only.
-- Cost basis = on-hand quantity x product cost price (active products only).
-- Outbound movement = sale, adjustment_out, return_out (transfers only relocate stock).

-- name: AnalyticsDashboardTotals :one
SELECT
 (SELECT count(*) FROM (
   SELECT p.id FROM products p LEFT JOIN inventory i ON i.product_id=p.id
   WHERE p.status='active' GROUP BY p.id,p.minimum HAVING coalesce(sum(i.quantity),0)<=p.minimum) low)::integer AS low_stock_count,
 (SELECT round(coalesce(sum(i.quantity*p.cost_price),0),2) FROM inventory i JOIN products p ON p.id=i.product_id WHERE p.status='active')::text AS stock_value,
 (SELECT count(*) FROM stock_movements WHERE created_at>=now()-interval '7 days')::integer AS movements_7d,
 (SELECT round(coalesce(sum(poi.quantity*poi.cost_price),0),2) FROM purchase_orders po JOIN purchase_order_items poi ON poi.purchase_id=po.id WHERE po.created_at>=now()-interval '30 days')::text AS purchase_spend_30d,
 (SELECT count(*) FROM purchase_orders WHERE created_at>=now()-interval '30 days')::integer AS purchases_30d;

-- name: AnalyticsRecentMovements :many
SELECT m.id,m.product_id,p.name AS product_name,m.warehouse_id,w.name AS warehouse_name,m.quantity,m.type,m.actor_type,m.created_at,u.symbol AS unit_symbol
FROM stock_movements m JOIN products p ON p.id=m.product_id JOIN warehouses w ON w.id=m.warehouse_id
JOIN measurement_units u ON u.code=p.unit_code
ORDER BY m.created_at DESC,m.id DESC LIMIT $1;

-- name: AnalyticsValuationTotal :one
SELECT round(coalesce(sum(i.quantity*p.cost_price),0),2)::text AS stock_value,
 count(DISTINCT p.id)::integer AS products
FROM inventory i JOIN products p ON p.id=i.product_id
WHERE p.status='active' AND i.quantity>0
AND (sqlc.arg(warehouse)::text='' OR i.warehouse_id=NULLIF(sqlc.arg(warehouse),'')::uuid)
AND (sqlc.arg(category)::text='' OR p.category_id=NULLIF(sqlc.arg(category),'')::uuid);

-- name: AnalyticsValuationByCategory :many
SELECT c.id AS category_id,coalesce(c.name,'Uncategorized')::text AS category_name,
 count(DISTINCT p.id)::integer AS products,
 round(sum(i.quantity*p.cost_price),2)::text AS stock_value
FROM inventory i JOIN products p ON p.id=i.product_id LEFT JOIN categories c ON c.id=p.category_id
WHERE p.status='active' AND i.quantity>0
AND (sqlc.arg(warehouse)::text='' OR i.warehouse_id=NULLIF(sqlc.arg(warehouse),'')::uuid)
AND (sqlc.arg(category)::text='' OR p.category_id=NULLIF(sqlc.arg(category),'')::uuid)
GROUP BY c.id,c.name ORDER BY sum(i.quantity*p.cost_price) DESC,2;

-- name: AnalyticsValuationByWarehouse :many
SELECT w.id AS warehouse_id,w.name AS warehouse_name,
 count(DISTINCT p.id)::integer AS products,
 round(sum(i.quantity*p.cost_price),2)::text AS stock_value
FROM inventory i JOIN products p ON p.id=i.product_id JOIN warehouses w ON w.id=i.warehouse_id
WHERE p.status='active' AND i.quantity>0
AND (sqlc.arg(warehouse)::text='' OR i.warehouse_id=NULLIF(sqlc.arg(warehouse),'')::uuid)
AND (sqlc.arg(category)::text='' OR p.category_id=NULLIF(sqlc.arg(category),'')::uuid)
GROUP BY w.id,w.name ORDER BY sum(i.quantity*p.cost_price) DESC,2;

-- name: AnalyticsTopMovers :many
SELECT p.id,p.name,p.sku,u.symbol AS unit_symbol,
 sum(-m.quantity)::numeric AS units_out,
 count(*)::integer AS movements,
 max(m.created_at)::timestamptz AS last_outbound_at,
 coalesce((SELECT sum(i.quantity) FROM inventory i WHERE i.product_id=p.id),0)::numeric AS on_hand
FROM stock_movements m JOIN products p ON p.id=m.product_id JOIN measurement_units u ON u.code=p.unit_code
WHERE p.status='active' AND m.quantity<0 AND m.type IN ('sale','adjustment_out','return_out')
AND m.created_at>=now()-make_interval(days=>sqlc.arg(days)::int)
GROUP BY p.id,u.symbol ORDER BY sum(-m.quantity) DESC,p.name LIMIT sqlc.arg(row_limit);

-- name: AnalyticsSlowMovers :many
SELECT p.id,p.name,p.sku,u.symbol AS unit_symbol,s.on_hand::numeric AS on_hand,
 coalesce(o.units_out,0)::numeric AS units_out,
 o.last_out::timestamptz AS last_outbound_at,
 round(s.on_hand*p.cost_price,2)::text AS stock_value
FROM products p JOIN measurement_units u ON u.code=p.unit_code
JOIN (SELECT product_id,sum(quantity) AS on_hand FROM inventory GROUP BY product_id HAVING sum(quantity)>0) s ON s.product_id=p.id
LEFT JOIN (
 SELECT product_id,
  sum(-quantity) FILTER (WHERE created_at>=now()-make_interval(days=>sqlc.arg(days)::int)) AS units_out,
  max(created_at) AS last_out
 FROM stock_movements WHERE quantity<0 AND type IN ('sale','adjustment_out','return_out') GROUP BY product_id) o ON o.product_id=p.id
WHERE p.status='active'
ORDER BY coalesce(o.units_out,0) ASC,s.on_hand*p.cost_price DESC,p.name LIMIT sqlc.arg(row_limit);

-- name: AnalyticsSupplierSpend :many
SELECT s.id AS supplier_id,coalesce(s.name,'No supplier')::text AS supplier_name,
 count(DISTINCT po.id)::integer AS purchases,
 round(sum(poi.quantity*poi.cost_price),2)::text AS spend,
 max(po.created_at)::timestamptz AS last_purchase_at
FROM purchase_orders po JOIN purchase_order_items poi ON poi.purchase_id=po.id LEFT JOIN suppliers s ON s.id=po.supplier_id
WHERE po.created_at>=sqlc.arg(from_at)::timestamptz AND po.created_at<sqlc.arg(to_at)::timestamptz
GROUP BY s.id,s.name ORDER BY sum(poi.quantity*poi.cost_price) DESC,2;

-- name: AnalyticsSupplierSpendTotal :one
SELECT round(coalesce(sum(poi.quantity*poi.cost_price),0),2)::text AS spend,count(DISTINCT po.id)::integer AS purchases
FROM purchase_orders po JOIN purchase_order_items poi ON poi.purchase_id=po.id
WHERE po.created_at>=sqlc.arg(from_at)::timestamptz AND po.created_at<sqlc.arg(to_at)::timestamptz;
