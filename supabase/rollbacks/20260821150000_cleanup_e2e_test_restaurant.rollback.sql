-- ROLLBACK for cleanup_e2e_test_restaurant.
-- Drops the SQL RPC only. Does not undo Phase 1–8 or customer data.
--
-- Edge Function: delete `e2e-onboarding` from the Supabase project if deployed.
--   Dashboard → Edge Functions → e2e-onboarding → Delete
--   or: supabase functions delete e2e-onboarding
-- pin-login and bootstrap-staff must remain verify_jwt = false.

DROP FUNCTION IF EXISTS public.cleanup_e2e_test_restaurant(uuid);
