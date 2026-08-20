-- Phase 3: tenant-scoped unique keys + ON CONFLICT retarget + restaurant_id NOT NULL
-- + composite child FKs.
--
-- STATUS: READY FOR APPROVAL — DO NOT AUTO-APPLY TO PRODUCTION.
-- Apply only after explicit user TASDIQ. This file is one transaction.
--
-- Prerequisites (already done):
--   Phase 1 foundation, Phase 2 backfill, Phase 3A write compatibility
--   (RPC INSERT restaurant_id + frontend createCategory/createMenuItem).
--
-- Does NOT change: RLS policies, sequences, PIN, generate_order_number,
-- frontend. Existing simple FKs kept (no new ON DELETE CASCADE).
--
-- Order (half-migrated state emas):
--   1. precheck abort if NULL/orphan/mismatch
--   2. add tenant-scoped UNIQUE (keep old global unique)
--   3. CREATE OR REPLACE RPCs with new ON CONFLICT targets
--   4. drop old global UNIQUE
--   5. parent UNIQUE(id, restaurant_id) + composite child FKs
--   6. restaurant_id SET NOT NULL last

-- ------------------------------------------------------------
-- 1. Precheck
-- ------------------------------------------------------------
DO $$
DECLARE
  v_null int;
  v_orphan int;
  v_mismatch int;
BEGIN
  SELECT COALESCE(sum(n), 0) INTO v_null FROM (
    SELECT count(*) FILTER (WHERE restaurant_id IS NULL) AS n FROM restaurant_settings
    UNION ALL SELECT count(*) FILTER (WHERE restaurant_id IS NULL) FROM restaurant_tables
    UNION ALL SELECT count(*) FILTER (WHERE restaurant_id IS NULL) FROM menu_categories
    UNION ALL SELECT count(*) FILTER (WHERE restaurant_id IS NULL) FROM menu_items
    UNION ALL SELECT count(*) FILTER (WHERE restaurant_id IS NULL) FROM orders
    UNION ALL SELECT count(*) FILTER (WHERE restaurant_id IS NULL) FROM order_items
    UNION ALL SELECT count(*) FILTER (WHERE restaurant_id IS NULL) FROM kitchen_tickets
    UNION ALL SELECT count(*) FILTER (WHERE restaurant_id IS NULL) FROM payments
    UNION ALL SELECT count(*) FILTER (WHERE restaurant_id IS NULL) FROM cash_sessions
    UNION ALL SELECT count(*) FILTER (WHERE restaurant_id IS NULL) FROM notifications
    UNION ALL SELECT count(*) FILTER (WHERE restaurant_id IS NULL) FROM audit_logs
    UNION ALL SELECT count(*) FILTER (WHERE restaurant_id IS NULL) FROM table_reservations
    UNION ALL SELECT count(*) FILTER (WHERE restaurant_id IS NULL) FROM order_events
  ) s;

  IF v_null <> 0 THEN
    RAISE EXCEPTION 'Phase 3 abort: restaurant_id IS NULL count = %', v_null;
  END IF;

  SELECT COALESCE(sum(n), 0) INTO v_orphan FROM (
    SELECT count(*) AS n FROM restaurant_settings WHERE restaurant_id NOT IN (SELECT id FROM restaurants)
    UNION ALL SELECT count(*) FROM restaurant_tables WHERE restaurant_id NOT IN (SELECT id FROM restaurants)
    UNION ALL SELECT count(*) FROM menu_categories WHERE restaurant_id NOT IN (SELECT id FROM restaurants)
    UNION ALL SELECT count(*) FROM menu_items WHERE restaurant_id NOT IN (SELECT id FROM restaurants)
    UNION ALL SELECT count(*) FROM orders WHERE restaurant_id NOT IN (SELECT id FROM restaurants)
    UNION ALL SELECT count(*) FROM kitchen_tickets WHERE restaurant_id NOT IN (SELECT id FROM restaurants)
    UNION ALL SELECT count(*) FROM payments WHERE restaurant_id NOT IN (SELECT id FROM restaurants)
    UNION ALL SELECT count(*) FROM cash_sessions WHERE restaurant_id NOT IN (SELECT id FROM restaurants)
    UNION ALL SELECT count(*) FROM notifications WHERE restaurant_id NOT IN (SELECT id FROM restaurants)
    UNION ALL SELECT count(*) FROM audit_logs WHERE restaurant_id NOT IN (SELECT id FROM restaurants)
    UNION ALL SELECT count(*) FROM table_reservations WHERE restaurant_id NOT IN (SELECT id FROM restaurants)
    UNION ALL SELECT count(*) FROM order_events WHERE restaurant_id NOT IN (SELECT id FROM restaurants)
  ) s;

  IF v_orphan <> 0 THEN
    RAISE EXCEPTION 'Phase 3 abort: orphan restaurant_id count = %', v_orphan;
  END IF;

  SELECT COALESCE(sum(n), 0) INTO v_mismatch FROM (
    SELECT count(*) AS n FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE oi.restaurant_id IS DISTINCT FROM o.restaurant_id
    UNION ALL SELECT count(*) FROM kitchen_tickets kt JOIN orders o ON o.id = kt.order_id
      WHERE kt.restaurant_id IS DISTINCT FROM o.restaurant_id
    UNION ALL SELECT count(*) FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE p.restaurant_id IS DISTINCT FROM o.restaurant_id
    UNION ALL SELECT count(*) FROM order_events oe JOIN orders o ON o.id = oe.order_id
      WHERE oe.restaurant_id IS DISTINCT FROM o.restaurant_id
    UNION ALL SELECT count(*) FROM table_reservations tr JOIN restaurant_tables t ON t.id = tr.table_id
      WHERE tr.restaurant_id IS DISTINCT FROM t.restaurant_id
    UNION ALL SELECT count(*) FROM menu_items mi JOIN menu_categories c ON c.id = mi.category_id
      WHERE mi.restaurant_id IS DISTINCT FROM c.restaurant_id
  ) s;

  IF v_mismatch <> 0 THEN
    RAISE EXCEPTION 'Phase 3 abort: parent-child restaurant_id mismatch count = %', v_mismatch;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. New tenant-scoped UNIQUE (old global unique still present)
