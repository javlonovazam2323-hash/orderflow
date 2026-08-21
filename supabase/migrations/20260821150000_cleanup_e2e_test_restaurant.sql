-- Production-safe E2E cleanup for throwaway ORDERFLOW_ONBOARDING_TEST* tenants only.
-- Does NOT re-apply Phase 1–8. Does NOT TRUNCATE. Does NOT touch other restaurants.
-- Extra-deny: name AND slug must match test markers before any DELETE.

CREATE OR REPLACE FUNCTION public.cleanup_e2e_test_restaurant(p_restaurant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_jwt_role text;
  v_name text;
  v_slug text;
  v_user_ids uuid[] := ARRAY[]::uuid[];
  v_protected uuid[] := ARRAY[
    '48cac438-0417-4a3a-9550-cad6123485bf'::uuid,
    'bfb5fd83-f78a-4f5a-8774-e5cbccb1342a'::uuid,
    '0c8037f5-4493-48de-a46d-6e689ff3209d'::uuid,
    '2a254de2-766c-47e5-942b-f6f57660fb3e'::uuid
  ];
  v_deleted int;
BEGIN
  v_uid := auth.uid();
  v_jwt_role := coalesce(auth.role(), '');

  IF v_uid IS NULL AND v_jwt_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Restaurant id required';
  END IF;

  SELECT r.name, r.slug INTO v_name, v_slug
  FROM public.restaurants r
  WHERE r.id = p_restaurant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Restaurant not found';
  END IF;

  IF v_name IS NULL
     OR v_slug IS NULL
     OR v_name NOT LIKE 'ORDERFLOW_ONBOARDING_TEST%'
     OR v_slug NOT LIKE 'orderflow-onboarding-test%' THEN
    RAISE EXCEPTION 'Refusing to delete restaurant that is not an E2E test tenant';
  END IF;

  IF v_jwt_role IS DISTINCT FROM 'service_role' THEN
    IF NOT public.is_restaurant_admin(p_restaurant_id) THEN
      RAISE EXCEPTION 'Permission denied';
    END IF;
  END IF;

  SELECT coalesce(array_agg(DISTINCT m.user_id), ARRAY[]::uuid[])
  INTO v_user_ids
  FROM public.restaurant_members m
  WHERE m.restaurant_id = p_restaurant_id
    AND m.user_id <> ALL (v_protected)
    AND NOT EXISTS (
      SELECT 1
      FROM public.restaurant_members o
      WHERE o.user_id = m.user_id
        AND o.restaurant_id IS DISTINCT FROM p_restaurant_id
    );

  UPDATE public.restaurant_tables
  SET current_order_id = NULL
  WHERE restaurant_id = p_restaurant_id;

  DELETE FROM public.order_events WHERE restaurant_id = p_restaurant_id;
  DELETE FROM public.notifications WHERE restaurant_id = p_restaurant_id;
  DELETE FROM public.payments WHERE restaurant_id = p_restaurant_id;
  DELETE FROM public.order_items WHERE restaurant_id = p_restaurant_id;
  DELETE FROM public.kitchen_tickets WHERE restaurant_id = p_restaurant_id;
  DELETE FROM public.orders WHERE restaurant_id = p_restaurant_id;
  DELETE FROM public.table_reservations WHERE restaurant_id = p_restaurant_id;
  DELETE FROM public.cash_sessions WHERE restaurant_id = p_restaurant_id;
  DELETE FROM public.audit_logs WHERE restaurant_id = p_restaurant_id;
  DELETE FROM public.menu_items WHERE restaurant_id = p_restaurant_id;
  DELETE FROM public.menu_categories WHERE restaurant_id = p_restaurant_id;
  DELETE FROM public.restaurant_tables WHERE restaurant_id = p_restaurant_id;
  DELETE FROM public.restaurant_settings WHERE restaurant_id = p_restaurant_id;
  DELETE FROM public.restaurant_order_counters WHERE restaurant_id = p_restaurant_id;
  DELETE FROM public.restaurant_members WHERE restaurant_id = p_restaurant_id;

  DELETE FROM public.restaurants
  WHERE id = p_restaurant_id
    AND name LIKE 'ORDERFLOW_ONBOARDING_TEST%'
    AND slug LIKE 'orderflow-onboarding-test%';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 1 THEN
    RAISE EXCEPTION 'Restaurant delete failed extra-deny';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'restaurant_id', p_restaurant_id,
    'user_ids_to_delete', to_jsonb(v_user_ids)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_e2e_test_restaurant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cleanup_e2e_test_restaurant(uuid)
  TO authenticated, service_role;
