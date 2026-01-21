# Payment Verification Troubleshooting Guide

**Last Updated**: January 21, 2026  
**Version**: 1.0.0  
**Applies To**: smart-ajo v1.x

## Overview

This guide helps diagnose and fix issues when payments are successful on Paystack but not reflected on the platform.

## Common Issues and Solutions

### Issue 1: Callback URL Not Configured

**Symptoms:**
- Payment is successful on Paystack
- User receives email confirmation
- Platform shows payment as pending
- User is not redirected after payment

**Diagnosis:**
```bash
# Check if VITE_APP_URL is configured
grep VITE_APP_URL .env.development .env.production
```

**Solution:**
1. Ensure `VITE_APP_URL` is set in your environment files:
   ```
   # .env.development
   VITE_APP_URL=http://localhost:3000
   
   # .env.production
   VITE_APP_URL=https://your-domain.com
   ```

2. Verify callback URL is being sent to Paystack:
   - Check browser console for callback_url in payment initialization
   - Should be: `${VITE_APP_URL}/payment/success?reference=${reference}&group=${groupId}`

3. Configure callback URL in Paystack Dashboard:
   - Log into Paystack Dashboard
   - Go to Settings > Preferences > Payment Page
   - Add your callback URL: `https://your-domain.com/payment/success`

### Issue 2: Edge Function Not Deployed

**Symptoms:**
- PaymentSuccessPage shows "Service unavailable" error
- Console shows 404 error for verify-payment function
- Verification never completes

**Diagnosis:**
```bash
# Check if Edge Function exists
ls -la supabase/functions/verify-payment/

# Check deployment status (if using Supabase CLI)
supabase functions list
```

**Solution:**
1. Deploy the verify-payment Edge Function:
   ```bash
   # Deploy all Edge Functions
   ./deploy-edge-functions.sh
   
   # Or deploy specific function
   supabase functions deploy verify-payment
   ```

2. Verify function is accessible:
   ```bash
   # Test function deployment
   curl -X POST https://your-project-ref.supabase.co/functions/v1/verify-payment \
     -H "Authorization: Bearer YOUR_ANON_KEY" \
     -H "Content-Type: application/json" \
     -d '{"reference":"test_ref"}'
   ```

### Issue 3: Session Expiration

**Symptoms:**
- Payment successful but verification shows "Session expired"
- PaymentSuccessPage shows "Please refresh" message
- Verification works after page refresh

**Diagnosis:**
- Check browser console for session expiration logs
- Look for "Session expired" messages in payment verification

**Solution:**
The code automatically handles this:
1. Session is refreshed before verification
2. If expired, user is prompted to refresh
3. Auto-refresh happens after 2 seconds

**Manual fix if auto-refresh fails:**
- Refresh the page manually
- Log out and log back in
- Clear browser cache and cookies

### Issue 4: Missing Payment Metadata

**Symptoms:**
- Verification fails with "Missing required metadata"
- Payment shows in Paystack but not processed
- Console shows metadata errors

**Diagnosis:**
Check payment initialization code includes all required metadata:
```typescript
metadata: {
  type: 'group_creation' | 'group_join',
  group_id: groupId,
  user_id: userId,
  preferred_slot: slotNumber, // Required for group creation
}
```

**Solution:**
1. Ensure all metadata fields are included in payment initialization
2. Check that preferred_slot is passed for group creation payments
3. Verify metadata is correctly formatted (no undefined values)

### Issue 5: Network/CORS Issues

**Symptoms:**
- Verification fails with network errors
- Console shows CORS errors
- Edge Function calls fail

**Diagnosis:**
- Check browser console for CORS errors
- Look for "Failed to fetch" errors
- Check network tab for failed requests

**Solution:**
1. Verify Edge Function CORS headers are configured:
   ```typescript
   const corsHeaders = {
     'Access-Control-Allow-Origin': '*',
     'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
   };
   ```

2. Check Supabase project settings:
   - Go to Project Settings > API
   - Verify URL and anon key are correct
   - Check if Edge Functions are enabled

### Issue 6: Paystack Webhook Not Configured

**Symptoms:**
- Payment successful but not reflected immediately
- Verification works but delayed
- Manual verification required

**Diagnosis:**
```bash
# Check if webhook handler exists
ls -la supabase/functions/paystack-webhook/

# Check webhook configuration in Paystack Dashboard
```

**Solution:**
1. Configure webhook in Paystack Dashboard:
   - Go to Settings > Webhooks
   - Add webhook URL: `https://your-project-ref.supabase.co/functions/v1/paystack-webhook`
   - Select events: charge.success, charge.failed

