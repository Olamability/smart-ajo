#!/bin/bash

# Edge Functions Deployment Script
# This script deploys all Edge Functions to Supabase
# 
# Prerequisites:
# 1. Supabase CLI installed: npm install -g supabase
# 2. Logged in to Supabase: supabase login
# 3. Project linked: supabase link --project-ref YOUR_PROJECT_REF
#
# Usage:
#   ./deploy-edge-functions.sh                 # Deploy all functions
#   ./deploy-edge-functions.sh verify-payment  # Deploy specific function

set -euo pipefail  # Exit on error, undefined vars, and pipe failures

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function list
FUNCTIONS=(
  "verify-payment"
  "paystack-webhook"
  "send-email"
  "verify-bvn"
  "health-check"
  "process-payouts"
)

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}Supabase Edge Functions Deployment${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo -e "${RED}Error: Supabase CLI is not installed${NC}"
    echo "Install it with: npm install -g supabase"
    exit 1
fi

# Check if a specific function is requested
if [ $# -eq 1 ]; then
    FUNCTIONS=("$1")
    echo -e "${YELLOW}Deploying single function: $1${NC}"
    echo ""
fi

# Deploy each function
for func in "${FUNCTIONS[@]}"; do
    echo -e "${YELLOW}Deploying $func...${NC}"
    
    if [ ! -d "supabase/functions/$func" ]; then
        echo -e "${RED}Warning: Function directory not found: supabase/functions/$func${NC}"
        echo "Skipping..."
        continue
    fi
    
    if supabase functions deploy "$func" --no-verify; then
        echo -e "${GREEN}✓ $func deployed successfully${NC}"
    else
        echo -e "${RED}✗ Failed to deploy $func${NC}"
        exit 1
    fi
    echo ""
done

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Verify deployment with: supabase functions list"
echo ""
echo -e "${YELLOW}Important: Set environment secrets if not already done:${NC}"
echo "  supabase secrets set PAYSTACK_SECRET_KEY=your_secret_key"
echo "  supabase secrets set SUPABASE_ANON_KEY=your_anon_key"
echo ""
echo -e "${YELLOW}Test the verify-payment function:${NC}"
echo "  curl -X OPTIONS 'https://YOUR_PROJECT.supabase.co/functions/v1/verify-payment' \\"
echo "    -H 'Origin: https://smart-ajo.vercel.app' \\"
echo "    -H 'Access-Control-Request-Method: POST' \\"
echo "    -v"
echo ""
