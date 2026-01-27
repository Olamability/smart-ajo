# CI/CD Example for Edge Functions Deployment

This guide shows how to automate edge function deployment using GitHub Actions.

## GitHub Actions Workflow Example

Create `.github/workflows/deploy-edge-functions.yml`:

```yaml
name: Deploy Edge Functions

on:
  push:
    branches:
      - main
      - production
    paths:
      - 'supabase/functions/**'
  workflow_dispatch:  # Allow manual triggering

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
      
      - name: Install Supabase CLI
        run: npm install -g supabase
      
      - name: Deploy Edge Functions
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          PROJECT_ID: ${{ secrets.SUPABASE_PROJECT_REF }}
        run: |
          # Link to Supabase project
          supabase link --project-ref $PROJECT_ID
          
          # Deploy all edge functions
          supabase functions deploy verify-payment --no-verify
          supabase functions deploy paystack-webhook --no-verify
          supabase functions deploy send-email --no-verify
          supabase functions deploy verify-bvn --no-verify
          supabase functions deploy health-check --no-verify
      
      - name: Set Secrets (if needed)
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          PROJECT_ID: ${{ secrets.SUPABASE_PROJECT_REF }}
          PAYSTACK_SECRET_KEY: ${{ secrets.PAYSTACK_SECRET_KEY }}
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
        run: |
          # Set secrets (only needed on first deployment)
          supabase secrets set PAYSTACK_SECRET_KEY="$PAYSTACK_SECRET_KEY" --project-ref $PROJECT_ID
          supabase secrets set SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" --project-ref $PROJECT_ID
```

## Required GitHub Secrets

Add these secrets in your GitHub repository settings (Settings > Secrets and variables > Actions):

