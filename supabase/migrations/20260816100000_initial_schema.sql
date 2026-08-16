-- OrderFlow: Initial production schema
-- Run via: supabase db reset (local) or supabase migration up

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM ('admin', 'cashier', 'waiter', 'kitchen');

CREATE TYPE table_status AS ENUM (
  'empty',
  'occupied',
  'has_order',
  'preparing',
  'ready',
  'awaiting_payment'
);

CREATE TYPE order_status AS ENUM (
  'draft',
  'open',
  'awaiting_payment',
  'paid',
  'cancelled'
);

CREATE TYPE order_item_status AS ENUM (
  'pending',
  'sent',
  'accepted',
  'in_progress',
  'ready',
  'served',
  'cancelled'
);

CREATE TYPE kitchen_ticket_status AS ENUM (
  'new',
  'accepted',
  'in_progress',
  'ready',
  'cancelled'
);

CREATE TYPE payment_method AS ENUM ('cash', 'card', 'click', 'payme', 'other');

CREATE TYPE payment_status AS ENUM ('pending', 'completed', 'refunded');

CREATE TYPE notification_type AS ENUM (
  'order_ready',
  'order_accepted',
  'table_assigned',
  'payment_received',
  'system'
);

CREATE TYPE audit_action AS ENUM (
  'order_created',
  'order_sent_to_kitchen',
  'status_changed',
  'item_cancelled',
  'payment_added',
  'order_closed',
  'admin_override',
  'settings_changed'
);

-- ============================================================
-- RESTAURANT SETTINGS
-- ============================================================

CREATE TABLE restaurant_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'OrderFlow Restaurant',
  logo_url TEXT,
  phone TEXT,
  address TEXT,
  table_count INT NOT NULL DEFAULT 30,
  currency TEXT NOT NULL DEFAULT 'UZS',
  service_charge_percent NUMERIC(5,2) NOT NULL DEFAULT 10,
  tax_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  notification_sound_url TEXT,
  receipt_footer TEXT DEFAULT 'Rahmat!',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- PROFILES (extends auth.users)
-- ============================================================

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'waiter',
  pin_hash TEXT,
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_role ON profiles(role);
CREATE INDEX idx_profiles_active ON profiles(is_active) WHERE is_active = true;

-- ============================================================
-- RESTAURANT TABLES
-- ============================================================

CREATE TABLE restaurant_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number INT NOT NULL UNIQUE,
  status table_status NOT NULL DEFAULT 'empty',
  current_order_id UUID,
  capacity INT NOT NULL DEFAULT 4,
  zone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tables_status ON restaurant_tables(status);
CREATE INDEX idx_tables_number ON restaurant_tables(number);

-- ============================================================
-- MENU
-- ============================================================

CREATE TABLE menu_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES menu_categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  image_url TEXT,
  prep_time_minutes INT NOT NULL DEFAULT 15,
  is_available BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_menu_items_category ON menu_items(category_id);
CREATE INDEX idx_menu_items_available ON menu_items(is_available) WHERE is_available = true;
CREATE INDEX idx_menu_items_name ON menu_items USING gin(to_tsvector('simple', name));

-- ============================================================
-- ORDERS (Bills / Hisob)
-- ============================================================

CREATE SEQUENCE order_number_seq START 1;

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT NOT NULL UNIQUE,
  table_id UUID NOT NULL REFERENCES restaurant_tables(id) ON DELETE RESTRICT,
  waiter_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  status order_status NOT NULL DEFAULT 'open',
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  service_charge NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  guest_count INT NOT NULL DEFAULT 1,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one active (non-paid, non-cancelled) order per table
CREATE UNIQUE INDEX idx_orders_one_active_per_table
  ON orders(table_id)
  WHERE status IN ('draft', 'open', 'awaiting_payment');

CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_waiter ON orders(waiter_id);
CREATE INDEX idx_orders_opened_at ON orders(opened_at);
CREATE INDEX idx_orders_table ON orders(table_id);

ALTER TABLE restaurant_tables
  ADD CONSTRAINT fk_tables_current_order
  FOREIGN KEY (current_order_id) REFERENCES orders(id) ON DELETE SET NULL;

