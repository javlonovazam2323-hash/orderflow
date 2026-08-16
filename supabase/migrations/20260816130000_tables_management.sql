-- Tables management: reservations, zones, cleaning, admin CRUD
-- Idempotent where possible; no DROP/TRUNCATE/DELETE

-- Enum extensions
DO $$ BEGIN ALTER TYPE table_status ADD VALUE IF NOT EXISTS 'reserved'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE table_status ADD VALUE IF NOT EXISTS 'cleaning'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE reservation_status AS ENUM ('active', 'checked_in', 'cancelled', 'no_show');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Table columns
ALTER TABLE restaurant_tables ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE restaurant_tables ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_tables_active ON restaurant_tables(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_tables_zone ON restaurant_tables(zone);

-- Default zone for existing rows
UPDATE restaurant_tables SET zone = COALESCE(NULLIF(trim(zone), ''), 'Asosiy zal')
WHERE zone IS NULL OR trim(zone) = '';

-- ============================================================
-- RESERVATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS table_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id UUID NOT NULL REFERENCES restaurant_tables(id) ON DELETE RESTRICT,
  customer_name TEXT NOT NULL,
  phone TEXT,
  reserved_for TIMESTAMPTZ NOT NULL,
  guest_count INT NOT NULL DEFAULT 2 CHECK (guest_count > 0),
  notes TEXT,
  status reservation_status NOT NULL DEFAULT 'active',
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reservations_table ON table_reservations(table_id);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON table_reservations(status);
CREATE INDEX IF NOT EXISTS idx_reservations_time ON table_reservations(reserved_for);

DROP TRIGGER IF EXISTS trg_reservations_updated ON table_reservations;
CREATE TRIGGER trg_reservations_updated BEFORE UPDATE ON table_reservations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE table_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reservations_select ON table_reservations;
DROP POLICY IF EXISTS reservations_admin ON table_reservations;
DROP POLICY IF EXISTS reservations_waiter_read ON table_reservations;
CREATE POLICY reservations_select ON table_reservations FOR SELECT TO authenticated USING (true);
CREATE POLICY reservations_admin ON table_reservations FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY reservations_waiter_read ON table_reservations FOR SELECT TO authenticated
  USING (get_user_role() IN ('waiter', 'cashier', 'kitchen'));

-- Realtime
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE table_reservations;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE order_items;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE payments;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- Helper: reservation conflict (±2 hours window)
-- ============================================================

CREATE OR REPLACE FUNCTION reservation_has_conflict(
  p_table_id UUID,
  p_reserved_for TIMESTAMPTZ,
  p_exclude_id UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM table_reservations
    WHERE table_id = p_table_id
      AND status = 'active'
      AND (p_exclude_id IS NULL OR id <> p_exclude_id)
      AND reserved_for BETWEEN (p_reserved_for - interval '2 hours')
                           AND (p_reserved_for + interval '2 hours')
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ============================================================
-- RPC: Create reservation
-- ============================================================

CREATE OR REPLACE FUNCTION create_table_reservation(
  p_table_id UUID,
  p_customer_name TEXT,
  p_phone TEXT,
  p_reserved_for TIMESTAMPTZ,
  p_guest_count INT DEFAULT 2,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
  v_status table_status;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Forbidden'; END IF;

  SELECT status INTO v_status FROM restaurant_tables WHERE id = p_table_id AND is_active = true FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Table not found'; END IF;
  IF v_status NOT IN ('empty', 'reserved') THEN
    RAISE EXCEPTION 'Table is not available for reservation';
  END IF;

  IF reservation_has_conflict(p_table_id, p_reserved_for) THEN
    RAISE EXCEPTION 'Conflicting reservation exists for this time';
  END IF;

  INSERT INTO table_reservations (
    table_id, customer_name, phone, reserved_for, guest_count, notes, created_by
  ) VALUES (
    p_table_id, trim(p_customer_name), NULLIF(trim(p_phone), ''), p_reserved_for,
    GREATEST(p_guest_count, 1), p_notes, auth.uid()
  ) RETURNING id INTO v_id;

  UPDATE restaurant_tables SET status = 'reserved' WHERE id = p_table_id AND status = 'empty';

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION create_table_reservation(UUID, TEXT, TEXT, TIMESTAMPTZ, INT, TEXT) TO authenticated;

-- ============================================================
-- RPC: Cancel reservation
-- ============================================================

CREATE OR REPLACE FUNCTION cancel_table_reservation(p_reservation_id UUID)
RETURNS VOID AS $$
DECLARE
  v_res table_reservations%ROWTYPE;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Forbidden'; END IF;

  SELECT * INTO v_res FROM table_reservations WHERE id = p_reservation_id FOR UPDATE;
  IF v_res.status <> 'active' THEN RAISE EXCEPTION 'Reservation is not active'; END IF;

  UPDATE table_reservations SET status = 'cancelled', updated_at = now() WHERE id = p_reservation_id;

  IF NOT EXISTS (
    SELECT 1 FROM table_reservations
    WHERE table_id = v_res.table_id AND status = 'active' AND id <> p_reservation_id
  ) THEN
    UPDATE restaurant_tables SET status = 'empty'
    WHERE id = v_res.table_id AND status = 'reserved';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION cancel_table_reservation(UUID) TO authenticated;

-- ============================================================
-- RPC: Check-in reservation → open order
-- ============================================================

CREATE OR REPLACE FUNCTION check_in_reservation(
  p_reservation_id UUID,
  p_waiter_id UUID DEFAULT auth.uid()
)
RETURNS UUID AS $$
DECLARE
  v_res table_reservations%ROWTYPE;
  v_order_id UUID;
BEGIN
  IF NOT is_admin() AND get_user_role() NOT IN ('waiter', 'admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO v_res FROM table_reservations WHERE id = p_reservation_id FOR UPDATE;
  IF v_res.status <> 'active' THEN RAISE EXCEPTION 'Reservation is not active'; END IF;

  UPDATE table_reservations SET status = 'checked_in', updated_at = now() WHERE id = p_reservation_id;

  UPDATE restaurant_tables SET status = 'empty' WHERE id = v_res.table_id AND status = 'reserved';

  v_order_id := open_table_order(v_res.table_id, p_waiter_id);

  UPDATE orders SET guest_count = v_res.guest_count WHERE id = v_order_id;

  RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION check_in_reservation(UUID, UUID) TO authenticated;

-- ============================================================
-- RPC: Admin upsert table
-- ============================================================

CREATE OR REPLACE FUNCTION admin_upsert_table(
  p_number INT,
  p_capacity INT DEFAULT 4,
  p_zone TEXT DEFAULT 'Asosiy zal',
  p_name TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT true,
  p_table_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
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

  INSERT INTO restaurant_tables (number, capacity, zone, name, is_active, status)
  VALUES (
    p_number,
    GREATEST(p_capacity, 1),
    COALESCE(NULLIF(trim(p_zone), ''), 'Asosiy zal'),
    NULLIF(trim(p_name), ''),
    p_is_active,
    'empty'
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION admin_upsert_table(INT, INT, TEXT, TEXT, BOOLEAN, UUID) TO authenticated;

-- ============================================================
-- RPC: Set table cleaning / available
-- ============================================================

CREATE OR REPLACE FUNCTION set_table_cleaning(p_table_id UUID)
RETURNS VOID AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  UPDATE restaurant_tables SET status = 'cleaning', current_order_id = NULL
  WHERE id = p_table_id AND status IN ('empty', 'awaiting_payment');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION set_table_available(p_table_id UUID)
RETURNS VOID AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  UPDATE restaurant_tables SET status = 'empty', current_order_id = NULL
  WHERE id = p_table_id AND status = 'cleaning';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION set_table_cleaning(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION set_table_available(UUID) TO authenticated;

-- ============================================================
-- Patch open_table_order: allow reserved → occupied
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
  SELECT status INTO v_table_status FROM restaurant_tables WHERE id = p_table_id AND is_active = true FOR UPDATE;

  IF v_table_status IS NULL THEN
    RAISE EXCEPTION 'Table not found';
  END IF;

  IF v_table_status IN ('empty', 'reserved') THEN
    IF v_table_status = 'reserved' THEN
      UPDATE table_reservations SET status = 'checked_in', updated_at = now()
      WHERE table_id = p_table_id AND status = 'active';
    END IF;

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

  IF v_table_status = 'cleaning' THEN
    RAISE EXCEPTION 'Table is being cleaned';
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
-- View: table summaries for admin/waiter panels
-- ============================================================

CREATE OR REPLACE VIEW table_summaries AS
SELECT
  t.id,
  t.number,
  t.name,
  t.status,
  t.capacity,
  t.zone,
  t.is_active,
  t.current_order_id,
  o.order_number,
  o.waiter_id,
  o.status AS order_status,
  o.total AS order_total,
  o.guest_count,
  o.opened_at,
  p.full_name AS waiter_name,
  COALESCE(oi.item_count, 0)::INT AS item_count,
  COALESCE(pay.paid_total, 0)::NUMERIC(12,2) AS paid_total,
  GREATEST(COALESCE(o.total, 0) - COALESCE(pay.paid_total, 0), 0)::NUMERIC(12,2) AS balance_due,
  r.id AS reservation_id,
  r.customer_name AS reservation_name,
  r.phone AS reservation_phone,
  r.reserved_for,
  r.guest_count AS reservation_guests,
  r.notes AS reservation_notes
FROM restaurant_tables t
LEFT JOIN orders o ON o.id = t.current_order_id
LEFT JOIN profiles p ON p.id = o.waiter_id
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS item_count
  FROM order_items oi
  WHERE oi.order_id = o.id AND oi.status <> 'cancelled'
) oi ON true
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(amount), 0) AS paid_total
  FROM payments pm
  WHERE pm.order_id = o.id AND pm.status = 'completed'
) pay ON true
LEFT JOIN LATERAL (
  SELECT *
  FROM table_reservations tr
  WHERE tr.table_id = t.id AND tr.status = 'active'
  ORDER BY tr.reserved_for ASC
  LIMIT 1
) r ON true;

GRANT SELECT ON table_summaries TO authenticated;
