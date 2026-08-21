-- ROLLBACK for Phase 7 profiles/storage/views hardening.
-- STATUS: Do not run unless Phase 7 was applied and must be reversed.
-- Restores pre-Phase-7 profiles RLS, storage write policies, views, needs_setup.
-- Does NOT undo Phase 1–6 schema, tenant RLS, or customer/business data.
-- Does NOT DELETE/TRUNCATE/MOVE storage objects or menu image files.

-- 1) Drop Phase 7 policies
DROP POLICY IF EXISTS profiles_select_own_or_member ON public.profiles;
DROP POLICY IF EXISTS profiles_admin_update ON public.profiles;
DROP POLICY IF EXISTS restaurant_members_select_same_restaurant ON public.restaurant_members;
DROP POLICY IF EXISTS menu_images_tenant_upload ON storage.objects;
DROP POLICY IF EXISTS menu_images_tenant_update ON storage.objects;
DROP POLICY IF EXISTS menu_images_tenant_delete ON storage.objects;

-- 2) Restore pre-Phase-7 profiles RLS (global is_admin)
DROP POLICY IF EXISTS profiles_select ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
DROP POLICY IF EXISTS profiles_admin_all ON public.profiles;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_cashier_or_admin() TO authenticated, service_role;

CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR is_admin());

CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY profiles_admin_all ON public.profiles
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS restaurant_members_select_own_or_admin ON public.restaurant_members;
CREATE POLICY restaurant_members_select_own_or_admin ON public.restaurant_members
  FOR SELECT TO authenticated
  USING ((user_id = auth.uid()) OR is_restaurant_admin(restaurant_id));

-- 3) Restore global storage write policies (public read was never dropped)
CREATE POLICY menu_images_admin_upload ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'menu-images' AND is_admin());

CREATE POLICY menu_images_admin_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'menu-images' AND is_admin());

CREATE POLICY menu_images_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'menu-images' AND is_admin());

-- 4) Restore views without restaurant_id (security_invoker kept)
DROP VIEW IF EXISTS public.table_summaries;
CREATE VIEW public.table_summaries
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

GRANT SELECT ON public.table_summaries TO authenticated;

DROP VIEW IF EXISTS public.order_summaries;
CREATE VIEW public.order_summaries
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

GRANT SELECT ON public.order_summaries TO authenticated;

-- 5) Restore needs_setup to profiles.role
CREATE OR REPLACE FUNCTION public.needs_setup()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM profiles WHERE role = 'admin' AND is_active = true
  );
$$;

GRANT EXECUTE ON FUNCTION public.needs_setup() TO anon, authenticated, service_role;

-- 6) Drop Phase 7 helpers
DROP FUNCTION IF EXISTS public.menu_image_write_allowed(text);
DROP FUNCTION IF EXISTS public.is_admin_of_profile(uuid);
DROP FUNCTION IF EXISTS public.shares_restaurant_with(uuid);