-- ------------------------------------------------------------
ALTER TABLE restaurant_tables
  ADD CONSTRAINT restaurant_tables_restaurant_id_number_key UNIQUE (restaurant_id, number);

ALTER TABLE menu_categories
  ADD CONSTRAINT menu_categories_restaurant_id_slug_key UNIQUE (restaurant_id, slug);

ALTER TABLE orders
  ADD CONSTRAINT orders_restaurant_id_order_number_key UNIQUE (restaurant_id, order_number);

ALTER TABLE cash_sessions
  ADD CONSTRAINT cash_sessions_restaurant_id_session_date_key UNIQUE (restaurant_id, session_date);

-- ------------------------------------------------------------
-- 3. RPC ON CONFLICT → tenant unique (same transaction)
-- Bodies otherwise match Phase 3A production functions.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_upsert_table(
  p_number INT,
  p_capacity INT DEFAULT 4,
  p_zone TEXT DEFAULT 'Asosiy zal',
  p_name TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT true,
  p_table_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Forbidden'; END IF;

  IF p_table_id IS NOT NULL THEN
    UPDATE restaurant_tables SET
      number = p_number,
      capacity = GREATEST(p_capacity, 1),
      zone = COALESCE(NULLIF(trim(p_zone), ''), 'Asosiy zal'),
      name = NULLIF(trim(p_name), ''),
      is_active = p_is_active,
      updated_at = now()
    WHERE id = p_table_id
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  INSERT INTO restaurant_tables (number, capacity, zone, name, is_active, status, restaurant_id)
  VALUES (
    p_number,
    GREATEST(p_capacity, 1),
    COALESCE(NULLIF(trim(p_zone), ''), 'Asosiy zal'),
    NULLIF(trim(p_name), ''),
    p_is_active,
    'empty',
    get_current_restaurant_id()
  )
  ON CONFLICT (restaurant_id, number) DO UPDATE SET
    capacity = EXCLUDED.capacity,
    zone = EXCLUDED.zone,
    name = EXCLUDED.name,
    is_active = EXCLUDED.is_active,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_restaurant_tables()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
  v_max INT;
  i INT;
  v_restaurant_id UUID;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT table_count, restaurant_id INTO v_count, v_restaurant_id
  FROM restaurant_settings
  LIMIT 1;
  IF v_count IS NULL OR v_count < 1 THEN
    v_count := 1;
  END IF;
  IF v_restaurant_id IS NULL THEN
    v_restaurant_id := get_current_restaurant_id();
  END IF;

  SELECT COALESCE(MAX(number), 0) INTO v_max FROM restaurant_tables;

  IF v_max < v_count THEN
    FOR i IN (v_max + 1)..v_count LOOP
      INSERT INTO restaurant_tables (number, status, capacity, restaurant_id)
      VALUES (i, 'empty', 4, v_restaurant_id)
      ON CONFLICT (restaurant_id, number) DO NOTHING;
    END LOOP;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_order(p_order_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders;
  v_paid NUMERIC(12,2);
  v_today DATE := CURRENT_DATE;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM payments WHERE order_id = p_order_id AND status = 'completed';
  IF v_paid < v_order.total THEN RAISE EXCEPTION 'Payment incomplete: paid % of %', v_paid, v_order.total; END IF;
  UPDATE orders SET status = 'paid', closed_at = now(),
    fulfillment_status = CASE WHEN v_order.order_type IN ('pickup', 'delivery') THEN 'completed'::fulfillment_status ELSE fulfillment_status END
  WHERE id = p_order_id;
  IF v_order.table_id IS NOT NULL THEN UPDATE restaurant_tables SET status = 'empty', current_order_id = NULL WHERE id = v_order.table_id; END IF;
  PERFORM log_order_event(p_order_id, 'closed', 'To''lov yopildi', auth.uid(), '{}');
  INSERT INTO cash_sessions (session_date, order_count, total_revenue, cash_total, card_total, click_total, payme_total, other_total, restaurant_id)
  VALUES (v_today, 1, v_order.total,
    COALESCE((SELECT SUM(amount) FROM payments WHERE order_id = p_order_id AND method = 'cash'), 0),
    COALESCE((SELECT SUM(amount) FROM payments WHERE order_id = p_order_id AND method = 'card'), 0),
    COALESCE((SELECT SUM(amount) FROM payments WHERE order_id = p_order_id AND method = 'click'), 0),
    COALESCE((SELECT SUM(amount) FROM payments WHERE order_id = p_order_id AND method = 'payme'), 0),
    COALESCE((SELECT SUM(amount) FROM payments WHERE order_id = p_order_id AND method = 'other'), 0),
    v_order.restaurant_id)
  ON CONFLICT (restaurant_id, session_date) DO UPDATE SET order_count = cash_sessions.order_count + 1,
    total_revenue = cash_sessions.total_revenue + EXCLUDED.total_revenue,
    cash_total = cash_sessions.cash_total + EXCLUDED.cash_total, card_total = cash_sessions.card_total + EXCLUDED.card_total,
    click_total = cash_sessions.click_total + EXCLUDED.click_total, payme_total = cash_sessions.payme_total + EXCLUDED.payme_total,
    other_total = cash_sessions.other_total + EXCLUDED.other_total, updated_at = now();
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_data, restaurant_id)
  VALUES (auth.uid(), 'order_closed', 'order', p_order_id, jsonb_build_object('total', v_order.total, 'paid', v_paid), v_order.restaurant_id);
END;
$$;

-- ------------------------------------------------------------
-- 4. Drop old global UNIQUE (new unique + new ON CONFLICT already live)
-- ------------------------------------------------------------
ALTER TABLE restaurant_tables DROP CONSTRAINT restaurant_tables_number_key;
ALTER TABLE menu_categories DROP CONSTRAINT menu_categories_slug_key;
ALTER TABLE orders DROP CONSTRAINT orders_order_number_key;
ALTER TABLE cash_sessions DROP CONSTRAINT cash_sessions_session_date_key;

-- Left global (UUID / draft keys):
--   orders_idempotency_key_key, order_items_idempotency_key_key, payments_idempotency_key_key
-- Left as-is (table_id UUID): idx_orders_one_active_per_table
-- Sequences (order_number_seq, pickup/delivery, kitchen_ticket_seq): unchanged — Phase 5.

-- ------------------------------------------------------------
-- 5. Composite child FKs (keep existing simple FKs)
-- ------------------------------------------------------------
ALTER TABLE orders
  ADD CONSTRAINT orders_id_restaurant_id_key UNIQUE (id, restaurant_id);
ALTER TABLE restaurant_tables
  ADD CONSTRAINT restaurant_tables_id_restaurant_id_key UNIQUE (id, restaurant_id);
ALTER TABLE menu_categories
  ADD CONSTRAINT menu_categories_id_restaurant_id_key UNIQUE (id, restaurant_id);

ALTER TABLE order_items
  ADD CONSTRAINT order_items_order_id_restaurant_id_fkey
  FOREIGN KEY (order_id, restaurant_id) REFERENCES orders (id, restaurant_id);

ALTER TABLE kitchen_tickets
  ADD CONSTRAINT kitchen_tickets_order_id_restaurant_id_fkey
  FOREIGN KEY (order_id, restaurant_id) REFERENCES orders (id, restaurant_id);

ALTER TABLE payments
  ADD CONSTRAINT payments_order_id_restaurant_id_fkey
  FOREIGN KEY (order_id, restaurant_id) REFERENCES orders (id, restaurant_id);

ALTER TABLE order_events
  ADD CONSTRAINT order_events_order_id_restaurant_id_fkey
  FOREIGN KEY (order_id, restaurant_id) REFERENCES orders (id, restaurant_id);

ALTER TABLE menu_items
  ADD CONSTRAINT menu_items_category_id_restaurant_id_fkey
  FOREIGN KEY (category_id, restaurant_id) REFERENCES menu_categories (id, restaurant_id);

ALTER TABLE table_reservations
  ADD CONSTRAINT table_reservations_table_id_restaurant_id_fkey
  FOREIGN KEY (table_id, restaurant_id) REFERENCES restaurant_tables (id, restaurant_id);

-- ------------------------------------------------------------
-- 6. restaurant_id NOT NULL last
-- Existing restaurants(id) FKs unchanged (no ON DELETE CASCADE).
-- ------------------------------------------------------------
ALTER TABLE restaurant_settings ALTER COLUMN restaurant_id SET NOT NULL;
ALTER TABLE restaurant_tables ALTER COLUMN restaurant_id SET NOT NULL;
ALTER TABLE menu_categories ALTER COLUMN restaurant_id SET NOT NULL;
ALTER TABLE menu_items ALTER COLUMN restaurant_id SET NOT NULL;
ALTER TABLE orders ALTER COLUMN restaurant_id SET NOT NULL;
ALTER TABLE order_items ALTER COLUMN restaurant_id SET NOT NULL;
ALTER TABLE kitchen_tickets ALTER COLUMN restaurant_id SET NOT NULL;
ALTER TABLE payments ALTER COLUMN restaurant_id SET NOT NULL;
ALTER TABLE cash_sessions ALTER COLUMN restaurant_id SET NOT NULL;
ALTER TABLE notifications ALTER COLUMN restaurant_id SET NOT NULL;
ALTER TABLE audit_logs ALTER COLUMN restaurant_id SET NOT NULL;
ALTER TABLE table_reservations ALTER COLUMN restaurant_id SET NOT NULL;
ALTER TABLE order_events ALTER COLUMN restaurant_id SET NOT NULL;

-- =============================================================================
-- ROLLBACK (DO NOT RUN)
-- Recreating global UNIQUE fails if two tenants share number/slug/order_number/
-- session_date. Also restore ON CONFLICT (number) / (session_date) on RPCs.
-- =============================================================================
-- ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_order_id_restaurant_id_fkey;
-- ALTER TABLE kitchen_tickets DROP CONSTRAINT IF EXISTS kitchen_tickets_order_id_restaurant_id_fkey;
-- ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_order_id_restaurant_id_fkey;
-- ALTER TABLE order_events DROP CONSTRAINT IF EXISTS order_events_order_id_restaurant_id_fkey;
-- ALTER TABLE menu_items DROP CONSTRAINT IF EXISTS menu_items_category_id_restaurant_id_fkey;
-- ALTER TABLE table_reservations DROP CONSTRAINT IF EXISTS table_reservations_table_id_restaurant_id_fkey;
-- ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_id_restaurant_id_key;
-- ALTER TABLE restaurant_tables DROP CONSTRAINT IF EXISTS restaurant_tables_id_restaurant_id_key;
-- ALTER TABLE menu_categories DROP CONSTRAINT IF EXISTS menu_categories_id_restaurant_id_key;
-- ALTER TABLE restaurant_tables DROP CONSTRAINT IF EXISTS restaurant_tables_restaurant_id_number_key;
-- ALTER TABLE restaurant_tables ADD CONSTRAINT restaurant_tables_number_key UNIQUE (number);
-- ALTER TABLE menu_categories DROP CONSTRAINT IF EXISTS menu_categories_restaurant_id_slug_key;
-- ALTER TABLE menu_categories ADD CONSTRAINT menu_categories_slug_key UNIQUE (slug);
-- ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_restaurant_id_order_number_key;
-- ALTER TABLE orders ADD CONSTRAINT orders_order_number_key UNIQUE (order_number);
-- ALTER TABLE cash_sessions DROP CONSTRAINT IF EXISTS cash_sessions_restaurant_id_session_date_key;
-- ALTER TABLE cash_sessions ADD CONSTRAINT cash_sessions_session_date_key UNIQUE (session_date);
-- then restore Phase 3A RPC ON CONFLICT (number)/(session_date)
-- then DROP NOT NULL on restaurant_id columns
