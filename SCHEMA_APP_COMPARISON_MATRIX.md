# Schema vs Application Comparison Matrix

Quick reference table showing alignment between database schema and application code.

---

## Enum Types Comparison

| Enum Type | Database Values | TypeScript Type | Status | Location |
|-----------|----------------|-----------------|--------|----------|
| **kyc_status** | `not_started`, `pending`, `approved`, `rejected` | `not_started \| pending \| verified \| rejected` | ⚠️ **MISMATCH** | `src/types/index.ts:12` |
| **group_status** | `forming`, `active`, `paused`, `completed`, `cancelled` | `forming \| active \| paused \| completed \| cancelled` | ✅ **MATCH** | `src/types/index.ts:40` |
| **member_status** | `pending`, `active`, `suspended`, `removed` | `pending \| active \| suspended \| removed` | ✅ **MATCH** | `src/types/index.ts:59` |
| **frequency** | `daily`, `weekly`, `monthly` | `daily \| weekly \| monthly` | ✅ **MATCH** | `src/types/index.ts:35` |
| **contribution_status** | `pending`, `paid`, `overdue`, `waived` | `pending \| paid \| overdue \| waived` | ✅ **MATCH** | `src/types/index.ts:104` |
| **transaction_type** | `contribution`, `payout`, `security_deposit`, `penalty`, `refund`, `deposit`, `withdrawal`, `fee` | `contribution \| payout \| security_deposit \| penalty \| refund` | ⚠️ **INCOMPLETE** | `src/types/index.ts:134` |
| **transaction_status** | `pending`, `processing`, `completed`, `failed`, `cancelled` | `pending \| processing \| completed \| failed \| cancelled` | ✅ **MATCH** | `src/types/index.ts:136` |
| **payout_status** | `pending`, `processing`, `completed`, `failed` | `pending \| processing \| completed \| failed` | ✅ **MATCH** | `src/types/index.ts:121` |
| **penalty_type** | `late_payment`, `missed_payment`, `early_exit` | `late_payment \| missed_payment \| early_exit` | ✅ **MATCH** | `src/types/index.ts:148` |
| **penalty_status** | `applied`, `paid`, `waived` | `applied \| paid \| waived` | ✅ **MATCH** | `src/types/index.ts:149` |
| **join_request_status** | `pending`, `approved`, `rejected` | `pending \| approved \| rejected` | ✅ **MATCH** | `src/types/index.ts:88` |
| **slot_status** | `available`, `reserved`, `assigned` | `available \| reserved \| assigned` | ✅ **MATCH** | `src/types/index.ts:72` |

**Summary:** 10/12 Perfect Match | 1 Known Mismatch (Handled) | 1 Incomplete

---

## Table Structure Comparison

| Table | TypeScript Interface | Fields Match | Relationships | Status |
|-------|---------------------|--------------|---------------|--------|
| `users` | `User` | ✅ All fields mapped | → `auth.users` | ✅ **ALIGNED** |
| `wallets` | `Wallet` (implicit) | ✅ Referenced in User | ← `users` | ✅ **ALIGNED** |
| `groups` | `Group` | ✅ All fields mapped | ← `users` (creator) | ✅ **ALIGNED** |
| `group_members` | `GroupMember` | ✅ All fields mapped | ← `users`, ← `groups` | ✅ **ALIGNED** |
| `group_join_requests` | `JoinRequest` | ✅ All fields mapped | ← `users`, ← `groups` | ✅ **ALIGNED** |
| `payout_slots` | `PayoutSlot` | ✅ All fields mapped | ← `groups`, ← `users` | ✅ **ALIGNED** |
| `contributions` | `Contribution` | ✅ All fields mapped | ← `groups`, ← `users` | ✅ **ALIGNED** |
| `transactions` | `Transaction` | ⚠️ Type enum incomplete | ← `users`, ← `groups` | ⚠️ **PARTIAL** |
| `payouts` | `Payout` | ✅ All fields mapped | ← `groups`, ← `users` | ✅ **ALIGNED** |
| `penalties` | `Penalty` | ✅ All fields mapped | ← `groups`, ← `users` | ✅ **ALIGNED** |
| `notifications` | `Notification` | ✅ All fields mapped | ← `users` | ✅ **ALIGNED** |
| `audit_logs` | Not exposed to frontend | N/A | Backend only | ✅ **CORRECT** |

