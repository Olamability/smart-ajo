-- ============================================================================
-- SECURED-AJO DATABASE VIEWS
-- ============================================================================
-- This file contains database views for common queries and reporting.
-- Views simplify complex queries and improve query performance.
--
-- IMPORTANT: Run this file AFTER schema.sql has been executed.
-- ============================================================================

-- ============================================================================
-- VIEW: active_groups_summary
-- ============================================================================
-- Provides a summary view of all active groups with key metrics
-- Useful for displaying available groups to join
-- ============================================================================

CREATE OR REPLACE VIEW active_groups_summary AS
SELECT 
  g.id,
  g.name,
  g.description,
  g.contribution_amount,
  g.frequency,
  g.total_members,
  g.current_members,
  g.security_deposit_amount,
  g.security_deposit_percentage,
  g.status,
  g.start_date,
  g.current_cycle,
  g.total_cycles,
  g.created_at,
  u.full_name AS creator_name,
  u.avatar_url AS creator_avatar,
  -- Calculate available spots
  (g.total_members - g.current_members) AS available_spots,
  -- Calculate total pool per cycle
  (g.contribution_amount * g.total_members) AS total_pool_per_cycle,
  -- Check if group is full
  CASE 
    WHEN g.current_members >= g.total_members THEN true
    ELSE false
  END AS is_full
FROM groups g
JOIN users u ON g.created_by = u.id
WHERE g.status IN ('forming', 'active')
ORDER BY g.created_at DESC;

COMMENT ON VIEW active_groups_summary IS 
  'Summary of active and forming groups with key metrics and availability';

-- ============================================================================
-- VIEW: user_dashboard_view
-- ============================================================================
-- Comprehensive view of a user's groups, contributions, and payouts
-- Used for the main dashboard display
-- ============================================================================

CREATE OR REPLACE VIEW user_dashboard_view AS
SELECT 
  u.id AS user_id,
  u.full_name,
  u.email,
  u.is_verified,
  u.kyc_status,
  -- Group membership counts
  COUNT(DISTINCT gm.group_id) AS total_groups,
  COUNT(DISTINCT CASE WHEN g.status = 'active' THEN g.id END) AS active_groups,
  COUNT(DISTINCT CASE WHEN g.status = 'completed' THEN g.id END) AS completed_groups,
  COUNT(DISTINCT CASE WHEN g.status = 'forming' THEN g.id END) AS forming_groups,
  -- Financial summary
  COALESCE(SUM(CASE WHEN c.status = 'paid' THEN c.amount ELSE 0 END), 0) AS total_contributed,
  COALESCE(SUM(CASE WHEN p.status = 'completed' THEN p.amount ELSE 0 END), 0) AS total_received,
  COALESCE(SUM(CASE WHEN pen.status = 'applied' THEN pen.amount ELSE 0 END), 0) AS pending_penalties,
  -- Pending contributions
  COUNT(CASE 
    WHEN c.status = 'pending' AND c.due_date >= NOW() 
    THEN 1 
  END) AS pending_contributions,
  COUNT(CASE 
    WHEN c.status = 'pending' AND c.due_date < NOW() 
    THEN 1 
  END) AS overdue_contributions,
  -- Next upcoming payment
  MIN(CASE 
    WHEN c.status = 'pending' AND c.due_date >= NOW() 
    THEN c.due_date 
  END) AS next_payment_due
FROM users u
LEFT JOIN group_members gm ON u.id = gm.user_id
LEFT JOIN groups g ON gm.group_id = g.id
LEFT JOIN contributions c ON u.id = c.user_id
LEFT JOIN payouts p ON u.id = p.recipient_id
LEFT JOIN penalties pen ON u.id = pen.user_id
GROUP BY u.id, u.full_name, u.email, u.is_verified, u.kyc_status;

COMMENT ON VIEW user_dashboard_view IS 
  'Comprehensive user dashboard data including groups, contributions, and financial summary';

