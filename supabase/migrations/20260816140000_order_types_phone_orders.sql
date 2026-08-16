-- OrderFlow: Order types (dine_in / pickup / delivery), phone orders, menu images storage
-- Idempotent-safe extensions; no DROP/TRUNCATE of existing data

-- ============================================================
-- ENUMS
-- ============================================================

DO $$ BEGIN
  CREATE TYPE order_type AS ENUM ('dine_in', 'pickup', 'delivery');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE fulfillment_status AS ENUM (
    'new',
    'in_kitchen',
    'ready',
    'awaiting_pickup',
    'picked_up',
    'dispatched',
    'in_transit',
    'delivered',
    'completed',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'pickup_ready';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'delivery_ready';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- ORDER NUMBER SEQUENCES
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS pickup_order_seq START 1;
CREATE SEQUENCE IF NOT EXISTS delivery_order_seq START 1;

CREATE OR REPLACE FUNCTION generate_order_number(p_type order_type DEFAULT 'dine_in')
RETURNS TEXT AS $$
BEGIN
  CASE p_type
    WHEN 'pickup' THEN RETURN 'P-' || lpad(nextval('pickup_order_seq')::text, 6, '0');
    WHEN 'delivery' THEN RETURN 'D-' || lpad(nextval('delivery_order_seq')::text, 6, '0');
    ELSE RETURN lpad(nextval('order_number_seq')::text, 6, '0');
  END CASE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- ORDERS — extend central model
-- ============================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS order_type order_type NOT NULL DEFAULT 'dine_in',
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES profiles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS customer_name TEXT,
  ADD COLUMN IF NOT EXISTS customer_phone TEXT,
  ADD COLUMN IF NOT EXISTS delivery_address TEXT,
  ADD COLUMN IF NOT EXISTS delivery_landmark TEXT,
  ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS payment_method_preference payment_method,
  ADD COLUMN IF NOT EXISTS scheduled_ready_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scheduled_delivery_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fulfillment_status fulfillment_status,
  ADD COLUMN IF NOT EXISTS courier_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS kitchen_ready_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE;

-- Backfill created_by from waiter_id for existing dine-in orders
UPDATE orders SET created_by = waiter_id WHERE created_by IS NULL AND waiter_id IS NOT NULL;

-- Allow phone orders without table/waiter
ALTER TABLE orders ALTER COLUMN table_id DROP NOT NULL;
ALTER TABLE orders ALTER COLUMN waiter_id DROP NOT NULL;

-- Partial unique index: only one active dine-in order per table
DROP INDEX IF EXISTS idx_orders_one_active_per_table;
CREATE UNIQUE INDEX idx_orders_one_active_per_table
  ON orders(table_id)
  WHERE status IN ('draft', 'open', 'awaiting_payment') AND table_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_order_type ON orders(order_type);
CREATE INDEX IF NOT EXISTS idx_orders_fulfillment ON orders(fulfillment_status);
CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_created_by ON orders(created_by);

-- ============================================================
-- KITCHEN TICKETS — nullable table for phone orders
-- ============================================================

ALTER TABLE kitchen_tickets ALTER COLUMN table_id DROP NOT NULL;
ALTER TABLE kitchen_tickets ALTER COLUMN waiter_id DROP NOT NULL;

ALTER TABLE kitchen_tickets
  ADD COLUMN IF NOT EXISTS order_type order_type;

UPDATE kitchen_tickets kt
SET order_type = o.order_type
FROM orders o
WHERE kt.order_id = o.id AND kt.order_type IS NULL;

-- ============================================================
-- ORDER EVENTS (timeline)
-- ============================================================

CREATE TABLE IF NOT EXISTS order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id, created_at);

-- ============================================================
-- HELPERS
-- ============================================================

