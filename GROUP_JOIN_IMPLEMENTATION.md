# Group Join Request Implementation - Complete Guide

## Overview

This document describes the complete implementation of the group joining feature with slot selection for the Smart Ajo platform. This implementation allows members to select their preferred payout slot when joining a group, and provides group admins with full user information to make informed approval decisions.

## Problem Statement Requirements ✅

### Requirement 1: Members Can Select Preferred Slot
**Status: ✅ IMPLEMENTED**

Members can select their preferred payout slot when requesting to join a group.

**Implementation Details:**
- **Component**: `SlotSelector` component in join dialog
- **Database**: `group_payout_slots` table tracks slot status
- **Function**: `request_to_join_group()` validates and reserves slots
- **Location**: `src/pages/GroupDetailPage.tsx` lines 640-710

**Flow:**
1. User clicks "Join Group" button
2. Modal opens with `SlotSelector` showing available slots
3. User selects preferred slot and optionally adds a message
4. System validates slot availability
5. Slot is marked as "reserved" and join request is created
6. Admin receives request with slot preference

### Requirement 2: Join Request Submitted to Admin
**Status: ✅ IMPLEMENTED**

Join requests are submitted to the group creator (admin) with complete user information.

**Implementation Details:**
- **Database Table**: `group_join_requests`
- **Function**: `get_pending_join_requests()` - enhanced to include:
  - User full name
  - Email address
  - Phone number ✨ (NEW)
  - Avatar URL ✨ (NEW)
  - Preferred slot
  - Message
  - Request timestamp

**Location**: 
- Database: `supabase/migrations/enhance_join_requests_user_info.sql`
- Frontend: `src/pages/GroupDetailPage.tsx` lines 990-1070

### Requirement 3: Admin Can Accept or Reject
**Status: ✅ IMPLEMENTED**

Group admins can review and approve or reject join requests.

**Implementation Details:**
- **UI Component**: "Pending Join Requests" card (visible only to group creator)
- **Functions**:
  - `approveJoinRequest()` - Approves request and assigns slot
  - `rejectJoinRequest()` - Rejects request and releases reserved slot
- **Actions**:
  - Accept: User becomes member with "pending" status, slot is "assigned"
  - Reject: Request is marked rejected, slot released to "available"

**Location**: `src/pages/GroupDetailPage.tsx` lines 199-237

### Requirement 4: Admin Sees Full User Information
**Status: ✅ ENHANCED**

Admin sees comprehensive user information including:
- ✅ User avatar with fallback initials
- ✅ Full name
- ✅ Email address
- ✅ Phone number ✨ (NEW)
- ✅ Requested payout position (slot number)
- ✅ Optional message from user

**Location**: `src/pages/GroupDetailPage.tsx` lines 1001-1074

**Visual Improvements:**
- User avatar displayed prominently
- Phone number shown with phone icon
- Requested slot shown as a highlighted badge
- Message displayed in a bordered container
- Clean, professional layout for easy review

### Requirement 5: Admin Must Select Own Slot Before Payment
**Status: ✅ IMPLEMENTED**

Group creators must select their preferred payout slot before making payment.

**Implementation Details:**
- **Alert**: Orange alert "Complete Your Group Setup" displayed
- **Slot Selection**: `SlotSelector` component shown with all available slots
- **Validation**: Payment button disabled until slot is selected
- **Payment**: Includes security deposit + first contribution

**Location**: `src/pages/GroupDetailPage.tsx` lines 486-562

**Flow:**
1. Creator creates group → group status is "forming"
2. Creator views group detail page
3. Orange alert prompts slot selection
4. Creator selects preferred payout position
5. Payment breakdown shows total amount
6. Creator completes payment via Paystack
7. Creator becomes first active member with selected slot

## Database Schema

### Tables