| Secret Name | Description | How to Get |
|-------------|-------------|------------|
| `SUPABASE_ACCESS_TOKEN` | Supabase personal access token | [Generate at Supabase](https://app.supabase.com/account/tokens) |
| `SUPABASE_PROJECT_REF` | Your Supabase project reference | From dashboard URL: `https://app.supabase.com/project/YOUR_PROJECT_REF` |
| `PAYSTACK_SECRET_KEY` | Paystack secret key | [Get from Paystack Dashboard](https://dashboard.paystack.com/settings/developer) |
| `SUPABASE_ANON_KEY` | Supabase anonymous key | Supabase Dashboard > Settings > API > anon public |

## Manual Deployment Script

For manual deployments, create `deploy.sh`:

```bash
#!/bin/bash
# Manual deployment script for edge functions

set -euo pipefail

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${YELLOW}Starting deployment...${NC}"

# Check prerequisites
if ! command -v supabase &> /dev/null; then
    echo -e "${RED}Error: Supabase CLI not installed${NC}"
    echo "Install with: npm install -g supabase"
    exit 1
fi

# Prompt for project ref if not set
if [ -z "${SUPABASE_PROJECT_REF:-}" ]; then
    echo -e "${YELLOW}Enter your Supabase project reference:${NC}"
    read -r SUPABASE_PROJECT_REF
fi

# Link project
echo -e "${YELLOW}Linking to Supabase project...${NC}"
supabase link --project-ref "$SUPABASE_PROJECT_REF"

# Deploy functions
echo -e "${YELLOW}Deploying edge functions...${NC}"

FUNCTIONS=(
    "verify-payment"
    "paystack-webhook"
    "send-email"
    "verify-bvn"
    "health-check"
)

for func in "${FUNCTIONS[@]}"; do
    echo -e "${YELLOW}Deploying $func...${NC}"
    if supabase functions deploy "$func" --no-verify; then
        echo -e "${GREEN}✓ $func deployed${NC}"
    else
        echo -e "${RED}✗ Failed to deploy $func${NC}"
        exit 1
    fi
done

echo -e "${GREEN}Deployment complete!${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Set secrets: supabase secrets set PAYSTACK_SECRET_KEY=your_key"
echo "2. Verify: supabase functions list"
echo "3. Test: curl https://YOUR_PROJECT.supabase.co/functions/v1/verify-payment"
```

Make it executable:
```bash
chmod +x deploy.sh
```

## Environment-Specific Deployment

### Development Environment

```bash
# Set development secrets
export SUPABASE_PROJECT_REF=your-dev-project-ref

supabase link --project-ref $SUPABASE_PROJECT_REF
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_your_dev_key
supabase secrets set SUPABASE_ANON_KEY=your_dev_anon_key

# Deploy
./deploy-edge-functions.sh
```

### Production Environment

```bash
# Set production secrets
export SUPABASE_PROJECT_REF=your-prod-project-ref

supabase link --project-ref $SUPABASE_PROJECT_REF
supabase secrets set PAYSTACK_SECRET_KEY=sk_live_your_prod_key
supabase secrets set SUPABASE_ANON_KEY=your_prod_anon_key

# Deploy
./deploy-edge-functions.sh
```

## Deployment with Docker

Create `Dockerfile.deploy`:

```dockerfile
FROM node:18-alpine

# Install Supabase CLI
RUN npm install -g supabase

# Set working directory
WORKDIR /app

# Copy function files
COPY supabase/functions ./supabase/functions

# Copy deployment script
COPY deploy-edge-functions.sh .

# Make script executable
RUN chmod +x deploy-edge-functions.sh

# Set entrypoint
ENTRYPOINT ["./deploy-edge-functions.sh"]
```

Build and run:
```bash
# Build image
docker build -t edge-functions-deploy -f Dockerfile.deploy .

# Deploy
docker run --rm \
  -e SUPABASE_ACCESS_TOKEN=$SUPABASE_ACCESS_TOKEN \
  -e SUPABASE_PROJECT_REF=$SUPABASE_PROJECT_REF \
  edge-functions-deploy
```

## Deployment Checklist Template

Use this checklist for each deployment:

```markdown
## Deployment Checklist - [Date]

### Pre-Deployment
- [ ] Code reviewed and approved
- [ ] Tests passing
- [ ] Secrets configured
  - [ ] PAYSTACK_SECRET_KEY
  - [ ] SUPABASE_ANON_KEY
- [ ] Backup of current deployment taken
- [ ] Rollback plan documented

### Deployment
- [ ] Linked to correct Supabase project
- [ ] Deployed edge functions:
  - [ ] verify-payment
  - [ ] paystack-webhook
  - [ ] send-email
  - [ ] verify-bvn
  - [ ] health-check
- [ ] Verified deployment: `supabase functions list`

### Post-Deployment
- [ ] Smoke tests completed
  - [ ] Verify payment flow works
  - [ ] Check function logs for errors
  - [ ] Test webhook endpoint
- [ ] Monitoring enabled
- [ ] Team notified of deployment

### Rollback (if needed)
- [ ] Revert to previous version
- [ ] Clear cache/CDN
- [ ] Notify stakeholders
```

## Monitoring After Deployment

### Real-time Logs

```bash
# Follow logs in real-time
supabase functions logs verify-payment --follow

# Filter by error level
supabase functions logs verify-payment --follow | grep ERROR

# Save logs to file
supabase functions logs verify-payment > deployment-logs.txt
```

### Health Check

```bash
# Test health check endpoint
curl https://YOUR_PROJECT.supabase.co/functions/v1/health-check

# Expected response:
# {
#   "status": "healthy",
#   "timestamp": "...",
#   "components": {...}
# }
```

### Payment Verification Test

```bash
# Test verify-payment endpoint
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/verify-payment \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reference": "test_reference"}'
```

## Rollback Procedure

If deployment fails:

```bash
# 1. Check what went wrong
supabase functions logs verify-payment

# 2. Get previous version (if using git)
git log --oneline supabase/functions/

# 3. Checkout previous version
git checkout <previous-commit> supabase/functions/

# 4. Redeploy
./deploy-edge-functions.sh

# 5. Verify rollback
supabase functions list
curl https://YOUR_PROJECT.supabase.co/functions/v1/health-check
```

## Best Practices

1. **Test Locally First**
   ```bash
   supabase functions serve verify-payment
   # Test in another terminal
   ```

2. **Use Version Tags**
   ```bash
   git tag -a v1.0.0 -m "Deployment v1.0.0"
   git push origin v1.0.0
   ```

3. **Deploy During Low Traffic**
   - Schedule deployments during off-peak hours
   - Notify users of maintenance window

4. **Monitor Closely**
   - Watch logs for first 30 minutes after deployment
   - Keep rollback plan ready

5. **Document Changes**
   - Update CHANGELOG.md
   - Tag commits with deployment info
   - Keep deployment notes

## Troubleshooting Automated Deployments

### GitHub Actions Fails

```yaml
# Add debug logging
- name: Debug Supabase CLI
  run: |
    supabase --version
    supabase projects list
```

### Permission Errors

```bash
# Verify access token has correct permissions
curl -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  https://api.supabase.com/v1/projects
```

### Secrets Not Set

```bash
# Verify secrets are configured
supabase secrets list --project-ref $PROJECT_REF
```

## Additional Resources

- [Supabase CLI Documentation](https://supabase.com/docs/reference/cli)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Supabase Edge Functions Guide](https://supabase.com/docs/guides/functions)
