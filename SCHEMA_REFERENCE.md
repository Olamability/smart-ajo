# Database Schema Reference

Quick reference guide for the Smart Ajo database schema.

## 📊 Entity Relationship Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SMART AJO DATABASE SCHEMA                     │
└─────────────────────────────────────────────────────────────────────┘

┌──────────┐         ┌──────────┐         ┌────────────────┐
│  USERS   │────────>│ WALLETS  │         │     GROUPS     │
│          │  1:1    │          │         │                │
│  - id    │         │  - id    │         │  - id          │
│  - email │         │  - user  │         │  - created_by  │
│  - phone │         │  - balance│        │  - name        │
└────┬─────┘         └──────────┘         └───────┬────────┘
     │                                            │
     │ 1:N                                    1:N │
     │                                            │
     └──────────────────┐           ┌────────────┘
                        │           │
                   ┌────▼───────────▼────┐
                   │  GROUP_MEMBERS      │
                   │                     │
                   │  - user_id (PK)     │
                   │  - group_id (PK)    │
                   │  - position         │
                   │  - status           │
                   └─────────────────────┘
                            │
           ┌────────────────┼────────────────┐
           │                │                │
      ┌────▼────────┐  ┌───▼────────┐  ┌───▼──────────┐
      │CONTRIBUTIONS│  │TRANSACTIONS│  │   PAYOUTS    │
      │             │  │            │  │              │
      │- user_id    │  │- user_id   │  │- recipient_id│
      │- group_id   │  │- group_id  │  │- group_id    │
      │- amount     │  │- amount    │  │- amount      │
      │- status     │  │- type      │  │- status      │
      └─────────────┘  └────────────┘  └──────────────┘
