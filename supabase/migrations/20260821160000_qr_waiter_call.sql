-- QR waiter call: public_token on tables + guest RPCs (token+slug only).
-- Guest cannot SELECT orders/payments/profiles. Waiter resolved from current_order_id.
-- notifications.type stays 'system'; data.action = waiter_call | bill_request
-- (enum ADD VALUE cannot be used in the same transaction on Postgres).

-- 1. Unguessable public token (globally unique, not table number)
ALTER TABLE public.restaurant_tables
  ADD COLUMN IF NOT EXISTS public_token uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS restaurant_tables_public_token_key
  ON public.restaurant_tables (public_token);

CREATE INDEX IF NOT EXISTS notifications_guest_call_idx
  ON public.notifications (restaurant_id, created_at DESC)
  WHERE type = 'system' AND (data ? 'action');

-- 2. table_summaries — token + pending guest call (staff UI only)
DROP VIEW IF EXISTS public.table_summaries;
CREATE VIEW public.table_summaries
WITH (security_invoker = true) AS
SELECT
  t.restaurant_id,
  t.id,
  t.number,
  t.name,
  t.status,
  t.capacity,
  t.zone,
  t.is_active,
  t.current_order_id,
  t.public_token,
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
  r.notes AS reservation_notes,
  gc.pending_guest_call_action,
  gc.pending_guest_call_waiter_id,
  gc.pending_guest_call_at
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
) r ON true
LEFT JOIN LATERAL (
  SELECT
    n.data->>'action' AS pending_guest_call_action,
    n.user_id AS pending_guest_call_waiter_id,
    n.created_at AS pending_guest_call_at
  FROM notifications n
  WHERE n.restaurant_id = t.restaurant_id
    AND n.is_read = false
    AND n.type = 'system'
    AND n.data->>'action' IN ('waiter_call', 'bill_request')
    AND n.data->>'table_id' = t.id::text
  ORDER BY n.created_at DESC
  LIMIT 1
) gc ON true;

GRANT SELECT ON public.table_summaries TO authenticated;

-- 3. Guest info (anon). No order totals, emails, phones, waiter ids.
CREATE OR REPLACE FUNCTION public.guest_table_info(p_slug text, p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table_id uuid;
  v_restaurant_id uuid;
  v_table_number int;
  v_restaurant_name text;
  v_logo text;
  v_waiter_name text;
  v_waiter_avatar text;
  v_has_waiter boolean := false;
  v_order_id uuid;
  v_waiter_id uuid;
  v_pending jsonb;
BEGIN
  IF p_token IS NULL OR NULLIF(trim(p_slug), '') IS NULL THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  SELECT t.id, t.restaurant_id, t.number, r.name, s.logo_url
  INTO v_table_id, v_restaurant_id, v_table_number, v_restaurant_name, v_logo
  FROM restaurant_tables t
  JOIN restaurants r ON r.id = t.restaurant_id
  LEFT JOIN restaurant_settings s ON s.restaurant_id = r.id
  WHERE t.public_token = p_token
    AND r.slug = lower(trim(p_slug))
    AND t.is_active = true;

  IF v_table_id IS NULL THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  SELECT o.id, o.waiter_id, p.full_name, p.avatar_url
  INTO v_order_id, v_waiter_id, v_waiter_name, v_waiter_avatar
  FROM restaurant_tables t
  JOIN orders o ON o.id = t.current_order_id AND o.restaurant_id = t.restaurant_id
  JOIN restaurant_members m ON m.restaurant_id = t.restaurant_id
    AND m.user_id = o.waiter_id AND m.is_active = true
  JOIN profiles p ON p.id = o.waiter_id
  WHERE t.id = v_table_id
    AND o.status IN ('draft', 'open', 'awaiting_payment');

  v_has_waiter := v_waiter_id IS NOT NULL;

  SELECT jsonb_build_object(
    'id', n.id,
    'action', n.data->>'action',
    'status', CASE WHEN n.is_read THEN 'acknowledged' ELSE 'pending' END
  )
  INTO v_pending
  FROM notifications n
  WHERE n.restaurant_id = v_restaurant_id
    AND n.type = 'system'
    AND n.data->>'table_id' = v_table_id::text
    AND n.data->>'action' IN ('waiter_call', 'bill_request')
  ORDER BY n.created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'restaurant_name', v_restaurant_name,
    'restaurant_logo_url', v_logo,
    'table_number', v_table_number,
    'has_waiter', v_has_waiter,
    'waiter_name', CASE WHEN v_has_waiter THEN v_waiter_name ELSE NULL END,
    'waiter_avatar_url', CASE WHEN v_has_waiter THEN v_waiter_avatar ELSE NULL END,
    'pending_call', v_pending
  );
