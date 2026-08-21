-- Phase 7: profiles RLS + storage tenant paths + invoker views restaurant_id.
--
-- STATUS: DO NOT APPLY TO PRODUCTION until explicit TASDIQ.
-- Does NOT start Phase 8. Does NOT DELETE/MOVE storage objects or customer data.
-- Does NOT change Phase 1–6 tenant RLS/RPCs except profiles, storage, views, needs_setup.
--
-- Authorization source remains restaurant_members (restaurant_id, user_id, role, is_active).
-- profiles.role is identity only — not used for tenant authorization.
-- Client restaurant_id is not an authorization source.
--
-- Existing menu-images stay public (old URLs keep working). Bucket is NOT made private.
-- Existing objects are NOT moved or deleted. New uploads use:
--   restaurants/{restaurant_id}/menu/{item_id}/{filename}
--   restaurants/{restaurant_id}/logos/{filename}

-- =============================================================================
-- 1. Tenant profile helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION public.shares_restaurant_with(target_user uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR target_user IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.restaurant_members me
    JOIN public.restaurant_members t
      ON t.restaurant_id = me.restaurant_id
    WHERE me.user_id = auth.uid()
      AND me.is_active = true
      AND t.user_id = target_user
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin_of_profile(target_user uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR target_user IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.restaurant_members me
    JOIN public.restaurant_members t
      ON t.restaurant_id = me.restaurant_id
    WHERE me.user_id = auth.uid()
      AND me.role = 'admin'
      AND me.is_active = true
      AND t.user_id = target_user
  );
END;
$$;

-- Storage write: tenant path restaurants/{rid}/menu|logos/...
-- Legacy path {menu_item_id}/... allowed only if that item belongs to a restaurant
-- the caller administers. 'new/' and other unscoped prefixes are blocked.
CREATE OR REPLACE FUNCTION public.menu_image_write_allowed(object_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  parts text[];
  rid uuid;
  item_id uuid;
BEGIN
  IF auth.uid() IS NULL OR object_name IS NULL OR length(object_name) = 0 THEN
    RETURN false;
  END IF;

  parts := storage.foldername(object_name);
  IF parts IS NULL OR array_length(parts, 1) IS NULL THEN
    RETURN false;
  END IF;

  IF parts[1] = 'restaurants' THEN
    IF array_length(parts, 1) < 3 THEN
      RETURN false;
    END IF;
    BEGIN
      rid := parts[2]::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN false;
    END;
    IF parts[3] NOT IN ('menu', 'logos') THEN
      RETURN false;
    END IF;
    RETURN public.is_restaurant_admin(rid);
  END IF;

  -- Legacy: {menu_item_id}/filename
  BEGIN
    item_id := parts[1]::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN false;
  END;

  SELECT mi.restaurant_id INTO rid
  FROM public.menu_items mi
  WHERE mi.id = item_id;

  IF rid IS NULL THEN
    RETURN false;
  END IF;
  RETURN public.is_restaurant_admin(rid);
END;
$$;

REVOKE ALL ON FUNCTION public.shares_restaurant_with(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_admin_of_profile(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.menu_image_write_allowed(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shares_restaurant_with(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin_of_profile(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.menu_image_write_allowed(text) TO authenticated, service_role;

-- =============================================================================
-- 2. Profiles RLS — own row + same-restaurant members; admin mutate same tenant
-- =============================================================================

DROP POLICY IF EXISTS profiles_select ON public.profiles;
DROP POLICY IF EXISTS profiles_admin_all ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
DROP POLICY IF EXISTS profiles_select_own_or_member ON public.profiles;
DROP POLICY IF EXISTS profiles_admin_update ON public.profiles;
DROP POLICY IF EXISTS profiles_admin_delete ON public.profiles;

CREATE POLICY profiles_select_own_or_member ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.shares_restaurant_with(id));

CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY profiles_admin_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_admin_of_profile(id))
  WITH CHECK (public.is_admin_of_profile(id));

-- INSERT/DELETE remain service_role only (Edge Functions). No authenticated INSERT/DELETE.

-- Same-restaurant roster (couriers / colleague names). Still tenant-scoped.
DROP POLICY IF EXISTS restaurant_members_select_own_or_admin ON public.restaurant_members;
DROP POLICY IF EXISTS restaurant_members_select_same_restaurant ON public.restaurant_members;
CREATE POLICY restaurant_members_select_same_restaurant ON public.restaurant_members
  FOR SELECT TO authenticated
  USING (public.is_restaurant_member(restaurant_id));

-- =============================================================================
-- 3. Storage menu-images — keep public read; tenant-aware writes
-- =============================================================================

DROP POLICY IF EXISTS menu_images_admin_upload ON storage.objects;
DROP POLICY IF EXISTS menu_images_admin_update ON storage.objects;
DROP POLICY IF EXISTS menu_images_admin_delete ON storage.objects;
DROP POLICY IF EXISTS menu_images_tenant_upload ON storage.objects;
DROP POLICY IF EXISTS menu_images_tenant_update ON storage.objects;
DROP POLICY IF EXISTS menu_images_tenant_delete ON storage.objects;

-- Public SELECT kept so existing production URLs continue to render.
-- Do NOT make the bucket private in this phase.

CREATE POLICY menu_images_tenant_upload ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'menu-images'
    AND public.menu_image_write_allowed(name)
  );

CREATE POLICY menu_images_tenant_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'menu-images'
    AND public.menu_image_write_allowed(name)
  )
  WITH CHECK (
    bucket_id = 'menu-images'
    AND public.menu_image_write_allowed(name)
  );

CREATE POLICY menu_images_tenant_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'menu-images'
    AND public.menu_image_write_allowed(name)
  );

-- =============================================================================
-- 4. Views — keep security_invoker; expose restaurant_id for client filters
-- =============================================================================

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

DROP VIEW IF EXISTS public.order_summaries;
CREATE VIEW public.order_summaries
WITH (security_invoker = true) AS
SELECT
  o.restaurant_id,
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

-- =============================================================================
-- 5. needs_setup — restaurant_members admin, not profiles.role
-- =============================================================================

CREATE OR REPLACE FUNCTION public.needs_setup()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.restaurant_members m
    WHERE m.role = 'admin'
      AND m.is_active = true
  );
$$;

GRANT EXECUTE ON FUNCTION public.needs_setup() TO anon, authenticated, service_role;

-- =============================================================================
-- 6. Legacy global helpers — KEEP bodies for rollback; REMOVE from auth path
-- =============================================================================
-- is_admin(), get_user_role(), is_cashier_or_admin() are no longer referenced
-- by any RLS policy or business RPC after this migration.
-- Revoke from authenticated so they cannot be used as an authorization source.

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_user_role() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_cashier_or_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO service_role;
GRANT EXECUTE ON FUNCTION public.is_cashier_or_admin() TO service_role;
