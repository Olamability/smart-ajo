# Payment Flow Implementation - Testing & Deployment Checklist

## ✅ Implementation Status: COMPLETE

All code changes and documentation have been completed. This checklist will guide you through testing and deploying the payment verification flow.

---

## 📋 Pre-Deployment Checklist

### 1. Review Changes

- [ ] Review `src/pages/GroupDetailPage.tsx` changes
- [ ] Review `src/pages/PaymentSuccessPage.tsx` changes
- [ ] Review `supabase/functions/verify-payment/index.ts` changes
- [ ] Read `PAYMENT_VERIFICATION_GUIDE.md` for complete understanding
- [ ] Read `PAYMENT_FLOW_CHANGES.md` for quick summary
- [ ] Review `PAYMENT_FLOW_DIAGRAM.md` for visual flow

### 2. Environment Setup

**Frontend Environment Variables** (`.env`):
```bash
VITE_PAYSTACK_PUBLIC_KEY=pk_test_xxxxxxxxx  # ✓ Already configured
VITE_APP_URL=https://smart-ajo.vercel.app
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=xxxxxxxxxxxxx
```

- [ ] Verify `VITE_PAYSTACK_PUBLIC_KEY` is set (test key for staging)
- [ ] Verify `VITE_APP_URL` matches your deployment URL
- [ ] Verify Supabase credentials are correct

**Backend Environment Variables** (Supabase Secrets):
```bash
supabase secrets list
```

Expected secrets:
- [ ] `PAYSTACK_SECRET_KEY` - sk_test_xxxxx (test key for staging)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` - xxxxxxxxxxxxx
- [ ] `SUPABASE_URL` - https://xxxxx.supabase.co

If missing:
```bash
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_xxxxx
```

---

## 🧪 Testing Checklist (Staging/Dev)

### Test Card Information

**Successful Payment**:
- Card: `4084084084084081`
- CVV: `123`
- PIN: `1234`
- OTP: `123456`

**Failed Payment (Insufficient Funds)**:
- Card: `4084084084084099`
- CVV: `123`
- PIN: `1234`
- OTP: `123456`

### Test Scenario 1: Group Creation Payment

1. **Setup**:
   - [ ] Log in with test user account
   - [ ] Navigate to "Create Group" page

2. **Create Group**:
   - [ ] Fill in group details (name, amount, members, etc.)
   - [ ] Submit form to create group
   - [ ] Verify group is created with status "forming"

3. **Payment Flow**:
   - [ ] Click "Pay Security Deposit" button
   - [ ] Select payout slot (e.g., slot #1)
   - [ ] Verify payment modal opens
   - [ ] Verify amount is correct (security deposit + contribution + service fee)
   - [ ] Enter test card details (4084084084084081)
   - [ ] Complete payment

4. **Verification**:
   - [ ] Verify redirect to `/payment/success?reference=...&group=...`
   - [ ] Verify loading spinner shows "Verifying Payment..."
   - [ ] Verify success checkmark appears
   - [ ] Verify message "Payment Successful! Your membership has been activated"
   - [ ] Verify success toast notification
   - [ ] Click "Go to Group" button

5. **Post-Payment Validation**:
   - [ ] Verify redirected to group page
   - [ ] Verify you appear as an active member
   - [ ] Verify your slot number is displayed
   - [ ] Verify group status is still "forming" (unless you're the last member)

6. **Database Validation**:
   ```sql
   -- Check transaction record
   SELECT * FROM transactions 
   WHERE reference = 'AJO-...' 
   ORDER BY created_at DESC LIMIT 1;
   -- Status should be 'completed'
   
   -- Check membership record
   SELECT * FROM group_members 
   WHERE user_id = 'your-user-id' AND group_id = 'group-id';
   -- Status should be 'active', payment_status should be 'paid'
   ```
   - [ ] Transaction status is "completed"
   - [ ] Membership status is "active"
   - [ ] Payment status is "paid"

7. **Edge Function Logs**:
   - [ ] Open Supabase Dashboard → Edge Functions → verify-payment → Logs
   - [ ] Find your payment verification
   - [ ] Verify logs show:
     ```
     Payment verification request received
     Verifying payment with reference: AJO-...
     Paystack verification response - status: success
     Processing group_creation payment for slot 1
     Transaction record updated successfully
     Group member added/updated successfully
     Payment verification completed successfully
     ```

### Test Scenario 2: Group Join Payment

1. **Setup**:
   - [ ] Log in with a DIFFERENT test user account
   - [ ] Browse available groups

2. **Join Request**:
   - [ ] Find the group created in Test 1
   - [ ] Click "Request to Join"
   - [ ] Select preferred slot
   - [ ] Submit join request
   - [ ] Verify request shows as "pending"

3. **Admin Approval**:
   - [ ] Log out
   - [ ] Log in as the group creator (from Test 1)
   - [ ] Navigate to group page
   - [ ] Go to "Manage Requests" tab
   - [ ] Approve the join request
   - [ ] Log out

4. **Payment Flow**:
   - [ ] Log back in as the second user
   - [ ] Navigate to the group page
   - [ ] Verify "Pay Security Deposit" button is visible
   - [ ] Click button and complete payment (same as Test 1)
   - [ ] Verify verification succeeds
   - [ ] Verify membership is activated

5. **Group Status Check**:
   - [ ] If this was the last slot, verify group status changes to "active"
   - [ ] If not last slot, verify status remains "forming"

### Test Scenario 3: Contribution Payment

1. **Setup**:
   - [ ] Ensure you have an active group membership
   - [ ] Navigate to group page
   - [ ] Go to "Contributions" tab

2. **Payment Flow**:
   - [ ] Find a pending contribution
   - [ ] Click "Pay Contribution"
   - [ ] Verify payment modal opens
   - [ ] Verify amount is correct (contribution amount only)
   - [ ] Complete payment with test card
   - [ ] Verify verification succeeds

3. **Validation**:
   - [ ] Verify contribution status changes to "paid"
   - [ ] Verify payment date is recorded
   - [ ] Check database:
     ```sql
     SELECT * FROM contributions 
     WHERE id = 'contribution-id';
     -- Status should be 'paid', paid_date should be set
     ```

### Test Scenario 4: Failed Payment

1. **Setup**:
   - [ ] Navigate to any payment page (group creation, join, or contribution)

2. **Failed Payment Test**:
   - [ ] Click payment button
   - [ ] Enter FAILED test card: `4084084084084099`
   - [ ] Complete payment flow
   - [ ] Verify Paystack shows "Insufficient Funds" error
   - [ ] Close modal

3. **Validation**:
   - [ ] Verify transaction remains in "pending" status
   - [ ] Verify membership is NOT activated
   - [ ] User can retry payment

### Test Scenario 5: Cancelled Payment

1. **Setup**:
   - [ ] Navigate to any payment page

2. **Cancel Test**:
   - [ ] Click payment button
   - [ ] Paystack modal opens
   - [ ] Close modal WITHOUT entering card details
   - [ ] Verify "Payment cancelled" toast appears

3. **Validation**:
   - [ ] Transaction remains "pending"
   - [ ] User can retry

### Test Scenario 6: Retry Functionality

1. **Simulate Network Error**:
   - [ ] Open browser DevTools
   - [ ] Go to Network tab
   - [ ] Set throttling to "Offline"
   - [ ] Navigate to `/payment/success?reference=VALID_REFERENCE&group=GROUP_ID`
   - [ ] Wait for error message

2. **Auto-Retry Test**:
   - [ ] Re-enable network
   - [ ] Wait 2 seconds
   - [ ] Verify auto-retry happens
   - [ ] Verify verification succeeds after retry

3. **Manual Retry Test**:
   - [ ] Simulate another error (disable network again)
   - [ ] Navigate to payment success page with valid reference
   - [ ] Verify error message shows
   - [ ] Verify "Retry Verification" button appears
   - [ ] Re-enable network
   - [ ] Click "Retry Verification"
   - [ ] Verify verification succeeds

---

## 🚀 Deployment Checklist

### 1. Deploy Edge Function

```bash
# Navigate to project root
cd /path/to/smart-ajo

