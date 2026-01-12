-- ============================================================================
-- SECURED-AJO REALTIME CONFIGURATION
-- ============================================================================
-- This file configures Supabase Realtime for live updates and subscriptions.
-- Realtime allows clients to listen to database changes in real-time.
--
-- IMPORTANT: Run this file after schema.sql has been executed.
-- ============================================================================

-- ============================================================================
-- REALTIME PUBLICATIONS
-- ============================================================================
-- Supabase uses PostgreSQL's logical replication for realtime features.
-- Publications define which tables and operations are broadcasted.
-- ============================================================================

-- ============================================================================
-- ENABLE REALTIME FOR TABLES
-- ============================================================================
-- Enable realtime for tables that need live updates
-- Note: Realtime respects RLS policies
-- ============================================================================

-- Enable realtime on groups table
-- Use case: Live updates when group status changes, new members join
ALTER PUBLICATION supabase_realtime ADD TABLE groups;

-- Enable realtime on group_members table
-- Use case: Live updates when members join/leave groups
ALTER PUBLICATION supabase_realtime ADD TABLE group_members;

-- Enable realtime on contributions table
-- Use case: Live updates when contributions are paid
ALTER PUBLICATION supabase_realtime ADD TABLE contributions;

-- Enable realtime on payouts table
-- Use case: Live updates when payouts are processed
ALTER PUBLICATION supabase_realtime ADD TABLE payouts;

-- Enable realtime on notifications table
-- Use case: Instant notification delivery to users
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- Enable realtime on transactions table
-- Use case: Live transaction status updates
ALTER PUBLICATION supabase_realtime ADD TABLE transactions;

-- Enable realtime on penalties table
-- Use case: Live updates when penalties are applied
ALTER PUBLICATION supabase_realtime ADD TABLE penalties;

-- ============================================================================
-- REALTIME FILTERS (RLS Integration)
-- ============================================================================
-- Realtime automatically respects Row Level Security (RLS) policies
-- Users will only receive updates for data they have access to
-- No additional configuration needed - RLS policies handle filtering
-- ============================================================================

-- ============================================================================
-- BROADCAST CONFIGURATION
-- ============================================================================
-- Create helper functions for broadcasting custom events
-- ============================================================================

-- Function to broadcast group status changes
CREATE OR REPLACE FUNCTION broadcast_group_status_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Supabase Realtime will automatically broadcast this change
  -- Additional custom logic can be added here if needed
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to broadcast group status changes
CREATE TRIGGER broadcast_group_status
AFTER UPDATE OF status ON groups
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION broadcast_group_status_change();

-- Function to broadcast contribution payments
CREATE OR REPLACE FUNCTION broadcast_contribution_payment()
RETURNS TRIGGER AS $$
BEGIN
  -- Notify group members about contribution payment
  -- Realtime will broadcast the contribution update
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to broadcast contribution payments
CREATE TRIGGER broadcast_contribution_update
AFTER UPDATE OF status ON contributions
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'paid')
EXECUTE FUNCTION broadcast_contribution_payment();

-- ============================================================================
-- PRESENCE TRACKING (Optional)
-- ============================================================================
-- Supabase Realtime supports presence tracking for online users
-- This can be used to show which group members are currently online
-- Implemented on the client side, but we can create a helper table
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_presence (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  online_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(20) DEFAULT 'online' CHECK (status IN ('online', 'away', 'offline')),
  last_seen TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookups
CREATE INDEX idx_user_presence_status ON user_presence(status);
CREATE INDEX idx_user_presence_online_at ON user_presence(online_at);

-- Enable RLS
ALTER TABLE user_presence ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view presence of members in their groups
CREATE POLICY user_presence_select_group_members ON user_presence
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM group_members gm1
      WHERE gm1.user_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM group_members gm2
        WHERE gm2.user_id = user_presence.user_id
        AND gm2.group_id = gm1.group_id
      )
    )
  );

-- RLS Policy: Users can update their own presence
CREATE POLICY user_presence_update_own ON user_presence
  FOR ALL
  USING (auth.uid() = user_id);

-- Enable realtime on presence table
ALTER PUBLICATION supabase_realtime ADD TABLE user_presence;

