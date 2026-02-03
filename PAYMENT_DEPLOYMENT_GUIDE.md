# Payment System Deployment Guide

This guide walks you through deploying the complete Paystack payment integration for Smart Ajo.

## 📋 Prerequisites

Before deploying, ensure you have:

1. **Supabase Account & Project**
   - Active Supabase project
   - Project URL and anon key
   - Service role key (for deployment only)

2. **Paystack Account**
   - Active Paystack account
   - Test public key (pk_test_...)
   - Test secret key (sk_test_...)
   - Live keys for production (pk_live_... and sk_live_...)

3. **Development Environment**
   - Node.js 18+ installed
   - Supabase CLI installed
   - Git installed

## 🚀 Quick Deployment (5 minutes)

### Step 1: Install Supabase CLI

```bash
# macOS
brew install supabase/tap/supabase

# Windows
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase

# Linux
brew install supabase/tap/supabase
```

For other installation methods, see: https://supabase.com/docs/guides/cli

### Step 2: Login to Supabase

```bash
supabase login
```

This will open your browser for authentication.

### Step 3: Link Your Project

```bash
supabase link --project-ref YOUR_PROJECT_REF
```

You can find your project ref in your Supabase dashboard URL:
`https://app.supabase.com/project/YOUR_PROJECT_REF`

### Step 4: Deploy Edge Functions

Run the deployment script:

```bash
./deploy-edge-functions.sh
```

This will:
- Deploy the `verify-payment` Edge Function
- Prompt you for your Paystack secret key
- Configure the secret in Supabase

### Step 5: Configure Frontend Environment Variables

Update your `.env.development` file (or create it from `.env.example`):

```bash
# Supabase Configuration
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here

# Paystack Configuration
VITE_PAYSTACK_PUBLIC_KEY=pk_test_your_paystack_public_key

# App Configuration
VITE_APP_NAME=Smart Ajo
VITE_APP_URL=http://localhost:3000
```

### Step 6: Test the Deployment

```bash
# Start the development server
npm run dev

# Visit http://localhost:3000
# Try creating a group and completing payment
```

## 🔧 Manual Deployment

If the script doesn't work, you can deploy manually:

### Deploy Edge Function

```bash
supabase functions deploy verify-payment --no-verify-jwt
```

### Set Secrets

```bash
# Set Paystack secret key
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_your_secret_key_here
```

### Verify Deployment

```bash
# List deployed functions
supabase functions list

# Check secrets
supabase secrets list
```

## 🧪 Testing the Payment Flow

### Test Group Creation Payment

1. **Create a Group**
   - Navigate to "Create Group"
   - Fill in group details
   - Submit the form

2. **Select Payout Slot**
   - Choose your preferred payout position
   - Review payment breakdown

3. **Complete Payment**
   - Click "Pay Now"
   - Use Paystack test card:
     - Card: `4084084084084081`
     - CVV: `123`
     - Expiry: Any future date
     - PIN: `1234`
     - OTP: `123456`

4. **Verify Membership**
   - After payment, you should be added to the group
   - Group status should update
   - Check your dashboard for confirmation

### Test Join Request Payment

1. **Browse Available Groups**
   - Navigate to "Browse Groups"
   - Select a group with available slots

2. **Request to Join**
   - Select your preferred slot
   - Submit join request

3. **Admin Approval** (use another account or have admin approve)
   - Admin receives notification
   - Admin approves request

4. **Complete Payment**
   - After approval, complete payment
   - Use test card details above

5. **Verify Membership**
   - Check group members list
   - Verify your slot assignment

## 🔍 Troubleshooting

### Edge Function Not Deploying

**Problem**: `supabase functions deploy` fails

**Solutions**:
- Ensure you're logged in: `supabase login`
- Ensure project is linked: `supabase link`
- Check function syntax: `deno check supabase/functions/verify-payment/index.ts`

### Payment Verification Fails

**Problem**: Payments succeed but membership not activated

**Solutions**:
- Check Edge Function logs: `supabase functions logs verify-payment`
- Verify Paystack secret key is set: `supabase secrets list`
- Check database permissions (RLS policies)
- Verify payment metadata includes required fields

### CORS Errors

**Problem**: "blocked by CORS policy" errors

