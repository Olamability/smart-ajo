# Admin Login Troubleshooting Guide

## Issue: "Access denied. This account is not a system administrator."

### Problem Description
After promoting a user account to admin using SQL (`UPDATE users SET is_admin = TRUE...`), the user still receives an "Access denied" error when trying to log in to the admin dashboard.

### Root Cause
The admin promotion was successful in the database, but the user's session didn't reflect the updated `is_admin` status. This can happen for several reasons:

1. **Cached Session**: The user's browser has a cached session from before the promotion
2. **Old Authentication Context**: The authentication context didn't reload the user profile
3. **Missing Field**: The AuthContext wasn't loading the `is_admin` field from the database

### Solutions (In Order)

#### Solution 1: Log Out and Log Back In ✅ (Most Common Fix)
**This fixes 90% of admin login issues**

1. If you're already logged in, log out completely:
   - Click your profile icon
   - Click "Log Out"
   
2. Clear your browser cache (optional but recommended):
   - Chrome/Edge: `Ctrl+Shift+Delete` (Windows) or `Cmd+Shift+Delete` (Mac)
   - Clear "Cached images and files"
   - Clear "Cookies and other site data"

3. Log back in with the promoted admin account

4. Navigate to `/admin` or look for "Admin Dashboard" in the profile menu

**Why this works:** Logging out clears the old session, and logging back in loads the updated user profile with the `is_admin = true` flag.

---

#### Solution 2: Verify Admin Status in Database
If Solution 1 doesn't work, verify the admin promotion was successful:

```sql
-- Check if user is marked as admin in database
SELECT id, email, full_name, is_admin, updated_at
FROM users
WHERE email = 'your-admin-email@example.com';
```

**Expected Result:**
- `is_admin` should be `true`
- `updated_at` should be recent

**If is_admin is false:**
Run the promotion query again:
```sql
UPDATE users
SET is_admin = TRUE, updated_at = NOW()
WHERE email = 'your-admin-email@example.com';
```

Then log out and log back in (Solution 1).

---

#### Solution 3: Check Auth Context Configuration
If the issue persists, verify the AuthContext is correctly configured:

**File:** `src/contexts/AuthContext.tsx`

**Check line ~247:** The user object should include `isAdmin`:
```typescript
setUser({
  id: result.id,
  email: result.email,
  phone: result.phone,
  fullName: result.full_name,
  createdAt: result.created_at,
  isVerified: result.is_verified,
  isAdmin: result.is_admin || false,  // ← This line must be present
  kycStatus: convertKycStatus(result.kyc_status),
  bvn: result.kyc_data?.bvn,
  profileImage: result.avatar_url,
});
```

**If the line is missing:** Add it and redeploy the application.

---

#### Solution 4: Force Session Refresh
Try refreshing the user session programmatically:

1. Open browser console (F12)
2. Run this code:
```javascript
// In browser console
localStorage.clear();
sessionStorage.clear();
location.reload();
```

3. Log in again with the admin account

---

#### Solution 5: Check Admin Page Route Protection
Verify the admin route is properly checking for admin status:

**File:** `src/pages/SystemAdminLoginPage.tsx`

**Check lines 37-48:** Should check `user.isAdmin`:
```typescript
if (user) {
  if (user.isAdmin) {
    // User is admin, redirect to admin dashboard
    navigate('/admin');
  } else {
    // User is logged in but not admin, show error and redirect
    toast.error('Access denied. This account is not a system administrator.');
    setTimeout(() => {
      navigate('/dashboard');
    }, 2000);
  }
}
```

---

## Prevention: Best Practices

### For Developers

1. **Always include all user fields in AuthContext**
   - When loading user profile, include ALL relevant fields from the users table
   - Especially: `is_admin`, `is_verified`, `is_active`

2. **Test admin promotion end-to-end**
   - After promoting a user, test the full login flow
   - Clear cache before testing
   - Verify admin dashboard loads correctly

3. **Document user fields**
   - Keep User type definition in sync with database schema
   - Add comments for fields that affect authorization

### For System Administrators

1. **Always log out after promotion**
   - Never rely on an existing session after changing admin status
   - Clear browser cache if issues persist

2. **Verify promotion before logging in**
   - Run the SELECT query to confirm `is_admin = true`
   - Check the `updated_at` timestamp

3. **Use incognito/private mode for testing**
   - Opens with no cached data
   - Ensures clean test environment

---

## Common Error Messages

### "Access denied. This account is not a system administrator."
- **Cause:** User is not marked as admin OR session is stale
- **Fix:** Solution 1 (log out and back in) or Solution 2 (verify admin status)

### "Not authenticated"
- **Cause:** No active session
- **Fix:** Log in with the admin account

### Page redirects to /dashboard instead of /admin
- **Cause:** `user.isAdmin` is `false` or `undefined`
- **Fix:** Solution 1 or Solution 2

### Admin menu option not visible
- **Cause:** User context doesn't have `isAdmin` set correctly
- **Fix:** Solution 3 (check AuthContext configuration)

---

## Quick Checklist

When troubleshooting admin login issues:

- [ ] Did you promote the user in the database? (Run UPDATE query)
- [ ] Did you verify the promotion? (Run SELECT query, check `is_admin = true`)
- [ ] Did you log out completely?
- [ ] Did you clear browser cache?
- [ ] Did you log back in with the promoted account?
- [ ] Is `isAdmin` field included in AuthContext's loadUserProfile?
- [ ] Are you using the correct admin login page? (`/admin/login`)
- [ ] Is there an active internet connection?

---

## Testing Admin Functionality

After resolving the login issue, verify admin features work:

1. **Access Admin Dashboard**
   - Navigate to `/admin`
   - Should see admin statistics and controls

2. **View Users List**
   - Should see all registered users
   - Should have suspend/activate controls

3. **View Groups List**
   - Should see all groups on platform
   - Should have pause/activate controls

4. **View Audit Logs**
   - Should see admin action history

If any of these fail, check:
- Admin functions are deployed (`supabase/admin_functions.sql`)
- RLS policies allow admin access
- Database migrations are applied

---

## Contact Support

If none of these solutions work:

1. **Collect Information:**
   - User email trying to log in
   - Screenshot of error message
   - Browser console errors (F12 → Console tab)
   - Result of database verification query

2. **Check Logs:**
   - Browser console for JavaScript errors
   - Supabase logs for database errors
   - Network tab for failed API calls

3. **Report Issue:**
   - Include all collected information
   - Mention which solutions were tried
   - Provide database query results

---

## Related Documentation

- [ADMIN_CREATION_GUIDE.md](./ADMIN_CREATION_GUIDE.md) - How to create admin accounts
- [ADMIN_SETUP.md](./ADMIN_SETUP.md) - Comprehensive admin setup guide
- User type definition: `src/types/index.ts`
- Auth context: `src/contexts/AuthContext.tsx`
- Admin login page: `src/pages/SystemAdminLoginPage.tsx`

---

**Last Updated:** January 11, 2026  
**Issue Fixed:** Admin login now properly loads `isAdmin` field from database
