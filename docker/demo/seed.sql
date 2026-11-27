-- Demo data: "Ironwood Hardware", a fictional English-language hardware store.
-- ~60 products, 3 warehouses, 6 suppliers, 15 purchases and 90 days of stock movements,
-- with a few products below their minimum. All dates are relative to now().
--
-- Run by the `seed-demo` compose service (profile `demo`) as the database owner:
--   docker compose --profile demo up -d
-- Safe to re-run: it does nothing when the demo is already loaded or when the catalog is
-- not empty, so it never mixes with real data. It creates no users or credentials.
-- Seed rows belong to the 'system' actor with the nil UUID as user_id, because the API
-- contract types every user_id as a UUID (Better Auth generates UUID user ids).
-- The ledger is append-only, so the script only ever INSERTs into stock_movements, and
-- inventory is derived from the ledger and verified against it before commit.
\set ON_ERROR_STOP on
SELECT NOT EXISTS (SELECT 1 FROM audit_logs WHERE action = 'demo.seed')
   AND NOT EXISTS (SELECT 1 FROM products) AS fresh \gset
\if :fresh
DO $$ BEGIN PERFORM pg_advisory_xact_lock(727274); END $$;

INSERT INTO categories (name) VALUES
 ('Fasteners'), ('Hand Tools'), ('Power Tools'), ('Plumbing'),
 ('Electrical'), ('Paint & Supplies'), ('Garden & Outdoor'), ('Safety & Workwear');

INSERT INTO warehouses (name) VALUES ('Downtown Store'), ('Overflow Yard') ON CONFLICT (name) DO NOTHING;

CREATE TEMP TABLE seed_suppliers (idx int PRIMARY KEY, name text, email text, id uuid);
INSERT INTO seed_suppliers (idx, name, email) VALUES
 (1, 'Ridgeline Fasteners Co.',           'orders@ridgeline-fasteners.example'),
 (2, 'Cobalt Tool Works',                 'sales@cobalt-tools.example'),
 (3, 'Voltra Power Equipment',            'wholesale@voltra-power.example'),
 (4, 'Clearwater Plumbing Supply',        'orders@clearwater-plumbing.example'),
 (5, 'Brightline Electrical Distributors','desk@brightline-electrical.example'),
 (6, 'Greenfield Paint & Garden Wholesale','orders@greenfield-wholesale.example');
INSERT INTO suppliers (name, email) SELECT name, email FROM seed_suppliers;
UPDATE seed_suppliers s SET id = x.id FROM suppliers x WHERE x.name = s.name;

-- flag: '' normal, 'low' ends below its minimum, 'zero' ends out of stock, 'bulk' is also
-- stocked in the Overflow Yard.
CREATE TEMP TABLE seed_raw (
  sku text, name text, cat text, unit text, cost numeric, price numeric, minimum numeric,
  rate numeric, sup int, loc text, flag text);