CREATE OR REPLACE FUNCTION log_order_event(
  p_order_id UUID,
  p_event_type TEXT,
  p_message TEXT,
  p_actor_id UUID DEFAULT auth.uid(),
  p_metadata JSONB DEFAULT '{}'
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO order_events (order_id, event_type, message, actor_id, metadata)
  VALUES (p_order_id, p_event_type, p_message, p_actor_id, p_metadata);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION notify_staff_order_ready(
  p_order orders%ROWTYPE,
  p_ticket_id UUID
)
RETURNS VOID AS $$
DECLARE
  v_title TEXT;
  v_body TEXT;
  v_type notification_type;
BEGIN
  IF p_order.order_type = 'pickup' THEN
    v_type := 'pickup_ready';
    v_title := 'ZAKAZ TAYYOR';
    v_body := format('%s · %s · Olib ketish', p_order.order_number, COALESCE(p_order.customer_name, 'Mijoz'));
  ELSIF p_order.order_type = 'delivery' THEN
    v_type := 'delivery_ready';
    v_title := 'ZAKAZ TAYYOR';
    v_body := format('%s · %s · Dostavka', p_order.order_number, COALESCE(p_order.customer_name, 'Mijoz'));
  ELSE
    v_type := 'order_ready';
    v_title := 'Buyurtma tayyor!';
    v_body := format('Stol %s buyurtmasi tayyor!',
      (SELECT number FROM restaurant_tables WHERE id = p_order.table_id));
  END IF;

  IF p_order.order_type IN ('pickup', 'delivery') THEN
    INSERT INTO notifications (user_id, type, title, body, data)
    SELECT p.id, v_type, v_title, v_body,
      jsonb_build_object(
        'order_id', p_order.id,
        'order_number', p_order.order_number,
        'order_type', p_order.order_type,
        'ticket_id', p_ticket_id,
        'customer_name', p_order.customer_name
      )
    FROM profiles p
    WHERE p.role IN ('admin', 'cashier') AND p.is_active = true;

    IF p_order.created_by IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = p_order.created_by AND p.role IN ('admin', 'cashier') AND p.is_active
    ) THEN
      INSERT INTO notifications (user_id, type, title, body, data)
      VALUES (
        p_order.created_by, v_type, v_title, v_body,
        jsonb_build_object(
          'order_id', p_order.id,
          'order_number', p_order.order_number,
          'order_type', p_order.order_type,
          'ticket_id', p_ticket_id
        )
      );
    END IF;
  ELSIF p_order.waiter_id IS NOT NULL THEN
    INSERT INTO notifications (user_id, type, title, body, data)
    VALUES (
      p_order.waiter_id, v_type, v_title, v_body,
      jsonb_build_object(
        'ticket_id', p_ticket_id,
        'table_id', p_order.table_id,
        'order_id', p_order.id
      )
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Recalculate totals including delivery fee and discount
CREATE OR REPLACE FUNCTION recalculate_order_totals(p_order_id UUID)
RETURNS VOID AS $$
DECLARE
  v_subtotal NUMERIC(12,2);
  v_service_pct NUMERIC(5,2);
  v_tax_pct NUMERIC(5,2);
  v_service NUMERIC(12,2);
  v_tax NUMERIC(12,2);
  v_delivery_fee NUMERIC(12,2);
  v_discount NUMERIC(12,2);
  v_order_type order_type;
BEGIN
  SELECT COALESCE(SUM(total_price), 0) INTO v_subtotal
  FROM order_items
  WHERE order_id = p_order_id AND status NOT IN ('cancelled');

  SELECT service_charge_percent, tax_percent
  INTO v_service_pct, v_tax_pct
  FROM restaurant_settings LIMIT 1;

  SELECT COALESCE(delivery_fee, 0), COALESCE(discount_amount, 0), order_type
  INTO v_delivery_fee, v_discount, v_order_type
  FROM orders WHERE id = p_order_id;

  -- No service charge on pickup/delivery phone orders
  IF v_order_type IN ('pickup', 'delivery') THEN
    v_service := 0;
  ELSE
    v_service := ROUND(v_subtotal * COALESCE(v_service_pct, 0) / 100, 0);
  END IF;

  v_tax := ROUND((v_subtotal + v_service + v_delivery_fee - v_discount) * COALESCE(v_tax_pct, 0) / 100, 0);

  UPDATE orders SET
    subtotal = v_subtotal,
    service_charge = v_service,
    tax_amount = v_tax,
    total = GREATEST(v_subtotal + v_service + v_tax + v_delivery_fee - v_discount, 0),
    updated_at = now()
  WHERE id = p_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- PATCH: open_table_order — explicit dine_in
-- ============================================================

CREATE OR REPLACE FUNCTION open_table_order(
  p_table_id UUID,
  p_waiter_id UUID DEFAULT auth.uid()
)
RETURNS UUID AS $$
DECLARE
  v_order_id UUID;
  v_table_status table_status;
BEGIN
  IF get_user_role() NOT IN ('admin', 'waiter') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT status INTO v_table_status FROM restaurant_tables WHERE id = p_table_id FOR UPDATE;

  IF v_table_status = 'empty' OR v_table_status IS NULL THEN
    INSERT INTO orders (order_number, order_type, table_id, waiter_id, created_by, status)
    VALUES (generate_order_number('dine_in'), 'dine_in', p_table_id, p_waiter_id, p_waiter_id, 'open')
    RETURNING id INTO v_order_id;

    UPDATE restaurant_tables SET
      status = 'occupied',
      current_order_id = v_order_id
    WHERE id = p_table_id;

    PERFORM log_order_event(v_order_id, 'created', 'Zakaz yaratildi', p_waiter_id,
      jsonb_build_object('table_id', p_table_id));

    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_data)
    VALUES (p_waiter_id, 'order_created', 'order', v_order_id,
      jsonb_build_object('table_id', p_table_id));

    RETURN v_order_id;
  END IF;

  SELECT id INTO v_order_id FROM orders
  WHERE table_id = p_table_id AND status IN ('open', 'awaiting_payment')
  LIMIT 1;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Table is not available';
  END IF;

  RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- PATCH: send_to_kitchen
