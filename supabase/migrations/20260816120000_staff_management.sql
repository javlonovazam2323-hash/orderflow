-- Staff management: PIN, setup check, table sync

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE OR REPLACE FUNCTION set_profile_pin(p_profile_id UUID, p_pin TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE profiles
  SET pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')), updated_at = now()
  WHERE id = p_profile_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

REVOKE ALL ON FUNCTION set_profile_pin(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_profile_pin(UUID, TEXT) TO service_role;

-- Admin: set/clear PIN from UI
CREATE OR REPLACE FUNCTION admin_set_profile_pin(p_profile_id UUID, p_pin TEXT)
RETURNS VOID AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF p_pin IS NULL OR length(trim(p_pin)) = 0 THEN
    UPDATE profiles SET pin_hash = NULL, updated_at = now() WHERE id = p_profile_id;
  ELSE
    UPDATE profiles
    SET pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')), updated_at = now()
    WHERE id = p_profile_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

GRANT EXECUTE ON FUNCTION admin_set_profile_pin(UUID, TEXT) TO authenticated;

-- First-time setup check (anon + authenticated)
CREATE OR REPLACE FUNCTION needs_setup()
RETURNS BOOLEAN AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM profiles WHERE role = 'admin' AND is_active = true
  );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION needs_setup() TO anon, authenticated;

-- Sync restaurant_tables count from settings (admin)
CREATE OR REPLACE FUNCTION sync_restaurant_tables()
RETURNS VOID AS $$
DECLARE
  v_count INT;
  v_max INT;
  i INT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT table_count INTO v_count FROM restaurant_settings LIMIT 1;
  IF v_count IS NULL OR v_count < 1 THEN
    v_count := 1;
  END IF;

  SELECT COALESCE(MAX(number), 0) INTO v_max FROM restaurant_tables;

  IF v_max < v_count THEN
    FOR i IN (v_max + 1)..v_count LOOP
      INSERT INTO restaurant_tables (number, status, capacity)
      VALUES (i, 'empty', 4)
      ON CONFLICT (number) DO NOTHING;
    END LOOP;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION sync_restaurant_tables() TO authenticated;
