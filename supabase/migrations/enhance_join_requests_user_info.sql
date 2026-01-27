-- ============================================================================
-- MIGRATION: Enhance Join Requests User Information
-- ============================================================================
-- This migration enhances the get_pending_join_requests function to include
-- additional user information (phone and avatar) so admins can make better
-- informed decisions when reviewing join requests.
-- ============================================================================

-- ============================================================================
-- UPDATE: Get pending join requests with full user information
-- ============================================================================

DROP FUNCTION IF EXISTS get_pending_join_requests(UUID);

CREATE OR REPLACE FUNCTION get_pending_join_requests(p_group_id UUID)
RETURNS TABLE(
  id UUID,
  user_id UUID,
  user_name VARCHAR(255),
  user_email VARCHAR(255),
  user_phone VARCHAR(20),
  user_avatar_url TEXT,
  preferred_slot INTEGER,
  message TEXT,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    gjr.id,
    gjr.user_id,
    u.full_name,
    u.email,
    u.phone,
    u.avatar_url,
    gjr.preferred_slot,
    gjr.message,
    gjr.created_at
  FROM group_join_requests gjr
  JOIN users u ON gjr.user_id = u.id
  WHERE gjr.group_id = p_group_id
  AND gjr.status = 'pending'
  ORDER BY gjr.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION get_pending_join_requests IS 
  'Returns all pending join requests for a specific group with full user information including phone and avatar';

GRANT EXECUTE ON FUNCTION get_pending_join_requests TO authenticated;

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
