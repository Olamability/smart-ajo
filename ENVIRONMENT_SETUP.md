# Environment Setup Guide

This guide helps you properly configure your environment variables to avoid common issues.

## Common Issues and Solutions

### Issue 1: "Paystack public key not configured"

**Error Message:**
```
Payment error: Error: Paystack public key not configured. Please set VITE_PAYSTACK_PUBLIC_KEY in your .env file.
```

**Solution:**

1. **Get your Paystack API keys:**
   - Visit [Paystack Dashboard](https://dashboard.paystack.com/)
   - Navigate to **Settings** → **API Keys & Webhooks**
   - Copy your **Public Key** (starts with `pk_test_` for test mode or `pk_live_` for live mode)

2. **Configure your environment file:**
   
   For development, create or edit `.env.development` file:
   ```bash
   # Copy from .env.example if needed
   cp .env.example .env.development
   ```

   Update the Paystack public key:
   ```bash
   VITE_PAYSTACK_PUBLIC_KEY=pk_test_your_actual_key_here
   ```

   Replace `pk_test_your_paystack_public_key_here` with your actual Paystack public key.

3. **Restart your development server:**
   ```bash
   # Stop the current server (Ctrl+C)
   npm run dev
   ```

### Issue 2: Page refresh returns 404 error

**Error Message:**
```
Failed to load resource: the server responded with a status of 404
```

**Cause:** 
This is a common issue with Single Page Applications (SPAs) where client-side routing doesn't work properly after a page refresh because the server doesn't know about these routes.

**Solution:**

This has been fixed by adding proper routing configurations:

1. **For Netlify deployments:** `public/_redirects` file redirects all routes to `index.html`
2. **For Vercel deployments:** `vercel.json` file handles SPA rewrites
3. **For local development:** Vite dev server already handles this automatically

**If you still experience issues in production:**

- **Netlify:** Ensure `public/_redirects` is included in your build
- **Vercel:** Ensure `vercel.json` is in your project root
- **Other platforms:** Configure your server to serve `index.html` for all routes

Example for Apache (`.htaccess`):
```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>
```

Example for Nginx:
```nginx
location / {
  try_files $uri $uri/ /index.html;
}
```

## Complete Environment Setup Checklist

### Frontend Environment Variables

Copy `.env.example` to `.env.development`:
```bash
cp .env.example .env.development
```

Configure the following required variables:

```bash
# Supabase (Required)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here

# Application (Required)
VITE_APP_NAME=Ajo Secure
VITE_APP_URL=http://localhost:3000

# Paystack (Required for payments)
VITE_PAYSTACK_PUBLIC_KEY=pk_test_your_actual_paystack_public_key

# Feature Flags (Optional)
VITE_ENABLE_KYC=true
VITE_ENABLE_BVN_VERIFICATION=true
VITE_ENABLE_EMAIL_VERIFICATION=true
VITE_ENABLE_PHONE_VERIFICATION=true

# Development Flags (Optional)
VITE_BYPASS_AUTH=false
```

### Backend Configuration (Supabase)

1. **Configure Paystack Secret Key:**
   - Go to Supabase Dashboard → Project Settings → Edge Functions → Secrets
   - Add secret: `PAYSTACK_SECRET_KEY` with value `sk_test_your_secret_key`

2. **Configure Webhook:**
   - See `PAYSTACK_CONFIGURATION.md` for detailed webhook setup instructions

## Verification Steps

After configuration, verify everything works:

1. **Start development server:**
   ```bash
   npm run dev
   ```

2. **Test Paystack integration:**
   - Navigate to create a group
   - Try to initiate payment
   - Should see Paystack payment modal (not an error)

3. **Test routing:**
   - Navigate to any page (e.g., `/groups`)
   - Refresh the page (F5 or Ctrl+R)
   - Should load the same page (not a 404 error)

4. **Test build:**
   ```bash
   npm run build
   npm run preview
   ```
   - Test the same scenarios in preview mode

## Troubleshooting

### Paystack Key Not Working

1. Verify the key format:
   - Test keys start with `pk_test_`
   - Live keys start with `pk_live_`
   - No extra spaces or quotes

2. Verify the key is active in Paystack Dashboard

3. Check browser console for specific errors

### Environment Variables Not Loading

1. Ensure file is named correctly: `.env.development` (not `.env-development`)
2. All variables must be prefixed with `VITE_`
3. Restart dev server after changing environment variables
4. Check that file is in project root (same directory as `package.json`)

### Build Errors

If you encounter build errors:
```bash
# Clear cache and reinstall
rm -rf node_modules
rm package-lock.json
npm install

# Try building again
npm run build
```

## Production Deployment

For production, use a separate `.env.production` file or set environment variables in your hosting platform:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-production-anon-key
VITE_APP_URL=https://your-production-domain.com
VITE_PAYSTACK_PUBLIC_KEY=pk_live_your_live_public_key
```

**Important:** 
- Never commit `.env.development` or `.env.production` to version control
- Only `.env.example` should be in the repository
- Use your hosting platform's environment variable settings for production

## Additional Resources

- [Paystack Setup Guide](./PAYSTACK_CONFIGURATION.md)
- [Deployment Guide](./DEPLOYMENT_GUIDE.md)
- [Vite Environment Variables](https://vitejs.dev/guide/env-and-mode.html)
- [Supabase Setup](./SUPABASE_SETUP.md)
