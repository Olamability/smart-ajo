# Paystack Payment System - Deployment Checklist

This checklist ensures all requirements from "Paystack steup.md" are properly implemented and deployed.

## 📋 Pre-Deployment Verification

### 1. Environment Variables ✅

#### Frontend Configuration
- [ ] `VITE_PAYSTACK_PUBLIC_KEY` is set correctly
- [ ] Public key starts with `pk_test_` (test) or `pk_live_` (production)
- [ ] No secret keys in frontend environment
- [ ] `.env.example` updated with Paystack key template

#### Backend Configuration (Supabase Secrets)
- [ ] `PAYSTACK_SECRET_KEY` added to Supabase secrets
- [ ] Secret key starts with `sk_test_` (test) or `sk_live_` (production)
- [ ] Secret key matches the environment (test/live)
- [ ] `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` configured

**Verification Command:**
```bash
# List Supabase secrets (without showing values)
supabase secrets list

# Expected output should include:
# - PAYSTACK_SECRET_KEY
# - SUPABASE_SERVICE_ROLE_KEY (auto-configured)
```

---

### 2. Database Schema ✅

#### Payments Table
- [ ] `payments` table created with all mandatory fields
- [ ] All required fields present:
  - `reference` (unique, not null)
  - `user_id` (not null)
  - `amount` (not null, in kobo)
  - `currency` (not null, default NGN)
  - `status` (not null)
  - `email` (not null)
  - `channel` (not null)
  - `authorization_code`
  - `customer_code`
  - `gateway_response`
  - `fees`
  - `paid_at`
  - `verified` (not null, default false)
  - `metadata` (not null, JSONB)
  - `created_at` (not null)
- [ ] Indexes created for performance
- [ ] RLS policies enabled and configured

**Verification Query:**
```sql
-- Check table exists
SELECT table_name 
FROM information_schema.tables 
WHERE table_name = 'payments';

-- Check columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'payments'
ORDER BY ordinal_position;

-- Check RLS is enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE tablename = 'payments';

-- Check policies
SELECT policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'payments';
```

---

### 3. Edge Functions Deployment ✅

#### verify-payment Function
- [ ] Function deployed to Supabase
- [ ] Function accessible via URL
- [ ] Function uses PAYSTACK_SECRET_KEY from secrets
- [ ] Function has proper error handling
- [ ] Function is idempotent

#### paystack-webhook Function
- [ ] Function deployed to Supabase
- [ ] Function accessible via URL
- [ ] Function verifies webhook signatures
- [ ] Function handles multiple event types:
  - `charge.success`
  - `charge.failed`
  - `transfer.success`
  - `refund.processed`
- [ ] Function implements idempotency
- [ ] Function stores complete payment data

**Deployment Commands:**
```bash
# Deploy functions
supabase functions deploy verify-payment
supabase functions deploy paystack-webhook

# Verify deployment
supabase functions list

# Expected output should show both functions
```

**Test Function URLs:**
```
https://[PROJECT_REF].supabase.co/functions/v1/verify-payment
https://[PROJECT_REF].supabase.co/functions/v1/paystack-webhook
```

---

### 4. Paystack Dashboard Configuration ✅

#### Webhook Setup
- [ ] Webhook URL added to Paystack dashboard
- [ ] Webhook URL format: `https://[PROJECT_REF].supabase.co/functions/v1/paystack-webhook`
- [ ] Webhook events configured:
  - ✅ `charge.success` (MANDATORY)
  - ⚪ `charge.failed` (Recommended)
  - ⚪ `transfer.success` (Optional)
  - ⚪ `refund.processed` (Optional)
- [ ] Webhook test successful in Paystack dashboard
- [ ] Webhook secret matches backend secret key

**Webhook Configuration Steps:**
1. Log in to Paystack Dashboard
2. Go to Settings → Webhooks
3. Click "Add Webhook"
4. Enter webhook URL
5. Select events to monitor
6. Save and test webhook

---

### 5. Security Configuration ✅

#### Row Level Security (RLS)
- [ ] RLS enabled on `payments` table
- [ ] Users can only read their own payments
- [ ] Users CANNOT insert payments (only backend can)
- [ ] Users CANNOT update payments (only backend can)
- [ ] Users CANNOT update `verified` field

**Security Test:**
```sql
-- As a regular user, try to update a payment
-- This should fail with RLS error
UPDATE payments SET verified = true WHERE reference = 'test';

-- This should fail
INSERT INTO payments (reference, user_id, amount, currency, status, email, channel)
VALUES ('test', auth.uid(), 100000, 'NGN', 'success', 'test@example.com', 'card');
```

