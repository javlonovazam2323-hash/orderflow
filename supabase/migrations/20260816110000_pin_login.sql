-- PIN login: validates pin against profiles.pin_hash
-- Production note: use Supabase Edge Function for secure PIN auth + session creation.
-- This RPC is for profile lookup only; pair with Edge Function in production.

CREATE OR REPLACE FUNCTION verify_pin(p_pin TEXT)
RETURNS UUID AS $$
DECLARE
  v_profile_id UUID;
BEGIN
  -- pin_hash should store bcrypt hash; demo uses plain comparison via extension
  SELECT id INTO v_profile_id
  FROM profiles
  WHERE is_active = true
    AND pin_hash IS NOT NULL
    AND pin_hash = extensions.crypt(p_pin, pin_hash);

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Invalid PIN';
  END IF;

  RETURN v_profile_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

-- Alias for client API
CREATE OR REPLACE FUNCTION sign_in_with_pin(p_pin TEXT)
RETURNS UUID AS $$
  SELECT verify_pin(p_pin);
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, extensions;

-- Demo seed: set PIN 1234 for waiter (bcrypt hash of '1234')
-- UPDATE profiles SET pin_hash = crypt('1234', gen_salt('bf')) WHERE role = 'waiter';