```

## 📋 Table Summary

| Table | Rows Expected | Purpose | Key Fields |
|-------|---------------|---------|------------|
| **users** | 100-10,000+ | User accounts & profiles | id, email, phone, kyc_status |
| **wallets** | = users | Internal wallet system | user_id, balance, locked_balance |
| **groups** | 10-1,000+ | Ajo/ROSCA groups | id, created_by, status, contribution_amount |
| **group_members** | 1K-100K+ | Group membership | user_id, group_id, position, status |
| **group_join_requests** | 100-10K+ | Join requests | group_id, user_id, status |
| **payout_slots** | = groups * members | Payout positions | group_id, slot_number, assigned_to |
| **contributions** | 10K-1M+ | Contribution tracking | user_id, group_id, cycle_number, status |
| **transactions** | 10K-1M+ | All financial transactions | user_id, type, amount, reference |
| **payouts** | 1K-100K+ | Member payouts | recipient_id, group_id, cycle_number |
| **penalties** | 100-10K+ | Violation penalties | user_id, group_id, type, amount |
| **notifications** | 10K-1M+ | User notifications | user_id, type, is_read |
| **audit_logs** | 1K-100K+ | System audit trail | action, resource_type, user_id |

## 🗂️ Table Schemas

### USERS
```sql
users
├── id (UUID, PK) → auth.users.id
├── email (TEXT, UNIQUE, NOT NULL)
├── phone (TEXT, UNIQUE, NOT NULL)
├── full_name (TEXT, NOT NULL)
├── is_verified (BOOLEAN)
├── is_active (BOOLEAN)
├── is_admin (BOOLEAN)
├── kyc_status (ENUM: not_started, pending, approved, rejected)
├── kyc_data (JSONB)
├── bvn (TEXT)
├── date_of_birth (DATE)
├── address (TEXT)
├── avatar_url (TEXT)
├── bank_name (TEXT)
├── account_number (TEXT)
├── account_name (TEXT)
├── bank_code (TEXT)
├── created_at (TIMESTAMPTZ)
├── updated_at (TIMESTAMPTZ)
└── last_login_at (TIMESTAMPTZ)
```

### GROUPS
```sql
groups
├── id (UUID, PK)
├── name (TEXT, NOT NULL)
├── description (TEXT)
├── created_by (UUID, FK → users.id)
├── creator_profile_image (TEXT)
├── creator_phone (TEXT)
├── contribution_amount (DECIMAL)
├── security_deposit_amount (DECIMAL)
├── security_deposit_percentage (INTEGER)
├── service_fee_percentage (DECIMAL)
├── frequency (ENUM: daily, weekly, monthly)
├── total_members (INTEGER)
├── current_members (INTEGER)
├── status (ENUM: forming, active, paused, completed, cancelled)
├── current_cycle (INTEGER)
├── total_cycles (INTEGER)
├── start_date (DATE)
├── end_date (DATE)
├── created_at (TIMESTAMPTZ)
└── updated_at (TIMESTAMPTZ)
```

### GROUP_MEMBERS
```sql
group_members
├── user_id (UUID, PK, FK → users.id)
├── group_id (UUID, PK, FK → groups.id)
├── position (INTEGER)
├── status (ENUM: pending, active, suspended, removed)
├── security_deposit_amount (DECIMAL)
├── has_paid_security_deposit (BOOLEAN)
├── security_deposit_paid_at (TIMESTAMPTZ)
└── joined_at (TIMESTAMPTZ)
```

### CONTRIBUTIONS
```sql
contributions
├── id (UUID, PK)
├── group_id (UUID, FK → groups.id)
├── user_id (UUID, FK → users.id)
├── amount (DECIMAL)
├── cycle_number (INTEGER)
├── status (ENUM: pending, paid, overdue, waived)
├── due_date (DATE)
├── paid_date (TIMESTAMPTZ)
├── service_fee (DECIMAL)
├── is_overdue (BOOLEAN)
├── transaction_ref (TEXT)
├── created_at (TIMESTAMPTZ)
└── updated_at (TIMESTAMPTZ)
```

### TRANSACTIONS
```sql
transactions
├── id (UUID, PK)
├── user_id (UUID, FK → users.id)
├── group_id (UUID, FK → groups.id)
├── type (ENUM: contribution, payout, security_deposit, penalty, refund, deposit, withdrawal, fee)
├── amount (DECIMAL)
├── status (ENUM: pending, processing, completed, failed, cancelled)
├── reference (TEXT, UNIQUE)
├── description (TEXT)
├── from_wallet_id (UUID, FK → wallets.id)
├── to_wallet_id (UUID, FK → wallets.id)
├── metadata (JSONB)
├── created_at (TIMESTAMPTZ)
└── completed_at (TIMESTAMPTZ)
```

## 🔐 Row Level Security (RLS) Policies

### Access Patterns

| Table | User Access | Admin Access | Notes |
|-------|-------------|--------------|-------|
| users | Own profile | All users | Users can view/update own data |
| wallets | Own wallet | - | System manages updates |
| groups | All groups (read) | All groups | Users can view all, update own |
| group_members | Own groups | All | Members see group data |
| contributions | Own + group | All | Based on membership |
| transactions | Own only | All | Strict user isolation |
| payouts | Own + group | All | Recipients and members |
| notifications | Own only | - | User-specific only |
| audit_logs | None | Admin only | Admin access only |

## 🔄 Key RPC Functions

### User Management
```sql
-- Create user profile (called during signup)
create_user_profile_atomic(p_user_id, p_email, p_phone, p_full_name) → JSON

-- Check if user exists
check_user_exists(p_email, p_phone) → JSON
```

### Group Operations
```sql
-- Request to join group
request_to_join_group(p_group_id, p_user_id, p_message, p_preferred_slot) → JSON

-- Get pending join requests
get_pending_join_requests(p_group_id) → TABLE

-- Approve join request
approve_join_request(p_request_id, p_reviewer_id, p_assigned_position) → JSON

-- Reject join request
reject_join_request(p_request_id, p_reviewer_id, p_reason) → JSON
```

### Payout Slots
```sql
-- Initialize slots for a group
initialize_group_slots(p_group_id) → JSON

-- Get available slots
get_available_slots(p_group_id) → TABLE
```

### Admin Operations
```sql
-- Get system analytics
get_admin_analytics() → TABLE

-- Get all users
get_all_users_admin(p_limit, p_offset, p_search, p_is_active) → TABLE

-- Get all groups
get_all_groups_admin(p_limit, p_offset, p_status, p_search) → TABLE

