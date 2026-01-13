# Callback URL Guide - Complete Understanding

## 📋 Table of Contents
- [What is a Callback URL?](#what-is-a-callback-url)
- [Callback URL vs Webhook - Key Differences](#callback-url-vs-webhook---key-differences)
- [How to Find Your Callback URL](#how-to-find-your-callback-url)
- [Callback URLs in Smart Ajo](#callback-urls-in-smart-ajo)
- [How to Configure Callback URLs](#how-to-configure-callback-urls)
- [Examples and Use Cases](#examples-and-use-cases)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)

---

## What is a Callback URL?

A **callback URL** is a web address (URL) where users are **redirected** after completing an action on an external service.

### Simple Explanation

Think of a callback URL like giving someone your return address:
- You go to Paystack to make a payment (like going to the post office)
- After payment is complete, Paystack sends you back to your app (using your return address)
- The callback URL is that return address

### Technical Definition

A callback URL is an optional redirect destination that you provide to a payment gateway (like Paystack). After a user completes their payment on the payment gateway's page, the gateway redirects the user's browser back to your application using this URL.

### Key Characteristics

- ✅ **Browser-based**: The user's browser is redirected
- ✅ **User Experience**: Shows a success/failure page to the user
- ✅ **Optional**: Not required for payment verification
- ✅ **Frontend**: Handled by your frontend application
- ⚠️ **Not Secure**: Cannot be trusted for payment verification (user can manipulate URL)

---

## Callback URL vs Webhook - Key Differences

Many developers confuse callback URLs with webhooks. Here's the difference:

| Feature | Callback URL | Webhook |
|---------|-------------|---------|
| **What is it?** | A redirect URL for users | A server-to-server notification |
| **Who uses it?** | User's browser | Payment gateway's server |
| **When triggered?** | When user completes payment | When payment status changes |
| **Purpose** | Show user a success/failure page | Verify and process payment securely |
| **Required?** | ❌ No (optional) | ✅ Yes (mandatory for verification) |
| **Secure?** | ❌ No (user can see/modify) | ✅ Yes (server-to-server, signed) |
| **Can verify payment?** | ❌ No (never trust this) | ✅ Yes (the only trusted source) |

### Visual Flow Comparison

**Callback URL Flow (User Experience):**
```
User → Pays on Paystack → Paystack redirects browser → Your App (callback URL)
                                                      ↓
                                              User sees "Success!" page
```

**Webhook Flow (Payment Verification):**
```
User → Pays on Paystack → Paystack notifies your server → Your server verifies → Updates database
                                                                                ↓
                                                                         Payment confirmed
```

### Important Security Rule

> ⚠️ **CRITICAL**: NEVER trust the callback URL to verify payment! A malicious user can manually visit the callback URL without paying. Always use webhooks for actual payment verification.

---

## How to Find Your Callback URL

Your callback URL is determined by **your application's domain** and **route structure**.

### For Smart Ajo Application

The callback URLs are based on where you want users to land after payment:

#### Production URLs (Replace with your actual domain)
```
Main Dashboard:
https://your-app-domain.com/dashboard

Payment Success Page:
https://your-app-domain.com/payment/success

Specific Group Page:
https://your-app-domain.com/groups/{groupId}
```

#### Development URLs (Local Testing)
```
Main Dashboard:
http://localhost:3000/dashboard

Payment Success Page:
http://localhost:3000/payment/success

Specific Group Page:
http://localhost:3000/groups/{groupId}
```

### How to Determine Your Callback URL

1. **Start with your app's base URL:**
   - Production: `https://your-app-domain.com`
   - Local: `http://localhost:3000`
   - Vercel: `https://your-app.vercel.app`

2. **Add the route where you want users to land:**
   - Dashboard: `/dashboard`
   - Payment success: `/payment/success`
   - Group detail: `/groups/{groupId}`

3. **Combine them:**
   - `https://your-app-domain.com/dashboard`
   - `https://your-app-domain.com/payment/success`

### Finding Your Deployed URL

**If deployed on Vercel:**
1. Go to Vercel Dashboard
2. Click on your project
3. Your URL is shown at the top: `https://your-app.vercel.app`

**If deployed on Netlify:**
1. Go to Netlify Dashboard
2. Click on your site
3. Your URL is shown at the top: `https://your-site.netlify.app`

**If using custom domain:**
- Your callback URL will use your custom domain
- Example: `https://smartajo.com/dashboard`

---

## Callback URLs in Smart Ajo

### Current Implementation

Smart Ajo uses callback URLs **optionally** for better user experience, but relies on **webhooks** for actual payment verification.

#### Where Callback URLs are Used

1. **Payment Success Page** (`/payment/success`)
   - Location: `src/pages/PaymentSuccessPage.tsx`
   - Purpose: Show user payment confirmation
   - URL example: `https://your-app.com/payment/success?reference=PAY_123456`

2. **Dashboard Redirect** (`/dashboard`)
   - Purpose: Return user to their dashboard after payment
   - URL example: `https://your-app.com/dashboard`

3. **Group Detail Page** (`/groups/{groupId}`)
   - Purpose: Return user to specific group they just paid for
   - URL example: `https://your-app.com/groups/abc-123-def`

#### How It Works in Code

In `src/lib/paystack.ts`, the callback_url parameter is optional:

```typescript
interface PaystackPaymentData {
  email: string;
  amount: number;
  reference: string;
  callback_url?: string; // Optional - for user redirect
  callback?: (response: PaystackResponse) => void;
}
```

When initializing payment:
```typescript
const handler = window.PaystackPop.setup({
  key: this.config.publicKey,
  email: data.email,
  amount: data.amount,
  ref: data.reference,
  callback_url: data.callback_url, // Where to redirect user after payment
  callback: (response: PaystackResponse) => {
    // JavaScript callback function (different from callback_url!)
    if (data.callback) {
      data.callback(response);
    }
  },
});
```

### Important Notes

- ✅ Callback URL is **optional** in Smart Ajo
- ✅ Payment verification happens via **webhook**, not callback URL
- ✅ Callback URL is **only for user experience** (showing success page)
- ✅ Smart Ajo works perfectly fine **without** a callback URL

---

## How to Configure Callback URLs

### Option 1: Set in Code (Current Implementation)

You can pass the callback URL when initializing payment:

```typescript
import { paystackService } from '@/lib/paystack';

// Example: Redirect to dashboard after payment
await paystackService.initializePayment({
  email: user.email,
  amount: 50000, // 50,000 kobo = ₦500
  reference: 'PAY_12345',
  callback_url: `${import.meta.env.VITE_APP_URL}/dashboard`,
  callback: (response) => {
    console.log('Payment completed:', response);
  },
});

// Example: Redirect to specific group page
const groupId = 'abc-123';
await paystackService.initializePayment({
  email: user.email,
  amount: 50000,
  reference: 'PAY_12345',
  callback_url: `${import.meta.env.VITE_APP_URL}/groups/${groupId}`,
});
```

### Option 2: Set in Paystack Dashboard (Global Default)

1. Log in to [Paystack Dashboard](https://dashboard.paystack.com)
2. Go to **Settings** → **API Keys & Webhooks**
3. Scroll to **Callback URL** section
4. Enter your default callback URL: `https://your-app.com/payment/success`
5. Click **Save Changes**

**Note**: URL passed in code will override the dashboard setting.

### Option 3: Environment Variable Approach

Add to your `.env` file:

```bash
# Application URL for callbacks
VITE_APP_URL=https://your-app-domain.com
```

Then use it in code:
```typescript
const callbackUrl = `${import.meta.env.VITE_APP_URL}/payment/success`;
```

### Recommended Approach for Smart Ajo

**Current Best Practice**: Use environment variable + code

```typescript
// In src/lib/paystack.ts or where you initialize payment
const baseUrl = import.meta.env.VITE_APP_URL || 'http://localhost:3000';
const callbackUrl = `${baseUrl}/payment/success`;

await paystackService.initializePayment({
  // ... other params
  callback_url: callbackUrl,
});
```

**Why this approach?**
- ✅ Works in both development and production
- ✅ Easy to change without code updates
- ✅ Clear and maintainable

---

## Examples and Use Cases

### Example 1: Basic Payment with Callback

```typescript
import { paystackService } from '@/lib/paystack';

async function paySecurityDeposit() {
  const user = await getCurrentUser();
  const baseUrl = import.meta.env.VITE_APP_URL;
  
  await paystackService.paySecurityDeposit(
    user.email,
    5000, // ₦5,000
    'group-id-123',
    user.id,
    (response) => {
      // This runs after payment
      console.log('Payment reference:', response.reference);
      
      // Verify payment via backend (REQUIRED!)
      verifyPayment(response.reference);
    }
  );
  
  // Note: callback_url is NOT specified here because paySecurityDeposit
  // doesn't expose it. You'd need to use initializePayment directly.
}
```

### Example 2: Custom Callback URL per Payment

```typescript
import { paystackService } from '@/lib/paystack';

async function payWithCustomCallback(groupId: string) {
  const user = await getCurrentUser();
  const baseUrl = import.meta.env.VITE_APP_URL;
  
  // Redirect to specific group after payment
  const callbackUrl = `${baseUrl}/groups/${groupId}?payment=success`;
  
  await paystackService.initializePayment({
    email: user.email,
    amount: 10000, // ₦100 in kobo
    reference: paystackService.generateReference('CUSTOM'),
    callback_url: callbackUrl,
    metadata: {
      type: 'contribution',
      group_id: groupId,
      user_id: user.id,
    },
    callback: (response) => {
      // Verify payment
      verifyPayment(response.reference);
    },
  });
}
```

### Example 3: Query Parameters in Callback URL

```typescript
const groupId = 'abc-123';
const userId = 'user-456';
const callbackUrl = `${baseUrl}/payment/success?group=${groupId}&user=${userId}`;

// Paystack will redirect to:
// https://your-app.com/payment/success?group=abc-123&user=user-456&reference=PAY_789
```

Then in your `PaymentSuccessPage.tsx`:
```typescript
import { useSearchParams } from 'react-router-dom';

export default function PaymentSuccessPage() {
  const [searchParams] = useSearchParams();
  
  const groupId = searchParams.get('group');
  const userId = searchParams.get('user');
  const reference = searchParams.get('reference'); // Added by Paystack
  
  // Use these values to show relevant information
}
```

### Example 4: No Callback URL (Minimal Approach)

```typescript
// Payment without callback URL - user stays on Paystack page
await paystackService.initializePayment({
  email: user.email,
  amount: 10000,
  reference: 'PAY_12345',
  // No callback_url specified
  callback: (response) => {
    // This JavaScript callback still runs
    verifyPayment(response.reference);
    
    // Manually navigate after verification
    if (response.status === 'success') {
      window.location.href = '/dashboard';
    }
  },
});
```

---

## Troubleshooting

### Issue 1: User Not Redirected After Payment

**Symptoms:**
- Payment completes on Paystack
- User stays on Paystack page
- No redirect happens

**Causes & Solutions:**

1. **No callback_url provided**
   - Solution: Add `callback_url` when initializing payment
   - Example: `callback_url: '${baseUrl}/payment/success'`

2. **Invalid callback_url format**
   - Solution: Ensure URL is fully qualified (includes `https://`)
   - ❌ Wrong: `/dashboard`
   - ✅ Right: `https://your-app.com/dashboard`

3. **CORS or domain issues**
   - Solution: Ensure your domain is accessible from Paystack
   - Check browser console for errors

### Issue 2: Callback URL Shows 404

**Symptoms:**
- User is redirected
- Gets "404 Not Found" error

**Solution:**
Ensure the route exists in your React Router configuration.

In `src/App.tsx`, verify routes:
```typescript
<Route path="/payment/success" element={<PaymentSuccessPage />} />
<Route path="/dashboard" element={<DashboardPage />} />
```

### Issue 3: Callback Happens But No Data

**Symptoms:**
- User lands on callback page
- But payment reference is missing

**Cause:**
Paystack adds reference to URL as query parameter automatically.

**Solution:**
Read it from URL in your component:
```typescript
import { useSearchParams } from 'react-router-dom';

const [searchParams] = useSearchParams();
const reference = searchParams.get('reference') || searchParams.get('trxref');
```

### Issue 4: Payment Works Locally But Not in Production

**Symptoms:**
- Callback works on `localhost:3000`
- Breaks on production domain

**Causes & Solutions:**

1. **Hardcoded localhost URL**
   - ❌ Wrong: `callback_url: 'http://localhost:3000/dashboard'`
   - ✅ Right: `callback_url: '${import.meta.env.VITE_APP_URL}/dashboard'`

2. **Environment variable not set**
   - Check `VITE_APP_URL` in production environment
   - Vercel: Set in Dashboard → Settings → Environment Variables
   - Value should be: `https://your-app.vercel.app` (without trailing slash)

3. **HTTP vs HTTPS**
   - Production must use HTTPS
   - Paystack may block HTTP redirects in production

### Issue 5: "Callback URL Required" Error

**Symptoms:**
Paystack shows error: "Please provide a callback URL"

**Solution:**
This error means Paystack requires a callback URL for your account.

**Fix:**
1. Set default in Paystack Dashboard: Settings → Callback URL
2. OR provide in code: `callback_url: '${baseUrl}/payment/success'`

---

## FAQ

### Q1: Do I need a callback URL?

**A:** No, callback URLs are **optional** in Smart Ajo. Payment verification happens via webhooks. Callback URLs just improve user experience by showing a success page.

### Q2: What's the difference between `callback` and `callback_url`?

**A:** 
- `callback`: JavaScript function that runs after payment (client-side)
- `callback_url`: Web address where user's browser is redirected (URL string)

Both are different and serve different purposes!

### Q3: Can I trust the callback URL for payment verification?

**A:** **NO! NEVER!** 

The callback URL is **only for user experience**. A user can manually visit the URL without paying. Always verify payments using webhooks on your backend.

**Right approach:**
```typescript
callback: (response) => {
  // Use callback to trigger verification
  await verifyPayment(response.reference); // Calls backend
}
```

**Wrong approach:**
```typescript
callback: (response) => {
  // ❌ NEVER DO THIS - User can fake this!
  database.update({ paid: true });
}
```

### Q4: Where do I configure the webhook URL?

**A:** Webhook URL is different from callback URL!

**Webhook URL** (for Smart Ajo):
```
https://kvxokszuonvdvsazoktc.supabase.co/functions/v1/paystack-webhook
```

Configure in Paystack Dashboard → Settings → Webhooks

See `PAYSTACK_CONFIGURATION.md` for detailed webhook setup.

### Q5: Can I have different callback URLs for different payments?

**A:** Yes! Pass different `callback_url` values when initializing each payment:

```typescript
// Payment for Group A - redirect to Group A page
paystackService.initializePayment({
  callback_url: `${baseUrl}/groups/group-a`,
  // ...
});

// Payment for Group B - redirect to Group B page
paystackService.initializePayment({
  callback_url: `${baseUrl}/groups/group-b`,
  // ...
});
```

### Q6: What if my app uses a custom domain?

**A:** Use your custom domain in the callback URL:

```bash
# In .env
VITE_APP_URL=https://smartajo.com
```

Then your callback URLs will be:
- `https://smartajo.com/payment/success`
- `https://smartajo.com/dashboard`

### Q7: Can I pass extra data in the callback URL?

**A:** Yes, using query parameters:

```typescript
const callbackUrl = `${baseUrl}/payment/success?group=${groupId}&ref=${customRef}`;
```

Paystack will preserve your parameters and add its own:
```
https://your-app.com/payment/success?group=123&ref=abc&reference=PAY_456&trxref=PAY_456
```

### Q8: How do I test callback URLs locally?

**A:** Two options:

**Option 1: Use localhost** (easiest for testing)
```typescript
callback_url: 'http://localhost:3000/payment/success'
```

**Option 2: Use ngrok** (for testing with production-like URLs)
```bash
ngrok http 3000
# Use the ngrok URL: https://abc123.ngrok.io/payment/success
```

### Q9: Does Smart Ajo require callback URLs?

**A:** No. The current implementation works fine without callback URLs because:
- Payment verification happens via webhooks
- JavaScript `callback` function handles post-payment logic
- Users can manually navigate after seeing success message

However, callback URLs **improve** user experience by automatically redirecting users.

### Q10: What happens if I don't set a callback URL?

**A:** 
1. User completes payment on Paystack
2. Paystack shows its own success message
3. User sees Paystack's "Return to merchant" button
4. User clicks it → goes back to where they started

With callback URL:
1. User completes payment
2. **Automatically** redirected to your app's success page
3. Better user experience!

---

## Quick Reference

### Callback URL Checklist

- [ ] Determine your app's base URL
  - Local: `http://localhost:3000`
  - Production: `https://your-app.com`
  
- [ ] Choose where to redirect users
  - Dashboard: `/dashboard`
  - Payment success: `/payment/success`
  - Group page: `/groups/{groupId}`
  
- [ ] Set environment variable
  - `VITE_APP_URL=https://your-app.com`
  
- [ ] Pass to Paystack when initializing payment
  - `callback_url: '${import.meta.env.VITE_APP_URL}/payment/success'`
  
- [ ] Create the route in React Router
  - Add route in `src/App.tsx`
  
- [ ] Handle query parameters
  - Read `reference` from URL params
  
- [ ] Remember: Callback ≠ Verification
  - Always verify via webhook!

---

## Additional Resources

- **Paystack Configuration**: See `PAYSTACK_CONFIGURATION.md`
- **Webhook Setup**: See `EDGE_FUNCTIONS_SETUP.md`
- **Payment Flow**: See `Paystack steup.md`
- **Troubleshooting**: See `TROUBLESHOOTING_PAYMENT_401.md`
- **Paystack Documentation**: https://paystack.com/docs/payments/payment-methods

---

## Summary

**Callback URL** = Where to redirect user after payment (optional, for UX)

**Webhook URL** = Where Paystack notifies your server (required, for verification)

**Key Takeaway**: 
- Callback URL is for **user experience**
- Webhook URL is for **payment security**
- Never trust callback URL for verification!
- Smart Ajo prioritizes webhooks (secure) over callbacks (convenience)

---

**Need help?** Check the troubleshooting section above or review the existing documentation files.
