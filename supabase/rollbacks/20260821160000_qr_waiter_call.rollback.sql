-- Rollback QR waiter call. Restores phase-7 table_summaries. Drops guest RPCs and public_token.

DROP FUNCTION IF EXISTS public.guest_table_action(text, uuid, text);
DROP FUNCTION IF EXISTS public.guest_table_info(text, uuid);

DROP INDEX IF EXISTS public.notifications_guest_call_idx;
DROP INDEX IF EXISTS public.restaurant_tables_public_token_key;

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

GRANT SELECT ON public.table_summaries TO authenticated;

ALTER TABLE public.restaurant_tables DROP COLUMN IF EXISTS public_token;
