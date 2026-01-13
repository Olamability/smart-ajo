# Quick Reference Guide

## 🔗 Important URLs

### Paystack Integration
- **Webhook URL**: `https://kvxokszuonvdvsazoktc.supabase.co/functions/v1/paystack-webhook`
  - Purpose: Server-to-server payment verification (REQUIRED)
  - Configure in: Paystack Dashboard → Settings → Webhooks
  
- **Callback URL**: `https://your-app-domain.com/payment/success` or `/dashboard` or `/groups/{groupId}`
  - Purpose: Redirect users after payment (OPTIONAL)
  - ❓ **Don't know your callback URL?** See [CALLBACK_URL_GUIDE.md](./CALLBACK_URL_GUIDE.md)
  - **Note**: Callback URL ≠ Webhook URL (they serve different purposes!)

### Application Routes
| Route | Purpose | Access |
|-------|---------|--------|
| `/profile/settings` | User profile & bank account management | Authenticated users |
| `/admin/login` | System administrator login | Public (validates admin) |
| `/admin` | System admin dashboard | Admin users only |
| `/groups` | Browse and join groups | Authenticated users |
| `/groups/:id` | View group details & join | Authenticated users |

---

## 🏦 Bank Account Setup (User Guide)

**Why?** Users need bank account details to receive payouts from groups.

**How to add:**
1. Log in to your account
2. Click your profile menu (top right)
3. Select **"Profile Settings"**
4. Go to **"Bank Account"** tab
5. Fill in the form:
   - Select your bank from dropdown
   - Enter 10-digit account number
   - Enter account name (as shown in bank)
6. Click **"Save Bank Account"**

**Supported Banks**: 19 Nigerian banks including GTBank, Access Bank, UBA, Zenith, First Bank, etc.

---

## 👨‍💼 Admin Setup Guide

### Creating Admin Users

**Method 1: SQL Command (Recommended)**
```sql
-- In Supabase SQL Editor:
SELECT promote_user_to_admin('admin@yourcompany.com');
```

**Method 2: Direct SQL**
```sql
UPDATE users 
SET is_admin = TRUE 
WHERE email = 'admin@yourcompany.com';
```

### Admin Access
- **Login**: Visit `/admin/login`
- **Direct access**: If already logged in as admin, visit `/admin`
- **From regular login**: Link at bottom "System administrator? Admin login"

---

## 💳 Paystack Configuration

### Frontend Setup
Add to `.env.development`:
```bash
VITE_PAYSTACK_PUBLIC_KEY=pk_test_your_key_here
```

### Backend Setup
Add to Supabase Secrets:
- Name: `PAYSTACK_SECRET_KEY`
- Value: `sk_test_your_secret_key_here`

