#!/bin/bash

# ============================================================================
# Payment System Deployment Validation Script
# ============================================================================
# This script validates that the payment verification system is properly
# configured and ready for production use.
#
# Usage:
#   chmod +x validate-payment-system.sh
#   ./validate-payment-system.sh
#
# Requirements:
#   - Supabase CLI installed
#   - Project linked: supabase link --project-ref YOUR_PROJECT_REF
#   - Environment variables configured
# ============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Tracking
CHECKS_PASSED=0
CHECKS_FAILED=0
WARNINGS=0

# Helper functions
function print_header() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
}

function print_check() {
    echo -e "${BLUE}[CHECK]${NC} $1"
}

function print_success() {
    echo -e "${GREEN}  ✓ $1${NC}"
    ((CHECKS_PASSED++))
}

function print_error() {
    echo -e "${RED}  ✗ $1${NC}"
    ((CHECKS_FAILED++))
}

function print_warning() {
    echo -e "${YELLOW}  ⚠ $1${NC}"
    ((WARNINGS++))
}

function print_info() {
    echo -e "  ℹ $1"
}

# ============================================================================
# VALIDATION CHECKS
# ============================================================================

print_header "Payment System Deployment Validation"
echo "This script will verify your payment verification system is ready."
echo ""

# ----------------------------------------------------------------------------
# 1. Check Supabase CLI
# ----------------------------------------------------------------------------
print_check "Checking Supabase CLI installation..."
if command -v supabase &> /dev/null; then
    SUPABASE_VERSION=$(supabase --version)
    print_success "Supabase CLI installed: $SUPABASE_VERSION"
else
    print_error "Supabase CLI not found"
    print_info "Install: npm install -g supabase"
    exit 1
fi

# ----------------------------------------------------------------------------
# 2. Check Project Link
# ----------------------------------------------------------------------------
print_check "Checking Supabase project link..."
if supabase status &> /dev/null; then
    PROJECT_REF=$(supabase status | grep "Project ref" | awk '{print $NF}' | tr -d '\n' 2>/dev/null || echo "unknown")
    if [ "$PROJECT_REF" != "unknown" ] && [ -n "$PROJECT_REF" ]; then
        print_success "Project linked: $PROJECT_REF"
    else
        print_warning "Could not determine project ref"
        print_info "Run: supabase link --project-ref YOUR_PROJECT_REF"
    fi
else
    print_error "Project not linked to Supabase"
    print_info "Run: supabase link --project-ref YOUR_PROJECT_REF"
    exit 1
fi

# ----------------------------------------------------------------------------
# 3. Check Database Migration
# ----------------------------------------------------------------------------
print_check "Checking if payment lock migration exists..."
MIGRATION_FILE="supabase/migrations/add_payment_advisory_lock.sql"
if [ -f "$MIGRATION_FILE" ]; then
    print_success "Payment lock migration file exists"
else
    print_error "Payment lock migration file not found: $MIGRATION_FILE"
    exit 1
fi

print_check "Checking if migration has been applied..."
# Try to check if the function exists in the database
FUNCTION_CHECK=$(supabase db execute "SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'acquire_payment_lock');" 2>/dev/null || echo "error")
if [[ "$FUNCTION_CHECK" =~ "t" ]] || [[ "$FUNCTION_CHECK" =~ "true" ]]; then
    print_success "Payment lock function exists in database"
elif [[ "$FUNCTION_CHECK" == "error" ]]; then
    print_warning "Could not verify function in database (may need to apply migration)"
    print_info "Run: supabase db push"
else
    print_error "Payment lock function not found in database"
    print_info "Run: supabase db push"
fi

# ----------------------------------------------------------------------------
# 4. Check Edge Functions
# ----------------------------------------------------------------------------
print_check "Checking Edge Functions deployment..."

# Check verify-payment function
if [ -d "supabase/functions/verify-payment" ]; then
    print_success "verify-payment function code exists"
else
    print_error "verify-payment function code not found"
fi

# Check paystack-webhook function
if [ -d "supabase/functions/paystack-webhook" ]; then
    print_success "paystack-webhook function code exists"
else
    print_error "paystack-webhook function code not found"
fi

# Check _shared folder
if [ -d "supabase/functions/_shared" ]; then
    print_success "_shared payment processor exists"
else
    print_error "_shared folder not found"
fi

# Check if functions are deployed
print_check "Checking deployed Edge Functions..."
DEPLOYED_FUNCTIONS=$(supabase functions list 2>/dev/null || echo "")
if [[ "$DEPLOYED_FUNCTIONS" =~ "verify-payment" ]]; then
    print_success "verify-payment is deployed"
else
    print_error "verify-payment is NOT deployed"
    print_info "Run: supabase functions deploy verify-payment"
fi

if [[ "$DEPLOYED_FUNCTIONS" =~ "paystack-webhook" ]]; then
    print_success "paystack-webhook is deployed"
else
    print_error "paystack-webhook is NOT deployed"
    print_info "Run: supabase functions deploy paystack-webhook"
fi

# ----------------------------------------------------------------------------
# 5. Check Environment Variables
# ----------------------------------------------------------------------------
print_check "Checking environment variables..."