-- ============================================================================
-- VIEW: group_contribution_progress
-- ============================================================================
-- Shows the current contribution progress for each group's current cycle
-- Useful for displaying group progress bars and status
-- ============================================================================

CREATE OR REPLACE VIEW group_contribution_progress AS
SELECT 
  g.id AS group_id,
  g.name AS group_name,
  g.current_cycle,
  g.total_cycles,
  g.status AS group_status,
  g.contribution_amount,
  g.total_members,
  -- Contribution counts for current cycle
  COUNT(c.id) AS total_expected_contributions,
  COUNT(CASE WHEN c.status = 'paid' THEN 1 END) AS paid_contributions,
  COUNT(CASE WHEN c.status = 'pending' AND c.due_date >= NOW() THEN 1 END) AS pending_contributions,
  COUNT(CASE WHEN c.status = 'pending' AND c.due_date < NOW() THEN 1 END) AS overdue_contributions,
  -- Financial totals
  (g.contribution_amount * g.total_members) AS total_amount_expected,
  COALESCE(SUM(CASE WHEN c.status = 'paid' THEN c.amount ELSE 0 END), 0) AS total_amount_collected,
  COALESCE(SUM(CASE WHEN c.status = 'paid' THEN c.service_fee ELSE 0 END), 0) AS total_service_fees,
  -- Progress percentage
  ROUND(
    (COUNT(CASE WHEN c.status = 'paid' THEN 1 END)::DECIMAL / 
     NULLIF(g.total_members, 0) * 100),
    2
  ) AS completion_percentage,
  -- Next payout recipient
  gm.user_id AS next_payout_recipient_id,
  u.full_name AS next_payout_recipient_name,
  -- Cycle due date (earliest due date in current cycle)
  MIN(c.due_date) AS cycle_due_date,
  -- Check if cycle is complete
  CASE 
    WHEN COUNT(CASE WHEN c.status = 'paid' THEN 1 END) = g.total_members 
    THEN true
    ELSE false
  END AS is_cycle_complete
FROM groups g
LEFT JOIN contributions c ON g.id = c.group_id AND c.cycle_number = g.current_cycle
LEFT JOIN group_members gm ON g.id = gm.group_id AND gm.position = g.current_cycle
LEFT JOIN users u ON gm.user_id = u.id
WHERE g.status IN ('active', 'forming')
GROUP BY 
  g.id, g.name, g.current_cycle, g.total_cycles, g.status, 
  g.contribution_amount, g.total_members, gm.user_id, u.full_name;

COMMENT ON VIEW group_contribution_progress IS 
  'Real-time contribution progress for each group''s current cycle';

-- ============================================================================
-- VIEW: overdue_contributions_view
-- ============================================================================
-- Lists all overdue contributions for monitoring and notifications
-- Used by automated jobs to send reminders and apply penalties
-- ============================================================================

CREATE OR REPLACE VIEW overdue_contributions_view AS
SELECT 
  c.id AS contribution_id,
  c.group_id,
  g.name AS group_name,
  c.user_id,
  u.full_name AS user_name,
  u.email AS user_email,
  u.phone AS user_phone,
  c.amount AS contribution_amount,
  c.cycle_number,
  c.due_date,
  c.status,
  -- Calculate days overdue
  EXTRACT(DAY FROM (NOW() - c.due_date))::INTEGER AS days_overdue,
  -- Check if penalty already exists
  EXISTS(
    SELECT 1 FROM penalties pen 
    WHERE pen.contribution_id = c.id 
    AND pen.type = 'late_payment'
  ) AS penalty_applied,
  -- Group creator info (for notifications)
  g.created_by AS group_creator_id,
  uc.full_name AS group_creator_name,
  uc.email AS group_creator_email
