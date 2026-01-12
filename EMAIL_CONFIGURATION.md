# Email Configuration Guide for Smart Ajo

This guide explains how to configure email verification and authentication emails in Supabase for the Smart Ajo application.

## Prerequisites

- Active Supabase project
- Admin access to Supabase dashboard
- Domain configured for custom emails (optional, recommended for production)

## Email Verification Setup

### 1. Configure Email Templates

Navigate to **Authentication > Email Templates** in your Supabase dashboard.

#### Confirm Signup Template

This email is sent when users sign up for the first time.

**Subject:** `Confirm Your Smart Ajo Account`

**Body:**
```html
<h2>Welcome to Smart Ajo!</h2>
<p>Hi {{ .Email }},</p>
<p>Thank you for joining Smart Ajo - the secure platform for rotating savings groups.</p>
<p>Please confirm your email address by clicking the button below:</p>
<p><a href="{{ .ConfirmationURL }}" style="display: inline-block; padding: 12px 24px; background-color: #1e7d6e; color: white; text-decoration: none; border-radius: 8px;">Confirm Email</a></p>
<p>Or copy and paste this URL into your browser:</p>
<p>{{ .ConfirmationURL }}</p>
<p>This link will expire in 24 hours.</p>
<p>If you didn't create an account with Smart Ajo, please ignore this email.</p>
<p>Best regards,<br>The Smart Ajo Team</p>
```

#### Magic Link Template

For passwordless login (optional feature).

**Subject:** `Your Smart Ajo Login Link`

**Body:**
```html
<h2>Login to Smart Ajo</h2>
<p>Hi {{ .Email }},</p>
<p>Click the button below to login to your Smart Ajo account:</p>
<p><a href="{{ .ConfirmationURL }}" style="display: inline-block; padding: 12px 24px; background-color: #1e7d6e; color: white; text-decoration: none; border-radius: 8px;">Login to Smart Ajo</a></p>
<p>Or copy and paste this URL into your browser:</p>
<p>{{ .ConfirmationURL }}</p>
<p>This link will expire in 1 hour.</p>
<p>If you didn't request this login link, please ignore this email.</p>
<p>Best regards,<br>The Smart Ajo Team</p>
```

#### Reset Password Template

**Subject:** `Reset Your Smart Ajo Password`

**Body:**
```html
<h2>Reset Your Password</h2>
<p>Hi {{ .Email }},</p>
<p>We received a request to reset your Smart Ajo password.</p>
<p>Click the button below to create a new password:</p>
<p><a href="{{ .ConfirmationURL }}" style="display: inline-block; padding: 12px 24px; background-color: #1e7d6e; color: white; text-decoration: none; border-radius: 8px;">Reset Password</a></p>
<p>Or copy and paste this URL into your browser:</p>
<p>{{ .ConfirmationURL }}</p>
<p>This link will expire in 1 hour.</p>
<p>If you didn't request a password reset, please ignore this email. Your password will remain unchanged.</p>
<p>Best regards,<br>The Smart Ajo Team</p>
```

### 2. Configure Site URL

Navigate to **Authentication > URL Configuration** in your Supabase dashboard.

Set the following URLs:

- **Site URL**: 
  - Development: `http://localhost:3000`
  - Production: `https://your-domain.com`

- **Redirect URLs** (Add all these):
  - `http://localhost:3000/auth/callback` (development)
  - `https://your-domain.com/auth/callback` (production)
  - `http://localhost:3000/**` (development wildcard)
  - `https://your-domain.com/**` (production wildcard)

### 3. Email Authentication Settings

Navigate to **Authentication > Providers** and configure:

#### Email Provider Settings

- ✅ **Enable Email Provider**: ON
- ✅ **Confirm email**: ON (Recommended)
  - This requires users to verify their email before accessing the app
- ⚠️ **Secure email change**: ON (Recommended)
  - Sends confirmation to both old and new email addresses
- ⚠️ **Double confirm email change**: ON (Optional, extra security)

### 4. Email Rate Limiting

Navigate to **Authentication > Rate Limits**:

- **Email sending rate limit**: 4 emails per hour (default, adjust as needed)
- **Account creation rate limit**: 10 per hour per IP (adjust as needed)

## Testing Email Flow

### Development Testing

1. **Start the dev server**:
   ```bash
   npm run dev
   ```

2. **Sign up with a test email**:
   - Navigate to `http://localhost:3000/signup`
   - Fill in the form with a valid email address
   - Click "Create account"

3. **Check your email**:
   - You should receive a confirmation email
   - Click the confirmation link
   - You'll be redirected to `/auth/callback`
   - The app will verify your email and redirect to dashboard

4. **Verify authentication**:
   - Check that you can access protected routes
   - Try logging out and logging back in

### Common Issues & Solutions

#### Issue: Confirmation link redirects to wrong URL

**Solution**: Check your Site URL and Redirect URLs in Supabase settings.

#### Issue: Email not received

**Solutions**:
1. Check spam/junk folder
2. Verify email provider settings in Supabase
3. Check Supabase logs: **Logs > Auth Logs**
4. For development, consider using a service like [Mailtrap](https://mailtrap.io)

#### Issue: "Invalid confirmation link" error

**Solutions**:
1. Link may have expired (24 hours for signup, 1 hour for password reset)
2. Link may have already been used
3. Check that Site URL matches your current domain

#### Issue: Email sends but redirect fails

**Solution**: Ensure `/auth/callback` route exists in your app and is properly configured.

## Production Recommendations

### 1. Custom Email Domain (Highly Recommended)

Configure a custom email domain in Supabase:
- Navigate to **Project Settings > Auth > Email**
- Click **"Configure custom SMTP"**
- Enter your SMTP server details

Benefits:
- Better email deliverability
- Professional appearance
- Less likely to be marked as spam

### 2. Email Deliverability

To improve deliverability:
- Set up SPF, DKIM, and DMARC records
- Use a reputable email service (SendGrid, AWS SES, Postmark)
- Warm up your sending domain gradually
- Monitor bounce rates and spam reports

### 3. Security Settings

- Enable "Confirm email" for all signups
- Set appropriate rate limits
- Use strong password requirements (configured in code)
- Enable email change confirmation

### 4. Monitoring

Monitor your email system:
- Check **Supabase > Logs > Auth Logs** regularly
- Track email delivery rates
- Monitor bounce rates
- Set up alerts for authentication failures

## Environment Variables

Ensure your `.env` file has the correct values:

```env
# Development
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_APP_URL=http://localhost:3000

# Production (update these)
VITE_APP_URL=https://your-domain.com
```

## Email Flow Diagram

```
┌─────────────┐
│   User      │
│  Signs Up   │
└──────┬──────┘
       │
       ▼
┌─────────────────────┐
│ Supabase Creates    │
│ Auth User (unverified)│
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│ Send Confirmation   │
│      Email          │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│  User Clicks Link   │
│  in Email           │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│ Redirect to         │
│ /auth/callback      │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│ Verify Token        │
│ Create Session      │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│ Redirect to         │
│ Dashboard           │
└─────────────────────┘
```

## Support

If you encounter issues:
1. Check Supabase Auth logs
2. Review this documentation
3. Check the [Supabase Auth documentation](https://supabase.com/docs/guides/auth)
4. Contact support with specific error messages

## Related Files

- `/src/pages/AuthCallbackPage.tsx` - Handles email confirmation
- `/src/pages/SignupPage.tsx` - User registration
- `/src/contexts/AuthContext.tsx` - Authentication logic
- `/src/lib/client/supabase.ts` - Supabase client configuration
