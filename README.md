# Smart Ajo - Secure Digital Rotating Savings Platform

A modern web application for managing rotating savings groups (Ajo/Esusu) with complete transparency, automated escrow, enforced contributions, and guaranteed payouts.

## ⚡ Payment Integration Status

**✅ FULLY IMPLEMENTED** - Payment system is production-ready and complete.
**❌ NEEDS DEPLOYMENT** - Edge Functions must be deployed for payments to work.

**Quick Fix (5 minutes):**
```bash
./deploy-payment-system.sh
```

See [PAYMENT_INTEGRATION_README.md](./PAYMENT_INTEGRATION_README.md) for complete payment setup guide.

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm
- A Supabase account and project
- A Paystack account (for payment processing)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd smart-ajo
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env.development
   ```

4. **Update `.env.development` with your actual keys:**
   ```bash
   # Get these from your Supabase project dashboard
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key-here
   
   # Get this from your Paystack dashboard
   VITE_PAYSTACK_PUBLIC_KEY=pk_test_your_paystack_public_key
   
   # Application settings
   VITE_APP_NAME=Ajo Secure
   VITE_APP_URL=http://localhost:3000
   ```

   **Important:** Replace placeholder values with your actual keys!
   
   See [ENVIRONMENT_SETUP.md](./ENVIRONMENT_SETUP.md) for detailed configuration instructions.

5. **Start the development server**
   ```bash
   npm run dev
   ```

   The app will be available at `http://localhost:3000`

## 📚 Documentation

### Getting Started
- **[Environment Setup Guide](./ENVIRONMENT_SETUP.md)** - Detailed environment configuration and troubleshooting
- **[Vercel Deployment Guide](./VERCEL_DEPLOYMENT.md)** - **Step-by-step guide for deploying to Vercel**
- **[Deployment Guide](./DEPLOYMENT_GUIDE.md)** - Production deployment instructions

### Payment Integration ⚡
- **[Payment Integration README](./PAYMENT_INTEGRATION_README.md)** - **🔥 Quick start guide for payment setup (START HERE!)**
- **[Payment Verification & Membership Activation](./PAYMENT_VERIFICATION.md)** - **🔐 How payment verification and membership activation works securely**
- **[Complete Deployment Guide](./PAYSTACK_INTEGRATION_DEPLOYMENT.md)** - **📖 Comprehensive payment deployment guide**
- **[Callback URL Guide](./CALLBACK_URL_GUIDE.md)** - **📍 What are callback URLs and how to find them**
- **[Paystack Configuration](./PAYSTACK_CONFIGURATION.md)** - Payment integration setup and webhook configuration
- **[Payment CORS Fix - COMPLETE GUIDE](./PAYMENT_CORS_FIX_COMPLETE.md)** - **🔥 Fix payment verification CORS errors**

### Architecture & Backend
- **[Architecture Guide](./ARCHITECTURE.md)** - System architecture and design decisions
- **[Edge Functions Deployment Index](./EDGE_FUNCTIONS_DEPLOYMENT_INDEX.md)** - **📖 Complete guide to deploying edge functions (START HERE!)**
- **[Payment Processor Deployment](./PAYMENT_PROCESSOR_DEPLOYMENT.md)** - **🚀 How to deploy the payment-processor.ts edge function**
- **[Edge Functions Setup Guide](./EDGE_FUNCTIONS_SETUP.md)** - Complete edge functions deployment guide
- **[Edge Functions CORS Fix](./EDGE_FUNCTIONS_CORS_FIX.md)** - Fix CORS errors with Edge Functions
- **[Supabase Setup](./SUPABASE_SETUP.md)** - Database and backend configuration

## 🛠️ Development

### Available Scripts

- `npm run dev` - Start development server (port 3000)
- `npm run build` - Build for production
- `npm run preview` - Preview production build locally
- `npm run lint` - Run ESLint

### Project Structure

```
smart-ajo/
├── src/                    # Frontend source code
│   ├── api/               # API integration layer
│   ├── components/        # React components
│   ├── contexts/          # React contexts (Auth, etc.)
│   ├── hooks/             # Custom React hooks
│   ├── lib/               # Utility libraries
│   ├── pages/             # Page components
│   └── types/             # TypeScript type definitions
├── supabase/              # Backend (Supabase)
│   ├── migrations/        # Database migrations
│   ├── functions/         # Edge functions
│   │   ├── health-check/  # System health monitoring
│   │   ├── verify-payment/ # Payment verification
│   │   ├── paystack-webhook/ # Webhook handler
│   │   ├── send-email/    # Email notifications
│   │   └── verify-bvn/    # BVN verification
│   └── schema.sql         # Database schema
├── public/                # Static assets
└── docs/                  # Documentation
```

### Health Check Endpoint

The application includes a health check endpoint for monitoring system status:

**Endpoint:** `GET /functions/v1/health-check`

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-01-21T14:00:00.000Z",
  "version": "1.0.0",
  "components": {
    "database": { "status": "operational", "responseTime": 45 },
    "auth": { "status": "operational", "responseTime": 120 },
    "edgeFunctions": { "status": "operational" }
  }
}
```

**Status Values:**
- `healthy` - All components operational
- `degraded` - Some components degraded but functional
- `unhealthy` - Critical components down

**Use Cases:**
- Load balancer health checks
- Monitoring and alerting
- Deployment verification
- System diagnostics

**Testing:**
```bash
# Test locally (requires Supabase CLI)
supabase functions serve health-check