-- ============================================================

CREATE OR REPLACE FUNCTION send_to_kitchen(
  p_order_id UUID,
  p_items JSONB,
  p_idempotency_key TEXT
)
RETURNS UUID AS $$
DECLARE
  v_ticket_id UUID;
  v_item JSONB;
  v_menu_item menu_items%ROWTYPE;
  v_order orders%ROWTYPE;
BEGIN
  IF EXISTS (SELECT 1 FROM order_items WHERE idempotency_key = p_idempotency_key) THEN
    SELECT kitchen_ticket_id INTO v_ticket_id
    FROM order_items WHERE idempotency_key = p_idempotency_key LIMIT 1;
    RETURN v_ticket_id;
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.status NOT IN ('open', 'draft') THEN
    RAISE EXCEPTION 'Order cannot accept new kitchen sends';
  END IF;

  INSERT INTO kitchen_tickets (order_id, table_id, waiter_id, order_type, status)
  VALUES (
    p_order_id,
    v_order.table_id,
    COALESCE(v_order.waiter_id, v_order.created_by),
    v_order.order_type,
    'new'
  )
  RETURNING id INTO v_ticket_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT * INTO v_menu_item FROM menu_items WHERE id = (v_item->>'menu_item_id')::UUID;

    INSERT INTO order_items (
      order_id, menu_item_id, kitchen_ticket_id,
      quantity, unit_price, total_price, notes,
      status, idempotency_key, sent_to_kitchen_at
    ) VALUES (
      p_order_id,
      v_menu_item.id,
      v_ticket_id,
      (v_item->>'quantity')::INT,
      v_menu_item.price,
      v_menu_item.price * (v_item->>'quantity')::INT,
      v_item->>'notes',
      'sent',
      p_idempotency_key || '-' || v_menu_item.id,
      now()
    );
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

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_data)
  VALUES (auth.uid(), 'order_sent_to_kitchen', 'kitchen_ticket', v_ticket_id,
    jsonb_build_object('order_id', p_order_id, 'idempotency_key', p_idempotency_key));

  RETURN v_ticket_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- PATCH: update_kitchen_ticket_status