#### `group_join_requests`
```sql
CREATE TABLE group_join_requests (
  id UUID PRIMARY KEY,
  group_id UUID REFERENCES groups(id),
  user_id UUID REFERENCES users(id),
  status VARCHAR(20) CHECK (status IN ('pending', 'approved', 'rejected')),
  preferred_slot INTEGER,  -- Requested payout position
  message TEXT,            -- Optional message from user
  reviewed_by UUID,        -- Admin who processed request
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  UNIQUE(group_id, user_id)
);
```

#### `group_payout_slots`
```sql
CREATE TABLE group_payout_slots (
  id UUID PRIMARY KEY,
  group_id UUID REFERENCES groups(id),
  slot_number INTEGER,     -- Position in rotation (1, 2, 3, ...)
  payout_cycle INTEGER,    -- Cycle when this slot receives payout
  status VARCHAR(20) CHECK (status IN ('available', 'reserved', 'assigned')),
  assigned_to UUID,        -- User who has this slot (when assigned)
  reserved_by UUID,        -- User who requested this slot (when reserved)
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  UNIQUE(group_id, slot_number)
);
```

### Key Functions

#### `request_to_join_group()`
```sql
CREATE FUNCTION request_to_join_group(
  p_group_id UUID,
  p_user_id UUID,
  p_preferred_slot INTEGER DEFAULT NULL,
  p_message TEXT DEFAULT NULL
) RETURNS TABLE(success BOOLEAN, error_message TEXT)
```

**What it does:**
1. Validates group is accepting members (status = 'forming')
2. Checks group is not full
3. Validates slot is available if specified
4. Reserves the slot (status → 'reserved')
5. Creates join request with status 'pending'

#### `get_pending_join_requests()` ✨ ENHANCED
```sql
CREATE FUNCTION get_pending_join_requests(p_group_id UUID)
RETURNS TABLE(
  id UUID,
  user_id UUID,
  user_name VARCHAR(255),
  user_email VARCHAR(255),
  user_phone VARCHAR(20),      -- ✨ NEW
  user_avatar_url TEXT,        -- ✨ NEW
  preferred_slot INTEGER,
  message TEXT,
  created_at TIMESTAMPTZ
)
```

**Enhancements:**
- Added `user_phone` from `users.phone`
- Added `user_avatar_url` from `users.avatar_url`
- Provides complete user profile for admin review

#### `approve_join_request()`
```sql
CREATE FUNCTION approve_join_request(
  p_request_id UUID,
  p_reviewer_id UUID
) RETURNS TABLE(success BOOLEAN, error_message TEXT)
```

**What it does:**
1. Verifies reviewer is group creator
2. Changes slot status: 'reserved' → 'assigned'
3. Adds user to `group_members` with 'pending' status
4. Updates join request status to 'approved'
5. Creates notification for user

#### `reject_join_request()`
```sql
CREATE FUNCTION reject_join_request(
  p_request_id UUID,
  p_reviewer_id UUID,
  p_rejection_reason TEXT DEFAULT NULL
) RETURNS TABLE(success BOOLEAN, error_message TEXT)
```

**What it does:**
1. Verifies reviewer is group creator
2. Releases reserved slot: 'reserved' → 'available'
3. Updates join request status to 'rejected'
4. Creates notification for user with reason

## User Flows

### Flow 1: User Joins Group

```
1. Browse Available Groups
   ↓
2. Click "Join Group" on desired group
   ↓
3. Modal Opens → Shows SlotSelector
   ↓
4. User reviews available slots and their payout cycles
   ↓
5. User selects preferred slot (e.g., Position #3)
   ↓
6. (Optional) User adds message to admin
   ↓
7. User clicks "Send Request"
   ↓
8. System validates:
   - Group is accepting members
   - Slot is available
   - User not already a member
   ↓
9. Slot marked as "reserved"
   ↓
10. Join request created with status "pending"
    ↓
11. User sees "Request pending approval" message
```

### Flow 2: Admin Reviews and Approves Request

