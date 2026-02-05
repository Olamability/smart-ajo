-- Migration: Add get_group_members_safe RPC Function
-- Date: 2026-02-05
-- Description: Adds a SECURITY DEFINER function to allow group members to view
--              other members of groups they belong to without RLS recursion issues.
--
-- Background:
-- After fixing the infinite recursion in group_members RLS policy, regular members
-- can no longer directly query all members of a group using standard SELECT queries.
-- This function provides a safe way to fetch group members with proper authorization
-- checks, bypassing RLS using SECURITY DEFINER.
--
-- Authorization:
-- - User must be a member of the group, OR
-- - User must be the creator of the group
--
-- Usage:
-- SELECT * FROM get_group_members_safe('group-uuid-here');

CREATE OR REPLACE FUNCTION get_group_members_safe(p_group_id UUID)
RETURNS TABLE (
  user_id UUID,
  group_id UUID,
  position INTEGER,
  status member_status_enum,
  security_deposit_amount DECIMAL(10,2),
  has_paid_security_deposit BOOLEAN,
  security_deposit_paid_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ,
  full_name TEXT,
  email TEXT,
  phone TEXT
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

  -- Return all members of the group
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
    u.phone
  FROM group_members gm
  JOIN users u ON gm.user_id = u.id
  WHERE gm.group_id = p_group_id
  ORDER BY gm.position ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_group_members_safe(UUID) TO authenticated;
