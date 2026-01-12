# Deployment Guide for SmartAjo New Features

This guide walks through the deployment process for all newly implemented features.

## Pre-deployment Checklist

- [ ] All code has been reviewed and tested
- [ ] Environment variables are documented
- [ ] API keys and credentials are secured
- [ ] Database migrations are ready (if needed)
- [ ] Backup of production database taken
- [ ] Rollback plan documented

## 1. Database Setup

### Required Functions (Already in codebase)
The following functions are already present in `supabase/functions.sql`:
- `apply_late_penalties()` - Applies penalties for overdue contributions
- `calculate_late_penalty()` - Calculates penalty amounts
- `process_cycle_completion()` - Processes completed cycles

### Required Triggers (Already in codebase)
The following triggers are already present in `supabase/triggers.sql`:
- `notify_penalty_applied` - Creates notifications when penalties are applied
- `check_cycle_completion` - Checks and processes complete cycles
- `create_contribution_transaction` - Creates transaction records

### Required Scheduled Jobs
Execute `supabase/scheduled-jobs.sql` to set up:
- `apply-late-penalties` - Runs daily at 1:00 AM UTC
- `process-complete-cycles` - Runs every 6 hours
- `send-payment-reminders` - Runs daily at 9:00 AM UTC

**Note**: pg_cron extension must be enabled (available on Supabase Pro plan and above)

## 2. Edge Functions Deployment

### Prerequisites
```bash
# Install Supabase CLI
npm install -g supabase

# Login to Supabase
supabase login

# Link your project
supabase link --project-ref YOUR_PROJECT_REF
```

### Set Environment Variables

#### For Paystack Webhook
```bash
supabase secrets set PAYSTACK_SECRET_KEY="sk_live_your_secret_key"
supabase secrets set SUPABASE_URL="https://your-project.supabase.co"
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="your_service_role_key"
```

#### For Email Notifications
Choose one SMTP provider:

**Gmail:**
```bash
supabase secrets set SMTP_HOST="smtp.gmail.com"
supabase secrets set SMTP_PORT="587"
supabase secrets set SMTP_USER="your-email@gmail.com"
supabase secrets set SMTP_PASSWORD="your-app-password"
supabase secrets set SMTP_FROM_EMAIL="noreply@smartajo.com"
supabase secrets set SMTP_FROM_NAME="Smart Ajo"
```

**SendGrid:**
```bash
supabase secrets set SMTP_HOST="smtp.sendgrid.net"
supabase secrets set SMTP_PORT="587"
supabase secrets set SMTP_USER="apikey"
supabase secrets set SMTP_PASSWORD="your_sendgrid_api_key"
supabase secrets set SMTP_FROM_EMAIL="noreply@yourdomain.com"
supabase secrets set SMTP_FROM_NAME="Smart Ajo"
```

**AWS SES:**
```bash
supabase secrets set SMTP_HOST="email-smtp.us-east-1.amazonaws.com"
supabase secrets set SMTP_PORT="587"
supabase secrets set SMTP_USER="your_ses_smtp_username"
supabase secrets set SMTP_PASSWORD="your_ses_smtp_password"
supabase secrets set SMTP_FROM_EMAIL="verified@yourdomain.com"
supabase secrets set SMTP_FROM_NAME="Smart Ajo"
```

#### For BVN Verification
Choose one provider:

**Paystack Identity (Recommended):**
```bash
supabase secrets set BVN_PROVIDER="paystack"
supabase secrets set PAYSTACK_SECRET_KEY="sk_live_your_secret_key"
# Or
supabase secrets set BVN_API_KEY="sk_live_your_secret_key"
```

**Flutterwave:**
```bash
supabase secrets set BVN_PROVIDER="flutterwave"
supabase secrets set BVN_API_KEY="FLWSECK-your_secret_key"
```

**Mock (Development Only - DO NOT USE IN PRODUCTION):**
```bash
supabase secrets set BVN_PROVIDER="mock"
```

### Deploy Functions
```bash
# Deploy all functions
supabase functions deploy paystack-webhook
supabase functions deploy send-email
supabase functions deploy verify-bvn

# Verify deployment
supabase functions list
```

### Get Function URLs
After deployment, note the URLs:
- Paystack Webhook: `https://your-project.supabase.co/functions/v1/paystack-webhook`
- Send Email: `https://your-project.supabase.co/functions/v1/send-email`
- Verify BVN: `https://your-project.supabase.co/functions/v1/verify-bvn`

## 3. Paystack Webhook Configuration

1. **Login to Paystack Dashboard**
   - Go to https://dashboard.paystack.com/

2. **Navigate to Settings > Webhooks**
   - Click "Add a Webhook"

3. **Configure Webhook**
   - URL: `https://your-project.supabase.co/functions/v1/paystack-webhook`
   - Events: Select `charge.success`
   - Active: Yes

4. **Save and Test**
   - Paystack will send a test event
   - Check function logs: `supabase functions logs paystack-webhook`

## 4. Frontend Deployment

### Update Environment Variables
Update your `.env.production` file:
```env
# Supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key

# Application
VITE_APP_NAME=Smart Ajo
VITE_APP_URL=https://yourdomain.com

# Paystack (Public Key Only)
VITE_PAYSTACK_PUBLIC_KEY=pk_live_your_public_key

# Feature Flags
VITE_ENABLE_KYC=true
VITE_ENABLE_BVN_VERIFICATION=true
VITE_ENABLE_EMAIL_VERIFICATION=true
```