**Solutions**:
- Ensure Edge Function has CORS headers
- Redeploy Edge Function
- Check browser console for specific CORS error
- Verify request headers include `apikey`

### Payment Modal Not Opening

**Problem**: Paystack popup doesn't open

**Solutions**:
- Check browser console for errors
- Verify `VITE_PAYSTACK_PUBLIC_KEY` is set
- Check if Paystack script is loaded (check Network tab)
- Ensure no ad blockers are interfering

## 📊 Database Schema Requirements

The payment system requires these tables:

### `payments` table
```sql
- id (uuid, primary key)
- user_id (uuid, foreign key)
- group_id (uuid, foreign key)
- cycle_id (uuid, nullable, foreign key)
- amount (numeric)
- payment_type (text: 'group_creation', 'group_join', 'contribution')
- status (text: 'pending', 'paid', 'cancelled', 'failed')
- reference (text, unique)
- metadata (jsonb)
- verified_at (timestamp)
- paystack_response (jsonb)
- created_at (timestamp)
```

### `group_members` table
```sql
- id (uuid, primary key)
- group_id (uuid, foreign key)
- user_id (uuid, foreign key)
- rotation_position (integer)
- status (text: 'active', 'inactive', 'removed')
- payment_status (text: 'pending', 'paid')
- has_paid_security_deposit (boolean)
- joined_at (timestamp)
```

### `groups` table
```sql
- id (uuid, primary key)
- name (text)
- description (text)
- created_by (uuid, foreign key)
- contribution_amount (numeric)
- service_fee_percentage (numeric)
- security_deposit_amount (numeric)
- security_deposit_percentage (numeric)
- frequency (text: 'weekly', 'monthly', 'yearly')
- total_members (integer)
- current_members (integer)
- status (text: 'forming', 'active', 'completed', 'cancelled')
- start_date (date)
- current_cycle (integer)
- created_at (timestamp)
```

## 🔐 Security Checklist

- [ ] Paystack secret key stored in Supabase secrets (not in code)
- [ ] Frontend only uses Paystack public key
- [ ] Payment verification happens on backend (Edge Function)
- [ ] RLS policies protect sensitive data
- [ ] Webhook signatures verified (if using webhooks)
- [ ] HTTPS enabled for production
- [ ] Environment variables not committed to Git

## 🎯 Production Deployment

When deploying to production:

1. **Use Live Paystack Keys**
   ```bash
   supabase secrets set PAYSTACK_SECRET_KEY=sk_live_your_live_key
   ```

2. **Update Frontend Environment**
   ```bash
   VITE_PAYSTACK_PUBLIC_KEY=pk_live_your_live_key
   VITE_SUPABASE_URL=https://your-production.supabase.co
   ```

3. **Test Thoroughly**
   - Test with small amounts first
   - Verify all payment types work
   - Check membership activation
   - Verify contribution cycles
   - Test payout automation

4. **Monitor**
   - Watch Edge Function logs
   - Monitor Paystack dashboard
   - Track payment success rates
   - Set up alerts for failures

## 📚 Additional Resources

- [Supabase Edge Functions Docs](https://supabase.com/docs/guides/functions)
- [Paystack API Documentation](https://paystack.com/docs/api)
- [Supabase CLI Reference](https://supabase.com/docs/reference/cli)
- [Smart Ajo Architecture Guide](./ARCHITECTURE.md)

## 🆘 Getting Help

If you encounter issues:

1. Check Edge Function logs: `supabase functions logs verify-payment`
2. Check browser console for frontend errors
3. Verify environment variables are set correctly
4. Test with Paystack test cards first
5. Review Paystack dashboard for payment status

## ✅ Deployment Checklist

Before going live:

- [ ] Supabase CLI installed and logged in
- [ ] Project linked to Supabase
- [ ] Edge Function deployed successfully
- [ ] Paystack secret key configured
- [ ] Frontend environment variables set
- [ ] Test payment flow works end-to-end
- [ ] Database schema is up to date
- [ ] RLS policies configured correctly
- [ ] CORS configuration tested
- [ ] Production keys ready (for production)
- [ ] Monitoring and alerts set up

---

**Need help?** Check the troubleshooting section or review the Edge Function logs for detailed error messages.
