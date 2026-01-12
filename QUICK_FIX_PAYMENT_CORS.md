# 🚀 Quick Fix: Payment Verification CORS Error

**Problem:** Payment succeeds on Paystack but verification fails with CORS error

**Solution:** Deploy Edge Functions with correct CORS configuration ✅

---

## 📋 Quick Steps (5 minutes)

### Step 1: Install Supabase CLI
```bash
npm install -g supabase
```

### Step 2: Login and Link
```bash
supabase login
supabase link --project-ref kvxokszuonvdvsazoktc
```

### Step 3: Deploy Functions
```bash
./deploy-edge-functions.sh
```

### Step 4: Set Secret
```bash
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_your_secret_key
```

### Step 5: Verify
```bash
./check-edge-functions.sh
```

### Step 6: Test
1. Go to https://smart-ajo.vercel.app
2. Create a group
3. Complete payment
4. Verify no CORS errors ✅

---

## 🔍 What Was Fixed?

- ✅ All Edge Functions now return **204 No Content** for OPTIONS (not 200)
- ✅ Added **Access-Control-Max-Age** header for preflight caching
- ✅ Added **Access-Control-Allow-Methods** header
- ✅ Response body is **null** for OPTIONS (not 'ok')

---

## 📖 Need Help?

**Detailed Guide:** See [PAYMENT_CORS_FIX_COMPLETE.md](./PAYMENT_CORS_FIX_COMPLETE.md)

**Common Issues:**
- **Function not found (404):** Deploy with `supabase functions deploy verify-payment`
- **Secret not configured:** Set with `supabase secrets set PAYSTACK_SECRET_KEY=...`
- **CORS still failing:** Clear browser cache and try incognito
- **Project not linked:** Run `supabase link --project-ref YOUR_REF`

**Check Logs:**
```bash
supabase functions logs verify-payment --tail
```

---

## ✅ Success Checklist

- [ ] Supabase CLI installed
- [ ] Logged in and project linked
- [ ] Edge Functions deployed (check with `supabase functions list`)
- [ ] PAYSTACK_SECRET_KEY secret configured
- [ ] Health check passes (run `./check-edge-functions.sh`)
- [ ] Payment flow tested end-to-end in production
- [ ] No CORS errors in browser console

---

**Status:** ✅ Code fixed and ready for deployment
**Time to fix:** ~5-10 minutes
**Priority:** 🔴 HIGH - Blocking production payments