END;
$$;

-- 4. Guest action: server resolves table/order/waiter. No client waiter_id.
CREATE OR REPLACE FUNCTION public.guest_table_action(p_slug text, p_token uuid, p_action text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table_id uuid;
  v_restaurant_id uuid;
  v_table_number int;
  v_order_id uuid;
  v_waiter_id uuid;
  v_title text;
  v_body text;
  v_notification_id uuid;
  v_recent int;
BEGIN
  IF p_action NOT IN ('waiter_call', 'bill_request') THEN
    RAISE EXCEPTION 'invalid_action';
  END IF;
  IF p_token IS NULL OR NULLIF(trim(p_slug), '') IS NULL THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  SELECT t.id, t.restaurant_id, t.number
  INTO v_table_id, v_restaurant_id, v_table_number
  FROM restaurant_tables t
  JOIN restaurants r ON r.id = t.restaurant_id
  WHERE t.public_token = p_token
    AND r.slug = lower(trim(p_slug))
    AND t.is_active = true;

  IF v_table_id IS NULL THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  SELECT o.id, o.waiter_id
  INTO v_order_id, v_waiter_id
  FROM restaurant_tables t
  JOIN orders o ON o.id = t.current_order_id AND o.restaurant_id = t.restaurant_id
  JOIN restaurant_members m ON m.restaurant_id = t.restaurant_id
    AND m.user_id = o.waiter_id AND m.is_active = true
  WHERE t.id = v_table_id
    AND o.status IN ('draft', 'open', 'awaiting_payment');

  IF v_waiter_id IS NULL THEN
    RAISE EXCEPTION 'no_waiter';
  END IF;

  SELECT count(*) INTO v_recent
  FROM notifications n
  WHERE n.restaurant_id = v_restaurant_id
    AND n.type = 'system'
    AND n.data->>'table_id' = v_table_id::text
    AND n.data->>'action' = p_action
    AND n.created_at > now() - interval '45 seconds';

  IF v_recent > 0 THEN
    RAISE EXCEPTION 'rate_limited';
  END IF;

  IF p_action = 'bill_request' THEN
    v_title := 'Stol №' || v_table_number::text;
    v_body := 'Stol №' || v_table_number::text || ' hisob so‘radi';
  ELSE
    v_title := 'Stol №' || v_table_number::text;
    v_body := 'Stol №' || v_table_number::text || ' sizni chaqiryapti';
  END IF;

  INSERT INTO notifications (user_id, type, title, body, data, restaurant_id, is_read)
  VALUES (
    v_waiter_id,
    'system',
    v_title,
    v_body,
    jsonb_build_object(
      'action', p_action,
      'table_id', v_table_id,
      'order_id', v_order_id,
      'table_number', v_table_number,
      'restaurant_id', v_restaurant_id
    ),
    v_restaurant_id,
    false
  )
  RETURNING id INTO v_notification_id;

  RETURN jsonb_build_object(
    'ok', true,
    'notification_id', v_notification_id,
    'action', p_action
  );
END;
$$;

REVOKE ALL ON FUNCTION public.guest_table_info(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guest_table_action(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_table_info(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_table_action(text, uuid, text) TO anon, authenticated;
