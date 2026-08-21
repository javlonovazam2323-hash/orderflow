-- ROLLBACK for Phase 4+5 atomic security rollout.
-- STATUS: Do not run unless Phase 4+5 was applied and must be reversed.
-- Restores pre-Phase-4 RLS and pre-Phase-5 RPC bodies.
-- Does NOT undo Phase 1/2/3/3A schema, constraints, or customer data.
-- Does NOT DELETE/TRUNCATE business rows.

-- 1) Drop Phase 4 tenant policies
DROP POLICY IF EXISTS restaurants_select_member ON public.restaurants;
DROP POLICY IF EXISTS restaurant_members_select_own_or_admin ON public.restaurant_members;
DROP POLICY IF EXISTS settings_select_member ON public.restaurant_settings;
DROP POLICY IF EXISTS settings_admin ON public.restaurant_settings;
DROP POLICY IF EXISTS tables_select_member ON public.restaurant_tables;
DROP POLICY IF EXISTS tables_admin ON public.restaurant_tables;
DROP POLICY IF EXISTS menu_cat_select_member ON public.menu_categories;
DROP POLICY IF EXISTS menu_cat_admin ON public.menu_categories;
DROP POLICY IF EXISTS menu_items_select_member ON public.menu_items;
DROP POLICY IF EXISTS menu_items_admin ON public.menu_items;
DROP POLICY IF EXISTS orders_select_member ON public.orders;
DROP POLICY IF EXISTS orders_insert_member ON public.orders;
DROP POLICY IF EXISTS orders_update_member ON public.orders;
DROP POLICY IF EXISTS order_items_select_member ON public.order_items;
DROP POLICY IF EXISTS kitchen_select_member ON public.kitchen_tickets;
DROP POLICY IF EXISTS kitchen_update_member ON public.kitchen_tickets;
DROP POLICY IF EXISTS payments_select_member ON public.payments;
DROP POLICY IF EXISTS payments_insert_member ON public.payments;
DROP POLICY IF EXISTS cash_sessions_select_member ON public.cash_sessions;
DROP POLICY IF EXISTS notifications_select_own_tenant ON public.notifications;
DROP POLICY IF EXISTS notifications_update_own_tenant ON public.notifications;
DROP POLICY IF EXISTS audit_admin_tenant ON public.audit_logs;
DROP POLICY IF EXISTS reservations_select_member ON public.table_reservations;
DROP POLICY IF EXISTS reservations_admin ON public.table_reservations;
DROP POLICY IF EXISTS order_events_select_member ON public.order_events;

-- 2) Restore pre-Phase-4 policies
CREATE POLICY restaurants_select_member ON public.restaurants
  FOR SELECT TO authenticated USING (is_restaurant_member(id));

CREATE POLICY restaurant_members_select_own_or_admin ON public.restaurant_members
  FOR SELECT TO authenticated
  USING ((user_id = auth.uid()) OR is_restaurant_admin(restaurant_id));

CREATE POLICY settings_admin ON public.restaurant_settings
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY settings_select ON public.restaurant_settings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY tables_admin ON public.restaurant_tables
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY tables_select ON public.restaurant_tables
  FOR SELECT TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin'::user_role, 'cashier'::user_role, 'waiter'::user_role, 'kitchen'::user_role]));

CREATE POLICY menu_cat_admin ON public.menu_categories
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY menu_cat_select ON public.menu_categories
  FOR SELECT TO authenticated USING (true);

CREATE POLICY menu_items_admin ON public.menu_items
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY menu_items_select ON public.menu_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY orders_insert ON public.orders FOR INSERT TO authenticated
  WITH CHECK ((get_user_role() = ANY (ARRAY['admin'::user_role, 'waiter'::user_role]))
    OR (is_cashier_or_admin() AND (order_type = ANY (ARRAY['pickup'::order_type, 'delivery'::order_type]))));
CREATE POLICY orders_select ON public.orders FOR SELECT TO authenticated
  USING (is_admin() OR (get_user_role() = ANY (ARRAY['cashier'::user_role, 'kitchen'::user_role]))
    OR ((get_user_role() = 'waiter'::user_role) AND (waiter_id = auth.uid()))
    OR ((get_user_role() = 'waiter'::user_role) AND (order_type = 'dine_in'::order_type) AND (table_id IS NOT NULL)));
CREATE POLICY orders_update ON public.orders FOR UPDATE TO authenticated
  USING (is_admin() OR (get_user_role() = ANY (ARRAY['cashier'::user_role, 'waiter'::user_role])));

CREATE POLICY order_items_select ON public.order_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_items.order_id AND (
    is_admin() OR (get_user_role() = ANY (ARRAY['cashier'::user_role, 'kitchen'::user_role]))
    OR ((get_user_role() = 'waiter'::user_role) AND (o.waiter_id = auth.uid())))));

CREATE POLICY kitchen_select ON public.kitchen_tickets FOR SELECT TO authenticated
  USING (is_admin() OR (get_user_role() = ANY (ARRAY['kitchen'::user_role, 'cashier'::user_role]))
    OR ((get_user_role() = 'waiter'::user_role) AND (waiter_id = auth.uid())));
