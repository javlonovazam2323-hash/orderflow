-- Phase 2: nullable restaurant_id + backfill to default tenant.
-- Additive only. Does not alter existing RLS, RPCs, unique constraints, or set NOT NULL.
-- Do not apply automatically to production; apply after review.

DO $$
DECLARE
  v_default UUID;
BEGIN
  SELECT id INTO v_default
  FROM public.restaurants
  WHERE id = '6b73d440-d31a-418f-8d21-047b9ef9bdb4'
    AND slug = 'orderflow';

  IF v_default IS NULL THEN
    RAISE EXCEPTION 'Phase 2 abort: default restaurant orderflow (%) not found',
      '6b73d440-d31a-418f-8d21-047b9ef9bdb4';
  END IF;
END $$;

-- ============================================================
-- Add nullable restaurant_id + FK + lookup index
-- ============================================================

DO $$
DECLARE
  t TEXT;
  cons TEXT;
  idx TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'restaurant_settings',
    'restaurant_tables',
    'menu_categories',
    'menu_items',
    'orders',
    'order_items',
    'kitchen_tickets',
    'payments',
    'cash_sessions',
    'notifications',
    'audit_logs',
    'table_reservations',
    'order_events'
  ]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS restaurant_id UUID',
      t
    );

    cons := t || '_restaurant_id_fkey';
    BEGIN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id)',
        t, cons
      );
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;

    idx := 'idx_' || t || '_restaurant_id';
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (restaurant_id)',
      idx, t
    );
  END LOOP;
END $$;

-- ============================================================
-- Backfill (only NULL rows; do not overwrite other tenants)
-- ============================================================

UPDATE public.restaurant_settings
SET restaurant_id = '6b73d440-d31a-418f-8d21-047b9ef9bdb4'
WHERE restaurant_id IS NULL;

UPDATE public.restaurant_tables
SET restaurant_id = '6b73d440-d31a-418f-8d21-047b9ef9bdb4'
WHERE restaurant_id IS NULL;

UPDATE public.menu_categories
SET restaurant_id = '6b73d440-d31a-418f-8d21-047b9ef9bdb4'
WHERE restaurant_id IS NULL;

UPDATE public.menu_items mi
SET restaurant_id = COALESCE(c.restaurant_id, '6b73d440-d31a-418f-8d21-047b9ef9bdb4')
FROM public.menu_categories c
WHERE mi.category_id = c.id
  AND mi.restaurant_id IS NULL;

UPDATE public.orders
SET restaurant_id = '6b73d440-d31a-418f-8d21-047b9ef9bdb4'
WHERE restaurant_id IS NULL;

UPDATE public.order_items oi
SET restaurant_id = o.restaurant_id
FROM public.orders o
WHERE oi.order_id = o.id
  AND oi.restaurant_id IS NULL
  AND o.restaurant_id IS NOT NULL;

UPDATE public.kitchen_tickets kt
SET restaurant_id = o.restaurant_id
FROM public.orders o
WHERE kt.order_id = o.id
  AND kt.restaurant_id IS NULL
  AND o.restaurant_id IS NOT NULL;

UPDATE public.payments p
SET restaurant_id = o.restaurant_id
FROM public.orders o
WHERE p.order_id = o.id
  AND p.restaurant_id IS NULL
  AND o.restaurant_id IS NOT NULL;

UPDATE public.cash_sessions
SET restaurant_id = '6b73d440-d31a-418f-8d21-047b9ef9bdb4'
WHERE restaurant_id IS NULL;

UPDATE public.notifications
SET restaurant_id = '6b73d440-d31a-418f-8d21-047b9ef9bdb4'
WHERE restaurant_id IS NULL;

UPDATE public.audit_logs
SET restaurant_id = '6b73d440-d31a-418f-8d21-047b9ef9bdb4'
WHERE restaurant_id IS NULL;

UPDATE public.table_reservations tr
SET restaurant_id = t.restaurant_id
FROM public.restaurant_tables t
WHERE tr.table_id = t.id
  AND tr.restaurant_id IS NULL
  AND t.restaurant_id IS NOT NULL;

