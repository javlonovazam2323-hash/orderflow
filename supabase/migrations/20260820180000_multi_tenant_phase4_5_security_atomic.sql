-- Phase 4+5 ATOMIC security rollout: tenant RLS + SECURITY DEFINER RPC isolation.
--
-- STATUS: DO NOT APPLY TO PRODUCTION.
-- Apply only after explicit TASDIQ. This entire file is one transaction.
--
-- Replaces the withdrawn Phase-4-only migration (RLS without RPC patches).
-- Does NOT start Phase 6/7/8. Does NOT change storage. Does NOT DELETE data.
-- Does NOT trust client restaurant_id. Tenant comes from resource or membership.
--
-- Authorization source: restaurant_members (user_id, restaurant_id, role, is_active).
-- profiles.role is not used for tenant authorization in new policies/RPCs.

-- =============================================================================
-- 1. Helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION public.current_restaurant_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.restaurant_id
  FROM public.restaurant_members m
  WHERE auth.uid() IS NOT NULL
    AND m.user_id = auth.uid()
    AND m.is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.is_restaurant_member(rid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR rid IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.restaurant_members m
    WHERE m.restaurant_id = rid
      AND m.user_id = auth.uid()
      AND m.is_active = true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.has_restaurant_role(rid UUID, roles TEXT[])
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR rid IS NULL OR roles IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.restaurant_members m
    WHERE m.restaurant_id = rid
      AND m.user_id = auth.uid()
      AND m.is_active = true
      AND m.role::text = ANY (roles)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_restaurant_admin(rid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.has_restaurant_role(rid, ARRAY['admin']::text[]);
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_auth()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  RETURN auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_restaurant_role(rid UUID, roles TEXT[])
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_auth();
  IF rid IS NULL THEN
    RAISE EXCEPTION 'Restaurant required';
  END IF;
  IF NOT public.has_restaurant_role(rid, roles) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  RETURN rid;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_create_restaurant_id(p_restaurant_id UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_auth();
  IF p_restaurant_id IS NOT NULL THEN
    IF NOT public.is_restaurant_member(p_restaurant_id) THEN
      RAISE EXCEPTION 'Not a member of this restaurant';
    END IF;
    RETURN p_restaurant_id;
  END IF;
  RETURN public.get_current_restaurant_id();
END;
$$;

CREATE INDEX IF NOT EXISTS idx_restaurant_members_user_active
  ON public.restaurant_members (user_id)
  WHERE is_active = true;

-- =============================================================================
-- 2. Tenant order numbers (UNIQUE(restaurant_id, order_number) compatible)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.restaurant_order_counters (
  restaurant_id UUID PRIMARY KEY REFERENCES public.restaurants(id),
  dine_in BIGINT NOT NULL DEFAULT 0,
  pickup BIGINT NOT NULL DEFAULT 0,
  delivery BIGINT NOT NULL DEFAULT 0
);

INSERT INTO public.restaurant_order_counters (restaurant_id, dine_in, pickup, delivery)
SELECT r.id,
  COALESCE((
    SELECT MAX(o.order_number::bigint) FROM public.orders o
    WHERE o.restaurant_id = r.id AND o.order_number ~ '^[0-9]+$'
  ), 0),
  COALESCE((
    SELECT MAX(substring(o.order_number from 3)::bigint) FROM public.orders o
    WHERE o.restaurant_id = r.id AND o.order_number ~ '^P-[0-9]+$'
  ), 0),
  COALESCE((
    SELECT MAX(substring(o.order_number from 3)::bigint) FROM public.orders o
    WHERE o.restaurant_id = r.id AND o.order_number ~ '^D-[0-9]+$'
  ), 0)
FROM public.restaurants r
ON CONFLICT (restaurant_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.generate_order_number(p_type order_type, p_restaurant_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n BIGINT;
BEGIN
  IF p_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Restaurant required';
  END IF;
  INSERT INTO public.restaurant_order_counters (restaurant_id)
  VALUES (p_restaurant_id)
  ON CONFLICT (restaurant_id) DO NOTHING;

  IF p_type = 'pickup' THEN
    UPDATE public.restaurant_order_counters
      SET pickup = pickup + 1
      WHERE restaurant_id = p_restaurant_id
      RETURNING pickup INTO v_n;
    RETURN 'P-' || lpad(v_n::text, 6, '0');
  ELSIF p_type = 'delivery' THEN
    UPDATE public.restaurant_order_counters
      SET delivery = delivery + 1
      WHERE restaurant_id = p_restaurant_id
      RETURNING delivery INTO v_n;
    RETURN 'D-' || lpad(v_n::text, 6, '0');
  END IF;

  UPDATE public.restaurant_order_counters
    SET dine_in = dine_in + 1
    WHERE restaurant_id = p_restaurant_id
    RETURNING dine_in INTO v_n;
  RETURN lpad(v_n::text, 6, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_order_number(p_type order_type DEFAULT 'dine_in'::order_type)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.generate_order_number(p_type, public.get_current_restaurant_id());
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.generate_order_number('dine_in'::order_type, public.get_current_restaurant_id());
END;
$$;

-- =============================================================================
-- 3. Totals / notifications / PIN
-- =============================================================================

CREATE OR REPLACE FUNCTION public.recalculate_order_totals(p_order_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subtotal NUMERIC(12,2);
  v_service_pct NUMERIC(5,2);
  v_tax_pct NUMERIC(5,2);
  v_service NUMERIC(12,2);
  v_tax NUMERIC(12,2);
  v_delivery_fee NUMERIC(12,2);
  v_discount NUMERIC(12,2);
  v_order_type order_type;
  v_restaurant_id UUID;
BEGIN
  SELECT COALESCE(SUM(total_price), 0) INTO v_subtotal
  FROM order_items WHERE order_id = p_order_id AND status NOT IN ('cancelled');

  SELECT restaurant_id, COALESCE(delivery_fee, 0), COALESCE(discount_amount, 0), order_type
    INTO v_restaurant_id, v_delivery_fee, v_discount, v_order_type
  FROM orders WHERE id = p_order_id;

  SELECT s.service_charge_percent, s.tax_percent
    INTO v_service_pct, v_tax_pct
  FROM restaurant_settings s
  WHERE s.restaurant_id = v_restaurant_id
  LIMIT 1;

  IF v_order_type IN ('pickup', 'delivery') THEN v_service := 0;
  ELSE v_service := ROUND(v_subtotal * COALESCE(v_service_pct, 0) / 100, 0); END IF;
  v_tax := ROUND((v_subtotal + v_service + v_delivery_fee - v_discount) * COALESCE(v_tax_pct, 0) / 100, 0);
  UPDATE orders SET subtotal = v_subtotal, service_charge = v_service, tax_amount = v_tax,
    total = GREATEST(v_subtotal + v_service + v_tax + v_delivery_fee - v_discount, 0), updated_at = now()
  WHERE id = p_order_id;
END;
$$;

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
  IF p_order.restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Order restaurant required';
  END IF;
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
    SELECT m.user_id, v_type, v_title, v_body,
      jsonb_build_object('order_id', p_order.id, 'order_number', p_order.order_number, 'order_type', p_order.order_type, 'ticket_id', p_ticket_id, 'customer_name', p_order.customer_name),
      p_order.restaurant_id
    FROM restaurant_members m
    JOIN profiles p ON p.id = m.user_id
    WHERE m.restaurant_id = p_order.restaurant_id
      AND m.is_active = true
      AND m.role IN ('admin', 'cashier')
      AND p.is_active = true;
  ELSIF p_order.waiter_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM restaurant_members m
      WHERE m.restaurant_id = p_order.restaurant_id
        AND m.user_id = p_order.waiter_id
        AND m.is_active = true
    ) THEN
      RETURN;
    END IF;
    INSERT INTO notifications (user_id, type, title, body, data, restaurant_id)
    VALUES (p_order.waiter_id, v_type, v_title, v_body, jsonb_build_object('ticket_id', p_ticket_id, 'table_id', p_order.table_id, 'order_id', p_order.id), p_order.restaurant_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_pin(p_pin text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_profile_id UUID;
  v_matches INT;
BEGIN
  SELECT COUNT(*), MIN(p.id)
    INTO v_matches, v_profile_id
  FROM profiles p
  WHERE p.is_active = true
    AND p.pin_hash IS NOT NULL
    AND p.pin_hash = extensions.crypt(p_pin, p.pin_hash)
    AND EXISTS (
      SELECT 1 FROM restaurant_members m
      WHERE m.user_id = p.id AND m.is_active = true
    );

  IF v_matches = 0 THEN
    RAISE EXCEPTION 'Invalid PIN';
  END IF;
  IF v_matches > 1 THEN
    RAISE EXCEPTION 'PIN is not unique across restaurants';
  END IF;
  RETURN v_profile_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_pin(p_pin text, p_restaurant_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_profile_id UUID;
BEGIN
  IF p_restaurant_id IS NULL THEN
    RETURN public.verify_pin(p_pin);
  END IF;
  SELECT p.id INTO v_profile_id
  FROM profiles p
  JOIN restaurant_members m ON m.user_id = p.id AND m.is_active = true
  WHERE p.is_active = true
    AND p.pin_hash IS NOT NULL
    AND p.pin_hash = extensions.crypt(p_pin, p.pin_hash)
    AND m.restaurant_id = p_restaurant_id;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Invalid PIN';
  END IF;
  RETURN v_profile_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_profile_pin(p_profile_id uuid, p_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.assert_auth();
  IF NOT EXISTS (
    SELECT 1
    FROM restaurant_members a
    JOIN restaurant_members t ON t.restaurant_id = a.restaurant_id AND t.is_active = true
    WHERE a.user_id = auth.uid()
      AND a.role = 'admin'
      AND a.is_active = true
      AND t.user_id = p_profile_id
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF p_pin IS NULL OR length(trim(p_pin)) = 0 THEN
    UPDATE profiles SET pin_hash = NULL, updated_at = now() WHERE id = p_profile_id;
  ELSE
    UPDATE profiles
    SET pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')), updated_at = now()
    WHERE id = p_profile_id;
  END IF;
END;
$$;

-- =============================================================================
-- 4. Business RPCs — resource restaurant_id + membership role
-- =============================================================================

CREATE OR REPLACE FUNCTION public.log_order_event(p_order_id uuid, p_event_type text, p_message text, p_actor_id uuid DEFAULT auth.uid(), p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id UUID;
BEGIN
  SELECT restaurant_id INTO v_restaurant_id FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  INSERT INTO order_events (order_id, event_type, message, actor_id, metadata, restaurant_id)
  VALUES (p_order_id, p_event_type, p_message, p_actor_id, p_metadata, v_restaurant_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.open_table_order(p_table_id uuid, p_waiter_id uuid DEFAULT auth.uid())
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID;
  v_table_status table_status;
  v_restaurant_id UUID;
  v_waiter UUID;
BEGIN
  PERFORM public.assert_auth();
  v_waiter := COALESCE(p_waiter_id, auth.uid());
  SELECT status, restaurant_id INTO v_table_status, v_restaurant_id
  FROM restaurant_tables WHERE id = p_table_id FOR UPDATE;
  IF NOT FOUND OR v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Table not found';
  END IF;
  PERFORM public.assert_restaurant_role(v_restaurant_id, ARRAY['admin', 'waiter']::text[]);
  IF v_waiter IS DISTINCT FROM auth.uid() THEN
    PERFORM public.assert_restaurant_role(v_restaurant_id, ARRAY['admin']::text[]);
    IF NOT EXISTS (
      SELECT 1 FROM restaurant_members m
      WHERE m.restaurant_id = v_restaurant_id AND m.user_id = v_waiter AND m.is_active = true
        AND m.role IN ('waiter', 'admin')
    ) THEN
      RAISE EXCEPTION 'Waiter is not a member of this restaurant';
    END IF;
  END IF;
  IF v_table_status = 'empty' OR v_table_status IS NULL THEN
    INSERT INTO orders (order_number, order_type, table_id, waiter_id, created_by, status, restaurant_id)
    VALUES (generate_order_number('dine_in'::order_type, v_restaurant_id), 'dine_in', p_table_id, v_waiter, v_waiter, 'open', v_restaurant_id)
    RETURNING id INTO v_order_id;
    UPDATE restaurant_tables SET status = 'occupied', current_order_id = v_order_id WHERE id = p_table_id;
    PERFORM log_order_event(v_order_id, 'created', 'Zakaz yaratildi', v_waiter, jsonb_build_object('table_id', p_table_id));
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_data, restaurant_id)
    VALUES (v_waiter, 'order_created', 'order', v_order_id, jsonb_build_object('table_id', p_table_id), v_restaurant_id);
    RETURN v_order_id;
  END IF;
  SELECT id INTO v_order_id FROM orders
  WHERE table_id = p_table_id AND restaurant_id = v_restaurant_id AND status IN ('open', 'awaiting_payment') LIMIT 1;
  IF v_order_id IS NULL THEN RAISE EXCEPTION 'Table is not available'; END IF;
  RETURN v_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_draft_order_item(p_order_id uuid, p_menu_item_id uuid, p_quantity integer, p_notes text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_menu menu_items%ROWTYPE;
  v_item_id UUID;
BEGIN
  PERFORM public.assert_auth();
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  PERFORM public.assert_restaurant_role(v_order.restaurant_id, ARRAY['admin', 'waiter']::text[]);
  IF NOT (
    public.has_restaurant_role(v_order.restaurant_id, ARRAY['admin']::text[])
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
    WHERE order_id = p_order_id AND menu_item_id = p_menu_item_id AND status = 'pending'
      AND restaurant_id = v_order.restaurant_id;
    PERFORM recalculate_order_totals(p_order_id);
    RETURN NULL;
  END IF;
  SELECT * INTO v_menu FROM menu_items WHERE id = p_menu_item_id AND is_available = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Menu item not available'; END IF;
  IF v_menu.restaurant_id IS DISTINCT FROM v_order.restaurant_id THEN
    RAISE EXCEPTION 'Menu item is not in this restaurant';
  END IF;
  SELECT id INTO v_item_id FROM order_items
  WHERE order_id = p_order_id AND menu_item_id = p_menu_item_id AND status = 'pending' LIMIT 1;
  IF v_item_id IS NOT NULL THEN
    UPDATE order_items SET quantity = p_quantity, unit_price = v_menu.price,
      total_price = v_menu.price * p_quantity, notes = p_notes, updated_at = now()
    WHERE id = v_item_id;
  ELSE
    INSERT INTO order_items (order_id, menu_item_id, kitchen_ticket_id, quantity, unit_price, total_price, notes, status, idempotency_key, restaurant_id)
    VALUES (p_order_id, v_menu.id, NULL, p_quantity, v_menu.price, v_menu.price * p_quantity, p_notes, 'pending',
      'draft:' || p_order_id::text || ':' || v_menu.id::text, v_order.restaurant_id)
    RETURNING id INTO v_item_id;
  END IF;
  PERFORM recalculate_order_totals(p_order_id);
  RETURN v_item_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_to_kitchen(p_order_id uuid, p_items jsonb, p_idempotency_key text)
RETURNS uuid
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
  PERFORM public.assert_auth();
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  PERFORM public.assert_restaurant_role(v_order.restaurant_id, ARRAY['admin', 'waiter']::text[]);

  IF EXISTS (
    SELECT 1 FROM order_items
    WHERE restaurant_id = v_order.restaurant_id
      AND (idempotency_key = p_idempotency_key OR idempotency_key LIKE p_idempotency_key || '-%')
  ) THEN
    SELECT kitchen_ticket_id INTO v_ticket_id FROM order_items
    WHERE restaurant_id = v_order.restaurant_id
      AND (idempotency_key = p_idempotency_key OR idempotency_key LIKE p_idempotency_key || '-%')
    LIMIT 1;
    RETURN v_ticket_id;
  END IF;

  IF v_order.status NOT IN ('open', 'draft') THEN
    RAISE EXCEPTION 'Order cannot accept new kitchen sends';
  END IF;

  INSERT INTO kitchen_tickets (order_id, table_id, waiter_id, order_type, status, restaurant_id)
  VALUES (p_order_id, v_order.table_id, COALESCE(v_order.waiter_id, v_order.created_by), v_order.order_type, 'new', v_order.restaurant_id)
  RETURNING id INTO v_ticket_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_menu_item FROM menu_items WHERE id = (v_item->>'menu_item_id')::UUID;
    IF NOT FOUND THEN RAISE EXCEPTION 'Menu item not found'; END IF;
    IF v_menu_item.restaurant_id IS DISTINCT FROM v_order.restaurant_id THEN
      RAISE EXCEPTION 'Menu item is not in this restaurant';
    END IF;
    v_qty := (v_item->>'quantity')::INT;

    UPDATE order_items SET
      kitchen_ticket_id = v_ticket_id, quantity = v_qty, notes = v_item->>'notes',
      unit_price = v_menu_item.price, total_price = v_menu_item.price * v_qty,
      status = 'sent', idempotency_key = p_idempotency_key || '-' || v_menu_item.id::text,
      sent_to_kitchen_at = now(), updated_at = now()
    WHERE order_id = p_order_id AND menu_item_id = v_menu_item.id AND status = 'pending'
      AND restaurant_id = v_order.restaurant_id;

    IF NOT FOUND THEN
      INSERT INTO order_items (order_id, menu_item_id, kitchen_ticket_id, quantity, unit_price, total_price, notes, status, idempotency_key, sent_to_kitchen_at, restaurant_id)
      VALUES (p_order_id, v_menu_item.id, v_ticket_id, v_qty, v_menu_item.price, v_menu_item.price * v_qty, v_item->>'notes', 'sent',
        p_idempotency_key || '-' || v_menu_item.id::text, now(), v_order.restaurant_id);
    END IF;
  END LOOP;

  PERFORM recalculate_order_totals(p_order_id);
  IF v_order.table_id IS NOT NULL THEN
    UPDATE restaurant_tables SET status = 'has_order'
    WHERE id = v_order.table_id AND restaurant_id = v_order.restaurant_id;
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

CREATE OR REPLACE FUNCTION public.update_kitchen_ticket_status(p_ticket_id uuid, p_status kitchen_ticket_status)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket kitchen_tickets;
  v_order orders;
BEGIN
  PERFORM public.assert_auth();
  SELECT * INTO v_ticket FROM kitchen_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found'; END IF;
  SELECT * INTO v_order FROM orders WHERE id = v_ticket.order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_ticket.restaurant_id IS DISTINCT FROM v_order.restaurant_id THEN
    RAISE EXCEPTION 'Ticket/order restaurant mismatch';
  END IF;
  PERFORM public.assert_restaurant_role(v_order.restaurant_id, ARRAY['admin', 'kitchen']::text[]);
  UPDATE kitchen_tickets SET status = p_status,
    accepted_at = CASE WHEN p_status = 'accepted' THEN now() ELSE accepted_at END,
    started_at = CASE WHEN p_status = 'in_progress' THEN now() ELSE started_at END,
    ready_at = CASE WHEN p_status = 'ready' THEN now() ELSE ready_at END
  WHERE id = p_ticket_id;
  UPDATE order_items SET status = CASE p_status
    WHEN 'accepted' THEN 'accepted'::order_item_status
    WHEN 'in_progress' THEN 'in_progress'::order_item_status
    WHEN 'ready' THEN 'ready'::order_item_status ELSE status END
  WHERE kitchen_ticket_id = p_ticket_id AND restaurant_id = v_order.restaurant_id;
  IF p_status = 'accepted' THEN
    PERFORM log_order_event(v_order.id, 'kitchen_accepted', 'Oshxona qabul qildi', auth.uid(), '{}');
  END IF;
  IF p_status = 'in_progress' AND v_order.table_id IS NOT NULL THEN
    UPDATE restaurant_tables SET status = 'preparing'
    WHERE id = v_order.table_id AND restaurant_id = v_order.restaurant_id;
    PERFORM log_order_event(v_order.id, 'preparing', 'Tayyorlanmoqda', auth.uid(), '{}');
  END IF;
  IF p_status = 'ready' THEN
    PERFORM notify_staff_order_ready(v_order, p_ticket_id);
    PERFORM log_order_event(v_order.id, 'kitchen_ready', 'Tayyor bo''ldi', auth.uid(), '{}');
    IF NOT EXISTS (SELECT 1 FROM kitchen_tickets WHERE order_id = v_ticket.order_id AND status NOT IN ('ready', 'cancelled')) THEN
      IF v_order.table_id IS NOT NULL THEN
        UPDATE restaurant_tables SET status = 'ready'
        WHERE id = v_order.table_id AND restaurant_id = v_order.restaurant_id;
      END IF;
      IF v_order.order_type IN ('pickup', 'delivery') THEN
        UPDATE orders SET fulfillment_status = 'ready', kitchen_ready_at = now() WHERE id = v_order.id;
      END IF;
    END IF;
  END IF;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_data, restaurant_id)
  VALUES (auth.uid(), 'status_changed', 'kitchen_ticket', p_ticket_id, jsonb_build_object('status', p_status), v_order.restaurant_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.close_order(p_order_id uuid)
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
  PERFORM public.assert_auth();
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  PERFORM public.assert_restaurant_role(v_order.restaurant_id, ARRAY['admin', 'cashier']::text[]);
  SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM payments WHERE order_id = p_order_id AND status = 'completed';
  IF v_paid < v_order.total THEN RAISE EXCEPTION 'Payment incomplete: paid % of %', v_paid, v_order.total; END IF;
  UPDATE orders SET status = 'paid', closed_at = now(),
    fulfillment_status = CASE WHEN v_order.order_type IN ('pickup', 'delivery') THEN 'completed'::fulfillment_status ELSE fulfillment_status END
  WHERE id = p_order_id;
  IF v_order.table_id IS NOT NULL THEN
    UPDATE restaurant_tables SET status = 'empty', current_order_id = NULL
    WHERE id = v_order.table_id AND restaurant_id = v_order.restaurant_id;
  END IF;
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

CREATE OR REPLACE FUNCTION public.add_payment(p_order_id uuid, p_amount numeric, p_method payment_method, p_idempotency_key text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_id UUID;
  v_order orders;
  v_paid NUMERIC(12,2);
BEGIN
  PERFORM public.assert_auth();
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  PERFORM public.assert_restaurant_role(v_order.restaurant_id, ARRAY['admin', 'cashier']::text[]);
  IF p_idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM payments WHERE idempotency_key = p_idempotency_key AND restaurant_id = v_order.restaurant_id
  ) THEN
    SELECT id INTO v_payment_id FROM payments WHERE idempotency_key = p_idempotency_key AND restaurant_id = v_order.restaurant_id;
    RETURN v_payment_id;
  END IF;
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
    IF v_order.table_id IS NOT NULL THEN
      UPDATE restaurant_tables SET status = 'awaiting_payment'
      WHERE id = v_order.table_id AND restaurant_id = v_order.restaurant_id;
    END IF;
  END IF;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_data, restaurant_id)
  VALUES (auth.uid(), 'payment_added', 'payment', v_payment_id, jsonb_build_object('amount', p_amount, 'method', p_method), v_order.restaurant_id);
  RETURN v_payment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_bill(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_order orders;
BEGIN
  PERFORM public.assert_auth();
  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  PERFORM public.assert_restaurant_role(v_order.restaurant_id, ARRAY['admin', 'waiter', 'cashier']::text[]);
  UPDATE orders SET status = 'awaiting_payment' WHERE id = p_order_id;
  IF v_order.table_id IS NOT NULL THEN
    UPDATE restaurant_tables SET status = 'awaiting_payment'
    WHERE id = v_order.table_id AND restaurant_id = v_order.restaurant_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_phone_order(
  p_order_type order_type, p_customer_name text, p_customer_phone text, p_items jsonb,
  p_notes text DEFAULT NULL, p_scheduled_ready_at timestamptz DEFAULT NULL,
  p_scheduled_delivery_at timestamptz DEFAULT NULL, p_delivery_address text DEFAULT NULL,
  p_delivery_landmark text DEFAULT NULL, p_delivery_fee numeric DEFAULT 0,
  p_discount_amount numeric DEFAULT 0, p_payment_method payment_method DEFAULT NULL,
  p_prepayment_amount numeric DEFAULT 0, p_idempotency_key text DEFAULT NULL
)
RETURNS uuid
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
  v_restaurant_id := public.resolve_create_restaurant_id(NULL);
  PERFORM public.assert_restaurant_role(v_restaurant_id, ARRAY['admin', 'cashier']::text[]);
  IF p_order_type NOT IN ('pickup', 'delivery') THEN RAISE EXCEPTION 'Invalid order type for phone order'; END IF;
  IF p_order_type = 'delivery' AND (p_delivery_address IS NULL OR trim(p_delivery_address) = '') THEN
    RAISE EXCEPTION 'Delivery address required'; END IF;
  IF p_idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM orders WHERE idempotency_key = p_idempotency_key AND restaurant_id = v_restaurant_id
  ) THEN
    SELECT id INTO v_order_id FROM orders WHERE idempotency_key = p_idempotency_key AND restaurant_id = v_restaurant_id;
    RETURN v_order_id;
  END IF;

  INSERT INTO orders (order_number, order_type, created_by, status, fulfillment_status,
    customer_name, customer_phone, delivery_address, delivery_landmark, delivery_fee, discount_amount,
    notes, payment_method_preference, scheduled_ready_at, scheduled_delivery_at, idempotency_key, restaurant_id)
  VALUES (generate_order_number(p_order_type, v_restaurant_id), p_order_type, auth.uid(), 'open', 'new',
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
    IF v_menu_item.restaurant_id IS DISTINCT FROM v_restaurant_id THEN
      RAISE EXCEPTION 'Menu item is not in this restaurant';
    END IF;
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

CREATE OR REPLACE FUNCTION public.mark_order_awaiting_pickup(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_order orders;
BEGIN
  PERFORM public.assert_auth();
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  PERFORM public.assert_restaurant_role(v_order.restaurant_id, ARRAY['admin', 'cashier']::text[]);
  IF v_order.order_type <> 'pickup' OR v_order.fulfillment_status <> 'ready' THEN RAISE EXCEPTION 'Order not ready'; END IF;
  UPDATE orders SET fulfillment_status = 'awaiting_pickup' WHERE id = p_order_id;
  PERFORM log_order_event(p_order_id, 'awaiting_pickup', 'Olib ketishga tayyor', auth.uid(), '{}');
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_order_picked_up(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_order orders; v_paid NUMERIC(12,2);
BEGIN
  PERFORM public.assert_auth();
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  PERFORM public.assert_restaurant_role(v_order.restaurant_id, ARRAY['admin', 'cashier']::text[]);
  IF v_order.order_type <> 'pickup' THEN RAISE EXCEPTION 'Not a pickup order'; END IF;
  IF v_order.fulfillment_status NOT IN ('ready', 'awaiting_pickup') THEN RAISE EXCEPTION 'Order not ready for pickup'; END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM payments WHERE order_id = p_order_id AND status = 'completed';
  IF v_paid < v_order.total THEN RAISE EXCEPTION 'Payment incomplete: paid % of %', v_paid, v_order.total; END IF;
  UPDATE orders SET fulfillment_status = 'picked_up', picked_up_at = now() WHERE id = p_order_id;
  PERFORM close_order(p_order_id);
  PERFORM log_order_event(p_order_id, 'picked_up', 'Olib ketdi', auth.uid(), '{}');
END;
$$;

CREATE OR REPLACE FUNCTION public.dispatch_delivery_order(p_order_id uuid, p_courier_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_order orders;
BEGIN
  PERFORM public.assert_auth();
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  PERFORM public.assert_restaurant_role(v_order.restaurant_id, ARRAY['admin', 'cashier']::text[]);
  IF v_order.order_type <> 'delivery' THEN RAISE EXCEPTION 'Not a delivery order'; END IF;
  IF v_order.fulfillment_status <> 'ready' THEN RAISE EXCEPTION 'Order not ready for dispatch'; END IF;
  UPDATE orders SET fulfillment_status = 'in_transit', courier_id = p_courier_id, dispatched_at = now() WHERE id = p_order_id;
  PERFORM log_order_event(p_order_id, 'dispatched', 'Dostavkaga berildi', auth.uid(), jsonb_build_object('courier_id', p_courier_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_order_delivered(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_order orders; v_paid NUMERIC(12,2);
BEGIN
  PERFORM public.assert_auth();
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  PERFORM public.assert_restaurant_role(v_order.restaurant_id, ARRAY['admin', 'cashier']::text[]);
  IF v_order.order_type <> 'delivery' THEN RAISE EXCEPTION 'Not a delivery order'; END IF;
  IF v_order.fulfillment_status NOT IN ('in_transit', 'dispatched') THEN RAISE EXCEPTION 'Order not in transit'; END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM payments WHERE order_id = p_order_id AND status = 'completed';
  IF v_paid < v_order.total THEN RAISE EXCEPTION 'Payment incomplete: paid % of %', v_paid, v_order.total; END IF;
  UPDATE orders SET fulfillment_status = 'delivered', delivered_at = now() WHERE id = p_order_id;
  PERFORM close_order(p_order_id);
  PERFORM log_order_event(p_order_id, 'delivered', 'Yetkazildi', auth.uid(), '{}');
END;
$$;

CREATE OR REPLACE FUNCTION public.create_table_reservation(
  p_table_id uuid, p_customer_name text, p_phone text, p_reserved_for timestamptz,
  p_guest_count integer DEFAULT 2, p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_status table_status;
  v_restaurant_id UUID;
BEGIN
  PERFORM public.assert_auth();
  SELECT status, restaurant_id INTO v_status, v_restaurant_id
  FROM restaurant_tables WHERE id = p_table_id AND is_active = true FOR UPDATE;
  IF v_status IS NULL OR v_restaurant_id IS NULL THEN RAISE EXCEPTION 'Table not found'; END IF;
  PERFORM public.assert_restaurant_role(v_restaurant_id, ARRAY['admin']::text[]);
  IF v_status NOT IN ('empty', 'reserved') THEN
    RAISE EXCEPTION 'Table is not available for reservation';
  END IF;
  IF reservation_has_conflict(p_table_id, p_reserved_for) THEN
    RAISE EXCEPTION 'Conflicting reservation exists for this time';
  END IF;
  INSERT INTO table_reservations (table_id, customer_name, phone, reserved_for, guest_count, notes, created_by, restaurant_id)
  VALUES (p_table_id, trim(p_customer_name), NULLIF(trim(p_phone), ''), p_reserved_for,
    GREATEST(p_guest_count, 1), p_notes, auth.uid(), v_restaurant_id)
  RETURNING id INTO v_id;
  UPDATE restaurant_tables SET status = 'reserved'
  WHERE id = p_table_id AND status = 'empty' AND restaurant_id = v_restaurant_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_table_reservation(p_reservation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res table_reservations%ROWTYPE;
BEGIN
  PERFORM public.assert_auth();
  SELECT * INTO v_res FROM table_reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  PERFORM public.assert_restaurant_role(v_res.restaurant_id, ARRAY['admin']::text[]);
  IF v_res.status <> 'active' THEN RAISE EXCEPTION 'Reservation is not active'; END IF;
  UPDATE table_reservations SET status = 'cancelled', updated_at = now() WHERE id = p_reservation_id;
  IF NOT EXISTS (
    SELECT 1 FROM table_reservations
    WHERE table_id = v_res.table_id AND status = 'active' AND id <> p_reservation_id
      AND restaurant_id = v_res.restaurant_id
  ) THEN
    UPDATE restaurant_tables SET status = 'empty'
    WHERE id = v_res.table_id AND status = 'reserved' AND restaurant_id = v_res.restaurant_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_in_reservation(p_reservation_id uuid, p_waiter_id uuid DEFAULT auth.uid())
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res table_reservations%ROWTYPE;
  v_order_id UUID;
  v_table_rid UUID;
BEGIN
  PERFORM public.assert_auth();
  SELECT * INTO v_res FROM table_reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  PERFORM public.assert_restaurant_role(v_res.restaurant_id, ARRAY['admin', 'waiter']::text[]);
  SELECT restaurant_id INTO v_table_rid FROM restaurant_tables WHERE id = v_res.table_id;
  IF v_table_rid IS DISTINCT FROM v_res.restaurant_id THEN
    RAISE EXCEPTION 'Reservation/table restaurant mismatch';
  END IF;
  IF v_res.status <> 'active' THEN RAISE EXCEPTION 'Reservation is not active'; END IF;
  UPDATE table_reservations SET status = 'checked_in', updated_at = now() WHERE id = p_reservation_id;
  UPDATE restaurant_tables SET status = 'empty'
  WHERE id = v_res.table_id AND status = 'reserved' AND restaurant_id = v_res.restaurant_id;
  v_order_id := open_table_order(v_res.table_id, p_waiter_id);
  UPDATE orders SET guest_count = v_res.guest_count WHERE id = v_order_id AND restaurant_id = v_res.restaurant_id;
  RETURN v_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_table(
  p_number integer, p_capacity integer DEFAULT 4, p_zone text DEFAULT 'Asosiy zal',
  p_name text DEFAULT NULL, p_is_active boolean DEFAULT true, p_table_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_restaurant_id UUID;
BEGIN
  PERFORM public.assert_auth();
  IF p_table_id IS NOT NULL THEN
    SELECT restaurant_id INTO v_restaurant_id FROM restaurant_tables WHERE id = p_table_id FOR UPDATE;
    IF v_restaurant_id IS NULL THEN RAISE EXCEPTION 'Table not found'; END IF;
    PERFORM public.assert_restaurant_role(v_restaurant_id, ARRAY['admin']::text[]);
    UPDATE restaurant_tables SET
      number = p_number, capacity = GREATEST(p_capacity, 1),
      zone = COALESCE(NULLIF(trim(p_zone), ''), 'Asosiy zal'),
      name = NULLIF(trim(p_name), ''), is_active = p_is_active, updated_at = now()
    WHERE id = p_table_id AND restaurant_id = v_restaurant_id
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
  v_restaurant_id := public.resolve_create_restaurant_id(NULL);
  PERFORM public.assert_restaurant_role(v_restaurant_id, ARRAY['admin']::text[]);
  INSERT INTO restaurant_tables (number, capacity, zone, name, is_active, status, restaurant_id)
  VALUES (p_number, GREATEST(p_capacity, 1), COALESCE(NULLIF(trim(p_zone), ''), 'Asosiy zal'),
    NULLIF(trim(p_name), ''), p_is_active, 'empty', v_restaurant_id)
  ON CONFLICT (restaurant_id, number) DO UPDATE SET
    capacity = EXCLUDED.capacity, zone = EXCLUDED.zone, name = EXCLUDED.name,
    is_active = EXCLUDED.is_active, updated_at = now()
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
  v_restaurant_id := public.resolve_create_restaurant_id(NULL);
  PERFORM public.assert_restaurant_role(v_restaurant_id, ARRAY['admin']::text[]);
  SELECT table_count INTO v_count FROM restaurant_settings WHERE restaurant_id = v_restaurant_id LIMIT 1;
  IF v_count IS NULL OR v_count < 1 THEN v_count := 1; END IF;
  SELECT COALESCE(MAX(number), 0) INTO v_max FROM restaurant_tables WHERE restaurant_id = v_restaurant_id;
  IF v_max < v_count THEN
    FOR i IN (v_max + 1)..v_count LOOP
      INSERT INTO restaurant_tables (number, status, capacity, restaurant_id)
      VALUES (i, 'empty', 4, v_restaurant_id)
      ON CONFLICT (restaurant_id, number) DO NOTHING;
    END LOOP;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_table_cleaning(p_table_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_restaurant_id UUID;
BEGIN
  PERFORM public.assert_auth();
  SELECT restaurant_id INTO v_restaurant_id FROM restaurant_tables WHERE id = p_table_id;
  IF v_restaurant_id IS NULL THEN RAISE EXCEPTION 'Table not found'; END IF;
  PERFORM public.assert_restaurant_role(v_restaurant_id, ARRAY['admin']::text[]);
  UPDATE restaurant_tables SET status = 'cleaning', current_order_id = NULL
  WHERE id = p_table_id AND status IN ('empty', 'awaiting_payment') AND restaurant_id = v_restaurant_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_table_available(p_table_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_restaurant_id UUID;
BEGIN
  PERFORM public.assert_auth();
  SELECT restaurant_id INTO v_restaurant_id FROM restaurant_tables WHERE id = p_table_id;
  IF v_restaurant_id IS NULL THEN RAISE EXCEPTION 'Table not found'; END IF;
  PERFORM public.assert_restaurant_role(v_restaurant_id, ARRAY['admin']::text[]);
  UPDATE restaurant_tables SET status = 'empty', current_order_id = NULL
  WHERE id = p_table_id AND status = 'cleaning' AND restaurant_id = v_restaurant_id;
END;
$$;

-- =============================================================================
-- 5. Tenant RLS (same transaction as RPC patches)
-- =============================================================================

ALTER TABLE public.restaurant_order_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.restaurant_order_counters FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS restaurants_select_member ON public.restaurants;
DROP POLICY IF EXISTS restaurant_members_select_own_or_admin ON public.restaurant_members;
DROP POLICY IF EXISTS settings_admin ON public.restaurant_settings;
DROP POLICY IF EXISTS settings_select ON public.restaurant_settings;
DROP POLICY IF EXISTS tables_admin ON public.restaurant_tables;
DROP POLICY IF EXISTS tables_select ON public.restaurant_tables;
DROP POLICY IF EXISTS menu_cat_admin ON public.menu_categories;
DROP POLICY IF EXISTS menu_cat_select ON public.menu_categories;
DROP POLICY IF EXISTS menu_items_admin ON public.menu_items;
DROP POLICY IF EXISTS menu_items_select ON public.menu_items;
DROP POLICY IF EXISTS orders_insert ON public.orders;
DROP POLICY IF EXISTS orders_select ON public.orders;
DROP POLICY IF EXISTS orders_update ON public.orders;
DROP POLICY IF EXISTS order_items_select ON public.order_items;
DROP POLICY IF EXISTS kitchen_select ON public.kitchen_tickets;
DROP POLICY IF EXISTS kitchen_update ON public.kitchen_tickets;
DROP POLICY IF EXISTS payments_insert ON public.payments;
DROP POLICY IF EXISTS payments_select ON public.payments;
DROP POLICY IF EXISTS cash_sessions_select ON public.cash_sessions;
DROP POLICY IF EXISTS notifications_select ON public.notifications;
DROP POLICY IF EXISTS notifications_update ON public.notifications;
DROP POLICY IF EXISTS audit_admin ON public.audit_logs;
DROP POLICY IF EXISTS reservations_admin ON public.table_reservations;
DROP POLICY IF EXISTS reservations_select ON public.table_reservations;
DROP POLICY IF EXISTS reservations_waiter_read ON public.table_reservations;
DROP POLICY IF EXISTS order_events_select ON public.order_events;

CREATE POLICY restaurants_select_member ON public.restaurants
  FOR SELECT TO authenticated
  USING (is_restaurant_member(id));

CREATE POLICY restaurant_members_select_own_or_admin ON public.restaurant_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_restaurant_admin(restaurant_id));

CREATE POLICY settings_select_member ON public.restaurant_settings
  FOR SELECT TO authenticated
  USING (is_restaurant_member(restaurant_id));

CREATE POLICY settings_admin ON public.restaurant_settings
  FOR ALL TO authenticated
  USING (is_restaurant_admin(restaurant_id))
  WITH CHECK (is_restaurant_admin(restaurant_id));

CREATE POLICY tables_select_member ON public.restaurant_tables
  FOR SELECT TO authenticated
  USING (
    is_restaurant_member(restaurant_id)
    AND has_restaurant_role(restaurant_id, ARRAY['admin', 'cashier', 'waiter', 'kitchen']::text[])
  );

CREATE POLICY tables_admin ON public.restaurant_tables
  FOR ALL TO authenticated
  USING (is_restaurant_admin(restaurant_id))
  WITH CHECK (is_restaurant_admin(restaurant_id));

CREATE POLICY menu_cat_select_member ON public.menu_categories
  FOR SELECT TO authenticated
  USING (is_restaurant_member(restaurant_id));

CREATE POLICY menu_cat_admin ON public.menu_categories
  FOR ALL TO authenticated
  USING (is_restaurant_admin(restaurant_id))
  WITH CHECK (is_restaurant_admin(restaurant_id));

CREATE POLICY menu_items_select_member ON public.menu_items
  FOR SELECT TO authenticated
  USING (is_restaurant_member(restaurant_id));

CREATE POLICY menu_items_admin ON public.menu_items
  FOR ALL TO authenticated
  USING (is_restaurant_admin(restaurant_id))
  WITH CHECK (is_restaurant_admin(restaurant_id));

CREATE POLICY orders_select_member ON public.orders
  FOR SELECT TO authenticated
  USING (
    is_restaurant_member(restaurant_id)
    AND (
      has_restaurant_role(restaurant_id, ARRAY['admin', 'cashier', 'kitchen']::text[])
      OR (
        has_restaurant_role(restaurant_id, ARRAY['waiter']::text[])
        AND (
          waiter_id = auth.uid()
          OR created_by = auth.uid()
          OR (order_type = 'dine_in' AND table_id IS NOT NULL)
        )
      )
    )
  );

CREATE POLICY orders_insert_member ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (
    is_restaurant_member(restaurant_id)
    AND (
      has_restaurant_role(restaurant_id, ARRAY['admin', 'waiter']::text[])
      OR (
        has_restaurant_role(restaurant_id, ARRAY['cashier']::text[])
        AND order_type IN ('pickup', 'delivery')
      )
    )
  );

CREATE POLICY orders_update_member ON public.orders
  FOR UPDATE TO authenticated
  USING (
    is_restaurant_member(restaurant_id)
    AND has_restaurant_role(restaurant_id, ARRAY['admin', 'cashier', 'waiter']::text[])
  )
  WITH CHECK (
    is_restaurant_member(restaurant_id)
    AND has_restaurant_role(restaurant_id, ARRAY['admin', 'cashier', 'waiter']::text[])
  );

CREATE POLICY order_items_select_member ON public.order_items
  FOR SELECT TO authenticated
  USING (
    is_restaurant_member(restaurant_id)
    AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND o.restaurant_id = order_items.restaurant_id
        AND (
          has_restaurant_role(o.restaurant_id, ARRAY['admin', 'cashier', 'kitchen']::text[])
          OR (
            has_restaurant_role(o.restaurant_id, ARRAY['waiter']::text[])
            AND (o.waiter_id = auth.uid() OR o.created_by = auth.uid() OR o.order_type = 'dine_in')
          )
        )
    )
  );

CREATE POLICY kitchen_select_member ON public.kitchen_tickets
  FOR SELECT TO authenticated
  USING (
    is_restaurant_member(restaurant_id)
    AND (
      has_restaurant_role(restaurant_id, ARRAY['admin', 'kitchen', 'cashier']::text[])
      OR (has_restaurant_role(restaurant_id, ARRAY['waiter']::text[]) AND waiter_id = auth.uid())
    )
  );

CREATE POLICY kitchen_update_member ON public.kitchen_tickets
  FOR UPDATE TO authenticated
  USING (has_restaurant_role(restaurant_id, ARRAY['admin', 'kitchen']::text[]))
  WITH CHECK (has_restaurant_role(restaurant_id, ARRAY['admin', 'kitchen']::text[]));

CREATE POLICY payments_select_member ON public.payments
  FOR SELECT TO authenticated
  USING (has_restaurant_role(restaurant_id, ARRAY['admin', 'cashier']::text[]));

CREATE POLICY payments_insert_member ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (has_restaurant_role(restaurant_id, ARRAY['admin', 'cashier']::text[]));

CREATE POLICY cash_sessions_select_member ON public.cash_sessions
  FOR SELECT TO authenticated
  USING (has_restaurant_role(restaurant_id, ARRAY['admin', 'cashier']::text[]));

CREATE POLICY notifications_select_own_tenant ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND is_restaurant_member(restaurant_id));

CREATE POLICY notifications_update_own_tenant ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND is_restaurant_member(restaurant_id))
  WITH CHECK (user_id = auth.uid() AND is_restaurant_member(restaurant_id));

CREATE POLICY audit_admin_tenant ON public.audit_logs
  FOR SELECT TO authenticated
  USING (is_restaurant_admin(restaurant_id));

CREATE POLICY reservations_select_member ON public.table_reservations
  FOR SELECT TO authenticated
  USING (
    is_restaurant_member(restaurant_id)
    AND has_restaurant_role(restaurant_id, ARRAY['admin', 'waiter', 'cashier', 'kitchen']::text[])
  );

CREATE POLICY reservations_admin ON public.table_reservations
  FOR ALL TO authenticated
  USING (is_restaurant_admin(restaurant_id))
  WITH CHECK (is_restaurant_admin(restaurant_id));

CREATE POLICY order_events_select_member ON public.order_events
  FOR SELECT TO authenticated
  USING (
    is_restaurant_member(restaurant_id)
    AND (
      has_restaurant_role(restaurant_id, ARRAY['admin', 'cashier', 'kitchen']::text[])
      OR EXISTS (
        SELECT 1 FROM orders o
        WHERE o.id = order_events.order_id
          AND o.restaurant_id = order_events.restaurant_id
          AND has_restaurant_role(o.restaurant_id, ARRAY['waiter']::text[])
          AND o.waiter_id = auth.uid()
      )
    )
  );

-- =============================================================================
-- 6. EXECUTE privileges
-- =============================================================================

REVOKE ALL ON FUNCTION public.current_restaurant_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_restaurant_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_restaurant_role(uuid, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_restaurant_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assert_auth() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_restaurant_role(uuid, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_create_restaurant_id(uuid) FROM PUBLIC, anon, authenticated;

-- Legacy global helpers remain callable by authenticated until profiles/storage RLS
-- (Phase 7) stop using them. New tenant policies/RPCs do not use them as auth source.
REVOKE ALL ON FUNCTION public.get_user_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_cashier_or_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.log_order_event(uuid, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_staff_order_ready(orders, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recalculate_order_totals(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reservation_has_conflict(uuid, timestamp with time zone, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_order_number() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_order_number(order_type) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_order_number(order_type, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_profile_pin(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_pin(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_pin(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sign_in_with_pin(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.current_restaurant_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_restaurant_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_restaurant_role(uuid, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_restaurant_admin(uuid) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.assert_auth() TO service_role;
GRANT EXECUTE ON FUNCTION public.assert_restaurant_role(uuid, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_create_restaurant_id(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_cashier_or_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.log_order_event(uuid, text, text, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_staff_order_ready(orders, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.recalculate_order_totals(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reservation_has_conflict(uuid, timestamp with time zone, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_order_number() TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_order_number(order_type) TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_order_number(order_type, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_profile_pin(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_pin(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_pin(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.sign_in_with_pin(text) TO service_role;

REVOKE ALL ON FUNCTION public.open_table_order(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.upsert_draft_order_item(uuid, uuid, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.send_to_kitchen(uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_kitchen_ticket_status(uuid, kitchen_ticket_status) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.add_payment(uuid, numeric, payment_method, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_order(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_bill(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_phone_order(order_type, text, text, jsonb, text, timestamp with time zone, timestamp with time zone, text, text, numeric, numeric, payment_method, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_order_awaiting_pickup(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_order_picked_up(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dispatch_delivery_order(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_order_delivered(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_table_reservation(uuid, text, text, timestamp with time zone, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_table_reservation(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.check_in_reservation(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_upsert_table(integer, integer, text, text, boolean, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sync_restaurant_tables() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_table_cleaning(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_table_available(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_profile_pin(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_current_restaurant_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.needs_setup() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.open_table_order(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_draft_order_item(uuid, uuid, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.send_to_kitchen(uuid, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_kitchen_ticket_status(uuid, kitchen_ticket_status) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_payment(uuid, numeric, payment_method, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_order(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_bill(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_phone_order(order_type, text, text, jsonb, text, timestamp with time zone, timestamp with time zone, text, text, numeric, numeric, payment_method, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_order_awaiting_pickup(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_order_picked_up(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dispatch_delivery_order(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_order_delivered(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_table_reservation(uuid, text, text, timestamp with time zone, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_table_reservation(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_in_reservation(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_table(integer, integer, text, text, boolean, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_restaurant_tables() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_table_cleaning(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_table_available(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_profile_pin(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_current_restaurant_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.needs_setup() TO anon, authenticated, service_role;

-- Rollback (do not auto-apply):
-- supabase/rollbacks/20260820180000_multi_tenant_phase4_5_security_atomic.rollback.sql