-- ============================================================

CREATE OR REPLACE FUNCTION update_kitchen_ticket_status(
  p_ticket_id UUID,
  p_status kitchen_ticket_status
)
RETURNS VOID AS $$
DECLARE
  v_ticket kitchen_tickets%ROWTYPE;
  v_order orders%ROWTYPE;
BEGIN
  IF get_user_role() NOT IN ('admin', 'kitchen') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT * INTO v_ticket FROM kitchen_tickets WHERE id = p_ticket_id FOR UPDATE;
  SELECT * INTO v_order FROM orders WHERE id = v_ticket.order_id FOR UPDATE;

  UPDATE kitchen_tickets SET
    status = p_status,
    accepted_at = CASE WHEN p_status = 'accepted' THEN now() ELSE accepted_at END,
    started_at = CASE WHEN p_status = 'in_progress' THEN now() ELSE started_at END,
    ready_at = CASE WHEN p_status = 'ready' THEN now() ELSE ready_at END
  WHERE id = p_ticket_id;

  UPDATE order_items SET status = CASE p_status
    WHEN 'accepted' THEN 'accepted'::order_item_status
    WHEN 'in_progress' THEN 'in_progress'::order_item_status
    WHEN 'ready' THEN 'ready'::order_item_status
    ELSE status
  END
  WHERE kitchen_ticket_id = p_ticket_id;

  IF p_status = 'accepted' THEN
    PERFORM log_order_event(v_order.id, 'kitchen_accepted', 'Oshxona qabul qildi', auth.uid(), '{}');
    IF v_order.order_type IN ('pickup', 'delivery') THEN
      UPDATE orders SET fulfillment_status = 'in_kitchen' WHERE id = v_order.id;
    END IF;
  END IF;

  IF p_status = 'in_progress' AND v_order.table_id IS NOT NULL THEN
    UPDATE restaurant_tables SET status = 'preparing' WHERE id = v_order.table_id;
    PERFORM log_order_event(v_order.id, 'preparing', 'Tayyorlanmoqda', auth.uid(), '{}');
  END IF;

  IF p_status = 'ready' THEN
    PERFORM notify_staff_order_ready(v_order, p_ticket_id);
    PERFORM log_order_event(v_order.id, 'kitchen_ready', 'Tayyor bo''ldi', auth.uid(), '{}');

    IF NOT EXISTS (
      SELECT 1 FROM kitchen_tickets
      WHERE order_id = v_ticket.order_id
        AND status NOT IN ('ready', 'cancelled')
    ) THEN
      IF v_order.table_id IS NOT NULL THEN
        UPDATE restaurant_tables SET status = 'ready' WHERE id = v_order.table_id;
      END IF;

      IF v_order.order_type IN ('pickup', 'delivery') THEN
        UPDATE orders SET fulfillment_status = 'ready', kitchen_ready_at = now() WHERE id = v_order.id;
      END IF;
    END IF;
  END IF;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_data)
  VALUES (auth.uid(), 'status_changed', 'kitchen_ticket', p_ticket_id,
    jsonb_build_object('status', p_status));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- RPC: Create phone order (admin/cashier only)
-- ============================================================