-- ============================================================================
-- CLIENT-SIDE USAGE EXAMPLES
-- ============================================================================
--
-- TYPESCRIPT/JAVASCRIPT EXAMPLES:
--
-- 1. Subscribe to group changes:
-- ```typescript
-- const groupChannel = supabase
--   .channel('group-changes')
--   .on(
--     'postgres_changes',
--     {
--       event: '*',
--       schema: 'public',
--       table: 'groups',
--       filter: `id=eq.${groupId}`
--     },
--     (payload) => {
--       console.log('Group updated:', payload)
--       // Update UI with new group data
--     }
--   )
--   .subscribe()
-- ```
--
-- 2. Subscribe to contributions for a group:
-- ```typescript
-- const contributionChannel = supabase
--   .channel('contribution-updates')
--   .on(
--     'postgres_changes',
--     {
--       event: 'UPDATE',
--       schema: 'public',
--       table: 'contributions',
--       filter: `group_id=eq.${groupId}`
--     },
--     (payload) => {
--       console.log('Contribution updated:', payload)
--       // Refresh contribution list
--     }
--   )
--   .subscribe()
-- ```
--
-- 3. Subscribe to notifications:
-- ```typescript
-- const notificationChannel = supabase
--   .channel('user-notifications')
--   .on(
--     'postgres_changes',
--     {
--       event: 'INSERT',
--       schema: 'public',
--       table: 'notifications',
--       filter: `user_id=eq.${userId}`
--     },
--     (payload) => {
--       console.log('New notification:', payload)
--       // Show notification toast
--       // Play notification sound
--       // Update notification badge count
--     }
--   )
--   .subscribe()
-- ```
--
-- 4. Subscribe to payout updates:
-- ```typescript
-- const payoutChannel = supabase
--   .channel('payout-updates')
--   .on(
--     'postgres_changes',
--     {
--       event: '*',
--       schema: 'public',
--       table: 'payouts',
--       filter: `recipient_id=eq.${userId}`
--     },
--     (payload) => {
--       console.log('Payout updated:', payload)
--       // Show payout received notification
--     }
--   )
--   .subscribe()
-- ```
--
-- 5. Track user presence:
-- ```typescript
-- const presenceChannel = supabase.channel('group-presence')
--
-- // Track your presence
-- presenceChannel.on('presence', { event: 'sync' }, () => {
--   const state = presenceChannel.presenceState()
--   console.log('Online users:', state)
-- })
--
-- // Send presence
-- presenceChannel.track({
--   user_id: userId,
--   online_at: new Date().toISOString(),
--   status: 'online'
-- })
--
-- presenceChannel.subscribe()
-- ```
--
-- 6. Broadcast custom messages (for chat, etc.):
-- ```typescript
-- const chatChannel = supabase.channel(`group-chat-${groupId}`)
--
-- // Listen for messages
-- chatChannel.on('broadcast', { event: 'message' }, (payload) => {
--   console.log('New message:', payload)
-- })
--
-- // Send message
-- chatChannel.send({
--   type: 'broadcast',
--   event: 'message',
--   payload: {
--     user_id: userId,
--     message: 'Hello group!',
--     timestamp: new Date().toISOString()
--   }
-- })
--
-- chatChannel.subscribe()
-- ```
--
-- 7. Unsubscribe from channels:
-- ```typescript
-- await supabase.removeChannel(channelName)
-- // or
-- await channel.unsubscribe()
-- ```
--
-- ============================================================================

-- ============================================================================
-- PERFORMANCE CONSIDERATIONS
-- ============================================================================
--
-- 1. **Connection Limits**: Each realtime subscription uses a connection.
--    - Limit subscriptions per client
--    - Use filters to reduce data volume
--    - Unsubscribe when component unmounts
--
-- 2. **RLS Performance**: Realtime respects RLS, which can impact performance
--    - Ensure RLS policies are optimized
--    - Use indexed columns in RLS policies
--    - Test with realistic user counts
--
-- 3. **Message Size**: Keep broadcasted messages small
--    - Use specific column filters
--    - Avoid SELECT * in triggers
--    - Fetch additional data separately if needed
--
-- 4. **Rate Limiting**: Implement client-side rate limiting
--    - Debounce rapid updates
--    - Batch updates when possible
--    - Use throttling for UI updates
--
-- ============================================================================

-- ============================================================================
-- MONITORING FUNCTIONS
-- ============================================================================

-- Function to get active realtime connections count
CREATE OR REPLACE FUNCTION get_realtime_connections()
RETURNS TABLE (
  topic TEXT,
  connection_count BIGINT
) AS $$
BEGIN
  -- Note: Actual implementation depends on Supabase internals
  -- This is a placeholder that can be customized
  RETURN QUERY
  SELECT 
    'notifications' AS topic,
    COUNT(*)::BIGINT AS connection_count
  FROM users
  WHERE is_active = true;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_realtime_connections IS 
  'Returns count of active realtime connections by topic';

-- ============================================================================
-- TROUBLESHOOTING
-- ============================================================================
--
-- Issue: Realtime updates not working
-- Solution: 
--   1. Check if table is added to publication: 
--      SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
--   2. Verify RLS policies allow access
--   3. Check client subscription code
--   4. Verify Supabase project URL and anon key
--
-- Issue: Too many connections
-- Solution:
--   1. Limit subscriptions per client
--   2. Unsubscribe when components unmount
--   3. Use channel multiplexing
--   4. Consider upgrading Supabase plan
--
-- Issue: Slow realtime updates
-- Solution:
--   1. Optimize RLS policies
--   2. Add appropriate indexes
--   3. Reduce payload size with filters
--   4. Use specific event types (INSERT/UPDATE/DELETE)
--
-- ============================================================================

-- ============================================================================
-- SECURITY NOTES
-- ============================================================================
--
-- 1. **RLS Protection**: Realtime automatically respects RLS policies
--    - Users only receive updates for data they can access
--    - No additional security configuration needed
--    - Test RLS policies thoroughly
--
-- 2. **Anon Key Usage**: Use SUPABASE_ANON_KEY for client connections
--    - Never expose service role key to clients
--    - Anon key is safe for browser/mobile apps
--    - RLS enforces authorization
--
-- 3. **Presence Data**: Be careful with presence data
--    - Don't expose sensitive user information
--    - Use RLS to control who sees presence
--    - Consider privacy implications
--
-- 4. **Broadcast Messages**: Broadcast is not RLS-protected by default
--    - Implement application-level authorization
--    - Validate user permissions before broadcasting
--    - Don't send sensitive data via broadcast
--
-- ============================================================================

-- ============================================================================
-- END OF REALTIME CONFIGURATION
-- ============================================================================
--
-- SETUP INSTRUCTIONS:
-- 1. Run this file after schema.sql has been executed
-- 2. Realtime is automatically enabled on added tables
-- 3. Implement client-side subscriptions using examples above
-- 4. Test subscriptions with RLS policies
-- 5. Monitor performance and connections
--
-- VERIFICATION:
-- -- Check enabled tables:
-- SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
--
-- -- Test subscription from client:
-- -- Use browser console or test app to verify realtime updates
--
-- ============================================================================