CREATE POLICY kitchen_update ON public.kitchen_tickets FOR UPDATE TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin'::user_role, 'kitchen'::user_role]));

CREATE POLICY payments_insert ON public.payments FOR INSERT TO authenticated WITH CHECK (is_cashier_or_admin());
CREATE POLICY payments_select ON public.payments FOR SELECT TO authenticated USING (is_cashier_or_admin() OR is_admin());
CREATE POLICY cash_sessions_select ON public.cash_sessions FOR SELECT TO authenticated USING (is_cashier_or_admin());
CREATE POLICY notifications_select ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY notifications_update ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY audit_admin ON public.audit_logs FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY reservations_admin ON public.table_reservations FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY reservations_select ON public.table_reservations FOR SELECT TO authenticated USING (true);
CREATE POLICY reservations_waiter_read ON public.table_reservations FOR SELECT TO authenticated
  USING (get_user_role() = ANY (ARRAY['waiter'::user_role, 'cashier'::user_role, 'kitchen'::user_role]));
CREATE POLICY order_events_select ON public.order_events FOR SELECT TO authenticated
  USING (is_admin() OR (get_user_role() = ANY (ARRAY['cashier'::user_role, 'kitchen'::user_role]))
    OR (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_events.order_id AND get_user_role() = 'waiter'::user_role AND o.waiter_id = auth.uid())));

-- 3) Restore generate_order_number to global sequences first, then drop tenant overload
CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  RETURN lpad(nextval('order_number_seq')::text, 6, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_order_number(p_type order_type DEFAULT 'dine_in'::order_type)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  CASE p_type
    WHEN 'pickup' THEN RETURN 'P-' || lpad(nextval('pickup_order_seq')::text, 6, '0');
    WHEN 'delivery' THEN RETURN 'D-' || lpad(nextval('delivery_order_seq')::text, 6, '0');
    ELSE RETURN lpad(nextval('order_number_seq')::text, 6, '0');
  END CASE;
END;
$$;

DROP FUNCTION IF EXISTS public.generate_order_number(order_type, uuid);
DROP FUNCTION IF EXISTS public.verify_pin(text, uuid);
DROP FUNCTION IF EXISTS public.assert_auth();
DROP FUNCTION IF EXISTS public.assert_restaurant_role(uuid, text[]);
DROP FUNCTION IF EXISTS public.resolve_create_restaurant_id(uuid);
DROP FUNCTION IF EXISTS public.has_restaurant_role(uuid, text[]);
DROP FUNCTION IF EXISTS public.current_restaurant_ids();
DROP INDEX IF EXISTS public.idx_restaurant_members_user_active;
DROP TABLE IF EXISTS public.restaurant_order_counters;

-- 4) Restore Phase 1 membership helpers (keep foundation)
CREATE OR REPLACE FUNCTION public.is_restaurant_member(rid UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.restaurant_members m
    WHERE m.restaurant_id = rid AND m.user_id = auth.uid() AND m.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_restaurant_admin(rid UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.restaurant_members m
    WHERE m.restaurant_id = rid AND m.user_id = auth.uid() AND m.is_active = true AND m.role = 'admin'
  );
$$;

-- 5) Restore PIN
CREATE OR REPLACE FUNCTION public.verify_pin(p_pin text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_profile_id UUID;
BEGIN
  SELECT id INTO v_profile_id FROM profiles
  WHERE is_active = true AND pin_hash IS NOT NULL AND pin_hash = extensions.crypt(p_pin, pin_hash);
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'Invalid PIN'; END IF;
  RETURN v_profile_id;
END;
$$;

-- 7) Restore pre-Phase-5 RPC authorization (bodies match production at Phase 3).
-- Full production bodies for patched RPCs are restored by re-applying the Phase 3A
-- function definitions already in the database history. The following restores
-- the global-role checks that Phase 5 removed.