#### Frontend Security
- [ ] Frontend uses only PUBLIC key
- [ ] No SECRET key in frontend code
- [ ] Frontend does NOT mark payments as successful
- [ ] Frontend does NOT update business logic
- [ ] Frontend only initializes payment and displays UI

#### Backend Security
- [ ] All payment verification uses SECRET key
- [ ] Webhook signature always verified
- [ ] Service role used for database updates
- [ ] No sensitive data logged
- [ ] No card details stored (CVV, PIN, card number)

---

### 6. Metadata Configuration ✅

#### Required Metadata Fields
Every payment MUST include:
- [ ] `app`: Application identifier (e.g., "smartajo")
- [ ] `user_id`: User UUID
- [ ] `purpose`: Payment purpose (contribution, security_deposit, etc.)
- [ ] `entity_id`: Related entity ID (group_id, etc.)

#### Backward Compatibility Fields
- [ ] `type`: Payment type (for existing code)
- [ ] `group_id`: Group identifier
- [ ] `cycle_number`: Contribution cycle (if applicable)

**Code Verification:**
Check `src/lib/paystack.ts` metadata structure:
```typescript
metadata: {
  app: 'smartajo',
  user_id: userId,
  purpose: 'security_deposit',
  entity_id: groupId,
  // Backward compatibility
  type: 'security_deposit',
  group_id: groupId,
  ...
}
```

---

### 7. Business Logic Integration ✅

#### Contribution Payments
- [ ] Webhook updates contribution status to "paid"
- [ ] Webhook sets paid_date
- [ ] Webhook creates transaction record
- [ ] UI reflects payment status

#### Security Deposit Payments
- [ ] Webhook updates group_members.has_paid_security_deposit
- [ ] Webhook sets security_deposit_payment_ref
- [ ] Webhook creates transaction record
- [ ] UI reflects payment status

**Database Verification:**
```sql
-- Check contribution payment flow
SELECT 
  c.id,
  c.status,
  c.paid_date,
  c.transaction_ref,
  p.verified,
  p.amount
FROM contributions c
LEFT JOIN payments p ON p.reference = c.transaction_ref
WHERE c.user_id = 'test_user_id'
ORDER BY c.created_at DESC
LIMIT 5;

-- Check security deposit payment flow
SELECT 
  gm.user_id,
  gm.has_paid_security_deposit,
  gm.security_deposit_payment_ref,
  p.verified,
  p.amount
FROM group_members gm
LEFT JOIN payments p ON p.reference = gm.security_deposit_payment_ref
WHERE gm.user_id = 'test_user_id';
```

---

## 🧪 Testing Requirements

### Mandatory Tests
Before going live, ALL these tests MUST pass:

- [ ] **Test 1:** Successful payment flow
  - Payment completes successfully
  - Database updated correctly
  - Business logic executed
  
- [ ] **Test 2:** Failed payment
  - Payment fails gracefully
  - No database corruption
  - User can retry
  
- [ ] **Test 3:** Abandoned payment
  - User cancels payment
  - No partial data created
  - User can retry
  
- [ ] **Test 4:** Webhook signature verification
  - Invalid signatures rejected
  - Valid signatures accepted
  
- [ ] **Test 5:** Duplicate webhook handling
  - Idempotency works correctly
  - No duplicate records
  - No duplicate business logic execution
  
- [ ] **Test 6:** Backend verification API
  - verify-payment function works
  - Returns correct payment status
  
- [ ] **Test 7:** Unauthorized access prevention
  - RLS blocks unauthorized updates
  - Users cannot manipulate payments
  
- [ ] **Test 8:** Metadata validation
  - All required fields present
  - Metadata properly structured
  
- [ ] **Test 9:** Multiple event types
  - charge.success handled
  - charge.failed handled
  - Other events logged
  
- [ ] **Test 10:** Amount conversion
  - Kobo to Naira conversion correct
  - No rounding errors

See `PAYSTACK_TESTING_GUIDE.md` for detailed test procedures.

---

## 📊 Monitoring Setup

### Logging
- [ ] Supabase function logs enabled
- [ ] Paystack webhook logs monitored
- [ ] Application logs capture payment events
- [ ] Error logs configured for alerts

**Check Logs:**
```bash
# View function logs
supabase functions logs verify-payment --tail
supabase functions logs paystack-webhook --tail
```