INSERT INTO seed_raw VALUES
 ('FAS-1001','Wood Screws #8 x 1-1/2" (box of 100)','Fasteners','box',4.20,7.99,20,3.0,1,'A1-01',''),
 ('FAS-1002','Drywall Screws 1-5/8" (1 lb box)','Fasteners','box',5.10,9.49,15,2.5,1,'A1-02',''),
 ('FAS-1003','Deck Screws 3" (5 lb pack)','Fasteners','pack',18.40,29.99,8,0.8,1,'A1-03','low'),
 ('FAS-1004','Hex Bolts 1/2" x 3" (pack of 25)','Fasteners','pack',9.80,16.49,10,0.9,1,'A1-04',''),
 ('FAS-1005','Zinc Flat Washers 3/8" (pack of 100)','Fasteners','pack',3.60,6.99,12,1.2,1,'A1-05',''),
 ('FAS-1006','Lock Nuts 1/4"-20 (pack of 50)','Fasteners','pack',4.10,7.79,10,0.7,1,'A1-06',''),
 ('FAS-1007','Concrete Anchors 1/4" x 2-1/4" (pack of 20)','Fasteners','pack',6.30,11.99,8,0.6,1,'A1-07',''),
 ('FAS-1008','Common Nails 16d (5 lb box)','Fasteners','box',11.20,18.99,6,0.5,1,'A1-08','bulk'),
 ('FAS-1009','Cable Ties 8" Black (pack of 100)','Fasteners','pack',2.90,5.99,12,1.4,1,'A1-09',''),
 ('FAS-1010','Picture Hanging Kit','Fasteners','pcs',3.10,6.49,10,0.8,1,'A1-10',''),
 ('HND-2001','Claw Hammer 16 oz','Hand Tools','pcs',9.50,18.99,6,0.35,2,'B1-01',''),
 ('HND-2002','Tape Measure 25 ft','Hand Tools','pcs',6.40,12.99,8,0.6,2,'B1-02',''),
 ('HND-2003','Adjustable Wrench 10"','Hand Tools','pcs',8.20,16.49,5,0.3,2,'B1-03',''),
 ('HND-2004','Screwdriver Set 12-Piece','Hand Tools','pcs',11.60,22.99,5,0.35,2,'B1-04',''),
 ('HND-2005','Slip-Joint Pliers 8"','Hand Tools','pcs',5.90,11.99,6,0.3,2,'B1-05',''),
 ('HND-2006','Hand Saw 20"','Hand Tools','pcs',9.10,17.99,4,0.15,2,'B1-06','low'),
 ('HND-2007','Utility Knife with 10 Blades','Hand Tools','pcs',4.30,8.99,8,0.5,2,'B1-07',''),
 ('HND-2008','Torpedo Level 9"','Hand Tools','pcs',5.50,10.99,4,0.2,2,'B1-08',''),
 ('PWR-3001','Cordless Drill 20V Kit','Power Tools','pcs',62.00,99.00,3,0.12,3,'C1-01',''),
 ('PWR-3002','Circular Saw 7-1/4"','Power Tools','pcs',54.00,89.99,2,0.07,3,'C1-02',''),
 ('PWR-3003','Orbital Sander 5"','Power Tools','pcs',31.00,54.99,3,0.08,3,'C1-03',''),
 ('PWR-3004','Jigsaw Variable Speed','Power Tools','pcs',38.50,64.99,2,0.06,3,'C1-04',''),
 ('PWR-3005','Drill Bit Set 29-Piece','Power Tools','pcs',14.80,27.99,5,0.3,3,'C1-05',''),
 ('PWR-3006','20V Battery 4.0Ah','Power Tools','pcs',33.00,59.99,3,0.1,3,'C1-06','low'),
 ('PWR-3007','Extension Cord 50 ft 12/3','Power Tools','pcs',19.50,34.99,4,0.2,3,'C1-07',''),
 ('PLB-4001','PVC Pipe 1/2" x 10 ft','Plumbing','pcs',3.20,5.99,15,1.0,4,'D1-01',''),
 ('PLB-4002','PVC Elbow 1/2" 90 deg (pack of 10)','Plumbing','pack',2.40,4.99,10,0.6,4,'D1-02',''),
 ('PLB-4003','Brass Ball Valve 1/2"','Plumbing','pcs',6.80,13.49,6,0.3,4,'D1-03',''),
 ('PLB-4004','PTFE Thread Seal Tape','Plumbing','pcs',0.80,2.49,25,1.8,4,'D1-04',''),
 ('PLB-4005','Universal Faucet Cartridge','Plumbing','pcs',7.90,15.99,4,0.15,4,'D1-05','low'),
 ('PLB-4006','Flexible Supply Line 20"','Plumbing','pcs',3.40,7.49,10,0.5,4,'D1-06',''),
 ('PLB-4007','Pipe Wrench 14"','Plumbing','pcs',17.50,32.99,3,0.08,4,'D1-07',''),
 ('PLB-4008','Silicone Sealant Clear 10 oz','Plumbing','pcs',3.70,7.99,12,0.9,4,'D1-08',''),
 ('ELC-5001','LED Bulb A19 60W Equivalent (4-pack)','Electrical','pack',4.80,9.99,15,1.5,5,'E1-01',''),
 ('ELC-5002','Copper Wire 14/2 (per meter)','Electrical','m',1.10,2.29,100,14,5,'E1-02',''),
 ('ELC-5003','Duplex Outlet 15A White','Electrical','pcs',0.95,2.49,20,1.2,5,'E1-03',''),
 ('ELC-5004','Single-Pole Switch 15A','Electrical','pcs',0.85,2.29,20,1.0,5,'E1-04',''),
 ('ELC-5005','Wire Nuts Assorted (pack of 100)','Electrical','pack',4.40,8.49,8,0.6,5,'E1-05',''),
 ('ELC-5006','Surge Protector 6-Outlet','Electrical','pcs',7.60,15.99,5,0.3,5,'E1-06','zero'),
 ('ELC-5007','Electrical Tape Black 3/4"','Electrical','pcs',1.20,3.29,20,1.6,5,'E1-07',''),
 ('ELC-5008','Circuit Breaker 20A Single-Pole','Electrical','pcs',5.20,10.99,6,0.25,5,'E1-08',''),
 ('ELC-5009','Motion Sensor Light','Electrical','pcs',14.20,27.99,3,0.1,5,'E1-09','low'),
 ('PNT-6001','Interior Latex Paint White (1 gal)','Paint & Supplies','pcs',19.50,32.99,12,0.9,6,'F1-01','bulk'),
 ('PNT-6002','Exterior Paint Gray (1 gal)','Paint & Supplies','pcs',24.80,41.99,8,0.5,6,'F1-02','bulk'),
 ('PNT-6003','Primer Sealer (1 gal)','Paint & Supplies','pcs',16.20,27.99,8,0.4,6,'F1-03','zero'),
 ('PNT-6004','Paint Roller Kit 9"','Paint & Supplies','pcs',5.60,11.99,8,0.45,6,'F1-04',''),
 ('PNT-6005','Angled Brush 2"','Paint & Supplies','pcs',3.90,8.49,10,0.6,6,'F1-05',''),
 ('PNT-6006','Painter''s Tape 1.88" x 60 yd','Paint & Supplies','pcs',3.10,6.99,15,1.1,6,'F1-06',''),
 ('PNT-6007','Drop Cloth 9 x 12 ft','Paint & Supplies','pcs',4.20,8.99,8,0.4,6,'F1-07',''),
 ('PNT-6008','Wood Stain Walnut (1 qt)','Paint & Supplies','pcs',9.40,17.99,5,0.25,6,'F1-08','low'),
 ('PNT-6009','Paint Thinner (bulk)','Paint & Supplies','l',3.10,5.99,20,6,6,'F1-09','bulk'),
 ('GRD-7001','Garden Hose 50 ft','Garden & Outdoor','pcs',14.60,27.99,4,0.15,6,'G1-01','low'),
 ('GRD-7002','Potting Soil 40 L Bag','Garden & Outdoor','pcs',5.20,9.99,10,0.6,6,'G1-02','bulk'),
 ('GRD-7003','Lawn Fertilizer (bulk)','Garden & Outdoor','kg',1.60,2.99,50,7,6,'G1-03','bulk'),
 ('GRD-7004','Pruning Shears','Garden & Outdoor','pcs',8.30,15.99,4,0.15,6,'G1-04',''),
 ('GRD-7005','Steel Garden Rake','Garden & Outdoor','pcs',10.40,19.99,3,0.08,6,'G1-05',''),
 ('SAF-8001','Leather Work Gloves','Safety & Workwear','pcs',4.80,9.99,10,0.7,2,'H1-01',''),
 ('SAF-8002','Safety Glasses Clear','Safety & Workwear','pcs',1.90,4.99,15,0.8,2,'H1-02',''),
 ('SAF-8003','N95 Dust Mask (pack of 10)','Safety & Workwear','pack',6.20,12.99,8,0.5,2,'H1-03',''),
 ('SAF-8004','Ear Protection Muffs','Safety & Workwear','pcs',7.10,14.99,4,0.15,2,'H1-04','low');

