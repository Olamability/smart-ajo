-- ============================================================================
-- SECURED-AJO UTILITY FUNCTIONS
-- ============================================================================
-- This file contains utility functions for business logic, calculations,
-- and automation in the Secured-Ajo platform.
--
-- IMPORTANT: Run this file AFTER schema.sql has been executed.
-- ============================================================================

-- ============================================================================
-- FUNCTION: update_updated_at_column
-- ============================================================================
-- Trigger function to automatically update updated_at timestamp
-- Used across multiple tables to track when records are modified
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_updated_at_column IS 
  'Trigger function that automatically updates the updated_at column to current timestamp';

-- ============================================================================
-- FUNCTION: create_user_profile_atomic
-- ============================================================================
-- Atomically creates a user profile in the users table
-- This ensures the profile is created exactly once, handling race conditions
-- Returns success status and error message if any
-- ============================================================================

CREATE OR REPLACE FUNCTION create_user_profile_atomic(
  p_user_id UUID,
  p_email VARCHAR(255),
  p_phone VARCHAR(20),
  p_full_name VARCHAR(255)
)
RETURNS TABLE(success BOOLEAN, user_id UUID, error_message TEXT) AS $$
DECLARE
  v_existing_email_user UUID;
  v_existing_phone_user UUID;
BEGIN
  -- Check for existing email
  SELECT id INTO v_existing_email_user
  FROM users
  WHERE email = p_email AND id != p_user_id
  LIMIT 1;
  
  IF v_existing_email_user IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Email is already registered'::TEXT;
    RETURN; -- Exit function early after returning error
  END IF;
  
  -- Check for existing phone
  SELECT id INTO v_existing_phone_user
  FROM users
  WHERE phone = p_phone AND id != p_user_id
  LIMIT 1;
  
  IF v_existing_phone_user IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Phone number is already registered'::TEXT;
    RETURN; -- Exit function early after returning error
  END IF;
  
  -- Attempt to insert user profile
  -- ON CONFLICT ensures we don't create duplicates
  INSERT INTO users (id, email, phone, full_name, is_verified, is_active, kyc_status)
  VALUES (p_user_id, p_email, p_phone, p_full_name, FALSE, TRUE, 'not_started')
  ON CONFLICT (id) DO NOTHING;
  
  -- Check if the user now exists (either just created or already existed)
  IF EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
    RETURN QUERY SELECT TRUE, p_user_id, NULL::TEXT;
  ELSE
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Failed to create user profile'::TEXT;
  END IF;
  
EXCEPTION WHEN OTHERS THEN
  -- Catch any errors and return them with better messages
  -- Provide user-friendly error messages for common constraint violations
  IF SQLERRM LIKE '%users_email_key%' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Email is already registered'::TEXT;
  ELSIF SQLERRM LIKE '%users_phone_key%' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Phone number is already registered'::TEXT;
  ELSE
    RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION create_user_profile_atomic IS 
  'Atomically creates a user profile, handling race conditions and returning status';

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION create_user_profile_atomic TO authenticated;

-- ============================================================================
-- FUNCTION: check_user_exists
-- ============================================================================
-- Checks if a user with the given email or phone already exists
-- Returns information about conflicts to help with validation
-- This is a public function (no authentication required) for pre-signup validation
-- ============================================================================

CREATE OR REPLACE FUNCTION check_user_exists(
  p_email VARCHAR(255) DEFAULT NULL,
  p_phone VARCHAR(20) DEFAULT NULL
)
RETURNS TABLE(
  email_exists BOOLEAN,
  phone_exists BOOLEAN,
  user_id UUID
) AS $$
DECLARE
  v_email_user_id UUID;
  v_phone_user_id UUID;
BEGIN
  -- Check if email exists
  IF p_email IS NOT NULL THEN
    SELECT id INTO v_email_user_id
    FROM users
    WHERE email = p_email
    LIMIT 1;
  END IF;
  
  -- Check if phone exists
  IF p_phone IS NOT NULL THEN
    SELECT id INTO v_phone_user_id
    FROM users
    WHERE phone = p_phone
    LIMIT 1;
  END IF;
  
  -- Return results
  -- Note: If email and phone belong to different users, both flags can be true
  -- The user_id returns the conflicting user ID (email takes precedence if both exist)
  RETURN QUERY SELECT 
    v_email_user_id IS NOT NULL,
    v_phone_user_id IS NOT NULL,
    COALESCE(v_email_user_id, v_phone_user_id); -- Return email ID first, fallback to phone ID
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION check_user_exists IS 
  'Checks if a user exists with given email or phone. Public function for pre-signup validation.';

-- Grant execute permission to anon users (for signup validation)
GRANT EXECUTE ON FUNCTION check_user_exists TO anon, authenticated;

-- ============================================================================
-- FUNCTION: create_user_profile
-- ============================================================================
-- Creates a user profile in the users table with input validation
-- Alternative to create_user_profile_atomic for simpler use cases
-- ============================================================================

CREATE OR REPLACE FUNCTION create_user_profile(
  p_user_id UUID,
  p_email VARCHAR(255),
  p_phone VARCHAR(20),
  p_full_name VARCHAR(255)
)
RETURNS UUID AS $$
BEGIN
  -- Input validation
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id cannot be NULL';
  END IF;
  
  IF p_email IS NULL OR p_email = '' THEN
    RAISE EXCEPTION 'email cannot be NULL or empty';
  END IF;
  
  IF p_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid email format: %', p_email;
  END IF;
  
  IF p_phone IS NULL OR p_phone = '' THEN
    RAISE EXCEPTION 'phone cannot be NULL or empty';
  END IF;
  
  IF p_full_name IS NULL OR p_full_name = '' THEN
    RAISE EXCEPTION 'full_name cannot be NULL or empty';
  END IF;

  INSERT INTO public.users (
    id,
    email,
    phone,
    full_name,
    is_verified,
    is_active,
    kyc_status
  ) VALUES (
    p_user_id,
    p_email,
    p_phone,
    p_full_name,
    FALSE,
    TRUE,
    'not_started'
  )
  ON CONFLICT (id) DO NOTHING;
  
  RETURN p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION create_user_profile IS 
  'Creates a user profile in public.users with input validation. 
   Called from client-side during signup.
   Note: Cannot use trigger on auth.users in Supabase due to permission restrictions.';

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION create_user_profile TO authenticated;

-- ============================================================================
-- FUNCTION: calculate_next_payout_recipient
-- ============================================================================
-- Determines the next user to receive payout in a group based on position
-- Returns the user_id of the next recipient
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_next_payout_recipient(p_group_id UUID)
RETURNS UUID AS $$
DECLARE
  v_next_cycle INTEGER;
  v_recipient_id UUID;