2. Verify webhook secret is configured:
   ```bash
   # Check Supabase secrets
   supabase secrets list
   
   # Set webhook secret if missing
   supabase secrets set PAYSTACK_SECRET_KEY=your_secret_key
   ```

## Verification Flow Checklist

Use this checklist to verify the complete payment flow:

- [ ] **Environment Variables**
  - [ ] `VITE_PAYSTACK_PUBLIC_KEY` is set
  - [ ] `VITE_APP_URL` is set correctly
  - [ ] Paystack secret key is set in Supabase secrets

- [ ] **Edge Functions**
  - [ ] verify-payment function is deployed
  - [ ] paystack-webhook function is deployed
  - [ ] Functions are accessible (test with curl)

- [ ] **Paystack Configuration**
  - [ ] Callback URL is configured in Paystack dashboard
  - [ ] Webhook URL is configured in Paystack dashboard
  - [ ] Test mode vs Live mode keys are correct

- [ ] **Frontend Configuration**
  - [ ] Payment initialization includes callback_url
  - [ ] Payment metadata includes all required fields
  - [ ] PaymentSuccessPage route is configured

- [ ] **Database**
  - [ ] Payments table exists
  - [ ] RLS policies allow backend updates
  - [ ] Triggers are functioning correctly

## Testing Payment Flow

### 1. Test with Paystack Test Mode

Use Paystack test cards:
- Success: 4084084084084081
- Declined: 5060666666666666666

### 2. Monitor Logs

```bash
# Watch Edge Function logs
supabase functions logs verify-payment --follow

# Watch webhook logs
supabase functions logs paystack-webhook --follow
```

### 3. Test Verification Manually

```typescript
// In browser console on PaymentSuccessPage
const reference = 'your_payment_reference';
const result = await verifyPayment(reference);
console.log(result);
```

## Quick Diagnostic Commands

```bash
# Check if group was created
psql -d your_db -c "SELECT id, name, current_members FROM groups WHERE created_at > NOW() - INTERVAL '1 hour';"

# Check if payment record exists
psql -d your_db -c "SELECT reference, status, verified FROM payments WHERE reference = 'your_reference';"

# Check if creator was added as member
psql -d your_db -c "SELECT user_id, position, has_paid_security_deposit FROM group_members WHERE group_id = 'your_group_id';"

# Check Edge Function deployment
curl https://your-project-ref.supabase.co/functions/v1/verify-payment
# Should return: {"error":"Unauthorized"} (not 404)
```

## Common Error Messages

| Error Message | Meaning | Solution |
|--------------|---------|----------|
| "Service unavailable" | Edge Function not deployed | Deploy verify-payment function |
| "Session expired" | Auth token expired | Refresh page or log in again |
| "Missing required metadata" | Payment metadata incomplete | Check payment initialization code |
| "Payment not found" | Reference doesn't exist in Paystack | Verify reference is correct |
| "Group not found" | Invalid group_id in metadata | Check group exists in database |
| "User is not the creator" | Wrong user trying to pay | Only creator can make creation payment |

## Support Escalation

If issue persists after trying all solutions:

1. **Collect Information:**
   - Payment reference
   - Group ID
   - User ID
   - Timestamp of payment
   - Error messages from console
   - Network request/response from browser

2. **Check Logs:**
   ```bash
   # Get recent Edge Function logs
   supabase functions logs verify-payment --limit 50
   
   # Get recent database logs
   supabase db logs --limit 50
   ```

3. **Database Investigation:**
   ```sql
   -- Check payment record
   SELECT * FROM payments WHERE reference = 'your_reference';
   
   -- Check group state
   SELECT id, name, current_members, status FROM groups WHERE id = 'your_group_id';
   
   -- Check member records
   SELECT user_id, position, has_paid_security_deposit, status 
   FROM group_members WHERE group_id = 'your_group_id';
   ```

4. **Contact Support:**
   - Include all collected information
   - Include relevant log excerpts
   - Include database query results

## Prevention Best Practices

1. **Always use callback_url**: Don't rely only on callback function
2. **Configure webhooks**: Set up Paystack webhooks for redundancy
3. **Monitor logs**: Regularly check Edge Function logs for errors
4. **Test in staging**: Test payment flow in test mode before going live
5. **Validate metadata**: Ensure all required metadata is included
6. **Handle session expiry**: Code includes automatic refresh, but test it
7. **Document environment**: Keep track of all environment variables

## Additional Resources

- [Paystack Documentation](https://paystack.com/docs)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [Payment Flow Documentation](./PAYMENT_FLOW.md)
- [Deployment Guide](./DEPLOYMENT_GUIDE.md)