CREATE OR REPLACE FUNCTION create_phone_order(
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
RETURNS UUID AS $$
DECLARE
  v_order_id UUID;
  v_ticket_id UUID;
  v_item JSONB;
  v_menu_item menu_items%ROWTYPE;
  v_key TEXT;
BEGIN
  IF NOT is_cashier_or_admin() THEN
    RAISE EXCEPTION 'Only admin or cashier can create phone orders';
  END IF;

  IF p_order_type NOT IN ('pickup', 'delivery') THEN
    RAISE EXCEPTION 'Invalid order type for phone order';
  END IF;

  IF p_order_type = 'delivery' AND (p_delivery_address IS NULL OR trim(p_delivery_address) = '') THEN
    RAISE EXCEPTION 'Delivery address required';
  END IF;

  IF p_idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM orders WHERE idempotency_key = p_idempotency_key
  ) THEN
    SELECT id INTO v_order_id FROM orders WHERE idempotency_key = p_idempotency_key;
    RETURN v_order_id;
  END IF;

  INSERT INTO orders (
    order_number, order_type, created_by, status, fulfillment_status,
    customer_name, customer_phone, delivery_address, delivery_landmark,
    delivery_fee, discount_amount, notes, payment_method_preference,
    scheduled_ready_at, scheduled_delivery_at, idempotency_key
  ) VALUES (
    generate_order_number(p_order_type),
    p_order_type,
    auth.uid(),
    'open',
    'new',
    p_customer_name,
    p_customer_phone,
    p_delivery_address,
    p_delivery_landmark,
    COALESCE(p_delivery_fee, 0),
    COALESCE(p_discount_amount, 0),
    p_notes,
    p_payment_method,
    p_scheduled_ready_at,
    p_scheduled_delivery_at,
    p_idempotency_key
  )
  RETURNING id INTO v_order_id;

  PERFORM log_order_event(v_order_id, 'created', 'Zakaz yaratildi', auth.uid(),
    jsonb_build_object('order_type', p_order_type, 'customer', p_customer_name));

  v_key := COALESCE(p_idempotency_key, gen_random_uuid()::text);

  INSERT INTO kitchen_tickets (order_id, waiter_id, order_type, status)
  VALUES (v_order_id, auth.uid(), p_order_type, 'new')
  RETURNING id INTO v_ticket_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT * INTO v_menu_item FROM menu_items WHERE id = (v_item->>'menu_item_id')::UUID;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Menu item not found';
    END IF;

    INSERT INTO order_items (
      order_id, menu_item_id, kitchen_ticket_id,
      quantity, unit_price, total_price, notes,
      status, idempotency_key, sent_to_kitchen_at
    ) VALUES (
      v_order_id,
      v_menu_item.id,
      v_ticket_id,
      GREATEST((v_item->>'quantity')::INT, 1),
      v_menu_item.price,
      v_menu_item.price * GREATEST((v_item->>'quantity')::INT, 1),
      v_item->>'notes',
      'sent',
      v_key || '-' || v_menu_item.id,
      now()
    );
  END LOOP;

  PERFORM recalculate_order_totals(v_order_id);

  UPDATE orders SET fulfillment_status = 'in_kitchen' WHERE id = v_order_id;
  PERFORM log_order_event(v_order_id, 'sent_to_kitchen', 'Oshxonaga yuborildi', auth.uid(), '{}');

  IF COALESCE(p_prepayment_amount, 0) > 0 AND p_payment_method IS NOT NULL THEN
    PERFORM add_payment(v_order_id, p_prepayment_amount, p_payment_method,
      v_key || '-prepay');
  END IF;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_data)
  VALUES (auth.uid(), 'order_created', 'order', v_order_id,
    jsonb_build_object('order_type', p_order_type, 'phone', true));

  RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- RPC: Fulfillment actions (pickup / delivery)
-- ============================================================

