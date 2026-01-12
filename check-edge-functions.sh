#!/bin/bash

# Edge Functions Health Check Script
# Tests if Edge Functions are deployed and responding correctly

set -euo pipefail  # Exit on error, undefined vars, and pipe failures

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration (can be overridden via environment variables)
PROJECT_URL="${SUPABASE_PROJECT_URL:-https://kvxokszuonvdvsazoktc.supabase.co}"
ORIGIN="${APP_ORIGIN:-https://smart-ajo.vercel.app}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Edge Functions Health Check${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "${YELLOW}Project URL: $PROJECT_URL${NC}"
echo -e "${YELLOW}Origin: $ORIGIN${NC}"
echo ""

# Function to test CORS preflight
test_preflight() {
    local func_name=$1
    echo -e "${YELLOW}Testing $func_name...${NC}"
    
    response=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS \
        "$PROJECT_URL/functions/v1/$func_name" \
        -H "Origin: $ORIGIN" \
        -H "Access-Control-Request-Method: POST" \
        -H "Access-Control-Request-Headers: authorization, content-type")
    
    if [ "$response" = "204" ]; then
        echo -e "${GREEN}✓ $func_name: CORS preflight OK (204)${NC}"
        return 0
    elif [ "$response" = "200" ]; then
        echo -e "${YELLOW}⚠ $func_name: Returns 200 (should be 204, but may work)${NC}"
        return 1
    elif [ "$response" = "404" ]; then
        echo -e "${RED}✗ $func_name: NOT DEPLOYED (404)${NC}"
        return 2
    else
        echo -e "${RED}✗ $func_name: Unexpected status $response${NC}"
        return 2
    fi
}

# Function to get detailed CORS headers
test_cors_headers() {
    local func_name=$1
    echo -e "${BLUE}  Checking CORS headers...${NC}"
    
    curl -s -X OPTIONS \
        "$PROJECT_URL/functions/v1/$func_name" \
        -H "Origin: $ORIGIN" \
        -H "Access-Control-Request-Method: POST" \
        -H "Access-Control-Request-Headers: authorization, content-type" \
        -i 2>&1 | grep -i "access-control" || echo "  No CORS headers found"
    echo ""
}

# Test all functions
FUNCTIONS=("verify-payment" "paystack-webhook" "send-email" "verify-bvn")
FAILED=0

for func in "${FUNCTIONS[@]}"; do
    if ! test_preflight "$func"; then
        FAILED=$((FAILED + 1))
        test_cors_headers "$func"
    else
        echo ""
    fi
done

echo -e "${BLUE}========================================${NC}"
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All functions are healthy!${NC}"
    echo -e "${GREEN}✓ CORS configured correctly${NC}"
    echo -e "${GREEN}✓ All functions deployed${NC}"
else
    echo -e "${RED}$FAILED function(s) need attention${NC}"
    echo ""
    echo -e "${YELLOW}Next steps:${NC}"
    echo "1. Deploy functions: ./deploy-edge-functions.sh"
    echo "2. Verify deployment: supabase functions list"
    echo "3. Run this check again: ./check-edge-functions.sh"
fi
echo -e "${BLUE}========================================${NC}"