**Summary:** 11/12 Fully Aligned | 1 Partial (Transaction type issue)

---

## Constants & Default Values

| Constant | Database Default | App Constant | Files Using | Status |
|----------|------------------|--------------|-------------|--------|
| **Service Fee %** | `2.00` | `DEFAULT_SERVICE_FEE_PERCENTAGE = 2` | `CreateGroupPage`, `groups.ts` API | ✅ **CORRECT** |
| **Service Fee % Fallback** | N/A | Hardcoded `10` in multiple files | `PaymentBreakdown`, `PayoutSchedule`, `GroupDetailPage` | ⚠️ **WRONG** |
| **Security Deposit %** | `10.00` | Calculated in components | Various | ✅ **CORRECT** |

**Issues:**
- ⚠️ Service fee fallback should be `2` not `10` (affects 4 files)

---

## RPC Functions Usage

| RPC Function | Defined in Schema | Called from App | Return Type Match | Status |
|--------------|------------------|-----------------|-------------------|--------|
| `create_user_profile_atomic` | ✅ | ✅ `api/auth.ts` | ✅ | ✅ **OK** |
| `check_user_exists` | ✅ | ✅ `api/auth.ts` | ✅ | ✅ **OK** |
| `create_user_profile` | ✅ | ✅ `api/profile.ts` | ✅ | ✅ **OK** |
| `request_to_join_group` | ✅ | ✅ `api/groups.ts` | ✅ | ✅ **OK** |
| `get_pending_join_requests` | ✅ | ✅ `api/groups.ts` | ✅ | ✅ **OK** |
| `approve_join_request` | ✅ | ✅ `api/groups.ts` | ✅ | ✅ **OK** |
| `reject_join_request` | ✅ | ✅ `api/groups.ts` | ✅ | ✅ **OK** |
| `get_available_slots` | ✅ | ✅ `api/groups.ts` | ✅ | ✅ **OK** |
| `initialize_group_slots` | ✅ | ✅ `api/groups.ts` | ✅ | ✅ **OK** |
| `get_admin_analytics` | ✅ | ✅ `api/admin.ts` | ✅ | ✅ **OK** |
| `get_all_users_admin` | ✅ | ✅ `api/admin.ts` | ✅ | ✅ **OK** |
| `get_all_groups_admin` | ✅ | ✅ `api/admin.ts` | ✅ | ✅ **OK** |
| `get_audit_logs_admin` | ✅ | ✅ `api/admin.ts` | ✅ | ✅ **OK** |
| `suspend_user_admin` | ✅ | ✅ `api/admin.ts` | ✅ | ✅ **OK** |
| `deactivate_group_admin` | ✅ | ✅ `api/admin.ts` | ✅ | ✅ **OK** |

**Summary:** 15/15 Functions Properly Used ✅

---

## Field Name Conversions

