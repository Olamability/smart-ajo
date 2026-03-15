-- ============================================================================
-- Migration: Enhanced Authentication Sync Robustness
-- ============================================================================
-- 1. Improves handle_new_auth_user to be more resilient to conflicts
-- 2. Updates check_user_exists RPC to return the user_id for better error recovery
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Improved handle_new_auth_user trigger function
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER AS $$
DECLARE
  v_phone     TEXT;
  v_full_name TEXT;
  v_count     INTEGER;
BEGIN
  -- Extract metadata with defaults
  v_phone := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'phone'), ''),
    'temp_' || SUBSTRING(NEW.id::TEXT, 1, 12)
  );

  v_full_name := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(SPLIT_PART(NEW.email, '@', 1), ''),
    'User'
  );

  -- Check if email or phone already exists in public.users for a DIFFERENT user id
  -- This prevents the trigger from failing due to unique constraints if the frontend 
  -- validation missed something or if there's a race condition.
  SELECT COUNT(*) INTO v_count 
  FROM public.users 
  WHERE (email = NEW.email OR phone = v_phone) 
    AND id != NEW.id;

  IF v_count > 0 THEN
    -- If there's a conflict, we skip the insert to avoid breaking the auth flow.
    -- The user will exist in auth.users but won't have a profile.
    -- The frontend should handle this by checking for profile existence and prompting.
    RAISE WARNING 'handle_new_auth_user: Conflict detected for email % or phone %. Profile creation skipped.', 
      NEW.email, v_phone;
    RETURN NEW;
  END IF;

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
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      phone = EXCLUDED.phone,
      full_name = EXCLUDED.full_name,
      updated_at = NOW();

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log unexpected errors without raising them so that auth user
    -- creation always succeeds even when the profile insert fails.
    RAISE WARNING 'handle_new_auth_user: could not create profile for user % (%): %',
      NEW.id, NEW.email, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

-- ----------------------------------------------------------------------------
-- 2. Improved check_user_exists RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_user_exists(
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_email_exists BOOLEAN := false;
  v_phone_exists BOOLEAN := false;
  v_user_id     UUID := NULL;
BEGIN
  IF p_email IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM users WHERE email = p_email) INTO v_email_exists;
    IF v_email_exists THEN
      SELECT id INTO v_user_id FROM users WHERE email = p_email LIMIT 1;
    END IF;
  END IF;
  
  IF p_phone IS NOT NULL AND v_user_id IS NULL THEN
    SELECT EXISTS(SELECT 1 FROM users WHERE phone = p_phone) INTO v_phone_exists;
    IF v_phone_exists THEN
      SELECT id INTO v_user_id FROM users WHERE phone = p_phone LIMIT 1;
    END IF;
  ELSIF p_phone IS NOT NULL THEN
    -- Just check if it exists if we already found a user by email
    SELECT EXISTS(SELECT 1 FROM users WHERE phone = p_phone) INTO v_phone_exists;
  END IF;
  
  RETURN json_build_object(
    'email_exists', v_email_exists,
    'phone_exists', v_phone_exists,
    'user_id', v_user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