-- ============================================================
-- KITCHEN TICKETS
-- ============================================================

CREATE SEQUENCE kitchen_ticket_seq START 1;

CREATE TABLE kitchen_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number INT NOT NULL DEFAULT nextval('kitchen_ticket_seq'),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  table_id UUID NOT NULL REFERENCES restaurant_tables(id) ON DELETE RESTRICT,
  waiter_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  status kitchen_ticket_status NOT NULL DEFAULT 'new',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_kitchen_tickets_status ON kitchen_tickets(status);
CREATE INDEX idx_kitchen_tickets_order ON kitchen_tickets(order_id);
CREATE INDEX idx_kitchen_tickets_sent_at ON kitchen_tickets(sent_at);

-- ============================================================
-- ORDER ITEMS
-- ============================================================

CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE RESTRICT,
  kitchen_ticket_id UUID REFERENCES kitchen_tickets(id) ON DELETE SET NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL,
  total_price NUMERIC(12,2) NOT NULL,
  notes TEXT,
  status order_item_status NOT NULL DEFAULT 'pending',
  idempotency_key TEXT UNIQUE,
  sent_to_kitchen_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES profiles(id),
  cancel_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_kitchen_ticket ON order_items(kitchen_ticket_id);
CREATE INDEX idx_order_items_status ON order_items(status);

-- ============================================================
-- PAYMENTS
-- ============================================================

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  method payment_method NOT NULL,
  status payment_status NOT NULL DEFAULT 'completed',
  cashier_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  idempotency_key TEXT UNIQUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_order ON payments(order_id);
CREATE INDEX idx_payments_created_at ON payments(created_at);
CREATE INDEX idx_payments_method ON payments(method);

-- ============================================================
-- CASH SESSIONS (daily register)
-- ============================================================

CREATE TABLE cash_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_date DATE NOT NULL UNIQUE DEFAULT CURRENT_DATE,
  opened_by UUID REFERENCES profiles(id),
  closed_by UUID REFERENCES profiles(id),
  total_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  cash_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  card_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  click_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  payme_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  other_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  order_count INT NOT NULL DEFAULT 0,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type notification_type NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, is_read, created_at DESC);

