-- Recreate summary views as security_invoker so underlying table RLS applies.
-- Column list and query are unchanged.
-- PostgreSQL 15+ / current Supabase. Do not apply automatically to production.

DROP VIEW IF EXISTS table_summaries;
CREATE VIEW table_summaries
WITH (security_invoker = true) AS
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

DROP VIEW IF EXISTS order_summaries;
CREATE VIEW order_summaries
WITH (security_invoker = true) AS
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

GRANT SELECT ON order_summaries TO authenticated;
