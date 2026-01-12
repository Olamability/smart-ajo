PAYSTACK PAYMENT IMPLEMENTATION & SECURITY SPECIFICATION

(For Developers – Mandatory Requirements)

1. PURPOSE & SCOPE

This document defines exactly how Paystack payments must be implemented, verified, stored, and secured in this application.

No deviation is allowed without approval.

2. ENVIRONMENT & KEYS (MANDATORY)
2.1 Key Usage Rules

Frontend

Use Paystack PUBLIC key only

Keys must be loaded from environment variables

Backend

Use Paystack SECRET key only

Secret key must NEVER be exposed to frontend

2.2 Environment Variables
VITE_PAYSTACK_PUBLIC_KEY=pk_test_xxx
PAYSTACK_SECRET_KEY=sk_test_xxx


❌ Hardcoding keys is strictly forbidden.

3. PAYMENT FLOW (NON-NEGOTIABLE)
3.1 Frontend (Initialization Only)

Frontend may:

Initialize payment

Collect email

Display success UI

Frontend MUST NOT:

Mark payment as successful

Update wallet, subscription, or access rights

3.2 Backend Verification (REQUIRED)

Every payment MUST be verified using:

GET /transaction/verify/:reference


Only after successful verification:

status = success

verified = true

Business logic is executed

4. DATABASE REQUIREMENTS
4.1 Mandatory payments table fields
Field	Required	Notes
reference	✅	Unique
user_id	✅	Supabase auth ID
amount	✅	Kobo
currency	✅	NGN
status	✅	pending / success / failed
email	✅	Payer
channel	✅	card / bank / ussd
authorization_code	✅	Future charges
customer_code	✅	Customer mapping
gateway_response	✅	Debug
fees	✅	Paystack fees
paid_at	✅	Timestamp
verified	✅	Default false
metadata	✅	JSON
created_at	✅	Auto
4.2 Forbidden Data

❌ Card number
❌ CVV
❌ Expiry date
❌ PIN

5. SECURITY RULES (CRITICAL)
5.1 Backend Authority Rule

Frontend success ≠ payment success

Only backend verification determines success.

5.2 Role-based Access Control

Payment verification endpoints:

Must run with service role / Edge Function

No user can:

Verify their own payment

Update verified field

6. WEBHOOK IMPLEMENTATION (MANDATORY)
6.1 Events to Handle

charge.success

charge.failed

transfer.success

refund.processed

6.2 Webhook Security

Verify webhook signature using:

x-paystack-signature


Reject all unsigned or invalid payloads

7. IDENTITY & MULTI-APP SUPPORT
7.1 Metadata Usage (REQUIRED)

Every payment MUST include:

{
  "app": "app_name",
  "user_id": "uuid",
  "purpose": "subscription | wallet | ajo",
  "entity_id": "invoice_id"
}
FAILURE & EDGE CASE HANDLING

The system MUST handle:

Duplicate webhook events

Partial payments

Abandoned payments

Retry-safe verification (idempotency)

9. TESTING REQUIREMENTS

Developer MUST demonstrate:

Successful payment

Failed payment

Webhook verification

Duplicate webhook handling

Unauthorized access blocked

10. GO-LIVE CHECKLIST (SIGN-OFF)

✔ Test keys removed
✔ Live keys loaded via env
✔ Webhook verified
✔ Logs enabled
✔ Refund tested

11. DEVELOPER ACCOUNTABILITY

Any payment bug caused by skipping verification, logging, or security rules is considered a critical defect.

12. OPTIONAL BUT RECOMMENDED

Payment audit logs

Admin reconciliation dashboard

Alert on verification failure

Automatic retries