FROM contributions c
JOIN groups g ON c.group_id = g.id
JOIN users u ON c.user_id = u.id
JOIN users uc ON g.created_by = uc.id
WHERE c.status = 'pending' 
  AND c.due_date < NOW()
  AND g.status = 'active'
ORDER BY c.due_date ASC, g.id, c.user_id;

COMMENT ON VIEW overdue_contributions_view IS 
  'All overdue contributions with user and group details for reminders and penalties';

-- ============================================================================
-- VIEW: user_groups_detail
-- ============================================================================
-- Detailed view of user's group memberships with all relevant information
-- Used for "My Groups" pages and group management
-- ============================================================================

CREATE OR REPLACE VIEW user_groups_detail AS
SELECT 
  gm.user_id,
  gm.group_id,
  g.name AS group_name,
  g.description AS group_description,
  g.contribution_amount,
  g.frequency,
  g.status AS group_status,
  g.current_cycle,
  g.total_cycles,
  g.start_date,
  gm.position AS my_position,
  gm.status AS membership_status,
  gm.has_paid_security_deposit,
  gm.security_deposit_amount,
  gm.joined_at,
  gm.is_creator,
  -- Financial summary for this group
  COALESCE(
    (SELECT SUM(amount) 
     FROM contributions 
     WHERE group_id = g.id AND user_id = gm.user_id AND status = 'paid'),
    0
  ) AS total_contributed,
  COALESCE(
    (SELECT SUM(amount) 
     FROM payouts 
     WHERE group_id = g.id AND recipient_id = gm.user_id AND status = 'completed'),
    0
  ) AS total_received,
  -- Current cycle contribution status
  (SELECT status 
   FROM contributions 
   WHERE group_id = g.id 
   AND user_id = gm.user_id 
   AND cycle_number = g.current_cycle
   LIMIT 1
  ) AS current_cycle_status,
  (SELECT due_date 
   FROM contributions 
   WHERE group_id = g.id 
   AND user_id = gm.user_id 
   AND cycle_number = g.current_cycle
   LIMIT 1
  ) AS current_cycle_due_date,
  -- Check if user has received payout
  EXISTS(
    SELECT 1 FROM payouts 
    WHERE group_id = g.id 
    AND recipient_id = gm.user_id 
    AND status = 'completed'
  ) AS has_received_payout,
  -- Calculate expected payout cycle (based on position)
  gm.position AS expected_payout_cycle
FROM group_members gm
JOIN groups g ON gm.group_id = g.id
WHERE gm.status = 'active'
ORDER BY g.status DESC, g.current_cycle DESC, gm.joined_at DESC;

COMMENT ON VIEW user_groups_detail IS 
  'Detailed information about each user''s group memberships and financial status';

-- ============================================================================
-- VIEW: pending_payouts_view
-- ============================================================================
-- Lists all pending payouts that need to be processed
-- Used for payout processing and monitoring
-- ============================================================================

CREATE OR REPLACE VIEW pending_payouts_view AS
SELECT 
  p.id AS payout_id,
  p.related_group_id,
  g.name AS group_name,
  p.cycle_number,
  p.recipient_id,
  u.full_name AS recipient_name,
  u.email AS recipient_email,
  u.phone AS recipient_phone,
  p.amount,
  p.status,
  p.payout_date,
  p.created_at,
  -- Group details
  g.contribution_amount,
  g.service_fee_percentage,
  g.total_members,
  -- Check if all contributions are paid for this cycle
  (SELECT COUNT(*) 
   FROM contributions c 
   WHERE c.group_id = p.related_group_id 
   AND c.cycle_number = p.cycle_number 
   AND c.status = 'paid'
  ) AS paid_contributions_count,
  -- Calculate if payout is ready
  CASE 
    WHEN (SELECT COUNT(*) 
          FROM contributions c 
          WHERE c.group_id = p.related_group_id 
          AND c.cycle_number = p.cycle_number 
          AND c.status = 'paid') = g.total_members 
    THEN true
    ELSE false
  END AS is_ready_for_payout