# Login to Supabase (if not already)
supabase login

# Link project (if not already)
supabase link --project-ref YOUR_PROJECT_REF

# Deploy verify-payment function
supabase functions deploy verify-payment

# Verify deployment
supabase functions list
```

- [ ] Edge Function deployed successfully
- [ ] Function shows in Supabase Dashboard
- [ ] No deployment errors

### 2. Verify Secrets

```bash
# List all secrets
supabase secrets list

# Should show:
# - PAYSTACK_SECRET_KEY
# - SUPABASE_SERVICE_ROLE_KEY
# - SUPABASE_URL
```

- [ ] All required secrets are present
- [ ] `PAYSTACK_SECRET_KEY` is set to test key for staging
- [ ] Will update to live key before production

### 3. Deploy Frontend

```bash
# Build the project
npm run build

# Verify build succeeds
# Check dist/ folder is created

# Deploy to Vercel (or your hosting platform)
vercel --prod

# Or if using Vercel GitHub integration:
# Just push to main branch
```

- [ ] Build succeeds without errors
- [ ] Frontend deployed successfully
- [ ] Can access deployed site
- [ ] Environment variables are set in hosting platform

### 4. Smoke Test in Staging

After deployment:
- [ ] Visit your deployed site
- [ ] Complete one successful payment flow (group creation)
- [ ] Verify payment verification works
- [ ] Check Edge Function logs in Supabase Dashboard
- [ ] Verify database records are correct

---

## 📊 Monitoring Checklist

### 1. Initial Monitoring (First 24 Hours)

- [ ] Check Edge Function logs every hour
- [ ] Monitor for any errors or failed verifications
- [ ] Check database for pending transactions older than 10 minutes
- [ ] Verify all successful payments result in active memberships

### 2. Ongoing Monitoring

**Daily**:
- [ ] Check payment success rate
  ```sql
  SELECT 
    COUNT(*) FILTER (WHERE status = 'completed') * 100.0 / COUNT(*) as success_rate,
    COUNT(*) FILTER (WHERE status = 'completed') as completed,
    COUNT(*) FILTER (WHERE status = 'pending') as pending,
    COUNT(*) FILTER (WHERE status = 'failed') as failed
  FROM transactions
  WHERE created_at > NOW() - INTERVAL '24 hours';
  ```

- [ ] Check for stale pending transactions
  ```sql
  SELECT * FROM transactions 
  WHERE status = 'pending' 
    AND created_at < NOW() - INTERVAL '1 hour'
  ORDER BY created_at DESC;
  ```

**Weekly**:
- [ ] Review Edge Function error logs
- [ ] Check for patterns in failed payments
- [ ] Verify group activations are working correctly

### 3. Alerts to Set Up (Optional)

- [ ] Email alert for payment verification failures
- [ ] Slack notification for Edge Function errors
- [ ] Dashboard for payment metrics

---

## 🐛 Troubleshooting Guide

### Issue: Payment verification fails

**Check**:
1. Edge Function logs in Supabase Dashboard
2. Verify `PAYSTACK_SECRET_KEY` is set correctly
3. Check if Paystack API is accessible
4. Verify payment reference is valid in Paystack dashboard

**Solution**:
- User can click "Retry Verification" button
- Or refresh the page to retry

### Issue: "Session not available" error

**Check**:
1. User is logged in
2. Auth context is loading properly

**Solution**:
- Auto-retry will handle this automatically
- User can wait a few seconds and retry

### Issue: Membership not activated after successful verification

**Check**:
1. Edge Function logs for errors
2. Database RLS policies
3. `group_members` table for the user

**Solution**:
- Check Edge Function logs for specific error
- Verify user_id and group_id in metadata
- May need to manually activate membership

### Issue: Edge Function timeout

**Check**:
1. Paystack API response time
2. Database query performance
3. Network connectivity

**Solution**:
- User can retry
- May need to optimize database queries
- Check Paystack API status

---

## 📝 Production Deployment Checklist

Before switching to production:

### 1. Update API Keys

- [ ] Get Paystack LIVE keys from Paystack Dashboard
- [ ] Update `VITE_PAYSTACK_PUBLIC_KEY` in frontend `.env.production`
- [ ] Update `PAYSTACK_SECRET_KEY` in Supabase secrets:
  ```bash
  supabase secrets set PAYSTACK_SECRET_KEY=sk_live_xxxxx
  ```

### 2. Update Paystack Dashboard Settings

- [ ] Set callback URL to production domain:
  `https://smart-ajo.vercel.app/payment/success`