### Build and Deploy
```bash
# Install dependencies
npm install

# Build for production
npm run build

# Deploy to your hosting provider
# (Vercel, Netlify, etc.)
```

## 5. Testing in Production

### Test Payment Webhook
1. Make a test payment using Paystack test keys
2. Verify webhook is received: Check function logs
3. Verify database is updated: Check `contributions` and `transactions` tables
4. Verify user is notified: Check `notifications` table

### Test Email Notifications
1. Trigger an event that sends email (e.g., make a contribution)
2. Check email inbox
3. Verify email content is correct
4. Check function logs: `supabase functions logs send-email`

### Test BVN Verification
1. Navigate to `/kyc-verification` page
2. Enter test BVN (if using mock mode) or real BVN
3. Verify success/failure message
4. Check `users` table for updated `kyc_status`
5. Check function logs: `supabase functions logs verify-bvn`

### Test Admin Panel
1. Create a test group
2. Navigate to `/groups/{groupId}/admin`
3. Verify all tabs load correctly
4. Test removing a member
5. Test waiving a penalty
6. Test exporting report

### Test PDF Export
1. Navigate to `/transactions`
2. Click "Export PDF"
3. Verify PDF downloads correctly
4. Check PDF content for accuracy

## 6. Monitoring

### Function Logs
```bash
# View logs for each function
supabase functions logs paystack-webhook --tail
supabase functions logs send-email --tail
supabase functions logs verify-bvn --tail
```

### Database Monitoring
Monitor these tables for errors:
- `audit_logs` - All system actions
- `notifications` - Notification delivery
- `transactions` - Payment processing
- `penalties` - Penalty application

### Error Tracking
Set up error tracking for:
- Edge Functions (check logs)
- Frontend (use Sentry or similar)
- Email delivery (check SMTP logs)
- Payment webhooks (check Paystack dashboard)

## 7. Rollback Plan

If issues occur:

### Edge Functions
```bash
# Deploy previous version
supabase functions deploy paystack-webhook --version previous
supabase functions deploy send-email --version previous
supabase functions deploy verify-bvn --version previous
```

### Frontend
Redeploy previous version from your hosting provider.

### Database
If database changes cause issues:
1. Restore from backup
2. Re-run only the required SQL scripts

## 8. Post-Deployment Tasks

- [ ] Update documentation with production URLs
- [ ] Notify team of successful deployment
- [ ] Monitor error rates for 24 hours
- [ ] Collect user feedback
- [ ] Document any issues encountered
- [ ] Schedule post-deployment review

## 9. Security Checklist

- [ ] All API keys are stored as environment variables
- [ ] Service role key is never exposed to frontend
- [ ] Webhook signatures are verified
- [ ] BVN data is masked in database
- [ ] SMTP credentials are secure
- [ ] Rate limiting is configured
- [ ] RLS policies are enabled on all tables
- [ ] HTTPS is enforced everywhere

## 10. Performance Optimization

### Edge Functions
- Monitor cold start times
- Optimize if response times > 2 seconds
- Consider function warming for critical endpoints

### PDF Generation
- Large reports may take time to generate
- Consider adding loading indicators
- Implement client-side caching if needed

### Database Queries
- Monitor slow queries
- Add indexes if needed
- Optimize RLS policies if performance issues

## Support Contacts

- **Supabase Issues**: https://supabase.com/dashboard/support
- **Paystack Issues**: support@paystack.com
- **SMTP Issues**: Check provider documentation
- **BVN Verification Issues**: Check provider support

## Useful Commands

```bash
# View all secrets
supabase secrets list

# Update a secret
supabase secrets set KEY="value"

# Delete a secret
supabase secrets unset KEY

# View function status
supabase functions list

# View recent logs
supabase functions logs FUNCTION_NAME --limit 100

# Deploy with custom region (if needed)
supabase functions deploy FUNCTION_NAME --region us-east-1
```

## Troubleshooting

### Webhook not receiving events
1. Check webhook URL in Paystack dashboard
2. Verify function is deployed: `supabase functions list`
3. Check function logs: `supabase functions logs paystack-webhook`
4. Test with Paystack webhook testing tool

### Email not sending
1. Verify SMTP credentials are correct
2. Check SMTP provider status
3. Check function logs: `supabase functions logs send-email`
4. Test SMTP connection manually

### BVN verification failing
1. Check API key is correct
2. Verify provider account has sufficient balance
3. Check function logs: `supabase functions logs verify-bvn`
4. Test with mock provider first

### PDF export not working
1. Check browser console for errors
2. Verify jsPDF library loaded correctly
3. Test with smaller datasets first
4. Check for memory issues with large PDFs

## Additional Resources

- [Supabase Edge Functions Docs](https://supabase.com/docs/guides/functions)
- [Paystack Webhook Guide](https://paystack.com/docs/payments/webhooks)
- [Paystack Identity API](https://paystack.com/docs/identity-verification/)
- [jsPDF Documentation](https://github.com/parallax/jsPDF)

---

**Last Updated**: January 2026  
**Version**: 1.0  
**Status**: Ready for Production Deployment