```
1. Admin views Group Detail Page
   ↓
2. "Pending Join Requests" card displays (only visible to creator)
   ↓
3. Admin sees request card with:
   - User avatar
   - Full name
   - Email address
   - Phone number ✨
   - Requested Position badge (e.g., #3)
   - Optional message
   ↓
4. Admin reviews user information
   ↓
5a. Admin clicks "Accept"
    ↓
    - Slot status: reserved → assigned
    - User added to group_members (status: pending)
    - User receives approval notification
    - User sees payment prompt with assigned position
    ↓
5b. Admin clicks "Reject"
    ↓
    - Slot status: reserved → available
    - Join request marked rejected
    - User receives rejection notification
    - User can request again with different slot
```

### Flow 3: Approved User Completes Payment

```
1. User views group detail page after approval
   ↓
2. Green alert displayed:
   "✅ Your request has been approved!"
   ↓
3. User sees:
   - Assigned payout position badge (e.g., #3)
   - Cycle information ("You'll receive payout in cycle 3")
   - Payment breakdown:
     * Security deposit: ₦10,000
     * First contribution: ₦50,000
     * Total: ₦60,000
   ↓
4. User clicks "Pay ₦60,000 to Join"
   ↓
5. Paystack payment modal opens
   ↓
6. User completes payment
   ↓
7. On success:
   - Member status: pending → active
   - Security deposit marked as paid
   - User becomes active group member
```

### Flow 4: Creator Activates Group

```
1. Creator creates group
   ↓
2. Group created with status "forming"
   ↓
3. Creator redirected to Group Detail Page
   ↓
4. Orange alert displayed:
   "Complete Your Group Setup"
   ↓
5. SlotSelector shown with all positions available
   ↓
6. Creator selects preferred payout position
   ↓
7. Position confirmed (e.g., "Position #1 Selected")
   ↓
8. Payment breakdown displayed:
   - Security deposit: ₦10,000
   - First contribution: ₦50,000
   - Total: ₦60,000
   ↓
9. Creator clicks "Pay ₦60,000 to Activate Group"
   ↓
10. Paystack payment processed
    ↓
11. On success:
    - Creator becomes first member (position #1)
    - Slot #1 marked as "assigned"
    - Group ready to accept other members
```

## Frontend Components

### SlotSelector Component
**Location**: `src/components/SlotSelector.tsx`

**Props:**
```typescript
interface SlotSelectorProps {
  groupId: string;
  selectedSlot: number | null;
  onSlotSelect: (slot: number | null) => void;
  disabled?: boolean;
}
```

**Features:**
- Fetches available slots via `getAvailableSlots()`
- Displays slots in grid layout
- Color coding:
  - Green: Available
  - Yellow: Reserved
  - Gray: Assigned
- Shows cycle information for each slot
- Interactive selection with visual feedback

### Join Dialog (GroupDetailPage)
**Location**: `src/pages/GroupDetailPage.tsx` lines 640-710

**Features:**
- Modal dialog with SlotSelector
- Optional message field
- "Send Request" button
- Loading states during submission
- Success/error feedback with toast notifications

### Pending Join Requests Card
**Location**: `src/pages/GroupDetailPage.tsx` lines 990-1074

**Enhanced Display (NEW):**
```
┌─────────────────────────────────────────────┐
│ [Avatar]  John Doe                         │
│           john@example.com                  │
│           📱 +234 123 456 7890              │
│                                             │
│           Requested Position: #3            │
│                                             │
│           "Looking forward to joining!"     │
│                                             │
│           [Accept] [Reject]                 │
└─────────────────────────────────────────────┘
```

**Components Used:**
- `Avatar` with fallback initials
- `Badge` for position number
- `Phone` icon from lucide-react
- `Button` components for actions

## API Functions

### Frontend API (`src/api/groups.ts`)

#### `joinGroup()`
```typescript
export const joinGroup = async (
  groupId: string,
  preferredSlot?: number,
  message?: string
): Promise<{ success: boolean; error?: string }>
```