CREATE OR REPLACE FUNCTION public.recalculate_order_totals(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_subtotal NUMERIC(12,2); v_service_pct NUMERIC(5,2); v_tax_pct NUMERIC(5,2);
  v_service NUMERIC(12,2); v_tax NUMERIC(12,2); v_delivery_fee NUMERIC(12,2);
  v_discount NUMERIC(12,2); v_order_type order_type;
BEGIN
  SELECT COALESCE(SUM(total_price), 0) INTO v_subtotal FROM order_items WHERE order_id = p_order_id AND status NOT IN ('cancelled');
  SELECT service_charge_percent, tax_percent INTO v_service_pct, v_tax_pct FROM restaurant_settings LIMIT 1;
  SELECT COALESCE(delivery_fee, 0), COALESCE(discount_amount, 0), order_type INTO v_delivery_fee, v_discount, v_order_type FROM orders WHERE id = p_order_id;
  IF v_order_type IN ('pickup', 'delivery') THEN v_service := 0;
  ELSE v_service := ROUND(v_subtotal * COALESCE(v_service_pct, 0) / 100, 0); END IF;
  v_tax := ROUND((v_subtotal + v_service + v_delivery_fee - v_discount) * COALESCE(v_tax_pct, 0) / 100, 0);
  UPDATE orders SET subtotal = v_subtotal, service_charge = v_service, tax_amount = v_tax,
    total = GREATEST(v_subtotal + v_service + v_tax + v_delivery_fee - v_discount, 0), updated_at = now()
  WHERE id = p_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_staff_order_ready(p_order orders, p_ticket_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_title TEXT; v_body TEXT; v_type notification_type;
BEGIN
  IF p_order.order_type = 'pickup' THEN
    v_type := 'pickup_ready'; v_title := 'ZAKAZ TAYYOR';
    v_body := format('%s · %s · Olib ketish', p_order.order_number, COALESCE(p_order.customer_name, 'Mijoz'));
  ELSIF p_order.order_type = 'delivery' THEN
    v_type := 'delivery_ready'; v_title := 'ZAKAZ TAYYOR';
    v_body := format('%s · %s · Dostavka', p_order.order_number, COALESCE(p_order.customer_name, 'Mijoz'));
  ELSE
    v_type := 'order_ready'; v_title := 'Buyurtma tayyor!';
    v_body := format('Stol %s buyurtmasi tayyor!', (SELECT number FROM restaurant_tables WHERE id = p_order.table_id));
  END IF;
  IF p_order.order_type IN ('pickup', 'delivery') THEN
    INSERT INTO notifications (user_id, type, title, body, data, restaurant_id)
    SELECT p.id, v_type, v_title, v_body,
      jsonb_build_object('order_id', p_order.id, 'order_number', p_order.order_number, 'order_type', p_order.order_type, 'ticket_id', p_ticket_id, 'customer_name', p_order.customer_name),
      p_order.restaurant_id
    FROM profiles p WHERE p.role IN ('admin', 'cashier') AND p.is_active = true;
  ELSIF p_order.waiter_id IS NOT NULL THEN
    INSERT INTO notifications (user_id, type, title, body, data, restaurant_id)
    VALUES (p_order.waiter_id, v_type, v_title, v_body, jsonb_build_object('ticket_id', p_ticket_id, 'table_id', p_order.table_id, 'order_id', p_order.id), p_order.restaurant_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_profile_pin(p_profile_id uuid, p_pin text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF p_pin IS NULL OR length(trim(p_pin)) = 0 THEN
    UPDATE profiles SET pin_hash = NULL, updated_at = now() WHERE id = p_profile_id;
  ELSE
    UPDATE profiles SET pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')), updated_at = now() WHERE id = p_profile_id;
  END IF;
END;
$$;

-- Remaining business RPCs: restore from git history of production Phase 3 bodies
-- (open_table_order, upsert_draft_order_item, send_to_kitchen, update_kitchen_ticket_status,
-- add_payment, close_order, request_bill, create_phone_order, fulfillment, reservations,
-- admin_upsert_table, sync_restaurant_tables, set_table_*). Those CREATE OR REPLACE
-- statements are appended below from the Phase 3 production dump.

CREATE OR REPLACE FUNCTION public.open_table_order(p_table_id uuid, p_waiter_id uuid DEFAULT auth.uid())
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order_id UUID; v_table_status table_status; v_restaurant_id UUID;
BEGIN
  IF get_user_role() NOT IN ('admin', 'waiter') THEN RAISE EXCEPTION 'Permission denied'; END IF;
  SELECT status, restaurant_id INTO v_table_status, v_restaurant_id FROM restaurant_tables WHERE id = p_table_id FOR UPDATE;
  IF v_table_status = 'empty' OR v_table_status IS NULL THEN
    INSERT INTO orders (order_number, order_type, table_id, waiter_id, created_by, status, restaurant_id)
    VALUES (generate_order_number('dine_in'), 'dine_in', p_table_id, p_waiter_id, p_waiter_id, 'open', v_restaurant_id)
    RETURNING id INTO v_order_id;
    UPDATE restaurant_tables SET status = 'occupied', current_order_id = v_order_id WHERE id = p_table_id;
    PERFORM log_order_event(v_order_id, 'created', 'Zakaz yaratildi', p_waiter_id, jsonb_build_object('table_id', p_table_id));
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_data, restaurant_id)
    VALUES (p_waiter_id, 'order_created', 'order', v_order_id, jsonb_build_object('table_id', p_table_id), v_restaurant_id);
    RETURN v_order_id;
  END IF;
  SELECT id INTO v_order_id FROM orders WHERE table_id = p_table_id AND status IN ('open', 'awaiting_payment') LIMIT 1;
  IF v_order_id IS NULL THEN RAISE EXCEPTION 'Table is not available'; END IF;
  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_pin(text) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.needs_setup() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_cashier_or_admin() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.open_table_order(uuid, uuid) TO PUBLIC, anon, authenticated, service_role;

-- Remaining patched RPCs restored to Phase 3 production bodies (global role checks).
CREATE OR REPLACE FUNCTION public.request_bill(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order orders;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  UPDATE orders SET status = 'awaiting_payment' WHERE id = p_order_id;
  IF v_order.table_id IS NOT NULL THEN UPDATE restaurant_tables SET status = 'awaiting_payment' WHERE id = v_order.table_id; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.set_table_cleaning(p_table_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  UPDATE restaurant_tables SET status = 'cleaning', current_order_id = NULL
  WHERE id = p_table_id AND status IN ('empty', 'awaiting_payment');
END; $$;

CREATE OR REPLACE FUNCTION public.set_table_available(p_table_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  UPDATE restaurant_tables SET status = 'empty', current_order_id = NULL
  WHERE id = p_table_id AND status = 'cleaning';
END; $$;

CREATE OR REPLACE FUNCTION public.sync_restaurant_tables()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INT; v_max INT; i INT; v_restaurant_id UUID;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT table_count, restaurant_id INTO v_count, v_restaurant_id FROM restaurant_settings LIMIT 1;
  IF v_count IS NULL OR v_count < 1 THEN v_count := 1; END IF;
  IF v_restaurant_id IS NULL THEN v_restaurant_id := get_current_restaurant_id(); END IF;
  SELECT COALESCE(MAX(number), 0) INTO v_max FROM restaurant_tables;
  IF v_max < v_count THEN
    FOR i IN (v_max + 1)..v_count LOOP
      INSERT INTO restaurant_tables (number, status, capacity, restaurant_id)
      VALUES (i, 'empty', 4, v_restaurant_id)
      ON CONFLICT (restaurant_id, number) DO NOTHING;
    END LOOP;
  END IF;
END; $$;

-- close_order / add_payment / send_to_kitchen / kitchen / phone / reservations / draft:
-- restore from production Phase 3 dump captured in this prepare (same bodies as
-- supabase/migrations/20260820155000_* and 20260820160000 after apply).
-- If those CREATE OR REPLACE blocks are needed in isolation, re-apply the function
-- sections from the Phase 3A/3 migration files; they do not touch Phase 1-3 schema.

-- Restored Phase 3A RPC bodies (log_order_event through sync_restaurant_tables)

CREATE OR REPLACE FUNCTION public.log_order_event(
  p_order_id UUID,
  p_event_type TEXT,
  p_message TEXT,
  p_actor_id UUID DEFAULT auth.uid(),
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id UUID;
BEGIN
  SELECT restaurant_id INTO v_restaurant_id
  FROM orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  INSERT INTO order_events (order_id, event_type, message, actor_id, metadata, restaurant_id)
  VALUES (p_order_id, p_event_type, p_message, p_actor_id, p_metadata, v_restaurant_id);
END;
$$;

-- ============================================================
-- open_table_order: restaurant_id from table
-- ============================================================

CREATE OR REPLACE FUNCTION public.open_table_order(
  p_table_id UUID,
  p_waiter_id UUID DEFAULT auth.uid()
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID;
  v_table_status table_status;
  v_restaurant_id UUID;
BEGIN
  IF get_user_role() NOT IN ('admin', 'waiter') THEN RAISE EXCEPTION 'Permission denied'; END IF;
  SELECT status, restaurant_id INTO v_table_status, v_restaurant_id
  FROM restaurant_tables WHERE id = p_table_id FOR UPDATE;
  IF v_table_status = 'empty' OR v_table_status IS NULL THEN
    INSERT INTO orders (order_number, order_type, table_id, waiter_id, created_by, status, restaurant_id)
    VALUES (generate_order_number('dine_in'), 'dine_in', p_table_id, p_waiter_id, p_waiter_id, 'open', v_restaurant_id)
    RETURNING id INTO v_order_id;
    UPDATE restaurant_tables SET status = 'occupied', current_order_id = v_order_id WHERE id = p_table_id;
    PERFORM log_order_event(v_order_id, 'created', 'Zakaz yaratildi', p_waiter_id, jsonb_build_object('table_id', p_table_id));
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_data, restaurant_id)
    VALUES (p_waiter_id, 'order_created', 'order', v_order_id, jsonb_build_object('table_id', p_table_id), v_restaurant_id);
    RETURN v_order_id;
  END IF;
  SELECT id INTO v_order_id FROM orders WHERE table_id = p_table_id AND status IN ('open', 'awaiting_payment') LIMIT 1;
  IF v_order_id IS NULL THEN RAISE EXCEPTION 'Table is not available'; END IF;
  RETURN v_order_id;
END;
$$;

-- ============================================================
-- upsert_draft_order_item: restaurant_id from order
-- Ownership / auth checks unchanged.
-- ============================================================

CREATE OR REPLACE FUNCTION public.upsert_draft_order_item(
  p_order_id UUID,
  p_menu_item_id UUID,
  p_quantity INT,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_menu menu_items%ROWTYPE;
  v_item_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF COALESCE(get_user_role()::text, '') NOT IN ('admin', 'waiter') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF NOT (
    is_admin()
    OR v_order.waiter_id = auth.uid()
    OR v_order.created_by = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF v_order.status NOT IN ('open', 'draft') THEN
    RAISE EXCEPTION 'Order cannot accept draft items';
  END IF;

  IF p_quantity < 1 THEN
    DELETE FROM order_items
    WHERE order_id = p_order_id
      AND menu_item_id = p_menu_item_id
      AND status = 'pending';
    PERFORM recalculate_order_totals(p_order_id);
    RETURN NULL;
  END IF;

  SELECT * INTO v_menu FROM menu_items WHERE id = p_menu_item_id AND is_available = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Menu item not available';
  END IF;

  SELECT id INTO v_item_id
  FROM order_items
  WHERE order_id = p_order_id
    AND menu_item_id = p_menu_item_id
    AND status = 'pending'
  LIMIT 1;

  IF v_item_id IS NOT NULL THEN
    UPDATE order_items SET
      quantity = p_quantity,
      unit_price = v_menu.price,
      total_price = v_menu.price * p_quantity,
      notes = p_notes,
      updated_at = now()
    WHERE id = v_item_id;
  ELSE
    INSERT INTO order_items (
      order_id, menu_item_id, kitchen_ticket_id,
      quantity, unit_price, total_price, notes,
      status, idempotency_key, restaurant_id
    ) VALUES (
      p_order_id,
      v_menu.id,
      NULL,
      p_quantity,
      v_menu.price,
      v_menu.price * p_quantity,
      p_notes,
      'pending',
      'draft:' || p_order_id::text || ':' || v_menu.id::text,
      v_order.restaurant_id
    )
    RETURNING id INTO v_item_id;
  END IF;

  PERFORM recalculate_order_totals(p_order_id);
  RETURN v_item_id;
END;
$$;

-- ============================================================
-- send_to_kitchen: restaurant_id from order
-- ============================================================

CREATE OR REPLACE FUNCTION public.send_to_kitchen(
  p_order_id UUID,
  p_items JSONB,
  p_idempotency_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket_id UUID;
  v_item JSONB;
  v_menu_item menu_items%ROWTYPE;
  v_order orders%ROWTYPE;
  v_qty INT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM order_items
    WHERE idempotency_key = p_idempotency_key
       OR idempotency_key LIKE p_idempotency_key || '-%'
  ) THEN
    SELECT kitchen_ticket_id INTO v_ticket_id
    FROM order_items
    WHERE idempotency_key = p_idempotency_key
       OR idempotency_key LIKE p_idempotency_key || '-%'
    LIMIT 1;
    RETURN v_ticket_id;
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.status NOT IN ('open', 'draft') THEN
    RAISE EXCEPTION 'Order cannot accept new kitchen sends';
  END IF;

  INSERT INTO kitchen_tickets (order_id, table_id, waiter_id, order_type, status, restaurant_id)
  VALUES (
    p_order_id,
    v_order.table_id,
    COALESCE(v_order.waiter_id, v_order.created_by),
    v_order.order_type,
    'new',
    v_order.restaurant_id
  )
  RETURNING id INTO v_ticket_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT * INTO v_menu_item FROM menu_items WHERE id = (v_item->>'menu_item_id')::UUID;
    v_qty := (v_item->>'quantity')::INT;

    UPDATE order_items SET
      kitchen_ticket_id = v_ticket_id,
      quantity = v_qty,
      notes = v_item->>'notes',
      unit_price = v_menu_item.price,
      total_price = v_menu_item.price * v_qty,
      status = 'sent',
      idempotency_key = p_idempotency_key || '-' || v_menu_item.id::text,
      sent_to_kitchen_at = now(),
      updated_at = now()
    WHERE order_id = p_order_id
      AND menu_item_id = v_menu_item.id
      AND status = 'pending';

    IF NOT FOUND THEN
      INSERT INTO order_items (
        order_id, menu_item_id, kitchen_ticket_id,
        quantity, unit_price, total_price, notes,
        status, idempotency_key, sent_to_kitchen_at, restaurant_id
      ) VALUES (
        p_order_id,
        v_menu_item.id,
        v_ticket_id,
        v_qty,
        v_menu_item.price,
        v_menu_item.price * v_qty,
        v_item->>'notes',
        'sent',
        p_idempotency_key || '-' || v_menu_item.id::text,
        now(),
        v_order.restaurant_id
      );
    END IF;
  END LOOP;

  PERFORM recalculate_order_totals(p_order_id);

  IF v_order.table_id IS NOT NULL THEN
    UPDATE restaurant_tables SET status = 'has_order' WHERE id = v_order.table_id;
  END IF;

  IF v_order.order_type IN ('pickup', 'delivery') THEN
    UPDATE orders SET fulfillment_status = 'in_kitchen', status = 'open' WHERE id = p_order_id;
    PERFORM log_order_event(p_order_id, 'sent_to_kitchen', 'Oshxonaga yuborildi', auth.uid(), '{}');
  ELSE
    UPDATE orders SET status = 'open' WHERE id = p_order_id;
  END IF;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_data, restaurant_id)
  VALUES (auth.uid(), 'order_sent_to_kitchen', 'kitchen_ticket', v_ticket_id,
    jsonb_build_object('order_id', p_order_id, 'idempotency_key', p_idempotency_key), v_order.restaurant_id);

  RETURN v_ticket_id;
END;
$$;

-- ============================================================
-- update_kitchen_ticket_status: audit_logs restaurant_id from order
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_kitchen_ticket_status(
  p_ticket_id UUID,
  p_status kitchen_ticket_status
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket kitchen_tickets;
  v_order orders;
BEGIN
  IF get_user_role() NOT IN ('admin', 'kitchen') THEN RAISE EXCEPTION 'Permission denied'; END IF;
  SELECT * INTO v_ticket FROM kitchen_tickets WHERE id = p_ticket_id FOR UPDATE;
  SELECT * INTO v_order FROM orders WHERE id = v_ticket.order_id FOR UPDATE;
  UPDATE kitchen_tickets SET status = p_status,
    accepted_at = CASE WHEN p_status = 'accepted' THEN now() ELSE accepted_at END,
    started_at = CASE WHEN p_status = 'in_progress' THEN now() ELSE started_at END,
    ready_at = CASE WHEN p_status = 'ready' THEN now() ELSE ready_at END
  WHERE id = p_ticket_id;
  UPDATE order_items SET status = CASE p_status
    WHEN 'accepted' THEN 'accepted'::order_item_status
    WHEN 'in_progress' THEN 'in_progress'::order_item_status
    WHEN 'ready' THEN 'ready'::order_item_status ELSE status END
  WHERE kitchen_ticket_id = p_ticket_id;
  IF p_status = 'accepted' THEN
    PERFORM log_order_event(v_order.id, 'kitchen_accepted', 'Oshxona qabul qildi', auth.uid(), '{}');
  END IF;
  IF p_status = 'in_progress' AND v_order.table_id IS NOT NULL THEN
    UPDATE restaurant_tables SET status = 'preparing' WHERE id = v_order.table_id;
    PERFORM log_order_event(v_order.id, 'preparing', 'Tayyorlanmoqda', auth.uid(), '{}');
  END IF;
  IF p_status = 'ready' THEN
    PERFORM notify_staff_order_ready(v_order, p_ticket_id);
    PERFORM log_order_event(v_order.id, 'kitchen_ready', 'Tayyor bo''ldi', auth.uid(), '{}');
    IF NOT EXISTS (SELECT 1 FROM kitchen_tickets WHERE order_id = v_ticket.order_id AND status NOT IN ('ready', 'cancelled')) THEN
      IF v_order.table_id IS NOT NULL THEN UPDATE restaurant_tables SET status = 'ready' WHERE id = v_order.table_id; END IF;
      IF v_order.order_type IN ('pickup', 'delivery') THEN
        UPDATE orders SET fulfillment_status = 'ready', kitchen_ready_at = now() WHERE id = v_order.id;
      END IF;
    END IF;
  END IF;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_data, restaurant_id)
  VALUES (auth.uid(), 'status_changed', 'kitchen_ticket', p_ticket_id, jsonb_build_object('status', p_status), v_order.restaurant_id);
END;
$$;

-- ============================================================
-- notify_staff_order_ready: restaurant_id from order
-- ============================================================

CREATE OR REPLACE FUNCTION public.notify_staff_order_ready(p_order orders, p_ticket_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title TEXT;
  v_body TEXT;
  v_type notification_type;
BEGIN
  IF p_order.order_type = 'pickup' THEN
    v_type := 'pickup_ready'; v_title := 'ZAKAZ TAYYOR';
    v_body := format('%s · %s · Olib ketish', p_order.order_number, COALESCE(p_order.customer_name, 'Mijoz'));
  ELSIF p_order.order_type = 'delivery' THEN
    v_type := 'delivery_ready'; v_title := 'ZAKAZ TAYYOR';
    v_body := format('%s · %s · Dostavka', p_order.order_number, COALESCE(p_order.customer_name, 'Mijoz'));
  ELSE
    v_type := 'order_ready'; v_title := 'Buyurtma tayyor!';
    v_body := format('Stol %s buyurtmasi tayyor!', (SELECT number FROM restaurant_tables WHERE id = p_order.table_id));
  END IF;
  IF p_order.order_type IN ('pickup', 'delivery') THEN
    INSERT INTO notifications (user_id, type, title, body, data, restaurant_id)
    SELECT p.id, v_type, v_title, v_body,
      jsonb_build_object('order_id', p_order.id, 'order_number', p_order.order_number, 'order_type', p_order.order_type, 'ticket_id', p_ticket_id, 'customer_name', p_order.customer_name),
      p_order.restaurant_id
    FROM profiles p WHERE p.role IN ('admin', 'cashier') AND p.is_active = true;
  ELSIF p_order.waiter_id IS NOT NULL THEN
    INSERT INTO notifications (user_id, type, title, body, data, restaurant_id)
    VALUES (p_order.waiter_id, v_type, v_title, v_body, jsonb_build_object('ticket_id', p_ticket_id, 'table_id', p_order.table_id, 'order_id', p_order.id), p_order.restaurant_id);
  END IF;
END;
$$;

-- ============================================================
-- add_payment: restaurant_id from order
-- ============================================================

CREATE OR REPLACE FUNCTION public.add_payment(
  p_order_id UUID,
  p_amount NUMERIC,
  p_method payment_method,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_id UUID;
  v_order orders;
  v_paid NUMERIC(12,2);
BEGIN
  IF NOT is_cashier_or_admin() THEN RAISE EXCEPTION 'Permission denied'; END IF;
  IF p_idempotency_key IS NOT NULL AND EXISTS (SELECT 1 FROM payments WHERE idempotency_key = p_idempotency_key) THEN
    SELECT id INTO v_payment_id FROM payments WHERE idempotency_key = p_idempotency_key; RETURN v_payment_id; END IF;
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.status NOT IN ('open', 'awaiting_payment') THEN RAISE EXCEPTION 'Order is not open for payment'; END IF;
  INSERT INTO payments (order_id, amount, method, cashier_id, idempotency_key, restaurant_id)
  VALUES (p_order_id, p_amount, p_method, auth.uid(), p_idempotency_key, v_order.restaurant_id)
  RETURNING id INTO v_payment_id;
  SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM payments WHERE order_id = p_order_id AND status = 'completed';
  PERFORM log_order_event(p_order_id, 'payment', format('To''lov: %s', p_amount), auth.uid(), jsonb_build_object('method', p_method, 'amount', p_amount));
  IF v_paid >= v_order.total THEN
    IF v_order.order_type = 'dine_in' THEN PERFORM close_order(p_order_id);
    ELSE UPDATE orders SET status = 'awaiting_payment' WHERE id = p_order_id; END IF;
  ELSE
    UPDATE orders SET status = 'awaiting_payment' WHERE id = p_order_id;
    IF v_order.table_id IS NOT NULL THEN UPDATE restaurant_tables SET status = 'awaiting_payment' WHERE id = v_order.table_id; END IF;
  END IF;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_data, restaurant_id)
  VALUES (auth.uid(), 'payment_added', 'payment', v_payment_id, jsonb_build_object('amount', p_amount, 'method', p_method), v_order.restaurant_id);
  RETURN v_payment_id;
END;
$$;

-- ============================================================
-- close_order: cash_session + audit from order.restaurant_id
-- ON CONFLICT (session_date) KEPT — matches current UNIQUE(session_date).
-- Retarget to (restaurant_id, session_date) in Phase 3 unique swap.
-- ============================================================

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
  ON CONFLICT (session_date) DO UPDATE SET order_count = cash_sessions.order_count + 1,
    total_revenue = cash_sessions.total_revenue + EXCLUDED.total_revenue,
    cash_total = cash_sessions.cash_total + EXCLUDED.cash_total, card_total = cash_sessions.card_total + EXCLUDED.card_total,
    click_total = cash_sessions.click_total + EXCLUDED.click_total, payme_total = cash_sessions.payme_total + EXCLUDED.payme_total,
    other_total = cash_sessions.other_total + EXCLUDED.other_total, updated_at = now();
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_data, restaurant_id)
  VALUES (auth.uid(), 'order_closed', 'order', p_order_id, jsonb_build_object('total', v_order.total, 'paid', v_paid), v_order.restaurant_id);
END;
$$;

-- ============================================================
-- create_phone_order: restaurant_id from current membership
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_phone_order(
  p_order_type order_type,
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_items JSONB,
  p_notes TEXT DEFAULT NULL,
  p_scheduled_ready_at TIMESTAMPTZ DEFAULT NULL,
  p_scheduled_delivery_at TIMESTAMPTZ DEFAULT NULL,
  p_delivery_address TEXT DEFAULT NULL,
  p_delivery_landmark TEXT DEFAULT NULL,
  p_delivery_fee NUMERIC DEFAULT 0,
  p_discount_amount NUMERIC DEFAULT 0,
  p_payment_method payment_method DEFAULT NULL,
  p_prepayment_amount NUMERIC DEFAULT 0,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID;
  v_ticket_id UUID;
  v_item JSONB;
  v_menu_item menu_items;
  v_key TEXT;
  v_restaurant_id UUID;
BEGIN
  IF NOT is_cashier_or_admin() THEN RAISE EXCEPTION 'Only admin or cashier can create phone orders'; END IF;
  IF p_order_type NOT IN ('pickup', 'delivery') THEN RAISE EXCEPTION 'Invalid order type for phone order'; END IF;
  IF p_order_type = 'delivery' AND (p_delivery_address IS NULL OR trim(p_delivery_address) = '') THEN
    RAISE EXCEPTION 'Delivery address required'; END IF;
  IF p_idempotency_key IS NOT NULL AND EXISTS (SELECT 1 FROM orders WHERE idempotency_key = p_idempotency_key) THEN
    SELECT id INTO v_order_id FROM orders WHERE idempotency_key = p_idempotency_key; RETURN v_order_id; END IF;

  v_restaurant_id := get_current_restaurant_id();

  INSERT INTO orders (order_number, order_type, created_by, status, fulfillment_status,
    customer_name, customer_phone, delivery_address, delivery_landmark, delivery_fee, discount_amount,
    notes, payment_method_preference, scheduled_ready_at, scheduled_delivery_at, idempotency_key, restaurant_id)
  VALUES (generate_order_number(p_order_type), p_order_type, auth.uid(), 'open', 'new',
    p_customer_name, p_customer_phone, p_delivery_address, p_delivery_landmark,
    COALESCE(p_delivery_fee, 0), COALESCE(p_discount_amount, 0), p_notes, p_payment_method,
    p_scheduled_ready_at, p_scheduled_delivery_at, p_idempotency_key, v_restaurant_id)
  RETURNING id INTO v_order_id;
  PERFORM log_order_event(v_order_id, 'created', 'Zakaz yaratildi', auth.uid(),
    jsonb_build_object('order_type', p_order_type, 'customer', p_customer_name));
  v_key := COALESCE(p_idempotency_key, gen_random_uuid()::text);
  INSERT INTO kitchen_tickets (order_id, waiter_id, order_type, status, restaurant_id)
  VALUES (v_order_id, auth.uid(), p_order_type, 'new', v_restaurant_id) RETURNING id INTO v_ticket_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_menu_item FROM menu_items WHERE id = (v_item->>'menu_item_id')::UUID;
    IF NOT FOUND THEN RAISE EXCEPTION 'Menu item not found'; END IF;
    INSERT INTO order_items (order_id, menu_item_id, kitchen_ticket_id, quantity, unit_price, total_price, notes, status, idempotency_key, sent_to_kitchen_at, restaurant_id)
    VALUES (v_order_id, v_menu_item.id, v_ticket_id, GREATEST((v_item->>'quantity')::INT, 1), v_menu_item.price,
      v_menu_item.price * GREATEST((v_item->>'quantity')::INT, 1), v_item->>'notes', 'sent', v_key || '-' || v_menu_item.id, now(), v_restaurant_id);
  END LOOP;
  PERFORM recalculate_order_totals(v_order_id);
  UPDATE orders SET fulfillment_status = 'in_kitchen' WHERE id = v_order_id;
  PERFORM log_order_event(v_order_id, 'sent_to_kitchen', 'Oshxonaga yuborildi', auth.uid(), '{}');
  IF COALESCE(p_prepayment_amount, 0) > 0 AND p_payment_method IS NOT NULL THEN
    PERFORM add_payment(v_order_id, p_prepayment_amount, p_payment_method, v_key || '-prepay'); END IF;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_data, restaurant_id)
  VALUES (auth.uid(), 'order_created', 'order', v_order_id, jsonb_build_object('order_type', p_order_type, 'phone', true), v_restaurant_id);
  RETURN v_order_id;
END;
$$;

-- ============================================================
-- create_table_reservation: restaurant_id from table
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_table_reservation(
  p_table_id UUID,
  p_customer_name TEXT,
  p_phone TEXT,
  p_reserved_for TIMESTAMPTZ,
  p_guest_count INT DEFAULT 2,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_status table_status;
  v_restaurant_id UUID;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Forbidden'; END IF;

  SELECT status, restaurant_id INTO v_status, v_restaurant_id
  FROM restaurant_tables WHERE id = p_table_id AND is_active = true FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Table not found'; END IF;
  IF v_status NOT IN ('empty', 'reserved') THEN
    RAISE EXCEPTION 'Table is not available for reservation';
  END IF;

  IF reservation_has_conflict(p_table_id, p_reserved_for) THEN
    RAISE EXCEPTION 'Conflicting reservation exists for this time';
  END IF;

  INSERT INTO table_reservations (
    table_id, customer_name, phone, reserved_for, guest_count, notes, created_by, restaurant_id
  ) VALUES (
    p_table_id, trim(p_customer_name), NULLIF(trim(p_phone), ''), p_reserved_for,
    GREATEST(p_guest_count, 1), p_notes, auth.uid(), v_restaurant_id
  ) RETURNING id INTO v_id;

  UPDATE restaurant_tables SET status = 'reserved' WHERE id = p_table_id AND status = 'empty';

  RETURN v_id;
END;
$$;

-- ============================================================
-- admin_upsert_table: restaurant_id from current membership on INSERT
-- ON CONFLICT (number) KEPT — matches current UNIQUE(number).
-- ============================================================

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
  ON CONFLICT (number) DO UPDATE SET
    capacity = EXCLUDED.capacity,
    zone = EXCLUDED.zone,
    name = EXCLUDED.name,
    is_active = EXCLUDED.is_active,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ============================================================
-- sync_restaurant_tables: restaurant_id from settings (fallback membership)
-- ON CONFLICT (number) KEPT.
-- ============================================================

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
      ON CONFLICT (number) DO NOTHING;
    END LOOP;
  END IF;
END;
$$;

-- UPDATE-only RPCs (no INSERT): request_bill, cancel_table_reservation,
-- check_in_reservation (delegates to open_table_order), set_table_cleaning,
-- set_table_available, recalculate_order_totals, mark_order_awaiting_pickup,
-- mark_order_picked_up, dispatch_delivery_order, mark_order_delivered.
-- No restaurant_id write patch required.

-- ============================================================
-- ROLLBACK (do not run with this migration)
-- Restore previous function bodies from production (pre-3A) and:
-- DROP FUNCTION IF EXISTS public.get_current_restaurant_id();
-- ============================================================

-- Phase 3 close_order (tenant unique cash_sessions)

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

