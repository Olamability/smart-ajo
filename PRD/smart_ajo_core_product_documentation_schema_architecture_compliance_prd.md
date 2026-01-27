User Roles
1. Platform

Acts as neutral organizer

Holds all funds in escrow

Enforces rules automatically

Executes payouts via Paystack

2. Group Creator (Admin)

Creates ajo groups

Sets group rules

Reviews and approves applicants

Cannot tamper with funds or payout order once locked

3. Group Member

Applies to join groups

Pays security deposit and contributions

Receives payout based on assigned slot

Detailed User Flow (MVP)
1. User Registration & Onboarding
Required

Phone number (OTP verification)

Email

Full name

Password

Optional (Phase 2)

BVN

Government ID

2. Group Creation Flow (Admin)
Group Setup

Admin must define:

Group name

Contribution amount (e.g ₦50,000)

Contribution frequency (daily / weekly / monthly /yearly)

Number of members (e.g 10 people)

Total cycles

Security deposit amount

Penalty rules:

Late payment fee

Grace period

Group visibility:

Public (discoverable)

Private (invite-only)

Slot Selection (Important)

Admin selects preferred payout slot

Available slots update dynamically

Once selected → slot becomes locked

Admin Initial Payment

Before group becomes live:

Admin must pay:

Security deposit

Contribution

Payment processed via Paystack

Group status becomes OPEN FOR APPLICATIONS only after payment verification

3. Group Discovery & Application (Members)
Group Browsing

Users can browse groups by:

Contribution amount

Frequency

Available slots

Group status

Displayed info:

Admin profile

Rules summary

Available payout slots

Security deposit amount

Application to Join

Applicant must:

Select preferred payout slot

Submit application

Application includes:

Full name

Phone number. etc

4. Admin Review & Approval

Admin dashboard shows:

Applicant profile

Selected slot

Risk indicators (future: credit score)

Admin/creator actions:

Accept

Reject

5. Member Payment & Activation

After acceptance:

Applicant must pay:

Security deposit

Required contribution(s)

Payment is:

Processed via Paystack

Automatically verified

Only after successful payment:

User becomes ACTIVE MEMBER

Slot becomes locked

Group member count updates

6. 
Automated Enforcement

Late payment:

Penalty auto-deducted

Default:

Security deposit partially or fully forfeited

Member removed if threshold reached

7. Automated Payout System

System releases payout automatically

Admin has NO CONTROL over payout

Payout goes to:

Member assigned to that slot

Paystack transfer API used

All users get payout notifications

8. Transparency & Dashboard
For All Users

Contribution history

Payout history

Group progress tracker

Penalties applied

For Admin

Applications list

Member status

Payment compliance overview

9. Fees & Monetization

10% service fee per contribution cycle

Auto-deducted before escrow

Shown transparently in UI

10. Group States (Important for Dev)

Draft

Open for applications

Locked (all slots filled)

Active

Completed

Defaulted (edge case)

11. Paystack Integration (Core Requirement)

All payments must:

Use Paystack Checkout

Be verified via webhook

Trigger:

Slot locking

Group activation

Payout release
