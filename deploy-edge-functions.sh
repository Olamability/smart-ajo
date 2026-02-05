#!/bin/bash

###############################################################################
# Supabase Edge Functions Deployment Script
# 
# This script deploys all required Edge Functions to Supabase
# and configures the necessary secrets for integrations.
#
# Prerequisites:
# 1. Supabase CLI installed (https://supabase.com/docs/guides/cli)
# 2. Logged in to Supabase CLI (supabase login)
# 3. Project linked (supabase link --project-ref YOUR_PROJECT_REF)
# 4. Paystack secret key ready
# 5. (Optional) BVN verification API key if using real BVN service
#
# Usage:
#   ./deploy-edge-functions.sh
###############################################################################

set -e

echo "🚀 Smart Ajo - Edge Functions Deployment"
echo "=========================================="
echo ""

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "❌ Error: Supabase CLI not found"
    echo "Please install it from: https://supabase.com/docs/guides/cli"
    exit 1
fi

echo "✅ Supabase CLI found"

# Check if project is linked
if [ ! -f ".supabase/config.toml" ]; then
    echo "❌ Error: Supabase project not linked"
    echo "Please run: supabase link --project-ref YOUR_PROJECT_REF"
    exit 1
fi

echo "✅ Supabase project linked"
echo ""

# Deploy Edge Functions
echo "📦 Deploying Edge Functions..."
echo ""

# Deploy verify-payment edge function
echo "1️⃣  Deploying verify-payment Edge Function..."
supabase functions deploy verify-payment --no-verify-jwt

if [ $? -eq 0 ]; then
    echo "✅ verify-payment deployed successfully"
else
    echo "❌ Failed to deploy verify-payment"
    exit 1
fi

echo ""

# Deploy paystack-webhook edge function
echo "2️⃣  Deploying paystack-webhook Edge Function..."
supabase functions deploy paystack-webhook --no-verify-jwt

if [ $? -eq 0 ]; then
    echo "✅ paystack-webhook deployed successfully"
else
    echo "❌ Failed to deploy paystack-webhook"
    exit 1
fi

echo ""

# Deploy verify-bvn edge function
echo "3️⃣  Deploying verify-bvn Edge Function..."
supabase functions deploy verify-bvn

if [ $? -eq 0 ]; then
    echo "✅ verify-bvn deployed successfully"
else
    echo "❌ Failed to deploy verify-bvn"
    exit 1
fi

echo ""
echo "🔐 Configuring Secrets"
echo "====================="
echo ""

# Prompt for Paystack secret key if not already set
echo "Enter your Paystack Secret Key (sk_test_... or sk_live_...):"
read -s PAYSTACK_SECRET_KEY

if [ -z "$PAYSTACK_SECRET_KEY" ]; then
    echo "❌ Error: Paystack secret key is required"
    exit 1
fi

# Set the secret
echo "Setting PAYSTACK_SECRET_KEY..."
echo "$PAYSTACK_SECRET_KEY" | supabase secrets set PAYSTACK_SECRET_KEY

if [ $? -eq 0 ]; then
    echo "✅ PAYSTACK_SECRET_KEY configured"
else
    echo "❌ Failed to set PAYSTACK_SECRET_KEY"
    exit 1
fi

echo ""

# Optional: BVN verification API configuration
echo "📋 Optional: BVN Verification API Configuration"
echo "==============================================="
echo ""
echo "Do you want to configure a BVN verification API? (y/n)"
echo "Note: If you skip this, the system will use mock verification for development."
read -r CONFIGURE_BVN

if [[ "$CONFIGURE_BVN" =~ ^[Yy]$ ]]; then
    echo ""
    echo "Enter your BVN Verification API Key (or leave empty to skip):"
    read -s BVN_API_KEY
    
    if [ -n "$BVN_API_KEY" ]; then
        echo "$BVN_API_KEY" | supabase secrets set BVN_VERIFICATION_API_KEY
        
        echo ""
        echo "Enter your BVN Verification API URL (or leave empty to skip):"
        read BVN_API_URL
        
        if [ -n "$BVN_API_URL" ]; then
            echo "$BVN_API_URL" | supabase secrets set BVN_VERIFICATION_API_URL
        fi
        
        echo "✅ BVN verification API configured"
    else
        echo "⚠️  Skipping BVN API configuration - will use mock verification"
    fi
else
    echo "⚠️  Skipping BVN API configuration - will use mock verification"
fi

echo ""
echo "✅ Deployment Complete!"
echo "======================="
echo ""
echo "📝 Deployed Edge Functions:"
echo "  1. verify-payment  - Paystack payment verification"
echo "  2. paystack-webhook - Paystack webhook handler (real-time events)"
echo "  3. verify-bvn      - BVN/KYC verification (optional)"
echo ""
echo "🧪 Test the Edge Functions:"
echo ""
echo "Payment Verification:"
echo "  curl -i --location --request POST 'https://YOUR_PROJECT.supabase.co/functions/v1/verify-payment' \\"
echo "    --header 'Authorization: Bearer YOUR_ANON_KEY' \\"
echo "    --header 'Content-Type: application/json' \\"
echo "    --data '{\"reference\":\"TEST_REFERENCE\"}'"
echo ""
echo "Webhook URL (configure in Paystack Dashboard):"
echo "  https://YOUR_PROJECT.supabase.co/functions/v1/paystack-webhook"
echo ""
echo "BVN Verification (Test Mode):"
echo "  Use test BVN: 22222222222 (always passes)"
echo "  Use test BVN: 00000000000 (always fails)"
echo "  Any other 11-digit BVN will use basic validation in test mode"
echo ""
echo "📋 Next Steps:"
echo "  1. Update your frontend environment variables:"
echo "     - VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co"
echo "     - VITE_SUPABASE_ANON_KEY=your_anon_key"
echo "     - VITE_PAYSTACK_PUBLIC_KEY=pk_test_your_key"
echo ""
echo "  2. Test payment flow in your application"
echo "  3. Test KYC verification (optional feature)"
echo ""
echo "🎉 All done! Your application is ready to use."
echo ""
echo "📚 Documentation:"
echo "  - Payment Integration: PAYMENT_DEPLOYMENT_GUIDE.md"
echo "  - BVN Verification: See verify-bvn Edge Function for integration guide"
echo ""