INSERT INTO products (category_id, name, sku, barcode, description, location, unit_code,
                      minimum, cost_price, sale_price, created_at, updated_at)
SELECT c.id, r.name, r.sku, '9990' || lpad((row_number() OVER (ORDER BY r.sku))::text, 9, '0'),
       '', r.loc, r.unit, r.minimum, r.cost, r.price,
       now() - interval '91 days', now() - interval '91 days'
FROM seed_raw r JOIN categories c ON c.name = r.cat;

CREATE TEMP TABLE seed_products AS
SELECT p.id, p.sku, p.minimum, p.cost_price AS cost, r.rate, r.sup, r.flag,
       CASE WHEN r.unit IN ('m','kg','l') THEN 1 ELSE 0 END AS dec,
       CASE r.flag WHEN 'zero' THEN 0 WHEN 'low' THEN floor(p.minimum / 2) END AS low_target
FROM products p JOIN seed_raw r ON r.sku = p.sku;

CREATE TEMP TABLE seed_stock (product_id uuid, warehouse_id uuid, qty numeric NOT NULL,
                              PRIMARY KEY (product_id, warehouse_id));
CREATE TEMP TABLE seed_po (day int, sup int, wh text);
INSERT INTO seed_po VALUES
 (84,1,'Main warehouse'),(80,3,'Main warehouse'),(75,6,'Overflow Yard'),(70,5,'Main warehouse'),
 (66,4,'Main warehouse'),(60,2,'Main warehouse'),(54,1,'Main warehouse'),(49,6,'Main warehouse'),
 (43,5,'Main warehouse'),(38,4,'Overflow Yard'),(31,3,'Main warehouse'),(25,2,'Main warehouse'),
 (18,1,'Main warehouse'),(12,5,'Main warehouse'),(6,6,'Main warehouse');