**Usage:**
```typescript
const result = await joinGroup(groupId, 3, "Excited to join!");
if (result.success) {
  toast.success("Join request sent!");
}
```

#### `getPendingJoinRequests()`
```typescript
export const getPendingJoinRequests = async (
  groupId: string
): Promise<{ 
  success: boolean; 
  requests?: JoinRequest[]; 
  error?: string;
}>
```

**Returns:**
```typescript
interface JoinRequest {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  user_phone: string | null;      // ✨ NEW
  user_avatar_url: string | null; // ✨ NEW
  preferred_slot: number | null;
  message: string | null;
  created_at: string;
}
```

#### `approveJoinRequest()`
```typescript
export const approveJoinRequest = async (
  requestId: string
): Promise<{ success: boolean; error?: string }>
```

#### `rejectJoinRequest()`
```typescript
export const rejectJoinRequest = async (
  requestId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }>
```

#### `getAvailableSlots()`
```typescript
export const getAvailableSlots = async (
  groupId: string
): Promise<{
  success: boolean;
  slots?: { 
    slot_number: number;
    payout_cycle: number;
    status: string;
  }[];
  error?: string;
}>
```

## Security & Permissions

### Row Level Security (RLS)

#### Join Requests
```sql
-- Users can view their own join requests
CREATE POLICY group_join_requests_select_own
  FOR SELECT USING (auth.uid() = user_id);

-- Group creators can view requests for their groups
CREATE POLICY group_join_requests_select_creator
  FOR SELECT USING (is_group_creator(auth.uid(), group_id));

-- Users can create their own join requests
CREATE POLICY group_join_requests_insert_own
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Only creators can update (approve/reject) requests
CREATE POLICY group_join_requests_update_creator
  FOR UPDATE USING (is_group_creator(auth.uid(), group_id));
```

#### Payout Slots
```sql
-- Anyone can view slots (transparency)
CREATE POLICY group_payout_slots_select_all
  FOR SELECT USING (true);

-- Only system functions can modify slots
CREATE POLICY group_payout_slots_modify_system
  FOR ALL USING (current_setting('role', true) = 'service_role');
```

### Validation

**Backend Validation (SQL Functions):**
- ✅ Group must be in "forming" status
- ✅ Group must not be full
- ✅ User cannot be existing member
- ✅ User cannot have pending request already
- ✅ Slot must be available (if specified)
- ✅ Only group creator can approve/reject
- ✅ Request must be in "pending" status

**Frontend Validation:**
- ✅ Slot selection required before join
- ✅ Loading states prevent double-submission
- ✅ Error messages displayed to user
- ✅ Success feedback with toast notifications

## Testing Guide

### Manual Testing Checklist