-- Get audit logs
get_audit_logs_admin(p_limit, p_offset) → TABLE

-- Suspend/activate user
suspend_user_admin(p_user_id, p_is_active, p_reason) → JSON

-- Change group status
deactivate_group_admin(p_group_id, p_new_status, p_reason) → JSON
```

### Maintenance
```sql
-- Mark overdue contributions (run daily)
mark_overdue_contributions() → VOID

-- Get user dashboard summary
get_user_dashboard_summary(p_user_id) → JSON
```

## ⚡ Performance Indexes

### High-Traffic Queries
- `users(email)` - Login lookups
- `users(phone)` - Phone verification
- `group_members(user_id)` - User's groups
- `group_members(group_id)` - Group membership
- `contributions(user_id, status)` - User contributions
- `contributions(group_id, cycle_number)` - Cycle contributions
- `transactions(user_id, created_at)` - Transaction history
- `notifications(user_id, is_read)` - Unread notifications

### Composite Indexes
```sql
CREATE INDEX idx_group_members_user_status ON group_members(user_id, status);
CREATE INDEX idx_contributions_user_status ON contributions(user_id, status);
CREATE INDEX idx_contributions_group_cycle ON contributions(group_id, cycle_number, status);
CREATE INDEX idx_transactions_user_type ON transactions(user_id, type);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read) WHERE is_read = false;
```

## 🔔 Triggers

| Trigger | Table | Action | Function |
|---------|-------|--------|----------|
| update_*_updated_at | Multiple | BEFORE UPDATE | Update updated_at timestamp |
| create_wallet_on_user_creation | users | AFTER INSERT | Create wallet for new user |
| update_group_members_count | group_members | AFTER INSERT/UPDATE/DELETE | Update current_members in groups |

## 🗄️ Storage

### Buckets
- **avatars** (public) - User profile images
  - Path format: `{user_id}/avatar.{ext}`
  - Allowed formats: jpg, png, webp
  - Max size: 5MB (configurable)

### Storage Policies
- Users can upload/update/delete own avatar
- Anyone can view avatars (public bucket)

## 🎯 Common Query Patterns

### Get User's Active Groups
```sql
SELECT g.* 
FROM groups g
JOIN group_members gm ON g.id = gm.group_id
WHERE gm.user_id = $1 
  AND gm.status = 'active'
  AND g.status = 'active';
```

### Get Pending Contributions for User
```sql
SELECT * FROM contributions
WHERE user_id = $1
  AND status = 'pending'
  AND due_date >= CURRENT_DATE
ORDER BY due_date ASC;
```

### Get Group Financial Summary
```sql
SELECT 
  COUNT(DISTINCT gm.user_id) as total_members,
  COUNT(*) FILTER (WHERE c.status = 'paid') as paid_contributions,
  SUM(c.amount) FILTER (WHERE c.status = 'paid') as total_collected
FROM groups g
LEFT JOIN group_members gm ON g.id = gm.group_id
LEFT JOIN contributions c ON g.id = c.group_id
WHERE g.id = $1
GROUP BY g.id;
```

## 📚 Data Types Reference

### ENUMs
- **kyc_status_enum**: not_started, pending, approved, rejected
- **group_status_enum**: forming, active, paused, completed, cancelled
- **member_status_enum**: pending, active, suspended, removed
- **frequency_enum**: daily, weekly, monthly
- **contribution_status_enum**: pending, paid, overdue, waived
- **transaction_type_enum**: contribution, payout, security_deposit, penalty, refund, deposit, withdrawal, fee
- **transaction_status_enum**: pending, processing, completed, failed, cancelled
- **payout_status_enum**: pending, processing, completed, failed
- **penalty_type_enum**: late_payment, missed_payment, early_exit
- **penalty_status_enum**: applied, paid, waived
- **join_request_status_enum**: pending, approved, rejected
- **slot_status_enum**: available, reserved, assigned
- **notification_type_enum**: payment_due, payment_received, payment_overdue, payout_ready, payout_processed, penalty_applied, group_complete, group_started, member_joined, member_removed, system_announcement

---

**Quick Tip**: Use this reference when writing queries or understanding the application data flow!
