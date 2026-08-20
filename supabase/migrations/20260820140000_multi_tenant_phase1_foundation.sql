-- Phase 1: additive tenant foundation only.
-- Does not alter existing POS tables, RLS, RPCs, or unique constraints.
-- Do not apply automatically to production; apply after review.

-- ============================================================
-- restaurants
-- ============================================================

CREATE TABLE IF NOT EXISTS public.restaurants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  logo_url TEXT,
  phone TEXT,
  address TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT restaurants_slug_unique UNIQUE (slug),
  CONSTRAINT restaurants_slug_format CHECK (
    slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  )
);

CREATE TRIGGER trg_restaurants_updated
  BEFORE UPDATE ON public.restaurants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- restaurant_members
-- ============================================================

CREATE TABLE IF NOT EXISTS public.restaurant_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT restaurant_members_role_check CHECK (
    role IN ('admin', 'cashier', 'waiter', 'kitchen')
  ),
  CONSTRAINT restaurant_members_unique_user UNIQUE (restaurant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_members_user_id
  ON public.restaurant_members(user_id);
CREATE INDEX IF NOT EXISTS idx_restaurant_members_restaurant_id
  ON public.restaurant_members(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_restaurant_members_restaurant_role
  ON public.restaurant_members(restaurant_id, role);

CREATE TRIGGER trg_restaurant_members_updated
  BEFORE UPDATE ON public.restaurant_members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Membership helpers (SECURITY DEFINER, no RLS recursion)
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_restaurant_member(rid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR rid IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.restaurant_members m
    WHERE m.restaurant_id = rid
      AND m.user_id = auth.uid()
      AND m.is_active = true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_restaurant_admin(rid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR rid IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.restaurant_members m
    WHERE m.restaurant_id = rid
      AND m.user_id = auth.uid()
      AND m.role = 'admin'
      AND m.is_active = true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_restaurant_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_restaurant_admin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_restaurant_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_restaurant_admin(UUID) TO authenticated;

-- ============================================================
-- Default current restaurant (idempotent)
-- ============================================================

INSERT INTO public.restaurants (name, slug, logo_url, phone, address)
SELECT
  COALESCE(NULLIF(BTRIM(s.name), ''), 'OrderFlow'),
  'orderflow',
  s.logo_url,
  s.phone,
  s.address
FROM (SELECT 1) AS seed
LEFT JOIN LATERAL (
  SELECT name, logo_url, phone, address
  FROM public.restaurant_settings
  ORDER BY created_at ASC
  LIMIT 1
) s ON true
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Existing profiles → membership (profiles rows unchanged)
-- ============================================================

INSERT INTO public.restaurant_members (restaurant_id, user_id, role, is_active)
SELECT
  r.id,
  p.id,
  p.role::text,
  p.is_active
FROM public.restaurants r
JOIN public.profiles p ON p.role::text IN ('admin', 'cashier', 'waiter', 'kitchen')
WHERE r.slug = 'orderflow'
ON CONFLICT (restaurant_id, user_id) DO NOTHING;

-- ============================================================
-- RLS (new tables only)
-- ============================================================

ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_members ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.restaurants FROM PUBLIC;
REVOKE ALL ON TABLE public.restaurant_members FROM PUBLIC;
GRANT SELECT ON TABLE public.restaurants TO authenticated;
GRANT SELECT ON TABLE public.restaurant_members TO authenticated;

DROP POLICY IF EXISTS restaurants_select_member ON public.restaurants;
CREATE POLICY restaurants_select_member
  ON public.restaurants
  FOR SELECT
  TO authenticated
  USING (public.is_restaurant_member(id));

DROP POLICY IF EXISTS restaurant_members_select_own_or_admin ON public.restaurant_members;
CREATE POLICY restaurant_members_select_own_or_admin
  ON public.restaurant_members
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_restaurant_admin(restaurant_id)
  );

-- No INSERT/UPDATE/DELETE policies for authenticated/anon.
-- Writes stay service_role / future secure RPC only.

-- ============================================================
-- ROLLBACK (do not run with this migration)
-- ============================================================
-- DROP POLICY IF EXISTS restaurant_members_select_own_or_admin ON public.restaurant_members;
-- DROP POLICY IF EXISTS restaurants_select_member ON public.restaurants;
-- REVOKE ALL ON FUNCTION public.is_restaurant_admin(UUID) FROM PUBLIC, authenticated;
-- REVOKE ALL ON FUNCTION public.is_restaurant_member(UUID) FROM PUBLIC, authenticated;
-- DROP FUNCTION IF EXISTS public.is_restaurant_admin(UUID);
-- DROP FUNCTION IF EXISTS public.is_restaurant_member(UUID);
-- DROP TABLE IF EXISTS public.restaurant_members;
-- DROP TABLE IF EXISTS public.restaurants;
