-- ============================================================================
-- Migration: Fix Double Counting in Member Addition
-- ============================================================================
-- ISSUE: add_member_to_group() manually increments current_members AND
--        trigger_update_group_member_count also increments on INSERT
-- RESULT: Every member addition increments count TWICE
-- FIX: Remove manual increment since trigger handles it automatically
-- ============================================================================

-- Drop and recreate add_member_to_group without manual increment
DROP FUNCTION IF EXISTS add_member_to_group(UUID, UUID, BOOLEAN, INTEGER);

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
  v_next_position INTEGER;
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

  -- REMOVED: Manual current_members increment
  -- The trigger_update_group_member_count AFTER INSERT trigger will increment it
  -- This prevents double counting

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

  -- Return success
  RETURN QUERY SELECT TRUE, 'Member added successfully'::TEXT, v_assigned_position;
END;
$$;

COMMENT ON FUNCTION add_member_to_group IS 
  'Adds a member to a group. Count is incremented automatically by trigger_update_group_member_count.';

-- ============================================================================
-- Verify the trigger exists (it should already be in triggers.sql)
-- ============================================================================
-- This trigger automatically handles current_members increment/decrement
-- DO NOT manually modify current_members in functions that call this

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'trigger_update_group_member_count'
  ) THEN
    RAISE WARNING 'trigger_update_group_member_count is missing! Member counting will not work correctly.';
  ELSE
    RAISE NOTICE 'trigger_update_group_member_count exists - member counting should work correctly';
  END IF;
END $$;
