# Test Plan: Group Creation Payment Flow Fix

## Overview
This document outlines the testing strategy for validating the fix to the group creation payment flow issue where orphaned groups were created when payment initialization failed.

## Problem Fixed
- **Issue**: When payment initialization failed, groups were created in the database but couldn't be deleted due to missing RLS DELETE policy
- **Solution**: Added `groups_delete_creator_empty` RLS policy to allow group creators to delete their own groups when `current_members = 0`

## Test Scenarios

### Scenario 1: Successful Group Creation Flow (Happy Path)
**Steps:**
1. User fills out group creation form with valid data
2. User clicks "Create Group" button
3. Group is created in database
4. Payment dialog opens
5. User selects a payout slot
6. User clicks "Pay" button
7. Payment initialization succeeds
8. Paystack payment popup opens
9. User completes payment successfully
10. Payment is verified
11. Creator is added as first member with `is_creator = true`
12. Group `current_members` is incremented to 1

**Expected Result:**
- ✓ Group exists in database with 1 member
- ✓ Creator is the first member
- ✓ User is redirected to group detail page
- ✓ Success toast message displayed

**Verification:**
```sql
-- Check group exists with correct member count
SELECT id, name, created_by, current_members, status 
FROM groups 
WHERE id = '<group_id>';

-- Check creator is a member
SELECT user_id, is_creator, position, status 
FROM group_members 
WHERE group_id = '<group_id>';
```

### Scenario 2: Payment Initialization Fails (Main Fix Validation)
**Steps:**
1. User fills out group creation form
2. User clicks "Create Group" button
3. Group is created in database (current_members = 0)
4. Payment initialization fails (simulated by database error or network issue)
5. Error toast shows "Failed to initialize payment"
6. Cleanup code calls `deleteGroup(groupId)`
7. DELETE operation executes (previously blocked, now allowed by new policy)

**Expected Result:**
- ✓ Group is deleted from database
- ✓ No orphaned group remains
- ✓ Error message displayed to user
- ✓ User is redirected back to groups list

**Verification:**
```sql
-- Check group does NOT exist
SELECT id, name, created_by, current_members 
FROM groups 
WHERE id = '<group_id>';
-- Should return 0 rows

-- Check no orphaned group members
SELECT * FROM group_members WHERE group_id = '<group_id>';
-- Should return 0 rows
```

**How to Simulate:**
- Temporarily modify Supabase to reject payment inserts
- Or disconnect network before payment initialization
- Or set invalid payment configuration

### Scenario 3: User Closes Payment Dialog Without Paying
**Steps:**
1. User creates group successfully
2. Payment dialog opens
3. User does NOT select a slot or click pay
4. User clicks "Cancel" or closes dialog
5. Cleanup code executes via `onOpenChange` handler

**Expected Result:**
- ✓ Group is deleted from database
- ✓ User is redirected to groups list
- ✓ Info toast: "Payment cancelled"

**Verification:**
```sql
SELECT id FROM groups WHERE id = '<group_id>';
-- Should return 0 rows
```

### Scenario 4: User Closes Paystack Popup Without Completing Payment
**Steps:**
1. User creates group and opens payment dialog
2. User selects payout slot
3. User clicks "Pay" button
4. Payment initialization succeeds
5. Paystack popup opens
6. User closes Paystack popup without paying
7. `onClose` handler in Paystack is triggered

