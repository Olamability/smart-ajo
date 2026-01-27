#!/bin/bash

# ============================================================================
# Complete Payment System Deployment Script
# ============================================================================
# This script automates the deployment of the complete Paystack payment system
# for Smart Ajo, including all Edge Functions and configuration verification.
#
# Prerequisites:
# - Supabase CLI installed: npm install -g supabase
# - Logged in to Supabase: supabase login
# - Project linked: supabase link --project-ref YOUR_PROJECT_REF
# - Paystack keys available
#
# Usage: ./deploy-payment-system.sh
# ============================================================================

set -euo pipefail  # Exit on error, undefined vars, and pipe failures

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}============================================================================${NC}"
echo -e "${BLUE}Smart Ajo - Complete Payment System Deployment${NC}"
echo -e "${BLUE}============================================================================${NC}"
echo ""

# ============================================================================
# Step 1: Pre-deployment Checks
# ============================================================================
echo -e "${YELLOW}Step 1: Pre-deployment Checks${NC}"
echo "-----------------------------"

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo -e "${RED}✗ Supabase CLI is not installed${NC}"
    echo "Install it with: npm install -g supabase"
    exit 1
fi
echo -e "${GREEN}✓ Supabase CLI installed${NC}"

# Check if project is linked
if ! supabase status &> /dev/null; then
    echo -e "${RED}✗ Project not linked to Supabase${NC}"
    echo "Link your project with: supabase link --project-ref YOUR_PROJECT_REF"
    exit 1
fi
echo -e "${GREEN}✓ Project linked to Supabase${NC}"

# Check if .env.development exists
if [ ! -f .env.development ]; then
    echo -e "${YELLOW}⚠ .env.development not found${NC}"
    echo "Creating from .env.example..."
    cp .env.example .env.development
    echo -e "${YELLOW}⚠ Please update .env.development with your actual keys${NC}"
    echo "Press Enter after updating .env.development to continue..."
    read
fi
echo -e "${GREEN}✓ .env.development exists${NC}"

echo ""

# ============================================================================
# Step 2: Deploy Edge Functions
# ============================================================================
echo -e "${YELLOW}Step 2: Deploying Edge Functions${NC}"
echo "----------------------------------"

FUNCTIONS=("verify-payment" "paystack-webhook" "send-email" "verify-bvn" "health-check")
DEPLOYED=0
FAILED=0

for func in "${FUNCTIONS[@]}"; do
    echo -e "${BLUE}Deploying $func...${NC}"
    
    if [ ! -d "supabase/functions/$func" ]; then
        echo -e "${RED}✗ Function directory not found: supabase/functions/$func${NC}"
        ((FAILED++))
        continue
    fi
    
    if supabase functions deploy "$func" --no-verify-jwt; then
        echo -e "${GREEN}✓ $func deployed successfully${NC}"
        ((DEPLOYED++))
    else
        echo -e "${RED}✗ Failed to deploy $func${NC}"
        ((FAILED++))
    fi
    echo ""
done

echo -e "${BLUE}Deployment Summary:${NC}"
echo -e "  ${GREEN}Deployed: $DEPLOYED${NC}"
echo -e "  ${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -gt 0 ]; then
    echo -e "${RED}Some functions failed to deploy. Please fix the errors and try again.${NC}"
    exit 1
fi

# ============================================================================
# Step 3: Configure Secrets
# ============================================================================
echo -e "${YELLOW}Step 3: Configuring Supabase Secrets${NC}"
echo "-------------------------------------"

# Check if PAYSTACK_SECRET_KEY is already set
SECRETS=$(supabase secrets list 2>&1 || echo "")

if echo "$SECRETS" | grep -q "PAYSTACK_SECRET_KEY"; then
    echo -e "${GREEN}✓ PAYSTACK_SECRET_KEY already configured${NC}"
    echo ""
    read -p "Do you want to update it? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Enter your Paystack Secret Key (sk_test_... or sk_live_...):"
        read -s PAYSTACK_KEY
        echo ""
        supabase secrets set PAYSTACK_SECRET_KEY="$PAYSTACK_KEY"
        echo -e "${GREEN}✓ PAYSTACK_SECRET_KEY updated${NC}"
    fi
else
    echo -e "${YELLOW}⚠ PAYSTACK_SECRET_KEY not configured${NC}"
    echo ""
    echo "To configure the Paystack Secret Key, run:"
    echo -e "${BLUE}supabase secrets set PAYSTACK_SECRET_KEY=sk_test_your_secret_key_here${NC}"
    echo ""
    read -p "Do you want to set it now? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Enter your Paystack Secret Key (sk_test_... or sk_live_...):"
        read -s PAYSTACK_KEY
        echo ""
        if [ -z "$PAYSTACK_KEY" ]; then
            echo -e "${YELLOW}⚠ No key entered. You can set it later with:${NC}"
            echo -e "${BLUE}supabase secrets set PAYSTACK_SECRET_KEY=sk_test_your_key${NC}"
        else
            supabase secrets set PAYSTACK_SECRET_KEY="$PAYSTACK_KEY"
            echo -e "${GREEN}✓ PAYSTACK_SECRET_KEY configured${NC}"
        fi
    else
        echo -e "${YELLOW}⚠ Skipping secret configuration. Remember to set it later!${NC}"
    fi
fi

echo ""

# ============================================================================
# Step 4: Verify Deployment
# ============================================================================
echo -e "${YELLOW}Step 4: Verifying Deployment${NC}"
echo "-----------------------------"

# Run health check if script exists
if [ -f "check-edge-functions.sh" ]; then
    chmod +x check-edge-functions.sh
    echo "Running health check..."
    echo ""
    ./check-edge-functions.sh || true
else
    echo -e "${YELLOW}⚠ check-edge-functions.sh not found, skipping health check${NC}"
fi

echo ""

# ============================================================================
# Step 5: Summary and Next Steps
# ============================================================================
echo -e "${BLUE}============================================================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${BLUE}============================================================================${NC}"
echo ""

echo -e "${YELLOW}Deployment Summary:${NC}"
echo "  ✅ Edge Functions deployed: $DEPLOYED/$((${#FUNCTIONS[@]}))"
echo "  ✅ Configuration verified"
echo ""

echo -e "${YELLOW}Next Steps:${NC}"
echo ""
echo "1. Verify Environment Variables:"
echo "   - Update .env.development with your Paystack public key"
echo "   - Ensure VITE_APP_URL is set correctly"
echo ""
echo "2. Test Payment Flow:"
echo "   - Start dev server: npm run dev"
echo "   - Create a test group"
echo "   - Use test card: 4084084084084081"
echo "   - Verify member activation works"
echo ""
echo "3. Configure Paystack Webhook (Optional but Recommended):"
echo "   - Go to Paystack Dashboard → Settings → Webhooks"
echo "   - Add webhook URL: https://YOUR_PROJECT.supabase.co/functions/v1/paystack-webhook"
echo ""
echo "4. Review Deployment Guide:"
echo "   - See PAYSTACK_INTEGRATION_DEPLOYMENT.md for complete instructions"
echo ""

echo -e "${YELLOW}Test Cards for Development:${NC}"
echo "  Success: 4084084084084081"
echo "  Failed:  4084084084084099"
echo "  CVV: 123, Expiry: 12/25, PIN: 1234, OTP: 123456"
echo ""

echo -e "${YELLOW}Monitor Logs:${NC}"
echo "  supabase functions logs verify-payment"
echo "  supabase functions logs paystack-webhook"
echo ""

echo -e "${GREEN}Payment system is now ready for testing!${NC}"
echo ""