#### Test 1: User Join Flow
- [ ] Navigate to available groups
- [ ] Click "Join Group" on a forming group
- [ ] Verify SlotSelector shows available slots
- [ ] Select a slot (e.g., Position #5)
- [ ] Add optional message
- [ ] Submit join request
- [ ] Verify success message
- [ ] Check request appears in pending state

#### Test 2: Admin Review Flow
- [ ] Login as group creator
- [ ] Navigate to group detail page
- [ ] Verify "Pending Join Requests" card visible
- [ ] Check request shows:
  - [ ] User avatar
  - [ ] Full name
  - [ ] Email
  - [ ] Phone number ✨
  - [ ] Requested position badge
  - [ ] Optional message
- [ ] Click "Accept" button
- [ ] Verify success notification
- [ ] Check user appears in members list with "pending" status

#### Test 3: Approved User Payment
- [ ] Login as approved user
- [ ] Navigate to group detail page
- [ ] Verify green "Approved!" alert displayed
- [ ] Check assigned position badge shown
- [ ] Verify payment breakdown visible
- [ ] Click payment button
- [ ] Complete Paystack payment
- [ ] Verify member status changes to "active"

#### Test 4: Creator Setup Flow
- [ ] Login and create new group
- [ ] Navigate to created group page
- [ ] Verify orange "Complete Setup" alert
- [ ] Select preferred payout position
- [ ] Verify position confirmation shown
- [ ] Review payment breakdown
- [ ] Complete payment
- [ ] Verify creator becomes active member

#### Test 5: Rejection Flow
- [ ] Admin clicks "Reject" on a request
- [ ] (Optional) Add rejection reason
- [ ] Verify request removed from pending list
- [ ] Login as rejected user
- [ ] Verify can submit new request
- [ ] Check previously requested slot is available again

#### Test 6: Slot Conflicts
- [ ] Two users request same slot
- [ ] Admin approves first request
- [ ] Verify slot becomes "assigned"
- [ ] Second request should fail if slot taken
- [ ] Verify proper error message shown

### Edge Cases to Test

1. **Group Full:**
   - [ ] Try to join when current_members = total_members
   - [ ] Verify appropriate error message

2. **Already Member:**
   - [ ] Try to join group user is already in
   - [ ] Verify error: "Already a member"

3. **Pending Request:**
   - [ ] Submit join request
   - [ ] Try to submit another request
   - [ ] Verify error: "Already have pending request"

4. **Invalid Slot:**
   - [ ] Request slot number > total_members
   - [ ] Request slot number < 1
   - [ ] Verify validation error

5. **Non-Creator Approval:**
   - [ ] Try to approve request as non-creator
   - [ ] Verify permission denied

6. **Group Status:**
   - [ ] Try to join "active" or "completed" group
   - [ ] Verify error: "Not accepting members"

## Database Migration Instructions

### Step 1: Apply Migration
Run the new migration file to enhance the `get_pending_join_requests` function:

```bash
# Using Supabase CLI
supabase db push

# Or apply manually in SQL Editor:
-- Copy contents of:
-- supabase/migrations/enhance_join_requests_user_info.sql
```

### Step 2: Verify Migration
```sql
-- Test the enhanced function
SELECT * FROM get_pending_join_requests('<group_id>');

-- Should return columns:
-- id, user_id, user_name, user_email, 
-- user_phone, user_avatar_url, preferred_slot, message, created_at
```

### Step 3: Check Permissions
```sql
-- Verify function is accessible to authenticated users
SELECT has_function_privilege(
  'authenticated',
  'get_pending_join_requests(uuid)',
  'execute'
); -- Should return true
```

## Deployment Checklist

- [ ] Review and test all code changes locally
- [ ] Apply database migration
- [ ] Verify migration with test data
- [ ] Test join flow end-to-end
- [ ] Test admin approval/rejection
- [ ] Test payment completion
- [ ] Verify RLS policies working correctly
- [ ] Check mobile responsiveness
- [ ] Test with multiple users simultaneously
- [ ] Verify notifications working
- [ ] Monitor error logs
- [ ] Document any breaking changes

## Known Limitations

1. **Slot Reassignment**: If an approved user's slot is somehow taken before payment, there's no automatic reassignment mechanism.
   
2. **Request Expiration**: Join requests don't automatically expire. Admins must manually reject old requests.

3. **Slot Release**: Reserved slots are only released when request is rejected. If user never completes request, slot stays reserved.

**Future Enhancements:**
- Auto-expire requests after 7 days
- Allow admin to reassign slots
- Implement request timeout for reserved slots
- Add bulk approve/reject for admins
- Email notifications for join requests

## Summary

This implementation provides a complete, production-ready group joining system with:

✅ **Slot Selection**: Members choose payout position when joining  
✅ **Admin Review**: Full user information for informed decisions  
✅ **Accept/Reject**: Simple workflow for managing join requests  
✅ **Creator Setup**: Admins must select own slot before payment  
✅ **Security**: RLS policies enforce permissions  
✅ **User Experience**: Clear UI with feedback at every step  
✅ **Enhanced Information**: Phone number and avatar now displayed ✨

All requirements from the problem statement have been successfully implemented!