**Expected Result:**
- ✓ Group is deleted (only if callback wasn't executed)
- ✓ User is redirected to groups list
- ✓ Toast: "Payment cancelled"

**Verification:**
```sql
SELECT id FROM groups WHERE id = '<group_id>';
-- Should return 0 rows

-- Check payment record exists but is pending/cancelled
SELECT reference, status, verified FROM payments WHERE reference LIKE 'GRP_CREATE_%';
```

### Scenario 5: Cannot Delete Group With Members (Edge Case)
**Steps:**
1. Admin/test user manually inserts a member into a group
2. Try to delete the group via API

**Expected Result:**
- ✗ DELETE is rejected by RLS policy
- ✗ Error message: "Cannot delete group with active members"

**Verification:**
```sql
-- Manually add a member
INSERT INTO group_members (group_id, user_id, position, status)
VALUES ('<group_id>', '<user_id>', 1, 'active');

-- Update current_members
UPDATE groups SET current_members = 1 WHERE id = '<group_id>';

-- Try to delete (should fail)
DELETE FROM groups WHERE id = '<group_id>';
-- Should be rejected by policy: current_members > 0
```

### Scenario 6: Non-Creator Cannot Delete Group (Security Test)
**Steps:**
1. User A creates a group (current_members = 0)
2. User B tries to delete User A's group

**Expected Result:**
- ✗ DELETE is rejected by RLS policy
- ✗ Error message: "Only the group creator can delete this group"

**Verification:**
```sql
-- As user B, try to delete user A's group
-- Should be rejected: auth.uid() != created_by
DELETE FROM groups WHERE id = '<group_id>' AND created_by != '<user_b_id>';
```

### Scenario 7: Platform Admin Can Delete Any Group
**Steps:**
1. Regular user creates a group (current_members = 0)
2. Platform admin (is_admin = true) tries to delete the group

**Expected Result:**
- ✓ DELETE succeeds
- ✓ Group is removed from database

**Verification:**
```sql
-- As admin user with is_admin = true
DELETE FROM groups WHERE id = '<group_id>';
-- Should succeed via is_current_user_admin() check
```

## Testing Checklist

### Pre-Deployment Testing
- [ ] Run SQL migration on development database
- [ ] Verify policy is created: `\d+ groups` shows the new policy
- [ ] Test Scenario 2 (main fix validation)
- [ ] Test Scenario 3 (dialog cancellation)
- [ ] Test Scenario 5 (cannot delete with members)
- [ ] Test Scenario 6 (security - non-creator cannot delete)

### Post-Deployment Testing
- [ ] Monitor Supabase logs for DELETE operations
- [ ] Check for orphaned groups created before fix
- [ ] Verify no errors in production logs
- [ ] Test happy path (Scenario 1) in production

### Regression Testing
- [ ] Existing group operations still work (view, update, join)
- [ ] Payment flow for joining groups unaffected
- [ ] Admin panel group management still functional

## SQL Queries for Monitoring

### Find Orphaned Groups (created but no members)
```sql
SELECT 
  g.id, 
  g.name, 
  g.created_by, 
  g.current_members,
  g.status,
  g.created_at,
  COALESCE(COUNT(gm.id), 0) as actual_member_count
FROM groups g
LEFT JOIN group_members gm ON g.id = gm.group_id
WHERE g.current_members = 0 AND g.status = 'forming'
GROUP BY g.id, g.name, g.created_by, g.current_members, g.status, g.created_at
HAVING COALESCE(COUNT(gm.id), 0) = 0;
```

### Check Recent Failed Group Creations
```sql
SELECT 
  g.id,
  g.name,
  g.created_at,
  p.reference,
  p.status as payment_status,
  p.verified
FROM groups g
LEFT JOIN payments p ON p.metadata->>'group_id' = g.id::text 
  AND p.metadata->>'type' = 'group_creation'
WHERE g.current_members = 0 
  AND g.status = 'forming'
  AND g.created_at > NOW() - INTERVAL '1 day'
ORDER BY g.created_at DESC;
```

### Verify Policy Exists
```sql
SELECT 
  polname as policy_name,
  polcmd as command,
  polroles::regrole[] as roles,
  pg_get_expr(polqual, polrelid) as using_expression
FROM pg_policy 
WHERE polrelid = 'groups'::regclass
  AND polname = 'groups_delete_creator_empty';
```

## Success Criteria

The fix is considered successful if:

1. ✓ No orphaned groups are created after payment initialization failures
2. ✓ Group creators can successfully delete their own empty groups
3. ✓ Group creators CANNOT delete groups with members (security preserved)
4. ✓ Non-creators CANNOT delete groups they didn't create (security preserved)
5. ✓ Platform admins CAN delete any group (admin functionality preserved)
6. ✓ Happy path (successful group creation with payment) continues to work
7. ✓ No increase in error rates or user complaints about group creation

## Rollback Plan

If issues are discovered:

1. **Immediate**: Drop the policy
   ```sql
   DROP POLICY IF EXISTS groups_delete_creator_empty ON groups;
   ```

2. **Alternative**: Modify policy to be more restrictive
   ```sql
   CREATE OR REPLACE POLICY groups_delete_creator_empty ON groups
     FOR DELETE
     USING (
       auth.uid() = created_by 
       AND current_members = 0 
       AND status = 'forming'
       AND created_at > NOW() - INTERVAL '1 hour' -- Only allow deletion within 1 hour of creation
     );
   ```

3. **Notify**: Inform users via support channels if rollback affects pending operations

## Additional Notes

- **Timing**: The cleanup happens immediately when payment initialization fails or dialog is closed
- **Database Cascade**: When group is deleted, related records (group_members, etc.) are also deleted due to `ON DELETE CASCADE`
- **Audit Trail**: Consider adding logging to track group deletions for debugging
- **Monitoring**: Set up alerts for sudden spikes in group deletion events

## Related Files
- `supabase/schema.sql` - Main schema with new policy
- `supabase/migrations/add_groups_delete_policy.sql` - Migration file
- `src/api/groups.ts` - `deleteGroup()` function
- `src/pages/CreateGroupPage.tsx` - Group creation and cleanup logic