# Test deployed function
curl https://YOUR_PROJECT.supabase.co/functions/v1/health-check
```

## 🔧 Common Issues and Solutions

### "Paystack public key not configured" Error

This error occurs when the Paystack public key is not properly set in your environment variables.

**For Local Development:**
1. Get your public key from [Paystack Dashboard](https://dashboard.paystack.com/)
2. Update `VITE_PAYSTACK_PUBLIC_KEY` in `.env.development`
3. Restart the development server

**For Vercel Deployment:**
1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Add `VITE_PAYSTACK_PUBLIC_KEY` with your Paystack public key
3. Redeploy your application

**See [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md) for complete Vercel setup instructions.**

### CORS Error with Payment Verification

If you see errors like "blocked by CORS policy" when verifying payments:

```
Access to fetch at 'https://...supabase.co/functions/v1/verify-payment' 
has been blocked by CORS policy: Response to preflight request doesn't 
pass access control check: It does not have HTTP ok status.
```

**Quick Fix:**
1. Deploy Edge Functions: `./deploy-edge-functions.sh`
2. Configure secrets: `supabase secrets set PAYSTACK_SECRET_KEY=your_key`
3. Test deployment: `./check-edge-functions.sh`

**See [PAYMENT_CORS_FIX_COMPLETE.md](./PAYMENT_CORS_FIX_COMPLETE.md) for the complete fix guide with detailed steps, testing, and troubleshooting.**

**For deploying the payment processor specifically, see:**
- **[First Time Deployment Guide](./FIRST_TIME_DEPLOYMENT_GUIDE.md)** - Step-by-step walkthrough for first-time deployment
- **[Payment Processor Deployment](./PAYMENT_PROCESSOR_DEPLOYMENT.md)** - Comprehensive deployment guide
- **[Quick Start Guide](./DEPLOY_PAYMENT_PROCESSOR_QUICKSTART.md)** - Quick reference for deployment

### Page Refresh Returns 404

This has been fixed with proper SPA routing configuration. If you still experience issues:
- For Netlify: Ensure `public/_redirects` is deployed
- For Vercel: Ensure `vercel.json` is in your project root
- For other platforms: Configure your server to serve `index.html` for all routes

See [ENVIRONMENT_SETUP.md](./ENVIRONMENT_SETUP.md#issue-2-page-refresh-returns-404-error) for more details.

## 🚀 Deployment

### Build for Production

```bash
npm run build
```

The built files will be in the `dist/` directory.

### Deploy to Vercel

**Quick Setup:**
1. Connect your repository to Vercel
2. Framework preset: Vite (auto-detected)
3. Build command: `npm run build` (auto-detected)
4. Output directory: `dist` (auto-detected)
5. **Add environment variables in Vercel dashboard** (CRITICAL STEP)
6. Deploy!

**Important:** Environment variables must be configured in Vercel dashboard for the application to work.

**See [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md) for complete step-by-step instructions.**

The `vercel.json` file ensures SPA routing works correctly.

### Deploy to Netlify

1. Connect your repository to Netlify
2. Set build command: `npm run build`
3. Set publish directory: `dist`
4. Add environment variables in Netlify dashboard
5. Deploy!

The `public/_redirects` file ensures SPA routing works correctly.

### Environment Variables for Production

Set these in your hosting platform's environment variables:

```bash
VITE_SUPABASE_URL=your-production-supabase-url
VITE_SUPABASE_ANON_KEY=your-production-anon-key
VITE_APP_URL=https://your-production-domain.com
VITE_PAYSTACK_PUBLIC_KEY=pk_live_your_live_public_key
```

**Important:** Use live keys for production!

## 🧪 Testing

### Manual Testing

1. **Test payment flow:**
   - Create a test group
   - Try to pay security deposit
   - Use Paystack test card: `4084084084084081`

2. **Test routing:**
   - Navigate to different pages
   - Refresh each page
   - All pages should load correctly (no 404)

### Test Cards

For testing Paystack integration:

| Card Number | Result |
|-------------|--------|
| 4084084084084081 | Success |
| 4084084084084099 | Failed (Insufficient Funds) |

- CVV: Any 3 digits (e.g., `123`)
- Expiry: Any future date (e.g., `12/25`)
- PIN: `1234`
- OTP: `123456`

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

[Add your license information here]

## 🆘 Support

If you encounter issues:

1. Check [ENVIRONMENT_SETUP.md](./ENVIRONMENT_SETUP.md) for common issues
2. Review the error message carefully
3. Check browser console for detailed errors
4. Verify all environment variables are set correctly
5. Ensure you're using the latest version

## 🔗 Additional Resources

- [Vite Documentation](https://vitejs.dev/)
- [React Documentation](https://react.dev/)
- [Supabase Documentation](https://supabase.com/docs)
- [Paystack Documentation](https://paystack.com/docs)
