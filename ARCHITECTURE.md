# Smart Ajo — System Architecture

Smart Ajo is a secure digital platform for managing rotating savings groups (Ajo/Esusu). Members contribute on a regular schedule and receive a lump-sum payout on a rotating basis, with escrow, enforced contributions, and guaranteed payouts handled automatically.

---

## Table of Contents

1. [High-Level Overview](#1-high-level-overview)
2. [Technology Stack](#2-technology-stack)
3. [Directory Structure](#3-directory-structure)
4. [Frontend Architecture](#4-frontend-architecture)
5. [Backend Architecture (Supabase)](#5-backend-architecture-supabase)
6. [Edge Functions (Serverless)](#6-edge-functions-serverless)
7. [Authentication Flow](#7-authentication-flow)
8. [Payment Integration (Paystack)](#8-payment-integration-paystack)
9. [TypeScript Types](#9-typescript-types)
10. [Environment Configuration](#10-environment-configuration)
11. [Deployment](#11-deployment)

---

## 1. High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        BROWSER (Client)                         │
│          React 18 + TypeScript + Vite + Tailwind CSS            │
│                                                                 │
│  ┌──────────────┐  ┌───────────────┐  ┌───────────────────┐    │
│  │  React Pages │  │ AuthContext   │  │  Service Layer    │    │
│  │  (Routing)   │  │ (JWT Session) │  │  (src/api/)       │    │
│  └──────────────┘  └───────────────┘  └───────────────────┘    │
│                             │                    │              │
└─────────────────────────────┼────────────────────┼─────────────┘
                              │  Supabase JS SDK   │
        ┌─────────────────────┼────────────────────┼──────────────┐
        │               SUPABASE (Backend)          │              │
        │                     │                    │              │
        │  ┌──────────────────▼──┐  ┌──────────────▼──────────┐  │
        │  │  Supabase Auth      │  │  PostgreSQL Database     │  │
        │  │  (JWT tokens)       │  │  (RLS-secured tables)    │  │
        │  └─────────────────────┘  └─────────────────────────┘  │
        │                                                          │
        │  ┌──────────────────────────────────────────────────┐   │
        │  │       Deno Edge Functions (Serverless)            │   │
        │  │  initialize-payment │ verify-payment              │   │
        │  │  verify-contribution │ paystack-webhook           │   │
        │  │  verify-bvn          │ health-check               │   │
        │  └──────────────────────────────────────────────────┘   │
        │                                                          │
        │  ┌──────────────────────────────────────────────────┐   │
        │  │       Supabase Storage                            │   │
        │  │       avatars (public bucket)                     │   │
        │  └──────────────────────────────────────────────────┘   │
        └──────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────▼──────────────────────┐
        │              PAYSTACK (External)            │
        │   Card processing, webhooks, transfers      │
        └────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| **No custom Node/Express server** | All backend logic in Supabase | Reduces operational overhead; Supabase handles auth, DB, storage, and serverless functions |
| **Row Level Security (RLS)** | Enabled on every table | Database-enforced access control; frontend code cannot bypass it |
| **Payment secret keys** | Only stored in Supabase Edge Function secrets | Never exposed to the browser |
| **Single Supabase client** | Singleton pattern | Prevents duplicate sessions and 401 errors from multiple client instances |
| **Service layer (`src/api/`)** | All Supabase calls go through typed service functions | Keeps component code clean and testable |

---

## 2. Technology Stack

### Frontend
| Technology | Version | Purpose |
|-----------|---------|---------|
| React | 18.3.1 | UI framework |
| TypeScript | 5.8.3 | Type safety |
| Vite | 5.4.11 | Build tool & dev server (port 3000) |
| React Router DOM | 6.28.0 | Client-side routing |
| Tailwind CSS | 3.4.19 | Utility-first styling |
| Radix UI | various | Accessible headless UI components |
| TanStack React Query | 5.83.0 | Server state / data fetching / caching |
| React Hook Form | 7.61.1 | Form state management |
| Zod | 3.25.76 | Schema validation |
| Sonner | 1.7.4 | Toast notifications |
| Recharts | 2.15.4 | Charts and graphs |
| jsPDF | 4.0.0 | PDF generation / export |
| date-fns | 3.6.0 | Date utilities |
| lucide-react | 0.462.0 | Icon set |

### Backend
| Technology | Purpose |
|-----------|---------|
| Supabase (PostgreSQL) | Primary database with RLS |
| Supabase Auth | JWT-based authentication |
| Supabase Storage | File/avatar storage |
| Deno Edge Functions | Serverless backend logic |
| Paystack | Payment processing |

---

## 3. Directory Structure

```
smart-ajo/
├── src/                          # Frontend React/TypeScript application
│   ├── api/                      # Service layer — all Supabase operations
│   │   ├── payments.ts           # Payment initiation & verification
│   │   ├── groups.ts             # Group CRUD & membership management
│   │   ├── contributions.ts      # Contribution tracking
│   │   ├── transactions.ts       # Transaction history
│   │   ├── profile.ts            # User profile management
│   │   ├── notifications.ts      # Notification handling
│   │   ├── wallets.ts            # Wallet operations
│   │   └── stats.ts              # Analytics & statistics
│   ├── components/               # Reusable React components
│   │   ├── ui/                   # 40+ Radix UI–based primitives
│   │   ├── Header.tsx            # Navigation header
│   │   ├── Footer.tsx            # Footer
│   │   ├── ProtectedRoute.tsx    # Auth guard HOC
│   │   ├── ErrorBoundary.tsx     # Error handling boundary
│   │   ├── Providers.tsx         # Root providers wrapper
│   │   ├── NotificationCenter.tsx
│   │   ├── PaymentBreakdown.tsx
│   │   ├── PayoutSchedule.tsx
│   │   ├── ContributionsList.tsx
│   │   ├── SlotSelector.tsx
│   │   └── ...landing page sections (Hero, Features, HowItWorks, etc.)
│   ├── contexts/
│   │   └── AuthContext.tsx        # Auth state, login/signup/logout
│   ├── hooks/
│   │   ├── usePayment.ts          # Payment orchestration hook
│   │   └── use-toast.ts           # Toast notification hook
│   ├── lib/
│   │   ├── client/
│   │   │   └── supabase.ts        # Singleton Supabase browser client
│   │   ├── utils/
│   │   │   ├── utils.ts           # General helpers
│   │   │   ├── auth.ts            # Auth helpers & retry logic
│   │   │   ├── authErrors.ts      # Auth error handling
│   │   │   ├── validation.ts      # Form validation helpers
│   │   │   ├── errorHandling.ts   # Error processing
│   │   │   ├── errorTracking.ts   # Error reporting
│   │   │   └── errors.ts          # Custom error classes
│   │   ├── constants/             # App-wide constants
│   │   ├── paystack.ts            # Paystack inline popup wrapper
│   │   └── paystackService.ts     # Payment service (amount conversion)
│   ├── pages/                     # Route-level page components
│   ├── types/
│   │   └── index.ts               # All TypeScript interfaces & types
│   ├── App.tsx                    # Root component with routing
│   ├── main.tsx                   # Application entry point
│   └── index.css                  # Global styles
│
├── supabase/                      # Backend (Supabase)
│   ├── functions/                 # Deno Edge Functions
│   │   ├── initialize-payment/    # Create pending transaction record
│   │   ├── verify-payment/        # Verify membership payment
│   │   ├── verify-contribution/   # Verify contribution payment
│   │   ├── paystack-webhook/      # Real-time Paystack webhook handler
│   │   ├── verify-bvn/            # BVN verification for KYC
│   │   └── health-check/          # System health monitoring endpoint
│   ├── migrations/                # Incremental schema changes
│   └── schema.sql                 # Complete database schema (~1760 lines)
│
├── public/                        # Static assets
├── .env.example                   # Environment variable template
├── package.json                   # Dependencies & npm scripts
├── vite.config.ts                 # Vite build configuration
├── tsconfig.json                  # TypeScript configuration
├── tailwind.config.ts             # Tailwind CSS configuration
└── vercel.json                    # Vercel SPA routing configuration
```

---

## 4. Frontend Architecture

### Routing (`src/App.tsx`)

| Route | Component | Access | Purpose |
|-------|-----------|--------|---------|
| `/` | `HomePage` | Public | Landing page |
| `/login` | `LoginPage` | Public | User login |
| `/signup` | `SignupPage` | Public | User registration |
| `/auth/callback` | `AuthCallbackPage` | Public | OAuth callback |
| `/dashboard` | `DashboardPage` | Protected | User dashboard |
| `/groups` | `GroupsPage` | Protected | Browse all groups |
| `/groups/create` | `CreateGroupPage` | Protected | Create new group |
| `/groups/:id` | `GroupDetailPage` | Protected | Group details & management |
| `/groups/:groupId/admin` | `AdminPanelPage` | Protected | Group admin panel |
| `/admin` | `SystemAdminDashboard` | Protected | System-wide admin |
| `/admin/login` | `SystemAdminLoginPage` | Public | Admin login |
| `/kyc-verification` | `KYCVerificationPage` | Protected | KYC / BVN verification |
| `/transactions` | `TransactionsPage` | Protected | Transaction history |
| `/profile/settings` | `ProfileSettingsPage` | Protected | Profile settings |
| `/payment/success` | `PaymentSuccessPage` | Public | Post-payment callback |
| `*` | `NotFoundPage` | Public | 404 fallback |

Protected routes are guarded by `ProtectedRoute.tsx`, which redirects to `/login` when the user is not authenticated.

### State Management

**AuthContext** (`src/contexts/AuthContext.tsx`) is the single source of truth for authentication:

```typescript
interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  login(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, fullName: string, phone: string): Promise<void>;
  logout(): Promise<void>;
  refreshUser(): Promise<void>;
}
```

- Listens for Supabase auth state changes (`onAuthStateChange`)
- Loads the full user profile from the `users` table after login
- Implements exponential backoff retry on transient errors
- Persists session via Supabase's built-in JWT refresh

**React Query** handles server state for all other data fetching (groups, contributions, transactions, etc.).

### Service Layer (`src/api/`)

All database interactions go through typed service functions. Components never call the Supabase client directly.

**`payments.ts`** — Key functions:
- `initializeGroupCreationPayment(groupId, amount, slotNumber)`
- `initializeGroupJoinPayment(groupId, amount, slotNumber)`
- `initializeContributionPayment(groupId, contributionId, amount)`
- `verifyPaymentAndActivateMembership(reference)`
- `verifyPaymentAndRecordContribution(reference)`
- `getUserPayments()`

**`groups.ts`** — Key functions:
- `createGroup(data: CreateGroupFormData)`
- `getUserGroups(groupIdFilter?)`
- `getGroupById(groupId)`
- `getGroupMembers(groupId)`
- `requestToJoinGroup(groupId, message?, preferredSlot?)`
- `approveMemberRequest(requestId, assignedPosition)`
- `rejectMemberRequest(requestId, rejectionReason?)`
- `activateGroupMembership(groupId)`
- `getGroupContributions(groupId)`

### Custom Hooks

**`usePayment`** (`src/hooks/usePayment.ts`) — Orchestrates the full three-step payment flow:
1. Calls `initialize-payment` edge function to create a pending transaction
2. Opens the Paystack popup via `paystackService`
3. On success, calls the appropriate verify function and redirects to `/payment/success`

### Supabase Client (`src/lib/client/supabase.ts`)

A module-level singleton using `@supabase/ssr` to prevent multiple client instances and duplicate session tokens:

```typescript
import { createBrowserClient } from '@supabase/ssr';
// Singleton instance — never call createBrowserClient more than once
```

---

## 5. Backend Architecture (Supabase)

### Database Schema

The schema (`supabase/schema.sql`) defines 12 core tables in PostgreSQL. RLS is enabled on every table.

#### Entity Relationships

```
auth.users (Supabase Auth)
    │ 1:1
    ▼
users ──────────────────────────────┐
    │ 1:1                           │
    ▼                               │ created_by
wallets                          groups ◄──────────────────┐
                                    │                       │
              ┌─────────────────────┤                       │
              │                     │                       │
              ▼                     ▼                       │
       group_members         group_join_requests            │
              │               (pending approvals)           │
              │                                             │
              ▼                                             │
       payout_slots                                         │
              │                                             │
              └─────────── contributions ◄──────────────────┤
                                    │                       │
                               transactions ────────────────┘
                                    │
                                payouts
                                    │
                                penalties
                                    │
                             notifications
                                    │
                              audit_logs
```

#### Table Definitions

**`users`** — Extended user profile (supplements `auth.users`)
```sql
id UUID PRIMARY KEY  -- equals auth.users.id
email TEXT UNIQUE
phone TEXT UNIQUE
full_name TEXT
is_verified BOOLEAN
is_active BOOLEAN
is_admin BOOLEAN
kyc_status ENUM('not_started', 'pending', 'approved', 'rejected')
kyc_data JSONB
bvn TEXT
date_of_birth DATE
address TEXT
avatar_url TEXT
bank_name TEXT
account_number TEXT
account_name TEXT
bank_code TEXT
created_at, updated_at, last_login_at TIMESTAMPTZ
```

**`wallets`** — One wallet per user (auto-created by trigger on signup)
```sql
id UUID PRIMARY KEY
user_id UUID REFERENCES users
balance DECIMAL
locked_balance DECIMAL
created_at, updated_at TIMESTAMPTZ
```

**`groups`** — Rotating savings group definitions
```sql
id UUID PRIMARY KEY
name TEXT
description TEXT
created_by UUID REFERENCES users
contribution_amount DECIMAL
frequency ENUM('daily', 'weekly', 'monthly')
total_members INT
current_members INT
security_deposit_amount DECIMAL
security_deposit_percentage DECIMAL
service_fee_percentage DECIMAL DEFAULT 2
status ENUM('forming', 'active', 'paused', 'completed', 'cancelled')
current_cycle INT
total_cycles INT
total_collected DECIMAL
start_date, end_date TIMESTAMPTZ
created_at, updated_at TIMESTAMPTZ
```

**`group_members`** — Membership records
```sql
PRIMARY KEY (user_id, group_id)
user_id UUID REFERENCES users
group_id UUID REFERENCES groups
position INT                        -- rotation order
status ENUM('pending', 'active', 'suspended', 'removed')
security_deposit_amount DECIMAL
has_paid_security_deposit BOOLEAN
security_deposit_paid_at TIMESTAMPTZ
joined_at TIMESTAMPTZ
UNIQUE (group_id, position)
```

**`group_join_requests`** — Pending join requests
```sql
id UUID PRIMARY KEY
group_id UUID REFERENCES groups
user_id UUID REFERENCES users
status ENUM('pending', 'approved', 'rejected')
message TEXT
preferred_slot INT
reviewed_by UUID REFERENCES users
reviewed_at TIMESTAMPTZ
rejection_reason TEXT
created_at, updated_at TIMESTAMPTZ
```

**`payout_slots`** — Allocated payout positions within a group
```sql
id UUID PRIMARY KEY
group_id UUID REFERENCES groups
slot_number INT
payout_cycle INT
status ENUM('available', 'reserved', 'assigned')
assigned_to UUID REFERENCES users
assigned_at TIMESTAMPTZ
reserved_by UUID REFERENCES users
reserved_at TIMESTAMPTZ
UNIQUE (group_id, slot_number)
```

**`contributions`** — Per-cycle payment obligations
```sql
id UUID PRIMARY KEY
group_id UUID REFERENCES groups
user_id UUID REFERENCES users
amount DECIMAL
cycle_number INT
status ENUM('pending', 'paid', 'overdue', 'waived')
due_date TIMESTAMPTZ
paid_date TIMESTAMPTZ
service_fee DECIMAL
is_overdue BOOLEAN
transaction_ref TEXT
created_at, updated_at TIMESTAMPTZ
```

**`transactions`** — Full audit trail of all money movements
```sql
id UUID PRIMARY KEY
user_id UUID REFERENCES users
group_id UUID REFERENCES groups
contribution_id UUID REFERENCES contributions
type ENUM('contribution', 'payout', 'security_deposit', 'penalty',
          'refund', 'deposit', 'withdrawal', 'fee')
amount DECIMAL
status ENUM('pending', 'processing', 'completed', 'failed', 'cancelled')
reference TEXT UNIQUE              -- Paystack reference
description TEXT
metadata JSONB
from_wallet_id UUID
to_wallet_id UUID
created_at, completed_at TIMESTAMPTZ
```

**`payouts`** — Scheduled and completed payouts to members
```sql
id UUID PRIMARY KEY
related_group_id UUID REFERENCES groups
recipient_id UUID REFERENCES users
cycle_number INT
amount DECIMAL
status ENUM('pending', 'processing', 'completed', 'failed')
payout_date TIMESTAMPTZ
payment_method TEXT
payment_reference TEXT
notes TEXT
created_at, updated_at TIMESTAMPTZ
```

**`penalties`** — Late/missed payment penalties
```sql
id UUID PRIMARY KEY
group_id UUID REFERENCES groups
user_id UUID REFERENCES users
contribution_id UUID REFERENCES contributions
amount DECIMAL
type ENUM('late_payment', 'missed_payment', 'early_exit')
status ENUM('applied', 'paid', 'waived')
applied_at TIMESTAMPTZ
```

**`notifications`** — In-app notifications
```sql
id UUID PRIMARY KEY
user_id UUID REFERENCES users
type ENUM('payment_due', 'payment_received', 'payment_overdue',
          'payout_ready', 'payout_processed', 'penalty_applied',
          'group_complete', 'group_started', 'member_joined',
          'member_removed', 'system_announcement')
title TEXT
message TEXT
is_read BOOLEAN
read_at TIMESTAMPTZ
related_group_id UUID
related_transaction_id UUID
created_at TIMESTAMPTZ
```

**`audit_logs`** — Admin audit trail
```sql
id UUID PRIMARY KEY
user_id UUID REFERENCES users
user_email TEXT
user_name TEXT
action TEXT
resource_type TEXT
resource_id TEXT
details JSONB
ip_address TEXT
user_agent TEXT
created_at TIMESTAMPTZ
```

### Row Level Security (RLS)

All tables have RLS enabled. Representative policies:

```sql
-- Users can only read their own profile
CREATE POLICY "Users can view own profile" ON users
  FOR SELECT USING (auth.uid() = id);

-- Admins can read all users
CREATE POLICY "Admins can view all users" ON users
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true)
  );

-- Groups are publicly readable
CREATE POLICY "Anyone can view groups" ON groups
  FOR SELECT USING (true);

-- Only the group creator can update their group
CREATE POLICY "Creators can update own groups" ON groups
  FOR UPDATE USING (created_by = auth.uid());

-- Members can view contributions for their own groups
CREATE POLICY "Users can view own contributions" ON contributions
  FOR SELECT USING (
    user_id = auth.uid() OR
    EXISTS (SELECT 1 FROM groups WHERE id = group_id AND created_by = auth.uid())
  );
```

### Stored Procedures (RPC Functions)

Key database functions called via `supabase.rpc(...)`:

| Function | Purpose |
|----------|---------|
| `create_user_profile_atomic` | Atomically create user row and wallet on signup |
| `get_user_profile` | Fetch full user profile |
| `update_user_profile` | Update user profile fields |
| `check_user_exists` | Pre-check for duplicate email/phone before signup |
| `get_user_dashboard_summary` | Aggregate dashboard stats for a user |
| `create_group` | Create group with initial setup |
| `get_user_groups` | List groups a user belongs to or created |
| `get_group_details` | Detailed group info with member list |
| `get_group_members_safe` | Member list with RLS recursion avoidance |
| `approve_join_request` | Approve pending member and assign position |
| `reject_join_request` | Reject pending member with reason |
| `get_pending_join_requests` | List pending requests for a group |
| `initialize_group_slots` | Create payout slots when group is formed |
| `get_available_slots` | List open slots for group join |
| `mark_overdue_contributions` | Batch-mark late contributions (scheduled job) |
| `get_admin_analytics` | System-wide statistics for admin dashboard |
| `get_admin_users` | Paginated user list for admin |
| `get_admin_groups` | Paginated group list for admin |

### Triggers

```sql
-- Auto-update `updated_at` timestamps on every table
BEFORE UPDATE → update_updated_at_column()

-- Auto-create wallet row when a new user row is inserted
AFTER INSERT ON users → create_wallet_for_new_user()

-- Keep groups.current_members in sync
AFTER INSERT OR DELETE ON group_members → update_group_member_count()
```

### Storage

```
Bucket: avatars  (public)
  Path pattern: avatars/{user_id}/{filename}
  Access: Public read, authenticated write (own folder only)
```

### Database Migrations

Located in `supabase/migrations/`. Applied on top of `schema.sql` to evolve the schema over time:

| Migration | Change |
|-----------|--------|
| `20260205020229_fix_rls_infinite_recursion.sql` | Fixed RLS policy recursion that blocked login |
| `20260205021700_fix_group_members_rls_recursion.sql` | Fixed group_members RLS recursion |
| `20260205021800_add_get_group_members_safe_function.sql` | Added safe group member query function |
| `20260307000000_add_total_collected_to_groups.sql` | Added `total_collected` column to groups |
| `20260307000001_add_contribution_id_to_transactions.sql` | Added `contribution_id` FK to transactions |

---

## 6. Edge Functions (Serverless)

All edge functions are Deno-based and deployed to Supabase. They run with the Supabase service role key to bypass RLS for trusted server-side operations, while still validating the user's JWT from the `Authorization` header.

### `initialize-payment`

Creates a pending `transactions` row before the Paystack popup opens, so that a payment reference is tracked even if the user abandons the flow.

**Request:**
```typescript
{
  groupId: string;
  amount: number;              // in kobo
  paymentType: 'group_creation' | 'group_join' | 'contribution';
  slotNumber?: number;
  contributionId?: string;
  cycleNumber?: number;
}
```

**Response:**
```typescript
{ success: boolean; reference: string; amount: number; email: string; }
```

**Flow:** Authenticate JWT → generate unique reference (`ajo_txn_{ts}_{rand}`) → insert pending transaction → return reference.

---

### `verify-payment`

Verifies a membership payment (group creation or join) against the Paystack API and activates the member.

**Flow:** Verify with Paystack API (using `PAYSTACK_SECRET_KEY`) → mark transaction `completed` → set `group_members.status = 'active'` → create notification.

---

### `verify-contribution`

Verifies a contribution payment and updates the group's collected balance.

**Flow:** Verify with Paystack API → mark transaction `completed` → mark contribution `paid` → increment `groups.total_collected` → create payout notification.

---

### `paystack-webhook`

Handles real-time events pushed by Paystack. Runs independently of the frontend, ensuring payments are recorded even if the user closes their browser.

**Security:** Verifies the `x-paystack-signature` header using HMAC-SHA512 before processing any event.

**Events handled:**
- `charge.success` — Payment completed
- `charge.failed` — Payment failed
- `transfer.success` — Outgoing transfer completed
- `transfer.failed` — Outgoing transfer failed

---

### `verify-bvn`

Calls an external BVN verification API to validate the user's Bank Verification Number for KYC.

---

### `health-check`

Returns system health status for monitoring and deployment verification.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-01-21T14:00:00.000Z",
  "version": "1.0.0",
  "components": {
    "database": { "status": "operational", "responseTime": 45 },
    "auth": { "status": "operational", "responseTime": 120 },
    "edgeFunctions": { "status": "operational" }
  }
}
```

---

## 7. Authentication Flow

### Signup

```
User fills signup form
    │
    ▼
AuthContext.signUp(email, password, fullName, phone)
    │
    ├─1─ check_user_exists RPC  →  reject if email/phone already taken
    │
    ├─2─ supabase.auth.signUp()  →  creates row in auth.users + sends email
    │
    ├─3─ wait 1 s for DB trigger propagation
    │
    ├─4─ create_user_profile_atomic RPC  →  creates row in public.users
    │
    ├─5─ DB trigger auto-creates wallets row
    │
    └─6─ load profile into AuthContext  →  redirect /dashboard
```

### Login

```
User enters email + password
    │
    ▼
AuthContext.login(email, password)
    │
    ├─1─ supabase.auth.signInWithPassword()  →  returns JWT session
    │
    ├─2─ load user profile from public.users
    │
    └─3─ set in AuthContext  →  redirect /dashboard
```

### Session Lifecycle

- JWT access token is automatically refreshed by the Supabase SDK before expiry.
- `onAuthStateChange` listener in `AuthContext` handles tab/window focus re-authentication.
- Transient failures (network errors) are retried with exponential backoff.
- `ProtectedRoute` reads `isAuthenticated` from `AuthContext` and redirects unauthenticated users to `/login`.

---

## 8. Payment Integration (Paystack)

### Three-Layer Payment Flow

```
LAYER 1 — INITIALIZATION
User clicks "Pay"
    │
    ▼
usePayment.initiatePayment()
    │
    ▼
POST /functions/v1/initialize-payment
    │  (creates pending transaction, returns reference)
    ▼
reference stored client-side

─────────────────────────────────────────────────────

LAYER 2 — PAYSTACK POPUP
paystackService.openPopup({
  key: VITE_PAYSTACK_PUBLIC_KEY,
  email, amount (kobo), reference, metadata
})
    │
    ▼
User enters card details in Paystack iframe
    │
    ▼
Paystack processes payment
    │
    ▼  (callback fired on success)
onSuccess(reference)

─────────────────────────────────────────────────────

LAYER 3 — VERIFICATION (3 independent paths)

  3a) Immediate frontend call:
      POST /functions/v1/verify-payment  OR  verify-contribution
          → server-side Paystack API check
          → update DB

  3b) /payment/success redirect:
      PaymentSuccessPage polls verification endpoint
          → retries until confirmed

  3c) Paystack webhook (independent):
      Paystack → POST /functions/v1/paystack-webhook
          → HMAC signature verified
          → DB updated regardless of frontend state
```

### Payment Types

| Type | Edge Function | DB Changes |
|------|--------------|-----------|
| Group creation | `initialize-payment` → `verify-payment` | `transactions` completed, `group_members` activated |
| Group join | `initialize-payment` → `verify-payment` | `transactions` completed, `group_members` activated |
| Contribution | `initialize-payment` → `verify-contribution` | `transactions` completed, `contributions` paid, `groups.total_collected` incremented |

### Amount Conversion

Paystack requires amounts in **kobo** (the smallest NGN unit):

```typescript
// ₦5,000 → 500,000 kobo
const toKobo = (naira: number) => Math.round(naira * 100);

// 500,000 kobo → ₦5,000
const toNaira = (kobo: number) => kobo / 100;
```

### Key Files

| File | Purpose |
|------|---------|
| `src/hooks/usePayment.ts` | Orchestration hook |
| `src/lib/paystackService.ts` | Popup management & amount conversion |
| `src/lib/paystack.ts` | Paystack inline.js script loader |
| `src/api/payments.ts` | Service layer functions |
| `src/pages/PaymentSuccessPage.tsx` | Post-payment callback page |
| `supabase/functions/initialize-payment/` | Create pending transaction |
| `supabase/functions/verify-payment/` | Activate membership |
| `supabase/functions/verify-contribution/` | Record contribution |
| `supabase/functions/paystack-webhook/` | Real-time webhook |

---

## 9. TypeScript Types

All domain types are defined in `src/types/index.ts`.

### Core Types (abbreviated)

```typescript
interface User {
  id: string;
  email: string;
  phone: string;
  fullName: string;
  isVerified: boolean;
  isActive?: boolean;
  isAdmin?: boolean;
  kycStatus: 'not_started' | 'pending' | 'approved' | 'rejected';
  bankName?: string;
  accountNumber?: string;
  accountName?: string;
  bankCode?: string;
}

interface Group {
  id: string;
  name: string;
  contributionAmount: number;
  frequency: 'daily' | 'weekly' | 'monthly';
  totalMembers: number;
  currentMembers: number;
  securityDepositAmount: number;
  status: 'forming' | 'active' | 'paused' | 'completed' | 'cancelled';
  currentCycle: number;
  totalCycles: number;
  serviceFeePercentage: number;
}

interface Contribution {
  id: string;
  groupId: string;
  userId: string;
  amount: number;
  cycleNumber: number;
  status: 'pending' | 'paid' | 'overdue' | 'waived';
  dueDate: string;
  paidDate?: string;
}

interface Transaction {
  id: string;
  type: 'contribution' | 'payout' | 'security_deposit' | 'penalty'
      | 'refund' | 'deposit' | 'withdrawal' | 'fee';
  amount: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  reference: string;
}
```

---

## 10. Environment Configuration

### Frontend (`.env.development` / `.env.production`)

```env
# Supabase — public keys only
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# Application
VITE_APP_NAME=Ajo Secure
VITE_APP_URL=http://localhost:3000

# Payment — public key only
VITE_PAYSTACK_PUBLIC_KEY=pk_test_xxxxx

# Feature flags (optional)
VITE_ENABLE_KYC=true
VITE_ENABLE_BVN_VERIFICATION=true
VITE_ENABLE_EMAIL_VERIFICATION=true
VITE_ENABLE_PHONE_VERIFICATION=true

# Development only
VITE_BYPASS_AUTH=false   # DANGER: bypasses auth; never set true in production
```

> **Security rule:** Only `VITE_*` prefixed variables are bundled into the browser. Secret keys must **never** use the `VITE_` prefix.

### Backend Secrets (Supabase Dashboard → Settings → Secrets)

```env
PAYSTACK_SECRET_KEY=sk_test_xxxxx    # sk_live_xxxxx for production
SUPABASE_SERVICE_ROLE_KEY=xxxxx      # auto-provided
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=xxxxx
```

---

## 11. Deployment

### Frontend — Vercel (recommended)

1. Connect repository to Vercel
2. Framework preset: **Vite** (auto-detected)
3. Build command: `npm run build`
4. Output directory: `dist`
5. Add all `VITE_*` environment variables in Vercel dashboard
6. `vercel.json` configures rewrites so all routes serve `index.html` (SPA mode)

### Frontend — Netlify (alternative)

- Build command: `npm run build`, publish directory: `dist`
- `public/_redirects` handles SPA routing

### Backend — Supabase

1. Apply schema: run `supabase/schema.sql` in the SQL editor
2. Apply migrations in `supabase/migrations/` in chronological order
3. Deploy edge functions:
   ```bash
   supabase functions deploy initialize-payment
   supabase functions deploy verify-payment
   supabase functions deploy verify-contribution
   supabase functions deploy paystack-webhook
   supabase functions deploy verify-bvn
   supabase functions deploy health-check
   ```
4. Set secrets via Supabase dashboard or CLI:
   ```bash
   supabase secrets set PAYSTACK_SECRET_KEY=sk_live_xxxxx
   ```
5. Configure Paystack webhook URL:
   ```
   https://<project>.supabase.co/functions/v1/paystack-webhook
   ```

### npm Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start Vite dev server on port 3000 |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve production build locally |
| `npm run lint` | Run ESLint |