-- Appends one ledger row and keeps the running per-warehouse balance in step.
CREATE FUNCTION pg_temp.seed_move(p uuid, w uuid, q numeric, t text, ref text, ts timestamptz, tr uuid)
RETURNS void LANGUAGE sql AS $f$
  INSERT INTO stock_movements (product_id, warehouse_id, quantity, type, user_id, actor_type, reference, transfer_id, created_at)
  VALUES (p, w, q, t, '00000000-0000-0000-0000-000000000000', 'system', ref, tr, ts);
  INSERT INTO seed_stock VALUES (p, w, q) ON CONFLICT (product_id, warehouse_id)
  DO UPDATE SET qty = seed_stock.qty + EXCLUDED.qty;
$f$;
CREATE FUNCTION pg_temp.seed_total(p uuid) RETURNS numeric LANGUAGE sql AS
$f$ SELECT coalesce(sum(qty), 0) FROM seed_stock WHERE product_id = p $f$;
CREATE FUNCTION pg_temp.seed_qty(p uuid, w uuid) RETURNS numeric LANGUAGE sql AS
$f$ SELECT coalesce((SELECT qty FROM seed_stock WHERE product_id = p AND warehouse_id = w), 0) $f$;
-- Removes `units` of a product (never more than exists), mostly from the main warehouse.
CREATE FUNCTION pg_temp.seed_out(p uuid, units numeric, t text, ref text, ts timestamptz)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE s record; take numeric; left_ numeric := units;
BEGIN
  FOR s IN SELECT warehouse_id, qty FROM seed_stock WHERE product_id = p AND qty > 0
           ORDER BY random() * CASE WHEN warehouse_id = (SELECT id FROM warehouses WHERE name = 'Main warehouse') THEN 0.5 ELSE 1 END LOOP
    EXIT WHEN left_ <= 0;
    take := least(left_, s.qty);
    PERFORM pg_temp.seed_move(p, s.warehouse_id, -take, t, ref, ts, NULL);
    left_ := left_ - take;
  END LOOP;
END $f$;

