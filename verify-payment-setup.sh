#!/bin/bash

# ============================================================================
# Payment System Setup Verification Script
# ============================================================================
# This script verifies that all components required for the payment system
# are properly configured and deployed.
#
# Usage: ./verify-payment-setup.sh
# ============================================================================

echo "============================================================================"
echo "Payment System Setup Verification"
echo "============================================================================"
echo ""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0
WARNINGS=0

# Helper functions
check_pass() {
    echo -e "${GREEN}✓${NC} $1"
    ((PASSED++))
}

check_fail() {
    echo -e "${RED}✗${NC} $1"
    ((FAILED++))
}

check_warn() {
    echo -e "${YELLOW}!${NC} $1"
    ((WARNINGS++))
}

# ============================================================================
# 1. Check Environment Variables
# ============================================================================
echo "1. Checking Environment Variables..."
echo "   --------------------------------"

# Check .env.development
if [ -f .env.development ]; then
    check_pass ".env.development file exists"
    
    # Check VITE_APP_URL
    if grep -q "VITE_APP_URL=" .env.development; then
        APP_URL=$(grep "VITE_APP_URL=" .env.development | cut -d '=' -f2)
        if [ -z "$APP_URL" ]; then
            check_fail "VITE_APP_URL is empty in .env.development"
        else
            check_pass "VITE_APP_URL is set: $APP_URL"
        fi
    else
        check_fail "VITE_APP_URL not found in .env.development"
    fi
    
    # Check VITE_PAYSTACK_PUBLIC_KEY
    if grep -q "VITE_PAYSTACK_PUBLIC_KEY=" .env.development; then
        PAYSTACK_KEY=$(grep "VITE_PAYSTACK_PUBLIC_KEY=" .env.development | cut -d '=' -f2)
        if [ -z "$PAYSTACK_KEY" ]; then
            check_fail "VITE_PAYSTACK_PUBLIC_KEY is empty in .env.development"
        elif [[ "$PAYSTACK_KEY" == "pk_test_your_paystack_public_key_here" ]]; then
            check_fail "VITE_PAYSTACK_PUBLIC_KEY is still using placeholder value"
        else
            check_pass "VITE_PAYSTACK_PUBLIC_KEY is set"
            if [[ "$PAYSTACK_KEY" == pk_test_* ]]; then
                check_warn "Using test key (pk_test_*) - make sure to use live key in production"
            fi
        fi
    else
        check_fail "VITE_PAYSTACK_PUBLIC_KEY not found in .env.development"
    fi
    
    # Check VITE_SUPABASE_URL
    if grep -q "VITE_SUPABASE_URL=" .env.development; then
        check_pass "VITE_SUPABASE_URL is set"
    else
        check_fail "VITE_SUPABASE_URL not found in .env.development"
    fi
    
    # Check VITE_SUPABASE_ANON_KEY
    if grep -q "VITE_SUPABASE_ANON_KEY=" .env.development; then
        check_pass "VITE_SUPABASE_ANON_KEY is set"
    else
        check_fail "VITE_SUPABASE_ANON_KEY not found in .env.development"
    fi
else
    check_fail ".env.development file not found"
    echo "   Create it by copying .env.example: cp .env.example .env.development"
fi

echo ""

# ============================================================================
# 2. Check Edge Functions
# ============================================================================
echo "2. Checking Edge Functions..."
echo "   --------------------------"

# Check if verify-payment function exists
if [ -d "supabase/functions/verify-payment" ]; then
    check_pass "verify-payment function directory exists"
    
    if [ -f "supabase/functions/verify-payment/index.ts" ]; then
        check_pass "verify-payment/index.ts exists"
    else
        check_fail "verify-payment/index.ts not found"
    fi
else
    check_fail "verify-payment function directory not found"
fi

# Check if paystack-webhook function exists
if [ -d "supabase/functions/paystack-webhook" ]; then
    check_pass "paystack-webhook function directory exists"
    
    if [ -f "supabase/functions/paystack-webhook/index.ts" ]; then
        check_pass "paystack-webhook/index.ts exists"
    else
        check_fail "paystack-webhook/index.ts not found"
    fi
else
    check_fail "paystack-webhook function directory not found"
fi

# Check if deployment script exists
if [ -f "deploy-edge-functions.sh" ]; then
    check_pass "deploy-edge-functions.sh script exists"
    if [ -x "deploy-edge-functions.sh" ]; then
        check_pass "deploy-edge-functions.sh is executable"
    else
        check_warn "deploy-edge-functions.sh is not executable (run: chmod +x deploy-edge-functions.sh)"
    fi
else
    check_warn "deploy-edge-functions.sh not found"
fi

echo ""

# ============================================================================
# 3. Check Database Schema
# ============================================================================
echo "3. Checking Database Schema..."
echo "   ---------------------------"

