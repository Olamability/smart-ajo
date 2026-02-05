# Paystack Webhook Configuration Guide

## Quick Setup (5 minutes)

### Step 1: Deploy the Webhook Function

```bash
# Make sure you're in the project root
cd /path/to/smart-ajo

# Deploy the webhook function
./deploy-edge-functions.sh
```

When prompted:
- Enter your Paystack **secret key** (sk_test_... for testing, sk_live_... for production)

### Step 2: Configure Webhook in Paystack Dashboard

1. **Login to Paystack Dashboard**
   - Go to: https://dashboard.paystack.com
   - Login with your credentials

2. **Navigate to Webhooks Settings**
   - Click on **Settings** in the left sidebar
   - Click on **Webhooks**

3. **Add Webhook URL**
   - Click **"Add Webhook"** button
   - Enter the webhook URL:
     ```
     https://kvxokszuonvdvsazoktc.supabase.co/functions/v1/paystack-webhook
     ```
   
4. **Select Events to Listen For**
   - ✅ Check **charge.success** (REQUIRED - payment successful)
   - ✅ Check **charge.failed** (RECOMMENDED - payment failed)
   - ✅ Check **transfer.success** (OPTIONAL - for future payout features)
   - ✅ Check **transfer.failed** (OPTIONAL - for future payout features)

5. **Save Configuration**
   - Click **"Save"** or **"Add Webhook"** button
   - Copy the webhook ID for reference (optional)

### Step 3: Test the Webhook

1. **Make a Test Payment**
   - Go to your app: https://smart-ajo.vercel.app
   - Create a group and complete payment with test card:
     - Card Number: `4084 0840 8408 4081`
     - CVV: `123`
     - PIN: `1234`
     - OTP: `123456`

2. **Verify Webhook Delivery**
   - Go back to Paystack Dashboard → Webhooks
   - Check the **"Recent Deliveries"** section
   - You should see a successful webhook with status `200 OK`

3. **Check Application**
   - User should be immediately activated as group member
   - No "Processing payment..." hang should occur
   - Payment should complete instantly

### Step 4: Troubleshooting

#### Webhook Not Receiving Events

**Check Webhook URL:**
```bash
# Verify the function is deployed
supabase functions list --project-ref kvxokszuonvdvsazoktc
```

You should see `paystack-webhook` in the list.

**Check Function Logs:**
```bash
# View real-time logs
supabase functions logs paystack-webhook --project-ref kvxokszuonvdvsazoktc
```

**Test Webhook Manually:**
In Paystack Dashboard:
1. Go to Webhooks → Your Webhook
2. Click **"Test Webhook"**
3. Select `charge.success` event
4. Click **"Send Test"**
5. Check if status is `200 OK`

#### Webhook Returns Errors

**Common Issues:**

1. **401 Unauthorized - Invalid Signature**
   - Cause: Wrong Paystack secret key in Supabase
   - Fix: Update the secret:
     ```bash
     echo "YOUR_CORRECT_SECRET_KEY" | supabase secrets set PAYSTACK_SECRET_KEY --project-ref kvxokszuonvdvsazoktc
     ```

2. **400 Bad Request - Invalid Metadata**
   - Cause: Frontend not sending correct metadata
   - Fix: Verify you've deployed the frontend fixes (metadata field names)

3. **500 Internal Server Error**
   - Cause: Database permission issues or missing tables
   - Fix: Check function logs and verify database schema

**Check Database:**
```sql
-- Verify transactions table exists
SELECT * FROM transactions LIMIT 1;

-- Verify group_members table exists
SELECT * FROM group_members LIMIT 1;
```

### Environment-Specific URLs

**Development/Testing:**
```
Webhook URL: https://kvxokszuonvdvsazoktc.supabase.co/functions/v1/paystack-webhook
Paystack Keys: Use TEST keys (pk_test_..., sk_test_...)
App URL: http://localhost:3000
```

**Production:**
```
Webhook URL: https://kvxokszuonvdvsazoktc.supabase.co/functions/v1/paystack-webhook
Paystack Keys: Use LIVE keys (pk_live_..., sk_live_...)
App URL: https://smart-ajo.vercel.app
```

### Security Notes

✅ **Webhook Security Features:**
- Signature verification using HMAC SHA512
- Only accepts requests from Paystack IPs (optional)
- Service role key for database access (bypasses RLS)
- No sensitive data exposed to frontend

⚠️ **Important:**
- Never share your Paystack secret key
- Never commit secret keys to Git
- Use test keys for development
- Use live keys only in production

### Webhook Benefits

**Why Use Webhooks?**
1. ✅ **Instant Activation** - No waiting for manual verification
2. ✅ **Reliable** - Works even if user closes browser
3. ✅ **Automatic** - No user action required
4. ✅ **Real-time** - Updates happen immediately
5. ✅ **Failsafe** - Handles edge cases (network issues, etc.)

**Webhook vs Manual Verification:**
- **Without Webhook**: User waits, frontend polls, potential delays
- **With Webhook**: Instant, automatic, no user wait time

### Next Steps

After webhook is configured:

1. ✅ Test payment flow end-to-end
2. ✅ Monitor webhook deliveries in Paystack Dashboard
3. ✅ Check Supabase function logs for errors
4. ✅ Verify user activations happen instantly
5. ✅ Document any issues for troubleshooting

---

**Need Help?**
- Check PRODUCTION_DEPLOYMENT_GUIDE.md for full deployment process
- Check Supabase function logs: `supabase functions logs paystack-webhook`
- Check Paystack webhook deliveries in dashboard
- Review error messages in application console

**Webhook URL (Copy This):**
```
https://kvxokszuonvdvsazoktc.supabase.co/functions/v1/paystack-webhook
```