UPDATE public.order_events oe
SET restaurant_id = o.restaurant_id
FROM public.orders o
WHERE oe.order_id = o.id
  AND oe.restaurant_id IS NULL
  AND o.restaurant_id IS NOT NULL;

-- ============================================================
-- Consistency asserts (no NOT NULL constraint)
-- ============================================================

DO $$
DECLARE
  v_null INT;
  v_mismatch INT;
BEGIN
  SELECT count(*) INTO v_null FROM public.restaurant_settings WHERE restaurant_id IS NULL;
  IF v_null > 0 THEN RAISE EXCEPTION 'Phase 2 abort: restaurant_settings NULL restaurant_id=%', v_null; END IF;
  SELECT count(*) INTO v_null FROM public.restaurant_tables WHERE restaurant_id IS NULL;
  IF v_null > 0 THEN RAISE EXCEPTION 'Phase 2 abort: restaurant_tables NULL restaurant_id=%', v_null; END IF;
  SELECT count(*) INTO v_null FROM public.menu_categories WHERE restaurant_id IS NULL;
  IF v_null > 0 THEN RAISE EXCEPTION 'Phase 2 abort: menu_categories NULL restaurant_id=%', v_null; END IF;
  SELECT count(*) INTO v_null FROM public.menu_items WHERE restaurant_id IS NULL;
  IF v_null > 0 THEN RAISE EXCEPTION 'Phase 2 abort: menu_items NULL restaurant_id=%', v_null; END IF;
  SELECT count(*) INTO v_null FROM public.orders WHERE restaurant_id IS NULL;
  IF v_null > 0 THEN RAISE EXCEPTION 'Phase 2 abort: orders NULL restaurant_id=%', v_null; END IF;
  SELECT count(*) INTO v_null FROM public.order_items WHERE restaurant_id IS NULL;
  IF v_null > 0 THEN RAISE EXCEPTION 'Phase 2 abort: order_items NULL restaurant_id=%', v_null; END IF;
  SELECT count(*) INTO v_null FROM public.kitchen_tickets WHERE restaurant_id IS NULL;
  IF v_null > 0 THEN RAISE EXCEPTION 'Phase 2 abort: kitchen_tickets NULL restaurant_id=%', v_null; END IF;
  SELECT count(*) INTO v_null FROM public.payments WHERE restaurant_id IS NULL;
  IF v_null > 0 THEN RAISE EXCEPTION 'Phase 2 abort: payments NULL restaurant_id=%', v_null; END IF;
  SELECT count(*) INTO v_null FROM public.cash_sessions WHERE restaurant_id IS NULL;
  IF v_null > 0 THEN RAISE EXCEPTION 'Phase 2 abort: cash_sessions NULL restaurant_id=%', v_null; END IF;
  SELECT count(*) INTO v_null FROM public.notifications WHERE restaurant_id IS NULL;
  IF v_null > 0 THEN RAISE EXCEPTION 'Phase 2 abort: notifications NULL restaurant_id=%', v_null; END IF;
  SELECT count(*) INTO v_null FROM public.audit_logs WHERE restaurant_id IS NULL;
  IF v_null > 0 THEN RAISE EXCEPTION 'Phase 2 abort: audit_logs NULL restaurant_id=%', v_null; END IF;
  SELECT count(*) INTO v_null FROM public.table_reservations WHERE restaurant_id IS NULL;
  IF v_null > 0 THEN RAISE EXCEPTION 'Phase 2 abort: table_reservations NULL restaurant_id=%', v_null; END IF;
  SELECT count(*) INTO v_null FROM public.order_events WHERE restaurant_id IS NULL;
  IF v_null > 0 THEN RAISE EXCEPTION 'Phase 2 abort: order_events NULL restaurant_id=%', v_null; END IF;

  SELECT count(*) INTO v_mismatch
  FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
  WHERE oi.restaurant_id IS DISTINCT FROM o.restaurant_id;
  IF v_mismatch > 0 THEN RAISE EXCEPTION 'Phase 2 abort: order_items mismatch=%', v_mismatch; END IF;

  SELECT count(*) INTO v_mismatch
  FROM public.kitchen_tickets kt JOIN public.orders o ON o.id = kt.order_id
  WHERE kt.restaurant_id IS DISTINCT FROM o.restaurant_id;
  IF v_mismatch > 0 THEN RAISE EXCEPTION 'Phase 2 abort: kitchen_tickets mismatch=%', v_mismatch; END IF;

  SELECT count(*) INTO v_mismatch
  FROM public.payments p JOIN public.orders o ON o.id = p.order_id
  WHERE p.restaurant_id IS DISTINCT FROM o.restaurant_id;
  IF v_mismatch > 0 THEN RAISE EXCEPTION 'Phase 2 abort: payments mismatch=%', v_mismatch; END IF;

  SELECT count(*) INTO v_mismatch
  FROM public.order_events oe JOIN public.orders o ON o.id = oe.order_id
  WHERE oe.restaurant_id IS DISTINCT FROM o.restaurant_id;
  IF v_mismatch > 0 THEN RAISE EXCEPTION 'Phase 2 abort: order_events mismatch=%', v_mismatch; END IF;

  SELECT count(*) INTO v_mismatch
  FROM public.table_reservations tr JOIN public.restaurant_tables t ON t.id = tr.table_id
  WHERE tr.restaurant_id IS DISTINCT FROM t.restaurant_id;
  IF v_mismatch > 0 THEN RAISE EXCEPTION 'Phase 2 abort: table_reservations mismatch=%', v_mismatch; END IF;

  SELECT count(*) INTO v_mismatch
  FROM public.menu_items mi JOIN public.menu_categories c ON c.id = mi.category_id
  WHERE mi.restaurant_id IS DISTINCT FROM c.restaurant_id;
  IF v_mismatch > 0 THEN RAISE EXCEPTION 'Phase 2 abort: menu_items mismatch=%', v_mismatch; END IF;

  IF EXISTS (
    SELECT 1
    FROM public.restaurant_settings
    WHERE restaurant_id IS NOT NULL
      AND restaurant_id NOT IN (SELECT id FROM public.restaurants)
  ) THEN
    RAISE EXCEPTION 'Phase 2 abort: orphan restaurant_id';
  END IF;