-- ============================================================
-- AUDIT LOGS
-- ============================================================

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action audit_action NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  old_data JSONB,
  new_data JSONB,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_id);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_tables_updated BEFORE UPDATE ON restaurant_tables
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_order_items_updated BEFORE UPDATE ON order_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_kitchen_tickets_updated BEFORE UPDATE ON kitchen_tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_payments_updated BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_menu_items_updated BEFORE UPDATE ON menu_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_settings_updated BEFORE UPDATE ON restaurant_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Generate order number: 000001, 000002, ...
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TEXT AS $$
BEGIN
  RETURN lpad(nextval('order_number_seq')::text, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- Get user role from JWT / profiles
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS user_role AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin');
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION is_cashier_or_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('admin', 'cashier')
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Recalculate order totals
CREATE OR REPLACE FUNCTION recalculate_order_totals(p_order_id UUID)
RETURNS VOID AS $$
DECLARE
  v_subtotal NUMERIC(12,2);
  v_service_pct NUMERIC(5,2);
  v_tax_pct NUMERIC(5,2);
  v_service NUMERIC(12,2);
  v_tax NUMERIC(12,2);
BEGIN
  SELECT COALESCE(SUM(total_price), 0) INTO v_subtotal
  FROM order_items
  WHERE order_id = p_order_id AND status NOT IN ('cancelled');

  SELECT service_charge_percent, tax_percent
  INTO v_service_pct, v_tax_pct
  FROM restaurant_settings LIMIT 1;

  v_service := ROUND(v_subtotal * COALESCE(v_service_pct, 0) / 100, 0);
  v_tax := ROUND((v_subtotal + v_service) * COALESCE(v_tax_pct, 0) / 100, 0);

  UPDATE orders SET
    subtotal = v_subtotal,
    service_charge = v_service,
    tax_amount = v_tax,
    total = v_subtotal + v_service + v_tax,
    updated_at = now()
  WHERE id = p_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- RPC: Open or get active order for table
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
  SELECT status INTO v_table_status FROM restaurant_tables WHERE id = p_table_id FOR UPDATE;

  IF v_table_status = 'empty' OR v_table_status IS NULL THEN
    INSERT INTO orders (order_number, table_id, waiter_id, status)
    VALUES (generate_order_number(), p_table_id, p_waiter_id, 'open')
    RETURNING id INTO v_order_id;

    UPDATE restaurant_tables SET
      status = 'occupied',
      current_order_id = v_order_id
    WHERE id = p_table_id;

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
-- RPC: Send items to kitchen (idempotent)
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
  v_order_item_id UUID;
BEGIN
  -- Idempotency check
  IF EXISTS (SELECT 1 FROM order_items WHERE idempotency_key = p_idempotency_key) THEN
    SELECT kitchen_ticket_id INTO v_ticket_id
    FROM order_items WHERE idempotency_key = p_idempotency_key LIMIT 1;
    RETURN v_ticket_id;
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.status NOT IN ('open', 'draft') THEN
    RAISE EXCEPTION 'Order cannot accept new kitchen sends';
  END IF;

  INSERT INTO kitchen_tickets (order_id, table_id, waiter_id, status)
  VALUES (p_order_id, v_order.table_id, v_order.waiter_id, 'new')
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

  UPDATE restaurant_tables SET status = 'has_order'
  WHERE id = v_order.table_id;

  UPDATE orders SET status = 'open' WHERE id = p_order_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_data)
  VALUES (auth.uid(), 'order_sent_to_kitchen', 'kitchen_ticket', v_ticket_id,
    jsonb_build_object('order_id', p_order_id, 'idempotency_key', p_idempotency_key));

  RETURN v_ticket_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- RPC: Update kitchen ticket status
-- ============================================================

CREATE OR REPLACE FUNCTION update_kitchen_ticket_status(
  p_ticket_id UUID,
  p_status kitchen_ticket_status
)
RETURNS VOID AS $$
DECLARE
  v_ticket kitchen_tickets%ROWTYPE;
  v_waiter_id UUID;
  v_table_number INT;
BEGIN
  SELECT * INTO v_ticket FROM kitchen_tickets WHERE id = p_ticket_id FOR UPDATE;

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

  IF p_status = 'in_progress' THEN
    UPDATE restaurant_tables SET status = 'preparing'
    WHERE id = v_ticket.table_id;
  END IF;

  IF p_status = 'ready' THEN
    SELECT number INTO v_table_number FROM restaurant_tables WHERE id = v_ticket.table_id;

    INSERT INTO notifications (user_id, type, title, body, data)
    VALUES (
      v_ticket.waiter_id,
      'order_ready',
      'Buyurtma tayyor!',
      format('Stol %s buyurtmasi tayyor!', v_table_number),
      jsonb_build_object(
        'ticket_id', p_ticket_id,
        'table_id', v_ticket.table_id,
        'order_id', v_ticket.order_id
      )
    );

    -- Check if all tickets for order are ready
    IF NOT EXISTS (
      SELECT 1 FROM kitchen_tickets
      WHERE order_id = v_ticket.order_id
        AND status NOT IN ('ready', 'cancelled')
    ) THEN
      UPDATE restaurant_tables SET status = 'ready' WHERE id = v_ticket.table_id;
    END IF;
  END IF;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_data)
  VALUES (auth.uid(), 'status_changed', 'kitchen_ticket', p_ticket_id,
    jsonb_build_object('status', p_status));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- RPC: Add payment (split payment support)
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

  IF v_paid >= v_order.total THEN
    PERFORM close_order(p_order_id);
  ELSE
    UPDATE orders SET status = 'awaiting_payment' WHERE id = p_order_id;
    UPDATE restaurant_tables SET status = 'awaiting_payment'
    WHERE id = v_order.table_id;
  END IF;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_data)
  VALUES (auth.uid(), 'payment_added', 'payment', v_payment_id,
    jsonb_build_object('amount', p_amount, 'method', p_method));

  RETURN v_payment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- RPC: Close order (full payment required)
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

  UPDATE orders SET status = 'paid', closed_at = now() WHERE id = p_order_id;

  UPDATE restaurant_tables SET
    status = 'empty',
    current_order_id = NULL
  WHERE id = v_order.table_id;

  -- Update daily cash session
  INSERT INTO cash_sessions (session_date, order_count, total_revenue,
    cash_total, card_total, click_total, payme_total, other_total)
  VALUES (v_today, 1,
    v_order.total,
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
-- RPC: Request bill (move to awaiting payment)
-- ============================================================

CREATE OR REPLACE FUNCTION request_bill(p_order_id UUID)
RETURNS VOID AS $$
DECLARE
  v_order orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  UPDATE orders SET status = 'awaiting_payment' WHERE id = p_order_id;
  UPDATE restaurant_tables SET status = 'awaiting_payment' WHERE id = v_order.table_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE kitchen_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Profiles: read own, admin reads all
CREATE POLICY profiles_select ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR is_admin());
CREATE POLICY profiles_update_own ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY profiles_admin_all ON profiles FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- Settings: all read, admin write
CREATE POLICY settings_select ON restaurant_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY settings_admin ON restaurant_settings FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- Tables: operational roles read, waiter/admin update via RPC
CREATE POLICY tables_select ON restaurant_tables FOR SELECT TO authenticated
  USING (get_user_role() IN ('admin', 'cashier', 'waiter', 'kitchen'));