BEGIN
  -- Get the next cycle number (current + 1)
  SELECT current_cycle + 1 INTO v_next_cycle
  FROM groups
  WHERE id = p_group_id;
  
  -- Get the user at the position matching the next cycle
  SELECT user_id INTO v_recipient_id
  FROM group_members
  WHERE group_id = p_group_id
    AND position = v_next_cycle
    AND status = 'active'
  LIMIT 1;
  
  RETURN v_recipient_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_next_payout_recipient IS 
  'Returns the user_id of the next payout recipient based on rotation position';

-- ============================================================================
-- FUNCTION: is_cycle_complete
-- ============================================================================
-- Checks if all contributions for a given cycle have been paid
-- Returns TRUE if cycle is complete, FALSE otherwise
-- ============================================================================

CREATE OR REPLACE FUNCTION is_cycle_complete(p_group_id UUID, p_cycle_number INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
  v_total_members INTEGER;
  v_paid_count INTEGER;
BEGIN
  -- Get total members
  SELECT total_members INTO v_total_members
  FROM groups
  WHERE id = p_group_id;
  
  -- Count paid contributions for this cycle
  SELECT COUNT(*) INTO v_paid_count
  FROM contributions
  WHERE group_id = p_group_id
    AND cycle_number = p_cycle_number
    AND status = 'paid';
  
  -- Return true if all members have paid
  RETURN v_paid_count >= v_total_members;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION is_cycle_complete IS 
  'Checks if all members have paid their contributions for a given cycle';

-- ============================================================================
-- FUNCTION: calculate_payout_amount
-- ============================================================================
-- Calculates the payout amount after deducting service fees
-- Service fee is deducted MONTHLY at payout time, not from contributions
-- This ensures the service fee is taken once per cycle when the member receives payout
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_payout_amount(
  p_group_id UUID,
  p_cycle_number INTEGER
)
RETURNS DECIMAL(15, 2) AS $$
DECLARE
  v_contribution_amount DECIMAL(15, 2);
  v_total_members INTEGER;
  v_service_fee_percentage DECIMAL(5, 2);
  v_total_collected DECIMAL(15, 2);
  v_total_fees DECIMAL(15, 2);
  v_payout_amount DECIMAL(15, 2);
BEGIN
  -- Get group details
  SELECT 
    contribution_amount,
    total_members,
    service_fee_percentage
  INTO 
    v_contribution_amount,
    v_total_members,
    v_service_fee_percentage
  FROM groups
  WHERE id = p_group_id;
  
  -- Calculate total collected
  v_total_collected := v_contribution_amount * v_total_members;
  
  -- Calculate total service fees
  v_total_fees := v_total_collected * (v_service_fee_percentage / 100);
  
  -- Calculate payout amount (total - fees)
  v_payout_amount := v_total_collected - v_total_fees;
  
  RETURN v_payout_amount;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_payout_amount IS 
  'Calculates payout amount after deducting service fees';

-- ============================================================================
-- FUNCTION: calculate_late_penalty
-- ============================================================================
-- Calculates penalty amount based on days late and group rules
-- Default: 5% of contribution amount per day late (max 50%)
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_late_penalty(
  p_contribution_id UUID,
  p_days_late INTEGER DEFAULT NULL
)
RETURNS DECIMAL(15, 2) AS $$
DECLARE
  v_contribution_amount DECIMAL(15, 2);
  v_days_overdue INTEGER;
  v_penalty_rate DECIMAL(5, 2) := 5.00; -- 5% per day
  v_max_penalty_rate DECIMAL(5, 2) := 50.00; -- Max 50%
  v_penalty_amount DECIMAL(15, 2);
BEGIN
  -- Get contribution details
  SELECT 
    amount,
    COALESCE(p_days_late, EXTRACT(DAY FROM (NOW() - due_date))::INTEGER)
  INTO 
    v_contribution_amount,
    v_days_overdue
  FROM contributions
  WHERE id = p_contribution_id;
  
  -- Calculate penalty (5% per day, max 50%)
  v_penalty_amount := v_contribution_amount * 
    LEAST(v_days_overdue * v_penalty_rate, v_max_penalty_rate) / 100;
  
  RETURN ROUND(v_penalty_amount, 2);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_late_penalty IS 
  'Calculates penalty for late payment (5% per day, max 50% of contribution)';

-- ============================================================================
-- FUNCTION: generate_payment_reference
-- ============================================================================
-- Generates a unique payment reference for transactions
-- Format: AJO-{TYPE}-{TIMESTAMP}-{RANDOM}
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_payment_reference(p_type VARCHAR(20) DEFAULT 'TXN')
RETURNS VARCHAR(100) AS $$
DECLARE
  v_timestamp VARCHAR(20);
  v_random VARCHAR(8);
  v_reference VARCHAR(100);
BEGIN
  -- Get timestamp (YYYYMMDDHHMMSS)
  v_timestamp := TO_CHAR(NOW(), 'YYYYMMDDHH24MISS');
  
  -- Generate random alphanumeric string
  v_random := UPPER(SUBSTRING(MD5(RANDOM()::TEXT), 1, 8));
  
  -- Construct reference
  v_reference := 'AJO-' || UPPER(p_type) || '-' || v_timestamp || '-' || v_random;
  
  RETURN v_reference;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_payment_reference IS 
  'Generates unique payment reference in format AJO-TYPE-TIMESTAMP-RANDOM';

-- ============================================================================
-- FUNCTION: process_cycle_completion
-- ============================================================================
-- Processes the completion of a cycle: creates payout, advances cycle
-- Called automatically or manually when all contributions are paid
-- ============================================================================

CREATE OR REPLACE FUNCTION process_cycle_completion(p_group_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_current_cycle INTEGER;
  v_total_cycles INTEGER;
  v_recipient_id UUID;
  v_payout_amount DECIMAL(15, 2);
  v_payout_id UUID;
  v_result JSONB;
BEGIN
  -- Get current cycle info
  SELECT current_cycle, total_cycles 
  INTO v_current_cycle, v_total_cycles
  FROM groups
  WHERE id = p_group_id;
  
  -- Check if cycle is actually complete
  IF NOT is_cycle_complete(p_group_id, v_current_cycle) THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Cycle is not complete yet',
      'cycle', v_current_cycle
    );
  END IF;
  
  -- Get recipient for this cycle
  SELECT user_id INTO v_recipient_id
  FROM group_members
  WHERE group_id = p_group_id
    AND position = v_current_cycle
  LIMIT 1;
  
  -- Calculate payout amount
  v_payout_amount := calculate_payout_amount(p_group_id, v_current_cycle);
  
  -- Create or update payout record
  INSERT INTO payouts (
    related_group_id,
    cycle_number,
    recipient_id,
    amount,
    status
  ) VALUES (
    p_group_id,
    v_current_cycle,
    v_recipient_id,
    v_payout_amount,
    'pending'
  )
  ON CONFLICT (related_group_id, cycle_number)
  DO UPDATE SET
    status = 'pending',
    amount = v_payout_amount,
    updated_at = NOW()
  RETURNING id INTO v_payout_id;
  
  -- Create notification for recipient
  INSERT INTO notifications (
    user_id,
    type,
    title,
    message,
    related_group_id
  ) VALUES (
    v_recipient_id,
    'payout_received',
    'Payout Ready!',
    'Your payout for cycle ' || v_current_cycle || ' is ready for processing.',
    p_group_id
  );
  
  -- Advance to next cycle or complete group
  IF v_current_cycle >= v_total_cycles THEN
    -- Group is complete
    UPDATE groups
    SET status = 'completed',
        updated_at = NOW()
    WHERE id = p_group_id;
    
    v_result := jsonb_build_object(
      'success', true,
      'message', 'Group completed',
      'cycle', v_current_cycle,
      'payout_id', v_payout_id,
      'group_status', 'completed'
    );
  ELSE
    -- Move to next cycle
    UPDATE groups
    SET current_cycle = current_cycle + 1,
        updated_at = NOW()
    WHERE id = p_group_id;
    
    -- Create contributions for next cycle
    PERFORM create_cycle_contributions(p_group_id, v_current_cycle + 1);
    
    v_result := jsonb_build_object(
      'success', true,
      'message', 'Cycle completed, moved to next cycle',
      'cycle', v_current_cycle,
      'next_cycle', v_current_cycle + 1,
      'payout_id', v_payout_id
    );
  END IF;
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION process_cycle_completion IS 
  'Processes cycle completion: creates payout, advances cycle, or completes group';

-- ============================================================================
-- FUNCTION: create_cycle_contributions
-- ============================================================================
-- Creates contribution records for all members in a specific cycle
-- Sets due dates based on group frequency
-- ============================================================================

CREATE OR REPLACE FUNCTION create_cycle_contributions(
  p_group_id UUID,
  p_cycle_number INTEGER
)
RETURNS INTEGER AS $$
DECLARE
  v_contribution_amount DECIMAL(15, 2);
  v_frequency VARCHAR(20);
  v_start_date TIMESTAMPTZ;
  v_due_date TIMESTAMPTZ;
  v_count INTEGER := 0;
BEGIN
  -- Get group details
  SELECT 
    contribution_amount,
    frequency,
    start_date
  INTO 
    v_contribution_amount,
    v_frequency,
    v_start_date
  FROM groups
  WHERE id = p_group_id;
  
  -- Calculate due date based on frequency and cycle
  v_due_date := CASE v_frequency
    WHEN 'daily' THEN v_start_date + ((p_cycle_number - 1) * INTERVAL '1 day')
    WHEN 'weekly' THEN v_start_date + ((p_cycle_number - 1) * INTERVAL '1 week')
    WHEN 'monthly' THEN v_start_date + ((p_cycle_number - 1) * INTERVAL '1 month')
    ELSE v_start_date + ((p_cycle_number - 1) * INTERVAL '1 month')
  END;
  
  -- Create contribution record for each active member
  -- Service fee is NOT included in contributions anymore
  -- It will be deducted from the payout at the end of each cycle
  INSERT INTO contributions (
    group_id,
    user_id,
    cycle_number,
    amount,
    service_fee,
    due_date,
    status
  )
  SELECT 
    p_group_id,
    user_id,
    p_cycle_number,
    v_contribution_amount,
    0, -- Service fee set to 0, will be deducted from payout
    v_due_date,
    'pending'
  FROM group_members
  WHERE group_id = p_group_id
    AND status = 'active';
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  
  -- Create notifications for all members
  INSERT INTO notifications (
    user_id,
    type,
    title,
    message,
    related_group_id
  )
  SELECT 
    user_id,
    'contribution_due',
    'Payment Due',
    'Your contribution for cycle ' || p_cycle_number || ' is due on ' || 
      TO_CHAR(v_due_date, 'Mon DD, YYYY'),
    p_group_id
  FROM group_members
  WHERE group_id = p_group_id
    AND status = 'active';
  
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_cycle_contributions IS 
  'Creates contribution records for all active members in a cycle. Service fee is deducted from payout, not from contributions.';

-- ============================================================================
-- FUNCTION: apply_late_penalties
-- ============================================================================
-- Applies penalties to all overdue contributions
-- Returns count of penalties applied
-- ============================================================================

CREATE OR REPLACE FUNCTION apply_late_penalties()
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER := 0;
  v_contribution RECORD;
  v_penalty_amount DECIMAL(15, 2);
BEGIN
  -- Loop through overdue contributions without existing late-payment penalties
  FOR v_contribution IN
    SELECT 
      c.id,
      c.group_id,
      c.user_id,
      c.amount,
      EXTRACT(DAY FROM (NOW() - c.due_date))::INTEGER AS days_overdue
    FROM contributions c
    WHERE c.status = 'pending'
      AND c.due_date < NOW()
      AND NOT EXISTS (
        SELECT 1
        FROM penalties p
        WHERE p.contribution_id = c.id
          AND p.type = 'late_payment'
      )
  LOOP
    -- Calculate penalty amount
    v_penalty_amount :=
      calculate_late_penalty(v_contribution.id, v_contribution.days_overdue);

    -- Insert penalty
    INSERT INTO penalties (
      group_id,
      user_id,
      contribution_id,
      amount,
      type,
      reason,
      status
    ) VALUES (
      v_contribution.group_id,
      v_contribution.user_id,
      v_contribution.id,
      v_penalty_amount,
      'late_payment',
      'Late payment - ' || v_contribution.days_overdue || ' days overdue',
      'applied'
    );

    -- Notify user
    INSERT INTO notifications (
      user_id,
      type,
      title,
      message,
      related_group_id
    ) VALUES (
      v_contribution.user_id,
      'penalty_applied',
      'Late Payment Penalty',
      'A penalty of ₦' || v_penalty_amount || ' has been applied for late payment.',
      v_contribution.group_id
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION apply_late_penalties IS
'Automatically applies late-payment penalties to overdue contributions';

-- ============================================================================
-- FUNCTION: check_and_process_complete_cycles
-- ============================================================================
-- Checks all active groups and processes any complete cycles
-- Should be called by scheduled job or manually
-- ============================================================================

CREATE OR REPLACE FUNCTION check_and_process_complete_cycles()
RETURNS JSONB AS $$
DECLARE
  v_group RECORD;
  v_result JSONB;
  v_processed INTEGER := 0;
  v_results JSONB := '[]'::jsonb;
BEGIN
  -- Loop through active groups
  FOR v_group IN
    SELECT id, name, current_cycle
    FROM groups
    WHERE status = 'active'
  LOOP
    -- Check if cycle is complete
    IF is_cycle_complete(v_group.id, v_group.current_cycle) THEN
      -- Process completion
      v_result := process_cycle_completion(v_group.id);
      
      -- Add to results
      v_results := v_results || jsonb_build_object(
        'group_id', v_group.id,
        'group_name', v_group.name,
        'result', v_result
      );
      
      v_processed := v_processed + 1;
    END IF;
  END LOOP;
  
  RETURN jsonb_build_object(
    'success', true,
    'processed_count', v_processed,
    'results', v_results
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_and_process_complete_cycles IS 
  'Checks all active groups and processes complete cycles';

-- ============================================================================
-- FUNCTION: validate_group_member_limit
-- ============================================================================
-- Validates that a group hasn't exceeded its member limit
-- Used before adding new members
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_group_member_limit(p_group_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_total_members INTEGER;
  v_current_members INTEGER;
BEGIN
  SELECT total_members, current_members
  INTO v_total_members, v_current_members
  FROM groups
  WHERE id = p_group_id;
  
  RETURN v_current_members < v_total_members;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION validate_group_member_limit IS 
  'Checks if group has space for more members';

-- ============================================================================
-- FUNCTION: get_user_contribution_history
-- ============================================================================
-- Gets complete contribution history for a user with statistics
-- ============================================================================

CREATE OR REPLACE FUNCTION get_user_contribution_history(p_user_id UUID)
RETURNS TABLE (
  group_id UUID,
  group_name VARCHAR,
  total_contributions BIGINT,
  paid_contributions BIGINT,
  pending_contributions BIGINT,
  total_amount_paid DECIMAL,
  total_penalties DECIMAL,
  completion_rate DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    g.id AS group_id,
    g.name AS group_name,
    COUNT(c.id) AS total_contributions,
    COUNT(CASE WHEN c.status = 'paid' THEN 1 END) AS paid_contributions,
    COUNT(CASE WHEN c.status = 'pending' THEN 1 END) AS pending_contributions,
    COALESCE(SUM(CASE WHEN c.status = 'paid' THEN c.amount ELSE 0 END), 0) AS total_amount_paid,
    COALESCE(SUM(pen.amount), 0) AS total_penalties,
    ROUND(
      (COUNT(CASE WHEN c.status = 'paid' THEN 1 END)::DECIMAL / 
       NULLIF(COUNT(c.id), 0) * 100),
      2
    ) AS completion_rate
  FROM group_members gm
  JOIN groups g ON gm.group_id = g.id
  LEFT JOIN contributions c ON gm.group_id = c.group_id AND gm.user_id = c.user_id
  LEFT JOIN penalties pen ON c.id = pen.contribution_id
  WHERE gm.user_id = p_user_id
  GROUP BY g.id, g.name
  ORDER BY g.created_at DESC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_user_contribution_history IS 
  'Returns complete contribution history for a user grouped by group';

-- ============================================================================
-- FUNCTION: get_group_health_score
-- ============================================================================
-- Calculates a health score for a group (0-100)
-- Based on payment compliance, active members, and cycle progress
-- ============================================================================

CREATE OR REPLACE FUNCTION get_group_health_score(p_group_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_payment_rate DECIMAL;
  v_active_member_rate DECIMAL;
  v_cycle_progress DECIMAL;
  v_health_score INTEGER;
BEGIN
  -- Calculate payment compliance rate (40% weight)
  SELECT 
    COALESCE(
      COUNT(CASE WHEN status = 'paid' THEN 1 END)::DECIMAL / 
      NULLIF(COUNT(*), 0) * 40,
      0
    )
  INTO v_payment_rate
  FROM contributions
  WHERE group_id = p_group_id;
  
  -- Calculate active member rate (30% weight)
  SELECT 
    COALESCE(
      COUNT(CASE WHEN status = 'active' THEN 1 END)::DECIMAL / 
      NULLIF(total_members, 0) * 30,
      0
    )
  INTO v_active_member_rate
  FROM groups g
  LEFT JOIN group_members gm ON g.id = gm.group_id
  WHERE g.id = p_group_id
  GROUP BY g.total_members;
  
  -- Calculate cycle progress (30% weight)
  SELECT 
    COALESCE(
      (current_cycle::DECIMAL / NULLIF(total_cycles, 0)) * 30,
      0
    )
  INTO v_cycle_progress
  FROM groups
  WHERE id = p_group_id;
  
  -- Sum up the score
  v_health_score := ROUND(v_payment_rate + v_active_member_rate + v_cycle_progress);
  
  RETURN v_health_score;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_group_health_score IS 
  'Calculates group health score (0-100) based on payments, members, and progress';

-- ============================================================================
-- FUNCTION: send_payment_reminders
-- ============================================================================
-- Creates notification reminders for upcoming and overdue payments
-- Returns count of reminders sent
-- ============================================================================

CREATE OR REPLACE FUNCTION send_payment_reminders()
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER := 0;
  v_rows  INTEGER;
BEGIN
  -- Send reminders for payments due in 2 days
  INSERT INTO notifications (
    user_id,
    type,
    title,
    message,
    related_group_id
  )
  SELECT 
    c.user_id,
    'contribution_due',
    'Payment Due Soon',
    'Your contribution for ' || g.name || 
    ' is due in 2 days (₦' || c.amount || ').',
    c.group_id
  FROM contributions c
  JOIN groups g ON c.group_id = g.id
  WHERE c.status = 'pending'
    AND c.due_date::date = (CURRENT_DATE + INTERVAL '2 days')::date
    AND NOT EXISTS (
      SELECT 1
      FROM notifications n
      WHERE n.user_id = c.user_id
        AND n.related_group_id = c.group_id
        AND n.type = 'contribution_due'
        AND n.created_at > NOW() - INTERVAL '1 day'
    );

  -- Capture affected rows
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  -- Send overdue reminders
  INSERT INTO notifications (
    user_id,
    type,
    title,
    message,
    related_group_id
  )
  SELECT 
    c.user_id,
    'contribution_reminder',
    'Payment Overdue',
    'Your contribution for ' || g.name || 
    ' is now overdue. Please pay to avoid additional penalties.',
    c.group_id
  FROM contributions c
  JOIN groups g ON c.group_id = g.id
  WHERE c.status = 'pending'
    AND c.due_date < NOW()
    AND NOT EXISTS (
      SELECT 1
      FROM notifications n
      WHERE n.user_id = c.user_id
        AND n.related_group_id = c.group_id
        AND n.type = 'contribution_reminder'
        AND n.created_at > NOW() - INTERVAL '1 day'
    );

  -- Capture affected rows again
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION send_payment_reminders IS
'Sends payment reminder notifications for upcoming and overdue payments';

-- ============================================================================
-- FUNCTION: get_user_stats
-- ============================================================================
-- Returns comprehensive statistics for a user
-- Includes group memberships, contributions, payouts, and pending items
-- ============================================================================

CREATE OR REPLACE FUNCTION get_user_stats(p_user_id UUID)
RETURNS TABLE (
  total_groups INTEGER,
  active_groups INTEGER,
  completed_groups INTEGER,
  total_contributions DECIMAL,
  total_payouts DECIMAL,
  pending_contributions INTEGER,
  overdue_contributions INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(DISTINCT gm.group_id)::INTEGER AS total_groups,
    COUNT(DISTINCT CASE WHEN g.status = 'active' THEN g.id END)::INTEGER AS active_groups,
    COUNT(DISTINCT CASE WHEN g.status = 'completed' THEN g.id END)::INTEGER AS completed_groups,
    COALESCE(SUM(CASE WHEN c.status = 'paid' THEN c.amount ELSE 0 END), 0) AS total_contributions,
    COALESCE(SUM(p.amount), 0) AS total_payouts,
    COUNT(CASE WHEN c.status = 'pending' AND c.due_date >= NOW() THEN 1 END)::INTEGER AS pending_contributions,
    COUNT(CASE WHEN c.status = 'pending' AND c.due_date < NOW() THEN 1 END)::INTEGER AS overdue_contributions
  FROM users u
  LEFT JOIN group_members gm ON u.id = gm.user_id
  LEFT JOIN groups g ON gm.group_id = g.id
  LEFT JOIN contributions c ON u.id = c.user_id
  LEFT JOIN payouts p ON u.id = p.recipient_id AND p.status = 'completed'
  WHERE u.id = p_user_id
  GROUP BY u.id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_user_stats IS 
  'Returns comprehensive statistics for a user including groups, contributions, and payouts';

-- ============================================================================
-- FUNCTION: get_group_progress
-- ============================================================================
-- Returns detailed progress information for a group's current cycle
-- Shows contribution status, amounts collected, and completion percentage
-- ============================================================================

CREATE OR REPLACE FUNCTION get_group_progress(p_group_id UUID)
RETURNS TABLE (
  cycle_number INTEGER,
  total_members INTEGER,
  paid_count INTEGER,
  pending_count INTEGER,
  total_amount DECIMAL,
  collected_amount DECIMAL,
  progress_percentage DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    g.current_cycle,
    g.total_members,
    COUNT(CASE WHEN c.status = 'paid' THEN 1 END)::INTEGER AS paid_count,
    COUNT(CASE WHEN c.status = 'pending' THEN 1 END)::INTEGER AS pending_count,
    (g.contribution_amount * g.total_members) AS total_amount,
    COALESCE(SUM(CASE WHEN c.status = 'paid' THEN c.amount ELSE 0 END), 0) AS collected_amount,
    ROUND(
      (COALESCE(SUM(CASE WHEN c.status = 'paid' THEN c.amount ELSE 0 END), 0) / 
       NULLIF(g.contribution_amount * g.total_members, 0) * 100),
      2
    ) AS progress_percentage
  FROM groups g
  LEFT JOIN contributions c ON g.id = c.group_id AND c.cycle_number = g.current_cycle
  WHERE g.id = p_group_id
  GROUP BY g.id, g.current_cycle, g.total_members, g.contribution_amount;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_group_progress IS 
  'Returns detailed progress information for a groups current cycle';

-- ============================================================================
-- FUNCTION: process_group_creation_payment
-- ============================================================================
-- Processes verified payment for group creation and activates creator as member
-- Called after payment is verified via Paystack webhook or verify endpoint
-- Adds creator to group with selected slot position
-- ============================================================================

-- Drop old function signatures to avoid conflicts
DROP FUNCTION IF EXISTS process_group_creation_payment(VARCHAR, UUID, UUID);
DROP FUNCTION IF EXISTS process_group_creation_payment(VARCHAR, UUID, UUID, INTEGER);

CREATE OR REPLACE FUNCTION process_group_creation_payment(
  p_payment_reference VARCHAR(255),
  p_group_id UUID,
  p_user_id UUID,
  p_preferred_slot INTEGER DEFAULT 1
)
RETURNS TABLE(success BOOLEAN, error_message TEXT) AS $$
DECLARE
  v_payment_verified BOOLEAN;
  v_payment_amount BIGINT;
  v_required_amount DECIMAL(15, 2);
  v_contribution_amount DECIMAL(15, 2);
  v_security_deposit_amount DECIMAL(15, 2);
BEGIN
  -- Validate inputs
  IF p_payment_reference IS NULL OR p_group_id IS NULL OR p_user_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Invalid parameters'::TEXT;
    RETURN;
  END IF;

  -- Check if payment is verified
  SELECT verified, amount 
  INTO v_payment_verified, v_payment_amount
  FROM payments 
  WHERE reference = p_payment_reference AND user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Payment not found'::TEXT;
    RETURN;
  END IF;

  IF NOT v_payment_verified THEN
    RETURN QUERY SELECT FALSE, 'Payment not verified'::TEXT;
    RETURN;
  END IF;

  -- Get group amounts
  SELECT contribution_amount, security_deposit_amount
  INTO v_contribution_amount, v_security_deposit_amount
  FROM groups
  WHERE id = p_group_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Group not found'::TEXT;
    RETURN;
  END IF;

  -- Calculate required amount in kobo (100 kobo = 1 NGN)
  v_required_amount := (v_contribution_amount + v_security_deposit_amount) * 100;

  -- Verify payment amount matches
  IF v_payment_amount < v_required_amount THEN
    RETURN QUERY SELECT FALSE, 
      'Payment amount insufficient. Expected: ₦' || (v_required_amount/100.0)::TEXT || 
      ', Received: ₦' || (v_payment_amount/100.0)::TEXT;
    RETURN;
  END IF;

  -- Check if user is already a member
  IF EXISTS (SELECT 1 FROM group_members WHERE group_id = p_group_id AND user_id = p_user_id) THEN
    RETURN QUERY SELECT FALSE, 'User is already a member of this group'::TEXT;
    RETURN;
  END IF;

  -- Add creator as member with selected slot position
  INSERT INTO group_members (
    group_id,
    user_id,
    position,
    status,
    has_paid_security_deposit,
    security_deposit_amount,
    security_deposit_paid_at,
    is_creator
  ) VALUES (
    p_group_id,
    p_user_id,
    p_preferred_slot,
    'active',
    TRUE,
    v_security_deposit_amount,
    NOW(),
    TRUE
  );

  -- Create the first contribution record
  INSERT INTO contributions (
    group_id,
    user_id,
    amount,
    cycle_number,
    status,
    due_date,
    paid_date,
    transaction_ref
  ) VALUES (
    p_group_id,
    p_user_id,
    v_contribution_amount,
    1, -- First cycle
    'paid',
    NOW(), -- Due now
    NOW(), -- Paid now
    p_payment_reference
  );

  -- Create transaction records
  INSERT INTO transactions (
    user_id,
    group_id,
    type,
    amount,
    status,
    reference,
    description,
    completed_at
  ) VALUES (
    p_user_id,
    p_group_id,
    'security_deposit',
    v_security_deposit_amount,
    'completed',
    p_payment_reference || '_SD',
    'Security deposit for group creation',
    NOW()
  ), (
    p_user_id,
    p_group_id,
    'contribution',
    v_contribution_amount,
    'completed',
    p_payment_reference || '_C1',
    'First contribution payment',
    NOW()
  );

  -- NOTE: The update_group_member_count trigger automatically increments current_members
  -- when a member is inserted into group_members. No need to manually update to avoid double-counting.

  RETURN QUERY SELECT TRUE, 'Group creation payment processed successfully'::TEXT;

EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error in process_group_creation_payment: %', SQLERRM;
    RETURN QUERY SELECT FALSE, 'An error occurred while processing payment'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION process_group_creation_payment IS 
  'Processes verified payment for group creation and activates creator as member with selected slot. Trigger handles member count increment.';

GRANT EXECUTE ON FUNCTION process_group_creation_payment TO authenticated;

-- ============================================================================
-- FUNCTION: increment_group_member_count
-- ============================================================================
-- Atomically increments the group's current_members count
-- This prevents race conditions when multiple payments are processed simultaneously
-- ============================================================================

CREATE OR REPLACE FUNCTION increment_group_member_count(
  p_group_id UUID
)
RETURNS VOID AS $$
BEGIN
  -- Atomic increment to avoid race conditions
  UPDATE groups
  SET current_members = current_members + 1,
      updated_at = NOW()
  WHERE id = p_group_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION increment_group_member_count IS 
  'Atomically increments group member count to prevent race conditions';

GRANT EXECUTE ON FUNCTION increment_group_member_count TO service_role;

-- ============================================================================
-- FUNCTION: add_member_to_group
-- ============================================================================
-- Adds a user as a member to a group with optional slot preference
-- Automatically handles member counting via trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION add_member_to_group(
  p_group_id UUID,
  p_user_id UUID,
  p_is_creator BOOLEAN DEFAULT FALSE,
  p_preferred_slot INTEGER DEFAULT NULL
)
RETURNS TABLE(
  success BOOLEAN,
  error_message TEXT,
  member_position INTEGER
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_group_record RECORD;
  v_assigned_position INTEGER;
  v_member_exists BOOLEAN;
BEGIN
  -- Check if group exists and get details
  SELECT * INTO v_group_record
  FROM groups
  WHERE id = p_group_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Group not found'::TEXT, NULL::INTEGER;
    RETURN;
  END IF;

  -- Check if user is already a member
  SELECT EXISTS(
    SELECT 1 FROM group_members 
    WHERE group_id = p_group_id AND user_id = p_user_id
  ) INTO v_member_exists;

  IF v_member_exists THEN
    RETURN QUERY SELECT FALSE, 'User is already a member of this group'::TEXT, NULL::INTEGER;
    RETURN;
  END IF;

  -- Check if group is full
  IF v_group_record.current_members >= v_group_record.total_members THEN
    RETURN QUERY SELECT FALSE, 'Group is full'::TEXT, NULL::INTEGER;
    RETURN;
  END IF;

  -- Determine position
  IF p_preferred_slot IS NOT NULL THEN
    -- Check if preferred slot is available
    IF EXISTS(SELECT 1 FROM group_members WHERE group_id = p_group_id AND position = p_preferred_slot) THEN
      RETURN QUERY SELECT FALSE, 'Preferred slot is already taken'::TEXT, NULL::INTEGER;
      RETURN;
    END IF;
    v_assigned_position := p_preferred_slot;
  ELSE
    -- Find next available position
    SELECT COALESCE(MIN(slot_number), 1) INTO v_assigned_position
    FROM generate_series(1, v_group_record.total_members) AS slot_number
    WHERE slot_number NOT IN (
      SELECT position FROM group_members WHERE group_id = p_group_id
    );
  END IF;

  -- Add member to group
  -- NOTE: Do NOT manually increment current_members here
  -- The trigger_update_group_member_count will handle it automatically
  INSERT INTO group_members (
    group_id,
    user_id,
    position,
    has_paid_security_deposit,
    security_deposit_amount,
    status,
    is_creator
  ) VALUES (
    p_group_id,
    p_user_id,
    v_assigned_position,
    FALSE, -- Payment will be tracked separately
    v_group_record.security_deposit_amount,
    'active', -- Member is active immediately, payment tracked separately
    p_is_creator
  );

  -- Create pending contribution record for the first cycle
  -- (will be marked as paid when payment is verified)
  INSERT INTO contributions (
    group_id,
    user_id,
    cycle_number,
    amount,
    due_date,
    status
  ) VALUES (
    p_group_id,
    p_user_id,
    v_group_record.current_cycle,
    v_group_record.contribution_amount,
    v_group_record.start_date,
    'pending' -- Will be updated to 'paid' when payment is verified
  );

  -- Return success with assigned position
  RETURN QUERY SELECT TRUE, 'Member added successfully'::TEXT, v_assigned_position;
END;
$$;

COMMENT ON FUNCTION add_member_to_group IS 
  'Adds a member to a group. Count is incremented automatically by trigger_update_group_member_count.';

GRANT EXECUTE ON FUNCTION add_member_to_group TO authenticated, service_role;

-- ============================================================================
-- FUNCTION: auto_add_creator_as_member
-- ============================================================================
-- Trigger function to automatically add group creator as first member
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_add_creator_as_member()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result RECORD;
BEGIN
  -- Add the creator as a member immediately with position 1
  SELECT * INTO v_result
  FROM add_member_to_group(
    NEW.id,
    NEW.created_by,
    TRUE, -- is_creator
    1 -- preferred slot 1 for creator
  );

  -- Check if addition was successful
  IF NOT v_result.success THEN
    RAISE WARNING 'Failed to auto-add creator as member: %', v_result.error_message;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION auto_add_creator_as_member IS 
  'Automatically adds the group creator as a member when a group is created.';

-- ============================================================================
-- FUNCTION: get_pending_payouts
-- ============================================================================
-- Gets all pending payouts that are ready to be executed
-- Returns payout details along with recipient bank information
-- ============================================================================

CREATE OR REPLACE FUNCTION get_pending_payouts()
RETURNS TABLE (
  payout_id UUID,
  group_id UUID,
  group_name VARCHAR,
  recipient_id UUID,
  recipient_name VARCHAR,
  recipient_email VARCHAR,
  recipient_bank_code VARCHAR,
  recipient_account_number VARCHAR,
  recipient_account_name VARCHAR,
  amount DECIMAL,
  cycle_number INTEGER,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id AS payout_id,
    p.related_group_id AS group_id,
    g.name AS group_name,
    p.recipient_id,
    u.full_name AS recipient_name,
    u.email AS recipient_email,
    u.bank_code AS recipient_bank_code,
    u.account_number AS recipient_account_number,
    u.account_name AS recipient_account_name,
    p.amount,
    p.cycle_number,
    p.created_at
  FROM payouts p
  JOIN groups g ON p.related_group_id = g.id
  JOIN users u ON p.recipient_id = u.id
  WHERE p.status = 'pending'
    AND u.bank_code IS NOT NULL
    AND u.account_number IS NOT NULL
    AND u.account_name IS NOT NULL
  ORDER BY p.created_at ASC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_pending_payouts IS 
  'Gets all pending payouts with recipient bank information for processing';

-- ============================================================================
-- FUNCTION: mark_payout_processing
-- ============================================================================
-- Marks a payout as processing to prevent duplicate processing
-- ============================================================================

CREATE OR REPLACE FUNCTION mark_payout_processing(p_payout_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_updated_count INTEGER;
BEGIN
  UPDATE payouts
  SET status = 'processing',
      updated_at = NOW()
  WHERE id = p_payout_id
    AND status = 'pending';
  
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  
  RETURN v_updated_count > 0;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION mark_payout_processing IS 
  'Marks a payout as processing (idempotent)';

-- ============================================================================
-- FUNCTION: mark_payout_completed
-- ============================================================================
-- Marks a payout as completed after successful transfer
-- ============================================================================

CREATE OR REPLACE FUNCTION mark_payout_completed(
  p_payout_id UUID,
  p_payment_reference VARCHAR,
  p_payment_method VARCHAR DEFAULT 'bank_transfer'
)
RETURNS BOOLEAN AS $$
DECLARE
  v_updated_count INTEGER;
BEGIN
  UPDATE payouts
  SET status = 'completed',
      payout_date = NOW(),
      payment_reference = p_payment_reference,
      payment_method = p_payment_method,
      updated_at = NOW()
  WHERE id = p_payout_id
    AND status = 'processing';
  
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  
  RETURN v_updated_count > 0;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION mark_payout_completed IS 
  'Marks a payout as completed with payment details';

-- ============================================================================
-- FUNCTION: mark_payout_failed
-- ============================================================================
-- Marks a payout as failed and resets to pending for retry
-- ============================================================================

CREATE OR REPLACE FUNCTION mark_payout_failed(
  p_payout_id UUID,
  p_error_message TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_updated_count INTEGER;
BEGIN
  UPDATE payouts
  SET status = 'failed',
      notes = COALESCE(notes || E'\n', '') || 
              'Failed at ' || NOW() || ': ' || p_error_message,
      updated_at = NOW()
  WHERE id = p_payout_id
    AND status = 'processing';
  
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  
  RETURN v_updated_count > 0;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION mark_payout_failed IS 
  'Marks a payout as failed with error details';

-- ============================================================================
-- FUNCTION: check_and_activate_group
-- ============================================================================
-- Checks if a group should be activated and generates contribution cycles
-- Called when a member pays their security deposit
-- Activates group if all positions are filled and all security deposits paid
-- ============================================================================

CREATE OR REPLACE FUNCTION check_and_activate_group(p_group_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_total_members INTEGER;
  v_current_members INTEGER;
  v_all_deposits_paid BOOLEAN;
  v_group_status VARCHAR(20);
  v_start_date TIMESTAMPTZ;
  v_frequency VARCHAR(20);
BEGIN
  -- Get group details
  SELECT total_members, current_members, status, start_date, frequency
  INTO v_total_members, v_current_members, v_group_status, v_start_date, v_frequency
  FROM groups
  WHERE id = p_group_id;
  
  -- Only activate groups in 'forming' status
  IF v_group_status != 'forming' THEN
    RETURN FALSE;
  END IF;
  
  -- Check if all positions are filled
  IF v_current_members < v_total_members THEN
    RETURN FALSE;
  END IF;
  
  -- Check if all members have paid their security deposits
  SELECT COUNT(*) = v_total_members INTO v_all_deposits_paid
  FROM group_members
  WHERE group_id = p_group_id
    AND has_paid_security_deposit = TRUE
    AND status = 'active';
  
  -- If all conditions met, activate the group
  IF v_all_deposits_paid THEN
    -- Update group status to active
    UPDATE groups
    SET status = 'active',
        start_date = COALESCE(v_start_date, NOW()),
        updated_at = NOW()
    WHERE id = p_group_id;
    
    -- Generate contribution cycles
    PERFORM generate_contribution_cycles(p_group_id);
    
    RETURN TRUE;
  END IF;
  
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION check_and_activate_group IS 
  'Checks conditions and activates group if ready, generating contribution cycles';

-- ============================================================================
-- FUNCTION: generate_contribution_cycles
-- ============================================================================
-- Generates all contribution cycles for a group when it becomes active
-- Creates one cycle per member based on their position order
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_contribution_cycles(p_group_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_member RECORD;
  v_cycle_number INTEGER;
  v_start_date TIMESTAMPTZ;
  v_due_date TIMESTAMPTZ;
  v_frequency VARCHAR(20);
  v_contribution_amount DECIMAL(15, 2);
  v_service_fee_percentage INTEGER;
  v_total_members INTEGER;
  v_expected_amount DECIMAL(15, 2);
  v_cycles_created INTEGER := 0;
BEGIN
  -- Get group details
  SELECT start_date, frequency, contribution_amount, service_fee_percentage, total_members
  INTO v_start_date, v_frequency, v_contribution_amount, v_service_fee_percentage, v_total_members
  FROM groups
  WHERE id = p_group_id;
  
  -- Calculate expected amount per cycle (contribution from all members)
  v_expected_amount := v_contribution_amount * v_total_members;
  
  -- Generate cycles for each position
  FOR v_member IN 
    SELECT user_id, position
    FROM group_members
    WHERE group_id = p_group_id
      AND status = 'active'
    ORDER BY position ASC
  LOOP
    v_cycle_number := v_member.position;
    
    -- Calculate cycle dates based on frequency
    CASE v_frequency
      WHEN 'daily' THEN
        v_due_date := v_start_date + ((v_cycle_number - 1) * INTERVAL '1 day');
      WHEN 'weekly' THEN
        v_due_date := v_start_date + ((v_cycle_number - 1) * INTERVAL '1 week');
      WHEN 'monthly' THEN
        v_due_date := v_start_date + ((v_cycle_number - 1) * INTERVAL '1 month');
      ELSE
        v_due_date := v_start_date + ((v_cycle_number - 1) * INTERVAL '1 month');
    END CASE;
    
    -- Insert contribution cycle
    INSERT INTO contribution_cycles (
      group_id,
      cycle_number,
      collector_user_id,
      collector_position,
      start_date,
      due_date,
      status,
      expected_amount,
      collected_amount,
      payout_amount,
      service_fee_collected
    ) VALUES (
      p_group_id,
      v_cycle_number,
      v_member.user_id,
      v_member.position,
      CASE 
        WHEN v_cycle_number = 1 THEN v_start_date
        ELSE v_due_date - (
          CASE v_frequency
            WHEN 'daily' THEN INTERVAL '1 day'
            WHEN 'weekly' THEN INTERVAL '1 week'
            WHEN 'monthly' THEN INTERVAL '1 month'
            ELSE INTERVAL '1 month'
          END
        )
      END,
      v_due_date,
      CASE WHEN v_cycle_number = 1 THEN 'active' ELSE 'pending' END,
      v_expected_amount,
      0,
      0,
      0
    );
    
    v_cycles_created := v_cycles_created + 1;
    
    -- Create contribution records for all members for this cycle
    INSERT INTO contributions (
      group_id,
      user_id,
      cycle_number,
      amount,
      service_fee,
      due_date,
      status
    )
    SELECT
      p_group_id,
      gm.user_id,
      v_cycle_number,
      v_contribution_amount,
      ROUND(v_contribution_amount * v_service_fee_percentage / 100, 2),
      v_due_date,
      'pending'
    FROM group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.status = 'active';
  END LOOP;
  
  RETURN v_cycles_created;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION generate_contribution_cycles IS 
  'Generates all contribution cycles for an active group based on member positions';

-- ============================================================================
-- FUNCTION: process_payout_to_wallet
-- ============================================================================
-- Processes a payout by transferring funds to the recipient's wallet
-- Creates transaction record for audit trail
-- ============================================================================

CREATE OR REPLACE FUNCTION process_payout_to_wallet(
  p_payout_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_payout RECORD;
  v_recipient_wallet_id UUID;
  v_system_wallet_id UUID;
  v_transaction_ref VARCHAR(255);
BEGIN
  -- Get payout details
  SELECT * INTO v_payout
  FROM payouts
  WHERE id = p_payout_id
    AND status = 'pending';
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout not found or already processed';
  END IF;
  
  -- Get recipient's wallet
  SELECT id INTO v_recipient_wallet_id
  FROM wallets
  WHERE user_id = v_payout.recipient_id;
  
  IF v_recipient_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Recipient wallet not found';
  END IF;
  
  -- Generate transaction reference
  v_transaction_ref := 'PAYOUT-' || v_payout.related_group_id || '-C' || v_payout.cycle_number;
  
  -- Credit recipient's wallet
  UPDATE wallets
  SET balance = balance + v_payout.amount,
      updated_at = NOW()
  WHERE id = v_recipient_wallet_id;
  
  -- Create transaction record
  INSERT INTO transactions (
    from_wallet_id,
    to_wallet_id,
    amount,
    transaction_type,
    reference,
    metadata
  ) VALUES (
    NULL, -- System credit
    v_recipient_wallet_id,
    v_payout.amount,
    'payout',
    v_transaction_ref,
    jsonb_build_object(
      'payout_id', v_payout.id,
      'group_id', v_payout.related_group_id,
      'cycle_number', v_payout.cycle_number
    )
  );
  
  -- Update payout status
  UPDATE payouts
  SET status = 'completed',
      payout_date = NOW(),
      payment_reference = v_transaction_ref,
      updated_at = NOW()
  WHERE id = p_payout_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION process_payout_to_wallet IS 
  'Processes a payout by crediting recipient wallet and creating transaction record';

-- ============================================================================
-- FUNCTION: transfer_wallet_funds
-- ============================================================================
-- Transfers funds between two wallets
-- Used for internal transfers, penalties, etc.
-- ============================================================================

CREATE OR REPLACE FUNCTION transfer_wallet_funds(
  p_from_user_id UUID,
  p_to_user_id UUID,
  p_amount DECIMAL(15, 2),
  p_transaction_type VARCHAR(50),
  p_reference VARCHAR(255),
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID AS $$
DECLARE
  v_from_wallet_id UUID;
  v_to_wallet_id UUID;
  v_transaction_id UUID;
BEGIN
  -- Validate amount
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Transfer amount must be positive';
  END IF;
  
  -- Get sender's wallet
  SELECT id INTO v_from_wallet_id
  FROM wallets
  WHERE user_id = p_from_user_id;
  
  IF v_from_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Sender wallet not found';
  END IF;
  
  -- Get recipient's wallet
  SELECT id INTO v_to_wallet_id
  FROM wallets
  WHERE user_id = p_to_user_id;
  
  IF v_to_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Recipient wallet not found';
  END IF;
  
  -- Check sufficient balance
  IF NOT EXISTS (
    SELECT 1 FROM wallets
    WHERE id = v_from_wallet_id
      AND balance >= p_amount
  ) THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;
  
  -- Debit sender's wallet
  UPDATE wallets
  SET balance = balance - p_amount,
      updated_at = NOW()
  WHERE id = v_from_wallet_id;
  
  -- Credit recipient's wallet
  UPDATE wallets
  SET balance = balance + p_amount,
      updated_at = NOW()
  WHERE id = v_to_wallet_id;
  
  -- Create transaction record
  INSERT INTO transactions (
    from_wallet_id,
    to_wallet_id,
    amount,
    transaction_type,
    reference,
    metadata
  ) VALUES (
    v_from_wallet_id,
    v_to_wallet_id,
    p_amount,
    p_transaction_type,
    p_reference,
    p_metadata
  )
  RETURNING id INTO v_transaction_id;
  
  RETURN v_transaction_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION transfer_wallet_funds IS 
  'Transfers funds between two user wallets with transaction tracking';

-- ============================================================================
-- END OF FUNCTIONS
-- ============================================================================
--
-- USAGE:
-- 1. Run this file after schema.sql has been executed
-- 2. Functions are available immediately for use
-- 3. Call from SQL: SELECT * FROM get_user_stats('user-uuid');
-- 4. Call from application via Supabase RPC: supabase.rpc('function_name', params)
--
-- EXAMPLES:
-- - Check if cycle complete: SELECT is_cycle_complete('group-uuid', 1);
-- - Calculate payout: SELECT calculate_payout_amount('group-uuid', 1);
-- - Apply penalties: SELECT apply_late_penalties();
-- - Send reminders: SELECT send_payment_reminders();
--
-- ============================================================================