CREATE OR REPLACE FUNCTION mark_order_picked_up(p_order_id UUID)
RETURNS VOID AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_paid NUMERIC(12,2);
BEGIN
  IF NOT is_cashier_or_admin() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.order_type <> 'pickup' THEN
    RAISE EXCEPTION 'Not a pickup order';
  END IF;
  IF v_order.fulfillment_status NOT IN ('ready', 'awaiting_pickup') THEN
    RAISE EXCEPTION 'Order not ready for pickup';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM payments WHERE order_id = p_order_id AND status = 'completed';

  IF v_paid < v_order.total THEN
    RAISE EXCEPTION 'Payment incomplete: paid % of %', v_paid, v_order.total;
  END IF;

  UPDATE orders SET
    fulfillment_status = 'picked_up',
    picked_up_at = now()
  WHERE id = p_order_id;

  PERFORM close_order(p_order_id);
  PERFORM log_order_event(p_order_id, 'picked_up', 'Olib ketdi', auth.uid(), '{}');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION dispatch_delivery_order(
  p_order_id UUID,
  p_courier_id UUID
)
RETURNS VOID AS $$
DECLARE
  v_order orders%ROWTYPE;
BEGIN
  IF NOT is_cashier_or_admin() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.order_type <> 'delivery' THEN
    RAISE EXCEPTION 'Not a delivery order';
  END IF;
  IF v_order.fulfillment_status <> 'ready' THEN
    RAISE EXCEPTION 'Order not ready for dispatch';
  END IF;

  UPDATE orders SET
    fulfillment_status = 'in_transit',
    courier_id = p_courier_id,
    dispatched_at = now()
  WHERE id = p_order_id;

  PERFORM log_order_event(p_order_id, 'dispatched', 'Dostavkaga berildi', auth.uid(),
    jsonb_build_object('courier_id', p_courier_id));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION mark_order_delivered(p_order_id UUID)
RETURNS VOID AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_paid NUMERIC(12,2);
BEGIN
  IF NOT is_cashier_or_admin() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.order_type <> 'delivery' THEN
    RAISE EXCEPTION 'Not a delivery order';
  END IF;
  IF v_order.fulfillment_status NOT IN ('in_transit', 'dispatched') THEN
    RAISE EXCEPTION 'Order not in transit';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM payments WHERE order_id = p_order_id AND status = 'completed';

  IF v_paid < v_order.total THEN
    RAISE EXCEPTION 'Payment incomplete: paid % of %', v_paid, v_order.total;
  END IF;

  UPDATE orders SET
    fulfillment_status = 'delivered',
    delivered_at = now()
  WHERE id = p_order_id;

  PERFORM close_order(p_order_id);
  PERFORM log_order_event(p_order_id, 'delivered', 'Yetkazildi', auth.uid(), '{}');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION mark_order_awaiting_pickup(p_order_id UUID)
RETURNS VOID AS $$
DECLARE
  v_order orders%ROWTYPE;
BEGIN
  IF NOT is_cashier_or_admin() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.order_type <> 'pickup' OR v_order.fulfillment_status <> 'ready' THEN
    RAISE EXCEPTION 'Order not ready';
  END IF;

  UPDATE orders SET fulfillment_status = 'awaiting_pickup' WHERE id = p_order_id;
  PERFORM log_order_event(p_order_id, 'awaiting_pickup', 'Olib ketishga tayyor', auth.uid(), '{}');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- PATCH: add_payment — skip table update for phone orders
-- ============================================================