CREATE POLICY tables_admin ON restaurant_tables FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- Menu: all authenticated read, admin write
CREATE POLICY menu_cat_select ON menu_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY menu_cat_admin ON menu_categories FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY menu_items_select ON menu_items FOR SELECT TO authenticated USING (true);
CREATE POLICY menu_items_admin ON menu_items FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- Orders
CREATE POLICY orders_select ON orders FOR SELECT TO authenticated
  USING (
    is_admin()
    OR get_user_role() IN ('cashier', 'kitchen')
    OR (get_user_role() = 'waiter' AND waiter_id = auth.uid())
  );
CREATE POLICY orders_insert ON orders FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('admin', 'waiter'));
CREATE POLICY orders_update ON orders FOR UPDATE TO authenticated
  USING (is_admin() OR get_user_role() IN ('cashier', 'waiter'));

-- Order items
CREATE POLICY order_items_select ON order_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders o WHERE o.id = order_id AND (
        is_admin() OR get_user_role() IN ('cashier', 'kitchen')
        OR (get_user_role() = 'waiter' AND o.waiter_id = auth.uid())
      )
    )
  );

-- Kitchen tickets: kitchen + admin + related waiter
CREATE POLICY kitchen_select ON kitchen_tickets FOR SELECT TO authenticated
  USING (
    is_admin()
    OR get_user_role() IN ('kitchen', 'cashier')
    OR (get_user_role() = 'waiter' AND waiter_id = auth.uid())
  );
CREATE POLICY kitchen_update ON kitchen_tickets FOR UPDATE TO authenticated
  USING (get_user_role() IN ('admin', 'kitchen'));

-- Payments: cashier + admin
CREATE POLICY payments_select ON payments FOR SELECT TO authenticated
  USING (is_cashier_or_admin() OR is_admin());
CREATE POLICY payments_insert ON payments FOR INSERT TO authenticated
  WITH CHECK (is_cashier_or_admin());

-- Cash sessions: cashier + admin
CREATE POLICY cash_sessions_select ON cash_sessions FOR SELECT TO authenticated
  USING (is_cashier_or_admin());

-- Notifications: own only
CREATE POLICY notifications_select ON notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY notifications_update ON notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

-- Audit logs: admin only
CREATE POLICY audit_admin ON audit_logs FOR SELECT TO authenticated
  USING (is_admin());

-- ============================================================
-- REALTIME
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE restaurant_tables;
ALTER PUBLICATION supabase_realtime ADD TABLE kitchen_tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE orders;