| Database (snake_case) | TypeScript (camelCase) | Conversion Location | Status |
|----------------------|------------------------|---------------------|--------|
| `service_fee_percentage` | `serviceFeePercentage` | API layers | ✅ **OK** |
| `created_at` | `createdAt` | API layers | ✅ **OK** |
| `updated_at` | `updatedAt` | API layers | ✅ **OK** |
| `kyc_status` | `kycStatus` | API layers | ✅ **OK** |
| `kyc_data` | `kycData` | API layers | ✅ **OK** |
| `full_name` | `fullName` | API layers | ✅ **OK** |
| `is_verified` | `isVerified` | API layers | ✅ **OK** |
| `is_active` | `isActive` | API layers | ✅ **OK** |
| `is_admin` | `isAdmin` | API layers | ✅ **OK** |
| `profile_image` | `profileImage` | API layers | ✅ **OK** |
| `date_of_birth` | `dateOfBirth` | API layers | ✅ **OK** |
| `bank_name` | `bankName` | API layers | ✅ **OK** |
| `account_number` | `accountNumber` | API layers | ✅ **OK** |
| `account_name` | `accountName` | API layers | ✅ **OK** |
| `bank_code` | `bankCode` | API layers | ✅ **OK** |
| `related_group_id` | `relatedGroupId` | API layers | ✅ **OK** |
| `recipient_id` | `recipientId` | API layers | ✅ **OK** |
| `security_deposit_amount` | `securityDepositAmount` | API layers | ✅ **OK** |
| `security_deposit_percentage` | `securityDepositPercentage` | API layers | ✅ **OK** |
| `security_deposit_paid` | `securityDepositPaid` | API layers | ✅ **OK** |

**Summary:** All field name conversions handled correctly ✅

---

## Security Features Comparison

| Feature | Database Implementation | App Implementation | Status |
|---------|------------------------|-------------------|--------|
| **RLS Enabled** | ✅ All 12 tables | Handled by Supabase client | ✅ **OK** |
| **User Isolation** | ✅ `auth.uid()` policies | Client checks user ID | ✅ **OK** |
| **Admin Access** | ✅ `is_admin` flag checks | Admin context provider | ✅ **OK** |
| **Group Member Access** | ✅ Member check policies | Client-side checks | ✅ **OK** |
| **Audit Logging** | ✅ `audit_logs` table | Not exposed to frontend | ✅ **OK** |
| **Password Storage** | ✅ Supabase Auth only | No local storage | ✅ **OK** |
| **Foreign Key Constraints** | ✅ All relationships | N/A (DB enforced) | ✅ **OK** |
| **Unique Constraints** | ✅ Email, phone, tx ref | Client validation | ✅ **OK** |

**Summary:** Security properly implemented ✅

---

## Issue Priority Matrix

| # | Issue | Severity | Impact | Files Affected | Action |
|---|-------|----------|--------|----------------|--------|
| 1 | Transaction type incomplete | 🔴 **CRITICAL** | Cannot create 3 transaction types | `types/index.ts` | **MUST FIX** |
| 2 | Service fee fallback wrong | 🟠 **HIGH** | Wrong calculations (10% vs 2%) | 4 component files | **SHOULD FIX** |
| 3 | KYC status mismatch | 🟡 **MEDIUM** | Type safety risk | `types/index.ts`, `api/profile.ts` | **HANDLED** |

---

## Recommendations Checklist

### Critical (Before Production)
- [ ] Add `'deposit' | 'withdrawal' | 'fee'` to Transaction type

### High Priority (This Sprint)
- [ ] Replace hardcoded `10` with `DEFAULT_SERVICE_FEE_PERCENTAGE` in:
  - [ ] `src/components/PaymentBreakdown.tsx:27`
  - [ ] `src/components/PayoutSchedule.tsx:49`
  - [ ] `src/pages/GroupDetailPage.tsx:366`
  - [ ] `src/pages/GroupDetailPage.tsx:824,840`

### Medium Priority (Next Sprint)
- [ ] Consider standardizing KYC status (DB `'approved'` → `'verified'`)
- [ ] Export enum constants to prevent typos
- [ ] Add runtime type validation with Zod

### Low Priority (Backlog)
- [ ] Add type guard functions
- [ ] Export notification type constants
- [ ] Add JSDoc comments for type conversions
- [ ] Write unit tests for conversion functions

---

## Testing Checklist

- [ ] Test `convertKycStatus()` function
- [ ] Test service fee calculations with correct percentage
- [ ] Test transaction type creation for all 8 types
- [ ] Test RPC function calls
- [ ] Test RLS policies
- [ ] Integration test for complete signup → group creation → contribution flow

---

**Last Updated:** 2026-02-03  
**Status:** 10/12 Enums Aligned | 2 Issues Identified  
**Production Ready:** ⚠️ After fixing critical issue #1