CREATE OR REPLACE FUNCTION add_payment(
  p_order_id UUID,
  p_amount NUMERIC,
  p_method payment_method,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_payment_id UUID;
  v_order orders%ROWTYPE;
  v_paid NUMERIC(12,2);
BEGIN
  IF NOT is_cashier_or_admin() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF p_idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM payments WHERE idempotency_key = p_idempotency_key
  ) THEN
    SELECT id INTO v_payment_id FROM payments WHERE idempotency_key = p_idempotency_key;
    RETURN v_payment_id;
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.status NOT IN ('open', 'awaiting_payment') THEN
    RAISE EXCEPTION 'Order is not open for payment';
  END IF;

  INSERT INTO payments (order_id, amount, method, cashier_id, idempotency_key)
  VALUES (p_order_id, p_amount, p_method, auth.uid(), p_idempotency_key)
  RETURNING id INTO v_payment_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM payments WHERE order_id = p_order_id AND status = 'completed';

  PERFORM log_order_event(p_order_id, 'payment', format('To''lov: %s', p_amount), auth.uid(),
    jsonb_build_object('method', p_method, 'amount', p_amount));

  IF v_paid >= v_order.total THEN
    -- Phone orders: don't auto-close until picked_up/delivered
    IF v_order.order_type = 'dine_in' THEN
      PERFORM close_order(p_order_id);
    ELSE
      UPDATE orders SET status = 'awaiting_payment' WHERE id = p_order_id;
    END IF;
  ELSE
    UPDATE orders SET status = 'awaiting_payment' WHERE id = p_order_id;
    IF v_order.table_id IS NOT NULL THEN
      UPDATE restaurant_tables SET status = 'awaiting_payment' WHERE id = v_order.table_id;
    END IF;
  END IF;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_data)
  VALUES (auth.uid(), 'payment_added', 'payment', v_payment_id,
    jsonb_build_object('amount', p_amount, 'method', p_method));

  RETURN v_payment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- PATCH: close_order
-- ============================================================

CREATE OR REPLACE FUNCTION close_order(p_order_id UUID)
RETURNS VOID AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_paid NUMERIC(12,2);
  v_today DATE := CURRENT_DATE;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM payments WHERE order_id = p_order_id AND status = 'completed';

  IF v_paid < v_order.total THEN
    RAISE EXCEPTION 'Payment incomplete: paid % of %', v_paid, v_order.total;
  END IF;

  UPDATE orders SET
    status = 'paid',
    closed_at = now(),
    fulfillment_status = CASE
      WHEN v_order.order_type IN ('pickup', 'delivery') THEN 'completed'::fulfillment_status
      ELSE fulfillment_status
    END
  WHERE id = p_order_id;

  IF v_order.table_id IS NOT NULL THEN
    UPDATE restaurant_tables SET status = 'empty', current_order_id = NULL
    WHERE id = v_order.table_id;
  END IF;

  PERFORM log_order_event(p_order_id, 'closed', 'To''lov yopildi', auth.uid(), '{}');

  INSERT INTO cash_sessions (session_date, order_count, total_revenue,
    cash_total, card_total, click_total, payme_total, other_total)
  VALUES (v_today, 1, v_order.total,
    COALESCE((SELECT SUM(amount) FROM payments WHERE order_id = p_order_id AND method = 'cash'), 0),
    COALESCE((SELECT SUM(amount) FROM payments WHERE order_id = p_order_id AND method = 'card'), 0),
    COALESCE((SELECT SUM(amount) FROM payments WHERE order_id = p_order_id AND method = 'click'), 0),
    COALESCE((SELECT SUM(amount) FROM payments WHERE order_id = p_order_id AND method = 'payme'), 0),
    COALESCE((SELECT SUM(amount) FROM payments WHERE order_id = p_order_id AND method = 'other'), 0)
  )
  ON CONFLICT (session_date) DO UPDATE SET
    order_count = cash_sessions.order_count + 1,
    total_revenue = cash_sessions.total_revenue + EXCLUDED.total_revenue,
    cash_total = cash_sessions.cash_total + EXCLUDED.cash_total,
    card_total = cash_sessions.card_total + EXCLUDED.card_total,
    click_total = cash_sessions.click_total + EXCLUDED.click_total,
    payme_total = cash_sessions.payme_total + EXCLUDED.payme_total,
    other_total = cash_sessions.other_total + EXCLUDED.other_total,
    updated_at = now();

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_data)
  VALUES (auth.uid(), 'order_closed', 'order', p_order_id,
    jsonb_build_object('total', v_order.total, 'paid', v_paid));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- PATCH: request_bill
-- ============================================================

