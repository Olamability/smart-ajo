# SmartAjo Features Documentation

This document provides an overview of all implemented features for the SmartAjo platform.

## Table of Contents

1. [Payment Webhook Verification](#payment-webhook-verification)
2. [Automated Penalty Calculation](#automated-penalty-calculation)
3. [Email Notifications](#email-notifications)
4. [KYC/BVN Verification](#kycbvn-verification)
5. [Admin Panel for Group Creators](#admin-panel-for-group-creators)
6. [Export Transactions to PDF](#export-transactions-to-pdf)
7. [Responsive Design](#responsive-design)

---

## Payment Webhook Verification

### Overview
Secure webhook handler that verifies Paystack payment events and automatically updates the database.

### Features
- **HMAC SHA512 signature verification** - Ensures webhooks are genuinely from Paystack
- **Contribution payment processing** - Automatically marks contributions as paid
- **Security deposit handling** - Updates member records when security deposits are paid
- **Transaction recording** - Creates audit trail of all payments

### Implementation
- **Location**: `supabase/functions/paystack-webhook/index.ts`
- **Trigger**: Paystack webhook POST request
- **Security**: Validates signature before processing

### Configuration
```bash
# Required environment variables
PAYSTACK_SECRET_KEY=sk_test_your_secret_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### Testing
1. Use Paystack test keys for development
2. Test webhook locally with ngrok
3. Verify signature validation works
4. Check database updates correctly

### Error Handling
- Invalid signature: Returns 401 Unauthorized
- Missing metadata: Returns 400 Bad Request
- Database errors: Logs error but returns 200 to prevent retries

---

## Automated Penalty Calculation

### Overview
Database triggers and scheduled jobs that automatically calculate and apply penalties for late or missed payments.

### Features
- **Late payment detection** - Identifies overdue contributions
- **Automatic penalty calculation** - Applies configurable penalty amounts
- **Notification system** - Alerts users when penalties are applied
- **Penalty waiver** - Admin can waive penalties if needed

### Implementation
- **Database Triggers**: `supabase/triggers.sql` - `notify_penalty_applied()`
- **Scheduled Jobs**: `supabase/scheduled-jobs.sql` - `apply-late-penalties`
- **Functions**: `supabase/functions.sql` - `apply_late_penalties()`

### Penalty Calculation
```sql
-- Formula: Base amount + (days_overdue * daily_rate)
-- Example: ₦1,000 + (5 days × ₦100) = ₦1,500
```

### Schedule
- Runs daily at 1:00 AM UTC
- Checks all active groups
- Only applies penalty once per overdue contribution

### Configuration
Edit penalty rates in `supabase/functions.sql`:
```sql
-- Modify calculate_late_penalty function
v_penalty_amount := v_contribution_amount * 0.1; -- 10% late fee
```

---

## Email Notifications

### Overview
SMTP-based email notification system with professional HTML templates.

### Features
- **Multiple templates**: Contribution paid, payout received, penalty applied, member joined, group status changes
- **HTML formatting**: Professional, responsive email design
- **SMTP integration**: Works with any SMTP provider (Gmail, SendGrid, AWS SES)
- **Template customization**: Easy to modify email content

### Implementation
- **Location**: `supabase/functions/send-email/index.ts`
- **Trigger**: Called by database triggers or application code
- **Templates**: Built-in HTML templates for common events

### Email Templates

#### 1. Contribution Paid
Sent when a member pays their contribution.

#### 2. Payout Received
Sent when a member receives their payout.

#### 3. Penalty Applied
Sent when a penalty is applied to a member.

#### 4. Member Joined
Sent when a new member joins a group.

#### 5. Group Status Change
Sent when group status changes (active, completed, cancelled).

### SMTP Providers

#### Gmail
```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
```

#### SendGrid
```bash
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=your_sendgrid_api_key
```

#### AWS SES
```bash
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=your_ses_username
SMTP_PASSWORD=your_ses_password
```

### Testing
```javascript
// Test email sending
const response = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    to: 'test@example.com',
    subject: 'Test Email',
    type: 'contribution_paid',
    data: { /* template data */ },
  }),
});
```

---

## KYC/BVN Verification

### Overview
Bank Verification Number (BVN) verification system for identity verification.

### Features
- **BVN validation** - Verifies 11-digit BVN format
- **Identity matching** - Compares names and date of birth
- **Multiple providers** - Supports Paystack, Flutterwave, or mock mode
- **Automatic KYC status update** - Updates user profile upon verification
- **Privacy protection** - BVN is masked in database

### Implementation
- **Backend**: `supabase/functions/verify-bvn/index.ts`
- **Frontend**: `src/pages/KYCVerificationPage.tsx`
- **Route**: `/kyc-verification`

### Verification Flow
1. User enters BVN and personal details
2. Frontend sends request to Edge Function
3. Edge Function calls BVN verification provider API
4. Provider returns BVN holder details
5. System compares details with user input
6. Match score calculated (0-100)
7. KYC status updated in database

### Match Scoring
- First name match: 40 points
- Last name match: 40 points
- Date of birth match: 20 points
- **Threshold**: 80+ points required for approval

### Providers

#### Paystack Identity (Recommended)
- Cost: ₦50 per verification
- High accuracy
- Easy integration

#### Flutterwave KYC
- Variable pricing
- High accuracy
- Requires separate account

#### Mock Mode (Development Only)
- Free
- Always succeeds if BVN is 11 digits
- **DO NOT USE IN PRODUCTION**

### Configuration
```bash
# Choose provider
BVN_PROVIDER=paystack  # or flutterwave, mock

# API credentials
BVN_API_KEY=your_api_key
# OR
PAYSTACK_SECRET_KEY=sk_test_...
# OR
FLUTTERWAVE_SECRET_KEY=FLWSECK_TEST-...
```

---

## Admin Panel for Group Creators

### Overview
Comprehensive dashboard for group creators to manage their groups.

### Features
- **Member management** - View, remove members
- **Contribution tracking** - Monitor payment status
- **Penalty management** - View and waive penalties
- **Group settings** - Change group status, view analytics
- **Export reports** - Download CSV reports

### Implementation
- **Location**: `src/pages/AdminPanelPage.tsx`
- **Route**: `/groups/:groupId/admin`
- **Access**: Only group creators can access

### Sections

#### 1. Overview Tab
- Group information
- Key statistics
- Quick actions (activate, complete, cancel group)

#### 2. Members Tab
- List of all members
- Security deposit status
- Member removal option
- KYC verification status

#### 3. Contributions Tab
- Current cycle contributions
- Payment status for each member
- Due dates and paid dates

#### 4. Penalties Tab
- Applied penalties
- Penalty details (amount, type, reason)
- Waive penalty option

### Analytics
- Total members count
- Current cycle progress
- Contribution amounts
- Active penalties count

### Actions

#### Remove Member
```typescript
// Only removes members who haven't started contributing
handleRemoveMember(memberId, memberName)
```

#### Waive Penalty
```typescript
// Changes penalty status from 'applied' to 'waived'
handleWaivePenalty(penaltyId)
```

#### Change Group Status
```typescript
// Updates group status (activate, complete, cancel)
handleChangeGroupStatus(newStatus)
```

---

## Export Transactions to PDF

### Overview
Export transaction history and group reports to professional PDF documents.

### Features
- **Transaction history export** - Personal transaction records
- **Group report export** - Complete group activity report
- **Professional formatting** - Tables, headers, footers
- **Summary statistics** - Total amounts, transaction counts

### Implementation
- **Library**: jsPDF + jspdf-autotable
- **Location**: `src/lib/pdfExport.ts`
- **Pages**: 
  - `src/pages/TransactionsPage.tsx` - Personal transactions
  - `src/pages/AdminPanelPage.tsx` - Group reports

### Functions

#### exportTransactionsToPDF
Exports personal transaction history.

```typescript
exportTransactionsToPDF(
  transactions: Transaction[],
  userName: string,
  userEmail: string
)
```

#### exportGroupReportToPDF
Exports complete group report with members, contributions, and penalties.

```typescript
exportGroupReportToPDF(
  group: GroupData,
  members: MemberData[],
  contributions: ContributionData[],
  penalties: PenaltyData[]
)
```

#### exportGroupTransactionsToPDF
Exports transaction history for a specific group.

```typescript
exportGroupTransactionsToPDF(
  groupName: string,
  transactions: Transaction[]
)
```

### PDF Contents

#### Transaction History PDF
- User information
- Transaction table (date, reference, type, method, amount, status)
- Summary (total transactions, total amount)
- Timestamp and branding

#### Group Report PDF
- Group details (name, status, cycle, members)
- Members table
- Contributions table (current cycle)
- Penalties table
- Multi-page support
- Page numbers

### Styling
- Brand colors (primary: #1e7d6e)
- Professional typography
- Responsive tables
- Alternating row colors
- Headers and footers on all pages

---

## Responsive Design

### Overview
All features are designed to work seamlessly across all device sizes.

### Breakpoints
```css
sm: 640px   /* Small devices (phones landscape) */
md: 768px   /* Medium devices (tablets) */
lg: 1024px  /* Large devices (desktops) */
xl: 1280px  /* Extra large devices */
2xl: 1536px /* 2X large devices */
```

### Mobile Optimizations

#### Admin Panel
- Stacked layout on mobile
- Horizontal scrolling for tables
- Collapsible sections
- Touch-friendly buttons

#### KYC Verification
- Single column form layout
- Large touch targets
- Mobile-friendly date picker
- Clear error messages

#### Transactions Page
- Responsive card layout
- Filter buttons wrap on small screens
- Transaction cards stack vertically
- Export button always accessible

### Testing
Tested on:
- iPhone (Safari)
- Android (Chrome)
- iPad (Safari)
- Desktop (Chrome, Firefox, Safari, Edge)

### Best Practices Applied
- Flexbox and Grid for layouts
- Relative units (rem, %, vh/vw)
- Mobile-first approach
- Touch-friendly tap targets (min 44x44px)
- Readable font sizes (min 16px)
- Adequate spacing
- No horizontal scrolling (except intentional)

---

## Security Considerations

### Payment Webhooks
- ✅ Signature verification
- ✅ HTTPS only
- ✅ Service role key protection
- ✅ Audit logging

### Email Notifications
- ✅ SMTP authentication
- ✅ Rate limiting
- ✅ No sensitive data in emails
- ✅ Unsubscribe links (future)

### BVN Verification
- ✅ BVN masking in database
- ✅ Encrypted transmission
- ✅ Provider API security
- ✅ User consent

### Admin Panel
- ✅ Creator-only access
- ✅ RLS policies
- ✅ Action confirmations
- ✅ Audit trail

### PDF Export
- ✅ Client-side generation
- ✅ No server-side storage
- ✅ User-specific data only
- ✅ No PII leakage

---

## Future Enhancements

### Payment Webhooks
- [ ] Support multiple payment providers
- [ ] Webhook retry mechanism
- [ ] Payment dispute handling

### Penalties
- [ ] Configurable penalty rates per group
- [ ] Grace period settings
- [ ] Automatic penalty payment

### Email Notifications
- [ ] Email preferences
- [ ] Unsubscribe management
- [ ] Email analytics

### KYC Verification
- [ ] Document upload (ID card, passport)
- [ ] Selfie verification
- [ ] Address verification

### Admin Panel
- [ ] Bulk actions
- [ ] Advanced analytics
- [ ] Member messaging
- [ ] Group templates

### PDF Export
- [ ] Custom report builder
- [ ] Email PDF directly
- [ ] Scheduled reports
- [ ] Chart visualizations

---

## Support

For questions or issues:
- Check documentation first
- Review error logs
- Contact support team
- Submit GitHub issue

## Resources

- [Supabase Documentation](https://supabase.com/docs)
- [Paystack API Docs](https://paystack.com/docs)
- [jsPDF Documentation](https://github.com/parallax/jsPDF)
- [Tailwind CSS Docs](https://tailwindcss.com/docs)
