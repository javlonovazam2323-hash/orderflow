-- Phase 8 finalization (PREPARED — do not apply until TASDIQ).
-- Does NOT delete customer data. Does NOT roll back Phase 1–7.
-- Closes remaining multi-membership and onboarding gaps:
--   1) create_phone_order / admin_upsert_table / sync_restaurant_tables accept p_restaurant_id
--   2) create_restaurant onboarding RPC (settings + counters + owner admin membership)
--   3) restaurant_settings unique(restaurant_id)
--   4) update_updated_at search_path
-- PIN: Edge Function requires slug when >1 restaurant (code patch, not SQL).

-- =============================================================================
-- 1. Settings uniqueness
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS restaurant_settings_restaurant_id_key
  ON public.restaurant_settings (restaurant_id);

-- =============================================================================
-- 2. Trigger search_path
-- =============================================================================

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =============================================================================
-- 3. Onboarding — create_restaurant
-- Caller must be authenticated. Allowed if they have no active membership
-- (new owner) OR they already administer at least one restaurant (chain).
-- Seeds settings + order counters. Does NOT copy another tenant's menu/staff/orders.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_restaurant(
  p_name text,
  p_slug text,
  p_phone text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_logo_url text DEFAULT NULL,
  p_service_charge_percent numeric DEFAULT 0,
  p_table_count integer DEFAULT 1
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_slug text;
  v_tables integer;
  i integer;
BEGIN
  PERFORM public.assert_auth();

  IF NOT EXISTS (
    SELECT 1 FROM public.restaurant_members
    WHERE user_id = auth.uid() AND is_active = true
  ) THEN
    NULL;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.restaurant_members
    WHERE user_id = auth.uid() AND is_active = true AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Restaurant name required';
  END IF;

  v_slug := lower(trim(p_slug));
  IF v_slug IS NULL OR v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'Invalid slug';
  END IF;

  v_tables := GREATEST(COALESCE(p_table_count, 1), 1);

  INSERT INTO public.restaurants (name, slug, phone, address, logo_url, is_active)
  VALUES (trim(p_name), v_slug, NULLIF(trim(p_phone), ''), NULLIF(trim(p_address), ''), NULLIF(trim(p_logo_url), ''), true)
  RETURNING id INTO v_id;

  INSERT INTO public.restaurant_members (restaurant_id, user_id, role, is_active)
  VALUES (v_id, auth.uid(), 'admin', true);

  INSERT INTO public.restaurant_settings (
    restaurant_id, name, logo_url, phone, address, table_count,
    currency, service_charge_percent, tax_percent
  ) VALUES (
    v_id, trim(p_name), NULLIF(trim(p_logo_url), ''), NULLIF(trim(p_phone), ''),
    NULLIF(trim(p_address), ''), v_tables, 'UZS', COALESCE(p_service_charge_percent, 0), 0
  );

  INSERT INTO public.restaurant_order_counters (restaurant_id)
  VALUES (v_id)
  ON CONFLICT (restaurant_id) DO NOTHING;

  FOR i IN 1..v_tables LOOP
    INSERT INTO public.restaurant_tables (number, status, capacity, restaurant_id)
    VALUES (i, 'empty', 4, v_id)
    ON CONFLICT (restaurant_id, number) DO NOTHING;
  END LOOP;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_restaurant(text, text, text, text, text, numeric, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_restaurant(text, text, text, text, text, numeric, integer)
  TO authenticated, service_role;

-- =============================================================================
-- 4. create_phone_order — explicit restaurant context
-- =============================================================================

DROP FUNCTION IF EXISTS public.create_phone_order(
  order_type, text, text, jsonb, text, timestamptz, timestamptz, text, text,
  numeric, numeric, payment_method, numeric, text
);

CREATE FUNCTION public.create_phone_order(
  p_order_type order_type, p_customer_name text, p_customer_phone text, p_items jsonb,
  p_notes text DEFAULT NULL, p_scheduled_ready_at timestamptz DEFAULT NULL,
  p_scheduled_delivery_at timestamptz DEFAULT NULL, p_delivery_address text DEFAULT NULL,
  p_delivery_landmark text DEFAULT NULL, p_delivery_fee numeric DEFAULT 0,
  p_discount_amount numeric DEFAULT 0, p_payment_method payment_method DEFAULT NULL,
  p_prepayment_amount numeric DEFAULT 0, p_idempotency_key text DEFAULT NULL,
  p_restaurant_id uuid DEFAULT NULL
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
  v_restaurant_id := public.resolve_create_restaurant_id(p_restaurant_id);
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

REVOKE ALL ON FUNCTION public.create_phone_order(
  order_type, text, text, jsonb, text, timestamptz, timestamptz, text, text,
  numeric, numeric, payment_method, numeric, text, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_phone_order(
  order_type, text, text, jsonb, text, timestamptz, timestamptz, text, text,
  numeric, numeric, payment_method, numeric, text, uuid
) TO authenticated, service_role;

-- =============================================================================
-- 5. admin_upsert_table / sync_restaurant_tables — explicit restaurant context
-- =============================================================================

DROP FUNCTION IF EXISTS public.admin_upsert_table(integer, integer, text, text, boolean, uuid);

CREATE FUNCTION public.admin_upsert_table(
  p_number integer, p_capacity integer DEFAULT 4, p_zone text DEFAULT 'Asosiy zal',
  p_name text DEFAULT NULL, p_is_active boolean DEFAULT true, p_table_id uuid DEFAULT NULL,
  p_restaurant_id uuid DEFAULT NULL
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
    IF p_restaurant_id IS NOT NULL AND p_restaurant_id IS DISTINCT FROM v_restaurant_id THEN
      RAISE EXCEPTION 'Table is not in this restaurant';
    END IF;
    PERFORM public.assert_restaurant_role(v_restaurant_id, ARRAY['admin']::text[]);
    UPDATE restaurant_tables SET
      number = p_number, capacity = GREATEST(p_capacity, 1),
      zone = COALESCE(NULLIF(trim(p_zone), ''), 'Asosiy zal'),
      name = NULLIF(trim(p_name), ''), is_active = p_is_active, updated_at = now()
    WHERE id = p_table_id AND restaurant_id = v_restaurant_id
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
  v_restaurant_id := public.resolve_create_restaurant_id(p_restaurant_id);
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

REVOKE ALL ON FUNCTION public.admin_upsert_table(integer, integer, text, text, boolean, uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_table(integer, integer, text, text, boolean, uuid, uuid)
  TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.sync_restaurant_tables();

CREATE FUNCTION public.sync_restaurant_tables(p_restaurant_id uuid DEFAULT NULL)
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
  v_restaurant_id := public.resolve_create_restaurant_id(p_restaurant_id);
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

REVOKE ALL ON FUNCTION public.sync_restaurant_tables(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_restaurant_tables(uuid) TO authenticated, service_role;