- [ ] Enable live mode
- [ ] Set up webhooks (optional, for future):
  `https://your-project.supabase.co/functions/v1/paystack-webhook`

### 3. Final Validation

- [ ] Test with small real payment (your own card)
- [ ] Verify payment processes correctly
- [ ] Verify verification works
- [ ] Verify membership activates
- [ ] Check all logs and database records

### 4. Documentation

- [ ] Update internal documentation with live URLs
- [ ] Share this checklist with team
- [ ] Document monitoring procedures
- [ ] Set up incident response process

---

## ✅ Sign-Off Checklist

Before marking this task as complete:

- [ ] All code changes reviewed and merged
- [ ] All tests passed (automated and manual)
- [ ] Edge Function deployed to staging
- [ ] Frontend deployed to staging
- [ ] Smoke tests completed successfully
- [ ] Documentation reviewed and approved
- [ ] Team trained on new flow
- [ ] Monitoring set up
- [ ] Incident response plan documented

**Deployment to Production**:
- [ ] API keys updated to live keys
- [ ] Edge Function deployed to production
- [ ] Frontend deployed to production
- [ ] Real payment test completed
- [ ] Monitoring active

---

## 📚 Reference Documents

1. **PAYMENT_VERIFICATION_GUIDE.md** - Complete technical guide
2. **PAYMENT_FLOW_CHANGES.md** - Implementation summary
3. **PAYMENT_FLOW_DIAGRAM.md** - Visual flow diagram
4. **PAYMENT_SYSTEM_README.md** - Original payment system docs

---

## 🎉 Success Criteria

The implementation is successful when:

✅ **Functional Requirements**:
- Users can complete payments without app hanging
- Memberships activate immediately after successful payment
- Failed payments show clear error messages
- Users can retry failed verifications
- All payment types work (group creation, join, contribution)

✅ **Technical Requirements**:
- Edge Function processes verifications without errors
- Database updates are atomic and consistent
- Logs provide clear audit trail
- No security vulnerabilities
- Performance is acceptable (<3 seconds for verification)

✅ **User Experience**:
- Clear feedback at every step
- Loading states are visible
- Success and error messages are clear
- Users know what to do when something fails
- Navigation is smooth and reliable

---

**Checklist Version**: 1.0  
**Last Updated**: 2026-02-05  
**Status**: Ready for Testing

Good luck with testing and deployment! 🚀