### Alerts
- [ ] Alert on webhook delivery failures
- [ ] Alert on high payment failure rate
- [ ] Alert on verification errors
- [ ] Alert on suspicious activity

### Dashboard Queries
```sql
-- Payment statistics (last 24 hours)
SELECT 
  status,
  COUNT(*) as count,
  SUM(amount) as total_amount_kobo,
  SUM(amount)/100 as total_amount_naira
FROM payments
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY status;

-- Recent failed payments
SELECT 
  reference,
  gateway_response,
  created_at
FROM payments
WHERE status = 'failed'
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;

-- Unverified payments
SELECT 
  reference,
  status,
  created_at
FROM payments
WHERE verified = false
  AND created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
```

---

## 🚀 Deployment Steps

### Step 1: Database Migration
```bash
# Apply payments table migration
supabase db push

# Verify migration
supabase db status
```

### Step 2: Deploy Edge Functions
```bash
# Deploy functions
supabase functions deploy verify-payment
supabase functions deploy paystack-webhook

# Verify deployment
supabase functions list
```

### Step 3: Configure Secrets
```bash
# Set Paystack secret key
supabase secrets set PAYSTACK_SECRET_KEY=sk_live_your_live_secret_key

# Verify (this won't show the value)
supabase secrets list
```

### Step 4: Update Frontend Environment
```bash
# Update .env.production or deployment environment
VITE_PAYSTACK_PUBLIC_KEY=pk_live_your_live_public_key
```

### Step 5: Configure Paystack Webhook
1. Update webhook URL in Paystack dashboard to production URL
2. Test webhook delivery
3. Monitor webhook logs

### Step 6: Deploy Frontend
```bash
# Build frontend
npm run build

# Deploy to hosting platform
# (Vercel, Netlify, etc.)
```

---

## ✅ Post-Deployment Verification

### Immediate Checks (within 1 hour)
- [ ] Webhook receiving events successfully
- [ ] Test payment completes end-to-end
- [ ] Database updates correctly
- [ ] No errors in function logs
- [ ] Users can complete payments

### Daily Checks (first week)
- [ ] Payment success rate normal (>95%)
- [ ] No stuck payments
- [ ] Webhook delivery rate 100%
- [ ] No verification failures
- [ ] Database integrity maintained

### Weekly Checks (ongoing)
- [ ] Reconcile payments with Paystack dashboard
- [ ] Review failed payments
- [ ] Check for unusual patterns
- [ ] Update documentation if needed

---

## 🔴 Rollback Plan

If issues are detected:

### 1. Immediate Actions
- [ ] Disable payment features in frontend (feature flag)
- [ ] Stop processing new payments
- [ ] Notify users of maintenance

### 2. Investigate
- [ ] Check function logs
- [ ] Check database for corruption
- [ ] Check Paystack webhook logs
- [ ] Identify root cause

### 3. Rollback Steps
```bash
# Rollback database migration (if needed)
supabase db rollback

# Redeploy previous function version
supabase functions deploy verify-payment --version previous
supabase functions deploy paystack-webhook --version previous

# Restore previous environment variables
```

### 4. Data Recovery
```sql
-- Identify affected payments
SELECT * FROM payments 
WHERE created_at > 'deployment_timestamp'
  AND status != 'success';

-- Manual verification if needed
-- Contact Paystack support for payment reconciliation
```

---

## 📝 Go-Live Sign-Off

**Deployment Date:** _________________

**Deployed By:** _________________

**Verified By:** _________________

### Final Checklist
- [ ] All tests passed
- [ ] Production environment configured
- [ ] Webhook verified
- [ ] Monitoring enabled
- [ ] Team trained on troubleshooting
- [ ] Rollback plan ready
- [ ] Documentation complete

### Post-Deployment Notes:
_________________________________
_________________________________
_________________________________

---

## 📚 Related Documentation

- `Paystack steup.md` - Implementation specification
- `PAYSTACK_TESTING_GUIDE.md` - Testing procedures
- `PAYSTACK_CONFIGURATION.md` - Configuration guide
- Paystack API Documentation: https://paystack.com/docs
- Supabase Edge Functions: https://supabase.com/docs/guides/functions

---

## 🆘 Support Contacts

**Paystack Support:**
- Email: support@paystack.com
- Phone: +234 (1) 888 8811
- Dashboard: https://dashboard.paystack.com

**Supabase Support:**
- Discord: https://discord.supabase.com
- Documentation: https://supabase.com/docs

**Internal Team:**
- Technical Lead: _________________
- DevOps: _________________
- On-Call: _________________