# Check frontend env
if [ -f ".env" ] || [ -f ".env.development" ]; then
    print_success "Frontend environment file exists"
    
    # Check for required variables
    ENV_FILE=".env"
    [ -f ".env.development" ] && ENV_FILE=".env.development"
    
    if grep -q "VITE_PAYSTACK_PUBLIC_KEY" "$ENV_FILE"; then
        print_success "VITE_PAYSTACK_PUBLIC_KEY configured"
    else
        print_error "VITE_PAYSTACK_PUBLIC_KEY not found in $ENV_FILE"
    fi
    
    if grep -q "VITE_SUPABASE_URL" "$ENV_FILE"; then
        print_success "VITE_SUPABASE_URL configured"
    else
        print_error "VITE_SUPABASE_URL not found in $ENV_FILE"
    fi
    
    if grep -q "VITE_SUPABASE_ANON_KEY" "$ENV_FILE"; then
        print_success "VITE_SUPABASE_ANON_KEY configured"
    else
        print_error "VITE_SUPABASE_ANON_KEY not found in $ENV_FILE"
    fi
else
    print_error "No .env file found"
    print_info "Copy .env.example to .env and configure"
fi

# Check Supabase secrets
print_check "Checking Supabase secrets..."
SECRETS=$(supabase secrets list 2>/dev/null || echo "")
if [[ "$SECRETS" =~ "PAYSTACK_SECRET_KEY" ]]; then
    print_success "PAYSTACK_SECRET_KEY is set in Supabase"
else
    print_error "PAYSTACK_SECRET_KEY not set in Supabase"
    print_info "Run: supabase secrets set PAYSTACK_SECRET_KEY=sk_test_YOUR_KEY"
fi

# ----------------------------------------------------------------------------
# 6. Check Documentation
# ----------------------------------------------------------------------------
print_check "Checking documentation..."

if [ -f "WEBHOOK_CONFIGURATION.md" ]; then
    print_success "Webhook configuration guide exists"
else
    print_warning "WEBHOOK_CONFIGURATION.md not found"
fi

if [ -f "PAYMENT_VERIFICATION.md" ]; then
    print_success "Payment verification docs exist"
else
    print_warning "PAYMENT_VERIFICATION.md not found"
fi

# ----------------------------------------------------------------------------
# 7. Check Frontend Code
# ----------------------------------------------------------------------------
print_check "Checking frontend payment integration..."

if [ -f "src/api/payments.ts" ]; then
    print_success "Payment API service exists"
else
    print_error "src/api/payments.ts not found"
fi

if [ -f "src/pages/PaymentSuccessPage.tsx" ]; then
    print_success "Payment success page exists"
    
    # Check if session expiration handling is present
    if grep -q "session_expired" "src/pages/PaymentSuccessPage.tsx"; then
        print_success "Session expiration handling implemented"
    else
        print_warning "Session expiration handling may not be implemented"
    fi
else
    print_error "src/pages/PaymentSuccessPage.tsx not found"
fi

# ----------------------------------------------------------------------------
# 8. Test Edge Function Accessibility (Optional)
# ----------------------------------------------------------------------------
print_check "Testing Edge Function accessibility (optional)..."

if command -v curl &> /dev/null; then
    # Get project URL
    if [ -n "$PROJECT_REF" ] && [ "$PROJECT_REF" != "unknown" ]; then
        WEBHOOK_URL="https://${PROJECT_REF}.supabase.co/functions/v1/paystack-webhook"
        
        print_info "Testing webhook URL: $WEBHOOK_URL"
        HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$WEBHOOK_URL" || echo "000")
        
        if [ "$HTTP_STATUS" == "400" ] || [ "$HTTP_STATUS" == "401" ]; then
            print_success "Webhook endpoint is accessible (status: $HTTP_STATUS)"
            print_info "Note: 400/401 is expected for invalid requests"
        elif [ "$HTTP_STATUS" == "404" ]; then
            print_error "Webhook endpoint returns 404 - function may not be deployed"
        elif [ "$HTTP_STATUS" == "000" ]; then
            print_warning "Could not reach webhook endpoint (network issue?)"
        else
            print_warning "Unexpected status code: $HTTP_STATUS"
        fi
    else
        print_warning "Skipping endpoint test (project ref unknown)"
    fi
else
    print_warning "curl not found, skipping endpoint test"
fi

# ============================================================================
# SUMMARY
# ============================================================================

print_header "Validation Summary"

echo -e "${GREEN}Checks Passed:${NC} $CHECKS_PASSED"
echo -e "${RED}Checks Failed:${NC} $CHECKS_FAILED"
echo -e "${YELLOW}Warnings:${NC} $WARNINGS"
echo ""

if [ $CHECKS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ Payment system validation passed!${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Configure webhook in Paystack dashboard (see WEBHOOK_CONFIGURATION.md)"
    echo "2. Test payment flow with test card"
    echo "3. Monitor Edge Function logs: supabase functions logs verify-payment"
    echo "4. Monitor webhook logs: supabase functions logs paystack-webhook"
    exit 0
else
    echo -e "${RED}✗ Payment system validation failed!${NC}"
    echo ""
    echo "Please fix the errors above before deploying to production."
    echo "See documentation:"
    echo "  - WEBHOOK_CONFIGURATION.md"
    echo "  - PAYMENT_VERIFICATION.md"
    echo "  - DEPLOYMENT_GUIDE.md"
    exit 1
fi
