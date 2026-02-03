#!/bin/bash

###############################################################################
# Supabase Edge Functions Deployment Script
# 
# This script deploys the payment verification Edge Function to Supabase
# and configures the necessary secrets for Paystack integration.
#
# Prerequisites:
# 1. Supabase CLI installed (https://supabase.com/docs/guides/cli)
# 2. Logged in to Supabase CLI (supabase login)
# 3. Project linked (supabase link --project-ref YOUR_PROJECT_REF)
# 4. Paystack secret key ready
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

# Deploy verify-payment edge function
echo "📦 Deploying verify-payment Edge Function..."
supabase functions deploy verify-payment --no-verify-jwt

if [ $? -eq 0 ]; then
    echo "✅ verify-payment deployed successfully"
else
    echo "❌ Failed to deploy verify-payment"
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
echo "✅ Deployment Complete!"
echo "======================="
echo ""
echo "📝 Next Steps:"
echo "1. Test the Edge Function:"
echo "   curl -i --location --request POST 'https://YOUR_PROJECT.supabase.co/functions/v1/verify-payment' \\"
echo "     --header 'Authorization: Bearer YOUR_ANON_KEY' \\"
echo "     --header 'Content-Type: application/json' \\"
echo "     --data '{\"reference\":\"TEST_REFERENCE\"}'"
echo ""
echo "2. Update your frontend environment variables:"
echo "   - Ensure VITE_SUPABASE_URL is set"
echo "   - Ensure VITE_SUPABASE_ANON_KEY is set"
echo "   - Ensure VITE_PAYSTACK_PUBLIC_KEY is set"
echo ""
echo "3. Test payment flow in your application"
echo ""
echo "🎉 All done! Your payment system is ready."
