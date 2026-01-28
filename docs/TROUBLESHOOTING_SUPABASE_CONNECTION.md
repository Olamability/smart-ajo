# Troubleshooting Supabase Connection Errors

## Error: `ERR_NAME_NOT_RESOLVED` or `Failed to fetch`

If you see errors like these in your browser console:

```
GET https://xxxxx.supabase.co/rest/v1/users net::ERR_NAME_NOT_RESOLVED
TypeError: Failed to fetch
```

### Root Cause

This error occurs when the Supabase URL in your environment configuration cannot be resolved. Common causes:

1. **Supabase project has been deleted or paused**
2. **Invalid or incorrect Supabase URL**
3. **Missing environment variables**
4. **Using placeholder values from .env.example**

### Solution

#### Step 1: Check Your Environment File

Open your `.env.development` file and look for:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

If you see placeholder values like `your-project`, you need to update them with real values.

#### Step 2: Get Your Supabase Credentials

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Sign in or create an account
3. Create a new project or select an existing one
4. Go to **Settings** → **API**
5. Copy the following:
   - **Project URL** (looks like `https://abcdefghij.supabase.co`)
   - **anon/public key** (a long JWT token)

#### Step 3: Update Your Environment File

Update `.env.development` with your actual values:

```bash
VITE_SUPABASE_URL=https://abcdefghij.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Important:** Replace the entire URL and key with your actual values from the Supabase dashboard.

#### Step 4: Verify the URL

You can test if your Supabase URL is working by opening it in your browser:

```
https://your-actual-project.supabase.co
```

You should see a response (not a DNS error).

#### Step 5: Restart the Development Server

After updating your environment file:

```bash
# Stop the current server (Ctrl+C)
# Then restart:
npm run dev
```

### Additional Checks

#### Test DNS Resolution (Optional)

You can verify DNS resolution from your terminal:

```bash
nslookup your-project.supabase.co
```

If this fails, the URL is definitely incorrect or the project doesn't exist.

#### Verify Environment Variables Are Loaded

Add a temporary log in your code to check if variables are loaded:

```typescript
console.log('Supabase URL:', import.meta.env.VITE_SUPABASE_URL);
```

**Remember:** Only variables prefixed with `VITE_` are accessible in the browser.

### Production Deployment

For production (Vercel/Netlify):

1. Add environment variables in your hosting platform's dashboard
2. Use production Supabase URL and keys
3. Never commit `.env` files with real credentials to git
4. Redeploy after updating environment variables

### Still Having Issues?

1. **Check the Supabase project status** - Ensure it's active in your dashboard
2. **Verify your internet connection** - Try accessing supabase.com
3. **Check for typos** - Make sure there are no extra spaces or characters
4. **Try creating a fresh Supabase project** - If the old one is corrupted

### For Developers Setting Up the Project

If you're cloning this repository for the first time:

1. **DO NOT** use the values in `.env.development` - they are example values
2. Copy `.env.example` to `.env.development`
3. Create your own Supabase project
4. Update with your own credentials
5. Follow the setup instructions in [README.md](../README.md)

## Related Documentation

- [README.md](../README.md) - Quick start guide
- [DEPLOYMENT_GUIDE.md](../DEPLOYMENT_GUIDE.md) - Production deployment
- [ARCHITECTURE.md](../ARCHITECTURE.md) - System architecture
