-- ============================================================================
-- Migration: Add preferred_slot to join requests view
-- ============================================================================
-- Updates get_pending_join_requests function to include preferred_slot
-- so admins can see which slot the user requested when reviewing join requests
-- ============================================================================

DROP FUNCTION IF EXISTS get_pending_join_requests(UUID);

CREATE OR REPLACE FUNCTION get_pending_join_requests(p_group_id UUID)
RETURNS TABLE(
  id UUID,
  user_id UUID,
  user_name VARCHAR(255),
  user_email VARCHAR(255),
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
  'Returns all pending join requests for a specific group with preferred slot information.';

GRANT EXECUTE ON FUNCTION get_pending_join_requests TO authenticated;