### Webhook Configuration
1. Go to [Paystack Dashboard](https://dashboard.paystack.com)
2. Settings → Webhooks
3. Add webhook URL: `https://kvxokszuonvdvsazoktc.supabase.co/functions/v1/paystack-webhook`
4. Select event: `charge.success` (minimum)

### Test Cards
| Card Number | Result |
|-------------|--------|
| 4084084084084081 | Success |
| 4084084084084099 | Failed |
| 5060666666666666666 | Success (Verve) |

CVV: Any 3 digits (e.g., 123)  
Expiry: Any future date (e.g., 12/25)  
PIN: 1234  
OTP: 123456

---

## 🚀 Deployment Checklist

### Database
- [ ] Run migration: `supabase/migrations/add_bank_account_fields.sql`
- [ ] Verify columns exist: `bank_name`, `account_number`, `account_name`, `bank_code`
- [ ] Test trigger: Try inserting invalid account number (should fail)

### Paystack
- [ ] Add public key to frontend env
- [ ] Add secret key to Supabase secrets
- [ ] Configure webhook URL
- [ ] Test with test card
- [ ] Verify webhook receives events

### Admin Users
- [ ] Create at least one admin user
- [ ] Test login at `/admin/login`
- [ ] Verify redirect to `/admin` dashboard
- [ ] Test non-admin access denial

### Features
- [ ] Test profile settings page
- [ ] Test bank account addition
- [ ] Test joining a group
- [ ] Test payment flow

---

## 📊 System Flow Diagrams

### Payment Flow
```
User → Pay Security Deposit/Contribution
  ↓
Paystack Inline Modal Opens
  ↓
User Completes Payment
  ↓
Paystack Processes Payment
  ↓
Webhook Sent → Supabase Edge Function
  ↓
Signature Verified
  ↓
Database Updated (contribution/deposit marked paid)
  ↓
Transaction Record Created
  ↓
User Sees Success Message
```

### Join Group Flow
```
User Browses Groups (/groups)
  ↓
Clicks "Join Group" Button
  ↓
System Checks:
  - Is group in "forming" status?
  - Are there available spots?
  - Is user already a member?
  ↓
User Added to group_members Table
  ↓
Redirect to Group Detail Page
  ↓
User Can Pay Security Deposit
  ↓
Group Activates When Full & All Deposits Paid
```

### Bank Account Flow
```
User Login
  ↓
Profile Menu → "Profile Settings"
  ↓
"Bank Account" Tab
  ↓
Select Bank → Enter Account Number → Enter Account Name
  ↓
Validation (10-digit check)
  ↓
Save to Database
  ↓
User Can Now Receive Payouts
```

---

## 🐛 Troubleshooting

### Webhook Not Working
- ✅ Check webhook URL is correct in Paystack
- ✅ Verify `PAYSTACK_SECRET_KEY` is set in Supabase
- ✅ Check Supabase function logs for errors
- ✅ Verify webhook signature validation passing

### Can't Join Group
- ✅ Group must be in "forming" status
- ✅ Group must have available spots
- ✅ User must not already be a member
- ✅ User must be authenticated

### Bank Account Not Saving
- ✅ Account number must be exactly 10 digits
- ✅ All fields must be filled
- ✅ Check database migration ran successfully
- ✅ Verify validation trigger exists

### Admin Login Issues
- ✅ User must have `is_admin = TRUE` in database
- ✅ Check user exists: `SELECT * FROM users WHERE email = '...'`
- ✅ Verify admin field: `SELECT is_admin FROM users WHERE email = '...'`
- ✅ Try regular login first, then promote to admin

---

## 📚 Documentation Files

| File | Purpose |
|------|---------|
| `PAYSTACK_CONFIGURATION.md` | Complete Paystack integration guide |
| `IMPLEMENTATION_SUMMARY_FEATURES.md` | Full implementation details |
| `ADMIN_SETUP.md` | Admin account setup guide |
| `README.md` | General project setup |
| `ARCHITECTURE.md` | System architecture |

---

## 🎯 Quick Commands

### Database Migration
```sql
-- Run in Supabase SQL Editor
-- Copy/paste: supabase/migrations/add_bank_account_fields.sql
```

### Create Admin
```sql
SELECT promote_user_to_admin('email@example.com');
```

### Check Bank Account Fields
```sql
SELECT bank_name, account_number, account_name, bank_code 
FROM users 
WHERE id = 'user-id';
```

### View All Admins
```sql
SELECT email, full_name, is_admin 
FROM users 
WHERE is_admin = TRUE;
```

---

## ✅ Feature Status

| Feature | Status | Location |
|---------|--------|----------|
| Paystack Webhook URL | ✅ Documented | `PAYSTACK_CONFIGURATION.md` |
| Paystack Callback URL | ✅ Documented | `PAYSTACK_CONFIGURATION.md` |
| Bank Account Management | ✅ Implemented | `/profile/settings` |
| System Admin Login | ✅ Implemented | `/admin/login` |
| Join Group Button | ✅ Already Exists | `/groups` page |

**All Features Ready for Production** 🚀
