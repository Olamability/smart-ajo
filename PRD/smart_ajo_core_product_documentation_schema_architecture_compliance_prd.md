# SMART AJO (Working Name)

A secure, automated digital contribution (ajo / esusu) platform using Paystack, deposits, and penalties to eliminate defaults and trust issues.

---

## B. DATABASE SCHEMA & ERD

### 1. USERS
Stores all registered users.

- id (UUID, PK)
- full_name
- email
- phone_number
- password_hash
- is_verified (boolean)
- kyc_level (none | basic | advanced)
- status (active | suspended | banned)
- created_at

---

### 2. WALLETS
Each user has an internal wallet.

- id (UUID, PK)
- user_id (FK → users.id)
- balance
- locked_balance (for deposits)
- created_at

---

### 3. GROUPS
Represents an ajo group.

- id (UUID, PK)
- name
- creator_id (FK → users.id)
- contribution_amount (e.g. 10000)
- service_fee_percentage (default: 10%)
- frequency (weekly | monthly)
- total_members
- start_date
- status (pending | active | completed | cancelled)
- created_at

---

### 4. GROUP_MEMBERS
Tracks users inside a group.

- id (UUID, PK)
- group_id (FK → groups.id)
- user_id (FK → users.id)
- rotation_position
- has_collected (boolean)
- status (active | defaulted | removed)
- joined_at

---

### 5. CONTRIBUTION_CYCLES
Each contribution round.

- id (UUID, PK)
- group_id (FK → groups.id)
- cycle_number
- collector_user_id (FK → users.id)
- due_date
- status (pending | completed | delayed)

---

### 6. PAYMENTS
Tracks every payment.

- id (UUID, PK)
- user_id (FK → users.id)
- group_id (FK → groups.id)
- cycle_id (FK → contribution_cycles.id)
- amount
- payment_type (contribution | deposit | penalty)
- status (paid | pending | failed)
- created_at

---

### 7. PENALTIES

- id (UUID, PK)
- user_id (FK → users.id)
- group_id (FK → groups.id)
- amount
- reason
- resolved (boolean)
- created_at

---

### 8. TRANSACTIONS (SYSTEM LEDGER)

- id (UUID, PK)
- from_wallet
- to_wallet
- amount
- transaction_type (payout | fee | penalty)
- reference
- created_at

---

### ERD SUMMARY (TEXTUAL)

User → Wallet (1:1)
User → Group_Members → Group (M:N)
Group → Contribution_Cycles (1:N)
Cycle → Payments (1:N)
User → Payments (1:N)

---

## C. TECHNICAL ARCHITECTURE (WEB + MOBILE)

### Frontend

- Web App: React + TypeScript
- Mobile App: React Native (Expo)
- State Management: Context / Zustand
- UI: Tailwind / Native UI

---

### Backend

- API Layer: Node.js (NestJS or Express)
- Auth: JWT + OTP
- Business Logic: Contribution engine, penalties

---

### Database

- PostgreSQL (Supabase or managed Postgres)
- Row-level security for wallets

---

### Payments

- Paystack
- Webhooks for payment confirmation

---

### Automation

- Cron jobs for:
  - Due date checks
  - Penalty application
  - Automatic disbursement

---

### Security

- Encrypted passwords
- Wallet isolation
- Audit logs

---

## D. COMPLIANCE & TRUST STRATEGY (NIGERIA)

### Regulatory Positioning

- Classified as: Digital Cooperative / Savings Platform
- NOT a loan or investment product

---

### KYC Strategy

**MVP:**
- Phone verification
- Email verification

**Phase 2:**
- BVN verification
- Government ID

---

### Trust Mechanisms

- Immutable transaction logs
- Default blacklist system
- Transparent group dashboards

---

### Legal Safeguards

- Clear Terms of Service
- Digital agreement on joining groups
- Penalty disclosure

---

## E. FULL PRD (LOVABLE.DEV READY)

### Product Name
Smart Ajo (Working Name)

---

### Problem
Traditional ajo systems fail due to lack of enforcement, transparency, and trust.

