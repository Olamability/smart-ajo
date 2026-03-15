-- ============================================================================
-- Migration: Auto-create user profile on auth signup
-- ============================================================================
-- Creates a trigger on auth.users that automatically inserts a corresponding
-- row into public.users whenever a new Supabase Auth user is created.
--
-- Design decisions:
--   • ON CONFLICT (id) DO NOTHING  — idempotent; never overwrites existing data
--   • SECURITY DEFINER             — executes as the function owner to bypass RLS
--   • search_path = public, auth   — explicit schema resolution for safety
--   • EXCEPTION … RAISE WARNING    — errors are logged but never block auth signup
--   • phone fallback               — uses temp_<uuid-prefix> when phone is absent
--     from auth metadata (real phone is set later via profile update)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- FUNCTION: handle_new_auth_user
-- Fires after each INSERT on auth.users and creates the matching public.users
-- row from the new auth record's metadata.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER AS $$
DECLARE
  v_phone     TEXT;
  v_full_name TEXT;
BEGIN
  -- Derive phone: prefer metadata value; fall back to a deterministic
  -- temporary placeholder so the NOT NULL constraint is satisfied.
  v_phone := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'phone'), ''),
    'temp_' || SUBSTRING(NEW.id::TEXT, 1, 12)
  );

  -- Derive full name: prefer metadata value; fall back to the email
  -- prefix or the generic string 'User'.
  v_full_name := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(SPLIT_PART(NEW.email, '@', 1), ''),
    'User'
  );

  -- Insert the user profile row.  ON CONFLICT DO NOTHING keeps this
  -- function idempotent: if the profile was already created (e.g. by the
  -- create_user_profile_atomic RPC), the trigger becomes a no-op.
  INSERT INTO public.users (
    id,
    email,
    phone,
    full_name,
    is_verified,
    is_active,
    is_admin,
    kyc_status,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    v_phone,
    v_full_name,
    FALSE,
    TRUE,
    FALSE,
    'not_started',
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
EXCEPTION
  WHEN unique_violation THEN
    -- Profile already exists (created concurrently, e.g. by the RPC).
    -- ON CONFLICT DO NOTHING should prevent this branch from ever being
    -- reached, but guard it explicitly for safety.
    RETURN NEW;
  WHEN OTHERS THEN
    -- Log unexpected errors without raising them so that auth user
    -- creation always succeeds even when the profile insert fails.
    RAISE WARNING 'handle_new_auth_user: could not create profile for user % (%): %',
      NEW.id, NEW.email, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

-- ----------------------------------------------------------------------------
-- TRIGGER: on_auth_user_created
-- Attaches handle_new_auth_user() to the auth.users table.
-- DROP … IF EXISTS ensures the migration is re-runnable (idempotent).
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();