FROM payouts p
JOIN groups g ON p.related_group_id = g.id
JOIN users u ON p.recipient_id = u.id
WHERE p.status = 'pending'
  AND g.status = 'active'
ORDER BY p.payout_date ASC, p.created_at ASC;

COMMENT ON VIEW pending_payouts_view IS 
  'Pending payouts with readiness status for processing';

-- ============================================================================
-- VIEW: group_financial_summary
-- ============================================================================
-- Financial summary for each group including all money flows
-- Used for financial reporting and reconciliation
-- ============================================================================

CREATE OR REPLACE VIEW group_financial_summary AS
SELECT 
  g.id AS group_id,
  g.name AS group_name,
  g.status,
  g.contribution_amount,
  g.frequency,
  g.total_members,
  g.current_cycle,
  g.total_cycles,
  -- Security deposits
  COALESCE(SUM(DISTINCT gm.security_deposit_amount), 0) AS total_security_deposits,
  COUNT(DISTINCT CASE WHEN gm.has_paid_security_deposit THEN gm.user_id END) AS members_paid_deposit,
  -- Contributions
  COALESCE(SUM(CASE WHEN c.status = 'paid' THEN c.amount ELSE 0 END), 0) AS total_contributions_collected,
  COALESCE(SUM(CASE WHEN c.status = 'paid' THEN c.service_fee ELSE 0 END), 0) AS total_service_fees,
  COUNT(CASE WHEN c.status = 'paid' THEN 1 END) AS total_paid_contributions,
  COUNT(CASE WHEN c.status = 'pending' THEN 1 END) AS total_pending_contributions,
  -- Payouts
  COALESCE(SUM(CASE WHEN p.status = 'completed' THEN p.amount ELSE 0 END), 0) AS total_payouts_disbursed,
  COUNT(CASE WHEN p.status = 'completed' THEN 1 END) AS total_payouts_completed,
  -- Penalties
  COALESCE(SUM(CASE WHEN pen.status = 'applied' THEN pen.amount ELSE 0 END), 0) AS total_penalties_applied,
  COALESCE(SUM(CASE WHEN pen.status = 'paid' THEN pen.amount ELSE 0 END), 0) AS total_penalties_collected,
  -- Expected totals
  (g.contribution_amount * g.total_members * g.current_cycle) AS expected_total_contributions,
  -- Balance calculation
  (
    COALESCE(SUM(CASE WHEN c.status = 'paid' THEN c.amount ELSE 0 END), 0) -
    COALESCE(SUM(CASE WHEN p.status = 'completed' THEN p.amount ELSE 0 END), 0)
  ) AS current_pool_balance
FROM groups g
LEFT JOIN group_members gm ON g.id = gm.group_id
LEFT JOIN contributions c ON g.id = c.group_id
LEFT JOIN payouts p ON g.id = p.related_group_id
LEFT JOIN penalties pen ON g.id = pen.group_id
GROUP BY 
  g.id, g.name, g.status, g.contribution_amount, g.frequency,
  g.total_members, g.current_cycle, g.total_cycles
ORDER BY g.created_at DESC;

COMMENT ON VIEW group_financial_summary IS 
  'Complete financial summary for each group including all money flows';

-- ============================================================================
-- VIEW: user_notifications_unread
-- ============================================================================
-- Quick view of unread notifications for users
-- Optimized for notification badge counts and lists
-- ============================================================================

CREATE OR REPLACE VIEW user_notifications_unread AS
SELECT 
  n.id,
  n.user_id,
  n.type,
  n.title,
  n.message,
  n.created_at,
  n.related_group_id,
  g.name AS group_name,
  -- Calculate age of notification
  EXTRACT(EPOCH FROM (NOW() - n.created_at))::INTEGER AS seconds_old,
  CASE 
    WHEN EXTRACT(EPOCH FROM (NOW() - n.created_at)) < 3600 THEN 'recent'
    WHEN EXTRACT(EPOCH FROM (NOW() - n.created_at)) < 86400 THEN 'today'
    WHEN EXTRACT(EPOCH FROM (NOW() - n.created_at)) < 604800 THEN 'this_week'
    ELSE 'older'
  END AS age_category
