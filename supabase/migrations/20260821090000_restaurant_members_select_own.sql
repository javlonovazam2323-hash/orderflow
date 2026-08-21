-- restaurant_members SELECT: own rows only (stop cross-user roster leak).
-- Staff list remains manage-staff Edge Function (service_role).
-- Courier names use list_member_user_ids_for_roles (security definer).
-- Does not touch customer/order/payment/menu/table rows.

DROP POLICY IF EXISTS restaurant_members_select_same_restaurant ON public.restaurant_members;
DROP POLICY IF EXISTS restaurant_members_select_own ON public.restaurant_members;
DROP POLICY IF EXISTS restaurant_members_select_own_or_admin ON public.restaurant_members;
DROP POLICY IF EXISTS restaurant_members_select_admin_roster ON public.restaurant_members;

CREATE POLICY restaurant_members_select_own
  ON public.restaurant_members
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY restaurant_members_select_admin_roster
  ON public.restaurant_members
  FOR SELECT
  TO authenticated
  USING (public.is_restaurant_admin(restaurant_id));

CREATE OR REPLACE FUNCTION public.list_member_user_ids_for_roles(
  p_restaurant_id uuid,
  p_roles text[]
)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_restaurant_id IS NULL THEN
    RETURN ARRAY[]::uuid[];
  END IF;
  IF NOT public.is_restaurant_member(p_restaurant_id) THEN
    RETURN ARRAY[]::uuid[];
  END IF;
  RETURN ARRAY(
    SELECT m.user_id
    FROM public.restaurant_members m
    WHERE m.restaurant_id = p_restaurant_id
      AND m.is_active = true
      AND m.role::text = ANY (COALESCE(p_roles, ARRAY[]::text[]))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_member_user_ids_for_roles(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_member_user_ids_for_roles(uuid, text[]) TO authenticated, service_role;