END $$;

-- ============================================================
-- ROLLBACK (HIGH RISK — do not run after production backfill)
-- Drops tenant mapping. Does not restore deleted business rows,
-- but loses restaurant_id association for every backfilled row.
-- ============================================================
-- ALTER TABLE public.order_events DROP COLUMN IF EXISTS restaurant_id;
-- ALTER TABLE public.table_reservations DROP COLUMN IF EXISTS restaurant_id;
-- ALTER TABLE public.audit_logs DROP COLUMN IF EXISTS restaurant_id;
-- ALTER TABLE public.notifications DROP COLUMN IF EXISTS restaurant_id;
-- ALTER TABLE public.cash_sessions DROP COLUMN IF EXISTS restaurant_id;
-- ALTER TABLE public.payments DROP COLUMN IF EXISTS restaurant_id;
-- ALTER TABLE public.kitchen_tickets DROP COLUMN IF EXISTS restaurant_id;
-- ALTER TABLE public.order_items DROP COLUMN IF EXISTS restaurant_id;
-- ALTER TABLE public.orders DROP COLUMN IF EXISTS restaurant_id;
-- ALTER TABLE public.menu_items DROP COLUMN IF EXISTS restaurant_id;
-- ALTER TABLE public.menu_categories DROP COLUMN IF EXISTS restaurant_id;
-- ALTER TABLE public.restaurant_tables DROP COLUMN IF EXISTS restaurant_id;
-- ALTER TABLE public.restaurant_settings DROP COLUMN IF EXISTS restaurant_id;