FROM notifications n
LEFT JOIN groups g ON n.related_group_id = g.id
WHERE n.is_read = false
ORDER BY n.created_at DESC;

COMMENT ON VIEW user_notifications_unread IS 
  'Unread notifications with age categorization for users';

-- ============================================================================
-- VIEW: audit_trail_view
-- ============================================================================
-- Comprehensive audit trail with user-friendly information
-- Used for compliance and security monitoring
-- ============================================================================

CREATE OR REPLACE VIEW audit_trail_view AS
SELECT 
  a.id,
  a.user_id,
  u.full_name AS user_name,
  u.email AS user_email,
  a.action,
  a.resource_type,
  a.resource_id,
  a.details,
  a.ip_address,
  a.user_agent,
  a.created_at,

  -- Resolve resource name safely based on resource type
  CASE a.resource_type
    WHEN 'group' THEN (
      SELECT g.name
      FROM groups g
      WHERE g.id = a.resource_id
      LIMIT 1
    )
    WHEN 'contribution' THEN (
      SELECT 'Contribution #' || c.id
      FROM contributions c
      WHERE c.id = a.resource_id
      LIMIT 1
    )
    WHEN 'payout' THEN (
      SELECT 'Payout #' || p.id
      FROM payouts p
      WHERE p.id = a.resource_id
      LIMIT 1
    )
    ELSE a.resource_id::text
  END AS resource_name

FROM audit_logs a
LEFT JOIN users u 
  ON a.user_id = u.id

ORDER BY a.created_at DESC;

COMMENT ON VIEW audit_trail_view IS 
  'User-friendly audit trail with resolved names and context';

-- ============================================================================
-- GRANTS: Ensure authenticated users can read from views
-- ============================================================================

-- Grant SELECT on all views to authenticated users
GRANT SELECT ON active_groups_summary TO authenticated;
GRANT SELECT ON user_dashboard_view TO authenticated;
GRANT SELECT ON group_contribution_progress TO authenticated;
GRANT SELECT ON overdue_contributions_view TO authenticated;
GRANT SELECT ON user_groups_detail TO authenticated;
GRANT SELECT ON pending_payouts_view TO authenticated;
GRANT SELECT ON group_financial_summary TO authenticated;
GRANT SELECT ON user_notifications_unread TO authenticated;
GRANT SELECT ON audit_trail_view TO authenticated;

-- Grant all access to service role
GRANT ALL ON active_groups_summary TO service_role;
GRANT ALL ON user_dashboard_view TO service_role;
GRANT ALL ON group_contribution_progress TO service_role;
GRANT ALL ON overdue_contributions_view TO service_role;
GRANT ALL ON user_groups_detail TO service_role;
GRANT ALL ON pending_payouts_view TO service_role;
GRANT ALL ON group_financial_summary TO service_role;
GRANT ALL ON user_notifications_unread TO service_role;
GRANT ALL ON audit_trail_view TO service_role;

-- ============================================================================
-- END OF VIEWS
-- ============================================================================
--
-- USAGE:
-- 1. Run this file after schema.sql has been executed
-- 2. Views will be available immediately for queries
-- 3. Use views in your application to simplify complex queries
-- 4. Example: SELECT * FROM active_groups_summary WHERE is_full = false;
--
-- NOTES:
-- - Views are automatically updated when underlying tables change
-- - Views use the same RLS policies as their underlying tables
-- - Some views may be slower for large datasets - use with appropriate filters
-- - Consider creating materialized views for very complex aggregations
--
-- ============================================================================
