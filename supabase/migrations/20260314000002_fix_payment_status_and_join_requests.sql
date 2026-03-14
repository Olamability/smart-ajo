-- Migration: Fix payment status display and join-request slot reservation
-- Date: 2026-03-14
-- Description:
--   1. Update get_group_members_safe to include total_contributions (paid count)
--      so that the "1st Contribution Paid / Pending" indicator works correctly
--      after a member pays their initial deposit + first contribution together.
--   2. Add get_taken_slots RPC that is accessible to all authenticated users so
--      that the slot selector can mark slots as unavailable for both confirmed
--      members and pending join requests, preventing double-booking.

-- ============================================================================
-- 1. UPDATE get_group_members_safe TO INCLUDE total_contributions
-- ============================================================================

CREATE OR REPLACE FUNCTION get_group_members_safe(p_group_id UUID)
RETURNS TABLE (
  user_id UUID,
  group_id UUID,
  "position" INTEGER,
  status member_status_enum,
  security_deposit_amount DECIMAL(10,2),
  has_paid_security_deposit BOOLEAN,
  security_deposit_paid_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  total_contributions BIGINT
) AS $$
BEGIN
  -- Check if the requesting user is a member of this group or is the group creator
  IF NOT EXISTS (
    SELECT 1 FROM group_members gm
    WHERE gm.group_id = p_group_id 
      AND gm.user_id = auth.uid()
  ) AND NOT EXISTS (
    SELECT 1 FROM groups g
    WHERE g.id = p_group_id 
      AND g.created_by = auth.uid()
  ) THEN
    -- User is not authorized to view members of this group
    RAISE EXCEPTION 'Not authorized to view members of this group';
  END IF;

  -- Return all members of the group with contribution count
  RETURN QUERY
  SELECT 
    gm.user_id,
    gm.group_id,
    gm.position,
    gm.status,
    gm.security_deposit_amount,
    gm.has_paid_security_deposit,
    gm.security_deposit_paid_at,
    gm.joined_at,
    u.full_name,
    u.email,
    u.phone,
    COUNT(c.id) FILTER (WHERE c.status = 'paid') AS total_contributions
  FROM group_members gm
  JOIN users u ON gm.user_id = u.id
  LEFT JOIN contributions c ON c.group_id = gm.group_id AND c.user_id = gm.user_id
  WHERE gm.group_id = p_group_id
  GROUP BY gm.user_id, gm.group_id, gm.position, gm.status, gm.security_deposit_amount,
           gm.has_paid_security_deposit, gm.security_deposit_paid_at, gm.joined_at,
           u.full_name, u.email, u.phone
  ORDER BY gm.position ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 2. ADD get_taken_slots RPC
-- Returns slot numbers already taken (members or pending join requests).
-- Accessible to any authenticated user without exposing user identity.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_taken_slots(p_group_id UUID)
RETURNS TABLE (slot_number INTEGER) AS $$
BEGIN
  RETURN QUERY
  -- Slots assigned to existing members
  SELECT gm.position AS slot_number
  FROM group_members gm
  WHERE gm.group_id = p_group_id
    AND gm.status NOT IN ('removed')
    AND gm.position IS NOT NULL

  UNION

  -- Slots reserved by pending join requests
  SELECT jr.preferred_slot AS slot_number
  FROM group_join_requests jr
  WHERE jr.group_id = p_group_id
    AND jr.status = 'pending'
    AND jr.preferred_slot IS NOT NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_taken_slots(UUID) TO authenticated;