---

### Solution
An automated ajo platform with deposits, penalties, and system-controlled payouts.

---

### Target Users

- Salary earners
- Traders
- Students
- Cooperatives

---

### Core Features (MVP)

- User registration & verification
- Group creation
- contributions
- Automated payouts
- Security deposit enforcement
- Penalty system
- Transaction history

---

### Non-Goals

- Lending
- Investments
- Crypto

---

### Monetization

- 10% service fee per cycle

---

### Success Metrics

- Group completion rate
- Default rate
- Monthly active users
- Transaction volume

---

### Future Enhancements

- BVN credit scoring
- Insurance-backed groups
- Business cooperatives
- Reduced-fee premium tiers

---

GROUP CREATION & MEMBERSHIP FLOW (ROTATIONAL AJO LOGIC)
1. Group Creator (Admin) Role

Any verified user can create an ajo group.

The group creator automatically becomes the Group Admin.

The Admin has special permissions:

Approve or reject join requests

View all members and their rotation slots

Remove defaulting members (subject to system rules)


Important: Even though the Admin created the group, they are not exempt from payment rules and must participate like every other member.

2. Group Creation Process

When creating a group, the creator must define:

Group name

Contribution amount (e.g. ₦10,000)

Contribution frequency (weekly, monthly or yearly)

Total number of members

Start date

Service fee percentage (default 10%)

Rotation method:

Fixed rotation (members select slots)

Security deposit requirement (system-defined or % of contribution)

📌 After group creation:

The group status remains pending

The Admin must also join the group as a participant

The Admin is required to:

Select a rotation slot

Pay the required contribution + service fee via Paystack

Once the Admin completes payment:

The Admin is marked as an active group member

The group becomes visible to other users for join requests

3. Joining a Group (Member Flow)

Users do not automatically join groups.

Step-by-step Join Flow:

User views available groups

User selects a group

User selects an available rotation slot

User sends a join request to the group Admin

At this stage:

No money is charged

Slot is temporarily reserved (with timeout)

4. Admin Approval / Rejection

The Admin receives a notification when a join request is submitted.

Admin can:

Approve request

Reject request

If Rejected:

Slot is released

User is notified

If Approved:

User is prompted to make payment via Paystack

5. Payment Handling (Paystack – Entry Payment)

On approval, the user must pay:

Contribution amount

Service fee

Required security deposit (if applicable)

📌 Important Payment Rules:

Initial payments are handled via Paystack

Payment confirmation is handled via Paystack webhooks

If payment succeeds:

User becomes an active group member

Slot becomes permanently assigned

Group member record is created

If payment fails:

Join request expires

Slot is released

6. Slot Selection & Rotation Enforcement

Each group has a fixed number of rotation slots

Each slot represents a payout position (e.g. 1st, 2nd, 3rd…)

A slot can only be occupied by one user

Slot order determines:

Contribution cycles

Payout sequence

📌 Once the group becomes active:

Slots are locked

Rotation order cannot be changed

No new members can join

7. Group Activation Conditions

A group automatically moves from pending → active when:

All required slots are filled

All members (including Admin) have:

Paid initial contribution

Paid service fee

Paid required deposit

Only then:

Contribution cycles are generated


Automated payouts are enabled

8. Contribution Cycle Execution (High-Level)

For each cycle:

All members must contribute


Once all payments are confirmed:

Collector receives payout

System deducts service fee

Cycle is marked completed

Next cycle begins automatically

9. Database Implications (Explicit for Developers)

This flow implies:

groups.creator_id = Admin

group_members.rotation_position = selected slot

group_members.status tracks approval & defaults

Join requests may require:

group_join_requests table (recommended)

Example fields:

id

group_id

user_id

selected_slot

status (pending | approved | rejected | expired)

created_at

10. Key Rules Summary (No Ambiguity)

Admin ≠ owner of money

Admin must pay like everyone else

No automatic joining

Slot selection happens before approval

Paystack handles entry payments

Rotation order is immutable once active

## END