CREATE OR REPLACE FUNCTION request_bill(p_order_id UUID)
RETURNS VOID AS $$
DECLARE
  v_order orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  UPDATE orders SET status = 'awaiting_payment' WHERE id = p_order_id;
  IF v_order.table_id IS NOT NULL THEN
    UPDATE restaurant_tables SET status = 'awaiting_payment' WHERE id = v_order.table_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- ORDER SUMMARY VIEW
-- ============================================================

CREATE OR REPLACE VIEW order_summaries AS
SELECT
  o.id,
  o.order_number,
  o.order_type,
  o.status,
  o.fulfillment_status,
  o.table_id,
  t.number AS table_number,
  o.waiter_id,
  o.created_by,
  o.customer_name,
  o.customer_phone,
  o.delivery_address,
  o.delivery_landmark,
  o.delivery_fee,
  o.discount_amount,
  o.notes,
  o.payment_method_preference,
  o.scheduled_ready_at,
  o.scheduled_delivery_at,
  o.courier_id,
  o.subtotal,
  o.service_charge,
  o.tax_amount,
  o.total,
  o.opened_at,
  o.closed_at,
  o.kitchen_ready_at,
  o.dispatched_at,
  o.delivered_at,
  o.picked_up_at,
  creator.full_name AS created_by_name,
  waiter.full_name AS waiter_name,
  courier.full_name AS courier_name,
  COALESCE(pay.paid_total, 0) AS paid_total,
  GREATEST(o.total - COALESCE(pay.paid_total, 0), 0) AS balance_due,
  COALESCE(items.item_count, 0) AS item_count
FROM orders o
LEFT JOIN restaurant_tables t ON t.id = o.table_id
LEFT JOIN profiles creator ON creator.id = o.created_by
LEFT JOIN profiles waiter ON waiter.id = o.waiter_id
LEFT JOIN profiles courier ON courier.id = o.courier_id
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(amount), 0) AS paid_total
  FROM payments WHERE order_id = o.id AND status = 'completed'
) pay ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*)::INT AS item_count
  FROM order_items WHERE order_id = o.id AND status NOT IN ('cancelled')
) items ON true;

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE order_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS order_events_select ON order_events;
CREATE POLICY order_events_select ON order_events FOR SELECT TO authenticated
  USING (
    is_admin()
    OR get_user_role() IN ('cashier', 'kitchen')
    OR EXISTS (
      SELECT 1 FROM orders o WHERE o.id = order_id
        AND get_user_role() = 'waiter' AND o.waiter_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS orders_insert ON orders;
CREATE POLICY orders_insert ON orders FOR INSERT TO authenticated
  WITH CHECK (
    get_user_role() IN ('admin', 'waiter')
    OR (is_cashier_or_admin() AND order_type IN ('pickup', 'delivery'))
  );

DROP POLICY IF EXISTS orders_select ON orders;
CREATE POLICY orders_select ON orders FOR SELECT TO authenticated
  USING (
    is_admin()
    OR get_user_role() IN ('cashier', 'kitchen')
    OR (get_user_role() = 'waiter' AND waiter_id = auth.uid())
    OR (get_user_role() = 'waiter' AND order_type = 'dine_in' AND table_id IS NOT NULL)
  );

-- ============================================================
-- STORAGE: menu-images bucket
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'menu-images',
  'menu-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS menu_images_public_read ON storage.objects;
CREATE POLICY menu_images_public_read ON storage.objects FOR SELECT
  USING (bucket_id = 'menu-images');

DROP POLICY IF EXISTS menu_images_admin_upload ON storage.objects;
CREATE POLICY menu_images_admin_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'menu-images' AND is_admin());

DROP POLICY IF EXISTS menu_images_admin_update ON storage.objects;
CREATE POLICY menu_images_admin_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'menu-images' AND is_admin());

DROP POLICY IF EXISTS menu_images_admin_delete ON storage.objects;
CREATE POLICY menu_images_admin_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'menu-images' AND is_admin());

-- ============================================================
-- REALTIME
-- ============================================================

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE order_events;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Grants for views
GRANT SELECT ON order_summaries TO authenticated;