DO $seed$
DECLARE
  main_wh uuid := (SELECT id FROM warehouses WHERE name = 'Main warehouse');
  down_wh uuid := (SELECT id FROM warehouses WHERE name = 'Downtown Store');
  yard_wh uuid := (SELECT id FROM warehouses WHERE name = 'Overflow Yard');
  p record; po record; d int; dow int; base timestamptz; ts timestamptz; q numeric; r numeric;
  ref text; po_id uuid; po_wh uuid; tr uuid; items int;
  po_n int := 0; sale_n int := 0; trf_n int := 0; n_po int; n_mov int; n_prod int;
  factor numeric;
BEGIN
  PERFORM setseed(0.37);
  -- Opening stock, 90 days ago. Bulky items are split with the Overflow Yard.
  FOR p IN SELECT * FROM seed_products LOOP
    q := round(p.rate * 45 + p.minimum * 2, p.dec);
    ts := now() - interval '90 days' - interval '20 hours';
    IF p.flag = 'bulk' THEN
      PERFORM pg_temp.seed_move(p.id, main_wh, round(q * 0.5, p.dec), 'initial', 'OPENING', ts, NULL);
      PERFORM pg_temp.seed_move(p.id, yard_wh, round(q * 0.5, p.dec), 'initial', 'OPENING', ts, NULL);
    ELSE
      PERFORM pg_temp.seed_move(p.id, main_wh, q, 'initial', 'OPENING', ts, NULL);
    END IF;
  END LOOP;

  FOR d IN REVERSE 89..0 LOOP
    base := now() - d * interval '1 day';
    dow := extract(dow FROM base)::int;
    factor := CASE dow WHEN 6 THEN 1.5 WHEN 0 THEN 0.6 WHEN 5 THEN 1.15 ELSE 0.9 END;

    -- Supplier purchases (a purchase order plus one 'purchase' movement per line).
    FOR po IN SELECT * FROM seed_po WHERE day = d LOOP
      po_n := po_n + 1;
      ref := 'PO-' || to_char(base, 'YYYYMMDD') || '-' || lpad(po_n::text, 3, '0');
      ts := base - interval '12 hours' - random() * interval '1 hour';
      po_wh := (SELECT id FROM warehouses WHERE name = po.wh);
      INSERT INTO purchase_orders (warehouse_id, supplier_id, reference, user_id, actor_type, created_at)
      VALUES (po_wh, (SELECT id FROM seed_suppliers WHERE idx = po.sup), ref, '00000000-0000-0000-0000-000000000000', 'system', ts)
      RETURNING id INTO po_id;
      items := 0;
      FOR p IN SELECT * FROM seed_products s
               WHERE s.sup = po.sup AND NOT (s.flag IN ('low','zero') AND d < 30)
                 AND pg_temp.seed_total(s.id) / s.rate < CASE WHEN po.sup = 3 THEN 200 ELSE 70 END
               ORDER BY pg_temp.seed_total(s.id) / s.rate LIMIT 6 LOOP
        q := round(greatest(ceil(p.rate * 40), p.minimum * 2), p.dec);
        INSERT INTO purchase_order_items (purchase_id, product_id, quantity, cost_price)
        VALUES (po_id, p.id, q, round(p.cost * (0.97 + random()::numeric * 0.06), 2));
        PERFORM pg_temp.seed_move(p.id, po_wh, q, 'purchase', ref, ts, NULL);
        items := items + 1;
      END LOOP;
      IF items = 0 THEN
        DELETE FROM purchase_orders WHERE id = po_id;
        po_n := po_n - 1;
      END IF;
    END LOOP;

    -- Restock the Downtown Store from the main warehouse (a pair of transfer movements).
    IF d IN (85, 58, 30, 8) THEN
      trf_n := trf_n + 1;
      FOR p IN SELECT * FROM seed_products WHERE rate >= 0.3 AND flag NOT IN ('low','zero') LOOP
        q := round(p.rate * 12, p.dec);
        IF q > 0 AND pg_temp.seed_qty(p.id, main_wh) - p.minimum >= q THEN
          tr := gen_random_uuid();
          ts := base - interval '10 hours' - random() * interval '30 minutes';
          ref := 'TRF-' || lpad(trf_n::text, 3, '0');
          PERFORM pg_temp.seed_move(p.id, main_wh, -q, 'transfer_out', ref, ts, tr);
          PERFORM pg_temp.seed_move(p.id, down_wh, q, 'transfer_in', ref, ts, tr);
        END IF;
      END LOOP;
    END IF;

    -- Daily sales, plus the occasional adjustment or customer return.
    FOR p IN SELECT * FROM seed_products LOOP
      IF p.dec = 0 THEN
        q := floor(p.rate * factor * (0.4 + random()::numeric * 1.2) + random()::numeric);
      ELSE
        q := round(p.rate * factor * (0.4 + random()::numeric * 1.2), 1);
      END IF;
      IF q > 0 THEN
        sale_n := sale_n + 1;
        PERFORM pg_temp.seed_out(p.id, q, 'sale',
          'POS-' || to_char(base, 'YYMMDD') || '-' || lpad(sale_n::text, 4, '0'),
          base - random() * interval '9 hours');
      END IF;
      r := random();
      IF r < 0.0025 AND pg_temp.seed_total(p.id) >= 2 THEN
        PERFORM pg_temp.seed_out(p.id, 1, 'adjustment_out', 'ADJ-damaged', base - random() * interval '9 hours');
      ELSIF r < 0.0045 THEN
        PERFORM pg_temp.seed_move(p.id, main_wh, ceil(random()::numeric * 3), 'adjustment_in', 'ADJ-count-correction', base - random() * interval '9 hours', NULL);
      ELSIF r < 0.0075 THEN
        PERFORM pg_temp.seed_move(p.id, main_wh, 1::numeric, 'return_in', 'RET-customer', base - random() * interval '9 hours', NULL);
      END IF;
    END LOOP;

    -- Flagged items sell down below (or to zero against) their minimum over the last 3 days.
    IF d IN (3, 2, 1) THEN
      FOR p IN SELECT * FROM seed_products WHERE flag IN ('low','zero') LOOP
        q := ceil((pg_temp.seed_total(p.id) - p.low_target) / d);
        IF q > 0 THEN
          sale_n := sale_n + 1;
          PERFORM pg_temp.seed_out(p.id, q, 'sale',
            'POS-' || to_char(base, 'YYMMDD') || '-' || lpad(sale_n::text, 4, '0'),
            base - random() * interval '9 hours');
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- Inventory is derived from the ledger, then checked against the running balances.
  INSERT INTO inventory (warehouse_id, product_id, quantity, updated_at)
  SELECT warehouse_id, product_id, sum(quantity), max(created_at)
  FROM stock_movements GROUP BY warehouse_id, product_id;
  IF EXISTS (SELECT 1 FROM inventory i JOIN seed_stock s USING (warehouse_id, product_id) WHERE i.quantity <> s.qty)
     OR (SELECT count(*) FROM inventory) <> (SELECT count(*) FROM seed_stock) THEN
    RAISE EXCEPTION 'Demo seed: inventory does not match the ledger';
  END IF;

  SELECT count(*) INTO n_po FROM purchase_orders WHERE user_id = '00000000-0000-0000-0000-000000000000';
  SELECT count(*) INTO n_mov FROM stock_movements WHERE user_id = '00000000-0000-0000-0000-000000000000';
  SELECT count(*) INTO n_prod FROM seed_products;
  UPDATE settings SET settings = settings.settings || '{"store":"Ironwood Hardware"}'::jsonb
  WHERE settings.settings ->> 'store' = 'My store';
  INSERT INTO audit_logs (user_id, actor_type, action, resource_type, resource_id, after, metadata)
  VALUES ('00000000-0000-0000-0000-000000000000', 'system', 'demo.seed', 'seed', 'demo',
          jsonb_build_object('products', n_prod, 'purchases', n_po, 'movements', n_mov),
          '{"source":"docker/demo/seed.sql"}');
  RAISE NOTICE 'Demo data loaded: % products, % purchases, % stock movements.', n_prod, n_po, n_mov;
END
$seed$;
\else
\echo 'Demo data skipped: it is already loaded, or the catalog is not empty.'
\endif