if [ -f "supabase/schema.sql" ]; then
    check_pass "schema.sql exists"
    
    # Check current_members default
    if grep -q "current_members INTEGER DEFAULT 0" supabase/schema.sql; then
        check_pass "current_members default is correctly set to 0"
    elif grep -q "current_members INTEGER DEFAULT 1" supabase/schema.sql; then
        check_fail "current_members default is 1 (should be 0) - migration needed"
    else
        check_warn "Could not verify current_members default value"
    fi
else
    check_fail "schema.sql not found"
fi

# Check if migration exists
if [ -f "supabase/migrations/fix_member_count_and_slot_assignment.sql" ]; then
    check_pass "Migration file exists (fix_member_count_and_slot_assignment.sql)"
else
    check_fail "Migration file not found"
fi

echo ""

# ============================================================================
# 4. Check Trigger Configuration
# ============================================================================
echo "4. Checking Trigger Configuration..."
echo "   ---------------------------------"

if [ -f "supabase/triggers.sql" ]; then
    check_pass "triggers.sql exists"
    
    # Check if auto-add creator trigger is disabled
    if grep -q "DISABLED" supabase/triggers.sql; then
        check_pass "Auto-add creator trigger is disabled (as expected)"
    else
        check_warn "Could not verify if auto-add creator trigger is disabled"
    fi
else
    check_fail "triggers.sql not found"
fi

echo ""

# ============================================================================
# 5. Check Frontend Components
# ============================================================================
echo "5. Checking Frontend Components..."
echo "   --------------------------------"

# Check payment-related pages
if [ -f "src/pages/PaymentSuccessPage.tsx" ]; then
    check_pass "PaymentSuccessPage.tsx exists"
else
    check_fail "PaymentSuccessPage.tsx not found"
fi

if [ -f "src/pages/CreateGroupPage.tsx" ]; then
    check_pass "CreateGroupPage.tsx exists"
else
    check_fail "CreateGroupPage.tsx not found"
fi

if [ -f "src/pages/GroupDetailPage.tsx" ]; then
    check_pass "GroupDetailPage.tsx exists"
else
    check_fail "GroupDetailPage.tsx not found"
fi

# Check API services
if [ -f "src/api/payments.ts" ]; then
    check_pass "payments.ts API service exists"
else
    check_fail "payments.ts API service not found"
fi

if [ -f "src/api/groups.ts" ]; then
    check_pass "groups.ts API service exists"
else
    check_fail "groups.ts API service not found"
fi

# Check Paystack service
if [ -f "src/lib/paystack.ts" ]; then
    check_pass "paystack.ts service exists"
else
    check_fail "paystack.ts service not found"
fi

# Check SlotSelector component
if [ -f "src/components/SlotSelector.tsx" ]; then
    check_pass "SlotSelector.tsx component exists"
else
    check_fail "SlotSelector.tsx component not found"
fi

echo ""

# ============================================================================
# 6. Check Documentation
# ============================================================================
echo "6. Checking Documentation..."
echo "   -------------------------"

if [ -f "PAYMENT_VERIFICATION_TROUBLESHOOTING.md" ]; then
    check_pass "Payment troubleshooting guide exists"
else
    check_warn "PAYMENT_VERIFICATION_TROUBLESHOOTING.md not found"
fi

if [ -f "PAYMENT_FLOW.md" ]; then
    check_pass "Payment flow documentation exists"
else
    check_warn "PAYMENT_FLOW.md not found"
fi

echo ""

# ============================================================================
# Summary
# ============================================================================
echo "============================================================================"
echo "Verification Summary"
echo "============================================================================"
echo -e "Passed:   ${GREEN}$PASSED${NC}"
echo -e "Failed:   ${RED}$FAILED${NC}"
echo -e "Warnings: ${YELLOW}$WARNINGS${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    if [ $WARNINGS -eq 0 ]; then
        echo -e "${GREEN}✓ All checks passed!${NC}"
        echo ""
        echo "Next steps:"
        echo "1. Deploy Edge Functions: ./deploy-edge-functions.sh"
        echo "2. Apply database migration"
        echo "3. Test payment flow with test card: 4084084084084081"
    else
        echo -e "${YELLOW}⚠ Some warnings found. Review and fix if needed.${NC}"
    fi
    exit 0
else
    echo -e "${RED}✗ Some checks failed. Please fix the issues above.${NC}"
    echo ""
    echo "Common fixes:"
    echo "1. Copy .env.example to .env.development"
    echo "2. Set VITE_APP_URL to your app URL (e.g., http://localhost:3000)"
    echo "3. Set VITE_PAYSTACK_PUBLIC_KEY to your Paystack public key"
    echo "4. Deploy Edge Functions: ./deploy-edge-functions.sh"
    echo "5. Apply database migration"
    echo ""
    echo "For detailed troubleshooting, see:"
    echo "- PAYMENT_VERIFICATION_TROUBLESHOOTING.md"
    echo "- README.md"
    exit 1
fi
